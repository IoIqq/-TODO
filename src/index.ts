import http from "node:http";
import { loadConfig } from "./config.js";
import { createTodoBotApp } from "./app.js";
import { initDatabase, closeDatabase } from "./storage/index.js";
import { DailyReminderScheduler } from "./scheduler/daily-reminder.js";
import { DeadlineReminderScheduler } from "./scheduler/deadline-reminder.js";
import { FeishuClient } from "./feishu.js";
import { AIClient } from "./ai.js";

async function main(): Promise<void> {
  const config = loadConfig();

  console.log("================================================================");
  console.log(" 飞书 Todo 智能助手 启动中...");
  console.log("================================================================");
  console.log(`[boot] PORT             = ${config.port}`);
  console.log(`[boot] AI Base URL      = ${config.openaiApiBaseUrl}`);
  console.log(`[boot] AI Model         = ${config.openaiModel}`);
  console.log(`[boot] AI Key           = ${config.openaiApiKey ? "***" + config.openaiApiKey.slice(-6) : "(missing)"}`);
  console.log(`[boot] Feishu App ID    = ${config.feishuAppId}`);
  console.log(`[boot] Base Token       = ${config.feishuBaseToken}`);
  console.log(`[boot] Table ID         = ${config.feishuBaseTableId}`);

  // 初始化本地数据库
  const dataDir = process.env.DATA_DIR?.trim() || "./data";
  initDatabase(dataDir);

  // 后台异步 ping AI（不阻塞启动）
  if (config.openaiApiKey) {
    void (async () => {
      try {
        const aiClient = new AIClient(config);
        const t0 = Date.now();
        const reply = await Promise.race([
          aiClient.chat({ userInput: "回复 ok 两个字", chatHistory: [] }),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error("AI ping timeout 10s")), 10000),
          ),
        ]);
        console.log(`[boot] ✅ AI ping ok (${Date.now() - t0}ms): ${String(reply).substring(0, 50)}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[boot] ❌ AI ping failed: ${msg}`);
        console.error(`[boot]    检查 OPENAI_API_BASE_URL / OPENAI_MODEL / OPENAI_API_KEY 是否正确`);
      }
    })();
  } else {
    console.warn("[boot] ⚠️ OPENAI_API_KEY 未配置，AI 功能不可用");
  }


  // 启动每日定时提醒（08:30 / 18:30）和截止时间提醒
  const reminderClient = new FeishuClient(config);
  const reminderScheduler = new DailyReminderScheduler({
    config,
    feishuClient: reminderClient,
  });
  const deadlineReminderScheduler = new DeadlineReminderScheduler({
    config,
    feishuClient: reminderClient,
  });
  reminderScheduler.start();
  deadlineReminderScheduler.start();

  // 优雅关闭：先停 cron，再关数据库
  const shutdown = (signal: string) => {
    console.log(`\n[server] Received ${signal}, shutting down...`);
    try {
      reminderScheduler.stop();
      deadlineReminderScheduler.stop();
    } catch (error) {
      console.error("[server] Error stopping scheduler:", error);
    }
    try {
      closeDatabase();
    } catch (error) {
      console.error("[server] Error closing database:", error);
    }
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const app = createTodoBotApp(config, { reminderScheduler, deadlineReminderScheduler });

  const server = http.createServer(async (req, res) => {
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

    let requestUrl: URL;
    try {
      requestUrl = new URL(req.url, base);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[server] Invalid request URL: ${req.url} (${msg})`);
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain");
      res.end("Bad Request: Invalid URL");
      return;
    }

    try {
      const response = await app.handler(new Request(requestUrl, requestInit));
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      const body = Buffer.from(await response.arrayBuffer());
      res.end(body);
    } catch (error) {
      console.error("Request failed:", error);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });

  server.listen(config.port, () => {
    console.log(`Feishu Todo bot listening on http://localhost:${config.port}`);
    console.log(`Health: http://localhost:${config.port}/health`);
    if (config.baseUrl) {
      console.log(`Callback: ${config.baseUrl}/feishu/events`);
    } else {
      console.log(`Callback: http://localhost:${config.port}/feishu/events`);
    }
    console.log(`Base: ${config.feishuBaseToken}/${config.feishuBaseTableId}`);
  });
}

main().catch((error) => {
  console.error("Startup failed:", error);
  process.exitCode = 1;
});
