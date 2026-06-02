/**
 * 时间工具：在指定时区下格式化日期
 */

export function formatYmdInTimezone(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

/**
 * 把毫秒时间戳格式化成 "MM-DD HH:mm" 形式
 */
export function formatShortDateTime(timestamp: number, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(new Date(timestamp));
}

/**
 * 比较给定时间戳和"今天结束（23:59:59）"的关系
 * 返回:
 *   "overdue"  - 已逾期（早于今天 00:00）
 *   "today"    - 今天到期
 *   "future"   - 未来
 */
export function classifyDue(timestamp: number, timezone: string): "overdue" | "today" | "future" {
  const todayYmd = formatYmdInTimezone(new Date(), timezone);
  const dueYmd = formatYmdInTimezone(new Date(timestamp), timezone);
  if (dueYmd < todayYmd) return "overdue";
  if (dueYmd === todayYmd) return "today";
  return "future";
}
