/**
 * AI 长期记忆存储
 * 用于保存用户偏好、重要信息等，让 AI 跨会话记得用户
 */
import { getDb } from "./db.js";

export interface MemoryRecord {
  id?: number;
  userId: string;
  key: string;
  value: string;
  category?: string;
  importance?: number;
  createdAt?: string;
  updatedAt?: string;
}

export class MemoryStore {
  /**
   * 保存或更新记忆（upsert）
   */
  static save(record: MemoryRecord): void {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO memories (user_id, key, value, category, importance, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, key) DO UPDATE SET
        value = excluded.value,
        category = excluded.category,
        importance = excluded.importance,
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(
      record.userId,
      record.key,
      record.value,
      record.category || "general",
      record.importance || 1,
    );
  }

  /**
   * 根据 key 获取记忆
   */
  static get(userId: string, key: string): MemoryRecord | undefined {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT id, user_id as userId, key, value, category, importance,
             created_at as createdAt, updated_at as updatedAt
      FROM memories
      WHERE user_id = ? AND key = ?
    `);
    return stmt.get(userId, key) as MemoryRecord | undefined;
  }

  /**
   * 列出用户的所有记忆
   */
  static list(userId: string, category?: string): MemoryRecord[] {
    const db = getDb();
    if (category) {
      const stmt = db.prepare(`
        SELECT id, user_id as userId, key, value, category, importance,
               created_at as createdAt, updated_at as updatedAt
        FROM memories
        WHERE user_id = ? AND category = ?
        ORDER BY importance DESC, updated_at DESC
      `);
      return stmt.all(userId, category) as MemoryRecord[];
    }
    const stmt = db.prepare(`
      SELECT id, user_id as userId, key, value, category, importance,
             created_at as createdAt, updated_at as updatedAt
      FROM memories
      WHERE user_id = ?
      ORDER BY importance DESC, updated_at DESC
    `);
    return stmt.all(userId) as MemoryRecord[];
  }

  /**
   * 模糊搜索记忆（关键词匹配）
   */
  static search(userId: string, keyword: string, limit: number = 5): MemoryRecord[] {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT id, user_id as userId, key, value, category, importance,
             created_at as createdAt, updated_at as updatedAt
      FROM memories
      WHERE user_id = ? AND (key LIKE ? OR value LIKE ?)
      ORDER BY importance DESC, updated_at DESC
      LIMIT ?
    `);
    const pattern = `%${keyword}%`;
    return stmt.all(userId, pattern, pattern, limit) as MemoryRecord[];
  }

  /**
   * 删除记忆
   */
  static delete(userId: string, key: string): boolean {
    const db = getDb();
    const result = db.prepare(`DELETE FROM memories WHERE user_id = ? AND key = ?`).run(userId, key);
    return result.changes > 0;
  }

  /**
   * 清除用户所有记忆
   */
  static clearAll(userId: string): number {
    const db = getDb();
    const result = db.prepare(`DELETE FROM memories WHERE user_id = ?`).run(userId);
    return result.changes;
  }

  /**
   * 格式化记忆为字符串（用于注入 prompt）
   */
  static formatForPrompt(userId: string, limit: number = 10): string {
    const memories = this.list(userId).slice(0, limit);
    if (memories.length === 0) return "";
    
    const lines = memories.map(m => `- [${m.category}] ${m.key}: ${m.value}`);
    return `用户的长期记忆（重要信息）：\n${lines.join("\n")}`;
  }
}
