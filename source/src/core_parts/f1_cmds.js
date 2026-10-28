
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
      log(`Drone flyby: thermal signature ${S.rooms[sp.room] ? 'in the ' + S.rooms[sp.room].name : 'near the house'}. Window rooms mapped.`, 'intel'); fx('flyby', S.house.x0, S.house.y0); break; }
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
