import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { getDatabase, upsertSession, getSession } from "../storage.js";
import type { TranscriptEntry } from "../types.js";

export function repairCommand(): void {
  const db = getDatabase();

  // Find all orphaned session IDs (messages without session rows)
  const orphans = db
    .query<{ session_id: string; msg_count: number }, []>(
      `SELECT m.session_id, COUNT(*) as msg_count
       FROM messages m
       LEFT JOIN sessions s ON m.session_id = s.id
       WHERE s.id IS NULL
       GROUP BY m.session_id`
    )
    .all();

  if (orphans.length === 0) {
    console.log("No orphaned sessions found.");
    return;
  }

  console.log(`Found ${orphans.length} orphaned session(s). Searching for transcript files...`);

  // Build a map of session ID → transcript path by scanning ~/.claude/projects/
  const projectsDir = join(homedir(), ".claude", "projects");
  const transcriptMap = new Map<string, string>();

  if (existsSync(projectsDir)) {
    for (const projectDir of readdirSync(projectsDir)) {
      const projectPath = join(projectsDir, projectDir);
      if (!statSync(projectPath).isDirectory()) continue;

      for (const file of readdirSync(projectPath)) {
        if (!file.endsWith(".jsonl") || file.startsWith("agent-")) continue;

        // The filename is the session ID (without .jsonl)
        const sessionId = file.replace(".jsonl", "");
        transcriptMap.set(sessionId, join(projectPath, file));
      }
    }
  }

  // Also check file_positions table for transcript paths
  const filePositions = db
    .query<{ transcript_path: string }, []>(
      `SELECT transcript_path FROM file_positions`
    )
    .all();

  for (const fp of filePositions) {
    if (existsSync(fp.transcript_path)) {
      const filename = fp.transcript_path.split("/").pop() ?? "";
      const sessionId = filename.replace(".jsonl", "");
      transcriptMap.set(sessionId, fp.transcript_path);
    }
  }

  let repaired = 0;
  let notFound = 0;

  for (const orphan of orphans) {
    const transcriptPath = transcriptMap.get(orphan.session_id);

    if (!transcriptPath || !existsSync(transcriptPath)) {
      // Try to create a minimal session row from the messages themselves
      const firstMsg = db
        .query<{ timestamp: string; cwd: string }, [string]>(
          `SELECT timestamp, cwd FROM messages WHERE session_id = ? ORDER BY timestamp ASC LIMIT 1`
        )
        .get(orphan.session_id);

      if (firstMsg) {
        upsertSession(
          orphan.session_id,
          "recovered",
          "unknown",
          firstMsg.cwd || "unknown",
          new Date(firstMsg.timestamp),
          "repaired",
          ""
        );
        repaired++;
        console.log(
          `  Repaired (from messages): ${orphan.session_id.slice(0, 8)}... (${orphan.msg_count} messages)`
        );
      } else {
        notFound++;
        console.log(
          `  Not found: ${orphan.session_id.slice(0, 8)}... (${orphan.msg_count} messages)`
        );
      }
      continue;
    }

    // Parse transcript to get proper metadata
    const content = readFileSync(transcriptPath, "utf-8");
    const lines = content.trim().split("\n");

    let metadata: {
      slug: string;
      projectPath: string;
      workingDir: string;
      version: string;
      startTime: Date;
    } | null = null;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as TranscriptEntry;
        if (entry.type === "user" || entry.type === "assistant") {
          const projectPath = dirname(transcriptPath);
          metadata = {
            slug: entry.slug || projectPath.split("/").pop()?.replace(/^-Users-[^-]+-/, "").replace(/-/g, "/") || "unknown",
            projectPath,
            workingDir: entry.cwd,
            version: entry.version,
            startTime: new Date(entry.timestamp),
          };
          break;
        }
      } catch {
        continue;
      }
    }

    if (metadata) {
      upsertSession(
        orphan.session_id,
        metadata.slug,
        metadata.projectPath,
        metadata.workingDir,
        metadata.startTime,
        metadata.version,
        transcriptPath
      );
      repaired++;
      console.log(
        `  Repaired: ${orphan.session_id.slice(0, 8)}... → ${metadata.slug} (${orphan.msg_count} messages)`
      );
    } else {
      // Fallback: create from messages
      const firstMsg = db
        .query<{ timestamp: string; cwd: string }, [string]>(
          `SELECT timestamp, cwd FROM messages WHERE session_id = ? ORDER BY timestamp ASC LIMIT 1`
        )
        .get(orphan.session_id);

      if (firstMsg) {
        upsertSession(
          orphan.session_id,
          "recovered",
          dirname(transcriptPath),
          firstMsg.cwd || "unknown",
          new Date(firstMsg.timestamp),
          "repaired",
          transcriptPath
        );
        repaired++;
        console.log(
          `  Repaired (partial): ${orphan.session_id.slice(0, 8)}... (${orphan.msg_count} messages)`
        );
      }
    }
  }

  console.log(`\nDone! Repaired ${repaired} session(s), ${notFound} not recoverable.`);

  // Update message counts for repaired sessions
  db.run(`
    UPDATE sessions SET message_count = (
      SELECT COUNT(*) FROM messages WHERE messages.session_id = sessions.id
    )
    WHERE message_count = 0 OR message_count IS NULL
  `);
}
