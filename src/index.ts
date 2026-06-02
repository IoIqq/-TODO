import http from "node:http";
import { loadConfig } from "./config.js";
import { createTodoBotApp } from "./app.js";
import { initDatabase, closeDatabase } from "./storage/index.js";
import { DailyReminderScheduler } from "./scheduler/daily-reminder.js";
import { FeishuClient } from "./feishu.js";

async function main(): Promise<void> {
  const config = loadConfig();
  
  // 初始化本地数据库
  const dataDir = process.env.DATA_DIR?.trim() || "./data";
  initDatabase(dataDir);

  // 启动每日定时提醒（08:30 / 18:30）
  const reminderClient = new FeishuClient(config);
  const reminderScheduler = new DailyReminderScheduler({
    config,
    feishuClient: reminderClient,
  });
  reminderScheduler.start();

  // 优雅关闭：先停 cron，再关数据库
  const shutdown = (signal: string) => {
    console.log(`\n[server] Received ${signal}, shutting down...`);
    try {
      reminderScheduler.stop();
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

  const app = createTodoBotApp(config, { reminderScheduler });

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

    try {
      const response = await app.handler(new Request(new URL(req.url, base), requestInit));
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
    console.log(`Callback: http://localhost:${config.port}/feishu/events`);
    console.log(`Base: ${config.feishuBaseToken}/${config.feishuBaseTableId}`);
  });
}

main().catch((error) => {
  console.error("Startup failed:", error);
  process.exitCode = 1;
});
