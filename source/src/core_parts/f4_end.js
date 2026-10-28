
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
