// Node harness: (1) procedural generation validity over many seeds, (2) balance sanity check.
// Usage: node tests/harness.js [genSeeds=60] [balanceSeeds=40]
const load = require('./load.js');
const Core = load();
const NG = +process.argv[2] || 60, NB = +process.argv[3] || 40;
let fail = 0; const VAR = {}, GAP = {}; let INJ = 0, INJK = {}, nCars = 0; const cq = { hard: 0, conceal: 0, cruiser: 0 }, addK = {}; let nPost = 0; const arch = {}, rooms = {}, weap = {}, sigs = new Set(), bad = [];
const t0 = Date.now();
for (let seed = 1; seed <= NG; seed++) {
  const S = Core.newGame(seed * 7919 % 999983);
  const errs = [...(S.genErrors || []), ...Core.validateHouse(), ...Core.validateWorld()];
  // extra invariants
  const N = Core.MAP_W * Core.MAP_H;
  for (let c = 0; c < N; c++) if (S.room[c] >= 0 && S.block[c] && S.opaque[c]) { errs.push('opaque solid inside house'); break; }
  for (const d of S.doors) for (const [a, b] of d.cells) { const ra = Core.roomAt(a[0], a[1]), rb = Core.roomAt(b[0], b[1]); if (ra === rb) errs.push('door ' + d.name + ' not on a wall'); if (d.exterior && ra >= 0 && rb >= 0) errs.push('exterior door between rooms'); }
  for (const w of S.windows) for (const e of w.edges) { if (Core.roomAt(e[0], e[1]) < 0 || Core.roomAt(e[2], e[3]) >= 0) errs.push('window not on exterior wall'); }
  for (const u of S.units) { if (u.kind === 'cruiser' && Core.footprint(u).some(([x, y]) => !S.drive[Core.idx(x, y)] && !S.paved[Core.idx(x, y)])) errs.push(u.name + ' parked off drivable ground');
    if (u.kind === 'patrol' && !u.inCar && (S.block[Core.idx(u.x, u.y)] || S.dyn[Core.idx(u.x, u.y)])) errs.push(u.name + ' starts inside an obstacle'); }
  if (!S.perches.length) errs.push('no sniper perches');
  if (S.contain.length < 6) errs.push('containment points missing');
  // every post: shielded from every window/door by static cover (real sight-line check), reachable, not inside an object, no overlaps; patrols start covered
  errs.push(...Core.validateContain());
  S.contain.forEach(c => { nPost++; cq[c.q]++; if (c.added) addK[c.added] = (addK[c.added] || 0) + 1; });
  const sc = S.scene; VAR[sc.variant] = (VAR[sc.variant] || 0) + 1; sc.gap0.forEach(g => GAP[g] = (GAP[g] || 0) + 1); if (sc.injury) { INJ++; INJK[sc.injury.kind] = (INJK[sc.injury.kind] || 0) + 1; }
  nCars += S.ext.cars.filter(c => c.street).length;
  if (sc.variant === 'good' && sc.gap0.length && !sc.injury) errs.push('good variant has a gap');
  if (sc.variant === 'gap' && !sc.gap0.length) errs.push('gap variant without a gap');
  if (S.roadblocks.length !== 2 || !S.roadblocks.every(b => Core.roadblockHeld(b))) errs.push('roadblocks not set');
  for (const u of S.units) if (u.kind === 'cruiser' && Math.abs(u.x - (S.house.x0 + S.house.x1) / 2) < 18) errs.push(u.name + ' starts at the house');
  if (!S.brief || !S.brief.transcript.length) errs.push('no brief');
  const sp = S.suspect; if (!S.doors.some(d => d.barricaded)) errs.push('no barricade');
  if (errs.length) { fail++; bad.push([seed, errs.slice(0, 4)]); }
  arch[S.house.archName] = (arch[S.house.archName] || 0) + 1; const rn = S.rooms[sp.room].type; rooms[rn] = (rooms[rn] || 0) + 1; weap[sp.weapon] = (weap[sp.weapon] || 0) + 1;
  sigs.add(S.house.arch + S.rooms.map(q => q.x + ',' + q.y + q.w + q.h).join('') + S.ext.nb.map(n => n.parts[0].x + ',' + n.parts[0].y).join(''));
}
console.log(`GENERATION: ${NG} seeds, ${fail} invalid, ${sigs.size} distinct layouts (${Date.now() - t0} ms)`);
console.log('  archetypes', JSON.stringify(arch)); console.log('  barricaded room types', JSON.stringify(rooms)); console.log('  suspect weapons', JSON.stringify(weap));
console.log(`  containment posts: ${nPost} (all validated vs window/door sight lines) — hard ${cq.hard}, concealment ${cq.conceal}, cruiser-cover (front, street) ${cq.cruiser}; procedural cover added at ${Object.values(addK).reduce((a, b) => a + b, 0)}: ${JSON.stringify(addK)}`);
console.log(`  patrol variants ${JSON.stringify(VAR)}; gaps at start ${JSON.stringify(GAP)}; officer hit before SWAT ${INJ}/${NG} ${JSON.stringify(INJK)}; street cars avg ${(nCars / NG).toFixed(1)}`);
bad.slice(0, 8).forEach(b => console.log('  BAD seed', b[0], b[1].join('; ')));

/* ---------------- balance policies ---------------- */
function st() { return Core.state; }
function units(k) { return st().units.filter(u => u.kind === k && u.status === 'ok'); }
function runTurn() { Core.execute(); let g = 0; while (!Core.stepTick() && g++ < 50); }
function perimeter(exact, cars) {
  const S = st(), pts = S.contain.filter(c => !c.name.startsWith('Front')); const P = units('patrol').filter(p => !p.inCar);
  P.forEach((p, i) => { if (p.orders.length) return; const c = pts[i % pts.length]; if (!c) return; Core.queueOrder(p.uid, { type: 'move', x: c.x, y: c.y, exact }); });
  if (!cars) return; // crewed cruisers leave the roadblocks and screen the front (street) posts
  const fr = S.contain.filter(c => c.name.startsWith('Front')); units('cruiser').filter(c => c.occ.length).forEach((c, i) => { const f = fr[i]; if (!f || c.orders.length) return; const t = f.car || { x: f.x, y: f.y - 1 }; Core.queueOrder(c.uid, { type: 'move', x: t.x, y: t.y }); });
}
function hostile_(sp) { return ['barricaded', 'alert'].includes(sp.mode); }
function policy(kind) {
  return function step() {
    const S = st(), sp = S.suspect;
    if (kind === 'passive') return;
    if (S.turn === 0) { if (kind === 'competent') { Core.review911(); Core.setCommand('status'); } perimeter(kind === 'reckless', kind === 'competent'); return; }
    if (S.turn === 1 && kind === 'competent') Core.setCommand('interview');
    // reckless: patrol walks up to the front windows in the open and shoots
    if (kind === 'reckless') { const H = S.house; units('patrol').forEach((p, i) => { if (!p.inCar && !p.orders.length) Core.queueOrder(p.uid, { type: 'move', x: H.x0 + 3 + i * 4, y: H.y1 + 3, exact: true }); }); }
    if (Core.formTeam && S.officers.filter(o => o.status === 'staged' && !o.team).length >= (kind === 'competent' ? 5 : 3) && units('team').length < 2) {
      let ids = S.officers.filter(o => o.status === 'staged' && !o.team);
      if (kind === 'competent' && ids.some(o => o.spec === 'marksman') && !units('team').some(t => Core.hasSpec(t, 'marksman'))) { const m = ids.find(o => o.spec === 'marksman'); const sp_ = ids.find(o => o !== m && o.quals.includes('spotter')) || ids.find(o => o !== m && o.spec !== 'leader' && o.spec !== 'breacher'); if (sp_) Core.formTeam([m.id, sp_.id]); }
      ids = S.officers.filter(o => o.status === 'staged' && !o.team); if (ids.length >= 3 && !units('team').some(t => !Core.hasSpec(t, 'marksman') || t.members.length > 2)) Core.formTeam(ids.map(o => o.id));
    }
    if (kind === 'competent') {
      const avail = Object.keys(Core.COMMANDS).filter(k => Core.COMMANDS[k].avail() === true);
      for (const k of ['family', 'flyby']) if (avail.includes(k)) { Core.setCommand(k); break; }
      // negotiation: call when we have a number / line, else open PA contact from a cruiser in range
      const N = Core.negoSummary(), A = N.avail;
      if (A.call === true) Core.setTalk('call');
      else if (N.contact) { const k = sp.agit > 60 ? 'listen' : A.concession === true && sp.talk >= 30 && sp.talk <= 70 ? 'concession' : 'rapport'; if (A[k] === true) Core.setTalk(k); }
      if (!N.contact && N.onScene && Core.hostile()) { const car = units('cruiser').find(c => c.occ.length && Core.paInRange(c.x, c.y)); if (car && !car.orders.length && S.turn % 2 === 0) Core.queueOrder(car.uid, { type: 'pa', mode: 'contact' }); }
      // walk-out protocol: entry team takes cover near the walk-out point
      if (sp.walk && sp.walk.stage !== 'kneel') { const [x, y] = Core.surrSpot(); for (const t of units('team')) if (!t.perch && !t.orders.length && Math.hypot(t.x - x, t.y - y) > 9) Core.queueOrder(t.uid, { type: 'move', x: x + (S.ems.x > x ? 6 : -6), y }); }
      // casualties: patrol (or a free team) evacuates known casualties
      for (const c of S.cas) { if (!Core.casActive(c) || !c.known || c.carrier || c.who === 'suspect') continue;
        const outside = Core.roomAt(c.x, c.y) < 0; const h = units(outside ? 'patrol' : 'team').filter(u => !u.inCar && !u.orders.length && !u.perch && !u.carrying).sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
        if (h && !S.units.some(u => u.orders.some(o => o.cas === c.id))) Core.queueOrder(h.uid, { type: 'evac', cas: c.id }); }
    }
    for (const t of units('team')) {
      if (t.orders.length) continue;
      if (Core.hasSpec(t, 'marksman') && t.members.length <= 2 && kind === 'competent') { if (!t.perch) { const best = S.perches.slice().sort((a, b) => b.sightLines - a.sightLines)[0]; if (best) Core.queueOrder(t.uid, { type: 'overwatch', perch: best.id }); Core.setStance(t.uid, 'free'); }
        else if (sp.visible) Core.queueOrder(t.uid, { type: 'shoot', mode: 'fire', x: sp.x, y: sp.y }); continue; }
      if (kind === 'competent' && S.turn < (Core.negoSummary().contact ? 11 : 7) && !['surrendered', 'incapacitated'].includes(sp.mode)) continue;
      if (sp.walk) continue;
      // entry: front door → suspect room door → bang → clear
      const fd = S.doors.find(d => d.name === 'Front Door'), rd = S.doors.find(d => d.rooms.includes(sp.room) && d.barricaded) || S.doors.find(d => d.rooms.includes(sp.room));
      if (fd.state === 'closed') Core.queueOrder(t.uid, { type: 'breach', door: fd.id });
      if (rd && rd.state === 'closed' && !rd.exterior) Core.queueOrder(t.uid, { type: 'breach', door: rd.id });
      if (kind === 'competent' && t.equip.bang > 0) Core.queueOrder(t.uid, { type: 'bang', room: sp.room >= 0 ? sp.room : 0 });
      if (sp.room >= 0) Core.queueOrder(t.uid, { type: 'clear', room: sp.room });
    }
  };
}
function play(seed, kind) {
  const S = Core.newGame(seed); const step = policy(kind); let guard = 0;
  while (S.phase !== 'over' && guard++ < 40) { step(); runTurn(); }
  return { win: !!(Core.state.result && Core.state.result.win), title: Core.state.result ? Core.state.result.title : 'n/a', turns: Core.state.turn, down: Core.state.stats.down, method: Core.state.stats.method, kia: Core.state.stats.kia, lost: Core.state.stats.lost, amb: !!Core.state.nego.ambush };
}
if (process.env.ONE) { for (let i = 1; i <= 12; i++) { const r = play(1000 + i * 37, 'competent'); const S = Core.state; console.log(i, r.title, r.method, S.cas.map(c => c.who + ':' + c.state + (c.carrier ? '*' : '') + '@' + c.x + ',' + c.y + ' ' + (c.known ? 'K' : '?')).join(' | ')); } process.exit(0); }
if (NB > 0) {
  const res = {};
  for (const kind of (process.env.KINDS || 'competent,passive,reckless').split(',')) { let w = 0, down = 0, turns = 0; const titles = {}, methods = {};
    let kia = 0, lost = 0, amb = 0;
    for (let i = 1; i <= NB; i++) { const r = play(1000 + (i + (+process.env.OFF || 0)) * 37, kind); if (r.win) { w++; methods[r.method] = (methods[r.method] || 0) + 1; } down += r.down; turns += r.turns; kia += r.kia; lost += r.lost; amb += r.amb; titles[r.title] = (titles[r.title] || 0) + 1; }
    console.log(`  ${kind}: KIA ${kia}, lost ${lost}, ambushes ${amb}`);
    res[kind] = w / NB; console.log(`BALANCE ${kind.padEnd(9)} win ${(100 * w / NB).toFixed(0)}%  avg officers down ${(down / NB).toFixed(2)}  avg turns ${(turns / NB).toFixed(1)}  ${JSON.stringify(titles)} ${JSON.stringify(methods)}`); }
  const ok = res.competent >= 0.6 && res.competent <= 0.97 && res.passive <= 0.2 && res.reckless <= res.competent - 0.25;
  console.log(ok ? 'BALANCE OK: winnable but not trivial' : 'BALANCE OUT OF BAND'); if (!ok) process.exitCode = 2;
}
if (fail) process.exitCode = 1;
