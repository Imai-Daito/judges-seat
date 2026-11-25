import { useEffect, useRef, useState } from "react";
import { Download, ImageIcon, Link2, Share2, Copy } from "lucide-react";
import { getResultSharing, setResultSharing, type ResultSharing } from "@workspace/api-client-react";
import type { RoomSnapshot } from "./room-client";
import { renderSharePages, toPublicResults } from "./share-export";

const errText = (e: unknown) => {
  const d = (e as { data?: { error?: string } })?.data;
  return d?.error || (e instanceof Error ? e.message : "") || "通信に失敗しました";
};
const isAbort = (e: unknown) => (e as { name?: string })?.name === "AbortError";
export const sharedUrl = (token: string) => `${location.origin}${import.meta.env.BASE_URL}#results=${encodeURIComponent(token)}`;

function Warning() {
  return <div className="share-warning" role="note" data-testid="text-share-warning"><strong>共有前に確認</strong>
    <p>審査員全員のニックネームと、公開済みの点数・票が含まれます。本名や知られたくない名前が含まれていないか、全員の了承を確認してください。</p></div>;
}

function ImageShare({ room }: { room: RoomSnapshot }) {
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => () => urls.forEach(u => URL.revokeObjectURL(u)), [urls]);
  const build = async () => {
    setBusy(true); setMsg("");
    try {
      const blobs = await renderSharePages(toPublicResults(room));
      const base = room.title.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 30) || "results";
      const fs = blobs.map((b, i) => new File([b], `${base}_${String(i + 1).padStart(2, "0")}.png`, { type: "image/png" }));
      setFiles(fs); setUrls(fs.map(f => URL.createObjectURL(f)));
    } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };
  const can = (fs: File[]) => { try { return typeof navigator.share === "function" && !!navigator.canShare && navigator.canShare({ files: fs }); } catch { return false; } };
  const shareFiles = async (fs: File[]) => {
    setMsg("");
    try { await navigator.share({ files: fs, title: room.title }); setMsg(""); }
    catch (e) { if (!isAbort(e)) setMsg("共有できませんでした。画像を保存して共有してください。"); }
  };
  const all = files.length > 0 && can(files);
  const single = files.length > 0 && !all && can([files[0]]);
  return <section className="js-card" data-testid="panel-image-share">
    <h3 className="js-card-title">画像で共有</h3>
    <Warning/>
    <p className="js-card-note">作成した画像は一度保存・投稿されると、このアプリから取り消せません。</p>
    {!files.length && <button className="js-button is-wide" disabled={busy} onClick={() => void build()} data-testid="button-build-images">{busy ? "画像を作成中…" : "画像を作成してプレビュー"}</button>}
    {busy && <div className="share-skeleton" aria-hidden/>}
    {files.length > 0 && <>
      <div className="share-count" data-testid="text-page-count"><strong>{files.length}</strong>枚の画像を共有します</div>
      <div className="share-previews">{urls.map((u, i) => <figure key={u} className="share-preview">
        <a href={u} target="_blank" rel="noopener noreferrer" aria-label={`共有画像${i + 1}を拡大`} data-testid={`link-preview-${i}`}><img src={u} alt={`共有画像 ${i + 1} / ${files.length}`} data-testid={`img-share-${i}`}/></a>
        <figcaption><span>{i + 1} / {files.length}</span><a href={u} download={files[i].name} data-testid={`link-download-${i}`}><Download size={13}/>保存</a>
          {single && <button className="js-subtle-link" onClick={() => void shareFiles([files[i]])} data-testid={`button-share-file-${i}`}>この画像を共有</button>}</figcaption>
      </figure>)}</div>
      {all && <button className="js-button is-wide" onClick={() => void shareFiles(files)} data-testid="button-share-images"><Share2 size={14}/>{files.length > 1 ? `${files.length}枚まとめて共有` : "共有する"}</button>}
      {single && <p className="js-hint">この端末はまとめての共有に対応していません。1枚ずつ共有してください。</p>}
      {!all && !single && <p className="js-hint">この端末では画像の直接共有に対応していません。各画像の「保存」から保存してください。</p>}
      <p className="js-hint">画像を押すと拡大できます。「保存」で画像が開く場合は、画像を長押しして保存してください。</p>
      <button className="js-subtle-link" onClick={() => { setFiles([]); setUrls([]); }} data-testid="button-discard-images">作り直す</button>
    </>}
    {msg && <p role="alert" className="js-callout">{msg}</p>}
  </section>;
}

function LinkShare({ room }: { room: RoomSnapshot }) {
  const host = room.me === room.hostId;
  const [state, setState] = useState<ResultSharing | null>(null);
  const [loading, setLoading] = useState(host);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const opts = { credentials: "same-origin" as const, cache: "no-store" as const };
  const load = async () => {
    setLoading(true); setMsg("");
    try { setState(await getResultSharing(room.id, opts)); }
    catch (e) { setState(null); setCopied(""); setMsg(errText(e)); } finally { setLoading(false); }
  };
  useEffect(() => { if (host) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [host, room.id]);
  const toggle = async (enabled: boolean) => {
    if (!enabled && !window.confirm("閲覧リンクを無効にします。すでに保存された画像や転載は取り消せません。")) return;
    setBusy(true); setMsg("");
    try { const s = await setResultSharing(room.id, { enabled }, { ...opts, headers: { "X-Judges-Client": "1" } }); setState(s); if (!s.enabled) setCopied(""); }
    catch (e) { setState(null); setCopied(""); setMsg(errText(e)); } finally { setBusy(false); }
  };
  const url = state?.enabled && state.token ? sharedUrl(state.token) : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied("コピーしました"); }
    catch { field.current?.select(); setCopied("自動コピーできません。上のリンクを選択してコピーしてください"); }
  };
  const share = async () => {
    try { await navigator.share({ url, title: room.title }); } catch (e) { if (!isAbort(e)) void copy(); }
  };
  return <section className="js-card" data-testid="panel-link-share">
    <h3 className="js-card-title">閲覧リンクを共有</h3>
    <Warning/>
    <p className="js-card-note">リンクを知っている人は、ログインなしで審査員のニックネームと公開済みの結果を見られます。有効な間は、今後公開される点数・票も見えます。無効にしても、保存された画像やスクリーンショット・転載は取り消せません。部屋の保存期限（30日）で自動的に見られなくなります。</p>
    {!host ? <p className="js-callout" data-testid="text-host-only">閲覧リンクの発行・停止は幹事だけが行えます。</p> :
      loading ? <div className="share-skeleton is-short" aria-hidden/> : <>
      {state && <div className="share-status" data-testid="status-link"><span className={state.enabled ? "is-on" : ""}>{state.enabled ? "公開中" : "停止中"}</span><small>期限 {new Date(state.expiresAt).toLocaleString("ja-JP")}</small></div>}
      {url && <>
        <input ref={field} className="js-input share-url" readOnly value={url} onFocus={e => e.currentTarget.select()} aria-label="閲覧リンク" data-testid="input-share-url"/>
        <div className="share-actions">
          <button className="js-button" onClick={() => void copy()} data-testid="button-copy-link"><Copy size={14}/>コピー</button>
          {typeof navigator.share === "function" && <button className="js-button is-quiet" onClick={() => void share()} data-testid="button-native-share-link"><Share2 size={14}/>共有</button>}
        </div>
        {copied && <p className="js-hint" role="status">{copied}</p>}
      </>}
      {state && <button className={`js-button is-wide ${state.enabled ? "is-quiet" : ""}`} disabled={busy} onClick={() => void toggle(!state.enabled)} data-testid="button-toggle-link">{busy ? "送信中…" : state.enabled ? "閲覧リンクを無効にする" : "閲覧リンクを有効にする"}</button>}
      {!state && <button className="js-button is-quiet is-wide" onClick={() => void load()} data-testid="button-retry-sharing">状態を再取得</button>}
    </>}
    {msg && <p role="alert" className="js-callout">{msg}</p>}
  </section>;
}

export function ShareResults({ room }: { room: RoomSnapshot }) {
  const [mode, setMode] = useState<"" | "image" | "link">("");
  return <>
    <div className="share-choice" role="group" aria-label="結果の共有">
      <button className={`share-choice-btn ${mode === "image" ? "is-active" : ""}`} onClick={() => setMode(m => m === "image" ? "" : "image")} data-testid="button-choose-image"><ImageIcon size={18}/>画像で共有</button>
      <button className={`share-choice-btn ${mode === "link" ? "is-active" : ""}`} onClick={() => setMode(m => m === "link" ? "" : "link")} data-testid="button-choose-link"><Link2 size={18}/>閲覧リンクを共有</button>
    </div>
    {mode === "image" && <ImageShare room={room}/>}
    {mode === "link" && <LinkShare room={room}/>}
  </>;
}
