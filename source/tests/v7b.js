// v7b: initial arrivals, team level roster, Work Corner, formations, Call State SWAT, XP log, preview.
const Core = require('./load.js')(); const Career = require('../src/career.js'); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const runTurn = () => { Core.execute(); let g = 0; while (!Core.stepTick() && g++ < 50); };
const staged0 = S => S.officers.filter(o => o.status === 'staged').length;
// 1) arrivals: >=1 on scene at start across many seeds/levels; full-team case occurs and logs
{ const modes = { few: 0, group: 0, all: 0 }; let minArr = 99, allLogged = 0, allCount = 0, briefOk = 0, N = 0;
  for (let s = 1; s <= 150; s++) { const lvl = s % 3 === 0 ? 1 : s % 3 === 1 ? 100 : 1 + (s * 37) % 100;
    const S = Core.newGame(5000 + s, Career.quickOpts(lvl)); N++; const k = staged0(S); minArr = Math.min(minArr, k); modes[S.arrival.mode]++;
    if (S.brief && S.brief.arrival && S.brief.arrival.count === k) briefOk++;
    if (S.arrival.mode === 'all') { allCount++; if (k === S.officers.length && S.log.some(l => /FULL TEAM ON SCENE/.test(l.text || l.t || l.msg || String(l))) && S.arrival.why) allLogged++; }
    else ok(k < S.officers.length && S.officers.some(o => o.status === 'enroute' && o.eta > 0), `seed ${5000 + s}: rest still en route`); }
  ok(minArr >= 1, `>=1 officer on scene at start in every scenario (min ${minArr})`);
  ok(modes.all >= 2 && modes.all <= 25, `full-team arrival occurs at a small rate (${modes.all}/${N})`);
  ok(modes.few > modes.group && modes.group > 0, `usually 1-3, sometimes a group (${JSON.stringify(modes)})`);
  ok(allLogged === allCount, `full-team case logged with reason (${allLogged}/${allCount})`); ok(briefOk === N, 'mission brief carries arrival info');
  ok(Core.ARRIVE_CFG.allP >= 0.05 && Core.ARRIVE_CFG.allP <= 0.08, 'configured full-team chance 5-8%'); }
// 2) level 1 small team still gets >=1; forced 'all' path
{ let m = 99; for (let s = 1; s <= 40; s++) { const S = Core.newGame(900 + s, Career.quickOpts(1)); ok(S.officers.length === 4, 'level 1 roster = 4'); m = Math.min(m, staged0(S)); } ok(m >= 1, 'level 1: >=1 arrived');
  const S = Core.newGame(77, Career.quickOpts(100)); ok(S.officers.length === 30, 'level 100 roster = 30');
  const saved = Core.ARRIVE_CFG.allP; Core.ARRIVE_CFG.allP = 1; const S2 = Core.newGame(78, Career.quickOpts(20)); Core.ARRIVE_CFG.allP = saved;
  ok(staged0(S2) === S2.officers.length && S2.arrival.mode === 'all', 'forced full-team: everyone staged');
  ok(S2.log.some(l => /FULL TEAM ON SCENE/.test(JSON.stringify(l))), 'forced full-team: log line'); }
// 3) level changes roster, not the map
{ const a = Core.newGame(4321, Career.quickOpts(1)), A = JSON.stringify(a.doors.map(d => d.cells)); const b = Core.newGame(4321, Career.quickOpts(100));
  ok(A === JSON.stringify(b.doors.map(d => d.cells)), 'same seed → same map at any level'); }
// 4) formations
{ const S = Core.newGame(31, Career.quickOpts(100)); S.officers.forEach(o => { o.status = 'staged'; o.eta = 0; });
  const t = Core.formTeam(S.officers.slice(0, 6).map(o => o.id)).team; const f = Core.formationFor(t);
  ok(f.pts.length === 6, `one dot per member (${f.pts.length})`); ok(['cover', 'line', 'stack', 'column', 'fan'].includes(f.kind), `outside kind ${f.kind}`);
  const d = S.doors.find(x => x.name === 'Front Door'); const kinds = new Set([f.kind]);
  // inside a room → fan; next to a door → stack
  const r = S.rooms.find(r => r.w >= 3 && r.h >= 3); if (r) { t.x = r.x + Math.floor(r.w / 2); t.y = r.y + Math.floor(r.h / 2); const g = Core.formationFor(t); kinds.add(g.kind); ok(g.kind === 'fan' || g.kind === 'column', `inside room → ${g.kind}`); }
  if (d) { const [[a0, a1], [b0, b1]] = d.cells[0]; const out = Core.roomAt(a0, a1) < 0 ? [a0, a1] : [b0, b1]; t.x = out[0]; t.y = out[1]; const g = Core.formationFor(t); kinds.add(g.kind); ok(g.kind === 'stack', `at front door → ${g.kind}`); }
  ok(kinds.size >= 2, 'formation adapts to context'); t.members.slice(2).forEach(id => { S.officers.find(o => o.id === id).status = 'down'; }); ok(Core.formationFor(t).pts.length === 2, 'dots follow active members'); }
// 5) Work Corner: availability, 45° cuts, reveal, stop on threat
{ let tried = 0, revealed = 0, threat = 0, cleared = 0;
  for (const seed of [1234, 11, 23, 57, 101, 314, 777]) { const S = Core.newGame(seed); S.officers.forEach(o => { o.status = 'staged'; o.eta = 0; });
    const t = Core.formTeam(S.officers.slice(0, 4).map(o => o.id)).team; let spot = null;
    for (let y = 0; y < Core.MAP_H && !spot; y++) for (let x = 0; x < Core.MAP_W && !spot; x++) if (Core.roomAt(x, y) >= 0 && Core.cornerAt(x, y)) spot = [x, y];
    if (!spot) continue; tried++; t.x = spot[0]; t.y = spot[1]; Core.updateVision();
    ok(typeof Core.cornerAvail(t) === 'object', 'cornerAvail at corner cell'); const before = new Set(S.vis ? [...S.vis.keys ? S.vis.keys() : []] : []);
    const c = Core.cornerAt(t.x, t.y, t); ok(c.hidden.length >= Core.CORNER_CFG.minHidden, 'corner hides enough cells');
    const q = Core.queueOrder(t.uid, { type: 'corner' }); ok(q && q.ok !== false, `corner order queued (${q && q.reason})`);
    // put the suspect in the hidden area on odd seeds to test the stop
    if (seed % 2) { const h = c.hidden[c.hidden.length - 1][0]; S.suspect.x = h % Core.MAP_W; S.suspect.y = Math.floor(h / Core.MAP_W); }
    const logN = S.log.length; for (let i = 0; i < 3 && S.phase !== 'over'; i++) runTurn();
    const L = S.log.slice(logN).map(l => JSON.stringify(l)).join('\n');
    if (/slicing the pie/.test(L)) revealed++; if (/THREAT/.test(L)) threat++; if (/corner clear/.test(L)) cleared++;
    ok(!t.slice || t.slice.cut <= Core.CORNER_CFG.cuts, 'cuts capped'); }
  ok(tried >= 3, `corner found on ${tried} maps`); ok(revealed === tried, 'corner work logged'); ok(threat + cleared >= tried - 1, `corner ends with THREAT or clear (${threat}/${cleared})`); ok(threat >= 1, 'stops on a threat');
  ok(Core.ACT_XP.corner && Core.ACT_XP.threat, 'corner XP keys'); }
// 6) patrols can't slice into the house; outside corner ok
{ const S = Core.newGame(1234); const p = S.units.find(u => u.kind === 'patrol'); const r = Core.cornerAvail(p); ok(typeof r === 'string' || (r && Core.roomAt(r.px, r.py) < 0), 'patrol corner never steps inside'); }
// 7) Call State SWAT: career only, action XP only
{ Core.newGame(8, Career.quickOpts(50)); ok(!Core.callState().ok, 'quick mission: no state hand-over');
  const c = Career.fresh(); const S = Core.newGame(8, Career.missionOpts(c)); Core.xpAct('contact', null, 'test'); const r = Core.callState();
  ok(r.ok && S.phase === 'over' && /STATE SWAT/.test(S.result.title || S.result.text || JSON.stringify(S.result)), 'career: state team takes over');
  const sm = Core.careerSummary(); ok(sm.outcome === 'state' && sm.stateTakeover && sm.actions.length >= 1, 'summary carries actions');
  ok(Core.missionScore().items.some(i => i.pts === Core.SCORE.stateTeam), 'state hand-over deduction'); }
// 8) preview of random calls
{ const p = Core.preview(222, Career.quickOpts(10)); ok(p.seed === 222 && p.addr && p.diff >= 1 && p.diff <= 3 && p.label, 'preview fields');
  const S = Core.newGame(5); const v = S.version; Core.preview(6); ok(Core.state === S, 'preview restores state'); }
// 9) neutral wording in new log text
{ const S = Core.newGame(4242); ok(!S.log.some(l => /blood|gore|kill/i.test(JSON.stringify(l))), 'neutral arrival wording'); }
console.log(`V7B: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
