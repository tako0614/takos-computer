import { assertEquals } from 'jsr:@std/assert';
import * as agentCore from '../index.ts';

Deno.test('agent-core exports - exports executeRunInContainer function', () => {
  assertEquals(typeof agentCore.executeRunInContainer, 'function');
});

Deno.test('agent-core exports - exports parseStartPayload function', () => {
  assertEquals(typeof agentCore.parseStartPayload, 'function');
});

Deno.test('agent-core exports - exports createConcurrencyGuard function', () => {
  assertEquals(typeof agentCore.createConcurrencyGuard, 'function');
});

Deno.test('agent-core exports - exports installGracefulShutdown function', () => {
  assertEquals(typeof agentCore.installGracefulShutdown, 'function');
});
