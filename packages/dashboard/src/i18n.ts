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
  binaryFileNotice:
    "Binary file ({size}) cannot be edited in the text drawer.",
  cancel: "Cancel",
  clear: "Clear",
  clearFilter: "Clear filter",
  clearOutput: "Clear shell output",
  clearSearch: "Clear search",
  close: "Close",
  commandPlaceholder: "command...",
  confirm: "Confirm",
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
  destroySessionTitle: "Destroy sandbox session",
  directoryBreadcrumbs: "Directory breadcrumbs",
  directoryPath: "Directory path",
  discard: "Discard",
  discardChangesConfirm: "Your edits to {name} have not been saved yet.",
  discardChangesTitle: "Discard unsaved changes?",
  dismiss: "Dismiss",
  emptyDirectory: "Empty directory",
  error: "Error: {message}",
  fileContents: "File contents",
  fileSaved: "Saved ({bytes} B)",
  files: "Files",
  justNow: "just now",
  keepEditing: "Keep editing",
  language: "Language",
  linesCount: "{count} lines",
  loading: "loading",
  loadingEllipsis: "Loading...",
  noMatchingSessions: "No matching sessions",
  noMatchingSessionsHint:
    "Try a different filter or clear the search query.",
  noProcesses: "No processes",
  noSessions: "No sessions yet",
  noSessionsHint: "Create a sandbox session to open a shell and workspace.",
  open: "Open",
  openFileAria: "Open file {name}",
  parentDirectory: "Parent directory",
  processNotManaged: "Process is not managed by this shell session.",
  processStopped: "Stopped process PID {pid}.",
  processes: "Processes",
  readOnly: "Read-only",
  refresh: "Refresh",
  refreshSessions: "Refresh sessions",
  refreshStatus: "Refresh status",
  refreshingSessions: "Refreshing sessions…",
  reload: "Reload",
  retry: "Retry",
  root: "Root",
  run: "Run",
  running: "Running…",
  sandbox: "Sandbox:",
  sandboxSession: "+ Sandbox Session",
  save: "Save",
  saveFailed: "Save failed: {message}",
  saveShortcutHint: "Ctrl/Cmd+S to save",
  saving: "Saving…",
  searchSessions: "Search sessions",
  searchSessionsPlaceholder: "Filter by session, space, user, or status...",
  sessionCount: "{count} sessions",
  sessionCountOne: "1 session",
  sessionId: "Session ID",
  sessionIdPlaceholder: "e.g. my-session-01",
  sessionListUnavailable:
    "Session list unavailable. Refresh sessions to try again.",
  sessionMatchCount: "{shown} of {total} sessions",
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
  stop: "Stop",
  stopProcess: "Stop process",
  stopProcessAria: "Stop process {pid}: {command}",
  stopProcessConfirm: "Send SIGTERM to process PID {pid}?",
  stopProcessFailed: "Could not stop PID {pid}: {message}",
  stopProcessTitle: "Stop process",
  stopped: "stopped",
  stopping: "Stopping…",
  theme: "Theme",
  themeDark: "Dark",
  themeLight: "Light",
  themeSystem: "Auto",
  timeAgoDays: "{count}d ago",
  timeAgoHours: "{count}h ago",
  timeAgoMinutes: "{count}m ago",
  timedOut: "(timed out)",
  truncatedFileNotice:
    "Preview truncated at 256 KB (total {size}). Editing is disabled to avoid data loss.",
  typeCommandHint: "Type a command and press Enter.\n",
  unconfirmedDestroyCurrent:
    "Could not confirm destruction. Refresh status to check.",
  unconfirmedDestroySession:
    "Could not confirm deletion of session {id}. Refresh sessions to check.",
  unsavedChanges: "Unsaved",
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
  binaryFileNotice:
    "バイナリファイル ({size}) はテキストエディタで編集できません。",
  cancel: "キャンセル",
  clear: "クリア",
  clearFilter: "絞り込みを解除",
  clearOutput: "シェルの出力をクリア",
  clearSearch: "検索をクリア",
  close: "閉じる",
  commandPlaceholder: "コマンド...",
  confirm: "確認",
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
  destroySessionTitle: "サンドボックスセッションを破棄",
  directoryBreadcrumbs: "フォルダのパンくずリスト",
  directoryPath: "フォルダのパス",
  discard: "破棄",
  discardChangesConfirm: "{name} への変更はまだ保存されていません。",
  discardChangesTitle: "未保存の変更を破棄しますか？",
  dismiss: "閉じる",
  emptyDirectory: "空のディレクトリ",
  error: "エラー: {message}",
  fileContents: "ファイルの内容",
  fileSaved: "保存しました ({bytes} B)",
  files: "ファイル",
  justNow: "たった今",
  keepEditing: "編集を続ける",
  language: "言語",
  linesCount: "{count} 行",
  loading: "読み込み中",
  loadingEllipsis: "読み込み中...",
  noMatchingSessions: "一致するセッションはありません",
  noMatchingSessionsHint:
    "別のキーワードを試すか、絞り込みを解除してください。",
  noProcesses: "プロセスはありません",
  noSessions: "セッションはまだありません",
  noSessionsHint:
    "サンドボックスセッションを作成するとシェルと作業フォルダを開けます。",
  open: "開く",
  openFileAria: "ファイル {name} を開く",
  parentDirectory: "親フォルダへ",
  processNotManaged: "このシェルセッションで管理されていないプロセスです。",
  processStopped: "プロセス PID {pid} を停止しました。",
  processes: "プロセス",
  readOnly: "読み取り専用",
  refresh: "更新",
  refreshSessions: "一覧を更新",
  refreshStatus: "状態を更新",
  refreshingSessions: "一覧を更新中…",
  reload: "再読み込み",
  retry: "再試行",
  root: "ルート",
  run: "実行",
  running: "実行中…",
  sandbox: "サンドボックス:",
  sandboxSession: "+ サンドボックスセッション",
  save: "保存",
  saveFailed: "保存に失敗しました: {message}",
  saveShortcutHint: "Ctrl/Cmd+S で保存",
  saving: "保存中…",
  searchSessions: "セッションを検索",
  searchSessionsPlaceholder: "セッション・スペース・ユーザー・状態で絞り込み...",
  sessionCount: "{count} 件のセッション",
  sessionCountOne: "1 件のセッション",
  sessionId: "セッション ID",
  sessionIdPlaceholder: "例: my-session-01",
  sessionListUnavailable:
    "セッション一覧を取得できません。一覧を更新してください。",
  sessionMatchCount: "{total} 件中 {shown} 件を表示",
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
  stop: "停止",
  stopProcess: "プロセスを停止",
  stopProcessAria: "プロセス {pid} ({command}) を停止",
  stopProcessConfirm: "プロセス PID {pid} に SIGTERM を送信しますか？",
  stopProcessFailed: "PID {pid} を停止できませんでした: {message}",
  stopProcessTitle: "プロセスを停止",
  stopped: "停止中",
  stopping: "停止中…",
  theme: "テーマ",
  themeDark: "ダーク",
  themeLight: "ライト",
  themeSystem: "自動",
  timeAgoDays: "{count} 日前",
  timeAgoHours: "{count} 時間前",
  timeAgoMinutes: "{count} 分前",
  timedOut: "(タイムアウト)",
  truncatedFileNotice:
    "256 KB を超えるためプレビューを切り詰めています (合計 {size})。データ破損を防ぐため編集は無効です。",
  typeCommandHint: "コマンドを入力して Enter を押してください。\n",
  unconfirmedDestroyCurrent:
    "破棄結果を確認できません。状態を更新して確認してください。",
  unconfirmedDestroySession:
    "セッション {id} の削除結果を確認できません。一覧を更新して確認してください。",
  unsavedChanges: "未保存",
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
