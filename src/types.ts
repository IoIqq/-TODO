export type TaskPriority = "high" | "medium" | "low";

export interface ParsedDue {
  timestamp: string;
  is_all_day: boolean;
}

export interface ParsedTask {
  title: string;
  due?: ParsedDue;
  priority: TaskPriority;
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

export interface TaskDue {
  timestamp: string;
  is_all_day: boolean;
}

export interface TaskMember {
  id: string;
  type: "user" | "app" | "chat";
  role: "assignee" | "follower";
  name?: string;
}

export interface TaskListRef {
  guid: string;
}

export interface FeishuTask {
  guid: string;
  summary: string;
  description?: string;
  due?: TaskDue;
  completed_at?: string;
}

export interface FeishuTaskListItem extends FeishuTask {
  created_at?: string;
  updated_at?: string;
}

export interface FeishuApiResponse<T> {
  code: number;
  msg: string;
  data?: T;
}
