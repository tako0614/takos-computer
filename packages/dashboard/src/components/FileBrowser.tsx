import { createResource, createSignal, For, Show } from "solid-js";
import { mcpCall } from "../lib/mcp.ts";
import { useI18n } from "../i18n.ts";

interface FileEntry {
  name: string;
  type: "file" | "directory" | "symlink" | "unknown";
  size: number;
  modified: string | null;
}

function isFileEntry(value: unknown): value is FileEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.name === "string" &&
    typeof entry.type === "string" &&
    ["file", "directory", "symlink", "unknown"].includes(entry.type) &&
    typeof entry.size === "number" && Number.isFinite(entry.size) &&
    entry.size >= 0 &&
    (entry.modified === null || typeof entry.modified === "string")
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " K";
  return (bytes / (1024 * 1024)).toFixed(1) + " M";
}

export default function FileBrowser(
  props: { mcpUrl: string; cwd: () => string; setCwd: (v: string) => void },
) {
  const { t, language } = useI18n();
  const [version, setVersion] = createSignal(0);
  let pathInput!: HTMLInputElement;

  const [entries] = createResource(
    () => ({ cwd: props.cwd(), v: version(), mcpUrl: props.mcpUrl }),
    async ({ cwd, mcpUrl }) => {
      const result = await mcpCall<unknown>(
        mcpUrl,
        "file_list",
        { path: cwd },
      );
      const items = result && typeof result === "object"
        ? (result as { entries?: unknown }).entries
        : undefined;
      if (!Array.isArray(items) || !items.every(isFileEntry)) {
        throw new Error("Invalid file list response");
      }
      items.sort((a, b) => {
        if (a.type === "directory" && b.type !== "directory") return -1;
        if (a.type !== "directory" && b.type === "directory") return 1;
        return a.name.localeCompare(b.name);
      });
      return items;
    },
  );

  const parentDirectory = () => {
    // Absolute paths do not reveal the configured jail root to this client.
    if (props.cwd().startsWith("/")) return ".";
    const current = props.cwd().replace(/\/+$/, "");
    if (!current || current === "." || current.split("/").includes("..")) {
      return ".";
    }
    const slash = current.lastIndexOf("/");
    return slash < 0 ? "." : slash === 0 ? "/" : current.slice(0, slash);
  };

  const navigateTo = (next: string) => {
    const previousFocus = document.activeElement;
    const mcpUrl = props.mcpUrl;
    props.setCwd(next);
    // Replacing the directory rows can remove the keyboard's focused button.
    queueMicrotask(() => {
      if (
        pathInput.isConnected && props.mcpUrl === mcpUrl && props.cwd() === next &&
        document.activeElement === document.body &&
        (!previousFocus?.isConnected ||
          previousFocus instanceof HTMLButtonElement && previousFocus.disabled)
      ) pathInput.focus();
    });
  };

  const navigate = (name: string) => {
    if (name === "..") {
      navigateTo(parentDirectory());
      return;
    }
    const current = props.cwd() === "/"
      ? "/"
      : props.cwd().replace(/\/+$/, "") || ".";
    navigateTo(current === "/" ? `/${name}` : `${current}/${name}`);
  };

  return (
    <div>
      <div class="flex gap-2 items-center" style="margin-bottom:0.5rem">
        <span style="font-size:0.8125rem; font-weight:600">{t("files")}</span>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          aria-label={props.cwd().startsWith("/")
            ? language() === "ja" ? "作業フォルダのルートへ" : "Workspace root"
            : language() === "ja" ? "親フォルダへ" : "Parent directory"}
          disabled={props.cwd() === "."}
          onClick={() => navigate("..")}
        >
          ↑ {props.cwd().startsWith("/")
            ? language() === "ja" ? "ルート" : "Root"
            : language() === "ja" ? "上へ" : "Up"}
        </button>
        <input
          ref={pathInput}
          class="input input-mono flex-1"
          style="font-size:0.8125rem; min-width:0"
          aria-label={language() === "ja" ? "フォルダのパス" : "Directory path"}
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
            when={!entries.error}
            fallback={
              <div role="alert" style="padding:0.75rem; color:#fca5a5">
                {t("error", {
                  message: entries.error instanceof Error
                    ? entries.error.message
                    : String(entries.error),
                })}
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
                {(e) => {
                  const content = () => (
                    <>
                      <span>
                        {e.type === "directory" ? "\u{1F4C1}" : "\u{1F4C4}"}
                      </span>
                      <span
                        class="flex-1"
                        style={{
                          "min-width": "0",
                          "overflow-wrap": "anywhere",
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
                    </>
                  );
                  const rowStyle =
                    "padding:0.375rem 0.75rem; border-bottom:1px solid #0f172a;";
                  return e.type === "directory"
                    ? (
                      <button
                        type="button"
                        class="flex gap-2 items-center"
                        style={`${rowStyle}width:100%; border-top:0; border-left:0; border-right:0; background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer`}
                        onClick={() => navigate(e.name)}
                      >
                        {content()}
                      </button>
                    )
                    : (
                      <div class="flex gap-2 items-center" style={rowStyle}>
                        {content()}
                      </div>
                    );
                }}
              </For>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}
