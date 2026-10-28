
/* =====================================================================
   PER-ACTION EXPERIENCE · STATE TEAM HAND-OVER · SCENARIO PREVIEW
   Every useful individual action is logged with the officers who did it, so a mission that
   is handed to the State SWAT team still pays out the experience for those actions
   (but never the mission-completion XP). Values are data — retune here.
   ===================================================================== */
const ACT_XP = {
  breach:    { xp: 15, cap: 6, label: 'Door breached' },
  clear:     { xp: 10, cap: 10, label: 'Room cleared' },
  corner:    { xp: 6,  cap: 10, label: 'Corner worked (pie slice)' },
  threat:    { xp: 15, cap: 3, label: 'Threat found while slicing a corner' },
  aid:       { xp: 20, cap: 6, label: 'First aid rendered' },
  rescue:    { xp: 20, cap: 6, label: 'Casualty moved to cover' },
  evac:      { xp: 25, cap: 6, label: 'Casualty handed to EMS' },
  locate:    { xp: 15, cap: 1, label: 'Suspect located' },
  contain:   { xp: 20, cap: 1, label: 'Containment established' },
  contact:   { xp: 15, cap: 3, label: 'Negotiation contact made' },
  dialogue:  { xp: 4,  cap: 8, label: 'Dialogue round' },
  overwatch: { xp: 10, cap: 3, label: 'Overwatch set' },
  bang:      { xp: 8,  cap: 4, label: 'Flashbang on the suspect' },
  detain:    { xp: 40, cap: 1, label: 'Suspect taken into custody' },
};
function crewIds(u) { return !u ? [] : Array.isArray(u) ? u : u.kind === 'team' ? teamOk(u).map(o => o.id) : []; }
/** Log one action for XP. who: a unit (team members get it), an officer-id array, or null (command / patrol → team XP only). */
function xpAct(key, who, detail) { const A = ACT_XP[key]; if (!A || !S) return; S.xpLog = S.xpLog || [];
  if (S.xpLog.filter(x => x.key === key).length >= A.cap) return;
  const ids = crewIds(who); S.xpLog.push({ key, label: A.label, xp: A.xp, ids, by: who && who.name ? who.name : who && who.length ? 'officers' : 'command', detail: detail || '', turn: S.turn }); }
function xpSummary() { const by = {}; for (const x of S.xpLog || []) { const b = by[x.key] = by[x.key] || { key: x.key, label: x.label, n: 0, xp: 0, per: x.xp }; b.n++; b.xp += x.xp * Math.max(1, x.ids.length); }
  const rows = Object.values(by); return { rows, total: rows.reduce((a, r) => a + r.xp, 0) }; }
/** Career mode: give the scene to the State SWAT team. Ends the mission; only per-action XP is kept. */
function callState() { if (S.phase === 'over') return { ok: false, reason: 'Mission already over' };
  if (!(S.opts && S.opts.career)) return { ok: false, reason: 'Only in Career Mode' };
  S.phase = 'over'; S.stats.stateTeam = true;
  S.result = { win: false, title: 'STATE SWAT TEAM TAKES OVER', text: `Command requested the State SWAT team after ${tMin(S.turn)}. The scene is handed over — the unit keeps only the experience from individual actions, no mission-completion credit.` };
  log('Command: State SWAT team requested — our units hold the perimeter and hand over.', 'system'); finishMission(); return { ok: true }; }
/** Scenario facts for the call-in screen, without disturbing the current game. diff: 1 (routine) … 3 (high risk). */
function preview(seed, opts) { const keep = S; let out;
  try { newGame(seed, opts || {}); const B = S.brief, sp = S.suspect;
    let diff = 1 + (B.shots ? 0.5 : 0) + (B.officerDown ? 0.8 : 0) + (sp.weapon !== 'handgun' ? 0.4 : 0) + (ownRooms().length >= 9 ? 0.3 : 0) + (S.scene && S.scene.variant === 'gap' ? 0.2 : 0)
      + 0.3 * (suspList().length - 1) + (S.stype.key === 'drughouse' ? 0.5 : 0) + (suspList().some(q => q.armor && q.armor !== 'none') ? 0.2 : 0) + (S.duplex && S.duplex.residents ? 0.1 : 0);
    diff = +clamp(diff, 1, 3).toFixed(1);
    out = { seed: S.seed, op: S.opName, type: B.type, stype: S.stype.key, stypeName: S.stype.name, addr: B.addr, time: B.time, shots: !!B.shots, officerDown: !!B.officerDown, sawGun: !!B.sawGun, area: S.geo.name, arch: S.house.archName, struct: S.house.struct || 'house', diff,
      label: diff >= 2.3 ? 'HIGH RISK' : diff >= 1.6 ? 'ELEVATED' : 'ROUTINE' }; }
  finally { S = keep; }
  return out; }

/* =====================================================================
   WORK THE CORNER (slicing the pie)
   At a corner (hall corner, door frame, house corner) the unit opens the hidden area in
   45° cuts, one cut every CORNER_CFG.ticks ticks, stopping the moment a threat is seen.
   Cells revealed this way join the unit's vision while it stays put.
   ===================================================================== */
const CORNER_CFG = { ticks: 2, cuts: 4, step: Math.PI / 4, minHidden: 4, rangeIn: 8, rangeOut: 12, hitBase: 0.35, hitPerCut: 0.05, tryMult: 0.6 };
function vis360(x, y, R) { const out = new Set(); for (let yy = Math.max(0, y - R); yy <= Math.min(MAP_H - 1, y + R); yy++) for (let xx = Math.max(0, x - R); xx <= Math.min(MAP_W - 1, x + R); xx++) {
  if (dist(x, y, xx, yy) > R) continue; const l = los(x, y, xx, yy); if (l === 1 || (l === 2 && dist(x, y, xx, yy) <= 3)) out.add(idx(xx, yy)); } return out; }
/** Best corner from (x,y): a neighbouring step that opens ground hidden from here. → {px,py,a,hidden:[cells sorted by cut angle]} | null */
function cornerAt(x, y, u) {
  const R = roomAt(x, y) >= 0 ? CORNER_CFG.rangeIn : CORNER_CFG.rangeOut, here = vis360(x, y, R); let best = null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const px = x + dx, py = y + dy;
    if (!cellOk(px, py, { avoidSuspect: false }) || !seeE(x, y, px, py)) continue; if (u && u.kind === 'patrol' && roomAt(px, py) >= 0) continue;
    const a = Math.atan2(dy, dx), hid = [];
    for (const c of vis360(px, py, R)) { if (here.has(c)) continue; const cx = c % MAP_W, cy = (c / MAP_W) | 0; let t = Math.atan2(cy - py, cx - px) - a; t = Math.abs(Math.atan2(Math.sin(t), Math.cos(t))); hid.push([c, t]); }
    if (hid.length >= CORNER_CFG.minHidden && (!best || hid.length > best.hidden.length)) best = { px, py, a, hidden: hid.sort((p, q) => p[1] - q[1]) }; }
  return best; }
function cornerAvail(u) { if (!u || !onFoot(u) || u.perch) return 'Unit must be on foot'; const c = cornerAt(u.x, u.y, u); return c ? c : 'No corner here — stand at a hallway corner, door frame or house corner'; }
/** One tick of corner work. Returns true while still working. */
function cornerTick(u, o) {
  if (!o.c) { const c = cornerAt(u.x, u.y, u); if (!c) { log(`${u.name}: no corner to work from here.`, 'radio'); popOrder(u); return; } o.c = { px: c.px, py: c.py, a: c.a, hidden: c.hidden }; o.cut = 0; o.t = 0; o.ox = u.x; o.oy = u.y;
    u.slice = { ox: u.x, oy: u.y, px: c.px, py: c.py, cells: [], cut: 0, active: true }; log(`${u.name}: working the corner toward the ${dirWord(c.a)} — slicing the pie.`, 'radio'); }
  if (u.x !== o.ox || u.y !== o.oy) { popOrder(u); return; }
  u.dir = o.c.a; u.holding = true; o.t++; if (o.t % CORNER_CFG.ticks) return;
  o.cut++; const lim = o.cut * CORNER_CFG.step, add = o.c.hidden.filter(h => h[1] <= lim && h[1] > lim - CORNER_CFG.step).map(h => h[0]);
  u.slice.cells.push(...add); u.slice.cut = o.cut; u.dir = o.c.a + (o.c.hidden.length ? Math.sign(o.c.hidden[o.c.hidden.length - 1][1]) * 0 : 0);
  updateVision(); const sp = suspList().find(s => spHostile(s) && u.slice.cells.includes(idx(s.x, s.y))) || S.suspect;
  if (withSp(sp, () => suspectActive() && hostile()) && u.slice.cells.includes(idx(sp.x, sp.y))) { u.dir = Math.atan2(sp.y - u.y, sp.x - u.x); u.slice.active = false; u.slice.threat = true; popOrder(u);
    log(`${u.name}: THREAT — suspect seen around the corner (cut ${o.cut}, ${o.cut * 45}°). Corner work stopped.`, 'alert'); fx('text', u.x, u.y, { text: 'THREAT', color: '#ff5d6c' }); xpAct('threat', u); return; }
  const left = o.c.hidden.filter(h => h[1] > lim).length;
  if (o.cut >= CORNER_CFG.cuts || !left) { u.slice.active = false; popOrder(u); log(`${u.name}: corner clear (${o.cut} cut${o.cut > 1 ? 's' : ''}, ${Math.min(180, o.cut * 45)}°).`, 'good'); fx('text', u.x, u.y, { text: 'CORNER CLEAR', color: '#3ef0a0' }); xpAct('corner', u); return; }
  log(`${u.name}: cut ${o.cut} — ${o.cut * 45}° open, nothing seen.`, 'radio');
}
function dirWord(a) { const d = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east']; return d[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]; }
/** Suspect side: an officer slicing the pie is only exposed where his slice reaches the suspect — and only partly. */
function sliceExposed(u, px, py) { return u.slice && u.slice.ox === u.x && u.slice.oy === u.y && u.slice.cells.includes(idx(px, py)); }
function sliceHit(u) { return CORNER_CFG.hitBase + CORNER_CFG.hitPerCut * ((u.slice && u.slice.cut) || 1); }

/* =====================================================================
   FORMATIONS — where each team member stands (presentation helper, derived from context).
   Returns cell-space offsets from the team's cell centre, one per fit member.
   ===================================================================== */
const FORM_CFG = { gap: 0.4, lat: 0.3, stagger: 0.2, fan: 0.55, wall: 0.3, wallIn: 0.16, wallRad: 3.3, frame: 0.36, frameLat: 0.36 };
function formationFor(u) {
  if (!u || u.kind !== 'team' || !u.deployed || u.perch) return { kind: 'none', pts: [] };
  const n = teamOk(u).length; if (!n) return { kind: 'none', pts: [] };
  const inside = roomAt(u.x, u.y) >= 0, d = u.dir || 0, fx_ = Math.cos(d), fy_ = Math.sin(d), lx = -fy_, ly = fx_;
  const okPos = (ox, oy) => { const cx = Math.round(u.x + ox), cy = Math.round(u.y + oy); if (!inb(cx, cy) || S.block[idx(cx, cy)]) return false; if (cx === u.x && cy === u.y) return true;
    if (Math.abs(cx - u.x) + Math.abs(cy - u.y) === 1) return seeE(u.x, u.y, cx, cy) && (!inside || roomAt(cx, cy) === roomAt(u.x, u.y) || roomAt(cx, cy) >= 0 || true); return los(u.x, u.y, cx, cy) === 1; };
  const fit = (ox, oy) => { for (const t of [1, 0.75, 0.5, 0.25]) if (okPos(ox * t, oy * t)) return [+(ox * t).toFixed(2), +(oy * t).toFixed(2)]; return [0, 0]; };
  // context: at a door (a breach/pole cam order on this door, standing next to a closed door, or holding at an open one)
  let door = null; const o = u.orders[0];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const e = edge(u.x, u.y, u.x + dx, u.y + dy); if (e.t === 'D' && (e.d.state === 'closed' || (o && o.door === e.d.id) || !o)) { door = { dx, dy, d: e.d }; break; } }
  const moving = u.moved != null && S.phase === 'executing' && S.tick - u.moved <= 1;
  const pts = []; let kind;
  if (door && !moving) { kind = 'stack'; return { kind, pts: doorStack(u, door, n, okPos) }; }
  if (moving || (inside && hallLike(roomAt(u.x, u.y)))) { kind = 'column'; // staggered column hugging alternating walls
    const W = FORM_CFG.wall; for (let i = 0; i < n; i++) { const s = (i % 2 ? 1 : -1) * (moving && !inside ? FORM_CFG.stagger : W); pts.push(fit(fx_ * 0.2 - fx_ * i * FORM_CFG.gap + lx * s, fy_ * 0.2 - fy_ * i * FORM_CFG.gap + ly * s)); }
    return { kind, pts }; }
  if (inside) { const w = wallSpots(u, n); if (w) return { kind: 'wall', pts: w };
    kind = 'fan'; for (let i = 0; i < n; i++) { const a = d + (n === 1 ? 0 : -1.1 + 2.2 * i / (n - 1)); pts.push(fit(Math.cos(a) * FORM_CFG.fan, Math.sin(a) * FORM_CFG.fan)); } return { kind, pts }; }
  { const cv = coverAdj(u.x, u.y); kind = cv ? 'cover' : 'line'; // outside: spread along the cover edge (or a line abreast)
    let ax, ay, bx2 = 0, by2 = 0; if (cv) { const L = Math.hypot(cv.dx, cv.dy); ax = -cv.dy / L; ay = cv.dx / L; bx2 = cv.dx / L * 0.22; by2 = cv.dy / L * 0.22; } else { ax = lx; ay = ly; bx2 = -fx_ * 0.1; by2 = -fy_ * 0.1; }
    for (let i = 0; i < n; i++) { const k = (i - (n - 1) / 2) * FORM_CFG.gap * (n > 5 ? 0.85 : 1); pts.push(fit(ax * k + bx2, ay * k + by2)); } }
  return { kind, pts };
}
/** Door stack: POINT and DEFENSE (members 1 and 2) shoulder-to-frame on either side of the opening, partly exposed; everyone else
    lined up against the wall beside the door, OUT of the opening's line of fire. Offsets are from the team's cell centre. */
function doorStack(u, door, n, okPos) { const fwd = FORM_CFG.frame, lat = FORM_CFG.frameLat, ax = -door.dy, ay = door.dx, pts = [];
  const cellOk = (ox, oy) => { const cx = Math.round(u.x + ox), cy = Math.round(u.y + oy); return okPos(ox, oy) && roomAt(cx, cy) === roomAt(u.x, u.y); };
  const side = cellOk(ax * 1, ay * 1) ? 1 : cellOk(-ax, -ay) ? -1 : 0;
  pts.push([+(door.dx * fwd + ax * lat * (side || 1)).toFixed(2), +(door.dy * fwd + ay * lat * (side || 1)).toFixed(2)]); // point: at the frame
  if (n > 1) pts.push([+(door.dx * fwd - ax * lat * (side || 1)).toFixed(2), +(door.dy * fwd - ay * lat * (side || 1)).toFixed(2)]); // defense: opposite frame
  for (let i = 2; i < n; i++) { const j = i - 1, along = 0.55 + j * FORM_CFG.gap; let p = null;
    for (const sd of side ? [side, -side] : [1, -1]) { const ox = door.dx * (fwd - 0.05) + ax * sd * along, oy = door.dy * (fwd - 0.05) + ay * sd * along; if (cellOk(ox, oy)) { p = [ox, oy]; break; } }
    if (!p) { const back = 0.35 + j * FORM_CFG.gap * 0.8; for (const sd of [side || 1, -(side || 1)]) { const ox = -door.dx * back + ax * sd * 0.55, oy = -door.dy * back + ay * sd * 0.55; if (cellOk(ox, oy)) { p = [ox, oy]; break; } } }
    if (!p) p = [-door.dx * (0.3 + 0.1 * j) + ax * (side || 1) * 0.45, -door.dy * (0.3 + 0.1 * j) + ay * (side || 1) * 0.45];
    pts.push([+p[0].toFixed(2), +p[1].toFixed(2)]); }
  return pts; }
/** Inside a room: spots hugging the walls near the team (corners preferred), spread corner-to-corner; point on the wall nearest the entry. */
function wallSpots(u, n) { const r = roomAt(u.x, u.y), rad = FORM_CFG.wallRad, W = 0.5 - FORM_CFG.wallIn, c = [];
  for (let y = u.y - 4; y <= u.y + 4; y++) for (let x = u.x - 4; x <= u.x + 4; x++) { if (!inb(x, y) || roomAt(x, y) !== r || S.block[idx(x, y)] || dist(x, y, u.x, u.y) > rad) continue;
    if (!(x === u.x && y === u.y) && los(u.x, u.y, x, y) !== 1) continue;
    let ox = 0, oy = 0, walls = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (!inb(nx, ny) || roomAt(nx, ny) !== r) { ox += dx * W; oy += dy * W; walls++; } }
    if (!walls) continue; c.push({ ox: x - u.x + ox, oy: y - u.y + oy, walls, d: dist(x, y, u.x, u.y) }); }
  if (c.length < Math.min(n, 2)) return null;
  const back = u.dir || 0, bx = -Math.cos(back), by = -Math.sin(back), pick = [];
  // point: wall spot nearest the team, toward the side it came from (entry)
  c.sort((a, b) => (a.d - (a.ox * bx + a.oy * by) * 0.3 - a.walls * 0.1) - (b.d - (b.ox * bx + b.oy * by) * 0.3 - b.walls * 0.1)); pick.push(c[0]);
  while (pick.length < n) { let best = null, bs = -1e9; for (const q of c) { const m = Math.min(...pick.map(p => Math.hypot(p.ox - q.ox, p.oy - q.oy))); const s = Math.min(m, 2.2) + q.walls * 0.5 - q.d * 0.12;
      const sc = s - (m < 0.3 ? 5 : 0); if (sc > bs) { bs = sc; best = q; } }
    pick.push(best); }
  return pick.map(p => [+p.ox.toFixed(2), +p.oy.toFixed(2)]); }
function hallLike(r) { const rm = S.rooms[r]; return !!rm && (/hall|corridor/i.test(rm.name) || Math.min(rm.w, rm.h) <= 2); }

/* =====================================================================
   FIRST ARRIVALS — at least one SWAT officer is always on scene at the start.
   Usually 1–3 (the closest responders), sometimes a larger group, and a small chance the whole
   team arrives together. Own rng (seeded from the scenario) so the map and suspect stay identical.
   ===================================================================== */
const ARRIVE_CFG = { allP: 0.065, groupP: 0.22, few: [[1, 0.45], [2, 0.35], [3, 0.2]], group: [4, 6],
  allWhy: ['The whole team was training together at the range and arrived as one group.',
    'The whole team was clearing from another call nearby and arrived as one group.',
    'The whole team was at a briefing at the station and rolled out together — everyone arrived as one group.'] };
function initialArrivals() {
  const q = makeRng(((S.seed * 2246822519) ^ 0x5bd1e995) >>> 0), offs = S.officers, n = offs.length; if (!n) return null;
  let mode, k; const r = q();
  if (r < ARRIVE_CFG.allP) { mode = 'all'; k = n; }
  else if (r < ARRIVE_CFG.allP + ARRIVE_CFG.groupP && n > 3) { mode = 'group'; k = Math.min(n - 1, q.int(ARRIVE_CFG.group[0], ARRIVE_CFG.group[1])); }
  else { mode = 'few'; let x = q(), acc = 0; k = 1; for (const [v, p] of ARRIVE_CFG.few) { acc += p; if (x < acc) { k = v; break; } } k = Math.min(k, Math.max(1, n - 1)); }
  k = Math.max(1, Math.min(n, k));
  // the closest responders (lowest ETA) are first; ties broken by the arrival rng
  const order = offs.map(o => ({ o, k: o.eta + q() * 0.9 })).sort((a, b) => a.k - b.k).map(x => x.o);
  const first = order.slice(0, k); first.forEach(o => { o.status = 'staged'; o.eta = 0; o.firstIn = true; });
  const why = mode === 'all' ? q.pick(ARRIVE_CFG.allWhy) : mode === 'group' ? `${k} team members were together nearby and arrived at the same time.` : k === 1 ? `${first[0].name} was closest and is already on scene.` : `${k} team members were closest and are already on scene.`;
  S.arrival = { mode, count: k, of: n, why, ids: first.map(o => o.id) };
  return S.arrival;
}
