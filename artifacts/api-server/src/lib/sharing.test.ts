import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyBallot, snapshot, type Room } from "./judging";
import { publicResults, setSharing, sharingState } from "./sharing";

function fixture(): Room {
  return {
    title: "M-1 2026", version: 0, hostId: "a",
    members: [{ id: "a", name: "幹事", identity: "secret-host" }, { id: "b", name: "友達", identity: "secret-guest" }],
    performers: [{ id: "p", name: "組1" }, { id: "q", name: "組2" }],
    started: true, activeId: "q", scores: { a: 13, b: 14 },
    rounds: [{ performerId: "p", scores: { a: 100, b: 0 }, publishedAt: 1 }],
    final: { candidates: ["p", "q"], votes: { a: "p", b: "q" }, published: false }, runoff: emptyBallot(),
  };
}
const expiry = new Date("2030-01-01");
test("link management requires organizer; enabling is idempotent, disabling destroys token", () => {
  const r = fixture();
  assert.deepEqual(sharingState(r, r.members[0], expiry), { enabled: false, token: null, expiresAt: expiry.toISOString() });
  assert.throws(() => sharingState(r, r.members[1], expiry), /幹事/);
  assert.throws(() => setSharing(r, r.members[1], true, expiry), /幹事/);
  const first = setSharing(r, r.members[0], true, expiry);
  assert.match(first.token!, /^[A-Za-z0-9_-]{48}$/);
  assert.equal(setSharing(r, r.members[0], true, expiry).token, first.token);
  assert.equal(setSharing(r, r.members[0], false, expiry).token, null);
  assert.notEqual(setSharing(r, r.members[0], true, expiry).token, first.token);
});
test("public projection enumerates nested fields and excludes unpublished scores, votes and credentials", () => {
  const r = fixture();
  setSharing(r, r.members[0], true, expiry);
  // A future stored field must not silently become public.
  Object.assign(r.rounds[0], { secret: "secret-round" });
  Object.assign(r.performers[0], { secret: "secret-performer" });
  r.rounds[0].scores.stranger = 99;
  const s = publicResults(r, expiry), json = JSON.stringify(s);
  assert.deepEqual(Object.keys(s).sort(), ["title", "members", "performers", "rounds", "final", "runoff", "expiresAt"].sort());
  assert.deepEqual(s.final, { published: false, candidates: [], votes: {} });
  assert.deepEqual(s.rounds[0].scores, { a: 100, b: 0 });
  assert.deepEqual(Object.keys(s.rounds[0]).sort(), ["performerId", "scores", "publishedAt"].sort());
  for (const forbidden of ["secret", "identity", "hostId", "ownScore", "ownVote", "submitted", "activeId", "resultToken", r.resultToken!]) {
    assert.ok(!json.includes(forbidden), forbidden);
  }
  const participant = JSON.stringify(snapshot("private-room", r, r.members[1], expiry));
  assert.ok(!participant.includes(r.resultToken!));
});
test("only published named final/runoff votes survive; state is never mutated", () => {
  const r = fixture();
  r.final.published = true;
  r.final.votes.stranger = "p";
  r.runoff = { candidates: ["p", "q"], votes: { a: "q", b: "p" }, published: false };
  const before = structuredClone(r);
  let s = publicResults(r, expiry);
  assert.deepEqual(s.final.votes, { a: "p", b: "q" });
  assert.deepEqual(s.runoff, { published: false, candidates: [], votes: {} });
  assert.deepEqual(r, before);
  r.runoff.published = true;
  s = publicResults(r, expiry);
  assert.deepEqual(s.runoff.votes, { a: "q", b: "p" });
  assert.equal(s.expiresAt, expiry.toISOString());
});
