import process from "node:process";

export interface AppConfig {
  port: number;
  baseUrl?: string | undefined;
  timezone: string;
  feishuAppId: string;
  feishuAppSecret: string;
  feishuVerificationToken: string;
  feishuEncryptKey?: string | undefined;
  feishuTasklistGuid: string;
  openaiApiKey?: string | undefined;
  openaiApiBaseUrl: string;
  openaiModel: string;
  openaiVisionModel?: string | undefined;
  enableImageRecognition: boolean;
  enableTodoOptimization: boolean;
  enableAiParse: boolean;
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
    feishuTasklistGuid: requireEnv("FEISHU_TASKLIST_GUID"),
    ...(process.env.OPENAI_API_KEY?.trim() ? { openaiApiKey: process.env.OPENAI_API_KEY.trim() } : {}),
    openaiApiBaseUrl: process.env.OPENAI_API_BASE_URL?.trim() || "https://api.openai.com/v1",
    openaiModel: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
    ...(process.env.OPENAI_VISION_MODEL?.trim() ? { openaiVisionModel: process.env.OPENAI_VISION_MODEL.trim() } : {}),
    enableImageRecognition: process.env.ENABLE_IMAGE_RECOGNITION?.toLowerCase() !== "false",
    enableTodoOptimization: process.env.ENABLE_TODO_OPTIMIZATION?.toLowerCase() !== "false",
    enableAiParse: process.env.ENABLE_AI_PARSE?.toLowerCase() !== "false",
  };
}
