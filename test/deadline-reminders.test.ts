import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cancelReminders,
  claimDueReminders,
  closeDatabase,
  getDb,
  initDatabase,
  markSent,
  scheduleNextOverdue,
  scheduleReminders,
} from "../src/storage/index.js";

function setupDb(): void {
  closeDatabase();
  initDatabase(mkdtempSync(path.join(tmpdir(), "deadline-reminders-")));
}

test.afterEach(() => {
  closeDatabase();
});

test("schedules priority-based reminders", () => {
  setupDb();
  const now = Date.UTC(2026, 5, 6, 8, 0, 0);
  const due = now + 2 * 60 * 60 * 1000;

  scheduleReminders({ recordId: "rec_p0", title: "P0", priority: "🔴P0-高优", dueTimestamp: due, assigneeOpenId: "ou_1" }, now);
  scheduleReminders({ recordId: "rec_p1", title: "P1", priority: "🟡P1-一般", dueTimestamp: due, assigneeOpenId: "ou_1" }, now);
  scheduleReminders({ recordId: "rec_p2", title: "P2", priority: "🟢P2-低优", dueTimestamp: due, assigneeOpenId: "ou_1" }, now);

  const rows = getDb().prepare("SELECT record_id, kind, alert_time FROM deadline_reminders ORDER BY record_id, kind").all() as Array<{ record_id: string; kind: string; alert_time: number }>;

  assert.equal(rows.filter((row) => row.record_id === "rec_p0").length, 2);
  assert.equal(rows.find((row) => row.record_id === "rec_p0" && row.kind === "before")?.alert_time, due - 60 * 60 * 1000);
  assert.equal(rows.filter((row) => row.record_id === "rec_p1").length, 2);
  assert.equal(rows.find((row) => row.record_id === "rec_p1" && row.kind === "before")?.alert_time, due - 30 * 60 * 1000);
  assert.equal(rows.filter((row) => row.record_id === "rec_p2").length, 1);
  assert.equal(rows.find((row) => row.record_id === "rec_p2")?.kind, "overdue");
});

test("schedules start reminders at start time", () => {
  setupDb();
  const now = Date.UTC(2026, 5, 6, 8, 0, 0);
  const start = now + 30 * 60 * 1000;
  const due = now + 2 * 60 * 60 * 1000;

  scheduleReminders({ recordId: "rec_start", title: "Task", priority: "🟡P1-一般", dueTimestamp: due, startTimestamp: start, assigneeOpenId: "ou_1" }, now);

  const rows = getDb().prepare("SELECT kind, start_timestamp, alert_time FROM deadline_reminders ORDER BY alert_time, kind").all() as Array<{ kind: string; start_timestamp: number | null; alert_time: number }>;
  assert.deepEqual(rows.map((row) => row.kind), ["start", "before", "overdue"]);
  assert.equal(rows[0]?.start_timestamp, start);
  assert.equal(rows[0]?.alert_time, start);

  const claimed = claimDueReminders(start, 10);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]?.kind, "start");
  assert.equal(scheduleNextOverdue(claimed[0]!, start), false);
});

test("schedules start reminders without due timestamp", () => {
  setupDb();
  const now = Date.UTC(2026, 5, 6, 8, 0, 0);
  const start = now + 30 * 60 * 1000;

  scheduleReminders({ recordId: "rec_start_only", title: "Task", priority: "🟡P1-一般", startTimestamp: start, assigneeOpenId: "ou_1" }, now);

  const rows = getDb().prepare("SELECT kind, due_timestamp, start_timestamp, alert_time FROM deadline_reminders ORDER BY id").all() as Array<{ kind: string; due_timestamp: number | null; start_timestamp: number | null; alert_time: number }>;
  assert.deepEqual(rows, [{ kind: "start", due_timestamp: null, start_timestamp: start, alert_time: start }]);
});

test("schedules overdue only when due time has passed", () => {
  setupDb();
  const now = Date.UTC(2026, 5, 6, 8, 0, 0);

  scheduleReminders({ recordId: "rec", title: "Task", priority: "🔴P0-高优", dueTimestamp: now, assigneeOpenId: "ou_1" }, now);

  const rows = getDb().prepare("SELECT kind FROM deadline_reminders").all() as Array<{ kind: string }>;
  assert.deepEqual(rows.map((row) => row.kind), ["overdue"]);
});

test("rescheduling replaces old pending reminders", () => {
  setupDb();
  const now = Date.UTC(2026, 5, 6, 8, 0, 0);
  const firstDue = now + 60 * 60 * 1000;
  const secondDue = now + 3 * 60 * 60 * 1000;

  scheduleReminders({ recordId: "rec", title: "Task", priority: "🔴P0-高优", dueTimestamp: firstDue, assigneeOpenId: "ou_1" }, now);
  scheduleReminders({ recordId: "rec", title: "Task", priority: "🔴P0-高优", dueTimestamp: secondDue, assigneeOpenId: "ou_1" }, now + 1000);

  const pending = getDb().prepare("SELECT due_timestamp FROM deadline_reminders WHERE status = 'pending'").all() as Array<{ due_timestamp: number }>;
  const cancelled = getDb().prepare("SELECT COUNT(*) AS count FROM deadline_reminders WHERE status = 'cancelled'").get() as { count: number };

  assert.equal(pending.length, 2);
  assert.ok(pending.every((row) => row.due_timestamp === secondDue));
  assert.equal(cancelled.count, 2);
});

test("cancel prevents claimed reminders from being marked sent", () => {
  setupDb();
  const now = Date.UTC(2026, 5, 6, 8, 0, 0);
  scheduleReminders({ recordId: "rec", title: "Task", priority: "🔴P0-高优", dueTimestamp: now, assigneeOpenId: "ou_1" }, now);

  const [reminder] = claimDueReminders(now, 10);
  assert.ok(reminder);
  cancelReminders("rec", now + 1);

  assert.equal(markSent(reminder.id, now + 2), false);
  const row = getDb().prepare("SELECT status FROM deadline_reminders WHERE id = ?").get(reminder.id) as { status: string };
  assert.equal(row.status, "cancelled");
});

test("P0 overdue reminders stop at sequence 2", () => {
  setupDb();
  const now = Date.UTC(2026, 5, 6, 8, 0, 0);
  scheduleReminders({ recordId: "rec", title: "Task", priority: "🔴P0-高优", dueTimestamp: now, assigneeOpenId: "ou_1" }, now);

  let [reminder] = claimDueReminders(now, 10);
  assert.ok(reminder);
  assert.equal(scheduleNextOverdue(reminder, now), true);

  reminder = claimDueReminders(now + 10 * 60 * 1000, 10)[0];
  assert.ok(reminder);
  assert.equal(reminder.sequence, 1);
  assert.equal(scheduleNextOverdue(reminder, now + 10 * 60 * 1000), true);

  reminder = claimDueReminders(now + 20 * 60 * 1000, 10)[0];
  assert.ok(reminder);
  assert.equal(reminder.sequence, 2);
  assert.equal(scheduleNextOverdue(reminder, now + 20 * 60 * 1000), false);
});
