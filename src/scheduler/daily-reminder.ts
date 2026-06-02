/**
 * 每日待办提醒调度器
 * - 每天 08:30 / 18:30 推送
 * - 按"执行人"分组，给每个人发未完成的待办列表
 * - 没填执行人的任务跳过（不会乱发）
 */
import cron from "node-cron";
import type { AppConfig } from "../config.js";
import type { FeishuClient } from "../feishu.js";
import type { FeishuBaseRecord } from "../types.js";
import { buildDailyReminderCard, type ReminderTodoItem } from "../cards.js";
import { formatYmdInTimezone } from "./time-utils.js";

export type ReminderSlot = "morning" | "evening";

export interface DailyReminderSchedulerOptions {
  config: AppConfig;
  feishuClient: FeishuClient;
}

export class DailyReminderScheduler {
  private morningTask: cron.ScheduledTask | null = null;
  private eveningTask: cron.ScheduledTask | null = null;
  private isRunning = false;

  constructor(private readonly options: DailyReminderSchedulerOptions) {}

  start(): void {
    const { config } = this.options;

    if (!config.enableDailyReminder) {
      console.log("[scheduler] Daily reminder disabled");
      return;
    }

    if (!cron.validate(config.dailyMorningCron)) {
      console.error(`[scheduler] Invalid morning cron: "${config.dailyMorningCron}"`);
      return;
    }
    if (!cron.validate(config.dailyEveningCron)) {
      console.error(`[scheduler] Invalid evening cron: "${config.dailyEveningCron}"`);
      return;
    }

    const cronOpts = { timezone: config.timezone };

    this.morningTask = cron.schedule(
      config.dailyMorningCron,
      () => {
        void this.runOnce("morning");
      },
      cronOpts,
    );

    this.eveningTask = cron.schedule(
      config.dailyEveningCron,
      () => {
        void this.runOnce("evening");
      },
      cronOpts,
    );

    console.log(
      `[scheduler] Daily reminder started (timezone=${config.timezone}): ` +
        `morning="${config.dailyMorningCron}", evening="${config.dailyEveningCron}"`,
    );
  }

  stop(): void {
    if (this.morningTask) {
      this.morningTask.stop();
      this.morningTask = null;
    }
    if (this.eveningTask) {
      this.eveningTask.stop();
      this.eveningTask = null;
    }
    console.log("[scheduler] Daily reminder stopped");
  }

  /**
   * 立即执行一次（调试 / 手动触发）
   */
  async runOnce(slot: ReminderSlot): Promise<{
    sentUsers: number;
    totalTodos: number;
    skippedNoAssignee: number;
  }> {
    if (this.isRunning) {
      console.warn(`[scheduler] runOnce(${slot}) skipped: previous run still in progress`);
      return { sentUsers: 0, totalTodos: 0, skippedNoAssignee: 0 };
    }
    this.isRunning = true;
    const startedAt = Date.now();
    console.log(`[scheduler] === ${slot.toUpperCase()} reminder run started ===`);

    try {
      const { config, feishuClient } = this.options;

      const allRecords = await feishuClient.listRecords({ pageSize: 500 });
      const pending = allRecords.filter((r) => !r.fields["是否已完成"]);

      const grouped = groupByAssignee(pending);
      let sentUsers = 0;
      let totalTodos = 0;

      for (const [openId, records] of grouped.entries()) {
        const items = records
          .map(toReminderTodoItem)
          .sort(compareReminderItem);

        const card = buildDailyReminderCard({
          slot,
          todayYmd: formatYmdInTimezone(new Date(), config.timezone),
          todos: items,
          timezone: config.timezone,
        });

        try {
          await feishuClient.sendCardToUser(openId, card);
          sentUsers += 1;
          totalTodos += items.length;
          console.log(`[scheduler] sent ${items.length} items to ${openId}`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`[scheduler] send to ${openId} failed: ${msg}`);
        }
      }

      const skippedNoAssignee = pending.length - countAssignedRecords(grouped);
      const duration = Date.now() - startedAt;
      console.log(
        `[scheduler] === ${slot} done in ${duration}ms: ` +
          `users=${sentUsers}, todos=${totalTodos}, skippedNoAssignee=${skippedNoAssignee} ===`,
      );

      return { sentUsers, totalTodos, skippedNoAssignee };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[scheduler] runOnce(${slot}) failed: ${msg}`);
      return { sentUsers: 0, totalTodos: 0, skippedNoAssignee: 0 };
    } finally {
      this.isRunning = false;
    }
  }
}

/**
 * 按"执行人"分组（一条任务可以有多个执行人，每人都收一份）
 */
function groupByAssignee(records: FeishuBaseRecord[]): Map<string, FeishuBaseRecord[]> {
  const map = new Map<string, FeishuBaseRecord[]>();

  for (const record of records) {
    const assignees = extractOpenIds(record.fields["执行人"]);
    if (assignees.length === 0) continue;

    for (const openId of assignees) {
      const list = map.get(openId) ?? [];
      list.push(record);
      map.set(openId, list);
    }
  }

  return map;
}

function extractOpenIds(field: unknown): string[] {
  if (!field) return [];
  if (!Array.isArray(field)) return [];

  const ids: string[] = [];
  for (const item of field) {
    if (item && typeof item === "object") {
      const obj = item as { id?: unknown; open_id?: unknown };
      const candidate = (typeof obj.open_id === "string" && obj.open_id) ||
        (typeof obj.id === "string" && obj.id);
      if (candidate) ids.push(candidate);
    } else if (typeof item === "string") {
      ids.push(item);
    }
  }
  return ids;
}

function countAssignedRecords(grouped: Map<string, FeishuBaseRecord[]>): number {
  // 不同 user 可能持有同一条记录，去重
  const seen = new Set<string>();
  for (const records of grouped.values()) {
    for (const r of records) seen.add(r.record_id);
  }
  return seen.size;
}

function toReminderTodoItem(record: FeishuBaseRecord): ReminderTodoItem {
  const title = String(record.fields["待办事项"] ?? "未命名");
  const priority = String(record.fields["优先级"] ?? "");
  const dueRaw = record.fields["截止日期"];
  const item: ReminderTodoItem = {
    recordId: record.record_id,
    title,
    priority,
  };
  if (dueRaw !== undefined && dueRaw !== null && dueRaw !== "") {
    const num = Number(dueRaw);
    if (Number.isFinite(num)) {
      item.dueTimestamp = num;
    } else if (typeof dueRaw === "string") {
      const parsed = Date.parse(dueRaw);
      if (!Number.isNaN(parsed)) item.dueTimestamp = parsed;
    }
  }
  return item;
}

/**
 * 排序：逾期最严重的排前面，没截止日期的排最后
 */
function compareReminderItem(a: ReminderTodoItem, b: ReminderTodoItem): number {
  const aDue = a.dueTimestamp ?? Number.POSITIVE_INFINITY;
  const bDue = b.dueTimestamp ?? Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;
  return a.title.localeCompare(b.title);
}
