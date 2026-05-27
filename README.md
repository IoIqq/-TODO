# 飞书个人待办机器人 MVP

这是一个 `Node.js + TypeScript` 的飞书个人待办机器人，支持：

- 在飞书私聊或群聊里用自然语言新增待办
- 解析 `title / due / priority / notes`
- 调用飞书 Task v2 创建任务
- 查询今天待办
- 标记完成、延期一天
- 用飞书卡片返回确认结果

## 你需要先准备什么

### 飞书开放平台配置

在飞书开放平台创建一个自建应用，然后准备这些配置：

- `App ID`
- `App Secret`
- `Verification Token`
- `Encrypt Key`，可选但建议保留；如果你在后台开启了加密，这里就必须填写
- 开启机器人能力
- 开启事件订阅
- 配置事件订阅请求地址
- 配置卡片回调地址
- 开通消息相关权限
- 开通任务权限，至少包含 `task:task:write` 和 `task:tasklist:read`
- 订阅 `im.message.receive_v1`
- 订阅 `card.action.trigger`

### 任务清单准备

这个 MVP 使用你单独指定的一个任务清单作为存储源。你需要先在飞书里创建一个任务清单，然后把它的 `tasklist_guid` 填到环境变量里。

这样做的好处是：

- 不需要先做用户 OAuth 登录
- 任务仍然保存在飞书 Task v2 中
- `查询今天待办` 可以直接从这个清单里拉取数据

## 本地启动

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

把 [.env.example](C:\Users\Adm\Documents\New project 7\.env.example) 复制成 `.env`，内容示例：

```env
PORT=3000
APP_TIMEZONE=Asia/Shanghai
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx
FEISHU_ENCRYPT_KEY=xxx
FEISHU_TASKLIST_GUID=xxx
OPENAI_API_KEY=xxx
OPENAI_MODEL=gpt-4.1-mini
```

说明：

- `FEISHU_ENCRYPT_KEY` 如果你在飞书后台启用了加密推送，就必须填写
- `OPENAI_API_KEY` 可选。没有它也能跑，只是歧义句不会走模型兜底
- `FEISHU_TASKLIST_GUID` 必填

### 3. 启动服务

```bash
npm run dev
```

如果你在 Windows 上想省事，也可以直接运行：

```powershell
.\start-dev.ps1
```

健康检查：

```bash
GET http://localhost:3000/health
```

### 4. 配置隧道

如果你在本机调试，可以用任意公网隧道工具把 `localhost:3000` 暴露给飞书。

推荐把飞书后台里的两个地址都指向你的公网地址：

- 事件订阅地址：`https://你的公网域名/feishu/events`
- 卡片回调地址：`https://你的公网域名/feishu/events`

这个 MVP 把事件和卡片回调合并到同一个入口。

## 功能用法

### 新增待办

直接在飞书里发类似消息：

- `明天 3 点 提交周报 p1`
- `下周一 之前 交材料`
- `整理方案 备注: 要附上截图和链接`

机器人会自动：

- 抽取标题
- 识别截止时间
- 识别优先级
- 把备注写进任务描述
- 创建飞书任务
- 回复一个确认卡片

### 查询今天 / 明天待办

发送：

- `今天待办` / `今日待办`
- `明天待办` / `明日待办`

机器人会回复对应日期的任务列表。

### 查看帮助

发送 `帮助` / `help` / `?`，机器人会回复完整用法说明。

### 卡片按钮

创建成功后，卡片上会有：

- `完成`
- `延期一天`

点击后会直接更新飞书任务。

## 命令

```bash
npm run dev
npm run build
npm test
```

## 代码结构

- `src/app.ts` 事件路由和业务编排
- `src/feishu.ts` 飞书 API 封装
- `src/parser.ts` 自然语言解析
- `src/cards.ts` 飞书卡片生成
- `src/openai.ts` 模型兜底解析
- `src/time.ts` 时区和日期工具

## 备注

- 这个版本优先保证简单可用
- 没有引入本地数据库
- 先以飞书 Task v2 为唯一事实来源
- 后续如果你想做多维表格同步，可以在这个骨架上再加一层同步器
