/**
 * Grouping rules for the watch history.
 *
 * Kept free of DOM and database access so the date arithmetic — which is the
 * part that quietly goes wrong across month and year boundaries — can be tested
 * directly.
 */

/** History reaches back one year. Older progress is kept, just not listed. */
export const HISTORY_MAX_AGE_DAYS = 365;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Whole calendar days between two instants, in local time. Calendar days rather
 * than 24-hour spans, so something watched at 23:50 last night is "yesterday"
 * at 00:10 rather than "today".
 */
export function calendarDaysBetween(from: Date, to: Date) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

/** A clock-skewed future timestamp is kept rather than silently dropped. */
export function isWithinHistoryWindow(watchedAt: Date, now: Date) {
  const days = calendarDaysBetween(watchedAt, now);
  return days <= HISTORY_MAX_AGE_DAYS;
}

export type HistoryBucket = { key: string; label: string };

function monthLabel(date: Date, now: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(date);
}

/**
 * Which heading a watch belongs under. Recency wins over calendar boundaries —
 * something watched four days ago is "Earlier this week" even when those four
 * days crossed into a new month.
 */
export function historyBucket(watchedAt: Date, now: Date): HistoryBucket {
  const days = calendarDaysBetween(watchedAt, now);

  if (days <= 0) return { key: "today", label: "Today" };
  if (days === 1) return { key: "yesterday", label: "Yesterday" };
  if (days < 7) return { key: "this-week", label: "Earlier this week" };

  const sameMonth =
    watchedAt.getFullYear() === now.getFullYear() && watchedAt.getMonth() === now.getMonth();
  if (sameMonth) return { key: "this-month", label: "Earlier this month" };

  return {
    key: `${watchedAt.getFullYear()}-${String(watchedAt.getMonth() + 1).padStart(2, "0")}`,
    label: monthLabel(watchedAt, now),
  };
}

export type HistoryGroup<T> = HistoryBucket & { entries: T[] };

/**
 * Groups already-sorted entries under their headings, preserving the order they
 * arrive in. Entries past the one-year window are dropped.
 */
export function groupHistory<T>(
  entries: T[],
  getWatchedAt: (entry: T) => string | Date,
  now: Date = new Date(),
): HistoryGroup<T>[] {
  const groups: HistoryGroup<T>[] = [];
  const byKey = new Map<string, HistoryGroup<T>>();

  for (const entry of entries) {
    const raw = getWatchedAt(entry);
    const watchedAt = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(watchedAt.getTime())) continue;
    if (!isWithinHistoryWindow(watchedAt, now)) continue;

    const bucket = historyBucket(watchedAt, now);
    const existing = byKey.get(bucket.key);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }
    const group: HistoryGroup<T> = { ...bucket, entries: [entry] };
    byKey.set(bucket.key, group);
    groups.push(group);
  }

  return groups;
}

/** Exact time for a row's tooltip, where the heading only gives the day. */
export function formatWatchedAt(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
