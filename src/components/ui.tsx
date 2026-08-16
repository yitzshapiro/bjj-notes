"use client";

import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";

export function LoadingState({ label = "Loading your library…" }: { label?: string }) {
  return (
    <div className="state-card" role="status">
      <span className="state-card__icon state-card__icon--loading">
        <LoaderCircle size={22} />
      </span>
      <div>
        <strong>{label}</strong>
        <p>One moment while Rollbook gets things ready.</p>
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
        <AlertCircle size={22} />
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
