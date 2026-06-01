/**
 * 对话历史存储
 */
import { getDb } from "./db.js";

export interface ConversationRecord {
  id?: number;
  userId: string;
  messageId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export class ConversationStore {
  /**
   * 保存一条对话
   */
  static save(record: ConversationRecord): number {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO conversations (user_id, message_id, role, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      record.userId,
      record.messageId ?? null,
      record.role,
      record.content,
      record.timestamp,
    );
    return result.lastInsertRowid as number;
  }

  /**
   * 获取用户的最近对话
   */
  static getRecent(userId: string, limit: number = 10): ConversationRecord[] {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT id, user_id as userId, message_id as messageId, role, content, timestamp
      FROM conversations
      WHERE user_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(userId, limit) as ConversationRecord[];
    // 按时间正序返回（聊天历史是早期在前）
    return rows.reverse();
  }

  /**
   * 清除用户的对话历史
   */
  static clear(userId: string): number {
    const db = getDb();
    const result = db.prepare(`DELETE FROM conversations WHERE user_id = ?`).run(userId);
    return result.changes;
  }

  /**
   * 删除超过 N 天的旧对话（清理）
   */
  static deleteOlderThan(days: number): number {
    const db = getDb();
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const result = db.prepare(`DELETE FROM conversations WHERE timestamp < ?`).run(cutoff);
    return result.changes;
  }

  /**
   * 获取统计信息
   */
  static getStats(userId: string): { total: number; userMessages: number; assistantMessages: number } {
    const db = getDb();
    const total = (db.prepare(`SELECT COUNT(*) as c FROM conversations WHERE user_id = ?`).get(userId) as { c: number }).c;
    const user = (db.prepare(`SELECT COUNT(*) as c FROM conversations WHERE user_id = ? AND role = 'user'`).get(userId) as { c: number }).c;
    const assistant = (db.prepare(`SELECT COUNT(*) as c FROM conversations WHERE user_id = ? AND role = 'assistant'`).get(userId) as { c: number }).c;
    return { total, userMessages: user, assistantMessages: assistant };
  }
}
