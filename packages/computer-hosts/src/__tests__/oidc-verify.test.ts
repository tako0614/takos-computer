import { expect, test } from "bun:test";
import { oidcEndpoints, type OidcConfig } from "../oidc-verify.ts";

async function withFetch<T>(
  fakeFetch: typeof globalThis.fetch,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", {
    value: fakeFetch,
    configurable: true,
  });
  try {
    return await fn();
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      value: original,
      configurable: true,
    });
  }
}

test("oidcEndpoints skips discovery when all endpoints are env-configured", async () => {
  let fetched = 0;
  const config: OidcConfig = {
    required: true,
    issuer: "https://issuer-fullenv.example",
    authorizationEndpoint: "https://issuer-fullenv.example/a",
    tokenEndpoint: "https://issuer-fullenv.example/t",
    userinfoEndpoint: "https://issuer-fullenv.example/u",
    jwksUri: "https://issuer-fullenv.example/j",
  };
  const endpoints = await withFetch(
    (() => {
      fetched += 1;
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof globalThis.fetch,
    () => oidcEndpoints(config),
  );
  expect(fetched).toEqual(0);
  expect(endpoints.tokenEndpoint).toEqual("https://issuer-fullenv.example/t");
});

test("oidcEndpoints caches the discovery document across calls", async () => {
  // Unique issuer so this test is independent of module-cache state.
  const issuer = `https://issuer-cache-${crypto.randomUUID()}.example`;
  let discoveryFetches = 0;
  const config: OidcConfig = { required: true, issuer };

  const fakeFetch = ((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/.well-known/openid-configuration")) {
      discoveryFetches += 1;
      return Promise.resolve(Response.json({
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        userinfo_endpoint: `${issuer}/oauth/userinfo`,
        jwks_uri: `${issuer}/oauth/jwks`,
      }));
    }
    return Promise.resolve(Response.json({ error: "unexpected" }, {
      status: 404,
    }));
  }) as unknown as typeof globalThis.fetch;

  await withFetch(fakeFetch, async () => {
    const first = await oidcEndpoints(config);
    const second = await oidcEndpoints(config);
    const third = await oidcEndpoints(config);
    expect(first.tokenEndpoint).toEqual(`${issuer}/oauth/token`);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  // Three endpoint resolutions (mirrors one login callback) -> one fetch.
  expect(discoveryFetches).toEqual(1);
});
