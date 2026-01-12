#!/usr/bin/env bun
/**
 * SessionEnd hook for Claude Code
 *
 * Receives JSON via stdin with session_id.
 * Unregisters the session so the daemon stops watching it.
 */

import { existsSync, mkdirSync, appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { unregisterSession } from "../watcher.js";
import type { HookInput } from "../types.js";

const LOG_DIR = join(homedir(), ".claude-recorder", "logs");

function log(message: string): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] session-end: ${message}\n`;
  appendFileSync(join(LOG_DIR, "hooks.log"), logLine);
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

  // Unregister the session - daemon will detect this and finalize
  unregisterSession(session_id);
  log("Session unregistered");
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
