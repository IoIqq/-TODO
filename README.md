# 飞书 Todo 智能机器人

一个功能强大的飞书私聊机器人，帮你用自然语言快速创建待办任务，并自动写入飞书多维表格。支持 AI 增强解析、图片识别、智能优化等高级功能。

---

## 🚀 快速开始（3 步）

### 1️⃣ 双击启动
```
双击"一键启动.bat"
```

### 2️⃣ 复制地址
```
在"内网穿透"窗口复制公网地址
格式: https://xxx.trycloudflare.com
```

### 3️⃣ 配置飞书
```
访问 https://open.feishu.cn/
配置回调: https://你的地址/feishu/events
```

✅ **完成！现在可以在飞书中使用了**

💡 **详细说明请查看：[使用指南.txt](./使用指南.txt)**

---

## ✨ 核心功能

### 📝 基础功能
- **自然语言解析** - 直接说话创建待办，自动识别时间、优先级、备注
- **多任务批量创建** - 一次输入多个任务，用分号分隔
- **确认机制** - 先预览总结，确认后再写入多维表格
- **多维表格集成** - 自动写入飞书多维表格，支持自定义字段映射

### 🤖 AI 增强功能
- **📸 图片识别** - 发送截图自动提取任务信息（会议通知、聊天记录等）
- **🎯 智能优化** - 分析待办清单，提供优先级、时间冲突、任务分解建议
- **🧠 增强解析** - AI 辅助理解复杂的任务描述，提高准确率

### 🔧 技术特性
- **TypeScript** - 类型安全，易于维护
- **事件去重** - 防止重复处理飞书事件
- **加密支持** - 支持飞书消息加密推送
- **灵活配置** - 通过环境变量控制所有功能开关

---

## 🚀 快速开始

### 1. 环境要求

- Node.js 18+
- npm 或 yarn
- 飞书企业自建应用
- 飞书多维表格（用于存储任务）

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

复制 `.env.example` 为 `.env`，填写以下配置：

```env
# 飞书应用配置（必填）
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx
FEISHU_ENCRYPT_KEY=xxx

# 多维表格配置（必填）
FEISHU_BASE_TOKEN=HEAHbiuUFaQhE7siqzic9vjvnpf
FEISHU_BASE_TABLE_ID=tblXUkCfVMPg2hCv

# AI 配置（可选，启用 AI 功能需要）
OPENAI_API_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4o-mini
OPENAI_VISION_MODEL=  # 留空则使用 OPENAI_MODEL

# AI 功能开关（可选）
ENABLE_IMAGE_RECOGNITION=true      # 图片识别
ENABLE_TODO_OPTIMIZATION=true      # 智能优化
ENABLE_AI_PARSE=true               # AI 增强解析

# 快速模式（推荐手机端使用）
ENABLE_QUICK_MODE=false            # true=跳过确认直接写入

# 其他配置
PORT=3000
APP_TIMEZONE=Asia/Shanghai
```

### 4. 启动服务

**开发模式（热重载）：**
```bash
npm run dev
```

**生产模式：**
```bash
npm run build
npm start
```

**Windows 快捷启动：**
```powershell
.\start-dev.ps1
```

### 5. 配置飞书应用

1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用，获取凭据
3. 开启机器人能力
4. 订阅事件：
   - `im.message.receive_v1` - 接收消息
   - `card.action.trigger` - 卡片交互
5. 配置回调地址：
   - 事件订阅：`https://你的域名/feishu/events`
   - 卡片回调：`https://你的域名/feishu/events`
6. 开通权限：
   - `im:message` - 接收和发送消息
   - `bitable:app` - 多维表格读写

---

## 📖 使用指南

### 基础用法

直接私聊机器人，用自然语言描述任务：

```
明天 3 点提交周报 p1
```

```
下周一 处理客户反馈；整理方案 备注: 要附上截图
```

机器人会回复一个确认卡片，显示解析结果。点击 **"确认写入"** 后，任务会自动写入多维表格。

### 支持的时间格式

- **相对时间**：明天、后天、下周一、下个月
- **具体时间**：2026-06-01、6月1日、15:00
- **组合表达**：明天下午3点、下周一上午

### 优先级标记

- `p1` / `高` / `紧急` → 高优先级
- `p2` / `中` / `普通` → 中优先级  
- `p3` / `低` → 低优先级

### 备注信息

使用 `备注:`、`注意:`、`说明:` 等关键词添加备注：

```
完成项目方案 备注: 需要附上数据分析和截图
```

### 批量创建

用分号 `;` 分隔多个任务：

```
明天 3点 提交周报 p1；整理方案；下周一 客户会议
```

---

## 🤖 AI 功能使用

### 📸 图片识别

**使用方法：** 直接发送图片给机器人

**支持场景：**
- 会议通知截图
- 聊天记录截图
- 文档/笔记截图
- 任务清单截图

**示例：**
```
[发送会议通知截图]

机器人回复：
🔍 正在识别图片中的任务信息...

✅ 已从图片中识别并创建 2 个任务：
1. 产品评审会 - 2026-05-28 14:00
2. 准备评审材料 - 2026-05-28 13:00
```

### 🎯 智能优化

**使用方法：** 发送以下命令之一

```
优化
优化任务
优化待办
整理任务
optimize
```

**功能：**
- ⚡ 优先级合理性分析
- ⏰ 时间冲突检测
- 🔨 任务分解建议
- 🔗 任务合并建议
- ⏱️ 完成时间预估
- 📊 工作负荷评估

**示例：**
```
用户：优化

机器人：
🤔 正在分析你的待办清单...

⚠️ 发现 3 个优化建议：

1. 🔴 时间冲突
   "客户会议"(14:00) 和 "团队周会"(14:30) 时间重叠
   💡 建议将团队周会改到 16:00

2. 🟡 优先级
   "提交周报"截止今天 18:00，建议改为高优先级

3. 🟢 任务分解
   "完成项目方案"任务较大，建议拆分为：
   - 收集需求
   - 撰写初稿
   - 内部评审
```

### 🧠 AI 增强解析

**自动启用**，无需特殊命令。当遇到复杂或歧义的任务描述时，AI 会自动介入提高准确率。

**改进点：**
- 更准确的时间理解
- 自动识别优先级关键词
- 智能提取备注信息
- 理解复杂的任务描述

---

## 📁 项目结构

```
.
├── src/
│   ├── app.ts          # 主应用逻辑和事件路由
│   ├── feishu.ts       # 飞书 API 封装
│   ├── ai.ts           # AI 客户端和提示词
│   ├── parser.ts       # 自然语言解析
│   ├── cards.ts        # 飞书卡片生成
│   ├── config.ts       # 配置管理
│   ├── types.ts        # TypeScript 类型定义
│   └── index.ts        # 服务入口
├── test/               # 单元测试
├── .env.example        # 环境变量模板
├── README.md           # 本文件
├── AI_FEATURES.md      # AI 功能详细文档
├── QUICK_START.md      # 快速开始指南
├── DEPLOYMENT.md       # 部署指南
└── 配置飞书回调.md     # 飞书回调配置指南
```

---

## 🧪 测试

运行单元测试：

```bash
npm test
```

测试覆盖：
- 事件处理逻辑
- 自然语言解析
- 飞书 API 调用
- 卡片生成

---

## 📦 部署

### 本地开发

使用内网穿透工具（ngrok、localtunnel、Cloudflare Tunnel）将本地服务暴露到公网。

详见：[配置飞书回调.md](./配置飞书回调.md)

### 生产部署

支持多种部署方式：

1. **云服务器**（阿里云、腾讯云等）
2. **容器化部署**（Docker、K8s）
3. **Serverless 平台**（Vercel、Railway 等）

详见：[DEPLOYMENT.md](./DEPLOYMENT.md)

---

## 🔧 高级配置

### 自定义多维表格字段

编辑 `src/feishu.ts` 中的字段映射：

```typescript
const fields = {
  "待办事项": task.title,
  "截止日期": task.due?.timestamp,
  "优先级": task.priority,
  "执行人": task.assigneeOpenId,
  // 添加更多自定义字段
};
```

### 自定义 AI 提示词

编辑 `src/ai.ts` 中的提示词模板：

```typescript
const TASK_PARSE_PROMPT = `
你是一个任务解析助手...
[自定义你的提示词]
`;
```

### 集成其他 AI 服务

支持任何 OpenAI 兼容的 API：

- **Ollama**: `http://localhost:11434/v1`
- **LM Studio**: `http://localhost:1234/v1`
- **Azure OpenAI**: `https://your-resource.openai.azure.com/`
- **自定义部署**: 任何兼容接口

---

## 📚 文档

- [AI_FEATURES.md](./AI_FEATURES.md) - AI 功能详细使用指南
- [QUICK_START.md](./QUICK_START.md) - 快速开始指南
- [DEPLOYMENT.md](./DEPLOYMENT.md) - 生产环境部署指南
- [配置飞书回调.md](./配置飞书回调.md) - 飞书回调配置步骤

---

## 🛠️ 开发命令

```bash
npm run dev          # 开发模式（热重载）
npm run build        # 编译 TypeScript
npm start            # 生产模式启动
npm test             # 运行测试
npm run check-env    # 检查环境配置
```

---

## 🐛 故障排查

### 机器人不响应

1. 检查服务是否运行：`curl http://localhost:3000/health`
2. 检查飞书回调地址配置是否正确
3. 查看服务日志排查错误
4. 确认飞书应用权限已开通

### 任务创建失败

1. 确认 `FEISHU_BASE_TOKEN` 和 `FEISHU_BASE_TABLE_ID` 正确
2. 确认应用有多维表格读写权限
3. 检查多维表格字段名称是否匹配

### AI 功能不工作

1. 确认 `OPENAI_API_KEY` 配置正确
2. 确认对应功能开关已启用
3. 检查 API 配额是否充足
4. 查看日志获取详细错误信息

---

## 💡 最佳实践

1. **任务描述清晰** - 包含明确的时间、优先级信息
2. **定期优化** - 每天早上使用"优化"命令整理任务
3. **善用图片识别** - 会议通知、聊天记录直接截图发送
4. **批量创建** - 多个任务用分号分隔，一次性创建
5. **确认后再写入** - 仔细检查确认卡片，避免错误

---

## 🔐 安全建议

1. **保护敏感信息**
   - 不要将 `.env` 文件提交到 Git
   - 定期轮换 API 密钥
   - 使用环境变量管理凭据

2. **图片隐私**
   - 图片会发送到 AI API 分析
   - 避免上传包含敏感信息的截图
   - 了解 API 提供商的数据政策

3. **访问控制**
   - 仅授权必要的飞书权限
   - 定期审查应用权限
   - 监控异常访问

---

## 📊 性能指标

- **响应时间**
  - 文本解析：~1-2秒
  - 图片识别：~3-5秒
  - 智能优化：~2-4秒

- **并发支持**
  - 单实例可处理 100+ 并发请求
  - 支持水平扩展

---

## 🎯 路线图

- [ ] 支持语音输入
- [ ] 任务提醒功能
- [ ] 周报/月报自动生成
- [ ] 团队协作功能
- [ ] 移动端优化
- [ ] 更多 AI 模型支持

---

## 📄 许可证

MIT License

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📞 支持

如有问题或建议：

1. 查看文档：[AI_FEATURES.md](./AI_FEATURES.md)、[DEPLOYMENT.md](./DEPLOYMENT.md)
2. 检查日志：`npm run dev` 查看实时日志
3. 测试配置：`npm run check-env` 验证环境变量
4. 提交 Issue：在 GitHub 上报告问题

---

## 🎉 致谢

感谢飞书开放平台提供的强大 API 支持！
