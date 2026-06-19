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

  // 事件去重表（防止飞书重试导致重复执行）
  database.exec(`
    CREATE TABLE IF NOT EXISTS event_dedup (
      event_id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dedup_time ON event_dedup(created_at);
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

  // 截止时间提醒表（创建待办时预排提醒，到点后由 scheduler 推送）
  database.exec(`
    CREATE TABLE IF NOT EXISTS deadline_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT NOT NULL,
      assignee_open_id TEXT NOT NULL,
      title TEXT NOT NULL,
      priority TEXT NOT NULL,
      due_timestamp INTEGER,
      start_timestamp INTEGER,
      alert_time INTEGER NOT NULL,
      kind TEXT NOT NULL,
      sequence INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      reminded_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  migrateDeadlineReminderSchema(database);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_deadline_reminders_due ON deadline_reminders(status, alert_time);
    CREATE INDEX IF NOT EXISTS idx_deadline_reminders_record ON deadline_reminders(record_id);
    CREATE INDEX IF NOT EXISTS idx_deadline_reminders_processing ON deadline_reminders(status, updated_at);
  `);

  console.log("[storage] All tables created/verified");
}

function migrateDeadlineReminderSchema(database: Database.Database): void {
  const columns = database.prepare("PRAGMA table_info(deadline_reminders)").all() as Array<{ name?: string; notnull?: number }>;
  const needsStartTimestamp = !columns.some((column) => column.name === "start_timestamp");
  const dueColumn = columns.find((column) => column.name === "due_timestamp");
  const needsNullableDue = Number(dueColumn?.notnull ?? 0) === 1;
  const indexes = database.prepare("PRAGMA index_list(deadline_reminders)").all() as Array<{ unique?: number }>;
  const needsUniqueIndexMigration = indexes.some((index) => Number(index.unique) === 1);

  if (!needsStartTimestamp && !needsNullableDue && !needsUniqueIndexMigration) return;

  const selectStartTimestamp = needsStartTimestamp ? "NULL AS start_timestamp" : "start_timestamp";

  database.exec(`
    ALTER TABLE deadline_reminders RENAME TO deadline_reminders_old;
    CREATE TABLE deadline_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT NOT NULL,
      assignee_open_id TEXT NOT NULL,
      title TEXT NOT NULL,
      priority TEXT NOT NULL,
      due_timestamp INTEGER,
      start_timestamp INTEGER,
      alert_time INTEGER NOT NULL,
      kind TEXT NOT NULL,
      sequence INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      reminded_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO deadline_reminders (
      id,
      record_id,
      assignee_open_id,
      title,
      priority,
      due_timestamp,
      start_timestamp,
      alert_time,
      kind,
      sequence,
      status,
      reminded_at,
      created_at,
      updated_at
    )
    SELECT
      id,
      record_id,
      assignee_open_id,
      title,
      priority,
      due_timestamp,
      ${selectStartTimestamp},
      alert_time,
      kind,
      sequence,
      status,
      reminded_at,
      created_at,
      updated_at
    FROM deadline_reminders_old;
    DROP TABLE deadline_reminders_old;
  `);
}

/**
 * 事件去重：检查事件是否已处理过
 * 先查 SQLite（持久化），再查内存 Set
 */
export function isDuplicateEvent(eventId: string, memSet: Set<string>): boolean {
  if (memSet.has(eventId)) return true;
  if (!db) return false; // DB not initialized, rely on memory only
  const row = db.prepare("SELECT 1 FROM event_dedup WHERE event_id = ?").get(eventId);
  return row !== undefined;
}

/**
 * 事件去重：记录事件 ID（持久化 + 内存）
 * 定期清理超过 1 小时的旧记录
 */
let lastCleanup = 0;
export function rememberEvent(eventId: string, memSet: Set<string>): void {
  memSet.add(eventId);
  if (!db) return; // DB not initialized, rely on memory only

  db.prepare("INSERT OR IGNORE INTO event_dedup (event_id, created_at) VALUES (?, ?)").run(eventId, Date.now());

  // 每 5 分钟清理一次超过 1 小时的旧事件
  const now = Date.now();
  if (now - lastCleanup > 300_000) {
    lastCleanup = now;
    const cutoff = now - 3_600_000;
    db.prepare("DELETE FROM event_dedup WHERE created_at < ?").run(cutoff);
  }
}
