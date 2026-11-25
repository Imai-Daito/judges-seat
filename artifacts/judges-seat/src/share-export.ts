import type { PublicBallot, PublicResults, RoomSnapshot } from "@workspace/api-client-react";

/** Explicit projection: only published, non-personal fields leave the snapshot. */
export function toPublicResults(room: RoomSnapshot): PublicResults {
  const ballot = (b: RoomSnapshot["final"]): PublicBallot =>
    b.published ? { published: true, candidates: [...b.candidates], votes: { ...b.votes } } : { published: false, candidates: [], votes: {} };
  return {
    title: room.title,
    members: room.members.map(m => ({ id: m.id, name: m.name })),
    performers: room.performers.map(p => ({ id: p.id, name: p.name })),
    rounds: room.rounds.filter(r => r.publishedAt > 0).map(r => ({ performerId: r.performerId, scores: { ...r.scores }, publishedAt: r.publishedAt })),
    final: ballot(room.final),
    runoff: ballot(room.runoff),
    expiresAt: room.expiresAt,
  };
}

export type RankRow = { id: string; total: number; rank: number };
/** Competition ranking: 1, 1, 3. */
export function publicRankings(r: Pick<PublicResults, "rounds">): RankRow[] {
  const rows = r.rounds.map(x => ({ id: x.performerId, total: Object.values(x.scores).reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total);
  return rows.map(x => ({ ...x, rank: rows.filter(y => y.total > x.total).length + 1 }));
}
export function ballotWinners(b: PublicBallot): string[] {
  if (!b.published || !b.candidates.length) return [];
  const counts = b.candidates.map(id => ({ id, n: Object.values(b.votes).filter(v => v === id).length }));
  const max = Math.max(...counts.map(c => c.n));
  return counts.filter(c => c.n === max).map(c => c.id);
}
export function champions(r: Pick<PublicResults, "final" | "runoff">): string[] {
  if (r.runoff.published) return ballotWinners(r.runoff);
  const first = ballotWinners(r.final);
  return first.length === 1 ? first : [];
}

export type VoteLine = { kind: "tally"; id: string } | { kind: "vote"; memberId: string };
export type SharePage =
  | { kind: "ranking"; withChampion: boolean; rows: RankRow[]; part: number; parts: number }
  | { kind: "champions"; ids: string[]; part: number; parts: number }
  | { kind: "scores"; judgeIds: string[]; performerIds: string[]; colPart: number; colParts: number; rowPart: number; rowParts: number }
  | { kind: "votes"; ballot: "final" | "runoff"; lines: VoteLine[]; part: number; parts: number };
export type PlanOptions = { judgesPerPage?: number; rowsPerPage?: number; rankFirst?: number; rankRest?: number; votesPerPage?: number };

const chunk = <T,>(xs: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };

/** Pure pagination. Every judge column and every performer row appears on some page. */
export function planSharePages(r: PublicResults, o: PlanOptions = {}): SharePage[] {
  const { judgesPerPage = 5, rowsPerPage = 7, rankFirst = 8, rankRest = 11, votesPerPage = 11 } = o;
  if (![judgesPerPage, rowsPerPage, rankFirst, rankRest, votesPerPage].every(n => Number.isInteger(n) && n > 0)) throw new RangeError("Page sizes must be positive integers");
  const pages: SharePage[] = [];
  const ranks = publicRankings(r);
  const rankChunks = ranks.length <= rankFirst ? [ranks] : [ranks.slice(0, rankFirst), ...chunk(ranks.slice(rankFirst), rankRest)];
  rankChunks.forEach((rows, i) => pages.push({ kind: "ranking", withChampion: i === 0, rows, part: i + 1, parts: rankChunks.length }));
  const champs = champions(r);
  if (champs.length > 1) {
    const parts = chunk(champs, 8);
    parts.forEach((ids, i) => pages.push({ kind: "champions", ids, part: i + 1, parts: parts.length }));
  }
  if (r.rounds.length && r.members.length) {
    const cols = chunk(r.members.map(m => m.id), judgesPerPage);
    const rows = chunk(r.rounds.map(x => x.performerId), rowsPerPage);
    rows.forEach((performerIds, ri) => cols.forEach((judgeIds, ci) => pages.push({ kind: "scores", judgeIds, performerIds, colPart: ci + 1, colParts: cols.length, rowPart: ri + 1, rowParts: rows.length })));
  }
  (["final", "runoff"] as const).forEach(key => {
    const b = r[key];
    if (!b.published) return;
    const lines: VoteLine[] = [...b.candidates.map(id => ({ kind: "tally" as const, id })), ...r.members.map(m => ({ kind: "vote" as const, memberId: m.id }))];
    const parts = chunk(lines, votesPerPage);
    parts.forEach((ls, i) => pages.push({ kind: "votes", ballot: key, lines: ls, part: i + 1, parts: parts.length }));
  });
  return pages;
}

/** Character-level wrap for Japanese (no spaces). Pure given measure. */
export function wrapChars(text: string, maxWidth: number, measure: (s: string) => number, maxLines = 3): string[] {
  const lines: string[] = []; let cur = "";
  for (const ch of Array.from(text)) {
    if (cur && measure(cur + ch) > maxWidth) { lines.push(cur); cur = ch; } else cur += ch;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const kept = lines.slice(0, maxLines); kept[maxLines - 1] = kept[maxLines - 1].slice(0, -1) + "…"; return kept; }
  return lines.length ? lines : [""];
}

const W = 1080, H = 1350, M = 56;
const C = { bg: "#070509", panel: "#141016", line: "#ffffff22", gold: "#ffd23f", red: "#d71022", cream: "#fff9e8", dim: "#bfb49a" };
const F = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';

function frame(ctx: CanvasRenderingContext2D, r: PublicResults, label: string, n: number, total: number) {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.red; ctx.fillRect(0, 0, W, 16);
  ctx.fillStyle = C.gold; ctx.fillRect(0, 16, W, 4);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.red; ctx.fillRect(M, 52, 46, 46);
  ctx.fillStyle = C.cream; ctx.font = `italic 900 30px ${F}`; ctx.textAlign = "center"; ctx.fillText("審", M + 23, 86);
  ctx.textAlign = "left"; ctx.fillStyle = C.gold; ctx.font = `italic 900 28px ${F}`; ctx.fillText("審査員席", M + 62, 84);
  ctx.textAlign = "right"; ctx.fillStyle = C.cream; ctx.font = `900 30px ${F}`; ctx.fillText(`${n} / ${total}`, W - M, 84);
  ctx.textAlign = "left"; ctx.font = `italic 900 28px ${F}`; ctx.fillStyle = C.cream;
  const tl = wrapChars(r.title, W - 2 * M, s => ctx.measureText(s).width, 2);
  tl.forEach((l, i) => ctx.fillText(l, M, 156 + i * 48));
  const y = 156 + tl.length * 48 + 8;
  ctx.fillStyle = C.red; ctx.fillRect(M, y - 26, 8, 34);
  ctx.fillStyle = C.gold; ctx.font = `italic 900 28px ${F}`; ctx.fillText(label, M + 20, y);
  ctx.fillStyle = C.line; ctx.fillRect(M, H - 86, W - 2 * M, 2);
  ctx.fillStyle = C.dim; ctx.font = `700 20px ${F}`; ctx.fillText("公開済みの点数・票のみ ／ 非公式の観戦用アプリ", M, H - 46);
  ctx.textAlign = "right"; ctx.fillText(`PAGE ${n} / ${total}`, W - M, H - 46); ctx.textAlign = "left";
  return y + 34;
}

function drawLines(ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, lh: number) { lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh)); }

export async function renderSharePages(r: PublicResults): Promise<Blob[]> {
  try { await Promise.all([document.fonts.load(`italic 900 40px "Noto Sans JP"`), document.fonts.load(`900 40px "Noto Sans JP"`)]); } catch { /* system font fallback */ }
  const pages = planSharePages(r);
  const name = (id: string) => r.performers.find(p => p.id === id)?.name ?? "—";
  const member = (id: string) => r.members.find(m => m.id === id)?.name ?? "—";
  const totals = new Map(publicRankings(r).map(x => [x.id, x.total]));
  const out: Blob[] = [];
  for (const [i, page] of pages.entries()) {
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d"); if (!ctx) throw new Error("画像を作成できません");
    const measure = (s: string) => ctx.measureText(s).width;
    if (page.kind === "ranking") {
      let y = frame(ctx, r, `総合順位${page.parts > 1 ? `（${page.part}/${page.parts}）` : ""}`, i + 1, pages.length);
      if (page.withChampion) {
        const ch = champions(r);
        ctx.fillStyle = C.panel; ctx.fillRect(M, y, W - 2 * M, 220); ctx.fillStyle = C.gold; ctx.fillRect(M, y, 10, 220);
        ctx.font = `italic 900 26px ${F}`; ctx.fillStyle = C.red; ctx.fillText(ch.length > 1 ? "同率優勝" : "優勝", M + 36, y + 50);
        ctx.font = `italic 900 52px ${F}`; ctx.fillStyle = ch.length ? C.gold : C.dim;
        drawLines(ctx, wrapChars(ch.length > 1 ? `${ch.length}組が同率優勝` : ch.length ? name(ch[0]) : "未確定", W - 2 * M - 72, measure, 2), M + 36, y + 120, 62);
        if (ch.length > 1) { ctx.font = `700 24px ${F}`; ctx.fillText("優勝組の全件一覧は「同率優勝」画像に掲載", M + 36, y + 192); }
        y += 252;
      }
      if (!page.rows.length) { ctx.font = `700 30px ${F}`; ctx.fillStyle = C.dim; ctx.fillText("公開済みの点数はまだありません", M, y + 50); }
      for (const row of page.rows) {
        ctx.fillStyle = C.line; ctx.fillRect(M, y + 76, W - 2 * M, 1);
        ctx.font = `900 46px ${F}`; ctx.fillStyle = row.rank === 1 ? C.gold : C.cream; ctx.fillText(String(row.rank), M, y + 56);
        ctx.font = `italic 900 30px ${F}`; ctx.fillStyle = C.cream;
        drawLines(ctx, wrapChars(name(row.id), 640, measure, 2), M + 100, y + 34, 34);
        ctx.textAlign = "right"; ctx.font = `900 44px ${F}`; ctx.fillStyle = C.gold; ctx.fillText(String(row.total), W - M - 34, y + 56);
        ctx.font = `700 20px ${F}`; ctx.fillStyle = C.dim; ctx.fillText("点", W - M, y + 56); ctx.textAlign = "left";
        y += 82;
      }
    } else if (page.kind === "champions") {
      let y = frame(ctx, r, `同率優勝（${page.part}/${page.parts}）`, i + 1, pages.length);
      for (const id of page.ids) {
        ctx.font = `italic 900 36px ${F}`; ctx.fillStyle = C.gold;
        drawLines(ctx, wrapChars(name(id), W - 2 * M - 24, measure, 2), M + 12, y + 40, 44);
        ctx.fillStyle = C.line; ctx.fillRect(M, y + 108, W - 2 * M, 1); y += 114;
      }
    } else if (page.kind === "scores") {
      const lbl = `採点表 審査員${page.colPart}/${page.colParts}・コンビ${page.rowPart}/${page.rowParts}`;
      let y = frame(ctx, r, lbl, i + 1, pages.length);
      const nameW = 300, totW = 120, colW = (W - 2 * M - nameW - totW) / page.judgeIds.length;
      ctx.fillStyle = C.panel; ctx.fillRect(M, y, W - 2 * M, 92);
      ctx.font = `italic 900 20px ${F}`; ctx.fillStyle = C.dim; ctx.fillText("コンビ", M + 14, y + 54);
      page.judgeIds.forEach((id, c) => {
        ctx.fillStyle = C.cream; ctx.font = `italic 900 22px ${F}`; ctx.textAlign = "center";
        const ls = wrapChars(member(id), colW - 12, measure, 3);
        drawLines(ctx, ls, M + nameW + colW * c + colW / 2, y + (ls.length > 1 ? 25 : 54), 26);
      });
      ctx.fillStyle = C.gold; ctx.fillText("合計", W - M - totW / 2, y + 54); ctx.textAlign = "left";
      y += 92;
      for (const pid of page.performerIds) {
        const round = r.rounds.find(x => x.performerId === pid);
        ctx.font = `italic 900 26px ${F}`; ctx.fillStyle = C.cream;
        const ls = wrapChars(name(pid), nameW - 24, measure, 3);
        drawLines(ctx, ls, M + 14, y + 40, 30);
        ctx.textAlign = "center"; ctx.font = `900 38px ${F}`;
        page.judgeIds.forEach((id, c) => { const v = round?.scores[id]; ctx.fillStyle = C.cream; ctx.fillText(v === undefined ? "—" : String(v), M + nameW + colW * c + colW / 2, y + 66); });
        ctx.fillStyle = C.gold; ctx.font = `900 40px ${F}`; ctx.fillText(String(totals.get(pid) ?? "—"), W - M - totW / 2, y + 66); ctx.textAlign = "left";
        ctx.fillStyle = C.line; ctx.fillRect(M, y + 112, W - 2 * M, 1);
        y += 113;
      }
    } else {
      const b = r[page.ballot];
      let y = frame(ctx, r, `${page.ballot === "final" ? "最終決戦" : "再投票"}の票${page.parts > 1 ? `（${page.part}/${page.parts}）` : ""}`, i + 1, pages.length);
      for (const line of page.lines) {
        ctx.fillStyle = C.line; ctx.fillRect(M, y + 76, W - 2 * M, 1);
        if (line.kind === "tally") {
          ctx.fillStyle = C.red; ctx.fillRect(M, y + 16, 6, 50);
          ctx.font = `italic 900 30px ${F}`; ctx.fillStyle = C.cream; drawLines(ctx, wrapChars(name(line.id), 700, measure, 2), M + 22, y + 34, 34);
          ctx.textAlign = "right"; ctx.font = `900 46px ${F}`; ctx.fillStyle = C.gold; ctx.fillText(`${Object.values(b.votes).filter(v => v === line.id).length}`, W - M - 34, y + 58);
          ctx.font = `700 20px ${F}`; ctx.fillStyle = C.dim; ctx.fillText("票", W - M, y + 58); ctx.textAlign = "left";
        } else {
          ctx.font = `700 26px ${F}`; ctx.fillStyle = C.dim; ctx.fillText(member(line.memberId), M, y + 50);
          ctx.textAlign = "right"; ctx.font = `italic 900 28px ${F}`; ctx.fillStyle = C.cream;
          const v = b.votes[line.memberId];
          drawLines(ctx, wrapChars(v ? name(v) : "—", 560, measure, 2), W - M, y + 34, 32); ctx.textAlign = "left";
        }
        y += 82;
      }
    }
    out.push(await new Promise<Blob>((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error("画像を作成できません")), "image/png")));
  }
  return out;
}
