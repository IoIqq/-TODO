import type { FeishuTask, ParsedTask, TaskDue } from "./types.js";
import { formatDateKey, formatDateTime } from "./time.js";

function escapeText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function dueDisplay(due: TaskDue | undefined, timeZone: string): string {
  if (!due) {
    return "未设置";
  }
  const ts = Number(due.timestamp);
  return due.is_all_day ? `${formatDateKey(ts, timeZone)}（全天）` : formatDateTime(ts, timeZone);
}

export function buildTaskCreatedCard(params: {
  task: FeishuTask;
  parsed: ParsedTask;
  timeZone: string;
}): Record<string, unknown> {
  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      template: "green",
      title: {
        tag: "plain_text",
        content: "待办已创建",
      },
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**${escapeText(params.task.summary)}**\n\n优先级：${params.parsed.priority}\n截止：${dueDisplay(params.task.due, params.timeZone)}${params.parsed.notes ? `\n备注：${escapeText(params.parsed.notes)}` : ""}`,
        },
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: {
              tag: "plain_text",
              content: "完成",
            },
            type: "primary",
            value: {
              action: "complete",
              task_guid: params.task.guid,
            },
          },
          {
            tag: "button",
            text: {
              tag: "plain_text",
              content: "延期一天",
            },
            value: {
              action: "postpone_one_day",
              task_guid: params.task.guid,
              due_timestamp: params.task.due?.timestamp,
              due_is_all_day: params.task.due?.is_all_day,
            },
          },
        ],
      },
    ],
  };
}

export function buildTodayTasksText(tasks: FeishuTask[], timeZone: string): string {
  if (tasks.length === 0) {
    return "今天没有待办。";
  }

  const lines = tasks.map((task, index) => {
    const due = task.due ? dueDisplay(task.due, timeZone) : "未设置";
    return `${index + 1}. ${task.summary} · ${due}`;
  });

  return `今天待办（${tasks.length} 项）\n${lines.join("\n")}`;
}

export function buildTomorrowTasksText(tasks: FeishuTask[], timeZone: string): string {
  if (tasks.length === 0) {
    return "明天没有待办。";
  }

  const lines = tasks.map((task, index) => {
    const due = task.due ? dueDisplay(task.due, timeZone) : "未设置";
    return `${index + 1}. ${task.summary} · ${due}`;
  });

  return `明天待办（${tasks.length} 项）\n${lines.join("\n")}`;
}
