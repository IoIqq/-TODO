import type { AIProvider, AIProviderConfig } from './provider.js';
import { OpenAIProvider } from './providers/openai.js';
import type { AppConfig } from '../config.js';

/**
 * 从 AppConfig 创建 AIProviderConfig
 */
export function createProviderConfig(config: AppConfig): AIProviderConfig {
  const providerConfig: AIProviderConfig = {
    provider: (config.aiProvider as AIProviderConfig['provider']) || 'openai',
    apiBaseUrl: config.openaiApiBaseUrl,
    model: config.openaiModel,
  };
  
  if (config.openaiApiKey) {
    providerConfig.apiKey = config.openaiApiKey;
  }
  
  if (config.openaiVisionModel) {
    providerConfig.visionModel = config.openaiVisionModel;
  }
  
  return providerConfig;
}

/**
 * 创建 AI Provider 实例
 * 根据配置自动选择合适的 Provider
 */
export function createAIProvider(config: AppConfig): AIProvider {
  const providerConfig = createProviderConfig(config);
  const providerType = providerConfig.provider;

  switch (providerType) {
    case 'openai':
      return new OpenAIProvider(providerConfig);
    
    // 未来可以添加更多 Provider
    // case 'azure':
    //   return new AzureProvider(providerConfig);
    // case 'claude':
    //   return new ClaudeProvider(providerConfig);
    // case 'custom':
    //   return new CustomProvider(providerConfig);
    
    default:
      // 默认使用 OpenAI Provider（兼容模式）
      return new OpenAIProvider(providerConfig);
  }
}
