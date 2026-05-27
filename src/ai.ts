import type { AppConfig } from "./config.js";
import type { ParsedTask, FeishuTaskListItem } from "./types.js";

// ============================================================================
// AI 提示词模板
// ============================================================================

const TASK_PARSE_PROMPT = `你是一个智能任务解析助手。从用户输入中提取待办事项的完整信息。

用户输入：{userInput}
当前时间：{now}
时区：{timezone}

提取以下信息：
- title: 任务标题（简洁明了，去除时间、优先级等修饰词）
- due: 截止时间（ISO 8601 格式，理解相对时间如"明天"、"下周一"）
- priority: 优先级（识别"紧急"、"重要"、"p1/p2/p3"等关键词，返回 high/medium/low）
- notes: 备注信息（地点、参与人、详细说明等）
- is_all_day: 是否全天任务（如果没有具体时间点，返回 true）

返回 JSON 格式：
{
  "title": "任务标题",
  "due": {
    "timestamp": "2026-05-27T15:00:00+08:00",
    "is_all_day": false
  },
  "priority": "medium",
  "notes": "备注信息"
}

如果无法确定某些信息，可以省略对应字段。`;

const IMAGE_ANALYSIS_PROMPT = `你是一个智能任务提取助手。分析这张图片，识别所有待办事项信息。

图片可能包含：
- 📅 会议通知：提取会议主题、时间、地点、参与人
- 💬 聊天记录：识别提到的待办事项
- 📄 文档截图：提取关键任务点、截止日期
- 📋 清单/表格：识别任务列表
- 🎯 其他：任何需要跟进的事项

返回 JSON 数组，每个任务包含：
{
  "title": "任务标题（简洁明了）",
  "due": {
    "timestamp": "ISO 8601 格式（如果能识别）",
    "is_all_day": true/false
  },
  "priority": "high|medium|low（根据紧急程度判断）",
  "notes": "补充信息（地点、参与人、备注等）",
  "confidence": 0.0-1.0  // 识别置信度
}

如果图片中没有明确的任务信息，返回空数组 []。
当前时间：{now}
时区：{timezone}`;

const OPTIMIZE_PROMPT = `你是一位专业的时间管理顾问。分析用户的待办清单，给出优化建议。

当前任务列表：
{tasks}

当前时间：{now}
用户时区：{timezone}

请从以下维度分析：
1. ⚡ 优先级合理性：是否有紧急任务被标记为低优先级？
2. ⏰ 时间冲突：是否有任务时间重叠？
3. 🔨 任务分解：哪些大任务需要拆分成小步骤？
4. 🔗 任务合并：哪些相似任务可以合并处理？
5. ⏱️ 时间预估：每个任务大概需要多久？
6. 📊 工作负荷：今天的任务量是否合理？

返回 JSON 格式：
{
  "suggestions": [
    {
      "type": "priority|conflict|split|merge|estimate|overload",
      "task_ids": ["任务ID"],
      "severity": "high|medium|low",
      "reason": "问题说明",
      "action": "具体建议"
    }
  ],
  "summary": "总体评估和建议（2-3句话）"
}`;

// ============================================================================
// 类型定义
// ============================================================================

export interface ImageTask {
  title: string;
  due?: {
    timestamp: string;
    is_all_day: boolean;
  };
  priority: "high" | "medium" | "low";
  notes?: string;
  confidence: number;
}

export interface OptimizationSuggestion {
  type: "priority" | "conflict" | "split" | "merge" | "estimate" | "overload";
  task_ids: string[];
  severity: "high" | "medium" | "low";
  reason: string;
  action: string;
}

export interface OptimizationResult {
  suggestions: OptimizationSuggestion[];
  summary: string;
}

// ============================================================================
// AI 客户端
// ============================================================================

export class AIClient {
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  /**
   * 增强的任务解析（使用 AI）
   */
  async parseTask(params: {
    originalText: string;
    draft: ParsedTask;
    timeZone: string;
    now: number;
  }): Promise<ParsedTask | null> {
    if (!this.config.openaiApiKey || !this.config.enableAiParse) {
      return null;
    }

    try {
      const prompt = TASK_PARSE_PROMPT.replace("{userInput}", params.originalText)
        .replace("{now}", new Date(params.now).toISOString())
        .replace("{timezone}", params.timeZone);

      const response = await fetch(`${this.config.openaiApiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.openaiModel,
          temperature: 0,
          messages: [
            {
              role: "system",
              content: "你是一个任务解析助手。只返回 JSON，不要有其他文字。",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        console.error(`  ↳ AI 解析失败: ${response.status} ${response.statusText}`);
        return null;
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) {
        return null;
      }

      const parsed = JSON.parse(content) as Partial<ParsedTask>;
      if (typeof parsed.title !== "string" || !parsed.title.trim()) {
        return null;
      }

      const result: ParsedTask = {
        title: parsed.title.trim(),
        priority: parsed.priority === "high" || parsed.priority === "low" ? parsed.priority : "medium",
        fallbackUsed: false,
      };

      if (parsed.due && typeof parsed.due.timestamp === "string") {
        result.due = parsed.due;
      } else if (params.draft.due) {
        result.due = params.draft.due;
      }

      if (typeof parsed.notes === "string" && parsed.notes.trim()) {
        result.notes = parsed.notes.trim();
      } else if (params.draft.notes) {
        result.notes = params.draft.notes;
      }

      return result;
    } catch (error) {
      console.error("  ↳ AI 解析异常:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * 图片识别 - 提取任务
   */
  async analyzeImage(params: {
    imageBase64: string;
    timeZone: string;
    now: number;
  }): Promise<ImageTask[]> {
    if (!this.config.openaiApiKey || !this.config.enableImageRecognition) {
      throw new Error("图片识别功能未启用");
    }

    try {
      const prompt = IMAGE_ANALYSIS_PROMPT.replace("{now}", new Date(params.now).toISOString()).replace(
        "{timezone}",
        params.timeZone
      );

      const model = this.config.openaiVisionModel || this.config.openaiModel;

      const response = await fetch(`${this.config.openaiApiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            {
              role: "system",
              content: "你是一个图片任务提取助手。只返回 JSON 数组，不要有其他文字。",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: prompt,
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/jpeg;base64,${params.imageBase64}`,
                  },
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`  ↳ 图片识别失败: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`图片识别失败: ${response.status}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) {
        return [];
      }

      const tasks = JSON.parse(content) as ImageTask[];
      return Array.isArray(tasks) ? tasks : [];
    } catch (error) {
      console.error("  ↳ 图片识别异常:", error instanceof Error ? error.message : error);
      throw error;
    }
  }

  /**
   * 智能优化 Todolist
   */
  async optimizeTodolist(params: {
    tasks: FeishuTaskListItem[];
    timeZone: string;
    now: number;
  }): Promise<OptimizationResult> {
    if (!this.config.openaiApiKey || !this.config.enableTodoOptimization) {
      throw new Error("智能优化功能未启用");
    }

    try {
      const tasksJson = JSON.stringify(
        params.tasks.map((t) => ({
          guid: t.guid,
          title: t.summary,
          due: t.due,
          description: t.description,
          completed: !!t.completed_at,
        })),
        null,
        2
      );

      const prompt = OPTIMIZE_PROMPT.replace("{tasks}", tasksJson)
        .replace("{now}", new Date(params.now).toISOString())
        .replace("{timezone}", params.timeZone);

      const response = await fetch(`${this.config.openaiApiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.openaiModel,
          temperature: 0.3,
          messages: [
            {
              role: "system",
              content: "你是一个时间管理顾问。只返回 JSON，不要有其他文字。",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`  ↳ 智能优化失败: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`智能优化失败: ${response.status}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) {
        return { suggestions: [], summary: "无法生成优化建议" };
      }

      const result = JSON.parse(content) as OptimizationResult;
      return result;
    } catch (error) {
      console.error("  ↳ 智能优化异常:", error instanceof Error ? error.message : error);
      throw error;
    }
  }
}

// ============================================================================
// 兼容旧接口
// ============================================================================

export async function maybeRefineParseWithOpenAI(params: {
  apiKey?: string;
  model: string;
  originalText: string;
  draft: ParsedTask;
  timeZone: string;
  now: number;
}): Promise<ParsedTask | null> {
  const { apiKey } = params;
  if (!apiKey) {
    return null;
  }

  // 使用旧的简单实现保持向后兼容
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You extract structured todo items from Chinese text. Return only valid JSON with keys title, due, priority, notes. due is either null or an object with timestamp and is_all_day. priority must be high, medium, or low. If information is missing, make the best reasonable guess from the text. Use the current timezone: " +
            params.timeZone +
            ".",
        },
        {
          role: "user",
          content: JSON.stringify({
            originalText: params.originalText,
            draft: params.draft,
            now: params.now,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content) as Partial<ParsedTask>;
    if (typeof parsed.title !== "string" || !parsed.title.trim()) {
      return null;
    }

    const result: ParsedTask = {
      title: parsed.title.trim(),
      priority: parsed.priority === "high" || parsed.priority === "low" ? parsed.priority : "medium",
      fallbackUsed: true,
    };

    if (parsed.due && typeof parsed.due.timestamp === "string") {
      result.due = parsed.due;
    } else if (params.draft.due) {
      result.due = params.draft.due;
    }

    if (typeof parsed.notes === "string" && parsed.notes.trim()) {
      result.notes = parsed.notes.trim();
    } else if (params.draft.notes) {
      result.notes = params.draft.notes;
    }

    return result;
  } catch {
    return null;
  }
}
