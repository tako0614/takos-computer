import { For, Show } from "solid-js";
import { A } from "@solidjs/router";
import type { SessionState } from "../lib/api.ts";
import { useI18n } from "../i18n.ts";

const badgeClass = (status: string) =>
  status === "active"
    ? "badge badge-active"
    : status === "starting"
    ? "badge badge-starting"
    : "badge badge-stopped";

const statusKey = (status: string): "active" | "starting" | "stopped" =>
  status === "active" || status === "starting" ? status : "stopped";

export default function SessionTable(props: {
  sessions: SessionState[];
  loading: boolean;
  onDestroy: (id: string) => void;
  destroyPending?: (id: string) => boolean;
}) {
  const { t } = useI18n();

  const timeAgo = (iso: string): string => {
    const ms = new Date(iso).getTime();
    if (Number.isNaN(ms)) return "";
    const diff = Math.max(0, Date.now() - ms);
    const m = Math.floor(diff / 60000);
    if (m < 1) return t("justNow");
    if (m < 60) return t("timeAgoMinutes", { count: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t("timeAgoHours", { count: h });
    return t("timeAgoDays", { count: Math.floor(h / 24) });
  };

  return (
    <div class="card">
      <div class="table-wrap">
        <table class="session-table">
          <thead>
            <tr>
              <th>{t("sessionId")}</th>
              <th>{t("status")}</th>
              <th>{t("space")}</th>
              <th>{t("created")}</th>
              <th>{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            <Show
              when={!props.loading}
              fallback={<Placeholder text={t("loadingEllipsis")} />}
            >
              <Show
                when={props.sessions.length > 0}
                fallback={
                  <Placeholder
                    text={t("noSessions")}
                    hint={t("noSessionsHint")}
                  />
                }
              >
                <For each={props.sessions}>
                  {(s) => (
                    <tr>
                      <td class="mono session-id-cell">
                        {s.sessionId}
                      </td>
                      <td data-label={t("status")}>
                        <span class={badgeClass(s.status)}>
                          {t(statusKey(s.status))}
                        </span>
                      </td>
                      <td class="session-meta-cell" data-label={t("space")}>
                        {s.spaceId}
                      </td>
                      <td class="session-meta-cell" data-label={t("created")}>
                        {timeAgo(s.createdAt)}
                      </td>
                      <td class="session-actions-cell">
                        <div class="session-actions">
                          <A
                            href={`/sandbox/${encodeURIComponent(s.sessionId)}`}
                            class="btn btn-primary btn-sm"
                          >
                            {t("open")}
                          </A>
                          <button
                            type="button"
                            class="btn btn-danger btn-sm"
                            aria-label={t("deleteSessionAria", {
                              id: s.sessionId,
                            })}
                            aria-disabled={props.destroyPending?.(s.sessionId) ??
                              false}
                            aria-busy={props.destroyPending?.(s.sessionId) ??
                              false}
                            onClick={() => props.onDestroy(s.sessionId)}
                          >
                            {props.destroyPending?.(s.sessionId)
                              ? t("loading")
                              : t("delete")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </For>
              </Show>
            </Show>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Placeholder(props: { text: string; hint?: string }) {
  return (
    <tr>
      <td colspan="5" class="session-empty">
        <div class="session-empty-title">{props.text}</div>
        <Show when={props.hint}>
          <div class="session-empty-hint">{props.hint}</div>
        </Show>
      </td>
    </tr>
  );
}
