import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { mcpCall } from "../lib/mcp.ts";
import { useI18n } from "../i18n.ts";

type LineKind = "hint" | "cmd" | "out" | "err" | "warn" | "fatal";

interface ShellLine {
  text: string;
  kind: LineKind;
}

export default function Shell(props: { mcpUrl: string; cwd: () => string }) {
  const { t } = useI18n();
  const [lines, setLines] = createSignal<ShellLine[]>([
    { text: t("typeCommandHint"), kind: "hint" },
  ]);
  const [history, setHistory] = createSignal<string[]>([]);
  const [historyIdx, setHistoryIdx] = createSignal(-1);
  const [runningCount, setRunningCount] = createSignal(0);
  let inputRef!: HTMLInputElement;
  let outputRef!: HTMLDivElement;
  let alive = true;

  onCleanup(() => {
    alive = false;
  });

  createEffect(() => {
    const hint = t("typeCommandHint");
    setLines((prev) => {
      if (prev.length !== 1 || prev[0]?.kind !== "hint") return prev;
      return [{ text: hint, kind: "hint" }];
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
    setLines([{ text: t("typeCommandHint"), kind: "hint" }]);
    inputRef?.focus();
  };

  const run = async () => {
    const cmd = inputRef.value.trim();
    if (!cmd) return;

    setHistory((h) => [cmd, ...h].slice(0, 100));
    setHistoryIdx(-1);
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
    if (e.key === "Enter") {
      e.preventDefault();
      void run();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const h = history();
      if (!h.length) return;
      const idx = Math.min(historyIdx() + 1, h.length - 1);
      setHistoryIdx(idx);
      inputRef.value = h[idx];
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx() <= 0) {
        setHistoryIdx(-1);
        inputRef.value = "";
        return;
      }
      const idx = historyIdx() - 1;
      setHistoryIdx(idx);
      inputRef.value = history()[idx];
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
            aria-label={t("clearOutput")}
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
