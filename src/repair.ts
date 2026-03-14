import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { getDatabase, upsertSession } from "./storage.js";
import type { TranscriptEntry } from "./types.js";

interface RepairResult {
  orphanCount: number;
  repaired: number;
  notRecoverable: number;
}

/**
 * Check if there are any orphaned sessions (messages without session rows).
 */
export function countOrphanedSessions(): number {
  const db = getDatabase();
  const result = db
    .query<{ count: number }, []>(
      `SELECT COUNT(DISTINCT m.session_id) as count
       FROM messages m
       LEFT JOIN sessions s ON m.session_id = s.id
       WHERE s.id IS NULL`
    )
    .get();
  return result?.count ?? 0;
}

/**
 * Find and repair orphaned sessions by locating their transcript files
 * and recreating missing session rows.
 */
export function repairOrphanedSessions(logger?: (msg: string) => void): RepairResult {
  const log = logger ?? (() => {});
  const db = getDatabase();

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
    return { orphanCount: 0, repaired: 0, notRecoverable: 0 };
  }

  // Build a map of session ID → transcript path by scanning ~/.claude/projects/
  const projectsDir = join(homedir(), ".claude", "projects");
  const transcriptMap = new Map<string, string>();

  if (existsSync(projectsDir)) {
    for (const projectDir of readdirSync(projectsDir)) {
      const projectPath = join(projectsDir, projectDir);
      if (!statSync(projectPath).isDirectory()) continue;

      for (const file of readdirSync(projectPath)) {
        if (!file.endsWith(".jsonl") || file.startsWith("agent-")) continue;
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
  let notRecoverable = 0;

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
        log(`Repaired (from messages): ${orphan.session_id.slice(0, 8)}... (${orphan.msg_count} messages)`);
      } else {
        notRecoverable++;
        log(`Not recoverable: ${orphan.session_id.slice(0, 8)}... (${orphan.msg_count} messages)`);
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
      log(`Repaired: ${orphan.session_id.slice(0, 8)}... → ${metadata.slug} (${orphan.msg_count} messages)`);
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
        log(`Repaired (partial): ${orphan.session_id.slice(0, 8)}... (${orphan.msg_count} messages)`);
      }
    }
  }

  // Update message counts for repaired sessions
  db.run(`
    UPDATE sessions SET message_count = (
      SELECT COUNT(*) FROM messages WHERE messages.session_id = sessions.id
    )
    WHERE message_count = 0 OR message_count IS NULL
  `);

  return { orphanCount: orphans.length, repaired, notRecoverable };
}
