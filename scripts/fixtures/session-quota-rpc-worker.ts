import { SessionQuotaCoordinator } from "../../packages/computer-hosts/src/session-quota-coordinator.ts";
import type { SessionQuotaReservation } from "../../packages/computer-hosts/src/session-quota.ts";

export { SessionQuotaCoordinator };

type SessionQuotaStub = {
  reserve(
    sessionId: string,
    limit: number,
  ): Promise<SessionQuotaReservation>;
  release(sessionId: string): Promise<{ released: boolean }>;
};

type Env = {
  SANDBOX_QUOTA: {
    idFromName(name: string): unknown;
    get(id: unknown): SessionQuotaStub;
  };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session") ?? "";
    const stub = env.SANDBOX_QUOTA.get(
      env.SANDBOX_QUOTA.idFromName("rpc-integration-principal"),
    );

    if (url.pathname === "/reserve") {
      const limit = Number(url.searchParams.get("limit") ?? "1");
      return Response.json(await stub.reserve(sessionId, limit));
    }
    if (url.pathname === "/release") {
      return Response.json(await stub.release(sessionId));
    }
    return new Response("Not found", { status: 404 });
  },
};
