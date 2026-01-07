import chalk from "chalk";
import { getSession, getSessionMessages, listSessions } from "../storage.js";

export function showCommand(
  sessionIdOrIndex: string,
  options: { tools?: boolean; thinking?: boolean }
): void {
  let sessionId = sessionIdOrIndex;

  // Handle numeric index
  if (/^\d+$/.test(sessionIdOrIndex)) {
    const index = parseInt(sessionIdOrIndex);
    const sessions = listSessions(index + 1);
    if (index >= sessions.length) {
      console.error(chalk.red(`Session index ${index} not found`));
      process.exit(1);
    }
    sessionId = sessions[index].id;
  }

  // Handle short ID
  if (sessionId.length < 36) {
    const sessions = listSessions(100);
    const match = sessions.find((s) => s.id.startsWith(sessionId));
    if (match) {
      sessionId = match.id;
    }
  }

  const session = getSession(sessionId);
  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionIdOrIndex}`));
    process.exit(1);
  }

  const messages = getSessionMessages(sessionId);

  console.log(chalk.bold(`\nSession: ${session.slug}`));
  console.log(chalk.gray(`ID: ${session.id}`));
  console.log(chalk.gray(`Started: ${session.startTime.toLocaleString()}`));
  if (session.endTime) {
    console.log(chalk.gray(`Ended: ${session.endTime.toLocaleString()}`));
  }
  console.log(chalk.gray(`Directory: ${session.workingDir}`));
  console.log(chalk.gray(`Messages: ${messages.length}`));
  console.log();

  for (const message of messages) {
    const roleColor = message.role === "user" ? chalk.green : chalk.blue;
    const roleLabel = message.role === "user" ? "You" : "Claude";
    const time = message.timestamp.toLocaleTimeString();

    console.log(roleColor(`─── ${roleLabel} ─── ${chalk.gray(time)}`));

    if (options.thinking && message.thinkingContent) {
      console.log(chalk.gray.italic("\n[Thinking]"));
      console.log(chalk.gray(message.thinkingContent.slice(0, 500)));
      if (message.thinkingContent.length > 500) {
        console.log(chalk.gray("..."));
      }
      console.log();
    }

    if (message.textContent) {
      console.log(message.textContent);
    }

    if (options.tools && message.toolCalls.length > 0) {
      for (const tool of message.toolCalls) {
        console.log(chalk.yellow(`\n[Tool: ${tool.name}]`));
        console.log(chalk.gray("Input:"), tool.input.slice(0, 200));
        if (tool.input.length > 200) console.log(chalk.gray("..."));
        if (tool.output) {
          console.log(chalk.gray("Output:"), tool.output.slice(0, 200));
          if (tool.output.length > 200) console.log(chalk.gray("..."));
        }
      }
    }

    console.log();
  }
}
