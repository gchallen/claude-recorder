import chalk from "chalk";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getStats, listRecentlyActiveSessions } from "../storage.js";
import { getDaemonPid, getRegisteredSessions } from "../watcher.js";

const LOG_FILE = join(homedir(), ".claude-recorder", "logs", "hooks.log");
const SESSIONS_DIR = join(homedir(), ".claude-recorder", "run", "sessions");

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

function getSessionTranscriptPaths(): Map<string, string> {
  const paths = new Map<string, string>();
  if (!existsSync(SESSIONS_DIR)) return paths;

  const files = readdirSync(SESSIONS_DIR);
  for (const file of files) {
    try {
      const transcriptPath = readFileSync(join(SESSIONS_DIR, file), "utf-8").trim();
      paths.set(file, transcriptPath);
    } catch {
      // Ignore read errors
    }
  }
  return paths;
}

export function statusCommand(): void {
  console.log(chalk.bold("\nClaude Recorder Status\n"));

  // Check daemon
  const daemonPid = getDaemonPid();
  const registeredSessions = getRegisteredSessions();

  console.log(chalk.cyan("Daemon:"));
  if (daemonPid) {
    console.log(`  ${chalk.green("●")} Running ${chalk.gray(`(PID ${daemonPid})`)}`);
    console.log(`  ${chalk.white(registeredSessions.length)} active session(s)`);
  } else {
    console.log(`  ${chalk.gray("○")} Not running`);
  }
  console.log();

  // Show active sessions being watched
  if (registeredSessions.length > 0) {
    const transcriptPaths = getSessionTranscriptPaths();
    console.log(chalk.cyan("Active sessions:"));
    for (const sessionId of registeredSessions) {
      const transcriptPath = transcriptPaths.get(sessionId);
      if (transcriptPath) {
        // Extract working dir from transcript path
        // Path format: ~/.claude/projects/-Users-foo-bar/<session>.jsonl
        // We want to show: ~/foo/bar
        const home = homedir();
        let projectDir = transcriptPath
          .replace(/\/[^/]+\.jsonl$/, "") // Remove filename
          .replace(/^.*\/\.claude\/projects\//, "") // Remove .claude/projects prefix
          .replace(/^-/, "") // Remove leading dash
          .replace(/-/g, "/"); // Convert dashes to slashes
        // Replace home directory with ~
        if (projectDir.startsWith(home.slice(1))) {
          projectDir = "~" + projectDir.slice(home.length - 1);
        }
        console.log(`  ${chalk.green("●")} ${sessionId.slice(0, 8)} ${chalk.gray(projectDir)}`);
      } else {
        console.log(`  ${chalk.green("●")} ${sessionId.slice(0, 8)}`);
      }
    }
    console.log();
  }

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
      const active = registeredSessions.includes(s.id);
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
