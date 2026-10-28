
/* =====================================================================
   CASUALTIES — injury severity, critical countdown, aid / rescue / evacuation.
   Rules only (no drawing). Neutral wording: critical, immobile, evacuated.
   Applies to patrol, cruiser drivers, SWAT officers, the suspect and (generic) civilians.
   ===================================================================== */
/* ================== TUNABLE: CASUALTY CONFIG ================== */
const CAS_CFG = {
  kia: 0.10,              // a hit person does not survive (memorial marker)
  mobile: 0.40,           // injured but mobile: moves to cover next turn, then walks to EMS; the rest are immobile
  critMobile: [8, 12],    // turns until critical without aid (mobile)
  critImmobile: [3, 6],   // turns until critical without aid (immobile)
  severe: 0.55,           // share of immobile injuries that are severe (sev 3)
  medicSevere: 6,         // medic + medkit on a severe casualty: +turns (still needs EMS)
  medicNoKit: 3,          // medic without a medkit: +turns
  aidOther: 2,            // first aid by any other officer: +turns (once per casualty)
  transport: 2,           // turns from the EMS point to hospital
  carryTeam: 2,           // cells/tick carrying outdoors (team); always 1 indoors
  carryPatrol: 1,         // a single patrol officer dragging a casualty
  carryShield: 0.6,       // hit-chance multiplier for a carrying team with a ballistic shield
  secureSave: 2,          // scene secured: casualties with >= this many turns left reach EMS in time
  suspectKia: 0.08, suspectMobile: 0.28, // suspect hit outcomes (rest immobile = incapacitated)
  emsMinDist: 14,         // EMS point must be at least this far from the house centre
};
/* ============================================================== */
function casById(id) { return (S.cas || []).find(c => c.id === id); }
function casActive(c) { return c && (c.state === 'mobile' || c.state === 'immobile'); }
function casCell(x, y, outdoorFirst) {
  const ok = (xx, yy) => inb(xx, yy) && !S.block[idx(xx, yy)] && !S.dyn[idx(xx, yy)] && !(outdoorFirst && S.room[idx(xx, yy)] >= 0);
  if (ok(x, y)) return [x, y];
  for (let r = 1; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (ok(x + dx, y + dy)) return [x + dx, y + dy];
  return [x, y];
}
/** Roll an injury and create a casualty record. who: 'officer' | 'patrol' | 'suspect' | 'civilian'. */
function addCasualty(who, ref, name, x, y, o = {}) {
  const r = S.rng, cfg = CAS_CFG; const kiaP = o.kia !== undefined ? o.kia : cfg.kia, mobP = o.mobile !== undefined ? o.mobile : cfg.mobile;
  const roll = r(); let state, sev, crit;
  if (o.minor) { state = 'mobile'; sev = 1; crit = r.int(cfg.critMobile[0], cfg.critMobile[1]) * 3; } // blunt impact behind armor: minor, very slow to worsen
  else if (roll < kiaP) { state = 'kia'; sev = 3; crit = 0; }
  else if (roll < kiaP + mobP) { state = 'mobile'; sev = r.chance(0.7) ? 1 : 2; crit = r.int(cfg.critMobile[0], cfg.critMobile[1]); }
  else { state = 'immobile'; sev = r.chance(cfg.severe) ? 3 : 2; crit = r.int(cfg.critImmobile[0], cfg.critImmobile[1]) - (sev === 3 ? 1 : 0); }
  const [cx, cy] = casCell(x, y, roomAt(x, y) < 0);
  const c = { id: 'X' + (++S.casSeq), who, ref, name, x: cx, y: cy, sev, state, crit, crit0: crit, stable: false, aided: 0, carrier: null, tr: 0, turn: S.turn, wait: true,
    goal: null, team: o.team || null, reported: who !== 'suspect' && (sev < 3 || !!o.witness), seen: false, known: false, by: o.by || null, minor: !!o.minor };
  S.cas.push(c);
  if (state === 'kia') { S.stats.kia++; c.known = who !== 'suspect'; }
  casKnow(c); return c;
}
/** Fog of war: own people are known by radio report (or a witness); otherwise only by vision. */
function casKnow(c) { const v = S.vis && S.vis[idx(c.x, c.y)]; if (v) c.seen = true; c.known = c.reported || !!v || c.seen && c.who !== 'suspect' || c.state === 'transport' || c.state === 'evacuated'; return c.known; }
function sevWord(c) { return c.state === 'kia' ? 'killed in action' : c.state === 'lost' ? 'did not survive' : c.state === 'evacuated' ? 'evacuated' : c.state === 'transport' ? 'in EMS transport' : c.stable ? 'stable' : c.sev === 3 ? 'critical' : c.sev === 2 ? 'serious' : 'injured'; }
function casLabel(c) { return c.state === 'mobile' ? 'mobile' : c.state === 'immobile' ? 'immobile' : sevWord(c); }
/** Report text for a fresh casualty (neutral wording). */
function casReport(c, ctx) {
  if (c.state === 'kia') return `${c.name}${ctx ? ' (' + ctx + ')' : ''} is hit — killed in action.`;
  if (c.state === 'mobile') return `${c.name}${ctx ? ' (' + ctx + ')' : ''} is hit — injured but mobile, moving to cover. Critical: ${tDur(c.crit)}.`;
  if (!c.reported) return `${c.name}${ctx ? ' (' + ctx + ')' : ''} is hit — no radio response. Status unknown.`;
  return `${c.name}${ctx ? ' (' + ctx + ')' : ''} is hit — immobile, needs rescue. Critical: ${tDur(c.crit)}.`;
}
function casTail(c) { return c.state === 'kia' ? 'Killed in action.' : c.state === 'mobile' ? `Injured but mobile. Critical: ${tDur(c.crit)}.` : c.reported ? `Immobile — needs rescue. Critical: ${tDur(c.crit)}.` : 'No radio contact — status unknown.'; }
/** Default EMS staging point: low-exposure outdoor cell near the SWAT truck. */
function defaultEMS() {
  const st = S.ext.staging; let best = null, bs = 1e9; const [hx, hy] = houseCenter();
  for (let dy = -6; dy <= 6; dy++) for (let dx = -8; dx <= 8; dx++) { const x = st.x + dx, y = st.y + dy; if (!cellOk(x, y, { outdoor: true })) continue; if (dist(x, y, hx, hy) < CAS_CFG.emsMinDist) continue;
    const s = expoAt(x, y) * 10 + Math.abs(dx - 4) * 0.3 + Math.abs(dy) * 0.3; if (s < bs) { bs = s; best = [x, y]; } }
  return best ? { x: best[0], y: best[1], custom: false } : { x: st.x, y: st.y, custom: false };
}
function emsCheck(x, y) { const [hx, hy] = houseCenter();
  if (!cellOk(x, y, { outdoor: true })) return 'EMS needs open ground outside (not a building, fence or car)';
  if (dist(x, y, hx, hy) < CAS_CFG.emsMinDist) return `Too close to the house — EMS stages at least ${CAS_CFG.emsMinDist} m out`;
  if (expoAt(x, y) >= 0.15) return 'That spot is in a line of fire from the house';
  return null; }
function setEMS(x, y) { if (S.phase !== 'planning') return { ok: false, reason: 'Wait for the orders to resolve' }; const q = emsCheck(x, y); if (q) return { ok: false, reason: q };
  S.ems = { x, y, custom: true }; log(`EMS staging point set — ambulance moving up.`, 'system'); S.version++; return { ok: true }; }
/** Casualty collection point: nearest low-exposure outdoor cell from a position. */
function ccpFor(x, y) {
  const mo = { canOpen: true, avoidSuspect: true, expo: true }; const D = reach(x, y, mo, 40); let best = null, bs = 1e9; const [hx, hy] = houseCenter();
  for (let yy = Math.max(1, y - 18); yy <= Math.min(MAP_H - 2, y + 18); yy++) for (let xx = Math.max(1, x - 18); xx <= Math.min(MAP_W - 2, x + 18); xx++) {
    const c = idx(xx, yy); if (D[c] >= 1e9 || S.room[c] >= 0 || S.expo[c] >= 0.12 || S.dyn[c]) continue;
    const s = D[c] * 0.25 + S.expo[c] * 10 - (coverAdj(xx, yy) ? 0.8 : 0) - Math.min(dist(xx, yy, hx, hy), 16) * 0.05; if (s < bs) { bs = s; best = [xx, yy]; } }
  return best; }
function carrierOpts(u) { return u.kind === 'patrol' ? { outdoor: true, canOpen: false, avoidSuspect: true, expo: true } : { canOpen: true, avoidSuspect: true, expo: true }; }
function adjGoal(c) { return (x, y) => cheb(x, y, c.x, c.y) <= 1; }
/** planOrder branch for aid / rescue / evac (preview + validation). */
function planCas(u, o, sx, sy, assume) {
  const c = casById(o.cas); if (!c || !casActive(c)) return { ok: false, reason: 'No casualty there needing help' };
  if (!c.known) return { ok: false, reason: 'Status unknown — get eyes on that position first' };
  if (u.kind === 'patrol' && roomAt(c.x, c.y) >= 0) return { ok: false, reason: 'Patrol does not enter the house — send a SWAT team' };
  if (c.carrier && c.carrier !== u.uid) return { ok: false, reason: 'Already being moved' };
  if (o.type === 'evac' && c.state === 'transport') return { ok: false, reason: 'Already with EMS' };
  const mo = Object.assign(carrierOpts(u), { assume }); const g = adjGoal(c);
  const p = g(sx, sy) ? [] : findPath(sx, sy, g, mo); if (!p) return { ok: false, reason: 'Cannot reach the casualty' };
  const at = p.length ? p[p.length - 1] : [sx, sy];
  if (o.type === 'aid') return { ok: true, path: p, end: at };
  let dest; if (o.type === 'evac') dest = [S.ems.x, S.ems.y]; else { dest = ccpFor(c.x, c.y); if (!dest) return { ok: false, reason: 'No covered collection point in reach' }; o.dx = dest[0]; o.dy = dest[1]; }
  const p2 = findPath(c.x, c.y, (x, y) => cheb(x, y, dest[0], dest[1]) <= (o.type === 'evac' ? 1 : 0), Object.assign(carrierOpts(u), { assume }));
  if (!p2) return { ok: false, reason: o.type === 'evac' ? 'No route to the EMS point' : 'No route to cover' };
  return { ok: true, path: p.concat([[c.x, c.y]], p2), end: p2.length ? p2[p2.length - 1] : [c.x, c.y], carry: p2.length };
}
/** First aid / stabilise. Medic with a medkit = full effect; others extend the countdown. */
function applyAid(u, c, auto) {
  if (!casActive(c)) return false; const cfg = CAS_CFG; const medic = u.kind === 'team' && hasSpec(u, 'medic'); let t;
  const medO = medic ? teamOk(u).find(o => o.spec === 'medic') : null, medHands = medO && freeable(medO) >= ITEM_CFG.medkit.useHands;
  if (medic && u.equip.medkit > 0 && !medHands) log(`${u.name}: medic's hands are not free (shield / ram) — basic aid only.`, 'alert');
  if (medic && u.equip.medkit > 0 && medHands) { withHands(u, medO, 2, () => useItem(u, 'medkit')); if (c.sev >= 3) { c.crit += cfg.medicSevere; c.aided = 2; t = `medic treats ${c.name} — severe, +${tDur(cfg.medicSevere)}; needs EMS.`; }
    else { c.stable = true; c.aided = 2; t = `medic stabilises ${c.name} — countdown stopped.`; } }
  else if (medic) { if (c.aided >= 1) return false; c.crit += cfg.medicNoKit; c.aided = 1; t = `medic (no medkit) packs ${c.name}'s injury — +${tDur(cfg.medicNoKit)}.`; }
  else { if (c.aided >= 1) { if (!auto) log(`${u.name}: ${c.name} already has first aid — needs a medic or EMS.`, 'radio'); return false; } c.crit += cfg.aidOther; c.aided = 1; t = `first aid on ${c.name} — +${tDur(cfg.aidOther)}.`; }
  log(`${u.name}: ${t}`, 'good'); xpAct('aid', u, c.name); fx('text', c.x, c.y, { text: c.stable ? 'STABLE' : 'AID', color: '#3ef0a0' }); S.version++; return true;
}
function dropCas(u, c) { if (c) { c.carrier = null; } u.carrying = null; }
function atEMS(c, u) { if (u) xpAct('evac', u, c.name); c.state = 'transport'; c.tr = CAS_CFG.transport; c.stable = true; c.carrier = null; c.known = true; if (u) u.carrying = null;
  log(`EMS: ${c.name} loaded into the ambulance — transport ${tMin(c.tr)}.`, 'good'); fx('text', c.x, c.y, { text: 'EMS', color: '#3ef0a0' }); }
/** Execution of aid / rescue / evac orders (called from unitAct). */
function casAct(u, o, speed) {
  const c = casById(o.cas); if (!c || !casActive(c) || (c.carrier && c.carrier !== u.uid)) { if (u.carrying === o.cas) dropCas(u, c); popOrder(u); return; }
  if (!o.picked) {
    if (cheb(u.x, u.y, c.x, c.y) > 1) { const r = stepAlong(u, o, adjGoal(c), speed); if (r === null) failOrders(u, 'cannot reach the casualty'); if (!r) return; }
    faceTo(u, c.x, c.y);
    if (o.type === 'aid') { applyAid(u, c); popOrder(u); return; }
    if (u.kind === 'team' && hasSpec(u, 'medic') && !c.stable && c.aided < 2) applyAid(u, c, true);
    o.picked = true; c.carrier = u.uid; u.carrying = c.id; c.x = u.x; c.y = u.y;
    if (o.type === 'rescue' && (o.dx === undefined)) { const d = ccpFor(c.x, c.y); if (d) { o.dx = d[0]; o.dy = d[1]; } else { o.dx = u.x; o.dy = u.y; } }
    log(`${u.name}: has ${c.name} — ${o.type === 'evac' ? 'carrying to the EMS point' : 'dragging to cover'}${u.kind === 'team' && hasShield(u) ? ' behind the shield' : ''}.`, 'radio'); return; }
  const inside = roomAt(u.x, u.y) >= 0, sp = inside ? 1 : u.kind === 'team' ? CAS_CFG.carryTeam : CAS_CFG.carryPatrol;
  const goal = o.type === 'evac' ? (x, y) => cheb(x, y, S.ems.x, S.ems.y) <= 1 : (x, y) => x === o.dx && y === o.dy;
  const r = stepAlong(u, o, goal, sp); c.x = u.x; c.y = u.y;
  if (r === null) { dropCas(u, c); failOrders(u, 'no route while carrying'); return; }
  if (r) { popOrder(u); if (o.type === 'evac') atEMS(c, u); else { dropCas(u, c); c.ccp = true; xpAct('rescue', u, c.name); log(`${u.name}: ${c.name} at the casualty collection point (in cover).`, 'radio'); } }
}
/** Per tick: mobile casualties move themselves (cover first, then to EMS). Fog flags refresh. */
function casualtyTick() {
  for (const c of S.cas) { if (c.who === 'suspect' && casActive(c) && !c.carrier) { const so = suspById(c.ref) || S.suspect; c.x = so.x; c.y = so.y; } casKnow(c); if (c.state !== 'mobile' || c.carrier || c.wait || c.who === 'suspect') continue;
    if (!c.goal) { const d = expoAt(c.x, c.y) < 0.12 && roomAt(c.x, c.y) < 0 ? null : ccpFor(c.x, c.y); c.goal = d ? { x: d[0], y: d[1], k: 'cover' } : { x: S.ems.x, y: S.ems.y, k: 'ems' }; }
    if (c.goal.k === 'cover' && c.x === c.goal.x && c.y === c.goal.y) { c.goal = { x: S.ems.x, y: S.ems.y, k: 'ems' }; log(`${c.name}: in cover — making own way to EMS.`, 'radio'); continue; }
    if (c.goal.k === 'ems') { c.goal.x = S.ems.x; c.goal.y = S.ems.y; if (cheb(c.x, c.y, S.ems.x, S.ems.y) <= 1) { atEMS(c); continue; } }
    if (S.tick % 2) continue; // walking wounded: half speed
    const g = c.goal.k === 'ems' ? (x, y) => cheb(x, y, c.goal.x, c.goal.y) <= 1 : (x, y) => x === c.goal.x && y === c.goal.y;
    const p = findPath(c.x, c.y, g, { canOpen: true, avoidSuspect: true, expo: true }); if (p && p.length) { c.x = p[0][0]; c.y = p[0][1]; } else if (!p) c.goal = null; }
}
/** End of turn: countdowns and transport. */
function casualtyTurn() {
  for (const c of S.cas) { c.wait = false;
    if (c.state === 'transport') { if (--c.tr <= 0) { c.state = 'evacuated'; S.stats.evac++; log(`EMS: ${c.name} has reached hospital.`, 'good'); } continue; }
    if (!casActive(c) || c.stable) continue;
    c.crit--; if (c.crit <= 0) { if (c.who === 'suspect' && c.state === 'mobile') { c.state = 'immobile'; c.crit = 3; withSp(suspById(c.ref), sp => { if (hostile()) { sp.mode = 'incapacitated'; sp.walk = null; S.stats.method = 'Officer fire'; sp.method = sp.method || 'Officer fire'; } if (sp.visible) log(`${spName()} has collapsed — immobile.`, 'alert'); }); continue; }
      if (c.who === 'suspect') { withSp(suspById(c.ref), () => suspectLost(c)); continue; } c.state = 'lost'; S.stats.lost++; if (c.carrier) { const u = unit(c.carrier); if (u) { u.carrying = null; u.orders = u.orders.filter(q => q.cas !== c.id); } c.carrier = null; }
      log(`${c.name} did not survive the injuries.`, 'bad'); fx('text', c.x, c.y, { text: 'LOST', color: '#c9ced6' }); }
    else if (c.crit <= 2 && c.known && c.who !== 'suspect') log(`${c.name}: Critical — ${tDur(c.crit)} left without aid.`, 'alert'); }
}
/** Scene secured / operation over: EMS moves in. */
function casualtyResolve(secure) {
  for (const c of S.cas) { if (c.state === 'transport') { c.state = 'evacuated'; S.stats.evac++; continue; }
    if (!casActive(c)) continue; const so = c.who === 'suspect' ? (suspById(c.ref) || S.suspect) : null; if (so && so.deceased) continue;
    if (c.stable || c.crit >= CAS_CFG.secureSave || (secure && c.state === 'mobile')) { c.state = 'evacuated'; S.stats.evac++; } else { c.state = 'lost'; S.stats.lost++; if (so) so.deceased = true; } c.known = true; }
}
/* ---------- the suspect as a casualty ---------- */
function suspectLost(c) { const sp = S.suspect; c.state = 'lost'; sp.deceased = true; if (hostile()) { sp.mode = 'incapacitated'; sp.walk = null; } S.stats.lost++;
  if (c.known || sp.visible) log('Suspect has stopped moving.', 'alert'); }
