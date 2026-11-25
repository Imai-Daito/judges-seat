import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./_group.css";
import "./_FinalVoteBoard.css";

export interface FinalVoteBoardProps {
  judges: { id: string; name: string }[];
  candidates: { id: string; name: string }[];
  votes: Record<string, string>;
  published: boolean;
  sequenceKey: string;
  title?: string;
  onComplete?: () => void;
}

const finalistColors = ["#d72e35", "#326cbd", "#d9a928"];
const extraColors = ["#32836d", "#b75b32", "#7854a1", "#347f94", "#b64f79"];
const finalistColor = (index: number) => finalistColors[index] ?? extraColors[index - finalistColors.length]
  ?? `hsl(${((index - 8) * 137.508 + 28) % 360} 58% 52%)`;

export function FinalVoteBoard({
  judges, candidates, votes, published, sequenceKey, title = "FINAL JUDGE", onComplete,
}: FinalVoteBoardProps) {
  const [revealed, setRevealed] = useState(0);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [instantReveal, setInstantReveal] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);
  const frameRef = useRef<number | undefined>(undefined);
  const callbackRef = useRef(onComplete);
  const judgesRef = useRef(judges);
  const autoStartedRef = useRef("");
  const activeRunRef = useRef(0);
  const notifiedRunRef = useRef(-1);
  callbackRef.current = onComplete;
  judgesRef.current = judges;

  const palette = useMemo(() => new Map(candidates.map((candidate, index) => [
    candidate.id, finalistColor(index),
  ])), [candidates]);

  const notifyComplete = useCallback((run: number) => {
    if (notifiedRunRef.current === run) return;
    notifiedRunRef.current = run;
    callbackRef.current?.();
  }, []);

  const finish = useCallback((run: number) => {
    if (activeRunRef.current !== run) return;
    window.clearTimeout(timerRef.current);
    setRevealed(judgesRef.current.length);
    setRunning(false);
    setCompleted(true);
    setInstantReveal(true);
    notifyComplete(run);
  }, [notifyComplete]);

  const start = useCallback((force = false) => {
    if (!published || (!force && running) || !judgesRef.current.length) {
      if (published && !judgesRef.current.length && !completed) finish(activeRunRef.current);
      return;
    }
    window.clearTimeout(timerRef.current);
    const run = ++activeRunRef.current;
    setRevealed(0);
    setCompleted(false);
    setInstantReveal(false);
    setRunning(true);
    let index = 0;
    const advance = () => {
      if (activeRunRef.current !== run) return;
      index += 1;
      setRevealed(index);
      if (index >= judgesRef.current.length) {
        timerRef.current = window.setTimeout(() => {
          if (activeRunRef.current !== run) return;
          setRunning(false);
          setCompleted(true);
          notifyComplete(run);
        }, 1000);
        return;
      }
      timerRef.current = window.setTimeout(advance, 660);
    };
    timerRef.current = window.setTimeout(advance, 260);
  }, [published, running, completed, finish, notifyComplete]);

  const skip = () => {
    const run = activeRunRef.current;
    window.clearTimeout(timerRef.current);
    setInstantReveal(true);
    setRevealed(judgesRef.current.length);
    setRunning(false);
    setCompleted(true);
    window.cancelAnimationFrame(frameRef.current ?? 0);
    frameRef.current = window.requestAnimationFrame(() => notifyComplete(run));
  };

  useEffect(() => {
    const key = `${sequenceKey}:${published ? "published" : "hidden"}`;
    if (autoStartedRef.current === key) return;
    autoStartedRef.current = key;
    window.clearTimeout(timerRef.current);
    activeRunRef.current += 1;
    setRevealed(0);
    setRunning(false);
    setCompleted(false);
    setInstantReveal(false);
    if (!published) return;
    // Reduced motion presents each choice as a short, readable text transition.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const run = activeRunRef.current;
      setRunning(true);
      let index = 0;
      const advance = () => {
        if (activeRunRef.current !== run) return;
        index += 1;
        setRevealed(index);
        if (index >= judgesRef.current.length) {
          setRunning(false);
          setCompleted(true);
          notifyComplete(run);
        } else timerRef.current = window.setTimeout(advance, 240);
      };
      if (!judgesRef.current.length) {
        setCompleted(true);
        notifyComplete(run);
      } else timerRef.current = window.setTimeout(advance, 120);
    } else {
      // Start on the next frame so the reset state is painted before the first plaque turns.
      timerRef.current = window.setTimeout(() => start(true), 30);
    }
    return () => {
      window.clearTimeout(timerRef.current);
      if (autoStartedRef.current === key) autoStartedRef.current = "";
    };
    // Intentionally keyed by the ballot sequence, not by fresh prop object identities.
  }, [sequenceKey, published]);

  useEffect(() => () => {
    window.clearTimeout(timerRef.current);
    window.cancelAnimationFrame(frameRef.current ?? 0);
  }, []);

  const counts = useMemo(() => candidates.map((candidate) => ({
    candidate,
    count: judges.reduce((total, judge) => total + (votes[judge.id] === candidate.id ? 1 : 0), 0),
  })), [candidates, judges, votes]);
  const leaders = completed && published && counts.length
    ? counts.filter((row) => row.count === Math.max(...counts.map((item) => item.count)))
    : [];
  const winnerLabel = leaders.length > 1 ? "同率トップ" : "最多票";

  return <section className="fv-board" aria-label="最終決戦の投票発表">
    <div className="fv-heading">
      <span className="fv-kicker">{title}</span>
      <span className="fv-heading-rule" />
      <span className="fv-round">THE FINAL VOTE</span>
    </div>
    <div className="fv-legend" aria-label="決勝進出組と札の色">
      {candidates.map((candidate) => <span className="fv-legend-item" key={candidate.id}>
        <i style={{ backgroundColor: palette.get(candidate.id) }} />
        <span>{candidate.name}</span>
      </span>)}
    </div>
    <div className="fv-plaque-grid">
      {judges.map((judge, index) => {
        const choice = published ? candidates.find((candidate) => candidate.id === votes[judge.id]) : undefined;
        const turned = published && index < revealed;
        const size = Math.max(9, Math.min(17, 220 / Math.max(judge.name.length, 1)));
        const choiceSize = Math.max(9, Math.min(17, 220 / Math.max(choice?.name.length ?? 1, 1)));
        return <div className={`fv-plaque ${turned ? "is-turned" : ""} ${instantReveal ? "is-instant" : ""} ${running && index === revealed ? "is-next" : ""}`}
          key={judge.id} style={{ "--fv-choice": choice ? palette.get(choice.id) : "#252323", "--fv-delay": `${Math.min(index * 38, 280)}ms` } as CSSProperties}
          aria-label={turned ? `${judge.name}：${choice?.name ?? "未投票"}` : `${judge.name}の投票札`}>
          <div className="fv-plaque-inner">
            <div className="fv-face fv-front" aria-hidden={turned}>
              <span className="fv-crown" aria-hidden="true">♛</span>
              <span className="fv-judge-name" style={{ fontSize: `${size}px` }}>{judge.name}</span>
              <span className="fv-plaque-mark">JUDGE</span>
            </div>
            <div className="fv-face fv-back" aria-hidden={!turned}>
              <span className="fv-choice-name" style={{ fontSize: `${choiceSize}px` }}>{choice?.name ?? "未投票"}</span>
              <span className="fv-choice-meta">{choice ? "FINALIST" : "NO VOTE"}</span>
            </div>
          </div>
        </div>;
      })}
    </div>
    {published && !completed && <div className="fv-reveal-controls">
      <span className="fv-live-status" role="status">{running ? `${revealed} / ${judges.length}　開票中` : "開票準備中"}</span>
      <button type="button" className="fv-text-button" data-testid="button-skip-final-vote" onClick={skip}>結果を表示</button>
    </div>}
    {published && completed && <>
      <div className="fv-counts" aria-label="公開済み投票数">
        {counts.map(({ candidate, count }) => <div className="fv-count-row" key={candidate.id}>
          <span className="fv-count-dot" style={{ backgroundColor: palette.get(candidate.id) }} />
          <span className="fv-count-name">{candidate.name}</span><strong>{count}<small>票</small></strong>
        </div>)}
      </div>
      {leaders.length > 0 && <div className="fv-winner">
        <span>{winnerLabel}</span><strong>{leaders.map((row) => row.candidate.name).join("　／　")}</strong>
      </div>}
      <button type="button" className="fv-replay" data-testid="button-replay-final-vote" disabled={running} onClick={() => start()}>開票を再生</button>
    </>}
  </section>;
}
