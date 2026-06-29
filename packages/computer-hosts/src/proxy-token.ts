import { randomBase64UrlToken } from "@takos-computer/common/crypto";

/**
 * Generate a cryptographically random proxy token (32 bytes, base64url-encoded).
 * Used for container to host proxy auth in sandbox sessions.
 */
export function generateProxyToken(): string {
  return randomBase64UrlToken(32);
}
