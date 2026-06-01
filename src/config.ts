import process from "node:process";

export interface AppConfig {
  port: number;
  baseUrl?: string | undefined;
  timezone: string;
  feishuAppId: string;
  feishuAppSecret: string;
  feishuVerificationToken: string;
  feishuEncryptKey?: string | undefined;
  feishuBaseToken: string;
  feishuBaseTableId: string;
  openaiApiKey?: string | undefined;
  openaiApiBaseUrl: string;
  openaiModel: string;
  openaiVisionModel?: string | undefined;
  enableImageRecognition: boolean;
  enableTodoOptimization: boolean;
  enableAiParse: boolean;
  enableQuickMode: boolean;
  aiProvider?: string;
  feishuChatHistoryTableId?: string;
  enableChatMemory: boolean;
  chatMemoryLength: number;
  // CLI智能助手配置
  larkCliPath: string;
  enableSmartAssistant: boolean;
  cliTimeout: number;
  cliConfirmActions: string[];
  cliLogEnabled: boolean;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    port: Number.parseInt(process.env.PORT ?? "3000", 10),
    ...(process.env.BASE_URL?.trim() ? { baseUrl: process.env.BASE_URL.trim() } : {}),
    timezone: process.env.APP_TIMEZONE?.trim() || "Asia/Shanghai",
    feishuAppId: requireEnv("FEISHU_APP_ID"),
    feishuAppSecret: requireEnv("FEISHU_APP_SECRET"),
    feishuVerificationToken: requireEnv("FEISHU_VERIFICATION_TOKEN"),
    ...(process.env.FEISHU_ENCRYPT_KEY?.trim() ? { feishuEncryptKey: process.env.FEISHU_ENCRYPT_KEY.trim() } : {}),
    feishuBaseToken: requireEnv("FEISHU_BASE_TOKEN"),
    feishuBaseTableId: requireEnv("FEISHU_BASE_TABLE_ID"),
    ...(process.env.OPENAI_API_KEY?.trim() ? { openaiApiKey: process.env.OPENAI_API_KEY.trim() } : {}),
    openaiApiBaseUrl: process.env.OPENAI_API_BASE_URL?.trim() || "https://api.openai.com/v1",
    openaiModel: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
    ...(process.env.OPENAI_VISION_MODEL?.trim() ? { openaiVisionModel: process.env.OPENAI_VISION_MODEL.trim() } : {}),
    enableImageRecognition: process.env.ENABLE_IMAGE_RECOGNITION?.toLowerCase() !== "false",
    enableTodoOptimization: process.env.ENABLE_TODO_OPTIMIZATION?.toLowerCase() !== "false",
    enableAiParse: process.env.ENABLE_AI_PARSE?.toLowerCase() !== "false",
    enableQuickMode: process.env.ENABLE_QUICK_MODE?.toLowerCase() === "true",
    ...(process.env.AI_PROVIDER?.trim() ? { aiProvider: process.env.AI_PROVIDER.trim() } : {}),
    ...(process.env.FEISHU_CHAT_HISTORY_TABLE_ID?.trim() ? { feishuChatHistoryTableId: process.env.FEISHU_CHAT_HISTORY_TABLE_ID.trim() } : {}),
    enableChatMemory: process.env.ENABLE_CHAT_MEMORY?.toLowerCase() === "true",
    chatMemoryLength: Number.parseInt(process.env.CHAT_MEMORY_LENGTH ?? "10", 10),
    // CLI智能助手配置
    larkCliPath: process.env.LARK_CLI_PATH?.trim() || "D:\\Feishu\\cli\\lark-cli.cmd",
    enableSmartAssistant: process.env.ENABLE_SMART_ASSISTANT?.toLowerCase() === "true",
    cliTimeout: Number.parseInt(process.env.CLI_TIMEOUT ?? "30000", 10),
    cliConfirmActions: (process.env.CLI_CONFIRM_ACTIONS?.trim() || "create,update,delete,send,approve").split(",").map(s => s.trim()),
    cliLogEnabled: process.env.CLI_LOG_ENABLED?.toLowerCase() !== "false",
  };
}
