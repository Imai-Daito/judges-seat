import { newId, RuleError, type Member, type Room } from "./judging";

export function sharingState(room: Room, me: Member, expiresAt: Date) {
  if (me.id !== room.hostId) throw new RuleError("幹事だけが閲覧リンクを管理できます", 403);
  return { enabled: !!room.resultToken, token: room.resultToken ?? null, expiresAt: expiresAt.toISOString() };
}

export function setSharing(room: Room, me: Member, enabled: boolean, expiresAt: Date) {
  sharingState(room, me, expiresAt);
  if (enabled) room.resultToken ??= newId() + newId();
  else delete room.resultToken;
  room.version++;
  return sharingState(room, me, expiresAt);
}

// Deliberately enumerate every nested field: never serialize stored room state.
export function publicResults(room: Room, expiresAt: Date) {
  const members = room.members.map(({ id, name }) => ({ id, name }));
  const performers = room.performers.map(({ id, name }) => ({ id, name }));
  const ballot = (b: Room["final"]) => ({
    published: b.published,
    candidates: b.published ? b.candidates.filter(id => performers.some(p => p.id === id)) : [],
    votes: b.published ? Object.fromEntries(members.flatMap(m =>
      b.candidates.includes(b.votes[m.id]) ? [[m.id, b.votes[m.id]]] : [])) : {},
  });
  return {
    title: room.title, members, performers,
    rounds: room.rounds.map(r => ({
      performerId: r.performerId, publishedAt: r.publishedAt,
      scores: Object.fromEntries(members.flatMap(m => Object.hasOwn(r.scores, m.id) ? [[m.id, r.scores[m.id]]] : [])),
    })),
    final: ballot(room.final), runoff: ballot(room.runoff), expiresAt: expiresAt.toISOString(),
  };
}
