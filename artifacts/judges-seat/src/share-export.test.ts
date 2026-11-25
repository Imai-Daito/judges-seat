import { test } from "node:test";
import assert from "node:assert/strict";
import { ballotWinners, champions, planSharePages, publicRankings, toPublicResults, wrapChars } from "./share-export";
import type { PublicResults, RoomSnapshot } from "@workspace/api-client-react";

function fixture(): PublicResults {
  const members = Array.from({ length: 20 }, (_, i) => ({ id: `j${i}`, name: "長い日本語の審査員名" }));
  const performers = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, name: "あ".repeat(30) }));
  return {
    title: "大".repeat(60), members, performers, expiresAt: new Date(Date.now() + 10000).toISOString(),
    rounds: performers.map(p => ({ performerId: p.id, publishedAt: 1, scores: Object.fromEntries(members.map(m => [m.id, 100])) })),
    final: { published: true, candidates: performers.map(p => p.id), votes: Object.fromEntries(members.map((m, i) => [m.id, performers[i].id])) },
    runoff: { published: true, candidates: performers.slice(0, 20).map(p => p.id), votes: Object.fromEntries(members.map((m, i) => [m.id, performers[i].id])) },
  };
}
test("maximum-size pagination includes all 600 cells exactly once, all ranks, named votes and champions", () => {
  const r = fixture(), pages = planSharePages(r);
  const tables = pages.filter(p => p.kind === "scores");
  assert.equal(tables.length, 20);
  const cells = tables.flatMap(p => p.performerIds.flatMap(pid => p.judgeIds.map(jid => `${pid}:${jid}`)));
  assert.equal(cells.length, 600);
  assert.equal(new Set(cells).size, 600);
  assert.deepEqual(new Set(pages.flatMap(p => p.kind === "ranking" ? p.rows.map(x => x.id) : [])), new Set(r.performers.map(p => p.id)));
  for (const ballot of ["final", "runoff"] as const) {
    const lines = pages.flatMap(p => p.kind === "votes" && p.ballot === ballot ? p.lines : []);
    assert.deepEqual(lines.filter(x => x.kind === "vote").map(x => x.memberId), r.members.map(m => m.id));
    assert.deepEqual(lines.filter(x => x.kind === "tally").map(x => x.id), r[ballot].candidates);
  }
  assert.deepEqual(pages.flatMap(p => p.kind === "champions" ? p.ids : []), champions(r));
  assert.equal(champions(r).length, 20);
});
test("rank ties are 1/1/3 and winner waits for publication and required runoff", () => {
  const r = fixture();
  r.rounds = [
    { performerId: "p0", publishedAt: 1, scores: { j0: 100 } },
    { performerId: "p1", publishedAt: 1, scores: { j0: 100 } },
    { performerId: "p2", publishedAt: 1, scores: { j0: 0 } },
  ];
  assert.deepEqual(publicRankings(r).map(x => x.rank), [1, 1, 3]);
  r.final.published = false; r.runoff.published = false;
  assert.deepEqual(ballotWinners(r.final), []);
  assert.deepEqual(champions(r), []);
  assert.ok(planSharePages(r).every(p => p.kind !== "votes"));
  r.final.published = true;
  assert.deepEqual(champions(r), []);
  r.runoff.votes = Object.fromEntries(r.members.map(m => [m.id, "p1"])); r.runoff.published = true;
  assert.deepEqual(champions(r), ["p1"]);
  r.runoff.published = false; r.final.votes = r.runoff.votes;
  assert.deepEqual(champions(r), ["p1"]);
});
test("image input strips personal and unpublished values from participant snapshot", () => {
  const r = fixture();
  const room = { ...r, id: "private-room", hostId: "private-host", me: "j0", version: 2, started: true,
    activeId: "p0", submitted: ["private-submitter"], ownScore: 17, serverTime: 2,
    final: { ...r.final, published: false, ownVote: "private-vote", submitted: ["j0"] },
    runoff: { ...r.runoff, published: false, ownVote: null, submitted: [] },
  } as RoomSnapshot;
  const output = toPublicResults(room), text = JSON.stringify(output);
  for (const forbidden of ["private-", "ownScore", "ownVote", "submitted", "hostId", "serverTime", "activeId"]) assert.ok(!text.includes(forbidden));
  assert.deepEqual(output.final, { published: false, candidates: [], votes: {} });
});
test("Japanese wrapping keeps maximum-length title, performer, nickname without omission", () => {
  const measure = (s: string) => Array.from(s).length;
  for (const [length, width, lines] of [[60, 34, 2], [30, 10, 3], [10, 4, 3]]) {
    const text = "あ".repeat(length);
    assert.equal(wrapChars(text, width, measure, lines).join(""), text);
  }
  assert.deepEqual(wrapChars("あ😀いう", 2, measure, 3), ["あ😀", "いう"]);
});
test("empty unpublished results still produce an explicitly uncertain ranking page", () => {
  const r = fixture(); r.rounds = []; r.final.published = false; r.runoff.published = false;
  assert.equal(planSharePages(r).length, 1);
  assert.deepEqual(champions(r), []);
  assert.throws(() => planSharePages(r, { rowsPerPage: 0 }), RangeError);
});
