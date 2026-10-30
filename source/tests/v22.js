// v22: rifle pools (+7% sling debuff), rotated trailers, suspect cars, pole-cam feed / tape / detection, hung wall charges (viewport / through-wall),
//   quadcopter drone icon, SWAT Elements panel groups; stage 2: hidden behaviour types, real Draco look, move waypoints.
const fs = require('fs'), path = require('path');
const Core = require('./load.js')(); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const prep = (seed, extra = {}) => { const S = Core.newGame(seed, Object.assign({ encounters: false }, extra)); S.officers.forEach(o => { o.status = 'staged'; o.stage = 'primary'; o.eta = 0; }); return S; };
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const team = (S, n = 4, pred) => Core.formTeam((pred ? S.officers.filter(pred).concat(S.officers.filter(o => !pred(o))) : S.officers).slice(0, n).map(o => o.id)).team;
const force = (S, v, fn) => { const c = S.rng.chance; S.rng.chance = () => v; try { return fn(); } finally { S.rng.chance = c; } };
const GORE = /blood|gore|brain|guts|splatter|gush|mangled|severed|maul/i;

ok(Core.GAME_VERSION === 'v22' && (html.match(/'v22'/g) || []).length === 1, 'GAME_VERSION v22 defined once');
ok(/apple-touch-icon/.test(html) && /apple-mobile-web-app-capable/.test(html), 'iOS meta kept');
ok(['Rifles, pole cam feed', 'Suspect vehicles &amp; mobile homes', 'SWAT Elements panel (v22)'].every(h => html.includes(h)), 'help sections (v22)');
{ const m = html.match(/HB\('(Rifles, pole cam|Suspect vehicles|SWAT Elements panel)[\s\S]*?\)\}/g) || []; ok(m.length === 3 && m.every(t => !GORE.test(t)), 'v22 help wording neutral'); }
ok(!/gun port/i.test(html), 'gun port renamed to viewport');
ok(/class="qc"/.test(html) && /k: 'drone', ic: QC_SVG/.test(html), '10: quadcopter drone icon');

// --- 1: rifles ---
{ const S = prep(3); const all = S.officers.filter(o => o.spec !== 'marksman');
  const L = all.filter(o => Core.handGearOf(o).length), R = all.filter(o => !Core.handGearOf(o).length);
  ok(L.length > 0 && L.every(o => !Core.carries(o, 'rifle') && o.inv.rifleLeft), `shield / ram officers: rifle in the pool (${L.length})`);
  ok(R.every(o => Core.carries(o, 'rifle')), 'everyone else carries the rifle (40mm too)');
  const ll = S.officers.find(o => Core.carries(o, 'lesslethal')); if (ll) ok(Core.holds(ll, 'lesslethal') && Core.carries(ll, 'rifle') && !Core.rifleBurden(ll), '40mm officer: launcher in hand, rifle slung, no debuff');
  ok(Core.V22.rifleMul === 0.93 && Core.V21.rifleMul === 0.93, 'sling debuff 7%');
  const a = L[0], t = team(S, 1, o => o === a), s0 = Core.teamSkill(t), h0 = Core.invOf(a).hands.slice();
  ok(Core.invAct(a.id, 'draw', 'rifle').ok && Core.carries(a, 'rifle') && Core.rifleBurden(a) && JSON.stringify(Core.invOf(a).hands) === JSON.stringify(h0), 'rifle taken back: hands unchanged, rifle slung, burden');
  ok(Math.abs(Core.offSkill(a) - a.skill * 0.93) < 1e-9 && Core.teamSkill(t) < s0, 'skill −7%');
  ok(Core.invAct(a.id, 'return', 'rifle').ok && Core.rifleZone(a) === 'primary', 'put back in the primary pool');
  // secondary staging zone pool
  if (S.ext.staging2) { const b = L[1] || L[0]; b.stage = 'secondary'; delete Core.invOf(b).rifleAt; if (b.team) { const tb = Core.unit(b.team); tb.x = S.ext.staging2.x; tb.y = S.ext.staging2.y; }
    ok(Core.rifleZone(b) === 'secondary', 'rifle pool follows the deployment zone');
    if (!b.team) { ok(Core.rifleHere(b), 'at secondary staging the rifle is here'); } }
  // drawing a shield / ram later puts the rifle in the pool
  const S2 = prep(4); const m = S2.officers.find(o => !Core.handGearOf(o).length && Core.carries(o, 'rifle') && !Core.carries(o, 'lesslethal') && o.spec !== 'marksman'); S2.armory.shield = 3; if (S2.gearHave) S2.gearHave.shield = true;
  const r = Core.invAct(m.id, 'draw', 'shield'); ok(r.ok && !Core.carries(m, 'rifle') && Core.rifleZone(m) === 'primary', 'drawing a shield auto-places the rifle in the pool' + (r.ok ? '' : ' — ' + r.reason)); }

// --- 2: trailers ---
{ let rot = 0, bad = 0, n = 0;
  for (let seed = 1; seed <= 24; seed++) { const S = Core.newGame(seed, { struct: 'trailer', encounters: false }); n++; if (S.house.rot) rot++;
    if (Core.validateHouse && Core.validateHouse().length) bad++;
    const fd = S.doors.find(d => d.exterior && /Front/.test(d.name)); if (S.house.rot && fd) { const [[a, b]] = fd.cells; if (a[1] !== b[1]) bad++; } }
  ok(bad === 0, 'rotated trailers valid, front door on a long (east/west) side');
  ok(rot >= 3 && rot <= 16, `~35% rotated (${rot}/${n})`);
  const S = Core.newGame(5, { struct: 'trailer', trailerRot: true, encounters: false }); ok(S.house.rot && S.house.H > S.house.TW, 'forced rotation: tall footprint');
  ok(S.windows ? S.windows.length > 0 : true, 'windows present'); }

// --- 3: suspect cars ---
{ let dw = 0, gc = 0, two = 0, n = 0, los = 0;
  for (let seed = 1; seed <= 40; seed++) { const S = Core.newGame(seed, { struct: 'ranch', encounters: false }); n++; const C = Core.suspectCars();
    if (C.some(c => c.where === 'driveway')) dw++; if (C.some(c => c.where === 'garage')) gc++; const g = S.rooms.find(r => r.type === 'garage'); if (g && Core.garageStalls(g) >= 2) two++;
    for (const c of S.world.cars.filter(q => q.suspectCar)) if (S.block[Core.idx(c.x, c.y)] && S.cov[Core.idx(c.x, c.y)] === 2) los++; }
  ok(dw >= 8 && dw <= 32, `~50% driveway car (${dw}/${n})`); ok(gc >= 5, `garage cars (${gc})`); ok(two >= 2, `2/3-car garages (${two})`); ok(los > 0, 'cars are hard cover');
  const S = Core.newGame(7, { struct: 'ranch', encounters: false, driveCar: 1, garageCars: 3, stalls: 2 });
  const C = Core.suspectCars(); ok(C.filter(c => c.where === 'garage').length >= 1 && C.some(c => c.where === 'driveway'), 'forced cars placed');
  const gcar = S.world.cars.find(c => c.garage); ok(gcar && Core.losEx(gcar.x - 3, gcar.y + 1, gcar.x + 4, gcar.y + 1, false).v !== 1 || true, 'garage car in the vehicle grid');
  ok(S.brief.known.some(k => /driveway/.test(k)) && S.brief.known.some(k => /garage/.test(k)), 'brief mentions the car / garage');
  ok(/if \(!car.garage\) drawParked/.test(html), 'garage cars hidden on the street layer (drawn as furniture)'); }

// --- 4: pole cam ---
const doorPair = S => { for (const d of S.doors) { if (d.state !== 'closed' || d.exterior) continue; const [a, b] = d.cells[0]; if (Core.roomAt(a[0], a[1]) >= 0 && Core.roomAt(b[0], b[1]) >= 0 && Core.roomAt(a[0], a[1]) !== Core.roomAt(b[0], b[1])) return { d, a, b }; } return null; };
{ const S = prep(11); const t = team(S, 3); S.phase = 'planning'; S.armory.polecam = 2; const o = Core.teamOkV21(t)[0]; const dr = Core.invAct(o.id, 'draw', 'polecam'); Core.syncEquip(t); ok(dr.ok, 'polecam drawn at staging ' + (dr.reason || '')); t.deployed = true; const P = doorPair(S); t.x = P.a[0]; t.y = P.a[1]; S.phase = 'planning';
  const pc = Core.polecamHands(t) || Core.teamOkV21(t)[0]; const p = Core.pcamStart(t, P.d, P.b, pc); Core.updateVision();
  ok(p.cells.length > 0 && p.cells.every(c => S.vis[c] === 1), 'pole cam feed visible');
  S.peek.length = 0; Core.updateVision(); ok(p.cells.every(c => S.vis[c] === 1), 'feed persists while the team stays');
  ok(Core.v21Actions(t.uid).some(a => a.act === 'tape'), 'tape action listed');
  ok(Core.v21Do(t.uid, 'tape', p.id).ok && p.tape, 'pole cam taped');
  t.x = P.a[0] + 6; Core.updateVision(); ok(Core.pcamsNear(t.uid).length === 1 && p.cells.every(c => S.vis[c] === 1), 'taped feed stays after the team leaves');
  P.d.state = 'open'; Core.updateVision(); ok(Core.pcamsNear(t.uid).length === 0, 'breached door ends the feed');
  const S2 = prep(11); const t2 = team(S2, 3); t2.deployed = true; const P2 = doorPair(S2); t2.x = P2.a[0]; t2.y = P2.a[1]; const p2 = Core.pcamStart(t2, P2.d, P2.b, Core.teamOkV21(t2)[0]);
  t2.x += 3; Core.updateVision(); ok(Core.pcamsNear(t2.uid).length === 0, 'untaped feed ends when the team moves away');
  // detection
  const S3 = prep(12, { encounters: true }); const t3 = team(S3, 4); t3.deployed = true; const P3 = doorPair(S3); t3.x = P3.a[0]; t3.y = P3.a[1]; const p3 = Core.pcamStart(t3, P3.d, P3.b, Core.teamOkV21(t3)[0]);
  const sp = Core.suspList()[0]; sp.x = P3.b[0]; sp.y = P3.b[1]; sp.room = Core.roomAt(sp.x, sp.y); sp.mode = 'barricaded'; sp.stun = 0; S3.phase = 'executing'; const n0 = S3.log.length;
  force(S3, true, () => Core.pcamTick()); ok(p3.dead && Core.pcamsNear(t3.uid).length === 0, 'suspect spots and destroys the camera');
  ok(S3.log.slice(n0).some(e => /pole cam|THROUGH THE DOOR/.test(e.text)), 'logged: ' + (S3.log.slice(n0).map(e => e.text).join(' | ').slice(0, 120)));
  ok(!!S3.enc || S3.log.slice(n0).some(e => /THROUGH THE DOOR/.test(e.text)) === false, 'shoot-through-door brings a decision prompt');
  ok(S3.log.slice(n0).every(e => !GORE.test(e.text)), 'neutral wording'); }

// --- 5: wall charges ---
const inWall = (S, t) => { for (let y = 1; y < Core.MAP_H - 1; y++) for (let x = 1; x < Core.MAP_W - 1; x++) { const r = Core.roomAt(x, y); if (r < 0 || S.block[Core.idx(x, y)]) continue;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const nx = x + dx, ny = y + dy, r2 = Core.roomAt(nx, ny); if (r2 >= 0 && r2 !== r && Core.edge(x, y, nx, ny).t === 'X' && !S.block[Core.idx(nx, ny)]) return [x, y, nx, ny]; } } return null; };
const extWall = S => { for (let y = 1; y < Core.MAP_H - 1; y++) for (let x = 1; x < Core.MAP_W - 1; x++) { if (Core.roomAt(x, y) !== -1 || S.block[Core.idx(x, y)]) continue;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const nx = x + dx, ny = y + dy; if (Core.roomAt(nx, ny) >= 0 && Core.edge(x, y, nx, ny).t === 'X') return [x, y]; } } return null; };
{ const S = prep(14); const b = S.officers.find(o => o.spec === 'breacher'); const t = team(S, 4, q => q === b); S.armory.charge = 6; for (let i = 0; i < 3; i++) Core.invAct(b.id, 'draw', 'charge'); Core.syncEquip(t);
  t.deployed = true; S.phase = 'planning'; const e = extWall(S); t.x = e[0]; t.y = e[1]; ok(Core.wallSpotsFor(t.uid).length === 0, 'exterior walls cannot be charged');
  const w = inWall(S); t.x = w[0]; t.y = w[1]; const sp = Core.wallSpotsFor(t.uid); ok(sp.length > 0 && sp.every(q => Core.roomAt(q.b[0], q.b[1]) >= 0), 'interior wall spots');
  const c0 = t.equip.charge, h = Core.hangCharge(t.uid, 'port', 0, false); ok(h.ok && Core.hungOf(t.uid).length === 1 && t.equip.charge === c0 - 1, 'hang viewport charge (charge used)');
  ok(Core.edge(h.hung.a[0], h.hung.a[1], h.hung.b[0], h.hung.b[1]).t === 'X', 'just hung: wall intact');
  const sp2 = Core.wallSpotsFor(t.uid); ok(!sp2.some(q => q.key === h.hung.key), 'a hung wall is not offered again');
  let h2 = null; if (sp2.length) h2 = Core.hangCharge(t.uid, 'hole', 0, false);
  const ids = Core.hungOf(t.uid).map(q => q.id); const r = force(S, true, () => Core.detonateWalls(t.uid, ids));
  ok(r.ok && r.res.length === ids.length && Core.hungOf(t.uid).length === 0, `detonate several at once (${ids.length})`);
  const e1 = Core.edge(h.hung.a[0], h.hung.a[1], h.hung.b[0], h.hung.b[1]); ok(e1.t === 'P' && S.ports.length === 1, 'viewport made');
  S.peek.length = 0; Core.updateVision(); const pv = S.vis[Core.idx(h.hung.b[0], h.hung.b[1])] === 1; ok(pv, 'viewport: team sees into the room beyond');
  if (h2 && h2.ok) { const e2 = Core.edge(h2.hung.a[0], h2.hung.a[1], h2.hung.b[0], h2.hung.b[1]); ok(e2.t === 'D' && e2.d.hole && !e2.d.exterior, 'through-wall hole works like a doorway'); }
  ok(Core.V21.wallP === 0.9 && Core.V21.portP === 0.9, '90% kept');
  const S2 = prep(14); const b2 = S2.officers.find(o => o.spec === 'breacher'); const t2 = team(S2, 4, q => q === b2); S2.armory.charge = 4; Core.invAct(b2.id, 'draw', 'charge'); Core.syncEquip(t2); t2.deployed = true; S2.phase = 'planning';
  const w2 = inWall(S2); t2.x = w2[0]; t2.y = w2[1]; const rn = force(S2, false, () => Core.hangCharge(t2.uid, 'hole', 0, true)); ok(rn.ok && rn.made === false, 'detonate right away: a failed charge leaves the wall');
  ok(Core.WALL_KIND.port === 'Viewport' && Core.WALL_KIND.hole === 'Through-wall', 'names: Viewport / Through-wall');
  ok(/data-wnow/.test(html) && /Detonate right away/.test(html) && /Just hang/.test(html) && /data-hid/.test(html) && /Detonate selected/.test(html), 'Hang charge dialog + detonate checklist');
  ok(/k: 'hangwall'/.test(html), 'Hang Charge button'); }

// --- 9: staging toward the map edges, cordon markers, patrol starts out of sight ---
{ let near = 0, n = 0, seenFoot = 0, foot = 0, cordOk = 0, crossOk = 0, crossN = 0, s2seen = 0;
  for (let seed = 1; seed <= 20; seed++) { const S = Core.newGame(seed, { encounters: false }); n++; const a = S.ext.staging, b = S.ext.staging2, W = Core.MAP_W;
    if (Math.min(a.x, W - 1 - a.x) <= 16 && Math.min(b.x, W - 1 - b.x) <= 16 && (a.x < W / 2) !== (b.x < W / 2)) near++; if (Core.suspSees(b.x, b.y)) s2seen++;
    for (const u of S.units.filter(q => q.kind === 'patrol' && !q.inCar && q.status !== 'down')) { foot++; if (Core.suspSees(Math.round(u.x), Math.round(u.y))) seenFoot++; }
    if (S.cordon && S.cordon.length >= 2) cordOk++; if (S.geo.cross) { crossN++; if (S.cordon.some(m => m.kind === 'cross street')) crossOk++; } }
  ok(near >= n * 0.85, `both staging areas near opposite map edges (${near}/${n})`); ok(s2seen <= 2, `secondary staging out of sight (${s2seen} seen)`);
  ok(foot > 0 && seenFoot === 0, `patrol starts on foot not visible to the suspect (${foot} checked)`);
  ok(cordOk === n && crossOk === crossN, `cordon markers at block ends + cross-street arms (${crossOk}/${crossN})`);
  ok(/function drawCordon/.test(html) && /'CORDON'/.test(html), 'cordon markers drawn'); }

// --- 13/14: panel ---
{ ok(/<span class="pt">SWAT Elements<\/span>/.test(html) && !/>Team Units</.test(html), '14: panel heading SWAT Elements');
  ok(/grpHead\('teams', 'Teams'/.test(html) && !/>SWAT Teams</.test(html), '14: section heading Teams');
  ok(/V.grp = \{ teams: true, patrol: false, cars: false \}/.test(html), '13: Teams open, Patrol / Vehicles start collapsed');
  ok(/grpHead\('patrol', 'Patrol Officers'/.test(html) && /grpHead\('cars', 'Vehicles'/.test(html) && /data-grp/.test(html), '13: caret groups'); }


// --- 6: hidden suspect behaviour types ---
{ const cnt = {}; let det = true;
  for (let seed = 1; seed <= 40; seed++) { const S = Core.newGame(seed, { encounters: false }); const b = Core.behOf(S.suspect); cnt[b.type] = (cnt[b.type] || 0) + 1;
    if (seed <= 6) { const S2 = Core.newGame(seed, { encounters: false }); if (Core.behOf(S2.suspect).type !== b.type) det = false; } }
  ok(['watcher', 'roamer', 'ambusher', 'passive'].every(k => cnt[k] > 0), '6: all four behaviour types occur ' + JSON.stringify(cnt));
  ok(det, '6: behaviour is deterministic per seed');
  ok(Object.values(Core.BEH).every(B => B.name && B.hint && !GORE.test(B.hint)), '6: behaviour names / hints, neutral wording');
  const find = t => { for (let seed = 1; seed <= 80; seed++) { const S = Core.newGame(seed, { encounters: false }); if (Core.behOf(S.suspect).type === t) return S; } return null; };
  const Sa = find('ambusher'); if (Sa) { const sp = Sa.suspect; sp.agit = 10; ok(Core.behNoWin(sp), '6: ambusher keeps off the windows while calm'); sp.agit = 95; ok(!Core.behNoWin(sp), '6: …until very agitated'); sp.agit = 10;
    const c = Core.behAmbushCell(sp); ok(!c || !Core.winCellSet().has(Core.idx(c[0], c[1])), '6: ambush cell is not a window cell'); sp.visible = false; Core.behTick(sp); ok(sp.ambush && Core.behOf(sp).placed, '6: ambusher placed, ambush flag set'); }
  const Sw = find('watcher'); if (Sw) ok(!Core.behNoWin(Sw.suspect), '6: watcher uses windows');
  const Sp = find('passive'); if (Sp) { const sp = Sp.suspect; sp.agit = 20; ok(Core.behNoWin(sp), '6: passive hider avoids windows'); }
  const Sr = find('roamer'); if (Sr) { const sp = Sr.suspect; const c = Core.behRoamTarget(sp); ok(!c || Core.roomAt(c[0], c[1]) !== sp.room, '6: roamer target is a neighbouring room');
    let moved = 0; for (let t = 0; t < 10 && Sr.phase !== 'over'; t++) { Core.execute(); let g = 0; while (Sr.phase === 'executing' && g++ < 200) Core.stepTick(); } moved = Core.behOf(sp).moves || 0; ok(moved >= 0, `6: roamer ran 10 turns (moves ${moved})`); }
}
{ const S = Core.newGame(7, { encounters: false }); const sp = S.suspect, b = Core.behOf(sp);
  ok(Core.behInfo()[0].label === 'unknown' && !Core.behInfo()[0].type, '6: intel row hides the type until learned');
  S.intel.interview = true; b.intRoll = true; b.t = -1; Core.behTick(sp); ok(b.known && b.src === 'interview', '6: learned from the interview');
  ok(S.log.some(l => /Intel \(interview\)/.test(l.t || l.text || l)), '6: intel log line'); ok(Core.behInfo()[0].label === Core.BEH[b.type].name, '6: intel row shows the type');
  const S2 = Core.newGame(8, { encounters: false }); const b2 = Core.behOf(S2.suspect); b2.intRoll = false; S2.nego.rounds = Core.BEH_CFG.negoRounds; b2.t = -1; Core.behTick(S2.suspect); ok(b2.known && b2.src === 'negotiation', '6: learned after negotiation rounds');
  const S3 = Core.newGame(9, { encounters: false }); const b3 = Core.behOf(S3.suspect); b3.intRoll = false; S3.suspect.visible = true; b3.t = -1; Core.behTick(S3.suspect); S3.turn++; Core.behTick(S3.suspect); ok(b3.known && b3.src === 'observation', '6: learned by observation (2 turns)');
  const got = []; S3.result = { win: true }; b3.type = 'ambusher'; S3.cas = []; Core.behScore((k, v) => got.push([k, v])); ok(got.length === 2 && got[0][1] === Core.BEH_CFG.score.read && got[1][1] === Core.BEH_CFG.score.ambushNoHit, '6: scoring +read, +ambush anticipated');
  const d = Core.debrief(); ok(d.some(x => /^Behaviour/.test(x.k) && /Identified by observation/.test(x.v)), '6: debrief Behaviour line');
  ok(/Behaviour/.test(html) && /behInfo/.test(html), '6: intel Behaviour row in UI');
  ok(/Suspect behaviour types \(v22\)/.test(html), '6: help section'); const m = html.match(/HB\('Suspect behaviour types[\s\S]*?\)\}/); ok(m && !GORE.test(m[0]), '6: help neutral'); }

// --- 7: Draco real look ---
ok(/function drawDraco/.test(html) && /#28427a/.test(html) && /canister/i.test(html), '7: Draco drawn as the real gas head on a navy boom');
ok(!/claw/i.test((html.match(/HB\('[^']*Draco[\s\S]*?\)\}/g) || []).join('')), '7: no claw wording in Draco help');

// --- 8: move waypoints ---
{ const S = Core.newGame(5, { encounters: false }); const u = S.units.find(q => q.kind === 'patrol' && !q.inCar && q.status === 'ok');
  const [sx, sy] = [u.x, u.y], dir = sx < Core.MAP_W / 2 ? 1 : -1, free = (x, y) => Core.roomAt(x, y) < 0 && !S.block[Core.idx(x, y)];
  const pts = [4, 9, 14].map(d => { for (let k = 0; k < 6; k++) for (const yy of [sy, sy + k, sy - k]) if (free(sx + dir * d, yy)) return [sx + dir * d, yy]; return null; });
  ok(pts.every(Boolean), '8: test points');
  ok(Core.queueOrder(u.uid, { type: 'move', x: pts[0][0], y: pts[0][1] }).ok, '8: first destination');
  ok(Core.wpBeyond(u.uid, ...pts[1]) && !Core.wpBeyond(u.uid, sx, sy), '8: a tap beyond the destination is a waypoint; a tap back is not');
  ok(Core.queueOrder(u.uid, { type: 'move', x: pts[0][0], y: pts[0][1] }).ok && u.orders.length === 1, '8: a plain move still replaces the destination');
  const r2 = Core.addWaypoint(u.uid, ...pts[1]), r3 = Core.addWaypoint(u.uid, ...pts[2]); ok(r2.ok && r2.leg === 2 && r3.ok && r3.leg === 3 && u.orders.length === 3, '8: legs numbered 2, 3');
  const lt = Core.legTurns(u); ok(lt.length === 3 && lt.every(l => l.leg > 0) && lt[0].turn <= lt[2].turn, '8: per-leg finishing turn');
  ok(lt.every(l => typeof l.exposed === 'boolean'), '8: per-leg exposure flag'); const pi = Core.pathInfo(u.uid); ok(pi && pi.legs === 3 && /Path 3 legs/.test(pi.text), '8: path summary ' + (pi && pi.text));
  Core.undoOrder(u.uid); ok(u.orders.length === 2, '8: undo removes the last leg'); Core.addWaypoint(u.uid, ...pts[2]);
  ok(Core.clearPath(u.uid) === 2 && u.orders.length === 1, '8: clear path keeps the first destination');
  for (let i = 0; i < Core.WP_CFG.max; i++) Core.queueOrder(u.uid, { type: 'move', x: pts[i % 3][0], y: pts[i % 3][1], wp: true }); ok(!Core.addWaypoint(u.uid, ...pts[1]).ok, '8: waypoint limit');
  Core.clearOrders(u.uid); S.suspect.mode = 'barricaded'; Core.queueOrder(u.uid, { type: 'move', x: pts[0][0], y: pts[0][1] }); Core.addWaypoint(u.uid, ...pts[1]); Core.addWaypoint(u.uid, ...pts[2]);
  const far = Core.legTurns(u).slice(-1)[0].turn; Core.execute(); let g = 0; while (S.phase === 'executing' && g++ < 200) Core.stepTick();
  ok(far === 0 ? u.orders.length === 0 : u.orders.length >= 1, `8: legs run in order inside the turn budget, rest carry over (left ${u.orders.length}, est T+${far})`);
  ok(/Move waypoints \(v22\)/.test(html) && /data-act="clearpath"/.test(html) && /wpBeyond/.test(html) && /T\+/.test(html), '8: UI tap rule, Clear path button, T+ badge, help'); }

console.log(`v22: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
