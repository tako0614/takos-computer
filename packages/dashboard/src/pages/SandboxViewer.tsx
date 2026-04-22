import { createResource, createSignal, onCleanup } from "solid-js";
import { A, useParams } from "@solidjs/router";
import { sandboxSessions } from "../lib/api.ts";
import Shell from "../components/Shell.tsx";
import FileBrowser from "../components/FileBrowser.tsx";
import ProcessList from "../components/ProcessList.tsx";
import LanguageSwitcher from "../components/LanguageSwitcher.tsx";
import { useI18n } from "../i18n.ts";

export default function SandboxViewer() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const sessionId = () => params.id;
  const mcpUrl = () =>
    `/gui/api/sandbox-session/${encodeURIComponent(sessionId())}/mcp`;

  const [cwd, setCwd] = createSignal("/home/sandbox/workspace");

  // Status polling
  const [statusVersion, setStatusVersion] = createSignal(0);
  const [status] = createResource(
    () => statusVersion(),
    () => sandboxSessions.get(sessionId()).catch(() => null),
  );
  const timer = setInterval(() => setStatusVersion((v) => v + 1), 10_000);
  onCleanup(() => clearInterval(timer));

  const badgeClass = () => {
    const s = status()?.status;
    return s === "active"
      ? "badge badge-active"
      : s === "starting"
      ? "badge badge-starting"
      : "badge badge-stopped";
  };

  const statusLabel = () => {
    const value = status()?.status;
    if (value === "active" || value === "starting" || value === "stopped") {
      return t(value);
    }
    return t("loading");
  };

  const destroySession = async () => {
    if (!confirm(t("destroyCurrentConfirm"))) return;
    await sandboxSessions.destroy(sessionId());
    location.href = "/gui";
  };

  return (
    <div class="container">
      {/* Toolbar */}
      <div class="flex gap-2 items-center" style="margin-bottom:0.75rem">
        <A href="/" class="btn btn-ghost btn-sm">
          &larr; {t("backToDashboard")}
        </A>
        <div style="width:1px; height:1.5rem; background:#334155" />
        <span class="mono muted" style="font-size:0.8125rem">
          {t("sandbox")} {sessionId()}
        </span>
        <div class="flex-1" />
        <LanguageSwitcher />
        <span class={badgeClass()}>{statusLabel()}</span>
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
