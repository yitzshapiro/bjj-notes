export function formatDuration(value: number | null | undefined) {
  const seconds = Math.max(0, Math.floor(value ?? 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function formatPercent(value: number | null | undefined) {
  return `${Math.round(Math.min(1, Math.max(0, value ?? 0)) * 100)}%`;
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "Not studied yet";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not studied yet";

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Short day label for tallies: "Today", "Yesterday", then a calendar date. */
export function formatDay(value: string | Date | null | undefined) {
  const date = toDate(value);
  if (!date) return "Never";

  const days = Math.floor((Date.now() - date.getTime()) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDate(date);
}

/** How long something has been carried in the focus list, counted in weeks. */
export function formatFocusAge(value: string | Date | null | undefined) {
  const date = toDate(value);
  if (!date) return "In focus";

  const weeks = Math.floor((Date.now() - date.getTime()) / (7 * DAY_MS));
  if (weeks < 1) return "Added this week";
  if (weeks === 1) return "Carried over 1 week";
  return `Carried over ${weeks} weeks`;
}

export function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
