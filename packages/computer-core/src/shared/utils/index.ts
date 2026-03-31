/**
 * Shared utilities extracted from takos/packages/control/src/shared/utils.
 *
 * Only functions consumed by the agent runner are included.
 */

// --- Date/time utilities ---

export function now(): string {
  return new Date().toISOString();
}

export function toIsoString(value: string | Date): string;
export function toIsoString(value: string | Date | null | undefined): string | null;
export function toIsoString(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

// --- ID generation ---

export function generateId(length = 21): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

// --- JSON parsing ---

export { safeJsonParse, safeJsonParseOrDefault } from './logger.ts';
