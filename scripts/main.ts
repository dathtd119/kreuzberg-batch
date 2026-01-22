/**
 * Kreuzberg Batch Processor - Main Entry Point
 * 
 * Watches input directory, fetches URLs, and processes documents
 * using kreuzberg CLI for extraction.
 */

import { join, basename } from "path";
import { existsSync, mkdirSync, readdirSync } from "fs";
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
import { fetchUrl, parseUrlFile, urlToFilename, detectUrlsInTextFile } from "./fetcher";
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

let isShuttingDown = false;
let config: Config;
let state: ProcessedState;

function setupSignalHandlers(): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    
    const hashFilePath = join(config.outputDir, config.hashFile);
    saveProcessedState(hashFilePath, state);
    
    logger.info("Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

async function findUrlFiles(): Promise<string[]> {
  const urlFiles: string[] = [];
  
  try {
    const items = readdirSync(config.inputDir, { withFileTypes: true });
    
    for (const item of items) {
      if (item.isFile() && item.name.endsWith(".txt") && !item.name.startsWith(".")) {
        const filePath = join(config.inputDir, item.name);
        const isUrlFile = await detectUrlsInTextFile(filePath);
        if (isUrlFile) {
          urlFiles.push(filePath);
        }
      }
    }
  } catch (error) {
    logger.error(`Failed to scan for URL files: ${error}`);
  }
  
  return urlFiles;
}

async function processUrlFile(urlFilePath: string): Promise<void> {
  const fileName = basename(urlFilePath);
  logger.info(`Processing URLs from ${fileName}...`);
  
  const urls = await parseUrlFile(urlFilePath);
  if (urls.length === 0) {
    logger.debug(`No URLs found in ${fileName}`);
    return;
  }

  logger.info(`Found ${urls.length} URLs in ${fileName}`);

  for (const urlEntry of urls) {
    if (isShuttingDown) break;

    const filename = urlToFilename(urlEntry.url, urlEntry.filename);
    const tempDir = join(config.inputDir, ".url-cache");
    const tempPath = join(tempDir, filename);
    
    const urlHash = calculateStringHash(urlEntry.url);
    if (isFileProcessed(state, urlEntry.url, urlHash)) {
      logger.debug(`URL already processed: ${urlEntry.url}`);
      continue;
    }

    const result = await fetchUrl(urlEntry.url, config);
    
    if (!result.success) {
      logger.error(`Failed to fetch URL: ${urlEntry.url} - ${result.error}`);
      continue;
    }

    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    await Bun.write(tempPath, result.html);

    const outputPath = generateOutputPath(
      tempPath,
      config.inputDir,
      config.outputDir,
      config
    );

    const extractResult = await extractDocument(tempPath, outputPath, config);

    if (extractResult.success) {
      markFileProcessed(state, urlEntry.url, urlHash, outputPath);
      logger.info(`Processed URL: ${urlEntry.url} → ${outputPath}`);
    } else {
      logger.error(`Extraction failed for URL: ${urlEntry.url}`);
    }
  }
  
  const urlFileHash = await calculateFileHash(urlFilePath);
  markFileProcessed(state, urlFilePath, urlFileHash, "url-list-processed");
}

async function processUrls(): Promise<void> {
  if (!config.fetchUrls) {
    logger.debug("URL fetching disabled");
    return;
  }

  const urlFiles = await findUrlFiles();
  
  if (urlFiles.length === 0) {
    logger.debug("No URL list files found");
    return;
  }

  for (const urlFile of urlFiles) {
    if (isShuttingDown) break;
    
    const fileHash = await calculateFileHash(urlFile);
    if (isFileProcessed(state, urlFile, fileHash)) {
      logger.debug(`URL file already processed: ${basename(urlFile)}`);
      continue;
    }
    
    await processUrlFile(urlFile);
  }
}

async function processFiles(): Promise<void> {
  logger.info("Scanning input directory...");
  
  const entries = getAllInputFiles(config);
  const newFiles: FileEntry[] = [];

  for (const entry of entries) {
    if (entry.path.endsWith(".txt")) {
      const isUrlFile = await detectUrlsInTextFile(entry.path);
      if (isUrlFile) {
        continue;
      }
    }
    
    const fileHash = await calculateFileHash(entry.path);
    
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

  const jobs = createJobs(newFiles);

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

    const hashFilePath = join(config.outputDir, config.hashFile);
    saveProcessedState(hashFilePath, state);
  }
}

async function runCycle(): Promise<void> {
  logger.info("Starting processing cycle...");
  const startTime = Date.now();

  try {
    await processUrls();
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

  config = loadConfig();
  
  const errors = validateConfig(config);
  if (errors.length > 0) {
    logger.error("Configuration errors:");
    errors.forEach((e) => logger.error(`  - ${e}`));
    process.exit(1);
  }

  const log = createLogger(config.logLevel);
  
  logger.info(`Watch interval: ${config.watchInterval}s`);
  logger.info(`Concurrent jobs: ${config.concurrentJobs}`);
  logger.info(`Input directory: ${config.inputDir}`);
  logger.info(`Output directory: ${config.outputDir}`);
  logger.info(`Playwright enabled: ${config.playwrightEnabled}`);
  logger.info(`Browserless enabled: ${config.browserlessEnabled}`);

  [config.inputDir, config.outputDir, config.errorDir].forEach((dir) => {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      logger.info(`Created directory: ${dir}`);
    }
  });

  const hashFilePath = join(config.outputDir, config.hashFile);
  state = loadProcessedState(hashFilePath);
  logger.info(`Loaded state: ${getProcessedStats(state).totalFiles} files tracked`);

  setupSignalHandlers();

  await runCycle();

  logger.info(`Starting watch loop (interval: ${config.watchInterval}s)...`);
  
  while (!isShuttingDown) {
    await Bun.sleep(config.watchInterval * 1000);
    
    if (!isShuttingDown) {
      await runCycle();
    }
  }
}

main().catch((error) => {
  logger.error(`Fatal error: ${error}`);
  process.exit(1);
});
