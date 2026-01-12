import { Database } from "bun:sqlite";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import type { ParsedMessage, Session } from "./types.js";

const DATA_DIR = join(homedir(), ".claude-recorder");
const DB_PATH = join(DATA_DIR, "recorder.db");

let db: Database | null = null;

export function getDatabase(): Database {
  if (db) return db;

  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrency (allows reads while writing)
  db.exec("PRAGMA journal_mode = WAL");
  // Set busy timeout to wait up to 5 seconds if database is locked
  db.exec("PRAGMA busy_timeout = 5000");

  initializeSchema(db);
  return db;
}

function initializeSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      project_path TEXT NOT NULL,
      working_dir TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      message_count INTEGER DEFAULT 0,
      version TEXT,
      transcript_path TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      role TEXT NOT NULL,
      text_content TEXT NOT NULL,
      thinking_content TEXT,
      model TEXT,
      cwd TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_id TEXT NOT NULL,
      message_uuid TEXT NOT NULL,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT,
      FOREIGN KEY (message_uuid) REFERENCES messages(uuid),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(name);

    -- Full-text search for messages
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      text_content,
      content='messages',
      content_rowid='id'
    );

    -- Triggers to keep FTS in sync
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, text_content) VALUES (new.id, new.text_content);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, text_content) VALUES('delete', old.id, old.text_content);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, text_content) VALUES('delete', old.id, old.text_content);
      INSERT INTO messages_fts(rowid, text_content) VALUES (new.id, new.text_content);
    END;

    -- Track file positions for incremental parsing
    CREATE TABLE IF NOT EXISTS file_positions (
      transcript_path TEXT PRIMARY KEY,
      byte_position INTEGER NOT NULL,
      last_updated TEXT NOT NULL
    );
  `);
}

export function upsertSession(
  sessionId: string,
  slug: string,
  projectPath: string,
  workingDir: string,
  startTime: Date,
  version: string,
  transcriptPath: string
): void {
  const db = getDatabase();
  db.run(
    `
    INSERT INTO sessions (id, slug, project_path, working_dir, start_time, version, transcript_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug,
      project_path = excluded.project_path,
      working_dir = excluded.working_dir,
      version = excluded.version,
      transcript_path = excluded.transcript_path
  `,
    [
      sessionId,
      slug,
      projectPath,
      workingDir,
      startTime.toISOString(),
      version,
      transcriptPath,
    ]
  );
}

export function endSession(sessionId: string, endTime: Date): void {
  const db = getDatabase();
  db.run(
    `UPDATE sessions SET end_time = ? WHERE id = ?`,
    [endTime.toISOString(), sessionId]
  );
}

export function insertMessage(message: ParsedMessage): void {
  const db = getDatabase();

  // Insert message (ignore if already exists)
  const result = db.run(
    `
    INSERT OR IGNORE INTO messages (uuid, session_id, timestamp, role, text_content, thinking_content, model, cwd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      message.uuid,
      message.sessionId,
      message.timestamp.toISOString(),
      message.role,
      message.textContent,
      message.thinkingContent,
      message.model,
      message.cwd,
    ]
  );

  // Insert tool calls
  for (const tool of message.toolCalls) {
    db.run(
      `
      INSERT OR IGNORE INTO tool_calls (tool_id, message_uuid, session_id, name, input, output)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      [
        tool.id,
        message.uuid,
        message.sessionId,
        tool.name,
        tool.input,
        tool.output,
      ]
    );
  }

  // Update session message count
  db.run(
    `UPDATE sessions SET message_count = (SELECT COUNT(*) FROM messages WHERE session_id = ?) WHERE id = ?`,
    [message.sessionId, message.sessionId]
  );
}

export function getFilePosition(transcriptPath: string): number {
  const db = getDatabase();
  const row = db
    .query<{ byte_position: number }, [string]>(
      `SELECT byte_position FROM file_positions WHERE transcript_path = ?`
    )
    .get(transcriptPath);
  return row?.byte_position ?? 0;
}

export function setFilePosition(
  transcriptPath: string,
  position: number
): void {
  const db = getDatabase();
  db.run(
    `
    INSERT INTO file_positions (transcript_path, byte_position, last_updated)
    VALUES (?, ?, ?)
    ON CONFLICT(transcript_path) DO UPDATE SET
      byte_position = excluded.byte_position,
      last_updated = excluded.last_updated
  `,
    [transcriptPath, position, new Date().toISOString()]
  );
}

export function listSessions(limit = 20): Session[] {
  const db = getDatabase();
  const rows = db
    .query<
      {
        id: string;
        slug: string;
        project_path: string;
        working_dir: string;
        start_time: string;
        end_time: string | null;
        message_count: number;
        version: string;
      },
      [number]
    >(
      `
    SELECT id, slug, project_path, working_dir, start_time, end_time, message_count, version
    FROM sessions
    ORDER BY start_time DESC
    LIMIT ?
  `
    )
    .all(limit);

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    projectPath: row.project_path,
    workingDir: row.working_dir,
    startTime: new Date(row.start_time),
    endTime: row.end_time ? new Date(row.end_time) : null,
    messageCount: row.message_count,
    version: row.version,
  }));
}

export function listRecentlyActiveSessions(limit = 10): Session[] {
  const db = getDatabase();
  const rows = db
    .query<
      {
        id: string;
        slug: string;
        project_path: string;
        working_dir: string;
        start_time: string;
        end_time: string | null;
        message_count: number;
        version: string;
        last_activity: string;
      },
      [number]
    >(
      `
    SELECT
      s.id, s.slug, s.project_path, s.working_dir, s.start_time, s.end_time,
      s.message_count, s.version,
      MAX(m.timestamp) as last_activity
    FROM sessions s
    LEFT JOIN messages m ON s.id = m.session_id
    GROUP BY s.id
    ORDER BY last_activity DESC
    LIMIT ?
  `
    )
    .all(limit);

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    projectPath: row.project_path,
    workingDir: row.working_dir,
    startTime: new Date(row.start_time),
    endTime: row.end_time ? new Date(row.end_time) : null,
    messageCount: row.message_count,
    version: row.version,
    lastActivity: row.last_activity ? new Date(row.last_activity) : undefined,
  }));
}

export function getSession(sessionId: string): Session | null {
  const db = getDatabase();
  const row = db
    .query<
      {
        id: string;
        slug: string;
        project_path: string;
        working_dir: string;
        start_time: string;
        end_time: string | null;
        message_count: number;
        version: string;
      },
      [string]
    >(`SELECT * FROM sessions WHERE id = ?`)
    .get(sessionId);

  if (!row) return null;

  return {
    id: row.id,
    slug: row.slug,
    projectPath: row.project_path,
    workingDir: row.working_dir,
    startTime: new Date(row.start_time),
    endTime: row.end_time ? new Date(row.end_time) : null,
    messageCount: row.message_count,
    version: row.version,
  };
}

export function getSessionMessages(sessionId: string): ParsedMessage[] {
  const db = getDatabase();
  const messages = db
    .query<
      {
        uuid: string;
        session_id: string;
        timestamp: string;
        role: string;
        text_content: string;
        thinking_content: string | null;
        model: string | null;
        cwd: string;
      },
      [string]
    >(
      `
    SELECT uuid, session_id, timestamp, role, text_content, thinking_content, model, cwd
    FROM messages
    WHERE session_id = ?
    ORDER BY timestamp ASC
  `
    )
    .all(sessionId);

  return messages.map((msg) => {
    const toolCalls = db
      .query<
        {
          tool_id: string;
          name: string;
          input: string;
          output: string | null;
        },
        [string]
      >(
        `SELECT tool_id, name, input, output FROM tool_calls WHERE message_uuid = ?`
      )
      .all(msg.uuid);

    return {
      uuid: msg.uuid,
      sessionId: msg.session_id,
      timestamp: new Date(msg.timestamp),
      role: msg.role as "user" | "assistant",
      textContent: msg.text_content,
      thinkingContent: msg.thinking_content,
      toolCalls: toolCalls.map((tc) => ({
        id: tc.tool_id,
        name: tc.name,
        input: tc.input,
        output: tc.output,
      })),
      model: msg.model,
      cwd: msg.cwd,
    };
  });
}

export function searchMessages(
  query: string,
  limit = 50
): Array<{ sessionId: string; message: ParsedMessage; snippet: string }> {
  const db = getDatabase();
  const results = db
    .query<
      {
        uuid: string;
        session_id: string;
        timestamp: string;
        role: string;
        text_content: string;
        thinking_content: string | null;
        model: string | null;
        cwd: string;
        snippet: string;
      },
      [string, number]
    >(
      `
    SELECT m.uuid, m.session_id, m.timestamp, m.role, m.text_content, m.thinking_content, m.model, m.cwd,
           snippet(messages_fts, 0, '>>>', '<<<', '...', 64) as snippet
    FROM messages_fts
    JOIN messages m ON messages_fts.rowid = m.id
    WHERE messages_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `
    )
    .all(query, limit);

  return results.map((r) => ({
    sessionId: r.session_id,
    message: {
      uuid: r.uuid,
      sessionId: r.session_id,
      timestamp: new Date(r.timestamp),
      role: r.role as "user" | "assistant",
      textContent: r.text_content,
      thinkingContent: r.thinking_content,
      toolCalls: [],
      model: r.model,
      cwd: r.cwd,
    },
    snippet: r.snippet,
  }));
}

export function getStats(): {
  totalSessions: number;
  totalMessages: number;
  totalToolCalls: number;
  toolUsage: Array<{ name: string; count: number }>;
} {
  const db = getDatabase();

  const sessionCount = db
    .query<{ count: number }, []>(`SELECT COUNT(*) as count FROM sessions`)
    .get();
  const messageCount = db
    .query<{ count: number }, []>(`SELECT COUNT(*) as count FROM messages`)
    .get();
  const toolCallCount = db
    .query<{ count: number }, []>(`SELECT COUNT(*) as count FROM tool_calls`)
    .get();
  const toolUsage = db
    .query<{ name: string; count: number }, []>(
      `SELECT name, COUNT(*) as count FROM tool_calls GROUP BY name ORDER BY count DESC LIMIT 20`
    )
    .all();

  return {
    totalSessions: sessionCount?.count ?? 0,
    totalMessages: messageCount?.count ?? 0,
    totalToolCalls: toolCallCount?.count ?? 0,
    toolUsage,
  };
}
