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
  base64ToBytes,
  FILE_READ_CHUNK_BYTES,
  formatFileSize,
  getPreviewImageMimeType,
  isLikelyBinaryFile,
  MAX_DOWNLOAD_BYTES,
  MAX_IMAGE_PREVIEW_BYTES,
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

type ChunkedReadOutcome =
  | { ok: true; chunks: Uint8Array<ArrayBuffer>[]; size: number }
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: "too_large"; size: number };

async function readFileBytesChunked(
  mcpUrl: string,
  path: string,
  maxBytes: number,
  isCancelled: () => boolean,
): Promise<ChunkedReadOutcome> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  let totalSize = 0;

  while (true) {
    if (isCancelled()) return { ok: false, reason: "cancelled" };
    const result = await mcpCall<FileReadResult>(mcpUrl, "file_read", {
      path,
      offset,
      limit: FILE_READ_CHUNK_BYTES,
      encoding: "base64",
    });
    if (isCancelled()) return { ok: false, reason: "cancelled" };

    const size = typeof result?.size === "number" && Number.isFinite(result.size)
      ? result.size
      : totalSize;
    totalSize = size;
    if (size > maxBytes) {
      return { ok: false, reason: "too_large", size };
    }

    const content = typeof result?.content === "string" ? result.content : "";
    const bytes = base64ToBytes(content);
    if (bytes.byteLength > 0) {
      chunks.push(bytes);
      offset += bytes.byteLength;
    }

    if (!result?.truncated || bytes.byteLength === 0 || offset >= maxBytes) {
      break;
    }
  }

  return { ok: true, chunks, size: totalSize };
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
  const [imagePreviewUrl, setImagePreviewUrl] = createSignal<string | null>(
    null,
  );
  const [imageTooLarge, setImageTooLarge] = createSignal(false);
  const [imagePreviewFailed, setImagePreviewFailed] = createSignal(false);
  const [imageDims, setImageDims] = createSignal<
    { width: number; height: number } | null
  >(null);

  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal("");
  const [saveStatus, setSaveStatus] = createSignal("");
  const [downloading, setDownloading] = createSignal(false);
  const [downloadError, setDownloadError] = createSignal("");
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
  let activeDownloadToken = 0;
  let currentPreviewUrl: string | null = null;
  let cachedImageBlob: Blob | null = null;
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  const revokePreviewUrl = () => {
    if (currentPreviewUrl) {
      URL.revokeObjectURL(currentPreviewUrl);
      currentPreviewUrl = null;
    }
    cachedImageBlob = null;
    setImagePreviewUrl(null);
    setImageDims(null);
    setImageTooLarge(false);
    setImagePreviewFailed(false);
  };

  onCleanup(() => {
    alive = false;
    activeReadToken++;
    activeWriteToken++;
    activeDownloadToken++;
    revokePreviewUrl();
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
    activeDownloadToken++;
    const token = activeReadToken;
    composing = false;

    revokePreviewUrl();
    setDiscardAction(null);
    setSaveError("");
    setSaveStatus("");
    setDownloadError("");
    setDownloading(false);
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

    const imageMime = getPreviewImageMimeType(file.name);
    if (imageMime) {
      const announceReload = pendingReloadNotice;
      pendingReloadNotice = false;
      setBinary(true);
      setTruncated(false);
      setOriginalContent("");
      setDraft("");

      if (file.size > MAX_IMAGE_PREVIEW_BYTES) {
        setLoading(false);
        setImageTooLarge(true);
        return;
      }

      setLoading(true);
      keepFocusInDrawer(closeBtnRef);

      void (async () => {
        try {
          const outcome = await readFileBytesChunked(
            mcpUrl,
            file.path,
            MAX_IMAGE_PREVIEW_BYTES,
            () => !alive || token !== activeReadToken,
          );
          if (!alive || token !== activeReadToken) return;
          if (!outcome.ok) {
            if (outcome.reason === "too_large") {
              setFileSize(outcome.size);
              setImageTooLarge(true);
            }
            return;
          }
          const blob = new Blob(outcome.chunks, { type: imageMime });
          const objectUrl = URL.createObjectURL(blob);
          currentPreviewUrl = objectUrl;
          cachedImageBlob = blob;
          setFileSize(outcome.size);
          setImagePreviewUrl(objectUrl);
          if (announceReload) {
            setSaveStatus(t("fileReloaded"));
          }
        } catch (err) {
          if (!alive || token !== activeReadToken) return;
          setLoadError(err instanceof Error ? err.message : String(err));
        } finally {
          if (alive && token === activeReadToken) {
            setLoading(false);
            keepFocusInDrawer(closeBtnRef);
          }
        }
      })();
      return;
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
    if (loading() || saving() || downloading() || isNewFile()) return;
    if (isDirty()) {
      setDiscardAction("reload");
      return;
    }
    pendingReloadNotice = true;
    keepFocusInDrawer(closeBtnRef);
    setReloadNonce((n) => n + 1);
  };

  const triggerBrowserDownload = (blob: Blob, filename: string) => {
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  const downloadFile = async () => {
    const file = props.file;
    const mcpUrl = props.mcpUrl;
    if (!file || isNewFile() || loading() || saving() || downloading()) return;

    setDownloadError("");

    if (cachedImageBlob) {
      triggerBrowserDownload(cachedImageBlob, file.name);
      return;
    }

    if (fileSize() > MAX_DOWNLOAD_BYTES) {
      setDownloadError(
        t("downloadTooLarge", {
          size: formatFileSize(fileSize()),
          max: formatFileSize(MAX_DOWNLOAD_BYTES),
        }),
      );
      return;
    }

    const token = ++activeDownloadToken;
    setDownloading(true);
    keepFocusInDrawer(closeBtnRef);

    try {
      const outcome = await readFileBytesChunked(
        mcpUrl,
        file.path,
        MAX_DOWNLOAD_BYTES,
        () => !alive || token !== activeDownloadToken,
      );
      if (!alive || token !== activeDownloadToken) return;
      if (!outcome.ok) {
        if (outcome.reason === "too_large") {
          setFileSize(outcome.size);
          setDownloadError(
            t("downloadTooLarge", {
              size: formatFileSize(outcome.size),
              max: formatFileSize(MAX_DOWNLOAD_BYTES),
            }),
          );
        }
        return;
      }
      setFileSize(outcome.size);
      const mimeType = getPreviewImageMimeType(file.name) ??
        "application/octet-stream";
      const blob = new Blob(outcome.chunks, { type: mimeType });
      triggerBrowserDownload(blob, file.name);
    } catch (err) {
      if (!alive || token !== activeDownloadToken) return;
      setDownloadError(
        t("downloadFailed", {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      if (alive && token === activeDownloadToken) {
        setDownloading(false);
        keepFocusInDrawer(editorRef ?? closeBtnRef);
      }
    }
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
                aria-busy={loading() || saving() || downloading()}
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

                  <Show when={downloadError()}>
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
                          <Show
                            when={!imagePreviewFailed()
                              ? imagePreviewUrl()
                              : null}
                            fallback={
                              <div class="info-banner" role="status">
                                {imageTooLarge()
                                  ? t("imageTooLargeNotice", {
                                    size: formatFileSize(fileSize()),
                                    max: formatFileSize(MAX_IMAGE_PREVIEW_BYTES),
                                  })
                                  : imagePreviewFailed()
                                  ? t("imagePreviewFailed", {
                                    size: formatFileSize(fileSize()),
                                  })
                                  : t("binaryFileNotice", {
                                    size: formatFileSize(fileSize()),
                                  })}
                              </div>
                            }
                          >
                            {(url) => (
                              <div class="drawer-image-stage">
                                <img
                                  src={url()}
                                  alt={file().name}
                                  class="drawer-image-preview"
                                  onLoad={(e) => {
                                    setImageDims({
                                      width: e.currentTarget.naturalWidth,
                                      height: e.currentTarget.naturalHeight,
                                    });
                                  }}
                                  onError={() => {
                                    setImagePreviewFailed(true);
                                  }}
                                />
                              </div>
                            )}
                          </Show>
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
                    <Show when={imageDims()}>
                      {(dims) => (
                        <>
                          <span>&middot;</span>
                          <span class="mono">
                            {dims().width}&times;{dims().height} px
                          </span>
                        </>
                      )}
                    </Show>
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
                    <Show when={!isNewFile() && !loadError()}>
                      <button
                        type="button"
                        class={`btn btn-sm ${
                          readOnly() ? "btn-primary" : "btn-ghost"
                        }`}
                        disabled={loading() || saving() || downloading()}
                        aria-busy={downloading()}
                        onClick={() => void downloadFile()}
                      >
                        {downloading() ? t("downloading") : t("download")}
                      </button>
                    </Show>
                    <Show when={!isNewFile()}>
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm"
                        disabled={loading() || saving() || downloading()}
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
