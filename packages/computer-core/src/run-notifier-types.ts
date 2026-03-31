/**
 * Run notifier types used by the agent runner.
 *
 * Extracted from takos/packages/control/src/application/services/run-notifier/.
 */

import type { RunStatus } from './shared/types.ts';

export type RunTerminalEventType = 'completed' | 'error' | 'cancelled' | 'run.failed';
export type RunTerminalStatus = 'completed' | 'failed' | 'cancelled';

export type RunTerminalPayload = {
  status: RunTerminalStatus;
  run: {
    id: string;
    session_id: string | null;
  };
} & Record<string, unknown>;

export function buildTerminalPayload(
  runId: string,
  status: RunTerminalStatus,
  details: Record<string, unknown> = {},
  sessionId: string | null = null,
): RunTerminalPayload {
  return {
    status,
    run: {
      id: runId,
      session_id: sessionId,
    },
    ...details,
  };
}

export interface RunNotifierEmitPayload<TData = unknown> {
  runId: string;
  type: string;
  data: TData;
  event_id?: number;
}

export function buildRunNotifierEmitPayload<TData>(
  runId: string,
  type: string,
  data: TData,
  eventId?: number | null,
): RunNotifierEmitPayload<TData> {
  if (eventId) {
    return { runId, type, data, event_id: eventId };
  }
  return { runId, type, data };
}

export function buildRunNotifierEmitRequest(payload: RunNotifierEmitPayload): Request {
  return new Request('http://do/emit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getRunNotifierStub(env: { RUN_NOTIFIER?: { idFromName(name: string): unknown; get(id: unknown): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } } }, runId: string) {
  if (!env.RUN_NOTIFIER) {
    throw new Error('RUN_NOTIFIER binding not available');
  }
  const id = env.RUN_NOTIFIER.idFromName(runId);
  return env.RUN_NOTIFIER.get(id);
}
