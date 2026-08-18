import { describe, expect, it } from "vitest";

import { classify, REVIEW_THRESHOLD, TAGS } from "./classify";

const F2F_PULL = ["BJJ Instructionals", "John Danaher", "Feet To Floor", "Volume 3"];
const F2F_THROWS = ["BJJ Instructionals", "John Danaher", "Feet To Floor", "Volume 2"];

function slugs(label: string, path: string[]) {
  return classify({ label, path }).map((tag) => tag.slug);
}

describe("classify", () => {
  it("gives every tag definition a unique slug", () => {
    expect(new Set(TAGS.map((tag) => tag.slug)).size).toBe(TAGS.length);
  });

  it("scores a label match above a path-only match", () => {
    const [labelTag] = classify({ label: "Rolling Triangle", path: ["Library"] });
    const [pathTag] = classify({ label: "Part 2", path: ["Library", "Triangles", "Volume 1.mp4"] });

    expect(labelTag.confidence).toBeGreaterThan(REVIEW_THRESHOLD);
    expect(pathTag.confidence).toBeLessThan(REVIEW_THRESHOLD);
  });

  it("scores a tag highest when label and path agree", () => {
    const tags = classify({ label: "Rolling Triangle", path: ["Library", "Triangles", "Volume 1.mp4"] });
    expect(tags.find((tag) => tag.slug === "triangle")?.confidence).toBeGreaterThan(0.9);
  });

  it("reads the guard pull out of the Feet to Floor volume 3 folder", () => {
    expect(slugs("Pull to Ashi Sweep", [...F2F_PULL, "Volume 2 - Pulling to a Sweep.mp4"])).toContain(
      "guard-pull",
    );
  });

  // A video *named* "Volume 3" lives inside the "Volume 2" folder, so the
  // sub-folder rule has to be anchored to the path separators.
  it("does not read a guard pull from a video merely named volume 3", () => {
    expect(slugs("Classic Osoto", [...F2F_THROWS, "Volume 3 - Big Ashi Waza, Osoto Gari.mp4"])).not.toContain(
      "guard-pull",
    );
  });

  it("treats rear mount as the back rather than mount", () => {
    const tags = slugs("Far Trap → Rear Mount", ["Library", "Back Attacks", "Volume 1.mp4"]);
    expect(tags).toContain("back");
    expect(tags).not.toContain("mount");
  });

  it("still tags mount when the label really means mount", () => {
    expect(slugs("Cross-Wrist Juji From Mount", ["Library"])).toContain("mount");
  });

  it("implies a submission from a named submission technique", () => {
    expect(slugs("Arm-In Guillotine", ["Library"])).toEqual(
      expect.arrayContaining(["guillotine", "submission"]),
    );
  });

  it("tags leg entanglement from an ashi garami reference", () => {
    expect(slugs("Ashi X vs X Guard", ["Library"])).toEqual(
      expect.arrayContaining(["leg-entanglement", "x-guard"]),
    );
  });

  it("separates theory from technique", () => {
    expect(slugs("Philosophy of Guard Pulling", ["Library"])).toContain("concept");
  });

  it("returns nothing rather than guessing on an unrecognisable label", () => {
    expect(classify({ label: "Part 3", path: ["Library"] })).toEqual([]);
  });

  it("emits no duplicate slugs when several rules agree", () => {
    const tags = classify({
      label: "Triangle vs Single Leg",
      path: ["Library", "Triangles", "Volume 2 - Front Triangle Part 1.mp4"],
    });
    expect(new Set(tags.map((tag) => tag.slug)).size).toBe(tags.length);
  });

  it("sorts the most confident tag first", () => {
    const tags = classify({
      label: "Kimura vs Armbar",
      path: ["Library", "Kimura", "Volume 4 - Applications.mp4"],
    });
    const confidences = tags.map((tag) => tag.confidence);
    expect(confidences).toEqual([...confidences].sort((a, b) => b - a));
  });
});
