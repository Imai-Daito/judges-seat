import assert from "node:assert/strict";
import { pool } from "../../../lib/db/src/index.ts";
import { servers, eventually, revisions } from "./helpers/room-servers.mjs";

// Uses real PostgreSQL row locks and two fresh OS processes, not mocked state.
// Only these newly created room IDs are ever modified/deleted by this suite.
export async function testResilience() {
  const api = await servers();
  const actors = Array.from({ length: 20 }, (_, i) => ({ name: `審査員${i + 1}`, server: i % 2 ? "b" : "a" }));
  const host = actors[0], roomIds = [];
  let room, conflicts = 0;
  const get = (actor, server = actor.server) => api.call(server, actor, `/${room.id}`);
  const action = (actor, body, version = room.version, status = 200, server = actor.server) =>
    api.call(server, actor, `/${room.id}/actions`, { ...body, version }, status);
  function privateSnapshot(snapshot, ownScore = null, ownVote = null, runoff = false) {
    assert.deepEqual(Object.keys(snapshot).sort(), [
      "id", "title", "version", "me", "hostId", "members", "performers", "started", "activeId",
      "submitted", "ownScore", "rounds", "final", "runoff", "expiresAt", "serverTime",
    ].sort());
    snapshot.members.forEach(member => assert.deepEqual(Object.keys(member).sort(), ["id", "name"]));
    assert.equal(snapshot.ownScore, ownScore);
    const ballot = runoff ? snapshot.runoff : snapshot.final;
    assert.equal(ballot.ownVote, ownVote);
    if (!ballot.published) assert.deepEqual(ballot.votes, {});
    assert.ok(!JSON.stringify(snapshot).includes("identity"));
  }
  async function converge(streams) {
    await eventually(() => streams.every(s => revisions(s).at(-1) === room.version), "20 SSE clients converge");
    for (const s of streams) {
      const values = revisions(s);
      assert.deepEqual(values, [...new Set(values)].sort((a, b) => a - b), "SSE revisions must not duplicate or regress");
    }
  }
  async function submitAll(bodyFor, privacyFor) {
    let remaining = [...actors], version = room.version, wave = 0;
    // Deliberately collide every request at the same version. Only reversible
    // submissions are explicitly retried here after seeing the latest revision.
    // Production clients must never silently retry irreversible publication.
    while (remaining.length) {
      assert.ok(++wave <= 20, "Submissions must make bounded progress");
      const responses = await Promise.all(remaining.map(async actor => {
        const res = await api.call(actor.server, actor, `/${room.id}/actions`,
          { ...bodyFor(actor), version }, [200, 409]);
        return { actor, res };
      }));
      const successful = responses.filter(({ res }) => !res.error);
      assert.equal(successful.length, 1, "Exactly one same-version write may commit");
      for (const { actor, res } of successful) {
        version = res.version;
        privacyFor(res, actor);
      }
      remaining = responses.filter(({ res }) => res.error).map(({ actor }) => actor);
      conflicts += remaining.length;
    }
    room = await get(host);
    assert.equal(room.version, version);
  }
  async function publishOnce(body) {
    const version = room.version;
    const results = await Promise.all(["a", "b"].map(server =>
      api.call(server, host, `/${room.id}/actions`, { ...body, version }, [200, 409])));
    assert.equal(results.filter(r => !r.error).length, 1, "Publication commits only once across servers");
    assert.equal(results.filter(r => r.error).length, 1);
    room = await get(host);
    assert.equal(room.version, version + 1);
    await action(host, body, room.version, 409);
  }
  try {
    await Promise.all(["a", "b"].map(api.start));
    room = await api.call("a", host, "", {
      nickname: host.name, title: "同期・障害テスト", performers: ["組A", "組B"], retentionDays: 30,
    }, 201);
    roomIds.push(room.id);
    await Promise.all(actors.slice(1).map(actor =>
      api.call(actor.server, actor, `/${room.id}/join`, { nickname: actor.name })));
    room = await get(host);
    assert.equal(room.members.length, 20);
    await api.call("b", {}, `/${room.id}/join`, { nickname: "定員超過" }, 409);
    await api.call("b", {}, `/${room.id}/events`, undefined, 401);
    room = await action(host, { type: "start" });
    let streams = await Promise.all(actors.map(actor => api.stream(actor.server, actor, room.id)));
    const identities = await Promise.all(actors.map(actor => get(actor)));
    actors.forEach((actor, i) => { actor.id = identities[i].me; actor.score = 71 + i; });
    for (const performer of room.performers) {
      await action(host, { type: "publishScore", performerId: performer.id }, room.version, 409);
      const before = room.version;
      await submitAll(actor => ({ type: "score", performerId: performer.id, score: actor.score }),
        (snapshot, actor) => privateSnapshot(snapshot, actor.score));
      assert.equal(room.version, before + 20, "No submitted score is lost");
      const submitted = await Promise.all(actors.map(actor => get(actor)));
      submitted.forEach((snapshot, i) => {
        privateSnapshot(snapshot, actors[i].score);
        assert.equal(snapshot.submitted.length, 20);
        assert.ok(!snapshot.rounds.some(round => round.performerId === performer.id));
      });
      if (room.rounds.length === 0) {
        // All score submissions have committed, but nothing is public yet.
        // A full restart must preserve the private values as well as identity.
        const version = room.version;
        await Promise.all(["a", "b"].map(api.stop));
        await Promise.all(["a", "b"].map(api.start));
        const restored = await Promise.all(actors.map(actor => get(actor)));
        restored.forEach((snapshot, i) => {
          assert.equal(snapshot.me, actors[i].id);
          assert.equal(snapshot.version, version);
          assert.equal(snapshot.submitted.length, 20);
          assert.deepEqual(snapshot.rounds, []);
          privateSnapshot(snapshot, actors[i].score);
        });
        streams.forEach(s => s.close());
        streams = await Promise.all(actors.map(actor => api.stream(actor.server, actor, room.id)));
      }
      await converge(streams);
      // Several phones drop exactly when the organizer publishes.
      streams.slice(0, 5).forEach(s => s.close());
      await publishOnce({ type: "publishScore", performerId: performer.id });
      const round = room.rounds.at(-1);
      assert.equal(Object.keys(round.scores).length, 20);
      actors.forEach(actor => assert.equal(round.scores[actor.id], actor.score));
      await action(host, { type: "score", performerId: performer.id, score: 0 }, room.version, 409);
      const reconnected = await Promise.all(actors.slice(0, 5).map(async actor => {
        const snapshot = await get(actor);
        assert.equal(snapshot.me, actor.id);
        assert.deepEqual(snapshot.rounds.at(-1), round, "Reconnect retains one authoritative reveal timestamp and score set");
        assert.ok(snapshot.serverTime < round.publishedAt + 20 * 1600, "Reconnect happens during the reveal");
        return api.stream(actor.server, actor, room.id);
      }));
      streams = [...reconnected, ...streams.slice(5)];
      await converge(streams);
      // Crash one process during presentation; the second must retain state.
      await api.stop("a");
      await eventually(() => streams.filter((_, i) => actors[i].server === "a").every(s => s.closed), "crashed server drops SSE");
      const survivor = await get(actors[1]);
      assert.deepEqual(survivor.rounds, room.rounds);
      await api.start("a");
      for (const [i, actor] of actors.entries()) {
        if (actor.server === "a") {
          const restored = await get(actor);
          assert.equal(restored.me, actor.id);
          assert.deepEqual(restored.rounds, room.rounds);
          streams[i] = await api.stream("a", actor, room.id);
        }
      }
      await converge(streams);
    }
    room = await action(host, { type: "finalists", candidates: room.performers.map(p => p.id) });
    for (const runoff of [false, true]) {
      await action(host, { type: "publishVote", runoff }, room.version, 409);
      const candidates = (runoff ? room.runoff : room.final).candidates;
      await submitAll(actor => ({ type: "vote", runoff, performerId: candidates[actors.indexOf(actor) % 2] }),
        (snapshot, actor) => privateSnapshot(snapshot, null, candidates[actors.indexOf(actor) % 2], runoff));
      (await Promise.all(actors.map(actor => get(actor)))).forEach((snapshot, i) =>
        privateSnapshot(snapshot, null, candidates[i % 2], runoff));
      // Lose ALL in-memory process state while votes are still unpublished.
      const version = room.version;
      await Promise.all(["a", "b"].map(api.stop));
      await Promise.all(["a", "b"].map(api.start));
      const restored = await Promise.all(actors.map(actor => get(actor)));
      restored.forEach((snapshot, i) => {
        assert.equal(snapshot.me, actors[i].id);
        assert.equal(snapshot.version, version);
        privateSnapshot(snapshot, null, candidates[i % 2], runoff);
      });
      streams.forEach(s => s.close());
      streams = await Promise.all(actors.map(actor => api.stream(actor.server, actor, room.id)));
      await publishOnce({ type: "publishVote", runoff });
      const ballot = runoff ? room.runoff : room.final;
      assert.equal(Object.keys(ballot.votes).length, 20);
      actors.forEach((actor, i) => assert.equal(ballot.votes[actor.id], candidates[i % 2]));
      await action(host, { type: "vote", runoff, performerId: candidates[0] }, room.version, 409);
      await converge(streams);
      if (!runoff) room = await action(host, { type: "runoff" });
    }
    await action(host, { type: "runoff" }, room.version, 409);
    // Expire only our own fixture. Every active stream on both processes must
    // emit the terminal event and end; subsequent HTTP/SSE requests must fail.
    await pool.query("UPDATE judging_rooms SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [room.id]);
    await eventually(() => streams.every(s => s.closed), "expired SSE streams end");
    for (const stream of streams) {
      assert.equal(stream.frames.filter(f => f === "event: expired\ndata: {}").length, 1);
      revisions(stream);
    }
    await api.call("a", host, `/${room.id}`, undefined, 404);
    await api.call("b", host, `/${room.id}/events`, undefined, 404);
    await action(host, { type: "publishVote", runoff: true }, room.version, 404);
    console.log(`PASS: 20 independent sessions, two OS processes, ${conflicts} expected revision conflicts; concurrent scores/votes, single publication, mid-reveal reconnect/crash, full restart, privacy and terminal SSE expiry.`);
  } finally {
    await api.close();
    try {
      if (roomIds.length) await pool.query("DELETE FROM judging_rooms WHERE id=ANY($1::text[])", [roomIds]);
    } finally { await pool.end(); }
  }
}
