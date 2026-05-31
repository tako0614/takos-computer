import { expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";

import { verifyServiceToken } from "../jwt.ts";

function generateTestKeyPair(modulusLength = 1024) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { privateKey, publicKey };
}

/**
 * Local helper to sign test tokens (not exported, only for test use)
 */
function signTestToken(options: {
  issuer: string;
  subject: string;
  audience: string;
  privateKey: string;
  kid?: string;
  expiresInSeconds?: number;
  customClaims?: Record<string, unknown>;
}): string {
  const {
    issuer,
    subject,
    audience,
    privateKey,
    kid,
    expiresInSeconds = 60,
    customClaims = {},
  } = options;

  const now = Math.floor(Date.now() / 1000);

  const header: Record<string, string> = { alg: "RS256", typ: "JWT" };
  if (kid) header.kid = kid;

  const RESERVED_CLAIMS = new Set(["iss", "sub", "aud", "iat", "exp", "jti"]);
  const filteredCustomClaims: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(customClaims)) {
    if (!RESERVED_CLAIMS.has(key)) {
      filteredCustomClaims[key] = value;
    }
  }

  const payload = {
    ...filteredCustomClaims,
    iss: issuer,
    sub: subject,
    aud: audience,
    iat: now,
    exp: now + expiresInSeconds,
    jti: crypto.randomBytes(16).toString("base64url"),
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    "base64url",
  );
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);
  sign.end();
  const signature = sign.sign(privateKey);
  const encodedSignature = signature.toString("base64url");

  return `${signingInput}.${encodedSignature}`;
}

function decodeToken(
  token: string,
):
  | { header: Record<string, unknown>; payload: Record<string, unknown> }
  | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf-8"),
    );
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    );
    return { header, payload };
  } catch {
    return null;
  }
}

test("service JWT - signs and verifies a valid RS256 token", () => {
  const { privateKey, publicKey } = generateTestKeyPair(1024);

  const token = signTestToken({
    issuer: "takos-control",
    subject: "service-runtime",
    audience: "takos-runtime",
    privateKey,
    expiresInSeconds: 120,
    customClaims: { role: "internal" },
  });

  const result = verifyServiceToken({
    token,
    publicKey,
    expectedAudience: "takos-runtime",
    expectedIssuer: "takos-control",
  });

  expect(result.valid).toEqual(true);
  expect(result.payload?.sub).toEqual("service-runtime");
  expect(result.payload?.role).toEqual("internal");
});

test("service JWT - rejects token when audience mismatches", () => {
  const { privateKey, publicKey } = generateTestKeyPair(1024);

  const token = signTestToken({
    issuer: "takos-control",
    subject: "service-runtime",
    audience: "takos-runtime",
    privateKey,
  });

  const result = verifyServiceToken({
    token,
    publicKey,
    expectedAudience: "different-service",
    expectedIssuer: "takos-control",
  });

  expect(result.valid).toEqual(false);
  expect(result.error?.includes("Invalid audience")).toBeTruthy();
});

test("service JWT - rejects tampered token payload", () => {
  const { privateKey, publicKey } = generateTestKeyPair(1024);

  const token = signTestToken({
    issuer: "takos-control",
    subject: "service-runtime",
    audience: "takos-runtime",
    privateKey,
  });

  const [header, payload, signature] = token.split(".");
  const tamperedPayload = Buffer.from(JSON.stringify({ aud: "evil" })).toString(
    "base64url",
  );
  const tamperedToken = [header, tamperedPayload, signature].join(".");

  const result = verifyServiceToken({
    token: tamperedToken,
    publicKey,
    expectedAudience: "takos-runtime",
    expectedIssuer: "takos-control",
  });

  expect(result.valid).toEqual(false);
  expect(result.error).toEqual("Invalid signature");
  expect(payload).not.toEqual(tamperedPayload);
});

test("service JWT - returns null for malformed token in decodeToken", () => {
  expect(decodeToken("not-a-jwt")).toEqual(null);
});

test("service JWT - does not allow reserved claims to be overridden by customClaims", () => {
  const { privateKey, publicKey } = generateTestKeyPair(1024);

  const token = signTestToken({
    issuer: "takos-control",
    subject: "service-runtime",
    audience: "takos-runtime",
    privateKey,
    expiresInSeconds: 120,
    customClaims: {
      iss: "evil-issuer",
      sub: "evil-subject",
      aud: "evil-audience",
      exp: 1,
      iat: 1,
      jti: "evil-jti",
      role: "internal",
    },
  });

  const decoded = decodeToken(token);
  expect(decoded !== null).toBeTruthy();

  const payload = decoded?.payload as Record<string, unknown>;

  expect(payload.iss).toEqual("takos-control");
  expect(payload.sub).toEqual("service-runtime");
  expect(payload.aud).toEqual("takos-runtime");
  expect(payload.jti).not.toEqual("evil-jti");
  expect(payload.iat).not.toEqual(1);
  expect(payload.exp).not.toEqual(1);
  expect(payload.exp).toEqual((payload.iat as number) + 120);

  // Non-reserved custom claims still pass through.
  expect(payload.role).toEqual("internal");

  const verified = verifyServiceToken({
    token,
    publicKey,
    expectedAudience: "takos-runtime",
    expectedIssuer: "takos-control",
  });

  expect(verified.valid).toEqual(true);
  expect(verified.payload?.role).toEqual("internal");
});
