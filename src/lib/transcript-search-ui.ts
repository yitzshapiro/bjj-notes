/** Keep explicit zero and fractional cue starts when opening a search result. */
export function transcriptSearchHref(videoId: string, name: string, startSeconds: number) {
  const params = new URLSearchParams({ name, t: String(Math.max(0, startSeconds)) });
  return `/library/${encodeURIComponent(videoId)}?${params}`;
}

export function highlightedTranscriptParts(snippet: string, query: string): { text: string; match: boolean }[] {
  const words = query.trim().split(/[\s‐‑–-]+/u).filter(Boolean);
  if (!words.length) return [{ text: snippet, match: false }];
  const pattern = new RegExp(words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("[\\s‐‑–-]+"), "giu");
  const parts: { text: string; match: boolean }[] = [];
  let offset = 0;
  for (const match of snippet.matchAll(pattern)) {
    if (match.index > offset) parts.push({ text: snippet.slice(offset, match.index), match: false });
    parts.push({ text: match[0], match: true });
    offset = match.index + match[0].length;
  }
  if (offset < snippet.length) parts.push({ text: snippet.slice(offset), match: false });
  return parts;
}
