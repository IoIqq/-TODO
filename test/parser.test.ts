import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskText } from "../src/parser.js";
import { getZonedParts } from "../src/time.js";

const timeZone = "Asia/Shanghai";

test("parses tomorrow task with priority", () => {
  const now = Date.UTC(2026, 4, 24, 8, 0, 0);
  const parsed = parseTaskText("明天 3 点 提交周报 p1", { now, timeZone });
  assert.equal(parsed.title, "提交周报");
  assert.equal(parsed.priority, "high");
  assert.ok(parsed.due);
  assert.equal(parsed.due?.is_all_day, false);
  const dueParts = getZonedParts(Number(parsed.due?.timestamp), timeZone);
  assert.equal(dueParts.year, 2026);
  assert.equal(dueParts.month, 5);
  assert.equal(dueParts.day, 25);
});

test("parses weekday deadline as all-day", () => {
  const now = Date.UTC(2026, 4, 24, 8, 0, 0);
  const parsed = parseTaskText("下周一 之前 交材料", { now, timeZone });
  assert.equal(parsed.title, "之前 交材料");
  assert.ok(parsed.due);
  assert.equal(parsed.due?.is_all_day, true);
});

test("keeps notes after explicit marker", () => {
  const parsed = parseTaskText("整理方案 明天 备注: 要附上截图和链接", { now: Date.UTC(2026, 4, 24, 8, 0, 0), timeZone });
  assert.equal(parsed.title, "整理方案");
  assert.equal(parsed.notes, "要附上截图和链接");
});

test("handles repeated priority markers", () => {
  const parsed = parseTaskText("P1 P3 提交材料 今天", { now: Date.UTC(2026, 4, 24, 8, 0, 0), timeZone });
  assert.equal(parsed.priority, "high");
  assert.ok(parsed.fallbackUsed);
});
