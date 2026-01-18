#!/usr/bin/env bun
/**
 * Pre-commit hook for Claude Recorder
 *
 * Automatically exports the current Claude session to the project directory
 * before each commit, so the session file is included in the commit.
 */

import { existsSync, appendFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { isSessionExportEnabled } from "../config.js";
import { exportActiveSessionToProject } from "../session-export.js";

const LOG_DIR = join(homedir(), ".claude-recorder", "logs");

function log(message: string): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] pre-commit: ${message}\n`;
  appendFileSync(join(LOG_DIR, "hooks.log"), logLine);
}

async function main(): Promise<void> {
  const cwd = process.cwd();

  // Check if session export is enabled for this project
  if (!isSessionExportEnabled(cwd)) {
    log(`Session export not enabled for ${cwd}`);
    process.exit(0);
  }

  log(`Exporting session for ${cwd}`);

  // Export the active session
  const result = exportActiveSessionToProject(cwd);

  if (!result) {
    log("No active session found or export failed");
    process.exit(0);
  }

  log(`Exported session ${result.sessionId.slice(0, 8)} to ${result.outputPath}`);

  // Stage the exported file
  const gitAdd = Bun.spawnSync(["git", "add", result.outputPath], {
    cwd,
  });

  if (gitAdd.exitCode === 0) {
    log(`Staged ${result.outputPath}`);
  } else {
    log(`Failed to stage ${result.outputPath}: ${gitAdd.stderr.toString()}`);
  }
}

main().catch((err) => {
  try {
    log(`Error: ${err}`);
  } catch {
    // Ignore logging errors
  }
  // Don't block the commit on errors
  process.exit(0);
});
