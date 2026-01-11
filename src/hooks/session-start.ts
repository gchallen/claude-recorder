#!/usr/bin/env bun
/**
 * SessionStart hook for Claude Code
 *
 * Receives JSON via stdin with session_id and transcript_path.
 * Starts the watcher service in the background.
 */

import { spawn } from "child_process";
import { dirname, join } from "path";
import { existsSync, mkdirSync, appendFileSync, readdirSync, readFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import type { HookInput } from "../types.js";

const LOG_DIR = join(homedir(), ".claude-recorder", "logs");
const RUN_DIR = join(homedir(), ".claude-recorder", "run");
const RECORDER_DIR = dirname(dirname(dirname(import.meta.path)));

function log(message: string): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] session-start: ${message}\n`;
  appendFileSync(join(LOG_DIR, "hooks.log"), logLine);
}

function cleanupStalePids(): number {
  if (!existsSync(RUN_DIR)) return 0;

  let cleaned = 0;
  try {
    const files = readdirSync(RUN_DIR).filter((f) => f.endsWith(".pid"));

    for (const file of files) {
      const pidFile = join(RUN_DIR, file);
      try {
        const pid = parseInt(readFileSync(pidFile, "utf-8").trim());
        // Check if process is running
        process.kill(pid, 0);
        // Process is running, leave it alone
      } catch {
        // Process not running, remove stale PID file
        try {
          unlinkSync(pidFile);
          cleaned++;
        } catch {
          // Ignore removal errors
        }
      }
    }
  } catch {
    // Ignore errors reading directory
  }

  return cleaned;
}

async function main(): Promise<void> {
  // Clean up any stale PID files from crashed watchers
  const cleaned = cleanupStalePids();
  if (cleaned > 0) {
    log(`Cleaned up ${cleaned} stale PID file(s)`);
  }

  // Read JSON from stdin
  let input: HookInput;
  try {
    const stdin = await Bun.stdin.text();
    input = JSON.parse(stdin);
  } catch (err) {
    log(`Failed to parse stdin: ${err}`);
    process.exit(0); // Exit cleanly to not block Claude
  }

  const { session_id, transcript_path } = input;

  if (!session_id || !transcript_path) {
    log("Missing session_id or transcript_path");
    process.exit(0);
  }

  log(`Starting watcher for session ${session_id}`);
  log(`Transcript: ${transcript_path}`);

  // Start watcher in background
  const watcherPath = join(RECORDER_DIR, "src", "watcher.ts");

  const child = spawn("bun", ["run", watcherPath, session_id, transcript_path], {
    detached: true,
    stdio: "ignore",
    cwd: RECORDER_DIR,
  });

  child.unref();
  log(`Watcher started with PID ${child.pid}`);
}

main().catch((err) => {
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
    appendFileSync(
      join(LOG_DIR, "hooks.log"),
      `[${new Date().toISOString()}] session-start error: ${err}\n`
    );
  } catch {
    // Ignore logging errors
  }
});
