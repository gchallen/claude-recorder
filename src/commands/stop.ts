import chalk from "chalk";
import { stopDaemon, getDaemonPid, getRegisteredSessions } from "../watcher.js";

export function stopCommand(): void {
  const pid = getDaemonPid();

  if (!pid) {
    console.log(chalk.gray("Daemon is not running."));
    return;
  }

  const sessions = getRegisteredSessions();
  console.log(
    `Stopping daemon (PID ${pid}) watching ${sessions.length} session(s)...`
  );

  const stopped = stopDaemon();
  if (stopped) {
    console.log(chalk.green("Daemon stopped."));
  } else {
    console.log(chalk.red("Failed to stop daemon."));
  }
}
