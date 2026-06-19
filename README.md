# 飞书智能 Todo 助手

一个驻守在飞书里的私人助理：自然语言聊天 → AI Agent 自动调度工具 → 写入多维表格、查日程、找文档、回审批，每天 08:30 / 18:30 自动汇总待办。

> 当前 Git 仓库：https://github.com/IoIqq/-TODO

---

## 📑 目录

- [快速上手](#快速上手)
- [功能一览](#功能一览)
- [配置项](#配置项)
- [使用方式](#使用方式)
- [每日定时提醒](#每日定时提醒)
- [截止时间提醒](#截止时间提醒)
- [项目结构](#项目结构)
- [开发与部署](#开发与部署)
- [故障排查](#故障排查)

---

## 快速上手

### 环境要求
- Node.js 18+
- 一个飞书企业自建应用
- 一份飞书多维表格（已有：`HEAHbiuUFaQhE7siqzic9vjvnpf` / `tblXUkCfVMPg2hCv`）

### 三步启动
```powershell
# 1. 装依赖
npm install

# 2. 配置 .env（复制 .env.example 改）
copy .env.example .env

# 3. 启动
.\快速启动.bat
```

启动后看到这两行表示就绪：
```
[scheduler] Daily reminder started ...
Feishu Todo bot listening on http://localhost:17234
```

### 飞书侧配置（一次性）
1. 去 [飞书开放平台](https://open.feishu.cn/) 创建企业自建应用
2. 开启事件订阅：`im.message.receive_v1` + `card.action.trigger`
3. 配置回调地址：`https://你的内网穿透地址/feishu/events`
4. 申请权限：`im:message`、`bitable:app`、`contact:user.base:readonly` 等

---

## 功能一览

### 💬 智能对话（AI Agent）
直接在飞书私聊里说话即可。Agent 会自动选择并多轮调用工具：

| 你说 | Agent 做的事 |
|-----|-------------|
| "明天 3 点提交周报 p1" | 调 `create_todo` 工具创建待办 |
| "我有什么待办" | 调 `list_todos` 列出未完成任务 |
| "把买菜标记完成" | 调 `complete_todo` 模糊匹配并完成 |
| "记一下：我喜欢深色主题" | 调 `save_memory` 存进长期记忆 |
| "明天日程是什么" | 调 `view_calendar` 查日历 |
| "找张三" | 调 `search_contact` 找联系人 |
| "查找项目方案文档" | 调 `search_docs` 搜文档 |

工具集（共 11 个）：
- 待办 4 个：`list_todos / create_todo / complete_todo / delete_todo`
- 记忆 3 个：`save_memory / recall_memory / list_memories`
- 飞书 4 个：`view_calendar / search_contact / search_docs / list_approvals`

### 📋 自然语言解析（不依赖 AI）
即使没配 OpenAI，也能识别基础时间和优先级：

```
明天 3 点提交周报 p1；整理方案 备注: 带截图
```
↓
解析为 2 条待办，第一条 `明天15:00 截止 / 高优先级`，第二条 `备注: 带截图`。

支持：
- 时间：明天、后天、下周一、下个月、2026-06-01、15:00
- 优先级：`p1/p2/p3` 或 `高/中/低`
- 备注：`备注:`、`注意:`、`说明:`
- 批量：用分号 `;` 或换行分隔

### ⏰ 每日定时提醒
- 08:30 早安卡片：列出今日 + 逾期 + 后续
- 18:30 晚间卡片：检查今天的进度
- 按"执行人"分组发送，每人一张
- 卡片自带「✅完成 / ⏰延期」按钮

详见 [每日定时提醒](#每日定时提醒) 章节。

### 🎨 卡片交互
确认创建、完成任务、延期、删除全部支持卡片按钮，无需打字。

### 📦 快捷命令（兜底）
不想跟 AI 聊也可以打命令：

| 命令 | 作用 |
|-----|------|
| `/帮助` | 显示所有命令 |
| `/待办` | 列出待办 |
| `/日程` | 查今日日程 |
| `/找 张三` | 搜联系人 |
| `/文档 项目方案` | 搜文档 |
| `/审批` | 待审批列表 |
| `/任务` | 任务列表 |
| `/历史 10` | 最近 10 次操作记录 |
| `/重复` | 重复上次操作 |
| `/缓存` | 缓存统计 |
| `/清除缓存 [类型]` | 清缓存 |

### 🧠 长期记忆
跨会话记住用户偏好。存在本地 SQLite (`./data/feishu-bot.db`)。

---

## 配置项

完整配置见 `.env.example`。**最小可运行配置**只需 5 项：

```env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx
FEISHU_BASE_TOKEN=HEAHbiuUFaQhE7siqzic9vjvnpf
FEISHU_BASE_TABLE_ID=tblXUkCfVMPg2hCv
```

### 主要开关

| 变量 | 默认 | 说明 |
|-----|------|-----|
| `PORT` | 17234 | 服务端口 |
| `APP_TIMEZONE` | Asia/Shanghai | 时区 |
| `OPENAI_API_KEY` | 无 | 不填则禁用 AI |
| `OPENAI_API_BASE_URL` | api.openai.com | 兼容 Ollama / LM Studio / 自建网关 |
| `OPENAI_MODEL` | gpt-4.1-mini | 推荐 4o-mini 或同档 |
| `ENABLE_AGENT` | true | Agent 模式 |
| `ENABLE_QUICK_MODE` | false | true=跳过确认直接写入 |
| `ENABLE_DAILY_REMINDER` | true | 每日定时提醒 |
| `DAILY_MORNING_CRON` | `30 8 * * *` | 早晨 cron |
| `DAILY_EVENING_CRON` | `30 18 * * *` | 晚间 cron |
| `ENABLE_CHAT_MEMORY` | false | 对话历史落库到飞书表 |
| `ENABLE_SMART_ASSISTANT` | false | 启用 lark-cli 调用日历/审批等 |

### 多维表格字段

主任务表至少需要这些字段（飞书自动建议字段名一致即可，缺字段会自动忽略）：

| 字段 | 类型 | 必需 |
|-----|-----|-----|
| 待办事项 | 文本 | ✅ |
| 截止日期 | 日期 | 推荐 |
| 优先级 | 单选（🔴P0-高优 / 🟡P1-一般 / 🟢P2-低优） | 推荐 |
| 是否已完成 | 复选框 | ✅ |
| 执行人 | 人员 | 收提醒必需 |
| 备注 | 文本 | 可选 |

---

## 使用方式

### 方式 1：和 Agent 自然聊天（推荐）
```
你：明天三点产品评审，把会议记录张三也加进来
Bot：好的，已为你创建：
     📋 产品评审 · 明天 15:00 · 张三
```

### 方式 2：批量创建
```
你：明天 3 点提交周报 p1；整理方案；下周一 客户会议
```

### 方式 3：发图（需要 Vision 模型）
直接把会议通知截图甩给 Bot，自动 OCR 提取任务。

### 方式 4：查询 + 操作
```
你：我有哪些待办
Bot：[卡片 - 列出 6 项，每项带 完成/延期/删除 按钮]
```

---

## 每日定时提醒

### 工作原理
服务启动时挂载两个 cron：
- `30 8 * * *` (08:30) → 早晨提醒
- `30 18 * * *` (18:30) → 晚间提醒

到点时：
1. 拉取所有未完成待办
2. 按"执行人"分组（**没填执行人的跳过**）
3. 给每位执行人发一张分组卡片：⚠️逾期 / 📌今日 / 📅后续 / 📝无截止
4. 排序：逾期最久的最前

### 立即测试
```
http://localhost:17234/admin/test-reminder?slot=morning
http://localhost:17234/admin/test-reminder?slot=evening
```
浏览器或 curl 都行，不用等到点。

### 改时间
编辑 `.env`：
```env
DAILY_MORNING_CRON=30 8 * * *    # 分 时 日 月 星期
DAILY_EVENING_CRON=30 18 * * *
```

### ⚠️ 注意
- 服务必须在线才会触发，关机/关服务的时间点**不会补发**
- 长期可靠运行建议部署到云服务器（见 `deploy-template/`）
- 或改用飞书多维表格自动化（详见仓库历史 commit 中的指南）

## 截止时间提醒

飞书多维表格是唯一事实源；本地 SQLite 只保存可重建的截止提醒投影。创建、延期、完成、删除和每小时对账都会修正本地提醒表。

### 规则
- 具体时间任务：到达截止时间的瞬间即逾期。
- 全天任务：按 `APP_TIMEZONE` 当天 23:59 作为截止瞬间。
- P0：截止前 60 分钟提醒；逾期提醒总共 3 次，包含截止时刻那一次（sequence 0/1/2），后续每 10 分钟一次。
- P1：截止前 30 分钟提醒；逾期提醒总共 3 次，后续每 4 小时一次。
- P2：不做提前提醒，只在截止时刻提醒一次。
- 同一轮同一用户同类提醒超过 10 条时会拆成多张卡片，只把实际发送成功的提醒标记为已发送。

### 对账
- 服务启动后每小时从飞书表格拉取未完成、有截止时间、有执行人的记录，对本地 `deadline_reminders` 投影做重建/取消。
- 用户直接在飞书表格里完成、删除、改期或换执行人，下一次对账会自动修正本地 pending/processing 提醒。
- 已发送过的逾期 sequence 会保留，不会因为对账从 sequence 0 重新提醒。

### Admin 调试接口
请求都需要 `Authorization: Bearer <ADMIN_TOKEN>`。

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:17234/admin/diag?ping=false
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:17234/admin/test-deadline-reminder
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:17234/admin/reconcile-deadline-reminders
```

`/admin/diag` 会返回本地截止提醒指标：pending、processing、sent、cancelled、当前 overdue 数、最近运行时间、最近错误和最近对账结果。

---

### 部署遇到 `better-sqlite3` 报错怎么办？
如果服务器日志出现类似下面的错误：

```text
ERR_MODULE_NOT_FOUND: Cannot find package 'better-sqlite3'
```

请按这个顺序处理：

1. 确认是在**解压后的部署目录**里执行命令
2. 安装生产依赖：
   ```powershell
   npm install --omit=dev
   ```
3. 如果仍然报原生模块问题，再重建：
   ```powershell
   npm rebuild better-sqlite3 --build-from-source
   ```
4. 确保 Windows Server 上已安装 Node.js LTS；若需要从源码编译，需安装 Visual Studio Build Tools

当前的 `deploy-template/install-service.ps1` 已经会自动执行以上检查和安装步骤。

---

## 项目结构

```
.
├── src/
│   ├── index.ts                  # 服务入口（启动 cron + http）
│   ├── app.ts                    # 路由 / 事件分发
│   ├── feishu.ts                 # 飞书 API 封装
│   ├── ai.ts                     # AI 入口（意图分析 / 闲聊）
│   ├── parser.ts                 # 自然语言解析（不依赖 AI）
│   ├── cards.ts                  # 飞书卡片模板
│   ├── lark-cli.ts               # lark-cli 调用（日历/审批等）
│   ├── config.ts / types.ts / time.ts / openai.ts
│   ├── agent/                    # AI Agent（多轮工具调用）
│   │   ├── agent.ts
│   │   ├── prompt.ts
│   │   └── tools/                # 工具集（todo / memory / lark）
│   ├── ai/                       # AI Provider 抽象（OpenAI 兼容）
│   ├── scheduler/                # 每日提醒 / 截止提醒 / 对账
│   │   ├── daily-reminder.ts
│   │   ├── deadline-reminder.ts
│   │   └── time-utils.ts
│   ├── storage/                  # SQLite（对话/记忆/操作日志/提醒投影）
│   ├── formatters/               # 结果格式化
│   └── history/                  # 操作历史
├── test/                         # 单元测试
├── deploy-template/              # 云服务器部署模板（Windows Service）
├── data/                         # 运行时 SQLite 数据库
├── .env.example                  # 配置模板
├── 快速启动.bat / 停止服务.bat   # Windows 启动脚本
├── package.json / tsconfig.json
└── README.md
```

---

## 开发与部署

### 开发命令
```bash
npm run dev        # 热重载开发模式
npm run build      # 编译 TS 到 dist/
npm start          # 生产模式（先 build）
npm test           # 单元测试
npm run check-env  # 环境变量自检
```

### 本地开发 + 内网穿透
飞书需要公网回调地址。本地开发可用：
- **Cloudflare Tunnel**（免费、稳定）：`cloudflared tunnel --url http://localhost:17234`
- **ngrok**：`ngrok http 17234`
- **frp / 自建反代**

把 `https://xxx.trycloudflare.com/feishu/events` 配到飞书后台即可。

### 云服务器部署
`deploy-template/` 里有完整的 Windows 服务部署方案：
- `install-service.ps1` 装成 Windows Service
- `start.ps1` / `uninstall-service.ps1` 启停
- `README-DEPLOY.md` / `README-ECS-DEPLOY.md` 阿里云 ECS 部署文档
- 配合 `Caddyfile.example` 做反向代理 + HTTPS

---

## 故障排查

### Bot 完全不回应
1. 服务起来了吗：`curl http://localhost:17234/health`
2. 飞书后台回调地址正确？走的是 `https`？
3. 看日志有没有 `[feishu] message event ...`

### 待办创建失败
1. `FEISHU_BASE_TOKEN` / `FEISHU_BASE_TABLE_ID` 对不对
2. App 是否有 `bitable:app` 权限
3. 字段名跟表格里完全一致？空格、大小写都要对

### AI 不工作
1. `OPENAI_API_KEY` 填了？
2. `OPENAI_API_BASE_URL` 能 ping 通吗
3. 看日志的 `[ai]` `[agent]` 行排错

### 定时提醒没收到
1. 服务一直在线吗？关机的时间不会补发
2. 浏览器访问 `/admin/test-reminder?slot=morning` 立即触发一次试试
3. 表格记录里"执行人"字段填了吗？没填就跳过

---

## License

MIT
