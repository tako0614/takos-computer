import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { mcpCall } from "../lib/mcp.ts";
import { useI18n } from "../i18n.ts";
import { attachDialogTrap } from "../lib/dialog-a11y.ts";
import {
  formatFileSize,
  isLikelyBinaryFile,
} from "../lib/file-paths.ts";
import ConfirmDialog from "./ConfirmDialog.tsx";

export interface OpenFileTarget {
  path: string;
  name: string;
  size: number;
}

interface FileReadResult {
  content: string;
  size: number;
  truncated: boolean;
}

interface FileWriteResult {
  path: string;
  bytes_written: number;
}

export default function FileDrawer(props: {
  mcpUrl: string;
  file: OpenFileTarget | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { t } = useI18n();
  const id = createUniqueId();

  const [drawerEl, setDrawerEl] = createSignal<HTMLDivElement | undefined>();
  const [loading, setLoading] = createSignal(false);
  const [loadError, setLoadError] = createSignal("");
  const [originalContent, setOriginalContent] = createSignal("");
  const [draft, setDraft] = createSignal("");
  const [fileSize, setFileSize] = createSignal(0);
  const [truncated, setTruncated] = createSignal(false);
  const [binary, setBinary] = createSignal(false);

  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal("");
  const [saveStatus, setSaveStatus] = createSignal("");
  const [discardAction, setDiscardAction] = createSignal<
    "close" | "reload" | null
  >(null);
  const [reloadNonce, setReloadNonce] = createSignal(0);

  let closeBtnRef: HTMLButtonElement | undefined;
  let editorRef: HTMLTextAreaElement | undefined;
  let alive = true;
  let activeReadToken = 0;
  let activeWriteToken = 0;

  onCleanup(() => {
    alive = false;
  });

  const isOpen = () => Boolean(props.file);
  const readOnly = createMemo(() => truncated() || binary());
  const isDirty = createMemo(
    () =>
      !loading() && !loadError() && !readOnly() &&
      draft() !== originalContent(),
  );
  const lineCount = createMemo(() => {
    const text = draft();
    if (!text) return 0;
    return text.split("\n").length;
  });

  // Load file whenever target file, mcpUrl, or reloadNonce changes.
  createEffect(() => {
    const file = props.file;
    const mcpUrl = props.mcpUrl;
    const _nonce = reloadNonce();
    activeReadToken++;
    activeWriteToken++;
    const token = activeReadToken;

    setDiscardAction(null);
    setSaveError("");
    setSaveStatus("");
    setSaving(false);

    if (!file) {
      setDrawerEl(undefined);
      setLoading(false);
      setLoadError("");
      setOriginalContent("");
      setDraft("");
      setTruncated(false);
      setBinary(false);
      return;
    }

    setFileSize(file.size);
    setLoadError("");

    if (isLikelyBinaryFile(file.name)) {
      setLoading(false);
      setBinary(true);
      setTruncated(false);
      setOriginalContent("");
      setDraft("");
      return;
    }

    setLoading(true);
    setBinary(false);
    setTruncated(false);

    void (async () => {
      try {
        const result = await mcpCall<FileReadResult>(mcpUrl, "file_read", {
          path: file.path,
        });
        if (!alive || token !== activeReadToken) return;
        const content = typeof result?.content === "string"
          ? result.content
          : "";
        const size = typeof result?.size === "number" &&
            Number.isFinite(result.size)
          ? result.size
          : file.size;
        const isTruncated = Boolean(result?.truncated);
        const isBinary = isLikelyBinaryFile(file.name, content);

        setFileSize(size);
        setTruncated(isTruncated);
        setBinary(isBinary);
        if (isBinary) {
          setOriginalContent("");
          setDraft("");
        } else {
          setOriginalContent(content);
          setDraft(content);
        }
      } catch (err) {
        if (!alive || token !== activeReadToken) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive && token === activeReadToken) {
          setLoading(false);
        }
      }
    })();
  });

  const requestClose = () => {
    if (saving()) return;
    if (isDirty()) {
      setDiscardAction("close");
      return;
    }
    props.onClose();
  };

  createEffect(() => {
    if (!isOpen()) return;
    const el = drawerEl();
    if (!el) return;
    const detach = attachDialogTrap({
      container: el,
      onEscape: requestClose,
      getInitialFocus: () => closeBtnRef,
    });
    onCleanup(detach);
  });

  const save = async () => {
    const file = props.file;
    const mcpUrl = props.mcpUrl;
    if (
      !file || saving() || loading() || loadError() || readOnly() || !isDirty()
    ) {
      return;
    }
    const contentToSave = draft();
    const token = ++activeWriteToken;
    setSaving(true);
    setSaveError("");
    setSaveStatus("");

    try {
      const result = await mcpCall<FileWriteResult>(mcpUrl, "file_write", {
        path: file.path,
        content: contentToSave,
      });
      if (!alive || token !== activeWriteToken) return;
      const bytes = typeof result?.bytes_written === "number"
        ? result.bytes_written
        : new TextEncoder().encode(contentToSave).byteLength;
      setOriginalContent(contentToSave);
      setFileSize(bytes);
      setSaveStatus(t("fileSaved", { bytes }));
      props.onSaved?.();
    } catch (err) {
      if (!alive || token !== activeWriteToken) return;
      setSaveError(
        t("saveFailed", {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      if (alive && token === activeWriteToken) {
        setSaving(false);
      }
    }
  };

  const onDrawerKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      event.key.toLowerCase() === "s"
    ) {
      event.preventDefault();
      void save();
    }
  };

  return (
    <Show when={props.file}>
      {(file) => (
        <>
          <Portal>
            <div
              class="drawer-overlay"
              onClick={(e) => {
                if (e.target === e.currentTarget) requestClose();
              }}
            >
              <div
                ref={(el) => {
                  setDrawerEl(el);
                }}
                class="drawer-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby={`${id}-title`}
                aria-busy={loading() || saving()}
                tabIndex={-1}
                onKeyDown={onDrawerKeyDown}
              >
                <div class="drawer-header">
                  <div class="drawer-title-group">
                    <div class="drawer-title-row">
                      <h2 id={`${id}-title`} class="drawer-title mono">
                        {file().name}
                      </h2>
                      <Show when={isDirty()}>
                        <span class="badge badge-starting">
                          {t("unsavedChanges")}
                        </span>
                      </Show>
                      <Show when={readOnly() && !loading() && !loadError()}>
                        <span class="badge">{t("readOnly")}</span>
                      </Show>
                    </div>
                    <div class="drawer-path mono muted" title={file().path}>
                      {file().path}
                    </div>
                  </div>
                  <button
                    ref={(el) => {
                      closeBtnRef = el;
                    }}
                    type="button"
                    class="btn btn-ghost btn-sm"
                    disabled={saving()}
                    aria-label={t("close")}
                    onClick={requestClose}
                  >
                    &times; {t("close")}
                  </button>
                </div>

                <div class="drawer-body">
                  <Show when={saveError()}>
                    {(message) => (
                      <div role="alert" class="alert-banner">
                        {message()}
                      </div>
                    )}
                  </Show>

                  <Show when={saveStatus()}>
                    {(message) => (
                      <div
                        role="status"
                        aria-live="polite"
                        class="status-banner"
                      >
                        {message()}
                      </div>
                    )}
                  </Show>

                  <Show
                    when={!loading()}
                    fallback={
                      <div class="drawer-placeholder muted">
                        {t("loadingEllipsis")}
                      </div>
                    }
                  >
                    <Show
                      when={!loadError()}
                      fallback={
                        <div role="alert" class="panel-error drawer-error">
                          <span>{t("error", { message: loadError() })}</span>
                          <button
                            type="button"
                            class="btn btn-ghost btn-sm"
                            onClick={() => setReloadNonce((n) => n + 1)}
                          >
                            {t("retry")}
                          </button>
                        </div>
                      }
                    >
                      <Show
                        when={!binary()}
                        fallback={
                          <div class="info-banner" role="status">
                            {t("binaryFileNotice", {
                              size: formatFileSize(fileSize()),
                            })}
                          </div>
                        }
                      >
                        <Show when={truncated()}>
                          <div class="info-banner" role="status">
                            {t("truncatedFileNotice", {
                              size: formatFileSize(fileSize()),
                            })}
                          </div>
                        </Show>
                        <textarea
                          ref={(el) => {
                            editorRef = el;
                          }}
                          class="file-editor mono"
                          aria-label={t("fileContents")}
                          value={draft()}
                          readOnly={readOnly() || saving()}
                          spellcheck={false}
                          onInput={(e) => {
                            setDraft(e.currentTarget.value);
                            if (saveStatus()) setSaveStatus("");
                            if (saveError()) setSaveError("");
                          }}
                        />
                      </Show>
                    </Show>
                  </Show>
                </div>

                <div class="drawer-footer">
                  <div class="drawer-meta muted">
                    <span class="mono">{formatFileSize(fileSize())}</span>
                    <Show when={!loading() && !loadError() && !binary()}>
                      <span>&middot;</span>
                      <span>{t("linesCount", { count: lineCount() })}</span>
                    </Show>
                    <Show when={!loading() && !loadError() && !readOnly()}>
                      <span class="drawer-shortcut-hint">
                        &middot; {t("saveShortcutHint")}
                      </span>
                    </Show>
                  </div>
                  <div class="drawer-actions">
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      disabled={loading() || saving()}
                      onClick={() => {
                        if (isDirty()) {
                          setDiscardAction("reload");
                          return;
                        }
                        setReloadNonce((n) => n + 1);
                      }}
                    >
                      {t("reload")}
                    </button>
                    <Show when={!readOnly()}>
                      <button
                        type="button"
                        class="btn btn-primary btn-sm"
                        disabled={loading() || !!loadError() || !isDirty() ||
                          saving()}
                        aria-busy={saving()}
                        onClick={() => void save()}
                      >
                        {saving() ? t("saving") : t("save")}
                      </button>
                    </Show>
                  </div>
                </div>
              </div>
            </div>
          </Portal>

          <ConfirmDialog
            open={discardAction() !== null}
            title={t("discardChangesTitle")}
            description={t("discardChangesConfirm", { name: file().name })}
            confirmLabel={t("discard")}
            cancelLabel={t("keepEditing")}
            tone="danger"
            onCancel={() => {
              setDiscardAction(null);
              queueMicrotask(() => editorRef?.focus());
            }}
            onConfirm={() => {
              const action = discardAction();
              setDiscardAction(null);
              if (action === "reload") {
                setReloadNonce((n) => n + 1);
              } else {
                props.onClose();
              }
            }}
          />
        </>
      )}
    </Show>
  );
}
