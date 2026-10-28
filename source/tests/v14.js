// v14: patrol start positions (off the lot, ≥10 m, behind cover, unseen from inside), downed-officer yards,
// lot layout (corner side street / alley), vehicle cover rule (lean within 2 m, otherwise vehicles block sight and fire).
const Core = require('./load.js')(); let pass = 0, fail = 0; const fs = require('fs'), path = require('path');
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const W = Core.MAP_W, I = (x, y) => y * W + x;
const N = +process.argv[2] || 90;
// ---- sweep (patrol starts, lots, cruisers)
let corner = 0, alley = 0, sideAdj = 0, noRoad = 0, nonCorner = 0, cOcc = 0, cOccSeen = 0, nOk = 0, nBad = 0, kinds = {}, bad = [];
for (let s = 1; s <= N; s++) { const S = Core.newGame(s * 31 + 7), G = S.geo, T = G.target;
  if (G.alley) alley++;
  const rows = []; for (let y = T.y0; y <= T.y1; y += 3) rows.push(y);
  const roadIn = (x0, x1) => rows.some(y => { for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) if (S.paved[I(x, y)] === 1) return true; return false; });
  if (G.side) { corner++; const sd = G.side; const adj = sd.side === 'left' ? T.x0 - sd.x1 >= 1 && T.x0 - sd.x1 <= 3 : sd.x0 - T.x1 >= 1 && sd.x0 - T.x1 <= 3;
    if (adj && roadIn(sd.x0, sd.x1) && !roadIn(sd.side === 'left' ? T.x1 + 1 : T.x0 - 8, sd.side === 'left' ? T.x1 + 8 : T.x0 - 1)) sideAdj++; else bad.push(`corner ${s} ${JSON.stringify(sd)}`); }
  else { nonCorner++; if (!roadIn(T.x0 - 8, T.x1 + 8)) noRoad++; else bad.push('road beside non-corner lot ' + s); }
  for (const u of S.units.filter(u => u.kind === 'patrol')) {
    if (u.inCar) { const c = S.units.find(v => v.uid === u.inCar); cOcc++; if (c && Core.suspSees(c.x, c.y)) cOccSeen++; ok(!Core.onProperty(c.x, c.y), 'cruiser off the lot ' + s); continue; }
    if (u.status !== 'ok') { ok(Core.onProperty(u.x, u.y), `downed officer on the property ${s} ${u.name}`); continue; }
    const k = Core.patrolCoverKind(u.x, u.y); kinds[k] = (kinds[k] || 0) + 1;
    if (Core.patrolStartOk(u.x, u.y) && Core.shieldAt(u.x, u.y).q !== 'open') nOk++; else { nBad++; bad.push(`patrol ${s} ${u.name} ${u.x},${u.y} kind=${k} hd=${Core.houseRectDist(u.x, u.y).toFixed(1)} sees=${Core.suspSees(u.x, u.y)} lot=${Core.onProperty(u.x, u.y)}`); } }
  const v = S.scene.variant; ok(['good', 'gap', 'front'].includes(v), 'variant known ' + v);
  if (v === 'gap') ok(S.scene.gap0.length > 0, 'gap variant has a gap ' + s); if (v === 'good') ok(S.scene.gap0.length === 0, 'good variant has no gap ' + s); }
console.log(`  ${N} maps: corner ${corner}, alley ${alley}, on-foot patrol ok ${nOk}/${nOk + nBad} kinds ${JSON.stringify(kinds)}, occupied cruisers seen ${cOccSeen}/${cOcc}`); bad.slice(0, 8).forEach(b => console.log('   ', b));
ok(nBad === 0 && nOk >= N, 'every uninjured on-foot patrol officer: off the lot, ≥10 m, behind cover, not visible from inside');
ok(Object.keys(kinds).every(k => k === 'street' || k === 'side'), 'cover kinds are street-behind-car or side/rear cover');
ok(corner / N > 0.04 && corner / N < 0.24, `corner lots ${(corner / N * 100).toFixed(0)}% ≈ ${Core.GEO_CFG.corner * 100}%`);
ok(alley / N > 0.1 && alley / N < 0.32, `alleys ${(alley / N * 100).toFixed(0)}% ≈ ${Core.GEO_CFG.alley * 100}%`);
ok(sideAdj === corner, `corner lots: paved side street right beside the lot on one side only (${sideAdj}/${corner})`);
ok(noRoad === nonCorner, `no road between the suspect house and its neighbours otherwise (${noRoad}/${nonCorner})`);
ok(cOccSeen <= Math.ceil(cOcc * 0.05), `occupied roadblock cruisers out of his sight (${cOcc - cOccSeen}/${cOcc})`);
// ---- downed officers: 90% front yard
{ const C = Core.SCENE_CFG, inj0 = C.injury; C.injury = 1; let n = 0, front = 0, onLot = 0;
  for (let s = 1; s <= 70; s++) { const S = Core.newGame(s * 53 + 3); const J = S.scene.injury; if (!J) continue; n++; if (J.yard === 'front') front++;
    const u = S.units.find(q => q.name === J.name || q.uid === J.uid) || S.units.find(q => q.kind === 'patrol' && q.status !== 'ok'); if (u && Core.onProperty(u.x, u.y)) onLot++;
    if (J.yard === 'front' && u) ok(u.y > S.house.y1, 'front-yard officer is in front of the house ' + s); }
  C.injury = inj0; console.log(`  downed officers: ${n}, front yard ${front}, on the lot ${onLot}`);
  ok(n >= 60 && front / n >= 0.8 && front / n <= 0.98, `downed officer front-yard share ${(front / n * 100).toFixed(0)}% ≈ 90%`); ok(onLot === n, 'downed officers are on the property'); }
// ---- vehicle cover rule
{ let near = 0, far = 0, farBlocked = 0, back = 0, backBlocked = 0, crz = 0, crzOk = 0;
  for (let s = 1; s <= 12; s++) { const S = Core.newGame(s * 7 + 2); const cars = (S.world.cars || []).concat([S.world.van]);
    for (const q of cars) { if (!q) continue; const cy = q.y + (q.h >> 1);
      for (const dir of [-1, 1]) { const ax = dir < 0 ? q.x - 1 : q.x + q.w, bx = dir < 0 ? q.x + q.w + 3 : q.x - 4, fx = ax + dir * 4;
        if (![ax, bx, fx].every(x => x >= 0 && x < W)) continue; if ([ax, bx, fx].some(x => S.opaque[I(x, cy)] || Core.vehId(I(x, cy)))) continue;
        if (!Core.los(ax, cy, bx, cy)) continue; near++;            // right behind the car: leans out and sees/shoots past it
        if (!Core.los(fx, cy, ax, cy)) continue; far++; if (!Core.los(fx, cy, bx, cy)) farBlocked++; // 4 m back: blocked by the body
        back++; if (!Core.los(bx, cy, fx, cy)) backBlocked++; } } // reverse: the other side is >2 m away too, so blocked both ways
    for (const c of S.units.filter(u => u.kind === 'cruiser')) { for (let d = 5; d <= 9; d++) { const x = c.x, y = c.y + d; if (y >= Core.MAP_H || S.opaque[I(x, y)]) break; if (Core.vehId(I(x, y))) continue; crz++; if (Core.los(x, y, c.x, c.y)) crzOk++; break; } } }
  console.log(`  vehicle LOS: near-lean ${near}, far ${far} blocked ${farBlocked}, reverse blocked ${backBlocked}/${back}, cruiser targets ${crzOk}/${crz}`);
  ok(near >= 20, 'found lean-out cases'); ok(far >= 10 && farBlocked === far, 'farther than 2 m from a vehicle: cannot see or fire through it');
  ok(backBlocked === back, 'rule applies in both directions (suspect shots from >2 m blocked too)');
  ok(Core.VEH_CFG.lean === 2, 'lean distance 2 m'); ok(crz < 3 || crzOk >= crz * 0.7, 'the vehicle itself can still be targeted'); }
// suspect fire uses the same los: a suspect window eye >2 m from a car cannot see an officer behind it
{ let n = 0, blocked = 0; for (let s = 1; s <= 10; s++) { const S = Core.newGame(s * 11 + 5); const eyes = Core.suspEyePts();
    for (const q of S.world.cars || []) { const x = q.x + (q.w >> 1), y = q.y + q.h + 1; if (y >= Core.MAP_H || S.opaque[I(x, y)] || Core.vehId(I(x, y))) continue;
      for (const e of eyes) { if (Core.vehDist(e.x, e.y) <= 2) continue; const L = Core.losEx(e.x, e.y, x, y, false); if (L.veh) { n++; blocked++; } else if (!L.v) continue; else n++; } } }
  ok(n > 0 && blocked > 0, `suspect sight lines blocked by vehicles (${blocked}/${n})`); }
// ---- determinism + house layouts unchanged
{ const a = Core.newGame(4242), sa = JSON.stringify([a.geo.side, a.geo.alley, a.units.map(u => [u.uid, u.x, u.y, u.status])]); const b = Core.newGame(4242); ok(sa === JSON.stringify([b.geo.side, b.geo.alley, b.units.map(u => [u.uid, u.x, u.y, u.status])]), 'deterministic per seed'); }
// ---- help
{ const ui = fs.readFileSync(path.join(__dirname, '../src/ui.js'), 'utf8'); ok(/Patrol start positions/.test(ui) && /Vehicle cover/.test(ui) && /corner lot/.test(ui) && /alley/.test(ui), 'help covers patrol starts, vehicle cover, corner lots, alleys'); }
{ const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'); ok(html.includes('apple-touch-icon') && html.includes('apple-mobile-web-app-capable') && html.includes('function vehNear'), 'index.html built with v14 and iOS tags'); }
console.log(`v14: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
