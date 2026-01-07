import chalk from "chalk";
import { searchMessages, getSession } from "../storage.js";

export function searchCommand(
  query: string,
  options: { limit?: number }
): void {
  const limit = options.limit ?? 20;
  const results = searchMessages(query, limit);

  if (results.length === 0) {
    console.log(chalk.yellow(`No results found for: ${query}`));
    return;
  }

  console.log(chalk.bold(`\nSearch results for "${query}" (${results.length}):\n`));

  const sessionCache = new Map<string, ReturnType<typeof getSession>>();

  for (const result of results) {
    let session = sessionCache.get(result.sessionId);
    if (!session) {
      session = getSession(result.sessionId);
      sessionCache.set(result.sessionId, session);
    }

    const roleColor =
      result.message.role === "user" ? chalk.green : chalk.blue;
    const date = result.message.timestamp.toLocaleDateString();
    const time = result.message.timestamp.toLocaleTimeString();

    console.log(
      `${chalk.cyan(result.sessionId.slice(0, 8))} ${chalk.white(session?.slug ?? "unknown")} ${roleColor(result.message.role)}`
    );
    console.log(`  ${chalk.gray(date)} ${chalk.gray(time)}`);
    console.log(`  ${highlightSnippet(result.snippet)}`);
    console.log();
  }
}

function highlightSnippet(snippet: string): string {
  // The FTS snippet uses >>> and <<< as markers
  return snippet
    .replace(/>>>/g, chalk.bgYellow.black(""))
    .replace(/<<</g, chalk.reset(""))
    .replace(/\n/g, " ");
}
