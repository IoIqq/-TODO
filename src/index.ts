import http from "node:http";
import { loadConfig } from "./config.js";
import { createTodoBotApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = createTodoBotApp(config);

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
