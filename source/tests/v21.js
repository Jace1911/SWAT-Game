// v21 (batch 2, items 18-25): rifle left at the vehicle by shield / 40mm officers, no plate draw, personal flashbang + pole cam hands,
//   drop shield / ram, breacher wall charges (hole / gun port), 40mm vs cameras, suspect fire at drones / robots, K9 send + door sniff.
const fs = require('fs'), path = require('path');
const Core = require('./load.js')(); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const prep = (seed, extra = {}) => { const S = Core.newGame(seed, Object.assign({ encounters: false }, extra)); S.officers.forEach(o => { o.status = 'staged'; o.stage = 'primary'; o.eta = 0; }); return S; };
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const team = (S, n = 4, pred) => Core.formTeam((pred ? S.officers.filter(pred).concat(S.officers.filter(o => !pred(o))) : S.officers).slice(0, n).map(o => o.id)).team;
const force = (S, v, fn) => { const c = S.rng.chance; S.rng.chance = () => v; try { return fn(); } finally { S.rng.chance = c; } };
const GORE = /blood|gore|brain|guts|splatter|gush|mangled|severed|maul/i;

ok(Core.GAME_VERSION === 'v21' && (html.match(/'v21'/g) || []).length === 1, 'GAME_VERSION v21 defined once');
ok(/apple-touch-icon/.test(html) && /apple-mobile-web-app-capable/.test(html), 'iOS meta kept');
ok(['Personal kit, drops', 'Wall charges, cameras', 'K9 (v21)'].every(h => html.includes(h)), 'help sections (v21)');
ok(/data-ldrop/.test(html) && /data-v21/.test(html) && /Actions here/.test(html), 'Drop button + team actions UI');
{ const m = html.match(/HB\('(Personal kit|Wall charges|K9)[\s\S]*?\)\}/g) || []; ok(m.length === 3 && m.every(t => !GORE.test(t)), 'v21 help wording neutral'); }

// --- 18: shield / 40mm officers leave the rifle at the vehicle; slung rifle -10% ---
{ const S = prep(3); const L = S.officers.filter(o => Core.rifleLeaver(o)); ok(L.length > 0, 'some shield / 40mm officers (' + L.length + ')');
  ok(L.every(o => !Core.carries(o, 'rifle') && o.inv.rifleLeft), 'rifle left at the vehicle');
  ok(S.officers.filter(o => !Core.rifleLeaver(o)).every(o => o.spec === 'marksman' ? Core.carries(o, 'sniper') : Core.carries(o, 'rifle')), 'others still carry a rifle');
  ok(L.every(o => Core.invOf(o).hands.some(Boolean)), 'leavers hold something (shield / launcher / pistol)');
  const a = L[0], t = team(S, 1, o => o === a); const s0 = Core.teamSkill(t);
  ok(Core.invAct(a.id, 'draw', 'rifle').ok && Core.carries(a, 'rifle') && Core.rifleBurden(a), 'can take the rifle at the vehicle');
  ok(Math.abs(Core.teamSkill(t) - Math.min(1, s0 * 0.9 + (Core.hasSpec(t, 'leader') ? 0.05 * 0.1 : 0))) < 0.011, `slung rifle costs 10% (${s0.toFixed(3)} → ${Core.teamSkill(t).toFixed(3)})`);
  ok(!Core.invAct(a.id, 'draw', 'rifle').ok, 'only one rifle');
  ok(Core.invAct(a.id, 'return', 'rifle').ok && !Core.carries(a, 'rifle') && Math.abs(Core.teamSkill(t) - s0) < 1e-9, 'leave it again → full skill');
  t.deployed = true; t.x += 12; ok(!Core.invAct(a.id, 'draw', 'rifle').ok, 'rifle only at the vehicle'); }

// --- 19: plates are worn, not drawn ---
{ ok(/k !== 'plate' &&/.test(html), 'plate not listed in the vehicle pool'); }

// --- 20: flashbangs + pole cam ---
{ const S = prep(5); ok(S.officers.every(o => Core.countOf(o, 'bang') >= 1), 'everyone carries a flashbang');
  const o = S.officers.find(q => !Core.rifleLeaver(q) && !q.spec2 || q.spec === 'medic'); const t = team(S, 2, q => q === o || q.spec === 'tech'); S.armory.bang = 9; let n = 0;
  for (let i = 0; i < 4; i++) if (Core.invAct(o.id, 'draw', 'bang').ok) n++;
  ok(Core.countOf(o, 'bang') === 3 && n === 2, `max 3 flashbangs (${Core.countOf(o, 'bang')})`);
  ok(Core.invAct(o.id, 'return', 'bang').ok && Core.countOf(o, 'bang') === 2 && !Core.invAct(o.id, 'return', 'bang').ok === false, 'drawn ones can be returned');
  ok(!Core.invAct(o.id, 'return', 'bang').ok && Core.countOf(o, 'bang') === 1, 'personal flashbang stays');
  ok(Core.ITEM_CFG.polecam.hands === 1, 'pole cam carried in one hand');
  S.armory.polecam = 2; const d = Core.invAct(o.id, 'draw', 'polecam'); const p = Core.polecamHands(t);
  ok(d.ok && p && Core.invView(p).notReady.length > 0, 'working the pole cam puts the weapon away (not ready) — ' + (p && p.name));
  ok(/works the pole cam \(both hands\)/.test(html), 'pole cam log names the operator'); }

// --- 21: drop shield / ram, pick up within 2 m ---
{ const S = prep(6); const sh = S.officers.find(o => Core.holds(o, 'shield') || Core.holds(o, 'shield3'));
  if (sh) { const t = team(S, 2, q => q === sh); t.deployed = true; const k = Core.holds(sh, 'shield') ? 'shield' : 'shield3';
    const A = Core.v21Actions(t.uid).filter(a => a.act === 'drop'); ok(A.length && A[0].icon === '⛨', 'drop action with icon');
    ok(Core.v21Do(t.uid, 'drop', sh.id, k).ok && !Core.holds(sh, k) && S.dropped.length === 1, 'shield dropped');
    const dn = Core.droppedNear(t.uid); ok(dn.length === 1 && Core.pickUp(t.uid, dn[0].i).ok && Core.carries(sh, k), 'picked up within 2 m'); }
  else ok(false, 'no shield officer');
  const br = S.officers.find(o => Core.holds(o, 'ram')); if (br) { const t2 = team(S, 1, q => q === br); t2.deployed = true; ok(Core.v21Actions(t2.uid).some(a => a.act === 'drop' && a.icon === '⚒'), 'ram drop icon'); } }

// --- 22: wall charges ---
const wallSpot = S => { for (let y = 1; y < Core.MAP_H - 1; y++) for (let x = 1; x < Core.MAP_W - 1; x++) { if (Core.roomAt(x, y) !== -1 || S.block[Core.idx(x, y)]) continue;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const nx = x + dx, ny = y + dy; if (Core.roomAt(nx, ny) >= 0 && Core.edge(x, y, nx, ny).t === 'X' && !S.block[Core.idx(nx, ny)]) return [x, y, nx, ny]; } } return null; };
{ let hole = 0, port = 0, tried = 0, held = 0, fails = 0;
  for (let seed = 1; seed <= 6; seed++) { const S = prep(seed * 7); const b = S.officers.find(o => o.spec === 'breacher'); const t = team(S, 4, q => q === b); S.armory.charge = 4;
    Core.invAct(b.id, 'draw', 'charge'); Core.invAct(b.id, 'draw', 'charge'); Core.syncEquip && Core.syncEquip(t); const w = wallSpot(S); if (!w || !(t.equip.charge > 0)) continue; tried++;
    t.deployed = true; t.x = w[0]; t.y = w[1]; S.phase = 'planning';
    const sp = Core.wallSpotsFor(t.uid); const i = sp.findIndex(q => q.b[0] === w[2] && q.b[1] === w[3]);
    if (seed === 1) { const r = force(S, false, () => Core.wallCharge(t.uid, 'hole', i)); if (r.ok && !r.made && Core.edge(w[0], w[1], w[2], w[3]).t === 'X') fails++; continue; }
    const r = force(S, true, () => Core.wallCharge(t.uid, 'hole', i)); const e = Core.edge(w[0], w[1], w[2], w[3]);
    if (r.ok && r.made && e.t === 'D' && e.d.kind === 'hole' && e.d.state === 'open' && Core.passE(e, {}) && S.doors.includes(e.d)) hole++;
    const sp2 = Core.wallSpotsFor(t.uid); if (sp2.length && t.equip.charge > 0) { const q = sp2[0]; const r2 = force(S, true, () => Core.wallCharge(t.uid, 'port', 0)); const e2 = Core.edge(q.a[0], q.a[1], q.b[0], q.b[1]);
      if (r2.ok && r2.made && e2.t === 'P' && !Core.seeE(q.a[0], q.a[1], q.b[0], q.b[1]) && !Core.passE(e2, {})) { const s1 = Core.suspList()[0]; s1.x = q.b[0]; s1.y = q.b[1];
        const pf = Core.v21Actions(t.uid).filter(a => a.act === 'pfire'); const f = Core.portFire(t.uid, r2.port.id, t.members[1]);
        if (pf.length && f.ok && Core.edge(q.a[0], q.a[1], q.b[0], q.b[1]).t === 'P' && t.x === w[0] && t.y === w[1]) port++; } } }
  ok(tried >= 4 && hole === tried - 1, `through-wall hole works like an open door (${hole}/${tried - 1})`);
  ok(port >= 2, `gun port: blocks sight / passage, a chosen member fires through (${port})`);
  ok(fails === 1, 'a failed charge leaves the wall');
  const S = prep(9); const t = team(S, 3, o => o.spec !== 'breacher'); t.deployed = true; const w = wallSpot(S); t.x = w[0]; t.y = w[1];
  ok(!Core.wallCharge(t.uid, 'hole', 0).ok, 'needs a breacher');
  ok(Core.V21.wallP === 0.9 && Core.V21.portP === 0.9, '90% success'); }

// --- 23: cameras ---
{ let done = 0, hits = 0, tries = 0;
  for (let seed = 1; seed <= 30 && done < 3; seed++) { const S = prep(seed * 5 + 2, { stype: 'drughouse' }); if (!S.cams || !S.cams.length) continue;
    const ll = S.officers.find(o => Core.countOf(o, 'lesslethal') > 0); if (!ll) continue; const t = team(S, 2, q => q === ll); t.deployed = true; const c = S.cams[0];
    let spot = null; for (let r = 4; r <= 12 && !spot; r++) for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r && !spot; dx++) { const x = c.x + dx, y = c.y + dy;
      if (x >= 0 && y >= 0 && x < Core.MAP_W && y < Core.MAP_H && Core.roomAt(x, y) === -1 && !S.block[Core.idx(x, y)] && Core.los(x, y, c.x, c.y) === 1) spot = [x, y]; }
    if (!spot) continue; t.x = spot[0]; t.y = spot[1]; done++;
    const T = Core.camTargets(t.uid).find(q => q.id === c.id); ok(T && T.p <= 0.22 && T.p >= 0.08, 'camera target listed, hard to hit ' + (T && T.p.toFixed(2)));
    const r0 = Core.countOf(ll, 'lesslethal') ; const before = Core.invView(ll).ll; const r = force(S, true, () => Core.shootCam(t.uid, c.id)); if (r.ok && r.hit && c.dead && !Core.camSees(c, c.x + c.dx, c.y + c.dy)) hits++;
    ok(Core.invView(ll).ll === before - 1 || before == null, 'spends a 40mm round');
    for (let i = 0; i < 200; i++) if (S.rng.chance(Core.camHitP(10))) tries++; }
  ok(done >= 2 && hits === done, `camera knocked out (${hits}/${done})`); ok(tries < 70 * done, 'low hit chance (' + tries + '/' + 200 * done + ' at 10 m)');
  const S = prep(11); const t = team(S, 2, o => Core.countOf(o, 'lesslethal') === 0); t.deployed = true; ok(Core.camTargets(t.uid).length === 0, 'no 40mm / shotgun → no camera shot'); }

// --- 24: suspect fire at devices ---
ok(Core.deviceHitP({ kind: 'robot' }, 0.5) === 0.5 && Core.deviceHitP({ kind: 'drone' }, 0.5) <= 0.15 && Core.deviceHitP({ kind: 'drone', landed: true }, 0.4) === 0.4, 'drone much harder; robot like a person in the open');
ok(/deviceHitP\(T, p\)/.test(html), 'suspect fire uses device odds');

// --- 25: K9 ---
{ const S = prep(13); const h = S.officers.find(o => o.spec === 'k9'); ok(h && h.dog && !h.spec2, 'K9 handler has a dog and no second specialty');
  ok(!Core.SPEC2_POOL || !Core.SPEC2_POOL.includes('k9'), 'k9 never a second specialty');
  let sent = 0, sniffed = 0, miss = 0, far = 0;
  for (let seed = 1; seed <= 12; seed++) { const S = prep(seed * 3 + 1); const h = S.officers.find(o => o.spec === 'k9'); if (!h) continue; const t = team(S, 2, q => q === h); t.deployed = true;
    S.doors.forEach(d => { d.state = 'open'; }); const sp = Core.suspList()[0]; const r = S.rooms[sp.room]; const d = S.doors.find(q => q.cells.some(([a, b]) => Core.roomAt(a[0], a[1]) === sp.room || Core.roomAt(b[0], b[1]) === sp.room)); if (!d) continue;
    const [[a, b]] = d.cells, outC = Core.roomAt(a[0], a[1]) === sp.room ? b : a; t.x = outC[0]; t.y = outC[1];
    const T = Core.dogTargets(t.uid); if (T.some(q => q.room === sp.room)) { const res = force(S, true, () => Core.dogSend(t.uid, sp.room)); if (res.ok && res.found && res.held && sp.stun >= 2) sent++; ok(!Core.dogSend(t.uid, sp.room).ok, 'dog once per turn'); }
    if (Core.sniffDoors(t.uid).includes(d)) { if (force(S, true, () => Core.dogSniff(t.uid, d.id)).found) sniffed++; }
    const other = S.rooms.findIndex((q, i) => i !== sp.room && !Core.suspList().some(s => s.room === i)); if (other >= 0 && Core.dogTargets(t.uid).some(q => q.room === other)) { h.dogTurn = -1; if (!force(S, true, () => Core.dogSend(t.uid, other)).found) miss++; }
    t.x = 1; t.y = 1; if (!Core.dogTargets(t.uid).some(q => Core.dist(1, 1, S.rooms[q.room].x, S.rooms[q.room].y) > 27)) far++; }
  ok(sent >= 4, `dog sent: barks + hold (${sent})`); ok(sniffed >= 4, `door sniff detects (${sniffed})`); ok(miss >= 2, `empty room: no indication (${miss})`); ok(far >= 4, '25 m limit');
  ok(Core.V21.sniffP === 0.75 && Core.V21.dogRange === 25, 'sniff 75%, send ≤ 25 m');
  { const S = prep(14); const h = S.officers.find(o => o.spec === 'k9'); const t = team(S, 1, q => q === h); t.deployed = true; const sp = Core.suspList()[0]; const d = S.doors.find(q => q.cells.some(([a, b]) => Core.roomAt(a[0], a[1]) === sp.room || Core.roomAt(b[0], b[1]) === sp.room));
    if (d) { const [[a, b]] = d.cells, o2 = Core.roomAt(a[0], a[1]) === sp.room ? b : a; t.x = o2[0]; t.y = o2[1]; let n = 0; for (let i = 0; i < 400; i++) { h.sniffTurn = -1; if (Core.dogSniff(t.uid, d.id).found) n++; } ok(n > 260 && n < 340, `sniff ≈ 75% (${n}/400)`); }
  }
  ok(S.log.concat([]).every(l => !GORE.test(l.text || l.msg || '')), 'neutral K9 wording'); }

console.log(`v21: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
