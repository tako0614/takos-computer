import { createEffect, createSignal, For, onMount } from "solid-js";
import { mcpCall } from "../lib/mcp.ts";
import { useI18n } from "../i18n.ts";

interface ShellLine {
  text: string;
  color: string;
}

export default function Shell(props: { mcpUrl: string; cwd: () => string }) {
  const { t } = useI18n();
  const [lines, setLines] = createSignal<ShellLine[]>([
    { text: t("typeCommandHint"), color: "#64748b" },
  ]);
  const [history, setHistory] = createSignal<string[]>([]);
  const [historyIdx, setHistoryIdx] = createSignal(-1);
  let inputRef!: HTMLInputElement;
  let outputRef!: HTMLDivElement;

  createEffect(() => {
    setLines((prev) => {
      if (prev.length !== 1) return prev;
      return [{ text: t("typeCommandHint"), color: "#64748b" }];
    });
  });

  const append = (text: string, color: string) => {
    setLines((prev) => [...prev, { text, color }]);
    requestAnimationFrame(() => {
      outputRef.scrollTop = outputRef.scrollHeight;
    });
  };

  const run = async () => {
    const cmd = inputRef.value.trim();
    if (!cmd) return;

    setHistory((h) => [cmd, ...h].slice(0, 100));
    setHistoryIdx(-1);
    inputRef.value = "";

    append(`$ ${cmd}\n`, "#6ee7b7");

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
      if (result?.stdout) append(result.stdout, "#e2e8f0");
      if (result?.stderr) append(result.stderr, "#fca5a5");
      if (result?.timed_out) append(`${t("timedOut")}\n`, "#fcd34d");
      else if (result && result.exit_code !== 0) {
        append(`exit ${result.exit_code}\n`, "#64748b");
      }
    } catch (err) {
      append(
        `${
          t("error", {
            message: err instanceof Error ? err.message : String(err),
          })
        }\n`,
        "#ef4444",
      );
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      run();
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
    <div style="background:#0f172a; border:1px solid #1e293b; border-radius:0.5rem; overflow:hidden">
      <div
        ref={outputRef}
        style="height:420px; overflow-y:auto; padding:0.75rem; font-size:0.8125rem; line-height:1.6; white-space:pre-wrap; word-break:break-all"
        class="mono"
      >
        <For each={lines()}>
          {(line) => <span style={{ color: line.color }}>{line.text}</span>}
        </For>
      </div>
      <div class="flex" style="border-top:1px solid #1e293b">
        <span
          class="mono"
          style="padding:0.5rem 0.75rem; color:#6ee7b7; font-size:0.8125rem"
        >
          $
        </span>
        <input
          ref={inputRef}
          class="mono"
          style="flex:1; background:transparent; border:none; outline:none; color:#e2e8f0; font-size:0.8125rem; padding:0.5rem 0.75rem 0.5rem 0"
          placeholder={t("commandPlaceholder")}
          autocomplete="off"
          spellcheck={false}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}
