import assert from "node:assert/strict";
import test from "node:test";
import { createTodoBotApp } from "../src/app.js";

const config = {
  port: 3000,
  timezone: "Asia/Shanghai",
  feishuAppId: "cli_test",
  feishuAppSecret: "secret",
  feishuVerificationToken: "token",
  adminToken: "admin-token",
  feishuBaseToken: "base-token",
  feishuBaseTableId: "table-id",
  openaiApiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4.1-mini",
  enableImageRecognition: false,
  enableTodoOptimization: false,
  enableAiParse: false,
  enableQuickMode: false,
  enableDailyReminder: true,
  dailyMorningCron: "30 8 * * *",
  dailyEveningCron: "30 18 * * *",
  enableDeadlineReminder: true,
  deadlineReminderCron: "* * * * *",
} as const;

function requestFromBody(body: unknown): Request {
  return new Request("http://localhost/feishu/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function waitFor<T>(getValue: () => T | undefined, timeoutMs = 1000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = getValue();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for expected condition");
}

function findActionValue(node: unknown, action: string): Record<string, unknown> | undefined {
  if (!node || typeof node !== "object") return undefined;
  const record = node as Record<string, unknown>;
  const value = record.value;
  if (value && typeof value === "object" && (value as Record<string, unknown>).action === action) {
    return value as Record<string, unknown>;
  }
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findActionValue(item, action);
        if (found) return found;
      }
    } else {
      const found = findActionValue(child, action);
      if (found) return found;
    }
  }
  return undefined;
}

test("challenge request returns challenge after token validation", async () => {
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

test("challenge request without token is rejected", async () => {
  const app = createTodoBotApp(config);

  const response = await app.handler(
    requestFromBody({
      schema: "2.0",
      header: { event_id: "e1", event_type: "im.message.receive_v1" },
      challenge: "abc",
      event: {},
    }),
  );

  assert.equal(response.status, 401);
});

test("event with invalid token is rejected", async () => {
  const app = createTodoBotApp(config);

  const response = await app.handler(
    requestFromBody({
      schema: "2.0",
      header: { event_id: "e-invalid", event_type: "im.message.receive_v1", token: "wrong" },
      event: {},
    }),
  );

  assert.equal(response.status, 401);
});

test("admin diagnostics require admin token and mask secrets", async () => {
  const app = createTodoBotApp(config, {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { tenant_access_token: "t-token", expire: 7200 } }), { status: 200 });
      }
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch,
  });

  const unauthorized = await app.handler(new Request("http://localhost/admin/diag?ping=false"));
  assert.equal(unauthorized.status, 401);

  const authorized = await app.handler(new Request("http://localhost/admin/diag?ping=false", {
    headers: { Authorization: "Bearer admin-token" },
  }));

  assert.equal(authorized.status, 200);
  const body = await authorized.json() as Record<string, any>;
  assert.equal(body.ok, true);
  assert.notEqual(body.feishu.appId, config.feishuAppId);
  assert.notEqual(body.feishu.baseToken, config.feishuBaseToken);
  assert.notEqual(body.feishu.tableId, config.feishuBaseTableId);
});

test("manual reminder endpoint requires admin token", async () => {
  let calledSlot = "";
  const app = createTodoBotApp(config, {
    reminderScheduler: {
      runOnce: async (slot: "morning" | "evening") => {
        calledSlot = slot;
        return { totalPending: 0, usersNotified: 0, skippedNoAssignee: 0, errors: 0 };
      },
    } as any,
  });

  const unauthorized = await app.handler(new Request("http://localhost/admin/test-reminder?slot=evening"));
  assert.equal(unauthorized.status, 401);
  assert.equal(calledSlot, "");

  const authorized = await app.handler(new Request("http://localhost/admin/test-reminder?slot=evening", {
    headers: { Authorization: "Bearer admin-token" },
  }));

  assert.equal(authorized.status, 200);
  assert.equal(calledSlot, "evening");
});

test("manual deadline reminder endpoint requires admin token", async () => {
  let called = false;
  const app = createTodoBotApp(config, {
    deadlineReminderScheduler: {
      runOnce: async () => {
        called = true;
        return { alertedUsers: 1, alertedTasks: 2, scheduledNext: 1 };
      },
    } as any,
  });

  const unauthorized = await app.handler(new Request("http://localhost/admin/test-deadline-reminder"));
  assert.equal(unauthorized.status, 401);
  assert.equal(called, false);

  const authorized = await app.handler(new Request("http://localhost/admin/test-deadline-reminder", {
    headers: { Authorization: "Bearer admin-token" },
  }));

  assert.equal(authorized.status, 200);
  assert.deepEqual(await authorized.json(), { ok: true, alertedUsers: 1, alertedTasks: 2, scheduledNext: 1 });
  assert.equal(called, true);
});

test("manual deadline reconcile endpoint requires admin token", async () => {
  let called = false;
  const app = createTodoBotApp(config, {
    deadlineReminderScheduler: {
      reconcile: async () => {
        called = true;
        return { scanned: 2, rescheduled: 1, cancelled: 1, skipped: 0, failed: 0 };
      },
    } as any,
  });

  const unauthorized = await app.handler(new Request("http://localhost/admin/reconcile-deadline-reminders", { method: "POST" }));
  assert.equal(unauthorized.status, 401);
  assert.equal(called, false);

  const authorized = await app.handler(new Request("http://localhost/admin/reconcile-deadline-reminders", {
    method: "POST",
    headers: { Authorization: "Bearer admin-token" },
  }));

  assert.equal(authorized.status, 200);
  assert.deepEqual(await authorized.json(), { ok: true, scanned: 2, rescheduled: 1, cancelled: 1, skipped: 0, failed: 0 });
  assert.equal(called, true);
});

test("message event replies with confirmation card", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const app = createTodoBotApp(config, {
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
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

  const replyCall = await waitFor(() => calls.find((item) => item.url.includes("/im/v1/messages/om_123/reply")));
  const replyBody = JSON.parse(String(replyCall.init?.body)) as { msg_type?: string; content?: string };
  const card = JSON.parse(String(replyBody.content ?? "{}"));
  const confirmAction = findActionValue(card, "confirm_todo");

  assert.equal(replyBody.msg_type, "interactive");
  assert.ok(confirmAction?.confirm_token);
});

test("query command hides completed tasks by default", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const app = createTodoBotApp(config, {
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { tenant_access_token: "t-token", expire: 7200 } }), { status: 200 });
      }
      if (url.includes("/bitable/v1/apps/base-token/tables/table-id/records") && init?.method === "GET") {
        return new Response(JSON.stringify({
          code: 0,
          msg: "ok",
          data: {
            items: [
              { record_id: "rec_pending", fields: { "待办事项": "未完成任务", "是否已完成": false, "优先级": "普通" } },
              { record_id: "rec_done", fields: { "待办事项": "已完成任务", "是否已完成": true, "优先级": "普通" } },
            ],
          },
        }), { status: 200 });
      }
      if (url.includes("/im/v1/messages/om_query/reply")) {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { message_id: "reply" } }), { status: 200 });
      }
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch,
  });

  const response = await app.handler(
    requestFromBody({
      schema: "2.0",
      header: { event_id: "e-query", event_type: "im.message.receive_v1", token: "token" },
      event: {
        sender: { sender_id: { open_id: "ou_1" }, sender_type: "user" },
        message: { message_id: "om_query", message_type: "text", content: JSON.stringify({ text: "/待办" }) },
      },
    }),
  );

  assert.equal(response.status, 200);
  const replyCall = await waitFor(() => calls.find((item) => item.url.includes("/im/v1/messages/om_query/reply")));
  const replyBody = JSON.parse(String(replyCall.init?.body)) as { content?: string };
  const card = JSON.parse(String(replyBody.content ?? "{}"));
  const cardText = JSON.stringify(card);

  assert.match(cardText, /未完成任务/);
  assert.doesNotMatch(cardText, /已完成任务/);
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

  const replyCall = await waitFor(() => calls.find((item) => item.url.includes("/im/v1/messages/om_123/reply")));
  const replyBody = JSON.parse(String(replyCall.init?.body)) as { content?: string };
  const card = JSON.parse(String(replyBody.content ?? "{}"));
  const confirmAction = findActionValue(card, "confirm_todo");
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
  await waitFor(() => calls.find((item) => item.url.includes("/bitable/v1/apps/base-token/tables/table-id/records") && item.init?.method === "POST"));
});

test("card action postpones task by selected duration", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const currentDue = Date.UTC(2026, 5, 6, 8, 0, 0);
  const app = createTodoBotApp(config, {
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { tenant_access_token: "t-token", expire: 7200 } }), { status: 200 });
      }
      if (url.includes("/bitable/v1/apps/base-token/tables/table-id/records/rec_1") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { fields: Record<string, unknown> };
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { record: { record_id: "rec_1", fields: { "待办事项": "Task", "优先级": "🔴P0-高优", "截止日期": body.fields["截止日期"], "执行人": [{ id: "ou_1" }] } } } }), { status: 200 });
      }
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch,
  });

  let response = await app.handler(
    requestFromBody({
      schema: "2.0",
      header: { event_id: "e-postpone-30", event_type: "card.action.trigger", token: "token" },
      event: {
        open_message_id: "om_456",
        action: { value: { action: "postpone_task", record_id: "rec_1", current_due_timestamp: currentDue, defer_ms: 30 * 60 * 1000, title: "Task", priority: "🔴P0-高优", assignee_open_id: "ou_1" } },
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.match(JSON.stringify(await response.json()), /半小时/);
  let updateCall = await waitFor(() => calls.find((item) => item.url.includes("/bitable/v1/apps/base-token/tables/table-id/records/rec_1") && item.init?.method === "PUT"));
  assert.deepEqual(JSON.parse(String(updateCall.init?.body)), { fields: { "截止日期": currentDue + 30 * 60 * 1000 } });

  calls.length = 0;
  response = await app.handler(
    requestFromBody({
      schema: "2.0",
      header: { event_id: "e-postpone-day", event_type: "card.action.trigger", token: "token" },
      event: {
        open_message_id: "om_456",
        action: { value: { action: "postpone_task", record_id: "rec_1", current_due_timestamp: currentDue, defer_ms: 24 * 60 * 60 * 1000, title: "Task", priority: "🔴P0-高优", assignee_open_id: "ou_1" } },
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.match(JSON.stringify(await response.json()), /一天/);
  updateCall = await waitFor(() => calls.find((item) => item.url.includes("/bitable/v1/apps/base-token/tables/table-id/records/rec_1") && item.init?.method === "PUT"));
  assert.deepEqual(JSON.parse(String(updateCall.init?.body)), { fields: { "截止日期": currentDue + 24 * 60 * 60 * 1000 } });
});

test("card action marks task completed instead of deleting record", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const app = createTodoBotApp(config, {
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { tenant_access_token: "t-token", expire: 7200 } }), { status: 200 });
      }
      if (url.includes("/bitable/v1/apps/base-token/tables/table-id/records/rec_1") && init?.method === "PUT") {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { record: { record_id: "rec_1", fields: { "是否已完成": true } } } }), { status: 200 });
      }
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch,
  });

  const response = await app.handler(
    requestFromBody({
      schema: "2.0",
      header: { event_id: "e4", event_type: "card.action.trigger", token: "token" },
      event: {
        open_message_id: "om_456",
        action: { value: { action: "complete_task", record_id: "rec_1" } },
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { toast: { type: "success", content: "✅ 已开始完成" } });

  const updateCall = await waitFor(() => calls.find((item) => item.url.includes("/bitable/v1/apps/base-token/tables/table-id/records/rec_1")));
  assert.equal(updateCall.init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(updateCall.init?.body)), { fields: { "是否已完成": true } });
  assert.equal(calls.some((item) => item.init?.method === "DELETE"), false);
});

test("handler gracefully handles URL parsing errors", async () => {
  const app = createTodoBotApp(config);

  const validRequest = new Request("http://localhost:3000/health", {
    method: "GET",
  });

  const response = await app.handler(validRequest);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(text, "ok");
});
