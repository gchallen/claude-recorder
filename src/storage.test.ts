import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { unlinkSync, existsSync } from "fs";
import type { ParsedMessage } from "./types.js";

// Use in-memory database for tests
const TEST_DB_PATH = "/tmp/claude-recorder-test.db";

// Mock storage functions that use a test database
function createTestDatabase(): Database {
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }

  const db = new Database(TEST_DB_PATH);

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

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      text_content,
      content='messages',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, text_content) VALUES (new.id, new.text_content);
    END;

    CREATE TABLE IF NOT EXISTS file_positions (
      transcript_path TEXT PRIMARY KEY,
      byte_position INTEGER NOT NULL,
      last_updated TEXT NOT NULL
    );
  `);

  return db;
}

describe("storage layer", () => {
  let db: Database;

  beforeAll(() => {
    db = createTestDatabase();
  });

  afterAll(() => {
    db.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  test("inserts and retrieves a session", () => {
    db.run(
      `INSERT INTO sessions (id, slug, project_path, working_dir, start_time, version, transcript_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        "session-1",
        "test-project",
        "/path/to/project",
        "/Users/test/project",
        new Date().toISOString(),
        "2.0.76",
        "/path/to/transcript.jsonl",
      ]
    );

    const session = db
      .query<{ id: string; slug: string }, []>(
        `SELECT id, slug FROM sessions WHERE id = 'session-1'`
      )
      .get();

    expect(session).not.toBeNull();
    expect(session!.id).toBe("session-1");
    expect(session!.slug).toBe("test-project");
  });

  test("inserts and retrieves messages", () => {
    const message: ParsedMessage = {
      uuid: "msg-1",
      sessionId: "session-1",
      timestamp: new Date(),
      role: "user",
      textContent: "Hello, Claude!",
      thinkingContent: null,
      toolCalls: [],
      model: null,
      cwd: "/Users/test/project",
    };

    db.run(
      `INSERT INTO messages (uuid, session_id, timestamp, role, text_content, thinking_content, model, cwd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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

    const retrieved = db
      .query<{ uuid: string; text_content: string }, [string]>(
        `SELECT uuid, text_content FROM messages WHERE uuid = ?`
      )
      .get("msg-1");

    expect(retrieved).not.toBeNull();
    expect(retrieved!.text_content).toBe("Hello, Claude!");
  });

  test("inserts tool calls", () => {
    db.run(
      `INSERT INTO tool_calls (tool_id, message_uuid, session_id, name, input, output)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["tool-1", "msg-1", "session-1", "Bash", '{"command": "ls"}', "file1.txt"]
    );

    const toolCall = db
      .query<{ name: string; output: string }, [string]>(
        `SELECT name, output FROM tool_calls WHERE tool_id = ?`
      )
      .get("tool-1");

    expect(toolCall).not.toBeNull();
    expect(toolCall!.name).toBe("Bash");
    expect(toolCall!.output).toBe("file1.txt");
  });

  test("full-text search works", () => {
    // Insert another message for search
    db.run(
      `INSERT INTO messages (uuid, session_id, timestamp, role, text_content, cwd)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        "msg-2",
        "session-1",
        new Date().toISOString(),
        "assistant",
        "The quick brown fox jumps over the lazy dog",
        "/test",
      ]
    );

    const results = db
      .query<{ uuid: string; text_content: string }, [string]>(
        `SELECT m.uuid, m.text_content
         FROM messages_fts
         JOIN messages m ON messages_fts.rowid = m.id
         WHERE messages_fts MATCH ?`
      )
      .all("fox");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text_content).toContain("fox");
  });

  test("file position tracking", () => {
    const path = "/test/transcript.jsonl";

    db.run(
      `INSERT INTO file_positions (transcript_path, byte_position, last_updated)
       VALUES (?, ?, ?)`,
      [path, 1000, new Date().toISOString()]
    );

    const pos = db
      .query<{ byte_position: number }, [string]>(
        `SELECT byte_position FROM file_positions WHERE transcript_path = ?`
      )
      .get(path);

    expect(pos).not.toBeNull();
    expect(pos!.byte_position).toBe(1000);

    // Update position
    db.run(
      `UPDATE file_positions SET byte_position = ?, last_updated = ? WHERE transcript_path = ?`,
      [2000, new Date().toISOString(), path]
    );

    const updated = db
      .query<{ byte_position: number }, [string]>(
        `SELECT byte_position FROM file_positions WHERE transcript_path = ?`
      )
      .get(path);

    expect(updated!.byte_position).toBe(2000);
  });

  test("session message count updates", () => {
    // Add more messages
    for (let i = 3; i <= 5; i++) {
      db.run(
        `INSERT INTO messages (uuid, session_id, timestamp, role, text_content, cwd)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          `msg-${i}`,
          "session-1",
          new Date().toISOString(),
          i % 2 === 0 ? "user" : "assistant",
          `Message ${i}`,
          "/test",
        ]
      );
    }

    // Update count
    db.run(
      `UPDATE sessions SET message_count = (SELECT COUNT(*) FROM messages WHERE session_id = ?) WHERE id = ?`,
      ["session-1", "session-1"]
    );

    const session = db
      .query<{ message_count: number }, [string]>(
        `SELECT message_count FROM sessions WHERE id = ?`
      )
      .get("session-1");

    expect(session!.message_count).toBe(5);
  });

  test("handles duplicate message insertion with OR IGNORE", () => {
    const countBefore = db
      .query<{ count: number }, []>(`SELECT COUNT(*) as count FROM messages`)
      .get();

    // Try to insert duplicate
    db.run(
      `INSERT OR IGNORE INTO messages (uuid, session_id, timestamp, role, text_content, cwd)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["msg-1", "session-1", new Date().toISOString(), "user", "Duplicate", "/test"]
    );

    const countAfter = db
      .query<{ count: number }, []>(`SELECT COUNT(*) as count FROM messages`)
      .get();

    expect(countAfter!.count).toBe(countBefore!.count);
  });

  test("queries messages by session ordered by timestamp", () => {
    const messages = db
      .query<{ uuid: string; timestamp: string }, [string]>(
        `SELECT uuid, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp ASC`
      )
      .all("session-1");

    expect(messages.length).toBe(5);

    // Verify ordering
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i].timestamp >= messages[i - 1].timestamp).toBe(true);
    }
  });

  test("session end time updates", () => {
    const endTime = new Date();

    db.run(`UPDATE sessions SET end_time = ? WHERE id = ?`, [
      endTime.toISOString(),
      "session-1",
    ]);

    const session = db
      .query<{ end_time: string }, [string]>(
        `SELECT end_time FROM sessions WHERE id = ?`
      )
      .get("session-1");

    expect(session!.end_time).toBe(endTime.toISOString());
  });
});

describe("edge cases", () => {
  let db: Database;

  beforeAll(() => {
    db = createTestDatabase();
  });

  afterAll(() => {
    db.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  test("handles very long message content", () => {
    const longContent = "A".repeat(100000); // 100KB of text

    db.run(
      `INSERT INTO sessions (id, slug, project_path, working_dir, start_time, version)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["session-long", "test", "/test", "/test", new Date().toISOString(), "1.0"]
    );

    db.run(
      `INSERT INTO messages (uuid, session_id, timestamp, role, text_content, cwd)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["msg-long", "session-long", new Date().toISOString(), "user", longContent, "/test"]
    );

    const msg = db
      .query<{ text_content: string }, [string]>(
        `SELECT text_content FROM messages WHERE uuid = ?`
      )
      .get("msg-long");

    expect(msg!.text_content.length).toBe(100000);
  });

  test("handles special characters in content", () => {
    const specialContent = "Line1\nLine2\tTabbed\r\nWindows\0Null";

    db.run(
      `INSERT INTO messages (uuid, session_id, timestamp, role, text_content, cwd)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        "msg-special",
        "session-long",
        new Date().toISOString(),
        "user",
        specialContent,
        "/test",
      ]
    );

    const msg = db
      .query<{ text_content: string }, [string]>(
        `SELECT text_content FROM messages WHERE uuid = ?`
      )
      .get("msg-special");

    expect(msg!.text_content).toBe(specialContent);
  });

  test("handles empty content", () => {
    db.run(
      `INSERT INTO messages (uuid, session_id, timestamp, role, text_content, cwd)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["msg-empty", "session-long", new Date().toISOString(), "user", "", "/test"]
    );

    const msg = db
      .query<{ text_content: string }, [string]>(
        `SELECT text_content FROM messages WHERE uuid = ?`
      )
      .get("msg-empty");

    expect(msg!.text_content).toBe("");
  });

  test("handles JSON in tool input/output", () => {
    const complexJson = JSON.stringify({
      nested: { deeply: { value: [1, 2, 3] } },
      special: "quotes\"and'stuff",
    });

    db.run(
      `INSERT INTO tool_calls (tool_id, message_uuid, session_id, name, input, output)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["tool-json", "msg-empty", "session-long", "Read", complexJson, complexJson]
    );

    const tool = db
      .query<{ input: string; output: string }, [string]>(
        `SELECT input, output FROM tool_calls WHERE tool_id = ?`
      )
      .get("tool-json");

    expect(JSON.parse(tool!.input)).toEqual(JSON.parse(complexJson));
  });
});
