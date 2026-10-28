// v11: multiple suspects in fleeing-suspect calls (1-4, weighted), per-suspect state, intel count, end condition, scoring; other types keep 1.
const Core = require('./load.js')(); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const W = Core.MULTI_CFG.countW; ok(W.length === 4 && Math.abs(W.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'count weights tunable, sum to 1');
// 1) distribution of the seeded count
const N = 4000, cnt = [0, 0, 0, 0, 0]; for (let i = 1; i <= N; i++) cnt[Core.fleeCount(i * 7919 % 999983)]++;
for (let k = 1; k <= 4; k++) ok(Math.abs(cnt[k] / N - W[k - 1]) < 0.03, `count ${k}: ${(100 * cnt[k] / N).toFixed(1)}% vs ${W[k - 1] * 100}%`);
ok(cnt[1] > cnt[2] && cnt[2] > cnt[3] && cnt[3] > cnt[4], 'lower counts more common'); console.log('  count mix', JSON.stringify(cnt.slice(1)));
let det = true; for (let i = 1; i < 50; i++) if (Core.fleeCount(i) !== Core.fleeCount(i)) det = false; ok(det, 'count deterministic per seed');
// 2) other types keep one suspect; flee games use the drawn count
for (const k of Core.SCEN_KEYS.filter(k => k !== 'flee')) for (const seed of [11, 202, 3033]) { const S = Core.newGame(seed, { stype: k }); ok(S.suspects.length === 1 && S.suspect === S.suspects[0], `${k} seed ${seed}: one suspect`); ok(Core.intelInfo().count.confirmed, `${k}: count is not a mystery`); }
let seenMulti = 0; for (let i = 1; i <= 40; i++) { const seed = i * 131; const S = Core.newGame(seed, { stype: 'flee' }); ok(S.suspects.length === Core.fleeCount(seed), 'flee uses drawn count ' + seed); if (S.suspects.length > 1) seenMulti++; }
ok(seenMulti >= 10, 'multi-suspect flee calls occur (' + seenMulti + '/40)');
// 3) per-suspect independent state
for (const n of [2, 3, 4]) for (const seed of [77, 4242, 90001]) {
  const S = Core.newGame(seed, { stype: 'flee', suspects: n }), L = S.suspects; ok(L.length === n, `forced ${n} suspects`);
  ok(new Set(L.map(s => s.x + ',' + s.y)).size === n, 'distinct positions'); ok(L.every(s => s.room >= 0 && S.rooms[s.room]), 'all inside a room');
  ok(new Set(L.map(s => s.key)).size === n && L[0].key === 'S', 'unique keys, lead S'); ok(L.every(s => s.weapon && s.armor !== undefined && s.disp), 'own weapon/armor/disposition');
  const I = Core.intelInfo(); ok(I.count.total === null && !I.count.confirmed, 'count unknown at start'); ok(I.suspects.every(s => s.visible) && I.suspects.length === L.filter(s => s.seen).length, 'only suspects already sighted (e.g. by a patrol through a window) are listed');
  ok(S.brief.belief && /suspect/i.test(S.brief.belief) && S.brief.report, 'brief carries officer belief'); }
// patrol report can under-report / be uncertain
const kinds = {}; let under = 0; for (let i = 1; i <= 300; i++) { const S = Core.newGame(i * 37 + 5, { stype: 'flee' }); const R = S.brief.report; kinds[R.kind] = (kinds[R.kind] || 0) + 1; if (R.n < S.suspects.length) under++; }
ok(kinds.exact && kinds.under !== undefined || kinds.atleast, 'report kinds vary ' + JSON.stringify(kinds)); ok(under > 0, 'some reports under-count (' + under + ')');
// 4) sight confirms count only when all seen + house cleared
{ const S = Core.newGame(4242, { stype: 'flee', suspects: 3 }); S.suspects[0].seen = true; S.suspects[1].seen = true; ok(!Core.intelInfo().count.confirmed, 'two of three seen: not confirmed');
  S.suspects.forEach(s => s.seen = true); S.rooms.forEach(r => r.explored = true); Core.updateVision(); ok(Core.intelInfo().count.confirmed && Core.intelInfo().count.total === 3, 'all seen + cleared: confirmed 3'); }
// 5) end condition needs every suspect
{ const S = Core.newGame(4242, { stype: 'flee', suspects: 3 }); S.suspects[0].mode = 'detained'; S.suspects[1].mode = 'detained'; Core.setLead(); Core.checkEnd(); ok(S.phase !== 'over', 'two of three in custody: not over');
  S.suspects[2].mode = 'detained'; Core.setLead(); Core.checkEnd(); ok(S.phase === 'over' && S.result && S.result.win, 'all three in custody: resolved'); ok(/ALL 3/.test(S.result.title), 'title names all suspects: ' + S.result.title);
  const cs = Core.careerSummary ? Core.careerSummary() : null; ok(cs && cs.suspects === 3, 'career summary counts suspects'); }
{ const S = Core.newGame(4242, { stype: 'flee', suspects: 2 }); S.suspects[0].mode = 'detained'; S.suspects[1].mode = 'escaped'; Core.setLead(); Core.checkEnd(); ok(S.phase !== 'over', 'one still at large: mission continues');
  S.suspects[1].mode = 'detained'; S.suspects[1].escapedOut = true; S.stats.escaped = true; S.stats.escapedN = 1; Core.setLead(); Core.checkEnd(); ok(S.phase === 'over' && /AFTER ESCAPE/.test(S.result.title), 'caught after escape noted: ' + (S.result && S.result.title));
  ok(Core.missionScore().items.some(i => /escaped/.test(i.label) && i.pts < 0), 'escape penalty line'); }
// 6) targeting: shots hit the suspect at the target cell
{ const S = Core.newGame(4242, { stype: 'flee', suspects: 3 }); const b = S.suspects[1]; ok(Core.suspById(b.key) === b, 'lookup by key'); }
// 7) group negotiation: walk-out of the lead pulls the others (or they break away)
{ let follow = 0, brk = 0; for (const seed of [5, 55, 555, 5555, 55555, 123, 321, 999]) { const S = Core.newGame(seed, { stype: 'flee', suspects: 3 }); Core.withSp(S.suspects[0], () => Core.walkout('nego'));
    for (const s of S.suspects.slice(1)) { if (s.walk) follow++; else if (s.breakaway) brk++; } }
  ok(follow > 0, 'others follow a negotiated walk-out (' + follow + ')'); ok(follow + brk === 16, 'every other suspect follows or breaks away (' + (follow + brk) + ')'); }
// 8) single-suspect games are unchanged by the generalization (same seed → same suspect)
{ const a = Core.newGame(31337, { stype: 'barricade' }), sa = JSON.stringify([a.suspect.x, a.suspect.y, a.suspect.weapon, a.suspect.armor]); const b = Core.newGame(31337, { stype: 'barricade' }); ok(sa === JSON.stringify([b.suspect.x, b.suspect.y, b.suspect.weapon, b.suspect.armor]), 'deterministic single'); }
// 9) short playthroughs with 3 suspects end cleanly (resolved or capped) with no exceptions
function runTurn() { Core.execute(); let g = 0; while (!Core.stepTick() && g++ < 50); }
let errs = 0; for (const seed of [11, 22, 33]) { try { const S = Core.newGame(seed, { stype: 'flee', suspects: 3 }); for (let t = 0; t < 20 && S.phase !== 'over'; t++) runTurn(); if (S.phase !== 'over') Core.withdraw(); ok(S.phase === 'over', 'playthrough ends ' + seed); const M = Core.missionScore(); ok(isFinite(M.score), 'score finite'); } catch (e) { errs++; console.log(e.stack); } }
ok(!errs, 'no exceptions in multi playthroughs');
console.log(`v11: ${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1;
