
/* =====================================================================
   v12 CALL TYPES — parole absconder and eviction / civil-papers standoff.
   Rules only (no DOM). Neutral wording. Each uses its own seed streams so
   the map and the base scenario stay identical for a given seed.
   ===================================================================== */
/* ================== TUNABLE ================== */
const PAROLE_CFG = {
  armed: 0.55,                                   // chance he has a firearm at all (otherwise none)
  weapons: { handgun: 0.7, shotgun: 0.18, rifle: 0.12 },
  hideP: 0.6, hideKinds: { attic: 0.5, basement: 0.5 }, // chance he is in an attic/basement hide instead of a barricaded room
  findDist: 1,                                   // officers/robot/K9 must be this close (cells) to spot him in the hide
  foundGiveUp: 0.45,                             // chance he gives up on the spot when found in the hide
};
const SOVCIT_CFG = { boost: 0.25, cap: 0.95, doorBase: 0.10, maskBase: 0.05, rifleBase: 0.25, postsP: 0.5 };
/* ============================================= */
const capP = (p) => Math.min(SOVCIT_CFG.cap, p);
/** After the suspects exist: weapons/armor/masks/doors per type, and the parole hide. */
function applyTypeExtras() {
  const st = S.stype; if (!st) return; const sp = S.suspect;
  if (st.key === 'parole') { const r = makeRng(S.seed * 6229 + 41);
    sp.weapon = r.chance(PAROLE_CFG.armed) ? wpick(r, PAROLE_CFG.weapons) : 'none';
    if (sp.weapon === 'none' && S.scene && S.scene.injury) sp.weapon = 'handgun'; // an officer was hit: he is armed
    if (r.chance(PAROLE_CFG.hideP)) setupHide(r, wpick(r, PAROLE_CFG.hideKinds)); }
  if (st.key === 'sovcit') { const r = makeRng(S.seed * 7451 + 23), C = SOVCIT_CFG;
    // rifle: base share + boost (capped); keeps the stream deterministic
    if (sp.weapon !== 'rifle' && r.chance((capP(C.rifleBase + C.boost) - C.rifleBase) / (1 - C.rifleBase))) sp.weapon = 'rifle';
    if (!(S.opts && S.opts.suspectArmor !== undefined)) { sp.armor = r.chance(capP(ARMOR_CFG.suspect + C.boost)) ? (r.chance(ARMOR_CFG.suspectPlate) ? 'plate' : 'soft') : 'none'; sp.armorKnown = false; }
    sp.hasMask = r.chance(capP(C.maskBase + C.boost));
    S.doors.forEach(d => { if (d.exterior && d.kind !== 'garage' && r.chance(capP(C.doorBase + C.boost))) { d.barricaded = true; d.locked = true; d.fortified = true; } });
    S.intel.posts = r.chance(C.postsP); }
}
/** Parole absconder hide: an attic hatch or basement door in a room; he waits there out of sight. */
function setupHide(r, kind) {
  const sp = S.suspect, pref = kind === 'attic' ? { hall: 3, bed: 2, office: 1 } : { kitchen: 3, hall: 2, living: 1, office: 1 };
  const cands = S.rooms.filter(q => q.type !== 'garage'), wt = cands.map(q => pref[q.type] || 0.4); let tot = wt.reduce((a, b) => a + b, 0), p = r() * tot, rm = cands[0];
  for (let i = 0; i < cands.length; i++) { p -= wt[i]; if (p <= 0) { rm = cands[i]; break; } }
  const ext = S.doors.filter(d => d.exterior).map(d => d.cells[0][0]); let best = null, bs = -1;
  for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) { if (S.block[idx(x, y)] || roomAt(x, y) !== rm.id) continue;
    const s = Math.min(...ext.map(c => dist(c[0], c[1], x, y)), 99) + r() * 0.5; if (s > bs) { bs = s; best = [x, y]; } }
  if (!best) return;
  S.doors.forEach(d => { if (d.rooms.includes(sp.room) && !d.exterior) { d.barricaded = false; d.locked = false; } }); // he left his room for the hide
  sp.x = best[0]; sp.y = best[1]; sp.home = { x: best[0], y: best[1] }; sp.room = rm.id; sp.hidden = true;
  S.hide = { kind, x: best[0], y: best[1], room: rm.id, name: kind === 'attic' ? 'Attic hatch' : 'Basement door', found: false };
}
/** Is this suspect concealed in the hide from every unit right now? */
function hiddenNow(sp) {
  if (!sp.hidden || !S.hide) return false;
  if (sp.x !== S.hide.x || sp.y !== S.hide.y || sp.mode !== 'barricaded') { sp.hidden = false; return false; }
  const near = S.units.find(u => unitAlive(u) && (onFoot(u) || u.kind === 'robot') && cheb(u.x, u.y, sp.x, sp.y) <= PAROLE_CFG.findDist && roomAt(u.x, u.y) === sp.room);
  if (!near) return true;
  sp.hidden = false; S.hide.found = true; log(`${near.name}: found him — hiding in the ${S.hide.kind === 'attic' ? 'attic above the' : 'basement under the'} ${S.rooms[sp.room].name}!`, 'alert');
  if (S.rng.chance(PAROLE_CFG.foundGiveUp)) { sp.agit = clamp(sp.agit - 30, 0, 100); sp.talk = clamp((sp.talk || 0) + 60, 0, 100); }
  return false;
}
/** Negotiation flavor per call type: returns a replacement line or the default. */
const NEGO_FLAVOR = {
  sovcit: { rapport: 'letting him lay out his legal theory — staying patient, not arguing the paperwork.', listen: 'letting him read his "notice" to the court again. He lists every agency he says has no authority over him.',
    concession: ['agreed to read the court order aloud over the PA so he can "note his objection".', 'offered to take his written statement to a supervisor.', 'let a family member speak with him on the line.'],
    status: w => `status check — he says he is "a private man on private property" with a ${w}`, ultimatum: 'Negotiator: ultimatum rejected — he says nobody here has jurisdiction over him.', ready: 'Negotiator: he says he will walk out "under protest, without consent".' },
  parole: { rapport: 'talking about his kids and what happens at a violation hearing.', listen: 'letting him vent about his parole officer and the conditions.',
    concession: ['agreed to have his parole agent call him back.', 'got him water and cigarettes sent in on the robot line.', 'let him speak to his mother on the line.'],
    status: w => w === 'no firearm' ? 'status check — he says he has no gun and just does not want to go back' : `status check — he says he has a ${w} and is not going back`, ultimatum: 'Negotiator: ultimatum rejected — he says he is not going back inside.', ready: 'Negotiator: he says he is done hiding — coming out.' },
};
function flavor(k, def, arg) { const F = NEGO_FLAVOR[(S.stype || {}).key]; if (!F || F[k] == null) return def; const v = F[k]; if (typeof v === 'function') return v(arg); if (Array.isArray(v)) return v[arg] || def; return v; }
/** Brief and 911 rewrite for the v12 types (separate stream; base brief generation is unchanged). */
function typeBrief(B) {
  const st = S.stype, ST = st.key; if (ST !== 'parole' && ST !== 'sovcit') return; const r = makeRng(S.seed * 9157 + 3), sp = S.suspect, first = B.name.split(' ')[0];
  const L = [], t0 = B.callAt, add = (who, text) => L.push({ t: t0, who, text });
  B.legal = st.legal; B.typeDesc = SCEN_TYPES[ST].desc; B.self = false; B.phone = null; B.giveNum = false;
  if (ST === 'parole') { const v = st.variant; B.type = 'parole violation warrant';
    if (v === 'caller') { B.caller = r.pick(['Neighbor', 'Landlord', 'Former roommate']) + ' (anonymous)';
      add('Dispatcher', '911, what is the address of your emergency?'); add('Caller', `The guy on the news — ${B.name}, the one who skipped parole — he's inside ${B.addr} right now. I saw him go in the back an hour ago.`);
      add('Dispatcher', 'Is he armed?'); add('Caller', r.chance(0.5) ? "I don't know. He used to carry." : "I didn't see a gun."); add('Dispatcher', 'Is anyone else inside?'); add('Caller', "I don't think so. The family moved out.");
      add('Dispatcher', 'Officers are on the way. Stay away from the house.'); }
    else { B.caller = 'No 911 call — patrol request';
      add('Patrol', `Dispatch, unit at ${B.addr} for the parole pickup on ${B.name}.`);
      add('Patrol', v === 'seen' ? 'We just saw him go in the side door when we pulled up. He is not answering.' : 'Movement at a window — it is him, he ducked back out of sight. Not answering the door.');
      add('Dispatcher', 'Copy. Is he known to carry?'); add('Patrol', 'Unknown. History of hiding from the warrant squad — attic and basement both.'); }
    B.occupants = 'Believed alone. Family moved out. Not confirmed.';
    B.known = [LEGAL_TXT.parole, `Absconded from parole supervision ${r.int(3, 11)} weeks ago; photo and history on file.`, sp.weapon === 'none' ? 'No firearm on record — armed status unknown.' : 'Firearm possible — prior weapons arrest.',
      'He has hidden from officers before (attic / basement). Clear every space; a robot or K9 helps.'];
    B.patrol.splice(B.patrol.length - 1, 0, v === 'seen' ? 'Patrol saw him enter the house when they arrived.' : v === 'window' ? 'Patrol saw him at a window; he ducked out of sight.' : 'A caller reported he is inside; patrol saw movement but no clear view.');
    B.sawGun = false; B.shots = !!B.officerDown; }
  if (ST === 'sovcit') { const v = st.variant; B.type = v === 'papers' ? 'civil papers service' : 'eviction enforcement'; B.caller = 'No 911 call — civil process unit';
    add('Deputy', `Dispatch, civil unit at ${B.addr}. ${v === 'papers' ? 'Serving papers' : 'Enforcing the writ of possession'} on ${B.name}.`);
    add('Deputy', `He says he is a "sovereign" and does not recognize the court. He told us to leave his property${r.chance(0.5) ? ' and said he is armed' : ''}.`);
    add('Dispatcher', 'Copy. Weapons seen?'); { const lg = ['rifle', 'shotgun'].includes(sp.weapon) && r.chance(0.5), fd = S.doors.some(d => d.fortified); add('Deputy', lg ? 'A long gun leaning by the door when he cracked it open.' : fd ? 'Nothing seen. He has a door brace and boards on the inside.' : 'Nothing seen. He says he has the right to defend his property.'); if (lg) B.sawGun = true; }
    add('Deputy', 'He shut the door. We are backing out and requesting SWAT.');
    B.occupants = 'Believed alone. Not confirmed.';
    B.known = [LEGAL_TXT.eviction, v === 'papers' ? 'Civil papers refused; he filed "sovereign" notices with the county.' : 'Eviction ordered after months of non-payment; he filed "sovereign" notices with the county.',
      'Higher odds of long guns, body armor, gas masks and reinforced doors on this type of call.'];
    if (S.intel.posts) B.known.push('Online posts: talks about "defending the property" and shows a rifle and a vest.');
    B.sawGun = !!L.find(e => /long gun/.test(e.text)); B.shots = !!B.officerDown;
    if (S.doors.some(d => d.fortified)) B.patrol.splice(B.patrol.length - 1, 0, 'Deputies report the doors are braced from inside.'); }
  if (!B.shots) { B.patrol = B.patrol.filter(t => !/heard (one shot|shots) from inside/.test(t)); for (const k of Object.keys(B)) if (Array.isArray(B[k]) && k !== 'transcript') B[k] = B[k].filter(t => typeof t !== 'string' || !/a loud bang/.test(t)); }
  if (!(ST === 'parole' && st.variant === 'caller')) B.channel = 'radio';
  B.transcript = L;
}
function typeExtraDebrief(out) { const st = S.stype; if (!st) return;
  if (st.key === 'parole') out.push({ k: '  Warrant', v: S.result && S.result.win ? 'Parole-violation warrant served.' : 'Warrant not served.' }, { k: '  Hide', v: S.hide ? `${S.hide.name} in the ${S.rooms[S.hide.room].name}${S.hide.found ? ' — found.' : ' — not found.'}` : 'He stayed in a room; no hide used.' });
  if (st.key === 'sovcit') { const sp = S.suspect; out.push({ k: '  Court order', v: S.result && S.result.win ? 'Order enforced; subject removed in custody.' : 'Order not enforced.' },
    { k: '  Gear', v: `${SUSPECT_WEAPONS[sp.weapon].name}${sp.armor && sp.armor !== 'none' ? ', ' + sp.armor + ' armor' : ''}${sp.hasMask ? ', gas mask' : ''}; ${S.doors.filter(d => d.fortified).length} reinforced door(s).` }); } }
