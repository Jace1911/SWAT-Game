// v10 scenario types: data-driven call types picked by seed — selection, per-type rules, brief/911, interviews, scoring, harness playthroughs.
const Core = require('./load.js')(); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const { execFileSync } = require('child_process');
function runTurn() { Core.execute(); let g = 0; while (!Core.stepTick() && g++ < 50); }
const K = Core.SCEN_KEYS;
ok(Core.BASE_KEYS.join() === 'barricade,mental,domestic,flee,neighbor' && K.length >= 5, 'base types: ' + K.join());
// 1) selection by seed over many seeds: deterministic, every type appears, forced type wins
const cnt = {}; let det = true; const N = 250;
for (let i = 1; i <= N; i++) { const seed = i * 7919 % 999983; const a = Core.typeForSeed(seed), b = Core.typeForSeed(seed); if (a.key !== b.key || a.variant !== b.variant || a.legal !== b.legal) det = false; cnt[a.key] = (cnt[a.key] || 0) + 1; }
ok(det, 'type selection deterministic per seed'); console.log('  type mix over', N, 'seeds', JSON.stringify(cnt));
for (const k of K) ok((cnt[k] || 0) >= N * (Core.SCEN_TYPES[k].xw ? Core.SCEN_TYPES[k].xw * 0.4 : 0.07), `type ${k} appears (${cnt[k] || 0}/${N})`);
for (const seed of [11, 222, 3333]) { const S = Core.newGame(seed); ok(S.stype.key === Core.typeForSeed(seed).key, 'game uses the seed type ' + seed); }
for (const k of K) { const S = Core.newGame(5150, { stype: k }); ok(S.stype.key === k, 'forced type ' + k); ok(S.brief.stype === k && S.brief.stypeName && S.brief.typeDesc, 'brief carries type ' + k); }
ok(Core.newGame(5150, { stype: 'bogus' }).stype.key === Core.typeForSeed(5150).key, 'unknown forced type falls back to seed');
// 2) per-type rules across several seeds
const seeds = [101, 202, 303, 404, 505, 606, 707, 808];
const has = (S, k) => { const c = Core.COMMANDS[k]; return !(c.only && c.only !== S.stype.key) && c.avail() === true; };
for (const seed of seeds) {
  let S = Core.newGame(seed, { stype: 'mental' });
  ok(S.suspect.agit === 30 && S.brief.type === 'mental health crisis' && Core.LEGAL_TXT[S.stype.legal], 'mental: low agitation, crisis call, legal factor ' + S.stype.legal);
  ok(S.brief.known.includes(Core.LEGAL_TXT[S.stype.legal]), 'mental: legal factor in the brief');
  ok(S.stype.legal !== 'discharge' || S.brief.shots, 'mental: discharge → shots in the brief');
  ok(Core.typeFireMul(null) < 0.7, 'mental: lower fire readiness'); ok(has(S, 'emseval') && !has(S, 'partner'), 'mental: EMS evaluation available, no partner');
  ok(Core.setCommand('partner').ok === false, 'partner interview refused on a non-domestic call');
  S = Core.newGame(seed, { stype: 'domestic' }); const v = S.stype.variant;
  ok(['firearm', 'violent'].includes(v) && /partner/.test(S.brief.caller) && !S.nego.called911, 'domestic: partner called (' + v + ')');
  ok(v !== 'firearm' || S.brief.sawGun, 'domestic firearm: gun seen'); ok(v !== 'violent' || !S.brief.sawGun, 'domestic violent: gun not confirmed');
  ok(has(S, 'partner') && !has(S, 'emseval'), 'domestic: partner interview available');
  ok(S.brief.transcript.some(l => /boyfriend/.test(l.text)), 'domestic: 911 transcript from the partner');
  const known0 = S.rooms.filter(q => q.known).length; Core.setCommand('partner'); runTurn();
  ok(S.intel.partner && S.rooms.every(q => q.known) && known0 < S.rooms.length, 'domestic: partner interview maps the whole layout');
  ok(v !== 'firearm' || S.intel.weapon, 'domestic firearm: partner confirms the weapon'); ok(!!S.nego.read, 'domestic: partner gives history');
  ok(S.log.some(l => /^Partner/.test(l.text)), 'domestic: partner lines logged');
  S = Core.newGame(seed, { stype: 'flee' });
  ok(S.vacant && /Vacant/.test(S.brief.occupants) && !S.nego.called911 && S.suspect.agit === 60, 'flee: vacant house, no 911 number, agitated');
  ok(Core.COMMANDS.family.avail() !== true, 'flee: no family on scene'); ok(Core.stypeCfg().negoMul < 1, 'flee: hard to talk to');
  ok(!S.cas.some(c => c.who === 'civilian' || c.who === 'hostage'), 'flee: no civilians');
  S = Core.newGame(seed, { stype: 'neighbor' });
  ok(S.intel.weapon && S.brief.sawGun && ['left', 'right'].includes(S.stype.side), 'neighbor: known armed, side ' + S.stype.side);
  const H = S.house, on = { x: S.stype.side === 'left' ? H.x0 - 3 : H.x1 + 3, y: H.y0 + 2 }, off = { x: S.stype.side === 'left' ? H.x1 + 3 : H.x0 - 3, y: H.y0 + 2 };
  ok(Core.typeFireMul(on) > Core.typeFireMul(off), 'neighbor: more hostile toward the neighbor side');
  ok(/neighbor/.test(S.brief.caller) && S.brief.transcript.some(l => /pointed a gun/.test(l.text)), 'neighbor: neighbor 911 call');
  Core.setCommand('interview'); runTurn(); ok(S.log.some(l => /over the fence/.test(l.text)), 'neighbor: interview gives the side');
}
// 3) flee: an unwatched side gets used fast; barricade much slower
function slipTurns(stype) { let hits = 0, tot = 0; for (const seed of seeds) { const S = Core.newGame(seed, { stype }); S.nego.contact = null;
    S.units.filter(u => u.kind === 'patrol' || u.kind === 'cruiser').forEach(u => { u.x = 2; u.y = 2; u.inCar = null; }); S.turn = 3; S.scene.gapTurns = 0; tot++;
    for (let t = 0; t < 4; t++) { Core.sceneTurn(); if (S.suspect.mode === 'fleeing') { hits++; break; } } } return hits / tot; }
const fF = slipTurns('flee'), fB = slipTurns('barricade'); console.log(`  slip-out within 4 turns of a gap: flee ${(fF * 100).toFixed(0)}%, barricade ${(fB * 100).toFixed(0)}%`);
ok(fF > fB && fF >= 0.5, 'flee: escapes through uncovered sides much sooner');
// 4) scoring + debrief
{ let S = Core.newGame(808, { stype: 'mental' }); S.result = { win: true, title: 'SUSPECT IN CUSTODY' }; S.stats.method = 'Negotiated surrender'; S.nego.how = 'phone';
  let M = Core.missionScore(); ok(M.items.some(i => /without force/.test(i.label)) && !M.items.some(i => /EMS evaluation/.test(i.label)), 'mental: no-force bonus, no EMS bonus without the evaluation');
  S.intel.emsEval = true; M = Core.missionScore(); ok(M.items.some(i => /EMS evaluation/.test(i.label)), 'mental: EMS evaluation bonus');
  const D = Core.typeDebrief(); ok(D.some(d => d.k.includes('Risk flag') && /Referred for EMS/.test(d.v)), 'mental: neutral risk flag in the debrief');
  ok(!D.some(d => /suicid|self-harm|kill/i.test(d.v)), 'debrief wording neutral');
  S.stats.ofShots = 2; S.stats.method = 'Officer fire + arrest'; M = Core.missionScore(); ok(!M.items.some(i => /without force/.test(i.label)), 'mental: force → no bonus');
  S = Core.newGame(808, { stype: 'barricade' }); S.result = { win: true }; S.stats.method = 'Negotiated surrender'; ok(!Core.missionScore().items.some(i => /Crisis|EMS/.test(i.label)), 'barricade: no crisis bonuses');
  ok(Core.sceneDebrief().some(d => d.k === 'Scenario type'), 'debrief names the type'); ok(Core.careerSummary().stype === 'barricade', 'career summary records the type'); }
// 5) career call preview shows the type; old saves untouched
{ const p = Core.preview(4242, {}); ok(p.stype === Core.typeForSeed(4242).key && p.stypeName, 'call preview carries the type: ' + p.stypeName); }
// 6) wording: no gore in any brief / 911 transcript across many seeds
{ let bad = 0; for (let i = 1; i <= 40; i++) for (const k of K) { const S = Core.newGame(i * 131, { stype: k }); const txt = JSON.stringify(S.brief); if (/blood|gore|suicid|kill (my|him)self|corpse/i.test(txt)) bad++; } ok(!bad, 'no graphic wording in briefs (' + bad + ')'); }
// 7) harness playthroughs per type (competent policy wins often, passive never)
const NB = +process.env.V10NB || 8;
for (const k of K) { let out = '';
  try { out = execFileSync('node', [__dirname + '/harness.js', '1', String(NB)], { env: Object.assign({}, process.env, { STYPE: k, KINDS: 'competent,passive' }), encoding: 'utf8', timeout: 900000 }); } catch (e) { out = (e.stdout || '') + ''; }
  const c = /BALANCE competent\s+resolved (\d+)%\s+good \(resolved, score ≥\d+\) (\d+)%/.exec(out), p = /BALANCE passive\s+resolved (\d+)%/.exec(out);
  console.log(`  harness ${k}: competent resolved ${c ? c[1] : '?'}% good ${c ? c[2] : '?'}% · passive resolved ${p ? p[1] : '?'}%`);
  ok(c && +c[1] >= 50, `harness ${k}: winnable (competent resolved ≥50%)`); ok(c && +c[2] <= 100 && p && +p[1] <= 25, `harness ${k}: not trivial (passive ≤25%)`); }
console.log(`v10: ${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0;
