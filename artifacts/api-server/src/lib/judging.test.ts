import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAction, emptyBallot, snapshot, type Room } from "./judging";

function fixture(): Room {
  return {
    title:"テスト大会",version:0,hostId:"a",members:[{id:"a",name:"幹事",identity:"private-a"},{id:"b",name:"友達",identity:"private-b"}],
    performers:[{id:"p",name:"コンビ1"},{id:"q",name:"コンビ2"}],started:false,activeId:null,
    scores:{},rounds:[],final:emptyBallot(),runoff:emptyBallot(),
  };
}
test("only the organizer can start, membership requires 2, and stale writes fail", () => {
  const r = fixture();
  assert.throws(()=>applyAction(r,r.members[1],{type:"start",version:0}),/幹事/);
  applyAction(r,r.members[0],{type:"start",version:0});
  assert.throws(()=>applyAction(r,r.members[0],{type:"score",performerId:"p",score:90,version:0}),/更新/);
  assert.throws(()=>applyAction(r,r.members[0],{type:"configure",title:"x",names:["x","y"],version:r.version}),/開始後/);
});
test("redaction applies to scores, ballots, identities, and host snapshots", () => {
  const r=fixture(); r.started=true;r.activeId="p";r.scores={a:94,b:87};
  r.final={candidates:["p","q"],votes:{a:"p",b:"q"},published:false};
  const s=snapshot("room",r,r.members[0],new Date());
  assert.equal(s.ownScore,94);
  assert.deepEqual(s.submitted,["a","b"]);
  assert.deepEqual(s.final.votes,{});
  assert.equal(s.final.ownVote,"p");
  assert.ok(!Object.hasOwn(s,"scores"));
  assert.ok(!JSON.stringify(s).includes("private-"));
});
test("score edits are allowed before publication and never after, even for host", () => {
  const r=fixture(), h=r.members[0], g=r.members[1];
  const act=(a: Parameters<typeof applyAction>[2], who=h)=>applyAction(r,who,{...a,version:r.version},10000);
  act({type:"start",version:0});
  act({type:"score",performerId:"p",score:0,version:0});
  act({type:"score",performerId:"p",score:100,version:0});
  assert.throws(()=>act({type:"score",performerId:"p",score:100.1,version:0}));
  assert.throws(()=>act({type:"publishScore",performerId:"p",version:0}));
  act({type:"score",performerId:"p",score:80,version:0},g);
  assert.throws(()=>act({type:"publishScore",performerId:"p",version:0},g),/幹事/);
  act({type:"publishScore",performerId:"p",version:0});
  assert.deepEqual(r.rounds[0].scores,{a:100,b:80});
  assert.equal(r.rounds[0].publishedAt,11200);
  assert.throws(()=>act({type:"score",performerId:"p",score:90,version:0}));
  assert.throws(()=>act({type:"publishScore",performerId:"p",version:0}));
});
test("finalists must be real contestants after scoring; tied-only runoff happens once",()=>{
  const r=fixture(),h=r.members[0],g=r.members[1];
  const act=(a: Omit<Parameters<typeof applyAction>[2],"version">,who=h)=>applyAction(r,who,{...a,version:r.version});
  act({type:"start"});
  assert.throws(()=>act({type:"finalists",candidates:["p","q"]}));
  r.rounds=[{performerId:"p",scores:{a:90,b:90},publishedAt:1},{performerId:"q",scores:{a:90,b:90},publishedAt:2}];
  act({type:"finalists",candidates:["p","q"]});
  act({type:"vote",performerId:"p"});
  act({type:"vote",performerId:"q"});
  assert.throws(()=>act({type:"publishVote"}));
  act({type:"vote",performerId:"p"},g);
  act({type:"publishVote"});
  assert.throws(()=>act({type:"vote",performerId:"p"}));
  act({type:"runoff"});
  assert.deepEqual(r.runoff.candidates,["p","q"]);
  act({type:"vote",performerId:"p",runoff:true});
  act({type:"vote",performerId:"q",runoff:true},g);
  act({type:"publishVote",runoff:true});
  assert.throws(()=>act({type:"runoff"}));
  assert.throws(()=>act({type:"vote",performerId:"q",runoff:true}));
});
