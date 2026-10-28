/* ---------- team management (planning phase only) ---------- */
const nearStaging = (x, y) => atEquipment(x, y);
function stagePos(stage) { return stage === 'secondary' && S.ext.staging2 ? S.ext.staging2 : S.ext.staging; }
/** Form a team from officers waiting at ONE staging area. opts.point / opts.defense pick the point and his defense (cover) man;
    `ids` order is the stack order (formation slots follow it). Teams formed at the equipment vehicle get a default kit from the pool. */
function formTeam(ids, opts) {
  opts = opts || {};
  if (S.phase !== 'planning') return { ok: false, reason: 'Busy' };
  if (!ids) { const free = S.officers.filter(o => o.status === 'staged' && !o.team); const pri = free.filter(o => (o.stage || 'primary') === 'primary'); ids = (pri.length ? pri : free).map(o => o.id); }
  ids = ids.filter((id, i) => ids.indexOf(id) === i && off(id) && off(id).status === 'staged' && !off(id).team);
  if (opts.point && ids.includes(opts.point)) ids = [opts.point].concat(ids.filter(i => i !== opts.point));
  if (opts.defense && ids.includes(opts.defense) && opts.defense !== ids[0]) ids = [ids[0], opts.defense].concat(ids.slice(1).filter(i => i !== opts.defense));
  ids = ids.slice(0, S.teamMax || 5);
  if (!ids.length) return { ok: false, reason: 'No unassigned officers at staging' };
  const stage = off(ids[0]).stage || 'primary'; if (ids.some(id => (off(id).stage || 'primary') !== stage)) return { ok: false, reason: 'Officers must be at the same staging area to form a team' };
  const n = ++S.teamSeq; const st = stagePos(stage);
  const t = { uid: 'T' + n, kind: 'team', name: TEAM_NAMES[(n - 1) % TEAM_NAMES.length], num: n, members: [], x: st.x + ((n - 1) % 3) - 1, y: st.y - 1 - Math.floor((n - 1) / 3), dir: -Math.PI / 2, equip: {}, orders: [], status: 'ok', vis: [], deployed: true, detain: false, stance: 'return', perch: null, mask: 'off', impair: 0, stun: 0 };
  if (!inb(t.x, t.y) || S.block[idx(t.x, t.y)] || roomAt(t.x, t.y) >= 0) { t.x = st.x; t.y = st.y; }
  for (const k in EQUIP) t.equip[k] = 0;
  S.units.push(t); ids.forEach(id => assign(id, t.uid));
  t.point = t.members[0] || null; t.defense = t.members[1] || null;
  if (stage === 'primary' && opts.kit !== false) defaultKit(t); else syncEquip(t);
  log(`${t.name} team formed (${t.members.length} officers) at ${stage === 'primary' ? 'primary staging (equipment vehicle)' : 'secondary staging — no equipment drawn yet'}. Point: ${off(t.members[0]).name}${t.defense ? ', defense: ' + off(t.defense).name : ''}.`, 'system'); S.version++; return { ok: true, team: t };
}
/** Re-order a team's stack: ids is the new member order (point first, then his defense man, then the rest). */
function setTeamOrder(uid, ids) { const t = unit(uid); if (!t || t.kind !== 'team') return { ok: false, reason: 'No team' };
  if (S.phase !== 'planning') return { ok: false, reason: 'Busy' };
  if (!ids || ids.length !== t.members.length || ids.some(id => !t.members.includes(id))) return { ok: false, reason: 'Order must list every member once' };
  t.members = ids.slice(); t.point = ids[0]; t.defense = ids[1] || null; S.version++; return { ok: true }; }
function assign(offId, teamUid) {
  const o = off(offId); if (!o || o.status !== 'staged' && o.status !== 'ok') return { ok: false, reason: 'Officer unavailable' };
  const from = o.team ? unit(o.team) : null, to = teamUid ? unit(teamUid) : null;
  const pos = from ? from : stagePos(o.stage); let tpos = to ? to : stagePos(o.stage);
  if (!to && from) { const near = ['primary', 'secondary'].find(sg => S.ext[sg === 'primary' ? 'staging' : 'staging2'] && dist(from.x, from.y, stagePos(sg).x, stagePos(sg).y) <= 3.5); if (!near) return { ok: false, reason: 'Officers can only leave a team at a staging area' }; o.stage = near; tpos = stagePos(near); }
  if (dist(pos.x, pos.y, tpos.x, tpos.y) > 3.5) return { ok: false, reason: 'Units must be together (within 3 m) to swap members' };
  if (from) from.members = from.members.filter(id => id !== offId);
  o.team = to ? to.uid : null; o.status = to ? 'ok' : 'staged'; if (to) to.members.push(offId);
  if (from && !from.members.length) S.units = S.units.filter(u => u !== from); // gear stays with each officer
  if (from) { from.point = from.members[0] || null; from.defense = from.members[1] || null; syncEquip(from); } if (to) syncEquip(to);
  S.version++; return { ok: true };
}
/** Compatibility: team-level ± at the equipment vehicle, routed to the member best placed to carry it. */
function equip(teamUid, item, delta) {
  const t = unit(teamUid); if (!t) return { ok: false };
  if (!atEquipment(t.x, t.y)) return { ok: false, reason: 'Team must be at the equipment vehicle (primary staging) to draw or return equipment' };
  const m = teamOk(t); if (delta < 0) { const o = m.slice().reverse().find(q => countOf(q, item) > 0); if (!o) return { ok: false, reason: 'None to return' }; return invAct(o.id, 'return', item); }
  if (!(S.armory[item] > 0)) return { ok: false, reason: 'None left in armory' };
  let last = { ok: false, reason: 'Nobody can carry it' }; const c = ITEM_CFG[item] || {};
  const pref = m.slice().sort((a, b) => (c.spec ? (b.spec === c.spec) - (a.spec === c.spec) : 0) + (c.qual ? ((b.quals || []).includes(c.qual) - (a.quals || []).includes(c.qual)) : 0) || freeHands(b) - freeHands(a));
  for (const o of pref) { last = invAct(o.id, 'draw', item); if (last.ok) return Object.assign({ by: o.id }, last); } return last;
}
function renameTeam(uid, name) { const t = unit(uid); if (t && name && name.trim()) { t.name = name.trim().slice(0, 14); S.version++; } }

/* ---------- derived info for HUD ---------- */
function intelInfo() {
  const OR = ownRooms(), known = OR.filter(q => q.known).length, exp = OR.filter(q => q.explored).length, sp = S.suspect;
  const lvl = Math.round(100 * (0.55 * known / OR.length + 0.15 * (S.intel.threat ? 1 : 0) + 0.15 * (S.intel.floors ? 1 : 0) + 0.15 * (sp.seen || S.intel.located ? 1 : 0)));
  const CI = suspectCountInfo(), flee = multiType(), vis = suspList().filter(s => s.visible && spActive(s));
  let threat = 'UNKNOWN'; if (S.intel.threat) threat = !flee ? (sp.weapon === 'none' && S.intel.weapon ? '1 SUSPECT — NO FIREARM' : '1 ARMED SUSPECT') : CI.confirmed ? `${CI.total} ARMED SUSPECT${CI.total > 1 ? 'S' : ''}` : 'ARMED — COUNT UNCONFIRMED';
  if (flee && vis.length > 1) threat = `VISUAL — ${vis.length} SUSPECTS`; else if (sp.visible) threat = 'VISUAL — ' + (S.rooms[sp.room] ? S.rooms[sp.room].name.toUpperCase() : 'YARD'); else if (sp.heat) threat = 'LOCATED (THERMAL/K9)';
  const status = { barricaded: 'BARRICADED', alert: 'ALERTED', fleeing: 'FLEEING', surrendered: 'SURRENDERED', incapacitated: 'INCAPACITATED', detained: 'IN CUSTODY', escaped: 'ESCAPED' }[sp.mode];
  return { arch: S.intel.floors ? S.house.archName : 'UNKNOWN', weapon: S.intel.weapon ? SUSPECT_WEAPONS[sp.weapon].name : 'UNKNOWN', floors: S.intel.floors ? '1 (single storey)' : 'UNKNOWN', roomsKnown: known, roomsTotal: S.intel.floors ? OR.length : '?', explored: exp, level: clamp(lvl, 0, 100), threat,
    suspect: (sp.seen || S.intel.threat || !hostile()) ? status : 'UNKNOWN', contain: S.contain.filter(c => c.covered).length, containTotal: S.contain.length, containKnown: !!S.intel.status, sides: (() => { const w = sideWatch(); return { n: w.watched.length, of: w.all.length, gaps: w.gaps }; })(), down: S.stats.down, downMax: LOSE_DOWN, talk: Math.round(sp.talk), phone: !!S.nego.contact, mood: moodWord(), rapport: rapportWord(),
    cas: S.cas.filter(c => casActive(c) && c.known && c.who !== 'suspect').length,
    count: CI, multiType: !!flee, suspects: suspList().filter(s => s.seen || S.phase === 'over').map(s => ({ key: s.key, name: spName(s), state: spState(s), visible: !!s.visible, weapon: s.seen ? SUSPECT_WEAPONS[s.weapon].name : '?', armor: s.armorKnown ? s.armor : null })) };
}

function newGame(seed, opts) {
  seed = (seed >>> 0) % 1000000 || 1;
  const N = MAP_W * MAP_H;
  for (let attempt = 0; attempt < 12; attempt++) {
    const r = makeRng(seed * 31 + attempt * 7919 + 1);
    S = { seed, attempt, rng: r, turn: 0, tick: 0, phase: 'planning', log: [], events: [], fx: [], fxSeq: 0, version: 1,
      room: new Int16Array(N).fill(-1), block: new Uint8Array(N), vis: new Uint8Array(N), opaque: new Uint8Array(N), cov: new Uint8Array(N), covLbl: new Uint8Array(N), paved: new Uint8Array(N),
      dyn: new Uint8Array(N), gas: new Float32Array(N), gasSeen: new Float32Array(N), gasActive: false, gasEver: false, wind: [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }][((seed * 2654435761) >>> 0) % 4], drive: null, expo: null, edges: new Map(), peek: [], units: [], contain: [], perches: [],
      intel: { interview: false, blueprint: 0, flybyReady: 0, floors: false, threat: 0, located: false, weapon: false }, cmd: null, stats: { down: 0, breaches: 0, shots: 0, ofShots: 0, method: '', kia: 0, lost: 0, evac: 0 }, downList: [], cas: [], casSeq: 0, surrSpot: null,
      opName: 'OPERATION ' + OPS[seed % OPS.length], opts: opts || {} };
    genGeo(r);
    genHouse(r, S.geo.target, S.geo.SW - r.int(7, 9));
    const he = validateHouse(); if (he.length) { S.genErrors = he; continue; }
    genFurniture(r); genNeighborhood(r); buildDriveMask();
    const we = validateWorld(); if (we.length) { S.genErrors = we; continue; }
    setupUnits(r); setupSuspect(r); S.genErrors = []; genContain(r); computeExpo(true); setupScene(r); coverStartPatrols(); genPerches();
    const ce = S.genErrors.concat(validateWorld()); if (ce.length) { S.genErrors = ce; continue; }
    break;
  }
  if (S.genErrors.length) { console.warn("generation fallback", S.genErrors); }
  if (!S.officers) { throw new Error("generation failed: " + JSON.stringify(S.genErrors)); }
  if (S.opts.armored) { // career unlock: armored rescue vehicle, parked empty at staging
    const X = S.ext; let best = null; for (let d = 7; d < 22 && !best; d++) for (const dx of [-d, d]) { const x = X.staging.x + dx, y = S.geo.ST + 4; if (S.drive[idx(x, y)] && !carClash(x, y, null)) { best = [x, y]; break; } }
    if (best) { S.units.push({ uid: 'C4', kind: 'cruiser', name: 'BearCat', num: 4, x: best[0], y: best[1], dir: 0, occ: [], orders: [], status: 'ok', hits: 0, marks: [], vis: [], disabled: false, armored: true }); rebuildDyn(); } }
  S.stype = typeForSeed(seed, S.opts.stype); applyScenType();
  setupSuspects(); applyTypeExtras(); // tags the suspect; 'flee' calls may add more (1-4); armor per suspect
  setupStaging2(); S.ems = defaultEMS(); initNego(seed); makeBrief();
  updateVision();
  log(`${S.opName} — seed ${seed}. ${S.house.archName}, ${S.geo.name}.`, 'system');
  const B = S.brief; log(`Dispatch ${B.time}: ${B.type} at ${B.addr}. ${B.shots ? 'Shots fired. ' : ''}${S.stype.key === 'drughouse' ? `Narcotics unit requests SWAT — fortified house, ${S.brief.report && S.brief.report.kind === 'atleast' ? 'at least two suspects' : S.brief.report ? S.brief.report.text : 'several suspects'} inside.` : S.stype.key === 'inmates' ? `Escaped inmate${S.brief.report && (S.brief.report.n > 1 || S.brief.report.kind === 'atleast') ? 's' : ''} forced into an occupied house — the family got out.` : S.stype.key === 'flee' ? (S.brief.report && S.brief.report.kind === 'atleast' ? 'At least one suspect — possibly more — fled from patrol into a vacant house.' : S.brief.report && S.brief.report.n > 1 ? `${S.brief.report.n} suspects fled from patrol into a vacant house.` : 'Suspect fled from patrol into a vacant house.') : S.stype.key === 'mental' ? 'Adult male in crisis, armed, alone inside.' : 'Adult male barricaded inside.'} Patrol cruisers blocking traffic at both ends of the block.`, 'alert');
  if (S.scene.injury) { const c = casById(S.scene.injury.cas), mate = S.units.find(u => u.kind === 'patrol' && u.status === 'ok' && !u.inCar);
    log(c.state === 'kia' ? `${mate ? mate.name : 'Patrol'}: "OFFICER DOWN! ${c.name} is hit in the front yard — he's not moving. We can't get to him!"` : c.state === 'mobile' ? `${c.name}: "I'm hit — I can move. I'm in the open out front, need cover!"` : c.sev === 3 ? `${mate ? mate.name : 'Patrol'}: "OFFICER DOWN! ${c.name} is hit out front, his condition is critical — we need help NOW!"` : `${c.name}: "I'm hit — I can't move. Front yard. Somebody get me out of here!"`, 'bad'); }
  log('SWAT team paged. Set containment from cover while the team responds.', 'system');
  const A = initialArrivals(); S.brief.arrival = A;
  if (A) log(A.mode === 'all' ? `SWAT: FULL TEAM ON SCENE — ${A.why}` : `SWAT: ${A.count} of ${A.of} on scene at staging — ${A.why}${A.count < A.of ? ' The rest are paged and en route.' : ''}`, A.mode === 'all' ? 'good' : 'system');
  S.officers.forEach(o => log(o.status === 'staged' ? `PAGER: ${o.name} (${SPECS[o.spec].name}${o.quals.length ? ', ' + o.quals.map(q => QUALS[q].name).join(', ') : ''}) ON SCENE at staging.` : `PAGER: ${o.name} (${SPECS[o.spec].name}${o.quals.length ? ', ' + o.quals.map(q => QUALS[q].name).join(', ') : ''}) en route — ETA ${tMin(o.eta)}.`, 'pager'));
  return S;
}

return { DRUG_CFG, INMATE_CFG, DUPLEX_CFG, TRAILER_CFG, DOOR_MUL, doorMul, exitWin, roomInPlay, camSees, camTurn, duplexTurn, partyBreach, thinWallTurn, types3Turn, cmdShown, structFor, STRUCT_CFG, STRUCT_KEYS, ownRooms, isOwnRoom, MULTI_TYPES, multiType, PAROLE_CFG, SOVCIT_CFG, BASE_KEYS, hiddenNow, applyTypeExtras, NEGO_FLAVOR, SCEN_TYPES, SCEN_KEYS, typeForSeed, stypeCfg, resolvedNoForce, onNeighborSide, typeFireMul, LEGAL_TXT, typeDebrief, SHOOT_CFG, MAX_RETURN_FIRE, returnFirers, returnFire, memberWeapon, primaryOf, suspectTick, suspectFire, TASER_CFG, doorExposed, FORM_CFG, wallSpots, doorStack, pickVictim, LL_CFG, DEVICE_ORDERS, deviceUser, deviceWhyNot, deviceShotReq, deviceChance, ARMOR, ARMOR_CFG, SHIELDS, SHIELD_CFG, SUSPECT_CAL, armorOf, shieldOf, armorHit, shotOfficer, suspectArmorStops, hasShield, teamArmor, revealSuspectArmor, officerDown, suspectHit, fireAt, DRACO_CFG, bearcat, installTicks, dracoTick, passE, edge, dracoTargetReq, openingMid,
  REAR_CFG, REAR_OFF, reach, newGame, get state() { return S; }, MULTI_CFG, suspList, multiSp, spName, spState, suspectCountInfo, fleeCount, patrolReport, suspById, withSp, eachSp, spHostile, spActive, setLead, MAP_W, MAP_H, TICKS, LOSE_DOWN, SCORE, withdraw, forceLeft, updateVision, computeVis, checkEnd, EQUIP, SPECS, QUALS, WEAPONS, SUSPECT_WEAPONS, STANCES, COVER_NAMES, COMMANDS, idx, roomAt, edge, los, losEx, findPath, planFor, queueOrder, undoOrder, clearOrders,
  setCommand, execute, stepTick, formTeam, assign, equip, renameTeam, intelInfo, unit, off, teamOk, hasSpec, teamSkill, nearStaging, orderReq, setStance, BREACH, CHARGE_SAFE, breachEst, breachMethods, breachCan, defaultMethod, doorMid, gasAt, gasTurn, gasDeploy, gasCond, gasExpose, suspectGas, suspectGasTurn, masked, impairAcc, impairVis, donMasks, detonateCharge, dist, hitChance, coverInfo, expoAt, computeExpo,
  validateHouse, patrolStartOk, patrolCoverKind, suspSees, houseRectDist, onProperty, suspEyePts, vehId, vehDist, vehNear, VEH_CFG, PATROL_CFG, GEO_CFG, downedSpot, losEx, sceneTurn, validateWorld, footprint, carAxis, houseSideOf, exitCell, spotterOf, perchAt, owCone, weaponOf, onFoot, skillOf, houseCenter, carAt, snapCover, shieldAt, validateContain, COVER_CFG, exposedOrders, ITEM_CFG, INV_CFG, invAct, invView, invOf, isReady, teamWeapon, syncEquip, setTeamOrder, atEquipment, stagePos, CAR_SEATS, carSeats, seatsUsed, TURN_SEC, missionScore, careerSummary, ACT_XP, xpAct, xpSummary, callState, preview, cornerAt, cornerAvail, CORNER_CFG, FIRE_CFG, fireImpair, formationFor, FORM_CFG, initialArrivals, ARRIVE_CFG, mmss, tDur, tMin, clockAt, elapsedAt, sideWatch, watchAt, houseSides, statusCheck, review911, roadblockHeld, withVirtualCar, SCENE_CFG, VARIANT_TXT, setupScene, sceneDebrief, T_HIT, T_TRY,
  CAS_CFG, NEGO_CFG, TALK_KEYS, TALK_NAMES, casById, casActive, casKnow, sevWord, casLabel, setEMS, emsCheck, ccpFor, setSurrenderSpot, surrSpot, setTalk, talkAvail, negoSummary, negOnScene, paCapable, paInRange, paUnits, protocolNow, ambushChance, ambushRisk, walkout, addCasualty, officerDown, suspectHit, robotPhoneGoal, defaultEMS, hostile, contactTry, runTalk, paAct, casualtyTurn, applyAid };
})();
