/**
 * 飞书 CLI 工具集（日历、联系人、文档、审批）
 */
import type { AgentTool, ToolContext, ToolResult } from "./types.js";

/**
 * 查看日程
 */
export const viewCalendarTool: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "view_calendar",
      description: "查看用户的日历日程安排（飞书日历，不是待办）。",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "查看未来几天，默认 1（今天）",
          },
        },
      },
    },
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.cliExecutor) {
      return { success: false, error: "智能助手未启用" };
    }
    try {
      const result = await ctx.cliExecutor.getAgenda(args.days || 1);
      if (!result.success) {
        return { success: false, error: result.error || "查询失败" };
      }
      return { success: true, data: result.data, message: "已获取日程" };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

/**
 * 搜索联系人
 */
export const searchContactTool: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "search_contact",
      description: "在飞书通讯录中搜索联系人。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词（姓名、部门等）" },
        },
        required: ["query"],
      },
    },
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.cliExecutor) {
      return { success: false, error: "智能助手未启用" };
    }
    try {
      const result = await ctx.cliExecutor.searchUser(String(args.query));
      if (!result.success) {
        return { success: false, error: result.error || "搜索失败" };
      }
      return { success: true, data: result.data, message: "已搜索联系人" };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

/**
 * 搜索文档
 */
export const searchDocsTool: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "search_docs",
      description: "在飞书文档中搜索相关文档。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
        },
        required: ["query"],
      },
    },
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.cliExecutor) {
      return { success: false, error: "智能助手未启用" };
    }
    try {
      const result = await ctx.cliExecutor.searchDocs(String(args.query));
      if (!result.success) {
        return { success: false, error: result.error || "搜索失败" };
      }
      return { success: true, data: result.data, message: "已搜索文档" };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

/**
 * 查看待审批
 */
export const listApprovalsTool: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "list_approvals",
      description: "查看用户的待审批列表。",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.cliExecutor) {
      return { success: false, error: "智能助手未启用" };
    }
    try {
      const result = await ctx.cliExecutor.listApprovals();
      if (!result.success) {
        return { success: false, error: result.error || "查询失败" };
      }
      return { success: true, data: result.data, message: "已获取待审批" };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const larkTools: AgentTool[] = [
  viewCalendarTool,
  searchContactTool,
  searchDocsTool,
  listApprovalsTool,
];
