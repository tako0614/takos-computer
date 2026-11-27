import { createResource, createSignal, For, Show } from "solid-js";
import { mcpCall } from "../lib/mcp.ts";
import { useI18n } from "../i18n.ts";

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

  return (
    <div>
      <div class="section-header">
        <span role="heading" aria-level={2} class="section-title">
          {t("processes")}
        </span>
        <div class="flex-1" />
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onClick={refresh}
        >
          {t("refresh")}
        </button>
      </div>
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
                  {(p) => (
                    <div class="proc-row">
                      <span class="mono muted proc-pid">
                        {p.pid}
                      </span>
                      <span class="mono flex-1 proc-cmd" title={p.command}>
                        {p.command}
                      </span>
                      <span class="muted proc-stats">
                        {p.cpu}% / {p.mem}%
                      </span>
                    </div>
                  )}
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
    </div>
  );
}
