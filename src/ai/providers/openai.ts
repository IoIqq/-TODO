import type {
  AIProvider,
  AIProviderConfig,
  ChatCompletionParams,
  ChatCompletionResult,
  ToolCall,
  VisionParams,
} from '../provider.js';

/**
 * OpenAI Provider 实现
 * 支持 OpenAI API 和兼容接口（如 Ollama、LM Studio 等）
 */
export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';

  constructor(private readonly config: AIProviderConfig) {
    if (!config.apiBaseUrl) {
      throw new Error('OpenAI API base URL is required');
    }
  }

  async chat(params: ChatCompletionParams): Promise<string> {
    const { messages, temperature = 0, model } = params;
    const apiModel = model || this.config.model || 'gpt-4o-mini';

    const response = await fetch(`${this.config.apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: apiModel,
        messages,
        temperature,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    return content;
  }

  /**
   * 完整的聊天补全（支持工具调用）
   */
  async chatComplete(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    const { messages, temperature = 0, model, tools, tool_choice } = params;
    const apiModel = model || this.config.model || 'gpt-4o-mini';

    const requestBody: Record<string, any> = {
      model: apiModel,
      messages,
      temperature,
    };

    if (tools && tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = tool_choice ?? 'auto';
    }

    const response = await fetch(`${this.config.apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: ToolCall[];
        };
        finish_reason?: string;
      }>;
    };

    const choice = data.choices?.[0];
    const message = choice?.message;

    const result: ChatCompletionResult = {
      content: message?.content ?? null,
    };
    if (message?.tool_calls && message.tool_calls.length > 0) {
      result.tool_calls = message.tool_calls;
    }
    if (choice?.finish_reason) {
      result.finish_reason = choice.finish_reason;
    }
    return result;
  }

  async vision(params: VisionParams): Promise<string> {
    const { imageUrl, prompt, model } = params;
    const apiModel = model || this.config.visionModel || this.config.model || 'gpt-4o-mini';

    const response = await fetch(`${this.config.apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: apiModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI Vision API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('No content in OpenAI vision response');
    }

    return content;
  }
}
