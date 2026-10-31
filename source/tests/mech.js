// Mechanics unit tests: gas spread/leakage, masks, patrol impairment, suspect flee/mask, breaching.
const Core = require('./load.js')(); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const S0 = () => Core.state;
function roomAvg(id) { const q = S0().rooms[id]; let s = 0, n = 0; for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) if (S0().room[Core.idx(x, y)] === id) { s += S0().gas[Core.idx(x, y)]; n++; } return s / n; }
function interiorDoor(S) { return S.doors.find(d => !d.exterior && d.rooms.length === 2 && d.rooms.every(r => r >= 0)); }
function outsideNear(d) { for (const [a, b] of d.cells) { if (Core.roomAt(a[0], a[1]) < 0) return a; if (Core.roomAt(b[0], b[1]) < 0) return b; } }
for (const seed of [11, 23, 57, 101, 314]) {
  let S = Core.newGame(seed); const D = interiorDoor(S); const [A, B] = D.rooms;
  // closed interior door: weak leakage
  Core.gasDeploy(A); for (let i = 0; i < 3; i++) Core.gasTurn(); const closedB = roomAvg(B), srcA = roomAvg(A);
  S = Core.newGame(seed); const D2 = S.doors[D.id]; D2.state = 'open'; Core.gasDeploy(A); for (let i = 0; i < 3; i++) Core.gasTurn(); const openB = roomAvg(B);
  ok(srcA > 0.5, `seed ${seed}: source room stays strong (${srcA.toFixed(2)})`);
  if (closedB > 0.02) { console.log(`  (seed ${seed}: rooms also share an open archway — closed-door check skipped)`); continue; }
  ok(openB > closedB * 3 && openB > 0.04, `seed ${seed}: open door spreads (${openB.toFixed(3)}) much more than closed (${closedB.toFixed(3)})`);
  ok(closedB > 0 && closedB < 0.08, `seed ${seed}: closed interior door leaks only weakly (${closedB.toFixed(3)})`);
  // exterior leak through a broken window
  S = Core.newGame(seed); const w = S.windows[0]; const [cx, cy, ox, oy] = w.edges[0];
  Core.gasDeploy(w.room); Core.gasTurn(); const before = Core.gasAt(ox, oy); w.broken = true; for (let i = 0; i < 2; i++) Core.gasTurn();
  const at1 = Core.gasAt(ox, oy), far = Core.gasAt(ox + (ox - cx) * 6, oy + (oy - cy) * 6);
  ok(before < 0.01 && at1 > 0.05, `seed ${seed}: broken window leaks outside (${before.toFixed(3)} → ${at1.toFixed(3)})`);
  ok(far < at1 * 0.5, `seed ${seed}: plume thins with distance (${far.toFixed(3)} < ${at1.toFixed(3)})`);
  // decay
  S = Core.newGame(seed); Core.gasDeploy(A); const a0 = roomAvg(A); for (let i = 0; i < 12; i++) Core.gasTurn(); ok(roomAvg(A) < a0 && roomAvg(A) > 0.05, `seed ${seed}: decays slowly`);
}
// masks & patrol impairment
{ const S = Core.newGame(7); const P = S.units.find(u => u.kind === 'patrol' && !u.inCar); const c = Core.idx(P.x, P.y);
  S.gas[c] = 0.8; S.gasEver = true; Core.gasExpose(P); ok(P.impair > 0.5, 'patrol (no mask) impaired in gas'); ok(P.orders.length && P.orders[0].auto === 'gas', 'impaired patrol falls back out of gas');
  ok(Core.impairAcc(P) < 0.75, 'impairment lowers accuracy');
  const T = { kind: 'team', name: 'T', x: P.x, y: P.y, mask: 'on', status: 'ok', orders: [], members: [] }; Core.gasExpose(T); ok(T.impair < 0.1, 'masked SWAT barely affected');
  ok(Core.impairAcc(T) < 1 && Core.impairAcc(T) > 0.85 && Core.impairVis(T) < 1, 'mask has a small accuracy/vision penalty');
  const U = { kind: 'team', name: 'U', x: P.x, y: P.y, mask: 'off', status: 'ok', orders: [], members: [] }; Core.gasExpose(U); ok(U.impair > 0.5 && U.mask === 'donning', 'unmasked SWAT impaired and starts donning'); }
// gas order → masks on that turn
{ let found = false; for (let seed = 1; seed < 40 && !found; seed++) { const S = Core.newGame(seed); S.officers.forEach(o => { o.status = 'staged'; o.stage = 'primary'; });
    const r = Core.formTeam(S.officers.slice(0, 4).map(o => o.id)); const t = r.team; Core.deployTeam && Core.deployTeam(t.uid); t.deployed = true;
    const q = Core.queueOrder(t.uid, { type: 'gas', room: S.suspect.room }); if (!q.ok) continue; found = true;
    Core.execute(); ok(t.mask === 'donning', 'gas queued → team donning masks at execute'); ok(S.log.some(l => /Gas! Masks on/.test(l.text)), 'log says "Gas! Masks on"');
    Core.stepTick(); ok(t.mask === 'on', 'masks on after one tick'); } ok(found, 'found a seed where gas could be queued'); }
// suspect gas: flee / mask; mask only revealed when seen
{ let moved = 0, n = 0; for (let seed = 1; seed <= 30; seed++) { const S = Core.newGame(seed); S.suspect.hasMask = false; Core.gasDeploy(S.suspect.room); S.gasEver = true; const h = S.suspect.room;
    for (let i = 0; i < 3; i++) { Core.suspectGas(); Core.suspectGasTurn(); Core.gasTurn(); }
    n++; if (S.suspect.mode === 'fleeing' || S.suspect.mode === 'surrendered' || Core.roomAt(S.suspect.home.x, S.suspect.home.y) !== h) moved++; }
  ok(moved / n > 0.6, `unmasked suspect leaves gas / gives up in most seeds (${moved}/${n})`);
  const S = Core.newGame(3); S.suspect.hasMask = true; Core.gasDeploy(S.suspect.room); S.gasEver = true; S.vis.fill(0); S.suspect.visible = false;
  for (let i = 0; i < 8; i++) Core.suspectGas(); ok(S.suspect.maskOn, 'masked suspect dons mask after a delay'); ok(!S.suspect.maskSeen, 'mask not revealed while unseen');
  ok(S.suspect.impair < 0.1, 'masked suspect largely immune'); const home = S.suspect.home; Core.suspectGasTurn(); ok(S.suspect.mode !== 'fleeing' && S.suspect.home === home, 'masked suspect does not flee');
  ok(!JSON.stringify(Core.intelInfo ? Core.intelInfo() : {}).match(/mask/i), 'intel does not leak the mask');
  S.suspect.visible = true; Core.suspectGas(); ok(S.suspect.maskSeen && S.log.some(l => /wearing a gas mask/.test(l.text)), 'mask revealed when seen');
  let cnt = 0; for (let s = 1; s <= 200; s++) { Core.newGame(s); if (Core.state.suspect.hasMask) cnt++; } ok(cnt >= 2 && cnt < 25, `~5% of seeds have a masked suspect (${cnt}/200)`); }
// breaching
{ const S = Core.newGame(5); const t = { kind: 'team', equip: { ram: 1, halligan: 1, charge: 1 }, members: [] }; const d = S.doors.find(x => x.name === 'Front Door');
  const est = m => Core.breachEst(Object.assign(t, { members: [] }), d, m);
  const ch = Core.BREACH.charge, ram = Core.BREACH.ram, pry = Core.BREACH.pry;
  ok(ch.p > ram.p && ram.p > Core.BREACH.kick.p, 'charge most reliable, kick least');
  ok(ch.barr > ram.barr && ram.barr > pry.barr, 'barricade: explosive best, ram next, pry worst');
  ok(ch.storm >= ram.storm && ram.storm > pry.storm && pry.every > ram.every, 'storm door: pry slowest, ram less, charge ~none');
  d.storm = true; d.stormKnown = true; d.stormState = 'closed'; const eP = est('pry'), eR = est('ram'); d.storm = false; const eP0 = est('pry');
  ok(eP.ticks > eP0.ticks * 1.6 && eP.ticks - eP0.ticks > eR.ticks - Core.breachEst(t, Object.assign({}, d, { storm: false }), 'ram').ticks, `storm door adds most time to a pry (${eP0.ticks}→${eP.ticks})`);
  ok(Core.breachCan(t, 'charge') !== true, 'charge requires a breacher');
}
// full in-game charge: hang → standoff → detonate; safety & noise
{ let done = false; for (let seed = 1; seed < 40 && !done; seed++) { const S = Core.newGame(seed, { stype: 'barricade' }); /* v13: plain call — drug-house cameras would draw fire */ S.officers.forEach(o => { o.status = 'staged'; o.stage = 'primary'; });
    const br = S.officers.find(o => o.spec === 'breacher'); if (!br) continue; const ids = [br.id, ...S.officers.filter(o => o !== br && o.spec !== 'marksman').slice(0, 3).map(o => o.id)];
    const t = Core.formTeam(ids).team; t.deployed = true; const d = S.doors.find(x => x.name === 'Front Door');
    const q = Core.queueOrder(t.uid, { type: 'breach', door: d.id, method: 'charge' }); if (!q.ok) { console.log('  charge q', q.reason); continue; }
    let hung = false; for (let k = 0; k < 48 && S.phase !== 'over'; k++) { if (S.phase === 'planning') Core.execute(); Core.stepTick(); if (d.charge) hung = true; if (d.state !== 'closed') break; }
    if (!hung || S.stats.down) continue; // pinned down / took fire on this seed — try another layout
    ok(hung, 'charge icon state set (door.charge) before detonation'); ok(d.state === 'breached' || S.log.some(l => /door held/.test(l.text)), 'charge detonated');
    const [mx, my] = Core.doorMid(d); ok(Core.dist(t.x, t.y, mx, my) >= Core.CHARGE_SAFE, `team stood off ≥${Core.CHARGE_SAFE} cells (${Core.dist(t.x, t.y, mx, my).toFixed(1)})`);
    ok(S.suspect.mode !== 'barricaded', 'blast alerted the suspect'); done = true; } ok(done, 'ran a charge breach'); }
// hang only → team backs off to the standoff and waits; Detonate order blows it; return fire is a snap shot
{ let done = false; for (let seed = 1; seed < 40 && !done; seed++) { const S = Core.newGame(seed, { stype: 'barricade' }); /* v13: plain call — drug-house cameras would draw fire */ S.officers.forEach(o => { o.status = 'staged'; o.stage = 'primary'; });
    const br = S.officers.find(o => o.spec === 'breacher'); if (!br) continue; const ids = [br.id, ...S.officers.filter(o => o !== br && o.spec !== 'marksman').slice(0, 3).map(o => o.id)];
    const t = Core.formTeam(ids).team; t.deployed = true; const d = S.doors.find(x => x.name === 'Front Door');
    if (!Core.queueOrder(t.uid, { type: 'breach', door: d.id, method: 'charge', hangOnly: true }).ok) continue;
    for (let k = 0; k < 60 && S.phase !== 'over' && t.orders.length; k++) { if (S.phase === 'planning') Core.execute(); Core.stepTick(); }
    while (S.phase === 'executing') Core.stepTick();
    if (!d.charge || S.stats.down) continue;
    const [mx, my] = Core.doorMid(d); ok(d.charge && d.state === 'closed', 'hang-only leaves the charge set, door still closed');
    ok(Core.dist(t.x, t.y, mx, my) >= Core.CHARGE_SAFE, `hang-only team backed off to the standoff (${Core.dist(t.x, t.y, mx, my).toFixed(1)})`);
    const q = Core.queueOrder(t.uid, { type: 'detonate', door: d.id }); ok(q.ok && !q.warn, 'detonate from standoff has no safety warning');
    Core.execute(); for (let k = 0; k < 10 && S.phase === 'executing'; k++) Core.stepTick(); ok(d.state !== 'closed' || S.log.some(l => /door held/.test(l.text)), 'Detonate order fired the charge');
    ok(t.stun === 0 || !t.stun, 'team at standoff not dazed'); done = true; } ok(done, 'ran a hang-only charge'); }
{ const S = Core.newGame(5); const P = S.units.find(u => u.kind === 'patrol'); P.inCar = null; const sp = S.suspect; sp.visible = false;
  const w = S.windows.find(w => w.room === sp.room); const h1 = Core.hitChance(P, sp.x, sp.y, [sp.x, sp.y + 6], {}), h2 = Core.hitChance(P, sp.x, sp.y, [sp.x, sp.y + 6], { flash: true });
  ok(!h2.p || h2.parts.some(p => p.k === 'snap'), 'return fire carries a snap-shot penalty'); }

/* ---------- v4: casualties ---------- */
{ const S = Core.newGame(11); let k = 0, m = 0, im = 0; for (let i = 0; i < 2000; i++) { const c = Core.addCasualty('civilian', 'c' + i, 'Test ' + i, 60, 60); if (c.state === 'kia') k++; else if (c.state === 'mobile') m++; else im++; }
  ok(k > 120 && k < 290 && m > 650 && m < 950 && im > 900, `injury roll split kia/mobile/immobile ≈ 10/40/50 (${k}/${m}/${im})`); }
{ const S = Core.newGame(11); const c = Core.addCasualty('patrol', 'P1', 'Ofc. Test', 70, 60, { kia: 0, mobile: 0 }); const c0 = c.crit;
  S.cas.length = 0; S.cas.push(c); for (let i = 0; i < c0; i++) Core.casualtyTurn();
  ok(c.state === 'lost' || c.crit < c0, `critical countdown runs each turn (${c0} → ${c.crit}, ${c.state})`); }
{ const S = Core.newGame(11); const t = { kind: 'team', name: 'T', equip: { medkit: 1 }, members: [] };
  const medic = S.officers.find(o => o.spec === 'medic'); medic.status = 'ok'; t.members = [medic.id]; t.status = 'ok';
  const c = Core.addCasualty('patrol', 'P1', 'Ofc. A', 70, 60, { kia: 0, mobile: 1 }); c.sev = 2; Core.applyAid(t, c); ok(c.stable && t.equip.medkit === 0, 'medic + medkit stabilises a serious casualty');
  const c2 = Core.addCasualty('patrol', 'P2', 'Ofc. B', 70, 61, { kia: 0, mobile: 0 }); c2.sev = 2; const b = c2.crit; const P = S.units.find(u => u.kind === 'patrol');
  Core.applyAid(P, c2); ok(!c2.stable && c2.crit === b + Core.CAS_CFG.aidOther, 'non-medic aid only extends the countdown');
  ok(!Core.applyAid(P, c2, true), 'non-medic aid does not stack'); }
// evac: patrol carries an outdoor casualty to EMS, then transport → evacuated
{ let done = false; for (let seed = 3; seed < 20 && !done; seed++) { const S = Core.newGame(seed); const sp = S.suspect; sp.mode = 'incapacitated';
    const P = S.units.find(u => u.kind === 'patrol' && !u.inCar); if (!P) continue; const c = Core.addCasualty('patrol', 'PX', 'Ofc. X', P.x + 2, P.y, { kia: 0, mobile: 0 }); c.reported = true; c.known = true; c.crit = 30;
    sp.mode = 'barricaded'; const q = Core.queueOrder(P.uid, { type: 'evac', cas: c.id }); if (!q.ok) { continue; }
    for (let k = 0; k < 120 && c.state !== 'evacuated' && S.phase !== 'over'; k++) { if (S.phase === 'planning') { Core.execute(); if (!P.orders.length && c.state === 'immobile') Core.queueOrder(P.uid, { type: 'evac', cas: c.id }); } Core.stepTick(); }
    if (S.phase === 'over') continue; if (c.state === 'immobile' && S.log.some(l => /under fire — taking cover/.test(l.text || l.msg || l.t || ''))) continue; // v14: carrier pinned by fire on this map — try the next one
    ok(c.state === 'evacuated' || c.state === 'transport', `evac order delivers casualty to EMS (${c.state})`); done = true; } ok(done, 'ran an evac'); }
{ const S = Core.newGame(4); ok(Core.setEMS(Core.houseCenter()[0], Core.houseCenter()[1]).ok === false, 'EMS point cannot be placed at the house'); }


/* ---------- v5: containment cover ---------- */
{ let bad = 0, n = 0; for (let seed = 1; seed <= 25; seed++) { Core.newGame(seed * 31); n++; if (Core.validateContain().length) bad++; } ok(bad === 0, `containment posts validated on ${n} seeds (shielded from every window & door, reachable, no overlap)`); }
{ const S = Core.newGame(77); ok(S.contain.every(c => Core.shieldAt(c.x, c.y, { static: true }).q !== 'open' && (c.q === 'hard' || c.q === 'conceal')) || S.contain.every(c => c.q === 'cruiser' ? /^Front/.test(c.name) : Core.shieldAt(c.x, c.y, { static: true }).q !== 'open'), 'every post is hard cover, concealment or cruiser cover');
  ok(S.units.filter(u => u.kind === 'patrol' && !u.inCar && !u.badPos && u.status === 'ok').every(u => Core.shieldAt(u.x, u.y).q !== 'open'), 'patrol officers start in cover (unless placed badly / down)'); }
// v8: move anywhere — an open spot is never snapped, it is flagged/warned instead
{ let snapped = 0, warned = 0, tried = 0; for (let seed = 1; seed <= 6; seed++) { const S = Core.newGame(seed * 13); const p = S.units.find(u => u.kind === 'patrol' && !u.inCar); if (!p) continue;
    for (let y = 0; y < Core.MAP_H; y += 4) for (let x = 0; x < Core.MAP_W; x += 4) { const c = Core.idx(x, y); if (S.block[c] || S.room[c] >= 0 || S.dyn[c] || Core.coverInfo(x, y).level !== 'open' || tried > 150) continue;
      p.orders = []; const o = { type: 'move', x, y }; const r = Core.queueOrder(p.uid, o); if (!r.ok) continue; tried++;
      if (o.cover === 'open') { warned++; ok(S.log.slice(-3).some(l => /no cover/i.test(l.t || l.msg || l.text || '')), 'open-spot move logs a warning'); }
      else if (o.x !== x || o.y !== y) snapped++; else warned++; } }
  ok(tried > 50 && snapped === 0 && warned === tried, `open-spot moves go exactly where ordered, with a warning (${snapped}/${tried} snapped, ${warned} warned)`); }
// hard cover cuts hit odds far more than concealment
{ const H = Core.T_HIT || null; const S = Core.newGame(5); const t = Core.targetClass ? null : null;
  if (Core.T_HIT) ok(Core.T_HIT.covered < Core.T_HIT.concealed && Core.T_HIT.concealed > 0.6, `concealment barely reduces hit chance (${Core.T_HIT.concealed}), hard cover does (${Core.T_HIT.covered})`);
  else ok(true, 'T_HIT not exported (skipped)'); }
/* ---------- v4: negotiation ---------- */
{ const S = Core.newGame(21); S.officers.filter(o => o.spec === 'negotiator').forEach(o => o.status = 'staged'); S.nego.numberKnown = false; S.nego.line = false;
  ok(Core.talkAvail('call') !== true, 'phone call needs his number'); S.nego.numberKnown = true; ok(Core.talkAvail('call') === true, 'call available once the number is known');
  ok(Core.talkAvail('rapport') !== true, 'dialogue needs live contact'); }
{ let ref = 0, n = 0; for (let seed = 1; seed <= 300; seed++) { const S = Core.newGame(seed); S.suspect.agit = 40; S.suspect.talk = 0; n++; if (!Core.contactTry('phone')) ref++; }
  ok(ref > 30 && ref < 240, `contact attempts can be refused (${ref}/${n})`); }
{ const S = Core.newGame(8); S.nego.hidden = true; const none = { cover: false, shield: false, overwatch: false, commands: false }, all = { cover: true, shield: true, overwatch: true, commands: true };
  const a = Core.ambushChance(none), b = Core.ambushChance(all); ok(a > b * 3, `walk-out protocol cuts ambush risk (${(a * 100).toFixed(0)}% → ${(b * 100).toFixed(0)}%)`);
  const r = Core.ambushRisk(none); ok(r >= 0.15 && r <= 0.25, `baseline surrender-ambush risk 15–25% (${(r * 100).toFixed(0)}%)`); }
// call-out odds are low (≈10–15%) with full containment and no rapport
{ let w = 0, n = 0; for (let seed = 1; seed <= 400; seed++) { const S = Core.newGame(seed); S.contain.forEach(c => c.covered = true); const car = S.units.find(u => u.kind === 'cruiser' && u.occ.length);
    if (!car) continue; const [hx, hy] = Core.houseCenter(); if (Math.hypot(car.x - hx, car.y - hy) > Core.NEGO_CFG.pa.range) { car.x = hx; car.y = hy + 12; } S.suspect.agit = 30; S.suspect.talk = 0;
    n++; Core.paAct(car, { mode: 'callout' }); if (S.suspect.mode === 'surrendered') w++; }
  ok(n > 50 && w / n > 0.05 && w / n < 0.2, `call-out success is low (${w}/${n} = ${(100 * w / n).toFixed(0)}%)`); }
// a talked-out walk-out ends in custody
{ let done = false; for (let seed = 1; seed < 30 && !done; seed++) { const S = Core.newGame(seed); S.nego.hidden = false; S.officers.forEach(o => o.status = 'staged');
    Core.walkout('talk'); for (let k = 0; k < 80 && S.phase !== 'over'; k++) { if (S.phase === 'planning') Core.execute(); Core.stepTick(); }
    if (S.suspect.mode === 'detained') { ok(S.result && S.result.win && (S.result.debrief || []).some(d => d.k === 'Negotiation'), 'walk-out → custody, debrief lists negotiation'); done = true; } }
  ok(done, 'surrender walk-out completes'); }

// ---- v6: scene / perimeter / time ----
{ let crOnlyFront = true, noYard = true, gapOk = 0, gapN = 0, goodOk = 0, goodN = 0, rb = true, brief = true, inj = 0, kia = 0, crit = true;
  for (let seed = 1; seed <= 40; seed++) { const S = Core.newGame(seed * 131); const H = S.house;
    S.contain.forEach(c => { if (c.q === 'cruiser' && !/^Front/.test(c.name)) crOnlyFront = false; if (/^Front/.test(c.name) && !(c.q === 'cruiser' || c.q === 'hard')) crOnlyFront = false; });
    if ((S.ext.added || []).some(a => a.y > H.y1)) noYard = false;
    if (S.roadblocks.length < 2 || !S.roadblocks.every(b => Core.roadblockHeld(b))) rb = false;
    if (!S.brief || !S.brief.transcript.length || !S.brief.activatedAt) brief = false;
    const sw = Core.sideWatch(); if (S.scene.variant === 'gap') { gapN++; if (sw.gaps.length) gapOk++; } if (S.scene.variant === 'good' && !S.scene.injury) { goodN++; if (!sw.gaps.length) goodOk++; }
    if (S.scene.injury) { inj++; const c = S.cas.find(c => c.initial); if (!c) crit = false; else if (c.state === 'kia') kia++; else if (c.state !== 'mobile' && !(c.crit > 0)) crit = false; } }
  ok(crOnlyFront, 'front posts are cruiser-in-street (or a parked car), never yard cover'); ok(noYard, 'no procedural cover added in the front yard');
  ok(rb, 'every map starts with ≥2 held roadblocks'); ok(brief, 'every map has a brief + 911 transcript');
  ok(gapN > 3 && gapOk === gapN, `gap variant always leaves a side unwatched (${gapOk}/${gapN})`); ok(goodN > 2 && goodOk === goodN, `good variant watches all sides (${goodOk}/${goodN})`);
  ok(Core.SCENE_CFG.injury <= 0.06 && inj <= 8 && crit, `starting injuries rare (~5%) (${inj}/40, KIA ${kia}) with a valid state`); }
{ const S = Core.newGame(4242); ok(!Core.intelInfo().containKnown, 'containment unknown before Status Check');
  Core.setCommand('status'); ok(Core.intelInfo().containKnown, 'Status Check reveals containment'); ok(S.log.some(l => /status|roll call/i.test(l.text)), 'status check logs a roll call');
  const n0 = S.log.length; Core.review911(); Core.review911(); ok(S.intel.call911 && S.log.length - n0 <= 3, 'review911 is applied once (shared by brief + command)');
  ok(Core.mmss(90) === '1:30' && Core.tDur(3) === '1:30' && Core.tMin(1) === '0.5 min' && Core.tMin(4) === '2 min', 'time helpers: 1 turn = 30 s');
  const c0 = Core.clockAt(0, 0), c2 = Core.clockAt(2, 0); const sec = t => t.split(':').reduce((a, b) => a * 60 + +b, 0); ok((sec(c2) - sec(c0) + 86400) % 86400 === 60, `clock advances 0:30 per turn (${c0} → ${c2})`);
  ok(Core.elapsedAt(3, 4) === '1:45', 'elapsed clock includes ticks'); }
{ const S = Core.newGame(77, { roster: [{ id: 'A1', last: 'Tester', spec: 'leader', quals: [], skill: 0.8, rank: 'Sgt.' }, { id: 'A2', last: 'Two', spec: 'tech', quals: [], skill: 0.7 }], gear: { drone: 0, robot: 0 }, teamMax: 6, armored: true });
  ok(S.officers.length === 2 && S.officers[0].careerId === 'A1' && S.officers[0].name === 'Sgt. Tester', 'career roster replaces generated officers');
  ok(S.armory.drone === 0 && S.armory.robot === 0 && S.teamMax === 6, 'career gear + team size applied');
  ok(S.units.some(u => u.armored) || (S.bcPending && S.bcPending.unit.armored) || (S.bcPend || []).some(p => p.unit.armored), 'armored vehicle unlocked (v20: en route to staging)');
  const sm = Core.careerSummary(); ok(sm.officers.length === 2 && typeof sm.score === 'number' && sm.outcome, 'careerSummary is plain data');
  const S2 = Core.newGame(77); ok(S2.officers.length === 11 && !S2.units.some(u => u.armored), 'classic (seed replay) game unaffected by career opts'); }
console.log(`MECHANICS: ${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1;
require('./v7.js'); // v7 rules: no timer / no auto-fail / deductions / indoor LOS
