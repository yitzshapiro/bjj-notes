"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  Folder,
  FolderOpen,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Target,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  LibraryDivision,
  LibraryNode,
  LibraryPayload,
  videoStatus,
  VideoStatus,
} from "@/lib/client-api";
import { formatDate, formatFocusAge, formatPercent } from "@/lib/format";
import { AppHeader } from "./app-header";
import { DivisionRow, studyHref } from "./division-row";
import { ErrorState, LoadingState, ProgressBar, Thumbnail } from "./ui";

type Filter = "all" | VideoStatus | "starred";

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "in-progress", label: "In progress" },
  { id: "unwatched", label: "Unwatched" },
  { id: "completed", label: "Completed" },
  { id: "starred", label: "Starred" },
];

const statusLabels: Record<VideoStatus, string> = {
  "in-progress": "In progress",
  completed: "Completed",
  unwatched: "Unwatched",
};

function flatten(node: LibraryNode): LibraryNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

function folderPath(root: LibraryNode, id: string): LibraryNode[] {
  if (root.id === id) return [root];
  for (const child of root.children) {
    if (child.kind !== "folder") continue;
    const match = folderPath(child, id);
    if (match.length) return [root, ...match];
  }
  return [];
}

function matchesFilter(node: LibraryNode, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "starred") return Boolean(node.starred);
  return videoStatus(node) === filter;
}

function TreeBranch({
  node,
  activeId,
  onSelect,
  depth = 0,
}: {
  node: LibraryNode;
  activeId: string;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth < 1 || node.id === activeId);
  const folders = node.children.filter((child) => child.kind === "folder");

  return (
    <li>
      <div className={`tree-row ${activeId === node.id ? "is-active" : ""}`}>
        {folders.length ? (
          <button
            className="tree-row__toggle"
            type="button"
            aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="tree-row__spacer" />
        )}
        <button className="tree-row__label" type="button" onClick={() => onSelect(node.id)}>
          {open ? <FolderOpen size={15} /> : <Folder size={15} />}
          <span className="truncate">{node.name}</span>
        </button>
      </div>
      {open && folders.length ? (
        <ul className="tree-list tree-list--nested">
          {folders.map((child) => (
            <TreeBranch
              key={child.id}
              node={child}
              activeId={activeId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function VideoCard({ node }: { node: LibraryNode }) {
  const progress = node.progress ?? 0;
  const status = videoStatus(node);

  return (
    <Link className="video-card" href={studyHref(node.id, node.name)}>
      <Thumbnail
        videoId={node.id}
        progress={progress}
        durationSeconds={node.durationSeconds}
        starred={node.starred}
        completed={status === "completed"}
      />
      <div className="video-card__body">
        <h3>{node.name}</h3>
        <p className="meta-line">
          <span>{statusLabels[status]}</span>
          {status === "in-progress" ? (
            <>
              <span className="dot">·</span>
              <span>{formatPercent(progress)}</span>
            </>
          ) : null}
          <span className="dot">·</span>
          <span>{formatDate(node.updatedAt)}</span>
        </p>
      </div>
    </Link>
  );
}

export function LibraryClient() {
  const router = useRouter();
  const [library, setLibrary] = useState<LibraryPayload | null>(null);
  const [divisions, setDivisions] = useState<LibraryDivision[]>([]);
  const [activeFolderId, setActiveFolderId] = useState("root");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextLibrary, nextDivisions] = await Promise.all([
        api.library(),
        api.divisions("all").catch(() => ({ sections: [] as LibraryDivision[] })),
      ]);
      setLibrary(nextLibrary);
      setDivisions(nextDivisions.sections);
      setActiveFolderId((current) =>
        flatten(nextLibrary.root).some((node) => node.id === current) ? current : nextLibrary.root.id,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your library could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial data comes from the authenticated client API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await api.sync();
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) router.replace("/");
      else setError(caught instanceof Error ? caught.message : "Sync failed. Please try again.");
    } finally {
      setSyncing(false);
    }
  };

  const allNodes = useMemo(() => (library ? flatten(library.root) : []), [library]);
  const activeFolder = allNodes.find((node) => node.id === activeFolderId) ?? library?.root;
  const activePath = library && activeFolder ? folderPath(library.root, activeFolder.id) : [];
  const searching = query.trim().length > 0;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesQuery = (name: string) => name.toLocaleLowerCase().includes(normalizedQuery);

  // Starred is a library-wide view: what is starred matters more than where it sits.
  const starredView = filter === "starred";
  const starredVideos = allNodes.filter(
    (node) => node.kind === "video" && node.starred && matchesQuery(node.name),
  );
  const starredDivisions = divisions.filter(
    (division) =>
      division.starred && (matchesQuery(division.label) || matchesQuery(division.video.name)),
  );
  const focusDivisions = divisions.filter((division) => division.focused);

  const videos = (searching ? allNodes : (activeFolder?.children ?? []))
    .filter((node) => node.kind === "video")
    .filter((node) => matchesQuery(node.name))
    .filter((node) => matchesFilter(node, filter));
  const childFolders =
    searching || starredView
      ? []
      : (activeFolder?.children ?? []).filter((node) => node.kind === "folder");

  const inProgress = allNodes
    .filter((node) => node.kind === "video" && videoStatus(node) === "in-progress")
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const resume = inProgress[0];
  const totalVideos = allNodes.filter((node) => node.kind === "video").length;
  const completedVideos = allNodes.filter(
    (node) => node.kind === "video" && videoStatus(node) === "completed",
  ).length;

  const header = (
    <AppHeader
      trailing={
        <button className="button button--secondary" type="button" onClick={sync} disabled={syncing}>
          <RefreshCw className={syncing ? "spin" : ""} size={15} />
          <span className="desktop-only">{syncing ? "Syncing…" : "Sync Drive"}</span>
        </button>
      }
    />
  );

  // The folder sidebar fills the grid's first column, so stay single-column
  // until there is a tree to put in it.
  if (loading || !library) {
    return (
      <div className="app-page">
        {header}
        <div className="centered-state">
          {loading ? (
            <LoadingState />
          ) : (
            <ErrorState message={error ?? "Your library could not be loaded."} onRetry={load} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-page">
      {header}
      <div className="library-layout">
        <aside className="library-sidebar" aria-label="Drive folders">
          <div className="eyebrow">Google Drive</div>
          <ul className="tree-list">
            <TreeBranch node={library.root} activeId={activeFolderId} onSelect={setActiveFolderId} />
          </ul>
          <div className="sidebar-sync">
            <Cloud size={15} />
            <span>
              <strong>Drive connected</strong>
              <small>{library.syncedAt ? `Synced ${formatDate(library.syncedAt)}` : "Ready to sync"}</small>
            </span>
          </div>
        </aside>

        <main className="library-main">
          {error ? <ErrorState message={error} onRetry={load} /> : null}
          <section className="page-head">
            <div>
              <h1>Library</h1>
              <p>Videos from your selected Google Drive folder.</p>
            </div>
            {totalVideos ? (
              <div className="head-stats">
                <div>
                  <strong>
                    {completedVideos}/{totalVideos}
                  </strong>
                  <small>completed</small>
                </div>
                <div>
                  <strong>{focusDivisions.length}</strong>
                  <small>in focus</small>
                </div>
              </div>
            ) : null}
          </section>

          {resume ? (
            <Link className="resume-card" href={studyHref(resume.id, resume.name)}>
              <Thumbnail
                videoId={resume.id}
                progress={resume.progress ?? 0}
                durationSeconds={resume.durationSeconds}
                starred={resume.starred}
              />
              <div className="resume-card__copy">
                <span className="eyebrow">Resume</span>
                <h2 className="truncate">{resume.name}</h2>
                <div className="resume-card__progress">
                  <ProgressBar value={resume.progress ?? 0} />
                  <span>{formatPercent(resume.progress)}</span>
                </div>
              </div>
              <span className="button button--primary">
                <Play size={15} /> Continue
              </span>
            </Link>
          ) : null}

          {focusDivisions.length ? (
            <section className="focus-strip" aria-label="This week’s focus">
              <span className="focus-strip__label">
                <Target size={15} /> This week
              </span>
              <div className="focus-strip__items">
                {focusDivisions.slice(0, 6).map((division) => (
                  <Link
                    key={division.id}
                    className="focus-chip"
                    href={studyHref(division.video.id, division.video.name, division.startSeconds)}
                    title={`${division.video.name} · ${formatFocusAge(division.focusAddedAt)}`}
                  >
                    {division.label}
                  </Link>
                ))}
              </div>
              <Link href="/focus">
                Focus board <ChevronRight size={14} />
              </Link>
            </section>
          ) : null}

          <section className="library-browser">
            <div className="browser-toolbar">
              <label className="search-field">
                <Search size={16} />
                <span className="sr-only">Search videos</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search your library"
                />
                {query ? (
                  <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                    <X size={14} />
                  </button>
                ) : null}
              </label>
              <div className="filter-pills" aria-label="Filter videos">
                {filters.map((item) => (
                  <button
                    key={item.id}
                    className={filter === item.id ? "is-active" : ""}
                    type="button"
                    onClick={() => setFilter(item.id)}
                  >
                    {item.id === "starred" ? <Star size={13} /> : null}
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {starredView ? (
              <>
                <p className="search-summary">Everything starred, across your whole library.</p>

                {starredVideos.length ? (
                  <>
                    <div className="group-head">
                      <h2>Videos</h2>
                      <span>{starredVideos.length}</span>
                    </div>
                    <div className="video-grid">
                      {starredVideos.map((video) => (
                        <VideoCard key={video.id} node={video} />
                      ))}
                    </div>
                  </>
                ) : null}

                {starredDivisions.length ? (
                  <>
                    <div className="group-head">
                      <h2>Divisions</h2>
                      <span>{starredDivisions.length}</span>
                    </div>
                    <div className="division-list">
                      {starredDivisions.map((division) => (
                        <DivisionRow
                          key={division.id}
                          division={division}
                          detail={division.focused ? "In focus" : undefined}
                        />
                      ))}
                    </div>
                  </>
                ) : null}

                {!starredVideos.length && !starredDivisions.length ? (
                  <div className="empty-state">
                    <span>
                      <Star size={20} />
                    </span>
                    <h2>Nothing starred yet</h2>
                    <p>Star a video or a division while studying and it shows up here.</p>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {!searching ? (
                  <nav className="breadcrumbs" aria-label="Folder path">
                    {activePath.map((node, index) => (
                      <span key={node.id}>
                        {index ? <ChevronRight size={13} /> : null}
                        <button
                          type="button"
                          onClick={() => setActiveFolderId(node.id)}
                          aria-current={index === activePath.length - 1 ? "page" : undefined}
                        >
                          {node.name}
                        </button>
                      </span>
                    ))}
                  </nav>
                ) : (
                  <p className="search-summary">Results across your full Drive hierarchy</p>
                )}

                {childFolders.length ? (
                  <div className="folder-grid">
                    {childFolders.map((folder) => (
                      <button
                        key={folder.id}
                        className="folder-card"
                        type="button"
                        onClick={() => setActiveFolderId(folder.id)}
                      >
                        <Folder size={16} />
                        <strong>{folder.name}</strong>
                        <small>{folder.children.length}</small>
                      </button>
                    ))}
                  </div>
                ) : null}

                {videos.length ? (
                  <div className="video-grid">
                    {videos.map((video) => (
                      <VideoCard key={video.id} node={video} />
                    ))}
                  </div>
                ) : null}

                {!childFolders.length && !videos.length ? (
                  <div className="empty-state">
                    <span>
                      <Sparkles size={20} />
                    </span>
                    <h2>{totalVideos ? "No matches" : "No videos synced"}</h2>
                    <p>
                      {totalVideos
                        ? "Change the filter, search, or folder."
                        : "Sync the selected Google Drive folder."}
                    </p>
                    {!totalVideos ? (
                      <button className="button button--primary" type="button" onClick={sync}>
                        <RefreshCw size={15} /> Sync Drive
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
