/**
 * AI Agent 主逻辑
 * 多轮 Function Calling，自主决定调用哪些工具
 */
import crypto from "node:crypto";
import type { AppConfig } from "../config.js";
import type { FeishuClient } from "../feishu.js";
import type { LarkCLIExecutor } from "../lark-cli.js";
import type { AIProvider } from "../ai/provider.js";
import type { ChatMessage, ToolCall } from "../ai/provider.js";
import { createAIProvider } from "../ai/factory.js";
import { allTools, findTool, getToolDefinitions } from "./tools/index.js";
import type { ToolContext } from "./tools/index.js";
import { ConversationStore, MemoryStore, AgentLogStore } from "../storage/index.js";
import { buildSystemPrompt } from "./prompt.js";

export interface AgentRunOptions {
  userInput: string;
  userId: string;
  messageId?: string;
  /** 思考过程回调（推送给用户） */
  onThinking?: (text: string) => Promise<void> | void;
  /** 最大工具调用轮数 */
  maxSteps?: number;
}

export interface AgentRunResult {
  sessionId: string;
  finalAnswer: string;
  steps: number;
  toolCalls: Array<{ tool: string; args: any; result: any }>;
  durationMs: number;
}

/**
 * 纯闲聊判断：整句仅为问候/致谢/应答（且很短）时返回 true。
 * 命中后跳过工具定义，避免每步重发 11 个工具的 JSON schema。
 * 保守匹配——任何带任务意图的句子都不应命中。
 */
const CHITCHAT_RE =
  /^(你好|您好|哈喽|哈啰|嗨|hi|hello|hey|在吗|在不在|早|早安|早上好|中午好|下午好|晚上好|晚安|谢谢|多谢|感谢|thanks?|thx|3q|好的|好滴|收到|嗯+|ok|okay|了解|明白|辛苦了|再见|拜拜|bye|哈哈+|呵呵+)[。.!！?？~～、,，\s]*$/i;

function isPureChitchat(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 12) return false;
  return CHITCHAT_RE.test(t);
}

/**
 * 精简工具结果再回传给 LLM：只保留 LLM 决策所需字段，丢弃冗长内容。
 * 不影响存入数据库与 toolCalls 的完整 result。
 */
function compactToolResultForLLM(toolName: string, result: any): any {
  if (!result || typeof result !== "object") return result;
  if (result.success === false) {
    return { success: false, error: result.error };
  }

  const data = result.data;

  if (toolName === "list_todos" && data?.todos) {
    return {
      success: true,
      message: result.message,
      todos: (data.todos as any[]).map((t) => ({
        id: t.id,
        title: t.title,
        completed: t.completed,
        ...(t.dueDate ? { dueDate: t.dueDate } : {}),
        ...(t.priority ? { priority: t.priority } : {}),
      })),
      total: data.total,
    };
  }

  if ((toolName === "recall_memory" || toolName === "list_memories") && Array.isArray(data)) {
    return {
      success: true,
      message: result.message,
      memories: data.map((m: any) => ({
        key: m.key,
        value: m.value,
        ...(m.category ? { category: m.category } : {}),
      })),
    };
  }

  // 写操作类（create/complete/delete/save）：message 已足够，丢弃 data
  if (data === undefined || data === null) {
    return { success: result.success, message: result.message };
  }

  // 兜底：保留结构但限制体积，避免单个工具结果撑爆上下文
  const json = JSON.stringify(result);
  if (json.length <= 4000) return result;
  return {
    success: result.success,
    message: result.message,
    data: JSON.stringify(data).slice(0, 4000) + "…(已截断)",
  };
}

export class Agent {
  private provider: AIProvider | null = null;
  private maxSteps: number;
  private showThinking: boolean;

  constructor(
    private readonly config: AppConfig,
    private readonly feishuClient: FeishuClient,
    private readonly cliExecutor: LarkCLIExecutor | null,
  ) {
    if (config.openaiApiKey) {
      try {
        this.provider = createAIProvider(config);
      } catch (error) {
        console.error("[agent] Failed to create AI provider:", error);
      }
    }
    this.maxSteps = Number.parseInt(process.env.AGENT_MAX_STEPS ?? "5", 10);
    this.showThinking = process.env.AGENT_SHOW_THINKING?.toLowerCase() !== "false";
  }

  isAvailable(): boolean {
    return this.provider !== null;
  }

  /**
   * 运行 Agent
   */
  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    if (!this.provider || !this.provider.chatComplete) {
      throw new Error("AI Provider not available or doesn't support tool calling");
    }

    const sessionId = crypto.randomUUID();
    const startTime = Date.now();
    const maxSteps = options.maxSteps ?? this.maxSteps;
    const toolCalls: AgentRunResult["toolCalls"] = [];

    // 工具上下文
    const toolContext: ToolContext = {
      userId: options.userId,
      config: this.config,
      feishuClient: this.feishuClient,
      cliExecutor: this.cliExecutor,
      timezone: this.config.timezone,
    };

    // 加载历史对话和记忆
    const recentConvs = ConversationStore.getRecent(options.userId, 8);
    const memoriesText = MemoryStore.formatForPrompt(options.userId, 10);

    // 构建消息
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt({
          timezone: this.config.timezone,
          now: new Date().toISOString(),
          memories: memoriesText,
        }),
      },
      // 历史对话（仅最近几轮）
      ...recentConvs.slice(-6).map(c => ({
        role: c.role as "user" | "assistant",
        content: c.content,
      })),
      // 当前用户输入
      { role: "user", content: options.userInput },
    ];

    // 纯闲聊（"你好"/"谢谢"）无需工具，跳过工具 schema 节省 token
    const skipTools = isPureChitchat(options.userInput);
    const tools = skipTools ? undefined : getToolDefinitions();

    // 多轮 Function Calling
    for (let step = 1; step <= maxSteps; step++) {
      const stepStart = Date.now();

      const response = await this.provider.chatComplete({
        messages,
        ...(tools ? { tools } : {}),
        temperature: 0.3,
      });

      // 没有工具调用 → 终止，返回内容
      if (!response.tool_calls || response.tool_calls.length === 0) {
        const answer = response.content || "（AI 无回复）";

        AgentLogStore.log({
          userId: options.userId,
          sessionId,
          step,
          actionType: "final_answer",
          output: answer,
          durationMs: Date.now() - stepStart,
          timestamp: Date.now(),
        });

        return {
          sessionId,
          finalAnswer: answer,
          steps: step,
          toolCalls,
          durationMs: Date.now() - startTime,
        };
      }

      // 有工具调用，先把 assistant 消息加入历史
      messages.push({
        role: "assistant",
        content: response.content || "",
        tool_calls: response.tool_calls,
      });

      // 显示思考过程
      if (this.showThinking && options.onThinking) {
        const toolNames = response.tool_calls.map(tc => tc.function.name).join("、");
        await options.onThinking(`🔧 调用工具：${toolNames}`);
      }

      // 执行所有工具调用
      for (const toolCall of response.tool_calls) {
        const result = await this.executeToolCall(toolCall, toolContext);
        
        // 记录到数据库
        AgentLogStore.log({
          userId: options.userId,
          sessionId,
          step,
          actionType: "tool_call",
          toolName: toolCall.function.name,
          input: toolCall.function.arguments,
          output: JSON.stringify(result),
          ...(result.error ? { error: result.error } : {}),
          durationMs: Date.now() - stepStart,
          timestamp: Date.now(),
        });

        toolCalls.push({
          tool: toolCall.function.name,
          args: this.safeParseJSON(toolCall.function.arguments),
          result,
        });

        // 把工具结果作为 tool 消息加入历史（精简版，节省 token）
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: JSON.stringify(compactToolResultForLLM(toolCall.function.name, result)),
        });
      }
    }

    // 达到最大步数，强制总结
    AgentLogStore.log({
      userId: options.userId,
      sessionId,
      step: maxSteps,
      actionType: "error",
      error: `Reached max steps (${maxSteps})`,
      timestamp: Date.now(),
    });

    return {
      sessionId,
      finalAnswer: "我尝试了多次但没能完成你的请求，可以换种方式描述一下吗？",
      steps: maxSteps,
      toolCalls,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * 执行单个工具调用
   */
  private async executeToolCall(toolCall: ToolCall, ctx: ToolContext): Promise<any> {
    const tool = findTool(toolCall.function.name);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${toolCall.function.name}`,
      };
    }

    try {
      const args = this.safeParseJSON(toolCall.function.arguments);
      console.log(`[agent] Executing tool: ${toolCall.function.name}`, args);
      const result = await tool.execute(args || {}, ctx);
      console.log(`[agent] Tool result:`, result.success ? "✓" : "✗", result.message || result.error);
      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : "";
      console.error(`[agent] Tool execution failed: ${toolCall.function.name}`, errMsg);
      if (stack) console.error(`[agent] stack:\n${stack}`);
      return {
        success: false,
        error: errMsg,
      };
    }
  }


  private safeParseJSON(text: string): any {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}
