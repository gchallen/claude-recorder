import chalk from "chalk";
import { getStats, listSessions } from "../storage.js";

export function statsCommand(): void {
  const stats = getStats();
  const recentSessions = listSessions(10);

  console.log(chalk.bold("\nClaude Code Recording Statistics\n"));

  console.log(chalk.cyan("Overview:"));
  console.log(`  Total sessions: ${chalk.white(stats.totalSessions)}`);
  console.log(`  Total messages: ${chalk.white(stats.totalMessages)}`);
  console.log(`  Total tool calls: ${chalk.white(stats.totalToolCalls)}`);
  console.log();

  if (stats.toolUsage.length > 0) {
    console.log(chalk.cyan("Most Used Tools:"));
    for (const tool of stats.toolUsage.slice(0, 10)) {
      const bar = "█".repeat(Math.min(20, Math.ceil(tool.count / 10)));
      console.log(`  ${chalk.yellow(tool.name.padEnd(20))} ${bar} ${tool.count}`);
    }
    console.log();
  }

  if (recentSessions.length > 0) {
    console.log(chalk.cyan("Recent Activity:"));

    // Group sessions by date
    const byDate = new Map<string, number>();
    for (const session of recentSessions) {
      const date = session.startTime.toLocaleDateString();
      byDate.set(date, (byDate.get(date) ?? 0) + 1);
    }

    for (const [date, count] of byDate) {
      console.log(`  ${chalk.gray(date)}: ${count} session${count > 1 ? "s" : ""}`);
    }
    console.log();
  }
}
