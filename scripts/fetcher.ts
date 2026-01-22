/**
 * Kreuzberg Batch Processor - URL Fetcher
 * 3-layer fetching: Native Fetch → Playwright → Browserless
 */

import type { Config, FetchResult } from "./types";
import { logger } from "./logger";

async function fetchWithNative(
  url: string,
  config: Config
): Promise<FetchResult> {
  try {
    logger.debug(`[Layer 1] Fetching with native fetch: ${url}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.fetchTimeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": config.userAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    
    if (
      html.includes("Please enable JavaScript") ||
      html.includes("noscript") && html.length < 5000 ||
      html.includes("__NEXT_DATA__") && !html.includes("<main")
    ) {
      throw new Error("Page requires JavaScript rendering");
    }

    logger.info(`[Layer 1] Successfully fetched: ${url}`);
    return { url, html, success: true, method: "fetch" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug(`[Layer 1] Failed: ${message}`);
    return { url, html: "", success: false, method: "fetch", error: message };
  }
}

async function fetchWithPlaywright(
  url: string,
  config: Config
): Promise<FetchResult> {
  if (!config.playwrightEnabled) {
    return { url, html: "", success: false, method: "playwright", error: "Playwright disabled" };
  }

  try {
    logger.debug(`[Layer 2] Fetching with Playwright: ${url}`);
    
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    
    try {
      const context = await browser.newContext({
        userAgent: config.userAgent,
      });
      const page = await context.newPage();
      
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: config.playwrightTimeout,
      });

      await page.waitForTimeout(config.playwrightWait);

      const html = await page.content();
      
      await context.close();
      logger.info(`[Layer 2] Successfully fetched: ${url}`);
      return { url, html, success: true, method: "playwright" };
    } finally {
      await browser.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug(`[Layer 2] Failed: ${message}`);
    return { url, html: "", success: false, method: "playwright", error: message };
  }
}

export async function fetchUrl(url: string, config: Config): Promise<FetchResult> {
  // Layer 1: Native fetch
  let result = await fetchWithNative(url, config);
  if (result.success) return result;

  // Layer 2: Playwright (final fallback)
  result = await fetchWithPlaywright(url, config);
  if (result.success) return result;

  logger.error(`All fetch layers failed for: ${url}`);
  return {
    url,
    html: "",
    success: false,
    method: "playwright",
    error: "All fetch methods failed",
  };
}

export async function parseUrlFile(filePath: string): Promise<Array<{ url: string; filename?: string }>> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return [];
    }

    const content = await file.text();
    const lines = content.split("\n").filter((line) => line.trim());
    
    const urls: Array<{ url: string; filename?: string }> = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.startsWith("#")) {
        continue;
      }
      
      const parts = trimmed.split(/\s+/);
      const urlCandidate = parts[0];
      const filename = parts[1];
      
      try {
        new URL(urlCandidate);
        urls.push({ url: urlCandidate, filename });
      } catch {
        // Not a valid URL, skip silently
      }
    }
    
    return urls;
  } catch (error) {
    logger.error(`Failed to parse URL file: ${error}`);
    return [];
  }
}

export function isUrlListFile(filePath: string): boolean {
  return filePath.endsWith(".txt");
}

export async function detectUrlsInTextFile(filePath: string): Promise<boolean> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return false;
    }

    const content = await file.text();
    const lines = content.split("\n").filter((line) => line.trim());
    
    if (lines.length === 0) {
      return false;
    }

    let urlCount = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) continue;
      
      const urlCandidate = trimmed.split(/\s+/)[0];
      try {
        const parsed = new URL(urlCandidate);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          urlCount++;
        }
      } catch {
        // Not a URL
      }
    }

    const nonCommentLines = lines.filter(l => !l.trim().startsWith("#")).length;
    return nonCommentLines > 0 && urlCount === nonCommentLines;
  } catch {
    return false;
  }
}

export function urlToFilename(url: string, customName?: string): string {
  if (customName) {
    return customName.endsWith(".html") ? customName : `${customName}.html`;
  }

  try {
    const parsed = new URL(url);
    let name = parsed.pathname
      .replace(/^\//, "")
      .replace(/\/$/, "")
      .replace(/\//g, "_")
      .replace(/[^a-zA-Z0-9_-]/g, "_");
    
    if (!name || name === "_") {
      name = parsed.hostname.replace(/\./g, "_");
    }
    
    return `${name}.html`;
  } catch {
    return `page_${Date.now()}.html`;
  }
}
