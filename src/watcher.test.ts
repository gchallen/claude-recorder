import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { parseTranscriptContent } from "./parser.js";

const TEST_DIR = "/tmp/claude-recorder-test";
const TEST_FILE = join(TEST_DIR, "test-transcript.jsonl");

function makeMessage(
  uuid: string,
  content: string,
  type: "user" | "assistant" = "user"
): string {
  return JSON.stringify({
    type,
    uuid,
    sessionId: "test-session",
    timestamp: new Date().toISOString(),
    cwd: "/test",
    version: "2.0.76",
    gitBranch: "",
    slug: "test",
    message: {
      role: type,
      content: type === "user" ? content : [{ type: "text", text: content }],
    },
  });
}

describe("incremental parsing with byte offsets", () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      require("fs").mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_FILE)) {
      unlinkSync(TEST_FILE);
    }
  });

  test("correctly slices by bytes with multi-byte characters", () => {
    // First message with multi-byte characters (emoji + Chinese)
    const msg1 = makeMessage("uuid-1", "Hello 👋 世界!");
    const msg2 = makeMessage("uuid-2", "Second message");

    // Write first message
    writeFileSync(TEST_FILE, msg1 + "\n");
    const position1 = Buffer.byteLength(msg1 + "\n", "utf-8");

    // Write second message
    writeFileSync(TEST_FILE, msg1 + "\n" + msg2 + "\n");

    // Read and slice by bytes (simulating what watcher does)
    const buffer = readFileSync(TEST_FILE);
    const newBuffer = buffer.subarray(position1);
    const newContent = newBuffer.toString("utf-8");

    const messages = parseTranscriptContent(newContent);

    expect(messages).toHaveLength(1);
    expect(messages[0].uuid).toBe("uuid-2");
    expect(messages[0].textContent).toBe("Second message");
  });

  test("byte offset differs from character offset with emoji", () => {
    const textWithEmoji = "Test 👨‍👩‍👧‍👦 family"; // Family emoji is ~25 bytes but 1 "character"
    const msg = makeMessage("uuid-1", textWithEmoji);

    const byteLength = Buffer.byteLength(msg, "utf-8");
    const charLength = msg.length;

    // Byte length should be greater than character length due to multi-byte chars
    expect(byteLength).toBeGreaterThan(charLength);
  });

  test("handles slicing at exact line boundary", () => {
    const msg1 = makeMessage("uuid-1", "First");
    const msg2 = makeMessage("uuid-2", "Second");
    const msg3 = makeMessage("uuid-3", "Third");

    const fullContent = [msg1, msg2, msg3].join("\n") + "\n";
    writeFileSync(TEST_FILE, fullContent);

    // Position after first two messages
    const position = Buffer.byteLength(msg1 + "\n" + msg2 + "\n", "utf-8");

    const buffer = readFileSync(TEST_FILE);
    const newBuffer = buffer.subarray(position);
    const newContent = newBuffer.toString("utf-8");

    const messages = parseTranscriptContent(newContent);

    expect(messages).toHaveLength(1);
    expect(messages[0].uuid).toBe("uuid-3");
  });

  test("handles empty new content", () => {
    const msg1 = makeMessage("uuid-1", "Only message");
    writeFileSync(TEST_FILE, msg1 + "\n");

    const buffer = readFileSync(TEST_FILE);
    const position = buffer.length;

    // No new content
    const newBuffer = buffer.subarray(position);
    const newContent = newBuffer.toString("utf-8");

    expect(newContent).toBe("");

    const messages = parseTranscriptContent(newContent);
    expect(messages).toHaveLength(0);
  });

  test("handles smart quotes and special Unicode", () => {
    // Use escaped unicode for special characters
    const text1 = "\u201cHello\u201d \u2014 said the \u2018user\u2019"; // "Hello" — said the 'user'
    const text2 = "Response with \u00a9 and \u2122"; // © and ™
    const msg1 = makeMessage("uuid-1", text1);
    const msg2 = makeMessage("uuid-2", text2);

    writeFileSync(TEST_FILE, msg1 + "\n");
    const position1 = Buffer.byteLength(msg1 + "\n", "utf-8");

    writeFileSync(TEST_FILE, msg1 + "\n" + msg2 + "\n");

    const buffer = readFileSync(TEST_FILE);
    const newBuffer = buffer.subarray(position1);
    const newContent = newBuffer.toString("utf-8");

    const messages = parseTranscriptContent(newContent);

    expect(messages).toHaveLength(1);
    expect(messages[0].textContent).toBe(text2);
  });
});
