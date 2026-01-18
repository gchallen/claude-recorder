#!/usr/bin/env bun
/**
 * /release skill for Claude Code
 *
 * Prepares and creates a GitHub release:
 * 1. Checks for uncommitted changes
 * 2. Gets version from package.json
 * 3. Generates release notes from commits since last tag
 * 4. Builds binaries for all platforms
 * 5. Creates git tag and GitHub release
 */

import { existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..", "..");

interface PackageJson {
  version: string;
  name: string;
}

async function run(cmd: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = Bun.spawnSync(cmd, { cwd: cwd || ROOT });
  return {
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
    exitCode: result.exitCode,
  };
}

async function main(): Promise<void> {
  console.log("🚀 Claude Recorder Release\n");

  // Step 1: Check for uncommitted changes
  console.log("[1/5] Checking for uncommitted changes...");
  const status = await run(["git", "status", "--porcelain"]);
  if (status.stdout) {
    console.log("❌ Working directory has uncommitted changes:");
    console.log(status.stdout);
    console.log("\nPlease commit or stash changes before releasing.");
    process.exit(1);
  }
  console.log("✓ Working directory clean\n");

  // Step 2: Get version from package.json
  console.log("[2/5] Reading version...");
  const pkgPath = join(ROOT, "package.json");
  if (!existsSync(pkgPath)) {
    console.log("❌ package.json not found");
    process.exit(1);
  }
  const pkg: PackageJson = await Bun.file(pkgPath).json();
  const version = `v${pkg.version}`;
  console.log(`✓ Version: ${version}\n`);

  // Check if tag already exists
  const tagCheck = await run(["git", "tag", "-l", version]);
  if (tagCheck.stdout === version) {
    console.log(`❌ Tag ${version} already exists`);
    console.log("Update version in package.json before releasing.");
    process.exit(1);
  }

  // Step 3: Generate release notes from commits since last tag
  console.log("[3/5] Generating release notes...");
  const lastTag = await run(["git", "describe", "--tags", "--abbrev=0"]);
  let releaseNotes = "";

  if (lastTag.exitCode === 0 && lastTag.stdout) {
    const log = await run(["git", "log", `${lastTag.stdout}..HEAD`, "--pretty=format:- %s"]);
    releaseNotes = log.stdout || "- No changes since last release";
    console.log(`✓ Changes since ${lastTag.stdout}:\n`);
  } else {
    const log = await run(["git", "log", "--pretty=format:- %s", "-20"]);
    releaseNotes = log.stdout || "- Initial release";
    console.log("✓ Recent commits (no previous tag found):\n");
  }
  console.log(releaseNotes);
  console.log("");

  // Step 4: Build binaries
  console.log("[4/5] Building binaries for all platforms...");
  const build = Bun.spawn(["bun", "run", "build"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const buildExitCode = await build.exited;
  if (buildExitCode !== 0) {
    console.log("\n❌ Build failed");
    process.exit(1);
  }
  console.log("");

  // Check dist directory
  const distDir = join(ROOT, "dist");
  if (!existsSync(distDir)) {
    console.log("❌ dist/ directory not found after build");
    process.exit(1);
  }

  // Step 5: Create tag and release
  console.log("[5/5] Creating GitHub release...");

  // Create and push tag
  const createTag = await run(["git", "tag", "-a", version, "-m", `Release ${version}`]);
  if (createTag.exitCode !== 0) {
    console.log(`❌ Failed to create tag: ${createTag.stderr}`);
    process.exit(1);
  }
  console.log(`✓ Created tag ${version}`);

  const pushTag = await run(["git", "push", "origin", version]);
  if (pushTag.exitCode !== 0) {
    console.log(`❌ Failed to push tag: ${pushTag.stderr}`);
    // Clean up local tag
    await run(["git", "tag", "-d", version]);
    process.exit(1);
  }
  console.log(`✓ Pushed tag to origin`);

  // Create GitHub release with binaries
  const releaseCmd = [
    "gh", "release", "create", version,
    "--title", `Claude Recorder ${version}`,
    "--notes", releaseNotes,
    `${distDir}/recorder-macos-arm64`,
    `${distDir}/recorder-macos-x64`,
    `${distDir}/recorder-linux-arm64`,
    `${distDir}/recorder-linux-x64`,
    `${distDir}/recorder-windows-x64.exe`,
  ];

  const release = await run(releaseCmd);
  if (release.exitCode !== 0) {
    console.log(`❌ Failed to create release: ${release.stderr}`);
    process.exit(1);
  }
  console.log(`✓ Created GitHub release`);

  // Get repo URL from git remote
  const remoteUrl = await run(["git", "remote", "get-url", "origin"]);
  let repoUrl = "";
  if (remoteUrl.exitCode === 0) {
    // Convert git@github.com:user/repo.git to https://github.com/user/repo
    repoUrl = remoteUrl.stdout
      .replace(/^git@github\.com:/, "https://github.com/")
      .replace(/\.git$/, "");
  }

  console.log(`\n✅ Release ${version} published successfully!`);
  if (repoUrl) {
    console.log(`\nView at: ${repoUrl}/releases/tag/${version}`);
  }
}

main().catch((err) => {
  console.log(`\n❌ Error: ${err}`);
  process.exit(1);
});
