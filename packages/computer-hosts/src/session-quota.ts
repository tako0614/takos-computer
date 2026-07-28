/**
 * Atomic per-principal sandbox quota.
 *
 * Workers KV is eventually consistent, so list-then-create cannot enforce a
 * hard cap under concurrent requests. One Durable Object is addressed per
 * principal and owns that principal's reservation set. Both the GUI/admin
 * session route and the published MCP surface use this same coordinator.
 */

import type {
  DurableObjectNamespace,
  DurableObjectState,
} from "./cf-types.ts";

const RESERVATIONS_KEY = "sessionReservations";
const DEFAULT_MAX_SESSIONS_PER_PRINCIPAL = 10;
const MAX_CONFIGURED_SESSIONS_PER_PRINCIPAL = 1_000;

type ReservationSet = string[];

export type SessionQuotaReservation = {
  ok: boolean;
  created: boolean;
  count: number;
  limit: number;
};

export class SessionQuotaCoordinator {
  constructor(private readonly ctx: DurableObjectState) {}

  async reserve(
    sessionId: string,
    limit: number,
  ): Promise<SessionQuotaReservation> {
    assertSessionId(sessionId);
    const normalizedLimit = normalizeQuotaLimit(limit);
    return await this.ctx.storage.transaction(async (transaction) => {
      const reservations = await transaction.get<ReservationSet>(
        RESERVATIONS_KEY,
      ) ?? [];
      if (reservations.includes(sessionId)) {
        return {
          ok: true,
          created: false,
          count: reservations.length,
          limit: normalizedLimit,
        };
      }

      const count = reservations.length;
      if (count >= normalizedLimit) {
        return {
          ok: false,
          created: false,
          count,
          limit: normalizedLimit,
        };
      }

      await transaction.put(RESERVATIONS_KEY, [...reservations, sessionId]);
      return {
        ok: true,
        created: true,
        count: count + 1,
        limit: normalizedLimit,
      };
    });
  }

  async release(sessionId: string): Promise<{ released: boolean }> {
    assertSessionId(sessionId);
    return await this.ctx.storage.transaction(async (transaction) => {
      const reservations = await transaction.get<ReservationSet>(
        RESERVATIONS_KEY,
      ) ?? [];
      if (!reservations.includes(sessionId)) return { released: false };

      const next = reservations.filter((id) => id !== sessionId);
      if (next.length === 0) {
        await transaction.delete(RESERVATIONS_KEY);
      } else {
        await transaction.put(RESERVATIONS_KEY, next);
      }
      return { released: true };
    });
  }
}

export type SessionQuotaEnv = {
  SANDBOX_QUOTA?: DurableObjectNamespace<SessionQuotaCoordinator>;
  MAX_SANDBOX_SESSIONS_PER_PRINCIPAL?: string;
  /** Compatibility alias; new deployments should use the principal name. */
  MAX_SANDBOX_SESSIONS_PER_USER?: string;
};

export function maxSessionsPerPrincipal(env: SessionQuotaEnv): number {
  const raw = env.MAX_SANDBOX_SESSIONS_PER_PRINCIPAL ??
    env.MAX_SANDBOX_SESSIONS_PER_USER;
  if (!raw) return DEFAULT_MAX_SESSIONS_PER_PRINCIPAL;
  return normalizeQuotaLimit(Number(raw));
}

export function userQuotaPrincipal(userId: string): string {
  return `user:${userId}`;
}

export function publishedQuotaPrincipal(tokenNamespace: string): string {
  return `published:${tokenNamespace}`;
}

export async function reserveSessionQuota(
  env: SessionQuotaEnv,
  principal: string,
  sessionId: string,
): Promise<SessionQuotaReservation> {
  const namespace = env.SANDBOX_QUOTA;
  if (!namespace) throw new Error("SANDBOX_QUOTA is not configured");
  const stub = namespace.get(namespace.idFromName(principal));
  return await stub.reserve(sessionId, maxSessionsPerPrincipal(env));
}

export async function releaseSessionQuota(
  env: SessionQuotaEnv,
  principal: string,
  sessionId: string,
): Promise<void> {
  const namespace = env.SANDBOX_QUOTA;
  if (!namespace) throw new Error("SANDBOX_QUOTA is not configured");
  const stub = namespace.get(namespace.idFromName(principal));
  await stub.release(sessionId);
}

function normalizeQuotaLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return DEFAULT_MAX_SESSIONS_PER_PRINCIPAL;
  }
  return Math.min(value, MAX_CONFIGURED_SESSIONS_PER_PRINCIPAL);
}

function assertSessionId(sessionId: string): void {
  if (!sessionId) throw new Error("sessionId is required");
}
