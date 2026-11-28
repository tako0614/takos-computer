import type { SessionState } from "./api.ts";

export type ViewerStatusResult =
  | { kind: "ok"; state: SessionState }
  | { kind: "not_found" }
  | { kind: "unavailable" };

export type ViewerStatusKey =
  | "active"
  | "starting"
  | "stopped"
  | "notFound"
  | "statusUnavailable";

export interface ViewerStatusAnnouncementState {
  sessionId: string;
  key: ViewerStatusKey;
}

export function resolveViewerStatusKey(
  result: ViewerStatusResult,
): ViewerStatusKey {
  if (result.kind === "not_found") return "notFound";
  if (result.kind === "unavailable") return "statusUnavailable";
  const status = result.state.status;
  if (status === "active" || status === "starting" || status === "stopped") {
    return status;
  }
  return "statusUnavailable";
}

export function shouldAnnounceViewerStatus(
  previous: ViewerStatusAnnouncementState | null,
  sessionId: string,
  nextKey: ViewerStatusKey,
): boolean {
  if (!previous) return true;
  return previous.sessionId !== sessionId || previous.key !== nextKey;
}

export function shouldShowViewerStatusLoading(options: {
  loading: boolean;
  manualRefresh: boolean;
  sessionId: string;
  lastSettled: { sessionId: string; result: ViewerStatusResult } | null;
}): boolean {
  if (!options.loading) return false;
  if (options.manualRefresh) return true;
  if (!options.lastSettled || options.lastSettled.sessionId !== options.sessionId) {
    return true;
  }
  return options.lastSettled.result.kind !== "ok";
}
