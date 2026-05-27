import crypto from "node:crypto";
import type { AppConfig } from "./config.js";
import type { FeishuApiResponse, FeishuTask, FeishuTaskListItem, ParsedTask, TaskDue, TaskMember, TaskListRef, FeishuMessageReceiveEvent } from "./types.js";
import { buildTaskCreatedCard, buildTodayTasksText, buildTomorrowTasksText } from "./cards.js";
import { formatDateKey, shiftUtcMsByDays } from "./time.js";
import type { AIClient, ImageTask, OptimizationResult } from "./ai.js";

export interface FeishuClientOptions {
  fetchImpl?: typeof fetch;
}

export class FeishuClient {
  private readonly fetchImpl: typeof fetch;
  private tenantAccessToken: string | null = null;
  private tenantAccessTokenExpiresAt = 0;

  constructor(private readonly config: AppConfig, options: FeishuClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async requestJson<T>(input: RequestInfo | URL, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(input, init);
    const payload = (await response.json()) as T;
    if (!response.ok) {
      throw new Error(`Feishu API HTTP ${response.status}`);
    }
    return payload;
  }

  async getTenantAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tenantAccessToken && now < this.tenantAccessTokenExpiresAt) {
      return this.tenantAccessToken;
    }

    // 注意：此接口的 tenant_access_token 和 expire 字段位于响应顶层，而非 data 字段内
    const payload = await this.requestJson<{
      code: number;
      msg: string;
      tenant_access_token?: string;
      expire?: number;
    }>(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          app_id: this.config.feishuAppId,
          app_secret: this.config.feishuAppSecret,
        }),
      },
    );

    if (payload.code !== 0 || !payload.tenant_access_token || !payload.expire) {
      throw new Error(`Failed to get tenant access token: ${payload.msg}`);
    }

    this.tenantAccessToken = payload.tenant_access_token;
    this.tenantAccessTokenExpiresAt = now + Math.max(payload.expire - 60, 60) * 1000;
    return this.tenantAccessToken;
  }

  private async authedRequest<T>(path: string, init: RequestInit): Promise<T> {
    const token = await this.getTenantAccessToken();
    return this.requestJson<T>(`https://open.feishu.cn/open-apis${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
        ...(init.headers ?? {}),
      },
    });
  }

  async createTask(params: { parsed: ParsedTask; actorOpenId?: string }): Promise<FeishuTask> {
    const members: TaskMember[] = params.actorOpenId
      ? [
          {
            id: params.actorOpenId,
            type: "user",
            role: "assignee",
          },
        ]
      : [];

    const tasklists: TaskListRef[] = [{ guid: this.config.feishuTasklistGuid }];

    const payload = await this.authedRequest<FeishuApiResponse<{ task: FeishuTask }>>("/task/v2/tasks", {
      method: "POST",
      body: JSON.stringify({
        summary: params.parsed.title,
        description: params.parsed.notes ?? "",
        due: params.parsed.due,
        members,
        tasklists,
        client_token: crypto.randomUUID(),
      }),
    });

    if (payload.code !== 0 || !payload.data?.task) {
      throw new Error(`Create task failed: ${payload.msg}`);
    }

    return payload.data.task;
  }

  async listTodayTasks(now = Date.now()): Promise<FeishuTaskListItem[]> {
    const payload = await this.authedRequest<FeishuApiResponse<{ items?: FeishuTaskListItem[] }>>(
      `/task/v2/tasklists/${encodeURIComponent(this.config.feishuTasklistGuid)}/tasks?page_size=100&completed=false&user_id_type=open_id`,
      { method: "GET" },
    );

    if (payload.code !== 0) {
      throw new Error(`List tasks failed: ${payload.msg}`);
    }

    const todayKey = formatDateKey(now, this.config.timezone);
    return (payload.data?.items ?? []).filter((task) => {
      if (!task.due || task.completed_at) {
        return false;
      }
      return formatDateKey(Number(task.due.timestamp), this.config.timezone) === todayKey;
    });
  }

  async patchTask(taskGuid: string, patch: { completedAt?: string; due?: TaskDue | null; summary?: string; description?: string }): Promise<FeishuTask> {
    const updateFields: string[] = [];
    const task: Record<string, unknown> = {};

    if (patch.completedAt !== undefined) {
      updateFields.push("completed_at");
      task.completed_at = patch.completedAt;
    }
    if (patch.due !== undefined) {
      updateFields.push("due");
      task.due = patch.due;
    }
    if (patch.summary !== undefined) {
      updateFields.push("summary");
      task.summary = patch.summary;
    }
    if (patch.description !== undefined) {
      updateFields.push("description");
      task.description = patch.description;
    }

    const payload = await this.authedRequest<FeishuApiResponse<{ task: FeishuTask }>>(`/task/v2/tasks/${encodeURIComponent(taskGuid)}`, {
      method: "PATCH",
      body: JSON.stringify({
        task,
        update_fields: updateFields,
      }),
    });

    if (payload.code !== 0 || !payload.data?.task) {
      throw new Error(`Patch task failed: ${payload.msg}`);
    }

    return payload.data.task;
  }

  async completeTask(taskGuid: string): Promise<FeishuTask> {
    return this.patchTask(taskGuid, { completedAt: String(Date.now()) });
  }

  async postponeTaskOneDay(taskGuid: string, due: TaskDue): Promise<FeishuTask> {
    return this.patchTask(taskGuid, {
      due: {
        ...due,
        timestamp: String(shiftUtcMsByDays(Number(due.timestamp), 1)),
      },
    });
  }

  async replyText(messageId: string, text: string): Promise<void> {
    const payload = await this.authedRequest<FeishuApiResponse<{ message_id: string }>>(`/im/v1/messages/${encodeURIComponent(messageId)}/reply`, {
      method: "POST",
      body: JSON.stringify({
        msg_type: "text",
        content: JSON.stringify({ text }),
      }),
    });
    if (payload.code !== 0) {
      throw new Error(`Reply text failed: ${payload.msg}`);
    }
  }

  async replyCard(messageId: string, card: Record<string, unknown>): Promise<void> {
    const payload = await this.authedRequest<FeishuApiResponse<{ message_id: string }>>(`/im/v1/messages/${encodeURIComponent(messageId)}/reply`, {
      method: "POST",
      body: JSON.stringify({
        msg_type: "interactive",
        content: JSON.stringify(card),
      }),
    });
    if (payload.code !== 0) {
      throw new Error(`Reply card failed: ${payload.msg}`);
    }
  }

  async handleCreatedTaskReply(params: { messageId: string; parsed: ParsedTask; task: FeishuTask }): Promise<void> {
    await this.replyCard(
      params.messageId,
      buildTaskCreatedCard({ task: params.task, parsed: params.parsed, timeZone: this.config.timezone }),
    );
  }

  async handleTodayTasksReply(messageId: string, now = Date.now()): Promise<void> {
    const tasks = await this.listTodayTasks(now);
    await this.replyText(messageId, buildTodayTasksText(tasks, this.config.timezone));
  }

  async listTomorrowTasks(now = Date.now()): Promise<FeishuTaskListItem[]> {
    const payload = await this.authedRequest<FeishuApiResponse<{ items?: FeishuTaskListItem[] }>>(
      `/task/v2/tasklists/${encodeURIComponent(this.config.feishuTasklistGuid)}/tasks?page_size=100&completed=false&user_id_type=open_id`,
      { method: "GET" },
    );

    if (payload.code !== 0) {
      throw new Error(`List tasks failed: ${payload.msg}`);
    }

    const tomorrowKey = formatDateKey(now + 24 * 60 * 60 * 1000, this.config.timezone);
    return (payload.data?.items ?? []).filter((task) => {
      if (!task.due || task.completed_at) {
        return false;
      }
      return formatDateKey(Number(task.due.timestamp), this.config.timezone) === tomorrowKey;
    });
  }

  async handleTomorrowTasksReply(messageId: string, now = Date.now()): Promise<void> {
    const tasks = await this.listTomorrowTasks(now);
    await this.replyText(messageId, buildTomorrowTasksText(tasks, this.config.timezone));
  }

  async handleCardAction(event: { open_message_id?: string; action?: { value?: Record<string, unknown> } }): Promise<{ toast: { type: string; content: string } }> {
    const value = event.action?.value;
    const action = value?.action;
    const taskGuid = typeof value?.task_guid === "string" ? value.task_guid : undefined;
    if (!action || !taskGuid) {
      return { toast: { type: "warning", content: "未识别卡片操作" } };
    }

    if (action === "complete") {
      await this.completeTask(taskGuid);
      return { toast: { type: "info", content: "已完成" } };
    }

    if (action === "postpone_one_day") {
      const dueTimestamp = typeof value?.due_timestamp === "string" ? value.due_timestamp : undefined;
      const dueIsAllDay = Boolean(value?.due_is_all_day);
      if (!dueTimestamp) {
        return { toast: { type: "warning", content: "缺少截止时间，无法延期" } };
      }

      await this.postponeTaskOneDay(taskGuid, {
        timestamp: dueTimestamp,
        is_all_day: dueIsAllDay,
      });
      return { toast: { type: "info", content: "已延期一天" } };
    }

    return { toast: { type: "warning", content: "未识别卡片操作" } };
  }

  /**
   * 下载图片并转换为 base64
   */
  private async downloadImageAsBase64(imageKey: string): Promise<string> {
    const token = await this.getTenantAccessToken();
    const response = await this.fetchImpl(
      `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(imageKey)}/resources/${encodeURIComponent(imageKey)}?type=image`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`下载图片失败: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString("base64");
  }

  /**
   * 处理图片消息 - 识别并创建任务
   */
  async handleImageMessage(params: {
    messageId: string;
    event: FeishuMessageReceiveEvent;
    aiClient: AIClient;
  }): Promise<void> {
    const content = params.event.message?.content;
    if (!content) {
      await this.replyText(params.messageId, "❌ 无法获取图片内容");
      return;
    }

    let imageKey: string;
    try {
      const parsed = JSON.parse(content) as { image_key?: string };
      imageKey = parsed.image_key ?? "";
      if (!imageKey) {
        await this.replyText(params.messageId, "❌ 无法获取图片 key");
        return;
      }
    } catch {
      await this.replyText(params.messageId, "❌ 解析图片消息失败");
      return;
    }

    // 下载图片
    await this.replyText(params.messageId, "🔍 正在识别图片中的任务信息...");
    const imageBase64 = await this.downloadImageAsBase64(imageKey);

    // AI 识别
    const tasks = await params.aiClient.analyzeImage({
      imageBase64,
      timeZone: this.config.timezone,
      now: Date.now(),
    });

    if (tasks.length === 0) {
      await this.replyText(params.messageId, "😅 图片中没有识别到任务信息");
      return;
    }

    // 创建任务
    const actorOpenId = params.event.sender?.sender_id?.open_id;
    const createdTasks: FeishuTask[] = [];

    for (const task of tasks) {
      if (task.confidence < 0.5) {
        console.log(`  ↳ 跳过低置信度任务: ${task.title} (${task.confidence})`);
        continue;
      }

      const parsed: ParsedTask = {
        title: task.title,
        ...(task.due ? { due: task.due } : {}),
        priority: task.priority,
        ...(task.notes ? { notes: task.notes } : {}),
        fallbackUsed: false,
      };

      const created = await this.createTask({
        parsed,
        ...(actorOpenId ? { actorOpenId } : {}),
      });
      createdTasks.push(created);
    }

    // 回复结果
    if (createdTasks.length === 0) {
      await this.replyText(params.messageId, "😅 识别到的任务置信度较低，未创建");
      return;
    }

    const summary = [
      `✅ 已从图片中识别并创建 ${createdTasks.length} 个任务：`,
      "",
      ...createdTasks.map((t, i) => {
        const task = tasks.find((it) => it.title === t.summary);
        return `${i + 1}. 📝 ${t.summary}${t.due ? `\n   ⏰ ${new Date(Number(t.due.timestamp)).toLocaleString("zh-CN", { timeZone: this.config.timezone })}` : ""}${task?.notes ? `\n   💡 ${task.notes}` : ""}`;
      }),
    ].join("\n");

    await this.replyText(params.messageId, summary);
  }

  /**
   * 获取所有未完成任务
   */
  async listAllTasks(): Promise<FeishuTaskListItem[]> {
    const payload = await this.authedRequest<FeishuApiResponse<{ items?: FeishuTaskListItem[] }>>(
      `/task/v2/tasklists/${encodeURIComponent(this.config.feishuTasklistGuid)}/tasks?page_size=100&completed=false&user_id_type=open_id`,
      { method: "GET" }
    );

    if (payload.code !== 0) {
      throw new Error(`List tasks failed: ${payload.msg}`);
    }

    return payload.data?.items ?? [];
  }

  /**
   * 处理优化命令 - AI 分析并给出建议
   */
  async handleOptimizeCommand(params: {
    messageId: string;
    aiClient: AIClient;
  }): Promise<void> {
    await this.replyText(params.messageId, "🤔 正在分析你的待办清单...");

    // 获取所有任务
    const tasks = await this.listAllTasks();

    if (tasks.length === 0) {
      await this.replyText(params.messageId, "📋 当前没有待办任务");
      return;
    }

    // AI 分析
    const result: OptimizationResult = await params.aiClient.optimizeTodolist({
      tasks,
      timeZone: this.config.timezone,
      now: Date.now(),
    });

    // 构建回复
    const lines = ["📊 任务分析完成", ""];

    if (result.suggestions.length === 0) {
      lines.push("✅ 你的任务安排很合理，继续保持！");
    } else {
      lines.push(`⚠️ 发现 ${result.suggestions.length} 个优化建议：`, "");

      const severityIcon = { high: "🔴", medium: "🟡", low: "🟢" };
      const typeLabel = {
        priority: "优先级",
        conflict: "时间冲突",
        split: "任务分解",
        merge: "任务合并",
        estimate: "时间预估",
        overload: "工作负荷",
      };

      result.suggestions.forEach((s, i) => {
        lines.push(
          `${i + 1}. ${severityIcon[s.severity]} ${typeLabel[s.type]}`,
          `   ${s.reason}`,
          `   💡 ${s.action}`,
          ""
        );
      });
    }

    lines.push("", `📝 ${result.summary}`);

    await this.replyText(params.messageId, lines.join("\n"));
  }
}
