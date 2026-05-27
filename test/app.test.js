import assert from "node:assert/strict";
import test from "node:test";
import { createTodoBotApp } from "../src/app.js";
const config = {
    port: 3000,
    timezone: "Asia/Shanghai",
    feishuAppId: "cli_test",
    feishuAppSecret: "secret",
    feishuVerificationToken: "token",
    feishuTasklistGuid: "tasklist-guid",
    openaiModel: "gpt-4.1-mini",
};
function requestFromBody(body) {
    return new Request("http://localhost/feishu/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}
test("challenge request returns challenge", async () => {
    const app = createTodoBotApp(config, {
        fetchImpl: (async () => new Response(JSON.stringify({ code: 0, msg: "ok", data: { tenant_access_token: "t", expire: 7200 } }), { status: 200 })),
    });
    const response = await app.handler(requestFromBody({
        schema: "2.0",
        header: { event_id: "e1", event_type: "im.message.receive_v1", token: "token" },
        challenge: "abc",
        event: {},
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { challenge: "abc" });
});
test("message event creates task and replies with card", async () => {
    const calls = [];
    const app = createTodoBotApp(config, {
        fetchImpl: (async (input, init) => {
            const url = String(input);
            calls.push(url);
            if (url.includes("/auth/v3/tenant_access_token/internal")) {
                return new Response(JSON.stringify({ code: 0, msg: "ok", data: { tenant_access_token: "t-token", expire: 7200 } }), { status: 200 });
            }
            if (url.includes("/task/v2/tasks") && init?.method === "POST") {
                return new Response(JSON.stringify({ code: 0, msg: "ok", data: { task: { guid: "task-guid", summary: "提交周报", due: { timestamp: "10", is_all_day: true } } } }), { status: 200 });
            }
            if (url.includes("/im/v1/messages/om_123/reply")) {
                return new Response(JSON.stringify({ code: 0, msg: "ok", data: { message_id: "reply" } }), { status: 200 });
            }
            throw new Error(`Unexpected request ${url}`);
        }),
    });
    const response = await app.handler(requestFromBody({
        schema: "2.0",
        header: { event_id: "e2", event_type: "im.message.receive_v1", token: "token" },
        event: {
            sender: { sender_id: { open_id: "ou_1" }, sender_type: "user" },
            message: { message_id: "om_123", message_type: "text", content: JSON.stringify({ text: "提交周报 明天 p1" }) },
        },
    }));
    assert.equal(response.status, 200);
    assert.ok(calls.some((url) => url.includes("/task/v2/tasks")));
    assert.ok(calls.some((url) => url.includes("/im/v1/messages/om_123/reply")));
});
test("card action completes task", async () => {
    const calls = [];
    const app = createTodoBotApp(config, {
        fetchImpl: (async (input, init) => {
            const url = String(input);
            calls.push(url);
            if (url.includes("/auth/v3/tenant_access_token/internal")) {
                return new Response(JSON.stringify({ code: 0, msg: "ok", data: { tenant_access_token: "t-token", expire: 7200 } }), { status: 200 });
            }
            if (url.includes("/task/v2/tasks/task-guid") && init?.method === "PATCH") {
                return new Response(JSON.stringify({ code: 0, msg: "ok", data: { task: { guid: "task-guid", summary: "提交周报", completed_at: "1" } } }), { status: 200 });
            }
            throw new Error(`Unexpected request ${url}`);
        }),
    });
    const response = await app.handler(requestFromBody({
        schema: "2.0",
        header: { event_id: "e3", event_type: "card.action.trigger", token: "token" },
        event: {
            open_message_id: "om_456",
            action: { value: { action: "complete", task_guid: "task-guid" } },
        },
    }));
    assert.equal(response.status, 200);
    assert.ok(calls.some((url) => url.includes("/task/v2/tasks/task-guid")));
    assert.deepEqual(await response.json(), { toast: { type: "info", content: "已完成" } });
});
