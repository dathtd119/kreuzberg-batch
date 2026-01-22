/**
 * Kreuzberg Batch Processor - File Watcher
 * Watches input directory for new files and folders
 */

import chokidar from "chokidar";
import { join, relative, extname, basename, dirname } from "path";
import { existsSync, mkdirSync, statSync, readdirSync } from "fs";
import type { Config, FileEntry, ProcessingJob } from "./types";
import { logger } from "./logger";
import { isSupportedFile } from "./processor";

/**
 * Scan directory recursively for files
 */
export function scanDirectory(
  dir: string,
  baseDir: string,
  recursive: boolean = true
): FileEntry[] {
  const entries: FileEntry[] = [];

  if (!existsSync(dir)) {
    logger.warn(`Directory does not exist: ${dir}`);
    return entries;
  }

  try {
    const items = readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = join(dir, item.name);
      const relativePath = relative(baseDir, fullPath);

      // Skip hidden files and directories
      if (item.name.startsWith(".")) {
        continue;
      }

      if (item.isDirectory()) {
        entries.push({
          path: fullPath,
          relativePath,
          isDirectory: true,
          isUrl: false,
        });

        if (recursive) {
          entries.push(...scanDirectory(fullPath, baseDir, recursive));
        }
      } else if (item.isFile()) {
        if (isSupportedFile(fullPath)) {
          entries.push({
            path: fullPath,
            relativePath,
            isDirectory: false,
            isUrl: false,
          });
        }
      }
    }
  } catch (error) {
    logger.error(`Failed to scan directory ${dir}: ${error}`);
  }

  return entries;
}

/**
 * Get all files from input directory (including subdirectories)
 */
export function getAllInputFiles(config: Config): FileEntry[] {
  return scanDirectory(config.inputDir, config.inputDir, config.recursive)
    .filter((entry) => !entry.isDirectory);
}

/**
 * Create file entries from URL fetch results
 */
export function createUrlEntries(
  urls: Array<{ url: string; filename?: string }>,
  tempDir: string
): FileEntry[] {
  return urls.map((entry) => ({
    path: join(tempDir, entry.filename || `url_${Date.now()}.html`),
    relativePath: entry.filename || `url_${Date.now()}.html`,
    isDirectory: false,
    isUrl: true,
  }));
}

/**
 * Create processing jobs from file entries
 */
export function createJobs(entries: FileEntry[]): ProcessingJob[] {
  return entries.map((entry, index) => ({
    id: `job_${Date.now()}_${index}`,
    entry,
    status: "pending",
    retries: 0,
  }));
}

/**
 * Watch directory for changes
 */
export function watchDirectory(
  config: Config,
  onFile: (entry: FileEntry) => void,
  onReady?: () => void
): chokidar.FSWatcher {
  const watcher = chokidar.watch(config.inputDir, {
    persistent: true,
    ignoreInitial: false,
    depth: config.recursive ? undefined : 0,
    ignored: [
      /(^|[\/\\])\../, // Hidden files
      /node_modules/,
      /\.processed\.json$/,
    ],
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100,
    },
  });

  watcher.on("add", (path) => {
    if (isSupportedFile(path)) {
      logger.debug(`File added: ${path}`);
      onFile({
        path,
        relativePath: relative(config.inputDir, path),
        isDirectory: false,
        isUrl: false,
      });
    }
  });

  watcher.on("addDir", (path) => {
    if (path !== config.inputDir) {
      logger.debug(`Directory added: ${path}`);
    }
  });

  watcher.on("ready", () => {
    logger.info(`Watcher ready. Watching: ${config.inputDir}`);
    if (onReady) onReady();
  });

  watcher.on("error", (error) => {
    logger.error(`Watcher error: ${error}`);
  });

  return watcher;
}

/**
 * Generate timestamp for folder names
 */
export function generateTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "_")
    .substring(0, 15);
}

/**
 * Create output directory for a batch
 */
export function createBatchOutputDir(
  baseDir: string,
  sourceName: string,
  addTimestamp: boolean
): string {
  const dirName = addTimestamp
    ? `${sourceName}_${generateTimestamp()}`
    : sourceName;
  const outputDir = join(baseDir, dirName);
  
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  
  return outputDir;
}
