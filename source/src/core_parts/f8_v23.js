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
