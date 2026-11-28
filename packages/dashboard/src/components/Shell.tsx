import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { mcpCall } from "../lib/mcp.ts";
import {
  highlightShellLines,
  type ShellLine,
  type ShellLineKind,
  stepShellSearchMatch,
} from "../lib/shell-output.ts";
import { pushShellHistory, stepShellHistory } from "../lib/validation.ts";
import { useI18n } from "../i18n.ts";

export default function Shell(props: { mcpUrl: string; cwd: () => string }) {
  const { t } = useI18n();
  const searchBarId = createUniqueId();
  const [lines, setLines] = createSignal<ShellLine[]>([
    { text: t("typeCommandHint"), kind: "hint", initialHint: true },
  ]);
  const [history, setHistory] = createSignal<string[]>([]);
  const [historyIdx, setHistoryIdx] = createSignal(-1);
  const [historyDraft, setHistoryDraft] = createSignal("");
  const [runningCount, setRunningCount] = createSignal(0);
  const [wrapLines, setWrapLines] = createSignal(true);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [activeMatch, setActiveMatch] = createSignal(0);
  const [copyFeedback, setCopyFeedback] = createSignal<
    "copied" | "copyFailed" | null
  >(null);
  let inputRef!: HTMLInputElement;
  let outputRef!: HTMLDivElement;
  let findBtnRef: HTMLButtonElement | undefined;
  let searchInputRef: HTMLInputElement | undefined;
  let searchComposing = false;
  let alive = true;
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => {
    alive = false;
    if (copyTimer !== undefined) clearTimeout(copyTimer);
  });

  const hasOutput = createMemo(() =>
    lines().some((line) => !line.initialHint)
  );

  const activeSearchQuery = createMemo(() =>
    searchOpen() ? searchQuery() : ""
  );

  const highlighted = createMemo(() =>
    highlightShellLines(lines(), activeSearchQuery())
  );

  const searchCountLabel = createMemo(() => {
    const query = searchQuery();
    if (!query) return "";
    const { totalMatches, capped } = highlighted();
    if (totalMatches === 0) return t("noMatches");
    const current = activeMatch() >= 0 && activeMatch() < totalMatches
      ? activeMatch() + 1
      : 1;
    return t(capped ? "searchMatchCountCapped" : "searchMatchCount", {
      current,
      total: totalMatches,
    });
  });

  // Keep search input DOM value in sync without interrupting CJK IME composition.
  createEffect(() => {
    const next = searchQuery();
    if (!searchComposing && searchInputRef && searchInputRef.value !== next) {
      searchInputRef.value = next;
    }
  });

  // Reset active match to first hit when the search query changes.
  createEffect(
    on(searchQuery, (query) => {
      setActiveMatch(query ? 0 : -1);
    }),
  );

  // Clamp active match when transcript lines change.
  createEffect(() => {
    const total = highlighted().totalMatches;
    if (total === 0) {
      if (activeMatch() !== -1) setActiveMatch(-1);
    } else if (activeMatch() < 0 || activeMatch() >= total) {
      setActiveMatch(0);
    }
  });

  // Scroll the active search match into view inside the shell transcript.
  createEffect(() => {
    if (!searchOpen() || !searchQuery()) return;
    const total = highlighted().totalMatches;
    const idx = activeMatch();
    if (total <= 0 || idx < 0 || idx >= total) return;
    requestAnimationFrame(() => {
      if (!alive || !outputRef) return;
      const mark = outputRef.querySelector<HTMLElement>(
        `mark[data-match-index="${idx}"]`,
      );
      mark?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  });

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

  const append = (text: string, kind: ShellLineKind) => {
    if (!alive) return;
    setLines((prev) => [...prev, { text, kind }]);
    if (!searchOpen() || !searchQuery()) {
      requestAnimationFrame(() => {
        if (alive && outputRef) outputRef.scrollTop = outputRef.scrollHeight;
      });
    }
  };

  const openSearch = () => {
    if (!hasOutput()) return;
    setSearchOpen(true);
    queueMicrotask(() => {
      if (alive && searchInputRef?.isConnected) {
        searchInputRef.focus();
        searchInputRef.select();
      }
    });
  };

  const closeSearch = () => {
    searchComposing = false;
    setSearchOpen(false);
    setSearchQuery("");
    setActiveMatch(-1);
    queueMicrotask(() => {
      if (!alive) return;
      if (findBtnRef?.isConnected && !findBtnRef.disabled) {
        findBtnRef.focus();
      } else if (inputRef?.isConnected) {
        inputRef.focus();
      }
    });
  };

  const stepMatch = (delta: 1 | -1) => {
    const total = highlighted().totalMatches;
    if (total <= 0) return;
    setActiveMatch((cur) => stepShellSearchMatch(cur, total, delta));
  };

  const clearOutput = () => {
    searchComposing = false;
    setSearchOpen(false);
    setSearchQuery("");
    setActiveMatch(-1);
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

  const onShellKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.altKey &&
      e.key.toLowerCase() === "f" &&
      hasOutput()
    ) {
      e.preventDefault();
      openSearch();
    }
  };

  const onSearchBarKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (e.target === searchInputRef && searchQuery()) {
        searchComposing = false;
        setSearchQuery("");
      } else {
        closeSearch();
      }
    }
  };

  const onSearchKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") {
      e.preventDefault();
      stepMatch(e.shiftKey ? -1 : 1);
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
    <section
      class="shell-box"
      aria-label={t("shell")}
      onKeyDown={onShellKeyDown}
    >
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
            classList={{ active: wrapLines() }}
            aria-pressed={wrapLines()}
            onClick={() => setWrapLines((wrap) => !wrap)}
          >
            {t("wrapLines")}
          </button>
          <button
            ref={(el) => {
              findBtnRef = el;
            }}
            type="button"
            class="shell-clear-btn"
            classList={{ active: searchOpen() }}
            aria-expanded={searchOpen()}
            aria-controls={searchOpen() ? searchBarId : undefined}
            disabled={!hasOutput()}
            onClick={() => (searchOpen() ? closeSearch() : openSearch())}
          >
            {t("findInOutput")}
          </button>
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
      <Show when={searchOpen()}>
        <div
          id={searchBarId}
          class="shell-search-bar"
          role="search"
          aria-label={t("searchShellOutput")}
          onKeyDown={onSearchBarKeyDown}
        >
          <input
            ref={(el) => {
              searchInputRef = el;
              el.value = searchQuery();
            }}
            type="search"
            class="shell-search-input mono"
            aria-label={t("searchShellOutput")}
            placeholder={t("searchShellOutputPlaceholder")}
            autocomplete="off"
            spellcheck={false}
            onCompositionStart={() => {
              searchComposing = true;
            }}
            onCompositionEnd={(e) => {
              searchComposing = false;
              setSearchQuery(e.currentTarget.value);
            }}
            onInput={(e) => {
              if (!e.isComposing && !searchComposing) {
                setSearchQuery(e.currentTarget.value);
              }
            }}
            onKeyDown={onSearchKeyDown}
          />
          <span class="shell-search-count mono" role="status" aria-live="polite">
            {searchCountLabel()}
          </span>
          <div class="shell-search-nav">
            <button
              type="button"
              class="shell-clear-btn shell-search-nav-btn"
              aria-label={t("previousMatch")}
              disabled={highlighted().totalMatches === 0}
              onClick={() => stepMatch(-1)}
            >
              &uarr;
            </button>
            <button
              type="button"
              class="shell-clear-btn shell-search-nav-btn"
              aria-label={t("nextMatch")}
              disabled={highlighted().totalMatches === 0}
              onClick={() => stepMatch(1)}
            >
              &darr;
            </button>
            <button
              type="button"
              class="shell-clear-btn shell-search-nav-btn"
              aria-label={t("closeSearch")}
              onClick={closeSearch}
            >
              &times;
            </button>
          </div>
        </div>
      </Show>
      <div
        ref={outputRef}
        class="shell-output mono"
        classList={{ "shell-output-nowrap": !wrapLines() }}
        role="log"
        tabIndex={0}
        aria-live={activeSearchQuery() ? "off" : "polite"}
        aria-busy={runningCount() > 0}
        aria-label={t("shellOutput")}
        onClick={() => {
          if (!window.getSelection()?.toString()) inputRef?.focus();
        }}
      >
        <For each={lines()}>
          {(line) => {
            const segments = createMemo(() => {
              if (!activeSearchQuery()) return undefined;
              return highlighted().matchesByLine.get(line);
            });
            return (
              <span class={`shell-line-${line.kind}`}>
                <Show when={segments()} fallback={line.text}>
                  {(segs) => (
                    <For each={segs()}>
                      {(seg) =>
                        seg.matchIndex === null ? seg.text : (
                          <mark
                            class="shell-match"
                            classList={{
                              "shell-match-active":
                                seg.matchIndex === activeMatch(),
                            }}
                            data-match-index={seg.matchIndex}
                          >
                            {seg.text}
                          </mark>
                        )}
                    </For>
                  )}
                </Show>
              </span>
            );
          }}
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
