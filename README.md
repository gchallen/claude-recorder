# Claude Recorder

Records all Claude Code CLI activity for personal review and analytics. Captures prompts, responses, tool calls, and metadata in a searchable SQLite database.

## Requirements

- [Bun](https://bun.sh/) runtime
- Claude Code CLI

## Installation

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
         {
           "hooks": [
             {
               "type": "command",
               "command": "bun run ~/claude/recorder/src/hooks/session-start.ts"
             }
           ]
         }
       ],
       "SessionEnd": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "bun run ~/claude/recorder/src/hooks/session-end.ts"
             }
           ]
         }
       ]
     }
   }
   ```

3. (Optional) Import existing sessions:
   ```bash
   bun run src/import-all.ts
   ```

## Usage

```bash
# Check recorder status and active watchers
bun status

# List recent sessions
bun run src/index.ts list

# Show a session (by index, short ID, or full ID)
bun run src/index.ts show 0              # most recent
bun run src/index.ts show 505bfd04       # by short ID

# Search across all sessions
bun run src/index.ts search "your query"

# Export a session to markdown
bun run src/index.ts export 0 -o session.md

# View statistics
bun run src/index.ts stats

# Clean up stale watcher PID files
bun run src/index.ts cleanup
```

## Data Storage

- Database: `~/.claude-recorder/recorder.db`
- Watcher PID files: `~/.claude-recorder/run/`
- Hook logs: `~/.claude-recorder/logs/hooks.log`

## How It Works

1. Claude Code fires `SessionStart` hook → spawns background watcher
2. Watcher monitors `~/.claude/projects/<project>/<session>.jsonl` for changes
3. Parser extracts messages and tool calls, stores in SQLite with FTS5
4. Claude Code fires `SessionEnd` hook → watcher finalizes and exits
