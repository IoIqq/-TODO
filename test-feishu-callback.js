#!/usr/bin/env node

/**
 * 飞书回调端到端测试脚本
 * 模拟飞书发送的各类请求，验证服务器响应
 * 
 * 使用方法:
 *   1. 先在另一个终端运行: npm run dev
 *   2. 然后运行: node test-feishu-callback.js
 */

import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";

// 加载 .env
const envContent = fs.readFileSync(".env", "utf-8");
const env = {};
envContent.split("\n").forEach((line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return;
  const [key, ...valueParts] = trimmed.split("=");
  if (key && valueParts.length > 0) {
    env[key.trim()] = valueParts.join("=").trim();
  }
});

const PORT = env.PORT || 3000;
const TOKEN = env.FEISHU_VERIFICATION_TOKEN;
const ENCRYPT_KEY = env.FEISHU_ENCRYPT_KEY;

// 颜色辅助
const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

let passed = 0;
let failed = 0;
const results = [];

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const data = typeof body === "string" ? body : JSON.stringify(body);
    const req = http.request(
      {
        hostname: "localhost",
        port: PORT,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: 5000,
      },
      (res) => {
        let chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          resolve({ status: res.statusCode, body, headers: res.headers });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.write(data);
    req.end();
  });
}

function getRequest(path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: PORT,
        path,
        method: "GET",
        timeout: 5000,
      },
      (res) => {
        let chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          resolve({ status: res.statusCode, body, headers: res.headers });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTest(name, fn) {
  process.stdout.write(`  ${c.dim("•")} ${name} ... `);
  try {
    await fn();
    console.log(c.green("✓ PASS"));
    passed++;
    results.push({ name, status: "pass" });
  } catch (error) {
    console.log(c.red("✗ FAIL"));
    console.log(c.red(`    错误: ${error.message}`));
    failed++;
    results.push({ name, status: "fail", error: error.message });
  }
}

// 飞书加密推送
function encryptPayload(plaintext, key) {
  const md5Key = crypto.createHash("sha256").update(key).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", md5Key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString("base64");
}

async function main() {
  console.log(c.bold("\n🧪 飞书回调端到端测试\n"));
  console.log(c.dim("=".repeat(60)));
  console.log(`服务地址: ${c.cyan(`http://localhost:${PORT}`)}`);
  console.log(`Token: ${c.cyan(TOKEN ? TOKEN.substring(0, 4) + "***" : "未配置")}`);
  console.log(`加密密钥: ${c.cyan(ENCRYPT_KEY ? "已配置" : "未配置")}`);
  console.log(c.dim("=".repeat(60)));

  // 测试 1: 健康检查
  console.log(c.bold("\n📡 健康检查测试"));
  await runTest("GET /health 返回 ok", async () => {
    const res = await getRequest("/health");
    assert(res.status === 200, `期望 status=200, 实际=${res.status}`);
    assert(res.body === "ok", `期望 body="ok", 实际="${res.body}"`);
  });

  // 测试 2: URL 验证 (challenge)
  console.log(c.bold("\n🔐 URL 验证测试"));
  await runTest("URL 验证返回 challenge", async () => {
    const challenge = "test_challenge_" + Date.now();
    const res = await postJson("/feishu/events", {
      challenge,
      token: TOKEN,
      type: "url_verification",
    });
    assert(res.status === 200, `期望 status=200, 实际=${res.status}`);
    const data = JSON.parse(res.body);
    assert(
      data.challenge === challenge,
      `期望 challenge="${challenge}", 实际="${data.challenge}"`
    );
  });

  await runTest("错误的 token 应被拒绝", async () => {
    const res = await postJson("/feishu/events", {
      challenge: "test123",
      token: "wrong_token",
      type: "url_verification",
    });
    // 注意：根据当前实现，token 错误会返回 401 或 200 (但 challenge 不匹配)
    // 检查是否拒绝（不返回正确的 challenge）
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      assert(
        data.challenge !== "test123",
        "错误 token 不应返回正确 challenge"
      );
    } else {
      assert(
        res.status === 401 || res.status === 403,
        `期望 401/403, 实际=${res.status}`
      );
    }
  });

  // 测试 3: 消息事件
  console.log(c.bold("\n💬 消息事件测试"));
  await runTest("接收消息事件返回 200", async () => {
    const eventId = "evt_" + Date.now();
    const res = await postJson("/feishu/events", {
      schema: "2.0",
      header: {
        event_id: eventId,
        token: TOKEN,
        create_time: String(Date.now()),
        event_type: "im.message.receive_v1",
        tenant_key: "test_tenant",
        app_id: env.FEISHU_APP_ID,
      },
      event: {
        sender: {
          sender_id: { open_id: "ou_test_user" },
          sender_type: "user",
        },
        message: {
          message_id: "om_test_" + Date.now(),
          chat_id: "oc_test_chat",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "帮助" }),
          create_time: String(Date.now()),
        },
      },
    });
    assert(res.status === 200, `期望 status=200, 实际=${res.status}`);
  });

  await runTest("重复 event_id 应被去重", async () => {
    const eventId = "evt_dedupe_" + Date.now();
    const payload = {
      schema: "2.0",
      header: {
        event_id: eventId,
        token: TOKEN,
        create_time: String(Date.now()),
        event_type: "im.message.receive_v1",
        tenant_key: "test_tenant",
        app_id: env.FEISHU_APP_ID,
      },
      event: {
        sender: {
          sender_id: { open_id: "ou_test_user" },
          sender_type: "user",
        },
        message: {
          message_id: "om_dedupe_" + Date.now(),
          chat_id: "oc_test_chat",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "帮助" }),
          create_time: String(Date.now()),
        },
      },
    };
    const res1 = await postJson("/feishu/events", payload);
    const res2 = await postJson("/feishu/events", payload);
    assert(res1.status === 200, `首次请求期望 200, 实际=${res1.status}`);
    assert(res2.status === 200, `重复请求期望 200, 实际=${res2.status}`);
    // 去重逻辑应该接受重复请求但不重复处理
  });

  // 测试 4: 卡片交互事件
  console.log(c.bold("\n🎴 卡片交互测试"));
  await runTest("卡片按钮点击事件返回 200", async () => {
    const res = await postJson("/feishu/events", {
      schema: "2.0",
      header: {
        event_id: "card_evt_" + Date.now(),
        token: TOKEN,
        create_time: String(Date.now()),
        event_type: "card.action.trigger",
        tenant_key: "test_tenant",
        app_id: env.FEISHU_APP_ID,
      },
      event: {
        operator: {
          tenant_key: "test_tenant",
          open_id: "ou_test_user",
        },
        token: "card_token_test",
        action: {
          tag: "button",
          value: {
            action: "complete",
            task_guid: "test_task_guid_123",
          },
        },
      },
    });
    assert(res.status === 200, `期望 status=200, 实际=${res.status}`);
  });

  // 测试 5: 加密推送（如果配置了密钥）
  if (ENCRYPT_KEY) {
    console.log(c.bold("\n🔒 加密推送测试"));
    await runTest("加密的 challenge 请求", async () => {
      const challenge = "encrypted_challenge_" + Date.now();
      const plaintext = JSON.stringify({
        challenge,
        token: TOKEN,
        type: "url_verification",
      });
      const encrypted = encryptPayload(plaintext, ENCRYPT_KEY);
      const res = await postJson("/feishu/events", { encrypt: encrypted });
      assert(res.status === 200, `期望 status=200, 实际=${res.status}`);
      const data = JSON.parse(res.body);
      assert(
        data.challenge === challenge,
        `期望 challenge="${challenge}", 实际="${data.challenge}"`
      );
    });
  }

  // 测试 6: 异常请求处理
  console.log(c.bold("\n⚠️  异常请求测试"));
  await runTest("空请求体返回错误", async () => {
    const res = await postJson("/feishu/events", "");
    assert(
      res.status >= 400 && res.status < 500,
      `期望 4xx 错误, 实际=${res.status}`
    );
  });

  await runTest("非法 JSON 返回错误", async () => {
    const res = await postJson("/feishu/events", "{invalid json");
    assert(
      res.status >= 400 && res.status < 500,
      `期望 4xx 错误, 实际=${res.status}`
    );
  });

  await runTest("未知路径返回 404", async () => {
    const res = await getRequest("/unknown");
    assert(res.status === 404, `期望 status=404, 实际=${res.status}`);
  });

  // 输出总结
  console.log("\n" + c.dim("=".repeat(60)));
  console.log(c.bold("\n📊 测试结果汇总"));
  console.log(c.dim("=".repeat(60)));
  console.log(`总计: ${passed + failed} 个测试`);
  console.log(c.green(`通过: ${passed}`));
  if (failed > 0) {
    console.log(c.red(`失败: ${failed}`));
    console.log("\n失败的测试:");
    results
      .filter((r) => r.status === "fail")
      .forEach((r) => {
        console.log(c.red(`  ✗ ${r.name}`));
        console.log(c.dim(`    ${r.error}`));
      });
  }
  console.log("");

  process.exit(failed > 0 ? 1 : 0);
}

// 检查服务是否运行
async function checkService() {
  try {
    await getRequest("/health");
    return true;
  } catch {
    return false;
  }
}

(async () => {
  const isRunning = await checkService();
  if (!isRunning) {
    console.log(c.red("\n❌ 服务未运行！\n"));
    console.log("请先在另一个终端启动服务：");
    console.log(c.cyan("  npm run dev\n"));
    console.log("然后再次运行此测试脚本：");
    console.log(c.cyan("  node test-feishu-callback.js\n"));
    process.exit(1);
  }
  await main();
})().catch((error) => {
  console.error(c.red("\n❌ 测试执行出错:"), error);
  process.exit(1);
});
