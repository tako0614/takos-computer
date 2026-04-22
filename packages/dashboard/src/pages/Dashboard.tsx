import { createResource, createSignal, onCleanup } from "solid-js";
import { sandboxSessions } from "../lib/api.ts";
import SessionTable from "../components/SessionTable.tsx";
import CreateModal from "../components/CreateModal.tsx";

export default function Dashboard() {
  const [modalOpen, setModalOpen] = createSignal(false);
  const [version, setVersion] = createSignal(0);

  const reload = () => setVersion((v) => v + 1);

  const [sandboxData] = createResource(
    () => version(),
    () => sandboxSessions.list(),
  );

  const timer = setInterval(reload, 10_000);
  onCleanup(() => clearInterval(timer));

  const destroySandbox = async (id: string) => {
    if (!confirm(`Destroy sandbox session "${id}"?`)) return;
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
      </div>

      <div class="flex" style="justify-content:flex-end; margin-bottom:0.75rem">
        <button
          type="button"
          class="btn btn-primary"
          onClick={() => setModalOpen(true)}
        >
          + Sandbox Session
        </button>
      </div>

      <SessionTable
        sessions={sandboxData()?.sessions ?? []}
        loading={sandboxData.loading}
        onDestroy={destroySandbox}
      />

      <div style="margin-top:0.75rem; font-size:0.6875rem" class="muted">
        Auto-refresh: every 10s
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
