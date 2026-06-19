import cron from "node-cron";
import type { AppConfig } from "../config.js";
import type { FeishuClient } from "../feishu.js";
import { buildDeadlineAlertCard, type ReminderTodoItem } from "../cards.js";
import { formatYmdInTimezone } from "./time-utils.js";
import type { FeishuBaseRecord } from "../types.js";
import {
  cancelReminders,
  claimDueReminders,
  getDeadlineReminderStats,
  getOpenReminderRecordIds,
  markFailed,
  markSent,
  releaseExpiredProcessing,
  scheduleNextOverdue,
  scheduleRecordReminders,
  type DeadlineReminderRecord,
} from "../storage/index.js";

export interface DeadlineReminderSchedulerOptions {
  config: AppConfig;
  feishuClient: FeishuClient;
}

export interface DeadlineReminderRunStats {
  alertedUsers: number;
  alertedTasks: number;
  scheduledNext: number;
}

export interface DeadlineReminderReconcileResult {
  scanned: number;
  rescheduled: number;
  cancelled: number;
  skipped: number;
  failed: number;
}

export class DeadlineReminderScheduler {
  private task: cron.ScheduledTask | null = null;
  private reconcileTask: cron.ScheduledTask | null = null;
  private isRunning = false;
  private isReconciling = false;
  private lastRunAt: number | null = null;
  private lastError: string | null = null;
  private lastReconcileAt: number | null = null;
  private lastReconcileError: string | null = null;
  private lastReconcileResult: DeadlineReminderReconcileResult | null = null;

  constructor(private readonly options: DeadlineReminderSchedulerOptions) {}

  start(): void {
    const { config } = this.options;

    if (!config.enableDeadlineReminder) {
      console.log("[scheduler] Deadline reminder disabled");
      return;
    }

    if (!cron.validate(config.deadlineReminderCron)) {
      console.error(`[scheduler] Invalid deadline reminder cron: "${config.deadlineReminderCron}"`);
      return;
    }

    this.task = cron.schedule(
      config.deadlineReminderCron,
      () => {
        void this.runOnce();
      },
      { timezone: config.timezone },
    );
    this.reconcileTask = cron.schedule(
      "17 * * * *",
      () => {
        void this.reconcile();
      },
      { timezone: config.timezone },
    );

    console.log(
      `[scheduler] Deadline reminder started (timezone=${config.timezone}, cron="${config.deadlineReminderCron}")`,
    );
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    if (this.reconcileTask) {
      this.reconcileTask.stop();
      this.reconcileTask = null;
    }
    console.log("[scheduler] Deadline reminder stopped");
  }

  async runOnce(now = Date.now()): Promise<DeadlineReminderRunStats> {
    if (this.isRunning) {
      console.warn("[scheduler] deadline run skipped: previous run still in progress");
      return { alertedUsers: 0, alertedTasks: 0, scheduledNext: 0 };
    }

    this.isRunning = true;
    this.lastRunAt = now;
    this.lastError = null;
    try {
      releaseExpiredProcessing(now - 30 * 60 * 1000, now);
      const due = claimDueReminders(now, 100);
      if (due.length === 0) {
        return { alertedUsers: 0, alertedTasks: 0, scheduledNext: 0 };
      }

      const grouped = groupByAssigneeAndKind(due);
      let alertedUsers = 0;
      let alertedTasks = 0;
      let scheduledNext = 0;

      for (const group of grouped.values()) {
        for (const reminders of chunk(group.reminders, 10)) {
          const urgency = group.kind === "overdue" ? "overdue" : group.kind === "start" ? "start" : "upcoming";
          const card = buildDeadlineAlertCard({
            todos: reminders.map(toReminderTodoItem),
            urgency,
            timezone: this.options.config.timezone,
            ...(urgency === "overdue" ? { todayYmd: formatYmdInTimezone(new Date(now), this.options.config.timezone) } : {}),
          });

          try {
            await this.options.feishuClient.sendCardToUser(group.assigneeOpenId, card);
            alertedUsers += 1;
            alertedTasks += reminders.length;

            for (const reminder of reminders) {
              if (!markSent(reminder.id, now)) continue;
              if (scheduleNextOverdue(reminder, now)) {
                scheduledNext += 1;
              }
            }
          } catch (error) {
            for (const reminder of reminders) {
              markFailed(reminder.id, now);
            }
            const msg = error instanceof Error ? error.message : String(error);
            this.lastError = msg;
            console.error(`[scheduler] deadline alert to ${group.assigneeOpenId} failed: ${msg}`);
          }
        }
      }

      return { alertedUsers, alertedTasks, scheduledNext };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  async reconcile(now = Date.now()): Promise<DeadlineReminderReconcileResult> {
    if (this.isReconciling) {
      return { scanned: 0, rescheduled: 0, cancelled: 0, skipped: 0, failed: 0 };
    }

    this.isReconciling = true;
    this.lastReconcileAt = now;
    this.lastReconcileError = null;
    const result: DeadlineReminderReconcileResult = { scanned: 0, rescheduled: 0, cancelled: 0, skipped: 0, failed: 0 };

    try {
      const records = await this.options.feishuClient.listRecords({ pageSize: 500 });
      const activeRecordIds = new Set<string>();

      for (const record of records) {
        result.scanned += 1;
        const parsed = toReconcileItem(record);
        if (!parsed) {
          result.skipped += 1;
          continue;
        }

        activeRecordIds.add(record.record_id);
        try {
          const changed = scheduleRecordReminders({
            recordId: record.record_id,
            title: parsed.title,
            priority: parsed.priority,
            ...(parsed.dueTimestamp === undefined ? {} : { dueTimestamp: parsed.dueTimestamp }),
            ...(parsed.startTimestamp === undefined ? {} : { startTimestamp: parsed.startTimestamp }),
            assigneeOpenIds: parsed.assigneeOpenIds,
            preserveSentOverdue: true,
          }, now);
          if (changed.cancelled > 0 || changed.inserted > 0) {
            result.rescheduled += 1;
          }
        } catch (error) {
          result.failed += 1;
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`[scheduler] reconcile ${record.record_id} failed: ${msg}`);
        }
      }

      for (const recordId of getOpenReminderRecordIds()) {
        if (activeRecordIds.has(recordId)) continue;
        const cancelled = cancelReminders(recordId, now);
        if (cancelled > 0) result.cancelled += 1;
      }

      this.lastReconcileResult = result;
      return result;
    } catch (error) {
      this.lastReconcileError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.isReconciling = false;
    }
  }

  getDiagnostics(now = Date.now()): {
    reminders: ReturnType<typeof getDeadlineReminderStats>;
    lastRunAt: number | null;
    lastError: string | null;
    lastReconcileAt: number | null;
    lastReconcileError: string | null;
    lastReconcileResult: DeadlineReminderReconcileResult | null;
  } {
    return {
      reminders: getDeadlineReminderStats(now),
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      lastReconcileAt: this.lastReconcileAt,
      lastReconcileError: this.lastReconcileError,
      lastReconcileResult: this.lastReconcileResult,
    };
  }
}

function groupByAssigneeAndKind(reminders: DeadlineReminderRecord[]): Map<string, { assigneeOpenId: string; kind: DeadlineReminderRecord["kind"]; reminders: DeadlineReminderRecord[] }> {
  const map = new Map<string, { assigneeOpenId: string; kind: DeadlineReminderRecord["kind"]; reminders: DeadlineReminderRecord[] }>();
  for (const reminder of reminders) {
    const key = `${reminder.assigneeOpenId}:${reminder.kind}`;
    const group = map.get(key) ?? { assigneeOpenId: reminder.assigneeOpenId, kind: reminder.kind, reminders: [] };
    group.reminders.push(reminder);
    map.set(key, group);
  }
  return map;
}

function toReminderTodoItem(reminder: DeadlineReminderRecord): ReminderTodoItem {
  return {
    recordId: reminder.recordId,
    title: reminder.title,
    priority: reminder.priority,
    ...(reminder.dueTimestamp === undefined ? {} : { dueTimestamp: reminder.dueTimestamp }),
    ...(reminder.startTimestamp === undefined ? {} : { startTimestamp: reminder.startTimestamp }),
    assigneeOpenId: reminder.assigneeOpenId,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toReconcileItem(record: FeishuBaseRecord): { title: string; priority: string; dueTimestamp?: number; startTimestamp?: number; assigneeOpenIds: string[] } | null {
  if (record.fields["是否已完成"]) return null;

  const dueTimestamp = normalizeTimestamp(record.fields["截止日期"]);
  const startTimestamp = normalizeTimestamp(record.fields["开始时间"]);
  if (dueTimestamp === null && startTimestamp === null) return null;

  const assigneeOpenIds = extractOpenIds(record.fields["执行人"]);
  if (assigneeOpenIds.length === 0) return null;

  return {
    title: String(record.fields["待办事项"] || "未命名任务"),
    priority: String(record.fields["优先级"] || "普通"),
    ...(dueTimestamp === null ? {} : { dueTimestamp }),
    ...(startTimestamp === null ? {} : { startTimestamp }),
    assigneeOpenIds,
  };
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function extractOpenIds(field: unknown): string[] {
  if (!Array.isArray(field)) return [];
  return field
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      return typeof record.open_id === "string" ? record.open_id : typeof record.id === "string" ? record.id : null;
    })
    .filter((id): id is string => Boolean(id));
}
