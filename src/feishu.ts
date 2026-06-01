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
    const response = await this.fetchImpl(input, init);
    const raw = await response.text();

    if (!response.ok) {
      throw new Error(`Feishu API HTTP ${response.status}${raw ? ": " + raw : ""}`);
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(`Feishu API returned non-JSON payload${raw ? ": " + raw.slice(0, 500) : ""}`);
    }
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
    return this.requestJson<T>(`https://open.feishu.cn/open-apis${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
        ...(init.headers ?? {}),
      },
    });
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
      results.push({ recordId: record.record_id, fields: record.fields });
    }
    return results;
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
      try {
        await this.deleteRecord(recordId);
        return { toast: { type: "success", content: "✅ 已完成" } };
      } catch (error) {
        console.error("Complete task failed", error);
        return { toast: { type: "error", content: "操作失败" } };
      }
    }

    // 延期任务
    if (action === "postpone_task" && recordId) {
      try {
        const currentDue = typeof value?.current_due === "string" ? value.current_due : undefined;
        if (!currentDue) {
          return { toast: { type: "warning", content: "该任务没有截止时间，无法延期" } };
        }

        // 简单延期：在当前日期字符串上加一天
        const date = new Date(currentDue);
        date.setDate(date.getDate() + 1);
        const newDue = date.toISOString().split("T")[0];

        await this.updateRecord(recordId, { "截止日期": newDue });
        return { toast: { type: "info", content: `⏰ 已延期到 ${newDue}` } };
      } catch (error) {
        console.error("Postpone task failed", error);
        return { toast: { type: "error", content: "延期失败" } };
      }
    }

    // 删除任务
    if (action === "delete_task" && recordId) {
      try {
        await this.deleteRecord(recordId);
        return { toast: { type: "info", content: "🗑️ 已删除" } };
      } catch (error) {
        console.error("Delete task failed", error);
        return { toast: { type: "error", content: "删除失败" } };
      }
    }

    return { toast: { type: "warning", content: "未找到待确认内容" } };
  }

  async debugSnapshot(): Promise<{ app: FeishuBaseMeta; tables: FeishuBaseTable[] }> {
    const [app, tables] = await Promise.all([this.getBaseMeta(), this.listTables()]);
    return { app, tables };
  }

  async listRecords(params?: { pageSize?: number; filter?: string }): Promise<FeishuBaseRecord[]> {
    const pageSize = params?.pageSize ?? 100;
    let url = `/bitable/v1/apps/${encodeURIComponent(this.config.feishuBaseToken)}/tables/${encodeURIComponent(this.config.feishuBaseTableId)}/records?page_size=${pageSize}&user_id_type=open_id`;
    
    if (params?.filter) {
      url += `&filter=${encodeURIComponent(params.filter)}`;
    }

    const payload = await this.authedRequest<FeishuApiResponse<{ items?: FeishuBaseRecord[] }>>(url, {
      method: "GET",
    });

    if (payload.code !== 0) {
      throw new Error(`List records failed: ${payload.msg}`);
    }

    return payload.data?.items ?? [];
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


