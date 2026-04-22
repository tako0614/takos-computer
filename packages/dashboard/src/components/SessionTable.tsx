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
}) {
  const { t } = useI18n();

  const timeAgo = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return t("justNow");
    if (m < 60) return t("timeAgoMinutes", { count: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t("timeAgoHours", { count: h });
    return t("timeAgoDays", { count: Math.floor(h / 24) });
  };

  return (
    <div class="card">
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
              fallback={<Placeholder text={t("noSessions")} />}
            >
              <For each={props.sessions}>
                {(s) => (
                  <tr>
                    <td class="mono" style="font-size:0.8125rem">
                      {s.sessionId}
                    </td>
                    <td>
                      <span class={badgeClass(s.status)}>
                        {t(statusKey(s.status))}
                      </span>
                    </td>
                    <td style="font-size:0.8125rem; color:#94a3b8">
                      {s.spaceId}
                    </td>
                    <td style="font-size:0.8125rem; color:#94a3b8">
                      {timeAgo(s.createdAt)}
                    </td>
                    <td>
                      <div class="flex gap-1">
                        <A
                          href={`/sandbox/${encodeURIComponent(s.sessionId)}`}
                          class="btn btn-primary btn-sm"
                        >
                          {t("open")}
                        </A>
                        <button
                          type="button"
                          class="btn btn-danger btn-sm"
                          onClick={() => props.onDestroy(s.sessionId)}
                        >
                          {t("delete")}
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
  );
}

function Placeholder(props: { text: string }) {
  return (
    <tr>
      <td colspan="5" style="text-align:center; color:#64748b; padding:2rem">
        {props.text}
      </td>
    </tr>
  );
}
