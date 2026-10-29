
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
  const l = losEx(px, py, u.x, u.y, true), cv = l.cov - (u.installing ? 1 : 0); // busy installing the Draco arm: working in the open, one cover step worse
  return cv >= 2 ? 'covered' : cv === 1 ? 'concealed' : 'open';
}
const T_PRIO = { slice: 1.2, open: 3, car: 2, concealed: 1.3, covered: 1, perched: 0.6 };
const T_TRY = { slice: 0.85 * 0.6, open: 0.85, car: 0.6, concealed: 0.3, covered: 0.25, perched: 0.15 }; // concealment: he can barely see you, so he fires less
/* v8: per-opportunity chance he pulls the trigger. Out of the house (window / doorway at someone outside) it is low;
   at a team inside the house with him it is high. Flashbang daze and CS gas cut both the chance and his accuracy. */
const FIRE_CFG = { outside: 0.40, indoor: 0.80, indoorAmbush: 0.92, bangDaze: 24, bangMul: 0.45, gasCut: 0.65, accBang: 0.55, accGas: 0.6 };
/** Multiplier (0..1) on his fire chance from flashbang daze (ticks left) and gas impairment (coughing, eyes streaming). */
function fireImpair() { const sp = S.suspect; return (sp.daze > 0 ? FIRE_CFG.bangMul : 1) * (1 - FIRE_CFG.gasCut * clamp(sp.impair || 0, 0, 1)); }
function accImpair() { const sp = S.suspect; return (sp.daze > 0 ? FIRE_CFG.accBang : 1) * (1 - FIRE_CFG.accGas * clamp(sp.impair || 0, 0, 1)); }
/* v9 shootout: one PRIMARY target per turn (the nearest officer he can see); other members of that team take rounds only after
   the primary goes down (spillover chance per round, capped). The nearest officers with a clear line and a READY weapon fire back:
   at most MAX_RETURN_FIRE of them. */
const SHOOT_CFG = { maxReturn: 3, spill: 0.3, spillMax: 2, droneDist: 6, repoDist: 0.35 };
const MAX_RETURN_FIRE = SHOOT_CFG.maxReturn;
function primaryOf() { const sp = S.suspect; return sp.tgt && sp.tgt.turn === S.turn ? sp.tgt : null; }
/** Is the primary officer of this turn still standing? */
function primaryUp(tg) { const T = unit(tg.uid); if (!T || !unitAlive(T)) return false; if (T.kind !== 'team' || !tg.off) return true; return teamOk(T).some(o => o.id === tg.off); }
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
  const spots = [[sp.x, sp.y]].concat(sp.room >= 0 && !(sp.disp === 'hiding' && sp.agit < 75 && !sp.atWindow) ? suspectWindowCells().filter(([x, y]) => !suspList().some(o => o !== sp && spActive(o) && o.x === x && o.y === y)) : []);
  let best = null;
  const tg = primaryOf(); let pool = shooters();
  if (tg) { const T = unit(tg.uid); const up = primaryUp(tg); pool = pool.filter(u => u.uid === tg.uid && (up || (u.kind === 'team' && (tg.spill || 0) < SHOOT_CFG.spillMax))); } // no retarget until next turn
  for (const u of pool) { for (const [px, py] of spots) { const d = dist(px, py, u.x, u.y); if (d > R) continue; const l = los(px, py, u.x, u.y) || (sliceExposed(u, px, py) ? 1 : 0); if (!l) continue; // a pie-slicing officer is partly exposed where his slice reaches
      const cls = targetClass(u, px, py); const indoorTeam = u.kind === 'team' && roomAt(u.x, u.y) >= 0;
      const s = -d - (px !== sp.x || py !== sp.y ? SHOOT_CFG.repoDist : 0) - (u.kind === 'drone' || u.kind === 'robot' ? SHOOT_CFG.droneDist : 0) + T_PRIO[cls] * 0.01 + (indoorTeam ? 0.01 : 0); // nearest officer he can see
      if (!best || s > best.s) best = { u, px, py, d, l, cls, s }; } }
  if (!best) { if (sp.mode === 'alert' && !sp.atWindow && S.rng.chance(0.15) && spots.length > 1) { /* peeks */ } return; }
  if (best.px !== sp.x || best.py !== sp.y) { // reposition toward the window first
    const p = findPath(sp.x, sp.y, (x, y) => x === best.px && y === best.py, { suspect: true }); if (p && p.length) { sp.x = p[0][0]; sp.y = p[0][1]; sp.atWindow = winCellSet().has(idx(sp.x, sp.y)); } return; }
  if (sp.cd > 0) return;
  const indoor = (best.u.kind === 'team' || best.u.kind === 'robot') && roomAt(best.u.x, best.u.y) >= 0;
  let tryP = indoor ? (sp.ambush ? FIRE_CFG.indoorAmbush : FIRE_CFG.indoor)
    : FIRE_CFG.outside * (T_TRY[best.cls] / T_TRY.open) * (0.75 + sp.agit / 200) * (sp.ambush ? 1.3 : 1) * (contactLive() && !sp.ambush ? NEGO_CFG.talkingFire : 1);
  tryP *= fireImpair() * typeFireMul(best.u) * (sp.disp === 'hiding' ? MULTI_CFG.hideFire : sp.disp === 'fighting' ? MULTI_CFG.fightFire : 1); best.indoor = indoor;
  if (!S.rng.chance(clamp(tryP, 0, 0.95))) return;
  suspectFire(best);
}
function suspectFireBase(b) {
  const sp = S.suspect, T = b.u, sw = SUSPECT_WEAPONS[sp.weapon]; if (sp.mode === 'barricaded') sp.mode = 'alert';
  if (!primaryOf() && T.kind !== 'team' && T.kind !== 'patrol') sp.tgt = { uid: T.uid, off: null, turn: S.turn, spill: 0 };
  sp.dir = Math.atan2(T.y - sp.y, T.x - sp.x); S.stats.shots++; sp.firedAt = S.turn; sp.firedTick = S.turn * 100 + (S.tick || 0); sp.armedKnown = true; sp.cd = 2 + S.rng.int(0, 1);
  fx('muzzle', sp.x, sp.y, { suspect: true }); fx('shot', sp.x, sp.y, { tx: T.x, ty: T.y });
  sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn }; S.intel.located = true; S.intel.threat = 1;
  const where = sp.room >= 0 ? (sp.atWindow ? `${S.rooms[sp.room].name} window` : S.rooms[sp.room].name) : 'yard';
  let p = sw.base * (1 - 0.6 * b.d / sw.range) * (b.l === 2 ? 0.85 : 1) * (sp.ambush ? 1.3 : 1) * accImpair() * (b.u.impair ? 1.15 : 1) * autoAcc(sp.weapon, b.d);
  if (T.kind === 'cruiser' && T.armored) { T.hits++; fx('impact', T.x, T.y, { car: T.uid }); log(`SHOTS FIRED from the ${where} — rounds stop against the armored ${T.name}. Crew unhurt.`, 'alert'); returnFire(); return; }
  if (T.kind === 'cruiser') { // through the car body — windshield is the weak spot
    const v = Math.atan2(sp.y - T.y, sp.x - T.x), c = Math.abs(Math.cos(v - T.dir)), glass = c > 0.7;
    p *= (glass ? 0.55 : 0.3) * (T.moved === S.tick ? 0.75 : 1); p = clamp(p, 0.02, 0.45);
    T.hits++; T.marks.push({ dx: S.rng() * 2 - 1, dy: S.rng() * 0.6 - 0.3, t: S.turn }); fx('impact', T.x, T.y, { car: T.uid });
    const hitIn = S.rng.chance(p) && T.occ.length;
    const cal = SUSPECT_CAL[sp.weapon] || 'pistol';
    if (hitIn && unit(T.occ[0]).kind === 'team') { const tm = unit(T.occ[0]); const a = shotOfficer(tm, cal, b.d, undefined, undefined, where, { noShield: true }); if (a && a.res !== 'pen' && a.res !== 'blunt') { returnFire(); return; } T.orders = []; if (tm.status !== 'ok') { T.occ.shift(); tm.inCar = null; } }
    else if (hitIn && armorHit(unit(T.occ[0]), null, cal, b.d).res !== 'pen') { S.stats.armorStops = (S.stats.armorStops || 0) + 1; log(`SHOTS FIRED from the ${where} — a round through ${T.name}'s door hits ${unit(T.occ[0]).name} in the vest. The IIIA armor stopped it — unhurt.`, 'alert'); }
    else if (hitIn) { const drv = unit(T.occ[0]); T.occ.shift(); drv.inCar = null; const ec = exitCell(T, 'safe') || [T.x, T.y]; drv.x = ec[0]; drv.y = ec[1]; officerDown(drv, `${T.name} driver down — ${drv.name} hit through the ${glass ? 'windshield' : 'door'}.`); T.orders = []; }
    else log(`SHOTS FIRED from the ${where} — rounds strike ${T.name}${glass ? ' (windshield)' : ''}. Crew unhurt.`, 'alert');
    returnFire(); return;
  }
  if (T.kind === 'drone' || T.kind === 'robot') { if (S.rng.chance(deviceHitP(T, p))) { T.status = 'down'; T.orders = []; log(`Shots fired — ${T.name} disabled.`, 'bad'); } else log(`Shots fired at ${T.name} — missed.`, 'alert'); return; }
  let tg = primaryOf(), victim = null, spillShot = false;
  if (!tg) { const off = T.kind === 'team' ? pickVictim(T, sp.x, sp.y) : null; tg = sp.tgt = { uid: T.uid, off: off ? off.id : null, turn: S.turn, spill: 0 };
    log(`Suspect opens fire at ${off ? off.name + ' (' + T.name + ')' : T.name}.`, 'alert'); }
  if (T.kind === 'team' && los(sp.x, sp.y, T.x, T.y) === 1) encNoteFire(T, where);
  if (T.kind === 'team') { const m = teamOk(T); victim = m.find(o => o.id === tg.off) || null;
    if (!victim) { spillShot = true; tg.spill = (tg.spill || 0) + 1; const pool2 = doorExposed(T, sp.x, sp.y) || m; victim = pool2.length && S.rng.chance(SHOOT_CFG.spill) ? S.rng.pick(pool2) : null; } }
  p *= b.cls === 'slice' ? sliceHit(T) : T_HIT[b.cls] || 1; if (T.moved === S.tick) p *= 0.8;
  if (spillShot && !victim) p = 0;
  if (T.kind === 'team') { p *= 1 - teamSkill(T) * 0.25; if (T.carrying && hasShield(T)) p *= CAS_CFG.carryShield; if (hasSpec(T, 'point')) p *= 1 - 0.05 * teamSpecMul(T, 'point'); }
  p = clamp(p, 0.01, 0.55);
  if (S.rng.chance(p)) { const a = shotOfficer(T, SUSPECT_CAL[sp.weapon] || 'pistol', b.d, sp.x, sp.y, where, victim ? { victim } : null); if (a && a.res !== 'pen' && onFoot(T) && roomAt(T.x, T.y) < 0 && !T.perch && expoAt(T.x, T.y) >= 0.15) seekCover(T, 'under fire'); }
  else { log(`SHOTS FIRED from the ${where} at ${T.name} (${b.cls === 'perched' ? 'on overwatch' : b.cls === 'open' ? 'in the open' : b.cls + ' cover'}) — no hits.`, 'alert');
    if (onFoot(T) && roomAt(T.x, T.y) < 0 && !T.perch && expoAt(T.x, T.y) >= 0.15) { if (T.kind === 'patrol') T.panic += 0.2; seekCover(T, 'under fire'); } }
  if (S.rng.chance(0.45)) sp.duck = 1;
  returnFire();
}
/** READY weapon an individual officer has in hand (team member) — null if none / not ready. */
function memberWeapon(o) { for (const k of heldList(o)) { if (!WEAPONS[k] || !(ITEM_CFG[k] || {}).weapon || !isReady(o, k)) continue; if (k === 'sniper' && !twoHanded(o, k)) continue; return k; } return null; }
/** Officers who would return fire: nearest first, clear line, ready weapon in range, not holding fire / busy / dazed. At most MAX_RETURN_FIRE. */
function returnFirers() { const sp = S.suspect, c = [];
  for (const u of S.units) { if (!unitAlive(u) || !onFoot(u) || u.stance === 'hold' || u.installing || u.stun > 0) continue; if (u.orders[0] && u.orders[0].type === 'shoot') continue;
    const d = dist(u.x, u.y, sp.x, sp.y); if (los(u.x, u.y, sp.x, sp.y) !== 1) continue;
    if (u.kind === 'patrol') { const wk = u.weapon; if (wk && WEAPONS[wk] && d <= WEAPONS[wk].range) c.push({ u, o: u, name: u.name, d, i: 0 }); continue; }
    if (u.kind === 'team') teamOk(u).forEach((o, i) => { const wk = memberWeapon(o); if (wk && d <= WEAPONS[wk].range) c.push({ u, o, name: o.name, d, i }); }); }
  return c.sort((a, b) => a.d - b.d || a.i - b.i).slice(0, SHOOT_CFG.maxReturn); }
/** The nearest officers with a sight line shoot back at the muzzle flash (max 3); the log lists who fired and the result. */
function returnFire() {
  const sp = S.suspect; if (!hostile() || S.encNoRet) return; const who = returnFirers(); if (!who.length) return; let res = 'no hits';
  for (const f of who) { if (!hostile()) break; const r = fireAt(f.u, sp.x, sp.y, 'fire', true); if (r === 'hit') { res = `${f.name} hit ${multiSp() ? spName().toLowerCase() : 'the suspect'}`; break; } if (r === 'stopped') res = `${f.name}'s round was stopped by body armor`; }
  S.stats.returnVolleys = (S.stats.returnVolleys || 0) + 1; S.lastReturn = who.map(f => f.o.id || f.u.uid);
  log(`Return fire: ${who.map(f => f.name).join(', ')} — ${res}.`, 'radio'); if (who.length >= 2 && hostile()) sp.suppressed = Math.max(sp.suppressed, 1);
}
/** One officer volley at a cell. Returns 'hit' | 'miss' | 'empty'. */
function fireAtBase(u, tx, ty, mode, isReturn) { return withSp(suspectFor(tx, ty, u.x, u.y), () => fireAt1(u, tx, ty, mode, isReturn)); }
function fireAt1(u, tx, ty, mode, isReturn) {
  const sp = S.suspect; fx('muzzle', u.x, u.y, { friendly: true }); fx('shot', u.x, u.y, { tx, ty, friendly: true }); S.stats.ofShots = (S.stats.ofShots || 0) + 1;
  faceTo(u, tx, ty); if (!isReturn) aggressive(mode === 'suppress' ? 3 : 5); noise(tx, ty, 8, 'shot');
  if (!hostile()) return 'empty';
  const near = (sp.room >= 0 && roomAt(tx, ty) === sp.room) || dist(sp.x, sp.y, tx, ty) <= 1.5;
  if (!near || !los(u.x, u.y, sp.x, sp.y)) { if (!isReturn) log(`${u.name}: ${mode === 'suppress' ? 'suppressing fire' : 'rounds'} on target — no contact.`); return 'empty'; }
  let p = hitChance(u, sp.x, sp.y, null, { flash: isReturn }).p; if (mode === 'suppress') { p *= 0.5; sp.suppressed = Math.max(sp.suppressed, 2); }
  if (S.rng.chance(p)) return suspectHit(u) === false ? 'stopped' : 'hit';
  if (!isReturn) log(`${u.name}: ${mode === 'suppress' ? 'suppressing fire — suspect pinned down' : 'shot missed'}.`, 'radio');
  return 'miss';
}
function suspectHit(u) { const sp = S.suspect;
  if (suspectArmorStops(weaponOf(u) || 'pistol')) { fx('text', sp.x, sp.y, { text: 'ARMOR', color: '#ffd080' }); S.stats.susArmorStops = (S.stats.susArmorStops || 0) + 1;
    log(`${u.name}: hit on the suspect's torso.`, 'radio'); revealSuspectArmor('stop'); sp.duck = Math.max(sp.duck || 0, 1); aggressive(3); return false; }
  sp.stun = 0; sp.downBy = 'fire'; fx('hitflash', sp.x, sp.y);
  const key = sp.key || 'S', prev = S.cas.find(c => c.who === 'suspect' && casActive(c) && (c.ref || 'S') === key);
  const c = prev ? (prev.state = 'immobile', prev.crit = Math.min(prev.crit, S.rng.int(2, 4)), prev) : addCasualty('suspect', key, spName(), sp.x, sp.y, { kia: CAS_CFG.suspectKia, mobile: CAS_CFG.suspectMobile, by: u.uid });
  c.x = sp.x; c.y = sp.y; c.seen = true; c.known = true;
  if (c.state === 'mobile') { sp.impair = Math.max(sp.impair || 0, 0.45); sp.duck = 2; sp.injured = true; sp.injuryText = injWhere(sp, 'mobile'); aggressive(6);
    fx('text', sp.x, sp.y, { text: 'SUSPECT HIT', color: '#ffb020' }); log(`${u.name}: ${multiSp() ? spName().toLowerCase() : 'suspect'} HIT — still moving and still armed. Injured (${sp.injuryText}).`, 'alert'); return; }
  sp.mode = 'incapacitated'; sp.walk = null; S.stats.method = 'Officer fire'; sp.method = sp.method || 'Officer fire'; sp.injured = true; sp.injuryText = injWhere(sp, c.state);
  if (c.state === 'kia') { sp.deceased = true; fx('text', sp.x, sp.y, { text: 'SUSPECT DOWN', color: '#c9ced6' }); log(`${u.name}: ${multiSp() ? spName().toLowerCase() : 'suspect'} hit — not moving. Move in and secure the scene.`, 'good'); return; }
  fx('text', sp.x, sp.y, { text: 'SUSPECT DOWN', color: '#ffb020' }); log(`${u.name}: ${multiSp() ? spName().toLowerCase() : 'suspect'} HIT — immobile, weapon out of reach. Move in, secure ${multiSp() ? 'the suspect' : 'him'}, get EMS.`, 'good'); }
/** Stance 'free': fire at a visible suspect every 3rd tick. */
function officersFire() { if (S.tick % 3 !== 0) return; const done = new Set(); // each officer engages the nearest visible hostile suspect; a suspect hit this tick is not engaged again
  for (const u of S.units) { if (!onFoot(u) || u.stance !== 'free' || u.installing || (u.orders[0] && u.orders[0].type === 'shoot')) continue; const wk = weaponOf(u); if (!wk) continue;
    const c = suspList().filter(sp => !done.has(sp) && spHostile(sp) && sp.visible && dist(u.x, u.y, sp.x, sp.y) <= WEAPONS[wk].range && los(u.x, u.y, sp.x, sp.y)).sort((a, b) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y));
    if (!c.length) continue; const sp = c[0]; if (fireAt(u, sp.x, sp.y, 'fire') === 'hit') { done.add(sp); if (!suspList().some(s => !done.has(s) && spHostile(s))) return; } }
}
/** An officer is hit: becomes a casualty (KIA / injured-mobile / immobile). stats.down counts officers out of the fight unless a medic stabilised them on the spot. */
function bluntMsg(nm, ctx, c, cal) { return `${nm} (${ctx}) hit in the vest at close range — the armor stopped the ${cal === 'shotgun' ? 'shotgun load' : 'round'}, but the impact causes a minor blunt-trauma injury. Mobile, leaving the line for EMS.`; }
function officerDownBase(u, msg, ctx) {
  fx('down', u.x, u.y);
  const minor = !!(ctx && ctx.minor), mo = minor ? { minor: true } : {};
  if (u.kind === 'patrol') { u.status = 'down'; u.orders = []; u.carrying && dropCas(u, casById(u.carrying)); u.inCar = null; if (!minor) S.stats.down++;
    const c = addCasualty('patrol', u.uid, u.name, u.x, u.y, mo); u.cas = c.id; S.downList.push({ x: c.x, y: c.y, name: u.name, cas: c.id });
    log(minor ? bluntMsg(u.name, 'patrol', c, ctx.cal) : msg ? `${msg} ${casTail(c)}` : `OFFICER DOWN — ${casReport(c, 'patrol')}`, minor ? 'alert' : 'bad'); return c; }
  const ok = teamOk(u); if (!ok.length) return; const prio = ctx && ctx.victim && ok.includes(ctx.victim) ? ctx.victim : ok.find(o => o.spec === 'point') || S.rng.pick(ok);
  prio.status = 'down';
  const c = addCasualty('officer', prio.id, prio.name, u.x, u.y, Object.assign({ team: u.uid, witness: true }, mo)); prio.cas = c.id;
  if (u.carrying) dropCas(u, casById(u.carrying));
  const med = teamOk(u).length && hasSpec(u, 'medic');
  if (med && casActive(c)) applyAid(u, c, true);
  if (minor) log(bluntMsg(prio.name, u.name, c, ctx.cal), 'alert');
  else if (c.stable) { prio.stable = true; log(`OFFICER DOWN — ${prio.name} (${u.name}) hit. Medic stabilised on the spot — needs extraction.`, 'bad'); }
  else { S.stats.down++; log(`OFFICER DOWN — ${casReport(c, u.name)}`, 'bad'); }
  S.downList.push({ x: c.x, y: c.y, name: prio.name, cas: c.id });
  if (!teamOk(u).length) { u.status = 'down'; u.orders = []; log(`${u.name} is out of action.`, 'bad'); }
  return c;
}
