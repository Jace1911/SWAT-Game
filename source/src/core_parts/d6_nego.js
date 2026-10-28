
/* =====================================================================
   NEGOTIATION — contact (phone / PA / throw-phone), dialogue, call-out,
   walk-out surrender protocol and the hidden-weapon ambush risk. Rules only.
   ===================================================================== */
/* ================== TUNABLE: NEGOTIATION CONFIG ================== */
const NEGO_CFG = {
  talkingFire: 0.4,      // suspect fire-attempt multiplier while a live line is open
  outsideChallenge: 0.5, // challenge-to-surrender odds multiplier when a team shouts from outside (once per turn)
  temper: { // hidden personality, rolled per seed
    talker:    { w: 0.40, refuse: 0.25, hang: 0.10, noAnswer: 0.25, escalate: 0.30, hint: 'He talks a lot when he is upset — he will want to be heard.' },
    withdrawn: { w: 0.35, refuse: 0.45, hang: 0.20, noAnswer: 0.50, escalate: 0.20, hint: 'He shuts down and stops answering when pushed.' },
    volatile:  { w: 0.25, refuse: 0.40, hang: 0.35, noAnswer: 0.30, escalate: 0.60, hint: 'He has a temper — threats make him worse.' },
  },
  refuseAgit: 0.003,      // + refusal chance per agitation point
  number: { interview: 0.5, call911: 0.7, family: 0.85 }, // how the suspect's phone number is learned
  familyTurn: 2,          // family reach the command post from this turn
  pa: { range: 22, yell: 0.45, fireOnYell: 0.25, eff: 0.6 },   // loudspeaker reach from the house centre, shout-back odds
  throwPhone: { team: { block: 0.15, shoot: 0.10, approachFire: 0.30 }, robot: { block: 0.10, shoot: 0.15 }, doorway: 0.6 },
  talk: {
    rapport:    { gain: [8, 16], agit: -4 },
    listen:     { gain: [3, 7], agit: -10, intel: 0.45 },
    concession: { gain: [10, 18], agit: -6, max: 3, need: 15 },
    status:     { gain: [1, 3], agit: 0 },
    ultimatum:  { need: 65, surrender: 0.35, agit: 15, talk: -15, hang: 0.5 },
  },
  agitDrag: 0.06,         // rapport gain lost per agitation point
  coach: 1.1,             // second negotiator on scene (coach / scribe)
  surrender: { sure: 100, from: 75, div: 120 },
  callout: { base: 0.12, talk: 0.08, gas: 0.06, agitHigh: 70, agitPen: 0.04, contain: 0.7, fire: 0.2, yell: 0.4, agit: 6 },
  hiddenWeapon: 0.5, ambushHidden: 0.4,   // average ambush ≈ 20 % with no protocol
  protocol: { cover: 0.6, shield: 0.75, overwatch: 0.75, commands: 0.6 },
  ambushHit: 0.4, walkDist: 5,
};
/* ================================================================== */
const TALK_KEYS = ['call', 'rapport', 'listen', 'concession', 'status', 'ultimatum'];
const TALK_NAMES = { call: 'Call his phone', rapport: 'Build rapport', listen: 'Listen / let him vent', concession: 'Offer a concession', status: 'Status check', ultimatum: 'Ultimatum' };
function initNego(seed) {
  const nr = makeRng(seed * 977 + 13); const T = NEGO_CFG.temper, TW = stypeCfg().temperW; let pick = nr(), temper = 'talker';
  for (const k in T) { pick -= TW ? TW[k] : T[k].w; if (pick <= 0) { temper = k; break; } }
  S.nego = { temper, hidden: nr.chance(NEGO_CFG.hiddenWeapon), called911: nr.chance(NEGO_CFG.number.call911) && ['barricade', 'mental'].includes((S.stype || {}).key || 'barricade'), numberKnown: false, numberSrc: null, line: false, phoneRoom: null,
    contact: null, quiet: 0, attempts: 0, refusals: 0, rounds: 0, concessions: 0, pick: null, outcome: null, hist: [], read: null, warn: false, protocol: null, ambush: null, paTurn: -1, everContact: false, how: null };
}
function negOnScene() { return S.officers.filter(o => o.spec === 'negotiator' && (o.status === 'staged' || o.status === 'ok')); }
function negotiatorSkill() { const n = negOnScene(); return n.length ? Math.max(...n.map(o => o.skill)) : 0.5; }
function negHist(t, kind) { S.nego.hist.push({ turn: S.turn + 1, t }); if (S.nego.hist.length > 40) S.nego.hist.shift(); log(t, kind || 'radio'); }
function learnNumber(src) { const N = S.nego; if (N.numberKnown) return; N.numberKnown = true; N.numberSrc = src; negHist(`Negotiator: suspect's cell number obtained (${src}). Phone contact possible.`, 'intel'); }
/** Units that can broadcast: a cruiser PA with someone inside, or a team with a bullhorn. */
function paCapable(u) { return unitAlive(u) && (u.kind === 'cruiser' && u.occ.length > 0 && !u.disabled || u.kind === 'team' && u.deployed && (u.equip.bullhorn || 0) > 0); }
function paInRange(x, y) { const [hx, hy] = houseCenter(); return dist(x, y, hx, hy) <= NEGO_CFG.pa.range; }
function paUnits(x, y) { return S.units.filter(u => paCapable(u) && (x === undefined ? paInRange(u.x, u.y) : dist(u.x, u.y, x, y) <= NEGO_CFG.pa.range)); }
/** Can he hear us on the current channel? */
function contactLive() { const N = S.nego; if (!N.contact) return false; if (N.contact === 'pa') return paUnits().length > 0; return true; }
function talkAvail(k) {
  const N = S.nego, sp = S.suspect; if (!negOnScene().length) return 'Needs a Negotiator on scene';
  if (sp.mode === 'surrendered') return 'He is coming out — run the surrender protocol';
  if (!hostile()) return 'Not needed';
  if (k === 'call') { if (contactLive()) return 'Already talking'; if (!N.numberKnown && !N.line) return 'No number — Neighbor/Family interview or 911 call review, or deliver a throw-phone'; return true; }
  if (!contactLive()) return N.contact === 'pa' ? 'PA unit out of range' : 'No contact — call him, use the PA or deliver a throw-phone';
  if (k === 'concession') { if (N.concessions >= NEGO_CFG.talk.concession.max) return 'Nothing left to offer'; if (sp.talk < NEGO_CFG.talk.concession.need) return 'Too early — build rapport first'; }
  return true;
}
function setTalk(k) { if (S.phase !== 'planning') return { ok: false, reason: 'Busy' }; if (!k) { S.nego.pick = null; S.version++; return { ok: true }; }
  const a = talkAvail(k); if (a !== true) return { ok: false, reason: a }; S.nego.pick = k; S.version++; return { ok: true }; }
/** Refusal roll for any contact attempt. Returns true when he engages. */
function contactTry(chan) {
  const N = S.nego, sp = S.suspect, T = NEGO_CFG.temper[N.temper], r = S.rng; N.attempts++;
  if (N.quiet > 0) { N.refusals++; negHist(`Negotiator: no response — he has gone quiet.`, 'radio'); return false; }
  const p = clamp(T.refuse + sp.agit * NEGO_CFG.refuseAgit - sp.talk / 300 - (chan === 'line' ? 0.05 : 0), 0.08, 0.85);
  if (r.chance(p)) { N.refusals++;
    if (r.chance(T.escalate)) { sp.agit = clamp(sp.agit + 8, 0, 100); negHist(`Contact refused — he shouts at us to back off. Agitation rising.`, 'alert'); }
    else { N.quiet = r.int(1, 2); negHist(`Contact refused — he has gone quiet.`, 'radio'); }
    return false; }
  N.contact = chan; N.everContact = true; xpAct('contact', negOnScene().filter(o => o.status === 'ok' || o.status === 'staged').map(o => o.id)); sp.talk = clamp(sp.talk + 5, 0, 100); sp.agit = clamp(sp.agit - 5, 0, 100);
  negHist(`CONTACT — he is talking to us (${chan === 'pa' ? 'shouting back over the PA' : chan === 'line' ? 'on the throw-phone' : 'on his cell'}).`, 'good'); return true;
}
function talkMult(chan) { const n = negOnScene(); return (0.75 + negotiatorSkill() * 0.5) * (chan === 'pa' ? NEGO_CFG.pa.eff : 1) * (n.length >= 2 ? NEGO_CFG.coach : 1); }
function moodWord() { const a = S.suspect.agit; return a > 75 ? 'Explosive' : a > 55 ? 'Agitated' : a > 35 ? 'Tense' : a > 18 ? 'Calmer' : 'Calm'; }
function rapportWord() { const t = S.suspect.talk; return t >= 85 ? 'Ready to come out' : t >= 65 ? 'Strong' : t >= 40 ? 'Building' : t >= 15 ? 'Fragile' : 'None'; }
/** Planning pick, resolved at EXECUTE. */
function runTalk() {
  const N = S.nego, sp = S.suspect, r = S.rng, k = N.pick; N.pick = null; if (!k) return; if (talkAvail(k) !== true) return;
  const T = NEGO_CFG.temper[N.temper];
  if (k === 'call') { N.attempts; if (!N.line && r.chance(T.noAnswer)) { N.attempts++; N.refusals++; negHist('Negotiator: the phone rings out — no answer.', 'radio'); return; }
    contactTry(N.line ? 'line' : 'phone'); return; }
  const C = NEGO_CFG.talk, m = talkMult(N.contact) * (stypeCfg().negoMul || 1); N.rounds++; xpAct('dialogue', negOnScene().map(o => o.id)); let gain = 0, msg = '';
  if (k === 'rapport') { gain = r.int(C.rapport.gain[0], C.rapport.gain[1]) * m - sp.agit * NEGO_CFG.agitDrag; sp.agit += C.rapport.agit; msg = 'building rapport — talking about his family, what he needs.'; }
  if (k === 'listen') { gain = r.int(C.listen.gain[0], C.listen.gain[1]) * m; sp.agit += C.listen.agit; msg = 'letting him vent. He is calming down.';
    if (r.chance(C.listen.intel)) { sp.heat = { room: sp.room, x: sp.x, y: sp.y, turn: S.turn }; S.intel.located = true; msg += ` He mentions he is in the ${S.rooms[sp.room] ? S.rooms[sp.room].name : 'house'}.`; } }
  if (k === 'concession') { gain = r.int(C.concession.gain[0], C.concession.gain[1]) * m - sp.agit * NEGO_CFG.agitDrag; sp.agit += C.concession.agit; N.concessions++;
    msg = ['offered to pull the cruisers back a little.', 'got him cigarettes and water sent in on the robot line.', 'let him speak to his sister on the line.'][N.concessions - 1] || 'offered a concession.'; }
  if (k === 'status') { gain = r.int(C.status.gain[0], C.status.gain[1]) * m; S.intel.weapon = true; S.intel.threat = Math.max(S.intel.threat, 1);
    msg = `status check — he says he is alone with a ${SUSPECT_WEAPONS[sp.weapon].name.toLowerCase()}${sp.injured ? ', and he is hurt' : ''}${S.gasActive && S.gas[idx(sp.x, sp.y)] > 0.2 ? ', coughing from the gas' : ''}.`;
    if (N.hidden && !N.warn && r.chance(0.35 + negotiatorSkill() * 0.3)) { N.warn = true; msg += ' Something he said suggests he may be hiding a second weapon — run a full walk-out protocol.'; } }
  if (k === 'ultimatum') { if (sp.talk >= C.ultimatum.need && r.chance(C.ultimatum.surrender + (sp.talk - C.ultimatum.need) / 100)) { negHist('Negotiator: ultimatum — he agrees to come out.', 'good'); walkout('talk'); return; }
    sp.agit += C.ultimatum.agit; sp.talk = clamp(sp.talk + C.ultimatum.talk, 0, 100); negHist('Negotiator: ultimatum rejected — he is furious.', 'alert');
    if (r.chance(C.ultimatum.hang)) { N.contact = null; N.quiet = 1; negHist('He has cut contact.', 'alert'); } sp.agit = clamp(sp.agit, 0, 100); return; }
  sp.agit = clamp(sp.agit, 0, 100); sp.talk = clamp(sp.talk + gain, 0, 100);
  negHist(`Negotiator: ${msg}`, 'radio');
  if (N.contact === 'pa' && r.chance(NEGO_CFG.pa.yell * 0.5)) shoutReveal(paUnits()[0], false);
  const SU = NEGO_CFG.surrender;
  if (sp.talk >= SU.sure || sp.talk >= SU.from && r.chance((sp.talk - SU.from) / SU.div)) { negHist('Negotiator: he says he is ready to come out.', 'good'); walkout('talk'); return; }
  if (r.chance(T.hang * sp.agit / 50)) { N.contact = null; N.quiet = r.int(0, 1); negHist('He hangs up / stops answering mid-conversation.', 'alert'); }
}
/** He shouts back: steps to a window (briefly visible) or shouts through a door (location revealed). Optionally fires at the PA unit. */
function shoutReveal(u, mayFire) {
  const sp = S.suspect; if (!hostile() || sp.stun > 0) return; const wins = suspectWindowCells(); let best = null, bs = -1e9;
  for (const [x, y] of wins) { const s = (u && los(x, y, u.x, u.y) ? 10 : 0) - (u ? dist(x, y, u.x, u.y) / 20 : 0); if (s > bs && !S.units.some(q => q.x === x && q.y === y)) { bs = s; best = [x, y]; } }
  sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn }; S.intel.located = true; S.intel.threat = Math.max(S.intel.threat, 1);
  if (best) { sp.x = best[0]; sp.y = best[1]; sp.atWindow = true; sp.duck = 0; sp.cd = Math.max(sp.cd, 1); sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn }; fx('text', sp.x, sp.y, { text: 'SHOUTING', color: '#ffb020' });
    log(`Suspect yells back from the ${S.rooms[sp.room].name} window — briefly exposed.`, 'alert');
    if (mayFire && u && los(sp.x, sp.y, u.x, u.y) && S.rng.chance(NEGO_CFG.pa.fireOnYell + sp.agit / 400)) { sp.cd = 0;
      suspectFire({ u, px: sp.x, py: sp.y, d: dist(sp.x, sp.y, u.x, u.y), l: los(sp.x, sp.y, u.x, u.y), cls: targetClass(u, sp.x, sp.y) }); } }
  else { sp.heat = { room: sp.room, x: sp.x, y: sp.y, turn: S.turn }; log(`Suspect shouts through the door — his voice places him in the ${S.rooms[sp.room] ? S.rooms[sp.room].name : 'house'}.`, 'intel'); }
}
/** PA order: open contact or a formal call-out. */
function paAct(u, o) {
  const N = S.nego, sp = S.suspect, r = S.rng; if (!hostile()) return; if (!paInRange(u.x, u.y)) { log(`${u.name}: out of PA range.`, 'radio'); return; }
  if (o.mode === 'callout') { const C = NEGO_CFG.callout; N.attempts++;
    let p = C.base * (stypeCfg().calloutMul || 1) + sp.talk / 100 * C.talk + (S.gasActive && S.gas[idx(sp.x, sp.y)] > 0.2 ? C.gas : 0) - (sp.agit > C.agitHigh ? C.agitPen : 0);
    if (S.contain.length && S.contain.some(c => !c.covered)) p *= C.contain; N.lastCallout = p;
    log(`${u.name} (PA): "POLICE! COME OUT WITH YOUR HANDS EMPTY!"`, 'radio');
    if (r.chance(p)) { negHist('Call-out: he shouts that he is coming out.', 'good'); walkout('callout'); return; }
    N.refusals++; sp.agit = clamp(sp.agit + C.agit, 0, 100);
    const f = r(); if (f < C.fire + sp.agit / 400) { negHist('Call-out refused — he answers with gunfire.', 'alert'); shoutReveal(u, true); if (hostile() && sp.cd === 0 && u && los(sp.x, sp.y, u.x, u.y)) suspectFire({ u, px: sp.x, py: sp.y, d: dist(sp.x, sp.y, u.x, u.y), l: los(sp.x, sp.y, u.x, u.y), cls: targetClass(u, sp.x, sp.y) }); }
    else if (f < C.fire + C.yell) { negHist('Call-out refused — he yells back.', 'radio'); shoutReveal(u, false); }
    else negHist('Call-out: no response.', 'radio'); return; }
  if (contactLive()) { log(`${u.name} (PA): negotiator on the loudspeaker.`, 'radio'); return; }
  log(`${u.name} (PA): "This is the police. We want to talk — pick up or answer us."`, 'radio');
  if (contactTry('pa')) { shoutReveal(u, false); return; }
  if (!N.quiet && r.chance(NEGO_CFG.pa.yell)) shoutReveal(u, true);
}
/** Throw-phone arrives in a room (team throw or robot drop). */
function deliverPhone(u, room, via, doorway) {
  const N = S.nego, sp = S.suspect, r = S.rng, C = NEGO_CFG.throwPhone[via]; const rm = S.rooms[room];
  if (via === 'team') { useItem(u, 'tphone'); } N.attempts++;
  if (r.chance(C.block)) { negHist(`${u.name}: throw-phone ${via === 'robot' ? 'snagged on furniture' : 'bounced off the frame'} — it did not get in. Failed.`, 'bad'); return; }
  if (hostile() && (sp.room === room || doorway) && r.chance(C.shoot + sp.agit / 500)) { fx('muzzle', sp.x, sp.y, { suspect: true }); S.stats.shots++; sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn };
    negHist(`Suspect shot the throw-phone${via === 'robot' ? ' — robot damaged' : ''}. Failed.`, 'alert'); if (via === 'robot' && r.chance(0.5)) { u.status = 'down'; u.orders = []; } sp.agit = clamp(sp.agit + 5, 0, 100); return; }
  N.line = true; N.phoneRoom = room;
  const reach = sp.room === room ? 1 : doorway ? NEGO_CFG.throwPhone.doorway : 0.35;
  if (!hostile() || !r.chance(reach)) { negHist(`${u.name}: throw-phone delivered (${rm ? rm.name : 'house'}). It is ringing — no pick-up yet.`, 'radio'); return; }
  negHist(`${u.name}: throw-phone delivered — he picks it up.`, 'radio'); contactTry('line');
}
/** Planning check for a throw-phone order. */
function planTPhone(u, o, sx, sy, assume, mo) {
  if (!(u.equip.tphone > 0)) return { ok: false, reason: 'No throw-phone on this team' };
  if (o.via === 'robot') { const g = robotPhoneGoal(o.room); if (!g) return { ok: false, reason: 'Robot needs an open door into the house — open or breach one first' };
    const p = findPath(sx, sy, g.fn, { canOpen: false, avoidSuspect: true, assume }); if (!p) return { ok: false, reason: 'Robot cannot reach an opening from here' }; o.doorway = g.doorway; return { ok: true, path: [], dpath: p, end: [sx, sy] }; }
  const fn = (x, y) => roomAt(x, y) !== o.room && canThrowFrom(x, y, o.room, assume, u, 'tphone');
  if (canThrowFrom(sx, sy, o.room, assume, u, 'tphone')) return { ok: true, path: [], end: [sx, sy], warn: expoAt(sx, sy) >= 0.3 ? 'Throw spot is exposed to the house' : null };
  const p = findPath(sx, sy, fn, mo); if (!p) return { ok: false, reason: 'No opening into that room (open a door or reach a window)' };
  const e = p[p.length - 1]; return { ok: true, path: p, end: e, warn: expoAt(e[0], e[1]) >= 0.3 ? 'Approach is exposed — he may fire at the team' : null };
}
function robotPhoneGoal(room) {
  const into = (x, y) => adjacentToRoomOpening(x, y, room, null, null) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const nx = x + dx, ny = y + dy; if (roomAt(nx, ny) !== room) return roomAt(x, y) === room; const e = edge(x, y, nx, ny); return e.t === 'O' || e.t === 'D' && e.d.state !== 'closed'; });
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (into(x, y)) return { fn: into, doorway: false };
  const ext = (x, y) => roomAt(x, y) >= 0 && S.doors.some(d => d.exterior && d.state !== 'closed' && d.cells.some(([a, b]) => a[0] === x && a[1] === y || b[0] === x && b[1] === y));
  for (const d of S.doors) if (d.exterior && d.state !== 'closed') return { fn: ext, doorway: true };
  return null;
}
/** Team / robot execution of a throw-phone order (called from unitAct). */
function tphoneAct(u, o, speed) {
  if (u.kind === 'team' && o.via === 'robot') { useItem(u, 'robot'); useItem(u, 'tphone'); const g = robotPhoneGoal(o.room);
    const d = { uid: 'D' + (++S.devSeq), kind: 'robot', name: 'Robot ' + S.devSeq, num: S.devSeq, x: u.x, y: u.y, dir: u.dir, orders: [{ type: 'tphone', room: o.room, via: 'robot', doorway: g ? g.doorway : true }], battery: 10, owner: u.uid, status: 'ok', vis: [] };
    S.units.push(d); log(`${u.name}: ${d.name} rolling out with a throw-phone.`, 'radio'); popOrder(u); return; }
  if (u.kind === 'robot') { const g = robotPhoneGoal(o.room); if (!g) { failOrders(u, 'no open way in'); return; }
    const r = stepAlong(u, o, g.fn, 1); if (r === null) { failOrders(u, 'no route to an opening'); return; } if (!r) return;
    popOrder(u); deliverPhone(u, o.room, 'robot', g.doorway); return; }
  if (!canThrowFrom(u.x, u.y, o.room, null, u, 'tphone')) { const r = stepAlong(u, o, (x, y) => roomAt(x, y) !== o.room && canThrowFrom(x, y, o.room, null, u, 'tphone'), speed); if (r === null) failOrders(u, 'no opening into room'); return; }
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = u.x + dx, ny = u.y + dy; if (roomAt(nx, ny) !== o.room) continue; const e = edge(u.x, u.y, nx, ny);
    if (e.t === 'D' && e.d.state === 'closed' && !e.d.locked && !e.d.barricaded) { e.d.state = 'open'; break; } if (e.t === 'W' && !e.w.broken && !canSeeRoom(u, o.room)) { e.w.broken = true; noise(nx, ny, 6, 'glass'); break; } }
  popOrder(u); const sp = S.suspect;
  if (hostile() && roomAt(u.x, u.y) < 0 && expoAt(u.x, u.y) >= 0.2) { const spots = [[sp.x, sp.y]].concat(suspectWindowCells()); const sh = spots.find(([x, y]) => los(x, y, u.x, u.y));
    if (sh && S.rng.chance(NEGO_CFG.throwPhone.team.approachFire * (0.5 + sp.agit / 100))) { sp.x = sh[0]; sp.y = sh[1]; sp.atWindow = winCellSet().has(idx(sp.x, sp.y)); sp.cd = 0;
      log(`${u.name}: taking fire on the approach!`, 'alert'); suspectFire({ u, px: sp.x, py: sp.y, d: dist(sp.x, sp.y, u.x, u.y), l: los(sp.x, sp.y, u.x, u.y), cls: targetClass(u, sp.x, sp.y) }); if (!unitAlive(u) || !teamOk(u).length) return; } }
  deliverPhone(u, o.room, 'team', false);
}
/* ---------- walk-out surrender ---------- */
function frontDoor() { return S.doors.find(d => d.name === 'Front Door') || S.doors.find(d => d.exterior); }
function defaultSurrSpot() { const d = frontDoor(); if (!d) return [S.ext.staging.x, S.ext.staging.y];
  const [a, b] = d.cells[Math.floor(d.cells.length / 2)]; const out = roomAt(a[0], a[1]) < 0 ? a : b, inn = out === a ? b : a; const dx = out[0] - inn[0], dy = out[1] - inn[1];
  for (let k = NEGO_CFG.walkDist; k >= 1; k--) { const x = out[0] + dx * k, y = out[1] + dy * k; if (cellOk(x, y, { outdoor: true })) return [x, y]; } return out; }
function surrSpot() { return S.surrSpot ? [S.surrSpot.x, S.surrSpot.y] : defaultSurrSpot(); }
function setSurrenderSpot(x, y) { if (S.phase !== 'planning') return { ok: false, reason: 'Wait for the orders to resolve' };
  if (!cellOk(x, y, { outdoor: true })) return { ok: false, reason: 'Walk-out spot must be open ground outside' };
  const p = findPath(S.suspect.x, S.suspect.y, (xx, yy) => xx === x && yy === y, { suspect: true, canOpen: true, allDoors: true }); if (!p) return { ok: false, reason: 'He cannot walk there from the house' };
  const [hx, hy] = houseCenter(); if (dist(x, y, hx, hy) > 24) return { ok: false, reason: 'Too far from the house — keep it within view' };
  S.surrSpot = { x, y }; log('Walk-out point set. When he comes out he will be told to stop and kneel there.', 'system'); S.version++; return { ok: true }; }
function walkout(how) { const sp = S.suspect, N = S.nego; if (!hostile()) return false; sp.mode = 'surrendered'; sp.stun = 0; N.how = how; N.outcome = how === 'callout' ? 'Call-out surrender' : 'Negotiated surrender';
  sp.walk = { stage: 'wait', turn: S.turn, spot: surrSpot(), amb: false, rolled: false };
  S.doors.forEach(d => { if (d.rooms.includes(sp.room)) { d.barricaded = false; d.locked = false; } if (d.exterior) { d.locked = false; d.barricaded = false; } });
  log('He will come out through the front door in the next 30 seconds. Set up the protocol: cover team (shield), overwatch, PA commands. Then cuff him at the walk-out point.', 'good'); S.version++; }
/** Score the surrender protocol at the moment he steps outside. */
function protocolNow(spot) {
  const [x, y] = spot, P = { cover: false, shield: false, overwatch: false, commands: false, who: [] };
  for (const u of S.units) { if (!unitAlive(u)) continue;
    if (u.kind === 'team' && u.perch && u.deployed) { const wk = weaponOf(u); if (los(u.x, u.y, x, y) && dist(u.x, u.y, x, y) <= WEAPONS[wk].range) { P.overwatch = true; P.who.push(u.name + ' overwatch'); } continue; }
    if (u.kind === 'cruiser' && u.occ.length && dist(u.x, u.y, x, y) <= 14) { P.cover = true; P.who.push(u.name + ' cover'); }
    if (!onFoot(u) || roomAt(u.x, u.y) >= 0) continue; if (dist(u.x, u.y, x, y) > 14 || !los(u.x, u.y, x, y)) continue;
    const l = losEx(x, y, u.x, u.y, true); const nearCar = S.units.some(c => c.kind === 'cruiser' && cheb(c.x, c.y, u.x, u.y) <= 2);
    if (l.cov >= 1 || nearCar) { P.cover = true; P.who.push(u.name + ' cover'); if (u.kind === 'team' && hasShield(u)) P.shield = true; }
    else if (u.kind === 'team' && hasShield(u)) { P.shield = true; } }
  if (paUnits(x, y).length) P.commands = true;
  P.score = ['cover', 'shield', 'overwatch', 'commands'].filter(k => P[k]).length; return P;
}
/** Expected ambush risk shown to the player (does not reveal whether he actually hides a weapon). */
function ambushRisk(P) { const C = NEGO_CFG; let p = C.hiddenWeapon * C.ambushHidden; for (const k of ['cover', 'shield', 'overwatch', 'commands']) if (P[k]) p *= C.protocol[k]; return p; }
function ambushChance(P) { const C = NEGO_CFG; let p = S.nego.hidden ? C.ambushHidden : 0; for (const k of ['cover', 'shield', 'overwatch', 'commands']) if (P[k]) p *= C.protocol[k]; return p; }
/** One tick of the walk-out (suspectTick while surrendered). */
function walkoutTick() {
  const sp = S.suspect, w = sp.walk, N = S.nego; if (!w) return;
  if (w.stage === 'wait') { if (S.turn <= w.turn) return; w.stage = 'out'; log('Suspect is coming out — hands up.', 'alert'); }
  if (w.stage === 'out') {
    if (sp.x === w.spot[0] && sp.y === w.spot[1]) { w.stage = 'kneel'; const cmd = N.protocol && N.protocol.commands;
      log(cmd ? 'PA: "STOP. KNEEL. HANDS ON YOUR HEAD." — he kneels at the walk-out point.' : 'He stops at the walk-out point, standing, hands raised. (No PA commands.)', 'radio'); return; }
    const p = findPath(sp.x, sp.y, (x, y) => x === w.spot[0] && y === w.spot[1], { suspect: true, canOpen: true, allDoors: true });
    if (!p || !p.length) { w.spot = [sp.x, sp.y]; return; } const [nx, ny] = p[0]; const e = edge(sp.x, sp.y, nx, ny); if (e.t === 'D') { e.d.state = 'open'; e.d.barricaded = false; e.d.locked = false; }
    sp.x = nx; sp.y = ny; sp.room = roomAt(nx, ny); sp.atWindow = false; sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn };
    if (sp.room < 0 && !w.rolled) { w.rolled = true; N.protocol = protocolNow(w.spot); w.p = ambushChance(N.protocol); w.amb = S.rng.chance(w.p);
      log(`Walk-out protocol: ${N.protocol.score}/4 (${['cover', 'shield', 'overwatch', 'commands'].map(k => (N.protocol[k] ? '✓ ' : '✗ ') + k).join(', ')}).`, N.protocol.score >= 3 ? 'good' : 'alert'); }
    return; }
  if (w.stage === 'kneel') {
    const near = S.units.filter(u => onFoot(u) && !u.perch && cheb(u.x, u.y, sp.x, sp.y) <= 2).sort((a, b) => dist(a.x, a.y, sp.x, sp.y) - dist(b.x, b.y, sp.x, sp.y));
    if (!S.units.some(u => u.detain)) { const c = S.units.filter(u => onFoot(u) && !u.perch && roomAt(u.x, u.y) < 0 && !(u.orders[0] && u.orders[0].cas)).sort((a, b) => (b.kind === 'team') - (a.kind === 'team') || dist(a.x, a.y, sp.x, sp.y) - dist(b.x, b.y, sp.x, sp.y))[0];
      if (c) { c.detain = true; c.orders = []; log(`${c.name}: moving up to take him into custody.`, 'radio'); } }
    if (near.length && w.amb) { ambushNow(near[0]); return; }
    const adj = near.find(u => cheb(u.x, u.y, sp.x, sp.y) <= 1); if (adj) { sp.walk = null; S.units.forEach(u => u.detain = false); detained(adj, N.outcome || 'Surrendered'); } }
}
function ambushNow(T) {
  const sp = S.suspect, N = S.nego, P = N.protocol || {}, r = S.rng; sp.walk = null; sp.mode = 'alert'; sp.weapon = 'handgun'; sp.ambush = true; sp.retreat = true; N.contact = null; N.quiet = 3; sp.talk = 0; sp.agit = 90;
  S.units.forEach(u => u.detain = false); S.stats.shots++; N.ambush = { turn: S.turn + 1, score: P.score || 0, hit: false };
  fx('muzzle', sp.x, sp.y, { suspect: true }); fx('shot', sp.x, sp.y, { tx: T.x, ty: T.y }); sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn };
  log('AMBUSH — he pulls a hidden handgun on the arrest team!', 'bad'); N.outcome = 'Walk-out ambush';
  let p = NEGO_CFG.ambushHit * (P.commands ? 0.5 : 1) * (T_HIT[targetClass(T, sp.x, sp.y)] || 1);
  if (r.chance(p)) { N.ambush.hit = true; shotOfficer(T, 'pistol', dist(T.x, T.y, sp.x, sp.y), sp.x, sp.y, 'walk-out spot'); } else log(`Rounds miss ${T.name}.`, 'alert');
  const resp = S.units.filter(u => unitAlive(u) && (onFoot(u) || u.perch) && weaponOf(u) && los(u.x, u.y, sp.x, sp.y) && dist(u.x, u.y, sp.x, sp.y) <= WEAPONS[weaponOf(u)].range)
    .sort((a, b) => !!b.perch - !!a.perch);
  for (const u of resp.slice(0, 3)) { const q = u.perch ? 0.7 : P.cover ? 0.55 : 0.3; fx('muzzle', u.x, u.y, { friendly: true }); fx('shot', u.x, u.y, { tx: sp.x, ty: sp.y, friendly: true }); S.stats.ofShots++;
    if (r.chance(q)) { suspectHit(u); if (!hostile()) return; } }
  log('He is running back inside!', 'alert');
}
/** Hostile suspect who ended up outside (after an ambush) retreats to his room. */
function retreatStep() { const sp = S.suspect; const p = findPath(sp.x, sp.y, (x, y) => x === sp.home.x && y === sp.home.y, { suspect: true, canOpen: true, allDoors: true });
  if (!p || !p.length) { sp.retreat = false; return; } const [nx, ny] = p[0]; const e = edge(sp.x, sp.y, nx, ny); if (e.t === 'D') e.d.state = 'open'; sp.x = nx; sp.y = ny; sp.room = roomAt(nx, ny);
  if (sp.x === sp.home.x && sp.y === sp.home.y) sp.retreat = false; }
function negoTurn() { const N = S.nego; if (N.quiet > 0) N.quiet--; if (N.contact === 'pa' && !paUnits().length) { N.contact = null; negHist('PA contact lost — no loudspeaker in range.', 'radio'); } }
function negoSummary() { const N = S.nego, sp = S.suspect;
  return { onScene: negOnScene().length, contact: contactLive() ? N.contact : null, numberKnown: N.numberKnown, numberSrc: N.numberSrc, line: N.line, quiet: N.quiet, attempts: N.attempts, refusals: N.refusals, rounds: N.rounds,
    concessions: N.concessions, mood: moodWord(), rapport: rapportWord(), read: N.read, warn: N.warn, pick: N.pick, hist: N.hist.slice(-6), outcome: N.outcome, walk: sp.walk ? sp.walk.stage : null,
    protocol: N.protocol, preview: sp.walk || hostile() ? protocolNow(surrSpot()) : null, spot: surrSpot(), avail: Object.fromEntries(TALK_KEYS.map(k => [k, talkAvail(k)])), names: TALK_NAMES }; }
