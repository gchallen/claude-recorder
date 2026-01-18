import { existsSync, readFileSync, writeFileSync, unlinkSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import chalk from "chalk";

const LOCAL_BIN = join(homedir(), ".local", "bin");
const BINARY_NAME = "record-claude";
const CLAUDE_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");
const RECORDER_DATA_DIR = join(homedir(), ".claude-recorder");

interface HookCommand {
  type: "command";
  command: string;
  timeout?: number;
}

interface HookMatcher {
  matcher?: Record<string, unknown>;
  hooks: HookCommand[];
}

interface ClaudeSettings {
  hooks?: {
    SessionStart?: HookMatcher[];
    SessionEnd?: HookMatcher[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function success(message: string): void {
  console.log(chalk.green(`  ✓ ${message}`));
}

function warning(message: string): void {
  console.log(chalk.yellow(`  ! ${message}`));
}

function info(message: string): void {
  console.log(chalk.gray(`  ${message}`));
}

function getBinaryPath(): string {
  return join(LOCAL_BIN, BINARY_NAME);
}

function readClaudeSettings(): ClaudeSettings {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) {
    return {};
  }

  try {
    const content = readFileSync(CLAUDE_SETTINGS_PATH, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function writeClaudeSettings(settings: ClaudeSettings): void {
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

function isRecorderHook(entry: unknown): boolean {
  const matcher = entry as Record<string, unknown>;
  // Check old format (direct command property)
  if ("command" in matcher && typeof matcher.command === "string") {
    if (matcher.command.includes("record-claude") || matcher.command.includes("recorder")) {
      return true;
    }
  }
  // Check new format (hooks array)
  if ("hooks" in matcher && Array.isArray(matcher.hooks)) {
    return matcher.hooks.some(
      (h: HookCommand) => h.command?.includes("record-claude") || h.command?.includes("recorder")
    );
  }
  return false;
}

function filterRecorderHooks(matchers: unknown[]): HookMatcher[] {
  return matchers
    .map((entry) => {
      const matcher = entry as Record<string, unknown>;
      // Remove old format entries (direct command property)
      if ("command" in matcher && typeof matcher.command === "string") {
        if (matcher.command.includes("record-claude") || matcher.command.includes("recorder")) {
          return null;
        }
      }
      // Handle new format entries (hooks array)
      if ("hooks" in matcher && Array.isArray(matcher.hooks)) {
        const filtered = matcher.hooks.filter(
          (h: HookCommand) => !h.command?.includes("record-claude") && !h.command?.includes("recorder")
        );
        if (filtered.length === 0) {
          return null;
        }
        return { ...matcher, hooks: filtered } as HookMatcher;
      }
      return matcher as HookMatcher;
    })
    .filter((m): m is HookMatcher => m !== null);
}

function removeHooks(): boolean {
  const settings = readClaudeSettings();

  if (!settings.hooks) {
    return false;
  }

  let changed = false;

  // Remove recorder hooks from SessionStart
  if (settings.hooks.SessionStart) {
    const hadRecorder = settings.hooks.SessionStart.some(isRecorderHook);
    const filtered = filterRecorderHooks(settings.hooks.SessionStart);
    if (hadRecorder) {
      settings.hooks.SessionStart = filtered.length > 0 ? filtered : undefined;
      changed = true;
    }
  }

  // Remove recorder hooks from SessionEnd
  if (settings.hooks.SessionEnd) {
    const hadRecorder = settings.hooks.SessionEnd.some(isRecorderHook);
    const filtered = filterRecorderHooks(settings.hooks.SessionEnd);
    if (hadRecorder) {
      settings.hooks.SessionEnd = filtered.length > 0 ? filtered : undefined;
      changed = true;
    }
  }

  // Clean up empty hooks object
  if (settings.hooks) {
    const hookKeys = Object.keys(settings.hooks).filter(
      (k) => settings.hooks![k] !== undefined
    );
    if (hookKeys.length === 0) {
      delete settings.hooks;
    }
  }

  if (changed) {
    writeClaudeSettings(settings);
  }

  return changed;
}

function removeBinary(): boolean {
  const binaryPath = getBinaryPath();

  if (!existsSync(binaryPath)) {
    return false;
  }

  try {
    unlinkSync(binaryPath);
    return true;
  } catch {
    return false;
  }
}

function removeDataDirectory(): boolean {
  if (!existsSync(RECORDER_DATA_DIR)) {
    return false;
  }

  try {
    rmSync(RECORDER_DATA_DIR, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export function uninstallCommand(options: { all?: boolean } = {}): void {
  console.log(chalk.bold("\nClaude Recorder Uninstall\n"));

  // Remove hooks from Claude settings
  console.log("Removing Claude Code hooks...");
  if (removeHooks()) {
    success("Hooks removed from ~/.claude/settings.json");
  } else {
    info("No recorder hooks found");
  }

  // Remove binary
  console.log("\nRemoving binary...");
  const binaryPath = getBinaryPath();
  if (existsSync(binaryPath)) {
    if (removeBinary()) {
      success(`Removed ${binaryPath}`);
    } else {
      warning(`Could not remove ${binaryPath}`);
    }
  } else {
    info("Binary not found at expected location");
  }

  // Optionally remove data directory
  if (options.all) {
    console.log("\nRemoving data directory...");
    if (existsSync(RECORDER_DATA_DIR)) {
      if (removeDataDirectory()) {
        success(`Removed ${RECORDER_DATA_DIR}`);
      } else {
        warning(`Could not remove ${RECORDER_DATA_DIR}`);
      }
    } else {
      info("Data directory not found");
    }
  } else {
    console.log(chalk.gray(`\nData preserved at ${RECORDER_DATA_DIR}`));
    info("Use --all to also remove recorded data");
  }

  console.log(chalk.green.bold("\nUninstall complete.\n"));
}
