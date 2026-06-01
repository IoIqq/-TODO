/**
 * 工具注册中心
 */
import type { AgentTool } from "./types.js";
import { todoTools } from "./todo-tools.js";
import { larkTools } from "./lark-tools.js";
import { memoryTools } from "./memory-tools.js";

export * from "./types.js";

/**
 * 所有可用工具
 */
export const allTools: AgentTool[] = [
  ...todoTools,
  ...larkTools,
  ...memoryTools,
];

/**
 * 按名称查找工具
 */
export function findTool(name: string): AgentTool | undefined {
  return allTools.find(t => t.definition.function.name === name);
}

/**
 * 获取所有工具的 OpenAI 定义
 */
export function getToolDefinitions() {
  return allTools.map(t => t.definition);
}
