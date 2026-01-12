# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Recorder captures all Claude Code CLI activity by hooking into SessionStart/SessionEnd events, running a background watcher that monitors transcript JSONL files, and storing parsed data in SQLite for search and analytics.

## Commands

```bash
bun start               # Start the watcher daemon
bun stop                # Stop the watcher daemon
bun status              # Check daemon status and quick stats
bun cli <command>       # Run CLI (list, show, search, export, stats)
bun run import <path>   # Import a single transcript file
bun test                # Run tests
```

## Architecture

**Data Flow:**
1. Claude Code fires `SessionStart` hook → registers session, starts daemon if not running
2. Single daemon monitors all active sessions in `~/.claude/projects/<project>/<session>.jsonl`
3. Parser extracts messages/tool calls from JSONL, stores in SQLite
4. Claude Code fires `SessionEnd` hook → unregisters session, daemon finalizes it

**Key Components:**
- `src/hooks/` - Hook scripts invoked by Claude Code (receive JSON via stdin with `session_id`, `transcript_path`)
- `src/watcher.ts` - Single daemon process that monitors all transcript files, uses `~/.claude-recorder/run/watcher.pid` and session registration in `~/.claude-recorder/run/sessions/`
- `src/parser.ts` - Parses Claude Code's JSONL transcript format (handles user messages, assistant content blocks, tool calls)
- `src/storage.ts` - SQLite layer with FTS5 full-text search, stores in `~/.claude-recorder/recorder.db`
- `src/commands/` - CLI commands (list, show, search, export, stats, status)

**Transcript Format:** Each JSONL line has `type` (user/assistant), `uuid`, `sessionId`, `timestamp`, `message.content` (string for user, ContentBlock[] for assistant with text/thinking/tool_use/tool_result blocks).

## Configuration

Hooks are configured in `~/.claude/settings.json` under the `hooks` key. The watcher stores PID files and logs in `~/.claude-recorder/`.

## Git Workflow

- Do not push to remote without explicit permission from the user.
