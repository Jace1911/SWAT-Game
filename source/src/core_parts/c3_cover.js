
/* =====================================================================
   COVER QUALITY — real sight-line checks from every window pane and
   exterior doorway of the target house.
   hard    = every line that reaches the cell passes a solid object close
             to it (car, cruiser, tree trunk, shed, building, utility box)
             or is blocked outright: rounds are stopped.
   conceal = every line is screened, but at least one only by soft
             screening (hedge, fence, mailbox): he can't see you well,
             yet rounds go straight through.
   open    = at least one window/door has a clean line to the cell.
   ===================================================================== */
const COVER_CFG = { range: 30, postSep: 5, search: 6, searchWide: 10, snapR: 4, snapWide: 7, doorPad: 2 };
let COV_STATIC = false; // when true, cruisers are ignored as cover (they drive away)
function shotPoints() {
  if (S._shotPts) return S._shotPts; const out = [];
  for (const w of S.windows) for (const e of w.edges) out.push({ x: e[0], y: e[1], kind: 'window' });
  for (const d of S.doors) if (d.exterior) for (const [a, b] of d.cells) { const o = roomAt(a[0], a[1]) < 0 ? a : b; out.push({ x: o[0], y: o[1], kind: 'door', door: d.id }); }
  return (S._shotPts = out);
}
/** Shielding of an outdoor cell against every window and exterior door in range. */
function shieldAt(x, y, o = {}) {
  const R = o.range || COVER_CFG.range; let seen = 0, hard = 0, soft = 0, open = 0;
  const prev = COV_STATIC; if (o.static) COV_STATIC = true;
  for (const p of shotPoints()) { if (p.x === x && p.y === y) { open++; continue; } if (dist(p.x, p.y, x, y) > R) continue;
    const l = losEx(p.x, p.y, x, y, true); if (!l.v) continue; seen++; if (l.cov === 2) hard++; else if (l.cov === 1) soft++; else open++; }
  COV_STATIC = prev;
  return { q: open ? 'open' : soft ? 'conceal' : 'hard', seen, hard, soft, open };
}
/** Outside cells of every window and exterior door, tagged with the house side they face. */
function watchPts() {
  if (S._watchPts) return S._watchPts; const H = S.house, out = [];
  const side = (x, y) => y < H.y0 ? 'rear' : y > H.y1 ? 'front' : x < H.x0 ? 'left' : x > H.x1 ? 'right' : (y - H.y0 < H.y1 - y ? 'rear' : 'front');
  for (const w of S.windows) { const e = w.edges[0]; out.push({ x: e[2], y: e[3], side: side(e[2], e[3]), win: w.id }); }
  for (const d of S.doors) if (d.exterior) for (const [a, b] of d.cells) { const o = roomAt(a[0], a[1]) < 0 ? a : b; out.push({ x: o[0], y: o[1], side: side(o[0], o[1]), door: d.id }); break; }
  return (S._watchPts = out);
}
/** Window/door openings an officer at (x,y) can actually watch (clear line of sight, in range); sides = set of house sides watched. */
function watchAt(x, y, R = COVER_CFG.range) { let n = 0; const sides = new Set();
  for (const p of watchPts()) { if (dist(p.x, p.y, x, y) > R) continue; if (p.x === x && p.y === y || los(x, y, p.x, p.y)) { n++; sides.add(p.side); } }
  return { n, sides }; }
/** Sides of the house that have openings (windows/doors) — the ones a suspect could leave by. */
function houseSides() { return [...new Set(watchPts().map(p => p.side))]; }
/** Temporarily park a virtual cruiser (horizontal, centred on cx,cy) and run f. */
function withVirtualCar(cx, cy, f) { const cells = [[cx - 1, cy], [cx, cy], [cx + 1, cy]].filter(([x, y]) => inb(x, y)).map(([x, y]) => idx(x, y)); const sv = cells.map(c => S.dyn[c]); cells.forEach(c => { if (!S.dyn[c]) S.dyn[c] = 99; });
  try { return f(); } finally { cells.forEach((c, i) => S.dyn[c] = sv[i]); } }
const COVER_WORD = { hard: 'hard cover', conceal: 'concealment', open: 'exposed' };
/** Name of the cover object that shields a cell (adjacent, preferring the house side). */
function shieldName(x, y) { const a = coverAdj(x, y); return a ? a.name : 'out of sight-line'; }

/* ---------- containment posts ---------- */
function nearDoorOut(x, y, pad) { for (const p of shotPoints()) if (p.kind === 'door' && cheb(p.x, p.y, x, y) <= pad) return true; return false; }
function postCellOk(x, y, D) { if (!inb(x, y)) return false; const c = idx(x, y); return cellOk(x, y, { outdoor: true }) && !S.dyn[c] && D[c] < 1e9 && !nearDoorOut(x, y, COVER_CFG.doorPad) && !S.contain.some(q => dist(q.x, q.y, x, y) < COVER_CFG.postSep); }
function findPost(ix, iy, R, D) {
  let best = null, bs = 1e9;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const x = ix + dx, y = iy + dy, d = Math.hypot(dx, dy); if (d > R + 0.5 || !postCellOk(x, y, D)) continue;
    const pre = d * 0.45; if (pre > bs) continue;
    const sh = shieldAt(x, y, { static: true }); if (sh.q === 'open') continue; const wa = watchAt(x, y); if (!wa.n) continue; // must be shielded AND able to watch windows/doors
    const s = pre + (sh.q === 'conceal' ? 1.6 : 0) - Math.min(wa.n, 6) * 0.08 - wa.sides.size * 0.25 - (coverAdj(x, y) ? 0.3 : 0); if (s < bs) { bs = s; best = { x, y, sh }; } }
  return best;
}
/** Grass cell where procedural cover may go: not paved, not blocking a doorway, a walk or a building. */
function coverCellFree(x, y) { if (!inb(x, y) || x < 2 || y < 2 || x > MAP_W - 3 || y > MAP_H - 3) return false; const c = idx(x, y);
  return !S.block[c] && !S.dyn[c] && S.room[c] < 0 && !S.paved[c] && !nearDoorOut(x, y, 2) && !S.contain.some(q => q.x === x && q.y === y) && !S.units.some(u => onFoot(u) && u.x === x && u.y === y); }
/** No natural cover near a perimeter post: add some (hedge row, tree cluster or utility boxes) on the house side. */
function addPostCover(r, ix, iy, D) {
  const cands = []; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = ix + dx, y = iy + dy; if (postCellOk(x, y, D) && !S.paved[idx(x, y)]) cands.push([x, y, Math.hypot(dx, dy)]); }
  cands.sort((a, b) => a[2] - b[2]);
  for (const [px, py] of cands.slice(0, 24)) {
    const add = new Map(); let fail = false;
    for (let round = 0; round < 3 && !fail; round++) {
      const tmp = [...add.keys()].map(Number); tmp.forEach(c => { S.cov[c] = 2; S.block[c] = 1; });
      const need = []; for (const p of shotPoints()) { if (dist(p.x, p.y, px, py) > COVER_CFG.range) continue; COV_STATIC = true; const l = losEx(p.x, p.y, px, py, true); COV_STATIC = false; if (l.v && l.cov === 0) need.push(p); }
      tmp.forEach(c => { S.cov[c] = 0; S.block[c] = 0; });
      if (!need.length) break;
      for (const p of need) { const a = Math.atan2(p.y - py, p.x - px); let ok = false;
        for (const k of [1, 1.6]) { const x = px + Math.round(Math.cos(a) * k), y = py + Math.round(Math.sin(a) * k); if (x === px && y === py) continue; if (add.has(idx(x, y))) { ok = true; break; } if (coverCellFree(x, y)) { add.set(idx(x, y), [x, y]); ok = true; break; } }
        if (!ok) { fail = true; break; } }
    }
    if (fail || !add.size || add.size > 7) continue;
    const cells = [...add.values()]; const kind = cells.length <= 2 ? 'box' : r.chance(0.5) ? 'hedge' : 'trees';
    const saved = cells.map(([x, y]) => { const c = idx(x, y); return [c, S.block[c], S.cov[c], S.covLbl[c]]; });
    const lbl = kind === 'box' ? 11 : kind === 'hedge' ? 2 : 1;
    cells.forEach(([x, y]) => { const c = idx(x, y); S.block[c] = 1; S.cov[c] = lbl === 2 ? 1 : 2; S.covLbl[c] = lbl; });
    const sh = shieldAt(px, py, { static: true });
    // still connected to the street network: a short local search must reach a cell (≥6 m away) that staging could reach before
    const watched = watchAt(px, py).n > 0;
    let linked = false; if (sh.q !== 'open' && watched) { const L = reach(px, py, { outdoor: true }, 16); for (let y = py - 16; y <= py + 16 && !linked; y++) for (let x = px - 16; x <= px + 16; x++) { if (!inb(x, y)) continue; const c = idx(x, y); if (L[c] < 1e9 && D[c] < 1e9 && Math.hypot(x - px, y - py) >= 6) { linked = true; break; } } }
    if (sh.q === 'open' || !watched || !linked) { saved.forEach(([c, b, v, l]) => { S.block[c] = b; S.cov[c] = v; S.covLbl[c] = l; }); continue; }
    const X = S.ext; if (!X.boxes) X.boxes = []; X.added = X.added || [];
    for (const [x, y] of cells) { if (kind === 'box') X.boxes.push({ x, y }); else if (kind === 'hedge') X.hedges.push({ x, y, w: 1, h: 1, added: true }); else X.trees.push({ x, y, r: 1.2 + r() * 0.5, hue: r() }); }
    X.added.push({ kind, x: px, y: py, n: cells.length });
    return { x: px, y: py, sh, kind };
  }
  return null;
}
/** Street post in front of the house: behind a parked car if one already screens it, otherwise a spot a cruiser parked
    at the curb would screen (flagged 'cruiser' cover — exposed until a cruiser is driven up). No cover is ever added in the front yard. */
function findStreetPost(ix, D, used) {
  const G = S.geo; let best = null, bs = 1e9;
  for (let x = ix - 9; x <= ix + 9; x++) for (let y = G.ST + 1; y <= Math.min(G.SB - 1, G.ST + 3); y++) {
    if (!postCellOk(x, y, D)) continue; const pre = Math.abs(x - ix) * 0.3 + (y - G.ST - 2) ** 2 * 0.5; if (pre > bs) continue;
    if (!watchAt(x, y).n) continue;
    const sh = shieldAt(x, y, { static: true });
    if (sh.q === 'hard') { const s = pre - 1; if (s < bs) { bs = s; best = { x, y, sh, q: 'hard' }; } continue; }
    const cy = y - 1; if (!S.drive[idx(x, cy)] || used.some(c => Math.abs(c[0] - x) < 5 && Math.abs(c[1] - cy) < 3)) continue;
    const vs = withVirtualCar(x, cy, () => shieldAt(x, y)); if (vs.q === 'open') continue;
    const s = pre + (vs.q === 'conceal' ? 2 : 0); if (s < bs) { bs = s; best = { x, y, sh: vs, q: 'cruiser', car: { x, y: cy } }; } }
  return best;
}
/** Containment points: 4 corners + front + rear. Rear/sides use natural cover, then house / neighbour-house corners
    (walls stop rounds), procedural cover only as a last resort; the front posts are in the street behind cruisers. */
function genContain(r) {
  r = r || makeRng(S.seed * 13 + 5);
  const H = S.house, hc = Math.round((H.x0 + H.x1) / 2); S.contain = []; S._watchPts = null;
  const D = reach(S.ext.staging.x, S.ext.staging.y, { outdoor: true }, 1e6);
  const ideals = [[H.x0 - 4, H.y0 - 3, 'Rear-Left'], [H.x1 + 4, H.y0 - 3, 'Rear-Right'], [H.x0 - 4, H.y1 + 4, 'Front-Left'], [H.x1 + 4, H.y1 + 4, 'Front-Right'], [hc, H.y0 - 5, 'Rear'], [hc, H.y1 + 6, 'Front']];
  S.contain.added = 0; const used = [];
  for (const [ix, iy, name] of ideals) {
    if (name.startsWith('Front')) { const p = findStreetPost(ix, D, used);
      if (!p) { S.genErrors = (S.genErrors || []).concat('no street post for ' + name); continue; }
      if (p.car) used.push([p.car.x, p.car.y]);
      S.contain.push({ x: p.x, y: p.y, name, covered: false, q: p.q, by: p.q === 'cruiser' ? 'cruiser in street' : shieldName(p.x, p.y), car: p.car || null, screened: p.q !== 'cruiser', added: null }); continue; }
    let p = findPost(ix, iy, COVER_CFG.search, D), added = null;
    if (!p) p = findPost(ix, iy, COVER_CFG.searchWide, D);
    if (!p) { added = addPostCover(r, ix, iy, D); if (added) { p = added; S.contain.added++; } }
    if (!p) { S.genErrors = (S.genErrors || []).concat('no covered post for ' + name); continue; }
    const by = shieldName(p.x, p.y); S.contain.push({ x: p.x, y: p.y, name, covered: false, q: p.sh.q, by: p.sh.seen ? by : by === 'out of sight-line' ? 'out of the line of fire' : by, added: added ? added.kind : null });
  }
  if (S.contain.added) buildDriveMask();
}
/** Live post status. Cruiser-cover posts only count while a cruiser actually screens them (it can drive away). */
function containStatus() {
  const key = S.units.filter(u => u.kind === 'cruiser').map(u => u.x + ',' + u.y + ',' + carAxis(u)).join(';');
  if (S._cruKey !== key) { S._cruKey = key; for (const c of S.contain) if (c.q === 'cruiser') c.screened = shieldAt(c.x, c.y).q !== 'open'; }
  for (const c of S.contain) c.covered = S.units.some(u => (onFoot(u) && dist(u.x, u.y, c.x, c.y) <= 2.3 && (c.q !== 'cruiser' || c.screened)) || (u.kind === 'cruiser' && u.occ.length && dist(u.x, u.y, c.x, c.y) <= 3));
  if (S.turn > 0 && S.contain.length && S.contain.every(c => c.covered) && !S.stats.containXp) { S.stats.containXp = S.turn; xpAct('contain', null); }
}
/** Which sides of the house (with openings) are actually watched right now by an officer outside or a crewed cruiser. */
function sideWatch() {
  const all = houseSides(), w = new Set();
  for (const u of S.units) { if (!(onFoot(u) || (u.kind === 'cruiser' && u.occ.length && !u.disabled))) continue; if (u.perch && u.perch.entry) continue; if (roomAt(u.x, u.y) >= 0) continue;
    watchAt(u.x, u.y).sides.forEach(s => w.add(s)); }
  return { all, watched: all.filter(s => w.has(s)), gaps: all.filter(s => !w.has(s)) };
}
/** Patrol officers on foot at the start: make sure each one is actually behind something. */
function coverStartPatrols() {
  for (const u of S.units) { if (u.kind !== 'patrol' || u.inCar || u.badPos || u.status !== 'ok') continue; if (shieldAt(u.x, u.y).q !== 'open') continue;
    const D = reach(u.x, u.y, { outdoor: true }, 14); let best = null, bs = 1e9;
    for (let y = u.y - 8; y <= u.y + 8; y++) for (let x = u.x - 8; x <= u.x + 8; x++) { if (!inb(x, y) || D[idx(x, y)] >= 1e9 || !cellOk(x, y, { outdoor: true }) || S.units.some(q => q !== u && onFoot(q) && q.x === x && q.y === y)) continue;
      const pre = D[idx(x, y)]; if (pre >= bs) continue; const sh = shieldAt(x, y); if (sh.q === 'open') continue; const s = pre + (sh.q === 'conceal' ? 3 : 0); if (s < bs) { bs = s; best = [x, y]; } }
    if (best) { u.x = best[0]; u.y = best[1]; u.home = { x: u.x, y: u.y }; } }
}
/** Harness check: every post shielded (static cover, or a cruiser that can be parked to screen it), watching windows/doors,
    reachable, separate and on free ground; no cover was added in the front yard; patrols start covered unless flagged as badly placed. */
function validateContain() {
  const errs = [], D = reach(S.ext.staging.x, S.ext.staging.y, { outdoor: true }, 1e6), H = S.house;
  if (S.contain.length < 6) errs.push('only ' + S.contain.length + ' containment posts');
  S.contain.forEach((c, i) => { const k = idx(c.x, c.y);
    if (S.block[k] || S.room[k] >= 0) errs.push(c.name + ' inside an object');
    if (D[k] >= 1e9) errs.push(c.name + ' unreachable');
    if (!watchAt(c.x, c.y).n) errs.push(c.name + ' cannot watch any window or door');
    if (c.q === 'cruiser') { if (!c.name.startsWith('Front')) errs.push(c.name + ' cruiser cover off the street');
      if (!c.car || !S.drive[idx(c.car.x, c.car.y)]) errs.push(c.name + ' no drivable cruiser spot');
      else { const vs = withVirtualCar(c.car.x, c.car.y, () => shieldAt(c.x, c.y)); if (vs.q === 'open') errs.push(c.name + ' not screened by a cruiser'); } }
    else { const sh = shieldAt(c.x, c.y, { static: true }); if (sh.q === 'open') errs.push(c.name + ' exposed to ' + sh.open + ' window/door lines'); if (sh.q !== c.q) errs.push(c.name + ' quality label mismatch'); }
    S.contain.forEach((o, j) => { if (j > i && dist(o.x, o.y, c.x, c.y) < 2) errs.push(c.name + ' overlaps ' + o.name); }); });
  for (const a of (S.ext.added || [])) if (a.y > H.y1) errs.push('procedural cover added in the front yard');
  for (const u of S.units) if (u.kind === 'patrol' && !u.inCar && u.status === 'ok' && !u.badPos && shieldAt(u.x, u.y).q === 'open') errs.push(u.name + ' starts exposed');
  return errs;
}
