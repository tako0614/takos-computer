import {
  createEffect,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { mcpCall } from "../lib/mcp.ts";
import { useI18n } from "../i18n.ts";
import ConfirmDialog from "./ConfirmDialog.tsx";

interface ProcessInfo {
  user: string;
  pid: number;
  cpu: string;
  mem: string;
  command: string;
}

type ProcessListResult =
  | { ok: true; processes: ProcessInfo[] }
  | { ok: false; message: string };

interface ProcessKillResponse {
  killed?: boolean;
  pid?: number;
  signal?: string;
  error?: string;
}

function isProcessInfo(value: unknown): value is ProcessInfo {
  if (!value || typeof value !== "object") return false;
  const process = value as Record<string, unknown>;
  return (
    typeof process.user === "string" &&
    typeof process.pid === "number" &&
    typeof process.cpu === "string" &&
    typeof process.mem === "string" &&
    typeof process.command === "string"
  );
}

export default function ProcessList(props: { mcpUrl: string }) {
  const { t } = useI18n();
  const [version, setVersion] = createSignal(0);
  const [pendingKill, setPendingKill] = createSignal<ProcessInfo | null>(null);
  const [killingPid, setKillingPid] = createSignal<number | null>(null);
  const [killError, setKillError] = createSignal("");
  const [killStatus, setKillStatus] = createSignal("");
  let refreshButton: HTMLButtonElement | undefined;
  let alive = true;

  onCleanup(() => {
    alive = false;
  });

  createEffect(() => {
    const _url = props.mcpUrl;
    setPendingKill(null);
    setKillingPid(null);
    setKillError("");
    setKillStatus("");
  });

  const [procs] = createResource(
    () => ({ version: version(), mcpUrl: props.mcpUrl }),
    async ({ mcpUrl }): Promise<ProcessListResult> => {
      try {
        const result = await mcpCall<unknown>(
          mcpUrl,
          "process_list",
        );
        const processes = result && typeof result === "object"
          ? (result as { processes?: unknown }).processes
          : undefined;
        if (
          !Array.isArray(processes) ||
          !processes.every(isProcessInfo)
        ) {
          throw new Error("Invalid process list response");
        }
        return { ok: true, processes };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  const processes = () => {
    const result = procs();
    return result?.ok ? result.processes : [];
  };
  const errorMessage = () => {
    const result = procs();
    return result && !result.ok
      ? result.message.trim() || "Unknown process list error"
      : undefined;
  };
  const refresh = () => setVersion((v) => v + 1);

  const confirmKill = async () => {
    const target = pendingKill();
    const mcpUrl = props.mcpUrl;
    if (!target || killingPid() !== null) return;

    setKillingPid(target.pid);
    setKillError("");
    setKillStatus("");

    try {
      const result = await mcpCall<ProcessKillResponse>(
        mcpUrl,
        "process_kill",
        {
          pid: target.pid,
          signal: "SIGTERM",
        },
      );
      if (!alive || props.mcpUrl !== mcpUrl) return;
      if (result?.killed) {
        setKillStatus(t("processStopped", { pid: target.pid }));
        refresh();
      } else {
        const detail = typeof result?.error === "string" && result.error.trim()
          ? result.error
          : t("processNotManaged");
        setKillError(
          t("stopProcessFailed", { pid: target.pid, message: detail }),
        );
      }
    } catch (err) {
      if (!alive || props.mcpUrl !== mcpUrl) return;
      setKillError(
        t("stopProcessFailed", {
          pid: target.pid,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      if (alive) {
        setKillingPid(null);
        setPendingKill(null);
      }
    }
  };

  return (
    <div>
      <div class="section-header">
        <span role="heading" aria-level={2} class="section-title">
          {t("processes")}
        </span>
        <div class="flex-1" />
        <button
          ref={(el) => {
            refreshButton = el;
          }}
          type="button"
          class="btn btn-ghost btn-sm"
          onClick={refresh}
        >
          {t("refresh")}
        </button>
      </div>

      <Show when={killStatus()}>
        {(message) => (
          <div role="status" aria-live="polite" class="status-banner">
            <span>{message()}</span>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onClick={(e) => {
                const hadFocus = document.activeElement === e.currentTarget;
                setKillStatus("");
                if (hadFocus) {
                  queueMicrotask(() => {
                    if (
                      alive && document.activeElement === document.body &&
                      refreshButton?.isConnected
                    ) {
                      refreshButton.focus();
                    }
                  });
                }
              }}
            >
              {t("dismiss")}
            </button>
          </div>
        )}
      </Show>

      <Show when={killError()}>
        {(message) => (
          <div role="alert" class="alert-banner alert-banner-row">
            <span>{message()}</span>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onClick={(e) => {
                const hadFocus = document.activeElement === e.currentTarget;
                setKillError("");
                if (hadFocus) {
                  queueMicrotask(() => {
                    if (
                      alive && document.activeElement === document.body &&
                      refreshButton?.isConnected
                    ) {
                      refreshButton.focus();
                    }
                  });
                }
              }}
            >
              {t("dismiss")}
            </button>
          </div>
        )}
      </Show>

      <div class="card panel-scroll panel-scroll-sm" aria-busy={procs.loading}>
        <Show
          when={!procs.loading}
          fallback={
            <div class="panel-placeholder muted">
              {t("loadingEllipsis")}
            </div>
          }
        >
          <Show
            when={errorMessage()}
            fallback={
              <Show
                when={processes().length > 0}
                fallback={
                  <div class="panel-empty muted">
                    {t("noProcesses")}
                  </div>
                }
              >
                <For each={processes()}>
                  {(p) => {
                    const busy = () => killingPid() === p.pid;
                    return (
                      <div class="proc-row">
                        <span class="mono muted proc-pid">
                          {p.pid}
                        </span>
                        <span class="mono flex-1 proc-cmd" title={p.command}>
                          {p.command}
                        </span>
                        <span
                          class="muted proc-stats"
                          title={t("cpuMemLabel", { cpu: p.cpu, mem: p.mem })}
                          aria-label={t("cpuMemLabel", {
                            cpu: p.cpu,
                            mem: p.mem,
                          })}
                        >
                          {p.cpu}% / {p.mem}%
                        </span>
                        <Show when={p.pid > 1}>
                          <button
                            type="button"
                            class="btn btn-danger-ghost btn-sm proc-kill-btn"
                            aria-label={t("stopProcessAria", {
                              pid: p.pid,
                              command: p.command,
                            })}
                            disabled={killingPid() !== null}
                            aria-busy={busy()}
                            onClick={() => setPendingKill(p)}
                          >
                            {busy() ? t("stopping") : t("stop")}
                          </button>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </Show>
            }
          >
            {(message) => (
              <div role="alert" class="panel-error">
                <span>{t("error", { message: message() })}</span>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  onClick={refresh}
                >
                  {t("retry")}
                </button>
              </div>
            )}
          </Show>
        </Show>
      </div>

      <ConfirmDialog
        open={pendingKill() !== null}
        title={t("stopProcessTitle")}
        description={pendingKill()
          ? t("stopProcessConfirm", { pid: pendingKill()!.pid })
          : ""}
        detail={pendingKill()?.command}
        confirmLabel={t("stopProcess")}
        confirmBusyLabel={t("stopping")}
        tone="danger"
        busy={killingPid() !== null}
        onCancel={() => setPendingKill(null)}
        onConfirm={confirmKill}
      />
    </div>
  );
}
