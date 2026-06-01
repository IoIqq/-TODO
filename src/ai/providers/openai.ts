import type { AIProvider, AIProviderConfig, ChatCompletionParams, VisionParams } from '../provider.js';

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
