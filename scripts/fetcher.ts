/**
 * Kreuzberg Batch Processor - URL Fetcher
 * 3-layer fetching: Native Fetch → Playwright → Browserless
 */

import type { Config, FetchResult } from "./types";
import { logger } from "./logger";

/**
 * Layer 1: Native Fetch (fastest, for static pages)
 */
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
    
    // Check if page requires JavaScript (common indicators)
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

/**
 * Layer 2: Playwright (for JS-rendered pages)
 */
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

      // Wait for dynamic content
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

/**
 * Layer 3: Browserless (REST API, for complex pages)
 */
async function fetchWithBrowserless(
  url: string,
  config: Config
): Promise<FetchResult> {
  if (!config.browserlessEnabled) {
    return { url, html: "", success: false, method: "browserless", error: "Browserless disabled" };
  }

  try {
    logger.debug(`[Layer 3] Fetching with Browserless: ${url}`);
    
    const browserlessUrl = `${config.browserlessUrl}/content`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    
    if (config.browserlessToken) {
      headers["Authorization"] = `Bearer ${config.browserlessToken}`;
    }

    const response = await fetch(browserlessUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url,
        waitForTimeout: config.playwrightWait,
        gotoOptions: {
          waitUntil: "networkidle2",
          timeout: config.playwrightTimeout,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Browserless HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    
    logger.info(`[Layer 3] Successfully fetched: ${url}`);
    return { url, html, success: true, method: "browserless" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug(`[Layer 3] Failed: ${message}`);
    return { url, html: "", success: false, method: "browserless", error: message };
  }
}

/**
 * Fetch URL with 3-layer fallback
 */
export async function fetchUrl(url: string, config: Config): Promise<FetchResult> {
  // Layer 1: Native Fetch
  let result = await fetchWithNative(url, config);
  if (result.success) return result;

  // Layer 2: Playwright
  result = await fetchWithPlaywright(url, config);
  if (result.success) return result;

  // Layer 3: Browserless
  result = await fetchWithBrowserless(url, config);
  if (result.success) return result;

  // All layers failed
  logger.error(`All fetch layers failed for: ${url}`);
  return {
    url,
    html: "",
    success: false,
    method: "browserless",
    error: "All fetch methods failed",
  };
}

/**
 * Parse URLs from urls.txt file
 */
export async function parseUrlFile(filePath: string): Promise<Array<{ url: string; filename?: string }>> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return [];
    }

    const content = await file.text();
    const lines = content.split("\n").filter((line) => line.trim());
    
    return lines.map((line) => {
      const trimmed = line.trim();
      
      // Skip comments
      if (trimmed.startsWith("#")) {
        return null;
      }
      
      // Format: URL [optional_filename]
      // Example: https://example.com/page my-page
      const parts = trimmed.split(/\s+/);
      const url = parts[0];
      const filename = parts[1];
      
      // Validate URL
      try {
        new URL(url);
        return { url, filename };
      } catch {
        logger.warn(`Invalid URL skipped: ${url}`);
        return null;
      }
    }).filter((entry): entry is { url: string; filename?: string } => entry !== null);
  } catch (error) {
    logger.error(`Failed to parse URL file: ${error}`);
    return [];
  }
}

/**
 * Generate filename from URL
 */
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
