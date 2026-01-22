/**
 * Kreuzberg Batch Processor - Type Definitions
 */

// ===========================================
// Configuration Types
// ===========================================

export interface Config {
  // Watch settings
  watchInterval: number;
  concurrentJobs: number;
  recursive: boolean;

  // Output settings
  outputFormat: "markdown" | "json" | "text";
  addTimestamp: boolean;
  skipExisting: boolean;
  preserveStructure: boolean;
  hashFile: string;

  // URL Fetching
  fetchUrls: boolean;
  urlFile: string;
  fetchTimeout: number;
  userAgent: string;

  // Playwright (Layer 2)
  playwrightEnabled: boolean;
  playwrightWait: number;
  playwrightTimeout: number;

  // Error handling
  maxRetries: number;
  retryDelay: number;

  // Kreuzberg settings
  kreuzbergConfig: string;
  ocrEnabled: boolean;
  ocrLanguage: string;
  qualityProcessing: boolean;

  // Directories
  inputDir: string;
  outputDir: string;
  errorDir: string;

  // Logging
  logLevel: "error" | "warn" | "info" | "debug";
  verbose: boolean;
}

// ===========================================
// Processing Types
// ===========================================

export interface ProcessedFile {
  inputPath: string;
  outputPath: string;
  hash: string;
  timestamp: string;
  success: boolean;
  error?: string;
}

export interface ProcessedState {
  version: string;
  lastUpdated: string;
  files: Record<string, ProcessedFileEntry>;
}

export interface ProcessedFileEntry {
  hash: string;
  outputPath: string;
  processedAt: string;
  retries: number;
}

// ===========================================
// URL Fetching Types
// ===========================================

export interface FetchResult {
  url: string;
  html: string;
  success: boolean;
  method: "fetch" | "playwright";
  error?: string;
}

export interface UrlEntry {
  url: string;
  filename?: string;
}

// ===========================================
// File Processing Types
// ===========================================

export interface FileEntry {
  path: string;
  relativePath: string;
  isDirectory: boolean;
  isUrl: boolean;
}

export interface ProcessingJob {
  id: string;
  entry: FileEntry;
  status: "pending" | "processing" | "completed" | "failed";
  retries: number;
  error?: string;
  startTime?: number;
  endTime?: number;
}

export interface BatchResult {
  totalFiles: number;
  processed: number;
  skipped: number;
  failed: number;
  duration: number;
  jobs: ProcessingJob[];
}

// ===========================================
// Kreuzberg CLI Types
// ===========================================

export interface KreuzbergResult {
  content: string;
  metadata?: Record<string, unknown>;
  pages?: KreuzbergPage[];
}

export interface KreuzbergPage {
  page_number: number;
  content: string;
}

export interface KreuzbergError {
  error: string;
  path: string;
}

// ===========================================
// Logger Types
// ===========================================

export type LogLevel = "error" | "warn" | "info" | "debug";

export interface Logger {
  error: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
}
