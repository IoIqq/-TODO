import { getDb } from "./db.js";

export type DeadlineReminderKind = "before" | "start" | "overdue";
export type DeadlineReminderStatus = "pending" | "processing" | "sent" | "cancelled";

export interface DeadlineReminderRecord {
  id: number;
  recordId: string;
  assigneeOpenId: string;
  title: string;
  priority: string;
  dueTimestamp?: number;
  startTimestamp?: number;
  alertTime: number;
  kind: DeadlineReminderKind;
  sequence: number;
  status: DeadlineReminderStatus;
  remindedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleReminderParams {
  recordId: string;
  title: string;
  priority: string;
  dueTimestamp?: number;
  startTimestamp?: number;
  assigneeOpenId: string;
}

export interface ScheduleRecordRemindersParams {
  recordId: string;
  title: string;
  priority: string;
  dueTimestamp?: number;
  startTimestamp?: number;
  assigneeOpenIds: string[];
  preserveSentOverdue?: boolean;
}

export interface DeadlineReminderSchedule {
  assigneeOpenId: string;
  title: string;
  priority: string;
  dueTimestamp?: number;
  startTimestamp?: number;
  alertTime: number;
  kind: DeadlineReminderKind;
  sequence: number;
}

type PriorityLevel = "high" | "medium" | "low";

function normalizePriority(priority: string): PriorityLevel {
  if (priority.includes("P0") || priority.includes("高") || priority === "high") return "high";
  if (priority.includes("P2") || priority.includes("低") || priority === "low") return "low";
  return "medium";
}

function beforeMinutes(priority: string): number | null {
  const level = normalizePriority(priority);
  if (level === "high") return 60;
  if (level === "medium") return 30;
  return null;
}

function overdueIntervalMs(priority: string): number | null {
  const level = normalizePriority(priority);
  if (level === "high") return 10 * 60 * 1000;
  if (level === "medium") return 4 * 60 * 60 * 1000;
  return null;
}

function maxOverdueSequence(priority: string): number {
  const level = normalizePriority(priority);
  if (level === "high") return 2;
  if (level === "medium") return 2;
  return 0;
}

function toRecord(row: Record<string, unknown>): DeadlineReminderRecord {
  const remindedAt = row.reminded_at === null || row.reminded_at === undefined ? undefined : Number(row.reminded_at);
  const startTimestamp = row.start_timestamp === null || row.start_timestamp === undefined ? undefined : Number(row.start_timestamp);
  return {
    id: Number(row.id),
    recordId: String(row.record_id),
    assigneeOpenId: String(row.assignee_open_id),
    title: String(row.title),
    priority: String(row.priority),
    ...(row.due_timestamp === null || row.due_timestamp === undefined ? {} : { dueTimestamp: Number(row.due_timestamp) }),
    ...(startTimestamp === undefined ? {} : { startTimestamp }),
    alertTime: Number(row.alert_time),
    kind: String(row.kind) as DeadlineReminderKind,
    sequence: Number(row.sequence),
    status: String(row.status) as DeadlineReminderStatus,
    ...(remindedAt === undefined ? {} : { remindedAt }),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function insertReminder(params: DeadlineReminderSchedule & { recordId: string; now: number }): void {
  getDb()
    .prepare(`
      INSERT INTO deadline_reminders (
        record_id,
        assignee_open_id,
        title,
        priority,
        due_timestamp,
        start_timestamp,
        alert_time,
        kind,
        sequence,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `)
    .run(
      params.recordId,
      params.assigneeOpenId,
      params.title,
      params.priority,
      params.dueTimestamp ?? null,
      params.startTimestamp ?? null,
      params.alertTime,
      params.kind,
      params.sequence,
      params.now,
      params.now,
    );
}

function buildReminderSchedules(params: ScheduleReminderParams, now: number): DeadlineReminderSchedule[] {
  if (!Number.isFinite(params.dueTimestamp) && !Number.isFinite(params.startTimestamp)) return [];

  const schedules: DeadlineReminderSchedule[] = [];
  if (params.startTimestamp !== undefined && Number.isFinite(params.startTimestamp) && params.startTimestamp >= now) {
    schedules.push({
      assigneeOpenId: params.assigneeOpenId,
      title: params.title,
      priority: params.priority,
      ...(params.dueTimestamp === undefined ? {} : { dueTimestamp: params.dueTimestamp }),
      startTimestamp: params.startTimestamp,
      alertTime: params.startTimestamp,
      kind: "start",
      sequence: 0,
    });
  }

  if (params.dueTimestamp === undefined || !Number.isFinite(params.dueTimestamp)) {
    return schedules;
  }

  const before = beforeMinutes(params.priority);
  if (params.dueTimestamp > now && before !== null) {
    schedules.push({
      assigneeOpenId: params.assigneeOpenId,
      title: params.title,
      priority: params.priority,
      dueTimestamp: params.dueTimestamp,
      ...(params.startTimestamp === undefined ? {} : { startTimestamp: params.startTimestamp }),
      alertTime: Math.max(now, params.dueTimestamp - before * 60 * 1000),
      kind: "before",
      sequence: 0,
    });
  }

  schedules.push({
    assigneeOpenId: params.assigneeOpenId,
    title: params.title,
    priority: params.priority,
    dueTimestamp: params.dueTimestamp,
    ...(params.startTimestamp === undefined ? {} : { startTimestamp: params.startTimestamp }),
    alertTime: Math.max(now, params.dueTimestamp),
    kind: "overdue",
    sequence: 0,
  });

  return schedules;
}

function buildReminderSchedulesPreservingSent(params: ScheduleReminderParams, now: number): DeadlineReminderSchedule[] {
  if (params.dueTimestamp === undefined || !Number.isFinite(params.dueTimestamp)) {
    return buildReminderSchedules(params, now);
  }

  const sentRows = getDb()
    .prepare(`
      SELECT kind, sequence, reminded_at
      FROM deadline_reminders
      WHERE record_id = ?
        AND assignee_open_id = ?
        AND due_timestamp = ?
        AND status = 'sent'
    `)
    .all(params.recordId, params.assigneeOpenId, params.dueTimestamp) as Array<{ kind: DeadlineReminderKind; sequence: number; reminded_at: number | null }>;

  const sentOverdue = sentRows.filter((row) => row.kind === "overdue");
  const schedules = buildReminderSchedules(params, now).filter((schedule) => schedule.kind !== "overdue");
  if (sentOverdue.length === 0) {
    return buildReminderSchedules(params, now);
  }

  const maxSentSequence = Math.max(...sentOverdue.map((row) => Number(row.sequence)));
  if (maxSentSequence >= maxOverdueSequence(params.priority)) {
    return schedules;
  }

  const lastRemindedAt = Math.max(...sentOverdue.map((row) => Number(row.reminded_at ?? params.dueTimestamp)));
  const interval = overdueIntervalMs(params.priority);
  if (interval === null) return schedules;

  schedules.push({
    assigneeOpenId: params.assigneeOpenId,
    title: params.title,
    priority: params.priority,
    dueTimestamp: params.dueTimestamp,
    ...(params.startTimestamp === undefined ? {} : { startTimestamp: params.startTimestamp }),
    alertTime: Math.max(now, lastRemindedAt + interval),
    kind: "overdue",
    sequence: maxSentSequence + 1,
  });

  return schedules;
}

export function replacePendingRemindersForRecord(recordId: string, schedules: DeadlineReminderSchedule[], now = Date.now()): { cancelled: number; inserted: number } {
  const db = getDb();
  const replace = db.transaction(() => {
    const cancelResult = db
      .prepare("UPDATE deadline_reminders SET status = 'cancelled', updated_at = ? WHERE record_id = ? AND status IN ('pending', 'processing')")
      .run(now, recordId);

    for (const schedule of schedules) {
      insertReminder({ ...schedule, recordId, now });
    }

    return { cancelled: cancelResult.changes, inserted: schedules.length };
  });

  return replace();
}

export function scheduleReminders(params: ScheduleReminderParams, now = Date.now()): { cancelled: number; inserted: number } {
  return replacePendingRemindersForRecord(params.recordId, buildReminderSchedules(params, now), now);
}

export function scheduleRecordReminders(params: ScheduleRecordRemindersParams, now = Date.now()): { cancelled: number; inserted: number } {
  const schedules = params.assigneeOpenIds.flatMap((assigneeOpenId) => {
    const scheduleParams = {
      recordId: params.recordId,
      title: params.title,
      priority: params.priority,
      ...(params.dueTimestamp === undefined ? {} : { dueTimestamp: params.dueTimestamp }),
      ...(params.startTimestamp === undefined ? {} : { startTimestamp: params.startTimestamp }),
      assigneeOpenId,
    };
    return params.preserveSentOverdue
      ? buildReminderSchedulesPreservingSent(scheduleParams, now)
      : buildReminderSchedules(scheduleParams, now);
  });
  return replacePendingRemindersForRecord(params.recordId, schedules, now);
}

export function cancelReminders(recordId: string, now = Date.now()): number {
  const result = getDb()
    .prepare("UPDATE deadline_reminders SET status = 'cancelled', updated_at = ? WHERE record_id = ? AND status IN ('pending', 'processing')")
    .run(now, recordId);
  return result.changes;
}

export function getDueReminders(now = Date.now()): DeadlineReminderRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM deadline_reminders WHERE status = 'pending' AND alert_time <= ? ORDER BY alert_time ASC, id ASC")
    .all(now) as Array<Record<string, unknown>>;
  return rows.map(toRecord);
}

export function claimDueReminders(now = Date.now(), limit = 100): DeadlineReminderRecord[] {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const rows = getDb()
    .prepare(`
      UPDATE deadline_reminders
      SET status = 'processing', updated_at = ?
      WHERE id IN (
        SELECT id
        FROM deadline_reminders
        WHERE status = 'pending' AND alert_time <= ?
        ORDER BY alert_time ASC, id ASC
        LIMIT ?
      )
      RETURNING *
    `)
    .all(now, now, normalizedLimit) as Array<Record<string, unknown>>;
  return rows.map(toRecord).sort((a, b) => a.alertTime - b.alertTime || a.id - b.id);
}

export function markSent(id: number, now = Date.now()): boolean {
  const result = getDb()
    .prepare("UPDATE deadline_reminders SET status = 'sent', reminded_at = ?, updated_at = ? WHERE id = ? AND status = 'processing'")
    .run(now, now, id);
  return result.changes > 0;
}

export function markFailed(id: number, now = Date.now()): boolean {
  const result = getDb()
    .prepare("UPDATE deadline_reminders SET status = 'pending', updated_at = ? WHERE id = ? AND status = 'processing'")
    .run(now, id);
  return result.changes > 0;
}

export function releaseExpiredProcessing(cutoff: number, now = Date.now()): number {
  const result = getDb()
    .prepare("UPDATE deadline_reminders SET status = 'pending', updated_at = ? WHERE status = 'processing' AND updated_at <= ?")
    .run(now, cutoff);
  return result.changes;
}

export function getOpenReminderRecordIds(): string[] {
  const rows = getDb()
    .prepare("SELECT DISTINCT record_id FROM deadline_reminders WHERE status IN ('pending', 'processing') ORDER BY record_id")
    .all() as Array<{ record_id: string }>;
  return rows.map((row) => row.record_id);
}

export function getDeadlineReminderStats(now = Date.now()): { pending: number; processing: number; sent: number; cancelled: number; overdue: number } {
  const statusRows = getDb()
    .prepare("SELECT status, COUNT(*) AS count FROM deadline_reminders GROUP BY status")
    .all() as Array<{ status: DeadlineReminderStatus; count: number }>;
  const overdueRow = getDb()
    .prepare("SELECT COUNT(*) AS count FROM deadline_reminders WHERE status = 'pending' AND alert_time <= ?")
    .get(now) as { count: number } | undefined;

  const stats = { pending: 0, processing: 0, sent: 0, cancelled: 0, overdue: Number(overdueRow?.count ?? 0) };
  for (const row of statusRows) {
    if (row.status === "pending" || row.status === "processing" || row.status === "sent" || row.status === "cancelled") {
      stats[row.status] = Number(row.count);
    }
  }
  return stats;
}

export function scheduleNextOverdue(reminder: DeadlineReminderRecord, now = Date.now()): boolean {
  if (reminder.kind !== "overdue") return false;
  if (reminder.dueTimestamp === undefined || !Number.isFinite(reminder.dueTimestamp)) return false;
  if (reminder.sequence >= maxOverdueSequence(reminder.priority)) return false;

  const interval = overdueIntervalMs(reminder.priority);
  if (interval === null) return false;

  const nextSequence = reminder.sequence + 1;
  const existing = getDb()
    .prepare(`
      SELECT 1
      FROM deadline_reminders
      WHERE record_id = ?
        AND assignee_open_id = ?
        AND due_timestamp = ?
        AND kind = 'overdue'
        AND sequence = ?
        AND status IN ('pending', 'processing')
    `)
    .get(reminder.recordId, reminder.assigneeOpenId, reminder.dueTimestamp, nextSequence);
  if (existing) return false;

  insertReminder({
    recordId: reminder.recordId,
    assigneeOpenId: reminder.assigneeOpenId,
    title: reminder.title,
    priority: reminder.priority,
    dueTimestamp: reminder.dueTimestamp,
    ...(reminder.startTimestamp === undefined ? {} : { startTimestamp: reminder.startTimestamp }),
    alertTime: now + interval,
    kind: "overdue",
    sequence: nextSequence,
    now,
  });
  return true;
}
