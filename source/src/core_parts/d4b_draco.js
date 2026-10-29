/* =====================================================================
   DRACO ARM (v9) — front-mounted breaching boom/claw for the BearCat.
   Kit comes from the equipment pool (career level ≥ 60). A team of ≥2 officers at the BearCat
   installs it (v20: 5 min alone … 1 min with 6+) (busy, more exposed; leaving interrupts — progress is kept).
   Installed: the BearCat's occupants order DRACO BREACH on an exterior door or window; the
   vehicle drives up to it and rips it out. Armored hull → minimal exposure for the crew.
   ===================================================================== */
const DRACO_CFG = {
  installTurns: 10, crew: 1, // v20: 10 turns (5 min) = one officer; a bigger crew works faster (installMin)
  tip: { bang: 2, gas: 4 },   // v20: devices carried in the claw tip, deployable into the room the arm is in contact with
  installMin: [5, 5, 3, 2, 1.5, 1.25, 1], // minutes by crew size (index = officers; 6+ → 1 min, 7+ a little under)
  reach: 3.5,                 // v17: max cells from the BearCat's centre to the opening, straight ahead (bumper at 1.5, boom up to 2 cells past it)
  minReach: 2,                // the front end cannot be closer than the bumper + a short boom
  lateral: 0.55,              // the arm is fixed to the front (no left/right swing): the opening must be dead ahead
  deployTicks: 1,             // swinging the boom out before the first pull
  door: { p: 0.9, barr: 0.75, garage: 0.85, storm: 0.85 }, // per-tick pull success (manual ram 0.5 / charge 0.97)
  noise: 16,
};
/** v20: install minutes for a crew of n (1 → 5 min, 6 → 1 min, 7+ → just under 1 min). */
function dracoMinutes(n) { const M = DRACO_CFG.installMin; n = Math.max(1, n | 0); return n < M.length ? M[n] : Math.max(0.75, 1 - (n - 6) * 0.05); }
function dracoRate(n) { return 5 / dracoMinutes(n); }
function installTicks() { return DRACO_CFG.installTurns * TICKS; }
function bearcat() { return S.units.find(u => u.kind === 'cruiser' && u.armored) || null; }
function openingMid(o) { if (o.door !== undefined && o.door !== null) return doorMid(S.doors[o.door]); const w = S.windows[o.win];
  let x = 0, y = 0; for (const [a, b, c, d] of w.edges) { x += (a + c) / 2; y += (b + d) / 2; } return [x / w.edges.length, y / w.edges.length]; }
function dracoTargetReq(o) {
  if (o.door !== undefined && o.door !== null) { const d = S.doors[o.door]; if (!d) return 'Tap a door or window'; if (!d.exterior) return 'The Draco arm reaches exterior doors only';
    if (d.state !== 'closed' && !(d.storm && d.stormState === 'closed')) return 'That door is already open'; return null; }
  const w = S.windows[o.win]; if (!w) return 'Tap a door or window'; if (w.cleared) return 'That window is already torn out'; return null; }
/** v17: the Draco arm is FIXED to the vehicle's front — it does not swing left or right. A firing spot is a drivable
    centre cell + heading (one of 4 axis headings, square to the wall) with the whole 3-cell footprint drivable and the
    opening dead ahead of the front bumper, within the boom's reach. */
const DIRS4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
function openingNormal(o) { if (o.door !== undefined && o.door !== null) { const d = S.doors[o.door], c = d.cells[Math.floor(d.cells.length / 2)]; return [Math.sign(c[1][0] - c[0][0]), Math.sign(c[1][1] - c[0][1])]; }
  const e = S.windows[o.win].edges[0]; return [Math.sign(e[2] - e[0]), Math.sign(e[3] - e[1])]; }
function dracoFit(o, x, y, h) { const [mx, my] = openingMid(o), [dx, dy] = DIRS4[h], [nx, ny] = openingNormal(o);
  if (Math.abs(dx * nx + dy * ny) !== 1) return null; const along = (mx - x) * dx + (my - y) * dy, lat = Math.abs((mx - x) * dy - (my - y) * dx);
  if (along < DRACO_CFG.minReach || along > DRACO_CFG.reach || lat > DRACO_CFG.lateral) return null;
  for (let k = -1; k <= 1; k++) { const fx_ = x + dx * k, fy = y + dy * k; if (!inb(fx_, fy) || !S.drive[idx(fx_, fy)]) return null; }
  return { x, y, h, dir: Math.atan2(dy, dx), along, lat }; }
function dracoSpots(o) { const [mx, my] = openingMid(o), out = [];
  for (let y = Math.floor(my - 4); y <= Math.ceil(my + 4); y++) for (let x = Math.floor(mx - 4); x <= Math.ceil(mx + 4); x++) { if (!inb(x, y) || !S.drive[idx(x, y)]) continue;
    for (let h = 0; h < 4; h++) { const f = dracoFit(o, x, y, h); if (f) out.push(f); } } return out; }
function dracoReach(o) { const sp = dracoSpots(o); return (x, y) => sp.some(q => q.x === x && q.y === y); }
function dracoSpotAt(o, x, y) { return dracoSpots(o).filter(q => q.x === x && q.y === y).sort((a, b) => a.lat - b.lat || a.along - b.along)[0] || null; }
/** Is the arm's claw in contact with the opening right now (vehicle position + heading only — the arm cannot rotate)? */
function dracoContact(c, o) { const h = DIRS4.findIndex(([dx, dy]) => Math.abs(Math.cos(c.dir || 0) - dx) < 0.01 && Math.abs(Math.sin(c.dir || 0) - dy) < 0.01); return h >= 0 ? dracoFit(o, c.x, c.y, h) : null; }
/** Team side: one tick of installing the kit (team must be next to the BearCat). */
function dracoInstallTick(u, o, speed) { const c = unit(o.car); if (!c || c.draco) { popOrder(u); return; }
  if (teamOk(u).length < DRACO_CFG.crew) { failOrders(u, `installing the Draco arm needs ${DRACO_CFG.crew} officers`); return; }
  const g = carAdjGoal(c); if (!g(u.x, u.y)) { u.installing = null; const r = stepAlong(u, o, g, speed); if (r === null) failOrders(u, 'cannot reach the BearCat'); if (!r) return; }
  if ((c.occ.length || c.bcDriver) && c.orders.some(q => q.type === 'move' || q.type === 'draco')) { log(`${u.name}: BearCat is moving — install paused.`); return; }
  if (!c.dracoKit) { if (!(S.armory.draco > 0)) { failOrders(u, 'no Draco arm kit at the equipment vehicle'); return; } S.armory.draco--; c.dracoKit = true; log(`${u.name}: Draco arm kit brought over — mounting it on the BearCat's front.`, 'radio'); }
  u.installing = c.uid; faceTo(u, c.x, c.y); const p0 = c.dracoProg || 0; c.dracoProg = p0 + dracoRate(teamOk(u).length);
  if (Math.floor(c.dracoProg / TICKS) > Math.floor(p0 / TICKS) && c.dracoProg < installTicks()) log(`${u.name}: Draco arm install ${Math.round(100 * c.dracoProg / installTicks())}%.`);
  if (c.dracoProg >= installTicks()) { c.draco = true; c.dracoTip = { bang: DRACO_CFG.tip.bang, gas: DRACO_CFG.tip.gas }; u.installing = null; popOrder(u); fx('text', c.x, c.y, { text: 'DRACO ARM READY', color: '#7fe3ff' }); log(`${u.name}: Draco arm installed on the ${c.name}. Occupants can now order DRACO BREACH on a door or window.`, 'good'); } }
/** Called from unitAct for every team: leaving the install interrupts it (progress kept on the vehicle). */
function dracoInterrupt(u) { if (!u.installing) return; const o = u.orders[0]; if (o && o.type === 'dracoInstall') return; const c = unit(u.installing); u.installing = null;
  if (c && !c.draco) log(`${u.name}: Draco install interrupted at ${Math.round(100 * (c.dracoProg || 0) / installTicks())}% — resume with Install Draco Arm.`, 'alert'); }
/** Vehicle side: drive up to the opening, deploy the boom, pull. */
function dracoTick(c, o) {
  if (!c.occ.length && !c.bcDriver) { failOrders(c, 'no driver'); return; }
  const [mx, my] = openingMid(o);
  if (!(c.x === o.x && c.y === o.y)) { for (let s = 0; s < 3; s++) { if (c.x === o.x && c.y === o.y) break;
      const p = findPath(c.x, c.y, (x, y) => x === o.x && y === o.y, { drive: true, self: c.uid }); if (!p) { failOrders(c, 'no drivable route to the opening'); return; } if (!p.length) break;
      const [nx, ny] = p[0], dir = Math.atan2(ny - c.y, nx - c.x), ax = Math.abs(Math.cos(dir)) >= Math.abs(Math.sin(dir)) ? 'h' : 'v';
      const fp = footprint(c, nx, ny, ax); if (S.units.some(q => onFoot(q) && fp.some(([a, b]) => a === q.x && b === q.y))) { log(`${c.name}: waiting — officer in the way.`); break; }
      c.x = nx; c.y = ny; c.dir = dir; c.moved = S.tick; rebuildDyn(); }
    syncCar(c); if (!(c.x === o.x && c.y === o.y)) return; }
  // v17: square the nose up to the opening (the arm is fixed — the whole vehicle points at the target)
  if (!dracoContact(c, o)) { const f = dracoSpotAt(o, c.x, c.y); if (!f) { failOrders(c, 'cannot point the front end at the opening from here'); return; }
    c.dir = f.dir; c.moved = S.tick; rebuildDyn(); syncCar(c); log(`${c.name}: lining the front end up square on the ${o.door != null ? S.doors[o.door].name : S.rooms[S.windows[o.win].room].name + ' window'}.`, 'radio'); return; }
  const ct = dracoContact(c, o); c.dracoAt = { door: o.door, win: o.win }; c.dracoAim = c.dir; c.dracoLen = Math.max(0.3, ct.along - 1.5); c.dracoOut = S.turn;
  if (!o.contact) { o.contact = true; fx('text', mx, my, { text: 'ARM CONTACT', color: '#7fe3ff' }); }
  if ((o.prog = (o.prog || 0) + 1) <= DRACO_CFG.deployTicks) { log(`${c.name}: Draco arm deploying toward the ${o.door != null ? S.doors[o.door].name : S.rooms[S.windows[o.win].room].name + ' window'}…`, 'radio'); noise(mx, my, 6, 'engine'); return; }
  if (o.win !== undefined && o.win !== null) { const w = S.windows[o.win], wasBarred = !!w.barred; w.broken = true; w.cleared = true; w.barred = false; if (S.duplex) S.duplex.wallV++; S.stats.breaches++;
    fx('breach', mx, my, { how: 'draco' }); fx('text', mx, my, { text: 'WINDOW OUT', color: '#ffb020' }); noise(mx, my, DRACO_CFG.noise, 'breach'); aggressive(15);
    log(`${c.name}: Draco arm tore out the ${S.rooms[w.room].name} window${wasBarred ? ', bars' : ''} and frame — the opening is clear.`, 'radio'); popOrder(c); return; }
  const d = S.doors[o.door], C = DRACO_CFG.door;
  if (d.storm && d.stormState === 'closed') { d.stormKnown = true; if (S.rng.chance(C.storm)) { d.stormState = 'breached'; log(`${c.name}: storm door on ${d.name} ripped off by the Draco arm.`, 'radio'); fx('thud', mx, my); noise(mx, my, DRACO_CFG.noise - 4, 'door'); }
    else { log(`${c.name}: Draco arm on the storm door — re-gripping.`); noise(mx, my, 10, 'ram'); } return; }
  if (d.state !== 'closed') { popOrder(c); return; }
  const p = Math.min(0.97, C.p * (d.barricaded ? C.barr : 1) * (d.kind === 'garage' ? C.garage : 1) * doorMul(d, 'draco'));
  if (S.rng.chance(p)) { doBreach(c, d, 'draco'); d.frame = 'down'; noise(mx, my, DRACO_CFG.noise, 'breach'); log(`${c.name}: ${d.name} and frame pulled down — breach point open.`, 'radio'); popOrder(c); }
  else { if (d.barricaded) d.barrKnown = true; log(`${c.name}: Draco arm pulling on ${d.name} — still holding${d.barricaded ? ' (barricaded)' : ''}.`); noise(mx, my, 12, 'ram'); fx('thud', mx, my); }
}
