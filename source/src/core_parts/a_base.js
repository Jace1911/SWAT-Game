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
/** Build version shown on the main menu — bump this one constant each build. */
const GAME_VERSION = 'v23';

const Core = (function () {
'use strict';
/** Rear row behind the suspect house: rear street (road + sidewalk) and a row of back-neighbour lots whose yards meet the target's back yard. */
const REAR_CFG = { road: 4, walk: 2, depth: 18 }, REAR_OFF = 1 + REAR_CFG.road + REAR_CFG.walk + REAR_CFG.depth;
const MAP_W = 112, MAP_H = 71 + REAR_OFF, TICKS = 8, LOSE_DOWN = 3; // LOSE_DOWN: kept only as the 'heavy losses' warning threshold — the mission never auto-ends on losses or time
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
  shield:     { name: 'Ballistic Shield (IIIA)', short: 'Shield',  pool: 2,  desc: 'Level IIIA, one hand: stops handgun and shotgun rounds in the frontal arc (partial body coverage). Teammates stacked behind get some cover.' },
  shield3:    { name: 'Ballistic Shield (III)', short: 'Shield III', pool: 0, desc: 'Level III rifle-rated shield, one hand: also stops most rifle rounds (~60%) and some .308. Frontal arc only.' },
  plate:      { name: 'Plate Carrier',          short: 'Plates',   pool: 0,  desc: 'Rifle plates over the IIIA vest (worn slot): stops most rifle rounds to the torso. Individually issued.' },
  draco:      { name: 'Draco Arm Kit',          short: 'Draco',    pool: 0,  desc: 'Front-mounted breaching boom/claw for the BearCat. Two officers install it in 5 turns; then the vehicle can rip doors and windows.' },
  ram:        { name: 'Battering Ram',         short: 'Ram',      pool: 2,  desc: 'Manual breach. Medium speed; barricades and storm doors slow it.' },
  halligan:   { name: 'Halligan Bar',          short: 'Halligan', pool: 3,  desc: 'Pry or kick-assist. Quieter but slowest; must pry a storm door first.' },
  charge:     { name: 'Breaching Charge',      short: 'Charge',   pool: 3,  desc: 'Hang, back off, detonate. Fastest and most reliable; very loud. Needs a breacher.' },
  bang:       { name: 'Flashbang',             short: 'Flashbang',pool: 10, desc: 'Disorients occupants of a room for several ticks.' },
  gas:        { name: 'CS Gas Canister',       short: 'CS Gas',   pool: 4,  desc: 'Room becomes uninhabitable; suspect may surrender or flee.' },
  lesslethal: { name: '4-shot 40mm multilauncher',  short: '4-shot 40mm multilauncher',  pool: 2,  desc: 'Can incapacitate a hostile suspect; launches gas through windows.' },
  polecam:    { name: 'Mirror / Pole Camera',  short: 'Pole Cam', pool: 2,  desc: 'Peek under a door into the next room without opening it.' },
  drone:      { name: 'Micro Drone',           short: 'Drone',    pool: 1,  desc: 'Fast flying scout. Needs a tech operator.' },
  robot:      { name: 'Throwbot 2',            short: 'Throwbot', pool: 1,  desc: 'Small two-wheeled throwable camera robot. Needs a tech operator.' },
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
const QUALS = { spotter: { name: 'Sniper Spotter', icon: '◆', desc: 'Trained observer: biggest hit-chance bonus when paired with a sniper, spots the suspect at windows sooner' },
  ll: { name: 'Less-Lethal Specialist', icon: '◍', desc: 'Qualified on the 40mm less-lethal launcher (two hands, limited rounds)' } };
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
  auto:    { name: 'automatic rifle', range: 30, base: 0.26, auto: true }, // v20: full-auto (not generated by default scenarios)
  none:    { name: 'no firearm', range: 0, base: 0 },   // v12: parole absconder may be unarmed
};
const STANCES = { return: 'Return fire', free: 'Fire at will', hold: 'Hold fire' };
const TEAM_NAMES = ['Rear Containment', 'React Team', 'Search Team', 'Containment', 'Drone Team', 'K9 Team', 'Negotiators', 'BearCat Team', 'Gas Team']; // v20 presets; default is 'Team N'; custom names allowed
const LAST = ['Reyes','Kim','Novak','Okafor','Brennan','Castillo','Haddad','Lindqvist','Morales','Tran','Walsh','Diaz','Petrov','Hughes','Sato','Mensah','Kowalski','Rivera'];
const LAST2 = ['Abbott','Banks','Chen','Dorsey','Ellison','Fischer','Gomez','Hale','Ibarra','Jovanovic','Kaur','Lund','Marsh','Nakamura','Olsen','Pratt','Quinn','Rossi','Sandoval','Tate','Underwood','Varga','Whitfield','Yilmaz'];
const PATROL = ['Miller','Grant','Shah','Ortiz','Becker'];
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
  if (e.t === 'W') return !!(o.fly && e.w.broken) || !!(e.w.cleared && !o.drive); // v9: a window torn out by the Draco arm is a walk-through opening
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
  if (o.avoidSuspect && (S.suspects && S.suspects.length > 1 ? S.suspects.some(s => s.x === x && s.y === y && !['detained', 'escaped'].includes(s.mode)) : suspectActive() && S.suspect.x === x && S.suspect.y === y)) return false;
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
  let cx = ax, cy = ay, glass = false, cov = 0, leanOk = 0, tv = -1;
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
      // v14 vehicle rule: a car / van / cruiser body blocks sight and fire unless the shooter/viewer (a) is right behind it (≤2 m, leaning out)
      const vid = vehId(c); if (vid && vid !== leanOk) { if (tv < 0) tv = vehId(idx(bx, by)); if (vid === tv) { leanOk = vid; } else if (vehNear(ax, ay, vid)) leanOk = vid; else return { v: 0, cov: 2, veh: true }; }
      if (wantCov && near(nx, ny)) { const k = S.dyn[c] && !COV_STATIC ? 2 : S.cov[c]; if (k > cov) cov = k; } }
    cx = nx; cy = ny;
  }
  return { v: glass ? 2 : 1, cov };
}
/* v14 vehicles: static cars + the SWAT van get ids 1..n (S.veh grid, rebuilt lazily); cruisers / the armored truck use 1000+number (S.dyn). */
const VEH_CFG = { lean: 2 };
function vehGrid() { if (S.veh && S.veh.length === MAP_W * MAP_H) return S.veh; const g = S.veh = new Uint16Array(MAP_W * MAP_H), W = S.world || {};
  const list = (W.cars || []).concat(W.van && !W.van.away ? [W.van] : []); list.forEach((q, i) => { for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) if (inb(x, y)) g[idx(x, y)] = i + 1; }); return g; }
function vehId(c) { const d = S.dyn && S.dyn[c]; if (d && !COV_STATIC) return 1000 + d; return S.world ? vehGrid()[c] : 0; }
/** Is (x,y) within VEH_CFG.lean metres of any cell of vehicle vid? */
function vehNear(x, y, vid) { const R = VEH_CFG.lean; for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { if (dx * dx + dy * dy > R * R + 0.01 || !inb(x + dx, y + dy)) continue; if (vehId(idx(x + dx, y + dy)) === vid) return true; } return false; }
/** Distance (m) from (x,y) to the nearest vehicle cell (static or cruiser), capped at 9. */
function vehDist(x, y) { let b = 9; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { if (!inb(x + dx, y + dy) || (!dx && !dy)) continue; if (vehId(idx(x + dx, y + dy))) b = Math.min(b, Math.hypot(dx, dy)); } return b; }
function los(ax, ay, bx, by) { return losEx(ax, ay, bx, by, false).v; }
