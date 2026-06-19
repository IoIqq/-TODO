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

【开始时间】
如果用户明确说“开始/开始时间/从...开始”，把该时间写入 start；截止/完成/提交时间仍写入 due。

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
    "start": { "timestamp": "2026-05-28T09:00:00+08:00", "is_all_day": false },
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
  start?: {
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

export type IntentType =
  | "todo_create"     // 明确要创建待办
  | "todo_query"      // 查询待办列表
  | "todo_complete"   // 完成待办
  | "cli_calendar"
  | "cli_contact"
  | "cli_docs"
  | "cli_approval"
  | "cli_task"
  | "cli_message"
  | "chat"            // 闲聊/问答
  | "unknown"         // 不确定
  // 兼容旧版本
  | "todo";

export interface IntentAnalysisResult {
  type: IntentType;
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
    if (!this.provider) {
      // 没有 AI 时，默认作为不确定意图（不再粗暴当作待办）
      return { type: "unknown", confidence: 0.3 };
    }

    try {
      const prompt = `判断用户输入属于哪种意图，只返回 JSON。

【意图类型】
1. todo_create - 明确要创建待办（必须有"动作+时间"或明确的任务关键词）
   ✅ "明天3点提交周报"
   ✅ "提醒我下午开会"
   ✅ "记一下：买牛奶"
   ❌ "最近代办" → todo_query
   ❌ "你好" → chat

2. todo_query - 查询/查看待办
   ✅ "最近代办有什么"
   ✅ "我有什么任务"
   ✅ "查看待办"
   ✅ "今天要做什么"

3. todo_complete - 完成某个待办
   ✅ "我完成了周报"
   ✅ "把买菜标记完成"

4. cli_calendar - 日历日程（不是待办）
   ✅ "明天有什么会议"
   ✅ "查看日程"

5. cli_contact - 找联系人
   ✅ "找张三"
   ✅ "张三的电话"

6. cli_docs - 文档相关
   ✅ "查找项目方案"
   ✅ "创建会议纪要"

7. cli_approval - 审批
   ✅ "我有什么待审批"

8. chat - 闲聊/问答/求助（不是任务，不是查询）
   ✅ "你好"
   ✅ "今天天气怎么样"
   ✅ "帮我想想周报怎么写"
   ✅ "谢谢"
   ✅ "你是谁"

9. unknown - 完全无法判断

【关键判断规则】
- "代办/待办" + "有什么/查看/最近/我的" → todo_query（不是 todo_create！）
- "提醒/记下/创建" + 任务内容 → todo_create
- 时间(明天/今天/几点) + 动作(开会/提交/完成) → todo_create
- 单纯的问候、感谢、问问题 → chat
- 模糊不清楚 → unknown

返回 JSON 格式：
{
  "type": "意图类型",
  "confidence": 0.9,
  "action": "可选的具体动作",
  "params": { "可选参数，如 query: '搜索词'" },
  "description": "简短的操作描述"
}

用户输入：${userInput}`;

      const content = await this.provider.chat({
        messages: [
          { role: "system", content: "只返回 JSON 对象，不要任何其他文本，不要 markdown 代码块。" },
          { role: "user", content: prompt },
        ],
        temperature: 0,
      });

      if (!content) {
        return { type: "unknown", confidence: 0.3 };
      }

      // 容错解析：去除可能的 markdown 代码块
      const cleaned = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
      const result = JSON.parse(cleaned) as IntentAnalysisResult;
      
      // 兼容旧版本：todo -> todo_create
      if ((result.type as string) === "todo") {
        result.type = "todo_create";
      }
      
      return result;
    } catch (error) {
      console.error("[ai] Intent analysis failed:", error);
      return { type: "unknown", confidence: 0.3 };
    }
  }

  /**
   * 智能聊天回答（保持简洁）
   */
  async chat(params: {
    userInput: string;
    chatHistory?: Array<{ role: string; content: string }>;
  }): Promise<string | null> {
    if (!this.provider) {
      return null;
    }

    try {
      type ChatRole = "system" | "user" | "assistant";
      const normalizeRole = (r: string): ChatRole => 
        r === "assistant" ? "assistant" : r === "system" ? "system" : "user";

      const messages: Array<{ role: ChatRole; content: string }> = [
        {
          role: "system",
          content: `你是一个飞书智能助手"小助"，主要职责是帮用户管理待办事项。
          
回答规则：
1. 简洁！用 1-3 句话回答，最多 80 字
2. 不使用 markdown 排版（不要 **加粗**、列表、标题）
3. 友好但不啰嗦，像朋友间聊天
4. 如果用户问"你能做什么"，简单介绍：管理待办、查日程、找联系人、查文档、查审批
5. 如果是闲聊问候，简短回复即可
6. 不要主动建议用户用什么命令，除非他问

不允许的回答：
- 不要长篇大论
- 不要列1234的列表
- 不要"亲爱的用户"等客套话
- 不要重复用户的问题`,
        },
        ...(params.chatHistory || []).slice(-4).map(m => ({
          role: normalizeRole(m.role),
          content: m.content,
        })),
        { role: "user", content: params.userInput },
      ];

      const content = await this.provider.chat({
        messages,
        temperature: 0.7,
      });

      if (!content) return null;
      
      // 强制限制长度，最多 150 字
      const trimmed = content.trim();
      return trimmed.length > 150 ? trimmed.substring(0, 150) + "…" : trimmed;
    } catch (error) {
      console.error("[ai] Chat failed:", error);
      return null;
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
          ...(entry.start && typeof entry.start.timestamp === "string" ? { start: entry.start } : {}),
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
      if (draft.start) {
        parts.push(`开始: ${draft.start.is_all_day ? draft.start.timestamp.slice(0, 10) : draft.start.timestamp}`);
      }
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

function normalizeTimestampValue(value: string): number | null {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeDueTimestamp(value: string): number | null {
  return normalizeTimestampValue(value);
}

export function toBaseRecordFields(item: TodoParseItem): FeishuBaseRecord["fields"] {
  // 仅写入用户表格中实际存在的字段，可选字段交由 createOneRecord 自动剔除
  const fields: FeishuBaseRecord["fields"] = {
    待办事项: item.title,
    优先级: item.priority === "high" ? "🔴P0-高优" : item.priority === "low" ? "🟢P2-低优" : "🟡P1-一般",
    是否已完成: false,
  };

  if (item.start) {
    const timestamp = normalizeTimestampValue(item.start.timestamp);
    if (timestamp !== null) {
      fields["开始时间"] = timestamp;
    }
  }

  if (item.due) {
    const timestamp = normalizeDueTimestamp(item.due.timestamp);
    if (timestamp !== null) {
      fields["截止日期"] = timestamp;
    }
  }

  if (item.assigneeOpenId) {
    fields["执行人"] = [{ id: item.assigneeOpenId }];
  }

  // 备注字段（可选，表格无此字段时会被自动剔除）
  if (item.notes && item.notes.trim()) {
    fields["备注"] = item.notes.trim();
  }

  // 注意：不写入 "AI 任务风险判断" 字段
  // 该字段是用户表格中的 AI 生成字段，由飞书 AI 自动填充，不应由我们写入

  return fields;
}
