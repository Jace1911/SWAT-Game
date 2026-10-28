/* =====================================================================
   DRACO ARM (v9) — front-mounted breaching boom/claw for the BearCat.
   Kit comes from the equipment pool (career level ≥ 60). A team of ≥2 officers at the BearCat
   installs it in 5 turns (busy, more exposed; leaving interrupts — progress is kept).
   Installed: the BearCat's occupants order DRACO BREACH on an exterior door or window; the
   vehicle drives up to it and rips it out. Armored hull → minimal exposure for the crew.
   ===================================================================== */
const DRACO_CFG = {
  installTurns: 5, crew: 2,
  reach: 3.8,                 // cells from the BearCat's centre to the opening (boom ≈ 1.5 cells past the bumper)
  deployTicks: 1,             // swinging the boom out before the first pull
  door: { p: 0.9, barr: 0.75, garage: 0.85, storm: 0.85 }, // per-tick pull success (manual ram 0.5 / charge 0.97)
  noise: 16,
};
function installTicks() { return DRACO_CFG.installTurns * TICKS; }
function bearcat() { return S.units.find(u => u.kind === 'cruiser' && u.armored) || null; }
function openingMid(o) { if (o.door !== undefined && o.door !== null) return doorMid(S.doors[o.door]); const w = S.windows[o.win];
  let x = 0, y = 0; for (const [a, b, c, d] of w.edges) { x += (a + c) / 2; y += (b + d) / 2; } return [x / w.edges.length, y / w.edges.length]; }
function dracoTargetReq(o) {
  if (o.door !== undefined && o.door !== null) { const d = S.doors[o.door]; if (!d) return 'Tap a door or window'; if (!d.exterior) return 'The Draco arm reaches exterior doors only';
    if (d.state !== 'closed' && !(d.storm && d.stormState === 'closed')) return 'That door is already open'; return null; }
  const w = S.windows[o.win]; if (!w) return 'Tap a door or window'; if (w.cleared) return 'That window is already torn out'; return null; }
function dracoReach(o) { const [mx, my] = openingMid(o); return (x, y) => S.drive[idx(x, y)] && dist(x, y, mx, my) <= DRACO_CFG.reach; }
/** Team side: one tick of installing the kit (team must be next to the BearCat). */
function dracoInstallTick(u, o, speed) { const c = unit(o.car); if (!c || c.draco) { popOrder(u); return; }
  if (teamOk(u).length < DRACO_CFG.crew) { failOrders(u, `installing the Draco arm needs ${DRACO_CFG.crew} officers`); return; }
  const g = carAdjGoal(c); if (!g(u.x, u.y)) { u.installing = null; const r = stepAlong(u, o, g, speed); if (r === null) failOrders(u, 'cannot reach the BearCat'); if (!r) return; }
  if (c.occ.length && c.orders.some(q => q.type === 'move' || q.type === 'draco')) { log(`${u.name}: BearCat is moving — install paused.`); return; }
  if (!c.dracoKit) { if (!(S.armory.draco > 0)) { failOrders(u, 'no Draco arm kit at the equipment vehicle'); return; } S.armory.draco--; c.dracoKit = true; log(`${u.name}: Draco arm kit brought over — mounting it on the BearCat's front.`, 'radio'); }
  u.installing = c.uid; faceTo(u, c.x, c.y); c.dracoProg = (c.dracoProg || 0) + 1;
  if (c.dracoProg % TICKS === 0 && c.dracoProg < installTicks()) log(`${u.name}: Draco arm install ${Math.round(100 * c.dracoProg / installTicks())}%.`);
  if (c.dracoProg >= installTicks()) { c.draco = true; u.installing = null; popOrder(u); fx('text', c.x, c.y, { text: 'DRACO ARM READY', color: '#7fe3ff' }); log(`${u.name}: Draco arm installed on the ${c.name}. Occupants can now order DRACO BREACH on a door or window.`, 'good'); } }
/** Called from unitAct for every team: leaving the install interrupts it (progress kept on the vehicle). */
function dracoInterrupt(u) { if (!u.installing) return; const o = u.orders[0]; if (o && o.type === 'dracoInstall') return; const c = unit(u.installing); u.installing = null;
  if (c && !c.draco) log(`${u.name}: Draco install interrupted at ${Math.round(100 * (c.dracoProg || 0) / installTicks())}% — resume with Install Draco Arm.`, 'alert'); }
/** Vehicle side: drive up to the opening, deploy the boom, pull. */
function dracoTick(c, o) {
  if (!c.occ.length) { failOrders(c, 'no driver'); return; }
  const [mx, my] = openingMid(o);
  if (!(c.x === o.x && c.y === o.y)) { for (let s = 0; s < 3; s++) { if (c.x === o.x && c.y === o.y) break;
      const p = findPath(c.x, c.y, (x, y) => x === o.x && y === o.y, { drive: true, self: c.uid }); if (!p) { failOrders(c, 'no drivable route to the opening'); return; } if (!p.length) break;
      const [nx, ny] = p[0], dir = Math.atan2(ny - c.y, nx - c.x), ax = Math.abs(Math.cos(dir)) >= Math.abs(Math.sin(dir)) ? 'h' : 'v';
      const fp = footprint(c, nx, ny, ax); if (S.units.some(q => onFoot(q) && fp.some(([a, b]) => a === q.x && b === q.y))) { log(`${c.name}: waiting — officer in the way.`); break; }
      c.x = nx; c.y = ny; c.dir = dir; c.moved = S.tick; rebuildDyn(); }
    syncCar(c); if (!(c.x === o.x && c.y === o.y)) return; }
  c.dracoAim = Math.atan2(my - c.y, mx - c.x); c.dracoOut = S.turn;
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
