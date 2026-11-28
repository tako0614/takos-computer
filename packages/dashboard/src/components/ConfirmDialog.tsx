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

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  detail?: string;
  confirmLabel: string;
  confirmBusyLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  error?: string;
  restoreFocusFallback?: () => HTMLElement | null | undefined;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export default function ConfirmDialog(props: ConfirmDialogProps) {
  const { t } = useI18n();
  const id = createUniqueId();
  const [dialogEl, setDialogEl] = createSignal<HTMLDivElement | undefined>();
  let cancelRef: HTMLButtonElement | undefined;
  let confirmRef: HTMLButtonElement | undefined;

  const isDanger = () => (props.tone ?? "danger") === "danger";
  const close = () => {
    if (!props.busy) props.onCancel();
  };

  createEffect(() => {
    if (!props.open) {
      setDialogEl(undefined);
      return;
    }
    const el = dialogEl();
    if (!el) return;
    const detach = attachDialogTrap({
      container: el,
      onEscape: close,
      getInitialFocus: () => (isDanger() ? cancelRef : confirmRef),
      getRestoreFocusFallback: props.restoreFocusFallback,
    });
    onCleanup(detach);
  });

  // Disabling action buttons while busy must not drop focus onto document.body.
  createEffect(() => {
    const busy = Boolean(props.busy);
    const el = dialogEl();
    if (!props.open || !el) return;
    queueMicrotask(() => {
      if (!props.open || !el.isConnected) return;
      if (busy) {
        if (!el.contains(document.activeElement)) {
          el.focus();
        }
      } else if (
        document.activeElement === el || !el.contains(document.activeElement)
      ) {
        (isDanger() ? cancelRef : confirmRef)?.focus();
      }
    });
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="modal-overlay modal-overlay-top"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            ref={(el) => {
              setDialogEl(el);
            }}
            class="modal-content confirm-dialog"
            role={isDanger() ? "alertdialog" : "dialog"}
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-desc`}
            aria-busy={props.busy ?? false}
            tabIndex={-1}
          >
            <h2 id={`${id}-title`} class="modal-title">
              {props.title}
            </h2>
            <p id={`${id}-desc`} class="confirm-desc">
              {props.description}
            </p>
            <Show when={props.detail}>
              {(detail) => (
                <div class="confirm-detail mono" title={detail()}>
                  {detail()}
                </div>
              )}
            </Show>
            <Show when={props.error}>
              {(message) => (
                <div role="alert" class="alert-banner">
                  {message()}
                </div>
              )}
            </Show>
            <div class="modal-actions">
              <button
                ref={(el) => {
                  cancelRef = el;
                }}
                type="button"
                class="btn btn-ghost"
                disabled={props.busy}
                onClick={close}
              >
                {props.cancelLabel ?? t("cancel")}
              </button>
              <button
                ref={(el) => {
                  confirmRef = el;
                }}
                type="button"
                class={`btn ${isDanger() ? "btn-danger" : "btn-primary"}`}
                disabled={props.busy}
                aria-busy={props.busy ?? false}
                onClick={() => void props.onConfirm()}
              >
                {props.busy
                  ? (props.confirmBusyLabel ?? props.confirmLabel)
                  : props.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
