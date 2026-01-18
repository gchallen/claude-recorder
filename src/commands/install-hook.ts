import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from "fs";
import { join, dirname } from "path";

const HOOK_MARKER = "# claude-recorder-hook";

/**
 * Install the pre-commit hook in the current project
 */
export function installHookCommand(): void {
  const cwd = process.cwd();

  // Check if we're in a git repository
  const gitDir = join(cwd, ".git");
  if (!existsSync(gitDir)) {
    console.error("Not a git repository (no .git directory found)");
    process.exit(1);
  }

  const hooksDir = join(gitDir, "hooks");
  const hookPath = join(hooksDir, "pre-commit");

  // Get the recorder installation directory
  const recorderDir = dirname(dirname(dirname(import.meta.path)));

  // The hook script content
  const hookScript = `#!/bin/sh
${HOOK_MARKER}
# Auto-export Claude session before commit

# Run the pre-commit hook script
bun run "${recorderDir}/src/hooks/pre-commit.ts"
`;

  // Ensure hooks directory exists
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  // Check if pre-commit hook already exists
  if (existsSync(hookPath)) {
    const existingContent = readFileSync(hookPath, "utf-8");

    // Check if our hook is already installed
    if (existingContent.includes(HOOK_MARKER)) {
      console.log("Pre-commit hook already installed");
      return;
    }

    // Append to existing hook
    const updatedContent = existingContent + "\n" + hookScript;
    writeFileSync(hookPath, updatedContent);
    console.log("Added claude-recorder to existing pre-commit hook");
  } else {
    // Create new hook
    writeFileSync(hookPath, hookScript);
    console.log("Installed pre-commit hook");
  }

  // Make executable
  chmodSync(hookPath, "755");

  // Check for .claude-recorder.json
  const configPath = join(cwd, ".claude-recorder.json");
  if (!existsSync(configPath)) {
    console.log("");
    console.log("Note: No .claude-recorder.json found in this directory.");
    console.log("Create one to enable session export:");
    console.log("");
    console.log(`  {
    "sessionExport": {
      "enabled": true,
      "outputDir": ".claude-sessions",
      "fileNamePattern": "{datetime}-{slug}"
    }
  }`);
  }
}

/**
 * Uninstall the pre-commit hook from the current project
 */
export function uninstallHookCommand(): void {
  const cwd = process.cwd();
  const hookPath = join(cwd, ".git", "hooks", "pre-commit");

  if (!existsSync(hookPath)) {
    console.log("No pre-commit hook found");
    return;
  }

  const content = readFileSync(hookPath, "utf-8");

  if (!content.includes(HOOK_MARKER)) {
    console.log("Claude recorder hook not installed");
    return;
  }

  // Remove our hook section
  const lines = content.split("\n");
  const newLines: string[] = [];
  let inOurSection = false;

  for (const line of lines) {
    if (line.includes(HOOK_MARKER)) {
      inOurSection = true;
      continue;
    }

    // End of our section at next shebang or end of file
    if (inOurSection && (line.startsWith("#!/") || line.startsWith("# ") && !line.includes("claude-recorder"))) {
      inOurSection = false;
    }

    if (!inOurSection) {
      newLines.push(line);
    }
  }

  const newContent = newLines.join("\n").trim();

  if (newContent === "" || newContent === "#!/bin/sh") {
    // Remove the file if empty
    Bun.spawnSync(["rm", hookPath]);
    console.log("Removed pre-commit hook");
  } else {
    writeFileSync(hookPath, newContent + "\n");
    console.log("Removed claude-recorder from pre-commit hook");
  }
}
