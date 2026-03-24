/**
 * Run creation stub.
 */

export interface CreateThreadRunResult {
  ok: boolean;
  run?: { id: string };
  error?: string;
}

export async function createThreadRun(
  _env: unknown,
  _input: {
    userId: string;
    threadId: string;
    agentType: string;
    input: Record<string, unknown>;
    parentRunId?: string;
    model?: string;
  },
): Promise<CreateThreadRunResult> {
  throw new Error('createThreadRun not implemented in computer-core');
}
