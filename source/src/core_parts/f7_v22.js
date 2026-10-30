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
