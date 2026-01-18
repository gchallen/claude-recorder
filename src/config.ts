import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { ProjectConfig, SessionExportConfig } from "./types.js";

const CONFIG_FILENAME = ".claude-recorder.json";

const DEFAULT_EXPORT_CONFIG: SessionExportConfig = {
  enabled: true,
  outputDir: ".claude-sessions",
  fileNamePattern: "{datetime}-{slug}",
};

/**
 * Load project configuration from .claude-recorder.json
 */
export function loadProjectConfig(projectDir: string): ProjectConfig | null {
  const configPath = join(projectDir, CONFIG_FILENAME);

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content) as ProjectConfig;
  } catch {
    return null;
  }
}

/**
 * Get session export configuration with defaults
 */
export function getSessionExportConfig(
  projectDir: string
): SessionExportConfig | null {
  const config = loadProjectConfig(projectDir);

  if (!config?.sessionExport) {
    return null;
  }

  // Merge with defaults
  return {
    ...DEFAULT_EXPORT_CONFIG,
    ...config.sessionExport,
  };
}

/**
 * Check if session export is enabled for a project
 */
export function isSessionExportEnabled(projectDir: string): boolean {
  const config = getSessionExportConfig(projectDir);
  return config?.enabled ?? false;
}
