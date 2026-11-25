import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Award, ChevronRight, CircleHelp, Copy, Minus, Plus, RotateCcw, Settings2, ShieldCheck, Trophy, Users, X } from "lucide-react";
import { FinalVoteBoard } from "../final-vote/_FinalVoteBoard";
import "./_group.css";
import "./JudgesSeat.css";
import {
  canPublishScores, canPublishVotes, getFinale, getRankings, parseScore,
  publishScores, publishVotes, scoreMetal, startRunoff, submittedJudges,
  submitScore, submitVote as saveVote, voteRound,
  type Judge, type Performer, type Persisted, type PublishedRound,
} from "./judging";

type View = "score" | "room" | "lobby" | "ranking" | "reveal" | "finale" | "result";

const roster2024 = ["令和ロマン", "ヤーレンズ", "真空ジェシカ", "マユリカ", "ダイタク", "ジョックロック", "バッテリィズ", "ママタルト", "エバース", "トム・ブラウン"];
const initialJudges: Judge[] = [
  { id: "me", name: "あなた", self: true },
  { id: "d1", name: "審査員 A" }, { id: "d2", name: "審査員 B" },
  { id: "d3", name: "審査員 C" }, { id: "d4", name: "審査員 D" },
];
const initPerformers = roster2024.map((name, i) => ({ id: `p${i}`, name }));
const starterState: Persisted = {
  nickname: "あなた", judges: initialJudges, performers: initPerformers,
  rounds: [
    { performerId: "p0", scores: { me: 96, d1: 94, d2: 98, d3: 95, d4: 97 } },
    { performerId: "p1", scores: { me: 91, d1: 92, d2: 89, d3: 94, d4: 93 } },
  ],
  activeIndex: 2, submitted: {}, roomStarted: true, finalists: [], votes: {},
  votesPublished: false, runoffVotes: {}, runoffPublished: false, runoffDone: false,
};
const STORAGE_KEY = "judges-seat-prototype-v1";
const idFor = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function safeLoad(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return starterState;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return { ...starterState, ...parsed };
  } catch { return starterState; }
}

export function JudgesSeat() {
  const [data, setData] = useState<Persisted>(safeLoad);
  const [view, setView] = useState<View>("score");
  const [draftScore, setDraftScore] = useState("");
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<"open" | "reset" | "start" | "final-vote" | "open-votes" | "runoff" | "open-runoff" | null>(null);
  const [pendingReveal, setPendingReveal] = useState<PublishedRound | null>(null);
  const [revealIndex, setRevealIndex] = useState(0);
  const [settled, setSettled] = useState<number[]>([]);
  const [revealPhase, setRevealPhase] = useState<"scores" | "total" | "rank">("scores");
  const [toast, setToast] = useState("");
  const [judgeDraft, setJudgeDraft] = useState("");
  const [performerDraft, setPerformerDraft] = useState("");
  const [year, setYear] = useState("2024");
  const [editNickname, setEditNickname] = useState(data.nickname);
  const [vote, setVote] = useState("");
  const [runoffVote, setRunoffVote] = useState("");
  const [finalVoteRevealComplete, setFinalVoteRevealComplete] = useState(false);
  const [finalistDraft, setFinalistDraft] = useState<string[]>([]);
  const [rankingMode, setRankingMode] = useState<"group" | "mine">("group");
  const [animationKey, setAnimationKey] = useState(0);
  const [flightTarget, setFlightTarget] = useState({ x: 0, y: 175, scale: .48 });
  const [flightReadyIndex, setFlightReadyIndex] = useState(-1);
  const [flightStartedIndex, setFlightStartedIndex] = useState(-1);
  const reducedMotion = useReducedMotion();
  const revealRoot = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<Array<HTMLDivElement | null>>([]);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }, [data]);
  useEffect(() => { setFinalVoteRevealComplete(false); }, [data.finalists, data.votesPublished, data.runoffDone, data.runoffPublished]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const currentPerformer = data.performers[data.activeIndex] ?? data.performers[0];
  const currentKey = currentPerformer?.id ?? "none";
  const rankRows = useMemo(() => getRankings(data.rounds, data.performers), [data.rounds, data.performers]);
  const currentSubmitted = data.submitted[currentKey] !== undefined;
  const ownCurrentScore = data.submitted[currentKey];
  const ownRank = rankRows.find((row) => row.performer.id === currentPerformer?.id);
  const latestRound = data.rounds[data.rounds.length - 1];
  const personalRows = useMemo(() => getRankings(data.rounds, data.performers, "me"), [data.rounds, data.performers]);
  const personalScore = (id: string) => personalRows.find(row => row.performer.id === id)?.total;
  const personalRank = (id: string) => personalRows.find(row => row.performer.id === id)?.rank;
  const latestPerformer = latestRound ? data.performers.find((performer) => performer.id === latestRound.performerId) : undefined;
  const allActive = data.judges.length > 0 && currentSubmitted;
  const remaining = data.performers.filter((performer) => !data.rounds.some((round) => round.performerId === performer.id));
  const isEnd = !currentPerformer || (data.rounds.length >= data.performers.length);
  const finalists = data.performers.filter((performer) => data.finalists.includes(performer.id));

  const update = (patch: Partial<Persisted>) => setData((prev) => ({ ...prev, ...patch }));
  const inform = (message: string) => setToast(message);
  const navTo = (next: View) => { setView(next); setDialog(null); };
  const addDigit = (digit: string) => {
    setEditing(true);
    setDraftScore((old) => {
      const next = `${old}${digit}`.replace(/^0+(?=\d)/, "");
      return next.length > 3 ? old : next;
    });
  };
  const adjustScore = (delta: number) => {
    const base = draftScore === "" ? 0 : Number(draftScore);
    const next = Math.max(0, Math.min(100, base + delta));
    setEditing(true);
    setDraftScore(String(next));
  };
  const submitOwnScore = () => {
    if (parseScore(draftScore) === null) {
      inform("0〜100の整数を入力してください");
      return;
    }
    const next = submitScore(data, currentKey, "me", draftScore);
    if (next === data) { inform("公開済みの点数は変更できません"); return; }
    setData(next);
    setEditing(false);
    inform("あなたの点数を保存しました");
  };
  const updateJudgeSubmitted = () => {
    if (!currentSubmitted) { inform("先にあなたの点数を送信してください"); return; }
    const others = data.judges.filter((judge) => !judge.self);
    let next = data;
    others.forEach((judge, index) => {
      if (next.submitted[`${currentKey}:${judge.id}`] === undefined) {
        next = submitScore(next, currentKey, judge.id, String([93, 96, 89, 97, 92][(data.rounds.length + index) % 5]));
      }
    });
    setData(next);
    inform("デモ審査員の提出を反映しました");
  };
  const submittedForCurrent = () => submittedJudges(data, currentKey);
  const canOpenScores = canPublishScores(data, currentKey);
  const publishCurrent = () => {
    const next = publishScores(data, currentKey);
    if (next === data) return;
    const round = next.rounds[next.rounds.length - 1];
    setData(next);
    setDraftScore("");
    setEditing(false);
    setPendingReveal(round);
    startReveal(round);
    setDialog(null);
    setView("reveal");
  };

  function startReveal(round: PublishedRound) {
    window.clearTimeout(timerRef.current);
    setPendingReveal(round);
    setRevealIndex(0);
    setSettled([]);
    setRevealPhase("scores");
    setFlightReadyIndex(-1);
    setFlightStartedIndex(-1);
    setAnimationKey((key) => key + 1);
  }
  const markSettled = (index: number) => {
    setSettled((old) => old.includes(index) ? old : [...old, index]);
    if (index + 1 < data.judges.length) {
      timerRef.current = window.setTimeout(() => setRevealIndex(index + 1), reducedMotion ? 200 : 420);
    } else {
      timerRef.current = window.setTimeout(() => setRevealPhase("total"), reducedMotion ? 200 : 900);
    }
  };
  useEffect(() => {
    if (view !== "reveal" || revealPhase !== "total") return;
    timerRef.current = window.setTimeout(() => setRevealPhase("rank"), reducedMotion ? 250 : 1150);
    return () => window.clearTimeout(timerRef.current);
  }, [view, revealPhase, reducedMotion]);
  useLayoutEffect(() => {
    if (view !== "reveal" || revealPhase !== "scores" || !pendingReveal || !data.judges[revealIndex]) return;
    const root = revealRoot.current?.getBoundingClientRect();
    const slot = slotRefs.current[revealIndex]?.getBoundingClientRect();
    if (!root || !slot) return;
    setFlightTarget({
      x: slot.left + slot.width / 2 - (root.left + root.width / 2),
      y: slot.top + slot.height / 2 - (root.top + root.height * .52),
      scale: Math.min(.62, slot.width / 228, slot.height / 154),
    });
    setFlightReadyIndex(revealIndex);
    if (reducedMotion) {
      setFlightStartedIndex(revealIndex);
      const settleTimer = window.setTimeout(() => markSettled(revealIndex), 240);
      return () => window.clearTimeout(settleTimer);
    }
    const launchTimer = window.setTimeout(() => setFlightStartedIndex(revealIndex), 520);
    return () => window.clearTimeout(launchTimer);
  }, [view, revealPhase, pendingReveal, revealIndex, data.judges, animationKey, reducedMotion]);

  const createFreshRoom = () => {
    const fresh: Persisted = {
      nickname: data.nickname, judges: [{ ...initialJudges[0], name: data.nickname }, ...initialJudges.slice(1)],
      performers: initPerformers, rounds: [], activeIndex: 0, submitted: {}, roomStarted: false,
      finalists: [], votes: {}, votesPublished: false, runoffVotes: {}, runoffPublished: false, runoffDone: false,
    };
    setData(fresh); setDraftScore(""); setEditing(false); setDialog(null); setView("room"); inform("新しいデモルームを用意しました");
  };
  const startRoom = () => {
    if (data.judges.length < 2) { inform("審査員は2名以上にしてください"); return; }
    if (data.performers.length < 1) { inform("出場者を1組以上登録してください"); return; }
    update({ roomStarted: true });
    setDialog(null); setView("lobby");
  };
  const chooseNextPerformer = (id: string) => {
    const index = data.performers.findIndex((item) => item.id === id);
    if (index < 0 || data.rounds.some((round) => round.performerId === id)) return;
    update({ activeIndex: index, submitted: {} });
    setDraftScore(""); setEditing(false); setView("score");
  };
  const beginFinale = () => {
    const withSamples: Persisted = data.rounds.length >= 2 ? data : {
      ...data,
      rounds: [
        ...data.rounds,
        ...data.performers.slice(0, 3).filter((performer) => !data.rounds.some((round) => round.performerId === performer.id)).map((performer, i) => ({
          performerId: performer.id,
          scores: Object.fromEntries(data.judges.map((judge, j) => [judge.id, [94, 96, 91, 98, 93][(i + j) % 5]])),
        })),
      ],
    };
    setData(withSamples);
    setFinalistDraft([]);
    setView("finale");
    if (withSamples.rounds.length !== data.rounds.length) inform("体験用の過去ラウンドを追加しました（デモ）");
  };
  const saveFinalists = () => {
    if (finalistDraft.length < 2) { inform("候補を2組以上選んでください"); return; }
    update({ finalists: finalistDraft, votes: {}, votesPublished: false, runoffVotes: {}, runoffPublished: false, runoffDone: false });
    setVote(""); setDialog(null);
  };
  const { firstWinners, runoffNeeded, champions } = getFinale(data);
  const submitVote = () => {
    if (!vote) { inform("投票先を選んでください"); return; }
    const next = saveVote(data, "me", vote, false);
    if (next === data) { inform("公開後の変更や候補外への投票はできません"); return; }
    setData(next); setDialog(null); inform("投票を保存しました");
  };
  const submitRunoffVote = () => {
    if (!runoffVote) { inform("再投票先を選んでください"); return; }
    const next = saveVote(data, "me", runoffVote, true);
    if (next === data) { inform("公開後の変更や候補外への投票はできません"); return; }
    setData(next); setDialog(null); inform("再投票を保存しました");
  };
  const openVotes = (runoff: boolean) => {
    const next = publishVotes(data, runoff);
    if (next === data) { inform("全員の有効な投票が必要です"); return; }
    setData(next); setDialog(null);
  };
  const copyDemoCode = async () => {
    try { await navigator.clipboard.writeText("M1-DEMO"); inform("デモコード M1-DEMO をコピーしました"); }
    catch { inform("デモコード：M1-DEMO"); }
  };

  const renderTop = () => (
    <header className="js-topbar">
      <div className="js-brand">
        <div className="js-mark"><span>審</span></div>
        <div><div className="js-brand-title">審査員席</div><span className="js-brand-sub">M-1 WATCHING ROOM</span></div>
      </div>
      <div className="js-demo-tag">体験版</div>
    </header>
  );

  const renderScore = () => {
    const done = submittedForCurrent();
    return <main className="js-content">
      <div className="js-eyebrow">ROUND {String(data.rounds.length + 1).padStart(2, "0")}　／　審査員席</div>
      <h1 className="js-title">あなたの席から、<br />今夜の一票を。</h1>
      <p className="js-subtitle">同じテレビを囲む仲間と、漫才を点数にする。</p>
      <div className="js-rule" />
      <section className="js-announce">
        <div className="js-ann-top"><small>NOW ON STAGE　·　2024 プリセット</small><i className="js-live-dot" /></div>
        <div className="js-artist">{currentPerformer?.name ?? "全組の採点が終了"}</div>
        <div className="js-artist-meta"><span>出場順は編集可能な体験用リスト</span><span>{Math.min(data.rounds.length + 1, data.performers.length)} / {data.performers.length}</span></div>
        <div className="js-progress"><span style={{ width: `${Math.min(100, (data.rounds.length / Math.max(1, data.performers.length)) * 100)}%` }} /></div>
      </section>
      <div className="js-judge-head"><span className="js-mini-label">今夜の審査員</span><span className="js-roster-status">{done.length} / {data.judges.length} 提出</span></div>
      <div className="js-judge-list">
        {data.judges.map((judge) => {
          const hasSubmitted = done.some((item) => item.id === judge.id);
          return <div className={`js-judge-chip ${judge.self ? "is-you" : ""} ${hasSubmitted ? "is-done" : ""}`} key={judge.id}>
            <span className="js-avatar">{judge.self ? data.nickname.slice(0, 1) : judge.name.slice(-1)}</span>
            <span>{judge.self ? data.nickname : judge.name}</span>
            {hasSubmitted && <ShieldCheck size={12} />}
          </div>;
        })}
      </div>
      <p className="js-hint" style={{ marginTop: 2 }}>他の審査員はデモです。実際の友人との同期はありません。</p>
      {isEnd ? <div className="js-card">
        <div className="js-card-head"><h3 className="js-card-title">全組の採点が完了</h3><span className="js-small-tag">NEXT</span></div>
        <p className="js-card-note">全体順位を確認するか、最終決戦の体験へ進めます。</p>
        <div className="js-submit-row"><button className="js-button" onClick={() => navTo("ranking")}>順位を見る <ChevronRight size={15} /></button><button className="js-button is-quiet" onClick={beginFinale}>最終決戦を体験</button></div>
      </div> : currentSubmitted && !editing ? <div className="js-wait-box">
        <div className="js-wait-number">{done.length} / {data.judges.length}　SUBMITTED</div>
        <h3>あなたの点数を預かりました</h3>
        <p>公開されるまで他の人の点数は見えません。<br />幹事が点数を開く前なら修正できます。</p>
        <div className="js-submit-row"><button className="js-button is-quiet" onClick={() => { setDraftScore(String(ownCurrentScore)); setEditing(true); }}>点数を修正</button><button className="js-button" onClick={updateJudgeSubmitted}>デモ審査員の提出</button></div>
        <button className="js-subtle-link" onClick={() => navTo("room")}>ルーム設定・進行を見る</button>
      </div> : <section className="js-score-zone">
        <div className="js-score-caption"><strong>{editing ? "点数を修正" : "あなたの採点"}</strong><span>INTEGER　/　0–100</span></div>
        <div className="js-score-display"><span className={`js-score-number ${draftScore === "" ? "is-blank" : ""}`}>{draftScore || "— —"}</span>{draftScore && <span className="js-score-suffix">点</span>}</div>
        <div className="js-adjust">
          <button onClick={() => adjustScore(-1)} aria-label="1点下げる"><Minus size={14} /> −1</button>
          <button onClick={() => adjustScore(1)} aria-label="1点上げる"><Plus size={14} /> ＋1</button>
        </div>
        <div className="js-keypad">
          {["1","2","3","4","5","6","7","8","9","00","0","⌫"].map((key) => <button className={`js-key ${key === "⌫" ? "is-back" : ""}`} key={key} onClick={() => {
            if (key === "⌫") { setEditing(true); setDraftScore((value) => value.slice(0, -1)); }
            else addDigit(key);
          }}>{key}</button>)}
        </div>
        <div className="js-submit-row">
          <button className="js-button is-quiet" onClick={() => { setDraftScore(""); setEditing(false); }}>クリア</button>
          <button className="js-button" onClick={submitOwnScore} disabled={!draftScore || Number(draftScore) > 100}>点数を送信 <ChevronRight size={15} /></button>
        </div>
        <p className="js-hint">0〜100点・1点刻み。送信後も点数オープン前なら修正できます。</p>
      </section>}
      {data.rounds.length > 0 && <div className="js-card">
        <div className="js-card-head"><h3 className="js-card-title">公開済みのデモラウンド</h3><button className="js-subtle-link" onClick={() => navTo("ranking")}>順位を見る</button></div>
        <p className="js-card-note">{data.rounds.length}組の採点結果を公開済み。未公開の点数は表示されません。</p>
      </div>}
    </main>;
  };

  const renderRoom = () => <main className="js-content">
    <div className="js-eyebrow">ROOM CONTROL　／　幹事席</div>
    <h1 className="js-title">今夜の審査席を<br />整える。</h1>
    <p className="js-subtitle">同じ場所で遊ぶためのローカル体験ルームです。</p>
    <div className="js-callout">この試作品では、複数端末のルーム同期・招待リンク接続は未実装です。招待コードはデモ表示のみです。</div>
    <div className="js-card">
      <div className="js-card-head"><h3 className="js-card-title">ルームコード</h3><span className="js-small-tag">PROTOTYPE ONLY</span></div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12 }}><span className="js-code">M1-DEMO</span><button className="js-button is-quiet" onClick={copyDemoCode}><Copy size={14} /> コピー</button></div>
      <p className="js-card-note">実際の入室や他端末との同期はできません。</p>
      <button className="js-button is-quiet is-wide" style={{ marginTop:10 }} onClick={() => navTo("lobby")}>ルームのロビーを見る <ChevronRight size={14} /></button>
    </div>
    <div className="js-card">
      <div className="js-card-head"><h3 className="js-card-title">あなたのニックネーム</h3><span className="js-small-tag">HOST</span></div>
      <label className="js-field-label" htmlFor="js-nickname">表示名</label>
      <div className="js-form-row"><input id="js-nickname" className="js-input" value={editNickname} maxLength={10} onChange={(event) => setEditNickname(event.target.value)} /><button className="js-button" onClick={() => {
        const nickname = editNickname.trim() || "あなた";
        update({ nickname, judges: data.judges.map((judge) => judge.self ? { ...judge, name: nickname } : judge) });
        inform("ニックネームを保存しました");
      }}>保存</button></div>
    </div>
    <div className="js-card">
      <div className="js-card-head"><h3 className="js-card-title">審査メンバー</h3><span className="js-small-tag">{data.judges.length}名</span></div>
      <p className="js-card-note">{data.roomStarted ? "採点開始後のメンバー変更はできません。新しいデモルームで編集できます。" : "開始前に編集できます。あなたも審査員として参加します。"}</p>
      <div className="js-list-editor">{data.judges.map((judge) => <span className="js-edit-chip" key={judge.id}>{judge.name}{judge.self && "（幹事）"}{!judge.self && !data.roomStarted && <button aria-label={`${judge.name}を削除`} onClick={() => update({ judges: data.judges.filter((item) => item.id !== judge.id) })}><X size={12} /></button>}</span>)}</div>
      {!data.roomStarted && <div className="js-form-row" style={{ marginTop:10 }}><input className="js-input" placeholder="審査員の名前" value={judgeDraft} onChange={(event) => setJudgeDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addJudge()} /><button className="js-button is-quiet" onClick={addJudge}>追加</button></div>}
      {data.judges.some((judge) => !judge.self) && <p className="js-hint">他の審査員はローカルのデモ役です。オンラインの友人ではありません。</p>}
    </div>
    <div className="js-card">
      <div className="js-card-head"><h3 className="js-card-title">大会・出場者</h3><span className="js-small-tag">{data.performers.length}組</span></div>
      <div className="js-segment"><button className={year === "2024" ? "is-on" : ""} onClick={() => setYear("2024")}>2024年プリセット</button><button className={year === "custom" ? "is-on" : ""} onClick={() => setYear("custom")}>自由編集</button></div>
      <p className="js-card-note">{year === "2024" ? "令和ロマン、ヤーレンズ、真空ジェシカ、マユリカ、ダイタク、ジョックロック、バッテリィズ、ママタルト、エバース、トム・ブラウン" : "採点開始前に出場者を追加・削除できます。"}</p>
      {!data.roomStarted && <>
        <div className="js-list-editor">{data.performers.map((performer) => <span className="js-edit-chip" key={performer.id}>{performer.name}<button aria-label={`${performer.name}を削除`} onClick={() => update({ performers: data.performers.filter((item) => item.id !== performer.id) })}><X size={12} /></button></span>)}</div>
        <div className="js-form-row" style={{ marginTop:10 }}><input className="js-input" placeholder="コンビ名を追加" value={performerDraft} onChange={(event) => setPerformerDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addPerformer()} /><button className="js-button is-quiet" onClick={addPerformer}>追加</button></div>
      </>}
      {data.roomStarted && <p className="js-hint">出場順は公式舞台順ではありません。新しいルームで編集できます。</p>}
    </div>
    {!data.roomStarted ? <button className="js-button is-wide" onClick={() => setDialog("start")}>審査を開始する <ChevronRight size={15} /></button> :
      <div className="js-submit-row"><button className="js-button" onClick={() => navTo("score")}>審査に戻る <ChevronRight size={15} /></button><button className="js-button is-danger" onClick={() => setDialog("reset")}>新しいルーム</button></div>}
    {data.roomStarted && <div className="js-card">
      <div className="js-card-head"><h3 className="js-card-title">採点の進行</h3><span className="js-small-tag">HOST ONLY</span></div>
      <p className="js-card-note">公開前の点数は誰にも見えません。全員の提出後、幹事が点数をオープンします。公開後は変更できません。</p>
      {remaining.length > 0 && <><label className="js-field-label" htmlFor="next-performer">次に採点する組（未採点から選択）</label><select id="next-performer" className="js-input" value={currentPerformer?.id ?? ""} onChange={(event) => chooseNextPerformer(event.target.value)}>{remaining.map((performer) => <option key={performer.id} value={performer.id}>{performer.name}</option>)}</select><button className="js-subtle-link" onClick={() => navTo("score")}>選択した組の審査画面へ</button></>}
      {canOpenScores && <button className="js-button is-wide" onClick={() => setDialog("open")}>点数オープンの確認へ</button>}
      <button className="js-button is-quiet is-wide" style={{ marginTop:8 }} onClick={beginFinale}>最終決戦を体験</button>
    </div>}
    <div className="js-footnote"><CircleHelp size={12} className="js-inline-icon" />体験版の入力・結果はこの端末のブラウザーに保存されます。</div>
  </main>;

  function addJudge() {
    const name = judgeDraft.trim();
    if (!name) return;
    if (data.judges.some((judge) => judge.name === name)) { inform("同じ名前の審査員がいます"); return; }
    update({ judges: [...data.judges, { id: idFor("judge"), name }] }); setJudgeDraft("");
  }
  function addPerformer() {
    const name = performerDraft.trim();
    if (!name) return;
    update({ performers: [...data.performers, { id: idFor("performer"), name }] }); setPerformerDraft("");
  }

  const renderLobby = () => <main className="js-content">
    <div className="js-eyebrow">ROOM OPEN　／　同じ場所で観戦</div>
    <h1 className="js-title">審査員席へ、<br />ようこそ。</h1>
    <p className="js-subtitle">テレビの前に集まった仲間と、今夜の漫才を審査しよう。</p>
    <div className="js-card" style={{ marginTop:22 }}>
      <div className="js-card-head"><h3 className="js-card-title">デモルーム</h3><span className="js-small-tag">この端末だけ</span></div>
      <div className="js-code" style={{ marginTop:15 }}>M1-DEMO</div>
      <p className="js-card-note">招待コードは表示用のデモです。リンク共有・複数端末同期は未接続です。</p>
    </div>
    <div className="js-overline">TONIGHT'S JUDGES　·　他の審査員はデモ</div>
    {data.judges.map((judge, i) => <div className="js-card-head" style={{ padding:"9px 5px", borderBottom:"1px solid rgba(255,255,255,.07)" }} key={judge.id}><span className="js-mini-label"><span className="js-avatar" style={{ display:"inline-grid", verticalAlign:"middle", marginRight:8 }}>{judge.self ? data.nickname.slice(0,1) : String.fromCharCode(65+i-1)}</span>{judge.self ? data.nickname : judge.name}</span><span className="js-small-tag">{judge.self ? "幹事・審査員" : "デモ審査員"}</span></div>)}
    <div className="js-card">
      <div className="js-card-head"><h3 className="js-card-title">出場者</h3><span className="js-small-tag">{data.performers.length}組</span></div>
      <p className="js-card-note">2024年ロスターをもとにした体験用リスト。並び順は公式舞台順ではありません。</p>
      <button className="js-button is-wide" style={{ marginTop:12 }} onClick={() => navTo("score")}>審査画面へ進む <ChevronRight size={15} /></button>
    </div>
    <button className="js-subtle-link" onClick={() => navTo("room")}><Settings2 size={13} className="js-inline-icon" />幹事設定を開く</button>
  </main>;

  const renderRanking = () => {
    const displayRows = rankRows;
    const mineSorted = personalRows;
    return <main className="js-content">
      <div className="js-eyebrow">LEADERBOARD　／　公開済みのみ</div>
      <h1 className="js-title">席のあいだに、<br />順位が生まれる。</h1>
      <p className="js-subtitle">未公開の採点は含まれません。合計は全審査員の点数から算出。</p>
      <div className="js-segment"><button className={rankingMode === "group" ? "is-on" : ""} onClick={() => setRankingMode("group")}>全員の合計</button><button className={rankingMode === "mine" ? "is-on" : ""} onClick={() => setRankingMode("mine")}>自分の点数</button></div>
      {rankRows.length === 0 ? <div className="js-empty">公開済みのラウンドはまだありません。<br />審査画面から採点を始めましょう。</div> : <>
        <section className="js-card" style={{ padding:"5px 13px" }}>
          {(rankingMode === "mine" ? mineSorted : displayRows).map((row) => {
            const personal = data.rounds.find((round) => round.performerId === row.performer.id)?.scores.me;
            return <div className="js-ranking-item" key={row.performer.id}>
              <div className="js-rank-no">{rankingMode === "group" ? row.rank : personalRank(row.performer.id)}</div>
              <div><div className="js-rank-name">{row.performer.name}</div><div className="js-rank-detail">{row.count}名分公開 {personal !== undefined && `・あなた ${personal}点`}</div></div>
              <div className="js-rank-total">{rankingMode === "group" ? row.total : personal ?? "—"}<small> 点</small></div>
            </div>;
          })}
        </section>
        <div className="js-card">
          <div className="js-card-head"><h3 className="js-card-title">公開採点表</h3><span className="js-small-tag">横にスクロール</span></div>
          <div className="js-table-wrap"><table className="js-table"><thead><tr><th>コンビ</th>{data.judges.map((judge) => <th className={judge.self ? "js-own-col" : ""} key={judge.id}>{judge.self ? data.nickname : judge.name}</th>)}<th>合計</th></tr></thead><tbody>{data.rounds.map((round) => {
            const performer = data.performers.find((item) => item.id === round.performerId);
            return <tr key={round.performerId}><td>{performer?.name ?? "削除済み"}</td>{data.judges.map((judge) => <td className={judge.self ? "js-own-col" : ""} key={judge.id}>{round.scores[judge.id] ?? "—"}</td>)}<td>{Object.values(round.scores).reduce((sum, score) => sum + score, 0)}</td></tr>;
          })}</tbody></table></div>
          <p className="js-card-note">すべてデモラウンドを含む、この端末の体験データです。</p>
        </div>
      </>}
      {latestRound && <div className="js-card">
        <div className="js-card-head"><h3 className="js-card-title">最後の点数発表を再演</h3><span className="js-small-tag">編集不可</span></div>
        <p className="js-card-note">{latestPerformer?.name} の公開済み結果を、同じ演出でもう一度。</p>
        <button className="js-button is-wide" style={{ marginTop:10 }} onClick={() => { startReveal(latestRound); navTo("reveal"); }}><RotateCcw size={14} /> 演出をもう一度</button>
      </div>}
      <button className="js-button is-quiet is-wide" onClick={beginFinale}><Trophy size={15} /> 最終決戦を体験</button>
    </main>;
  };

  const renderReveal = () => {
    if (!pendingReveal) return <main className="js-content"><div className="js-empty">公開結果がありません。</div><button className="js-button" onClick={() => navTo("score")}>審査画面へ</button></main>;
    const revealPerformer = data.performers.find((performer) => performer.id === pendingReveal.performerId);
    const total = Object.values(pendingReveal.scores).reduce((sum, value) => sum + value, 0);
    const currentRank = getRankings(data.rounds, data.performers).find((row) => row.performer.id === pendingReveal.performerId);
    const order = data.judges.map((judge, index) => ({ judge, index }));
    const current = order[revealIndex];
    return <main className="js-content">
      <div className="js-reveal-stage" ref={revealRoot}>
        <div className="js-reveal-mast">
          <div className="js-panel-kicker">THE SCORE　／　点数オープン</div>
          <h1>{revealPerformer?.name}</h1>
          <div className="js-reveal-caption">{revealPhase === "scores" ? "審査員の点数を、一人ずつ。" : revealPhase === "total" ? "全員の点数がそろいました" : "このラウンドの順位"}</div>
        </div>
        <div className="js-score-slots">
          {order.map(({ judge, index }) => {
            const value = pendingReveal.scores[judge.id] ?? 0;
            return <div className={`js-score-slot is-${scoreMetal(value)}`} ref={(node) => { slotRefs.current[index] = node; }} key={judge.id} aria-label={`${judge.name} ${value}点`}>
              <div className="js-slot-score">{settled.includes(index) ? value : "—"}</div><div className="js-slot-name">{judge.self ? data.nickname : judge.name}</div>
            </div>;
          })}
        </div>
        {current && flightReadyIndex === current.index && revealPhase === "scores" && !settled.includes(current.index) && <motion.div className="js-flying-card" key={`${animationKey}-${current.index}`} initial={{ x:0,y:0,scale:1,opacity:1 }} animate={reducedMotion ? { opacity:1 } : flightStartedIndex === current.index ? { ...flightTarget, opacity:1 } : { x:0,y:0,scale:1,opacity:1 }} transition={reducedMotion ? { duration:.15 } : { type:"spring", stiffness:190, damping:21, mass:.72 }} onAnimationComplete={() => { if (!reducedMotion && flightStartedIndex === current.index) markSettled(current.index); }}>
          <div className={`js-score-face is-${scoreMetal(pendingReveal.scores[current.judge.id] ?? 0)}`}>
            <div className="js-big-score">{pendingReveal.scores[current.judge.id]}</div>
            <div className="js-big-name">{current.judge.self ? data.nickname : current.judge.name}</div>
          </div>
        </motion.div>}
        <AnimatePresence>
          {revealPhase !== "scores" && <motion.div className="js-total-card" initial={{ opacity:0,y:10 }} animate={{ opacity:1,y:0 }} transition={{ duration:.35 }}>
            <div className="js-total-label">{revealPhase === "total" ? "TOTAL　／　合計点" : "RANK　／　順位"}</div>
            <div className="js-total-num">{revealPhase === "total" ? total : (currentRank?.rank ?? "—")}<small style={{ fontSize:13, marginLeft:5 }}>{revealPhase === "total" ? "点" : "位"}</small></div>
            {revealPhase === "rank" && <div className="js-total-rank">{revealPerformer?.name}　{currentRank?.rank === 1 ? "暫定トップ" : "ランクイン"}</div>}
          </motion.div>}
        </AnimatePresence>
      </div>
      {revealPhase === "rank" && <div className="js-reveal-cta"><button className="js-button is-wide" onClick={() => { setView("ranking"); setPendingReveal(null); }}>順位表へ <ChevronRight size={15} /></button></div>}
      <p className="js-footnote">公開後は幹事を含め、点数を変更できません。</p>
    </main>;
  };

  const renderFinale = () => {
    const candidatesForVote = data.finalists.map((id) => data.performers.find((performer) => performer.id === id)).filter((item): item is Performer => Boolean(item));
    const { candidates: activeCandidates, source: currentVoteMap, published: votePublished } = voteRound(data, data.runoffDone);
    const allVoted = canPublishVotes(data, data.runoffDone);
    return <main className="js-content">
      <div className="js-eyebrow">FINAL VOTE　／　投票</div>
      <h1 className="js-title">最後の一組を、<br />あなたが選ぶ。</h1>
      <p className="js-subtitle">候補は幹事が番組の進出組から手動で指定します。</p>
      <div className="js-callout">これはローカル体験の投票です。他の審査員はデモで、実際の友人との投票同期はありません。</div>
      {data.finalists.length === 0 ? <>
        <div className="js-card">
          <div className="js-card-head"><h3 className="js-card-title">決勝候補を選ぶ</h3><span className="js-small-tag">幹事のみ</span></div>
          <p className="js-card-note">合計順位から自動決定しません。実際の進出組を手動で選択してください。</p>
          <div style={{ display:"grid",gap:6,marginTop:12 }}>
            {data.performers.map((performer) => <label className="js-final-candidate" key={performer.id}><input type="checkbox" checked={finalistDraft.includes(performer.id)} onChange={(event) => setFinalistDraft((old) => event.target.checked ? [...old, performer.id] : old.filter((id) => id !== performer.id))} />{performer.name}</label>)}
          </div>
          <button className="js-button is-wide" style={{ marginTop:12 }} onClick={saveFinalists}>候補を確定して投票へ</button>
        </div>
      </> : <>
        <div className="js-card">
          <div className="js-card-head"><h3 className="js-card-title">決勝進出組</h3><span className="js-small-tag">{data.finalists.length}組</span></div>
          {candidatesForVote.map((performer) => <div className="js-ranking-item" key={performer.id}><div className="js-rank-no">・</div><div className="js-rank-name">{performer.name}</div><span className="js-mini-label">{rankRows.find((row) => row.performer.id === performer.id)?.rank ?? "—"}位</span></div>)}
          {!data.votesPublished && <button className="js-subtle-link" onClick={() => { setFinalistDraft(data.finalists); update({ finalists: [] }); }}>候補を選び直す</button>}
        </div>
        <FinalVoteBoard
          judges={data.judges.map((judge) => ({ id: judge.id, name: judge.self ? data.nickname : judge.name }))}
          candidates={candidatesForVote.map((performer) => ({ id: performer.id, name: performer.name }))}
          votes={votePublished ? currentVoteMap : {}}
          published={votePublished}
          sequenceKey={`${data.runoffDone ? "runoff" : "final"}:${data.finalists.join(",")}`}
          onComplete={() => setFinalVoteRevealComplete(true)}
        />
        {!votePublished ? <>
          <div className="js-card">
            <div className="js-card-head"><h3 className="js-card-title">{data.runoffDone ? "再投票" : "あなたの投票"}</h3><span className="js-small-tag">1人1票</span></div>
            <div className="js-vote-grid">{activeCandidates.map((id) => {
              const performer = data.performers.find((item) => item.id === id);
              return performer && <label className={`js-vote-option ${(data.runoffDone ? runoffVote : vote) === id ? "is-selected" : ""}`} key={id}><input type="radio" name="final-vote" value={id} checked={(data.runoffDone ? runoffVote : vote) === id} onChange={() => data.runoffDone ? setRunoffVote(id) : setVote(id)} />{performer.name}</label>;
            })}</div>
            <div className="js-card-note" style={{ marginTop:10 }}>{Object.keys(data.runoffDone ? data.runoffVotes : data.votes).length} / {data.judges.length} 名が投票済み（デモ含む）</div>
            <div className="js-submit-row"><button className="js-button is-quiet" onClick={() => { setVote("");setRunoffVote(""); }}>選択をクリア</button><button className="js-button" onClick={() => setDialog(data.runoffDone ? "runoff" : "final-vote")}>{data.runoffDone ? "再投票を保存" : "投票を保存"}</button></div>
            {data.votes.me && !data.runoffDone && <button className="js-subtle-link" onClick={() => setVote(data.votes.me)}>投票を修正</button>}
          </div>
          <div className="js-card">
            <div className="js-card-head"><h3 className="js-card-title">デモ審査員の投票</h3><span className="js-small-tag">ローカル体験</span></div>
            <p className="js-card-note">他の審査員の票をデモとして作成します。公開前ならあなたの票も変更できます。</p>
            <button className="js-button is-quiet is-wide" style={{ marginTop:10 }} onClick={() => {
              const others = data.judges.filter((judge) => !judge.self);
              let next = data;
              others.forEach((judge, index) => {
                if (!currentVoteMap[judge.id]) next = saveVote(next, judge.id, activeCandidates[(index + data.rounds.length) % Math.max(1, activeCandidates.length)], data.runoffDone);
              });
              setData(next);
              inform("デモ審査員の投票を用意しました");
            }}>デモ票を用意する</button>
          </div>
          <button className="js-button is-wide" disabled={!allVoted} onClick={() => setDialog(data.runoffDone ? "open-runoff" : "open-votes")}>幹事が投票を公開 <ChevronRight size={15} /></button>
        </> : <>
          {runoffNeeded && finalVoteRevealComplete && <div className="js-card">
            <div className="js-card-head"><h3 className="js-card-title">同票のため再投票</h3><span className="js-small-tag">同票組のみ</span></div>
            <p className="js-card-note">最多票が同数です。同票の候補だけでもう一度投票します。</p>
            {!data.runoffDone && <button className="js-button is-wide" style={{ marginTop:10 }} onClick={() => { setData(startRunoff(data)); setRunoffVote(""); inform("再投票を開始しました"); }}>同票候補で再投票へ</button>}
          </div>}
          {data.runoffDone && !data.runoffPublished && <div className="js-card"><h3 className="js-card-title">再投票を公開</h3><p className="js-card-note">全員の再投票が集まってから公開します。</p><button className="js-button is-wide" style={{ marginTop:10 }} disabled={!data.judges.every((judge) => data.runoffVotes[judge.id])} onClick={() => setDialog("open-runoff")}>再投票を公開</button></div>}
          {finalVoteRevealComplete && <button className="js-button is-wide" disabled={runoffNeeded} onClick={() => navTo("result")}>最終結果を見る <ChevronRight size={15} /></button>}
        </>}
      </>}
    </main>;
  };

  const renderResult = () => <main className="js-content">
    <div className="js-eyebrow">FINAL RESULTS　／　今夜の審査</div>
    <h1 className="js-title">テレビの前の、<br />私たちの結論。</h1>
    <div className="js-result-hero"><div className="js-laurel">WINNER　／　投票結果</div><div className="js-result-winner">{champions.map((id) => data.performers.find((item) => item.id === id)?.name).filter(Boolean).join("　／　") || "投票結果を公開してください"}</div><div className="js-card-note">{champions.length > 1 ? "再投票も同票のため、同率優勝です。" : "決勝候補への投票から算出した結果です。"}</div></div>
    <div className="js-card">
      <div className="js-card-head"><h3 className="js-card-title">グループ総合順位</h3><span className="js-small-tag">公開ラウンド</span></div>
      {rankRows.map((row) => <div className="js-ranking-item" key={row.performer.id}><div className="js-rank-no">{row.rank}</div><div><div className="js-rank-name">{row.performer.name}</div><div className="js-rank-detail">{row.count}人の合計</div></div><div className="js-rank-total">{row.total}<small> 点</small></div></div>)}
      {ownRank && <p className="js-card-note">あなたの合計点だけで見ると、公開済みの {data.rounds.length} 組中 {personalRank(ownRank.performer.id) ?? "—"} 位です。</p>}
    </div>
    <div className="js-card">
      <div className="js-card-head"><h3 className="js-card-title">あなたの採点だけの順位</h3><span className="js-small-tag">個人視点</span></div>
      {personalRows.map((row) => <div className="js-ranking-item" key={row.performer.id}><div className="js-rank-no">{row.rank}</div><div className="js-rank-name">{row.performer.name}</div><div className="js-rank-total">{personalScore(row.performer.id)}<small> 点</small></div></div>)}
    </div>
    <div className="js-card">
      <div className="js-card-head"><h3 className="js-card-title">公開採点表</h3><span className="js-small-tag">全員の点数</span></div>
      <div className="js-table-wrap"><table className="js-table"><thead><tr><th>コンビ</th>{data.judges.map((judge)=><th key={judge.id}>{judge.self?data.nickname:judge.name}</th>)}<th>合計</th></tr></thead><tbody>{data.rounds.map((round)=><tr key={round.performerId}><td>{data.performers.find((item)=>item.id===round.performerId)?.name}</td>{data.judges.map((judge)=><td key={judge.id}>{round.scores[judge.id]??"—"}</td>)}<td>{Object.values(round.scores).reduce((sum,value)=>sum+value,0)}</td></tr>)}</tbody></table></div>
    </div>
    <div className="js-card">
      <div className="js-card-head"><h3 className="js-card-title">決勝投票の履歴</h3><span className="js-small-tag">名前付き</span></div>
      {data.judges.map((judge) => <div className="js-card-head" style={{ padding:"9px 2px",borderBottom:"1px solid rgba(255,255,255,.06)" }} key={judge.id}><span className="js-mini-label">{judge.self?data.nickname:judge.name}</span><span className="js-mini-label">{data.performers.find((item)=>item.id===data.votes[judge.id])?.name??"未投票"}</span></div>)}
      {data.runoffDone && <><div className="js-overline">再投票</div>{data.judges.map((judge)=><div className="js-card-head" style={{padding:"8px 2px"}} key={`run-${judge.id}`}><span className="js-mini-label">{judge.self?data.nickname:judge.name}</span><span className="js-mini-label">{data.performers.find((item)=>item.id===data.runoffVotes[judge.id])?.name??"未投票"}</span></div>)}</>}
    </div>
    <button className="js-button is-wide" onClick={() => navTo("ranking")}><Award size={15} /> 順位表へ戻る</button>
    <button className="js-subtle-link" onClick={() => navTo("room")}>幹事席へ戻る</button>
  </main>;

  const activeNav: View = ["room", "lobby"].includes(view) ? "room" : view === "ranking" || view === "result" || view === "finale" ? "ranking" : "score";

  return <div className="js-app">
    <div className="js-grain" />
    {renderTop()}
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={view} initial={reducedMotion ? { opacity:1 } : { opacity:0, y:view === "reveal" ? 0 : 8 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0,y:-5 }} transition={{ duration:.2 }}>
        {view === "score" && renderScore()}
        {view === "room" && renderRoom()}
        {view === "lobby" && renderLobby()}
        {view === "ranking" && renderRanking()}
        {view === "reveal" && renderReveal()}
        {view === "finale" && renderFinale()}
        {view === "result" && renderResult()}
      </motion.div>
    </AnimatePresence>
    <nav className="js-bottom-nav" aria-label="メインメニュー">
      <button className={`js-nav-btn ${activeNav === "score" ? "is-active" : ""}`} onClick={() => navTo("score")}><Award /><span>審査</span></button>
      <button className={`js-nav-btn ${activeNav === "ranking" ? "is-active" : ""}`} onClick={() => navTo("ranking")}><Trophy /><span>順位</span></button>
      <button className={`js-nav-btn ${activeNav === "room" ? "is-active" : ""}`} onClick={() => navTo(data.roomStarted ? "room" : "lobby")}><Users /><span>ルーム</span></button>
    </nav>
    <AnimatePresence>{toast && <motion.div className="js-toast" initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0,y:6 }}>{toast}</motion.div>}</AnimatePresence>

    <AnimatePresence>
      {dialog && <motion.div className="js-modal-backdrop" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} onClick={() => setDialog(null)}>
        <motion.div className="js-modal" initial={{ y:12,opacity:0 }} animate={{ y:0,opacity:1 }} exit={{ y:8,opacity:0 }} onClick={(event) => event.stopPropagation()}>
          {dialog === "open" && <><h2>点数をオープンしますか？</h2><p>全審査員の点数が一斉に公開されます。公開後は、あなたも幹事も変更できません。</p><div className="js-modal-actions"><button className="js-button is-quiet" onClick={() => setDialog(null)}>戻る</button><button className="js-button" onClick={publishCurrent}>公開する</button></div></>}
          {dialog === "reset" && <><h2>新しいデモルームを作成</h2><p>保存済みの採点・投票をこの端末から置き換えます。現在の結果を引き継がない場合のみ進んでください。</p><div className="js-modal-actions"><button className="js-button is-quiet" onClick={() => setDialog(null)}>やめる</button><button className="js-button is-danger" onClick={createFreshRoom}>新規作成</button></div></>}
          {dialog === "start" && <><h2>このメンバーで審査開始</h2><p>開始後は審査メンバーと出場者を編集できません。審査員 {data.judges.length} 名、出場者 {data.performers.length} 組で始めます。</p><div className="js-modal-actions"><button className="js-button is-quiet" onClick={() => setDialog(null)}>戻る</button><button className="js-button" onClick={startRoom}>開始する</button></div></>}
          {dialog === "final-vote" && <><h2>決勝の投票を保存</h2><p>あなたの票を保存します。幹事が公開するまでは修正できます。公開後は変更できません。</p><div className="js-modal-actions"><button className="js-button is-quiet" onClick={() => setDialog(null)}>戻る</button><button className="js-button" onClick={submitVote}>保存</button></div></>}
          {dialog === "runoff" && <><h2>再投票を保存</h2><p>同票候補への再投票を保存します。公開前は修正できます。</p><div className="js-modal-actions"><button className="js-button is-quiet" onClick={() => setDialog(null)}>戻る</button><button className="js-button" onClick={submitRunoffVote}>保存</button></div></>}
          {dialog === "open-votes" && <><h2>決勝投票を公開しますか？</h2><p>票の選択は確定し、名前付きで一斉公開します。結果は取り消せません。</p><div className="js-modal-actions"><button className="js-button is-quiet" onClick={() => setDialog(null)}>戻る</button><button className="js-button" onClick={() => openVotes(false)}>公開する</button></div></>}
          {dialog === "open-runoff" && <><h2>再投票を公開しますか？</h2><p>再投票の票を確定して公開します。再び同票なら同率優勝です。</p><div className="js-modal-actions"><button className="js-button is-quiet" onClick={() => setDialog(null)}>戻る</button><button className="js-button" onClick={() => openVotes(true)}>公開する</button></div></>}
        </motion.div>
      </motion.div>}
    </AnimatePresence>
  </div>;
}
