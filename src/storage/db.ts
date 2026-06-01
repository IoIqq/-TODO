/**
 * SQLite 数据库管理
 * 存储对话历史、AI 记忆、Agent 思考轨迹、操作日志
 */
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

let db: Database.Database | null = null;

/**
 * 初始化数据库
 */
export function initDatabase(dataDir: string = "./data"): Database.Database {
  if (db) return db;

  // 确保数据目录存在
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`[storage] Created data directory: ${dataDir}`);
  }

  const dbPath = path.join(dataDir, "feishu-bot.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  console.log(`[storage] Database initialized: ${dbPath}`);

  // 创建表
  createTables(db);

  return db;
}

/**
 * 获取数据库实例
 */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

/**
 * 关闭数据库
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log("[storage] Database closed");
  }
}

/**
 * 创建所有表
 */
function createTables(database: Database.Database): void {
  // 对话历史表
  database.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      message_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_conv_user_time ON conversations(user_id, timestamp DESC);
  `);

  // AI 长期记忆表（用户偏好/重要信息）
  database.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      importance INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_mem_user ON memories(user_id);
    CREATE INDEX IF NOT EXISTS idx_mem_category ON memories(user_id, category);
  `);

  // Agent 思考轨迹（debug + 历史回放）
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      step INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      tool_name TEXT,
      input TEXT,
      output TEXT,
      error TEXT,
      duration_ms INTEGER,
      timestamp INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_log_session ON agent_logs(session_id, step);
    CREATE INDEX IF NOT EXISTS idx_log_user_time ON agent_logs(user_id, timestamp DESC);
  `);

  // 操作日志（业务操作）
  database.exec(`
    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      op_type TEXT NOT NULL,
      description TEXT NOT NULL,
      params TEXT,
      result TEXT,
      success INTEGER DEFAULT 1,
      timestamp INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_op_user_time ON operations(user_id, timestamp DESC);
  `);

  console.log("[storage] All tables created/verified");
}
