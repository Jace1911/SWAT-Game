// v12: new call types — parole absconder, eviction / civil-papers standoff (sovereign citizen); later: fortified drug house, escaped inmates, duplex, mobile home.
const Core = require('./load.js')(); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const K = Core.SCEN_KEYS;
ok(['parole', 'sovcit'].every(k => K.includes(k)), 'new types registered: ' + K.join());
ok(Core.BASE_KEYS.join() === 'barricade,mental,domestic,flee,neighbor', 'base types unchanged');
// 1) frequency by seed (separate stream), deterministic, base mapping preserved for non-new seeds
{ const cnt = {}, N = 6000; for (let i = 1; i <= N; i++) { const t = Core.typeForSeed(i * 7919 % 999983); cnt[t.key] = (cnt[t.key] || 0) + 1; }
  console.log('  mix', JSON.stringify(cnt));
  for (const k of K) if (Core.SCEN_TYPES[k].xw) { const f = (cnt[k] || 0) / N, w = Core.SCEN_TYPES[k].xw; ok(Math.abs(f - w) < 0.015, `${k} share ${(f * 100).toFixed(1)}% ≈ ${w * 100}%`); } }
// 2) parole absconder
{ const V = {}, W = {}; let hides = 0, hk = {}, n = 0;
  for (let seed = 1; seed <= 120; seed++) { const S = Core.newGame(seed, { stype: 'parole' }); n++; V[S.stype.variant] = 1; W[S.suspect.weapon] = (W[S.suspect.weapon] || 0) + 1;
    if (S.hide) { hides++; hk[S.hide.kind] = 1; ok(S.suspect.x === S.hide.x && S.suspect.y === S.hide.y && S.suspect.hidden, 'suspect in the hide ' + seed); }
    if (seed <= 3) { ok(S.suspects.length === 1, 'parole: one suspect'); ok(/parole/i.test(S.brief.known.join(' ')) && S.brief.legal === 'parole', 'parole: warrant objective in brief'); ok(S.brief.transcript.length >= 4, 'parole: transcript'); } }
  ok(V.seen && V.window && V.caller, 'parole: all three ways patrol learned he is inside');
  ok(W.none > 0 && W.handgun > 0 && W.none < n * 0.7 && W.none > n * 0.2, 'parole: moderate weapon odds ' + JSON.stringify(W));
  ok(hides > n * 0.4 && hides < n * 0.8 && hk.attic && hk.basement, 'parole: attic and basement hides ' + hides + '/' + n); }
{ let S = null; for (let seed = 1; seed < 80; seed++) { S = Core.newGame(seed, { stype: 'parole' }); if (S.hide) break; }
  const B = S.brief, v = S.stype.variant; ok(v === 'caller' ? /inside/.test(B.transcript[1].text) : /Patrol/.test(B.transcript[0].who), 'brief/911 text matches how patrol learned (' + v + ')');
  S.rooms.forEach(r => r.explored = true); S.vis.fill(1); Core.updateVision(); ok(!S.suspect.visible && S.suspect.hidden, 'hidden: not visible even with the room in view');
  const t = S.units.find(u => u.kind === 'patrol'); t.inCar = null; const sp = S.suspect;
  const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [sp.x + a, sp.y + b]).find(([x, y]) => !S.block[y * Core.MAP_W + x] && Core.roomAt(x, y) === sp.room);
  if (nb) { t.x = nb[0]; t.y = nb[1]; Core.updateVision(); ok(!sp.hidden && S.hide.found, 'found when an officer is next to the hatch'); } else ok(true, 'no free neighbour cell (skipped)');
  ok(Core.intelInfo() && true, 'intel ok'); }
{ const S = Core.newGame(6, { stype: 'parole' }); if (S.suspect.weapon === 'none') { ok(/NO FIREARM|UNKNOWN/.test(Core.intelInfo().threat), 'unarmed threat wording'); } }
// 3) sovereign citizen: gear odds raised by +25 points (capped), own negotiation lines
{ const N = 400; let rifle = 0, armor = 0, mask = 0, doors = 0, ext = 0, brf = 0, base = { rifle: 0, armor: 0, mask: 0 };
  for (let seed = 1; seed <= N; seed++) { const S = Core.newGame(seed, { stype: 'sovcit' }); const sp = S.suspect; if (sp.weapon === 'rifle') rifle++; if (sp.armor !== 'none') armor++; if (sp.hasMask) mask++;
    S.doors.filter(d => d.exterior && d.kind !== 'garage').forEach(d => { ext++; if (d.fortified && d.barricaded) doors++; });
    if (/sovereign/i.test(S.brief.known.join(' ') + S.brief.transcript.map(e => e.text).join(' '))) brf++;
    const B = Core.newGame(seed, { stype: 'barricade' }).suspect; if (B.weapon === 'rifle') base.rifle++; if (B.armor !== 'none') base.armor++; if (B.hasMask) base.mask++; }
  const C = Core.SOVCIT_CFG, pct = x => (100 * x / N).toFixed(0) + '%'; console.log(`  sovcit rifle ${pct(rifle)} (base ${pct(base.rifle)}), armor ${pct(armor)} (base ${pct(base.armor)}), mask ${pct(mask)} (base ${pct(base.mask)}), braced doors ${(100 * doors / ext).toFixed(0)}%`);
  ok(Math.abs(rifle / N - Math.min(C.cap, C.rifleBase + C.boost)) < 0.08, 'sovcit rifle ≈ base + 25'); ok(Math.abs(armor / N - Math.min(C.cap, 0.07 + C.boost)) < 0.07, 'sovcit armor ≈ 7% + 25 (overrides base)');
  ok(Math.abs(mask / N - Math.min(C.cap, C.maskBase + C.boost)) < 0.07, 'sovcit gas mask ≈ 5% + 25'); ok(Math.abs(doors / ext - Math.min(C.cap, C.doorBase + C.boost)) < 0.07, 'sovcit reinforced doors ≈ 10% + 25');
  ok(rifle > base.rifle && armor > base.armor && mask > base.mask, 'sovcit gear above barricade baseline'); ok(brf === N, 'sovcit brief wording'); }
{ const S = Core.newGame(77, { stype: 'sovcit' }); ok(S.suspects.length === 1 && S.brief.legal === 'eviction', 'sovcit: one suspect, court order');
  ok(/jurisdiction|sovereign|legal theory|private/i.test(Object.values(Core.NEGO_FLAVOR.sovcit).filter(v => typeof v === 'string').join(' ')), 'sovcit negotiation flavor'); }
// 4) types never leave the brief inconsistent; a few turns run clean; debrief carries type lines
function runTurn() { Core.execute(); let g = 0; while (!Core.stepTick() && g++ < 50); }
let errs = 0; for (const k of ['parole', 'sovcit']) for (const seed of [21, 42]) { try { const S = Core.newGame(seed, { stype: k }); for (let t = 0; t < 12 && S.phase !== 'over'; t++) runTurn(); if (S.phase !== 'over') Core.withdraw();
  ok(S.phase === 'over' && S.result.debrief, k + ' playthrough ends ' + seed); const d = JSON.stringify(S.result.debrief); ok(k === 'parole' ? /Warrant/.test(d) : /Court order/.test(d), k + ' debrief line'); } catch (e) { errs++; console.log(e.stack); } }
ok(!errs, 'no exceptions');
// neutral wording
{ const bad = /\b(blood|gore|kill(ed)?|dead body|corpse)\b/i; let hit = 0; for (const k of ['parole', 'sovcit']) for (const seed of [1, 2, 3]) { const S = Core.newGame(seed, { stype: k }); if (bad.test(JSON.stringify(S.brief))) hit++; } ok(!hit, 'neutral brief wording'); }
// 5) rear row behind the suspect house: back neighbours, their yards, rear street — playable, reachable, used for cover and sniper perches
{ let rearNb = 0, perch = 0, reachN = 0, cars = 0, n = 0, coverRear = 0;
  for (let seed = 1; seed <= 25; seed++) { const S = Core.newGame(seed), G = S.geo; n++;
    ok(G.rear && G.rear.y1 < G.target.y0 && G.rear.road0 >= 1, 'rear row above target lot ' + seed); ok(Core.MAP_H === Core.REAR_OFF + 71, 'map height');
    ok(S.genErrors.length === 0, 'world valid ' + seed + ' ' + S.genErrors.join());
    const R = S.ext.nb.filter(q => q.rear); rearNb += R.length; perch += S.perches.filter(p => S.ext.nb[p.nb].rear).length; cars += S.ext.cars.filter(c => c.rear).length;
    const D = Core.reach(S.ext.staging.x, S.ext.staging.y, { outdoor: true }, 1e6);
    let road = false; for (let x = 5; x < Core.MAP_W - 5 && !road; x++) if (D[Core.idx(x, G.rear.road1)] < 1e9) road = true; if (road) reachN++;
    const H = S.house; for (const q of R) for (const pt of q.parts) if (pt.y + pt.h > H.y0 - 30 && Math.abs(pt.x + pt.w / 2 - (H.x0 + H.x1) / 2) < 30) { coverRear++; break; }
    let drv = 0; for (let x = 2; x < Core.MAP_W - 2; x++) drv += S.drive[Core.idx(x, G.rear.road0 + 2)] || S.drive[Core.idx(x, G.rear.road0 + 3)] ? 1 : 0; ok(drv > 60, 'rear street drivable ' + seed + ' ' + drv); }
  console.log(`  rear row: ${(rearNb / n).toFixed(1)} houses/map, ${(perch / n).toFixed(1)} rear perches, ${(cars / n).toFixed(1)} rear-street cars, rear street reachable ${reachN}/${n}`);
  ok(rearNb / n >= 2, 'rear neighbour houses on every map'); ok(perch / n >= 1, 'sniper perches in rear houses'); ok(reachN === n, 'rear street reachable on foot'); ok(coverRear >= n * 0.8, 'rear houses near the target (usable cover)');
  const S = Core.newGame(3), p = S.perches.find(q => S.ext.nb[q.nb].rear); ok(!p || /rear row/.test(p.name), 'rear perch named'); }
console.log(`v12: ${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1;
