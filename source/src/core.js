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

/* v23 (B3/B4): name and street pools for the call / brief text. Officer names stay on LAST/LAST2 above. */
const SUS_FIRST = ['Aaron','Adam','Alan','Alex','Alfonso','Andre','Andrew','Anthony','Austin','Barry','Ben','Benjamin','Bernard','Billy','Blake','Bobby','Brad','Brendan','Brent','Brett','Brian','Byron','Caleb','Calvin','Cameron','Carl','Casey','Chad','Charles','Clayton','Clint','Cody','Colin','Corey','Curtis','Dallas','Damian','Damon','Danny','Darius','Darren','Darryl','Dave','David','Dean','Dennis','Desmond','Dmitri','Dominic','Don','Donnie','Douglas','Duane','Dylan','Earl','Edgar','Eduardo','Edward','Elijah','Eric','Ernest','Ethan','Eugene','Evan','Felix','Fernando','Frank','Frankie','Garrett','Gary','Gavin','Gene','George','Gerald','Gordon','Grant','Greg','Gregory','Hank','Harold','Harvey','Henry','Herman','Howard','Hugo','Isaac','Ivan','Jacob','Jamal','James','Jared','Jason','Javier','Jay','Jeff','Jeffrey','Jeremy','Jesse','Jim','John','Johnny','Jonathan','Jordan','Jorge','Joseph','Joshua','Juan','Julian','Kelvin','Ken','Kenneth','Kent','Kevin','Kirk','Kurt','Lawrence','Leon','Lionel','Lloyd','Logan','Louis','Lucas','Luke','Malcolm','Manuel','Marcus','Mark','Marshall','Martin','Matt','Matthew','Micah','Michael','Miguel','Mike','Mitchell','Nate','Nathan','Neil','Nelson','Norman','Oliver','Oscar','Owen','Pablo','Patrick','Paul','Pedro','Perry','Phil','Preston','Quentin','Rafael','Ralph','Ramon','Randy','Ray','Raymond','Rick','Ricky','Robert','Roberto','Rodney','Roland','Ross','Ruben','Ryan','Sam','Sean','Sergio','Seth','Shawn','Simon','Stephen','Steve','Steven','Stuart','Ted','Terry','Thomas','Timothy','Tom','Tony','Travis','Trent','Trevor','Troy','Tyrone','Vernon','Victor','Vincent','Wade','Walter','Warren','Wayne','Wesley','Will','William','Willie','Zachary']; // 200 male first names (suspect)
const SUS_LAST = ['Adams','Allen','Alvarez','Andrews','Armstrong','Arnold','Austin','Barker','Barnes','Bell','Bennett','Bishop','Black','Blake','Boyd','Bradley','Brady','Brooks','Brown','Bryant','Butler','Byrd','Caldwell','Campbell','Carlson','Carr','Carroll','Carter','Chambers','Chapman','Clark','Cole','Coleman','Collins','Crawford','Daniels','Davidson','Davis','Dawson','Day','Dean','Dixon','Douglas','Duncan','Edwards','Elliott','Evans','Ferguson','Fields','Fleming','Fletcher','Flores','Foster','Franklin','Freeman','Fuller','Garcia','Garrett','Gilbert','Graham','Grant','Graves','Gray','Green','Greene','Gutierrez','Hall','Hamilton','Hansen','Harris','Hart','Hawkins','Hayes','Henderson','Henry','Hernandez','Hicks','Holland','Hopkins','Howard','Hudson','Hunter','Jackson','Jacobs','James','Jenkins','Jensen','Johnson','Johnston','Jones','Keller','Kelley','Kelly','Kennedy','Kim','King','Knight','Lambert','Lane','Larson','Lawrence','Lawson','Lee','Lewis','Little','Lopez','Lyons','Marshall','Maxwell','Mccarthy','Mcdonald','Meyer','Miller','Mills','Mitchell','Montgomery','Morgan','Morris','Morrison','Murphy','Murray','Myers','Nelson','Ortega','Owens','Palmer','Parker','Patel','Patterson','Pearson','Perez','Perry','Peters','Peterson','Phillips','Pierce','Porter','Powell','Price','Ramirez','Ray','Reed','Reid','Reynolds','Rhodes','Rice','Richards','Richardson','Riley','Robbins','Roberts','Robinson','Rodgers','Romero','Rose','Ross','Ruiz','Russell','Ryan','Sanchez','Schmidt','Schultz','Shaw','Simmons','Sims','Smith','Snyder','Stanley','Stephens','Stevens','Stewart','Stone','Sullivan','Swanson','Taylor','Thomas','Thompson','Tucker','Vargas','Wade','Wagner','Walker','Wallace','Ward','Warren','Watkins','Watson','Weaver','Webb','Wells','West','Wheeler','White','Williams','Willis','Wilson','Wood','Woods','Wright','Young']; // 200 surnames (suspect, family, neighbor callers)
const CALLER_F = ['Alicia','Amanda','Amber','Amy','Andrea','Angela','Anna','Ashley','Beth','Brandi','Brittany','Brooke','Carla','Carmen','Carol','Cassie','Chelsea','Christina','Cindy','Claire','Courtney','Crystal','Dana','Danielle','Destiny','Diana','Donna','Elena','Elizabeth','Emily','Erica','Erin','Gina','Gloria','Grace','Heather','Holly','Irene','Janelle','Janet','Jasmine','Jen','Jenna','Jessica','Jill','Julia','Julie','Kara','Karen','Kate','Kayla','Kelly','Kim','Kristen','Laura','Lauren','Leah','Leslie','Lisa','Liz','Lucia','Lydia','Marcy','Maria','Megan','Melanie','Melissa','Michelle','Monica','Nicole','Nina','Olivia','Paula','Priya','Rachel','Renee','Robin','Sabrina','Samantha','Sandra','Shannon','Shauna','Sonia','Sophie','Stephanie','Tamara','Tammy','Tanya','Tara','Tasha','Teresa','Tiffany','Valerie','Vanessa','Veronica','Vivian','Wendy','Yolanda','Yvette','Zoe']; // 100 female first names (partner / girlfriend / sister callers)
const STREET_WORDS = ['Acorn','Alder','Amber','Applewood','Arbor','Ashford','Aspen','Autumn','Bayberry','Beacon','Beech','Bellwood','Birch','Birchwood','Blackberry','Bluebell','Bluff','Bramble','Briar','Briarwood','Bridge','Brookside','Buckeye','Cambridge','Canterbury','Cardinal','Carriage','Cedar','Cedar Ridge','Center','Chapel','Cherry','Chestnut','Church','Clover','Cobblestone','Colonial','Commerce','Cottonwood','Country Club','Creekside','Crestview','Cypress','Dahlia','Deer Run','Dogwood','Dover','Eagle','Eastwood','Elm','Elmwood','Evergreen','Fairview','Fairway','Falcon','Fern','Fieldstone','Forest','Fox Run','Franklin','Garden','Glen','Glenwood','Grand','Granite','Green','Greenbriar','Grove','Hamilton','Harbor','Harvest','Hawthorn','Hazel','Heather','Hemlock','Heritage','Hickory','Highland','Hill','Hillcrest','Holly','Homestead','Honeysuckle','Hunters Ridge','Ivy','Jackson','Jefferson','Juniper','Kensington','Kingston','Lake','Lakeview','Larch','Laurel','Lavender','Lexington','Liberty','Lilac','Lincoln','Linden','Locust','Madison','Magnolia','Main','Mallard','Maple','Maplewood','Market','Meadow','Meadowbrook','Mill','Mockingbird','Monroe','Morningside','Mulberry','Myrtle','North','Oak','Oak Hollow','Oakwood','Old Mill','Orchard','Oriole','Park','Parkview','Partridge','Peach','Pebble Creek','Pecan','Pheasant','Pine','Pinecrest','Pleasant','Poplar','Prairie','Primrose','Prospect','Quail','Railroad','Raven','Redbud','Ridge','Ridgeview','River','Riverside','Robin','Rolling Hills','Rose','Rosewood','Sage','Sandstone','School','Sherwood','Silver','Spruce','Spring','Spring Valley','Springfield','Stone','Summit','Sunrise','Sunset','Sycamore','Tamarack','Thistle','Timber','Timberline','Tulip','Valley','Valleyview','Victoria','Village','Vine','Walnut','Warbler','Washington','Water','Westwood','Wheatfield','Whispering Pines','Wildflower','Williams','Willow','Willow Creek','Windsor','Winding Brook','Woodland','Woodlawn','Wren','Yorkshire','Sparrow','Bluejay','Larkspur','Clearwater','Stonebridge','Ironwood','Hollyhock','Quarry','Foxglove','Copper']; // 200 street-name words

/* v23 (B6): criminal-history pool — no years. sev 0-3 feeds a modest hidden aggression bump; w = base weight, t = per-type multipliers, g = only one entry per group. */
const CRIM = [
  { s: 'Prior arrest for assault', sev: 1, w: 4, g: 'asl', t: { domestic: 1.5, neighbor: 1.5 } }, { s: 'Multiple prior assault arrests', sev: 2, w: 1.5, g: 'asl', t: { domestic: 2, inmates: 2 } },
  { s: 'Prior arrest for aggravated assault', sev: 2, w: 1.2, t: { inmates: 3, domestic: 1.5 } }, { s: 'Prior arrest for assault with a deadly weapon', sev: 3, w: 0.7, t: { neighbor: 2, inmates: 3 } },
  { s: 'Prior arrest for assault on a police officer', sev: 3, w: 0.5, t: { sovcit: 3, inmates: 3, parole: 2 } }, { s: 'Prior arrest for domestic assault', sev: 2, w: 0.8, g: 'dv', t: { domestic: 8 } },
  { s: 'Multiple prior domestic assault arrests', sev: 2, w: 0.2, g: 'dv', t: { domestic: 10 } }, { s: 'Prior arrest for felony domestic assault', sev: 3, w: 0.15, t: { domestic: 8 } },
  { s: 'Violation of a protective order', sev: 1, w: 0.4, t: { domestic: 9 } }, { s: 'Prior arrest for stalking', sev: 1, w: 0.4, t: { domestic: 4 } }, { s: 'Prior arrest for harassment', sev: 0, w: 1.2, t: { neighbor: 5, domestic: 2 } },
  { s: 'Prior arrest for terroristic threats', sev: 2, w: 0.7, t: { neighbor: 4, domestic: 2, sovcit: 2 } }, { s: 'Prior arrest for menacing', sev: 1, w: 0.9, t: { neighbor: 5, mental: 1.5 } },
  { s: 'Prior arrest for robbery', sev: 2, w: 0.9, g: 'rob', t: { inmates: 4, parole: 2, flee: 1.5 } }, { s: 'Prior arrest for armed robbery', sev: 3, w: 0.5, g: 'rob', t: { inmates: 5, parole: 2.5, flee: 1.5 } },
  { s: 'Prior arrest for carjacking', sev: 3, w: 0.3, t: { flee: 3, inmates: 3 } }, { s: 'Prior arrest for home invasion', sev: 3, w: 0.25, t: { inmates: 4, parole: 2 } },
  { s: 'Prior arrest for kidnapping', sev: 3, w: 0.1, t: { inmates: 6, domestic: 3 } }, { s: 'Prior arrest for false imprisonment', sev: 2, w: 0.2, t: { domestic: 5, inmates: 3 } },
  { s: 'Prior arrest for attempted murder', sev: 3, w: 0.12, t: { inmates: 6, drughouse: 2 } }, { s: 'Prior conviction for manslaughter', sev: 3, w: 0.08, t: { inmates: 6 } },
  { s: 'Suspect in a drive-by shooting', sev: 3, w: 0.25, g: 'sh', t: { drughouse: 5, inmates: 3, flee: 1.5 } }, { s: 'Suspect in multiple shootings', sev: 3, w: 0.15, g: 'sh', t: { drughouse: 5, inmates: 4 } },
  { s: 'Firearm intelligence — known to carry', sev: 2, w: 1, t: { drughouse: 4, parole: 2, sovcit: 3, neighbor: 1.5 } }, { s: 'Prior arrest for unlawful possession of a firearm', sev: 2, w: 1, t: { parole: 3, drughouse: 3, inmates: 2 } },
  { s: 'Prior arrest for carrying a weapon without a permit', sev: 1, w: 1.2, t: { drughouse: 2, neighbor: 1.5, sovcit: 2 } }, { s: 'Prior arrest for reckless discharge of a firearm', sev: 2, w: 0.6, t: { neighbor: 3, mental: 2 } },
  { s: 'Active felony warrant', sev: 2, w: 1, g: 'war', t: { parole: 2, flee: 3, inmates: 2 } }, { s: 'Active misdemeanor warrant', sev: 0, w: 2, g: 'war', t: { flee: 2, sovcit: 3 } },
  { s: 'Prior arrest for resisting arrest', sev: 1, w: 1.8, t: { flee: 2, sovcit: 3 } }, { s: 'Prior arrest for fleeing a police officer', sev: 1, w: 0.8, t: { flee: 6, parole: 2, inmates: 2 } },
  { s: 'Prior arrest for obstructing a police officer', sev: 1, w: 1, t: { sovcit: 5 } }, { s: 'Prior arrest for burglary', sev: 1, w: 1.3, t: { flee: 4, inmates: 2, parole: 2 } },
  { s: 'Prior arrest for auto theft', sev: 1, w: 0.9, t: { flee: 4, inmates: 2 } }, { s: 'Prior arrest for receiving stolen property', sev: 1, w: 1, t: { flee: 3, drughouse: 1.5 } },
  { s: 'Prior arrest for possession of a controlled substance', sev: 1, w: 2.5, t: { drughouse: 4, parole: 2, flee: 1.5 } }, { s: 'Prior arrest for possession with intent to distribute', sev: 2, w: 0.8, g: 'drg', t: { drughouse: 6, parole: 2, inmates: 2 } },
  { s: 'Prior arrest for drug trafficking', sev: 2, w: 0.25, g: 'drg', t: { drughouse: 10, inmates: 3 } }, { s: 'Prior arrest for manufacturing a controlled substance', sev: 2, w: 0.15, t: { drughouse: 10 } },
  { s: 'Prior arrest for witness tampering', sev: 1, w: 0.25, t: { drughouse: 3, inmates: 2 } }, { s: 'Prior arrest for arson', sev: 2, w: 0.25, t: { mental: 1.5, neighbor: 1.5 } },
  { s: 'Prior arrest for criminal damage to property', sev: 0, w: 1.8, t: { neighbor: 3, domestic: 2 } }, { s: 'Prior arrest for DUI', sev: 0, w: 2.5 }, { s: 'Prior arrest for disorderly conduct', sev: 0, w: 2.5, t: { mental: 1.5 } },
  { s: 'Prior arrest for trespassing', sev: 0, w: 1.5, t: { flee: 2, sovcit: 2 } }, { s: 'Prior arrest for shoplifting', sev: 0, w: 1.5 }, { s: 'Prior arrest for fraud', sev: 0, w: 0.8, t: { sovcit: 4 } },
  { s: 'Prior arrest for filing a false lien', sev: 0, w: 0.05, t: { sovcit: 40 } }, { s: 'Driving with a suspended licence', sev: 0, w: 2, t: { sovcit: 3, flee: 1.5 } },
  { s: 'Failure to appear in court', sev: 0, w: 2, t: { sovcit: 3, parole: 2 } }, { s: 'Prior probation violation', sev: 1, w: 1.6, t: { parole: 4, inmates: 2 } }, { s: 'Prior parole violation', sev: 1, w: 0.4, t: { parole: 6, inmates: 3 } },
  { s: 'Prior conviction for escape from custody', sev: 2, w: 0.05, t: { inmates: 30, parole: 4 } }, { s: 'Prior emergency mental-health hold', sev: 0, w: 0.25, t: { mental: 16 } },
  { s: 'Two prior disturbance calls at this address', sev: 0, w: 1.5, t: { neighbor: 3, mental: 2 } },
];
/** Weights for 0..6 entries per type. "No criminal history on file" is most common on crisis, neighbor and domestic calls. */
const CRIM_COUNT = { barricade: [2, 3, 3, 2, 1.5, 1, 0.5], mental: [6, 3, 1.5, 0.8, 0.3, 0.1, 0], domestic: [4, 3, 2.5, 1.5, 1, 0.4, 0.2], neighbor: [5, 3, 2, 1, 0.5, 0.2, 0.1], flee: [0.5, 1.5, 2, 3, 2.5, 1.5, 1],
  parole: [0, 0.5, 1, 2, 3, 3, 2], sovcit: [1.5, 2, 3, 2.5, 1.5, 0.8, 0.3], drughouse: [0.3, 1, 2, 3, 3, 2, 1], inmates: [0, 0, 0.5, 1, 2, 3, 3] };
const HID_CFG = { sevFire: 0.02, fireCap: 0.15, sevAgit: 1.5, agitCap: 10, // B6: per history severity point (hidden, modest)
  downFire: 1.5, downNego: 0.7, downAgit: 10 };                             // B1: an officer was hit before SWAT arrived (hidden, significant)
/** Seeded criminal history: up to 6 entries, weighted by scenario type, no years. */
function crimHistory(r, type) {
  const cw = CRIM_COUNT[type] || CRIM_COUNT.barricade; let p = r() * cw.reduce((a, b) => a + b, 0), n = 0; for (; n < cw.length - 1; n++) { p -= cw[n]; if (p <= 0) break; }
  let pool = CRIM.map(c => ({ c, w: c.w * ((c.t && c.t[type]) || 1) })); const out = [];
  for (let i = 0; i < n && pool.length; i++) { let q = r() * pool.reduce((a, b) => a + b.w, 0), k = 0; for (; k < pool.length - 1; k++) { q -= pool[k].w; if (q <= 0) break; }
    const c = pool.splice(k, 1)[0].c; if (c.g) pool = pool.filter(x => x.c.g !== c.g); out.push({ text: c.s, sev: c.sev }); }
  return out.sort((a, b) => b.sev - a.sev);
}
/** v23 (B3): a street name — ~30 % numbered / lettered ("N 27th Street", "S 84th Avenue", "A Street", "West B Street"), the rest a word plus a suffix. */
function streetName(r) {
  const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  if (r() < 0.3) { if (r() < 0.7) { const d = r() < 0.6 ? 'NSEW'[Math.floor(r() * 4)] + ' ' : ''; return d + ord(1 + Math.floor(r() * 99)) + ' ' + (r() < 0.55 ? 'Street' : 'Avenue'); }
    const L = 'ABCDEFGHJKLMNP'[Math.floor(r() * 14)], d = r() < 0.4 ? ['West', 'East', 'North', 'South'][Math.floor(r() * 4)] + ' ' : ''; return d + L + ' Street'; }
  const w = STREET_WORDS[Math.floor(r() * STREET_WORDS.length)], SUF = [['Street', 22], ['Drive', 18], ['Avenue', 14], ['Lane', 12], ['Road', 10], ['Court', 8], ['Place', 5], ['Way', 5], ['Circle', 3], ['Trail', 3]];
  let q = r() * 100; for (const [x, k2] of SUF) { q -= k2; if (q <= 0) return w + ' ' + x; } return w + ' Street';
}

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

/* ---------- furniture (blocks movement, not sight) ---------- */
/** v22: car stalls in a garage room (6-7 m wide = 1, 10-11 m = 2, 14-15 m = 3). */
function garageStalls(rm) { return Math.max(1, Math.min(3, Math.round((rm.w - 2) / GARAGE_CFG.stallW))); }
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
      case 'garage': { const stalls = garageStalls(rm), cr = makeRng(S.seed * 389 + 5), x1 = rm.x + 1 + r.int(0, Math.max(0, Math.min(rm.w, 7) - 5)); // v22: each stall has its own 50% car
        for (let i = 0; i < stalls; i++) { const has = S.opts && S.opts.garageCars != null ? i < S.opts.garageCars : cr() < GARAGE_CFG.carP; if (!has) continue;
          const bx = i ? rm.x + 2 + i * GARAGE_CFG.stallW : x1; let f = null; // the garage door keeps its threshold clear: try rows a step back, then shift sideways
          for (const dy of [5, 6, 7]) { for (const dx of [0, 1, -1, 2]) { f = tryPlace(rm, 'car', bx + dx, rm.y + rm.h - dy, 2, 4, 's'); if (f) break; } if (f) break; }
          if (f) { f.stall = i; f.garageCar = true; } }
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
const COVER_CFG = { exposedAt: 0.15, range: 30, postSep: 5, search: 6, searchWide: 10, snapR: 4, snapWide: 7, doorPad: 2 };
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
  for (const c of S.contain) c.covered = S.units.some(u => (onFoot(u) && dist(u.x, u.y, c.x, c.y) <= 2.3 && true /* v23: no park-cruiser dependence */) || (u.kind === 'cruiser' && u.occ.length && dist(u.x, u.y, c.x, c.y) <= 3));
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
  S.teamMax = O.teamMax || 5; S.llRounds = O.llRounds || ITEM_CFG.lesslethal.rounds;
  // v8: separate rng (map stays identical) — less-lethal specialists and the 70/30 split between the two staging areas
  const q8 = makeRng((S.seed * 31 + S.officers.length * 7 + 5) >>> 0);
  S.officers.forEach(o => { if (o.spec === 'marksman' && !o.quals.includes('ll')) o.quals.push('ll'); });
  const llc = q8.shuffle(S.officers.filter(o => ['point', 'leader', 'breacher', 'medic'].includes(o.spec) && !o.quals.includes('ll'))); if (llc[0]) llc[0].quals.push('ll');
  const rest = q8.shuffle(S.officers.filter(o => o.spec !== 'leader')), nSec = Math.round(S.officers.length * STAGE_CFG.secondary);
  S.officers.forEach(o => { o.stage = 'primary'; }); rest.slice(0, nSec).forEach(o => { o.stage = 'secondary'; });
  setupSpecs19(); // v19: dual specialties, ll/gas/driver specialists, personal gear unlocks (own rng)
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
function hasSpec(t, sp) { return teamOk(t).some(o => o.spec === sp || o.spec2 === sp); }
function isSpec(o, sp) { return !!o && (o.spec === sp || o.spec2 === sp); }
function specMul(o, sp) { return !o ? 0 : o.spec === sp ? 1 : o.spec2 === sp ? SPEC2_MUL : 0; }
function teamSpecMul(t, sp) { return Math.max(0, ...teamOk(t).map(o => specMul(o, sp))); }
function teamSkillBase(t) { const m = teamOk(t); if (!m.length) return 0; let s = m.reduce((a, o) => a + o.skill, 0) / m.length; if (hasSpec(t, 'leader')) s += 0.05; return clamp(s, 0, 1); }
function unitAlive(u) { return u.status === 'ok'; }
function suspectActive() { return S.suspect && !['detained', 'escaped'].includes(S.suspect.mode); }
function hostile() { return S.suspect && ['barricaded', 'alert', 'fleeing'].includes(S.suspect.mode); }
function onFoot(u) { return unitAlive(u) && (u.kind === 'patrol' ? !u.inCar : u.kind === 'team' ? u.deployed && !u.inCar : false); }
function weaponOf(u) { if (u.kind === 'patrol') return u.weapon; if (u.kind === 'team') { const w = teamWeapon(u); return w ? w.k : null; } return null; }
function skillOf(u) { return u.kind === 'team' ? teamSkill(u) : u.kind === 'patrol' ? u.skill : 0.3; }

function log(text, kind = 'radio') { S.log.push({ turn: S.turn, tick: S.tick || 0, text, kind }); S.events.push({ type: 'log', kind }); }
function fx(type, x, y, extra = {}) { S.fx.push(Object.assign({ id: ++S.fxSeq, type, x, y }, extra)); }

function setupSuspect(r) {
  // barricade room varies: any room whose only openings are doors
  const openRoom = new Set(); for (const [k, e] of S.edges) if (e === E_OPEN) { const [t, a, b] = k.split(','); const A = +a, B = +b; const p = t === 'h' ? [[A, B - 1], [A, B]] : [[A - 1, B], [A, B]]; p.forEach(c => openRoom.add(roomAt(c[0], c[1]))); }
  const W0 = { bed: 2, bath: 1.4, office: 1.6, garage: 0.6 };
  const cands = S.rooms.filter(q => W0[q.type] && !openRoom.has(q.id) && !q.unitB);
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
/* v8 vehicles: a car is only driven through an occupant (patrol officer or team). Empty vehicles are static cover props. */
const CAR_SEATS = { cruiser: 2, armored: 11 }; // v20: BearCat = its own designated driver + 11 in the back
function carSeats(c) { return c.armored ? CAR_SEATS.armored : CAR_SEATS.cruiser; }
function seatsUsed(c) { return c.occ.reduce((a, id) => { const q = unit(id); return a + (!q ? 0 : q.kind === 'team' ? Math.max(1, teamOk(q).length) : 1); }, 0); }
function seatsNeeded(u) { return u.kind === 'team' ? Math.max(1, teamOk(u).length) : 1; }
const STAGE_CFG = { secondary: 0.3 };
/** Secondary (on-foot) staging at the other end of the street: low exposure, reachable. No equipment there. */
function setupStaging2() { const st = S.ext.staging, tx = MAP_W - 1 - st.x, D = reach(st.x, st.y, { outdoor: true }, 1e6); let best = null, bs = 1e9;
  for (let y = Math.max(1, st.y - 6); y <= Math.min(MAP_H - 2, st.y + 4); y++) for (let x = Math.max(2, tx - 14); x <= Math.min(MAP_W - 3, tx + 14); x++) { const c = idx(x, y);
    if (D[c] >= 1e9 || S.block[c] || roomAt(x, y) >= 0 || carAt && carAt(x, y)) continue; const s = expoAt(x, y) * 40 + Math.abs(x - tx) * 0.4 + Math.abs(y - st.y) * 0.3 + (suspSees(x, y) ? 30 : 0) + Math.min(x, MAP_W - 1 - x) * 0.15; /* v22: toward the map edge, out of his sight */ if (s < bs) { bs = s; best = [x, y]; } }
  S.ext.staging2 = best ? { x: best[0], y: best[1] } : { x: st.x, y: st.y }; }
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
  for (const sp of suspList()) if (spActive(sp) && sp.room < 0) out.push({ x: sp.x, y: sp.y, w: 1.5, kind: 'suspect' });
  return out;
}
function expoKey() { return S.doors.map(d => d.exterior ? d.state[0] : '').join('') + '|' + S.units.filter(u => u.kind === 'cruiser').map(c => c.x + ',' + c.y + carAxis(c)).join(';') + '|' + knownRoom() + '|' + suspList().filter(sp => sp.room < 0).map(sp => sp.x + ',' + sp.y).join(';'); }
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
  const hung = S.doors.filter(d => d.charge).map(d => doorMid(d));
  let best = null, bs = here * 6 - dist(u.x, u.y, hx, hy) * 0.12;
  for (let y = Math.max(1, u.y - 12); y <= Math.min(MAP_H - 2, u.y + 12); y++) for (let x = Math.max(1, u.x - 12); x <= Math.min(MAP_W - 2, u.x + 12); x++) {
    const c = idx(x, y); if (D[c] >= 1e9 || taken.has(x + ',' + y) || S.room[c] >= 0) continue;
    if (hung.some(([mx, my]) => dist(x, y, mx, my) < CHARGE_SAFE)) continue; /* v22: never take cover inside a hung charge's safety distance */
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
    case 'drone': return u.landed ? { range: 4, half: 1.3, near: 1.5 } : { range: 7, half: Math.PI, near: 7 };
    case 'robot': return u.big ? { range: 7, half: 1.6, near: 2 } : { range: 6, half: 1.6, near: 2 };
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
  for (const c of S.peek) S.vis[c] = 1; v22Vis(); // v22: pole-cam feeds + viewports
  for (const u of W) if (u.slice && u.slice.ox === u.x && u.slice.oy === u.y && u.slice.cells.length) { for (const c of u.slice.cells) S.vis[c] = 1; u.vis = u.vis.concat(u.slice.cells); } // pie-slice reveal
  // mutual sight: if the suspect has a clear line to one of our units inside sight range, that unit sees him too (no facing needed)
  for (const sp0 of suspList()) if (spActive(sp0)) { const sc = idx(sp0.x, sp0.y); for (const u of W) { if (u.kind === 'cruiser' || !u.vis || u.vis.includes(sc)) continue; const p = visParamsG(u);
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
  eachSp(sp => {
  if (sp && suspectActive() && ((S.vis[idx(sp.x, sp.y)] && !hiddenNow(sp)) || (sp.walk && sp.room < 0))) { // a walk-out in the yard is watched by everyone
    if (!sp.seen) { if (multiSp() && !sp.labelled) { sp.labelled = true; sp.label = SUS_LETTERS[suspList().filter(s => s.labelled).length - 1]; }
      log(`CONTACT — ${multiSp() ? spName().toLowerCase() : 'suspect'} visual in ${S.rooms[sp.room] ? S.rooms[sp.room].name : 'yard'}!`, 'alert'); const sc = idx(sp.x, sp.y), who = [];
      for (const u of W) if (u.kind === 'team' && u.vis.includes(sc)) who.push(...teamOk(u).map(o => o.id)); xpAct('locate', who.length ? who : null); }
    if (sp.armor && sp.armor !== 'none' && !sp.armorKnown) revealSuspectArmor('seen');
    sp.seen = true; sp.visible = true; sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn }; sp.heat = null;
  } else if (sp) sp.visible = false; });
  countObserve(); containStatus();
}
/* ===================== v8 INDIVIDUAL OFFICER INVENTORIES =====================
   Each officer carries o.inv = { hands:[L,R], holster:[...], slung:[...], packed:{k:n}, vest:{k:n}, nr:{k:turn}, ll:rounds }.
   Everyone has a holstered handgun + taser. Team-level u.equip is an AGGREGATE rebuilt by syncEquip()
   (only what is usable), so the breach / gas / nego / medical / robot rules keep reading counts;
   consumption goes through useItem(). Holster / sling / switch costs no time, but the weapon is
   NOT READY for one full turn (no return fire, no attacks with it). */
const ITEM_CFG = {
  pistol:     { hands: 1, stow: 'holster', weapon: true },
  taser:      { hands: 1, stow: 'holster', weapon: false },
  rifle:      { hands: 2, oneHand: true, oneHandMul: 0.6, stow: 'slung', weapon: true },
  sniper:     { hands: 2, stow: 'slung', weapon: true },
  lesslethal: { hands: 2, stow: 'slung', qual: 'll', rounds: 4 },
  shield:     { hands: 1, stow: null },              // cannot be slung or packed: always one hand
  shield3:    { hands: 1, stow: null },              // Level III shield: same handling, heavier rating
  plate:      { where: 'worn' },                     // plate carrier: worn armor slot (inv.worn.armor = 'plate')
  draco:      { where: 'vehicle' },                  // BearCat kit: never carried, installed from the pool
  ram:        { hands: 1, useHands: 2, stow: null }, // carried one-handed; breach = both hands (pistol auto-holstered)
  halligan:   { hands: 1, stow: 'packed' },
  polecam:    { hands: 1, stow: 'packed' },
  bullhorn:   { hands: 1, stow: 'packed' },
  charge:     { where: 'vest', needFree: 1, drawTicks: 2 }, // drawing off the vest takes time; hanging needs a free hand
  bang:       { where: 'packed', throwHands: 2 },
  gas:        { where: 'packed', throwHands: 2 },
  medkit:     { where: 'packed', useHands: 2 },
  tphone:     { where: 'packed' },
  drone:      { where: 'packed', spec: 'tech' },
  robot:      { where: 'packed', spec: 'tech' },
  mask:       { where: 'worn', donTurns: 1 },
};
const PERSONAL = ['pistol', 'taser', 'rifle', 'sniper', 'mask']; // issued, not drawn from the equipment pool
const INV_CFG = { notReadyTurns: 1, drawRange: 4.5 };
function newInv(o) { const prim = o.spec === 'marksman' ? 'sniper' : 'rifle';
  const inv = { hands: [prim, prim], holster: ['pistol', 'taser'], slung: [], packed: {}, vest: {}, worn: { mask: false }, mask: 'packed', nr: {}, ll: 0, prim }; takeHome(o, inv); return inv; }
function invOf(o) { if (!o.inv) o.inv = newInv(o); return o.inv; }
function setNotReady(o, k) { const inv = invOf(o); inv.nr[k] = S.phase === 'planning' ? S.turn : S.turn + 1; }
function isReady(o, k) { const inv = invOf(o); return !(inv.nr[k] != null && inv.nr[k] >= S.turn); }
function heldList(o) { const h = invOf(o).hands; return h[0] && h[0] === h[1] ? [h[0]] : h.filter(Boolean); }
function freeHands(o) { return invOf(o).hands.filter(x => !x).length; }
function holds(o, k) { return invOf(o).hands.includes(k); }
function twoHanded(o, k) { const h = invOf(o).hands; return h[0] === k && h[1] === k; }
function carries(o, k) { const inv = invOf(o); return holds(o, k) || inv.slung.includes(k) || inv.holster.includes(k) || (inv.packed[k] || 0) > 0 || (inv.vest[k] || 0) > 0; }
function countOf(o, k) { const inv = invOf(o); return (k === 'plate' && inv.worn.armor === 'plate' ? 1 : 0) + (holds(o, k) ? 1 : 0) + inv.slung.filter(x => x === k).length + (inv.packed[k] || 0) + (inv.vest[k] || 0); }
/** Items an officer can use right now (aggregated into the team's equip). */
function usableCount(o, k) { const c = ITEM_CFG[k] || {};
  if (k === 'lesslethal') return holds(o, 'lesslethal') && (o.quals || []).includes('ll') && invOf(o).ll > 0 && isReady(o, 'lesslethal') && llOk(o) ? 1 : 0;
  if (k === 'cs40') return holds(o, 'lesslethal') && isReady(o, 'lesslethal') && llOk(o) ? (invOf(o).vest.cs40 || 0) : 0;
  if (c.spec && !isSpec(o, c.spec)) return 0;
  return countOf(o, k); }
function syncEquip(t) { if (!t || t.kind !== 'team') return; const e = {}; for (const k in EQUIP) e[k] = 0;
  for (const o of teamOk(t)) for (const k in EQUIP) e[k] += usableCount(o, k);
  t.equip = e; }
function syncAll() { for (const u of S.units) if (u.kind === 'team') syncEquip(u); }
/** Remove one item from whoever on the team carries it (packed/vest first, then hands). Returns the officer. */
function useItem(t, k, pref) { const m = teamOk(t).filter(o => countOf(o, k) > 0 && (k !== 'lesslethal' || usableCount(o, k)));
  const o = (pref && m.find(pref)) || m.find(q => (invOf(q).packed[k] || 0) > 0 || (invOf(q).vest[k] || 0) > 0) || m[0]; if (!o) return null;
  const inv = invOf(o); if (k === 'lesslethal') { llSpend(o); syncEquip(t); return o; }
  if ((inv.vest[k] || 0) > 0) inv.vest[k]--; else if ((inv.packed[k] || 0) > 0) inv.packed[k]--; else if (holds(o, k)) inv.hands = inv.hands.map(x => x === k ? null : x); else { const i = inv.slung.indexOf(k); if (i >= 0) inv.slung.splice(i, 1); }
  syncEquip(t); return o; }
/** Stow whatever is in the hands except `keep` (auto-holster / auto-sling); returns the weapons stowed, to be redrawn. */
function autoStow(o, keep) { const inv = invOf(o), out = [];
  for (const k of heldList(o)) { if (k === keep) continue; const c = ITEM_CFG[k] || {}; if (!c.stow) continue;
    if (c.stow === 'holster') inv.holster.push(k); else if (c.stow === 'slung') inv.slung.push(k); else inv.packed[k] = (inv.packed[k] || 0) + 1;
    inv.hands = inv.hands.map(x => x === k ? null : x); out.push(k); }
  return out; }
/** Redraw after an auto-holster: weapon comes back to hand but is NOT READY for a full turn. */
function autoRedraw(o, list) { for (const k of list || []) { if (!stowedHas(o, k)) continue; const c = ITEM_CFG[k]; const need = c.hands === 2 && !c.oneHand ? 2 : c.hands === 2 && freeHands(o) >= 2 ? 2 : 1; if (freeHands(o) < need) continue; takeFromStow(o, k); putInHands(o, k, need); setNotReady(o, k); } }
function stowOne(o, k) { const inv = invOf(o), c = ITEM_CFG[k]; if (c.stow === 'holster') inv.holster.push(k); else if (c.stow === 'slung') inv.slung.push(k); else inv.packed[k] = (inv.packed[k] || 0) + 1; inv.hands = inv.hands.map(x => x === k ? null : x); }
function stowedHas(o, k) { const inv = invOf(o); return inv.holster.includes(k) || inv.slung.includes(k) || (inv.packed[k] || 0) > 0; }
function takeFromStow(o, k) { const inv = invOf(o); let i = inv.holster.indexOf(k); if (i >= 0) { inv.holster.splice(i, 1); return; } i = inv.slung.indexOf(k); if (i >= 0) { inv.slung.splice(i, 1); return; } if ((inv.packed[k] || 0) > 0) inv.packed[k]--; }
function putInHands(o, k, n) { const inv = invOf(o); if (n >= 2) { inv.hands = [k, k]; return; } const i = inv.hands.indexOf(null); inv.hands[i] = k; }
/** Hands an officer could free for a task (a shield or the ram cannot be put away in the stack). */
/** Can this officer put both hands on the ram (other hand free or holding something that auto-holsters)? */
function ramReady(o) { return holds(o, 'ram') && invOf(o).hands.filter(x => x !== 'ram').every(x => !x || (ITEM_CFG[x] || {}).stow); }
function freeable(o) { return invOf(o).hands.filter(x => !x || (ITEM_CFG[x] || {}).stow).length; }
/** Best member to do a two-handed task with item k (throw / treat). */
function taskMember(t, k, hands) { const m = teamOk(t).filter(o => (!k || countOf(o, k) > 0) && freeable(o) >= hands && (!ITEM_CFG[k] || !ITEM_CFG[k].spec || isSpec(o, ITEM_CFG[k].spec)));
  return m.sort((a, b) => freeHands(b) - freeHands(a) || (a === teamOk(t)[0]) - (b === teamOk(t)[0]))[0] || null; }
/** Perform a hands task: auto-stow, act, auto-redraw (weapons NOT READY for a turn). */
function handsTask(t, k, hands, fn) { const o = taskMember(t, k, hands); if (!o) return null; const st = autoStow(o, hands >= 2 ? null : k); const r = fn(o); autoRedraw(o, st); syncEquip(t); return { o, r, stowed: st }; }
/** Hands task by a specific officer (e.g. the medic). */
function withHands(t, o, hands, fn) { if (!o || freeable(o) < hands) return null; const st = autoStow(o, null); const r = fn(o); autoRedraw(o, st); syncEquip(t); return { o, r, stowed: st }; }
/** Team's best READY weapon in hand (return fire / attacks). null = nobody can shoot this turn. */
function teamWeapon(t) { const m = teamOk(t); let best = null, one = false;
  const rank = { sniper: 3, rifle: 2, pistol: 1 };
  for (const o of m) for (const k of heldList(o)) { if (!rank[k] || !isReady(o, k)) continue; const oh = k === 'rifle' && !twoHanded(o, k); if (k === 'sniper' && !twoHanded(o, k)) continue;
    const sc = rank[k] - (oh ? 0.5 : 0); if (!best || sc > best.sc) { best = { k, sc, oh, o }; } }
  return best; }
function invView(o) { const inv = invOf(o); const h = inv.hands; return { hands: h.slice(), two: !!(h[0] && h[0] === h[1]), holster: inv.holster.slice(), slung: inv.slung.slice(), packed: Object.assign({}, inv.packed), vest: Object.assign({}, inv.vest), ll: inv.ll, mask: inv.mask,
  notReady: Object.keys(inv.nr).filter(k => !isReady(o, k)), free: freeHands(o) }; }
function atEquipment(x, y) { return dist(x, y, S.ext.staging.x, S.ext.staging.y) <= INV_CFG.drawRange; }
function offPos(o) { const t = o.team ? unit(o.team) : null; if (t) return [t.x, t.y]; const st = o.stage === 'secondary' && S.ext.staging2 ? S.ext.staging2 : S.ext.staging; return [st.x, st.y]; }
/* ---- player loadout actions (planning phase). None costs a turn; weapons changed are NOT READY for a turn. ---- */
function invActBase(offId, act, k) {
  if (S.phase !== 'planning') return { ok: false, reason: 'Change loadout during planning' };
  const o = off(offId); if (!o || o.status === 'enroute' || o.status === 'down') return { ok: false, reason: 'Officer unavailable' };
  const inv = invOf(o), c = ITEM_CFG[k] || {}, t = o.team ? unit(o.team) : null; if (t && t.inCar) return { ok: false, reason: 'Get out of the vehicle first' };
  const done = r => { if (t) syncEquip(t); S.version++; return Object.assign({ ok: true }, r || {}); };
  if (act === 'stow') { if (!holds(o, k)) return { ok: false, reason: 'Not in hand' }; if (!c.stow) return { ok: false, reason: k === 'shield' || k === 'shield3' ? 'A shield cannot be slung or packed — it stays in one hand (hand it back at the equipment vehicle)' : `The ${EQUIP[k] ? EQUIP[k].short : k} cannot be stowed — hand it back at the equipment vehicle` };
    stowOne(o, k); setNotReady(o, k); return done({ notReady: k }); }
  if ((act === 'switch' || act === 'hold') && holds(o, k)) return { ok: false, reason: 'Already in hand' };
  if (act === 'switch') { const need = c.hands === 2 && !c.oneHand ? 2 : c.hands || 1;
    for (const h of heldList(o).slice().reverse()) { if (freeHands(o) >= need) break; if (h === k || !(ITEM_CFG[h] || {}).stow) continue; stowOne(o, h); setNotReady(o, h); }
    if (freeHands(o) < need) return { ok: false, reason: 'Hands are full with items that cannot be put away here' }; act = 'hold'; }
  if (act === 'hold') { if (holds(o, k)) return { ok: false, reason: 'Already in hand' }; if (!stowedHas(o, k)) return { ok: false, reason: 'Not carried' };
    if (c.qual && !(o.quals || []).includes(c.qual)) return { ok: false, reason: 'Only a less-lethal specialist may use the 40mm launcher' };
    const need = c.hands === 2 && !c.oneHand ? 2 : c.hands || 1; if (freeHands(o) < need) return { ok: false, reason: `Needs ${need} free hand${need > 1 ? 's' : ''} — stow something first` };
    takeFromStow(o, k); putInHands(o, k, c.hands === 2 && freeHands(o) >= 2 ? 2 : need); setNotReady(o, k); return done({ notReady: k }); }
  if (act === 'grip') { if (k !== 'rifle' || !holds(o, 'rifle')) return { ok: false, reason: 'Only a rifle changes grip' };
    if (twoHanded(o, 'rifle')) inv.hands = ['rifle', null]; else { if (freeHands(o) < 1) return { ok: false, reason: 'Other hand is busy' }; inv.hands = ['rifle', 'rifle']; } return done(); }
  if (act === 'draw' || act === 'return') { const [x, y] = offPos(o); if (!atEquipment(x, y)) return { ok: false, reason: 'Equipment is drawn at the equipment vehicle (primary staging) — move there first' };
    if (!EQUIP[k]) return { ok: false, reason: 'Unknown item' };
    if (k === 'draco') return { ok: false, reason: 'The Draco arm kit is installed on the BearCat — order a team at the vehicle to Install Draco Arm' };
    if (act === 'return') { if (!countOf(o, k)) return { ok: false, reason: 'Not carried' }; const inv2 = inv; if (k === 'plate') inv2.worn.armor = 'soft'; else if ((inv2.vest[k] || 0) > 0) inv2.vest[k]--; else if ((inv2.packed[k] || 0) > 0) inv2.packed[k]--; else if (holds(o, k)) inv2.hands = inv2.hands.map(q => q === k ? null : q); else inv2.slung.splice(inv2.slung.indexOf(k), 1);
      S.armory[k]++; if (k === 'lesslethal') inv.ll = 0; return done(); }
    if (!(S.armory[k] > 0)) return { ok: false, reason: 'None left at the equipment vehicle' };
    if (c.qual && !(o.quals || []).includes(c.qual)) return { ok: false, reason: 'Less-lethal launcher: specialist only' };
    if (c.spec && !isSpec(o, c.spec)) return { ok: false, reason: `${EQUIP[k].short}: ${SPECS[c.spec].name} only` };
    if (k === 'plate') { if (inv.worn.armor === 'plate') return { ok: false, reason: 'Already wearing rifle plates' }; inv.worn.armor = 'plate'; }
    else if (c.where === 'vest') inv.vest[k] = (inv.vest[k] || 0) + 1;
    else if (c.where === 'packed') inv.packed[k] = (inv.packed[k] || 0) + 1;
    else { const need = c.hands === 2 ? 2 : 1; if (freeHands(o) < need) { if (c.stow) { if (c.stow === 'slung') inv.slung.push(k); else inv.packed[k] = (inv.packed[k] || 0) + 1; } else return { ok: false, reason: `${EQUIP[k].short} needs ${need} free hand${need > 1 ? 's' : ''} (it cannot be slung or packed) — stow something first` }; }
      else putInHands(o, k, need); if (c.hands) setNotReady(o, k); }
    S.armory[k]--; if (k === 'lesslethal') inv.ll = S.llRounds || ITEM_CFG.lesslethal.rounds; return done(); }
  return { ok: false, reason: 'Unknown action' };
}
/** Default kit for a team formed at the equipment vehicle (from the pool, limited by team level). */
function defaultKit(t) { const m = teamOk(t), take = k => { if (S.armory[k] > 0) { S.armory[k]--; return true; } return false; };
  const by = sp => m.filter(o => o.spec === sp); // primary specialty only: secondary-specialty kit is fetched by hand
  const pt = m[0], dfn = m[1];
  for (const o of m) if (armorOf(o) !== 'plate' && take('plate')) invOf(o).worn.armor = 'plate'; // individually issued rifle plates while the pool lasts
  const sk = S.armory.shield3 > 0 ? 'shield3' : 'shield';
  if (pt && holds(pt, 'shield') && S.armory.shield3 > 0) { S.armory.shield3--; invOf(pt).hands = invOf(pt).hands.map(x => x === 'shield' ? 'shield3' : x); } // v19: III shield from the vehicle replaces the take-home IIIA
  else if (pt && pt.spec !== 'll' && !shieldOf(pt) && !holds(pt, 'ram') && take(sk)) { const inv = invOf(pt); inv.slung.push(inv.prim); inv.hands = [sk, 'pistol']; inv.holster = inv.holster.filter(k => k !== 'pistol'); }
  const br = by('breacher'), brx = br.filter(o => o !== pt); const hasRam = m.some(o => holds(o, 'ram')); const ramMan = hasRam ? m.find(o => holds(o, 'ram')) : brx.find(o => !shieldOf(o)) || m.find(o => o !== pt && o !== dfn && o.spec !== 'marksman' && !shieldOf(o)) || null;
  if (ramMan && !hasRam && take('ram')) { const inv = invOf(ramMan); inv.slung.push(inv.prim); inv.hands = ['ram', 'pistol']; inv.holster = inv.holster.filter(k => k !== 'pistol'); }
  const hal = brx[1] || m.find(o => o !== pt && o !== ramMan && o !== dfn && o.spec !== 'marksman'); if (hal && !m.some(o => carries(o, 'halligan')) && take('halligan')) invOf(hal).packed.halligan = 1;
  for (const b of br) for (let i = 0; i < 2; i++) if (take('charge')) invOf(b).vest.charge = (invOf(b).vest.charge || 0) + 1;
  const fixedH = o => shieldOf(o) || holds(o, 'ram'); const free = m.filter(o => o !== pt && !fixedH(o)), throwers = free.length ? free : m.filter(o => o !== pt).concat(pt ? [pt] : []); let ti = 0; // v19: free-handed officers carry the bangs (take-home shields / rams stay in hand)
  for (const k of ['bang', 'bang', 'gas']) { const o = throwers[ti++ % Math.max(1, throwers.length)]; if (o && take(k)) invOf(o).packed[k] = (invOf(o).packed[k] || 0) + 1; }
  for (const o of by('tech')) { if (!carries(o, 'drone') && take('drone')) invOf(o).packed.drone = 1; if (take('robot')) invOf(o).packed.robot = 1; }
  for (const o of by('medic')) if (!carries(o, 'medkit') && take('medkit')) invOf(o).packed.medkit = 1;
  const ll1 = m.find(o => carries(o, 'lesslethal') && llMagOf(invOf(o)) === 1);
  if (ll1) { if (S.armory.lesslethal > 0) { S.armory.lesslethal--; upgradeLL(ll1); } }
  else { const llo = m.find(o => (o.quals || []).includes('ll') && o.spec !== 'marksman' && o !== pt && o !== ramMan && !shieldOf(o) && !holds(o, 'ram')) || by('marksman').find(o => (o.quals || []).includes('ll'));
  if (llo && take('lesslethal')) { const inv = invOf(llo); if (llo.spec === 'marksman') inv.slung.push('lesslethal'); else { if (!inv.slung.includes(inv.prim)) inv.slung.push(inv.prim); inv.hands = ['lesslethal', 'lesslethal']; } inv.ll = S.llRounds || ITEM_CFG.lesslethal.rounds; upgradeLL(llo, true); } }
  for (const o of by('gas')) if (!carries(o, 'gasbag') && take('gasbag')) { invOf(o).packed.gasbag = 1; invOf(o).packed.gas = (invOf(o).packed.gas || 0) + GAS19.bag; }
  for (const o of by('negotiator')) { if (take('tphone')) invOf(o).packed.tphone = 1; if (take('bullhorn')) invOf(o).packed.bullhorn = 1; }
  const ld = by('leader')[0]; if (ld && !m.some(o => carries(o, 'bullhorn')) && take('bullhorn')) invOf(ld).packed.bullhorn = 1;
  syncEquip(t); }
/* =====================================================================
   ARMOR & BALLISTIC SHIELDS (v9) — one data table, easy to retune.
   Every officer (patrol + SWAT) wears soft Level IIIA torso armor. Upgraded SWAT draw rifle
   plates (plate carrier) at the equipment vehicle. A hit first rolls the zone: torso (armored)
   vs uncovered areas (arms, legs, head). Armor that stops a round can still leave a SMALL
   blunt-impact injury at very close range — mostly from shotguns.
   ===================================================================== */
const ARMOR = {
  none:  { name: 'No armor',               short: '—',        stops: { pistol: 0, shotgun: 0, rifle: 0, sniper: 0 } },
  soft:  { name: 'Level IIIA soft armor',  short: 'IIIA',     stops: { pistol: 1, shotgun: 1, rifle: 0, sniper: 0 } },
  plate: { name: 'IIIA + rifle plates',    short: 'IIIA+PL',  stops: { pistol: 1, shotgun: 1, rifle: 0.88, sniper: 0.6 } },
};
const ARMOR_CFG = {
  torso: 0.6,             // share of hits on an officer that land on the armored torso (rest: arms / legs / head)
  bluntRange: 3,          // cells: inside this a stopped round can still cause a small blunt-impact injury
  blunt: { pistol: 0.18, shotgun: 0.5, rifle: 0.3, sniper: 0.35 }, // chance at point blank (fades to 0 at bluntRange)
  suspect: 0.07,          // chance the suspect wears body armor
  suspectPlate: 0.15,     // …and of those, chance it has rifle plates (otherwise soft IIIA)
  suspectTorso: 0.6,      // share of officer hits on him that strike the torso
  suspectTorsoWindow: 0.45, // in a window he shows mostly head and shoulders — the uncovered share goes up
};
/* Ballistic shields: one hand, never slung (ITEM_CFG). Frontal arc only, partial coverage. */
const SHIELDS = {
  shield:  { name: 'Level IIIA ballistic shield', short: 'IIIA shield', stops: { pistol: 1, shotgun: 1, rifle: 0, sniper: 0 } },
  shield3: { name: 'Level III ballistic shield',  short: 'III shield',  stops: { pistol: 1, shotgun: 1, rifle: 0.6, sniper: 0.35 } },
};
const SHIELD_CFG = { arc: 1.2 /* rad half-angle of the frontal arc */, cover: 0.7 /* body share behind it (feet/limbs stick out) */, stack: 0.35 /* stacked teammates behind the point shield */ };
/** Suspect weapon → ballistic class. */
const SUSPECT_CAL = { handgun: 'pistol', shotgun: 'shotgun', rifle: 'rifle' };
function armorOf(o) { if (!o) return 'soft'; if (o.inv) return (o.inv.worn && o.inv.worn.armor) || 'soft'; return o.armor || 'soft'; }
function shieldOf(o) { if (!o || !o.inv) return null; return holds(o, 'shield3') ? 'shield3' : holds(o, 'shield') ? 'shield' : null; }
function teamShield(t) { return t && t.kind === 'team' && teamOk(t).some(o => shieldOf(o)); }
const angDiff = (a, b) => { let d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
/** Pick the officer of a team who takes a hit (the point most often when the threat is to the front). */
/** Door stack exposure: a team stacked at a doorway, fired on from the far side of that door, can only be hit in the doorway pair
    (POINT and DEFENSE at the frame) — the rest are on the wall beside the opening, out of the line of fire. */
function doorExposed(t, fx_, fy) { if (!t || t.kind !== 'team' || fx_ === undefined) return null; const ok = teamOk(t); if (ok.length < 2) return null;
  const f = formationFor(t); if (f.kind !== 'stack') return null; if (roomAt(Math.round(fx_), Math.round(fy)) === roomAt(t.x, t.y)) return null;
  return ok.slice(0, 2); }
function pickVictim(t, fx_, fy) { const ok = teamOk(t); if (!ok.length) return null;
  const ex = doorExposed(t, fx_, fy); if (ex) return S.rng.chance(0.6) ? ex[0] : ex[1];
  const front = fx_ === undefined || t.dir === undefined || angDiff(Math.atan2(fy - t.y, fx_ - t.x), t.dir) <= SHIELD_CFG.arc;
  const pt = ok.find(o => o.spec === 'point') || ok[0];
  return front && S.rng.chance(0.55) ? ok[0] : S.rng.chance(0.4) ? pt : S.rng.pick(ok); }
/** Resolve a round that hit an officer. who: officer record (team member) or patrol unit; t: the unit (team/patrol).
    Returns { res: 'shield' | 'stopped' | 'blunt' | 'pen', zone, by }. */
function armorHit(who, t, cal, d, fx_, fy) { const r = S.rng;
  // ballistic shield (frontal arc, partial coverage); teammates stacked behind the point shield get some of it
  if (t && t.kind === 'team') { const front = fx_ === undefined || t.dir === undefined || angDiff(Math.atan2(fy - t.y, fx_ - t.x), t.dir) <= SHIELD_CFG.arc;
    const own = shieldOf(who), ptS = shieldOf(teamOk(t)[0]);
    const sk = own || (ptS && who !== teamOk(t)[0] ? ptS : null), share = own ? SHIELD_CFG.cover : SHIELD_CFG.stack;
    if (sk && front && r.chance(share)) { if (r.chance(SHIELDS[sk].stops[cal] || 0)) return { res: 'shield', zone: 'shield', by: sk }; } }
  if (!r.chance(ARMOR_CFG.torso)) return helmetStops(who, cal) ? { res: 'helmet', zone: 'head', by: helmetOf(who) } : { res: 'pen', zone: 'limb' }; // v19 helmet: own rng
  const a = armorOf(who); if (!r.chance(ARMOR[a].stops[cal] || 0)) return { res: 'pen', zone: 'torso', by: a };
  const bp = (ARMOR_CFG.blunt[cal] || 0) * clamp(1 - (d - 1) / Math.max(0.5, ARMOR_CFG.bluntRange - 1), 0, 1);
  return { res: d <= ARMOR_CFG.bluntRange && r.chance(bp) ? 'blunt' : 'stopped', zone: 'torso', by: a }; }
/** A round from the suspect has hit team / patrol unit t. Applies armor, logs, creates the casualty. Returns the armor result. */
function shotOfficer(t, cal, d, fx_, fy, where, opt) {
  const who = t.kind === 'team' ? (opt && opt.victim) || pickVictim(t, fx_, fy) : t; if (!who) return null;
  const a = armorHit(who, opt && opt.noShield ? null : t, cal, d, fx_, fy); S.stats.armorStops = (S.stats.armorStops || 0) + (a.res === 'pen' ? 0 : 1);
  const nm = who.name, src = where ? ` from the ${where}` : '';
  if (a.res === 'shield') { fx('text', t.x, t.y, { text: 'SHIELD', color: '#7fe3ff' }); log(`SHOTS FIRED${src} — round stopped by ${nm}'s ${SHIELDS[a.by].short}. Unhurt.`, 'alert'); }
  else if (a.res === 'stopped') { fx('text', t.x, t.y, { text: 'ARMOR', color: '#7fe3ff' }); log(`SHOTS FIRED${src} — ${nm} hit in the vest; the ${ARMOR[a.by].short} armor stopped it. Unhurt, still in the fight.`, 'alert'); }
  else if (a.res === 'helmet') { fx('text', t.x, t.y, { text: 'HELMET', color: '#7fe3ff' }); log(`SHOTS FIRED${src} — round deflected by ${nm}'s ${HELMETS[a.by].short}. Unhurt, still in the fight.`, 'alert'); }
  else if (a.res === 'blunt') { S.stats.minor = (S.stats.minor || 0) + 1; officerDown(t, null, { victim: who, minor: true, cal }); }
  else officerDown(t, null, { victim: who });
  return a; }
/** Suspect's own armor: does it stop an officer's round? cal: 'pistol' | 'rifle' | 'sniper' | 'shotgun'. */
function suspectArmorStops(cal) { const sp = S.suspect; if (!sp.armor || sp.armor === 'none') return false;
  if (!S.rng.chance(sp.atWindow ? ARMOR_CFG.suspectTorsoWindow : ARMOR_CFG.suspectTorso)) return false; // head / limbs / uncovered window shot
  return S.rng.chance(ARMOR[sp.armor].stops[cal] || 0); }
function setupSuspectArmor() { const r = makeRng(S.seed * 977 + 13), sp = S.suspect; // separate stream: the map and the rest of the scenario stay identical
  const p = S.opts && S.opts.suspectArmor !== undefined ? S.opts.suspectArmor : ARMOR_CFG.suspect;
  sp.armor = r.chance(p) ? (r.chance(ARMOR_CFG.suspectPlate) ? 'plate' : 'soft') : 'none'; sp.armorKnown = false; }
function revealSuspectArmor(how) { const sp = S.suspect; if (!sp.armor || sp.armor === 'none') return; if (how === 'stop') { sp.armorKnown = true; log('The round appears to have been stopped by body armor.', 'intel'); return; } if (sp.armorKnown) return; sp.armorKnown = true;
  log(how === 'stop' ? 'The round appears to have been stopped by body armor.' : `${spName()} appears to be wearing body armor (${sp.armor === 'plate' ? 'plate carrier' : 'soft vest'}).`, 'intel'); }
function hasShield(t) { return !!(t && t.equip && ((t.equip.shield || 0) + (t.equip.shield3 || 0)) > 0); }

/** Armor summary for the UI: soft / plate counts and the best shield held. */
function teamArmor(t) { const ok = t && t.kind === 'team' ? teamOk(t) : []; const r = { soft: 0, plate: 0, shield: null };
  for (const o of ok) { armorOf(o) === 'plate' ? r.plate++ : r.soft++; const sh = shieldOf(o); if (sh && (!r.shield || sh === 'shield3')) r.shield = sh; } return r; }
/* ===================== v19 SPECIALTIES · TAKE-HOME GEAR · EQUIPMENT ISSUE =====================
   Everyone is a basic operator first. Personal kit (always with the officer, also on foot at secondary staging):
   pistol, rifle, taser, the best body armor and helmet the team has, gas mask — plus the PRIMARY specialty's take-home items.
   Everything else lives on the equipment vehicle (primary staging) and is drawn on the issue screen.
   A secondary specialty gives 75% of the skill bonus; its equipment is never auto-issued (fetch it at the vehicle). */
const SPEC2_MUL = 0.75;
Object.assign(SPECS, {
  ll:     { name: 'Less-Lethal Specialist', icon: '◍', desc: 'Carries a single-shot 40mm (reload = a full turn). Draws the 4-shot 40mm + 40mm CS rounds at the equipment vehicle' },
  gas:    { name: 'Gas Specialist', icon: '☁', desc: 'Standard gear; with a Gas Bag from the equipment vehicle, hand-thrown canisters land where intended far more often' },
  driver: { name: 'Driver', icon: '⛟', desc: 'Drives the BearCat or the equipment vehicle; standard gear' },
});
SPECS.marksman.desc += '. Carries the precision rifle and a spotting scope';
SPECS.point.desc += '. Carries a IIIA ballistic shield (Level III shields are on the equipment vehicle)';
SPECS.breacher.desc += '. Carries ram + halligan; charges come from the equipment vehicle';
SPECS.medic.desc += '. Carries a medical bag';
SPECS.tech.name = 'Robot / Drone / EOD Op'; SPECS.tech.desc = 'Operates drones and robots — all robotics live on the equipment vehicle (standard personal gear)';
Object.assign(EQUIP, {
  gasbag: { name: 'Gas Bag',          short: 'Gas Bag', pool: 1, desc: 'Bag of hand-thrown CS canisters (+3 canisters). A gas specialist throws them with better accuracy.' },
  cs40:   { name: '40mm CS Round',    short: '40mm CS', pool: 6, desc: 'CS round for either 40mm launcher (single-shot or 4-shot): fired through a window, an open door or at the suspect. About 1/4 of the gas of a hand-thrown canister.' },
  scope:  { name: 'Spotting Scope',   short: 'Scope',   pool: 0, desc: 'Sniper / overwatch spotting scope.' },
});
Object.assign(ITEM_CFG, { gasbag: { where: 'packed' }, cs40: { where: 'vest' }, scope: { where: 'packed' } });
const GAS19 = { bag: 3, miss: 0.12, specCut: 0.8, missAmt: 0.45 };
const CS40_CFG = { frac: 0.25, issue: 4, range: 11 };
const LL19 = { singleMag: 1, multiMag: 4 };
const HELMETS = { std: { name: 'Ballistic helmet (IIIA)', short: 'IIIA helmet', stops: { pistol: 0.9, shotgun: 0.9, rifle: 0, sniper: 0 } },
  rifle: { name: 'Rifle-rated helmet', short: 'Rifle helmet', stops: { pistol: 1, shotgun: 1, rifle: 0.5, sniper: 0.2 } } };
const HELMET_CFG = { head: 0.3 }; // share of non-torso hits that strike the helmet
/** TAKE-HOME by primary specialty: [item, gear type the team must have unlocked]. */
const TAKE_HOME = { point: [['shield', 'shield']], breacher: [['ram', 'ram'], ['halligan', 'halligan']], ll: [['lesslethal', 'lesslethal']],
  marksman: [['sniper', null], ['scope', null]], medic: [['medkit', 'medkit']], tech: [['drone', 'drone']] }; // v23: robotics specialists bring one drone from home
function gearHave(k) { return !k || !S.gearHave || !!S.gearHave[k]; }
function bestArmor() { return gearHave('plate') ? 'plate' : 'soft'; }
function bestHelmet() { return gearHave('plate') ? 'rifle' : 'std'; }
function helmetOf(o) { return o && o.inv && o.inv.worn ? o.inv.worn.helmet || null : null; }
function takeHomeList(o) { return (TAKE_HOME[o.spec] || []).filter(([k, g]) => gearHave(g)).map(([k]) => k); }
function takeHomeBase(o, inv) { inv.worn.armor = bestArmor(); inv.worn.helmet = bestHelmet(); inv.home = takeHomeList(o);
  const toHand = k => { if (!inv.slung.includes(inv.prim)) inv.slung.push(inv.prim); inv.hands = [k, 'pistol']; inv.holster = inv.holster.filter(x => x !== 'pistol'); };
  for (const k of inv.home) {
    if (k === 'shield' || k === 'ram') { if (!inv.hands.includes('shield') && !inv.hands.includes('ram')) toHand(k); else inv.packed[k] = (inv.packed[k] || 0) + 1; }
    else if (k === 'lesslethal') { inv.slung.push('lesslethal'); inv.llMag = LL19.singleMag; inv.ll = S.llRounds || ITEM_CFG.lesslethal.rounds; inv.llLoad = 1; }
    else if (k !== 'sniper') inv.packed[k] = (inv.packed[k] || 0) + 1; } }
/* ---- 40mm: single-shot (take-home) or 4-shot (vehicle). inv.ll = rounds carried, inv.llLoad = rounds in the launcher ---- */
function llMagOf(inv) { return inv.llMag || LL19.multiMag; }
function llOk(o) { const inv = invOf(o); return !(inv.reloadT >= S.turn) && inv.llTurn !== S.turn; }
function llSpend(o) { const inv = invOf(o), mag = llMagOf(inv); if (inv.llLoad == null) inv.llLoad = Math.min(mag, inv.ll);
  inv.ll = Math.max(0, inv.ll - 1); inv.llLoad = Math.max(0, inv.llLoad - 1); inv.llTurn = S.turn;
  if (inv.llLoad <= 0 && inv.ll > 0) { inv.llLoad = Math.min(mag, inv.ll); inv.reloadT = S.phase === 'planning' ? S.turn : S.turn + 1; log(`${o.name}: reloading the ${mag === 1 ? 'single-shot' : '4-shot'} 40mm — takes a full turn.`, 'radio'); } }
function upgradeLL(o, fresh) { const inv = invOf(o); inv.llMag = LL19.multiMag; if (!fresh) inv.ll = Math.max(inv.ll, S.llRounds || ITEM_CFG.lesslethal.rounds); inv.llLoad = Math.min(LL19.multiMag, inv.ll); inv.reloadT = -1;
  let n = 0; while (n < CS40_CFG.issue && S.armory.cs40 > 0) { S.armory.cs40--; n++; } if (n) inv.vest.cs40 = (inv.vest.cs40 || 0) + n; }
function llKind(o) { const inv = invOf(o); return carries(o, 'lesslethal') ? (llMagOf(inv) === 1 ? 'single' : 'multi') : null; }
/* ---- loadout actions with the v19 rules, then the v8 base rules ---- */
function invAct19(offId, act, k) {
  const o = off(offId); if (!o || S.phase !== 'planning') return invActBase(offId, act, k);
  const inv = invOf(o), t = o.team ? unit(o.team) : null, done = () => { if (t) syncEquip(t); S.version++; return { ok: true }; };
  const atEq = () => { const [x, y] = offPos(o); return atEquipment(x, y); };
  if (act === 'return' && (inv.home || []).includes(k) && !(k === 'lesslethal' && llKind(o) === 'multi') && !(k === 'shield' && !carries(o, 'shield'))) {
    if (k !== 'lesslethal' && countOf(o, k) > ((inv.home || []).filter(x => x === k).length)) return invActBase(offId, act, k);
    if (atEq() && k !== 'lesslethal') { const i = inv.home.indexOf(k); inv.home.splice(i, 1); const r = invActBase(offId, act, k); if (!r.ok) inv.home.splice(i, 0, k); return r; } // v20: leave it at the vehicle (e.g. deploy a breacher with no ram)
    return { ok: false, reason: `${EQUIP[k] ? EQUIP[k].short : k}: can only be left at the equipment vehicle (primary staging)` }; }
  if (act === 'draw' && k === 'cs40') { if (!llKind(o)) return { ok: false, reason: '40mm CS rounds fire from a 40mm launcher (single-shot or 4-shot) — carry one first' }; }
  if (act === 'draw' && k === 'lesslethal' && llKind(o) === 'single') { if (!atEq()) return invActBase(offId, act, k); if (!(S.armory.lesslethal > 0)) return { ok: false, reason: 'No 4-shot launcher left at the equipment vehicle' };
    S.armory.lesslethal--; upgradeLL(o); return done(); }
  if (act === 'return' && k === 'lesslethal' && llKind(o) === 'multi' && (inv.home || []).includes('lesslethal')) { if (!atEq()) return invActBase(offId, act, k);
    S.armory.lesslethal++; S.armory.cs40 += inv.vest.cs40 || 0; inv.vest.cs40 = 0; inv.llMag = LL19.singleMag; inv.ll = S.llRounds || ITEM_CFG.lesslethal.rounds; inv.llLoad = 1; return done(); }
  if (act === 'draw' && k === 'gasbag') { const r = invActBase(offId, act, k); if (r.ok) { inv.packed.gas = (inv.packed.gas || 0) + GAS19.bag; if (t) syncEquip(t); } return r; }
  if (act === 'return' && k === 'gasbag') { const r = invActBase(offId, act, k); if (r.ok) { inv.packed.gas = Math.max(0, (inv.packed.gas || 0) - GAS19.bag); if (t) syncEquip(t); } return r; }
  const r = invActBase(offId, act, k);
  if (r.ok && k === 'lesslethal' && act === 'draw') upgradeLL(o, true);
  if (r.ok && k === 'lesslethal' && act === 'return') { S.armory.cs40 += inv.vest.cs40 || 0; inv.vest.cs40 = 0; }
  if (r.ok && t) syncEquip(t);
  return r; }
/** Equipment the officer's SECONDARY specialty would use (fetched by hand at the vehicle). */
const SPEC_KIT = { point: ['shield3', 'shield'], breacher: ['charge', 'ram', 'halligan'], ll: ['lesslethal', 'cs40'], gas: ['gasbag'], marksman: [], medic: ['medkit'], tech: ['drone', 'robot'], negotiator: ['tphone', 'bullhorn'] };
function fetchSecondary(offId) { const o = off(offId); if (!o || !o.spec2) return { ok: false, reason: 'No secondary specialty' };
  const got = []; let why = null;
  for (const k of SPEC_KIT[o.spec2] || []) { if (k === 'shield' && got.includes('shield3')) continue; if (k === 'cs40' && !got.includes('lesslethal') && !llKind(o)) continue;
    const r = invAct(offId, 'draw', k); if (r.ok) got.push(k); else why = why || r.reason; if (k === 'cs40' && r.ok) break; }
  return got.length ? { ok: true, got } : { ok: false, reason: why || 'Nothing to fetch for that specialty' }; }
/** Issue-screen model for a team. */
function issueView(uid) { const t = unit(uid); if (!t || t.kind !== 'team') return null; const m = t.members.map(off);
  const atEq = atEquipment(t.x, t.y);
  return { team: t.uid, name: t.name, atEq, stage: atEq ? 'primary' : 'secondary', members: m.map(o => ({ id: o.id, name: o.name, spec: o.spec, spec2: o.spec2 || null, home: (invOf(o).home || []).slice(), armor: armorOf(o), helmet: helmetOf(o),
    ll: llKind(o), cs40: invOf(o).vest.cs40 || 0, kit2: (SPEC_KIT[o.spec2] || []).filter(k => (S.armory[k] || 0) > 0 && !carries(o, k)) })),
    pool: Object.keys(EQUIP).filter(k => k !== 'draco' && k !== 'scope' && (S.gearHave ? S.gearHave[k] || S.armory[k] > 0 : true)).map(k => ({ k, n: S.armory[k] })) }; }
/* ---- dual specialties: secondary specialty + v19 primary specialties (own rng: the map and roster draw stay identical) ---- */
const SPEC2_POOL = ['point', 'breacher', 'll', 'gas', 'medic', 'negotiator', 'tech', 'marksman'];
function setupSpecs19() { const q = makeRng((S.seed * 53 + S.officers.length * 11 + 19) >>> 0), O = S.opts || {};
  const roster = O.roster && O.roster.length ? O.roster : null;
  S.officers.forEach((o, i) => { const ro = roster ? roster[i] : null; if (ro && ro.spec2) o.spec2 = ro.spec2; });
  const nth = (sp, n) => S.officers.filter(o => o.spec === sp)[n];
  if (!roster || !roster.some(r => r.spec2)) {
    if (S.officers.length >= 10) { const b = nth('breacher', 1); if (b) { b.spec = 'll'; b.spec2 = 'breacher'; } const p = nth('point', 1) || nth('negotiator', 1); if (p) { p.spec2 = p.spec; p.spec = 'gas'; } }
    for (const o of q.shuffle(S.officers.slice())) { if (o.spec2 || o.spec === 'leader' || o.spec === 'k9' || !q.chance(0.35)) continue; const c = SPEC2_POOL.filter(s => s !== o.spec); o.spec2 = q.pick(c); } }
  S.officers.forEach(o => { if (o.spec === 'driver') { o.spec = o.spec2 && o.spec2 !== 'driver' ? o.spec2 : 'point'; o.spec2 = null; } if (o.spec2 === 'driver') o.spec2 = null; }); // v20: the BearCat has its own driver — never on the roster
  S.officers.forEach(o => { if ((o.spec === 'll' || o.spec2 === 'll') && !o.quals.includes('ll')) o.quals.push('ll'); });
  S.gearHave = {}; for (const k in S.armory) S.gearHave[k] = S.armory[k] > 0;
  S.gearHave.sniper = true; S.gearHave.scope = true;
  S.officers.forEach(o => { o.inv = null; invOf(o); }); } // personal kit is with every officer from the call-out
/** Gas-canister throw accuracy (own rng stream). Returns the amount deployed into the room. */
function gasThrowAmt(o) { if (!S.r19) S.r19 = makeRng((S.seed * 6113 + 3) >>> 0);
  const mul = o && carries(o, 'gasbag') ? specMul(o, 'gas') : 0, miss = GAS19.miss * (1 - GAS19.specCut * mul);
  return S.r19() < miss ? GAS19.missAmt : 1.1; }
function helmetStops(o, cal) { const h = helmetOf(o); if (!h) return false; if (!S.rH) S.rH = makeRng((S.seed * 4441 + 7) >>> 0);
  return S.rH() < HELMET_CFG.head && S.rH() < (HELMETS[h].stops[cal] || 0); }
/** 40mm CS: adds about a quarter of a canister to the room (several rounds stack up to a full canister). */
function gasAdd(roomId, amt) { const q = S.rooms[roomId]; let s = 0, n = 0;
  for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) { const c = idx(x, y); if (S.room[c] === roomId) { S.gas[c] = Math.min(1.1, S.gas[c] + amt); S.gasSeen[c] = S.gas[c]; s += S.gas[c]; n++; } }
  q.gas = n ? s / n : amt; S.gasActive = true; S.gasEver = true; }

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
    const where = nb.rear ? ' (rear row, behind the house)' : (nb.north === (hy < S.geo.ST)) ? '' : ' across the street';
    S.perches.push({ id: S.perches.length, nb: i, x: best[0], y: best[1], entry, kind: nb.storeys === 2 ? 'upper-floor window' : 'rooftop', sightLines: Math.round(bs * 10) / 10,
      name: `Neighbor house ${compass(cx - hx, cy - hy)}${where}` });
  });
}
function perchAt(x, y) { return S.perches.find(p => { const nb = S.ext.nb[p.nb]; return nb.parts.some(q => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h); }) || null; }
/** The sniper's spotter (best available team-mate) and its bonus. */
function spotterOf(u) {
  if (!u || u.kind !== 'team' || !hasSpec(u, 'marksman')) return null;
  const ok = teamOk(u), shooter = ok.find(o => o.spec === 'marksman') || ok.find(o => isSpec(o, 'marksman')), others = ok.filter(o => o !== shooter);
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
  const t = sp.maskOn ? g * 0.05 : clamp(g * 1.3, 0, 1); sp.impair = Math.max(t, (sp.impair || 0) * 0.6); if (sp.impair < 0.03) sp.impair = 0; if (sp.hurt) sp.impair = Math.max(sp.impair, sp.hurt);
  if (sp.maskOn && sp.visible && !sp.maskSeen) { sp.maskSeen = true; log(`${spName()} is wearing a gas mask!`, 'alert'); fx('text', sp.x, sp.y, { text: 'GAS MASK', color: '#ffb020' }); }
}
function suspectGasTurn() { // per turn: may relocate to clean air, run, or give up
  const sp = S.suspect; if (!hostile() || sp.maskOn || sp.mode === 'fleeing') return; const g = gasAt(sp.x, sp.y); if (g < 0.08) return;
  if (S.rng.chance(clamp(0.05 + 0.25 * g, 0, 0.4))) { surrender(`${spName()} is coughing and shouting ${multiSp() ? 'to give up' : 'that he gives up'}!`); return; }
  const pMove = clamp(0.2 + 0.7 * g, 0, 0.9); if (!S.rng.chance(pMove)) return;
  // gas-free room vs exit
  if (S.rng.chance(0.35 + 0.3 * g)) { startFlee(); if (sp.mode === 'fleeing') return; }
  let best = null, bs = 1e9; for (const q of S.rooms) { if (q.id === sp.room || (q.unitB && !(S.duplex && S.duplex.hole)) || q.type === 'hall' && S.rng.chance(0.5)) continue; const c = [q.x + (q.w >> 1), q.y + (q.h >> 1)]; if (S.room[idx(c[0], c[1])] !== q.id) continue;
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
  if (m === 'charge' && u.kind === 'team' && !teamOk(u).some(o => isSpec(o, 'breacher') && countOf(o, 'charge') > 0 && freeable(o) >= ITEM_CFG.charge.needFree)) return 'The breacher with the charges has no free hand (shield / ram)';
  if (m === 'ram' && u.kind === 'team' && !teamOk(u).some(ramReady)) return 'The ram carrier\'s other hand holds a shield — both hands are needed on the ram';
  return true; }
function breachP(u, d, m, layer) { const B = BREACH[m]; let p = layer === 'storm' ? B.storm : B.p;
  if (layer !== 'storm' && d.barricaded) p *= B.barr;
  if (layer !== 'storm' && d.kind === 'garage' && m !== 'charge') p *= 0.35;
  if (layer !== 'storm') p *= doorMul(d, m);
  if (m !== 'charge' && hasSpec(u, 'breacher')) p = Math.min(0.95, p + 0.15 * teamSpecMul(u, 'breacher'));
  if ((u.impair || 0) > 0) p *= 1 - 0.4 * u.impair;
  return clamp(p, 0.02, 0.98); }
function defaultMethod(u, d) { const ms = breachMethods(u); if (d.barricaded || d.kind === 'garage') { for (const m of ['charge', 'ram', 'pry', 'kick']) if (ms.includes(m)) return m; }
  for (const m of ['ram', 'charge', 'pry', 'kick']) if (ms.includes(m)) return m; return 'kick'; }
/** Expected ticks / per-attempt success / noise for the order UI tooltip. Uses only what the player knows. */
function breachEst(u, d, m) {
  const ok = breachCan(u, m); const B = BREACH[m]; const knownD = { barricaded: d.barricaded && d.barrKnown, kind: d.kind, steel: d.steel, thin: d.thin };
  const stormK = d.storm && d.stormKnown && d.stormState === 'closed';
  const pMain = breachP(u, Object.assign({}, d, knownD), m, 'main'), pStorm = stormK ? breachP(u, d, m, 'storm') : 1;
  let ticks;
  if (m === 'charge') ticks = ITEM_CFG.charge.drawTicks /*draw off the vest*/ + 1 /*hang*/ + 2 /*stand off*/ + 1 /*detonate*/;
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
  if (m === 'ram' && u.kind === 'team' && !u.ramGrip) { const rm = teamOk(u).find(ramReady); if (rm) { u.ramGrip = { oid: rm.id, st: autoStow(rm, 'ram'), order: o }; invOf(rm).hands = ['ram', 'ram']; if (u.ramGrip.st.length) log(`${rm.name}: pistol holstered — both hands on the ram.`); } }
  if (m === 'charge') {
    if (!d.charge) { if (!(u.equip.charge > 0)) { failOrders(u, 'no charge left'); return; }
      const bo = teamOk(u).find(o => isSpec(o, 'breacher') && countOf(o, 'charge') > 0 && freeable(o) >= 1);
      if (bo && (o.drawT = (o.drawT || 0) + 1) <= ITEM_CFG.charge.drawTicks) { if (o.drawT === 1) log(`${bo.name}: drawing a charge off the vest…`); return; }
      if (bo) { const st = freeHands(bo) ? [] : autoStow(bo, heldList(bo).find(k => !(ITEM_CFG[k] || {}).stow)); useItem(u, 'charge', q => q === bo); autoRedraw(bo, st); } else useItem(u, 'charge'); d.charge = { by: u.uid, turn: S.turn }; if (d.storm) d.stormKnown = true;
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
  if (S.rng.chance(breachP(u, d, m, 'main'))) { doBreach(u, d, m); popOrder(u); ramRelease(u); runAfter(u, o); }
  else { if (d.barricaded) d.barrKnown = true; log(`${u.name}: ${B.name.toLowerCase()} on ${d.name} — no give${d.barricaded ? ' (it\'s barricaded!)' : ''}.`); noise(other[0], other[1], B.noise, 'ram'); fx('thud', other[0], other[1]); }
}
/** After the ram: pistols come back out automatically (NOT READY for one full turn). */
function ramRelease(u) { if (!u.ramGrip) return; const o = off(u.ramGrip.oid); if (o) { if (twoHanded(o, 'ram')) invOf(o).hands = ['ram', null]; autoRedraw(o, u.ramGrip.st); if (u.ramGrip.st.length) log(`${o.name}: ram down, pistol back out (not ready until next turn).`); } u.ramGrip = null; syncEquip(u); }
function detonateCharge(u, d) {
  const [mx, my] = doorMid(d); const by = unit(d.charge.by) || u; d.charge = null;
  fx('blast', mx, my, { r: CHARGE_SAFE + 2 }); noise(mx, my, 60, 'blast'); // an explosive breach is heard house-wide
  if (S.rng.chance((d.barricaded ? BREACH.charge.barr : BREACH.charge.p) * doorMul(d, 'charge'))) { if (d.storm) d.stormState = 'breached'; doBreach(by, d, 'charge'); }
  else { log(`${by.name}: charge on ${d.name} fired but the door held — needs another breach.`, 'alert'); noise(mx, my, 18, 'breach'); d.barrKnown = d.barricaded; if (d.storm) d.stormState = 'breached'; }
  for (const q of S.units) { if (!onFoot(q) && q.kind !== 'team') continue; if (!unitAlive(q) || q.inCar) continue;
    const dd = dist(q.x, q.y, mx, my); if (dd < CHARGE_SAFE && los(q.x, q.y, Math.round(mx), Math.round(my))) { q.stun = 2; q.impair = Math.max(q.impair || 0, 0.5); log(`${q.name}: too close to the blast — dazed.`, 'alert'); fx('text', q.x, q.y, { text: 'DAZED', color: '#ffd080' }); } }
  eachSp(sp => { if (hostile()) { sp.agit = clamp(sp.agit + 15, 0, 100); if (dist(sp.x, sp.y, mx, my) < 4) { sp.stun = Math.max(sp.stun, 2); sp.daze = Math.max(sp.daze || 0, 8); log(`${spName()} stunned by the blast.`, 'good'); } } });
}
/* =====================================================================
   DRACO ARM (v9) — front-mounted breaching boom/claw for the BearCat.
   Kit comes from the equipment pool (career level ≥ 60). A team of ≥2 officers at the BearCat
   installs it (v20: 5 min alone … 1 min with 6+) (busy, more exposed; leaving interrupts — progress is kept).
   Installed: the BearCat's occupants order DRACO BREACH on an exterior door or window; the
   vehicle drives up to it and rips it out. Armored hull → minimal exposure for the crew.
   ===================================================================== */
const DRACO_CFG = {
  installTurns: 10, crew: 1, // v20: 10 turns (5 min) = one officer; a bigger crew works faster (installMin)
  tip: { bang: 2, gas: 4 },   // v20: devices carried in the claw tip, deployable into the room the arm is in contact with
  installMin: [5, 5, 3, 2, 1.5, 1.25, 1], // minutes by crew size (index = officers; 6+ → 1 min, 7+ a little under)
  reach: 3.5,                 // v17: max cells from the BearCat's centre to the opening, straight ahead (bumper at 1.5, boom up to 2 cells past it)
  minReach: 2,                // the front end cannot be closer than the bumper + a short boom
  lateral: 0.55,              // the arm is fixed to the front (no left/right swing): the opening must be dead ahead
  deployTicks: 1,             // swinging the boom out before the first pull
  door: { p: 0.9, barr: 0.75, garage: 0.85, storm: 0.85 }, // per-tick pull success (manual ram 0.5 / charge 0.97)
  noise: 16,
};
/** v20: install minutes for a crew of n (1 → 5 min, 6 → 1 min, 7+ → just under 1 min). */
function dracoMinutes(n) { const M = DRACO_CFG.installMin; n = Math.max(1, n | 0); return n < M.length ? M[n] : Math.max(0.75, 1 - (n - 6) * 0.05); }
function dracoRate(n) { return 5 / dracoMinutes(n); }
function installTicks() { return DRACO_CFG.installTurns * TICKS; }
function bearcat() { return S.units.find(u => u.kind === 'cruiser' && u.armored) || null; }
function openingMid(o) { if (o.door !== undefined && o.door !== null) return doorMid(S.doors[o.door]); const w = S.windows[o.win];
  let x = 0, y = 0; for (const [a, b, c, d] of w.edges) { x += (a + c) / 2; y += (b + d) / 2; } return [x / w.edges.length, y / w.edges.length]; }
function dracoTargetReq(o) {
  if (o.door !== undefined && o.door !== null) { const d = S.doors[o.door]; if (!d) return 'Tap a door or window'; if (!d.exterior) return 'The Draco arm reaches exterior doors only';
    if (d.state !== 'closed' && !(d.storm && d.stormState === 'closed')) return 'That door is already open'; return null; }
  const w = S.windows[o.win]; if (!w) return 'Tap a door or window'; if (w.cleared) return 'That window is already torn out'; return null; }
/** v17: the Draco arm is FIXED to the vehicle's front — it does not swing left or right. A firing spot is a drivable
    centre cell + heading (one of 4 axis headings, square to the wall) with the whole 3-cell footprint drivable and the
    opening dead ahead of the front bumper, within the boom's reach. */
const DIRS4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
function openingNormal(o) { if (o.door !== undefined && o.door !== null) { const d = S.doors[o.door], c = d.cells[Math.floor(d.cells.length / 2)]; return [Math.sign(c[1][0] - c[0][0]), Math.sign(c[1][1] - c[0][1])]; }
  const e = S.windows[o.win].edges[0]; return [Math.sign(e[2] - e[0]), Math.sign(e[3] - e[1])]; }
function dracoFit(o, x, y, h) { const [mx, my] = openingMid(o), [dx, dy] = DIRS4[h], [nx, ny] = openingNormal(o);
  if (Math.abs(dx * nx + dy * ny) !== 1) return null; const along = (mx - x) * dx + (my - y) * dy, lat = Math.abs((mx - x) * dy - (my - y) * dx);
  if (along < DRACO_CFG.minReach || along > DRACO_CFG.reach || lat > DRACO_CFG.lateral) return null;
  for (let k = -1; k <= 1; k++) { const fx_ = x + dx * k, fy = y + dy * k; if (!inb(fx_, fy) || !S.drive[idx(fx_, fy)]) return null; }
  return { x, y, h, dir: Math.atan2(dy, dx), along, lat }; }
function dracoSpots(o) { const [mx, my] = openingMid(o), out = [];
  for (let y = Math.floor(my - 4); y <= Math.ceil(my + 4); y++) for (let x = Math.floor(mx - 4); x <= Math.ceil(mx + 4); x++) { if (!inb(x, y) || !S.drive[idx(x, y)]) continue;
    for (let h = 0; h < 4; h++) { const f = dracoFit(o, x, y, h); if (f) out.push(f); } } return out; }
function dracoReach(o) { const sp = dracoSpots(o); return (x, y) => sp.some(q => q.x === x && q.y === y); }
function dracoSpotAt(o, x, y) { return dracoSpots(o).filter(q => q.x === x && q.y === y).sort((a, b) => a.lat - b.lat || a.along - b.along)[0] || null; }
/** Is the arm's claw in contact with the opening right now (vehicle position + heading only — the arm cannot rotate)? */
function dracoContact(c, o) { const h = DIRS4.findIndex(([dx, dy]) => Math.abs(Math.cos(c.dir || 0) - dx) < 0.01 && Math.abs(Math.sin(c.dir || 0) - dy) < 0.01); return h >= 0 ? dracoFit(o, c.x, c.y, h) : null; }
/** Team side: one tick of installing the kit (team must be next to the BearCat). */
function dracoInstallTick(u, o, speed) { const c = unit(o.car); if (!c || c.draco) { popOrder(u); return; }
  if (teamOk(u).length < DRACO_CFG.crew) { failOrders(u, `installing the Draco arm needs ${DRACO_CFG.crew} officers`); return; }
  const g = carAdjGoal(c); if (!g(u.x, u.y)) { u.installing = null; const r = stepAlong(u, o, g, speed); if (r === null) failOrders(u, 'cannot reach the BearCat'); if (!r) return; }
  if ((c.occ.length || c.bcDriver) && c.orders.some(q => q.type === 'move' || q.type === 'draco')) { log(`${u.name}: BearCat is moving — install paused.`); return; }
  if (!c.dracoKit) { if (!(S.armory.draco > 0)) { failOrders(u, 'no Draco arm kit at the equipment vehicle'); return; } S.armory.draco--; c.dracoKit = true; log(`${u.name}: Draco arm kit brought over — mounting it on the BearCat's front.`, 'radio'); }
  u.installing = c.uid; faceTo(u, c.x, c.y); const p0 = c.dracoProg || 0; c.dracoProg = p0 + dracoRate(teamOk(u).length);
  if (Math.floor(c.dracoProg / TICKS) > Math.floor(p0 / TICKS) && c.dracoProg < installTicks()) log(`${u.name}: Draco arm install ${Math.round(100 * c.dracoProg / installTicks())}%.`);
  if (c.dracoProg >= installTicks()) { c.draco = true; c.dracoTip = { bang: DRACO_CFG.tip.bang, gas: DRACO_CFG.tip.gas }; u.installing = null; popOrder(u); fx('text', c.x, c.y, { text: 'DRACO ARM READY', color: '#7fe3ff' }); log(`${u.name}: Draco arm installed on the ${c.name}. Occupants can now order DRACO BREACH on a door or window.`, 'good'); } }
/** Called from unitAct for every team: leaving the install interrupts it (progress kept on the vehicle). */
function dracoInterrupt(u) { if (!u.installing) return; const o = u.orders[0]; if (o && o.type === 'dracoInstall') return; const c = unit(u.installing); u.installing = null;
  if (c && !c.draco) log(`${u.name}: Draco install interrupted at ${Math.round(100 * (c.dracoProg || 0) / installTicks())}% — resume with Install Draco Arm.`, 'alert'); }
/** Vehicle side: drive up to the opening, deploy the boom, pull. */
function dracoTick(c, o) {
  if (!c.occ.length && !c.bcDriver) { failOrders(c, 'no driver'); return; }
  const [mx, my] = openingMid(o);
  if (!(c.x === o.x && c.y === o.y)) { for (let s = 0; s < 3; s++) { if (c.x === o.x && c.y === o.y) break;
      const p = findPath(c.x, c.y, (x, y) => x === o.x && y === o.y, { drive: true, self: c.uid }); if (!p) { failOrders(c, 'no drivable route to the opening'); return; } if (!p.length) break;
      const [nx, ny] = p[0], dir = Math.atan2(ny - c.y, nx - c.x), ax = Math.abs(Math.cos(dir)) >= Math.abs(Math.sin(dir)) ? 'h' : 'v';
      const fp = footprint(c, nx, ny, ax); if (S.units.some(q => onFoot(q) && fp.some(([a, b]) => a === q.x && b === q.y))) { log(`${c.name}: waiting — officer in the way.`); break; }
      c.x = nx; c.y = ny; c.dir = dir; c.moved = S.tick; rebuildDyn(); }
    syncCar(c); if (!(c.x === o.x && c.y === o.y)) return; }
  // v17: square the nose up to the opening (the arm is fixed — the whole vehicle points at the target)
  if (!dracoContact(c, o)) { const f = dracoSpotAt(o, c.x, c.y); if (!f) { failOrders(c, 'cannot point the front end at the opening from here'); return; }
    c.dir = f.dir; c.moved = S.tick; rebuildDyn(); syncCar(c); log(`${c.name}: lining the front end up square on the ${o.door != null ? S.doors[o.door].name : S.rooms[S.windows[o.win].room].name + ' window'}.`, 'radio'); return; }
  const ct = dracoContact(c, o); c.dracoAt = { door: o.door, win: o.win }; c.dracoAim = c.dir; c.dracoLen = Math.max(0.3, ct.along - 1.5); c.dracoOut = S.turn;
  if (!o.contact) { o.contact = true; fx('text', mx, my, { text: 'ARM CONTACT', color: '#7fe3ff' }); }
  if ((o.prog = (o.prog || 0) + 1) <= DRACO_CFG.deployTicks) { log(`${c.name}: Draco arm deploying toward the ${o.door != null ? S.doors[o.door].name : S.rooms[S.windows[o.win].room].name + ' window'}…`, 'radio'); noise(mx, my, 6, 'engine'); return; }
  if (o.win !== undefined && o.win !== null) { const w = S.windows[o.win], wasBarred = !!w.barred; w.broken = true; w.cleared = true; w.barred = false; if (S.duplex) S.duplex.wallV++; S.stats.breaches++;
    fx('breach', mx, my, { how: 'draco' }); fx('text', mx, my, { text: 'WINDOW OUT', color: '#ffb020' }); noise(mx, my, DRACO_CFG.noise, 'breach'); aggressive(15);
    log(`${c.name}: Draco arm tore out the ${S.rooms[w.room].name} window${wasBarred ? ', bars' : ''} and frame — the opening is clear.`, 'radio'); popOrder(c); return; }
  const d = S.doors[o.door], C = DRACO_CFG.door;
  if (d.storm && d.stormState === 'closed') { d.stormKnown = true; if (S.rng.chance(C.storm)) { d.stormState = 'breached'; log(`${c.name}: storm door on ${d.name} ripped off by the Draco arm.`, 'radio'); fx('thud', mx, my); noise(mx, my, DRACO_CFG.noise - 4, 'door'); }
    else { log(`${c.name}: Draco arm on the storm door — re-gripping.`); noise(mx, my, 10, 'ram'); } return; }
  if (d.state !== 'closed') { popOrder(c); return; }
  const p = Math.min(0.97, C.p * (d.barricaded ? C.barr : 1) * (d.kind === 'garage' ? C.garage : 1) * doorMul(d, 'draco'));
  if (S.rng.chance(p)) { doBreach(c, d, 'draco'); d.frame = 'down'; noise(mx, my, DRACO_CFG.noise, 'breach'); log(`${c.name}: ${d.name} and frame pulled down — breach point open.`, 'radio'); popOrder(c); }
  else { if (d.barricaded) d.barrKnown = true; log(`${c.name}: Draco arm pulling on ${d.name} — still holding${d.barricaded ? ' (barricaded)' : ''}.`); noise(mx, my, 12, 'ram'); fx('thud', mx, my); }
}

/* ---------- v18: device batteries (%), drone LAND, Throwbots, Large Robot, door locks,
   side-visibility tracking (which sides of the house are seen) + its after-action scoring ---------- */
const DEV_CFG = {
  drone: { move: 8, hover: 5, land: 3 },   // % per turn: moved / hovering in place / landed and only observing
  robot: { move: 5, still: 3 },            // Throwbot 2
  big:   { move: 4, still: 2 },            // Large Robot (bigger battery pack)
  lockExt: 0.95,                           // exterior doors locked
  lockHome: 0.05,                          // unoccupied interior door with the homeowners' simple lock engaged
};
const SIDE_CFG = { unseenPer: 4, unseenCap: 150, containMax: 150, noEffort: -100 };
function devLabel(u) { return u.kind === 'drone' ? 'Drone' : u.big ? 'Large Robot' : 'Throwbot'; }
/** What a device did this turn and what it costs (battery %). */
function devDrain(u) {
  const moved = !!u.turnPos && (u.turnPos[0] !== u.x || u.turnPos[1] !== u.y);
  if (u.kind === 'drone') return moved ? { c: DEV_CFG.drone.move, what: 'flying' } : u.landed ? { c: DEV_CFG.drone.land, what: 'landed' } : { c: DEV_CFG.drone.hover, what: 'hovering' };
  const C = u.big ? DEV_CFG.big : DEV_CFG.robot; return moved ? { c: C.move, what: 'moving' } : { c: C.still, what: 'stationary' };
}
function newDevice(kind, x, y, dir, extra) {
  const n = ++S.devSeq, d = Object.assign({ uid: 'D' + n, kind, name: (kind === 'drone' ? 'Drone ' : 'Throwbot ') + n, num: n, x, y, dir, orders: [], battery: 100, owner: null, status: 'ok', vis: [], turnPos: [x, y], landed: false }, extra || {});
  if (d.big) d.name = 'Large Robot'; return d;
}
/** End-of-turn battery drain; frees the Large Robot operator when it stops. */
function deviceTurn() {
  for (const u of S.units) { if (u.kind !== 'drone' && u.kind !== 'robot') continue;
    if (unitAlive(u)) { if (u.battery > 100 || u.battery === undefined) u.battery = 100;
      const d = devDrain(u); u.battery = Math.max(0, u.battery - d.c); u.lastDrain = d; u.turnPos = [u.x, u.y];
      if (u.battery <= 0) { u.status = 'down'; u.orders = []; log(`${u.name}: battery depleted.`); } }
    if (u.big && !unitAlive(u) && u.op) releaseOperator(u); }
}
function releaseOperator(u) { const o = S.officers.find(q => q.id === u.op); if (o && o.status === 'operator') { o.status = 'staged'; o.opOf = null; log(`${o.name} is free again at primary staging.`, 'radio'); } u.op = null; }
/* ---- Large Robot: driven from primary staging by a dedicated operator ---- */
function bigRobotOperator() { const free = S.officers.filter(o => o.status === 'staged' && !o.team && (o.stage || 'primary') === 'primary');
  return free.find(o => o.spec === 'tech') || free[0] || null; }
function bigRobotWhyNot() {
  if (S.phase !== 'planning') return 'Wait for the orders to resolve';
  if (S.bigAvail === false) return 'No Large Robot in this unit\'s equipment';
  if (S.units.some(u => u.big && unitAlive(u))) return 'The Large Robot is already deployed';
  if (S.units.some(u => u.big && u.status === 'down')) return 'The Large Robot is out of action';
  if (!bigRobotOperator()) return 'Needs a SWAT officer free at primary staging (not in a team) to drive it';
  return null; }
function deployBigRobot() {
  const w = bigRobotWhyNot(); if (w) return { ok: false, reason: w };
  const o = bigRobotOperator(), st = S.ext.staging; let at = [st.x, st.y];
  if (S.block[idx(at[0], at[1])] || S.dyn[idx(at[0], at[1])]) { let best = null, bd = 1e9; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = st.x + dx, y = st.y + dy;
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H || S.block[idx(x, y)] || S.dyn[idx(x, y)] || roomAt(x, y) >= 0) continue; const d = Math.abs(dx) + Math.abs(dy); if (d < bd) { bd = d; best = [x, y]; } } if (best) at = best; }
  const u = newDevice('robot', at[0], at[1], -Math.PI / 2, { big: true, op: o.id }); S.units.push(u);
  o.status = 'operator'; o.opOf = u.uid; S.stats.bigRobot = true;
  log(`Large Robot rolled off the truck at primary staging — ${o.name} (${SPECS[o.spec].name}) is driving it from the staging area and is tied up while he does.`, 'radio'); S.version++;
  return { ok: true, uid: u.uid }; }
function parkBigRobot(uid) { const u = unit(uid); if (!u || !u.big || !unitAlive(u)) return { ok: false, reason: 'No Large Robot' }; if (S.phase !== 'planning') return { ok: false, reason: 'Wait for the orders to resolve' };
  u.status = 'parked'; u.orders = []; log(`${u.name}: parked — operator stands down.`, 'radio'); releaseOperator(u); S.version++; return { ok: true }; }
/** Large Robot tries a door handle. Unlocked → opens. Locked or barricaded → fails (and now we know). */
function openDoorTick(u, o) {
  const d = S.doors[o.door]; if (!d || d.state !== 'closed') { popOrder(u); return; }
  const sides = doorSides(d).filter(c => !S.block[idx(c[0], c[1])]), goal = (x, y) => sides.some(c => c[0] === x && c[1] === y);
  if (!goal(u.x, u.y)) { const r = stepAlong(u, o, goal, 1); if (r === null) failOrders(u, 'cannot reach that door'); if (!r) return; }
  const [mx, my] = doorMid(d); faceTo(u, Math.round(mx), Math.round(my));
  if (!o.grip) { o.grip = 1; log(`${u.name}: arm on the handle of the ${d.name || 'door'}…`); fx('text', u.x, u.y, { text: 'TRYING HANDLE', color: '#c9b8ff' }); return; }
  popOrder(u); d.lockKnown = true; S.stats.robotTries = (S.stats.robotTries || 0) + 1;
  if (d.barricaded) { d.barrKnown = true; log(`${u.name}: the ${d.name || 'door'} will not move — it is BARRICADED from inside.`, 'alert'); noise(u.x, u.y, 4, 'door'); return; }
  if (d.locked) { log(`${u.name}: the ${d.name || 'door'} is LOCKED — the arm cannot open it. Breach needed.`, 'alert'); noise(u.x, u.y, 3, 'door'); return; }
  d.state = 'open'; d.known = true; noise(u.x, u.y, 3, 'door'); fx('text', u.x, u.y, { text: 'DOOR OPEN', color: '#3ef0a0' }); log(`${u.name}: ${d.name || 'door'} was unlocked — door OPEN.`, 'good');
}
/** Device-specific orders inside unitAct. Returns true when the tick is used. */
function devAct(u, o) {
  if (u.kind === 'drone' && o.type === 'land') { popOrder(u); if (!u.landed) { u.landed = true; log(`${u.name}: landed — camera only, saving battery.`, 'radio'); } return true; }
  if (u.kind === 'drone' && o.type === 'move' && u.landed) { u.landed = false; log(`${u.name}: taking off.`); }
  if (u.kind === 'robot' && o.type === 'opendoor') { openDoorTick(u, o); return true; }
  return false; }
/* ---- door locks (separate random stream: the map and the rest of the scenario stay identical) ---- */
function setupLocks() { const r = makeRng(S.seed * 7907 + 29), sus = new Set(suspList().map(s => s.room));
  for (const d of S.doors) {
    if (d.exterior) { if (d.kind === 'garage' || d.barricaded || d.fortified) continue; d.locked = r.chance(DEV_CFG.lockExt); continue; }
    const home = r.chance(DEV_CFG.lockHome); if (d.locked || d.barricaded || d.state !== 'closed' || d.rooms.some(q => sus.has(q))) continue;
    if (home) { d.locked = true; d.homeLock = true; } } }
/* ---- which sides of the house are seen (any officer, vehicle, sniper, drone or robot) ---- */
const SIDE_KEYS = ['front', 'right', 'rear', 'left'];
function houseSideAt(x, y) { const H = S.house; return y < H.y0 ? 'rear' : y > H.y1 ? 'front' : x < H.x0 ? 'left' : x > H.x1 ? 'right' : (y - H.y0 < H.y1 - y ? 'rear' : 'front'); }
function sideSeen() { const sw = sideWatch(), seen = new Set(sw.watched), by = {};
  for (const p of watchPts()) if (S.vis[idx(p.x, p.y)]) seen.add(p.side);
  const all = sw.all; return { all, seen: all.filter(s => seen.has(s)), gaps: all.filter(s => !seen.has(s)), sides: SIDE_KEYS.map(k => ({ k, open: all.includes(k), seen: seen.has(k) })), full: all.length > 0 && all.every(s => seen.has(s)), by }; }
function sideTurn() { const H = S.sideHist || (S.sideHist = { turns: 0, full: 0, miss: {}, last: -1 }); if (H.last === S.turn) return; H.last = S.turn; const v = sideSeen();
  H.turns++; if (v.full) H.full++; v.gaps.forEach(g => H.miss[g] = (H.miss[g] || 0) + 1);
  eachSp(sp => { if (sp.mode === 'barricaded') S.stats.barrEver = true; }); }
function contactEffort() { const N = S.nego; return !!(N.attempts || N.everContact || N.contact || S.stats.challenged); }
function sideScore(add) { const H = S.sideHist; if (!H || !H.turns) return;
  const miss = Object.values(H.miss).reduce((a, b) => a + b, 0); if (miss) add(`Side of the house unseen (${miss} side-turn${miss > 1 ? 's' : ''})`, -Math.min(SIDE_CFG.unseenCap, miss * SIDE_CFG.unseenPer));
  const share = H.full / H.turns; if (share > 0) add(`Visual containment ${Math.round(share * 100)}% of the mission`, Math.round(SIDE_CFG.containMax * share));
  if (S.stats.barrEver && !contactEffort()) add('Barricade: no attempt to contact or call him out', SIDE_CFG.noEffort); }
function sideDebrief() { const H = S.sideHist; if (!H || !H.turns) return [];
  const m = SIDE_KEYS.filter(k => H.miss[k]).map(k => `${k} ${H.miss[k]}`).join(', ');
  const out = [{ k: 'Side visibility', v: `All sides with openings in view ${Math.round(100 * H.full / H.turns)}% of the mission (${H.full}/${H.turns} turns). Turns a side went unseen: ${m || 'none'}.` }];
  if (S.stats.barrEver) out.push({ k: 'Contact effort', v: contactEffort() ? 'Contact / call-out attempted.' : 'NONE — no phone, PA, throw-phone, call-out or verbal challenge on a barricaded subject.' });
  return out; }

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
  if (o.minor) { state = 'mobile'; sev = 1; crit = r.int(cfg.critMobile[0], cfg.critMobile[1]) * 3; } // blunt impact behind armor: minor, very slow to worsen
  else if (roll < kiaP) { state = 'kia'; sev = 3; crit = 0; }
  else if (roll < kiaP + mobP) { state = 'mobile'; sev = r.chance(0.7) ? 1 : 2; crit = r.int(cfg.critMobile[0], cfg.critMobile[1]); }
  else { state = 'immobile'; sev = r.chance(cfg.severe) ? 3 : 2; crit = r.int(cfg.critImmobile[0], cfg.critImmobile[1]) - (sev === 3 ? 1 : 0); }
  const [cx, cy] = casCell(x, y, roomAt(x, y) < 0);
  const c = { id: 'X' + (++S.casSeq), who, ref, name, x: cx, y: cy, sev, state, crit, crit0: crit, stable: false, aided: 0, carrier: null, tr: 0, turn: S.turn, wait: true,
    goal: null, team: o.team || null, reported: who !== 'suspect' && (sev < 3 || !!o.witness), seen: false, known: false, by: o.by || null, minor: !!o.minor };
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
  const medO = medic ? teamOk(u).find(o => isSpec(o, 'medic')) : null, medHands = medO && freeable(medO) >= ITEM_CFG.medkit.useHands;
  if (medic && u.equip.medkit > 0 && !medHands) log(`${u.name}: medic's hands are not free (shield / ram) — basic aid only.`, 'alert');
  if (medic && u.equip.medkit > 0 && medHands) { withHands(u, medO, 2, () => useItem(u, 'medkit')); if (c.sev >= 3) { c.crit += cfg.medicSevere; c.aided = 2; t = `medic treats ${c.name} — severe, +${tDur(cfg.medicSevere)}; needs EMS.`; }
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
    log(`${u.name}: has ${c.name} — ${o.type === 'evac' ? 'carrying to the EMS point' : 'dragging to cover'}${u.kind === 'team' && hasShield(u) ? ' behind the shield' : ''}.`, 'radio'); return; }
  const inside = roomAt(u.x, u.y) >= 0, sp = inside ? 1 : u.kind === 'team' ? CAS_CFG.carryTeam : CAS_CFG.carryPatrol;
  const goal = o.type === 'evac' ? (x, y) => cheb(x, y, S.ems.x, S.ems.y) <= 1 : (x, y) => x === o.dx && y === o.dy;
  const r = stepAlong(u, o, goal, sp); c.x = u.x; c.y = u.y;
  if (r === null) { dropCas(u, c); failOrders(u, 'no route while carrying'); return; }
  if (r) { popOrder(u); if (o.type === 'evac') atEMS(c, u); else { dropCas(u, c); c.ccp = true; xpAct('rescue', u, c.name); log(`${u.name}: ${c.name} at the casualty collection point (in cover).`, 'radio'); } }
}
/** Per tick: mobile casualties move themselves (cover first, then to EMS). Fog flags refresh. */
function casualtyTick() {
  for (const c of S.cas) { if (c.who === 'suspect' && casActive(c) && !c.carrier) { const so = suspById(c.ref) || S.suspect; c.x = so.x; c.y = so.y; } casKnow(c); if (c.state !== 'mobile' || c.carrier || c.wait || c.who === 'suspect') continue;
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
    c.crit--; if (c.crit <= 0) { if (c.who === 'suspect' && c.state === 'mobile') { c.state = 'immobile'; c.crit = 3; withSp(suspById(c.ref), sp => { if (hostile()) { sp.mode = 'incapacitated'; sp.walk = null; S.stats.method = 'Officer fire'; sp.method = sp.method || 'Officer fire'; } if (sp.visible) log(`${spName()} has collapsed — immobile.`, 'alert'); }); continue; }
      if (c.who === 'suspect') { withSp(suspById(c.ref), () => suspectLost(c)); continue; } c.state = 'lost'; S.stats.lost++; if (c.carrier) { const u = unit(c.carrier); if (u) { u.carrying = null; u.orders = u.orders.filter(q => q.cas !== c.id); } c.carrier = null; }
      log(`${c.name} did not survive the injuries.`, 'bad'); fx('text', c.x, c.y, { text: 'LOST', color: '#c9ced6' }); }
    else if (c.crit <= 2 && c.known && c.who !== 'suspect') log(`${c.name}: Critical — ${tDur(c.crit)} left without aid.`, 'alert'); }
}
/** Scene secured / operation over: EMS moves in. */
function casualtyResolve(secure) {
  for (const c of S.cas) { if (c.state === 'transport') { c.state = 'evacuated'; S.stats.evac++; continue; }
    if (!casActive(c)) continue; const so = c.who === 'suspect' ? (suspById(c.ref) || S.suspect) : null; if (so && so.deceased) continue;
    if (c.stable || c.crit >= CAS_CFG.secureSave || (secure && c.state === 'mobile')) { c.state = 'evacuated'; S.stats.evac++; } else { c.state = 'lost'; S.stats.lost++; if (so) so.deceased = true; } c.known = true; }
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
  const nr = makeRng(seed * 977 + 13); const T = NEGO_CFG.temper, TW = stypeCfg().temperW; let pick = nr(), temper = 'talker';
  for (const k in T) { pick -= TW ? TW[k] : T[k].w; if (pick <= 0) { temper = k; break; } }
  S.nego = { temper, hidden: nr.chance(NEGO_CFG.hiddenWeapon), called911: nr.chance(NEGO_CFG.number.call911) && ['barricade', 'mental'].includes((S.stype || {}).key || 'barricade'), numberKnown: false, numberSrc: null, line: false, phoneRoom: null,
    contact: null, quiet: 0, attempts: 0, refusals: 0, rounds: 0, concessions: 0, pick: null, outcome: null, hist: [], read: null, warn: false, protocol: null, ambush: null, paTurn: -1, everContact: false, how: null };
}
function negOnScene() { return S.officers.filter(o => isSpec(o, 'negotiator') && (o.status === 'staged' || o.status === 'ok')); }
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
  const C = NEGO_CFG.talk, m = talkMult(N.contact) * (stypeCfg().negoMul || 1); N.rounds++; xpAct('dialogue', negOnScene().map(o => o.id)); let gain = 0, msg = '';
  if (k === 'rapport') { gain = r.int(C.rapport.gain[0], C.rapport.gain[1]) * m - sp.agit * NEGO_CFG.agitDrag; sp.agit += C.rapport.agit; msg = flavor('rapport', 'building rapport — talking about his family, what he needs.'); }
  if (k === 'listen') { gain = r.int(C.listen.gain[0], C.listen.gain[1]) * m; sp.agit += C.listen.agit; msg = flavor('listen', 'letting him vent. He is calming down.');
    if (r.chance(C.listen.intel)) { sp.heat = { room: sp.room, x: sp.x, y: sp.y, turn: S.turn }; S.intel.located = true; msg += ` He mentions he is in the ${S.rooms[sp.room] ? S.rooms[sp.room].name : 'house'}.`; } }
  if (k === 'concession') { gain = r.int(C.concession.gain[0], C.concession.gain[1]) * m - sp.agit * NEGO_CFG.agitDrag; sp.agit += C.concession.agit; N.concessions++;
    msg = flavor('concession', ['offered to pull the cruisers back a little.', 'got him cigarettes and water sent in on the robot line.', 'let him speak to his sister on the line.'][N.concessions - 1] || 'offered a concession.', N.concessions - 1); }
  if (k === 'status') { gain = r.int(C.status.gain[0], C.status.gain[1]) * m; S.intel.weapon = true; S.intel.threat = Math.max(S.intel.threat, 1);
    msg = `${flavor('status', `status check — he says he is alone with a ${SUSPECT_WEAPONS[sp.weapon].name.toLowerCase()}`, SUSPECT_WEAPONS[sp.weapon].name.toLowerCase())}${sp.injured ? ', and he is hurt' : ''}${S.gasActive && S.gas[idx(sp.x, sp.y)] > 0.2 ? ', coughing from the gas' : ''}.`;
    if (N.hidden && !N.warn && r.chance(0.35 + negotiatorSkill() * 0.3)) { N.warn = true; msg += ' Something he said suggests he may be hiding a second weapon — run a full walk-out protocol.'; } }
  if (k === 'ultimatum') { if (sp.talk >= C.ultimatum.need && r.chance(C.ultimatum.surrender + (sp.talk - C.ultimatum.need) / 100)) { negHist('Negotiator: ultimatum — he agrees to come out.', 'good'); walkout('talk'); return; }
    sp.agit += C.ultimatum.agit; sp.talk = clamp(sp.talk + C.ultimatum.talk, 0, 100); negHist(flavor('ultimatum', 'Negotiator: ultimatum rejected — he is furious.'), 'alert');
    if (r.chance(C.ultimatum.hang)) { N.contact = null; N.quiet = 1; negHist('He has cut contact.', 'alert'); } sp.agit = clamp(sp.agit, 0, 100); return; }
  sp.agit = clamp(sp.agit, 0, 100); sp.talk = clamp(sp.talk + gain, 0, 100);
  negHist(`Negotiator: ${msg}`, 'radio');
  if (N.contact === 'pa' && r.chance(NEGO_CFG.pa.yell * 0.5)) shoutReveal(paUnits()[0], false);
  const SU = NEGO_CFG.surrender;
  if (sp.talk >= SU.sure || sp.talk >= SU.from && r.chance((sp.talk - SU.from) / SU.div)) { negHist(flavor('ready', 'Negotiator: he says he is ready to come out.'), 'good'); walkout('talk'); return; }
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
  const N = S.nego, sp = S.suspect, r = S.rng; if (!hostile()) return; if (o.voice) { voiceCallout(u, o); return; } if (!paInRange(u.x, u.y)) { log(`${u.name}: out of PA range.`, 'radio'); return; }
  if (o.mode === 'callout') { const C = NEGO_CFG.callout; N.attempts++;
    let p = C.base * (stypeCfg().calloutMul || 1) + sp.talk / 100 * C.talk + (S.gasActive && S.gas[idx(sp.x, sp.y)] > 0.2 ? C.gas : 0) - (sp.agit > C.agitHigh ? C.agitPen : 0);
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
  if (via === 'team') { useItem(u, 'tphone'); } N.attempts++;
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
  if (u.kind === 'team' && o.via === 'robot') { useItem(u, 'robot'); useItem(u, 'tphone'); const g = robotPhoneGoal(o.room);
    const d = newDevice('robot', u.x, u.y, u.dir, { orders: [{ type: 'tphone', room: o.room, via: 'robot', doorway: g ? g.doorway : true }], owner: u.uid });
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
function walkout(how) { const r = walkout1(how, 0); if (r !== false) groupWalkout(how); return r; }
/** One suspect agrees to walk out. k > 0: a group member following the lead (comes out k turns later, kneels beside the walk-out point). */
function walkout1(how, k) { const sp = S.suspect, N = S.nego; if (!hostile()) return false; sp.mode = 'surrendered'; sp.stun = 0; if (!k) { N.how = how; N.outcome = how === 'callout' ? 'Call-out surrender' : 'Negotiated surrender'; }
  let spot = surrSpot(); if (k) { for (const [dx, dy] of [[2 * k, 0], [-2 * k, 0], [0, 2 * k], [k, k], [-k, k]]) if (cellOk(spot[0] + dx, spot[1] + dy, { outdoor: true })) { spot = [spot[0] + dx, spot[1] + dy]; break; } }
  sp.walk = { stage: 'wait', turn: S.turn + (k || 0), spot, amb: false, rolled: false, how };
  S.doors.forEach(d => { if (d.rooms.includes(sp.room)) { d.barricaded = false; d.locked = false; } if (d.exterior) { d.locked = false; d.barricaded = false; } });
  if (!k) log(multiSp() ? `${spName()} will come out through the front door in the next 30 seconds. Set up the protocol: cover team (shield), overwatch, PA commands. Then take each one into custody at the walk-out point.` : 'He will come out through the front door in the next 30 seconds. Set up the protocol: cover team (shield), overwatch, PA commands. Then cuff him at the walk-out point.', 'good'); S.version++; }
/** Score the surrender protocol at the moment he steps outside. */
function protocolNow(spot) {
  const [x, y] = spot, P = { cover: false, shield: false, overwatch: false, commands: false, who: [] };
  for (const u of S.units) { if (!unitAlive(u)) continue;
    if (u.kind === 'team' && u.perch && u.deployed) { const wk = weaponOf(u); if (los(u.x, u.y, x, y) && dist(u.x, u.y, x, y) <= WEAPONS[wk].range) { P.overwatch = true; P.who.push(u.name + ' overwatch'); } continue; }
    if (u.kind === 'cruiser' && u.occ.length && dist(u.x, u.y, x, y) <= 14) { P.cover = true; P.who.push(u.name + ' cover'); }
    if (!onFoot(u) || roomAt(u.x, u.y) >= 0) continue; if (dist(u.x, u.y, x, y) > 14 || !los(u.x, u.y, x, y)) continue;
    const l = losEx(x, y, u.x, u.y, true); const nearCar = S.units.some(c => c.kind === 'cruiser' && cheb(c.x, c.y, u.x, u.y) <= 2);
    if (l.cov >= 1 || nearCar) { P.cover = true; P.who.push(u.name + ' cover'); if (u.kind === 'team' && hasShield(u)) P.shield = true; }
    else if (u.kind === 'team' && hasShield(u)) { P.shield = true; } }
  if (paUnits(x, y).length) P.commands = true;
  P.score = ['cover', 'shield', 'overwatch', 'commands'].filter(k => P[k]).length; return P;
}
/** Expected ambush risk shown to the player (does not reveal whether he actually hides a weapon). */
function ambushRisk(P) { const C = NEGO_CFG; let p = C.hiddenWeapon * C.ambushHidden; for (const k of ['cover', 'shield', 'overwatch', 'commands']) if (P[k]) p *= C.protocol[k]; return p; }
function ambushChance(P) { const C = NEGO_CFG; let p = S.nego.hidden ? C.ambushHidden : 0; for (const k of ['cover', 'shield', 'overwatch', 'commands']) if (P[k]) p *= C.protocol[k]; return p; }
/** One tick of the walk-out (suspectTick while surrendered). */
function walkoutTick() {
  const sp = S.suspect, w = sp.walk, N = S.nego; if (!w) return;
  if (w.stage === 'wait') { if (S.turn <= w.turn) return; w.stage = 'out'; log(`${spName()} is coming out — hands up.`, 'alert'); }
  if (w.stage === 'out') {
    if (sp.x === w.spot[0] && sp.y === w.spot[1]) { w.stage = 'kneel'; const cmd = N.protocol && N.protocol.commands;
      log(cmd ? `PA: "STOP. KNEEL. HANDS ON YOUR HEAD." — ${multiSp() ? spName() + ' kneels' : 'he kneels'} at the walk-out point.` : `${multiSp() ? spName() : 'He'} stops at the walk-out point, standing, hands raised. (No PA commands.)`, 'radio'); return; }
    const p = findPath(sp.x, sp.y, (x, y) => x === w.spot[0] && y === w.spot[1], { suspect: true, canOpen: true, allDoors: true });
    if (!p || !p.length) { w.spot = [sp.x, sp.y]; return; } const [nx, ny] = p[0]; const e = edge(sp.x, sp.y, nx, ny); if (e.t === 'D') { e.d.state = 'open'; e.d.barricaded = false; e.d.locked = false; }
    sp.x = nx; sp.y = ny; sp.room = roomAt(nx, ny); sp.atWindow = false; sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn };
    if (sp.room < 0 && !w.rolled) { w.rolled = true; N.protocol = protocolNow(w.spot); w.p = ambushChance(N.protocol); w.amb = S.rng.chance(w.p);
      log(`Walk-out protocol: ${N.protocol.score}/4 (${['cover', 'shield', 'overwatch', 'commands'].map(k => (N.protocol[k] ? '✓ ' : '✗ ') + k).join(', ')}).`, N.protocol.score >= 3 ? 'good' : 'alert'); }
    return; }
  if (w.stage === 'kneel') {
    const near = S.units.filter(u => onFoot(u) && !u.perch && cheb(u.x, u.y, sp.x, sp.y) <= 2).sort((a, b) => dist(a.x, a.y, sp.x, sp.y) - dist(b.x, b.y, sp.x, sp.y));
    const myKey = sp.key || true; if (!S.units.some(u => u.detain === myKey)) { const c = S.units.filter(u => onFoot(u) && !u.perch && roomAt(u.x, u.y) < 0 && !(u.orders[0] && u.orders[0].cas)).sort((a, b) => (b.kind === 'team') - (a.kind === 'team') || dist(a.x, a.y, sp.x, sp.y) - dist(b.x, b.y, sp.x, sp.y))[0];
      if (c) { c.detain = myKey; c.orders = []; log(`${c.name}: moving up to take ${multiSp() ? spName() : 'him'} into custody.`, 'radio'); } }
    if (near.length && w.amb) { ambushNow(near[0]); return; }
    const adj = near.find(u => cheb(u.x, u.y, sp.x, sp.y) <= 1); if (adj) { const how = w.how === 'callout' ? 'Call-out surrender' : w.how ? 'Negotiated surrender' : N.outcome || 'Surrendered'; sp.walk = null; S.units.forEach(u => { if (u.detain === myKey) u.detain = false; }); detained(adj, how); } }
}
function ambushNow(T) {
  const sp = S.suspect, N = S.nego, P = N.protocol || {}, r = S.rng; sp.walk = null; sp.mode = 'alert'; sp.weapon = 'handgun'; sp.ambush = true; sp.retreat = true; N.contact = null; N.quiet = 3; sp.talk = 0; sp.agit = 90;
  S.units.forEach(u => { if (u.detain === (sp.key || true)) u.detain = false; }); S.stats.shots++; N.ambush = { turn: S.turn + 1, score: P.score || 0, hit: false };
  fx('muzzle', sp.x, sp.y, { suspect: true }); fx('shot', sp.x, sp.y, { tx: T.x, ty: T.y }); sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn };
  log(`AMBUSH — ${multiSp() ? spName() + ' pulls' : 'he pulls'} a hidden handgun on the arrest team!`, 'bad'); N.outcome = 'Walk-out ambush';
  let p = NEGO_CFG.ambushHit * (P.commands ? 0.5 : 1) * (T_HIT[targetClass(T, sp.x, sp.y)] || 1);
  if (r.chance(p)) { N.ambush.hit = true; shotOfficer(T, 'pistol', dist(T.x, T.y, sp.x, sp.y), sp.x, sp.y, 'walk-out spot'); } else log(`Rounds miss ${T.name}.`, 'alert');
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
    concessions: N.concessions, mood: moodWord(), rapport: rapportWord(), read: N.read, warn: N.warn, pick: N.pick, hist: N.hist.slice(-6), outcome: N.outcome, walk: (suspList().find(s => s.walk) || {}).walk ? suspList().find(s => s.walk).walk.stage : null,
    protocol: N.protocol, preview: sp.walk || hostile() ? protocolNow(surrSpot()) : null, spot: surrSpot(), avail: Object.fromEntries(TALK_KEYS.map(k => [k, talkAvail(k)])), names: TALK_NAMES }; }

/* =====================================================================
   SCENARIO — what happened before SWAT was paged: roadblocks, how patrol
   set up (good / accidental gap / clumped at the front / one badly placed),
   officers hit on arrival, the mission brief and the 911 call transcript.
   ===================================================================== */
const SCENE_CFG = {
  variants: { good: 0.4, gap: 0.35, front: 0.25 },        // v14: no 'exposed officer' variant — every start is covered and out of sight   // patrol setup on arrival
  injury: 0.05,                                                // chance an officer was hit before SWAT arrived
  injuryKind: { mobile: 0.3, immobile: 0.38, critical: 0.22, kia: 0.1 },
  critImmobile: [4, 6], critCritical: [3, 4],                  // turns left without aid
  slip: 0.12, slipAfter: 2,                                    // unwatched side with windows: per-turn chance he tries to slip out (after N turns of gap)
  numberInCall: 0.3,                                           // a third-party caller gives his number
};
const VARIANT_TXT = { good: 'Good — patrol on two diagonal corners, every side watched', gap: 'Gap — one side left uncovered by accident', front: 'Clumped — both officers behind cars in the street out front', mixed: 'Mixed — one officer in a bad, exposed position' };
const FIRST = ['Daniel', 'Marcus', 'Travis', 'Kevin', 'Luis', 'Dmitri', 'Ray', 'Calvin', 'Nate', 'Victor', 'Owen', 'Trent'];

/** Cruisers start at the ends of the block (map edge or the nearest intersection), parked across the street to stop traffic. */
function setupRoadblocks(r) {
  const G = S.geo, H = S.house, hcx = (H.x0 + H.x1) / 2, X = S.ext; S.roadblocks = [];
  const ends = ['W', 'E'].map(side => { const cr = G.cross && (side === 'W' ? G.cross.x1 < hcx : G.cross.x0 > hcx) ? G.cross : null;
    const x = cr ? (side === 'W' ? cr.x1 + 3 : cr.x0 - 3) : side === 'W' ? r.int(4, 6) : MAP_W - r.int(5, 7); return { side, x, kind: cr ? 'intersection' : 'map edge' }; });
  const place = (x0, y0, dir, i) => { let best = null, bs = 1e9; const c0 = { kind: 'cruiser', dir };
    for (let dy = -3; dy <= 3; dy++) for (let dx = -12; dx <= 12; dx++) { const x = x0 + dx, y = y0 + dy; if (!inb(x, y)) continue;
      const fp = footprint(c0, x, y); if (!fp.every(([a, b]) => inb(a, b) && (S.drive[idx(a, b)] || S.paved[idx(a, b)] === 1) && !S.block[idx(a, b)])) continue;
      if (!S.drive[idx(x, y)] || carClash(x, y, null)) continue; if (dist(x, y, X.van.x + 3, X.van.y) < 6) continue; let s = Math.abs(dx) + Math.abs(dy) * 1.5; if (s >= bs) continue; if (onProperty(x, y) || Math.abs(x - hcx) < 18) continue; if (suspSees(x, y)) s += 40; if (s < bs) { bs = s; best = [x, y]; } } // v14: prefer a spot he can't see from inside
    if (best && suspSees(best[0], best[1])) { let b2 = null, s2 = 1e9; // v14: widen the search before accepting a spot he can see
      for (let dy = -4; dy <= 4; dy++) for (let dx = -30; dx <= 30; dx++) { const x = x0 + dx, y = y0 + dy; if (!inb(x, y)) continue; const s = Math.abs(dx) + Math.abs(dy) * 1.5; if (s >= s2) continue;
        const fp = footprint(c0, x, y); if (!fp.every(([a, b]) => inb(a, b) && (S.drive[idx(a, b)] || S.paved[idx(a, b)] === 1) && !S.block[idx(a, b)])) continue;
        if (!S.drive[idx(x, y)] || carClash(x, y, null) || onProperty(x, y) || Math.abs(x - hcx) < 18 || dist(x, y, X.van.x + 3, X.van.y) < 6 || suspSees(x, y)) continue; s2 = s; b2 = [x, y]; }
      if (b2) best = b2; }
    if (!best) { dir = 0; c0.dir = 0; for (let dy = -3; dy <= 3 && !best; dy++) for (let dx = -12; dx <= 12; dx++) { const x = x0 + dx, y = y0 + dy; if (inb(x, y) && S.drive[idx(x, y)] && !carClash(x, y, null)) { best = [x, y]; break; } } }
    if (!best) best = [x0, y0];
    const u = { uid: 'C' + (i + 1), kind: 'cruiser', name: 'Cruiser ' + (i + 1), num: i + 1, x: best[0], y: best[1], dir, occ: [], orders: [], status: 'ok', hits: 0, marks: [], vis: [], disabled: false };
    S.units.push(u); rebuildDyn(); return u; };
  const mid = G.ST + Math.floor(G.streetW / 2);
  const c1 = place(ends[0].x, mid, Math.PI / 2, 0); S.roadblocks.push({ x: c1.x, y: c1.y, side: 'W', kind: ends[0].kind, car: c1.uid });
  const c2 = place(ends[1].x, mid, Math.PI / 2, 1); S.roadblocks.push({ x: c2.x, y: c2.y, side: 'E', kind: ends[1].kind, car: c2.uid });
  const k = r.chance(0.5) ? 0 : 1, e = ends[k]; place(e.x + (e.side === 'W' ? 4 : -4), G.ST + 2, e.side === 'W' ? 0 : Math.PI, 2);
  // v22: cordon markers — at each end of the block, and on every arm of a cross / side street (multi-road sides)
  S.cordon = S.roadblocks.map(b => ({ x: b.x, y: G.ST - 1, side: b.side, kind: b.kind }));
  if (G.cross) { const cx = Math.round((G.cross.x0 + G.cross.x1) / 2), side = cx < hcx ? 'W' : 'E';
    for (const y of [G.ST - 6, G.SB + 6]) if (y > 1 && y < MAP_H - 2) S.cordon.push({ x: cx, y, side, kind: 'cross street' }); }
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
  // v14: every officer on foot starts off the lot, ≥10 m from the house, behind a car on the street or behind cover at the side/rear,
  // and out of the suspect's sight from inside; the variant decides which sides they manage to watch.
  let gap = null; const cands = patrolCands(D);
  const placed = new Set(), place = (res) => { res.forEach((c, i) => { const u = P[2 + i]; u.x = c.x; u.y = c.y; u.badPos = false; placed.add(u); }); return sideWatch().gaps; };
  const tryPlan = (v, gapSide) => { let plans;
    if (v === 'good') plans = [{ want: sides.filter(s => s !== 'front'), kind: 'side' }, { want: sides, kind: 'street' }];
    else if (v === 'gap') plans = [{ want: sides.filter(s => s !== gapSide && s !== 'front'), kind: gapSide === 'front' ? '' : 'side' }, { want: sides.filter(s => s !== gapSide), kind: gapSide === 'front' ? 'side' : 'street' }];
    else plans = [{ want: ['front'], kind: 'street' }, { want: ['front'], kind: 'street' }];
    const res = pickPatrolPosts(cands, plans, gapSide) || pickPatrolPosts(cands, plans.map(q => ({ want: q.want, kind: '' })), gapSide) || pickPatrolPosts(cands, [{ want: [], kind: '' }, { want: [], kind: '' }], null);
    if (!res) return null; return place(res); };
  if (v === 'good') { let g = tryPlan('good', null); if (!g || g.length) { v = 'gap'; gap = g && g[0] || null; } }
  else if (v === 'gap') { const opts = r.shuffle(['left', 'right', 'rear'].filter(s => sides.includes(s))); let g = null;
    for (const o of opts.length ? opts : ['rear']) { gap = o; g = tryPlan('gap', o); if (g && g.length) break; } if (!g || !g.length) { const gg = tryPlan('good', null); v = gg && !gg.length ? 'good' : 'gap'; gap = gg && gg[0] || null; } }
  else tryPlan('front', null);
  if (v === 'gap' && !sideWatch().gaps.length) v = 'good';
  for (const [i, u] of [P[2], P[3]].entries()) if (!placed.has(u)) { u.x = S.ext.staging.x + 2 + i; u.y = S.ext.staging.y; S.genErrors = (S.genErrors || []).concat('no patrol start for ' + u.name); }
  P.forEach(p => p.home = { x: p.x, y: p.y });
  const sw0 = sideWatch();
  S.scene = { variant: v, gap0: sw0.gaps.slice(), intended: gap, injury: null, gapFound: null, gapClosed: null, gapTurns: 0, slipTried: false };
  // officer hit on arrival: the second officer on foot, in the open near the front of the house
  if (r.chance(SCENE_CFG.injury)) {
    const u = P[3]; const dn = downedSpot(r, D), spot = dn ? dn.at : [u.x, u.y];
    u.x = spot[0]; u.y = spot[1]; u.home = { x: u.x, y: u.y }; u.status = 'down'; u.orders = []; u.badPos = false;
    let kind = 'immobile', pk = r(); for (const k in SCENE_CFG.injuryKind) { pk -= SCENE_CFG.injuryKind[k]; if (pk <= 0) { kind = k; break; } }
    const c = addCasualty('patrol', u.uid, u.name, u.x, u.y, { kia: 0, mobile: 0 }); u.cas = c.id; c.initial = true; c.x = u.x; c.y = u.y;
    if (kind === 'kia') { c.state = 'kia'; c.sev = 3; c.crit = 0; S.stats.kia++; c.known = true; }
    else if (kind === 'mobile') { c.state = 'mobile'; c.sev = 1; c.crit = r.int(CAS_CFG.critMobile[0], CAS_CFG.critMobile[1]); c.reported = true; }
    else if (kind === 'critical') { c.state = 'immobile'; c.sev = 3; c.crit = r.int(SCENE_CFG.critCritical[0], SCENE_CFG.critCritical[1]); c.reported = true; }
    else { c.state = 'immobile'; c.sev = 2; c.crit = r.int(SCENE_CFG.critImmobile[0], SCENE_CFG.critImmobile[1]); c.reported = true; }
    c.crit0 = c.crit; c.known = true; S.downList.push({ x: c.x, y: c.y, name: u.name, cas: c.id }); S.scene.injury = { name: u.name, kind, cas: c.id, yard: dn && dn.front ? 'front' : 'side/back' };
    S.scene.gap0 = sideWatch().gaps.slice(); if (S.scene.variant === 'good' && S.scene.gap0.length) S.scene.variant = 'gap'; // losing an officer opens a side
  }
}
/** Mission brief + 911 call, generated from the seed; consistent with the hidden facts (who called, weapon) but never confirms them outright. */
function makeBrief() {
  const r = makeRng(S.seed * 4111 + 17), sp = S.suspect, N = S.nego, sc = S.scene, G = S.geo;
  const stv = S.stype || { key: 'barricade' }, ST = stv.key, self = N.called911, shots = !!sc.injury || stv.legal === 'discharge' || r.chance(ST === 'mental' ? 0.2 : ST === 'flee' ? 0.35 : 0.55);
  const types = ST !== 'barricade' ? null : self ? ['shots reported', 'warrant service'] : ['welfare check', 'warrant service', 'traffic stop follow-up', 'shots reported'];
  const type = types ? r.pick(types) : { mental: 'mental health crisis', domestic: 'domestic disturbance', flee: 'fleeing suspect', neighbor: 'neighbor dispute — gun displayed' }[ST]; const first = r.pick(SUS_FIRST), last = r.pick(SUS_LAST), age = r.int(24, 58), addr = `${r.int(1, 48) * 100 + r.int(1, 99)} ${G.name}`;
  const hh = r.int(0, 23), mm = r.int(0, 59), t0 = hh * 3600 + mm * 60 + r.int(0, 59), ts = s => { s = (t0 + s) % 86400; const p = n => String(n).padStart(2, '0'); return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`; };
  r(); const desc = `${first} ${last}, ${age}`; // v23 (B5): no physical description (the r() keeps the seeded sequence)
  const gunWord = { handgun: 'a handgun', rifle: 'a long gun', shotgun: 'a long gun — maybe a shotgun' }[sp.weapon] || 'a gun';
  const sawGun = (ST === 'neighbor' || stv.variant === 'firearm' ? true : stv.variant === 'violent' ? false : self ? r.chance(0.5) : r.chance(0.65)) || (ST === 'mental' && stv.legal === 'menacing' && !!gunWordOf(sp.weapon));
  const callerKind = self ? 'suspect' : ST === 'domestic' ? 'partner' : ST === 'neighbor' || ST === 'flee' ? 'neighbor' : { 'domestic disturbance': 'girlfriend', 'welfare check': 'sister', 'warrant service': 'neighbor', 'traffic stop follow-up': 'neighbor', 'shots reported': 'neighbor', 'mental health crisis': 'mother' }[type];
  const callerName = self ? `${first} ${last} (did not give a name)` : { partner: r.pick(CALLER_F) + ' (partner)', girlfriend: r.pick(CALLER_F) + ' (girlfriend)', sister: r.pick(CALLER_F) + ` ${last} (sister)`, neighbor: r.pick(['Mr. ', 'Mrs. ']) + r.pick(SUS_LAST.filter(n => n !== last)) + ' (neighbor)', mother: `Linda ${last} (mother)` }[callerKind];
  const giveNum = !self && ['girlfriend', 'sister', 'mother', 'partner'].includes(callerKind) && r.chance(SCENE_CFG.numberInCall * 2);
  const phone = `(612) 555-0${r.int(100, 199)}`;
  const L = [], add = (s, who, text) => L.push({ t: ts(s), who, text });
  let s = 0; add(s, 'Dispatcher', '911, what is the address of your emergency?');
  if (self) { add(s += 4, 'Caller', `${addr}. You need to send somebody. ${type === 'mental health crisis' ? "I can't do this anymore." + mentalHook(stv.legal, sp, true) : type === 'shots reported' ? "I just fired a round so you'd know I'm serious." : "I'm not going back. Tell them that."}`);
    add(s += 6, 'Dispatcher', 'Okay, I am sending help. What is your name, sir?'); add(s += 5, 'Caller', "Doesn't matter. Tell them not to come in here.");
    add(s += 4, 'Dispatcher', 'Is anyone else in the house with you?'); add(s += 3, 'Caller', "No. Just me."); if (sawGun || shots) { add(s += 5, 'Dispatcher', 'Do you have any weapons?'); add(s += 3, 'Caller', sawGun ? `I've got ${gunWord.replace('a long gun — maybe a shotgun', 'a shotgun').replace('a long gun', 'a rifle')}.` : "I'm not answering that."); }
    add(s += 6, 'Dispatcher', "Sir, stay on the line with me — officers are on the way."); add(s += 2, '[Note]', 'Caller disconnected. Caller ID on the line: ' + phone + ' (registered to ' + first + ' ' + last + ').'); }
  else {
    const what = ST === 'domestic' ? (stv.variant === 'firearm' ? `My boyfriend — he hit me and then he got his gun out. I ran out the back. He's still in the house at ${addr}.` : `My boyfriend — he's been hitting me and throwing things, I got out the side door. He's still in the house at ${addr}.`)
      : ST === 'neighbor' ? `My neighbor at ${addr} just pointed a gun at me over the fence! We've been fighting about the property line for months.`
      : ST === 'flee' ? `A guy the police were chasing just kicked in the back door of the empty house at ${addr}. Nobody lives there — it's for sale.` : { 'domestic disturbance': `My boyfriend — he's screaming and throwing things, I got out the back. He's still in the house at ${addr}.`, 'welfare check': `I'm calling about my brother at ${addr}. He sent me a goodbye text and now he won't answer.`, 'warrant service': `There's police at my neighbor's place, ${addr}, and he slammed the door on them and he's yelling.`, 'traffic stop follow-up': `A guy just ran from a car the police pulled over and went into ${addr}.`, 'shots reported': `I heard ${shots ? 'gunshots' : 'what sounded like a gunshot'} next door, ${addr}.`, 'mental health crisis': `My son at ${addr} — he's off his medication and he says he's going to make them shoot him.` + mentalHook(stv.legal, sp, false) }[type];
    add(s += 4, 'Caller', what); add(s += 6, 'Dispatcher', 'Okay. Are you somewhere safe right now?'); add(s += 3, 'Caller', callerKind === 'neighbor' ? "I'm inside my house, I'm looking out the window." : callerKind === 'partner' ? "I'm down the street — I can see a police car coming." : "I'm in my car down the street.");
    add(s += 5, 'Dispatcher', 'Does he have any weapons?'); add(s += 3, 'Caller', sawGun ? `Yes — I saw ${gunWord}.` : stv.variant === 'violent' ? "He had a knife in the kitchen. Guns — I don't know, maybe." : "I don't know. Maybe. He used to keep guns.");
    add(s += 5, 'Dispatcher', 'Is anyone else inside?'); add(s += 3, 'Caller', ST === 'flee' ? 'No — the house is empty, nobody lives there.' : ST === 'domestic' ? "No. The kids are at my mom's." : r.pick(["I don't think so.", "I don't know.", 'I think he is alone.']));
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
  r(); // v23 (B6): the single background line is replaced by a criminal history (v23Brief); r() keeps the seeded sequence
  if (type === 'warrant service') known.push('Felony warrant (probation violation); he refused to open the door to the warrant team.');
  if (ST === 'domestic') known.push(stv.variant === 'firearm' ? 'Two prior domestic calls at this address; a handgun is registered to him.' : 'Two prior domestic calls at this address; protective order filed last year.', 'His partner is at the perimeter with patrol — interview her (Partner Interview) for layout, weapons and history.');
  if (ST === 'neighbor') known.push(`Ongoing property-line dispute with the neighbor on the ${stv.side} side. He displayed the gun toward that house.`, 'Known armed — the neighbor saw the weapon. Neighbor Interview available.');
  if (ST === 'flee') known.push('Ran on foot from a traffic stop; patrol lost sight of him at the back of this house.', 'The house is vacant (bank-owned, for sale) — no residents, no family on scene.');
  if (ST === 'mental') known.push('Crisis call: arrange an EMS evaluation (Intel → EMS Evaluation) and try to resolve without force. He can still be evaluated after he comes out, whatever charges follow.'); // v23 (B7): no legal line
  if (type === 'traffic stop follow-up') known.push('Ran from a traffic stop two blocks away; the car is registered to him.');
  S.brief = { type, time: ts(0).slice(0, 5), callAt: ts(0), arriveAt: arrive, activatedAt: ts(actS), addr, caller: callerName, self, shots, sawGun, suspect: desc, name: `${first} ${last}`,
    occupants: ST === 'flee' ? 'Vacant house — no residents. He is alone.' : ST === 'domestic' ? 'Partner is out and at the perimeter; she says nobody else is inside. Not confirmed.' : self ? 'Caller says he is alone. Not confirmed.' : 'Caller does not know whether anyone else is inside. Not confirmed.',
    stype: ST, stypeName: stv.name || 'Barricaded subject', typeDesc: SCEN_TYPES[ST].desc, legal: ST === 'mental' ? null : stv.legal || null, variant: stv.variant || null, side: stv.side || null,
    patrol, known, officerDown: !!sc.injury, transcript: L, background: bg.sort(), phone: self || giveNum ? phone : null, giveNum, reviewed: false };
  if (ST === 'flee') fleeBrief(S.brief);
  typeBrief(S.brief); typeBrief3(S.brief); structBrief(S.brief);
}
/** Flee calls: what the patrol and the caller believe about the number of subjects (seeded, may under-report). */
function fleeBrief(B) { const R = patrolReport(); B.report = R; const many = R.n > 1, words = ['', 'one', 'two', 'three', 'four'];
  B.belief = R.kind === 'atleast' ? 'Officer belief: at least one suspect — possibly more than one.' : many ? `Officer belief: ${words[R.n]} suspects seen going in — there could be more. Not confirmed.` : 'Officer belief: one suspect, probably alone. Not confirmed.';
  B.occupants = 'Vacant house — no residents. ' + (R.kind === 'atleast' ? 'Patrol saw at least one subject run in, possibly more than one. Count unknown.' : many ? `Patrol saw ${words[R.n]} subjects run in. Count not confirmed.` : 'Patrol saw one subject run in. Count not confirmed.');
  const lead = R.kind === 'atleast' ? 'At least one guy — maybe more, it was hard to see — that the police were chasing' : many ? `${words[R.n][0].toUpperCase() + words[R.n].slice(1)} guys the police were chasing` : 'A guy the police were chasing';
  B.transcript.forEach(e => { if (e.who === 'Caller' && e.text.startsWith('A guy the police were chasing')) e.text = e.text.replace('A guy the police were chasing just kicked', lead + (many || R.kind === 'atleast' ? ' just kicked' : ' just kicked')); });
  if (many) B.typeDesc = 'Several suspects ran from patrol into an empty house. Nobody else inside, little interest in talking — and they will leave through any side nobody watches. The head count is not confirmed.';
  else if (R.kind === 'atleast') B.typeDesc = 'At least one suspect — possibly more — ran from patrol into an empty house. Nobody else inside, little interest in talking — and anyone in there will leave through any side nobody watches.';
  B.known = B.known.map(k => k.startsWith('Ran on foot from a traffic stop') ? (many ? 'They ran on foot from a traffic stop; patrol lost sight of them at the back of this house.' : k) : k);
  B.patrol.splice(B.patrol.length - 1, 0, `Patrol: ${R.kind === 'atleast' ? 'at least one subject went in — possibly more than one' : many ? words[R.n] + ' subjects went in the back' : 'one subject went in the back'}.`); }
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
  const sc = S.scene, sp = S.suspect; if (!sc) return; const G = multiSp() ? sp : sc; // gap clock: per suspect when there are several
  const sw = sideWatch(); if (sc.gap0.length && sc.gapClosed == null && !sw.gaps.some(g => sc.gap0.includes(g))) { sc.gapClosed = S.turn; xpAct('contain', null); }
  const TT = stypeCfg(); if (!hostile() || sp.mode !== 'barricaded' || sp.walk || (S.nego && S.nego.contact && !TT.vacant) || S.turn < Math.min(2, TT.slipAfter)) { G.gapTurns = 0; return; }
  const wins = S.windows.filter(w => w.room !== sp.room && !w.broken && exitWin(w) && sw.gaps.includes(watchPts().find(p => p.win === w.id).side));
  if (!wins.length) { G.gapTurns = 0; return; }
  G.gapTurns = (G.gapTurns || 0) + 1; const dm = sp.disp === 'fleeing' && multiSp() ? MULTI_CFG.fleeSlip : sp.disp === 'surrendering' ? 0.5 : 1;
  if (G.gapTurns < (TT.slipAfter || SCENE_CFG.slipAfter) || !S.rng.chance(Math.min(0.6, SCENE_CFG.slip * (TT.slipMul || 1) * dm))) return;
  let best = null, bp = null; for (const w of wins) { const [cx, cy] = w.edges[0]; const p = findPath(sp.x, sp.y, (x, y) => x === cx && y === cy, { suspect: true, canOpen: true }); if (p && (!bp || p.length < bp.length)) { bp = p; best = w; } }
  if (!best) return; sp.mode = 'fleeing'; sp.flee = best.id; sc.slipTried = true; const side = watchPts().find(p => p.win === best.id).side;
  log(`Movement inside — sounds like ${multiSp() ? 'someone' : 'he'} is heading for the ${side} side of the house!`, 'alert');
}
/** Debrief lines about the starting situation and how it was handled. */
function sceneDebrief() {
  const sc = S.scene, out = []; if (!sc) return out;
  let t = VARIANT_TXT[sc.variant];
  if (sc.gap0.length) t += `. Unwatched at the start: ${sc.gap0.join(', ')}` + (sc.gapFound ? ` — found by status check at ${elapsedAt(sc.gapFound - 1)}` : ' — never confirmed by a status check') + (sc.gapClosed != null ? `, closed by ${elapsedAt(sc.gapClosed)}` : ', never closed') + (sc.slipTried ? '; he tried to slip out that way' : '');
  else t += '. No gap at the start';
  out.push({ k: 'Initial conditions', v: t + '.' });
  if (sc.injury) { const c = casById(sc.injury.cas); out.push({ k: '  Officer down on arrival', v: `${sc.injury.name}: ${sc.injury.kind === 'kia' ? 'killed before SWAT arrived' : sc.injury.kind + ' — outcome: ' + (c ? sevWord(c) : 'unknown')}.` }); }
  out.push(...typeDebrief());
  const B = S.brief; if (B) out.push({ k: '  Call', v: `${B.type} at ${B.time}; 911 recording ${B.reviewed ? 'reviewed' : 'not reviewed'}.` });
  return out;
}

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

/* =====================================================================
   SCENARIO TYPES — data-driven call types, picked from the seed (or forced
   by opts.stype). Each type tunes suspect temperament, negotiation, fire
   readiness, escape drive, the 911 call / brief and the debrief bonuses.
   Rules only: no DOM. Neutral wording throughout.
   ===================================================================== */
/* ================== TUNABLE: SCENARIO TYPES ================== */
const SCEN_TYPES = {
  barricade: { name: 'Barricaded subject', short: 'Barricade', w: 0.30, agit: 45, fireMul: 1, negoMul: 1, calloutMul: 1, slipMul: 1, slipAfter: 2,
    desc: 'Armed adult barricaded in his house after a disturbance, a warrant attempt or shots reported.' },
  mental: { name: 'Mental health crisis', short: 'Mental health', w: 0.20, agit: 30, fireMul: 0.55, negoMul: 1.35, calloutMul: 1.3, slipMul: 0.5, slipAfter: 3,
    temperW: { talker: 0.5, withdrawn: 0.45, volatile: 0.05 }, legal: { discharge: 0.35, warrant: 0.30, menacing: 0.35 }, // v23 (B7): hidden hook — never shown as a legal line
    bonus: { noForce: 150, ems: 100 },
    desc: 'A person in crisis, armed, alone. Low aggression, open to talking. Resolve without force and arrange an EMS evaluation for a bonus.' },
  domestic: { name: 'Domestic disturbance', short: 'Domestic', w: 0.20, agit: 50, fireMul: 1, negoMul: 1, calloutMul: 1, slipMul: 1, slipAfter: 2,
    variants: { firearm: 0.55, violent: 0.45 },
    desc: 'He assaulted his partner, who got out and is waiting at the perimeter — interview her for the layout, weapons and history.' },
  flee: { name: 'Fleeing suspect — vacant house', short: 'Fleeing suspect', w: 0.15, agit: 60, fireMul: 0.9, negoMul: 0.7, calloutMul: 0.75, slipMul: 2.4, slipAfter: 1,
    temperW: { talker: 0.1, withdrawn: 0.5, volatile: 0.4 }, vacant: true,
    desc: 'He ran from patrol into an empty house. Nobody else inside, little interest in talking — and he will leave through any side nobody watches.' },
  neighbor: { name: 'Neighbor dispute — firearm displayed', short: 'Neighbor dispute', w: 0.15, agit: 55, fireMul: 1, sideMul: 1.35, offSideMul: 0.85, negoMul: 0.9, calloutMul: 1, slipMul: 1, slipAfter: 2,
    temperW: { talker: 0.3, withdrawn: 0.25, volatile: 0.45 }, knownArmed: true,
    desc: 'He pointed a gun at the neighbor. Known armed; most hostile toward the neighbor\u2019s side of the house. The neighbor can be interviewed.' },
  // v12 types — 'xw' is the share of ALL calls (tunable); picked first on a separate seed stream so the five base types keep their seeds.
  parole: { name: 'Parole absconder — warrant', short: 'Parole absconder', xw: 0.06, agit: 35, fireMul: 0.7, negoMul: 0.9, calloutMul: 1.1, slipMul: 1.2, slipAfter: 2,
    temperW: { talker: 0.3, withdrawn: 0.6, volatile: 0.1 }, variants: { seen: 0.4, window: 0.3, caller: 0.3 }, legal: { parole: 1 },
    desc: 'Patrol went to pick up a parole absconder on a violation warrant. He will not come out — he hides and waits, often in an attic or basement. Armed is possible, not certain.' },
  sovcit: { name: 'Eviction standoff — sovereign citizen', short: 'Eviction standoff', xw: 0.05, agit: 50, fireMul: 1.05, negoMul: 0.8, calloutMul: 0.6, slipMul: 0.6, slipAfter: 3,
    temperW: { talker: 0.5, withdrawn: 0.25, volatile: 0.25 }, variants: { eviction: 0.6, papers: 0.4 }, legal: { eviction: 1 }, fortified: true,
    desc: 'He refused to leave when patrol came to enforce an eviction or serve civil papers. He rejects the court\u2019s authority and argues every point. Long guns, armor, gas masks and reinforced doors are more likely.' },
  // v13 types
  drughouse: { name: 'Fortified drug house — narcotics warrant', short: 'Drug house', xw: 0.05, agit: 50, fireMul: 0.85, negoMul: 1.0, calloutMul: 0.9, slipMul: 0.6, slipAfter: 3,
    temperW: { talker: 0.1, withdrawn: 0.5, volatile: 0.4 }, variants: { warrant: 0.6, buy: 0.4 }, legal: { narcotics: 1 }, fortified: true,
    desc: 'Narcotics unit called SWAT to a fortified house: steel-reinforced doors, bars on the windows, cameras outside. Two to four suspects with long guns, possibly armor. Slow to breach; they watch the approaches.' },
  inmates: { name: 'Escaped inmates — family fled the house', short: 'Escaped inmates', xw: 0.025, agit: 60, fireMul: 0.9, negoMul: 0.7, calloutMul: 0.8, slipMul: 2.6, slipAfter: 1,
    temperW: { talker: 0.2, withdrawn: 0.4, volatile: 0.4 }, legal: { escape: 1 },
    desc: 'One or two escaped inmates forced their way into an occupied house; the family got out and called 911. Nobody else inside. They want a way out — expect them to run for any side nobody watches. The family can be interviewed at the perimeter.' },
};
const SCEN_KEYS = Object.keys(SCEN_TYPES);
const BASE_KEYS = SCEN_KEYS.filter(k => !SCEN_TYPES[k].xw);
const LEGAL_TXT = { narcotics: 'Narcotics search warrant on file for the residence.', escape: 'Escape from custody — statewide alert; escape warrant.', parole: 'Parole violation — warrant issued (absconded from supervision).', eviction: 'Court order on file (writ of possession / civil process).', discharge: 'He fired a round inside the house — unlawful discharge within city limits.', warrant: 'Active warrant on file.' };
/* ============================================================ */
function wpick(r, W) { let p = r() * Object.values(W).reduce((a, b) => a + b, 0); for (const k in W) { p -= W[k]; if (p <= 0) return k; } return Object.keys(W)[0]; }
/** Scenario type for a seed (deterministic; independent of the map generator's random stream). */
function typeForSeed(seed, force) {
  const r = makeRng(((seed >>> 0) % 1000000 || 1) * 7393 + 11), base = SCEN_TYPES[force] ? null : wpick(r, Object.fromEntries(BASE_KEYS.map(k => [k, SCEN_TYPES[k].w])));
  let xk = null; { const rx = makeRng(((seed >>> 0) % 1000000 || 1) * 8803 + 5); let p = rx(); for (const k of SCEN_KEYS) if (SCEN_TYPES[k].xw) { p -= SCEN_TYPES[k].xw; if (p < 0) { xk = k; break; } } }
  const key = SCEN_TYPES[force] ? force : xk || base, T = SCEN_TYPES[key];
  const st = { key, name: T.name, short: T.short, variant: null, legal: null, risk: false, side: null };
  if (T.variants) st.variant = wpick(r, T.variants);
  if (T.legal) st.legal = wpick(r, T.legal);
  if (key === 'mental') st.risk = true;            // neutral debrief flag only
  if (key === 'neighbor') st.side = r.chance(0.5) ? 'left' : 'right';
  if (key === 'parole') st.name = T.name + { seen: ' (seen going in)', window: ' (seen at a window)', caller: ' (caller says he is inside)' }[st.variant];
  if (key === 'sovcit') st.name = st.variant === 'papers' ? 'Civil papers standoff — sovereign citizen' : T.name;
  if (st.variant === 'violent') st.name = T.name + ' (violent)'; else if (st.variant === 'firearm') st.name = T.name + ' (firearm)';
  return st;
}
function stypeCfg() { return SCEN_TYPES[(S.stype && S.stype.key) || 'barricade']; }
/** After the map/suspect are generated: apply the type to the suspect and intel. */
function applyScenType() {
  const st = S.stype, T = stypeCfg(), sp = S.suspect, r = makeRng(S.seed * 5113 + 3);
  sp.agit = T.agit;
  if (st.key === 'neighbor') { sp.weapon = r.chance(0.6) ? 'handgun' : 'rifle'; S.intel.weapon = true; S.intel.threat = Math.max(S.intel.threat, 1); }
  if (st.key === 'domestic' && st.variant === 'firearm' && sp.weapon === 'rifle') sp.weapon = 'shotgun';
  if (st.key === 'domestic') S.intel.partner = false;
  if (T.vacant) S.vacant = true;
}
/** Officer is on the neighbor's side of the house (neighbor-dispute aggression). */
function onNeighborSide(u) { const st = S.stype; if (!st || !st.side) return false; const H = S.house; return st.side === 'left' ? u.x < H.x0 : u.x > H.x1; }
function typeFireMul21(u) { const T = stypeCfg(); let m = T.fireMul || 1; if (T.sideMul && u) m *= onNeighborSide(u) ? T.sideMul : T.offSideMul; return m; }
/** Mental-health type: was it resolved without force? */
function resolvedNoForce() { const R = S.result || {}, m = S.stats.method || ''; return !!R.win && !S.stats.ofShots && !S.stats.breaches && !/fire|Less-lethal|Taser|gas|flashbang|entry/i.test(m) && !S.gasEver; }
/** Debrief lines for the scenario type. */
function typeDebrief() {
  const st = S.stype, out = []; if (!st) return out;
  out.push({ k: 'Scenario type', v: st.name + (st.legal && st.key !== 'mental' ? ` · legal: ${st.legal}` : '') + '.' });
  if (st.key === 'mental') { out.push({ k: '  Crisis resolution', v: resolvedNoForce() ? 'Resolved without force.' : (S.result && S.result.win ? 'Resolved with force.' : 'Not resolved.') });
    out.push({ k: '  Risk flag', v: 'Risk to himself reported at the call. ' + (S.intel.emsEval ? 'Referred for EMS evaluation.' : 'No EMS evaluation arranged.') }); }
  if (st.key === 'domestic') out.push({ k: '  Partner interview', v: S.intel.partner ? 'Done — layout, weapons and history obtained.' : 'Not done.' });
  if (st.key === 'neighbor') out.push({ k: '  Neighbor side', v: `Most hostile toward the ${st.side} side (neighbor's house).` });
  typeExtraDebrief(out);
  if (st.key === 'flee') out.push({ k: '  Vacant house', v: S.stats.escaped ? 'He got out through an unwatched side.' : 'Contained.' });
  return out;
}
function typeScore(add) {
  const st = S.stype, T = stypeCfg(); if (!st || !T.bonus) return;
  if (st.key === 'mental' && resolvedNoForce()) add('Crisis resolved without force', T.bonus.noForce);
  if (st.key === 'mental' && S.result && S.result.win && S.intel.emsEval) add('EMS evaluation arranged', T.bonus.ems);
}
/* =====================================================================
   MULTIPLE SUSPECTS (v11) — the 'flee' call type can have 1-4 suspects.
   Every suspect is the same object model as the classic single suspect;
   rules written against S.suspect run per suspect through withSp(), which
   swaps S.suspect for the duration of a call. Outside a swap, S.suspect is
   always the "lead" (first still-hostile suspect) — negotiation talks to
   the lead and its result applies to the group (others may break away).
   Single-suspect types keep S.suspects = [S.suspect] and behave as before.
   Rules only: no DOM. Neutral wording.
   ===================================================================== */
/* ================== TUNABLE: MULTIPLE SUSPECTS ================== */
const MULTI_CFG = {
  countW: [0.50, 0.30, 0.14, 0.06],     // P(1), P(2), P(3), P(4) suspects on a 'flee' call
  dispW: { hiding: 0.30, fighting: 0.25, fleeing: 0.20, surrendering: 0.15, injured: 0.10 }, // starting state of each extra suspect
  weapons: ['handgun', 'handgun', 'handgun', 'shotgun', 'rifle'],
  mask: 0.05,
  follow: { base: 0.75, surrendering: 1, fighting: 0.45, injured: 0.9 }, // chance another suspect joins a group surrender
  hideFire: 0.6, fightFire: 1.15, fleeSlip: 1.6, surrTalk: 40, injImpair: 0.25,
  report: { exact: 0.45, under: 0.35, atleast: 0.20 } // what the patrol tells dispatch about the number of subjects
};
/* v13: per-call-type multi-suspect profiles (fields missing here fall back to MULTI_CFG) */
const MULTI_TYPES = {
  flee: {},
  drughouse: { countW: [0, 0.5, 0.35, 0.15], dispW: { fighting: 0.3, hiding: 0.4, fleeing: 0.1, surrendering: 0.15, injured: 0.05 }, weapons: ['rifle', 'shotgun', 'handgun', 'rifle', 'shotgun'], armor: 0.2, leadDisp: 'fighting', mask: 0.1 },
  inmates: { countW: [0.45, 0.55], dispW: { fleeing: 0.5, hiding: 0.3, fighting: 0.15, surrendering: 0.05 }, weapons: ['handgun', 'shotgun', 'none', 'handgun'], leadDisp: 'fleeing', mask: 0 }
};
function multiType(k) { k = k || (S.stype && S.stype.key); return !!(k && MULTI_TYPES[k]); }
function mcfg(f, k) { k = k || (S.stype && S.stype.key); const T = MULTI_TYPES[k] || {}; return T[f] !== undefined ? T[f] : MULTI_CFG[f]; }
const SUS_LETTERS = 'ABCD';
let SP_DEPTH = 0;
function suspList() { return S.suspects && S.suspects.length ? S.suspects : (S.suspect ? [S.suspect] : []); }
function multiSp() { return !!(S.suspects && S.suspects.length > 1); }
function spActive(s) { return !!s && !['detained', 'escaped'].includes(s.mode); }
function spHostile(s) { return !!s && ['barricaded', 'alert', 'fleeing'].includes(s.mode); }
function suspById(k) { return suspList().find(s => s.key === k) || null; }
/** Lead = first hostile, else first walking out, else first active, else the first. Only changes S.suspect outside a swap. */
function setLead() { const L = S.suspects; if (!L || L.length < 2 || SP_DEPTH) return; S.suspect = L.find(spHostile) || L.find(s => s.walk) || L.find(spActive) || L[0]; }
function withSp(sp, fn) { if (!sp) return fn(S.suspect); const keep = S.suspect; S.suspect = sp; SP_DEPTH++;
  try { return fn(sp); } finally { SP_DEPTH--; S.suspect = keep; if (!SP_DEPTH) setLead(); } }
function eachSp(fn) { for (const s of suspList().slice()) withSp(s, fn); }
function spName(sp = S.suspect) { return multiSp() && sp && sp.label ? 'Suspect ' + sp.label : 'Suspect'; }
function labelAll() { for (const s of suspList()) if (!s.label) { s.labelled = true; s.label = SUS_LETTERS[suspList().filter(q => q.labelled).length - 1]; } }
function spPron(sp = S.suspect) { return multiSp() ? spName(sp) : 'He'; }
/** The suspect a shot at cell (tx,ty) is aimed at: one on/next to the cell, else the nearest active one in the same room. */
function suspectFor(tx, ty, fromX, fromY) { const L = suspList().filter(spActive); if (L.length < 2) return S.suspect;
  const on = L.filter(s => dist(s.x, s.y, tx, ty) <= 1.5).sort((a, b) => dist(a.x, a.y, tx, ty) - dist(b.x, b.y, tx, ty) || spHostile(b) - spHostile(a));
  if (on.length) return on[0]; const rm = roomAt(tx, ty); const inRm = L.filter(s => rm >= 0 && s.room === rm && (fromX == null || los(fromX, fromY, s.x, s.y) === 1));
  if (inRm.length) return inRm.sort((a, b) => dist(a.x, a.y, tx, ty) - dist(b.x, b.y, tx, ty))[0];
  return L.slice().sort((a, b) => dist(a.x, a.y, tx, ty) - dist(b.x, b.y, tx, ty))[0]; }
/** Best less-lethal / taser target from (sx,sy): nearest active suspect in view with a clear line, else the lead. */
function devTarget(sx, sy) { const L = suspList().filter(spActive); if (L.length < 2) return S.suspect;
  const c = L.filter(s => (s.visible || (s.lastKnown && s.lastKnown.turn === S.turn)) && los(sx, sy, s.x, s.y) === 1).sort((a, b) => spHostile(b) - spHostile(a) || dist(a.x, a.y, sx, sy) - dist(b.x, b.y, sx, sy));
  return c[0] || S.suspect; }
function suspectAtCell(x, y) { return suspList().find(s => spActive(s) && s.x === x && s.y === y) || null; }
function spInRoom(rm, pred = spActive) { return suspList().some(s => pred(s) && s.room === rm); }
/** Seeded count draw: separate stream so the map / scenario are unchanged by the count. */
function fleeCount(seed, opts, key) { if (opts && opts.suspects) return clamp(Math.round(opts.suspects), 1, 4);
  const r = makeRng(seed * 6101 + 29), W = mcfg('countW', key || 'flee'), tot = W.reduce((a, b) => a + b, 0); let p = r() * tot;
  for (let i = 0; i < W.length; i++) { p -= W[i]; if (p <= 0) return i + 1; } return 1; }
function wpick(r, W) { const ks = Object.keys(W); let p = r() * ks.reduce((a, k) => a + W[k], 0); for (const k of ks) { p -= W[k]; if (p <= 0) return k; } return ks[0]; }
/** Tag the classic suspect, then (flee calls only) add the extra suspects, each with its own spot, weapon, armor, mask and starting state. */
function setupSuspects() {
  const lead = S.suspect; lead.sid = 0; lead.key = 'S'; lead.label = 'A'; lead.disp = lead.disp || null; S.suspects = [lead];
  const n = multiType() ? fleeCount(S.seed, S.opts, S.stype.key) : 1;
  S.intel.suspSeen = 0; S.intel.suspConfirmed = null;
  if (n < 2) { setupSuspectArmor(); S.susCount = 1; return; }
  const r = makeRng(S.seed * 4421 + 71), used = [[lead.x, lead.y]];
  lead.disp = mcfg('leadDisp') || 'fleeing';
  const rooms = S.rooms.map((q, i) => i).filter(i => i !== lead.room && S.rooms[i].type !== 'hall' && !S.rooms[i].unitB);
  for (let k = 1; k < n; k++) {
    let best = null, bs = -1e9;
    for (let t = 0; t < 60; t++) { const ri = rooms.length && r.chance(0.85) ? r.pick(rooms) : lead.room; const q = S.rooms[ri];
      const x = q.x + r.int(0, q.w - 1), y = q.y + r.int(0, q.h - 1); if (S.block[idx(x, y)] || roomAt(x, y) !== ri) continue;
      const near = Math.min(...used.map(([a, b]) => dist(a, b, x, y))); if (near < 2) continue;
      const sameRoom = S.suspects.some(s => s.room === ri); const s = near * 0.3 - (sameRoom ? 3 : 0) + r();
      if (s > bs) { bs = s; best = [x, y, ri]; } }
    if (!best) break; used.push([best[0], best[1]]);
    const disp = wpick(r, mcfg('dispW'));
    const sp = { x: best[0], y: best[1], home: { x: best[0], y: best[1] }, room: best[2], mode: disp === 'fighting' ? 'alert' : 'barricaded', stun: 0, agit: lead.agit, cd: 0, ambush: false,
      hasMask: r.chance(mcfg('mask')), maskOn: false, maskSeen: false, maskDon: 0, impair: 0, phone: false, talk: 0, seen: false, lastKnown: null, heat: null, unseenTurns: 0, path: null, dir: r() * 6.28,
      weapon: r.pick(mcfg('weapons')), atWindow: false, suppressed: 0, duck: 0, sid: k, key: 'S' + (k + 1), label: SUS_LETTERS[k], disp };
    if (disp === 'fighting') sp.agit = clamp(sp.agit + 15, 0, 100);
    if (disp === 'surrendering') { sp.talk = MULTI_CFG.surrTalk; sp.agit = clamp(sp.agit - 20, 0, 100); }
    if (disp === 'injured') { sp.injured = true; sp.injuryText = 'injured before officers arrived — limping and holding his side'; sp.hurt = MULTI_CFG.injImpair; sp.impair = MULTI_CFG.injImpair; }
    S.suspects.push(sp);
  }
  S.susCount = S.suspects.length; S.suspects.forEach(s => { s.label = null; s.labelled = false; }); // letters are given in the order they are first seen
  // armor per suspect: the lead keeps the classic stream, extras get their own
  setupSuspectArmor();
  const p = S.opts && S.opts.suspectArmor !== undefined ? S.opts.suspectArmor : (mcfg('armor') != null ? mcfg('armor') : ARMOR_CFG.suspect);
  S.suspects.slice(mcfg('armor') != null && !(S.opts && S.opts.suspectArmor !== undefined) ? 0 : 1).forEach(sp => { const ra = makeRng(S.seed * 977 + 13 + sp.sid * 131); sp.armor = ra.chance(p) ? (ra.chance(ARMOR_CFG.suspectPlate) ? 'plate' : 'soft') : 'none'; sp.armorKnown = false; });
}
/** What the patrol reported: { n, kind: 'exact'|'under'|'atleast', text }. Seeded, separate stream. */
function patrolReport() { const n = S.susCount || 1; if (!multiType()) return { n: 1, kind: 'exact', text: 'one subject' };
  const r = makeRng(S.seed * 3331 + 5); let kind = wpick(r, MULTI_CFG.report); if (kind === 'under' && n === 1) kind = 'exact';
  const said = kind === 'exact' ? n : kind === 'under' ? r.int(1, n - 1) : 1; const words = ['', 'one', 'two', 'three', 'four'];
  const text = kind === 'atleast' ? 'at least one subject — possibly more' : said === 1 ? 'one subject' : words[said] + ' subjects';
  return { n: said, kind, text }; }
/** Status-panel view of the suspect count: unknown until every suspect has been seen. */
function suspectCountInfo() { const L = suspList(), seen = L.filter(s => s.seen).length; const flee = multiType(); const conf = !flee || !!S.intel.suspConfirmed || S.phase === 'over';
  const R = S.brief && S.brief.report; return { seen, total: conf ? L.length : null, confirmed: !!conf, belief: R ? R.text : 'one subject',
    custody: L.filter(s => s.mode === 'detained').length, down: L.filter(s => s.mode === 'incapacitated').length, active: L.filter(spHostile).length }; }
/** Reveal bookkeeping after a vision pass: when every suspect has been seen, the count is confirmed. */
function countObserve() { const L = suspList(); if (!multiType() || S.intel.suspConfirmed) return; const seen = L.filter(s => s.seen).length;
  const all = seen === L.length && S.rooms.every(q => q.explored || q.type === 'hall' || q.unitB);
  if (seen > (S.intel.suspSeen || 0)) { S.intel.suspSeen = seen; if (!all) log(`${seen} suspect${seen > 1 ? 's' : ''} seen so far — the house is not cleared, there may be more.`, 'intel'); }
  // confirmation: all have been seen, and every room has been explored or the count is fully in view
  if (all) { S.intel.suspConfirmed = S.turn + 1; log(`Suspect count confirmed: ${L.length}.`, 'intel'); } }
function spState(sp) { return sp.mode === 'detained' ? 'in custody' : sp.mode === 'escaped' ? 'escaped' : sp.mode === 'incapacitated' ? 'down' : sp.mode === 'surrendered' ? 'surrendering'
  : sp.mode === 'fleeing' ? 'fleeing' : sp.stun > 0 ? 'stunned' : sp.injured && sp.mode === 'alert' ? 'injured' : sp.mode === 'alert' ? 'fighting' : 'hiding'; }
/** Group surrender: after the lead agrees to walk out, every other hostile suspect follows (one per turn) or breaks away. */
function groupWalkout(how) { if (!multiSp()) return; const lead = S.suspect; let k = 0;
  for (const s of suspList()) { if (s === lead || !spHostile(s) || s.stun > 0) continue; const F = MULTI_CFG.follow; const p = F[s.disp] != null ? F[s.disp] : F.base;
    if (S.rng.chance(p)) { k++; withSp(s, () => { walkout1(how, k); }); log(`${spName(s)} is coming out too.`, 'good'); }
    else { s.agit = clamp(s.agit + 15, 0, 100); if (s.mode === 'barricaded') s.mode = 'alert'; s.breakaway = true; log(`${spName(s)} refuses to come out with the others.`, 'alert'); } } }
/** Per-suspect debrief lines and stats. */
function suspectsDebrief() { const L = suspList(); if (L.length > 1) labelAll(); return L.map(sp => { const sc = S.cas.find(c => c.who === 'suspect' && c.ref === sp.key);
  return { k: L.length > 1 ? spName(sp) : 'Suspect', v: (sp.deceased ? 'Did not survive' : sc ? (sc.state === 'evacuated' ? 'Injured — evacuated to hospital in custody' : 'Injured') : sp.mode === 'detained' ? 'Uninjured, in custody' : sp.mode === 'escaped' ? 'Escaped' : sp.mode === 'incapacitated' ? 'Down, not secured' : 'Still inside')
    + (L.length > 1 && sp.method ? ` (${sp.method})` : '') + (L.length > 1 ? ` · ${SUSPECT_WEAPONS[sp.weapon].name}${sp.armor && sp.armor !== 'none' ? ', ' + sp.armor + ' armor' : ''}` : '') }; }); }

/* =====================================================================
   v12 CALL TYPES — parole absconder and eviction / civil-papers standoff.
   Rules only (no DOM). Neutral wording. Each uses its own seed streams so
   the map and the base scenario stay identical for a given seed.
   ===================================================================== */
/* ================== TUNABLE ================== */
const PAROLE_CFG = {
  armed: 0.55,                                   // chance he has a firearm at all (otherwise none)
  weapons: { handgun: 0.7, shotgun: 0.18, rifle: 0.12 },
  hideP: 0.6, hideKinds: { attic: 0.5, basement: 0.5 }, // chance he is in an attic/basement hide instead of a barricaded room
  findDist: 1,                                   // officers/robot/K9 must be this close (cells) to spot him in the hide
  foundGiveUp: 0.45,                             // chance he gives up on the spot when found in the hide
};
const SOVCIT_CFG = { boost: 0.25, cap: 0.95, doorBase: 0.10, maskBase: 0.05, rifleBase: 0.25, postsP: 0.5 };
/* ============================================= */
const capP = (p) => Math.min(SOVCIT_CFG.cap, p);
/** After the suspects exist: weapons/armor/masks/doors per type, and the parole hide. */
function applyTypeExtras() {
  const st = S.stype; if (!st) return; const sp = S.suspect;
  if (st.key === 'parole') { const r = makeRng(S.seed * 6229 + 41);
    sp.weapon = r.chance(PAROLE_CFG.armed) ? wpick(r, PAROLE_CFG.weapons) : 'none';
    if (sp.weapon === 'none' && S.scene && S.scene.injury) sp.weapon = 'handgun'; // an officer was hit: he is armed
    if (r.chance(PAROLE_CFG.hideP)) setupHide(r, wpick(r, PAROLE_CFG.hideKinds)); }
  if (st.key === 'sovcit') { const r = makeRng(S.seed * 7451 + 23), C = SOVCIT_CFG;
    // rifle: base share + boost (capped); keeps the stream deterministic
    if (sp.weapon !== 'rifle' && r.chance((capP(C.rifleBase + C.boost) - C.rifleBase) / (1 - C.rifleBase))) sp.weapon = 'rifle';
    if (!(S.opts && S.opts.suspectArmor !== undefined)) { sp.armor = r.chance(capP(ARMOR_CFG.suspect + C.boost)) ? (r.chance(ARMOR_CFG.suspectPlate) ? 'plate' : 'soft') : 'none'; sp.armorKnown = false; }
    sp.hasMask = r.chance(capP(C.maskBase + C.boost));
    S.doors.forEach(d => { if (d.exterior && !d.unitB && d.kind !== 'garage' && r.chance(capP(C.doorBase + C.boost))) { d.barricaded = true; d.locked = true; d.fortified = true; } });
    S.intel.posts = r.chance(C.postsP); }
  applyTypeExtras3();
}
/** Parole absconder hide: an attic hatch or basement door in a room; he waits there out of sight. */
function setupHide(r, kind) {
  const sp = S.suspect, pref = kind === 'attic' ? { hall: 3, bed: 2, office: 1 } : { kitchen: 3, hall: 2, living: 1, office: 1 };
  const cands = S.rooms.filter(q => q.type !== 'garage' && !q.unitB), wt = cands.map(q => pref[q.type] || 0.4); let tot = wt.reduce((a, b) => a + b, 0), p = r() * tot, rm = cands[0];
  for (let i = 0; i < cands.length; i++) { p -= wt[i]; if (p <= 0) { rm = cands[i]; break; } }
  const ext = S.doors.filter(d => d.exterior).map(d => d.cells[0][0]); let best = null, bs = -1;
  for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) { if (S.block[idx(x, y)] || roomAt(x, y) !== rm.id) continue;
    const s = Math.min(...ext.map(c => dist(c[0], c[1], x, y)), 99) + r() * 0.5; if (s > bs) { bs = s; best = [x, y]; } }
  if (!best) return;
  S.doors.forEach(d => { if (d.rooms.includes(sp.room) && !d.exterior) { d.barricaded = false; d.locked = false; } }); // he left his room for the hide
  sp.x = best[0]; sp.y = best[1]; sp.home = { x: best[0], y: best[1] }; sp.room = rm.id; sp.hidden = true;
  S.hide = { kind, x: best[0], y: best[1], room: rm.id, name: kind === 'attic' ? 'Attic hatch' : 'Basement door', found: false };
}
/** Is this suspect concealed in the hide from every unit right now? */
function hiddenNow(sp) {
  if (!sp.hidden || !S.hide) return false;
  if (sp.x !== S.hide.x || sp.y !== S.hide.y || sp.mode !== 'barricaded') { sp.hidden = false; return false; }
  const near = S.units.find(u => unitAlive(u) && (onFoot(u) || u.kind === 'robot') && cheb(u.x, u.y, sp.x, sp.y) <= PAROLE_CFG.findDist && roomAt(u.x, u.y) === sp.room);
  if (!near) return true;
  sp.hidden = false; S.hide.found = true; log(`${near.name}: found him — hiding in the ${S.hide.kind === 'attic' ? 'attic above the' : 'basement under the'} ${S.rooms[sp.room].name}!`, 'alert');
  if (S.rng.chance(PAROLE_CFG.foundGiveUp)) { sp.agit = clamp(sp.agit - 30, 0, 100); sp.talk = clamp((sp.talk || 0) + 60, 0, 100); }
  return false;
}
/** Negotiation flavor per call type: returns a replacement line or the default. */
const NEGO_FLAVOR = {
  sovcit: { rapport: 'letting him lay out his legal theory — staying patient, not arguing the paperwork.', listen: 'letting him read his "notice" to the court again. He lists every agency he says has no authority over him.',
    concession: ['agreed to read the court order aloud over the PA so he can "note his objection".', 'offered to take his written statement to a supervisor.', 'let a family member speak with him on the line.'],
    status: w => `status check — he says he is "a private man on private property" with a ${w}`, ultimatum: 'Negotiator: ultimatum rejected — he says nobody here has jurisdiction over him.', ready: 'Negotiator: he says he will walk out "under protest, without consent".' },
  parole: { rapport: 'talking about his kids and what happens at a violation hearing.', listen: 'letting him vent about his parole officer and the conditions.',
    concession: ['agreed to have his parole agent call him back.', 'got him water and cigarettes sent in on the robot line.', 'let him speak to his mother on the line.'],
    status: w => w === 'no firearm' ? 'status check — he says he has no gun and just does not want to go back' : `status check — he says he has a ${w} and is not going back`, ultimatum: 'Negotiator: ultimatum rejected — he says he is not going back inside.', ready: 'Negotiator: he says he is done hiding — coming out.' },
};
function flavor(k, def, arg) { const F = NEGO_FLAVOR[(S.stype || {}).key]; if (!F || F[k] == null) return def; const v = F[k]; if (typeof v === 'function') return v(arg); if (Array.isArray(v)) return v[arg] || def; return v; }
/** Brief and 911 rewrite for the v12 types (separate stream; base brief generation is unchanged). */
function typeBrief(B) {
  const st = S.stype, ST = st.key; if (ST !== 'parole' && ST !== 'sovcit') return; const r = makeRng(S.seed * 9157 + 3), sp = S.suspect, first = B.name.split(' ')[0];
  const L = [], t0 = B.callAt, add = (who, text) => L.push({ t: t0, who, text });
  B.legal = st.legal; B.typeDesc = SCEN_TYPES[ST].desc; B.self = false; B.phone = null; B.giveNum = false;
  if (ST === 'parole') { const v = st.variant; B.type = 'parole violation warrant';
    if (v === 'caller') { B.caller = r.pick(['Neighbor', 'Landlord', 'Former roommate']) + ' (anonymous)';
      add('Dispatcher', '911, what is the address of your emergency?'); add('Caller', `The guy on the news — ${B.name}, the one who skipped parole — he's inside ${B.addr} right now. I saw him go in the back an hour ago.`);
      add('Dispatcher', 'Is he armed?'); add('Caller', r.chance(0.5) ? "I don't know. He used to carry." : "I didn't see a gun."); add('Dispatcher', 'Is anyone else inside?'); add('Caller', "I don't think so. The family moved out.");
      add('Dispatcher', 'Officers are on the way. Stay away from the house.'); }
    else { B.caller = 'No 911 call — patrol request';
      add('Patrol', `Dispatch, unit at ${B.addr} for the parole pickup on ${B.name}.`);
      add('Patrol', v === 'seen' ? 'We just saw him go in the side door when we pulled up. He is not answering.' : 'Movement at a window — it is him, he ducked back out of sight. Not answering the door.');
      add('Dispatcher', 'Copy. Is he known to carry?'); add('Patrol', 'Unknown. History of hiding from the warrant squad — attic and basement both.'); }
    B.occupants = 'Believed alone. Family moved out. Not confirmed.';
    B.known = [LEGAL_TXT.parole, `Absconded from parole supervision ${r.int(3, 11)} weeks ago; photo and history on file.`, sp.weapon === 'none' ? 'No firearm on record — armed status unknown.' : 'Firearm possible — prior weapons arrest.',
      'He has hidden from officers before (attic / basement). Clear every space; a robot or K9 helps.'];
    B.patrol.splice(B.patrol.length - 1, 0, v === 'seen' ? 'Patrol saw him enter the house when they arrived.' : v === 'window' ? 'Patrol saw him at a window; he ducked out of sight.' : 'A caller reported he is inside; patrol saw movement but no clear view.');
    B.sawGun = false; B.shots = !!B.officerDown; }
  if (ST === 'sovcit') { const v = st.variant; B.type = v === 'papers' ? 'civil papers service' : 'eviction enforcement'; B.caller = 'No 911 call — civil process unit';
    add('Deputy', `Dispatch, civil unit at ${B.addr}. ${v === 'papers' ? 'Serving papers' : 'Enforcing the writ of possession'} on ${B.name}.`);
    add('Deputy', `He says he is a "sovereign" and does not recognize the court. He told us to leave his property${r.chance(0.5) ? ' and said he is armed' : ''}.`);
    add('Dispatcher', 'Copy. Weapons seen?'); { const lg = ['rifle', 'shotgun'].includes(sp.weapon) && r.chance(0.5), fd = S.doors.some(d => d.fortified); add('Deputy', lg ? 'A long gun leaning by the door when he cracked it open.' : fd ? 'Nothing seen. He has a door brace and boards on the inside.' : 'Nothing seen. He says he has the right to defend his property.'); if (lg) B.sawGun = true; }
    add('Deputy', 'He shut the door. We are backing out and requesting SWAT.');
    B.occupants = 'Believed alone. Not confirmed.';
    B.known = [LEGAL_TXT.eviction, v === 'papers' ? 'Civil papers refused; he filed "sovereign" notices with the county.' : 'Eviction ordered after months of non-payment; he filed "sovereign" notices with the county.',
      'Higher odds of long guns, body armor, gas masks and reinforced doors on this type of call.'];
    if (S.intel.posts) B.known.push('Online posts: talks about "defending the property" and shows a rifle and a vest.');
    B.sawGun = !!L.find(e => /long gun/.test(e.text)); B.shots = !!B.officerDown;
    if (S.doors.some(d => d.fortified)) B.patrol.splice(B.patrol.length - 1, 0, 'Deputies report the doors are braced from inside.'); }
  if (!B.shots) { B.patrol = B.patrol.filter(t => !/heard (one shot|shots) from inside/.test(t)); for (const k of Object.keys(B)) if (Array.isArray(B[k]) && k !== 'transcript') B[k] = B[k].filter(t => typeof t !== 'string' || !/a loud bang/.test(t)); }
  if (!(ST === 'parole' && st.variant === 'caller')) B.channel = 'radio';
  B.transcript = L;
}
function typeExtraDebrief(out) { const st = S.stype; if (!st) return; typeExtraDebrief3(out);
  if (st.key === 'parole') out.push({ k: '  Warrant', v: S.result && S.result.win ? 'Parole-violation warrant served.' : 'Warrant not served.' }, { k: '  Hide', v: S.hide ? `${S.hide.name} in the ${S.rooms[S.hide.room].name}${S.hide.found ? ' — found.' : ' — not found.'}` : 'He stayed in a room; no hide used.' });
  if (st.key === 'sovcit') { const sp = S.suspect; out.push({ k: '  Court order', v: S.result && S.result.win ? 'Order enforced; subject removed in custody.' : 'Order not enforced.' },
    { k: '  Gear', v: `${SUSPECT_WEAPONS[sp.weapon].name}${sp.armor && sp.armor !== 'none' ? ', ' + sp.armor + ' armor' : ''}${sp.hasMask ? ', gas mask' : ''}; ${S.doors.filter(d => d.fortified).length} reinforced door(s).` }); } }

/* =====================================================================
   v13 CALL TYPES + STRUCTURES — fortified drug house, escaped inmates,
   duplex (party wall / unit B evacuation) and mobile homes (thin walls).
   Rules only (no DOM). Neutral wording. Every random draw uses its own
   seeded stream so the map and the base scenario stay identical per seed.
   ===================================================================== */
/* ================== TUNABLE ================== */
const DRUG_CFG = { barred: 0.85, cams: [2, 4], camRange: 9, camFov: 1.75, camFirst: 5, camTick: 1, powerAgit: 8, powerFrom: 1 };
const INMATE_CFG = { weapons: { handgun: 0.45, shotgun: 0.3, none: 0.25 }, familyN: [3, 5] };
const DUPLEX_CFG = { residentsW: [0.15, 0.3, 0.3, 0.15, 0.1], breakFrom: 20, base: 0.03, per: 0.012, cap: 0.25, phoneMul: 0.5, evacTurns: 2, riskPen: -150, evacBonus: 50 };
const TRAILER_CFG = { wallShot: 0.13, wallHit: 0.18, wallAgit: 55, hearDist: 2, hearEvery: 3 };
const DOOR_MUL = { steel: { ram: 0.35, pry: 0.3, kick: 0.15, charge: 0.85, draco: 0.7 }, thin: { kick: 2.2, ram: 1.6, pry: 1.4, charge: 1, draco: 1.2 } };
/* ============================================= */
/** Door-material multiplier on breach success (steel-reinforced drug-house doors, hollow mobile-home doors). */
function doorMul(d, m) { let k = 1; if (d.steel) k *= DOOR_MUL.steel[m] || 1; else if (d.thin) k *= DOOR_MUL.thin[m] || 1; return k; }
/** A window a suspect could climb out of (bars stop it; unit B of a duplex is not his until the party wall is open). */
function exitWin(w) { return !w.barred && (isOwnRoom(w.room) || !!(S.duplex && S.duplex.hole)); }
function roomInPlay(q) { return !q.unitB || !!(S.duplex && S.duplex.hole); }
function applyTypeExtras3() {
  const st = S.stype; if (!st) return; const sp = S.suspect;
  if (st.key === 'drughouse') { const r = makeRng(S.seed * 8117 + 31), C = DRUG_CFG;
    sp.weapon = r.pick(MULTI_TYPES.drughouse.weapons);
    S.doors.forEach(d => { if (d.exterior && !d.unitB) { d.barricaded = true; d.locked = true; d.fortified = true; d.barrKnown = true; if (d.kind !== 'garage') { d.steel = true; d.storm = false; } } });
    S.windows.forEach(w => { if (isOwnRoom(w.room) && r.chance(C.barred)) w.barred = true; });
    setupCams(r); S.power = { cut: false, at: null }; }
  if (st.key === 'inmates') { const r = makeRng(S.seed * 8123 + 37);
    sp.weapon = wpick(r, INMATE_CFG.weapons); if (sp.weapon === 'none' && S.scene && S.scene.injury) sp.weapon = 'handgun';
    S.inmFamily = { n: r.int(INMATE_CFG.familyN[0], INMATE_CFG.familyN[1]), done: false }; }
  if (S.house.duplex) { const r = makeRng(S.seed * 8147 + 43), C = DUPLEX_CFG; const res = +wpick(r, Object.fromEntries(C.residentsW.map((w, i) => [i, w])));
    S.duplex = { residents: res, evac: res ? 'none' : 'empty', evacAt: null, hole: null, risk: false, wallV: 0 }; }
}
/** Security cameras on a fortified house: over the front door, then corners. Each has a view cone. */
function setupCams(r) { const H = S.house, C = DRUG_CFG, out = [];
  const fd = S.doors.find(d => d.name === 'Front Door'), bd = S.doors.find(d => d.name === 'Back Door'), oc = d => d && (d.cells[0].find(c => roomAt(c[0], c[1]) < 0) || d.cells[0][1]);
  const f = oc(fd); if (f) out.push({ x: f[0], y: f[1], dx: 0, dy: 1, name: 'front door' });
  const corners = r.shuffle([[H.x0 - 1, H.y1 + 1, -1, 1, 'front-left corner'], [H.x1 + 1, H.y1 + 1, 1, 1, 'front-right corner'], [H.x0 - 1, H.y0 - 1, -1, -1, 'rear-left corner'], [H.x1 + 1, H.y0 - 1, 1, -1, 'rear-right corner']]);
  const b = oc(bd); if (b) corners.splice(1, 0, [b[0], b[1], 0, -1, 'back door']);
  const n = r.int(C.cams[0], C.cams[1]); for (const c of corners) { if (out.length >= n) break; out.push({ x: c[0], y: c[1], dx: c[2], dy: c[3], name: c[4] }); }
  S.cams = out.map((c, i) => Object.assign(c, { id: i, range: C.camRange, fov: C.camFov, seen: false })); }
function camSeesBase(c, x, y) { if (S.power && S.power.cut) return false; const d = dist(c.x, c.y, x, y); if (d > c.range || d < 0.5) return false;
  let a = Math.atan2(y - c.y, x - c.x) - Math.atan2(c.dy, c.dx); while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
  return Math.abs(a) <= c.fov / 2 && los(c.x, c.y, x, y) === 1; }
function camTurn() { if (!S.cams || !S.cams.length || (S.power && S.power.cut)) return; let hit = null;
  for (const u of S.units) { if (!unitAlive(u) || !onFoot(u) || u.status === 'staged' || roomAt(u.x, u.y) >= 0) continue; const c = S.cams.find(c => camSees(c, u.x, u.y)); if (c) { hit = [c, u]; break; } }
  if (!hit) return; const [c, u] = hit; S.camHits = (S.camHits || 0) + 1;
  eachSp(sp => { if (hostile()) sp.agit = clamp(sp.agit + (c.seen ? DRUG_CFG.camTick : DRUG_CFG.camFirst), 0, 100); });
  if (!c.seen) { c.seen = true; log(`${u.name} is in view of the camera at the ${c.name} — they can see us coming. Cut the power or stay out of its view.`, 'alert'); } }
/** Unit B of a duplex: evacuation clock and the extended-barricade party-wall breach. */
function duplexTurn() { const D = S.duplex, C = DUPLEX_CFG; if (!D) return; const sp = S.suspect;
  if (D.evac === 'moving' && S.turn >= D.evacAt) { D.evac = 'done'; D.evacDone = S.turn; log(`Patrol: Unit B is clear — ${D.residents === 1 ? 'the resident is' : 'all ' + D.residents + ' residents are'} out through the far door and at the perimeter.`, 'good'); }
  if (D.hole || S.phase === 'over' || S.turn < C.breakFrom || !hostile() || sp.walk || !['barricaded', 'alert'].includes(sp.mode) || sp.room < 0 || !isOwnRoom(sp.room)) return;
  const p = Math.min(C.cap, C.base + C.per * (S.turn - C.breakFrom)) * (S.nego && S.nego.contact ? C.phoneMul : 1);
  if (!S.rng.chance(p)) return; partyBreach(sp); }
/** Open 1-2 edges of the party wall next to the suspect's side and move him through. Returns the hole or null. */
function partyBreach(sp) { const D = S.duplex, H = S.house, px = H.duplex.partyX, aLeft = H.duplex.aSide === 'L', ax = aLeft ? px - 1 : px, bx = aLeft ? px : px - 1;
  const ys = []; for (let y = H.y0; y <= H.y1; y++) { const a = roomAt(ax, y), b = roomAt(bx, y); if (a >= 0 && b >= 0 && S.rooms[b].unitB && S.rooms[a].type !== 'hall' && !S.block[idx(bx, y)]) ys.push(y); }
  if (!ys.length) return null; ys.sort((a, b) => Math.abs(a - sp.y) - Math.abs(b - sp.y)); const y0 = ys[0], y1 = ys.includes(y0 + 1) ? y0 + 1 : ys.includes(y0 - 1) ? y0 - 1 : null;
  const cells = [y0].concat(y1 == null ? [] : [y1]); cells.forEach(y => S.edges.set(ek(ax, y, bx, y), E_OPEN));
  D.hole = { x: Math.min(ax, bx), ax, bx, ys: cells, turn: S.turn, roomA: roomAt(ax, y0), roomB: roomAt(bx, y0) }; D.wallV++;
  const stepIn = aLeft ? 1 : -1, tx = !S.block[idx(bx + stepIn, y0)] && roomAt(bx + stepIn, y0) === D.hole.roomB ? bx + stepIn : bx;
  sp.x = tx; sp.y = y0; sp.room = roomAt(tx, y0); sp.home = { x: tx, y: y0 }; sp.mode = 'alert'; S.intel.located = true; sp.heat = { room: sp.room, x: tx, y: y0, turn: S.turn };
  S.stats.partyWall = S.turn;
  log(`Loud impacts on the party wall — ${spName()} has broken through into Unit B (${S.rooms[sp.room].name})!`, 'bad');
  if (D.residents > 0 && D.evac !== 'done') { D.risk = true; log(`Unit B residents are still inside — get them out now!`, 'bad'); }
  else if (D.residents > 0) log('Unit B was already evacuated — nobody on that side is at risk.', 'good');
  rebuildDyn(); return D.hole; }
/** Mobile home: thin walls — rounds can come through them, and both sides hear each other. Runs per suspect. */
function thinWallTurn() { const sp = S.suspect, C = TRAILER_CFG; if (!S.house.thin || !hostile() || sp.walk || sp.room < 0 || sp.stun > 0) return;
  const rm = S.rooms[sp.room], near = S.units.filter(u => unitAlive(u) && onFoot(u) && roomAt(u.x, u.y) < 0 && u.x >= rm.x - 1 && u.x <= rm.x + rm.w && u.y >= rm.y - 1 && u.y <= rm.y + rm.h);
  const hear = S.units.filter(u => unitAlive(u) && onFoot(u) && roomAt(u.x, u.y) < 0 && Math.max(Math.abs(u.x - sp.x), Math.abs(u.y - sp.y)) <= C.hearDist + 1);
  if (hear.length) { sp.agit = clamp(sp.agit + 3, 0, 100);
    if (!sp.heat || S.turn - (sp.heard || -99) >= C.hearEvery) { sp.heard = S.turn; sp.heat = { room: sp.room, x: sp.x, y: sp.y, turn: S.turn }; S.intel.located = true; log(`${hear[0].name}: thin walls — we can hear movement in the ${rm.name}.`, 'intel'); } }
  if (!near.length || sp.cd > 0 || sp.agit < C.wallAgit || sp.weapon === 'none' || sp.mode === 'surrendered' || !S.rng.chance(C.wallShot)) return;
  const T = near.sort((a, b) => dist(a.x, a.y, sp.x, sp.y) - dist(b.x, b.y, sp.x, sp.y))[0], d = dist(T.x, T.y, sp.x, sp.y);
  S.stats.shots++; S.stats.wallShots = (S.stats.wallShots || 0) + 1; sp.cd = 2; fx('muzzle', sp.x, sp.y, { suspect: true }); fx('shot', sp.x, sp.y, { tx: T.x, ty: T.y }); S.intel.threat = 1;
  if (S.rng.chance(C.wallHit * accImpair())) { const v = T.kind === 'team' ? pickVictim(T, sp.x, sp.y) : null; shotOfficer(T, SUSPECT_CAL[sp.weapon] || 'pistol', d, sp.x, sp.y, `${rm.name} — through the wall`, v ? { victim: v } : null); }
  else log(`SHOTS FIRED through the wall of the ${rm.name} at ${T.name} — no hits. Thin walls do not stop rounds: keep off the walls.`, 'alert'); }
function types3Turn() { camTurn(); duplexTurn(); eachSp(thinWallTurn); }
/** Commands added in v13. */
function runCommand3(key) { const sp = S.suspect;
  if (key === 'evacB') { const D = S.duplex; D.evac = 'moving'; D.evacAt = S.turn + DUPLEX_CFG.evacTurns; log(`Patrol: evacuating Unit B — ${D.residents === 1 ? 'one resident' : D.residents + ' residents'}, out through the far door, away from his side. ETA ${tMin(DUPLEX_CFG.evacTurns)}.`, 'radio'); }
  if (key === 'power') { S.power.cut = true; S.power.at = S.turn; eachSp(s => { if (hostile()) s.agit = clamp(s.agit + DRUG_CFG.powerAgit, 0, 100); });
    log('Utility crew: power to the house is cut — the cameras are dark. Movement inside; they noticed the lights go out.', 'intel'); }
  if (key === 'inmfamily') { const F = S.inmFamily; F.done = true; S.intel.floors = true; S.intel.weapon = true; S.intel.threat = Math.max(S.intel.threat, 1); S.intel.suspConfirmed = S.turn + 1; ownRooms().forEach(q => q.known = true);
    const n = suspList().length, w = suspList().map(s => SUSPECT_WEAPONS[s.weapon].name), srm = S.rooms[sp.room];
    log(`Family interview: "It's our house — ${ownRooms().length} rooms, ${ownRooms().filter(q => q.type === 'bed').length} bedrooms. ${n === 1 ? 'One man came in' : n + ' men came in'}. ${w.every(x => x === 'no firearm') ? 'They did not have guns with them — but we keep a shotgun in the closet, I think it is still locked.' : `They found the ${[...new Set(w.filter(x => x !== 'no firearm'))].join(' and the ')} we keep in the house.`} Last time I saw ${n === 1 ? 'him' : 'them'} ${n === 1 ? 'he was' : 'one was'} in the ${srm ? srm.name : 'back'}."`, 'intel');
    log(`Suspect count confirmed by the family: ${n}.`, 'intel'); }
}
/** Brief and call rewrite for the v13 types (after typeBrief). */
function typeBrief3(B) { const st = S.stype, ST = st.key; if (ST !== 'drughouse' && ST !== 'inmates') return; const r = makeRng(S.seed * 9161 + 7), sp = S.suspect;
  const L = [], t0 = B.callAt, add = (who, text) => L.push({ t: t0, who, text }), R = patrolReport(); B.report = R; const words = ['', 'one', 'two', 'three', 'four'], many = R.n > 1;
  B.legal = st.legal; B.typeDesc = SCEN_TYPES[ST].desc; B.self = false; B.phone = null; B.giveNum = false;
  if (ST === 'drughouse') { B.type = st.variant === 'buy' ? 'controlled buy — fortified house' : 'narcotics search warrant — fortified house'; B.caller = 'No 911 call — narcotics unit'; B.channel = 'radio';
    const barred = S.windows.filter(w => w.barred).length, cams = (S.cams || []).length;
    add('Narcotics', `Dispatch, narcotics unit at ${B.addr}. ${st.variant === 'buy' ? 'The controlled buy went bad — our buyer got out, they locked the place down behind him.' : 'We have a search warrant for the residence. They saw us coming and locked it down.'}`);
    add('Narcotics', `Steel doors front and back, bars on ${barred > 4 ? 'most of' : 'some of'} the windows${cams ? `, ${cams} cameras on the outside` : ''}.`);
    add('Dispatcher', 'Copy. How many inside?'); add('Narcotics', `Informant says ${R.kind === 'atleast' ? 'at least two — maybe more' : R.text}. Long guns, ${r.chance(0.6) ? 'and they have vests' : 'possibly vests'}. We are holding the perimeter, requesting SWAT.`);
    B.occupants = `Informant: ${R.kind === 'atleast' ? 'at least two people, possibly more' : R.text} inside. No residents other than the suspects believed inside. Count not confirmed.`;
    B.belief = `Officer belief: ${R.kind === 'atleast' ? 'at least two suspects — possibly more' : words[R.n] + ' suspect' + (many ? 's' : '')} with long guns. Not confirmed.`;
    B.known = [LEGAL_TXT.narcotics, 'Steel-reinforced exterior doors, braced from inside: ram, pry and kick are slow — an explosive charge or the Draco arm works best.',
      `Bars on ${barred} window${barred === 1 ? '' : 's'}: nobody climbs in or out of those; the Draco arm can tear them out.`, cams ? `${cams} security camera${cams > 1 ? 's' : ''} watch the approaches — Cut Power takes them offline (they will notice).` : 'No cameras seen.',
      'Long guns and body armor are likely on this type of call. Several suspects.'];
    B.sawGun = true; B.shots = !!B.officerDown;
    B.patrol.splice(B.patrol.length - 1, 0, `Narcotics unit: ${R.kind === 'atleast' ? 'at least two subjects' : R.text} inside, doors steel-reinforced.`); }
  if (ST === 'inmates') { const F = S.inmFamily || { n: 4 }; B.type = 'escaped inmates — family fled the house'; B.caller = 'Homeowner (got out with the family)';
    add('Dispatcher', '911, what is the address of your emergency?');
    add('Caller', `${B.addr} — ${R.kind === 'atleast' ? 'at least one man, maybe more,' : many ? words[R.n] + ' men' : 'a man'} just came in through our back door. ${many || R.kind === 'atleast' ? 'They are the ones' : 'He is the one'} from the news, the escape — I'm sure of it.`);
    add('Dispatcher', 'Is everyone out of the house?'); add('Caller', `Yes — we grabbed the kids and ran out the front. All ${F.n} of us are at the neighbor's.`);
    add('Dispatcher', 'Are they armed?'); add('Caller', sp.weapon === 'none' ? 'I did not see a gun. We have a shotgun in the closet but it is locked up.' : `We keep a ${SUSPECT_WEAPONS[sp.weapon].name} in the house. They could have found it.`);
    add('Dispatcher', 'Stay where you are. Officers will come to you — they will want to talk to you about the house.');
    B.occupants = `Family of ${F.n} got out and is at the perimeter with patrol. Inside: only the escapee${many || R.kind === 'atleast' ? 's' : ''} (${R.text}). Count not confirmed.`;
    B.belief = `Officer belief: ${R.kind === 'atleast' ? 'at least one suspect, possibly more' : words[R.n] + ' suspect' + (many ? 's' : '')}. Not confirmed.`;
    B.known = [LEGAL_TXT.escape, 'Homeowner keeps a firearm in the house — treat them as armed until confirmed.', 'They want a way out, not a standoff: expect them to try any side nobody watches.',
      'The family is at the perimeter — Family Interview gives the full layout, weapons and the exact count.'];
    B.sawGun = false; B.shots = !!B.officerDown; }
  if (!B.shots) { B.patrol = B.patrol.filter(t => !/heard (one shot|shots) from inside/.test(t)); for (const k of Object.keys(B)) if (Array.isArray(B[k]) && k !== 'transcript') B[k] = B[k].filter(t => typeof t !== 'string' || !/a loud bang/.test(t)); }
  B.transcript = L; }
/** Brief notes about the structure (any call type). */
function structBrief(B) { const H = S.house; if (!B || !B.known) return;
  if (H.duplex && S.duplex) B.known.push(`Duplex: he is in ${H.duplex.aSide === 'L' ? 'the left' : 'the right'} unit. The other unit (Unit B) is a separate home — ${S.duplex.residents ? (S.duplex.residents === 1 ? 'one resident' : S.duplex.residents + ' residents') + ' may be home: evacuate it early' : 'believed empty'}. A long standoff can end with him breaking through the shared wall.`);
  if (H.trailer) B.known.push(`Mobile home (${H.trailer}-wide): thin walls and hollow doors — easy to breach, but rounds go through the walls and he can hear officers outside.${H.park ? ' Trailer park: neighbors close on both sides.' : ''}`); }
function typeExtraDebrief3(out) { const st = S.stype, H = S.house, D = S.duplex;
  if (st && st.key === 'drughouse') out.push({ k: '  Fortified house', v: `${S.doors.filter(d => d.steel).length} steel door(s), ${S.windows.filter(w => w.barred).length} barred window(s); cameras ${S.power && S.power.cut ? 'cut at ' + elapsedAt(S.power.at) : 'left running'}${S.camHits ? ` — officers were on camera ${S.camHits} turn(s)` : ''}.` });
  if (st && st.key === 'inmates') out.push({ k: '  Family interview', v: S.inmFamily && S.inmFamily.done ? 'Done — layout, weapons and count from the homeowner.' : 'Not done.' });
  if (D) out.push({ k: '  Duplex — Unit B', v: (D.residents ? `${D.residents} resident(s); ${D.evac === 'done' ? 'evacuated at ' + elapsedAt(D.evacDone) : D.evac === 'moving' ? 'evacuation under way' : 'not evacuated'}` : 'Empty') + (D.hole ? `. Party wall breached at ${elapsedAt(D.hole.turn)}${D.risk ? ' — RISK FLAG: residents were still inside' : ' — nobody at risk'}` : '. Party wall held') + '.' });
  if (H.thin && S.stats.wallShots) out.push({ k: '  Thin walls', v: `${S.stats.wallShots} shot(s) through the mobile-home walls.` }); }
function typeScore3(add) { const D = S.duplex, C = DUPLEX_CFG; if (!D) return;
  if (D.risk) add('Unit B residents at risk (party wall breached before evacuation)', C.riskPen);
  else if (D.residents && D.evac === 'done') add('Unit B evacuated in time', C.evacBonus); }

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
  { const rg = !moving && u.regroup ? regroupForm(u, n) : null; if (rg) return { kind: 'wallline', pts: rg }; }
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
function wallSpotsBase(u, n) { const r = roomAt(u.x, u.y), rad = FORM_CFG.wallRad, W = 0.5 - FORM_CFG.wallIn, c = [];
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

/* =====================================================================
   v16 ENCOUNTERS — the see-suspect decision. Rules only (no DOM).
   Every turn an officer team has a direct sight line to a hostile suspect, the turn pauses at its end (a half-turn
   before it resolves) with one popup per suspect: a description written fresh from his CURRENT state, how sure the
   officers are about what is in his hands, and the options this team's equipment allows, each with a likelihood word
   (the percentages behind it stay hidden). The player picks an option, then the officer who does it.
   - armed and AIMING at officers: no choice — officers engage; who gets the first rounds off is rolled (FIRST-FIRE rule)
   - shots at officers inside the house with a direct line during the turn: officers already returned fire
     automatically; a result box says what happened before the turn ends
   - BLIND FIRE at the threshold after a breach / flashbang / gas: the turn pauses at once with 4 choices
   S.encOn switches the system on (UI games); headless bots / balance harness run without it.
   ===================================================================== */
const ENC_CFG = {
  enabled: false,
  words: [[0.75, 'Very likely'], [0.55, 'Likely'], [0.35, 'Possible'], [0.15, 'Unlikely'], [0, 'Very unlikely']],
  firstFire: 0.75, cut: { bang: 0.35, gas: 0.25, charge: 0.2 }, firstMin: 0.2,
  blind: 0.16, blindHit: 0.18, negBonus: 0.12, crowd: 0.04, heard: 0.3, heardDist: 3,
  unhurt: 300, minorKeep: 0.8, killedKeep: 0.33, unjustKeep: 0.05, reviewMissions: 10, removeP: 0.3, keep: 0.45,
};
/* personality traits — base compliance and the hooks a later full mental-state system plugs into */
const ENC_TRAITS = {
  compliant:   { comply: 0.55, stall: 0.15, flee: 0.15, harmOff: 0.05, selfHarm: 0, sbc: 0, fightBare: 0.05, label: 'compliant' },
  stalling:    { comply: 0.30, stall: 0.55, flee: 0.15, harmOff: 0.10, selfHarm: 0, sbc: 0, fightBare: 0.10, label: 'compliant but stalling' },
  scared:      { comply: 0.38, stall: 0.20, flee: 0.50, harmOff: 0.15, selfHarm: 0.05, sbc: 0, fightBare: 0.10, label: 'scared' },
  intoxicated: { comply: 0.22, stall: 0.20, flee: 0.25, harmOff: 0.25, selfHarm: 0.05, sbc: 0.05, fightBare: 0.35, label: 'intoxicated' },
  mental:      { comply: 0.20, stall: 0.25, flee: 0.20, harmOff: 0.20, selfHarm: 0.35, sbc: 0.15, fightBare: 0.15, label: 'in mental-health crisis' },
  determined:  { comply: 0.07, stall: 0.10, flee: 0.15, harmOff: 0.55, selfHarm: 0.05, sbc: 0.10, fightBare: 0.40, label: 'determined' },
};
const ENC_POSES = {
  aim:     { armed: true,  text: 'is pointing {item} at the officers' },
  down:    { armed: true,  text: 'is holding {item} down at his side' },
  hands:   { text: 'has both hands visible and empty' },
  pockets: { text: 'has his hands in his pockets' },
  ignore:  { text: 'is pacing and ignoring commands', armedText: 'is pacing with {item} in his hand, ignoring commands' },
  record:  { text: 'is holding up a phone, video recording the officers' },
  call:    { text: 'has one hand up and the other holding a phone to his ear — calling someone' },
  behind:  { text: 'has {hands} behind his back, out of view' },
  awayUp:  { text: 'is turned away from the officers with both hands up', compliant: true },
  conceal: { text: '{facing} with {hands} hidden in front of his body' },
  cover:   { text: 'is partly hidden behind {cover}, only part of him visible' },
  selfharm:{ text: 'is threatening to hurt himself' },
  hostage: { text: 'is holding a person in front of him' },
  heard:   { text: 'cannot be seen — officers hear movement close by' },
};
const ENC_OPTS = {
  v_drop:  { label: 'Voice: "Drop it!"', voice: true, want: 'comply' },
  v_hands: { label: 'Voice: "Show me your hands!"', voice: true, want: 'comply' },
  v_ground:{ label: 'Voice: "Get down on the ground!"', voice: true, want: 'comply' },
  v_come:  { label: 'Voice: "Walk to us — slowly!"', voice: true, want: 'comply' },
  v_phone: { label: 'Voice: "Put the phone down!"', voice: true, want: 'comply' },
  nego:    { label: 'Negotiator talks to him', want: 'comply' },
  hold:    { label: 'Hold and observe', want: 'stable' },
  taser:   { label: 'Taser', want: 'stop' },
  ll:      { label: 'Less-lethal (40mm)', want: 'stop' },
  bang:    { label: 'Flashbang', want: 'stun' },
  gas:     { label: 'CS gas', want: 'stun' },
  shoot:   { label: 'Shoot (lethal force)', want: 'hit' },
  withdraw:{ label: 'Withdraw / back out', want: 'safe' },
};
const ENC_WANT = { comply: 'he complies', stable: 'he stays put without escalating', stop: 'it stops him', stun: 'it stuns him', hit: 'a hit', safe: 'a clean exit' };
const BLIND_OPTS = [
  { key: 'cancel', label: 'Cancel the plan to enter the room', sub: 'pull back from the doorway and hold' },
  { key: 'continue', label: 'Continue entering and return fire', sub: 'the follow-up goes ahead — officers fire through the doorway first' },
  { key: 'doorway', label: 'Work the doorway without going through', sub: 'stay outside and assess / slice the room from the frame' },
  { key: 'frame', label: 'Point and defense engage from the door frame', sub: 'two officers fire from the frame, the rest stay back' },
];
function encOn() { return S.encOn !== undefined ? !!S.encOn : ENC_CFG.enabled; }
function encWord(p) { for (const [t, w] of ENC_CFG.words) if (p >= t) return w; return 'Very unlikely'; }
function spIdx(sp) { return suspList().indexOf(sp); }
function spAt(i) { return suspList()[i] || null; }
function spArmed(sp) { return !!sp.weapon && sp.weapon !== 'none'; }
/** sp.mind: personality + hooks (self-harm, suicide-by-cop, harm-officers, fight-without-weapons). Lazily made and seeded
    from the mission seed (does not touch S.rng), so old saves gain it on first contact. */
function mindOf(sp) { if (sp.mind) return sp.mind;
  const r = makeRng(S.seed * 7919 + (spIdx(sp) + 1) * 131 + 7), st = S.stype ? S.stype.key : 'barricade';
  const pool = st === 'mental' ? ['mental', 'mental', 'mental', 'scared', 'stalling'] : st === 'domestic' ? ['intoxicated', 'determined', 'stalling', 'scared', 'compliant'] : st === 'flee' || st === 'parole' ? ['scared', 'determined', 'stalling', 'compliant']
    : st === 'neighbor' ? ['intoxicated', 'stalling', 'determined', 'compliant'] : ['determined', 'stalling', 'scared', 'intoxicated', 'compliant', 'mental'];
  const trait = r.pick(pool), T = ENC_TRAITS[trait], j = v => clamp(v + (r() - 0.5) * 0.1, 0, 1);
  sp.mind = { v: 1, trait, comply: j(T.comply), stall: j(T.stall), flee: j(T.flee), harmOff: j(T.harmOff), selfHarm: j(T.selfHarm), sbc: j(T.sbc), fightBare: j(T.fightBare),
    selfHarmHook: st === 'mental', hostageHook: false, phone: r.chance(0.8), pose: null, poseTurn: -1, read: null, cmd: {}, delay: 0, seen: 0, ignored: 0 };
  return sp.mind; }
function hostageAvail(sp) { const M = mindOf(sp); return !!(M.hostageHook && S.hostages && S.hostages.some(h => h.room === sp.room && !h.out)); } // hook: no hostage system yet
/** Teams with a direct line to the suspect (nearest first). */
/** v17: an officer slicing the pie at a corner sees around it from the peek cell — that is visual contact too. */
function encSliceSees(u, sp) { return !!(u.slice && u.slice.ox === u.x && u.slice.oy === u.y && u.slice.cells.includes(idx(sp.x, sp.y))); }
function encSeers(sp) { return S.units.filter(u => u.kind === 'team' && unitAlive(u) && u.deployed && teamOk(u).length && ((u.vis && u.vis.includes(idx(sp.x, sp.y)) && los(u.x, u.y, sp.x, sp.y) === 1) || encSliceSees(u, sp)))
  .sort((a, b) => dist(a.x, a.y, sp.x, sp.y) - dist(b.x, b.y, sp.x, sp.y)); }
/** Pick his visible state this turn from his previous one, weapon, mood and personality. */
function encPose(sp, u) { const M = mindOf(sp), r = S.rng, armed = spArmed(sp), agit = (sp.agit || 0) / 100;
  if (M.pose && M.poseTurn === S.turn) return M.pose;
  const w = {};
  const add = (k, v) => { if (v > 0) w[k] = (w[k] || 0) + v; };
  if (armed) { add('aim', 0.06 + M.harmOff * 0.22 + agit * 0.12 - (sp.daze > 0 ? 0.08 : 0)); add('down', 0.3); add('cover', 0.18); add('conceal', 0.14); add('behind', 0.08); add('pockets', 0.04); }
  else { add('hands', 0.2 + M.comply * 0.3); add('pockets', 0.14); add('behind', 0.1); add('conceal', 0.1); add('cover', 0.1); add('awayUp', 0.05 + M.comply * 0.15); }
  add('ignore', 0.06 + (1 - M.comply) * 0.1); if (M.phone) { add('record', 0.07); add('call', 0.06 + M.stall * 0.08); }
  if (M.selfHarmHook && M.selfHarm > 0.2) add('selfharm', M.selfHarm * 0.3);
  if (hostageAvail(sp)) add('hostage', 0.25);
  if (M.pose && w[M.pose] && M.pose !== 'aim' && r.chance(ENC_CFG.keep)) return M.pose; // sticky: people do not change stance every 30 s
  let tot = 0; for (const k in w) tot += w[k]; let x = r() * tot;
  for (const k in w) { x -= w[k]; if (x <= 0) return k; } return 'down'; }
const GUN_WORD = { handgun: 'a pistol', rifle: 'a rifle', shotgun: 'a shotgun', knife: 'a knife' };
/** What is in his hands vs what the officers think it is, with their confidence. */
function encReadBase(sp, u, pose) { const r = S.rng, armed = spArmed(sp), d = u ? dist(u.x, u.y, sp.x, sp.y) : 8, M = mindOf(sp);
  let actual = 'none';
  if (pose === 'aim' || pose === 'down' || (pose === 'ignore' && armed)) actual = 'weapon';
  else if (pose === 'record' || pose === 'call') actual = 'phone';
  else if (['pockets', 'behind', 'conceal'].includes(pose)) actual = armed && r.chance(0.6) ? 'weapon' : M.phone && r.chance(0.6) ? 'phone' : 'none';
  else if (pose === 'cover' || pose === 'selfharm' || pose === 'hostage') actual = armed ? 'weapon' : 'none';
  const hidden = ['pockets', 'behind', 'conceal', 'cover'].includes(pose), far = d > 6;
  let conf, looks;
  if (pose === 'heard') { conf = 'unknown'; looks = 'unknown'; }
  else if (actual === 'weapon' && !hidden) { conf = far && r.chance(0.3) ? 'uncertain' : 'confident'; looks = 'gun'; }
  else if (actual === 'phone' && !hidden) { if (r.chance(far ? 0.2 : 0.08)) { conf = 'uncertain'; looks = 'gun'; } else { conf = 'confident'; looks = 'phone'; } }
  else if (hidden) { const x = r(); if (actual === 'weapon') { conf = x < 0.35 ? 'uncertain' : 'unknown'; looks = x < 0.35 ? 'gun' : 'unknown'; }
    else if (actual === 'phone') { conf = x < 0.25 ? 'uncertain' : 'unknown'; looks = x < 0.25 ? 'gun' : 'unknown'; } else { conf = 'unknown'; looks = 'unknown'; } }
  else { conf = 'confident'; looks = 'empty'; }
  return { actual, looks, conf, kind: actual === 'weapon' ? (sp.weapon || 'handgun') : actual }; }
function confText(rd, sp) { if (rd.looks === 'empty') return 'Officers are confident his hands are empty.';
  if (rd.conf === 'confident') return rd.looks === 'gun' ? `Officers are confident it is a gun (${(GUN_WORD[sp.weapon] || 'a handgun').replace(/^an? /, '')}).` : 'Officers are confident it is a phone.';
  if (rd.conf === 'uncertain') return rd.looks === 'gun' ? 'Officers are uncertain but it looks like a gun.' : 'Officers are uncertain — it may be a phone.';
  return 'Officers cannot tell — unknown item.'; }
function roomWord(sp) { const rm = S.rooms[sp.room]; return rm && rm.known ? rm.name.toLowerCase() : 'room'; }
/** Fresh description from his actual position and state. */
function encDescribe(sp, u, pose, rd) { const P = ENC_POSES[pose] || ENC_POSES.down, rm = S.rooms[sp.room], r = S.rng;
  let where = 'in the yard';
  if (rm) { const nearX = sp.x - rm.x <= 0 || rm.x + rm.w - 1 - sp.x <= 0, nearY = sp.y - rm.y <= 0 || rm.y + rm.h - 1 - sp.y <= 0;
    where = (nearX && nearY ? 'in the corner of the ' : nearX || nearY ? 'against the wall of the ' : 'in the middle of the ') + roomWord(sp);
    if (sp.atWindow) where = 'by the window of the ' + roomWord(sp); }
  const itemW = rd.looks === 'gun' && rd.conf !== 'unknown' ? (rd.conf === 'confident' || rd.conf === 'known' ? GUN_WORD[sp.weapon] || 'a gun' : 'what looks like a gun') : rd.actual === 'phone' && rd.looks === 'phone' ? 'a phone' : 'something';
  const t = (P.armedText && rd.actual === 'weapon' ? P.armedText : P.text).replace('{item}', itemW).replace('{hands}', r.chance(0.5) ? 'one hand' : 'both hands').replace('{facing}', r.chance(0.5) ? 'is turned away' : 'is facing the officers')
    .replace('{cover}', rm ? r.pick(['a doorway edge', 'a piece of furniture', 'the door frame', 'a wall corner']) : 'a vehicle');
  const dist_ = u ? Math.max(1, Math.round(dist(u.x, u.y, sp.x, sp.y))) : null;
  const lead = pose === 'heard' ? `${multiSp() ? spName(sp) : 'The suspect'} ${t}${rm && rm.known ? ' (' + roomWord(sp) + ')' : ''}.` : `${multiSp() ? spName(sp) : 'He'} is ${where}${dist_ ? ` (~${dist_} m from ${u.name})` : ''} and ${t}.`;
  const extra = [];
  if (sp.daze > 0 || sp.impair > 0.3) extra.push(sp.daze > 0 ? 'He looks disoriented.' : 'He is coughing, eyes streaming.');
  if (sp.injured) extra.push(injText(sp)); if (rd.reassess) extra.push('Officers lost sight of him for a while — they must reassess what is in his hands.');
  const M = mindOf(sp); if (M.ignored >= 2 && pose !== 'heard') extra.push('He has ignored several commands.');
  return [lead, pose === 'heard' ? '' : confText(rd, sp)].concat(extra).filter(Boolean).join(' '); }
/* ---------- equipment-based options and who can do them ---------- */
function encWho(u, sp, key) { if (!u) return [];
  const d = dist(u.x, u.y, sp.x, sp.y), clear = los(u.x, u.y, sp.x, sp.y) === 1, m = teamOk(u);
  const ids = L => L.map(o => o.id);
  switch (key) {
    case 'shoot': return clear ? ids(m.filter(o => { const k = memberWeapon(o); return k && d <= WEAPONS[k].range; })) : [];
    case 'taser': return clear && d <= TASER_CFG.range ? ids(m.filter(o => carries(o, 'taser') && freeable(o) >= 1)) : [];
    case 'll': return clear && d <= LL_CFG.range ? ids(m.filter(o => (o.quals || []).includes('ll') && carries(o, 'lesslethal') && invOf(o).ll > 0 && (holds(o, 'lesslethal') || freeable(o) >= 2))) : [];
    case 'bang': case 'gas': return sp.room >= 0 ? ids(m.filter(o => countOf(o, key) > 0)) : [];
    case 'nego': return negOnScene().map(o => o.id);
    default: return ids(m);
  } }
function encFireRisk(sp, pose) { const M = mindOf(sp); if (!spArmed(sp)) return 0;
  return clamp(M.harmOff * 0.35 * ({ down: 1.3, conceal: 1, cover: 1.1, behind: 0.9, pockets: 0.7, aim: 2 }[pose] || 0.5) * (sp.daze > 0 ? 0.5 : 1) * (1 + (sp.agit || 0) / 200), 0, 0.8); }
/** Hidden percentage behind each likelihood word. */
function encOdds(sp, u, key, pose) { const M = mindOf(sp), seen = encSeers(sp).length;
  let base = M.comply + ENC_CFG.crowd * Math.max(0, seen - 1) + (negOnScene().length ? ENC_CFG.negBonus : 0) + (sp.daze > 0 ? 0.12 : 0) + clamp(sp.impair || 0, 0, 1) * 0.08 - (sp.agit || 0) / 400 + (sp.talk || 0) / 400;
  if (pose === 'ignore') base *= 0.6; if (pose === 'awayUp' || pose === 'hands') base += 0.15; if (sp.injured) base += 0.1;
  const d = u ? dist(u.x, u.y, sp.x, sp.y) : 6;
  let p;
  if (ENC_OPTS[key] && ENC_OPTS[key].voice) { const n = M.cmd[key] || 0; p = base + (n === 1 ? 0.06 : n === 2 ? 0.03 : n >= 3 ? -0.07 * (n - 2) : 0) + (key === 'v_phone' && (pose === 'record' || pose === 'call') ? 0.12 : 0) + (key === 'v_hands' && ['pockets', 'behind', 'conceal'].includes(pose) ? 0.05 : 0); }
  else switch (key) {
    case 'nego': p = base + 0.15 + M.stall * 0.1; break;
    case 'hold': p = 1 - encFireRisk(sp, pose) - M.flee * 0.2; break;
    case 'shoot': p = u ? hitChance(u, sp.x, sp.y, null, {}).p : 0.4; break;
    case 'taser': p = u ? deviceChance(u, 'taser', d) : 0.5; break;
    case 'll': p = u ? deviceChance(u, 'llfire', d) * (1 - LL_CFG.noEffect) : 0.5; break;
    case 'bang': p = 0.65 - M.harmOff * 0.2; break;
    case 'gas': p = 0.5 - M.harmOff * 0.15; break;
    case 'withdraw': p = 1 - encFireRisk(sp, pose) * 0.6; break;
    default: p = base; }
  return clamp(p, 0.02, 0.97); }
function encOptionsBase(sp, u, pose, rd) { const keys = [];
  if (pose === 'heard') keys.push('v_come', 'v_hands', 'hold', 'bang', 'gas', 'nego', 'withdraw');
  else { if (rd.looks === 'gun' || rd.actual === 'weapon' && !['behind', 'pockets', 'conceal', 'cover'].includes(pose)) keys.push('v_drop');
    keys.push('v_hands', 'v_ground', 'v_come'); if (pose === 'record' || pose === 'call') keys.push('v_phone');
    keys.push('nego', 'hold', 'taser', 'll', 'bang', 'gas', 'shoot', 'withdraw'); }
  return keys.map(k => { const who = encWho(u, sp, k); if (!who.length) return null; const p = encOdds(sp, u, k, pose);
    return { key: k, label: ENC_OPTS[k].label, word: encWord(p), hint: `${encWord(p)} that ${ENC_WANT[ENC_OPTS[k].want]}`, who, team: k === 'hold' || k === 'withdraw' }; }).filter(Boolean); }
/* ---------- building the half-turn ---------- */
function encLogFrom(n) { return S.log.slice(n).map(l => l.text).filter(t => !/^— TURN/.test(t)); }
/** The suspect fired at officers inside the house with a direct line: they already returned fire (returnFire). Note it for the result box. */
function encNoteFire(T, where) { if (!encOn() || !T || T.kind !== 'team' || roomAt(T.x, T.y) < 0) return; const sp = S.suspect; sp.firedAt = S.turn;
  (S.encEv = S.encEv || []).push({ sp: spIdx(sp), team: T.name, where, from: S.log.length - 1 }); }
function encBuild() { const items = [], ev = S.encEv || []; S.encEv = [];
  // auto exchanges during the turn → one result box per suspect
  const bySp = {}; ev.forEach(e => { (bySp[e.sp] = bySp[e.sp] || []).push(e); });
  for (const k in bySp) { const e = bySp[k], from = Math.max(0, e[0].from); const sp = spAt(+k);
    items.push({ kind: 'result', sp: +k, title: 'Shots fired — officers returned fire', text: `${multiSp() && sp ? spName(sp) : 'The suspect'} fired at ${[...new Set(e.map(x => x.team))].join(', ')} from the ${e[0].where}. Officers with a direct line returned fire automatically.`, res: encLogFrom(from).slice(0, 8), done: true }); }
  suspList().forEach((sp, i) => withSp(sp, () => {
    if (!suspectActive()) return; const M = mindOf(sp);
    if (M.delay > 0 && hostile()) { M.delay = 0; const n = S.log.length; surrender(`${spName()}: "Okay — okay, I'm coming out. Don't shoot." — he puts everything down and complies.`); 
      items.push({ kind: 'result', sp: i, title: 'He gives up', text: 'After stalling, he complies.', res: encLogFrom(n), done: true }); return; }
    if (!hostile() || sp.stun > 0 || sp.mode === 'fleeing') return;
    if (M.contactTurn === S.turn) return; // v17: already had its popup this turn (first contact pauses mid-turn)
    const seers = encSeers(sp); let u = seers[0], pose;
    if (!u) { const near = S.units.filter(q => q.kind === 'team' && unitAlive(q) && q.deployed && teamOk(q).length && roomAt(q.x, q.y) >= 0 && cheb(q.x, q.y, sp.x, sp.y) <= ENC_CFG.heardDist && !los(q.x, q.y, sp.x, sp.y))
        .sort((a, b) => dist(a.x, a.y, sp.x, sp.y) - dist(b.x, b.y, sp.x, sp.y));
      if (!near.length || !S.rng.chance(ENC_CFG.heard)) return; u = near[0]; pose = 'heard'; }
    else { pose = encPose(sp, u); M.contactTurn = S.turn; }
    M.pose = pose; M.poseTurn = S.turn; M.seen++; const rd = encRead(sp, u, pose); M.read = rd;
    const text = encDescribe(sp, u, pose, rd);
    if (pose === 'aim') { const n = S.log.length; encExchange(sp, u, 'aim');
      items.push({ kind: 'result', sp: i, uid: u.uid, pose, title: 'Armed and aiming — officers engage', text, res: encLogFrom(n), done: true }); return; }
    items.push({ kind: 'contact', sp: i, uid: u.uid, pose, read: { conf: rd.conf, looks: rd.looks }, title: pose === 'heard' ? 'Movement heard' : `Visual contact — ${u.name}`, text, options: encOptions(sp, u, pose, rd) });
  }));
  return items; }
/** v17: FIRST visual contact this turn → pause right at that moment (mid-turn), before the officers' automatic
    responses (challenge, less-lethal, hands-on arrest) or his reaction can resolve it unseen. One popup per suspect per
    turn; nothing when nobody has a line on a live, hostile suspect. Called by stepTick after movement + vision. */
function encContactCheck() { if (!encOn() || (S.phase !== 'executing' && !(S.phase === 'encounter' && S.enc && S.enc.items))) return false; /* v22: a blind-fire pause in the same tick still gets the sight popup appended */ const items = [];
  suspList().forEach((sp, i) => withSp(sp, () => {
    if (!suspectActive() || !hostile() || sp.stun > 0 || sp.mode === 'fleeing') return; const M = mindOf(sp); if (M.contactTurn === S.turn) return;
    const u = encSeers(sp)[0]; if (!u) return;
    const pose = encPose(sp, u); M.pose = pose; M.poseTurn = S.turn; M.contactTurn = S.turn; M.seen++; const rd = encRead(sp, u, pose); M.read = rd;
    const text = encDescribe(sp, u, pose, rd), why = encWhy(u);
    if (pose === 'aim') { const n = S.log.length; encExchange(sp, u, 'aim');
      items.push({ kind: 'result', sp: i, uid: u.uid, pose, mid: true, title: 'Armed and aiming — officers engage', text, res: encLogFrom(n), done: true }); return; }
    items.push({ kind: 'contact', sp: i, uid: u.uid, pose, mid: true, why, read: { conf: rd.conf, looks: rd.looks }, title: `Visual contact — ${u.name}${why ? ' (' + why + ')' : ''}`, text, options: encOptions(sp, u, pose, rd) });
  }));
  if (!items.length) return false; log(`— Contact: turn paused at the moment of sight (tick ${S.tick}/${TICKS}). —`, 'system'); return encPause(items, false); }
/** What the seeing team was doing when contact happened (shown in the popup title). */
function encWhy(u) { const o = u.orders && u.orders[0]; if (!o) return ''; return { clear: 'entering and clearing', corner: 'working the corner', breach: 'at the breach', move: 'moving', polecam: 'at the door' }[o.type] || ''; }
function encPause(items, atEnd) { if (!items.length) return false; if (S.enc && S.enc.items) { S.enc.items.push(...items); return true; }
  S.enc = { items, i: 0, atEnd: !!atEnd, turn: S.turn }; S.phase = 'encounter'; S.version++; return true; }
/** Called by stepTick on the last tick: true = paused for the half-turn. */
function encEndTurn() { if (!encOn()) return false; return encPause(encBuild(), true); }
function encCur() { return S.enc && S.enc.items[S.enc.i] || null; }
/* ---------- first-fire exchange ---------- */
function devCut() { const D = S.devTurn && S.devTurn.turn === S.turn ? S.devTurn : {}; let c = 0; for (const k of ['bang', 'gas', 'charge']) if (D[k]) c += ENC_CFG.cut[k]; return c; }
function encFirstP() { return clamp(ENC_CFG.firstFire - devCut(), ENC_CFG.firstMin, ENC_CFG.firstFire); }
function encMarkDev(o) { if (!o) return; const k = o.type === 'bang' ? 'bang' : o.type === 'gas' ? 'gas' : (o.type === 'breach' || o.type === 'detonate') && (o.method === 'charge' || o.type === 'detonate') ? 'charge' : null;
  if (!k) return; if (!S.devTurn || S.devTurn.turn !== S.turn) S.devTurn = { turn: S.turn }; S.devTurn[k] = true; }
function encShotFor(u, sp) { const d = dist(sp.x, sp.y, u.x, u.y); return { u, px: sp.x, py: sp.y, d, l: los(sp.x, sp.y, u.x, u.y) || 1, cls: targetClass(u, sp.x, sp.y), indoor: roomAt(u.x, u.y) >= 0 }; }
/** Armed suspect and officers exchange fire. 75% he gets the first rounds off (less after a bang / gas / charge this turn). */
function encExchange(sp, u, why) { return withSp(sp, () => { if (!hostile()) return null;
  const susFirst = S.rng.chance(encFirstP()); sp.firedAt = S.turn; sp.encAim = S.turn;
  log(susFirst ? `${spName()} gets the first rounds off at ${u.name}.` : `${u.name} fires first.`, 'alert');
  if (susFirst) { suspectFire(encShotFor(u, sp)); } // suspectFire ends with the automatic return fire (nearest 3 with a line)
  else { returnFire(); if (hostile() && sp.stun <= 0 && sp.mode !== 'incapacitated') { S.encNoRet = true; try { suspectFire(encShotFor(u, sp)); } finally { S.encNoRet = false; } } }
  return susFirst ? 'suspect' : 'officers'; }); }
/* ---------- resolving a choice ---------- */
function encJustified(sp, item) { const M = mindOf(sp), rd = M.read || {};
  if (sp.firedAt === S.turn || item.pose === 'aim') return true; // he fired / is aiming: always justified
  if (item.pose === 'awayUp' || item.pose === 'hands') return false; // compliant / visibly empty hands
  return rd.actual === 'weapon'; }
function encReview(o, sp) { const removed = S.rng.chance(ENC_CFG.removeP);
  (S.reviews = S.reviews || []).push({ id: o.id, name: o.name, careerId: o.careerId || null, missions: ENC_CFG.reviewMissions, removed, turn: S.turn });
  log(`Use-of-force review opened: ${o.name} fired on a ${spArmed(sp) && (mindOf(sp).read || {}).actual === 'weapon' ? 'compliant' : 'unarmed'} subject. Officer out for ${ENC_CFG.reviewMissions} missions pending investigation.`, 'bad'); }
function encRetreat(sp, u) { let best = null;
  for (let k = 0; k < 2; k++) { best = null; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = sp.x + dx, y = sp.y + dy; if (roomAt(x, y) < 0 || S.block[idx(x, y)] || !seeE(sp.x, sp.y, x, y)) continue;
      const e = edge(sp.x, sp.y, x, y); if (e.t === 'D' && e.d.state !== 'open') continue; const s = dist(x, y, u.x, u.y) + (los(u.x, u.y, x, y) ? 0 : 3);
      if (!best || s > best.s) best = { x, y, s }; }
    if (!best || best.s <= dist(sp.x, sp.y, u.x, u.y)) break; sp.x = best.x; sp.y = best.y; sp.room = roomAt(sp.x, sp.y); }
  sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn }; }
/** Suspect response to a non-force option (decision tree with hidden %). */
function encRespondBase(sp, u, key, item) { const M = mindOf(sp), pose = item.pose, armed = spArmed(sp);
  const pc = key === 'hold' ? M.comply * 0.12 + M.stall * 0.08 : encOdds(sp, u, key, pose);
  const fire = armed && u ? encFireRisk(sp, pose) * (1 - pc) * (key === 'hold' ? 0.5 : 0.8) : 0, hostage = hostageAvail(sp) ? 0.1 * (1 - pc) : 0;
  const delay = M.stall * (1 - pc) * 0.45, retreat = M.flee * (1 - pc) * 0.35, x = S.rng();
  const nm = multiSp() ? spName() : 'He';
  if (x < pc) { if (key === 'v_phone') { M.pose = 'hands'; M.comply = clamp(M.comply + 0.1, 0, 1); log(`${nm} puts the phone down.`, 'good'); return 'comply'; }
    if (key === 'hold') { surrender(`${nm} gives up on his own — he kneels and puts his hands up.`); return 'comply'; }
    surrender(`${u ? u.name + ': ' : ''}${ENC_OPTS[key].label.replace(/^Voice: /, '')} — ${nm.toLowerCase() === 'he' ? 'he' : nm} complies${armed ? ', weapon on the floor' : ''}, hands up, getting on the ground.`); return 'comply'; }
  let y = x - pc;
  if (y < fire && u) { log(`${nm} raises the weapon.`, 'alert'); encExchange(sp, u, 'raise'); return 'fire'; } y -= fire;
  if (y < hostage) { log(`${nm} grabs the person next to him.`, 'alert'); return 'hostage'; } y -= hostage;
  if (y < delay) { M.delay = 1; log(`${nm}: "Give me a minute — I'm coming, I'm coming." He is stalling.`, 'radio'); return 'delay'; } y -= delay;
  if (y < retreat && u) { encRetreat(sp, u); log(`${nm} backs away deeper into the ${roomWord(sp)}.`, 'alert'); return 'retreat'; }
  M.ignored++; aggressive(2); log(`${nm} ignores the ${key === 'hold' ? 'officers' : 'command'}.`, 'radio'); return 'ignore'; }
function encChooseBase(key, offId) { const it = encCur(); if (!it || it.done || S.phase !== 'encounter') return { ok: false, reason: 'No decision pending' };
  if (it.kind === 'blind') return blindChoose(key);
  const opt = (it.options || []).find(o => o.key === key); if (!opt) return { ok: false, reason: 'Option not available' };
  const sp = spAt(it.sp), u = unit(it.uid); if (!sp || !u) return { ok: false, reason: 'Contact lost' };
  const oid = offId || opt.who[0]; if (!opt.who.includes(oid)) return { ok: false, reason: 'That officer cannot do it' };
  const o = off(oid) || S.officers.find(q => q.id === oid), nm = o ? o.name : u.name, n0 = S.log.length;
  withSp(sp, () => { const M = mindOf(sp);
    if (!hostile()) { log('He is no longer a threat.', 'good'); return; }
    if (ENC_OPTS[key].voice) { M.cmd[key] = (M.cmd[key] || 0) + 1; S.stats.challenged = true; log(`${nm}: ${ENC_OPTS[key].label.replace(/^Voice: /, '')}`, 'radio'); encRespond(sp, u, key, it); return; }
    switch (key) {
      case 'nego': sp.talk = clamp((sp.talk || 0) + 30, 0, 100); log(`${nm} (negotiator) talks to him from cover.`, 'radio'); encRespond(sp, u, 'nego', it); return;
      case 'hold': log(`${u.name} holds and observes.`, 'radio'); encRespond(sp, u, 'hold', it); return;
      case 'withdraw': { log(`${u.name} backs out of the line of sight.`, 'radio'); const risk = encFireRisk(sp, it.pose) * 0.6; if (S.rng.chance(risk)) encExchange(sp, u, 'withdraw');
        encWithdraw(u, sp); return; }
      case 'shoot': { const just = encJustified(sp, it); if (!just && o) encReview(o, sp); const r = fireAt(u, sp.x, sp.y, 'fire');
        if (r === 'miss') log(`${nm}: shot missed.`, 'radio');
        if (hostile() && spArmed(sp) && sp.stun <= 0 && S.rng.chance(mindOf(sp).harmOff + 0.2)) { S.encNoRet = false; suspectFire(encShotFor(u, sp)); }
        return; }
      case 'taser': case 'll': { const type = key === 'taser' ? 'taser' : 'llfire', c = devCfg(type), k = key === 'taser' ? 'taser' : 'lesslethal', p = deviceChance(u, type, dist(u.x, u.y, sp.x, sp.y));
        const tr = o ? deviceTransition(u, o, k, c.hands, q => { if (type === 'llfire') llSpend(q); fx(key === 'taser' ? 'taser' : 'll', sp.x, sp.y, { fromX: u.x, fromY: u.y }); return S.rng.chance(p) && (type === 'taser' || !S.rng.chance(c.noEffect)); }) : null;
        if (!tr) { log(`${nm}: could not free the hands for it.`, 'alert'); return; }
        if (tr.r) { sp.stun = Math.max(sp.stun || 0, (type === 'taser' ? c.stunTurns : c.stunTurns[1]) * TICKS); sp.stunBy = type === 'taser' ? 'taser' : 'll'; sp.ambush = false; sp.walk = null;
          log(`${nm}: ${key === 'taser' ? 'TASER — probes connected' : 'less-lethal round on target'} — suspect incapacitated. Move in for the arrest.`, 'good'); xpAct('bang', u); }
        else { log(`${nm}: ${key === 'taser' ? 'taser' : 'less-lethal round'} — no effect.`, 'alert'); aggressive(8); if (spArmed(sp) && S.rng.chance(encFireRisk(sp, it.pose))) encExchange(sp, u, 'device'); }
        return; }
      case 'bang': case 'gas': { const used = useItem(u, key, q => q.id === oid) || useItem(u, key); if (!used) { log(`${nm}: none left.`, 'alert'); return; }
        encMarkDev({ type: key });
        if (key === 'bang') { fx('flash', sp.x, sp.y, { fromX: u.x, fromY: u.y }); noise(sp.x, sp.y, 10, 'bang'); log(`${nm}: BANG OUT.`, 'radio');
          if (S.rng.chance(encOdds(sp, u, 'bang', it.pose))) { sp.stun = 5; sp.daze = FIRE_CFG.bangDaze; sp.ambush = false; log('Suspect disoriented by flashbang.', 'good'); } else log('He turned away from the flash — little effect.', 'alert'); aggressive(10); }
        else { if (sp.room >= 0) gasDeploy(sp.room); fx('gas', sp.x, sp.y, { room: sp.room, fromX: u.x, fromY: u.y }); log(`${nm}: CS gas deployed.`, 'radio'); sp.impair = Math.max(sp.impair || 0, 0.5); aggressive(12);
          if (S.rng.chance(mindOf(sp).flee * 0.6)) { encRetreat(sp, u); log('He moves away from the gas.', 'alert'); } }
        return; }
    } });
  it.done = true; it.chose = key; it.by = oid; it.res = encLogFrom(n0); S.version++; return { ok: true, res: it.res }; }
/** Back out: a move order to the nearest cell he cannot see (runs next turn). */
function encWithdraw(u, sp) { const p = findPath(u.x, u.y, (a, b) => dist(a, b, u.x, u.y) <= 8 && !los(sp.x, sp.y, a, b), {});
  u.orders = []; u.regroup = null; const end = p && p.length ? p[p.length - 1] : null;
  if (end) u.orders.push({ type: 'move', x: end[0], y: end[1], fromEnc: true }); return end; }
/* ---------- blind fire at the threshold ---------- */
function encThreshold(u, o) { if (!encOn() || S.phase !== 'executing' || !u || u.kind !== 'team') return null; const r = afterRoom(u, o); if (r < 0) return null;
  const sp = suspList().find(s => spHostile(s) && s.room === r && spArmed(s)); if (!sp) return null;
  return withSp(sp, () => { const M = mindOf(sp); const p = ENC_CFG.blind * (0.5 + M.harmOff) * (sp.stun > 0 ? 0.3 : 1) * (o.type === 'gas' ? 0.8 : 1); if (!S.rng.chance(p)) return null;
    const n0 = S.log.length, where = S.rooms[r] && S.rooms[r].known ? S.rooms[r].name : 'room'; sp.firedAt = S.turn; S.stats.shots++; sp.mode = 'alert'; sp.cd = 2;
    fx('muzzle', sp.x, sp.y, { suspect: true }); fx('shot', sp.x, sp.y, { tx: u.x, ty: u.y });
    log(`SHOTS THROUGH THE DOORWAY — ${multiSp() ? spName().toLowerCase() : 'the suspect'} is firing blindly at the threshold of the ${where}.`, 'alert');
    if (S.rng.chance(ENC_CFG.blindHit)) shotOfficer(u, SUSPECT_CAL[sp.weapon] || 'pistol', 2, sp.x, sp.y, where); else log('No hits — rounds strike the door frame.', 'alert');
    return encPause([{ kind: 'blind', sp: spIdx(sp), uid: u.uid, room: r, title: 'Shots at the threshold', text: `${u.name} is at the ${where} doorway. Blind fire from inside — he is not visible. What does the team do?`, res0: encLogFrom(n0),
      options: BLIND_OPTS.map(b => ({ key: b.key, label: b.label, hint: b.sub, who: [] })) }], false); }); }
function blindChoose0(key) { const it = encCur(), u = unit(it.uid), sp = spAt(it.sp); if (!BLIND_OPTS.some(b => b.key === key)) return { ok: false, reason: 'Unknown choice' };
  const n0 = S.log.length, r = it.room, enter = q => q.fromAfter || ((q.type === 'clear' || q.type === 'move') && (q.room === r || roomAt(q.x, q.y) === r));
  if (u && unitAlive(u)) {
    if (key === 'cancel') { u.orders = u.orders.filter(q => !enter(q)); u.orders.unshift({ type: 'hold', fromEnc: true }); u.regroup = null; log(`${u.name}: entry cancelled — holding outside the room.`, 'radio'); }
    else if (key === 'continue') { log(`${u.name}: continuing in — return fire through the doorway.`, 'radio'); encDoorFire(u, sp, 3); }
    else if (key === 'doorway') { u.orders = u.orders.filter(q => !enter(q)); u.orders.unshift(...afterOrders(u, 'assess', r)); u.regroup = null; log(`${u.name}: working the doorway from outside.`, 'radio'); }
    else { u.orders = u.orders.filter(q => !enter(q)); u.orders.unshift({ type: 'hold', fromEnc: true }); u.regroup = null; log(`${u.name}: point and defense engage from the door frame.`, 'radio'); encDoorFire(u, sp, 2); } }
  it.done = true; it.chose = key; it.res = encLogFrom(n0); S.version++; return { ok: true, res: it.res }; }
function encDoorFire(u, sp, n, win) { if (!sp) return; withSp(sp, () => { if (!hostile()) return; const vis = los(u.x, u.y, sp.x, sp.y);
  for (let k = 0; k < n && hostile(); k++) { const r = fireAt(u, sp.x, sp.y, vis ? 'fire' : 'suppress', true); if (r === 'hit') break; }
  if (hostile()) { sp.suppressed = Math.max(sp.suppressed || 0, 2); log(vis ? 'He is pinned down.' : (win ? 'Rounds through the window' : 'Rounds through the doorway') + ' — he stops firing for now.', 'radio'); } }); }
/** Close the current box and move on. Returns the phase after: 'encounter' (more) | 'executing' (mid-turn) | 'planning' | 'over'. */
/** The mission ended mid-turn (e.g. the exchange of fire decided it): still show the result box(es) before the debrief. */
function encFinal() { if (!encOn() || S.phase !== 'over' || !(S.encEv || []).length) return false; const items = encBuild().filter(i => i.kind === 'result'); S.encEv = [];
  if (!items.length) return false; S.enc = { items, i: 0, atEnd: true, final: true, turn: S.turn }; S.version++; return true; }
function encNext() { if (!S.enc) return S.phase; const it = encCur(); if (it && !it.done) return 'encounter';
  if (S.enc.final) { S.enc.i++; if (S.enc.i < S.enc.items.length) return 'encounter'; S.enc = null; S.version++; return 'over'; }
  S.enc.i++; if (S.enc.i < S.enc.items.length) { S.version++; return 'encounter'; }
  const atEnd = S.enc.atEnd; S.enc = null; S.phase = 'executing'; updateVision(); checkEnd(); if (S.phase === 'over') return 'over';
  if (atEnd) endTurn(); else if (S.tick >= TICKS && !S.encMid) { if (!encEndTurn()) endTurn(); }
  S.version++; return S.phase; }
/** Debrief lines for encounters / reviews. */
function encDebrief() { const out = []; (S.reviews || []).forEach(r => out.push({ k: 'Use-of-force review', v: `${r.name} — out for ${r.missions} missions pending investigation. Review outcome: ${r.removed ? 'removed from the team' : 'returns to duty after the review'}.` }));
  suspList().forEach(sp => { if (sp.mind) out.push({ k: multiSp() ? spName(sp) + ' — read' : 'Suspect — read', v: `${ENC_TRAITS[sp.mind.trait].label}; seen ${sp.mind.seen}×, ignored ${sp.mind.ignored} command(s).` }); });
  return out; }
/** Scoring rules on top of missionScore (encounter games). */
function encScore(items, add) { const pos = () => items.reduce((a, i) => a + (i.pts > 0 ? i.pts : 0), 0), L = suspList(), R = S.result || {};
  const dead = L.some(s => s.deceased), hurt = L.some(s => s.injured && !s.deceased);
  if (R.win && !dead && !hurt) add('Suspect in custody unharmed', ENC_CFG.unhurt);
  if (dead) { const i = items.findIndex(x => /did not survive/.test(x.label)); if (i >= 0) items.splice(i, 1); add('Suspect killed — 33% of mission points', -Math.round(pos() * (1 - ENC_CFG.killedKeep))); }
  else if (hurt) add('Suspect injured — 80% of mission points', -Math.round(pos() * (1 - ENC_CFG.minorKeep)));
  if ((S.reviews || []).length) { const net = items.reduce((a, i) => a + i.pts, 0); add('Unjustified shot — 95% reduction of mission points', -Math.round(Math.max(0, net) * (1 - ENC_CFG.unjustKeep))); } }

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
  const rm = S.rooms[roomId]; const lim = kind === 'cs40' ? CS40_CFG.range : kind === 'gas' && u.equip && u.equip.lesslethal > 0 ? 11 : 4;
  for (let yy = rm.y; yy < rm.y + rm.h; yy++) for (let xx = rm.x; xx < rm.x + rm.w; xx++) if (dist(x, y, xx, yy) <= lim && los(x, y, xx, yy)) return true;
  return false;
}
function roomTargetCell(roomId, fx_, fy) { const rm = S.rooms[roomId]; let best = null, bs = 1e9; const cx = rm.x + (rm.w - 1) / 2, cy = rm.y + (rm.h - 1) / 2;
  for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) { if (S.block[idx(x, y)]) continue; const s = dist(x, y, cx, cy); if (s < bs) { bs = s; best = [x, y]; } } return best; }

function nearestDrive(u, x, y) { let best = null, bs = 1e9; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const xx = x + dx, yy = y + dy; if (!inb(xx, yy) || !S.drive[idx(xx, yy)] || carClash(xx, yy, u.uid)) continue; const s = dx * dx + dy * dy; if (s < bs) { bs = s; best = [xx, yy]; } } return best; }
function carAdjGoal(c) { const fp = footprint(c); return (x, y) => !S.dyn[idx(x, y)] && fp.some(([fx_, fy]) => cheb(fx_, fy, x, y) <= 1); }
/** Shooting position check: in range and a line of sight to the target cell. */
function shotReq(u, sx, sy, tx, ty) {
  const wk = weaponOf(u); if (!wk) return u.kind === 'team' ? 'No READY weapon in hand — a weapon just drawn, slung or holstered is not ready until next turn' : 'This unit cannot fire'; const w = WEAPONS[wk], d = dist(sx, sy, tx, ty);
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
    case 'dracoInstall': { const c = unit(o.car); if (!c) return { ok: false, reason: 'No vehicle' }; const g = carAdjGoal(c); const p = g(sx, sy) ? [] : pathAny(g); if (!p) return { ok: false, reason: 'Cannot reach the BearCat' }; return { ok: true, path: p, end: p.length ? p[p.length - 1] : [sx, sy] }; }
    case 'dracoTip': return { ok: true, path: [], end: [sx, sy] };
    case 'draco': { const g = dracoReach(o), gg = (x, y) => g(x, y) && !carClash(x, y, u.uid); const p = gg(sx, sy) ? [] : pathAny(gg); if (!p) return { ok: false, reason: 'No drivable spot where the BearCat can point its front end square at that opening (the Draco arm is fixed — it does not swing)' }; return { ok: true, path: p, end: p.length ? p[p.length - 1] : [sx, sy] }; }
    case 'board': { const c = unit(o.car); if (!c) return { ok: false, reason: 'No cruiser' }; const g = carAdjGoal(c); const p = g(sx, sy) ? [] : pathAny(g); if (!p) return { ok: false, reason: 'Cannot reach that cruiser' }; return { ok: true, path: p, end: [c.x, c.y] }; }
    case 'exit': return { ok: true, path: [], end: [sx, sy] };
    case 'overwatch': {
      if (o.perch !== undefined && o.perch !== null) { const pc = S.perches[o.perch]; const p = (sx === pc.entry[0] && sy === pc.entry[1]) ? [] : path(pc.entry[0], pc.entry[1]);
        if (!p) return { ok: false, reason: 'No covered route to that house' }; return { ok: true, path: p, end: [pc.x, pc.y], perch: pc }; }
      if (roomAt(o.x, o.y) >= 0) return { ok: false, reason: 'Overwatch is taken outside the target house' };
      const p = path(o.x, o.y); if (!p) return { ok: false, reason: 'No route to that vantage point' };
      if (!overwatchSees(o.x, o.y)) return { ok: false, reason: 'No sight line to any window or door from there' };
      return { ok: true, path: p, end: [o.x, o.y] }; }
    case 'taser': case 'llfire': { const sp = devTarget(sx, sy); const q = withSp(sp, () => deviceShotReq(u, o.type, sx, sy)); if (q) return { ok: false, reason: q }; o.x = sp.x; o.y = sp.y; o.tgt = sp.key; o.est = deviceChance(u, o.type, dist(sx, sy, sp.x, sp.y)); return { ok: true, path: [], end: [sx, sy] }; }
    case 'shoot': { const q = shotReq(u, sx, sy, o.x, o.y); if (q) return { ok: false, reason: q }; return { ok: true, path: [], end: [sx, sy] }; }
    case 'clear': { const tc = roomTargetCell(o.room); if (!tc) return { ok: false, reason: 'Room not reachable' }; const p = path(tc[0], tc[1]);
      if (!p) return { ok: false, reason: 'No entry route — breach a door first' }; o.x = tc[0]; o.y = tc[1]; return { ok: true, path: p, end: p.length ? p[p.length - 1] : [sx, sy] }; }
    case 'detonate': { const d = S.doors[o.door]; if (!d.charge && !u.orders.some(q => q !== o && q.type === 'breach' && q.door === o.door && q.hangOnly)) return { ok: false, reason: 'No charge hung on that door' };
      const [mx, my] = doorMid(d); const warn = d.charge && dist(sx, sy, mx, my) < CHARGE_SAFE ? 'Inside the safety distance — team will be dazed' : null; return { ok: true, path: [], end: [sx, sy], warn }; }
    case 'hangwall': return hangwallPlan(u, o, sx, sy, mo);
    case 'mask': case 'land': return { ok: true, path: [], end: [sx, sy] };
    case 'breach': case 'polecam': case 'opendoor': { const d = S.doors[o.door]; const sides = doorSides(d).filter(c => cellOk(c[0], c[1], { avoidSuspect: true }) && !S.block[idx(c[0], c[1])]);
      const isGoal = (x, y) => sides.some(c => c[0] === x && c[1] === y);
      const a2 = new Set(assume); a2.delete(o.door);
      const p = isGoal(sx, sy) ? [] : findPath(sx, sy, isGoal, Object.assign({}, mo, { assume: a2 }));
      if (!p) return { ok: false, reason: 'Cannot reach that door' }; const end = p.length ? p[p.length - 1] : [sx, sy]; return { ok: true, path: p, end }; }
    case 'bang': case 'gas': case 'cs40': {
      const fn = (x, y) => roomAt(x, y) !== o.room && canThrowFrom(x, y, o.room, assume, u, o.type);
      if (canThrowFrom(sx, sy, o.room, assume, u, o.type)) return { ok: true, path: [], end: [sx, sy] };
      const p = pathAny(fn); if (!p) return { ok: false, reason: 'No opening into that room (breach a door or reach a window)' }; return { ok: true, path: p, end: p[p.length - 1] }; }
    case 'hold': return { ok: true, path: [], end: [sx, sy] };
    case 'corner': { const c = cornerAt(sx, sy, u); if (!c) return { ok: false, reason: 'No corner here — stand at a hallway corner, door frame or house corner' }; return { ok: true, path: [], end: [sx, sy], corner: { px: c.px, py: c.py, n: c.hidden.length } }; }
    case 'aid': case 'rescue': case 'evac': return planCas(u, o, sx, sy, assume);
    case 'pa': { if (!hostile()) return { ok: false, reason: 'Not needed' }; if (o.voice) { if (u.kind !== 'team') return { ok: false, reason: 'Voice call-out is for a team on foot' }; if (houseRectDist(sx, sy) > V20.voiceRange) return { ok: false, reason: `Voice only carries ~${V20.voiceRange} m — move closer to the house` }; } else if (!paInRange(sx, sy)) return { ok: false, reason: `Out of loudspeaker range — move within ~${NEGO_CFG.pa.range} m of the house` };
      if (u.orders.some(q => q !== o && q.type === 'pa')) return { ok: false, reason: 'One PA broadcast per 30 s' };
      return { ok: true, path: [], end: [sx, sy], warn: u.kind !== 'cruiser' && expoAt(sx, sy) >= 0.3 ? 'Exposed position — he may fire at the voice' : null }; }
    case 'tphone': return planTPhone(u, o, sx, sy, assume, mo);
  }
  return { ok: false, reason: 'Unknown order' };
}
/** Start cell for planning: a patrol officer sitting in a cruiser plans from the cover-side door. */
function planStart(u) { if (u.perch) return [u.x, u.y]; if (u.inCar) { const c = unit(u.inCar); const e = c && exitCell(c, 'safe'); if (e) return e; } return [u.x, u.y]; }
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
    if (o.type === 'hangwall') { const w = hangCan(u); if (w) return w; if (pending('hangwall') >= (e.charge || 0)) return 'No charges left on this team'; }
    if (o.type === 'bang' && pending('bang') >= (e.bang || 0)) return 'No flashbangs left on this team';
    if (o.type === 'gas' && pending('gas') >= (e.gas || 0)) return 'No CS gas on this team';
    if (o.type === 'cs40' && pending('cs40') >= (e.cs40 || 0)) return 'No 40mm CS ready — needs a less-lethal-qualified officer holding a 40mm launcher (single-shot or 4-shot; ready, not reloading) with 40mm CS rounds';
    if ((o.type === 'bang' || o.type === 'gas') && !taskMember(u, o.type, 2)) return 'A throw needs BOTH hands — whoever carries it holds a shield or the ram (change loadout)';
    if (DEVICE_ORDERS.includes(o.type)) { const w = deviceWhyNot(u, o.type); if (w) return w; }
    if (o.type === 'polecam' && !(e.polecam > 0)) return 'Team has no pole camera';
    if ((o.type === 'drone' || o.type === 'robot') && !(e[o.type] > 0)) return `Team carries no ${o.type}`;
    if ((o.type === 'drone' || o.type === 'robot') && !hasSpec(u, 'tech')) return 'Needs a Tech / Robot Op on the team';
    if (o.type === 'board') { const c = unit(o.car); if (!c || c.kind !== 'cruiser') return 'Tap a vehicle'; if (u.inCar) return 'Already in a vehicle'; if (c.disabled) return 'That vehicle is disabled'; if (seatsUsed(c) + seatsNeeded(u) > carSeats(c)) return `${c.name} has ${carSeats(c) - seatsUsed(c)} free seat(s) — team needs ${seatsNeeded(u)}`; }
    if (o.type === 'exit' && !u.inCar) return 'Not in a vehicle';
    if (u.inCar && !['exit', 'hold', 'move', 'pa'].includes(o.type)) return 'Get out of the vehicle first (Exit)';
    if (o.type === 'draco' && !u.inCar) return 'Draco Breach is a BearCat order — get in the BearCat first';
    if (o.type === 'dracoInstall') { const c = unit(o.car); if (!c || !c.armored) return 'Tap the BearCat'; if (c.draco) return 'The Draco arm is already installed'; if (c.disabled) return 'That vehicle is disabled';
      if (!c.dracoKit && !(S.armory.draco > 0)) return 'No Draco arm kit at the equipment vehicle (career level 60+)'; if (teamOk(u).length < DRACO_CFG.crew) return `Installing needs a team of ${DRACO_CFG.crew}+ officers`; }
    if (o.type === 'overwatch' && !hasSpec(u, 'marksman')) return 'Overwatch needs a Marksman / Sniper on the team';
    if (o.type === 'pa' && !o.voice && !bullhornUsable(u)) return 'No bullhorn on this team (cruiser PA works too)';
    if (o.type === 'tphone') { if (!(e.tphone > 0) || pending('tphone') >= e.tphone) return 'No throw-phone on this team';
      if (o.via === 'robot' && (!(e.robot > 0) || !hasSpec(u, 'tech'))) return 'Robot delivery needs a robot and a Tech on the team'; }
    if (u.carrying && !['evac', 'rescue', 'hold'].includes(o.type) && !u.orders.some(q => q.cas === u.carrying)) return 'Carrying a casualty — Evac or Rescue first';
  } else if (u.kind === 'patrol') {
    if (!['move', 'hold', 'shoot', 'board', 'exit', 'aid', 'rescue', 'evac', 'corner', 'taser'].includes(o.type)) return 'Patrol officers can Move, Hold, Fire, Taser, work a corner, get in a vehicle, or help casualties';
    if (o.type === 'taser') { const w = deviceWhyNot(u, 'taser'); if (w) return w; }
    if (o.type === 'exit' && !u.inCar) return 'Not in a vehicle';
    if (['aid', 'rescue', 'evac'].includes(o.type) && u.inCar) return 'Get out of the cruiser first';
    if (o.type === 'shoot' && u.inCar) return 'Get out of the vehicle first (Exit)';
    if (o.type === 'board') { const c = unit(o.car); if (!c || c.kind !== 'cruiser') return 'Tap a cruiser'; if (u.inCar) return 'Already in a cruiser'; if (seatsUsed(c) + 1 > carSeats(c)) return `${c.name} is full (${carSeats(c)} seats)`; if (c.disabled) return 'That cruiser is disabled'; }
  } else if (u.kind === 'cruiser') {
    if (!['move', 'exit', 'hold', 'pa', 'draco', 'dracoTip'].includes(o.type)) return 'Cruisers can Drive, Exit, Hold or use the PA';
    if (o.type === 'dracoTip') { const t = dracoTipInfo(u); if (!t.room && t.room !== 0) return t.reason; if (!((u.dracoTip || {})[o.what] > 0)) return `No ${o.what === 'bang' ? 'flashbangs' : 'CS canisters'} left in the Draco tip`; if (!u.occ.length && !u.bcDriver) return 'Nobody inside to work the arm'; }
    if (o.type === 'draco') { if (!u.draco) return u.armored ? 'Install the Draco arm first (any team at the BearCat)' : 'Only the BearCat can carry a Draco arm'; if (u.disabled) return 'Vehicle is disabled'; if (!u.occ.length) return `${u.name} is empty — get in to drive it`; const t = dracoTargetReq(o); if (t) return t; }
    if (o.type === 'pa' && !u.occ.length) return 'Nobody in the cruiser to work the PA';
    if (!u.occ.length && !u.bcDriver) return `${u.name} is empty — an officer or team must get in to drive it`;
    if (o.type === 'move' && u.disabled) return 'Cruiser is disabled';
    if (o.type === 'exit' && !u.occ.length && !u.orders.some(q => q.type === 'move')) return 'Cruiser is empty';
  }
  else if (o.type === 'land') { if (u.kind !== 'drone') return 'Only drones can land'; if (u.landed) return 'Already landed'; }
  else if (o.type === 'opendoor') { if (!u.big) return 'Only the Large Robot has an arm to open doors'; const d = S.doors[o.door]; if (!d) return 'Tap a door'; if (d.state !== 'closed') return 'That door is already open'; }
  else if (!['move', 'hold'].includes(o.type)) return 'Devices can only Move' + (u.kind === 'drone' ? ' or Land' : u.big ? ' or Open Door' : '');
  return null;
}
function queueOrder(uid, o) {
  if (S.phase !== 'planning') return { ok: false, reason: 'Wait for the orders to resolve' };
  const u = unit(uid); if (!u || !unitAlive(u)) return { ok: false, reason: 'Unit unavailable' };
  if (o.type === 'overwatch' && (o.perch === undefined || o.perch === null)) { const pc = perchAt(o.x, o.y); o.perch = pc ? pc.id : null; if (!pc && S.block[idx(o.x, o.y)]) return { ok: false, reason: 'No usable vantage point in that building' }; }
  if (o.type === 'drive') { if (!u.inCar) return { ok: false, reason: 'Not in a vehicle — Get In first' }; const c = unit(u.inCar); if (!c) return { ok: false, reason: 'No vehicle' }; // v8: drive through the occupant's own chip
    const r = queueOrder(c.uid, { type: 'move', x: o.x, y: o.y }); if (r.ok) { o.x = r.at[0]; o.y = r.at[1]; } return Object.assign({ car: c.uid }, r); }
  if ((o.type === 'pa' || o.type === 'draco' || o.type === 'dracoTip') && u.inCar) return queueOrder(u.inCar, o); // vehicle PA / Draco arm, worked by whoever is inside // vehicle PA, worked by whoever is inside
  const req = orderReq(u, o); if (req) return { ok: false, reason: req };
  if (o.type === 'move' && u.kind === 'cruiser') { const nd = nearestDrive(u, o.x, o.y); if (!nd) return { ok: false, reason: 'Cruiser cannot park there (needs open road, driveway or lawn)' }; o.x = nd[0]; o.y = nd[1]; }
  if (o.type === 'move' && (u.kind === 'patrol' || u.kind === 'team')) { o.req = [o.x, o.y]; o.snapped = false; // v8: move ANYWHERE — no snapping; just flag exposure
    const ci = coverInfo(o.x, o.y); o.cover = ci.level === 'inside' ? 'inside' : ci.level === 'open' ? 'open' : ci.q; o.exposed = roomAt(o.x, o.y) < 0 && ci.level === 'open' && ci.expo >= COVER_CFG.exposedAt; }
  const last = u.orders[u.orders.length - 1];
  const replacing = last && last.type === 'move' && o.type === 'move' && !o.wp; /* v22: waypoint legs append */
  const prev = planFor(u); let [sx, sy] = planStart(u);
  const upto = replacing ? prev.length - 1 : prev.length;
  for (let i = 0; i < upto; i++) if (prev[i].ok) { sx = prev[i].end[0]; sy = prev[i].end[1]; }
  const assume = plannedBreaches(); if (o.type === 'breach') assume.delete(o.door);
  const r = planOrder(u, o, sx, sy, assume); if (!r.ok) return r;
  if (o.type === 'draco') { o.x = r.end[0]; o.y = r.end[1]; const f = dracoSpotAt(o, o.x, o.y); o.dir = f ? f.dir : null; }
  if (o.type === 'hold') u.orders = u.orders.filter(q => q.type !== 'hold');
  if (o.type === 'overwatch') u.orders = u.orders.filter(q => q.type !== 'overwatch');
  if (o.type === 'shoot') { u.orders = u.orders.filter(q => q.type !== 'shoot'); o.est = hitChance(u, o.x, o.y, [sx, sy]).p; }
  if (replacing) u.orders[u.orders.length - 1] = o; else u.orders.push(o);
  if (o.type === 'move' && r.path) o.routeExposed = r.path.some(([px, py]) => roomAt(px, py) < 0 && expoAt(px, py) >= 0.6);
  if (o.type === 'move' && o.cover === 'open') log(o.exposed ? `⚠ ${u.name}: no cover at that spot — EXPOSED to the house (allowed)` : `${u.name}: no cover at that spot, but out of his line of fire`);
  S.version++; return { ok: true, snapped: o.snapped, est: o.est, at: [o.x, o.y], exposed: !!o.exposed, routeExposed: !!o.routeExposed };
}
/** Orders that END exposed (or cross an exposed stretch) — shown on the preview and beside EXECUTE. Moves are still allowed. */
function exposedOrders() { const out = []; for (const u of S.units) { if (!unitAlive(u) || u.kind === 'cruiser') continue; for (const o of u.orders) if (o.type === 'move' && (o.exposed || o.routeExposed)) out.push({ uid: u.uid, name: u.name, end: !!o.exposed, route: !!o.routeExposed }); } return out; }
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
  if (u.kind === 'team') { const tw = teamWeapon(u); if (tw && tw.oh) { p *= add('grip', ITEM_CFG.rifle.oneHandMul, 'rifle fired one-handed'); notes.push('one-handed'); } }
  p *= add('range', 1 - 0.55 * d / w.range, Math.round(d) + ' m of ' + w.range);
  const sp = suspectFor(tx, ty), inside = roomAt(tx, ty) >= 0, atWin = winCellSet().has(idx(tx, ty));
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
  partner:   { name: 'Partner Interview', desc: 'His partner is at the perimeter with patrol: full layout, his weapons, history, and likely his number.', only: 'domestic', avail: () => S.intel.partner ? 'Already done' : true },
  emseval:   { name: 'EMS Evaluation', desc: 'Stage paramedics and the county crisis team at the EMS point for a mental-health evaluation once he is out. Instant.', only: 'mental', instant: true, avail: () => S.intel.emsEval ? 'Already arranged' : !S.ems ? 'Set an EMS point first' : true },
  family:    { name: 'Family Interview', desc: 'His sister has reached the command post: likely his number and how he reacts under pressure.', not: ['drughouse', 'inmates'], avail: () => S.vacant ? 'No family — vacant house' : S.intel.family ? 'Already done' : S.turn < NEGO_CFG.familyTurn ? `Family arrive at ${elapsedAt(NEGO_CFG.familyTurn)}` : true },
  inmfamily: { name: 'Family Interview (homeowner)', desc: 'The family who fled is at the perimeter with patrol: full layout, the guns kept in the house, and the exact count.', only: 'inmates', avail: () => S.inmFamily && S.inmFamily.done ? 'Already done' : true },
  power:     { name: 'Cut Power', desc: 'Utility crew cuts power to the house: the security cameras go dark. They will notice (agitation up).', only: 'drughouse', avail: () => !S.power ? 'No cameras' : S.power.cut ? 'Power already cut' : S.turn < DRUG_CFG.powerFrom ? `Utility crew arrives at ${elapsedAt(DRUG_CFG.powerFrom)}` : true },
  lrobot:    { name: 'Deploy Large Robot', desc: 'EOD-style tracked robot with an arm, driven from primary staging by a free SWAT officer (Tech preferred). The operator is tied up while driving. It can try door handles: unlocked doors open, locked or barricaded doors do not. Instant.', instant: true, avail: () => bigRobotWhyNot() || true },
  evacB:     { name: 'Evacuate Unit B', desc: 'Patrol walks the residents of the other unit of the duplex out through the far door (about 1 min). Do it before a long standoff.', when: () => !!S.duplex, avail: () => !S.duplex ? 'Not a duplex' : S.duplex.evac === 'empty' ? 'Unit B is empty' : S.duplex.evac === 'moving' ? 'Evacuation under way' : S.duplex.evac === 'done' ? 'Already evacuated' : true },
};
/** Is a command offered on this call (call type / structure)? */
function cmdShown(key) { const c = COMMANDS[key], k = S.stype && S.stype.key; if (!c) return false; if (c.only && k !== c.only) return false; if (c.not && c.not.includes(k)) return false; if (c.when && !c.when()) return false; return true; }
function setCommand(key) { if (S.phase !== 'planning') return { ok: false, reason: 'Busy' }; if (key === null) { S.cmd = null; S.version++; return { ok: true }; }
  if (!COMMANDS[key]) return { ok: false, reason: 'Unknown command' }; if (!cmdShown(key)) return { ok: false, reason: 'Not available on this call' };
  const a = COMMANDS[key].avail(); if (a !== true) return { ok: false, reason: a }; if (COMMANDS[key].instant) { runCommand(key); S.version++; return { ok: true, instant: true }; } S.cmd = key; S.version++; return { ok: true }; }
function runCommand(key) {
  const sp = S.suspect, r = S.rng;
  switch (key) {
    case 'inmfamily': case 'power': case 'evacB': runCommand3(key); break;
    case 'lrobot': deployBigRobot(); break;
    case 'interview': { S.intel.interview = true; S.intel.floors = true; S.intel.threat = 1; S.intel.weapon = true;
      S.rooms.filter(q => ['living', 'kitchen', 'dining', 'garage'].includes(q.type)).forEach(q => q.known = true);
      const srm = S.rooms[sp.room]; const side = (srm.y + srm.h / 2 < S.house.oy + S.house.H / 2 ? 'back' : 'front') + (srm.x + srm.w / 2 < (S.house.x0 + S.house.x1) / 2 ? '-left' : '-right');
      if (S.vacant) log(`Neighbor: "Nobody lives there — it's been empty since spring. ${ownRooms().filter(q => q.type === 'bed').length} bedrooms. He went in the back. I think he had a gun."`, 'intel');
      else if (S.stype && S.stype.key === 'neighbor') log(`Neighbor: "He pointed a ${SUSPECT_WEAPONS[sp.weapon].name} at me over the fence on the ${S.stype.side} side. He's furious with me — keep people away from my side. I saw him at a ${side} window."`, 'intel');
      else log(`Neighbor: "It's a single-storey ${S.house.archName.split(' ·')[0].toLowerCase()}, ${ownRooms().filter(q => q.type === 'bed').length} bedrooms. He has a ${SUSPECT_WEAPONS[sp.weapon].name} — I saw him at a ${side} window."`, 'intel');
      if (S.duplex) log(`Neighbor: "It's a duplex — the other side is a separate unit. ${S.duplex.residents ? (S.duplex.residents === 1 ? 'One person lives' : S.duplex.residents + ' people live') + ' over there, I think they are home.' : 'I think that side is empty right now.'}"`, 'intel');
      if (r.chance(NEGO_CFG.number.interview)) learnNumber('neighbor'); break; }
    case 'blueprint': S.intel.blueprint = S.turn + 2; log('Records desk: blueprints requested, ETA 1 min.', 'intel'); break;
    case 'flyby': { S.intel.flybyReady = S.turn + 3; S.rooms.forEach(q => { if (S.windows.some(w => w.room === q.id)) q.known = true; });
      const hs = multiSp() ? suspList().filter(spActive) : [sp]; hs.forEach(s => { s.heat = { room: s.room, x: s.x, y: s.y, turn: S.turn }; }); S.intel.threat = Math.max(S.intel.threat, 1); S.intel.located = true;
      const hr = [...new Set(hs.map(s => S.rooms[s.room] ? 'the ' + S.rooms[s.room].name : 'near the house'))];
      if (hs.length > 1) log(`Drone flyby: heat signatures — ${hr.join(', ')}. Thermal cannot give a reliable head count. Window rooms mapped.`, 'intel'); else
      log(`Drone flyby: thermal signature ${S.rooms[sp.room] ? 'in the ' + S.rooms[sp.room].name : 'near the house'}. Window rooms mapped.`, 'intel'); fx('flyby', S.house.x0, S.house.y0); break; }
    case 'partner': { S.intel.partner = true; S.intel.floors = true; S.intel.threat = Math.max(S.intel.threat, 1); S.rooms.forEach(q => q.known = true); const T = NEGO_CFG.temper[S.nego.temper]; S.nego.read = T.hint;
      const srm = S.rooms[sp.room], v = S.stype && S.stype.variant; if (v === 'firearm') S.intel.weapon = true;
      log(`Partner: "I know every room — ${ownRooms().length} rooms. He usually goes to the ${srm.name} when he's like this. ${v === 'firearm' ? `He has a ${SUSPECT_WEAPONS[sp.weapon].name}; he keeps it loaded.` : 'He grabbed a knife; he used to have a gun but I don\u2019t know where it is.'}"`, 'intel');
      log(`Partner (history): "${T.hint} Police have been here twice before."`, 'intel');
      if (r.chance(0.9)) learnNumber('partner'); break; }
    case 'emseval': S.intel.emsEval = true; log('EMS: paramedics and the county crisis team are staged at the EMS point for an evaluation once he is out.', 'good'); break;
    case 'call911': review911(); break;
    case 'status': statusCheck(); break;
    case 'family': { S.intel.family = true; const T = NEGO_CFG.temper[S.nego.temper]; S.nego.read = T.hint; log(`Family interview: "${T.hint}"`, 'intel');
      if (r.chance(NEGO_CFG.number.family)) learnNumber('family'); else log('Family interview: his sister does not have his current number.', 'intel'); break; }
  }
}
function surrender(msg) { const sp = S.suspect; sp.mode = 'surrendered'; sp.stun = 0; log(msg, 'good');
  S.doors.forEach(d => { if (d.rooms.includes(sp.room)) { d.barricaded = false; d.locked = false; } if (d.name === 'Front Door') d.locked = false; }); log(multiSp() ? `${spName()} is giving up. Doors unlocked — move in and secure ${spName()}.` : 'He has pulled the barricade. Doors unlocked — move in and secure him.', 'good'); }
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
  if (o.type === 'hangwall') return hangwallTick(u, o, speed);
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
      if (!q) { failOrders(u, 'no 40mm CS round ready (a 40mm launcher in hand, loaded, not reloading)'); return; }
      const iv = invOf(q); iv.vest.cs40 = Math.max(0, (iv.vest.cs40 || 0) - 1); llShot(q); syncEquip(u); popOrder(u); S.stats.cs40 = (S.stats.cs40 || 0) + 1;
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
  const l = losEx(px, py, u.x, u.y, true), cv = l.cov - (u.installing ? 1 : 0); // busy installing the Draco arm: working in the open, one cover step worse
  return cv >= 2 ? 'covered' : cv === 1 ? 'concealed' : 'open';
}
const T_PRIO = { slice: 1.2, open: 3, car: 2, concealed: 1.3, covered: 1, perched: 0.6 };
const T_TRY = { slice: 0.85 * 0.6, open: 0.85, car: 0.6, concealed: 0.3, covered: 0.25, perched: 0.15 }; // concealment: he can barely see you, so he fires less
/* v8: per-opportunity chance he pulls the trigger. Out of the house (window / doorway at someone outside) it is low;
   at a team inside the house with him it is high. Flashbang daze and CS gas cut both the chance and his accuracy. */
const FIRE_CFG = { outside: 0.40, indoor: 0.80, indoorAmbush: 0.92, bangDaze: 24, bangMul: 0.45, gasCut: 0.65, accBang: 0.55, accGas: 0.6 };
/** Multiplier (0..1) on his fire chance from flashbang daze (ticks left) and gas impairment (coughing, eyes streaming). */
function fireImpair() { const sp = S.suspect; return (sp.daze > 0 ? FIRE_CFG.bangMul : 1) * (1 - FIRE_CFG.gasCut * clamp(sp.impair || 0, 0, 1)); }
function accImpair() { const sp = S.suspect; return (sp.daze > 0 ? FIRE_CFG.accBang : 1) * (1 - FIRE_CFG.accGas * clamp(sp.impair || 0, 0, 1)); }
/* v9 shootout: one PRIMARY target per turn (the nearest officer he can see); other members of that team take rounds only after
   the primary goes down (spillover chance per round, capped). The nearest officers with a clear line and a READY weapon fire back:
   at most MAX_RETURN_FIRE of them. */
const SHOOT_CFG = { maxReturn: 3, spill: 0.3, spillMax: 2, droneDist: 6, repoDist: 0.35 };
const MAX_RETURN_FIRE = SHOOT_CFG.maxReturn;
function primaryOf() { const sp = S.suspect; return sp.tgt && sp.tgt.turn === S.turn ? sp.tgt : null; }
/** Is the primary officer of this turn still standing? */
function primaryUp(tg) { const T = unit(tg.uid); if (!T || !unitAlive(T)) return false; if (T.kind !== 'team' || !tg.off) return true; return teamOk(T).some(o => o.id === tg.off); }
const T_HIT = { slice: 0.4, open: 1, concealed: 0.85, covered: 0.2, perched: 0.12 }; // …but rounds go through a hedge; hard cover stops them
function suspectTick21() {
  const sp = S.suspect; if (!suspectActive()) return;
  if (sp.daze > 0) sp.daze--;
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
  const spots = [[sp.x, sp.y]].concat(sp.room >= 0 && !(((sp.disp === 'hiding' && sp.agit < 75) || behNoWin(sp)) && !sp.atWindow) ? suspectWindowCells().filter(([x, y]) => !suspList().some(o => o !== sp && spActive(o) && o.x === x && o.y === y)) : []);
  let best = null;
  const tg = primaryOf(); let pool = shooters();
  if (tg) { const T = unit(tg.uid); const up = primaryUp(tg); pool = pool.filter(u => u.uid === tg.uid && (up || (u.kind === 'team' && (tg.spill || 0) < SHOOT_CFG.spillMax))); } // no retarget until next turn
  for (const u of pool) { for (const [px, py] of spots) { const d = dist(px, py, u.x, u.y); if (d > R) continue; const l = los(px, py, u.x, u.y) || (sliceExposed(u, px, py) ? 1 : 0); if (!l) continue; // a pie-slicing officer is partly exposed where his slice reaches
      const cls = targetClass(u, px, py); const indoorTeam = u.kind === 'team' && roomAt(u.x, u.y) >= 0;
      const s = -d - (px !== sp.x || py !== sp.y ? SHOOT_CFG.repoDist : 0) - (u.kind === 'drone' || u.kind === 'robot' ? SHOOT_CFG.droneDist : 0) + T_PRIO[cls] * 0.01 + (indoorTeam ? 0.01 : 0); // nearest officer he can see
      if (!best || s > best.s) best = { u, px, py, d, l, cls, s }; } }
  if (!best) { if (sp.mode === 'alert' && !sp.atWindow && S.rng.chance(0.15) && spots.length > 1) { /* peeks */ } return; }
  if (best.px !== sp.x || best.py !== sp.y) { // reposition toward the window first
    const p = findPath(sp.x, sp.y, (x, y) => x === best.px && y === best.py, { suspect: true }); if (p && p.length) { sp.x = p[0][0]; sp.y = p[0][1]; sp.atWindow = winCellSet().has(idx(sp.x, sp.y)); } return; }
  if (sp.cd > 0) return;
  const indoor = (best.u.kind === 'team' || best.u.kind === 'robot') && roomAt(best.u.x, best.u.y) >= 0;
  let tryP = indoor ? (sp.ambush ? FIRE_CFG.indoorAmbush : FIRE_CFG.indoor)
    : FIRE_CFG.outside * (T_TRY[best.cls] / T_TRY.open) * (0.75 + sp.agit / 200) * (sp.ambush ? 1.3 : 1) * (contactLive() && !sp.ambush ? NEGO_CFG.talkingFire : 1);
  tryP *= fireImpair() * typeFireMul(best.u) * (sp.disp === 'hiding' ? MULTI_CFG.hideFire : sp.disp === 'fighting' ? MULTI_CFG.fightFire : 1); best.indoor = indoor;
  if (!S.rng.chance(clamp(tryP, 0, 0.95))) return;
  suspectFire(best);
}
function suspectFireBase(b) {
  const sp = S.suspect, T = b.u, sw = SUSPECT_WEAPONS[sp.weapon]; if (sp.mode === 'barricaded') sp.mode = 'alert';
  if (!primaryOf() && T.kind !== 'team' && T.kind !== 'patrol') sp.tgt = { uid: T.uid, off: null, turn: S.turn, spill: 0 };
  sp.dir = Math.atan2(T.y - sp.y, T.x - sp.x); S.stats.shots++; sp.firedAt = S.turn; sp.firedTick = S.turn * 100 + (S.tick || 0); sp.armedKnown = true; sp.cd = 2 + S.rng.int(0, 1);
  fx('muzzle', sp.x, sp.y, { suspect: true }); fx('shot', sp.x, sp.y, { tx: T.x, ty: T.y });
  sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn }; S.intel.located = true; S.intel.threat = 1;
  const where = sp.room >= 0 ? (sp.atWindow ? `${S.rooms[sp.room].name} window` : S.rooms[sp.room].name) : 'yard';
  let p = sw.base * (1 - 0.6 * b.d / sw.range) * (b.l === 2 ? 0.85 : 1) * (sp.ambush ? 1.3 : 1) * accImpair() * (b.u.impair ? 1.15 : 1) * autoAcc(sp.weapon, b.d);
  if (T.kind === 'cruiser' && T.armored) { T.hits++; fx('impact', T.x, T.y, { car: T.uid }); log(`SHOTS FIRED from the ${where} — rounds stop against the armored ${T.name}. Crew unhurt.`, 'alert'); returnFire(); return; }
  if (T.kind === 'cruiser') { // through the car body — windshield is the weak spot
    const v = Math.atan2(sp.y - T.y, sp.x - T.x), c = Math.abs(Math.cos(v - T.dir)), glass = c > 0.7;
    p *= (glass ? 0.55 : 0.3) * (T.moved === S.tick ? 0.75 : 1); p = clamp(p, 0.02, 0.45);
    T.hits++; T.marks.push({ dx: S.rng() * 2 - 1, dy: S.rng() * 0.6 - 0.3, t: S.turn }); fx('impact', T.x, T.y, { car: T.uid });
    const hitIn = S.rng.chance(p) && T.occ.length;
    const cal = SUSPECT_CAL[sp.weapon] || 'pistol';
    if (hitIn && unit(T.occ[0]).kind === 'team') { const tm = unit(T.occ[0]); const a = shotOfficer(tm, cal, b.d, undefined, undefined, where, { noShield: true }); if (a && a.res !== 'pen' && a.res !== 'blunt') { returnFire(); return; } T.orders = []; if (tm.status !== 'ok') { T.occ.shift(); tm.inCar = null; } }
    else if (hitIn && armorHit(unit(T.occ[0]), null, cal, b.d).res !== 'pen') { S.stats.armorStops = (S.stats.armorStops || 0) + 1; log(`SHOTS FIRED from the ${where} — a round through ${T.name}'s door hits ${unit(T.occ[0]).name} in the vest. The IIIA armor stopped it — unhurt.`, 'alert'); }
    else if (hitIn) { const drv = unit(T.occ[0]); T.occ.shift(); drv.inCar = null; const ec = exitCell(T, 'safe') || [T.x, T.y]; drv.x = ec[0]; drv.y = ec[1]; officerDown(drv, `${T.name} driver down — ${drv.name} hit through the ${glass ? 'windshield' : 'door'}.`); T.orders = []; }
    else log(`SHOTS FIRED from the ${where} — rounds strike ${T.name}${glass ? ' (windshield)' : ''}. Crew unhurt.`, 'alert');
    returnFire(); return;
  }
  if (T.kind === 'drone' || T.kind === 'robot') { if (S.rng.chance(deviceHitP(T, p))) { T.status = 'down'; T.orders = []; log(`Shots fired — ${T.name} disabled.`, 'bad'); } else log(`Shots fired at ${T.name} — missed.`, 'alert'); return; }
  let tg = primaryOf(), victim = null, spillShot = false;
  if (!tg) { const off = T.kind === 'team' ? pickVictim(T, sp.x, sp.y) : null; tg = sp.tgt = { uid: T.uid, off: off ? off.id : null, turn: S.turn, spill: 0 };
    log(`Suspect opens fire at ${off ? off.name + ' (' + T.name + ')' : T.name}.`, 'alert'); }
  if (T.kind === 'team' && los(sp.x, sp.y, T.x, T.y) === 1) encNoteFire(T, where);
  if (T.kind === 'team') { const m = teamOk(T); victim = m.find(o => o.id === tg.off) || null;
    if (!victim) { spillShot = true; tg.spill = (tg.spill || 0) + 1; const pool2 = doorExposed(T, sp.x, sp.y) || m; victim = pool2.length && S.rng.chance(SHOOT_CFG.spill) ? S.rng.pick(pool2) : null; } }
  p *= b.cls === 'slice' ? sliceHit(T) : T_HIT[b.cls] || 1; if (T.moved === S.tick) p *= 0.8;
  if (spillShot && !victim) p = 0;
  if (T.kind === 'team') { p *= 1 - teamSkill(T) * 0.25; if (T.carrying && hasShield(T)) p *= CAS_CFG.carryShield; if (hasSpec(T, 'point')) p *= 1 - 0.05 * teamSpecMul(T, 'point'); }
  p = clamp(p, 0.01, 0.55);
  if (S.rng.chance(p)) { const a = shotOfficer(T, SUSPECT_CAL[sp.weapon] || 'pistol', b.d, sp.x, sp.y, where, victim ? { victim } : null); if (a && a.res !== 'pen' && onFoot(T) && roomAt(T.x, T.y) < 0 && !T.perch && expoAt(T.x, T.y) >= 0.15) seekCover(T, 'under fire'); }
  else { log(`SHOTS FIRED from the ${where} at ${T.name} (${b.cls === 'perched' ? 'on overwatch' : b.cls === 'open' ? 'in the open' : b.cls + ' cover'}) — no hits.`, 'alert');
    if (onFoot(T) && roomAt(T.x, T.y) < 0 && !T.perch && expoAt(T.x, T.y) >= 0.15) { if (T.kind === 'patrol') T.panic += 0.2; seekCover(T, 'under fire'); } }
  if (S.rng.chance(0.45)) sp.duck = 1;
  returnFire();
}
/** READY weapon an individual officer has in hand (team member) — null if none / not ready. */
function memberWeapon(o) { for (const k of heldList(o)) { if (!WEAPONS[k] || !(ITEM_CFG[k] || {}).weapon || !isReady(o, k)) continue; if (k === 'sniper' && !twoHanded(o, k)) continue; return k; } return null; }
/** Officers who would return fire: nearest first, clear line, ready weapon in range, not holding fire / busy / dazed. At most MAX_RETURN_FIRE. */
function returnFirers() { const sp = S.suspect, c = [];
  for (const u of S.units) { if (!unitAlive(u) || !onFoot(u) || u.stance === 'hold' || u.installing || u.stun > 0) continue; if (u.orders[0] && u.orders[0].type === 'shoot') continue;
    const d = dist(u.x, u.y, sp.x, sp.y); if (los(u.x, u.y, sp.x, sp.y) !== 1) continue;
    if (u.kind === 'patrol') { const wk = u.weapon; if (wk && WEAPONS[wk] && d <= WEAPONS[wk].range) c.push({ u, o: u, name: u.name, d, i: 0 }); continue; }
    if (u.kind === 'team') teamOk(u).forEach((o, i) => { const wk = memberWeapon(o); if (wk && d <= WEAPONS[wk].range) c.push({ u, o, name: o.name, d, i }); }); }
  return c.sort((a, b) => a.d - b.d || a.i - b.i).slice(0, SHOOT_CFG.maxReturn); }
/** The nearest officers with a sight line shoot back at the muzzle flash (max 3); the log lists who fired and the result. */
function returnFire() {
  const sp = S.suspect; if (!hostile() || S.encNoRet) return; const who = returnFirers(); if (!who.length) return; let res = 'no hits';
  for (const f of who) { if (!hostile()) break; const r = fireAt(f.u, sp.x, sp.y, 'fire', true); if (r === 'hit') { res = `${f.name} hit ${multiSp() ? spName().toLowerCase() : 'the suspect'}`; break; } if (r === 'stopped') res = `${f.name}'s round was stopped by body armor`; }
  S.stats.returnVolleys = (S.stats.returnVolleys || 0) + 1; S.lastReturn = who.map(f => f.o.id || f.u.uid);
  log(`Return fire: ${who.map(f => f.name).join(', ')} — ${res}.`, 'radio'); if (who.length >= 2 && hostile()) sp.suppressed = Math.max(sp.suppressed, 1);
}
/** One officer volley at a cell. Returns 'hit' | 'miss' | 'empty'. */
function fireAtBase(u, tx, ty, mode, isReturn) { return withSp(suspectFor(tx, ty, u.x, u.y), () => fireAt1(u, tx, ty, mode, isReturn)); }
function fireAt1(u, tx, ty, mode, isReturn) {
  const sp = S.suspect; fx('muzzle', u.x, u.y, { friendly: true }); fx('shot', u.x, u.y, { tx, ty, friendly: true }); S.stats.ofShots = (S.stats.ofShots || 0) + 1;
  faceTo(u, tx, ty); if (!isReturn) aggressive(mode === 'suppress' ? 3 : 5); noise(tx, ty, 8, 'shot');
  if (!hostile()) return 'empty';
  const near = (sp.room >= 0 && roomAt(tx, ty) === sp.room) || dist(sp.x, sp.y, tx, ty) <= 1.5;
  if (!near || !los(u.x, u.y, sp.x, sp.y)) { if (!isReturn) log(`${u.name}: ${mode === 'suppress' ? 'suppressing fire' : 'rounds'} on target — no contact.`); return 'empty'; }
  let p = hitChance(u, sp.x, sp.y, null, { flash: isReturn }).p; if (mode === 'suppress') { p *= 0.5; sp.suppressed = Math.max(sp.suppressed, 2); }
  if (S.rng.chance(p)) return suspectHit(u) === false ? 'stopped' : 'hit';
  if (!isReturn) log(`${u.name}: ${mode === 'suppress' ? 'suppressing fire — suspect pinned down' : 'shot missed'}.`, 'radio');
  return 'miss';
}
function suspectHit(u) { const sp = S.suspect;
  if (suspectArmorStops(weaponOf(u) || 'pistol')) { fx('text', sp.x, sp.y, { text: 'ARMOR', color: '#ffd080' }); S.stats.susArmorStops = (S.stats.susArmorStops || 0) + 1;
    log(`${u.name}: hit on the suspect's torso.`, 'radio'); revealSuspectArmor('stop'); sp.duck = Math.max(sp.duck || 0, 1); aggressive(3); return false; }
  sp.stun = 0; sp.downBy = 'fire'; fx('hitflash', sp.x, sp.y);
  const key = sp.key || 'S', prev = S.cas.find(c => c.who === 'suspect' && casActive(c) && (c.ref || 'S') === key);
  const c = prev ? (prev.state = 'immobile', prev.crit = Math.min(prev.crit, S.rng.int(2, 4)), prev) : addCasualty('suspect', key, spName(), sp.x, sp.y, { kia: CAS_CFG.suspectKia, mobile: CAS_CFG.suspectMobile, by: u.uid });
  c.x = sp.x; c.y = sp.y; c.seen = true; c.known = true;
  if (c.state === 'mobile') { sp.impair = Math.max(sp.impair || 0, 0.45); sp.duck = 2; sp.injured = true; sp.injuryText = injWhere(sp, 'mobile'); aggressive(6);
    fx('text', sp.x, sp.y, { text: 'SUSPECT HIT', color: '#ffb020' }); log(`${u.name}: ${multiSp() ? spName().toLowerCase() : 'suspect'} HIT — still moving and still armed. Injured (${sp.injuryText}).`, 'alert'); return; }
  sp.mode = 'incapacitated'; sp.walk = null; S.stats.method = 'Officer fire'; sp.method = sp.method || 'Officer fire'; sp.injured = true; sp.injuryText = injWhere(sp, c.state);
  if (c.state === 'kia') { sp.deceased = true; fx('text', sp.x, sp.y, { text: 'SUSPECT DOWN', color: '#c9ced6' }); log(`${u.name}: ${multiSp() ? spName().toLowerCase() : 'suspect'} hit — not moving. Move in and secure the scene.`, 'good'); return; }
  fx('text', sp.x, sp.y, { text: 'SUSPECT DOWN', color: '#ffb020' }); log(`${u.name}: ${multiSp() ? spName().toLowerCase() : 'suspect'} HIT — immobile, weapon out of reach. Move in, secure ${multiSp() ? 'the suspect' : 'him'}, get EMS.`, 'good'); }
/** Stance 'free': fire at a visible suspect every 3rd tick. */
function officersFire() { if (S.tick % 3 !== 0) return; const done = new Set(); // each officer engages the nearest visible hostile suspect; a suspect hit this tick is not engaged again
  for (const u of S.units) { if (!onFoot(u) || u.stance !== 'free' || u.installing || (u.orders[0] && u.orders[0].type === 'shoot')) continue; const wk = weaponOf(u); if (!wk) continue;
    const c = suspList().filter(sp => !done.has(sp) && spHostile(sp) && sp.visible && dist(u.x, u.y, sp.x, sp.y) <= WEAPONS[wk].range && los(u.x, u.y, sp.x, sp.y)).sort((a, b) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y));
    if (!c.length) continue; const sp = c[0]; if (fireAt(u, sp.x, sp.y, 'fire') === 'hit') { done.add(sp); if (!suspList().some(s => !done.has(s) && spHostile(s))) return; } }
}
/** An officer is hit: becomes a casualty (KIA / injured-mobile / immobile). stats.down counts officers out of the fight unless a medic stabilised them on the spot. */
function bluntMsg(nm, ctx, c, cal) { return `${nm} (${ctx}) hit in the vest at close range — the armor stopped the ${cal === 'shotgun' ? 'shotgun load' : 'round'}, but the impact causes a minor blunt-trauma injury. Mobile, leaving the line for EMS.`; }
function officerDownBase(u, msg, ctx) {
  fx('down', u.x, u.y);
  const minor = !!(ctx && ctx.minor), mo = minor ? { minor: true } : {};
  if (u.kind === 'patrol') { u.status = 'down'; u.orders = []; u.carrying && dropCas(u, casById(u.carrying)); u.inCar = null; if (!minor) S.stats.down++;
    const c = addCasualty('patrol', u.uid, u.name, u.x, u.y, mo); u.cas = c.id; S.downList.push({ x: c.x, y: c.y, name: u.name, cas: c.id });
    log(minor ? bluntMsg(u.name, 'patrol', c, ctx.cal) : msg ? `${msg} ${casTail(c)}` : `OFFICER DOWN — ${casReport(c, 'patrol')}`, minor ? 'alert' : 'bad'); return c; }
  const ok = teamOk(u); if (!ok.length) return; const prio = ctx && ctx.victim && ok.includes(ctx.victim) ? ctx.victim : ok.find(o => o.spec === 'point') || S.rng.pick(ok);
  prio.status = 'down';
  const c = addCasualty('officer', prio.id, prio.name, u.x, u.y, Object.assign({ team: u.uid, witness: true }, mo)); prio.cas = c.id;
  if (u.carrying) dropCas(u, casById(u.carrying));
  const med = teamOk(u).length && hasSpec(u, 'medic');
  if (med && casActive(c)) applyAid(u, c, true);
  if (minor) log(bluntMsg(prio.name, u.name, c, ctx.cal), 'alert');
  else if (c.stable) { prio.stable = true; log(`OFFICER DOWN — ${prio.name} (${u.name}) hit. Medic stabilised on the spot — needs extraction.`, 'bad'); }
  else { S.stats.down++; log(`OFFICER DOWN — ${casReport(c, u.name)}`, 'bad'); }
  S.downList.push({ x: c.x, y: c.y, name: prio.name, cas: c.id });
  if (!teamOk(u).length) { u.status = 'down'; u.orders = []; log(`${u.name} is out of action.`, 'bad'); }
  return c;
}
/* v9 devices on the suspect: TASER (any officer, one hand, ~3 m) and the 40mm LESS-LETHAL launcher (qualified officer, two hands).
   Both are ordered on a visible suspect in range. The officer doing it AUTO-TRANSITIONS: whatever weapon is in the hands is
   holstered / slung (free, but NOT READY for one full turn), the device is drawn and used at once, then put back and the
   previous weapon redrawn automatically (auto-redraw rules, d1_inventory). A shield (or the ram) is never dropped and cannot be
   slung: the taser goes in the free hand next to it; the two-handed launcher is refused for a shield holder. */
const TASER_CFG = { range: 3, p: 0.8, perCell: 0.12, min: 0.2, armorMul: 0.6, stunTurns: 2, hands: 1 };
const LL_CFG = { range: 11, p: 0.85, perCell: 0.035, min: 0.3, ambushMul: 0.6, noEffect: 0.2, stunTurns: [2, 3], hands: 2 };
const DEVICE_ORDERS = ['taser', 'llfire'];
function devCfg(type) { return type === 'taser' ? TASER_CFG : LL_CFG; }
/** Officer who would fire the device for unit u (team: a member; patrol: the officer himself). null = nobody can. */
function deviceUser(u, type) {
  if (u.kind === 'patrol') return type === 'taser' ? u : null;
  if (u.kind !== 'team') return null;
  if (type === 'taser') { const m = teamOk(u), pt = m[0]; return m.filter(o => carries(o, 'taser') && freeable(o) >= TASER_CFG.hands)
    .sort((a, b) => freeHands(b) - freeHands(a) || (a === pt) - (b === pt))[0] || null; }
  const m = teamOk(u).filter(o => (o.quals || []).includes('ll') && carries(o, 'lesslethal') && invOf(o).ll > 0 && llOk(o));
  return m.find(o => holds(o, 'lesslethal')) || m.find(o => freeable(o) >= LL_CFG.hands) || null; }
/** Why u cannot order this device right now (null = ok). */
function deviceWhyNot(u, type) {
  if (!hostile()) return 'Not needed — suspect is not a threat';
  if (u.inCar) return 'Get out of the vehicle first (Exit)';
  if (u.kind === 'patrol' && type !== 'taser') return 'Patrol officers carry a taser, not a launcher';
  if (u.kind === 'team' && !u.deployed) return 'Team is still forming at staging';
  if (u.orders && u.orders.some(q => DEVICE_ORDERS.includes(q.type))) return 'One taser / less-lethal order per turn';
  if (deviceUser(u, type)) return null;
  if (type === 'taser') return 'Nobody can free a hand for the taser (shield + ram in hand)';
  const q = u.kind === 'team' ? teamOk(u).filter(o => (o.quals || []).includes('ll') && carries(o, 'lesslethal')) : [];
  if (!q.length) return 'No 40mm less-lethal launcher on this team (needs a less-lethal specialist with the launcher)';
  if (q.every(o => invOf(o).ll <= 0)) return 'The 40mm launcher is out of rounds';
  if (q.some(o => invOf(o).ll > 0 && !llOk(o)) && q.some(o => invOf(o).ll > 0 && (holds(o, 'lesslethal') || freeable(o) >= LL_CFG.hands))) return q.some(o => invOf(o).reloadT >= S.turn) ? 'The 40mm launcher is reloading — a full turn' : 'One 40mm round per turn (a close-quarters prompt may offer a follow-on shot)';
  return 'The 40mm launcher needs BOTH hands — its carrier holds a shield or the ram (cannot be slung; change loadout)'; }
/** Range / sight check from (sx,sy). */
function deviceShotReq(u, type, sx, sy) { const sp = S.suspect, c = devCfg(type);
  const d = dist(sx, sy, sp.x, sp.y); if (!sp.visible && !(type === 'taser' && d <= c.range && los(sx, sy, sp.x, sp.y) === 1 && sp.lastKnown && sp.lastKnown.turn === S.turn)) return 'Suspect not in view';
  if (d > c.range) return `Out of ${type === 'taser' ? 'taser' : '40mm'} range — ~${c.range} m (suspect ${Math.round(d)} m)`;
  if (los(sx, sy, sp.x, sp.y) !== 1) return 'No clear line to the suspect from there';
  return null; }
function deviceChance(u, type, d) { const sp = S.suspect, c = devCfg(type);
  let p = clamp(c.p - c.perCell * Math.max(0, d - 1), c.min, 0.95);
  if (type === 'taser' && sp.armor && sp.armor !== 'none') p *= c.armorMul; // vest / heavy layers keep probes from connecting
  if (type === 'llfire' && sp.ambush) p *= c.ambushMul;
  return p; }
/** Draw device k (auto-holster / sling the rest), run fn, put the device back and redraw. */
function deviceTransition(t, o, k, hands, fn) {
  if (o.kind === 'patrol') return { o, r: fn(o), stowed: [], drew: false };
  const had = holds(o, k); let st = [];
  if (!had) { st = autoStow(o, null); if (freeHands(o) < hands || !stowedHas(o, k)) { autoRedraw(o, st); return null; } takeFromStow(o, k); putInHands(o, k, hands); }
  const r = fn(o);
  if (!had) { stowOne(o, k); autoRedraw(o, st); }
  syncEquip(t); return { o, r, stowed: st, drew: !had }; }
/** Runs during the turn: waits (holding) until the suspect is in view and in range; order clears at end of turn otherwise. */
function deviceTick(u, o) { const t = o.tgt && suspById(o.tgt); return withSp(t && spActive(t) && t.visible ? t : devTarget(u.x, u.y), () => deviceTick1(u, o)); }
function deviceTick1(u, o) { const sp = S.suspect;
  if (!hostile() || !suspectActive()) { popOrder(u); return; }
  const why = deviceShotReq(u, o.type, u.x, u.y); u.holding = true;
  if (why) { if (!o.waitLog) { o.waitLog = 1; log(`${u.name}: ${o.type === 'taser' ? 'taser' : 'less-lethal'} ready — waiting for a clear line (${why.toLowerCase()}).`, 'radio'); } return; }
  const who = deviceUser(u, o.type); if (!who) { popOrder(u); log(`${u.name}: ${deviceWhyNot(u, o.type) || 'cannot deploy'}.`, 'alert'); return; }
  const d = dist(u.x, u.y, sp.x, sp.y), p = deviceChance(u, o.type, d); faceTo(u, sp.x, sp.y); popOrder(u);
  const k = o.type === 'taser' ? 'taser' : 'lesslethal', c = devCfg(o.type);
  const tr = deviceTransition(u, who, k, c.hands, q => {
    if (o.type === 'llfire') { llSpend(q); }
    fx(o.type === 'taser' ? 'taser' : 'll', sp.x, sp.y, { fromX: u.x, fromY: u.y }); noise(u.x, u.y, o.type === 'taser' ? 2 : 6, 'thud');
    return S.rng.chance(p); });
  if (!tr) { log(`${u.name}: could not free the hands for the ${o.type === 'taser' ? 'taser' : 'launcher'}.`, 'alert'); return; }
  const nm = who.name || u.name;
  if (tr.stowed.length) log(`${nm}: ${tr.stowed.map(x => WEAPONS[x] ? WEAPONS[x].short.toLowerCase() : x).join(' + ')} put away for the ${o.type === 'taser' ? 'taser' : '40mm launcher'} — back in hand after, not ready until next turn.`);
  S.stats.devices = (S.stats.devices || 0) + 1;
  if (o.type === 'taser') {
    if (tr.r) { sp.stun = Math.max(sp.stun || 0, c.stunTurns * TICKS); sp.stunBy = 'taser'; sp.ambush = false; sp.walk = null; fx('text', sp.x, sp.y, { text: 'TASER', color: '#ffe060' });
      log(`${nm}: TASER, TASER — probes connected, suspect incapacitated. Move in for the arrest.`, 'good'); xpAct('bang', u.kind === 'team' ? u : null); }
    else { log(`${nm}: taser deployed — no effect (probes missed or did not connect).`, 'alert'); sp.agit = clamp((sp.agit || 0) + 10, 0, 100); aggressive(8); }
  } else {
    const left = invOf(who).ll;
    if (!tr.r) log(`${nm}: less-lethal round missed.`, 'radio');
    else if (S.rng.chance(c.noEffect)) log(`${nm}: less-lethal round struck — no visible effect.`, 'alert');
    else { sp.stun = Math.max(sp.stun || 0, S.rng.int(c.stunTurns[0], c.stunTurns[1]) * TICKS); sp.stunBy = 'll'; sp.ambush = false; sp.walk = null; fx('text', sp.x, sp.y, { text: 'LESS-LETHAL', color: '#c0a0ff' });
      log(`${nm}: less-lethal round on target — suspect incapacitated for now. Move in for the arrest.`, 'good'); xpAct('bang', u.kind === 'team' ? u : null); }
    if (left <= 0) log(`${nm}: 40mm launcher is out of rounds.`, 'radio');
    if (!tr.r || !sp.stun) { sp.agit = clamp((sp.agit || 0) + 8, 0, 100); aggressive(6); }
  }
}

function startFlee() {
  const sp = S.suspect; const wins = S.windows.filter(w => w.room !== sp.room && exitWin(w));
  let best = null, bp = null;
  for (const w of wins) { const [cx, cy] = w.edges[0]; const p = findPath(sp.x, sp.y, (x, y) => x === cx && y === cy, { suspect: true, canOpen: true }); if (p && (!bp || p.length < bp.length)) { bp = p; best = w; } }
  if (!best) return; sp.mode = 'fleeing'; sp.flee = best.id; log(`${spName()} is moving — ${multiSp() ? 'trying' : 'he is trying'} to get out of the gas!`, 'alert');
}
function fleeStep() {
  const sp = S.suspect, w = S.windows[sp.flee]; const [cx, cy, ox, oy] = w.edges[0];
  if (sp.x === cx && sp.y === cy) {
    w.broken = true; sp.x = ox; sp.y = oy; sp.room = -1; fx('glass', ox, oy);
    const catcher = S.units.find(u => onFoot(u) && !(u.perch && u.perch.entry) && dist(u.x, u.y, ox, oy) <= 6 && los(u.x, u.y, ox, oy)) || S.units.find(u => u.kind === 'cruiser' && u.occ.length && dist(u.x, u.y, ox, oy) <= 4);
    if (catcher) { sp.mode = 'detained'; sp.method = S.stats.method = 'Caught by perimeter'; log(`${spName()} bails out a window — straight into ${catcher.name}. ${multiSp() ? spName().toUpperCase() : 'SUSPECT'} DETAINED.${custodyTally()}`, 'good'); }
    else { sp.mode = 'detained'; sp.escapedOut = true; S.stats.escaped = true; S.stats.escapedN = (S.stats.escapedN || 0) + 1; sp.method = S.stats.method = 'Caught after escape (outer units)'; log(`${spName()} went out a window through a perimeter gap — outer units and K9 tracked ${multiSp() ? 'the suspect' : 'him'} down after a foot pursuit. ${multiSp() ? spName().toUpperCase() : 'SUSPECT'} DETAINED (perimeter breach).${custodyTally()}`, 'bad'); }
    return;
  }
  const p = findPath(sp.x, sp.y, (x, y) => x === cx && y === cy, { suspect: true, canOpen: true });
  if (!p || !p.length) { sp.mode = 'alert'; return; }
  const [nx, ny] = p[0]; const e = edge(sp.x, sp.y, nx, ny); if (e.t === 'D') { e.d.state = 'open'; e.d.barricaded = false; }
  sp.x = nx; sp.y = ny; sp.room = roomAt(nx, ny);
}
function teamResponses() { eachSp(teamResponses1); }
function teamResponses1() {
  const sp = S.suspect; if (!suspectActive()) return; const myKey = sp.key || true;
  for (const u of S.units) {
    if (sp.walk) break; // walk-out protocol handles custody (see walkoutTick)
    if (u.kind !== 'team' || !unitAlive(u) || !u.deployed) continue;
    const sees = u.vis.includes(idx(sp.x, sp.y)); const d = dist(u.x, u.y, sp.x, sp.y);
    if (u.detain === myKey || ((!u.detain || !spActive(suspById(u.detain))) && sees && (sp.mode === 'surrendered' || sp.mode === 'incapacitated' || sp.stun > 0) && d < 10)) u.detain = myKey;
    if (cheb(u.x, u.y, sp.x, sp.y) <= 1 && los(u.x, u.y, sp.x, sp.y) === 1) {
      if (!hostile() || sp.stun > 0) { detained(u, sp.mode === 'surrendered' ? 'Surrendered' : sp.mode === 'incapacitated' ? 'Less-lethal + arrest' : sp.stunBy === 'taser' ? 'Taser + arrest' : sp.stunBy === 'll' ? 'Less-lethal + arrest' : 'Dynamic entry (flashbang)'); return; }
      const p = (0.2 + teamOk(u).length * 0.05 + (hasShield(u) ? 0.1 : 0)) * (sp.ambush ? 0.6 : 1);
      if (S.rng.chance(p)) { detained(u, 'Hands-on arrest'); return; } log(`${u.name}: struggle with suspect!`, 'alert'); shotOfficer(u, SUSPECT_CAL[sp.weapon] || 'pistol', 1, sp.x, sp.y); continue;
    }
    if (!sees || !hostile() || sp.stun > 0) continue;
    const outside = roomAt(u.x, u.y) < 0; if (outside && u.chTurn === S.turn) continue; // from outside: one shouted challenge per turn
    if (u.challenged !== S.tick) { u.challenged = S.tick; S.stats.challenged = true; if (outside) u.chTurn = S.turn;
      const comply = ((outside ? NEGO_CFG.outsideChallenge : 1) * 0.05 + S.units.filter(q => q.kind === 'team' && q.vis && q.vis.includes(idx(sp.x, sp.y))).length * 0.05) * (outside ? 1 : 0.45) + sp.talk / 250 - sp.agit / 300;
      if (S.rng.chance(comply)) { if (outside) { log(`${u.name}: "POLICE! DROP IT AND COME OUT!" — he shouts that he is coming out.`, 'good'); walkout('callout'); break; }
        surrender(`${u.name}: "POLICE! DROP IT!" — ${multiSp() ? spName().toLowerCase() : 'suspect'} drops the weapon and gets on the ground.`); u.detain = myKey; continue; }
      if (u.equip.lesslethal > 0 && u.stance !== 'hold' && d <= 11 && !(u.llcd > S.tick)) { u.llcd = S.tick + 3; /* single-shot launcher: re-load before the next round */ const llo = useItem(u, 'lesslethal'); if (llo && invOf(llo).ll <= 0) log(`${llo.name}: 40mm launcher is out of rounds.`, 'radio'); const p = (0.3 + (hasSpec(u, 'marksman') ? 0.15 : 0) + teamSkill(u) * 0.15) * (sp.ambush ? 0.45 : 1);
        if (S.rng.chance(p)) { sp.mode = 'incapacitated'; fx('ll', sp.x, sp.y, { fromX: u.x, fromY: u.y }); log(`${u.name}: less-lethal round — ${multiSp() ? spName().toLowerCase() : 'suspect'} incapacitated, weapon dropped.`, 'good'); u.detain = myKey; continue; }
        else log(`${u.name}: less-lethal round missed.`, 'radio'); }
      else if (sp.cd > 0) { sp.cd += 1; if (u.duckLog !== S.turn) { u.duckLog = S.turn; log(`${u.name}: "POLICE! DROP THE WEAPON!" — suspect ducks into cover.`, 'radio'); } }
    }
  }
  // K9 detection through walls
  for (const u of S.units) if (u.kind === 'team' && unitAlive(u) && u.deployed && hasSpec(u, 'k9') && dist(u.x, u.y, sp.x, sp.y) <= 5 && !sp.visible && (!sp.heat || sp.heat.turn !== S.turn)) {
    sp.heat = { room: sp.room, x: sp.x, y: sp.y, turn: S.turn }; S.intel.located = true; log(`${u.name}: K9 is indicating — suspect close, ${S.rooms[sp.room] ? S.rooms[sp.room].name : 'nearby'}.`, 'intel'); }
}
function detained(u, how) { const sp = S.suspect; sp.mode = 'detained'; xpAct('detain', u && u.kind ? u : null); if (sp.downBy === 'fire' && how === 'Less-lethal + arrest') how = 'Officer fire + arrest'; S.stats.method = how; sp.method = how; fx('text', sp.x, sp.y, { text: 'SECURED', color: '#3ef0a0' });
  S.units.forEach(q => { if (q.detain && q.detain === sp.key) q.detain = false; });
  if (multiSp()) { const left = suspList().filter(spActive).length; log(`${u.name}: ${spName().toUpperCase()} IN CUSTODY. (${how})${custodyTally()}${left ? ' Scene NOT secure — ' + (S.intel.suspConfirmed ? left + ' still outstanding.' : 'keep clearing.') : ' Scene secure.'}`, 'good'); }
  else log(`${u.name}: SUSPECT IN CUSTODY. Scene secure. (${how})`, 'good'); }
function custodyTally() { if (!multiSp()) return ''; const L = suspList(), n = L.filter(s => s.mode === 'detained').length; return S.intel.suspConfirmed ? ` (${n}/${L.length} in custody)` : ` (${n} in custody)`; }
/** The mission ends only when the suspect is in custody or command chooses to withdraw — never on losses or elapsed time. */
function checkEnd() {
  if (S.phase === 'over') return;
  const L = suspList(); // every suspect must be in custody (escapes are tracked down by outer units and end 'detained' too)
  if (L.length && L.every(s => s.mode === 'detained')) { const multi = L.length > 1; S.phase = 'over';
    S.result = { win: true, title: multi ? (S.stats.escaped ? `ALL ${L.length} SUSPECTS IN CUSTODY (ONE OR MORE AFTER ESCAPE)` : `ALL ${L.length} SUSPECTS IN CUSTODY`) : S.stats.escaped ? 'SUSPECT CAUGHT AFTER ESCAPE' : 'SUSPECT IN CUSTODY',
      text: `Resolved after ${tMin(S.turn + 1)} (${elapsedAt(S.turn + 1)}). Method: ${multi ? L.map(s => spName(s) + ' — ' + (s.method || '?')).join('; ') : S.stats.method}. Officers hit: ${S.stats.down}.` }; }
  if (S.phase === 'over') finishMission();
}
function finishMission() { sideTurn(); casualtyResolve(S.result.win); S.result.debrief = debrief(); log(S.result.title, S.result.win ? 'good' : 'bad'); S.version++; }
/** Units that can still act on scene (or are still coming). */
function forceLeft() { const offs = S.officers.filter(o => o.status === 'enroute' || o.status === 'staged' || o.status === 'operator').length;
  const field = S.units.filter(u => unitAlive(u) && (u.kind === 'team' ? teamOk(u).length > 0 : u.kind === 'patrol')).length; return offs + field; }
/** Player ends the operation without a resolution (e.g. no mobile officers left). */
function withdraw() { if (S.phase === 'over') return { ok: false, reason: 'Mission already over' };
  const sp = S.suspect; S.phase = 'over'; S.stats.withdrawn = true;
  S.result = { win: false, title: 'OPERATION WITHDRAWN', text: `Command ended the operation after ${tMin(S.turn)} without taking ${multiSp() ? 'every suspect' : 'the suspect'} into custody${multiSp() ? ` (${suspList().filter(s => s.mode === 'detained').length} of ${suspList().length} in custody)` : sp.mode === 'incapacitated' ? ' (suspect down but not secured)' : ''}. Scene handed over.` };
  log('Command: withdraw — all units pull back to the perimeter.', 'bad'); finishMission(); return { ok: true }; }
function endTurnBase() {
  sideTurn();
  S.turn++; S.phase = 'planning'; S.tick = 0; S.peek = []; syncAll(); // weapons become ready again
  for (const u of S.units) { u.orders = u.orders.filter(o => o.regroup === undefined && o.type !== 'hold' && o.type !== 'shoot' && !DEVICE_ORDERS.includes(o.type)); u.holding = false; u.waiting = false; u.exiting = null;}
  deviceTurn();
  gasTurn(); eachSp(suspectGasTurn); casualtyTurn(); negoTurn(); eachSp(sceneTurn); types3Turn();
  if (S.intel.blueprint && S.intel.blueprint === S.turn) { S.rooms.forEach(q => q.known = true); S.doors.forEach(d => d.known = true); S.intel.floors = true; log('Blueprints received — full floor plan on screen.', 'intel'); }
  for (const o of S.officers) { if (o.status === 'enroute') { if (o.eta <= S.turn) { o.status = 'staged'; log(`PAGER: ${o.name} (${SPECS[o.spec].name}) on scene at staging.`, 'pager'); S.events.push({ type: 'pager' }); } } }
  eachSp(sp => { if (hostile()) { sp.agit = clamp(sp.agit - 4, 0, 100); if (!sp.visible) sp.unseenTurns++; else sp.unseenTurns = 0;
    if (sp.mode === 'alert' && sp.unseenTurns >= 3 && sp.stun === 0 && sp.disp !== 'fighting') { sp.mode = 'barricaded'; sp.ambush = false; sp.unseenTurns = 0; } } });
  
  rebuildDyn(); computeExpo(); updateVision(); gasObserve(); checkEnd(); S.version++;
}

/** After-action summary: negotiation, surrender protocol, casualties. */
function debrief21() {
  const N = S.nego, sp = S.suspect, out = [];
  let neg = N.outcome || (N.everContact ? 'Contact made, no surrender' : N.attempts ? 'Contact refused' : negOnScene().length ? 'No contact attempted' : 'No negotiator used');
  if (S.result && S.result.win && sp.mode === 'detained' && !N.how && N.outcome !== 'Walk-out ambush') neg += ` — resolved tactically (${S.stats.method})`;
  out.push({ k: 'Negotiation', v: `${neg}. Attempts ${N.attempts}, refusals ${N.refusals}, dialogue rounds ${N.rounds}.` });
  if (N.protocol) { const P = N.protocol; out.push({ k: 'Walk-out protocol', v: `${P.score}/4 — ${['cover', 'shield', 'overwatch', 'commands'].map(k => (P[k] ? '✓ ' : '✗ ') + k).join(', ')}${N.ambush ? '. AMBUSH' + (N.ambush.hit ? ' — an officer was hit' : ' — no officer hit') : ''}.` }); }
  out.push(...sceneDebrief()); out.push(...sideDebrief());
  const own = S.cas.filter(c => c.who !== 'suspect'), cnt = st => own.filter(c => c.state === st).length;
  out.push({ k: 'Casualties', v: own.length ? `${own.length} hit — evacuated ${cnt('evacuated')}, lost ${cnt('lost')}, killed in action ${cnt('kia')}.` : 'None.' });
  own.forEach(c => out.push({ k: '  ' + c.name, v: sevWord(c) + (c.initial ? ' (hit before SWAT arrived)' : '') }));
  const sc = S.cas.find(c => c.who === 'suspect');
  const M = missionScore(); out.push({ k: 'Score', v: `${M.score} — ${M.grade}` });
  M.items.forEach(i => out.push({ k: '  ' + (i.pts < 0 ? 'Deduction' : 'Bonus'), v: `${i.label}: ${i.pts > 0 ? '+' : '−'}${Math.abs(i.pts)}`, pts: i.pts }));
  if (multiSp()) out.push({ k: 'Suspects', v: `${suspList().length} — ${suspList().filter(s => s.mode === 'detained').length} in custody. Patrol reported ${S.brief && S.brief.report ? S.brief.report.text : 'one subject'}.` });
  out.push(...suspectsDebrief()); out.push(...encDebrief()); void sc;
  return out;
}

/** Commendation score for the debrief / career. No time component. Losses are deductions, never an early end.
    items: [{label, pts}] — every bonus and deduction, listed in the debrief. */
const SCORE = { resolved: 500, talked: 250, rescued: 150, gapClosed: 50, officerHit: -200, officerLost: -400, civHurt: -300, civKilled: -600, hostageHurt: -300, hostageKilled: -800, suspectLost: -150, escape: -300, withdraw: -400, stateTeam: -250, extraSuspect: 100 };
function missionScore() {
  const R = S.result || {}, sp = S.suspect, N = S.nego, items = [], add = (label, pts) => { if (pts) items.push({ label, pts }); };
  const after = S.cas.filter(c => !c.initial), lostSt = c => c.state === 'kia' || c.state === 'lost';
  const ours = after.filter(c => c.who === 'officer' || c.who === 'patrol'), civ = after.filter(c => c.who === 'civilian' && !c.hostage), hos = after.filter(c => c.who === 'hostage' || c.hostage);
  if (R.win) { add('Suspect resolved', SCORE.resolved); if (N.how) add('Talked out (no force)', SCORE.talked); }
  const escN = S.stats.escapedN || (S.stats.escaped ? 1 : 0); if (escN) add(escN > 1 ? `Perimeter breach — ${escN} suspects escaped before capture` : 'Perimeter breach — suspect escaped before capture', escN * SCORE.escape);
  const extraIn = suspList().slice(1).filter(s => s.mode === 'detained').length; if (multiSp() && extraIn) add(`Additional suspects in custody (${extraIn})`, extraIn * SCORE.extraSuspect);
  if (S.stats.withdrawn) add('Withdrew without resolution', SCORE.withdraw);
  if (S.stats.stateTeam) add('Scene handed to the State SWAT team', SCORE.stateTeam);
  const oh = ours.filter(c => !lostSt(c)).length, ol = ours.filter(lostSt).length;
  if (oh) add(`Officers hit (${oh})`, oh * SCORE.officerHit); if (ol) add(`Officers killed or lost (${ol})`, ol * SCORE.officerLost);
  const ch = civ.filter(c => !lostSt(c)).length, ck = civ.filter(lostSt).length; if (ch) add(`Civilians hurt (${ch})`, ch * SCORE.civHurt); if (ck) add(`Civilians killed (${ck})`, ck * SCORE.civKilled);
  const hh = hos.filter(c => !lostSt(c)).length, hk = hos.filter(lostSt).length; if (hh) add(`Hostages hurt (${hh})`, hh * SCORE.hostageHurt); if (hk) add(`Hostages killed (${hk})`, hk * SCORE.hostageKilled);
  const lostN = suspList().filter(s => s.deceased).length; if (lostN) add(lostN > 1 ? `Suspects who did not survive (${lostN})` : 'Suspect did not survive', lostN * SCORE.suspectLost);
  const init = S.cas.find(c => c.initial && c.state !== 'kia'); if (init && (init.state === 'evacuated' || init.state === 'transport' || init.stable)) add('Rescued officer down on arrival', SCORE.rescued);
  typeScore(add); typeScore3(add); behScore(add);
  if (S.scene && S.scene.gap0.length && S.scene.gapClosed != null && !S.scene.slipTried) add('Closed perimeter gap', SCORE.gapClosed);
  sideScore(add);
  if (encOn()) encScore(items, add);
  const sc = items.reduce((a, i) => a + i.pts, 0), sg = v => (v > 0 ? '+' : '−') + Math.abs(v);
  const grade = sc >= 1000 ? 'Medal of Valor' : sc >= 650 ? 'Unit Commendation' : sc >= 350 ? 'Satisfactory' : sc >= 0 ? 'Needs Review' : 'Board of Inquiry';
  return { score: sc, grade, items, parts: items.map(i => `${i.label} ${sg(i.pts)}`), deductions: items.filter(i => i.pts < 0) };
}
/** Everything the career layer needs from a finished mission (pure data, no references into S). */
function careerSummary() {
  const R = S.result || {}, sp = S.suspect, N = S.nego, m = S.stats.method || '';
  const outcome = S.stats.stateTeam ? 'state' : !R.win ? 'withdrawn' : S.stats.escaped ? 'pursuit'
    : N.how === 'callout' ? 'callout' : N.how ? 'negotiated' : /perimeter/i.test(m) ? 'perimeter' : /Less-lethal|Taser/i.test(m) ? 'lesslethal' : /fire/i.test(m) ? 'officerfire' : /entry|flashbang|gas/i.test(m) ? 'tactical' : 'arrest';
  const officers = S.officers.map(o => { const c = S.cas.find(q => q.who === 'officer' && q.ref === o.id);
    return { careerId: o.careerId || null, id: o.id, name: o.name, spec: o.spec, onScene: o.status !== 'enroute', inTeam: !!o.team, cas: c ? { state: c.state, sev: c.sev, stable: !!c.stable } : null }; });
  const pc = S.cas.filter(c => c.who === 'patrol'), scs = S.cas.find(c => c.who === 'suspect');
  const M = missionScore();
  return { seed: S.seed, win: !!R.win, title: R.title || '', method: m, outcome, turns: S.turn + 1, timeSec: (S.turn + 1) * TURN_SEC, score: M.score, grade: M.grade, deductions: M.deductions.map(d => ({ label: d.label, pts: d.pts })), officers,
    patrol: { hit: pc.length, lost: pc.filter(c => c.state === 'kia' || c.state === 'lost').length },
    suspect: suspList().some(s => s.deceased) ? 'lost' : scs ? 'injured' : suspList().some(s => s.mode === 'escaped') ? 'escaped' : suspList().every(s => s.mode === 'detained') ? 'unhurt' : 'inside', suspects: suspList().length, variant: S.scene ? S.scene.variant : null, stype: S.stype ? S.stype.key : 'barricade',
    stateTakeover: !!S.stats.stateTeam, actions: (S.xpLog || []).map(x => ({ key: x.key, label: x.label, xp: x.xp, ids: x.ids.slice(), by: x.by, detail: x.detail, turn: x.turn })), level: (S.opts && S.opts.level) || null,
    reviews: (S.reviews || []).map(r => ({ careerId: r.careerId, id: r.id, name: r.name, missions: r.missions, removed: !!r.removed })) };
}
/* ==============================================================
   v20 — encounter consistency, window throws, reaction prompts,
   injuries / officer-hit messages and the rest of batch 1.
   (Later declarations override earlier ones of the same name.)
   ============================================================== */
const V20 = { dropP: 0.2, fairTurns: 1, followMax: 3, buddyDiv: 3 };
function r20() { if (!S.r20) S.r20 = makeRng((S.seed || 1) * 61 + 29); return S.r20; }

/* ---------- item 2: weapon knowledge ---------- */
/** A confirmed weapon (seen clearly, or he fired at officers) stays in every prompt while officers keep sight of him.
    Out of sight he may put it down; on the next contact officers must reassess. */
function encRead(sp, u, pose) { const M = mindOf(sp);
  if (pose !== 'heard') {
    if (sp.armedKnown && M.lastSeen !== undefined && M.lastSeen < S.turn - 1 && !encFair(sp)) {
      if (spArmed(sp) && r20().chance(V20.dropP)) { sp.droppedWeapon = sp.weapon; sp.weapon = 'none'; }
      sp.armedKnown = false; M.reassess = true; }
    M.lastSeen = S.turn; }
  const rd = encReadBase(sp, u, pose);
  if (pose !== 'heard' && sp.armedKnown && spArmed(sp)) { rd.actual = 'weapon'; rd.kind = sp.weapon; rd.looks = 'gun'; rd.conf = 'known'; }
  else if (pose !== 'heard' && rd.actual === 'weapon' && rd.looks === 'gun' && rd.conf === 'confident') sp.armedKnown = true;
  if (M.reassess && pose !== 'heard') { rd.reassess = true; M.reassess = false; }
  return rd; }
/** He shot at officers this turn or last (≤ 30 s): force is justified without review. */
function encFair(sp) { return sp.firedAt !== undefined && sp.firedAt !== null && sp.firedAt >= S.turn - V20.fairTurns; }
function encJustified(sp, item) { const M = mindOf(sp), rd = M.read || {};
  if (encFair(sp) || item.pose === 'aim') return true;
  if (item.pose === 'awayUp' || item.pose === 'hands') return false;
  return rd.actual === 'weapon' || (!!sp.armedKnown && spArmed(sp)); }
function confText(rd, sp) { const gw = (GUN_WORD[sp.weapon] || 'a handgun').replace(/^an? /, '');
  if (rd.conf === 'known') return `Officers KNOW he is armed (${gw}) — ${encFair(sp) ? 'he fired at officers within the last 30 seconds; force is justified' : 'they saw it and he has not put it down in their sight'}.`;
  if (rd.looks === 'empty') return 'Officers are confident his hands are empty.';
  if (rd.conf === 'confident') return rd.looks === 'gun' ? `Officers are confident it is a gun (${gw}).` : 'Officers are confident it is a phone.';
  if (rd.conf === 'uncertain') return rd.looks === 'gun' ? 'Officers are uncertain but it looks like a gun.' : 'Officers are uncertain — it may be a phone.';
  return 'Officers cannot tell — unknown item.'; }

/* ---------- item 7: how the suspect is injured (neutral wording) ---------- */
function injWhere(sp, state) { const r = makeRng((S.seed || 1) * 97 + S.turn * 13 + (S.tick || 0) * 7 + (sp.sid || 0));
  if (state === 'mobile') return r.pick(['hit in the left arm', 'hit in the right arm', 'grazed on the leg — limping', 'hit in the shoulder', 'hit in the hip — moving slowly']);
  if (state === 'kia') return 'hit in the torso — no movement';
  return r.pick(['hit in the leg — cannot stand', 'hit in the torso — on the floor', 'hit in the hip — on the floor', 'hit in the shoulder and down']); }
function injText(sp) { return sp.injuryText ? `He is injured (${sp.injuryText}).` : 'He appears injured.'; }

/* ---------- item 8: officer-hit message + buddy aid ---------- */
const HIT_WHERE = { 1: ['upper arm', 'forearm', 'lower leg', 'hand'], 2: ['thigh', 'shoulder', 'side below the vest', 'hip'], 3: ['abdomen below the vest', 'upper chest at the vest edge', 'upper thigh', 'neck area'] };
function hitMessage(c, team) { const r = makeRng((S.seed || 1) * 131 + (S.casSeq || 0) * 7 + S.turn);
  c.where = c.minor ? 'vest (blunt impact behind the armor)' : r.pick(HIT_WHERE[c.sev] || HIT_WHERE[2]);
  const sevW = c.minor ? 'minor' : c.state === 'kia' ? 'fatal' : c.sev >= 3 ? 'critical' : c.sev === 2 ? 'serious' : 'minor';
  const tail = c.state === 'kia' ? 'Killed in action.' : c.stable ? 'Stabilised — needs extraction to EMS.' : `Time until critical without further aid: ${tDur(c.crit)}.`;
  const m = { turn: S.turn, tick: S.tick || 0, id: c.id, sev: sevW, text: `OFFICER HIT — ${c.name}${team ? ' (' + team + ')' : ''}: ${c.where}, ${sevW}. ${tail}` };
  (S.hitMsgs = S.hitMsgs || []).push(m); return m; }
function officerDown(u, msg, ctx) { const c = officerDownBase(u, msg, ctx); if (!c) return c;
  // buddy aid: no medic on the team → a teammate applies aid at once (1/3 of a medic with a bag)
  if (u.kind === 'team' && casActive(c) && !c.stable && !c.aided && teamOk(u).length && !hasSpec(u, 'medic')) applyAid(u, c, true);
  hitMessage(c, u.kind === 'team' ? u.name : 'patrol'); return c; }
/** Buddy aid by any officer = 1/3 the bleed-out slowing of a medic with a bag. */
CAS_CFG.aidOther = Math.max(1, Math.round(CAS_CFG.medicSevere / V20.buddyDiv));

/* ---------- item 1: window throws at the threshold ---------- */
const WIN_OPTS = [
  { key: 'wfire', label: 'Return fire from position', sub: 'stay at the window and return fire into the room' },
  { key: 'wretreat', label: 'Return fire while retreating to the nearest cover', sub: 'a short burst of fire, then move to cover out of his line of sight' },
  { key: 'wwithdraw', label: 'Withdraw to the nearest cover', sub: 'no shots — move to cover out of his line of sight' },
];
const END_OPT = { key: 'endturn', label: 'End turn', hint: 'No further action now — the turn resolves', who: [], team: true };
/** The team throws into room r through a window (no door/opening between its cell and the room). */
function encViaWindow(u, r) { if (roomAt(u.x, u.y) === r) return false;
  for (const [dx, dy] of DIRS4) { const nx = u.x + dx, ny = u.y + dy; if (!inb(nx, ny) || roomAt(nx, ny) !== r) continue; const e = edge(u.x, u.y, nx, ny); if (e.t === 'D' || e.t === 'O') return false; }
  return true; }
function encThreshold(u, o) { if (!encOn() || S.phase !== 'executing' || !u || u.kind !== 'team') return null; const r = afterRoom(u, o); if (r < 0) return null;
  const sp = suspList().find(s => spHostile(s) && s.room === r && spArmed(s)); if (!sp) return null;
  return withSp(sp, () => { const M = mindOf(sp); const p = ENC_CFG.blind * (0.5 + M.harmOff) * (sp.stun > 0 ? 0.3 : 1) * (o.type === 'gas' ? 0.8 : 1); if (!S.rng.chance(p)) return null;
    const win = (o.type === 'gas' || o.type === 'bang') && encViaWindow(u, r);
    const n0 = S.log.length, where = S.rooms[r] && S.rooms[r].known ? S.rooms[r].name : 'room'; sp.firedAt = S.turn; sp.armedKnown = true; S.stats.shots++; sp.mode = 'alert'; sp.cd = 2;
    fx('muzzle', sp.x, sp.y, { suspect: true }); fx('shot', sp.x, sp.y, { tx: u.x, ty: u.y });
    log(win ? `SHOTS THROUGH THE WINDOW — ${multiSp() ? spName().toLowerCase() : 'the suspect'} is firing at the ${where} window.` : `SHOTS THROUGH THE DOORWAY — ${multiSp() ? spName().toLowerCase() : 'the suspect'} is firing blindly at the threshold of the ${where}.`, 'alert');
    if (S.rng.chance(ENC_CFG.blindHit)) shotOfficer(u, SUSPECT_CAL[sp.weapon] || 'pistol', 2, sp.x, sp.y, where); else log(win ? 'No hits — rounds strike the window frame.' : 'No hits — rounds strike the door frame.', 'alert');
    const what = o.type === 'gas' ? (o.cs40 ? 'firing a CS round' : 'throwing CS') : 'throwing a flashbang';
    const text = win ? `${u.name} is outside the ${where}, at the window (${what}). Fire from inside — he is not visible. The team is outside: what does it do?` : `${u.name} is at the ${where} doorway. Blind fire from inside — he is not visible. What does the team do?`;
    return encPause([{ kind: 'blind', win, sp: spIdx(sp), uid: u.uid, room: r, title: win ? 'Shots at the window' : 'Shots at the threshold', text, res0: encLogFrom(n0),
      options: (win ? WIN_OPTS : BLIND_OPTS).map(b => ({ key: b.key, label: b.label, hint: b.sub, who: [] })).concat([Object.assign({}, END_OPT)]) }], false); }); }
function blindChoose(key) { const it = encCur(); if (!it || it.kind !== 'blind') return { ok: false, reason: 'No decision pending' };
  if (key === 'endturn') return encEndChoice(it);
  if (!it.win) return blindChoose0(key);
  if (!WIN_OPTS.some(b => b.key === key)) return { ok: false, reason: 'Unknown choice' };
  const u = unit(it.uid), sp = spAt(it.sp), n0 = S.log.length, r = it.room, enter = q => q.fromAfter || ((q.type === 'clear' || q.type === 'move') && (q.room === r || roomAt(q.x, q.y) === r));
  if (u && unitAlive(u)) { u.orders = u.orders.filter(q => !enter(q)); u.regroup = null;
    if (key === 'wfire') { u.orders.unshift({ type: 'hold', fromEnc: true }); log(`${u.name}: returning fire through the window from position.`, 'radio'); encDoorFire(u, sp, 3, true); }
    else if (key === 'wretreat') { log(`${u.name}: returning fire while moving to cover.`, 'radio'); encDoorFire(u, sp, 2, true); if (sp) encWithdraw(u, sp); }
    else { log(`${u.name}: withdrawing from the window to cover.`, 'radio'); if (sp) encWithdraw(u, sp); else u.orders.unshift({ type: 'hold', fromEnc: true }); } }
  it.done = true; it.chose = key; it.res = encLogFrom(n0); S.version++; return { ok: true, res: it.res }; }

/* ---------- item 3: reaction prompt after each choice + End turn ---------- */
function encOptions(sp, u, pose, rd) { return encOptionsBase(sp, u, pose, rd).concat([Object.assign({}, END_OPT)]); }
function encRespond(sp, u, key, item) { const r = encRespondBase(sp, u, key, item); S.encResp = r; return r; }
function encEndChoice(it) { const n0 = S.log.length; const u = unit(it.uid); log(`${u ? u.name : 'Team'}: no further action — end of turn.`, 'radio');
  it.done = true; it.chose = 'endturn'; it.res = encLogFrom(n0);
  S.enc.items = S.enc.items.filter((x, j) => j <= S.enc.i || !(x.follow && x.sp === it.sp)); S.version++; return { ok: true, res: it.res, end: true }; }
function encChoose(key, offId) { const it = encCur(); if (!it || it.done || S.phase !== 'encounter') return { ok: false, reason: 'No decision pending' };
  if (key === 'endturn') return encEndChoice(it);
  if (it.kind === 'blind') return blindChoose(key);
  const sp = spAt(it.sp); S.encResp = null;
  const st0 = sp ? { stun: sp.stun || 0, inj: !!sp.injured, armed: spArmed(sp), x: sp.x, y: sp.y } : null;
  const r = encChooseBase(key, offId); if (!r.ok) return r;
  const f = encFollow(it, key, st0); if (f) { S.enc.items.splice(S.enc.i + 1, 0, f); r.follow = true; }
  return r; }
function encReactText(sp, key, st0, resp, seen) {
  if (sp.mode === 'surrendered' || sp.mode === 'detained') return `He complies — ${st0 && st0.armed ? 'weapon on the floor, ' : ''}hands up, getting on the ground. Move in and take him into custody.`;
  if (sp.mode === 'incapacitated') return sp.deceased ? 'He is down and not moving. Secure the scene.' : `He is down and no longer a threat${sp.injuryText ? ' (' + sp.injuryText + ')' : ''}. Move in, secure him and get EMS.`;
  if (sp.stun > (st0 ? st0.stun : 0) || (sp.stun > 0 && ['taser', 'll', 'bang'].includes(key))) return key === 'bang' ? 'He is disoriented by the flash — a short window to move in.' : 'He is incapacitated by the device — move in for the arrest now.';
  const L = [];
  if (sp.injured && st0 && !st0.inj) L.push(`He is hit (${sp.injuryText || 'injured'}) but still moving.`);
  if (key === 'shoot' && !(sp.injured && st0 && !st0.inj)) L.push('The shot missed.');
  if (key === 'gas') L.push('CS fills the room — he is coughing.');
  if (key === 'withdraw') L.push('The team backs out of his line of sight.');
  if (resp === 'fire' || encFair(sp) && key !== 'withdraw' && sp.firedAt === S.turn && resp !== 'comply') L.push('He fired at the officers. Force is justified this turn and next.');
  else if (resp === 'hostage') L.push('He grabs the person next to him and holds them in front of him.');
  else if (resp === 'delay') L.push('He is stalling — "give me a minute". He may come out at the end of the turn.');
  else if (resp === 'retreat') L.push('He backs away deeper into the room' + (seen ? '.' : ' — out of sight.'));
  else if (resp === 'ignore') L.push('He ignores the officers and stays where he is.');
  else if (key === 'hold' || resp === 'comply') L.push('He stays where he is.');
  if (!L.length) L.push('No visible change in his behaviour.');
  return L.join(' '); }
function encFollow(it, key, st0) { const sp = spAt(it.sp), u = unit(it.uid); if (!sp) return null;
  return withSp(sp, () => { const M = mindOf(sp), depth = (it.depth || 0) + 1, resp = S.encResp;
    const seen = !!(u && encSeers(sp).includes(u)), react = encReactText(sp, key, st0, resp, seen);
    const base = { follow: true, depth, sp: it.sp, uid: it.uid, mid: it.mid, res: (it.res || []).slice() };
    const go = hostile() && sp.stun <= 0 && sp.mode !== 'fleeing' && key !== 'withdraw' && seen && u && unitAlive(u) && teamOk(u).length && depth <= V20.followMax;
    if (!go) return Object.assign(base, { kind: 'result', title: 'Suspect reaction', text: react, done: true });
    if (resp === 'retreat' || resp === 'hostage') M.poseTurn = -1; const pose = resp === 'hostage' && hostageAvail(sp) ? 'hostage' : encPose(sp, u);
    M.pose = pose; M.poseTurn = S.turn; const rd = encRead(sp, u, pose); M.read = rd;
    return Object.assign(base, { kind: 'contact', pose, react, read: { conf: rd.conf, looks: rd.looks }, title: `Suspect reaction — ${u.name}`, text: react + ' ' + encDescribe(sp, u, pose, rd), options: encOptions(sp, u, pose, rd) }); }); }

/* ---------- items 4 / 12: officer tags in pick lists ---------- */
function itemShort(k) { return (EQUIP[k] && EQUIP[k].short) || (WEAPONS[k] && WEAPONS[k].short) || (ITEM_CFG[k] && ITEM_CFG[k].short) || k; }
function handsText(o) { const h = invOf(o).hands; if (h[0] && h[0] === h[1]) return itemShort(h[0]) + ' (both hands)'; return h.map(x => x ? itemShort(x) : 'free').join(' + '); }
function offRole(o) { const t = o && o.team ? unit(o.team) : null; if (!t) return ''; const i = t.members.indexOf(o.id); return i === 0 ? 'Point' : i === 1 ? 'Defense' : 'Team #' + (i + 1); }
function offSpecs(o) { return [o.spec, o.spec2].filter((k, i, a) => k && a.indexOf(k) === i).map(k => SPECS[k] ? SPECS[k].name : k).join(' / '); }
/** "Point · Breacher · Hands: Shield + Pistol" — shown next to each name wherever the player picks an officer. */
function offTag(id) { const o = off(id) || S.officers.find(q => q.id === id); if (!o) return ''; return [offRole(o), offSpecs(o), 'Hands: ' + handsText(o)].filter(Boolean).join(' · '); }

/* ---------- item 11: voice-only call-out (no bullhorn, or no free hand for it) ---------- */
V20.voiceRange = 10; V20.voiceMul = 0.8;
/** A bullhorn someone on the team can actually work (one free-able hand). */
function bullhornUsable(u) { return !!u && u.kind === 'team' && teamOk(u).some(o => carries(o, 'bullhorn') && freeable(o) >= 1); }
/** Call Out without a usable bullhorn: a shouted call-out, heard ~10 m (from the voice to him). Same rules as the PA call-out, a little less authoritative. */
function voiceCallout(u, o) { const N = S.nego, sp = S.suspect, r = S.rng, C = NEGO_CFG.callout; N.attempts++;
  log(`${u.name} (voice): "POLICE! COME OUT WITH YOUR HANDS EMPTY!"`, 'radio');
  if (dist(u.x, u.y, sp.x, sp.y) > V20.voiceRange) { negHist('Voice call-out: no response — probably out of earshot (~10 m).', 'radio'); return; }
  let p = (C.base * (stypeCfg().calloutMul || 1) + sp.talk / 100 * C.talk + (S.gasActive && S.gas[idx(sp.x, sp.y)] > 0.2 ? C.gas : 0) - (sp.agit > C.agitHigh ? C.agitPen : 0)) * V20.voiceMul;
  if (S.contain.length && S.contain.some(c => !c.covered)) p *= C.contain; N.lastCallout = p;
  if (r.chance(p)) { negHist('Voice call-out: he shouts that he is coming out.', 'good'); walkout('callout'); return; }
  N.refusals++; sp.agit = clamp(sp.agit + C.agit, 0, 100);
  const f = r(); if (f < C.fire + sp.agit / 400) { negHist('Voice call-out refused — he answers with gunfire.', 'alert'); shoutReveal(u, true); if (hostile() && sp.cd === 0 && los(sp.x, sp.y, u.x, u.y)) suspectFire({ u, px: sp.x, py: sp.y, d: dist(sp.x, sp.y, u.x, u.y), l: los(sp.x, sp.y, u.x, u.y), cls: targetClass(u, sp.x, sp.y) }); }
  else if (f < C.fire + C.yell) { negHist('Voice call-out refused — he yells back.', 'radio'); shoutReveal(u, false); }
  else negHist('Voice call-out: no response.', 'radio'); }
/** The Call Out button: PA/bullhorn when possible, else a voice call-out. */
function calloutMode(u) { if (!u) return null; if (u.kind === 'cruiser' || u.inCar) return 'pa'; return bullhornUsable(u) ? 'pa' : 'voice'; }

/* ---------- item 12 (+ v21 item 21 groundwork): set kit down to throw; dropped items on the ground ---------- */
V20.pickR = 2;
/** Put a held shield / ram on the ground at the team's position (leaves an icon; anyone within 2 m can pick it up). */
function dropItem(offId, k) { const o = off(offId); if (!o) return { ok: false, reason: 'No officer' }; const inv = invOf(o); if (!holds(o, k)) return { ok: false, reason: 'Not in hand' };
  const u = S.units.find(t => t.kind === 'team' && t.members.includes(o.id)); if (!u || !u.deployed) return { ok: false, reason: 'Only on scene' };
  inv.hands = inv.hands.map(x => x === k ? null : x); if (!S.dropped) S.dropped = []; S.dropped.push({ k, x: u.x, y: u.y, by: o.id, turn: S.turn });
  syncEquip(u); log(`${o.name} sets the ${EQUIP[k] ? EQUIP[k].short : k} down on the ground.`, 'radio'); return { ok: true }; }
/** Dropped items a team can reach (within 2 m). */
function droppedNear(uid) { const u = unit(uid); if (!u || !S.dropped) return []; return S.dropped.map((d, i) => ({ ...d, i })).filter(d => dist(u.x, u.y, d.x, d.y) <= V20.pickR + 0.01); }
/** Pick a dropped item up: goes into the hands of the team member with the most free hands (a rifle is slung if needed). */
function pickUp(uid, i, offId) { const u = unit(uid), d = S.dropped && S.dropped[i]; if (!u || !d) return { ok: false, reason: 'Nothing there' };
  if (dist(u.x, u.y, d.x, d.y) > V20.pickR + 0.01) return { ok: false, reason: 'Too far — must be within 2 m' };
  const m = teamOk(u); const o = (offId != null && m.find(q => q.id === offId)) || m.slice().sort((a, b) => freeable(b) - freeable(a))[0]; if (!o) return { ok: false, reason: 'Nobody to carry it' };
  const inv = invOf(o); if (freeHands(o) < 1) { const st = autoStow(o, d.k); if (freeHands(o) < 1) { autoRedraw(o, st); return { ok: false, reason: `${o.name} has no free hand` }; } }
  const j = inv.hands.indexOf(null); inv.hands[j] = d.k; S.dropped.splice(i, 1); syncEquip(u); log(`${o.name} picks up the ${EQUIP[d.k] ? EQUIP[d.k].short : d.k}.`, 'radio'); return { ok: true, o }; }
/** No one able to throw (bang / gas): who could put everything away to do it. */
function throwPicks(uid, k) { const u = unit(uid); if (!u || u.kind !== 'team') return []; const m = teamOk(u); const carriers = m.filter(o => countOf(o, k) > 0);
  if (!carriers.length) return []; return m.map(o => ({ id: o.id, name: o.name, tag: offTag(o.id), has: countOf(o, k) > 0, setDown: invOf(o).hands.filter(x => x && !(ITEM_CFG[x] || {}).stow) })); }
/** Ready officer offId to throw k: anything that cannot be stowed is set down on the ground; a teammate hands over the device if needed. */
function prepThrower(uid, offId, k) { const u = unit(uid), o = off(offId); if (!u || !o || !u.members.includes(offId)) return { ok: false, reason: 'Not on this team' };
  for (const x of [...new Set(invOf(o).hands.filter(x => x && !(ITEM_CFG[x] || {}).stow))]) { const r = dropItem(offId, x); if (!r.ok) return r; }
  if (countOf(o, k) <= 0) { const g = teamOk(u).find(q => q !== o && countOf(q, k) > 0); if (!g) return { ok: false, reason: 'Nobody has one' };
    const gi = invOf(g); if ((gi.packed[k] || 0) > 0) gi.packed[k]--; else if ((gi.vest[k] || 0) > 0) gi.vest[k]--; else return { ok: false, reason: 'Cannot hand it over' };
    invOf(o).packed[k] = (invOf(o).packed[k] || 0) + 1; log(`${g.name} hands a ${EQUIP[k].short} to ${o.name}.`, 'radio'); }
  syncEquip(u); return { ok: true, o }; }

/* ---------- item 15: Draco tip devices (2 flashbangs, 4 CS) into the room the arm is in contact with ---------- */
function dracoTipOf(c) { if (c && c.draco && !c.dracoTip) c.dracoTip = { bang: DRACO_CFG.tip.bang, gas: DRACO_CFG.tip.gas }; return c && c.dracoTip; }
/** Which room the claw is in (arm in contact with a door or window right now), or a reason. */
function dracoTipInfo(c) { if (!c || !c.draco) return { reason: 'Needs the BearCat with the Draco arm installed' }; dracoTipOf(c); const a = c.dracoAt;
  if (!a) return { reason: 'Put the Draco arm into a door or window first (Draco Breach)' };
  const o = a.win != null ? { win: a.win } : { door: a.door }; if (!dracoContact(c, o)) return { reason: 'The arm is no longer in the opening (vehicle moved)' };
  const room = a.win != null ? S.windows[a.win].room : (S.doors[a.door].rooms || []).find(r => r != null && r >= 0);
  if (room == null) return { reason: 'No room behind that opening' }; return { room, name: S.rooms[room].known ? S.rooms[room].name : 'room', tip: c.dracoTip }; }
function dracoTipAct(c, o) { const t = dracoTipInfo(c); if (t.room == null) { log(`${c.name}: ${t.reason}.`, 'radio'); return; } const k = o.what === 'bang' ? 'bang' : 'gas';
  if (!(c.dracoTip[k] > 0)) { log(`${c.name}: none left in the Draco tip.`, 'radio'); return; } c.dracoTip[k]--; const tc = roomTargetCell(t.room);
  if (k === 'bang') { fx('flash', tc[0], tc[1], { fromX: c.x, fromY: c.y }); noise(tc[0], tc[1], 10, 'bang'); log(`${c.name}: BANG OUT — flashbang from the Draco tip into ${t.name} (${c.dracoTip.bang} left).`, 'radio');
    let nb = 0; eachSp(sp => { if (sp.room === t.room && hostile()) { sp.stun = 5; sp.stunBy = null; sp.daze = FIRE_CFG.bangDaze; sp.ambush = false; nb++; } });
    if (nb) log(nb > 1 ? `${nb} suspects disoriented by flashbang.` : 'Suspect disoriented by flashbang.', 'good'); encMarkDev({ type: 'bang' }); aggressive(10); }
  else { gasDeploy(t.room, 1.1); fx('gas', tc[0], tc[1], { room: t.room, fromX: c.x, fromY: c.y }); log(`${c.name}: CS canister from the Draco tip into ${t.name} (${c.dracoTip.gas} left).`, 'radio'); encMarkDev({ type: 'gas' }); aggressive(15); } }

/* ---------- item 13: BearCat arrives at a random time during the call-out, with its own driver ---------- */
V20.bcDelay = true;
/** Take the BearCat off the scene until a random turn within the call-out (between the first and last officer ETA). */
function bcSchedule() { const c = bearcat(); if (!c || !V20.bcDelay) return; const q = makeRng((S.seed * 433 + 71) >>> 0);
  const etas = S.officers.map(o => o.eta || 0), mx = Math.max(2, ...etas); const t = q.int(1, mx);
  S.bcPending = { unit: c, turn: t }; S.units = S.units.filter(u => u !== c); rebuildDyn(); }
/** Bring the BearCat in now (next to primary staging, as generated). */
function bcArriveNow() { const P = S.bcPending; if (!P) return bearcat(); S.bcPending = null; const c = P.unit;
  if (carClash(c.x, c.y, c.uid)) { const X = S.ext; for (let d = 4; d < 26; d++) { let ok = false; for (const dx of [-d, d]) { const x = X.staging.x + dx, y = S.geo.ST + 4; if (S.drive[idx(x, y)] && !carClash(x, y, null)) { c.x = x; c.y = y; ok = true; break; } } if (ok) break; } }
  S.units.push(c); rebuildDyn(); log(`PAGER: BearCat on scene next to primary staging — its driver stays with it (room for 11 in the back).`, 'pager'); S.events.push({ type: 'pager' }); return c; }
function endTurn() { endTurnBase(); if (S.bcPending && S.turn >= S.bcPending.turn && S.phase !== 'over') bcArriveNow(); }

/* ---------- item 17: rounds per 30-second turn by weapon action ---------- */
const FIRE_RATE = { pistol: 5, rifle: 5, sniper: 1, lesslethal: 1, handgun: 5, shotgun: 1, hrifle: 1, auto: 10 }; // pump / bolt 1 · semi-auto 5 · full-auto 10
V20.autoClose = 2; V20.autoFar = 0.4;
/** Full-auto: much less accurate except at extremely close range (≤ 2 m). */
function autoAcc(w, d) { return (SUSPECT_WEAPONS[w] || {}).auto ? (d <= V20.autoClose ? 1 : V20.autoFar) : 1; }
function fireRate(k, suspect) { return suspect ? (k === 'rifle' ? FIRE_RATE.hrifle : FIRE_RATE[k] || 5) : FIRE_RATE[k] || 5; }
function shotsUsed(key) { if (!S.shotsT || S.shotsT.turn !== S.turn) S.shotsT = { turn: S.turn, m: {} }; return S.shotsT.m[key] || 0; }
function shotSpend(key) { shotsUsed(key); S.shotsT.m[key] = (S.shotsT.m[key] || 0) + 1; }
/** Rounds this unit / suspect may still fire this turn. */
function shotsLeft(u) { const k = weaponOf(u) || 'pistol'; return Math.max(0, fireRate(k) - shotsUsed(u.uid)); }
function fireAt(u, tx, ty, mode, isReturn) { const k = weaponOf(u) || 'pistol'; if (shotsUsed(u.uid) >= fireRate(k)) { if (!isReturn) log(`${u.name}: ${WEAPONS[k] ? String(WEAPONS[k].short || WEAPONS[k].name).toLowerCase() : k} — no more aimed rounds this turn (${fireRate(k)} per 30 s).`); return 'empty'; }
  shotSpend(u.uid); return fireAtBase(u, tx, ty, mode, isReturn); }
function suspectFire(b) { const sp = S.suspect, key = 'sp:' + (sp.key || 'S'); if (shotsUsed(key) >= fireRate(sp.weapon, true)) return; shotSpend(key);
  const r = suspectFireBase(b); if ((SUSPECT_WEAPONS[sp.weapon] || {}).auto && sp.cd > 0) sp.cd = 0; return r; }

/* ---------- item 6: inside a house every member stays within 2 m of the nearest teammate, on the same wall where possible ---------- */
V20.formMax = 2; V20.formMin = 0.6;
function wallSpots(u, n) { const r = roomAt(u.x, u.y), rad = FORM_CFG.wallRad, W = 0.5 - FORM_CFG.wallIn, c = [];
  for (let y = u.y - 4; y <= u.y + 4; y++) for (let x = u.x - 4; x <= u.x + 4; x++) { if (!inb(x, y) || roomAt(x, y) !== r || S.block[idx(x, y)] || dist(x, y, u.x, u.y) > rad) continue;
    if (!(x === u.x && y === u.y) && los(u.x, u.y, x, y) !== 1) continue;
    let ox = 0, oy = 0; const ws = []; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (!inb(nx, ny) || roomAt(nx, ny) !== r) { ox += dx * W; oy += dy * W; ws.push(dx ? `x${dx}:${x}` : `y${dy}:${y}`); } }
    if (!ws.length) continue; c.push({ ox: x - u.x + ox, oy: y - u.y + oy, walls: ws.length, ws, d: dist(x, y, u.x, u.y) }); }
  if (c.length < Math.min(n, 2)) return null;
  const bx = -Math.cos(u.dir || 0), by = -Math.sin(u.dir || 0), pick = [], D = (p, q) => Math.hypot(p.ox - q.ox, p.oy - q.oy);
  c.sort((a, b) => (a.d - (a.ox * bx + a.oy * by) * 0.3 - a.walls * 0.1) - (b.d - (b.ox * bx + b.oy * by) * 0.3 - b.walls * 0.1)); pick.push(c[0]);
  const wallOf = new Map(); for (const w of c[0].ws) wallOf.set(w, (S.rooms[r] ? 1 : 1)); // the point man's wall(s)
  while (pick.length < n) { let best = null, bs = -1e9;
    for (const q of c) { if (pick.includes(q)) continue; const m = Math.min(...pick.map(p => D(p, q)));
      const same = q.ws.some(w => wallOf.has(w)), s = (m <= V20.formMax ? 10 : -m * 3) + (same ? 4 : 0) - Math.abs(m - 0.9) - (m < V20.formMin ? 6 : 0) - q.d * 0.05;
      if (s > bs) { bs = s; best = q; } }
    if (!best) best = doubleUp(u, r, pick, c) || (() => { const p = pick[pick.length - 1]; return { ox: p.ox * 0.9, oy: p.oy * 0.9, ws: [] }; })();
    else { const near = q => Math.min(...pick.map(p => D(p, q)));
      if (near(best) > V20.formMax) { /* no wall spot within 2 m: take the closest free wall spot, else double up along the wall next to a teammate */
        let alt = null, am = 1e9; for (const q of c) { if (pick.includes(q)) continue; const m = near(q); if (m < am) { am = m; alt = q; } }
        if (alt && am <= V20.formMax) best = alt; else best = doubleUp(u, r, pick, c) || alt || best; } }
    pick.push(best); }
  return pick.map(p => [+p.ox.toFixed(2), +p.oy.toFixed(2)]); }
/** A wall-hugging spot ~0.5 m along the wall from a placed teammate (same cell side), staying inside the room. */
function doubleUp(u, r, pick, c) { for (const p of pick) { if (!p.ws || !p.ws.length) continue;
    for (const s of [0.5, -0.5, 0.45, -0.45]) { const alongX = /^y/.test(p.ws[0]); const ox = p.ox + (alongX ? s : 0), oy = p.oy + (alongX ? 0 : s);
      const cx = Math.round(u.x + ox), cy = Math.round(u.y + oy); if (!inb(cx, cy) || roomAt(cx, cy) !== r || S.block[idx(cx, cy)]) continue;
      if (pick.some(q => Math.hypot(q.ox - ox, q.oy - oy) < 0.4)) continue;
      const fx = u.x + ox - cx, fy = u.y + oy - cy, ok = (fx >= 0.25 && roomAt(cx + 1, cy) !== r) || (fx <= -0.25 && roomAt(cx - 1, cy) !== r) || (fy >= 0.25 && roomAt(cx, cy + 1) !== r) || (fy <= -0.25 && roomAt(cx, cy - 1) !== r);
      if (ok) return { ox, oy, ws: p.ws, dbl: true }; } } return null; }
/** Largest nearest-teammate gap (m) in a formation — used by tests and the help text. */
function formGap(pts) { let g = 0; for (let i = 0; i < pts.length; i++) { let m = 1e9; for (let j = 0; j < pts.length; j++) if (i !== j) m = Math.min(m, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])); if (pts.length > 1) g = Math.max(g, m); } return g; }
/* ===================== v21 (batch 2: items 18-25) =====================
   18 shield / 40mm officers leave the rifle at the vehicle (slung rifle = -10% for them) · 19 plates are worn, never "taken"
   20 personal flashbang (max 3 each), pole cam carried one-handed but worked two-handed · 21 drop shield / ram
   22 breacher wall charges (through-wall hole, viewport) · 23 40mm / shotgun vs security cameras
   24 suspects vs drones (much harder) and robots (like a person in the open) · 25 K9 handler: send the dog, door sniff */
const V21 = { rifleMul: 0.9, bangMax: 3, wallP: 0.9, portP: 0.9, wallR: 1.5, camRange: 30, camNear: 0.22, camFar: 0.08, droneMul: 0.22, droneMax: 0.15,
  dogRange: 25, sniffP: 0.75, sniffR: 2, dogHold: 0.55, dogHit: 0.25 };
/* ---------- 18 / 20: personal kit ---------- */
function rifleLeaver(o) { const h = (o.inv && o.inv.home) || takeHomeList(o); return ['shield', 'shield3', 'lesslethal'].some(k => h.includes(k) || o.inv && carries(o, k)); }
function takeHome(o, inv) { takeHomeBase(o, inv);
  if (rifleLeaver(Object.assign({}, o, { inv }))) { inv.slung = inv.slung.filter(x => x !== 'rifle'); inv.hands = inv.hands.map(x => x === 'rifle' ? null : x); inv.rifleLeft = true;
    if (inv.home.includes('lesslethal') && !inv.hands.some(Boolean)) { inv.slung = inv.slung.filter(x => x !== 'lesslethal'); inv.hands = ['lesslethal', 'lesslethal']; } // the 40mm officer works the launcher
    if (!inv.hands.some(Boolean)) { inv.holster = inv.holster.filter(x => x !== 'pistol'); inv.hands = ['pistol', null]; } }
  inv.packed.bang = (inv.packed.bang || 0) + 1; inv.ownBang = 1; }
/** A shield / 40mm officer who still carries a rifle works at 90%. */
function rifleBurden(o) { return !!(rifleLeaver(o) && carries(o, 'rifle')); }
function offSkill(o) { return o.skill * (rifleBurden(o) ? V21.rifleMul : 1); }
function teamSkill(t) { const m = teamOk(t); if (!m.length) return 0; let s = m.reduce((a, o) => a + offSkill(o), 0) / m.length; if (hasSpec(t, 'leader')) s += 0.05; return clamp(s, 0, 1); }
function invAct21(offId, act, k) { const o = off(offId); if (!o) return invAct19(offId, act, k); const inv = invOf(o), t = o.team ? unit(o.team) : null;
  const atEq = () => { const [x, y] = offPos(o); return atEquipment(x, y); }, done = r => { if (t) syncEquip(t); S.version++; return Object.assign({ ok: true }, r || {}); };
  if (k === 'rifle' && act === 'draw') { if (S.phase !== 'planning') return { ok: false, reason: 'Change loadout during planning' }; if (carries(o, 'rifle')) return { ok: false, reason: 'Already carries a rifle' };
    if (!atEq()) return { ok: false, reason: 'The rifle was left at the equipment vehicle (primary staging)' };
    inv.slung.push('rifle'); inv.rifleLeft = false; setNotReady(o, 'rifle'); return done({ notReady: 'rifle' }); }
  if (k === 'rifle' && act === 'return') { if (S.phase !== 'planning') return { ok: false, reason: 'Change loadout during planning' }; if (!carries(o, 'rifle')) return { ok: false, reason: 'No rifle' };
    if (!atEq()) return { ok: false, reason: 'The rifle can only be left at the equipment vehicle (primary staging)' };
    inv.slung = inv.slung.filter(x => x !== 'rifle'); if (holds(o, 'rifle')) { inv.hands = inv.hands.map(x => x === 'rifle' ? null : x); if (!inv.hands.some(Boolean) && inv.holster.includes('pistol')) { inv.holster = inv.holster.filter(x => x !== 'pistol'); inv.hands = ['pistol', null]; } }
    inv.rifleLeft = true; return done(); }
  if (k === 'bang' && act === 'draw' && countOf(o, 'bang') >= V21.bangMax) return { ok: false, reason: `Flashbangs: ${V21.bangMax} per officer at most` };
  if (k === 'bang' && act === 'return' && countOf(o, 'bang') <= (inv.ownBang || 0)) return { ok: false, reason: 'The personal flashbang stays with the officer' };
  const r = invAct19(offId, act, k);
  if (false && r.ok && act === 'draw' && carries(o, 'rifle')) /* v22: see f7 invAct */ { const q = invAct(offId, 'return', 'rifle'); if (q.ok) { r.rifleLeft = true; log(`${o.name} leaves the rifle at the equipment vehicle (${EQUIP[k] ? EQUIP[k].short : k} officer).`, 'radio'); } }
  return r; }
/** 20: the pole cam is carried in one hand but worked with both — the operator's weapon is put away and NOT READY next turn. Returns the operator or null. */
function polecamHands(u) { const m = teamOk(u); const o = m.find(q => carries(q, 'polecam') && freeable(q) >= 2) || m.find(q => freeable(q) >= 2); if (!o) return null;
  const st = autoStow(o, 'polecam'); for (const k of st) setNotReady(o, k); autoRedraw(o, st); return o; }
/* ---------- 21: drop a shield / ram (icon on the map; pick up within 2 m) ---------- */
function droppable(o) { return [...new Set(invOf(o).hands.filter(x => x && /^(shield|shield3|ram)$/.test(x)))]; }
function dropList(uid) { const u = unit(uid); if (!u || u.kind !== 'team') return []; const out = []; for (const o of teamOk(u)) for (const k of droppable(o)) out.push({ id: o.id, name: o.name, k }); return out; }
/* ---------- 22: breacher wall charges ---------- */
const WALL_DIRS = [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']];
function wallEdgeOk(ax, ay, bx, by) { if (!inb(ax, ay) || !inb(bx, by)) return false; const ra = roomAt(ax, ay), rb = roomAt(bx, by); if (ra === rb || (ra < 0 && rb < 0)) return false;
  const e = edge(ax, ay, bx, by); return e.t === 'X' && !S.block[idx(bx, by)] && !S.block[idx(ax, ay)]; }
/** Walls a team can charge: 4-way wall edges from a cell within 1.5 m of the team (same room / outside). */
function wallSpotsFor(uid) { const u = unit(uid); if (!u || u.kind !== 'team' || !u.deployed) return []; const r0 = roomAt(u.x, u.y), out = [], seen = new Set();
  for (let y = u.y - 1; y <= u.y + 1; y++) for (let x = u.x - 1; x <= u.x + 1; x++) { if (!inb(x, y) || dist(x, y, u.x, u.y) > V21.wallR || roomAt(x, y) !== r0 || S.block[idx(x, y)]) continue;
    for (const [dx, dy, nm] of WALL_DIRS) { const nx = x + dx, ny = y + dy; if (!wallEdgeOk(x, y, nx, ny)) continue; const k = ek(x, y, nx, ny); if (seen.has(k)) continue; seen.add(k);
      const rb = roomAt(nx, ny); out.push({ a: [x, y], b: [nx, ny], dir: nm, key: k, to: rb >= 0 ? S.rooms[rb].name : 'outside', d: dist(x, y, u.x, u.y) }); } }
  const best = new Map(); for (const w of out.sort((p, q) => p.d - q.d)) if (!best.has(w.dir + w.to)) best.set(w.dir + w.to, w); return [...best.values()].slice(0, 4); }
function wallBlast(u, x, y, rb) { noise(x, y, 14, 'blast'); fx('text', x, y, { text: 'BANG', color: '#ffd34d' }); if (hostile()) aggressive(4);
  eachSp(sp => { if (spActive(sp) && rb >= 0 && sp.room === rb) { sp.stun = Math.max(sp.stun || 0, 1); sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn }; } }); }
/** kind 'hole' (through-wall: an opening that works like an open door) or 'port' (viewport: a chosen member can shoot through). */
function wallCharge(uid, kind, i) { const u = unit(uid); if (!u || u.kind !== 'team') return { ok: false, reason: 'No team' }; if (S.phase !== 'planning') return { ok: false, reason: 'Set charges during planning' };
  if (!hasSpec(u, 'breacher')) return { ok: false, reason: 'Only a breacher can set a wall charge' }; if (!(u.equip.charge > 0)) return { ok: false, reason: 'No breaching charge on the team — draw one at the equipment vehicle' };
  const w = wallSpotsFor(uid)[i || 0]; if (!w) return { ok: false, reason: 'Stand within 1.5 m of a wall' };
  const o = useItem(u, 'charge'); const [ax, ay] = w.a, [bx, by] = w.b, rb = roomAt(bx, by) >= 0 ? roomAt(bx, by) : roomAt(ax, ay);
  wallBlast(u, bx, by, rb); if (!S.wallLog) S.wallLog = [];
  if (!S.rng.chance(kind === 'port' ? V21.portP : V21.wallP)) { log(`${u.name}: ${o ? o.name : 'breacher'} fires the ${kind === 'port' ? 'gun-port' : 'wall'} charge on the ${w.dir} wall — the wall holds (no opening).`, 'alert'); S.wallLog.push({ kind, ok: false, turn: S.turn }); S.version++; return { ok: true, made: false }; }
  if (kind === 'port') { const p = { id: (S.ports || (S.ports = [])).length, a: w.a, b: w.b, key: w.key, to: w.to, team: u.uid, turn: S.turn }; S.ports.push(p); S.edges.set(w.key, { t: 'P', port: p });
    log(`${u.name}: viewport blown through the ${w.dir} wall into the ${w.to} — one officer can fire through it.`, 'radio'); S.wallLog.push({ kind, ok: true, turn: S.turn }); S.version++; return { ok: true, made: true, port: p }; }
  const ra = roomAt(ax, ay), d = { id: S.doors.length, cells: [[[ax, ay], [bx, by]]], state: 'open', locked: false, barricaded: false, exterior: ra < 0 || roomAt(bx, by) < 0, kind: 'hole', hole: true, name: `Wall breach (${w.to})`, known: true, storm: false, stormState: 'open', stormKnown: true, charge: null, rooms: [ra, roomAt(bx, by)] };
  S.doors.push(d); S.edges.set(w.key, { t: 'D', d }); if (S.peek) S.peek.push(idx(bx, by));
  log(`${u.name}: wall charge — a hole through the ${w.dir} wall into the ${w.to}. It works like an open doorway.`, 'radio'); S.wallLog.push({ kind, ok: true, turn: S.turn }); S.version++; return { ok: true, made: true, door: d }; }
function portsNear(uid) { const u = unit(uid); if (!u || !S.ports) return []; return S.ports.filter(p => dist(u.x, u.y, p.a[0], p.a[1]) <= V21.wallR + 0.01); }
/** A chosen member fires through a viewport (the team's per-turn rate of fire applies). */
function portFire(uid, pid, offId) { const u = unit(uid), p = S.ports && S.ports[pid], o = off(offId); if (!u || !p || !o || !u.members.includes(offId) || !teamOk(u).includes(o)) return { ok: false, reason: 'Pick a team member' };
  if (dist(u.x, u.y, p.a[0], p.a[1]) > V21.wallR + 0.01) return { ok: false, reason: 'Too far from the viewport' };
  const sp = S.suspect, ox = u.x, oy = u.y, e = S.edges.get(p.key); u.x = p.a[0]; u.y = p.a[1]; S.edges.set(p.key, E_OPEN); let r;
  try { log(`${o.name} fires through the viewport into the ${p.to}.`, 'radio'); r = fireAt(u, sp.x, sp.y, 'aimed'); } finally { S.edges.set(p.key, e); u.x = ox; u.y = oy; }
  S.version++; return { ok: true, r }; }
/* ---------- 23: 40mm / shotgun vs security cameras (hard to hit) ---------- */
function camSees(c, x, y) { return !c.dead && camSeesBase(c, x, y); }
function camShooter(u) { return teamOk(u).find(o => usableCount(o, 'lesslethal') > 0 || holds(o, 'shotgun')) || null; }
function camTargets(uid) { const u = unit(uid); if (!u || u.kind !== 'team' || !u.deployed || !S.cams) return []; if (!camShooter(u)) return [];
  return S.cams.filter(c => !c.dead && dist(u.x, u.y, c.x, c.y) <= V21.camRange && los(u.x, u.y, c.x, c.y) === 1).map(c => ({ id: c.id, name: c.name, d: dist(u.x, u.y, c.x, c.y), p: camHitP(dist(u.x, u.y, c.x, c.y)) })); }
function camHitP(d) { return clamp(V21.camNear - (V21.camNear - V21.camFar) * d / V21.camRange, V21.camFar, V21.camNear); }
function shootCam(uid, cid) { const u = unit(uid), c = S.cams && S.cams.find(q => q.id === cid); if (!u || !c) return { ok: false, reason: 'No camera' };
  if (!camTargets(uid).some(t => t.id === cid)) return { ok: false, reason: 'Needs a 40mm launcher or shotgun, a clear line and ≤ 30 m' };
  const o = camShooter(u), d = dist(u.x, u.y, c.x, c.y); if (usableCount(o, 'lesslethal') > 0) useItem(u, 'lesslethal', q => q === o);
  noise(u.x, u.y, 8, 'shot'); fx('shot', u.x, u.y, { tx: c.x, ty: c.y, friendly: true });
  if (S.rng.chance(camHitP(d))) { c.dead = true; log(`${o.name}: the camera at the ${c.name} is knocked out.`, 'good'); }
  else log(`${o.name}: round at the camera at the ${c.name} — missed (small target).`, 'radio');
  syncEquip(u); S.version++; return { ok: true, hit: !!c.dead }; }
/* ---------- 24: suspect fire at devices ---------- */
/** Hit chance on a drone (much harder) or a robot (like a person in the open: p = his normal aimed chance). */
function deviceHitP(T, p) { const q = clamp(p, 0.03, 0.6); return T.kind === 'drone' && !T.landed ? Math.min(V21.droneMax, q * V21.droneMul) : q; }
/* ---------- 25: K9 ---------- */
function k9Of(u) { return u && u.kind === 'team' ? teamOk(u).find(o => o.spec === 'k9' && o.dog && !o.dogOut) || null : null; }
function dogReach(u, x, y) { if (dist(u.x, u.y, x, y) > V21.dogRange) return null; return findPath(u.x, u.y, (px, py) => px === x && py === y, {}); }
/** Rooms the dog can be sent into right now (≤ 25 m, reachable through open doors / openings). */
function dogTargets(uid) { const u = unit(uid), h = k9Of(u); if (!h || !u.deployed) return []; const out = [];
  S.rooms.forEach((r, i) => { const cx = r.x + Math.floor(r.w / 2), cy = r.y + Math.floor(r.h / 2); const c = [[cx, cy]].concat([[r.x, r.y], [r.x + r.w - 1, r.y + r.h - 1]]).find(([x, y]) => !S.block[idx(x, y)]);
    if (!c || dist(u.x, u.y, c[0], c[1]) > V21.dogRange) return; const p = dogReach(u, c[0], c[1]); if (p) out.push({ room: i, name: r.name, x: c[0], y: c[1], d: p.length }); });
  return out.sort((a, b) => a.d - b.d); }
function dogSend(uid, room) { const u = unit(uid), h = k9Of(u); if (!h) return { ok: false, reason: 'No K9 handler with a dog on this team' }; if (S.phase !== 'planning') return { ok: false, reason: 'Send the dog during planning' };
  if (h.dogTurn === S.turn) return { ok: false, reason: `${h.dog} already worked this turn` };
  const t = dogTargets(uid).find(q => q.room === room); if (!t) return { ok: false, reason: 'The dog can only be sent within 25 m through an open way' };
  h.dogTurn = S.turn; const here = suspList().filter(s => spActive(s) && s.room === room && s.mode !== 'detained'); S.version++;
  if (!here.length) { log(`${h.name}: ${h.dog} searches the ${t.name} — no indication.`, 'intel'); return { ok: true, found: false }; }
  const sp = here[0]; sp.heat = { room, x: sp.x, y: sp.y, turn: S.turn }; sp.lastKnown = { x: sp.x, y: sp.y, turn: S.turn }; S.intel.located = true; noise(sp.x, sp.y, 10, 'dog');
  log(`${h.name}: ${h.dog} is barking in the ${t.name} — suspect located.`, 'alert');
  let held = false; withSp(sp, () => { if (sp.mode === 'surrendered' || sp.mode === 'incapacitated') return;
    if (S.rng.chance(V21.dogHold)) { held = true; sp.stun = Math.max(sp.stun || 0, 2); sp.daze = Math.max(sp.daze || 0, 2); log(`${h.dog} engages and holds the suspect (bite hold) — move in now.`, 'good'); }
    else if (hostile() && spArmed(sp) && S.rng.chance(V21.dogHit)) { h.dogOut = true; log(`${h.dog} is hurt and recalled by ${h.name} — out of action.`, 'bad'); }
    else log(`${h.dog} keeps barking; the suspect backs away.`, 'radio'); if (hostile()) aggressive(4); });
  return { ok: true, found: true, held }; }
/** Door sniff: within 2 m of a door, 75% to detect a suspect in the room beyond (no false alerts). */
function sniffDoors(uid) { const u = unit(uid); if (!k9Of(u) || !u.deployed) return []; return S.doors.filter(d => d.cells.some(([a, b]) => Math.min(dist(u.x, u.y, a[0], a[1]), dist(u.x, u.y, b[0], b[1])) <= V21.sniffR + 0.01)); }
function dogSniff(uid, doorId) { const u = unit(uid), h = k9Of(u), d = S.doors[doorId]; if (!h) return { ok: false, reason: 'No K9 handler with a dog on this team' }; if (!d || !sniffDoors(uid).includes(d)) return { ok: false, reason: 'Get within 2 m of the door' };
  if (h.sniffTurn === S.turn && h.sniffDoor === doorId) return { ok: false, reason: 'Already sniffed this door this turn' }; h.sniffTurn = S.turn; h.sniffDoor = doorId;
  const [[a, b]] = d.cells, near = dist(u.x, u.y, a[0], a[1]) <= dist(u.x, u.y, b[0], b[1]) ? a : b, far = near === a ? b : a, rr = roomAt(far[0], far[1]);
  const sp = suspList().find(s => spActive(s) && s.mode !== 'detained' && rr >= 0 && s.room === rr); S.version++;
  if (sp && S.rng.chance(V21.sniffP)) { sp.heat = { room: rr, x: sp.x, y: sp.y, turn: S.turn }; S.intel.located = true; noise(near[0], near[1], 6, 'dog');
    log(`${h.name}: ${h.dog} alerts at the ${d.name} and barks — someone is in the ${S.rooms[rr].name}.`, 'alert'); return { ok: true, found: true }; }
  log(`${h.name}: ${h.dog} sniffs the ${d.name} — no indication.`, 'intel'); return { ok: true, found: false }; }
/** One list of the v21 on-the-spot actions for the team dialog. */
function v21Actions(uid) { const u = unit(uid); if (!u || u.kind !== 'team') return [];
  const out = [], plan = S.phase === 'planning';
  dropList(uid).forEach(q => out.push({ act: 'drop', a: q.id, b: q.k, icon: /shield/.test(q.k) ? '⛨' : '⚒', label: `Drop ${EQUIP[q.k] ? EQUIP[q.k].short : q.k} (${q.name})`, on: !!u.deployed }));
  if (hasSpec(u, 'breacher') && u.equip.charge > 0) wallSpotsFor(uid).forEach((w, i) => { out.push({ act: 'hole', a: i, icon: '💥', label: `Wall charge: hole (${w.dir} → ${w.to})`, on: plan }); out.push({ act: 'port', a: i, icon: '◎', label: `Viewport (${w.dir} → ${w.to})`, on: plan }); });
  portsNear(uid).forEach(p => teamOk(u).slice(0, 4).forEach(o => out.push({ act: 'pfire', a: p.id, b: o.id, icon: '➹', label: `Fire through port: ${o.name}`, on: plan && shotsLeft(u) > 0 })));
  camTargets(uid).forEach(c => out.push({ act: 'cam', a: c.id, icon: '📷', label: `Shoot camera (${c.name}, ${Math.round(c.p * 100)}%)`, on: plan }));
  if (k9Of(u)) { dogTargets(uid).slice(0, 6).forEach(t => out.push({ act: 'dog', a: t.room, icon: '🐾', label: `Send ${k9Of(u).dog}: ${t.name}`, on: plan })); sniffDoors(uid).forEach(d => out.push({ act: 'sniff', a: d.id, icon: '👃', label: `Door sniff: ${d.name}`, on: plan })); }
  return out; }
function v21Do21(uid, act, a, b) { if (act === 'drop') return dropItem(a, b); if (act === 'hole' || act === 'port') return wallCharge(uid, act, +a); if (act === 'pfire') return portFire(uid, +a, b);
  if (act === 'cam') return shootCam(uid, +a); if (act === 'dog') return dogSend(uid, +a); if (act === 'sniff') return dogSniff(uid, +a); return { ok: false, reason: 'Unknown action' }; }
SPECS.k9.desc = 'Handler and dog (no second specialty). Passive: the dog indicates a suspect within 5 m through walls. Send the dog into a room up to 25 m away through an open way (barks, may hold the suspect), or sniff a door (75% to detect)';
/* ===================== v22: rifle pools, pole-cam feed, hung wall charges, suspect cars ===================== */
const V22 = { rifleMul: 0.93, pcRange: 9, pcDetect: 0.035, pcDetectTape: 0.025, pcShootDoor: 0.22, pcShootCam: 0.5 };
V21.rifleMul = V22.rifleMul; // the old 10% rule becomes a 7% sling debuff
/* ---------- 1: every officer arrives with a rifle; non-slingable hand gear (shield / ram) leaves it in the zone's pool ---------- */
const NON_SLING = ['shield', 'shield3', 'ram'];
function handGearOf(o) { return NON_SLING.filter(k => carries(o, k)); }
function rifleLeaver(o) { const h = (o.inv && o.inv.home) || takeHomeList(o); return NON_SLING.some(k => h.includes(k) || (o.inv && carries(o, k))); }
function takeHome(o, inv) { takeHomeBase(o, inv);
  if (NON_SLING.some(k => inv.home.includes(k))) { inv.slung = inv.slung.filter(x => x !== 'rifle'); inv.hands = inv.hands.map(x => x === 'rifle' ? null : x); inv.rifleLeft = true;
    if (!inv.hands.some(Boolean)) { inv.holster = inv.holster.filter(x => x !== 'pistol'); inv.hands = ['pistol', null]; } }
  else if (inv.home.includes('lesslethal')) { inv.slung = inv.slung.filter(x => x !== 'lesslethal'); if (inv.hands.includes('rifle') && !inv.slung.includes('rifle')) inv.slung.push('rifle');
    inv.hands = ['lesslethal', 'lesslethal']; } // the 40mm officer works the launcher; his rifle stays slung (slingable kit: no debuff)
  inv.packed.bang = (inv.packed.bang || 0) + 1; inv.ownBang = 1; }
/** A slung rifle on top of a shield / ram costs 7%. */
function rifleBurden(o) { return !!(handGearOf(o).length && carries(o, 'rifle')); }
/** Which staging pool holds the officer's rifle (the zone he deployed from, unless he left it at the other one). */
function rifleZone(o) { const inv = invOf(o); return inv.rifleAt || o.stage || 'primary'; }
function rifleHere(o) { const [x, y] = offPos(o), z = stagePos(rifleZone(o)); return !!z && dist(x, y, z.x, z.y) <= INV_CFG.drawRange; }
function nearZone(o) { const [x, y] = offPos(o); for (const z of ['primary', 'secondary']) { const p = z === 'secondary' ? S.ext.staging2 : S.ext.staging; if (p && dist(x, y, p.x, p.y) <= INV_CFG.drawRange) return z; } return null; }
function zoneName(z) { return z === 'secondary' ? 'secondary staging' : 'the equipment vehicle (primary staging)'; }
function invAct(offId, act, k) { const o = off(offId); if (!o || k !== 'rifle' || (act !== 'draw' && act !== 'return')) {
    // v22: drawing hand gear that cannot be slung (shield / ram) puts the rifle in the staging pool first
    if (o && act === 'draw' && NON_SLING.includes(k) && carries(o, 'rifle') && S.phase === 'planning' && nearZone(o)) { const q = invAct(offId, 'return', 'rifle'); const r = invAct21(offId, act, k);
      if (!r.ok) { if (q.ok) invAct(offId, 'draw', 'rifle'); return r; }
      if (q.ok) { r.rifleLeft = true; log(`${o.name} puts the rifle in the ${zoneName(rifleZone(o))} pool (${EQUIP[k] ? EQUIP[k].short : k} in hand).`, 'radio'); } return r; }
    return invAct21(offId, act, k); }
  const inv = invOf(o), t = o.team ? unit(o.team) : null, done = r => { if (t) syncEquip(t); S.version++; return Object.assign({ ok: true }, r || {}); };
  if (S.phase !== 'planning') return { ok: false, reason: 'Change loadout during planning' };
  if (act === 'draw') { if (carries(o, 'rifle')) return { ok: false, reason: 'Already carries a rifle' };
    if (!rifleHere(o)) return { ok: false, reason: `The rifle is in the pool at ${zoneName(rifleZone(o))}` };
    inv.slung.push('rifle'); inv.rifleLeft = false; setNotReady(o, 'rifle'); return done({ notReady: 'rifle', burden: rifleBurden(o) }); }
  if (!carries(o, 'rifle')) return { ok: false, reason: 'No rifle' }; const z = nearZone(o); if (!z) return { ok: false, reason: 'The rifle can only be left in a staging pool (primary or secondary staging)' };
  inv.slung = inv.slung.filter(x => x !== 'rifle'); if (holds(o, 'rifle')) { inv.hands = inv.hands.map(x => x === 'rifle' ? null : x); if (!inv.hands.some(Boolean) && inv.holster.includes('pistol')) { inv.holster = inv.holster.filter(x => x !== 'pistol'); inv.hands = ['pistol', null]; } }
  inv.rifleLeft = true; inv.rifleAt = z; return done(); }

/* ---------- 4: pole cam — a live feed from just inside the door ---------- */
function pcamCells(other, rr) { const out = []; if (rr < 0) return out; const rm = S.rooms[rr];
  for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) if (roomAt(x, y) === rr && dist(x, y, other[0], other[1]) <= V22.pcRange && (x === other[0] && y === other[1] || los(other[0], other[1], x, y))) out.push(idx(x, y));
  return out; }
function pcamStart(u, d, other, pc) { const rr = roomAt(other[0], other[1]); if (!S.pcams) S.pcams = [];
  S.pcams = S.pcams.filter(p => !(p.team === u.uid && !p.tape)); const side = [u.x, u.y];
  const p = { id: (S.pcSeq = (S.pcSeq || 0) + 1), team: u.uid, door: d.id, side, other, room: rr, tape: false, dead: false, by: pc.name, turn: S.turn, cells: pcamCells(other, rr) };
  S.pcams.push(p); for (const c of p.cells) S.peek.push(c); return p; }
function pcamLive(p) { if (p.dead) return false; const d = S.doors[p.door]; if (!d || d.state !== 'closed') return false;
  if (p.tape) return true; const u = unit(p.team); return !!u && unitAlive(u) && u.deployed && u.x === p.side[0] && u.y === p.side[1]; }
function pcamPrune() { if (!S.pcams) return; for (const p of S.pcams) if (!p.dead && !pcamLive(p)) { p.dead = true; p.ended = S.doors[p.door] && S.doors[p.door].state !== 'closed' ? 'breached' : 'moved'; } S.pcams = S.pcams.filter(p => !p.dead); }
function pcamVision() { if (!S.pcams || !S.pcams.length) return; pcamPrune(); for (const p of S.pcams) for (const c of p.cells) S.vis[c] = 1; }
/** A viewport is a small hole: a team standing at it sees into the room beyond (and can fire through it). */
function portVision() { for (const p of S.ports || []) { const rb = roomAt(p.b[0], p.b[1]); if (rb < 0) continue;
  if (!S.units.some(u => u.kind === 'team' && u.deployed && unitAlive(u) && dist(u.x, u.y, p.a[0], p.a[1]) <= V21.wallR + 0.01)) continue;
  for (const c of pcamCells(p.b, rb)) S.vis[c] = 1; } }
function v22Vis() { pcamVision(); portVision(); }
function pcamTape(uid, pid) { const u = unit(uid), p = S.pcams && S.pcams.find(q => q.id === pid); if (!u || !p || p.team !== uid) return { ok: false, reason: 'No pole cam' };
  if (S.phase !== 'planning') return { ok: false, reason: 'Tape the pole cam during planning' }; if (p.tape) return { ok: false, reason: 'Already taped' };
  const o = useItem(u, 'polecam'); if (!o) return { ok: false, reason: 'No pole cam on the team' };
  p.tape = true; log(`${u.name}: ${o.name} tapes the pole cam in place at the ${S.doors[p.door].name} — the feed stays up until the door is breached.`, 'radio'); S.version++; return { ok: true }; }
function pcamKill(p, how) { p.dead = true; p.ended = how; const u = unit(p.team); if (!p.tape && u) useItem(u, 'polecam'); }
/** Each tick: a suspect in the watched room may spot the camera and destroy it (or fire through the door). */
function pcamTick() { if (!S.pcams || !S.pcams.length || S.phase !== 'executing') return;
  for (const p of S.pcams.slice()) { if (p.dead) continue; const sp = suspList().find(s => spActive(s) && s.room === p.room && !(s.stun > 0) && spHostile(s)); if (!sp) continue;
    if (!S.rng.chance(p.tape ? V22.pcDetectTape : V22.pcDetect)) continue;
    const u = unit(p.team), d = S.doors[p.door], where = S.rooms[p.room] ? S.rooms[p.room].name : 'room'; S.version++;
    if (!p.tape && u && unitAlive(u) && spArmed(sp) && encOn() && S.rng.chance(V22.pcShootDoor)) { pcamKill(p, 'shot');
      withSp(sp, () => { const n0 = S.log.length; sp.firedAt = S.turn; sp.armedKnown = true; S.stats.shots++; sp.mode = 'alert'; sp.cd = 2; noise(sp.x, sp.y, 12, 'shot');
        fx('muzzle', sp.x, sp.y, { suspect: true }); fx('shot', sp.x, sp.y, { tx: u.x, ty: u.y });
        log(`SHOTS THROUGH THE DOOR — the pole cam was spotted; ${multiSp() ? spName(sp).toLowerCase() : 'the suspect'} fires through the ${d.name} from the ${where}. Feed lost.`, 'alert');
        if (S.rng.chance(ENC_CFG.blindHit)) shotOfficer(u, SUSPECT_CAL[sp.weapon] || 'pistol', 2, sp.x, sp.y, where); else log('No hits — rounds strike the door.', 'alert');
        encPause([{ kind: 'blind', sp: spIdx(sp), uid: u.uid, room: p.room, title: 'Shots through the door', text: `${u.name} is at the ${where} door with the pole cam. He spotted the camera and is firing through the closed door — he is not visible. What does the team do?`, res0: encLogFrom(n0),
          options: BLIND_OPTS.map(b => ({ key: b.key, label: b.label, hint: b.sub, who: [] })).concat([Object.assign({}, END_OPT)]) }], false); });
      continue; }
    if (spArmed(sp) && S.rng.chance(V22.pcShootCam)) { pcamKill(p, 'shot'); sp.firedAt = S.turn; sp.armedKnown = true; S.stats.shots++; noise(sp.x, sp.y, 12, 'shot'); fx('muzzle', sp.x, sp.y, { suspect: true });
      log(`The pole cam feed from the ${where} cuts out — ${multiSp() ? spName(sp).toLowerCase() : 'the suspect'} spotted it and fired at it. Camera destroyed.`, 'alert'); }
    else { pcamKill(p, 'removed'); sp.lastKnown = { x: p.other[0], y: p.other[1], turn: S.turn };
      log(`The pole cam feed from the ${where} cuts out — ${multiSp() ? spName(sp).toLowerCase() : 'the suspect'} came to the door and pulled the camera away. He was last seen right at the door.`, 'alert'); } }
  S.pcams = S.pcams.filter(p => !p.dead); }
function stepTickB() { pcamTick(); stepTickB21(); }
function pcamsNear(uid) { return (S.pcams || []).filter(p => p.team === uid && !p.dead); }

/* ---------- 5: hung wall charges — VIEWPORT (shoot-through hole) or THROUGH-WALL (doorway-sized) — interior walls only ---------- */
const WALL_KIND = { port: 'Viewport', hole: 'Through-wall' };
function wallEdgeOk(ax, ay, bx, by) { if (!inb(ax, ay) || !inb(bx, by)) return false; const ra = roomAt(ax, ay), rb = roomAt(bx, by); if (ra === rb || ra < 0 || rb < 0) return false;
  const e = edge(ax, ay, bx, by); if (e.t !== 'X' || S.block[idx(bx, by)] || S.block[idx(ax, ay)]) return false; return !(S.hung || []).some(h => h.key === ek(ax, ay, bx, by)); }
function hungOf(uid) { return (S.hung || []).filter(h => h.team === uid); }
function blowWall(u, w, kind, o) { const [ax, ay] = w.a, [bx, by] = w.b, rb = roomAt(bx, by) >= 0 ? roomAt(bx, by) : roomAt(ax, ay); const nm = WALL_KIND[kind].toLowerCase();
  wallBlast(u, bx, by, rb); if (!S.wallLog) S.wallLog = [];
  if (!S.rng.chance(kind === 'port' ? V21.portP : V21.wallP)) { log(`${u.name}: ${o || 'breacher'} fires the ${nm} charge on the ${w.dir} wall — the wall holds (no opening).`, 'alert'); S.wallLog.push({ kind, ok: false, turn: S.turn }); S.version++; return { ok: true, made: false }; }
  if (kind === 'port') { const p = { id: (S.ports || (S.ports = [])).length, a: w.a, b: w.b, key: w.key, to: w.to, team: u.uid, turn: S.turn }; S.ports.push(p); S.edges.set(w.key, { t: 'P', port: p });
    log(`${u.name}: viewport blown through the ${w.dir} wall into the ${w.to} — officers can look and fire through it.`, 'radio'); S.wallLog.push({ kind, ok: true, turn: S.turn }); S.version++; return { ok: true, made: true, port: p }; }
  const ra = roomAt(ax, ay), d = { id: S.doors.length, cells: [[[ax, ay], [bx, by]]], state: 'open', locked: false, barricaded: false, exterior: false, kind: 'hole', hole: true, name: `Wall breach (${w.to})`, known: true, storm: false, stormState: 'open', stormKnown: true, charge: null, rooms: [ra, roomAt(bx, by)] };
  S.doors.push(d); S.edges.set(w.key, { t: 'D', d }); if (S.peek) S.peek.push(idx(bx, by));
  log(`${u.name}: through-wall charge — a hole through the ${w.dir} wall into the ${w.to}. It works like an open doorway.`, 'radio'); S.wallLog.push({ kind, ok: true, turn: S.turn }); S.version++; return { ok: true, made: true, door: d }; }
function wallCheck(uid, i) { const u = unit(uid); if (!u || u.kind !== 'team') return { ok: false, reason: 'No team' }; if (S.phase !== 'planning') return { ok: false, reason: 'Set charges during planning' };
  if (!hasSpec(u, 'breacher')) return { ok: false, reason: 'Only a breacher can set a wall charge' }; if (!(u.equip.charge > 0)) return { ok: false, reason: 'No breaching charge on the team — draw one at the equipment vehicle' };
  const w = wallSpotsFor(uid)[i || 0]; if (!w) return { ok: false, reason: 'Stand within 1.5 m of an interior wall' }; return { ok: true, u, w }; }
/** Detonate right away (old behaviour). kind 'hole' | 'port'. */
function wallCharge(uid, kind, i) { const c = wallCheck(uid, i); if (!c.ok) return c; const o = useItem(c.u, 'charge'); return blowWall(c.u, c.w, kind, o ? o.name : null); }
/** Hang a charge on a wall; now=true detonates immediately. */
function hangCharge(uid, kind, i, now) { if (kind !== 'hole' && kind !== 'port') return { ok: false, reason: 'Pick viewport or through-wall' }; if (now) return wallCharge(uid, kind, i);
  const c = wallCheck(uid, i); if (!c.ok) return c; const o = useItem(c.u, 'charge'); if (!S.hung) S.hung = [];
  const h = { id: (S.hungSeq = (S.hungSeq || 0) + 1), team: uid, kind, a: c.w.a, b: c.w.b, key: c.w.key, dir: c.w.dir, to: c.w.to, by: o ? o.name : 'breacher', turn: S.turn };
  S.hung.push(h); log(`${c.u.name}: ${h.by} hangs a ${WALL_KIND[kind].toLowerCase()} charge on the ${h.dir} wall (into the ${h.to}). Ready to detonate.`, 'radio'); S.version++; return { ok: true, hung: h }; }
/** Fire several hung charges at once (the team must not stand in a room being blown into). */
function detonateWalls(uid, ids) { const u = unit(uid); if (!u || u.kind !== 'team') return { ok: false, reason: 'No team' }; if (S.phase !== 'planning') return { ok: false, reason: 'Detonate during planning' };
  const list = hungOf(uid).filter(h => ids.includes(h.id)); if (!list.length) return { ok: false, reason: 'Pick at least one charge' };
  const res = []; for (const h of list) { S.hung = S.hung.filter(q => q !== h); res.push(Object.assign({ id: h.id }, blowWall(u, h, h.kind, h.by))); } S.version++; return { ok: true, res }; }
function unhangCharge(uid, id) { const u = unit(uid), h = (S.hung || []).find(q => q.id === id && q.team === uid); if (!u || !h) return { ok: false, reason: 'No charge' };
  if (dist(u.x, u.y, h.a[0], h.a[1]) > V21.wallR + 0.01) return { ok: false, reason: 'Too far from the charge' }; S.hung = S.hung.filter(q => q !== h); u.equip.charge = (u.equip.charge || 0) + 1;
  const o = teamOk(u).find(q => q.name === h.by) || teamOk(u)[0]; if (o) { const inv = invOf(o); inv.vest.charge = (inv.vest.charge || 0) + 1; syncEquip(u); } log(`${u.name}: charge taken down from the ${h.dir} wall.`, 'radio'); S.version++; return { ok: true }; }
function wallPorts(uid) { return portsNear(uid); }
function v21Actions(uid) { const u = unit(uid); if (!u || u.kind !== 'team') return [];
  const out = [], plan = S.phase === 'planning';
  dropList(uid).forEach(q => out.push({ act: 'drop', a: q.id, b: q.k, icon: /shield/.test(q.k) ? '⛨' : '⚒', label: `Drop ${EQUIP[q.k] ? EQUIP[q.k].short : q.k} (${q.name})`, on: !!u.deployed }));
  portsNear(uid).forEach(p => teamOk(u).slice(0, 4).forEach(o => out.push({ act: 'pfire', a: p.id, b: o.id, icon: '➹', label: `Fire through viewport: ${o.name}`, on: plan && shotsLeft(u) > 0 })));
  pcamsNear(uid).filter(p => !p.tape).forEach(p => out.push({ act: 'tape', a: p.id, icon: '📎', label: `Tape pole cam (${S.doors[p.door].name}) — feed stays after you leave`, on: plan && u.equip.polecam > 0 }));
  camTargets(uid).forEach(c => out.push({ act: 'cam', a: c.id, icon: '📷', label: `Shoot camera (${c.name}, ${Math.round(c.p * 100)}%)`, on: plan }));
  if (k9Of(u)) { dogTargets(uid).slice(0, 6).forEach(t => out.push({ act: 'dog', a: t.room, icon: '🐾', label: `Send ${k9Of(u).dog}: ${t.name}`, on: plan })); sniffDoors(uid).forEach(d => out.push({ act: 'sniff', a: d.id, icon: '👃', label: `Door sniff: ${d.name}`, on: plan })); }
  return out; }
function v21Do(uid, act, a, b) { if (act === 'tape') return pcamTape(uid, +a); if (act === 'hang') return hangCharge(uid, a, 0, false); return v21Do21(uid, act, a, b); }

/* ---------- 3: the suspect's cars (driveway / garage stalls) on the brief ---------- */
function v22Brief() { if (!S.brief) return; const cars = (S.world && S.world.cars || []).filter(c => c.suspectCar); const g = S.rooms.find(r => r.type === 'garage');
  const dw = cars.some(c => c.suspectCar === 'driveway'); if (!S.brief.known) S.brief.known = [];
  if (dw) S.brief.known.push('A car is parked in the driveway — registered to the resident.'); else if (g || (S.world && S.world.drives || []).some(q => q.target)) S.brief.known.push('No car in the driveway.');
  if (g) S.brief.known.push(`Attached ${garageStalls(g)}-car garage, door closed — contents unknown.`); }
/** v22 TODO (flee by car): see TODO.md — vehicles are cover / sight blockers only for now. */
function suspectCars() { return (S.world && S.world.cars || []).filter(c => c.suspectCar).map(c => ({ where: c.suspectCar, stall: c.stall, x: c.x, y: c.y, known: c.suspectCar === 'driveway' || (S.seenCell && S.seenCell[idx(c.x, c.y)] === 1) })); }

/* ---------- v22 item 6: hidden suspect behaviour types (rules only; deterministic per seed, lazy for old saves) ---------- */
const BEH = {
  watcher:  { name: 'Stationary watcher', hint: 'stays in one room and watches the approaches from the windows', outMul: 1.1, inMul: 1, win: true, comply: 0, harm: 0 },
  roamer:   { name: 'Roamer', hint: 'moves between rooms — position fixes go stale fast', outMul: 0.9, inMul: 1, win: true, roam: 0.35, comply: 0, harm: 0 },
  ambusher: { name: 'Ambusher (hider-fighter)', hint: 'hides out of window view beside an inner doorway and fights when officers enter', outMul: 0.5, inMul: 1, win: false, winAgit: 85, comply: -0.05, harm: 0.1 },
  passive:  { name: 'Passive hider', hint: 'hides and avoids contact — more likely to comply when found', outMul: 0.45, inMul: 0.6, win: false, winAgit: 90, comply: 0.15, harm: -0.05 },
};
const BEH_CFG = { byTrait: { determined: { watcher: 3, ambusher: 4, roamer: 1, passive: 0.5 }, intoxicated: { watcher: 2, roamer: 3, ambusher: 1.5, passive: 1 }, scared: { passive: 3, roamer: 2, watcher: 1.2, ambusher: 0.5 },
    stalling: { passive: 1.8, watcher: 2.2, roamer: 1.5, ambusher: 0.7 }, compliant: { passive: 3, watcher: 1.5, roamer: 1, ambusher: 0.2 }, mental: { watcher: 2.5, passive: 2.5, roamer: 1, ambusher: 1 } },
  leadMul: { roamer: 0.6 }, interviewP: 0.6, negoRounds: 3, obsTurns: 2, score: { read: 30, ambushNoHit: 50 } };
function behOf(sp) { if (!sp) return null; if (sp.beh) return sp.beh; const M = mindOf(sp), r = makeRng(S.seed * 4057 + (spIdx(sp) + 1) * 97 + 3), W = Object.assign({}, BEH_CFG.byTrait[M.trait] || BEH_CFG.byTrait.determined);
  if (spIdx(sp) <= 0) for (const k in BEH_CFG.leadMul) W[k] *= BEH_CFG.leadMul[k];
  const type = wpick(r, W), B = BEH[type]; M.comply = clamp(M.comply + B.comply, 0, 1); M.harmOff = clamp(M.harmOff + B.harm, 0, 1);
  sp.beh = { type, known: false, src: null, obs: 0, t: -1, rooms: [], intRoll: r() < BEH_CFG.interviewP, placed: false };
  return sp.beh; }
function behNoWin(sp) { const b = behOf(sp), B = b && BEH[b.type]; return !!B && !B.win && (sp.agit || 0) < B.winAgit; }
function behLearn(sp, src) { const b = behOf(sp); if (b.known) return; b.known = true; b.src = src; b.knownTurn = S.turn;
  log(`Intel (${src}): ${spName(sp)} — likely ${BEH[b.type].name.toLowerCase()}: ${BEH[b.type].hint}.`, 'system'); }
function behAmbushCell(sp) { const rm = S.rooms[sp.room]; if (!rm) return null; const dc = []; S.doors.forEach(d => { if (d.rooms.includes(rm.id)) d.cells.forEach(([a, b]) => dc.push(roomAt(a[0], a[1]) === rm.id ? a : b)); });
  const wins = winCellSet(); let best = null, bs = 1e9;
  for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) { if (S.block[idx(x, y)] || wins.has(idx(x, y)) || !dc.length) continue;
    const d = Math.min(...dc.map(c => dist(c[0], c[1], x, y))); if (d < 1.2) continue; const s = Math.abs(d - 1.6); if (s < bs) { bs = s; best = [x, y]; } }
  return best; }
function behRoamTarget(sp) { const cur = sp.room; if (cur < 0) return null; const nb = new Set(); S.doors.forEach(d => { if (d.rooms.includes(cur)) d.rooms.forEach(q => { if (q !== cur && q >= 0) nb.add(q); }); });
  const busy = q => S.units.some(u => (u.kind === 'team' || u.kind === 'robot' || u.kind === 'k9') && unitAlive(u) && u.deployed !== false && roomAt(u.x, u.y) === q);
  const opts = [...nb].filter(q => S.rooms[q] && !S.rooms[q].unitB && !busy(q) && !(S.rooms[q].gas > 0.2)); if (!opts.length) return null;
  const rm = S.rooms[S.rng.pick(opts)], cells = []; for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) if (!S.block[idx(x, y)] && !suspList().some(o => o !== sp && o.x === x && o.y === y)) cells.push([x, y]);
  return cells.length ? S.rng.pick(cells) : null; }
/** Per-tick behaviour hook, run before the classic suspect tick for this suspect. */
function behTick(sp) { const b = behOf(sp); if (!spHostile(sp) || sp.mode === 'fleeing') return;
  if (b.type === 'ambusher') { if (!b.placed && sp.room >= 0 && !sp.visible) { const c = behAmbushCell(sp); if (c) sp.home = { x: c[0], y: c[1] }; b.placed = true; } if (!sp.visible && !(sp.stun > 0)) sp.ambush = true; }
  if (b.t === S.turn) return; b.t = S.turn;
  if (sp.visible) { b.obs++; if (sp.room >= 0 && !b.rooms.includes(sp.room)) b.rooms.push(sp.room); }
  if (!b.known) { if (b.obs >= BEH_CFG.obsTurns || b.rooms.length >= 2) behLearn(sp, 'observation'); else if (S.intel.interview && b.intRoll && spIdx(sp) <= 0) behLearn(sp, 'interview');
    else if (spIdx(sp) <= 0 && S.nego && S.nego.rounds >= BEH_CFG.negoRounds) behLearn(sp, 'negotiation'); }
  if (b.type === 'roamer' && S.turn > 0 && !sp.visible && !(sp.stun > 0) && !(sp.suppressed > 0) && sp.room >= 0 && sp.x === sp.home.x && sp.y === sp.home.y && S.rng.chance(BEH.roamer.roam)) {
    const c = behRoamTarget(sp); if (c) { sp.home = { x: c[0], y: c[1] }; b.moves = (b.moves || 0) + 1; } } }
function suspectTick() { const sp = S.suspect; if (sp && suspectActive()) behTick(sp); suspectTick21(); }
function typeFireMul(u) { const m = typeFireMul21(u), sp = S.suspect, b = sp && behOf(sp); if (!b) return m; return m * (u && roomAt(u.x, u.y) >= 0 ? BEH[b.type].inMul : BEH[b.type].outMul); }
function behInfo() { return suspList().filter((sp, i) => i === 0 || sp.seen || S.phase === 'over').map(sp => { const b = behOf(sp), k = b.known || S.phase === 'over'; return { key: sp.key, name: spName(sp), known: k, type: k ? b.type : null, label: k ? BEH[b.type].name : 'unknown', hint: k ? BEH[b.type].hint : '', src: b.src }; }); }
function behScore(add) { const R = S.result || {}, sp = S.suspect, b = sp && behOf(sp); if (!b) return;
  if (b.known && R.win) add(`Read the suspect's behaviour (${BEH[b.type].name.toLowerCase()})`, BEH_CFG.score.read);
  if (b.type === 'ambusher' && R.win && !S.cas.some(c => !c.initial && (c.who === 'officer' || c.who === 'patrol'))) add('Ambush anticipated — no officer hit', BEH_CFG.score.ambushNoHit); }
function debrief() { const out = debrief21(); suspList().forEach(sp => { const b = behOf(sp); out.push({ k: multiSp() ? `Behaviour ${sp.label || ''}`.trim() : 'Behaviour', v: `${BEH[b.type].name} — ${BEH[b.type].hint}. ${b.known ? 'Identified by ' + b.src + '.' : 'Not identified during the call.'}` }); }); return out; }

/* =====================================================================
   v22 MOVE WAYPOINTS — a second tap beyond the current destination adds
   the next leg instead of replacing it. Legs run in order inside the
   per-turn movement budget and simply carry on next turn (move orders
   persist across turns). Rules only; the UI decides when to call it.
   ===================================================================== */
const WP_CFG = { max: 8, slack: 1, minGap: 1.5 };
/** Move legs at the END of the queue (the editable path), oldest first. */
function wpLegs(u) { const out = []; for (let i = u.orders.length - 1; i >= 0 && u.orders[i].type === 'move'; i--) out.unshift(u.orders[i]); return out; }
/** True when (x,y) lies beyond the unit's current move destination, seen from that leg's start. */
function wpBeyond(uid, x, y) { const u = unit(uid); if (!u || S.phase !== 'planning') return false; const last = u.orders[u.orders.length - 1]; if (!last || last.type !== 'move') return false;
  const pl = planFor(u), p = pl[pl.length - 1]; if (!p || !p.ok) return false; const [sx, sy] = p.start, [dx, dy] = p.end;
  if (dist(dx, dy, x, y) < WP_CFG.minGap) return false; return dist(sx, sy, x, y) > dist(sx, sy, dx, dy) + WP_CFG.slack; }
/** Append a waypoint leg. Returns the queueOrder result plus the leg number and its exposure. */
function addWaypoint(uid, x, y) { const u = unit(uid); if (!u) return { ok: false, reason: 'Unit unavailable' };
  if (wpLegs(u).length >= WP_CFG.max) return { ok: false, reason: `Path is limited to ${WP_CFG.max} waypoints — undo a leg first` };
  const r = queueOrder(uid, { type: 'move', x, y, wp: true }); if (!r.ok) return r; return Object.assign(r, { leg: wpLegs(u).length }); }
/** Remove every waypoint leg added after the first destination (keeps the first move). */
function clearPath(uid) { const u = unit(uid); if (!u || S.phase !== 'planning') return 0; let n = 0; while (u.orders.length && u.orders[u.orders.length - 1].type === 'move' && u.orders[u.orders.length - 1].wp) { u.orders.pop(); n++; } if (n) S.version++; return n; }
/** Per-order timing estimate: on which turn (0 = this one) each order finishes, using the same speeds as the turn loop (2 cells/tick outside, 1 inside, 8 ticks a turn). */
function legTurns(u) { const pl = planFor(u), out = []; let t = S.phase === 'planning' ? 0 : S.tick; const fast = (u.kind === 'patrol' || u.kind === 'team') && (u.impair || 0) < 0.35, dr = u.kind === 'drone';
  pl.forEach((p, i) => { const o = p.order; let c = 0; if (p.ok && p.path) for (const [px, py] of p.path) c += dr || (fast && roomAt(px, py) < 0) ? 0.5 : 1; else c = 1; if (!p.path || !p.path.length) c = Math.max(c, 1);
    t += c; const leg = o.type === 'move' ? wpLegs(u).indexOf(o) + 1 : 0;
    out.push({ i, type: o.type, leg, cells: p.path ? p.path.length : 0, turn: Math.max(0, Math.ceil(t / TICKS) - 1), exposed: !!(o.exposed || o.routeExposed), ok: !!p.ok }); });
  return out; }
/** One-line path summary for the UI (null when there is no multi-leg path). */
function pathInfo(uid) { const u = unit(uid); if (!u) return null; const legs = wpLegs(u); if (legs.length < 2) return null; const lt = legTurns(u).filter(l => l.leg > 0);
  const last = lt[lt.length - 1], ex = lt.filter(l => l.exposed).map(l => l.leg);
  return { legs: legs.length, turns: last ? last.turn : 0, exposed: ex, text: `Path ${legs.length} legs · ${last && last.turn ? 'arrives in ' + (last.turn + 1) + ' turns' : 'arrives this turn'}${ex.length ? ' · ⚠ exposed leg ' + ex.join(', ') : ''}` }; }
/* ===== v23 ===== */
const V23 = { wallR: 1.5 };
/* A4 root cause: furniture on either side of an interior wall used to make the wall uncharged-able (≈35% of interior walls). */
function wallEdgeOk(ax, ay, bx, by) { if (!inb(ax, ay) || !inb(bx, by)) return false; const ra = roomAt(ax, ay), rb = roomAt(bx, by); if (ra === rb || ra < 0 || rb < 0) return false;
  const e = edge(ax, ay, bx, by); if (e.t !== 'X') return false; return !(S.hung || []).some(h => h.key === ek(ax, ay, bx, by)); }
function wallDesc(ax, ay, bx, by) { const dd = WALL_DIRS.find(q => q[0] === bx - ax && q[1] === by - ay); const rb = roomAt(bx, by);
  return { a: [ax, ay], b: [bx, by], dir: dd ? dd[2] : 'near', key: ek(ax, ay, bx, by), to: rb >= 0 ? S.rooms[rb].name : 'outside' }; }
/** Wall cells within 1.5 m of (x,y) in the same room (furniture allowed on either side). */
function wallsNear(x, y, R) { const r0 = roomAt(x, y), out = []; if (r0 < 0) return out; R = R || V23.wallR;
  for (let cy = y - 2; cy <= y + 2; cy++) for (let cx = x - 2; cx <= x + 2; cx++) { if (!inb(cx, cy) || roomAt(cx, cy) !== r0 || dist(cx, cy, x, y) > R + 0.01) continue;
    for (const [dx, dy] of WALL_DIRS) { if (!wallEdgeOk(cx, cy, cx + dx, cy + dy)) continue; const w = wallDesc(cx, cy, cx + dx, cy + dy); w.d = dist(cx, cy, x, y); out.push(w); } }
  return out.sort((p, q) => p.d - q.d); }
function wallSpotsFor(uid) { const u = unit(uid); if (!u || u.kind !== 'team' || !u.deployed || u.inCar) return [];
  const best = new Map(); for (const w of wallsNear(u.x, u.y)) if (!best.has(w.dir + w.to)) best.set(w.dir + w.to, w); return [...best.values()].slice(0, 6); }
/** Is wall key w in reach of a team standing at (x,y)? Returns the wall oriented from the team's side, or null. */
function wallReach(x, y, w) { for (const [a, b] of [[w.a, w.b], [w.b, w.a]]) if (roomAt(a[0], a[1]) === roomAt(x, y) && roomAt(x, y) >= 0 && dist(a[0], a[1], x, y) <= V23.wallR + 0.01) return wallDesc(a[0], a[1], b[0], b[1]); return null; }
/** Map tap → nearest wall edge. {ok, w} | {ok:false, reason}. */
function wallAtTap(cx, cy) { const x0 = Math.floor(cx), y0 = Math.floor(cy); let best = null;
  for (let y = y0 - 1; y <= y0 + 1; y++) for (let x = x0 - 1; x <= x0 + 1; x++) for (const [dx, dy] of WALL_DIRS) { const bx = x + dx, by = y + dy; if (!inb(x, y) || !inb(bx, by)) continue;
    const ra = roomAt(x, y), rb = roomAt(bx, by); if (ra === rb) continue; const mx = (x + bx) / 2 + 0.5, my = (y + by) / 2 + 0.5, d = Math.hypot(mx - cx, my - cy);
    if (d < 0.8 && (!best || d < best.d)) best = { d, x, y, bx, by, ra, rb }; }
  if (!best) return { ok: false, reason: 'Tap right on an interior wall line' };
  const e = edge(best.x, best.y, best.bx, best.by);
  if (best.ra < 0 || best.rb < 0) return { ok: false, exterior: true, reason: 'That is an exterior wall — wall charges only go on interior walls. Pick a wall between two rooms.' };
  if (e.t !== 'X') return { ok: false, reason: e.t === 'D' ? 'That is a doorway — use Breach for doors' : 'That wall section already has an opening' };
  if ((S.hung || []).some(h => h.key === ek(best.x, best.y, best.bx, best.by))) return { ok: false, reason: 'A charge is already hung on that wall' };
  return { ok: true, w: wallDesc(best.x, best.y, best.bx, best.by) }; }
function hangCan(u) { if (!u || u.kind !== 'team') return 'No team'; if (!hasSpec(u, 'breacher')) return 'Only a breacher can set a wall charge';
  if (!(u.equip.charge > 0)) return 'No breaching charge on the team — draw one at the equipment vehicle'; return null; }
/** Hang (or fire) a charge on a specific wall the team can reach. */
function hangWallAt(u, w0, kind, now) { if (kind !== 'hole' && kind !== 'port') return { ok: false, reason: 'Pick viewport or through-wall' }; const why = hangCan(u); if (why) return { ok: false, reason: why };
  const w = wallReach(u.x, u.y, w0); if (!w || !wallEdgeOk(w.a[0], w.a[1], w.b[0], w.b[1])) return { ok: false, reason: 'Stand within 1.5 m of an interior wall' };
  const o = useItem(u, 'charge'); if (now) return blowWall(u, w, kind, o ? o.name : null); if (!S.hung) S.hung = [];
  const h = { id: (S.hungSeq = (S.hungSeq || 0) + 1), team: u.uid, kind, a: w.a, b: w.b, key: w.key, dir: w.dir, to: w.to, by: o ? o.name : 'breacher', turn: S.turn };
  S.hung.push(h); log(`${u.name}: ${h.by} hangs a ${WALL_KIND[kind].toLowerCase()} charge on the ${h.dir} wall (into the ${h.to}). Ready to detonate.`, 'radio'); S.version++; return { ok: true, hung: h }; }
/** Planning-phase entry from the map tap: in reach → act now; else the caller queues a 'hangwall' order. */
function hangWallTap(uid, w, kind, now) { const u = unit(uid); if (S.phase !== 'planning') return { ok: false, reason: 'Set charges during planning' }; return hangWallAt(u, w, kind, now); }
function hangwallGoal(o) { const sides = [[o.w.a, o.w.b], [o.w.b, o.w.a]]; return (x, y) => !S.block[idx(x, y)] && sides.some(([a]) => roomAt(a[0], a[1]) === roomAt(x, y) && dist(a[0], a[1], x, y) <= V23.wallR + 0.01); }
function hangwallPlan(u, o, sx, sy, mo) { if (!o.w || !wallEdgeOk(o.w.a[0], o.w.a[1], o.w.b[0], o.w.b[1])) return { ok: false, reason: 'That wall cannot take a charge (interior walls only)' };
  const g = hangwallGoal(o); if (g(sx, sy)) return { ok: true, path: [], end: [sx, sy] };
  /* prefer spots not covered by a window; fall back to any valid spot */
  const safe = (x, y) => g(x, y) && !(expoAt(x, y) > 0); let p = findPath(sx, sy, safe, mo); if (!p) p = findPath(sx, sy, g, mo);
  if (!p) return { ok: false, reason: 'No route to a spot within 1.5 m of that wall' }; o.spot = p.length ? p[p.length - 1] : [sx, sy]; return { ok: true, path: p, end: o.spot }; }
function hangwallTick(u, o, speed) { const g = hangwallGoal(o);
  if (!g(u.x, u.y)) { const r = stepAlong(u, o, g, speed); if (r === null) { failOrders(u, 'cannot reach the wall'); return; } if (!r) return; }
  popOrder(u); const r = hangWallAt(u, o.w, o.kind, !!o.now); if (!r.ok) log(`${u.name}: wall charge not set — ${r.reason}.`, 'alert'); }
/* A1: mobile homes on the block. Suspect in a trailer → the houses either side are trailers; every row rolls its own
   per-house trailer rate (avg ≈35%, so a row can be mostly trailers or hardly any). Suspect in a house → 1% per house. */
const NB_TRAILER_CFG = { rowRates: [0.08, 0.35, 0.62], other: 0.01 };
function trailerLots(lots, H) { const out = new Set(), rr = makeRng(S.seed * 4243 + 17), big = L => !L.target && L.x1 - L.x0 >= 17, T = lots.find(L => L.target);
  if (S.opts && S.opts.noNbTrailers) return out;
  if (!H.trailer) { for (const L of lots) if (big(L) && rr() < NB_TRAILER_CFG.other) out.add(L); return out; }
  const row = L => (L.rear ? 'r' : '') + L.side, same = lots.filter(L => big(L) && row(L) === row(T));
  const left = same.filter(L => L.x1 < T.x0).sort((a, b) => b.x1 - a.x1)[0], right = same.filter(L => L.x0 > T.x1).sort((a, b) => a.x0 - b.x0)[0];
  if (left) out.add(left); if (right) out.add(right);
  const rates = {}; for (const L of lots) { if (!big(L) || out.has(L)) continue; const k = row(L); if (rates[k] === undefined) rates[k] = NB_TRAILER_CFG.rowRates[Math.floor(rr() * NB_TRAILER_CFG.rowRates.length)]; if (rr() < rates[k]) out.add(L); }
  return out; }

/* ---- v23 A5 / A7: the equipment vehicle and two BearCats arrive on their own turns ----
   S.eqVeh = { turn, here }  — until it is here, primary staging holds none of the vehicle kit (stashed in S.eqHeld).
   S.bcPend = [{ unit, turn, zone }] — BearCats still on the way; each adds BC_KIT to its own staging pool (S.armory primary, S.armory2 secondary). */
const EQV_CFG = { share: 0.35 };
const BC_KIT = { shield3: 1, bang: 4, ll1: 1, medkit: 1, gasbag: 1, gas: 6, ram: 1, halligan: 1, charge: 2 };
EQUIP.ll1 = { name: 'Single-shot 40mm LL launcher', short: 'Single-shot 40mm', pool: 0, desc: 'Single-shot 40mm less-lethal launcher from the BearCat: impact or 40mm CS rounds, reload after every shot.' };
ITEM_CFG.ll1 = { where: 'packed' };
function poolZone(x, y) { const X = S.ext; if (dist(x, y, X.staging.x, X.staging.y) <= INV_CFG.drawRange) return 'p';
  return S.armory2 && X.staging2 && dist(x, y, X.staging2.x, X.staging2.y) <= INV_CFG.drawRange ? 's' : 'p'; }
function atEquipment(x, y) { const X = S.ext; return dist(x, y, X.staging.x, X.staging.y) <= INV_CFG.drawRange || !!(S.armory2 && X.staging2 && dist(x, y, X.staging2.x, X.staging2.y) <= INV_CFG.drawRange); }
function withPool(z, fn) { if (z !== 's' || !S.armory2) return fn(); const p = S.armory; S.armory = S.armory2; try { return fn(); } finally { S.armory2 = S.armory; S.armory = p; } }
const zoneOfOff = o => { const [x, y] = offPos(o); return poolZone(x, y); }, zoneOfUnit = t => poolZone(t.x, t.y);
function eqHere() { return !S.eqVeh || S.eqVeh.here; }
function emptyPool() { const p = {}; for (const k in EQUIP) p[k] = 0; return p; }
function addKit(pool, kit) { for (const k in kit) pool[k] = (pool[k] || 0) + kit[k]; }
/** Draw/return, routed to the pool of whichever staging the officer stands at; the single-shot launcher (ll1) handled here. */
const invAct22 = invAct;
invAct = function (offId, act, k) { const o = off(offId); if (!o) return invAct22(offId, act, k);
  return withPool(zoneOfOff(o), () => {
    const inv = invOf(o), t = o.team ? unit(o.team) : null;
    if (k === 'll1' && act === 'draw') { const [x, y] = offPos(o); if (!atEquipment(x, y)) return { ok: false, reason: 'Equipment is drawn at a staging vehicle — move there first' };
      if (!(S.armory.ll1 > 0)) return { ok: false, reason: 'No single-shot 40mm LL launcher here' }; if (carries(o, 'lesslethal')) return { ok: false, reason: 'Already carries a 40mm launcher' };
      S.armory.lesslethal = (S.armory.lesslethal || 0) + 1; const r = invActBase(offId, 'draw', 'lesslethal');
      if (!r.ok) { S.armory.lesslethal--; return r; } S.armory.ll1--; inv.llMag = LL19.singleMag; inv.llLoad = Math.min(1, inv.ll); inv.reloadT = -1; inv.ll1 = 1; if (t) syncEquip(t); return r; }
    if (k === 'll1' && act === 'return') { if (!inv.ll1) return { ok: false, reason: 'Not carried' }; k = 'lesslethal'; }
    if (k === 'lesslethal' && act === 'return' && inv.ll1) { const r = invActBase(offId, 'return', 'lesslethal'); if (r.ok) { S.armory.lesslethal--; S.armory.ll1 = (S.armory.ll1 || 0) + 1; S.armory.cs40 += inv.vest.cs40 || 0; inv.vest.cs40 = 0; inv.ll1 = 0; inv.llMag = null; if (t) syncEquip(t); } return r; }
    const r = invAct22(offId, act, k);
    if (!r.ok && act === 'draw' && !eqHere() && poolZone(...offPos(o)) === 'p' && !(S.armory[k] > 0) && /None left|left at the equipment/.test(r.reason || '')) return { ok: false, reason: `The equipment vehicle is not on scene yet — ${EQUIP[k] ? EQUIP[k].short : k} arrives with it` };
    return r; }); };
const defaultKit22 = defaultKit; defaultKit = function (t) { return withPool(zoneOfUnit(t), () => { const r = defaultKit22(t);
  for (const o of teamOk(t)) if (llKind(o) === 'single' && !(invOf(o).vest.cs40 > 0)) { let n = 0; while (n < CS40_CFG.issue && S.armory.cs40 > 0) { S.armory.cs40--; n++; } if (n) invOf(o).vest.cs40 = n; } // v23: CS rounds fit the single-shot too
  syncEquip(t); return r; }); };
const issueView22 = issueView; issueView = function (uid) { const t = unit(uid); if (!t) return issueView22(uid); const z = zoneOfUnit(t);
  return withPool(z, () => { const v = issueView22(uid); if (v) { v.zone = z; v.eqHere = eqHere(); v.eqTurn = S.eqVeh ? S.eqVeh.turn : 0; v.bcPend = (S.bcPend || []).map(p => p.zone); } return v; }); };
const fetchSecondary22 = fetchSecondary; fetchSecondary = function (offId) { const o = off(offId); return o ? withPool(zoneOfOff(o), () => fetchSecondary22(offId)) : fetchSecondary22(offId); };
const equip22 = equip; equip = function (uid, item, d) { const t = unit(uid); return t ? withPool(zoneOfUnit(t), () => equip22(uid, item, d)) : equip22(uid, item, d); };
/** All armored cruisers on scene; the one nearest a unit (Draco install). */
function bearcats() { return S.units.filter(u => u.kind === 'cruiser' && u.armored); }
function bearcatFor(u) { const L = bearcats().filter(c => !c.draco); if (!u || !L.length) return L[0] || bearcat(); return L.slice().sort((a, b) => dist(a.x, a.y, u.x, u.y) - dist(b.x, b.y, u.x, u.y))[0]; }
function bcSpot(cx, cy, self) { let best = null, bs = 1e9; for (let dy = -6; dy <= 6; dy++) for (let dx = -24; dx <= 24; dx++) { const x = cx + dx, y = cy + dy; if (!inb(x, y) || !S.drive[idx(x, y)] || S.block[idx(x, y)] || carClash(x, y, self)) continue;
  const s = Math.abs(dx) + Math.abs(dy) * 2 + (Math.abs(dx) < 4 && Math.abs(dy) < 3 ? 20 : 0); if (s < bs) { bs = s; best = [x, y]; } } return best; }
function v23Equip() { const offs = S.officers || [], etas = offs.map(o => o.status === 'enroute' ? o.eta || 0 : 0).sort((a, b) => a - b);
  const n35 = Math.max(1, Math.ceil(offs.length * EQV_CFG.share)), T35 = etas.length ? etas[Math.min(etas.length, n35) - 1] : 0, q = makeRng((S.seed * 6151 + 29) >>> 0);
  const eqT = T35 >= 1 ? q.int(1, T35) : 0; S.eqVeh = { turn: eqT, here: eqT <= 0 || !!(S.opts && S.opts.eqNow) || !!V23.eqAtStart, T35 };
  S.eqHeld = null; const W = S.world;
  if (!S.eqVeh.here) { S.eqHeld = Object.assign({}, S.armory); S.armory = emptyPool();
    if (W && W.van) { W.van.away = true; W.vanSave = []; for (let y = W.van.y; y < W.van.y + W.van.h; y++) for (let x = W.van.x; x < W.van.x + W.van.w; x++) { const c = idx(x, y); W.vanSave.push([c, S.block[c], S.cov[c], S.covLbl[c]]); S.block[c] = 0; S.cov[c] = 0; S.covLbl[c] = 0; } S.veh = null; } }
}
function v23Vehicles() { const offs = S.officers || []; S.armory2 = null;
  // two BearCats: replace the single v20 BearCat (C4 at primary) with one per staging, each on its own random turn
  S.bcPend = []; const P = S.bcPending; S.bcPending = null; const c1 = P ? P.unit : bearcats()[0];
  if (c1 && S.opts && S.opts.armored) { S.units = S.units.filter(u => u !== c1); const mx = Math.max(2, ...offs.map(o => o.eta || 0));
    const r1 = makeRng((S.seed * 433 + 71) >>> 0), r2 = makeRng((S.seed * 977 + 13) >>> 0);
    c1.bcZone = 'p'; c1.name = 'BearCat 1'; c1.bcDriver = { name: 'BearCat 1 driver' }; S.bcPend.push({ unit: c1, turn: V20.bcDelay ? r1.int(1, mx) : 0, zone: 'p' });
    const s2 = S.ext.staging2, sp = s2 && bcSpot(s2.x, s2.y, null);
    if (sp) { const c2 = { uid: 'C5', kind: 'cruiser', name: 'BearCat 2', num: 5, x: sp[0], y: sp[1], dir: 0, occ: [], orders: [], status: 'ok', hits: 0, marks: [], vis: [], disabled: false, armored: true, bcZone: 's', bcDriver: { name: 'BearCat 2 driver' } };
      S.bcPend.push({ unit: c2, turn: V20.bcDelay ? r2.int(1, mx) : 0, zone: 's' }); }
    rebuildDyn(); for (const p of S.bcPend.filter(p => p.turn <= 0)) bcArrive(p, true); }
}
function vanArrive() { const W = S.world; if (!W || !W.van || !W.van.away) return true; const cells = (W.vanSave || []).map(a => a[0]);
  if (cells.some(c => S.dyn && S.dyn[c])) return false; // a cruiser is parked in the bay: next turn
  for (const [c, b, cv, cl] of W.vanSave) { S.block[c] = b; S.cov[c] = cv; S.covLbl[c] = cl; }
  for (const u of S.units) if (onFoot(u) && cells.includes(idx(u.x, u.y))) { for (let d = 1; d < 6; d++) { const y = W.van.y + W.van.h - 1 + d; if (inb(u.x, y) && !S.block[idx(u.x, y)]) { u.x = u.x; u.y = y; break; } } }
  W.van.away = false; W.vanSave = null; S.veh = null; return true; }
function eqArriveNow() { if (eqHere()) return false; if (!vanArrive()) return false; S.eqVeh.here = true; S.eqVeh.at = S.turn;
  addKit(S.armory, S.eqHeld || {}); S.eqHeld = null; S.version++;
  log(`PAGER: Equipment vehicle on scene at primary staging — shields, breaching charges, 40mm launchers, gas and the rest of the vehicle kit can now be drawn.`, 'pager'); S.events.push({ type: 'pager' }); return true; }
function bcArrive(p, quiet) { S.bcPend = (S.bcPend || []).filter(x => x !== p); const c = p.unit, X = S.ext, home = p.zone === 's' ? X.staging2 : X.staging;
  if (carClash(c.x, c.y, c.uid) || S.block[idx(c.x, c.y)]) { const sp = bcSpot(home.x, home.y, c.uid); if (sp) { c.x = sp[0]; c.y = sp[1]; } }
  S.units.push(c); rebuildDyn();
  if (p.zone === 's') { S.armory2 = S.armory2 || emptyPool(); addKit(S.armory2, BC_KIT); } else addKit(S.armory, BC_KIT);
  S.version++; if (!quiet) { log(`PAGER: ${c.name} on scene at ${p.zone === 's' ? 'secondary' : 'primary'} staging — its driver stays with it (room for 11 in the back). Added to that staging: 1 Level III shield, 4 flashbangs, 1 single-shot 40mm LL launcher, 1 medkit, 1 gas bag, 6 CS canisters, ram, halligan, 2 breaching charges.`, 'pager'); S.events.push({ type: 'pager' }); }
  return c; }
/** Compatibility (v20 tests / debug): bring every BearCat still on the way in now; returns the primary one. */
function bcArriveNow() { if (S.bcPending) { S.bcPend = (S.bcPend || []).concat([{ unit: S.bcPending.unit, turn: 0, zone: 'p' }]); S.bcPending = null; }
  for (const p of (S.bcPend || []).slice()) bcArrive(p); return bearcats().find(c => c.bcZone !== 's') || bearcat(); }
function endTurn() { endTurnBase(); if (S.phase === 'over') return;
  if (S.bcPending && S.turn >= S.bcPending.turn) bcArriveNow(); // pre-v23 save
  for (const p of (S.bcPend || []).slice()) if (S.turn >= p.turn) bcArrive(p);
  if (S.eqVeh && !S.eqVeh.here && S.turn >= S.eqVeh.turn) eqArriveNow(); }
function poolAt(x, y) { return poolZone(x, y) === 's' ? S.armory2 : S.armory; }
/* ---- v23 A8: one launcher load shared by impact and 40mm CS rounds. Single-shot reloads after every shot, the 4-shot multilauncher after 4. ---- */
function llLeft(inv) { return (inv.ll || 0) + (inv.vest && inv.vest.cs40 || 0); }
function llShot(o) { const inv = invOf(o), mag = llMagOf(inv); if (inv.llLoad == null) inv.llLoad = Math.min(mag, llLeft(inv) + 1);
  inv.llLoad = Math.max(0, inv.llLoad - 1); inv.llTurn = S.turn;
  if (inv.llLoad <= 0 && llLeft(inv) > 0) { inv.llLoad = Math.min(mag, llLeft(inv)); inv.reloadT = S.phase === 'planning' ? S.turn : S.turn + 1; log(`${o.name}: reloading the ${mag === 1 ? 'single-shot 40mm LL launcher' : '4-shot 40mm multilauncher'} — takes a full turn.`, 'radio'); } }
function llSpend(o) { const inv = invOf(o); if (inv.llLoad == null) inv.llLoad = Math.min(llMagOf(inv), llLeft(inv)); inv.ll = Math.max(0, (inv.ll || 0) - 1); llShot(o); }
function llName(o) { const k = llKind(o); return k === 'single' ? 'single-shot 40mm LL launcher' : k === 'multi' ? '4-shot 40mm multilauncher' : ''; }
/** Launcher status line for the UI: rounds, load and reload state. */
function llState(o) { const k = llKind(o); if (!k) return null; const inv = invOf(o), mag = llMagOf(inv), load = inv.llLoad == null ? Math.min(mag, llLeft(inv)) : inv.llLoad;
  return { kind: k, name: llName(o), mag, load, impact: inv.ll || 0, cs: inv.vest.cs40 || 0, reloading: inv.reloadT >= S.turn, firedThisTurn: inv.llTurn === S.turn }; }

/** v23: hands text names the actual 40mm launcher (single-shot vs 4-shot). */
function handsText(o) { const h = invOf(o).hands, nm = x => x === 'lesslethal' && llKind(o) ? llName(o) : itemShort(x); if (h[0] && h[0] === h[1]) return nm(h[0]) + ' (both hands)'; return h.map(x => x ? nm(x) : 'free').join(' + '); }

/* ===================== v23 PART B — scenario text + hidden modifiers ===================== */
function gunWordOf(w) { return { handgun: 'a handgun', rifle: 'a rifle', shotgun: 'a shotgun' }[w] || null; }
/** B7: why police are involved in a crisis call — told by the caller (or by him), never as a legal line. */
function mentalHook(k, sp, self) { const g = gunWordOf(sp && sp.weapon);
  if (k === 'discharge') return self ? ' I already fired one in here.' : ' He fired a gun inside the house a few minutes ago.';
  if (k === 'warrant') return self ? " And I'm not going to jail." : " There's a warrant out for him — he says he's not going back.";
  if (k === 'menacing') return self ? ` My brother left. I made him leave.` : g ? ` He pointed ${g} at his brother and told him to get out.` : ' He waved a kitchen knife at his brother and told him to get out.';
  return ''; }
const MENTAL_KNOWN = { discharge: 'Reported before patrol arrived: he fired a round inside the house.', warrant: 'He has an outstanding warrant and has said he will not go back to jail.', menacing: 'Reported before patrol arrived: he threatened a family member with a weapon.' };
/** B6 criminal history (shown) + B1/B6 hidden modifiers (never shown). Runs once at mission start. */
function v23Brief() { const B = S.brief; if (!B) return; const ST = (S.stype && S.stype.key) || 'barricade', r = makeRng(S.seed * 6151 + 29);
  const H = crimHistory(r, ST); B.history = H;
  const line = H.length ? 'Record on file: ' + H.map((h, i) => i ? h.text.charAt(0).toLowerCase() + h.text.slice(1) : h.text).join('; ') + '.' : 'No criminal history on file.';
  B.known = B.known || []; B.known.splice(Object.values(LEGAL_TXT).includes(B.known[0]) ? 1 : 0, 0, line);
  if (ST === 'mental' && MENTAL_KNOWN[S.stype.legal]) B.known.splice(1, 0, MENTAL_KNOWN[S.stype.legal]);
  const C = HID_CFG, score = H.reduce((a, h) => a + h.sev, 0), down = !!(S.scene && S.scene.injury);
  S.hid = { score, down, fire: (1 + Math.min(C.fireCap, score * C.sevFire)) * (down ? C.downFire : 1), nego: down ? C.downNego : 1, agit: Math.round(Math.min(C.agitCap, score * C.sevAgit) + (down ? C.downAgit : 0)) };
  (S.suspects && S.suspects.length ? S.suspects : [S.suspect]).forEach(s => { if (s) s.agit = clamp((s.agit || 0) + S.hid.agit, 0, 100); });
}
/** Scenario config with the hidden modifiers folded in (fire attempts, negotiation gain). Old states without S.hid are unchanged. */
function stypeCfg() { const T = SCEN_TYPES[(S.stype && S.stype.key) || 'barricade'], h = S.hid; if (!h || (h.fire === 1 && h.nego === 1)) return T;
  return Object.assign({}, T, { fireMul: (T.fireMul || 1) * h.fire, negoMul: (T.negoMul || 1) * h.nego }); }
/** B7: a crisis subject in custody still gets the EMS evaluation (noted in the result). */
const checkEnd23 = checkEnd;
checkEnd = function () { const was = S.phase; checkEnd23(); if (was !== 'over' && S.phase === 'over' && S.result && S.result.win && S.stype && S.stype.key === 'mental')
  S.result.text += S.intel.emsEval ? ' EMS: the crisis team evaluates him at the EMS point before transport.' : ' EMS: he will get a mental-health evaluation after booking (no crisis team was staged).'; };
/* ---------- team management (planning phase only) ---------- */
const nearStaging = (x, y) => atEquipment(x, y);
function stagePos(stage) { return stage === 'secondary' && S.ext.staging2 ? S.ext.staging2 : S.ext.staging; }
/** Form a team from officers waiting at ONE staging area. opts.point / opts.defense pick the point and his defense (cover) man;
    `ids` order is the stack order (formation slots follow it). Teams formed at the equipment vehicle get a default kit from the pool. */
function formTeam(ids, opts) {
  opts = opts || {};
  if (S.phase !== 'planning') return { ok: false, reason: 'Busy' };
  if (!ids) { const free = S.officers.filter(o => o.status === 'staged' && !o.team); const pri = free.filter(o => (o.stage || 'primary') === 'primary'); ids = (pri.length ? pri : free).map(o => o.id); }
  ids = ids.filter((id, i) => ids.indexOf(id) === i && off(id) && off(id).status === 'staged' && !off(id).team);
  if (opts.point && ids.includes(opts.point)) ids = [opts.point].concat(ids.filter(i => i !== opts.point));
  if (opts.defense && ids.includes(opts.defense) && opts.defense !== ids[0]) ids = [ids[0], opts.defense].concat(ids.slice(1).filter(i => i !== opts.defense));
  ids = ids.slice(0, S.teamMax || 5);
  if (!ids.length) return { ok: false, reason: 'No unassigned officers at staging' };
  const stage = off(ids[0]).stage || 'primary'; if (ids.some(id => (off(id).stage || 'primary') !== stage)) return { ok: false, reason: 'Officers must be at the same staging area to form a team' };
  const n = ++S.teamSeq; const st = stagePos(stage);
  const t = { uid: 'T' + n, kind: 'team', name: (opts.name && String(opts.name).trim().slice(0, 18)) || `Team ${n}`, num: n, members: [], x: st.x + ((n - 1) % 3) - 1, y: st.y - 1 - Math.floor((n - 1) / 3), dir: -Math.PI / 2, equip: {}, orders: [], status: 'ok', vis: [], deployed: true, detain: false, stance: 'return', perch: null, mask: 'off', impair: 0, stun: 0 };
  if (!inb(t.x, t.y) || S.block[idx(t.x, t.y)] || roomAt(t.x, t.y) >= 0) { t.x = st.x; t.y = st.y; }
  for (const k in EQUIP) t.equip[k] = 0;
  S.units.push(t); ids.forEach(id => assign(id, t.uid));
  t.point = t.members[0] || null; t.defense = t.members[1] || null;
  if ((stage === 'primary' || (stage === 'secondary' && S.armory2)) && opts.kit !== false) defaultKit(t); else syncEquip(t);
  log(`${t.name} team formed (${t.members.length} officers) at ${stage === 'primary' ? 'primary staging (equipment vehicle)' : 'secondary staging (on foot — personal gear only)'}. Point: ${off(t.members[0]).name}${t.defense ? ', defense: ' + off(t.defense).name : ''}.`, 'system'); S.version++; return { ok: true, team: t };
}
/** Re-order a team's stack: ids is the new member order (point first, then his defense man, then the rest). */
function setTeamOrder(uid, ids) { const t = unit(uid); if (!t || t.kind !== 'team') return { ok: false, reason: 'No team' };
  if (S.phase !== 'planning') return { ok: false, reason: 'Busy' };
  if (!ids || ids.length !== t.members.length || ids.some(id => !t.members.includes(id))) return { ok: false, reason: 'Order must list every member once' };
  t.members = ids.slice(); t.point = ids[0]; t.defense = ids[1] || null; S.version++; return { ok: true }; }
function assign(offId, teamUid) {
  const o = off(offId); if (!o || o.status !== 'staged' && o.status !== 'ok') return { ok: false, reason: 'Officer unavailable' };
  const from = o.team ? unit(o.team) : null, to = teamUid ? unit(teamUid) : null;
  const pos = from ? from : stagePos(o.stage); let tpos = to ? to : stagePos(o.stage);
  if (!to && from) { const near = ['primary', 'secondary'].find(sg => S.ext[sg === 'primary' ? 'staging' : 'staging2'] && dist(from.x, from.y, stagePos(sg).x, stagePos(sg).y) <= 3.5); if (!near) return { ok: false, reason: 'Officers can only leave a team at a staging area' }; o.stage = near; tpos = stagePos(near); }
  if (dist(pos.x, pos.y, tpos.x, tpos.y) > 3.5) return { ok: false, reason: 'Units must be together (within 3 m) to swap members' };
  if (from) from.members = from.members.filter(id => id !== offId);
  o.team = to ? to.uid : null; o.status = to ? 'ok' : 'staged'; if (to) to.members.push(offId);
  if (from && !from.members.length) S.units = S.units.filter(u => u !== from); // gear stays with each officer
  if (from) { from.point = from.members[0] || null; from.defense = from.members[1] || null; syncEquip(from); } if (to) syncEquip(to);
  S.version++; return { ok: true };
}
/** Compatibility: team-level ± at the equipment vehicle, routed to the member best placed to carry it. */
function equip(teamUid, item, delta) {
  const t = unit(teamUid); if (!t) return { ok: false };
  if (!atEquipment(t.x, t.y)) return { ok: false, reason: 'Team must be at the equipment vehicle (primary staging) to draw or return equipment' };
  const m = teamOk(t); if (delta < 0) { const o = m.slice().reverse().find(q => countOf(q, item) > 0); if (!o) return { ok: false, reason: 'None to return' }; return invAct(o.id, 'return', item); }
  if (!(S.armory[item] > 0)) return { ok: false, reason: 'None left in armory' };
  let last = { ok: false, reason: 'Nobody can carry it' }; const c = ITEM_CFG[item] || {};
  const pref = m.slice().sort((a, b) => (c.spec ? (b.spec === c.spec) - (a.spec === c.spec) : 0) + (c.qual ? ((b.quals || []).includes(c.qual) - (a.quals || []).includes(c.qual)) : 0) || freeHands(b) - freeHands(a));
  for (const o of pref) { last = invAct(o.id, 'draw', item); if (last.ok) return Object.assign({ by: o.id }, last); } return last;
}
function renameTeam(uid, name) { const t = unit(uid); if (!t || t.kind !== 'team') return { ok: false }; const nm = String(name || '').replace(/[<>]/g, '').trim().slice(0, 18); if (!nm || nm === t.name) return { ok: true, renamed: false, name: t.name };
  const old = t.name; t.name = nm; log(`Team renamed: ${old} → ${nm}.`, 'system'); S.version++; return { ok: true, renamed: true, name: nm }; }

/* ---------- derived info for HUD ---------- */
function intelInfo() {
  const OR = ownRooms(), known = OR.filter(q => q.known).length, exp = OR.filter(q => q.explored).length, sp = S.suspect;
  const lvl = Math.round(100 * (0.55 * known / OR.length + 0.15 * (S.intel.threat ? 1 : 0) + 0.15 * (S.intel.floors ? 1 : 0) + 0.15 * (sp.seen || S.intel.located ? 1 : 0)));
  const CI = suspectCountInfo(), flee = multiType(), vis = suspList().filter(s => s.visible && spActive(s));
  let threat = 'UNKNOWN'; if (S.intel.threat) threat = !flee ? (sp.weapon === 'none' && S.intel.weapon ? '1 SUSPECT — NO FIREARM' : '1 ARMED SUSPECT') : CI.confirmed ? `${CI.total} ARMED SUSPECT${CI.total > 1 ? 'S' : ''}` : 'ARMED — COUNT UNCONFIRMED';
  if (flee && vis.length > 1) threat = `VISUAL — ${vis.length} SUSPECTS`; else if (sp.visible) threat = 'VISUAL — ' + (S.rooms[sp.room] ? S.rooms[sp.room].name.toUpperCase() : 'YARD'); else if (sp.heat) threat = 'LOCATED (THERMAL/K9)';
  const status = { barricaded: 'BARRICADED', alert: 'ALERTED', fleeing: 'FLEEING', surrendered: 'SURRENDERED', incapacitated: 'INCAPACITATED', detained: 'IN CUSTODY', escaped: 'ESCAPED' }[sp.mode];
  return { arch: S.intel.floors ? S.house.archName : 'UNKNOWN', weapon: S.intel.weapon ? SUSPECT_WEAPONS[sp.weapon].name : 'UNKNOWN', floors: S.intel.floors ? '1 (single storey)' : 'UNKNOWN', roomsKnown: known, roomsTotal: S.intel.floors ? OR.length : '?', explored: exp, level: clamp(lvl, 0, 100), threat,
    suspect: (sp.seen || S.intel.threat || !hostile()) ? status : 'UNKNOWN', contain: S.contain.filter(c => c.covered).length, containTotal: S.contain.length, containKnown: !!S.intel.status, sides: (() => { const w = sideWatch(); return { n: w.watched.length, of: w.all.length, gaps: w.gaps }; })(), down: S.stats.down, downMax: LOSE_DOWN, talk: Math.round(sp.talk), phone: !!S.nego.contact, mood: moodWord(), rapport: rapportWord(),
    cas: S.cas.filter(c => casActive(c) && c.known && c.who !== 'suspect').length,
    count: CI, multiType: !!flee, suspects: suspList().filter(s => s.seen || S.phase === 'over').map(s => ({ key: s.key, name: spName(s), state: spState(s), visible: !!s.visible, weapon: s.seen ? SUSPECT_WEAPONS[s.weapon].name : '?', armor: s.armorKnown ? s.armor : null })) };
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
      opName: '', /* v23: operation names removed (key kept for old saves) */ opts: opts || {}, encOn: opts && opts.encounters !== undefined ? !!opts.encounters : ENC_CFG.enabled };
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
    const X = S.ext; let best = null; for (let d = 7; d < 22 && !best; d++) for (const dx of [-d, d]) { const x = X.staging.x + dx, y = S.geo.ST + 4; if (S.drive[idx(x, y)] && !carClash(x, y, null)) { best = [x, y]; break; } }
    if (best) { S.units.push({ uid: 'C4', kind: 'cruiser', name: 'BearCat', num: 4, x: best[0], y: best[1], dir: 0, occ: [], orders: [], status: 'ok', hits: 0, marks: [], vis: [], disabled: false, armored: true, bcDriver: { name: 'BearCat driver' } }); rebuildDyn(); bcSchedule(); } }
  S.stype = typeForSeed(seed, S.opts.stype); applyScenType();
  setupSuspects(); applyTypeExtras(); setupLocks();
  S.bigAvail = !(S.opts && S.opts.gear && S.opts.gear.robot === 0); // v18: no Large Robot before the unit has robots. setupSuspects tags the suspect; 'flee' calls may add more (1-4); armor per suspect
  setupStaging2(); v23Vehicles(); S.ems = defaultEMS(); initNego(seed); makeBrief(); v22Brief(); v23Brief();
  updateVision();
  log(`Seed ${seed}. ${S.house.archName}, ${S.geo.name}.`, 'system');
  const B = S.brief; log(`Dispatch ${B.time}: ${B.type} at ${B.addr}. ${B.shots ? 'Shots fired. ' : ''}${S.stype.key === 'drughouse' ? `Narcotics unit requests SWAT — fortified house, ${S.brief.report && S.brief.report.kind === 'atleast' ? 'at least two suspects' : S.brief.report ? S.brief.report.text : 'several suspects'} inside.` : S.stype.key === 'inmates' ? `Escaped inmate${S.brief.report && (S.brief.report.n > 1 || S.brief.report.kind === 'atleast') ? 's' : ''} forced into an occupied house — the family got out.` : S.stype.key === 'flee' ? (S.brief.report && S.brief.report.kind === 'atleast' ? 'At least one suspect — possibly more — fled from patrol into a vacant house.' : S.brief.report && S.brief.report.n > 1 ? `${S.brief.report.n} suspects fled from patrol into a vacant house.` : 'Suspect fled from patrol into a vacant house.') : S.stype.key === 'mental' ? 'Adult male in crisis, armed, alone inside.' : 'Adult male barricaded inside.'} Patrol cruisers blocking traffic at both ends of the block.`, 'alert');
  if (S.scene.injury) { const c = casById(S.scene.injury.cas), mate = S.units.find(u => u.kind === 'patrol' && u.status === 'ok' && !u.inCar);
    log(c.state === 'kia' ? `${mate ? mate.name : 'Patrol'}: "OFFICER DOWN! ${c.name} is hit in the front yard — he's not moving. We can't get to him!"` : c.state === 'mobile' ? `${c.name}: "I'm hit — I can move. I'm in the open out front, need cover!"` : c.sev === 3 ? `${mate ? mate.name : 'Patrol'}: "OFFICER DOWN! ${c.name} is hit out front, his condition is critical — we need help NOW!"` : `${c.name}: "I'm hit — I can't move. Front yard. Somebody get me out of here!"`, 'bad'); }
  log('SWAT team paged. Set containment from cover while the team responds.', 'system');
  const A = initialArrivals(); S.brief.arrival = A; v23Equip();
  if (A) log(A.mode === 'all' ? `SWAT: FULL TEAM ON SCENE — ${A.why}` : `SWAT: ${A.count} of ${A.of} on scene at staging — ${A.why}${A.count < A.of ? ' The rest are paged and en route.' : ''}`, A.mode === 'all' ? 'good' : 'system');
  S.officers.forEach(o => log(o.status === 'staged' ? `PAGER: ${o.name} (${SPECS[o.spec].name}${o.quals.length ? ', ' + o.quals.map(q => QUALS[q].name).join(', ') : ''}) ON SCENE at staging.` : `PAGER: ${o.name} (${SPECS[o.spec].name}${o.quals.length ? ', ' + o.quals.map(q => QUALS[q].name).join(', ') : ''}) en route — ETA ${tMin(o.eta)}.`, 'pager'));
  return S;
}

return { V23, makeRng, SUS_FIRST, SUS_LAST, CALLER_F, STREET_WORDS, CRIM, CRIM_COUNT, HID_CFG, crimHistory, streetName, mentalHook, v23Brief, usableCount, llState, llName, llShot, poolAt, bearcats, bearcatFor, eqArriveNow, eqHere, BC_KIT, poolZone, EQV_CFG, wallsNear, wallReach, wallAtTap, wallDesc, hangWallTap, hangwallGoal, hangCan, V22, behScore, debrief, winCellSet, WP_CFG, wpLegs, wpBeyond, addWaypoint, clearPath, legTurns, pathInfo, BEH, BEH_CFG, behOf, behInfo, behLearn, behTick, behNoWin, behAmbushCell, behRoamTarget, NON_SLING, rifleZone, rifleHere, handGearOf, pcamStart, pcamTape, pcamTick, pcamsNear, hangCharge, hungOf, detonateWalls, unhangCharge, WALL_KIND, suspectCars, garageStalls, GARAGE_CFG, TRAILER_ROT, V20, V21, freeable, inb, teamOkV21: teamOk, seeE, countOf, invOf, holds, rifleLeaver, rifleBurden, offSkill, polecamHands, dropList, wallSpotsFor, wallCharge, portsNear, portFire, camTargets, camHitP, shootCam, deviceHitP, k9Of, dogTargets, dogSend, sniffDoors, dogSniff, v21Actions, v21Do, encReactText, END_OPT, confText, formGap, wallSpots, FIRE_RATE, autoAcc, fireRate, shotsLeft, shotsUsed, bcSchedule, bcArriveNow, dracoTipOf, dracoTipInfo, dracoTipAct, dracoMinutes, dracoRate, TEAM_NAMES, dropItem, droppedNear, pickUp, throwPicks, prepThrower, bullhornUsable, voiceCallout, calloutMode, encFair, encViaWindow, encFollow, injWhere, injText, hitMessage, offTag, handsText, offRole, offSpecs, itemShort, WIN_OPTS, watchPts, carries, holds, canThrowFrom, SPEC2_MUL, GAS19, CS40_CFG, LL19, HELMETS, HELMET_CFG, TAKE_HOME, SPEC_KIT, gearHave, bestArmor, bestHelmet, helmetOf, takeHomeList, llMagOf, llOk, llSpend, upgradeLL, llKind, fetchSecondary, issueView, setupSpecs19, gasThrowAmt, helmetStops, gasAdd, isSpec, specMul, teamSpecMul, invActBase, GAME_VERSION, DEV_CFG, SIDE_CFG, SIDE_KEYS, devLabel, devDrain, sideSeen, houseSideAt, bigRobotWhyNot, bigRobotOperator, deployBigRobot, parkBigRobot, contactEffort, setupLocks, cornerAt, encSliceSees, doorSides, spHostile, dracoSpots, dracoContact, dracoFit, dracoSpotAt, openingNormal, ENC_CFG, ENC_TRAITS, ENC_POSES, ENC_OPTS, BLIND_OPTS, encOn, encWord, mindOf, encSeers, encPose, encRead, encDescribe, encWho, encOdds, encOptions, encBuild, encPause, encEndTurn, encCur, encChoose, encNext, encFinal, encExchange, encFirstP, encMarkDev, encJustified, encThreshold, blindChoose, encScore, encDebrief, encWithdraw, spAt, DRUG_CFG, INMATE_CFG, DUPLEX_CFG, TRAILER_CFG, DOOR_MUL, doorMul, exitWin, roomInPlay, camSees, camTurn, duplexTurn, partyBreach, thinWallTurn, types3Turn, cmdShown, structFor, STRUCT_CFG, STRUCT_KEYS, ownRooms, isOwnRoom, MULTI_TYPES, multiType, PAROLE_CFG, SOVCIT_CFG, BASE_KEYS, hiddenNow, applyTypeExtras, NEGO_FLAVOR, SCEN_TYPES, SCEN_KEYS, typeForSeed, stypeCfg, resolvedNoForce, onNeighborSide, typeFireMul, LEGAL_TXT, typeDebrief, SHOOT_CFG, MAX_RETURN_FIRE, returnFirers, returnFire, memberWeapon, primaryOf, suspectTick, suspectFire, TASER_CFG, doorExposed, FORM_CFG, wallSpots, doorStack, pickVictim, LL_CFG, DEVICE_ORDERS, deviceUser, deviceWhyNot, deviceShotReq, deviceChance, ARMOR, ARMOR_CFG, SHIELDS, SHIELD_CFG, SUSPECT_CAL, armorOf, shieldOf, armorHit, shotOfficer, suspectArmorStops, hasShield, teamArmor, revealSuspectArmor, officerDown, suspectHit, fireAt, DRACO_CFG, bearcat, installTicks, dracoTick, passE, edge, dracoTargetReq, openingMid,
  REAR_CFG, REAR_OFF, reach, newGame, get state() { return S; }, MULTI_CFG, suspList, multiSp, spName, spState, suspectCountInfo, fleeCount, patrolReport, suspById, withSp, eachSp, spHostile, spActive, setLead, MAP_W, MAP_H, TICKS, LOSE_DOWN, SCORE, withdraw, forceLeft, updateVision, computeVis, checkEnd, EQUIP, SPECS, QUALS, WEAPONS, SUSPECT_WEAPONS, STANCES, COVER_NAMES, COMMANDS, idx, roomAt, edge, los, losEx, findPath, planFor, queueOrder, undoOrder, clearOrders, AFTER_CFG, AFTER_ORDERS, setAfter, afterOrders, afterRoom, regroupSpot, regroupForm, startRegroup, roomDoorCells, addrLabels, ADDR_CFG, neighbourAddr,
  setCommand, execute, stepTick, formTeam, assign, equip, renameTeam, intelInfo, unit, off, teamOk, hasSpec, teamSkill, nearStaging, orderReq, setStance, BREACH, CHARGE_SAFE, breachEst, breachMethods, breachCan, defaultMethod, doorMid, gasAt, gasTurn, gasDeploy, gasCond, gasExpose, suspectGas, suspectGasTurn, masked, impairAcc, impairVis, donMasks, detonateCharge, dist, hitChance, coverInfo, expoAt, computeExpo,
  validateHouse, patrolStartOk, patrolCoverKind, suspSees, houseRectDist, onProperty, suspEyePts, vehId, vehDist, vehNear, VEH_CFG, PATROL_CFG, GEO_CFG, downedSpot, losEx, sceneTurn, validateWorld, footprint, carAxis, houseSideOf, exitCell, spotterOf, perchAt, owCone, weaponOf, onFoot, skillOf, houseCenter, carAt, snapCover, shieldAt, validateContain, COVER_CFG, exposedOrders, ITEM_CFG, INV_CFG, invAct, invView, invOf, isReady, teamWeapon, syncEquip, setTeamOrder, atEquipment, stagePos, CAR_SEATS, carSeats, seatsUsed, TURN_SEC, missionScore, careerSummary, ACT_XP, xpAct, xpSummary, callState, preview, cornerAt, cornerAvail, CORNER_CFG, FIRE_CFG, fireImpair, formationFor, FORM_CFG, initialArrivals, ARRIVE_CFG, mmss, tDur, tMin, clockAt, elapsedAt, sideWatch, watchAt, houseSides, statusCheck, review911, roadblockHeld, withVirtualCar, SCENE_CFG, VARIANT_TXT, setupScene, sceneDebrief, T_HIT, T_TRY,
  CAS_CFG, NEGO_CFG, TALK_KEYS, TALK_NAMES, casById, casActive, casKnow, sevWord, casLabel, setEMS, emsCheck, ccpFor, setSurrenderSpot, surrSpot, setTalk, talkAvail, negoSummary, negOnScene, paCapable, paInRange, paUnits, protocolNow, ambushChance, ambushRisk, walkout, addCasualty, officerDown, suspectHit, robotPhoneGoal, defaultEMS, hostile, contactTry, runTalk, paAct, casualtyTurn, applyAid };
})();
