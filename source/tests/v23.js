// v23: trailers, team name box, no park outlines, wall-charge range fix + auto-move, equipment vehicle, robotics drone,
//   two BearCats, 40mm launchers; stage B: scenario text (no op names, street / name pools, history, mental hook).
const fs = require('fs'), path = require('path');
const Core = require('./load.js')({ real: true }); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const prep = (seed, extra = {}) => { const S = Core.newGame(seed, Object.assign({ encounters: false }, extra)); S.officers.forEach(o => { o.status = 'staged'; o.stage = 'primary'; o.eta = 0; }); Core.eqArriveNow(); return S; };
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const GORE = /blood|gore|brain|guts|splatter|gush|mangled|severed|maul/i;
const run = (S, n = 1) => { for (let i = 0; i < n && S.phase === 'planning'; i++) { Core.execute(); let g = 0; while (S.phase === 'executing' && g++ < 200) Core.stepTick(); if (S.phase === 'encounter') return; } };

ok(Core.GAME_VERSION === 'v23' && (html.match(/'v23'/g) || []).length === 1, 'GAME_VERSION v23 defined once');
ok(/apple-touch-icon/.test(html) && /apple-mobile-web-app-capable/.test(html), 'iOS meta kept');

// --- A4: wall charge range (root cause: furniture on either side refused the wall) ---
{ let tot = 0, miss = 0, types = new Set(), furn = 0;
  for (let seed = 1; seed <= 90; seed++) { const S = prep(seed), W = Core.MAP_W; const br = S.officers.find(o => o.spec === 'breacher'); if (!br) continue;
    const t = Core.formTeam([br.id, ...S.officers.filter(o => o !== br).slice(0, 2).map(o => o.id)]).team; t.deployed = true; t.equip.charge = 2; types.add(S.house.archName);
    for (let y = 0; y < Core.MAP_H; y++) for (let x = 0; x < W; x++) { const ra = Core.roomAt(x, y); if (ra < 0 || S.block[y * W + x]) continue;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) { const nx = x + dx, ny = y + dy, rb = Core.roomAt(nx, ny); if (rb < 0 || rb === ra || Core.edge(x, y, nx, ny).t !== 'X') continue;
        tot++; if (S.block[ny * W + nx]) furn++; t.x = x; t.y = y; const sp = Core.wallSpotsFor(t.uid), nr = Core.wallsNear(x, y);
        const has = nr.some(w => w.a[0] === x && w.a[1] === y && w.b[0] === nx && w.b[1] === ny) && sp.length > 0 && !!Core.wallReach(x, y, Core.wallDesc(x, y, nx, ny));
        if (!has) miss++; } } }
  ok(tot > 3000 && miss === 0, `A4: breacher next to an interior wall is always allowed (${tot} walls, ${furn} with furniture behind, ${types.size} house types, missing ${miss})`);
  ok(types.size >= 6, 'A4: many house types covered'); }
{ const S = prep(5), br = S.officers.find(o => o.spec === 'breacher'); const t = Core.formTeam([br.id, ...S.officers.filter(o => o !== br).slice(0, 2).map(o => o.id)]).team; t.deployed = true; t.equip.charge = 2;
  // 1.5 m rule: cell-centre distance ≤ 1.5 from the wall-side cell
  let w = null; for (let y = 0; y < Core.MAP_H && !w; y++) for (let x = 0; x < Core.MAP_W && !w; x++) { const ra = Core.roomAt(x, y); if (ra < 0 || S.block[y * Core.MAP_W + x]) continue;
    if (Core.roomAt(x + 1, y) >= 0 && Core.roomAt(x + 1, y) !== ra && Core.edge(x, y, x + 1, y).t === 'X' && Core.roomAt(x - 3, y) === ra) w = Core.wallDesc(x, y, x + 1, y); }
  ok(!!w, 'A4: found a test wall');
  t.x = w.a[0] - 1; t.y = w.a[1]; ok(!!Core.wallReach(t.x, t.y, w), 'A4: 1 m back (wall 1.5 m away) is in reach');
  t.x = w.a[0] - 3; ok(!Core.wallReach(t.x, t.y, w), 'A4: 3 m back is out of reach');
  const tap = Core.wallAtTap(w.a[0] + 1, w.a[1] + 0.5); ok(tap.ok && tap.w.key === w.key, 'A4: tapping the wall line selects it');
  let ex = null; for (let y = 0; y < Core.MAP_H && !ex; y++) for (let x = 0; x < Core.MAP_W && !ex; x++) if (Core.roomAt(x, y) >= 0 && Core.roomAt(x + 1, y) < 0 && Core.edge(x, y, x + 1, y).t === 'X') ex = [x, y];
  const tx = Core.wallAtTap(ex[0] + 1, ex[1] + 0.5); ok(!tx.ok && tx.exterior && /exterior/i.test(tx.reason), 'A4: exterior wall refused with a clear message');
  const r0 = Core.queueOrder(t.uid, { type: 'hangwall', w: Core.wallDesc(ex[0], ex[1], ex[0] + 1, ex[1]), kind: 'hole', now: false }); ok(!r0.ok, 'A4: exterior hangwall order refused');
  // out of range → auto-move then hang
  const q = Core.queueOrder(t.uid, { type: 'hangwall', w, kind: 'port', now: false }); ok(q.ok, 'A4: out-of-range hangwall order queued ' + (q.reason || ''));
  run(S, 6); const h = (S.hung || []).find(x => x.key === w.key); ok(!!h && !!Core.wallReach(t.x, t.y, w), 'A4: team moved into range and hung the charge on the selected wall');
  ok(t.equip.charge === 1, 'A4: one charge used');
  ok(html.includes("case 'hangwall'") && html.includes('wallTapPick'), 'A4: map-tap wall pick in UI'); }

// --- A1: mobile homes on the block ---
{ let n = 0, adj = 0, rates = [], rot = 0, layoutOk = 0;
  for (let seed = 1; seed <= 24; seed++) { const S = Core.newGame(seed * 13 + 5, { struct: 'trailer', encounters: false }), H = S.house, nb = S.world.nb; n++;
    const same = nb.filter(q => q.north && !q.rear), hx = (H.x0 + H.x1) / 2;
    const L = same.filter(q => q.parts[0].x < hx).sort((a, b) => b.parts[0].x - a.parts[0].x)[0], R = same.filter(q => q.parts[0].x > hx).sort((a, b) => a.parts[0].x - b.parts[0].x)[0];
    if ((!L || L.trailer) && (!R || R.trailer) && (L || R)) adj++; for (const k of ['s', 'r']) { const row = nb.filter(q => k === 's' ? !q.north : q.rear); if (row.length) rates.push(row.filter(q => q.trailer).length / row.length); }
    if (nb.some(q => q.rot)) rot++; if (nb.every(q => q.parts.every(p => p.w > 0 && p.h > 0))) layoutOk++; }
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  ok(adj === n, `A1: suspect in a trailer → both neighbours are trailers (${adj}/${n})`);
  ok(avg > 0.15 && avg < 0.55 && rates.some(x => x >= 0.5) && rates.some(x => x <= 0.2), `A1: other rows roll their own rate (avg ${avg.toFixed(2)})`);
  ok(rot > 0 && layoutOk === n, 'A1: rotated trailers / layouts kept');
  let tr = 0, tot = 0; for (let seed = 1; seed <= 40; seed++) { const S = Core.newGame(seed, { struct: 'house', encounters: false }); if (S.house.trailer) continue; tot += S.world.nb.length; tr += S.world.nb.filter(q => q.trailer).length; }
  ok(tot > 200 && tr / tot < 0.04, `A1: suspect in a house → ~1% trailers (${tr}/${tot})`); }

// --- A5: equipment vehicle arrives on a random turn, by the time 35% of members are on scene ---
{ const turns = []; let guar = 0, held = 0, pers = 0, n = 0;
  for (let s = 1; s <= 30; s++) { const S = Core.newGame(s * 7 + 3, { encounters: false }); const E = S.eqVeh; if (!E) continue; n++; turns.push(E.turn);
    const need = Math.max(1, Math.ceil(S.officers.length * Core.EQV_CFG.share));
    if (!E.here) { if (['shield', 'shield3', 'charge', 'lesslethal', 'gasbag', 'gas', 'bang', 'cs40', 'ram', 'halligan', 'medkit'].every(k => !(S.armory[k] > 0))) held++; }
    else held++;
    let g = 0, okT = true; while (g++ < 25 && S.phase === 'planning') { const on = S.officers.filter(o => o.status !== 'enroute').length; if (on >= need && !S.eqVeh.here) okT = false; if (S.eqVeh.here) break; Core.execute(); let q = 0; while (S.phase === 'executing' && q++ < 300) Core.stepTick(); }
    const on = S.officers.filter(o => o.status !== 'enroute').length; if (okT && S.eqVeh.here && on <= S.officers.length) guar++;
    const lg = S.log.map(l => l.text || l.msg || '').join('\n'); if (E.turn > 0 && !/PAGER: Equipment vehicle on scene/.test(lg)) guar -= 100; }
  ok(n === 30 && held === 30, 'until it arrives primary staging has none of the vehicle kit (' + held + '/' + n + ')');
  ok(guar === 30, 'arrives (with a pager line) no later than when 35% of the members are on scene (' + guar + '/30)');
  ok(new Set(turns).size > 1, 'random arrival turn (' + turns.join(',') + ')'); }
{ const S = prep(11); if (S.eqVeh.here) { S.eqVeh.here = false; S.eqVeh.turn = 3; S.eqHeld = Object.assign({}, S.armory); for (const k in S.armory) S.armory[k] = 0; }
  const t = Core.formTeam(S.officers.slice(0, 4).map(o => o.id)).team; const m = Core.teamOk(t);
  ok(m.every(o => Core.carries(o, 'pistol') && Core.carries(o, 'taser') && Core.invOf(o).worn.helmet && Core.invOf(o).worn.armor), 'personal items unaffected (pistol, taser, armor, helmet)');
  const bangs = m.filter(o => Core.invOf(o).ownBang > 0 ? Core.countOf(o, 'bang') >= 1 : true).length; ok(bangs === m.length, 'personal flashbang unaffected');
  const r = Core.invAct(m[1].id, 'draw', 'charge'); ok(!r.ok && /not on scene yet/.test(r.reason), 'draw before arrival explains the vehicle is en route: ' + r.reason);
  const v = Core.issueView(t.uid); ok(v.eqHere === false && v.pool.every(p => !(p.n > 0)), 'issue view shows the vehicle en route and an empty pool');
  ok(Core.eqArriveNow() && S.armory.charge > 0 && Core.issueView(t.uid).eqHere, 'on arrival the vehicle kit is in the pool');
  ok(Core.invAct(m[1].id, 'draw', 'charge').ok || Core.invAct(m[2].id, 'draw', 'charge').ok, 'draw works after arrival');
  ok(!S.world.van.away, 'the truck is on the map after arrival'); }
ok(/equipment vehicle NOT on scene yet/.test(html) && /PAGER: Equipment vehicle on scene/.test(html), 'UI + pager strings for the equipment vehicle');

// --- A6: robotics specialists bring one drone from home ---
{ let techs = 0, one = 0; for (let s = 1; s <= 25 && techs < 6; s++) { const S = prep(s); const T = S.officers.filter(o => o.spec === 'tech'); for (const o of T) { techs++; if (Core.countOf(o, 'drone') === 1 && (o.inv.home || []).includes('drone')) one++; }
    if (T.length) { const t = Core.formTeam([T[0].id].concat(S.officers.filter(o => o !== T[0]).slice(0, 3).map(o => o.id))).team; if (t && Core.countOf(T[0], 'drone') !== 1) one -= 100; } }
  ok(techs > 0 && one === techs, 'robotics specialist carries exactly one take-home drone (' + one + '/' + techs + ')'); }

// --- A7: two BearCats, independent turns, own staging pools ---
{ let both = 0, indep = 0, seats = 0, pools = 0; const K = Core.BC_KIT;
  for (let s = 1; s <= 12; s++) { const S = Core.newGame(s, { armored: true, encounters: false }); const P = S.bcPend || [];
    if (P.length === 2 && P.some(p => p.zone === 'p') && P.some(p => p.zone === 's')) both++; if (P.length === 2 && P[0].turn !== P[1].turn) indep++;
    const p0 = Object.assign({}, S.eqHeld || S.armory); Core.eqArriveNow(); const before = Object.assign({}, S.armory); Core.bcArriveNow();
    const B = Core.bearcats(); if (B.length === 2 && B.every(c => Core.carSeats(c) === 11 && c.bcDriver && c.bcDriver.name)) seats++;
    const s2 = S.ext.staging2, c2 = B.find(c => c.bcZone === 's'), c1 = B.find(c => c.bcZone === 'p');
    if (c2 && c1 && Math.hypot(c2.x - s2.x, c2.y - s2.y) < Math.hypot(c2.x - S.ext.staging.x, c2.y - S.ext.staging.y) && Object.keys(K).every(k => S.armory2[k] === K[k] && S.armory[k] === before[k] + K[k])) pools++; }
  ok(both === 12, 'two BearCats: one for primary, one for secondary staging'); ok(indep >= 6, 'independent random arrival turns (' + indep + '/12 differ)');
  ok(seats === 12, 'each has its own driver and 11 seats'); ok(pools === 12, 'each adds 1 III shield, 4 bangs, 1 single-shot LL, medkit, gas bag, 6 CS, ram, halligan, 2 charges to its own pool');
  ok(K.shield3 === 1 && K.bang === 4 && K.ll1 === 1 && K.medkit === 1 && K.gasbag === 1 && K.gas === 6 && K.ram === 1 && K.halligan === 1 && K.charge === 2, 'BearCat kit list'); }
{ const S = prep(5, { armored: true }); Core.eqArriveNow(); Core.bcArriveNow(); S.officers.forEach(o => { o.stage = 'secondary'; });
  const t = Core.formTeam(S.officers.slice(0, 4).map(o => o.id)).team; const v = Core.issueView(t.uid);
  ok(v && v.zone === 's' && v.atEq, 'team at secondary staging draws from BearCat 2 (zone ' + (v && v.zone) + ')');
  const ll = Core.teamOk(t).find(o => !Core.carries(o, 'lesslethal') && (o.quals || []).includes('ll'));
  if (ll) { const n0 = S.armory2.ll1; const r = Core.invAct(ll.id, 'draw', 'll1'); ok(r.ok && Core.llKind(ll) === 'single' && S.armory2.ll1 === n0 - 1, 'single-shot launcher drawn from the BearCat pool: ' + (r.reason || ''));
    const r2 = Core.invAct(ll.id, 'return', 'lesslethal'); ok(r2.ok && S.armory2.ll1 === n0 && !Core.carries(ll, 'lesslethal'), 'and returned to it'); }
  const c = Core.bearcatFor(t); ok(c && c.bcZone === 's', 'Draco install picks the nearest BearCat'); }
ok(/BearCat 1 on scene|on scene at \$\{p\.zone/.test(html) || /BearCat on scene/.test(html) || /on scene at .*staging — its driver stays/.test(html), 'BearCat pager line');

// --- A8: 40mm launchers ---
{ const S = prep(9); Core.eqArriveNow(); const t = Core.formTeam(S.officers.slice(0, 5).map(o => o.id)).team; const o = S.officers.find(q => (q.quals || []).includes('ll')) || Core.teamOk(t)[0];
  if (!o.quals.includes('ll')) o.quals.push('ll'); const inv = Core.invOf(o);
  // single-shot: reload after every shot, impact or CS
  inv.slung = inv.slung.filter(k => k !== 'lesslethal'); inv.hands = ['lesslethal', 'lesslethal']; inv.llMag = 1; inv.ll = 4; inv.llLoad = 1; inv.vest.cs40 = 3; inv.reloadT = -1; inv.llTurn = -1; inv.nr = {};
  ok(Core.llState(o).name === 'single-shot 40mm LL launcher' && Core.llState(o).load === 1, 'single-shot label + load');
  ok(Core.usableCount(o, 'cs40') === 3, 'single-shot fires 40mm CS too');
  Core.llShot(o); inv.vest.cs40--; ok(Core.llState(o).reloading && inv.reloadT >= S.turn, 'single-shot: reload after one shot');
  inv.llMag = 4; inv.llLoad = 4; inv.reloadT = -1; S.turn += 2; let r = 0; for (let i = 0; i < 4; i++) { inv.llTurn = -1; S.turn++; if (i % 2) { inv.vest.cs40--; Core.llShot(o); } else Core.llSpend(o); if (inv.reloadT >= S.turn) r++; }
  ok(r === 1 && Core.llState(o).name === '4-shot 40mm multilauncher', '4-shot multilauncher: reload only after the 4th round (impact and CS share the load)'); }
ok(/single-shot 40mm LL launcher/.test(html) && /4-shot 40mm multilauncher/.test(html) && /RELOADING/.test(html), 'launcher labels + reload state in the UI');

// A2/A3: team rename after 'Done — team ready'; no park-cruiser outlines
{ const S = prep(23), t = Core.formTeam(S.officers.slice(0, 2).map(o => o.id)).team;
  const n0 = S.log.length, r = Core.renameTeam(t.uid, 'Alpha <x>'); ok(r.ok && r.renamed && r.name === 'Alpha x' && t.name === 'Alpha x', 'A2: renameTeam renames (tags stripped) ' + JSON.stringify(r));
  ok(S.log.length > n0, 'A2: rename is logged'); const r2 = Core.renameTeam(t.uid, '   '); ok(r2.ok && !r2.renamed && t.name === 'Alpha x', 'A2: blank keeps the name');
  ok(/id="m-tname"/.test(html) && /Done — team ready/.test(html) && /tn-form/.test(html), 'A2: rename dialog after Done — team ready');
  ok(!/park cruiser/i.test(html.replace(/no 'park cruiser' ghost outlines/g, '').replace(/'park cruiser' map outlines are gone/g, '')), 'A3: no park-cruiser outlines'); }

// A1 regression: rear-row park homes never stand end-on (seed 107 trailer failed generation)
{ let okG = true; try { Core.newGame(107, { struct: 'trailer', armored: true, encounters: false }); } catch (e) { okG = false; } ok(okG && Core.state.world.nb.some(n => n.rear), 'A1: trailer seed 107 generates with a rear row'); }

// ---- stage B: scenario text ----
{ const C = Core, u = a => new Set(a).size === a.length;
  ok(C.SUS_FIRST.length === 200 && u(C.SUS_FIRST) && C.SUS_LAST.length === 200 && u(C.SUS_LAST) && C.CALLER_F.length === 100 && u(C.CALLER_F) && C.STREET_WORDS.length === 200 && u(C.STREET_WORDS), 'B3/B4: pools 200 male / 200 surnames / 100 female / 200 street words, no duplicates');
  let num = 0, bad = 0; const N = 2000; for (let i = 0; i < N; i++) { const s = C.streetName(C.makeRng(i * 17 + 3)); if (/^([NSEW] )?\d+(st|nd|rd|th) (Street|Avenue)$|^((West|East|North|South) )?[A-Z] Street$/.test(s)) num++; else if (!/ (Street|Drive|Avenue|Lane|Road|Court|Place|Way|Circle|Trail)$/.test(s)) bad++; }
  ok(num / N > 0.25 && num / N < 0.35 && !bad, `B3: ~30% numbered/lettered streets (${(100 * num / N).toFixed(1)}%), the rest carry a suffix`);
  ok(C.streetName(C.makeRng(5)) === C.streetName(C.makeRng(5)), 'B3: street names are seeded'); }
{ let opLeft = 0, descLeft = 0, firstOk = 0, n = 0, fem = 0, femN = 0, nbr = 0, nbrN = 0, hist = 0, histMax = 0, legalPill = 0, streets = new Set();
  const BUILD = /heavy build|medium build|shaved head|glasses|stocky|beard|slim/i;
  for (let seed = 1; seed <= 90; seed++) { const st = ['barricade', 'mental', 'domestic', 'neighbor', 'flee', 'parole', 'sovcit', 'drughouse', 'inmates'][seed % 9]; const S = Core.newGame(seed * 13 + 1, { stype: st, encounters: false }), B = S.brief; n++;
    if (S.opName || S.log.some(l => /OPERATION|^Operation /.test(l.text))) opLeft++;
    if (BUILD.test(B.suspect) || B.transcript.some(t => BUILD.test(t.text)) || B.known.some(k => BUILD.test(k))) descLeft++;
    if (/^[A-Z][a-z]+ [A-Z][a-z]+, \d+$/.test(B.suspect) && Core.SUS_FIRST.includes(B.name.split(' ')[0]) && Core.SUS_LAST.includes(B.name.split(' ')[1])) firstOk++;
    const m = /^(\w+)(?: \w+)? \((partner|girlfriend|sister)\)$/.exec(B.caller); if (m) { femN++; if (Core.CALLER_F.includes(m[1])) fem++; }
    if (/\(neighbor\)$/.test(B.caller)) { nbrN++; if (/^(Mr|Mrs)\. ([A-Z][a-z]+) \(neighbor\)$/.test(B.caller) && Core.SUS_LAST.includes(B.caller.split(' ')[1])) nbr++; }
    const H = B.history || []; histMax = Math.max(histMax, H.length); if (B.known.some(k => /^Record on file: [^0-9]+\.$|^No criminal history on file\./.test(k))) hist++;
    if (st === 'mental' && B.legal) legalPill++; streets.add(S.geo.name); }
  ok(!opLeft, `B2: no operation names in state or log (${opLeft})`);
  ok(!descLeft, `B5: no build/description in brief or 911 text (${descLeft})`);
  ok(firstOk === n, `B4/B5: subject is "First Last, age" from the new pools (${firstOk}/${n})`);
  ok(femN > 3 && fem === femN, `B4: partner/girlfriend/sister callers use the female pool (${fem}/${femN})`);
  ok(nbrN > 3 && nbr === nbrN, `B4: neighbor caller is Mr./Mrs. + surname (${nbr}/${nbrN})`);
  ok(hist === n && histMax <= 6, `B6: history line in every brief, no years, ≤ 6 entries (max ${histMax})`);
  ok(!legalPill, 'B7: no legal pill/line on crisis calls');
  ok(streets.size > 40, `B3: varied street names (${streets.size} distinct in ${n})`); }
{ const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ok(!/NIGHTFALL|IRON GATE|BLUE HERON|COLD HARBOR|HALCYON/.test(html) && !/Operation Debrief/.test(html) && !/id="opname">OPERATION/.test(html), 'B2: no op-name pool or OPERATION headings in the build');
  const S = Core.newGame(4321, { encounters: false }); ok(S.opName === '' && 'opName' in S, 'B2: opName key kept (empty) for old saves'); }
{ // B6 weighting + hidden aggression
  const freq = (st, re) => { let k = 0, t = 0; for (let i = 0; i < 400; i++) { const H = Core.crimHistory(Core.makeRng(i * 7 + 1), st); t++; if (H.some(h => re.test(h.text))) k++; } return k / t; };
  ok(freq('drughouse', /controlled substance|distribute|trafficking/) > 2 * freq('mental', /controlled substance|distribute|trafficking/), 'B6: drug entries weighted to drug-house calls');
  ok(freq('domestic', /domestic|protective order/) > 3 * freq('barricade', /domestic|protective order/), 'B6: domestic entries weighted to domestic calls');
  const avg = st => { let s = 0; for (let i = 0; i < 400; i++) s += Core.crimHistory(Core.makeRng(i * 11 + 2), st).length; return s / 400; };
  ok(avg('inmates') > avg('barricade') && avg('barricade') > avg('mental'), `B6: history length by type (inmates ${avg('inmates').toFixed(1)}, barricade ${avg('barricade').toFixed(1)}, mental ${avg('mental').toFixed(1)})`);
  const none = st => { let k = 0; for (let i = 0; i < 400; i++) if (!Core.crimHistory(Core.makeRng(i * 5 + 9), st).length) k++; return k / 400; };
  ok(['mental', 'neighbor', 'domestic'].every(t => none(t) > none('barricade') && none(t) > none('flee')), `B6: "no history" more common on crisis/neighbor/domestic (${['mental', 'neighbor', 'domestic', 'barricade', 'flee'].map(t => t + ' ' + Math.round(100 * none(t)) + '%').join(', ')})`);
  { let grp = true; for (let i = 0; i < 400; i++) { const T = Core.crimHistory(Core.makeRng(i * 3 + 4), 'parole').map(h => h.text); if (T.includes('Active felony warrant') && T.includes('Active misdemeanor warrant')) grp = false; if (T.includes('Prior arrest for assault') && T.includes('Multiple prior assault arrests')) grp = false; } ok(grp, 'B6: exclusive entries never doubled (warrant kinds, assault counts)'); }
  ok(Core.CRIM.length >= 50 && ['Multiple prior assault arrests', 'Suspect in multiple shootings', 'Firearm intelligence — known to carry', 'Active felony warrant', 'Active misdemeanor warrant'].every(t => Core.CRIM.some(c => c.s === t)), `B6: big pool incl. the requested examples (${Core.CRIM.length})`);
  let mono = true, anyHigh = false; for (let seed = 1; seed <= 60; seed++) { const S = Core.newGame(seed * 29 + 3, { stype: 'barricade', encounters: false }), h = S.hid, sc = S.brief.history.reduce((a, x) => a + x.sev, 0);
    if (!h || h.score !== sc || h.agit !== Math.round(Math.min(Core.HID_CFG.agitCap, sc * Core.HID_CFG.sevAgit) + (h.down ? Core.HID_CFG.downAgit : 0))) mono = false; if (h && h.fire > 1.1) anyHigh = true; }
  ok(mono, 'B6: hidden agitation bump follows history severity (capped)'); ok(Core.HID_CFG.fireCap <= 0.15 && Core.HID_CFG.agitCap <= 10, 'B6: the bump is modest (≤ +15% fire, ≤ +10 agitation)'); }
{ // B1 officer hit before SWAT → hidden modifiers, no new UI text
  let S = null; for (let seed = 1; seed <= 400 && !S; seed++) { const T = Core.newGame(seed, { stype: 'barricade', encounters: false }); if (T.scene && T.scene.injury) S = T; }
  ok(!!S, 'B1: found a seed with an officer hit before SWAT');
  if (S) { const T = Core.SCEN_TYPES.barricade, c = Core.stypeCfg(); ok(S.hid.down && c.fireMul > T.fireMul * 1.25 && c.negoMul < T.negoMul, `B1: hidden fire ×${(c.fireMul / T.fireMul).toFixed(2)}, negotiation ×${(c.negoMul / T.negoMul).toFixed(2)}`);
    ok(!S.brief.known.some(k => /aggress|hidden|more likely/i.test(k)), 'B1: no new UI text for the modifier'); }
  const Q = Core.newGame(77, { stype: 'barricade', encounters: false }); Q.hid = null; ok(Core.stypeCfg() === Core.SCEN_TYPES.barricade, 'B1: states without S.hid (old saves) use the plain config'); }
{ // B7 crisis hooks
  const cnt = { discharge: 0, warrant: 0, menacing: 0 }; let other = 0, hookTxt = 0, n = 0, legalTxt = 0;
  for (let seed = 1; seed <= 300; seed++) { const S = Core.newGame(seed * 3 + 2, { stype: 'mental', encounters: false }), k = S.stype.legal; if (k in cnt) cnt[k]++; else other++;
    if (seed <= 60) { n++; const B = S.brief; if (B.transcript.some(t => t.who === 'Caller' && t.text.includes(Core.mentalHook(k, S.suspect, B.self).trim()))) hookTxt++;
      if (B.known.some(x => Object.values(Core.LEGAL_TXT).includes(x)) || B.legal) legalTxt++; } }
  ok(!other && Math.abs(cnt.discharge / 300 - 0.35) < 0.09 && Math.abs(cnt.warrant / 300 - 0.30) < 0.09 && Math.abs(cnt.menacing / 300 - 0.35) < 0.09, `B7: hooks discharge/warrant/menacing ${cnt.discharge}/${cnt.warrant}/${cnt.menacing} of 300`);
  ok(hookTxt === n, `B7: the hook is told in the 911 call (${hookTxt}/${n})`); ok(!legalTxt, 'B7: no legal line on crisis calls');
  const S = Core.newGame(11, { stype: 'mental', encounters: false }); ok(S.brief.known.some(k => /still be evaluated after he comes out/.test(k)), 'B7: brief says EMS evaluation still possible after he comes out');
  Core.suspList().forEach(s => { s.mode = 'detained'; }); S.stats.method = 'Surrender'; Core.checkEnd(); ok(S.phase === 'over' && S.result.win && /EMS: .*evaluation after booking/.test(S.result.text), 'B7: surrender result notes the EMS evaluation');
  const S2 = Core.newGame(11, { stype: 'mental', encounters: false }); S2.intel.emsEval = true; Core.suspList().forEach(s => { s.mode = 'detained'; }); Core.checkEnd(); ok(/crisis team evaluates him/.test(S2.result.text), 'B7: staged crisis team evaluates him after surrender'); }
{ const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8'); ok(/The call &amp; the brief \(v23\)|The call & the brief \(v23\)/.test(html) && /record on file/.test(html), 'help: v23 call/brief section present'); }

console.log(`v23: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
