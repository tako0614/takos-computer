import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { sandboxSessions } from "../lib/api.ts";
import { formatClockTime } from "../lib/format-time.ts";
import { filterSessions } from "../lib/session-filter.ts";
import SessionTable from "../components/SessionTable.tsx";
import CreateModal from "../components/CreateModal.tsx";
import ConfirmDialog from "../components/ConfirmDialog.tsx";
import LanguageSwitcher from "../components/LanguageSwitcher.tsx";
import ThemeSwitcher from "../components/ThemeSwitcher.tsx";
import { useI18n } from "../i18n.ts";

export default function Dashboard() {
  const { language, t } = useI18n();
  const [modalOpen, setModalOpen] = createSignal(false);
  const [version, setVersion] = createSignal(0);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [lastUpdated, setLastUpdated] = createSignal<Date | null>(null);
  const [pendingDestroyId, setPendingDestroyId] = createSignal<string | null>(
    null,
  );
  const [destroyRequests, setDestroyRequests] = createSignal(
    new Map<string, object>(),
  );
  const [unconfirmedDestroys, setUnconfirmedDestroys] = createSignal(
    new Set<string>(),
  );

  const reload = () => setVersion((v) => v + 1);
  let refreshButton!: HTMLButtonElement;
  let searchInput: HTMLInputElement | undefined;
  let active = true;
  let listRequest = 0;
  let focusAfterRefresh: {
    request: number;
    original: HTMLAnchorElement;
    href: string;
  } | null = null;

  createEffect(() => {
    document.title = t("appTitle");
  });

  const [sandboxData] = createResource(
    () => version(),
    async () => {
      const request = ++listRequest;
      const result = await sandboxSessions.list().catch(() => null);
      if (active && request === listRequest) {
        if (result !== null) {
          setLastUpdated(new Date());
        }
        const original = document.activeElement;
        focusAfterRefresh = null;
        if (original instanceof HTMLAnchorElement && original.closest("tbody")) {
          const href = original.getAttribute("href");
          if (href) focusAfterRefresh = { request, original, href };
        }
      }
      return result;
    },
  );

  const allSessions = createMemo(() => sandboxData()?.sessions ?? []);
  const filteredSessions = createMemo(() =>
    filterSessions(allSessions(), searchQuery())
  );
  const isFiltering = createMemo(() => searchQuery().trim().length > 0);
  const countLabel = createMemo(() => {
    const total = allSessions().length;
    const shown = filteredSessions().length;
    if (isFiltering()) {
      return t("sessionMatchCount", { shown, total });
    }
    return total === 1
      ? t("sessionCountOne")
      : t("sessionCount", { count: total });
  });

  createEffect(() => {
    if (sandboxData.loading) return;
    const focus = focusAfterRefresh;
    focusAfterRefresh = null;
    if (!focus) return;
    queueMicrotask(() => {
      if (
        !active || focus.request !== listRequest || focus.original.isConnected ||
        document.activeElement !== document.body
      ) return;
      const link = Array.from(
        document.querySelectorAll<HTMLAnchorElement>("tbody a"),
      ).find((link) => link.getAttribute("href") === focus.href);
      (link ?? refreshButton).focus();
    });
  });

  const timer = setInterval(reload, 10_000);
  onCleanup(() => {
    active = false;
    clearInterval(timer);
  });

  const requestDestroySandbox = (id: string) => {
    if (destroyRequests().has(id)) return;
    setPendingDestroyId(id);
  };

  const confirmDestroySandbox = async () => {
    const id = pendingDestroyId();
    if (!id || destroyRequests().has(id)) return;
    const request = {};
    setDestroyRequests((previous) => new Map(previous).set(id, request));
    setUnconfirmedDestroys((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    const current = () => active && destroyRequests().get(id) === request;
    try {
      await sandboxSessions.destroy(id);
      if (current()) reload();
    } catch {
      if (current()) {
        setUnconfirmedDestroys((previous) => new Set(previous).add(id));
      }
    } finally {
      if (current()) {
        setDestroyRequests((previous) => {
          const next = new Map(previous);
          next.delete(id);
          return next;
        });
      }
      if (active && pendingDestroyId() === id) {
        setPendingDestroyId(null);
      }
    }
  };

  const clearSearch = () => {
    setSearchQuery("");
    searchInput?.focus();
  };

  const pendingDestroyBusy = () => {
    const id = pendingDestroyId();
    return id !== null && destroyRequests().has(id);
  };

  return (
    <div class="container">
      <header class="page-header">
        <h1 class="page-title">takos computer</h1>
        <div class="header-controls">
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <div class="page-actions">
          <button
            ref={refreshButton}
            type="button"
            class="btn btn-ghost"
            aria-disabled={sandboxData.loading}
            onClick={() => {
              if (!sandboxData.loading) reload();
            }}
          >
            {t("refreshSessions")}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            onClick={() => setModalOpen(true)}
          >
            {t("sandboxSession")}
          </button>
        </div>

        <For each={[...unconfirmedDestroys()]}>
          {(id) => (
            <div role="alert" class="alert-banner alert-banner-row">
              <span>{t("unconfirmedDestroySession", { id })}</span>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                onClick={(e) => {
                  const hadFocus = document.activeElement === e.currentTarget;
                  setUnconfirmedDestroys((previous) => {
                    const next = new Set(previous);
                    next.delete(id);
                    return next;
                  });
                  if (hadFocus) {
                    queueMicrotask(() => {
                      if (
                        active &&
                        document.activeElement === document.body &&
                        refreshButton?.isConnected
                      ) {
                        refreshButton.focus();
                      }
                    });
                  }
                }}
              >
                {t("dismiss")}
              </button>
            </div>
          )}
        </For>

        <Show
          when={sandboxData() !== null || sandboxData.loading}
          fallback={
            <div class="card panel-error" role="alert">
              <span>{t("sessionListUnavailable")}</span>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                onClick={reload}
              >
                {t("retry")}
              </button>
            </div>
          }
        >
          <Show
            when={sandboxData() !== null &&
              (allSessions().length > 0 || isFiltering())}
          >
            <div class="session-toolbar">
              <div class="session-search-wrap">
                <input
                  ref={(el) => {
                    searchInput = el;
                  }}
                  type="search"
                  class="input session-search-input"
                  aria-label={t("searchSessions")}
                  placeholder={t("searchSessionsPlaceholder")}
                  value={searchQuery()}
                  onInput={(e) => setSearchQuery(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.isComposing || e.keyCode === 229) return;
                    if (e.key === "Escape" && searchQuery()) {
                      e.preventDefault();
                      setSearchQuery("");
                    }
                  }}
                />
                <Show when={searchQuery().length > 0}>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm session-search-clear"
                    aria-label={t("clearSearch")}
                    onClick={clearSearch}
                  >
                    {t("clear")}
                  </button>
                </Show>
              </div>
              <span
                class="muted session-count"
                role="status"
                aria-live="polite"
              >
                {countLabel()}
              </span>
            </div>
          </Show>

          <div aria-busy={sandboxData.loading}>
            <Show when={sandboxData.loading && sandboxData.latest}>
              <div role="status" class="muted status-note">
                {t("refreshingSessions")}
              </div>
            </Show>
            <SessionTable
              sessions={filteredSessions()}
              loading={sandboxData.loading && !sandboxData.latest}
              filtered={isFiltering()}
              onClearFilter={clearSearch}
              onCreate={() => setModalOpen(true)}
              onDestroy={requestDestroySandbox}
              destroyPending={(id) => destroyRequests().has(id)}
            />
          </div>
        </Show>

        <div class="muted footer-note">
          <Show when={lastUpdated()}>
            {(date) => (
              <>
                <span>
                  {t("lastUpdated", {
                    time: formatClockTime(date(), language()),
                  })}
                </span>
                <span aria-hidden="true"> &middot; </span>
              </>
            )}
          </Show>
          <span>{t("autoRefresh")}</span>
        </div>
      </main>

      <CreateModal
        open={modalOpen()}
        onClose={() => setModalOpen(false)}
        onCreate={async (p) => {
          await sandboxSessions.create(p);
          reload();
        }}
      />

      <ConfirmDialog
        open={pendingDestroyId() !== null}
        title={t("destroySessionTitle")}
        description={pendingDestroyId()
          ? t("destroySessionConfirm", { id: pendingDestroyId()! })
          : ""}
        detail={pendingDestroyId() ?? undefined}
        confirmLabel={t("destroy")}
        confirmBusyLabel={t("destroying")}
        tone="danger"
        busy={pendingDestroyBusy()}
        onCancel={() => setPendingDestroyId(null)}
        onConfirm={confirmDestroySandbox}
      />
    </div>
  );
}
