/**
 * Kreuzberg Batch Processor - Logger
 * Simple console logger with levels
 */

import type { Logger, LogLevel } from "./types";

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
  green: "\x1b[32m",
};

/**
 * Create a logger instance
 */
export function createLogger(level: LogLevel = "info"): Logger {
  const currentLevel = LOG_LEVELS[level];

  const formatTime = (): string => {
    return new Date().toISOString().replace("T", " ").substring(0, 19);
  };

  const log = (
    msgLevel: LogLevel,
    color: string,
    prefix: string,
    message: string,
    ...args: unknown[]
  ): void => {
    if (LOG_LEVELS[msgLevel] <= currentLevel) {
      const time = formatTime();
      const formattedArgs = args.length > 0 ? " " + JSON.stringify(args) : "";
      console.log(`${COLORS.gray}[${time}]${COLORS.reset} ${color}${prefix}${COLORS.reset} ${message}${formattedArgs}`);
    }
  };

  return {
    error: (message: string, ...args: unknown[]) =>
      log("error", COLORS.red, "[ERROR]", message, ...args),
    warn: (message: string, ...args: unknown[]) =>
      log("warn", COLORS.yellow, "[WARN] ", message, ...args),
    info: (message: string, ...args: unknown[]) =>
      log("info", COLORS.blue, "[INFO] ", message, ...args),
    debug: (message: string, ...args: unknown[]) =>
      log("debug", COLORS.gray, "[DEBUG]", message, ...args),
  };
}

/**
 * Global logger instance
 */
export const logger = createLogger(
  (process.env.LOG_LEVEL as LogLevel) || "info"
);
