import { spawn } from "child_process";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { registerSession, unregisterSession, isDaemonRunning } from "../watcher.js";
import type { HookInput } from "../types.js";

const LOG_DIR = join(homedir(), ".claude-recorder", "logs");

function log(hookType: string, message: string): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${hookType}: ${message}\n`;
  appendFileSync(join(LOG_DIR, "hooks.log"), logLine);
}

async function readStdinInput(): Promise<HookInput> {
  const stdin = await Bun.stdin.text();
  return JSON.parse(stdin);
}

function startDaemonFromBinary(): void {
  // Get the path to the current executable
  const binaryPath = process.execPath;

  // Spawn the daemon using the same binary with "daemon" argument
  const child = spawn(binaryPath, ["daemon"], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();
  log("hook", `Daemon started with PID ${child.pid}`);
}

export async function hookSessionStartCommand(): Promise<void> {
  let input: HookInput;
  try {
    input = await readStdinInput();
  } catch (err) {
    log("session-start", `Failed to parse stdin: ${err}`);
    process.exit(0); // Exit cleanly to not block Claude
  }

  const { session_id, transcript_path } = input;

  if (!session_id || !transcript_path) {
    log("session-start", "Missing session_id or transcript_path");
    process.exit(0);
  }

  log("session-start", `Registering session ${session_id}`);
  log("session-start", `Transcript: ${transcript_path}`);

  // Register this session
  registerSession(session_id, transcript_path);

  // Start daemon if not running
  if (!isDaemonRunning()) {
    log("session-start", "Starting watcher daemon");
    startDaemonFromBinary();
  } else {
    log("session-start", "Daemon already running");
  }
}

export async function hookSessionEndCommand(): Promise<void> {
  let input: HookInput;
  try {
    input = await readStdinInput();
  } catch (err) {
    log("session-end", `Failed to parse stdin: ${err}`);
    process.exit(0);
  }

  const { session_id } = input;

  if (!session_id) {
    log("session-end", "Missing session_id");
    process.exit(0);
  }

  log("session-end", `Ending session ${session_id}`);

  // Unregister the session - daemon will detect this and finalize
  unregisterSession(session_id);
  log("session-end", "Session unregistered");
}
