import http from "node:http";
import { loadDotEnv } from "./env.js";
import { loadConfig } from "./config.js";
import { createTodoBotApp } from "./app.js";

function formatTime(): string {
  return new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const app = createTodoBotApp(config);

  const server = http.createServer(async (req, res) => {
    const startTime = Date.now();
    if (!req.url || !req.method) {
      res.statusCode = 400;
      res.end("Bad Request");
      return;
    }

    const base = `http://${req.headers.host ?? `localhost:${config.port}`}`;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const requestInit: RequestInit = {
      method: req.method,
      headers: req.headers as HeadersInit,
    };
    if (chunks.length > 0) {
      requestInit.body = Buffer.concat(chunks);
    }

    // 记录请求日志（仅记录飞书相关请求，避免健康检查刷屏）
    const isFeishuRequest = req.url.startsWith("/feishu/");
    if (isFeishuRequest) {
      console.log(`\n[${formatTime()}] 📥 ${req.method} ${req.url}`);
      if (chunks.length > 0) {
        try {
          const bodyStr = Buffer.concat(chunks).toString("utf-8");
          const parsed = JSON.parse(bodyStr) as Record<string, unknown>;
          // 标识请求类型
          if (typeof parsed.type === "string" && parsed.type === "url_verification") {
            console.log(`  ↳ 类型: URL 验证 (challenge)`);
          } else if (parsed.encrypt) {
            console.log(`  ↳ 类型: 加密推送`);
            console.log(`  ↳ 加密数据长度: ${(parsed.encrypt as string).length} 字符`);
          } else {
            const header = parsed.header as { event_type?: string } | undefined;
            const eventType = header?.event_type;
            if (eventType) {
              console.log(`  ↳ 事件类型: ${eventType}`);
            }
          }
        } catch {
          // 忽略 JSON 解析错误
        }
      }
    }

    try {
      const response = await app.handler(new Request(new URL(req.url, base), requestInit));

      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      const body = Buffer.from(await response.arrayBuffer());
      res.end(body);

      if (isFeishuRequest) {
        const duration = Date.now() - startTime;
        const statusIcon = response.status >= 200 && response.status < 300 ? "✅" : "❌";
        console.log(`  ↳ ${statusIcon} ${response.status} (${duration}ms)`);
      }
    } catch (error) {
      console.error(`\n[${formatTime()}] ❌ 请求处理出错:`, error);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });

  server.listen(config.port, () => {
    console.log("=".repeat(60));
    console.log("🤖 飞书 Todo 助手已启动");
    console.log("=".repeat(60));
    console.log(`📡 监听地址: http://localhost:${config.port}`);
    console.log(`🏥 健康检查: http://localhost:${config.port}/health`);
    console.log(`📨 回调地址: http://localhost:${config.port}/feishu/events`);
    console.log(`🌍 时区: ${config.timezone}`);
    console.log(`📋 任务清单: ${config.feishuTasklistGuid}`);
    console.log(`🔐 加密推送: ${config.feishuEncryptKey ? "已启用" : "未启用"}`);
    console.log(`🤖 OpenAI 兜底: ${config.openaiApiKey ? "已启用" : "未启用"}`);
    console.log("=".repeat(60));
    console.log("\n💡 下一步:");
    console.log("   1. 启动公网隧道: npm run tunel (或运行 cloudflared)");
    console.log("   2. 配置飞书回调: 查看 配置飞书回调.md");
    console.log("   3. 在飞书中测试: 发送 '帮助' 给机器人\n");
  });
}

main().catch((error) => {
  console.error("❌ 启动失败:", error);
  process.exitCode = 1;
});
