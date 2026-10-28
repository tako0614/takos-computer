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
  let formRef!: HTMLFormElement;
  let dialogRef!: HTMLDivElement;
  const close = () => {
    if (!loading()) props.onClose();
  };

  createEffect(() => {
    if (!props.open) return;
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
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    });
  });

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (loading()) return;
    setLoading(true);
    const fd = new FormData(formRef);
    const payload = {
      sessionId: fd.get("sessionId") as string,
      spaceId: fd.get("spaceId") as string,
      userId: fd.get("userId") as string,
    };
    try {
      await props.onCreate(payload);
      formRef.reset();
      props.onClose();
    } catch (err) {
      alert(
        t("createFailed", {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setLoading(false);
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
          <h2
            id={`${id}-title`}
            style="font-size:1rem; font-weight:600; margin-bottom:1rem"
          >
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
            />

            <label for={`${id}-space`}>{t("spaceId")}</label>
            <input
              id={`${id}-space`}
              name="spaceId"
              readOnly={loading()}
              required
              placeholder={t("spaceIdPlaceholder")}
            />

            <label for={`${id}-user`}>{t("userId")}</label>
            <input
              id={`${id}-user`}
              name="userId"
              readOnly={loading()}
              required
              placeholder={t("userIdPlaceholder")}
            />

            <div
              class="flex gap-2"
              style="justify-content:flex-end; margin-top:0.5rem"
            >
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
