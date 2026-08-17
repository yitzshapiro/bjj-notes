"use client";

import Link from "next/link";
import { LibraryDivision } from "@/lib/client-api";
import { formatDuration } from "@/lib/format";

/** Deep link into a video, optionally at the second a division starts. */
export function studyHref(videoId: string, name: string, seconds?: number | null) {
  const params = new URLSearchParams({ name });
  if (seconds) params.set("t", String(Math.floor(seconds)));
  return `/library/${encodeURIComponent(videoId)}?${params}`;
}

export function DivisionRow({
  division,
  detail,
  actions,
}: {
  division: LibraryDivision;
  detail?: string;
  actions?: React.ReactNode;
}) {
  return (
    <article className={`division-row ${division.focused ? "is-focused" : ""}`}>
      <Link
        className="division-row__main"
        href={studyHref(division.video.id, division.video.name, division.startSeconds)}
      >
        <span className="time-chip">{formatDuration(division.startSeconds)}</span>
        <span className="division-row__text">
          <strong>{division.label}</strong>
          <small>
            {division.video.name}
            {detail ? ` · ${detail}` : ""}
          </small>
        </span>
      </Link>
      <div className="division-row__actions">
        {division.practiceCount > 0 ? (
          <span className="badge" title={`Practiced ${division.practiceCount} times`}>
            ×{division.practiceCount}
          </span>
        ) : null}
        {actions}
      </div>
    </article>
  );
}
