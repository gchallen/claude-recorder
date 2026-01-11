#!/usr/bin/env bun
import { watch, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { parseTranscriptContent } from "./parser.js";
import {
  getDatabase,
  upsertSession,
  insertMessage,
  getFilePosition,
  setFilePosition,
  endSession,
} from "./storage.js";
import type { TranscriptEntry } from "./types.js";

const RUN_DIR = join(homedir(), ".claude-recorder", "run");
const POLL_INTERVAL_MS = 5000; // 5 seconds

interface WatcherState {
  sessionId: string;
  transcriptPath: string;
  projectPath: string;
  running: boolean;
}

let state: WatcherState | null = null;

function log(message: string): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ${message}`);
}

function getSessionMetadata(transcriptPath: string): {
  sessionId: string;
  slug: string;
  projectPath: string;
  workingDir: string;
  version: string;
} | null {
  if (!existsSync(transcriptPath)) return null;

  const content = readFileSync(transcriptPath, "utf-8");
  const lines = content.trim().split("\n");

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as TranscriptEntry;
      if (entry.type === "user" || entry.type === "assistant") {
        return {
          sessionId: entry.sessionId,
          slug: entry.slug,
          projectPath: dirname(transcriptPath),
          workingDir: entry.cwd,
          version: entry.version,
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function processTranscript(transcriptPath: string): void {
  if (!existsSync(transcriptPath)) {
    log(`Transcript file not found: ${transcriptPath}`);
    return;
  }

  const position = getFilePosition(transcriptPath);

  // Read file as buffer to correctly handle byte positions
  const buffer = readFileSync(transcriptPath);
  const currentSize = buffer.length;

  if (currentSize <= position) {
    return; // No new content
  }

  // Slice by bytes, then convert to string
  const newBuffer = buffer.subarray(position);
  const newContent = newBuffer.toString("utf-8");

  const messages = parseTranscriptContent(newContent);

  log(`Processing ${messages.length} new messages from position ${position}`);

  for (const message of messages) {
    insertMessage(message);
  }

  setFilePosition(transcriptPath, currentSize);
}

function writePidFile(sessionId: string): void {
  if (!existsSync(RUN_DIR)) {
    mkdirSync(RUN_DIR, { recursive: true });
  }
  const pidFile = join(RUN_DIR, `${sessionId}.pid`);
  writeFileSync(pidFile, process.pid.toString());
}

function removePidFile(sessionId: string): void {
  const pidFile = join(RUN_DIR, `${sessionId}.pid`);
  if (existsSync(pidFile)) {
    Bun.file(pidFile).delete;
    try {
      require("fs").unlinkSync(pidFile);
    } catch {
      // Ignore
    }
  }
}

export function startWatcher(
  sessionId: string,
  transcriptPath: string
): void {
  if (state?.running) {
    log(`Watcher already running for session ${state.sessionId}`);
    return;
  }

  log(`Starting watcher for session ${sessionId}`);
  log(`Transcript path: ${transcriptPath}`);

  // Initialize database
  getDatabase();

  // Get session metadata and create session record
  const metadata = getSessionMetadata(transcriptPath);
  if (metadata) {
    upsertSession(
      metadata.sessionId,
      metadata.slug,
      metadata.projectPath,
      metadata.workingDir,
      new Date(),
      metadata.version,
      transcriptPath
    );
  }

  state = {
    sessionId,
    transcriptPath,
    projectPath: metadata?.projectPath ?? dirname(transcriptPath),
    running: true,
  };

  writePidFile(sessionId);

  // Initial processing
  processTranscript(transcriptPath);

  // Set up file watcher with polling fallback
  let watcher: ReturnType<typeof watch> | null = null;

  try {
    watcher = watch(transcriptPath, (eventType) => {
      if (eventType === "change" && state?.running) {
        processTranscript(transcriptPath);
      }
    });
    log("File watcher started");
  } catch (err) {
    log(`File watcher failed, using polling: ${err}`);
  }

  // Polling fallback (also serves as periodic backup)
  const pollInterval = setInterval(() => {
    if (state?.running) {
      processTranscript(transcriptPath);
    }
  }, POLL_INTERVAL_MS);

  // Handle shutdown signals
  const shutdown = () => {
    log("Shutting down watcher");
    state!.running = false;

    if (watcher) watcher.close();
    clearInterval(pollInterval);

    // Final processing
    processTranscript(transcriptPath);
    endSession(sessionId, new Date());
    removePidFile(sessionId);

    log("Watcher stopped");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGHUP", shutdown);

  log("Watcher running. Send SIGTERM to stop.");
}

export function stopWatcher(sessionId: string): boolean {
  const pidFile = join(RUN_DIR, `${sessionId}.pid`);
  if (!existsSync(pidFile)) {
    return false;
  }

  const pid = parseInt(readFileSync(pidFile, "utf-8").trim());
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    // Process may already be dead, clean up pid file
    try {
      require("fs").unlinkSync(pidFile);
    } catch {
      // Ignore
    }
    return false;
  }
}

// CLI mode: start watcher with arguments
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args[0] === "stop" && args[1]) {
    const stopped = stopWatcher(args[1]);
    console.log(stopped ? "Watcher stopped" : "Watcher not found");
    process.exit(stopped ? 0 : 1);
  }

  if (args.length < 2) {
    console.error("Usage: bun watcher.ts <session_id> <transcript_path>");
    console.error("       bun watcher.ts stop <session_id>");
    process.exit(1);
  }

  const [sessionId, transcriptPath] = args;
  startWatcher(sessionId, transcriptPath);
}
