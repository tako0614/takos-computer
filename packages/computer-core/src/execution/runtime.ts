/**
 * Runtime request stub.
 */
export async function callRuntimeRequest(
  env: { RUNTIME_HOST?: { fetch(request: Request): Promise<Response> } },
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<Response> {
  if (!env.RUNTIME_HOST) {
    throw new Error('RUNTIME_HOST binding is not available');
  }

  const request = new Request(`http://runtime${path}`, {
    method: options.method ?? 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return env.RUNTIME_HOST.fetch(request);
}
