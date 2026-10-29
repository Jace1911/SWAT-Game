/* ==============================================================
   v20 — encounter consistency, window throws, reaction prompts,
   injuries / officer-hit messages and the rest of batch 1.
   (Later declarations override earlier ones of the same name.)
   ============================================================== */
const V20 = { dropP: 0.2, fairTurns: 1, followMax: 3, buddyDiv: 3 };
function r20() { if (!S.r20) S.r20 = makeRng((S.seed || 1) * 61 + 29); return S.r20; }

/* ---------- item 2: weapon knowledge ---------- */
/** A confirmed weapon (seen clearly, or he fired at officers) stays in every prompt while officers keep sight of him.
    Out of sight he may put it down; on the next contact officers must reassess. */
function encRead(sp, u, pose) { const M = mindOf(sp);
  if (pose !== 'heard') {
    if (sp.armedKnown && M.lastSeen !== undefined && M.lastSeen < S.turn - 1 && !encFair(sp)) {
      if (spArmed(sp) && r20().chance(V20.dropP)) { sp.droppedWeapon = sp.weapon; sp.weapon = 'none'; }
      sp.armedKnown = false; M.reassess = true; }
    M.lastSeen = S.turn; }
  const rd = encReadBase(sp, u, pose);
  if (pose !== 'heard' && sp.armedKnown && spArmed(sp)) { rd.actual = 'weapon'; rd.kind = sp.weapon; rd.looks = 'gun'; rd.conf = 'known'; }
  else if (pose !== 'heard' && rd.actual === 'weapon' && rd.looks === 'gun' && rd.conf === 'confident') sp.armedKnown = true;
  if (M.reassess && pose !== 'heard') { rd.reassess = true; M.reassess = false; }
  return rd; }
/** He shot at officers this turn or last (≤ 30 s): force is justified without review. */
function encFair(sp) { return sp.firedAt !== undefined && sp.firedAt !== null && sp.firedAt >= S.turn - V20.fairTurns; }
function encJustified(sp, item) { const M = mindOf(sp), rd = M.read || {};
  if (encFair(sp) || item.pose === 'aim') return true;
  if (item.pose === 'awayUp' || item.pose === 'hands') return false;
  return rd.actual === 'weapon' || (!!sp.armedKnown && spArmed(sp)); }
function confText(rd, sp) { const gw = (GUN_WORD[sp.weapon] || 'a handgun').replace(/^an? /, '');
  if (rd.conf === 'known') return `Officers KNOW he is armed (${gw}) — ${encFair(sp) ? 'he fired at officers within the last 30 seconds; force is justified' : 'they saw it and he has not put it down in their sight'}.`;
  if (rd.looks === 'empty') return 'Officers are confident his hands are empty.';
  if (rd.conf === 'confident') return rd.looks === 'gun' ? `Officers are confident it is a gun (${gw}).` : 'Officers are confident it is a phone.';
  if (rd.conf === 'uncertain') return rd.looks === 'gun' ? 'Officers are uncertain but it looks like a gun.' : 'Officers are uncertain — it may be a phone.';
  return 'Officers cannot tell — unknown item.'; }

/* ---------- item 7: how the suspect is injured (neutral wording) ---------- */
function injWhere(sp, state) { const r = makeRng((S.seed || 1) * 97 + S.turn * 13 + (S.tick || 0) * 7 + (sp.sid || 0));
  if (state === 'mobile') return r.pick(['hit in the left arm', 'hit in the right arm', 'grazed on the leg — limping', 'hit in the shoulder', 'hit in the hip — moving slowly']);
  if (state === 'kia') return 'hit in the torso — no movement';
  return r.pick(['hit in the leg — cannot stand', 'hit in the torso — on the floor', 'hit in the hip — on the floor', 'hit in the shoulder and down']); }
function injText(sp) { return sp.injuryText ? `He is injured (${sp.injuryText}).` : 'He appears injured.'; }

/* ---------- item 8: officer-hit message + buddy aid ---------- */
const HIT_WHERE = { 1: ['upper arm', 'forearm', 'lower leg', 'hand'], 2: ['thigh', 'shoulder', 'side below the vest', 'hip'], 3: ['abdomen below the vest', 'upper chest at the vest edge', 'upper thigh', 'neck area'] };
function hitMessage(c, team) { const r = makeRng((S.seed || 1) * 131 + (S.casSeq || 0) * 7 + S.turn);
  c.where = c.minor ? 'vest (blunt impact behind the armor)' : r.pick(HIT_WHERE[c.sev] || HIT_WHERE[2]);
  const sevW = c.minor ? 'minor' : c.state === 'kia' ? 'fatal' : c.sev >= 3 ? 'critical' : c.sev === 2 ? 'serious' : 'minor';
  const tail = c.state === 'kia' ? 'Killed in action.' : c.stable ? 'Stabilised — needs extraction to EMS.' : `Time until critical without further aid: ${tDur(c.crit)}.`;
  const m = { turn: S.turn, tick: S.tick || 0, id: c.id, sev: sevW, text: `OFFICER HIT — ${c.name}${team ? ' (' + team + ')' : ''}: ${c.where}, ${sevW}. ${tail}` };
  (S.hitMsgs = S.hitMsgs || []).push(m); return m; }
function officerDown(u, msg, ctx) { const c = officerDownBase(u, msg, ctx); if (!c) return c;
  // buddy aid: no medic on the team → a teammate applies aid at once (1/3 of a medic with a bag)
  if (u.kind === 'team' && casActive(c) && !c.stable && !c.aided && teamOk(u).length && !hasSpec(u, 'medic')) applyAid(u, c, true);
  hitMessage(c, u.kind === 'team' ? u.name : 'patrol'); return c; }
/** Buddy aid by any officer = 1/3 the bleed-out slowing of a medic with a bag. */
CAS_CFG.aidOther = Math.max(1, Math.round(CAS_CFG.medicSevere / V20.buddyDiv));

/* ---------- item 1: window throws at the threshold ---------- */
const WIN_OPTS = [
  { key: 'wfire', label: 'Return fire from position', sub: 'stay at the window and return fire into the room' },
  { key: 'wretreat', label: 'Return fire while retreating to the nearest cover', sub: 'a short burst of fire, then move to cover out of his line of sight' },
  { key: 'wwithdraw', label: 'Withdraw to the nearest cover', sub: 'no shots — move to cover out of his line of sight' },
];
const END_OPT = { key: 'endturn', label: 'End turn', hint: 'No further action now — the turn resolves', who: [], team: true };
/** The team throws into room r through a window (no door/opening between its cell and the room). */
function encViaWindow(u, r) { if (roomAt(u.x, u.y) === r) return false;
  for (const [dx, dy] of DIRS4) { const nx = u.x + dx, ny = u.y + dy; if (!inb(nx, ny) || roomAt(nx, ny) !== r) continue; const e = edge(u.x, u.y, nx, ny); if (e.t === 'D' || e.t === 'O') return false; }
  return true; }
function encThreshold(u, o) { if (!encOn() || S.phase !== 'executing' || !u || u.kind !== 'team') return null; const r = afterRoom(u, o); if (r < 0) return null;
  const sp = suspList().find(s => spHostile(s) && s.room === r && spArmed(s)); if (!sp) return null;
  return withSp(sp, () => { const M = mindOf(sp); const p = ENC_CFG.blind * (0.5 + M.harmOff) * (sp.stun > 0 ? 0.3 : 1) * (o.type === 'gas' ? 0.8 : 1); if (!S.rng.chance(p)) return null;
    const win = (o.type === 'gas' || o.type === 'bang') && encViaWindow(u, r);
    const n0 = S.log.length, where = S.rooms[r] && S.rooms[r].known ? S.rooms[r].name : 'room'; sp.firedAt = S.turn; sp.armedKnown = true; S.stats.shots++; sp.mode = 'alert'; sp.cd = 2;
    fx('muzzle', sp.x, sp.y, { suspect: true }); fx('shot', sp.x, sp.y, { tx: u.x, ty: u.y });
    log(win ? `SHOTS THROUGH THE WINDOW — ${multiSp() ? spName().toLowerCase() : 'the suspect'} is firing at the ${where} window.` : `SHOTS THROUGH THE DOORWAY — ${multiSp() ? spName().toLowerCase() : 'the suspect'} is firing blindly at the threshold of the ${where}.`, 'alert');
    if (S.rng.chance(ENC_CFG.blindHit)) shotOfficer(u, SUSPECT_CAL[sp.weapon] || 'pistol', 2, sp.x, sp.y, where); else log(win ? 'No hits — rounds strike the window frame.' : 'No hits — rounds strike the door frame.', 'alert');
    const what = o.type === 'gas' ? (o.cs40 ? 'firing a CS round' : 'throwing CS') : 'throwing a flashbang';
    const text = win ? `${u.name} is outside the ${where}, at the window (${what}). Fire from inside — he is not visible. The team is outside: what does it do?` : `${u.name} is at the ${where} doorway. Blind fire from inside — he is not visible. What does the team do?`;
    return encPause([{ kind: 'blind', win, sp: spIdx(sp), uid: u.uid, room: r, title: win ? 'Shots at the window' : 'Shots at the threshold', text, res0: encLogFrom(n0),
      options: (win ? WIN_OPTS : BLIND_OPTS).map(b => ({ key: b.key, label: b.label, hint: b.sub, who: [] })).concat([Object.assign({}, END_OPT)]) }], false); }); }
function blindChoose(key) { const it = encCur(); if (!it || it.kind !== 'blind') return { ok: false, reason: 'No decision pending' };
  if (key === 'endturn') return encEndChoice(it);
  if (!it.win) return blindChoose0(key);
  if (!WIN_OPTS.some(b => b.key === key)) return { ok: false, reason: 'Unknown choice' };
  const u = unit(it.uid), sp = spAt(it.sp), n0 = S.log.length, r = it.room, enter = q => q.fromAfter || ((q.type === 'clear' || q.type === 'move') && (q.room === r || roomAt(q.x, q.y) === r));
  if (u && unitAlive(u)) { u.orders = u.orders.filter(q => !enter(q)); u.regroup = null;
    if (key === 'wfire') { u.orders.unshift({ type: 'hold', fromEnc: true }); log(`${u.name}: returning fire through the window from position.`, 'radio'); encDoorFire(u, sp, 3, true); }
    else if (key === 'wretreat') { log(`${u.name}: returning fire while moving to cover.`, 'radio'); encDoorFire(u, sp, 2, true); if (sp) encWithdraw(u, sp); }
    else { log(`${u.name}: withdrawing from the window to cover.`, 'radio'); if (sp) encWithdraw(u, sp); else u.orders.unshift({ type: 'hold', fromEnc: true }); } }
  it.done = true; it.chose = key; it.res = encLogFrom(n0); S.version++; return { ok: true, res: it.res }; }

/* ---------- item 3: reaction prompt after each choice + End turn ---------- */
function encOptions(sp, u, pose, rd) { return encOptionsBase(sp, u, pose, rd).concat([Object.assign({}, END_OPT)]); }
function encRespond(sp, u, key, item) { const r = encRespondBase(sp, u, key, item); S.encResp = r; return r; }
function encEndChoice(it) { const n0 = S.log.length; const u = unit(it.uid); log(`${u ? u.name : 'Team'}: no further action — end of turn.`, 'radio');
  it.done = true; it.chose = 'endturn'; it.res = encLogFrom(n0);
  S.enc.items = S.enc.items.filter((x, j) => j <= S.enc.i || !(x.follow && x.sp === it.sp)); S.version++; return { ok: true, res: it.res, end: true }; }
function encChoose(key, offId) { const it = encCur(); if (!it || it.done || S.phase !== 'encounter') return { ok: false, reason: 'No decision pending' };
  if (key === 'endturn') return encEndChoice(it);
  if (it.kind === 'blind') return blindChoose(key);
  const sp = spAt(it.sp); S.encResp = null;
  const st0 = sp ? { stun: sp.stun || 0, inj: !!sp.injured, armed: spArmed(sp), x: sp.x, y: sp.y } : null;
  const r = encChooseBase(key, offId); if (!r.ok) return r;
  const f = encFollow(it, key, st0); if (f) { S.enc.items.splice(S.enc.i + 1, 0, f); r.follow = true; }
  return r; }
function encReactText(sp, key, st0, resp, seen) {
  if (sp.mode === 'surrendered' || sp.mode === 'detained') return `He complies — ${st0 && st0.armed ? 'weapon on the floor, ' : ''}hands up, getting on the ground. Move in and take him into custody.`;
  if (sp.mode === 'incapacitated') return sp.deceased ? 'He is down and not moving. Secure the scene.' : `He is down and no longer a threat${sp.injuryText ? ' (' + sp.injuryText + ')' : ''}. Move in, secure him and get EMS.`;
  if (sp.stun > (st0 ? st0.stun : 0) || (sp.stun > 0 && ['taser', 'll', 'bang'].includes(key))) return key === 'bang' ? 'He is disoriented by the flash — a short window to move in.' : 'He is incapacitated by the device — move in for the arrest now.';
  const L = [];
  if (sp.injured && st0 && !st0.inj) L.push(`He is hit (${sp.injuryText || 'injured'}) but still moving.`);
  if (key === 'shoot' && !(sp.injured && st0 && !st0.inj)) L.push('The shot missed.');
  if (key === 'gas') L.push('CS fills the room — he is coughing.');
  if (key === 'withdraw') L.push('The team backs out of his line of sight.');
  if (resp === 'fire' || encFair(sp) && key !== 'withdraw' && sp.firedAt === S.turn && resp !== 'comply') L.push('He fired at the officers. Force is justified this turn and next.');
  else if (resp === 'hostage') L.push('He grabs the person next to him and holds them in front of him.');
  else if (resp === 'delay') L.push('He is stalling — "give me a minute". He may come out at the end of the turn.');
  else if (resp === 'retreat') L.push('He backs away deeper into the room' + (seen ? '.' : ' — out of sight.'));
  else if (resp === 'ignore') L.push('He ignores the officers and stays where he is.');
  else if (key === 'hold' || resp === 'comply') L.push('He stays where he is.');
  if (!L.length) L.push('No visible change in his behaviour.');
  return L.join(' '); }
function encFollow(it, key, st0) { const sp = spAt(it.sp), u = unit(it.uid); if (!sp) return null;
  return withSp(sp, () => { const M = mindOf(sp), depth = (it.depth || 0) + 1, resp = S.encResp;
    const seen = !!(u && encSeers(sp).includes(u)), react = encReactText(sp, key, st0, resp, seen);
    const base = { follow: true, depth, sp: it.sp, uid: it.uid, mid: it.mid, res: (it.res || []).slice() };
    const go = hostile() && sp.stun <= 0 && sp.mode !== 'fleeing' && key !== 'withdraw' && seen && u && unitAlive(u) && teamOk(u).length && depth <= V20.followMax;
    if (!go) return Object.assign(base, { kind: 'result', title: 'Suspect reaction', text: react, done: true });
    if (resp === 'retreat' || resp === 'hostage') M.poseTurn = -1; const pose = resp === 'hostage' && hostageAvail(sp) ? 'hostage' : encPose(sp, u);
    M.pose = pose; M.poseTurn = S.turn; const rd = encRead(sp, u, pose); M.read = rd;
    return Object.assign(base, { kind: 'contact', pose, react, read: { conf: rd.conf, looks: rd.looks }, title: `Suspect reaction — ${u.name}`, text: react + ' ' + encDescribe(sp, u, pose, rd), options: encOptions(sp, u, pose, rd) }); }); }

/* ---------- items 4 / 12: officer tags in pick lists ---------- */
function itemShort(k) { return (EQUIP[k] && EQUIP[k].short) || (WEAPONS[k] && WEAPONS[k].short) || (ITEM_CFG[k] && ITEM_CFG[k].short) || k; }
function handsText(o) { const h = invOf(o).hands; if (h[0] && h[0] === h[1]) return itemShort(h[0]) + ' (both hands)'; return h.map(x => x ? itemShort(x) : 'free').join(' + '); }
function offRole(o) { const t = o && o.team ? unit(o.team) : null; if (!t) return ''; const i = t.members.indexOf(o.id); return i === 0 ? 'Point' : i === 1 ? 'Defense' : 'Team #' + (i + 1); }
function offSpecs(o) { return [o.spec, o.spec2].filter((k, i, a) => k && a.indexOf(k) === i).map(k => SPECS[k] ? SPECS[k].name : k).join(' / '); }
/** "Point · Breacher · Hands: Shield + Pistol" — shown next to each name wherever the player picks an officer. */
function offTag(id) { const o = off(id) || S.officers.find(q => q.id === id); if (!o) return ''; return [offRole(o), offSpecs(o), 'Hands: ' + handsText(o)].filter(Boolean).join(' · '); }

/* ---------- item 11: voice-only call-out (no bullhorn, or no free hand for it) ---------- */
V20.voiceRange = 10; V20.voiceMul = 0.8;
/** A bullhorn someone on the team can actually work (one free-able hand). */
function bullhornUsable(u) { return !!u && u.kind === 'team' && teamOk(u).some(o => carries(o, 'bullhorn') && freeable(o) >= 1); }
/** Call Out without a usable bullhorn: a shouted call-out, heard ~10 m (from the voice to him). Same rules as the PA call-out, a little less authoritative. */
function voiceCallout(u, o) { const N = S.nego, sp = S.suspect, r = S.rng, C = NEGO_CFG.callout; N.attempts++;
  log(`${u.name} (voice): "POLICE! COME OUT WITH YOUR HANDS EMPTY!"`, 'radio');
  if (dist(u.x, u.y, sp.x, sp.y) > V20.voiceRange) { negHist('Voice call-out: no response — probably out of earshot (~10 m).', 'radio'); return; }
  let p = (C.base * (stypeCfg().calloutMul || 1) + sp.talk / 100 * C.talk + (S.gasActive && S.gas[idx(sp.x, sp.y)] > 0.2 ? C.gas : 0) - (sp.agit > C.agitHigh ? C.agitPen : 0)) * V20.voiceMul;
  if (S.contain.length && S.contain.some(c => !c.covered)) p *= C.contain; N.lastCallout = p;
  if (r.chance(p)) { negHist('Voice call-out: he shouts that he is coming out.', 'good'); walkout('callout'); return; }
  N.refusals++; sp.agit = clamp(sp.agit + C.agit, 0, 100);
  const f = r(); if (f < C.fire + sp.agit / 400) { negHist('Voice call-out refused — he answers with gunfire.', 'alert'); shoutReveal(u, true); if (hostile() && sp.cd === 0 && los(sp.x, sp.y, u.x, u.y)) suspectFire({ u, px: sp.x, py: sp.y, d: dist(sp.x, sp.y, u.x, u.y), l: los(sp.x, sp.y, u.x, u.y), cls: targetClass(u, sp.x, sp.y) }); }
  else if (f < C.fire + C.yell) { negHist('Voice call-out refused — he yells back.', 'radio'); shoutReveal(u, false); }
  else negHist('Voice call-out: no response.', 'radio'); }
/** The Call Out button: PA/bullhorn when possible, else a voice call-out. */
function calloutMode(u) { if (!u) return null; if (u.kind === 'cruiser' || u.inCar) return 'pa'; return bullhornUsable(u) ? 'pa' : 'voice'; }

/* ---------- item 12 (+ v21 item 21 groundwork): set kit down to throw; dropped items on the ground ---------- */
V20.pickR = 2;
/** Put a held shield / ram on the ground at the team's position (leaves an icon; anyone within 2 m can pick it up). */
function dropItem(offId, k) { const o = off(offId); if (!o) return { ok: false, reason: 'No officer' }; const inv = invOf(o); if (!holds(o, k)) return { ok: false, reason: 'Not in hand' };
  const u = S.units.find(t => t.kind === 'team' && t.members.includes(o.id)); if (!u || !u.deployed) return { ok: false, reason: 'Only on scene' };
  inv.hands = inv.hands.map(x => x === k ? null : x); if (!S.dropped) S.dropped = []; S.dropped.push({ k, x: u.x, y: u.y, by: o.id, turn: S.turn });
  syncEquip(u); log(`${o.name} sets the ${EQUIP[k] ? EQUIP[k].short : k} down on the ground.`, 'radio'); return { ok: true }; }
/** Dropped items a team can reach (within 2 m). */
function droppedNear(uid) { const u = unit(uid); if (!u || !S.dropped) return []; return S.dropped.map((d, i) => ({ ...d, i })).filter(d => dist(u.x, u.y, d.x, d.y) <= V20.pickR + 0.01); }
/** Pick a dropped item up: goes into the hands of the team member with the most free hands (a rifle is slung if needed). */
function pickUp(uid, i, offId) { const u = unit(uid), d = S.dropped && S.dropped[i]; if (!u || !d) return { ok: false, reason: 'Nothing there' };
  if (dist(u.x, u.y, d.x, d.y) > V20.pickR + 0.01) return { ok: false, reason: 'Too far — must be within 2 m' };
  const m = teamOk(u); const o = (offId != null && m.find(q => q.id === offId)) || m.slice().sort((a, b) => freeable(b) - freeable(a))[0]; if (!o) return { ok: false, reason: 'Nobody to carry it' };
  const inv = invOf(o); if (freeHands(o) < 1) { const st = autoStow(o, d.k); if (freeHands(o) < 1) { autoRedraw(o, st); return { ok: false, reason: `${o.name} has no free hand` }; } }
  const j = inv.hands.indexOf(null); inv.hands[j] = d.k; S.dropped.splice(i, 1); syncEquip(u); log(`${o.name} picks up the ${EQUIP[d.k] ? EQUIP[d.k].short : d.k}.`, 'radio'); return { ok: true, o }; }
/** No one able to throw (bang / gas): who could put everything away to do it. */
function throwPicks(uid, k) { const u = unit(uid); if (!u || u.kind !== 'team') return []; const m = teamOk(u); const carriers = m.filter(o => countOf(o, k) > 0);
  if (!carriers.length) return []; return m.map(o => ({ id: o.id, name: o.name, tag: offTag(o.id), has: countOf(o, k) > 0, setDown: invOf(o).hands.filter(x => x && !(ITEM_CFG[x] || {}).stow) })); }
/** Ready officer offId to throw k: anything that cannot be stowed is set down on the ground; a teammate hands over the device if needed. */
function prepThrower(uid, offId, k) { const u = unit(uid), o = off(offId); if (!u || !o || !u.members.includes(offId)) return { ok: false, reason: 'Not on this team' };
  for (const x of [...new Set(invOf(o).hands.filter(x => x && !(ITEM_CFG[x] || {}).stow))]) { const r = dropItem(offId, x); if (!r.ok) return r; }
  if (countOf(o, k) <= 0) { const g = teamOk(u).find(q => q !== o && countOf(q, k) > 0); if (!g) return { ok: false, reason: 'Nobody has one' };
    const gi = invOf(g); if ((gi.packed[k] || 0) > 0) gi.packed[k]--; else if ((gi.vest[k] || 0) > 0) gi.vest[k]--; else return { ok: false, reason: 'Cannot hand it over' };
    invOf(o).packed[k] = (invOf(o).packed[k] || 0) + 1; log(`${g.name} hands a ${EQUIP[k].short} to ${o.name}.`, 'radio'); }
  syncEquip(u); return { ok: true, o }; }

/* ---------- item 15: Draco tip devices (2 flashbangs, 4 CS) into the room the arm is in contact with ---------- */
function dracoTipOf(c) { if (c && c.draco && !c.dracoTip) c.dracoTip = { bang: DRACO_CFG.tip.bang, gas: DRACO_CFG.tip.gas }; return c && c.dracoTip; }
/** Which room the claw is in (arm in contact with a door or window right now), or a reason. */
function dracoTipInfo(c) { if (!c || !c.draco) return { reason: 'Needs the BearCat with the Draco arm installed' }; dracoTipOf(c); const a = c.dracoAt;
  if (!a) return { reason: 'Put the Draco arm into a door or window first (Draco Breach)' };
  const o = a.win != null ? { win: a.win } : { door: a.door }; if (!dracoContact(c, o)) return { reason: 'The arm is no longer in the opening (vehicle moved)' };
  const room = a.win != null ? S.windows[a.win].room : (S.doors[a.door].rooms || []).find(r => r != null && r >= 0);
  if (room == null) return { reason: 'No room behind that opening' }; return { room, name: S.rooms[room].known ? S.rooms[room].name : 'room', tip: c.dracoTip }; }
function dracoTipAct(c, o) { const t = dracoTipInfo(c); if (t.room == null) { log(`${c.name}: ${t.reason}.`, 'radio'); return; } const k = o.what === 'bang' ? 'bang' : 'gas';
  if (!(c.dracoTip[k] > 0)) { log(`${c.name}: none left in the Draco tip.`, 'radio'); return; } c.dracoTip[k]--; const tc = roomTargetCell(t.room);
  if (k === 'bang') { fx('flash', tc[0], tc[1], { fromX: c.x, fromY: c.y }); noise(tc[0], tc[1], 10, 'bang'); log(`${c.name}: BANG OUT — flashbang from the Draco tip into ${t.name} (${c.dracoTip.bang} left).`, 'radio');
    let nb = 0; eachSp(sp => { if (sp.room === t.room && hostile()) { sp.stun = 5; sp.stunBy = null; sp.daze = FIRE_CFG.bangDaze; sp.ambush = false; nb++; } });
    if (nb) log(nb > 1 ? `${nb} suspects disoriented by flashbang.` : 'Suspect disoriented by flashbang.', 'good'); encMarkDev({ type: 'bang' }); aggressive(10); }
  else { gasDeploy(t.room, 1.1); fx('gas', tc[0], tc[1], { room: t.room, fromX: c.x, fromY: c.y }); log(`${c.name}: CS canister from the Draco tip into ${t.name} (${c.dracoTip.gas} left).`, 'radio'); encMarkDev({ type: 'gas' }); aggressive(15); } }

/* ---------- item 13: BearCat arrives at a random time during the call-out, with its own driver ---------- */
V20.bcDelay = true;
/** Take the BearCat off the scene until a random turn within the call-out (between the first and last officer ETA). */
function bcSchedule() { const c = bearcat(); if (!c || !V20.bcDelay) return; const q = makeRng((S.seed * 433 + 71) >>> 0);
  const etas = S.officers.map(o => o.eta || 0), mx = Math.max(2, ...etas); const t = q.int(1, mx);
  S.bcPending = { unit: c, turn: t }; S.units = S.units.filter(u => u !== c); rebuildDyn(); }
/** Bring the BearCat in now (next to primary staging, as generated). */
function bcArriveNow() { const P = S.bcPending; if (!P) return bearcat(); S.bcPending = null; const c = P.unit;
  if (carClash(c.x, c.y, c.uid)) { const X = S.ext; for (let d = 4; d < 26; d++) { let ok = false; for (const dx of [-d, d]) { const x = X.staging.x + dx, y = S.geo.ST + 4; if (S.drive[idx(x, y)] && !carClash(x, y, null)) { c.x = x; c.y = y; ok = true; break; } } if (ok) break; } }
  S.units.push(c); rebuildDyn(); log(`PAGER: BearCat on scene next to primary staging — its driver stays with it (room for 11 in the back).`, 'pager'); S.events.push({ type: 'pager' }); return c; }
function endTurn() { endTurnBase(); if (S.bcPending && S.turn >= S.bcPending.turn && S.phase !== 'over') bcArriveNow(); }

/* ---------- item 17: rounds per 30-second turn by weapon action ---------- */
const FIRE_RATE = { pistol: 5, rifle: 5, sniper: 1, lesslethal: 1, handgun: 5, shotgun: 1, hrifle: 1, auto: 10 }; // pump / bolt 1 · semi-auto 5 · full-auto 10
V20.autoClose = 2; V20.autoFar = 0.4;
/** Full-auto: much less accurate except at extremely close range (≤ 2 m). */
function autoAcc(w, d) { return (SUSPECT_WEAPONS[w] || {}).auto ? (d <= V20.autoClose ? 1 : V20.autoFar) : 1; }
function fireRate(k, suspect) { return suspect ? (k === 'rifle' ? FIRE_RATE.hrifle : FIRE_RATE[k] || 5) : FIRE_RATE[k] || 5; }
function shotsUsed(key) { if (!S.shotsT || S.shotsT.turn !== S.turn) S.shotsT = { turn: S.turn, m: {} }; return S.shotsT.m[key] || 0; }
function shotSpend(key) { shotsUsed(key); S.shotsT.m[key] = (S.shotsT.m[key] || 0) + 1; }
/** Rounds this unit / suspect may still fire this turn. */
function shotsLeft(u) { const k = weaponOf(u) || 'pistol'; return Math.max(0, fireRate(k) - shotsUsed(u.uid)); }
function fireAt(u, tx, ty, mode, isReturn) { const k = weaponOf(u) || 'pistol'; if (shotsUsed(u.uid) >= fireRate(k)) { if (!isReturn) log(`${u.name}: ${WEAPONS[k] ? String(WEAPONS[k].short || WEAPONS[k].name).toLowerCase() : k} — no more aimed rounds this turn (${fireRate(k)} per 30 s).`); return 'empty'; }
  shotSpend(u.uid); return fireAtBase(u, tx, ty, mode, isReturn); }
function suspectFire(b) { const sp = S.suspect, key = 'sp:' + (sp.key || 'S'); if (shotsUsed(key) >= fireRate(sp.weapon, true)) return; shotSpend(key);
  const r = suspectFireBase(b); if ((SUSPECT_WEAPONS[sp.weapon] || {}).auto && sp.cd > 0) sp.cd = 0; return r; }

/* ---------- item 6: inside a house every member stays within 2 m of the nearest teammate, on the same wall where possible ---------- */
V20.formMax = 2; V20.formMin = 0.6;
function wallSpots(u, n) { const r = roomAt(u.x, u.y), rad = FORM_CFG.wallRad, W = 0.5 - FORM_CFG.wallIn, c = [];
  for (let y = u.y - 4; y <= u.y + 4; y++) for (let x = u.x - 4; x <= u.x + 4; x++) { if (!inb(x, y) || roomAt(x, y) !== r || S.block[idx(x, y)] || dist(x, y, u.x, u.y) > rad) continue;
    if (!(x === u.x && y === u.y) && los(u.x, u.y, x, y) !== 1) continue;
    let ox = 0, oy = 0; const ws = []; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (!inb(nx, ny) || roomAt(nx, ny) !== r) { ox += dx * W; oy += dy * W; ws.push(dx ? `x${dx}:${x}` : `y${dy}:${y}`); } }
    if (!ws.length) continue; c.push({ ox: x - u.x + ox, oy: y - u.y + oy, walls: ws.length, ws, d: dist(x, y, u.x, u.y) }); }
  if (c.length < Math.min(n, 2)) return null;
  const bx = -Math.cos(u.dir || 0), by = -Math.sin(u.dir || 0), pick = [], D = (p, q) => Math.hypot(p.ox - q.ox, p.oy - q.oy);
  c.sort((a, b) => (a.d - (a.ox * bx + a.oy * by) * 0.3 - a.walls * 0.1) - (b.d - (b.ox * bx + b.oy * by) * 0.3 - b.walls * 0.1)); pick.push(c[0]);
  const wallOf = new Map(); for (const w of c[0].ws) wallOf.set(w, (S.rooms[r] ? 1 : 1)); // the point man's wall(s)
  while (pick.length < n) { let best = null, bs = -1e9;
    for (const q of c) { if (pick.includes(q)) continue; const m = Math.min(...pick.map(p => D(p, q)));
      const same = q.ws.some(w => wallOf.has(w)), s = (m <= V20.formMax ? 10 : -m * 3) + (same ? 4 : 0) - Math.abs(m - 0.9) - (m < V20.formMin ? 6 : 0) - q.d * 0.05;
      if (s > bs) { bs = s; best = q; } }
    if (!best) best = doubleUp(u, r, pick, c) || (() => { const p = pick[pick.length - 1]; return { ox: p.ox * 0.9, oy: p.oy * 0.9, ws: [] }; })();
    else { const near = q => Math.min(...pick.map(p => D(p, q)));
      if (near(best) > V20.formMax) { /* no wall spot within 2 m: take the closest free wall spot, else double up along the wall next to a teammate */
        let alt = null, am = 1e9; for (const q of c) { if (pick.includes(q)) continue; const m = near(q); if (m < am) { am = m; alt = q; } }
        if (alt && am <= V20.formMax) best = alt; else best = doubleUp(u, r, pick, c) || alt || best; } }
    pick.push(best); }
  return pick.map(p => [+p.ox.toFixed(2), +p.oy.toFixed(2)]); }
/** A wall-hugging spot ~0.5 m along the wall from a placed teammate (same cell side), staying inside the room. */
function doubleUp(u, r, pick, c) { for (const p of pick) { if (!p.ws || !p.ws.length) continue;
    for (const s of [0.5, -0.5, 0.45, -0.45]) { const alongX = /^y/.test(p.ws[0]); const ox = p.ox + (alongX ? s : 0), oy = p.oy + (alongX ? 0 : s);
      const cx = Math.round(u.x + ox), cy = Math.round(u.y + oy); if (!inb(cx, cy) || roomAt(cx, cy) !== r || S.block[idx(cx, cy)]) continue;
      if (pick.some(q => Math.hypot(q.ox - ox, q.oy - oy) < 0.4)) continue;
      const fx = u.x + ox - cx, fy = u.y + oy - cy, ok = (fx >= 0.25 && roomAt(cx + 1, cy) !== r) || (fx <= -0.25 && roomAt(cx - 1, cy) !== r) || (fy >= 0.25 && roomAt(cx, cy + 1) !== r) || (fy <= -0.25 && roomAt(cx, cy - 1) !== r);
      if (ok) return { ox, oy, ws: p.ws, dbl: true }; } } return null; }
/** Largest nearest-teammate gap (m) in a formation — used by tests and the help text. */
function formGap(pts) { let g = 0; for (let i = 0; i < pts.length; i++) { let m = 1e9; for (let j = 0; j < pts.length; j++) if (i !== j) m = Math.min(m, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])); if (pts.length > 1) g = Math.max(g, m); } return g; }
