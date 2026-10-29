/* ===================== BREACHING ===================== */
// Methods: explosive charge (hang → stand off → detonate), ram, Halligan pry, kick.
// Per-attempt success p; barricades (suspect-reinforced) cut it; storm doors add a layer.
const CHARGE_SAFE = 3; // cells: closer than this at detonation → dazed
const BREACH = {
  charge: { name: 'Explosive charge', eq: 'charge', p: 0.97, barr: 0.92, storm: 1.0, setup: 1, every: 1, noise: 18, label: 'very loud' },
  ram:    { name: 'Ram',              eq: 'ram',    p: 0.5,  barr: 0.5,  storm: 0.8, setup: 0, every: 1, noise: 9,  label: 'loud' },
  pry:    { name: 'Halligan pry',     eq: 'halligan', p: 0.55, barr: 0.3, storm: 0.55, setup: 0, every: 2, noise: 5, label: 'moderate' },
  kick:   { name: 'Kick',             eq: null,     p: 0.25, barr: 0.2,  storm: 0.4, setup: 0, every: 1, noise: 7,  label: 'loud' },
};
function breachMethods(u) { return Object.keys(BREACH).filter(k => breachCan(u, k) === true); }
function breachCan(u, m) { const B = BREACH[m]; if (!B) return 'Unknown method';
  if (B.eq && !(u.equip && u.equip[B.eq] > 0)) return `Needs a ${EQUIP[B.eq].name}`;
  if (m === 'charge' && !hasSpec(u, 'breacher')) return 'Only a Breacher can hang a charge';
  if (m === 'charge' && u.kind === 'team' && !teamOk(u).some(o => isSpec(o, 'breacher') && countOf(o, 'charge') > 0 && freeable(o) >= ITEM_CFG.charge.needFree)) return 'The breacher with the charges has no free hand (shield / ram)';
  if (m === 'ram' && u.kind === 'team' && !teamOk(u).some(ramReady)) return 'The ram carrier\'s other hand holds a shield — both hands are needed on the ram';
  return true; }
function breachP(u, d, m, layer) { const B = BREACH[m]; let p = layer === 'storm' ? B.storm : B.p;
  if (layer !== 'storm' && d.barricaded) p *= B.barr;
  if (layer !== 'storm' && d.kind === 'garage' && m !== 'charge') p *= 0.35;
  if (layer !== 'storm') p *= doorMul(d, m);
  if (m !== 'charge' && hasSpec(u, 'breacher')) p = Math.min(0.95, p + 0.15 * teamSpecMul(u, 'breacher'));
  if ((u.impair || 0) > 0) p *= 1 - 0.4 * u.impair;
  return clamp(p, 0.02, 0.98); }
function defaultMethod(u, d) { const ms = breachMethods(u); if (d.barricaded || d.kind === 'garage') { for (const m of ['charge', 'ram', 'pry', 'kick']) if (ms.includes(m)) return m; }
  for (const m of ['ram', 'charge', 'pry', 'kick']) if (ms.includes(m)) return m; return 'kick'; }
/** Expected ticks / per-attempt success / noise for the order UI tooltip. Uses only what the player knows. */
function breachEst(u, d, m) {
  const ok = breachCan(u, m); const B = BREACH[m]; const knownD = { barricaded: d.barricaded && d.barrKnown, kind: d.kind, steel: d.steel, thin: d.thin };
  const stormK = d.storm && d.stormKnown && d.stormState === 'closed';
  const pMain = breachP(u, Object.assign({}, d, knownD), m, 'main'), pStorm = stormK ? breachP(u, d, m, 'storm') : 1;
  let ticks;
  if (m === 'charge') ticks = ITEM_CFG.charge.drawTicks /*draw off the vest*/ + 1 /*hang*/ + 2 /*stand off*/ + 1 /*detonate*/;
  else ticks = B.every * (1 / pMain) + (stormK ? B.every * (1 / pStorm) : 0);
  return { method: m, name: B.name, ok, ticks: Math.round(ticks * 10) / 10, p: +pMain.toFixed(2), storm: stormK, pStorm: +pStorm.toFixed(2), noise: B.label,
    text: `${B.name}: ~${Math.round(ticks * 10) / 10} ticks, ${Math.round(pMain * 100)}% per attempt${stormK ? ` (+storm door ${Math.round(pStorm * 100)}%)` : ''}, ${B.label}` };
}
function doorMid(d) { const c = d.cells[Math.floor(d.cells.length / 2)]; return [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2]; }
/** Standoff cell for a charge: ≥CHARGE_SAFE away, prefer out of the door's line and low exposure. */
function standoffGoal(u, d) { const [mx, my] = doorMid(d);
  const D = reach(u.x, u.y, Object.assign({}, moveOpts(u), { outdoor: roomAt(u.x, u.y) < 0 }), 12); let best = null, bs = 1e9;
  for (let c = 0; c < D.length; c++) { if (D[c] >= 1e9) continue; const x = c % MAP_W, y = (c / MAP_W) | 0; const dd = dist(x, y, mx, my); if (dd < CHARGE_SAFE + 0.6 || dd > 7) continue;
    const s = D[c] + (los(x, y, Math.round(mx), Math.round(my)) ? 3 : 0) + (roomAt(x, y) < 0 ? expoAt(x, y) * 6 : 0); if (s < bs) { bs = s; best = [x, y]; } }
  return best; }
/** Executes one tick of a breach / hang / detonate order. Returns nothing; pops the order when done. */
function breachTick(u, o, d, other) {
  const m = o.method || (o.method = defaultMethod(u, d)); const B = BREACH[m];
  if (o.type === 'detonate') return;
  if (m === 'ram' && u.kind === 'team' && !u.ramGrip) { const rm = teamOk(u).find(ramReady); if (rm) { u.ramGrip = { oid: rm.id, st: autoStow(rm, 'ram'), order: o }; invOf(rm).hands = ['ram', 'ram']; if (u.ramGrip.st.length) log(`${rm.name}: pistol holstered — both hands on the ram.`); } }
  if (m === 'charge') {
    if (!d.charge) { if (!(u.equip.charge > 0)) { failOrders(u, 'no charge left'); return; }
      const bo = teamOk(u).find(o => isSpec(o, 'breacher') && countOf(o, 'charge') > 0 && freeable(o) >= 1);
      if (bo && (o.drawT = (o.drawT || 0) + 1) <= ITEM_CFG.charge.drawTicks) { if (o.drawT === 1) log(`${bo.name}: drawing a charge off the vest…`); return; }
      if (bo) { const st = freeHands(bo) ? [] : autoStow(bo, heldList(bo).find(k => !(ITEM_CFG[k] || {}).stow)); useItem(u, 'charge', q => q === bo); autoRedraw(bo, st); } else useItem(u, 'charge'); d.charge = { by: u.uid, turn: S.turn }; if (d.storm) d.stormKnown = true;
      log(`${u.name}: charge hung on ${d.name}${d.storm && d.stormState === 'closed' ? ' (storm door included)' : ''}.`, 'radio'); fx('text', other[0], other[1], { text: 'CHARGE SET', color: '#ffb020' });
      if (o.hangOnly) o.phase = 'standoff'; return; } // hang-only: back off to the standoff point, then wait for Detonate
    o.phase = 'standoff'; return; // standoff + detonate handled by unitAct (needs pathing)
  }
  // manual: storm layer first
  if (d.storm && d.stormState === 'closed') { d.stormKnown = true;
    if (B.every > 1 && !(o.set = !o.set)) { log(`${u.name}: setting the Halligan on the storm door…`); return; }
    if (S.rng.chance(breachP(u, d, m, 'storm'))) { d.stormState = 'breached'; log(`${u.name}: storm door on ${d.name} defeated (${B.name.toLowerCase()}).`, 'radio'); fx('thud', other[0], other[1]); noise(other[0], other[1], B.noise - 2, 'door'); }
    else { log(`${u.name}: ${B.name.toLowerCase()} on the storm door — still holding.`); noise(other[0], other[1], B.noise, 'ram'); fx('thud', other[0], other[1]); }
    return; }
  if (B.every > 1 && !(o.set = !o.set)) { log(`${u.name}: setting the Halligan on ${d.name}…`); return; }
  if (S.rng.chance(breachP(u, d, m, 'main'))) { doBreach(u, d, m); popOrder(u); ramRelease(u); runAfter(u, o); }
  else { if (d.barricaded) d.barrKnown = true; log(`${u.name}: ${B.name.toLowerCase()} on ${d.name} — no give${d.barricaded ? ' (it\'s barricaded!)' : ''}.`); noise(other[0], other[1], B.noise, 'ram'); fx('thud', other[0], other[1]); }
}
/** After the ram: pistols come back out automatically (NOT READY for one full turn). */
function ramRelease(u) { if (!u.ramGrip) return; const o = off(u.ramGrip.oid); if (o) { if (twoHanded(o, 'ram')) invOf(o).hands = ['ram', null]; autoRedraw(o, u.ramGrip.st); if (u.ramGrip.st.length) log(`${o.name}: ram down, pistol back out (not ready until next turn).`); } u.ramGrip = null; syncEquip(u); }
function detonateCharge(u, d) {
  const [mx, my] = doorMid(d); const by = unit(d.charge.by) || u; d.charge = null;
  fx('blast', mx, my, { r: CHARGE_SAFE + 2 }); noise(mx, my, 60, 'blast'); // an explosive breach is heard house-wide
  if (S.rng.chance((d.barricaded ? BREACH.charge.barr : BREACH.charge.p) * doorMul(d, 'charge'))) { if (d.storm) d.stormState = 'breached'; doBreach(by, d, 'charge'); }
  else { log(`${by.name}: charge on ${d.name} fired but the door held — needs another breach.`, 'alert'); noise(mx, my, 18, 'breach'); d.barrKnown = d.barricaded; if (d.storm) d.stormState = 'breached'; }
  for (const q of S.units) { if (!onFoot(q) && q.kind !== 'team') continue; if (!unitAlive(q) || q.inCar) continue;
    const dd = dist(q.x, q.y, mx, my); if (dd < CHARGE_SAFE && los(q.x, q.y, Math.round(mx), Math.round(my))) { q.stun = 2; q.impair = Math.max(q.impair || 0, 0.5); log(`${q.name}: too close to the blast — dazed.`, 'alert'); fx('text', q.x, q.y, { text: 'DAZED', color: '#ffd080' }); } }
  eachSp(sp => { if (hostile()) { sp.agit = clamp(sp.agit + 15, 0, 100); if (dist(sp.x, sp.y, mx, my) < 4) { sp.stun = Math.max(sp.stun, 2); sp.daze = Math.max(sp.daze || 0, 8); log(`${spName()} stunned by the blast.`, 'good'); } } });
}
