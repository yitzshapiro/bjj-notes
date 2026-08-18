import { describe, expect, it } from "vitest";

import {
  clampTime,
  formatRate,
  isTypingTarget,
  matchShortcut,
  PLAYBACK_RATES,
  SKIP_SECONDS,
  stepRate,
} from "./playback-rate";

const shift = (key: string, code?: string) => ({ key, code, shiftKey: true });
const plain = (key: string) => ({ key, shiftKey: false });

describe("stepRate", () => {
  it("moves one step in each direction", () => {
    expect(stepRate(1, 1)).toBe(1.25);
    expect(stepRate(1, -1)).toBe(0.75);
  });

  it("stops at the ends instead of wrapping", () => {
    const slowest = PLAYBACK_RATES[0];
    const fastest = PLAYBACK_RATES[PLAYBACK_RATES.length - 1];
    expect(stepRate(slowest, -1)).toBe(slowest);
    expect(stepRate(fastest, 1)).toBe(fastest);
  });

  it("lands on a sensible neighbour from an off-scale rate", () => {
    expect(stepRate(1.1, 1)).toBe(1.25);
    // Must reach 1x rather than overshooting it.
    expect(stepRate(1.1, -1)).toBe(1);
  });

  it("never returns the rate it started from", () => {
    for (const rate of PLAYBACK_RATES.slice(1, -1)) {
      expect(stepRate(rate, 1)).toBeGreaterThan(rate);
      expect(stepRate(rate, -1)).toBeLessThan(rate);
    }
  });
});

describe("formatRate", () => {
  it("drops trailing zeros", () => {
    expect(formatRate(1)).toBe("1×");
    expect(formatRate(1.25)).toBe("1.25×");
    expect(formatRate(2.5)).toBe("2.5×");
  });
});

describe("clampTime", () => {
  it("keeps a skip inside the video", () => {
    expect(clampTime(-5, 100)).toBe(0);
    expect(clampTime(150, 100)).toBe(100);
    expect(clampTime(42, 100)).toBe(42);
  });

  it("allows any forward time while the duration is unknown", () => {
    expect(clampTime(500, undefined)).toBe(500);
    expect(clampTime(500, Number.NaN)).toBe(500);
    expect(clampTime(-1, undefined)).toBe(0);
  });
});

describe("matchShortcut", () => {
  it("speeds up on shift+period and slows down on shift+comma", () => {
    expect(matchShortcut(shift(">"))).toEqual({ type: "rate", direction: 1 });
    expect(matchShortcut(shift("<"))).toEqual({ type: "rate", direction: -1 });
  });

  it("accepts the physical keys for layouts that do not produce < and >", () => {
    expect(matchShortcut(shift("Unidentified", "Period"))).toEqual({ type: "rate", direction: 1 });
    expect(matchShortcut(shift("Unidentified", "Comma"))).toEqual({ type: "rate", direction: -1 });
  });

  it("skips ten seconds on the arrow keys", () => {
    expect(matchShortcut(plain("ArrowRight"))).toEqual({ type: "skip", seconds: SKIP_SECONDS });
    expect(matchShortcut(plain("ArrowLeft"))).toEqual({ type: "skip", seconds: -SKIP_SECONDS });
  });

  it("ignores an arrow held with shift so text selection still works", () => {
    expect(matchShortcut(shift("ArrowRight"))).toBeNull();
  });

  it("ignores browser and system chords", () => {
    expect(matchShortcut({ key: "ArrowRight", shiftKey: false, metaKey: true })).toBeNull();
    expect(matchShortcut({ key: ">", shiftKey: true, ctrlKey: true })).toBeNull();
    expect(matchShortcut({ key: "ArrowLeft", shiftKey: false, altKey: true })).toBeNull();
  });

  it("ignores unrelated keys", () => {
    expect(matchShortcut(plain("a"))).toBeNull();
    expect(matchShortcut(plain("ArrowUp"))).toBeNull();
    expect(matchShortcut(plain("."))).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it("recognises the fields on the study page", () => {
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "div", isContentEditable: true })).toBe(true);
  });

  it("lets the shortcut through everywhere else", () => {
    expect(isTypingTarget({ tagName: "VIDEO" })).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
