import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
} from "solid-js";
import { mcpCall } from "../lib/mcp.ts";
import { useI18n } from "../i18n.ts";
import {
  buildBreadcrumbs,
  formatFileSize,
  joinWorkspacePath,
  parentWorkspaceDirectory,
} from "../lib/file-paths.ts";
import FileDrawer, { type OpenFileTarget } from "./FileDrawer.tsx";

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

export default function FileBrowser(
  props: { mcpUrl: string; cwd: () => string; setCwd: (v: string) => void },
) {
  const { t } = useI18n();
  const [version, setVersion] = createSignal(0);
  const [selectedFile, setSelectedFile] = createSignal<OpenFileTarget | null>(
    null,
  );
  let pathInput!: HTMLInputElement;
  let composing = false;

  createEffect(() => {
    const next = props.cwd();
    if (!composing && pathInput && pathInput.value !== next) {
      pathInput.value = next;
    }
  });

  // Close drawer when switching sandbox sessions.
  createEffect(() => {
    const _url = props.mcpUrl;
    setSelectedFile(null);
  });

  const breadcrumbs = createMemo(() => buildBreadcrumbs(props.cwd()));

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
      navigateTo(parentWorkspaceDirectory(props.cwd()));
      return;
    }
    navigateTo(joinWorkspacePath(props.cwd(), name));
  };

  const openFile = (entry: FileEntry) => {
    setSelectedFile({
      path: joinWorkspacePath(props.cwd(), entry.name),
      name: entry.name,
      size: entry.size,
    });
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

      <nav
        class="file-breadcrumbs mono"
        aria-label={t("directoryBreadcrumbs")}
      >
        <ol class="breadcrumb-list">
          <For each={breadcrumbs()}>
            {(crumb, index) => (
              <li class="breadcrumb-item">
                <Show when={index() > 0}>
                  <span class="breadcrumb-sep" aria-hidden="true">/</span>
                </Show>
                <Show
                  when={!crumb.current}
                  fallback={
                    <span class="breadcrumb-current" aria-current="page">
                      {crumb.label}
                    </span>
                  }
                >
                  <button
                    type="button"
                    class="breadcrumb-btn"
                    onClick={() => navigateTo(crumb.path)}
                  >
                    {crumb.label}
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ol>
      </nav>

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
                          {formatFileSize(e.size)}
                        </span>
                      </Show>
                    </>
                  );
                  if (e.type === "directory") {
                    return (
                      <button
                        type="button"
                        class="file-row file-row-btn"
                        onClick={() => navigate(e.name)}
                      >
                        {content()}
                      </button>
                    );
                  }
                  if (e.type === "file") {
                    return (
                      <button
                        type="button"
                        class="file-row file-row-btn"
                        aria-label={t("openFileAria", { name: e.name })}
                        onClick={() => openFile(e)}
                      >
                        {content()}
                      </button>
                    );
                  }
                  return (
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

      <FileDrawer
        mcpUrl={props.mcpUrl}
        file={selectedFile()}
        onClose={() => setSelectedFile(null)}
        onSaved={refresh}
      />
    </div>
  );
}
