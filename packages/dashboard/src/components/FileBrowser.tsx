import {
  createEffect,
  createResource,
  createSignal,
  For,
  Show,
} from "solid-js";
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
  const { t } = useI18n();
  const [version, setVersion] = createSignal(0);
  let pathInput!: HTMLInputElement;
  let composing = false;

  createEffect(() => {
    const next = props.cwd();
    if (!composing && pathInput && pathInput.value !== next) {
      pathInput.value = next;
    }
  });

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
    const current = props.cwd();
    if (current.startsWith("/")) return ".";
    const segments: string[] = [];
    for (const segment of current.split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === "..") {
        // An unknown path above root cannot establish its relative parent.
        if (!segments.length) return ".";
        segments.pop();
      } else segments.push(segment);
    }
    segments.pop();
    return segments.length
      ? `${current.startsWith("./") ? "./" : ""}${segments.join("/")}`
      : ".";
  };

  const navigateTo = (next: string) => {
    const previousFocus = document.activeElement;
    const mcpUrl = props.mcpUrl;
    props.setCwd(next);
    // Replacing the directory rows can remove the keyboard's focused button.
    queueMicrotask(() => {
      if (
        pathInput.isConnected && props.mcpUrl === mcpUrl &&
        props.cwd() === next &&
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

  const refresh = () => setVersion((v) => v + 1);

  return (
    <div>
      <div class="section-header">
        <span role="heading" aria-level={2} class="section-title">
          {t("files")}
        </span>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          aria-label={props.cwd().startsWith("/")
            ? t("workspaceRoot")
            : t("parentDirectory")}
          disabled={props.cwd() === "."}
          onClick={() => navigate("..")}
        >
          ↑ {props.cwd().startsWith("/") ? t("root") : t("up")}
        </button>
        <input
          ref={(el) => {
            pathInput = el;
            el.value = props.cwd();
          }}
          class="input input-mono flex-1 file-toolbar-path"
          aria-label={t("directoryPath")}
          onCompositionStart={() => {
            composing = true;
          }}
          onCompositionEnd={(e) => {
            composing = false;
            props.setCwd(e.currentTarget.value);
          }}
          onInput={(e) => {
            if (!e.isComposing && !composing) {
              props.setCwd(e.currentTarget.value);
            }
          }}
          onKeyDown={(e) => {
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") refresh();
          }}
        />
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onClick={refresh}
        >
          {t("refresh")}
        </button>
      </div>
      <div class="card panel-scroll" aria-busy={entries.loading}>
        <Show
          when={!entries.loading}
          fallback={
            <div class="panel-placeholder muted">
              {t("loadingEllipsis")}
            </div>
          }
        >
          <Show
            when={!entries.error}
            fallback={
              <div role="alert" class="panel-error">
                <span>
                  {t("error", {
                    message: entries.error instanceof Error
                      ? entries.error.message
                      : String(entries.error),
                  })}
                </span>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  onClick={refresh}
                >
                  {t("retry")}
                </button>
              </div>
            }
          >
            <Show
              when={(entries() ?? []).length > 0}
              fallback={
                <div class="panel-empty muted">
                  {t("emptyDirectory")}
                </div>
              }
            >
              <For each={entries()}>
                {(e) => {
                  const content = () => (
                    <>
                      <span aria-hidden="true">
                        {e.type === "directory" ? "\u{1F4C1}" : "\u{1F4C4}"}
                      </span>
                      <span
                        class="flex-1 file-name"
                        classList={{ "file-name-dir": e.type === "directory" }}
                      >
                        {e.name}
                      </span>
                      <Show when={e.type === "file"}>
                        <span class="mono muted file-size">
                          {formatSize(e.size)}
                        </span>
                      </Show>
                    </>
                  );
                  return e.type === "directory"
                    ? (
                      <button
                        type="button"
                        class="file-row file-row-btn"
                        onClick={() => navigate(e.name)}
                      >
                        {content()}
                      </button>
                    )
                    : (
                      <div class="file-row">
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
