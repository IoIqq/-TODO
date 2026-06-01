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
} as const;

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
