
/* =====================================================================
   COMBAT — suspect fire, officer fire, return fire
   ===================================================================== */
function shooters() { return S.units.filter(u => unitAlive(u) && (onFoot(u) || u.kind === 'drone' || u.kind === 'robot' || (u.kind === 'cruiser' && u.occ.length))); }
function suspectWindowCells() { const sp = S.suspect; const out = []; for (const w of S.windows) if (w.room === sp.room) for (const e of w.edges) if (!S.block[idx(e[0], e[1])]) out.push([e[0], e[1]]); return out; }
/** Classify a target from a firing point: open / concealed (hedge, fence — hidden, not protected) / covered (hard cover) / car / perched. */
function targetClass(u, px, py) {
  if (u.kind === 'cruiser') return 'car';
  if (sliceExposed(u, px, py) && los(px, py, u.x, u.y) !== 1) return 'slice';
  if (u.perch && u.perch.entry) return 'perched';
  if (roomAt(u.x, u.y) >= 0) return 'open';
  if (u.exiting && S.tick - u.exiting <= 1) return 'open';
  const l = losEx(px, py, u.x, u.y, true); return l.cov === 2 ? 'covered' : l.cov === 1 ? 'concealed' : 'open';
}
const T_PRIO = { slice: 1.2, open: 3, car: 2, concealed: 1.3, covered: 1, perched: 0.6 };
const T_TRY = { slice: 0.85 * 0.6, open: 0.85, car: 0.6, concealed: 0.3, covered: 0.25, perched: 0.15 }; // concealment: he can barely see you, so he fires less
/* v8: per-opportunity chance he pulls the trigger. Out of the house (window / doorway at someone outside) it is low;
   at a team inside the house with him it is high. Flashbang daze and CS gas cut both the chance and his accuracy. */
const FIRE_CFG = { outside: 0.40, indoor: 0.80, indoorAmbush: 0.92, bangDaze: 24, bangMul: 0.45, gasCut: 0.65, accBang: 0.55, accGas: 0.6 };
/** Multiplier (0..1) on his fire chance from flashbang daze (ticks left) and gas impairment (coughing, eyes streaming). */
function fireImpair() { const sp = S.suspect; return (sp.daze > 0 ? FIRE_CFG.bangMul : 1) * (1 - FIRE_CFG.gasCut * clamp(sp.impair || 0, 0, 1)); }
function accImpair() { const sp = S.suspect; return (sp.daze > 0 ? FIRE_CFG.accBang : 1) * (1 - FIRE_CFG.accGas * clamp(sp.impair || 0, 0, 1)); }
const T_HIT = { slice: 0.4, open: 1, concealed: 0.85, covered: 0.2, perched: 0.12 }; // …but rounds go through a hedge; hard cover stops them
function suspectTick() {
  const sp = S.suspect; if (!suspectActive()) return;
  if (sp.daze > 0) sp.daze--;
  if (sp.stun > 0) { sp.stun--; return; }
  if (sp.cd > 0) sp.cd--;
  if (sp.mode === 'fleeing') { fleeStep(); if (!suspectActive()) return; }
  if (sp.mode === 'surrendered' && sp.walk) { walkoutTick(); return; }
  if (!hostile()) return;
  if (sp.retreat) { retreatStep(); if (sp.room < 0 || sp.cd > 0 || !S.rng.chance(0.35)) return; }
  const R = SUSPECT_WEAPONS[sp.weapon].range;
  const backHome = () => { if (sp.x === sp.home.x && sp.y === sp.home.y) return; const p = findPath(sp.x, sp.y, (x, y) => x === sp.home.x && y === sp.home.y, { suspect: true }); if (p && p.length) { sp.x = p[0][0]; sp.y = p[0][1]; } sp.atWindow = winCellSet().has(idx(sp.x, sp.y)); };
  if (sp.suppressed > 0) { sp.suppressed--; backHome(); return; }
  if (sp.duck > 0) { sp.duck--; backHome(); return; }
  if (roomAt(sp.home.x, sp.home.y) !== sp.room && sp.room >= 0) { backHome(); sp.room = roomAt(sp.x, sp.y); return; } // relocating (e.g. away from gas)
  // best (position, target) pair: his current cell or a window of his room
  const spots = [[sp.x, sp.y]].concat(sp.room >= 0 ? suspectWindowCells() : []);
  let best = null;
  for (const u of shooters()) { for (const [px, py] of spots) { const d = dist(px, py, u.x, u.y); if (d > R) continue; const l = los(px, py, u.x, u.y) || (sliceExposed(u, px, py) ? 1 : 0); if (!l) continue; // a pie-slicing officer is partly exposed where his slice reaches
      const cls = targetClass(u, px, py); const indoorTeam = u.kind === 'team' && roomAt(u.x, u.y) >= 0;
      const s = T_PRIO[cls] - d / 40 - (px !== sp.x || py !== sp.y ? 0.35 : 0) + (indoorTeam ? 1.5 : 0) + (u.kind === 'drone' || u.kind === 'robot' ? -0.8 : 0);
      if (!best || s > best.s) best = { u, px, py, d, l, cls, s }; } }
  if (!best) { if (sp.mode === 'alert' && !sp.atWindow && S.rng.chance(0.15) && spots.length > 1) { /* peeks */ } return; }
  if (best.px !== sp.x || best.py !== sp.y) { // reposition toward the window first
    const p = findPath(sp.x, sp.y, (x, y) => x === best.px && y === best.py, { suspect: true }); if (p && p.length) { sp.x = p[0][0]; sp.y = p[0][1]; sp.atWindow = winCellSet().has(idx(sp.x, sp.y)); } return; }
  if (sp.cd > 0) return;
  const indoor = (best.u.kind === 'team' || best.u.kind === 'robot') && roomAt(best.u.x, best.u.y) >= 0;
  let tryP = indoor ? (sp.ambush ? FIRE_CFG.indoorAmbush : FIRE_CFG.indoor)
    : FIRE_CFG.outside * (T_TRY[best.cls] / T_TRY.open) * (0.75 + sp.agit / 200) * (sp.ambush ? 1.3 : 1) * (contactLive() && !sp.ambush ? NEGO_CFG.talkingFire : 1);
  tryP *= fireImpair(); best.indoor = indoor;
  if (!S.rng.chance(clamp(tryP, 0, 0.95))) return;
  suspectFire(best);
}
function suspectFire(b) {
  const sp = S.suspect, T = b.u, sw = SUSPECT_WEAPONS[sp.weapon]; if (sp.mode === 'barricaded') sp.mode = 'alert';
  sp.dir = Math.atan2(T.y - sp.y, T.x - sp.x); S.stats.shots++; sp.cd = 2 + S.rng.int(0, 1);
  fx('muzzle', sp.x, sp.y, { suspect: true }); fx('shot', sp.x, sp.y, { tx: T.x, ty: T.y });
  sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn }; S.intel.located = true; S.intel.threat = 1;
  const where = sp.room >= 0 ? (sp.atWindow ? `${S.rooms[sp.room].name} window` : S.rooms[sp.room].name) : 'yard';
  let p = sw.base * (1 - 0.6 * b.d / sw.range) * (b.l === 2 ? 0.85 : 1) * (sp.ambush ? 1.3 : 1) * accImpair() * (b.u.impair ? 1.15 : 1);
  if (T.kind === 'cruiser' && T.armored) { T.hits++; fx('impact', T.x, T.y, { car: T.uid }); log(`SHOTS FIRED from the ${where} — rounds stop against the armored ${T.name}. Crew unhurt.`, 'alert'); returnFire(); return; }
  if (T.kind === 'cruiser') { // through the car body — windshield is the weak spot
    const v = Math.atan2(sp.y - T.y, sp.x - T.x), c = Math.abs(Math.cos(v - T.dir)), glass = c > 0.7;
    p *= (glass ? 0.55 : 0.3) * (T.moved === S.tick ? 0.75 : 1); p = clamp(p, 0.02, 0.45);
    T.hits++; T.marks.push({ dx: S.rng() * 2 - 1, dy: S.rng() * 0.6 - 0.3, t: S.turn }); fx('impact', T.x, T.y, { car: T.uid });
    const hitIn = S.rng.chance(p) && T.occ.length;
    if (hitIn && unit(T.occ[0]).kind === 'team') { const tm = unit(T.occ[0]); officerDown(tm); T.orders = []; if (tm.status !== 'ok') { T.occ.shift(); tm.inCar = null; } }
    else if (hitIn) { const drv = unit(T.occ[0]); T.occ.shift(); drv.inCar = null; const ec = exitCell(T, 'safe') || [T.x, T.y]; drv.x = ec[0]; drv.y = ec[1]; officerDown(drv, `${T.name} driver down — ${drv.name} hit through the ${glass ? 'windshield' : 'door'}.`); T.orders = []; }
    else log(`SHOTS FIRED from the ${where} — rounds strike ${T.name}${glass ? ' (windshield)' : ''}. Crew unhurt.`, 'alert');
    returnFire(); return;
  }
  if (T.kind === 'drone' || T.kind === 'robot') { if (S.rng.chance(0.45)) { T.status = 'down'; T.orders = []; log(`Shots fired — ${T.name} disabled.`, 'bad'); } else log(`Shots fired at ${T.name} — missed.`, 'alert'); return; }
  p *= b.cls === 'slice' ? sliceHit(T) : T_HIT[b.cls] || 1; if (T.moved === S.tick) p *= 0.8;
  if (T.kind === 'team') { p *= 1 - teamSkill(T) * 0.25; if (T.equip.shield > 0 && roomAt(T.x, T.y) >= 0) p *= 0.65; if (T.carrying && T.equip.shield > 0) p *= CAS_CFG.carryShield; if (hasSpec(T, 'point')) p *= 0.95; }
  p = clamp(p, 0.01, 0.55);
  if (S.rng.chance(p)) officerDown(T);
  else { log(`SHOTS FIRED from the ${where} at ${T.name} (${b.cls === 'perched' ? 'on overwatch' : b.cls === 'open' ? 'in the open' : b.cls + ' cover'}) — no hits.`, 'alert');
    if (onFoot(T) && roomAt(T.x, T.y) < 0 && !T.perch && expoAt(T.x, T.y) >= 0.15) { if (T.kind === 'patrol') T.panic += 0.2; seekCover(T, 'under fire'); } }
  if (S.rng.chance(0.45)) sp.duck = 1;
  returnFire();
}
/** Officers in weapon range with a sight line shoot back at the muzzle flash. */
function returnFire() {
  const sp = S.suspect, who = [];
  for (const u of S.units) { if (!unitAlive(u) || !onFoot(u) || u.stance === 'hold' || !hostile()) continue; const wk = weaponOf(u); if (!wk) continue;
    if (u.orders[0] && u.orders[0].type === 'shoot') continue; if (dist(u.x, u.y, sp.x, sp.y) > WEAPONS[wk].range || !los(u.x, u.y, sp.x, sp.y)) continue;
    if (who.length >= 2) break; /* only the nearest couple of officers get a snap shot at the flash */
    who.push(u); if (fireAt(u, sp.x, sp.y, 'fire', true) === 'hit') return; }
  if (who.length) { log(`Return fire: ${who.map(u => u.name).join(', ')} — no hits.`, 'radio'); if (who.length >= 2) sp.suppressed = Math.max(sp.suppressed, 1); }
}
/** One officer volley at a cell. Returns 'hit' | 'miss' | 'empty'. */
function fireAt(u, tx, ty, mode, isReturn) {
  const sp = S.suspect; fx('muzzle', u.x, u.y, { friendly: true }); fx('shot', u.x, u.y, { tx, ty, friendly: true }); S.stats.ofShots = (S.stats.ofShots || 0) + 1;
  faceTo(u, tx, ty); if (!isReturn) aggressive(mode === 'suppress' ? 3 : 5); noise(tx, ty, 8, 'shot');
  if (!hostile()) return 'empty';
  const near = (sp.room >= 0 && roomAt(tx, ty) === sp.room) || dist(sp.x, sp.y, tx, ty) <= 1.5;
  if (!near || !los(u.x, u.y, sp.x, sp.y)) { if (!isReturn) log(`${u.name}: ${mode === 'suppress' ? 'suppressing fire' : 'rounds'} on target — no contact.`); return 'empty'; }
  let p = hitChance(u, sp.x, sp.y, null, { flash: isReturn }).p; if (mode === 'suppress') { p *= 0.5; sp.suppressed = Math.max(sp.suppressed, 2); }
  if (S.rng.chance(p)) { suspectHit(u); return 'hit'; }
  if (!isReturn) log(`${u.name}: ${mode === 'suppress' ? 'suppressing fire — suspect pinned down' : 'shot missed'}.`, 'radio');
  return 'miss';
}
function suspectHit(u) { const sp = S.suspect; sp.stun = 0; sp.downBy = 'fire'; fx('hitflash', sp.x, sp.y);
  const prev = S.cas.find(c => c.who === 'suspect' && casActive(c));
  const c = prev ? (prev.state = 'immobile', prev.crit = Math.min(prev.crit, S.rng.int(2, 4)), prev) : addCasualty('suspect', 'S', 'Suspect', sp.x, sp.y, { kia: CAS_CFG.suspectKia, mobile: CAS_CFG.suspectMobile, by: u.uid });
  c.x = sp.x; c.y = sp.y; c.seen = true; c.known = true;
  if (c.state === 'mobile') { sp.impair = Math.max(sp.impair || 0, 0.45); sp.duck = 2; sp.injured = true; aggressive(6);
    fx('text', sp.x, sp.y, { text: 'SUSPECT HIT', color: '#ffb020' }); log(`${u.name}: suspect HIT — he is still moving and still armed. Injured.`, 'alert'); return; }
  sp.mode = 'incapacitated'; sp.walk = null; S.stats.method = 'Officer fire'; sp.injured = true;
  if (c.state === 'kia') { sp.deceased = true; fx('text', sp.x, sp.y, { text: 'SUSPECT DOWN', color: '#c9ced6' }); log(`${u.name}: suspect hit — he is not moving. Move in and secure the scene.`, 'good'); return; }
  fx('text', sp.x, sp.y, { text: 'SUSPECT DOWN', color: '#ffb020' }); log(`${u.name}: suspect HIT — immobile, weapon out of reach. Move in, secure him, get EMS.`, 'good'); }
/** Stance 'free': fire at a visible suspect every 3rd tick. */
function officersFire() {
  const sp = S.suspect; if (!hostile() || !sp.visible || S.tick % 3 !== 0) return;
  for (const u of S.units) { if (!onFoot(u) || u.stance !== 'free' || (u.orders[0] && u.orders[0].type === 'shoot')) continue; const wk = weaponOf(u); if (!wk) continue;
    if (dist(u.x, u.y, sp.x, sp.y) > WEAPONS[wk].range || !los(u.x, u.y, sp.x, sp.y)) continue; if (fireAt(u, sp.x, sp.y, 'fire') === 'hit') return; }
}
/** An officer is hit: becomes a casualty (KIA / injured-mobile / immobile). stats.down counts officers out of the fight unless a medic stabilised them on the spot. */
function officerDown(u, msg, ctx) {
  fx('down', u.x, u.y);
  if (u.kind === 'patrol') { u.status = 'down'; u.orders = []; u.carrying && dropCas(u, casById(u.carrying)); u.inCar = null; S.stats.down++;
    const c = addCasualty('patrol', u.uid, u.name, u.x, u.y, {}); u.cas = c.id; S.downList.push({ x: c.x, y: c.y, name: u.name, cas: c.id });
    log(msg ? `${msg} ${casTail(c)}` : `OFFICER DOWN — ${casReport(c, 'patrol')}`, 'bad'); return c; }
  const ok = teamOk(u); if (!ok.length) return; const prio = ok.find(o => o.spec === 'point') || S.rng.pick(ok);
  prio.status = 'down';
  const c = addCasualty('officer', prio.id, prio.name, u.x, u.y, { team: u.uid, witness: true }); prio.cas = c.id;
  if (u.carrying) dropCas(u, casById(u.carrying));
  const med = teamOk(u).length && hasSpec(u, 'medic');
  if (med && casActive(c)) applyAid(u, c, true);
  if (c.stable) { prio.stable = true; log(`OFFICER DOWN — ${prio.name} (${u.name}) hit. Medic stabilised on the spot — needs extraction.`, 'bad'); }
  else { S.stats.down++; log(`OFFICER DOWN — ${casReport(c, u.name)}`, 'bad'); }
  S.downList.push({ x: c.x, y: c.y, name: prio.name, cas: c.id });
  if (!teamOk(u).length) { u.status = 'down'; u.orders = []; log(`${u.name} is out of action.`, 'bad'); }
  return c;
}
