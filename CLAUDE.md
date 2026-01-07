# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Recorder captures all Claude Code CLI activity by hooking into SessionStart/SessionEnd events, running a background watcher that monitors transcript JSONL files, and storing parsed data in SQLite for search and analytics.

## Commands

```bash
bun status              # Check watcher status and quick stats
bun start <command>     # Run CLI (list, show, search, export, stats, status)
bun run import <path>   # Import a single transcript file
```

## Architecture

**Data Flow:**
1. Claude Code fires `SessionStart` hook → spawns background watcher process
2. Watcher monitors `~/.claude/projects/<project>/<session>.jsonl` for changes
3. Parser extracts messages/tool calls from JSONL, stores in SQLite
4. Claude Code fires `SessionEnd` hook → signals watcher to finalize and exit

**Key Components:**
- `src/hooks/` - Hook scripts invoked by Claude Code (receive JSON via stdin with `session_id`, `transcript_path`)
- `src/watcher.ts` - Background process that monitors transcript files, uses PID files in `~/.claude-recorder/run/`
- `src/parser.ts` - Parses Claude Code's JSONL transcript format (handles user messages, assistant content blocks, tool calls)
- `src/storage.ts` - SQLite layer with FTS5 full-text search, stores in `~/.claude-recorder/recorder.db`
- `src/commands/` - CLI commands (list, show, search, export, stats, status)

**Transcript Format:** Each JSONL line has `type` (user/assistant), `uuid`, `sessionId`, `timestamp`, `message.content` (string for user, ContentBlock[] for assistant with text/thinking/tool_use/tool_result blocks).

## Configuration

Hooks are configured in `~/.claude/settings.json` under the `hooks` key. The watcher stores PID files and logs in `~/.claude-recorder/`.
