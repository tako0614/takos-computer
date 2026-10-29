import { createResource, createSignal, onCleanup, Show } from "solid-js";
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

  const [sandboxData] = createResource(
    () => version(),
    () => sandboxSessions.list().catch(() => null),
  );

  const timer = setInterval(reload, 10_000);
  onCleanup(() => clearInterval(timer));

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
        <SessionTable
          sessions={sandboxData()?.sessions ?? []}
          loading={sandboxData.loading}
          onDestroy={destroySandbox}
        />
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
