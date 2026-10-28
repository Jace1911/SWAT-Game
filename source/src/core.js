/* =====================================================================
   MODULE 1 — CORE GAME RULES  (pure logic: no DOM, no canvas, no timers)
   ---------------------------------------------------------------------
   Everything that decides *what happens* lives here: seeded map
   generation (target house archetypes + neighborhood), units, line of
   sight, cover & exposure, orders, cruisers, ballistics, turn resolution,
   suspect AI, intel and win/lose. Renderer/UI only READ Core.state and
   call the public API at the bottom. Port this module 1:1 to GDScript/C#.
   Coordinates: integer grid cells (1 cell ≈ 1 m). Cell (x,y) centre = (x,y).
   ===================================================================== */
const Core = (function () {
'use strict';
const MAP_W = 112, MAP_H = 72, TICKS = 8, LOSE_DOWN = 3; // LOSE_DOWN: kept only as the 'heavy losses' warning threshold — the mission never auto-ends on losses or time
/* ---------- time display: logic stays turn-based; each executed turn = 30 s of scene time ---------- */
const TURN_SEC = 30;
function mmss(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
/** Duration of n turns as m:ss (e.g. 3 turns → '1:30'). */
function tDur(n) { return mmss(n * TURN_SEC); }
/** Rough duration of n turns in minutes (e.g. 3 turns → '1.5 min', 2 → '1 min'). */
function tMin(n) { const m = n * TURN_SEC / 60; return (Number.isInteger(m) ? m : m.toFixed(1)) + ' min'; }
/** Scene clock (time of day) at a turn/tick; S.clock0 = when SWAT was activated (from the brief). */
function clockAt(turn, tick) { const s = ((S && S.clock0) || 0) + turn * TURN_SEC + Math.round((tick || 0) * TURN_SEC / TICKS); const t = ((s % 86400) + 86400) % 86400, p = n => String(n).padStart(2, '0');
  return `${p(Math.floor(t / 3600))}:${p(Math.floor(t / 60) % 60)}:${p(t % 60)}`; }
/** Elapsed time since activation, m:ss. */
function elapsedAt(turn, tick) { return mmss(turn * TURN_SEC + (tick || 0) * TURN_SEC / TICKS); }

/* ---------- seeded RNG (mulberry32) ---------- */
function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const r = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  r.chance = p => r() < p;
  r.shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  return r;
}

/* ---------- static data ---------- */
const EQUIP = {
  shield:     { name: 'Ballistic Shield',      short: 'Shield',   pool: 2,  desc: 'Reduces chance of an officer going down when engaged.' },
  ram:        { name: 'Battering Ram',         short: 'Ram',      pool: 2,  desc: 'Manual breach. Medium speed; barricades and storm doors slow it.' },
  halligan:   { name: 'Halligan Bar',          short: 'Halligan', pool: 3,  desc: 'Pry or kick-assist. Quieter but slowest; must pry a storm door first.' },
  charge:     { name: 'Breaching Charge',      short: 'Charge',   pool: 3,  desc: 'Hang, back off, detonate. Fastest and most reliable; very loud. Needs a breacher.' },
  bang:       { name: 'Flashbang',             short: 'Flashbang',pool: 10, desc: 'Disorients occupants of a room for several ticks.' },
  gas:        { name: 'CS Gas Canister',       short: 'CS Gas',   pool: 4,  desc: 'Room becomes uninhabitable; suspect may surrender or flee.' },
  lesslethal: { name: 'Less-Lethal Launcher',  short: '40mm LL',  pool: 2,  desc: 'Can incapacitate a hostile suspect; launches gas through windows.' },
  polecam:    { name: 'Mirror / Pole Camera',  short: 'Pole Cam', pool: 2,  desc: 'Peek under a door into the next room without opening it.' },
  drone:      { name: 'Micro Drone',           short: 'Drone',    pool: 1,  desc: 'Fast flying scout. Needs a tech operator.' },
  robot:      { name: 'Ground Robot',          short: 'Robot',    pool: 1,  desc: 'Tracked camera robot. Needs a tech operator.' },
  medkit:     { name: 'Medkit',                short: 'Medkit',   pool: 3,  desc: 'With a medic: stabilises a casualty (stops the critical countdown) or buys extra time for a severe one.' },
  tphone:     { name: 'Throw Phone',           short: 'T-Phone',  pool: 2,  desc: 'Hard-case phone thrown through an opening or delivered by robot — opens a line without his number.' },
  bullhorn:   { name: 'Bullhorn',              short: 'Bullhorn', pool: 2,  desc: 'Portable loudspeaker: PA contact, call-outs and walk-out commands (cruisers have a built-in PA).' },
};
const SPECS = {
  leader:     { name: 'Team Leader', icon: '★', desc: '+ team coordination' },
  point:      { name: 'Point',       icon: '▲', desc: 'First in; lowers ambush risk' },
  breacher:   { name: 'Breacher',    icon: '⚒', desc: 'Better at every manual breach; the only one who can hang explosive charges' },
  marksman:   { name: 'Marksman / Sniper', icon: '◎', desc: 'Precision rifle; can take Overwatch in a neighbor house. Best odds vs a suspect at a window' },
  negotiator: { name: 'Negotiator',  icon: '☎', desc: 'Runs contact & dialogue from the command post; a second one coaches (+10%)' },
  k9:         { name: 'K9 Handler',  icon: '🐾', desc: 'Dog detects suspect through walls' },
  medic:      { name: 'Medic',       icon: '✚', desc: 'Full first aid with a medkit — stabilises casualties' },
  tech:       { name: 'Tech / Robot Op', icon: '⌬', desc: 'Operates drone & robot' },
};
/* Extra qualifications (shown in member detail). */
const QUALS = { spotter: { name: 'Sniper Spotter', icon: '◆', desc: 'Trained observer: biggest hit-chance bonus when paired with a sniper, spots the suspect at windows sooner' } };
/* Officer weapons. range = max effective cells; base = hit chance at point blank vs a fully exposed target. */
const WEAPONS = {
  pistol: { name: 'Pistol',          short: 'Pistol', range: 18, base: 0.10 },
  rifle:  { name: 'Patrol / Carbine Rifle', short: 'Rifle', range: 36, base: 0.20 },
  sniper: { name: 'Precision Rifle', short: 'Precision', range: 80, base: 0.42 },
};
/* Suspect weapons (seeded). */
const SUSPECT_WEAPONS = {
  handgun: { name: 'handgun', range: 24, base: 0.34 },
  rifle:   { name: 'hunting rifle', range: 36, base: 0.30 },
  shotgun: { name: 'shotgun', range: 16, base: 0.42 },
};
const STANCES = { return: 'Return fire', free: 'Fire at will', hold: 'Hold fire' };
const TEAM_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
const LAST = ['Reyes','Kim','Novak','Okafor','Brennan','Castillo','Haddad','Lindqvist','Morales','Tran','Walsh','Diaz','Petrov','Hughes','Sato','Mensah','Kowalski','Rivera'];
const LAST2 = ['Abbott','Banks','Chen','Dorsey','Ellison','Fischer','Gomez','Hale','Ibarra','Jovanovic','Kaur','Lund','Marsh','Nakamura','Olsen','Pratt','Quinn','Rossi','Sandoval','Tate','Underwood','Varga','Whitfield','Yilmaz'];
const PATROL = ['Miller','Grant','Shah','Ortiz','Becker'];
const OPS = ['NIGHTFALL','IRON GATE','BLUE HERON','STONEWALL','SILENT KEY','COLD HARBOR','NORTH STAR','GLASS HOUSE','BLACKWOOD','HALCYON'];
const STREETS = ['Maple', 'Oak Hollow', 'Linden', 'Birch', 'Willow Creek', 'Juniper', 'Aspen', 'Cedar Ridge', 'Elm', 'Sycamore'];
const COVER_NAMES = ['', 'tree', 'hedge', 'parked car', 'shed', 'neighbor house', 'mailbox', 'low wall', 'fence', 'SWAT truck', 'garage', 'utility box'];

let S = null;   // the whole game state (serialisable except Map/typed arrays)

/* ---------- grid helpers ---------- */
const idx = (x, y) => y * MAP_W + x;
const inb = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
const roomAt = (x, y) => inb(x, y) ? S.room[idx(x, y)] : -1;
const ek = (ax, ay, bx, by) => ax === bx ? 'h,' + ax + ',' + Math.max(ay, by) : 'v,' + Math.max(ax, bx) + ',' + ay;
const E_OPEN = { t: 'O' }, E_WALL = { t: 'X' }, E_FENCE = { t: 'F' };
function edge(ax, ay, bx, by) { const e = S.edges.get(ek(ax, ay, bx, by)); if (e) return e; return roomAt(ax, ay) === roomAt(bx, by) ? E_OPEN : E_WALL; }
function seeE(ax, ay, bx, by) { const e = edge(ax, ay, bx, by); return e.t === 'O' || e.t === 'F' || e.t === 'W' || (e.t === 'D' && e.d.state !== 'closed'); }
function passE(e, o) {
  if (e.t === 'O') return true;
  if (e.t === 'F') return !!o.fly;
  if (e.t === 'W') return !!(o.fly && e.w.broken);
  if (e.t === 'D') { const d = e.d; if (d.state !== 'closed') return true; if (o.assume && o.assume.has(d.id)) return true;
    if (o.suspect && !d.exterior) return true; if (o.canOpen && !d.locked && !d.barricaded) return true; if (o.allDoors) return true; }
  return false;
}
function cellOk(x, y, o) {
  if (!inb(x, y)) return false;
  const c = idx(x, y);
  if (o.drive) return !!S.drive[c] && !carClash(x, y, o.self);
  if (!o.fly && (S.block[c] || S.dyn[c])) return false;
  if (o.fly && S.opaque[c]) return false;
  if (o.outdoor && S.room[c] >= 0) return false;
  if (o.avoidSuspect && suspectActive() && S.suspect.x === x && S.suspect.y === y) return false;
  return true;
}
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- Dijkstra pathfinding (8-dir, no corner cutting) ----------
   o.expo: add a cost for outdoor cells exposed to the house's windows/doors,
   so officers route around lines of fire instead of across them. */
function heapQ() { const h = []; return { h,
  push(c, k) { h.push([k, c]); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } },
  pop() { const top = h[0], last = h.pop(); if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } } return top; } }; }
function stepCost(x, y, dx, dy, o) {
  const nx = x + dx, ny = y + dy;
  if (!cellOk(nx, ny, o)) return -1;
  let cost = 1;
  if (dx && dy) {
    if (!cellOk(x + dx, y, o) || !cellOk(x, y + dy, o)) return -1;
    if (!o.drive && (!passE(edge(x, y, x + dx, y), o) || !passE(edge(x + dx, y, nx, ny), o) || !passE(edge(x, y, x, y + dy), o) || !passE(edge(x, y + dy, nx, ny), o))) return -1;
    cost = 1.414;
  } else if (!o.drive) { const e = edge(x, y, nx, ny); if (!passE(e, o)) return -1; if (e.t === 'D' && e.d.state === 'closed') cost += 1.5; }
  if (o.expo && S.expo) { const c = idx(nx, ny); if (S.room[c] < 0) cost += Math.min(3, S.expo[c]) * 2.2; }
  return cost;
}
function findPath(sx, sy, goal, o) {
  if (goal(sx, sy)) return [];
  const N = MAP_W * MAP_H, D = new Float64Array(N).fill(1e9), P = new Int32Array(N).fill(-1), q = heapQ();
  const s = idx(sx, sy); D[s] = 0; q.push(s, 0);
  while (q.h.length) {
    const [k, c] = q.pop(); if (k > D[c]) continue;
    const x = c % MAP_W, y = (c / MAP_W) | 0;
    if (c !== s && goal(x, y)) { const out = []; let p = c; while (p !== s) { out.push([p % MAP_W, (p / MAP_W) | 0]); p = P[p]; } return out.reverse(); }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const sc = stepCost(x, y, dx, dy, o); if (sc < 0) continue;
      const n = idx(x + dx, y + dy), nd = k + sc; if (nd < D[n]) { D[n] = nd; P[n] = c; q.push(n, nd); }
    }
  }
  return null;
}
/** Bounded Dijkstra: returns cost field (1e9 = unreachable) up to maxCost. */
function reach(sx, sy, o, maxCost) {
  const N = MAP_W * MAP_H, D = new Float64Array(N).fill(1e9), q = heapQ(); const s = idx(sx, sy); D[s] = 0; q.push(s, 0);
  while (q.h.length) { const [k, c] = q.pop(); if (k > D[c]) continue; const x = c % MAP_W, y = (c / MAP_W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const sc = stepCost(x, y, dx, dy, o); if (sc < 0) continue;
      const n = idx(x + dx, y + dy), nd = k + sc; if (nd <= maxCost && nd < D[n]) { D[n] = nd; q.push(n, nd); } } }
  return D;
}

/* ---------- line of sight / line of fire ----------
   losEx → { v: 0 blocked | 1 clear | 2 clear through glass, cov: 0 none | 1 soft | 2 hard }
   cov = best cover between the two points within 2.6 m of the TARGET (b):
   an officer crouched behind a car/tree/fence close to him. */
function losEx(ax, ay, bx, by, wantCov) {
  const dx = bx - ax, dy = by - ay, steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 3);
  let cx = ax, cy = ay, glass = false, cov = 0;
  const near = (x, y) => wantCov && (x - bx) * (x - bx) + (y - by) * (y - by) <= 6.8;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, nx = Math.round(ax + dx * t), ny = Math.round(ay + dy * t);
    if (nx === cx && ny === cy) continue;
    const fin = nx === bx && ny === by;
    if (nx !== cx && ny !== cy) {
      const p1 = seeE(cx, cy, nx, cy) && seeE(nx, cy, nx, ny), p2 = seeE(cx, cy, cx, ny) && seeE(cx, ny, nx, ny);
      if (!p1 && !p2) return { v: 0, cov };
      const ea = p1 ? edge(cx, cy, nx, cy) : edge(cx, cy, cx, ny), eb = p1 ? edge(nx, cy, nx, ny) : edge(cx, ny, nx, ny);
      if (ea.t === 'W' || eb.t === 'W') glass = true;
      if ((ea.t === 'F' || eb.t === 'F') && near(nx, ny)) cov = Math.max(cov, 1);
      // squeezing diagonally past an opaque corner is blocked
      if (S.opaque[idx(nx, cy)] && S.opaque[idx(cx, ny)]) return { v: 0, cov };
    } else { if (!seeE(cx, cy, nx, ny)) return { v: 0, cov }; const e = edge(cx, cy, nx, ny); if (e.t === 'W') glass = true; if (e.t === 'F' && near(nx, ny)) cov = Math.max(cov, 1); }
    const c = idx(nx, ny);
    if (!fin) { if (S.opaque[c]) return { v: 0, cov };
      if (wantCov && near(nx, ny)) { const k = S.dyn[c] && !COV_STATIC ? 2 : S.cov[c]; if (k > cov) cov = k; } }
    cx = nx; cy = ny;
  }
  return { v: glass ? 2 : 1, cov };
}
function los(ax, ay, bx, by) { return losEx(ax, ay, bx, by, false).v; }

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
function genHouse(r, lot, frontY) {
  const arch = r.pick(['ranch', 'ranch', 'colonial', 'lshape', 'split', 'bungalow']);
  const side = r.chance(0.5) ? 'L' : 'R';
  let TW, TH, garage = null, parts = [], zones = [], detached = false;
  const Z = (k, x, y, w, h, extra) => zones.push(Object.assign({ k, x, y, w, h }, extra || {}));
  if (arch === 'ranch' || arch === 'bungalow') {
    const W = arch === 'ranch' ? r.int(17, 22) : r.int(13, 15), H = arch === 'ranch' ? r.int(11, 13) : r.int(10, 11);
    const G = arch === 'ranch' ? r.int(6, 7) : 0; TW = W + G; TH = H; const mx = side === 'L' ? G : 0;
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
  } else { // split-entry: tuck-under garage inside the footprint
    const W = r.int(19, 22), H = r.int(12, 13), G = r.int(6, 7), GH = r.int(6, 7); TW = W; TH = H; parts.push({ x: 0, y: 0, w: W, h: H });
    const gx = side === 'L' ? 0 : W - G; garage = { x: gx, y: H - GH, w: G, h: GH };
    Z('wing', gx, 0, G, H - GH);
    const rx = side === 'L' ? G : 0, rw = W - G, pw = r.int(6, rw - 6);
    if (side === 'L') { Z('public', rx, 0, pw, H); Z('private', rx + pw, 0, rw - pw, H, { bnd: 'w' }); }
    else { Z('private', rx, 0, rw - pw, H, { bnd: 'e' }); Z('public', rx + rw - pw, 0, pw, H); }
  }
  // place in the lot: front wall at frontY, centred with jitter
  const ox = clamp(Math.round((lot.x0 + lot.x1 + 1) / 2 - TW / 2) + r.int(-3, 3), lot.x0 + 5, lot.x1 - TW - 4), oy = frontY - TH + 1;
  const R = [], openEdges = [], doorSpecs = [];
  const add = (name, type, x, y, w, h) => { const rm = { name, type, x: ox + x, y: oy + y, w, h }; R.push(rm); return rm; };
  let privRooms = [], wingRooms = [], hall = null, pub = {};
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
    const ex = hall.bnd === 'e' ? hall.x + hall.w - 1 : hall.x, nx = hall.bnd === 'e' ? ex + 1 : ex - 1;
    for (const yy of [hall.y, hall.y + 1]) if (roomAt(nx, yy) >= 0) openEdges.push([[ex, yy], [nx, yy]]); }
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
  for (const [a, b] of openEdges) S.edges.set(ek(a[0], a[1], b[0], b[1]), E_OPEN);
  // ---- exterior doors ----
  const extPick = (rooms, sides) => { for (const rm of rooms) { if (!rm) continue; for (const sd of sides) { const e = extEdges(rm, sd); if (e.length >= 3) return interiorPick(r, e); } } return null; };
  const front = extPick([pub.living, pub.dining, pub.kitchen, ...R.filter(q => q.type !== 'garage' && q.type !== 'bath')], ['s']) || extPick(R, ['s', 'e', 'w']);
  door(front, { exterior: true, locked: true, name: 'Front Door' });
  const back = extPick([pub.kitchen, pub.dining, pub.living, ...R.filter(q => q.type === 'office' || q.type === 'hall')], ['n']) || extPick([pub.kitchen, pub.dining, ...R.filter(q => q.type !== 'bath' && q.type !== 'garage')], ['e', 'w', 'n']);
  if (back && !(back[0][0] === front[0][0] && back[0][1] === front[0][1])) door(back, { exterior: true, locked: true, name: 'Back Door' });
  if (garage) { const gf = extEdges(garage, 's').sort((p, q) => p[0][0] - q[0][0]); doorSpecs.push({ cells: gf.slice(1, -1), exterior: true, locked: true, kind: 'garage', name: 'Garage Door' });
    const gs = extPick([garage], ['e', 'w', 'n']); if (gs) door(gs, { exterior: true, locked: true, name: 'Garage Side Door' }); }
  if ((arch === 'colonial' || arch === 'lshape' || arch === 'bungalow') && r.chance(0.6)) { const sd = extPick(r.shuffle(R.filter(q => ['kitchen', 'office', 'dining', 'living'].includes(q.type))), ['e', 'w']); if (sd) door(sd, { exterior: true, locked: true, name: 'Side Door' }); }
  const used = new Set();
  S.doors = doorSpecs.filter(d => d.cells.length && d.cells.every(p => { const k = ek(p[0][0], p[0][1], p[1][0], p[1][1]); if (used.has(k)) return false; return true; }) && (d.cells.forEach(p => used.add(ek(p[0][0], p[0][1], p[1][0], p[1][1]))), true)).map((d, i) => {
    const o = { id: i, cells: d.cells, state: 'closed', locked: !!d.locked, barricaded: false, exterior: !!d.exterior, kind: d.kind || 'door', name: d.name || '', known: !!d.exterior, storm: !!d.exterior && d.kind !== 'garage' && r.chance(d.name === 'Front Door' ? 0.55 : 0.35), stormState: 'closed', stormKnown: false, charge: null };
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
  const P = parts.map(q => ({ x: ox + q.x, y: oy + q.y, w: q.w, h: q.h }));
  const ARCH = { ranch: 'Ranch · attached garage', colonial: 'Colonial · detached garage', lshape: 'L-shaped · rear wing', split: 'Split-entry · tuck-under garage', bungalow: 'Bungalow' };
  S.house = { arch, archName: ARCH[arch], parts: P, garage: garage ? { x: garage.x, y: garage.y, w: garage.w, h: garage.h } : null, detached, side,
    x0: ox, x1: ox + TW - 1, y0: oy, y1: oy + TH - 1, oy, H: TH, TW };
  S.house.main = P[0];
}
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

/* ---------- furniture (blocks movement, not sight) ---------- */
function genFurniture(r) {
  S.furn = [];
  const reserved = new Set();
  const markRes = (x, y) => reserved.add(idx(x, y));
  for (const [k, e] of S.edges) { if (e.t !== 'O' && e.t !== 'D') continue;
    const [t, a, b] = k.split(','); const A = +a, B = +b;
    const pair = t === 'h' ? [[A, B - 1], [A, B]] : [[A - 1, B], [A, B]];
    for (const [x, y] of pair) if (roomAt(x, y) >= 0) { markRes(x, y); const o = pair[0] === pair.find(p => p[0] === x && p[1] === y) ? pair[1] : pair[0];
      const ix = x + (x - o[0]), iy = y + (y - o[1]); if (roomAt(ix, iy) === roomAt(x, y)) markRes(ix, iy); } }
  const connected = rm => { const cells = []; for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) if (!S.block[idx(x, y)]) cells.push(idx(x, y));
    if (!cells.length) return false; const seen = new Set([cells[0]]), st = [cells[0]];
    while (st.length) { const c = st.pop(), x = c % MAP_W, y = (c / MAP_W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, n = idx(nx, ny);
      if (roomAt(nx, ny) === rm.id && !S.block[n] && !seen.has(n)) { seen.add(n); st.push(n); } } }
    return seen.size === cells.length; };
  const tryPlace = (rm, kind, x, y, w, h, side, block = true) => {
    if (x < rm.x || y < rm.y || x + w > rm.x + rm.w || y + h > rm.y + rm.h) return null;
    const cs = []; for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const c = idx(xx, yy); if (S.block[c] || reserved.has(c)) return null; cs.push(c); }
    if (block) { cs.forEach(c => S.block[c] = 1); if (!connected(rm)) { cs.forEach(c => S.block[c] = 0); return null; } }
    const f = { kind, x, y, w, h, side, room: rm.id }; S.furn.push(f); return f;
  };
  const wall = (rm, kind, len, depth, sides, tries = 14) => {
    for (let t = 0; t < tries; t++) { const side = r.pick(sides); const ns = side === 'n' || side === 's'; const w = ns ? len : depth, h = ns ? depth : len;
      if (w > rm.w || h > rm.h) continue;
      const x = side === 'w' ? rm.x : side === 'e' ? rm.x + rm.w - w : r.int(rm.x, rm.x + rm.w - w);
      const y = side === 'n' ? rm.y : side === 's' ? rm.y + rm.h - h : r.int(rm.y, rm.y + rm.h - h);
      const f = tryPlace(rm, kind, x, y, w, h, side); if (f) return f; }
    return null;
  };
  const center = (rm, kind, w, h, block = true) => { for (let t = 0; t < 8; t++) { const x = rm.x + Math.floor((rm.w - w) / 2) + r.int(-1, 1), y = rm.y + Math.floor((rm.h - h) / 2) + r.int(-1, 1);
    if (x <= rm.x || y <= rm.y || x + w >= rm.x + rm.w || y + h >= rm.y + rm.h) continue; const f = tryPlace(rm, kind, x, y, w, h, 'c', block); if (f) return f; } return null; };
  const corner = (rm, kind) => { for (const [x, y] of r.shuffle([[rm.x, rm.y], [rm.x + rm.w - 1, rm.y], [rm.x, rm.y + rm.h - 1], [rm.x + rm.w - 1, rm.y + rm.h - 1]])) { const f = tryPlace(rm, kind, x, y, 1, 1, 'c'); if (f) return f; } return null; };
  const ALL = ['n', 's', 'e', 'w'];
  for (const rm of S.rooms) {
    switch (rm.type) {
      case 'living': { const s = wall(rm, 'sofa', 3, 1, ALL); const opp = s ? { n: 's', s: 'n', e: 'w', w: 'e' }[s.side] : 'n'; wall(rm, 'tv', 2, 1, [opp]) || wall(rm, 'tv', 2, 1, ALL);
        if (rm.w >= 6 && rm.h >= 5) { center(rm, 'rug', 3, 2, false); center(rm, 'coffee', 2, 1); } wall(rm, 'armchair', 1, 1, ALL); corner(rm, 'plant'); break; }
      case 'kitchen': wall(rm, 'counter', Math.min(rm.w - 1, 5), 1, ['n']) || wall(rm, 'counter', Math.min(rm.w - 1, 4), 1, ALL); wall(rm, 'fridge', 1, 1, ['e', 'w', 'n']);
        if (rm.w >= 6 && rm.h >= 5) center(rm, 'island', 2, 1); break;
      case 'dining': center(rm, 'table', rm.w >= 6 ? 3 : 2, 2) || center(rm, 'table', 2, 1); wall(rm, 'sideboard', 2, 1, ALL); corner(rm, 'plant'); break;
      case 'bed': { const big = rm.w >= 5 && rm.h >= 5; wall(rm, 'bed', big ? 3 : 2, 3, ALL, 20) || wall(rm, 'bed', 2, 2, ALL); wall(rm, 'dresser', 2, 1, ALL); wall(rm, 'nightstand', 1, 1, ALL); break; }
      case 'bath': wall(rm, 'tub', Math.min(3, Math.max(rm.w, rm.h) - 1), 1, ALL); wall(rm, 'toilet', 1, 1, ALL); wall(rm, 'vanity', 1, 1, ALL); break;
      case 'office': wall(rm, 'desk', 2, 1, ALL); wall(rm, 'shelves', 2, 1, ALL); corner(rm, 'plant'); break;
      case 'garage': { const f = tryPlace(rm, 'car', rm.x + 1 + r.int(0, Math.max(0, rm.w - 5)), rm.y + rm.h - 5, 2, 4, 's') || tryPlace(rm, 'car', rm.x + 2, rm.y + rm.h - 5, 2, 4, 's');
        wall(rm, 'workbench', 3, 1, ['n']); wall(rm, 'shelves', 2, 1, ['e', 'w']); break; }
    }
  }
}

/* =====================================================================
   MAP GENERATION 2/2 — NEIGHBORHOOD (seeded)
   Street (+ optional cross street and back alley), lots of varied width
   on both sides, neighbor houses (rect / L / attached garage), sheds,
   fences with gates, hedges, trees, mailboxes, parked cars, staging.
   Neighbor buildings are impassable AND opaque (S.opaque) — they block
   sight and fire, so officers can run behind them for cover.
   ===================================================================== */
function genGeo(r) {
  const SW = r.int(36, 38), sw = r.int(6, 7), ST = SW + 2, SB = ST + sw - 1, SS = SB + 1;
  const alley = r.chance(0.55);
  let cross = null;
  if (r.chance(0.55)) { const left = r.chance(0.5), x0 = left ? r.int(12, 22) : r.int(MAP_W - 28, MAP_W - 18); cross = { x0, x1: x0 + 5 }; }
  const ny0 = alley ? 4 : 1;
  const tw = r.int(36, 42), tx0 = Math.round(MAP_W / 2 - tw / 2) + r.int(-6, 6);
  const lots = [];
  const split = (a, b, side, y0, y1) => { let x = a; while (b - x + 1 >= 20) { let w = r.int(22, 32); if (b - (x + w) + 1 < 18) w = b - x + 1; lots.push({ x0: x, x1: x + w - 1, y0, y1, side }); x += w; }
    if (x <= b && lots.length && lots[lots.length - 1].side === side && lots[lots.length - 1].x1 === x - 1) lots[lots.length - 1].x1 = b; else if (x <= b) lots.push({ x0: x, x1: b, y0, y1, side, tiny: true }); };
  split(1, tx0 - 1, 'n', ny0, SW - 1);
  const target = { x0: tx0, x1: tx0 + tw - 1, y0: ny0, y1: SW - 1, side: 'n', target: true }; lots.push(target);
  split(tx0 + tw, MAP_W - 2, 'n', ny0, SW - 1);
  if (cross) { split(1, cross.x0 - 1, 's', SS + 2, MAP_H - 2); split(cross.x1 + 1, MAP_W - 2, 's', SS + 2, MAP_H - 2); }
  else split(1, MAP_W - 2, 's', SS + 2, MAP_H - 2);
  lots.forEach((l, i) => { l.id = i; l.lawn = r(); });
  S.geo = { SW, ST, SB, SS, streetW: sw, alley, cross, lots, target, name: r.pick(STREETS) + (r.chance(0.5) ? ' Street' : ' Drive') };
  return target;
}
function markRect(q, f) { for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) if (inb(x, y)) f(idx(x, y), x, y); }
function rectFree(q, pad = 0) { for (let y = q.y - pad; y < q.y + q.h + pad; y++) for (let x = q.x - pad; x < q.x + q.w + pad; x++) { if (!inb(x, y)) return false; const c = idx(x, y); if (S.block[c] || S.room[c] >= 0 || S.paved[c]) return false; } return true; }
function solid(q, lbl, opaque) { markRect(q, c => { S.block[c] = 1; S.cov[c] = Math.max(S.cov[c], opaque || lbl === 1 || lbl === 3 || lbl === 9 || lbl === 11 ? 2 : 1); S.covLbl[c] = lbl; if (opaque) S.opaque[c] = 1; }); }
function fenceH(x0, x1, y, gates) { for (let x = x0; x <= x1; x++) { if (gates.some(g => x >= g && x < g + 2)) continue; if (roomAt(x, y) >= 0 || roomAt(x, y - 1) >= 0 || S.paved[idx(x, y)] || S.paved[idx(x, y - 1)]) continue; S.edges.set(ek(x, y - 1, x, y), E_FENCE); } }
function fenceV(x, y0, y1, gates) { for (let y = y0; y <= y1; y++) { if (gates.some(g => y >= g && y < g + 2)) continue; if (S.paved[idx(x, y)] || S.paved[idx(x - 1, y)]) continue; S.edges.set(ek(x - 1, y, x, y), E_FENCE); } }

function genNeighborhood(r) {
  const G = S.geo, H = S.house, W = S.world = { trees: [], hedges: [], sheds: [], mail: [], cars: [], lamps: [], drives: [], walks: [], nb: [], patios: [], boxes: [], added: [] };
  // borders and paving
  for (let x = 0; x < MAP_W; x++) { S.block[idx(x, 0)] = 1; S.block[idx(x, MAP_H - 1)] = 1; }
  for (let y = 0; y < MAP_H; y++) { S.block[idx(0, y)] = 1; S.block[idx(MAP_W - 1, y)] = 1; }
  const pave = (q, k) => markRect(q, c => { if (S.room[c] < 0) S.paved[c] = k; });
  pave({ x: 1, y: G.SW, w: MAP_W - 2, h: 2 }, 2); pave({ x: 1, y: G.ST, w: MAP_W - 2, h: G.streetW }, 1); pave({ x: 1, y: G.SS, w: MAP_W - 2, h: 2 }, 2);
  if (G.cross) { pave({ x: G.cross.x0 - 1, y: G.SS, w: 1, h: MAP_H - G.SS - 1 }, 2); pave({ x: G.cross.x0, y: G.SS, w: 6, h: MAP_H - G.SS - 1 }, 1); pave({ x: G.cross.x1 + 1, y: G.SS, w: 1, h: MAP_H - G.SS - 1 }, 2); }
  if (G.alley) pave({ x: 1, y: 1, w: MAP_W - 2, h: 3 }, 3);
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
  W.drives.forEach(q => pave(q, 4)); W.walks.forEach(q => pave(q, 5)); W.patios.forEach(q => markRect(q, c => { if (S.room[c] < 0 && !S.paved[c]) S.paved[c] = 6; }));
  if (H.dgarage) solid(H.dgarage, 10, true);
  // ---- neighbor houses ----
  for (const L of G.lots) {
    if (L.target || L.x1 - L.x0 < 17) continue;
    const north = L.side === 'n', lw = L.x1 - L.x0 + 1;
    const w = r.int(10, Math.min(18, lw - 10)), h = r.int(8, north ? 12 : 10);
    const setback = north ? r.int(6, 10) : r.int(4, 7);
    const y = north ? L.y1 - setback - h + 1 : L.y0 + setback;
    const hasG = r.chance(0.5) && lw - w >= 17, gl = r.chance(0.5);
    const x = clamp(L.x0 + Math.floor((lw - w - (hasG ? 6 : 0)) / 2) + r.int(-2, 2) + (hasG && gl ? 6 : 0), L.x0 + 3 + (hasG && gl ? 6 : 0), L.x1 - w - 3 - (hasG && !gl ? 6 : 0));
    const parts = [{ x, y, w, h }];
    if (r.chance(0.45)) { const ww = r.int(4, Math.max(4, Math.floor(w / 2))), wh = r.int(3, 4), wx = r.chance(0.5) ? x : x + w - ww; parts.push({ x: wx, y: north ? y - wh : y + h, w: ww, h: wh }); }
    let garage = null; if (hasG) { const gh = Math.min(h, r.int(6, 7)); garage = { x: gl ? x - 6 : x + w, y: north ? y + h - gh : y, w: 6, h: gh }; parts.push(garage); }
    if (!parts.every(q => q.y >= L.y0 + 1 && q.y + q.h <= L.y1 && q.x >= L.x0 + 2 && q.x + q.w <= L.x1 - 1 && rectFree(q, 1))) continue;
    const nb = { lot: L.id, parts, garage, north, roof: r.int(0, 5), body: r.int(0, 4), storeys: r.chance(0.5) ? 2 : 1 };
    parts.forEach(q => solid(q, 5, true));
    // driveway
    const dq = garage ? { x: garage.x, w: 6 } : { x: r.chance(0.5) ? Math.max(L.x0 + 1, x - 4) : Math.min(L.x1 - 3, x + w + 1), w: 3 };
    const drive = north ? { x: dq.x, y: garage ? garage.y + garage.h : y + h - 4, w: dq.w, h: 0 } : { x: dq.x, y: G.SS + 2, w: dq.w, h: 0 };
    drive.h = north ? G.SW - drive.y : (garage ? garage.y : y + 4) - drive.y;
    if (drive.h > 0 && drive.x >= L.x0 && drive.x + drive.w <= L.x1 + 1) { pave(drive, 4); W.drives.push(drive); nb.drive = drive;
      if (r.chance(0.6)) { const cq = { x: drive.x + Math.floor((drive.w - 2) / 2), y: north ? G.SW - 5 : G.SS + 3, w: 2, h: 4 }; if (rectFree(cq) || true) { W.cars.push({ x: cq.x, y: cq.y, w: 2, h: 4, vert: true, color: r.int(0, 5) }); } } }
    const door = { x: x + r.int(2, w - 3), y: north ? y + h : y - 1 };
    const walk = north ? { x: door.x, y: door.y, w: 1, h: G.SW - door.y } : { x: door.x, y: G.SS + 2, w: 1, h: door.y - G.SS - 1 };
    pave(walk, 5); W.walks.push(walk);
    W.nb.push(nb);
  }
  // parked cars in driveways: make them solid now (paving is laid)
  for (const c of W.cars) solid(c, 3, false);
  // ---- fences: lot lines (backyard part) + back fence + side fences to the house ----
  const lotsN = G.lots.filter(l => l.side === 'n'), lotsS = G.lots.filter(l => l.side === 's');
  const backOf = (L) => { const nb = W.nb.find(n => n.lot === L.id); if (L.target) return { y0: H.y0, y1: H.y1, x0: H.x0, x1: H.x1 }; if (!nb) return null;
    const ys = nb.parts.map(q => [q.y, q.y + q.h - 1]).flat(), xs = nb.parts.map(q => [q.x, q.x + q.w - 1]).flat(); return { y0: Math.min(...ys), y1: Math.max(...ys), x0: Math.min(...xs), x1: Math.max(...xs) }; };
  for (let i = 1; i < lotsN.length; i++) { const L = lotsN[i], P = lotsN[i - 1]; const a = backOf(L), b = backOf(P); const yEnd = Math.min(a ? a.y1 - 2 : L.y1 - 10, b ? b.y1 - 2 : L.y1 - 10);
    if (r.chance(0.85)) fenceV(L.x0, L.y0, yEnd, [r.int(L.y0 + 1, Math.max(L.y0 + 1, yEnd - 3))]); }
  for (let i = 1; i < lotsS.length; i++) { const L = lotsS[i], P = lotsS[i - 1]; if (P.x1 + 1 !== L.x0) continue; const a = backOf(L), b = backOf(P); const yS = Math.max(a ? a.y0 + 2 : L.y0 + 8, b ? b.y0 + 2 : L.y0 + 8);
    if (r.chance(0.8)) fenceV(L.x0, yS, L.y1, [r.int(yS + 1, Math.max(yS + 1, L.y1 - 3))]); }
  if (G.alley) for (const L of lotsN) if (r.chance(0.8)) fenceH(L.x0, L.x1, L.y0, [r.int(L.x0 + 2, L.x1 - 4)]);
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
  for (const L of G.lots) { const d = W.drives.find(q => q.x >= L.x0 && q.x <= L.x1) ; const x = d ? (d.x + d.w < L.x1 ? d.x + d.w : d.x - 1) : L.x0 + 3; const y = L.side === 'n' ? G.SW - 1 : G.SS + 2;
    const q = { x, y, w: 1, h: 1 }; if (rectFree(q)) { solid(q, 6, false); W.mail.push({ x, y }); } }
  // ---- street lamps ----
  for (let x = 6; x < MAP_W - 4; x += r.int(20, 26)) { for (const y of [G.SW, G.SS + 1]) { if (!S.block[idx(x, y)]) { S.block[idx(x, y)] = 1; W.lamps.push({ x, y }); } } }
  // ---- SWAT truck + staging (out of the suspect's likely range) ----
  const hcx = (H.x0 + H.x1) / 2, far = r.chance(0.5) ? -1 : 1;
  let vx = Math.round(hcx + far * r.int(32, 38)); if (vx < 3 || vx > MAP_W - 10) vx = Math.round(hcx - far * r.int(32, 38));
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
  for (const nb of W.nb) for (const q of nb.parts) markRect(q, (c, x, y) => { if (S.room[c] >= 0) errs.push('neighbor overlaps target house'); if (y >= G.SW && y < G.SS + 2) errs.push('neighbor on street'); });
  for (const s of W.sheds) markRect(s, c => { if (S.room[c] >= 0) errs.push('shed overlaps house'); });
  const D = reach(W.staging.x, W.staging.y, { outdoor: true }, 1e6);
  const need = [[H.x0 - 2, H.y0 - 2, 'rear-left'], [H.x1 + 2, H.y0 - 2, 'rear-right'], [H.x0 - 2, H.y1 + 2, 'front-left'], [H.x1 + 2, H.y1 + 2, 'front-right']];
  for (const [x, y, n] of need) { let ok = false; for (let dy = -2; dy <= 2 && !ok; dy++) for (let dx = -2; dx <= 2; dx++) if (inb(x + dx, y + dy) && D[idx(x + dx, y + dy)] < 1e9) { ok = true; break; } if (!ok) errs.push('cannot reach ' + n + ' of house'); }
  for (const d of S.doors.filter(q => q.exterior)) { const o = d.cells[0].find(c => roomAt(c[0], c[1]) < 0); if (o && D[idx(o[0], o[1])] >= 1e9) errs.push('exterior door unreachable: ' + d.name); }
  for (const nb of W.nb) { const q = nb.parts[0]; let ok = false; for (let x = q.x - 2; x <= q.x + q.w + 1 && !ok; x++) for (const y of [q.y - 2, q.y - 1]) if (inb(x, y) && D[idx(x, y)] < 1e9) { ok = true; break; } if (!ok && nb.north) errs.push('no route behind a neighbor house'); }
  let dr = 0; for (let c = 0; c < S.drive.length; c++) dr += S.drive[c]; if (dr < 600) errs.push('drive area too small');
  if (!S.drive[idx(Math.round((H.x0 + H.x1) / 2), G.ST + 3)]) errs.push('street in front not drivable');
  return errs;
}

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

/* =====================================================================
   SNIPER OVERWATCH
   Perches are pre-computed per neighbor house: the edge cell of the house
   body (upper window on 2-storey houses, roof line on 1-storey) with the
   most clear sight lines to the target house's windows/doors. A sniper
   team walks to the perch's entry cell (lowest-exposure side), takes one
   tick to get inside and set up, then sits in hard cover/concealment.
   Yard vantage points (any outdoor cell with a sight line) also work.
   ===================================================================== */
function compass(dx, dy) { const a = Math.atan2(dy, dx) * 180 / Math.PI; const n = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']; return n[((Math.round(a / 45) % 8) + 8) % 8]; }
function genPerches() {
  S.perches = []; const [hx, hy] = houseCenter(); const R = WEAPONS.sniper.range;
  const tp = threatPoints();
  S.ext.nb.forEach((nb, i) => {
    const body = nb.parts.filter(q => q !== nb.garage), inBody = (x, y) => body.some(q => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
    let best = null, bs = 0;
    for (const q of body) for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) {
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inBody(x + dx, y + dy))) continue;
      let s = 0; for (const t of tp) { const d = dist(x, y, t.x, t.y); if (d <= R && d >= 8 && los(x, y, t.x, t.y)) s += 1 - d / (R * 1.5); }
      if (s > bs) { bs = s; best = [x, y]; } }
    if (!best) return;
    // entry: an outdoor cell beside the house body, preferring low exposure and short walk
    let entry = null, es = 1e9;
    for (const q of body) for (let y = q.y - 1; y <= q.y + q.h; y++) for (let x = q.x - 1; x <= q.x + q.w; x++) {
      if (inBody(x, y) || !cellOk(x, y, { outdoor: true }) || S.dyn[idx(x, y)]) continue;
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inBody(x + dx, y + dy))) continue;
      const s = expoAt(x, y) * 4 + dist(x, y, best[0], best[1]) * 0.15; if (s < es) { es = s; entry = [x, y]; } }
    if (!entry) return;
    const cx = body[0].x + body[0].w / 2, cy = body[0].y + body[0].h / 2;
    const where = (nb.north === (hy < S.geo.ST)) ? '' : ' across the street';
    S.perches.push({ id: S.perches.length, nb: i, x: best[0], y: best[1], entry, kind: nb.storeys === 2 ? 'upper-floor window' : 'rooftop', sightLines: Math.round(bs * 10) / 10,
      name: `Neighbor house ${compass(cx - hx, cy - hy)}${where}` });
  });
}
function perchAt(x, y) { return S.perches.find(p => { const nb = S.ext.nb[p.nb]; return nb.parts.some(q => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h); }) || null; }
/** The sniper's spotter (best available team-mate) and its bonus. */
function spotterOf(u) {
  if (!u || u.kind !== 'team' || !hasSpec(u, 'marksman')) return null;
  const ok = teamOk(u), shooter = ok.find(o => o.spec === 'marksman'), others = ok.filter(o => o !== shooter);
  const q = others.find(o => o.quals && o.quals.includes('spotter'));
  if (q) return { o: q, name: q.name, q: true, mult: 1.45, label: 'qualified Sniper Spotter' };
  if (others.length) return { o: others[0], name: others[0].name, q: false, mult: 1.2, label: 'untrained spotter' };
  return null;
}
function overwatchSees(x, y) { let n = 0; for (const t of threatPoints()) { const d = dist(x, y, t.x, t.y); if (d <= WEAPONS.sniper.range && los(x, y, t.x, t.y)) n++; } return n; }
function owCone(u) { if (!u.perch) return null; const vp = visParams(u); return { x: u.x, y: u.y, dir: u.dir, half: vp.half, range: vp.range }; }
/* ===================== CS GAS — concentration field (turn-driven) ===================== */
// S.gas: Float32Array per cell, 0..~1.2. Spreads between turns (gasTurn) through open edges,
// weakly through closed interior doors, leaks outside through broken windows / open exterior doors,
// then drifts downwind and thins. S.gasSeen: what the player last saw (fog of war).
const GAS_K = { room: 0.45, open: 0.4, closedIn: 0.012, closedExt: 0.004, broken: 0.3, out: 0.35 };
function gasAt(x, y) { return inb(x, y) ? S.gas[idx(x, y)] : 0; }
function gasCond(ax, ay, bx, by) {
  const ra = roomAt(ax, ay), rb = roomAt(bx, by);
  if (ra < 0 && rb < 0) { const cb = idx(bx, by); return S.block[cb] && S.opaque[cb] ? 0 : GAS_K.out; }
  const e = edge(ax, ay, bx, by);
  if (e.t === 'O') return ra === rb ? GAS_K.room : GAS_K.open;
  if (e.t === 'D') { if (e.d.state !== 'closed') return GAS_K.open; return e.d.exterior ? GAS_K.closedExt : GAS_K.closedIn; }
  if (e.t === 'W') return e.w.broken ? GAS_K.broken : 0;
  if (e.t === 'F') return GAS_K.out;
  return 0;
}
/** One turn of spread + decay. Pure function of the grid (deterministic). */
function gasTurn(sub = 6) {
  if (!S.gasActive) return;
  const N = MAP_W * MAP_H, g = S.gas, d = new Float32Array(N); const wx = S.wind.dx, wy = S.wind.dy;
  let any = false;
  for (let it = 0; it < sub; it++) {
    d.fill(0);
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) { const c = idx(x, y), v = g[c]; if (v < 0.002) continue;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) { const nx = x + dx, ny = y + dy; if (!inb(nx, ny)) continue; const n = idx(nx, ny);
        if (g[n] >= v && !(S.room[c] < 0 && dx === wx && dy === wy)) continue;
        let k = gasCond(x, y, nx, ny); if (!k) continue;
        let f = k * (v - g[n]) / 2;
        if (S.room[c] < 0 && S.room[n] < 0 && dx === wx && dy === wy) f += v * 0.12; // wind drift outside
        if (f > 0) { d[c] -= f; d[n] += f; } } }
    for (let c = 0; c < N; c++) { let v = g[c] + d[c]; v *= S.room[c] >= 0 ? 0.99 : 0.85; g[c] = v < 0.003 ? 0 : v; if (g[c]) any = true; }
  }
  S.gasActive = any;
  S.rooms.forEach(q => { let s = 0, n = 0; for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) if (S.room[idx(x, y)] === q.id) { s += g[idx(x, y)]; n++; } q.gas = n ? s / n : 0; });
}
function gasDeploy(roomId, amt = 1.1) {
  const q = S.rooms[roomId];
  for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) { const c = idx(x, y); if (S.room[c] === roomId) { S.gas[c] = Math.max(S.gas[c], amt); S.gasSeen[c] = S.gas[c]; } }
  q.gas = amt; S.gasActive = true; S.gasEver = true;
}
/** Player-side memory: visible cells update, others keep the last seen value (fading). */
function gasObserve() {
  const vis = S.vis; const N = MAP_W * MAP_H;
  for (let c = 0; c < N; c++) { if (vis[c]) S.gasSeen[c] = S.gas[c]; else if (S.gasSeen[c]) S.gasSeen[c] *= 0.995; }
}
/* ---------- masks & impairment ---------- */
const MASK = { vis: 0.85, acc: 0.9 };
function masked(u) { return u.kind === 'team' && u.mask === 'on'; }
function donMasks(reason) { // all deployed SWAT teams don masks; takes effect this turn (one tick)
  for (const t of S.units) if (t.kind === 'team' && unitAlive(t) && t.mask !== 'on' && t.mask !== 'donning') { t.mask = 'donning'; t.maskTick = 1; log(`${t.name}: "Gas! Masks on!"${reason ? ' — ' + reason : ''}`, 'radio'); }
}
/** Called each tick per unit: impairment from the gas at its cell. */
function gasExpose(u) {
  if (!onFoot(u) && u.kind !== 'team') return;
  const g = gasAt(u.x, u.y); let target = g < 0.04 ? 0 : clamp(g * 1.3, 0, 1);
  if (masked(u)) target *= 0.08; else if (u.kind === 'team' && u.mask === 'donning') target *= 0.5;
  const before = u.impair || 0; u.impair = Math.max(target, before * 0.6); if (u.impair < 0.03) u.impair = 0;
  if (u.impair >= 0.3 && before < 0.3) { log(`${u.name}: coughing — impaired by CS gas${u.kind === 'team' ? ' (no mask)' : ''}.`, 'alert'); fx('text', u.x, u.y, { text: 'COUGHING', color: '#cfe8b0' }); }
  if (u.kind === 'team' && g >= 0.15 && u.mask !== 'on' && u.mask !== 'donning') { u.mask = 'donning'; u.maskTick = 1; log(`${u.name}: in gas without masks — donning now!`, 'alert'); }
  if (u.kind === 'patrol' && u.impair >= 0.35 && !u.retreating) { u.panic = Math.min(1, (u.panic || 0) + 0.3); u.retreating = true; gasRetreat(u); }
  if (u.kind === 'patrol' && u.impair < 0.1) u.retreating = false;
}
/** Patrol without masks fall back upwind / away from the plume, preferring cover. */
function gasRetreat(u) {
  const D = reach(u.x, u.y, Object.assign({}, moveOpts(u), { outdoor: true }), 14);
  let best = null, bs = 1e9;
  for (let c = 0; c < D.length; c++) { const cost = D[c]; if (cost >= 1e9) continue; const x = c % MAP_W, y = (c / MAP_W) | 0; const s = gasAt(x, y) * 40 + expoAt(x, y) * 8 + cost * 0.3 - (x - u.x) * S.wind.dx * 0.4 - (y - u.y) * S.wind.dy * 0.4; if (s < bs) { bs = s; best = [x, y]; } }
  if (best && (best[0] !== u.x || best[1] !== u.y)) { u.orders = [{ type: 'move', x: best[0], y: best[1], auto: 'gas' }]; log(`${u.name}: falling back out of the gas.`, 'alert'); }
}
/** Effect multipliers used by vision, accuracy and movement. */
function impairAcc(u) { return (1 - 0.6 * (u.impair || 0)) * (masked(u) ? MASK.acc : 1); }
function impairVis(u) { return (1 - 0.4 * (u.impair || 0)) * (masked(u) ? MASK.vis : 1); }
/* ---------- suspect ---------- */
function suspectGas() { // per tick
  const sp = S.suspect; const g = gasAt(sp.x, sp.y);
  if (sp.hasMask && !sp.maskOn && g > 0.08 && hostile()) { if (!sp.maskDon) { sp.maskDon = 2; } else if (--sp.maskDon <= 0) sp.maskOn = true; }
  const t = sp.maskOn ? g * 0.05 : clamp(g * 1.3, 0, 1); sp.impair = Math.max(t, (sp.impair || 0) * 0.6); if (sp.impair < 0.03) sp.impair = 0;
  if (sp.maskOn && sp.visible && !sp.maskSeen) { sp.maskSeen = true; log('Suspect is wearing a gas mask!', 'alert'); fx('text', sp.x, sp.y, { text: 'GAS MASK', color: '#ffb020' }); }
}
function suspectGasTurn() { // per turn: may relocate to clean air, run, or give up
  const sp = S.suspect; if (!hostile() || sp.maskOn || sp.mode === 'fleeing') return; const g = gasAt(sp.x, sp.y); if (g < 0.08) return;
  if (S.rng.chance(clamp(0.05 + 0.25 * g, 0, 0.4))) { surrender('Suspect is coughing and shouting that he gives up!'); return; }
  const pMove = clamp(0.2 + 0.7 * g, 0, 0.9); if (!S.rng.chance(pMove)) return;
  // gas-free room vs exit
  if (S.rng.chance(0.35 + 0.3 * g)) { startFlee(); if (sp.mode === 'fleeing') return; }
  let best = null, bs = 1e9; for (const q of S.rooms) { if (q.id === sp.room || q.type === 'hall' && S.rng.chance(0.5)) continue; const c = [q.x + (q.w >> 1), q.y + (q.h >> 1)]; if (S.room[idx(c[0], c[1])] !== q.id) continue;
    const s = q.gas * 10 + dist(sp.x, sp.y, c[0], c[1]) * 0.05; if (s < bs) { bs = s; best = c; } }
  if (best && gasAt(best[0], best[1]) < g * 0.6) { sp.home = { x: best[0], y: best[1] }; sp.mode = sp.mode === 'barricaded' ? 'alert' : sp.mode; log('Movement inside — someone is relocating away from the gas.', 'alert'); }
}
/* ===================== BREACHING ===================== */
// Methods: explosive charge (hang → stand off → detonate), ram, Halligan pry, kick.
// Per-attempt success p; barricades (suspect-reinforced) cut it; storm doors add a layer.
const CHARGE_SAFE = 3; // cells: closer than this at detonation → dazed
const BREACH = {
  charge: { name: 'Explosive charge', eq: 'charge', p: 0.97, barr: 0.92, storm: 1.0, setup: 1, every: 1, noise: 18, label: 'very loud' },
  ram:    { name: 'Ram',              eq: 'ram',    p: 0.5,  barr: 0.5,  storm: 0.8, setup: 0, every: 1, noise: 9,  label: 'loud' },
  pry:    { name: 'Halligan pry',     eq: 'halligan', p: 0.55, barr: 0.3, storm: 0.55, setup: 0, every: 2, noise: 5, label: 'moderate' },
  kick:   { name: 'Kick',             eq: null,     p: 0.25, barr: 0.2,  storm: 0.4, setup: 0, every: 1, noise: 7,  label: 'loud' },
};
function breachMethods(u) { return Object.keys(BREACH).filter(k => breachCan(u, k) === true); }
function breachCan(u, m) { const B = BREACH[m]; if (!B) return 'Unknown method';
  if (B.eq && !(u.equip && u.equip[B.eq] > 0)) return `Needs a ${EQUIP[B.eq].name}`;
  if (m === 'charge' && !hasSpec(u, 'breacher')) return 'Only a Breacher can hang a charge';
  return true; }
function breachP(u, d, m, layer) { const B = BREACH[m]; let p = layer === 'storm' ? B.storm : B.p;
  if (layer !== 'storm' && d.barricaded) p *= B.barr;
  if (layer !== 'storm' && d.kind === 'garage' && m !== 'charge') p *= 0.35;
  if (m !== 'charge' && hasSpec(u, 'breacher')) p = Math.min(0.95, p + 0.15);
  if ((u.impair || 0) > 0) p *= 1 - 0.4 * u.impair;
  return clamp(p, 0.02, 0.98); }
function defaultMethod(u, d) { const ms = breachMethods(u); if (d.barricaded || d.kind === 'garage') { for (const m of ['charge', 'ram', 'pry', 'kick']) if (ms.includes(m)) return m; }
  for (const m of ['ram', 'charge', 'pry', 'kick']) if (ms.includes(m)) return m; return 'kick'; }
/** Expected ticks / per-attempt success / noise for the order UI tooltip. Uses only what the player knows. */
function breachEst(u, d, m) {
  const ok = breachCan(u, m); const B = BREACH[m]; const knownD = { barricaded: d.barricaded && d.barrKnown, kind: d.kind };
  const stormK = d.storm && d.stormKnown && d.stormState === 'closed';
  const pMain = breachP(u, Object.assign({}, d, knownD), m, 'main'), pStorm = stormK ? breachP(u, d, m, 'storm') : 1;
  let ticks;
  if (m === 'charge') ticks = 1 /*hang*/ + 2 /*stand off*/ + 1 /*detonate*/;
  else ticks = B.every * (1 / pMain) + (stormK ? B.every * (1 / pStorm) : 0);
  return { method: m, name: B.name, ok, ticks: Math.round(ticks * 10) / 10, p: +pMain.toFixed(2), storm: stormK, pStorm: +pStorm.toFixed(2), noise: B.label,
    text: `${B.name}: ~${Math.round(ticks * 10) / 10} ticks, ${Math.round(pMain * 100)}% per attempt${stormK ? ` (+storm door ${Math.round(pStorm * 100)}%)` : ''}, ${B.label}` };
}
function doorMid(d) { const c = d.cells[Math.floor(d.cells.length / 2)]; return [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2]; }
/** Standoff cell for a charge: ≥CHARGE_SAFE away, prefer out of the door's line and low exposure. */
function standoffGoal(u, d) { const [mx, my] = doorMid(d);
  const D = reach(u.x, u.y, Object.assign({}, moveOpts(u), { outdoor: roomAt(u.x, u.y) < 0 }), 12); let best = null, bs = 1e9;
  for (let c = 0; c < D.length; c++) { if (D[c] >= 1e9) continue; const x = c % MAP_W, y = (c / MAP_W) | 0; const dd = dist(x, y, mx, my); if (dd < CHARGE_SAFE + 0.6 || dd > 7) continue;
    const s = D[c] + (los(x, y, Math.round(mx), Math.round(my)) ? 3 : 0) + (roomAt(x, y) < 0 ? expoAt(x, y) * 6 : 0); if (s < bs) { bs = s; best = [x, y]; } }
  return best; }
/** Executes one tick of a breach / hang / detonate order. Returns nothing; pops the order when done. */
function breachTick(u, o, d, other) {
  const m = o.method || (o.method = defaultMethod(u, d)); const B = BREACH[m];
  if (o.type === 'detonate') return;
  if (m === 'charge') {
    if (!d.charge) { if (!(u.equip.charge > 0)) { failOrders(u, 'no charge left'); return; }
      u.equip.charge--; d.charge = { by: u.uid, turn: S.turn }; if (d.storm) d.stormKnown = true;
      log(`${u.name}: charge hung on ${d.name}${d.storm && d.stormState === 'closed' ? ' (storm door included)' : ''}.`, 'radio'); fx('text', other[0], other[1], { text: 'CHARGE SET', color: '#ffb020' });
      if (o.hangOnly) o.phase = 'standoff'; return; } // hang-only: back off to the standoff point, then wait for Detonate
    o.phase = 'standoff'; return; // standoff + detonate handled by unitAct (needs pathing)
  }
  // manual: storm layer first
  if (d.storm && d.stormState === 'closed') { d.stormKnown = true;
    if (B.every > 1 && !(o.set = !o.set)) { log(`${u.name}: setting the Halligan on the storm door…`); return; }
    if (S.rng.chance(breachP(u, d, m, 'storm'))) { d.stormState = 'breached'; log(`${u.name}: storm door on ${d.name} defeated (${B.name.toLowerCase()}).`, 'radio'); fx('thud', other[0], other[1]); noise(other[0], other[1], B.noise - 2, 'door'); }
    else { log(`${u.name}: ${B.name.toLowerCase()} on the storm door — still holding.`); noise(other[0], other[1], B.noise, 'ram'); fx('thud', other[0], other[1]); }
    return; }
  if (B.every > 1 && !(o.set = !o.set)) { log(`${u.name}: setting the Halligan on ${d.name}…`); return; }
  if (S.rng.chance(breachP(u, d, m, 'main'))) { doBreach(u, d, m); popOrder(u); }
  else { if (d.barricaded) d.barrKnown = true; log(`${u.name}: ${B.name.toLowerCase()} on ${d.name} — no give${d.barricaded ? ' (it\'s barricaded!)' : ''}.`); noise(other[0], other[1], B.noise, 'ram'); fx('thud', other[0], other[1]); }
}
function detonateCharge(u, d) {
  const [mx, my] = doorMid(d); const by = unit(d.charge.by) || u; d.charge = null;
  fx('blast', mx, my, { r: CHARGE_SAFE + 2 }); noise(mx, my, 60, 'blast'); // an explosive breach is heard house-wide
  if (S.rng.chance(d.barricaded ? BREACH.charge.barr : BREACH.charge.p)) { if (d.storm) d.stormState = 'breached'; doBreach(by, d, 'charge'); }
  else { log(`${by.name}: charge on ${d.name} fired but the door held — needs another breach.`, 'alert'); noise(mx, my, 18, 'breach'); d.barrKnown = d.barricaded; if (d.storm) d.stormState = 'breached'; }
  for (const q of S.units) { if (!onFoot(q) && q.kind !== 'team') continue; if (!unitAlive(q) || q.inCar) continue;
    const dd = dist(q.x, q.y, mx, my); if (dd < CHARGE_SAFE && los(q.x, q.y, Math.round(mx), Math.round(my))) { q.stun = 2; q.impair = Math.max(q.impair || 0, 0.5); log(`${q.name}: too close to the blast — dazed.`, 'alert'); fx('text', q.x, q.y, { text: 'DAZED', color: '#ffd080' }); } }
  const sp = S.suspect; if (hostile()) { sp.agit = clamp(sp.agit + 15, 0, 100); if (dist(sp.x, sp.y, mx, my) < 4) { sp.stun = Math.max(sp.stun, 2); log('Suspect stunned by the blast.', 'good'); } }
}

/* =====================================================================
   CASUALTIES — injury severity, critical countdown, aid / rescue / evacuation.
   Rules only (no drawing). Neutral wording: critical, immobile, evacuated.
   Applies to patrol, cruiser drivers, SWAT officers, the suspect and (generic) civilians.
   ===================================================================== */
/* ================== TUNABLE: CASUALTY CONFIG ================== */
const CAS_CFG = {
  kia: 0.10,              // a hit person does not survive (memorial marker)
  mobile: 0.40,           // injured but mobile: moves to cover next turn, then walks to EMS; the rest are immobile
  critMobile: [8, 12],    // turns until critical without aid (mobile)
  critImmobile: [3, 6],   // turns until critical without aid (immobile)
  severe: 0.55,           // share of immobile injuries that are severe (sev 3)
  medicSevere: 6,         // medic + medkit on a severe casualty: +turns (still needs EMS)
  medicNoKit: 3,          // medic without a medkit: +turns
  aidOther: 2,            // first aid by any other officer: +turns (once per casualty)
  transport: 2,           // turns from the EMS point to hospital
  carryTeam: 2,           // cells/tick carrying outdoors (team); always 1 indoors
  carryPatrol: 1,         // a single patrol officer dragging a casualty
  carryShield: 0.6,       // hit-chance multiplier for a carrying team with a ballistic shield
  secureSave: 2,          // scene secured: casualties with >= this many turns left reach EMS in time
  suspectKia: 0.08, suspectMobile: 0.28, // suspect hit outcomes (rest immobile = incapacitated)
  emsMinDist: 14,         // EMS point must be at least this far from the house centre
};
/* ============================================================== */
function casById(id) { return (S.cas || []).find(c => c.id === id); }
function casActive(c) { return c && (c.state === 'mobile' || c.state === 'immobile'); }
function casCell(x, y, outdoorFirst) {
  const ok = (xx, yy) => inb(xx, yy) && !S.block[idx(xx, yy)] && !S.dyn[idx(xx, yy)] && !(outdoorFirst && S.room[idx(xx, yy)] >= 0);
  if (ok(x, y)) return [x, y];
  for (let r = 1; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (ok(x + dx, y + dy)) return [x + dx, y + dy];
  return [x, y];
}
/** Roll an injury and create a casualty record. who: 'officer' | 'patrol' | 'suspect' | 'civilian'. */
function addCasualty(who, ref, name, x, y, o = {}) {
  const r = S.rng, cfg = CAS_CFG; const kiaP = o.kia !== undefined ? o.kia : cfg.kia, mobP = o.mobile !== undefined ? o.mobile : cfg.mobile;
  const roll = r(); let state, sev, crit;
  if (roll < kiaP) { state = 'kia'; sev = 3; crit = 0; }
  else if (roll < kiaP + mobP) { state = 'mobile'; sev = r.chance(0.7) ? 1 : 2; crit = r.int(cfg.critMobile[0], cfg.critMobile[1]); }
  else { state = 'immobile'; sev = r.chance(cfg.severe) ? 3 : 2; crit = r.int(cfg.critImmobile[0], cfg.critImmobile[1]) - (sev === 3 ? 1 : 0); }
  const [cx, cy] = casCell(x, y, roomAt(x, y) < 0);
  const c = { id: 'X' + (++S.casSeq), who, ref, name, x: cx, y: cy, sev, state, crit, crit0: crit, stable: false, aided: 0, carrier: null, tr: 0, turn: S.turn, wait: true,
    goal: null, team: o.team || null, reported: who !== 'suspect' && (sev < 3 || !!o.witness), seen: false, known: false, by: o.by || null };
  S.cas.push(c);
  if (state === 'kia') { S.stats.kia++; c.known = who !== 'suspect'; }
  casKnow(c); return c;
}
/** Fog of war: own people are known by radio report (or a witness); otherwise only by vision. */
function casKnow(c) { const v = S.vis && S.vis[idx(c.x, c.y)]; if (v) c.seen = true; c.known = c.reported || !!v || c.seen && c.who !== 'suspect' || c.state === 'transport' || c.state === 'evacuated'; return c.known; }
function sevWord(c) { return c.state === 'kia' ? 'killed in action' : c.state === 'lost' ? 'did not survive' : c.state === 'evacuated' ? 'evacuated' : c.state === 'transport' ? 'in EMS transport' : c.stable ? 'stable' : c.sev === 3 ? 'critical' : c.sev === 2 ? 'serious' : 'injured'; }
function casLabel(c) { return c.state === 'mobile' ? 'mobile' : c.state === 'immobile' ? 'immobile' : sevWord(c); }
/** Report text for a fresh casualty (neutral wording). */
function casReport(c, ctx) {
  if (c.state === 'kia') return `${c.name}${ctx ? ' (' + ctx + ')' : ''} is hit — killed in action.`;
  if (c.state === 'mobile') return `${c.name}${ctx ? ' (' + ctx + ')' : ''} is hit — injured but mobile, moving to cover. Critical: ${tDur(c.crit)}.`;
  if (!c.reported) return `${c.name}${ctx ? ' (' + ctx + ')' : ''} is hit — no radio response. Status unknown.`;
  return `${c.name}${ctx ? ' (' + ctx + ')' : ''} is hit — immobile, needs rescue. Critical: ${tDur(c.crit)}.`;
}
function casTail(c) { return c.state === 'kia' ? 'Killed in action.' : c.state === 'mobile' ? `Injured but mobile. Critical: ${tDur(c.crit)}.` : c.reported ? `Immobile — needs rescue. Critical: ${tDur(c.crit)}.` : 'No radio contact — status unknown.'; }
/** Default EMS staging point: low-exposure outdoor cell near the SWAT truck. */
function defaultEMS() {
  const st = S.ext.staging; let best = null, bs = 1e9; const [hx, hy] = houseCenter();
  for (let dy = -6; dy <= 6; dy++) for (let dx = -8; dx <= 8; dx++) { const x = st.x + dx, y = st.y + dy; if (!cellOk(x, y, { outdoor: true })) continue; if (dist(x, y, hx, hy) < CAS_CFG.emsMinDist) continue;
    const s = expoAt(x, y) * 10 + Math.abs(dx - 4) * 0.3 + Math.abs(dy) * 0.3; if (s < bs) { bs = s; best = [x, y]; } }
  return best ? { x: best[0], y: best[1], custom: false } : { x: st.x, y: st.y, custom: false };
}
function emsCheck(x, y) { const [hx, hy] = houseCenter();
  if (!cellOk(x, y, { outdoor: true })) return 'EMS needs open ground outside (not a building, fence or car)';
  if (dist(x, y, hx, hy) < CAS_CFG.emsMinDist) return `Too close to the house — EMS stages at least ${CAS_CFG.emsMinDist} m out`;
  if (expoAt(x, y) >= 0.15) return 'That spot is in a line of fire from the house';
  return null; }
function setEMS(x, y) { if (S.phase !== 'planning') return { ok: false, reason: 'Wait for the orders to resolve' }; const q = emsCheck(x, y); if (q) return { ok: false, reason: q };
  S.ems = { x, y, custom: true }; log(`EMS staging point set — ambulance moving up.`, 'system'); S.version++; return { ok: true }; }
/** Casualty collection point: nearest low-exposure outdoor cell from a position. */
function ccpFor(x, y) {
  const mo = { canOpen: true, avoidSuspect: true, expo: true }; const D = reach(x, y, mo, 40); let best = null, bs = 1e9; const [hx, hy] = houseCenter();
  for (let yy = Math.max(1, y - 18); yy <= Math.min(MAP_H - 2, y + 18); yy++) for (let xx = Math.max(1, x - 18); xx <= Math.min(MAP_W - 2, x + 18); xx++) {
    const c = idx(xx, yy); if (D[c] >= 1e9 || S.room[c] >= 0 || S.expo[c] >= 0.12 || S.dyn[c]) continue;
    const s = D[c] * 0.25 + S.expo[c] * 10 - (coverAdj(xx, yy) ? 0.8 : 0) - Math.min(dist(xx, yy, hx, hy), 16) * 0.05; if (s < bs) { bs = s; best = [xx, yy]; } }
  return best; }
function carrierOpts(u) { return u.kind === 'patrol' ? { outdoor: true, canOpen: false, avoidSuspect: true, expo: true } : { canOpen: true, avoidSuspect: true, expo: true }; }
function adjGoal(c) { return (x, y) => cheb(x, y, c.x, c.y) <= 1; }
/** planOrder branch for aid / rescue / evac (preview + validation). */
function planCas(u, o, sx, sy, assume) {
  const c = casById(o.cas); if (!c || !casActive(c)) return { ok: false, reason: 'No casualty there needing help' };
  if (!c.known) return { ok: false, reason: 'Status unknown — get eyes on that position first' };
  if (u.kind === 'patrol' && roomAt(c.x, c.y) >= 0) return { ok: false, reason: 'Patrol does not enter the house — send a SWAT team' };
  if (c.carrier && c.carrier !== u.uid) return { ok: false, reason: 'Already being moved' };
  if (o.type === 'evac' && c.state === 'transport') return { ok: false, reason: 'Already with EMS' };
  const mo = Object.assign(carrierOpts(u), { assume }); const g = adjGoal(c);
  const p = g(sx, sy) ? [] : findPath(sx, sy, g, mo); if (!p) return { ok: false, reason: 'Cannot reach the casualty' };
  const at = p.length ? p[p.length - 1] : [sx, sy];
  if (o.type === 'aid') return { ok: true, path: p, end: at };
  let dest; if (o.type === 'evac') dest = [S.ems.x, S.ems.y]; else { dest = ccpFor(c.x, c.y); if (!dest) return { ok: false, reason: 'No covered collection point in reach' }; o.dx = dest[0]; o.dy = dest[1]; }
  const p2 = findPath(c.x, c.y, (x, y) => cheb(x, y, dest[0], dest[1]) <= (o.type === 'evac' ? 1 : 0), Object.assign(carrierOpts(u), { assume }));
  if (!p2) return { ok: false, reason: o.type === 'evac' ? 'No route to the EMS point' : 'No route to cover' };
  return { ok: true, path: p.concat([[c.x, c.y]], p2), end: p2.length ? p2[p2.length - 1] : [c.x, c.y], carry: p2.length };
}
/** First aid / stabilise. Medic with a medkit = full effect; others extend the countdown. */
function applyAid(u, c, auto) {
  if (!casActive(c)) return false; const cfg = CAS_CFG; const medic = u.kind === 'team' && hasSpec(u, 'medic'); let t;
  if (medic && u.equip.medkit > 0) { u.equip.medkit--; if (c.sev >= 3) { c.crit += cfg.medicSevere; c.aided = 2; t = `medic treats ${c.name} — severe, +${tDur(cfg.medicSevere)}; needs EMS.`; }
    else { c.stable = true; c.aided = 2; t = `medic stabilises ${c.name} — countdown stopped.`; } }
  else if (medic) { if (c.aided >= 1) return false; c.crit += cfg.medicNoKit; c.aided = 1; t = `medic (no medkit) packs ${c.name}'s injury — +${tDur(cfg.medicNoKit)}.`; }
  else { if (c.aided >= 1) { if (!auto) log(`${u.name}: ${c.name} already has first aid — needs a medic or EMS.`, 'radio'); return false; } c.crit += cfg.aidOther; c.aided = 1; t = `first aid on ${c.name} — +${tDur(cfg.aidOther)}.`; }
  log(`${u.name}: ${t}`, 'good'); xpAct('aid', u, c.name); fx('text', c.x, c.y, { text: c.stable ? 'STABLE' : 'AID', color: '#3ef0a0' }); S.version++; return true;
}
function dropCas(u, c) { if (c) { c.carrier = null; } u.carrying = null; }
function atEMS(c, u) { if (u) xpAct('evac', u, c.name); c.state = 'transport'; c.tr = CAS_CFG.transport; c.stable = true; c.carrier = null; c.known = true; if (u) u.carrying = null;
  log(`EMS: ${c.name} loaded into the ambulance — transport ${tMin(c.tr)}.`, 'good'); fx('text', c.x, c.y, { text: 'EMS', color: '#3ef0a0' }); }
/** Execution of aid / rescue / evac orders (called from unitAct). */
function casAct(u, o, speed) {
  const c = casById(o.cas); if (!c || !casActive(c) || (c.carrier && c.carrier !== u.uid)) { if (u.carrying === o.cas) dropCas(u, c); popOrder(u); return; }
  if (!o.picked) {
    if (cheb(u.x, u.y, c.x, c.y) > 1) { const r = stepAlong(u, o, adjGoal(c), speed); if (r === null) failOrders(u, 'cannot reach the casualty'); if (!r) return; }
    faceTo(u, c.x, c.y);
    if (o.type === 'aid') { applyAid(u, c); popOrder(u); return; }
    if (u.kind === 'team' && hasSpec(u, 'medic') && !c.stable && c.aided < 2) applyAid(u, c, true);
    o.picked = true; c.carrier = u.uid; u.carrying = c.id; c.x = u.x; c.y = u.y;
    if (o.type === 'rescue' && (o.dx === undefined)) { const d = ccpFor(c.x, c.y); if (d) { o.dx = d[0]; o.dy = d[1]; } else { o.dx = u.x; o.dy = u.y; } }
    log(`${u.name}: has ${c.name} — ${o.type === 'evac' ? 'carrying to the EMS point' : 'dragging to cover'}${u.kind === 'team' && u.equip.shield > 0 ? ' behind the shield' : ''}.`, 'radio'); return; }
  const inside = roomAt(u.x, u.y) >= 0, sp = inside ? 1 : u.kind === 'team' ? CAS_CFG.carryTeam : CAS_CFG.carryPatrol;
  const goal = o.type === 'evac' ? (x, y) => cheb(x, y, S.ems.x, S.ems.y) <= 1 : (x, y) => x === o.dx && y === o.dy;
  const r = stepAlong(u, o, goal, sp); c.x = u.x; c.y = u.y;
  if (r === null) { dropCas(u, c); failOrders(u, 'no route while carrying'); return; }
  if (r) { popOrder(u); if (o.type === 'evac') atEMS(c, u); else { dropCas(u, c); c.ccp = true; xpAct('rescue', u, c.name); log(`${u.name}: ${c.name} at the casualty collection point (in cover).`, 'radio'); } }
}
/** Per tick: mobile casualties move themselves (cover first, then to EMS). Fog flags refresh. */
function casualtyTick() {
  for (const c of S.cas) { if (c.who === 'suspect' && casActive(c) && !c.carrier) { c.x = S.suspect.x; c.y = S.suspect.y; } casKnow(c); if (c.state !== 'mobile' || c.carrier || c.wait || c.who === 'suspect') continue;
    if (!c.goal) { const d = expoAt(c.x, c.y) < 0.12 && roomAt(c.x, c.y) < 0 ? null : ccpFor(c.x, c.y); c.goal = d ? { x: d[0], y: d[1], k: 'cover' } : { x: S.ems.x, y: S.ems.y, k: 'ems' }; }
    if (c.goal.k === 'cover' && c.x === c.goal.x && c.y === c.goal.y) { c.goal = { x: S.ems.x, y: S.ems.y, k: 'ems' }; log(`${c.name}: in cover — making own way to EMS.`, 'radio'); continue; }
    if (c.goal.k === 'ems') { c.goal.x = S.ems.x; c.goal.y = S.ems.y; if (cheb(c.x, c.y, S.ems.x, S.ems.y) <= 1) { atEMS(c); continue; } }
    if (S.tick % 2) continue; // walking wounded: half speed
    const g = c.goal.k === 'ems' ? (x, y) => cheb(x, y, c.goal.x, c.goal.y) <= 1 : (x, y) => x === c.goal.x && y === c.goal.y;
    const p = findPath(c.x, c.y, g, { canOpen: true, avoidSuspect: true, expo: true }); if (p && p.length) { c.x = p[0][0]; c.y = p[0][1]; } else if (!p) c.goal = null; }
}
/** End of turn: countdowns and transport. */
function casualtyTurn() {
  for (const c of S.cas) { c.wait = false;
    if (c.state === 'transport') { if (--c.tr <= 0) { c.state = 'evacuated'; S.stats.evac++; log(`EMS: ${c.name} has reached hospital.`, 'good'); } continue; }
    if (!casActive(c) || c.stable) continue;
    c.crit--; if (c.crit <= 0) { if (c.who === 'suspect' && c.state === 'mobile') { c.state = 'immobile'; c.crit = 3; if (hostile()) { S.suspect.mode = 'incapacitated'; S.suspect.walk = null; S.stats.method = 'Officer fire'; } if (S.suspect.visible) log('Suspect has collapsed — immobile.', 'alert'); continue; }
      if (c.who === 'suspect') { suspectLost(c); continue; } c.state = 'lost'; S.stats.lost++; if (c.carrier) { const u = unit(c.carrier); if (u) { u.carrying = null; u.orders = u.orders.filter(q => q.cas !== c.id); } c.carrier = null; }
      log(`${c.name} did not survive the injuries.`, 'bad'); fx('text', c.x, c.y, { text: 'LOST', color: '#c9ced6' }); }
    else if (c.crit <= 2 && c.known && c.who !== 'suspect') log(`${c.name}: Critical — ${tDur(c.crit)} left without aid.`, 'alert'); }
}
/** Scene secured / operation over: EMS moves in. */
function casualtyResolve(secure) {
  for (const c of S.cas) { if (c.state === 'transport') { c.state = 'evacuated'; S.stats.evac++; continue; }
    if (!casActive(c)) continue; if (c.who === 'suspect' && S.suspect.deceased) continue;
    if (c.stable || c.crit >= CAS_CFG.secureSave || (secure && c.state === 'mobile')) { c.state = 'evacuated'; S.stats.evac++; } else { c.state = 'lost'; S.stats.lost++; if (c.who === 'suspect') S.suspect.deceased = true; } c.known = true; }
}
/* ---------- the suspect as a casualty ---------- */
function suspectLost(c) { const sp = S.suspect; c.state = 'lost'; sp.deceased = true; if (hostile()) { sp.mode = 'incapacitated'; sp.walk = null; } S.stats.lost++;
  if (c.known || sp.visible) log('Suspect has stopped moving.', 'alert'); }

/* =====================================================================
   NEGOTIATION — contact (phone / PA / throw-phone), dialogue, call-out,
   walk-out surrender protocol and the hidden-weapon ambush risk. Rules only.
   ===================================================================== */
/* ================== TUNABLE: NEGOTIATION CONFIG ================== */
const NEGO_CFG = {
  talkingFire: 0.4,      // suspect fire-attempt multiplier while a live line is open
  outsideChallenge: 0.5, // challenge-to-surrender odds multiplier when a team shouts from outside (once per turn)
  temper: { // hidden personality, rolled per seed
    talker:    { w: 0.40, refuse: 0.25, hang: 0.10, noAnswer: 0.25, escalate: 0.30, hint: 'He talks a lot when he is upset — he will want to be heard.' },
    withdrawn: { w: 0.35, refuse: 0.45, hang: 0.20, noAnswer: 0.50, escalate: 0.20, hint: 'He shuts down and stops answering when pushed.' },
    volatile:  { w: 0.25, refuse: 0.40, hang: 0.35, noAnswer: 0.30, escalate: 0.60, hint: 'He has a temper — threats make him worse.' },
  },
  refuseAgit: 0.003,      // + refusal chance per agitation point
  number: { interview: 0.5, call911: 0.7, family: 0.85 }, // how the suspect's phone number is learned
  familyTurn: 2,          // family reach the command post from this turn
  pa: { range: 22, yell: 0.45, fireOnYell: 0.25, eff: 0.6 },   // loudspeaker reach from the house centre, shout-back odds
  throwPhone: { team: { block: 0.15, shoot: 0.10, approachFire: 0.30 }, robot: { block: 0.10, shoot: 0.15 }, doorway: 0.6 },
  talk: {
    rapport:    { gain: [8, 16], agit: -4 },
    listen:     { gain: [3, 7], agit: -10, intel: 0.45 },
    concession: { gain: [10, 18], agit: -6, max: 3, need: 15 },
    status:     { gain: [1, 3], agit: 0 },
    ultimatum:  { need: 65, surrender: 0.35, agit: 15, talk: -15, hang: 0.5 },
  },
  agitDrag: 0.06,         // rapport gain lost per agitation point
  coach: 1.1,             // second negotiator on scene (coach / scribe)
  surrender: { sure: 100, from: 75, div: 120 },
  callout: { base: 0.12, talk: 0.08, gas: 0.06, agitHigh: 70, agitPen: 0.04, contain: 0.7, fire: 0.2, yell: 0.4, agit: 6 },
  hiddenWeapon: 0.5, ambushHidden: 0.4,   // average ambush ≈ 20 % with no protocol
  protocol: { cover: 0.6, shield: 0.75, overwatch: 0.75, commands: 0.6 },
  ambushHit: 0.4, walkDist: 5,
};
/* ================================================================== */
const TALK_KEYS = ['call', 'rapport', 'listen', 'concession', 'status', 'ultimatum'];
const TALK_NAMES = { call: 'Call his phone', rapport: 'Build rapport', listen: 'Listen / let him vent', concession: 'Offer a concession', status: 'Status check', ultimatum: 'Ultimatum' };
function initNego(seed) {
  const nr = makeRng(seed * 977 + 13); const T = NEGO_CFG.temper; let pick = nr(), temper = 'talker';
  for (const k in T) { pick -= T[k].w; if (pick <= 0) { temper = k; break; } }
  S.nego = { temper, hidden: nr.chance(NEGO_CFG.hiddenWeapon), called911: nr.chance(NEGO_CFG.number.call911), numberKnown: false, numberSrc: null, line: false, phoneRoom: null,
    contact: null, quiet: 0, attempts: 0, refusals: 0, rounds: 0, concessions: 0, pick: null, outcome: null, hist: [], read: null, warn: false, protocol: null, ambush: null, paTurn: -1, everContact: false, how: null };
}
function negOnScene() { return S.officers.filter(o => o.spec === 'negotiator' && (o.status === 'staged' || o.status === 'ok')); }
function negotiatorSkill() { const n = negOnScene(); return n.length ? Math.max(...n.map(o => o.skill)) : 0.5; }
function negHist(t, kind) { S.nego.hist.push({ turn: S.turn + 1, t }); if (S.nego.hist.length > 40) S.nego.hist.shift(); log(t, kind || 'radio'); }
function learnNumber(src) { const N = S.nego; if (N.numberKnown) return; N.numberKnown = true; N.numberSrc = src; negHist(`Negotiator: suspect's cell number obtained (${src}). Phone contact possible.`, 'intel'); }
/** Units that can broadcast: a cruiser PA with someone inside, or a team with a bullhorn. */
function paCapable(u) { return unitAlive(u) && (u.kind === 'cruiser' && u.occ.length > 0 && !u.disabled || u.kind === 'team' && u.deployed && (u.equip.bullhorn || 0) > 0); }
function paInRange(x, y) { const [hx, hy] = houseCenter(); return dist(x, y, hx, hy) <= NEGO_CFG.pa.range; }
function paUnits(x, y) { return S.units.filter(u => paCapable(u) && (x === undefined ? paInRange(u.x, u.y) : dist(u.x, u.y, x, y) <= NEGO_CFG.pa.range)); }
/** Can he hear us on the current channel? */
function contactLive() { const N = S.nego; if (!N.contact) return false; if (N.contact === 'pa') return paUnits().length > 0; return true; }
function talkAvail(k) {
  const N = S.nego, sp = S.suspect; if (!negOnScene().length) return 'Needs a Negotiator on scene';
  if (sp.mode === 'surrendered') return 'He is coming out — run the surrender protocol';
  if (!hostile()) return 'Not needed';
  if (k === 'call') { if (contactLive()) return 'Already talking'; if (!N.numberKnown && !N.line) return 'No number — Neighbor/Family interview or 911 call review, or deliver a throw-phone'; return true; }
  if (!contactLive()) return N.contact === 'pa' ? 'PA unit out of range' : 'No contact — call him, use the PA or deliver a throw-phone';
  if (k === 'concession') { if (N.concessions >= NEGO_CFG.talk.concession.max) return 'Nothing left to offer'; if (sp.talk < NEGO_CFG.talk.concession.need) return 'Too early — build rapport first'; }
  return true;
}
function setTalk(k) { if (S.phase !== 'planning') return { ok: false, reason: 'Busy' }; if (!k) { S.nego.pick = null; S.version++; return { ok: true }; }
  const a = talkAvail(k); if (a !== true) return { ok: false, reason: a }; S.nego.pick = k; S.version++; return { ok: true }; }
/** Refusal roll for any contact attempt. Returns true when he engages. */
function contactTry(chan) {
  const N = S.nego, sp = S.suspect, T = NEGO_CFG.temper[N.temper], r = S.rng; N.attempts++;
  if (N.quiet > 0) { N.refusals++; negHist(`Negotiator: no response — he has gone quiet.`, 'radio'); return false; }
  const p = clamp(T.refuse + sp.agit * NEGO_CFG.refuseAgit - sp.talk / 300 - (chan === 'line' ? 0.05 : 0), 0.08, 0.85);
  if (r.chance(p)) { N.refusals++;
    if (r.chance(T.escalate)) { sp.agit = clamp(sp.agit + 8, 0, 100); negHist(`Contact refused — he shouts at us to back off. Agitation rising.`, 'alert'); }
    else { N.quiet = r.int(1, 2); negHist(`Contact refused — he has gone quiet.`, 'radio'); }
    return false; }
  N.contact = chan; N.everContact = true; xpAct('contact', negOnScene().filter(o => o.status === 'ok' || o.status === 'staged').map(o => o.id)); sp.talk = clamp(sp.talk + 5, 0, 100); sp.agit = clamp(sp.agit - 5, 0, 100);
  negHist(`CONTACT — he is talking to us (${chan === 'pa' ? 'shouting back over the PA' : chan === 'line' ? 'on the throw-phone' : 'on his cell'}).`, 'good'); return true;
}
function talkMult(chan) { const n = negOnScene(); return (0.75 + negotiatorSkill() * 0.5) * (chan === 'pa' ? NEGO_CFG.pa.eff : 1) * (n.length >= 2 ? NEGO_CFG.coach : 1); }
function moodWord() { const a = S.suspect.agit; return a > 75 ? 'Explosive' : a > 55 ? 'Agitated' : a > 35 ? 'Tense' : a > 18 ? 'Calmer' : 'Calm'; }
function rapportWord() { const t = S.suspect.talk; return t >= 85 ? 'Ready to come out' : t >= 65 ? 'Strong' : t >= 40 ? 'Building' : t >= 15 ? 'Fragile' : 'None'; }
/** Planning pick, resolved at EXECUTE. */
function runTalk() {
  const N = S.nego, sp = S.suspect, r = S.rng, k = N.pick; N.pick = null; if (!k) return; if (talkAvail(k) !== true) return;
  const T = NEGO_CFG.temper[N.temper];
  if (k === 'call') { N.attempts; if (!N.line && r.chance(T.noAnswer)) { N.attempts++; N.refusals++; negHist('Negotiator: the phone rings out — no answer.', 'radio'); return; }
    contactTry(N.line ? 'line' : 'phone'); return; }
  const C = NEGO_CFG.talk, m = talkMult(N.contact); N.rounds++; xpAct('dialogue', negOnScene().map(o => o.id)); let gain = 0, msg = '';
  if (k === 'rapport') { gain = r.int(C.rapport.gain[0], C.rapport.gain[1]) * m - sp.agit * NEGO_CFG.agitDrag; sp.agit += C.rapport.agit; msg = 'building rapport — talking about his family, what he needs.'; }
  if (k === 'listen') { gain = r.int(C.listen.gain[0], C.listen.gain[1]) * m; sp.agit += C.listen.agit; msg = 'letting him vent. He is calming down.';
    if (r.chance(C.listen.intel)) { sp.heat = { room: sp.room, x: sp.x, y: sp.y, turn: S.turn }; S.intel.located = true; msg += ` He mentions he is in the ${S.rooms[sp.room] ? S.rooms[sp.room].name : 'house'}.`; } }
  if (k === 'concession') { gain = r.int(C.concession.gain[0], C.concession.gain[1]) * m - sp.agit * NEGO_CFG.agitDrag; sp.agit += C.concession.agit; N.concessions++;
    msg = ['offered to pull the cruisers back a little.', 'got him cigarettes and water sent in on the robot line.', 'let him speak to his sister on the line.'][N.concessions - 1] || 'offered a concession.'; }
  if (k === 'status') { gain = r.int(C.status.gain[0], C.status.gain[1]) * m; S.intel.weapon = true; S.intel.threat = Math.max(S.intel.threat, 1);
    msg = `status check — he says he is alone with a ${SUSPECT_WEAPONS[sp.weapon].name.toLowerCase()}${sp.injured ? ', and he is hurt' : ''}${S.gasActive && S.gas[idx(sp.x, sp.y)] > 0.2 ? ', coughing from the gas' : ''}.`;
    if (N.hidden && !N.warn && r.chance(0.35 + negotiatorSkill() * 0.3)) { N.warn = true; msg += ' Something he said suggests he may be hiding a second weapon — run a full walk-out protocol.'; } }
  if (k === 'ultimatum') { if (sp.talk >= C.ultimatum.need && r.chance(C.ultimatum.surrender + (sp.talk - C.ultimatum.need) / 100)) { negHist('Negotiator: ultimatum — he agrees to come out.', 'good'); walkout('talk'); return; }
    sp.agit += C.ultimatum.agit; sp.talk = clamp(sp.talk + C.ultimatum.talk, 0, 100); negHist('Negotiator: ultimatum rejected — he is furious.', 'alert');
    if (r.chance(C.ultimatum.hang)) { N.contact = null; N.quiet = 1; negHist('He has cut contact.', 'alert'); } sp.agit = clamp(sp.agit, 0, 100); return; }
  sp.agit = clamp(sp.agit, 0, 100); sp.talk = clamp(sp.talk + gain, 0, 100);
  negHist(`Negotiator: ${msg}`, 'radio');
  if (N.contact === 'pa' && r.chance(NEGO_CFG.pa.yell * 0.5)) shoutReveal(paUnits()[0], false);
  const SU = NEGO_CFG.surrender;
  if (sp.talk >= SU.sure || sp.talk >= SU.from && r.chance((sp.talk - SU.from) / SU.div)) { negHist('Negotiator: he says he is ready to come out.', 'good'); walkout('talk'); return; }
  if (r.chance(T.hang * sp.agit / 50)) { N.contact = null; N.quiet = r.int(0, 1); negHist('He hangs up / stops answering mid-conversation.', 'alert'); }
}
/** He shouts back: steps to a window (briefly visible) or shouts through a door (location revealed). Optionally fires at the PA unit. */
function shoutReveal(u, mayFire) {
  const sp = S.suspect; if (!hostile() || sp.stun > 0) return; const wins = suspectWindowCells(); let best = null, bs = -1e9;
  for (const [x, y] of wins) { const s = (u && los(x, y, u.x, u.y) ? 10 : 0) - (u ? dist(x, y, u.x, u.y) / 20 : 0); if (s > bs && !S.units.some(q => q.x === x && q.y === y)) { bs = s; best = [x, y]; } }
  sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn }; S.intel.located = true; S.intel.threat = Math.max(S.intel.threat, 1);
  if (best) { sp.x = best[0]; sp.y = best[1]; sp.atWindow = true; sp.duck = 0; sp.cd = Math.max(sp.cd, 1); sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn }; fx('text', sp.x, sp.y, { text: 'SHOUTING', color: '#ffb020' });
    log(`Suspect yells back from the ${S.rooms[sp.room].name} window — briefly exposed.`, 'alert');
    if (mayFire && u && los(sp.x, sp.y, u.x, u.y) && S.rng.chance(NEGO_CFG.pa.fireOnYell + sp.agit / 400)) { sp.cd = 0;
      suspectFire({ u, px: sp.x, py: sp.y, d: dist(sp.x, sp.y, u.x, u.y), l: los(sp.x, sp.y, u.x, u.y), cls: targetClass(u, sp.x, sp.y) }); } }
  else { sp.heat = { room: sp.room, x: sp.x, y: sp.y, turn: S.turn }; log(`Suspect shouts through the door — his voice places him in the ${S.rooms[sp.room] ? S.rooms[sp.room].name : 'house'}.`, 'intel'); }
}
/** PA order: open contact or a formal call-out. */
function paAct(u, o) {
  const N = S.nego, sp = S.suspect, r = S.rng; if (!hostile()) return; if (!paInRange(u.x, u.y)) { log(`${u.name}: out of PA range.`, 'radio'); return; }
  if (o.mode === 'callout') { const C = NEGO_CFG.callout; N.attempts++;
    let p = C.base + sp.talk / 100 * C.talk + (S.gasActive && S.gas[idx(sp.x, sp.y)] > 0.2 ? C.gas : 0) - (sp.agit > C.agitHigh ? C.agitPen : 0);
    if (S.contain.length && S.contain.some(c => !c.covered)) p *= C.contain; N.lastCallout = p;
    log(`${u.name} (PA): "POLICE! COME OUT WITH YOUR HANDS EMPTY!"`, 'radio');
    if (r.chance(p)) { negHist('Call-out: he shouts that he is coming out.', 'good'); walkout('callout'); return; }
    N.refusals++; sp.agit = clamp(sp.agit + C.agit, 0, 100);
    const f = r(); if (f < C.fire + sp.agit / 400) { negHist('Call-out refused — he answers with gunfire.', 'alert'); shoutReveal(u, true); if (hostile() && sp.cd === 0 && u && los(sp.x, sp.y, u.x, u.y)) suspectFire({ u, px: sp.x, py: sp.y, d: dist(sp.x, sp.y, u.x, u.y), l: los(sp.x, sp.y, u.x, u.y), cls: targetClass(u, sp.x, sp.y) }); }
    else if (f < C.fire + C.yell) { negHist('Call-out refused — he yells back.', 'radio'); shoutReveal(u, false); }
    else negHist('Call-out: no response.', 'radio'); return; }
  if (contactLive()) { log(`${u.name} (PA): negotiator on the loudspeaker.`, 'radio'); return; }
  log(`${u.name} (PA): "This is the police. We want to talk — pick up or answer us."`, 'radio');
  if (contactTry('pa')) { shoutReveal(u, false); return; }
  if (!N.quiet && r.chance(NEGO_CFG.pa.yell)) shoutReveal(u, true);
}
/** Throw-phone arrives in a room (team throw or robot drop). */
function deliverPhone(u, room, via, doorway) {
  const N = S.nego, sp = S.suspect, r = S.rng, C = NEGO_CFG.throwPhone[via]; const rm = S.rooms[room];
  if (via === 'team') { u.equip.tphone--; } N.attempts++;
  if (r.chance(C.block)) { negHist(`${u.name}: throw-phone ${via === 'robot' ? 'snagged on furniture' : 'bounced off the frame'} — it did not get in. Failed.`, 'bad'); return; }
  if (hostile() && (sp.room === room || doorway) && r.chance(C.shoot + sp.agit / 500)) { fx('muzzle', sp.x, sp.y, { suspect: true }); S.stats.shots++; sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn };
    negHist(`Suspect shot the throw-phone${via === 'robot' ? ' — robot damaged' : ''}. Failed.`, 'alert'); if (via === 'robot' && r.chance(0.5)) { u.status = 'down'; u.orders = []; } sp.agit = clamp(sp.agit + 5, 0, 100); return; }
  N.line = true; N.phoneRoom = room;
  const reach = sp.room === room ? 1 : doorway ? NEGO_CFG.throwPhone.doorway : 0.35;
  if (!hostile() || !r.chance(reach)) { negHist(`${u.name}: throw-phone delivered (${rm ? rm.name : 'house'}). It is ringing — no pick-up yet.`, 'radio'); return; }
  negHist(`${u.name}: throw-phone delivered — he picks it up.`, 'radio'); contactTry('line');
}
/** Planning check for a throw-phone order. */
function planTPhone(u, o, sx, sy, assume, mo) {
  if (!(u.equip.tphone > 0)) return { ok: false, reason: 'No throw-phone on this team' };
  if (o.via === 'robot') { const g = robotPhoneGoal(o.room); if (!g) return { ok: false, reason: 'Robot needs an open door into the house — open or breach one first' };
    const p = findPath(sx, sy, g.fn, { canOpen: false, avoidSuspect: true, assume }); if (!p) return { ok: false, reason: 'Robot cannot reach an opening from here' }; o.doorway = g.doorway; return { ok: true, path: [], dpath: p, end: [sx, sy] }; }
  const fn = (x, y) => roomAt(x, y) !== o.room && canThrowFrom(x, y, o.room, assume, u, 'tphone');
  if (canThrowFrom(sx, sy, o.room, assume, u, 'tphone')) return { ok: true, path: [], end: [sx, sy], warn: expoAt(sx, sy) >= 0.3 ? 'Throw spot is exposed to the house' : null };
  const p = findPath(sx, sy, fn, mo); if (!p) return { ok: false, reason: 'No opening into that room (open a door or reach a window)' };
  const e = p[p.length - 1]; return { ok: true, path: p, end: e, warn: expoAt(e[0], e[1]) >= 0.3 ? 'Approach is exposed — he may fire at the team' : null };
}
function robotPhoneGoal(room) {
  const into = (x, y) => adjacentToRoomOpening(x, y, room, null, null) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const nx = x + dx, ny = y + dy; if (roomAt(nx, ny) !== room) return roomAt(x, y) === room; const e = edge(x, y, nx, ny); return e.t === 'O' || e.t === 'D' && e.d.state !== 'closed'; });
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (into(x, y)) return { fn: into, doorway: false };
  const ext = (x, y) => roomAt(x, y) >= 0 && S.doors.some(d => d.exterior && d.state !== 'closed' && d.cells.some(([a, b]) => a[0] === x && a[1] === y || b[0] === x && b[1] === y));
  for (const d of S.doors) if (d.exterior && d.state !== 'closed') return { fn: ext, doorway: true };
  return null;
}
/** Team / robot execution of a throw-phone order (called from unitAct). */
function tphoneAct(u, o, speed) {
  if (u.kind === 'team' && o.via === 'robot') { u.equip.robot--; u.equip.tphone--; const g = robotPhoneGoal(o.room);
    const d = { uid: 'D' + (++S.devSeq), kind: 'robot', name: 'Robot ' + S.devSeq, num: S.devSeq, x: u.x, y: u.y, dir: u.dir, orders: [{ type: 'tphone', room: o.room, via: 'robot', doorway: g ? g.doorway : true }], battery: 10, owner: u.uid, status: 'ok', vis: [] };
    S.units.push(d); log(`${u.name}: ${d.name} rolling out with a throw-phone.`, 'radio'); popOrder(u); return; }
  if (u.kind === 'robot') { const g = robotPhoneGoal(o.room); if (!g) { failOrders(u, 'no open way in'); return; }
    const r = stepAlong(u, o, g.fn, 1); if (r === null) { failOrders(u, 'no route to an opening'); return; } if (!r) return;
    popOrder(u); deliverPhone(u, o.room, 'robot', g.doorway); return; }
  if (!canThrowFrom(u.x, u.y, o.room, null, u, 'tphone')) { const r = stepAlong(u, o, (x, y) => roomAt(x, y) !== o.room && canThrowFrom(x, y, o.room, null, u, 'tphone'), speed); if (r === null) failOrders(u, 'no opening into room'); return; }
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = u.x + dx, ny = u.y + dy; if (roomAt(nx, ny) !== o.room) continue; const e = edge(u.x, u.y, nx, ny);
    if (e.t === 'D' && e.d.state === 'closed' && !e.d.locked && !e.d.barricaded) { e.d.state = 'open'; break; } if (e.t === 'W' && !e.w.broken && !canSeeRoom(u, o.room)) { e.w.broken = true; noise(nx, ny, 6, 'glass'); break; } }
  popOrder(u); const sp = S.suspect;
  if (hostile() && roomAt(u.x, u.y) < 0 && expoAt(u.x, u.y) >= 0.2) { const spots = [[sp.x, sp.y]].concat(suspectWindowCells()); const sh = spots.find(([x, y]) => los(x, y, u.x, u.y));
    if (sh && S.rng.chance(NEGO_CFG.throwPhone.team.approachFire * (0.5 + sp.agit / 100))) { sp.x = sh[0]; sp.y = sh[1]; sp.atWindow = winCellSet().has(idx(sp.x, sp.y)); sp.cd = 0;
      log(`${u.name}: taking fire on the approach!`, 'alert'); suspectFire({ u, px: sp.x, py: sp.y, d: dist(sp.x, sp.y, u.x, u.y), l: los(sp.x, sp.y, u.x, u.y), cls: targetClass(u, sp.x, sp.y) }); if (!unitAlive(u) || !teamOk(u).length) return; } }
  deliverPhone(u, o.room, 'team', false);
}
/* ---------- walk-out surrender ---------- */
function frontDoor() { return S.doors.find(d => d.name === 'Front Door') || S.doors.find(d => d.exterior); }
function defaultSurrSpot() { const d = frontDoor(); if (!d) return [S.ext.staging.x, S.ext.staging.y];
  const [a, b] = d.cells[Math.floor(d.cells.length / 2)]; const out = roomAt(a[0], a[1]) < 0 ? a : b, inn = out === a ? b : a; const dx = out[0] - inn[0], dy = out[1] - inn[1];
  for (let k = NEGO_CFG.walkDist; k >= 1; k--) { const x = out[0] + dx * k, y = out[1] + dy * k; if (cellOk(x, y, { outdoor: true })) return [x, y]; } return out; }
function surrSpot() { return S.surrSpot ? [S.surrSpot.x, S.surrSpot.y] : defaultSurrSpot(); }
function setSurrenderSpot(x, y) { if (S.phase !== 'planning') return { ok: false, reason: 'Wait for the orders to resolve' };
  if (!cellOk(x, y, { outdoor: true })) return { ok: false, reason: 'Walk-out spot must be open ground outside' };
  const p = findPath(S.suspect.x, S.suspect.y, (xx, yy) => xx === x && yy === y, { suspect: true, canOpen: true, allDoors: true }); if (!p) return { ok: false, reason: 'He cannot walk there from the house' };
  const [hx, hy] = houseCenter(); if (dist(x, y, hx, hy) > 24) return { ok: false, reason: 'Too far from the house — keep it within view' };
  S.surrSpot = { x, y }; log('Walk-out point set. When he comes out he will be told to stop and kneel there.', 'system'); S.version++; return { ok: true }; }
function walkout(how) { const sp = S.suspect, N = S.nego; if (!hostile()) return false; sp.mode = 'surrendered'; sp.stun = 0; N.how = how; N.outcome = how === 'callout' ? 'Call-out surrender' : 'Negotiated surrender';
  sp.walk = { stage: 'wait', turn: S.turn, spot: surrSpot(), amb: false, rolled: false };
  S.doors.forEach(d => { if (d.rooms.includes(sp.room)) { d.barricaded = false; d.locked = false; } if (d.exterior) { d.locked = false; d.barricaded = false; } });
  log('He will come out through the front door in the next 30 seconds. Set up the protocol: cover team (shield), overwatch, PA commands. Then cuff him at the walk-out point.', 'good'); S.version++; }
/** Score the surrender protocol at the moment he steps outside. */
function protocolNow(spot) {
  const [x, y] = spot, P = { cover: false, shield: false, overwatch: false, commands: false, who: [] };
  for (const u of S.units) { if (!unitAlive(u)) continue;
    if (u.kind === 'team' && u.perch && u.deployed) { const wk = weaponOf(u); if (los(u.x, u.y, x, y) && dist(u.x, u.y, x, y) <= WEAPONS[wk].range) { P.overwatch = true; P.who.push(u.name + ' overwatch'); } continue; }
    if (u.kind === 'cruiser' && u.occ.length && dist(u.x, u.y, x, y) <= 14) { P.cover = true; P.who.push(u.name + ' cover'); }
    if (!onFoot(u) || roomAt(u.x, u.y) >= 0) continue; if (dist(u.x, u.y, x, y) > 14 || !los(u.x, u.y, x, y)) continue;
    const l = losEx(x, y, u.x, u.y, true); const nearCar = S.units.some(c => c.kind === 'cruiser' && cheb(c.x, c.y, u.x, u.y) <= 2);
    if (l.cov >= 1 || nearCar) { P.cover = true; P.who.push(u.name + ' cover'); if (u.kind === 'team' && u.equip.shield > 0) P.shield = true; }
    else if (u.kind === 'team' && u.equip.shield > 0) { P.shield = true; } }
  if (paUnits(x, y).length) P.commands = true;
  P.score = ['cover', 'shield', 'overwatch', 'commands'].filter(k => P[k]).length; return P;
}
/** Expected ambush risk shown to the player (does not reveal whether he actually hides a weapon). */
function ambushRisk(P) { const C = NEGO_CFG; let p = C.hiddenWeapon * C.ambushHidden; for (const k of ['cover', 'shield', 'overwatch', 'commands']) if (P[k]) p *= C.protocol[k]; return p; }
function ambushChance(P) { const C = NEGO_CFG; let p = S.nego.hidden ? C.ambushHidden : 0; for (const k of ['cover', 'shield', 'overwatch', 'commands']) if (P[k]) p *= C.protocol[k]; return p; }
/** One tick of the walk-out (suspectTick while surrendered). */
function walkoutTick() {
  const sp = S.suspect, w = sp.walk, N = S.nego; if (!w) return;
  if (w.stage === 'wait') { if (S.turn <= w.turn) return; w.stage = 'out'; log('Suspect is coming out — hands up.', 'alert'); }
  if (w.stage === 'out') {
    if (sp.x === w.spot[0] && sp.y === w.spot[1]) { w.stage = 'kneel'; const cmd = N.protocol && N.protocol.commands;
      log(cmd ? 'PA: "STOP. KNEEL. HANDS ON YOUR HEAD." — he kneels at the walk-out point.' : 'He stops at the walk-out point, standing, hands raised. (No PA commands.)', 'radio'); return; }
    const p = findPath(sp.x, sp.y, (x, y) => x === w.spot[0] && y === w.spot[1], { suspect: true, canOpen: true, allDoors: true });
    if (!p || !p.length) { w.spot = [sp.x, sp.y]; return; } const [nx, ny] = p[0]; const e = edge(sp.x, sp.y, nx, ny); if (e.t === 'D') { e.d.state = 'open'; e.d.barricaded = false; e.d.locked = false; }
    sp.x = nx; sp.y = ny; sp.room = roomAt(nx, ny); sp.atWindow = false; sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn };
    if (sp.room < 0 && !w.rolled) { w.rolled = true; N.protocol = protocolNow(w.spot); w.p = ambushChance(N.protocol); w.amb = S.rng.chance(w.p);
      log(`Walk-out protocol: ${N.protocol.score}/4 (${['cover', 'shield', 'overwatch', 'commands'].map(k => (N.protocol[k] ? '✓ ' : '✗ ') + k).join(', ')}).`, N.protocol.score >= 3 ? 'good' : 'alert'); }
    return; }
  if (w.stage === 'kneel') {
    const near = S.units.filter(u => onFoot(u) && !u.perch && cheb(u.x, u.y, sp.x, sp.y) <= 2).sort((a, b) => dist(a.x, a.y, sp.x, sp.y) - dist(b.x, b.y, sp.x, sp.y));
    if (!S.units.some(u => u.detain)) { const c = S.units.filter(u => onFoot(u) && !u.perch && roomAt(u.x, u.y) < 0 && !(u.orders[0] && u.orders[0].cas)).sort((a, b) => (b.kind === 'team') - (a.kind === 'team') || dist(a.x, a.y, sp.x, sp.y) - dist(b.x, b.y, sp.x, sp.y))[0];
      if (c) { c.detain = true; c.orders = []; log(`${c.name}: moving up to take him into custody.`, 'radio'); } }
    if (near.length && w.amb) { ambushNow(near[0]); return; }
    const adj = near.find(u => cheb(u.x, u.y, sp.x, sp.y) <= 1); if (adj) { sp.walk = null; S.units.forEach(u => u.detain = false); detained(adj, N.outcome || 'Surrendered'); } }
}
function ambushNow(T) {
  const sp = S.suspect, N = S.nego, P = N.protocol || {}, r = S.rng; sp.walk = null; sp.mode = 'alert'; sp.weapon = 'handgun'; sp.ambush = true; sp.retreat = true; N.contact = null; N.quiet = 3; sp.talk = 0; sp.agit = 90;
  S.units.forEach(u => u.detain = false); S.stats.shots++; N.ambush = { turn: S.turn + 1, score: P.score || 0, hit: false };
  fx('muzzle', sp.x, sp.y, { suspect: true }); fx('shot', sp.x, sp.y, { tx: T.x, ty: T.y }); sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn };
  log('AMBUSH — he pulls a hidden handgun on the arrest team!', 'bad'); N.outcome = 'Walk-out ambush';
  let p = NEGO_CFG.ambushHit * (P.commands ? 0.5 : 1) * (T.kind === 'team' && T.equip.shield > 0 ? 0.5 : 1) * (T_HIT[targetClass(T, sp.x, sp.y)] || 1);
  if (r.chance(p)) { N.ambush.hit = true; officerDown(T); } else log(`Rounds miss ${T.name}.`, 'alert');
  const resp = S.units.filter(u => unitAlive(u) && (onFoot(u) || u.perch) && weaponOf(u) && los(u.x, u.y, sp.x, sp.y) && dist(u.x, u.y, sp.x, sp.y) <= WEAPONS[weaponOf(u)].range)
    .sort((a, b) => !!b.perch - !!a.perch);
  for (const u of resp.slice(0, 3)) { const q = u.perch ? 0.7 : P.cover ? 0.55 : 0.3; fx('muzzle', u.x, u.y, { friendly: true }); fx('shot', u.x, u.y, { tx: sp.x, ty: sp.y, friendly: true }); S.stats.ofShots++;
    if (r.chance(q)) { suspectHit(u); if (!hostile()) return; } }
  log('He is running back inside!', 'alert');
}
/** Hostile suspect who ended up outside (after an ambush) retreats to his room. */
function retreatStep() { const sp = S.suspect; const p = findPath(sp.x, sp.y, (x, y) => x === sp.home.x && y === sp.home.y, { suspect: true, canOpen: true, allDoors: true });
  if (!p || !p.length) { sp.retreat = false; return; } const [nx, ny] = p[0]; const e = edge(sp.x, sp.y, nx, ny); if (e.t === 'D') e.d.state = 'open'; sp.x = nx; sp.y = ny; sp.room = roomAt(nx, ny);
  if (sp.x === sp.home.x && sp.y === sp.home.y) sp.retreat = false; }
function negoTurn() { const N = S.nego; if (N.quiet > 0) N.quiet--; if (N.contact === 'pa' && !paUnits().length) { N.contact = null; negHist('PA contact lost — no loudspeaker in range.', 'radio'); } }
function negoSummary() { const N = S.nego, sp = S.suspect;
  return { onScene: negOnScene().length, contact: contactLive() ? N.contact : null, numberKnown: N.numberKnown, numberSrc: N.numberSrc, line: N.line, quiet: N.quiet, attempts: N.attempts, refusals: N.refusals, rounds: N.rounds,
    concessions: N.concessions, mood: moodWord(), rapport: rapportWord(), read: N.read, warn: N.warn, pick: N.pick, hist: N.hist.slice(-6), outcome: N.outcome, walk: sp.walk ? sp.walk.stage : null,
    protocol: N.protocol, preview: sp.walk || hostile() ? protocolNow(surrSpot()) : null, spot: surrSpot(), avail: Object.fromEntries(TALK_KEYS.map(k => [k, talkAvail(k)])), names: TALK_NAMES }; }

/* =====================================================================
   SCENARIO — what happened before SWAT was paged: roadblocks, how patrol
   set up (good / accidental gap / clumped at the front / one badly placed),
   officers hit on arrival, the mission brief and the 911 call transcript.
   ===================================================================== */
const SCENE_CFG = {
  variants: { good: 0.3, gap: 0.3, front: 0.2, mixed: 0.2 },   // patrol setup on arrival
  injury: 0.32,                                                // chance an officer was hit before SWAT arrived
  injuryKind: { mobile: 0.3, immobile: 0.38, critical: 0.22, kia: 0.1 },
  critImmobile: [4, 6], critCritical: [3, 4],                  // turns left without aid
  slip: 0.12, slipAfter: 2,                                    // unwatched side with windows: per-turn chance he tries to slip out (after N turns of gap)
  numberInCall: 0.3,                                           // a third-party caller gives his number
};
const VARIANT_TXT = { good: 'Good — patrol on two diagonal corners, every side watched', gap: 'Gap — one side left uncovered by accident', front: 'Clumped — patrol bunched at the front', mixed: 'Mixed — one officer in a bad, exposed position' };
const FIRST = ['Daniel', 'Marcus', 'Travis', 'Kevin', 'Luis', 'Dmitri', 'Ray', 'Calvin', 'Nate', 'Victor', 'Owen', 'Trent'];

/** Cruisers start at the ends of the block (map edge or the nearest intersection), parked across the street to stop traffic. */
function setupRoadblocks(r) {
  const G = S.geo, H = S.house, hcx = (H.x0 + H.x1) / 2, X = S.ext; S.roadblocks = [];
  const ends = ['W', 'E'].map(side => { const cr = G.cross && (side === 'W' ? G.cross.x1 < hcx : G.cross.x0 > hcx) ? G.cross : null;
    const x = cr ? (side === 'W' ? cr.x1 + 3 : cr.x0 - 3) : side === 'W' ? r.int(4, 6) : MAP_W - r.int(5, 7); return { side, x, kind: cr ? 'intersection' : 'map edge' }; });
  const place = (x0, y0, dir, i) => { let best = null, bs = 1e9; const c0 = { kind: 'cruiser', dir };
    for (let dy = -3; dy <= 3; dy++) for (let dx = -8; dx <= 8; dx++) { const x = x0 + dx, y = y0 + dy; if (!inb(x, y)) continue;
      const fp = footprint(c0, x, y); if (!fp.every(([a, b]) => inb(a, b) && (S.drive[idx(a, b)] || S.paved[idx(a, b)] === 1) && !S.block[idx(a, b)])) continue;
      if (!S.drive[idx(x, y)] || carClash(x, y, null)) continue; if (dist(x, y, X.van.x + 3, X.van.y) < 6) continue; const s = Math.abs(dx) + Math.abs(dy) * 1.5; if (s < bs) { bs = s; best = [x, y]; } }
    if (!best) { dir = 0; c0.dir = 0; for (let dy = -3; dy <= 3 && !best; dy++) for (let dx = -12; dx <= 12; dx++) { const x = x0 + dx, y = y0 + dy; if (inb(x, y) && S.drive[idx(x, y)] && !carClash(x, y, null)) { best = [x, y]; break; } } }
    if (!best) best = [x0, y0];
    const u = { uid: 'C' + (i + 1), kind: 'cruiser', name: 'Cruiser ' + (i + 1), num: i + 1, x: best[0], y: best[1], dir, occ: [], orders: [], status: 'ok', hits: 0, marks: [], vis: [], disabled: false };
    S.units.push(u); rebuildDyn(); return u; };
  const mid = G.ST + Math.floor(G.streetW / 2);
  const c1 = place(ends[0].x, mid, Math.PI / 2, 0); S.roadblocks.push({ x: c1.x, y: c1.y, side: 'W', kind: ends[0].kind, car: c1.uid });
  const c2 = place(ends[1].x, mid, Math.PI / 2, 1); S.roadblocks.push({ x: c2.x, y: c2.y, side: 'E', kind: ends[1].kind, car: c2.uid });
  const k = r.chance(0.5) ? 0 : 1, e = ends[k]; place(e.x + (e.side === 'W' ? 4 : -4), G.ST + 2, e.side === 'W' ? 0 : Math.PI, 2);
}
/** Is a roadblock still held (a cruiser within 3 cells of it)? */
function roadblockHeld(b) { return S.units.some(u => u.kind === 'cruiser' && !u.disabled && dist(u.x, u.y, b.x, b.y) <= 3); }

/** Best outdoor spot for a patrol officer near (ix,iy): watching the wanted sides, never the forbidden one; covered unless 'exposed'. */
function scenePost(ix, iy, want, forbid, mode, D, taken) {
  let best = null, bs = 1e9;
  for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) { const x = ix + dx, y = iy + dy, c = inb(x, y) ? idx(x, y) : -1; if (c < 0 || !cellOk(x, y, { outdoor: true }) || S.dyn[c] || D[c] >= 1e9) continue;
    if (taken.some(t => cheb(t[0], t[1], x, y) < (mode === 'clump' ? 2 : 3))) continue; if (nearDoorOut(x, y, 1)) continue;
    const pre = Math.hypot(dx, dy) * 0.3; if (pre >= bs) continue;
    const sh = shieldAt(x, y); if (mode === 'exposed' ? sh.q !== 'open' : sh.q === 'open') continue;
    const wa = watchAt(x, y); if (!wa.n || (forbid && wa.sides.has(forbid))) continue;
    const s = pre + want.filter(w => !wa.sides.has(w)).length * 6 + (sh.q === 'conceal' ? 1 : 0); if (s < bs) { bs = s; best = [x, y]; } }
  return best;
}
/** Patrol setup variant, officers on foot, and (sometimes) an officer hit before SWAT arrived. */
function setupScene(r) {
  const H = S.house, P = S.units.filter(u => u.kind === 'patrol'), C = S.units.filter(u => u.kind === 'cruiser'), D = reach(S.ext.staging.x, S.ext.staging.y, { outdoor: true }, 1e6);
  boardCar(P[0], C[0]); boardCar(P[1], C[1]);
  const sides = houseSides(), lr = r.chance(0.5) ? ['left', 'right'] : ['right', 'left'];
  let v = 'good', pick = r(); for (const k in SCENE_CFG.variants) { pick -= SCENE_CFG.variants[k]; if (pick <= 0) { v = k; break; } }
  const cx = s => s === 'left' ? H.x0 - 2 : H.x1 + 2, rearY = H.y0 - 2, frontY = H.y1 + 2, hc = Math.round((H.x0 + H.x1) / 2);
  let gap = null;
  const tryPlan = (v, lr, gap) => { let plan;
    if (v === 'good') plan = [[cx(lr[0]), rearY, ['rear', lr[0]]], [cx(lr[1]), frontY, ['front', lr[1]]]];
    else if (v === 'gap') { if (gap === 'rear') plan = [[H.x0 - 2, frontY, ['front', 'left']], [H.x1 + 2, frontY, ['front', 'right']]];
      else { const o = gap === 'left' ? 'right' : 'left'; plan = [[cx(o), rearY, ['rear', o]], [cx(o), frontY, ['front', o]]]; } }
    else if (v === 'front') plan = [[hc - 3, frontY + 2, ['front']], [hc + 1, frontY + 2, ['front']]];
    else plan = [[cx(lr[0]), rearY, ['rear', lr[0]]], [hc + r.int(-3, 3), H.y1 + 4, ['front'], 'exposed']];
    const taken = [];
    plan.forEach(([x, y, want, mode], i) => { const u = P[2 + i]; u.badPos = false; let p = scenePost(x, y, want, gap, mode || (v === 'front' ? 'clump' : ''), D, taken);
      if (!p) p = scenePost(x, y, want, null, '', D, taken) || scenePost(x, y, [], null, '', D, taken); if (!p) p = [S.ext.staging.x + 2 + i, S.ext.staging.y];
      u.x = p[0]; u.y = p[1]; taken.push(p); if (mode === 'exposed' && shieldAt(u.x, u.y).q === 'open') u.badPos = true; });
    return sideWatch().gaps; };
  // place, then verify against real sight lines; if a layout can't produce the intended picture, take what the patrol actually achieved
  if (v === 'good') { let g = tryPlan('good', lr, null); if (g.length) g = tryPlan('good', [lr[1], lr[0]], null); if (g.length) v = 'gap'; }
  else if (v === 'gap') { const opts = r.shuffle(['left', 'right', 'rear'].filter(s => sides.includes(s))); let g = [];
    for (const o of opts.length ? opts : ['rear']) { gap = o; g = tryPlan('gap', lr, o); if (g.length) break; } if (!g.length) { v = 'good'; gap = null; } }
  else tryPlan(v, lr, null);
  P.forEach(p => p.home = { x: p.x, y: p.y });
  const sw0 = sideWatch();
  S.scene = { variant: v, gap0: sw0.gaps.slice(), intended: gap, injury: null, gapFound: null, gapClosed: null, gapTurns: 0, slipTried: false };
  // officer hit on arrival: the second officer on foot, in the open near the front of the house
  if (r.chance(SCENE_CFG.injury)) {
    const u = P[3]; const spot = scenePost(hc + r.int(-4, 4), H.y1 + 3, [], null, 'exposed', D, [[P[2].x, P[2].y]]) || [u.x, u.y];
    u.x = spot[0]; u.y = spot[1]; u.home = { x: u.x, y: u.y }; u.status = 'down'; u.orders = []; u.badPos = false;
    let kind = 'immobile', pk = r(); for (const k in SCENE_CFG.injuryKind) { pk -= SCENE_CFG.injuryKind[k]; if (pk <= 0) { kind = k; break; } }
    const c = addCasualty('patrol', u.uid, u.name, u.x, u.y, { kia: 0, mobile: 0 }); u.cas = c.id; c.initial = true; c.x = u.x; c.y = u.y;
    if (kind === 'kia') { c.state = 'kia'; c.sev = 3; c.crit = 0; S.stats.kia++; c.known = true; }
    else if (kind === 'mobile') { c.state = 'mobile'; c.sev = 1; c.crit = r.int(CAS_CFG.critMobile[0], CAS_CFG.critMobile[1]); c.reported = true; }
    else if (kind === 'critical') { c.state = 'immobile'; c.sev = 3; c.crit = r.int(SCENE_CFG.critCritical[0], SCENE_CFG.critCritical[1]); c.reported = true; }
    else { c.state = 'immobile'; c.sev = 2; c.crit = r.int(SCENE_CFG.critImmobile[0], SCENE_CFG.critImmobile[1]); c.reported = true; }
    c.crit0 = c.crit; c.known = true; S.downList.push({ x: c.x, y: c.y, name: u.name, cas: c.id }); S.scene.injury = { name: u.name, kind, cas: c.id };
    S.scene.gap0 = sideWatch().gaps.slice();
  }
}
/** Mission brief + 911 call, generated from the seed; consistent with the hidden facts (who called, weapon) but never confirms them outright. */
function makeBrief() {
  const r = makeRng(S.seed * 4111 + 17), sp = S.suspect, N = S.nego, sc = S.scene, G = S.geo;
  const self = N.called911, shots = !!sc.injury || r.chance(0.55);
  const types = self ? ['mental health crisis', 'shots reported', 'domestic disturbance'] : ['domestic disturbance', 'welfare check', 'warrant service', 'traffic stop follow-up', 'shots reported', 'mental health crisis'];
  const type = r.pick(types); const first = r.pick(FIRST), last = r.pick(LAST), age = r.int(24, 58), addr = `${r.int(1, 48) * 100 + r.int(1, 99)} ${G.name}`;
  const hh = r.int(0, 23), mm = r.int(0, 59), t0 = hh * 3600 + mm * 60 + r.int(0, 59), ts = s => { s = (t0 + s) % 86400; const p = n => String(n).padStart(2, '0'); return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`; };
  const desc = `${first} ${last}, ${age}, ${r.pick(['about 6 ft, heavy build', 'medium build, beard', 'slim, shaved head', 'tall, thin, glasses', 'stocky, short dark hair'])}`;
  const gunWord = { handgun: 'a handgun', rifle: 'a long gun', shotgun: 'a long gun — maybe a shotgun' }[sp.weapon] || 'a gun';
  const sawGun = self ? r.chance(0.5) : r.chance(0.65);
  const callerKind = self ? 'suspect' : { 'domestic disturbance': 'girlfriend', 'welfare check': 'sister', 'warrant service': 'neighbor', 'traffic stop follow-up': 'neighbor', 'shots reported': 'neighbor', 'mental health crisis': 'mother' }[type];
  const callerName = self ? `${first} ${last} (did not give a name)` : { girlfriend: r.pick(['Kayla', 'Maria', 'Jess']) + ' (girlfriend)', sister: r.pick(['Dana', 'Erin', 'Tasha']) + ` ${last} (sister)`, neighbor: r.pick(['Mr. ', 'Mrs. ']) + r.pick(LAST.filter(n => n !== last)) + ' (neighbor)', mother: `Linda ${last} (mother)` }[callerKind];
  const giveNum = !self && ['girlfriend', 'sister', 'mother'].includes(callerKind) && r.chance(SCENE_CFG.numberInCall * 2);
  const phone = `(612) 555-0${r.int(100, 199)}`;
  const L = [], add = (s, who, text) => L.push({ t: ts(s), who, text });
  let s = 0; add(s, 'Dispatcher', '911, what is the address of your emergency?');
  if (self) { add(s += 4, 'Caller', `${addr}. You need to send somebody. ${type === 'mental health crisis' ? "I can't do this anymore." : type === 'shots reported' ? "I just fired a round so you'd know I'm serious." : 'She left. Everybody leaves.'}`);
    add(s += 6, 'Dispatcher', 'Okay, I am sending help. What is your name, sir?'); add(s += 5, 'Caller', "Doesn't matter. Tell them not to come in here.");
    add(s += 4, 'Dispatcher', 'Is anyone else in the house with you?'); add(s += 3, 'Caller', "No. Just me."); if (sawGun || shots) { add(s += 5, 'Dispatcher', 'Do you have any weapons?'); add(s += 3, 'Caller', sawGun ? `I've got ${gunWord.replace('a long gun — maybe a shotgun', 'a shotgun').replace('a long gun', 'a rifle')}.` : "I'm not answering that."); }
    add(s += 6, 'Dispatcher', "Sir, stay on the line with me — officers are on the way."); add(s += 2, '[Note]', 'Caller disconnected. Caller ID on the line: ' + phone + ' (registered to ' + first + ' ' + last + ').'); }
  else {
    const what = { 'domestic disturbance': `My boyfriend — he's screaming and throwing things, I got out the back. He's still in the house at ${addr}.`, 'welfare check': `I'm calling about my brother at ${addr}. He sent me a goodbye text and now he won't answer.`, 'warrant service': `There's police at my neighbor's place, ${addr}, and he slammed the door on them and he's yelling.`, 'traffic stop follow-up': `A guy just ran from a car the police pulled over and went into ${addr}.`, 'shots reported': `I heard ${shots ? 'gunshots' : 'what sounded like a gunshot'} next door, ${addr}.`, 'mental health crisis': `My son at ${addr} — he's off his medication and he says he's going to make them shoot him.` }[type];
    add(s += 4, 'Caller', what); add(s += 6, 'Dispatcher', 'Okay. Are you somewhere safe right now?'); add(s += 3, 'Caller', callerKind === 'neighbor' ? "I'm inside my house, I'm looking out the window." : "I'm in my car down the street.");
    add(s += 5, 'Dispatcher', 'Does he have any weapons?'); add(s += 3, 'Caller', sawGun ? `Yes — I saw ${gunWord}.` : "I don't know. Maybe. He used to keep guns.");
    add(s += 5, 'Dispatcher', 'Is anyone else inside?'); add(s += 3, 'Caller', r.pick(["I don't think so.", "I don't know.", 'I think he is alone.']));
    if (giveNum) { add(s += 4, 'Dispatcher', 'Do you have a phone number for him?'); add(s += 4, 'Caller', `His cell is ${phone}.`); }
    add(s += 4, 'Dispatcher', `What's his name?`); add(s += 2, 'Caller', `${first}. ${first} ${last}.`);
    add(s += 5, 'Dispatcher', 'Officers are on the way. Stay where you are and keep away from the house.'); }
  const bg = [];
  if (shots) bg.push(`${ts(Math.round(s * 0.45))} — [a loud bang in the background]`);
  bg.push(`${ts(Math.round(s * 0.2))} — [${r.pick(['dog barking', 'TV on loud', 'a car alarm', 'wind noise', 'a door slamming'])}]`);
  if (!self) bg.push(`${ts(Math.round(s * 0.7))} — [caller breathing fast, voice shaking]`);
  const arrS = s + r.int(240, 480), arrive = ts(arrS), shotS = arrS + r.int(30, 120), actS = arrS + r.int(360, 720);
  S.clock0 = (t0 + actS) % 86400; // the mission clock (0:00) starts when SWAT is activated
  const patrol = [`First units on scene at ${arrive.slice(0, 5)}. Cruisers blocked traffic at the ${S.roadblocks.map(b => (b.side === 'W' ? 'west' : 'east') + ' ' + b.kind).join(' and the ')}.`];
  patrol.push({ good: 'Patrol took up positions around the house and reports eyes on the residence.', gap: 'Patrol took up positions around the house and reports eyes on the residence.', front: 'Patrol is holding at the front of the house.', mixed: 'Patrol took up positions around the house; one officer moved in close at the front.' }[sc.variant]);
  if (sc.injury) patrol.push(`${ts(shotS).slice(0, 5)} — shots fired at arriving officers. OFFICER DOWN — condition not confirmed.`);
  else if (shots) patrol.push(`${ts(shotS).slice(0, 5)} — patrol heard ${r.chance(0.5) ? 'one shot' : 'shots'} from inside; no one hit.`);
  patrol.push(`Subject refused commands to come out. SWAT activated at ${ts(actS)} — mission clock 0:00.`);
  const known = [];
  known.push(r.pick(['Prior arrest for assault (2019).', 'No criminal history on file.', 'Two prior disturbance calls at this address.', 'Active misdemeanour warrant.', 'Recent job loss, per family.']));
  if (type === 'warrant service') known.push('Felony warrant (probation violation); he refused to open the door to the warrant team.');
  if (type === 'traffic stop follow-up') known.push('Ran from a traffic stop two blocks away; the car is registered to him.');
  S.brief = { type, time: ts(0).slice(0, 5), callAt: ts(0), arriveAt: arrive, activatedAt: ts(actS), addr, caller: callerName, self, shots, sawGun, suspect: desc, name: `${first} ${last}`,
    occupants: self ? 'Caller says he is alone. Not confirmed.' : 'Caller does not know whether anyone else is inside. Not confirmed.',
    patrol, known, officerDown: !!sc.injury, transcript: L, background: bg.sort(), phone: self || giveNum ? phone : null, giveNum, reviewed: false };
}
/** Listening to the 911 recording (from the brief or the intel menu): same transcript, same intel, applied once. */
function review911() {
  const B = S.brief; if (!B) return { ok: false }; const first = !S.intel.call911; S.intel.call911 = true; B.reviewed = true;
  if (first) { if (B.self) { log('911 review: he made the call himself — caller ID gives his cell number.', 'intel'); learnNumber('911 caller ID'); }
    else if (B.giveNum) { log(`911 review: the caller gave his cell number (${B.phone}).`, 'intel'); learnNumber('911 caller'); }
    else log('911 review: a third party called it in. No number for him on the recording.', 'intel'); S.version++; }
  return { ok: true, transcript: B.transcript, first };
}
/** Radio roll call: what each patrol officer can actually see, and which sides nobody is watching. */
function statusCheck() {
  const sw = sideWatch(), sc = S.scene; S.intel.status = S.turn + 1;
  for (const u of S.units) { if (u.kind !== 'patrol') continue; if (u.status !== 'ok') { const c = casById(u.cas); log(`Roll call: ${u.name} — ${c && c.state === 'kia' ? 'killed in action' : 'down, no longer watching'}.`, 'radio'); continue; }
    if (u.inCar) { const c = unit(u.inCar), rb = (S.roadblocks || []).find(b => b.car === c.uid && dist(c.x, c.y, b.x, b.y) <= 3); const ws = watchAt(c.x, c.y).sides;
      log(`Roll call: ${u.name} — in ${c.name}${rb ? ', holding the traffic block' : ''}${ws.size ? '; eyes on the ' + [...ws].join(' & ') : '; no view of the house'}.`, 'radio'); continue; }
    const ws = watchAt(u.x, u.y).sides; log(`Roll call: ${u.name} — ${ws.size ? 'I have the ' + [...ws].join(' and ') + ' side' + (ws.size > 1 ? 's' : '') : 'I can\u2019t see any doors or windows from here'}.`, 'radio'); }
  if (sw.gaps.length) { log(`STATUS CHECK: nobody is watching the ${sw.gaps.join(' or ')} side${sw.gaps.length > 1 ? 's' : ''} of the house!`, 'alert'); if (sc.gap0.length && sc.gapFound == null) sc.gapFound = S.turn + 1; }
  else log('STATUS CHECK: all sides of the house are watched.', 'good');
  S.version++; return sw;
}
/** End of turn: a side nobody watches gives him a way out. */
function sceneTurn() {
  const sc = S.scene, sp = S.suspect; if (!sc) return;
  const sw = sideWatch(); if (sc.gap0.length && sc.gapClosed == null && !sw.gaps.some(g => sc.gap0.includes(g))) { sc.gapClosed = S.turn; xpAct('contain', null); }
  if (!hostile() || sp.mode !== 'barricaded' || sp.walk || (S.nego && S.nego.contact) || S.turn < 2) { sc.gapTurns = 0; return; }
  const wins = S.windows.filter(w => w.room !== sp.room && !w.broken && sw.gaps.includes(watchPts().find(p => p.win === w.id).side));
  if (!wins.length) { sc.gapTurns = 0; return; }
  sc.gapTurns++; if (sc.gapTurns < SCENE_CFG.slipAfter || !S.rng.chance(SCENE_CFG.slip)) return;
  let best = null, bp = null; for (const w of wins) { const [cx, cy] = w.edges[0]; const p = findPath(sp.x, sp.y, (x, y) => x === cx && y === cy, { suspect: true, canOpen: true }); if (p && (!bp || p.length < bp.length)) { bp = p; best = w; } }
  if (!best) return; sp.mode = 'fleeing'; sp.flee = best.id; sc.slipTried = true; const side = watchPts().find(p => p.win === best.id).side;
  log(`Movement inside — sounds like he is heading for the ${side} side of the house!`, 'alert');
}
/** Debrief lines about the starting situation and how it was handled. */
function sceneDebrief() {
  const sc = S.scene, out = []; if (!sc) return out;
  let t = VARIANT_TXT[sc.variant];
  if (sc.gap0.length) t += `. Unwatched at the start: ${sc.gap0.join(', ')}` + (sc.gapFound ? ` — found by status check at ${elapsedAt(sc.gapFound - 1)}` : ' — never confirmed by a status check') + (sc.gapClosed != null ? `, closed by ${elapsedAt(sc.gapClosed)}` : ', never closed') + (sc.slipTried ? '; he tried to slip out that way' : '');
  else t += '. No gap at the start';
  out.push({ k: 'Initial conditions', v: t + '.' });
  if (sc.injury) { const c = casById(sc.injury.cas); out.push({ k: '  Officer down on arrival', v: `${sc.injury.name}: ${sc.injury.kind === 'kia' ? 'killed before SWAT arrived' : sc.injury.kind + ' — outcome: ' + (c ? sevWord(c) : 'unknown')}.` }); }
  const B = S.brief; if (B) out.push({ k: '  Call', v: `${B.type} at ${B.time}; 911 recording ${B.reviewed ? 'reviewed' : 'not reviewed'}.` });
  return out;
}

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
    let diff = 1 + (B.shots ? 0.5 : 0) + (B.officerDown ? 0.8 : 0) + (sp.weapon !== 'handgun' ? 0.4 : 0) + (S.rooms.length >= 9 ? 0.3 : 0) + (S.scene && S.scene.variant === 'gap' ? 0.2 : 0);
    diff = +clamp(diff, 1, 3).toFixed(1);
    out = { seed: S.seed, op: S.opName, type: B.type, addr: B.addr, time: B.time, shots: !!B.shots, officerDown: !!B.officerDown, sawGun: !!B.sawGun, area: S.geo.name, arch: S.house.archName, diff,
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
  updateVision(); const sp = S.suspect, sc = sp && idx(sp.x, sp.y);
  if (suspectActive() && hostile() && u.slice.cells.includes(sc)) { u.dir = Math.atan2(sp.y - u.y, sp.x - u.x); u.slice.active = false; u.slice.threat = true; popOrder(u);
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
const FORM_CFG = { gap: 0.4, lat: 0.3, stagger: 0.2, fan: 0.55 };
function formationFor(u) {
  if (!u || u.kind !== 'team' || !u.deployed || u.perch) return { kind: 'none', pts: [] };
  const n = teamOk(u).length; if (!n) return { kind: 'none', pts: [] };
  const inside = roomAt(u.x, u.y) >= 0, d = u.dir || 0, fx_ = Math.cos(d), fy_ = Math.sin(d), lx = -fy_, ly = fx_;
  const okPos = (ox, oy) => { const cx = Math.round(u.x + ox), cy = Math.round(u.y + oy); if (!inb(cx, cy) || S.block[idx(cx, cy)]) return false; if (cx === u.x && cy === u.y) return true;
    if (Math.abs(cx - u.x) + Math.abs(cy - u.y) === 1) return seeE(u.x, u.y, cx, cy) && (!inside || roomAt(cx, cy) === roomAt(u.x, u.y) || roomAt(cx, cy) >= 0 || true); return los(u.x, u.y, cx, cy) === 1; };
  const fit = (ox, oy) => { for (const t of [1, 0.75, 0.5, 0.25]) if (okPos(ox * t, oy * t)) return [+(ox * t).toFixed(2), +(oy * t).toFixed(2)]; return [0, 0]; };
  // context: at a door (a breach/pole cam order on this door, or standing next to a closed door)
  let door = null; const o = u.orders[0];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const e = edge(u.x, u.y, u.x + dx, u.y + dy); if (e.t === 'D' && (e.d.state === 'closed' || (o && o.door === e.d.id))) { door = { dx, dy, d: e.d }; break; } }
  const moving = u.moved != null && S.phase === 'executing' && S.tick - u.moved <= 1;
  const pts = []; let kind;
  if (door && !moving) { kind = 'stack'; // stack on the wall beside the door, point man at the frame, rest behind with slight offset
    const bx = -door.dx, by = -door.dy, sx = -door.dy, sy = door.dx; const side = okPos(sx * 0.5, sy * 0.5) ? 1 : -1;
    for (let i = 0; i < n; i++) pts.push(fit(door.dx * 0.18 + bx * i * FORM_CFG.gap + sx * side * (FORM_CFG.lat + (i % 2) * 0.06), door.dy * 0.18 + by * i * FORM_CFG.gap + sy * side * (FORM_CFG.lat + (i % 2) * 0.06))); }
  else if (moving || (inside && hallLike(roomAt(u.x, u.y)))) { kind = 'column'; // staggered column behind the point man
    for (let i = 0; i < n; i++) { const s = i === 0 ? 0 : (i % 2 ? 1 : -1) * FORM_CFG.stagger; pts.push(fit(fx_ * 0.2 - fx_ * i * FORM_CFG.gap + lx * s, fy_ * 0.2 - fy_ * i * FORM_CFG.gap + ly * s)); } }
  else if (inside) { kind = 'fan'; // in a room: fan out to cover sectors
    for (let i = 0; i < n; i++) { const a = d + (n === 1 ? 0 : -1.1 + 2.2 * i / (n - 1)); pts.push(fit(Math.cos(a) * FORM_CFG.fan, Math.sin(a) * FORM_CFG.fan)); } }
  else { const cv = coverAdj(u.x, u.y); kind = cv ? 'cover' : 'line'; // outside: spread along the cover edge (or a line abreast)
    let ax, ay, bx2 = 0, by2 = 0; if (cv) { const L = Math.hypot(cv.dx, cv.dy); ax = -cv.dy / L; ay = cv.dx / L; bx2 = cv.dx / L * 0.22; by2 = cv.dy / L * 0.22; } else { ax = lx; ay = ly; bx2 = -fx_ * 0.1; by2 = -fy_ * 0.1; }
    for (let i = 0; i < n; i++) { const k = (i - (n - 1) / 2) * FORM_CFG.gap * (n > 5 ? 0.85 : 1); pts.push(fit(ax * k + bx2, ay * k + by2)); } }
  return { kind, pts };
}
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

/* =====================================================================
   ORDERS — validation & planning (shared by preview and execution)
   ===================================================================== */
function moveOpts(u, assume) {
  if (u.kind === 'drone') return { fly: true, assume };
  if (u.kind === 'robot') return { canOpen: false, avoidSuspect: true, assume };
  if (u.kind === 'cruiser') return { drive: true, self: u.uid };
  if (u.kind === 'patrol') return { outdoor: true, canOpen: false, avoidSuspect: true, expo: true };
  return { canOpen: true, avoidSuspect: true, assume, expo: true };
}
function plannedBreaches() { const s = new Set(); for (const u of S.units) for (const o of u.orders) if (o.type === 'breach') s.add(o.door); return s; }
function doorSides(d) { const out = []; for (const [a, b] of d.cells) { out.push(a, b); } return out; }
function adjacentToRoomOpening(x, y, roomId, assume, u) {
  if (roomAt(x, y) === roomId) return true;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (roomAt(nx, ny) !== roomId) continue;
    const e = edge(x, y, nx, ny); if (e.t === 'W') return true;
    if (e.t === 'D' && (e.d.state !== 'closed' || (assume && assume.has(e.d.id)) || (!e.d.locked && !e.d.barricaded))) return true; }
  return false;
}
function canThrowFrom(x, y, roomId, assume, u, kind) {
  if (adjacentToRoomOpening(x, y, roomId, assume, u)) return true;
  const rm = S.rooms[roomId]; const lim = kind === 'gas' && u.equip && u.equip.lesslethal > 0 ? 11 : 4;
  for (let yy = rm.y; yy < rm.y + rm.h; yy++) for (let xx = rm.x; xx < rm.x + rm.w; xx++) if (dist(x, y, xx, yy) <= lim && los(x, y, xx, yy)) return true;
  return false;
}
function roomTargetCell(roomId, fx_, fy) { const rm = S.rooms[roomId]; let best = null, bs = 1e9; const cx = rm.x + (rm.w - 1) / 2, cy = rm.y + (rm.h - 1) / 2;
  for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) { if (S.block[idx(x, y)]) continue; const s = dist(x, y, cx, cy); if (s < bs) { bs = s; best = [x, y]; } } return best; }

function nearestDrive(u, x, y) { let best = null, bs = 1e9; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const xx = x + dx, yy = y + dy; if (!inb(xx, yy) || !S.drive[idx(xx, yy)] || carClash(xx, yy, u.uid)) continue; const s = dx * dx + dy * dy; if (s < bs) { bs = s; best = [xx, yy]; } } return best; }
function carAdjGoal(c) { const fp = footprint(c); return (x, y) => !S.dyn[idx(x, y)] && fp.some(([fx_, fy]) => cheb(fx_, fy, x, y) <= 1); }
/** Shooting position check: in range and a line of sight to the target cell. */
function shotReq(u, sx, sy, tx, ty) {
  const wk = weaponOf(u); if (!wk) return 'This unit cannot fire'; const w = WEAPONS[wk], d = dist(sx, sy, tx, ty);
  if (d > w.range) return `Out of range — ${w.short} reaches ~${w.range} m (target ${Math.round(d)} m)`;
  if (!los(sx, sy, tx, ty)) return 'No line of sight to that spot from there';
  return null;
}
/** Resolve an order from a start position → {ok, reason, path, end}. Used for preview and validation. */
function planOrder(u, o, sx, sy, assume) {
  const mo = moveOpts(u, assume);
  const path = (gx, gy) => findPath(sx, sy, (x, y) => x === gx && y === gy, mo);
  const pathAny = fn => findPath(sx, sy, fn, mo);
  switch (o.type) {
    case 'move': case 'drone': case 'robot': {
      if (o.type !== 'move') { const dmo = moveOpts({ kind: o.type }, assume); const p = findPath(sx, sy, (x, y) => x === o.x && y === o.y, dmo); if (!p) return { ok: false, reason: 'Device cannot reach that spot' }; return { ok: true, path: [], dpath: p, end: [sx, sy] }; }
      if (u.kind === 'patrol' && roomAt(o.x, o.y) >= 0) return { ok: false, reason: 'Patrol holds the perimeter — they do not enter.' };
      if (u.kind === 'cruiser') { if (!S.drive[idx(o.x, o.y)]) return { ok: false, reason: 'Cruiser cannot park there (needs open road, driveway or lawn)' }; }
      const p = path(o.x, o.y); if (!p) return { ok: false, reason: u.kind === 'cruiser' ? 'No drivable route (fences, trees or cars in the way)' : 'No route (locked/barricaded door or obstacle)' }; return { ok: true, path: p, end: p.length ? p[p.length - 1] : [sx, sy] }; }
    case 'board': { const c = unit(o.car); if (!c) return { ok: false, reason: 'No cruiser' }; const g = carAdjGoal(c); const p = g(sx, sy) ? [] : pathAny(g); if (!p) return { ok: false, reason: 'Cannot reach that cruiser' }; return { ok: true, path: p, end: [c.x, c.y] }; }
    case 'exit': return { ok: true, path: [], end: [sx, sy] };
    case 'overwatch': {
      if (o.perch !== undefined && o.perch !== null) { const pc = S.perches[o.perch]; const p = (sx === pc.entry[0] && sy === pc.entry[1]) ? [] : path(pc.entry[0], pc.entry[1]);
        if (!p) return { ok: false, reason: 'No covered route to that house' }; return { ok: true, path: p, end: [pc.x, pc.y], perch: pc }; }
      if (roomAt(o.x, o.y) >= 0) return { ok: false, reason: 'Overwatch is taken outside the target house' };
      const p = path(o.x, o.y); if (!p) return { ok: false, reason: 'No route to that vantage point' };
      if (!overwatchSees(o.x, o.y)) return { ok: false, reason: 'No sight line to any window or door from there' };
      return { ok: true, path: p, end: [o.x, o.y] }; }
    case 'shoot': { const q = shotReq(u, sx, sy, o.x, o.y); if (q) return { ok: false, reason: q }; return { ok: true, path: [], end: [sx, sy] }; }
    case 'clear': { const tc = roomTargetCell(o.room); if (!tc) return { ok: false, reason: 'Room not reachable' }; const p = path(tc[0], tc[1]);
      if (!p) return { ok: false, reason: 'No entry route — breach a door first' }; o.x = tc[0]; o.y = tc[1]; return { ok: true, path: p, end: p.length ? p[p.length - 1] : [sx, sy] }; }
    case 'detonate': { const d = S.doors[o.door]; if (!d.charge && !u.orders.some(q => q !== o && q.type === 'breach' && q.door === o.door && q.hangOnly)) return { ok: false, reason: 'No charge hung on that door' };
      const [mx, my] = doorMid(d); const warn = d.charge && dist(sx, sy, mx, my) < CHARGE_SAFE ? 'Inside the safety distance — team will be dazed' : null; return { ok: true, path: [], end: [sx, sy], warn }; }
    case 'mask': return { ok: true, path: [], end: [sx, sy] };
    case 'breach': case 'polecam': { const d = S.doors[o.door]; const sides = doorSides(d).filter(c => cellOk(c[0], c[1], { avoidSuspect: true }) && !S.block[idx(c[0], c[1])]);
      const isGoal = (x, y) => sides.some(c => c[0] === x && c[1] === y);
      const a2 = new Set(assume); a2.delete(o.door);
      const p = isGoal(sx, sy) ? [] : findPath(sx, sy, isGoal, Object.assign({}, mo, { assume: a2 }));
      if (!p) return { ok: false, reason: 'Cannot reach that door' }; const end = p.length ? p[p.length - 1] : [sx, sy]; return { ok: true, path: p, end }; }
    case 'bang': case 'gas': {
      const fn = (x, y) => roomAt(x, y) !== o.room && canThrowFrom(x, y, o.room, assume, u, o.type);
      if (canThrowFrom(sx, sy, o.room, assume, u, o.type)) return { ok: true, path: [], end: [sx, sy] };
      const p = pathAny(fn); if (!p) return { ok: false, reason: 'No opening into that room (breach a door or reach a window)' }; return { ok: true, path: p, end: p[p.length - 1] }; }
    case 'hold': return { ok: true, path: [], end: [sx, sy] };
    case 'corner': { const c = cornerAt(sx, sy, u); if (!c) return { ok: false, reason: 'No corner here — stand at a hallway corner, door frame or house corner' }; return { ok: true, path: [], end: [sx, sy], corner: { px: c.px, py: c.py, n: c.hidden.length } }; }
    case 'aid': case 'rescue': case 'evac': return planCas(u, o, sx, sy, assume);
    case 'pa': { if (!hostile()) return { ok: false, reason: 'Not needed' }; if (!paInRange(sx, sy)) return { ok: false, reason: `Out of loudspeaker range — move within ~${NEGO_CFG.pa.range} m of the house` };
      if (u.orders.some(q => q !== o && q.type === 'pa')) return { ok: false, reason: 'One PA broadcast per 30 s' };
      return { ok: true, path: [], end: [sx, sy], warn: u.kind !== 'cruiser' && expoAt(sx, sy) >= 0.3 ? 'Exposed position — he may fire at the voice' : null }; }
    case 'tphone': return planTPhone(u, o, sx, sy, assume, mo);
  }
  return { ok: false, reason: 'Unknown order' };
}
/** Start cell for planning: a patrol officer sitting in a cruiser plans from the cover-side door. */
function planStart(u) { if (u.perch) return [u.x, u.y]; if (u.kind === 'patrol' && u.inCar) { const c = unit(u.inCar); const e = c && exitCell(c, 'safe'); if (e) return e; } return [u.x, u.y]; }
/** Preview: sequential plan of all queued orders for a unit. Each step gets exposure flags for red path tint. */
function planFor(u) {
  const assume = plannedBreaches(); let [x, y] = planStart(u); const out = [];
  for (const o of u.orders) { const r = planOrder(u, o, x, y, assume);
    if (r.ok && r.path && u.kind !== 'cruiser' && u.kind !== 'drone') r.expo = r.path.map(([px, py]) => roomAt(px, py) >= 0 ? 0 : expoAt(px, py));
    out.push(Object.assign({ order: o, start: [x, y] }, r)); if (r.ok) { x = r.end[0]; y = r.end[1]; } }
  return out;
}
function orderReq(u, o) {
  if (u.kind === 'team') {
    if (!u.deployed) return 'Team is still forming at staging — tap DEPLOY in team panel';
    const e = u.equip, pending = (k) => u.orders.filter(q => q.type === k).length;
    if (o.type === 'breach') { const d = S.doors[o.door]; if (d.state !== 'closed') return 'Door is already open';
      if (o.method) { const c = breachCan(u, o.method); if (c !== true) return c; if (o.method === 'charge' && pending('breach') && u.orders.filter(q => q.type === 'breach' && q.method === 'charge').length >= (e.charge || 0)) return 'No charges left on this team'; }
      if (o.hangOnly && o.method !== 'charge') return 'Only a charge can be hung';
      if (d.charge && o.method === 'charge') return 'A charge is already hung — Detonate it'; }
    if (o.type === 'detonate') { const d = S.doors[o.door]; if (!d.charge && !u.orders.some(q => q.type === 'breach' && q.door === o.door && q.hangOnly)) return 'No charge hung on that door'; }
    if (o.type === 'bang' && pending('bang') >= (e.bang || 0)) return 'No flashbangs left on this team';
    if (o.type === 'gas' && pending('gas') >= (e.gas || 0)) return 'No CS gas on this team';
    if (o.type === 'polecam' && !(e.polecam > 0)) return 'Team has no pole camera';
    if ((o.type === 'drone' || o.type === 'robot') && !(e[o.type] > 0)) return `Team carries no ${o.type}`;
    if ((o.type === 'drone' || o.type === 'robot') && !hasSpec(u, 'tech')) return 'Needs a Tech / Robot Op on the team';
    if (o.type === 'board' || o.type === 'exit') return 'Only patrol officers ride in cruisers';
    if (o.type === 'overwatch' && !hasSpec(u, 'marksman')) return 'Overwatch needs a Marksman / Sniper on the team';
    if (o.type === 'pa' && !(e.bullhorn > 0)) return 'No bullhorn on this team (cruiser PA works too)';
    if (o.type === 'tphone') { if (!(e.tphone > 0) || pending('tphone') >= e.tphone) return 'No throw-phone on this team';
      if (o.via === 'robot' && (!(e.robot > 0) || !hasSpec(u, 'tech'))) return 'Robot delivery needs a robot and a Tech on the team'; }
    if (u.carrying && !['evac', 'rescue', 'hold'].includes(o.type) && !u.orders.some(q => q.cas === u.carrying)) return 'Carrying a casualty — Evac or Rescue first';
  } else if (u.kind === 'patrol') {
    if (!['move', 'hold', 'shoot', 'board', 'aid', 'rescue', 'evac', 'corner'].includes(o.type)) return 'Patrol officers can Move, Hold, Fire, work a corner, get in a cruiser, or help casualties';
    if (['aid', 'rescue', 'evac'].includes(o.type) && u.inCar) return 'Get out of the cruiser first';
    if (o.type === 'shoot' && u.inCar) return 'Get out of the cruiser first (select the cruiser → Exit)';
    if (o.type === 'board') { const c = unit(o.car); if (!c || c.kind !== 'cruiser') return 'Tap a cruiser'; if (u.inCar) return 'Already in a cruiser'; if (c.occ.length >= 2) return 'Cruiser is full (2 seats)'; if (c.disabled) return 'That cruiser is disabled'; }
  } else if (u.kind === 'cruiser') {
    if (!['move', 'exit', 'hold', 'pa'].includes(o.type)) return 'Cruisers can Drive, Exit, Hold or use the PA';
    if (o.type === 'pa' && !u.occ.length) return 'Nobody in the cruiser to work the PA';
    if (o.type === 'move' && !u.occ.length) return 'Nobody is in this cruiser — order a patrol officer to get in first';
    if (o.type === 'move' && u.disabled) return 'Cruiser is disabled';
    if (o.type === 'exit' && !u.occ.length && !u.orders.some(q => q.type === 'move')) return 'Cruiser is empty';
  }
  else if (!['move', 'hold'].includes(o.type)) return 'Devices can only Move';
  return null;
}
function queueOrder(uid, o) {
  if (S.phase !== 'planning') return { ok: false, reason: 'Wait for the orders to resolve' };
  const u = unit(uid); if (!u || !unitAlive(u)) return { ok: false, reason: 'Unit unavailable' };
  if (o.type === 'overwatch' && (o.perch === undefined || o.perch === null)) { const pc = perchAt(o.x, o.y); o.perch = pc ? pc.id : null; if (!pc && S.block[idx(o.x, o.y)]) return { ok: false, reason: 'No usable vantage point in that building' }; }
  const req = orderReq(u, o); if (req) return { ok: false, reason: req };
  if (o.type === 'move' && u.kind === 'cruiser') { const nd = nearestDrive(u, o.x, o.y); if (!nd) return { ok: false, reason: 'Cruiser cannot park there (needs open road, driveway or lawn)' }; o.x = nd[0]; o.y = nd[1]; }
  if (o.type === 'move' && (u.kind === 'patrol' || u.kind === 'team') && roomAt(o.x, o.y) < 0 && !o.exact) { o.req = [o.x, o.y]; const sc = snapCover(u, o.x, o.y); o.x = sc[0]; o.y = sc[1]; o.cover = sc[2]; o.snapped = sc[0] !== o.req[0] || sc[1] !== o.req[1]; if (sc[2] === 'open') log(`${u.name}: WARNING — no cover or concealment within ${COVER_CFG.snapWide} m of that spot. The position is exposed to the house.`, 'alert'); }
  const last = u.orders[u.orders.length - 1];
  const replacing = last && last.type === 'move' && o.type === 'move';
  const prev = planFor(u); let [sx, sy] = planStart(u);
  const upto = replacing ? prev.length - 1 : prev.length;
  for (let i = 0; i < upto; i++) if (prev[i].ok) { sx = prev[i].end[0]; sy = prev[i].end[1]; }
  const assume = plannedBreaches(); if (o.type === 'breach') assume.delete(o.door);
  const r = planOrder(u, o, sx, sy, assume); if (!r.ok) return r;
  if (o.type === 'hold') u.orders = u.orders.filter(q => q.type !== 'hold');
  if (o.type === 'overwatch') u.orders = u.orders.filter(q => q.type !== 'overwatch');
  if (o.type === 'shoot') { u.orders = u.orders.filter(q => q.type !== 'shoot'); o.est = hitChance(u, o.x, o.y, [sx, sy]).p; }
  if (replacing) u.orders[u.orders.length - 1] = o; else u.orders.push(o);
  S.version++; return { ok: true, snapped: o.snapped, est: o.est, at: [o.x, o.y] };
}
function undoOrder(uid) { const u = unit(uid); if (u && u.orders.length && S.phase === 'planning') { u.orders.pop(); S.version++; } }
function clearOrders(uid) { const u = unit(uid); if (u && S.phase === 'planning') { u.orders = []; S.version++; } }
function setStance(uid, st) { const u = unit(uid); if (!u || !STANCES[st]) return { ok: false }; u.stance = st; S.version++; return { ok: true }; }

/* =====================================================================
   BALLISTICS — officer → suspect hit chance (also drives the UI readout)
   base(weapon) × range falloff × concealment × barricade × skill × movement
   ===================================================================== */
function winCellSet() { if (S._winCells) return S._winCells; const s = new Set(); for (const w of S.windows) for (const e of w.edges) s.add(idx(e[0], e[1])); return (S._winCells = s); }
function hitChance(u, tx, ty, from, opt) {
  const wk = weaponOf(u); if (!wk) return { p: 0, why: 'no weapon', parts: [] };
  const w = WEAPONS[wk], [sx, sy] = from || [u.x, u.y], d = dist(sx, sy, tx, ty), notes = [w.short], parts = [];
  if (d > w.range) return { p: 0, why: 'out of range', weapon: w.short, d: Math.round(d), parts };
  const l = los(sx, sy, tx, ty); if (!l) return { p: 0, why: 'no line of sight', weapon: w.short, d: Math.round(d), parts };
  const add = (k, v, t) => { parts.push({ k, v: +v.toFixed(2), t }); return v; };
  let p = add('base', w.base, w.name);
  p *= add('range', 1 - 0.55 * d / w.range, Math.round(d) + ' m of ' + w.range);
  const sp = S.suspect, inside = roomAt(tx, ty) >= 0, atWin = winCellSet().has(idx(tx, ty));
  let cm, ct; if (!inside) { cm = 1.4; ct = 'in the open'; } else if (atWin) { cm = wk === 'sniper' ? 1.25 : 1.0; ct = 'at window (frame + glass)'; } else if (l === 2) { cm = 0.45; ct = 'deep in room behind glass'; } else { cm = 0.6; ct = 'through doorway / walls'; }
  if (inside && S.doors.some(dd => dd.barricaded && dd.rooms.includes(roomAt(tx, ty)))) { cm *= 0.85; ct += ', barricade'; }
  p *= add('cover', cm, ct); notes.push(ct);
  const seen = (sp && sp.visible && sp.x === tx && sp.y === ty) || (opt && opt.flash); const vis_ = sp && sp.visible && sp.x === tx && sp.y === ty; p *= add('visual', vis_ ? 1 : seen ? 0.6 : 0.3, vis_ ? 'suspect in sight' : seen ? 'muzzle flash only (snap shot)' : 'no visual (blind fire)');
  if (opt && opt.flash) p *= add('snap', u.kind === 'patrol' ? 0.55 : 0.8, u.kind === 'patrol' ? 'patrol snap return fire' : 'snap return fire');
  p *= add('skill', 0.55 + skillOf(u) - (u.kind === 'patrol' && u.panic > 0 ? 0.15 : 0), u.kind === 'patrol' ? 'patrol' : 'SWAT');
  let spot = null; if (wk === 'sniper') { spot = spotterOf(u); p *= add('spotter', spot ? spot.mult : 1, spot ? spot.name + ' — ' + spot.label : 'no spotter'); if (u.perch || (opt && opt.perched)) p *= add('steady', 1.1, 'set up on overwatch'); }
  const ia = impairAcc(u); if (ia !== 1) p *= add('impair', ia, (u.impair > 0.05 ? 'gas-impaired' : '') + (masked(u) ? (u.impair > 0.05 ? ', ' : '') + 'gas mask' : ''));
  const gz = gasAt(tx, ty); if (gz > 0.15) p *= add('haze', 1 - Math.min(0.3, gz * 0.3), 'CS haze around target');
  const cap = wk === 'sniper' ? 0.72 : 0.55; p = clamp(p, 0, cap);
  return { p: +p.toFixed(3), weapon: w.short, d: Math.round(d), notes, parts, spotter: spot, cap };
}

/* ---------- command-level (intel) actions: one per turn ---------- */
const COMMANDS = {
  interview: { name: 'Neighbor Interview', desc: 'Patrol talks to the neighbor: layout of public rooms, occupant info.', avail: () => !S.intel.interview || 'Already done' },
  blueprint: { name: 'Pull Blueprints', desc: 'County permit records: full floor plan arrives in about 1 min.', avail: () => !S.intel.blueprint || 'Already requested' },
  flyby:     { name: 'Drone Flyby', desc: 'Thermal pass over the roof: rooms with windows + heat signature.', avail: () => !S.officers.some(o => o.spec === 'tech' && o.status !== 'enroute') ? 'Needs Tech on scene' : S.armory.drone < 1 ? 'Drone not in armory' : S.turn < S.intel.flybyReady ? 'Battery recharging' : true },
  call911:   { name: 'Review 911 Call', desc: 'Listen to the original 911 call (same recording as in the mission brief). Caller ID or the caller may give his cell number. Instant.', avail: () => true, instant: true },
  status:    { name: 'Perimeter Status Check', desc: 'Radio roll call: each patrol officer reports which sides of the house he can actually see. Reveals any gap in containment.', avail: () => true, instant: true },
  family:    { name: 'Family Interview', desc: 'His sister has reached the command post: likely his number and how he reacts under pressure.', avail: () => S.intel.family ? 'Already done' : S.turn < NEGO_CFG.familyTurn ? `Family arrive at ${elapsedAt(NEGO_CFG.familyTurn)}` : true },
};
function setCommand(key) { if (S.phase !== 'planning') return { ok: false, reason: 'Busy' }; if (key === null) { S.cmd = null; S.version++; return { ok: true }; }
  const a = COMMANDS[key].avail(); if (a !== true) return { ok: false, reason: a }; if (COMMANDS[key].instant) { runCommand(key); S.version++; return { ok: true, instant: true }; } S.cmd = key; S.version++; return { ok: true }; }
function runCommand(key) {
  const sp = S.suspect, r = S.rng;
  switch (key) {
    case 'interview': { S.intel.interview = true; S.intel.floors = true; S.intel.threat = 1; S.intel.weapon = true;
      S.rooms.filter(q => ['living', 'kitchen', 'dining', 'garage'].includes(q.type)).forEach(q => q.known = true);
      const srm = S.rooms[sp.room]; const side = (srm.y + srm.h / 2 < S.house.oy + S.house.H / 2 ? 'back' : 'front') + (srm.x + srm.w / 2 < (S.house.x0 + S.house.x1) / 2 ? '-left' : '-right');
      log(`Neighbor: "It's a single-storey ${S.house.archName.split(' ·')[0].toLowerCase()}, ${S.rooms.filter(q => q.type === 'bed').length} bedrooms. He has a ${SUSPECT_WEAPONS[sp.weapon].name} — I saw him at a ${side} window."`, 'intel');
      if (r.chance(NEGO_CFG.number.interview)) learnNumber('neighbor'); break; }
    case 'blueprint': S.intel.blueprint = S.turn + 2; log('Records desk: blueprints requested, ETA 1 min.', 'intel'); break;
    case 'flyby': { S.intel.flybyReady = S.turn + 3; S.rooms.forEach(q => { if (S.windows.some(w => w.room === q.id)) q.known = true; });
      sp.heat = { room: sp.room, x: sp.x, y: sp.y, turn: S.turn }; S.intel.threat = Math.max(S.intel.threat, 1); S.intel.located = true;
      log(`Drone flyby: thermal signature in the ${S.rooms[sp.room].name}. Window rooms mapped.`, 'intel'); fx('flyby', S.house.x0, S.house.y0); break; }
    case 'call911': review911(); break;
    case 'status': statusCheck(); break;
    case 'family': { S.intel.family = true; const T = NEGO_CFG.temper[S.nego.temper]; S.nego.read = T.hint; log(`Family interview: "${T.hint}"`, 'intel');
      if (r.chance(NEGO_CFG.number.family)) learnNumber('family'); else log('Family interview: his sister does not have his current number.', 'intel'); break; }
  }
}
function surrender(msg) { const sp = S.suspect; sp.mode = 'surrendered'; sp.stun = 0; log(msg, 'good');
  S.doors.forEach(d => { if (d.rooms.includes(sp.room)) { d.barricaded = false; d.locked = false; } if (d.name === 'Front Door') d.locked = false; }); log('He has pulled the barricade. Doors unlocked — move in and secure him.', 'good'); }
function aggressive(n) { const sp = S.suspect; sp.agit = clamp(sp.agit + n, 0, 100); if (sp.talk > 0) sp.talk = Math.max(0, sp.talk - 25);
  if (S.nego && S.nego.contact && n >= 10 && S.rng.chance(0.5)) { S.nego.contact = null; S.nego.quiet = 1; negHist('Tactical action — he has cut off contact with the negotiator.', 'alert'); } }

/* =====================================================================
   TURN RESOLUTION — everything happens on ticks of an executed turn
   ===================================================================== */
function execute() {
  if (S.phase !== 'planning') return false;
  S.phase = 'executing'; S.tick = 0; S.version++;
  log(`— TURN ${S.turn + 1}: EXECUTE —`, 'system');
  if (S.cmd) { runCommand(S.cmd); S.cmd = null; }
  if (S.nego.pick) runTalk();
  if (S.units.some(u => u.kind === 'team' && unitAlive(u) && u.orders.some(o => o.type === 'gas'))) donMasks('CS gas going in');
  computeExpo();
  // officers left standing in a line of fire with nothing to do get behind something
  if (hostile()) for (const u of S.units) if (onFoot(u) && !u.orders.length && roomAt(u.x, u.y) < 0 && expoAt(u.x, u.y) >= 0.6) seekCover(u, 'exposed to the house windows');
  updateVision(); return true;
}
function stepTick() {
  if (S.phase !== 'executing') return true;
  S.tick++; S.tickLog = {};
  for (const u of S.units.slice()) { if (!unitAlive(u)) continue;
    if (S.gasEver) gasExpose(u);
    if (u.stun > 0) { u.stun--; continue; }
    if (u.kind === 'team' && u.mask === 'donning') { u.mask = 'on'; log(`${u.name}: masks on.`, 'radio'); continue; }
    unitAct(u); }
  casualtyTick();
  if (S.gasEver) suspectGas();
  rebuildDyn(); computeExpo();
  updateVision(); suspectTick(); officersFire(); teamResponses(); updateVision(); checkEnd();
  if (S.phase === 'over') return true;
  if (S.tick >= TICKS) { endTurn(); return true; }
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
    if (e.t === 'D' && e.d.state === 'closed') { e.d.state = 'open'; e.d.known = true; faceTo(u, nx, ny); noise(nx, ny, 2, 'door'); log(`${u.name}: opening ${e.d.name || 'door'}.`); return false; }
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
  if (!c.occ.length) { failOrders(c, 'no driver'); return; }
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
  if (u.kind === 'patrol' && u.inCar) { const o = u.orders[0]; if (o && o.type === 'move') { const c = unit(u.inCar); if (c && houseSideOf(c) === 'driver' && c.occ[0] === u.uid && !o.slid) { o.slid = true; log(`${u.name}: sliding across to the far-side door…`); return; } exitCar(u, 'safe'); } return; }
  if ((u.kind === 'team' || u.kind === 'patrol' && !u.inCar) && u.detain && suspectActive()) { const sp = S.suspect;
    stepAlong(u, null, (x, y) => cheb(x, y, sp.x, sp.y) <= 1 && !(x === sp.x && y === sp.y)); return; }
  const o = u.orders[0]; if (!o) return;
  if (u.kind === 'cruiser') {
    if (o.type === 'move') return driveCar(u, o);
    if (o.type === 'exit') { const hs = houseSideOf(u);
      if (o.side === 'safe' && hs === 'driver' && !o.slid && u.occ.length) { o.slid = true; log(`${u.name}: crew sliding across to the far-side doors…`); return; }
      for (const id of u.occ.slice()) exitCar(unit(id), o.side); popOrder(u); return; }
    if (o.type === 'hold') return;
    if (o.type === 'pa') { popOrder(u); paAct(u, o); return; }
    return;
  }
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
  if (o.type === 'move' || o.type === 'clear') {
    const r = stepAlong(u, o, (x, y) => x === o.x && y === o.y, speed);
    if (r === null) failOrders(u, 'route blocked'); else if (r) { popOrder(u); if (o.type === 'clear') { const rm = S.rooms[o.room];
      if (!(S.suspect.room === o.room && suspectActive())) { log(`${u.name}: ${rm.name} CLEAR.`, 'good'); xpAct('clear', u, rm.name); fx('text', u.x, u.y, { text: 'CLEAR', color: '#3ef0a0' }); } } }
    return;
  }
  if (o.type === 'board') { const c = unit(o.car); if (!c || c.occ.length >= 2) { failOrders(u, 'cruiser full'); return; }
    const g = carAdjGoal(c); if (!g(u.x, u.y)) { const r = stepAlong(u, o, g, speed); if (r === null) failOrders(u, 'cannot reach the cruiser'); if (!r) return; }
    boardCar(u, c); log(`${u.name}: in ${c.name}.`); return; }
  if (o.type === 'shoot') { if (!u.perch || !u.perch.entry) faceTo(u, o.x, o.y); else u.dir = Math.atan2(o.y - u.y, o.x - u.x); u.holding = true; const every = o.mode === 'suppress' ? 2 : 3; if (S.tick % every === 1) fireAt(u, o.x, o.y, o.mode); return; }
  if (o.type === 'aid' || o.type === 'rescue' || o.type === 'evac') return casAct(u, o, speed);
  if (o.type === 'pa') { popOrder(u); paAct(u, o); return; }
  if (o.type === 'tphone') return tphoneAct(u, o, speed);
  if (o.type === 'mask') { u.mask = o.on ? 'on' : 'off'; log(`${u.name}: masks ${o.on ? 'on' : 'off'}.`, 'radio'); popOrder(u); return; }
  if (o.type === 'hold') { if (o.x !== undefined) faceTo(u, o.x, o.y); u.holding = true; return; }
  if (o.type === 'drone' || o.type === 'robot') { u.equip[o.type]--; const d = { uid: 'D' + (++S.devSeq), kind: o.type, name: (o.type === 'drone' ? 'Drone ' : 'Robot ') + S.devSeq, num: S.devSeq,
      x: u.x, y: u.y, dir: u.dir, orders: [{ type: 'move', x: o.x, y: o.y }], battery: o.type === 'drone' ? 6 : 10, owner: u.uid, status: 'ok', vis: [] };
    S.units.push(d); log(`${u.name}: ${d.name} deployed.`, 'radio'); popOrder(u); return; }
  if (o.type === 'detonate' && S.doors[o.door].charge) { detonateCharge(u, S.doors[o.door]); popOrder(u); return; }
  if (o.type === 'breach' && o.phase === 'standoff') { const d = S.doors[o.door];
    if (!d.charge || d.state !== 'closed') { popOrder(u); return; }
    if (!o.so) o.so = standoffGoal(u, d) || [u.x, u.y];
    if (u.x !== o.so[0] || u.y !== o.so[1]) { const r = stepAlong(u, o, (x, y) => x === o.so[0] && y === o.so[1], roomAt(u.x, u.y) < 0 ? 2 : 1); if (r === null) o.so = [u.x, u.y]; if (!r) return; }
    if (o.hangOnly) { log(`${u.name}: at the safe standoff — charge on ${d.name} ready. Awaiting Detonate.`, 'radio'); popOrder(u); return; }
    log(`${u.name}: standing off — "Breaching, breaching, breaching!"`, 'radio'); detonateCharge(u, d); popOrder(u); return; }
  if (o.type === 'breach' || o.type === 'polecam' || o.type === 'detonate') {
    const d = S.doors[o.door]; const sides = doorSides(d);
    const goal = (x, y) => sides.some(c => c[0] === x && c[1] === y);
    if (!goal(u.x, u.y)) { const r = stepAlong(u, o, goal, speed); if (r === null) failOrders(u, 'cannot reach door'); return; }
    const other = (() => { for (const [a, b] of d.cells) { if (a[0] === u.x && a[1] === u.y) return b; if (b[0] === u.x && b[1] === u.y) return a; } return d.cells[0][1]; })();
    faceTo(u, other[0], other[1]);
    if (o.type === 'polecam') { const rr = roomAt(other[0], other[1]); if (rr >= 0) { const rm = S.rooms[rr]; for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) S.peek.push(idx(x, y)); }
      log(`${u.name}: pole cam under the door — ${rr >= 0 ? S.rooms[rr].name : 'outside'} ${S.suspect.room === rr && suspectActive() ? 'has the SUSPECT' : 'looks empty'}.`, S.suspect.room === rr ? 'alert' : 'intel'); popOrder(u); return; }
    if (o.type === 'detonate') { if (!d.charge) { popOrder(u); return; } detonateCharge(u, d); popOrder(u); return; }
    if (d.state !== 'closed') { if (d.charge) d.charge = null; popOrder(u); return; }
    breachTick(u, o, d, other); return;
  }
  if (o.type === 'bang' || o.type === 'gas') {
    if (!canThrowFrom(u.x, u.y, o.room, null, u, o.type)) { const r = stepAlong(u, o, (x, y) => roomAt(x, y) !== o.room && canThrowFrom(x, y, o.room, null, u, o.type), speed); if (r === null) failOrders(u, 'no opening into room'); return; }
    // open/break into room if needed
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = u.x + dx, ny = u.y + dy; if (roomAt(nx, ny) !== o.room) continue; const e = edge(u.x, u.y, nx, ny);
      if (e.t === 'D' && e.d.state === 'closed' && !e.d.locked && !e.d.barricaded) { e.d.state = 'open'; break; } if (e.t === 'W' && !e.w.broken && !canSeeRoom(u, o.room)) { e.w.broken = true; noise(nx, ny, 6, 'glass'); break; } }
    const rm = S.rooms[o.room]; const tc = roomTargetCell(o.room);
    faceTo(u, tc[0], tc[1]); u.equip[o.type]--; popOrder(u);
    if (o.type === 'bang') { fx('flash', tc[0], tc[1], { fromX: u.x, fromY: u.y }); log(`${u.name}: BANG OUT — flashbang into ${rm.known ? rm.name : 'room'}.`, 'radio'); noise(tc[0], tc[1], 10, 'bang');
      if (S.suspect.room === o.room && hostile()) { S.suspect.stun = 5; S.suspect.ambush = false; xpAct('bang', u); log('Suspect disoriented by flashbang.', 'good'); } aggressive(10); }
    else { gasDeploy(o.room); fx('gas', tc[0], tc[1], { room: o.room, fromX: u.x, fromY: u.y }); log(`${u.name}: CS gas deployed into ${rm.known ? rm.name : 'room'}.`, 'radio'); aggressive(15); }
    return;
  }
}
function canSeeRoom(u, roomId) { return u.vis && u.vis.some(c => S.room[c] === roomId); }
function doBreach(u, d, how) {
  d.state = 'breached'; d.known = true; d.barricaded = false; d.locked = false; S.stats.breaches++;
  const c = d.cells[Math.floor(d.cells.length / 2)]; const mx = (c[0][0] + c[1][0]) / 2, my = (c[0][1] + c[1][1]) / 2;
  fx('breach', mx, my, { how }); fx('text', mx, my, { text: 'BREACH', color: '#ffb020' });
  xpAct('breach', u, d.name); log(`${u.name}: ${d.name} BREACHED (${BREACH[how] ? BREACH[how].name.toLowerCase() : how}).`, 'radio'); d.method = how;
  noise(mx, my, how === 'charge' ? 18 : 14, 'breach'); aggressive(how === 'charge' ? 25 : 20);
  const sp = S.suspect; if (false) { sp.stun = Math.max(sp.stun, 2); log('Suspect stunned by the blast.', 'good'); }
}
function noise(x, y, loud, kind) {
  const sp = S.suspect; if (!hostile()) return; const d = dist(sp.x, sp.y, x, y);
  if (d > loud) return;
  if (sp.mode === 'barricaded') { sp.mode = 'alert'; log('Suspect is alerted — movement heard inside.', 'alert'); }
  sp.agit = clamp(sp.agit + (kind === 'breach' ? 12 : 4), 0, 100);
  const ownDoor = S.doors.some(dd => dd.rooms.includes(sp.room) && dd.cells.some(([a, b]) => dist(a[0], a[1], x, y) < 1.6 || dist(b[0], b[1], x, y) < 1.6));
  if ((kind === 'breach' || kind === 'ram' || kind === 'door') && ownDoor && sp.stun === 0) { sp.ambush = true; sp.dir = Math.atan2(y - sp.y, x - sp.x); }
}

/* =====================================================================
   COMBAT — suspect fire, officer fire, return fire
   ===================================================================== */
function shooters() { return S.units.filter(u => unitAlive(u) && (onFoot(u) || u.kind === 'drone' || u.kind === 'robot' || (u.kind === 'cruiser' && u.occ.length))); }
function suspectWindowCells() { const sp = S.suspect; const out = []; for (const w of S.windows) if (w.room === sp.room) for (const e of w.edges) if (!S.block[idx(e[0], e[1])]) out.push([e[0], e[1]]); return out; }
/** Classify a target from a firing point: open / concealed (hedge, fence — hidden, not protected) / covered (hard cover) / car / perched. */
function targetClass(u, px, py) {
  if (u.kind === 'cruiser') return 'car';
  if (sliceExposed(u, px, py) && los(px, py, u.x, u.y) !== 1) return 'slice';
  if (u.perch && u.perch.entry) return 'perched';
  if (roomAt(u.x, u.y) >= 0) return 'open';
  if (u.exiting && S.tick - u.exiting <= 1) return 'open';
  const l = losEx(px, py, u.x, u.y, true); return l.cov === 2 ? 'covered' : l.cov === 1 ? 'concealed' : 'open';
}
const T_PRIO = { slice: 1.2, open: 3, car: 2, concealed: 1.3, covered: 1, perched: 0.6 };
const T_TRY = { slice: 0.85 * 0.6, open: 0.85, car: 0.6, concealed: 0.3, covered: 0.25, perched: 0.15 }; // concealment: he can barely see you, so he fires less
const T_HIT = { slice: 0.4, open: 1, concealed: 0.85, covered: 0.2, perched: 0.12 }; // …but rounds go through a hedge; hard cover stops them
function suspectTick() {
  const sp = S.suspect; if (!suspectActive()) return;
  if (sp.stun > 0) { sp.stun--; return; }
  if (sp.cd > 0) sp.cd--;
  if (sp.mode === 'fleeing') { fleeStep(); if (!suspectActive()) return; }
  if (sp.mode === 'surrendered' && sp.walk) { walkoutTick(); return; }
  if (!hostile()) return;
  if (sp.retreat) { retreatStep(); if (sp.room < 0 || sp.cd > 0 || !S.rng.chance(0.35)) return; }
  const R = SUSPECT_WEAPONS[sp.weapon].range;
  const backHome = () => { if (sp.x === sp.home.x && sp.y === sp.home.y) return; const p = findPath(sp.x, sp.y, (x, y) => x === sp.home.x && y === sp.home.y, { suspect: true }); if (p && p.length) { sp.x = p[0][0]; sp.y = p[0][1]; } sp.atWindow = winCellSet().has(idx(sp.x, sp.y)); };
  if (sp.suppressed > 0) { sp.suppressed--; backHome(); return; }
  if (sp.duck > 0) { sp.duck--; backHome(); return; }
  if (roomAt(sp.home.x, sp.home.y) !== sp.room && sp.room >= 0) { backHome(); sp.room = roomAt(sp.x, sp.y); return; } // relocating (e.g. away from gas)
  // best (position, target) pair: his current cell or a window of his room
  const spots = [[sp.x, sp.y]].concat(sp.room >= 0 ? suspectWindowCells() : []);
  let best = null;
  for (const u of shooters()) { for (const [px, py] of spots) { const d = dist(px, py, u.x, u.y); if (d > R) continue; const l = los(px, py, u.x, u.y) || (sliceExposed(u, px, py) ? 1 : 0); if (!l) continue; // a pie-slicing officer is partly exposed where his slice reaches
      const cls = targetClass(u, px, py); const indoorTeam = u.kind === 'team' && roomAt(u.x, u.y) >= 0;
      const s = T_PRIO[cls] - d / 40 - (px !== sp.x || py !== sp.y ? 0.35 : 0) + (indoorTeam ? 1.5 : 0) + (u.kind === 'drone' || u.kind === 'robot' ? -0.8 : 0);
      if (!best || s > best.s) best = { u, px, py, d, l, cls, s }; } }
  if (!best) { if (sp.mode === 'alert' && !sp.atWindow && S.rng.chance(0.15) && spots.length > 1) { /* peeks */ } return; }
  if (best.px !== sp.x || best.py !== sp.y) { // reposition toward the window first
    const p = findPath(sp.x, sp.y, (x, y) => x === best.px && y === best.py, { suspect: true }); if (p && p.length) { sp.x = p[0][0]; sp.y = p[0][1]; sp.atWindow = winCellSet().has(idx(sp.x, sp.y)); } return; }
  if (sp.cd > 0) return;
  let tryP = T_TRY[best.cls] * (sp.mode === 'barricaded' ? 0.55 : 1) * (0.6 + sp.agit / 125) * (sp.ambush ? 1.3 : 1) * (1 - 0.5 * (sp.impair || 0)) * (contactLive() && !sp.ambush ? NEGO_CFG.talkingFire : 1);
  if (best.u.kind === 'team' && roomAt(best.u.x, best.u.y) >= 0) tryP = Math.max(tryP, sp.ambush ? 0.9 : 0.7);
  if (!S.rng.chance(clamp(tryP, 0, 0.95))) return;
  suspectFire(best);
}
function suspectFire(b) {
  const sp = S.suspect, T = b.u, sw = SUSPECT_WEAPONS[sp.weapon]; if (sp.mode === 'barricaded') sp.mode = 'alert';
  sp.dir = Math.atan2(T.y - sp.y, T.x - sp.x); S.stats.shots++; sp.cd = 2 + S.rng.int(0, 1);
  fx('muzzle', sp.x, sp.y, { suspect: true }); fx('shot', sp.x, sp.y, { tx: T.x, ty: T.y });
  sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn }; S.intel.located = true; S.intel.threat = 1;
  const where = sp.room >= 0 ? (sp.atWindow ? `${S.rooms[sp.room].name} window` : S.rooms[sp.room].name) : 'yard';
  let p = sw.base * (1 - 0.6 * b.d / sw.range) * (b.l === 2 ? 0.85 : 1) * (sp.ambush ? 1.3 : 1) * (1 - 0.6 * (sp.impair || 0)) * (b.u.impair ? 1.15 : 1);
  if (T.kind === 'cruiser' && T.armored) { T.hits++; fx('impact', T.x, T.y, { car: T.uid }); log(`SHOTS FIRED from the ${where} — rounds stop against the armored ${T.name}. Crew unhurt.`, 'alert'); returnFire(); return; }
  if (T.kind === 'cruiser') { // through the car body — windshield is the weak spot
    const v = Math.atan2(sp.y - T.y, sp.x - T.x), c = Math.abs(Math.cos(v - T.dir)), glass = c > 0.7;
    p *= (glass ? 0.55 : 0.3) * (T.moved === S.tick ? 0.75 : 1); p = clamp(p, 0.02, 0.45);
    T.hits++; T.marks.push({ dx: S.rng() * 2 - 1, dy: S.rng() * 0.6 - 0.3, t: S.turn }); fx('impact', T.x, T.y, { car: T.uid });
    if (S.rng.chance(p) && T.occ.length) { const drv = unit(T.occ[0]); T.occ.shift(); drv.inCar = null; const ec = exitCell(T, 'safe') || [T.x, T.y]; drv.x = ec[0]; drv.y = ec[1]; officerDown(drv, `${T.name} driver down — ${drv.name} hit through the ${glass ? 'windshield' : 'door'}.`); T.orders = []; }
    else log(`SHOTS FIRED from the ${where} — rounds strike ${T.name}${glass ? ' (windshield)' : ''}. Crew unhurt.`, 'alert');
    returnFire(); return;
  }
  if (T.kind === 'drone' || T.kind === 'robot') { if (S.rng.chance(0.45)) { T.status = 'down'; T.orders = []; log(`Shots fired — ${T.name} disabled.`, 'bad'); } else log(`Shots fired at ${T.name} — missed.`, 'alert'); return; }
  p *= b.cls === 'slice' ? sliceHit(T) : T_HIT[b.cls] || 1; if (T.moved === S.tick) p *= 0.8;
  if (T.kind === 'team') { p *= 1 - teamSkill(T) * 0.25; if (T.equip.shield > 0 && roomAt(T.x, T.y) >= 0) p *= 0.65; if (T.carrying && T.equip.shield > 0) p *= CAS_CFG.carryShield; if (hasSpec(T, 'point')) p *= 0.95; }
  p = clamp(p, 0.01, 0.55);
  if (S.rng.chance(p)) officerDown(T);
  else { log(`SHOTS FIRED from the ${where} at ${T.name} (${b.cls === 'perched' ? 'on overwatch' : b.cls === 'open' ? 'in the open' : b.cls + ' cover'}) — no hits.`, 'alert');
    if (onFoot(T) && roomAt(T.x, T.y) < 0 && !T.perch && expoAt(T.x, T.y) >= 0.15) { if (T.kind === 'patrol') T.panic += 0.2; seekCover(T, 'under fire'); } }
  if (S.rng.chance(0.45)) sp.duck = 1;
  returnFire();
}
/** Officers in weapon range with a sight line shoot back at the muzzle flash. */
function returnFire() {
  const sp = S.suspect, who = [];
  for (const u of S.units) { if (!unitAlive(u) || !onFoot(u) || u.stance === 'hold' || !hostile()) continue; const wk = weaponOf(u); if (!wk) continue;
    if (u.orders[0] && u.orders[0].type === 'shoot') continue; if (dist(u.x, u.y, sp.x, sp.y) > WEAPONS[wk].range || !los(u.x, u.y, sp.x, sp.y)) continue;
    if (who.length >= 2) break; /* only the nearest couple of officers get a snap shot at the flash */
    who.push(u); if (fireAt(u, sp.x, sp.y, 'fire', true) === 'hit') return; }
  if (who.length) { log(`Return fire: ${who.map(u => u.name).join(', ')} — no hits.`, 'radio'); if (who.length >= 2) sp.suppressed = Math.max(sp.suppressed, 1); }
}
/** One officer volley at a cell. Returns 'hit' | 'miss' | 'empty'. */
function fireAt(u, tx, ty, mode, isReturn) {
  const sp = S.suspect; fx('muzzle', u.x, u.y, { friendly: true }); fx('shot', u.x, u.y, { tx, ty, friendly: true }); S.stats.ofShots = (S.stats.ofShots || 0) + 1;
  faceTo(u, tx, ty); if (!isReturn) aggressive(mode === 'suppress' ? 3 : 5); noise(tx, ty, 8, 'shot');
  if (!hostile()) return 'empty';
  const near = (sp.room >= 0 && roomAt(tx, ty) === sp.room) || dist(sp.x, sp.y, tx, ty) <= 1.5;
  if (!near || !los(u.x, u.y, sp.x, sp.y)) { if (!isReturn) log(`${u.name}: ${mode === 'suppress' ? 'suppressing fire' : 'rounds'} on target — no contact.`); return 'empty'; }
  let p = hitChance(u, sp.x, sp.y, null, { flash: isReturn }).p; if (mode === 'suppress') { p *= 0.5; sp.suppressed = Math.max(sp.suppressed, 2); }
  if (S.rng.chance(p)) { suspectHit(u); return 'hit'; }
  if (!isReturn) log(`${u.name}: ${mode === 'suppress' ? 'suppressing fire — suspect pinned down' : 'shot missed'}.`, 'radio');
  return 'miss';
}
function suspectHit(u) { const sp = S.suspect; sp.stun = 0; sp.downBy = 'fire'; fx('hitflash', sp.x, sp.y);
  const prev = S.cas.find(c => c.who === 'suspect' && casActive(c));
  const c = prev ? (prev.state = 'immobile', prev.crit = Math.min(prev.crit, S.rng.int(2, 4)), prev) : addCasualty('suspect', 'S', 'Suspect', sp.x, sp.y, { kia: CAS_CFG.suspectKia, mobile: CAS_CFG.suspectMobile, by: u.uid });
  c.x = sp.x; c.y = sp.y; c.seen = true; c.known = true;
  if (c.state === 'mobile') { sp.impair = Math.max(sp.impair || 0, 0.45); sp.duck = 2; sp.injured = true; aggressive(6);
    fx('text', sp.x, sp.y, { text: 'SUSPECT HIT', color: '#ffb020' }); log(`${u.name}: suspect HIT — he is still moving and still armed. Injured.`, 'alert'); return; }
  sp.mode = 'incapacitated'; sp.walk = null; S.stats.method = 'Officer fire'; sp.injured = true;
  if (c.state === 'kia') { sp.deceased = true; fx('text', sp.x, sp.y, { text: 'SUSPECT DOWN', color: '#c9ced6' }); log(`${u.name}: suspect hit — he is not moving. Move in and secure the scene.`, 'good'); return; }
  fx('text', sp.x, sp.y, { text: 'SUSPECT DOWN', color: '#ffb020' }); log(`${u.name}: suspect HIT — immobile, weapon out of reach. Move in, secure him, get EMS.`, 'good'); }
/** Stance 'free': fire at a visible suspect every 3rd tick. */
function officersFire() {
  const sp = S.suspect; if (!hostile() || !sp.visible || S.tick % 3 !== 0) return;
  for (const u of S.units) { if (!onFoot(u) || u.stance !== 'free' || (u.orders[0] && u.orders[0].type === 'shoot')) continue; const wk = weaponOf(u); if (!wk) continue;
    if (dist(u.x, u.y, sp.x, sp.y) > WEAPONS[wk].range || !los(u.x, u.y, sp.x, sp.y)) continue; if (fireAt(u, sp.x, sp.y, 'fire') === 'hit') return; }
}
/** An officer is hit: becomes a casualty (KIA / injured-mobile / immobile). stats.down counts officers out of the fight unless a medic stabilised them on the spot. */
function officerDown(u, msg, ctx) {
  fx('down', u.x, u.y);
  if (u.kind === 'patrol') { u.status = 'down'; u.orders = []; u.carrying && dropCas(u, casById(u.carrying)); u.inCar = null; S.stats.down++;
    const c = addCasualty('patrol', u.uid, u.name, u.x, u.y, {}); u.cas = c.id; S.downList.push({ x: c.x, y: c.y, name: u.name, cas: c.id });
    log(msg ? `${msg} ${casTail(c)}` : `OFFICER DOWN — ${casReport(c, 'patrol')}`, 'bad'); return c; }
  const ok = teamOk(u); if (!ok.length) return; const prio = ok.find(o => o.spec === 'point') || S.rng.pick(ok);
  prio.status = 'down';
  const c = addCasualty('officer', prio.id, prio.name, u.x, u.y, { team: u.uid, witness: true }); prio.cas = c.id;
  if (u.carrying) dropCas(u, casById(u.carrying));
  const med = teamOk(u).length && hasSpec(u, 'medic');
  if (med && casActive(c)) applyAid(u, c, true);
  if (c.stable) { prio.stable = true; log(`OFFICER DOWN — ${prio.name} (${u.name}) hit. Medic stabilised on the spot — needs extraction.`, 'bad'); }
  else { S.stats.down++; log(`OFFICER DOWN — ${casReport(c, u.name)}`, 'bad'); }
  S.downList.push({ x: c.x, y: c.y, name: prio.name, cas: c.id });
  if (!teamOk(u).length) { u.status = 'down'; u.orders = []; log(`${u.name} is out of action.`, 'bad'); }
  return c;
}

function startFlee() {
  const sp = S.suspect; const wins = S.windows.filter(w => w.room !== sp.room);
  let best = null, bp = null;
  for (const w of wins) { const [cx, cy] = w.edges[0]; const p = findPath(sp.x, sp.y, (x, y) => x === cx && y === cy, { suspect: true, canOpen: true }); if (p && (!bp || p.length < bp.length)) { bp = p; best = w; } }
  if (!best) return; sp.mode = 'fleeing'; sp.flee = best.id; log('Suspect is moving — he is trying to get out of the gas!', 'alert');
}
function fleeStep() {
  const sp = S.suspect, w = S.windows[sp.flee]; const [cx, cy, ox, oy] = w.edges[0];
  if (sp.x === cx && sp.y === cy) {
    w.broken = true; sp.x = ox; sp.y = oy; sp.room = -1; fx('glass', ox, oy);
    const catcher = S.units.find(u => onFoot(u) && !(u.perch && u.perch.entry) && dist(u.x, u.y, ox, oy) <= 6 && los(u.x, u.y, ox, oy)) || S.units.find(u => u.kind === 'cruiser' && u.occ.length && dist(u.x, u.y, ox, oy) <= 4);
    if (catcher) { sp.mode = 'detained'; S.stats.method = 'Caught by perimeter'; log(`Suspect bails out a window — straight into ${catcher.name}. SUSPECT DETAINED.`, 'good'); }
    else { sp.mode = 'detained'; S.stats.escaped = true; S.stats.method = 'Caught after escape (outer units)'; log('Suspect went out a window through a perimeter gap — outer units and K9 tracked him down after a foot pursuit. SUSPECT DETAINED (perimeter breach).', 'bad'); }
    return;
  }
  const p = findPath(sp.x, sp.y, (x, y) => x === cx && y === cy, { suspect: true, canOpen: true });
  if (!p || !p.length) { sp.mode = 'alert'; return; }
  const [nx, ny] = p[0]; const e = edge(sp.x, sp.y, nx, ny); if (e.t === 'D') { e.d.state = 'open'; e.d.barricaded = false; }
  sp.x = nx; sp.y = ny; sp.room = roomAt(nx, ny);
}
function teamResponses() {
  const sp = S.suspect; if (!suspectActive()) return;
  for (const u of S.units) {
    if (sp.walk) break; // walk-out protocol handles custody (see walkoutTick)
    if (u.kind !== 'team' || !unitAlive(u) || !u.deployed) continue;
    const sees = u.vis.includes(idx(sp.x, sp.y)); const d = dist(u.x, u.y, sp.x, sp.y);
    if (u.detain || (sees && (sp.mode === 'surrendered' || sp.mode === 'incapacitated' || sp.stun > 0) && d < 10)) u.detain = true;
    if (cheb(u.x, u.y, sp.x, sp.y) <= 1 && los(u.x, u.y, sp.x, sp.y) === 1) {
      if (!hostile() || sp.stun > 0) { detained(u, sp.mode === 'surrendered' ? 'Surrendered' : sp.mode === 'incapacitated' ? 'Less-lethal + arrest' : 'Dynamic entry (flashbang)'); return; }
      const p = (0.2 + teamOk(u).length * 0.05 + (u.equip.shield > 0 ? 0.1 : 0)) * (sp.ambush ? 0.6 : 1);
      if (S.rng.chance(p)) { detained(u, 'Hands-on arrest'); return; } log(`${u.name}: struggle with suspect!`, 'alert'); officerDown(u); continue;
    }
    if (!sees || !hostile() || sp.stun > 0) continue;
    const outside = roomAt(u.x, u.y) < 0; if (outside && u.chTurn === S.turn) continue; // from outside: one shouted challenge per turn
    if (u.challenged !== S.tick) { u.challenged = S.tick; if (outside) u.chTurn = S.turn;
      const comply = ((outside ? NEGO_CFG.outsideChallenge : 1) * 0.05 + S.units.filter(q => q.kind === 'team' && q.vis && q.vis.includes(idx(sp.x, sp.y))).length * 0.05) * (outside ? 1 : 0.45) + sp.talk / 250 - sp.agit / 300;
      if (S.rng.chance(comply)) { if (outside) { log(`${u.name}: "POLICE! DROP IT AND COME OUT!" — he shouts that he is coming out.`, 'good'); walkout('callout'); break; }
        surrender(`${u.name}: "POLICE! DROP IT!" — suspect drops the weapon and gets on the ground.`); u.detain = true; continue; }
      if (u.equip.lesslethal > 0 && u.stance !== 'hold' && d <= 11 && !(u.llcd > S.tick)) { u.llcd = S.tick + 3; /* single-shot launcher: re-load before the next round */ const p = (0.3 + (hasSpec(u, 'marksman') ? 0.15 : 0) + teamSkill(u) * 0.15) * (sp.ambush ? 0.45 : 1);
        if (S.rng.chance(p)) { sp.mode = 'incapacitated'; fx('ll', sp.x, sp.y, { fromX: u.x, fromY: u.y }); log(`${u.name}: less-lethal round — suspect incapacitated, weapon dropped.`, 'good'); u.detain = true; continue; }
        else log(`${u.name}: less-lethal round missed.`, 'radio'); }
      else if (sp.cd > 0) { sp.cd += 1; if (u.duckLog !== S.turn) { u.duckLog = S.turn; log(`${u.name}: "POLICE! DROP THE WEAPON!" — suspect ducks into cover.`, 'radio'); } }
    }
  }
  // K9 detection through walls
  for (const u of S.units) if (u.kind === 'team' && unitAlive(u) && u.deployed && hasSpec(u, 'k9') && dist(u.x, u.y, sp.x, sp.y) <= 5 && !sp.visible && (!sp.heat || sp.heat.turn !== S.turn)) {
    sp.heat = { room: sp.room, x: sp.x, y: sp.y, turn: S.turn }; S.intel.located = true; log(`${u.name}: K9 is indicating — suspect close, ${S.rooms[sp.room] ? S.rooms[sp.room].name : 'nearby'}.`, 'intel'); }
}
function detained(u, how) { const sp = S.suspect; sp.mode = 'detained'; xpAct('detain', u && u.kind ? u : null); if (sp.downBy === 'fire' && how === 'Less-lethal + arrest') how = 'Officer fire + arrest'; S.stats.method = how; fx('text', sp.x, sp.y, { text: 'SECURED', color: '#3ef0a0' }); log(`${u.name}: SUSPECT IN CUSTODY. Scene secure. (${how})`, 'good'); }
/** The mission ends only when the suspect is in custody or command chooses to withdraw — never on losses or elapsed time. */
function checkEnd() {
  if (S.phase === 'over') return;
  const sp = S.suspect;
  if (sp.mode === 'detained') { S.phase = 'over'; S.result = { win: true, title: S.stats.escaped ? 'SUSPECT CAUGHT AFTER ESCAPE' : 'SUSPECT IN CUSTODY', text: `Resolved after ${tMin(S.turn + 1)} (${elapsedAt(S.turn + 1)}). Method: ${S.stats.method}. Officers hit: ${S.stats.down}.` }; }
  if (S.phase === 'over') finishMission();
}
function finishMission() { casualtyResolve(S.result.win); S.result.debrief = debrief(); log(S.result.title, S.result.win ? 'good' : 'bad'); S.version++; }
/** Units that can still act on scene (or are still coming). */
function forceLeft() { const offs = S.officers.filter(o => o.status === 'enroute' || o.status === 'staged').length;
  const field = S.units.filter(u => unitAlive(u) && (u.kind === 'team' ? teamOk(u).length > 0 : u.kind === 'patrol')).length; return offs + field; }
/** Player ends the operation without a resolution (e.g. no mobile officers left). */
function withdraw() { if (S.phase === 'over') return { ok: false, reason: 'Mission already over' };
  const sp = S.suspect; S.phase = 'over'; S.stats.withdrawn = true;
  S.result = { win: false, title: 'OPERATION WITHDRAWN', text: `Command ended the operation after ${tMin(S.turn)} without taking the suspect into custody${sp.mode === 'incapacitated' ? ' (suspect down but not secured)' : ''}. Scene handed over.` };
  log('Command: withdraw — all units pull back to the perimeter.', 'bad'); finishMission(); return { ok: true }; }
function endTurn() {
  S.turn++; S.phase = 'planning'; S.tick = 0; S.peek = [];
  for (const u of S.units) { u.orders = u.orders.filter(o => o.type !== 'hold' && o.type !== 'shoot'); u.holding = false; u.waiting = false; u.exiting = null;
    if ((u.kind === 'drone' || u.kind === 'robot') && unitAlive(u)) { u.battery--; if (u.battery <= 0) { u.status = 'down'; log(`${u.name}: battery depleted.`); } } }
  gasTurn(); suspectGasTurn(); casualtyTurn(); negoTurn(); sceneTurn();
  if (S.intel.blueprint && S.intel.blueprint === S.turn) { S.rooms.forEach(q => q.known = true); S.doors.forEach(d => d.known = true); S.intel.floors = true; log('Blueprints received — full floor plan on screen.', 'intel'); }
  for (const o of S.officers) { if (o.status === 'enroute') { if (o.eta <= S.turn) { o.status = 'staged'; log(`PAGER: ${o.name} (${SPECS[o.spec].name}) on scene at staging.`, 'pager'); S.events.push({ type: 'pager' }); } } }
  const sp = S.suspect;
  if (hostile()) { sp.agit = clamp(sp.agit - 4, 0, 100); if (!sp.visible) sp.unseenTurns++; else sp.unseenTurns = 0;
    if (sp.mode === 'alert' && sp.unseenTurns >= 3 && sp.stun === 0) { sp.mode = 'barricaded'; sp.ambush = false; sp.unseenTurns = 0; } }
  
  rebuildDyn(); computeExpo(); updateVision(); gasObserve(); checkEnd(); S.version++;
}

/** After-action summary: negotiation, surrender protocol, casualties. */
function debrief() {
  const N = S.nego, sp = S.suspect, out = [];
  let neg = N.outcome || (N.everContact ? 'Contact made, no surrender' : N.attempts ? 'Contact refused' : negOnScene().length ? 'No contact attempted' : 'No negotiator used');
  if (S.result && S.result.win && sp.mode === 'detained' && !N.how && N.outcome !== 'Walk-out ambush') neg += ` — resolved tactically (${S.stats.method})`;
  out.push({ k: 'Negotiation', v: `${neg}. Attempts ${N.attempts}, refusals ${N.refusals}, dialogue rounds ${N.rounds}.` });
  if (N.protocol) { const P = N.protocol; out.push({ k: 'Walk-out protocol', v: `${P.score}/4 — ${['cover', 'shield', 'overwatch', 'commands'].map(k => (P[k] ? '✓ ' : '✗ ') + k).join(', ')}${N.ambush ? '. AMBUSH' + (N.ambush.hit ? ' — an officer was hit' : ' — no officer hit') : ''}.` }); }
  out.push(...sceneDebrief());
  const own = S.cas.filter(c => c.who !== 'suspect'), cnt = st => own.filter(c => c.state === st).length;
  out.push({ k: 'Casualties', v: own.length ? `${own.length} hit — evacuated ${cnt('evacuated')}, lost ${cnt('lost')}, killed in action ${cnt('kia')}.` : 'None.' });
  own.forEach(c => out.push({ k: '  ' + c.name, v: sevWord(c) + (c.initial ? ' (hit before SWAT arrived)' : '') }));
  const sc = S.cas.find(c => c.who === 'suspect');
  const M = missionScore(); out.push({ k: 'Score', v: `${M.score} — ${M.grade}` });
  M.items.forEach(i => out.push({ k: '  ' + (i.pts < 0 ? 'Deduction' : 'Bonus'), v: `${i.label}: ${i.pts > 0 ? '+' : '−'}${Math.abs(i.pts)}`, pts: i.pts }));
  out.push({ k: 'Suspect', v: sp.deceased ? 'Did not survive' : sc ? (sc.state === 'evacuated' ? 'Injured — evacuated to hospital in custody' : 'Injured') : sp.mode === 'detained' ? 'Uninjured, in custody' : sp.mode === 'escaped' ? 'Escaped' : 'Still inside' });
  return out;
}

/** Commendation score for the debrief / career. No time component. Losses are deductions, never an early end.
    items: [{label, pts}] — every bonus and deduction, listed in the debrief. */
const SCORE = { resolved: 500, talked: 250, rescued: 150, gapClosed: 50, officerHit: -200, officerLost: -400, civHurt: -300, civKilled: -600, hostageHurt: -300, hostageKilled: -800, suspectLost: -150, escape: -300, withdraw: -400, stateTeam: -250 };
function missionScore() {
  const R = S.result || {}, sp = S.suspect, N = S.nego, items = [], add = (label, pts) => { if (pts) items.push({ label, pts }); };
  const after = S.cas.filter(c => !c.initial), lostSt = c => c.state === 'kia' || c.state === 'lost';
  const ours = after.filter(c => c.who === 'officer' || c.who === 'patrol'), civ = after.filter(c => c.who === 'civilian' && !c.hostage), hos = after.filter(c => c.who === 'hostage' || c.hostage);
  if (R.win) { add('Suspect resolved', SCORE.resolved); if (N.how) add('Talked out (no force)', SCORE.talked); }
  if (S.stats.escaped) add('Perimeter breach — suspect escaped before capture', SCORE.escape);
  if (S.stats.withdrawn) add('Withdrew without resolution', SCORE.withdraw);
  if (S.stats.stateTeam) add('Scene handed to the State SWAT team', SCORE.stateTeam);
  const oh = ours.filter(c => !lostSt(c)).length, ol = ours.filter(lostSt).length;
  if (oh) add(`Officers hit (${oh})`, oh * SCORE.officerHit); if (ol) add(`Officers killed or lost (${ol})`, ol * SCORE.officerLost);
  const ch = civ.filter(c => !lostSt(c)).length, ck = civ.filter(lostSt).length; if (ch) add(`Civilians hurt (${ch})`, ch * SCORE.civHurt); if (ck) add(`Civilians killed (${ck})`, ck * SCORE.civKilled);
  const hh = hos.filter(c => !lostSt(c)).length, hk = hos.filter(lostSt).length; if (hh) add(`Hostages hurt (${hh})`, hh * SCORE.hostageHurt); if (hk) add(`Hostages killed (${hk})`, hk * SCORE.hostageKilled);
  if (sp.deceased) add('Suspect did not survive', SCORE.suspectLost);
  const init = S.cas.find(c => c.initial && c.state !== 'kia'); if (init && (init.state === 'evacuated' || init.state === 'transport' || init.stable)) add('Rescued officer down on arrival', SCORE.rescued);
  if (S.scene && S.scene.gap0.length && S.scene.gapClosed != null && !S.scene.slipTried) add('Closed perimeter gap', SCORE.gapClosed);
  const sc = items.reduce((a, i) => a + i.pts, 0), sg = v => (v > 0 ? '+' : '−') + Math.abs(v);
  const grade = sc >= 1000 ? 'Medal of Valor' : sc >= 650 ? 'Unit Commendation' : sc >= 350 ? 'Satisfactory' : sc >= 0 ? 'Needs Review' : 'Board of Inquiry';
  return { score: sc, grade, items, parts: items.map(i => `${i.label} ${sg(i.pts)}`), deductions: items.filter(i => i.pts < 0) };
}
/** Everything the career layer needs from a finished mission (pure data, no references into S). */
function careerSummary() {
  const R = S.result || {}, sp = S.suspect, N = S.nego, m = S.stats.method || '';
  const outcome = S.stats.stateTeam ? 'state' : !R.win ? 'withdrawn' : S.stats.escaped ? 'pursuit'
    : N.how === 'callout' ? 'callout' : N.how ? 'negotiated' : /perimeter/i.test(m) ? 'perimeter' : /Less-lethal/i.test(m) ? 'lesslethal' : /fire/i.test(m) ? 'officerfire' : /entry|flashbang|gas/i.test(m) ? 'tactical' : 'arrest';
  const officers = S.officers.map(o => { const c = S.cas.find(q => q.who === 'officer' && q.ref === o.id);
    return { careerId: o.careerId || null, id: o.id, name: o.name, spec: o.spec, onScene: o.status !== 'enroute', inTeam: !!o.team, cas: c ? { state: c.state, sev: c.sev, stable: !!c.stable } : null }; });
  const pc = S.cas.filter(c => c.who === 'patrol'), scs = S.cas.find(c => c.who === 'suspect');
  const M = missionScore();
  return { seed: S.seed, win: !!R.win, title: R.title || '', method: m, outcome, turns: S.turn + 1, timeSec: (S.turn + 1) * TURN_SEC, score: M.score, grade: M.grade, deductions: M.deductions.map(d => ({ label: d.label, pts: d.pts })), officers,
    patrol: { hit: pc.length, lost: pc.filter(c => c.state === 'kia' || c.state === 'lost').length },
    suspect: sp.deceased ? 'lost' : scs ? 'injured' : sp.mode === 'escaped' ? 'escaped' : sp.mode === 'detained' ? 'unhurt' : 'inside', variant: S.scene ? S.scene.variant : null,
    stateTakeover: !!S.stats.stateTeam, actions: (S.xpLog || []).map(x => ({ key: x.key, label: x.label, xp: x.xp, ids: x.ids.slice(), by: x.by, detail: x.detail, turn: x.turn })), level: (S.opts && S.opts.level) || null };
}
/* ---------- team management (planning phase only) ---------- */
const nearStaging = (x, y) => dist(x, y, S.ext.staging.x, S.ext.staging.y) <= 4.5;
function formTeam(ids) {
  if (S.phase !== 'planning') return { ok: false, reason: 'Busy' };
  ids = (ids || S.officers.filter(o => o.status === 'staged' && !o.team).map(o => o.id)).slice(0, S.teamMax || 5);
  if (!ids.length) return { ok: false, reason: 'No unassigned officers at staging' };
  const n = ++S.teamSeq; const st = S.ext.staging;
  const t = { uid: 'T' + n, kind: 'team', name: TEAM_NAMES[(n - 1) % TEAM_NAMES.length], num: n, members: [], x: st.x + ((n - 1) % 3) - 1, y: st.y - 1 - Math.floor((n - 1) / 3), dir: -Math.PI / 2, equip: {}, orders: [], status: 'ok', vis: [], deployed: true, detain: false, stance: 'return', perch: null, mask: 'off', impair: 0, stun: 0 };
  for (const k in EQUIP) t.equip[k] = 0;
  S.units.push(t); ids.forEach(id => assign(id, t.uid));
  const kit = { ram: 1, halligan: 1, bang: 2, shield: 1, gas: 1 };
  if (t.members.some(id => off(id).spec === 'breacher')) kit.charge = 2;
  if (t.members.some(id => off(id).spec === 'tech')) { kit.drone = 1; kit.robot = 1; }
  if (t.members.some(id => off(id).spec === 'medic')) kit.medkit = 1;
  if (t.members.some(id => off(id).spec === 'marksman')) kit.lesslethal = 1;
  if (t.members.some(id => off(id).spec === 'negotiator')) { kit.tphone = 1; kit.bullhorn = 1; }
  if (t.members.some(id => off(id).spec === 'leader')) kit.bullhorn = 1;
  for (const k in kit) for (let i = 0; i < kit[k]; i++) if (S.armory[k] > 0) { S.armory[k]--; t.equip[k]++; }
  log(`${t.name} team formed (${t.members.length} officers).`, 'system'); S.version++; return { ok: true, team: t };
}
function assign(offId, teamUid) {
  const o = off(offId); if (!o || o.status !== 'staged' && o.status !== 'ok') return { ok: false, reason: 'Officer unavailable' };
  const from = o.team ? unit(o.team) : null, to = teamUid ? unit(teamUid) : null;
  const pos = from ? from : S.ext.staging; const tpos = to ? to : S.ext.staging;
  if (dist(pos.x, pos.y, tpos.x, tpos.y) > 3.5) return { ok: false, reason: 'Units must be together (within 3 m) to swap members' };
  if (from) from.members = from.members.filter(id => id !== offId);
  o.team = to ? to.uid : null; o.status = to ? 'ok' : 'staged'; if (to) to.members.push(offId);
  if (from && !from.members.length) { S.units = S.units.filter(u => u !== from); for (const k in from.equip) S.armory[k] += from.equip[k]; }
  S.version++; return { ok: true };
}
function equip(teamUid, item, delta) {
  const t = unit(teamUid); if (!t) return { ok: false };
  if (!nearStaging(t.x, t.y)) return { ok: false, reason: 'Team must be at staging (SWAT truck) to re-equip' };
  if (delta > 0 && S.armory[item] <= 0) return { ok: false, reason: 'None left in armory' };
  if (delta < 0 && t.equip[item] <= 0) return { ok: false, reason: 'None to return' };
  S.armory[item] -= delta; t.equip[item] += delta; S.version++; return { ok: true };
}
function renameTeam(uid, name) { const t = unit(uid); if (t && name && name.trim()) { t.name = name.trim().slice(0, 14); S.version++; } }

/* ---------- derived info for HUD ---------- */
function intelInfo() {
  const known = S.rooms.filter(q => q.known).length, exp = S.rooms.filter(q => q.explored).length, sp = S.suspect;
  const lvl = Math.round(100 * (0.55 * known / S.rooms.length + 0.15 * (S.intel.threat ? 1 : 0) + 0.15 * (S.intel.floors ? 1 : 0) + 0.15 * (sp.seen || S.intel.located ? 1 : 0)));
  let threat = 'UNKNOWN'; if (S.intel.threat) threat = '1 ARMED SUSPECT'; if (sp.visible) threat = 'VISUAL — ' + (S.rooms[sp.room] ? S.rooms[sp.room].name.toUpperCase() : 'YARD'); else if (sp.heat) threat = 'LOCATED (THERMAL/K9)';
  const status = { barricaded: 'BARRICADED', alert: 'ALERTED', fleeing: 'FLEEING', surrendered: 'SURRENDERED', incapacitated: 'INCAPACITATED', detained: 'IN CUSTODY', escaped: 'ESCAPED' }[sp.mode];
  return { arch: S.intel.floors ? S.house.archName : 'UNKNOWN', weapon: S.intel.weapon ? SUSPECT_WEAPONS[sp.weapon].name : 'UNKNOWN', floors: S.intel.floors ? '1 (single storey)' : 'UNKNOWN', roomsKnown: known, roomsTotal: S.intel.floors ? S.rooms.length : '?', explored: exp, level: clamp(lvl, 0, 100), threat,
    suspect: (sp.seen || S.intel.threat || !hostile()) ? status : 'UNKNOWN', contain: S.contain.filter(c => c.covered).length, containTotal: S.contain.length, containKnown: !!S.intel.status, sides: (() => { const w = sideWatch(); return { n: w.watched.length, of: w.all.length, gaps: w.gaps }; })(), down: S.stats.down, downMax: LOSE_DOWN, talk: Math.round(sp.talk), phone: !!S.nego.contact, mood: moodWord(), rapport: rapportWord(),
    cas: S.cas.filter(c => casActive(c) && c.known && c.who !== 'suspect').length };
}

function newGame(seed, opts) {
  seed = (seed >>> 0) % 1000000 || 1;
  const N = MAP_W * MAP_H;
  for (let attempt = 0; attempt < 12; attempt++) {
    const r = makeRng(seed * 31 + attempt * 7919 + 1);
    S = { seed, attempt, rng: r, turn: 0, tick: 0, phase: 'planning', log: [], events: [], fx: [], fxSeq: 0, version: 1,
      room: new Int16Array(N).fill(-1), block: new Uint8Array(N), vis: new Uint8Array(N), opaque: new Uint8Array(N), cov: new Uint8Array(N), covLbl: new Uint8Array(N), paved: new Uint8Array(N),
      dyn: new Uint8Array(N), gas: new Float32Array(N), gasSeen: new Float32Array(N), gasActive: false, gasEver: false, wind: [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }][((seed * 2654435761) >>> 0) % 4], drive: null, expo: null, edges: new Map(), peek: [], units: [], contain: [], perches: [],
      intel: { interview: false, blueprint: 0, flybyReady: 0, floors: false, threat: 0, located: false, weapon: false }, cmd: null, stats: { down: 0, breaches: 0, shots: 0, ofShots: 0, method: '', kia: 0, lost: 0, evac: 0 }, downList: [], cas: [], casSeq: 0, surrSpot: null,
      opName: 'OPERATION ' + OPS[seed % OPS.length], opts: opts || {} };
    genGeo(r);
    genHouse(r, S.geo.target, S.geo.SW - r.int(7, 9));
    const he = validateHouse(); if (he.length) { S.genErrors = he; continue; }
    genFurniture(r); genNeighborhood(r); buildDriveMask();
    const we = validateWorld(); if (we.length) { S.genErrors = we; continue; }
    setupUnits(r); setupSuspect(r); S.genErrors = []; genContain(r); computeExpo(true); setupScene(r); coverStartPatrols(); genPerches();
    const ce = S.genErrors.concat(validateWorld()); if (ce.length) { S.genErrors = ce; continue; }
    break;
  }
  if (S.genErrors.length) { console.warn("generation fallback", S.genErrors); }
  if (!S.officers) { throw new Error("generation failed: " + JSON.stringify(S.genErrors)); }
  if (S.opts.armored) { // career unlock: armored rescue vehicle, parked empty at staging
    const X = S.ext; let best = null; for (let d = 0; d < 14 && !best; d++) for (const dx of [d, -d]) { const x = X.staging.x + dx, y = S.geo.ST + 4; if (S.drive[idx(x, y)] && !carClash(x, y, null)) { best = [x, y]; break; } }
    if (best) { S.units.push({ uid: 'C4', kind: 'cruiser', name: 'BearCat', num: 4, x: best[0], y: best[1], dir: 0, occ: [], orders: [], status: 'ok', hits: 0, marks: [], vis: [], disabled: false, armored: true }); rebuildDyn(); } }
  S.ems = defaultEMS(); initNego(seed); makeBrief();
  updateVision();
  log(`${S.opName} — seed ${seed}. ${S.house.archName}, ${S.geo.name}.`, 'system');
  const B = S.brief; log(`Dispatch ${B.time}: ${B.type} at ${B.addr}. ${B.shots ? 'Shots fired. ' : ''}Adult male barricaded inside. Patrol cruisers blocking traffic at both ends of the block.`, 'alert');
  if (S.scene.injury) { const c = casById(S.scene.injury.cas), mate = S.units.find(u => u.kind === 'patrol' && u.status === 'ok' && !u.inCar);
    log(c.state === 'kia' ? `${mate ? mate.name : 'Patrol'}: "OFFICER DOWN! ${c.name} is hit in the front yard — he's not moving. We can't get to him!"` : c.state === 'mobile' ? `${c.name}: "I'm hit — I can move. I'm in the open out front, need cover!"` : c.sev === 3 ? `${mate ? mate.name : 'Patrol'}: "OFFICER DOWN! ${c.name} is hit out front, he's losing a lot of blood — we need help NOW!"` : `${c.name}: "I'm hit — I can't move. Front yard. Somebody get me out of here!"`, 'bad'); }
  log('SWAT team paged. Set containment from cover while the team responds.', 'system');
  const A = initialArrivals(); S.brief.arrival = A;
  if (A) log(A.mode === 'all' ? `SWAT: FULL TEAM ON SCENE — ${A.why}` : `SWAT: ${A.count} of ${A.of} on scene at staging — ${A.why}${A.count < A.of ? ' The rest are paged and en route.' : ''}`, A.mode === 'all' ? 'good' : 'system');
  S.officers.forEach(o => log(o.status === 'staged' ? `PAGER: ${o.name} (${SPECS[o.spec].name}${o.quals.length ? ', ' + o.quals.map(q => QUALS[q].name).join(', ') : ''}) ON SCENE at staging.` : `PAGER: ${o.name} (${SPECS[o.spec].name}${o.quals.length ? ', ' + o.quals.map(q => QUALS[q].name).join(', ') : ''}) en route — ETA ${tMin(o.eta)}.`, 'pager'));
  return S;
}

return { newGame, get state() { return S; }, MAP_W, MAP_H, TICKS, LOSE_DOWN, SCORE, withdraw, forceLeft, updateVision, computeVis, checkEnd, EQUIP, SPECS, QUALS, WEAPONS, SUSPECT_WEAPONS, STANCES, COVER_NAMES, COMMANDS, idx, roomAt, edge, los, losEx, findPath, planFor, queueOrder, undoOrder, clearOrders,
  setCommand, execute, stepTick, formTeam, assign, equip, renameTeam, intelInfo, unit, off, teamOk, hasSpec, teamSkill, nearStaging, orderReq, setStance, BREACH, CHARGE_SAFE, breachEst, breachMethods, breachCan, defaultMethod, doorMid, gasAt, gasTurn, gasDeploy, gasCond, gasExpose, suspectGas, suspectGasTurn, masked, impairAcc, impairVis, donMasks, detonateCharge, dist, hitChance, coverInfo, expoAt, computeExpo,
  validateHouse, validateWorld, footprint, carAxis, houseSideOf, exitCell, spotterOf, perchAt, owCone, weaponOf, onFoot, skillOf, houseCenter, carAt, snapCover, shieldAt, validateContain, COVER_CFG, TURN_SEC, missionScore, careerSummary, ACT_XP, xpAct, xpSummary, callState, preview, cornerAt, cornerAvail, CORNER_CFG, formationFor, FORM_CFG, initialArrivals, ARRIVE_CFG, mmss, tDur, tMin, clockAt, elapsedAt, sideWatch, watchAt, houseSides, statusCheck, review911, roadblockHeld, withVirtualCar, SCENE_CFG, VARIANT_TXT, setupScene, sceneDebrief, T_HIT, T_TRY,
  CAS_CFG, NEGO_CFG, TALK_KEYS, TALK_NAMES, casById, casActive, casKnow, sevWord, casLabel, setEMS, emsCheck, ccpFor, setSurrenderSpot, surrSpot, setTalk, talkAvail, negoSummary, negOnScene, paCapable, paInRange, paUnits, protocolNow, ambushChance, ambushRisk, walkout, addCasualty, officerDown, suspectHit, robotPhoneGoal, defaultEMS, hostile, contactTry, runTalk, paAct, casualtyTurn, applyAid };
})();
