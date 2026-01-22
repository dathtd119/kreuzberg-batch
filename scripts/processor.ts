/**
 * Kreuzberg Batch Processor - Document Processor
 * Handles extraction using kreuzberg CLI
 */

import { join, basename, dirname, relative, extname } from "path";
import { existsSync, mkdirSync, copyFileSync, renameSync } from "fs";
import type { Config, ProcessingJob, KreuzbergResult } from "./types";
import { logger } from "./logger";

/**
 * Supported file extensions for processing
 */
const SUPPORTED_EXTENSIONS = new Set([
  // Documents
  ".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
  ".odt", ".rtf", ".epub", ".txt", ".md", ".markdown",
  // Web
  ".html", ".htm", ".xml", ".json", ".yaml", ".yml", ".toml",
  // Images (OCR)
  ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp", ".gif", ".webp",
  // Email
  ".eml", ".msg",
  // Archives
  ".zip", ".tar", ".gz",
]);

/**
 * Check if file extension is supported
 */
export function isSupportedFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * Generate output path for processed file
 */
export function generateOutputPath(
  inputPath: string,
  inputDir: string,
  outputDir: string,
  config: Config
): string {
  const relativePath = relative(inputDir, inputPath);
  const dirName = dirname(relativePath);
  const baseName = basename(relativePath, extname(relativePath));
  
  let outputFileName: string;
  if (config.addTimestamp) {
    const timestamp = new Date().toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "_")
      .substring(0, 15);
    outputFileName = `${baseName}_${timestamp}.md`;
  } else {
    outputFileName = `${baseName}.md`;
  }

  if (config.preserveStructure && dirName !== ".") {
    const outputSubDir = join(outputDir, dirName);
    if (!existsSync(outputSubDir)) {
      mkdirSync(outputSubDir, { recursive: true });
    }
    return join(outputSubDir, outputFileName);
  }

  return join(outputDir, outputFileName);
}

/**
 * Run kreuzberg CLI to extract document
 */
export async function extractDocument(
  inputPath: string,
  outputPath: string,
  config: Config
): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    logger.debug(`Extracting: ${inputPath}`);

    const args = [
      "extract",
      inputPath,
      "--format", "text",
    ];

    // Add config file if exists
    if (existsSync(config.kreuzbergConfig)) {
      args.push("--config", config.kreuzbergConfig);
    }

    if (config.ocrEnabled) {
      args.push("--ocr", "true");
    }

    if (process.env.FORCE_OCR === "true") {
      args.push("--force-ocr", "true");
    }

    // Add quality processing
    if (config.qualityProcessing) {
      args.push("--quality", "true");
    }

    // Execute kreuzberg CLI
    const proc = Bun.spawn(["kreuzberg", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(stderr || `Exit code ${exitCode}`);
    }

    // Write output
    await Bun.write(outputPath, stdout);
    
    logger.info(`Extracted: ${inputPath} → ${outputPath}`);
    return { success: true, content: stdout };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Extraction failed for ${inputPath}: ${message}`);
    return { success: false, error: message };
  }
}

/**
 * Move file to error directory
 */
export function moveToError(
  inputPath: string,
  inputDir: string,
  errorDir: string,
  error: string
): void {
  try {
    const relativePath = relative(inputDir, inputPath);
    const errorPath = join(errorDir, relativePath);
    const errorLogPath = `${errorPath}.error.txt`;

    // Create error subdirectory if needed
    const errorSubDir = dirname(errorPath);
    if (!existsSync(errorSubDir)) {
      mkdirSync(errorSubDir, { recursive: true });
    }

    // Copy file to error directory (don't move, keep original)
    copyFileSync(inputPath, errorPath);
    
    // Write error log
    Bun.write(errorLogPath, `Error: ${error}\nTimestamp: ${new Date().toISOString()}\nOriginal path: ${inputPath}`);
    
    logger.warn(`Moved to error: ${inputPath} → ${errorPath}`);
  } catch (err) {
    logger.error(`Failed to move to error directory: ${err}`);
  }
}

/**
 * Process a single job with retries
 */
export async function processJob(
  job: ProcessingJob,
  config: Config
): Promise<ProcessingJob> {
  job.status = "processing";
  job.startTime = Date.now();

  const outputPath = generateOutputPath(
    job.entry.path,
    config.inputDir,
    config.outputDir,
    config
  );

  let lastError = "";

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    logger.debug(`Processing attempt ${attempt}/${config.maxRetries}: ${job.entry.path}`);

    const result = await extractDocument(job.entry.path, outputPath, config);

    if (result.success) {
      job.status = "completed";
      job.endTime = Date.now();
      return job;
    }

    lastError = result.error || "Unknown error";
    job.retries = attempt;

    if (attempt < config.maxRetries) {
      logger.debug(`Retrying in ${config.retryDelay}ms...`);
      await Bun.sleep(config.retryDelay);
    }
  }

  // All retries failed
  job.status = "failed";
  job.error = lastError;
  job.endTime = Date.now();

  // Move to error directory
  moveToError(job.entry.path, config.inputDir, config.errorDir, lastError);

  return job;
}

/**
 * Process multiple jobs concurrently
 */
export async function processJobs(
  jobs: ProcessingJob[],
  config: Config
): Promise<ProcessingJob[]> {
  const results: ProcessingJob[] = [];
  const concurrency = config.concurrentJobs;

  // Process in batches
  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((job) => processJob(job, config))
    );
    results.push(...batchResults);
  }

  return results;
}
