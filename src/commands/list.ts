import chalk from "chalk";
import { listSessions } from "../storage.js";

export function listCommand(options: { limit?: number }): void {
  const limit = options.limit ?? 20;
  const sessions = listSessions(limit);

  if (sessions.length === 0) {
    console.log(chalk.yellow("No sessions recorded yet."));
    return;
  }

  console.log(chalk.bold(`\nRecorded Sessions (${sessions.length}):\n`));

  for (const session of sessions) {
    const status = session.endTime
      ? chalk.gray("ended")
      : chalk.green("active");
    const date = session.startTime.toLocaleDateString();
    const time = session.startTime.toLocaleTimeString();

    console.log(
      `${chalk.cyan(session.id.slice(0, 8))} ${chalk.white(session.slug)} ${status}`
    );
    console.log(
      `  ${chalk.gray(date)} ${chalk.gray(time)} · ${session.messageCount} messages`
    );
    console.log(`  ${chalk.gray(session.workingDir)}`);
    console.log();
  }
}
