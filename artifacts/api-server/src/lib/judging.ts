import { randomBytes, createHash } from "node:crypto";
import type { ActOnRoomBody } from "@workspace/api-zod";

export type Member = { id: string; name: string; identity: string };
type Ballot = { candidates: string[]; votes: Record<string, string>; published: boolean };
export type Room = {
  resultToken?: string;
  title: string; version: number; hostId: string; members: Member[];
  performers: { id: string; name: string }[]; started: boolean; activeId: string | null;
  scores: Record<string, number>;
  rounds: { performerId: string; scores: Record<string, number>; publishedAt: number }[];
  final: Ballot; runoff: Ballot;
};
export class RuleError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export const newId = () => randomBytes(18).toString("base64url");
export const hashIdentity = (value: string) => createHash("sha256").update(value).digest("hex");
export const emptyBallot = (): Ballot => ({ candidates: [], votes: {}, published: false });
export function namedPerformers(names: string[]) {
  const clean = names.map(n => n.trim());
  if (clean.some(n => !n) || new Set(clean).size !== clean.length) throw new RuleError("コンビ名は空欄・重複なしで入力してください", 400);
  return clean.map(name => ({ id: newId(), name }));
}
export function winners(ballot: Ballot) {
  const counts = ballot.candidates.map(id => ({ id, count: Object.values(ballot.votes).filter(v => v === id).length }));
  const max = Math.max(...counts.map(c => c.count));
  return counts.filter(c => c.count === max).map(c => c.id);
}
export function snapshot(id: string, room: Room, me: Member, expiresAt: Date) {
  // Explicit allowlist, not a spread of stored state: unpublished values must never leave the server.
  const ballot = (b: Ballot) => ({
    candidates: b.candidates, submitted: Object.keys(b.votes),
    votes: b.published ? b.votes : {}, published: b.published, ownVote: b.votes[me.id] ?? null,
  });
  return {
    id, title: room.title, version: room.version, me: me.id, hostId: room.hostId,
    members: room.members.map(({ id, name }) => ({ id, name })), performers: room.performers,
    started: room.started, activeId: room.activeId, submitted: Object.keys(room.scores),
    ownScore: room.scores[me.id] ?? null, rounds: room.rounds,
    final: ballot(room.final), runoff: ballot(room.runoff), expiresAt: expiresAt.toISOString(), serverTime: Date.now(),
  };
}
export function applyAction(room: Room, me: Member, action: ReturnType<typeof ActOnRoomBody.parse>, now = Date.now()) {
  const hostActions = ["configure", "start", "select", "publishScore", "finalists", "publishVote", "runoff"];
  if (hostActions.includes(action.type) && me.id !== room.hostId) throw new RuleError("幹事だけが操作できます", 403);
  if (action.version !== room.version) throw new RuleError("ルームが更新されました。最新の状態を確認してもう一度操作してください");
  const require = (condition: unknown, message: string) => { if (!condition) throw new RuleError(message); };
  const allSubmitted = (source: object) => room.members.every(m => Object.hasOwn(source, m.id));
  switch (action.type) {
    case "configure":
      require(!room.started, "開始後の設定変更はできません");
      require(action.names && action.title?.trim(), "大会名とコンビ名を入力してください");
      room.title = action.title!.trim();
      room.performers = namedPerformers(action.names!);
      break;
    case "start":
      require(!room.started && room.members.length >= 2, "開始前に審査員が2名以上必要です");
      room.started = true; room.activeId = room.performers[0].id;
      break;
    case "select":
      require(room.started && !room.final.candidates.length, "採点中のみ選択できます");
      require(Object.keys(room.scores).length === 0, "提出済みの点数があります。現在の組を公開してください");
      require(room.performers.some(p => p.id === action.performerId) && !room.rounds.some(r => r.performerId === action.performerId), "未採点のコンビを選んでください");
      room.activeId = action.performerId!;
      break;
    case "score":
      require(room.started && room.activeId && room.activeId === action.performerId && !room.final.candidates.length, "この組は採点できません");
      require(!room.rounds.some(r => r.performerId === action.performerId), "公開済みの点数は変更できません");
      require(Number.isInteger(action.score) && action.score! >= 0 && action.score! <= 100, "0〜100の整数を入力してください");
      room.scores[me.id] = action.score!;
      break;
    case "publishScore":
      require(room.started && room.activeId === action.performerId && room.activeId && !room.final.candidates.length, "公開する組が一致しません");
      require(!room.rounds.some(r => r.performerId === action.performerId), "公開済みです");
      require(allSubmitted(room.scores), "全員の採点提出を待ってください");
      // Future timestamp gives connected phones time to begin the same timeline.
      room.rounds.push({ performerId: room.activeId!, scores: { ...room.scores }, publishedAt: now + 1200 });
      room.scores = {};
      room.activeId = room.performers.find(p => !room.rounds.some(r => r.performerId === p.id))?.id ?? null;
      break;
    case "finalists":
      require(room.started && room.rounds.length === room.performers.length, "全組の採点公開後に最終決戦へ進めます");
      require(!room.final.candidates.length, "決勝候補はすでに確定しています");
      require(action.candidates && action.candidates.length >= 2 && new Set(action.candidates).size === action.candidates.length && action.candidates.every(id => room.performers.some(p => p.id === id)), "候補を2組以上選んでください");
      room.final.candidates = action.candidates!;
      break;
    case "vote": {
      const b = action.runoff ? room.runoff : room.final;
      require(b.candidates.length && !b.published, "公開済みの票は変更できません");
      require(action.runoff || !room.runoff.candidates.length, "再投票へ進んでいます");
      require(b.candidates.includes(action.performerId!), "候補から選んでください");
      b.votes[me.id] = action.performerId!;
      break;
    }
    case "publishVote": {
      const b = action.runoff ? room.runoff : room.final;
      require(b.candidates.length && !b.published && allSubmitted(b.votes), "全員の投票が必要です。公開済みの票は変更できません");
      b.published = true;
      break;
    }
    case "runoff":
      require(room.final.published && winners(room.final).length > 1 && !room.runoff.candidates.length, "再投票は最多同票の組で一度だけ行えます");
      room.runoff.candidates = winners(room.final);
      break;
  }
  room.version++;
}
