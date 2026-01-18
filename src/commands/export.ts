import { getSession, getSessionMessages, listSessions } from "../storage.js";
import { formatMarkdown } from "../session-export.js";

export function exportCommand(
  sessionIdOrIndex: string,
  options: { format?: string; output?: string }
): void {
  let sessionId = sessionIdOrIndex;

  // Handle numeric index
  if (/^\d+$/.test(sessionIdOrIndex)) {
    const index = parseInt(sessionIdOrIndex);
    const sessions = listSessions(index + 1);
    if (index >= sessions.length) {
      console.error(`Session index ${index} not found`);
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
    console.error(`Session not found: ${sessionIdOrIndex}`);
    process.exit(1);
  }

  const messages = getSessionMessages(sessionId);
  const format = options.format ?? "md";

  let output: string;

  if (format === "json") {
    output = JSON.stringify({ session, messages }, null, 2);
  } else {
    output = formatMarkdown(session, messages);
  }

  if (options.output) {
    Bun.write(options.output, output);
    console.log(`Exported to ${options.output}`);
  } else {
    console.log(output);
  }
}
