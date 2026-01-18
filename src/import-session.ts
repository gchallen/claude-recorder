#!/usr/bin/env bun
/**
 * Import an existing transcript into the recorder database.
 * Usage: bun run import-session.ts <transcript_path>
 */

import { parseTranscriptFile } from "./parser.js";
import { upsertSession, insertMessage, getDatabase } from "./storage.js";
import { dirname, basename } from "path";

const transcriptPath = process.argv[2];

if (!transcriptPath) {
  console.error("Usage: bun run import-session.ts <transcript_path>");
  process.exit(1);
}

// Initialize database
getDatabase();

// Parse the transcript
console.log("Parsing transcript:", transcriptPath);
const messages = parseTranscriptFile(transcriptPath);

console.log("Parsed", messages.length, "messages");

if (messages.length > 0) {
  const first = messages[0];
  console.log("Session ID:", first.sessionId);
  console.log("First message role:", first.role);
  console.log("First message preview:", first.textContent.slice(0, 100) + "...");

  // Get slug from session ID or directory
  const projectDir = dirname(transcriptPath);
  // Claude encodes paths like "-Users-username-projects-foo", extract meaningful part
  const slug = basename(projectDir).replace(/^-Users-[^-]+-/, "").replace(/-/g, "/");

  // Insert session
  upsertSession(
    first.sessionId,
    slug,
    projectDir,
    first.cwd,
    first.timestamp,
    "2.0.76",
    transcriptPath
  );

  // Insert messages
  let count = 0;
  for (const msg of messages) {
    insertMessage(msg);
    count++;
  }

  console.log("Imported", count, "messages successfully!");
}
