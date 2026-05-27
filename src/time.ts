export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zeroPad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDateKey(timestamp: number, timeZone: string): string {
  const parts = getZonedParts(timestamp, timeZone);
  return `${parts.year}-${zeroPad(parts.month)}-${zeroPad(parts.day)}`;
}

export function formatDateTime(timestamp: number, timeZone: string): string {
  const parts = getZonedParts(timestamp, timeZone);
  return `${parts.year}-${zeroPad(parts.month)}-${zeroPad(parts.day)} ${zeroPad(parts.hour)}:${zeroPad(parts.minute)}`;
}

export function getZonedParts(timestamp: number, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp));

  const partMap = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(partMap.get("year")),
    month: Number(partMap.get("month")),
    day: Number(partMap.get("day")),
    hour: Number(partMap.get("hour")),
    minute: Number(partMap.get("minute")),
    second: Number(partMap.get("second")),
  };
}

export function utcMidnightForDate(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day, 0, 0, 0, 0);
}

export function zonedDateTimeToUtcMs(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
}, timeZone: string): number {
  let guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second ?? 0, 0);

  for (let i = 0; i < 3; i += 1) {
    const actual = getZonedParts(guess, timeZone);
    const desiredAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second ?? 0, 0);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second, 0);
    const delta = desiredAsUtc - actualAsUtc;
    if (delta === 0) {
      break;
    }
    guess += delta;
  }

  return guess;
}

export function shiftUtcMsByDays(timestamp: number, days: number): number {
  return timestamp + days * 24 * 60 * 60 * 1000;
}
