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
