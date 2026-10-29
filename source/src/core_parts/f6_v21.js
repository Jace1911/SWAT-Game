/* ===================== v21 (batch 2: items 18-25) =====================
   18 shield / 40mm officers leave the rifle at the vehicle (slung rifle = -10% for them) · 19 plates are worn, never "taken"
   20 personal flashbang (max 3 each), pole cam carried one-handed but worked two-handed · 21 drop shield / ram
   22 breacher wall charges (through-wall hole, gun port) · 23 40mm / shotgun vs security cameras
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
function invAct(offId, act, k) { const o = off(offId); if (!o) return invAct19(offId, act, k); const inv = invOf(o), t = o.team ? unit(o.team) : null;
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
  if (r.ok && act === 'draw' && /^(shield|shield3|lesslethal)$/.test(k) && carries(o, 'rifle')) { const q = invAct(offId, 'return', 'rifle'); if (q.ok) { r.rifleLeft = true; log(`${o.name} leaves the rifle at the equipment vehicle (${EQUIP[k] ? EQUIP[k].short : k} officer).`, 'radio'); } }
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
/** kind 'hole' (through-wall: an opening that works like an open door) or 'port' (gun port: a chosen member can shoot through). */
function wallCharge(uid, kind, i) { const u = unit(uid); if (!u || u.kind !== 'team') return { ok: false, reason: 'No team' }; if (S.phase !== 'planning') return { ok: false, reason: 'Set charges during planning' };
  if (!hasSpec(u, 'breacher')) return { ok: false, reason: 'Only a breacher can set a wall charge' }; if (!(u.equip.charge > 0)) return { ok: false, reason: 'No breaching charge on the team — draw one at the equipment vehicle' };
  const w = wallSpotsFor(uid)[i || 0]; if (!w) return { ok: false, reason: 'Stand within 1.5 m of a wall' };
  const o = useItem(u, 'charge'); const [ax, ay] = w.a, [bx, by] = w.b, rb = roomAt(bx, by) >= 0 ? roomAt(bx, by) : roomAt(ax, ay);
  wallBlast(u, bx, by, rb); if (!S.wallLog) S.wallLog = [];
  if (!S.rng.chance(kind === 'port' ? V21.portP : V21.wallP)) { log(`${u.name}: ${o ? o.name : 'breacher'} fires the ${kind === 'port' ? 'gun-port' : 'wall'} charge on the ${w.dir} wall — the wall holds (no opening).`, 'alert'); S.wallLog.push({ kind, ok: false, turn: S.turn }); S.version++; return { ok: true, made: false }; }
  if (kind === 'port') { const p = { id: (S.ports || (S.ports = [])).length, a: w.a, b: w.b, key: w.key, to: w.to, team: u.uid, turn: S.turn }; S.ports.push(p); S.edges.set(w.key, { t: 'P', port: p });
    log(`${u.name}: gun port blown through the ${w.dir} wall into the ${w.to} — one officer can fire through it.`, 'radio'); S.wallLog.push({ kind, ok: true, turn: S.turn }); S.version++; return { ok: true, made: true, port: p }; }
  const ra = roomAt(ax, ay), d = { id: S.doors.length, cells: [[[ax, ay], [bx, by]]], state: 'open', locked: false, barricaded: false, exterior: ra < 0 || roomAt(bx, by) < 0, kind: 'hole', hole: true, name: `Wall breach (${w.to})`, known: true, storm: false, stormState: 'open', stormKnown: true, charge: null, rooms: [ra, roomAt(bx, by)] };
  S.doors.push(d); S.edges.set(w.key, { t: 'D', d }); if (S.peek) S.peek.push(idx(bx, by));
  log(`${u.name}: wall charge — a hole through the ${w.dir} wall into the ${w.to}. It works like an open doorway.`, 'radio'); S.wallLog.push({ kind, ok: true, turn: S.turn }); S.version++; return { ok: true, made: true, door: d }; }
function portsNear(uid) { const u = unit(uid); if (!u || !S.ports) return []; return S.ports.filter(p => dist(u.x, u.y, p.a[0], p.a[1]) <= V21.wallR + 0.01); }
/** A chosen member fires through a gun port (the team's per-turn rate of fire applies). */
function portFire(uid, pid, offId) { const u = unit(uid), p = S.ports && S.ports[pid], o = off(offId); if (!u || !p || !o || !u.members.includes(offId) || !teamOk(u).includes(o)) return { ok: false, reason: 'Pick a team member' };
  if (dist(u.x, u.y, p.a[0], p.a[1]) > V21.wallR + 0.01) return { ok: false, reason: 'Too far from the gun port' };
  const sp = S.suspect, ox = u.x, oy = u.y, e = S.edges.get(p.key); u.x = p.a[0]; u.y = p.a[1]; S.edges.set(p.key, E_OPEN); let r;
  try { log(`${o.name} fires through the gun port into the ${p.to}.`, 'radio'); r = fireAt(u, sp.x, sp.y, 'aimed'); } finally { S.edges.set(p.key, e); u.x = ox; u.y = oy; }
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
  if (hasSpec(u, 'breacher') && u.equip.charge > 0) wallSpotsFor(uid).forEach((w, i) => { out.push({ act: 'hole', a: i, icon: '💥', label: `Wall charge: hole (${w.dir} → ${w.to})`, on: plan }); out.push({ act: 'port', a: i, icon: '◎', label: `Gun port (${w.dir} → ${w.to})`, on: plan }); });
  portsNear(uid).forEach(p => teamOk(u).slice(0, 4).forEach(o => out.push({ act: 'pfire', a: p.id, b: o.id, icon: '➹', label: `Fire through port: ${o.name}`, on: plan && shotsLeft(u) > 0 })));
  camTargets(uid).forEach(c => out.push({ act: 'cam', a: c.id, icon: '📷', label: `Shoot camera (${c.name}, ${Math.round(c.p * 100)}%)`, on: plan }));
  if (k9Of(u)) { dogTargets(uid).slice(0, 6).forEach(t => out.push({ act: 'dog', a: t.room, icon: '🐾', label: `Send ${k9Of(u).dog}: ${t.name}`, on: plan })); sniffDoors(uid).forEach(d => out.push({ act: 'sniff', a: d.id, icon: '👃', label: `Door sniff: ${d.name}`, on: plan })); }
  return out; }
function v21Do(uid, act, a, b) { if (act === 'drop') return dropItem(a, b); if (act === 'hole' || act === 'port') return wallCharge(uid, act, +a); if (act === 'pfire') return portFire(uid, +a, b);
  if (act === 'cam') return shootCam(uid, +a); if (act === 'dog') return dogSend(uid, +a); if (act === 'sniff') return dogSniff(uid, +a); return { ok: false, reason: 'Unknown action' }; }
SPECS.k9.desc = 'Handler and dog (no second specialty). Passive: the dog indicates a suspect within 5 m through walls. Send the dog into a room up to 25 m away through an open way (barks, may hold the suspect), or sniff a door (75% to detect)';
