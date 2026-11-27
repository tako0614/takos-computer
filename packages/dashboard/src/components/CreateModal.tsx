import {
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  Show,
} from "solid-js";
import { useI18n } from "../i18n.ts";

export default function CreateModal(props: {
  open: boolean;
  onClose: () => void;
  onCreate: (payload: {
    sessionId: string;
    spaceId: string;
    userId: string;
  }) => Promise<void>;
}) {
  const { t } = useI18n();
  const id = createUniqueId();
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  let formRef!: HTMLFormElement;
  let dialogRef!: HTMLDivElement;
  let active = true;
  onCleanup(() => (active = false));
  const close = () => {
    if (!loading()) {
      setError("");
      props.onClose();
    }
  };

  createEffect(() => {
    if (!props.open) {
      setError("");
      return;
    }
    setError("");
    const previous = document.activeElement;
    let open = true;
    const focusable = () =>
      Array.from(
        dialogRef.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), [href], [tabindex="0"]',
        ),
      );
    queueMicrotask(() => {
      if (open) focusable()[0]?.focus();
    });
    const handleKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === "Tab") {
        const fields = focusable();
        const first = fields[0];
        const last = fields[fields.length - 1];
        if (
          !dialogRef.contains(document.activeElement) ||
          (event.shiftKey && document.activeElement === first)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey, true);
    onCleanup(() => {
      open = false;
      document.removeEventListener("keydown", handleKey, true);
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    });
  });

  const clearError = () => {
    if (error()) setError("");
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (loading()) return;
    setError("");
    setLoading(true);
    // Disabling the submitter must not leave keyboard focus behind the modal.
    queueMicrotask(() => {
      if (
        props.open && dialogRef.isConnected &&
        !dialogRef.contains(document.activeElement)
      ) {
        formRef.querySelector<HTMLInputElement>("input")?.focus();
      }
    });
    const fd = new FormData(formRef);
    const payload = {
      sessionId: fd.get("sessionId") as string,
      spaceId: fd.get("spaceId") as string,
      userId: fd.get("userId") as string,
    };
    try {
      await props.onCreate(payload);
      if (!active) return;
      formRef.reset();
      setError("");
      props.onClose();
    } catch (err) {
      if (active) {
        setError(
          t("createFailed", {
            message: err instanceof Error ? err.message : String(err),
          }),
        );
        queueMicrotask(() => {
          if (
            active && props.open && dialogRef.isConnected &&
            !dialogRef.contains(document.activeElement)
          ) {
            formRef.querySelector<HTMLInputElement>("input")?.focus();
          }
        });
      }
    } finally {
      if (active) setLoading(false);
    }
  };

  return (
    <Show when={props.open}>
      <div
        class="modal-overlay"
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div
          class="modal-content"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-title`}
          aria-busy={loading()}
        >
          <h2 id={`${id}-title`} class="modal-title">
            {t("createSandboxSession")}
          </h2>
          <form ref={formRef} onSubmit={handleSubmit}>
            <label for={`${id}-session`}>{t("sessionId")}</label>
            <input
              id={`${id}-session`}
              name="sessionId"
              readOnly={loading()}
              required
              placeholder={t("sessionIdPlaceholder")}
              onInput={clearError}
            />

            <label for={`${id}-space`}>{t("spaceId")}</label>
            <input
              id={`${id}-space`}
              name="spaceId"
              readOnly={loading()}
              required
              placeholder={t("spaceIdPlaceholder")}
              onInput={clearError}
            />

            <label for={`${id}-user`}>{t("userId")}</label>
            <input
              id={`${id}-user`}
              name="userId"
              readOnly={loading()}
              required
              placeholder={t("userIdPlaceholder")}
              onInput={clearError}
            />

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
                disabled={loading()}
                onClick={close}
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                disabled={loading()}
              >
                {loading() ? t("creating") : t("create")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
}
