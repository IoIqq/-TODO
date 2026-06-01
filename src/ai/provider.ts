/**
 * AI Provider 接口
 * 支持多种 AI 供应商（OpenAI、Azure、Claude、自定义等）
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  // 工具调用相关（OpenAI Function Calling）
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface ChatCompletionParams {
  messages: ChatMessage[];
  temperature?: number;
  model?: string;
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

export interface ChatCompletionResult {
  content: string | null;
  tool_calls?: ToolCall[];
  finish_reason?: string;
}

export interface VisionParams {
  imageUrl: string;
  prompt: string;
  model?: string;
}

/**
 * AI Provider 接口
 * 所有 AI 供应商都需要实现这个接口
 */
export interface AIProvider {
  /** 供应商名称 */
  readonly name: string;

  /**
   * 聊天补全（简单版本，返回纯文本）
   * @param params 聊天参数
   * @returns AI 响应内容
   */
  chat(params: ChatCompletionParams): Promise<string>;

  /**
   * 聊天补全（完整版本，支持工具调用）
   * @param params 聊天参数
   * @returns 完整的响应（content + tool_calls）
   */
  chatComplete?(params: ChatCompletionParams): Promise<ChatCompletionResult>;

  /**
   * 视觉识别（可选）
   * @param params 视觉参数
   * @returns 识别结果
   */
  vision?(params: VisionParams): Promise<string>;
}

/**
 * AI Provider 配置
 */
export interface AIProviderConfig {
  provider: 'openai' | 'azure' | 'claude' | 'custom';
  apiKey?: string;
  apiBaseUrl?: string;
  model?: string;
  visionModel?: string;
  
  // Azure 专用
  azureEndpoint?: string;
  azureApiVersion?: string;
  azureDeployment?: string;
  
  // Claude 专用
  claudeApiKey?: string;
  claudeModel?: string;
  
  // 自定义 API
  customApiUrl?: string;
  customApiKey?: string;
  customHeaders?: Record<string, string>;
}
