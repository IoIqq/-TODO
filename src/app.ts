import crypto from "node:crypto";
import { AIClient, buildTodoConfirmSummary, type TodoParseItem, type IntentAnalysisResult } from "./ai.js";
import { parseTodoDrafts, hasAmbiguousFields } from "./parser.js";
import type { AppConfig } from "./config.js";
import type { FeishuCardActionEvent, FeishuEventEnvelope, FeishuMessageReceiveEvent } from "./types.js";
import { FeishuClient } from "./feishu.js";
import { buildTaskListCard, type TaskListItem, buildCLIConfirmCard } from "./cards.js";
import { LarkCLIExecutor } from "./lark-cli.js";
import {
  formatCalendarResult,
  formatContactResult,
  formatDocsResult,
  formatApprovalResult,
  formatTaskResult,
} from "./formatters/index.js";
import { OperationHistory } from "./history/operation-history.js";
import { Agent } from "./agent/agent.js";
import { ConversationStore } from "./storage/index.js";
import type { DailyReminderScheduler } from "./scheduler/daily-reminder.js";

export interface TodoBotDependencies {
  fetchImpl?: typeof fetch;
  reminderScheduler?: DailyReminderScheduler;
}

export interface TodoBotApp {
  handler: (request: Request) => Promise<Response>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function parseMessageText(event: FeishuMessageReceiveEvent): string {
  const content = event.message?.content;
  if (!content) {
    return "";
  }

  try {
    const parsed = JSON.parse(content) as { text?: string };
    return parsed.text?.trim() ?? "";
  } catch {
    return "";
  }
}

function decryptIfNeeded(body: unknown, config: AppConfig): unknown {
  if (!body || typeof body !== "object") {
    return body;
  }

  const envelope = body as Record<string, unknown>;
  if (typeof envelope.encrypt !== "string") {
    return body;
  }

  if (!config.feishuEncryptKey) {
    throw new Error("Received encrypted payload but FEISHU_ENCRYPT_KEY is not set");
  }

  const encryptedBuffer = Buffer.from(envelope.encrypt, "base64");
  const key = crypto.createHash("sha256").update(config.feishuEncryptKey).digest();
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, encryptedBuffer.subarray(0, 16));
  let decrypted = decipher.update(encryptedBuffer.subarray(16), undefined, "utf8");
  decrypted += decipher.final("utf8");
  return JSON.parse(decrypted) as unknown;
}

function validateEnvelope(config: AppConfig, envelope: FeishuEventEnvelope<unknown>): void {
  const token = envelope.header?.token ?? envelope.token;
  if (token && token !== config.feishuVerificationToken) {
    throw new Error("Invalid verification token");
  }
}

const SEEN_EVENTS_MAX = 1000;

// 系统命令类型
type SystemCommand = 
  | { type: 'history'; limit?: number }
  | { type: 'repeat' }
  | { type: 'cache_stats' }
  | { type: 'cache_clear'; cacheType?: 'calendar' | 'contact' | 'docs' | 'approval' | 'task' }
  | { type: 'help' };

// 快捷命令结果
type ShortcutResult = 
  | { kind: 'query' }
  | { kind: 'cli'; intent: IntentAnalysisResult }
  | { kind: 'system'; command: SystemCommand };

export function createTodoBotApp(config: AppConfig, deps: TodoBotDependencies = {}): TodoBotApp {
  const client = new FeishuClient(config, deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {});
  const aiClient = new AIClient(config);
  const cliExecutor = config.enableSmartAssistant ? new LarkCLIExecutor(config) : null;
  const operationHistory = new OperationHistory(20);
  const seenEvents = new Set<string>();
  const pendingCLIOperations = new Map<string, { intent: IntentAnalysisResult; messageId: string; userId?: string }>();
  
  // Agent（智能体）
  const agent = new Agent(config, client, cliExecutor);
  const enableAgent = (process.env.ENABLE_AGENT?.toLowerCase() ?? "true") !== "false";
  console.log(`[app] Agent ${agent.isAvailable() && enableAgent ? "enabled" : "disabled"} (available=${agent.isAvailable()}, configured=${enableAgent})`);

  function rememberEvent(eventId: string): void {
    seenEvents.add(eventId);
    if (seenEvents.size > SEEN_EVENTS_MAX) {
      const overflow = seenEvents.size - SEEN_EVENTS_MAX;
      const iterator = seenEvents.values();
      for (let i = 0; i < overflow; i += 1) {
        const next = iterator.next();
        if (next.done) break;
        seenEvents.delete(next.value);
      }
    }
  }

  /**
   * 解析快捷命令
   */
  function parseShortcutCommand(text: string): ShortcutResult | null {
    const trimmed = text.trim();
    const lower = trimmed.toLowerCase();
    
    // 系统命令
    if (lower === '/历史' || lower === '/history' || lower.startsWith('/历史 ') || lower.startsWith('/history ')) {
      const parts = trimmed.split(/\s+/);
      const limitStr = parts[1];
      const limit = limitStr ? parseInt(limitStr, 10) : undefined;
      return { kind: 'system', command: { type: 'history', ...(limit && !isNaN(limit) ? { limit } : {}) } };
    }
    
    if (lower === '/重复' || lower === '/repeat') {
      return { kind: 'system', command: { type: 'repeat' } };
    }
    
    if (lower === '/缓存' || lower === '/cache') {
      return { kind: 'system', command: { type: 'cache_stats' } };
    }
    
    if (lower === '/清除缓存' || lower === '/clear' || lower === '/clear-cache') {
      return { kind: 'system', command: { type: 'cache_clear' } };
    }
    
    // 选择性清除缓存
    const clearTypeMatch = lower.match(/^\/(清除缓存|clear|clear-cache)\s+(calendar|contact|docs|approval|task|日历|联系人|文档|审批|任务)$/);
    if (clearTypeMatch && clearTypeMatch[2]) {
      const typeMap: Record<string, 'calendar' | 'contact' | 'docs' | 'approval' | 'task'> = {
        '日历': 'calendar', 'calendar': 'calendar',
        '联系人': 'contact', 'contact': 'contact',
        '文档': 'docs', 'docs': 'docs',
        '审批': 'approval', 'approval': 'approval',
        '任务': 'task', 'task': 'task',
      };
      const cacheType = typeMap[clearTypeMatch[2]];
      if (cacheType) {
        return { kind: 'system', command: { type: 'cache_clear', cacheType } };
      }
    }

    if (lower === '/帮助' || lower === '/help') {
      return { kind: 'system', command: { type: 'help' } };
    }

    // CLI 快捷命令
    const cliShortcuts: Record<string, IntentAnalysisResult> = {
      '/日程': { type: 'cli_calendar', confidence: 1.0, action: 'view_agenda', description: '查看日程' },
      '/agenda': { type: 'cli_calendar', confidence: 1.0, action: 'view_agenda', description: '查看日程' },
      '/审批': { type: 'cli_approval', confidence: 1.0, action: 'list_approvals', description: '查看待审批' },
      '/approval': { type: 'cli_approval', confidence: 1.0, action: 'list_approvals', description: '查看待审批' },
      '/任务': { type: 'cli_task', confidence: 1.0, action: 'list_tasks', description: '查看任务列表' },
      '/task': { type: 'cli_task', confidence: 1.0, action: 'list_tasks', description: '查看任务列表' },
    };

    if (cliShortcuts[lower]) {
      return { kind: 'cli', intent: cliShortcuts[lower] };
    }

    // 待办查询
    if (lower === '/待办' || lower === '/todo') {
      return { kind: 'query' };
    }

    // 联系人搜索
    if (lower.startsWith('/找 ') || lower.startsWith('/search ')) {
      const query = trimmed.split(/\s+/).slice(1).join(' ');
      if (query) {
        return {
          kind: 'cli',
          intent: {
            type: 'cli_contact',
            confidence: 1.0,
            action: 'search_user',
            description: `搜索联系人：${query}`,
            params: { query },
          },
        };
      }
    }

    // 文档搜索
    if (lower.startsWith('/文档 ') || lower.startsWith('/docs ')) {
      const query = trimmed.split(/\s+/).slice(1).join(' ');
      if (query) {
        return {
          kind: 'cli',
          intent: {
            type: 'cli_docs',
            confidence: 1.0,
            action: 'search_docs',
            description: `搜索文档：${query}`,
            params: { query },
          },
        };
      }
    }

    return null;
  }

  /**
   * 处理系统命令
   */
  async function handleSystemCommand(
    command: SystemCommand,
    messageId: string,
    userId: string | undefined,
  ): Promise<void> {
    if (!userId) {
      await client.replyText(messageId, "❌ 无法获取用户信息");
      return;
    }

    switch (command.type) {
      case 'history': {
        const limit = command.limit || 5;
        const historyText = operationHistory.formatHistory(userId, limit);
        const stats = operationHistory.getStats(userId);
        const statsText = `\n\n📊 统计：成功 ${stats.successful} | 失败 ${stats.failed}`;
        await client.replyText(messageId, historyText + statsText);
        break;
      }

      case 'repeat': {
        const lastOp = operationHistory.getLastRepeatableOperation(userId);
        if (!lastOp || !lastOp.intent) {
          await client.replyText(messageId, "❌ 没有可重复的操作");
          return;
        }
        await client.replyText(messageId, `🔄 正在重复执行：${lastOp.description}`);
        await handleCLIOperation(lastOp.intent, messageId, userId);
        break;
      }

      case 'cache_stats': {
        if (!cliExecutor) {
          await client.replyText(messageId, "❌ 智能助手未启用");
          return;
        }
        await client.replyText(messageId, cliExecutor.formatCacheStats());
        break;
      }

      case 'cache_clear': {
        if (!cliExecutor) {
          await client.replyText(messageId, "❌ 智能助手未启用");
          return;
        }
        if (command.cacheType) {
          const count = cliExecutor.clearCacheByType(command.cacheType);
          await client.replyText(messageId, `✅ 已清除 ${command.cacheType} 类型缓存（${count} 项）`);
        } else {
          cliExecutor.clearCache();
          await client.replyText(messageId, "✅ 已清除所有缓存");
        }
        break;
      }

      case 'help': {
        await client.replyText(messageId, getHelpMessage());
        break;
      }
    }
  }

  /**
   * 获取帮助信息
   */
  function getHelpMessage(): string {
    return `📚 **快捷命令帮助**

**📋 待办管理：**
• /待办 或 /todo - 查看待办列表

**📅 日程管理：**
• /日程 或 /agenda - 查看今日日程

**👥 联系人：**
• /找 <姓名> - 搜索联系人
  例如：/找 张三

**📄 文档：**
• /文档 <关键词> - 搜索文档
  例如：/文档 项目方案

**✅ 审批：**
• /审批 或 /approval - 查看待审批

**🎯 任务：**
• /任务 或 /task - 查看任务列表

**📝 操作历史：**
• /历史 [数量] - 查看操作历史
  例如：/历史 10
• /重复 或 /repeat - 重复上次操作

**💾 缓存管理：**
• /缓存 或 /cache - 查看缓存统计
• /清除缓存 [类型] - 清除缓存
  例如：/清除缓存 日历

**❓ 其他：**
• /帮助 或 /help - 显示此帮助

💡 **提示：** 也可以直接用自然语言，AI 会自动识别你的意图！`;
  }

  /**
   * Agent 模式：智能体处理消息（多轮工具调用）
   */
  async function handleAgent(text: string, messageId: string, userId: string): Promise<void> {
    try {
      console.log(`[agent] processing: "${text.substring(0, 50)}"`);
      const startTime = Date.now();

      // 思考过程推送给用户（可见）
      const thinkingMessages: string[] = [];
      let lastThinkingTime = 0;

      const result = await agent.run({
        userInput: text,
        userId,
        messageId,
        onThinking: async (thinkingText: string) => {
          thinkingMessages.push(thinkingText);
          // 防止刷屏：每 1.5 秒最多发一条
          const now = Date.now();
          if (now - lastThinkingTime > 1500) {
            try {
              await client.replyText(messageId, thinkingText);
              lastThinkingTime = now;
            } catch (error) {
              console.error("[agent] thinking notify failed:", error);
            }
          }
        },
      });

      const duration = Date.now() - startTime;
      console.log(`[agent] completed in ${duration}ms, ${result.steps} steps, ${result.toolCalls.length} tool calls`);

      // 最终回复
      await client.replyText(messageId, result.finalAnswer);

      // 保存助手回复到本地和飞书
      try {
        ConversationStore.save({
          userId,
          role: "assistant",
          content: result.finalAnswer,
          timestamp: Date.now(),
        });
        await client.saveChatMessage(userId, messageId, "assistant", result.finalAnswer);
      } catch (error) {
        console.error("[storage] failed to save assistant reply:", error);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error("[agent] failed:", errMsg);
      await client.replyText(messageId, `❌ Agent 出错：${errMsg.substring(0, 200)}`);
    }
  }

  /**
   * 智能聊天回复
   */
  async function handleChat(text: string, messageId: string, userId?: string): Promise<void> {
    try {
      console.log(`[chat] handling chat: "${text.substring(0, 50)}"`);
      
      // 获取最近对话历史用于上下文
      const chatHistory = userId 
        ? await client.getChatHistory(userId, Math.min(config.chatMemoryLength, 6)) 
        : [];

      const reply = await aiClient.chat({
        userInput: text,
        chatHistory,
      });

      if (reply) {
        await client.replyText(messageId, reply);
      } else {
        // AI 未启用或失败时给个基础回复
        await client.replyText(
          messageId,
          "我可以帮你管理待办、查日程、找联系人、查文档。\n试试发送：/帮助"
        );
      }
    } catch (error) {
      console.error("[chat] failed:", error);
      await client.replyText(messageId, "抱歉，刚才走神了，可以再说一次吗？");
    }
  }

  async function handleQueryCommand(text: string, messageId: string): Promise<void> {
    try {
      console.log(`[feishu] handling query command: ${text}`);
      
      const records = await client.listRecords({ pageSize: 100 });
      
      if (records.length === 0) {
        await client.replyText(messageId, "📋 暂无任务");
        return;
      }

      const tasks: TaskListItem[] = records.map((record) => ({
        recordId: record.record_id,
        title: String(record.fields["待办事项"] || "未命名任务"),
        dueDate: record.fields["截止日期"] ? String(record.fields["截止日期"]) : undefined,
        priority: String(record.fields["优先级"] || "普通"),
      }));

      await client.replyCard(messageId, buildTaskListCard({ tasks }));
      console.log(`[feishu] query command completed, returned ${records.length} tasks`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[feishu] query command failed: ${errorMsg}`);
      await client.replyText(messageId, "❌ 查询任务失败，请稍后重试");
    }
  }

  async function handleCLIOperation(
    intent: IntentAnalysisResult,
    messageId: string,
    userId?: string,
  ): Promise<void> {
    if (!cliExecutor) {
      await client.replyText(messageId, "❌ 智能助手功能未启用");
      return;
    }

    try {
      console.log(`[cli] handling operation: ${intent.type}, action: ${intent.action}`);

      const needsConfirmation = intent.requiresConfirmation || 
        cliExecutor.isConfirmationRequired(intent.type, intent.action);

      if (needsConfirmation) {
        const confirmToken = crypto.randomUUID();
        pendingCLIOperations.set(confirmToken, { intent, messageId, ...(userId ? { userId } : {}) });

        const isHighRisk = intent.type.includes('delete') || (intent.action?.includes('delete') ?? false);
        const card = buildCLIConfirmCard({
          operation: intent.description || intent.action || "执行操作",
          description: `即将执行 ${intent.type} 操作`,
          details: [
            `操作类型：${intent.type}`,
            `具体动作：${intent.action || "未指定"}`,
            ...(intent.params ? [`参数：${JSON.stringify(intent.params)}`] : []),
          ],
          confirmToken,
          ...(isHighRisk ? { isHighRisk: true } : {}),
        });

        await client.replyCard(messageId, card);
        return;
      }

      // 进度提示
      const needsProgressHint = ['cli_docs', 'cli_approval', 'cli_task'].includes(intent.type);
      if (needsProgressHint) {
        await client.replyText(messageId, "⏳ 正在处理，请稍候...");
      }

      await executeCLIOperation(intent, messageId, userId);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[cli] operation failed: ${errorMsg}`);
      await client.replyText(messageId, `❌ 操作失败：${errorMsg}`);
      
      // 记录失败
      if (userId) {
        operationHistory.record(userId, {
          type: 'cli',
          intent,
          description: intent.description || intent.action || '未知操作',
          success: false,
          canRepeat: true,
          canUndo: false,
        });
      }
    }
  }

  async function executeCLIOperation(
    intent: IntentAnalysisResult,
    messageId: string,
    userId?: string,
  ): Promise<void> {
    if (!cliExecutor) return;

    let success = false;
    let resultMessage = "";

    try {
      let result;
      let message = "";

      switch (intent.type) {
        case 'cli_calendar':
          result = await cliExecutor.getAgenda();
          if (result.success && result.data) {
            message = formatCalendarResult(result.data);
            if (result.retryCount && result.retryCount > 0) {
              message += `\n\n💡 提示：经过 ${result.retryCount} 次重试后成功`;
            }
            success = true;
          } else {
            message = result.error || "📅 暂无日程安排";
          }
          break;

        case 'cli_contact':
          if (intent.params?.query) {
            result = await cliExecutor.searchUser(String(intent.params.query));
            if (result.success && result.data) {
              message = formatContactResult(result.data);
              success = true;
            } else {
              message = result.error || "👤 未找到联系人";
            }
          } else {
            message = "❓ 请提供搜索关键词，例如：/找 张三";
          }
          break;

        case 'cli_docs':
          if (intent.params?.query) {
            result = await cliExecutor.searchDocs(String(intent.params.query));
            if (result.success && result.data) {
              message = formatDocsResult(result.data);
              success = true;
            } else {
              message = result.error || "📄 未找到文档";
            }
          } else {
            message = "❓ 请提供搜索关键词，例如：/文档 项目方案";
          }
          break;

        case 'cli_approval':
          result = await cliExecutor.listApprovals();
          if (result.success && result.data) {
            message = formatApprovalResult(result.data);
            success = true;
          } else {
            message = result.error || "✅ 暂无待审批";
          }
          break;

        case 'cli_task':
          result = await cliExecutor.listTasks();
          if (result.success && result.data) {
            message = formatTaskResult(result.data);
            success = true;
          } else {
            message = result.error || "🎯 暂无任务";
          }
          break;

        default:
          message = "❌ 暂不支持该操作";
      }

      resultMessage = message;
      await client.replyText(messageId, message);
      
      if (result?.executionTime) {
        console.log(`[cli] Operation completed in ${result.executionTime}ms`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[cli] execution failed: ${errorMsg}`);
      await client.replyText(messageId, `❌ 执行出错：${errorMsg}`);
      resultMessage = errorMsg;
      success = false;
    }

    // 记录操作历史
    if (userId) {
      operationHistory.record(userId, {
        type: 'cli',
        intent,
        description: intent.description || intent.action || '执行操作',
        success,
        canRepeat: true,
        canUndo: false,
      });
    }
  }

  async function handleMessageEvent(envelope: FeishuEventEnvelope<FeishuMessageReceiveEvent>): Promise<Response> {
    console.log(
      `[feishu] message event id=${envelope.header.event_id} type=${envelope.event.message?.message_type ?? "unknown"} message_id=${envelope.event.message?.message_id ?? "unknown"}`,
    );

    if (seenEvents.has(envelope.header.event_id)) {
      return jsonResponse({ ok: true, deduped: true });
    }
    rememberEvent(envelope.header.event_id);

    const message = envelope.event.message;
    if (!message) {
      return jsonResponse({ ok: true });
    }

    const text = parseMessageText(envelope.event);
    if (!text) {
      return jsonResponse({ ok: true });
    }

    void (async () => {
      try {
        const actorOpenId = envelope.event.sender?.sender_id?.open_id;
        
        // 保存用户消息到对话历史（飞书多维表格）
        if (actorOpenId) {
          await client.saveChatMessage(actorOpenId, message.message_id, "user", text);
          
          // 同时保存到本地 SQLite
          try {
            ConversationStore.save({
              userId: actorOpenId,
              messageId: message.message_id,
              role: "user",
              content: text,
              timestamp: Date.now(),
            });
          } catch (error) {
            console.error("[storage] failed to save conversation:", error);
          }
        }

        // 1. 优先处理快捷命令（精确匹配，最高优先级）
        const shortcut = parseShortcutCommand(text);
        if (shortcut) {
          if (shortcut.kind === 'system') {
            await handleSystemCommand(shortcut.command, message.message_id, actorOpenId);
            return;
          }
          if (shortcut.kind === 'query') {
            await handleQueryCommand(text, message.message_id);
            return;
          }
          if (shortcut.kind === 'cli' && cliExecutor && config.enableSmartAssistant) {
            await handleCLIOperation(shortcut.intent, message.message_id, actorOpenId);
            return;
          }
        }

        // 2. Agent 模式（推荐）
        if (enableAgent && agent.isAvailable() && actorOpenId) {
          await handleAgent(text, message.message_id, actorOpenId);
          return;
        }

        // ========== 以下是 Fallback：Agent 不可用时的旧路由 ==========

        // 2b. AI 智能意图识别
        const intent = await aiClient.analyzeIntent(text);
        console.log(`[router] intent=${intent.type} confidence=${intent.confidence} input="${text.substring(0, 30)}"`);

        // 高置信度才走 AI 路由（>=0.6），避免误判
        if (intent.confidence >= 0.6) {
          switch (intent.type) {
            case 'todo_query':
              await handleQueryCommand(text, message.message_id);
              return;

            case 'cli_calendar':
            case 'cli_contact':
            case 'cli_docs':
            case 'cli_approval':
            case 'cli_task':
            case 'cli_message':
              if (cliExecutor && config.enableSmartAssistant) {
                await handleCLIOperation(intent, message.message_id, actorOpenId);
                return;
              }
              break;

            case 'chat':
            case 'unknown': {
              await handleChat(text, message.message_id, actorOpenId);
              return;
            }

            case 'todo_create':
            case 'todo':
              break;

            case 'todo_complete':
              await handleChat(text, message.message_id, actorOpenId);
              return;
          }
        } else {
          console.log(`[router] low confidence, fallback to chat`);
          await handleChat(text, message.message_id, actorOpenId);
          return;
        }

        // 3. 待办创建流程
        const drafts = parseTodoDrafts(text, {
          timeZone: config.timezone,
          now: Date.now(),
          ...(actorOpenId ? { assigneeOpenId: actorOpenId } : {}),
        });

        // 强信号校验：parser 解析不出有效待办时不强制创建
        if (drafts.length === 0 || (drafts.length === 1 && drafts[0]!.title.trim().length < 2)) {
          console.log(`[router] no valid todo drafts, fallback to chat`);
          await handleChat(text, message.message_id, actorOpenId);
          return;
        }

        const chatHistory = actorOpenId ? await client.getChatHistory(actorOpenId, config.chatMemoryLength) : [];

        const refined = await aiClient.refineTodoDrafts({
          originalText: text,
          drafts,
          timeZone: config.timezone,
          now: Date.now(),
          chatHistory,
        });

        const finalDrafts: TodoParseItem[] = refined
          ? refined.map((item, index) => ({
              title: item.title,
              priority: item.priority,
              fallbackUsed: item.fallbackUsed,
              ...(item.due ? { due: item.due } : {}),
              ...(item.assigneeOpenId
                ? { assigneeOpenId: item.assigneeOpenId }
                : drafts[index]?.assigneeOpenId
                  ? { assigneeOpenId: drafts[index]!.assigneeOpenId }
                  : {}),
              ...(item.notes ? { notes: item.notes } : {}),
            }))
          : drafts.map((item) => ({
              title: item.title,
              priority: item.priority,
              fallbackUsed: item.fallbackUsed,
              ...(item.due ? { due: item.due } : {}),
              ...(item.assigneeOpenId ? { assigneeOpenId: item.assigneeOpenId } : {}),
              ...(item.notes ? { notes: item.notes } : {}),
            }));

        // 快速模式
        if (config.enableQuickMode) {
          console.log(`[feishu] quick mode enabled, creating ${finalDrafts.length} todos directly`);
          const results = await client.createTodoRecordsOneByOne({ items: finalDrafts });
          console.log(`[feishu] created ${results.length} todos for message_id=${message.message_id}`);
          
          const summary = buildTodoConfirmSummary(finalDrafts);
          const successMessage = `✅ 已创建 ${finalDrafts.length} 个待办\n\n${summary.lines.join("\n")}`;
          await client.replyText(message.message_id, successMessage);

          // 记录待办创建历史
          if (actorOpenId) {
            operationHistory.record(actorOpenId, {
              type: 'todo',
              description: `创建 ${finalDrafts.length} 个待办：${finalDrafts.map(d => d.title).join('、')}`,
              success: true,
              canRepeat: false,
              canUndo: true,
            });
          }
        } else {
          const summary = buildTodoConfirmSummary(finalDrafts);
          const confirmToken = client.createConfirmationToken();
          client.storePendingConfirmation(confirmToken, {
            drafts: finalDrafts,
          });

          if (hasAmbiguousFields(finalDrafts)) {
            summary.lines.push("有一些字段我没有完全确认，建议你点开后再核对一次。");
          }

          console.log(`[feishu] replying confirmation card for message_id=${message.message_id} items=${finalDrafts.length}`);
          await client.replyTodoConfirmation(message.message_id, summary, confirmToken, config.timezone);
          console.log(`[feishu] confirmation card sent for message_id=${message.message_id}`);
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : "";
        console.error(`[feishu] message handling failed for ${message.message_id}: ${messageText}`);
        if (stack) {
          console.error(`[feishu] stack trace:\n${stack}`);
        }
        try {
          // 在开发环境给用户更明确的错误提示
          const userMsg = `❌ 处理消息时出错：${messageText.substring(0, 200)}\n\n请稍后重试或联系管理员`;
          await client.replyText(message.message_id, userMsg);
        } catch (replyError) {
          console.error(
            `[feishu] fallback reply failed for ${message.message_id}: ${replyError instanceof Error ? replyError.message : String(replyError)}`,
          );
        }
      }
    })();

    return jsonResponse({ ok: true });
  }

  async function handleCardAction(envelope: FeishuEventEnvelope<FeishuCardActionEvent>): Promise<Response> {
    const value = envelope.event.action?.value;
    const action = value?.action;
    const token = typeof value?.confirm_token === "string" ? value.confirm_token : undefined;

    // CLI 确认
    if (action === "confirm_cli" && token) {
      const pending = pendingCLIOperations.get(token);
      if (!pending) {
        return jsonResponse({ toast: { type: "warning", content: "确认信息已过期" } });
      }

      pendingCLIOperations.delete(token);

      void (async () => {
        try {
          await executeCLIOperation(pending.intent, pending.messageId, pending.userId);
        } catch (error) {
          console.error("[cli] execution failed:", error);
          const errorMsg = error instanceof Error ? error.message : String(error);
          await client.replyText(pending.messageId, `❌ 执行失败：${errorMsg}`);
        }
      })();

      return jsonResponse({
        toast: { type: "success", content: "正在执行..." },
      });
    }

    if (action === "cancel_cli" && token) {
      pendingCLIOperations.delete(token);
      return jsonResponse({ toast: { type: "info", content: "已取消" } });
    }

    // 待办确认
    const result = await client.handleCardAction(envelope.event);
    return jsonResponse(result);
  }

  async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return textResponse("ok");
    }

    // 调试：手动触发一次提醒
    // GET /admin/test-reminder?slot=morning|evening
    if (request.method === "GET" && url.pathname === "/admin/test-reminder") {
      if (!deps.reminderScheduler) {
        return jsonResponse({ ok: false, error: "reminderScheduler not configured" }, 400);
      }
      const slotParam = url.searchParams.get("slot");
      const slot = slotParam === "evening" ? "evening" : "morning";
      const result = await deps.reminderScheduler.runOnce(slot);
      return jsonResponse({ ok: true, slot, ...result });
    }

    if (request.method !== "POST") {
      return textResponse("Method Not Allowed", 405);
    }

    if (url.pathname !== "/feishu/events") {
      return textResponse("Not Found", 404);
    }

    const raw = await request.json().catch(() => null);
    if (!raw) {
      return textResponse("Bad Request", 400);
    }

    let decrypted: unknown;
    try {
      decrypted = decryptIfNeeded(raw, config);
    } catch {
      return textResponse("Bad Request", 400);
    }
    if (!decrypted || typeof decrypted !== "object") {
      return textResponse("Bad Request", 400);
    }

    const envelope = decrypted as FeishuEventEnvelope<unknown>;
    if (typeof envelope.challenge === "string") {
      return jsonResponse({ challenge: envelope.challenge });
    }

    try {
      validateEnvelope(config, envelope);
    } catch {
      return textResponse("Unauthorized", 401);
    }

    switch (envelope.header?.event_type) {
      case "im.message.receive_v1":
        return handleMessageEvent(envelope as FeishuEventEnvelope<FeishuMessageReceiveEvent>);
      case "card.action.trigger":
        return handleCardAction(envelope as FeishuEventEnvelope<FeishuCardActionEvent>);
      default:
        return jsonResponse({ ok: true, ignored: envelope.header?.event_type });
    }
  }

  return { handler };
}
