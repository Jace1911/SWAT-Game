// v15: post-clear regroup on the door wall, 'After this, the team will' follow-ups, address labels (target red, duplex neighbour green).
const fs = require('fs'), path = require('path');
const Core = require('./load.js')(); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const prep = (seed, opts) => { const S = Core.newGame(seed, opts || {}); S.officers.forEach(o => { o.status = 'staged'; o.stage = 'primary'; o.eta = 0; });
  const t = Core.formTeam(S.officers.slice(0, 4).map(o => o.id)).team; Core.deployTeam && Core.deployTeam(t.uid); t.deployed = true; return { S, t }; };
const inRoomPath = (S, r, a, b) => { const seen = new Set([a.join()]), q = [a]; while (q.length) { const [x, y] = q.shift(); if (x === b[0] && y === b[1]) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = nx + ',' + ny; if (seen.has(k) || Core.roomAt(nx, ny) !== r || S.block[Core.idx(nx, ny)]) continue;
      const e = Core.edge(x, y, nx, ny); if (e.t !== 'O') continue; seen.add(k); q.push([nx, ny]); } } return false; };
// 1) regroup spot geometry
{ let tot = 0, got = 0, wall = 0, noDoor = 0, inRoom = 0, linePts = 0, ptsIn = 0, ptsN = 0, pathIn = 0, sameWall = 0;
  for (let seed = 1; seed <= 20; seed++) { const { S, t } = prep(seed);
    S.rooms.forEach((rm, r) => { if (rm.unitB || rm.w * rm.h < 4) return; const c = [rm.x + Math.floor(rm.w / 2), rm.y + Math.floor(rm.h / 2)]; if (S.block[Core.idx(c[0], c[1])]) return;
      t.x = c[0]; t.y = c[1]; tot++; const g = Core.regroupSpot(t, r, 4); if (!g) return; got++;
      if (Core.roomAt(g.x, g.y) === r) inRoom++;
      if (Core.roomAt(g.x + g.nx, g.y + g.ny) !== r && Core.edge(g.x, g.y, g.x + g.nx, g.y + g.ny).t !== 'D') wall++;
      if (!Core.roomDoorCells(r).some(dc => dc.cin[0] === g.x && dc.cin[1] === g.y)) noDoor++;
      const d0 = Core.roomDoorCells(r).find(dc => dc.d.id === g.door); if (d0 && (g.nx ? d0.cin[0] === g.x : d0.cin[1] === g.y)) sameWall++;
      if (inRoomPath(S, r, c, [g.x, g.y]) || S.block.some(() => false)) pathIn++;
      t.x = g.x; t.y = g.y; t.regroup = g; const f = Core.formationFor(t); if (f.kind === 'wallline') linePts++;
      const along = f.pts.map(p => p[0] * g.nx + p[1] * g.ny); if (f.pts.length === 4 && along.every(v => Math.abs(v - along[0]) < 0.01)) ptsN++;
      const doorCins = new Set(Core.roomDoorCells(r).map(dc => dc.cin.join()));
      if (f.pts.every(([ox, oy]) => { const cx = Math.round(g.x + ox - g.nx * 0.34), cy = Math.round(g.y + oy - g.ny * 0.34); return Core.roomAt(cx, cy) === r && !doorCins.has(cx + ',' + cy); })) ptsIn++;
      t.regroup = null; }); }
  console.log(`  regroup: ${got}/${tot} rooms have a spot · in room ${inRoom} · on wall ${wall} · same wall as door ${sameWall} · not in doorway ${noDoor} · reachable inside room ${pathIn} · wallline ${linePts} · one line ${ptsN} · members in room, none in opening ${ptsIn}`);
  ok(tot > 60 && got / tot > 0.85, `most rooms get a regroup spot (${got}/${tot})`);
  ok(inRoom === got && wall === got && noDoor === got && sameWall === got, 'spot is in the room, against the door wall, not in a doorway');
  ok(pathIn / got > 0.9, `spot reached without leaving the room (${pathIn}/${got})`);
  ok(linePts === got && ptsN === got, 'formation: one shoulder-to-shoulder line along the wall');
  ok(ptsIn / got > 0.9, `members stay in the room and out of the opening (${ptsIn}/${got})`); }
// 2) live: clear a room → team moves to the wall by the nearest door and lines up
{ let tried = 0, done = 0, lined = 0, noCross = 0;
  for (let seed = 1; seed <= 40 && done < 8; seed++) { const { S, t } = prep(seed); const sr = new Set(Core.suspList().map(s => s.room));
    const r = S.rooms.findIndex((rm, i) => !rm.unitB && !sr.has(i) && rm.w >= 3 && rm.h >= 3); if (r < 0) continue; const rm = S.rooms[r];
    const c = [rm.x + 1, rm.y + 1]; if (S.block[Core.idx(c[0], c[1])]) continue; t.x = c[0]; t.y = c[1]; tried++;
    const q = Core.queueOrder(t.uid, { type: 'clear', room: r }); if (!q.ok) continue; Core.execute(); const rooms = new Set();
    for (let k = 0; k < Core.TICKS && S.phase === 'executing'; k++) { Core.stepTick(); rooms.add(Core.roomAt(t.x, t.y)); }
    if (!t.regroup) continue; done++; if (t.x === t.regroup.x && t.y === t.regroup.y && Core.formationFor(t).kind === 'wallline') lined++; if (rooms.size === 1 && rooms.has(r)) noCross++; }
  console.log(`  live clear: ${done}/${tried} regrouped · lined up ${lined} · stayed in the room ${noCross}`);
  ok(done >= 5, `teams regroup after a clear (${done})`); ok(lined === done, 'team ends on the wall spot in a line'); ok(noCross === done, 'no doorway crossed while regrouping'); }
// 3) after-action API
{ const { S, t } = prep(7); ok(JSON.stringify(Core.AFTER_CFG.modes) === '["hold","clear","limited","assess"]', 'four follow-ups');
  ok(!Core.setAfter(t.uid, -1, 'clear').ok, 'no breach/throw → refused');
  const d = S.doors.find(x => x.exterior && x.state === 'closed' && !x.unitB); const q = Core.queueOrder(t.uid, { type: 'breach', door: d.id, method: 'ram' });
  if (q.ok) { ok(Core.setAfter(t.uid, -1, 'limited').ok && t.orders[t.orders.length - 1].after === 'limited', 'setAfter stores the follow-up'); ok(!Core.setAfter(t.uid, -1, 'dance').ok, 'unknown mode refused');
    ok(Core.setAfter(t.uid, -1, null).ok && !t.orders[t.orders.length - 1].after, 'follow-up can be cleared'); }
  const r0 = S.rooms.findIndex(rm => !rm.unitB); const hold = Core.afterOrders(t, 'hold', r0), clr = Core.afterOrders(t, 'clear', r0);
  ok(hold.length === 1 && hold[0].type === 'hold', 'hold → hold order'); ok(clr[0].type === 'clear' && clr[0].room === r0, 'clear → clear order for that room'); }
// 4) live follow-ups: breach then X / flashbang then X
const live = (kind, mode) => { for (let seed = 1; seed <= 15; seed++) { const { S, t } = prep(seed); let o;
    const d = S.doors.find(x => x.exterior && x.state === 'closed' && !x.unitB && !x.barricaded && x.kind !== 'garage'); if (!d) continue;
    const [a, b] = d.cells[0], out = Core.roomAt(a[0], a[1]) < 0 ? a : b, inn = out === a ? b : a; t.x = out[0]; t.y = out[1];
    if (kind === 'breach') o = { type: 'breach', door: d.id, method: 'ram' }; else { d.state = 'open'; d.locked = false; o = { type: kind, room: Core.roomAt(inn[0], inn[1]) }; }
    const q = Core.queueOrder(t.uid, o); if (!q.ok) continue; Core.setAfter(t.uid, -1, mode);
    for (let turn = 0; turn < 5 && S.phase !== 'over'; turn++) { if (S.phase === 'planning') Core.execute();
      for (let k = 0; k < Core.TICKS && S.phase === 'executing'; k++) { Core.stepTick(); if (o.afterDone) return { S, t, o, next: t.orders.slice() }; }
      if (S.phase === 'executing') while (S.phase === 'executing') Core.stepTick(); if (!t.orders.includes(o)) break; } }
  return null; };
for (const [kind, mode, want] of [['breach', 'assess', 'hold'], ['breach', 'clear', 'clear'], ['breach', 'limited', 'hold'], ['breach', 'hold', 'hold'], ['bang', 'clear', 'clear'], ['bang', 'assess', 'hold'], ['gas', 'hold', 'hold']]) {
  const R = live(kind, mode); ok(!!R, `${kind} → ${mode}: action resolved with the follow-up`); if (!R) continue;
  const fa = R.next.filter(x => x.fromAfter); ok(fa.length >= 1 && (fa.some(x => x.type === want) || R.t.orders.length === 0 && want === 'clear' && R.t.regroup), `${kind} → ${mode}: follow-up ${fa.map(x => x.type).join('+')} (${want})`);
  ok(R.S.log.some(l => l.text.toLowerCase().includes(Core.AFTER_CFG.names[mode].toLowerCase())), `${kind} → ${mode}: radio log`); }
// no after → old behaviour (bots / harness unchanged)
{ for (let seed = 1; seed <= 40; seed++) { const { S, t } = prep(seed); const q = Core.queueOrder(t.uid, { type: 'bang', room: S.suspect.room }); if (!q.ok) continue; Core.execute();
    for (let k = 0; k < Core.TICKS && S.phase === 'executing'; k++) Core.stepTick(); ok(!t.orders.some(x => x.fromAfter), 'no follow-up chosen → nothing added'); break; } }
// 5) address labels
{ let dup = 0, single = 0, red = 0, greenOk = 0, overB = 0, diff2 = 0;
  for (let seed = 1; seed <= 40; seed++) { const S = Core.newGame(seed, {}); const L = Core.addrLabels(); const T = L.filter(l => l.target);
    if (T.length === 1 && T[0].text === S.brief.addr && T[0].color === '#ff3b4e') red++;
    if (S.house.duplex) { dup++; const N = L.find(l => !l.target); if (N && N.color === '#3ddc84' && N.text !== T[0].text) greenOk++;
      if (N && Math.abs(N.num - T[0].num) === 2 && N.text.endsWith(S.brief.addr.replace(/^\d+\s+/, ''))) diff2++;
      const B = S.rooms.filter(q => q.unitB); if (N && N.x >= Math.min(...B.map(q => q.x)) - 0.5 && N.x <= Math.max(...B.map(q => q.x + q.w))) overB++;
      const A = S.rooms.filter(q => !q.unitB); if (!(T[0].x >= Math.min(...A.map(q => q.x)) - 0.5 && T[0].x <= Math.max(...A.map(q => q.x + q.w)))) ok(false, 'target label over the suspect unit ' + seed); }
    else if (L.length === 1) single++; }
  const dupX = dup;
  for (let seed = 1000; seed < 1015; seed++) { const S = Core.newGame(seed, { struct: 'duplex' }); if (!S.house.duplex) continue; dup++; const L = Core.addrLabels(), N = L.find(l => !l.target), T = L.find(l => l.target);
    if (N && N.color === '#3ddc84' && N.text !== T.text) greenOk++; if (N && Math.abs(N.num - T.num) === 2) diff2++; const B = S.rooms.filter(q => q.unitB); if (N && N.x >= Math.min(...B.map(q => q.x)) - 0.5 && N.x <= Math.max(...B.map(q => q.x + q.w))) overB++; }
  console.log(`  address: red target ${red}/40 · single-house labels ${single} · duplex ${dup}: green ${greenOk}, ±2 ${diff2}, over unit B ${overB}`);
  ok(red === 40, 'every map: one red label with the brief address'); ok(dup >= 5 && greenOk === dup && diff2 === dup && overB === dup, 'duplex: neighbour address in green, 2 numbers apart, over unit B');
  ok(single + dupX === 40, 'non-duplex: only the red label'); }
// 6) determinism, help, build
{ const a = Core.newGame(4242, {}), A = JSON.stringify(Core.addrLabels()); const b = Core.newGame(4242, {}); ok(A === JSON.stringify(Core.addrLabels()), 'labels deterministic'); }
{ const ui = fs.readFileSync(path.join(__dirname, '../src/ui.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  for (const h of ['After this, the team will', 'After a room is cleared', 'Address labels']) ok(ui.includes(`HB('${h}'`), 'help: ' + h);
  ok(html.includes('drawAddrTags') && html.includes('showAfterPop') && html.includes('regroupSpot'), 'index.html built with v15');
  ok(html.includes('apple-mobile-web-app-capable') && html.includes('apple-touch-icon'), 'iOS meta tags kept'); }
console.log(`v15: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
