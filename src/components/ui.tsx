"use client";

import { AlertCircle, Check, Film, LoaderCircle, RefreshCw, Star } from "lucide-react";
import { useState } from "react";
import { thumbnailUrl } from "@/lib/client-api";
import { formatDuration } from "@/lib/format";

export function LoadingState({ label = "Loading your library…" }: { label?: string }) {
  return (
    <div className="state-card" role="status">
      <span className="state-card__icon state-card__icon--loading">
        <LoaderCircle size={20} />
      </span>
      <div>
        <strong>{label}</strong>
        <p>One moment while things get ready.</p>
      </div>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state-card state-card--error" role="alert">
      <span className="state-card__icon">
        <AlertCircle size={20} />
      </span>
      <div className="state-card__copy">
        <strong>We couldn’t load this</strong>
        <p>{message}</p>
      </div>
      {onRetry ? (
        <button className="button button--secondary" type="button" onClick={onRetry}>
          <RefreshCw size={15} />
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="progress" aria-label={label ?? `${percent}% complete`}>
      <span className="progress__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** A frame from the video itself, with the icon fallback when Drive has none. */
export function Thumbnail({
  videoId,
  progress = 0,
  durationSeconds,
  starred = false,
  completed = false,
}: {
  videoId: string;
  progress?: number;
  durationSeconds?: number;
  starred?: boolean;
  completed?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);

  return (
    <div className="thumb">
      {failed ? (
        <Film size={20} aria-hidden="true" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- proxied Drive frame, not a static asset
        <img
          src={thumbnailUrl(videoId)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
      {starred ? (
        <span className="thumb__star" title="Starred">
          <Star size={11} fill="currentColor" />
        </span>
      ) : null}
      {completed ? (
        <span className="thumb__done" title="Completed">
          <Check size={12} />
        </span>
      ) : null}
      {durationSeconds ? <span className="thumb__duration">{formatDuration(durationSeconds)}</span> : null}
      {percent > 0 && !completed ? (
        <span className="thumb__progress">
          <i style={{ width: `${percent}%` }} />
        </span>
      ) : null}
    </div>
  );
}
