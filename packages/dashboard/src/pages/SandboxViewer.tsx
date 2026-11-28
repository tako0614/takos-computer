import {
  createEffect,
  createResource,
  createSignal,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { A, useLocation, useNavigate, useParams } from "@solidjs/router";
import { ApiError, sandboxSessions } from "../lib/api.ts";
import { formatClockTime } from "../lib/format-time.ts";
import {
  resolveViewerStatusKey,
  shouldAnnounceViewerStatus,
  shouldShowViewerStatusLoading,
  type ViewerStatusAnnouncementState,
  type ViewerStatusResult,
} from "../lib/viewer-status.ts";
import Shell from "../components/Shell.tsx";
import FileBrowser from "../components/FileBrowser.tsx";
import ProcessList from "../components/ProcessList.tsx";
import ConfirmDialog from "../components/ConfirmDialog.tsx";
import LanguageSwitcher from "../components/LanguageSwitcher.tsx";
import ThemeSwitcher from "../components/ThemeSwitcher.tsx";
import { useI18n } from "../i18n.ts";

const directoryStateKey = "takosComputerDirectory";

function restoredDirectory(state: unknown, sessionId: string): string {
  if (!state || typeof state !== "object" || Array.isArray(state)) return ".";
  const record = (state as Record<string, unknown>)[directoryStateKey];
  if (!record || typeof record !== "object" || Array.isArray(record)) return ".";
  const value = record as Record<string, unknown>;
  return value.version === 1 && value.sessionId === sessionId &&
      typeof value.cwd === "string" && value.cwd.length > 0 &&
      !/[\u0000-\u001f\u007f]/.test(value.cwd)
    ? value.cwd
    : ".";
}

export default function SandboxViewer() {
  const { language, t } = useI18n();
  const params = useParams<{ id: string }>();
  const sessionId = () => params.id;
  const location = useLocation();
  const navigate = useNavigate();
  const mcpUrl = () =>
    `/gui/api/sandbox-session/${encodeURIComponent(sessionId())}/mcp`;

  createEffect(() => {
    const id = sessionId();
    document.title = id ? `${id} — ${t("appTitle")}` : t("appTitle");
  });
  onCleanup(() => {
    document.title = t("appTitle");
  });

  const [cwd, setDirectory] = createSignal(
    restoredDirectory(location.state, sessionId()),
  );
  // Restoring an entry never writes it back or creates a new history entry.
  createEffect(
    on(
      [sessionId, () => location.state],
      ([id, state]) => setDirectory(restoredDirectory(state, id)),
    ),
  );
  const setCwd = (next: string) => {
    setDirectory(next);
    // Incomplete input stays editable without replacing the last restoration hint.
    if (!next || /[\u0000-\u001f\u007f]/.test(next)) return;
    const state = window.history.state;
    navigate(location.pathname + location.search + location.hash, {
      replace: true,
      resolve: false,
      scroll: false,
      state: {
        ...(state && typeof state === "object" && !Array.isArray(state)
          ? state
          : {}),
        [directoryStateKey]: { version: 1, sessionId: sessionId(), cwd: next },
      },
    });
  };

  // Status polling with deduplicated screen-reader announcements & auto-refresh control
  const [statusVersion, setStatusVersion] = createSignal(0);
  const [autoRefreshPaused, setAutoRefreshPaused] = createSignal(false);
  const [manualRefresh, setManualRefresh] = createSignal(false);
  const [lastUpdated, setLastUpdated] = createSignal<Date | null>(null);
  const [lastSettled, setLastSettled] = createSignal<
    { sessionId: string; result: ViewerStatusResult } | null
  >(null);
  const [announcedStatus, setAnnouncedStatus] = createSignal<
    ViewerStatusAnnouncementState | null
  >(null);

  let viewerActive = true;
  let statusRequestSeq = 0;
  let refreshStatusButton: HTMLButtonElement | undefined;

  const [status] = createResource(
    () => ({ id: sessionId(), version: statusVersion() }),
    async ({ id }): Promise<ViewerStatusResult> => {
      const req = ++statusRequestSeq;
      let result: ViewerStatusResult;
      try {
        const state = await sandboxSessions.get(id);
        result = { kind: "ok", state };
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          result = { kind: "not_found" };
        } else {
          result = { kind: "unavailable" };
        }
      }
      if (viewerActive && req === statusRequestSeq && sessionId() === id) {
        setManualRefresh(false);
        setLastSettled({ sessionId: id, result });
        if (result.kind === "ok") {
          setLastUpdated(new Date());
        }
        const nextKey = resolveViewerStatusKey(result);
        setAnnouncedStatus((previous) =>
          shouldAnnounceViewerStatus(previous, id, nextKey)
            ? { sessionId: id, key: nextKey }
            : previous
        );
      }
      return result;
    },
  );

  const timer = setInterval(() => {
    if (
      autoRefreshPaused() ||
      status.loading ||
      status()?.kind === "not_found"
    ) {
      return;
    }
    setManualRefresh(false);
    setStatusVersion((v) => v + 1);
  }, 10_000);
  onCleanup(() => {
    viewerActive = false;
    clearInterval(timer);
  });

  const showStatusLoading = () =>
    shouldShowViewerStatusLoading({
      loading: status.loading,
      manualRefresh: manualRefresh(),
      sessionId: sessionId(),
      lastSettled: lastSettled(),
    });

  const effectiveStatus = (): ViewerStatusResult | undefined => {
    if (showStatusLoading()) return undefined;
    if (status.loading) {
      const settled = lastSettled();
      return settled?.sessionId === sessionId() ? settled.result : undefined;
    }
    return status();
  };

  const isNotFound = () =>
    !showStatusLoading() && effectiveStatus()?.kind === "not_found";

  const badgeClass = () => {
    if (showStatusLoading()) return "badge";
    const result = effectiveStatus();
    if (!result || result.kind === "unavailable") {
      return "badge";
    }
    if (result.kind === "not_found") return "badge badge-stopped";
    const s = result.state.status;
    return s === "active"
      ? "badge badge-active"
      : s === "starting"
      ? "badge badge-starting"
      : "badge badge-stopped";
  };

  const statusLabel = () => {
    if (showStatusLoading()) return t("loading");
    const result = effectiveStatus();
    if (!result) return t("statusUnavailable");
    return t(resolveViewerStatusKey(result));
  };

  const statusAnnouncementText = () => {
    const announced = announcedStatus();
    if (!announced || announced.sessionId !== sessionId()) return "";
    return t("sessionStatusAnnouncement", { status: t(announced.key) });
  };

  const [destroyDialogOpen, setDestroyDialogOpen] = createSignal(false);
  const [destroyRequest, setDestroyRequest] = createSignal<{
    id: string;
  } | null>(null);
  const [unconfirmedDestroy, setUnconfirmedDestroy] = createSignal<
    string | null
  >(null);

  createEffect(
    on(sessionId, () => {
      setDestroyDialogOpen(false);
      setManualRefresh(false);
      setLastUpdated(null);
      setLastSettled(null);
      setAnnouncedStatus(null);
    }),
  );

  const destroyPending = () => destroyRequest()?.id === sessionId();

  const requestDestroySession = () => {
    if (destroyPending() || isNotFound()) return;
    setDestroyDialogOpen(true);
  };

  const confirmDestroySession = async () => {
    const id = sessionId();
    if (destroyPending()) return;
    setDestroyDialogOpen(false);
    const request = { id };
    setDestroyRequest(request);
    setUnconfirmedDestroy(null);
    const current = () =>
      viewerActive && sessionId() === id && destroyRequest() === request;
    try {
      await sandboxSessions.destroy(id);
      if (current()) {
        window.location.href = "/gui";
      }
    } catch {
      if (current()) setUnconfirmedDestroy(id);
    } finally {
      if (viewerActive && destroyRequest() === request) {
        setDestroyRequest(null);
      }
    }
  };

  return (
    <div class="container">
      {/* Toolbar */}
      <header class="viewer-header">
        <div class="viewer-identity">
          <A href="/" class="btn btn-ghost btn-sm">
            &larr; {t("backToDashboard")}
          </A>
          <div class="viewer-divider" aria-hidden="true" />
          <h1 class="viewer-title mono">
            <span class="viewer-title-prefix">{t("sandbox")}</span>{" "}
            {sessionId()}
          </h1>
        </div>
        <div class="viewer-controls">
          <ThemeSwitcher />
          <LanguageSwitcher />
          <span class={badgeClass()}>
            {statusLabel()}
          </span>
          <span class="sr-only" role="status" aria-live="polite">
            {statusAnnouncementText()}
          </span>
          <button
            ref={(el) => {
              refreshStatusButton = el;
            }}
            type="button"
            class="btn btn-ghost btn-sm"
            aria-disabled={status.loading}
            onClick={() => {
              if (!status.loading) {
                setManualRefresh(true);
                setStatusVersion((v) => v + 1);
              }
            }}
          >
            {t("refreshStatus")}
          </button>
          <button
            type="button"
            class="btn btn-danger btn-sm"
            aria-disabled={destroyPending() || isNotFound()}
            aria-busy={destroyPending()}
            onClick={requestDestroySession}
          >
            {destroyPending() ? t("destroying") : t("destroy")}
          </button>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <Show when={isNotFound()}>
          <div role="alert" class="alert-banner session-missing-banner">
            <div class="session-missing-copy">
              <strong class="session-missing-title">
                {t("sessionNotFoundTitle")}
              </strong>
              <p class="session-missing-hint">{t("sessionNotFoundHint")}</p>
            </div>
            <div class="session-missing-actions">
              <A href="/" class="btn btn-primary btn-sm">
                &larr; {t("backToSessions")}
              </A>
            </div>
          </div>
        </Show>

        <Show when={unconfirmedDestroy() === sessionId()}>
          <div role="alert" class="alert-banner alert-banner-row">
            <span>{t("unconfirmedDestroyCurrent")}</span>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onClick={(e) => {
                const hadFocus = document.activeElement === e.currentTarget;
                setUnconfirmedDestroy(null);
                if (hadFocus) {
                  queueMicrotask(() => {
                    if (
                      viewerActive &&
                      document.activeElement === document.body
                    ) {
                      (refreshStatusButton?.isConnected
                        ? refreshStatusButton
                        : document.getElementById("main"))?.focus();
                    }
                  });
                }
              }}
            >
              {t("dismiss")}
            </button>
          </div>
        </Show>

        {/* Shell */}
        <Show when={mcpUrl()} keyed>
          {(url) => <Shell mcpUrl={url} cwd={cwd} />}
        </Show>

        {/* File browser */}
        <section class="viewer-section" aria-label={t("files")}>
          <FileBrowser mcpUrl={mcpUrl()} cwd={cwd} setCwd={setCwd} />
        </section>

        {/* Process list */}
        <section class="viewer-section" aria-label={t("processes")}>
          <ProcessList mcpUrl={mcpUrl()} />
        </section>

        <Show when={!isNotFound()}>
          <div class="muted footer-note">
            <div class="footer-note-info">
              <Show when={lastUpdated()}>
                {(date) => (
                  <>
                    <span>
                      {t("lastUpdated", {
                        time: formatClockTime(date(), language()),
                      })}
                    </span>
                    <span aria-hidden="true"> &middot; </span>
                  </>
                )}
              </Show>
              <span role="status" aria-live="polite">
                {autoRefreshPaused()
                  ? t("autoRefreshPaused")
                  : t("autoRefresh")}
              </span>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-sm footer-refresh-toggle"
              onClick={() => setAutoRefreshPaused((paused) => !paused)}
            >
              {autoRefreshPaused()
                ? t("resumeAutoRefresh")
                : t("pauseAutoRefresh")}
            </button>
          </div>
        </Show>
      </main>

      <ConfirmDialog
        open={destroyDialogOpen()}
        title={t("destroySessionTitle")}
        description={t("destroyCurrentConfirm")}
        detail={sessionId()}
        confirmLabel={t("destroy")}
        tone="danger"
        onCancel={() => setDestroyDialogOpen(false)}
        onConfirm={confirmDestroySession}
      />
    </div>
  );
}
