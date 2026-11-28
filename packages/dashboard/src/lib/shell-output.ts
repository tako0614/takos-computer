export type ShellLineKind = "hint" | "cmd" | "out" | "err" | "warn" | "fatal";

export interface ShellLine {
  text: string;
  kind: ShellLineKind;
  initialHint?: boolean;
}

export interface ShellMatchSegment {
  text: string;
  matchIndex: number | null;
}

export interface HighlightedShellLine {
  kind: ShellLineKind;
  segments: ShellMatchSegment[];
}

export interface ShellHighlightResult {
  lines: HighlightedShellLine[];
  matchesByLine: WeakMap<ShellLine, ShellMatchSegment[]>;
  totalMatches: number;
  capped: boolean;
}

export const MAX_SHELL_SEARCH_MATCHES = 2000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlightShellLines(
  lines: readonly ShellLine[],
  query: string,
  maxMatches: number = MAX_SHELL_SEARCH_MATCHES,
): ShellHighlightResult {
  const matchesByLine = new WeakMap<ShellLine, ShellMatchSegment[]>();
  if (!query) {
    return {
      lines: lines.map((line) => ({
        kind: line.kind,
        segments: [{ text: line.text, matchIndex: null }],
      })),
      matchesByLine,
      totalMatches: 0,
      capped: false,
    };
  }

  const pattern = new RegExp(escapeRegExp(query), "gi");
  let totalMatches = 0;
  let capped = false;

  const highlighted = lines.map((line): HighlightedShellLine => {
    if (line.initialHint || !line.text || capped) {
      return {
        kind: line.kind,
        segments: [{ text: line.text, matchIndex: null }],
      };
    }

    pattern.lastIndex = 0;
    const segments: ShellMatchSegment[] = [];
    let lastEnd = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(line.text)) !== null) {
      if (match[0].length === 0) {
        pattern.lastIndex++;
        continue;
      }
      if (totalMatches >= maxMatches) {
        capped = true;
        break;
      }
      if (match.index > lastEnd) {
        segments.push({
          text: line.text.slice(lastEnd, match.index),
          matchIndex: null,
        });
      }
      segments.push({
        text: match[0],
        matchIndex: totalMatches++,
      });
      lastEnd = match.index + match[0].length;
    }

    if (segments.length === 0) {
      return {
        kind: line.kind,
        segments: [{ text: line.text, matchIndex: null }],
      };
    }

    if (lastEnd < line.text.length) {
      segments.push({
        text: line.text.slice(lastEnd),
        matchIndex: null,
      });
    }

    matchesByLine.set(line, segments);
    return { kind: line.kind, segments };
  });

  return { lines: highlighted, matchesByLine, totalMatches, capped };
}

export function stepShellSearchMatch(
  currentIndex: number,
  totalMatches: number,
  delta: 1 | -1,
): number {
  if (totalMatches <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= totalMatches) {
    return delta === 1 ? 0 : totalMatches - 1;
  }
  return (currentIndex + delta + totalMatches) % totalMatches;
}
