# 飞书 Todo 助手部署指南

## 方案选择

### 方案 1：阿里云 ECS 部署（推荐生产环境）
✅ 稳定可靠，7x24 运行  
✅ 有公网 IP，飞书可直接回调  
✅ 适合长期使用  

### 方案 2：本地开发 + 内网穿透
✅ 快速测试，无需服务器  
✅ 适合开发调试  
⚠️ 依赖本地电脑开机，穿透工具可能不稳定  

---

## 方案 1：阿里云 ECS 部署

### 第一步：准备服务器环境

SSH 登录你的阿里云 ECS：
```bash
ssh root@你的公网IP
```

安装 Node.js（推荐 v18 或更高）：
```bash
# 使用 nvm 安装（推荐）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18

# 或者直接用包管理器
# Ubuntu/Debian:
# apt update && apt install -y nodejs npm

# CentOS/RHEL:
# yum install -y nodejs npm
```

安装 PM2（进程管理）：
```bash
npm install -g pm2
```

### 第二步：上传代码到服务器

**方法 A：用 Git（推荐）**
```bash
# 在服务器上
cd /opt
git clone <你的仓库地址>
cd New\ project\ 7

# 或者如果还没推到 Git，先在本地初始化：
# git init
# git add .
# git commit -m "Initial commit"
# git remote add origin <远程仓库地址>
# git push -u origin main
```

**方法 B：用 SCP 直接传输**
```bash
# 在本地 Windows PowerShell 执行
scp -r "C:\Users\Adm\Documents\New project 7" root@你的公网IP:/opt/
```

### 第三步：在服务器上配置

```bash
cd /opt/New\ project\ 7

# 安装依赖
npm install

# 创建 .env（把本地的内容复制过去）
nano .env
```

把以下内容粘贴进去：
```env
PORT=3000
APP_TIMEZONE=Asia/Shanghai
FEISHU_APP_ID=cli_aa9ecd7a45f8dbed
FEISHU_APP_SECRET=Ipz6kmUpckbTWxfnvmsp1fareXQ7v2EE
FEISHU_VERIFICATION_TOKEN=AsspNd07asVWLVhr3cUn5fHhIPuOdy8l
FEISHU_ENCRYPT_KEY=@Yrb13413408645
FEISHU_TASKLIST_GUID=db87dd31-088f-4bb7-b245-d42fc43e7823
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
```

保存退出（Ctrl+X, Y, Enter）

### 第四步：编译并启动

```bash
# 编译 TypeScript
npm run build

# 用 PM2 启动
pm2 start dist/index.js --name feishu-todo

# 设置开机自启
pm2 startup
pm2 save

# 查看日志
pm2 logs feishu-todo
```

### 第五步：配置反向代理（可选但推荐）

安装 Caddy（自动 HTTPS）：
```bash
# Ubuntu/Debian
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install caddy

# CentOS/RHEL
yum install yum-plugin-copr
yum copr enable @caddy/caddy
yum install caddy
```

配置 Caddy：
```bash
nano /etc/caddy/Caddyfile
```

内容：
```
todo.你的域名.com {
    reverse_proxy localhost:3000
}
```

如果没有域名，直接用 IP + HTTP：
```
:80 {
    reverse_proxy localhost:3000
}
```

启动 Caddy：
```bash
systemctl enable caddy
systemctl start caddy
```

### 第六步：配置阿里云安全组

在阿里云控制台 → ECS → 安全组，添加入站规则：
- 端口：80（HTTP）
- 端口：443（HTTPS，如果用了域名）
- 源地址：0.0.0.0/0

### 第七步：配置飞书回调地址

访问 [飞书开放平台](https://open.feishu.cn/)，进入你的应用：

1. **事件订阅** → 请求地址：
   - 有域名：`https://todo.你的域名.com/feishu/events`
   - 无域名：`http://你的公网IP/feishu/events`

2. **卡片回调** → 请求地址：
   - 同上

3. 点击"验证"，应该显示成功 ✅

### 第八步：测试

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

## 方案 2：本地开发 + 内网穿透

### 第一步：安装内网穿透工具

**选项 A：ngrok（推荐）**
1. 访问 https://ngrok.com/ 注册账号
2. 下载 Windows 客户端
3. 配置 authtoken：
   ```powershell
   ngrok config add-authtoken <你的token>
   ```
4. 启动穿透：
   ```powershell
   ngrok http 3000
   ```
5. 会显示类似 `https://abc123.ngrok.io` 的公网地址

**选项 B：localtunnel（免注册）**
```powershell
npm install -g localtunnel
lt --port 3000
```

会显示类似 `https://xyz.loca.lt` 的地址

**选项 C：Cloudflare Tunnel（免费且稳定）**
1. 下载 cloudflared：https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
2. 运行：
   ```powershell
   cloudflared tunnel --url http://localhost:3000
   ```

### 第二步：配置飞书回调

拿到公网地址后（例如 `https://abc123.ngrok.io`），在飞书开放平台配置：

1. **事件订阅** → 请求地址：`https://abc123.ngrok.io/feishu/events`
2. **卡片回调** → 请求地址：`https://abc123.ngrok.io/feishu/events`

### 第三步：重启本地服务

如果 `npm run dev` 已经在跑，按 Ctrl+C 停止，然后重新启动：
```powershell
npm run dev
```

### 第四步：测试

在飞书中测试机器人功能。

⚠️ **注意事项：**
- 内网穿透地址每次重启会变，需要重新配置飞书回调
- ngrok 免费版有连接数限制
- 本地电脑关机或休眠，机器人就停止服务

---

## 常用运维命令

### PM2 管理（服务器）
```bash
pm2 list                    # 查看所有进程
pm2 logs feishu-todo        # 查看日志
pm2 restart feishu-todo     # 重启
pm2 stop feishu-todo        # 停止
pm2 delete feishu-todo      # 删除

# 更新代码后
cd /opt/New\ project\ 7
git pull
npm install
npm run build
pm2 restart feishu-todo
```

### 查看日志
```bash
# PM2 日志
pm2 logs feishu-todo --lines 100

# Caddy 日志
journalctl -u caddy -f
```

### 健康检查
```bash
# 本地
curl http://localhost:3000/health

# 远程
curl http://你的公网IP/health
```

---

## 故障排查

### 飞书回调验证失败
1. 检查服务是否正常运行：`curl http://localhost:3000/health`
2. 检查防火墙/安全组是否开放端口
3. 检查 `.env` 中的 `FEISHU_VERIFICATION_TOKEN` 是否正确
4. 查看服务日志：`pm2 logs feishu-todo`

### 机器人不响应
1. 检查飞书后台事件订阅是否配置正确
2. 检查应用权限是否开通
3. 检查机器人是否已添加到对话中
4. 查看服务日志排查错误

### 创建任务失败
1. 确认 `FEISHU_TASKLIST_GUID` 正确
2. 确认应用已开通 `task:task:write` 权限
3. 确认任务清单存在且可访问

---

## 安全建议

1. ✅ 定期轮换 App Secret 和 Encrypt Key
2. ✅ 使用 HTTPS（Caddy 自动配置）
3. ✅ 不要把 `.env` 提交到 Git
4. ✅ 服务器配置防火墙，只开放必要端口
5. ✅ 定期更新依赖：`npm audit fix`

---

## 推荐配置

**生产环境：** 阿里云 ECS + Caddy + PM2 + 域名  
**开发测试：** 本地 + ngrok

有问题随时查看日志或参考 [QUICK_START.md](./QUICK_START.md)。
