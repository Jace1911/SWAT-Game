/* =====================================================================
   v15 — FOLLOW-UP ACTIONS AND POST-CLEAR REGROUP (rules only)
   1) AFTER-ACTION: a breach / flashbang / CS order can carry o.after — what the team does
      once the action resolves: 'hold' position, 'clear' (enter and clear the room),
      'limited' (limited penetration: a step or two inside, along the wall, then hold) or
      'assess' (stand at the doorway / opening looking in, then hold). The follow-up orders are
      put at the FRONT of the queue the moment the action resolves (same turn).
   2) REGROUP: when a room is cleared and nothing else is queued, the team stacks shoulder to
      shoulder along the wall that holds the nearest door of that room, without crossing a
      doorway, POINT nearest the door frame. Nobody stands in the opening.
   ===================================================================== */
const AFTER_CFG = { modes: ['hold', 'clear', 'limited', 'assess'], gap: 0.42, press: 0.34, first: 0.78, limitedDepth: 2,
  names: { hold: 'Hold position', clear: 'Enter and clear', limited: 'Limited penetration and hold', assess: 'Assess from doorway' },
  def: { breach: 'assess', bang: 'clear', gas: 'hold' } };
const AFTER_ORDERS = ['breach', 'bang', 'gas'];
/** Door of a room: [{d, cin:[x,y] room-side cell, cout:[x,y], nx, ny (normal from the room toward the door)}]. */
function roomDoorCells(r) { const out = []; for (const d of S.doors) for (const [a, b] of d.cells) {
    const ia = roomAt(a[0], a[1]) === r, ib = roomAt(b[0], b[1]) === r; if (ia === ib) continue; const cin = ia ? a : b, cout = ia ? b : a;
    out.push({ d, cin, cout, nx: cout[0] - cin[0], ny: cout[1] - cin[1] }); } return out; }
function isDoorCell(r, x, y, nx, ny) { const e = edge(x, y, x + nx, y + ny); return e.t === 'D' || e.t === 'O' && roomAt(x + nx, y + ny) !== r; }
/** Where the team regroups after clearing room r: the run of wall cells beside the nearest door (same wall), longest side. */
function regroupSpot(u, r, n) { if (r < 0 || !S.rooms[r]) return null; n = n || Math.max(1, teamOk(u).length);
  const ds = roomDoorCells(r).sort((p, q) => dist(u.x, u.y, p.cin[0], p.cin[1]) - dist(u.x, u.y, q.cin[0], q.cin[1]));
  for (const dc of ds) { const ax = -dc.ny, ay = dc.nx; let best = null;
    for (const sd of [1, -1]) { const run = []; let x = dc.cin[0], y = dc.cin[1];
      for (let k = 1; k < 12; k++) { x += ax * sd; y += ay * sd; if (!inb(x, y) || roomAt(x, y) !== r || S.block[idx(x, y)]) break;
        if (isDoorCell(r, x, y, dc.nx, dc.ny)) break; // another doorway in the same wall: do not cross it
        const ew = edge(x, y, x + dc.nx, y + dc.ny); if (ew.t !== 'W' && ew.t !== 'X' && roomAt(x + dc.nx, y + dc.ny) === r) break; run.push([x, y]); }
      if (run.length && (!best || run.length > best.run.length)) best = { run, sd }; }
    if (!best) continue; const need = Math.max(1, Math.ceil((AFTER_CFG.first + (n - 1) * AFTER_CFG.gap) - 0.5)), k = Math.min(best.run.length, Math.max(1, Math.ceil(need / 2)));
    const c = best.run[k - 1];
    return { room: r, door: dc.d.id, x: c[0], y: c[1], k, nx: dc.nx, ny: dc.ny, ax: ax * best.sd, ay: ay * best.sd, len: best.run.length, dx0: dc.cin[0], dy0: dc.cin[1] }; }
  return null; }
/** Called when a 'clear' completes with the room empty. Queues the regroup move when nothing else is queued. */
function startRegroup(u, r) { if (u.kind !== 'team' || u.orders.length) return null; const g = regroupSpot(u, r); if (!g) return null;
  u.regroup = g; if (u.x === g.x && u.y === g.y) { faceAlong(u, g); return g; }
  u.orders.unshift({ type: 'move', x: g.x, y: g.y, regroup: r }); log(`${u.name}: stacking up on the wall by the ${S.doors[g.door].name || 'door'}.`, 'radio'); return g; }
function faceAlong(u, g) { u.dir = Math.atan2(g.ay, g.ax) + Math.PI; }
/** Formation offsets for a regrouped team: one line along the wall, POINT nearest the door frame, pressed against the wall. */
function regroupForm(u, n) { const g = u.regroup; if (!g || u.x !== g.x || u.y !== g.y || roomAt(u.x, u.y) !== g.room) return null; const pts = [];
  for (let i = 0; i < n; i++) { let s = AFTER_CFG.first + i * AFTER_CFG.gap; s = Math.min(s, g.len + 0.4); const o = s - g.k; // along-run offset from the team cell
    pts.push([+(g.ax * o + g.nx * AFTER_CFG.press).toFixed(2), +(g.ay * o + g.ny * AFTER_CFG.press).toFixed(2)]); }
  return pts; }
/** The room an action opens into (for breach: the other side of the door from the team; for throws: o.room). */
function afterRoom(u, o) { if (o.type === 'bang' || o.type === 'gas') return o.room; const d = S.doors[o.door]; if (!d) return -1;
  const here = roomAt(u.x, u.y); for (const [a, b] of d.cells) { const ra = roomAt(a[0], a[1]), rb = roomAt(b[0], b[1]); if (ra !== here) return ra; if (rb !== here) return rb; } return -1; }
/** The opening the team works through (door cell pair nearest the team, or the team cell for a window). */
function afterOpening(u, r) { let best = null; for (const dc of roomDoorCells(r)) { if (dc.d.state === 'closed') continue; const s = dist(u.x, u.y, dc.cout[0], dc.cout[1]); if (!best || s < best.s) best = Object.assign({ s }, dc); } return best; }
/** Build the follow-up orders for mode m into room r. Pure: returns the orders, does not queue them. */
function afterOrders(u, m, r) { const out = [], rm = S.rooms[r], tc = r >= 0 ? roomTargetCell(r) : null, op = r >= 0 ? afterOpening(u, r) : null;
  const face = tc ? { x: tc[0], y: tc[1] } : {};
  if (m === 'clear' && tc) out.push({ type: 'clear', room: r, x: tc[0], y: tc[1], fromAfter: true });
  else if (m === 'limited' && op) { let x = op.cin[0], y = op.cin[1], best = [x, y];
    for (let k = 1; k < AFTER_CFG.limitedDepth; k++) { x -= op.nx; y -= op.ny; if (roomAt(x, y) !== r || S.block[idx(x, y)]) break; best = [x, y]; }
    // step off the line of the doorway toward a wall
    for (const sd of [1, -1]) { const sx = best[0] + -op.ny * sd, sy = best[1] + op.nx * sd; if (roomAt(sx, sy) === r && !S.block[idx(sx, sy)] && seeE(best[0], best[1], sx, sy)) { best = [sx, sy]; break; } }
    out.push({ type: 'move', x: best[0], y: best[1], fromAfter: true }, Object.assign({ type: 'hold', fromAfter: true }, face)); }
  else if (m === 'assess' && op) { if (!(u.x === op.cout[0] && u.y === op.cout[1]) && roomAt(u.x, u.y) !== r) out.push({ type: 'move', x: op.cout[0], y: op.cout[1], fromAfter: true });
    out.push(Object.assign({ type: 'hold', assess: r, fromAfter: true }, face)); }
  else out.push(Object.assign({ type: 'hold', fromAfter: true }, face)); // hold (also the fallback when there is no room / opening)
  return out; }
/** Action resolved: put the follow-up at the front of the queue. */
/** v16: every resolved breach / throw marks the device for the first-fire rule and may draw blind fire at the threshold. */
function runAfter(u, o) { encMarkDev(o); const L = runAfter0(u, o); encThreshold(u, o); return L; }
function runAfter0(u, o) { if (!o || !o.after || o.afterDone || !AFTER_CFG.modes.includes(o.after)) return null; o.afterDone = true;
  const r = afterRoom(u, o), list = afterOrders(u, o.after, r); u.orders.unshift(...list); u.regroup = null;
  log(`${u.name}: ${AFTER_CFG.names[o.after].toLowerCase()}${r >= 0 && S.rooms[r] && S.rooms[r].known ? ' — ' + S.rooms[r].name : ''}.`, 'radio'); return list; }
/** UI/API: set (or clear) the follow-up on a queued breach / throw order. */
function setAfter(uid, i, m) { const u = unit(uid); if (!u || S.phase !== 'planning') return { ok: false, reason: 'Not now' }; const o = u.orders[i < 0 ? u.orders.length + i : i];
  if (!o || !AFTER_ORDERS.includes(o.type)) return { ok: false, reason: 'No breach or throw order' }; if (m && !AFTER_CFG.modes.includes(m)) return { ok: false, reason: 'Unknown follow-up' };
  if (o.hangOnly) return { ok: false, reason: 'Hang-only charge: choose the follow-up when you detonate' };
  if (m) o.after = m; else delete o.after; S.version++; return { ok: true, after: m || null }; }
/* v15 address labels: the target address in RED over the suspect's house (or unit); for a duplex, the neighbouring
   unit's own address (number ±2, same street) in GREEN over that unit. Derived from the brief — nothing new is saved. */
const ADDR_CFG = { target: '#ff3b4e', neighbour: '#3ddc84', step: 2 };
function addrParts() { const a = (S.brief && S.brief.addr) || '', m = /^(\d+)\s+(.*)$/.exec(a); return m ? { num: +m[1], street: m[2], full: a } : { num: 0, street: a, full: a }; }
function neighbourAddr() { const p = addrParts(), H = S.house; if (!H || !H.duplex || !p.num) return null;
  let n = H.duplex.aSide === 'L' ? p.num + ADDR_CFG.step : p.num - ADDR_CFG.step; if (n < 1) n = p.num + ADDR_CFG.step; return `${n} ${p.street}`; }
function roomsBox(rs) { if (!rs.length) return null; const x0 = Math.min(...rs.map(q => q.x)), x1 = Math.max(...rs.map(q => q.x + q.w)), y0 = Math.min(...rs.map(q => q.y)), y1 = Math.max(...rs.map(q => q.y + q.h)); return { x0, x1, y0, y1, cx: (x0 + x1) / 2 - 0.5, cy: (y0 + y1) / 2 - 0.5 }; }
/** [{text, color, target, x, y, box}] in cell coordinates (label centre). */
function addrLabels() { const p = addrParts(); if (!p.full || !S.rooms) return []; const out = [];
  const A = roomsBox(S.rooms.filter(q => !q.unitB)); if (A) out.push({ text: p.full, num: p.num, color: ADDR_CFG.target, target: true, x: A.cx, y: A.cy, box: A });
  const nb = neighbourAddr(), B = nb ? roomsBox(S.rooms.filter(q => q.unitB)) : null; if (B) out.push({ text: nb, num: +nb.split(' ')[0], color: ADDR_CFG.neighbour, target: false, x: B.cx, y: B.cy, box: B });
  return out; }
