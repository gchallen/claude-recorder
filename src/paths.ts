import { existsSync, realpathSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join } from "path";

/**
 * Claude Code paths.
 *
 * Claude Code honors CLAUDE_CONFIG_DIR, and a machine may run several config
 * directories (one per account) that symlink `projects/` to one shared
 * directory. The recorder keys read positions and session rows by transcript
 * path, so every path must be reduced to its canonical (symlink-resolved)
 * form before it is stored or compared; otherwise the same transcript seen
 * through two config directories would be read twice.
 */
export function claudeConfigDir(): string {
  const fromEnv = process.env.CLAUDE_CONFIG_DIR;
  const dir = fromEnv && fromEnv.length > 0 ? fromEnv : join(homedir(), ".claude");
  return canonicalPath(dir);
}

export function claudeProjectsDir(): string {
  return join(claudeConfigDir(), "projects");
}

/** Resolve symlinks in `p`; falls back to resolving only the parent directory, then to `p` itself. */
export function canonicalPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    // fall through
  }
  const parent = dirname(p);
  if (parent !== p && existsSync(parent)) {
    try {
      return join(realpathSync(parent), basename(p));
    } catch {
      // fall through
    }
  }
  return p;
}
