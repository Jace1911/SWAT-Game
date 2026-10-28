// v7 rules: no mission timer, no auto-fail (only resolution or a chosen withdrawal ends it), score deductions, indoor line-of-sight reveal.
const Core = require('./load.js')(); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const runTurn = () => { Core.execute(); let g = 0; while (!Core.stepTick() && g++ < 50); };
// 1) no timer: passive play runs far past the old 40-turn limit without ending
{ const S = Core.newGame(4242); for (let i = 0; i < 60 && S.phase !== 'over'; i++) runTurn();
  ok(S.phase !== 'over' || (S.result && S.result.win), `passive play is not ended by a clock (turn ${S.turn}, ${S.phase})`);
  ok(Core.TURN_LIMIT === undefined, 'no TURN_LIMIT exported');
  ok(!Core.missionScore().items.some(i => /time|min/i.test(i.label)), 'score has no time bonus/penalty'); }
// 2) officers down never end the mission; withdraw does, with deductions listed
{ const S = Core.newGame(99); const P = S.units.filter(u => u.kind === 'patrol');
  P.forEach(p => Core.officerDown(p, `${p.name} is hit`)); runTurn();
  ok(S.stats.down >= Core.LOSE_DOWN && S.phase !== 'over', `${S.stats.down} officers down → mission continues`);
  const r = Core.withdraw(); ok(r.ok && S.phase === 'over' && S.result && !S.result.win && S.stats.withdrawn, 'withdraw ends the mission unresolved');
  const M = Core.missionScore(); ok(M.items.some(i => i.pts === Core.SCORE.withdraw), 'withdraw deduction listed');
  ok(M.items.some(i => i.pts < 0 && /officer/i.test(i.label)), 'officer deductions listed'); ok(M.score < 0 && M.grade === 'Board of Inquiry', `heavy losses → negative score (${M.score}, ${M.grade})`);
  const ded = (S.result.debrief || []).filter(d => d.k.trim() === 'Deduction'); ok(ded.length >= 2 && ded.every(d => /−\d+$/.test(d.v)), 'debrief lists deductions');
  ok(!(S.result.debrief || []).some(d => /gore|blood|kill shot/i.test(d.v)), 'neutral wording');
  ok(!Core.withdraw().ok, 'second withdraw refused');
  const sm = Core.careerSummary(); ok(sm.outcome === 'withdrawn' && sm.win === false && Array.isArray(sm.deductions), 'career summary: withdrawn + deductions'); }
// 3) escape → caught after a pursuit with a deduction (not a fail-end)
{ const S = Core.newGame(321); S.stats.escaped = true; S.suspect.mode = 'detained'; S.stats.method = 'Caught after escape (outer units)'; Core.checkEnd();
  ok(S.phase === 'over' && S.result.win, 'detained after escape resolves the mission'); ok(Core.missionScore().items.some(i => i.pts === Core.SCORE.escape), 'escape deduction'); ok(Core.careerSummary().outcome === 'pursuit', 'career outcome pursuit'); }
// 4) forceLeft
{ const S = Core.newGame(5); ok(Core.forceLeft() > 0, 'forces available at start'); S.units.filter(u => u.kind === 'patrol').forEach(p => { p.status = 'down'; }); S.officers.forEach(o => { o.status = 'down'; }); ok(Core.forceLeft() === 0, 'forceLeft 0 when nobody can act'); }
// 5) line-of-sight reveal through doors
let tested = 0;
for (const seed of [11, 23, 57, 101, 314, 777, 2024]) {
  const S = Core.newGame(seed); const D = S.doors.find(d => !d.exterior && d.rooms.length === 2 && d.rooms.every(r => r >= 0) && d.cells.length === 1); if (!D) continue;
  const [[a0, a1], [b0, b1]] = D.cells[0]; const A = Core.roomAt(a0, a1), B = Core.roomAt(b0, b1); if (A < 0 || B < 0 || A === B) continue;
  const P = S.units.find(u => u.kind === 'patrol'); P.inCar = null; S.units.filter(u => u !== P && u.kind !== 'cruiser').forEach(u => { u.x = 0; u.y = 0; });
  S.units.filter(u => u.kind === 'cruiser').forEach(c => { c.occ = []; });
  const place = (x, y, dir) => { P.x = x; P.y = y; P.dir = dir; S.seenCell = null; Core.updateVision(); };
  const dir = Math.atan2(b1 - a1, b0 - a0), inB = () => { let n = 0; for (let c = 0; c < S.seenCell.length; c++) if (S.seenCell[c] && S.room[c] === B) n++; return n; };
  S.rooms[B].explored = false; D.state = 'closed'; place(a0, a1, dir); const closed = inB();
  if (closed > 0) { console.log(`  (seed ${seed}: rooms share an opening — closed-door check skipped)`); continue; }
  D.state = 'open'; S.rooms[B].explored = false; place(a0, a1, dir); const open = inB();
  ok(open > 2, `seed ${seed}: open door reveals cells of the next room (${open})`);
  ok(S.seenCell[Core.idx(b0, b1)] === 1, `seed ${seed}: cell beyond the doorway is seen`);
  // nothing seen through walls: B cells that are not in the line through the doorway stay unseen
  let wallHidden = 0; for (let c = 0; c < S.seenCell.length; c++) if (S.room[c] === B && !S.seenCell[c]) wallHidden++; ok(wallHidden > 0, `seed ${seed}: walls still block part of the room (${wallHidden} unseen)`);
  // unit standing in the doorway (on the far-side door cell) sees more of B
  S.rooms[B].explored = false; place(b0, b1, dir); ok(inB() >= open, `seed ${seed}: unit in the doorway sees at least as much`);
  // mutual sight: suspect in line of sight, officer facing away
  const sp = S.suspect; sp.mode = 'barricaded'; sp.x = b0 + Math.round(Math.cos(dir)); sp.y = b1 + Math.round(Math.sin(dir)); sp.room = Core.roomAt(sp.x, sp.y);
  if (sp.room === B) { D.state = 'open'; place(a0, a1, dir + Math.PI); ok(sp.visible, `seed ${seed}: suspect seeing the officer is seen by him (facing away)`);
    D.state = 'closed'; place(a0, a1, dir + Math.PI); ok(!sp.visible, `seed ${seed}: closed door blocks mutual sight`); }
  tested++;
}
ok(tested >= 3, `LOS reveal tested on ${tested} seeds`);
console.log(`V7: ${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1;
