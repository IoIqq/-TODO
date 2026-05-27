import crypto from "node:crypto";
import { AIClient } from "./ai.js";
import { maybeRefineParseWithOpenAI } from "./ai.js";
import { parseTaskText } from "./parser.js";
import type { AppConfig } from "./config.js";
import type { FeishuCardActionEvent, FeishuEventEnvelope, FeishuMessageReceiveEvent } from "./types.js";
import { FeishuClient } from "./feishu.js";

export interface TodoBotDependencies {
  fetchImpl?: typeof fetch;
}

export interface TodoBotApp {
  handler: (request: Request) => Promise<Response>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function parseMessageText(event: FeishuMessageReceiveEvent): string {
  const content = event.message?.content;
  if (!content) {
    return "";
  }

  try {
    const parsed = JSON.parse(content) as { text?: string };
    return parsed.text?.trim() ?? "";
  } catch {
    return "";
  }
}

function shouldShowTodayTasks(text: string): boolean {
  return /^(今天待办|今日待办|今天任务|今日任务|todo\s+today|list\s+today)/i.test(text);
}

function shouldShowTomorrowTasks(text: string): boolean {
  return /^(明天待办|明日待办|明天任务|明日任务|todo\s+tomorrow|list\s+tomorrow)/i.test(text);
}

function shouldShowHelp(text: string): boolean {
  return /^(帮助|help|\?|？|怎么用|使用说明)/i.test(text.trim());
}

function shouldOptimizeTasks(text: string): boolean {
  return /^(优化|优化任务|优化待办|整理任务|整理待办|optimize)/i.test(text.trim());
}

function isImageMessage(event: FeishuMessageReceiveEvent): boolean {
  return event.message?.message_type === "image";
}

const HELP_TEXT = [
  "🤖 飞书智能 Todo 助手用法：",
  "",
  "📝 新增待办：直接发送，例如",
  "  · 明天 3 点 提交周报 p1",
  "  · 下周一 之前 交材料",
  "  · 整理方案 备注: 要附上截图",
  "",
  "📸 图片识别：发送截图自动提取任务",
  "  · 会议通知截图",
  "  · 聊天记录截图",
  "  · 文档/笔记截图",
  "",
  "📋 查询：",
  "  · 今天待办 / 今日待办",
  "  · 明天待办 / 明日待办",
  "",
  "🎯 智能优化：",
  "  · 优化 / 优化任务 / 整理待办",
  "  · AI 分析优先级、时间冲突、任务分解",
  "",
  "✅ 创建后可点击卡片按钮：",
  "  · 完成",
  "  · 延期一天",
  "",
  "💡 优先级：p1 / p2 / p3，或者写成 紧急 / 普通 / 稍后",
].join("\n");

function decryptIfNeeded(body: unknown, config: AppConfig): unknown {
  if (!body || typeof body !== "object") {
    return body;
  }

  const envelope = body as Record<string, unknown>;
  if (typeof envelope.encrypt !== "string") {
    return body;
  }

  if (!config.feishuEncryptKey) {
    throw new Error("Received encrypted payload but FEISHU_ENCRYPT_KEY is not set");
  }

  const encryptedBuffer = Buffer.from(envelope.encrypt, "base64");
  const key = crypto.createHash("sha256").update(config.feishuEncryptKey).digest();
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, encryptedBuffer.subarray(0, 16));
  let decrypted = decipher.update(encryptedBuffer.subarray(16), undefined, "utf8");
  decrypted += decipher.final("utf8");
  return JSON.parse(decrypted) as unknown;
}

function validateEnvelope(config: AppConfig, envelope: FeishuEventEnvelope<unknown>): void {
  const token = envelope.header?.token ?? envelope.token;
  if (token && token !== config.feishuVerificationToken) {
    throw new Error("Invalid verification token");
  }
}

const SEEN_EVENTS_MAX = 1000;

export function createTodoBotApp(config: AppConfig, deps: TodoBotDependencies = {}): TodoBotApp {
  const client = new FeishuClient(config, deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {});
  const aiClient = new AIClient(config);
  const seenEvents = new Set<string>();

  function rememberEvent(eventId: string): void {
    seenEvents.add(eventId);
    if (seenEvents.size > SEEN_EVENTS_MAX) {
      // Drop oldest entries to keep the set bounded.
      const overflow = seenEvents.size - SEEN_EVENTS_MAX;
      const iterator = seenEvents.values();
      for (let i = 0; i < overflow; i += 1) {
        const next = iterator.next();
        if (next.done) break;
        seenEvents.delete(next.value);
      }
    }
  }

  async function handleMessageEvent(envelope: FeishuEventEnvelope<FeishuMessageReceiveEvent>): Promise<Response> {
    if (seenEvents.has(envelope.header.event_id)) {
      return jsonResponse({ ok: true, deduped: true });
    }
    rememberEvent(envelope.header.event_id);

    const message = envelope.event.message;
    if (!message) {
      return jsonResponse({ ok: true });
    }

    // 处理图片消息
    if (isImageMessage(envelope.event)) {
      console.log("  ↳ 检测到图片消息，开始识别...");
      try {
        await client.handleImageMessage({
          messageId: message.message_id,
          event: envelope.event,
          aiClient,
        });
        return jsonResponse({ ok: true });
      } catch (error) {
        console.error("  ↳ 图片识别失败:", error instanceof Error ? error.message : error);
        await client.replyText(message.message_id, "❌ 图片识别失败，请稍后重试");
        return jsonResponse({ ok: true });
      }
    }

    const text = parseMessageText(envelope.event);
    if (!text) {
      return jsonResponse({ ok: true });
    }

    if (shouldShowHelp(text)) {
      await client.replyText(message.message_id, HELP_TEXT);
      return jsonResponse({ ok: true });
    }

    // 处理优化命令
    if (shouldOptimizeTasks(text)) {
      console.log("  ↳ 检测到优化命令，开始分析...");
      try {
        await client.handleOptimizeCommand({
          messageId: message.message_id,
          aiClient,
        });
        return jsonResponse({ ok: true });
      } catch (error) {
        console.error("  ↳ 智能优化失败:", error instanceof Error ? error.message : error);
        await client.replyText(message.message_id, "❌ 智能优化失败，请稍后重试");
        return jsonResponse({ ok: true });
      }
    }

    if (shouldShowTodayTasks(text)) {
      await client.handleTodayTasksReply(message.message_id);
      return jsonResponse({ ok: true });
    }

    if (shouldShowTomorrowTasks(text)) {
      await client.handleTomorrowTasksReply(message.message_id);
      return jsonResponse({ ok: true });
    }

    const draft = parseTaskText(text, { timeZone: config.timezone });
    const parsed = draft.fallbackUsed
      ? (await maybeRefineParseWithOpenAI({
          ...(config.openaiApiKey ? { apiKey: config.openaiApiKey } : {}),
          model: config.openaiModel,
          originalText: text,
          draft,
          timeZone: config.timezone,
          now: Date.now(),
        })) ?? draft
      : draft;

    const createParams: { parsed: typeof parsed; actorOpenId?: string } = { parsed };
    const actorOpenId = envelope.event.sender?.sender_id?.open_id;
    if (actorOpenId) {
      createParams.actorOpenId = actorOpenId;
    }
    const task = await client.createTask(createParams);
    await client.handleCreatedTaskReply({
      messageId: message.message_id,
      parsed,
      task,
    });

    return jsonResponse({ ok: true });
  }

  async function handleCardAction(envelope: FeishuEventEnvelope<FeishuCardActionEvent>): Promise<Response> {
    const result = await client.handleCardAction(envelope.event);
    return jsonResponse(result);
  }

  async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return textResponse("ok");
    }

    if (request.method !== "POST") {
      return textResponse("Method Not Allowed", 405);
    }

    if (url.pathname !== "/feishu/events") {
      return textResponse("Not Found", 404);
    }

    const raw = await request.json().catch(() => null);
    if (!raw) {
      return textResponse("Bad Request", 400);
    }

    let decrypted: unknown;
    try {
      decrypted = decryptIfNeeded(raw, config);
    } catch (err) {
      console.error("  ↳ ❌ 解密失败:", err instanceof Error ? err.message : err);
      return textResponse("Bad Request", 400);
    }
    if (!decrypted || typeof decrypted !== "object") {
      console.error("  ↳ ❌ 解密后数据无效");
      return textResponse("Bad Request", 400);
    }

    const envelope = decrypted as FeishuEventEnvelope<unknown>;

    // 输出解密后的内容概要，方便调试
    if (typeof envelope.challenge === "string") {
      console.log(`  ↳ 解密后类型: URL 验证 (challenge)`);
      return jsonResponse({ challenge: envelope.challenge });
    }
    if (envelope.header?.event_type) {
      console.log(`  ↳ 解密后事件: ${envelope.header.event_type}`);
    } else {
      console.log(`  ↳ ⚠️ 解密后内容:`, JSON.stringify(decrypted).slice(0, 300));
    }

    try {
      validateEnvelope(config, envelope);
    } catch (err) {
      console.error("  ↳ ❌ Token 验证失败:", err instanceof Error ? err.message : err);
      return textResponse("Unauthorized", 401);
    }

    switch (envelope.header?.event_type) {
      case "im.message.receive_v1":
        return handleMessageEvent(envelope as FeishuEventEnvelope<FeishuMessageReceiveEvent>);
      case "card.action.trigger":
        return handleCardAction(envelope as FeishuEventEnvelope<FeishuCardActionEvent>);
      default:
        console.log(`  ↳ 已忽略事件: ${envelope.header?.event_type ?? "(无 event_type)"}`);
        return jsonResponse({ ok: true, ignored: envelope.header?.event_type });
    }
  }

  return { handler };
}
