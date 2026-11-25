import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { RoomSnapshot, ScoreRound } from "./room-client";
import { rankings } from "./Results";

export function Reveal({ room, round, replay, close }: {room: RoomSnapshot; round: ScoreRound; replay: boolean; close: () => void}) {
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const slots = useRef<Array<HTMLDivElement | null>>([]);
  const [clock, setClock] = useState(Date.now);
  const [start] = useState(() => replay ? Date.now() : round.publishedAt + (Date.now() - room.serverTime));
  const [target, setTarget] = useState({ x: 0, y: 0, scale: .4 });
  const stepMs = reduced ? 420 : 1600;
  const elapsed = Math.max(-1, clock - start);
  const index = Math.max(0, Math.floor(elapsed / stepMs));
  const local = elapsed % stepMs;
  const settled = index >= room.members.length;
  const rank = rankings(room).find(r => r.id === round.performerId)?.rank;
  useEffect(() => {
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 40);
    return () => window.clearInterval(timer);
  }, []);
  useLayoutEffect(() => {
    const parent = root.current?.getBoundingClientRect(), slot = slots.current[index]?.getBoundingClientRect();
    if (parent && slot) setTarget({
      x: slot.left + slot.width/2 - (parent.left + parent.width/2),
      y: slot.top + slot.height/2 - (parent.top + parent.height*.52),
      scale: Math.min(.62, slot.width/228, slot.height/154),
    });
  }, [index]);
  const metal = (n: number) => n >= 90 ? "gold" : n >= 80 ? "silver" : "bronze";
  const member = room.members[index];
  return <><div className="js-reveal-stage" ref={root}>
    <div className="js-reveal-mast"><div className="js-panel-kicker">JUDGE</div><h1>{room.performers.find(p => p.id === round.performerId)?.name}</h1></div>
    <div className="js-score-slots">{room.members.map((m,i) => <div ref={el => { slots.current[i] = el; }} className={`js-score-slot is-${metal(round.scores[m.id])}`} key={m.id}>
      <div className="js-slot-score">{elapsed >= 0 && (i < index || i === index && local > stepMs*.8) ? round.scores[m.id] : "—"}</div><div className="js-slot-name">{m.name}</div>
    </div>)}</div>
    {elapsed >= 0 && !settled && local <= stepMs*.8 && member && <motion.div key={index} className="js-flying-card"
      initial={{ x:0, y:0, scale:1.15, opacity:0, rotateX:0 }}
      animate={local > stepMs*.32 ? { ...target, opacity:1, rotateX:reduced ? 0 : 360 } : { x:0,y:0,scale:1,opacity:1,rotateX:0 }}
      transition={{ duration: reduced ? .05 : .55, ease:[.22,.8,.35,1] }}>
      <div className={`js-score-face is-${metal(round.scores[member.id])}`}><div className="js-big-score">{round.scores[member.id]}</div><div className="js-big-name">{member.name}</div></div>
    </motion.div>}
    {settled && <motion.div className="js-total-card" initial={{ opacity:0,scale:.7 }} animate={{ opacity:1,scale:1 }}>
      <div className="js-total-num">{Object.values(round.scores).reduce((a,b) => a+b,0)}</div>
      {elapsed > stepMs*room.members.length+900 && <div className="js-total-rank">第 {rank} 位</div>}
    </motion.div>}
  </div><button className="js-button is-wide" onClick={close}>{settled ? "結果へ進む" : "演出をスキップして結果へ"}</button></>;
}
