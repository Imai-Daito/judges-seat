import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { CreateRoomBody, JoinRoomBody, ActOnRoomBody, GetRoomParams, GetRoomResponse } from "@workspace/api-zod";
import { applyAction, emptyBallot, hashIdentity, namedPerformers, newId, RuleError, snapshot, type Room } from "../lib/judging";
import { publicResults, setSharing, sharingState } from "../lib/sharing";
import { enforceRoomRateLimit, networkSubject, roomRatePolicies as limits } from "../lib/room-rate-limits";

const router: IRouter = Router();
const cookieName = "judges_device";
function identity(req: Request, res: Response, create = false): string {
  let value = req.cookies?.[cookieName] as unknown;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{24,100}$/.test(value)) {
    if (!create) throw new RuleError("ニックネームを入力して参加してください", 401);
    value = newId() + newId();
    res.cookie(cookieName, value, { httpOnly: true, secure: req.secure || req.get("x-forwarded-proto") === "https", sameSite: "lax", path: "/api/rooms", maxAge: 365 * 86400000 });
  }
  return hashIdentity(value as string);
}
function roomId(req: Request) {
  const result = GetRoomParams.safeParse(req.params);
  if (!result.success || !/^[A-Za-z0-9_-]{24}$/.test(result.data.id)) throw new RuleError("招待リンクが正しくありません", 400);
  return result.data.id;
}
router.use("/rooms", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (req.method === "POST" && req.get("X-Judges-Client") !== "1") { res.status(403).json({ error: "この操作は審査画面から行ってください" }); return; }
  next();
});
router.post("/rooms", async (req, res, next): Promise<void> => {
  try {
    await enforceRoomRateLimit(limits.createNetwork, networkSubject(req), res);
    const who = identity(req, res, true);
    await enforceRoomRateLimit(limits.createDevice, who, res);
    const parsed = CreateRoomBody.safeParse(req.body);
    if (!parsed.success) throw new RuleError("大会名・ニックネーム・2組以上の出場者・保存期間を確認してください", 400);
    const input = parsed.data;
    if (!input.nickname.trim() || !input.title.trim()) throw new RuleError("名前を入力してください", 400);
    const person = { id: newId(), name: input.nickname.trim(), identity: who };
    const room: Room = {
      title: input.title.trim(), version: 0, hostId: person.id, members: [person], performers: namedPerformers(input.performers),
      started: false, activeId: null, scores: {}, rounds: [], final: emptyBallot(), runoff: emptyBallot(),
    };
    const id = newId(), expiresAt = new Date(Date.now() + input.retentionDays * 86400000);
    await pool.query("INSERT INTO judging_rooms(id, state, expires_at) VALUES ($1,$2,$3)", [id, JSON.stringify(room), expiresAt]);
    res.status(201).json(GetRoomResponse.parse(snapshot(id, room, person, expiresAt)));
  } catch (err) { next(err); }
});
// Serialize joins, writes and publication on the same row, including across server processes.
router.post("/rooms/:id/:operation", async (req, res, next): Promise<void> => {
  // Charge before the room transaction: rejected writes and rollbacks must count,
  // and the limiter must not compete for a second connection while holding a row.
  try {
    const network = networkSubject(req);
    await enforceRoomRateLimit(limits.writeNetwork, network, res);
    const rawId = req.params.id;
    const cookie = req.cookies?.[cookieName];
    let member = false;
    const who = typeof cookie === "string" && /^[A-Za-z0-9_-]{24,100}$/.test(cookie) ? hashIdentity(cookie) : null;
    if (typeof rawId === "string" && /^[A-Za-z0-9_-]{24}$/.test(rawId) && who) {
      // Only a live room's server-stored identity grants a separate member bucket.
      // Neither a guessed room ID, a new cookie nor a request-body member ID does.
      const result = await pool.query(
        `SELECT 1 FROM judging_rooms WHERE id=$1 AND expires_at > NOW()
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(state->'members') m WHERE m->>'identity'=$2)`,
        [rawId, who],
      );
      member = !!result.rowCount;
    }
    await enforceRoomRateLimit(member ? limits.writeMember : limits.writeAnonymous,
      member ? `${rawId}:${who}` : network, res);
  } catch (err) { next(err); return; }
  let client;
  try { client = await pool.connect(); }
  catch (err) { next(err); return; }
  let releaseError: Error | undefined;
  try {
    const id = roomId(req), joining = req.params.operation === "join";
    const sharing = req.params.operation === "sharing";
    if (!joining && !sharing && req.params.operation !== "actions") throw new RuleError("操作が見つかりません", 404);
    const who = identity(req, res, joining);
    if (sharing && (typeof req.body?.enabled !== "boolean" || Object.keys(req.body).some(k => k !== "enabled"))) throw new RuleError("公開設定を確認してください", 400);
    const body = joining ? JoinRoomBody.parse(req.body) : sharing ? req.body : ActOnRoomBody.parse(req.body);
    await client.query("BEGIN");
    const result = await client.query("SELECT state, expires_at FROM judging_rooms WHERE id=$1 AND expires_at > NOW() FOR UPDATE", [id]);
    if (!result.rowCount) throw new RuleError("部屋が存在しないか保存期限が切れています", 404);
    const room = result.rows[0].state as Room, expiry = result.rows[0].expires_at as Date;
    let me = room.members.find(m => m.identity === who);
    if (joining) {
      if (!me) {
        if (room.started) throw new RuleError("採点開始後は新しく参加できません。同じブラウザーの参加者は再接続できます");
        const name = (body as { nickname: string }).nickname.trim();
        if (!name) throw new RuleError("ニックネームを入力してください", 400);
        if (room.members.some(m => m.name === name)) throw new RuleError("同じニックネームが使われています", 400);
        if (room.members.length >= 20) throw new RuleError("審査員は最大20名です");
        me = { id: newId(), name, identity: who }; room.members.push(me); room.version++;
      }
    } else {
      if (!me) throw new RuleError("この部屋に参加していません", 403);
      if (sharing) setSharing(room, me, body.enabled, expiry);
      else applyAction(room, me, body as ReturnType<typeof ActOnRoomBody.parse>);
    }
    await client.query("UPDATE judging_rooms SET state=$2 WHERE id=$1", [id, JSON.stringify(room)]);
    await client.query("COMMIT");
    res.json(sharing ? sharingState(room, me!, expiry) : GetRoomResponse.parse(snapshot(id, room, me!, expiry)));
  } catch (err) {
    try { await client.query("ROLLBACK"); }
    catch (rollbackError) {
      // A failed rollback leaves the connection's transaction state unknown.
      // Discard it, and report the original operation error to the caller.
      releaseError = rollbackError instanceof Error ? rollbackError : new Error("Rollback failed");
    }
    next(err);
  }
  finally { client.release(releaseError); }
});
async function load(req: Request, res: Response) {
  const id = roomId(req), who = identity(req, res);
  const result = await pool.query("SELECT state, expires_at FROM judging_rooms WHERE id=$1 AND expires_at>NOW()", [id]);
  if (!result.rowCount) throw new RuleError("部屋が存在しないか保存期限が切れています", 404);
  const room = result.rows[0].state as Room;
  const me = room.members.find(m => m.identity === who);
  if (!me) throw new RuleError("ニックネームを入力して参加してください", 403);
  return { id, room, me, expiresAt: result.rows[0].expires_at as Date };
}
router.get("/rooms/:id", async (req, res, next): Promise<void> => {
  try { const r = await load(req, res); res.json(GetRoomResponse.parse(snapshot(r.id, r.room, r.me, r.expiresAt))); }
  catch (err) { next(err); }
});
router.get("/rooms/:id/sharing", async (req, res, next): Promise<void> => {
  try { const r = await load(req, res); res.json(sharingState(r.room, r.me, r.expiresAt)); }
  catch (err) { next(err); }
});
router.use("/shared-results", (_req, res, next) => {
  res.set({ "Cache-Control": "no-store, private, max-age=0", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" });
  next();
});
router.get("/shared-results/:token", async (req, res, next): Promise<void> => {
  try {
    const token = req.params.token;
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{48}$/.test(token)) throw new RuleError("閲覧リンクが無効・停止中、または保存期限が切れています", 404);
    const result = await pool.query("SELECT state, expires_at FROM judging_rooms WHERE state->>'resultToken'=$1 AND expires_at>NOW()", [token]);
    if (!result.rowCount) throw new RuleError("閲覧リンクが無効・停止中、または保存期限が切れています", 404);
    res.json(publicResults(result.rows[0].state as Room, result.rows[0].expires_at as Date));
  } catch (err) { next(err); }
});
router.all("/shared-results/:token", (_req, res) => {
  res.set("Allow", "GET, HEAD").status(405).json({ error: "このリンクは結果の閲覧専用です" });
});
router.get("/rooms/:id/events", async (req, res, next): Promise<void> => {
  try {
    const first = await load(req, res);
    res.set({ "Content-Type": "text/event-stream", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    let closed = false, version = -1, busy = false;
    const tick = async () => {
      if (busy || closed) return;
      busy = true;
      try {
        const result = await pool.query("SELECT (state->>'version')::int AS version FROM judging_rooms WHERE id=$1 AND expires_at>NOW()", [first.id]);
        if (closed) return;
        if (!result.rowCount) { res.write("event: expired\ndata: {}\n\n"); res.end(); return; }
        if (version !== result.rows[0].version) {
          version = result.rows[0].version;
          res.write(`data: ${JSON.stringify({ version })}\n\n`);
        } else res.write(": heartbeat\n\n");
      } catch { if (!closed) res.end(); }
      finally { busy = false; }
    };
    const interval = setInterval(() => void tick(), 1000);
    res.on("close", () => { closed = true; clearInterval(interval); });
    void tick();
  } catch (err) { next(err); }
});
export default router;
