import { ShareResults } from "./ShareResults";
import type { RoomSnapshot, VoteState } from "./room-client";

export function rankings(room: RoomSnapshot, own = false) {
  const rows = room.rounds.map(r => ({
    id: r.performerId,
    total: own ? r.scores[room.me] : Object.values(r.scores).reduce((a,b) => a+b,0),
  })).sort((a,b) => b.total-a.total);
  return rows.map(r => ({ ...r, rank: rows.findIndex(x => x.total === r.total)+1 }));
}
export function winningIds(b: VoteState) {
  if (!b.published) return [];
  const counts = b.candidates.map(id => ({ id, count: Object.values(b.votes).filter(v => v === id).length }));
  return counts.filter(c => c.count === Math.max(...counts.map(x => x.count))).map(c => c.id);
}
export function VoteHistory({room, ballot, label}: {room: RoomSnapshot; ballot: VoteState; label: string}) {
  if (!ballot.published) return null;
  const name = (id: string) => room.performers.find(p => p.id === id)?.name;
  return <section className="js-card"><h3 className="js-card-title">{label}</h3>
    {ballot.candidates.map(id => <div className="js-ranking-item" key={id}><span className="js-rank-name">{name(id)}</span><strong>{Object.values(ballot.votes).filter(v => v === id).length}票</strong></div>)}
    {room.members.map(m => <div className="history-line" key={m.id}><span>{m.name}</span><strong>{name(ballot.votes[m.id])}</strong></div>)}
  </section>;
}
export function Results({ room, replay }: {room: RoomSnapshot; replay: () => void}) {
  const group = rankings(room), mine = rankings(room, true);
  const name = (id: string) => room.performers.find(p => p.id === id)?.name;
  const first = winningIds(room.final);
  const champions = room.runoff.published ? winningIds(room.runoff) : first.length === 1 ? first : [];
  return <>
    <div className="js-eyebrow">LEADERBOARD ／ 公開済みのみ</div><h1 className="js-title">Results</h1>
    {champions.length > 0 && <section className="js-result-hero"><div className="js-laurel">{champions.length > 1 ? "SHARED CHAMPION" : "CHAMPION"}</div><h2 className="js-result-winner">{champions.map(name).join(" ／ ")}</h2>{champions.length > 1 && <p>再投票も同票のため同率優勝</p>}</section>}
    <section className="js-card"><h3 className="js-card-title">総合順位と、あなたの順位</h3>
      {group.length === 0 && <p className="js-card-note">点数はまだ公開されていません。</p>}
      {group.map(r => <div className="js-ranking-item" key={r.id}><strong className="js-rank-no">{r.rank}</strong><div><div className="js-rank-name">{name(r.id)}</div><small>あなた {mine.find(m => m.id === r.id)?.rank}位・{mine.find(m => m.id === r.id)?.total}点</small></div><strong className="js-rank-total">{r.total}<small>点</small></strong></div>)}
    </section>
    <section className="js-card"><h3 className="js-card-title">あなたの点数だけの順位</h3>{mine.map(r => <div className="js-ranking-item" key={r.id}><strong className="js-rank-no">{r.rank}</strong><span className="js-rank-name">{name(r.id)}</span><strong>{r.total}点</strong></div>)}</section>
    <section className="js-card"><h3 className="js-card-title">全員の公開採点表</h3><div className="js-table-wrap"><table className="js-table"><thead><tr><th>コンビ</th>{room.members.map(m => <th key={m.id}>{m.name}</th>)}<th>合計</th></tr></thead><tbody>{room.rounds.map(r => <tr key={r.performerId}><td>{name(r.performerId)}</td>{room.members.map(m => <td key={m.id}>{r.scores[m.id]}</td>)}<td>{group.find(g => g.id === r.performerId)?.total}</td></tr>)}</tbody></table></div></section>
    <VoteHistory room={room} ballot={room.final} label="最終決戦の投票内訳" />
    <VoteHistory room={room} ballot={room.runoff} label="再投票の内訳" />
    {!!room.rounds.length && <button className="js-button is-wide" onClick={replay}>点数発表を再生</button>}
    <ShareResults room={room} />
    <p className="js-footnote">公開後の点数と票は幹事も変更できません。</p>
  </>;
}
