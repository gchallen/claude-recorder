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

  // A compiled binary can't run its bundled sources with bun, so re-invoke
  // the binary itself with the hidden "daemon" command instead.
  const isCompiled = import.meta.path.startsWith("/$bunfs/");
  const child = isCompiled
    ? spawn(process.execPath, ["daemon"], { detached: true, stdio: "ignore" })
    : spawn("bun", ["run", join(RECORDER_DIR, "src", "watcher.ts")], {
        detached: true,
        stdio: "ignore",
        cwd: RECORDER_DIR,
      });

  child.unref();
  console.log(chalk.green(`Daemon started (PID ${child.pid})`));
}
