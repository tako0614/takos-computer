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
  isNew?: boolean;
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
  const [isNewFile, setIsNewFile] = createSignal(false);
  const [originalContent, setOriginalContent] = createSignal("");
  const [draft, setDraft] = createSignal("");
  const [fileSize, setFileSize] = createSignal(0);
  const [truncated, setTruncated] = createSignal(false);
  const [binary, setBinary] = createSignal(false);

  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal("");
  const [saveStatus, setSaveStatus] = createSignal("");
  const [copyFeedback, setCopyFeedback] = createSignal<
    "copied" | "copyFailed" | null
  >(null);
  const [discardAction, setDiscardAction] = createSignal<
    "close" | "reload" | null
  >(null);
  const [reloadNonce, setReloadNonce] = createSignal(0);

  let closeBtnRef: HTMLButtonElement | undefined;
  let editorRef: HTMLTextAreaElement | undefined;
  let alive = true;
  let composing = false;
  let pendingReloadNotice = false;
  let lastLoadedFile: OpenFileTarget | null = null;
  let lastLoadedMcpUrl = "";
  let activeReadToken = 0;
  let activeWriteToken = 0;
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => {
    alive = false;
    if (copyTimer !== undefined) clearTimeout(copyTimer);
  });

  const isOpen = () => Boolean(props.file);
  const readOnly = createMemo(() => truncated() || binary());
  const isDirty = createMemo(
    () =>
      !loading() && !loadError() && !readOnly() &&
      draft() !== originalContent(),
  );
  const canSave = createMemo(
    () =>
      !loading() && !loadError() && !readOnly() &&
      (isNewFile() || draft() !== originalContent()),
  );
  const lineCount = createMemo(() => {
    const text = draft();
    if (!text) return 0;
    return text.split("\n").length;
  });

  const keepFocusInDrawer = (preferred?: HTMLElement | null) => {
    queueMicrotask(() => {
      const el = drawerEl();
      if (!alive || !isOpen() || !el?.isConnected) return;
      if (el.contains(document.activeElement)) return;
      if (preferred && el.contains(preferred) && !preferred.hasAttribute("disabled")) {
        preferred.focus();
        return;
      }
      if (editorRef && el.contains(editorRef)) {
        editorRef.focus();
        return;
      }
      if (closeBtnRef && el.contains(closeBtnRef) && !closeBtnRef.disabled) {
        closeBtnRef.focus();
        return;
      }
      el.focus();
    });
  };

  // Keep textarea DOM value in sync with external state without interrupting IME composition.
  createEffect(() => {
    const next = draft();
    if (!composing && editorRef && editorRef.value !== next) {
      editorRef.value = next;
    }
  });

  // Load file whenever target file, mcpUrl, or reloadNonce changes.
  createEffect(() => {
    const file = props.file;
    const mcpUrl = props.mcpUrl;
    const _nonce = reloadNonce();
    activeReadToken++;
    activeWriteToken++;
    const token = activeReadToken;
    composing = false;

    setDiscardAction(null);
    setSaveError("");
    setSaveStatus("");
    setCopyFeedback(null);
    setSaving(false);

    if (!file) {
      lastLoadedFile = null;
      lastLoadedMcpUrl = mcpUrl;
      pendingReloadNotice = false;
      setDrawerEl(undefined);
      setIsNewFile(false);
      setLoading(false);
      setLoadError("");
      setOriginalContent("");
      setDraft("");
      setTruncated(false);
      setBinary(false);
      return;
    }

    const targetChanged = file !== lastLoadedFile || mcpUrl !== lastLoadedMcpUrl;
    lastLoadedFile = file;
    lastLoadedMcpUrl = mcpUrl;

    setFileSize(file.size);
    setLoadError("");

    if (targetChanged && file.isNew) {
      pendingReloadNotice = false;
      setIsNewFile(true);
      setLoading(false);
      setBinary(false);
      setTruncated(false);
      setOriginalContent("");
      setDraft("");
      queueMicrotask(() => {
        if (alive && isOpen() && editorRef?.isConnected) {
          editorRef.focus();
        }
      });
      return;
    }

    if (targetChanged) {
      setIsNewFile(false);
    }

    if (isLikelyBinaryFile(file.name)) {
      pendingReloadNotice = false;
      setLoading(false);
      setBinary(true);
      setTruncated(false);
      setOriginalContent("");
      setDraft("");
      return;
    }

    const announceReload = pendingReloadNotice;
    pendingReloadNotice = false;
    setLoading(true);
    setBinary(false);
    setTruncated(false);
    // Keep keyboard focus inside the drawer across all reload entry points
    // (toolbar Reload, dirty-reload ConfirmDialog Discard, and error Retry).
    keepFocusInDrawer(closeBtnRef);

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
          if (announceReload) {
            setSaveStatus(t("fileReloaded"));
          }
          queueMicrotask(() => {
            const el = drawerEl();
            if (!alive || !el?.isConnected || !editorRef?.isConnected) return;
            const activeEl = document.activeElement;
            if (
              !activeEl || activeEl === document.body || activeEl === el ||
              activeEl === closeBtnRef
            ) {
              editorRef.focus();
            }
          });
        }
      } catch (err) {
        if (!alive || token !== activeReadToken) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive && token === activeReadToken) {
          setLoading(false);
          keepFocusInDrawer(editorRef ?? closeBtnRef);
        }
      }
    })();
  });

  // Warn before closing/reloading the browser tab while edits are unsaved.
  createEffect(() => {
    if (!isOpen() || !isDirty()) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    onCleanup(() => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    });
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
      getInitialFocus: () => editorRef ?? closeBtnRef,
    });
    onCleanup(detach);
  });

  const triggerReload = () => {
    if (loading() || saving() || isNewFile()) return;
    if (isDirty()) {
      setDiscardAction("reload");
      return;
    }
    pendingReloadNotice = true;
    keepFocusInDrawer(closeBtnRef);
    setReloadNonce((n) => n + 1);
  };

  const copyPath = async () => {
    const file = props.file;
    if (!file) return;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(file.path);
      if (!alive) return;
      setCopyFeedback("copied");
    } catch {
      if (!alive) return;
      setCopyFeedback("copyFailed");
    }
    if (copyTimer !== undefined) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      if (alive) setCopyFeedback(null);
    }, 2000);
  };

  const save = async () => {
    const file = props.file;
    const mcpUrl = props.mcpUrl;
    if (!file || saving() || !canSave()) {
      return;
    }
    const contentToSave = editorRef ? editorRef.value : draft();
    if (contentToSave !== draft()) {
      setDraft(contentToSave);
    }
    const createDirs = isNewFile();
    const token = ++activeWriteToken;
    setSaving(true);
    setSaveError("");
    setSaveStatus("");
    keepFocusInDrawer(editorRef);

    try {
      const result = await mcpCall<FileWriteResult>(mcpUrl, "file_write", {
        path: file.path,
        content: contentToSave,
        ...(createDirs ? { create_dirs: true } : {}),
      });
      if (!alive || token !== activeWriteToken) return;
      const bytes = typeof result?.bytes_written === "number"
        ? result.bytes_written
        : new TextEncoder().encode(contentToSave).byteLength;
      setIsNewFile(false);
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
        keepFocusInDrawer(editorRef ?? closeBtnRef);
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
                      <Show when={isNewFile()}>
                        <span class="badge badge-starting">
                          {t("newFileBadge")}
                        </span>
                      </Show>
                      <Show when={!isNewFile() && isDirty()}>
                        <span class="badge badge-starting">
                          {t("unsavedChanges")}
                        </span>
                      </Show>
                      <Show when={readOnly() && !loading() && !loadError()}>
                        <span class="badge">{t("readOnly")}</span>
                      </Show>
                    </div>
                    <div class="drawer-path-row">
                      <div class="drawer-path mono muted" title={file().path}>
                        {file().path}
                      </div>
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm drawer-copy-btn"
                        aria-label={t("copyPath")}
                        onClick={() => void copyPath()}
                      >
                        {copyFeedback() ? t(copyFeedback()!) : t("copyPath")}
                      </button>
                      <span class="sr-only" role="status" aria-live="polite">
                        {copyFeedback() === "copied"
                          ? t("pathCopied")
                          : copyFeedback() === "copyFailed"
                          ? t("copyFailed")
                          : ""}
                      </span>
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
                      <div class="drawer-placeholder" role="status">
                        <div class="skeleton-stack" aria-hidden="true">
                          <div class="skeleton-line skeleton-line-lg" />
                          <div class="skeleton-line skeleton-line-md" />
                          <div class="skeleton-line skeleton-line-lg" />
                          <div class="skeleton-line skeleton-line-sm" />
                        </div>
                        <div class="muted drawer-loading-label">
                          {t("loadingEllipsis")}
                        </div>
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
                            el.value = draft();
                          }}
                          class="file-editor mono"
                          aria-label={t("fileContents")}
                          readOnly={readOnly() || saving()}
                          spellcheck={false}
                          onCompositionStart={() => {
                            composing = true;
                          }}
                          onCompositionEnd={(e) => {
                            composing = false;
                            setDraft(e.currentTarget.value);
                            if (saveStatus()) setSaveStatus("");
                            if (saveError()) setSaveError("");
                          }}
                          onInput={(e) => {
                            if (!e.isComposing && !composing) {
                              setDraft(e.currentTarget.value);
                              if (saveStatus()) setSaveStatus("");
                              if (saveError()) setSaveError("");
                            }
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
                    <Show when={!isNewFile()}>
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm"
                        disabled={loading() || saving()}
                        onClick={triggerReload}
                      >
                        {t("reload")}
                      </button>
                    </Show>
                    <Show when={!readOnly()}>
                      <button
                        type="button"
                        class="btn btn-primary btn-sm"
                        disabled={!canSave() || saving()}
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
                pendingReloadNotice = true;
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
