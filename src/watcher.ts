#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "fs";
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
const SESSIONS_DIR = join(RUN_DIR, "sessions");
const PID_FILE = join(RUN_DIR, "watcher.pid");
const POLL_INTERVAL_MS = 5000; // 5 seconds

interface WatchedSession {
  sessionId: string;
  transcriptPath: string;
  projectPath: string;
}

// Currently watched sessions
const watchedSessions = new Map<string, WatchedSession>();

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
        const projectPath = dirname(transcriptPath);
        const derivedSlug = entry.slug || projectPath.split("/").pop() || "unknown";
        return {
          sessionId: entry.sessionId,
          slug: derivedSlug,
          projectPath,
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

function processTranscript(session: WatchedSession): void {
  const { transcriptPath } = session;

  if (!existsSync(transcriptPath)) {
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

  if (messages.length > 0) {
    log(`[${session.sessionId.slice(0, 8)}] Processing ${messages.length} new messages`);
    for (const message of messages) {
      insertMessage(message);
    }
  }

  setFilePosition(transcriptPath, currentSize);
}

function scanForSessions(): void {
  if (!existsSync(SESSIONS_DIR)) {
    return;
  }

  const files = readdirSync(SESSIONS_DIR);
  const activeSessionIds = new Set<string>();

  // Check for new sessions
  for (const file of files) {
    const sessionId = file;
    activeSessionIds.add(sessionId);

    if (!watchedSessions.has(sessionId)) {
      // New session to watch
      const sessionFile = join(SESSIONS_DIR, file);
      try {
        const transcriptPath = readFileSync(sessionFile, "utf-8").trim();

        if (!existsSync(transcriptPath)) {
          log(`[${sessionId.slice(0, 8)}] Transcript not found: ${transcriptPath}`);
          continue;
        }

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

        const session: WatchedSession = {
          sessionId,
          transcriptPath,
          projectPath: metadata?.projectPath ?? dirname(transcriptPath),
        };

        watchedSessions.set(sessionId, session);
        log(`[${sessionId.slice(0, 8)}] Now watching: ${transcriptPath}`);

        // Initial processing
        processTranscript(session);
      } catch (err) {
        log(`[${sessionId.slice(0, 8)}] Error reading session file: ${err}`);
      }
    }
  }

  // Check for ended sessions
  for (const [sessionId, session] of watchedSessions) {
    if (!activeSessionIds.has(sessionId)) {
      // Session ended, do final processing
      log(`[${sessionId.slice(0, 8)}] Session ended, finalizing`);
      processTranscript(session);
      endSession(sessionId, new Date());
      watchedSessions.delete(sessionId);
    }
  }
}

function writePidFile(): void {
  if (!existsSync(RUN_DIR)) {
    mkdirSync(RUN_DIR, { recursive: true });
  }
  writeFileSync(PID_FILE, process.pid.toString());
}

function removePidFile(): void {
  if (existsSync(PID_FILE)) {
    try {
      unlinkSync(PID_FILE);
    } catch {
      // Ignore
    }
  }
}

export function isDaemonRunning(): boolean {
  if (!existsSync(PID_FILE)) {
    return false;
  }

  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
    process.kill(pid, 0); // Check if running
    return true;
  } catch {
    // Process not running, clean up stale PID file
    try {
      unlinkSync(PID_FILE);
    } catch {
      // Ignore
    }
    return false;
  }
}

export function getDaemonPid(): number | null {
  if (!existsSync(PID_FILE)) {
    return null;
  }

  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
    process.kill(pid, 0); // Check if running
    return pid;
  } catch {
    return null;
  }
}

export function registerSession(sessionId: string, transcriptPath: string): void {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
  const sessionFile = join(SESSIONS_DIR, sessionId);
  writeFileSync(sessionFile, transcriptPath);
}

export function unregisterSession(sessionId: string): void {
  const sessionFile = join(SESSIONS_DIR, sessionId);
  if (existsSync(sessionFile)) {
    try {
      unlinkSync(sessionFile);
    } catch {
      // Ignore
    }
  }
}

export function getRegisteredSessions(): string[] {
  if (!existsSync(SESSIONS_DIR)) {
    return [];
  }
  return readdirSync(SESSIONS_DIR);
}

export function startDaemon(): void {
  if (isDaemonRunning()) {
    log("Daemon already running");
    return;
  }

  log("Starting watcher daemon");

  // Initialize database
  getDatabase();

  writePidFile();

  // Initial scan
  scanForSessions();

  // Poll for changes
  const pollInterval = setInterval(() => {
    // Scan for new/ended sessions
    scanForSessions();

    // Process all watched sessions
    for (const session of watchedSessions.values()) {
      processTranscript(session);
    }
  }, POLL_INTERVAL_MS);

  // Handle shutdown signals
  const shutdown = () => {
    log("Shutting down daemon");
    clearInterval(pollInterval);

    // Final processing for all sessions
    for (const session of watchedSessions.values()) {
      processTranscript(session);
      endSession(session.sessionId, new Date());
    }

    removePidFile();
    log("Daemon stopped");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGHUP", shutdown);

  log(`Daemon running (PID ${process.pid}). Watching ${watchedSessions.size} session(s).`);
}

export function stopDaemon(): boolean {
  const pid = getDaemonPid();
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    removePidFile();
    return false;
  }
}

// CLI mode
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args[0] === "stop") {
    const stopped = stopDaemon();
    console.log(stopped ? "Daemon stopped" : "Daemon not running");
    process.exit(stopped ? 0 : 1);
  }

  if (args[0] === "status") {
    const pid = getDaemonPid();
    if (pid) {
      console.log(`Daemon running (PID ${pid})`);
      const sessions = getRegisteredSessions();
      console.log(`Watching ${sessions.length} session(s)`);
    } else {
      console.log("Daemon not running");
    }
    process.exit(0);
  }

  // Default: start daemon
  startDaemon();
}
