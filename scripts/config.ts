/**
 * Kreuzberg Batch Processor - Configuration Loader
 * Reads configuration from environment variables
 */

import type { Config } from "./types";

/**
 * Parse boolean from environment variable
 */
function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true" || value === "1";
}

/**
 * Parse integer from environment variable
 */
function parseInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
  return {
    // Watch settings
    watchInterval: parseInt(process.env.WATCH_INTERVAL, 30),
    concurrentJobs: parseInt(process.env.CONCURRENT_JOBS, 4),
    recursive: parseBool(process.env.RECURSIVE, true),

    // Output settings
    outputFormat: (process.env.OUTPUT_FORMAT as Config["outputFormat"]) || "markdown",
    addTimestamp: parseBool(process.env.ADD_TIMESTAMP, true),
    skipExisting: parseBool(process.env.SKIP_EXISTING, true),
    preserveStructure: parseBool(process.env.PRESERVE_STRUCTURE, true),
    hashFile: process.env.HASH_FILE || ".processed.json",

    // URL Fetching
    fetchUrls: parseBool(process.env.FETCH_URLS, true),
    urlFile: process.env.URL_FILE || "urls.txt",
    fetchTimeout: parseInt(process.env.FETCH_TIMEOUT, 30000),
    userAgent: process.env.USER_AGENT || "Mozilla/5.0 (compatible; KreuzbergBot/1.0)",

    // Playwright (Layer 2)
    playwrightEnabled: parseBool(process.env.PLAYWRIGHT_ENABLED, true),
    playwrightWait: parseInt(process.env.PLAYWRIGHT_WAIT, 5000),
    playwrightTimeout: parseInt(process.env.PLAYWRIGHT_TIMEOUT, 60000),

    // Browserless (Layer 3)
    browserlessEnabled: parseBool(process.env.BROWSERLESS_ENABLED, true),
    browserlessUrl: process.env.BROWSERLESS_URL || "http://browserless:3000",
    browserlessToken: process.env.BROWSERLESS_TOKEN || "",

    // Error handling
    maxRetries: parseInt(process.env.MAX_RETRIES, 3),
    retryDelay: parseInt(process.env.RETRY_DELAY, 5000),

    // Kreuzberg settings
    kreuzbergConfig: process.env.KREUZBERG_CONFIG || "/config/kreuzberg.toml",
    ocrEnabled: parseBool(process.env.OCR_ENABLED, true),
    ocrLanguage: process.env.OCR_LANGUAGE || "eng",
    qualityProcessing: parseBool(process.env.QUALITY_PROCESSING, true),

    // Directories
    inputDir: process.env.INPUT_DIR || "/files/input",
    outputDir: process.env.OUTPUT_DIR || "/files/output",
    errorDir: process.env.ERROR_DIR || "/files/error",

    // Logging
    logLevel: (process.env.LOG_LEVEL as Config["logLevel"]) || "info",
    verbose: parseBool(process.env.VERBOSE, false),
  };
}

/**
 * Validate configuration
 */
export function validateConfig(config: Config): string[] {
  const errors: string[] = [];

  if (config.watchInterval < 1) {
    errors.push("WATCH_INTERVAL must be at least 1 second");
  }

  if (config.concurrentJobs < 1) {
    errors.push("CONCURRENT_JOBS must be at least 1");
  }

  if (config.maxRetries < 0) {
    errors.push("MAX_RETRIES cannot be negative");
  }

  return errors;
}
