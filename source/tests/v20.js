// v20 (batch 1, items 1-17): window CS prompt, confirmed weapon + fair-fire window, reaction prompts + End turn, officer tags,
//   "surrendering", house formations (≤ 2 m), injury wording, officer-hit banner + buddy aid, ram return, no 'home' wording,
//   voice callout, thrower menu, delayed BearCat + driver + 11 seats, Draco install times + tip devices, team names, fire rates.
const fs = require('fs'), path = require('path');
const Core = require('./load.js')(); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const prep = (seed, extra = {}) => { const S = Core.newGame(seed, Object.assign({ encounters: false }, extra)); S.officers.forEach(o => { o.status = 'staged'; o.stage = 'primary'; o.eta = 0; }); return S; };
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const team = (S, n = 4, pred) => Core.formTeam((pred ? S.officers.filter(pred).concat(S.officers.filter(o => !pred(o))) : S.officers).slice(0, n).map(o => o.id)).team;
const GORE = /blood|gore|brain|guts|splatter|gush|mangled|severed/i;

// --- version / UI hooks ---
ok(/^v2\d$/.test(Core.GAME_VERSION) && (html.match(new RegExp("'" + Core.GAME_VERSION + "'", 'g')) || []).length === 1, 'GAME_VERSION >= v20 defined once');
ok(/apple-touch-icon/.test(html) && /apple-mobile-web-app-capable/.test(html), 'iOS meta kept');
ok(/id="m-pick"/.test(html) && /function throwPick/.test(html), 'thrower pick modal');
ok(['Contact prompts (v20)', 'Confirmed weapon (v20)', 'Officer hit (v20)', 'BearCat &amp; Draco (v20)|BearCat & Draco (v20)', 'Team names &amp; rates of fire (v20)|Team names & rates of fire (v20)'].every(h => new RegExp(h.replace(/[()]/g, '\\$&')).test(html)), 'v20 help sections');
ok(/dtbang/.test(html) && /dtgas/.test(html) && /data-tname/.test(html) && /data-pick/.test(html), 'Draco Bang/CS buttons, team-name presets, pick-up chips');

// --- 1: window CS throw prompt ---
ok(Core.WIN_OPTS.map(o => o.key).join() === 'wfire,wretreat,wwithdraw' && Core.WIN_OPTS.every(o => !/enter/i.test(o.label + o.sub)), 'window options: fire / fire+retreat / withdraw, no enter');
{ let tried = 0, good = 0; const b0 = Core.ENC_CFG.blind, h0 = Core.ENC_CFG.blindHit; Core.ENC_CFG.blind = 50; Core.ENC_CFG.blindHit = 0;
  for (let seed = 1; seed <= 40 && tried < 5; seed++) { const S = prep(seed, { encounters: true }); const sp = Core.suspList()[0]; if (sp.weapon === 'none') continue;
    const w = S.windows.find(q => q.room === sp.room); if (!w) continue; const e = w.edges[0]; const out = Core.roomAt(e[0], e[1]) === sp.room ? [e[2], e[3]] : [e[0], e[1]]; if (Core.roomAt(out[0], out[1]) >= 0) continue;
    const t = team(S, 4); t.deployed = true; t.x = out[0]; t.y = out[1]; S.phase = 'executing'; tried++;
    Core.encThreshold(t, { type: 'gas', room: sp.room }); const it = Core.encCur(); if (!it) continue;
    const keys = it.options.map(o => o.key);
    if (it.win && keys.join() === 'wfire,wretreat,wwithdraw,endturn' && !/doorway|threshold|in the room/i.test(it.text) && /window/i.test(it.text) && Core.blindChoose('wwithdraw').ok) good++; }
  Core.ENC_CFG.blind = b0; Core.ENC_CFG.blindHit = h0; ok(tried > 0 && good === tried, `window throw prompt (${good}/${tried})`); }

// --- 2: confirmed weapon / fair-fire window ---
{ const S = prep(7, { encounters: true }); const sp = Core.suspList()[0]; sp.weapon = 'handgun'; const t = team(S, 4); t.deployed = true;
  sp.firedAt = S.turn; sp.armedKnown = true; const rd = Core.encRead(sp, t, 'away');
  ok(rd.conf === 'known' && rd.actual === 'weapon', 'after he fires the read is KNOWN weapon (not unknown)');
  ok(!/cannot tell|unknown/i.test(Core.confText(rd, sp)) && /fired at officers/.test(Core.confText(rd, sp)), 'confidence text says he fired, never unknown');
  ok(Core.encJustified(sp, { pose: 'away' }) && Core.encFair(sp), 'shooting within 30 s of his fire is justified (no review)');
  S.turn += 2; ok(!Core.encFair(sp), 'fair-fire window ends after one turn');
  let resets = 0; for (let k = 0; k < 60; k++) { sp.weapon = 'handgun'; sp.armedKnown = true; sp.firedAt = null; Core.mindOf(sp).lastSeen = S.turn - 3; const r = Core.encRead(sp, t, 'away'); if (r.reassess && !sp.armedKnown || r.reassess) resets++; S.turn++; }
  ok(resets === 60, 'out of sight for a while → officers must reassess'); }

// --- 3: reaction prompts + End turn ---
{ const S = prep(9, { encounters: true }); const sp = Core.suspList()[0]; const t = team(S, 4); t.deployed = true;
  const opts = Core.withSp ? Core.withSp(sp, () => Core.encOptions(sp, t, 'away', { conf: 'confident', looks: 'gun', actual: 'weapon' })) : Core.encOptions(sp, t, 'away', {});
  ok(opts.length > 1 && opts[opts.length - 1].key === 'endturn' && opts[opts.length - 1].label === 'End turn', 'End turn is the last option');
  sp.mode = 'barricaded'; const tx = Core.encReactText(sp, 'shoot', { stun: 0, inj: false, armed: true }, 'fire', true); ok(/fired at the officers/.test(tx) && /missed/.test(tx), 'reaction text describes his response: ' + tx);
  sp.mode = 'surrendered'; ok(/complies/.test(Core.encReactText(sp, 'command', { armed: true }, 'comply', true)), 'compliance reaction');
  // --- 5 ---
  ok(Core.spState(sp) === 'surrendering', 'surrendered-not-in-custody shows "surrendering"'); sp.mode = 'detained'; ok(Core.spState(sp) === 'in custody', 'custody label'); }

// --- 4 / 12: officer tags + thrower menu ---
{ const S = prep(11); const t = team(S, 4, o => o.spec === 'point'); t.deployed = true; const p = S.officers.find(o => o.id === t.members[0]);
  const tag = Core.offTag(p.id); ok(/^Point · /.test(tag) && /Hands: /.test(tag), 'pick-list tag: role · specialty · hands (' + tag + ')');
  ok(/Defense/.test(Core.offTag(t.members[1])), 'second member is Defense');
  const picks = Core.throwPicks(t.uid, 'bang'); ok(picks.length === t.members.length && picks.every(q => /Hands:/.test(q.tag)), 'thrower menu lists each member with role/spec/hands');
  const r = Core.prepThrower(t.uid, p.id, 'bang'); ok(r.ok && Core.invOf(p).hands.every(x => !x || (Core.ITEM_CFG[x] || {}).stow) , 'chosen thrower sets down what cannot be stowed');
  ok(Core.droppedNear(t.uid).some(d => d.k === 'shield'), 'shield left on the ground near the team');
  const pu = Core.pickUp(t.uid, Core.droppedNear(t.uid).find(d => d.k === 'shield').i); ok(pu.ok && Core.holds(pu.o, 'shield'), 'anyone within 2 m can pick it up'); }

// --- 6: house formations ---
{ let n = 0, bad = 0, worst = 0;
  for (let seed = 1; seed <= 25; seed++) { const S = Core.newGame(seed); const t = Core.formTeam(S.officers.slice(0, 6).map(o => o.id)).team; if (!t) continue; t.deployed = true;
    for (const r of S.rooms) { if (r.w < 3 || r.h < 3) continue; t.x = r.x + Math.floor(r.w / 2); t.y = r.y + Math.floor(r.h / 2); t.orders = []; const f = Core.formationFor(t); if (f.pts.length < 2) continue;
      n++; const g = Core.formGap(f.pts); worst = Math.max(worst, g); if (g > 2.001) bad++; } }
  ok(n > 20 && bad === 0, `inside a house each member is within 2 m of a teammate (${n} rooms, worst ${worst.toFixed(2)} m)`); }

// --- 7: injury wording ---
{ const S = prep(13); const sp = Core.suspList()[0]; let all = []; for (let k = 0; k < 30; k++) { S.turn = k; all.push(Core.injWhere(sp, 'mobile'), Core.injWhere(sp, 'down')); }
  ok(all.every(s => /hit|grazed/.test(s) && !GORE.test(s)), 'injury described neutrally'); sp.injuryText = all[0]; ok(Core.injText(sp).includes(all[0]), 'injury text shown'); }

// --- 8: officer hit banner + buddy aid ---
{ const S = prep(15); const m = Core.hitMessage({ id: 'x', name: 'Ofc. Test', sev: 2, state: 'wounded', crit: 6 }, 'Team 1');
  ok(/OFFICER HIT — Ofc\. Test \(Team 1\): .+, serious\. Time until critical/.test(m.text) && !GORE.test(m.text), 'hit banner: where, how bad, time until critical');
  ok(Core.CAS_CFG.aidOther === Math.max(1, Math.round(Core.CAS_CFG.medicSevere / 3)), 'buddy aid = 1/3 of a medic with a bag'); }

// --- 9 / 10: ram removable; no 'home' wording ---
{ const S = prep(17); const br = S.officers.find(o => o.spec === 'breacher'); const t = team(S, 4, o => o.spec === 'breacher');
  ok(Core.carries(br, 'ram'), 'breacher starts with a ram'); const r = Core.invAct(br.id, 'return', 'ram'); ok(r.ok && !Core.carries(br, 'ram'), 'ram can be removed at the equipment vehicle (zero rams): ' + (r.reason || '')); void t; }
ok(!/>TAKE-HOME</.test(html) && !/Home: \$\{/.test(html), 'equipment summaries do not say "home"');
ok(!/[Tt]akes? home|[Tt]ake-home (gear|kit)|<b>Take-home/.test(html.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')), 'no take-home wording in visible text (v20)');

// --- 11: voice callout ---
{ const S = prep(19); const t = team(S, 4); t.deployed = true; for (const id of t.members) { const v = Core.invOf(Core.off(id)); v.hands = v.hands.map(x => x === 'bullhorn' ? null : x); for (const b of ['packed', 'vest']) if (v[b]) delete v[b].bullhorn; }
  ok(!Core.bullhornUsable(t) && Core.calloutMode(t) === 'voice', 'no bullhorn → voice callout');
  const far = Core.queueOrder(t.uid, { type: 'pa', mode: 'callout', voice: true }); ok(!far.ok, 'voice callout refused from far away');
  const sp = Core.suspList()[0]; const near = []; for (let y = sp.y - 12; y <= sp.y + 12; y++) for (let x = sp.x - 12; x <= sp.x + 12; x++) if (Core.roomAt(x, y) < 0 && Core.houseRectDist && Core.houseRectDist(x, y) <= 3 && !S.block[Core.idx ? Core.idx(x, y) : y * Core.MAP_W + x]) near.push([x, y]);
  if (near.length) { t.x = near[0][0]; t.y = near[0][1]; const q = Core.queueOrder(t.uid, { type: 'pa', mode: 'callout', voice: true }); ok(q.ok, 'voice callout allowed next to the house: ' + (q.reason || '')); } }

// --- 13: BearCat ---
{ let turns = [], placed = 0, drv = 0;
  for (let s = 1; s <= 12; s++) { const S = Core.newGame(s, { armored: true }); const P1 = (S.bcPend || []).find(p => p.zone === 'p'); ok(!Core.bearcat() && P1 && P1.turn >= 1, 'BearCat not on scene at the start s' + s); // v23: two BearCats (S.bcPend)
    turns.push(P1 ? P1.turn : -1); const c = Core.bcArriveNow(); if (c && Math.hypot(c.x - S.ext.staging.x, c.y - S.ext.staging.y) <= 12) placed++; if (c && c.bcDriver) drv++;
    ok(S.officers.every(o => o.spec !== 'driver' && o.spec2 !== 'driver'), 'no driver specialty on the roster s' + s); }
  ok(new Set(turns).size > 1, 'random arrival turn (' + turns.join(',') + ')'); ok(placed === 12, 'arrives next to primary staging'); ok(drv === 12, 'its own BearCat driver');
  ok(Core.carSeats(Core.bearcat()) === 11, 'BearCat carries 11 in the back'); }
{ const S = Core.newGame(3, { armored: true }); const P1 = () => (S.bcPend || []).find(p => p.zone === 'p'); const T = P1().turn; let g = 0; while (P1() && g++ < 30 && S.phase !== 'over') { Core.execute(); let q = 0; while (Core.state.phase === 'executing' && !Core.stepTick() && q++ < 300); if (Core.state.phase === 'encounter') break; }
  ok(!P1() && Core.bearcat() && S.turn >= T, 'BearCat rolls in on its turn (' + T + ')'); }

// --- 14 / 15: Draco ---
ok([1, 2, 3, 4, 5, 6].map(Core.dracoMinutes).join() === '5,3,2,1.5,1.25,1' && Core.dracoMinutes(7) <= 1 && Core.dracoMinutes(10) <= 1, 'Draco install minutes 5/3/2/1.5/1.25/1, ≤1 for 7+');
{ const S = Core.newGame(4, { armored: true }); const c = Core.bcArriveNow(); c.draco = true; const tip = Core.dracoTipOf(c); ok(tip.bang === 2 && tip.gas === 4, 'Draco tip: 2 flashbangs + 4 CS');
  ok(Core.dracoTipInfo(c).room == null && /Draco/.test(Core.dracoTipInfo(c).reason), 'tip devices need the arm in an opening'); }

// --- 16: team names ---
ok(['Rear Containment', 'React Team', 'Search Team', 'Containment', 'Drone Team', 'K9 Team', 'Negotiators', 'BearCat Team', 'Gas Team'].every(n => Core.TEAM_NAMES.includes(n)), 'team name presets');
{ const S = prep(21); const t1 = team(S, 2); ok(t1.name === 'Team 1', 'default name Team 1'); Core.renameTeam(t1.uid, 'Perimeter North Side'); ok(t1.name === 'Perimeter North Si', 'custom name (18 chars)'); }

// --- 17: fire rates ---
ok(Core.fireRate('sniper') === 1 && Core.fireRate('shotgun', true) === 1 && Core.fireRate('rifle', true) === 1 && Core.fireRate('pistol') === 5 && Core.fireRate('rifle') === 5 && Core.fireRate('handgun', true) === 5 && Core.fireRate('auto', true) === 10, 'rounds per turn: pump/bolt 1, semi 5, full-auto 10');
ok(Core.autoAcc('auto', 1) === 1 && Core.autoAcc('auto', 8) < 0.5 && Core.autoAcc('handgun', 8) === 1, 'full-auto inaccurate except very close');
{ const S = prep(23); const t = team(S, 4); t.deployed = true; const sp = Core.suspList()[0]; const k = Core.weaponOf(t); const rate = Core.fireRate(k); let fired = 0, empty = 0;
  for (let i = 0; i < rate + 3; i++) { const u0 = Core.shotsUsed(t.uid); Core.fireAt(t, sp.x, sp.y, 'suppress', true); if (Core.shotsUsed(t.uid) > u0) fired++; else empty++; }
  ok(fired === rate && empty === 3 && Core.shotsLeft(t) === 0, `per-turn cap for ${k}: ${fired} fired, ${empty} refused`);
  S.turn++; ok(Core.shotsLeft(t) === rate, 'cap resets next turn'); }

console.log(`v20: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
