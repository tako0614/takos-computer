/**
 * Generate a cryptographically random proxy token (32 bytes, base64url-encoded).
 * Used for container to host proxy auth in sandbox sessions.
 */
export function generateProxyToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
