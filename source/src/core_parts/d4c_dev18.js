
/* ---------- v18: device batteries (%), drone LAND, Throwbots, Large Robot, door locks,
   side-visibility tracking (which sides of the house are seen) + its after-action scoring ---------- */
const DEV_CFG = {
  drone: { move: 8, hover: 5, land: 3 },   // % per turn: moved / hovering in place / landed and only observing
  robot: { move: 5, still: 3 },            // Throwbot 2
  big:   { move: 4, still: 2 },            // Large Robot (bigger battery pack)
  lockExt: 0.95,                           // exterior doors locked
  lockHome: 0.05,                          // unoccupied interior door with the homeowners' simple lock engaged
};
const SIDE_CFG = { unseenPer: 4, unseenCap: 150, containMax: 150, noEffort: -100 };
function devLabel(u) { return u.kind === 'drone' ? 'Drone' : u.big ? 'Large Robot' : 'Throwbot'; }
/** What a device did this turn and what it costs (battery %). */
function devDrain(u) {
  const moved = !!u.turnPos && (u.turnPos[0] !== u.x || u.turnPos[1] !== u.y);
  if (u.kind === 'drone') return moved ? { c: DEV_CFG.drone.move, what: 'flying' } : u.landed ? { c: DEV_CFG.drone.land, what: 'landed' } : { c: DEV_CFG.drone.hover, what: 'hovering' };
  const C = u.big ? DEV_CFG.big : DEV_CFG.robot; return moved ? { c: C.move, what: 'moving' } : { c: C.still, what: 'stationary' };
}
function newDevice(kind, x, y, dir, extra) {
  const n = ++S.devSeq, d = Object.assign({ uid: 'D' + n, kind, name: (kind === 'drone' ? 'Drone ' : 'Throwbot ') + n, num: n, x, y, dir, orders: [], battery: 100, owner: null, status: 'ok', vis: [], turnPos: [x, y], landed: false }, extra || {});
  if (d.big) d.name = 'Large Robot'; return d;
}
/** End-of-turn battery drain; frees the Large Robot operator when it stops. */
function deviceTurn() {
  for (const u of S.units) { if (u.kind !== 'drone' && u.kind !== 'robot') continue;
    if (unitAlive(u)) { if (u.battery > 100 || u.battery === undefined) u.battery = 100;
      const d = devDrain(u); u.battery = Math.max(0, u.battery - d.c); u.lastDrain = d; u.turnPos = [u.x, u.y];
      if (u.battery <= 0) { u.status = 'down'; u.orders = []; log(`${u.name}: battery depleted.`); } }
    if (u.big && !unitAlive(u) && u.op) releaseOperator(u); }
}
function releaseOperator(u) { const o = S.officers.find(q => q.id === u.op); if (o && o.status === 'operator') { o.status = 'staged'; o.opOf = null; log(`${o.name} is free again at primary staging.`, 'radio'); } u.op = null; }
/* ---- Large Robot: driven from primary staging by a dedicated operator ---- */
function bigRobotOperator() { const free = S.officers.filter(o => o.status === 'staged' && !o.team && (o.stage || 'primary') === 'primary');
  return free.find(o => o.spec === 'tech') || free[0] || null; }
function bigRobotWhyNot() {
  if (S.phase !== 'planning') return 'Wait for the orders to resolve';
  if (S.bigAvail === false) return 'No Large Robot in this unit\'s equipment';
  if (S.units.some(u => u.big && unitAlive(u))) return 'The Large Robot is already deployed';
  if (S.units.some(u => u.big && u.status === 'down')) return 'The Large Robot is out of action';
  if (!bigRobotOperator()) return 'Needs a SWAT officer free at primary staging (not in a team) to drive it';
  return null; }
function deployBigRobot() {
  const w = bigRobotWhyNot(); if (w) return { ok: false, reason: w };
  const o = bigRobotOperator(), st = S.ext.staging; let at = [st.x, st.y];
  if (S.block[idx(at[0], at[1])] || S.dyn[idx(at[0], at[1])]) { let best = null, bd = 1e9; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = st.x + dx, y = st.y + dy;
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H || S.block[idx(x, y)] || S.dyn[idx(x, y)] || roomAt(x, y) >= 0) continue; const d = Math.abs(dx) + Math.abs(dy); if (d < bd) { bd = d; best = [x, y]; } } if (best) at = best; }
  const u = newDevice('robot', at[0], at[1], -Math.PI / 2, { big: true, op: o.id }); S.units.push(u);
  o.status = 'operator'; o.opOf = u.uid; S.stats.bigRobot = true;
  log(`Large Robot rolled off the truck at primary staging — ${o.name} (${SPECS[o.spec].name}) is driving it from the staging area and is tied up while he does.`, 'radio'); S.version++;
  return { ok: true, uid: u.uid }; }
function parkBigRobot(uid) { const u = unit(uid); if (!u || !u.big || !unitAlive(u)) return { ok: false, reason: 'No Large Robot' }; if (S.phase !== 'planning') return { ok: false, reason: 'Wait for the orders to resolve' };
  u.status = 'parked'; u.orders = []; log(`${u.name}: parked — operator stands down.`, 'radio'); releaseOperator(u); S.version++; return { ok: true }; }
/** Large Robot tries a door handle. Unlocked → opens. Locked or barricaded → fails (and now we know). */
function openDoorTick(u, o) {
  const d = S.doors[o.door]; if (!d || d.state !== 'closed') { popOrder(u); return; }
  const sides = doorSides(d).filter(c => !S.block[idx(c[0], c[1])]), goal = (x, y) => sides.some(c => c[0] === x && c[1] === y);
  if (!goal(u.x, u.y)) { const r = stepAlong(u, o, goal, 1); if (r === null) failOrders(u, 'cannot reach that door'); if (!r) return; }
  const [mx, my] = doorMid(d); faceTo(u, Math.round(mx), Math.round(my));
  if (!o.grip) { o.grip = 1; log(`${u.name}: arm on the handle of the ${d.name || 'door'}…`); fx('text', u.x, u.y, { text: 'TRYING HANDLE', color: '#c9b8ff' }); return; }
  popOrder(u); d.lockKnown = true; S.stats.robotTries = (S.stats.robotTries || 0) + 1;
  if (d.barricaded) { d.barrKnown = true; log(`${u.name}: the ${d.name || 'door'} will not move — it is BARRICADED from inside.`, 'alert'); noise(u.x, u.y, 4, 'door'); return; }
  if (d.locked) { log(`${u.name}: the ${d.name || 'door'} is LOCKED — the arm cannot open it. Breach needed.`, 'alert'); noise(u.x, u.y, 3, 'door'); return; }
  d.state = 'open'; d.known = true; noise(u.x, u.y, 3, 'door'); fx('text', u.x, u.y, { text: 'DOOR OPEN', color: '#3ef0a0' }); log(`${u.name}: ${d.name || 'door'} was unlocked — door OPEN.`, 'good');
}
/** Device-specific orders inside unitAct. Returns true when the tick is used. */
function devAct(u, o) {
  if (u.kind === 'drone' && o.type === 'land') { popOrder(u); if (!u.landed) { u.landed = true; log(`${u.name}: landed — camera only, saving battery.`, 'radio'); } return true; }
  if (u.kind === 'drone' && o.type === 'move' && u.landed) { u.landed = false; log(`${u.name}: taking off.`); }
  if (u.kind === 'robot' && o.type === 'opendoor') { openDoorTick(u, o); return true; }
  return false; }
/* ---- door locks (separate random stream: the map and the rest of the scenario stay identical) ---- */
function setupLocks() { const r = makeRng(S.seed * 7907 + 29), sus = new Set(suspList().map(s => s.room));
  for (const d of S.doors) {
    if (d.exterior) { if (d.kind === 'garage' || d.barricaded || d.fortified) continue; d.locked = r.chance(DEV_CFG.lockExt); continue; }
    const home = r.chance(DEV_CFG.lockHome); if (d.locked || d.barricaded || d.state !== 'closed' || d.rooms.some(q => sus.has(q))) continue;
    if (home) { d.locked = true; d.homeLock = true; } } }
/* ---- which sides of the house are seen (any officer, vehicle, sniper, drone or robot) ---- */
const SIDE_KEYS = ['front', 'right', 'rear', 'left'];
function houseSideAt(x, y) { const H = S.house; return y < H.y0 ? 'rear' : y > H.y1 ? 'front' : x < H.x0 ? 'left' : x > H.x1 ? 'right' : (y - H.y0 < H.y1 - y ? 'rear' : 'front'); }
function sideSeen() { const sw = sideWatch(), seen = new Set(sw.watched), by = {};
  for (const p of watchPts()) if (S.vis[idx(p.x, p.y)]) seen.add(p.side);
  const all = sw.all; return { all, seen: all.filter(s => seen.has(s)), gaps: all.filter(s => !seen.has(s)), sides: SIDE_KEYS.map(k => ({ k, open: all.includes(k), seen: seen.has(k) })), full: all.length > 0 && all.every(s => seen.has(s)), by }; }
function sideTurn() { const H = S.sideHist || (S.sideHist = { turns: 0, full: 0, miss: {}, last: -1 }); if (H.last === S.turn) return; H.last = S.turn; const v = sideSeen();
  H.turns++; if (v.full) H.full++; v.gaps.forEach(g => H.miss[g] = (H.miss[g] || 0) + 1);
  eachSp(sp => { if (sp.mode === 'barricaded') S.stats.barrEver = true; }); }
function contactEffort() { const N = S.nego; return !!(N.attempts || N.everContact || N.contact || S.stats.challenged); }
function sideScore(add) { const H = S.sideHist; if (!H || !H.turns) return;
  const miss = Object.values(H.miss).reduce((a, b) => a + b, 0); if (miss) add(`Side of the house unseen (${miss} side-turn${miss > 1 ? 's' : ''})`, -Math.min(SIDE_CFG.unseenCap, miss * SIDE_CFG.unseenPer));
  const share = H.full / H.turns; if (share > 0) add(`Visual containment ${Math.round(share * 100)}% of the mission`, Math.round(SIDE_CFG.containMax * share));
  if (S.stats.barrEver && !contactEffort()) add('Barricade: no attempt to contact or call him out', SIDE_CFG.noEffort); }
function sideDebrief() { const H = S.sideHist; if (!H || !H.turns) return [];
  const m = SIDE_KEYS.filter(k => H.miss[k]).map(k => `${k} ${H.miss[k]}`).join(', ');
  const out = [{ k: 'Side visibility', v: `All sides with openings in view ${Math.round(100 * H.full / H.turns)}% of the mission (${H.full}/${H.turns} turns). Turns a side went unseen: ${m || 'none'}.` }];
  if (S.stats.barrEver) out.push({ k: 'Contact effort', v: contactEffort() ? 'Contact / call-out attempted.' : 'NONE — no phone, PA, throw-phone, call-out or verbal challenge on a barricaded subject.' });
  return out; }
