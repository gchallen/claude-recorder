import chalk from "chalk";
import { readdirSync, readFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const RUN_DIR = join(homedir(), ".claude-recorder", "run");

export function stopCommand(): void {
  if (!existsSync(RUN_DIR)) {
    console.log(chalk.gray("No watchers running."));
    return;
  }

  const files = readdirSync(RUN_DIR).filter((f) => f.endsWith(".pid"));

  if (files.length === 0) {
    console.log(chalk.gray("No watchers running."));
    return;
  }

  let stopped = 0;
  let cleaned = 0;

  for (const file of files) {
    const sessionId = file.replace(".pid", "");
    const pidFile = join(RUN_DIR, file);
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim());

    let running = false;
    try {
      process.kill(pid, 0);
      running = true;
    } catch {
      running = false;
    }

    if (running) {
      try {
        process.kill(pid, "SIGTERM");
        console.log(
          `  ${chalk.red("●")} ${sessionId.slice(0, 8)} ${chalk.gray(`(PID ${pid}) - stopped`)}`
        );
        stopped++;
      } catch (err) {
        console.log(
          `  ${chalk.yellow("●")} ${sessionId.slice(0, 8)} ${chalk.gray(`(PID ${pid}) - failed to stop: ${err}`)}`
        );
      }
    } else {
      // Clean up stale PID file
      unlinkSync(pidFile);
      console.log(
        `  ${chalk.gray("○")} ${sessionId.slice(0, 8)} ${chalk.gray(`(stale PID file removed)`)}`
      );
      cleaned++;
    }
  }

  console.log();
  if (stopped > 0) {
    console.log(chalk.green(`Stopped ${stopped} watcher(s).`));
  }
  if (cleaned > 0) {
    console.log(chalk.gray(`Cleaned up ${cleaned} stale PID file(s).`));
  }
  if (stopped === 0 && cleaned === 0) {
    console.log(chalk.gray("No watchers to stop."));
  }
}
