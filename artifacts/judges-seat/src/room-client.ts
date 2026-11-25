import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomAction, RoomInput, RoomSnapshot } from "@workspace/api-client-react";
export type { RoomAction, RoomInput, RoomSnapshot, ScoreRound, VoteState } from "@workspace/api-client-react";

export class RoomError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
// The shared API owns /api; this web artifact is mounted at /.
const endpoint = "/api/rooms";
async function request(path: string, body?: unknown): Promise<RoomSnapshot> {
  const response = await fetch(endpoint + path, {
    credentials: "same-origin", cache: "no-store",
    headers: body ? { "Content-Type": "application/json", "X-Judges-Client": "1" } : {},
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json();
  if (!response.ok) throw new RoomError(data.error || "通信に失敗しました", response.status);
  return data as RoomSnapshot;
}
export function useRoom(id: string) {
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState("");
  const [access, setAccess] = useState(false);
  const [connection, setConnection] = useState("接続中");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const sending = useRef(false);
  const expired = useRef(false);
  const expire = useCallback(() => {
    // Invalidate requests already in flight so they cannot restore an expired
    // room after the terminal SSE event or a missed event followed by HTTP 404.
    generation.current++;
    expired.current = true;
    sending.current = false;
    setBusy(false); setRoom(null); setAccess(false);
    setError("部屋が存在しないか保存期限が切れています"); setConnection("期限切れ");
  }, []);
  const update = useCallback((data: RoomSnapshot) => {
    setRoom(old => old && old.id === data.id && old.version > data.version ? old : data);
    setAccess(false); setError("");
  }, []);
  const refresh = useCallback(async () => {
    if (!id || expired.current) return;
    const gen = generation.current;
    try {
      const data = await request(`/${encodeURIComponent(id)}`);
      if (gen === generation.current) update(data);
    } catch (e) {
      if (gen !== generation.current) return;
      if (e instanceof RoomError && e.status === 404) { expire(); return; }
      if (e instanceof RoomError && [401,403].includes(e.status)) setAccess(true);
      setError(e instanceof Error ? e.message : "接続できません");
    }
  }, [id, update, expire]);
  useEffect(() => {
    generation.current++;
    expired.current = false; sending.current = false; setBusy(false);
    setRoom(null); setAccess(false); setError(""); setConnection("接続中");
    void refresh();
    return () => { generation.current++; };
  }, [refresh]);
  useEffect(() => {
    if (!id || !room) return;
    const stream = new EventSource(`${endpoint}/${encodeURIComponent(id)}/events`);
    stream.onopen = () => { setConnection("同期中"); void refresh(); };
    stream.onmessage = () => { setConnection("同期中"); void refresh(); };
    stream.onerror = () => setConnection(navigator.onLine ? "再接続中・未送信の入力は保持" : "オフライン・入力は未送信");
    stream.addEventListener("expired", () => { stream.close(); expire(); });
    const online = () => { setConnection("再接続中"); void refresh(); };
    const offline = () => setConnection("オフライン・入力は未送信");
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    // Recovery when a mobile browser silently suspends SSE.
    const fallback = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15000);
    return () => {
      stream.close(); window.clearInterval(fallback);
      window.removeEventListener("online", online); window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [id, Boolean(room), refresh, expire]);
  const perform = async (fn: () => Promise<RoomSnapshot>) => {
    if (sending.current || expired.current) return null;
    const gen = generation.current;
    sending.current = true;
    setBusy(true); setError("");
    try {
      const data = await fn();
      if (gen !== generation.current) return null;
      update(data); return data;
    }
    catch (e) {
      if (gen !== generation.current) return null;
      if (e instanceof RoomError && e.status === 404) { expire(); return null; }
      setError(e instanceof Error ? e.message : "送信できませんでした");
      if (e instanceof RoomError && e.status === 409) void refresh();
      return null;
    } finally {
      if (gen === generation.current) { sending.current = false; setBusy(false); }
    }
  };
  return {
    room, error, access, connection, busy, refresh,
    create: (input: RoomInput) => perform(() => request("", input)),
    join: (nickname: string) => perform(() => request(`/${id}/join`, { nickname })),
    act: (action: Omit<RoomAction, "version">) => perform(() => request(`/${id}/actions`, { ...action, version: room?.version })),
  };
}
