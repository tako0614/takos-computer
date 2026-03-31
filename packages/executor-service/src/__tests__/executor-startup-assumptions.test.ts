import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { spy, assertSpyCalls } from 'jsr:@std/testing/mock';

import {
  buildExecutorRuntimeConfig,
  buildRuntimeStartPayload,
  createExecutorApp,
  hasControlRpcConfiguration,
} from '../executor-app.ts';

const ORIGINAL_ENV = {
  PROXY_BASE_URL: Deno.env.get('PROXY_BASE_URL'),
  CONTROL_RPC_BASE_URL: Deno.env.get('CONTROL_RPC_BASE_URL'),
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
}

Deno.test('executor startup assumptions - treats CONTROL_RPC_BASE_URL as sufficient canonical startup configuration', () => {
  try {
    assertEquals(hasControlRpcConfiguration(buildExecutorRuntimeConfig({ CONTROL_RPC_BASE_URL: 'http://control-rpc.internal' })), true);
    assertEquals(hasControlRpcConfiguration(buildExecutorRuntimeConfig({ PROXY_BASE_URL: 'http://proxy.internal' })), false);
    assertEquals(hasControlRpcConfiguration(buildExecutorRuntimeConfig({})), false);
  } finally {
    restoreEnv();
  }
});

Deno.test('executor startup assumptions - builds start payloads with canonical Control RPC routing', () => {
  try {
    assertEquals(buildRuntimeStartPayload({
      runId: 'run-1',
      workerId: 'worker-1',
      controlRpcToken: 'control-token',
    }, buildExecutorRuntimeConfig({
      CONTROL_RPC_BASE_URL: 'http://control-rpc.internal',
    })), {
      runId: 'run-1',
      workerId: 'worker-1',
      controlRpcToken: 'control-token',
      controlRpcBaseUrl: 'http://control-rpc.internal',
      shutdownSignal: undefined,
    });

    assertEquals(buildRuntimeStartPayload({
      runId: 'run-2',
      workerId: 'worker-2',
      controlRpcToken: 'control-token',
    }, buildExecutorRuntimeConfig({
      PROXY_BASE_URL: 'http://proxy.internal',
      CONTROL_RPC_BASE_URL: 'http://control-rpc.internal',
    })), {
      runId: 'run-2',
      workerId: 'worker-2',
      controlRpcToken: 'control-token',
      controlRpcBaseUrl: 'http://control-rpc.internal',
      shutdownSignal: undefined,
    });

    assertEquals(buildRuntimeStartPayload({
      runId: 'run-3',
      workerId: 'worker-3',
      controlRpcToken: 'control-token',
    }, buildExecutorRuntimeConfig({
      PROXY_BASE_URL: 'http://proxy.internal',
    })), {
      runId: 'run-3',
      workerId: 'worker-3',
      controlRpcToken: 'control-token',
      controlRpcBaseUrl: undefined,
      shutdownSignal: undefined,
    });
  } finally {
    restoreEnv();
  }
});

Deno.test('executor startup assumptions - rejects /start when neither CONTROL_RPC_BASE_URL nor PROXY_BASE_URL is configured', async () => {
  Deno.env.delete('CONTROL_RPC_BASE_URL');
  Deno.env.delete('PROXY_BASE_URL');

  try {
    const executeRunInContainer = spy(async () => undefined);
    const app = createExecutorApp({
      executeRunInContainer,
      logger: {
        info: spy(),
        warn: spy(),
        error: spy(),
      },
      runtimeConfig: buildExecutorRuntimeConfig({}),
    });

    const response = await app.fetch(new Request('http://localhost/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-1',
        workerId: 'worker-1',
        controlRpcToken: 'control-token',
      }),
    }));

    assertEquals(response.status, 503);
    assertEquals(await response.json(), {
      error: 'CONTROL_RPC_BASE_URL not configured',
    });
    assertSpyCalls(executeRunInContainer, 0);
  } finally {
    restoreEnv();
  }
});

Deno.test('executor startup assumptions - accepts /start with CONTROL_RPC_BASE_URL only', async () => {
  Deno.env.set('CONTROL_RPC_BASE_URL', 'http://control-rpc.internal');
  Deno.env.delete('PROXY_BASE_URL');

  try {
    const executeRunInContainer = spy(async () => undefined);
    const app = createExecutorApp({
      executeRunInContainer,
      logger: {
        info: spy(),
        warn: spy(),
        error: spy(),
      },
      runtimeConfig: buildExecutorRuntimeConfig({
        CONTROL_RPC_BASE_URL: 'http://control-rpc.internal',
      }),
    });

    const response = await app.fetch(new Request('http://localhost/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-2',
        workerId: 'worker-2',
        controlRpcToken: 'control-token',
      }),
    }));

    assertEquals(response.status, 202);
    assertEquals(await response.json(), {
      status: 'accepted',
      runId: 'run-2',
    });
    assertSpyCalls(executeRunInContainer, 1);
  } finally {
    restoreEnv();
  }
});

Deno.test('executor startup assumptions - rejects /start when only PROXY_BASE_URL is configured', async () => {
  Deno.env.set('PROXY_BASE_URL', 'http://proxy.internal');
  Deno.env.delete('CONTROL_RPC_BASE_URL');

  try {
    const executeRunInContainer = spy(async () => undefined);
    const app = createExecutorApp({
      executeRunInContainer,
      logger: {
        info: spy(),
        warn: spy(),
        error: spy(),
      },
      runtimeConfig: buildExecutorRuntimeConfig({
        PROXY_BASE_URL: 'http://proxy.internal',
      }),
    });

    const response = await app.fetch(new Request('http://localhost/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-3',
        workerId: 'worker-3',
        controlRpcToken: 'control-token',
      }),
    }));

    assertEquals(response.status, 503);
    assertEquals(await response.json(), {
      error: 'CONTROL_RPC_BASE_URL not configured',
    });
    assertSpyCalls(executeRunInContainer, 0);
  } finally {
    restoreEnv();
  }
});
