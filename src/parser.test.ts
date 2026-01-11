import { describe, test, expect } from "bun:test";
import { parseTranscriptContent } from "./parser.js";

describe("parseTranscriptContent", () => {
  test("parses a simple user message", () => {
    const content = JSON.stringify({
      type: "user",
      uuid: "test-uuid-1",
      sessionId: "session-1",
      timestamp: "2026-01-11T12:00:00.000Z",
      cwd: "/Users/test/project",
      version: "2.0.76",
      gitBranch: "main",
      slug: "test-session",
      message: {
        role: "user",
        content: "Hello, Claude!",
      },
    });

    const messages = parseTranscriptContent(content);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].textContent).toBe("Hello, Claude!");
    expect(messages[0].uuid).toBe("test-uuid-1");
  });

  test("parses an assistant message with text block", () => {
    const content = JSON.stringify({
      type: "assistant",
      uuid: "test-uuid-2",
      sessionId: "session-1",
      timestamp: "2026-01-11T12:00:01.000Z",
      cwd: "/Users/test/project",
      version: "2.0.76",
      gitBranch: "main",
      slug: "test-session",
      message: {
        role: "assistant",
        model: "claude-opus-4-5-20251101",
        content: [{ type: "text", text: "Hello! How can I help?" }],
      },
    });

    const messages = parseTranscriptContent(content);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
    expect(messages[0].textContent).toBe("Hello! How can I help?");
    expect(messages[0].model).toBe("claude-opus-4-5-20251101");
  });

  test("parses assistant message with thinking block", () => {
    const content = JSON.stringify({
      type: "assistant",
      uuid: "test-uuid-3",
      sessionId: "session-1",
      timestamp: "2026-01-11T12:00:02.000Z",
      cwd: "/Users/test/project",
      version: "2.0.76",
      gitBranch: "main",
      slug: "test-session",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me consider this..." },
          { type: "text", text: "Here's my answer." },
        ],
      },
    });

    const messages = parseTranscriptContent(content);

    expect(messages).toHaveLength(1);
    expect(messages[0].thinkingContent).toBe("Let me consider this...");
    expect(messages[0].textContent).toBe("Here's my answer.");
  });

  test("parses tool calls with results", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        uuid: "test-uuid-4",
        sessionId: "session-1",
        timestamp: "2026-01-11T12:00:03.000Z",
        cwd: "/Users/test/project",
        version: "2.0.76",
        gitBranch: "main",
        slug: "test-session",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Bash",
              input: { command: "ls -la" },
            },
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: "file1.txt\nfile2.txt",
            },
          ],
        },
      }),
    ].join("\n");

    const messages = parseTranscriptContent(lines);

    expect(messages).toHaveLength(1);
    expect(messages[0].toolCalls).toHaveLength(1);
    expect(messages[0].toolCalls[0].name).toBe("Bash");
    expect(messages[0].toolCalls[0].output).toBe("file1.txt\nfile2.txt");
  });

  test("skips non-message entries", () => {
    const lines = [
      JSON.stringify({ type: "file-history-snapshot", messageId: "x" }),
      JSON.stringify({
        type: "user",
        uuid: "test-uuid-5",
        sessionId: "session-1",
        timestamp: "2026-01-11T12:00:04.000Z",
        cwd: "/test",
        version: "2.0.76",
        gitBranch: "",
        slug: "test",
        message: { role: "user", content: "Test" },
      }),
    ].join("\n");

    const messages = parseTranscriptContent(lines);

    expect(messages).toHaveLength(1);
    expect(messages[0].textContent).toBe("Test");
  });

  test("handles multi-byte UTF-8 characters", () => {
    // Use escaped unicode for smart quotes to avoid syntax issues
    const smartText = "Hello \ud83d\udc4b \u4e16\u754c! Here\u2019s a \u201csmart quote\u201d test.";
    const content = JSON.stringify({
      type: "user",
      uuid: "test-uuid-6",
      sessionId: "session-1",
      timestamp: "2026-01-11T12:00:05.000Z",
      cwd: "/Users/test/project",
      version: "2.0.76",
      gitBranch: "main",
      slug: "test-session",
      message: {
        role: "user",
        content: smartText,
      },
    });

    const messages = parseTranscriptContent(content);

    expect(messages).toHaveLength(1);
    expect(messages[0].textContent).toBe(smartText);
  });

  test("handles malformed JSON lines gracefully", () => {
    const lines = [
      "not valid json",
      JSON.stringify({
        type: "user",
        uuid: "test-uuid-7",
        sessionId: "session-1",
        timestamp: "2026-01-11T12:00:06.000Z",
        cwd: "/test",
        version: "2.0.76",
        gitBranch: "",
        slug: "test",
        message: { role: "user", content: "Valid message" },
      }),
      '{"incomplete": true',
    ].join("\n");

    const messages = parseTranscriptContent(lines);

    expect(messages).toHaveLength(1);
    expect(messages[0].textContent).toBe("Valid message");
  });
});
