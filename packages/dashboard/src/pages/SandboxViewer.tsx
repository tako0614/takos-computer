import { createResource, createSignal, onCleanup } from "solid-js";
import { A, useParams } from "@solidjs/router";
import { sandboxSessions } from "../lib/api.ts";
import Shell from "../components/Shell.tsx";
import FileBrowser from "../components/FileBrowser.tsx";
import ProcessList from "../components/ProcessList.tsx";

export default function SandboxViewer() {
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

  const destroySession = async () => {
    if (!confirm("Destroy this sandbox session?")) return;
    await sandboxSessions.destroy(sessionId());
    location.href = "/gui";
  };

  return (
    <div class="container">
      {/* Toolbar */}
      <div class="flex gap-2 items-center" style="margin-bottom:0.75rem">
        <A href="/" class="btn btn-ghost btn-sm">&larr; Dashboard</A>
        <div style="width:1px; height:1.5rem; background:#334155" />
        <span class="mono muted" style="font-size:0.8125rem">
          Sandbox: {sessionId()}
        </span>
        <div class="flex-1" />
        <span class={badgeClass()}>{status()?.status ?? "loading"}</span>
        <button
          type="button"
          class="btn btn-danger btn-sm"
          onClick={destroySession}
        >
          Destroy
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
