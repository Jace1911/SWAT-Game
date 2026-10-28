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
  let best = null, bs = 1e9; for (const q of S.rooms) { if (q.id === sp.room || q.type === 'hall' && S.rng.chance(0.5)) continue; const c = [q.x + (q.w >> 1), q.y + (q.h >> 1)]; if (S.room[idx(c[0], c[1])] !== q.id) continue;
    const s = q.gas * 10 + dist(sp.x, sp.y, c[0], c[1]) * 0.05; if (s < bs) { bs = s; best = c; } }
  if (best && gasAt(best[0], best[1]) < g * 0.6) { sp.home = { x: best[0], y: best[1] }; sp.mode = sp.mode === 'barricaded' ? 'alert' : sp.mode; log('Movement inside — someone is relocating away from the gas.', 'alert'); }
}
