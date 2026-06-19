import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DeadlineReminderScheduler } from "../src/scheduler/deadline-reminder.js";
import { closeDatabase, getDb, initDatabase, scheduleReminders } from "../src/storage/index.js";

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
  enableChatMemory: false,
  chatMemoryLength: 10,
  larkCliPath: "lark-cli",
  enableSmartAssistant: false,
  cliTimeout: 30000,
  cliConfirmActions: [],
  cliLogEnabled: false,
  enableDailyReminder: true,
  dailyMorningCron: "30 8 * * *",
  dailyEveningCron: "30 18 * * *",
  enableDeadlineReminder: true,
  deadlineReminderCron: "* * * * *",
} as const;

function setupDb(): void {
  closeDatabase();
  initDatabase(mkdtempSync(path.join(tmpdir(), "deadline-scheduler-")));
}

test.afterEach(() => {
  closeDatabase();
});

test("overdue card includes today's date", async () => {
  setupDb();
  const now = Date.UTC(2026, 5, 6, 8, 0, 0);
  scheduleReminders({ recordId: "rec", title: "Task", priority: "🔴P0-高优", dueTimestamp: now, assigneeOpenId: "ou_1" }, now);

  const cardTexts: string[] = [];
  const scheduler = new DeadlineReminderScheduler({
    config,
    feishuClient: {
      sendCardToUser: async (_openId: string, card: Record<string, unknown>) => {
        cardTexts.push(JSON.stringify(card));
      },
      listRecords: async () => [],
    } as any,
  });

  await scheduler.runOnce(now);

  assert.match(cardTexts[0] ?? "", /今天日期：2026-06-06/);
});

test("start reminders send start card without scheduling overdue repeat", async () => {
  setupDb();
  const now = Date.UTC(2026, 5, 6, 8, 0, 0);
  const due = now + 2 * 60 * 60 * 1000;
  scheduleReminders({ recordId: "rec", title: "Task", priority: "🟡P1-一般", dueTimestamp: due, startTimestamp: now, assigneeOpenId: "ou_1" }, now);

  const cardTexts: string[] = [];
  const scheduler = new DeadlineReminderScheduler({
    config,
    feishuClient: {
      sendCardToUser: async (_openId: string, card: Record<string, unknown>) => {
        cardTexts.push(JSON.stringify(card));
      },
      listRecords: async () => [],
    } as any,
  });

  const result = await scheduler.runOnce(now);

  assert.equal(result.alertedUsers, 1);
  assert.equal(result.alertedTasks, 1);
  assert.equal(result.scheduledNext, 0);
  assert.match(cardTexts[0] ?? "", /待办开始提醒/);
  assert.match(cardTexts[0] ?? "", /开始：/);
});

test("reconcile preserves sent overdue progress", async () => {
  setupDb();
  const now = Date.UTC(2026, 5, 6, 8, 0, 0);
  scheduleReminders({ recordId: "rec", title: "Task", priority: "🔴P0-高优", dueTimestamp: now, assigneeOpenId: "ou_1" }, now);

  const senderScheduler = new DeadlineReminderScheduler({
    config,
    feishuClient: {
      sendCardToUser: async () => {},
      listRecords: async () => [],
    } as any,
  });
  await senderScheduler.runOnce(now);

  const reconcileAt = now + 60_000;
  const scheduler = new DeadlineReminderScheduler({
    config,
    feishuClient: {
      sendCardToUser: async () => {},
      listRecords: async () => [{
        record_id: "rec",
        fields: {
          "待办事项": "Task",
          "优先级": "🔴P0-高优",
          "截止日期": now,
          "执行人": [{ id: "ou_1" }],
          "是否已完成": false,
        },
      }],
    } as any,
  });

  await scheduler.reconcile(reconcileAt);

  const pending = getDb().prepare("SELECT kind, sequence FROM deadline_reminders WHERE status = 'pending' ORDER BY id").all() as Array<{ kind: string; sequence: number }>;
  assert.deepEqual(pending, [{ kind: "overdue", sequence: 1 }]);
});

test("claim sends, marks sent, and schedules next overdue", async () => {
  setupDb();
  const now = Date.UTC(2026, 5, 6, 8, 0, 0);
  scheduleReminders({ recordId: "rec", title: "Task", priority: "🔴P0-高优", dueTimestamp: now, assigneeOpenId: "ou_1" }, now);

  const sentCards: Array<Record<string, unknown>> = [];
  const scheduler = new DeadlineReminderScheduler({
    config,
    feishuClient: {
      sendCardToUser: async (_openId: string, card: Record<string, unknown>) => {
        sentCards.push(card);
      },
      listRecords: async () => [],
    } as any,
  });

  const result = await scheduler.runOnce(now);
  assert.deepEqual(result, { alertedUsers: 1, alertedTasks: 1, scheduledNext: 1 });
  assert.equal(sentCards.length, 1);

  const rows = getDb().prepare("SELECT status, sequence FROM deadline_reminders ORDER BY id").all() as Array<{ status: string; sequence: number }>;
  assert.deepEqual(rows, [
    { status: "sent", sequence: 0 },
    { status: "pending", sequence: 1 },
  ]);
});

test("send failure releases reminders back to pending", async () => {
  setupDb();
  const now = Date.UTC(2026, 5, 6, 8, 0, 0);
  scheduleReminders({ recordId: "rec", title: "Task", priority: "🔴P0-高优", dueTimestamp: now, assigneeOpenId: "ou_1" }, now);

  const scheduler = new DeadlineReminderScheduler({
    config,
    feishuClient: {
      sendCardToUser: async () => {
        throw new Error("network down");
      },
      listRecords: async () => [],
    } as any,
  });

  const result = await scheduler.runOnce(now);
  assert.deepEqual(result, { alertedUsers: 0, alertedTasks: 0, scheduledNext: 0 });

  const row = getDb().prepare("SELECT status FROM deadline_reminders WHERE record_id = 'rec'").get() as { status: string };
  assert.equal(row.status, "pending");
});

test("more than ten reminders are split into multiple cards", async () => {
  setupDb();
  const now = Date.UTC(2026, 5, 6, 8, 0, 0);
  for (let index = 0; index < 12; index += 1) {
    scheduleReminders({ recordId: `rec_${index}`, title: `Task ${index}`, priority: "🟢P2-低优", dueTimestamp: now, assigneeOpenId: "ou_1" }, now);
  }

  const cardTexts: string[] = [];
  const scheduler = new DeadlineReminderScheduler({
    config,
    feishuClient: {
      sendCardToUser: async (_openId: string, card: Record<string, unknown>) => {
        cardTexts.push(JSON.stringify(card));
      },
      listRecords: async () => [],
    } as any,
  });

  const result = await scheduler.runOnce(now);
  assert.equal(result.alertedUsers, 2);
  assert.equal(result.alertedTasks, 12);
  assert.equal(cardTexts.length, 2);
  assert.match(cardTexts[0] ?? "", /有 10 个待办/);
  assert.match(cardTexts[1] ?? "", /有 2 个待办/);

  const sent = getDb().prepare("SELECT COUNT(*) AS count FROM deadline_reminders WHERE status = 'sent'").get() as { count: number };
  assert.equal(sent.count, 12);
});
