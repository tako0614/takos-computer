import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { mcpCall } from "../lib/mcp.ts";
import { useI18n } from "../i18n.ts";
import { attachDialogTrap } from "../lib/dialog-a11y.ts";
import {
  buildBreadcrumbs,
  formatFileSize,
  joinWorkspacePath,
  parentWorkspaceDirectory,
} from "../lib/file-paths.ts";
import { formatAbsoluteTime, formatRelativeTime } from "../lib/format-time.ts";
import { validateNewFileName } from "../lib/validation.ts";
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
  const { language, t } = useI18n();
  const [version, setVersion] = createSignal(0);
  const [selectedFile, setSelectedFile] = createSignal<OpenFileTarget | null>(
    null,
  );
  const [newFileOpen, setNewFileOpen] = createSignal(false);
  let pathInput!: HTMLInputElement;
  let composing = false;

  createEffect(() => {
    const next = props.cwd();
    if (!composing && pathInput && pathInput.value !== next) {
      pathInput.value = next;
    }
  });

  // Close drawer & new-file dialog when switching sandbox sessions.
  createEffect(() => {
    const _url = props.mcpUrl;
    setSelectedFile(null);
    setNewFileOpen(false);
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

  const openNewFile = (relativePath: string, basename: string) => {
    setNewFileOpen(false);
    setSelectedFile({
      path: joinWorkspacePath(props.cwd(), relativePath),
      name: basename,
      size: 0,
      isNew: true,
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
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onClick={() => setNewFileOpen(true)}
        >
          {t("newFile")}
        </button>
      </div>

      <nav
        class="file-breadcrumbs mono"
        aria-label={t("directoryBreadcrumbs")}
      >
        <ol class="breadcrumb-list">
          <For each={breadcrumbs()}>
            {(crumb, index) => {
              const displayLabel = () =>
                crumb.path === "." ? t("workspaceRootLabel") : crumb.label;
              return (
                <li class="breadcrumb-item">
                  <Show when={index() > 0}>
                    <span class="breadcrumb-sep" aria-hidden="true">/</span>
                  </Show>
                  <Show
                    when={!crumb.current}
                    fallback={
                      <span class="breadcrumb-current" aria-current="page">
                        {displayLabel()}
                      </span>
                    }
                  >
                    <button
                      type="button"
                      class="breadcrumb-btn"
                      aria-label={crumb.path === "."
                        ? t("workspaceRoot")
                        : undefined}
                      onClick={() => navigateTo(crumb.path)}
                    >
                      {displayLabel()}
                    </button>
                  </Show>
                </li>
              );
            }}
          </For>
        </ol>
      </nav>

      <div class="card panel-scroll" aria-busy={entries.loading}>
        <Show
          when={!entries.loading}
          fallback={
            <div class="panel-placeholder" role="status">
              <div class="skeleton-stack" aria-hidden="true">
                <div class="skeleton-line skeleton-line-md" />
                <div class="skeleton-line skeleton-line-lg" />
                <div class="skeleton-line skeleton-line-sm" />
              </div>
              <div class="muted panel-loading-label">
                {t("loadingEllipsis")}
              </div>
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
                  const icon = () =>
                    e.type === "directory"
                      ? "\u{1F4C1}"
                      : e.type === "symlink"
                      ? "\u{1F517}"
                      : "\u{1F4C4}";
                  const content = () => (
                    <>
                      <span aria-hidden="true">{icon()}</span>
                      <span
                        class="flex-1 file-name"
                        classList={{ "file-name-dir": e.type === "directory" }}
                      >
                        {e.name}
                      </span>
                      <Show when={e.type === "symlink"}>
                        <span class="badge file-kind-badge">
                          {t("symlink")}
                        </span>
                      </Show>
                      <Show when={e.modified}>
                        {(iso) => (
                          <time
                            class="mono muted file-modified"
                            dateTime={iso()}
                            title={formatAbsoluteTime(iso(), language()) ||
                              undefined}
                          >
                            {formatRelativeTime(iso(), t)}
                          </time>
                        )}
                      </Show>
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

      <CreateFileDialog
        open={newFileOpen()}
        cwd={props.cwd()}
        onClose={() => setNewFileOpen(false)}
        onCreate={openNewFile}
      />

      <FileDrawer
        mcpUrl={props.mcpUrl}
        file={selectedFile()}
        onClose={() => setSelectedFile(null)}
        onSaved={refresh}
      />
    </div>
  );
}

function CreateFileDialog(props: {
  open: boolean;
  cwd: string;
  onClose: () => void;
  onCreate: (relativePath: string, basename: string) => void;
}) {
  const { t } = useI18n();
  const id = createUniqueId();
  const [dialogEl, setDialogEl] = createSignal<HTMLDivElement | undefined>();
  const [error, setError] = createSignal("");
  let inputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (!props.open) {
      setError("");
      setDialogEl(undefined);
      return;
    }
    setError("");
    const el = dialogEl();
    if (!el) return;
    const detach = attachDialogTrap({
      container: el,
      onEscape: props.onClose,
      getInitialFocus: () => inputRef,
    });
    onCleanup(detach);
  });

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const validation = validateNewFileName(inputRef?.value ?? "");
    if (!validation.ok) {
      setError(t(validation.errorKey, validation.params));
      return;
    }
    setError("");
    props.onCreate(validation.value.relativePath, validation.value.basename);
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) props.onClose();
          }}
        >
          <div
            ref={(el) => {
              setDialogEl(el);
            }}
            class="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-hint`}
            tabIndex={-1}
          >
            <h2 id={`${id}-title`} class="modal-title">
              {t("createFileTitle")}
            </h2>
            <form onSubmit={handleSubmit}>
              <label for={`${id}-name`}>{t("fileNameLabel")}</label>
              <input
                ref={(el) => {
                  inputRef = el;
                }}
                id={`${id}-name`}
                name="fileName"
                required
                placeholder={t("fileNamePlaceholder")}
                onInput={() => {
                  if (error()) setError("");
                }}
              />
              <p id={`${id}-hint`} class="muted file-path-hint">
                {t("fileNameHint")}{" "}
                <span class="mono">({props.cwd})</span>
              </p>

              <Show when={error()}>
                {(message) => (
                  <div class="alert-banner" role="alert">
                    {message()}
                  </div>
                )}
              </Show>

              <div class="modal-actions">
                <button
                  type="button"
                  class="btn btn-ghost"
                  onClick={props.onClose}
                >
                  {t("cancel")}
                </button>
                <button type="submit" class="btn btn-primary">
                  {t("create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
