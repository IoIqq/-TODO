/**
 * 记忆工具：让 AI 自主决定记忆/回忆什么
 */
import type { AgentTool, ToolContext, ToolResult } from "./types.js";
import { MemoryStore } from "../../storage/memories.js";

/**
 * 保存记忆
 */
export const saveMemoryTool: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "save_memory",
      description: "保存重要的用户信息，让 AI 在未来对话中记得。比如：用户的偏好、习惯、重要事件、人际关系等。",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "记忆的关键词（简短，如 '工作时间', '重要联系人-张三'）",
          },
          value: {
            type: "string",
            description: "记忆的内容",
          },
          category: {
            type: "string",
            enum: ["preference", "schedule", "contact", "task", "general"],
            description: "分类：preference=偏好, schedule=日程, contact=联系人, task=任务, general=其他",
          },
          importance: {
            type: "number",
            description: "重要程度 1-5，默认 1",
          },
        },
        required: ["key", "value"],
      },
    },
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    try {
      MemoryStore.save({
        userId: ctx.userId,
        key: String(args.key),
        value: String(args.value),
        category: args.category || "general",
        importance: typeof args.importance === "number" ? args.importance : 1,
      });
      return { success: true, message: `已记住：${args.key}` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

/**
 * 回忆相关记忆
 */
export const recallMemoryTool: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "recall_memory",
      description: "搜索用户的长期记忆，找到与当前对话相关的信息。",
      parameters: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description: "搜索关键词",
          },
          limit: {
            type: "number",
            description: "返回数量，默认 5",
          },
        },
        required: ["keyword"],
      },
    },
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    try {
      const memories = MemoryStore.search(
        ctx.userId,
        String(args.keyword),
        typeof args.limit === "number" ? args.limit : 5,
      );
      return {
        success: true,
        data: memories,
        message: `找到 ${memories.length} 条相关记忆`,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

/**
 * 列出所有记忆
 */
export const listMemoriesTool: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "list_memories",
      description: "列出用户的所有记忆，按重要程度排序。",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "可选的分类过滤",
          },
        },
      },
    },
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    try {
      const memories = MemoryStore.list(ctx.userId, args.category);
      return {
        success: true,
        data: memories,
        message: `共 ${memories.length} 条记忆`,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const memoryTools: AgentTool[] = [
  saveMemoryTool,
  recallMemoryTool,
  listMemoriesTool,
];
