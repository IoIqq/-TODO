import assert from "node:assert/strict";
import test from "node:test";
import { parseTodoDrafts } from "../src/parser.js";
import { getZonedParts } from "../src/time.js";

const timeZone = "Asia/Shanghai";

test("parses multiple todos from one message", () => {
  const now = Date.UTC(2026, 4, 24, 8, 0, 0);
  const parsed = parseTodoDrafts("明天 3 点提交周报 p1；整理方案 备注: 带截图", { now, timeZone, assigneeOpenId: "ou_1" });
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.title, "提交周报");
  assert.equal(parsed[0]?.priority, "high");
  assert.ok(parsed[0]?.due);
  const dueParts = getZonedParts(Number(parsed[0]?.due?.timestamp), timeZone);
  assert.equal(dueParts.year, 2026);
  assert.equal(dueParts.month, 5);
  assert.equal(dueParts.day, 25);
  assert.equal(parsed[1]?.title, "整理方案");
  assert.equal(parsed[1]?.notes, "带截图");
});

test("handles weekday deadline as all-day", () => {
  const now = Date.UTC(2026, 4, 24, 8, 0, 0);
  const parsed = parseTodoDrafts("下周一 提交材料", { now, timeZone });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.title, "提交材料");
  assert.ok(parsed[0]?.due);
  assert.equal(parsed[0]?.due?.is_all_day, true);
});

test("applies afternoon and evening period to minute times", () => {
  const now = Date.UTC(2026, 4, 24, 8, 0, 0);
  const parsed = parseTodoDrafts("明天下午3:30提交报告；晚上8:15开会", { now, timeZone });

  const firstDue = getZonedParts(Number(parsed[0]?.due?.timestamp), timeZone);
  assert.equal(firstDue.hour, 15);
  assert.equal(firstDue.minute, 30);

  const secondDue = getZonedParts(Number(parsed[1]?.due?.timestamp), timeZone);
  assert.equal(secondDue.hour, 20);
  assert.equal(secondDue.minute, 15);
});

test("matches day after tomorrow before tomorrow", () => {
  const now = Date.UTC(2026, 4, 24, 8, 0, 0);
  const parsed = parseTodoDrafts("大后天提交材料", { now, timeZone });
  const due = getZonedParts(Number(parsed[0]?.due?.timestamp), timeZone);

  assert.equal(due.month, 5);
  assert.equal(due.day, 27);
});

test("all-day deadlines end at 23:59 in app timezone", () => {
  const now = Date.UTC(2026, 4, 24, 8, 0, 0);
  const parsed = parseTodoDrafts("明天提交材料", { now, timeZone });
  const due = getZonedParts(Number(parsed[0]?.due?.timestamp), timeZone);

  assert.equal(due.hour, 23);
  assert.equal(due.minute, 59);
});

test("parses explicit start time separately from deadline", () => {
  const now = Date.UTC(2026, 4, 24, 8, 0, 0);
  const parsed = parseTodoDrafts("明天9点开始写周报，明天下午5点提交", { now, timeZone });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.title, "写周报 提交");
  assert.ok(parsed[0]?.start);
  assert.ok(parsed[0]?.due);

  const start = getZonedParts(Number(parsed[0]?.start?.timestamp), timeZone);
  assert.equal(start.month, 5);
  assert.equal(start.day, 25);
  assert.equal(start.hour, 9);
  assert.equal(start.minute, 0);

  const due = getZonedParts(Number(parsed[0]?.due?.timestamp), timeZone);
  assert.equal(due.month, 5);
  assert.equal(due.day, 25);
  assert.equal(due.hour, 17);
  assert.equal(due.minute, 0);
});

test("parses explicit start time without deadline", () => {
  const now = Date.UTC(2026, 4, 24, 8, 0, 0);
  const parsed = parseTodoDrafts("明天9点开始写周报", { now, timeZone });

  assert.equal(parsed[0]?.title, "写周报");
  assert.ok(parsed[0]?.start);
  assert.equal(parsed[0]?.due, undefined);
  assert.equal(parsed[0]?.fallbackUsed, false);
});

test("weekday parsing does not match bare Chinese weekday characters", () => {
  const now = Date.UTC(2026, 4, 24, 8, 0, 0);
  const parsed = parseTodoDrafts("整理一天的材料", { now, timeZone });

  assert.equal(parsed[0]?.title, "整理一天的材料");
  assert.equal(parsed[0]?.due, undefined);
});
