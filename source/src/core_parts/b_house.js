
/* =====================================================================
   MAP GENERATION 1/2 — TARGET HOUSE (seeded archetypes)
   Archetypes: ranch (attached garage), colonial (detached garage),
   L-shaped (rear wing), split-entry (tuck-under garage), bungalow.
   Each footprint is cut into zones:
     private – bedrooms + bath off a central hallway
     public  – living (front) / kitchen / dining
     wing    – extra bedroom / office / den
   Doors are placed on shared walls, a union-find pass guarantees every
   room is connected, then exterior doors and windows are added.
   ===================================================================== */
function segs(r, len) { const out = []; let rem = len; while (rem > 6) { const s = r.int(3, Math.min(6, rem - 3)); out.push(s); rem -= s; } out.push(rem); return out; }
function sharedEdges(A, B) { // [[cellA, cellB], …] for every unit edge between two room rects
  const out = [];
  for (let y = A.y; y < A.y + A.h; y++) for (let x = A.x; x < A.x + A.w; x++)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy;
      if (nx >= B.x && nx < B.x + B.w && ny >= B.y && ny < B.y + B.h) out.push([[x, y], [nx, ny]]); }
  return out;
}
function interiorPick(r, list) { if (!list.length) return null; if (list.length <= 2) return list[0];
  const k = list.slice().sort((p, q) => (p[0][0] - q[0][0]) || (p[0][1] - q[0][1])); return k[r.int(1, k.length - 2)]; }
function extEdges(rm, side) { // edges of a room rect that face outside (no room on the other side)
  const out = []; const S_ = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[side];
  for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) { const nx = x + S_[0], ny = y + S_[1];
    if (roomAt(x, y) !== rm.id) continue; if (nx >= rm.x && nx < rm.x + rm.w && ny >= rm.y && ny < rm.y + rm.h) continue;
    if (inb(nx, ny) && roomAt(nx, ny) === -1) out.push([[x, y], [nx, ny]]); }
  return out;
}
/* ---- v13: structure type — house / duplex / mobile home. Picked on its own seeded stream, so the map of every
   seed that stays a house is unchanged. opts.struct ('house'|'duplex'|'trailer') forces it (Quick Mission, tests). ---- */
const STRUCT_CFG = { duplex: 0.05, trailer: 0.05, doubleWide: 0.4, park: 0.6 };
const GARAGE_CFG = { two: 0.35, three: 0.08, stallW: 4, carP: 0.5, driveP: 0.5 }; // v22: wider ranch garages + parked cars at the suspect house
const TRAILER_ROT = 0.35; // v22: share of mobile homes rotated 90° (end-on to the street)
const STRUCT_KEYS = ['house', 'duplex', 'trailer'];
function structFor(seed, opts) { if (opts && STRUCT_KEYS.includes(opts.struct)) return opts.struct;
  const p = makeRng(seed * 4271 + 19)(); return p < STRUCT_CFG.duplex ? 'duplex' : p < STRUCT_CFG.duplex + STRUCT_CFG.trailer ? 'trailer' : 'house'; }
function genHouse(r, lot, frontY) {
  const struct = structFor(S.seed, S.opts), sr = makeRng(S.seed * 4271 + 23);
  const arch = struct === 'duplex' ? 'duplex' : struct === 'trailer' ? (sr.chance(STRUCT_CFG.doubleWide) ? 'double' : 'single') : r.pick(['ranch', 'ranch', 'colonial', 'lshape', 'split', 'bungalow']);
  const side = r.chance(0.5) ? 'L' : 'R'; let WA = 0, cols = null;
  let TW, TH, garage = null, parts = [], zones = [], detached = false;
  const Z = (k, x, y, w, h, extra) => zones.push(Object.assign({ k, x, y, w, h }, extra || {}));
  if (arch === 'ranch' || arch === 'bungalow') {
    const W = arch === 'ranch' ? r.int(17, 22) : r.int(13, 15), H = arch === 'ranch' ? r.int(11, 13) : r.int(10, 11);
    let G = arch === 'ranch' ? r.int(6, 7) : 0;
    if (G) { const gq = S.opts && S.opts.stalls ? S.opts.stalls : (q => q < GARAGE_CFG.three ? 3 : q < GARAGE_CFG.two ? 2 : 1)(makeRng(S.seed * 389 + 1)()); // v22: 2- / 3-car garages (own stream)
      const room = (lot.x1 - lot.x0 + 1) - 9 - W - G; G += gq >= 3 && room >= 8 ? 8 : gq >= 2 && room >= 4 ? 4 : 0; }
    TW = W + G; TH = H; const mx = side === 'L' ? G : 0;
    parts.push({ x: mx, y: 0, w: W, h: H });
    if (G) { const GH = r.int(7, Math.min(9, H - 2)); garage = { x: side === 'L' ? 0 : W, y: H - GH, w: G, h: GH }; }
    const pw = arch === 'ranch' ? r.int(Math.round(W * 0.42), Math.round(W * 0.52)) : r.int(6, W - 6);
    // public next to the garage side (kitchen ↔ garage), private on the far side
    const pubRight = side === 'R';
    if (pubRight) { Z('private', mx, 0, W - pw, H, { bnd: 'e' }); Z('public', mx + W - pw, 0, pw, H); }
    else { Z('public', mx, 0, pw, H); Z('private', mx + pw, 0, W - pw, H, { bnd: 'w' }); }
  } else if (arch === 'colonial') {
    const W = r.int(14, 17), H = r.int(12, 14); TW = W; TH = H; detached = true; parts.push({ x: 0, y: 0, w: W, h: H });
    const pw = r.int(6, W - 7);
    if (side === 'L') { Z('public', 0, 0, pw, H, { stack: true }); Z('private', pw, 0, W - pw, H, { bnd: 'w' }); }
    else { Z('private', 0, 0, W - pw, H, { bnd: 'e' }); Z('public', W - pw, 0, pw, H, { stack: true }); }
  } else if (arch === 'lshape') {
    const W = r.int(16, 20), H = r.int(10, 12), E = r.int(5, 7), ww = r.int(7, 9); TW = W; TH = H + E;
    parts.push({ x: 0, y: E, w: W, h: H }); const wx = side === 'L' ? 0 : W - ww; parts.push({ x: wx, y: 0, w: ww, h: E });
    const pw = r.int(Math.round(W * 0.45), Math.round(W * 0.55));
    if (side === 'L') { Z('private', 0, E, W - pw, H, { bnd: 'e' }); Z('public', W - pw, E, pw, H); }
    else { Z('public', 0, E, pw, H); Z('private', pw, E, W - pw, H, { bnd: 'w' }); }
    Z('wing', wx, 0, ww, E);
  } else if (arch === 'duplex') { // v13: side-by-side duplex — unit A (suspect) is laid out, unit B is its mirror across the party wall
    WA = r.int(11, 13); const H = r.int(10, 11), pw = r.int(5, WA - 5); TW = 2 * WA; TH = H; parts.push({ x: 0, y: 0, w: TW, h: H });
    if (side === 'L') { Z('public', 0, 0, pw, H); Z('private', pw, 0, WA - pw, H, { bnd: 'w' }); }
    else { Z('private', WA, 0, WA - pw, H, { bnd: 'e' }); Z('public', 2 * WA - pw, 0, pw, H); }
  } else if (arch === 'single') { // v13: single-wide mobile home — one row of rooms, 5 cells deep
    cols = [['bed', r.int(4, 5)], ['bathhall', 3], ['kitchen', r.int(4, 5)], ['living', r.int(5, 6)], ['bed', r.int(3, 4)]];
    TW = cols.reduce((a, c) => a + c[1], 0); TH = 5; parts.push({ x: 0, y: 0, w: TW, h: TH });
  } else if (arch === 'double') { // v13: double-wide mobile home — bungalow-style zones in a long, shallow box
    const W = r.int(17, 20), H = r.int(8, 9), pw = r.int(7, W - 8); TW = W; TH = H; parts.push({ x: 0, y: 0, w: W, h: H });
    if (side === 'R') { Z('private', 0, 0, W - pw, H, { bnd: 'e' }); Z('public', W - pw, 0, pw, H); }
    else { Z('public', 0, 0, pw, H); Z('private', pw, 0, W - pw, H, { bnd: 'w' }); }
  } else { // split-entry: tuck-under garage inside the footprint
    const W = r.int(19, 22), H = r.int(12, 13), G = r.int(6, 7), GH = r.int(6, 7); TW = W; TH = H; parts.push({ x: 0, y: 0, w: W, h: H });
    const gx = side === 'L' ? 0 : W - G; garage = { x: gx, y: H - GH, w: G, h: GH };
    Z('wing', gx, 0, G, H - GH);
    const rx = side === 'L' ? G : 0, rw = W - G, pw = r.int(6, rw - 6);
    if (side === 'L') { Z('public', rx, 0, pw, H); Z('private', rx + pw, 0, rw - pw, H, { bnd: 'w' }); }
    else { Z('private', rx, 0, rw - pw, H, { bnd: 'e' }); Z('public', rx + rw - pw, 0, pw, H); }
  }
  // place in the lot: front wall at frontY, centred with jitter
  // v22: ~35% of mobile homes stand end-on to the street (rotated 90°: long axis north-south, doors on the long east / west sides). Own stream.
  const rot = struct === 'trailer' && (S.opts && S.opts.trailerRot != null ? !!S.opts.trailerRot : makeRng(S.seed * 977 + 41)() < TRAILER_ROT);
  const FW = rot ? TH : TW, FH = rot ? TW : TH;
  const ox = clamp(Math.round((lot.x0 + lot.x1 + 1) / 2 - FW / 2) + r.int(-3, 3), lot.x0 + 5, lot.x1 - FW - 4), oy = Math.min(frontY + (rot ? 2 : 0), lot.y1 - 5) - FH + 1;
  const R = [], openEdges = [], doorSpecs = [];
  const RT = (x, y, w, h) => rot ? { x: ox + y, y: oy + (TW - x - w), w: h, h: w } : { x: ox + x, y: oy + y, w, h };
  const add = (name, type, x, y, w, h) => { const rm = Object.assign({ name, type }, RT(x, y, w, h)); R.push(rm); return rm; };
  let privRooms = [], wingRooms = [], hall = null, pub = {};
  if (cols) { // single-wide: columns left→right (mirrored for side R); bath stacked over a short hall
    let xx = 0; const at = w => { const x = side === 'R' ? TW - xx - w : xx; xx += w; return x; };
    for (const [k, w] of cols) { const x = at(w);
      if (k === 'bathhall') { privRooms.push(add('', 'bed', x, 0, w, 3)); hall = add('Hallway', 'hall', x, 3, w, 2); hall.bnd = side === 'R' ? 'w' : 'e'; }
      else if (k === 'bed') (privRooms.length ? wingRooms : privRooms).push(add('', 'bed', x, 0, w, TH));
      else if (k === 'kitchen') pub.kitchen = add('Kitchen', 'kitchen', x, 0, w, TH);
      else pub.living = add('Living Room', 'living', x, 0, w, TH); } }
  for (const z of zones) {
    if (z.k === 'private') {
      if (z.h >= 8 && z.w >= 3) { const a = r.int(3, z.h - 5); hall = add('Hallway', 'hall', z.x, z.y + a, z.w, 2);
        let xx = z.x; for (const s of segs(r, z.w)) { privRooms.push(add('', 'bed', xx, z.y, s, a)); xx += s; }
        xx = z.x; for (const s of segs(r, z.w)) { privRooms.push(add('', 'bed', xx, z.y + a + 2, s, z.h - a - 2)); xx += s; }
        hall.bnd = z.bnd;
      } else { let xx = z.x; for (const s of segs(r, z.w)) { privRooms.push(add('', 'bed', xx, z.y, s, z.h)); xx += s; } }
    } else if (z.k === 'public') {
      if (z.stack && z.h >= 12) { const l = r.int(4, 5), d = r.int(3, 4); pub.living = add('Living Room', 'living', z.x, z.y + z.h - l, z.w, l);
        pub.dining = add('Dining Room', 'dining', z.x, z.y + z.h - l - d, z.w, d); pub.kitchen = add('Kitchen', 'kitchen', z.x, z.y, z.w, z.h - l - d); }
      else { const ld = r.int(Math.round(z.h * 0.5), Math.round(z.h * 0.6)), bh = z.h - ld; pub.living = add('Living Room', 'living', z.x, z.y + bh, z.w, ld);
        if (z.w >= 9) { const kw = r.int(4, z.w - 4), kl = r.chance(0.5); pub.kitchen = add('Kitchen', 'kitchen', kl ? z.x : z.x + z.w - kw, z.y, kw, bh); pub.dining = add('Dining Room', 'dining', kl ? z.x + kw : z.x, z.y, z.w - kw, bh); }
        else pub.kitchen = add('Kitchen', 'kitchen', z.x, z.y, z.w, bh); }
    } else if (z.k === 'wing') {
      const horiz = z.w >= z.h, L2 = Math.max(z.w, z.h);
      if (L2 >= 7) { const a = r.int(3, L2 - 3); wingRooms.push(horiz ? add('', 'bed', z.x, z.y, a, z.h) : add('', 'bed', z.x, z.y, z.w, a));
        wingRooms.push(horiz ? add('', 'office', z.x + a, z.y, z.w - a, z.h) : add('', 'office', z.x, z.y + a, z.w, z.h - a)); }
      else wingRooms.push(add('', 'office', z.x, z.y, z.w, z.h));
    }
  }
  // name the private rooms: smallest = bath, largest = master
  const pr = privRooms.slice().sort((a, b) => a.w * a.h - b.w * b.h);
  if (pr.length) { pr[0].type = 'bath'; pr[0].name = 'Bathroom'; }
  if (pr.length >= 5 && pr[1].w * pr[1].h <= 16) { pr[1].type = 'office'; pr[1].name = 'Office'; }
  const beds = privRooms.concat(wingRooms).filter(q => q.type === 'bed').sort((a, b) => b.w * b.h - a.w * a.h);
  beds.forEach((q, i) => q.name = i === 0 ? 'Master Bedroom' : 'Bedroom ' + (i + 1));
  let offN = 0; R.filter(q => q.type === 'office' && !q.name).forEach(q => q.name = offN++ ? 'Den' : (R.some(p => p.name === 'Office') ? 'Den' : 'Office'));
  if (wingRooms.length === 2 && wingRooms[1].w * wingRooms[1].h <= 12 && r.chance(0.5)) { wingRooms[1].type = 'bath'; wingRooms[1].name = 'Bathroom 2'; }
  if (garage) { const g = add('Garage', 'garage', garage.x, garage.y, garage.w, garage.h); garage = g; }
  R.forEach((rm, i) => { rm.id = i; rm.known = false; rm.explored = false; rm.gas = 0;
    for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) S.room[idx(x, y)] = i; });
  S.rooms = R;
  // ---- connections ----
  const door = (pair, opt) => pair && doorSpecs.push(Object.assign({ cells: [pair] }, opt || {}));
  const open = (A, B, n) => { const sh = sharedEdges(A, B); if (sh.length < 3) { if (sh.length) door(interiorPick(r, sh)); return; }
    const k = sh.sort((p, q) => (p[0][0] - q[0][0]) || (p[0][1] - q[0][1])); const st = r.int(1, Math.max(1, k.length - n - 1)); for (let i = st; i < Math.min(k.length - 1, st + n); i++) openEdges.push(k[i]); };
  if (hall) { for (const rm of privRooms) { const sh = sharedEdges(rm, hall); if (sh.length) door(interiorPick(r, sh)); }
    // hall end opens into the public zone
    if (rot) { const ey = hall.bnd === 'e' ? hall.y : hall.y + hall.h - 1, ny = hall.bnd === 'e' ? ey - 1 : ey + 1; // rotated: local east = map north
      for (const xx of [hall.x, hall.x + 1]) if (roomAt(xx, ny) >= 0) openEdges.push([[xx, ey], [xx, ny]]); }
    else { const ex = hall.bnd === 'e' ? hall.x + hall.w - 1 : hall.x, nx = hall.bnd === 'e' ? ex + 1 : ex - 1;
    for (const yy of [hall.y, hall.y + 1]) if (roomAt(nx, yy) >= 0) openEdges.push([[ex, yy], [nx, yy]]); } }
  else for (let i = 1; i < privRooms.length; i++) { const sh = sharedEdges(privRooms[i - 1], privRooms[i]); if (sh.length) door(interiorPick(r, sh)); }
  if (pub.kitchen && pub.living) { if (sharedEdges(pub.kitchen, pub.living).length >= 4 && r.chance(0.7)) open(pub.kitchen, pub.living, r.int(2, 3)); else { const sh = sharedEdges(pub.kitchen, pub.living); if (sh.length) door(interiorPick(r, sh)); } }
  if (pub.kitchen && pub.dining) open(pub.kitchen, pub.dining, 2);
  if (pub.dining && pub.living) { const sh = sharedEdges(pub.dining, pub.living); if (sh.length >= 4) open(pub.dining, pub.living, 2); else if (sh.length) door(interiorPick(r, sh)); }
  if (wingRooms.length === 2) { const sh = sharedEdges(wingRooms[0], wingRooms[1]); if (sh.length) door(interiorPick(r, sh)); }
  // union-find connectivity (garage handled separately)
  const par = R.map((_, i) => i), f = i => par[i] === i ? i : (par[i] = f(par[i])), un = (a, b) => { par[f(a)] = f(b); };
  const link = (pair) => { const a = roomAt(pair[0][0], pair[0][1]), b = roomAt(pair[1][0], pair[1][1]); if (a >= 0 && b >= 0) un(a, b); };
  openEdges.forEach(link); doorSpecs.forEach(d => link(d.cells[0]));
  const living = pub.living || R[0];
  const rank = t => ({ hall: 0, living: 1, dining: 2, kitchen: 2, office: 3, bed: 4, bath: 9 })[t] ?? 5;
  for (let guard = 0; guard < 20; guard++) {
    const comps = new Set(R.filter(q => q.type !== 'garage').map(q => f(q.id))); if (comps.size <= 1) break;
    let best = null, bs = 1e9;
    for (const A of R) for (const B of R) { if (A.type === 'garage' || B.type === 'garage' || f(A.id) !== f(living.id) || f(B.id) === f(living.id)) continue;
      const sh = sharedEdges(A, B); if (!sh.length) continue; const s = rank(A.type) + rank(B.type) + r(); if (s < bs) { bs = s; best = [A, B, sh]; } }
    if (!best) break; door(interiorPick(r, best[2])); un(best[0].id, best[1].id);
  }
  if (garage) { let best = null, bs = 1e9; for (const A of R) { if (A === garage) continue; const sh = sharedEdges(garage, A); if (!sh.length) continue; const s = ({ kitchen: 0, hall: 1, living: 2, dining: 2, office: 3, bed: 5, bath: 9 })[A.type] + r(); if (s < bs) { bs = s; best = sh; } }
    if (best) door(interiorPick(r, best), { locked: r.chance(0.5), name: 'Garage Entry' }); }
  const M = 2 * ox + TW - 1, mc = c => [M - c[0], c[1]], nA = R.length;
  if (arch === 'duplex') { // mirror unit A into unit B: rooms, open walls and interior doors (never through the party wall)
    for (let i = 0; i < nA; i++) { const q = R[i]; q.unit = 'A'; R.push({ name: q.name + ' (B)', type: q.type, x: M - (q.x + q.w - 1), y: q.y, w: q.w, h: q.h, unitB: true, unit: 'B', twin: i }); q.twin = nA + i; }
    R.forEach((rm, i) => { rm.id = i; rm.known = false; rm.explored = false; rm.gas = 0; for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) S.room[idx(x, y)] = i; });
    const nO = openEdges.length; for (let i = 0; i < nO; i++) openEdges.push([mc(openEdges[i][0]), mc(openEdges[i][1])]);
    const nD = doorSpecs.length; for (let i = 0; i < nD; i++) { const d = doorSpecs[i]; doorSpecs.push({ cells: d.cells.map(([a, b]) => [mc(a), mc(b)]), locked: d.locked, unitB: true }); } }
  for (const [a, b] of openEdges) S.edges.set(ek(a[0], a[1], b[0], b[1]), E_OPEN);
  // ---- exterior doors ----
  const extPick = (rooms, sides) => { for (const rm of rooms) { if (!rm) continue; for (const sd of sides) { const e = extEdges(rm, sd); if (e.length >= 3) return interiorPick(r, e); } } return null; };
  const front = extPick([pub.living, pub.dining, pub.kitchen, ...R.filter(q => q.type !== 'garage' && q.type !== 'bath')], [rot ? 'e' : 's']) || extPick(R, rot ? ['e', 'w', 's'] : ['s', 'e', 'w']);
  door(front, { exterior: true, locked: true, name: 'Front Door' });
  const back = extPick([pub.kitchen, pub.dining, pub.living, ...R.filter(q => q.type === 'office' || q.type === 'hall')], [rot ? 'w' : 'n']) || extPick([pub.kitchen, pub.dining, ...R.filter(q => q.type !== 'bath' && q.type !== 'garage')], ['e', 'w', 'n']);
  if (back && !(back[0][0] === front[0][0] && back[0][1] === front[0][1])) door(back, { exterior: true, locked: true, name: 'Back Door' });
  if (arch === 'duplex') { door(front && [mc(front[0]), mc(front[1])], { exterior: true, locked: true, name: 'Unit B Front Door', unitB: true });
    if (back && !(back[0][0] === front[0][0] && back[0][1] === front[0][1])) door([mc(back[0]), mc(back[1])], { exterior: true, locked: true, name: 'Unit B Back Door', unitB: true }); }
  if (garage) { const gf = extEdges(garage, 's').sort((p, q) => p[0][0] - q[0][0]); doorSpecs.push({ cells: gf.slice(1, -1), exterior: true, locked: true, kind: 'garage', name: 'Garage Door' });
    const gs = extPick([garage], ['e', 'w', 'n']); if (gs) door(gs, { exterior: true, locked: true, name: 'Garage Side Door' }); }
  if ((arch === 'colonial' || arch === 'lshape' || arch === 'bungalow') && r.chance(0.6)) { const sd = extPick(r.shuffle(R.filter(q => ['kitchen', 'office', 'dining', 'living'].includes(q.type))), ['e', 'w']); if (sd) door(sd, { exterior: true, locked: true, name: 'Side Door' }); }
  const used = new Set();
  S.doors = doorSpecs.filter(d => d.cells.length && d.cells.every(p => { const k = ek(p[0][0], p[0][1], p[1][0], p[1][1]); if (used.has(k)) return false; return true; }) && (d.cells.forEach(p => used.add(ek(p[0][0], p[0][1], p[1][0], p[1][1]))), true)).map((d, i) => {
    const o = { id: i, cells: d.cells, state: 'closed', locked: !!d.locked, barricaded: false, exterior: !!d.exterior, kind: d.kind || 'door', name: d.name || '', known: !!d.exterior, storm: !!d.exterior && d.kind !== 'garage' && r.chance(d.name === 'Front Door' ? 0.55 : 0.35), stormState: 'closed', stormKnown: false, charge: null };
    if (d.unitB) o.unitB = true; if (cols || arch === 'double') { o.thin = true; o.storm = false; } // v13: hollow mobile-home doors, no storm doors
    const [a, b] = d.cells[0]; o.rooms = [roomAt(a[0], a[1]), roomAt(b[0], b[1])];
    if (!o.name) o.name = (S.rooms[o.rooms[0]] || {}).name + ' / ' + (S.rooms[o.rooms[1]] || {}).name;
    if (!o.exterior && !o.locked && r.chance(0.35)) o.state = 'open';
    for (const [p, q] of d.cells) S.edges.set(ek(p[0], p[1], q[0], q[1]), { t: 'D', d: o });
    return o;
  });
  // ---- windows on exterior walls ----
  S.windows = [];
  for (const rm of R) {
    if (rm.type === 'hall') continue;
    const sides = [['n', rm.x, rm.y, 1, 0, 0, -1, rm.w], ['s', rm.x, rm.y + rm.h - 1, 1, 0, 0, 1, rm.w], ['w', rm.x, rm.y, 0, 1, -1, 0, rm.h], ['e', rm.x + rm.w - 1, rm.y, 0, 1, 1, 0, rm.h]];
    for (const [sd, sx, sy, stx, sty, nx, ny, len] of sides) {
      let run = [];
      const flush = () => {
        const Ln = run.length; if (Ln >= 3) {
          const wl = rm.type === 'bath' || rm.type === 'garage' ? 1 : (rm.type === 'living' && Ln >= 6 ? 3 : 2);
          const centers = Ln >= 9 ? [Math.floor(Ln / 4), Math.floor(3 * Ln / 4)] : [Math.floor(Ln / 2)];
          for (const c of centers) { const st = clamp(c - Math.floor(wl / 2), 1, Ln - wl - 1); if (st + wl > Ln - 1) continue; const w = { id: S.windows.length, room: rm.id, side: sd, edges: [], broken: false };
            for (let k = st; k < st + wl; k++) { const [cx, cy] = run[k]; w.edges.push([cx, cy, cx + nx, cy + ny]); S.edges.set(ek(cx, cy, cx + nx, cy + ny), { t: 'W', w }); }
            S.windows.push(w); }
        } run = [];
      };
      for (let k = 0; k < len; k++) { const cx = sx + stx * k, cy = sy + sty * k;
        if (roomAt(cx + nx, cy + ny) === -1 && !S.edges.has(ek(cx, cy, cx + nx, cy + ny))) run.push([cx, cy]); else flush(); }
      flush();
    }
  }
  const P = parts.map(q => RT(q.x, q.y, q.w, q.h));
  const ARCH = { ranch: 'Ranch · attached garage', colonial: 'Colonial · detached garage', lshape: 'L-shaped · rear wing', split: 'Split-entry · tuck-under garage', bungalow: 'Bungalow',
    duplex: 'Duplex · side-by-side', single: 'Mobile home · single-wide', double: 'Mobile home · double-wide' };
  S.house = { arch, archName: ARCH[arch], parts: P, garage: garage ? { x: garage.x, y: garage.y, w: garage.w, h: garage.h } : null, detached, side,
    x0: ox, x1: ox + FW - 1, y0: oy, y1: oy + FH - 1, oy, H: FH, TW: FW, rot: rot || undefined };
  S.house.main = P[0]; S.house.struct = struct;
  if (struct === 'trailer') { S.house.trailer = arch; S.house.thin = true; sr.chance(STRUCT_CFG.park); S.house.park = true; } // v23: neighbours either side are always mobile homes
  if (struct === 'duplex') S.house.duplex = { partyX: ox + WA, aSide: side, bRooms: R.filter(q => q.unitB).map(q => q.id) }; // party wall between x = partyX-1 and partyX
}
/** v13: rooms of the suspect's own dwelling (a duplex's unit B is a separate home) */
function ownRooms() { return S.rooms.filter(q => !q.unitB); }
function isOwnRoom(i) { return i >= 0 && S.rooms[i] && !S.rooms[i].unitB; }
/** Validation used by the generator and the test harness. */
function validateHouse() {
  const errs = [];
  const fd = S.doors.find(d => d.name === 'Front Door'); if (!fd) { errs.push('no front door'); return errs; }
  const out = fd.cells[0].find(c => roomAt(c[0], c[1]) < 0) || fd.cells[0][1];
  const D = reach(out[0], out[1], { allDoors: true }, 1e6);
  for (const rm of S.rooms) { let ok = false; for (let y = rm.y; y < rm.y + rm.h && !ok; y++) for (let x = rm.x; x < rm.x + rm.w; x++) if (D[idx(x, y)] < 1e9) { ok = true; break; } if (!ok) errs.push('unreachable ' + rm.name); }
  for (const d of S.doors) for (const [a, b] of d.cells) { if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) !== 1) errs.push('bad door ' + d.name); if (roomAt(a[0], a[1]) === roomAt(b[0], b[1])) errs.push('door inside room ' + d.name); if (d.exterior && roomAt(a[0], a[1]) >= 0 && roomAt(b[0], b[1]) >= 0) errs.push('exterior door between rooms ' + d.name); }
  for (const w of S.windows) for (const [cx, cy, ox, oy] of w.edges) if (roomAt(cx, cy) < 0 || roomAt(ox, oy) >= 0) errs.push('bad window');
  for (let i = 0; i < S.rooms.length; i++) for (let j = i + 1; j < S.rooms.length; j++) { const A = S.rooms[i], B = S.rooms[j]; if (A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h) errs.push('overlap ' + A.name + '/' + B.name); }
  for (const rm of S.rooms) if (rm.w < 2 || rm.h < 2) errs.push('tiny room ' + rm.name);
  if (!S.rooms.some(q => q.type === 'bath')) errs.push('no bath');
  return errs;
}
