import { formatDateKey, formatDateTime, getZonedParts, utcMidnightForDate, zonedDateTimeToUtcMs } from "./time.js";
import type { ParsedTask, TaskPriority } from "./types.js";

const PRIORITY_PATTERNS: Array<{ priority: TaskPriority; patterns: RegExp[] }> = [
  { priority: "high", patterns: [/\bp1\b/gi, /紧急/g, /高优先级/g, /高优先/g] },
  { priority: "medium", patterns: [/\bp2\b/gi, /中优先级/g, /中优先/g, /普通/g, /一般/g] },
  { priority: "low", patterns: [/\bp3\b/gi, /低优先级/g, /低优先/g, /稍后/g] },
];

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

function cleanWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

function parseAbsoluteDate(text: string): { match: RegExpMatchArray | null; year: number; month: number; day: number } {
  const full = text.match(/(20\d{2})[年\-/.](\d{1,2})[月\-/.](\d{1,2})日?/);
  if (full) {
    return { match: full, year: Number(full[1]), month: Number(full[2]), day: Number(full[3]) };
  }

  const short = text.match(/(\d{1,2})[月\-/.](\d{1,2})日?/);
  if (short) {
    return { match: short, year: new Date().getFullYear(), month: Number(short[1]), day: Number(short[2]) };
  }

  return { match: null, year: 0, month: 0, day: 0 };
}

function parseTimeToken(text: string): { match: RegExpMatchArray | null; hour: number; minute: number } {
  const withMinute = text.match(/(上午|下午|晚上|中午|凌晨)?\s*(\d{1,2})\s*[:点时]\s*(\d{1,2})/);
  if (withMinute) {
    return {
      match: withMinute,
      hour: Number(withMinute[2]),
      minute: Number(withMinute[3]),
    };
  }

  const withHalf = text.match(/(上午|下午|晚上|中午|凌晨)?\s*(\d{1,2})\s*半/);
  if (withHalf) {
    return {
      match: withHalf,
      hour: Number(withHalf[2]),
      minute: 30,
    };
  }

  const withHourOnly = text.match(/(上午|下午|晚上|中午|凌晨)?\s*(\d{1,2})\s*[:点时]/);
  if (!withHourOnly) {
    return { match: null, hour: 0, minute: 0 };
  }

  let hour = Number(withHourOnly[2]);
  const minute = 0;
  const period = withHourOnly[1];

  if (period === "下午" || period === "晚上") {
    if (hour < 12) hour += 12;
  } else if (period === "中午") {
    if (hour < 11) hour += 12;
  } else if (period === "凌晨" || period === "上午") {
    if (hour === 12) hour = 0;
  }

  return { match: withHourOnly, hour, minute };
}

function parseWeekdayDate(
  text: string,
  nowTimestamp: number,
  timeZone: string,
): { match: RegExpMatchArray | null; year: number; month: number; day: number } {
  const match = text.match(/(下下周|下周|本周)?([一二三四五六日天])/);
  if (!match) {
    return { match: null, year: 0, month: 0, day: 0 };
  }

  const weekday = normalizeWeekdayToken(match[2] ?? "");
  if (weekday === null) {
    return { match: null, year: 0, month: 0, day: 0 };
  }

  const modifier = match[1] ?? "本周";
  const weekOffset = modifier === "下下周" ? 2 : modifier === "下周" ? 1 : 0;
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

function removeTemporalTokens(text: string, nowTimestamp: number, timeZone: string): { cleaned: string; due?: { timestamp: string; is_all_day: boolean } } {
  let cleaned = text;
  const absolute = parseAbsoluteDate(cleaned);
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

    return { cleaned: cleanWhitespace(cleaned), due: { timestamp: String(utcMidnightForDate(absolute.year, absolute.month, absolute.day)), is_all_day: true } };
  }

  const relativeMatchers: Array<[RegExp, number]> = [
    [/今天/, 0],
    [/明天/, 1],
    [/后天/, 2],
    [/大后天/, 3],
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
      due: { timestamp: String(utcMidnightForDate(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate())), is_all_day: true },
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
      due: { timestamp: String(utcMidnightForDate(weekday.year, weekday.month, weekday.day)), is_all_day: true },
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

export function parseTaskText(text: string, options: { now?: number; timeZone: string }): ParsedTask {
  const normalized = cleanWhitespace(text);
  const priorityResult = detectPriority(normalized);
  const noteResult = extractNotes(priorityResult.cleaned);
  const temporalResult = removeTemporalTokens(noteResult.titleish, options.now ?? Date.now(), options.timeZone);
  const title = cleanWhitespace(temporalResult.cleaned || noteResult.titleish).replace(/\s*(待办|todo|任务)\s*$/i, "").trim();

  const result: ParsedTask = {
    title: title || normalized,
    priority: priorityResult.priority,
    fallbackUsed: priorityResult.ambiguous || !title || !temporalResult.due,
  };

  if (temporalResult.due) {
    result.due = temporalResult.due;
  }
  if (noteResult.notes) {
    result.notes = noteResult.notes;
  }

  return result;
}

export function formatParsedTaskSummary(task: ParsedTask, timeZone: string): string {
  const lines = [`标题：${task.title}`, `优先级：${task.priority}`];
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
