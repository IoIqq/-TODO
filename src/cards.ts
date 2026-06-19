import type { TodoConfirmSummary, TodoParseItem } from "./ai.js";
import { formatDateTime } from "./time.js";
import { formatShortDateTime, classifyDue } from "./scheduler/time-utils.js";

function escapeText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function dueLine(item: TodoParseItem, timeZone: string): string {
  if (!item.due) {
    return "截止：未填写";
  }
  return item.due.is_all_day
    ? `截止：${item.due.timestamp.slice(0, 10)}（全天）`
    : `截止：${formatDateTime(Number(item.due.timestamp), timeZone)}`;
}

export function buildTodoConfirmCard(params: {
  summary: TodoConfirmSummary;
  confirmToken: string;
  timeZone: string;
}): Record<string, unknown> {
  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      template: "blue",
      title: {
        tag: "plain_text",
        content: params.summary.title,
      },
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: params.summary.lines.map((line) => escapeText(line)).join("\n"),
        },
      },
      {
        tag: "hr",
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            type: "primary",
            text: {
              tag: "plain_text",
              content: "确认写入",
            },
            value: {
              action: "confirm_todo",
              confirm_token: params.confirmToken,
            },
          },
          {
            tag: "button",
            text: {
              tag: "plain_text",
              content: "取消",
            },
            value: {
              action: "cancel_todo",
              confirm_token: params.confirmToken,
            },
          },
        ],
      },
    ],
  };
}

export function buildTodoCreatedText(items: TodoParseItem[], timeZone: string): string {
  if (items.length === 0) {
    return "没有写入任何待办。";
  }

  const lines = items.map((item, index) => `${index + 1}. ${item.title} · ${dueLine(item, timeZone)}`);
  return `已写入 ${items.length} 条待办：\n${lines.join("\n")}`;
}

export interface TaskListItem {
  recordId: string;
  title: string;
  dueDate?: string | undefined;
  priority: string;
}

/**
 * CLI操作确认卡片
 */
export function buildCLIConfirmCard(params: {
  operation: string;
  description: string;
  details: string[];
  confirmToken: string;
  isHighRisk?: boolean;
}): Record<string, unknown> {
  const riskIcon = params.isHighRisk ? "⚠️" : "ℹ️";
  const headerColor = params.isHighRisk ? "red" : "orange";
  
  return {
    config: {
      wide_screen_mode: true,
      enable_forward: false,
    },
    header: {
      template: headerColor,
      title: {
        tag: "plain_text",
        content: `${riskIcon} 确认操作`,
      },
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**操作：${escapeText(params.operation)}**\n\n${escapeText(params.description)}`,
        },
      },
      {
        tag: "hr",
      },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: params.details.map(d => `• ${escapeText(d)}`).join("\n"),
        },
      },
      {
        tag: "hr",
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            type: params.isHighRisk ? "danger" : "primary",
            text: {
              tag: "plain_text",
              content: "确认执行",
            },
            value: {
              action: "confirm_cli",
              confirm_token: params.confirmToken,
            },
          },
          {
            tag: "button",
            text: {
              tag: "plain_text",
              content: "取消",
            },
            value: {
              action: "cancel_cli",
              confirm_token: params.confirmToken,
            },
          },
        ],
      },
    ],
  };
}

/**
 * CLI执行结果卡片
 */
export function buildCLIResultCard(params: {
  success: boolean;
  operation: string;
  message: string;
  data?: any;
}): Record<string, unknown> {
  const icon = params.success ? "✅" : "❌";
  const headerColor = params.success ? "green" : "red";
  
  const elements: Array<Record<string, unknown>> = [
    {
      tag: "div",
      text: {
        tag: "lark_md",
        content: `${icon} **${escapeText(params.operation)}**\n\n${escapeText(params.message)}`,
      },
    },
  ];

  // 如果有数据，添加数据展示
  if (params.data) {
    elements.push({ tag: "hr" });
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `\`\`\`json\n${JSON.stringify(params.data, null, 2)}\n\`\`\``,
      },
    });
  }

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      template: headerColor,
      title: {
        tag: "plain_text",
        content: params.success ? "操作成功" : "操作失败",
      },
    },
    elements,
  };
}

/**
 * 每日提醒卡片：早晚汇总用
 */
export interface ReminderTodoItem {
  recordId: string;
  title: string;
  priority: string;
  dueTimestamp?: number;
  startTimestamp?: number;
  assigneeOpenId?: string;
}

export function buildDailyReminderCard(params: {
  slot: "morning" | "evening";
  todayYmd: string;
  todos: ReminderTodoItem[];
  timezone: string;
}): Record<string, unknown> {
  const { slot, todos, timezone } = params;

  // 分类
  const overdue: ReminderTodoItem[] = [];
  const today: ReminderTodoItem[] = [];
  const future: ReminderTodoItem[] = [];
  const noDue: ReminderTodoItem[] = [];

  for (const t of todos) {
    if (t.dueTimestamp === undefined) {
      noDue.push(t);
      continue;
    }
    const cls = classifyDue(t.dueTimestamp, timezone);
    if (cls === "overdue") overdue.push(t);
    else if (cls === "today") today.push(t);
    else future.push(t);
  }

  const slotIcon = slot === "morning" ? "☀️" : "🌙";
  const slotGreeting = slot === "morning" ? "早安" : "晚安";
  const headerColor = overdue.length > 0 ? "red" : slot === "morning" ? "blue" : "purple";

  const elements: Array<Record<string, unknown>> = [];

  // 概况
  const summaryParts: string[] = [];
  if (overdue.length > 0) summaryParts.push(`⚠️ 逾期 ${overdue.length} 条`);
  if (today.length > 0) summaryParts.push(`📌 今日 ${today.length} 条`);
  if (future.length > 0) summaryParts.push(`📅 后续 ${future.length} 条`);
  if (noDue.length > 0) summaryParts.push(`📝 无截止 ${noDue.length} 条`);

  elements.push({
    tag: "div",
    text: {
      tag: "lark_md",
      content: summaryParts.length > 0
        ? summaryParts.join(" · ")
        : "暂无未完成待办，加油 💪",
    },
  });

  if (todos.length === 0) {
    return {
      config: { wide_screen_mode: true, enable_forward: true },
      header: {
        template: "green",
        title: {
          tag: "plain_text",
          content: `${slotIcon} ${slotGreeting}！今天没有未完成待办`,
        },
      },
      elements,
    };
  }

  // 各分组
  const renderGroup = (label: string, list: ReminderTodoItem[]) => {
    if (list.length === 0) return;
    elements.push({ tag: "hr" });
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**${label}**`,
      },
    });
    for (const t of list.slice(0, 10)) {
      const priIcon = t.priority.includes("P0") || t.priority.includes("高") ? "🔴"
        : t.priority.includes("P2") || t.priority.includes("低") ? "🟢"
        : "🟡";
      const dueStr = t.dueTimestamp
        ? formatShortDateTime(t.dueTimestamp, timezone)
        : "无截止";
      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `${priIcon} ${escapeText(t.title)}  ·  ${escapeText(dueStr)}`,
        },
      });
      elements.push({
        tag: "action",
        actions: [
          {
            tag: "button",
            type: "primary",
            text: { tag: "plain_text", content: "✅ 完成" },
            value: { action: "complete_task", record_id: t.recordId },
          },
          {
            tag: "button",
            text: { tag: "plain_text", content: "⏰ 延期" },
            value: {
              action: "postpone_task",
              record_id: t.recordId,
              title: t.title,
              priority: t.priority,
              defer_ms: 24 * 60 * 60 * 1000,
              ...(t.assigneeOpenId ? { assignee_open_id: t.assigneeOpenId } : {}),
              ...(t.startTimestamp ? { start_timestamp: t.startTimestamp } : {}),
              ...(t.dueTimestamp ? { current_due_timestamp: t.dueTimestamp } : {}),
            },
          },
        ],
      });
    }
    if (list.length > 10) {
      elements.push({
        tag: "div",
        text: {
          tag: "plain_text",
          content: `…还有 ${list.length - 10} 条未显示`,
        },
      });
    }
  };

  renderGroup(`⚠️ 逾期（${overdue.length}）`, overdue);
  renderGroup(`📌 今日截止（${today.length}）`, today);
  renderGroup(`📅 后续（${future.length}）`, future);
  renderGroup(`📝 无截止日期（${noDue.length}）`, noDue);

  return {
    config: { wide_screen_mode: true, enable_forward: true },
    header: {
      template: headerColor,
      title: {
        tag: "plain_text",
        content: `${slotIcon} ${slotGreeting}！你有 ${todos.length} 件待办`,
      },
    },
    elements,
  };
}

export function buildDeadlineAlertCard(params: {
  todos: ReminderTodoItem[];
  urgency: "upcoming" | "start" | "overdue";
  timezone: string;
  todayYmd?: string;
}): Record<string, unknown> {
  const { todos, urgency, timezone } = params;
  const isOverdue = urgency === "overdue";
  const isStart = urgency === "start";
  const intro = isOverdue
    ? `⚠️ 有 ${todos.length} 个待办已经逾期，请尽快处理。${params.todayYmd ? `\n今天日期：${escapeText(params.todayYmd)}` : ""}`
    : isStart
      ? `▶️ 有 ${todos.length} 个待办到了开始时间。`
      : `⏰ 有 ${todos.length} 个待办接近截止时间。`;
  const elements: Array<Record<string, unknown>> = [
    {
      tag: "div",
      text: {
        tag: "lark_md",
        content: intro,
      },
    },
  ];

  for (const t of todos.slice(0, 10)) {
    const priIcon = t.priority.includes("P0") || t.priority.includes("高") ? "🔴"
      : t.priority.includes("P2") || t.priority.includes("低") ? "🟢"
      : "🟡";
    const dueStr = t.dueTimestamp ? formatShortDateTime(t.dueTimestamp, timezone) : "无截止";
    const startStr = t.startTimestamp ? formatShortDateTime(t.startTimestamp, timezone) : "未设置";
    const timeLine = isStart
      ? `开始：${escapeText(startStr)}\n截止：${escapeText(dueStr)}`
      : `截止：${escapeText(dueStr)}`;
    elements.push({ tag: "hr" });
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `${priIcon} **${escapeText(t.title)}**\n${timeLine}`,
      },
    });
    elements.push({
      tag: "action",
      actions: [
        {
          tag: "button",
          type: "primary",
          text: { tag: "plain_text", content: "✅ 完成" },
          value: { action: "complete_task", record_id: t.recordId },
        },
        {
          tag: "button",
          text: { tag: "plain_text", content: "⏰ 延后半小时" },
          value: {
            action: "postpone_task",
            record_id: t.recordId,
            title: t.title,
            priority: t.priority,
            defer_ms: 30 * 60 * 1000,
            ...(t.assigneeOpenId ? { assignee_open_id: t.assigneeOpenId } : {}),
            ...(t.dueTimestamp ? { current_due_timestamp: t.dueTimestamp } : {}),
          },
        },
        {
          tag: "button",
          text: { tag: "plain_text", content: "⏰ 延后一天" },
          value: {
            action: "postpone_task",
            record_id: t.recordId,
            title: t.title,
            priority: t.priority,
            defer_ms: 24 * 60 * 60 * 1000,
            ...(t.assigneeOpenId ? { assignee_open_id: t.assigneeOpenId } : {}),
            ...(t.dueTimestamp ? { current_due_timestamp: t.dueTimestamp } : {}),
          },
        },
      ],
    });
  }

  if (todos.length > 10) {
    elements.push({
      tag: "div",
      text: { tag: "plain_text", content: `还有 ${todos.length - 10} 条未显示` },
    });
  }

  return {
    config: { wide_screen_mode: true, enable_forward: true },
    header: {
      template: isOverdue ? "red" : isStart ? "blue" : "orange",
      title: {
        tag: "plain_text",
        content: isOverdue ? "⚠️ 待办已逾期" : isStart ? "▶️ 待办开始提醒" : "⏰ 待办即将到期",
      },
    },
    elements,
  };
}

export function buildTaskListCard(params: { tasks: TaskListItem[] }): Record<string, unknown> {
  const elements: Array<Record<string, unknown>> = [];

  // 限制最多显示 10 个任务（避免卡片元素过多）
  const displayTasks = params.tasks.slice(0, 10);

  displayTasks.forEach((task, index) => {
    // 任务信息
    const priorityEmoji = task.priority === "高" ? "🔥" : task.priority === "中" ? "💡" : "📌";
    let content = `**${index + 1}. ${escapeText(task.title)}**`;
    if (task.dueDate) {
      content += `\n⏰ ${escapeText(task.dueDate)}`;
    }
    content += `\n${priorityEmoji} ${escapeText(task.priority)}优先级`;

    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content,
      },
    });

    // 操作按钮
    elements.push({
      tag: "action",
      actions: [
        {
          tag: "button",
          type: "primary",
          text: {
            tag: "plain_text",
            content: "✅ 完成",
          },
          value: {
            action: "complete_task",
            record_id: task.recordId,
          },
        },
        {
          tag: "button",
          text: {
            tag: "plain_text",
            content: "⏰ 延期",
          },
          value: {
            action: "postpone_task",
            record_id: task.recordId,
            current_due: task.dueDate,
          },
        },
        {
          tag: "button",
          type: "danger",
          text: {
            tag: "plain_text",
            content: "🗑️ 删除",
          },
          value: {
            action: "delete_task",
            record_id: task.recordId,
          },
        },
      ],
    });

    // 分隔线（最后一个任务不加）
    if (index < displayTasks.length - 1) {
      elements.push({ tag: "hr" });
    }
  });

  // 如果任务超过 10 个，添加提示
  if (params.tasks.length > 10) {
    elements.push({ tag: "hr" });
    elements.push({
      tag: "div",
      text: {
        tag: "plain_text",
        content: `还有 ${params.tasks.length - 10} 个任务未显示`,
      },
    });
  }

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      template: "blue",
      title: {
        tag: "plain_text",
        content: `📋 任务列表（${params.tasks.length} 项）`,
      },
    },
    elements,
  };
}
