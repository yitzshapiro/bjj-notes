import { describe, expect, it } from "vitest";

import { countsTowardStatus, distinctDays, gameStatus, nextStatusTarget } from "./game-status";

const live = (iso: string) => ({ hitAt: iso, context: "live" as const });
const drill = (iso: string) => ({ hitAt: iso, context: "drilling" as const });

describe("gameStatus", () => {
  it("starts untested with no hits", () => {
    expect(gameStatus([])).toBe("untested");
  });

  it("promotes on distinct days, not raw hit count", () => {
    // Four hits in one session is still one day of evidence.
    const oneSession = [
      live("2026-08-18T18:00:00"),
      live("2026-08-18T18:20:00"),
      live("2026-08-18T18:40:00"),
      live("2026-08-18T19:00:00"),
    ];
    expect(distinctDays(oneSession)).toBe(1);
    expect(gameStatus(oneSession)).toBe("landing");

    const threeDays = [
      live("2026-08-11T18:00:00"),
      live("2026-08-14T18:00:00"),
      live("2026-08-18T18:00:00"),
    ];
    expect(gameStatus(threeDays)).toBe("working");
  });

  it("reaches core at six separate days", () => {
    const days = ["01", "05", "08", "12", "15", "19"].map((day) => live(`2026-08-${day}T18:00:00`));
    expect(gameStatus(days)).toBe("core");
    expect(gameStatus(days.slice(0, 5))).toBe("working");
  });

  it("ignores drilling, which is not evidence against resistance", () => {
    const drilledOften = ["01", "02", "03", "04", "05", "06", "07"].map((day) =>
      drill(`2026-08-${day}T18:00:00`),
    );
    expect(distinctDays(drilledOften)).toBe(0);
    expect(gameStatus(drilledOften)).toBe("untested");
  });

  it("counts positional and competition alongside live", () => {
    expect(
      gameStatus([
        { hitAt: "2026-08-11T18:00:00", context: "positional" },
        { hitAt: "2026-08-14T18:00:00", context: "competition" },
        { hitAt: "2026-08-18T18:00:00", context: "live" },
      ]),
    ).toBe("working");
  });

  it("does not merge two sessions across midnight into one day", () => {
    expect(distinctDays([live("2026-08-18T23:30:00"), live("2026-08-19T00:30:00")])).toBe(2);
  });

  it("skips unparseable timestamps rather than throwing", () => {
    expect(distinctDays([live("not a date"), live("2026-08-18T18:00:00")])).toBe(1);
  });

  it("accepts Date objects as well as ISO strings", () => {
    expect(distinctDays([{ hitAt: new Date("2026-08-18T18:00:00"), context: "live" }])).toBe(1);
  });
});

describe("countsTowardStatus", () => {
  it("excludes only drilling", () => {
    expect(countsTowardStatus("drilling")).toBe(false);
    expect(countsTowardStatus("positional")).toBe(true);
    expect(countsTowardStatus("live")).toBe(true);
    expect(countsTowardStatus("competition")).toBe(true);
  });
});

describe("nextStatusTarget", () => {
  it("describes the next rung, and nothing beyond core", () => {
    expect(nextStatusTarget("untested")).toEqual({ next: "landing", days: 1 });
    expect(nextStatusTarget("working")).toEqual({ next: "core", days: 6 });
    expect(nextStatusTarget("core")).toBeNull();
  });
});
