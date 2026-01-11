import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  rmdirSync,
} from "fs";
import { join } from "path";
import { parseTranscriptFile } from "./parser.js";

const TEST_DIR = "/tmp/claude-recorder-integration-test";

function makeTranscriptEntry(
  uuid: string,
  type: "user" | "assistant",
  content: string | object[],
  extras: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    type,
    uuid,
    sessionId: "integration-test-session",
    timestamp: new Date().toISOString(),
    cwd: "/Users/test/project",
    version: "2.0.76",
    gitBranch: "main",
    slug: "integration-test",
    message: {
      role: type,
      content,
      ...(type === "assistant" ? { model: "claude-opus-4-5-20251101" } : {}),
    },
    ...extras,
  });
}

describe("transcript file parsing", () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(TEST_DIR)) {
      const files = require("fs").readdirSync(TEST_DIR);
      for (const file of files) {
        unlinkSync(join(TEST_DIR, file));
      }
      rmdirSync(TEST_DIR);
    }
  });

  test("parses a complete transcript file", () => {
    const transcriptPath = join(TEST_DIR, "complete.jsonl");

    const lines = [
      makeTranscriptEntry("uuid-1", "user", "What is 2+2?"),
      makeTranscriptEntry("uuid-2", "assistant", [
        { type: "thinking", thinking: "Simple arithmetic..." },
        { type: "text", text: "2+2 equals 4." },
      ]),
      makeTranscriptEntry("uuid-3", "user", "Thanks!"),
      makeTranscriptEntry("uuid-4", "assistant", [
        { type: "text", text: "You're welcome!" },
      ]),
    ];

    writeFileSync(transcriptPath, lines.join("\n") + "\n");

    const messages = parseTranscriptFile(transcriptPath);

    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe("user");
    expect(messages[0].textContent).toBe("What is 2+2?");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].thinkingContent).toBe("Simple arithmetic...");
    expect(messages[1].textContent).toBe("2+2 equals 4.");
  });

  test("parses transcript with tool calls", () => {
    const transcriptPath = join(TEST_DIR, "tools.jsonl");

    const lines = [
      makeTranscriptEntry("uuid-1", "user", "List the files"),
      makeTranscriptEntry("uuid-2", "assistant", [
        { type: "text", text: "Let me check." },
        { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "ls" } },
        { type: "tool_result", tool_use_id: "tool-1", content: "file1.txt\nfile2.txt" },
        { type: "text", text: "I found 2 files." },
      ]),
    ];

    writeFileSync(transcriptPath, lines.join("\n") + "\n");

    const messages = parseTranscriptFile(transcriptPath);

    expect(messages).toHaveLength(2);
    expect(messages[1].toolCalls).toHaveLength(1);
    expect(messages[1].toolCalls[0].name).toBe("Bash");
    expect(messages[1].toolCalls[0].output).toBe("file1.txt\nfile2.txt");
    expect(messages[1].textContent).toContain("Let me check.");
    expect(messages[1].textContent).toContain("I found 2 files.");
  });

  test("handles file-history-snapshot entries", () => {
    const transcriptPath = join(TEST_DIR, "with-snapshot.jsonl");

    const lines = [
      JSON.stringify({ type: "file-history-snapshot", messageId: "x", snapshot: {} }),
      makeTranscriptEntry("uuid-1", "user", "Hello"),
      JSON.stringify({ type: "file-history-snapshot", messageId: "y", snapshot: {} }),
      makeTranscriptEntry("uuid-2", "assistant", [{ type: "text", text: "Hi!" }]),
    ];

    writeFileSync(transcriptPath, lines.join("\n") + "\n");

    const messages = parseTranscriptFile(transcriptPath);

    expect(messages).toHaveLength(2);
    expect(messages[0].textContent).toBe("Hello");
    expect(messages[1].textContent).toBe("Hi!");
  });

  test("handles realistic multi-tool response", () => {
    const transcriptPath = join(TEST_DIR, "multi-tool.jsonl");

    const lines = [
      makeTranscriptEntry("uuid-1", "user", "Read the config and run tests"),
      makeTranscriptEntry("uuid-2", "assistant", [
        { type: "thinking", thinking: "I need to read the config first, then run tests." },
        { type: "text", text: "I'll read the config file first." },
        {
          type: "tool_use",
          id: "tool-1",
          name: "Read",
          input: { file_path: "/project/config.json" },
        },
        {
          type: "tool_result",
          tool_use_id: "tool-1",
          content: '{"test": "jest"}',
        },
        { type: "text", text: "Now running tests." },
        {
          type: "tool_use",
          id: "tool-2",
          name: "Bash",
          input: { command: "npm test" },
        },
        {
          type: "tool_result",
          tool_use_id: "tool-2",
          content: "All tests passed!",
        },
        { type: "text", text: "All tests passed successfully!" },
      ]),
    ];

    writeFileSync(transcriptPath, lines.join("\n") + "\n");

    const messages = parseTranscriptFile(transcriptPath);

    expect(messages).toHaveLength(2);
    expect(messages[1].toolCalls).toHaveLength(2);
    expect(messages[1].toolCalls[0].name).toBe("Read");
    expect(messages[1].toolCalls[1].name).toBe("Bash");
    expect(messages[1].thinkingContent).toContain("read the config first");
  });

  test("preserves message order by timestamp", () => {
    const transcriptPath = join(TEST_DIR, "ordered.jsonl");

    const now = Date.now();
    const lines = [
      JSON.stringify({
        type: "user",
        uuid: "uuid-1",
        sessionId: "test",
        timestamp: new Date(now).toISOString(),
        cwd: "/test",
        version: "1.0",
        gitBranch: "",
        slug: "test",
        message: { role: "user", content: "First" },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "uuid-2",
        sessionId: "test",
        timestamp: new Date(now + 1000).toISOString(),
        cwd: "/test",
        version: "1.0",
        gitBranch: "",
        slug: "test",
        message: { role: "assistant", content: [{ type: "text", text: "Second" }] },
      }),
      JSON.stringify({
        type: "user",
        uuid: "uuid-3",
        sessionId: "test",
        timestamp: new Date(now + 2000).toISOString(),
        cwd: "/test",
        version: "1.0",
        gitBranch: "",
        slug: "test",
        message: { role: "user", content: "Third" },
      }),
    ];

    writeFileSync(transcriptPath, lines.join("\n") + "\n");

    const messages = parseTranscriptFile(transcriptPath);

    expect(messages).toHaveLength(3);
    expect(messages[0].textContent).toBe("First");
    expect(messages[1].textContent).toBe("Second");
    expect(messages[2].textContent).toBe("Third");

    // Verify timestamps are in order
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i].timestamp.getTime()).toBeGreaterThan(
        messages[i - 1].timestamp.getTime()
      );
    }
  });

  test("handles empty transcript file", () => {
    const transcriptPath = join(TEST_DIR, "empty.jsonl");
    writeFileSync(transcriptPath, "");

    const messages = parseTranscriptFile(transcriptPath);
    expect(messages).toHaveLength(0);
  });

  test("handles transcript with only whitespace", () => {
    const transcriptPath = join(TEST_DIR, "whitespace.jsonl");
    writeFileSync(transcriptPath, "   \n\n   \n");

    const messages = parseTranscriptFile(transcriptPath);
    expect(messages).toHaveLength(0);
  });
});

describe("byte offset calculations", () => {
  test("multi-byte characters have correct byte lengths", () => {
    const tests = [
      { char: "A", expectedBytes: 1 },
      { char: "é", expectedBytes: 2 },
      { char: "世", expectedBytes: 3 },
      { char: "👋", expectedBytes: 4 },
      { char: "👨‍👩‍👧‍👦", expectedBytes: 25 }, // Family emoji with ZWJ
    ];

    for (const { char, expectedBytes } of tests) {
      const bytes = Buffer.byteLength(char, "utf-8");
      expect(bytes).toBe(expectedBytes);
    }
  });

  test("JSON.stringify preserves multi-byte characters", () => {
    const obj = { text: "Hello 👋 世界" };
    const json = JSON.stringify(obj);
    const parsed = JSON.parse(json);

    expect(parsed.text).toBe("Hello 👋 世界");
  });

  test("buffer slicing at UTF-8 boundaries works correctly", () => {
    const text = "A é 世 👋"; // 1 + 1 + 2 + 1 + 3 + 1 + 4 = 13 bytes
    const buffer = Buffer.from(text, "utf-8");

    // Slice after "A " (2 bytes)
    const slice1 = buffer.subarray(2).toString("utf-8");
    expect(slice1).toBe("é 世 👋");

    // Slice after "A é " (5 bytes: A=1, space=1, é=2, space=1)
    const slice2 = buffer.subarray(5).toString("utf-8");
    expect(slice2).toBe("世 👋");
  });
});
