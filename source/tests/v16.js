// v16: ENCOUNTER (see-suspect) decision system — half-turn pause, reads with confidence, options/officers/likelihood words,
// first-fire rule, automatic return fire result, blind fire at the threshold, scoring and use-of-force review.
const fs = require('fs'), path = require('path');
const Core = require('./load.js')(); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const W = Core.MAP_W;
const prep = (seed, enc = true) => { const S = Core.newGame(seed, { encounters: enc }); S.officers.forEach(o => { o.status = 'staged'; o.stage = 'primary'; o.eta = 0; });
  const t = Core.formTeam(S.officers.slice(0, 4).map(o => o.id)).team; t.deployed = true; return { S, t }; };
// a cell in the suspect's room with a clear line, at least 2 cells away (avoids the hands-on arrest)
const placeLOS = (S, t, minD = 2) => { const sp = S.suspect, rm = S.rooms[sp.room]; for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) {
  if (S.block[y * W + x] || Math.max(Math.abs(x - sp.x), Math.abs(y - sp.y)) < minD || Core.los(x, y, sp.x, sp.y) !== 1) continue; t.x = x; t.y = y; t.orders = []; Core.updateVision(); return true; } return false; };
const runTurn = () => { Core.execute(); let g = 0; while (!Core.stepTick() && g++ < 200); return Core.state.phase; };
const settle = (pick) => { let k = 0, ph = Core.state.phase; while (ph === 'encounter' && k++ < 12) { const c = Core.encCur(); if (c && !c.done) Core.encChoose(pick && c.options.some(o => o.key === pick) ? pick : c.options[0].key); ph = Core.encNext(); } return ph; };

// 1) off by default (headless harness/bots unaffected); UI turns it on
ok(Core.ENC_CFG.enabled === false, 'encounters off by default in the core');
{ const { S, t } = prep(3, false); placeLOS(S, t); const ph = runTurn(); ok(ph !== 'encounter', 'no pause when encounters are off'); }

// 2) mind hooks: lazy, deterministic, light model fields
{ const { S } = prep(11); const m1 = JSON.stringify(Core.mindOf(S.suspect)); const { S: S2 } = prep(11); const m2 = JSON.stringify(Core.mindOf(S2.suspect));
  ok(m1 === m2, 'mind deterministic per seed'); const M = Core.mindOf(S.suspect);
  for (const k of ['selfHarm', 'sbc', 'harmOff', 'fightBare', 'trait']) ok(k in M, 'mind has ' + k);
  ok(M.hostageHook === false, 'hostage hook present but off (no hostage system)');
  const traits = new Set(); for (let s = 1; s <= 30; s++) { const { S } = prep(s); traits.add(Core.mindOf(S.suspect).trait); } ok(traits.size >= 4, 'trait variety ' + [...traits]); }

// 3) likelihood words: five buckets, no numbers
{ const w = [0.9, 0.6, 0.4, 0.2, 0.05].map(Core.encWord); ok(JSON.stringify(w) === JSON.stringify(['Very likely', 'Likely', 'Possible', 'Unlikely', 'Very unlikely']), 'words ' + w); }

// 4) real turns: pause at the end of the turn, fresh descriptions, options with officers and words
let contacts = 0, results = 0, poses = new Set(), confs = new Set(), misreads = 0, optsSeen = new Set(), wordsOK = true, whoOK = true;
for (let seed = 1; seed <= 40; seed++) { const { S, t } = prep(seed); if (!placeLOS(S, t, 2)) continue; const turn0 = S.turn; runTurn();
  if (S.phase !== 'encounter') continue; ok(S.enc.atEnd && S.turn === turn0, 'paused as a half-turn before the turn ends');
  for (const it of S.enc.items) { if (it.kind === 'result') { results++; ok(it.done && it.res.length > 0, 'result box has text'); continue; }
    if (it.kind !== 'contact') continue; contacts++; poses.add(it.pose); confs.add(it.read.conf); const M = Core.mindOf(S.suspect); if (M.read && M.read.looks === 'gun' && M.read.actual !== 'weapon') misreads++;
    ok(typeof it.text === 'string' && it.text.length > 30 && !/\d+\s*%/.test(it.text), 'description text');
    for (const o of it.options) { optsSeen.add(o.key); if (!['Very likely', 'Likely', 'Possible', 'Unlikely', 'Very unlikely'].includes(o.word)) wordsOK = false; if (!o.who.length || o.who.some(id => !S.officers.find(q => q.id === id))) whoOK = false; } }
  settle('hold'); ok(S.phase === 'planning' || S.phase === 'over', 'turn ends after the decisions (' + S.phase + ')'); ok(S.phase === 'over' || S.turn === turn0 + 1, 'turn advanced once'); }
ok(contacts >= 5, 'contact popups ' + contacts); ok(results >= 1, 'auto result boxes ' + results); ok(poses.size >= 4, 'pose variety ' + [...poses]);
ok(wordsOK, 'every option has a likelihood word'); ok(whoOK, 'every option lists capable officers'); ok(optsSeen.has('hold') && optsSeen.has('shoot') && optsSeen.has('v_hands'), 'core options ' + [...optsSeen]);

// 5) reads: confidence levels and misreads (phone taken for a gun) across many samples
{ const { S, t } = prep(5); placeLOS(S, t); const sp = S.suspect, M = Core.mindOf(sp); const c = new Set(); let mis = 0, n = 0; const w0 = sp.weapon;
  for (let i = 0; i < 400; i++) { sp.weapon = 'none'; const rd = Core.encRead(sp, t, ['record', 'call', 'conceal', 'pockets'][i % 4]); c.add(rd.conf); n++; if (rd.looks === 'gun') mis++; }
  for (let i = 0; i < 200; i++) { sp.weapon = 'handgun'; c.add(Core.encRead(sp, t, 'down').conf); }
  sp.weapon = w0; ok(c.size >= 3, 'confidence levels ' + [...c]); ok(mis > 0 && mis < n * 0.5, 'phones sometimes misread as a gun ' + mis + '/' + n);
  ok(['confident', 'uncertain', 'unknown'].every(k => [...c].includes(k)), 'confident / uncertain / unknown'); 
  const d = Core.encDescribe(sp, t, 'down', { actual: 'weapon', looks: 'gun', conf: 'confident', kind: 'handgun' }); ok(/confident it is a gun/.test(d), 'confident text: ' + d);
  const d2 = Core.encDescribe(sp, t, 'record', { actual: 'phone', looks: 'gun', conf: 'uncertain', kind: 'phone' }); ok(/uncertain but it looks like a gun/.test(d2), 'uncertain text: ' + d2); }

// 6) equipment gating: taser / 40mm / negotiator only when carried / on scene; officers have line + range
{ const { S, t } = prep(9); placeLOS(S, t); const sp = S.suspect; const rd = { actual: 'none', looks: 'empty', conf: 'confident' };
  let keys = Core.encOptions(sp, t, 'hands', rd).map(o => o.key); const hasTaser = Core.teamOk(t).some(o => Core.carries ? Core.carries(o, 'taser') : true);
  ok(!keys.includes('taser') || hasTaser, 'taser only if carried');
  ok(keys.includes('nego') === (Core.negOnScene().length > 0), 'negotiate only with a negotiator on scene');
  ok(Core.encWho(t, sp, 'v_hands').length === Core.teamOk(t).length, 'voice: every member with a line');
  const far = { ...t, x: t.x, y: t.y }; ok(Core.encWho(t, sp, 'withdraw').length > 0, 'withdraw listed'); void far; }

// 7) repeated commands and a negotiator change the odds
{ const { S, t } = prep(21); placeLOS(S, t); const sp = S.suspect, M = Core.mindOf(sp); M.cmd = {};
  const p0 = Core.encOdds(sp, t, 'v_hands', 'pockets'); M.cmd.v_hands = 2; const p2 = Core.encOdds(sp, t, 'v_hands', 'pockets'); ok(p2 !== p0, `repeat command changes odds ${p0.toFixed(2)}→${p2.toFixed(2)}`);
  M.cmd = {}; const neg = S.officers.find(o => (o.quals || []).includes('negotiator')); const before = Core.encOdds(sp, t, 'v_hands', 'pockets');
  const saved = S.officers.map(o => o.status); S.officers.forEach(o => { if (o.quals && o.quals.includes('negotiator')) o.status = 'enroute'; }); const without = Core.encOdds(sp, t, 'v_hands', 'pockets');
  S.officers.forEach((o, i) => o.status = saved[i]); ok(!neg || before >= without, 'negotiator on scene improves odds'); }

// 8) first-fire rule: 75% suspect first, cut by bang / gas / charge that turn
{ const { S } = prep(4); ok(Math.abs(Core.encFirstP() - 0.75) < 1e-9, 'first fire 75%'); Core.encMarkDev({ type: 'bang' }); const pb = Core.encFirstP(); ok(pb < 0.75, 'flashbang cuts it ' + pb);
  Core.encMarkDev({ type: 'gas' }); Core.encMarkDev({ type: 'breach', method: 'charge' }); ok(Core.encFirstP() >= Core.ENC_CFG.firstMin && Core.encFirstP() < pb, 'floor and stacking'); S.turn++; ok(Math.abs(Core.encFirstP() - 0.75) < 1e-9, 'only that turn'); }
// statistical: suspect first ~75%
{ let sf = 0, n = 0; for (let s = 1; s <= 120; s++) { const { S, t } = prep(s); placeLOS(S, t); const sp = S.suspect; if (!sp.weapon || sp.weapon === 'none') continue; sp.mode = 'alert'; S.phase = 'executing';
    const n0 = S.log.length; Core.encExchange(sp, t, 'aim'); const L = S.log.slice(n0).map(l => l.text).join(' '); if (/gets the first rounds off/.test(L)) sf++; n++; }
  ok(n > 40 && sf / n > 0.6 && sf / n < 0.9, `suspect first ${sf}/${n}`); }

// 9) armed and aiming: always justified, automatic exchange + result item (no prompt)
{ let found = false; for (let s = 1; s <= 80 && !found; s++) { const { S, t } = prep(s); if (S.suspect.weapon === 'none') continue; placeLOS(S, t, 2); S.suspect.mode = 'alert'; S.phase = 'executing'; const M = Core.mindOf(S.suspect);
    M.pose = 'aim'; M.poseTurn = S.turn; // sticky pose
    const orig = Core.encPose; const items = Core.encBuild(); const it = items.find(i => i.pose === 'aim');
    if (it) { found = true; ok(it.kind === 'result' && it.done, 'aim → result, no prompt'); ok(Core.encJustified(S.suspect, it), 'aiming always justified'); ok(!(S.reviews || []).length, 'no review'); } void orig; }
  ok(found, 'aim pose produced'); }

// 10) unjustified shot: review, 10 missions, 95% mission points cut; justified shot no review
{ const { S, t } = prep(14); placeLOS(S, t); const sp = S.suspect; sp.mode = 'alert'; S.phase = 'executing'; const M = Core.mindOf(sp); M.read = { actual: 'none', looks: 'empty', conf: 'confident' };
  const item = { kind: 'contact', sp: 0, uid: t.uid, pose: 'hands', options: Core.encOptions(sp, t, 'hands', M.read) }; Core.encPause([item], true);
  ok(!Core.encJustified(sp, item), 'hands visible → not justified'); const r = Core.encChoose('shoot', item.options.find(o => o.key === 'shoot').who[0]);
  ok(r.ok && S.reviews && S.reviews.length === 1 && S.reviews[0].missions === 10, 'review opened for 10 missions');
  const cs = Core.careerSummary ? Core.careerSummary() : null; ok(!cs || (cs.reviews && cs.reviews.length === 1), 'careerSummary carries the review');
  const items = []; const add = (label, pts) => items.push({ label, pts }); add('Base', 1000); Core.encScore(items, add); const net = items.reduce((a, i) => a + i.pts, 0);
  ok(net <= 60 && net >= 0, '95% reduction → ' + net); }
// scoring multipliers
{ const mk = (st) => { const { S } = prep(16); S.result = { win: true }; Object.assign(S.suspect, st); const items = []; const add = (label, pts) => items.push({ label, pts }); add('Base', 1000); Core.encScore(items, add); return items.reduce((a, i) => a + i.pts, 0); };
  const unhurt = mk({}), hurt = mk({ injured: true }), dead = mk({ deceased: true, injured: true });
  ok(unhurt > hurt && hurt > dead, `unhurt ${unhurt} > injured ${hurt} > killed ${dead}`); ok(hurt === 800 && dead === 330, 'injured 80% / killed 33%'); ok(unhurt >= 1300, 'custody unharmed bonus'); }

// 11) blind fire at the threshold: mid-turn pause, 4 choices, orders change
{ const C = Core.ENC_CFG, b0 = C.blind; C.blind = 50; let got = 0;
  for (let s = 1; s <= 40 && got < 4; s++) { const { S, t } = prep(s); const sp = S.suspect; if (sp.weapon === 'none') continue; sp.mode = 'alert'; const r = sp.room;
    S.phase = 'executing'; t.orders = [{ type: 'clear', room: r, fromAfter: true }, { type: 'move', x: sp.x, y: sp.y }];
    const key = ['cancel', 'continue', 'doorway', 'frame'][got]; const o = { type: 'bang', room: r };
    const res = Core.encThreshold(t, o); if (!res || S.phase !== 'encounter') continue; const it = Core.encCur(); ok(it.kind === 'blind' && it.options.length === 4, 'blind prompt with 4 choices');
    ok(!S.enc.atEnd, 'mid-turn pause'); const n0 = t.orders.length; Core.blindChoose(key); ok(it.done, 'blind choice resolves');
    if (key === 'cancel') ok(t.orders[0].type === 'hold' && !t.orders.some(q => q.fromAfter), 'cancel drops the entry');
    if (key === 'continue') ok(t.orders.some(q => q.fromAfter), 'continue keeps the entry');
    if (key === 'doorway' || key === 'frame') ok(!t.orders.some(q => q.fromAfter && q.type === 'clear'), key + ' drops going through');
    const ph = Core.encNext(); ok(ph === 'executing' || ph === 'over' || ph === 'encounter', 'resumes the turn: ' + ph); void n0; got++; }
  C.blind = b0; ok(got >= 3, 'blind prompts exercised ' + got); }

// 12) career: review sits the officer out 10 missions then cleared / reassigned
{ const Career = require('../src/career.js'); const c = Career.fresh ? Career.fresh() : Career.load(null); const o = c.roster[1];
  const base = { win: true, outcome: 'arrest', timeSec: 600, score: 500, patrol: { hit: 0, lost: 0 }, suspect: 'x', officers: [], actions: [], seed: 1, title: 'T' };
  Career.record(c, { ...base, officers: [{ careerId: o.id, id: 'O1', onScene: true, inTeam: true }], reviews: [{ careerId: o.id, missions: 10, removed: true }] });
  ok(o.recover === 10 && o.review && o.review.removed, 'officer out for 10, removal pending'); ok(!Career.available(c).includes(o), 'not available during review');
  for (let i = 0; i < 10; i++) Career.record(c, base); ok(!c.roster.includes(o), 'removed from the roster after the review');
  const c2 = Career.fresh ? Career.fresh() : Career.load(null); const o2 = c2.roster[2]; Career.record(c2, { ...base, reviews: [{ careerId: o2.id, missions: 10, removed: false }] });
  for (let i = 0; i < 10; i++) Career.record(c2, base); ok(c2.roster.includes(o2) && !o2.recover && !o2.review, 'cleared officer back on duty'); }

// 13) saves: mind / enc are plain data
{ const { S, t } = prep(8); placeLOS(S, t); Core.mindOf(S.suspect); const j = JSON.stringify({ m: S.suspect.mind, e: S.enc || null, r: S.reviews || [] }); ok(j.length > 10, 'plain JSON data'); }

// 14) built file, help, iOS meta, no gore wording
{ const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'); ok(html.includes('Encounters (seeing the suspect)'), 'help section'); ok(html.includes('id="m-enc"'), 'encounter modal');
  ok(html.includes('apple-mobile-web-app-capable') && html.includes('apple-touch-icon'), 'iOS meta kept'); ok(html.includes('d9') || html.includes('encBuild'), 'core built in');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core_parts', 'd9_encounter.js'), 'utf8'); ok(!/\b(blood|gore|brains|kill shot|splatter)\b/i.test(src), 'neutral wording'); }

console.log(`v16: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
