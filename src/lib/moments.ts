// Helpers for turning a transcript into a prompt, and Claude's answer into clean clip ranges.
// No external imports, so this file is easy to test on its own.

export type Word = { text: string; start: number; end: number }; // times in milliseconds
export type Moment = { startTime: number; endTime: number; hookTitle: string }; // times in seconds

const MIN_LENGTH = 12; // seconds
const MAX_LENGTH = 90; // seconds

// One line per few words, each starting with its time in seconds, so Claude can point at exact spots.
export function formatTranscript(words: Word[], wordsPerLine = 8): string {
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerLine) {
    const chunk = words.slice(i, i + wordsPerLine);
    lines.push(`[${(chunk[0].start / 1000).toFixed(1)}] ${chunk.map((w) => w.text).join(" ")}`);
  }
  return lines.join("\n");
}

// Pulls the JSON list out of Claude's reply, even if it added a code fence or a sentence around it,
// or mentioned things like [604.9] in plain text before the list.
export function parseMoments(raw: string): unknown[] {
  let from = raw.indexOf("[");
  while (from !== -1) {
    let to = raw.lastIndexOf("]");
    while (to > from) {
      try {
        const parsed: unknown = JSON.parse(raw.slice(from, to + 1));
        // Only a non-empty list of objects counts (so "[604.9]" in a sentence is skipped)
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed.every((x) => typeof x === "object" && x !== null)
        ) {
          return parsed;
        }
      } catch {
        // not valid JSON from here to there; try a shorter slice
      }
      to = raw.lastIndexOf("]", to - 1);
    }
    from = raw.indexOf("[", from + 1);
  }
  return [];
}

function nearest(words: Word[], target: number, pick: (w: Word) => number): number {
  let best = pick(words[0]);
  for (const w of words) {
    if (Math.abs(pick(w) - target) < Math.abs(best - target)) best = pick(w);
  }
  return best;
}

// Checks every moment Claude suggested and keeps only the good ones:
// snaps to real word boundaries, enforces a sensible length, and drops overlaps. Best-first order is kept.
export function cleanMoments(raw: unknown[], words: Word[], max = 5): Moment[] {
  if (words.length === 0) return [];
  const videoEnd = words[words.length - 1].end / 1000;
  const accepted: Moment[] = [];

  for (const item of raw) {
    if (accepted.length >= max) break;
    if (typeof item !== "object" || item === null) continue;
    const m = item as Record<string, unknown>;
    if (typeof m.startTime !== "number" || typeof m.endTime !== "number") continue;
    if (!Number.isFinite(m.startTime) || !Number.isFinite(m.endTime)) continue;

    // Start and end on real word boundaries, with a touch of breathing room
    const snappedStart = nearest(words, m.startTime * 1000, (w) => w.start) / 1000;
    const snappedEnd = nearest(words, m.endTime * 1000, (w) => w.end) / 1000;
    const startTime = Math.max(0, snappedStart - 0.2);
    const endTime = Math.min(videoEnd, snappedEnd + 0.3);

    const length = endTime - startTime;
    if (length < MIN_LENGTH || length > MAX_LENGTH) continue;
    if (accepted.some((a) => startTime < a.endTime && a.startTime < endTime)) continue;

    const title = typeof m.hookTitle === "string" ? m.hookTitle.trim().slice(0, 80) : "";
    accepted.push({
      startTime: Math.round(startTime * 100) / 100,
      endTime: Math.round(endTime * 100) / 100,
      hookTitle: title || "Untitled clip",
    });
  }
  return accepted;
}
