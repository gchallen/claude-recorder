// Content blocks in assistant messages
export type ContentBlock =
  | { type: "thinking"; thinking: string }
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string | unknown };

// A single entry in the transcript JSONL file
export interface TranscriptEntry {
  type: "user" | "assistant" | "file-history-snapshot" | "summary";
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  cwd: string;
  version: string;
  gitBranch: string;
  slug: string;
  isSidechain?: boolean;
  userType?: string;
  message: {
    role: "user" | "assistant";
    content: string | ContentBlock[];
    model?: string;
    id?: string;
  };
  thinkingMetadata?: {
    level: string;
    disabled: boolean;
    triggers?: unknown[];
  };
  todos?: unknown[];
}

// Parsed message for storage
export interface ParsedMessage {
  uuid: string;
  sessionId: string;
  timestamp: Date;
  role: "user" | "assistant";
  textContent: string;
  thinkingContent: string | null;
  toolCalls: ParsedToolCall[];
  model: string | null;
  cwd: string;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  input: string;
  output: string | null;
}

// Session metadata
export interface Session {
  id: string;
  slug: string;
  projectPath: string;
  workingDir: string;
  startTime: Date;
  endTime: Date | null;
  messageCount: number;
  version: string;
  lastActivity?: Date;
}

// Hook input from Claude Code
export interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd?: string;
  source?: string;
  reason?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
}
