import { For, Show } from "solid-js";
import { A } from "@solidjs/router";
import type { SessionState } from "../lib/api.ts";
import { formatAbsoluteTime, formatRelativeTime } from "../lib/format-time.ts";
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
  filtered?: boolean;
  onClearFilter?: () => void;
  onCreate?: () => void;
  onDestroy: (id: string) => void;
  destroyPending?: (id: string) => boolean;
}) {
  const { language, t } = useI18n();

  return (
    <div class="card">
      <div class="table-wrap">
        <table class="session-table">
          <thead>
            <tr>
              <th>{t("sessionId")}</th>
              <th>{t("status")}</th>
              <th>{t("space")}</th>
              <th>{t("user")}</th>
              <th>{t("created")}</th>
              <th>{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            <Show
              when={!props.loading}
              fallback={<LoadingPlaceholder text={t("loadingEllipsis")} />}
            >
              <Show
                when={props.sessions.length > 0}
                fallback={
                  props.filtered
                    ? (
                      <Placeholder
                        text={t("noMatchingSessions")}
                        hint={t("noMatchingSessionsHint")}
                        actionLabel={t("clearFilter")}
                        actionVariant="ghost"
                        onAction={props.onClearFilter}
                      />
                    )
                    : (
                      <Placeholder
                        text={t("noSessions")}
                        hint={t("noSessionsHint")}
                        actionLabel={props.onCreate
                          ? t("createFirstSession")
                          : undefined}
                        actionVariant="primary"
                        onAction={props.onCreate}
                      />
                    )
                }
              >
                <For each={props.sessions}>
                  {(s) => {
                    const absolute = () =>
                      formatAbsoluteTime(s.createdAt, language());
                    return (
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
                          {s.spaceId || "\u2014"}
                        </td>
                        <td class="session-meta-cell" data-label={t("user")}>
                          {s.userId || "\u2014"}
                        </td>
                        <td
                          class="session-meta-cell session-created-cell"
                          data-label={t("created")}
                        >
                          <Show
                            when={s.createdAt}
                            fallback={<span>{"\u2014"}</span>}
                          >
                            <time
                              dateTime={s.createdAt}
                              title={absolute() || undefined}
                            >
                              {formatRelativeTime(s.createdAt, t) || "\u2014"}
                            </time>
                          </Show>
                        </td>
                        <td class="session-actions-cell">
                          <div class="session-actions">
                            <A
                              href={`/sandbox/${
                                encodeURIComponent(s.sessionId)
                              }`}
                              class="btn btn-primary btn-sm"
                            >
                              {t("open")}
                            </A>
                            <button
                              type="button"
                              class="btn btn-danger btn-sm"
                              data-session-delete={s.sessionId}
                              aria-label={t("deleteSessionAria", {
                                id: s.sessionId,
                              })}
                              aria-disabled={props.destroyPending?.(
                                s.sessionId,
                              ) ??
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
                    );
                  }}
                </For>
              </Show>
            </Show>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LoadingPlaceholder(props: { text: string }) {
  return (
    <tr>
      <td colspan="6" class="session-loading">
        <div class="skeleton-stack" aria-hidden="true">
          <div class="skeleton-line skeleton-line-lg" />
          <div class="skeleton-line skeleton-line-md" />
          <div class="skeleton-line skeleton-line-sm" />
        </div>
        <div class="muted session-loading-label" role="status">
          {props.text}
        </div>
      </td>
    </tr>
  );
}

function Placeholder(props: {
  text: string;
  hint?: string;
  actionLabel?: string;
  actionVariant?: "primary" | "ghost";
  onAction?: () => void;
}) {
  return (
    <tr>
      <td colspan="6" class="session-empty">
        <div class="session-empty-title">{props.text}</div>
        <Show when={props.hint}>
          <div class="session-empty-hint">{props.hint}</div>
        </Show>
        <Show when={props.actionLabel && props.onAction}>
          <div class="session-empty-action">
            <button
              type="button"
              class={`btn btn-sm ${
                props.actionVariant === "primary" ? "btn-primary" : "btn-ghost"
              }`}
              onClick={props.onAction}
            >
              {props.actionLabel}
            </button>
          </div>
        </Show>
      </td>
    </tr>
  );
}
