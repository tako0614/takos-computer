import { assertEquals, assert } from 'jsr:@std/assert';

import { createListenerRegistry } from '../../scheduler/listener-registry.ts';

Deno.test('listener registry - keeps current emit stable when a listener is removed during emit', () => {
  const registry = createListenerRegistry<number>();
  const callOrder: string[] = [];

  let unsubscribeSecond = () => {};

  registry.on(() => {
    callOrder.push('first');
    unsubscribeSecond();
  });
  unsubscribeSecond = registry.on(() => {
    callOrder.push('second');
  });

  registry.emit(1);
  assertEquals(callOrder, ['first', 'second']);

  callOrder.length = 0;
  registry.emit(2);
  assertEquals(callOrder, ['first']);
});

Deno.test('listener registry - defers listeners added during emit until the next emit cycle', () => {
  const registry = createListenerRegistry<number>();
  const callOrder: string[] = [];

  const lateListener = () => {
    callOrder.push('late');
  };

  registry.on(() => {
    callOrder.push('first');
    registry.on(lateListener);
  });

  registry.emit(1);
  assertEquals(callOrder, ['first']);

  callOrder.length = 0;
  registry.emit(2);
  assertEquals(callOrder, ['first', 'late']);
});

Deno.test('listener registry - continues calling remaining listeners even if an earlier listener throws', () => {
  const registry = createListenerRegistry<number>();
  const callOrder: string[] = [];

  registry.on(() => {
    callOrder.push('first');
    throw new Error('listener failed');
  });
  registry.on(() => {
    callOrder.push('second');
  });
  registry.on(() => {
    callOrder.push('third');
  });

  // Should not throw
  try {
    registry.emit(1);
  } catch {
    // If it throws, the test logic below will catch the issue
  }
  assertEquals(callOrder, ['first', 'second', 'third']);
});
