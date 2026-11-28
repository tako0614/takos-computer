import {
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { useI18n } from "../i18n.ts";
import { attachDialogTrap } from "../lib/dialog-a11y.ts";
import { validateCreateSessionInput } from "../lib/validation.ts";

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
  const [dialogEl, setDialogEl] = createSignal<HTMLDivElement | undefined>();
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [invalidFields, setInvalidFields] = createSignal<Set<string>>(
    new Set(),
  );
  let formRef!: HTMLFormElement;
  let active = true;
  onCleanup(() => (active = false));
  const close = () => {
    if (!loading()) {
      setError("");
      setInvalidFields(new Set<string>());
      props.onClose();
    }
  };

  createEffect(() => {
    if (!props.open) {
      setError("");
      setInvalidFields(new Set<string>());
      setDialogEl(undefined);
      return;
    }
    setError("");
    setInvalidFields(new Set<string>());
    const el = dialogEl();
    if (!el) return;
    const detach = attachDialogTrap({
      container: el,
      onEscape: close,
      getInitialFocus: () => el.querySelector<HTMLInputElement>("input"),
    });
    onCleanup(detach);
  });

  const clearError = (fieldName?: string) => {
    if (error()) setError("");
    if (fieldName && invalidFields().has(fieldName)) {
      setInvalidFields((prev) => {
        const next = new Set(prev);
        next.delete(fieldName);
        return next;
      });
    }
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (loading()) return;
    const fd = new FormData(formRef);
    const raw = {
      sessionId: String(fd.get("sessionId") ?? ""),
      spaceId: String(fd.get("spaceId") ?? ""),
      userId: String(fd.get("userId") ?? ""),
    };
    const validation = validateCreateSessionInput(raw);
    if (!validation.ok) {
      const nextInvalid = new Set<string>();
      if (validation.errorKey === "validationRequired") {
        if (!raw.sessionId.trim()) nextInvalid.add("sessionId");
        if (!raw.spaceId.trim()) nextInvalid.add("spaceId");
        if (!raw.userId.trim()) nextInvalid.add("userId");
      } else {
        nextInvalid.add("sessionId");
      }
      setInvalidFields(nextInvalid);
      setError(t(validation.errorKey, validation.params));
      const firstInvalid = [
        "sessionId",
        "spaceId",
        "userId",
      ].find((name) => nextInvalid.has(name));
      if (firstInvalid) {
        formRef.querySelector<HTMLInputElement>(`input[name="${firstInvalid}"]`)
          ?.focus();
      }
      return;
    }
    setError("");
    setInvalidFields(new Set<string>());
    setLoading(true);
    // Disabling the submitter must not leave keyboard focus behind the modal.
    queueMicrotask(() => {
      const el = dialogEl();
      if (
        props.open && el?.isConnected &&
        !el.contains(document.activeElement)
      ) {
        formRef.querySelector<HTMLInputElement>("input")?.focus();
      }
    });
    const payload = validation.value;
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
          const el = dialogEl();
          if (
            active && props.open && el?.isConnected &&
            !el.contains(document.activeElement)
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
      <Portal>
        <div
          class="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            class="modal-content"
            ref={(el) => {
              setDialogEl(el);
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            aria-busy={loading()}
            tabIndex={-1}
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
                aria-invalid={invalidFields().has("sessionId")
                  ? "true"
                  : undefined}
                aria-describedby={error() ? `${id}-error` : undefined}
                autocomplete="off"
                spellcheck={false}
                placeholder={t("sessionIdPlaceholder")}
                onInput={() => clearError("sessionId")}
              />

              <label for={`${id}-space`}>{t("spaceId")}</label>
              <input
                id={`${id}-space`}
                name="spaceId"
                readOnly={loading()}
                required
                aria-invalid={invalidFields().has("spaceId")
                  ? "true"
                  : undefined}
                aria-describedby={error() ? `${id}-error` : undefined}
                autocomplete="off"
                spellcheck={false}
                placeholder={t("spaceIdPlaceholder")}
                onInput={() => clearError("spaceId")}
              />

              <label for={`${id}-user`}>{t("userId")}</label>
              <input
                id={`${id}-user`}
                name="userId"
                readOnly={loading()}
                required
                aria-invalid={invalidFields().has("userId")
                  ? "true"
                  : undefined}
                aria-describedby={error() ? `${id}-error` : undefined}
                autocomplete="off"
                spellcheck={false}
                placeholder={t("userIdPlaceholder")}
                onInput={() => clearError("userId")}
              />

              <Show when={error()}>
                {(message) => (
                  <div id={`${id}-error`} class="alert-banner" role="alert">
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
      </Portal>
    </Show>
  );
}
