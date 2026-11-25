import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Award, Trophy, Users, Copy, ChevronRight, Minus, Plus } from "lucide-react";
import { useRoom, type RoomInput, type ScoreRound } from "./room-client";
import { Results } from "./Results";
import { Finale } from "./Finale";
import { Reveal } from "./Reveal";
import { PublicResultsPage } from "./PublicResultsPage";
import "./judges-theme.css";
import "./judges-overrides.css";
import "./production.css";

const roster = ["令和ロマン","ヤーレンズ","真空ジェシカ","マユリカ","ダイタク","ジョックロック","バッテリィズ","ママタルト","エバース","トム・ブラウン"];
const readLast = () => { try { return localStorage.getItem("judges-last-room") || ""; } catch { return ""; } };
const fromUrl = () => new URLSearchParams(location.search).get("room") || "";

const hashToken = () => { if (!location.hash.startsWith("#results")) return null; const m = location.hash.match(/^#results=([^&]+)$/); if (!m) return ""; try { return decodeURIComponent(m[1]); } catch { return ""; } };

export default function App() {
  const [token, setToken] = useState(hashToken);
  useEffect(() => { const h = () => setToken(hashToken()); window.addEventListener("hashchange", h); window.addEventListener("popstate", h); return () => { window.removeEventListener("hashchange", h); window.removeEventListener("popstate", h); }; }, []);
  return token !== null ? <PublicResultsPage key={token} token={token}/> : <RoomApp/>;
}

function RoomApp() {
  const [id, setId] = useState(fromUrl);
  const { room, access, error, connection, busy, create, join, act, refresh } = useRoom(id);
  const [nickname, setNickname] = useState("");
  const [title, setTitle] = useState("M-1グランプリ 2024");
  const [names, setNames] = useState(roster.join("\n"));
  const [view, setView] = useState<"score"|"room"|"ranking"|"finale">("score");
  const [score, setScore] = useState("");
  const [editing, setEditing] = useState(false);
  const [reveal, setReveal] = useState<{ round: ScoreRound; replay: boolean } | null>(null);
  const [notice, setNotice] = useState("");
  const seen = useRef<string | null>(null);
  const openedRoom = useRef("");
  const host = !!room && room.me === room.hostId;
  const performer = room?.performers.find(p => p.id === room.activeId);
  const invite = `${location.origin}${import.meta.env.BASE_URL}?room=${encodeURIComponent(id)}`;
  function navigateRoom(value: string) {
    history.pushState({}, "", value ? `${import.meta.env.BASE_URL}?room=${encodeURIComponent(value)}` : import.meta.env.BASE_URL);
    setId(value); setReveal(null); seen.current = null; openedRoom.current = "";
  }
  useEffect(() => { const pop = () => { setId(fromUrl()); openedRoom.current = ""; seen.current=null; setReveal(null); }; window.addEventListener("popstate",pop); return () => window.removeEventListener("popstate",pop); },[]);
  useEffect(() => { setScore(""); setEditing(false); },[room?.activeId]);
  useEffect(() => {
    if (!room || room.id !== id) return;
    try { localStorage.setItem("judges-last-room",room.id); } catch { /* Invitation can still be copied. */ }
    const latest = room.rounds.at(-1);
    if (openedRoom.current !== room.id) {
      openedRoom.current = room.id; seen.current = latest?.performerId || null;
      setTitle(room.title); setNames(room.performers.map(p => p.name).join("\n"));
      if (latest && latest.publishedAt + room.members.length*1600+2000 > room.serverTime) setReveal({round:latest,replay:false});
      return;
    }
    if (latest && seen.current !== latest.performerId) {
      seen.current = latest.performerId; setReveal({round:latest,replay:false});
    }
  },[room,id]);
  useEffect(() => { if (!notice) return; const t = window.setTimeout(() => setNotice(""),3000); return () => window.clearTimeout(t); },[notice]);
  const addDigit = (digit: string) => { setEditing(true); setScore(old => { const s=(old+digit).replace(/^0+(?=\d)/,""); return s.length<=3 ? s : old; }); };
  const adjust = (delta: number) => { setEditing(true); setScore(old => String(Math.max(0,Math.min(100,Number(old || 0)+delta)))); };
  const saveScore = async () => {
    if (!room?.activeId || !/^\d{1,3}$/.test(score) || Number(score)>100) return;
    if (await act({type:"score",performerId:room.activeId,score:Number(score)})) { setEditing(false); setScore(""); setNotice("点数を保存しました"); }
  };
  const handleCreate = async () => {
    const result=await create({nickname:nickname.trim(),title:title.trim(),performers:names.split("\n").map(n=>n.trim()).filter(Boolean),retentionDays:30 as RoomInput["retentionDays"]});
    if (result) navigateRoom(result.id);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(invite); setNotice("招待リンクをコピーしました"); } catch { setNotice("下の招待リンクを長押ししてコピーしてください"); } };
  const top = <header className="js-topbar"><div className="js-brand"><div className="js-mark"><span>審</span></div><div><div className="js-brand-title">審査員席</div><span className="js-brand-sub">M-1 WATCHING ROOM</span></div></div><span className="js-demo-tag">{room && room.id===id ? connection : "LIVE ROOM"}</span></header>;
  const entry = !id || access;
  return <div className="js-app"><div className="js-grain"/>{top}
    <main className="js-content">
    {error && <div role="alert" className="js-callout">{error}<button className="js-subtle-link" onClick={() => void refresh()}>再接続する</button></div>}
    {entry ? <>
      <h1 className="js-title">{id ? "ルームに参加" : "ルームを作成"}</h1>
      <section className="js-card">
        <label className="js-field-label" htmlFor="nickname">あなたのニックネーム</label><input id="nickname" className="js-input" value={nickname} maxLength={10} onChange={e=>setNickname(e.target.value)} placeholder="10文字以内"/>
        {!id && <>
          <label className="js-field-label" htmlFor="title">大会・年度</label><input id="title" className="js-input" maxLength={60} value={title} onChange={e=>setTitle(e.target.value)}/>
          <label className="js-field-label" htmlFor="names">コンビ一覧（1行に1組・2〜30組）</label><textarea id="names" className="js-input" rows={6} value={names} onChange={e=>setNames(e.target.value)}/>
          <p className="js-hint">2024年の編集用プリセットです。公式出場順ではありません。</p>
          <p className="js-hint">部屋・点数・投票は作成から30日間保存。期限後はアクセスできなくなり、稼働中は1時間以内にサーバーから削除されます。</p>
        </>}
        <button className="js-button is-wide" disabled={busy || !nickname.trim() || !id && !title.trim()} onClick={() => id ? void join(nickname) : void handleCreate()}>{busy ? "送信中…" : id ? "ニックネームで参加する" : "ルームを作成する"}<ChevronRight size={16}/></button>
        <p className="js-hint">ログイン不要。同じブラウザーのCookieで席を復元します。Cookieを消すと幹事権限や参加席を復元できません。開始後の新規参加はできません。</p>
      </section>
      {!id && readLast() && <button className="js-button is-quiet is-wide" onClick={()=>navigateRoom(readLast())}>前のルームへ戻る</button>}
      {id && <button className="js-subtle-link" onClick={()=>navigateRoom("")}>自分のルームを新しく作る</button>}
      <p className="js-footnote">非公式の観戦用アプリです。番組・主催者とは関係ありません。体験データの自動入力はありません。</p>
    </> : !room || room.id!==id ? <section className="js-card"><h1 className="js-card-title">ルームに接続しています</h1><p>保存済みの席と最新の進行を確認しています。</p><button className="js-button" onClick={()=>void refresh()}>もう一度接続</button><button className="js-subtle-link" onClick={()=>navigateRoom("")}>新しいルームを作る</button></section> :
    reveal ? <Reveal key={`${reveal.round.performerId}-${reveal.replay}`} room={room} round={reveal.round} replay={reveal.replay} close={()=>{setReveal(null);setView("ranking");}}/> :
    view==="ranking" ? <Results room={room} replay={()=>setReveal({round:room.rounds.at(-1)!,replay:true})}/> :
    view==="finale" ? <Finale key={`${room.id}-${room.runoff.candidates.length}`} room={room} act={act} busy={busy}/> :
    view==="room" || !room.started ? <>
      <h1 className="js-title">{host ? "ルーム設定" : "ルーム"}</h1><p className="js-subtitle">{room.title}</p>
      <section className="js-card"><h2 className="js-card-title">{room.started ? "参加締切・同じ席への再接続のみ" : "友達を招待する"}</h2><div className="qr"><QRCodeSVG value={invite} size={208} level="M" marginSize={4}/></div><button className="js-button is-wide" onClick={()=>void copy()}><Copy size={14}/>招待リンクをコピー</button><a className="invite-link" href={invite}>{invite}</a></section>
      <section className="js-card"><h2 className="js-card-title">審査員 {room.members.length}名</h2>{room.members.map(m=><div className="history-line" key={m.id}><strong>{m.name}{m.id===room.me ? "（あなた）" : ""}</strong><span>{m.id===room.hostId ? "幹事" : "審査員"}</span></div>)}<p className="js-card-note">開始時にメンバーを固定します。全員の提出が必要なので、参加を確認してから開始してください。</p></section>
      <section className="js-card"><h2 className="js-card-title">大会・出場者</h2>{host && !room.started ? <>
        <label htmlFor="edit-title" className="js-field-label">大会・年度</label><input id="edit-title" className="js-input" value={title} maxLength={60} onChange={e=>setTitle(e.target.value)}/>
        <label htmlFor="edit-names" className="js-field-label">コンビ一覧（1行に1組）</label><textarea id="edit-names" className="js-input" rows={8} value={names} onChange={e=>setNames(e.target.value)}/>
        <button className="js-button is-quiet is-wide" disabled={busy} onClick={async()=>{if(await act({type:"configure",title,names:names.split("\n").map(n=>n.trim()).filter(Boolean)}))setNotice("大会設定を保存しました");}}>大会設定を保存</button>
      </> : <p className="js-card-note">{room.performers.map(p=>p.name).join(" ／ ")}</p>}</section>
      {host && !room.started && <button className="js-button is-wide" disabled={busy || room.members.length<2} onClick={()=>{if(window.confirm(`審査員${room.members.length}名、${room.performers.length}組で開始します。新規参加と大会設定の編集を締め切ります。未保存の設定は反映されません。`))void act({type:"start"});}}>このメンバーで審査開始</button>}
      {!host && !room.started && <p className="js-callout">幹事が審査を開始するのを待っています。</p>}
      <p className="js-footnote">保存期限：{new Date(room.expiresAt).toLocaleString("ja-JP")}<br/>招待リンクを知る人が開始前に参加できます。信頼できる友達だけに共有してください。</p>
      <button className="js-subtle-link" onClick={()=>navigateRoom("")}>別の新しいルームを作る（この結果は残ります）</button>
    </> : <>
      <div className="js-eyebrow">ROUND {String(room.rounds.length+1).padStart(2,"0")} ／ {room.title}</div><h1 className="js-title">採点</h1>
      {performer && !room.final.candidates.length ? <>
        <section className="js-announce"><div className="js-ann-top"><small>NOW ON STAGE</small><i className="js-live-dot"/></div><div className="js-artist">{performer.name}</div><div className="js-progress"><span style={{width:`${room.rounds.length/room.performers.length*100}%`}}/></div></section>
        <div className="js-judge-head"><span className="js-mini-label">審査員</span><span>{room.submitted.length} / {room.members.length} 提出</span></div>
        <div className="js-judge-list">{room.members.map(m=><span className={`js-judge-chip ${m.id===room.me ? "is-you" : ""} ${room.submitted.includes(m.id) ? "is-done" : ""}`} key={m.id}>{m.name} {room.submitted.includes(m.id) ? "✓" : ""}</span>)}</div>
        {room.ownScore!==null && !editing ? <section className="js-wait-box"><div className="js-wait-number">{room.ownScore} 点</div><h3>送信済み</h3><p>公開までは他の審査員に見えません。</p><button className="js-button is-quiet" disabled={busy} onClick={()=>{setScore(String(room.ownScore));setEditing(true);}}>点数を修正</button></section> :
        <section className="js-score-zone"><div className="js-score-caption"><strong>あなたの採点</strong><span>0–100 ／ 1点刻み</span></div><div className="js-score-display" aria-live="polite"><span className={`js-score-number ${!score ? "is-blank" : ""}`}>{score || "— —"}</span></div>
          <div className="js-adjust"><button aria-label="1点下げる" onClick={()=>adjust(-1)}><Minus size={14}/> −1</button><button aria-label="1点上げる" onClick={()=>adjust(1)}><Plus size={14}/> ＋1</button></div>
          <div className="js-keypad">{["1","2","3","4","5","6","7","8","9","00","0","⌫"].map(key=><button className="js-key" aria-label={key==="⌫" ? "1桁消す" : key} key={key} onClick={()=>key==="⌫" ? setScore(old=>old.slice(0,-1)) : addDigit(key)}>{key}</button>)}</div>
          <div className="js-submit-row"><button className="js-button is-quiet" onClick={()=>setScore("")}>クリア</button><button className="js-button" disabled={busy || !/^\d{1,3}$/.test(score) || Number(score)>100} onClick={()=>void saveScore()}>点数を送信<ChevronRight size={14}/></button></div>
          <p className="js-hint">公開前は修正可能。通信が切れたときは、復帰後に送信してください。</p>
        </section>}
        {host && <section className="js-card"><h3 className="js-card-title">幹事の進行</h3><button className="js-button is-wide" disabled={busy || room.submitted.length!==room.members.length} onClick={()=>{if(window.confirm("全員の点数を公開します。公開後は幹事も含めて変更できません。"))void act({type:"publishScore",performerId:performer.id});}}>全員の点数をオープン</button>
          <label className="js-field-label" htmlFor="next">採点するコンビ（提出がある間は変更不可）</label><select id="next" className="js-input" disabled={busy || room.submitted.length>0} value={room.activeId || ""} onChange={e=>void act({type:"select",performerId:e.target.value})}>{room.performers.filter(p=>!room.rounds.some(r=>r.performerId===p.id)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </section>}
        {!host && <p className="js-hint">全員の提出後、幹事が点数を公開します。</p>}
      </> : <section className="js-card"><h2 className="js-card-title">全組の採点が完了</h2><p className="js-card-note">決勝候補は幹事が指定します。</p><button className="js-button is-wide" onClick={()=>setView("finale")}>最終決戦へ進む</button><button className="js-subtle-link" onClick={()=>setView("ranking")}>総合順位を見る</button></section>}
    </>}
    </main>
    {room && room.id===id && <nav className="js-bottom-nav" aria-label="メインメニュー">{([{key:"score",label:"審査",Icon:Award},{key:"ranking",label:"順位",Icon:Trophy},{key:"finale",label:"最終決戦",Icon:Trophy},{key:"room",label:"ルーム",Icon:Users}] as const).map(({key,label,Icon})=><button key={key} className={`js-nav-btn ${view===key ? "is-active" : ""}`} onClick={()=>{setReveal(null);setView(key);}}><Icon/><span>{label}</span></button>)}</nav>}
    {notice && <div role="status" className="js-toast">{notice}</div>}
  </div>;
}
