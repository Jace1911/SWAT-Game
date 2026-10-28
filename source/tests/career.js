// Career persistence tests (save schema v3): team XP → level, teamForLevel, migration from v6 saves (schema v1/v2),
// old export codes, corrupt roster / corrupt save recovery, per-action XP, State SWAT hand-over, mission flow.
const fs = require('fs'), path = require('path');
const Career = require('../src/career.js'); const Core = require('./load.js')(); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const mem = {}; Career.setStorage({ get: k => mem[k] || null, set: (k, v) => { mem[k] = v; return true; }, del: k => delete mem[k], kind: 'test' });
const clear = () => { for (const k in mem) delete mem[k]; };
// --- team level table
const T1 = Career.teamForLevel(1), T100 = Career.teamForLevel(100), T50 = Career.teamForLevel(50);
ok(T1.staff >= 4 && T1.staff <= 6 && T1.teamMax === 4, 'level 1: small staff (4–6), teams of 4');
ok(['robot', 'charge', 'gas', 'lesslethal', 'drone', 'tphone'].every(k => T1.gear[k] === 0) && T1.gear.shield === 1 && T1.gear.ram >= 1 && !T1.armored && !T1.counts.marksman, 'level 1: basic gear only, one shield, no robot/charges/gas/snipers');
ok(T100.staff === 30 && T100.teamMax === 8 && T100.armored, 'level 100: 30 personnel, teams of 8, armored vehicle');
ok(Object.keys(Career.LEVEL.gear).every(k => k === 'draco' ? T100.gear.draco === 1 : T100.gear[k] >= 3 || ['ram', 'drone', 'robot', 'bullhorn'].includes(k) && T100.gear[k] >= 3) && T100.gear.bang >= 20, 'level 100: every equipment type, large inventory (one Draco kit for the one BearCat)');
ok(['leader', 'point', 'breacher', 'negotiator', 'medic', 'marksman', 'tech', 'k9'].every(s => T100.counts[s] >= 1) && T100.spotters >= 3, 'level 100: all roles (incl. snipers + spotters)');
ok(T50.staff > T1.staff && T50.staff < T100.staff && Object.keys(T50.gear).every(k => T50.gear[k] <= T100.gear[k] && T50.gear[k] >= T1.gear[k]), 'level 50 interpolates between 1 and 100');
let mono = true; for (let L = 2; L <= 100; L++) { const a = Career.teamForLevel(L - 1), b = Career.teamForLevel(L); if (b.staff < a.staff || Object.keys(a.gear).some(k => b.gear[k] < a.gear[k])) mono = false; } ok(mono, 'staff and gear never shrink as level rises');
ok(Career.levelForXp(0) === 1 && Career.levelForXp(Career.xpForLevel(37)) === 37 && Career.levelForXp(Career.xpForLevel(37) - 1) === 36 && Career.levelForXp(1e9) === 100, 'XP thresholds map to levels 1..100');
ok(Career.levelForXp('junk') === 1 && Career.levelForXp(-50) === 1, 'invalid XP → level 1');
// --- quick mission
const q = Career.quickOpts(100), SQ = Core.newGame(4242, q);
ok(q.career === false && SQ.officers.length === 30 && SQ.teamMax === 8 && SQ.armory.robot === 3 && SQ.armory.bang === 20, 'Quick Mission level 100: 30 officers + full armory');
ok(new Set(SQ.officers.map(o => o.last)).size === 30, 'Quick Mission: 30 unique officer names');
const SQ1 = Core.newGame(4242, Career.quickOpts(1)); ok(SQ1.officers.length === T1.staff && SQ1.armory.robot === 0 && SQ1.armory.charge === 0 && SQ1.armory.gas === 0 && SQ1.teamMax === 4, 'Quick Mission level 1: small staff, basic armory');
ok(JSON.stringify(Core.newGame(4242, Career.quickOpts(1)).rooms.map(r => r.name)) === JSON.stringify(Core.newGame(4242, Career.quickOpts(100)).rooms.map(r => r.name)), 'level does not change the map for a seed');
// --- fresh career
clear(); let c = Career.load(); ok(c.v === Career.VERSION && c.teamXp === 0 && Career.levelOf(c) === 1 && c.roster.length === T1.staff, 'new career starts at team level 1 with the level-1 staff');
ok(Career.missionOpts(c).gear.drone === 0 && Career.missionOpts(c).teamMax === 4 && Career.missionOpts(c).level === 1, 'career mission opts follow the team level');
Career.save(c); ok(JSON.stringify(Career.load()) === JSON.stringify(c), 'save → load roundtrip is exact');
ok(mem[Career.KEY] && JSON.parse(mem[Career.XP_KEY]).teamXp === 0, 'key unchanged (swat.career) + team XP backup mirror written');
// --- v6 save migration (real save written by the v6 career module)
const v6 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v6_save.json'), 'utf8')), v6xp = v6.roster.reduce((a, o) => a + o.xp, 0);
clear(); mem[Career.KEY] = JSON.stringify(v6); const m6 = Career.load();
ok(m6.v === 3 && m6.migratedFrom === 2 && m6.teamXp === v6xp && Career.levelOf(m6) === Career.levelForXp(v6xp), `v6 save migrates: team XP = total v6 XP (${v6xp}) → level ${Career.levelOf(m6)}`);
ok(v6.roster.every(o => m6.roster.some(r => r.id === o.id && r.last === o.last && r.xp === o.xp && r.injuries === o.injuries && r.recover === o.recover && r.rank === o.rank)), 'v6 officers kept (names, XP, injuries, recovery, rank)');
ok(m6.record.played === 7 && m6.record.wins === 5 && m6.record.outcomes.negotiated === 3 && m6.memorial.length === 1 && m6.history.length === 1 && m6.points === v6.points, 'v6 record, memorial, history and points kept');
ok(m6.unlocks.drone && Career.missionOpts(m6).gear.drone >= 1 && Career.missionOpts(m6).teamMax >= 6, 'v6 purchased unlocks still apply (floor over level gating)');
ok(Array.isArray(m6.calls) && typeof m6.started === 'boolean', 'new v3 fields defaulted on migration');
// v1 save (v1–v3 game)
const v1 = { version: 1, played: 5, wins: 3, officers: [{ name: 'Sgt. Okafor', spec: 'leader', xp: 420 }, { name: 'Ofc. Tran', spec: 'breacher', xp: 30 }] };
clear(); mem[Career.KEY] = JSON.stringify(v1); const m1 = Career.load();
ok(m1.v === 3 && m1.migratedFrom === 1 && m1.record.played === 5 && m1.record.losses === 2 && m1.teamXp === 450 && m1.roster.some(o => o.last === 'Okafor' && o.xp === 420), 'v1 save migrates through v2 to v3 (team XP 450)');
// --- team XP is primary: corrupt / missing roster never touches it
clear(); mem[Career.KEY] = JSON.stringify(Object.assign({}, v6, { v: 3, teamXp: 5000, roster: 'garbage' })); let mr = Career.load();
ok(mr.teamXp === 5000 && mr.rosterRebuilt && mr.roster.length === Career.teamForLevel(Career.levelForXp(5000)).staff, 'corrupt roster → regenerated for the level, team XP kept');
mem[Career.KEY] = JSON.stringify({ v: 3, teamXp: 8000 }); mr = Career.load(); ok(mr.teamXp === 8000 && mr.roster.length > 4 && mr.record.played === 0, 'missing roster/record → defaults, team XP kept');
mem[Career.KEY] = JSON.stringify({ v: 3, teamXp: 1200, roster: [null, { last: 'Ok', spec: 'point', xp: 'x' }, { spec: 'nope' }] }); mr = Career.load();
ok(mr.teamXp === 1200 && mr.roster.length === 1 && mr.roster[0].xp === 0, 'bad officer entries dropped / repaired, team XP kept');
clear(); c = Career.fresh(); c.teamXp = 3333; Career.save(c); mem[Career.KEY] = '{not json'; mr = Career.load(); ok(mr.teamXp === 3333 && mr.recovered, 'unreadable main save → team XP recovered from the backup mirror');
mem[Career.KEY] = JSON.stringify({ v: 3, teamXp: 'NaN', roster: [] }); mr = Career.load(); ok(mr.teamXp === 3333, 'invalid top-level team XP → backup mirror');
clear(); mem[Career.KEY] = JSON.stringify({ v: 99 }); ok(Career.load().record.played === 0, 'unknown future version falls back safely');
// --- export / import
c = Career.fresh(); c.teamXp = 2400; const code = Career.exportCode(c);
ok(new RegExp(`^SWATC3\\.L${Career.levelForXp(2400)}-X2400-`).test(code) && JSON.stringify(Career.importCode(code)) === JSON.stringify(c), 'export shows team level + XP up front; roundtrip exact');
ok(Career.codeHeader(code).teamXp === 2400, 'code header readable');
const old = fs.readFileSync(path.join(__dirname, 'fixtures/v6_code.txt'), 'utf8').trim(), oi = Career.importCode(old);
ok(/^SWATC2\./.test(old) && oi.v === 3 && oi.teamXp === v6xp && oi.roster.length >= v6.roster.length, 'old SWATC2 (v6) code imports and migrates');
ok(Career.importCode(Career.exportCode(Career.migrate({ version: 1, played: 1, wins: 1, officers: [{ name: 'A B', spec: 'point', xp: 10 }] }))).teamXp === 10, 'migrated v1 data exports/imports');
let threw = false; try { Career.importCode(code.slice(0, -8) + 'AAAAAAAA'); } catch (e) { threw = true; } ok(threw, 'damaged code rejected');
const rec = Career.importCode(code.slice(0, -8) + 'AAAAAAAA', { recoverXp: true }); ok(rec.teamXp === 2400 && rec.recovered, 'damaged body + intact header → team XP recovered on request');
threw = false; try { Career.importCode('hello'); } catch (e) { threw = true; } ok(threw, 'garbage code rejected');
// --- mission flow with per-action XP
c = Career.fresh(); c.teamXp = Career.xpForLevel(30); Career.staffTo(c, 30); const opts = Career.missionOpts(c); const S = Core.newGame(1234, opts);
ok(S.officers.length === c.roster.length && S.officers.every(o => o.careerId) && opts.level === 30, 'mission uses career roster at the team level');
const t0 = S.officers.slice(0, 2).map(o => o.id); Core.xpAct('breach', t0, 'Front door'); Core.xpAct('aid', [t0[0]], 'P1'); Core.xpAct('contain', null);
const sm = Core.careerSummary(); ok(sm.actions.length === 3 && sm.actions[0].xp === Core.ACT_XP.breach.xp, 'actions tracked in the summary');
sm.win = true; sm.outcome = 'negotiated'; sm.score = 900; sm.officers.forEach(o => { o.onScene = true; o.inTeam = true; });
const br = sm.officers.find(o => o.spec === 'breacher'), md = sm.officers.find(o => o.spec === 'medic');
br.cas = { state: 'kia', sev: 3 }; md.cas = { state: 'evacuated', sev: 2, stable: true };
const xp0 = c.teamXp, a0 = c.roster.find(o => o.id === sm.officers[0].careerId), ax0 = a0.xp; const notes = Career.record(c, sm);
ok(c.teamXp > xp0 && notes[0].includes('team XP'), 'team XP grows; debrief note shows it');
ok(a0.xp - ax0 === 40 + 40 + 36 + Core.ACT_XP.breach.xp + Core.ACT_XP.aid.xp, 'officer XP = participation + win + score + own actions');
ok(c.record.played === 1 && c.record.wins === 1 && c.record.officersLost === 1, 'record counts win and casualties');
ok(c.memorial.length === 1 && c.roster.filter(o => o.spec === 'breacher').length >= Career.teamForLevel(Career.levelOf(c)).counts.breacher, 'KIA → memorial, roles restaffed for the level');
const medic = c.roster.find(o => o.id === md.careerId); ok(medic.recover === 1 && !Career.missionOpts(c).roster.some(o => o.id === medic.id), 'injured officer recovering, unavailable');
Core.newGame(99, Career.missionOpts(c)); Career.record(c, Core.careerSummary()); ok(medic.recover === 0, 'recovering officer returns after sitting one out');
// level up from level 1
const c1 = Career.fresh(); Core.newGame(7, Career.missionOpts(c1)); const s1 = Core.careerSummary(); s1.win = true; s1.score = 800; s1.officers.forEach(o => { o.onScene = true; o.inTeam = true; });
const n1 = Career.record(c1, s1); ok(Career.levelOf(c1) > 1 && n1.some(n => /▲/.test(n)) && c1.roster.length >= Career.teamForLevel(Career.levelOf(c1)).staff, 'a won mission levels a new career up and hires to the new level');
// --- State SWAT hand-over keeps only action XP
{ const c2 = Career.fresh(), G = Core.newGame(555, Career.quickOpts(5)); ok(!Core.callState().ok, 'Call State SWAT is career-only'); }
{ const c2 = Career.fresh(); const G = Core.newGame(555, Career.missionOpts(c2)); const id = G.officers[0].id; Core.xpAct('breach', [id]); Core.xpAct('aid', [id]);
  const r = Core.callState(); const s = Core.careerSummary(); ok(r.ok && G.phase === 'over' && s.stateTakeover && s.outcome === 'state' && !s.win, 'Call State SWAT ends the mission (outcome "state")');
  ok(s.deductions.some(d => /State SWAT/.test(d.label)), 'hand-over listed as a deduction');
  s.officers.forEach(o => { o.onScene = true; o.inTeam = true; o.cas = null; }); const o0 = c2.roster.find(o => o.id === s.officers[0].careerId), others = c2.roster.filter(o => o !== o0);
  const notes = Career.record(c2, s); ok(o0.xp === Core.ACT_XP.breach.xp + Core.ACT_XP.aid.xp && others.every(o => o.xp === 0), 'state hand-over: only individual action XP, no mission XP');
  ok(c2.teamXp === Core.ACT_XP.breach.xp + Core.ACT_XP.aid.xp && /individual actions only/.test(notes[0]), 'team XP = action XP only; debrief says so');
  ok(c2.record.outcomes.state === 1, 'outcome recorded'); }
// --- withdraw still recorded
{ const c2 = Career.fresh(); Core.newGame(555, Career.missionOpts(c2)); Core.withdraw(); const s = Core.careerSummary(); s.officers.forEach(o => { o.onScene = true; o.inTeam = true; o.cas = null; }); s.score = -650;
  Career.record(c2, s); ok(c2.record.outcomes.withdrawn === 1 && c2.history[0].score === -650 && c2.roster.every(o => o.xp >= 0), 'withdrawn mission recorded, no negative XP'); }
// --- random calls
{ const c3 = Career.fresh(); const calls = Career.makeCalls(c3, seed => Core.preview(seed, Career.missionOpts(c3)), 3);
  ok(calls.length === 3 && calls.every(k => k.seed && k.type && k.addr && k.diff >= 1 && k.diff <= 3), 'random calls: 3 described calls with seeds and difficulty');
  ok(c3.calls.length === 3, 'calls stored on the career'); const keep = Core.newGame(77); Core.preview(1234); ok(Core.state === keep, 'preview leaves the current game untouched'); }
console.log(`CAREER: ${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1;
