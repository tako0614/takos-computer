import { createEffect, createResource, createSignal, on, onCleanup } from "solid-js";
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
  const { t, language } = useI18n();
  const params = useParams<{ id: string }>();
  const sessionId = () => params.id;
  const location = useLocation();
  const navigate = useNavigate();
  const mcpUrl = () =>
    `/gui/api/sandbox-session/${encodeURIComponent(sessionId())}/mcp`;

  const [cwd, setDirectory] = createSignal(
    restoredDirectory(location.state, sessionId()),
  );
  // Restoring an entry never writes it back or creates a new history entry.
  createEffect(on(
    [sessionId, () => location.state],
    ([id, state]) => setDirectory(restoredDirectory(state, id)),
  ));
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
  const timer = setInterval(() => setStatusVersion((v) => v + 1), 10_000);
  onCleanup(() => clearInterval(timer));

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
    return language() === "ja" ? "状態を取得できません" : "Status unavailable";
  };

  const destroySession = async () => {
    if (!confirm(t("destroyCurrentConfirm"))) return;
    await sandboxSessions.destroy(sessionId());
    window.location.href = "/gui";
  };

  return (
    <div class="container">
      {/* Toolbar */}
      <div
        class="flex gap-2 items-center"
        style="margin-bottom:0.75rem; flex-wrap:wrap"
      >
        <A href="/" class="btn btn-ghost btn-sm">
          &larr; {t("backToDashboard")}
        </A>
        <div style="width:1px; height:1.5rem; background:#334155" />
        <span
          class="mono muted"
          style="font-size:0.8125rem; min-width:0; overflow-wrap:anywhere"
        >
          {t("sandbox")} {sessionId()}
        </span>
        <div class="flex-1" />
        <LanguageSwitcher />
        <span class={badgeClass()} role="status" aria-live="polite">
          {statusLabel()}
        </span>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          aria-disabled={status.loading}
          style={{ opacity: status.loading ? 0.5 : 1 }}
          onClick={() => {
            if (!status.loading) setStatusVersion((v) => v + 1);
          }}
        >
          {language() === "ja" ? "状態を更新" : "Refresh status"}
        </button>
        <button
          type="button"
          class="btn btn-danger btn-sm"
          onClick={destroySession}
        >
          {t("destroy")}
        </button>
      </div>

      {/* Shell */}
      <Shell mcpUrl={mcpUrl()} cwd={cwd} />

      {/* File browser */}
      <div style="margin-top:0.75rem">
        <FileBrowser mcpUrl={mcpUrl()} cwd={cwd} setCwd={setCwd} />
      </div>

      {/* Process list */}
      <div style="margin-top:0.75rem">
        <ProcessList mcpUrl={mcpUrl()} />
      </div>
    </div>
  );
}
