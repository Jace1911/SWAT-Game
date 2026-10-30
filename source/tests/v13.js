// v13: fortified drug house, escaped inmates (call types); duplex and mobile home (structures).
const Core = require('./load.js')(); let pass = 0, fail = 0; const fs = require('fs'), path = require('path');
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
function runTurn() { Core.execute(); let g = 0; while (!Core.stepTick() && g++ < 50); }
const K = Core.SCEN_KEYS;
ok(['drughouse', 'inmates'].every(k => K.includes(k)), 'new types registered: ' + K.join());
ok(Core.BASE_KEYS.join() === 'barricade,mental,domestic,flee,neighbor', 'base types unchanged');
// 1) frequencies (call type and structure) — separate seed streams, deterministic
{ const cnt = {}, sc = {}, N = 6000; for (let i = 1; i <= N; i++) { const s = i * 7919 % 999983; const t = Core.typeForSeed(s); cnt[t.key] = (cnt[t.key] || 0) + 1; const st = Core.structFor(s); sc[st] = (sc[st] || 0) + 1; }
  console.log('  mix', JSON.stringify(cnt), 'structs', JSON.stringify(sc));
  for (const k of ['drughouse', 'inmates']) { const f = (cnt[k] || 0) / N, w = Core.SCEN_TYPES[k].xw; ok(Math.abs(f - w) < 0.012, `${k} share ${(f * 100).toFixed(1)}% ≈ ${w * 100}%`); }
  for (const k of ['duplex', 'trailer']) { const f = (sc[k] || 0) / N, w = Core.STRUCT_CFG[k]; ok(Math.abs(f - w) < 0.012, `${k} share ${(f * 100).toFixed(1)}% ≈ ${w * 100}%`); }
  let det = true; for (let i = 1; i < 60; i++) if (Core.structFor(i) !== Core.structFor(i) || Core.typeForSeed(i).key !== Core.typeForSeed(i).key) det = false; ok(det, 'deterministic per seed');
  ok(Core.structFor(5, { struct: 'duplex' }) === 'duplex' && Core.structFor(5, { struct: 'trailer' }) === 'trailer' && Core.structFor(5, { struct: 'house' }) === 'house', 'opts.struct forces the structure'); }
// 2) house seeds keep their v12 layout (structure draw on its own stream)
{ const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v12_houses.json'), 'utf8')); let same = 0, n = 0;
  for (const seed of Object.keys(F)) { if (Core.structFor(+seed) !== 'house') continue; n++; const S = Core.newGame(+seed, { stype: 'barricade' }), f = F[seed]; if (S.geo.side) { n--; continue; } /* v14 corner lots re-plan the block */ { const g = S.rooms.find(r => r.type === 'garage'); if (g && g.w > 7) { n--; continue; } } // v22: 2- / 3-car garages widen the plan on purpose
    const sig = S.rooms.map(q => [q.name, q.x, q.y, q.w, q.h].join(',')).join(';'); if (sig === f.rooms && S.doors.length === f.doors && S.windows.length === f.wins && S.house.archName === f.arch) same++; else console.log('  changed', seed); }
  ok(n >= 26 && same === n, `house layouts unchanged vs v12 (${same}/${n})`); }
// 3) fortified drug house
{ const cnt = [0, 0, 0, 0, 0]; let armor = 0, tot = 0, barred = 0, wins = 0, camsOk = 0, n = 0;
  for (let seed = 1; seed <= 40; seed++) { const S = Core.newGame(seed * 13 + 1, { stype: 'drughouse' }); n++; const L = Core.suspList(); cnt[L.length]++; tot += L.length; armor += L.filter(s => s.armor && s.armor !== 'none').length;
    const ext = S.doors.filter(d => d.exterior && !d.unitB); ok(ext.every(d => d.barricaded && d.locked && d.fortified) && ext.filter(d => d.kind !== 'garage').every(d => d.steel), 'drug house: own exterior doors braced, steel ' + seed);
    const own = S.windows.filter(w => Core.isOwnRoom(w.room)); wins += own.length; barred += own.filter(w => w.barred).length;
    if (S.cams && S.cams.length >= Core.DRUG_CFG.cams[0] && S.cams.length <= Core.DRUG_CFG.cams[1]) camsOk++;
    ok(L.every(s => ['rifle', 'shotgun', 'handgun'].includes(s.weapon)), 'drug house: everyone armed ' + seed);
    if (seed <= 3) { const B = S.brief; ok(B.channel === 'radio' && /narcotics/i.test(B.caller) && B.transcript.some(l => l.who === 'Narcotics'), 'drug house: narcotics radio brief, no 911');
      ok(/steel/i.test(B.known.join(' ')) && /camera/i.test(B.known.join(' ')) && /bars/i.test(B.known.join(' ')), 'drug house: brief mentions steel doors, bars, cameras');
      ok(S.log.some(l => /Narcotics unit requests SWAT/.test(l.text || l.msg || '')), 'drug house: dispatch line');
      ok(!Core.cmdShown('family') && Core.cmdShown('power') && !Core.cmdShown('inmfamily') && !Core.cmdShown('partner'), 'drug house: command set'); } }
  console.log(`  drughouse counts ${cnt.join('/')}, armor ${(armor / tot * 100).toFixed(0)}%, barred ${(barred / wins * 100).toFixed(0)}%, cams ok ${camsOk}/${n}`);
  ok(cnt[1] === 0 && cnt[2] > 0 && cnt[3] > 0 && cnt[4] > 0, '2-4 suspects'); ok(armor / tot > 0.15 && armor / tot < 0.6, 'armor possible'); ok(barred / wins > 0.7, 'most windows barred'); ok(camsOk === n, 'cameras placed');
  const S = Core.newGame(77, { stype: 'drughouse' }), d = S.doors.find(q => q.steel), team = S.units.find(u => u.kind === 'team');
  ok(Core.doorMul(d, 'ram') === Core.DOOR_MUL.steel.ram && Core.doorMul(d, 'kick') < 0.2, 'steel door multipliers');
  if (team) { const a = Core.breachEst(team, d, 'ram'), b = Core.breachEst(team, Object.assign({}, d, { steel: false }), 'ram'); ok(a.p < b.p * 0.5, `steel door slows the ram (${a.p} vs ${b.p})`); }
  // barred windows are not escape routes
  ok(S.windows.filter(w => w.barred).every(w => !Core.exitWin(w)), 'barred windows are not exits');
  // camera: an officer in the cone raises agitation once logged; cut power turns them off
  const c = S.cams[0]; const pt = []; for (let r = 2; r <= c.range && !pt.length; r++) { const x = Math.round(c.x + c.dx * r * 0.7), y = Math.round(c.y + c.dy * r * 0.7); if (Core.roomAt(x, y) < 0 && Core.camSees(c, x, y)) pt.push(x, y); }
  ok(pt.length === 2, 'camera has a visible cell in its cone');
  if (pt.length) { const u = S.units.find(q => q.kind === 'patrol'); u.inCar = false; const ox = u.x, oy = u.y, ag = S.suspect.agit; u.x = pt[0]; u.y = pt[1]; Core.camTurn();
    ok(S.suspect.agit > ag && c.seen && S.log.some(l => /in view of the camera/.test(l.text || l.msg || '')), 'camera spots an officer: agitation up, log');
    S.turn = Math.max(S.turn, Core.DRUG_CFG.powerFrom); const r = Core.setCommand('power'); ok(r.ok, 'cut power command accepted ' + JSON.stringify(r)); runTurn();
    ok(S.power.cut && !Core.camSees(c, pt[0], pt[1]), 'cut power: cameras dark'); u.x = ox; u.y = oy;
    ok(Core.typeDebrief().some(l => /Fortified house/.test(l.k) && /cut/.test(l.v)), 'debrief notes the cameras'); } }
// 4) escaped inmates
{ const cnt = [0, 0, 0, 0, 0]; for (let seed = 1; seed <= 40; seed++) { const S = Core.newGame(seed * 17 + 3, { stype: 'inmates' }); cnt[Core.suspList().length]++;
    if (seed <= 3) { const B = S.brief; ok(/homeowner/i.test(B.caller) && B.transcript.some(l => /ran out|got out|grabbed the kids/.test(l.text)), 'inmates: family 911 call');
      ok(/Family Interview/.test(B.known.join(' ')), 'inmates: brief points to the family interview');
      ok(!Core.cmdShown('family') && Core.cmdShown('inmfamily') && !Core.cmdShown('power'), 'inmates: command set');
      ok(S.log.some(l => /Escaped inmate/.test(l.text || l.msg || '')), 'inmates: dispatch line');
      const r = Core.setCommand('inmfamily'); ok(r.ok, 'family interview accepted'); runTurn();
      ok(S.inmFamily.done && S.intel.floors && S.intel.weapon && S.intel.suspConfirmed && Core.ownRooms().every(q => q.known), 'family interview: layout, weapons, count');
      ok(S.log.some(l => /Family interview: "It's our house/.test(l.text || l.msg || '')), 'family interview log'); } }
  console.log('  inmates counts', cnt.join('/')); ok(cnt[1] > 0 && cnt[2] > 0 && cnt[3] === 0 && cnt[4] === 0, '1-2 suspects');
  ok(Core.SCEN_TYPES.inmates.slipMul > Core.SCEN_TYPES.flee.slipMul * 0.9 || Core.SCEN_TYPES.inmates.slipMul >= 2, 'high flee tendency'); }
// 5) duplex
{ let nB = 0, valid = 0, n = 0; for (let seed = 1; seed <= 30; seed++) { const S = Core.newGame(seed * 29 + 5, { struct: 'duplex' }); n++;
    const B = S.rooms.filter(q => q.unitB); if (B.length >= 3) nB++; if (!(S.genErrors || []).length) valid++;
    ok(Core.suspList().every(s => Core.isOwnRoom(s.room)), 'duplex: suspects start on their own side ' + seed);
    ok(S.doors.some(d => d.exterior && d.unitB) && S.doors.some(d => d.exterior && !d.unitB), 'duplex: both units have doors ' + seed);
    ok(S.windows.filter(w => !Core.isOwnRoom(w.room)).every(w => !Core.exitWin(w)), 'duplex: unit B windows are not his exits ' + seed); }
  ok(nB === n && valid === n, `duplex: unit B on every map, valid (${nB}/${valid}/${n})`);
  // evacuate early → no risk; then breach
  let S = Core.newGame(4321, { struct: 'duplex', stype: 'barricade' }); if (!S.duplex.residents) { S.duplex.residents = 2; S.duplex.evac = 'none'; }
  ok(Core.cmdShown('evacB') && /Duplex/.test(S.brief.known.join(' ')), 'duplex: evacuate command + brief note');
  ok(Core.setCommand('evacB').ok, 'evacuate accepted'); for (let t = 0; t < Core.DUPLEX_CFG.evacTurns + 1; t++) runTurn(); ok(S.duplex.evac === 'done', 'unit B evacuated after ~2 turns');
  let h = Core.partyBreach(S.suspect); ok(h && S.duplex.hole && !S.duplex.risk && S.rooms[S.suspect.room].unitB, 'party-wall breach moves him into unit B, no risk when evacuated');
  ok(h && Core.edge(h.ax, h.ys[0], h.bx, h.ys[0]).t === 'O', 'hole is an open edge'); ok(S.duplex.wallV > 0, 'wall version bumped (render rebake)');
  ok(S.windows.filter(w => !Core.isOwnRoom(w.room)).some(w => Core.exitWin(w)), 'after the hole unit B windows are reachable');
  ok(Core.missionScore().items.some(i => /evacuated/.test(i.label) && i.pts > 0), 'score: unit B evacuated bonus');
  ok(Core.typeDebrief().some(l => /Duplex/.test(l.k) && /breached/.test(l.v)), 'debrief: party wall');
  S = Core.newGame(4321, { struct: 'duplex', stype: 'barricade' }); S.duplex.residents = 2; S.duplex.evac = 'none'; h = Core.partyBreach(S.suspect);
  ok(h && S.duplex.risk && S.log.some(l => /still inside/.test(l.text || l.msg || '')), 'breach before evacuation: risk flag + log');
  ok(Core.missionScore().items.some(i => i.pts === Core.DUPLEX_CFG.riskPen), 'score: risk penalty');
  // natural breach chance grows with time, only from breakFrom
  S = Core.newGame(4321, { struct: 'duplex', stype: 'barricade' }); S.turn = 5; for (let i = 0; i < 40; i++) Core.duplexTurn(); ok(!S.duplex.hole, 'no breach before turn ' + Core.DUPLEX_CFG.breakFrom);
  let br = 0; for (let k = 0; k < 20; k++) { S = Core.newGame(4000 + k, { struct: 'duplex', stype: 'barricade' }); S.suspect.mode = 'barricaded'; for (let t = 20; t < 45 && !S.duplex.hole; t++) { S.turn = t; Core.duplexTurn(); } if (S.duplex.hole) br++; }
  console.log('  duplex breaks by turn 45 (idle):', br + '/20'); ok(br >= 5 && br <= 20, 'extended barricade can break through'); }
// 6) mobile home
{ let n = 0, thin = 0, steps = 0, small = 0, park = 0, dbl = 0; for (let seed = 1; seed <= 30; seed++) { const S = Core.newGame(seed * 31 + 7, { struct: 'trailer' }); n++;
    if (S.house.thin && S.doors.filter(d => d.exterior).every(d => d.thin)) thin++; if ((S.world.steps || []).length === S.doors.filter(d => d.exterior).length) steps++;
    if (S.rooms.length <= 8) small++; if (S.house.park && S.world.nb.some(q => q.trailer)) park++; if (S.house.trailer === 'double') dbl++; }
  console.log(`  trailer: thin ${thin}/${n}, steps ${steps}/${n}, compact ${small}/${n}, park ${park}, double-wide ${dbl}`);
  ok(thin === n && steps === n && small === n && park > 0 && dbl > 0 && dbl < n, 'mobile homes: thin walls, steps, compact, park cluster, single/double');
  const S = Core.newGame(900, { struct: 'trailer', stype: 'barricade' }), d = S.doors.find(q => q.exterior);
  ok(Core.doorMul(d, 'kick') > 2, 'hollow doors: kick easier');
  const sp = S.suspect, rm = S.rooms[sp.room], u = S.units.find(q => q.kind === 'patrol'); u.inCar = false; let spot = null;
  for (let x = rm.x - 1; x <= rm.x + rm.w && !spot; x++) for (const y of [rm.y - 1, rm.y + rm.h]) if (Core.roomAt(x, y) < 0 && !S.block[Core.idx(x, y)]) { spot = [x, y]; break; }
  if (spot) { u.x = spot[0]; u.y = spot[1]; sp.agit = 90; sp.cd = 0; sp.mode = 'barricaded'; const keep = Core.TRAILER_CFG.wallShot; Core.TRAILER_CFG.wallShot = 1; const sh = S.stats.shots; Core.thinWallTurn(); Core.TRAILER_CFG.wallShot = keep;
    ok(S.stats.shots === sh + 1 && S.stats.wallShots === 1 && S.log.some(l => /through the wall/.test(l.text || l.msg || '')), 'thin walls: shot through the wall');
    ok(S.log.some(l => /thin walls — we can hear/.test(l.text || l.msg || '')), 'thin walls: officers hear him'); } else ok(false, 'no wall spot'); }
// 7) wiring: preview, help, picker, save code untouched
{ const P = Core.preview(4321, { struct: 'duplex', stype: 'drughouse' }); ok(P.struct === 'duplex' && P.stype === 'drughouse' && P.diff >= 1.5, 'preview: struct + harder diff ' + P.diff);
  const ui = fs.readFileSync(path.join(__dirname, '../src/ui.js'), 'utf8');
  ok(/Fortified drug house/.test(ui) && /Escaped inmates/.test(ui) && /party wall/.test(ui) && /Mobile home/.test(ui) && /mm-struct/.test(ui) && /swat\.qstruct/.test(ui), 'help + structure picker');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'); ok(/apple-mobile-web-app-capable/.test(html) && /apple-touch-icon/.test(html), 'iOS meta kept');
  ok(/swat\.career/.test(html) && /SWATC3/.test(html), 'save keys kept');
  const words = fs.readFileSync(path.join(__dirname, '../src/core_parts/d7e_types3.js'), 'utf8'); ok(!/blood|gore|kill|dead\b|corpse/i.test(words), 'neutral wording'); }
console.log(`v13: ${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1;
