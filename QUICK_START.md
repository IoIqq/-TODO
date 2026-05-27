# 飞书智能 Todo 助手 - 快速上手指南

## 🚀 5 分钟快速部署

### 第一步：飞书开放平台配置

1. 访问 [飞书开放平台](https://open.feishu.cn/)，创建企业自建应用
2. 记录以下信息：
   - **App ID**（形如 `cli_xxx`）
   - **App Secret**
   - **Verification Token**
   - **Encrypt Key**（可选，建议启用）

3. 开通权限（在"权限管理"页面）：
   ```
   im:message          接收消息
   im:message:send_as_bot  发送消息
   task:task           任务管理
   task:task:write     创建和更新任务
   task:tasklist:read  读取任务清单
   ```

4. 订阅事件（在"事件订阅"页面）：
   - `im.message.receive_v1` - 接收消息
   - `card.action.trigger` - 卡片交互

### 第二步：创建任务清单

1. 打开飞书客户端，进入"任务"应用
2. 创建一个新的任务清单，例如"个人待办"
3. 获取清单 GUID：
   - 方法 1：在浏览器中打开该清单，URL 中包含 `tasklist_guid=xxx`
   - 方法 2：通过飞书 API 调用 `/task/v2/tasklists` 获取

### 第三步：本地配置

1. 克隆或下载项目到本地
2. 安装依赖：
   ```bash
   npm install
   ```

3. 复制 `.env.example` 为 `.env`，填写配置：
   ```env
   PORT=3000
   APP_TIMEZONE=Asia/Shanghai
   FEISHU_APP_ID=cli_xxx
   FEISHU_APP_SECRET=你的_app_secret
   FEISHU_VERIFICATION_TOKEN=你的_verification_token
   FEISHU_ENCRYPT_KEY=你的_encrypt_key
   FEISHU_TASKLIST_GUID=你的_tasklist_guid
   OPENAI_API_KEY=sk-xxx  # 可选，用于智能解析
   OPENAI_MODEL=gpt-4o-mini
   ```

4. 启动服务：
   ```bash
   npm run dev
   ```

### 第四步：配置公网访问

**本地开发（推荐使用内网穿透）：**

使用任意内网穿透工具，例如：
- [ngrok](https://ngrok.com/)：`ngrok http 3000`
- [localtunnel](https://localtunnel.github.io/www/)：`lt --port 3000`
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)

获得公网地址后（例如 `https://abc123.ngrok.io`），在飞书开放平台配置：

1. **事件订阅请求地址**：`https://abc123.ngrok.io/feishu/events`
2. **卡片回调地址**：`https://abc123.ngrok.io/feishu/events`

**生产部署：**

可以部署到任意支持 Node.js 的平台：
- 云服务器（阿里云、腾讯云等）
- Serverless 平台（Vercel、Railway、Render 等）
- 容器平台（Docker、K8s）

参考 `Caddyfile.example` 配置反向代理。

### 第五步：测试

1. 在飞书中找到你的机器人
2. 发送测试消息：
   - `帮助` - 查看用法
   - `明天 3 点 提交周报 p1` - 创建待办
   - `今天待办` - 查询今天的任务

## 📝 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式启动（热重载） |
| `npm run build` | 编译 TypeScript |
| `npm start` | 生产模式启动（需先 build） |
| `npm test` | 运行测试 |

## 🎯 功能清单

- ✅ 自然语言创建待办（支持时间、优先级、备注）
- ✅ 查询今天 / 明天待办
- ✅ 卡片交互（完成、延期）
- ✅ 智能解析（可选 OpenAI 增强）
- ✅ 飞书 Task v2 集成
- ✅ 事件去重和内存管理
- ✅ 加密消息支持

## 🔧 故障排查

### 机器人没有响应

1. 检查服务是否正常运行：`curl http://localhost:3000/health`
2. 检查飞书后台事件订阅地址是否正确
3. 查看服务日志，确认是否收到事件

### 创建任务失败

1. 确认 `FEISHU_TASKLIST_GUID` 配置正确
2. 确认应用已开通 `task:task:write` 权限
3. 确认任务清单存在且可访问

### 时间解析不准确

1. 检查 `APP_TIMEZONE` 配置是否正确
2. 如果需要更智能的解析，配置 `OPENAI_API_KEY`

## 🌟 进阶配置

### 使用 OpenAI 增强解析

配置 `OPENAI_API_KEY` 后，机器人会在遇到歧义句时调用 GPT 模型进行兜底解析，提升准确率。

支持的模型：
- `gpt-4o-mini`（推荐，性价比高）
- `gpt-4o`
- `gpt-3.5-turbo`

### 生产环境部署建议

1. 使用 PM2 或 systemd 管理进程
2. 配置 Nginx/Caddy 反向代理
3. 启用 HTTPS
4. 配置日志收集和监控
5. 定期备份 `.env` 配置

示例 PM2 配置（`ecosystem.config.js` 已包含）：
```bash
npm install -g pm2
npm run build
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## 📚 更多文档

- [README.md](./README.md) - 完整项目说明
- [.env.example](./.env.example) - 环境变量模板
- [Caddyfile.example](./Caddyfile.example) - Caddy 反向代理配置

## 💡 提示

- 机器人支持私聊和群聊
- 创建的任务会自动分配给发送者
- 所有任务保存在飞书 Task v2 中，可在飞书客户端查看和管理
- 事件去重机制会保留最近 1000 条事件 ID，防止重复处理
