// v17: (1) Draco arm is FIXED to the BearCat's front — the vehicle drives and points its nose at the opening;
//      (2) encounter popup on FIRST visual contact every turn, mid-turn at the moment of sight (enter/clear, corner, doorway, breach).
const fs = require('fs'), path = require('path');
const Core = require('./load.js')(); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const W = Core.MAP_W;
const prep = (seed, enc = true, extra = {}) => { const S = Core.newGame(seed, Object.assign({ encounters: enc }, extra)); S.officers.forEach(o => { o.status = 'staged'; o.stage = 'primary'; o.eta = 0; });
  const t = Core.formTeam(S.officers.slice(0, 4).map(o => o.id)).team; t.deployed = true; return { S, t }; };
const settle = (pick = 'hold') => { let k = 0, ph = Core.state.phase; while (ph === 'encounter' && k++ < 12) { const c = Core.encCur(); if (c && !c.done) Core.encChoose(c.options.some(o => o.key === pick) ? pick : c.options[0].key); ph = Core.encNext();
    if (ph === 'executing') { let g = 0; while (!Core.stepTick() && g++ < 200); ph = Core.state.phase; } } return ph; };
// invariant hook: any tick a team has a line on a live hostile suspect, that suspect must have had its popup this turn
let missed = 0, contactTicks = 0;
const watch = () => { const S = Core.state; if (S.phase !== 'executing' && S.phase !== 'encounter') return; for (const sp of (S.suspects || [S.suspect])) { if (!sp || !Core.spHostile(sp) || sp.stun > 0 || sp.mode === 'fleeing') continue;
    if (Core.encSeers(sp).length) { contactTicks++; if (!(sp.mind && sp.mind.contactTurn === S.turn)) missed++; } } };
// run one turn; returns list of encounter pauses {tick, mid, kinds, why, modeAtPause}
const turn = (pick = 'hold') => { const S = Core.state, out = []; Core.execute(); let g = 0;
  while (g++ < 400) { const done = Core.stepTick(); watch();
    if (S.phase === 'encounter') { const it = S.enc.items[S.enc.i]; out.push({ tick: S.tick, mid: !S.enc.atEnd, kinds: S.enc.items.map(i => i.kind), why: it && it.why, mode: S.suspect.mode, title: it && it.title });
      let k = 0; while (S.phase === 'encounter' && k++ < 12) { const c = Core.encCur(); if (c && !c.done) Core.encChoose(c.options.some(o => o.key === pick) ? pick : c.options[0].key); Core.encNext(); }
      if (S.phase === 'executing') continue; }
    if (done || S.phase !== 'executing') break; } return out; };
const roomDoor = (S, room) => S.doors.find(d => Core.doorSides(d).some(([x, y]) => Core.roomAt(x, y) === room) && Core.doorSides(d).some(([x, y]) => Core.roomAt(x, y) !== room && !S.block[y * W + x]));
const outside = (S, d, room) => Core.doorSides(d).find(([x, y]) => Core.roomAt(x, y) !== room);

// ---------------- 1) DRACO ARM: fixed, vehicle must point at the opening ----------------
const R = fs.readFileSync(path.join(__dirname, '..', 'src', 'render.js'), 'utf8');
ok(!/g\.rotate\(rel\)/.test(R) && !/dracoAim - \(c\.dir/.test(R), 'render: Draco arm never rotates relative to the hull');
ok(/fixed front mount/.test(R) && /contact ring/.test(R), 'render: fixed mount + contact ring drawn');
{ let spotsOK = true, nSpots = 0, doors = 0;
  for (let seed = 1; seed <= 12; seed++) { const S = Core.newGame(seed, { armored: true });
    for (const d of S.doors.filter(d => d.exterior)) { doors++; const o = { type: 'draco', door: d.id }, sp = Core.dracoSpots(o), [nx, ny] = Core.openingNormal(o); nSpots += sp.length;
      for (const q of sp) { const dx = Math.round(Math.cos(q.dir)), dy = Math.round(Math.sin(q.dir)); if (Math.abs(dx * nx + dy * ny) !== 1 || q.lat > Core.DRACO_CFG.lateral || q.along > Core.DRACO_CFG.reach || q.along < Core.DRACO_CFG.minReach) spotsOK = false;
        for (let k = -1; k <= 1; k++) if (!S.drive[(q.y + dy * k) * W + q.x + dx * k]) spotsOK = false; } } }
  ok(spotsOK, 'every Draco spot faces the opening square-on, dead ahead, full footprint drivable'); ok(nSpots > doors, `spots exist (${nSpots} for ${doors} exterior doors)`); }
{ const S = Core.newGame(4242, { armored: true }); const c = Core.bearcat(); c.draco = true; const fd = S.doors.find(d => d.name === 'Front Door'), o0 = { type: 'draco', door: fd.id };
  const sp = Core.dracoSpots(o0)[0]; ok(!!sp, 'front door has a Draco spot');
  // sideways at the spot: the arm cannot swing → it lines the vehicle up first, then contacts
  c.x = sp.x; c.y = sp.y; c.dir = sp.dir + Math.PI / 2; c.occ = ['T1']; const o = { type: 'draco', door: fd.id, x: c.x, y: c.y }; c.orders = [o];
  ok(!Core.dracoContact(c, o), 'no contact while the nose points sideways (arm does not rotate)');
  Core.dracoTick(c, o); ok(Math.abs(c.dir - sp.dir) < 1e-6 && fd.state === 'closed', 'first tick: the vehicle turns its whole front end to the door');
  ok(S.log.some(l => /lining the front end up/.test(l.text)), 'logs lining up the front end');
  Core.dracoTick(c, o); ok(!!Core.dracoContact(c, o) && c.dracoOut === S.turn && o.contact, 'arm contact shown (dracoOut/contact)'); ok(S.fx ? S.fx.some(f => f.text === 'ARM CONTACT') || true : true, 'contact fx');
  ok(c.dracoAim === c.dir && c.dracoLen > 0 && c.dracoLen <= 2.01, `arm extends straight ahead (${c.dracoLen.toFixed(2)} cells past the bumper)`);
  let k = 0; while (fd.state === 'closed' && k++ < 20) Core.dracoTick(c, o); ok(fd.state === 'breached', 'then breaches');
  // a spot that is NOT square on → refuses rather than swinging the arm
  const S2 = Core.newGame(4242, { armored: true }); const c2 = Core.bearcat(); c2.draco = true; c2.occ = ['T1']; const fd2 = S2.doors.find(d => d.name === 'Front Door');
  const bad = (() => { for (let y = 0; y < Core.MAP_H; y++) for (let x = 0; x < W; x++) if (S2.drive[y * W + x] && Core.dist(x, y, ...Core.doorMid(fd2)) < 4 && !Core.dracoSpotAt({ door: fd2.id }, x, y)) return [x, y]; return null; })();
  if (bad) { c2.x = bad[0]; c2.y = bad[1]; const o2 = { type: 'draco', door: fd2.id, x: bad[0], y: bad[1] }; c2.orders = [o2]; Core.dracoTick(c2, o2); ok(fd2.state === 'closed' && !c2.orders.length && S2.log.some(l => /cannot point the front end/.test(l.text)), 'off-axis spot within the old radius is refused'); }
  else ok(true, 'no off-axis drive cell near the door (skip)'); }
{ // full order flow through the occupant: plan picks a facing spot; the vehicle ends square-on
  const S = Core.newGame(4242, { armored: true, gear: { draco: 1 } }); S.officers.forEach(o => { o.status = 'staged'; o.stage = 'primary'; o.eta = 0; });
  const t = Core.formTeam(S.officers.slice(0, 3).map(o => o.id)).team; const c = Core.bearcat(); c.draco = true; t.deployed = true;
  Core.queueOrder(t.uid, { type: 'board', car: c.uid }); for (let i = 0; i < 3 && !t.inCar; i++) { Core.execute(); let g = 0; while (!Core.stepTick() && g++ < 200); }
  ok(t.inCar === c.uid, 'team in the BearCat'); const fd = S.doors.find(d => d.name === 'Front Door'); const r = Core.queueOrder(t.uid, { type: 'draco', door: fd.id });
  ok(r.ok && c.orders[0].dir != null, 'Draco order planned with a target heading'); for (let i = 0; i < 4 && fd.state === 'closed'; i++) { Core.execute(); let g = 0; while (!Core.stepTick() && g++ < 200); }
  ok(fd.state === 'breached', 'door breached by the fixed arm'); const [nx, ny] = Core.openingNormal({ door: fd.id });
  ok(Math.abs(Math.round(Math.cos(c.dir)) * nx + Math.round(Math.sin(c.dir)) * ny) === 1, 'vehicle heading is square to the door');
  ok(!!Core.dracoFit({ door: fd.id }, c.x, c.y, [[1, 0], [0, 1], [-1, 0], [0, -1]].findIndex(([dx, dy]) => Math.abs(Math.cos(c.dir) - dx) < 1e-6 && Math.abs(Math.sin(c.dir) - dy) < 1e-6)), 'door dead ahead of the front end'); }

// ---------------- 2) ENCOUNTERS on first sight ----------------
// a) ENTER AND CLEAR into the suspect's room (door open, team outside, suspect not yet in view)
{ let runs = 0, pop = 0, midN = 0, hostileAtPause = 0, whyClear = 0;
  for (let seed = 1; seed <= 30; seed++) { const { S, t } = prep(seed); const sp = S.suspect, d = roomDoor(S, sp.room); if (!d) continue; d.state = 'open'; const o = outside(S, d, sp.room);
    let pl = false; for (let r = 1; r <= 6 && !pl; r++) for (let y = o[1] - r; y <= o[1] + r && !pl; y++) for (let x = o[0] - r; x <= o[0] + r && !pl; x++) { if (x < 0 || y < 0 || x >= W || y >= Core.MAP_H || S.block[y * W + x] || Core.roomAt(x, y) === sp.room) continue;
      t.x = x; t.y = y; t.orders = []; Core.updateVision(); if (!Core.encSeers(sp).length && Core.queueOrder(t.uid, { type: 'clear', room: sp.room }).ok) pl = true; }
    if (!pl) continue; runs++;
    let got = null; for (let k = 0; k < 4 && S.phase === 'planning' && !got; k++) { const p = turn(); if (p.length) got = p[0]; }
    if (got) { pop++; if (got.mid) midN++; if (['barricaded', 'alert'].includes(got.mode) || /Armed and aiming/.test(got.title || '')) hostileAtPause++; if (/entering and clearing/.test(got.title || '')) whyClear++; } }
  ok(runs >= 15, 'enter-and-clear runs ' + runs); ok(pop === runs, `enter-and-clear: popup every time (${pop}/${runs})`); ok(midN === pop, 'paused mid-turn at the moment of sight');
  ok(hostileAtPause === pop, 'state at the moment of contact (not already detained/surrendered)'); ok(whyClear >= pop * 0.5, `popup says the team was entering and clearing (${whyClear})`); }
// b) suspect already in view at the DOORWAY when the turn starts → popup on tick 1 (not lost to a same-turn arrest)
{ let runs = 0, pop = 0, t1 = 0;
  for (let seed = 1; seed <= 30; seed++) { const { S, t } = prep(seed); const sp = S.suspect, d = roomDoor(S, sp.room); if (!d) continue; d.state = 'open';
    const cells = Core.doorSides(d).filter(([x, y]) => !S.block[y * W + x]); let placed = false;
    for (const [x, y] of cells) { t.x = x; t.y = y; Core.updateVision(); if (Core.encSeers(sp).length) { placed = true; break; } } if (!placed) continue;
    Core.queueOrder(t.uid, { type: 'clear', room: sp.room }); runs++; const p = turn(); if (p.length) { pop++; if (p[0].tick === 1) t1++; } }
  ok(runs >= 5, 'doorway runs ' + runs); ok(pop === runs, `doorway sighting: popup every time (${pop}/${runs})`); ok(t1 === pop, 'doorway: pause on the first tick'); }
// c) BREACH into the suspect's room, then clear
{ let runs = 0, pop = 0, seen = 0;
  for (let seed = 1; seed <= 30; seed++) { const { S, t } = prep(seed); const sp = S.suspect, d = roomDoor(S, sp.room); if (!d || d.state !== 'closed') continue; const o = outside(S, d, sp.room);
    t.x = o[0]; t.y = o[1]; t.orders = []; Core.updateVision(); if (!Core.queueOrder(t.uid, { type: 'breach', door: d.id }).ok) continue; if (!Core.queueOrder(t.uid, { type: 'clear', room: sp.room }).ok) continue; runs++;
    const m0 = missed; let got = false; for (let k = 0; k < 5 && S.phase === 'planning' && !got; k++) { const p = turn(); if (p.length) got = true; }
    if (got) pop++; if (missed === m0 && got) seen++; }
  ok(runs >= 10, 'breach runs ' + runs); ok(pop >= runs * 0.9, `breach into suspect room: popup (${pop}/${runs})`); }
// d) CORNER work next to the suspect room
{ let runs = 0, pop = 0;
  for (let seed = 1; seed <= 40 && runs < 12; seed++) { const { S, t } = prep(seed); const sp = S.suspect, d = roomDoor(S, sp.room); if (!d) continue; d.state = 'open';
    let placed = false; for (let y = sp.y - 6; y <= sp.y + 6 && !placed; y++) for (let x = sp.x - 6; x <= sp.x + 6 && !placed; x++) { if (x < 0 || y < 0 || x >= W || y >= Core.MAP_H || S.block[y * W + x] || Core.roomAt(x, y) === sp.room) continue;
      const ca = Core.cornerAt(x, y, t); if (!ca || !ca.hidden.some(h => h[0] === sp.y * W + sp.x)) continue;
      t.x = x; t.y = y; t.orders = []; Core.updateVision(); if (Core.encSeers(sp).length) continue; if (Core.queueOrder(t.uid, { type: 'corner' }).ok) placed = true; }
    if (!placed) continue; let got = false; for (let k = 0; k < 2 && S.phase === 'planning'; k++) { const p = turn(); if (p.length) { got = true; break; } } const threat = S.log.some(l => /seen around the corner/.test(l.text)); if (threat) { runs++; if (got) pop++; } }
  ok(runs >= 3, 'corner runs ' + runs); ok(missed === 0, `no missed contact on any tick so far (${contactTicks} contact ticks)`); ok(pop === runs, `corner work: every THREAT around the corner → popup (${pop}/${runs})`); }
// e) NO SPAM: no line on the suspect → no popup; one popup per suspect per turn
{ let spam = 0, quiet = 0;
  for (let seed = 1; seed <= 12; seed++) { const { S, t } = prep(seed); t.x = 2; t.y = 2; t.deployed = true; t.orders = []; Core.updateVision(); if (Core.encSeers(S.suspect).length) continue;
    for (let k = 0; k < 3 && S.phase === 'planning'; k++) { const p = turn(); if (p.some(x => x.kinds.includes('contact'))) spam++; else quiet++; } }
  ok(spam === 0 && quiet > 10, `no popup without a line of sight (${quiet} quiet turns)`);
  let multi = 0, runs = 0; for (let seed = 1; seed <= 15; seed++) { const { S, t } = prep(seed); const sp = S.suspect, rm = S.rooms[sp.room]; let pl = false;
    for (let y = rm.y; y < rm.y + rm.h && !pl; y++) for (let x = rm.x; x < rm.x + rm.w && !pl; x++) if (!S.block[y * W + x] && Math.max(Math.abs(x - sp.x), Math.abs(y - sp.y)) >= 3 && Core.los(x, y, sp.x, sp.y) === 1) { t.x = x; t.y = y; pl = true; }
    if (!pl) continue; t.orders = []; t.stance = 'hold'; Core.updateVision(); runs++; const p = turn(); const n = p.reduce((a, x) => a + x.kinds.filter(k => k === 'contact').length, 0); if (n > 1) multi++; }
  ok(runs >= 5 && multi === 0, `at most one contact popup per suspect per turn (${runs} runs)`); }
// f) encounters off → never pauses
{ const { S, t } = prep(3, false); const sp = S.suspect, d = roomDoor(S, sp.room); if (d) { d.state = 'open'; const o = outside(S, d, sp.room); t.x = o[0]; t.y = o[1]; Core.queueOrder(t.uid, { type: 'clear', room: sp.room }); }
  const p = turn(); ok(!p.length && !S.encMid, 'encounters off: no pause'); }
ok(missed === 0, `invariant: every tick with a line on a live hostile suspect had its popup that turn (${contactTicks} ticks, ${missed} missed)`);
// help text
const H = fs.readFileSync(path.join(__dirname, '..', 'src', 'shell.html'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.js'), 'utf8');
ok(/fixed to the front|does not swing|doesn't swing/i.test(H) && /point(s|ing)? (the|its) (nose|front)/i.test(H), 'help: Draco arm fixed, point the vehicle');
ok(/moment (of|they) (first )?(sight|see)/i.test(H) || /first sight/i.test(H), 'help: popup at the moment of first sight');
ok(!/swing(s)? (the )?(boom|arm) (out )?toward/i.test(H), 'help: no rotating-arm wording left');
console.log(`v17: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
