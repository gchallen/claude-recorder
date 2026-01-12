import { spawn } from "child_process";
import { dirname, join } from "path";
import chalk from "chalk";
import { isDaemonRunning, getDaemonPid } from "../watcher.js";

const RECORDER_DIR = dirname(dirname(dirname(import.meta.path)));

export function startCommand(): void {
  if (isDaemonRunning()) {
    const pid = getDaemonPid();
    console.log(chalk.yellow(`Daemon already running (PID ${pid})`));
    return;
  }

  const watcherPath = join(RECORDER_DIR, "src", "watcher.ts");

  const child = spawn("bun", ["run", watcherPath], {
    detached: true,
    stdio: "ignore",
    cwd: RECORDER_DIR,
  });

  child.unref();
  console.log(chalk.green(`Daemon started (PID ${child.pid})`));
}
