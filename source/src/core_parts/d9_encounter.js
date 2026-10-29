
/* =====================================================================
   v16 ENCOUNTERS — the see-suspect decision. Rules only (no DOM).
   Every turn an officer team has a direct sight line to a hostile suspect, the turn pauses at its end (a half-turn
   before it resolves) with one popup per suspect: a description written fresh from his CURRENT state, how sure the
   officers are about what is in his hands, and the options this team's equipment allows, each with a likelihood word
   (the percentages behind it stay hidden). The player picks an option, then the officer who does it.
   - armed and AIMING at officers: no choice — officers engage; who gets the first rounds off is rolled (FIRST-FIRE rule)
   - shots at officers inside the house with a direct line during the turn: officers already returned fire
     automatically; a result box says what happened before the turn ends
   - BLIND FIRE at the threshold after a breach / flashbang / gas: the turn pauses at once with 4 choices
   S.encOn switches the system on (UI games); headless bots / balance harness run without it.
   ===================================================================== */
const ENC_CFG = {
  enabled: false,
  words: [[0.75, 'Very likely'], [0.55, 'Likely'], [0.35, 'Possible'], [0.15, 'Unlikely'], [0, 'Very unlikely']],
  firstFire: 0.75, cut: { bang: 0.35, gas: 0.25, charge: 0.2 }, firstMin: 0.2,
  blind: 0.16, blindHit: 0.18, negBonus: 0.12, crowd: 0.04, heard: 0.3, heardDist: 3,
  unhurt: 300, minorKeep: 0.8, killedKeep: 0.33, unjustKeep: 0.05, reviewMissions: 10, removeP: 0.3, keep: 0.45,
};
/* personality traits — base compliance and the hooks a later full mental-state system plugs into */
const ENC_TRAITS = {
  compliant:   { comply: 0.55, stall: 0.15, flee: 0.15, harmOff: 0.05, selfHarm: 0, sbc: 0, fightBare: 0.05, label: 'compliant' },
  stalling:    { comply: 0.30, stall: 0.55, flee: 0.15, harmOff: 0.10, selfHarm: 0, sbc: 0, fightBare: 0.10, label: 'compliant but stalling' },
  scared:      { comply: 0.38, stall: 0.20, flee: 0.50, harmOff: 0.15, selfHarm: 0.05, sbc: 0, fightBare: 0.10, label: 'scared' },
  intoxicated: { comply: 0.22, stall: 0.20, flee: 0.25, harmOff: 0.25, selfHarm: 0.05, sbc: 0.05, fightBare: 0.35, label: 'intoxicated' },
  mental:      { comply: 0.20, stall: 0.25, flee: 0.20, harmOff: 0.20, selfHarm: 0.35, sbc: 0.15, fightBare: 0.15, label: 'in mental-health crisis' },
  determined:  { comply: 0.07, stall: 0.10, flee: 0.15, harmOff: 0.55, selfHarm: 0.05, sbc: 0.10, fightBare: 0.40, label: 'determined' },
};
const ENC_POSES = {
  aim:     { armed: true,  text: 'is pointing {item} at the officers' },
  down:    { armed: true,  text: 'is holding {item} down at his side' },
  hands:   { text: 'has both hands visible and empty' },
  pockets: { text: 'has his hands in his pockets' },
  ignore:  { text: 'is pacing and ignoring commands', armedText: 'is pacing with {item} in his hand, ignoring commands' },
  record:  { text: 'is holding up a phone, video recording the officers' },
  call:    { text: 'has one hand up and the other holding a phone to his ear — calling someone' },
  behind:  { text: 'has {hands} behind his back, out of view' },
  awayUp:  { text: 'is turned away from the officers with both hands up', compliant: true },
  conceal: { text: '{facing} with {hands} hidden in front of his body' },
  cover:   { text: 'is partly hidden behind {cover}, only part of him visible' },
  selfharm:{ text: 'is threatening to hurt himself' },
  hostage: { text: 'is holding a person in front of him' },
  heard:   { text: 'cannot be seen — officers hear movement close by' },
};
const ENC_OPTS = {
  v_drop:  { label: 'Voice: "Drop it!"', voice: true, want: 'comply' },
  v_hands: { label: 'Voice: "Show me your hands!"', voice: true, want: 'comply' },
  v_ground:{ label: 'Voice: "Get down on the ground!"', voice: true, want: 'comply' },
  v_come:  { label: 'Voice: "Walk to us — slowly!"', voice: true, want: 'comply' },
  v_phone: { label: 'Voice: "Put the phone down!"', voice: true, want: 'comply' },
  nego:    { label: 'Negotiator talks to him', want: 'comply' },
  hold:    { label: 'Hold and observe', want: 'stable' },
  taser:   { label: 'Taser', want: 'stop' },
  ll:      { label: 'Less-lethal (40mm)', want: 'stop' },
  bang:    { label: 'Flashbang', want: 'stun' },
  gas:     { label: 'CS gas', want: 'stun' },
  shoot:   { label: 'Shoot (lethal force)', want: 'hit' },
  withdraw:{ label: 'Withdraw / back out', want: 'safe' },
};
const ENC_WANT = { comply: 'he complies', stable: 'he stays put without escalating', stop: 'it stops him', stun: 'it stuns him', hit: 'a hit', safe: 'a clean exit' };
const BLIND_OPTS = [
  { key: 'cancel', label: 'Cancel the plan to enter the room', sub: 'pull back from the doorway and hold' },
  { key: 'continue', label: 'Continue entering and return fire', sub: 'the follow-up goes ahead — officers fire through the doorway first' },
  { key: 'doorway', label: 'Work the doorway without going through', sub: 'stay outside and assess / slice the room from the frame' },
  { key: 'frame', label: 'Point and defense engage from the door frame', sub: 'two officers fire from the frame, the rest stay back' },
];
function encOn() { return S.encOn !== undefined ? !!S.encOn : ENC_CFG.enabled; }
function encWord(p) { for (const [t, w] of ENC_CFG.words) if (p >= t) return w; return 'Very unlikely'; }
function spIdx(sp) { return suspList().indexOf(sp); }
function spAt(i) { return suspList()[i] || null; }
function spArmed(sp) { return !!sp.weapon && sp.weapon !== 'none'; }
/** sp.mind: personality + hooks (self-harm, suicide-by-cop, harm-officers, fight-without-weapons). Lazily made and seeded
    from the mission seed (does not touch S.rng), so old saves gain it on first contact. */
function mindOf(sp) { if (sp.mind) return sp.mind;
  const r = makeRng(S.seed * 7919 + (spIdx(sp) + 1) * 131 + 7), st = S.stype ? S.stype.key : 'barricade';
  const pool = st === 'mental' ? ['mental', 'mental', 'mental', 'scared', 'stalling'] : st === 'domestic' ? ['intoxicated', 'determined', 'stalling', 'scared', 'compliant'] : st === 'flee' || st === 'parole' ? ['scared', 'determined', 'stalling', 'compliant']
    : st === 'neighbor' ? ['intoxicated', 'stalling', 'determined', 'compliant'] : ['determined', 'stalling', 'scared', 'intoxicated', 'compliant', 'mental'];
  const trait = r.pick(pool), T = ENC_TRAITS[trait], j = v => clamp(v + (r() - 0.5) * 0.1, 0, 1);
  sp.mind = { v: 1, trait, comply: j(T.comply), stall: j(T.stall), flee: j(T.flee), harmOff: j(T.harmOff), selfHarm: j(T.selfHarm), sbc: j(T.sbc), fightBare: j(T.fightBare),
    selfHarmHook: st === 'mental', hostageHook: false, phone: r.chance(0.8), pose: null, poseTurn: -1, read: null, cmd: {}, delay: 0, seen: 0, ignored: 0 };
  return sp.mind; }
function hostageAvail(sp) { const M = mindOf(sp); return !!(M.hostageHook && S.hostages && S.hostages.some(h => h.room === sp.room && !h.out)); } // hook: no hostage system yet
/** Teams with a direct line to the suspect (nearest first). */
/** v17: an officer slicing the pie at a corner sees around it from the peek cell — that is visual contact too. */
function encSliceSees(u, sp) { return !!(u.slice && u.slice.ox === u.x && u.slice.oy === u.y && u.slice.cells.includes(idx(sp.x, sp.y))); }
function encSeers(sp) { return S.units.filter(u => u.kind === 'team' && unitAlive(u) && u.deployed && teamOk(u).length && ((u.vis && u.vis.includes(idx(sp.x, sp.y)) && los(u.x, u.y, sp.x, sp.y) === 1) || encSliceSees(u, sp)))
  .sort((a, b) => dist(a.x, a.y, sp.x, sp.y) - dist(b.x, b.y, sp.x, sp.y)); }
/** Pick his visible state this turn from his previous one, weapon, mood and personality. */
function encPose(sp, u) { const M = mindOf(sp), r = S.rng, armed = spArmed(sp), agit = (sp.agit || 0) / 100;
  if (M.pose && M.poseTurn === S.turn) return M.pose;
  const w = {};
  const add = (k, v) => { if (v > 0) w[k] = (w[k] || 0) + v; };
  if (armed) { add('aim', 0.06 + M.harmOff * 0.22 + agit * 0.12 - (sp.daze > 0 ? 0.08 : 0)); add('down', 0.3); add('cover', 0.18); add('conceal', 0.14); add('behind', 0.08); add('pockets', 0.04); }
  else { add('hands', 0.2 + M.comply * 0.3); add('pockets', 0.14); add('behind', 0.1); add('conceal', 0.1); add('cover', 0.1); add('awayUp', 0.05 + M.comply * 0.15); }
  add('ignore', 0.06 + (1 - M.comply) * 0.1); if (M.phone) { add('record', 0.07); add('call', 0.06 + M.stall * 0.08); }
  if (M.selfHarmHook && M.selfHarm > 0.2) add('selfharm', M.selfHarm * 0.3);
  if (hostageAvail(sp)) add('hostage', 0.25);
  if (M.pose && w[M.pose] && M.pose !== 'aim' && r.chance(ENC_CFG.keep)) return M.pose; // sticky: people do not change stance every 30 s
  let tot = 0; for (const k in w) tot += w[k]; let x = r() * tot;
  for (const k in w) { x -= w[k]; if (x <= 0) return k; } return 'down'; }
const GUN_WORD = { handgun: 'a pistol', rifle: 'a rifle', shotgun: 'a shotgun', knife: 'a knife' };
/** What is in his hands vs what the officers think it is, with their confidence. */
function encReadBase(sp, u, pose) { const r = S.rng, armed = spArmed(sp), d = u ? dist(u.x, u.y, sp.x, sp.y) : 8, M = mindOf(sp);
  let actual = 'none';
  if (pose === 'aim' || pose === 'down' || (pose === 'ignore' && armed)) actual = 'weapon';
  else if (pose === 'record' || pose === 'call') actual = 'phone';
  else if (['pockets', 'behind', 'conceal'].includes(pose)) actual = armed && r.chance(0.6) ? 'weapon' : M.phone && r.chance(0.6) ? 'phone' : 'none';
  else if (pose === 'cover' || pose === 'selfharm' || pose === 'hostage') actual = armed ? 'weapon' : 'none';
  const hidden = ['pockets', 'behind', 'conceal', 'cover'].includes(pose), far = d > 6;
  let conf, looks;
  if (pose === 'heard') { conf = 'unknown'; looks = 'unknown'; }
  else if (actual === 'weapon' && !hidden) { conf = far && r.chance(0.3) ? 'uncertain' : 'confident'; looks = 'gun'; }
  else if (actual === 'phone' && !hidden) { if (r.chance(far ? 0.2 : 0.08)) { conf = 'uncertain'; looks = 'gun'; } else { conf = 'confident'; looks = 'phone'; } }
  else if (hidden) { const x = r(); if (actual === 'weapon') { conf = x < 0.35 ? 'uncertain' : 'unknown'; looks = x < 0.35 ? 'gun' : 'unknown'; }
    else if (actual === 'phone') { conf = x < 0.25 ? 'uncertain' : 'unknown'; looks = x < 0.25 ? 'gun' : 'unknown'; } else { conf = 'unknown'; looks = 'unknown'; } }
  else { conf = 'confident'; looks = 'empty'; }
  return { actual, looks, conf, kind: actual === 'weapon' ? (sp.weapon || 'handgun') : actual }; }
function confText(rd, sp) { if (rd.looks === 'empty') return 'Officers are confident his hands are empty.';
  if (rd.conf === 'confident') return rd.looks === 'gun' ? `Officers are confident it is a gun (${(GUN_WORD[sp.weapon] || 'a handgun').replace(/^an? /, '')}).` : 'Officers are confident it is a phone.';
  if (rd.conf === 'uncertain') return rd.looks === 'gun' ? 'Officers are uncertain but it looks like a gun.' : 'Officers are uncertain — it may be a phone.';
  return 'Officers cannot tell — unknown item.'; }
function roomWord(sp) { const rm = S.rooms[sp.room]; return rm && rm.known ? rm.name.toLowerCase() : 'room'; }
/** Fresh description from his actual position and state. */
function encDescribe(sp, u, pose, rd) { const P = ENC_POSES[pose] || ENC_POSES.down, rm = S.rooms[sp.room], r = S.rng;
  let where = 'in the yard';
  if (rm) { const nearX = sp.x - rm.x <= 0 || rm.x + rm.w - 1 - sp.x <= 0, nearY = sp.y - rm.y <= 0 || rm.y + rm.h - 1 - sp.y <= 0;
    where = (nearX && nearY ? 'in the corner of the ' : nearX || nearY ? 'against the wall of the ' : 'in the middle of the ') + roomWord(sp);
    if (sp.atWindow) where = 'by the window of the ' + roomWord(sp); }
  const itemW = rd.looks === 'gun' && rd.conf !== 'unknown' ? (rd.conf === 'confident' || rd.conf === 'known' ? GUN_WORD[sp.weapon] || 'a gun' : 'what looks like a gun') : rd.actual === 'phone' && rd.looks === 'phone' ? 'a phone' : 'something';
  const t = (P.armedText && rd.actual === 'weapon' ? P.armedText : P.text).replace('{item}', itemW).replace('{hands}', r.chance(0.5) ? 'one hand' : 'both hands').replace('{facing}', r.chance(0.5) ? 'is turned away' : 'is facing the officers')
    .replace('{cover}', rm ? r.pick(['a doorway edge', 'a piece of furniture', 'the door frame', 'a wall corner']) : 'a vehicle');
  const dist_ = u ? Math.max(1, Math.round(dist(u.x, u.y, sp.x, sp.y))) : null;
  const lead = pose === 'heard' ? `${multiSp() ? spName(sp) : 'The suspect'} ${t}${rm && rm.known ? ' (' + roomWord(sp) + ')' : ''}.` : `${multiSp() ? spName(sp) : 'He'} is ${where}${dist_ ? ` (~${dist_} m from ${u.name})` : ''} and ${t}.`;
  const extra = [];
  if (sp.daze > 0 || sp.impair > 0.3) extra.push(sp.daze > 0 ? 'He looks disoriented.' : 'He is coughing, eyes streaming.');
  if (sp.injured) extra.push(injText(sp)); if (rd.reassess) extra.push('Officers lost sight of him for a while — they must reassess what is in his hands.');
  const M = mindOf(sp); if (M.ignored >= 2 && pose !== 'heard') extra.push('He has ignored several commands.');
  return [lead, pose === 'heard' ? '' : confText(rd, sp)].concat(extra).filter(Boolean).join(' '); }
/* ---------- equipment-based options and who can do them ---------- */
function encWho(u, sp, key) { if (!u) return [];
  const d = dist(u.x, u.y, sp.x, sp.y), clear = los(u.x, u.y, sp.x, sp.y) === 1, m = teamOk(u);
  const ids = L => L.map(o => o.id);
  switch (key) {
    case 'shoot': return clear ? ids(m.filter(o => { const k = memberWeapon(o); return k && d <= WEAPONS[k].range; })) : [];
    case 'taser': return clear && d <= TASER_CFG.range ? ids(m.filter(o => carries(o, 'taser') && freeable(o) >= 1)) : [];
    case 'll': return clear && d <= LL_CFG.range ? ids(m.filter(o => (o.quals || []).includes('ll') && carries(o, 'lesslethal') && invOf(o).ll > 0 && (holds(o, 'lesslethal') || freeable(o) >= 2))) : [];
    case 'bang': case 'gas': return sp.room >= 0 ? ids(m.filter(o => countOf(o, key) > 0)) : [];
    case 'nego': return negOnScene().map(o => o.id);
    default: return ids(m);
  } }
function encFireRisk(sp, pose) { const M = mindOf(sp); if (!spArmed(sp)) return 0;
  return clamp(M.harmOff * 0.35 * ({ down: 1.3, conceal: 1, cover: 1.1, behind: 0.9, pockets: 0.7, aim: 2 }[pose] || 0.5) * (sp.daze > 0 ? 0.5 : 1) * (1 + (sp.agit || 0) / 200), 0, 0.8); }
/** Hidden percentage behind each likelihood word. */
function encOdds(sp, u, key, pose) { const M = mindOf(sp), seen = encSeers(sp).length;
  let base = M.comply + ENC_CFG.crowd * Math.max(0, seen - 1) + (negOnScene().length ? ENC_CFG.negBonus : 0) + (sp.daze > 0 ? 0.12 : 0) + clamp(sp.impair || 0, 0, 1) * 0.08 - (sp.agit || 0) / 400 + (sp.talk || 0) / 400;
  if (pose === 'ignore') base *= 0.6; if (pose === 'awayUp' || pose === 'hands') base += 0.15; if (sp.injured) base += 0.1;
  const d = u ? dist(u.x, u.y, sp.x, sp.y) : 6;
  let p;
  if (ENC_OPTS[key] && ENC_OPTS[key].voice) { const n = M.cmd[key] || 0; p = base + (n === 1 ? 0.06 : n === 2 ? 0.03 : n >= 3 ? -0.07 * (n - 2) : 0) + (key === 'v_phone' && (pose === 'record' || pose === 'call') ? 0.12 : 0) + (key === 'v_hands' && ['pockets', 'behind', 'conceal'].includes(pose) ? 0.05 : 0); }
  else switch (key) {
    case 'nego': p = base + 0.15 + M.stall * 0.1; break;
    case 'hold': p = 1 - encFireRisk(sp, pose) - M.flee * 0.2; break;
    case 'shoot': p = u ? hitChance(u, sp.x, sp.y, null, {}).p : 0.4; break;
    case 'taser': p = u ? deviceChance(u, 'taser', d) : 0.5; break;
    case 'll': p = u ? deviceChance(u, 'llfire', d) * (1 - LL_CFG.noEffect) : 0.5; break;
    case 'bang': p = 0.65 - M.harmOff * 0.2; break;
    case 'gas': p = 0.5 - M.harmOff * 0.15; break;
    case 'withdraw': p = 1 - encFireRisk(sp, pose) * 0.6; break;
    default: p = base; }
  return clamp(p, 0.02, 0.97); }
function encOptionsBase(sp, u, pose, rd) { const keys = [];
  if (pose === 'heard') keys.push('v_come', 'v_hands', 'hold', 'bang', 'gas', 'nego', 'withdraw');
  else { if (rd.looks === 'gun' || rd.actual === 'weapon' && !['behind', 'pockets', 'conceal', 'cover'].includes(pose)) keys.push('v_drop');
    keys.push('v_hands', 'v_ground', 'v_come'); if (pose === 'record' || pose === 'call') keys.push('v_phone');
    keys.push('nego', 'hold', 'taser', 'll', 'bang', 'gas', 'shoot', 'withdraw'); }
  return keys.map(k => { const who = encWho(u, sp, k); if (!who.length) return null; const p = encOdds(sp, u, k, pose);
    return { key: k, label: ENC_OPTS[k].label, word: encWord(p), hint: `${encWord(p)} that ${ENC_WANT[ENC_OPTS[k].want]}`, who, team: k === 'hold' || k === 'withdraw' }; }).filter(Boolean); }
/* ---------- building the half-turn ---------- */
function encLogFrom(n) { return S.log.slice(n).map(l => l.text).filter(t => !/^— TURN/.test(t)); }
/** The suspect fired at officers inside the house with a direct line: they already returned fire (returnFire). Note it for the result box. */
function encNoteFire(T, where) { if (!encOn() || !T || T.kind !== 'team' || roomAt(T.x, T.y) < 0) return; const sp = S.suspect; sp.firedAt = S.turn;
  (S.encEv = S.encEv || []).push({ sp: spIdx(sp), team: T.name, where, from: S.log.length - 1 }); }
function encBuild() { const items = [], ev = S.encEv || []; S.encEv = [];
  // auto exchanges during the turn → one result box per suspect
  const bySp = {}; ev.forEach(e => { (bySp[e.sp] = bySp[e.sp] || []).push(e); });
  for (const k in bySp) { const e = bySp[k], from = Math.max(0, e[0].from); const sp = spAt(+k);
    items.push({ kind: 'result', sp: +k, title: 'Shots fired — officers returned fire', text: `${multiSp() && sp ? spName(sp) : 'The suspect'} fired at ${[...new Set(e.map(x => x.team))].join(', ')} from the ${e[0].where}. Officers with a direct line returned fire automatically.`, res: encLogFrom(from).slice(0, 8), done: true }); }
  suspList().forEach((sp, i) => withSp(sp, () => {
    if (!suspectActive()) return; const M = mindOf(sp);
    if (M.delay > 0 && hostile()) { M.delay = 0; const n = S.log.length; surrender(`${spName()}: "Okay — okay, I'm coming out. Don't shoot." — he puts everything down and complies.`); 
      items.push({ kind: 'result', sp: i, title: 'He gives up', text: 'After stalling, he complies.', res: encLogFrom(n), done: true }); return; }
    if (!hostile() || sp.stun > 0 || sp.mode === 'fleeing') return;
    if (M.contactTurn === S.turn) return; // v17: already had its popup this turn (first contact pauses mid-turn)
    const seers = encSeers(sp); let u = seers[0], pose;
    if (!u) { const near = S.units.filter(q => q.kind === 'team' && unitAlive(q) && q.deployed && teamOk(q).length && roomAt(q.x, q.y) >= 0 && cheb(q.x, q.y, sp.x, sp.y) <= ENC_CFG.heardDist && !los(q.x, q.y, sp.x, sp.y))
        .sort((a, b) => dist(a.x, a.y, sp.x, sp.y) - dist(b.x, b.y, sp.x, sp.y));
      if (!near.length || !S.rng.chance(ENC_CFG.heard)) return; u = near[0]; pose = 'heard'; }
    else { pose = encPose(sp, u); M.contactTurn = S.turn; }
    M.pose = pose; M.poseTurn = S.turn; M.seen++; const rd = encRead(sp, u, pose); M.read = rd;
    const text = encDescribe(sp, u, pose, rd);
    if (pose === 'aim') { const n = S.log.length; encExchange(sp, u, 'aim');
      items.push({ kind: 'result', sp: i, uid: u.uid, pose, title: 'Armed and aiming — officers engage', text, res: encLogFrom(n), done: true }); return; }
    items.push({ kind: 'contact', sp: i, uid: u.uid, pose, read: { conf: rd.conf, looks: rd.looks }, title: pose === 'heard' ? 'Movement heard' : `Visual contact — ${u.name}`, text, options: encOptions(sp, u, pose, rd) });
  }));
  return items; }
/** v17: FIRST visual contact this turn → pause right at that moment (mid-turn), before the officers' automatic
    responses (challenge, less-lethal, hands-on arrest) or his reaction can resolve it unseen. One popup per suspect per
    turn; nothing when nobody has a line on a live, hostile suspect. Called by stepTick after movement + vision. */
function encContactCheck() { if (!encOn() || S.phase !== 'executing') return false; const items = [];
  suspList().forEach((sp, i) => withSp(sp, () => {
    if (!suspectActive() || !hostile() || sp.stun > 0 || sp.mode === 'fleeing') return; const M = mindOf(sp); if (M.contactTurn === S.turn) return;
    const u = encSeers(sp)[0]; if (!u) return;
    const pose = encPose(sp, u); M.pose = pose; M.poseTurn = S.turn; M.contactTurn = S.turn; M.seen++; const rd = encRead(sp, u, pose); M.read = rd;
    const text = encDescribe(sp, u, pose, rd), why = encWhy(u);
    if (pose === 'aim') { const n = S.log.length; encExchange(sp, u, 'aim');
      items.push({ kind: 'result', sp: i, uid: u.uid, pose, mid: true, title: 'Armed and aiming — officers engage', text, res: encLogFrom(n), done: true }); return; }
    items.push({ kind: 'contact', sp: i, uid: u.uid, pose, mid: true, why, read: { conf: rd.conf, looks: rd.looks }, title: `Visual contact — ${u.name}${why ? ' (' + why + ')' : ''}`, text, options: encOptions(sp, u, pose, rd) });
  }));
  if (!items.length) return false; log(`— Contact: turn paused at the moment of sight (tick ${S.tick}/${TICKS}). —`, 'system'); return encPause(items, false); }
/** What the seeing team was doing when contact happened (shown in the popup title). */
function encWhy(u) { const o = u.orders && u.orders[0]; if (!o) return ''; return { clear: 'entering and clearing', corner: 'working the corner', breach: 'at the breach', move: 'moving', polecam: 'at the door' }[o.type] || ''; }
function encPause(items, atEnd) { if (!items.length) return false; if (S.enc && S.enc.items) { S.enc.items.push(...items); return true; }
  S.enc = { items, i: 0, atEnd: !!atEnd, turn: S.turn }; S.phase = 'encounter'; S.version++; return true; }
/** Called by stepTick on the last tick: true = paused for the half-turn. */
function encEndTurn() { if (!encOn()) return false; return encPause(encBuild(), true); }
function encCur() { return S.enc && S.enc.items[S.enc.i] || null; }
/* ---------- first-fire exchange ---------- */
function devCut() { const D = S.devTurn && S.devTurn.turn === S.turn ? S.devTurn : {}; let c = 0; for (const k of ['bang', 'gas', 'charge']) if (D[k]) c += ENC_CFG.cut[k]; return c; }
function encFirstP() { return clamp(ENC_CFG.firstFire - devCut(), ENC_CFG.firstMin, ENC_CFG.firstFire); }
function encMarkDev(o) { if (!o) return; const k = o.type === 'bang' ? 'bang' : o.type === 'gas' ? 'gas' : (o.type === 'breach' || o.type === 'detonate') && (o.method === 'charge' || o.type === 'detonate') ? 'charge' : null;
  if (!k) return; if (!S.devTurn || S.devTurn.turn !== S.turn) S.devTurn = { turn: S.turn }; S.devTurn[k] = true; }
function encShotFor(u, sp) { const d = dist(sp.x, sp.y, u.x, u.y); return { u, px: sp.x, py: sp.y, d, l: los(sp.x, sp.y, u.x, u.y) || 1, cls: targetClass(u, sp.x, sp.y), indoor: roomAt(u.x, u.y) >= 0 }; }
/** Armed suspect and officers exchange fire. 75% he gets the first rounds off (less after a bang / gas / charge this turn). */
function encExchange(sp, u, why) { return withSp(sp, () => { if (!hostile()) return null;
  const susFirst = S.rng.chance(encFirstP()); sp.firedAt = S.turn; sp.encAim = S.turn;
  log(susFirst ? `${spName()} gets the first rounds off at ${u.name}.` : `${u.name} fires first.`, 'alert');
  if (susFirst) { suspectFire(encShotFor(u, sp)); } // suspectFire ends with the automatic return fire (nearest 3 with a line)
  else { returnFire(); if (hostile() && sp.stun <= 0 && sp.mode !== 'incapacitated') { S.encNoRet = true; try { suspectFire(encShotFor(u, sp)); } finally { S.encNoRet = false; } } }
  return susFirst ? 'suspect' : 'officers'; }); }
/* ---------- resolving a choice ---------- */
function encJustified(sp, item) { const M = mindOf(sp), rd = M.read || {};
  if (sp.firedAt === S.turn || item.pose === 'aim') return true; // he fired / is aiming: always justified
  if (item.pose === 'awayUp' || item.pose === 'hands') return false; // compliant / visibly empty hands
  return rd.actual === 'weapon'; }
function encReview(o, sp) { const removed = S.rng.chance(ENC_CFG.removeP);
  (S.reviews = S.reviews || []).push({ id: o.id, name: o.name, careerId: o.careerId || null, missions: ENC_CFG.reviewMissions, removed, turn: S.turn });
  log(`Use-of-force review opened: ${o.name} fired on a ${spArmed(sp) && (mindOf(sp).read || {}).actual === 'weapon' ? 'compliant' : 'unarmed'} subject. Officer out for ${ENC_CFG.reviewMissions} missions pending investigation.`, 'bad'); }
function encRetreat(sp, u) { let best = null;
  for (let k = 0; k < 2; k++) { best = null; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = sp.x + dx, y = sp.y + dy; if (roomAt(x, y) < 0 || S.block[idx(x, y)] || !seeE(sp.x, sp.y, x, y)) continue;
      const e = edge(sp.x, sp.y, x, y); if (e.t === 'D' && e.d.state !== 'open') continue; const s = dist(x, y, u.x, u.y) + (los(u.x, u.y, x, y) ? 0 : 3);
      if (!best || s > best.s) best = { x, y, s }; }
    if (!best || best.s <= dist(sp.x, sp.y, u.x, u.y)) break; sp.x = best.x; sp.y = best.y; sp.room = roomAt(sp.x, sp.y); }
  sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn }; }
/** Suspect response to a non-force option (decision tree with hidden %). */
function encRespondBase(sp, u, key, item) { const M = mindOf(sp), pose = item.pose, armed = spArmed(sp);
  const pc = key === 'hold' ? M.comply * 0.12 + M.stall * 0.08 : encOdds(sp, u, key, pose);
  const fire = armed && u ? encFireRisk(sp, pose) * (1 - pc) * (key === 'hold' ? 0.5 : 0.8) : 0, hostage = hostageAvail(sp) ? 0.1 * (1 - pc) : 0;
  const delay = M.stall * (1 - pc) * 0.45, retreat = M.flee * (1 - pc) * 0.35, x = S.rng();
  const nm = multiSp() ? spName() : 'He';
  if (x < pc) { if (key === 'v_phone') { M.pose = 'hands'; M.comply = clamp(M.comply + 0.1, 0, 1); log(`${nm} puts the phone down.`, 'good'); return 'comply'; }
    if (key === 'hold') { surrender(`${nm} gives up on his own — he kneels and puts his hands up.`); return 'comply'; }
    surrender(`${u ? u.name + ': ' : ''}${ENC_OPTS[key].label.replace(/^Voice: /, '')} — ${nm.toLowerCase() === 'he' ? 'he' : nm} complies${armed ? ', weapon on the floor' : ''}, hands up, getting on the ground.`); return 'comply'; }
  let y = x - pc;
  if (y < fire && u) { log(`${nm} raises the weapon.`, 'alert'); encExchange(sp, u, 'raise'); return 'fire'; } y -= fire;
  if (y < hostage) { log(`${nm} grabs the person next to him.`, 'alert'); return 'hostage'; } y -= hostage;
  if (y < delay) { M.delay = 1; log(`${nm}: "Give me a minute — I'm coming, I'm coming." He is stalling.`, 'radio'); return 'delay'; } y -= delay;
  if (y < retreat && u) { encRetreat(sp, u); log(`${nm} backs away deeper into the ${roomWord(sp)}.`, 'alert'); return 'retreat'; }
  M.ignored++; aggressive(2); log(`${nm} ignores the ${key === 'hold' ? 'officers' : 'command'}.`, 'radio'); return 'ignore'; }
function encChooseBase(key, offId) { const it = encCur(); if (!it || it.done || S.phase !== 'encounter') return { ok: false, reason: 'No decision pending' };
  if (it.kind === 'blind') return blindChoose(key);
  const opt = (it.options || []).find(o => o.key === key); if (!opt) return { ok: false, reason: 'Option not available' };
  const sp = spAt(it.sp), u = unit(it.uid); if (!sp || !u) return { ok: false, reason: 'Contact lost' };
  const oid = offId || opt.who[0]; if (!opt.who.includes(oid)) return { ok: false, reason: 'That officer cannot do it' };
  const o = off(oid) || S.officers.find(q => q.id === oid), nm = o ? o.name : u.name, n0 = S.log.length;
  withSp(sp, () => { const M = mindOf(sp);
    if (!hostile()) { log('He is no longer a threat.', 'good'); return; }
    if (ENC_OPTS[key].voice) { M.cmd[key] = (M.cmd[key] || 0) + 1; S.stats.challenged = true; log(`${nm}: ${ENC_OPTS[key].label.replace(/^Voice: /, '')}`, 'radio'); encRespond(sp, u, key, it); return; }
    switch (key) {
      case 'nego': sp.talk = clamp((sp.talk || 0) + 30, 0, 100); log(`${nm} (negotiator) talks to him from cover.`, 'radio'); encRespond(sp, u, 'nego', it); return;
      case 'hold': log(`${u.name} holds and observes.`, 'radio'); encRespond(sp, u, 'hold', it); return;
      case 'withdraw': { log(`${u.name} backs out of the line of sight.`, 'radio'); const risk = encFireRisk(sp, it.pose) * 0.6; if (S.rng.chance(risk)) encExchange(sp, u, 'withdraw');
        encWithdraw(u, sp); return; }
      case 'shoot': { const just = encJustified(sp, it); if (!just && o) encReview(o, sp); const r = fireAt(u, sp.x, sp.y, 'fire');
        if (r === 'miss') log(`${nm}: shot missed.`, 'radio');
        if (hostile() && spArmed(sp) && sp.stun <= 0 && S.rng.chance(mindOf(sp).harmOff + 0.2)) { S.encNoRet = false; suspectFire(encShotFor(u, sp)); }
        return; }
      case 'taser': case 'll': { const type = key === 'taser' ? 'taser' : 'llfire', c = devCfg(type), k = key === 'taser' ? 'taser' : 'lesslethal', p = deviceChance(u, type, dist(u.x, u.y, sp.x, sp.y));
        const tr = o ? deviceTransition(u, o, k, c.hands, q => { if (type === 'llfire') llSpend(q); fx(key === 'taser' ? 'taser' : 'll', sp.x, sp.y, { fromX: u.x, fromY: u.y }); return S.rng.chance(p) && (type === 'taser' || !S.rng.chance(c.noEffect)); }) : null;
        if (!tr) { log(`${nm}: could not free the hands for it.`, 'alert'); return; }
        if (tr.r) { sp.stun = Math.max(sp.stun || 0, (type === 'taser' ? c.stunTurns : c.stunTurns[1]) * TICKS); sp.stunBy = type === 'taser' ? 'taser' : 'll'; sp.ambush = false; sp.walk = null;
          log(`${nm}: ${key === 'taser' ? 'TASER — probes connected' : 'less-lethal round on target'} — suspect incapacitated. Move in for the arrest.`, 'good'); xpAct('bang', u); }
        else { log(`${nm}: ${key === 'taser' ? 'taser' : 'less-lethal round'} — no effect.`, 'alert'); aggressive(8); if (spArmed(sp) && S.rng.chance(encFireRisk(sp, it.pose))) encExchange(sp, u, 'device'); }
        return; }
      case 'bang': case 'gas': { const used = useItem(u, key, q => q.id === oid) || useItem(u, key); if (!used) { log(`${nm}: none left.`, 'alert'); return; }
        encMarkDev({ type: key });
        if (key === 'bang') { fx('flash', sp.x, sp.y, { fromX: u.x, fromY: u.y }); noise(sp.x, sp.y, 10, 'bang'); log(`${nm}: BANG OUT.`, 'radio');
          if (S.rng.chance(encOdds(sp, u, 'bang', it.pose))) { sp.stun = 5; sp.daze = FIRE_CFG.bangDaze; sp.ambush = false; log('Suspect disoriented by flashbang.', 'good'); } else log('He turned away from the flash — little effect.', 'alert'); aggressive(10); }
        else { if (sp.room >= 0) gasDeploy(sp.room); fx('gas', sp.x, sp.y, { room: sp.room, fromX: u.x, fromY: u.y }); log(`${nm}: CS gas deployed.`, 'radio'); sp.impair = Math.max(sp.impair || 0, 0.5); aggressive(12);
          if (S.rng.chance(mindOf(sp).flee * 0.6)) { encRetreat(sp, u); log('He moves away from the gas.', 'alert'); } }
        return; }
    } });
  it.done = true; it.chose = key; it.by = oid; it.res = encLogFrom(n0); S.version++; return { ok: true, res: it.res }; }
/** Back out: a move order to the nearest cell he cannot see (runs next turn). */
function encWithdraw(u, sp) { const p = findPath(u.x, u.y, (a, b) => dist(a, b, u.x, u.y) <= 8 && !los(sp.x, sp.y, a, b), {});
  u.orders = []; u.regroup = null; const end = p && p.length ? p[p.length - 1] : null;
  if (end) u.orders.push({ type: 'move', x: end[0], y: end[1], fromEnc: true }); return end; }
/* ---------- blind fire at the threshold ---------- */
function encThreshold(u, o) { if (!encOn() || S.phase !== 'executing' || !u || u.kind !== 'team') return null; const r = afterRoom(u, o); if (r < 0) return null;
  const sp = suspList().find(s => spHostile(s) && s.room === r && spArmed(s)); if (!sp) return null;
  return withSp(sp, () => { const M = mindOf(sp); const p = ENC_CFG.blind * (0.5 + M.harmOff) * (sp.stun > 0 ? 0.3 : 1) * (o.type === 'gas' ? 0.8 : 1); if (!S.rng.chance(p)) return null;
    const n0 = S.log.length, where = S.rooms[r] && S.rooms[r].known ? S.rooms[r].name : 'room'; sp.firedAt = S.turn; S.stats.shots++; sp.mode = 'alert'; sp.cd = 2;
    fx('muzzle', sp.x, sp.y, { suspect: true }); fx('shot', sp.x, sp.y, { tx: u.x, ty: u.y });
    log(`SHOTS THROUGH THE DOORWAY — ${multiSp() ? spName().toLowerCase() : 'the suspect'} is firing blindly at the threshold of the ${where}.`, 'alert');
    if (S.rng.chance(ENC_CFG.blindHit)) shotOfficer(u, SUSPECT_CAL[sp.weapon] || 'pistol', 2, sp.x, sp.y, where); else log('No hits — rounds strike the door frame.', 'alert');
    return encPause([{ kind: 'blind', sp: spIdx(sp), uid: u.uid, room: r, title: 'Shots at the threshold', text: `${u.name} is at the ${where} doorway. Blind fire from inside — he is not visible. What does the team do?`, res0: encLogFrom(n0),
      options: BLIND_OPTS.map(b => ({ key: b.key, label: b.label, hint: b.sub, who: [] })) }], false); }); }
function blindChoose0(key) { const it = encCur(), u = unit(it.uid), sp = spAt(it.sp); if (!BLIND_OPTS.some(b => b.key === key)) return { ok: false, reason: 'Unknown choice' };
  const n0 = S.log.length, r = it.room, enter = q => q.fromAfter || ((q.type === 'clear' || q.type === 'move') && (q.room === r || roomAt(q.x, q.y) === r));
  if (u && unitAlive(u)) {
    if (key === 'cancel') { u.orders = u.orders.filter(q => !enter(q)); u.orders.unshift({ type: 'hold', fromEnc: true }); u.regroup = null; log(`${u.name}: entry cancelled — holding outside the room.`, 'radio'); }
    else if (key === 'continue') { log(`${u.name}: continuing in — return fire through the doorway.`, 'radio'); encDoorFire(u, sp, 3); }
    else if (key === 'doorway') { u.orders = u.orders.filter(q => !enter(q)); u.orders.unshift(...afterOrders(u, 'assess', r)); u.regroup = null; log(`${u.name}: working the doorway from outside.`, 'radio'); }
    else { u.orders = u.orders.filter(q => !enter(q)); u.orders.unshift({ type: 'hold', fromEnc: true }); u.regroup = null; log(`${u.name}: point and defense engage from the door frame.`, 'radio'); encDoorFire(u, sp, 2); } }
  it.done = true; it.chose = key; it.res = encLogFrom(n0); S.version++; return { ok: true, res: it.res }; }
function encDoorFire(u, sp, n, win) { if (!sp) return; withSp(sp, () => { if (!hostile()) return; const vis = los(u.x, u.y, sp.x, sp.y);
  for (let k = 0; k < n && hostile(); k++) { const r = fireAt(u, sp.x, sp.y, vis ? 'fire' : 'suppress', true); if (r === 'hit') break; }
  if (hostile()) { sp.suppressed = Math.max(sp.suppressed || 0, 2); log(vis ? 'He is pinned down.' : (win ? 'Rounds through the window' : 'Rounds through the doorway') + ' — he stops firing for now.', 'radio'); } }); }
/** Close the current box and move on. Returns the phase after: 'encounter' (more) | 'executing' (mid-turn) | 'planning' | 'over'. */
/** The mission ended mid-turn (e.g. the exchange of fire decided it): still show the result box(es) before the debrief. */
function encFinal() { if (!encOn() || S.phase !== 'over' || !(S.encEv || []).length) return false; const items = encBuild().filter(i => i.kind === 'result'); S.encEv = [];
  if (!items.length) return false; S.enc = { items, i: 0, atEnd: true, final: true, turn: S.turn }; S.version++; return true; }
function encNext() { if (!S.enc) return S.phase; const it = encCur(); if (it && !it.done) return 'encounter';
  if (S.enc.final) { S.enc.i++; if (S.enc.i < S.enc.items.length) return 'encounter'; S.enc = null; S.version++; return 'over'; }
  S.enc.i++; if (S.enc.i < S.enc.items.length) { S.version++; return 'encounter'; }
  const atEnd = S.enc.atEnd; S.enc = null; S.phase = 'executing'; updateVision(); checkEnd(); if (S.phase === 'over') return 'over';
  if (atEnd) endTurn(); else if (S.tick >= TICKS && !S.encMid) { if (!encEndTurn()) endTurn(); }
  S.version++; return S.phase; }
/** Debrief lines for encounters / reviews. */
function encDebrief() { const out = []; (S.reviews || []).forEach(r => out.push({ k: 'Use-of-force review', v: `${r.name} — out for ${r.missions} missions pending investigation. Review outcome: ${r.removed ? 'removed from the team' : 'returns to duty after the review'}.` }));
  suspList().forEach(sp => { if (sp.mind) out.push({ k: multiSp() ? spName(sp) + ' — read' : 'Suspect — read', v: `${ENC_TRAITS[sp.mind.trait].label}; seen ${sp.mind.seen}×, ignored ${sp.mind.ignored} command(s).` }); });
  return out; }
/** Scoring rules on top of missionScore (encounter games). */
function encScore(items, add) { const pos = () => items.reduce((a, i) => a + (i.pts > 0 ? i.pts : 0), 0), L = suspList(), R = S.result || {};
  const dead = L.some(s => s.deceased), hurt = L.some(s => s.injured && !s.deceased);
  if (R.win && !dead && !hurt) add('Suspect in custody unharmed', ENC_CFG.unhurt);
  if (dead) { const i = items.findIndex(x => /did not survive/.test(x.label)); if (i >= 0) items.splice(i, 1); add('Suspect killed — 33% of mission points', -Math.round(pos() * (1 - ENC_CFG.killedKeep))); }
  else if (hurt) add('Suspect injured — 80% of mission points', -Math.round(pos() * (1 - ENC_CFG.minorKeep)));
  if ((S.reviews || []).length) { const net = items.reduce((a, i) => a + i.pts, 0); add('Unjustified shot — 95% reduction of mission points', -Math.round(Math.max(0, net) * (1 - ENC_CFG.unjustKeep))); } }
