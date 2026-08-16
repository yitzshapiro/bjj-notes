export type NotesExportFormat = "markdown" | "json";
export type NotesExportScope = "combined" | "timestamped" | "running";

export interface ExportTimestampedNote {
  id: string;
  timeSeconds: number;
  text: string;
  starred?: boolean;
  createdAt?: string;
}

export interface ExportSection {
  id: string;
  title: string;
  startSeconds?: number;
  endSeconds?: number;
  starred?: boolean;
}

export interface ExportVideoNotes {
  video: {
    id: string;
    name: string;
    /** Exact Drive folder names followed by the video filename. */
    path: string[];
  };
  playbackPositionSeconds?: number;
  completed?: boolean;
  sections?: ExportSection[];
  timestampedNotes: ExportTimestampedNote[];
  runningNotes: string;
}

export interface NotesExportOptions {
  format: NotesExportFormat;
  scope?: NotesExportScope;
  /** Optional ISO timestamp. Omit it for byte-for-byte deterministic exports. */
  generatedAt?: string;
}

export function formatVideoTime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds]
      .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, "0")))
      .join(":");
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function normalizedTimestampedNotes(
  notes: readonly ExportTimestampedNote[],
): ExportTimestampedNote[] {
  return [...notes].sort(
    (a, b) => a.timeSeconds - b.timeSeconds || a.id.localeCompare(b.id, "en"),
  );
}

function scopedPayload(
  notes: ExportVideoNotes,
  scope: NotesExportScope,
  generatedAt?: string,
) {
  const base = {
    video: notes.video,
    ...(generatedAt ? { generatedAt } : {}),
  };

  if (scope === "timestamped") {
    return {
      ...base,
      timestampedNotes: normalizedTimestampedNotes(notes.timestampedNotes),
    };
  }

  if (scope === "running") {
    return { ...base, runningNotes: notes.runningNotes };
  }

  return {
    ...base,
    playbackPositionSeconds: notes.playbackPositionSeconds,
    completed: notes.completed ?? false,
    sections: notes.sections ?? [],
    timestampedNotes: normalizedTimestampedNotes(notes.timestampedNotes),
    runningNotes: notes.runningNotes,
  };
}

function markdownListText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n/g, "\n  ");
}

export function exportNotesAsMarkdown(
  notes: ExportVideoNotes,
  scope: NotesExportScope = "combined",
  generatedAt?: string,
): string {
  const lines = [
    `# ${notes.video.name}`,
    "",
    `Drive path: ${notes.video.path.join(" / ")}`,
  ];

  if (generatedAt) lines.push(`Exported: ${generatedAt}`);

  if (scope === "combined") {
    lines.push(
      `Progress: ${formatVideoTime(notes.playbackPositionSeconds ?? 0)}`,
      `Completed: ${notes.completed ? "Yes" : "No"}`,
    );

    if ((notes.sections?.length ?? 0) > 0) {
      lines.push("", "## Sections", "");
      for (const section of notes.sections ?? []) {
        const range =
          section.startSeconds === undefined
            ? ""
            : section.endSeconds === undefined
              ? ` (${formatVideoTime(section.startSeconds)})`
              : ` (${formatVideoTime(section.startSeconds)}–${formatVideoTime(section.endSeconds)})`;
        lines.push(`- ${section.starred ? "★ " : ""}${section.title}${range}`);
      }
    }
  }

  if (scope === "combined" || scope === "timestamped") {
    lines.push("", "## Timestamped notes", "");
    const timestampedNotes = normalizedTimestampedNotes(notes.timestampedNotes);
    if (timestampedNotes.length === 0) {
      lines.push("_No timestamped notes._");
    } else {
      for (const note of timestampedNotes) {
        lines.push(
          `- ${note.starred ? "★ " : ""}[${formatVideoTime(note.timeSeconds)}] ${markdownListText(note.text)}`,
        );
      }
    }
  }

  if (scope === "combined" || scope === "running") {
    lines.push(
      "",
      "## Running notes",
      "",
      notes.runningNotes.trim() || "_No running notes._",
    );
  }

  return `${lines.join("\n")}\n`;
}

export function exportNotesAsJson(
  notes: ExportVideoNotes,
  scope: NotesExportScope = "combined",
  generatedAt?: string,
): string {
  return `${JSON.stringify(scopedPayload(notes, scope, generatedAt), null, 2)}\n`;
}

export function exportVideoNotes(
  notes: ExportVideoNotes,
  options: NotesExportOptions,
): string {
  const scope = options.scope ?? "combined";
  return options.format === "markdown"
    ? exportNotesAsMarkdown(notes, scope, options.generatedAt)
    : exportNotesAsJson(notes, scope, options.generatedAt);
}

