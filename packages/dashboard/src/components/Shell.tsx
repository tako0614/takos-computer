import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { mcpCall } from "../lib/mcp.ts";
import { pushShellHistory, stepShellHistory } from "../lib/validation.ts";
import { useI18n } from "../i18n.ts";

type LineKind = "hint" | "cmd" | "out" | "err" | "warn" | "fatal";

interface ShellLine {
  text: string;
  kind: LineKind;
  initialHint?: boolean;
}

export default function Shell(props: { mcpUrl: string; cwd: () => string }) {
  const { t } = useI18n();
  const [lines, setLines] = createSignal<ShellLine[]>([
    { text: t("typeCommandHint"), kind: "hint", initialHint: true },
  ]);
  const [history, setHistory] = createSignal<string[]>([]);
  const [historyIdx, setHistoryIdx] = createSignal(-1);
  const [historyDraft, setHistoryDraft] = createSignal("");
  const [runningCount, setRunningCount] = createSignal(0);
  const [copyFeedback, setCopyFeedback] = createSignal<
    "copied" | "copyFailed" | null
  >(null);
  let inputRef!: HTMLInputElement;
  let outputRef!: HTMLDivElement;
  let alive = true;
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => {
    alive = false;
    if (copyTimer !== undefined) clearTimeout(copyTimer);
  });

  const hasOutput = createMemo(() =>
    lines().some((line) => !line.initialHint)
  );

  // Keep the initial hint localized even after commands have been executed.
  createEffect(() => {
    const hint = t("typeCommandHint");
    setLines((prev) => {
      const idx = prev.findIndex((line) => line.initialHint);
      if (idx === -1 || prev[idx]?.text === hint) return prev;
      const next = prev.slice();
      next[idx] = { text: hint, kind: "hint", initialHint: true };
      return next;
    });
  });

  const append = (text: string, kind: LineKind) => {
    if (!alive) return;
    setLines((prev) => [...prev, { text, kind }]);
    requestAnimationFrame(() => {
      if (alive && outputRef) outputRef.scrollTop = outputRef.scrollHeight;
    });
  };

  const clearOutput = () => {
    setLines([{ text: t("typeCommandHint"), kind: "hint", initialHint: true }]);
    setCopyFeedback(null);
    inputRef?.focus();
  };

  const copyOutput = async () => {
    const text = lines()
      .filter((line) => !line.initialHint)
      .map((line) => line.text)
      .join("");
    if (!text) return;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(text);
      if (!alive) return;
      setCopyFeedback("copied");
    } catch {
      if (!alive) return;
      setCopyFeedback("copyFailed");
    }
    if (copyTimer !== undefined) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      if (alive) setCopyFeedback(null);
    }, 2000);
  };

  const run = async () => {
    const cmd = inputRef.value.trim();
    if (!cmd) return;

    setHistory((h) => pushShellHistory(h, cmd, 100));
    setHistoryIdx(-1);
    setHistoryDraft("");
    inputRef.value = "";

    append(`$ ${cmd}\n`, "cmd");
    setRunningCount((c) => c + 1);

    try {
      const result = await mcpCall<{
        stdout: string;
        stderr: string;
        exit_code: number;
        timed_out: boolean;
      }>(props.mcpUrl, "shell_exec", {
        command: cmd,
        cwd: props.cwd(),
        timeout_ms: 30000,
      });
      if (!alive) return;
      if (result?.stdout) append(result.stdout, "out");
      if (result?.stderr) append(result.stderr, "err");
      if (result?.timed_out) append(`${t("timedOut")}\n`, "warn");
      else if (result && result.exit_code !== 0) {
        append(`exit ${result.exit_code}\n`, "hint");
      }
    } catch (err) {
      if (!alive) return;
      append(
        `${
          t("error", {
            message: err instanceof Error ? err.message : String(err),
          })
        }\n`,
        "fatal",
      );
    } finally {
      if (alive) setRunningCount((c) => Math.max(0, c - 1));
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      clearOutput();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void run();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const step = stepShellHistory(
        {
          entries: history(),
          index: historyIdx(),
          draft: historyDraft(),
        },
        e.key === "ArrowUp" ? "up" : "down",
        inputRef.value,
      );
      if (!step.changed) return;
      setHistoryIdx(step.nextIndex);
      setHistoryDraft(step.nextDraft);
      inputRef.value = step.nextInput;
    }
  };

  onMount(() => inputRef.focus());

  return (
    <section class="shell-box" aria-label={t("shell")}>
      <div class="shell-header">
        <div class="shell-header-left">
          <span role="heading" aria-level={2} class="shell-title">
            {t("shell")}
          </span>
          <span class="shell-cwd mono" title={props.cwd()}>
            {props.cwd()}
          </span>
        </div>
        <div class="shell-header-actions">
          <Show when={runningCount() > 0}>
            <span class="shell-running" role="status" aria-live="polite">
              {t("running")}
            </span>
          </Show>
          <button
            type="button"
            class="shell-clear-btn"
            aria-label={t("copyOutput")}
            disabled={!hasOutput()}
            onClick={() => void copyOutput()}
          >
            {copyFeedback() ? t(copyFeedback()!) : t("copyOutput")}
          </button>
          <span class="sr-only" role="status" aria-live="polite">
            {copyFeedback() === "copied"
              ? t("outputCopied")
              : copyFeedback() === "copyFailed"
              ? t("copyFailed")
              : ""}
          </span>
          <button
            type="button"
            class="shell-clear-btn"
            aria-label={t("clearOutput")}
            disabled={!hasOutput()}
            onClick={clearOutput}
          >
            {t("clear")}
          </button>
        </div>
      </div>
      <div
        ref={outputRef}
        class="shell-output mono"
        role="log"
        tabIndex={0}
        aria-live="polite"
        aria-busy={runningCount() > 0}
        aria-label={t("shellOutput")}
        onClick={() => {
          if (!window.getSelection()?.toString()) inputRef?.focus();
        }}
      >
        <For each={lines()}>
          {(line) => (
            <span class={`shell-line-${line.kind}`}>{line.text}</span>
          )}
        </For>
      </div>
      <div class="shell-prompt-bar">
        <span class="shell-prompt-sigil mono" aria-hidden="true">
          $
        </span>
        <input
          ref={inputRef}
          class="shell-input mono"
          aria-label={t("shellCommandInput")}
          placeholder={t("commandPlaceholder")}
          autocomplete="off"
          spellcheck={false}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          class="btn btn-primary btn-sm shell-run-btn"
          onClick={() => void run()}
        >
          {t("run")}
        </button>
      </div>
    </section>
  );
}
