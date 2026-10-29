// v9 shootout rules (primary target, spillover, max 3 return fire) + indoor positioning (wall-hugging, door stack, doorway exposure).
const Core = require('./load.js')(); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const allStaged = S => S.officers.forEach(o => { o.status = 'staged'; o.stage = 'primary'; o.eta = 0; });
function cellsAt(S, d0, d1, need) { const sp = S.suspect, c = [];
  for (let y = 0; y < Core.MAP_H; y++) for (let x = 0; x < Core.MAP_W; x++) { if (S.block[Core.idx(x, y)] || (x === sp.x && y === sp.y)) continue; const d = Core.dist(x, y, sp.x, sp.y); if (d < d0 || d > d1) continue;
    const l = Core.los(x, y, sp.x, sp.y) === 1 && Core.los(sp.x, sp.y, x, y) === 1; if (l === need) c.push([x, y, d]); }
  return c.sort((a, b) => a[2] - b[2]); }
function setup(seed, sizes) { const S = Core.newGame(seed, {}); allStaged(S); S.units = S.units.filter(u => u.kind !== 'patrol' && u.kind !== 'cruiser');
  const teams = []; let k = 0; for (const n of sizes) { const t = Core.formTeam(S.officers.slice(k, k + n).map(o => o.id)).team; k += n; t.deployed = true; teams.push(t); }
  const sp = S.suspect; sp.mode = 'alert'; sp.cd = 0; sp.stun = 0; sp.duck = 0; sp.suppressed = 0; sp.retreat = false; return { S, teams }; }
// 1) ≥4 officers with a line → only 3 return fire; no line → nobody
{ let done = 0; for (let seed = 3; seed < 40 && done < 6; seed++) { const { S, teams: [t] } = setup(seed, [6]); const c = cellsAt(S, 1.5, 5, true); if (!c.length) continue;
    t.x = c[0][0]; t.y = c[0][1]; const f = Core.returnFirers(); if (f.length < 3) continue; done++;
    ok(Core.teamOk(t).length >= 4 && f.length === Core.MAX_RETURN_FIRE && Core.MAX_RETURN_FIRE === 3, `seed ${seed}: ${Core.teamOk(t).length} with a line, ${f.length} return fire`);
    const n0 = S.log.length; Core.returnFire(); const l = S.log.slice(n0).find(x => /^Return fire:/.test(x.text)); ok(l && l.text.split(':')[1].split('—')[0].split(',').length === 3, 'log lists the 3 shooters: ' + (l && l.text));
    const nc = cellsAt(S, 2, 7, false); if (nc.length) { t.x = nc[0][0]; t.y = nc[0][1]; ok(Core.returnFirers().length === 0, 'no line of sight → no return fire'); } }
  ok(done >= 4, `return-fire cap checked on ${done} seeds`); }
// 2) primary = nearest visible officer; no retarget during the turn; new turn → retarget
{ let done = 0; for (let seed = 3; seed < 60 && done < 5; seed++) { const { S, teams: [a, b] } = setup(seed, [3, 3]); a.stance = b.stance = 'hold'; const c = cellsAt(S, 1.5, 6, true); if (c.length < 6) continue;
    const near = c[0], far = c.find(p => p[2] >= near[2] + 1.5); if (!far) continue; a.x = near[0]; a.y = near[1]; b.x = far[0]; b.y = far[1];
    const ch = S.rng.chance; S.rng.chance = () => true; Core.suspectTick(); S.rng.chance = ch; const sp = S.suspect; if (!sp.tgt) continue; done++;
    ok(sp.tgt.uid === a.uid, `seed ${seed}: primary is the nearest team (${sp.tgt.uid} vs ${a.uid})`);
    ok(S.log.some(l => /Suspect opens fire at/.test(l.text)), 'opening shot logged with the primary');
    b.x = c[0][0]; b.y = c[0][1]; a.x = far[0]; a.y = far[1]; sp.cd = 0; sp.duck = 0; sp.suppressed = 0; S.rng.chance = () => true; Core.suspectTick(); S.rng.chance = ch;
    ok(sp.tgt.uid === a.uid, 'no retarget until the next turn even when another team is now nearer');
    S.turn++; sp.cd = 0; sp.duck = 0; sp.suppressed = 0; S.rng.chance = () => true; Core.suspectTick(); S.rng.chance = ch; ok(sp.tgt && sp.tgt.uid === b.uid, 'next turn: retargets the nearest'); }
  ok(done >= 3, `primary-target checks on ${done} seeds`); }
// 3) spillover only after the primary officer is down, capped
{ let done = 0; for (let seed = 3; seed < 60 && done < 4; seed++) { const { S, teams: [t] } = setup(seed, [4]); t.stance = 'hold'; const c = cellsAt(S, 1.5, 5, true); if (!c.length) continue; t.x = c[0][0]; t.y = c[0][1];
    const sp = S.suspect; const ch = S.rng.chance; S.rng.chance = () => true; Core.suspectTick(); S.rng.chance = ch; if (!sp.tgt || !sp.tgt.off) continue; done++;
    ok(sp.tgt.spill === 0, 'primary standing → no spillover shots');
    const prim = S.officers.find(o => o.id === sp.tgt.off); prim.status = 'down';
    for (let i = 0; i < 6; i++) { S.shotsT = null; /* v20: per-turn rate of fire would cap a pump/bolt gun at 1 */ sp.cd = 0; sp.duck = 0; sp.suppressed = 0; S.rng.chance = () => true; Core.suspectTick(); S.rng.chance = ch; }
    ok(sp.tgt.spill > 0 && sp.tgt.spill <= Core.SHOOT_CFG.spillMax, `primary down → spillover rounds, capped (${sp.tgt.spill}/${Core.SHOOT_CFG.spillMax})`); }
  ok(done >= 3, `spillover checks on ${done} seeds`); }
// 4) indoor positioning: wall-hugging in rooms, door stack, doorway exposure
{ let rooms = 0, mid = 0, stacks = 0, bad = 0, expo = 0, expoBad = 0;
  for (let seed = 1; seed <= 30; seed++) { const { S, teams: [t] } = setup(seed, [6]); S.suspect.mode = 'barricaded';
    for (const r of S.rooms.filter(r => r.w >= 3 && r.h >= 3 && !/hall/i.test(r.name)).slice(0, 2)) { t.x = r.x + Math.floor(r.w / 2); t.y = r.y + Math.floor(r.h / 2); t.orders = []; const f = Core.formationFor(t); if (f.kind !== 'wall') continue; rooms++;
      const rm = Core.roomAt(t.x, t.y); for (const [ox, oy] of f.pts) { const px = t.x + ox, py = t.y + oy, cx = Math.round(px), cy = Math.round(py), fx = px - cx, fy = py - cy;
        const wall = (fx >= 0.25 && Core.roomAt(cx + 1, cy) !== rm) || (fx <= -0.25 && Core.roomAt(cx - 1, cy) !== rm) || (fy >= 0.25 && Core.roomAt(cx, cy + 1) !== rm) || (fy <= -0.25 && Core.roomAt(cx, cy - 1) !== rm);
        if (!wall || Core.roomAt(cx, cy) !== rm) mid++; } }
    for (const d of S.doors.slice(0, 3)) { const [[a0, a1], [b0, b1]] = d.cells[0]; const outIsA = Core.roomAt(a0, a1) < 0; const out = outIsA ? [a0, a1] : [b0, b1], inn = outIsA ? [b0, b1] : [a0, a1];
      if (Core.roomAt(out[0], out[1]) >= 0 && Core.roomAt(inn[0], inn[1]) < 0) continue; t.x = out[0]; t.y = out[1]; t.orders = []; d.state = 'open'; const f = Core.formationFor(t); if (f.kind !== 'stack') { bad++; continue; } stacks++;
      const dx = inn[0] - out[0], dy = inn[1] - out[1], ax = -dy, ay = dx; f.pts.forEach(([ox, oy], i) => { const fwd = ox * dx + oy * dy, lat = ox * ax + oy * ay; const inDoor = Math.abs(lat) < 0.5 && fwd > -0.6;
        if (i < 2 ? !(inDoor && fwd > 0.2) : inDoor) bad++; });
      const ids = new Set(Core.teamOk(t).slice(0, 2).map(o => o.id)); for (let k = 0; k < 120; k++) { const v = Core.pickVictim(t, inn[0], inn[1]); expo++; if (!ids.has(v.id)) expoBad++; } } }
  ok(rooms >= 10 && mid === 0, `room formation hugs walls (${rooms} rooms, ${mid} dots mid-room)`);
  ok(stacks >= 20 && bad === 0, `door stack: point + defense at the frames, rest on the wall out of the opening (${stacks} doors, ${bad} wrong)`);
  ok(expo > 0 && expoBad === 0, `through the door only the doorway pair can be hit (${expoBad}/${expo})`);
  const { S, teams: [t] } = setup(4, [6]); const d = S.doors.find(x => x.name === 'Front Door'); const [[a0, a1], [b0, b1]] = d.cells[0]; const out = Core.roomAt(a0, a1) < 0 ? [a0, a1] : [b0, b1]; t.x = out[0]; t.y = out[1]; d.state = 'open';
  const seen = new Set(); for (let k = 0; k < 300; k++) seen.add(Core.pickVictim(t, t.x + 6, t.y + 6).id); ok(seen.size > 2, 'from outside (same side) every member can still be hit'); }
console.log(`v9c: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
