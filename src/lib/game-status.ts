/**
 * How established a technique is in your game, derived from the hits you logged
 * rather than set by hand.
 *
 * The rule that matters: distinct *days* count, not raw hits. Landing something
 * four times in one good round says far less than landing it once a week for a
 * month, and a status you can inflate in a single session is not evidence of
 * anything. Drilling repetitions are excluded for the same reason — the question
 * is whether it works on a resisting partner.
 */

export type HitContext = "drilling" | "positional" | "live" | "competition";

export const HIT_CONTEXTS: HitContext[] = ["drilling", "positional", "live", "competition"];

export const HIT_CONTEXT_LABEL: Record<HitContext, string> = {
  drilling: "Drilling",
  positional: "Positional",
  live: "Live rolling",
  competition: "Competition",
};

export type GameStatus = "untested" | "landing" | "working" | "core";

export const GAME_STATUS_LABEL: Record<GameStatus, string> = {
  untested: "Untested",
  landing: "Landing",
  working: "Working",
  core: "Core",
};

export const GAME_STATUS_HINT: Record<GameStatus, string> = {
  untested: "In your game, but not landed against resistance yet",
  landing: "Landed against resistance — not yet repeatable",
  working: "Landed on three or more separate days",
  core: "Landed on six or more separate days — this is yours",
};

/** Only resisting contexts count toward status. */
export function countsTowardStatus(context: HitContext) {
  return context !== "drilling";
}

/** Local calendar day, so two hits either side of midnight UTC aren't merged. */
function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function distinctDays(hits: { hitAt: string | Date; context: HitContext }[]) {
  const days = new Set<string>();
  for (const hit of hits) {
    if (!countsTowardStatus(hit.context)) continue;
    const date = hit.hitAt instanceof Date ? hit.hitAt : new Date(hit.hitAt);
    if (Number.isNaN(date.getTime())) continue;
    days.add(dayKey(date));
  }
  return days.size;
}

export function gameStatus(hits: { hitAt: string | Date; context: HitContext }[]): GameStatus {
  const days = distinctDays(hits);
  if (days >= 6) return "core";
  if (days >= 3) return "working";
  if (days >= 1) return "landing";
  return "untested";
}

/** What the next status needs, for the progress hint on a card. */
export function nextStatusTarget(status: GameStatus): { next: GameStatus; days: number } | null {
  if (status === "untested") return { next: "landing", days: 1 };
  if (status === "landing") return { next: "working", days: 3 };
  if (status === "working") return { next: "core", days: 6 };
  return null;
}
