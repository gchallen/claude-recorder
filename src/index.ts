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
import { hookSessionStartCommand, hookSessionEndCommand } from "./commands/hook.js";
import { installCommand } from "./commands/install.js";
import { uninstallCommand } from "./commands/uninstall.js";
import { startDaemon } from "./watcher.js";

const program = new Command();

program
  .name("record-claude")
  .description("Record and search Claude Code CLI activity")
  .version("2026.1.0");

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

// Hook subcommands for standalone binary
const hookCommand = program.command("hook").description("Handle Claude Code hooks");

hookCommand
  .command("session-start")
  .description("Handle SessionStart hook (reads JSON from stdin)")
  .action(() => {
    hookSessionStartCommand();
  });

hookCommand
  .command("session-end")
  .description("Handle SessionEnd hook (reads JSON from stdin)")
  .action(() => {
    hookSessionEndCommand();
  });

// Install/uninstall commands for standalone binary
program
  .command("install")
  .description("Install record-claude and configure Claude Code hooks")
  .action(() => {
    installCommand();
  });

program
  .command("uninstall")
  .description("Remove Claude Code hooks and optionally delete data")
  .option("--all", "Also remove recorded data")
  .action((options) => {
    uninstallCommand({ all: options.all });
  });

// Hidden daemon command for internal use
program
  .command("daemon", { hidden: true })
  .description("Run the watcher daemon (internal use)")
  .action(() => {
    startDaemon();
  });

program.parse();
