import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canPublishScores, canPublishVotes, getFinale, getRankings, parseScore,
  publishScores, publishVotes, scoreMetal, startRunoff, submittedJudges,
  submitScore, submitVote, voteRound, voteTally, type Persisted,
} from "./judging.ts";

function room(): Persisted {
  return {
    nickname: "あなた",
    judges: [
      { id: "me", name: "あなた", self: true }, { id: "a", name: "A" },
      { id: "b", name: "B" }, { id: "c", name: "C" },
    ],
    performers: ["p0", "p1", "p2", "p3"].map((id) => ({ id, name: id })),
    rounds: [], activeIndex: 0, submitted: {}, roomStarted: true,
    finalists: ["p0", "p1", "p2"], votes: {}, votesPublished: false,
    runoffVotes: {}, runoffPublished: false, runoffDone: false,
  };
}

function fillScores(state = room(), value = "90") {
  return state.judges.reduce((next, judge) => submitScore(next, "p0", judge.id, value), state);
}

function fillVotes(state = room(), choices = ["p0", "p1", "p0", "p1"], runoff = false) {
  return state.judges.reduce((next, judge, index) => submitVote(next, judge.id, choices[index], runoff), state);
}

for (const [value, metal] of [[0, "bronze"], [79, "bronze"], [80, "silver"], [89, "silver"], [90, "gold"], [100, "gold"]] as const) {
  test(`${value} points: valid integer, ${metal}, survives submission and publication`, () => {
    assert.equal(parseScore(String(value)), value);
    assert.equal(scoreMetal(value), metal);
    const submitted = fillScores(room(), String(value));
    assert.equal(canPublishScores(submitted, "p0"), true);
    const published = publishScores(submitted, "p0");
    assert.deepEqual(Object.values(published.rounds[0].scores), [value, value, value, value]);
    assert.equal(getRankings(published.rounds, published.performers)[0].total, value * 4);
  });
}

for (const input of ["", " ", "-1", "101", "1.5", "NaN", "Infinity", "1e2", "0x50", "90\n"]) {
  test(`invalid score ${JSON.stringify(input)} cannot be submitted`, () => {
    const state = room();
    assert.equal(parseScore(input), null);
    assert.equal(submitScore(state, "p0", "me", input), state);
  });
}

test("unpublished scores are excluded; group and personal ties use 1/1/3", () => {
  const state = room();
  state.rounds = [
    { performerId: "p0", scores: { me: 90, a: 100 } },
    { performerId: "p1", scores: { me: 90, a: 100 } },
    { performerId: "p2", scores: { me: 80, a: 100 } },
  ];
  state.submitted = { p3: 100, "p3:a": 100 };
  for (const judgeId of [undefined, "me"]) {
    const rows = getRankings(state.rounds, state.performers, judgeId);
    assert.deepEqual(rows.map((r) => r.rank), [1, 1, 3]);
    assert.deepEqual(rows.map((r) => r.performer.id), ["p0", "p1", "p2"]);
  }
  assert.equal(getRankings(state.rounds, state.performers)[0].total, 190);
  assert.equal(getRankings(state.rounds, state.performers, "me")[0].total, 90);
});

test("personal ranks can differ from group ranks; missing personal score is not zero", () => {
  const state = room();
  state.rounds = [
    { performerId: "p0", scores: { me: 0, a: 100 } },
    { performerId: "p1", scores: { me: 90, a: 0 } },
    { performerId: "p2", scores: { a: 95 } },
  ];
  assert.deepEqual(getRankings(state.rounds, state.performers).map((r) => r.performer.id), ["p0", "p2", "p1"]);
  assert.deepEqual(getRankings(state.rounds, state.performers, "me").map((r) => [r.performer.id, r.total, r.rank]), [
    ["p1", 90, 1], ["p0", 0, 2],
  ]);
});

test("publication requires every frozen judge, not the number of keys", () => {
  const state = room();
  state.submitted = { p0: 0, "p0:a": 80, "p0:b": 90, "p0:stranger": 100 };
  assert.equal(submittedJudges(state, "p0").length, 3);
  assert.equal(canPublishScores(state, "p0"), false);
  assert.equal(publishScores(state, "p0"), state);
  const complete = submitScore(state, "p0", "c", "100");
  const published = publishScores(complete, "p0");
  assert.deepEqual(published.rounds[0].scores, { me: 0, a: 80, b: 90, c: 100 });
  assert.deepEqual(published.submitted, {});
  assert.equal(published.activeIndex, 1);
  assert.equal(Object.hasOwn(published.rounds[0].scores, "stranger"), false);
});

test("invalid stored scores, empty roster, unknown performer and not-started rooms cannot publish", () => {
  const state = fillScores();
  for (const invalid of [NaN, Infinity, -1, 101, 1.5, undefined]) {
    const broken = { ...state, submitted: { ...state.submitted, "p0:c": invalid } } as Persisted;
    assert.equal(publishScores(broken, "p0"), broken);
  }
  for (const invalid of [{ ...state, judges: [] }, { ...state, roomStarted: false }]) {
    assert.equal(publishScores(invalid, "p0"), invalid);
  }
  assert.equal(publishScores(state, "unknown"), state);
  assert.equal(submitScore(state, "p0", "unknown", "90"), state);
});

test("scores are editable before publication, immutable afterward for self and other judges", () => {
  const state = fillScores();
  const revised = submitScore(state, "p0", "me", "100");
  assert.equal(state.submitted.p0, 90);
  assert.equal(revised.submitted.p0, 100);
  const published = publishScores(revised, "p0");
  const before = structuredClone(published);
  for (const judge of published.judges) {
    assert.equal(submitScore(published, "p0", judge.id, "0"), published);
  }
  assert.equal(publishScores(published, "p0"), published);
  assert.deepEqual(published, before);
});

test("unpublished votes never expose champions or runoff candidates", () => {
  const state = fillVotes();
  assert.deepEqual(getFinale(state), { firstWinners: [], runoffNeeded: false, champions: [] });
  assert.equal(startRunoff(state), state);
  assert.equal(submitVote(state, "me", "p0", true), state);
});

test("vote publication requires all known judges with valid candidate choices", () => {
  const state = room();
  state.votes = { me: "p0", a: "p1", b: "p0", stranger: "p1" };
  assert.equal(canPublishVotes(state, false), false);
  assert.equal(publishVotes(state, false), state);
  for (const choice of ["", "p3", "unknown"]) {
    assert.equal(submitVote(state, "c", choice, false), state);
    const broken = { ...state, votes: { ...state.votes, c: choice } };
    assert.equal(canPublishVotes(broken, false), false);
  }
  assert.equal(submitVote(state, "unknown", "p0", false), state);
  const empty = { ...state, judges: [] };
  assert.equal(publishVotes(empty, false), empty);
  assert.equal(voteTally(state.votes, state.finalists, state.judges).find((r) => r.id === "p1")?.count, 1);
});

test("single winner is shown only after publication; no runoff or vote edits allowed afterward", () => {
  const state = fillVotes(room(), ["p0", "p0", "p1", "p0"]);
  const edited = submitVote(state, "b", "p2", false);
  assert.equal(state.votes.b, "p1");
  assert.equal(edited.votes.b, "p2");
  const published = publishVotes(edited, false);
  assert.deepEqual(getFinale(published).champions, ["p0"]);
  assert.equal(startRunoff(published), published);
  for (const judge of state.judges) assert.equal(submitVote(published, judge.id, "p1", false), published);
  assert.equal(publishVotes(published, false), published);
});

test("only top-tied candidates can receive one runoff; another tie is a shared championship", () => {
  const first = publishVotes(fillVotes(), false);
  assert.deepEqual(getFinale(first), { firstWinners: ["p0", "p1"], runoffNeeded: true, champions: [] });
  const runoff = startRunoff(first);
  assert.equal(first.runoffDone, false);
  assert.deepEqual(voteRound(runoff, true).candidates, ["p0", "p1"]);
  assert.equal(submitVote(runoff, "me", "p2", true), runoff);
  assert.equal(submitVote(runoff, "me", "p1", false), runoff);
  assert.equal(publishVotes(runoff, true), runoff);
  assert.equal(startRunoff(runoff), runoff);
  const voted = fillVotes(runoff, ["p1", "p0", "p1", "p0"], true);
  assert.deepEqual(getFinale(voted).champions, []);
  const revised = submitVote(voted, "me", "p0", true);
  assert.equal(revised.runoffVotes.me, "p0");
  assert.equal(voted.runoffVotes.me, "p1");
  const published = publishVotes(voted, true);
  assert.deepEqual(getFinale(published), { firstWinners: ["p0", "p1"], runoffNeeded: false, champions: ["p0", "p1"] });
  for (const judge of published.judges) {
    assert.equal(submitVote(published, judge.id, "p0", true), published);
    assert.equal(submitVote(published, judge.id, "p1", false), published);
  }
  assert.equal(startRunoff(published), published);
  assert.equal(publishVotes(published, true), published);
  assert.deepEqual(published.votes, first.votes);
});

test("runoff can also resolve to a single winner without altering first-round scores or votes", () => {
  const state = publishScores(fillScores(), "p0");
  const first = publishVotes(fillVotes(state), false);
  const runoff = startRunoff(first);
  const published = publishVotes(fillVotes(runoff, ["p1", "p1", "p1", "p0"], true), true);
  assert.deepEqual(getFinale(published).champions, ["p1"]);
  assert.deepEqual(published.rounds, state.rounds);
  assert.deepEqual(published.votes, first.votes);
});

test("a lower-vote candidate is excluded from runoff even when it received a vote", () => {
  const state = room();
  state.judges.push({ id: "d", name: "D" });
  const first = publishVotes(fillVotes(state, ["p0", "p0", "p1", "p1", "p2"]), false);
  assert.deepEqual(getFinale(first).firstWinners, ["p0", "p1"]);
  assert.equal(submitVote(startRunoff(first), "me", "p2", true).runoffVotes.me, undefined);
});
