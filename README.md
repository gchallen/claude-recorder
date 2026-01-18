# Claude Recorder

Records all Claude Code CLI activity for personal review and analytics. Captures prompts, responses, tool calls, and metadata in a searchable SQLite database.

## Requirements

- [Bun](https://bun.sh/) runtime (for building or development)
- Claude Code CLI

## Installation

### Standalone Binary (Recommended)

1. Clone and build the binary:
   ```bash
   git clone git@github.com:gchallen/claude-recorder.git ~/claude/recorder
   cd ~/claude/recorder
   bun install
   bun run build:local
   ```

2. Run the install command:
   ```bash
   ./dist/recorder install
   ```

   This will:
   - Copy the binary to `~/.local/bin/record-claude`
   - Add `~/.local/bin` to your PATH if needed
   - Configure Claude Code hooks in `~/.claude/settings.json`

3. Restart your terminal and Claude Code to activate recording.

### Development Mode

If you prefer to run from source:

1. Clone the repository:
   ```bash
   git clone git@github.com:gchallen/claude-recorder.git ~/claude/recorder
   cd ~/claude/recorder
   bun install
   ```

2. Add hooks to your Claude Code settings (`~/.claude/settings.json`):
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

### Import Existing Sessions

To import your existing Claude Code sessions:
```bash
bun run src/import-all.ts
```

## Usage

### With Standalone Binary

```bash
# Check recorder status
record-claude status

# List recent sessions
record-claude list

# Show a session (by index, short ID, or full ID)
record-claude show 0              # most recent
record-claude show 505bfd04       # by short ID

# Search across all sessions
record-claude search "your query"

# Export a session to markdown
record-claude export 0 -o session.md

# View statistics
record-claude stats

# Uninstall (removes hooks, optionally removes data)
record-claude uninstall
record-claude uninstall --all     # also removes recorded data
```

### With Bun (Development Mode)

```bash
bun status                              # Check daemon status
bun cli list                            # List sessions
bun cli show 0                          # Show most recent session
bun cli search "query"                  # Search sessions
bun cli export 0 -o session.md          # Export session
bun cli stats                           # View statistics
```

## Data Storage

- Database: `~/.claude-recorder/recorder.db`
- Watcher PID files: `~/.claude-recorder/run/`
- Hook logs: `~/.claude-recorder/logs/hooks.log`

## How It Works

1. Claude Code fires `SessionStart` hook → registers session, starts daemon if needed
2. Single daemon monitors all active sessions in `~/.claude/projects/<project>/<session>.jsonl`
3. Parser extracts messages and tool calls, stores in SQLite with FTS5
4. Claude Code fires `SessionEnd` hook → unregisters session, daemon finalizes it

## Uninstalling

To remove Claude Recorder:

```bash
record-claude uninstall        # Remove hooks and binary
record-claude uninstall --all  # Also remove all recorded data
```

Or manually:
1. Remove hooks from `~/.claude/settings.json`
2. Delete `~/.local/bin/record-claude`
3. Optionally delete `~/.claude-recorder/`
