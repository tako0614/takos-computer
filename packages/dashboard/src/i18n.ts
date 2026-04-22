import { createSignal } from "solid-js";

export type Language = "ja" | "en";
export type TranslationParams = Record<string, string | number>;

const STORAGE_KEY = "takos-lang";

const en = {
  actions: "Actions",
  active: "active",
  autoRefresh: "Auto-refresh: every 10s",
  backToDashboard: "Dashboard",
  cancel: "Cancel",
  commandPlaceholder: "command...",
  create: "Create",
  createFailed: "Create failed: {message}",
  createSandboxSession: "Create Sandbox Session",
  creating: "Creating...",
  created: "Created",
  delete: "Delete",
  destroy: "Destroy",
  destroyCurrentConfirm: "Destroy this sandbox session?",
  destroySessionConfirm: 'Destroy sandbox session "{id}"?',
  emptyDirectory: "Empty directory",
  error: "Error: {message}",
  files: "Files",
  justNow: "just now",
  language: "Language",
  loading: "loading",
  loadingEllipsis: "Loading...",
  noProcesses: "No processes",
  noSessions: "No sessions",
  open: "Open",
  processes: "Processes",
  refresh: "Refresh",
  sandbox: "Sandbox:",
  sandboxSession: "+ Sandbox Session",
  sessionId: "Session ID",
  space: "Space",
  spaceId: "Space ID",
  status: "Status",
  starting: "starting",
  stopped: "stopped",
  timeAgoDays: "{count}d ago",
  timeAgoHours: "{count}h ago",
  timeAgoMinutes: "{count}m ago",
  timedOut: "(timed out)",
  typeCommandHint: "Type a command and press Enter.\n",
  userId: "User ID",
} as const;

type TranslationKey = keyof typeof en;

const ja: Record<TranslationKey, string> = {
  actions: "操作",
  active: "稼働中",
  autoRefresh: "自動更新: 10 秒ごと",
  backToDashboard: "ダッシュボード",
  cancel: "キャンセル",
  commandPlaceholder: "コマンド...",
  create: "作成",
  createFailed: "作成に失敗しました: {message}",
  createSandboxSession: "サンドボックスセッションを作成",
  creating: "作成中...",
  created: "作成日時",
  delete: "削除",
  destroy: "破棄",
  destroyCurrentConfirm: "このサンドボックスセッションを破棄しますか？",
  destroySessionConfirm: 'サンドボックスセッション "{id}" を破棄しますか？',
  emptyDirectory: "空のディレクトリ",
  error: "エラー: {message}",
  files: "ファイル",
  justNow: "たった今",
  language: "言語",
  loading: "読み込み中",
  loadingEllipsis: "読み込み中...",
  noProcesses: "プロセスはありません",
  noSessions: "セッションはありません",
  open: "開く",
  processes: "プロセス",
  refresh: "更新",
  sandbox: "サンドボックス:",
  sandboxSession: "+ サンドボックスセッション",
  sessionId: "セッション ID",
  space: "スペース",
  spaceId: "スペース ID",
  status: "状態",
  starting: "起動中",
  stopped: "停止中",
  timeAgoDays: "{count} 日前",
  timeAgoHours: "{count} 時間前",
  timeAgoMinutes: "{count} 分前",
  timedOut: "(タイムアウト)",
  typeCommandHint: "コマンドを入力して Enter を押してください。\n",
  userId: "ユーザー ID",
};

const translations: Record<Language, Record<TranslationKey, string>> = {
  en,
  ja,
};

function detectInitialLanguage(): Language {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored === "ja" || stored === "en") return stored;
  } catch {
    // Ignore storage access failures and fall back to browser language.
  }

  const browserLang = globalThis.navigator?.language?.toLowerCase() ?? "";
  return browserLang.startsWith("ja") ? "ja" : "en";
}

const [language, setLanguageSignal] = createSignal<Language>(
  detectInitialLanguage(),
);

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

export function setLanguage(lang: Language): void {
  setLanguageSignal(lang);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, lang);
  } catch {
    // Ignore storage access failures.
  }
  if (globalThis.document?.documentElement) {
    globalThis.document.documentElement.lang = lang;
  }
}

export function t(
  key: TranslationKey,
  params?: TranslationParams,
): string {
  const lang = language();
  return interpolate(translations[lang][key] ?? translations.en[key], params);
}

export function useI18n() {
  return {
    language,
    setLanguage,
    t,
  };
}

setLanguage(language());
