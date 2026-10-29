// v19: specialties (ll / gas / driver + dual specialties at 75%), take-home gear, helmets, equipment issue screen,
//      single-shot vs 4-shot 40mm (reload = a full turn, one round per turn), 40mm CS (1/4 canister), gas-bag accuracy.
const fs = require('fs'), path = require('path');
const Core = require('./load.js')(); const Career = require('../src/career.js'); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const prep = (seed, extra = {}) => { const S = Core.newGame(seed, Object.assign({ encounters: false }, extra)); S.officers.forEach(o => { o.status = 'staged'; o.stage = 'primary'; o.eta = 0; }); return S; };
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const run = () => { Core.execute(); let g = 0; while (Core.state.phase === 'executing' && !Core.stepTick() && g++ < 300); };
const inv = o => Core.off(o.id || o).inv;

// --- version + UI hooks ---
ok(Core.GAME_VERSION === 'v19' && (html.match(/'v19'/g) || []).length === 1, 'GAME_VERSION v19 defined once');
ok(/id="m-issue"/.test(html) && /function openIssue/.test(html) && /openIssue\(r\.team\.uid\)/.test(html), 'issue screen opens after forming a team');
ok(/k: 'cs40'/.test(html) && /Specialties &amp; take-home|Specialties & take-home/.test(html) && /40mm launchers &/.test(html), 'cs40 button + help sections');
ok(/apple-touch-icon/.test(html) && /apple-mobile-web-app-capable/.test(html), 'iOS meta kept');
ok(['ll', 'gas', 'driver'].every(k => Core.SPECS[k] && Core.SPECS[k].name), 'new specialties defined');

// --- take-home: everyone ---
{ const S = prep(5); const all = S.officers.map(o => Core.invOf(o));
  ok(all.every(v => (v.hands.includes('pistol') || v.holster.includes('pistol')) && (v.hands.includes('taser') || v.holster.includes('taser'))), 'all take home pistol + taser');
  ok(S.officers.every(o => o.spec === 'marksman' ? Core.carries(o, 'sniper') : Core.carries(o, 'rifle')), 'all take home a rifle (precision rifle for snipers)');
  ok(S.officers.every(o => Core.armorOf(o) === 'soft' && Core.helmetOf(o) === 'std' && o.inv.mask), 'no plates unlocked → soft armor + IIIA helmet + gas mask');
  const pt = S.officers.find(o => o.spec === 'point'), br = S.officers.find(o => o.spec === 'breacher'), mk = S.officers.find(o => o.spec === 'marksman'), md = S.officers.find(o => o.spec === 'medic');
  ok(Core.holds(pt, 'shield') && Core.holds(pt, 'pistol') && pt.inv.home.includes('shield'), 'point takes home a IIIA shield (in hand with the pistol)');
  ok(Core.holds(br, 'ram') && Core.carries(br, 'halligan'), 'breacher takes home ram + halligan');
  ok(Core.carries(mk, 'scope') && Core.carries(mk, 'sniper'), 'sniper takes home precision rifle + scope');
  ok(Core.carries(md, 'medkit'), 'medic takes home a medical bag');
  ok(S.armory.shield === Core.EQUIP.shield.pool && S.armory.ram === Core.EQUIP.ram.pool, 'take-home gear does not consume the vehicle pool'); }
{ const S = prep(5, { gear: { plate: 4 } }); ok(S.officers.every(o => Core.armorOf(o) === 'plate' && Core.helmetOf(o) === 'rifle'), 'plates unlocked → everyone takes home rifle plates + rifle-rated helmet'); }
{ const S = prep(5, { gear: { shield: 0, ram: 0, lesslethal: 0 } }); const pt = S.officers.find(o => o.spec === 'point'), br = S.officers.find(o => o.spec === 'breacher');
  ok(!Core.carries(pt, 'shield') && !Core.carries(br, 'ram') && !S.officers.some(o => Core.carries(o, 'lesslethal')), 'take-home gated by unlocks (no shield / ram / 40mm when locked)'); }
{ const T = Career.teamForLevel(1), S = prep(3, Career.quickOpts(1)); ok(!S.officers.some(o => Core.carries(o, 'lesslethal')) && T.gear.cs40 === 0 && T.gear.gasbag === 0, 'level 1: no 40mm, no CS rounds, no gas bags');
  const T2 = Career.teamForLevel(50); ok(T2.gear.cs40 >= 4 && T2.gear.gasbag >= 1, 'level 50 unlocks 40mm CS + gas bags'); }

// --- specialties: conversion, spec2, multipliers ---
{ let llN = 0, gasN = 0, drN = 0, s2 = 0, tot = 0;
  for (let s = 1; s <= 60; s++) { const S = Core.newGame(s); llN += S.officers.filter(o => o.spec === 'll').length; gasN += S.officers.filter(o => o.spec === 'gas').length; drN += S.officers.filter(o => o.spec === 'driver').length;
    s2 += S.officers.filter(o => o.spec2).length; tot += S.officers.length;
    if (S.officers.some(o => o.spec2 === o.spec || (o.spec2 && ['leader', 'k9'].includes(o.spec2)))) ok(false, 'bad spec2 seed ' + s); }
  ok(llN > 0 && gasN > 0, `ll / gas specialists appear (${llN} / ${gasN})`); ok(s2 / tot > 0.2 && s2 / tot < 0.7, `dual specialties common (${(100 * s2 / tot).toFixed(0)}%)`);
  const T = Career.quickOpts(100), S = Core.newGame(9, T); drN += S.officers.filter(o => o.spec === 'driver').length; ok(drN > 0, 'drivers appear on big armored rosters'); }
{ const S = prep(5); const a = S.officers.find(o => o.spec2), sp2 = a.spec2;
  ok(Core.specMul(a, a.spec) === 1 && Core.specMul(a, sp2) === 0.75 && Core.specMul(a, 'k9') === 0 && Core.SPEC2_MUL === 0.75, 'primary 100% / secondary 75% / other 0');
  ok(Core.isSpec(a, sp2), 'isSpec counts the secondary specialty');
  ok(S.officers.filter(o => o.spec === 'll' || o.spec2 === 'll').every(o => o.quals.includes('ll')), 'll specialists are 40mm qualified'); }
{ const S = prep(5); const b = S.officers.find(o => o.spec2 === 'breacher'); const t = Core.formTeam([b.id]).team;
  ok(Core.teamSpecMul(t, 'breacher') === 0.75, 'team breacher bonus from a 2nd-spec breacher is 75%');
  ok(!Core.carries(b, 'charge'), '2nd-spec breacher gets no charges automatically');
  const before = S.armory.charge, r = Core.fetchSecondary(b.id); ok(r.ok && Core.carries(b, 'charge') && S.armory.charge < before, 'Fetch 2nd-spec kit draws charges at the vehicle: ' + (r.reason || r.got)); }
{ const S = prep(5); const m = S.officers.find(o => o.spec2 === 'medic' && o.spec !== 'medic'); if (m) { Core.formTeam([m.id]); ok(!Core.carries(m, 'medkit'), '2nd-spec medic not auto-issued a medkit'); ok(Core.fetchSecondary(m.id).ok && Core.carries(m, 'medkit'), 'fetch the medkit manually'); } else ok(true, 'skip'); }

// --- issue screen model: primary vs secondary staging ---
{ const S = Core.newGame(4242, { encounters: false }); S.officers.forEach(o => { o.status = 'staged'; o.eta = 0; });
  const sec = S.officers.filter(o => o.stage === 'secondary'); const r = Core.formTeam(sec.slice(0, 3).map(o => o.id)); const v = Core.issueView(r.team.uid);
  ok(v && v.stage === 'secondary' && !v.atEq, 'issue view: secondary staging (on foot)');
  ok(!Core.invAct(sec[0].id, 'draw', 'bang').ok, 'secondary: nothing drawn away from the vehicle');
  ok(sec.slice(0, 3).every(o => !Core.carries(o, 'bang') && !Core.carries(o, 'charge')), 'secondary team has take-home only');
  const pri = S.officers.filter(o => o.stage === 'primary' && !o.team); const r2 = Core.formTeam(pri.slice(0, 4).map(o => o.id)); const v2 = Core.issueView(r2.team.uid);
  ok(v2.stage === 'primary' && v2.atEq && v2.members.length === r2.team.members.length && v2.pool.length > 5, 'issue view: primary staging with vehicle pool');
  ok(r2.team.members.map(Core.off).some(o => Core.carries(o, 'bang')), 'primary team pre-issued vehicle kit'); }

// --- 40mm: single shot (take-home) vs 4-shot (vehicle), reload a full turn, one per turn ---
{ const S = prep(5); const l = S.officers.find(o => o.spec === 'll'); ok(l && Core.llKind(l) === 'single' && Core.carries(l, 'lesslethal'), 'll specialist takes home the single-shot 40mm');
  const iv = l.inv; S.turn = 3; S.phase = 'executing'; Core.llSpend(l); ok(iv.reloadT === 4 && !Core.llOk(l), 'single shot: reload after every round');
  S.turn = 4; ok(!Core.llOk(l), 'reloading through the next turn'); S.turn = 5; ok(Core.llOk(l), 'ready again after a full turn'); S.phase = 'planning';
  // draw the 4-shot: replaces the single shot, brings CS rounds
  const t = Core.formTeam([l.id]).team; const r = Core.invAct(l.id, 'draw', 'lesslethal');
  ok(Core.llKind(l) === 'multi' && (iv.vest.cs40 || 0) > 0, '4-shot launcher from the vehicle brings 40mm CS rounds: ' + (r.reason || 'ok'));
  ok(!Core.invAct(l.id, 'return', 'scope').ok || true, 'noop');
  iv.ll = 6; iv.llLoad = 4; iv.reloadT = -1; S.phase = 'executing'; let reloads = 0;
  for (let k = 0; k < 4; k++) { S.turn = 10 + k; ok(Core.llOk(l), '4-shot ready turn ' + k); Core.llSpend(l); ok(!Core.llOk(l), 'one round per turn ' + k); if (iv.reloadT >= S.turn) reloads++; }
  ok(reloads === 1 && iv.llLoad === 2 && iv.ll === 2, `4-shot: four rounds then one reload (${reloads}, load ${iv.llLoad})`);
  S.phase = 'planning'; S.turn = 20; const rr = Core.invAct(l.id, 'return', 'lesslethal'); ok(rr.ok && Core.llKind(l) === 'single' && !(iv.vest.cs40 > 0), 'returning the 4-shot → back to the take-home single shot, CS back to the vehicle');
  ok(!Core.invAct(l.id, 'draw', 'cs40').ok, 'CS rounds only with the 4-shot'); }

// --- 40mm CS order: a quarter of a canister into the room ---
{ let done = 0, tried = 0, amt = [];
  for (let s = 1; s <= 30 && done < 4; s++) { const S = prep(s); S.phase = 'planning';
    const l = S.officers.find(o => o.spec === 'll'); if (!l) continue;
    const t = Core.formTeam([l.id]).team; Core.invAct(l.id, 'draw', 'lesslethal'); if (!Core.holds(l, 'lesslethal')) Core.invAct(l.id, 'switch', 'lesslethal');
    S.turn++; Core.syncEquip(t); if (!(t.equip.cs40 > 0)) continue; t.deployed = true; tried++;
    let spot = null, room = -1;
    for (let ri = 0; ri < S.rooms.length && !spot; ri++) for (let y = 0; y < 71 && !spot; y++) for (let x = 0; x < 112 && !spot; x++)
      if (Core.roomAt(x, y) < 0 && Math.hypot(x - t.x, y - t.y) < 40 && Core.canThrowFrom(x, y, ri, null, t, 'cs40')) { spot = [x, y]; room = ri; }
    if (!spot) continue; t.x = spot[0]; t.y = spot[1];
    if (!Core.queueOrder(t.uid, { type: 'cs40', room }).ok) continue; const c0 = l.inv.vest.cs40; run();
    if (S.rooms[room].gas > 0) { done++; amt.push(S.rooms[room].gas); ok(l.inv.vest.cs40 === c0 - 1, 'one CS round used'); } }
  ok(done >= 2, `40mm CS deploys gas (${done}/${tried})`); ok(amt.length && amt.every(a => a > 0.05 && a <= 0.3), '≈1/4 canister of CS: ' + amt.map(a => a.toFixed(2)).join(',')); }
{ const S = prep(5); const t = Core.formTeam([S.officers.find(o => o.spec === 'negotiator').id]).team; t.deployed = true; const r = Core.queueOrder(t.uid, { type: 'cs40', room: 0 }); ok(!r.ok && /40mm CS/.test(r.reason), 'no launcher → cs40 refused: ' + r.reason); }
{ const S = prep(5); Core.gasAdd(0, 0.275); Core.gasAdd(0, 0.275); ok(Math.abs(S.rooms[0].gas - 0.55) < 0.02, 'CS rounds stack'); }

// --- gas bag accuracy + helmet (own rngs) ---
{ const S = prep(5); const g = S.officers.find(o => o.spec === 'gas') || S.officers[1]; const plain = S.officers.find(o => o !== g && o.spec !== 'gas');
  let mp = 0, mg = 0; for (let i = 0; i < 4000; i++) { if (Core.gasThrowAmt(plain) < 1) mp++; }
  g.spec = 'gas'; Core.invOf(g).packed.gasbag = 1; for (let i = 0; i < 4000; i++) { if (Core.gasThrowAmt(g) < 1) mg++; }
  ok(mp / 4000 > 0.08 && mp / 4000 < 0.16 && mg / 4000 < 0.05, `gas specialist with a gas bag throws more accurately (${mp} vs ${mg} misses)`);
  const r0 = S.rng(); const S2 = prep(5); Core.gasThrowAmt(S2.officers[0]); ok(S2.rng() === r0, 'gas accuracy uses its own rng'); }
{ const S = prep(5); const o = S.officers[2]; let hp = 0, hr = 0; for (let i = 0; i < 4000; i++) { if (Core.helmetStops(o, 'pistol')) hp++; if (Core.helmetStops(o, 'rifle')) hr++; }
  ok(hp > 900 && hp < 1300 && hr === 0, `IIIA helmet stops some handgun head hits, no rifle (${hp}, ${hr})`);
  const t = Core.formTeam([o.id]).team; let res = {}; for (let i = 0; i < 3000; i++) { const a = Core.armorHit(o, null, 'pistol', 8); res[a.res] = (res[a.res] || 0) + 1; }
  ok(res.helmet > 200 && res.pen > 0, 'armorHit reports helmet stops: ' + JSON.stringify(res)); }

// --- quick balance smoke: a level-50 game runs to completion turns without errors ---
{ let err = 0; for (let s = 1; s <= 4; s++) { try { const S = Core.newGame(s * 7, Career.quickOpts(50)); for (let k = 0; k < 6 && S.phase !== 'over'; k++) { S.officers.forEach(o => { if (o.status === 'enroute') o.eta = 0; }); run(); if (S.phase === 'encounter') break; } } catch (e) { err++; console.log(e.stack); } }
  ok(!err, 'level-50 games run'); }
console.log(`v19: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
