// v18: device batteries in %, drone LAND, Throwbots, Large Robot (staging operator, opens unlocked doors only),
//      door lock world model, side visibility (sideSeen + per-turn history), after-action side/containment/contact scoring, version label.
const fs = require('fs'), path = require('path');
const Core = require('./load.js')(); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const prep = (seed, extra = {}) => { const S = Core.newGame(seed, Object.assign({ encounters: false }, extra)); S.officers.forEach(o => { o.status = 'staged'; o.stage = 'primary'; o.eta = 0; }); return S; };
const run = () => { Core.execute(); let g = 0; while (Core.state.phase === 'executing' && !Core.stepTick() && g++ < 300); if (Core.state.phase === 'encounter') { let k = 0; while (Core.state.phase === 'encounter' && k++ < 12) { const c = Core.encCur(); if (c && !c.done) Core.encChoose(c.options[0].key); const ph = Core.encNext(); if (ph === 'executing') { let q = 0; while (!Core.stepTick() && q++ < 300); } } } };
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// version label defined once
ok(/^v1[89]$|^v[2-9]\d$/.test(Core.GAME_VERSION), 'GAME_VERSION >= v18');
ok(/id="mm-ver"/.test(html) && /id="mn-ver"/.test(html) && new RegExp("GAME_VERSION = '" + Core.GAME_VERSION + "'").test(html) && (html.match(new RegExp("'" + Core.GAME_VERSION + "'", 'g')) || []).length === 1, 'version label element + single definition');

// --- locks: rates and separate rng (map unchanged) ---
let E = 0, L = 0, I = 0, H = 0, susBad = 0;
for (let s = 1; s <= 400; s++) { const S = Core.newGame(s); const sr = new Set(Core.suspList().map(x => x.room));
  for (const d of S.doors) { if (d.exterior && d.kind !== 'garage' && !d.fortified && !d.barricaded) { E++; L += d.locked ? 1 : 0; }
    else if (!d.exterior && d.kind === 'door' && !d.rooms.some(q => sr.has(q))) { I++; H += d.homeLock ? 1 : 0; }
    if (d.homeLock && d.rooms.some(q => sr.has(q))) susBad++; } }
ok(L / E > 0.9 && L / E < 0.99, 'exterior lock rate ~95% (' + (L / E).toFixed(3) + ')');
ok(H / I > 0.01 && H / I < 0.09, 'homeowner lock ~5% (' + (H / I).toFixed(3) + ')');
ok(susBad === 0, 'no homeowner lock on a suspect room door');

// --- devices: battery % drains ---
{ const S = prep(12345); const t = Core.formTeam(S.officers.filter(o => o.spec === 'tech').concat(S.officers.filter(o => o.spec !== 'tech')).slice(0, 4).map(o => o.id)).team; t.deployed = true;
  t.gear = t.gear || {}; const tx = t.x, ty = t.y + 3;
  let r = Core.queueOrder(t.uid, { type: 'drone', x: tx, y: ty }); ok(r.ok || /armory|No|carry/i.test(r.reason || ''), 'drone order queues: ' + (r.reason || ''));
  if (r.ok) { run(); const d = S.units.find(u => u.kind === 'drone'); ok(d && d.battery === 100 - Core.DEV_CFG.drone.move, 'drone moved −8% (' + (d && d.battery) + ')');
    run(); ok(d.battery === 100 - 8 - Core.DEV_CFG.drone.hover, 'drone hover −5% (' + d.battery + ')');
    ok(Core.queueOrder(d.uid, { type: 'land' }).ok, 'land order'); run(); ok(d.landed && d.battery === 100 - 8 - 5 - 3, 'landed −3% (' + d.battery + ')');
    ok(Core.visParams ? Core.visParams(d).range < 7 : true, 'landed drone shorter view');
    ok(!Core.queueOrder(d.uid, { type: 'land' }).ok, 'cannot land twice');
    ok(Core.queueOrder(d.uid, { type: 'move', x: d.x + 2, y: d.y }).ok, 'move after land'); run(); ok(!d.landed && d.battery === 84 - 8, 'took off and moved −8 (' + d.battery + ')');
    d.battery = 5; run(); ok(d.status === 'down', 'battery depleted at 0%'); }
  ok(Core.EQUIP.robot.short === 'Throwbot', 'robot relabelled Throwbot');
  const tb = Core.state.units.length; void tb; }
{ // throwbot drain via direct device
  const S = prep(777); const t = Core.formTeam(S.officers.slice(0, 4).map(o => o.id)).team; t.deployed = true;
  const r = Core.queueOrder(t.uid, { type: 'robot', x: t.x + 2, y: t.y }); if (r.ok) { run(); const b = S.units.find(u => u.kind === 'robot'); ok(b && /^Throwbot/.test(b.name), 'Throwbot name ' + (b && b.name));
    ok(b.battery === 100 - Core.DEV_CFG.robot.move || b.battery === 100 - Core.DEV_CFG.robot.still, 'throwbot first turn −5/−3 (' + b.battery + ')'); const b0 = b.battery; run(); ok(b.battery === b0 - Core.DEV_CFG.robot.still, 'throwbot stationary −3');
    ok(!Core.queueOrder(b.uid, { type: 'opendoor', door: 0 }).ok, 'throwbot cannot open doors'); }
  else ok(true, 'robot n/a: ' + r.reason); }

// --- Large Robot ---
let opened = 0, refusedLocked = 0;
for (const seed of [12345, 2024, 31337, 4242, 99]) { const S = prep(seed);
  ok(Core.bigRobotWhyNot() === null, 'large robot available s' + seed);
  const r = Core.setCommand('lrobot'); ok(r.ok && r.instant, 'deploy instant');
  const R = S.units.find(u => u.big), op = S.officers.find(o => o.status === 'operator');
  ok(R && R.name === 'Large Robot' && R.battery === 100 && op && op.opOf === R.uid, 'robot + operator');
  ok(Math.abs(R.x - S.ext.staging.x) + Math.abs(R.y - S.ext.staging.y) <= 8, 'spawns at primary staging');
  ok(!Core.formTeam([op.id]).ok, 'operator cannot join a team');
  ok(Core.bigRobotWhyNot() !== null, 'only one large robot');
  // try the front-most door
  const d = S.doors.filter(q => q.exterior && q.kind !== 'garage' && q.state === 'closed')[0];
  const wasLocked = d.locked || d.barricaded; const q = Core.queueOrder(R.uid, { type: 'opendoor', door: d.id });
  if (!q.ok) { ok(true, 'door unreachable s' + seed + ' ' + q.reason); continue; }
  for (let k = 0; k < 15 && R.orders.length && Core.state.phase === 'planning'; k++) run();
  if (R.status !== 'ok') { ok(op.status === 'staged', 'disabled robot frees its operator'); continue; }
  if (R.orders.length) { ok(true, 'still driving s' + seed); continue; }
  ok(d.lockKnown, 'lock state known after attempt');
  if (wasLocked) { ok(d.state === 'closed', 'locked door stays closed'); refusedLocked++; } else { ok(d.state === 'open', 'unlocked door opens'); opened++; }
  ok(R.battery < 100 && R.battery >= 100 - 15 * Core.DEV_CFG.big.move, 'large robot drained ' + R.battery);
  ok(Core.parkBigRobot(R.uid).ok && op.status === 'staged', 'park frees operator'); }
ok(refusedLocked >= 1, 'at least one locked refusal observed (' + refusedLocked + ', opened ' + opened + ')');
{ // forced unlocked + barricaded doors (retry seeds where he shoots the robot first)
  const tryDoor = (lock, barr) => { for (const seed of [31337, 12345, 777, 2024, 4242, 99, 5150, 8080]) { const S = prep(seed); Core.setCommand('lrobot'); const R = S.units.find(u => u.big); const d = S.doors.filter(q => q.exterior && q.kind !== 'garage' && q.state === 'closed')[0];
      d.locked = lock; d.barricaded = barr; if (!Core.queueOrder(R.uid, { type: 'opendoor', door: d.id }).ok) continue; for (let k = 0; k < 15 && R.orders.length && R.status === 'ok'; k++) run(); if (R.status === 'ok' && !R.orders.length) return { S, R, d }; } return null; };
  const A = tryDoor(false, false); ok(A && A.d.state === 'open', 'forced-unlocked door opens');
  const B = tryDoor(false, true); ok(B && B.d.state === 'closed' && B.d.barrKnown, 'barricaded door fails');
  if (B) { B.R.battery = 1; run(); ok(B.R.status === 'down' && !B.S.officers.some(o => o.status === 'operator'), 'depleted robot releases operator'); } }
ok(Core.newGame(5, { gear: { robot: 0 } }) && Core.bigRobotWhyNot() !== null, 'no large robot when the unit has no robots');

// --- side visibility ---
{ const S = prep(12345); const v = Core.sideSeen(); ok(v.sides.length === 4 && v.all.length >= 3, 'sideSeen 4 sides');
  ok(v.seen.every(s => v.all.includes(s)) && v.seen.length + v.gaps.length === v.all.length, 'seen + gaps = all');
  const pts = Core.watchPts(); const rear = pts.find(p => p.side === 'rear');
  if (rear) { const before = Core.sideSeen().seen.includes('rear'); S.vis[rear.y * Core.MAP_W + rear.x] = 2; ok(Core.sideSeen().seen.includes('rear'), 'any vision (e.g. drone) on a rear opening counts (before ' + before + ')'); }
  ok(Core.houseSideAt(S.house.x0 + 1, S.house.y1 + 2) === 'front' && Core.houseSideAt(S.house.x0 + 1, S.house.y0 - 2) === 'rear', 'houseSideAt'); }
// --- scoring: history + debrief lines ---
{ const S = prep(31337); for (let k = 0; k < 4; k++) run(); const H = S.sideHist; ok(H && H.turns === 4, 'side history per turn (' + (H && H.turns) + ')');
  S.sideHist = { turns: 10, full: 5, miss: { rear: 6, left: 2 }, last: S.turn }; S.stats.barrEver = true; S.nego.attempts = 0; S.nego.everContact = false; S.nego.contact = null; S.stats.challenged = false;
  const M = Core.missionScore(), lab = M.items.map(i => i.label + ' ' + i.pts).join(' | ');
  ok(M.items.some(i => /unseen \(8 side-turns\)/.test(i.label) && i.pts === -8 * Core.SIDE_CFG.unseenPer), 'unseen side-turn deduction: ' + lab);
  ok(M.items.some(i => /Visual containment 50%/.test(i.label) && i.pts === Math.round(Core.SIDE_CFG.containMax * 0.5)), 'containment bonus');
  ok(M.items.some(i => /no attempt to contact/.test(i.label) && i.pts === Core.SIDE_CFG.noEffort), 'no-effort deduction');
  S.nego.attempts = 1; ok(!Core.missionScore().items.some(i => /no attempt/.test(i.label)), 'any attempt removes it');
  S.nego.attempts = 0; S.stats.challenged = true; ok(!Core.missionScore().items.some(i => /no attempt/.test(i.label)), 'verbal challenge counts');
  S.sideHist.miss = { rear: 500 }; ok(Core.missionScore().items.find(i => /unseen/.test(i.label)).pts === -Core.SIDE_CFG.unseenCap, 'cap');
  S.stats.barrEver = false; S.stats.challenged = false; ok(!Core.missionScore().items.some(i => /no attempt/.test(i.label)), 'no barricade → no effort deduction');
  const D = Core.debrief ? Core.debrief() : null; if (D) ok(D.some(l => l.k === 'Side visibility'), 'debrief side line'); }
// UI/render strings
ok(/Throwbot/.test(html) && /Large Robot/.test(html) && /drawSideEdges/.test(html) && /id="sidebox"/.test(html) && /#c9ced6/.test(html) && /devIcon/.test(html), 'UI/render hooks present');
ok(/Side visibility/.test(html) && /Door locks/.test(html) && /Land<\/b>/.test(html), 'help text');
console.log(`v18: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
