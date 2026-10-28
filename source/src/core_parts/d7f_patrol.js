
/* =====================================================================
   v14 PATROL START POSITIONS — where the first officers stand when SWAT
   arrives. Uninjured officers are always OFF the suspect's property, at
   least PATROL_CFG.minHouse m from the house, either on the street behind
   a parked car / cruiser (≤2 m, the car between them and the house) or
   behind cover at the side / rear (neighbour lots, alley, side street).
   Every start is validated against sight lines from inside the house
   (each window pane and doorway, plus the cells beside them): the suspect
   must not be able to see any of them. Downed officers (hit before SWAT
   arrived) lie where they fell: 90% in the front yard, 10% side/back yard.
   ===================================================================== */
const PATROL_CFG = { minHouse: 10, maxHouse: 34, downFront: 0.9 };
/** Distance from (x,y) to the house footprint rectangle. */
function houseRectDist(x, y) { const H = S.house, dx = Math.max(H.x0 - x, 0, x - H.x1), dy = Math.max(H.y0 - y, 0, y - H.y1); return Math.hypot(dx, dy); }
/** Is (x,y) on the suspect's lot? */
function onProperty(x, y) { const T = S.geo.target; return x >= T.x0 && x <= T.x1 && y >= T.y0 && y <= T.y1; }
/** Interior points a suspect could look out from: each window's inside cell (+ its neighbours along the wall) and each exterior doorway. */
function suspEyePts() {
  if (S._eyePts) return S._eyePts; const out = [], seen = new Set(), add = (x, y) => { if (!inb(x, y)) return; const k = idx(x, y); if (seen.has(k)) return; seen.add(k); out.push({ x, y }); };
  for (const w of S.windows) for (const e of w.edges) { const [ix, iy, ox, oy] = e; add(ix, iy); const r0 = roomAt(ix, iy); if (r0 < 0) continue;
    const along = ix === ox ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]]; for (const [ax, ay] of along) if (roomAt(ix + ax, iy + ay) === r0) add(ix + ax, iy + ay); }
  for (const d of S.doors) if (d.exterior) for (const [a, b] of d.cells) { add(a[0], a[1]); add(b[0], b[1]); }
  return (S._eyePts = out);
}
/** Can the suspect (anywhere at a window or doorway) see (x,y)? Uses the full sight rule, vehicles included. */
function suspSees(x, y) { for (const p of suspEyePts()) { if (p.x === x && p.y === y) return true; if (los(p.x, p.y, x, y)) return true; } return false; }
/** 'street' = behind a vehicle within 2 m that sits between the officer and the house; 'side' = behind other cover off the lot; '' = not a start. */
function patrolCoverKind(x, y) {
  const G = S.geo, hd = houseRectDist(x, y);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { if (dx * dx + dy * dy > 4.01 || !inb(x + dx, y + dy)) continue; if (vehId(idx(x + dx, y + dy)) && houseRectDist(x + dx, y + dy) < hd) return y >= G.SW ? 'street' : 'side'; }
  if (y >= G.SW && !(G.side && x >= G.side.x0 - 1 && x <= G.side.x1 + 1)) return '';
  const a = coverAdj(x, y); if (!a || /hedge|fence|mailbox/.test(a.name)) return ''; const [hx, hy] = houseCenter(); return (a.dx * (hx - x) + a.dy * (hy - y)) > 0 ? 'side' : '';
}
/** Start-position candidates (cheap filters only; sight lines are checked lazily). */
function patrolCands(D) {
  const H = S.house, R = PATROL_CFG.maxHouse, out = [];
  for (let y = Math.max(1, H.y0 - R); y <= Math.min(MAP_H - 2, H.y1 + R); y++) for (let x = Math.max(1, H.x0 - R); x <= Math.min(MAP_W - 2, H.x1 + R); x++) {
    const c = idx(x, y); if (D[c] >= 1e9 || onProperty(x, y) || !cellOk(x, y, { outdoor: true }) || S.dyn[c]) continue;
    const hd = houseRectDist(x, y); if (hd < PATROL_CFG.minHouse || hd > R) continue;
    const kind = patrolCoverKind(x, y); if (!kind) continue;
    out.push({ x, y, kind, hd, sides: null });
  }
  return out;
}
function vehDist0(x, y) { return vehDist(x, y) <= VEH_CFG.lean; }
/** A start is valid: off the lot, far enough, covered, and invisible from inside. */
function patrolStartOk(x, y) { return !onProperty(x, y) && houseRectDist(x, y) >= PATROL_CFG.minHouse - 1e-9 && !!patrolCoverKind(x, y) && !suspSees(x, y); }
/** Pick the posts for the two officers on foot. want: list of side-sets to aim for per officer; kinds: preferred cover kind per officer. */
function pickPatrolPosts(cands, plans, avoid) {
  const taken = [], res = [];
  for (const pl of plans) { let best = null, bs = 1e9;
    const pool = cands.filter(c => !taken.some(t => cheb(t.x, t.y, c.x, c.y) < 3) && (!pl.kind || c.kind === pl.kind)).map(c => { const pre = Math.abs(c.hd - 14) * 0.15; return { c, pre }; }).sort((a, b) => a.pre - b.pre);
    for (const { c, pre } of pool) { if (pre >= bs) break;
      if (!c.sides) c.sides = watchAt(c.x, c.y).sides; const sides = c.sides;
      if (avoid && sides.has(avoid)) continue;
      const miss = pl.want.filter(w => !sides.has(w) && !res.some(q => q.sides.has(w))).length;
      const s = pre + miss * 6 + (sides.size ? 0 : 3); if (s >= bs) continue;
      if (c.ok === undefined) c.ok = !suspSees(c.x, c.y); if (!c.ok) continue;
      bs = s; best = c; }
    if (!best) return null; taken.push(best); res.push(best); }
  return res;
}
/** Downed officer: where he fell — 90% front yard, 10% side/back yard (on the lot, outside the house). */
function downedSpot(r, D) {
  const H = S.house, T = S.geo.target, front = r() < PATROL_CFG.downFront, cells = [];
  for (let y = T.y0 + 1; y <= T.y1; y++) for (let x = T.x0 + 1; x <= T.x1 - 1; x++) { const c = idx(x, y); if (D[c] >= 1e9 || !cellOk(x, y, { outdoor: true }) || S.dyn[c] || nearDoorOut(x, y, 1)) continue;
    const inFront = y > H.y1 + 1 && x >= H.x0 - 3 && x <= H.x1 + 3, inSide = !inFront && y <= H.y1 + 1 && houseRectDist(x, y) >= 1.5 && houseRectDist(x, y) <= 8;
    if (front ? inFront && y <= H.y1 + 7 : inSide) cells.push([x, y]); }
  if (!cells.length) return null; return { at: cells[r.int(0, cells.length - 1)], front };
}
