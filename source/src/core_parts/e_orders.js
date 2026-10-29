
/* =====================================================================
   ORDERS — validation & planning (shared by preview and execution)
   ===================================================================== */
function moveOpts(u, assume) {
  if (u.kind === 'drone') return { fly: true, assume };
  if (u.kind === 'robot') return { canOpen: false, avoidSuspect: true, assume };
  if (u.kind === 'cruiser') return { drive: true, self: u.uid };
  if (u.kind === 'patrol') return { outdoor: true, canOpen: false, avoidSuspect: true, expo: true };
  return { canOpen: true, avoidSuspect: true, assume, expo: true };
}
function plannedBreaches() { const s = new Set(); for (const u of S.units) for (const o of u.orders) if (o.type === 'breach') s.add(o.door); return s; }
function doorSides(d) { const out = []; for (const [a, b] of d.cells) { out.push(a, b); } return out; }
function adjacentToRoomOpening(x, y, roomId, assume, u) {
  if (roomAt(x, y) === roomId) return true;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (roomAt(nx, ny) !== roomId) continue;
    const e = edge(x, y, nx, ny); if (e.t === 'W') return true;
    if (e.t === 'D' && (e.d.state !== 'closed' || (assume && assume.has(e.d.id)) || (!e.d.locked && !e.d.barricaded))) return true; }
  return false;
}
function canThrowFrom(x, y, roomId, assume, u, kind) {
  if (adjacentToRoomOpening(x, y, roomId, assume, u)) return true;
  const rm = S.rooms[roomId]; const lim = kind === 'gas' && u.equip && u.equip.lesslethal > 0 ? 11 : 4;
  for (let yy = rm.y; yy < rm.y + rm.h; yy++) for (let xx = rm.x; xx < rm.x + rm.w; xx++) if (dist(x, y, xx, yy) <= lim && los(x, y, xx, yy)) return true;
  return false;
}
function roomTargetCell(roomId, fx_, fy) { const rm = S.rooms[roomId]; let best = null, bs = 1e9; const cx = rm.x + (rm.w - 1) / 2, cy = rm.y + (rm.h - 1) / 2;
  for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) { if (S.block[idx(x, y)]) continue; const s = dist(x, y, cx, cy); if (s < bs) { bs = s; best = [x, y]; } } return best; }

function nearestDrive(u, x, y) { let best = null, bs = 1e9; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const xx = x + dx, yy = y + dy; if (!inb(xx, yy) || !S.drive[idx(xx, yy)] || carClash(xx, yy, u.uid)) continue; const s = dx * dx + dy * dy; if (s < bs) { bs = s; best = [xx, yy]; } } return best; }
function carAdjGoal(c) { const fp = footprint(c); return (x, y) => !S.dyn[idx(x, y)] && fp.some(([fx_, fy]) => cheb(fx_, fy, x, y) <= 1); }
/** Shooting position check: in range and a line of sight to the target cell. */
function shotReq(u, sx, sy, tx, ty) {
  const wk = weaponOf(u); if (!wk) return u.kind === 'team' ? 'No READY weapon in hand — a weapon just drawn, slung or holstered is not ready until next turn' : 'This unit cannot fire'; const w = WEAPONS[wk], d = dist(sx, sy, tx, ty);
  if (d > w.range) return `Out of range — ${w.short} reaches ~${w.range} m (target ${Math.round(d)} m)`;
  if (!los(sx, sy, tx, ty)) return 'No line of sight to that spot from there';
  return null;
}
/** Resolve an order from a start position → {ok, reason, path, end}. Used for preview and validation. */
function planOrder(u, o, sx, sy, assume) {
  const mo = moveOpts(u, assume);
  const path = (gx, gy) => findPath(sx, sy, (x, y) => x === gx && y === gy, mo);
  const pathAny = fn => findPath(sx, sy, fn, mo);
  switch (o.type) {
    case 'move': case 'drone': case 'robot': {
      if (o.type !== 'move') { const dmo = moveOpts({ kind: o.type }, assume); const p = findPath(sx, sy, (x, y) => x === o.x && y === o.y, dmo); if (!p) return { ok: false, reason: 'Device cannot reach that spot' }; return { ok: true, path: [], dpath: p, end: [sx, sy] }; }
      if (u.kind === 'patrol' && roomAt(o.x, o.y) >= 0) return { ok: false, reason: 'Patrol holds the perimeter — they do not enter.' };
      if (u.kind === 'cruiser') { if (!S.drive[idx(o.x, o.y)]) return { ok: false, reason: 'Cruiser cannot park there (needs open road, driveway or lawn)' }; }
      const p = path(o.x, o.y); if (!p) return { ok: false, reason: u.kind === 'cruiser' ? 'No drivable route (fences, trees or cars in the way)' : 'No route (locked/barricaded door or obstacle)' }; return { ok: true, path: p, end: p.length ? p[p.length - 1] : [sx, sy] }; }
    case 'dracoInstall': { const c = unit(o.car); if (!c) return { ok: false, reason: 'No vehicle' }; const g = carAdjGoal(c); const p = g(sx, sy) ? [] : pathAny(g); if (!p) return { ok: false, reason: 'Cannot reach the BearCat' }; return { ok: true, path: p, end: p.length ? p[p.length - 1] : [sx, sy] }; }
    case 'draco': { const g = dracoReach(o), gg = (x, y) => g(x, y) && !carClash(x, y, u.uid); const p = gg(sx, sy) ? [] : pathAny(gg); if (!p) return { ok: false, reason: 'No drivable spot where the BearCat can point its front end square at that opening (the Draco arm is fixed — it does not swing)' }; return { ok: true, path: p, end: p.length ? p[p.length - 1] : [sx, sy] }; }
    case 'board': { const c = unit(o.car); if (!c) return { ok: false, reason: 'No cruiser' }; const g = carAdjGoal(c); const p = g(sx, sy) ? [] : pathAny(g); if (!p) return { ok: false, reason: 'Cannot reach that cruiser' }; return { ok: true, path: p, end: [c.x, c.y] }; }
    case 'exit': return { ok: true, path: [], end: [sx, sy] };
    case 'overwatch': {
      if (o.perch !== undefined && o.perch !== null) { const pc = S.perches[o.perch]; const p = (sx === pc.entry[0] && sy === pc.entry[1]) ? [] : path(pc.entry[0], pc.entry[1]);
        if (!p) return { ok: false, reason: 'No covered route to that house' }; return { ok: true, path: p, end: [pc.x, pc.y], perch: pc }; }
      if (roomAt(o.x, o.y) >= 0) return { ok: false, reason: 'Overwatch is taken outside the target house' };
      const p = path(o.x, o.y); if (!p) return { ok: false, reason: 'No route to that vantage point' };
      if (!overwatchSees(o.x, o.y)) return { ok: false, reason: 'No sight line to any window or door from there' };
      return { ok: true, path: p, end: [o.x, o.y] }; }
    case 'taser': case 'llfire': { const sp = devTarget(sx, sy); const q = withSp(sp, () => deviceShotReq(u, o.type, sx, sy)); if (q) return { ok: false, reason: q }; o.x = sp.x; o.y = sp.y; o.tgt = sp.key; o.est = deviceChance(u, o.type, dist(sx, sy, sp.x, sp.y)); return { ok: true, path: [], end: [sx, sy] }; }
    case 'shoot': { const q = shotReq(u, sx, sy, o.x, o.y); if (q) return { ok: false, reason: q }; return { ok: true, path: [], end: [sx, sy] }; }
    case 'clear': { const tc = roomTargetCell(o.room); if (!tc) return { ok: false, reason: 'Room not reachable' }; const p = path(tc[0], tc[1]);
      if (!p) return { ok: false, reason: 'No entry route — breach a door first' }; o.x = tc[0]; o.y = tc[1]; return { ok: true, path: p, end: p.length ? p[p.length - 1] : [sx, sy] }; }
    case 'detonate': { const d = S.doors[o.door]; if (!d.charge && !u.orders.some(q => q !== o && q.type === 'breach' && q.door === o.door && q.hangOnly)) return { ok: false, reason: 'No charge hung on that door' };
      const [mx, my] = doorMid(d); const warn = d.charge && dist(sx, sy, mx, my) < CHARGE_SAFE ? 'Inside the safety distance — team will be dazed' : null; return { ok: true, path: [], end: [sx, sy], warn }; }
    case 'mask': case 'land': return { ok: true, path: [], end: [sx, sy] };
    case 'breach': case 'polecam': case 'opendoor': { const d = S.doors[o.door]; const sides = doorSides(d).filter(c => cellOk(c[0], c[1], { avoidSuspect: true }) && !S.block[idx(c[0], c[1])]);
      const isGoal = (x, y) => sides.some(c => c[0] === x && c[1] === y);
      const a2 = new Set(assume); a2.delete(o.door);
      const p = isGoal(sx, sy) ? [] : findPath(sx, sy, isGoal, Object.assign({}, mo, { assume: a2 }));
      if (!p) return { ok: false, reason: 'Cannot reach that door' }; const end = p.length ? p[p.length - 1] : [sx, sy]; return { ok: true, path: p, end }; }
    case 'bang': case 'gas': {
      const fn = (x, y) => roomAt(x, y) !== o.room && canThrowFrom(x, y, o.room, assume, u, o.type);
      if (canThrowFrom(sx, sy, o.room, assume, u, o.type)) return { ok: true, path: [], end: [sx, sy] };
      const p = pathAny(fn); if (!p) return { ok: false, reason: 'No opening into that room (breach a door or reach a window)' }; return { ok: true, path: p, end: p[p.length - 1] }; }
    case 'hold': return { ok: true, path: [], end: [sx, sy] };
    case 'corner': { const c = cornerAt(sx, sy, u); if (!c) return { ok: false, reason: 'No corner here — stand at a hallway corner, door frame or house corner' }; return { ok: true, path: [], end: [sx, sy], corner: { px: c.px, py: c.py, n: c.hidden.length } }; }
    case 'aid': case 'rescue': case 'evac': return planCas(u, o, sx, sy, assume);
    case 'pa': { if (!hostile()) return { ok: false, reason: 'Not needed' }; if (!paInRange(sx, sy)) return { ok: false, reason: `Out of loudspeaker range — move within ~${NEGO_CFG.pa.range} m of the house` };
      if (u.orders.some(q => q !== o && q.type === 'pa')) return { ok: false, reason: 'One PA broadcast per 30 s' };
      return { ok: true, path: [], end: [sx, sy], warn: u.kind !== 'cruiser' && expoAt(sx, sy) >= 0.3 ? 'Exposed position — he may fire at the voice' : null }; }
    case 'tphone': return planTPhone(u, o, sx, sy, assume, mo);
  }
  return { ok: false, reason: 'Unknown order' };
}
/** Start cell for planning: a patrol officer sitting in a cruiser plans from the cover-side door. */
function planStart(u) { if (u.perch) return [u.x, u.y]; if (u.inCar) { const c = unit(u.inCar); const e = c && exitCell(c, 'safe'); if (e) return e; } return [u.x, u.y]; }
/** Preview: sequential plan of all queued orders for a unit. Each step gets exposure flags for red path tint. */
function planFor(u) {
  const assume = plannedBreaches(); let [x, y] = planStart(u); const out = [];
  for (const o of u.orders) { const r = planOrder(u, o, x, y, assume);
    if (r.ok && r.path && u.kind !== 'cruiser' && u.kind !== 'drone') r.expo = r.path.map(([px, py]) => roomAt(px, py) >= 0 ? 0 : expoAt(px, py));
    out.push(Object.assign({ order: o, start: [x, y] }, r)); if (r.ok) { x = r.end[0]; y = r.end[1]; } }
  return out;
}
function orderReq(u, o) {
  if (u.kind === 'team') {
    if (!u.deployed) return 'Team is still forming at staging — tap DEPLOY in team panel';
    const e = u.equip, pending = (k) => u.orders.filter(q => q.type === k).length;
    if (o.type === 'breach') { const d = S.doors[o.door]; if (d.state !== 'closed') return 'Door is already open';
      if (o.method) { const c = breachCan(u, o.method); if (c !== true) return c; if (o.method === 'charge' && pending('breach') && u.orders.filter(q => q.type === 'breach' && q.method === 'charge').length >= (e.charge || 0)) return 'No charges left on this team'; }
      if (o.hangOnly && o.method !== 'charge') return 'Only a charge can be hung';
      if (d.charge && o.method === 'charge') return 'A charge is already hung — Detonate it'; }
    if (o.type === 'detonate') { const d = S.doors[o.door]; if (!d.charge && !u.orders.some(q => q.type === 'breach' && q.door === o.door && q.hangOnly)) return 'No charge hung on that door'; }
    if (o.type === 'bang' && pending('bang') >= (e.bang || 0)) return 'No flashbangs left on this team';
    if (o.type === 'gas' && pending('gas') >= (e.gas || 0)) return 'No CS gas on this team';
    if ((o.type === 'bang' || o.type === 'gas') && !taskMember(u, o.type, 2)) return 'A throw needs BOTH hands — whoever carries it holds a shield or the ram (change loadout)';
    if (DEVICE_ORDERS.includes(o.type)) { const w = deviceWhyNot(u, o.type); if (w) return w; }
    if (o.type === 'polecam' && !(e.polecam > 0)) return 'Team has no pole camera';
    if ((o.type === 'drone' || o.type === 'robot') && !(e[o.type] > 0)) return `Team carries no ${o.type}`;
    if ((o.type === 'drone' || o.type === 'robot') && !hasSpec(u, 'tech')) return 'Needs a Tech / Robot Op on the team';
    if (o.type === 'board') { const c = unit(o.car); if (!c || c.kind !== 'cruiser') return 'Tap a vehicle'; if (u.inCar) return 'Already in a vehicle'; if (c.disabled) return 'That vehicle is disabled'; if (seatsUsed(c) + seatsNeeded(u) > carSeats(c)) return `${c.name} has ${carSeats(c) - seatsUsed(c)} free seat(s) — team needs ${seatsNeeded(u)}`; }
    if (o.type === 'exit' && !u.inCar) return 'Not in a vehicle';
    if (u.inCar && !['exit', 'hold', 'move', 'pa'].includes(o.type)) return 'Get out of the vehicle first (Exit)';
    if (o.type === 'draco' && !u.inCar) return 'Draco Breach is a BearCat order — get in the BearCat first';
    if (o.type === 'dracoInstall') { const c = unit(o.car); if (!c || !c.armored) return 'Tap the BearCat'; if (c.draco) return 'The Draco arm is already installed'; if (c.disabled) return 'That vehicle is disabled';
      if (!c.dracoKit && !(S.armory.draco > 0)) return 'No Draco arm kit at the equipment vehicle (career level 60+)'; if (teamOk(u).length < DRACO_CFG.crew) return `Installing needs a team of ${DRACO_CFG.crew}+ officers`; }
    if (o.type === 'overwatch' && !hasSpec(u, 'marksman')) return 'Overwatch needs a Marksman / Sniper on the team';
    if (o.type === 'pa' && !(e.bullhorn > 0)) return 'No bullhorn on this team (cruiser PA works too)';
    if (o.type === 'tphone') { if (!(e.tphone > 0) || pending('tphone') >= e.tphone) return 'No throw-phone on this team';
      if (o.via === 'robot' && (!(e.robot > 0) || !hasSpec(u, 'tech'))) return 'Robot delivery needs a robot and a Tech on the team'; }
    if (u.carrying && !['evac', 'rescue', 'hold'].includes(o.type) && !u.orders.some(q => q.cas === u.carrying)) return 'Carrying a casualty — Evac or Rescue first';
  } else if (u.kind === 'patrol') {
    if (!['move', 'hold', 'shoot', 'board', 'exit', 'aid', 'rescue', 'evac', 'corner', 'taser'].includes(o.type)) return 'Patrol officers can Move, Hold, Fire, Taser, work a corner, get in a vehicle, or help casualties';
    if (o.type === 'taser') { const w = deviceWhyNot(u, 'taser'); if (w) return w; }
    if (o.type === 'exit' && !u.inCar) return 'Not in a vehicle';
    if (['aid', 'rescue', 'evac'].includes(o.type) && u.inCar) return 'Get out of the cruiser first';
    if (o.type === 'shoot' && u.inCar) return 'Get out of the vehicle first (Exit)';
    if (o.type === 'board') { const c = unit(o.car); if (!c || c.kind !== 'cruiser') return 'Tap a cruiser'; if (u.inCar) return 'Already in a cruiser'; if (seatsUsed(c) + 1 > carSeats(c)) return `${c.name} is full (${carSeats(c)} seats)`; if (c.disabled) return 'That cruiser is disabled'; }
  } else if (u.kind === 'cruiser') {
    if (!['move', 'exit', 'hold', 'pa', 'draco'].includes(o.type)) return 'Cruisers can Drive, Exit, Hold or use the PA';
    if (o.type === 'draco') { if (!u.draco) return u.armored ? 'Install the Draco arm first (a team of 2+ at the BearCat)' : 'Only the BearCat can carry a Draco arm'; if (u.disabled) return 'Vehicle is disabled'; if (!u.occ.length) return `${u.name} is empty — get in to drive it`; const t = dracoTargetReq(o); if (t) return t; }
    if (o.type === 'pa' && !u.occ.length) return 'Nobody in the cruiser to work the PA';
    if (!u.occ.length) return `${u.name} is empty — an officer or team must get in to drive it`;
    if (o.type === 'move' && u.disabled) return 'Cruiser is disabled';
    if (o.type === 'exit' && !u.occ.length && !u.orders.some(q => q.type === 'move')) return 'Cruiser is empty';
  }
  else if (o.type === 'land') { if (u.kind !== 'drone') return 'Only drones can land'; if (u.landed) return 'Already landed'; }
  else if (o.type === 'opendoor') { if (!u.big) return 'Only the Large Robot has an arm to open doors'; const d = S.doors[o.door]; if (!d) return 'Tap a door'; if (d.state !== 'closed') return 'That door is already open'; }
  else if (!['move', 'hold'].includes(o.type)) return 'Devices can only Move' + (u.kind === 'drone' ? ' or Land' : u.big ? ' or Open Door' : '');
  return null;
}
function queueOrder(uid, o) {
  if (S.phase !== 'planning') return { ok: false, reason: 'Wait for the orders to resolve' };
  const u = unit(uid); if (!u || !unitAlive(u)) return { ok: false, reason: 'Unit unavailable' };
  if (o.type === 'overwatch' && (o.perch === undefined || o.perch === null)) { const pc = perchAt(o.x, o.y); o.perch = pc ? pc.id : null; if (!pc && S.block[idx(o.x, o.y)]) return { ok: false, reason: 'No usable vantage point in that building' }; }
  if (o.type === 'drive') { if (!u.inCar) return { ok: false, reason: 'Not in a vehicle — Get In first' }; const c = unit(u.inCar); if (!c) return { ok: false, reason: 'No vehicle' }; // v8: drive through the occupant's own chip
    const r = queueOrder(c.uid, { type: 'move', x: o.x, y: o.y }); if (r.ok) { o.x = r.at[0]; o.y = r.at[1]; } return Object.assign({ car: c.uid }, r); }
  if ((o.type === 'pa' || o.type === 'draco') && u.inCar) return queueOrder(u.inCar, o); // vehicle PA / Draco arm, worked by whoever is inside // vehicle PA, worked by whoever is inside
  const req = orderReq(u, o); if (req) return { ok: false, reason: req };
  if (o.type === 'move' && u.kind === 'cruiser') { const nd = nearestDrive(u, o.x, o.y); if (!nd) return { ok: false, reason: 'Cruiser cannot park there (needs open road, driveway or lawn)' }; o.x = nd[0]; o.y = nd[1]; }
  if (o.type === 'move' && (u.kind === 'patrol' || u.kind === 'team')) { o.req = [o.x, o.y]; o.snapped = false; // v8: move ANYWHERE — no snapping; just flag exposure
    const ci = coverInfo(o.x, o.y); o.cover = ci.level === 'inside' ? 'inside' : ci.level === 'open' ? 'open' : ci.q; o.exposed = roomAt(o.x, o.y) < 0 && ci.level === 'open' && ci.expo >= COVER_CFG.exposedAt; }
  const last = u.orders[u.orders.length - 1];
  const replacing = last && last.type === 'move' && o.type === 'move';
  const prev = planFor(u); let [sx, sy] = planStart(u);
  const upto = replacing ? prev.length - 1 : prev.length;
  for (let i = 0; i < upto; i++) if (prev[i].ok) { sx = prev[i].end[0]; sy = prev[i].end[1]; }
  const assume = plannedBreaches(); if (o.type === 'breach') assume.delete(o.door);
  const r = planOrder(u, o, sx, sy, assume); if (!r.ok) return r;
  if (o.type === 'draco') { o.x = r.end[0]; o.y = r.end[1]; const f = dracoSpotAt(o, o.x, o.y); o.dir = f ? f.dir : null; }
  if (o.type === 'hold') u.orders = u.orders.filter(q => q.type !== 'hold');
  if (o.type === 'overwatch') u.orders = u.orders.filter(q => q.type !== 'overwatch');
  if (o.type === 'shoot') { u.orders = u.orders.filter(q => q.type !== 'shoot'); o.est = hitChance(u, o.x, o.y, [sx, sy]).p; }
  if (replacing) u.orders[u.orders.length - 1] = o; else u.orders.push(o);
  if (o.type === 'move' && r.path) o.routeExposed = r.path.some(([px, py]) => roomAt(px, py) < 0 && expoAt(px, py) >= 0.6);
  if (o.type === 'move' && o.cover === 'open') log(o.exposed ? `⚠ ${u.name}: no cover at that spot — EXPOSED to the house (allowed)` : `${u.name}: no cover at that spot, but out of his line of fire`);
  S.version++; return { ok: true, snapped: o.snapped, est: o.est, at: [o.x, o.y], exposed: !!o.exposed, routeExposed: !!o.routeExposed };
}
/** Orders that END exposed (or cross an exposed stretch) — shown on the preview and beside EXECUTE. Moves are still allowed. */
function exposedOrders() { const out = []; for (const u of S.units) { if (!unitAlive(u) || u.kind === 'cruiser') continue; for (const o of u.orders) if (o.type === 'move' && (o.exposed || o.routeExposed)) out.push({ uid: u.uid, name: u.name, end: !!o.exposed, route: !!o.routeExposed }); } return out; }
function undoOrder(uid) { const u = unit(uid); if (u && u.orders.length && S.phase === 'planning') { u.orders.pop(); S.version++; } }
function clearOrders(uid) { const u = unit(uid); if (u && S.phase === 'planning') { u.orders = []; S.version++; } }
function setStance(uid, st) { const u = unit(uid); if (!u || !STANCES[st]) return { ok: false }; u.stance = st; S.version++; return { ok: true }; }

/* =====================================================================
   BALLISTICS — officer → suspect hit chance (also drives the UI readout)
   base(weapon) × range falloff × concealment × barricade × skill × movement
   ===================================================================== */
function winCellSet() { if (S._winCells) return S._winCells; const s = new Set(); for (const w of S.windows) for (const e of w.edges) s.add(idx(e[0], e[1])); return (S._winCells = s); }
function hitChance(u, tx, ty, from, opt) {
  const wk = weaponOf(u); if (!wk) return { p: 0, why: 'no weapon', parts: [] };
  const w = WEAPONS[wk], [sx, sy] = from || [u.x, u.y], d = dist(sx, sy, tx, ty), notes = [w.short], parts = [];
  if (d > w.range) return { p: 0, why: 'out of range', weapon: w.short, d: Math.round(d), parts };
  const l = los(sx, sy, tx, ty); if (!l) return { p: 0, why: 'no line of sight', weapon: w.short, d: Math.round(d), parts };
  const add = (k, v, t) => { parts.push({ k, v: +v.toFixed(2), t }); return v; };
  let p = add('base', w.base, w.name);
  if (u.kind === 'team') { const tw = teamWeapon(u); if (tw && tw.oh) { p *= add('grip', ITEM_CFG.rifle.oneHandMul, 'rifle fired one-handed'); notes.push('one-handed'); } }
  p *= add('range', 1 - 0.55 * d / w.range, Math.round(d) + ' m of ' + w.range);
  const sp = suspectFor(tx, ty), inside = roomAt(tx, ty) >= 0, atWin = winCellSet().has(idx(tx, ty));
  let cm, ct; if (!inside) { cm = 1.4; ct = 'in the open'; } else if (atWin) { cm = wk === 'sniper' ? 1.25 : 1.0; ct = 'at window (frame + glass)'; } else if (l === 2) { cm = 0.45; ct = 'deep in room behind glass'; } else { cm = 0.6; ct = 'through doorway / walls'; }
  if (inside && S.doors.some(dd => dd.barricaded && dd.rooms.includes(roomAt(tx, ty)))) { cm *= 0.85; ct += ', barricade'; }
  p *= add('cover', cm, ct); notes.push(ct);
  const seen = (sp && sp.visible && sp.x === tx && sp.y === ty) || (opt && opt.flash); const vis_ = sp && sp.visible && sp.x === tx && sp.y === ty; p *= add('visual', vis_ ? 1 : seen ? 0.6 : 0.3, vis_ ? 'suspect in sight' : seen ? 'muzzle flash only (snap shot)' : 'no visual (blind fire)');
  if (opt && opt.flash) p *= add('snap', u.kind === 'patrol' ? 0.55 : 0.8, u.kind === 'patrol' ? 'patrol snap return fire' : 'snap return fire');
  p *= add('skill', 0.55 + skillOf(u) - (u.kind === 'patrol' && u.panic > 0 ? 0.15 : 0), u.kind === 'patrol' ? 'patrol' : 'SWAT');
  let spot = null; if (wk === 'sniper') { spot = spotterOf(u); p *= add('spotter', spot ? spot.mult : 1, spot ? spot.name + ' — ' + spot.label : 'no spotter'); if (u.perch || (opt && opt.perched)) p *= add('steady', 1.1, 'set up on overwatch'); }
  const ia = impairAcc(u); if (ia !== 1) p *= add('impair', ia, (u.impair > 0.05 ? 'gas-impaired' : '') + (masked(u) ? (u.impair > 0.05 ? ', ' : '') + 'gas mask' : ''));
  const gz = gasAt(tx, ty); if (gz > 0.15) p *= add('haze', 1 - Math.min(0.3, gz * 0.3), 'CS haze around target');
  const cap = wk === 'sniper' ? 0.72 : 0.55; p = clamp(p, 0, cap);
  return { p: +p.toFixed(3), weapon: w.short, d: Math.round(d), notes, parts, spotter: spot, cap };
}
