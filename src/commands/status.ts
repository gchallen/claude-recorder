import chalk from "chalk";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getStats, listRecentlyActiveSessions } from "../storage.js";

const RUN_DIR = join(homedir(), ".claude-recorder", "run");
const LOG_FILE = join(homedir(), ".claude-recorder", "logs", "hooks.log");

interface WatcherInfo {
  sessionId: string;
  pid: number;
  running: boolean;
}

function getRunningWatchers(): WatcherInfo[] {
  if (!existsSync(RUN_DIR)) return [];

  const watchers: WatcherInfo[] = [];
  const files = readdirSync(RUN_DIR).filter((f) => f.endsWith(".pid"));

  for (const file of files) {
    const sessionId = file.replace(".pid", "");
    const pidFile = join(RUN_DIR, file);
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim());

    let running = false;
    try {
      process.kill(pid, 0); // Check if process exists
      running = true;
    } catch {
      running = false;
    }

    watchers.push({ sessionId, pid, running });
  }

  return watchers;
}

function getRecentLogs(lines = 5): string[] {
  if (!existsSync(LOG_FILE)) return [];

  const content = readFileSync(LOG_FILE, "utf-8");
  const allLines = content.trim().split("\n");
  return allLines.slice(-lines);
}

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export function statusCommand(): void {
  console.log(chalk.bold("\nClaude Recorder Status\n"));

  // Check watchers
  const watchers = getRunningWatchers();
  const activeWatchers = watchers.filter((w) => w.running);
  const staleWatchers = watchers.filter((w) => !w.running);

  console.log(chalk.cyan("Watchers:"));
  if (activeWatchers.length === 0 && staleWatchers.length === 0) {
    console.log(chalk.gray("  No watchers registered"));
  } else {
    for (const w of activeWatchers) {
      console.log(
        `  ${chalk.green("●")} ${w.sessionId.slice(0, 8)} ${chalk.gray(`(PID ${w.pid})`)}`
      );
    }
    for (const w of staleWatchers) {
      console.log(
        `  ${chalk.red("○")} ${w.sessionId.slice(0, 8)} ${chalk.gray("(stale)")}`
      );
    }
  }
  console.log();

  // Quick stats
  const stats = getStats();
  const recent = listRecentlyActiveSessions(5);

  console.log(chalk.cyan("Database:"));
  console.log(`  Sessions: ${chalk.white(stats.totalSessions)}`);
  console.log(`  Messages: ${chalk.white(stats.totalMessages)}`);
  console.log(`  Tool calls: ${chalk.white(stats.totalToolCalls)}`);
  console.log();

  // Recently active sessions
  if (recent.length > 0) {
    console.log(chalk.cyan("Recently active sessions:"));
    for (const s of recent.slice(0, 5)) {
      const active = activeWatchers.some((w) => w.sessionId === s.id);
      const indicator = active ? chalk.green("●") : chalk.gray("○");
      const lastActive = s.lastActivity
        ? formatRelativeTime(s.lastActivity)
        : "never";
      // Show abbreviated working dir (replace home with ~)
      const dir = s.workingDir.replace(homedir(), "~");
      console.log(
        `  ${indicator} ${chalk.white(dir)} ${chalk.gray(`(${s.messageCount} msgs, ${lastActive})`)}`
      );
    }
    console.log();
  }

  // Recent logs
  const logs = getRecentLogs(3);
  if (logs.length > 0) {
    console.log(chalk.cyan("Recent hook activity:"));
    for (const log of logs) {
      // Parse and format the log line
      const match = log.match(/\[(.*?)\] (.*?): (.*)/);
      if (match) {
        const [, timestamp, hook, message] = match;
        const time = new Date(timestamp).toLocaleTimeString();
        console.log(`  ${chalk.gray(time)} ${chalk.yellow(hook)} ${message}`);
      }
    }
    console.log();
  }
}
