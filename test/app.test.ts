import assert from "node:assert/strict";
import test from "node:test";
import { createTodoBotApp } from "../src/app.js";

const config = {
  port: 3000,
  timezone: "Asia/Shanghai",
  feishuAppId: "cli_test",
  feishuAppSecret: "secret",
  feishuVerificationToken: "token",
  feishuBaseToken: "base-token",
  feishuBaseTableId: "table-id",
  openaiApiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4.1-mini",
  enableImageRecognition: false,
  enableTodoOptimization: false,
  enableAiParse: false,
  enableQuickMode: false,
} as const;

function requestFromBody(body: unknown): Request {
  return new Request("http://localhost/feishu/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("challenge request returns challenge", async () => {
  const app = createTodoBotApp(config, {
    fetchImpl: (async () => new Response(JSON.stringify({ code: 0, msg: "ok", data: { tenant_access_token: "t", expire: 7200 } }), { status: 200 })) as typeof fetch,
  });

  const response = await app.handler(
    requestFromBody({
      schema: "2.0",
      header: { event_id: "e1", event_type: "im.message.receive_v1", token: "token" },
      challenge: "abc",
      event: {},
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { challenge: "abc" });
});

test("message event replies with confirmation card", async () => {
  const calls: string[] = [];
  const app = createTodoBotApp(config, {
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { tenant_access_token: "t-token", expire: 7200 } }), { status: 200 });
      }
      if (url.includes("/im/v1/messages/om_123/reply")) {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { message_id: "reply" } }), { status: 200 });
      }
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch,
  });

  const response = await app.handler(
    requestFromBody({
      schema: "2.0",
      header: { event_id: "e2", event_type: "im.message.receive_v1", token: "token" },
      event: {
        sender: { sender_id: { open_id: "ou_1" }, sender_type: "user" },
        message: { message_id: "om_123", message_type: "text", content: JSON.stringify({ text: "明天 3 点提交周报 p1；整理方案 备注: 带截图" }) },
      },
    }),
  );

  assert.equal(response.status, 200);
  
  // Wait for async processing
  await new Promise((resolve) => setTimeout(resolve, 100));
  
  const replyCall = calls.find((url) => url.includes("/im/v1/messages/om_123/reply"));
  assert.ok(replyCall);
});

test("card action confirms and writes to base", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const app = createTodoBotApp(config, {
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { tenant_access_token: "t-token", expire: 7200 } }), { status: 200 });
      }
      if (url.includes("/bitable/v1/apps/base-token/tables/table-id/records") && init?.method === "POST") {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { record: { record_id: "rec_1", fields: { "待办事项": "提交周报" } } } }), { status: 200 });
      }
      if (url.includes("/im/v1/messages/om_123/reply")) {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { message_id: "reply" } }), { status: 200 });
      }
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch,
  });

  await app.handler(
    requestFromBody({
      schema: "2.0",
      header: { event_id: "e2", event_type: "im.message.receive_v1", token: "token" },
      event: {
        sender: { sender_id: { open_id: "ou_1" }, sender_type: "user" },
        message: { message_id: "om_123", message_type: "text", content: JSON.stringify({ text: "提交周报 明天 p1" }) },
      },
    }),
  );

  // Wait for async processing
  await new Promise((resolve) => setTimeout(resolve, 100));

  const replyCall = calls.find((item) => item.url.includes("/im/v1/messages/om_123/reply"));
  assert.ok(replyCall);
  const replyBody = JSON.parse(String(replyCall?.init?.body)) as { content?: string };
  const card = JSON.parse(String(replyBody.content ?? "{}")) as { elements?: Array<{ actions?: Array<{ value?: Record<string, unknown> }> }> };
  const confirmAction = card.elements?.[2]?.actions?.[0]?.value;
  assert.ok(confirmAction?.confirm_token);

  const response = await app.handler(
    requestFromBody({
      schema: "2.0",
      header: { event_id: "e3", event_type: "card.action.trigger", token: "token" },
      event: {
        open_message_id: "om_123",
        action: { value: { action: "confirm_todo", confirm_token: confirmAction.confirm_token } },
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.ok(calls.some((item) => item.url.includes("/bitable/v1/apps/base-token/tables/table-id/records")));
});
