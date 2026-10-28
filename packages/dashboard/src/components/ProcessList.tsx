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
    () => version(),
    async (): Promise<ProcessListResult> => {
      try {
        const result = await mcpCall<unknown>(
          props.mcpUrl,
          "process_list",
        );
        const processes =
          result && typeof result === "object"
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

  return (
    <div>
      <div class="flex gap-2 items-center" style="margin-bottom:0.5rem">
        <span style="font-size:0.8125rem; font-weight:600">
          {t("processes")}
        </span>
        <div class="flex-1" />
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onClick={() => setVersion((v) => v + 1)}
        >
          {t("refresh")}
        </button>
      </div>
      <div
        class="card"
        style="max-height:180px; overflow-y:auto; font-size:0.8125rem"
      >
        <Show
          when={!procs.loading}
          fallback={
            <div style="padding:1rem; text-align:center" class="muted">
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
                  <div style="padding:0.75rem" class="muted">
                    {t("noProcesses")}
                  </div>
                }
              >
                <For each={processes()}>
                  {(p) => (
                    <div
                      class="flex gap-2 items-center"
                      style="padding:0.375rem 0.75rem; border-bottom:1px solid #0f172a"
                    >
                      <span class="mono muted" style="min-width:3rem">
                        {p.pid}
                      </span>
                      <span
                        class="mono flex-1"
                        style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap"
                      >
                        {p.command}
                      </span>
                      <span class="muted" style="font-size:0.75rem">
                        {p.cpu}% / {p.mem}%
                      </span>
                    </div>
                  )}
                </For>
              </Show>
            }
          >
            {(message) => (
              <div role="alert" style="padding:0.75rem; color:#fca5a5">
                {t("error", { message: message() })}
              </div>
            )}
          </Show>
        </Show>
      </div>
    </div>
  );
}
