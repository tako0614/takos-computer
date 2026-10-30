import { createEffect, createResource, createSignal, onCleanup, Show } from "solid-js";
import { sandboxSessions } from "../lib/api.ts";
import SessionTable from "../components/SessionTable.tsx";
import CreateModal from "../components/CreateModal.tsx";
import LanguageSwitcher from "../components/LanguageSwitcher.tsx";
import { useI18n } from "../i18n.ts";

export default function Dashboard() {
  const { t, language } = useI18n();
  const [modalOpen, setModalOpen] = createSignal(false);
  const [version, setVersion] = createSignal(0);

  const reload = () => setVersion((v) => v + 1);
  let refreshButton!: HTMLButtonElement;
  let active = true;
  let listRequest = 0;
  let focusAfterRefresh: {
    request: number;
    original: HTMLAnchorElement;
    href: string;
  } | null = null;

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
      const link = Array.from(document.querySelectorAll<HTMLAnchorElement>(
        "tbody a",
      )).find((link) => link.getAttribute("href") === focus.href);
      (link ?? refreshButton).focus();
    });
  });

  const timer = setInterval(reload, 10_000);
  onCleanup(() => {
    active = false;
    clearInterval(timer);
  });

  const destroySandbox = async (id: string) => {
    if (!confirm(t("destroySessionConfirm", { id }))) return;
    await sandboxSessions.destroy(id);
    reload();
  };

  return (
    <div class="container">
      <div
        class="flex items-center justify-between"
        style="margin-bottom:1.5rem"
      >
        <h1 style="font-size:1.25rem; font-weight:600">takos computer</h1>
        <LanguageSwitcher />
      </div>

      <div
        class="flex gap-2"
        style="justify-content:flex-end; flex-wrap:wrap; margin-bottom:0.75rem"
      >
        <button
          ref={refreshButton}
          type="button"
          class="btn btn-ghost"
          aria-disabled={sandboxData.loading}
          style={{ opacity: sandboxData.loading ? 0.5 : 1 }}
          onClick={() => {
            if (!sandboxData.loading) reload();
          }}
        >
          {language() === "ja" ? "一覧を更新" : "Refresh sessions"}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          onClick={() => setModalOpen(true)}
        >
          {t("sandboxSession")}
        </button>
      </div>

      <Show
        when={sandboxData() !== null || sandboxData.loading}
        fallback={
          <div class="card" role="alert" style="padding:1rem; color:#fca5a5">
            {language() === "ja"
              ? "セッション一覧を取得できません。一覧を更新してください。"
              : "Session list unavailable. Refresh sessions to try again."}
          </div>
        }
      >
        <div aria-busy={sandboxData.loading}>
          <Show when={sandboxData.loading && sandboxData.latest}>
            <div role="status" class="muted" style="margin-bottom:0.5rem">
              {language() === "ja" ? "一覧を更新中…" : "Refreshing sessions…"}
            </div>
          </Show>
          <SessionTable
            sessions={sandboxData()?.sessions ?? []}
            loading={sandboxData.loading && !sandboxData.latest}
            onDestroy={destroySandbox}
          />
        </div>
      </Show>

      <div style="margin-top:0.75rem; font-size:0.6875rem" class="muted">
        {t("autoRefresh")}
      </div>

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
