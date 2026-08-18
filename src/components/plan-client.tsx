"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ClipboardList, Map, Repeat, Target } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, GamePlanSummary, PlanDetail, PlanStage, PlanStep, StepRole } from "@/lib/client-api";
import { formatDay, formatDuration } from "@/lib/format";
import { AppHeader } from "./app-header";
import { studyHref } from "./division-row";
import { ErrorState, LoadingState } from "./ui";

const ROLE_LABEL: Record<StepRole, string> = {
  entry: "Entry",
  control: "Control",
  attack: "Attack",
  recovery: "Recovery",
  concept: "Concept",
};

/** A concept is watched once; everything else is drilled and counted. */
function isDrillable(step: PlanStep) {
  return step.role !== "concept";
}

function StepRow({
  step,
  busy,
  onPractice,
  onFocus,
}: {
  step: PlanStep;
  busy: boolean;
  onPractice: () => void;
  onFocus: () => void;
}) {
  const detail = step.lastPracticedAt
    ? `Practiced ${formatDay(step.lastPracticedAt)}`
    : step.video.name;

  return (
    <article className={`plan-step ${step.focused ? "is-focused" : ""} plan-step--${step.role}`}>
      <Link
        className="plan-step__main"
        href={studyHref(step.videoId, step.video.name, step.startSeconds)}
      >
        <span className="time-chip">{formatDuration(step.startSeconds)}</span>
        <span className="plan-step__text">
          <strong title={step.label}>{step.label}</strong>
          <small title={step.video.name}>{detail}</small>
        </span>
      </Link>
      <div className="plan-step__actions">
        <span className={`role-pill role-pill--${step.role}`}>{ROLE_LABEL[step.role]}</span>
        {step.practiceCount > 0 ? (
          <span className="badge" title={`Practiced ${step.practiceCount} times`}>
            ×{step.practiceCount}
          </span>
        ) : null}
        {step.sectionId ? (
          <>
            <button
              className={`icon-button icon-button--small ${step.focused ? "is-focused" : ""}`}
              type="button"
              disabled={busy}
              aria-label={step.focused ? `Remove ${step.label} from focus` : `Add ${step.label} to focus`}
              aria-pressed={step.focused}
              title={step.focused ? "Remove from focus" : "Add to focus"}
              onClick={onFocus}
            >
              <Target size={14} />
            </button>
            {isDrillable(step) ? (
              <button
                className="icon-button icon-button--small"
                type="button"
                disabled={busy}
                aria-label={`Mark ${step.label} practiced`}
                title="Mark practiced"
                onClick={onPractice}
              >
                <Check size={14} />
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  );
}

function StageCard({
  stage,
  index,
  busyId,
  onStep,
  onFocusStage,
}: {
  stage: PlanStage;
  index: number;
  busyId: string | null;
  onStep: (step: PlanStep, changes: { focused?: boolean; markPracticed?: boolean }) => void;
  onFocusStage: (stage: PlanStage, focused: boolean) => void;
}) {
  const drillable = stage.steps.filter(isDrillable);
  const drilled = drillable.filter((step) => step.practiceCount > 0).length;
  const allFocused = stage.steps.every((step) => step.focused || !step.sectionId);
  const complete = drillable.length > 0 && drilled === drillable.length;

  return (
    <section className={`plan-stage ${complete ? "is-complete" : ""}`}>
      <header className="plan-stage__head">
        <span className="plan-stage__num" aria-hidden="true">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="plan-stage__title">
          <h2>{stage.name}</h2>
          {stage.timeframe ? <span className="eyebrow">{stage.timeframe}</span> : null}
        </div>
        <div className="plan-stage__meta">
          <span className="badge" title={`${drilled} of ${drillable.length} drilled`}>
            {drilled}/{drillable.length}
          </span>
          <button
            className="button button--secondary"
            type="button"
            disabled={busyId === stage.id}
            onClick={() => onFocusStage(stage, !allFocused)}
          >
            <Target size={14} />
            {allFocused ? "Clear focus" : "Focus stage"}
          </button>
        </div>
      </header>

      {stage.intent ? <p className="plan-stage__intent">{stage.intent}</p> : null}

      <div className="plan-step-list">
        {stage.steps.map((step) => (
          <StepRow
            key={step.id}
            step={step}
            busy={busyId === step.id}
            onPractice={() => onStep(step, { markPracticed: true })}
            onFocus={() => onStep(step, { focused: !step.focused })}
          />
        ))}
      </div>

      {stage.matTest ? (
        <p className="mat-test">
          <strong>Mat test</strong>
          {stage.matTest}
        </p>
      ) : null}
    </section>
  );
}

export function PlanDetailClient({ slug }: { slug: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.plan(slug));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) router.replace("/");
      else setError(caught instanceof Error ? caught.message : "This plan could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [router, slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const applyStep = (stepId: string, changes: Partial<PlanStep>) => {
    setDetail((current) =>
      current
        ? {
            ...current,
            stages: current.stages.map((stage) => ({
              ...stage,
              steps: stage.steps.map((step) => (step.id === stepId ? { ...step, ...changes } : step)),
            })),
          }
        : current,
    );
  };

  const onStep = async (step: PlanStep, changes: { focused?: boolean; markPracticed?: boolean }) => {
    if (!step.sectionId) return;
    setBusyId(step.id);
    try {
      const saved = await api.saveSection(step.videoId, { id: step.sectionId, ...changes });
      applyStep(step.id, {
        practiceCount: saved.practiceCount,
        lastPracticedAt: saved.lastPracticedAt ?? null,
        focused: saved.focused,
        starred: saved.starred,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That change could not be saved.");
    } finally {
      setBusyId(null);
    }
  };

  const onFocusStage = async (stage: PlanStage, focused: boolean) => {
    setBusyId(stage.id);
    try {
      await api.focusStage(slug, stage.id, focused);
      setDetail((current) =>
        current
          ? {
              ...current,
              stages: current.stages.map((item) =>
                item.id === stage.id
                  ? {
                      ...item,
                      steps: item.steps.map((step) =>
                        step.sectionId ? { ...step, focused } : step,
                      ),
                    }
                  : item,
              ),
            }
          : current,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The stage could not be updated.");
    } finally {
      setBusyId(null);
    }
  };

  const totals = detail?.totals;
  const drillableTotal =
    detail?.stages.flatMap((stage) => stage.steps).filter(isDrillable).length ?? 0;
  const drilledTotal =
    detail?.stages
      .flatMap((stage) => stage.steps)
      .filter((step) => isDrillable(step) && step.practiceCount > 0).length ?? 0;

  return (
    <div className="app-page">
      <AppHeader />
      <main className="focus-main">
        {loading ? <LoadingState label="Loading your game plan…" /> : null}
        {!loading && error && !detail ? <ErrorState message={error} onRetry={load} /> : null}
        {!loading && detail ? (
          <>
            <div className="page-head">
              <div>
                <Link className="plan-back" href="/plans">
                  ← All plans
                </Link>
                <h1>{detail.plan.name}</h1>
                {detail.plan.goal ? <p>{detail.plan.goal}</p> : null}
              </div>
            </div>

            <div className="focus-stats">
              <div className="stat-card">
                <strong>
                  {drilledTotal}/{drillableTotal}
                </strong>
                <small>techniques drilled</small>
              </div>
              <div className="stat-card">
                <strong>{totals?.focused ?? 0}</strong>
                <small>in focus now</small>
              </div>
              <div className="stat-card">
                <strong>{totals?.reps ?? 0}</strong>
                <small>reps logged</small>
              </div>
            </div>

            {error ? (
              <div className="plan-inline-error" role="alert">
                {error}
              </div>
            ) : null}

            <div className="plan-stages">
              {detail.stages.map((stage, index) => (
                <StageCard
                  key={stage.id}
                  stage={stage}
                  index={index}
                  busyId={busyId}
                  onStep={onStep}
                  onFocusStage={onFocusStage}
                />
              ))}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

export function PlansClient() {
  const router = useRouter();
  const [plans, setPlans] = useState<GamePlanSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPlans(await api.plans());
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) router.replace("/");
      else setError(caught instanceof Error ? caught.message : "Your plans could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="app-page">
      <AppHeader />
      <main className="focus-main">
        {loading ? <LoadingState label="Loading your game plans…" /> : null}
        {!loading && error ? <ErrorState message={error} onRetry={load} /> : null}
        {!loading && !error ? (
          <>
            <div className="page-head">
              <div>
                <h1>Game plans</h1>
                <p>A named route through the library, built from divisions you already have.</p>
              </div>
            </div>

            {plans.length ? (
              <div className="plan-card-list">
                {plans.map((plan) => (
                  <Link className="plan-card" key={plan.id} href={`/plans/${plan.slug}`}>
                    <span className="plan-card__icon">
                      <Map size={18} />
                    </span>
                    <span className="plan-card__text">
                      <strong>{plan.name}</strong>
                      {plan.goal ? <small>{plan.goal}</small> : null}
                      <span className="plan-card__stats">
                        <span>
                          <ClipboardList size={12} /> {plan.stageCount} stages · {plan.stepCount}{" "}
                          divisions
                        </span>
                        <span>
                          <Repeat size={12} /> {plan.reps} reps
                        </span>
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span>
                  <Map size={20} />
                </span>
                <h2>No game plans yet</h2>
                <p>
                  Seed the guard path with <code>pnpm seed:guard-path</code> to get a seven-stage
                  route from the guard pull into an offensive round.
                </p>
              </div>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
