/**
 * Message offload stubs.
 */
export function makeMessagePreview(content: string): string {
  return content.length > 500 ? content.slice(0, 500) + '...' : content;
}

export function shouldOffloadMessage(_msg: { role: string; content: string }): boolean {
  return false;
}

export async function writeMessageToR2(
  _bucket: unknown,
  _threadId: string,
  _messageId: string,
  _payload: Record<string, unknown>,
): Promise<{ key: string }> {
  throw new Error('writeMessageToR2 not implemented in computer-core');
}

export async function readMessageFromR2(
  _bucket: unknown,
  _key: string,
): Promise<{
  id: string;
  thread_id: string;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  metadata: string | null;
} | null> {
  return null;
}
