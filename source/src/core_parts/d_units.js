
/* =====================================================================
   UNITS
   ===================================================================== */
function setupUnits(r) {
  S.units = []; S.officers = [];
  const names = r.shuffle(LAST.slice());
  const specs = ['leader', 'breacher', 'point', 'tech', 'negotiator', 'breacher', 'medic', 'marksman', 'marksman', 'k9', 'negotiator'];
  const etas = [1, 1, 2, 2, 3, 3, 4, 4, 5, 6, 4];
  const ranks = ['Sgt.', 'Ofc.', 'Cpl.', 'Ofc.', 'Det.', 'Ofc.', 'Ofc.', 'Cpl.', 'Ofc.', 'Ofc.', 'Det.'];
  specs.forEach((sp, i) => S.officers.push({ id: 'O' + i, last: names[i], name: (i === 0 ? 'Lt.' : ranks[i]) + ' ' + names[i], spec: sp, skill: +(0.62 + r() * 0.3).toFixed(2),
    status: 'enroute', eta: etas[i], team: null, stable: false, dog: sp === 'k9' ? r.pick(['Rex', 'Bruno', 'Koda', 'Max']) : null, quals: [] }));
  r.shuffle(S.officers.filter(o => !['leader', 'marksman'].includes(o.spec))).slice(0, 2).forEach(o => o.quals.push('spotter'));
  S.armory = {}; for (const k in EQUIP) S.armory[k] = EQUIP[k].pool;
  const O = S.opts || {};
  if (O.roster && O.roster.length) { // career mode: the persistent roster replaces the generated one (rng already consumed, so the map is identical)
    const etaBy = { leader: [1], breacher: [1, 3], point: [2], tech: [2], negotiator: [3, 4], medic: [4], marksman: [4, 5], k9: [6] }, used = {};
    S.officers = O.roster.map((o, i) => { const k = used[o.spec] = (used[o.spec] || 0) + 1, e = etaBy[o.spec] || [3];
      return { id: 'O' + i, careerId: o.id, last: o.last, name: (o.rank || 'Ofc.') + ' ' + o.last, spec: o.spec, skill: o.skill, status: 'enroute', eta: e[Math.min(k - 1, e.length - 1)] + (k > e.length ? 1 : 0), team: null, stable: false,
        dog: o.spec === 'k9' ? (o.dog || 'Rex') : null, quals: (o.quals || []).slice() }; }); }
  else if (O.specs && O.specs.length) { // team level (Quick Mission): staff built from the level's specialty list; own rng so the map is identical
    const q = makeRng((S.seed * 7 + O.specs.length * 131 + 17) >>> 0), pool = names.concat(q.shuffle(LAST2.slice())), used = {};
    const etaBy = { leader: [1], point: [1, 2], breacher: [1, 3], negotiator: [3, 4], medic: [3, 4], marksman: [4, 5], tech: [2, 3], k9: [5, 6] };
    const base = O.skill || 0.7;
    S.officers = O.specs.map((sp, i) => { const k = used[sp] = (used[sp] || 0) + 1, e = etaBy[sp] || [3], last = pool[i % pool.length] + (i >= pool.length ? '-' + (i + 1) : '');
      return { id: 'O' + i, last, name: (i === 0 ? 'Lt.' : sp === 'negotiator' ? 'Det.' : k === 1 && sp !== 'point' ? 'Cpl.' : 'Ofc.') + ' ' + last, spec: sp, skill: +clamp(base - 0.08 + q() * 0.22, 0.4, 0.95).toFixed(2),
        status: 'enroute', eta: e[Math.min(k - 1, e.length - 1)] + Math.floor((k - 1) / e.length), team: null, stable: false, dog: sp === 'k9' ? q.pick(['Rex', 'Bruno', 'Koda', 'Max', 'Nova']) : null, quals: [] }; });
    const cand = q.shuffle(S.officers.filter(o => !['leader', 'marksman'].includes(o.spec))); cand.slice(0, Math.max(O.spotters != null ? O.spotters : 2, 0)).forEach(o => o.quals.push('spotter')); }
  if (O.gear) for (const k in O.gear) if (k in S.armory) S.armory[k] = O.gear[k];
  S.teamMax = O.teamMax || 5;
  rebuildDyn(); setupRoadblocks(r); // three cruisers at the ends of the block, keeping traffic out
  const pn = r.shuffle(PATROL.slice()), rifle = r.int(0, 3);
  for (let i = 0; i < 4; i++) S.units.push({ uid: 'P' + (i + 1), kind: 'patrol', name: 'Ofc. ' + pn[i], num: i + 1, x: 0, y: 0, dir: -Math.PI / 2, skill: 0.35, panic: 0, status: 'ok', orders: [], vis: [],
    weapon: i === rifle ? 'rifle' : 'pistol', stance: 'return', inCar: null });
  // where P3/P4 stand (and who is in which car) is decided by the scenario variant: setupScene()
  S.teamSeq = 0; S.devSeq = 0;
}
function teamOk(t) { return t.members.map(id => off(id)).filter(o => o.status === 'ok'); }
function off(id) { return S.officers.find(o => o.id === id); }
function unit(uid) { return S.units.find(u => u.uid === uid); }
function hasSpec(t, sp) { return teamOk(t).some(o => o.spec === sp); }
function teamSkill(t) { const m = teamOk(t); if (!m.length) return 0; let s = m.reduce((a, o) => a + o.skill, 0) / m.length; if (hasSpec(t, 'leader')) s += 0.05; return clamp(s, 0, 1); }
function unitAlive(u) { return u.status === 'ok'; }
function suspectActive() { return S.suspect && !['detained', 'escaped'].includes(S.suspect.mode); }
function hostile() { return S.suspect && ['barricaded', 'alert', 'fleeing'].includes(S.suspect.mode); }
function onFoot(u) { return unitAlive(u) && (u.kind === 'patrol' ? !u.inCar : u.kind === 'team' ? u.deployed : false); }
function weaponOf(u) { if (u.kind === 'patrol') return u.weapon; if (u.kind === 'team') return hasSpec(u, 'marksman') ? 'sniper' : 'rifle'; return null; }
function skillOf(u) { return u.kind === 'team' ? teamSkill(u) : u.kind === 'patrol' ? u.skill : 0.3; }

function log(text, kind = 'radio') { S.log.push({ turn: S.turn, tick: S.tick || 0, text, kind }); S.events.push({ type: 'log', kind }); }
function fx(type, x, y, extra = {}) { S.fx.push(Object.assign({ id: ++S.fxSeq, type, x, y }, extra)); }

function setupSuspect(r) {
  // barricade room varies: any room whose only openings are doors
  const openRoom = new Set(); for (const [k, e] of S.edges) if (e === E_OPEN) { const [t, a, b] = k.split(','); const A = +a, B = +b; const p = t === 'h' ? [[A, B - 1], [A, B]] : [[A - 1, B], [A, B]]; p.forEach(c => openRoom.add(roomAt(c[0], c[1]))); }
  const W0 = { bed: 2, bath: 1.4, office: 1.6, garage: 0.6 };
  const cands = S.rooms.filter(q => W0[q.type] && !openRoom.has(q.id));
  const weights = cands.map(q => q.name === 'Master Bedroom' ? 2.6 : W0[q.type]);
  let tot = weights.reduce((a, b) => a + b, 0), pick = r() * tot, rm = cands[0];
  for (let i = 0; i < cands.length; i++) { pick -= weights[i]; if (pick <= 0) { rm = cands[i]; break; } }
  const doorCells = []; S.doors.forEach(d => { if (d.rooms.includes(rm.id)) { d.barricaded = true; d.locked = true; d.state = 'closed'; d.cells.forEach(([a, b]) => doorCells.push(roomAt(a[0], a[1]) === rm.id ? a : b)); } });
  let best = null, bs = -1;
  for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) { if (S.block[idx(x, y)]) continue;
    const s = Math.min(...doorCells.map(c => dist(c[0], c[1], x, y))) + r() * 0.5; if (s > bs) { bs = s; best = [x, y]; } }
  const wk = r.pick(['handgun', 'handgun', 'rifle', 'shotgun']);
  S.suspect = { x: best[0], y: best[1], home: { x: best[0], y: best[1] }, room: rm.id, mode: 'barricaded', stun: 0, agit: 45, cd: 0, ambush: false, hasMask: r.chance(0.05), maskOn: false, maskSeen: false, maskDon: 0, impair: 0, phone: false, talk: 0, seen: false, lastKnown: null, heat: null, unseenTurns: 0, path: null, dir: 0,
    weapon: wk, atWindow: false, suppressed: 0, duck: 0 };
}

/* ---------- cruisers ---------- */
function carAxis(c) { return Math.abs(Math.cos(c.dir)) >= Math.abs(Math.sin(c.dir)) ? 'h' : 'v'; }
function footprint(c, x = c.x, y = c.y, ax = carAxis(c)) { return ax === 'h' ? [[x - 1, y], [x, y], [x + 1, y]] : [[x, y - 1], [x, y], [x, y + 1]]; }
function rebuildDyn() { if (!S.dyn) S.dyn = new Uint8Array(MAP_W * MAP_H); S.dyn.fill(0); for (const u of S.units || []) if (u.kind === 'cruiser') for (const [x, y] of footprint(u)) if (inb(x, y)) S.dyn[idx(x, y)] = u.num; }
function carClash(x, y, self) { for (const u of S.units) { if (u.kind !== 'cruiser' || u.uid === self) continue; for (const [fx_, fy] of footprint(u)) if (cheb(fx_, fy, x, y) <= 2) return true; } return false; }
function carAt(x, y) { const n = inb(x, y) ? S.dyn[idx(x, y)] : 0; return n ? S.units.find(u => u.kind === 'cruiser' && u.num === n) : null; }
function boardCar(p, c) { p.inCar = c.uid; p.x = c.x; p.y = c.y; if (!c.occ.includes(p.uid)) c.occ.push(p.uid); p.orders = []; }
function houseCenter() { const H = S.house; return [(H.x0 + H.x1) / 2, (H.y0 + H.y1) / 2]; }
/** Which side of the car faces the house: 'driver' (left of heading) or 'passenger'. */
function houseSideOf(c) { const [hx, hy] = houseCenter(); const lx = Math.sin(c.dir), ly = -Math.cos(c.dir); // left normal (screen coords: y down)
  return ((hx - c.x) * lx + (hy - c.y) * ly) > 0 ? 'driver' : 'passenger'; }
function exitCell(c, side) { // side: 'house' | 'safe'
  const lx = Math.round(Math.sin(c.dir)), ly = Math.round(-Math.cos(c.dir)); const hs = houseSideOf(c);
  const useLeft = side === 'house' ? hs === 'driver' : hs !== 'driver'; const nx = useLeft ? lx : -lx, ny = useLeft ? ly : -ly;
  const fp = footprint(c), ord = [fp[1], fp[0], fp[2]];
  for (const [x, y] of ord) { const ex = x + nx, ey = y + ny; if (cellOk(ex, ey, { outdoor: true }) && !S.units.some(u => onFoot(u) && u.x === ex && u.y === ey)) return [ex, ey]; }
  for (const [x, y] of ord) for (const m of [2, -1, -2]) { const ex = x + nx * m, ey = y + ny * m; if (cellOk(ex, ey, { outdoor: true })) return [ex, ey]; }
  return null;
}

/* =====================================================================
   COVER & EXPOSURE
   Threat points = inside cell of every window + every open exterior door.
   Weighted toward the room where the suspect is KNOWN to be (player
   knowledge only — no cheating). S.expo[c] = weighted count of threat
   points with a clear line of fire to outdoor cell c (cover near the
   target cell cuts it: hard ×0, soft ×0.45). Used by path costs,
   move-order snapping, the auto take-cover fallback, and the renderer.
   ===================================================================== */
function knownRoom() { const sp = S.suspect; if (!sp) return -1; if (sp.visible || (sp.lastKnown && S.turn - sp.lastKnown.turn <= 2)) return sp.room; if (sp.heat && S.turn - sp.heat.turn <= 3) return sp.heat.room; return -1; }
function threatPoints() {
  const kr = knownRoom(), out = [];
  const wgt = rm => kr < 0 ? 1 : rm === kr ? 1 : 0.4;
  for (const w of S.windows) { const e = w.edges[Math.floor(w.edges.length / 2)]; out.push({ x: e[0], y: e[1], w: wgt(w.room), kind: 'window', id: w.id }); }
  for (const d of S.doors) if (d.exterior && d.state !== 'closed') { const c = d.cells[Math.floor(d.cells.length / 2)]; const a = roomAt(c[0][0], c[0][1]) >= 0 ? c[0] : c[1]; out.push({ x: a[0], y: a[1], w: wgt(roomAt(a[0], a[1])), kind: 'door', id: d.id }); }
  const sp = S.suspect; if (suspectActive() && sp.room < 0) out.push({ x: sp.x, y: sp.y, w: 1.5, kind: 'suspect' });
  return out;
}
function expoKey() { return S.doors.map(d => d.exterior ? d.state[0] : '').join('') + '|' + S.units.filter(u => u.kind === 'cruiser').map(c => c.x + ',' + c.y + carAxis(c)).join(';') + '|' + knownRoom() + '|' + (S.suspect && S.suspect.room < 0 ? S.suspect.x + ',' + S.suspect.y : ''); }
function computeExpo(force) {
  const key = expoKey(); if (!force && S.expoKey === key && S.expo) return; S.expoKey = key;
  if (!S.expo) S.expo = new Float32Array(MAP_W * MAP_H); S.expo.fill(0);
  const R = Math.min(30, SUSPECT_WEAPONS[S.suspect.weapon].range);
  S.threats = threatPoints();
  for (const t of S.threats) {
    for (let y = Math.max(1, t.y - R); y <= Math.min(MAP_H - 2, t.y + R); y++) for (let x = Math.max(1, t.x - R); x <= Math.min(MAP_W - 2, t.x + R); x++) {
      const c = idx(x, y); if (S.room[c] >= 0 || S.block[c]) continue; const d = dist(t.x, t.y, x, y); if (d > R) continue;
      const l = losEx(t.x, t.y, x, y, true); if (!l.v) continue;
      S.expo[c] += t.w * (l.cov === 2 ? 0 : l.cov === 1 ? 0.45 : 1) * (1 - 0.45 * d / R);
    }
  }
}
function expoAt(x, y) { return inb(x, y) && S.expo ? S.expo[idx(x, y)] : 0; }
function coverAdj(x, y) { // adjacent cover object (label) — prefers the one between the officer and the house
  const [hx, hy] = houseCenter(); let best = null, bs = -9;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (!inb(nx, ny)) continue; const c = idx(nx, ny);
    let lbl = 0, name = ''; if (S.dyn[c]) { lbl = 99; name = 'Cruiser ' + S.dyn[c]; } else if (S.cov[c]) { lbl = S.covLbl[c]; name = COVER_NAMES[lbl]; }
    else if ((dx === 0 || dy === 0) && S.edges.get(ek(x, y, nx, ny)) === E_FENCE) { lbl = 8; name = 'fence'; }
    else if ((dx === 0 || dy === 0) && roomAt(nx, ny) >= 0 && edge(x, y, nx, ny).t === 'X') { lbl = 7; name = 'house wall'; }
    if (!lbl) continue; const toward = (dx * (hx - x) + dy * (hy - y)) / (Math.hypot(dx, dy) * (Math.hypot(hx - x, hy - y) || 1)); if (toward > bs) { bs = toward; best = { dx, dy, name }; } }
  return best;
}
function coverInfo(x, y) {
  if (roomAt(x, y) >= 0) return { level: 'inside', expo: 0 };
  const sh = shieldAt(x, y, { range: Math.min(COVER_CFG.range, SUSPECT_WEAPONS[S.suspect.weapon].range) }), adj = coverAdj(x, y);
  const level = sh.q === 'hard' ? 'cover' : sh.q === 'conceal' ? 'partial' : 'open';
  return { level, q: sh.q, word: COVER_WORD[sh.q], lines: sh.open, expo: +expoAt(x, y).toFixed(2), obj: adj ? adj.name : (level === 'cover' ? 'out of sight-line' : ''), dx: adj ? adj.dx : 0, dy: adj ? adj.dy : 0 };
}
/** Nearest covered cell to a requested spot: hard cover first, then concealment, within COVER_CFG.snapR (widening to snapWide).
 *  Returns [x, y, quality]; quality 'open' means nothing shielded is within reach — the move keeps a warning. */
function snapCover(u, tx, ty) {
  if (roomAt(tx, ty) >= 0 || u.kind === 'drone' || u.kind === 'robot') return [tx, ty, 'inside'];
  const mo = moveOpts(u); const taken = new Set(S.units.filter(q => q !== u && onFoot(q)).map(q => q.x + ',' + q.y));
  for (const q of S.units) if (q !== u) for (const o of q.orders) if (o.type === 'move') taken.add(o.x + ',' + o.y);
  const R0 = Math.min(COVER_CFG.range, SUSPECT_WEAPONS[S.suspect.weapon].range);
  const pick = (R) => { let best = null, bs = 1e9;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const x = tx + dx, y = ty + dy, d = Math.hypot(dx, dy); if (d > R + 0.5) continue; if (!cellOk(x, y, Object.assign({}, mo, { outdoor: true })) || taken.has(x + ',' + y)) continue;
      if (d * 0.7 >= bs) continue; const sh = shieldAt(x, y, { range: R0 }); if (sh.q === 'open') continue;
      const s = d * 0.7 + (sh.q === 'conceal' ? 1.2 : 0) - (coverAdj(x, y) ? 0.2 : 0); if (s < bs) { bs = s; best = [x, y, sh.q]; } }
    return best; };
  const here = cellOk(tx, ty, Object.assign({}, mo, { outdoor: true })) ? shieldAt(tx, ty, { range: R0 }).q : 'open';
  if (here === 'hard') return [tx, ty, here];
  if (here === 'conceal') { const b = pick(2); return b && b[2] === 'hard' ? b : [tx, ty, here]; } // already concealed: only step over to hard cover right beside it
  const b = pick(COVER_CFG.snapR) || pick(COVER_CFG.snapWide);
  return b || [tx, ty, 'open'];
}
/** Automatic fallback: get behind cover, or as far from the house as possible if nothing is near. */
function seekCover(u, why) {
  if (!onFoot(u) || roomAt(u.x, u.y) >= 0) return false;
  const [hx, hy] = houseCenter(), here = expoAt(u.x, u.y);
  const D = reach(u.x, u.y, Object.assign({}, moveOpts(u), { outdoor: true, expo: true }), 16);
  const taken = new Set(S.units.filter(q => q !== u && onFoot(q)).map(q => q.x + ',' + q.y));
  let best = null, bs = here * 6 - dist(u.x, u.y, hx, hy) * 0.12;
  for (let y = Math.max(1, u.y - 12); y <= Math.min(MAP_H - 2, u.y + 12); y++) for (let x = Math.max(1, u.x - 12); x <= Math.min(MAP_W - 2, u.x + 12); x++) {
    const c = idx(x, y); if (D[c] >= 1e9 || taken.has(x + ',' + y) || S.room[c] >= 0) continue;
    const s = S.expo[c] * 6 + D[c] * 0.22 - (coverAdj(x, y) ? 0.5 : 0) - dist(x, y, hx, hy) * 0.12; if (s < bs - 0.3) { bs = s; best = [x, y]; } }
  if (!best) return false;
  u.orders = [{ type: 'move', x: best[0], y: best[1], auto: true }];
  const adj = coverAdj(best[0], best[1]); const ex = expoAt(best[0], best[1]);
  log(`${u.name}: ${why} — ${ex < 0.15 && adj ? 'taking cover behind the ' + adj.name : ex < 0.15 ? 'moving out of the line of fire' : 'pulling back away from the house'}.`, 'radio');
  return true;
}

/* =====================================================================
   VISION
   ===================================================================== */
function visParams(u) {
  const inside = roomAt(u.x, u.y) >= 0;
  switch (u.kind) {
    case 'team': if (u.perch) { const sp = spotterOf(u), R = sp ? (sp.q ? 46 : 36) : 28; return { range: R, half: 0.7, near: 1.5, glass: R }; }
      return { range: inside ? 9 : (hasSpec(u, 'marksman') ? 22 : 15), half: inside ? 1.4 : 1.25, near: 2.5 };
    case 'patrol': return { range: 13, half: 1.4, near: 1.5 };
    case 'cruiser': return { range: 13, half: 1.5, near: 2 };
    case 'drone': return { range: 7, half: Math.PI, near: 7 };
    case 'robot': return { range: 6, half: 1.6, near: 2 };
  }
  return { range: 8, half: 1.2, near: 1.5 };
}
function visParamsG(u) { const v = visParams(u), m = impairVis(u); if (m !== 1) { v.range *= m; if (v.glass) v.glass *= m; } return v; }
function computeVis(u) {
  const p = visParamsG(u), out = [];
  for (let y = Math.max(0, u.y - p.range); y <= Math.min(MAP_H - 1, u.y + p.range); y++)
    for (let x = Math.max(0, u.x - p.range); x <= Math.min(MAP_W - 1, u.x + p.range); x++) {
      const d = dist(u.x, u.y, x, y); if (d > p.range) continue;
      if (d > p.near) { let a = Math.atan2(y - u.y, x - u.x) - u.dir; a = Math.atan2(Math.sin(a), Math.cos(a)); if (Math.abs(a) > p.half) continue; }
      const l = los(u.x, u.y, x, y); if (!l) continue; if (l === 2 && d > (p.glass || 10)) continue;
      out.push(idx(x, y));
    }
  return out;
}
function watchers() { return S.units.filter(u => unitAlive(u) && (onFoot(u) || u.kind === 'drone' || u.kind === 'robot' || (u.kind === 'cruiser' && u.occ.length))); }
function updateVision() {
  S.vis.fill(0);
  const W = new Set(watchers());
  for (const u of S.units) { if (!W.has(u)) { u.vis = []; continue; } u.vis = computeVis(u); for (const c of u.vis) S.vis[c] = 1; }
  for (const c of S.peek) S.vis[c] = 1;
  for (const u of W) if (u.slice && u.slice.ox === u.x && u.slice.oy === u.y && u.slice.cells.length) { for (const c of u.slice.cells) S.vis[c] = 1; u.vis = u.vis.concat(u.slice.cells); } // pie-slice reveal
  // mutual sight: if the suspect has a clear line to one of our units inside sight range, that unit sees him too (no facing needed)
  const sp0 = S.suspect;
  if (sp0 && suspectActive()) { const sc = idx(sp0.x, sp0.y); for (const u of W) { if (u.kind === 'cruiser' || !u.vis || u.vis.includes(sc)) continue; const p = visParamsG(u);
    if (dist(u.x, u.y, sp0.x, sp0.y) <= p.range && los(sp0.x, sp0.y, u.x, u.y) === 1 && los(u.x, u.y, sp0.x, sp0.y) === 1) { u.vis.push(sc); S.vis[sc] = 1; } } }
  // per-cell memory: indoor cells we have actually had eyes on (through open doors/doorways), drawn even while the room is not yet "explored"
  if (!S.seenCell || S.seenCell.length !== S.vis.length) S.seenCell = new Uint8Array(S.vis.length);
  for (let c = 0; c < S.vis.length; c++) if (S.vis[c] && S.room[c] >= 0) S.seenCell[c] = 1;
  const counts = new Array(S.rooms.length).fill(0);
  for (let c = 0; c < S.vis.length; c++) if (S.vis[c]) { const rr = S.room[c]; if (rr >= 0) counts[rr]++; }
  S.rooms.forEach((rm, i) => { const occupied = S.units.some(u => unitAlive(u) && (u.kind === 'team' ? u.deployed : u.kind === 'drone' || u.kind === 'robot') && roomAt(u.x, u.y) === i);
    if (!rm.explored && (occupied || counts[i] >= rm.w * rm.h * 0.3)) { rm.explored = true; if (!rm.known) rm.known = true; log(`${rm.name} now in view.`, 'intel'); } });
  S.doors.forEach(d => { if (d.exterior || d.rooms.some(q => q >= 0 && S.rooms[q].explored)) d.known = true; });
  S.doors.forEach(d => { if (d.storm && !d.stormKnown && d.cells.some(([a, b]) => (roomAt(a[0], a[1]) < 0 && S.vis[idx(a[0], a[1])]) || (roomAt(b[0], b[1]) < 0 && S.vis[idx(b[0], b[1])]))) { d.stormKnown = true; log(`${d.name}: outer storm door spotted — pry will take longer.`, 'intel'); } });
  const sp = S.suspect;
  if (sp && suspectActive() && (S.vis[idx(sp.x, sp.y)] || (sp.walk && sp.room < 0))) { // a walk-out in the yard is watched by everyone
    if (!sp.seen) { log(`CONTACT — suspect visual in ${S.rooms[sp.room] ? S.rooms[sp.room].name : 'yard'}!`, 'alert'); const sc = idx(sp.x, sp.y), who = [];
      for (const u of W) if (u.kind === 'team' && u.vis.includes(sc)) who.push(...teamOk(u).map(o => o.id)); xpAct('locate', who.length ? who : null); }
    sp.seen = true; sp.visible = true; sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn }; sp.heat = null;
  } else if (sp) sp.visible = false;
  containStatus();
}
