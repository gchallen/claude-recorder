#!/usr/bin/env bun
/**
 * /save-session skill for Claude Code
 *
 * Exports the current session to the project directory as a markdown file.
 * Reads configuration from .claude-recorder.json in the working directory.
 */

import { existsSync, mkdirSync, appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getSessionExportConfig } from "../config.js";
import { exportSessionToProject, getActiveSessionForProject } from "../session-export.js";
import type { HookInput } from "../types.js";

const LOG_DIR = join(homedir(), ".claude-recorder", "logs");

function log(message: string): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] save-session: ${message}\n`;
  appendFileSync(join(LOG_DIR, "hooks.log"), logLine);
}

async function main(): Promise<void> {
  // Read hook input from stdin (contains session_id, cwd, etc.)
  let input: HookInput;
  try {
    const stdin = await Bun.stdin.text();
    input = JSON.parse(stdin);
  } catch (err) {
    log(`Failed to parse stdin: ${err}`);
    console.log("Failed to read session information");
    process.exit(0);
  }

  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id;

  log(`Save session requested for ${cwd}, session ${sessionId}`);

  // Check for config
  const exportConfig = getSessionExportConfig(cwd);

  if (!exportConfig) {
    console.log("No .claude-recorder.json found or sessionExport not configured.");
    console.log("");
    console.log("Create .claude-recorder.json with:");
    console.log(`{
  "sessionExport": {
    "enabled": true,
    "outputDir": ".claude-sessions",
    "fileNamePattern": "{datetime}-{slug}"
  }
}`);
    process.exit(0);
  }

  if (!exportConfig.enabled) {
    console.log("Session export is disabled in .claude-recorder.json");
    process.exit(0);
  }

  // Use session_id from hook input if available, otherwise find active session
  let targetSessionId = sessionId;
  if (!targetSessionId) {
    targetSessionId = getActiveSessionForProject(cwd);
  }

  if (!targetSessionId) {
    console.log("No active session found for this project");
    process.exit(0);
  }

  // Export the session
  const outputPath = exportSessionToProject(targetSessionId, cwd);

  if (!outputPath) {
    console.log("Failed to export session");
    process.exit(1);
  }

  log(`Exported to ${outputPath}`);
  console.log(`Session exported to: ${outputPath}`);

  // Optionally stage the file
  const gitAdd = Bun.spawnSync(["git", "add", outputPath], { cwd });
  if (gitAdd.exitCode === 0) {
    console.log("File staged for commit");
  }
}

main().catch((err) => {
  try {
    log(`Error: ${err}`);
  } catch {
    // Ignore logging errors
  }
  console.log(`Error: ${err}`);
  process.exit(1);
});
