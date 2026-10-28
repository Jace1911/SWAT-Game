
/* =====================================================================
   SCENARIO TYPES — data-driven call types, picked from the seed (or forced
   by opts.stype). Each type tunes suspect temperament, negotiation, fire
   readiness, escape drive, the 911 call / brief and the debrief bonuses.
   Rules only: no DOM. Neutral wording throughout.
   ===================================================================== */
/* ================== TUNABLE: SCENARIO TYPES ================== */
const SCEN_TYPES = {
  barricade: { name: 'Barricaded subject', short: 'Barricade', w: 0.30, agit: 45, fireMul: 1, negoMul: 1, calloutMul: 1, slipMul: 1, slipAfter: 2,
    desc: 'Armed adult barricaded in his house after a disturbance, a warrant attempt or shots reported.' },
  mental: { name: 'Mental health crisis', short: 'Mental health', w: 0.20, agit: 30, fireMul: 0.55, negoMul: 1.35, calloutMul: 1.3, slipMul: 0.5, slipAfter: 3,
    temperW: { talker: 0.5, withdrawn: 0.45, volatile: 0.05 }, legal: { discharge: 0.3, warrant: 0.25, interview: 0.45 },
    bonus: { noForce: 150, ems: 100 },
    desc: 'A person in crisis, armed, alone. Low aggression, open to talking. Resolve without force and arrange an EMS evaluation for a bonus.' },
  domestic: { name: 'Domestic disturbance', short: 'Domestic', w: 0.20, agit: 50, fireMul: 1, negoMul: 1, calloutMul: 1, slipMul: 1, slipAfter: 2,
    variants: { firearm: 0.55, violent: 0.45 },
    desc: 'He assaulted his partner, who got out and is waiting at the perimeter — interview her for the layout, weapons and history.' },
  flee: { name: 'Fleeing suspect — vacant house', short: 'Fleeing suspect', w: 0.15, agit: 60, fireMul: 1.1, negoMul: 0.5, calloutMul: 0.6, slipMul: 3, slipAfter: 1,
    temperW: { talker: 0.1, withdrawn: 0.5, volatile: 0.4 }, vacant: true,
    desc: 'He ran from patrol into an empty house. Nobody else inside, little interest in talking — and he will leave through any side nobody watches.' },
  neighbor: { name: 'Neighbor dispute — firearm displayed', short: 'Neighbor dispute', w: 0.15, agit: 55, fireMul: 1, sideMul: 1.35, offSideMul: 0.85, negoMul: 0.9, calloutMul: 1, slipMul: 1, slipAfter: 2,
    temperW: { talker: 0.3, withdrawn: 0.25, volatile: 0.45 }, knownArmed: true,
    desc: 'He pointed a gun at the neighbor. Known armed; most hostile toward the neighbor\u2019s side of the house. The neighbor can be interviewed.' },
};
const SCEN_KEYS = Object.keys(SCEN_TYPES);
const LEGAL_TXT = { discharge: 'He fired a round inside the house — reckless discharge charge.', warrant: 'Active warrant (failure to appear) on file.', interview: 'No crime reported — emergency mental-health evaluation (transport hold) only.' };
/* ============================================================ */
function wpick(r, W) { let p = r() * Object.values(W).reduce((a, b) => a + b, 0); for (const k in W) { p -= W[k]; if (p <= 0) return k; } return Object.keys(W)[0]; }
/** Scenario type for a seed (deterministic; independent of the map generator's random stream). */
function typeForSeed(seed, force) {
  const r = makeRng(((seed >>> 0) % 1000000 || 1) * 7393 + 11), key = SCEN_TYPES[force] ? force : wpick(r, Object.fromEntries(SCEN_KEYS.map(k => [k, SCEN_TYPES[k].w]))), T = SCEN_TYPES[key];
  const st = { key, name: T.name, short: T.short, variant: null, legal: null, risk: false, side: null };
  if (T.variants) st.variant = wpick(r, T.variants);
  if (T.legal) st.legal = wpick(r, T.legal);
  if (key === 'mental') st.risk = true;            // neutral debrief flag only
  if (key === 'neighbor') st.side = r.chance(0.5) ? 'left' : 'right';
  if (st.variant === 'violent') st.name = T.name + ' (violent)'; else if (st.variant === 'firearm') st.name = T.name + ' (firearm)';
  return st;
}
function stypeCfg() { return SCEN_TYPES[(S.stype && S.stype.key) || 'barricade']; }
/** After the map/suspect are generated: apply the type to the suspect and intel. */
function applyScenType() {
  const st = S.stype, T = stypeCfg(), sp = S.suspect, r = makeRng(S.seed * 5113 + 3);
  sp.agit = T.agit;
  if (st.key === 'neighbor') { sp.weapon = r.chance(0.6) ? 'handgun' : 'rifle'; S.intel.weapon = true; S.intel.threat = Math.max(S.intel.threat, 1); }
  if (st.key === 'domestic' && st.variant === 'firearm' && sp.weapon === 'rifle') sp.weapon = 'shotgun';
  if (st.key === 'domestic') S.intel.partner = false;
  if (T.vacant) S.vacant = true;
}
/** Officer is on the neighbor's side of the house (neighbor-dispute aggression). */
function onNeighborSide(u) { const st = S.stype; if (!st || !st.side) return false; const H = S.house; return st.side === 'left' ? u.x < H.x0 : u.x > H.x1; }
function typeFireMul(u) { const T = stypeCfg(); let m = T.fireMul || 1; if (T.sideMul && u) m *= onNeighborSide(u) ? T.sideMul : T.offSideMul; return m; }
/** Mental-health type: was it resolved without force? */
function resolvedNoForce() { const R = S.result || {}, m = S.stats.method || ''; return !!R.win && !S.stats.ofShots && !S.stats.breaches && !/fire|Less-lethal|Taser|gas|flashbang|entry/i.test(m) && !S.gasEver; }
/** Debrief lines for the scenario type. */
function typeDebrief() {
  const st = S.stype, out = []; if (!st) return out;
  out.push({ k: 'Scenario type', v: st.name + (st.legal ? ` · legal: ${st.legal}` : '') + '.' });
  if (st.key === 'mental') { out.push({ k: '  Crisis resolution', v: resolvedNoForce() ? 'Resolved without force.' : (S.result && S.result.win ? 'Resolved with force.' : 'Not resolved.') });
    out.push({ k: '  Risk flag', v: 'Risk to himself reported at the call. ' + (S.intel.emsEval ? 'Referred for EMS evaluation.' : 'No EMS evaluation arranged.') }); }
  if (st.key === 'domestic') out.push({ k: '  Partner interview', v: S.intel.partner ? 'Done — layout, weapons and history obtained.' : 'Not done.' });
  if (st.key === 'neighbor') out.push({ k: '  Neighbor side', v: `Most hostile toward the ${st.side} side (neighbor's house).` });
  if (st.key === 'flee') out.push({ k: '  Vacant house', v: S.stats.escaped ? 'He got out through an unwatched side.' : 'Contained.' });
  return out;
}
function typeScore(add) {
  const st = S.stype, T = stypeCfg(); if (!st || !T.bonus) return;
  if (st.key === 'mental' && resolvedNoForce()) add('Crisis resolved without force', T.bonus.noForce);
  if (st.key === 'mental' && S.result && S.result.win && S.intel.emsEval) add('EMS evaluation arranged', T.bonus.ems);
}
