import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync } from "fs";
import { homedir } from "os";
import { join, basename } from "path";
import chalk from "chalk";

const LOCAL_BIN = join(homedir(), ".local", "bin");
const BINARY_NAME = "record-claude";
const CLAUDE_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

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

function step(num: number, total: number, message: string): void {
  console.log(`\n[${num}/${total}] ${message}`);
}

function success(message: string): void {
  console.log(chalk.green(`  ✓ ${message}`));
}

function warning(message: string): void {
  console.log(chalk.yellow(`  ! ${message}`));
}

function error(message: string): void {
  console.log(chalk.red(`  ✗ ${message}`));
}

function info(message: string): void {
  console.log(chalk.gray(`  ${message}`));
}

function getBinaryPath(): string {
  return join(LOCAL_BIN, BINARY_NAME);
}

function isInLocalBin(): boolean {
  const execPath = process.execPath;
  const expectedPath = getBinaryPath();
  return execPath === expectedPath;
}

function detectShell(): { name: string; rcFile: string } | null {
  const shell = process.env.SHELL || "";
  if (shell.endsWith("zsh")) {
    return { name: "zsh", rcFile: join(homedir(), ".zshrc") };
  } else if (shell.endsWith("bash")) {
    // Check for .bash_profile first (common on macOS), then .bashrc
    const bashProfile = join(homedir(), ".bash_profile");
    const bashrc = join(homedir(), ".bashrc");
    if (existsSync(bashProfile)) {
      return { name: "bash", rcFile: bashProfile };
    }
    return { name: "bash", rcFile: bashrc };
  }
  return null;
}

function isLocalBinInPath(): boolean {
  const pathEnv = process.env.PATH || "";
  const paths = pathEnv.split(":");
  return paths.some((p) => p === LOCAL_BIN || p === "$HOME/.local/bin" || p === "~/.local/bin");
}

function addToPath(rcFile: string): boolean {
  const exportLine = '\nexport PATH="$HOME/.local/bin:$PATH"\n';

  try {
    let content = "";
    if (existsSync(rcFile)) {
      content = readFileSync(rcFile, "utf-8");
      // Check if already present
      if (content.includes('.local/bin') && content.includes('PATH')) {
        return true; // Already configured
      }
    }

    writeFileSync(rcFile, content + exportLine);
    return true;
  } catch {
    return false;
  }
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
  const claudeDir = join(homedir(), ".claude");
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

function hasRecorderHook(matchers: HookMatcher[]): boolean {
  for (const matcher of matchers) {
    if (matcher.hooks) {
      for (const hook of matcher.hooks) {
        if (hook.command?.includes("record-claude") || hook.command?.includes("recorder")) {
          return true;
        }
      }
    }
  }
  return false;
}

function removeRecorderHooks(matchers: unknown[]): HookMatcher[] {
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
        const nonRecorderHooks = matcher.hooks.filter(
          (h: HookCommand) => !h.command?.includes("record-claude") && !h.command?.includes("recorder")
        );
        if (nonRecorderHooks.length === 0) {
          return null;
        }
        return { ...matcher, hooks: nonRecorderHooks } as HookMatcher;
      }
      return matcher as HookMatcher;
    })
    .filter((m): m is HookMatcher => m !== null);
}

function configureHooks(): { sessionStart: boolean; sessionEnd: boolean } {
  const settings = readClaudeSettings();
  const binaryPath = getBinaryPath();

  if (!settings.hooks) {
    settings.hooks = {};
  }

  const sessionStartCommand = `${binaryPath} hook session-start`;
  const sessionEndCommand = `${binaryPath} hook session-end`;

  // Remove any existing recorder hooks first
  const existingStartHooks = settings.hooks.SessionStart || [];
  const existingEndHooks = settings.hooks.SessionEnd || [];

  const cleanedStartHooks = removeRecorderHooks(existingStartHooks);
  const cleanedEndHooks = removeRecorderHooks(existingEndHooks);

  // Add new recorder hooks using the matcher format
  settings.hooks.SessionStart = [
    ...cleanedStartHooks,
    {
      hooks: [{ type: "command", command: sessionStartCommand, timeout: 5000 }],
    },
  ];

  settings.hooks.SessionEnd = [
    ...cleanedEndHooks,
    {
      hooks: [{ type: "command", command: sessionEndCommand, timeout: 5000 }],
    },
  ];

  writeClaudeSettings(settings);

  return { sessionStart: true, sessionEnd: true };
}

function verifySetup(): { binary: boolean; hooks: boolean } {
  const binaryPath = getBinaryPath();
  const binaryExists = existsSync(binaryPath);

  const settings = readClaudeSettings();
  const hasHooks =
    hasRecorderHook(settings.hooks?.SessionStart || []) &&
    hasRecorderHook(settings.hooks?.SessionEnd || []);

  return { binary: binaryExists, hooks: hasHooks };
}

export function installCommand(): void {
  console.log(chalk.bold("\nClaude Recorder Install\n"));

  const totalSteps = 4;
  let hasWarnings = false;

  // Step 1: Check binary location
  step(1, totalSteps, "Checking binary location...");

  const currentExec = process.execPath;
  const targetPath = getBinaryPath();

  if (isInLocalBin()) {
    success(`Binary found at ${targetPath}`);
  } else {
    // Check if we're running from a compiled binary (not bun directly)
    const isBunDev = currentExec.includes("bun") || basename(currentExec) === "bun";

    if (isBunDev) {
      warning("Running in development mode (via bun)");
      info("Build the binary first: bun run build:local");
      info(`Then run: ${targetPath} install`);
      hasWarnings = true;
    } else {
      // Copy binary to ~/.local/bin
      info(`Current location: ${currentExec}`);
      info(`Installing to: ${targetPath}`);

      if (!existsSync(LOCAL_BIN)) {
        mkdirSync(LOCAL_BIN, { recursive: true });
      }

      try {
        copyFileSync(currentExec, targetPath);
        chmodSync(targetPath, 0o755);
        success(`Binary installed to ${targetPath}`);
      } catch (err) {
        error(`Failed to copy binary: ${err}`);
        return;
      }
    }
  }

  // Step 2: Check PATH configuration
  step(2, totalSteps, "Checking PATH...");

  if (isLocalBinInPath()) {
    success("~/.local/bin is in PATH");
  } else {
    warning("~/.local/bin is not in PATH");
    hasWarnings = true;

    const shell = detectShell();
    if (shell) {
      info(`Adding to ${shell.rcFile}...`);
      if (addToPath(shell.rcFile)) {
        success(`PATH updated (restart your terminal or run: source ${shell.rcFile})`);
      } else {
        error(`Failed to update ${shell.rcFile}`);
      }
    } else {
      warning("Unknown shell, please add ~/.local/bin to your PATH manually");
    }
  }

  // Step 3: Configure Claude Code hooks
  step(3, totalSteps, "Configuring Claude Code hooks...");

  const hookResults = configureHooks();

  if (hookResults.sessionStart) {
    success("SessionStart hook configured");
  } else {
    error("Failed to configure SessionStart hook");
  }

  if (hookResults.sessionEnd) {
    success("SessionEnd hook configured");
  } else {
    error("Failed to configure SessionEnd hook");
  }

  // Step 4: Verify setup
  step(4, totalSteps, "Verifying setup...");

  const verification = verifySetup();

  if (verification.binary && verification.hooks) {
    success("All checks passed");
  } else {
    if (!verification.binary) {
      error("Binary not found at expected location");
    }
    if (!verification.hooks) {
      error("Hooks not properly configured");
    }
  }

  // Summary
  console.log("");
  if (verification.binary && verification.hooks && !hasWarnings) {
    console.log(chalk.green.bold("Installation complete!"));
    console.log("Restart Claude Code to activate recording.\n");
  } else if (hasWarnings) {
    console.log(chalk.yellow.bold("Installation completed with warnings."));
    console.log("Please address the warnings above, then restart Claude Code.\n");
  } else {
    console.log(chalk.red.bold("Installation failed."));
    console.log("Please fix the errors above and try again.\n");
  }
}
