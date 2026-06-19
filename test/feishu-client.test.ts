import assert from "node:assert/strict";
import test from "node:test";
import { FeishuClient } from "../src/feishu.js";

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
  enableDailyReminder: true,
  dailyMorningCron: "30 8 * * *",
  dailyEveningCron: "30 18 * * *",
  enableDeadlineReminder: true,
  deadlineReminderCron: "* * * * *",
} as const;

async function waitFor<T>(getValue: () => T | undefined, timeoutMs = 1000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = getValue();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for expected condition");
}

test("createTodoRecordsOneByOne sends normalized base record payload", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = new FeishuClient(config, {
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init: init ?? {} });
      if (String(input).includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { tenant_access_token: "t-token", expire: 7200 } }), { status: 200 });
      }
      if (String(input).includes("/bitable/v1/apps/base-token/tables/table-id/records") && init?.method === "POST") {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { record: { record_id: "rec_1", fields: { "待办事项": "提交周报" } } } }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch,
  });

  const result = await client.createTodoRecordsOneByOne({
    items: [
      {
        title: "提交周报",
        priority: "high",
        fallbackUsed: false,
        due: { timestamp: "2026-05-28T10:00:00+08:00", is_all_day: false },
        assigneeOpenId: "ou_test",
      },
    ],
  });

  assert.equal(result.length, 1);
  const createCall = requests.find((entry) => entry.url.includes("/bitable/v1/apps/base-token/tables/table-id/records") && entry.init.method === "POST");
  assert.ok(createCall);
  const body = JSON.parse(String(createCall?.init.body)) as Record<string, unknown>;
  assert.equal((body.fields as Record<string, unknown>)["待办事项"], "提交周报");
  assert.equal((body.fields as Record<string, unknown>)["优先级"], "🔴P0-高优");
  assert.equal((body.fields as Record<string, unknown>)["是否已完成"], false);
  assert.equal((body.fields as Record<string, unknown>)["截止日期"], Date.parse("2026-05-28T10:00:00+08:00"));
  assert.deepEqual((body.fields as Record<string, unknown>)["执行人"], [{ id: "ou_test" }]);
  assert.ok(!Object.prototype.hasOwnProperty.call(body.fields as Record<string, unknown>, "创建时间"));
});

test("listRecords follows Feishu pagination", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = new FeishuClient(config, {
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init: init ?? {} });
      if (url.includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { tenant_access_token: "t-token", expire: 7200 } }), { status: 200 });
      }
      if (url.includes("page_token=next")) {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { items: [{ record_id: "rec_2", fields: {} }], has_more: false } }), { status: 200 });
      }
      if (url.includes("/bitable/v1/apps/base-token/tables/table-id/records") && init?.method === "GET") {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { items: [{ record_id: "rec_1", fields: {} }], has_more: true, page_token: "next" } }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch,
  });

  const records = await client.listRecords({ pageSize: 1 });

  assert.deepEqual(records.map((record) => record.record_id), ["rec_1", "rec_2"]);
  assert.ok(requests.some((request) => request.url.includes("page_token=next")));
});

test("postpone_task writes millisecond timestamp", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = new FeishuClient(config, {
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init: init ?? {} });
      if (url.includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { tenant_access_token: "t-token", expire: 7200 } }), { status: 200 });
      }
      if (url.includes("/bitable/v1/apps/base-token/tables/table-id/records/rec_1") && init?.method === "PUT") {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { record: { record_id: "rec_1", fields: { "待办事项": "任务", "优先级": "🔴P0-高优", "执行人": [{ id: "ou_test" }] } } } }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch,
  });

  const currentDue = Date.parse("2026-05-28T10:00:00+08:00");
  const response = await client.handleCardAction({
    action: {
      value: {
        action: "postpone_task",
        record_id: "rec_1",
        current_due_timestamp: currentDue,
        title: "任务",
        priority: "🔴P0-高优",
        assignee_open_id: "ou_test",
      },
    },
  });

  assert.equal(response.toast.type, "info");
  const updateCall = await waitFor(() => requests.find((request) => request.url.includes("/records/rec_1") && request.init.method === "PUT"));
  const body = JSON.parse(String(updateCall.init.body)) as { fields: Record<string, unknown> };
  assert.equal(body.fields["截止日期"], currentDue + 24 * 60 * 60 * 1000);
});
