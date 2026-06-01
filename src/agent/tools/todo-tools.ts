/**
 * 待办相关工具
 */
import type { AgentTool, ToolContext, ToolResult } from "./types.js";
import { toBaseRecordFields } from "../../ai.js";
import type { TodoParseItem } from "../../ai.js";

/**
 * 列出待办
 */
export const listTodosTool: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "list_todos",
      description: "查询用户的待办事项列表。支持按状态过滤（已完成/未完成）、按时间范围过滤。",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["all", "pending", "completed"],
            description: "过滤状态：all=全部，pending=未完成，completed=已完成",
          },
          limit: {
            type: "number",
            description: "返回数量限制，默认 20",
          },
        },
      },
    },
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    try {
      const limit = typeof args.limit === "number" ? args.limit : 20;
      const records = await ctx.feishuClient.listRecords({ pageSize: limit });

      let filtered = records;
      if (args.status === "pending") {
        filtered = records.filter(r => !r.fields["是否已完成"]);
      } else if (args.status === "completed") {
        filtered = records.filter(r => r.fields["是否已完成"]);
      }

      const todos = filtered.map(r => ({
        id: r.record_id,
        title: String(r.fields["待办事项"] || "未命名"),
        priority: String(r.fields["优先级"] || ""),
        dueDate: r.fields["截止日期"] || null,
        completed: Boolean(r.fields["是否已完成"]),
        notes: String(r.fields["备注"] || ""),
      }));

      return {
        success: true,
        data: { todos, total: todos.length },
        message: `查询到 ${todos.length} 条待办`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * 创建待办
 */
export const createTodoTool: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "create_todo",
      description: "创建一条待办事项。需要明确的标题；截止时间和优先级可选。",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "待办事项标题（必需）",
          },
          dueDate: {
            type: "string",
            description: "截止时间，ISO 8601 格式，如 '2026-06-02T15:00:00+08:00'。如果用户说'明天3点'你需要根据当前时间转换。",
          },
          priority: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "优先级，默认 medium",
          },
          notes: {
            type: "string",
            description: "备注信息",
          },
        },
        required: ["title"],
      },
    },
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    try {
      if (!args.title) {
        return { success: false, error: "缺少标题" };
      }

      const item: TodoParseItem = {
        title: String(args.title),
        priority: ["high", "medium", "low"].includes(args.priority) ? args.priority : "medium",
        fallbackUsed: false,
        ...(args.dueDate ? { due: { timestamp: String(args.dueDate), is_all_day: false } } : {}),
        ...(args.notes ? { notes: String(args.notes) } : {}),
        ...(ctx.userId ? { assigneeOpenId: ctx.userId } : {}),
      };

      const fields = toBaseRecordFields(item);
      // 通过 feishuClient 的内部方法创建（带字段降级）
      const results = await ctx.feishuClient.createTodoRecordsOneByOne({ items: [item] });

      return {
        success: true,
        data: results[0],
        message: `已创建待办：${item.title}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * 完成待办
 */
export const completeTodoTool: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "complete_todo",
      description: "将一条待办标记为已完成。需要先用 list_todos 找到对应的 id，或根据标题模糊匹配。",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "待办的 record_id",
          },
          title: {
            type: "string",
            description: "待办标题（用于模糊匹配，当没有 id 时使用）",
          },
        },
      },
    },
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    try {
      let recordId = args.id ? String(args.id) : "";

      // 如果没有 id，按标题搜索
      if (!recordId && args.title) {
        const records = await ctx.feishuClient.listRecords({ pageSize: 100 });
        const matched = records.find(r => 
          String(r.fields["待办事项"] || "").includes(String(args.title))
        );
        if (!matched) {
          return { success: false, error: `未找到包含"${args.title}"的待办` };
        }
        recordId = matched.record_id;
      }

      if (!recordId) {
        return { success: false, error: "需要提供 id 或 title" };
      }

      await ctx.feishuClient.updateRecord(recordId, { 是否已完成: true });

      return {
        success: true,
        message: `已标记完成`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * 删除待办
 */
export const deleteTodoTool: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "delete_todo",
      description: "删除一条待办。需要 record_id 或标题模糊匹配。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "待办的 record_id" },
          title: { type: "string", description: "待办标题（模糊匹配）" },
        },
      },
    },
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    try {
      let recordId = args.id ? String(args.id) : "";

      if (!recordId && args.title) {
        const records = await ctx.feishuClient.listRecords({ pageSize: 100 });
        const matched = records.find(r =>
          String(r.fields["待办事项"] || "").includes(String(args.title))
        );
        if (!matched) {
          return { success: false, error: `未找到包含"${args.title}"的待办` };
        }
        recordId = matched.record_id;
      }

      if (!recordId) {
        return { success: false, error: "需要提供 id 或 title" };
      }

      await ctx.feishuClient.deleteRecord(recordId);

      return { success: true, message: "已删除" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const todoTools: AgentTool[] = [
  listTodosTool,
  createTodoTool,
  completeTodoTool,
  deleteTodoTool,
];
