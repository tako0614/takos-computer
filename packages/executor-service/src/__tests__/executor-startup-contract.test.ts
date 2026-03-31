import { assertEquals, assertRejects, assertNotEquals } from 'jsr:@std/assert';
import { spy, assertSpyCalls } from 'jsr:@std/testing/mock';

import {
  buildExecutorRuntimeConfig,
  buildRuntimeStartPayload,
  createExecutorApp,
  hasControlRpcConfiguration,
} from '../executor-app.ts';

const ORIGINAL_ENV = {
  CONTROL_RPC_BASE_URL: Deno.env.get('CONTROL_RPC_BASE_URL'),
  PROXY_BASE_URL: Deno.env.get('PROXY_BASE_URL'),
};

function restoreEnv() {
  if (ORIGINAL_ENV.CONTROL_RPC_BASE_URL === undefined) {
    Deno.env.delete('CONTROL_RPC_BASE_URL');
  } else {
    Deno.env.set('CONTROL_RPC_BASE_URL', ORIGINAL_ENV.CONTROL_RPC_BASE_URL);
  }

  if (ORIGINAL_ENV.PROXY_BASE_URL === undefined) {
    Deno.env.delete('PROXY_BASE_URL');
  } else {
    Deno.env.set('PROXY_BASE_URL', ORIGINAL_ENV.PROXY_BASE_URL);
  }
}

Deno.test('executor startup control RPC contract - treats CONTROL_RPC_BASE_URL as the canonical startup requirement', () => {
  try {
    assertEquals(hasControlRpcConfiguration(buildExecutorRuntimeConfig({
      CONTROL_RPC_BASE_URL: 'https://control-rpc.example.internal',
    })), true);

    assertEquals(hasControlRpcConfiguration(buildExecutorRuntimeConfig({
      PROXY_BASE_URL: 'https://executor-proxy.example.internal',
    })), false);
  } finally {
    restoreEnv();
  }
});

Deno.test('executor startup control RPC contract - builds runtime payloads from CONTROL_RPC_BASE_URL without proxy fallback', () => {
  try {
    const payload = buildRuntimeStartPayload({
      runId: 'run-1',
      workerId: 'worker-1',
      controlRpcToken: 'control-token',
      controlRpcBaseUrl: 'https://caller-supplied.example.internal',
    }, buildExecutorRuntimeConfig({
      CONTROL_RPC_BASE_URL: 'https://control-rpc.example.internal',
      PROXY_BASE_URL: 'https://executor-proxy.example.internal',
    }));

    assertEquals(payload.controlRpcBaseUrl, 'https://control-rpc.example.internal');
    assertEquals('proxyBaseUrl' in payload, false);

    const payloadWithoutControlRpc = buildRuntimeStartPayload({
      runId: 'run-2',
      workerId: 'worker-2',
      controlRpcToken: 'control-token',
    }, buildExecutorRuntimeConfig({
      PROXY_BASE_URL: 'https://executor-proxy.example.internal',
    }));

    assertEquals(payloadWithoutControlRpc.controlRpcBaseUrl, undefined);
    assertEquals('proxyBaseUrl' in payloadWithoutControlRpc, false);
  } finally {
    restoreEnv();
  }
});

Deno.test('executor startup control RPC contract - rejects /start when only PROXY_BASE_URL is configured', async () => {
  Deno.env.delete('CONTROL_RPC_BASE_URL');
  Deno.env.set('PROXY_BASE_URL', 'https://executor-proxy.example.internal');

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
        PROXY_BASE_URL: 'https://executor-proxy.example.internal',
      }),
    });

    const response = await app.fetch(new Request('http://localhost/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-1',
        workerId: 'worker-1',
        controlRpcToken: 'control-token',
      }),
    }));

    assertEquals(response.status, 503);
    assertEquals(await response.json(), { error: 'CONTROL_RPC_BASE_URL not configured' });
    assertSpyCalls(executeRunInContainer, 0);
  } finally {
    restoreEnv();
  }
});

Deno.test('executor startup control RPC contract - accepts /start when CONTROL_RPC_BASE_URL is configured', async () => {
  Deno.env.set('CONTROL_RPC_BASE_URL', 'https://control-rpc.example.internal');
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
        CONTROL_RPC_BASE_URL: 'https://control-rpc.example.internal',
      }),
    });

    const response = await app.fetch(new Request('http://localhost/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-1',
        workerId: 'worker-1',
        controlRpcToken: 'control-token',
      }),
    }));

    assertEquals(response.status, 202);
    assertEquals(await response.json(), { status: 'accepted', runId: 'run-1' });
    assertSpyCalls(executeRunInContainer, 1);
  } finally {
    restoreEnv();
  }
});
