import {
  createEffect,
  createResource,
  createSignal,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { A, useLocation, useNavigate, useParams } from "@solidjs/router";
import { ApiError, sandboxSessions, type SessionState } from "../lib/api.ts";
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
  const { t } = useI18n();
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

  // Status polling
  type StatusResult =
    | { kind: "ok"; state: SessionState }
    | { kind: "not_found" }
    | { kind: "unavailable" };

  const [statusVersion, setStatusVersion] = createSignal(0);
  const [status] = createResource(
    () => ({ id: sessionId(), version: statusVersion() }),
    async ({ id }): Promise<StatusResult> => {
      try {
        const state = await sandboxSessions.get(id);
        return { kind: "ok", state };
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          return { kind: "not_found" };
        }
        return { kind: "unavailable" };
      }
    },
  );
  let viewerActive = true;
  let refreshStatusButton: HTMLButtonElement | undefined;
  const timer = setInterval(() => {
    if (status()?.kind === "not_found") return;
    setStatusVersion((v) => v + 1);
  }, 10_000);
  onCleanup(() => {
    viewerActive = false;
    clearInterval(timer);
  });

  const isNotFound = () => !status.loading && status()?.kind === "not_found";

  const badgeClass = () => {
    const result = status();
    if (status.loading || !result || result.kind === "unavailable") {
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
    if (status.loading) return t("loading");
    const result = status();
    if (result?.kind === "not_found") return t("notFound");
    const value = result?.kind === "ok" ? result.state.status : undefined;
    if (value === "active" || value === "starting" || value === "stopped") {
      return t(value);
    }
    return t("statusUnavailable");
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
          <span class={badgeClass()} role="status" aria-live="polite">
            {statusLabel()}
          </span>
          <button
            ref={(el) => {
              refreshStatusButton = el;
            }}
            type="button"
            class="btn btn-ghost btn-sm"
            aria-disabled={status.loading}
            onClick={() => {
              if (!status.loading) setStatusVersion((v) => v + 1);
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
      </main>

      <ConfirmDialog
        open={destroyDialogOpen()}
        title={t("destroySessionTitle")}
        description={t("destroyCurrentConfirm")}
        detail={sessionId()}
        confirmLabel={t("destroy")}
        confirmBusyLabel={t("destroying")}
        tone="danger"
        busy={destroyPending()}
        onCancel={() => setDestroyDialogOpen(false)}
        onConfirm={confirmDestroySession}
      />
    </div>
  );
}
