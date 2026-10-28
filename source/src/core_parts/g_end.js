/* ---------- team management (planning phase only) ---------- */
const nearStaging = (x, y) => dist(x, y, S.ext.staging.x, S.ext.staging.y) <= 4.5;
function formTeam(ids) {
  if (S.phase !== 'planning') return { ok: false, reason: 'Busy' };
  ids = (ids || S.officers.filter(o => o.status === 'staged' && !o.team).map(o => o.id)).slice(0, S.teamMax || 5);
  if (!ids.length) return { ok: false, reason: 'No unassigned officers at staging' };
  const n = ++S.teamSeq; const st = S.ext.staging;
  const t = { uid: 'T' + n, kind: 'team', name: TEAM_NAMES[(n - 1) % TEAM_NAMES.length], num: n, members: [], x: st.x + ((n - 1) % 3) - 1, y: st.y - 1 - Math.floor((n - 1) / 3), dir: -Math.PI / 2, equip: {}, orders: [], status: 'ok', vis: [], deployed: true, detain: false, stance: 'return', perch: null, mask: 'off', impair: 0, stun: 0 };
  for (const k in EQUIP) t.equip[k] = 0;
  S.units.push(t); ids.forEach(id => assign(id, t.uid));
  const kit = { ram: 1, halligan: 1, bang: 2, shield: 1, gas: 1 };
  if (t.members.some(id => off(id).spec === 'breacher')) kit.charge = 2;
  if (t.members.some(id => off(id).spec === 'tech')) { kit.drone = 1; kit.robot = 1; }
  if (t.members.some(id => off(id).spec === 'medic')) kit.medkit = 1;
  if (t.members.some(id => off(id).spec === 'marksman')) kit.lesslethal = 1;
  if (t.members.some(id => off(id).spec === 'negotiator')) { kit.tphone = 1; kit.bullhorn = 1; }
  if (t.members.some(id => off(id).spec === 'leader')) kit.bullhorn = 1;
  for (const k in kit) for (let i = 0; i < kit[k]; i++) if (S.armory[k] > 0) { S.armory[k]--; t.equip[k]++; }
  log(`${t.name} team formed (${t.members.length} officers).`, 'system'); S.version++; return { ok: true, team: t };
}
function assign(offId, teamUid) {
  const o = off(offId); if (!o || o.status !== 'staged' && o.status !== 'ok') return { ok: false, reason: 'Officer unavailable' };
  const from = o.team ? unit(o.team) : null, to = teamUid ? unit(teamUid) : null;
  const pos = from ? from : S.ext.staging; const tpos = to ? to : S.ext.staging;
  if (dist(pos.x, pos.y, tpos.x, tpos.y) > 3.5) return { ok: false, reason: 'Units must be together (within 3 m) to swap members' };
  if (from) from.members = from.members.filter(id => id !== offId);
  o.team = to ? to.uid : null; o.status = to ? 'ok' : 'staged'; if (to) to.members.push(offId);
  if (from && !from.members.length) { S.units = S.units.filter(u => u !== from); for (const k in from.equip) S.armory[k] += from.equip[k]; }
  S.version++; return { ok: true };
}
function equip(teamUid, item, delta) {
  const t = unit(teamUid); if (!t) return { ok: false };
  if (!nearStaging(t.x, t.y)) return { ok: false, reason: 'Team must be at staging (SWAT truck) to re-equip' };
  if (delta > 0 && S.armory[item] <= 0) return { ok: false, reason: 'None left in armory' };
  if (delta < 0 && t.equip[item] <= 0) return { ok: false, reason: 'None to return' };
  S.armory[item] -= delta; t.equip[item] += delta; S.version++; return { ok: true };
}
function renameTeam(uid, name) { const t = unit(uid); if (t && name && name.trim()) { t.name = name.trim().slice(0, 14); S.version++; } }

/* ---------- derived info for HUD ---------- */
function intelInfo() {
  const known = S.rooms.filter(q => q.known).length, exp = S.rooms.filter(q => q.explored).length, sp = S.suspect;
  const lvl = Math.round(100 * (0.55 * known / S.rooms.length + 0.15 * (S.intel.threat ? 1 : 0) + 0.15 * (S.intel.floors ? 1 : 0) + 0.15 * (sp.seen || S.intel.located ? 1 : 0)));
  let threat = 'UNKNOWN'; if (S.intel.threat) threat = '1 ARMED SUSPECT'; if (sp.visible) threat = 'VISUAL — ' + (S.rooms[sp.room] ? S.rooms[sp.room].name.toUpperCase() : 'YARD'); else if (sp.heat) threat = 'LOCATED (THERMAL/K9)';
  const status = { barricaded: 'BARRICADED', alert: 'ALERTED', fleeing: 'FLEEING', surrendered: 'SURRENDERED', incapacitated: 'INCAPACITATED', detained: 'IN CUSTODY', escaped: 'ESCAPED' }[sp.mode];
  return { arch: S.intel.floors ? S.house.archName : 'UNKNOWN', weapon: S.intel.weapon ? SUSPECT_WEAPONS[sp.weapon].name : 'UNKNOWN', floors: S.intel.floors ? '1 (single storey)' : 'UNKNOWN', roomsKnown: known, roomsTotal: S.intel.floors ? S.rooms.length : '?', explored: exp, level: clamp(lvl, 0, 100), threat,
    suspect: (sp.seen || S.intel.threat || !hostile()) ? status : 'UNKNOWN', contain: S.contain.filter(c => c.covered).length, containTotal: S.contain.length, containKnown: !!S.intel.status, sides: (() => { const w = sideWatch(); return { n: w.watched.length, of: w.all.length, gaps: w.gaps }; })(), down: S.stats.down, downMax: LOSE_DOWN, talk: Math.round(sp.talk), phone: !!S.nego.contact, mood: moodWord(), rapport: rapportWord(),
    cas: S.cas.filter(c => casActive(c) && c.known && c.who !== 'suspect').length };
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
    const X = S.ext; let best = null; for (let d = 0; d < 14 && !best; d++) for (const dx of [d, -d]) { const x = X.staging.x + dx, y = S.geo.ST + 4; if (S.drive[idx(x, y)] && !carClash(x, y, null)) { best = [x, y]; break; } }
    if (best) { S.units.push({ uid: 'C4', kind: 'cruiser', name: 'BearCat', num: 4, x: best[0], y: best[1], dir: 0, occ: [], orders: [], status: 'ok', hits: 0, marks: [], vis: [], disabled: false, armored: true }); rebuildDyn(); } }
  S.ems = defaultEMS(); initNego(seed); makeBrief();
  updateVision();
  log(`${S.opName} — seed ${seed}. ${S.house.archName}, ${S.geo.name}.`, 'system');
  const B = S.brief; log(`Dispatch ${B.time}: ${B.type} at ${B.addr}. ${B.shots ? 'Shots fired. ' : ''}Adult male barricaded inside. Patrol cruisers blocking traffic at both ends of the block.`, 'alert');
  if (S.scene.injury) { const c = casById(S.scene.injury.cas), mate = S.units.find(u => u.kind === 'patrol' && u.status === 'ok' && !u.inCar);
    log(c.state === 'kia' ? `${mate ? mate.name : 'Patrol'}: "OFFICER DOWN! ${c.name} is hit in the front yard — he's not moving. We can't get to him!"` : c.state === 'mobile' ? `${c.name}: "I'm hit — I can move. I'm in the open out front, need cover!"` : c.sev === 3 ? `${mate ? mate.name : 'Patrol'}: "OFFICER DOWN! ${c.name} is hit out front, he's losing a lot of blood — we need help NOW!"` : `${c.name}: "I'm hit — I can't move. Front yard. Somebody get me out of here!"`, 'bad'); }
  log('SWAT team paged. Set containment from cover while the team responds.', 'system');
  S.officers.forEach(o => log(`PAGER: ${o.name} (${SPECS[o.spec].name}${o.quals.length ? ', ' + o.quals.map(q => QUALS[q].name).join(', ') : ''}) en route — ETA ${tMin(o.eta)}.`, 'pager'));
  return S;
}

return { newGame, get state() { return S; }, MAP_W, MAP_H, TICKS, LOSE_DOWN, TURN_LIMIT, EQUIP, SPECS, QUALS, WEAPONS, SUSPECT_WEAPONS, STANCES, COVER_NAMES, COMMANDS, idx, roomAt, edge, los, losEx, findPath, planFor, queueOrder, undoOrder, clearOrders,
  setCommand, execute, stepTick, formTeam, assign, equip, renameTeam, intelInfo, unit, off, teamOk, hasSpec, teamSkill, nearStaging, orderReq, setStance, BREACH, CHARGE_SAFE, breachEst, breachMethods, breachCan, defaultMethod, doorMid, gasAt, gasTurn, gasDeploy, gasCond, gasExpose, suspectGas, suspectGasTurn, masked, impairAcc, impairVis, donMasks, detonateCharge, dist, hitChance, coverInfo, expoAt, computeExpo,
  validateHouse, validateWorld, footprint, carAxis, houseSideOf, exitCell, spotterOf, perchAt, owCone, weaponOf, onFoot, skillOf, houseCenter, carAt, snapCover, shieldAt, validateContain, COVER_CFG, TURN_SEC, missionScore, careerSummary, mmss, tDur, tMin, clockAt, elapsedAt, sideWatch, watchAt, houseSides, statusCheck, review911, roadblockHeld, withVirtualCar, SCENE_CFG, VARIANT_TXT, setupScene, sceneDebrief, T_HIT, T_TRY,
  CAS_CFG, NEGO_CFG, TALK_KEYS, TALK_NAMES, casById, casActive, casKnow, sevWord, casLabel, setEMS, emsCheck, ccpFor, setSurrenderSpot, surrSpot, setTalk, talkAvail, negoSummary, negOnScene, paCapable, paInRange, paUnits, protocolNow, ambushChance, ambushRisk, walkout, addCasualty, officerDown, suspectHit, robotPhoneGoal, defaultEMS, hostile, contactTry, runTalk, paAct, casualtyTurn, applyAid };
})();
