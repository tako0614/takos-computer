import { createSignal } from "solid-js";

export type Language = "ja" | "en";
export type TranslationParams = Record<string, string | number>;

const STORAGE_KEY = "takos-lang";

const en = {
  actions: "Actions",
  active: "active",
  appTitle: "Takos Computer",
  autoRefresh: "Auto-refresh: every 10s",
  backToDashboard: "Dashboard",
  cancel: "Cancel",
  clear: "Clear",
  clearOutput: "Clear shell output",
  commandPlaceholder: "command...",
  create: "Create",
  createFailed: "Create failed: {message}",
  createSandboxSession: "Create Sandbox Session",
  creating: "Creating...",
  created: "Created",
  delete: "Delete",
  deleteSessionAria: "Delete session {id}",
  destroy: "Destroy",
  destroying: "Destroying…",
  destroyCurrentConfirm: "Destroy this sandbox session?",
  destroySessionConfirm: 'Destroy sandbox session "{id}"?',
  directoryPath: "Directory path",
  emptyDirectory: "Empty directory",
  error: "Error: {message}",
  files: "Files",
  justNow: "just now",
  language: "Language",
  loading: "loading",
  loadingEllipsis: "Loading...",
  noProcesses: "No processes",
  noSessions: "No sessions yet",
  noSessionsHint: "Create a sandbox session to open a shell and workspace.",
  open: "Open",
  openSessionAria: "Open session {id}",
  parentDirectory: "Parent directory",
  processes: "Processes",
  refresh: "Refresh",
  refreshSessions: "Refresh sessions",
  refreshStatus: "Refresh status",
  refreshingSessions: "Refreshing sessions…",
  retry: "Retry",
  root: "Root",
  run: "Run",
  running: "Running…",
  sandbox: "Sandbox:",
  sandboxSession: "+ Sandbox Session",
  sessionId: "Session ID",
  sessionIdPlaceholder: "e.g. my-session-01",
  sessionListUnavailable:
    "Session list unavailable. Refresh sessions to try again.",
  shell: "Shell",
  shellCommandInput: "Shell command",
  shellOutput: "Shell output",
  skipToContent: "Skip to content",
  space: "Space",
  spaceId: "Space ID",
  spaceIdPlaceholder: "e.g. space-abc",
  status: "Status",
  statusUnavailable: "Status unavailable",
  starting: "starting",
  stopped: "stopped",
  timeAgoDays: "{count}d ago",
  timeAgoHours: "{count}h ago",
  timeAgoMinutes: "{count}m ago",
  timedOut: "(timed out)",
  typeCommandHint: "Type a command and press Enter.\n",
  unconfirmedDestroyCurrent:
    "Could not confirm destruction. Refresh status to check.",
  unconfirmedDestroySession:
    "Could not confirm deletion of session {id}. Refresh sessions to check.",
  up: "Up",
  userId: "User ID",
  userIdPlaceholder: "e.g. user-123",
  workspaceRoot: "Workspace root",
} as const;

export type TranslationKey = keyof typeof en;

const ja: Record<TranslationKey, string> = {
  actions: "操作",
  active: "稼働中",
  appTitle: "Takos Computer",
  autoRefresh: "自動更新: 10 秒ごと",
  backToDashboard: "ダッシュボード",
  cancel: "キャンセル",
  clear: "クリア",
  clearOutput: "シェルの出力をクリア",
  commandPlaceholder: "コマンド...",
  create: "作成",
  createFailed: "作成に失敗しました: {message}",
  createSandboxSession: "サンドボックスセッションを作成",
  creating: "作成中...",
  created: "作成日時",
  delete: "削除",
  deleteSessionAria: "セッション {id} を削除",
  destroy: "破棄",
  destroying: "破棄中…",
  destroyCurrentConfirm: "このサンドボックスセッションを破棄しますか？",
  destroySessionConfirm: 'サンドボックスセッション "{id}" を破棄しますか？',
  directoryPath: "フォルダのパス",
  emptyDirectory: "空のディレクトリ",
  error: "エラー: {message}",
  files: "ファイル",
  justNow: "たった今",
  language: "言語",
  loading: "読み込み中",
  loadingEllipsis: "読み込み中...",
  noProcesses: "プロセスはありません",
  noSessions: "セッションはまだありません",
  noSessionsHint:
    "サンドボックスセッションを作成するとシェルと作業フォルダを開けます。",
  open: "開く",
  openSessionAria: "セッション {id} を開く",
  parentDirectory: "親フォルダへ",
  processes: "プロセス",
  refresh: "更新",
  refreshSessions: "一覧を更新",
  refreshStatus: "状態を更新",
  refreshingSessions: "一覧を更新中…",
  retry: "再試行",
  root: "ルート",
  run: "実行",
  running: "実行中…",
  sandbox: "サンドボックス:",
  sandboxSession: "+ サンドボックスセッション",
  sessionId: "セッション ID",
  sessionIdPlaceholder: "例: my-session-01",
  sessionListUnavailable:
    "セッション一覧を取得できません。一覧を更新してください。",
  shell: "シェル",
  shellCommandInput: "シェルコマンド",
  shellOutput: "シェルの出力",
  skipToContent: "本文へスキップ",
  space: "スペース",
  spaceId: "スペース ID",
  spaceIdPlaceholder: "例: space-abc",
  status: "状態",
  statusUnavailable: "状態を取得できません",
  starting: "起動中",
  stopped: "停止中",
  timeAgoDays: "{count} 日前",
  timeAgoHours: "{count} 時間前",
  timeAgoMinutes: "{count} 分前",
  timedOut: "(タイムアウト)",
  typeCommandHint: "コマンドを入力して Enter を押してください。\n",
  unconfirmedDestroyCurrent:
    "破棄結果を確認できません。状態を更新して確認してください。",
  unconfirmedDestroySession:
    "セッション {id} の削除結果を確認できません。一覧を更新して確認してください。",
  up: "上へ",
  userId: "ユーザー ID",
  userIdPlaceholder: "例: user-123",
  workspaceRoot: "作業フォルダのルートへ",
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
