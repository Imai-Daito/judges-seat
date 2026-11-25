import { useState } from "react";
import type { RoomAction, RoomSnapshot } from "./room-client";
import { VoteHistory, winningIds } from "./Results";
import { FinalVoteBoard } from "./FinalVoteBoard";

export function Finale({room, act, busy}: {room: RoomSnapshot; act: (a: Omit<RoomAction,"version">) => Promise<RoomSnapshot | null>; busy: boolean}) {
  const host = room.me === room.hostId, runoff = room.runoff.candidates.length > 0;
  const ballot = runoff ? room.runoff : room.final;
  const [candidates, setCandidates] = useState<string[]>([]);
  const [choice, setChoice] = useState("");
  const [completedSequence, setCompletedSequence] = useState("");
  const sequenceKey = `${room.id}:${runoff ? "runoff" : "final"}:${room.final.candidates.join(",")}`;
  const revealDone = ballot.published && completedSequence === sequenceKey;
  const firstWinners = winningIds(room.final);
  const name = (id: string) => room.performers.find(p => p.id === id)?.name;
  return <>
    <div className="js-eyebrow">FINAL VOTE ／ {runoff ? "一度だけの再投票" : "最終決戦"}</div>
    <h1 className="js-title">{runoff ? "再投票" : "最終決戦"}</h1>
    {!room.final.candidates.length ? host ? <section className="js-card"><h3 className="js-card-title">番組の実際の進出組を指定</h3><p className="js-card-note">1本目の順位とは別に、幹事が2組以上選んで確定します。</p>
      {room.performers.map(p => <label className="js-final-candidate" key={p.id}><input type="checkbox" checked={candidates.includes(p.id)} onChange={e => setCandidates(old => e.target.checked ? [...old,p.id] : old.filter(id => id !== p.id))}/>{p.name}</label>)}
      <button className="js-button is-wide" disabled={busy || candidates.length<2 || room.rounds.length !== room.performers.length} onClick={() => { if (window.confirm("この候補で最終決戦を始めます。候補は確定後に変更できません。")) void act({type:"finalists", candidates}); }}>候補を確定する</button>
      {room.rounds.length !== room.performers.length && <p className="js-hint">全組の採点公開後に進めます。</p>}
    </section> : <p className="js-callout">幹事が決勝候補を指定するのを待っています。</p> : <>
      {!ballot.published && <section className="js-card">
        <h3 className="js-card-title">投票先</h3>
        <p className="js-card-note">公開前は修正できます。公開後は変更不可です。</p>
        <div className="js-vote-grid">{ballot.candidates.map(id => <label className="js-vote-option" key={id}><input type="radio" name={`vote-${runoff}`} checked={(choice || ballot.ownVote) === id} onChange={() => setChoice(id)}/>{name(id)}</label>)}</div>
        <button className="js-button is-wide" disabled={busy || !ballot.candidates.includes(choice || ballot.ownVote || "")} onClick={async () => {
          if (await act({type:"vote", performerId: choice || ballot.ownVote!, runoff})) setChoice("");
        }}>{ballot.ownVote ? "投票を修正して保存" : "投票を送信"}</button>
        {ballot.ownVote && <p role="status" className="js-hint">保存済み：{name(ballot.ownVote)}</p>}
        <p>{ballot.submitted.length} / {room.members.length} 名が提出済み</p>
        <div className="js-judge-list">{room.members.map(m => <span className="js-judge-chip" key={m.id}>{m.name} {ballot.submitted.includes(m.id) ? "✓" : "待機"}</span>)}</div>
        {host ? <button className="js-button is-wide" disabled={busy || ballot.submitted.length !== room.members.length} onClick={() => { if (window.confirm("全員の票を名前付きで公開します。公開後は変更できません。")) void act({type:"publishVote",runoff}); }}>全員の投票を公開</button> : <p className="js-hint">全員の投票がそろったら、幹事が公開します。</p>}
      </section>}
      <FinalVoteBoard
        judges={room.members}
        candidates={room.final.candidates.map(id => ({ id, name: name(id) ?? id }))}
        votes={ballot.published ? ballot.votes : {}}
        published={ballot.published}
        sequenceKey={sequenceKey}
        title={runoff ? "FINAL JUDGE · RUNOFF" : "FINAL JUDGE"}
        onComplete={() => setCompletedSequence(sequenceKey)}
      />
      {runoff && <VoteHistory room={room} ballot={room.final} label="初回の公開票" />}
      {revealDone && room.final.published && firstWinners.length > 1 && !runoff && <section className="js-card"><h3 className="js-card-title">最多同票：一度だけ再投票</h3><p>{firstWinners.map(name).join(" ／ ")}</p>{host ? <button className="js-button is-wide" disabled={busy} onClick={() => { setChoice(""); void act({type:"runoff"}); }}>同票の組で再投票を始める</button> : <p>幹事が再投票を始めるのを待っています。</p>}</section>}
      {revealDone && (room.runoff.published || room.final.published && firstWinners.length===1) && <section className="js-result-hero"><div className="js-laurel">CHAMPION</div><h2 className="js-result-winner">{winningIds(room.runoff.published ? room.runoff : room.final).map(name).join(" ／ ")}</h2>{room.runoff.published && winningIds(room.runoff).length>1 && <p>再び同票のため同率優勝です。</p>}</section>}
    </>}
  </>;
}
