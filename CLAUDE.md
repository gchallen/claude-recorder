# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Recorder captures all Claude Code CLI activity by hooking into SessionStart/SessionEnd events, running a background watcher that monitors transcript JSONL files, and storing parsed data in SQLite for search and analytics.

## Commands

### Development Mode (via Bun)

```bash
bun start               # Start the watcher daemon
bun stop                # Stop the watcher daemon
bun status              # Check daemon status and quick stats
bun cli <command>       # Run CLI commands (see below)
bun run import <path>   # Import a single transcript file
bun run src/import-all.ts  # Import all existing sessions

bun test                # Run all tests
bun test src/parser.test.ts  # Run a single test file
```

### Standalone Binary

After building (`bun run build:local`) and installing (`./dist/recorder install`):

```bash
record-claude status              # Check daemon status
record-claude list [-l <limit>]   # List recent sessions
record-claude show <session>      # Show session (by ID, short ID, or index)
record-claude search <query>      # Full-text search across sessions
record-claude export <session>    # Export session to markdown or JSON
record-claude stats               # Show recording statistics
record-claude install             # Install binary and configure hooks
record-claude uninstall [--all]   # Remove hooks and optionally data
```

### CLI Commands

```bash
record-claude list [-l <limit>]              # List recent sessions
record-claude show <session> [-t] [--thinking]  # Show session (by ID, short ID, or index 0=most recent)
record-claude search <query> [-l <limit>]    # Full-text search across sessions
record-claude export <session> [-f md|json] [-o file]  # Export session
record-claude stats                          # Show recording statistics
record-claude cleanup                        # Remove stale PID files
record-claude install-hook                   # Install pre-commit hook for auto-export
record-claude uninstall-hook                 # Remove pre-commit hook
record-claude hook session-start             # Handle SessionStart hook (internal)
record-claude hook session-end               # Handle SessionEnd hook (internal)
record-claude install                        # Install binary and configure Claude Code hooks
record-claude uninstall [--all]              # Remove hooks and optionally delete data
```

## Architecture

**Data Flow:**
1. Claude Code fires `SessionStart` hook → registers session, starts daemon if not running
2. Single daemon monitors all active sessions in `~/.claude/projects/<project>/<session>.jsonl`
3. Parser extracts messages/tool calls from JSONL, stores in SQLite
4. Claude Code fires `SessionEnd` hook → unregisters session, daemon finalizes it

**Key Components:**
- `src/hooks/` - Hook scripts for development mode (receive JSON via stdin with `session_id`, `transcript_path`)
- `src/commands/hook.ts` - Hook handlers for standalone binary mode
- `src/commands/install.ts` - Install command: copies binary to `~/.local/bin`, configures PATH, sets up Claude Code hooks
- `src/commands/uninstall.ts` - Uninstall command: removes hooks, binary, and optionally data
- `src/watcher.ts` - Single daemon process that monitors all transcript files, uses `~/.claude-recorder/run/watcher.pid` and session registration in `~/.claude-recorder/run/sessions/`
- `src/parser.ts` - Parses Claude Code's JSONL transcript format (handles user messages, assistant content blocks, tool calls)
- `src/storage.ts` - SQLite layer with FTS5 full-text search, stores in `~/.claude-recorder/recorder.db`
- `src/commands/` - CLI commands (list, show, search, export, stats, status, install-hook, hook, install, uninstall)
- `src/config.ts` - Project configuration loading from `.claude-recorder.json`
- `src/session-export.ts` - Shared markdown formatting and session export to project directories
- `src/skills/` - Slash command implementations (save-session)

**Transcript Format:** Each JSONL line has `type` (user/assistant), `uuid`, `sessionId`, `timestamp`, `message.content` (string for user, ContentBlock[] for assistant with text/thinking/tool_use/tool_result blocks).

**Database Schema:** Three main tables in SQLite:
- `sessions` - Session metadata (id, slug, project_path, working_dir, timestamps, transcript_path)
- `messages` - Parsed messages (uuid, session_id, role, text_content, thinking_content, model)
- `tool_calls` - Tool invocations (tool_id, message_uuid, name, input, output)
- `messages_fts` - FTS5 virtual table for full-text search on message content

## Configuration

### Claude Code Hooks

For standalone binary (configured by `record-claude install`):
```json
{
  "hooks": {
    "SessionStart": [
      { "command": "~/.local/bin/record-claude hook session-start", "timeout": 5000 }
    ],
    "SessionEnd": [
      { "command": "~/.local/bin/record-claude hook session-end", "timeout": 5000 }
    ]
  }
}
```

For development mode (manual configuration):
```json
{
  "hooks": {
    "SessionStart": [
      { "command": "bun run ~/claude/recorder/src/hooks/session-start.ts" }
    ],
    "SessionEnd": [
      { "command": "bun run ~/claude/recorder/src/hooks/session-end.ts" }
    ]
  }
}
```

The watcher stores PID files and logs in `~/.claude-recorder/`.

### Project Session Export

To auto-export sessions to a project directory, create `.claude-recorder.json` in the project root:

```json
{
  "sessionExport": {
    "enabled": true,
    "outputDir": ".claude-sessions",
    "fileNamePattern": "{datetime}-{slug}"
  }
}
```

**Pattern variables:** `{date}`, `{datetime}`, `{slug}`, `{sessionId}`, `{shortId}`

**Export triggers:**
- **Pre-commit hook:** Run `record-claude install-hook` to auto-export before each git commit
- **Skill command:** Use `/save-session` in Claude Code to manually export the current session

## Building

```bash
bun run build:local    # Build standalone binary to dist/recorder
bun run build          # Build multi-platform binaries (via scripts/build.ts)
```

## Git Workflow

- Do not push to remote without explicit permission from the user.
