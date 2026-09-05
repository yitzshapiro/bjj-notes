/** A missing/invalid time is different from an explicit link to the beginning. */
export function readStudySeek(value: string | null, fallback?: number): number | null {
  if (value !== null) {
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) return null;
    const seconds = Number(value);
    return Number.isFinite(seconds) ? seconds : null;
  }
  return typeof fallback === "number" && Number.isFinite(fallback) && fallback >= 0 ? fallback : null;
}

/** Keep the requested timestamp exact up to the actual media boundary. */
export function clampStudySeek(seconds: number, duration: number): number {
  return Math.max(0, Math.min(seconds, Number.isFinite(duration) && duration >= 0 ? duration : seconds));
}
