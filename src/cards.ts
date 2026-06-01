import type { TodoConfirmSummary, TodoParseItem } from "./ai.js";
import { formatDateTime } from "./time.js";

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
