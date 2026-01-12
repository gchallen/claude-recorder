import chalk from "chalk";
import { readdirSync, readFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { isDaemonRunning } from "../watcher.js";

const RUN_DIR = join(homedir(), ".claude-recorder", "run");
const SESSIONS_DIR = join(RUN_DIR, "sessions");
const DAEMON_PID_FILE = join(RUN_DIR, "watcher.pid");

export function cleanupCommand(): void {
  let cleaned = 0;

  // Clean up stale daemon PID file
  if (existsSync(DAEMON_PID_FILE) && !isDaemonRunning()) {
    try {
      unlinkSync(DAEMON_PID_FILE);
      console.log(chalk.gray("  Removed stale daemon PID file"));
      cleaned++;
    } catch {
      // Ignore
    }
  }

  // Clean up old per-session PID files (from old architecture)
  if (existsSync(RUN_DIR)) {
    const pidFiles = readdirSync(RUN_DIR).filter(
      (f) => f.endsWith(".pid") && f !== "watcher.pid"
    );

    for (const file of pidFiles) {
      const pidFile = join(RUN_DIR, file);
      try {
        const pid = parseInt(readFileSync(pidFile, "utf-8").trim());
        process.kill(pid, 0); // Check if running
        console.log(
          chalk.yellow(`  Old watcher still running: ${file} (PID ${pid})`)
        );
      } catch {
        // Process not running, remove stale file
        unlinkSync(pidFile);
        console.log(chalk.gray(`  Removed stale PID file: ${file}`));
        cleaned++;
      }
    }
  }

  // Clean up orphaned session registration files
  if (existsSync(SESSIONS_DIR)) {
    const sessionFiles = readdirSync(SESSIONS_DIR);

    for (const file of sessionFiles) {
      const sessionFile = join(SESSIONS_DIR, file);
      try {
        const transcriptPath = readFileSync(sessionFile, "utf-8").trim();
        if (!existsSync(transcriptPath)) {
          unlinkSync(sessionFile);
          console.log(
            chalk.gray(`  Removed orphaned session: ${file.slice(0, 8)}`)
          );
          cleaned++;
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  if (cleaned > 0) {
    console.log(chalk.green(`\nCleaned up ${cleaned} stale file(s).`));
  } else {
    console.log(chalk.gray("Nothing to clean up."));
  }
}
