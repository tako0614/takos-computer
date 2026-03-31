import { assertEquals, assert } from 'jsr:@std/assert';
import {
  parseStartPayload,
  createConcurrencyGuard,
} from '../executor-utils.ts';

// ---------------------------------------------------------------------------
// parseStartPayload
// ---------------------------------------------------------------------------

Deno.test('parseStartPayload - accepts a valid payload with required fields', () => {
  const validPayload = {
    runId: 'run-123',
    workerId: 'worker-abc',
    controlRpcToken: 'tok_secret',
  };
  const result = parseStartPayload(validPayload);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.payload.runId, 'run-123');
    assertEquals(result.payload.serviceId, 'worker-abc');
    assertEquals(result.payload.workerId, 'worker-abc');
    assertEquals(result.payload.controlRpcToken, 'tok_secret');
  }
});

Deno.test('parseStartPayload - accepts serviceId without workerId and normalizes workerId for compatibility', () => {
  const result = parseStartPayload({
    runId: 'run-123',
    serviceId: 'service-abc',
    controlRpcToken: 'tok_secret',
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.payload.serviceId, 'service-abc');
    assertEquals(result.payload.workerId, 'service-abc');
  }
});

Deno.test('parseStartPayload - accepts optional string fields', () => {
  const validPayload = {
    runId: 'run-123',
    workerId: 'worker-abc',
    controlRpcToken: 'tok_secret',
  };
  const result = parseStartPayload({
    ...validPayload,
    model: 'gpt-4',
    controlRpcBaseUrl: 'https://control.example.com',
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.payload.model, 'gpt-4');
    assertEquals(result.payload.controlRpcBaseUrl, 'https://control.example.com');
  }
});

Deno.test('parseStartPayload - returns model as undefined when not provided', () => {
  const validPayload = {
    runId: 'run-123',
    workerId: 'worker-abc',
    controlRpcToken: 'tok_secret',
  };
  const result = parseStartPayload(validPayload);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.payload.model, undefined);
    assertEquals(result.payload.controlRpcBaseUrl, undefined);
  }
});

Deno.test('parseStartPayload - rejects null body', () => {
  const result = parseStartPayload(null);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error, 'Request body must be a JSON object');
  }
});

Deno.test('parseStartPayload - rejects array body', () => {
  const result = parseStartPayload([1, 2, 3]);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error, 'Request body must be a JSON object');
  }
});

Deno.test('parseStartPayload - rejects non-object body', () => {
  const result = parseStartPayload('string');
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error, 'Request body must be a JSON object');
  }
});

Deno.test('parseStartPayload - rejects number body', () => {
  const result = parseStartPayload(42);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error, 'Request body must be a JSON object');
  }
});

Deno.test('parseStartPayload - rejects missing runId', () => {
  const result = parseStartPayload({ workerId: 'w', controlRpcToken: 'tok' });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error, 'Missing required field: runId');
  }
});

Deno.test('parseStartPayload - rejects empty runId', () => {
  const result = parseStartPayload({ runId: '', workerId: 'w', controlRpcToken: 'tok' });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error, 'Missing required field: runId');
  }
});

Deno.test('parseStartPayload - rejects non-string runId', () => {
  const result = parseStartPayload({ runId: 123, workerId: 'w', controlRpcToken: 'tok' });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error, 'Missing required field: runId');
  }
});

Deno.test('parseStartPayload - rejects missing workerId', () => {
  const result = parseStartPayload({ runId: 'r', controlRpcToken: 'tok' });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error, 'Missing required field: serviceId or workerId');
  }
});

Deno.test('parseStartPayload - rejects empty workerId', () => {
  const result = parseStartPayload({ runId: 'r', workerId: '', controlRpcToken: 'tok' });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error, 'Missing required field: serviceId or workerId');
  }
});

Deno.test('parseStartPayload - rejects missing controlRpcToken', () => {
  const result = parseStartPayload({ runId: 'r', workerId: 'w' });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error, 'Missing required field: controlRpcToken');
  }
});

Deno.test('parseStartPayload - rejects empty controlRpcToken', () => {
  const result = parseStartPayload({ runId: 'r', workerId: 'w', controlRpcToken: '' });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error, 'Missing required field: controlRpcToken');
  }
});

Deno.test('parseStartPayload - rejects non-string model', () => {
  const validPayload = {
    runId: 'run-123',
    workerId: 'worker-abc',
    controlRpcToken: 'tok_secret',
  };
  const result = parseStartPayload({ ...validPayload, model: 123 });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error, 'model must be a string when provided');
  }
});

Deno.test('parseStartPayload - rejects non-string controlRpcBaseUrl', () => {
  const validPayload = {
    runId: 'run-123',
    workerId: 'worker-abc',
    controlRpcToken: 'tok_secret',
  };
  const result = parseStartPayload({ ...validPayload, controlRpcBaseUrl: true });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error, 'controlRpcBaseUrl must be a string when provided');
  }
});

Deno.test('parseStartPayload - ignores extra unknown fields', () => {
  const validPayload = {
    runId: 'run-123',
    workerId: 'worker-abc',
    controlRpcToken: 'tok_secret',
  };
  const result = parseStartPayload({ ...validPayload, extra: 'field', another: 42 });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.payload.runId, 'run-123');
  }
});

// ---------------------------------------------------------------------------
// createConcurrencyGuard
// ---------------------------------------------------------------------------

Deno.test('createConcurrencyGuard - creates a guard with correct max', () => {
  const guard = createConcurrencyGuard(3);
  assertEquals(guard.maxConcurrentRuns, 3);
  assertEquals(guard.activeRuns, 0);
  assertEquals(guard.available, 3);
});

Deno.test('createConcurrencyGuard - tryAcquire increments active runs', () => {
  const guard = createConcurrencyGuard(2);
  assertEquals(guard.tryAcquire(), true);
  assertEquals(guard.activeRuns, 1);
  assertEquals(guard.available, 1);
});

Deno.test('createConcurrencyGuard - tryAcquire returns false when at capacity', () => {
  const guard = createConcurrencyGuard(2);
  assertEquals(guard.tryAcquire(), true);
  assertEquals(guard.tryAcquire(), true);
  assertEquals(guard.tryAcquire(), false);
  assertEquals(guard.activeRuns, 2);
  assertEquals(guard.available, 0);
});

Deno.test('createConcurrencyGuard - release decrements active runs', () => {
  const guard = createConcurrencyGuard(2);
  guard.tryAcquire();
  guard.tryAcquire();
  guard.release();
  assertEquals(guard.activeRuns, 1);
  assertEquals(guard.available, 1);
});

Deno.test('createConcurrencyGuard - release clamps at 0 (does not go negative)', () => {
  const guard = createConcurrencyGuard(1);
  guard.release();
  assertEquals(guard.activeRuns, 0);
  assertEquals(guard.available, 1);
});

Deno.test('createConcurrencyGuard - allows acquire after release frees capacity', () => {
  const guard = createConcurrencyGuard(1);
  guard.tryAcquire();
  assertEquals(guard.tryAcquire(), false);
  guard.release();
  assertEquals(guard.tryAcquire(), true);
  assertEquals(guard.activeRuns, 1);
});

Deno.test('createConcurrencyGuard - works with maxConcurrentRuns of 0', () => {
  const guard = createConcurrencyGuard(0);
  assertEquals(guard.maxConcurrentRuns, 0);
  assertEquals(guard.available, 0);
  assertEquals(guard.tryAcquire(), false);
});

Deno.test('createConcurrencyGuard - handles many acquire/release cycles', () => {
  const guard = createConcurrencyGuard(3);
  for (let i = 0; i < 100; i++) {
    guard.tryAcquire();
    guard.release();
  }
  assertEquals(guard.activeRuns, 0);
  assertEquals(guard.available, 3);
});
