import process from "node:process";

export interface AppConfig {
  port: number;
  baseUrl?: string | undefined;
  timezone: string;
  feishuAppId: string;
  feishuAppSecret: string;
  feishuVerificationToken: string;
  adminToken?: string | undefined;
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
  // 每日待办提醒（早晚定时推送）
  enableDailyReminder: boolean;
  /** 早晨 cron 表达式，默认 "30 8 * * *" 即每天 08:30 */
  dailyMorningCron: string;
  /** 晚上 cron 表达式，默认 "30 18 * * *" 即每天 18:30 */
  dailyEveningCron: string;
  // 截止时间提醒（按优先级分级提醒即将逾期/已逾期的任务）
  enableDeadlineReminder: boolean;
  /** 检查频率 cron，默认 "* * * * *" 即每分钟 */
  deadlineReminderCron: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeHttpUrl(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} cannot be empty`);
  }
  if (!/^https?:\/\/.+/i.test(trimmed)) {
    throw new Error(`${name} must be an absolute http(s) URL, e.g. https://api.openai.com/v1`);
  }
  if (/\/chat\/completions$/i.test(trimmed)) {
    throw new Error(`${name} should be the base URL only, not the full endpoint path. Remove "/chat/completions"`);
  }
  return trimmed.replace(/\/+$/, "");
}

function rejectUrlLikeConfig(name: string, value: string): void {
  const lower = value.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://") || lower.includes("feishu.cn") || lower.includes("lark") && lower.includes("/")) {
    throw new Error(`${name} should be the raw ID (e.g. "bascnJqBGVxAbcdef" for base token, "tblXYZ123" for table ID), not a full Feishu URL. Do not paste the browser URL here.`);
  }
}

export function loadConfig(): AppConfig {
  const baseUrl = process.env.BASE_URL?.trim();
  const normalizedBaseUrl = baseUrl ? normalizeHttpUrl("BASE_URL", baseUrl) : undefined;

  const rawBaseToken = requireEnv("FEISHU_BASE_TOKEN");
  rejectUrlLikeConfig("FEISHU_BASE_TOKEN", rawBaseToken);

  const rawBaseTableId = requireEnv("FEISHU_BASE_TABLE_ID");
  rejectUrlLikeConfig("FEISHU_BASE_TABLE_ID", rawBaseTableId);

  const rawChatHistoryTableId = process.env.FEISHU_CHAT_HISTORY_TABLE_ID?.trim();
  if (rawChatHistoryTableId) {
    rejectUrlLikeConfig("FEISHU_CHAT_HISTORY_TABLE_ID", rawChatHistoryTableId);
  }

  const openaiBaseUrl = process.env.OPENAI_API_BASE_URL?.trim() || "https://api.openai.com/v1";
  const normalizedOpenaiBaseUrl = normalizeHttpUrl("OPENAI_API_BASE_URL", openaiBaseUrl);

  return {
    port: Number.parseInt(process.env.PORT ?? "3000", 10),
    ...(normalizedBaseUrl ? { baseUrl: normalizedBaseUrl } : {}),
    timezone: process.env.APP_TIMEZONE?.trim() || "Asia/Shanghai",
    feishuAppId: requireEnv("FEISHU_APP_ID"),
    feishuAppSecret: requireEnv("FEISHU_APP_SECRET"),
    feishuVerificationToken: requireEnv("FEISHU_VERIFICATION_TOKEN"),
    ...(process.env.ADMIN_TOKEN?.trim() ? { adminToken: process.env.ADMIN_TOKEN.trim() } : {}),
    ...(process.env.FEISHU_ENCRYPT_KEY?.trim() ? { feishuEncryptKey: process.env.FEISHU_ENCRYPT_KEY.trim() } : {}),
    feishuBaseToken: rawBaseToken,
    feishuBaseTableId: rawBaseTableId,
    ...(process.env.OPENAI_API_KEY?.trim() ? { openaiApiKey: process.env.OPENAI_API_KEY.trim() } : {}),
    openaiApiBaseUrl: normalizedOpenaiBaseUrl,
    openaiModel: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
    ...(process.env.OPENAI_VISION_MODEL?.trim() ? { openaiVisionModel: process.env.OPENAI_VISION_MODEL.trim() } : {}),
    enableImageRecognition: process.env.ENABLE_IMAGE_RECOGNITION?.toLowerCase() !== "false",
    enableTodoOptimization: process.env.ENABLE_TODO_OPTIMIZATION?.toLowerCase() !== "false",
    enableAiParse: process.env.ENABLE_AI_PARSE?.toLowerCase() !== "false",
    enableQuickMode: process.env.ENABLE_QUICK_MODE?.toLowerCase() === "true",
    ...(process.env.AI_PROVIDER?.trim() ? { aiProvider: process.env.AI_PROVIDER.trim() } : {}),
    ...(rawChatHistoryTableId ? { feishuChatHistoryTableId: rawChatHistoryTableId } : {}),
    enableChatMemory: process.env.ENABLE_CHAT_MEMORY?.toLowerCase() === "true",
    chatMemoryLength: Number.parseInt(process.env.CHAT_MEMORY_LENGTH ?? "10", 10),
    // CLI智能助手配置
    larkCliPath: process.env.LARK_CLI_PATH?.trim() || "D:\\Feishu\\cli\\lark-cli.cmd",
    enableSmartAssistant: process.env.ENABLE_SMART_ASSISTANT?.toLowerCase() === "true",
    cliTimeout: Number.parseInt(process.env.CLI_TIMEOUT ?? "30000", 10),
    cliConfirmActions: (process.env.CLI_CONFIRM_ACTIONS?.trim() || "create,update,delete,send,approve").split(",").map(s => s.trim()),
    cliLogEnabled: process.env.CLI_LOG_ENABLED?.toLowerCase() !== "false",
    // 每日待办提醒（默认开启，08:30 / 18:30）
    enableDailyReminder: process.env.ENABLE_DAILY_REMINDER?.toLowerCase() !== "false",
    dailyMorningCron: process.env.DAILY_MORNING_CRON?.trim() || "30 8 * * *",
    dailyEveningCron: process.env.DAILY_EVENING_CRON?.trim() || "30 18 * * *",
    // 截止时间提醒（默认开启，每分钟检查本地提醒表）
    enableDeadlineReminder: process.env.ENABLE_DEADLINE_REMINDER?.toLowerCase() !== "false",
    deadlineReminderCron: process.env.DEADLINE_REMINDER_CRON?.trim() || "* * * * *",
  };
}
