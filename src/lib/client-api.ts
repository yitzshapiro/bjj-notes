export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type VideoStatus = "unwatched" | "in-progress" | "completed";

export type LibraryNode = {
  id: string;
  name: string;
  kind: "folder" | "video";
  parentId: string | null;
  children: LibraryNode[];
  mimeType?: string;
  durationSeconds?: number;
  progressSeconds?: number;
  progress?: number;
  starred?: boolean;
  completed?: boolean;
  updatedAt?: string;
  webViewLink?: string;
};

export type LibraryPayload = {
  root: LibraryNode;
  syncedAt?: string;
};

export type VideoProgress = {
  positionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  starred: boolean;
  updatedAt?: string;
};

export type TimestampNote = {
  id: string;
  timestampSeconds: number;
  body: string;
  createdAt?: string;
  updatedAt?: string;
};

export type StudySection = {
  id: string;
  label: string;
  startSeconds: number;
  endSeconds: number | null;
  starred: boolean;
  focused: boolean;
  presetId?: string | null;
};

export type DivisionPreset = {
  id: string;
  label: string;
  description?: string;
  color?: string | null;
  sortOrder?: number;
};

export type VideoBundle = {
  video: { id: string; name: string; durationSeconds?: number };
  progress: VideoProgress;
  notes: TimestampNote[];
  runningNote: { body: string; updatedAt?: string };
  sections: StudySection[];
};

type UnknownRecord = Record<string, unknown>;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 401) {
    throw new ApiError("Your session has expired. Sign in again to continue.", 401);
  }

  if (!response.ok) {
    const message = await response
      .json()
      .then((body) => (body as { error?: string }).error)
      .catch(() => undefined);
    throw new ApiError(message || "Something went wrong. Please try again.", response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function numberValue(...values: unknown[]) {
  const value = values.find((candidate) => typeof candidate === "number");
  return typeof value === "number" ? value : undefined;
}

function normalizeNode(input: unknown, parentId: string | null = null): LibraryNode {
  const item = record(input);
  const nestedProgress = record(item.progress);
  const rawChildren = Array.isArray(item.children) ? item.children : [];
  const id = String(item.id ?? item.driveId ?? item.fileId ?? "root");
  const mimeType = typeof item.mimeType === "string" ? item.mimeType : undefined;
  const kind =
    item.kind === "folder" || item.type === "folder" || item.itemType === "folder" || mimeType === "application/vnd.google-apps.folder"
      ? "folder"
      : "video";
  const durationSeconds =
    numberValue(item.durationSeconds, item.duration, item.videoDuration) ??
    (typeof item.durationMs === "number" ? item.durationMs / 1000 : undefined);
  const progressSeconds = numberValue(
    item.progressSeconds,
    item.positionSeconds,
    item.lastPositionSeconds,
    nestedProgress.positionSeconds,
  );
  const normalizedProgress = numberValue(item.progress, nestedProgress.ratio);

  return {
    id,
    name: String(item.name ?? item.title ?? (id === "root" ? "My instructionals" : "Untitled")),
    kind,
    parentId: typeof item.parentId === "string" ? item.parentId : parentId,
    children: rawChildren.map((child) => normalizeNode(child, id)),
    mimeType,
    durationSeconds,
    progressSeconds,
    progress:
      normalizedProgress ??
      (durationSeconds && progressSeconds ? Math.min(1, progressSeconds / durationSeconds) : 0),
    starred: Boolean(item.starred ?? item.isStarred ?? nestedProgress.starred),
    completed: Boolean(item.completed ?? item.isCompleted ?? nestedProgress.completed),
    updatedAt:
      typeof item.updatedAt === "string"
        ? item.updatedAt
        : typeof nestedProgress.updatedAt === "string"
          ? nestedProgress.updatedAt
          : undefined,
    webViewLink: typeof item.webViewLink === "string" ? item.webViewLink : undefined,
  };
}

export function normalizeLibrary(input: unknown): LibraryPayload {
  const payload = record(input);
  const candidate = payload.root ?? payload.tree ?? payload.library;
  if (candidate) {
  return {
    root: normalizeNode(candidate),
      syncedAt:
        typeof payload.syncedAt === "string"
          ? payload.syncedAt
          : typeof payload.lastSyncedAt === "string"
            ? payload.lastSyncedAt
            : undefined,
    };
  }

  const flatItems = Array.isArray(payload.items) ? payload.items : Array.isArray(input) ? input : [];
  if (flatItems.length === 1) {
    const onlyNode = normalizeNode(flatItems[0]);
    if (onlyNode.kind === "folder") {
      return {
        root: onlyNode,
        syncedAt:
          typeof payload.lastSyncedAt === "string"
            ? payload.lastSyncedAt
            : typeof payload.syncedAt === "string"
              ? payload.syncedAt
              : undefined,
      };
    }
  }
  const nodes = new Map<string, LibraryNode>();
  for (const raw of flatItems) {
    const node = normalizeNode(raw);
    nodes.set(node.id, node);
  }
  const children: LibraryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else children.push(node);
  }
  return {
    root: { id: "root", name: "My instructionals", kind: "folder", parentId: null, children },
    syncedAt:
      typeof payload.lastSyncedAt === "string"
        ? payload.lastSyncedAt
        : typeof payload.syncedAt === "string"
          ? payload.syncedAt
          : undefined,
  };
}

export const api = {
  async library() {
    return normalizeLibrary(await request<unknown>("/api/library"));
  },
  sync() {
    return request<unknown>("/api/library/sync", { method: "POST" });
  },
  video(videoId: string) {
    return request<VideoBundle>(`/api/videos/${encodeURIComponent(videoId)}`);
  },
  progress(videoId: string) {
    return request<{ progress: VideoProgress }>(`/api/videos/${encodeURIComponent(videoId)}/progress`).then(
      ({ progress }) => progress,
    );
  },
  saveProgress(videoId: string, progress: Partial<VideoProgress>) {
    return request<{ progress: VideoProgress }>(`/api/videos/${encodeURIComponent(videoId)}/progress`, {
      method: "PUT",
      body: JSON.stringify(progress),
    }).then(({ progress: saved }) => saved);
  },
  notes(videoId: string) {
    return request<{ notes: TimestampNote[] }>(`/api/videos/${encodeURIComponent(videoId)}/notes`).then(
      ({ notes }) => notes,
    );
  },
  saveNote(videoId: string, note: Partial<TimestampNote>) {
    const path = note.id
      ? `/api/videos/${encodeURIComponent(videoId)}/notes/${encodeURIComponent(note.id)}`
      : `/api/videos/${encodeURIComponent(videoId)}/notes`;
    return request<{ note: TimestampNote }>(path, {
      method: note.id ? "PATCH" : "POST",
      body: JSON.stringify({ timestampSeconds: note.timestampSeconds, body: note.body }),
    }).then(({ note: saved }) => saved);
  },
  deleteNote(videoId: string, id: string) {
    return request<void>(
      `/api/videos/${encodeURIComponent(videoId)}/notes/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  },
  runningNote(videoId: string) {
    return request<{ runningNote: { body: string; updatedAt?: string } }>(
      `/api/videos/${encodeURIComponent(videoId)}/running-note`,
    ).then(({ runningNote }) => runningNote);
  },
  saveRunningNote(videoId: string, body: string) {
    return request<{ runningNote: { body: string; updatedAt?: string } }>(
      `/api/videos/${encodeURIComponent(videoId)}/running-note`,
      { method: "PUT", body: JSON.stringify({ body }) },
    ).then(({ runningNote }) => runningNote);
  },
  sections(videoId: string) {
    return request<{ sections: StudySection[] }>(`/api/videos/${encodeURIComponent(videoId)}/sections`).then(
      ({ sections }) => sections,
    );
  },
  saveSection(videoId: string, section: Partial<StudySection>) {
    const path = section.id
      ? `/api/sections/${encodeURIComponent(section.id)}`
      : `/api/videos/${encodeURIComponent(videoId)}/sections`;
    return request<{ section: StudySection }>(path, {
      method: section.id ? "PATCH" : "POST",
      body: JSON.stringify({
        label: section.label,
        startSeconds: section.startSeconds,
        endSeconds: section.endSeconds,
        presetId: section.presetId,
        starred: section.starred,
        focused: section.focused,
      }),
    }).then(({ section: saved }) => saved);
  },
  deleteSection(videoId: string, id: string) {
    void videoId;
    return request<void>(`/api/sections/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  presets() {
    return request<{ presets: DivisionPreset[] }>("/api/presets").then(({ presets }) => presets);
  },
  savePreset(preset: Partial<DivisionPreset>) {
    return request<{ preset: DivisionPreset }>(preset.id ? `/api/presets/${encodeURIComponent(preset.id)}` : "/api/presets", {
      method: preset.id ? "PATCH" : "POST",
      body: JSON.stringify({ label: preset.label, color: preset.color, sortOrder: preset.sortOrder }),
    }).then(({ preset: saved }) => saved);
  },
  deletePreset(id: string) {
    return request<void>(`/api/presets/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

export function videoStatus(node: LibraryNode): VideoStatus {
  if (node.completed || (node.progress ?? 0) >= 0.95) return "completed";
  if ((node.progress ?? 0) > 0 || (node.progressSeconds ?? 0) > 0) return "in-progress";
  return "unwatched";
}
