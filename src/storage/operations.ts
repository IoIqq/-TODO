/**
 * 业务操作日志存储
 */
import { getDb } from "./db.js";

export interface OperationRecord {
  id?: number;
  userId: string;
  opType: string;
  description: string;
  params?: string;
  result?: string;
  success: boolean;
  timestamp: number;
}

export class OperationStore {
  static save(record: Omit<OperationRecord, "id">): number {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO operations (user_id, op_type, description, params, result, success, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      record.userId,
      record.opType,
      record.description,
      record.params ?? null,
      record.result ?? null,
      record.success ? 1 : 0,
      record.timestamp,
    );
    return result.lastInsertRowid as number;
  }

  static getRecent(userId: string, limit: number = 10): OperationRecord[] {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT id, user_id as userId, op_type as opType, description, params, result, 
             success as successRaw, timestamp
      FROM operations
      WHERE user_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    type RawRow = {
      id: number;
      userId: string;
      opType: string;
      description: string;
      params: string | null;
      result: string | null;
      successRaw: number;
      timestamp: number;
    };
    const rows = stmt.all(userId, limit) as RawRow[];
    return rows.map(r => {
      const rec: OperationRecord = {
        id: r.id,
        userId: r.userId,
        opType: r.opType,
        description: r.description,
        success: Boolean(r.successRaw),
        timestamp: r.timestamp,
      };
      if (r.params !== null) rec.params = r.params;
      if (r.result !== null) rec.result = r.result;
      return rec;
    });
  }
}
