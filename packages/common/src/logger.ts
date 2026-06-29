/**
 * Structured Logger for Takos Platform
 *
 * Zero-dependency structured logging compatible with Cloudflare Workers.
 * Emits one JSON line per call to the level-appropriate console method so
 * observability picks up the correct severity.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function formatData(
  data?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = serialize(value);
  }
  return result;
}

export function createLogger(opts?: { service?: string }): Logger {
  const service = opts?.service;
  const emit = (
    level: LogLevel,
    msg: string,
    data?: Record<string, unknown>,
  ): void => {
    const line = JSON.stringify({
      level,
      msg,
      ts: new Date().toISOString(),
      ...(service ? { service } : {}),
      ...formatData(data),
    });
    if (level === "warn") {
      console.warn(line);
    } else if (level === "error") {
      console.error(line);
    } else {
      // eslint-disable-next-line no-console -- logger implementation
      console.log(line);
    }
  };
  return {
    debug: (msg, data) => emit("debug", msg, data),
    info: (msg, data) => emit("info", msg, data),
    warn: (msg, data) => emit("warn", msg, data),
    error: (msg, data) => emit("error", msg, data),
  };
}
