// v9 rules: officer body armor (IIIA soft / rifle plates), blunt-impact injuries, ballistic shield tiers,
// suspect body armor (7%), Draco arm on the BearCat (install + breach), career unlocks, saves.
const Core = require('./load.js')(); const Career = require('../src/career.js'); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const runTurn = () => { Core.execute(); let g = 0; while (!Core.stepTick() && g++ < 50); };
const allStaged = S => S.officers.forEach(o => { o.status = 'staged'; o.stage = 'primary'; o.eta = 0; });
const tally = (n, f) => { const c = {}; for (let i = 0; i < n; i++) { const r = f(); c[r] = (c[r] || 0) + 1; } return c; };
// 1) one data table
{ const A = Core.ARMOR; ok(A.soft.stops.pistol === 1 && A.soft.stops.shotgun === 1 && A.soft.stops.rifle === 0, 'soft IIIA stops pistol + shotgun, not rifle');
  ok(A.plate.stops.rifle >= 0.85 && A.plate.stops.rifle <= 0.9 && A.plate.stops.sniper < A.plate.stops.rifle, 'plates stop 85–90% of rifle, less vs .308');
  const Sh = Core.SHIELDS; ok(Sh.shield.stops.pistol === 1 && Sh.shield.stops.shotgun === 1 && !Sh.shield.stops.rifle, 'IIIA shield: pistol + shotgun only');
  ok(Math.abs(Sh.shield3.stops.rifle - 0.6) < 1e-9 && Sh.shield3.stops.sniper < 0.6, 'Level III shield: ~60% rifle, less vs .308');
  ok(Core.ARMOR_CFG.suspect === 0.07, 'suspect armor chance 7%'); ok(Core.ITEM_CFG.shield3.hands === 1 && !Core.ITEM_CFG.shield3.stow && !Core.ITEM_CFG.shield.stow, 'shields are one-hand, never slung'); }
// 2) officer armor ballistics
{ const S = Core.newGame(4242); allStaged(S); const t = Core.formTeam(S.officers.slice(0, 4).map(o => o.id)).team; const o = Core.off(t.members[1]);
  ok(Core.armorOf(o) === 'soft' && S.units.filter(u => u.kind === 'patrol').every(p => Core.armorOf(p) === 'soft'), 'every officer (SWAT + patrol) wears soft IIIA by default');
  const pis = tally(4000, () => { const r = Core.armorHit(o, null, 'pistol', 6); return r.res + ':' + r.zone; });
  ok(!pis['pen:torso'] && Math.abs(pis['stopped:torso'] / 4000 - Core.ARMOR_CFG.torso) < 0.05 && pis['pen:limb'] > 1000, `pistol on soft: torso never penetrates, uncovered areas still do (${JSON.stringify(pis)})`);
  ok(!pis['blunt:torso'], 'no blunt injury beyond close range');
  const sgC = tally(4000, () => Core.armorHit(o, null, 'shotgun', 1).res), pC = tally(4000, () => Core.armorHit(o, null, 'pistol', 1).res);
  ok(sgC.blunt > pC.blunt * 2 && sgC.blunt > 600, `point blank: shotgun leaves blunt injuries more often than pistol (${sgC.blunt} vs ${pC.blunt})`);
  const rS = tally(4000, () => Core.armorHit(o, null, 'rifle', 6).res); ok(!rS.stopped && !rS.blunt, 'rifle penetrates soft armor');
  o.inv.worn.armor = 'plate'; const rP = tally(4000, () => { const r = Core.armorHit(o, null, 'rifle', 6); return r.zone === 'torso' ? r.res : 'limb'; });
  const stopRate = rP.stopped / (rP.stopped + (rP.pen || 0)); ok(stopRate > 0.84 && stopRate < 0.92, `plates stop ~88% of rifle torso hits (${(100 * stopRate).toFixed(1)}%)`);
  const n0 = S.cas.length, d0 = S.stats.down; let blunt = 0; for (let i = 0; i < 60; i++) { o.status = 'ok'; const r = Core.shotOfficer({ kind: 'patrol', name: o.name, x: 1, y: 1, status: 'ok', inv: o.inv, uid: 'X' }, 'shotgun', 1, undefined, undefined, 'test'); if (r && r.res === 'blunt') blunt++; }
  ok(true, 'shotOfficer runs on a patrol-like unit');
  ok(S.log.some(l => /stopped it/i.test(l.text)), 'stopped round logged ("…stopped it. Unhurt")'); { const bad = S.log.filter(l => /blood|gore/i.test(l.text)); ok(!bad.length, 'neutral wording ' + bad.map(l => l.text).join(' | ')); } }
// 3) shield arc
{ const S = Core.newGame(4242, { gear: { shield3: 1 } }); allStaged(S); const t = Core.formTeam(S.officers.slice(0, 4).map(o => o.id)).team; const pt = Core.off(t.members[0]);
  ok(Core.shieldOf(pt) === 'shield3' && Core.hasShield(t), 'default kit gives the point the Level III shield when issued');
  t.dir = 0; const fr = tally(3000, () => Core.armorHit(pt, t, 'rifle', 8, t.x + 10, t.y).res), bk = tally(3000, () => Core.armorHit(pt, t, 'rifle', 8, t.x - 10, t.y).res);
  ok(fr.shield > 1000 && fr.shield < 1500 && !bk.shield, `Level III shield stops rifle only in the frontal arc (${fr.shield} front / ${bk.shield || 0} rear)`);
  const st = t.members.slice(1).map(Core.off).find(o => !Core.shieldOf(o)), sb = tally(3000, () => Core.armorHit(st, t, 'pistol', 8, t.x + 10, t.y).res); ok(sb.shield > 700 && sb.shield < 1400, `stacked teammate gets a partial shield bonus (${sb.shield}/3000)`);
  const S2 = Core.newGame(4242); allStaged(S2); const t2 = Core.formTeam(S2.officers.slice(0, 4).map(o => o.id)).team, p2 = Core.off(t2.members[0]); t2.dir = 0;
  ok(Core.shieldOf(p2) === 'shield', 'without Level III, point gets the IIIA shield');
  const f2 = tally(3000, () => Core.armorHit(p2, t2, 'rifle', 8, t2.x + 10, t2.y).res); ok(!f2.shield, 'IIIA shield does not stop rifle'); }
// 4) plates: worn slot, individually issued
{ const S = Core.newGame(4242, { gear: { plate: 2 } }); allStaged(S); const t = Core.formTeam(S.officers.slice(0, 4).map(o => o.id)).team; const offs = t.members.map(Core.off);
  ok(offs.every(o => Core.armorOf(o) === 'plate') && S.armory.plate === 2, 'v19: plates unlocked → everyone takes home rifle plates (pool untouched)');
  Core.invAct(offs[1].id, 'return', 'plate'); Core.invAct(offs[3].id, 'return', 'plate'); S.armory.plate = 0;
  const a = Core.teamArmor(t); ok(a.plate === 2 && a.soft === 2, 'team armor badge counts');
  const w = offs.find(o => Core.armorOf(o) === 'plate'), s = offs.find(o => Core.armorOf(o) !== 'plate');
  let r = Core.invAct(w.id, 'return', 'plate'); ok(r.ok && Core.armorOf(w) === 'soft' && S.armory.plate === 1, 'return plate → soft IIIA, back in pool');
  r = Core.invAct(s.id, 'draw', 'plate'); ok(r.ok && Core.armorOf(s) === 'plate' && S.armory.plate === 0, 'draw plate into the worn slot');
  r = Core.invAct(s.id, 'draw', 'plate'); ok(!r.ok, 'cannot draw a second plate'); r = Core.invAct(s.id, 'draw', 'draco'); ok(!r.ok, 'Draco kit cannot be carried'); }
// 5) career unlocks
{ const T60 = Career.teamForLevel(60), T70 = Career.teamForLevel(70), T75 = Career.teamForLevel(75), T100 = Career.teamForLevel(100), T50 = Career.teamForLevel(50);
  ok(!T50.gear.draco && T60.gear.draco === 1, 'Draco kit at level 60'); ok(!(T60.gear.shield3) && T70.gear.shield3 >= 1, 'Level III shield ~70+');
  ok(!(T70.gear.plate) && T75.gear.plate > 0 && T75.gear.plate < 30, `plates unlock ~75 (${T75.gear.plate})`); ok(T100.gear.plate === 30 && T100.staff === 30, 'all 30 officers have plates at level 100'); }
// 6) suspect armor
{ let n = 0, plate = 0, N = 160; for (let s = 1; s <= N; s++) { const S = Core.newGame(s); if (S.suspect.armor !== 'none') { n++; if (S.suspect.armor === 'plate') plate++; } ok(S.suspect.armorKnown === false || S.suspect.seen, 'suspect armor unknown at start (unless already seen at a window)'); }
  ok(n / N > 0.02 && n / N < 0.14, `≈7% of suspects armored (${n}/${N}, ${plate} plate)`); ok(plate <= n / 2, 'mostly soft');
  const A = Core.newGame(77), ja = JSON.stringify(A.rooms) + JSON.stringify(A.doors), aa = A.suspect.armor; const B = Core.newGame(77, { suspectArmor: 1 });
  ok(JSON.stringify(B.rooms) + JSON.stringify(B.doors) === ja && B.suspect.armor !== 'none', 'forcing suspect armor leaves the map identical'); ok(Core.newGame(77).suspect.armor === aa, 'deterministic per seed');
  const S = Core.newGame(77, { suspectArmor: 1 }); S.suspect.armor = 'soft'; S.suspect.atWindow = false;
  const ps = tally(4000, () => Core.suspectArmorStops('pistol')), rs = tally(4000, () => Core.suspectArmorStops('rifle')), ss = tally(4000, () => Core.suspectArmorStops('sniper'));
  ok(ps.true > 2100 && ps.true < 2700 && !rs.true && !ss.true, `soft vest stops pistol torso hits only; rifle / .308 penetrate (${ps.true})`);
  S.suspect.armor = 'plate'; const rp = tally(4000, () => Core.suspectArmorStops('rifle')), sp = tally(4000, () => Core.suspectArmorStops('sniper'));
  ok(rp.true > 1800 && sp.true < rp.true * 0.8, `plates stop most rifle torso hits, fewer .308 (${rp.true} / ${sp.true})`);
  S.suspect.atWindow = true; const wp = tally(4000, () => Core.suspectArmorStops('rifle')); ok(wp.true < rp.true, 'window shots hit uncovered areas more often');
  S.suspect.armor = 'none'; ok(!tally(500, () => Core.suspectArmorStops('pistol')).true, 'unarmored suspect never stops');
  S.suspect.armor = 'soft'; Core.revealSuspectArmor('stop'); ok(S.suspect.armorKnown && S.log.some(l => l.text === 'The round appears to have been stopped by body armor.'), 'stop logs the armor line and reveals it'); }
// 7) Draco arm
{ const S = Core.newGame(4242, { armored: true }); allStaged(S); const t = Core.formTeam(S.officers.slice(0, 3).map(o => o.id)).team; const c = Core.bearcat();
  let r = Core.queueOrder(t.uid, { type: 'dracoInstall', car: c.uid }); ok(!r.ok && /kit/i.test(r.reason), 'install needs a kit in the pool');
  const one = Core.newGame(4242, { armored: true, gear: { draco: 1 } }); allStaged(one); const t1 = Core.formTeam([one.officers[0].id]).team; r = Core.queueOrder(t1.uid, { type: 'dracoInstall', car: Core.bearcat().uid }); ok(!r.ok && /2\+/.test(r.reason), 'install needs a team of 2+'); }
{ const S = Core.newGame(4242, { armored: true, gear: { draco: 1 } }); allStaged(S); const t = Core.formTeam(S.officers.slice(0, 3).map(o => o.id)).team; const c = Core.bearcat();
  const fd = S.doors.find(d => d.name === 'Front Door'); ok(!Core.queueOrder(t.uid, { type: 'draco', door: fd.id }).ok, 'no Draco breach on foot / before install');
  ok(Core.queueOrder(t.uid, { type: 'dracoInstall', car: c.uid }).ok, 'install order accepted'); runTurn(); runTurn(); const p1 = c.dracoProg;
  ok(p1 > 0 && p1 < Core.installTicks() && S.armory.draco === 0 && c.dracoKit, `install in progress (${p1}/${Core.installTicks()} ticks), kit reserved`); ok(t.installing === c.uid, 'installers flagged busy');
  Core.clearOrders(t.uid); Core.queueOrder(t.uid, { type: 'move', x: t.x + 3, y: t.y }); runTurn(); ok(!t.installing && c.dracoProg === p1 && !c.draco && S.log.some(l => /install interrupted/.test(l.text)), 'leaving interrupts; progress kept');
  ok(Core.queueOrder(t.uid, { type: 'dracoInstall', car: c.uid }).ok, 'resume install (kit already on the vehicle)'); for (let i = 0; i < 8 && !c.draco; i++) runTurn();
  ok(c.draco && S.turn >= 5, `Draco installed after ${Core.DRACO_CFG.installTurns}+ turns of work`);
  ok(Core.queueOrder(t.uid, { type: 'board', car: c.uid }).ok, 'board BearCat'); for (let i = 0; i < 3 && !t.inCar; i++) runTurn(); ok(t.inCar === c.uid, 'team inside');
  r = Core.queueOrder(t.uid, { type: 'draco', door: S.doors.find(d => !d.exterior).id }); ok(!r.ok && /exterior/.test(r.reason), 'interior doors rejected');
  const t0 = S.turn; r = Core.queueOrder(t.uid, { type: 'draco', door: fd.id }); ok(r.ok && c.orders[0] && c.orders[0].type === 'draco', 'Draco breach order goes to the vehicle via the occupant');
  for (let i = 0; i < 4 && fd.state === 'closed'; i++) runTurn(); ok(fd.state === 'breached' && fd.frame === 'down', 'door + frame pulled down'); ok(S.turn - t0 <= 3, `door breached in ${S.turn - t0} turn(s) including the drive`);
  ok(Core.dist(c.x, c.y, ...Core.doorMid(fd)) <= Core.DRACO_CFG.reach + 0.01, 'vehicle drove up to the opening'); ok(S.log.some(l => /BREACHED \(Draco arm\)/.test(l.text)), 'breach logged');
  const wi = S.windows.findIndex(w => !w.broken); r = Core.queueOrder(t.uid, { type: 'draco', win: wi }); ok(r.ok, 'window order accepted'); for (let i = 0; i < 4 && !S.windows[wi].cleared; i++) runTurn();
  const w = S.windows[wi]; ok(w.cleared && w.broken, 'window torn out'); const e = w.edges[0]; ok(Core.passE(Core.edge(e[0], e[1], e[2], e[3]), {}) && !Core.passE(Core.edge(e[0], e[1], e[2], e[3]), { drive: true }), 'torn-out window is a walk-through opening');
  ok(c.status === 'ok' && t.status === 'ok', 'crew stays under armor'); }
// 8) storm door: extra pull, still faster than manual
{ let pulls = 0, n = 0, plain = 0, pn = 0; for (let s = 1; s <= 30 && (n < 5 || pn < 5); s++) { const S = Core.newGame(s, { armored: true }); const c = Core.bearcat(); c.draco = true; c.occ = ['T1'];
    for (const fd of S.doors.filter(d => d.exterior && d.state === 'closed')) { const o0 = { type: 'draco', door: fd.id }, sp = Core.dracoSpots(o0)[0]; if (!sp) continue; c.x = sp.x; c.y = sp.y; c.dir = sp.dir; const o = { type: 'draco', door: fd.id, x: c.x, y: c.y }; c.orders = [o]; let k = 0; while (fd.state === 'closed' && k++ < 30) Core.dracoTick(c, o);
      if (fd.storm) { pulls += k - 1; n++; } else { plain += k - 1; pn++; } } }
  ok(n > 0 && pulls / n < 3.5 && pulls / n > plain / pn, `storm doors take extra pulls (${(pulls / n).toFixed(1)} vs ${(plain / pn).toFixed(1)}) but beat manual`);
  ok(pn > 0 && plain / pn < 2, `plain doors: high per-pull success (${(plain / pn).toFixed(2)})`); }
console.log(`v9: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
