import crypto from "node:crypto";
import type { AppConfig } from "./config.js";
import type {
  FeishuApiResponse,
  FeishuBaseMeta,
  FeishuBaseRecord,
  FeishuBaseTable,
  TodoRecordCreateResult,
} from "./types.js";
import { buildTodoConfirmCard } from "./cards.js";
import { type TodoConfirmSummary, type TodoParseItem, toBaseRecordFields } from "./ai.js";
import { cancelReminders, scheduleRecordReminders, scheduleReminders } from "./storage/index.js";

export interface FeishuClientOptions {
  fetchImpl?: typeof fetch;
}

type PendingConfirmation = {
  drafts: TodoParseItem[];
};

export class FeishuClient {
  private readonly fetchImpl: typeof fetch;
  private tenantAccessToken: string | null = null;
  private tenantAccessTokenExpiresAt = 0;
  private pendingConfirmations = new Map<string, PendingConfirmation>();

  constructor(private readonly config: AppConfig, options: FeishuClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async requestJson<T>(input: RequestInfo | URL, init: RequestInit): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetchImpl(input, init);
        const raw = await response.text();

        if (!response.ok) {
          const error = new Error(`Feishu API HTTP ${response.status}${raw ? ": " + raw : ""}`);
          if (response.status === 429 || response.status >= 500) {
            lastError = error;
            if (attempt < 2) continue;
          }
          throw error;
        }

        try {
          return JSON.parse(raw) as T;
        } catch {
          throw new Error(`Feishu API returned non-JSON payload${raw ? ": " + raw.slice(0, 500) : ""}`);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt >= 2) break;
      }
    }

    throw lastError ?? new Error("Feishu API request failed");
  }

  async getTenantAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tenantAccessToken && now < this.tenantAccessTokenExpiresAt) {
      return this.tenantAccessToken;
    }

    const payload = await this.requestJson<{
      code: number;
      msg: string;
      tenant_access_token?: string;
      expire?: number;
      data?: {
        tenant_access_token?: string;
        expire?: number;
      };
    }>("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        app_id: this.config.feishuAppId,
        app_secret: this.config.feishuAppSecret,
      }),
    });

    const token = payload.tenant_access_token ?? payload.data?.tenant_access_token;
    const expire = payload.expire ?? payload.data?.expire;

    if (payload.code !== 0 || !token || !expire) {
      throw new Error(`Failed to get tenant access token: ${payload.msg}`);
    }

    this.tenantAccessToken = token;
    this.tenantAccessTokenExpiresAt = now + Math.max(expire - 60, 60) * 1000;
    return this.tenantAccessToken;
  }

  private async authedRequest<T>(path: string, init: RequestInit): Promise<T> {
    const token = await this.getTenantAccessToken();
    let lastPayload: T | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const payload = await this.requestJson<T>(`https://open.feishu.cn/open-apis${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
          ...(init.headers ?? {}),
        },
      });
      lastPayload = payload;
      const code = typeof (payload as { code?: unknown }).code === "number" ? (payload as { code: number }).code : 0;
      const retryableCode = code === 99991400 || code === 99991663 || code >= 5000000;
      if (!retryableCode || attempt >= 2) {
        return payload;
      }
    }

    return lastPayload as T;
  }

  async getBaseMeta(): Promise<FeishuBaseMeta> {
    const payload = await this.authedRequest<FeishuApiResponse<FeishuBaseMeta>>(
      `/bitable/v1/apps/${encodeURIComponent(this.config.feishuBaseToken)}/tables/${encodeURIComponent(this.config.feishuBaseTableId)}`,
      { method: "GET" },
    );
    if (payload.code !== 0 || !payload.data) {
      throw new Error(`Get base meta failed: ${payload.msg}`);
    }
    return payload.data;
  }

  async listTables(): Promise<FeishuBaseTable[]> {
    const payload = await this.authedRequest<FeishuApiResponse<{ items?: FeishuBaseTable[] }>>(
      `/bitable/v1/apps/${encodeURIComponent(this.config.feishuBaseToken)}/tables`,
      { method: "GET" },
    );
    if (payload.code !== 0) {
      throw new Error(`List base tables failed: ${payload.msg}`);
    }
    return payload.data?.items ?? [];
  }

  /**
   * 创建一条记录，遇到字段不存在错误时自动剔除该字段重试
   */
  private async createOneRecord(fields: Record<string, unknown>): Promise<FeishuBaseRecord> {
    let currentFields = { ...fields };
    const maxAttempts = 6;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const payload = await this.authedRequest<FeishuApiResponse<{ record?: FeishuBaseRecord }>>(
        `/bitable/v1/apps/${encodeURIComponent(this.config.feishuBaseToken)}/tables/${encodeURIComponent(this.config.feishuBaseTableId)}/records?user_id_type=open_id`,
        {
          method: "POST",
          body: JSON.stringify({ fields: currentFields }),
        },
      );
      
      if (payload.code === 0 && payload.data?.record) {
        return payload.data.record;
      }
      
      // 处理字段不存在错误（飞书错误码 1254017 / 1254045）
      const errMsg = payload.msg || "";
      const fieldNotFoundMatch = errMsg.match(/FieldNameNotFound|field.*not.*exist|不存在|invalid.*field/i);
      
      if (fieldNotFoundMatch) {
        // 尝试从错误信息中提取字段名
        const fieldNameMatch = errMsg.match(/[""'`]([^""'`]+)[""'`]/);
        const fieldToRemove = fieldNameMatch?.[1];
        
        if (fieldToRemove && currentFields[fieldToRemove] !== undefined) {
          console.warn(`[feishu] Field "${fieldToRemove}" not found in table, removing and retrying...`);
          delete currentFields[fieldToRemove];
          continue;
        }
        
        // 没有匹配到具体字段名，按优先级剔除可选字段
        const optionalFields = ["AI 特办事项风险总", "备注", "创建时间", "执行人"];
        let removed = false;
        for (const f of optionalFields) {
          if (currentFields[f] !== undefined) {
            console.warn(`[feishu] Removing optional field "${f}" and retrying...`);
            delete currentFields[f];
            removed = true;
            break;
          }
        }
        if (removed) continue;
      }
      
      throw new Error(`Create base record failed: ${payload.msg}`);
    }
    
    throw new Error("Create base record failed: max retry attempts exceeded");
  }

  async createTodoRecordsOneByOne(params: { items: TodoParseItem[] }): Promise<TodoRecordCreateResult[]> {
    const results: TodoRecordCreateResult[] = [];
    for (const item of params.items) {
      const record = await this.createOneRecord(toBaseRecordFields(item));
      this.scheduleDeadlineReminder(record.record_id, item);
      results.push({ recordId: record.record_id, fields: record.fields });
    }
    return results;
  }

  private scheduleDeadlineReminder(recordId: string, item: TodoParseItem): void {
    if (!item.assigneeOpenId || (!item.due && !item.start)) return;
    const dueTimestamp = item.due ? normalizeTimestamp(item.due.timestamp) : null;
    const startTimestamp = item.start ? normalizeTimestamp(item.start.timestamp) : null;
    if (dueTimestamp === null && startTimestamp === null) return;

    try {
      scheduleReminders({
        recordId,
        title: item.title,
        priority: item.priority,
        ...(dueTimestamp === null ? {} : { dueTimestamp }),
        ...(startTimestamp === null ? {} : { startTimestamp }),
        assigneeOpenId: item.assigneeOpenId,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[deadline] schedule reminder failed for ${recordId}: ${msg}`);
    }
  }

  private cancelDeadlineReminders(recordId: string): void {
    try {
      cancelReminders(recordId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[deadline] cancel reminder failed for ${recordId}: ${msg}`);
    }
  }

  private scheduleDeadlineReminderFromRecord(record: FeishuBaseRecord, dueTimestamp: number | null, fallback?: { title?: string; priority?: string; assigneeOpenId?: string; startTimestamp?: number }): void {
    const assigneeOpenIds = extractOpenIds(record.fields["执行人"]);
    if (assigneeOpenIds.length === 0 && fallback?.assigneeOpenId) {
      assigneeOpenIds.push(fallback.assigneeOpenId);
    }
    if (assigneeOpenIds.length === 0) {
      this.cancelDeadlineReminders(record.record_id);
      return;
    }

    const startTimestamp = normalizeTimestamp(record.fields["开始时间"]) ?? fallback?.startTimestamp ?? null;
    if (dueTimestamp === null && startTimestamp === null) {
      this.cancelDeadlineReminders(record.record_id);
      return;
    }

    try {
      scheduleRecordReminders({
        recordId: record.record_id,
        title: String(record.fields["待办事项"] || fallback?.title || "未命名任务"),
        priority: String(record.fields["优先级"] || fallback?.priority || "普通"),
        ...(dueTimestamp === null ? {} : { dueTimestamp }),
        ...(startTimestamp === null ? {} : { startTimestamp }),
        assigneeOpenIds,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[deadline] reschedule reminder failed for ${record.record_id}: ${msg}`);
    }
  }

  private runCardAction(actionName: string, action: () => Promise<void>): void {
    void (async () => {
      try {
        await action();
      } catch (error) {
        console.error(`${actionName} failed`, error);
      }
    })();
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

  /**
   * 主动发送消息（不依赖 reply）
   * @param receiveIdType  open_id / user_id / union_id / chat_id / email
   */
  async sendMessage(params: {
    receiveId: string;
    receiveIdType?: "open_id" | "user_id" | "union_id" | "chat_id" | "email";
    msgType: "text" | "interactive";
    content: Record<string, unknown> | string;
  }): Promise<{ messageId?: string }> {
    const idType = params.receiveIdType ?? "open_id";
    const contentStr =
      typeof params.content === "string" ? params.content : JSON.stringify(params.content);

    const payload = await this.authedRequest<FeishuApiResponse<{ message_id?: string }>>(
      `/im/v1/messages?receive_id_type=${idType}`,
      {
        method: "POST",
        body: JSON.stringify({
          receive_id: params.receiveId,
          msg_type: params.msgType,
          content: contentStr,
        }),
      },
    );

    if (payload.code !== 0) {
      throw new Error(`Send message failed: ${payload.msg}`);
    }
    const messageId = payload.data?.message_id;
    return messageId ? { messageId } : {};
  }

  /**
   * 主动给单个用户发文本
   */
  async sendTextToUser(openId: string, text: string): Promise<void> {
    await this.sendMessage({
      receiveId: openId,
      receiveIdType: "open_id",
      msgType: "text",
      content: { text },
    });
  }

  /**
   * 主动给单个用户发交互卡片
   */
  async sendCardToUser(openId: string, card: Record<string, unknown>): Promise<void> {
    await this.sendMessage({
      receiveId: openId,
      receiveIdType: "open_id",
      msgType: "interactive",
      content: card,
    });
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

  createConfirmationToken(): string {
    return crypto.randomUUID();
  }

  storePendingConfirmation(token: string, payload: PendingConfirmation): void {
    this.pendingConfirmations.set(token, payload);
  }

  consumePendingConfirmation(token: string): PendingConfirmation | undefined {
    const pending = this.pendingConfirmations.get(token);
    if (!pending) return undefined;
    this.pendingConfirmations.delete(token);
    return pending;
  }

  async replyTodoConfirmation(messageId: string, summary: TodoConfirmSummary, token: string, timeZone: string): Promise<void> {
    await this.replyCard(messageId, buildTodoConfirmCard({ summary, confirmToken: token, timeZone }));
  }

  async handleCardAction(event: { open_message_id?: string; action?: { value?: Record<string, unknown> } }): Promise<{ toast: { type: string; content: string } }> {
    const value = event.action?.value;
    const action = value?.action;
    const token = typeof value?.confirm_token === "string" ? value.confirm_token : undefined;
    const recordId = typeof value?.record_id === "string" ? value.record_id : undefined;

    if (action === "cancel_todo") {
      return { toast: { type: "info", content: "已取消" } };
    }

    if (action === "confirm_todo" && token) {
      const pending = this.consumePendingConfirmation(token);
      if (!pending) {
        return { toast: { type: "warning", content: "确认信息已过期" } };
      }

      void (async () => {
        try {
          await this.createTodoRecordsOneByOne({ items: pending.drafts });
        } catch (error) {
          this.pendingConfirmations.set(token, pending);
          const message = error instanceof Error ? error.message : String(error);
          console.error("Feishu confirm action failed", message);
        }
      })();

      return {
        toast: {
          type: "success",
          content: `已开始写入 ${pending.drafts.length} 条待办`,
        },
      };
    }

    // 完成任务
    if (action === "complete_task" && recordId) {
      this.runCardAction("Complete task", async () => {
        await this.updateRecord(recordId, { 是否已完成: true });
        this.cancelDeadlineReminders(recordId);
      });
      return { toast: { type: "success", content: "✅ 已开始完成" } };
    }

    // 延期任务
    if (action === "postpone_task" && recordId) {
      const currentDueTimestamp = normalizeTimestamp(value?.current_due_timestamp ?? value?.current_due);
      if (currentDueTimestamp === null) {
        return { toast: { type: "warning", content: "该任务没有截止时间，无法延期" } };
      }

      const deferMsRaw = typeof value?.defer_ms === "number" ? value.defer_ms : Number(value?.defer_ms ?? 24 * 60 * 60 * 1000);
      const deferMs = deferMsRaw === 30 * 60 * 1000 || deferMsRaw === 24 * 60 * 60 * 1000
        ? deferMsRaw
        : 24 * 60 * 60 * 1000;
      const newDueTimestamp = currentDueTimestamp + deferMs;
      const startTimestamp = normalizeTimestamp(value?.start_timestamp);
      const fallbackAssignee = typeof value?.assignee_open_id === "string" ? value.assignee_open_id : undefined;
      this.runCardAction("Postpone task", async () => {
        const updated = await this.updateRecord(recordId, { "截止日期": newDueTimestamp });
        this.scheduleDeadlineReminderFromRecord(updated, newDueTimestamp, {
          ...(typeof value?.title === "string" ? { title: value.title } : {}),
          ...(typeof value?.priority === "string" ? { priority: value.priority } : {}),
          ...(fallbackAssignee ? { assigneeOpenId: fallbackAssignee } : {}),
          ...(startTimestamp === null ? {} : { startTimestamp }),
        });
      });
      const deferLabel = deferMs === 30 * 60 * 1000 ? "半小时" : "一天";
      return { toast: { type: "info", content: `⏰ 已开始延后${deferLabel}，新截止日期 ${formatDateKey(newDueTimestamp, this.config.timezone)}` } };
    }

    // 删除任务
    if (action === "delete_task" && recordId) {
      this.runCardAction("Delete task", async () => {
        await this.deleteRecord(recordId);
        this.cancelDeadlineReminders(recordId);
      });
      return { toast: { type: "info", content: "🗑️ 已开始删除" } };
    }

    return { toast: { type: "warning", content: "未找到待确认内容" } };
  }

  async debugSnapshot(): Promise<{ app: FeishuBaseMeta; tables: FeishuBaseTable[] }> {
    const [app, tables] = await Promise.all([this.getBaseMeta(), this.listTables()]);
    return { app, tables };
  }

  async listRecords(params?: { pageSize?: number; filter?: string }): Promise<FeishuBaseRecord[]> {
    const pageSize = params?.pageSize ?? 100;
    const records: FeishuBaseRecord[] = [];
    let pageToken: string | undefined;

    do {
      let url = `/bitable/v1/apps/${encodeURIComponent(this.config.feishuBaseToken)}/tables/${encodeURIComponent(this.config.feishuBaseTableId)}/records?page_size=${pageSize}&user_id_type=open_id`;

      if (params?.filter) {
        url += `&filter=${encodeURIComponent(params.filter)}`;
      }
      if (pageToken) {
        url += `&page_token=${encodeURIComponent(pageToken)}`;
      }

      const payload = await this.authedRequest<FeishuApiResponse<{ items?: FeishuBaseRecord[]; has_more?: boolean; page_token?: string }>>(url, {
        method: "GET",
      });

      if (payload.code !== 0) {
        throw new Error(`List records failed: ${payload.msg}`);
      }

      records.push(...(payload.data?.items ?? []));
      pageToken = payload.data?.has_more ? payload.data.page_token : undefined;
    } while (pageToken);

    return records;
  }

  async updateRecord(recordId: string, fields: Record<string, unknown>): Promise<FeishuBaseRecord> {
    const payload = await this.authedRequest<FeishuApiResponse<{ record?: FeishuBaseRecord }>>(
      `/bitable/v1/apps/${encodeURIComponent(this.config.feishuBaseToken)}/tables/${encodeURIComponent(this.config.feishuBaseTableId)}/records/${encodeURIComponent(recordId)}?user_id_type=open_id`,
      {
        method: "PUT",
        body: JSON.stringify({ fields }),
      },
    );

    if (payload.code !== 0 || !payload.data?.record) {
      throw new Error(`Update record failed: ${payload.msg}`);
    }

    return payload.data.record;
  }

  async deleteRecord(recordId: string): Promise<void> {
    const payload = await this.authedRequest<FeishuApiResponse<unknown>>(
      `/bitable/v1/apps/${encodeURIComponent(this.config.feishuBaseToken)}/tables/${encodeURIComponent(this.config.feishuBaseTableId)}/records/${encodeURIComponent(recordId)}`,
      {
        method: "DELETE",
      },
    );

    if (payload.code !== 0) {
      throw new Error(`Delete record failed: ${payload.msg}`);
    }
  }

  async getChatHistory(userId: string, limit: number = 10): Promise<Array<{ role: string; content: string }>> {
    if (!this.config.feishuChatHistoryTableId || !this.config.enableChatMemory) {
      return [];
    }

    try {
      const payload = await this.authedRequest<FeishuApiResponse<{ items?: FeishuBaseRecord[] }>>(
        `/bitable/v1/apps/${encodeURIComponent(this.config.feishuBaseToken)}/tables/${encodeURIComponent(this.config.feishuChatHistoryTableId)}/records?page_size=${limit * 2}&user_id_type=open_id`,
        { method: "GET" },
      );

      if (payload.code !== 0 || !payload.data?.items) {
        return [];
      }

      const history = payload.data.items
        .filter((record) => record.fields["用户ID"] === userId)
        .sort((a, b) => {
          const timeA = Number(a.fields["时间戳"]) || 0;
          const timeB = Number(b.fields["时间戳"]) || 0;
          return timeA - timeB;
        })
        .slice(-limit)
        .map((record) => ({
          role: String(record.fields["角色"] || "user"),
          content: String(record.fields["内容"] || ""),
        }));

      return history;
    } catch (error) {
      console.error("Failed to get chat history:", error);
      return [];
    }
  }

  async saveChatMessage(userId: string, messageId: string, role: string, content: string): Promise<void> {
    if (!this.config.feishuChatHistoryTableId || !this.config.enableChatMemory) {
      return;
    }

    try {
      await this.authedRequest<FeishuApiResponse<{ record?: FeishuBaseRecord }>>(
        `/bitable/v1/apps/${encodeURIComponent(this.config.feishuBaseToken)}/tables/${encodeURIComponent(this.config.feishuChatHistoryTableId)}/records?user_id_type=open_id`,
        {
          method: "POST",
          body: JSON.stringify({
            fields: {
              "用户ID": userId,
              "消息ID": messageId,
              "角色": role,
              "内容": content,
              "时间戳": Date.now(),
            },
          }),
        },
      );
    } catch (error) {
      console.error("Failed to save chat message:", error);
    }
  }
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function extractOpenIds(field: unknown): string[] {
  if (!Array.isArray(field)) return [];
  return field
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      return typeof record.id === "string" ? record.id : typeof record.open_id === "string" ? record.open_id : null;
    })
    .filter((id): id is string => Boolean(id));
}

function formatDateKey(timestamp: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

