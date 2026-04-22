import { createResource, createSignal, For, Show } from "solid-js";
import { mcpCall } from "../lib/mcp.ts";
import { useI18n } from "../i18n.ts";

interface FileEntry {
  name: string;
  type: "file" | "directory" | "symlink" | "unknown";
  size: number;
  modified: string | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " K";
  return (bytes / (1024 * 1024)).toFixed(1) + " M";
}

export default function FileBrowser(
  props: { mcpUrl: string; cwd: () => string; setCwd: (v: string) => void },
) {
  const { t } = useI18n();
  const [version, setVersion] = createSignal(0);

  const [entries] = createResource(
    () => ({ cwd: props.cwd(), v: version() }),
    async ({ cwd }) => {
      const result = await mcpCall<{ entries: FileEntry[] }>(
        props.mcpUrl,
        "file_list",
        { path: cwd },
      );
      const items = result?.entries ?? [];
      items.sort((a, b) => {
        if (a.type === "directory" && b.type !== "directory") return -1;
        if (a.type !== "directory" && b.type === "directory") return 1;
        return a.name.localeCompare(b.name);
      });
      return items;
    },
  );

  const navigate = (name: string) => {
    const current = props.cwd().replace(/\/+$/, "");
    props.setCwd(
      name === ".."
        ? (current.replace(/\/[^/]+$/, "") || "/")
        : current + "/" + name,
    );
  };

  return (
    <div>
      <div class="flex gap-2 items-center" style="margin-bottom:0.5rem">
        <span style="font-size:0.8125rem; font-weight:600">{t("files")}</span>
        <input
          class="input input-mono flex-1"
          style="font-size:0.8125rem"
          value={props.cwd()}
          onInput={(e) => props.setCwd(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setVersion((v) => v + 1);
          }}
        />
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
        style="max-height:240px; overflow-y:auto; font-size:0.8125rem"
      >
        <Show
          when={!entries.loading}
          fallback={
            <div style="padding:1rem; text-align:center" class="muted">
              {t("loadingEllipsis")}
            </div>
          }
        >
          <Show
            when={(entries() ?? []).length > 0}
            fallback={
              <div style="padding:0.75rem" class="muted">
                {t("emptyDirectory")}
              </div>
            }
          >
            <For each={entries()}>
              {(e) => (
                <div
                  class="flex gap-2 items-center"
                  style={`padding:0.375rem 0.75rem; border-bottom:1px solid #0f172a;${
                    e.type === "directory" ? "cursor:pointer" : ""
                  }`}
                  onClick={() => {
                    if (e.type === "directory") navigate(e.name);
                  }}
                >
                  <span>
                    {e.type === "directory" ? "\u{1F4C1}" : "\u{1F4C4}"}
                  </span>
                  <span
                    class="flex-1"
                    style={{
                      color: e.type === "directory" ? "#60a5fa" : "#e2e8f0",
                    }}
                  >
                    {e.name}
                  </span>
                  <Show when={e.type === "file"}>
                    <span class="mono muted" style="font-size:0.75rem">
                      {formatSize(e.size)}
                    </span>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  );
}
