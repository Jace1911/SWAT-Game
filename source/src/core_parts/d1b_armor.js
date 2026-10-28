/* =====================================================================
   ARMOR & BALLISTIC SHIELDS (v9) — one data table, easy to retune.
   Every officer (patrol + SWAT) wears soft Level IIIA torso armor. Upgraded SWAT draw rifle
   plates (plate carrier) at the equipment vehicle. A hit first rolls the zone: torso (armored)
   vs uncovered areas (arms, legs, head). Armor that stops a round can still leave a SMALL
   blunt-impact injury at very close range — mostly from shotguns.
   ===================================================================== */
const ARMOR = {
  none:  { name: 'No armor',               short: '—',        stops: { pistol: 0, shotgun: 0, rifle: 0, sniper: 0 } },
  soft:  { name: 'Level IIIA soft armor',  short: 'IIIA',     stops: { pistol: 1, shotgun: 1, rifle: 0, sniper: 0 } },
  plate: { name: 'IIIA + rifle plates',    short: 'IIIA+PL',  stops: { pistol: 1, shotgun: 1, rifle: 0.88, sniper: 0.6 } },
};
const ARMOR_CFG = {
  torso: 0.6,             // share of hits on an officer that land on the armored torso (rest: arms / legs / head)
  bluntRange: 3,          // cells: inside this a stopped round can still cause a small blunt-impact injury
  blunt: { pistol: 0.18, shotgun: 0.5, rifle: 0.3, sniper: 0.35 }, // chance at point blank (fades to 0 at bluntRange)
  suspect: 0.07,          // chance the suspect wears body armor
  suspectPlate: 0.15,     // …and of those, chance it has rifle plates (otherwise soft IIIA)
  suspectTorso: 0.6,      // share of officer hits on him that strike the torso
  suspectTorsoWindow: 0.45, // in a window he shows mostly head and shoulders — the uncovered share goes up
};
/* Ballistic shields: one hand, never slung (ITEM_CFG). Frontal arc only, partial coverage. */
const SHIELDS = {
  shield:  { name: 'Level IIIA ballistic shield', short: 'IIIA shield', stops: { pistol: 1, shotgun: 1, rifle: 0, sniper: 0 } },
  shield3: { name: 'Level III ballistic shield',  short: 'III shield',  stops: { pistol: 1, shotgun: 1, rifle: 0.6, sniper: 0.35 } },
};
const SHIELD_CFG = { arc: 1.2 /* rad half-angle of the frontal arc */, cover: 0.7 /* body share behind it (feet/limbs stick out) */, stack: 0.35 /* stacked teammates behind the point shield */ };
/** Suspect weapon → ballistic class. */
const SUSPECT_CAL = { handgun: 'pistol', shotgun: 'shotgun', rifle: 'rifle' };
function armorOf(o) { if (!o) return 'soft'; if (o.inv) return (o.inv.worn && o.inv.worn.armor) || 'soft'; return o.armor || 'soft'; }
function shieldOf(o) { if (!o || !o.inv) return null; return holds(o, 'shield3') ? 'shield3' : holds(o, 'shield') ? 'shield' : null; }
function teamShield(t) { return t && t.kind === 'team' && teamOk(t).some(o => shieldOf(o)); }
const angDiff = (a, b) => { let d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
/** Pick the officer of a team who takes a hit (the point most often when the threat is to the front). */
/** Door stack exposure: a team stacked at a doorway, fired on from the far side of that door, can only be hit in the doorway pair
    (POINT and DEFENSE at the frame) — the rest are on the wall beside the opening, out of the line of fire. */
function doorExposed(t, fx_, fy) { if (!t || t.kind !== 'team' || fx_ === undefined) return null; const ok = teamOk(t); if (ok.length < 2) return null;
  const f = formationFor(t); if (f.kind !== 'stack') return null; if (roomAt(Math.round(fx_), Math.round(fy)) === roomAt(t.x, t.y)) return null;
  return ok.slice(0, 2); }
function pickVictim(t, fx_, fy) { const ok = teamOk(t); if (!ok.length) return null;
  const ex = doorExposed(t, fx_, fy); if (ex) return S.rng.chance(0.6) ? ex[0] : ex[1];
  const front = fx_ === undefined || t.dir === undefined || angDiff(Math.atan2(fy - t.y, fx_ - t.x), t.dir) <= SHIELD_CFG.arc;
  const pt = ok.find(o => o.spec === 'point') || ok[0];
  return front && S.rng.chance(0.55) ? ok[0] : S.rng.chance(0.4) ? pt : S.rng.pick(ok); }
/** Resolve a round that hit an officer. who: officer record (team member) or patrol unit; t: the unit (team/patrol).
    Returns { res: 'shield' | 'stopped' | 'blunt' | 'pen', zone, by }. */
function armorHit(who, t, cal, d, fx_, fy) { const r = S.rng;
  // ballistic shield (frontal arc, partial coverage); teammates stacked behind the point shield get some of it
  if (t && t.kind === 'team') { const front = fx_ === undefined || t.dir === undefined || angDiff(Math.atan2(fy - t.y, fx_ - t.x), t.dir) <= SHIELD_CFG.arc;
    const own = shieldOf(who), ptS = shieldOf(teamOk(t)[0]);
    const sk = own || (ptS && who !== teamOk(t)[0] ? ptS : null), share = own ? SHIELD_CFG.cover : SHIELD_CFG.stack;
    if (sk && front && r.chance(share)) { if (r.chance(SHIELDS[sk].stops[cal] || 0)) return { res: 'shield', zone: 'shield', by: sk }; } }
  if (!r.chance(ARMOR_CFG.torso)) return { res: 'pen', zone: 'limb' };
  const a = armorOf(who); if (!r.chance(ARMOR[a].stops[cal] || 0)) return { res: 'pen', zone: 'torso', by: a };
  const bp = (ARMOR_CFG.blunt[cal] || 0) * clamp(1 - (d - 1) / Math.max(0.5, ARMOR_CFG.bluntRange - 1), 0, 1);
  return { res: d <= ARMOR_CFG.bluntRange && r.chance(bp) ? 'blunt' : 'stopped', zone: 'torso', by: a }; }
/** A round from the suspect has hit team / patrol unit t. Applies armor, logs, creates the casualty. Returns the armor result. */
function shotOfficer(t, cal, d, fx_, fy, where, opt) {
  const who = t.kind === 'team' ? (opt && opt.victim) || pickVictim(t, fx_, fy) : t; if (!who) return null;
  const a = armorHit(who, opt && opt.noShield ? null : t, cal, d, fx_, fy); S.stats.armorStops = (S.stats.armorStops || 0) + (a.res === 'pen' ? 0 : 1);
  const nm = who.name, src = where ? ` from the ${where}` : '';
  if (a.res === 'shield') { fx('text', t.x, t.y, { text: 'SHIELD', color: '#7fe3ff' }); log(`SHOTS FIRED${src} — round stopped by ${nm}'s ${SHIELDS[a.by].short}. Unhurt.`, 'alert'); }
  else if (a.res === 'stopped') { fx('text', t.x, t.y, { text: 'ARMOR', color: '#7fe3ff' }); log(`SHOTS FIRED${src} — ${nm} hit in the vest; the ${ARMOR[a.by].short} armor stopped it. Unhurt, still in the fight.`, 'alert'); }
  else if (a.res === 'blunt') { S.stats.minor = (S.stats.minor || 0) + 1; officerDown(t, null, { victim: who, minor: true, cal }); }
  else officerDown(t, null, { victim: who });
  return a; }
/** Suspect's own armor: does it stop an officer's round? cal: 'pistol' | 'rifle' | 'sniper' | 'shotgun'. */
function suspectArmorStops(cal) { const sp = S.suspect; if (!sp.armor || sp.armor === 'none') return false;
  if (!S.rng.chance(sp.atWindow ? ARMOR_CFG.suspectTorsoWindow : ARMOR_CFG.suspectTorso)) return false; // head / limbs / uncovered window shot
  return S.rng.chance(ARMOR[sp.armor].stops[cal] || 0); }
function setupSuspectArmor() { const r = makeRng(S.seed * 977 + 13), sp = S.suspect; // separate stream: the map and the rest of the scenario stay identical
  const p = S.opts && S.opts.suspectArmor !== undefined ? S.opts.suspectArmor : ARMOR_CFG.suspect;
  sp.armor = r.chance(p) ? (r.chance(ARMOR_CFG.suspectPlate) ? 'plate' : 'soft') : 'none'; sp.armorKnown = false; }
function revealSuspectArmor(how) { const sp = S.suspect; if (!sp.armor || sp.armor === 'none') return; if (how === 'stop') { sp.armorKnown = true; log('The round appears to have been stopped by body armor.', 'intel'); return; } if (sp.armorKnown) return; sp.armorKnown = true;
  log(how === 'stop' ? 'The round appears to have been stopped by body armor.' : `${spName()} appears to be wearing body armor (${sp.armor === 'plate' ? 'plate carrier' : 'soft vest'}).`, 'intel'); }
function hasShield(t) { return !!(t && t.equip && ((t.equip.shield || 0) + (t.equip.shield3 || 0)) > 0); }

/** Armor summary for the UI: soft / plate counts and the best shield held. */
function teamArmor(t) { const ok = t && t.kind === 'team' ? teamOk(t) : []; const r = { soft: 0, plate: 0, shield: null };
  for (const o of ok) { armorOf(o) === 'plate' ? r.plate++ : r.soft++; const sh = shieldOf(o); if (sh && (!r.shield || sh === 'shield3')) r.shield = sh; } return r; }
