export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not(:disabled)",
  "input:not(:disabled):not([type='hidden'])",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "details > summary:first-of-type",
  "[tabindex]:not([tabindex='-1']):not(:disabled)",
].join(", ");

interface DialogEntry {
  id: symbol;
  container: HTMLElement;
  restorePreviousInert: (() => void) | null;
}

const dialogStack: DialogEntry[] = [];
let savedBodyOverflow: string | null = null;
let savedAppInert: boolean | null = null;
let inertAppRoot: HTMLElement | null = null;

function isElementVisible(el: HTMLElement): boolean {
  if (el.closest("[inert], [hidden], details:not([open]) > :not(summary)")) {
    return false;
  }
  const view = el.ownerDocument?.defaultView;
  if (view?.getComputedStyle) {
    const style = view.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") {
      return false;
    }
  }
  if (typeof el.getClientRects === "function") {
    return el.getClientRects().length > 0;
  }
  return true;
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(isElementVisible);
}

export function isTopDialog(id: symbol): boolean {
  return dialogStack.length > 0 &&
    dialogStack[dialogStack.length - 1]?.id === id;
}

export function getOpenDialogCount(): number {
  return dialogStack.length;
}

function lockBackground(container: HTMLElement): void {
  const doc = container.ownerDocument;
  if (!doc) return;
  if (dialogStack.length === 0) {
    if (doc.body) {
      savedBodyOverflow = doc.body.style.overflow;
      doc.body.style.overflow = "hidden";
    }
    const appRoot = doc.getElementById("app");
    if (appRoot && !appRoot.contains(container)) {
      savedAppInert = appRoot.inert;
      inertAppRoot = appRoot;
      appRoot.inert = true;
    }
  }
}

function unlockBackground(doc: Document | null): void {
  if (dialogStack.length > 0) return;
  if (doc?.body && savedBodyOverflow !== null) {
    doc.body.style.overflow = savedBodyOverflow;
  }
  savedBodyOverflow = null;
  if (inertAppRoot) {
    inertAppRoot.inert = savedAppInert ?? false;
  }
  inertAppRoot = null;
  savedAppInert = null;
}

export function restoreDialogFocus(
  previous: Element | null,
  doc: Document | null = globalThis.document ?? null,
): void {
  if (
    previous instanceof HTMLElement &&
    previous.isConnected &&
    !previous.hasAttribute("disabled") &&
    !previous.closest("[inert]")
  ) {
    previous.focus();
    return;
  }
  const main = doc?.getElementById("main");
  if (main instanceof HTMLElement && !main.closest("[inert]")) {
    main.focus();
  }
}

export interface DialogTrapOptions {
  container: HTMLElement;
  onEscape: () => void;
  getInitialFocus?: () => HTMLElement | null | undefined;
}

export function attachDialogTrap(options: DialogTrapOptions): () => void {
  const { container, onEscape, getInitialFocus } = options;
  const doc = container.ownerDocument;
  const id = Symbol("dialog");
  const previousFocus = doc?.activeElement ?? null;

  const previousTop = dialogStack[dialogStack.length - 1];
  let restorePreviousInert: (() => void) | null = null;
  if (previousTop && previousTop.container !== container) {
    const prevInert = previousTop.container.inert;
    previousTop.container.inert = true;
    restorePreviousInert = () => {
      previousTop.container.inert = prevInert;
    };
  }

  lockBackground(container);
  dialogStack.push({ id, container, restorePreviousInert });

  let open = true;
  queueMicrotask(() => {
    if (!open || !isTopDialog(id) || !container.isConnected) return;
    const explicit = getInitialFocus?.();
    if (
      explicit && container.contains(explicit) && isElementVisible(explicit)
    ) {
      explicit.focus();
      return;
    }
    const autofocus = container.querySelector<HTMLElement>("[autofocus]");
    if (
      autofocus && isElementVisible(autofocus) &&
      !autofocus.hasAttribute("disabled")
    ) {
      autofocus.focus();
      return;
    }
    const focusables = getFocusableElements(container);
    (focusables[0] ?? container).focus();
  });

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!open || !isTopDialog(id)) return;
    if (event.isComposing || event.keyCode === 229) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }

    if (event.key === "Tab") {
      const fields = getFocusableElements(container);
      if (fields.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = fields[0]!;
      const last = fields[fields.length - 1]!;
      const active = doc?.activeElement ?? null;

      if (event.shiftKey) {
        if (
          !active || !container.contains(active) || active === container ||
          active === first
        ) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (!active || !container.contains(active) || active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
  };

  doc?.addEventListener("keydown", handleKeyDown, true);

  return () => {
    if (!open) return;
    open = false;
    doc?.removeEventListener("keydown", handleKeyDown, true);
    const idx = dialogStack.findIndex((entry) => entry.id === id);
    if (idx !== -1) {
      const [removed] = dialogStack.splice(idx, 1);
      removed?.restorePreviousInert?.();
    }
    // Unlock background inert BEFORE restoring focus so the browser accepts focus().
    unlockBackground(doc);
    restoreDialogFocus(previousFocus, doc);
  };
}
