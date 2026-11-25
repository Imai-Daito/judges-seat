import { useState } from "react";
import { FinalVoteBoard } from "./_FinalVoteBoard";
import "./FinalVote.css";

const demoJudges = [
  { id: "j1", name: "あかり" }, { id: "j2", name: "タク" }, { id: "j3", name: "みっちゃん" },
  { id: "j4", name: "さとし" }, { id: "j5", name: "ユウ" }, { id: "j6", name: "まーくん" },
  { id: "j7", name: "ナオ" }, { id: "j8", name: "けいこ" }, { id: "j9", name: "ショウ" },
];
const demoCandidates = [
  { id: "dondo", name: "ドンデコルテ" },
  { id: "takuro", name: "たくろう" },
  { id: "evers", name: "エバース" },
];
const demoVotes: Record<string, string> = {
  j1: "dondo", j2: "takuro", j3: "evers",
  j4: "dondo", j5: "takuro", j6: "dondo",
  j7: "evers", j8: "takuro", j9: "dondo",
};

export function FinalVote() {
  const [published, setPublished] = useState(false);
  const [sequence, setSequence] = useState(0);
  return <main className="fv-preview">
    <header className="fv-preview-head">
      <div className="fv-preview-mark">審</div>
      <div><strong>審査員席</strong><span>M-1 WATCHING ROOM</span></div>
      <span className="fv-demo-tag">演出デモ</span>
    </header>
    <section className="fv-preview-intro">
      <span>FINAL VOTE　／　最終決戦</span>
      <h1>最後の一票を、<br />開く。</h1>
      <p>テレビの前の9人が、順に札を返す。</p>
    </section>
    <FinalVoteBoard
      judges={demoJudges}
      candidates={demoCandidates}
      votes={published ? demoVotes : {}}
      published={published}
      sequenceKey={`demo-final-${sequence}`}
      title="FINAL JUDGE"
    />
    {!published ? <button className="fv-launch" data-testid="button-publish-demo-vote" onClick={() => setPublished(true)}>最終決戦の結果を発表</button> :
      <button className="fv-launch fv-launch-secondary" data-testid="button-reset-demo-vote" onClick={() => setSequence((value) => value + 1)}>札をもう一度並べる</button>}
    <p className="fv-preview-note">演出デモ・架空の投票です。公式結果ではありません。</p>
  </main>;
}
