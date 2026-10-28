/* v9 devices on the suspect: TASER (any officer, one hand, ~3 m) and the 40mm LESS-LETHAL launcher (qualified officer, two hands).
   Both are ordered on a visible suspect in range. The officer doing it AUTO-TRANSITIONS: whatever weapon is in the hands is
   holstered / slung (free, but NOT READY for one full turn), the device is drawn and used at once, then put back and the
   previous weapon redrawn automatically (auto-redraw rules, d1_inventory). A shield (or the ram) is never dropped and cannot be
   slung: the taser goes in the free hand next to it; the two-handed launcher is refused for a shield holder. */
const TASER_CFG = { range: 3, p: 0.8, perCell: 0.12, min: 0.2, armorMul: 0.6, stunTurns: 2, hands: 1 };
const LL_CFG = { range: 11, p: 0.85, perCell: 0.035, min: 0.3, ambushMul: 0.6, noEffect: 0.2, stunTurns: [2, 3], hands: 2 };
const DEVICE_ORDERS = ['taser', 'llfire'];
function devCfg(type) { return type === 'taser' ? TASER_CFG : LL_CFG; }
/** Officer who would fire the device for unit u (team: a member; patrol: the officer himself). null = nobody can. */
function deviceUser(u, type) {
  if (u.kind === 'patrol') return type === 'taser' ? u : null;
  if (u.kind !== 'team') return null;
  if (type === 'taser') { const m = teamOk(u), pt = m[0]; return m.filter(o => carries(o, 'taser') && freeable(o) >= TASER_CFG.hands)
    .sort((a, b) => freeHands(b) - freeHands(a) || (a === pt) - (b === pt))[0] || null; }
  const m = teamOk(u).filter(o => (o.quals || []).includes('ll') && carries(o, 'lesslethal') && invOf(o).ll > 0);
  return m.find(o => holds(o, 'lesslethal')) || m.find(o => freeable(o) >= LL_CFG.hands) || null; }
/** Why u cannot order this device right now (null = ok). */
function deviceWhyNot(u, type) {
  if (!hostile()) return 'Not needed — suspect is not a threat';
  if (u.inCar) return 'Get out of the vehicle first (Exit)';
  if (u.kind === 'patrol' && type !== 'taser') return 'Patrol officers carry a taser, not a launcher';
  if (u.kind === 'team' && !u.deployed) return 'Team is still forming at staging';
  if (u.orders && u.orders.some(q => DEVICE_ORDERS.includes(q.type))) return 'One taser / less-lethal order per turn';
  if (deviceUser(u, type)) return null;
  if (type === 'taser') return 'Nobody can free a hand for the taser (shield + ram in hand)';
  const q = u.kind === 'team' ? teamOk(u).filter(o => (o.quals || []).includes('ll') && carries(o, 'lesslethal')) : [];
  if (!q.length) return 'No 40mm less-lethal launcher on this team (needs a less-lethal specialist with the launcher)';
  if (q.every(o => invOf(o).ll <= 0)) return 'The 40mm launcher is out of rounds';
  return 'The 40mm launcher needs BOTH hands — its carrier holds a shield or the ram (cannot be slung; change loadout)'; }
/** Range / sight check from (sx,sy). */
function deviceShotReq(u, type, sx, sy) { const sp = S.suspect, c = devCfg(type);
  const d = dist(sx, sy, sp.x, sp.y); if (!sp.visible && !(type === 'taser' && d <= c.range && los(sx, sy, sp.x, sp.y) === 1 && sp.lastKnown && sp.lastKnown.turn === S.turn)) return 'Suspect not in view';
  if (d > c.range) return `Out of ${type === 'taser' ? 'taser' : '40mm'} range — ~${c.range} m (suspect ${Math.round(d)} m)`;
  if (los(sx, sy, sp.x, sp.y) !== 1) return 'No clear line to the suspect from there';
  return null; }
function deviceChance(u, type, d) { const sp = S.suspect, c = devCfg(type);
  let p = clamp(c.p - c.perCell * Math.max(0, d - 1), c.min, 0.95);
  if (type === 'taser' && sp.armor && sp.armor !== 'none') p *= c.armorMul; // vest / heavy layers keep probes from connecting
  if (type === 'llfire' && sp.ambush) p *= c.ambushMul;
  return p; }
/** Draw device k (auto-holster / sling the rest), run fn, put the device back and redraw. */
function deviceTransition(t, o, k, hands, fn) {
  if (o.kind === 'patrol') return { o, r: fn(o), stowed: [], drew: false };
  const had = holds(o, k); let st = [];
  if (!had) { st = autoStow(o, null); if (freeHands(o) < hands || !stowedHas(o, k)) { autoRedraw(o, st); return null; } takeFromStow(o, k); putInHands(o, k, hands); }
  const r = fn(o);
  if (!had) { stowOne(o, k); autoRedraw(o, st); }
  syncEquip(t); return { o, r, stowed: st, drew: !had }; }
/** Runs during the turn: waits (holding) until the suspect is in view and in range; order clears at end of turn otherwise. */
function deviceTick(u, o) { const sp = S.suspect;
  if (!hostile() || !suspectActive()) { popOrder(u); return; }
  const why = deviceShotReq(u, o.type, u.x, u.y); u.holding = true;
  if (why) { if (!o.waitLog) { o.waitLog = 1; log(`${u.name}: ${o.type === 'taser' ? 'taser' : 'less-lethal'} ready — waiting for a clear line (${why.toLowerCase()}).`, 'radio'); } return; }
  const who = deviceUser(u, o.type); if (!who) { popOrder(u); log(`${u.name}: ${deviceWhyNot(u, o.type) || 'cannot deploy'}.`, 'alert'); return; }
  const d = dist(u.x, u.y, sp.x, sp.y), p = deviceChance(u, o.type, d); faceTo(u, sp.x, sp.y); popOrder(u);
  const k = o.type === 'taser' ? 'taser' : 'lesslethal', c = devCfg(o.type);
  const tr = deviceTransition(u, who, k, c.hands, q => {
    if (o.type === 'llfire') { invOf(q).ll--; }
    fx(o.type === 'taser' ? 'taser' : 'll', sp.x, sp.y, { fromX: u.x, fromY: u.y }); noise(u.x, u.y, o.type === 'taser' ? 2 : 6, 'thud');
    return S.rng.chance(p); });
  if (!tr) { log(`${u.name}: could not free the hands for the ${o.type === 'taser' ? 'taser' : 'launcher'}.`, 'alert'); return; }
  const nm = who.name || u.name;
  if (tr.stowed.length) log(`${nm}: ${tr.stowed.map(x => WEAPONS[x] ? WEAPONS[x].short.toLowerCase() : x).join(' + ')} put away for the ${o.type === 'taser' ? 'taser' : '40mm launcher'} — back in hand after, not ready until next turn.`);
  S.stats.devices = (S.stats.devices || 0) + 1;
  if (o.type === 'taser') {
    if (tr.r) { sp.stun = Math.max(sp.stun || 0, c.stunTurns * TICKS); sp.stunBy = 'taser'; sp.ambush = false; sp.walk = null; fx('text', sp.x, sp.y, { text: 'TASER', color: '#ffe060' });
      log(`${nm}: TASER, TASER — probes connected, suspect incapacitated. Move in for the arrest.`, 'good'); xpAct('bang', u.kind === 'team' ? u : null); }
    else { log(`${nm}: taser deployed — no effect (probes missed or did not connect).`, 'alert'); sp.agit = clamp((sp.agit || 0) + 10, 0, 100); aggressive(8); }
  } else {
    const left = invOf(who).ll;
    if (!tr.r) log(`${nm}: less-lethal round missed.`, 'radio');
    else if (S.rng.chance(c.noEffect)) log(`${nm}: less-lethal round struck — no visible effect.`, 'alert');
    else { sp.stun = Math.max(sp.stun || 0, S.rng.int(c.stunTurns[0], c.stunTurns[1]) * TICKS); sp.stunBy = 'll'; sp.ambush = false; sp.walk = null; fx('text', sp.x, sp.y, { text: 'LESS-LETHAL', color: '#c0a0ff' });
      log(`${nm}: less-lethal round on target — suspect incapacitated for now. Move in for the arrest.`, 'good'); xpAct('bang', u.kind === 'team' ? u : null); }
    if (left <= 0) log(`${nm}: 40mm launcher is out of rounds.`, 'radio');
    if (!tr.r || !sp.stun) { sp.agit = clamp((sp.agit || 0) + 8, 0, 100); aggressive(6); }
  }
}
