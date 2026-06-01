/**
 * Agent 工具类型定义
 */
import type { ToolDefinition } from "../../ai/provider.js";

export interface ToolContext {
  userId: string;
  config: import("../../config.js").AppConfig;
  feishuClient: import("../../feishu.js").FeishuClient;
  cliExecutor: import("../../lark-cli.js").LarkCLIExecutor | null;
  timezone: string;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  message?: string;
  error?: string;
}

export interface AgentTool {
  /** 工具定义（OpenAI Function Calling 格式） */
  definition: ToolDefinition;
  /** 执行函数 */
  execute(args: Record<string, any>, context: ToolContext): Promise<ToolResult>;
}
