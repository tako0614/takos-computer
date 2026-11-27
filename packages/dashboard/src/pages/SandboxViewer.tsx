import {
  createEffect,
  createResource,
  createSignal,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { A, useLocation, useNavigate, useParams } from "@solidjs/router";
import { sandboxSessions } from "../lib/api.ts";
import Shell from "../components/Shell.tsx";
import FileBrowser from "../components/FileBrowser.tsx";
import ProcessList from "../components/ProcessList.tsx";
import LanguageSwitcher from "../components/LanguageSwitcher.tsx";
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
  const [statusVersion, setStatusVersion] = createSignal(0);
  const [status] = createResource(
    () => ({ id: sessionId(), version: statusVersion() }),
    ({ id }) => sandboxSessions.get(id).catch(() => null),
  );
  let viewerActive = true;
  const timer = setInterval(() => setStatusVersion((v) => v + 1), 10_000);
  onCleanup(() => {
    viewerActive = false;
    clearInterval(timer);
  });

  const badgeClass = () => {
    if (status.loading || !status()) return "badge";
    const s = status()?.status;
    return s === "active"
      ? "badge badge-active"
      : s === "starting"
      ? "badge badge-starting"
      : "badge badge-stopped";
  };

  const statusLabel = () => {
    if (status.loading) return t("loading");
    const value = status()?.status;
    if (value === "active" || value === "starting" || value === "stopped") {
      return t(value);
    }
    return t("statusUnavailable");
  };

  const [destroyRequest, setDestroyRequest] = createSignal<{
    id: string;
  } | null>(null);
  const [unconfirmedDestroy, setUnconfirmedDestroy] = createSignal<
    string | null
  >(null);
  const destroyPending = () => destroyRequest()?.id === sessionId();
  const destroySession = async () => {
    const id = sessionId();
    if (destroyPending() || !confirm(t("destroyCurrentConfirm"))) return;
    const request = { id };
    setDestroyRequest(request);
    setUnconfirmedDestroy(null);
    const current = () =>
      viewerActive && sessionId() === id && destroyRequest() === request;
    try {
      await sandboxSessions.destroy(id);
      if (current()) window.location.href = "/gui";
    } catch {
      if (current()) setUnconfirmedDestroy(id);
    } finally {
      if (viewerActive && destroyRequest() === request) setDestroyRequest(null);
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
          <LanguageSwitcher />
          <span class={badgeClass()} role="status" aria-live="polite">
            {statusLabel()}
          </span>
          <button
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
            aria-disabled={destroyPending()}
            aria-busy={destroyPending()}
            onClick={destroySession}
          >
            {destroyPending() ? t("destroying") : t("destroy")}
          </button>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <Show when={unconfirmedDestroy() === sessionId()}>
          <div role="alert" class="alert-banner">
            {t("unconfirmedDestroyCurrent")}
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
    </div>
  );
}
