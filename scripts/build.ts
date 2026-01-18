#!/usr/bin/env bun
import { $ } from "bun";
import { mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const TARGETS = [
  { target: "bun-darwin-arm64", name: "recorder-macos-arm64" },
  { target: "bun-darwin-x64", name: "recorder-macos-x64" },
  { target: "bun-linux-x64", name: "recorder-linux-x64" },
  { target: "bun-linux-arm64", name: "recorder-linux-arm64" },
  { target: "bun-windows-x64", name: "recorder-windows-x64.exe" },
] as const;

const ROOT = import.meta.dir.replace("/scripts", "");
const DIST = join(ROOT, "dist");
const ENTRY = join(ROOT, "src", "index.ts");

async function build() {
  console.log("Building claude-recorder binaries...\n");

  // Clean and create dist directory
  if (existsSync(DIST)) {
    await rm(DIST, { recursive: true });
  }
  await mkdir(DIST, { recursive: true });

  const results: { name: string; success: boolean; size?: string }[] = [];

  for (const { target, name } of TARGETS) {
    const outfile = join(DIST, name);
    console.log(`Building ${name} (${target})...`);

    try {
      await $`bun build --compile --minify --target=${target} --outfile=${outfile} ${ENTRY}`.quiet();

      const file = Bun.file(outfile);
      const size = file.size / 1024 / 1024;
      results.push({ name, success: true, size: `${size.toFixed(1)} MB` });
      console.log(`  ✓ ${name} (${size.toFixed(1)} MB)`);
    } catch (error) {
      results.push({ name, success: false });
      console.error(`  ✗ ${name} failed`);
      if (error instanceof Error) {
        console.error(`    ${error.message}`);
      }
    }
  }

  console.log("\nBuild summary:");
  console.log("─".repeat(50));

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  for (const r of successful) {
    console.log(`  ✓ ${r.name.padEnd(30)} ${r.size}`);
  }
  for (const r of failed) {
    console.log(`  ✗ ${r.name.padEnd(30)} FAILED`);
  }

  console.log("─".repeat(50));
  console.log(`Total: ${successful.length}/${TARGETS.length} successful`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

build();
