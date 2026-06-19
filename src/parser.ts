import { allDayDeadlineUtcMs, formatDateKey, formatDateTime, getZonedParts, zonedDateTimeToUtcMs } from "./time.js";
import type { TaskPriority, TodoDraft } from "./types.js";

const PRIORITY_PATTERNS: Array<{ priority: TaskPriority; patterns: RegExp[] }> = [
  { priority: "high", patterns: [/\bp1\b/gi, /紧急/g, /高优先级/g, /高优/g] },
  { priority: "medium", patterns: [/\bp2\b/gi, /中优先级/g, /中优/g, /普通/g, /一般/g] },
  { priority: "low", patterns: [/\bp3\b/gi, /低优先级/g, /低优/g, /稍后/g] },
];

const ITEM_SPLIT_PATTERNS = [/\n+/, /；/g, /;+/g, /，然后/g, /以及/g, /\s+和\s+/g];

const WEEKDAY_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
};

type ParsedTemporal = { timestamp: string; is_all_day: boolean };

const DATE_TEMPORAL_HINT = String.raw`(?:大后天|后天|明天|今天|20\d{2}[年\/.-]\d{1,2}[月\/.-]\d{1,2}日?|\d{1,2}[月\/.-]\d{1,2}日?|(?:下下|下|本|这)?(?:星期|礼拜|周)[一二三四五六日天])`;
const TIME_TEMPORAL_HINT = String.raw`(?:(?:上午|下午|晚上|中午|凌晨)?\s*\d{1,2}\s*(?:[:点时]\s*\d{1,2}|[:点时]|半))`;
const START_TEMPORAL_HINT = String.raw`(?:${DATE_TEMPORAL_HINT}\s*${TIME_TEMPORAL_HINT}?|${TIME_TEMPORAL_HINT})`;
const START_TEMPORAL_PATTERNS = [
  new RegExp(`(?:从\\s*)?${START_TEMPORAL_HINT}[^，。；;,.]{0,12}开始`),
  new RegExp(`开始时间\\s*[:：]?\\s*${START_TEMPORAL_HINT}`),
];

function cleanWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanTitle(value: string): string {
  return cleanWhitespace(value.replace(/[，。；;,.]+/g, " "));
}

function splitItems(text: string): string[] {
  const segments = [text];
  for (const pattern of ITEM_SPLIT_PATTERNS) {
    const next: string[] = [];
    for (const segment of segments) {
      next.push(...segment.split(pattern));
    }
    segments.splice(0, segments.length, ...next);
  }

  return segments.map(cleanWhitespace).filter(Boolean);
}

function detectPriority(text: string): { priority: TaskPriority; cleaned: string; ambiguous: boolean } {
  const hits = PRIORITY_PATTERNS.filter(({ patterns }) => patterns.some((pattern) => pattern.test(text)));
  if (hits.length === 0) {
    return { priority: "medium", cleaned: text, ambiguous: false };
  }

  let cleaned = text;
  for (const hit of hits) {
    for (const pattern of hit.patterns) {
      cleaned = cleaned.replace(pattern, " ");
    }
  }

  const priorities = new Set(hits.map((hit) => hit.priority));
  const priority = priorities.has("high") ? "high" : priorities.has("low") ? "low" : "medium";
  return { priority, cleaned: cleanWhitespace(cleaned), ambiguous: priorities.size > 1 };
}

function normalizeWeekdayToken(token: string): number | null {
  const value = WEEKDAY_MAP[token];
  return typeof value === "number" ? value : null;
}

function parseAbsoluteDate(text: string, nowTimestamp: number, timeZone: string): { match: RegExpMatchArray | null; year: number; month: number; day: number } {
  const full = text.match(/(20\d{2})[年\/.-](\d{1,2})[月\/.-](\d{1,2})日?/);
  if (full) {
    return { match: full, year: Number(full[1]), month: Number(full[2]), day: Number(full[3]) };
  }

  const short = text.match(/(\d{1,2})[月\/.-](\d{1,2})日?/);
  if (short) {
    const current = getZonedParts(nowTimestamp, timeZone);
    return { match: short, year: current.year, month: Number(short[1]), day: Number(short[2]) };
  }

  return { match: null, year: 0, month: 0, day: 0 };
}

function applyPeriod(hour: number, period: string | undefined): number {
  if (period === "下午" || period === "晚上") {
    return hour < 12 ? hour + 12 : hour;
  }
  if (period === "中午") {
    return hour < 11 ? hour + 12 : hour;
  }
  if (period === "凌晨" || period === "上午") {
    return hour === 12 ? 0 : hour;
  }
  return hour;
}

function parseTimeToken(text: string): { match: RegExpMatchArray | null; hour: number; minute: number } {
  const withMinute = text.match(/(上午|下午|晚上|中午|凌晨)?\s*(\d{1,2})\s*[:点时]\s*(\d{1,2})/);
  if (withMinute) {
    return {
      match: withMinute,
      hour: applyPeriod(Number(withMinute[2]), withMinute[1]),
      minute: Number(withMinute[3]),
    };
  }

  const withHalf = text.match(/(上午|下午|晚上|中午|凌晨)?\s*(\d{1,2})\s*半/);
  if (withHalf) {
    return {
      match: withHalf,
      hour: applyPeriod(Number(withHalf[2]), withHalf[1]),
      minute: 30,
    };
  }

  const withHourOnly = text.match(/(上午|下午|晚上|中午|凌晨)?\s*(\d{1,2})\s*[:点时]/);
  if (!withHourOnly) {
    return { match: null, hour: 0, minute: 0 };
  }

  return { match: withHourOnly, hour: applyPeriod(Number(withHourOnly[2]), withHourOnly[1]), minute: 0 };
}

function parseWeekdayDate(
  text: string,
  nowTimestamp: number,
  timeZone: string,
): { match: RegExpMatchArray | null; year: number; month: number; day: number } {
  const match = text.match(/((?:下下|下|本|这)?(?:星期|礼拜|周))([一二三四五六日天])/);
  if (!match) {
    return { match: null, year: 0, month: 0, day: 0 };
  }

  const weekday = normalizeWeekdayToken(match[2] ?? "");
  if (weekday === null) {
    return { match: null, year: 0, month: 0, day: 0 };
  }

  const modifier = match[1] ?? "本周";
  const weekOffset = modifier.startsWith("下下") ? 2 : modifier.startsWith("下") ? 1 : 0;
  const current = getZonedParts(nowTimestamp, timeZone);
  const currentDate = new Date(Date.UTC(current.year, current.month - 1, current.day));
  const currentJsDay = currentDate.getUTCDay();
  const delta = (weekday - currentJsDay + 7) % 7 + weekOffset * 7;
  const targetDate = new Date(Date.UTC(current.year, current.month - 1, current.day + delta));

  return {
    match,
    year: targetDate.getUTCFullYear(),
    month: targetDate.getUTCMonth() + 1,
    day: targetDate.getUTCDate(),
  };
}

function extractNotes(text: string): { titleish: string; notes?: string } {
  const match = text.match(/(备注|说明|notes?|note)\s*[:：]\s*(.+)$/i);
  if (!match) {
    return { titleish: text };
  }

  return {
    titleish: text.slice(0, match.index).trim(),
    notes: (match[2] ?? "").trim(),
  };
}

function extractTemporalValue(text: string, nowTimestamp: number, timeZone: string): ParsedTemporal | undefined {
  const absolute = parseAbsoluteDate(text, nowTimestamp, timeZone);
  const timeToken = parseTimeToken(text);
  const hasTime = Boolean(timeToken.match);

  if (absolute.match) {
    if (hasTime) {
      return {
        timestamp: String(zonedDateTimeToUtcMs({
          year: absolute.year,
          month: absolute.month,
          day: absolute.day,
          hour: timeToken.hour,
          minute: timeToken.minute,
        }, timeZone)),
        is_all_day: false,
      };
    }
    return { timestamp: String(allDayDeadlineUtcMs(absolute.year, absolute.month, absolute.day, timeZone)), is_all_day: true };
  }

  const relativeMatchers: Array<[RegExp, number]> = [
    [/大后天/, 3],
    [/后天/, 2],
    [/明天/, 1],
    [/今天/, 0],
  ];

  for (const [pattern, offset] of relativeMatchers) {
    if (!pattern.test(text)) continue;
    const current = getZonedParts(nowTimestamp, timeZone);
    const base = new Date(Date.UTC(current.year, current.month - 1, current.day + offset));
    if (hasTime) {
      return {
        timestamp: String(zonedDateTimeToUtcMs({
          year: base.getUTCFullYear(),
          month: base.getUTCMonth() + 1,
          day: base.getUTCDate(),
          hour: timeToken.hour,
          minute: timeToken.minute,
        }, timeZone)),
        is_all_day: false,
      };
    }
    return { timestamp: String(allDayDeadlineUtcMs(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), timeZone)), is_all_day: true };
  }

  const weekday = parseWeekdayDate(text, nowTimestamp, timeZone);
  if (weekday.match) {
    if (hasTime) {
      return {
        timestamp: String(zonedDateTimeToUtcMs({
          year: weekday.year,
          month: weekday.month,
          day: weekday.day,
          hour: timeToken.hour,
          minute: timeToken.minute,
        }, timeZone)),
        is_all_day: false,
      };
    }
    return { timestamp: String(allDayDeadlineUtcMs(weekday.year, weekday.month, weekday.day, timeZone)), is_all_day: true };
  }

  if (hasTime) {
    const current = getZonedParts(nowTimestamp, timeZone);
    return {
      timestamp: String(zonedDateTimeToUtcMs({
        year: current.year,
        month: current.month,
        day: current.day,
        hour: timeToken.hour,
        minute: timeToken.minute,
      }, timeZone)),
      is_all_day: false,
    };
  }

  return undefined;
}

function removeStartTemporalTokens(text: string, nowTimestamp: number, timeZone: string): { cleaned: string; start?: ParsedTemporal } {
  for (const pattern of START_TEMPORAL_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;

    const matchedText = match[0];
    const start = extractTemporalValue(matchedText, nowTimestamp, timeZone);
    if (!start) continue;

    let cleaned = text.replace(matchedText, " ");
    cleaned = cleaned.replace(/\s*开始\s*/, " ");
    return { cleaned: cleanWhitespace(cleaned), start };
  }

  return { cleaned: cleanWhitespace(text) };
}

function removeTemporalTokens(text: string, nowTimestamp: number, timeZone: string): { cleaned: string; due?: ParsedTemporal } {
  let cleaned = text;
  const absolute = parseAbsoluteDate(cleaned, nowTimestamp, timeZone);
  const timeToken = parseTimeToken(cleaned);
  const hasTime = Boolean(timeToken.match);

  if (absolute.match) {
    cleaned = cleaned.replace(absolute.match[0], " ");
    if (timeToken.match) {
      cleaned = cleaned.replace(timeToken.match[0], " ");
    }

    if (hasTime) {
      const timestamp = zonedDateTimeToUtcMs(
        {
          year: absolute.year,
          month: absolute.month,
          day: absolute.day,
          hour: timeToken.hour,
          minute: timeToken.minute,
        },
        timeZone,
      );
      return { cleaned: cleanWhitespace(cleaned), due: { timestamp: String(timestamp), is_all_day: false } };
    }

    return { cleaned: cleanWhitespace(cleaned), due: { timestamp: String(allDayDeadlineUtcMs(absolute.year, absolute.month, absolute.day, timeZone)), is_all_day: true } };
  }

  const relativeMatchers: Array<[RegExp, number]> = [
    [/大后天/, 3],
    [/后天/, 2],
    [/明天/, 1],
    [/今天/, 0],
  ];

  for (const [pattern, offset] of relativeMatchers) {
    const match = cleaned.match(pattern);
    if (!match) continue;

    cleaned = cleaned.replace(match[0], " ");
    const current = getZonedParts(nowTimestamp, timeZone);
    const base = new Date(Date.UTC(current.year, current.month - 1, current.day + offset));

    if (hasTime) {
      cleaned = cleaned.replace(timeToken.match?.[0] ?? "", " ");
      const timestamp = zonedDateTimeToUtcMs(
        {
          year: base.getUTCFullYear(),
          month: base.getUTCMonth() + 1,
          day: base.getUTCDate(),
          hour: timeToken.hour,
          minute: timeToken.minute,
        },
        timeZone,
      );
      return { cleaned: cleanWhitespace(cleaned), due: { timestamp: String(timestamp), is_all_day: false } };
    }

    return {
      cleaned: cleanWhitespace(cleaned),
      due: { timestamp: String(allDayDeadlineUtcMs(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), timeZone)), is_all_day: true },
    };
  }

  const weekday = parseWeekdayDate(cleaned, nowTimestamp, timeZone);
  if (weekday.match) {
    cleaned = cleaned.replace(weekday.match[0], " ");
    if (hasTime) {
      cleaned = cleaned.replace(timeToken.match?.[0] ?? "", " ");
      const timestamp = zonedDateTimeToUtcMs(
        {
          year: weekday.year,
          month: weekday.month,
          day: weekday.day,
          hour: timeToken.hour,
          minute: timeToken.minute,
        },
        timeZone,
      );
      return { cleaned: cleanWhitespace(cleaned), due: { timestamp: String(timestamp), is_all_day: false } };
    }

    return {
      cleaned: cleanWhitespace(cleaned),
      due: { timestamp: String(allDayDeadlineUtcMs(weekday.year, weekday.month, weekday.day, timeZone)), is_all_day: true },
    };
  }

  if (hasTime) {
    cleaned = cleaned.replace(timeToken.match?.[0] ?? "", " ");
    const current = getZonedParts(nowTimestamp, timeZone);
    const timestamp = zonedDateTimeToUtcMs(
      {
        year: current.year,
        month: current.month,
        day: current.day,
        hour: timeToken.hour,
        minute: timeToken.minute,
      },
      timeZone,
    );
    return { cleaned: cleanWhitespace(cleaned), due: { timestamp: String(timestamp), is_all_day: false } };
  }

  return { cleaned: cleanWhitespace(cleaned) };
}

function parseOneTodo(text: string, options: { now: number; timeZone: string; assigneeOpenId?: string }): TodoDraft {
  const normalized = cleanWhitespace(text);
  const priorityResult = detectPriority(normalized);
  const noteResult = extractNotes(priorityResult.cleaned);
  const startResult = removeStartTemporalTokens(noteResult.titleish, options.now, options.timeZone);
  const temporalResult = removeTemporalTokens(startResult.cleaned, options.now, options.timeZone);
  const title = cleanTitle(temporalResult.cleaned || startResult.cleaned || noteResult.titleish).replace(/\s*(待办|todo|任务)\s*$/i, "").trim();

  const result: TodoDraft = {
    title: title || normalized,
    priority: priorityResult.priority,
    fallbackUsed: priorityResult.ambiguous || !title || (!temporalResult.due && !startResult.start),
    ...(options.assigneeOpenId ? { assigneeOpenId: options.assigneeOpenId } : {}),
  };

  if (startResult.start) {
    result.start = startResult.start;
  }
  if (temporalResult.due) {
    result.due = temporalResult.due;
  }
  if (noteResult.notes) {
    result.notes = noteResult.notes;
  }

  return result;
}

export function parseTodoDrafts(text: string, options: { now?: number; timeZone: string; assigneeOpenId?: string }): TodoDraft[] {
  const now = options.now ?? Date.now();
  const extra = options.assigneeOpenId ? { assigneeOpenId: options.assigneeOpenId } : {};
  return splitItems(text).map((item) => parseOneTodo(item, { now, timeZone: options.timeZone, ...extra }));
}

export function formatTodoDraftSummary(task: TodoDraft, timeZone: string): string {
  const lines = [`标题：${task.title}`, `优先级：${task.priority}`];
  if (task.start) {
    const ts = Number(task.start.timestamp);
    const when = task.start.is_all_day ? formatDateKey(ts, timeZone) : formatDateTime(ts, timeZone);
    lines.push(`开始：${when}${task.start.is_all_day ? "（全天）" : ""}`);
  }
  if (task.due) {
    const ts = Number(task.due.timestamp);
    const when = task.due.is_all_day ? formatDateKey(ts, timeZone) : formatDateTime(ts, timeZone);
    lines.push(`截止：${when}${task.due.is_all_day ? "（全天）" : ""}`);
  }
  if (task.notes) {
    lines.push(`备注：${task.notes}`);
  }
  return lines.join("\n");
}

export function hasAmbiguousFields(drafts: TodoDraft[]): boolean {
  return drafts.some((draft) => draft.fallbackUsed);
}
