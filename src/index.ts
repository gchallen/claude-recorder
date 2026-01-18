#!/usr/bin/env bun
import { Command } from "commander";
import { listCommand } from "./commands/list.js";
import { showCommand } from "./commands/show.js";
import { searchCommand } from "./commands/search.js";
import { exportCommand } from "./commands/export.js";
import { statsCommand } from "./commands/stats.js";
import { statusCommand } from "./commands/status.js";
import { cleanupCommand } from "./commands/cleanup.js";
import { stopCommand } from "./commands/stop.js";
import { startCommand } from "./commands/start.js";
import { installHookCommand, uninstallHookCommand } from "./commands/install-hook.js";

const program = new Command();

program
  .name("recorder")
  .description("Record and search Claude Code CLI activity")
  .version("2025.1.0");

program
  .command("list")
  .description("List recorded sessions")
  .option("-l, --limit <number>", "Number of sessions to show", "20")
  .action((options) => {
    listCommand({ limit: parseInt(options.limit) });
  });

program
  .command("show <session>")
  .description("Show a session's conversation (use ID, short ID, or index)")
  .option("-t, --tools", "Show tool calls", false)
  .option("--thinking", "Show thinking content", false)
  .action((session, options) => {
    showCommand(session, options);
  });

program
  .command("search <query>")
  .description("Search across all recorded sessions")
  .option("-l, --limit <number>", "Maximum results", "20")
  .action((query, options) => {
    searchCommand(query, { limit: parseInt(options.limit) });
  });

program
  .command("export <session>")
  .description("Export a session to markdown or JSON")
  .option("-f, --format <format>", "Output format (md or json)", "md")
  .option("-o, --output <file>", "Output file path")
  .action((session, options) => {
    exportCommand(session, options);
  });

program
  .command("stats")
  .description("Show recording statistics")
  .action(() => {
    statsCommand();
  });

program
  .command("status")
  .description("Check daemon status and show quick summary")
  .action(() => {
    statusCommand();
  });

program
  .command("cleanup")
  .description("Remove stale PID files and orphaned session registrations")
  .action(() => {
    cleanupCommand();
  });

program
  .command("stop")
  .description("Stop the watcher daemon")
  .action(() => {
    stopCommand();
  });

program
  .command("start")
  .description("Start the watcher daemon in background")
  .action(() => {
    startCommand();
  });

program
  .command("install-hook")
  .description("Install pre-commit hook in current project for auto-export")
  .action(() => {
    installHookCommand();
  });

program
  .command("uninstall-hook")
  .description("Remove pre-commit hook from current project")
  .action(() => {
    uninstallHookCommand();
  });

program.parse();
