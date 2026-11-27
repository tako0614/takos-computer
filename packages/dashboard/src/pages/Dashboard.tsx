import {
  createEffect,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { sandboxSessions } from "../lib/api.ts";
import SessionTable from "../components/SessionTable.tsx";
import CreateModal from "../components/CreateModal.tsx";
import LanguageSwitcher from "../components/LanguageSwitcher.tsx";
import { useI18n } from "../i18n.ts";

export default function Dashboard() {
  const { t } = useI18n();
  const [modalOpen, setModalOpen] = createSignal(false);
  const [version, setVersion] = createSignal(0);
  const [destroyRequests, setDestroyRequests] = createSignal(
    new Map<string, object>(),
  );
  const [unconfirmedDestroys, setUnconfirmedDestroys] = createSignal(
    new Set<string>(),
  );

  const reload = () => setVersion((v) => v + 1);
  let refreshButton!: HTMLButtonElement;
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

  const destroySandbox = async (id: string) => {
    if (
      destroyRequests().has(id) ||
      !confirm(t("destroySessionConfirm", { id }))
    ) return;
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

  return (
    <div class="container">
      <header class="page-header">
        <h1 class="page-title">takos computer</h1>
        <LanguageSwitcher />
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
            <div role="alert" class="alert-banner">
              {t("unconfirmedDestroySession", { id })}
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
          <div aria-busy={sandboxData.loading}>
            <Show when={sandboxData.loading && sandboxData.latest}>
              <div role="status" class="muted status-note">
                {t("refreshingSessions")}
              </div>
            </Show>
            <SessionTable
              sessions={sandboxData()?.sessions ?? []}
              loading={sandboxData.loading && !sandboxData.latest}
              onDestroy={destroySandbox}
              destroyPending={(id) => destroyRequests().has(id)}
            />
          </div>
        </Show>

        <div class="muted footer-note">
          {t("autoRefresh")}
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
    </div>
  );
}
