import type { AppConfig } from "./config.js";
import type { FeishuBaseRecord, TaskPriority, TodoDraft } from "./types.js";
import { createAIProvider } from "./ai/factory.js";
import type { AIProvider } from "./ai/provider.js";

const TODO_PARSE_PROMPT = `你是一个智能待办事项助手。分析用户输入，提取任务信息并返回 JSON 数组。

【优先级判断规则】
- high（高优先级）：
  * 今天或明天必须完成的紧急任务
  * 有明确且紧迫的deadline
  * 关键重要的工作（如：汇报、提交、会议）
  
- medium（普通优先级）：
  * 常规日常任务（如：提醒、上课、约会）
  * 无紧急时间要求的工作
  * 一般性的待办事项
  
- low（低优先级）：
  * 可以延后的任务
  * 参考性、学习性的内容
  * 不紧急不重要的事项

【风险评估规则】
- high：时间紧迫（今天内）、依赖他人、复杂任务
- medium：常规任务、时间充裕
- low：简单任务、无时间压力

【备注提取】
提取任务中的额外信息，如：地点、注意事项、准备内容等

【示例】
输入："明天3点提交周报"
输出：priority=medium, risk=medium, notes=""

输入："今天下午5点前必须完成报告，记得带数据"
输出：priority=high, risk=high, notes="记得带数据"

输入："提醒我上课，8点"
输出：priority=medium, risk=low, notes=""

返回格式：[
  {
    "title": "待办名称",
    "due": { "timestamp": "2026-05-28T10:00:00+08:00", "is_all_day": false },
    "priority": "medium",
    "risk": "medium",
    "assigneeOpenId": "",
    "notes": "备注信息",
    "fallbackUsed": false
  }
]`;

export interface TodoParseItem {
  title: string;
  due?: {
    timestamp: string;
    is_all_day: boolean;
  };
  priority: TaskPriority;
  risk?: "high" | "medium" | "low";
  assigneeOpenId?: string;
  notes?: string;
  fallbackUsed: boolean;
}

export interface TodoConfirmSummary {
  title: string;
  lines: string[];
  items: TodoParseItem[];
}

export interface IntentAnalysisResult {
  type: "todo" | "cli_calendar" | "cli_contact" | "cli_docs" | "cli_approval" | "cli_task" | "cli_message" | "chat";
  confidence: number;
  action?: string;
  params?: Record<string, any>;
  requiresConfirmation?: boolean;
  description?: string;
}

export class AIClient {
  private provider: AIProvider | null = null;

  constructor(private readonly config: AppConfig) {
    // 只在有 API Key 时创建 Provider
    if (this.config.openaiApiKey) {
      try {
        this.provider = createAIProvider(config);
      } catch (error) {
        console.error('Failed to create AI provider:', error);
        this.provider = null;
      }
    }
  }

  /**
   * 分析用户意图
   */
  async analyzeIntent(userInput: string): Promise<IntentAnalysisResult> {
    if (!this.provider || !this.config.enableSmartAssistant) {
      // 默认当作待办处理
      return { type: "todo", confidence: 0.5 };
    }

    try {
      const prompt = `分析用户输入，判断用户想要执行什么操作。

【操作类型】
1. todo - 创建/管理待办事项
   关键词：待办、任务、提醒、完成、截止
   
2. cli_calendar - 日历操作
   关键词：日程、会议、日历、安排、预约
   
3. cli_contact - 联系人操作
   关键词：联系人、找人、搜索、电话、邮箱
   
4. cli_docs - 文档操作
   关键词：文档、创建文档、查找文档、分享
   
5. cli_approval - 审批操作
   关键词：审批、待审批、批准、拒绝
   
6. cli_task - 任务管理（飞书任务）
   关键词：飞书任务、任务列表
   
7. cli_message - 发送消息
   关键词：发消息、通知、告诉
   
8. chat - 普通对话
   关键词：问候、闲聊、询问

【判断规则】
- 如果明确提到时间+事项，优先判断为todo
- 如果提到"查看日程"、"有什么会议"，判断为cli_calendar
- 如果提到"找某人"、"联系方式"，判断为cli_contact
- 如果提到"创建文档"、"查找文档"，判断为cli_docs
- 如果提到"审批"、"待审批"，判断为cli_approval

返回JSON格式：
{
  "type": "操作类型",
  "confidence": 0.9,
  "action": "具体动作(如: view_agenda, search_user, create_doc)",
  "params": { "提取的参数" },
  "requiresConfirmation": false,
  "description": "操作描述"
}

用户输入：${userInput}`;

      const content = await this.provider.chat({
        messages: [
          { role: "system", content: "只返回JSON，不要其他文本。" },
          { role: "user", content: prompt },
        ],
        temperature: 0,
      });

      if (!content) {
        return { type: "todo", confidence: 0.5 };
      }

      const result = JSON.parse(content) as IntentAnalysisResult;
      return result;
    } catch (error) {
      console.error("[ai] Intent analysis failed:", error);
      return { type: "todo", confidence: 0.5 };
    }
  }

  async refineTodoDrafts(params: {
    originalText: string;
    drafts: TodoDraft[];
    timeZone: string;
    now: number;
    chatHistory?: Array<{ role: string; content: string }>;
  }): Promise<TodoParseItem[] | null> {
    if (!this.provider || !this.config.enableAiParse) {
      return null;
    }

    try {
      const content = await this.provider.chat({
        messages: [
          {
            role: "system",
            content: "只返回 JSON 数组，不要输出额外文本。",
          },
          {
            role: "user",
            content: JSON.stringify({
              prompt: TODO_PARSE_PROMPT,
              originalText: params.originalText,
              drafts: params.drafts,
              now: params.now,
              timeZone: params.timeZone,
            }),
          },
        ],
        temperature: 0,
      });

      if (!content) {
        return null;
      }

      const parsed = JSON.parse(content) as unknown;
      if (!Array.isArray(parsed)) {
        return null;
      }

      const items: TodoParseItem[] = [];
      for (const item of parsed) {
        if (!item || typeof item !== "object") continue;
        const entry = item as Partial<TodoParseItem>;
        if (typeof entry.title !== "string" || !entry.title.trim()) continue;
        items.push({
          title: entry.title.trim(),
          priority: entry.priority === "high" || entry.priority === "low" ? entry.priority : "medium",
          ...(entry.risk && (entry.risk === "high" || entry.risk === "medium" || entry.risk === "low") ? { risk: entry.risk } : { risk: "medium" }),
          ...(entry.due && typeof entry.due.timestamp === "string" ? { due: entry.due } : {}),
          ...(typeof entry.assigneeOpenId === "string" && entry.assigneeOpenId.trim() ? { assigneeOpenId: entry.assigneeOpenId.trim() } : {}),
          ...(typeof entry.notes === "string" && entry.notes.trim() ? { notes: entry.notes.trim() } : {}),
          fallbackUsed: Boolean(entry.fallbackUsed),
        });
      }

      return items.length > 0 ? items : null;
    } catch {
      return null;
    }
  }
}

export function buildTodoConfirmSummary(drafts: TodoDraft[]): TodoConfirmSummary {
  return {
    title: `我理解成了 ${drafts.length} 条待办`,
    lines: drafts.map((draft, index) => {
      const parts = [`${index + 1}. ${draft.title}`];
      parts.push(`优先级: ${draft.priority}`);
      if (draft.due) {
        parts.push(`截止: ${draft.due.is_all_day ? draft.due.timestamp.slice(0, 10) : draft.due.timestamp}`);
      }
      if (draft.notes) {
        parts.push(`备注: ${draft.notes}`);
      }
      return parts.join(" | ");
    }),
    items: drafts,
  };
}

function normalizeDueTimestamp(value: string): number | null {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function toBaseRecordFields(item: TodoParseItem): FeishuBaseRecord["fields"] {
  const fields: FeishuBaseRecord["fields"] = {
    待办事项: item.title,
    优先级: item.priority === "high" ? "🔴P0-高优" : item.priority === "low" ? "🟢P2-低优" : "🟡P1-一般",
    是否已完成: false,
    创建时间: Date.now(), // 所有任务都添加创建时间
  };

  // 添加风险评估字段（默认为中风险）
  fields["AI 特办事项风险总"] = item.risk === "high" ? "🔴高风险" : item.risk === "low" ? "🟢低风险" : "🟡中风险";

  if (item.due) {
    const timestamp = normalizeDueTimestamp(item.due.timestamp);
    if (timestamp !== null) {
      fields["截止日期"] = timestamp;
    }
  }

  if (item.assigneeOpenId) {
    fields["执行人"] = [{ id: item.assigneeOpenId }];
  }

  // 添加备注字段
  if (item.notes && item.notes.trim()) {
    fields["备注"] = item.notes.trim();
  }

  return fields;
}
