
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
