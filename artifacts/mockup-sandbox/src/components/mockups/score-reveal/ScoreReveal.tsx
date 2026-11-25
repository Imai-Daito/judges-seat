import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { FastForward, RotateCcw, Sparkles, Trophy } from "lucide-react";
import "./ScoreReveal.css";

type JudgeScore = { id: number; name: string; score: number };
type Phase = "ready" | "flight" | "complete";

const judges: JudgeScore[] = [
  { id: 1, name: "あなた", score: 95 },
  { id: 2, name: "審査員 A", score: 88 },
  { id: 3, name: "審査員 B", score: 79 },
  { id: 4, name: "審査員 C", score: 98 },
  { id: 5, name: "審査員 D", score: 84 },
  { id: 6, name: "審査員 E", score: 92 },
  { id: 7, name: "審査員 F", score: 97 },
  { id: 8, name: "審査員 G", score: 81 },
  { id: 9, name: "審査員 H", score: 96 },
];

const metalFor = (score: number) =>
  score >= 90 ? "gold" : score >= 80 ? "silver" : "bronze";

export function ScoreReveal() {
  const [index, setIndex] = useState(0);
  const [landed, setLanded] = useState<number[]>([]);
  const [phase, setPhase] = useState<Phase>("ready");
  const [autoRun, setAutoRun] = useState(false);
  const [flightTransform, setFlightTransform] = useState("translate(-50%, -50%)");
  const boardRef = useRef<HTMLDivElement>(null);
  const slotsRef = useRef<Array<HTMLDivElement | null>>([]);
  const flightRef = useRef<HTMLDivElement>(null);
  const fallbackTimer = useRef<number | undefined>(undefined);
  const advanceTimer = useRef<number | undefined>(undefined);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const active = judges[index];
  const total = judges.reduce((sum, judge) => sum + judge.score, 0);
  const current = phase === "complete" ? judges.length : landed.length;

  useLayoutEffect(() => () => {
    window.clearTimeout(fallbackTimer.current);
    window.clearTimeout(advanceTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (phase !== "flight" || !active || !boardRef.current || !flightRef.current) return;

    const card = flightRef.current.getBoundingClientRect();
    const slot = slotsRef.current[index]?.getBoundingClientRect();
    if (!slot) return;

    const dx = slot.left + slot.width / 2 - (card.left + card.width / 2);
    const dy = slot.top + slot.height / 2 - (card.top + card.height / 2);
    const scale = Math.min(slot.width / card.width, slot.height / card.height) * 0.94;

    setFlightTransform("translate(-50%, -50%)");
    const frame = window.requestAnimationFrame(() => {
      setFlightTransform(`translate(-50%, -50%) translate3d(${dx}px, ${dy}px, 0) scale(${scale})`);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [phase, index, active]);

  useLayoutEffect(() => {
    if (phase !== "flight") return;
    window.clearTimeout(fallbackTimer.current);
    fallbackTimer.current = window.setTimeout(settleActiveScore, reducedMotion ? 80 : 1150);
    return () => window.clearTimeout(fallbackTimer.current);
  }, [phase, index, reducedMotion]);

  function settleActiveScore() {
    setLanded((old) => old.includes(index) ? old : [...old, index]);
    if (index >= judges.length - 1) {
      setAutoRun(false);
      setPhase("complete");
      return;
    }
    setIndex((old) => old + 1);
    setPhase("ready");
    setFlightTransform("translate(-50%, -50%)");
    if (autoRun) advanceTimer.current = window.setTimeout(() => setPhase("flight"), reducedMotion ? 70 : 620);
  }

  function launchScore() {
    if (phase !== "ready" || !active) return;
    setAutoRun(true);
    setFlightTransform("translate(-50%, -50%)");
    setPhase("flight");
  }

  function replay() {
    window.clearTimeout(fallbackTimer.current);
    window.clearTimeout(advanceTimer.current);
    setAutoRun(false);
    setIndex(0);
    setLanded([]);
    setPhase("ready");
    setFlightTransform("translate(-50%, -50%)");
  }

  return (
    <div className="score-reveal">
      <main className="sr-shell">
        <header className="sr-topbar">
          <div className="sr-brand">
            <div className="sr-brand-mark" aria-hidden="true">審</div>
            <div>
              <div className="sr-brand-name">審査員席</div>
              <span className="sr-brand-en">THE SCORE REVEAL</span>
            </div>
          </div>
          <div className="sr-live"><span className="sr-live-dot" /> DEMO</div>
        </header>

        <section className="sr-title-row" aria-label="得点発表">
          <div>
            <div className="sr-kicker">FINAL ROUND · SCORE OPEN</div>
            <h1 className="sr-title">JUDGE</h1>
          </div>
          <div className="sr-edition">THE JUDGES<br />ON STAGE</div>
        </section>

        <section className="sr-performance" aria-label="演出対象">
          <div>
            <div className="sr-performance-note">TONIGHT ON STAGE · 演出デモ</div>
            <div className="sr-performer-title">エバース</div>
          </div>
          <div className="sr-round-badge">ROUND&nbsp; 01</div>
        </section>

        <div className="sr-board-head">
          <span className="sr-section-label">審査員スコアボード</span>
          <span className="sr-progress-label">{String(current).padStart(2, "0")} / 09&nbsp; OPEN</span>
        </div>

        <section className={`sr-board ${phase === "complete" ? "sr-complete" : ""}`} ref={boardRef} aria-label="一人ずつ発表される審査点">
          <div className="sr-slots">
            {judges.map((judge, slotIndex) => {
              const isLanded = landed.includes(slotIndex);
              const metal = metalFor(judge.score);
              return (
                <div
                  className={`sr-slot ${isLanded ? `is-filled sr-metal-${metal}` : ""}`}
                  key={judge.id}
                  ref={(node) => { slotsRef.current[slotIndex] = node; }}
                  aria-label={isLanded ? `${judge.name} ${judge.score}点` : `${judge.name} 未発表`}
                >
                  <span className="sr-slot-number">{isLanded ? judge.score : "—"}</span>
                  <span className="sr-slot-judge">{judge.name}</span>
                </div>
              );
            })}
          </div>

          <div className="sr-stage">
            <div className="sr-stage-inner">
              {phase !== "complete" && <div className="sr-stage-eyebrow">
                {phase === "flight" ? "SCORE IN MOTION" : `JUDGE ${String((active?.id ?? judges.length)).padStart(2, "0")} · NEXT SCORE`}
              </div>}
            </div>

            {phase !== "complete" && active && (
              <div
                ref={flightRef}
                className={`sr-flight-card sr-metal-${metalFor(active.score)} ${phase === "flight" ? "is-launched" : ""}`}
                style={{ transform: flightTransform } as CSSProperties}
                onTransitionEnd={(event) => {
                  if (phase === "flight" && event.propertyName === "transform") settleActiveScore();
                }}
                aria-live="polite"
                aria-label={`${active.name}の点数 ${active.score}点`}
              >
                <div className="sr-card-topline">
                  <span>JUDGE&nbsp; {String(active.id).padStart(2, "0")}</span>
                  <span className="sr-card-mini-mark" aria-hidden="true">審</span>
                </div>
                <div className="sr-card-main">
                  <strong className="sr-card-score">{active.score}</strong>
                  <div className="sr-card-side"><b>点</b><span>POINTS</span></div>
                </div>
                <div className="sr-card-namebar">
                  <span>{active.name}</span>
                  <span>{active.score >= 90 ? "GOLD" : active.score >= 80 ? "SILVER" : "BRONZE"}</span>
                </div>
              </div>
            )}

            {phase === "complete" && (
              <div className="sr-total-card" aria-live="polite">
                <strong>{total}</strong>
                <small>DEMO SCORE</small>
              </div>
            )}
          </div>
        </section>

        <p className="sr-footnote">演出デモです。点数・審査員名はサンプルで、番組の公式結果ではありません。</p>
      </main>

      <footer className="sr-controls">
        <div className="sr-controls-inner">
          <div className="sr-control-meta">
            <span>LIVE REVEAL</span>
            <span>{phase === "complete" ? "RESULT LOCKED" : "VERTICAL 360° TURN · ONE BY ONE"}</span>
          </div>
          {phase === "complete" ? (
            <button className="sr-button is-outline sr-replay" onClick={replay}>
              <RotateCcw size={15} /> 演出をもう一度
            </button>
          ) : (
            <div className="sr-button-row">
              <button className="sr-button" disabled={phase === "flight"} onClick={launchScore}>
                {phase === "flight"
                  ? <><Sparkles size={15} /> 点数を発表中 · {landed.length + 1} / 9</>
                  : <><FastForward size={15} /> {index === 0 ? "全員の点数を発表" : `発表を再開 · ${index + 1}人目から`}</>}
              </button>
              <button className="sr-button is-secondary" title="演出を最初から再生" aria-label="最初から再生" onClick={replay}>
                <RotateCcw size={15} />
              </button>
            </div>
          )}
          <div className={`sr-status ${phase === "complete" ? "is-hot" : ""}`}>
            {phase === "complete" ? <><Trophy size={10} /> 全員分の発表が完了</> : phase === "flight" ? "一人ずつ続けて発表しています" : "タップ一度で、全員分を続けて発表"}
          </div>
        </div>
      </footer>
    </div>
  );
}
