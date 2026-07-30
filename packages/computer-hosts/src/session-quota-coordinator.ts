import { DurableObject } from "cloudflare:workers";
import type { DurableObjectState } from "./cf-types.ts";
import {
  SessionQuotaStore,
  type SessionQuotaEnv,
  type SessionQuotaReservation,
  type SessionQuotaRpc,
} from "./session-quota.ts";

/**
 * Cloudflare Durable Object RPC entrypoint for atomic session quota.
 *
 * RPC methods are available on a Durable Object stub only when the exported
 * class inherits Cloudflare's built-in DurableObject base. Domain/storage
 * behavior remains in SessionQuotaStore so local tests do not emulate the
 * runtime transport.
 */
export class SessionQuotaCoordinator
  extends DurableObject<SessionQuotaEnv>
  implements SessionQuotaRpc {
  private readonly quota: SessionQuotaStore;

  constructor(ctx: DurableObjectState, env: SessionQuotaEnv) {
    super(ctx, env);
    this.quota = new SessionQuotaStore(ctx);
  }

  reserve(
    sessionId: string,
    limit: number,
  ): Promise<SessionQuotaReservation> {
    return this.quota.reserve(sessionId, limit);
  }

  release(sessionId: string): Promise<{ released: boolean }> {
    return this.quota.release(sessionId);
  }
}
