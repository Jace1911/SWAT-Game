
/* =====================================================================
   SCENARIO — what happened before SWAT was paged: roadblocks, how patrol
   set up (good / accidental gap / clumped at the front / one badly placed),
   officers hit on arrival, the mission brief and the 911 call transcript.
   ===================================================================== */
const SCENE_CFG = {
  variants: { good: 0.3, gap: 0.3, front: 0.2, mixed: 0.2 },   // patrol setup on arrival
  injury: 0.32,                                                // chance an officer was hit before SWAT arrived
  injuryKind: { mobile: 0.3, immobile: 0.38, critical: 0.22, kia: 0.1 },
  critImmobile: [4, 6], critCritical: [3, 4],                  // turns left without aid
  slip: 0.12, slipAfter: 2,                                    // unwatched side with windows: per-turn chance he tries to slip out (after N turns of gap)
  numberInCall: 0.3,                                           // a third-party caller gives his number
};
const VARIANT_TXT = { good: 'Good — patrol on two diagonal corners, every side watched', gap: 'Gap — one side left uncovered by accident', front: 'Clumped — patrol bunched at the front', mixed: 'Mixed — one officer in a bad, exposed position' };
const FIRST = ['Daniel', 'Marcus', 'Travis', 'Kevin', 'Luis', 'Dmitri', 'Ray', 'Calvin', 'Nate', 'Victor', 'Owen', 'Trent'];

/** Cruisers start at the ends of the block (map edge or the nearest intersection), parked across the street to stop traffic. */
function setupRoadblocks(r) {
  const G = S.geo, H = S.house, hcx = (H.x0 + H.x1) / 2, X = S.ext; S.roadblocks = [];
  const ends = ['W', 'E'].map(side => { const cr = G.cross && (side === 'W' ? G.cross.x1 < hcx : G.cross.x0 > hcx) ? G.cross : null;
    const x = cr ? (side === 'W' ? cr.x1 + 3 : cr.x0 - 3) : side === 'W' ? r.int(4, 6) : MAP_W - r.int(5, 7); return { side, x, kind: cr ? 'intersection' : 'map edge' }; });
  const place = (x0, y0, dir, i) => { let best = null, bs = 1e9; const c0 = { kind: 'cruiser', dir };
    for (let dy = -3; dy <= 3; dy++) for (let dx = -8; dx <= 8; dx++) { const x = x0 + dx, y = y0 + dy; if (!inb(x, y)) continue;
      const fp = footprint(c0, x, y); if (!fp.every(([a, b]) => inb(a, b) && (S.drive[idx(a, b)] || S.paved[idx(a, b)] === 1) && !S.block[idx(a, b)])) continue;
      if (!S.drive[idx(x, y)] || carClash(x, y, null)) continue; if (dist(x, y, X.van.x + 3, X.van.y) < 6) continue; const s = Math.abs(dx) + Math.abs(dy) * 1.5; if (s < bs) { bs = s; best = [x, y]; } }
    if (!best) { dir = 0; c0.dir = 0; for (let dy = -3; dy <= 3 && !best; dy++) for (let dx = -12; dx <= 12; dx++) { const x = x0 + dx, y = y0 + dy; if (inb(x, y) && S.drive[idx(x, y)] && !carClash(x, y, null)) { best = [x, y]; break; } } }
    if (!best) best = [x0, y0];
    const u = { uid: 'C' + (i + 1), kind: 'cruiser', name: 'Cruiser ' + (i + 1), num: i + 1, x: best[0], y: best[1], dir, occ: [], orders: [], status: 'ok', hits: 0, marks: [], vis: [], disabled: false };
    S.units.push(u); rebuildDyn(); return u; };
  const mid = G.ST + Math.floor(G.streetW / 2);
  const c1 = place(ends[0].x, mid, Math.PI / 2, 0); S.roadblocks.push({ x: c1.x, y: c1.y, side: 'W', kind: ends[0].kind, car: c1.uid });
  const c2 = place(ends[1].x, mid, Math.PI / 2, 1); S.roadblocks.push({ x: c2.x, y: c2.y, side: 'E', kind: ends[1].kind, car: c2.uid });
  const k = r.chance(0.5) ? 0 : 1, e = ends[k]; place(e.x + (e.side === 'W' ? 4 : -4), G.ST + 2, e.side === 'W' ? 0 : Math.PI, 2);
}
/** Is a roadblock still held (a cruiser within 3 cells of it)? */
function roadblockHeld(b) { return S.units.some(u => u.kind === 'cruiser' && !u.disabled && dist(u.x, u.y, b.x, b.y) <= 3); }

/** Best outdoor spot for a patrol officer near (ix,iy): watching the wanted sides, never the forbidden one; covered unless 'exposed'. */
function scenePost(ix, iy, want, forbid, mode, D, taken) {
  let best = null, bs = 1e9;
  for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) { const x = ix + dx, y = iy + dy, c = inb(x, y) ? idx(x, y) : -1; if (c < 0 || !cellOk(x, y, { outdoor: true }) || S.dyn[c] || D[c] >= 1e9) continue;
    if (taken.some(t => cheb(t[0], t[1], x, y) < (mode === 'clump' ? 2 : 3))) continue; if (nearDoorOut(x, y, 1)) continue;
    const pre = Math.hypot(dx, dy) * 0.3; if (pre >= bs) continue;
    const sh = shieldAt(x, y); if (mode === 'exposed' ? sh.q !== 'open' : sh.q === 'open') continue;
    const wa = watchAt(x, y); if (!wa.n || (forbid && wa.sides.has(forbid))) continue;
    const s = pre + want.filter(w => !wa.sides.has(w)).length * 6 + (sh.q === 'conceal' ? 1 : 0); if (s < bs) { bs = s; best = [x, y]; } }
  return best;
}
/** Patrol setup variant, officers on foot, and (sometimes) an officer hit before SWAT arrived. */
function setupScene(r) {
  const H = S.house, P = S.units.filter(u => u.kind === 'patrol'), C = S.units.filter(u => u.kind === 'cruiser'), D = reach(S.ext.staging.x, S.ext.staging.y, { outdoor: true }, 1e6);
  boardCar(P[0], C[0]); boardCar(P[1], C[1]);
  const sides = houseSides(), lr = r.chance(0.5) ? ['left', 'right'] : ['right', 'left'];
  let v = 'good', pick = r(); for (const k in SCENE_CFG.variants) { pick -= SCENE_CFG.variants[k]; if (pick <= 0) { v = k; break; } }
  const cx = s => s === 'left' ? H.x0 - 2 : H.x1 + 2, rearY = H.y0 - 2, frontY = H.y1 + 2, hc = Math.round((H.x0 + H.x1) / 2);
  let gap = null;
  const tryPlan = (v, lr, gap) => { let plan;
    if (v === 'good') plan = [[cx(lr[0]), rearY, ['rear', lr[0]]], [cx(lr[1]), frontY, ['front', lr[1]]]];
    else if (v === 'gap') { if (gap === 'rear') plan = [[H.x0 - 2, frontY, ['front', 'left']], [H.x1 + 2, frontY, ['front', 'right']]];
      else { const o = gap === 'left' ? 'right' : 'left'; plan = [[cx(o), rearY, ['rear', o]], [cx(o), frontY, ['front', o]]]; } }
    else if (v === 'front') plan = [[hc - 3, frontY + 2, ['front']], [hc + 1, frontY + 2, ['front']]];
    else plan = [[cx(lr[0]), rearY, ['rear', lr[0]]], [hc + r.int(-3, 3), H.y1 + 4, ['front'], 'exposed']];
    const taken = [];
    plan.forEach(([x, y, want, mode], i) => { const u = P[2 + i]; u.badPos = false; let p = scenePost(x, y, want, gap, mode || (v === 'front' ? 'clump' : ''), D, taken);
      if (!p) p = scenePost(x, y, want, null, '', D, taken) || scenePost(x, y, [], null, '', D, taken); if (!p) p = [S.ext.staging.x + 2 + i, S.ext.staging.y];
      u.x = p[0]; u.y = p[1]; taken.push(p); if (mode === 'exposed' && shieldAt(u.x, u.y).q === 'open') u.badPos = true; });
    return sideWatch().gaps; };
  // place, then verify against real sight lines; if a layout can't produce the intended picture, take what the patrol actually achieved
  if (v === 'good') { let g = tryPlan('good', lr, null); if (g.length) g = tryPlan('good', [lr[1], lr[0]], null); if (g.length) v = 'gap'; }
  else if (v === 'gap') { const opts = r.shuffle(['left', 'right', 'rear'].filter(s => sides.includes(s))); let g = [];
    for (const o of opts.length ? opts : ['rear']) { gap = o; g = tryPlan('gap', lr, o); if (g.length) break; } if (!g.length) { v = 'good'; gap = null; } }
  else tryPlan(v, lr, null);
  P.forEach(p => p.home = { x: p.x, y: p.y });
  const sw0 = sideWatch();
  S.scene = { variant: v, gap0: sw0.gaps.slice(), intended: gap, injury: null, gapFound: null, gapClosed: null, gapTurns: 0, slipTried: false };
  // officer hit on arrival: the second officer on foot, in the open near the front of the house
  if (r.chance(SCENE_CFG.injury)) {
    const u = P[3]; const spot = scenePost(hc + r.int(-4, 4), H.y1 + 3, [], null, 'exposed', D, [[P[2].x, P[2].y]]) || [u.x, u.y];
    u.x = spot[0]; u.y = spot[1]; u.home = { x: u.x, y: u.y }; u.status = 'down'; u.orders = []; u.badPos = false;
    let kind = 'immobile', pk = r(); for (const k in SCENE_CFG.injuryKind) { pk -= SCENE_CFG.injuryKind[k]; if (pk <= 0) { kind = k; break; } }
    const c = addCasualty('patrol', u.uid, u.name, u.x, u.y, { kia: 0, mobile: 0 }); u.cas = c.id; c.initial = true; c.x = u.x; c.y = u.y;
    if (kind === 'kia') { c.state = 'kia'; c.sev = 3; c.crit = 0; S.stats.kia++; c.known = true; }
    else if (kind === 'mobile') { c.state = 'mobile'; c.sev = 1; c.crit = r.int(CAS_CFG.critMobile[0], CAS_CFG.critMobile[1]); c.reported = true; }
    else if (kind === 'critical') { c.state = 'immobile'; c.sev = 3; c.crit = r.int(SCENE_CFG.critCritical[0], SCENE_CFG.critCritical[1]); c.reported = true; }
    else { c.state = 'immobile'; c.sev = 2; c.crit = r.int(SCENE_CFG.critImmobile[0], SCENE_CFG.critImmobile[1]); c.reported = true; }
    c.crit0 = c.crit; c.known = true; S.downList.push({ x: c.x, y: c.y, name: u.name, cas: c.id }); S.scene.injury = { name: u.name, kind, cas: c.id };
    S.scene.gap0 = sideWatch().gaps.slice();
  }
}
/** Mission brief + 911 call, generated from the seed; consistent with the hidden facts (who called, weapon) but never confirms them outright. */
function makeBrief() {
  const r = makeRng(S.seed * 4111 + 17), sp = S.suspect, N = S.nego, sc = S.scene, G = S.geo;
  const self = N.called911, shots = !!sc.injury || r.chance(0.55);
  const types = self ? ['mental health crisis', 'shots reported', 'domestic disturbance'] : ['domestic disturbance', 'welfare check', 'warrant service', 'traffic stop follow-up', 'shots reported', 'mental health crisis'];
  const type = r.pick(types); const first = r.pick(FIRST), last = r.pick(LAST), age = r.int(24, 58), addr = `${r.int(1, 48) * 100 + r.int(1, 99)} ${G.name}`;
  const hh = r.int(0, 23), mm = r.int(0, 59), t0 = hh * 3600 + mm * 60 + r.int(0, 59), ts = s => { s = (t0 + s) % 86400; const p = n => String(n).padStart(2, '0'); return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`; };
  const desc = `${first} ${last}, ${age}, ${r.pick(['about 6 ft, heavy build', 'medium build, beard', 'slim, shaved head', 'tall, thin, glasses', 'stocky, short dark hair'])}`;
  const gunWord = { handgun: 'a handgun', rifle: 'a long gun', shotgun: 'a long gun — maybe a shotgun' }[sp.weapon] || 'a gun';
  const sawGun = self ? r.chance(0.5) : r.chance(0.65);
  const callerKind = self ? 'suspect' : { 'domestic disturbance': 'girlfriend', 'welfare check': 'sister', 'warrant service': 'neighbor', 'traffic stop follow-up': 'neighbor', 'shots reported': 'neighbor', 'mental health crisis': 'mother' }[type];
  const callerName = self ? `${first} ${last} (did not give a name)` : { girlfriend: r.pick(['Kayla', 'Maria', 'Jess']) + ' (girlfriend)', sister: r.pick(['Dana', 'Erin', 'Tasha']) + ` ${last} (sister)`, neighbor: r.pick(['Mr. ', 'Mrs. ']) + r.pick(LAST.filter(n => n !== last)) + ' (neighbor)', mother: `Linda ${last} (mother)` }[callerKind];
  const giveNum = !self && ['girlfriend', 'sister', 'mother'].includes(callerKind) && r.chance(SCENE_CFG.numberInCall * 2);
  const phone = `(612) 555-0${r.int(100, 199)}`;
  const L = [], add = (s, who, text) => L.push({ t: ts(s), who, text });
  let s = 0; add(s, 'Dispatcher', '911, what is the address of your emergency?');
  if (self) { add(s += 4, 'Caller', `${addr}. You need to send somebody. ${type === 'mental health crisis' ? "I can't do this anymore." : type === 'shots reported' ? "I just fired a round so you'd know I'm serious." : 'She left. Everybody leaves.'}`);
    add(s += 6, 'Dispatcher', 'Okay, I am sending help. What is your name, sir?'); add(s += 5, 'Caller', "Doesn't matter. Tell them not to come in here.");
    add(s += 4, 'Dispatcher', 'Is anyone else in the house with you?'); add(s += 3, 'Caller', "No. Just me."); if (sawGun || shots) { add(s += 5, 'Dispatcher', 'Do you have any weapons?'); add(s += 3, 'Caller', sawGun ? `I've got ${gunWord.replace('a long gun — maybe a shotgun', 'a shotgun').replace('a long gun', 'a rifle')}.` : "I'm not answering that."); }
    add(s += 6, 'Dispatcher', "Sir, stay on the line with me — officers are on the way."); add(s += 2, '[Note]', 'Caller disconnected. Caller ID on the line: ' + phone + ' (registered to ' + first + ' ' + last + ').'); }
  else {
    const what = { 'domestic disturbance': `My boyfriend — he's screaming and throwing things, I got out the back. He's still in the house at ${addr}.`, 'welfare check': `I'm calling about my brother at ${addr}. He sent me a goodbye text and now he won't answer.`, 'warrant service': `There's police at my neighbor's place, ${addr}, and he slammed the door on them and he's yelling.`, 'traffic stop follow-up': `A guy just ran from a car the police pulled over and went into ${addr}.`, 'shots reported': `I heard ${shots ? 'gunshots' : 'what sounded like a gunshot'} next door, ${addr}.`, 'mental health crisis': `My son at ${addr} — he's off his medication and he says he's going to make them shoot him.` }[type];
    add(s += 4, 'Caller', what); add(s += 6, 'Dispatcher', 'Okay. Are you somewhere safe right now?'); add(s += 3, 'Caller', callerKind === 'neighbor' ? "I'm inside my house, I'm looking out the window." : "I'm in my car down the street.");
    add(s += 5, 'Dispatcher', 'Does he have any weapons?'); add(s += 3, 'Caller', sawGun ? `Yes — I saw ${gunWord}.` : "I don't know. Maybe. He used to keep guns.");
    add(s += 5, 'Dispatcher', 'Is anyone else inside?'); add(s += 3, 'Caller', r.pick(["I don't think so.", "I don't know.", 'I think he is alone.']));
    if (giveNum) { add(s += 4, 'Dispatcher', 'Do you have a phone number for him?'); add(s += 4, 'Caller', `His cell is ${phone}.`); }
    add(s += 4, 'Dispatcher', `What's his name?`); add(s += 2, 'Caller', `${first}. ${first} ${last}.`);
    add(s += 5, 'Dispatcher', 'Officers are on the way. Stay where you are and keep away from the house.'); }
  const bg = [];
  if (shots) bg.push(`${ts(Math.round(s * 0.45))} — [a loud bang in the background]`);
  bg.push(`${ts(Math.round(s * 0.2))} — [${r.pick(['dog barking', 'TV on loud', 'a car alarm', 'wind noise', 'a door slamming'])}]`);
  if (!self) bg.push(`${ts(Math.round(s * 0.7))} — [caller breathing fast, voice shaking]`);
  const arrS = s + r.int(240, 480), arrive = ts(arrS), shotS = arrS + r.int(30, 120), actS = arrS + r.int(360, 720);
  S.clock0 = (t0 + actS) % 86400; // the mission clock (0:00) starts when SWAT is activated
  const patrol = [`First units on scene at ${arrive.slice(0, 5)}. Cruisers blocked traffic at the ${S.roadblocks.map(b => (b.side === 'W' ? 'west' : 'east') + ' ' + b.kind).join(' and the ')}.`];
  patrol.push({ good: 'Patrol took up positions around the house and reports eyes on the residence.', gap: 'Patrol took up positions around the house and reports eyes on the residence.', front: 'Patrol is holding at the front of the house.', mixed: 'Patrol took up positions around the house; one officer moved in close at the front.' }[sc.variant]);
  if (sc.injury) patrol.push(`${ts(shotS).slice(0, 5)} — shots fired at arriving officers. OFFICER DOWN — condition not confirmed.`);
  else if (shots) patrol.push(`${ts(shotS).slice(0, 5)} — patrol heard ${r.chance(0.5) ? 'one shot' : 'shots'} from inside; no one hit.`);
  patrol.push(`Subject refused commands to come out. SWAT activated at ${ts(actS)} — mission clock 0:00.`);
  const known = [];
  known.push(r.pick(['Prior arrest for assault (2019).', 'No criminal history on file.', 'Two prior disturbance calls at this address.', 'Active misdemeanour warrant.', 'Recent job loss, per family.']));
  if (type === 'warrant service') known.push('Felony warrant (probation violation); he refused to open the door to the warrant team.');
  if (type === 'traffic stop follow-up') known.push('Ran from a traffic stop two blocks away; the car is registered to him.');
  S.brief = { type, time: ts(0).slice(0, 5), callAt: ts(0), arriveAt: arrive, activatedAt: ts(actS), addr, caller: callerName, self, shots, sawGun, suspect: desc, name: `${first} ${last}`,
    occupants: self ? 'Caller says he is alone. Not confirmed.' : 'Caller does not know whether anyone else is inside. Not confirmed.',
    patrol, known, officerDown: !!sc.injury, transcript: L, background: bg.sort(), phone: self || giveNum ? phone : null, giveNum, reviewed: false };
}
/** Listening to the 911 recording (from the brief or the intel menu): same transcript, same intel, applied once. */
function review911() {
  const B = S.brief; if (!B) return { ok: false }; const first = !S.intel.call911; S.intel.call911 = true; B.reviewed = true;
  if (first) { if (B.self) { log('911 review: he made the call himself — caller ID gives his cell number.', 'intel'); learnNumber('911 caller ID'); }
    else if (B.giveNum) { log(`911 review: the caller gave his cell number (${B.phone}).`, 'intel'); learnNumber('911 caller'); }
    else log('911 review: a third party called it in. No number for him on the recording.', 'intel'); S.version++; }
  return { ok: true, transcript: B.transcript, first };
}
/** Radio roll call: what each patrol officer can actually see, and which sides nobody is watching. */
function statusCheck() {
  const sw = sideWatch(), sc = S.scene; S.intel.status = S.turn + 1;
  for (const u of S.units) { if (u.kind !== 'patrol') continue; if (u.status !== 'ok') { const c = casById(u.cas); log(`Roll call: ${u.name} — ${c && c.state === 'kia' ? 'killed in action' : 'down, no longer watching'}.`, 'radio'); continue; }
    if (u.inCar) { const c = unit(u.inCar), rb = (S.roadblocks || []).find(b => b.car === c.uid && dist(c.x, c.y, b.x, b.y) <= 3); const ws = watchAt(c.x, c.y).sides;
      log(`Roll call: ${u.name} — in ${c.name}${rb ? ', holding the traffic block' : ''}${ws.size ? '; eyes on the ' + [...ws].join(' & ') : '; no view of the house'}.`, 'radio'); continue; }
    const ws = watchAt(u.x, u.y).sides; log(`Roll call: ${u.name} — ${ws.size ? 'I have the ' + [...ws].join(' and ') + ' side' + (ws.size > 1 ? 's' : '') : 'I can\u2019t see any doors or windows from here'}.`, 'radio'); }
  if (sw.gaps.length) { log(`STATUS CHECK: nobody is watching the ${sw.gaps.join(' or ')} side${sw.gaps.length > 1 ? 's' : ''} of the house!`, 'alert'); if (sc.gap0.length && sc.gapFound == null) sc.gapFound = S.turn + 1; }
  else log('STATUS CHECK: all sides of the house are watched.', 'good');
  S.version++; return sw;
}
/** End of turn: a side nobody watches gives him a way out. */
function sceneTurn() {
  const sc = S.scene, sp = S.suspect; if (!sc) return;
  const sw = sideWatch(); if (sc.gap0.length && sc.gapClosed == null && !sw.gaps.some(g => sc.gap0.includes(g))) { sc.gapClosed = S.turn; xpAct('contain', null); }
  if (!hostile() || sp.mode !== 'barricaded' || sp.walk || (S.nego && S.nego.contact) || S.turn < 2) { sc.gapTurns = 0; return; }
  const wins = S.windows.filter(w => w.room !== sp.room && !w.broken && sw.gaps.includes(watchPts().find(p => p.win === w.id).side));
  if (!wins.length) { sc.gapTurns = 0; return; }
  sc.gapTurns++; if (sc.gapTurns < SCENE_CFG.slipAfter || !S.rng.chance(SCENE_CFG.slip)) return;
  let best = null, bp = null; for (const w of wins) { const [cx, cy] = w.edges[0]; const p = findPath(sp.x, sp.y, (x, y) => x === cx && y === cy, { suspect: true, canOpen: true }); if (p && (!bp || p.length < bp.length)) { bp = p; best = w; } }
  if (!best) return; sp.mode = 'fleeing'; sp.flee = best.id; sc.slipTried = true; const side = watchPts().find(p => p.win === best.id).side;
  log(`Movement inside — sounds like he is heading for the ${side} side of the house!`, 'alert');
}
/** Debrief lines about the starting situation and how it was handled. */
function sceneDebrief() {
  const sc = S.scene, out = []; if (!sc) return out;
  let t = VARIANT_TXT[sc.variant];
  if (sc.gap0.length) t += `. Unwatched at the start: ${sc.gap0.join(', ')}` + (sc.gapFound ? ` — found by status check at ${elapsedAt(sc.gapFound - 1)}` : ' — never confirmed by a status check') + (sc.gapClosed != null ? `, closed by ${elapsedAt(sc.gapClosed)}` : ', never closed') + (sc.slipTried ? '; he tried to slip out that way' : '');
  else t += '. No gap at the start';
  out.push({ k: 'Initial conditions', v: t + '.' });
  if (sc.injury) { const c = casById(sc.injury.cas); out.push({ k: '  Officer down on arrival', v: `${sc.injury.name}: ${sc.injury.kind === 'kia' ? 'killed before SWAT arrived' : sc.injury.kind + ' — outcome: ' + (c ? sevWord(c) : 'unknown')}.` }); }
  const B = S.brief; if (B) out.push({ k: '  Call', v: `${B.type} at ${B.time}; 911 recording ${B.reviewed ? 'reviewed' : 'not reviewed'}.` });
  return out;
}
