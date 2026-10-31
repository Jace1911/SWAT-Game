
/* =====================================================================
   MAP GENERATION 2/2 — NEIGHBORHOOD (seeded)
   Street (+ optional cross street and back alley), lots of varied width
   on both sides, neighbor houses (rect / L / attached garage), sheds,
   fences with gates, hedges, trees, mailboxes, parked cars, staging.
   Neighbor buildings are impassable AND opaque (S.opaque) — they block
   sight and fire, so officers can run behind them for cover.
   ===================================================================== */
/* v14 lot layout: no road between the target and its side neighbours except on corner lots (side street); 20% of maps have a back alley */
const GEO_CFG = { alley: 0.2, corner: 0.12 };
function genGeo(r) {
  const O = REAR_OFF - 1, SW = O + r.int(36, 38), sw = r.int(6, 7), ST = SW + 2, SB = ST + sw - 1, SS = SB + 1;
  const alley = r() < GEO_CFG.alley; // v14: 20% of maps have a back alley
  let cross = null;
  if (r.chance(0.55)) { const left = r.chance(0.5), x0 = left ? r.int(12, 22) : r.int(MAP_W - 28, MAP_W - 18); cross = { x0, x1: x0 + 5 }; }
  const ny0 = O + (alley ? 4 : 1), RW = 1 + REAR_CFG.road, ry0 = RW + REAR_CFG.walk, ry1 = REAR_OFF - 1;
  const tw = r.int(36, 42), tx0 = Math.round(MAP_W / 2 - tw / 2) + r.int(-6, 6);
  const lots = [];
  const split = (a, b, side, y0, y1) => { let x = a; while (b - x + 1 >= 20) { let w = r.int(22, 32); if (b - (x + w) + 1 < 18) w = b - x + 1; lots.push({ x0: x, x1: x + w - 1, y0, y1, side }); x += w; }
    if (x <= b && lots.length && lots[lots.length - 1].side === side && lots[lots.length - 1].x1 === x - 1) lots[lots.length - 1].x1 = b; else if (x <= b) lots.push({ x0: x, x1: b, y0, y1, side, tiny: true }); };
  split(1, tx0 - 1, 'n', ny0, SW - 1);
  const target = { x0: tx0, x1: tx0 + tw - 1, y0: ny0, y1: SW - 1, side: 'n', target: true }; lots.push(target);
  split(tx0 + tw, MAP_W - 2, 'n', ny0, SW - 1);
  if (cross) { split(1, cross.x0 - 1, 's', SS + 2, MAP_H - 2); split(cross.x1 + 1, MAP_W - 2, 's', SS + 2, MAP_H - 2); }
  else split(1, MAP_W - 2, 's', SS + 2, MAP_H - 2);
  const nFront = lots.length; split(1, MAP_W - 2, 's', ry0, ry1); for (let i = nFront; i < lots.length; i++) lots[i].rear = true;
  // v14 corner lot: occasionally a side street runs down one side of the target lot (from the rear road to the main street, continuing south
  // as the cross street). Drawn from a separate stream so the house layouts stay identical; otherwise the neighbours sit right next door.
  const rs = makeRng(S.seed * 17 + 11), corner = rs() < GEO_CFG.corner; let sideSt = null;
  if (corner) { const left = rs() < 0.5, sx0 = left ? tx0 - 7 : tx0 + tw + 1; sideSt = { x0: sx0, x1: sx0 + 5, side: left ? 'left' : 'right' }; cross = { x0: sideSt.x0, x1: sideSt.x1, corner: true };
    const keep = lots.filter(l => l.target);
    const rsSplit = (a, b, side, y0, y1) => { const tmp = []; let x = a; while (b - x + 1 >= 20) { let w = rs.int(22, 32); if (b - (x + w) + 1 < 18) w = b - x + 1; tmp.push({ x0: x, x1: x + w - 1, y0, y1, side }); x += w; }
      if (x <= b && tmp.length) tmp[tmp.length - 1].x1 = b; else if (x <= b) tmp.push({ x0: x, x1: b, y0, y1, side, tiny: true }); return tmp; };
    const segs = [[1, sideSt.x0 - 2], [sideSt.x1 + 2, MAP_W - 2]], segN = left ? [[1, sideSt.x0 - 2], [tx0 + tw, MAP_W - 2]] : [[1, tx0 - 1], [sideSt.x1 + 2, MAP_W - 2]];
    const nW = rsSplit(segN[0][0], segN[0][1], 'n', ny0, SW - 1), nE = rsSplit(segN[1][0], segN[1][1], 'n', ny0, SW - 1), south = [], rear = [];
    for (const [a, b] of segs) { south.push(...rsSplit(a, b, 's', SS + 2, MAP_H - 2)); rear.push(...rsSplit(a, b, 's', ry0, ry1).map(l => Object.assign(l, { rear: true }))); }
    lots.length = 0; lots.push(...nW, ...keep, ...nE, ...south, ...rear); }
  lots.forEach((l, i) => { l.id = i; l.lawn = r(); });
  S.geo = { rear: { road0: 1, road1: REAR_CFG.road, walk0: RW, walk1: ry0 - 1, y0: ry0, y1: ry1 }, SW, ST, SB, SS, streetW: sw, alley, cross, side: sideSt, corner, lots, target, name: (r.pick(STREETS), r.chance(0.5), streetName(makeRng(S.seed * 7907 + S.attempt * 13 + 5))) } // v23: rng calls kept so the map is unchanged;
  return target;
}
function markRect(q, f) { for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) if (inb(x, y)) f(idx(x, y), x, y); }
function rectFree(q, pad = 0) { for (let y = q.y - pad; y < q.y + q.h + pad; y++) for (let x = q.x - pad; x < q.x + q.w + pad; x++) { if (!inb(x, y)) return false; const c = idx(x, y); if (S.block[c] || S.room[c] >= 0 || S.paved[c]) return false; } return true; }
function solid(q, lbl, opaque) { markRect(q, c => { S.block[c] = 1; S.cov[c] = Math.max(S.cov[c], opaque || lbl === 1 || lbl === 3 || lbl === 9 || lbl === 11 ? 2 : 1); S.covLbl[c] = lbl; if (opaque) S.opaque[c] = 1; }); }
function fenceH(x0, x1, y, gates) { for (let x = x0; x <= x1; x++) { if (gates.some(g => x >= g && x < g + 2)) continue; if (roomAt(x, y) >= 0 || roomAt(x, y - 1) >= 0 || S.paved[idx(x, y)] || S.paved[idx(x, y - 1)]) continue; S.edges.set(ek(x, y - 1, x, y), E_FENCE); } }
function fenceV(x, y0, y1, gates) { for (let y = y0; y <= y1; y++) { if (gates.some(g => y >= g && y < g + 2)) continue; if (S.paved[idx(x, y)] || S.paved[idx(x - 1, y)]) continue; S.edges.set(ek(x - 1, y, x, y), E_FENCE); } }

function genNeighborhood(r) {
  S.veh = null; const G = S.geo, H = S.house, W = S.world = { trees: [], hedges: [], sheds: [], mail: [], cars: [], lamps: [], drives: [], walks: [], nb: [], patios: [], boxes: [], added: [], steps: [] };
  // borders and paving
  for (let x = 0; x < MAP_W; x++) { S.block[idx(x, 0)] = 1; S.block[idx(x, MAP_H - 1)] = 1; }
  for (let y = 0; y < MAP_H; y++) { S.block[idx(0, y)] = 1; S.block[idx(MAP_W - 1, y)] = 1; }
  const pave = (q, k) => markRect(q, c => { if (S.room[c] < 0) S.paved[c] = k; });
  pave({ x: 1, y: G.SW, w: MAP_W - 2, h: 2 }, 2); pave({ x: 1, y: G.ST, w: MAP_W - 2, h: G.streetW }, 1); pave({ x: 1, y: G.SS, w: MAP_W - 2, h: 2 }, 2);
  if (G.cross) { pave({ x: G.cross.x0 - 1, y: G.SS, w: 1, h: MAP_H - G.SS - 1 }, 2); pave({ x: G.cross.x0, y: G.SS, w: 6, h: MAP_H - G.SS - 1 }, 1); pave({ x: G.cross.x1 + 1, y: G.SS, w: 1, h: MAP_H - G.SS - 1 }, 2); }
  if (G.alley) pave({ x: 1, y: REAR_OFF, w: MAP_W - 2, h: 3 }, 3);
  if (G.side) { const q = G.side, y0 = G.rear.road0, h = G.SW - y0; pave({ x: q.x0 - 1, y: y0, w: 1, h }, 2); pave({ x: q.x0, y: y0, w: 6, h }, 1); pave({ x: q.x1 + 1, y: y0, w: 1, h }, 2); }
  pave({ x: 1, y: G.rear.road0, w: MAP_W - 2, h: REAR_CFG.road }, 1); pave({ x: 1, y: G.rear.walk0, w: MAP_W - 2, h: REAR_CFG.walk }, 2);
  // ---- target lot: driveway, walk, patio, detached garage ----
  const T = G.target, fd = S.doors.find(d => d.name === 'Front Door'), fdo = fd.cells[0].find(c => roomAt(c[0], c[1]) < 0) || fd.cells[0][1];
  const gside = H.side === 'L' ? -1 : 1;
  if (H.garage) { const g = H.garage; W.drives.push({ x: g.x, y: g.y + g.h, w: g.w, h: G.SW - (g.y + g.h), target: true }); }
  else { const dw = 3, dx = gside < 0 ? Math.max(T.x0 + 2, H.x0 - dw - 2) : Math.min(T.x1 - dw - 1, H.x1 + 3);
    const dTop = H.detached ? H.y0 + 1 : H.y1 - 4; W.drives.push({ x: dx, y: dTop, w: dw, h: G.SW - dTop, target: true });
    if (H.detached) { const gx = gside < 0 ? dx - 1 : dx - 3, gq = { x: clamp(gx, T.x0 + 2, T.x1 - 8), y: Math.max(T.y0 + 2, H.y0 - 8), w: 6, h: 6 };
      H.dgarage = gq; W.drives[0].y = gq.y + gq.h; W.drives[0].h = G.SW - W.drives[0].y; W.drives[0].x = clamp(W.drives[0].x, gq.x, gq.x + gq.w - dw); } }
  W.walks.push({ x: fdo[0], y: fdo[1], w: 1, h: G.SW - fdo[1] });
  const bd = S.doors.find(d => d.name === 'Back Door');
  if (bd) { const bo = bd.cells[0].find(c => roomAt(c[0], c[1]) < 0) || bd.cells[0][1]; W.patios.push({ x: bo[0] - 2, y: bo[1] - (bo[1] < H.y0 + 1 ? 2 : 1), w: 5, h: 3 }); }
  // v13: duplex unit B gets its own walk and patio; mobile homes get wooden steps at each door
  const outOf = d => d && (d.cells[0].find(c => roomAt(c[0], c[1]) < 0) || d.cells[0][1]);
  if (H.duplex) { const bf = outOf(S.doors.find(d => d.name === 'Unit B Front Door')), bb = outOf(S.doors.find(d => d.name === 'Unit B Back Door'));
    if (bf) W.walks.push({ x: bf[0], y: bf[1], w: 1, h: G.SW - bf[1], unitB: true }); if (bb) W.patios.push({ x: bb[0] - 2, y: bb[1] - (bb[1] < H.y0 + 1 ? 2 : 1), w: 5, h: 3, unitB: true }); }
  if (H.trailer) for (const d of S.doors.filter(q => q.exterior)) { const o = outOf(d), north = o[1] < H.y0, side = o[0] < H.x0 ? 'w' : o[0] > H.x1 ? 'e' : null;
    if (side) W.steps.push({ x: side === 'w' ? o[0] - 1 : o[0], y: o[1] - 1, w: 2, h: 3, door: d.id, porch: d.name === 'Front Door', vert: true }); // v22: rotated home, door on a long side
    else W.steps.push({ x: o[0] - 1, y: north ? o[1] - 1 : o[1], w: 3, h: 2, door: d.id, porch: d.name === 'Front Door' }); }
  W.drives.forEach(q => pave(q, 4)); W.walks.forEach(q => pave(q, 5)); W.patios.forEach(q => markRect(q, c => { if (S.room[c] < 0 && !S.paved[c]) S.paved[c] = 6; }));
  if (H.dgarage) solid(H.dgarage, 10, true);
  // ---- neighbor houses ----
  const tLots = trailerLots(G.lots, H);
  for (const L of G.lots) {
    if (L.target || L.x1 - L.x0 < 17) continue;
    const north = L.side === 'n', lw = L.x1 - L.x0 + 1;
    let w = r.int(10, Math.min(18, lw - 10)), h = r.int(8, north ? 12 : 10);
    const park = tLots.has(L); if (park) { h = h >= 10 ? 8 : 5; w = Math.max(w, Math.min(16, lw - 10)); } // v13: trailer-park cluster
    const prot = park && !L.rear && makeRng(S.seed * 613 + L.id * 7 + 3)() < TRAILER_ROT; if (prot) { const t = w; w = h; h = t; } // v22: some park homes stand end-on
    let setback = north ? r.int(6, 10) : r.int(4, 7); if (L.rear) setback = Math.min(setback, 5);
    const y = north ? L.y1 - setback - h + 1 : L.y0 + setback;
    const hasG = r.chance(0.5) && lw - w >= 17 && !park, gl = r.chance(0.5);
    const x = clamp(L.x0 + Math.floor((lw - w - (hasG ? 6 : 0)) / 2) + r.int(-2, 2) + (hasG && gl ? 6 : 0), L.x0 + 3 + (hasG && gl ? 6 : 0), L.x1 - w - 3 - (hasG && !gl ? 6 : 0));
    const parts = [{ x, y, w, h }];
    if (r.chance(0.45) && !park) { const ww = r.int(4, Math.max(4, Math.floor(w / 2))), wh = r.int(3, 4), wx = r.chance(0.5) ? x : x + w - ww; parts.push({ x: wx, y: north ? y - wh : y + h, w: ww, h: wh }); }
    let garage = null; if (hasG) { const gh = Math.min(h, r.int(6, 7)); garage = { x: gl ? x - 6 : x + w, y: north ? y + h - gh : y, w: 6, h: gh }; parts.push(garage); }
    if (!parts.every(q => q.y >= L.y0 + 1 && q.y + q.h <= L.y1 && q.x >= L.x0 + 2 && q.x + q.w <= L.x1 - 1 && rectFree(q, 1))) continue;
    const nb = { lot: L.id, parts, garage, north, rear: !!L.rear, roof: r.int(0, 5), body: r.int(0, 4), storeys: r.chance(0.5) ? 2 : 1 }; if (park) { nb.trailer = Math.min(w, h) >= 8 ? 'double' : 'single'; nb.storeys = 1; if (prot) nb.rot = true; }
    parts.forEach(q => solid(q, 5, true));
    // driveway
    const dq = garage ? { x: garage.x, w: 6 } : { x: r.chance(0.5) ? Math.max(L.x0 + 1, x - 4) : Math.min(L.x1 - 3, x + w + 1), w: 3 };
    const drive = north ? { x: dq.x, y: garage ? garage.y + garage.h : y + h - 4, w: dq.w, h: 0 } : { x: dq.x, y: L.y0, w: dq.w, h: 0 };
    drive.h = north ? G.SW - drive.y : (garage ? garage.y : y + 4) - drive.y;
    if (drive.h > 0 && drive.x >= L.x0 && drive.x + drive.w <= L.x1 + 1) { pave(drive, 4); W.drives.push(drive); nb.drive = drive;
      if (r.chance(0.6)) { const cq = { x: drive.x + Math.floor((drive.w - 2) / 2), y: north ? G.SW - 5 : L.y0 + 1, w: 2, h: 4 }; if (rectFree(cq) || true) { W.cars.push({ x: cq.x, y: cq.y, w: 2, h: 4, vert: true, color: r.int(0, 5) }); } } }
    const door = { x: x + r.int(2, w - 3), y: north ? y + h : y - 1 };
    const walk = north ? { x: door.x, y: door.y, w: 1, h: G.SW - door.y } : { x: door.x, y: L.y0, w: 1, h: door.y - L.y0 + 1 };
    pave(walk, 5); W.walks.push(walk);
    W.nb.push(nb);
  }
  // v22: suspect's vehicles — ~50% a car in the driveway (own stream); garage cars (furniture) also block sight like any parked car
  { const td = W.drives.find(q => q.target), cr = makeRng(S.seed * 389 + 9); const want = S.opts && S.opts.driveCar != null ? !!S.opts.driveCar : cr() < GARAGE_CFG.driveP;
    if (td && want && td.h >= 6) { const cq = { x: td.x + Math.floor((td.w - 2) / 2), y: td.y + 1, w: 2, h: 4 }; let free = true; markRect(cq, c => { if (S.block[c] || S.room[c] >= 0) free = false; });
      if (free) W.cars.push({ x: cq.x, y: cq.y, w: 2, h: 4, vert: true, color: cr.int(0, 5), suspectCar: 'driveway' }); }
    for (const f of S.furn || []) if (f.garageCar) W.cars.push({ x: f.x, y: f.y, w: f.w, h: f.h, vert: true, color: cr.int(0, 5), suspectCar: 'garage', garage: true, stall: f.stall }); }
  // parked cars in driveways: make them solid now (paving is laid)
  for (const c of W.cars) solid(c, 3, false);
  // ---- fences: lot lines (backyard part) + back fence + side fences to the house ----
  const lotsN = G.lots.filter(l => l.side === 'n'), lotsS = G.lots.filter(l => l.side === 's');
  const backOf = (L) => { const nb = W.nb.find(n => n.lot === L.id); if (L.target) return { y0: H.y0, y1: H.y1, x0: H.x0, x1: H.x1 }; if (!nb) return null;
    const ys = nb.parts.map(q => [q.y, q.y + q.h - 1]).flat(), xs = nb.parts.map(q => [q.x, q.x + q.w - 1]).flat(); return { y0: Math.min(...ys), y1: Math.max(...ys), x0: Math.min(...xs), x1: Math.max(...xs) }; };
  for (let i = 1; i < lotsN.length; i++) { const L = lotsN[i], P = lotsN[i - 1]; if (P.x1 + 1 !== L.x0) continue; const a = backOf(L), b = backOf(P); const yEnd = Math.min(a ? a.y1 - 2 : L.y1 - 10, b ? b.y1 - 2 : L.y1 - 10);
    if (r.chance(0.85)) fenceV(L.x0, L.y0, yEnd, [r.int(L.y0 + 1, Math.max(L.y0 + 1, yEnd - 3))]); }
  for (let i = 1; i < lotsS.length; i++) { const L = lotsS[i], P = lotsS[i - 1]; if (P.x1 + 1 !== L.x0) continue; const a = backOf(L), b = backOf(P); const yS = Math.max(a ? a.y0 + 2 : L.y0 + 8, b ? b.y0 + 2 : L.y0 + 8);
    if (r.chance(0.8)) fenceV(L.x0, yS, L.y1, [r.int(yS + 1, Math.max(yS + 1, L.y1 - 3))]); }
  if (G.alley) for (const L of lotsN) if (r.chance(0.8)) fenceH(L.x0, L.x1, L.y0, [r.int(L.x0 + 2, L.x1 - 4)]);
  // rear row: back fence between the back neighbours' yards and the target block (or the alley), with a gate per lot
  for (const L of lotsS.filter(l => l.rear)) if (r.chance(0.85)) fenceH(L.x0, L.x1, G.alley ? L.y1 : L.y1 + 1, [r.int(L.x0 + 2, L.x1 - 4)]);
  W.yf = {};
  for (const L of G.lots) { const b = backOf(L); if (!b || (!L.target && r.chance(0.35))) continue;
    const yf = L.side === 'n' ? b.y0 + Math.min(3, Math.max(1, b.y1 - b.y0 - 6)) : b.y1 - 2;
    let hl = b.x0; while (hl <= b.x1 && roomAt(hl, yf) < 0 && !S.opaque[idx(hl, yf)]) hl++;
    let hr = b.x1; while (hr >= b.x0 && roomAt(hr, yf) < 0 && !S.opaque[idx(hr, yf)]) hr--;
    const fy = L.side === 'n' ? yf : yf + 1;
    if (hl - 1 - L.x0 >= 3) fenceH(L.x0, hl - 1, fy, [Math.floor((L.x0 + hl - 1) / 2)]);
    if (L.x1 - (hr + 1) >= 3) fenceH(hr + 1, L.x1, fy, [Math.floor((hr + 1 + L.x1) / 2)]);
    if (L.target) W.yf = fy; }
  // ---- sheds ----
  for (const L of G.lots) { if (!r.chance(L.target ? 0.65 : 0.45)) continue; const b = backOf(L);
    for (let t = 0; t < 30; t++) { const w = r.int(3, 4), h = 3; const x = r.int(L.x0 + 2, L.x1 - w - 1);
      const y = L.side === 'n' ? r.int(L.y0 + 1, Math.max(L.y0 + 1, (b ? b.y0 : L.y1 - 12) - h - 2)) : r.int(Math.min(L.y1 - h - 1, (b ? b.y1 : L.y0 + 10) + 3), L.y1 - h - 1);
      const q = { x, y, w, h }; if (!rectFree(q, 2)) continue; let fenceNear = false; for (let yy = y - 1; yy <= y + h; yy++) for (let xx = x - 1; xx <= x + w; xx++) if (S.edges.get(ek(xx, yy, xx + 1, yy)) === E_FENCE || S.edges.get(ek(xx, yy, xx, yy + 1)) === E_FENCE) fenceNear = true;
      if (fenceNear) continue; solid(q, 4, true); W.sheds.push(Object.assign(q, { lot: L.id, hue: r.int(0, 3) })); break; } }
  // ---- hedges along front lot lines ----
  for (const L of G.lots) { if (!r.chance(0.6)) continue; const y = L.side === 'n' ? L.y1 : L.y0; const len = r.int(4, 9), left = r.chance(0.5);
    const x0 = left ? L.x0 + 1 : L.x1 - len; const q = { x: x0, y, w: len, h: 1 }; let ok = true; markRect(q, c => { if (S.block[c] || S.paved[c] || S.room[c] >= 0) ok = false; }); if (!ok) continue; solid(q, 2, false); W.hedges.push(q); }
  // ---- trees ----
  for (const L of G.lots) { const n = r.int(2, 4); let k = 0;
    for (let t = 0; t < 80 && k < n; t++) { const x = r.int(L.x0 + 1, L.x1 - 1), y = r.int(L.y0 + 1, L.y1 - 1); const q = { x, y, w: 1, h: 1 };
      if (!rectFree(q, 2) || W.trees.some(o => dist(o.x, o.y, x, y) < 5)) continue; if (L.target && x >= H.x0 - 3 && x <= H.x1 + 3 && y >= H.y0 - 3 && y <= H.y1 + 3) continue;
      solid(q, 1, false); W.trees.push({ x, y, r: 1.5 + r() * 1.3, hue: r() }); k++; } }
  // ---- mailboxes ----
  for (const L of G.lots) { const d = W.drives.find(q => q.x >= L.x0 && q.x <= L.x1) ; const x = d ? (d.x + d.w < L.x1 ? d.x + d.w : d.x - 1) : L.x0 + 3; const y = L.side === 'n' ? G.SW - 1 : L.y0;
    const q = { x, y, w: 1, h: 1 }; if (rectFree(q)) { solid(q, 6, false); W.mail.push({ x, y }); } }
  // ---- street lamps ----
  for (let x = 6; x < MAP_W - 4; x += r.int(20, 26)) { for (const y of [G.SW, G.SS + 1, G.rear.walk0]) { if (!S.block[idx(x, y)]) { S.block[idx(x, y)] = 1; W.lamps.push({ x, y }); } } }
  // ---- SWAT truck + staging (out of the suspect's likely range) ----
  const hcx = (H.x0 + H.x1) / 2, far = r.chance(0.5) ? -1 : 1;
  // v22: staging sits out toward the left / right map edge (the secondary mirrors it at the other edge), never within 26 m of the house
  const edgeX = f => f < 0 ? r.int(8, 12) : MAP_W - 10 - r.int(3, 7); let vx = edgeX(far); if (Math.abs(vx + 3 - hcx) < 26) vx = edgeX(-far);
  if (Math.abs(vx + 3 - hcx) < 26) vx = Math.round(hcx + far * r.int(32, 38)); if (vx < 3 || vx > MAP_W - 10) vx = Math.round(hcx - far * r.int(32, 38));
  vx = clamp(vx, 3, MAP_W - 10); if (G.cross && vx + 6 >= G.cross.x0 - 1 && vx <= G.cross.x1 + 1) vx = vx < G.cross.x0 ? G.cross.x0 - 8 : G.cross.x1 + 2;
  W.van = { x: vx, y: G.ST + 1, w: 6, h: 2, kind: 'swat' }; solid(W.van, 9, false);
  W.staging = { x: vx + 3, y: G.ST + 4 };
  // ---- civilian cars parked along both curbs: random count, spots, colours and body types; some right by the house ----
  const TYPES = [['sedan', 4], ['sedan', 4], ['hatch', 3], ['suv', 4], ['pickup', 5], ['van', 5]];
  const curbOk = (x, y, L) => { if (x < 3 || x + L > MAP_W - 3) return false; if (dist(x + L / 2, y, W.staging.x, W.staging.y) < 8 || (x + L >= W.van.x - 1 && x <= W.van.x + W.van.w && y === G.ST)) return false;
    if (G.cross && x + L >= G.cross.x0 - 2 && x <= G.cross.x1 + 2) return false; if (x < 9 || x + L > MAP_W - 10) return false; // keep the ends of the block clear for roadblocks
    const north = y === G.ST; for (const d of W.drives) { const dn = d.y < G.ST; if (dn === north && x + L > d.x - 1 && x < d.x + d.w + 1) return false; } // never across a driveway
    if (!north && Math.abs(x + L / 2 - hcx) < 6) return false; // keep the lane in front of the house open
    if (G.streetW < 7 && W.cars.some(c => c.street && c.y !== y && x + L + 3 > c.x && x < c.x + c.w + 3)) return false; // narrow street: stagger, one lane stays drivable
    let ok = true; markRect({ x: x - 1, y, w: L + 2, h: 2 }, c => { if (S.block[c]) ok = false; }); return ok; };
  let nc = r.int(5, 10), near = r.int(1, 2), guard = 0;
  while (nc > 0 && guard++ < 400) { const [type, L] = r.pick(TYPES), y = r.chance(near > 0 ? 0.8 : 0.5) ? G.ST : G.SB - 1;
    const x = near > 0 ? Math.round(hcx + r.int(-14, 12)) : r.int(3, MAP_W - 8); if (!curbOk(x, y, L)) continue;
    if (near <= 0 && Math.abs(x + L / 2 - hcx) < 6) continue;
    const q = { x, y, w: L, h: 2 }; solid(q, 3, false); W.cars.push({ x, y, w: L, h: 2, vert: false, color: r.int(0, 7), type, street: true, flip: r.chance(0.5) }); nc--; if (Math.abs(x + L / 2 - hcx) < 16) near--; }
  // parked cars on the rear street (north curb), never in front of a rear driveway
  for (let n = r.int(2, 4), g = 0; n > 0 && g++ < 80;) { const [type, L] = r.pick(TYPES), x = r.int(4, MAP_W - 10), y = G.rear.road0;
    if ((G.side && x + L >= G.side.x0 - 2 && x <= G.side.x1 + 2) || W.drives.some(d => d.y === G.rear.y0 && x + L > d.x - 1 && x < d.x + d.w + 1) || W.cars.some(c => c.street && c.y === y && x + L + 2 > c.x && x < c.x + c.w + 2)) continue;
    let ok = true; markRect({ x: x - 1, y, w: L + 2, h: 2 }, c => { if (S.block[c]) ok = false; }); if (!ok) continue;
    solid({ x, y, w: L, h: 2 }, 3, false); W.cars.push({ x, y, w: L, h: 2, vert: false, color: r.int(0, 7), type, street: true, rear: true, flip: r.chance(0.5) }); n--; }
  S.ext = W;
}
/* cells a 3×1 cruiser can be centred on: outdoors, clear of solids and fences in a 3×3 box */
function buildDriveMask() {
  S.drive = new Uint8Array(MAP_W * MAP_H);
  for (let y = 1; y < MAP_H - 1; y++) for (let x = 1; x < MAP_W - 1; x++) {
    let ok = true;
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) { const c = idx(x + dx, y + dy); if (S.block[c] || S.room[c] >= 0) { ok = false; break; }
      if (dx < 1 && S.edges.get(ek(x + dx, y + dy, x + dx + 1, y + dy)) === E_FENCE) { ok = false; break; }
      if (dy < 1 && S.edges.get(ek(x + dx, y + dy, x + dx, y + dy + 1)) === E_FENCE) { ok = false; break; } }
    if (ok) S.drive[idx(x, y)] = 1;
  }
}
/** World validation for the harness: neighbor buildings never overlap the house, rooms, streets; key outdoor points connected. */
function validateWorld() {
  const errs = [], W = S.world, G = S.geo, H = S.house;
  for (const nb of W.nb) for (const q of nb.parts) markRect(q, (c, x, y) => { if (S.room[c] >= 0) errs.push('neighbor overlaps target house'); if (y >= G.SW && y < G.SS + 2) errs.push('neighbor on street'); if (y <= G.rear.walk1) errs.push('neighbor on rear street'); });
  for (const s of W.sheds) markRect(s, c => { if (S.room[c] >= 0) errs.push('shed overlaps house'); });
  const D = reach(W.staging.x, W.staging.y, { outdoor: true }, 1e6);
  const need = [[H.x0 - 2, H.y0 - 2, 'rear-left'], [H.x1 + 2, H.y0 - 2, 'rear-right'], [H.x0 - 2, H.y1 + 2, 'front-left'], [H.x1 + 2, H.y1 + 2, 'front-right']];
  for (const [x, y, n] of need) { let ok = false; for (let dy = -2; dy <= 2 && !ok; dy++) for (let dx = -2; dx <= 2; dx++) if (inb(x + dx, y + dy) && D[idx(x + dx, y + dy)] < 1e9) { ok = true; break; } if (!ok) errs.push('cannot reach ' + n + ' of house'); }
  for (const d of S.doors.filter(q => q.exterior)) { const o = d.cells[0].find(c => roomAt(c[0], c[1]) < 0); if (o && D[idx(o[0], o[1])] >= 1e9) errs.push('exterior door unreachable: ' + d.name); }
  for (const nb of W.nb) { const q = nb.parts[0]; let ok = false; for (let x = q.x - 2; x <= q.x + q.w + 1 && !ok; x++) for (const y of [q.y - 2, q.y - 1]) if (inb(x, y) && D[idx(x, y)] < 1e9) { ok = true; break; } if (!ok && nb.north) errs.push('no route behind a neighbor house'); }
  if (!W.nb.some(n => n.rear)) errs.push('no rear-row neighbour house');
  let dr = 0; for (let c = 0; c < S.drive.length; c++) dr += S.drive[c]; if (dr < 600) errs.push('drive area too small');
  if (!S.drive[idx(Math.round((H.x0 + H.x1) / 2), G.ST + 3)]) errs.push('street in front not drivable');
  return errs;
}
