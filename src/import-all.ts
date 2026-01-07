#!/usr/bin/env bun
/**
 * Import all existing transcripts from ~/.claude/projects/
 */

import { readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { parseTranscriptFile } from "./parser.js";
import { upsertSession, insertMessage, getDatabase, getSession } from "./storage.js";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

function importTranscript(transcriptPath: string): { imported: number; skipped: boolean } {
  try {
    const messages = parseTranscriptFile(transcriptPath);

    if (messages.length === 0) {
      return { imported: 0, skipped: true };
    }

    const first = messages[0];

    // Check if already imported
    const existing = getSession(first.sessionId);
    if (existing) {
      return { imported: 0, skipped: true };
    }

    // Extract project name from path
    const pathParts = transcriptPath.split("/");
    const projectDir = pathParts[pathParts.length - 2];
    const slug = projectDir
      .replace(/^-Users-[^-]+-/, "")
      .replace(/-/g, "/");

    // Get timestamps
    const timestamps = messages.map(m => m.timestamp);
    const startTime = new Date(Math.min(...timestamps.map(t => t.getTime())));
    const endTime = new Date(Math.max(...timestamps.map(t => t.getTime())));

    // Insert session
    upsertSession(
      first.sessionId,
      slug,
      join(PROJECTS_DIR, projectDir),
      first.cwd,
      startTime,
      "imported",
      transcriptPath
    );

    // Insert messages
    for (const msg of messages) {
      insertMessage(msg);
    }

    return { imported: messages.length, skipped: false };
  } catch (err) {
    console.error(`Error importing ${transcriptPath}:`, err);
    return { imported: 0, skipped: true };
  }
}

// Initialize database
getDatabase();

// Find all transcript files
const projectDirs = readdirSync(PROJECTS_DIR);
let totalImported = 0;
let totalSessions = 0;
let skippedSessions = 0;

for (const projectDir of projectDirs) {
  const projectPath = join(PROJECTS_DIR, projectDir);

  if (!statSync(projectPath).isDirectory()) continue;

  const files = readdirSync(projectPath);

  for (const file of files) {
    // Skip agent transcripts, only import main session transcripts
    if (!file.endsWith(".jsonl") || file.startsWith("agent-")) continue;

    const transcriptPath = join(projectPath, file);
    const result = importTranscript(transcriptPath);

    if (result.skipped) {
      skippedSessions++;
    } else {
      totalSessions++;
      totalImported += result.imported;
      console.log(`Imported: ${projectDir}/${file} (${result.imported} messages)`);
    }
  }
}

console.log(`\nDone!`);
console.log(`  Imported: ${totalSessions} sessions, ${totalImported} messages`);
console.log(`  Skipped: ${skippedSessions} (already imported or empty)`);
