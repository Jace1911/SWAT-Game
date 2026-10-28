// v9 devices: taser + 40mm less-lethal orders on the suspect, auto-transition of hands, patrol injury rate.
const Core = require('./load.js')(); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const runTurn = () => { Core.execute(); let g = 0; while (!Core.stepTick() && g++ < 50); };
const allStaged = S => S.officers.forEach(o => { o.status = 'staged'; o.stage = 'primary'; o.eta = 0; });
// place unit u at a free cell d cells from the suspect with a clear line
function near(S, u, want) { const sp = S.suspect, c = [];
  for (let y = Math.max(0, sp.y - want - 1); y <= Math.min(Core.MAP_H - 1, sp.y + want + 1); y++) for (let x = Math.max(0, sp.x - want - 1); x <= Math.min(Core.MAP_W - 1, sp.x + want + 1); x++) { if (x === sp.x && y === sp.y || S.block[Core.idx(x, y)]) continue; const d = Core.dist(x, y, sp.x, sp.y);
    if (Math.abs(d - want) > 0.6 || Core.los(x, y, sp.x, sp.y) !== 1) continue; c.push([x, y, Math.abs(d - want)]); }
  c.sort((a, b) => a[2] - b[2]); for (const [x, y] of c) { u.x = x; u.y = y; Core.updateVision(); if (S.suspect.visible) return true; } return false; }
function setup(seed, n, opt) { const S = Core.newGame(seed, opt || {}); allStaged(S); const t = Core.formTeam(S.officers.slice(0, n || 4).map(o => o.id)).team; t.deployed = true; return { S, t }; }
// 1) patrol officer down at start ~5%
{ ok(Core.SCENE_CFG.injury <= 0.06, 'patrol-down chance is a tunable ~5% constant'); let n = 0; for (let s = 1; s <= 200; s++) { const S = Core.newGame(s); if (S.scene.injury) n++; }
  ok(n >= 2 && n <= 22, `officer down before SWAT in ${n}/200 missions`); }
// 2) taser
{ let seed = 0, S, t; for (seed = 11; seed < 60; seed++) { ({ S, t } = setup(seed, 4)); if (near(S, t, 2)) break; }
  const m0 = Core.teamOk(t).slice(), before = m0.map(o => Core.invOf(o).hands.join('+'));
  let r = Core.queueOrder(t.uid, { type: 'taser' }); ok(r.ok, 'taser order accepted at ~2 m with a clear line ' + (r.reason || ''));
  const who = Core.deviceUser(t, 'taser'); ok(who && Core.invOf(who).holster.includes('taser'), 'a member with a free(able) hand and a holstered taser does it');
  const ch = S.rng.chance; S.rng.chance = () => true; runTurn(); S.rng.chance = ch;
  ok(S.suspect.stun > 0 && S.suspect.stunBy === 'taser', 'taser hit incapacitates the suspect for a while');
  ok(S.log.some(l => /probes connected/.test(l.text)), 'taser logged');
  ok(Core.invOf(who).holster.includes('taser') && !Core.invOf(who).hands.includes('taser'), 'taser re-holstered after use');
  const prim = m0.map(o => Core.invOf(o).hands.join('+')); ok(prim.join() === before.join(), 'previous weapons redrawn automatically');
  ok(S.log.some(l => /put away for the taser/.test(l.text)) && Core.invOf(who).hands.filter(Boolean).some(k => !Core.isReady(who, k)), 'auto-holster logged; redrawn weapon NOT READY');
  ok(!/blood|gore/i.test(S.log.map(l => l.text).join(' ')), 'neutral wording'); }
{ let S, t; for (let seed = 11; seed < 60; seed++) { ({ S, t } = setup(seed, 4)); if (near(S, t, 7)) break; }
  const r = Core.queueOrder(t.uid, { type: 'taser' }); ok(!r.ok && /range/i.test(r.reason), 'taser out of range at 7 m: ' + r.reason);
  S.suspect.visible = false; S.suspect.lastKnown = null; const r2 = Core.queueOrder(t.uid, { type: 'taser' }); ok(!r2.ok && /not in view/i.test(r2.reason), 'needs the suspect in view'); }
{ const { S } = setup(5, 4); const near1 = Core.deviceChance({}, 'taser', 1), far = Core.deviceChance({}, 'taser', 3); S.suspect.armor = 'soft'; const arm = Core.deviceChance({}, 'taser', 1);
  ok(near1 > far && arm < near1 && near1 < 0.95, `taser odds by range/armor (${near1.toFixed(2)} / ${far.toFixed(2)} / armored ${arm.toFixed(2)})`); }
{ let fails = 0, n = 0; for (let seed = 11; seed < 90 && n < 25; seed++) { const { S, t } = setup(seed, 4); if (!near(S, t, 3)) continue; S.suspect.armor = 'none';
    if (!Core.queueOrder(t.uid, { type: 'taser' }).ok) continue; n++; runTurn(); if (!(S.suspect.stun > 0 && S.suspect.stunBy === 'taser')) fails++; }
  ok(n >= 10 && fails > 0 && fails < n, `taser can fail (${fails}/${n} at 3 m)`); }
// 3) less-lethal launcher
{ let S, t; for (let seed = 11; seed < 60; seed++) { ({ S, t } = setup(seed, 5)); if (near(S, t, 6) && Core.teamOk(t).some(o => (o.quals || []).includes('ll'))) break; }
  const llo = Core.teamOk(t).find(o => (o.quals || []).includes('ll')); const inv = Core.invOf(llo);
  if (!inv.slung.includes('lesslethal') && !inv.hands.includes('lesslethal')) { inv.slung.push('lesslethal'); inv.ll = 3; S.armory.lesslethal = Math.max(0, (S.armory.lesslethal || 0) - 1); }
  inv.hands = ['rifle', 'rifle']; inv.slung = inv.slung.filter(k => k !== 'rifle' && k !== 'lesslethal').concat(['lesslethal']); if (!(inv.ll > 0)) inv.ll = 3; // a rifleman with the launcher slung (no shield)
  const r0 = inv.ll; let r = Core.queueOrder(t.uid, { type: 'llfire' }); ok(r.ok, 'less-lethal order accepted at 6 m ' + (r.reason || ''));
  const ch = S.rng.chance; S.rng.chance = () => true; S.rng.chance = (p) => p !== Core.LL_CFG.noEffect; runTurn(); S.rng.chance = ch;
  ok(S.suspect.stun > 0 && S.suspect.stunBy === 'll' && inv.ll === r0 - 1, 'hit incapacitates, one round used');
  ok(inv.slung.includes('lesslethal') && inv.hands.includes('rifle'), 'launcher slung again, rifle redrawn');
  ok(S.log.some(l => /put away for the 40mm launcher/.test(l.text)), 'auto-sling logged');
  if (S.phase !== 'planning') console.log('  (phase after LL turn: ' + S.phase + ')'); S.phase = 'planning'; S.result = null; S.suspect.mode = 'barricaded'; S.suspect.custody = false; inv.ll = 0; Core.syncAll && Core.syncAll(); S.suspect.stun = 0; S.suspect.visible = true; r = Core.queueOrder(t.uid, { type: 'llfire' }); ok(!r.ok && /out of rounds/.test(r.reason), 'out of rounds: ' + r.reason);
  inv.ll = 2; inv.hands = ['shield3', 'pistol']; inv.slung = inv.slung.filter(k => k !== 'rifle'); r = Core.queueOrder(t.uid, { type: 'llfire' }); ok(!r.ok && /BOTH hands/.test(r.reason), 'shield holder cannot use the two-handed launcher: ' + r.reason);
  r = Core.queueOrder(t.uid, { type: 'taser' }); ok(r.ok, 'but a taser works next to a shield (one hand)'); }
{ const { S, t } = setup(7, 4); Core.teamOk(t).forEach(o => { const i = Core.invOf(o); i.slung = i.slung.filter(k => k !== 'lesslethal'); if (i.hands.includes('lesslethal')) i.hands = ['rifle', 'rifle']; }); near(S, t, 5);
  const r = Core.queueOrder(t.uid, { type: 'llfire' }); ok(!r.ok && /No 40mm/.test(r.reason), 'no launcher on team: ' + r.reason); }
{ const d1 = Core.deviceChance({}, 'llfire', 3), d2 = Core.deviceChance({}, 'llfire', 10); ok(d1 > d2 && d2 >= Core.LL_CFG.min, `40mm odds fall with range (${d1.toFixed(2)} → ${d2.toFixed(2)})`); }
// 4) patrol officer taser; order clears at end of turn if no clear line
{ let S, p; for (let seed = 11; seed < 80; seed++) { S = Core.newGame(seed); p = S.units.find(u => u.kind === 'patrol' && !u.inCar && u.status !== 'down'); if (p && near(S, p, 2)) break; }
  const r = Core.queueOrder(p.uid, { type: 'taser' }); ok(r.ok, 'patrol officer can order the taser ' + (r.reason || ''));
  ok(!Core.queueOrder(p.uid, { type: 'llfire' }).ok, 'patrol has no launcher');
  Core.clearOrders(p.uid); Core.queueOrder(p.uid, { type: 'taser' }); S.suspect.x = S.suspect.x; p.x = S.ext.staging.x; p.y = S.ext.staging.y; runTurn();
  ok(!p.orders.some(o => o.type === 'taser'), 'device order cleared at end of turn when there is no clear line'); }
console.log(`v9b: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
