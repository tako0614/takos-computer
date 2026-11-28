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
import {
  countSessionsByStatus,
  filterSessions,
  type SessionStatusFilter,
} from "../lib/session-filter.ts";
import SessionTable from "../components/SessionTable.tsx";
import CreateModal from "../components/CreateModal.tsx";
import ConfirmDialog from "../components/ConfirmDialog.tsx";
import LanguageSwitcher from "../components/LanguageSwitcher.tsx";
import ThemeSwitcher from "../components/ThemeSwitcher.tsx";
import { type TranslationKey, useI18n } from "../i18n.ts";

const STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: SessionStatusFilter;
  labelKey: TranslationKey;
}> = [
  { value: "all", labelKey: "statusAll" },
  { value: "active", labelKey: "statusActive" },
  { value: "starting", labelKey: "statusStarting" },
  { value: "stopped", labelKey: "statusStopped" },
];

export default function Dashboard() {
  const { language, t } = useI18n();
  const [modalOpen, setModalOpen] = createSignal(false);
  const [version, setVersion] = createSignal(0);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal<SessionStatusFilter>(
    "all",
  );
  const [autoRefreshPaused, setAutoRefreshPaused] = createSignal(false);
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
  let searchComposing = false;
  const statusChipRefs: Partial<
    Record<SessionStatusFilter, HTMLButtonElement>
  > = {};
  let active = true;
  let listRequest = 0;
  let focusAfterRefresh:
    | {
        request: number;
        original: HTMLAnchorElement;
        kind: "link";
        href: string;
      }
    | {
        request: number;
        original: HTMLButtonElement;
        kind: "button";
        deleteSessionId: string | null;
      }
    | null = null;

  createEffect(() => {
    document.title = t("appTitle");
  });

  // Keep search input DOM value in sync without interrupting CJK IME composition.
  createEffect(() => {
    const next = searchQuery();
    if (!searchComposing && searchInput && searchInput.value !== next) {
      searchInput.value = next;
    }
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
          if (href) {
            focusAfterRefresh = { request, original, kind: "link", href };
          }
        } else if (
          original instanceof HTMLButtonElement && original.closest("tbody")
        ) {
          focusAfterRefresh = {
            request,
            original,
            kind: "button",
            deleteSessionId: original.dataset.sessionDelete ?? null,
          };
        }
      }
      return result;
    },
  );

  const allSessions = createMemo(() => sandboxData()?.sessions ?? []);
  const statusCounts = createMemo(() => countSessionsByStatus(allSessions()));
  const filteredSessions = createMemo(() =>
    filterSessions(allSessions(), searchQuery(), statusFilter())
  );
  const isFiltering = createMemo(() =>
    searchQuery().trim().length > 0 || statusFilter() !== "all"
  );
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
      let target: HTMLElement | undefined;
      if (focus.kind === "link") {
        target = Array.from(
          document.querySelectorAll<HTMLAnchorElement>("tbody a"),
        ).find((link) => link.getAttribute("href") === focus.href);
      } else if (focus.deleteSessionId !== null) {
        target = Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            "tbody button[data-session-delete]",
          ),
        ).find((btn) => btn.dataset.sessionDelete === focus.deleteSessionId);
      }
      (target ?? refreshButton).focus();
    });
  });

  const timer = setInterval(() => {
    if (!autoRefreshPaused()) reload();
  }, 10_000);
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
    setPendingDestroyId(null);
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
    }
  };

  const clearSearch = () => {
    searchComposing = false;
    setSearchQuery("");
    searchInput?.focus();
  };

  const clearAllFilters = () => {
    searchComposing = false;
    setSearchQuery("");
    setStatusFilter("all");
    queueMicrotask(() => {
      if (active && searchInput?.isConnected) {
        searchInput.focus();
      } else if (active && refreshButton?.isConnected) {
        refreshButton.focus();
      }
    });
  };

  const onStatusChipKeyDown = (
    event: KeyboardEvent,
    currentIndex: number,
  ) => {
    if (event.isComposing || event.keyCode === 229) return;
    const total = STATUS_FILTER_OPTIONS.length;
    let nextIndex = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % total;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + total) % total;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = total - 1;
    }
    if (nextIndex === -1) return;
    event.preventDefault();
    const nextOption = STATUS_FILTER_OPTIONS[nextIndex]!;
    setStatusFilter(nextOption.value);
    statusChipRefs[nextOption.value]?.focus();
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
              <div class="session-toolbar-top">
                <div class="session-search-wrap">
                  <input
                    ref={(el) => {
                      searchInput = el;
                      el.value = searchQuery();
                    }}
                    type="search"
                    class="input session-search-input"
                    aria-label={t("searchSessions")}
                    placeholder={t("searchSessionsPlaceholder")}
                    onCompositionStart={() => {
                      searchComposing = true;
                    }}
                    onCompositionEnd={(e) => {
                      searchComposing = false;
                      setSearchQuery(e.currentTarget.value);
                    }}
                    onInput={(e) => {
                      if (!e.isComposing && !searchComposing) {
                        setSearchQuery(e.currentTarget.value);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.isComposing || e.keyCode === 229) return;
                      if (e.key === "Escape" && searchQuery()) {
                        e.preventDefault();
                        searchComposing = false;
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
              <div
                class="status-filter-group"
                role="radiogroup"
                aria-label={t("filterByStatus")}
              >
                <For each={STATUS_FILTER_OPTIONS}>
                  {(option, index) => {
                    const selected = () => statusFilter() === option.value;
                    const count = () => statusCounts()[option.value];
                    return (
                      <button
                        ref={(el) => {
                          statusChipRefs[option.value] = el;
                        }}
                        type="button"
                        role="radio"
                        class="filter-chip"
                        classList={{ active: selected() }}
                        aria-checked={selected()}
                        tabIndex={selected() ? 0 : -1}
                        onClick={() => setStatusFilter(option.value)}
                        onKeyDown={(e) => onStatusChipKeyDown(e, index())}
                      >
                        <span>{t(option.labelKey)}</span>
                        <span class="filter-chip-count mono">{count()}</span>
                      </button>
                    );
                  }}
                </For>
              </div>
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
              onClearFilter={clearAllFilters}
              onCreate={() => setModalOpen(true)}
              onDestroy={requestDestroySandbox}
              destroyPending={(id) => destroyRequests().has(id)}
            />
          </div>
        </Show>

        <div class="muted footer-note">
          <div class="footer-note-info">
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
            <span role="status" aria-live="polite">
              {autoRefreshPaused() ? t("autoRefreshPaused") : t("autoRefresh")}
            </span>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-sm footer-refresh-toggle"
            onClick={() => setAutoRefreshPaused((paused) => !paused)}
          >
            {autoRefreshPaused()
              ? t("resumeAutoRefresh")
              : t("pauseAutoRefresh")}
          </button>
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
        tone="danger"
        onCancel={() => setPendingDestroyId(null)}
        onConfirm={confirmDestroySandbox}
      />
    </div>
  );
}
