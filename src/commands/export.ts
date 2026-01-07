import { getSession, getSessionMessages, listSessions } from "../storage.js";

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

function formatMarkdown(
  session: ReturnType<typeof getSession>,
  messages: ReturnType<typeof getSessionMessages>
): string {
  const lines: string[] = [];

  lines.push(`# ${session!.slug}`);
  lines.push("");
  lines.push(`- **Session ID:** ${session!.id}`);
  lines.push(`- **Started:** ${session!.startTime.toLocaleString()}`);
  if (session!.endTime) {
    lines.push(`- **Ended:** ${session!.endTime.toLocaleString()}`);
  }
  lines.push(`- **Directory:** ${session!.workingDir}`);
  lines.push(`- **Messages:** ${messages.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const message of messages) {
    const roleLabel = message.role === "user" ? "**You**" : "**Claude**";
    const time = message.timestamp.toLocaleTimeString();

    lines.push(`### ${roleLabel} (${time})`);
    lines.push("");

    if (message.textContent) {
      lines.push(message.textContent);
      lines.push("");
    }

    if (message.toolCalls.length > 0) {
      for (const tool of message.toolCalls) {
        lines.push(`<details>`);
        lines.push(`<summary>Tool: ${tool.name}</summary>`);
        lines.push("");
        lines.push("**Input:**");
        lines.push("```json");
        lines.push(tool.input);
        lines.push("```");
        if (tool.output) {
          lines.push("");
          lines.push("**Output:**");
          lines.push("```");
          lines.push(tool.output.slice(0, 1000));
          if (tool.output.length > 1000) {
            lines.push("... (truncated)");
          }
          lines.push("```");
        }
        lines.push("</details>");
        lines.push("");
      }
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}
