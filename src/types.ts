export type TaskPriority = "high" | "medium" | "low";

export interface ParsedDue {
  timestamp: string;
  is_all_day: boolean;
}

export interface TodoDraft {
  title: string;
  due?: ParsedDue;
  start?: ParsedDue;
  priority: TaskPriority;
  risk?: "high" | "medium" | "low";
  assigneeOpenId?: string;
  notes?: string;
  fallbackUsed: boolean;
}

export interface FeishuEventEnvelope<TEvent> {
  schema?: string;
  header: {
    event_id: string;
    event_type: string;
    token?: string;
    create_time?: string;
    app_id?: string;
    tenant_key?: string;
  };
  event: TEvent;
  challenge?: string;
  encrypt?: string;
  type?: string;
  token?: string;
}

export interface FeishuMessageReceiveEvent {
  sender?: {
    sender_id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type?: string;
  };
  message?: {
    message_id: string;
    chat_id?: string;
    chat_type?: "p2p" | "group";
    message_type: string;
    content?: string;
  };
}

export interface FeishuCardActionEvent {
  operator?: {
    open_id?: string;
    user_id?: string;
  };
  open_message_id?: string;
  action?: {
    value?: Record<string, unknown>;
  };
}

export interface FeishuApiResponse<T> {
  code: number;
  msg: string;
  data?: T;
}

export interface FeishuBaseField {
  id: string;
  name: string;
  type: string;
}

export interface FeishuBaseView {
  id: string;
  name: string;
  type: string;
}

export interface FeishuBaseTable {
  id: string;
  name: string;
  default_view_id?: string;
}

export interface FeishuBaseMeta {
  app: {
    token: string;
    name?: string;
  };
  table: {
    id: string;
    name: string;
  };
  fields: FeishuBaseField[];
  views?: FeishuBaseView[];
  table_list?: FeishuBaseTable[];
}

export interface FeishuBaseRecord {
  record_id: string;
  fields: Record<string, unknown>;
}

export interface TodoRecordCreateResult {
  recordId: string;
  fields: Record<string, unknown>;
}
