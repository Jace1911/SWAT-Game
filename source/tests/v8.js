// v8 rules: move anywhere + exposure flags, suspect fire rates, vehicles via occupants, team order (point/defense),
// two staging areas, per-officer inventories (hands, holster, sling, pack, vest, not-ready), saves.
const Core = require('./load.js')(); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const runTurn = () => { Core.execute(); let g = 0; while (!Core.stepTick() && g++ < 50); };
const allStaged = S => S.officers.forEach(o => { o.status = 'staged'; o.stage = 'primary'; o.eta = 0; });
// 1) fire config tunables
{ ok(Math.abs(Core.FIRE_CFG.outside - 0.4) < 1e-9 && Math.abs(Core.FIRE_CFG.indoor - 0.8) < 1e-9, 'fire rates 40% outside / 80% indoor');
  const S = Core.newGame(5); const f0 = Core.fireImpair(); S.suspect.daze = 5; const f1 = Core.fireImpair(); S.suspect.daze = 0; S.suspect.impair = 1; const f2 = Core.fireImpair(); S.suspect.impair = 0;
  ok(f0 === 1 && f1 < 0.6 && f2 < 0.5, `flashbang / gas cut his fire chance (${f1.toFixed(2)}, ${f2.toFixed(2)})`); }
// 2) move anywhere: no snapping, exposed flagged before execute
{ let found = false; for (let seed = 1; seed < 30 && !found; seed++) { const S = Core.newGame(seed); const p = S.units.find(u => u.kind === 'patrol' && u.status === 'ok' && !u.inCar); if (!p) continue;
    const fd = S.doors.find(d => d.name === 'Front Door'); if (!fd) continue; const [mx, my] = Core.doorMid(fd); let tx = -1, ty = -1;
    for (let r = 2; r <= 6 && tx < 0; r++) for (let dx = -r; dx <= r && tx < 0; dx++) for (const dy of [-r, r]) { const x = Math.round(mx + dx), y = Math.round(my + dy), ci = Core.coverInfo(x, y); if (Core.roomAt(x, y) < 0 && ci.level === 'open' && ci.expo >= Core.COVER_CFG.exposedAt) { tx = x; ty = y; break; } }
    if (tx < 0) continue;
    const r = Core.queueOrder(p.uid, { type: 'move', x: tx, y: ty }); if (!r.ok) continue; found = true;
    ok(r.at[0] === tx && r.at[1] === ty && !r.snapped, `move goes exactly where ordered (${r.at} vs ${tx},${ty})`);
    ok(r.exposed && Core.exposedOrders().some(e => e.uid === p.uid), 'open front-yard spot is flagged EXPOSED before execute'); } ok(found, 'ran exposed move test'); }
// 3) staging areas: two areas, ~70/30 split, leader always primary
{ let sec = 0, n = 0, leadOk = true; for (let seed = 1; seed <= 40; seed++) { const S = Core.newGame(seed); ok(S.ext.staging2 && Math.abs(S.ext.staging2.x - S.ext.staging.x) > 25, 'secondary staging at the other end of the street');
    for (const o of S.officers) { if (o.spec === 'leader') { if (o.stage !== 'primary') leadOk = false; continue; } n++; if (o.stage === 'secondary') sec++; } }
  ok(sec / n > 0.2 && sec / n < 0.4, `≈30% arrive at secondary (${(100 * sec / n).toFixed(0)}%)`); ok(leadOk, 'leader always arrives at primary'); }
{ const S = Core.newGame(4242); S.officers.forEach(o => { o.status = 'staged'; o.eta = 0; });
  const p = S.officers.filter(o => o.stage === 'primary'), s = S.officers.filter(o => o.stage === 'secondary');
  if (p.length && s.length) { ok(!Core.formTeam([p[0].id, s[0].id]).ok, 'cannot mix officers from different staging areas');
    const r = Core.formTeam(s.slice(0, 3).map(o => o.id)); ok(r.ok && Core.dist(r.team.x, r.team.y, S.ext.staging2.x, S.ext.staging2.y) < 4, 'secondary team forms at secondary staging');
    ok(!Object.values(r.team.equip).some(v => v > 0), 'secondary team has personal weapons only'); ok(Core.weaponOf(r.team), 'secondary team still armed');
    const dr = Core.invAct(s[0].id, 'draw', 'shield'); ok(!dr.ok && /equipment vehicle/.test(dr.reason), 'gear drawn only at the equipment vehicle');
    const q = Core.queueOrder(r.team.uid, { type: 'move', x: S.ext.staging2.x + 3, y: S.ext.staging2.y }); ok(q.ok, 'secondary team can move'); } else ok(false, 'seed has both stages'); }
// 4) team forming: point / defense / order
{ const S = Core.newGame(31); allStaged(S); const ids = S.officers.slice(0, 5).map(o => o.id);
  const r = Core.formTeam(ids, { point: ids[3], defense: ids[1] }); ok(r.ok && r.team.members[0] === ids[3] && r.team.members[1] === ids[1], 'point leads, defense second');
  const t = r.team, rev = t.members.slice().reverse(); ok(Core.setTeamOrder(t.uid, rev).ok && t.members[0] === rev[0], 'setTeamOrder reorders the stack');
  ok(!Core.setTeamOrder(t.uid, rev.slice(1)).ok, 'setTeamOrder needs the full member list');
  const f = Core.formationFor(t); ok(f.pts.length === t.members.length, 'formation has one dot per member'); }
// 5) inventory: hands, shield, not-ready, one-handed rifle
{ const S = Core.newGame(4242); allStaged(S); const r = Core.formTeam(S.officers.slice(0, 5).map(o => o.id)); const t = r.team;
  const offs = t.members.map(id => Core.off(id)), pt = offs[0], v = Core.invView(pt);
  ok(offs.every(o => { const w = Core.invView(o); return w.hands.length === 2; }), 'every officer has two hands');
  ok(offs.every(o => { const w = Core.invView(o); return (w.holster.includes('pistol') || w.hands.includes('pistol')) && (w.holster.includes('taser') || w.hands.includes('taser')); }), 'everyone carries a handgun and a taser');
  ok(v.hands.includes('shield') && v.hands.includes('pistol'), 'point holds shield + pistol');
  const ns = Core.invAct(pt.id, 'stow', 'shield'); ok(!ns.ok && /cannot be slung/.test(ns.reason), 'shield cannot be slung/packed');
  const rf = offs.find(o => Core.invView(o).two && Core.invView(o).hands[0] === 'rifle');
  const s1 = Core.invAct(rf.id, 'switch', 'pistol'); ok(s1.ok && Core.invView(rf).hands.includes('pistol'), 'switch to pistol costs no order');
  ok(!Core.isReady(rf, 'pistol') && Core.invView(rf).notReady.includes('pistol'), 'switched weapon is NOT READY (shown in loadout view)');
  const lone = Core.newGame(77); allStaged(lone); const two = lone.officers.filter(o => o.spec !== 'marksman' && o.spec !== 'leader').slice(0, 2).map(o => o.id);
  const L = Core.formTeam(two).team, [la, lb] = L.members.map(Core.off);
  ok(Core.weaponOf(L), 'pair armed'); Core.invAct(la.id, 'stow', 'pistol'); Core.invAct(lb.id, 'switch', 'pistol');
  ok(!Core.isReady(la, 'pistol') && !Core.isReady(lb, 'pistol') && !Core.isReady(lb, 'rifle'), 'holstered / switched weapons not ready');
  ok(!Core.weaponOf(L), 'no ready weapon during the not-ready turn → no return fire / attacks');
  runTurn(); ok(Core.weaponOf(L) === 'pistol' && Core.isReady(lb, 'pistol'), 'weapon ready again after one full turn');
  const s2 = Core.invAct(lb.id, 'switch', 'rifle'); ok(s2.ok && Core.invView(lb).hands.includes('rifle'), 'switch back to the rifle');
  const g = Core.invAct(lb.id, 'grip', 'rifle'); ok(g.ok && !Core.invView(lb).two && Core.invView(lb).hands.includes('rifle'), 'rifle held one-handed');
  const tw = Core.teamWeapon(L); ok(!tw || tw.k !== 'rifle' || tw.oh, 'one-handed rifle flagged (worse accuracy)'); }
// 6) breach / throw hands
{ const S = Core.newGame(4242); allStaged(S); const t = Core.formTeam(S.officers.slice(0, 5).map(o => o.id)).team;
  const rm = t.members.map(Core.off).find(o => Core.invView(o).hands.includes('ram')); ok(rm && Core.invView(rm).hands.includes('pistol'), 'ram carried one-handed beside the pistol');
  ok(Core.breachCan(t, 'ram') === true, 'ram breach possible (pistol can be auto-holstered)');
  const iv = Core.invOf(rm); iv.hands = ['ram', 'shield']; ok(Core.breachCan(t, 'ram') !== true, 'ram breach refused when the other hand holds a shield'); iv.hands = ['ram', 'pistol']; iv.holster = iv.holster.filter(k => k !== 'pistol'); }
{ let done = false; for (let seed = 1; seed < 40 && !done; seed++) { const S = Core.newGame(seed); allStaged(S);
    const t = Core.formTeam(S.officers.filter(o => o.spec !== 'marksman').slice(0, 4).map(o => o.id)).team; t.deployed = true; const d = S.doors.find(x => x.name === 'Front Door');
    const rm = t.members.map(Core.off).find(o => Core.invView(o).hands.includes('ram')); if (!rm) continue;
    if (!Core.queueOrder(t.uid, { type: 'breach', door: d.id, method: 'ram' }).ok) continue; let sawGrip = false;
    for (let k = 0; k < 60 && S.phase !== 'over'; k++) { if (S.phase === 'planning') Core.execute(); Core.stepTick(); if (t.ramGrip) { sawGrip = true; ok(Core.invView(rm).two && !Core.invView(rm).hands.includes('pistol'), 'both hands on the ram, pistol holstered'); break; } if (d.state !== 'closed') break; }
    if (!sawGrip) continue; done = true;
    ok(S.log.some(l => /holster/i.test(l.text)), 'ram breach auto-holsters the pistol (logged)');
    for (let k = 0; k < 40 && d.state === 'closed' && S.phase !== 'over'; k++) { if (S.phase === 'planning') Core.execute(); Core.stepTick(); }
    for (let k = 0; k < 10 && t.ramGrip && S.phase !== 'over'; k++) { if (S.phase === 'planning') Core.execute(); Core.stepTick(); }
    if (d.state === 'breached') ok(!t.ramGrip && Core.invView(rm).hands.includes('pistol'), 'pistol auto-redrawn after the breach'); }
  ok(done, 'ran a ram breach'); }
{ const S = Core.newGame(4242); allStaged(S); const t = Core.formTeam(S.officers.slice(0, 5).map(o => o.id)).team; t.deployed = true;
  ok(Core.ITEM_CFG.bang.throwHands === 2 && Core.ITEM_CFG.gas.throwHands === 2, 'flashbang and CS throws need both hands');
  ok(Core.ITEM_CFG.medkit.useHands === 2 && Core.ITEM_CFG.charge.where === 'vest' && Core.ITEM_CFG.charge.needFree === 1, 'medkit two hands; charges on the vest need a free hand');
  ok(Core.ITEM_CFG.shield.stow === null && Core.ITEM_CFG.shield.hands === 1 && Core.ITEM_CFG.ram.hands === 1 && Core.ITEM_CFG.ram.useHands === 2, 'shield one hand unslingable; ram 1 hand carried, 2 to use');
  ok(Core.INV_CFG.notReadyTurns === 1, 'not-ready lasts one turn'); }
// 7) 40mm: qualification + limited rounds
{ const S = Core.newGame(4242, Object.assign({}, require('./load.js').career ? {} : {})); allStaged(S);
  ok(S.officers.filter(o => o.spec === 'marksman').every(o => o.quals.includes('ll')), 'marksmen are Less-Lethal Specialists');
  const nq = S.officers.find(o => !o.quals.includes('ll') && o.spec !== 'marksman'); const T = Core.formTeam([nq.id]).team;
  const d1 = Core.invAct(nq.id, 'draw', 'lesslethal'); const h1 = d1.ok ? Core.invAct(nq.id, 'hold', 'lesslethal') : d1; ok(!h1.ok, 'non-specialist cannot use the 40mm');
  ok(S.llRounds >= 1 && S.llRounds <= 8, `limited 40mm rounds (${S.llRounds})`); }
// 8) vehicles through occupants
{ const S = Core.newGame(77, { armored: true }); const bc = S.units.find(u => u.kind === 'cruiser' && u.armored); ok(bc && Core.carSeats(bc) === 10, 'BearCat has 10 seats');
  const cr = S.units.find(u => u.kind === 'cruiser' && !u.armored); ok(cr && Core.carSeats(cr) === 2, 'cruiser has 2 seats');
  if (cr) { for (const id of cr.occ.slice()) { const pu = Core.unit(id); if (pu) pu.inCar = null; } cr.occ = []; const r = Core.queueOrder(cr.uid, { type: 'move', x: cr.x + 3, y: cr.y }); ok(!r.ok, 'empty vehicle cannot be ordered (static cover)'); } }
console.log(`V8: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
