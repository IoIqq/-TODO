import assert from "node:assert/strict";
import test from "node:test";
import { FeishuClient } from "../src/feishu.js";

const config = {
  port: 3000,
  timezone: "Asia/Shanghai",
  feishuAppId: "cli_test",
  feishuAppSecret: "secret",
  feishuVerificationToken: "token",
  feishuTasklistGuid: "tasklist-guid",
  openaiApiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4.1-mini",
  enableImageRecognition: false,
  enableTodoOptimization: false,
  enableAiParse: false,
} as const;

test("createTask sends tasklist and due payload", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = new FeishuClient(config, {
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init: init ?? {} });
      if (String(input).includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { tenant_access_token: "t-token", expire: 7200 } }), { status: 200 });
      }
      if (String(input).includes("/task/v2/tasks")) {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { task: { guid: "task-guid", summary: "提交周报", due: { timestamp: "10", is_all_day: false } } } }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch,
  });

  const task = await client.createTask({
    parsed: {
      title: "提交周报",
      due: { timestamp: "10", is_all_day: false },
      priority: "high",
      notes: "附截图",
      fallbackUsed: false,
    },
    actorOpenId: "ou_test",
  });

  assert.equal(task.guid, "task-guid");
  const createCall = requests.find((entry) => entry.url.includes("/task/v2/tasks") && entry.init.method === "POST");
  assert.ok(createCall);
  const body = JSON.parse(String(createCall?.init.body)) as Record<string, unknown>;
  assert.equal(body.summary, "提交周报");
  assert.equal(body.description, "附截图");
  assert.deepEqual(body.due, { timestamp: "10", is_all_day: false });
  assert.deepEqual(body.tasklists, [{ guid: "tasklist-guid" }]);
  assert.deepEqual(body.members, [{ id: "ou_test", type: "user", role: "assignee" }]);
});

test("patchTask completes task with completed_at", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = new FeishuClient(config, {
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init: init ?? {} });
      if (String(input).includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { tenant_access_token: "t-token", expire: 7200 } }), { status: 200 });
      }
      if (String(input).includes("/task/v2/tasks/task-guid")) {
        return new Response(JSON.stringify({ code: 0, msg: "ok", data: { task: { guid: "task-guid", summary: "提交周报", completed_at: "1" } } }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch,
  });

  const task = await client.completeTask("task-guid");
  assert.equal(task.completed_at, "1");
  const patchCall = requests.find((entry) => entry.url.includes("/task/v2/tasks/task-guid") && entry.init.method === "PATCH");
  const body = JSON.parse(String(patchCall?.init.body)) as Record<string, unknown>;
  assert.deepEqual(body.update_fields, ["completed_at"]);
  assert.equal(typeof (body.task as Record<string, unknown>).completed_at, "string");
});
