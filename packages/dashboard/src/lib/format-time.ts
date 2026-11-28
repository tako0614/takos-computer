import type { Language, TranslationKey, TranslationParams } from "../i18n.ts";

export type TranslateFn = (
  key: TranslationKey,
  params?: TranslationParams,
) => string;

export function formatRelativeTime(
  iso: string | null | undefined,
  t: TranslateFn,
  nowMs: number = Date.now(),
): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const diff = Math.max(0, nowMs - ms);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t("justNow");
  if (minutes < 60) return t("timeAgoMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("timeAgoHours", { count: hours });
  return t("timeAgoDays", { count: Math.floor(hours / 24) });
}

export function formatAbsoluteTime(
  iso: string | null | undefined,
  lang: Language,
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function formatClockTime(date: Date, lang: Language): string {
  try {
    return new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 19);
  }
}
