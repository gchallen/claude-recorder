import { readFileSync } from "fs";
import type {
  TranscriptEntry,
  ParsedMessage,
  ParsedToolCall,
  ContentBlock,
} from "./types.js";

export function parseTranscriptFile(filePath: string): ParsedMessage[] {
  const content = readFileSync(filePath, "utf-8");
  return parseTranscriptContent(content);
}

export function parseTranscriptContent(content: string): ParsedMessage[] {
  const lines = content.trim().split("\n").filter(Boolean);
  const messages: ParsedMessage[] = [];
  const toolResults = new Map<string, string>();

  // First pass: collect tool results
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as TranscriptEntry;
      if (entry.type === "assistant" && Array.isArray(entry.message?.content)) {
        for (const block of entry.message.content as ContentBlock[]) {
          if (block.type === "tool_result") {
            const resultContent =
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content);
            toolResults.set(block.tool_use_id, resultContent);
          }
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Second pass: build messages
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as TranscriptEntry;

      // Skip non-message entries
      if (entry.type !== "user" && entry.type !== "assistant") {
        continue;
      }

      const parsed = parseEntry(entry, toolResults);
      if (parsed) {
        messages.push(parsed);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return messages;
}

function parseEntry(
  entry: TranscriptEntry,
  toolResults: Map<string, string>
): ParsedMessage | null {
  if (!entry.message) return null;

  const role = entry.message.role;
  let textContent = "";
  let thinkingContent: string | null = null;
  const toolCalls: ParsedToolCall[] = [];

  if (typeof entry.message.content === "string") {
    // User messages have string content
    textContent = entry.message.content;
  } else if (Array.isArray(entry.message.content)) {
    // Assistant messages have array of content blocks
    for (const block of entry.message.content as ContentBlock[]) {
      switch (block.type) {
        case "text":
          textContent += (textContent ? "\n" : "") + block.text;
          break;
        case "thinking":
          thinkingContent = block.thinking;
          break;
        case "tool_use":
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: JSON.stringify(block.input, null, 2),
            output: toolResults.get(block.id) ?? null,
          });
          break;
      }
    }
  }

  return {
    uuid: entry.uuid,
    sessionId: entry.sessionId,
    timestamp: new Date(entry.timestamp),
    role,
    textContent,
    thinkingContent,
    toolCalls,
    model: entry.message.model ?? null,
    cwd: entry.cwd,
  };
}

// Incremental parsing: parse only new lines from a file
export function parseTranscriptIncremental(
  filePath: string,
  fromByte: number
): { messages: ParsedMessage[]; newPosition: number } {
  const file = Bun.file(filePath);
  const content = readFileSync(filePath, "utf-8");
  const newContent = content.slice(fromByte);
  const messages = parseTranscriptContent(newContent);

  return {
    messages,
    newPosition: Buffer.byteLength(content, "utf-8"),
  };
}
