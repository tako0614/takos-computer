// OIDC discovery + JWT/JWKS verification for the takos-computer GUI auth.
//
// Extracted from `app-auth.ts` (which keeps config / routes / session
// orchestration). This module is the self-contained, env-agnostic OIDC
// verification subsystem: `.well-known` discovery, endpoint resolution, JWKS
// fetch + key selection, ES256 / RS256 signature verification, and full
// RFC 7519 / OIDC ID token claim validation (issuer / audience / azp / nonce /
// nbf / iat / exp with clock skew).
//
// It owns the base64url decode primitives it needs (`base64UrlBytes` /
// `parseBase64UrlJson`) so the dependency direction stays one-way
// (`app-auth.ts` -> `oidc-verify.ts`); app-auth re-uses those decoders for its
// seal/unseal cookie primitives.

const CLOCK_SKEW_SECONDS = 60;

export type OidcConfig = {
  required: boolean;
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  jwksUri?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  sessionSecret?: string;
};

export type OidcDiscoveryDocument = {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
};

export type OidcEndpoints = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  jwksUri: string;
};

export type TokenResponse = {
  access_token?: string;
  id_token?: string;
};

export type UserInfoResponse = {
  user?: { id?: string; name?: string };
  sub?: string;
  name?: string;
};

export type IdTokenClaims = {
  iss?: unknown;
  sub?: unknown;
  aud?: unknown;
  azp?: unknown;
  exp?: unknown;
  iat?: unknown;
  nbf?: unknown;
  nonce?: unknown;
  name?: unknown;
  email?: unknown;
  takosumi?: {
    account_id?: unknown;
    space_id?: unknown;
    app_id?: unknown;
    role?: unknown;
  };
};

export function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/, "");
}

export function base64UrlBytes(value: string): Uint8Array | null {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
      Math.ceil(value.length / 4) * 4,
      "=",
    );
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export function parseBase64UrlJson<T>(value: string): T | null {
  try {
    const bytes = base64UrlBytes(value);
    return bytes ? JSON.parse(new TextDecoder().decode(bytes)) as T : null;
  } catch {
    return null;
  }
}

export function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export function numberClaim(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

// The discovery document and JWKS rarely change; cache them in Worker/module
// scope with a short TTL so a single login callback (which resolves endpoints
// three times — exchangeCode / verifyIdToken / fetchUserInfo) issues one
// `.well-known` fetch instead of three, and so an unauthenticated login GET
// cannot spam the issuer with one outbound discovery fetch per request.
const DISCOVERY_TTL_MS = 5 * 60 * 1000;
const JWKS_TTL_MS = 5 * 60 * 1000;
const discoveryCache = new Map<
  string,
  { doc: OidcDiscoveryDocument; expiresAt: number }
>();
const jwksCache = new Map<
  string,
  { jwks: { keys?: JsonWebKey[] }; expiresAt: number }
>();

async function discoverOidc(
  config: OidcConfig,
): Promise<OidcDiscoveryDocument> {
  if (!config.issuer) return {};
  const cached = discoveryCache.get(config.issuer);
  if (cached && cached.expiresAt > Date.now()) return cached.doc;
  const response = await fetch(
    `${config.issuer}/.well-known/openid-configuration`,
    { headers: { Accept: "application/json" } },
  ).catch(() => null);
  if (!response || !response.ok) return {};
  const body = await response.json().catch(() => null) as
    | OidcDiscoveryDocument
    | null;
  if (!body || typeof body !== "object") return {};
  if (
    typeof body.issuer === "string" &&
    normalizeIssuer(body.issuer) !== config.issuer
  ) {
    throw new Error("OIDC discovery issuer mismatch");
  }
  discoveryCache.set(config.issuer, {
    doc: body,
    expiresAt: Date.now() + DISCOVERY_TTL_MS,
  });
  return body;
}

/** Fetch the JWKS for `uri`, served from cache unless `forceRefresh`. */
async function fetchJwks(
  uri: string,
  forceRefresh = false,
): Promise<{ keys?: JsonWebKey[] }> {
  const cached = jwksCache.get(uri);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.jwks;
  }
  const response = await fetch(uri, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`OIDC JWKS fetch failed: ${response.status}`);
  }
  const jwks = await response.json() as { keys?: JsonWebKey[] };
  jwksCache.set(uri, { jwks, expiresAt: Date.now() + JWKS_TTL_MS });
  return jwks;
}

export async function oidcEndpoints(config: OidcConfig): Promise<OidcEndpoints> {
  const issuer = config.issuer!;
  // Skip discovery entirely when every endpoint is configured via env.
  if (
    config.authorizationEndpoint && config.tokenEndpoint &&
    config.userinfoEndpoint && config.jwksUri
  ) {
    return {
      authorizationEndpoint: config.authorizationEndpoint,
      tokenEndpoint: config.tokenEndpoint,
      userinfoEndpoint: config.userinfoEndpoint,
      jwksUri: config.jwksUri,
    };
  }
  const discovery = await discoverOidc(config);
  return {
    authorizationEndpoint: config.authorizationEndpoint ??
      discovery.authorization_endpoint ?? `${issuer}/oauth/authorize`,
    tokenEndpoint: config.tokenEndpoint ?? discovery.token_endpoint ??
      `${issuer}/oauth/token`,
    userinfoEndpoint: config.userinfoEndpoint ?? discovery.userinfo_endpoint ??
      `${issuer}/oauth/userinfo`,
    jwksUri: config.jwksUri ?? discovery.jwks_uri ?? `${issuer}/oauth/jwks`,
  };
}

function jwtSigningInput(parts: string[]): Uint8Array {
  return new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
}

async function verifyJwtSignature(
  input: {
    alg: string;
    jwk: JsonWebKey;
    signingInput: Uint8Array;
    signature: Uint8Array;
  },
): Promise<boolean> {
  const signature = new Uint8Array(input.signature);
  const signingInput = new Uint8Array(input.signingInput);
  if (input.alg === "ES256") {
    const key = await crypto.subtle.importKey(
      "jwk",
      input.jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature,
      signingInput,
    );
  }
  if (input.alg === "RS256") {
    const key = await crypto.subtle.importKey(
      "jwk",
      input.jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      signature,
      signingInput,
    );
  }
  return false;
}

function selectJwk(
  jwks: { keys?: JsonWebKey[] },
  header: Record<string, unknown>,
): JsonWebKey | null {
  const alg = typeof header.alg === "string" ? header.alg : undefined;
  const kid = typeof header.kid === "string" ? header.kid : undefined;
  return (jwks.keys ?? []).find((key) => {
    if (key.use && key.use !== "sig") return false;
    if (alg && key.alg && key.alg !== alg) return false;
    if (kid && (key as JsonWebKey & { kid?: string }).kid !== kid) {
      return false;
    }
    return true;
  }) ?? null;
}

function validateIdTokenClaims(
  claims: IdTokenClaims,
  config: OidcConfig,
  nonce: string,
): void {
  const now = Math.floor(Date.now() / 1000);
  if (stringClaim(claims.iss) !== config.issuer) {
    throw new Error("ID token issuer mismatch");
  }
  if (!stringClaim(claims.sub)) {
    throw new Error("ID token missing subject");
  }

  const audience = claims.aud;
  const audienceMatches = typeof audience === "string"
    ? audience === config.clientId
    : Array.isArray(audience) && audience.includes(config.clientId);
  if (!audienceMatches) throw new Error("ID token audience mismatch");
  if (Array.isArray(audience) && audience.length > 1) {
    if (stringClaim(claims.azp) !== config.clientId) {
      throw new Error("ID token authorized party mismatch");
    }
  } else if (
    claims.azp !== undefined && stringClaim(claims.azp) !== config.clientId
  ) {
    throw new Error("ID token authorized party mismatch");
  }

  const exp = numberClaim(claims.exp);
  if (!exp || exp <= now - CLOCK_SKEW_SECONDS) {
    throw new Error("ID token expired");
  }
  const nbf = numberClaim(claims.nbf);
  if (nbf && nbf > now + CLOCK_SKEW_SECONDS) {
    throw new Error("ID token not yet valid");
  }
  const iat = numberClaim(claims.iat);
  if (iat && iat > now + CLOCK_SKEW_SECONDS) {
    throw new Error("ID token issued in the future");
  }
  if (stringClaim(claims.nonce) !== nonce) {
    throw new Error("ID token nonce mismatch");
  }
}

export async function verifyIdToken(
  config: OidcConfig,
  idToken: string,
  nonce: string,
): Promise<IdTokenClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Invalid ID token format");
  const header = parseBase64UrlJson<Record<string, unknown>>(parts[0]);
  const claims = parseBase64UrlJson<IdTokenClaims>(parts[1]);
  const signature = base64UrlBytes(parts[2]);
  if (!header || !claims || !signature) throw new Error("Invalid ID token");
  const alg = typeof header.alg === "string" ? header.alg : "";
  if (!["ES256", "RS256"].includes(alg)) {
    throw new Error("Unsupported ID token algorithm");
  }
  const endpoints = await oidcEndpoints(config);
  let jwk = selectJwk(await fetchJwks(endpoints.jwksUri), header);
  if (!jwk) {
    // kid-miss: the issuer may have rotated keys since the cached fetch — force
    // one refresh before giving up.
    jwk = selectJwk(await fetchJwks(endpoints.jwksUri, true), header);
  }
  if (!jwk) throw new Error("ID token signing key not found");
  const valid = await verifyJwtSignature({
    alg,
    jwk,
    signingInput: jwtSigningInput(parts),
    signature,
  });
  if (!valid) throw new Error("ID token signature invalid");
  validateIdTokenClaims(claims, config, nonce);
  return claims;
}
