import { describe, expect, it } from "vitest";

import {
  exportNotesAsJson,
  exportNotesAsMarkdown,
  exportVideoNotes,
  formatVideoTime,
  type ExportVideoNotes,
} from "./export";

const notes: ExportVideoNotes = {
  video: {
    id: "video-1",
    name: "Armbar Fundamentals.mp4",
    path: ["BJJ Library", "Armbars", "Armbar Fundamentals.mp4"],
  },
  playbackPositionSeconds: 754.9,
  completed: false,
  sections: [
    {
      id: "section-1",
      title: "Breaking posture",
      startSeconds: 60,
      endSeconds: 125,
      starred: true,
    },
  ],
  timestampedNotes: [
    { id: "later", timeSeconds: 95, text: "Pinch the knees" },
    {
      id: "first",
      timeSeconds: 12,
      text: "Control posture\nbefore opening guard",
      starred: true,
    },
  ],
  runningNotes: "Practice the angle change during open mat.",
};

describe("formatVideoTime", () => {
  it("formats minutes and hours and safely clamps negative values", () => {
    expect(formatVideoTime(-5)).toBe("0:00");
    expect(formatVideoTime(65.9)).toBe("1:05");
    expect(formatVideoTime(3661)).toBe("1:01:01");
  });
});

describe("notes exports", () => {
  it("creates a deterministic combined Markdown export", () => {
    const markdown = exportNotesAsMarkdown(notes);

    expect(markdown).toContain("# Armbar Fundamentals.mp4");
    expect(markdown).toContain(
      "Drive path: BJJ Library / Armbars / Armbar Fundamentals.mp4",
    );
    expect(markdown).toContain("Progress: 12:34");
    expect(markdown).toContain("- ★ Breaking posture (1:00–2:05)");
    expect(markdown.indexOf("[0:12]")).toBeLessThan(markdown.indexOf("[1:35]"));
    expect(markdown).toContain("## Running notes");
    expect(exportNotesAsMarkdown(notes)).toBe(markdown);
  });

  it("exports either note collection separately", () => {
    const timestamped = exportVideoNotes(notes, {
      format: "markdown",
      scope: "timestamped",
    });
    const running = exportVideoNotes(notes, {
      format: "markdown",
      scope: "running",
    });

    expect(timestamped).toContain("## Timestamped notes");
    expect(timestamped).not.toContain("## Running notes");
    expect(running).toContain("## Running notes");
    expect(running).not.toContain("## Timestamped notes");
    expect(running).not.toContain("Progress:");
  });

  it("creates scoped JSON with a stable order and optional export timestamp", () => {
    const timestamped = JSON.parse(
      exportNotesAsJson(notes, "timestamped", "2026-08-16T12:00:00.000Z"),
    );
    const running = JSON.parse(exportNotesAsJson(notes, "running"));
    const combined = JSON.parse(exportNotesAsJson(notes));

    expect(timestamped.generatedAt).toBe("2026-08-16T12:00:00.000Z");
    expect(timestamped.timestampedNotes.map((note: { id: string }) => note.id)).toEqual([
      "first",
      "later",
    ]);
    expect(timestamped).not.toHaveProperty("runningNotes");
    expect(running).toEqual({ video: notes.video, runningNotes: notes.runningNotes });
    expect(combined.sections).toEqual(notes.sections);
    expect(combined.timestampedNotes[0].id).toBe("first");
  });
});

