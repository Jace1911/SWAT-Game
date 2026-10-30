
/* =====================================================================
   TURN RESOLUTION — everything happens on ticks of an executed turn
   ===================================================================== */
function execute() {
  if (S.phase !== 'planning') return false;
  S.phase = 'executing'; S.tick = 0; S.version++;
  log(`— TURN ${S.turn + 1}: EXECUTE —`, 'system');
  if (S.cmd) { runCommand(S.cmd); S.cmd = null; }
  if (S.nego.pick) runTalk();
  if (S.units.some(u => u.kind === 'team' && unitAlive(u) && u.orders.some(o => o.type === 'gas' || o.type === 'cs40'))) donMasks('CS gas going in');
  computeExpo();
  // officers left standing in a line of fire with nothing to do get behind something
  if (suspList().some(spHostile)) for (const u of S.units) if (onFoot(u) && !u.orders.length && !u.stayPut && roomAt(u.x, u.y) < 0 && expoAt(u.x, u.y) >= 0.6) seekCover(u, 'exposed to the house windows');
  updateVision(); return true;
}
function stepTick() {
  if (S.phase !== 'executing') return true;
  if (S.encMid) { const m = S.encMid; S.encMid = false; if (m !== 'end') stepTickB(); return stepTickEnd(); } // v17: resume the tick that paused at the moment of contact
  S.tick++; S.tickLog = {};
  for (const u of S.units.slice()) { if (!unitAlive(u)) continue;
    if (S.gasEver) gasExpose(u);
    if (u.stun > 0) { u.stun--; continue; }
    if (u.kind === 'team' && u.mask === 'donning') { u.mask = 'on'; log(`${u.name}: masks on.`, 'radio'); continue; }
    unitAct(u); }
  casualtyTick();
  if (S.gasEver) eachSp(suspectGas);
  rebuildDyn(); computeExpo();
  updateVision();
  if (encContactCheck()) { S.encMid = true; S.version++; return true; } // v17: first sight this turn → pause before anyone reacts
  stepTickB(); return stepTickEnd(); }
function stepTickB21() { eachSp(suspectTick); officersFire(); teamResponses(); updateVision(); checkEnd();
  if (S.phase === 'executing' && encContactCheck()) S.encMid = 'end'; } // v17: he stepped into view during his own move → pause at the end of this tick
function stepTickEnd() {
  if (S.phase === 'over') return true;
  if (S.phase === 'encounter') { S.version++; return true; } // v16: paused for a decision (blind fire at a threshold)
  if (S.tick >= TICKS) { if (encEndTurn()) return true; endTurn(); return true; } // v16: half-turn encounter decisions before the turn ends
  S.version++; return false;
}
function faceTo(u, x, y) { if (x !== u.x || y !== u.y) u.dir = Math.atan2(y - u.y, x - u.x); }
function footBlocked(x, y, self) { return S.units.some(q => q !== self && q.kind === 'patrol' && onFoot(q) && q.x === x && q.y === y && false); }
function stepAlong(u, o, goalFn, speed = 1) {
  for (let s = 0; s < speed; s++) {
    if (goalFn(u.x, u.y)) return true;
    const mo = moveOpts(u, null), p = findPath(u.x, u.y, goalFn, mo);
    if (!p || !p.length) {
      const pb = plannedBreaches(); const p2 = findPath(u.x, u.y, goalFn, moveOpts(u, pb));
      if (p2 && p2.length) { u.waiting = true; return false; }
      return null;
    }
    const [nx, ny] = p[0]; const e = edge(u.x, u.y, nx, ny);
    if (e.t === 'D' && e.d.state === 'closed') { e.d.state = 'open'; e.d.known = true; e.d.lockKnown = true; faceTo(u, nx, ny); noise(nx, ny, 2, 'door'); log(`${u.name}: opening ${e.d.name || 'door'}.`); return false; }
    faceTo(u, nx, ny); u.x = nx; u.y = ny; u.waiting = false; u.moved = S.tick; if (u.slice) u.slice = null; // stepping off ends the pie slice
    if (roomAt(nx, ny) >= 0) break; // one cell per tick inside — careful movement
  }
  return goalFn(u.x, u.y);
}
function popOrder(u) { u.orders.shift(); }
function failOrders(u, why) { log(`${u.name}: ${why} — orders cancelled.`, 'bad'); u.orders = []; }
function syncCar(c) { for (const id of c.occ) { const p = unit(id); if (p) { p.x = c.x; p.y = c.y; p.dir = c.dir; } } }
function exitCar(p, side) {
  const c = unit(p.inCar); if (!c) { p.inCar = null; return; }
  const e = exitCell(c, side) || exitCell(c, side === 'safe' ? 'house' : 'safe'); if (!e) { log(`${p.name}: can't open the door — blocked.`, 'bad'); return false; }
  c.occ = c.occ.filter(id => id !== p.uid); p.inCar = null; p.x = e[0]; p.y = e[1]; p.exiting = S.tick; p.moved = S.tick;
  const hs = houseSideOf(c), exposed = side === 'house';
  log(`${p.name}: out of ${c.name} on the ${exposed ? 'house side — EXPOSED' : 'far side, using the car as cover'}.`, exposed ? 'alert' : 'radio');
  return true;
}
function driveCar(c, o) {
  if (!c.occ.length && !c.bcDriver) { failOrders(c, 'no driver'); return; }
  for (let s = 0; s < 3; s++) {
    if (c.x === o.x && c.y === o.y) break;
    const p = findPath(c.x, c.y, (x, y) => x === o.x && y === o.y, { drive: true, self: c.uid }); if (!p) { failOrders(c, 'no drivable route'); return; } if (!p.length) break;
    const [nx, ny] = p[0], dir = Math.atan2(ny - c.y, nx - c.x), ax = Math.abs(Math.cos(dir)) >= Math.abs(Math.sin(dir)) ? 'h' : 'v';
    const fp = footprint(c, nx, ny, ax); if (S.units.some(q => onFoot(q) && fp.some(([a, b]) => a === q.x && b === q.y))) { log(`${c.name}: waiting — officer in the way.`); break; }
    c.x = nx; c.y = ny; c.dir = dir; c.moved = S.tick; rebuildDyn();
  }
  syncCar(c);
  if (c.x === o.x && c.y === o.y) { // park broadside to the house so the far side is cover
    const [hx, hy] = houseCenter(), vx = hx - c.x, vy = hy - c.y; const want = Math.abs(vx) > Math.abs(vy) ? 'v' : 'h';
    if (carAxis(c) !== want) { const nd = want === 'h' ? (Math.cos(c.dir) >= 0 ? 0 : Math.PI) : (Math.sin(c.dir) >= 0 ? Math.PI / 2 : -Math.PI / 2);
      const fp = footprint(c, c.x, c.y, want); if (fp.every(([a, b]) => S.drive[idx(a, b)] || (a === c.x && b === c.y)) && !S.units.some(q => onFoot(q) && fp.some(([a, b]) => a === q.x && b === q.y)) && !carClash(c.x, c.y, c.uid)) { c.dir = nd; rebuildDyn(); syncCar(c); } }
    popOrder(c); log(`${c.name} in position — driver side ${houseSideOf(c) === 'driver' ? 'FACES the house (exit on the far side takes a moment longer)' : 'away from the house'}.`, 'radio');
  }
}
function unitAct(u) {
  if (u.kind === 'drone' || u.kind === 'robot') { if (u.battery <= 0) return; }
  if (u.ramGrip && u.orders[0] !== u.ramGrip.order) ramRelease(u);
  if (u.inCar && u.orders[0] && u.orders[0].type === 'exit') { const o = u.orders[0], c = unit(u.inCar); if (c && o.side === 'safe' && houseSideOf(c) === 'driver' && c.occ[0] === u.uid && !o.slid) { o.slid = true; log(`${u.name}: sliding across to the far-side door…`); return; } exitCar(u, o.side || 'safe'); popOrder(u); return; }
  if (u.kind === 'team' && u.inCar) { const o = u.orders[0]; if (o && o.type === 'move') exitCar(u, 'safe'); else return; }
  if (u.kind === 'patrol' && u.inCar) { const o = u.orders[0]; if (o && o.type === 'move') { const c = unit(u.inCar); if (c && houseSideOf(c) === 'driver' && c.occ[0] === u.uid && !o.slid) { o.slid = true; log(`${u.name}: sliding across to the far-side door…`); return; } exitCar(u, 'safe'); } return; }
  if ((u.kind === 'team' || u.kind === 'patrol' && !u.inCar) && u.detain) { const sp = u.detain === true ? S.suspect : suspById(u.detain);
    if (sp && spActive(sp)) { stepAlong(u, null, (x, y) => cheb(x, y, sp.x, sp.y) <= 1 && !(x === sp.x && y === sp.y)); return; } u.detain = false; }
  if (u.kind === 'team') dracoInterrupt(u);
  const o = u.orders[0]; if (!o) return;
  if (u.kind === 'cruiser') {
    if (o.type === 'move') return driveCar(u, o);
    if (o.type === 'draco') return dracoTick(u, o);
    if (o.type === 'dracoTip') { popOrder(u); dracoTipAct(u, o); return; }
    if (o.type === 'exit') { const hs = houseSideOf(u);
      if (o.side === 'safe' && hs === 'driver' && !o.slid && u.occ.length) { o.slid = true; log(`${u.name}: crew sliding across to the far-side doors…`); return; }
      for (const id of u.occ.slice()) exitCar(unit(id), o.side); popOrder(u); return; }
    if (o.type === 'hold') return;
    if (o.type === 'pa') { popOrder(u); paAct(u, o); return; }
    return;
  }
  if (devAct(u, o)) return;
  if (u.kind === 'robot' && o.type === 'tphone') return tphoneAct(u, o, 1);
  if (u.perch && o.type !== 'shoot' && o.type !== 'hold' && o.type !== 'overwatch') { const pc = u.perch; u.perch = null; if (pc.entry) { u.x = pc.entry[0]; u.y = pc.entry[1]; log(`${u.name}: coming down from overwatch.`); return; } }
  if (o.type === 'overwatch') {
    const pc = o.perch !== null && o.perch !== undefined ? S.perches[o.perch] : null, gx = pc ? pc.entry[0] : o.x, gy = pc ? pc.entry[1] : o.y;
    if (!(u.x === gx && u.y === gy) && !(pc && u.perch && u.perch.id === pc.id)) { const r = stepAlong(u, o, (x, y) => x === gx && y === gy, 2); if (r === null) failOrders(u, 'cannot reach the vantage point'); if (!r) return; }
    if (pc && !o.prog) { o.prog = 1; log(`${u.name}: inside the ${pc.name.toLowerCase()} — setting up at the ${pc.kind}.`); return; }
    const [hx, hy] = houseCenter(); if (pc) { u.x = pc.x; u.y = pc.y; u.perch = { id: pc.id, entry: pc.entry, kind: pc.kind, name: pc.name }; } else u.perch = { yard: true, kind: 'yard vantage', name: 'yard vantage point' };
    u.dir = Math.atan2(hy - u.y, hx - u.x); popOrder(u); const sp = spotterOf(u);
    xpAct('overwatch', u); log(`${u.name}: OVERWATCH set — ${u.perch.kind}, ${sp ? 'spotter ' + sp.name + (sp.q ? ' (qualified)' : ' (untrained)') : 'no spotter'}.`, 'good'); return; }
  const outside = roomAt(u.x, u.y) < 0;
  const speed = u.kind === 'drone' ? 2 : (u.kind === 'patrol' || u.kind === 'team') && outside && (u.impair || 0) < 0.35 ? 2 : 1;
  if (o.type === 'corner') return cornerTick(u, o);
  if (DEVICE_ORDERS.includes(o.type)) return deviceTick(u, o);
  if (o.type === 'dracoInstall') return dracoInstallTick(u, o, speed);
  if (o.type === 'move' || o.type === 'clear') {
    const r = stepAlong(u, o, (x, y) => x === o.x && y === o.y, speed);
    if (r === null) failOrders(u, 'route blocked'); else if (r) { popOrder(u); if (o.type === 'move') u.stayPut = !!o.exposed; if (o.regroup !== undefined && u.regroup) faceAlong(u, u.regroup); if (o.type === 'clear') { const rm = S.rooms[o.room];
      if (!spInRoom(o.room)) { log(`${u.name}: ${rm.name} CLEAR.`, 'good'); xpAct('clear', u, rm.name); fx('text', u.x, u.y, { text: 'CLEAR', color: '#3ef0a0' }); startRegroup(u, o.room); } } }
    return;
  }
  if (o.type === 'board') { const c = unit(o.car); if (!c || seatsUsed(c) + seatsNeeded(u) > carSeats(c)) { failOrders(u, 'vehicle full'); return; }
    const g = carAdjGoal(c); if (!g(u.x, u.y)) { const r = stepAlong(u, o, g, speed); if (r === null) failOrders(u, 'cannot reach the cruiser'); if (!r) return; }
    boardCar(u, c); u.stayPut = false; log(`${u.name}: in ${c.name}.`); return; }
  if (o.type === 'shoot') { if (!u.perch || !u.perch.entry) faceTo(u, o.x, o.y); else u.dir = Math.atan2(o.y - u.y, o.x - u.x); u.holding = true; const every = o.mode === 'suppress' ? 2 : 3; if (S.tick % every === 1) fireAt(u, o.x, o.y, o.mode); return; }
  if (o.type === 'aid' || o.type === 'rescue' || o.type === 'evac') return casAct(u, o, speed);
  if (o.type === 'pa') { popOrder(u); paAct(u, o); return; }
  if (o.type === 'tphone') return tphoneAct(u, o, speed);
  if (o.type === 'mask') { u.mask = o.on ? 'on' : 'off'; log(`${u.name}: masks ${o.on ? 'on' : 'off'}.`, 'radio'); popOrder(u); return; }
  if (o.type === 'hold') { if (o.x !== undefined) faceTo(u, o.x, o.y); u.holding = true; return; }
  if (o.type === 'drone' || o.type === 'robot') { useItem(u, o.type); const d = newDevice(o.type, u.x, u.y, u.dir, { orders: [{ type: 'move', x: o.x, y: o.y }], owner: u.uid });
    S.units.push(d); log(`${u.name}: ${d.name} deployed.`, 'radio'); popOrder(u); return; }
  if (o.type === 'detonate' && S.doors[o.door].charge) { detonateCharge(u, S.doors[o.door]); popOrder(u); return; }
  if (o.type === 'breach' && o.phase === 'standoff') { const d = S.doors[o.door];
    if (!d.charge || d.state !== 'closed') { popOrder(u); return; }
    if (!o.so) o.so = standoffGoal(u, d) || [u.x, u.y];
    if (u.x !== o.so[0] || u.y !== o.so[1]) { const r = stepAlong(u, o, (x, y) => x === o.so[0] && y === o.so[1], roomAt(u.x, u.y) < 0 ? 2 : 1); if (r === null) o.so = [u.x, u.y]; if (!r) return; }
    if (o.hangOnly) { log(`${u.name}: at the safe standoff — charge on ${d.name} ready. Awaiting Detonate.`, 'radio'); popOrder(u); return; }
    log(`${u.name}: standing off — "Breaching, breaching, breaching!"`, 'radio'); detonateCharge(u, d); popOrder(u); if (d.state !== 'closed') runAfter(u, o); return; }
  if (o.type === 'breach' || o.type === 'polecam' || o.type === 'detonate') {
    const d = S.doors[o.door]; const sides = doorSides(d);
    const goal = (x, y) => sides.some(c => c[0] === x && c[1] === y);
    if (!goal(u.x, u.y)) { const r = stepAlong(u, o, goal, speed); if (r === null) failOrders(u, 'cannot reach door'); return; }
    const other = (() => { for (const [a, b] of d.cells) { if (a[0] === u.x && a[1] === u.y) return b; if (b[0] === u.x && b[1] === u.y) return a; } return d.cells[0][1]; })();
    faceTo(u, other[0], other[1]);
    if (o.type === 'polecam') { const pc = polecamHands(u); if (!pc) { log(`${u.name}: nobody has two hands free to work the pole cam.`, 'radio'); popOrder(u); return; } const rr = roomAt(other[0], other[1]); pcamStart(u, d, other, pc); // v22: live feed of what is visible from just inside the door
      log(`${u.name}: ${pc.name} works the pole cam (both hands) under the door — ${rr >= 0 ? S.rooms[rr].name : 'outside'} ${spInRoom(rr) ? (suspList().filter(s => spActive(s) && s.room === rr).length > 1 ? `has ${suspList().filter(s => spActive(s) && s.room === rr).length} SUSPECTS` : 'has the SUSPECT') : 'looks empty'}.`, spInRoom(rr) ? 'alert' : 'intel'); popOrder(u); return; }
    if (o.type === 'detonate') { if (!d.charge) { popOrder(u); return; } detonateCharge(u, d); popOrder(u); return; }
    if (d.state !== 'closed') { if (d.charge) d.charge = null; popOrder(u); return; }
    breachTick(u, o, d, other); return;
  }
  if (o.type === 'bang' || o.type === 'gas' || o.type === 'cs40') {
    if (!canThrowFrom(u.x, u.y, o.room, null, u, o.type)) { const r = stepAlong(u, o, (x, y) => roomAt(x, y) !== o.room && canThrowFrom(x, y, o.room, null, u, o.type), speed); if (r === null) failOrders(u, 'no opening into room'); return; }
    // open/break into room if needed
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = u.x + dx, ny = u.y + dy; if (roomAt(nx, ny) !== o.room) continue; const e = edge(u.x, u.y, nx, ny);
      if (e.t === 'D' && e.d.state === 'closed' && !e.d.locked && !e.d.barricaded) { e.d.state = 'open'; break; } if (e.t === 'W' && !e.w.broken && !canSeeRoom(u, o.room)) { e.w.broken = true; noise(nx, ny, 6, 'glass'); break; } }
    const rm = S.rooms[o.room]; const tc = roomTargetCell(o.room);
    if (o.type === 'cs40') { faceTo(u, tc[0], tc[1]); const q = teamOk(u).find(m => usableCount(m, 'cs40') > 0);
      if (!q) { failOrders(u, 'no 40mm CS round ready (4-shot 40mm in hand, not reloading)'); return; }
      const iv = invOf(q); iv.vest.cs40 = Math.max(0, (iv.vest.cs40 || 0) - 1); iv.llTurn = S.turn; syncEquip(u); popOrder(u); S.stats.cs40 = (S.stats.cs40 || 0) + 1;
      gasAdd(o.room, 1.1 * CS40_CFG.frac); fx('gas', tc[0], tc[1], { room: o.room, fromX: u.x, fromY: u.y }); noise(tc[0], tc[1], 5, 'glass');
      log(`${q.name}: 40mm CS round into ${rm.known ? rm.name : 'room'} (about a quarter of a canister's gas).`, 'radio'); aggressive(8); runAfter(u, o); return; }
    faceTo(u, tc[0], tc[1]); const th = handsTask(u, o.type, ITEM_CFG[o.type].throwHands, q => useItem(u, o.type, x => x === q));
    if (!th) { failOrders(u, 'nobody can free both hands to throw (shield / ram)'); return; }
    if (th.stowed.length) log(`${th.o.name}: ${th.stowed.map(k => WEAPONS[k] ? WEAPONS[k].short.toLowerCase() : k).join(' + ')} put away for the two-handed throw — back in hand, not ready until next turn.`); popOrder(u);
    if (o.type === 'bang') { fx('flash', tc[0], tc[1], { fromX: u.x, fromY: u.y }); log(`${u.name}: BANG OUT — flashbang into ${rm.known ? rm.name : 'room'}.`, 'radio'); noise(tc[0], tc[1], 10, 'bang');
      let nb = 0; eachSp(sp => { if (sp.room === o.room && hostile()) { sp.stun = 5; sp.stunBy = null; sp.daze = FIRE_CFG.bangDaze; sp.ambush = false; nb++; } });
      if (nb) { xpAct('bang', u); log(nb > 1 ? `${nb} suspects disoriented by flashbang.` : 'Suspect disoriented by flashbang.', 'good'); } aggressive(10); }
    else { const ga = gasThrowAmt(th.o); gasDeploy(o.room, ga); if (ga < 1) log(`${th.o.name}: canister bounced off the frame and landed short — only partial gas in the room.`, 'radio'); fx('gas', tc[0], tc[1], { room: o.room, fromX: u.x, fromY: u.y }); log(`${u.name}: CS gas deployed into ${rm.known ? rm.name : 'room'}.`, 'radio'); aggressive(15); }
    runAfter(u, o); return;
  }
}
function canSeeRoom(u, roomId) { return u.vis && u.vis.some(c => S.room[c] === roomId); }
function doBreach(u, d, how) {
  d.state = 'breached'; d.known = true; d.barricaded = false; d.locked = false; S.stats.breaches++;
  const c = d.cells[Math.floor(d.cells.length / 2)]; const mx = (c[0][0] + c[1][0]) / 2, my = (c[0][1] + c[1][1]) / 2;
  fx('breach', mx, my, { how }); fx('text', mx, my, { text: 'BREACH', color: '#ffb020' });
  xpAct('breach', u, d.name); log(`${u.name}: ${d.name} BREACHED (${BREACH[how] ? BREACH[how].name.toLowerCase() : how === 'draco' ? 'Draco arm' : how}).`, 'radio'); d.method = how;
  noise(mx, my, how === 'charge' ? 18 : 14, 'breach'); aggressive(how === 'charge' ? 25 : 20);
  const sp = S.suspect; if (false) { sp.stun = Math.max(sp.stun, 2); log('Suspect stunned by the blast.', 'good'); }
}
function noise(x, y, loud, kind) { eachSp(() => noise1(x, y, loud, kind)); }
function noise1(x, y, loud, kind) {
  const sp = S.suspect; if (!hostile()) return; const d = dist(sp.x, sp.y, x, y);
  if (d > loud) return;
  if (sp.mode === 'barricaded') { sp.mode = 'alert'; const k = S.turn + ':' + S.tick; if (S.alertLogAt !== k) { S.alertLogAt = k; log('Suspect is alerted — movement heard inside.', 'alert'); } }
  sp.agit = clamp(sp.agit + (kind === 'breach' ? 12 : 4), 0, 100);
  const ownDoor = S.doors.some(dd => dd.rooms.includes(sp.room) && dd.cells.some(([a, b]) => dist(a[0], a[1], x, y) < 1.6 || dist(b[0], b[1], x, y) < 1.6));
  if ((kind === 'breach' || kind === 'ram' || kind === 'door') && ownDoor && sp.stun === 0) { sp.ambush = true; sp.dir = Math.atan2(y - sp.y, x - sp.x); }
}
