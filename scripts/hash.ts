/**
 * Kreuzberg Batch Processor - Hash Management
 * Tracks processed files using MD5 hashes
 */

import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import type { ProcessedState, ProcessedFileEntry } from "./types";
import { logger } from "./logger";

const STATE_VERSION = "1.0.0";

/**
 * Calculate MD5 hash of file content
 */
export async function calculateFileHash(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const buffer = await file.arrayBuffer();
  const hash = createHash("md5");
  hash.update(Buffer.from(buffer));
  return hash.digest("hex");
}

/**
 * Calculate MD5 hash of string content
 */
export function calculateStringHash(content: string): string {
  const hash = createHash("md5");
  hash.update(content);
  return hash.digest("hex");
}

/**
 * Load processed state from JSON file
 */
export function loadProcessedState(hashFilePath: string): ProcessedState {
  if (!existsSync(hashFilePath)) {
    return {
      version: STATE_VERSION,
      lastUpdated: new Date().toISOString(),
      files: {},
    };
  }

  try {
    const content = readFileSync(hashFilePath, "utf-8");
    const state = JSON.parse(content) as ProcessedState;
    
    // Validate version
    if (state.version !== STATE_VERSION) {
      logger.warn(`State file version mismatch. Expected ${STATE_VERSION}, got ${state.version}. Starting fresh.`);
      return {
        version: STATE_VERSION,
        lastUpdated: new Date().toISOString(),
        files: {},
      };
    }
    
    return state;
  } catch (error) {
    logger.error(`Failed to load processed state: ${error}`);
    return {
      version: STATE_VERSION,
      lastUpdated: new Date().toISOString(),
      files: {},
    };
  }
}

/**
 * Save processed state to JSON file
 */
export function saveProcessedState(hashFilePath: string, state: ProcessedState): void {
  try {
    state.lastUpdated = new Date().toISOString();
    const content = JSON.stringify(state, null, 2);
    writeFileSync(hashFilePath, content, "utf-8");
    logger.debug(`Saved processed state to ${hashFilePath}`);
  } catch (error) {
    logger.error(`Failed to save processed state: ${error}`);
  }
}

/**
 * Check if file has been processed (by hash)
 */
export function isFileProcessed(
  state: ProcessedState,
  inputPath: string,
  currentHash: string
): boolean {
  const entry = state.files[inputPath];
  if (!entry) return false;
  return entry.hash === currentHash;
}

/**
 * Mark file as processed
 */
export function markFileProcessed(
  state: ProcessedState,
  inputPath: string,
  hash: string,
  outputPath: string,
  retries: number = 0
): void {
  state.files[inputPath] = {
    hash,
    outputPath,
    processedAt: new Date().toISOString(),
    retries,
  };
}

/**
 * Get processed file entry
 */
export function getProcessedEntry(
  state: ProcessedState,
  inputPath: string
): ProcessedFileEntry | undefined {
  return state.files[inputPath];
}

/**
 * Remove processed file entry
 */
export function removeProcessedEntry(
  state: ProcessedState,
  inputPath: string
): void {
  delete state.files[inputPath];
}

/**
 * Get statistics about processed files
 */
export function getProcessedStats(state: ProcessedState): {
  totalFiles: number;
  lastUpdated: string;
} {
  return {
    totalFiles: Object.keys(state.files).length,
    lastUpdated: state.lastUpdated,
  };
}
