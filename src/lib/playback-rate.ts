/**
 * Playback speed and skip helpers for the study player.
 *
 * Kept free of DOM access so the stepping and key-matching rules can be tested
 * directly; the component layer supplies the video element and the event.
 */

/** Slow enough to read a grip, fast enough to skim a repeat demonstration. */
export const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export const DEFAULT_RATE = 1;
export const SKIP_SECONDS = 10;

const STORAGE_KEY = "bjj-notes:playback-rate";

/**
 * Moves to the next rate strictly above or below the current one, stopping at
 * either end rather than wrapping — wrapping from 3× back to 0.25× on an extra
 * keypress is startling.
 *
 * Defined by comparison rather than by index so an off-scale rate (a value the
 * browser kept from elsewhere, say 1.1×) still lands somewhere sensible:
 * slowing down reaches 1×, rather than snapping to the nearest step first and
 * overshooting to 0.75×.
 */
export function stepRate(current: number, direction: 1 | -1): number {
  const epsilon = 1e-6;
  if (direction === 1) {
    return PLAYBACK_RATES.find((rate) => rate > current + epsilon) ?? PLAYBACK_RATES[PLAYBACK_RATES.length - 1];
  }
  return [...PLAYBACK_RATES].reverse().find((rate) => rate < current - epsilon) ?? PLAYBACK_RATES[0];
}

/** "1×", "1.25×" — no trailing zeros. */
export function formatRate(rate: number) {
  return `${Number(rate.toFixed(2))}×`;
}

export function clampTime(seconds: number, duration: number | undefined) {
  const upper = duration != null && Number.isFinite(duration) ? duration : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(0, seconds), upper);
}

/**
 * Typing must never trigger a shortcut — the notes panel sits beside the video
 * and a stray comma would otherwise change playback speed mid-sentence.
 */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export type PlayerAction =
  | { type: "rate"; direction: 1 | -1 }
  | { type: "skip"; seconds: number }
  | { type: "rate-reset" };

/**
 * Maps a keypress to a player action, or null when the key is not a shortcut.
 *
 * `key` is preferred for the speed controls because a US keyboard reports
 * Shift+Period as ">", but `code` is accepted too so layouts that place those
 * glyphs elsewhere still work.
 */
export function matchShortcut(event: {
  key: string;
  code?: string;
  shiftKey: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): PlayerAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  if (event.key === ">" || (event.shiftKey && event.code === "Period")) {
    return { type: "rate", direction: 1 };
  }
  if (event.key === "<" || (event.shiftKey && event.code === "Comma")) {
    return { type: "rate", direction: -1 };
  }
  if (event.shiftKey) return null;

  if (event.key === "ArrowRight") return { type: "skip", seconds: SKIP_SECONDS };
  if (event.key === "ArrowLeft") return { type: "skip", seconds: -SKIP_SECONDS };
  if (event.key === "?") return null;

  return null;
}

export function loadStoredRate(): number {
  if (typeof window === "undefined") return DEFAULT_RATE;
  const stored = Number(window.localStorage.getItem(STORAGE_KEY));
  return PLAYBACK_RATES.includes(stored as (typeof PLAYBACK_RATES)[number]) ? stored : DEFAULT_RATE;
}

export function storeRate(rate: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, String(rate));
}
