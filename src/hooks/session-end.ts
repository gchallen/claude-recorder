#!/usr/bin/env bun
/**
 * SessionEnd hook for Claude Code
 *
 * Receives JSON via stdin with session_id.
 * Signals the watcher to stop and do final capture.
 */

import { existsSync, readFileSync, mkdirSync, appendFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { HookInput } from "../types.js";

const LOG_DIR = join(homedir(), ".claude-recorder", "logs");
const RUN_DIR = join(homedir(), ".claude-recorder", "run");

function log(message: string): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] session-end: ${message}\n`;
  appendFileSync(join(LOG_DIR, "hooks.log"), logLine);
}

function stopWatcher(sessionId: string): boolean {
  const pidFile = join(RUN_DIR, `${sessionId}.pid`);
  if (!existsSync(pidFile)) {
    log(`No PID file found for session ${sessionId}`);
    return false;
  }

  try {
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim());
    log(`Sending SIGTERM to watcher PID ${pid}`);
    process.kill(pid, "SIGTERM");

    // Clean up PID file after a short delay
    setTimeout(() => {
      try {
        if (existsSync(pidFile)) {
          unlinkSync(pidFile);
        }
      } catch {
        // Ignore
      }
    }, 1000);

    return true;
  } catch (err) {
    log(`Failed to stop watcher: ${err}`);
    // Clean up stale PID file
    try {
      unlinkSync(pidFile);
    } catch {
      // Ignore
    }
    return false;
  }
}

async function main(): Promise<void> {
  // Read JSON from stdin
  let input: HookInput;
  try {
    const stdin = await Bun.stdin.text();
    input = JSON.parse(stdin);
  } catch (err) {
    log(`Failed to parse stdin: ${err}`);
    process.exit(0);
  }

  const { session_id } = input;

  if (!session_id) {
    log("Missing session_id");
    process.exit(0);
  }

  log(`Ending session ${session_id}`);
  const stopped = stopWatcher(session_id);
  log(stopped ? "Watcher stopped" : "Watcher was not running");
}

main().catch((err) => {
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
    appendFileSync(
      join(LOG_DIR, "hooks.log"),
      `[${new Date().toISOString()}] session-end error: ${err}\n`
    );
  } catch {
    // Ignore
  }
});
