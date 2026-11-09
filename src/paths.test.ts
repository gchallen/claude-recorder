import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { canonicalPath, claudeConfigDir, claudeProjectsDir } from "./paths.js";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "recorder-paths-"));
  mkdirSync(join(root, "shared", "projects", "-proj"), { recursive: true });
  writeFileSync(join(root, "shared", "projects", "-proj", "s.jsonl"), "");
  mkdirSync(join(root, "acct"));
  symlinkSync(join(root, "shared", "projects"), join(root, "acct", "projects"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("canonicalPath", () => {
  test("resolves a transcript seen through a symlinked projects dir", () => {
    const viaLink = join(root, "acct", "projects", "-proj", "s.jsonl");
    const direct = join(root, "shared", "projects", "-proj", "s.jsonl");
    expect(canonicalPath(viaLink)).toBe(realpathSync(direct));
  });

  test("resolves the parent when the file does not exist yet", () => {
    const viaLink = join(root, "acct", "projects", "-proj", "new.jsonl");
    expect(canonicalPath(viaLink)).toBe(join(realpathSync(join(root, "shared", "projects", "-proj")), "new.jsonl"));
  });

  test("returns the input when nothing exists", () => {
    expect(canonicalPath("/nonexistent/x/y.jsonl")).toBe("/nonexistent/x/y.jsonl");
  });
});

describe("claudeConfigDir", () => {
  test("honors CLAUDE_CONFIG_DIR and resolves symlinks", () => {
    const prev = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = join(root, "acct");
    try {
      expect(claudeConfigDir()).toBe(realpathSync(join(root, "acct")));
      expect(claudeProjectsDir()).toBe(join(realpathSync(join(root, "acct")), "projects"));
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prev;
    }
  });

  test("falls back to ~/.claude", () => {
    const prev = process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CLAUDE_CONFIG_DIR;
    try {
      expect(claudeConfigDir().endsWith("/.claude")).toBe(true);
    } finally {
      if (prev !== undefined) process.env.CLAUDE_CONFIG_DIR = prev;
    }
  });
});
