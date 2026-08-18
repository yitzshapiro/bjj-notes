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
  focusAddedAt?: string | null;
  practiceCount: number;
  lastPracticedAt?: string | null;
  presetId?: string | null;
  /** Non-null when this division is in My Game. Absent from write responses. */
  gameEntryId?: string | null;
};

/** A division plus the video it lives in, for views that span the whole library. */
export type LibraryDivision = StudySection & {
  videoId: string;
  video: { id: string; name: string; path: string[]; durationMs: number | null };
};

export type DivisionScope = "all" | "focus" | "practiced" | "starred";

export type DivisionTotals = {
  focused: number;
  practiced: number;
  starred: number;
  reps: number;
};

export type SectionChanges = Partial<StudySection> & { markPracticed?: boolean };

export type DivisionPreset = {
  id: string;
  label: string;
  description?: string;
  color?: string | null;
  sortOrder?: number;
};

/** One video you have watched, as listed in the history view. */
export type HistoryEntry = {
  videoId: string;
  name: string;
  path: string[];
  positionSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
  starred: boolean;
  lastWatchedAt: string;
  progress: number;
  noteCount: number;
  divisionCount: number;
};

export type HistoryScope = "all" | "in-progress" | "completed" | "starred";

export type HistoryPayload = {
  cutoff: string;
  maxAgeDays: number;
  totals: { watched: number; completed: number; seconds: number };
  entries: HistoryEntry[];
};

export type HitContext = "drilling" | "positional" | "live" | "competition";

export type GameHit = {
  id: string;
  entryId: string;
  hitAt: string;
  context: HitContext;
  note: string | null;
};

/** A technique you have claimed, with every occasion it actually worked. */
export type GameEntry = {
  id: string;
  sectionId: string | null;
  videoId: string;
  label: string;
  startSeconds: number;
  note: string | null;
  addedAt: string;
  video: { id: string; name: string; path: string[] };
  practiceCount: number;
  focused: boolean;
  starred: boolean;
  hits: GameHit[];
};

export type TagKind = "position" | "phase" | "technique";

export type LibraryTag = {
  id: string;
  slug: string;
  kind: TagKind;
  label: string;
  sortOrder: number;
  count: number;
};

export type DivisionTag = {
  slug: string;
  label: string;
  kind: TagKind;
  confidence: number;
  source: "auto" | "manual";
};

/** A division anywhere in the library, with its tags and practice state. */
export type BrowsedDivision = StudySection & {
  videoId: string;
  video: { id: string; name: string; path: string[] };
  tags: DivisionTag[];
  /** Non-null when this division is already in My Game. */
  gameEntryId: string | null;
};

export type DivisionScopeFilter = "all" | "focus" | "starred" | "practiced" | "untouched";

export type DivisionSearch = {
  divisions: BrowsedDivision[];
  total: number;
  limit: number;
  offset: number;
};

export type StepRole = "entry" | "control" | "attack" | "recovery" | "concept";

/** One division inside a plan stage, joined to its live practice state. */
export type PlanStep = {
  id: string;
  stageId: string;
  sectionId: string | null;
  videoId: string;
  label: string;
  startSeconds: number;
  endSeconds: number | null;
  role: StepRole;
  note: string | null;
  sortOrder: number;
  video: { id: string; name: string; path: string[] };
  gameEntryId: string | null;
  practiceCount: number;
  lastPracticedAt: string | null;
  focused: boolean;
  starred: boolean;
};

export type PlanStage = {
  id: string;
  planId: string;
  name: string;
  intent: string | null;
  matTest: string | null;
  timeframe: string | null;
  sortOrder: number;
  steps: PlanStep[];
};

export type GamePlan = {
  id: string;
  slug: string;
  name: string;
  goal: string | null;
  sortOrder: number;
};

export type GamePlanSummary = GamePlan & {
  stageCount: number;
  stepCount: number;
  drilledCount: number;
  reps: number;
};

export type PlanTotals = { steps: number; drilled: number; focused: number; reps: number };

export type PlanDetail = { plan: GamePlan; stages: PlanStage[]; totals: PlanTotals };

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
  divisions(scope: DivisionScope = "all") {
    return request<{ sections: LibraryDivision[]; totals: DivisionTotals }>(
      `/api/sections?scope=${encodeURIComponent(scope)}`,
    );
  },
  saveSection(videoId: string, section: SectionChanges) {
    const path = section.id
      ? `/api/sections/${encodeURIComponent(section.id)}`
      : `/api/videos/${encodeURIComponent(videoId)}/sections`;
    const writable = [
      "label",
      "startSeconds",
      "endSeconds",
      "presetId",
      "starred",
      "focused",
      "markPracticed",
    ] as const;
    const body = Object.fromEntries(
      writable.filter((key) => section[key] !== undefined).map((key) => [key, section[key]]),
    );
    return request<{ section: StudySection }>(path, {
      method: section.id ? "PATCH" : "POST",
      body: JSON.stringify(body),
    }).then(({ section: saved }) => saved);
  },
  deleteSection(videoId: string, id: string) {
    void videoId;
    return request<void>(`/api/sections/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  tags() {
    return request<{ tags: LibraryTag[] }>("/api/tags").then(({ tags }) => tags);
  },
  history(scope: HistoryScope = "all") {
    const params = new URLSearchParams();
    if (scope !== "all") params.set("scope", scope);
    return request<HistoryPayload>(`/api/history?${params}`);
  },
  game() {
    return request<{ entries: GameEntry[] }>("/api/game").then(({ entries }) => entries);
  },
  addToGame(sectionId: string) {
    return request<{ entry: GameEntry; created: boolean }>("/api/game", {
      method: "POST",
      body: JSON.stringify({ sectionId }),
    });
  },
  removeFromGame(sectionId: string) {
    return request<{ deleted: boolean }>(`/api/game?sectionId=${encodeURIComponent(sectionId)}`, {
      method: "DELETE",
    });
  },
  logHit(entryId: string, options: { context?: HitContext; note?: string } = {}) {
    return request<{ hit: GameHit }>(`/api/game/${encodeURIComponent(entryId)}/hits`, {
      method: "POST",
      body: JSON.stringify({ context: options.context ?? "live", note: options.note }),
    }).then(({ hit }) => hit);
  },
  undoHit(entryId: string) {
    return request<{ deleted: boolean; id: string }>(
      `/api/game/${encodeURIComponent(entryId)}/hits`,
      { method: "DELETE" },
    );
  },
  searchDivisions(options: {
    q?: string;
    tags?: string[];
    scope?: DivisionScopeFilter;
    limit?: number;
    offset?: number;
  }) {
    const params = new URLSearchParams();
    if (options.q) params.set("q", options.q);
    if (options.tags?.length) params.set("tags", options.tags.join(","));
    if (options.scope && options.scope !== "all") params.set("scope", options.scope);
    if (options.limit) params.set("limit", String(options.limit));
    if (options.offset) params.set("offset", String(options.offset));
    return request<DivisionSearch>(`/api/divisions?${params}`);
  },
  plans() {
    return request<{ plans: GamePlanSummary[] }>("/api/plans").then(({ plans }) => plans);
  },
  plan(idOrSlug: string) {
    return request<PlanDetail>(`/api/plans/${encodeURIComponent(idOrSlug)}`);
  },
  focusStage(planIdOrSlug: string, stageId: string, focused: boolean) {
    return request<{ updated: number; focused: boolean }>(
      `/api/plans/${encodeURIComponent(planIdOrSlug)}/focus`,
      { method: "PUT", body: JSON.stringify({ stageId, focused }) },
    );
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

/** Server-proxied frame from the video, since Drive's own link needs an access token. */
export function thumbnailUrl(videoId: string) {
  return `/api/videos/${encodeURIComponent(videoId)}/thumbnail`;
}

export function videoStatus(node: LibraryNode): VideoStatus {
  if (node.completed || (node.progress ?? 0) >= 0.95) return "completed";
  if ((node.progress ?? 0) > 0 || (node.progressSeconds ?? 0) > 0) return "in-progress";
  return "unwatched";
}
