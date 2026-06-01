# CLI 智能助手集成实现指南

## 📋 当前状态

### ✅ 已完成
- CLI执行器模块 (`src/lark-cli.ts`)
- AI意图识别 (`src/ai.ts`)
- 确认卡片 (`src/cards.ts`)
- 配置管理 (`src/config.ts`)
- 基础架构搭建

### ⏳ 待完成
- 消息路由集成
- CLI操作处理器
- 结果格式化
- 确认回调处理

---

## 🎯 完整实现方案

### 步骤1：修改 handleMessageEvent

在 `src/app.ts` 的 `handleMessageEvent` 函数中，在处理待办逻辑之前添加意图识别：

```typescript
async function handleMessageEvent(envelope: FeishuEventEnvelope<FeishuMessageReceiveEvent>): Promise<Response> {
  // ... 现有代码 ...
  
  void (async () => {
    try {
      const actorOpenId = envelope.event.sender?.sender_id?.open_id;
      
      // 保存用户消息
      if (actorOpenId) {
        await client.saveChatMessage(actorOpenId, message.message_id, "user", text);
      }

      // 检查是否是查询命令
      if (text.match(/查询|任务列表|我的任务/)) {
        await handleQueryCommand(text, message.message_id);
        return;
      }

      // ========== 新增：智能助手意图识别 ==========
      if (cliExecutor && config.enableSmartAssistant) {
        const intent = await aiClient.analyzeIntent(text);
        
        // 如果置信度高且不是待办操作，走CLI路由
        if (intent.confidence > 0.7 && intent.type !== 'todo') {
          await handleCLIOperation(intent, message.message_id);
          return;
        }
      }
      // ========== 新增结束 ==========

      // 原有的待办处理逻辑
      const drafts = parseTodoDrafts(text, {
        timeZone: config.timezone,
        now: Date.now(),
        ...(actorOpenId ? { assigneeOpenId: actorOpenId } : {}),
      });
      
      // ... 其余待办逻辑保持不变 ...
    } catch (error) {
      // ... 错误处理 ...
    }
  })();

  return jsonResponse({ ok: true });
}
```

### 步骤2：实现 handleCLIOperation

在 `createTodoBotApp` 函数内部添加CLI操作处理函数：

```typescript
async function handleCLIOperation(intent: IntentAnalysisResult, messageId: string): Promise<void> {
  if (!cliExecutor) {
    await client.replyText(messageId, "智能助手功能未启用");
    return;
  }

  try {
    console.log(`[cli] handling operation: ${intent.type}, action: ${intent.action}`);

    // 判断是否需要确认
    const needsConfirmation = intent.requiresConfirmation || 
      cliExecutor.isConfirmationRequired(intent.type, intent.action);

    if (needsConfirmation) {
      // 发送确认卡片
      const confirmToken = crypto.randomUUID();
      pendingCLIOperations.set(confirmToken, { intent, messageId });

      const card = buildCLIConfirmCard({
        operation: intent.description || intent.action || "执行操作",
        description: `即将执行 ${intent.type} 操作`,
        details: [
          `操作类型：${intent.type}`,
          `具体动作：${intent.action || "未指定"}`,
          ...(intent.params ? [`参数：${JSON.stringify(intent.params)}`] : []),
        ],
        confirmToken,
        isHighRisk: intent.type.includes('delete') || intent.action?.includes('delete'),
      });

      await client.replyCard(messageId, card);
      return;
    }

    // 直接执行（安全操作）
    await executeCLIOperation(intent, messageId);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[cli] operation failed: ${errorMsg}`);
    await client.replyText(messageId, `操作失败：${errorMsg}`);
  }
}
```

### 步骤3：实现 executeCLIOperation

```typescript
async function executeCLIOperation(intent: IntentAnalysisResult, messageId: string): Promise<void> {
  if (!cliExecutor) return;

  let result;
  let formattedMessage = "";

  try {
    switch (intent.type) {
      case 'cli_calendar':
        result = await cliExecutor.getAgenda();
        formattedMessage = formatCalendarResult(result);
        break;

      case 'cli_contact':
        if (intent.params?.query) {
          result = await cliExecutor.searchUser(intent.params.query);
          formattedMessage = formatContactResult(result);
        }
        break;

      case 'cli_docs':
        if (intent.action === 'search' && intent.params?.query) {
          result = await cliExecutor.searchDocs(intent.params.query);
          formattedMessage = formatDocsResult(result);
        }
        break;

      case 'cli_approval':
        result = await cliExecutor.listApprovals();
        formattedMessage = formatApprovalResult(result);
        break;

      case 'cli_task':
        result = await cliExecutor.listTasks();
        formattedMessage = formatTaskResult(result);
        break;

      default:
        formattedMessage = "暂不支持该操作";
    }

    if (result?.success) {
      await client.replyText(messageId, formattedMessage || "操作成功");
    } else {
      await client.replyText(messageId, `操作失败：${result?.error || "未知错误"}`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await client.replyText(messageId, `执行出错：${errorMsg}`);
  }
}
```

### 步骤4：实现结果格式化函数

```typescript
function formatCalendarResult(result: any): string {
  if (!result?.success || !result.data) {
    return "📅 暂无日程安排";
  }

  // 根据实际返回的数据结构格式化
  const events = Array.isArray(result.data) ? result.data : result.data.items || [];
  
  if (events.length === 0) {
    return "📅 暂无日程安排";
  }

  const lines = events.map((event: any, index: number) => {
    const title = event.summary || event.title || "未命名事件";
    const time = event.start_time || event.start || "";
    return `${index + 1}. ${title}\n   ⏰ ${time}`;
  });

  return `📅 日程安排（${events.length}项）：\n\n${lines.join("\n\n")}`;
}

function formatContactResult(result: any): string {
  if (!result?.success || !result.data) {
    return "👤 未找到联系人";
  }

  const users = Array.isArray(result.data) ? result.data : result.data.items || [];
  
  if (users.length === 0) {
    return "👤 未找到联系人";
  }

  const lines = users.slice(0, 5).map((user: any) => {
    const name = user.name || "未知";
    const email = user.email || "";
    const mobile = user.mobile || "";
    const dept = user.department_name || "";
    
    let info = `👤 ${name}`;
    if (dept) info += ` - ${dept}`;
    if (email) info += `\n📧 ${email}`;
    if (mobile) info += `\n📱 ${mobile}`;
    
    return info;
  });

  return `找到 ${users.length} 个联系人：\n\n${lines.join("\n\n")}`;
}

function formatDocsResult(result: any): string {
  if (!result?.success || !result.data) {
    return "📄 未找到文档";
  }

  const docs = Array.isArray(result.data) ? result.data : result.data.items || [];
  
  if (docs.length === 0) {
    return "📄 未找到文档";
  }

  const lines = docs.slice(0, 5).map((doc: any, index: number) => {
    const title = doc.title || "未命名文档";
    const url = doc.url || "";
    return `${index + 1}. ${title}\n   🔗 ${url}`;
  });

  return `📄 找到 ${docs.length} 个文档：\n\n${lines.join("\n\n")}`;
}

function formatApprovalResult(result: any): string {
  if (!result?.success || !result.data) {
    return "✅ 暂无待审批";
  }

  const approvals = Array.isArray(result.data) ? result.data : result.data.items || [];
  
  if (approvals.length === 0) {
    return "✅ 暂无待审批";
  }

  const lines = approvals.slice(0, 5).map((approval: any, index: number) => {
    const title = approval.title || "未命名审批";
    const status = approval.status || "待审批";
    return `${index + 1}. ${title}\n   状态：${status}`;
  });

  return `✅ 待审批列表（${approvals.length}项）：\n\n${lines.join("\n\n")}`;
}

function formatTaskResult(result: any): string {
  if (!result?.success || !result.data) {
    return "🎯 暂无任务";
  }

  const tasks = Array.isArray(result.data) ? result.data : result.data.items || [];
  
  if (tasks.length === 0) {
    return "🎯 暂无任务";
  }

  const lines = tasks.slice(0, 5).map((task: any, index: number) => {
    const title = task.summary || task.title || "未命名任务";
    const due = task.due || "";
    return `${index + 1}. ${title}\n   截止：${due}`;
  });

  return `🎯 任务列表（${tasks.length}项）：\n\n${lines.join("\n\n")}`;
}
```

### 步骤5：处理CLI确认回调

在 `handleCardAction` 函数中添加：

```typescript
async function handleCardAction(envelope: FeishuEventEnvelope<FeishuCardActionEvent>): Promise<Response> {
  const value = envelope.event.action?.value;
  const action = value?.action;
  const token = typeof value?.confirm_token === "string" ? value.confirm_token : undefined;

  // ========== 新增：处理CLI确认 ==========
  if (action === "confirm_cli" && token) {
    const pending = pendingCLIOperations.get(token);
    if (!pending) {
      return jsonResponse({ toast: { type: "warning", content: "确认信息已过期" } });
    }

    pendingCLIOperations.delete(token);

    // 异步执行CLI操作
    void (async () => {
      try {
        await executeCLIOperation(pending.intent, pending.messageId);
      } catch (error) {
        console.error("[cli] execution failed:", error);
      }
    })();

    return jsonResponse({
      toast: { type: "success", content: "正在执行..." }
    });
  }

  if (action === "cancel_cli" && token) {
    pendingCLIOperations.delete(token);
    return jsonResponse({ toast: { type: "info", content: "已取消" } });
  }
  // ========== 新增结束 ==========

  // 原有的待办确认逻辑
  const result = await client.handleCardAction(envelope.event);
  return jsonResponse(result);
}
```

---

## 🧪 测试步骤

### 1. 基础测试
```bash
# 编译代码
npm run build

# 启动服务
npm run dev
```

### 2. 功能测试

**测试日历查询：**
```
用户：明天有什么安排？
预期：返回日历列表
```

**测试联系人搜索：**
```
用户：帮我找张三
预期：返回联系人信息
```

**测试确认流程：**
```
用户：创建一个会议
预期：显示确认卡片
```

### 3. 错误处理测试
- CLI未配置
- 权限不足
- 网络超时
- 无效参数

---

## 📝 注意事项

1. **渐进式实现**
   - 先实现日历查看（最简单）
   - 再实现联系人搜索
   - 最后实现复杂操作

2. **错误处理**
   - 所有CLI调用都要try-catch
   - 给用户友好的错误提示
   - 记录详细日志便于调试

3. **性能考虑**
   - CLI调用可能较慢，考虑超时处理
   - 大量数据要分页展示
   - 避免频繁调用

4. **安全性**
   - 重要操作必须确认
   - 验证用户权限
   - 防止命令注入

---

## 🚀 快速启动

如果想快速测试基础功能，可以先实现最简单的日历查看：

```typescript
// 在 handleMessageEvent 中添加简单判断
if (text.includes("日程") || text.includes("安排")) {
  if (cliExecutor) {
    const result = await cliExecutor.getAgenda();
    const message = result.success 
      ? `📅 ${JSON.stringify(result.data, null, 2)}`
      : `查询失败：${result.error}`;
    await client.replyText(message.message_id, message);
    return;
  }
}
```

这样可以先验证CLI执行器是否正常工作，然后再逐步完善。

---

## 📚 相关文档

- 《智能助手使用指南.md》- 用户使用说明
- 《多维表格字段配置.md》- 字段配置
- `src/lark-cli.ts` - CLI执行器实现
- `src/ai.ts` - AI意图识别

---

## 🎯 总结

完成以上步骤后，智能助手将能够：
- ✅ 自动识别用户意图
- ✅ 执行各种飞书操作
- ✅ 重要操作需要确认
- ✅ 友好的结果展示

祝开发顺利！🚀
