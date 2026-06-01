/**
 * Agent 思考轨迹存储
 * 记录每次 Agent 执行的工具调用过程
 */
import { getDb } from "./db.js";

export interface AgentLogRecord {
  id?: number;
  userId: string;
  sessionId: string;
  step: number;
  actionType: "thought" | "tool_call" | "tool_result" | "final_answer" | "error";
  toolName?: string;
  input?: string;
  output?: string;
  error?: string;
  durationMs?: number;
  timestamp: number;
}

export class AgentLogStore {
  /**
   * 记录一步 Agent 行为
   */
  static log(record: Omit<AgentLogRecord, "id">): number {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO agent_logs (user_id, session_id, step, action_type, tool_name, input, output, error, duration_ms, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      record.userId,
      record.sessionId,
      record.step,
      record.actionType,
      record.toolName ?? null,
      record.input ?? null,
      record.output ?? null,
      record.error ?? null,
      record.durationMs ?? null,
      record.timestamp,
    );
    return result.lastInsertRowid as number;
  }

  /**
   * 获取一个会话的完整日志
   */
  static getSession(sessionId: string): AgentLogRecord[] {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT id, user_id as userId, session_id as sessionId, step, action_type as actionType,
             tool_name as toolName, input, output, error, duration_ms as durationMs, timestamp
      FROM agent_logs
      WHERE session_id = ?
      ORDER BY step ASC
    `);
    return stmt.all(sessionId) as AgentLogRecord[];
  }

  /**
   * 获取用户最近的会话列表
   */
  static getRecentSessions(userId: string, limit: number = 10): Array<{ sessionId: string; startTime: number; steps: number }> {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT session_id as sessionId, MIN(timestamp) as startTime, COUNT(*) as steps
      FROM agent_logs
      WHERE user_id = ?
      GROUP BY session_id
      ORDER BY startTime DESC
      LIMIT ?
    `);
    return stmt.all(userId, limit) as Array<{ sessionId: string; startTime: number; steps: number }>;
  }

  /**
   * 删除超过 N 天的旧日志
   */
  static deleteOlderThan(days: number): number {
    const db = getDb();
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const result = db.prepare(`DELETE FROM agent_logs WHERE timestamp < ?`).run(cutoff);
    return result.changes;
  }
}
