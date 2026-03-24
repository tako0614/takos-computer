/**
 * Structured logger for the computer-core package.
 *
 * Minimal port of the control-specific logger. Provides:
 *  - logDebug / logInfo / logWarn / logError
 *  - safeJsonParse / safeJsonParseOrDefault
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  module?: string;
  requestId?: string;
  userId?: string;
  action?: string;
  [key: string]: unknown;
}

function formatMessage(level: LogLevel, message: string, context?: LogContext): string {
  const ts = new Date().toISOString();
  const mod = context?.module ? ` [${context.module}]` : '';
  return `${ts} ${level.toUpperCase()}${mod} ${message}`;
}

export function logDebug(message: string, context?: LogContext): void {
  // eslint-disable-next-line no-console
  console.debug(formatMessage('debug', message, context));
}

export function logInfo(message: string, context?: LogContext): void {
  // eslint-disable-next-line no-console
  console.info(formatMessage('info', message, context));
}

export function logWarn(message: string, context?: LogContext): void {
  // eslint-disable-next-line no-console
  console.warn(formatMessage('warn', message, context));
}

export function logError(message: string, detail?: unknown, context?: LogContext): void {
  const detailStr = detail !== undefined
    ? typeof detail === 'string'
      ? detail
      : detail instanceof Error
        ? detail.message
        : JSON.stringify(detail)
    : '';
  // eslint-disable-next-line no-console
  console.error(formatMessage('error', `${message}${detailStr ? ` — ${detailStr}` : ''}`, context));
}

export function createLogger(module: string) {
  return {
    debug: (msg: string, ctx?: LogContext) => logDebug(msg, { ...ctx, module }),
    info: (msg: string, ctx?: LogContext) => logInfo(msg, { ...ctx, module }),
    warn: (msg: string, ctx?: LogContext) => logWarn(msg, { ...ctx, module }),
    error: (msg: string, detail?: unknown, ctx?: LogContext) => logError(msg, detail, { ...ctx, module }),
  };
}

// --- JSON parsing helpers ---

export function safeJsonParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

export function safeJsonParseOrDefault<T>(json: string | null | undefined, defaultValue: T): T {
  if (!json) return defaultValue;
  try {
    return JSON.parse(json) as T;
  } catch {
    return defaultValue;
  }
}
