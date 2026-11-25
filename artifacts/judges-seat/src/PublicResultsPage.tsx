import { useCallback, useEffect, useRef, useState } from "react";
import { getSharedResults, type PublicBallot, type PublicResults } from "@workspace/api-client-react";
import { champions, publicRankings } from "./share-export";
import "./judges-theme.css";
import "./judges-overrides.css";
import "./production.css";

function useMeta(name: string, content: string) {
  useEffect(() => {
    let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    const created = !el; const prev = el?.content;
    if (!el) { el = document.createElement("meta"); el.name = name; document.head.appendChild(el); }
    el.content = content;
    return () => { if (created) el!.remove(); else if (prev !== undefined) el!.content = prev; };
  }, [name, content]);
}

function Ballot({ r, b, label }: { r: PublicResults; b: PublicBallot; label: string }) {
  if (!b.published) return null;
  const name = (id?: string) => r.performers.find(p => p.id === id)?.name ?? "—";
  return <section className="js-card"><h3 className="js-card-title">{label}</h3>
    {b.candidates.map(id => <div className="js-ranking-item public-vote-tally" key={id}><span className="js-rank-name">{name(id)}</span><strong className="num">{Object.values(b.votes).filter(v => v === id).length}票</strong></div>)}
    {r.members.map(m => <div className="history-line" key={m.id}><span>{m.name}</span><strong>{name(b.votes[m.id])}</strong></div>)}
  </section>;
}

export function PublicResultsPage({ token }: { token: string }) {
  useMeta("robots", "noindex, nofollow, noarchive");
  useMeta("referrer", "no-referrer");
  const [data, setData] = useState<PublicResults | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const gen = useRef(0);
  const load = useCallback(async () => {
    const g = ++gen.current;
    if (!/^[A-Za-z0-9_-]{48}$/.test(token)) {
      setData(null); setError("このリンクは無効・停止中、または期限切れです"); setLoading(false); return;
    }
    try {
      // Preview routing may require its own same-origin cookie. The app's
      // HttpOnly participant cookie is scoped to /api/rooms and is not sent
      // to /api/shared-results; this endpoint never uses participant identity.
      const res = await getSharedResults(encodeURIComponent(token), { cache: "no-store", credentials: "same-origin", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(12000) });
      if (g !== gen.current) return;
      if (Date.parse(res.expiresAt) <= Date.now()) { setData(null); setError("保存期限が切れました"); }
      else { setData(res); setError(""); }
    } catch (e) {
      if (g !== gen.current) return;
      const status = (e as { status?: number })?.status;
      setData(null);
      setError(status === 404 || status === 410 || status === 403 ? "このリンクは無効・停止中、または期限切れです" : "結果を読み込めませんでした");
    } finally { if (g === gen.current) setLoading(false); }
  }, [token]);
  useEffect(() => {
    setData(null); setLoading(true); void load();
    const vis = () => { if (document.visibilityState === "visible") void load(); };
    const on = () => void load();
    window.addEventListener("focus", on); window.addEventListener("pageshow", on); document.addEventListener("visibilitychange", vis);
    const t = window.setInterval(vis, 30000);
    return () => { gen.current++; window.removeEventListener("focus", on); window.removeEventListener("pageshow", on); document.removeEventListener("visibilitychange", vis); window.clearInterval(t); };
  }, [load]);
  useEffect(() => {
    if (!data) return;
    const ms = Date.parse(data.expiresAt) - Date.now();
    if (ms > 2 ** 31 - 1) return;
    const t = window.setTimeout(() => { setData(null); setError("保存期限が切れました"); }, Math.max(0, ms));
    return () => window.clearTimeout(t);
  }, [data]);
  useEffect(() => {
    const previous = document.title;
    document.title = data ? `${data.title}｜結果閲覧｜審査員席` : "結果閲覧｜審査員席";
    return () => { document.title = previous; };
  }, [data?.title]);

  const name = (id: string) => data?.performers.find(p => p.id === id)?.name ?? "—";
  const ranks = data ? publicRankings(data) : [];
  const champs = data ? champions(data) : [];
  return <div className="js-app"><div className="js-grain"/>
    <header className="js-topbar"><div className="js-brand"><div className="js-mark"><span>審</span></div><div><div className="js-brand-title">審査員席</div><span className="js-brand-sub">SHARED RESULTS</span></div></div><span className="js-demo-tag">閲覧専用</span></header>
    <main className="js-content public-results">
      {loading && !data ? <><div className="share-skeleton is-short"/><div className="share-skeleton"/></> :
      !data ? <section className="js-card" data-testid="panel-public-error"><h1 className="js-card-title">結果を表示できません</h1><p className="js-card-note">{error}</p>
        <button className="js-button is-wide" onClick={() => { setLoading(true); void load(); }} data-testid="button-retry-public">再読み込み</button></section> : <>
        <div className="js-eyebrow">RESULTS ／ 公開済みのみ</div>
        <h1 className="js-title" data-testid="text-public-title">{data.title}</h1>
        <section className="js-result-hero"><div className="js-laurel">{champs.length > 1 ? "同率優勝" : "優勝"}</div><h2 className="js-result-winner" data-testid="text-champion">{champs.length ? champs.map(name).join(" ／ ") : "未確定"}</h2></section>
        <section className="js-card"><h3 className="js-card-title">総合順位</h3>
          {!ranks.length && <p className="js-card-note">点数はまだ公開されていません。</p>}
          {ranks.map(r => <div className="js-ranking-item" key={r.id}><strong className="js-rank-no">{r.rank}</strong><span className="js-rank-name">{name(r.id)}</span><strong className="js-rank-total">{r.total}<small>点</small></strong></div>)}
        </section>
        {!!data.rounds.length && <section className="js-card"><h3 className="js-card-title">審査員 {data.members.length}名の採点表</h3><div className="js-table-wrap"><table className="js-table"><thead><tr><th>コンビ</th>{data.members.map(m => <th key={m.id}>{m.name}</th>)}<th>合計</th></tr></thead>
          <tbody>{data.rounds.map(r => <tr key={r.performerId}><td>{name(r.performerId)}</td>{data.members.map(m => <td key={m.id}>{r.scores[m.id] ?? "—"}</td>)}<td>{ranks.find(x => x.id === r.performerId)?.total}</td></tr>)}</tbody></table></div></section>}
        <Ballot r={data} b={data.final} label="最終決戦の投票内訳"/>
        <Ballot r={data} b={data.runoff} label="再投票の内訳"/>
        <p className="js-footnote">閲覧専用。幹事がリンクを停止するか、{new Date(data.expiresAt).toLocaleString("ja-JP")} の期限を過ぎると表示されなくなります。非公式の観戦用アプリです。</p>
      </>}
    </main>
  </div>;
}
