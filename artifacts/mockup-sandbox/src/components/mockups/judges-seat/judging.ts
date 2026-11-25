export type Judge = { id: string; name: string; self?: boolean };
export type Performer = { id: string; name: string };
export type PublishedRound = { performerId: string; scores: Record<string, number> };
export type Persisted = {
  nickname: string; judges: Judge[]; performers: Performer[]; rounds: PublishedRound[];
  activeIndex: number; submitted: Record<string, number>; roomStarted: boolean;
  finalists: string[]; votes: Record<string, string>; votesPublished: boolean;
  runoffVotes: Record<string, string>; runoffPublished: boolean; runoffDone: boolean;
};

export function parseScore(input: string): number | null {
  if (!/^\d{1,3}$/.test(input)) return null;
  const value = Number(input);
  return isScore(value) ? value : null;
}

function isScore(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

// Preserve the existing >=90 appearance, including 100; a special 100 design is undecided.
export function scoreMetal(value: number) {
  return value >= 90 ? "gold" : value >= 80 ? "silver" : "bronze";
}

function ranked<T extends { total: number }>(rows: T[]) {
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  return sorted.map((row) => ({
    ...row,
    rank: sorted.findIndex((other) => other.total === row.total) + 1,
  }));
}

export function getRankings(rounds: PublishedRound[], performers: Performer[], judgeId?: string) {
  return ranked(performers.flatMap((performer) => {
    const round = rounds.find((item) => item.performerId === performer.id);
    if (!round || (judgeId !== undefined && !isScore(round.scores[judgeId]))) return [];
    const scores = Object.values(round.scores);
    return [{
      performer, total: judgeId === undefined ? scores.reduce((sum, value) => sum + value, 0) : round.scores[judgeId],
      count: scores.length, published: true,
    }];
  }));
}

function scoreKey(performerId: string, judge: Judge) {
  return judge.self ? performerId : `${performerId}:${judge.id}`;
}

export function submittedJudges(state: Persisted, performerId: string) {
  return state.judges.filter((judge) => isScore(state.submitted[scoreKey(performerId, judge)]));
}

export function canPublishScores(state: Persisted, performerId: string) {
  return state.roomStarted && state.performers.some((p) => p.id === performerId)
    && !state.rounds.some((round) => round.performerId === performerId)
    && state.judges.length > 0 && submittedJudges(state, performerId).length === state.judges.length;
}

// Rejected transitions return the original state; published records are never overwritten.
export function submitScore(state: Persisted, performerId: string, judgeId: string, input: string): Persisted {
  const judge = state.judges.find((item) => item.id === judgeId);
  const value = parseScore(input);
  if (!state.roomStarted || !judge || value === null || !state.performers.some((p) => p.id === performerId)
    || state.rounds.some((round) => round.performerId === performerId)) return state;
  return { ...state, submitted: { ...state.submitted, [scoreKey(performerId, judge)]: value } };
}

export function publishScores(state: Persisted, performerId: string): Persisted {
  if (!canPublishScores(state, performerId)) return state;
  const round = {
    performerId,
    scores: Object.fromEntries(state.judges.map((judge) => [judge.id, state.submitted[scoreKey(performerId, judge)]])),
  };
  const rounds = [...state.rounds, round];
  const nextIndex = state.performers.findIndex((p) => !rounds.some((item) => item.performerId === p.id));
  return { ...state, rounds, submitted: {}, activeIndex: nextIndex >= 0 ? nextIndex : state.activeIndex };
}

export function voteTally(source: Record<string, string>, candidates: string[], judges: Judge[]) {
  return candidates.map((id) => ({
    id, count: judges.filter((judge) => source[judge.id] === id).length,
  })).sort((a, b) => b.count - a.count);
}

function allVotesSubmitted(state: Persisted, source: Record<string, string>, candidates: string[]) {
  return state.judges.length > 0 && candidates.length >= 2
    && state.judges.every((judge) => candidates.includes(source[judge.id]));
}

function winners(source: Record<string, string>, candidates: string[], judges: Judge[]) {
  const tally = voteTally(source, candidates, judges);
  return tally.filter((row) => row.count > 0 && row.count === tally[0]?.count).map((row) => row.id);
}

export function getFinale(state: Persisted) {
  const firstWinners = state.votesPublished && allVotesSubmitted(state, state.votes, state.finalists)
    ? winners(state.votes, state.finalists, state.judges) : [];
  const runoffNeeded = firstWinners.length > 1 && !state.runoffDone;
  const champions = firstWinners.length === 1 ? firstWinners
    : state.runoffDone && state.runoffPublished && allVotesSubmitted(state, state.runoffVotes, firstWinners)
      ? winners(state.runoffVotes, firstWinners, state.judges) : [];
  return { firstWinners, runoffNeeded, champions };
}

export function voteRound(state: Persisted, runoff: boolean) {
  return {
    candidates: runoff ? getFinale(state).firstWinners : state.finalists,
    source: runoff ? state.runoffVotes : state.votes,
    published: runoff ? state.runoffPublished : state.votesPublished,
    active: runoff ? state.runoffDone && getFinale(state).firstWinners.length > 1 : !state.runoffDone,
  };
}

export function canPublishVotes(state: Persisted, runoff: boolean) {
  const round = voteRound(state, runoff);
  return round.active && !round.published && allVotesSubmitted(state, round.source, round.candidates);
}

export function submitVote(state: Persisted, judgeId: string, choice: string, runoff: boolean): Persisted {
  const round = voteRound(state, runoff);
  if (!round.active || round.published || !state.judges.some((judge) => judge.id === judgeId)
    || !round.candidates.includes(choice)) return state;
  const votes = { ...round.source, [judgeId]: choice };
  return { ...state, ...(runoff ? { runoffVotes: votes } : { votes }) };
}

export function publishVotes(state: Persisted, runoff: boolean): Persisted {
  if (!canPublishVotes(state, runoff)) return state;
  return { ...state, ...(runoff ? { runoffPublished: true } : { votesPublished: true }) };
}

export function startRunoff(state: Persisted): Persisted {
  if (!getFinale(state).runoffNeeded) return state;
  return { ...state, runoffDone: true, runoffPublished: false, runoffVotes: {} };
}
