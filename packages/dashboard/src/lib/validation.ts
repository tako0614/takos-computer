import type { CreateSessionPayload } from "./api.ts";
import type { TranslationKey, TranslationParams } from "../i18n.ts";

export const MAX_SESSION_ID_BYTES = 120;
export const RESERVED_SESSION_PREFIX = "pmcp-";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errorKey: TranslationKey; params?: TranslationParams };

export function validateCreateSessionInput(
  raw: CreateSessionPayload,
): ValidationResult<CreateSessionPayload> {
  const sessionId = raw.sessionId.trim();
  const spaceId = raw.spaceId.trim();
  const userId = raw.userId.trim();

  if (!sessionId || !spaceId || !userId) {
    return { ok: false, errorKey: "validationRequired" };
  }

  if (/[\u0000-\u001f\u007f]/.test(sessionId)) {
    return { ok: false, errorKey: "validationSessionIdInvalid" };
  }

  if (sessionId.startsWith(RESERVED_SESSION_PREFIX)) {
    return {
      ok: false,
      errorKey: "validationSessionIdReserved",
      params: { prefix: RESERVED_SESSION_PREFIX },
    };
  }

  const bytes = new TextEncoder().encode(sessionId).byteLength;
  if (bytes > MAX_SESSION_ID_BYTES) {
    return {
      ok: false,
      errorKey: "validationSessionIdTooLong",
      params: { max: MAX_SESSION_ID_BYTES },
    };
  }

  return {
    ok: true,
    value: { sessionId, spaceId, userId },
  };
}

export function validateNewFileName(
  raw: string,
): ValidationResult<{ relativePath: string; basename: string }> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, errorKey: "validationFileNameRequired" };
  }
  if (
    trimmed.startsWith("/") ||
    trimmed.endsWith("/") ||
    trimmed.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    return { ok: false, errorKey: "validationFileNameInvalid" };
  }
  const segments = trimmed.split("/");
  if (
    segments.some((segment) =>
      !segment || segment === "." || segment === ".."
    )
  ) {
    return { ok: false, errorKey: "validationFileNameInvalid" };
  }
  const basename = segments[segments.length - 1]!;
  return {
    ok: true,
    value: { relativePath: segments.join("/"), basename },
  };
}

export interface FileInfoShape {
  exists?: unknown;
  type?: unknown;
}

export type NewFileTargetCheck =
  | { ok: true }
  | { ok: false; errorKey: TranslationKey };

export function checkNewFileTargetInfo(
  info: FileInfoShape | null | undefined,
): NewFileTargetCheck {
  if (!info || typeof info.exists !== "boolean") {
    return { ok: false, errorKey: "fileExistsCheckFailed" };
  }
  if (!info.exists) {
    return { ok: true };
  }
  if (info.type === "directory") {
    return { ok: false, errorKey: "directoryAlreadyExists" };
  }
  return { ok: false, errorKey: "fileAlreadyExists" };
}

export interface ShellHistoryState {
  entries: string[];
  index: number;
  draft: string;
}

export function pushShellHistory(
  entries: readonly string[],
  command: string,
  limit = 100,
): string[] {
  if (!command) return [...entries];
  if (entries[0] === command) return [...entries];
  return [command, ...entries].slice(0, limit);
}

export function stepShellHistory(
  state: ShellHistoryState,
  direction: "up" | "down",
  currentInput: string,
): { nextIndex: number; nextDraft: string; nextInput: string; changed: boolean } {
  if (direction === "up") {
    if (state.entries.length === 0) {
      return {
        nextIndex: state.index,
        nextDraft: state.draft,
        nextInput: currentInput,
        changed: false,
      };
    }
    const savedDraft = state.index === -1 ? currentInput : state.draft;
    const nextIndex = Math.min(state.index + 1, state.entries.length - 1);
    return {
      nextIndex,
      nextDraft: savedDraft,
      nextInput: state.entries[nextIndex]!,
      changed: true,
    };
  }

  if (state.index === -1) {
    return {
      nextIndex: -1,
      nextDraft: state.draft,
      nextInput: currentInput,
      changed: false,
    };
  }

  if (state.index === 0) {
    return {
      nextIndex: -1,
      nextDraft: "",
      nextInput: state.draft,
      changed: true,
    };
  }

  const nextIndex = state.index - 1;
  return {
    nextIndex,
    nextDraft: state.draft,
    nextInput: state.entries[nextIndex]!,
    changed: true,
  };
}
