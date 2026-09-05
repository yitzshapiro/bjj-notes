import glossary from "./subtitle-terminology.json";

export type TerminologyReplacement = { from: string; to: string; canonical: string; offset: number };

function key(value: string) {
  return value.toLowerCase().replace(/[\s‐‑–-]+/gu, " ");
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const aliases = new Map<string, string>();
for (const { canonical, variants } of glossary) {
  for (const variant of [canonical, canonical.replaceAll(" ", ""), ...variants]) {
    const normalized = key(variant);
    const existing = aliases.get(normalized);
    if (existing && existing !== canonical) throw new Error(`Conflicting Japanese terminology alias: ${variant}`);
    aliases.set(normalized, canonical);
  }
}

// Reviewed literal aliases only. Longest phrases win, and whole-word boundaries
// prevent ordinary words (e.g. "assuming" or "fashion") from being rewritten.
const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(${[...aliases.keys()]
  .sort((a, b) => b.length - a.length || a.localeCompare(b))
  .map((alias) => alias.split(" ").map(escape).join("[ \\t‐‑–-]+"))
  .join("|")})(s)?(?![\\p{L}\\p{N}_])`, "giu");

/** Normalize attested ASR spellings, retaining ordinary words, case and suffixes. */
export function normalizeJapaneseTerms(text: string): { text: string; replacements: TerminologyReplacement[] } {
  const replacements: TerminologyReplacement[] = [];
  const corrected = text.replace(pattern, (from: string, alias: string, plural: string | undefined, offset: number) => {
    const canonical = aliases.get(key(alias))!;
    // Kazushi is also a given name. Never rewrite the fighter's name.
    if (canonical === "kuzushi" && /^kazushi$/iu.test(alias) && /^\s+sakur[\p{L}]*/iu.test(text.slice(offset + from.length))) return from;
    let to = canonical + (plural ?? "");
    if (from.toLowerCase() === to) return from; // Already searchable; retain capitalization.
    if (from === from.toUpperCase()) to = to.toUpperCase();
    else if (/^[A-Z]/u.test(from)) to = to[0].toUpperCase() + to.slice(1);
    if (to !== from) replacements.push({ from, to, canonical, offset });
    return to;
  });
  return { text: corrected, replacements };
}
