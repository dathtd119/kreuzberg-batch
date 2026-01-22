/**
 * Kreuzberg Batch Processor - Main Entry Point
 * 
 * Watches input directory, fetches URLs, and processes documents
 * using kreuzberg CLI for extraction.
 */

import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { loadConfig, validateConfig } from "./config";
import { logger, createLogger } from "./logger";
import { 
  loadProcessedState, 
  saveProcessedState, 
  calculateFileHash, 
  calculateStringHash,
  isFileProcessed, 
  markFileProcessed,
  getProcessedStats 
} from "./hash";
import { fetchUrl, parseUrlFile, urlToFilename } from "./fetcher";
import { 
  extractDocument, 
  generateOutputPath, 
  processJob,
  isSupportedFile 
} from "./processor";
import { 
  scanDirectory, 
  getAllInputFiles, 
  createJobs,
  generateTimestamp 
} from "./watcher";
import type { Config, FileEntry, ProcessingJob, ProcessedState } from "./types";

// ===========================================
// Globals
// ===========================================

let isShuttingDown = false;
let config: Config;
let state: ProcessedState;

// ===========================================
// Signal Handlers
// ===========================================

function setupSignalHandlers(): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    
    // Save state before exit
    const hashFilePath = join(config.outputDir, config.hashFile);
    saveProcessedState(hashFilePath, state);
    
    logger.info("Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// ===========================================
// URL Processing
// ===========================================

async function processUrls(): Promise<void> {
  const urlFilePath = join(config.inputDir, config.urlFile);
  
  if (!config.fetchUrls || !existsSync(urlFilePath)) {
    logger.debug("URL fetching disabled or urls.txt not found");
    return;
  }

  logger.info("Processing URLs from urls.txt...");
  
  const urls = await parseUrlFile(urlFilePath);
  if (urls.length === 0) {
    logger.debug("No URLs to process");
    return;
  }

  logger.info(`Found ${urls.length} URLs to process`);

  for (const urlEntry of urls) {
    if (isShuttingDown) break;

    const filename = urlToFilename(urlEntry.url, urlEntry.filename);
    const tempPath = join(config.inputDir, ".url-cache", filename);
    
    // Check if already processed (by URL hash)
    const urlHash = calculateStringHash(urlEntry.url);
    if (isFileProcessed(state, urlEntry.url, urlHash)) {
      logger.debug(`URL already processed: ${urlEntry.url}`);
      continue;
    }

    // Fetch URL
    const result = await fetchUrl(urlEntry.url, config);
    
    if (!result.success) {
      logger.error(`Failed to fetch URL: ${urlEntry.url}`);
      continue;
    }

    // Create temp directory for HTML
    const tempDir = join(config.inputDir, ".url-cache");
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    // Write HTML to temp file
    await Bun.write(tempPath, result.html);

    // Generate output path
    const outputPath = generateOutputPath(
      tempPath,
      config.inputDir,
      config.outputDir,
      config
    );

    // Extract using kreuzberg
    const extractResult = await extractDocument(tempPath, outputPath, config);

    if (extractResult.success) {
      markFileProcessed(state, urlEntry.url, urlHash, outputPath);
      logger.info(`Processed URL: ${urlEntry.url} → ${outputPath}`);
    } else {
      logger.error(`Extraction failed for URL: ${urlEntry.url}`);
    }
  }
}

// ===========================================
// File Processing
// ===========================================

async function processFiles(): Promise<void> {
  logger.info("Scanning input directory...");
  
  const entries = getAllInputFiles(config);
  const newFiles: FileEntry[] = [];

  for (const entry of entries) {
    // Calculate file hash
    const fileHash = await calculateFileHash(entry.path);
    
    // Check if already processed
    if (config.skipExisting && isFileProcessed(state, entry.path, fileHash)) {
      logger.debug(`Skipping already processed: ${entry.relativePath}`);
      continue;
    }

    newFiles.push(entry);
  }

  if (newFiles.length === 0) {
    logger.debug("No new files to process");
    return;
  }

  logger.info(`Processing ${newFiles.length} new files...`);

  // Create jobs
  const jobs = createJobs(newFiles);

  // Process concurrently
  const concurrency = config.concurrentJobs;
  for (let i = 0; i < jobs.length; i += concurrency) {
    if (isShuttingDown) break;

    const batch = jobs.slice(i, i + concurrency);
    
    await Promise.all(
      batch.map(async (job) => {
        const fileHash = await calculateFileHash(job.entry.path);
        const result = await processJob(job, config);

        if (result.status === "completed") {
          const outputPath = generateOutputPath(
            job.entry.path,
            config.inputDir,
            config.outputDir,
            config
          );
          markFileProcessed(state, job.entry.path, fileHash, outputPath, result.retries);
        }
      })
    );

    // Save state after each batch
    const hashFilePath = join(config.outputDir, config.hashFile);
    saveProcessedState(hashFilePath, state);
  }
}

// ===========================================
// Main Loop
// ===========================================

async function runCycle(): Promise<void> {
  logger.info("Starting processing cycle...");
  const startTime = Date.now();

  try {
    // Process URLs first
    await processUrls();

    // Process files
    await processFiles();

    const duration = (Date.now() - startTime) / 1000;
    const stats = getProcessedStats(state);
    
    logger.info(`Cycle completed in ${duration.toFixed(2)}s. Total processed: ${stats.totalFiles} files`);
  } catch (error) {
    logger.error(`Cycle error: ${error}`);
  }
}

async function main(): Promise<void> {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║         Kreuzberg Batch Processor v1.0.0                  ║
║         Document Intelligence Pipeline                    ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Load configuration
  config = loadConfig();
  
  // Validate configuration
  const errors = validateConfig(config);
  if (errors.length > 0) {
    logger.error("Configuration errors:");
    errors.forEach((e) => logger.error(`  - ${e}`));
    process.exit(1);
  }

  // Setup logger with configured level
  const log = createLogger(config.logLevel);
  
  logger.info(`Watch interval: ${config.watchInterval}s`);
  logger.info(`Concurrent jobs: ${config.concurrentJobs}`);
  logger.info(`Input directory: ${config.inputDir}`);
  logger.info(`Output directory: ${config.outputDir}`);
  logger.info(`Playwright enabled: ${config.playwrightEnabled}`);
  logger.info(`Browserless enabled: ${config.browserlessEnabled}`);

  // Ensure directories exist
  [config.inputDir, config.outputDir, config.errorDir].forEach((dir) => {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      logger.info(`Created directory: ${dir}`);
    }
  });

  // Load processed state
  const hashFilePath = join(config.outputDir, config.hashFile);
  state = loadProcessedState(hashFilePath);
  logger.info(`Loaded state: ${getProcessedStats(state).totalFiles} files tracked`);

  // Setup signal handlers
  setupSignalHandlers();

  // Run initial cycle
  await runCycle();

  // Start watch loop
  logger.info(`Starting watch loop (interval: ${config.watchInterval}s)...`);
  
  while (!isShuttingDown) {
    await Bun.sleep(config.watchInterval * 1000);
    
    if (!isShuttingDown) {
      await runCycle();
    }
  }
}

// ===========================================
// Entry Point
// ===========================================

main().catch((error) => {
  logger.error(`Fatal error: ${error}`);
  process.exit(1);
});
