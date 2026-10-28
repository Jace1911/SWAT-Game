// Career persistence tests: save/load roundtrip, migration v1→v2, export/import code, corrupt data fallback, mission flow.
const Career = require('../src/career.js'); const Core = require('./load.js')(); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const mem = {}; Career.setStorage({ get: k => mem[k] || null, set: (k, v) => { mem[k] = v; return true; }, del: k => delete mem[k], kind: 'test' });
let c = Career.load(); ok(c.v === Career.VERSION && c.roster.length === 9 && c.record.played === 0, 'fresh career when nothing saved');
ok(Career.missionOpts(c).gear.drone === 0 && Career.missionOpts(c).teamMax === 5, 'new career: drone/robot/LL locked, teams of 5');
c.points = 1000; ok(Career.buy(c, 'drone').ok && !Career.buy(c, 'drone').ok && c.points === 700, 'buy unlock once, points deducted');
c.points = 100; ok(!Career.buy(c, 'armored').ok, 'cannot buy without enough points'); ok(Career.missionOpts(c).gear.drone === 1, 'unlock reaches mission gear');
c.points = 300; ok(Career.buy(c, 'negotiator2').ok && c.roster.filter(o => o.spec === 'negotiator').length === 2, 'extra negotiator recruited');
Career.save(c); const c2 = Career.load(); ok(JSON.stringify(c2) === JSON.stringify(c), 'save → load roundtrip is exact');
// corrupt storage → graceful fresh career
mem[Career.KEY] = '{not json'; ok(Career.load().roster.length === 9, 'corrupt save falls back to a fresh career');
mem[Career.KEY] = JSON.stringify({ v: 99 }); ok(Career.load().record.played === 0, 'unknown future version falls back safely');
// migration v1 → v2
const v1 = { version: 1, played: 5, wins: 3, officers: [{ name: 'Sgt. Okafor', spec: 'leader', xp: 420 }, { name: 'Ofc. Tran', spec: 'breacher', xp: 30 }] };
mem[Career.KEY] = JSON.stringify(v1); const m = Career.load();
ok(m.v === Career.VERSION && m.migratedFrom === 1 && m.record.played === 5 && m.record.wins === 3 && m.record.losses === 2, 'v1 save migrates record');
ok(m.roster[0].last === 'Okafor' && m.roster[0].rank === 'Sgt.' && m.roster.length === 2, 'v1 officers migrate with rank from XP');
const partial = Career.migrate({ v: 2, roster: [{ id: 'x', last: 'A', spec: 'point', quals: [], skill: .7, xp: 0, rank: 'Ofc.', missions: 0, wins: 0, injuries: 0, recover: 0 }] });
ok(partial.record.suspects && partial.memorial && partial.history, 'v2 save with missing fields is filled in');
// export / import
const code = Career.exportCode(c); ok(/^SWATC2\./.test(code) && JSON.stringify(Career.importCode(code)) === JSON.stringify(c), 'export → import roundtrip');
let threw = false; try { Career.importCode(code.slice(0, -8) + 'AAAAAAAA'); } catch (e) { threw = true; } ok(threw, 'damaged code rejected');
threw = false; try { Career.importCode('hello'); } catch (e) { threw = true; } ok(threw, 'garbage code rejected');
// mission flow: injuries → recovery, KIA → memorial + rookie, XP/promotion, record
c = Career.fresh(); const opts = Career.missionOpts(c); const S = Core.newGame(1234, opts);
ok(S.officers.length === 9 && S.officers.every(o => o.careerId), 'mission uses career roster');
const sm = Core.careerSummary(); sm.win = true; sm.outcome = 'negotiated'; sm.score = 900; sm.officers.forEach(o => { o.onScene = true; o.inTeam = true; });
const br = sm.officers.find(o => o.spec === 'breacher'), md = sm.officers.find(o => o.spec === 'medic');
br.cas = { state: 'kia', sev: 3 }; md.cas = { state: 'evacuated', sev: 2, stable: true };
const notes = Career.record(c, sm);
ok(c.record.played === 1 && c.record.wins === 1 && c.record.outcomes.negotiated === 1 && c.record.officersLost === 1 && c.record.officersHit === 2, 'record counts win, outcome, casualties');
ok(c.memorial.length === 1 && !c.roster.some(o => o.id === br.careerId), 'KIA moved to memorial');
ok(c.roster.filter(o => o.spec === 'breacher').length >= 1, 'roles stay staffed');
const medic = c.roster.find(o => o.id === md.careerId); ok(medic.recover === 1 && !Career.missionOpts(c).roster.some(o => o.id === medic.id), 'injured officer recovering, unavailable');
ok(notes.some(n => /recover/.test(n)) && c.points > 0 && c.history.length === 1, 'notes, points and history written');
const lead = c.roster.find(o => o.spec === 'leader'); ok(lead.xp > 0 && lead.missions === 1, 'XP awarded');
// sitting out heals: next mission without the medic
const S3 = Core.newGame(99, Career.missionOpts(c)); const sm3 = Core.careerSummary(); Career.record(c, sm3);
ok(medic.recover === 0 && Career.missionOpts(c).roster.some(o => o.id === medic.id), 'recovering officer returns after sitting one mission out');
for (let i = 0; i < 30; i++) { const s = Core.careerSummary(); s.win = true; s.score = 1000; s.officers.forEach(o => { o.onScene = true; o.inTeam = true; o.cas = null; }); Career.record(c, s); }
ok(c.roster.some(o => o.rank !== 'Ofc.' && o.spec !== 'leader'), 'officers promote with XP'); ok(c.roster.every(o => o.skill <= 0.95), 'skill growth capped');
console.log(`CAREER: ${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1;
