import { createSignal, Show } from "solid-js";

export default function CreateModal(props: {
  open: boolean;
  onClose: () => void;
  onCreate: (
    payload: { sessionId: string; spaceId: string; userId: string },
  ) => Promise<void>;
}) {
  const [loading, setLoading] = createSignal(false);
  let formRef!: HTMLFormElement;

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
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
      alert("Create failed: " + (err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Show when={props.open}>
      <div
        class="modal-overlay"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        <div class="modal-content">
          <h2 style="font-size:1rem; font-weight:600; margin-bottom:1rem">
            Create Sandbox Session
          </h2>
          <form ref={formRef} onSubmit={handleSubmit}>
            <label>Session ID</label>
            <input name="sessionId" required placeholder="e.g. my-session-01" />

            <label>Space ID</label>
            <input name="spaceId" required placeholder="e.g. space-abc" />

            <label>User ID</label>
            <input name="userId" required placeholder="e.g. user-123" />

            <div
              class="flex gap-2"
              style="justify-content:flex-end; margin-top:0.5rem"
            >
              <button
                type="button"
                class="btn btn-ghost"
                onClick={props.onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                disabled={loading()}
              >
                {loading() ? "Creating..." : "Create"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
}
