import { describe, expect, it } from "vitest";

import {
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  buildDriveTree,
  type DriveItem,
} from "./tree";

const folder = (
  id: string,
  name: string,
  parentId: string | null,
): DriveItem => ({
  id,
  name,
  parentId,
  mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
});

const video = (id: string, name: string, parentId: string): DriveItem => ({
  id,
  name,
  parentId,
  mimeType: "video/mp4",
});

describe("buildDriveTree", () => {
  it("preserves the exact hierarchy and deterministically sorts folders first", () => {
    const items: DriveItem[] = [
      video("v10", "Lesson 10.mp4", "guard"),
      folder("unrelated", "Other Library", null),
      folder("guard", "01 - Guard Retention", "root"),
      video("v2", "Lesson 2.mp4", "guard"),
      folder("root", "BJJ Library", null),
      video("intro", "00 Intro.mp4", "root"),
      folder("passing", "02 - Passing", "root"),
      {
        id: "pdf",
        name: "Course notes.pdf",
        parentId: "root",
        mimeType: "application/pdf",
      },
    ];

    const tree = buildDriveTree(items, "root");

    expect(tree.path).toEqual(["BJJ Library"]);
    expect(tree.children.map((node) => node.name)).toEqual([
      "01 - Guard Retention",
      "02 - Passing",
      "00 Intro.mp4",
    ]);
    expect(tree.children[0]?.children.map((node) => node.name)).toEqual([
      "Lesson 2.mp4",
      "Lesson 10.mp4",
    ]);
    expect(tree.children[0]?.children[0]?.path).toEqual([
      "BJJ Library",
      "01 - Guard Retention",
      "Lesson 2.mp4",
    ]);
    expect(JSON.stringify(tree)).not.toContain("Course notes.pdf");
    expect(JSON.stringify(tree)).not.toContain("Other Library");
  });

  it("rejects missing, non-folder, and duplicate roots", () => {
    expect(() => buildDriveTree([], "missing")).toThrow(
      "Drive root folder not found: missing",
    );
    expect(() => buildDriveTree([video("root", "video.mp4", "parent")], "root"))
      .toThrow("Drive root is not a folder: root");
    expect(() =>
      buildDriveTree(
        [folder("root", "Library", null), folder("root", "Copy", null)],
        "root",
      ),
    ).toThrow("Duplicate Drive item id: root");
  });

  it("detects a malformed reachable cycle", () => {
    const root = folder("root", "Library", "child");
    const child = folder("child", "Loop", "root");

    expect(() => buildDriveTree([root, child], "root")).toThrow(
      "Cycle detected in Drive hierarchy at: root",
    );
  });
});

