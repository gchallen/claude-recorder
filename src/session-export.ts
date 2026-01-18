import { existsSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { getSession, getSessionMessages } from "./storage.js";
import { getSessionExportConfig } from "./config.js";
import type { Session, ParsedMessage } from "./types.js";

const SESSIONS_DIR = join(homedir(), ".claude-recorder", "run", "sessions");

/**
 * Format a session and its messages as Markdown
 */
export function formatMarkdown(
  session: Session,
  messages: ParsedMessage[]
): string {
  const lines: string[] = [];

  lines.push(`# ${session.slug}`);
  lines.push("");
  lines.push(`- **Session ID:** ${session.id}`);
  lines.push(`- **Started:** ${session.startTime.toLocaleString()}`);
  if (session.endTime) {
    lines.push(`- **Ended:** ${session.endTime.toLocaleString()}`);
  }
  lines.push(`- **Directory:** ${session.workingDir}`);
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

/**
 * Format a filename using pattern substitution
 * Supports: {date}, {datetime}, {slug}, {sessionId}, {shortId}
 */
export function formatFileName(pattern: string, session: Session): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const datetime = now.toISOString().slice(0, 19).replace(/[T:]/g, "-"); // YYYY-MM-DD-HH-MM-SS
  const slug = session.slug.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
  const shortId = session.id.slice(0, 8);

  return pattern
    .replace(/{date}/g, date)
    .replace(/{datetime}/g, datetime)
    .replace(/{slug}/g, slug)
    .replace(/{sessionId}/g, session.id)
    .replace(/{shortId}/g, shortId);
}

/**
 * Find the active session for a given project directory
 * Looks up registered sessions and matches by working directory
 */
export function getActiveSessionForProject(
  projectDir: string
): string | null {
  if (!existsSync(SESSIONS_DIR)) {
    return null;
  }

  const files = Bun.spawnSync(["ls", SESSIONS_DIR]).stdout.toString().trim().split("\n").filter(Boolean);

  for (const sessionId of files) {
    const sessionFile = join(SESSIONS_DIR, sessionId);
    try {
      const transcriptPath = readFileSync(sessionFile, "utf-8").trim();
      // The project path is the parent of the transcript file
      const sessionProjectPath = dirname(transcriptPath);

      // Also check working directory from the session data
      const session = getSession(sessionId);
      if (session) {
        // Match by working directory (normalized)
        const normalizedProjectDir = projectDir.replace(/\/$/, "");
        const normalizedWorkingDir = session.workingDir.replace(/\/$/, "");

        if (normalizedWorkingDir === normalizedProjectDir) {
          return sessionId;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Export a session to the project directory
 * Returns the path to the created file, or null if export is disabled/failed
 */
export function exportSessionToProject(
  sessionId: string,
  projectDir: string
): string | null {
  const exportConfig = getSessionExportConfig(projectDir);

  if (!exportConfig || !exportConfig.enabled) {
    return null;
  }

  const session = getSession(sessionId);
  if (!session) {
    return null;
  }

  const messages = getSessionMessages(sessionId);

  // Create output directory
  const outputDir = join(projectDir, exportConfig.outputDir);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Format filename
  const fileName = formatFileName(exportConfig.fileNamePattern, session) + ".md";
  const outputPath = join(outputDir, fileName);

  // Generate markdown
  const markdown = formatMarkdown(session, messages);

  // Write file
  Bun.write(outputPath, markdown);

  return outputPath;
}

/**
 * Export the current active session for a project directory
 * Convenience function that combines finding and exporting
 */
export function exportActiveSessionToProject(
  projectDir: string
): { sessionId: string; outputPath: string } | null {
  const sessionId = getActiveSessionForProject(projectDir);
  if (!sessionId) {
    return null;
  }

  const outputPath = exportSessionToProject(sessionId, projectDir);
  if (!outputPath) {
    return null;
  }

  return { sessionId, outputPath };
}
