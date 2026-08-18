import { describe, expect, it } from "vitest";

import {
  calendarDaysBetween,
  groupHistory,
  HISTORY_MAX_AGE_DAYS,
  historyBucket,
  isWithinHistoryWindow,
} from "./history";

/** Local time throughout — the buckets are deliberately calendar-based. */
const at = (iso: string) => new Date(iso);
const NOW = at("2026-08-18T14:00:00");

describe("calendarDaysBetween", () => {
  it("counts calendar days, not 24-hour spans", () => {
    // Ten minutes apart, but across midnight — that is one day.
    expect(calendarDaysBetween(at("2026-08-17T23:50:00"), at("2026-08-18T00:10:00"))).toBe(1);
    // Twenty-three hours apart within one day — that is zero.
    expect(calendarDaysBetween(at("2026-08-18T00:10:00"), at("2026-08-18T23:50:00"))).toBe(0);
  });

  it("spans months and years", () => {
    expect(calendarDaysBetween(at("2026-07-31T12:00:00"), at("2026-08-01T01:00:00"))).toBe(1);
    expect(calendarDaysBetween(at("2025-12-31T12:00:00"), at("2026-01-01T12:00:00"))).toBe(1);
  });
});

describe("historyBucket", () => {
  it("labels the last two days by name", () => {
    expect(historyBucket(at("2026-08-18T09:00:00"), NOW).key).toBe("today");
    expect(historyBucket(at("2026-08-17T09:00:00"), NOW).key).toBe("yesterday");
  });

  it("groups the rest of the last week together", () => {
    expect(historyBucket(at("2026-08-14T09:00:00"), NOW)).toMatchObject({
      key: "this-week",
      label: "Earlier this week",
    });
    expect(historyBucket(at("2026-08-12T09:00:00"), NOW).key).toBe("this-week");
  });

  // Recency has to win, or a Monday watch shows under "July" on the 2nd.
  it("keeps a recent watch in the week bucket even across a month boundary", () => {
    const now = at("2026-09-02T14:00:00");
    expect(historyBucket(at("2026-08-30T09:00:00"), now).key).toBe("this-week");
  });

  it("falls back to the calendar month, then to named months", () => {
    expect(historyBucket(at("2026-08-02T09:00:00"), NOW).key).toBe("this-month");
    expect(historyBucket(at("2026-07-02T09:00:00"), NOW)).toMatchObject({
      key: "2026-07",
      label: "July",
    });
  });

  it("includes the year once the month is in a different one", () => {
    expect(historyBucket(at("2025-11-02T09:00:00"), NOW).label).toBe("November 2025");
  });
});

describe("isWithinHistoryWindow", () => {
  it("keeps a watch exactly one year old and drops the day before", () => {
    const oldest = new Date(NOW);
    oldest.setDate(oldest.getDate() - HISTORY_MAX_AGE_DAYS);
    const tooOld = new Date(NOW);
    tooOld.setDate(tooOld.getDate() - HISTORY_MAX_AGE_DAYS - 1);

    expect(isWithinHistoryWindow(oldest, NOW)).toBe(true);
    expect(isWithinHistoryWindow(tooOld, NOW)).toBe(false);
  });

  it("keeps a future timestamp rather than dropping it to clock skew", () => {
    expect(isWithinHistoryWindow(at("2026-08-19T09:00:00"), NOW)).toBe(true);
  });
});

describe("groupHistory", () => {
  const rows = [
    { id: "a", watchedAt: "2026-08-18T13:00:00" },
    { id: "b", watchedAt: "2026-08-18T09:00:00" },
    { id: "c", watchedAt: "2026-08-17T20:00:00" },
    { id: "d", watchedAt: "2026-08-13T20:00:00" },
    { id: "e", watchedAt: "2026-08-03T20:00:00" },
    { id: "f", watchedAt: "2026-06-03T20:00:00" },
    { id: "g", watchedAt: "2024-06-03T20:00:00" },
  ];

  it("preserves incoming order and drops anything past the window", () => {
    const groups = groupHistory(rows, (row) => row.watchedAt, NOW);

    expect(groups.map((group) => group.key)).toEqual([
      "today",
      "yesterday",
      "this-week",
      "this-month",
      "2026-06",
    ]);
    expect(groups[0].entries.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(groups.flatMap((group) => group.entries).map((entry) => entry.id)).not.toContain("g");
  });

  it("returns no groups for an empty history", () => {
    expect(groupHistory([], (row: { watchedAt: string }) => row.watchedAt, NOW)).toEqual([]);
  });

  it("skips unparseable timestamps instead of throwing", () => {
    const groups = groupHistory(
      [{ id: "x", watchedAt: "not a date" }, { id: "y", watchedAt: "2026-08-18T09:00:00" }],
      (row) => row.watchedAt,
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((entry) => entry.id)).toEqual(["y"]);
  });

  it("accepts Date objects as well as strings", () => {
    const groups = groupHistory([{ when: at("2026-08-18T09:00:00") }], (row) => row.when, NOW);
    expect(groups[0].key).toBe("today");
  });
});
