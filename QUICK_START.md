# 飞书 Todo 智能机器人 - 快速开始

## 1. 创建飞书应用

1. 去飞书开放平台创建企业自建应用
2. 记录：
   - `App ID`
   - `App Secret`
   - `Verification Token`
   - `Encrypt Key`（建议开启）

3. 开启事件订阅：
   - `im.message.receive_v1`
   - `card.action.trigger`

## 2. 准备多维表格

你现在已经有现成的表：

- `任务跟进（AI 风险管理）`
- Base token: `HEAHbiuUFaQhE7siqzic9vjvnpf`
- Table ID: `tblXUkCfVMPg2hCv`

不用重建，直接用。

## 3. 配置本地环境

复制 `.env.example` 为 `.env`，至少填：

```env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx
FEISHU_ENCRYPT_KEY=xxx
FEISHU_BASE_TOKEN=HEAHbiuUFaQhE7siqzic9vjvnpf
FEISHU_BASE_TABLE_ID=tblXUkCfVMPg2hCv
```

## 4. 启动

```bash
npm install
npm run build
npm run dev
```

## 5. 测试

直接私聊机器人：

- `明天 3 点提交周报 p1；整理方案 备注: 带截图`
- `下周一 处理客户反馈`

机器人会先返回确认卡片，你点 `确认写入` 后才会写入多维表格。
