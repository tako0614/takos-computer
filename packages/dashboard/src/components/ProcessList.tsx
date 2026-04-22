import { createResource, createSignal, For, Show } from "solid-js";
import { mcpCall } from "../lib/mcp.ts";

interface ProcessInfo {
  user: string;
  pid: number;
  cpu: string;
  mem: string;
  command: string;
}

export default function ProcessList(props: { mcpUrl: string }) {
  const [version, setVersion] = createSignal(0);

  const [procs] = createResource(
    () => version(),
    async () => {
      const result = await mcpCall<{ processes: ProcessInfo[] }>(
        props.mcpUrl,
        "process_list",
      );
      return result?.processes ?? [];
    },
  );

  return (
    <div>
      <div class="flex gap-2 items-center" style="margin-bottom:0.5rem">
        <span style="font-size:0.8125rem; font-weight:600">Processes</span>
        <div class="flex-1" />
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onClick={() => setVersion((v) => v + 1)}
        >
          Refresh
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
              Loading...
            </div>
          }
        >
          <Show
            when={(procs() ?? []).length > 0}
            fallback={
              <div style="padding:0.75rem" class="muted">No processes</div>
            }
          >
            <For each={procs()}>
              {(p) => (
                <div
                  class="flex gap-2 items-center"
                  style="padding:0.375rem 0.75rem; border-bottom:1px solid #0f172a"
                >
                  <span class="mono muted" style="min-width:3rem">{p.pid}</span>
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
        </Show>
      </div>
    </div>
  );
}
