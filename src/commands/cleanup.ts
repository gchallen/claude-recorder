import chalk from "chalk";
import { readdirSync, readFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const RUN_DIR = join(homedir(), ".claude-recorder", "run");

export function cleanupCommand(): void {
  if (!existsSync(RUN_DIR)) {
    console.log(chalk.gray("No run directory found, nothing to clean up."));
    return;
  }

  const files = readdirSync(RUN_DIR).filter((f) => f.endsWith(".pid"));

  if (files.length === 0) {
    console.log(chalk.gray("No PID files found, nothing to clean up."));
    return;
  }

  let cleaned = 0;
  let active = 0;

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
      console.log(
        `  ${chalk.green("●")} ${sessionId.slice(0, 8)} ${chalk.gray(`(PID ${pid}) - active, keeping`)}`
      );
      active++;
    } else {
      unlinkSync(pidFile);
      console.log(
        `  ${chalk.red("○")} ${sessionId.slice(0, 8)} ${chalk.gray(`(PID ${pid}) - stale, removed`)}`
      );
      cleaned++;
    }
  }

  console.log();
  if (cleaned > 0) {
    console.log(chalk.green(`Cleaned up ${cleaned} stale PID file(s).`));
  }
  if (active > 0) {
    console.log(chalk.gray(`${active} active watcher(s) still running.`));
  }
}
