# 飞书 Todo 机器人 - Windows ECS 部署指南

目标服务器：**121.43.118.153** (Windows ECS)

---

## 📦 部署包内容

- `dist/` - 编译后的 JavaScript 代码
- `package.json` / `package-lock.json` - 依赖配置
- `.env` - 环境变量配置（需要检查并修改）
- `start.ps1` - 前台启动脚本（测试用）
- `install-service.ps1` - 安装为 Windows 服务（生产用）
- `uninstall-service.ps1` - 卸载服务

---

## 🚀 快速部署步骤

### 第 1 步：上传到 ECS

**方法 A：远程桌面拖拽（推荐）**

1. 打开远程桌面连接：`mstsc`
2. 输入 ECS 公网 IP：`121.43.118.153`
3. 登录后，直接把整个 `feishu-todo-deploy` 文件夹拖到桌面或 `C:\Apps\` 目录

**方法 B：压缩后上传**

1. 在 ECS 上解压 ZIP 文件到 `C:\Apps\feishu-todo-deploy`

---

### 第 2 步：在 ECS 上安装 Node.js

如果 ECS 还没装 Node.js：

1. 下载 Node.js LTS 版本：https://nodejs.org/
2. 选择 Windows Installer (.msi)，64 位
3. 双击安装，一路"下一步"
4. 安装完成后，打开 PowerShell 验证：

```powershell
node --version
npm --version
```

---

### 第 3 步：安装依赖

在 ECS 上打开 PowerShell，进入部署目录：

```powershell
cd C:\Apps\feishu-todo-deploy
npm install --production
```

等待依赖安装完成（可能需要几分钟）。

---

### 第 4 步：配置 .env 文件

检查并修改 `.env` 文件，确认以下配置：

```env
# 端口配置（80 端口需要管理员权限）
PORT=80

# 飞书配置（确认这些值是否正确）
FEISHU_APP_ID=cli_a9ecd7a45f8dbed
FEISHU_APP_SECRET=Ipz6kmUpckbTWxfnvmsp1fareXQ7v2EE
FEISHU_VERIFICATION_TOKEN=AsspNd07asVWLVhr3cUn5fHhIPuOdy8l
FEISHU_ENCRYPT_KEY=@Yrb13413408645
FEISHU_TASKLIST_GUID=db87d31-088f-4bb7-b245-d42fc43e7823

# AI 配置（确认 API Key 是否有效）
OPENAI_API_BASE_URL=https://nowcoding.ai/v1
OPENAI_API_KEY=sk-n2J4fnW0UJc0Rt98xIsYpanJubxi5xyIFvZEBAun3iZsgjZM
OPENAI_MODEL=gpt-5.4-mini
```

---

### 第 5 步：配置防火墙

在 ECS 上打开 PowerShell（管理员），运行：

```powershell
New-NetFirewallRule -DisplayName "Feishu Todo Bot" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow
```

---

### 第 6 步：测试启动

先用前台模式测试（不要关闭 PowerShell 窗口）：

```powershell
.\start.ps1
```

应该看到类似输出：`Server listening on port 80`

在本地浏览器访问：`http://121.43.118.153/health`

应该返回：`{"status":"ok"}`

测试成功后，按 `Ctrl+C` 停止。

---

### 第 7 步：安装为 Windows 服务（生产环境）

右键点击 PowerShell → **以管理员身份运行**，然后：

```powershell
cd C:\Apps\feishu-todo-deploy
.\install-service.ps1
```

脚本会自动：
1. 下载并安装 NSSM（服务管理工具）
2. 注册服务
3. 启动服务
4. 配置开机自启

安装完成后，服务会自动运行。

---

### 第 8 步：配置飞书回调地址

访问 [飞书开放平台](https://open.feishu.cn/)，进入你的应用：

1. **事件订阅** → 请求地址：`http://121.43.118.153/feishu/events`
2. **卡片回调** → 请求地址：`http://121.43.118.153/feishu/events`
3. 点击"验证"，应该显示成功 ✅

---

### 第 9 步：测试机器人

在飞书中找到你的机器人，发送：

```
帮助
```

应该收到用法说明。再试试：

```
明天 3 点 提交周报 p1
```

应该创建成功并返回卡片。

---

## 🔧 服务管理

### 查看服务状态

```powershell
Get-Service FeishuTodoBot
```

### 停止服务

```powershell
Stop-Service FeishuTodoBot
```

### 启动服务

```powershell
Start-Service FeishuTodoBot
```

### 重启服务

```powershell
Restart-Service FeishuTodoBot
```

### 查看日志

```powershell
# 查看最新 50 行日志
Get-Content logs\stdout.log -Tail 50

# 实时查看日志
Get-Content logs\stdout.log -Wait
```

### 卸载服务

以管理员身份运行：

```powershell
.\uninstall-service.ps1
```

---

## 🐛 故障排查

### 服务无法启动

1. 检查 Node.js 是否正确安装：`node --version`
2. 检查 `.env` 配置是否正确
3. 查看错误日志：`Get-Content logs\stderr.log`
4. 确认 80 端口没有被占用：`netstat -ano | findstr :80`

### 飞书回调验证失败

1. 确认 ECS 安全组已开放 80 端口
2. 确认 Windows 防火墙已放行 80 端口
3. 确认服务正在运行：`Get-Service FeishuTodoBot`
4. 测试健康检查：在浏览器访问 `http://121.43.118.153/health`
5. 检查 `FEISHU_VERIFICATION_TOKEN` 是否正确

### 机器人不响应

1. 检查飞书后台事件订阅配置
2. 检查应用权限是否开通
3. 查看服务日志排查错误
4. 确认机器人已添加到对话中

### 端口被占用

如果 80 端口被占用，可以：

1. 修改 `.env` 中的 `PORT=3000`
2. 用 `netsh` 做端口转发：

```powershell
netsh interface portproxy add v4tov4 listenport=80 listenaddress=0.0.0.0 connectport=3000 connectaddress=127.0.0.1
```

---

## 🔄 更新部署

当代码更新后：

1. 在本地重新运行 `build-package.ps1` 生成新的部署包
2. 上传到 ECS（覆盖旧文件）
3. 在 ECS 上重新安装依赖：`npm install --production`
4. 重启服务：`Restart-Service FeishuTodoBot`

---

## 🔐 安全建议

1. ✅ 定期轮换飞书 App Secret 和 Encrypt Key
2. ✅ 不要把 `.env` 文件提交到 Git
3. ✅ 定期更新 Node.js 和依赖包
4. ✅ 配置 ECS 安全组，只开放必要端口
5. ✅ 使用强密码保护 RDP 远程桌面

---

## 🎉 部署完成

现在你的飞书 Todo 机器人已经在 Windows ECS 上运行了！

- **公网访问地址**：`http://121.43.118.153`
- **飞书回调地址**：`http://121.43.118.153/feishu/events`
- **服务状态**：开机自启，崩溃自动重启

### 开始使用 AI 增强功能

- 📸 **图片识别**：直接发送截图，自动提取任务
- 🎯 **智能优化**：发送"优化"获取待办清单分析
- 🧠 **自然语言**：用自然语言创建任务，AI 自动解析

---

## 📞 技术支持

如有问题：

1. 查看日志：`Get-Content logs\stdout.log -Tail 100`
2. 检查配置：确认 `.env` 文件配置正确
3. 测试连接：`curl http://121.43.118.153/health`
4. 参考主文档：`AI_FEATURES.md`
