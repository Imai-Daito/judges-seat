import assert from "node:assert/strict";

// Isolated real HTTP sessions. Never log session cookies or invite URLs.
const base = "http://localhost:80/api/rooms";
const host = { cookie: "" }, guest = { cookie: "" }, outsider = { cookie: "" };
let state;
let checks = 0;
const streamAbort = new AbortController();
async function call(actor, path, body, expected = 200, withHeader = true) {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { ...(actor.cookie ? { Cookie: actor.cookie } : {}), ...(body ? { "Content-Type": "application/json", ...(withHeader ? { "X-Judges-Client": "1" } : {}) } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  const cookie = res.headers.get("set-cookie");
  if (cookie) actor.cookie = cookie.split(";")[0];
  const data = await res.json();
  assert.equal(res.status, expected, `${path.replace(/\/[A-Za-z0-9_-]{24}/g,"/[room]")}: ${JSON.stringify(data.error ?? "")}`);
  checks++;
  return data;
}
async function act(actor, body, expected = 200) {
  const data = await call(actor, `/${state.id}/actions`, { version: state.version, ...body }, expected);
  if (expected === 200) state = data;
  return data;
}
try {
  await call(host, "", { nickname:"幹事",title:"API確認",performers:["組A","組B","組C"],retentionDays:30 },403,false);
  state = await call(host, "", { nickname:"幹事",title:"API確認",performers:["組A","組B","組C"],retentionDays:30 },201);
  assert.ok(Math.abs(Date.parse(state.expiresAt)-Date.now()-30*86400000)<10000);
  const id = state.id;
  await call(outsider, `/${id}`,undefined,401);
  await call(outsider, `/${id}/join`,{nickname:"  "},400);
  await call(outsider, `/${id}/join`,{nickname:"幹事"},400);
  state = await call(guest, `/${id}/join`,{nickname:"友達"});
  const guestId = state.me, hostId = state.hostId;
  await act(guest,{type:"start"},403);
  await act(host,{type:"configure",title:"API確認・更新",names:["組A","組B","組C"]});
  await act(host,{type:"start"});
  await call(outsider, `/${id}/join`,{nickname:"遅刻"},409);
  await call(guest, `/${id}/join`,{nickname:"再接続"});
  const stream = await fetch(`${base}/${id}/events`,{headers:{Cookie:guest.cookie},signal:streamAbort.signal});
  assert.equal(stream.status,200);
  assert.match(stream.headers.get("content-type"),/text\/event-stream/);
  const reader = stream.body.getReader();
  const event = await reader.read();
  assert.match(new TextDecoder().decode(event.value), /version/);
  checks++;
  for (const [i,p] of state.performers.entries()) {
    await act(host,{type:"score",performerId:p.id,score:93+i});
    const g = await call(guest,`/${id}`);
    assert.equal(g.ownScore,null);
    assert.equal(g.rounds.length,i);
    assert.equal(g.scores,undefined);
    assert.deepEqual(Object.keys(g).sort(),["id","title","version","me","hostId","members","performers","started","activeId","submitted","ownScore","rounds","final","runoff","expiresAt","serverTime"].sort());
    assert.ok(!JSON.stringify(g).includes("identity"));
    await act(host,{type:"score",performerId:p.id,score:94+i});
    await act(host,{type:"select",performerId:state.performers[(i+1)%3].id},409);
    await act(host,{type:"publishScore",performerId:p.id},409);
    await act(guest,{type:"score",performerId:p.id,score:86+i});
    const h = await call(host,`/${id}`);
    assert.equal(h.ownScore,94+i);
    assert.equal(h.scores,undefined);
    await act(guest,{type:"publishScore",performerId:p.id},403);
    const oldVersion = state.version;
    await act(host,{type:"publishScore",performerId:p.id});
    await call(host,`/${id}/actions`,{type:"score",version:oldVersion,performerId:p.id,score:1},409);
    await act(host,{type:"score",performerId:p.id,score:1},409);
    const publicResult = await call(guest,`/${id}`);
    assert.equal(publicResult.rounds[i].scores[hostId],94+i);
    assert.equal(publicResult.rounds[i].scores[guestId],86+i);
  }
  const ids = state.performers.map(p=>p.id);
  await act(guest,{type:"finalists",candidates:ids},403);
  await act(host,{type:"finalists",candidates:ids});
  await act(host,{type:"vote",performerId:ids[2]});
  await act(host,{type:"vote",performerId:ids[0]});
  let g=await call(guest,`/${id}`);
  assert.deepEqual(g.final.votes,{});
  assert.equal(g.final.ownVote,null);
  await act(host,{type:"publishVote"},409);
  await act(guest,{type:"vote",performerId:ids[1]});
  await act(host,{type:"publishVote"});
  assert.equal(state.final.votes[hostId],ids[0]);
  await act(host,{type:"vote",performerId:ids[2]},409);
  await act(host,{type:"runoff"});
  assert.deepEqual(state.runoff.candidates,ids.slice(0,2));
  await act(guest,{type:"vote",runoff:true,performerId:ids[2]},409);
  await act(host,{type:"vote",runoff:true,performerId:ids[0]});
  g=await call(guest,`/${id}`);
  assert.deepEqual(g.runoff.votes,{});
  await act(guest,{type:"vote",runoff:true,performerId:ids[1]});
  await act(host,{type:"publishVote",runoff:true});
  await act(host,{type:"vote",runoff:true,performerId:ids[1]},409);
  await act(host,{type:"runoff"},409);
  await reader.cancel();
  const restored=await call(guest,`/${id}`);
  assert.equal(restored.me,guestId);
  assert.deepEqual(restored.rounds,state.rounds);
  assert.equal(restored.runoff.published,true);
  console.log(`PASS: ${checks} HTTP/SSE checks; role isolation, privacy, score edits, cutoff, reconnect, immutable publication, tied-only single runoff.`);
  const { testResilience } = await import("./rooms.resilience.mjs");
  await testResilience();
} catch(e) {
  console.error(e);
  process.exitCode=1;
} finally { streamAbort.abort(); }
