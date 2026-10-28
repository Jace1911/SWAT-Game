/* =====================================================================
   MODULE 3 — UI / INPUT / AUDIO  (DOM + pointer events; calls Core API)
   ---------------------------------------------------------------------
   Everything here is platform glue. Port: replace with Godot Control
   nodes / Unity UI; the Core calls (queueOrder, execute, stepTick …)
   stay the same.
   ===================================================================== */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isPhone = () => window.innerWidth <= 760;
const V = Render.view;
let uiVer = -1, logLen = 0, busy = false, lastFxSound = 0, openTeam = null;

/* ---------------- audio (WebAudio beeps, no assets) ---------------- */
let actx = null, muted = localStorage.getItem('swat.muted') === '1';
function ac() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } } if (actx && actx.state === 'suspended') actx.resume(); return actx; }
function tone(f, d = 0.08, type = 'sine', vol = 0.08, when = 0, slide = 0) { if (muted) return; const a = ac(); if (!a) return; const t = a.currentTime + when; const o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + d);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g).connect(a.destination); o.start(t); o.stop(t + d + 0.02); }
function noise(d = 0.2, vol = 0.15, lp = 1200) { if (muted) return; const a = ac(); if (!a) return; const n = Math.floor(a.sampleRate * d), b = a.createBuffer(1, n, a.sampleRate), ch = b.getChannelData(0); for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(); f.type = 'lowpass'; f.frequency.value = lp; g.gain.value = vol; s.buffer = b; s.connect(f).connect(g).connect(a.destination); s.start(); }
const SFX = { click: () => tone(1400, 0.04, 'square', 0.03), order: () => { tone(880, 0.05, 'sine', 0.06); tone(1320, 0.06, 'sine', 0.05, 0.05); }, err: () => tone(220, 0.15, 'square', 0.05),
  exec: () => { tone(520, 0.08, 'sawtooth', 0.05); tone(780, 0.1, 'sawtooth', 0.05, 0.09); tone(1040, 0.14, 'sawtooth', 0.05, 0.19); }, pager: () => { tone(2100, 0.07, 'square', 0.04); tone(2100, 0.07, 'square', 0.04, 0.12); tone(2600, 0.1, 'square', 0.04, 0.24); },
  shot: () => noise(0.18, 0.25, 2600), breach: () => { noise(0.45, 0.35, 500); tone(70, 0.4, 'sine', 0.2, 0, 0.5); }, bang: () => { noise(0.6, 0.4, 4000); tone(3800, 0.6, 'sine', 0.02); }, thud: () => tone(110, 0.12, 'sine', 0.12, 0, 0.6),
  bad: () => { tone(660, 0.18, 'square', 0.05); tone(440, 0.25, 'square', 0.05, 0.2); }, good: () => { tone(660, 0.08); tone(880, 0.08, 'sine', 0.08, 0.09); tone(1320, 0.16, 'sine', 0.08, 0.18); } };
function sounds() { const S = Core.state;
  for (const f of S.fx) if (f.id > lastFxSound) { lastFxSound = f.id; if (f.type === 'shot') SFX.shot(); else if (f.type === 'breach' || f.type === 'blast') SFX.breach(); else if (f.type === 'flash') setTimeout(SFX.bang, 250); else if (f.type === 'thud' || f.type === 'glass') SFX.thud(); }
  let pager = false, bad = false, good = false; for (const e of S.events) { if (e.type === 'pager') pager = true; if (e.kind === 'bad') bad = true; if (e.kind === 'good') good = true; } S.events.length = 0;
  if (bad) SFX.bad(); else if (pager) SFX.pager(); else if (good) SFX.good(); }

/* ---------------- helpers ---------------- */
let toastT = 0; function toast(msg, ok) { const t = $('toast'); t.textContent = msg; t.className = 'show' + (ok ? ' ok' : ''); clearTimeout(toastT); toastT = setTimeout(() => t.className = '', 2300); if (!ok) SFX.err(); }
function shieldSVG(num, count, down) { return `<div class="shield"><svg viewBox="0 0 34 38"><defs><linearGradient id="sg${num}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${down ? '#5a1a24' : '#1b6fd6'}"/><stop offset="1" stop-color="${down ? '#2a0a10' : '#0a2a5a'}"/></linearGradient></defs><path d="M17 1.5 C22 4 27 4.5 32 4 L32 18 C32 27 25 33 17 36.5 C9 33 2 27 2 18 L2 4 C7 4.5 12 4 17 1.5Z" fill="url(#sg${num})" stroke="${down ? '#ff3b4e' : '#7fe3ff'}" stroke-width="1.6"/></svg><div class="n">${num}</div><div class="c">${count}</div></div>`; }
const SKILL = s => s >= 0.85 ? 'Elite' : s >= 0.75 ? 'Veteran' : s >= 0.65 ? 'Seasoned' : 'Trained';
function selUnit() { return V.sel ? Core.unit(V.sel) : null; }
function defMode(u) { return u && u.inCar ? 'drive' : 'move'; }
function select(uid) { V.sel = uid; V.mode = defMode(Core.unit(uid)); V.aim = null; hidePop(); SFX.click(); refresh(true); }
/* Action buttons. `kinds` = which unit kinds see the button (others are hidden, not just disabled). */
const ACTS = [
  { k: 'move', ic: '➜', name: 'Move', key: 'M', kinds: 'team patrol drone robot', tip: 'Tap anywhere to queue a move. A spot in view of the house is flagged EXPOSED before you execute (red path = exposed stretch) — you can still go' },
  { k: 'drive', ic: '⛟', name: 'Drive', key: 'M', kinds: 'incar', tip: 'Tap the street / a driveway to drive the vehicle there — everyone inside rides along' },
  { k: 'breach', ic: '✸', name: 'Breach', key: 'B', kinds: 'team', tip: 'Tap a door, then choose the method: charge, ram, Halligan pry or kick' },
  { k: 'detonate', ic: '✹', name: 'Detonate', key: 'X', kinds: 'team', tip: 'Tap a door with a hung charge to detonate it (team must be at a safe standoff)', eq: 'charge' },
  { k: 'bang', ic: '✦', name: 'Flashbang', key: 'F', kinds: 'team', tip: 'Tap a room to throw a flashbang', eq: 'bang' },
  { k: 'gas', ic: '☁', name: 'CS Gas', key: 'G', kinds: 'team', tip: 'Tap a room to deploy CS gas — it spreads through open doors; teams mask up automatically', eq: 'gas' },
  { k: 'mask', ic: 'Ⓜ', name: 'Mask', key: 'K', kinds: 'team', tip: 'Don / remove gas masks (donning takes one tick; masks slightly reduce vision and aim)', instant: true },
  { k: 'clear', ic: '▣', name: 'Clear', key: 'C', kinds: 'team', tip: 'Tap a room to enter and clear it' },
  { k: 'corner', ic: '◩', name: 'Work Corner', key: 'N', kinds: 'team patrol', tip: 'Slice the pie: from a hallway corner, door frame or house corner, the unit edges out in 45° cuts, revealing a little more each step, and stops the moment it sees a threat. Only a sliver of the unit is exposed while it works', instant: true },
  { k: 'shoot', ic: '◎', name: 'Fire', key: 'T', kinds: 'team patrol', tip: 'Tap the suspect / a window to fire aimed shots — the hit chance is shown before you commit' },
  { k: 'suppress', ic: '⁂', name: 'Suppress', key: 'U', kinds: 'team patrol', tip: 'Tap a window / room to lay suppressive fire: low hit chance, makes the suspect duck instead of firing' },
  { k: 'taser', ic: 'ϟ', name: 'Taser', key: '[', kinds: 'team patrol', tip: 'Deploy the taser at the suspect: needs him in view with a clear line within ~3 m. Hit odds rise up close (shown when queued); a hit incapacitates him for ~2 turns — move in for the arrest. The officer holsters/slings what he holds, draws the taser one-handed, then re-draws (not ready until next turn)', instant: true },
  { k: 'llfire', ic: '◍', name: 'Less-Lethal', key: ']', kinds: 'team', tip: 'Fire the 40mm less-lethal launcher (LL-qualified officer): range ~11 m, odds fall with range, sometimes no effect; a good hit stuns him 2–3 turns. Uses one round. Both hands: the carrier slings his weapon and re-draws after (not ready next turn). A shield or ram carrier cannot use it', instant: true },
  { k: 'overwatch', ic: '⌯', name: 'Overwatch', key: 'O', kinds: 'team', tip: 'Tap a green perch (neighbor window/roof) or a yard spot for the sniper; the cone shows the sight-lines' },
  { k: 'board', ic: '⛐', name: 'Get In', key: 'E', kinds: 'patrol team', tip: 'Tap a vehicle to get in (cruiser 2 seats, BearCat 10). Inside, this chip drives the vehicle' },
  { k: 'draco', ic: '⚒', name: 'Draco Breach', key: 'B', kinds: 'incar', tip: 'BearCat with the Draco arm: tap an exterior door or a window — the vehicle drives up and the boom rips it out (doors ~90% per pull, storm doors first; windows always). Loud; crew stays under armor' },
  { k: 'dracoinst', ic: '⚙', name: 'Install Draco', key: 'I', kinds: 'team', tip: 'Team of 2+ goes to the BearCat and mounts the Draco arm kit from the equipment pool: 5 turns of work, more exposed and not returning fire. Leaving interrupts (progress is kept)', instant: true },
  { k: 'exit-house', ic: '⇱', name: 'Exit · House', key: 'E', kinds: 'incar', tip: 'Occupants get out on the house side (fast, but exposed)', instant: true },
  { k: 'exit-safe', ic: '⇲', name: 'Exit · Safe', key: 'Q', kinds: 'incar', tip: 'Occupants get out on the far side, behind the car body (a driver sliding across takes +1 tick)', instant: true },
  { k: 'hold', ic: '■', name: 'Hold', key: 'H', kinds: 'team patrol incar drone robot', tip: 'Hold position for the rest of this 30 s', instant: true },
  { k: 'polecam', ic: '◉', name: 'Pole Cam', key: 'P', kinds: 'team', tip: 'Tap a door to look under it', eq: 'polecam' },
  { k: 'drone', ic: '✈', name: 'Drone', key: 'D', kinds: 'team', tip: 'Tap a spot to fly the micro-drone there', eq: 'drone' },
  { k: 'robot', ic: '⛭', name: 'Robot', key: 'R', kinds: 'team', tip: 'Tap a spot to drive the robot there', eq: 'robot' },
  { k: 'pa', ic: '📢', name: 'PA Contact', key: 'L', kinds: 'team incar', tip: 'Loudspeaker: ask him to pick up / talk (in range of the house). He may yell from a window or door — or fire at the voice', instant: true, sep: true },
  { k: 'callout', ic: '📣', name: 'Call Out', key: 'Y', kinds: 'team incar', tip: 'Contain & call out: order him out with hands up over the PA. Low odds; better with full containment, gas or rapport', instant: true },
  { k: 'tphone', ic: '☎', name: 'Throw Phone', key: 'J', kinds: 'team', tip: 'Tap a room: the team approaches an opening (open door / broken window) and throws the phone in. Can be blocked, shot or ignored', eq: 'tphone' },
  { k: 'rphone', ic: '⛭', name: 'Robot Phone', key: 'V', kinds: 'team', tip: 'Tap a room: the robot carries the throw-phone in through an open door (needs robot + Tech). Safer, slower', eq: 'tphone' },
  { k: 'aid', ic: '✚', name: 'First Aid', key: 'A', kinds: 'team patrol', tip: 'Tap a casualty: go to them and render aid (a Medic with a medkit stabilises; others buy a little time)', sep: true },
  { k: 'rescue', ic: '⇆', name: 'Rescue', key: 'W', kinds: 'team patrol', tip: 'Tap a casualty: reach them and drag them to the nearest casualty collection point in cover' },
  { k: 'evac', ic: '🚑', name: 'Evacuate', key: 'Z', kinds: 'team patrol', tip: 'Tap a casualty: carry them all the way to the EMS ambulance point (then transport to hospital)' },
];
const STANCE_ORDER = ['return', 'free', 'hold'], STANCE_IC = { return: '↺', free: '✱', hold: '⊘' };
function dracoActOk(u, k) { const S = Core.state; if (!S) return false; if (k === 'draco') { const c = u && u.inCar && Core.unit(u.inCar); return !!(c && c.draco); }
  if (k === 'dracoinst') { const c = Core.bearcat(); return !!(c && !c.draco && (c.dracoKit || S.armory.draco > 0)); }
  if (k === 'llfire') return !!(u && u.kind === 'team' && Core.teamOk(u).some(o => { const i = Core.invOf(o); return [].concat(i.hands, i.slung, i.packed || [], i.holster || []).includes('lesslethal'); }));
  if (k === 'taser') return !!(u && (u.kind === 'patrol' || (u.kind === 'team' && Core.teamOk(u).some(o => [].concat(Core.invOf(o).holster || [], Core.invOf(o).hands).includes('taser'))))); return true; }
function actsFor(u) { return (u ? ACTS.filter(a => a.kinds.split(' ').includes(u.inCar ? 'incar' : u.kind)) : ACTS.filter(a => a.kinds.includes('team'))).filter(a => dracoActOk(u, a.k)); }
function cornerHere(u) { if (!u || u.perch || (u.kind === 'patrol' && u.inCar)) return null; const [x, y] = planEnd(u); return Core.cornerAt(x, y, u); }
function allowed(u, k) { if (!u || u.status !== 'ok') return false; if (u.inCar && k === 'drive' && Core.unit(u.inCar) && Core.unit(u.inCar).disabled) return false; if (k === 'corner' && !cornerHere(u)) return false; return actsFor(u).some(a => a.k === k); }
const maskTxt = m => m === 'on' ? 'MASKED' : m === 'donning' ? 'MASKING…' : 'mask off (carried)';
const coverTxt = u => { if (u.inCar) return 'in ' + ((Core.unit(u.inCar) || {}).name || 'vehicle'); const c = Core.coverInfo(u.x, u.y); return c.level === 'inside' ? 'inside' : c.level === 'cover' ? `hard cover${c.obj ? ' · ' + c.obj : ''}` : c.level === 'partial' ? `concealed${c.obj ? ' · ' + c.obj : ''}` : 'EXPOSED'; };
const coverCol = u => { if (u.inCar) return 'var(--cyan2)'; const l = Core.coverInfo(u.x, u.y).level; return l === 'open' ? 'var(--red)' : l === 'partial' ? 'var(--amber)' : 'var(--green)'; };

/* ---------------- panels ---------------- */
/** Career is a between-scenarios menu: before the first EXECUTE of a scenario, or once it is over. */
function careerAllowed() { const S = Core.state; return !S || S.phase === 'over' || (S.phase === 'planning' && S.turn === 0); }
function renderTop() { const S = Core.state, I = Core.intelInfo(); $('opname').textContent = S.opName; const tt = S.phase === 'over' && !S.stats.withdrawn ? S.turn + 1 : S.turn, el = Core.elapsedAt(tt, S.phase === 'executing' ? S.tick : 0);
  // mission time lives in the radio log header (and the menu), not the top bar — information only, there is no time limit
  $('log-clock').textContent = `T+${el} · ${Core.clockAt(tt, S.phase === 'executing' ? S.tick : 0).slice(0, 5)}`; $('mn-time').textContent = el; $('mn-op').textContent = S.opName; $('st-seed').textContent = S.seed + (S.opts && S.opts.career ? ' · career' : '');
  const between = careerAllowed(), car = !!(S.opts && S.opts.career); $('b-state').style.display = car && S.phase !== 'over' ? '' : 'none'; $('b-main').disabled = car && !between; $('b-career').disabled = !between; $('mn-car').textContent = between ? 'Roster, record, unlocks' : 'Available between scenarios (debrief or before the first EXECUTE)';
  $('opsub').textContent = `BARRICADED SUBJECT · ${I.arch === 'UNKNOWN' ? 'RESIDENTIAL' : I.arch.toUpperCase()}`;
  const m = S.suspect.mode; const cls = S.phase === 'over' ? (S.result && S.result.win ? 'green' : 'red') : m === 'barricaded' ? 'red' : m === 'alert' || m === 'fleeing' ? 'amber' : 'green';
  $('st-status').innerHTML = `<span class="pill ${cls}">${S.phase === 'over' ? (S.result.win ? 'RESOLVED' : S.stats.withdrawn ? 'WITHDRAWN' : 'ENDED') : S.phase === 'executing' ? 'EXECUTING' : (I.suspect === 'UNKNOWN' ? 'BARRICADED' : I.suspect)}</span>`; }
function teamStatus(u) { const t = []; if (u.mask === 'on') t.push('<span style="color:var(--green)">Ⓜ masked</span>'); else if (u.mask === 'donning') t.push('<span style="color:var(--amber)">masking…</span>');
  if (u.impair > 0.1) t.push(`<span style="color:var(--amber)">☁ impaired ${Math.round(u.impair * 100)}%</span>`); if (u.stun > 0) t.push('<span style="color:var(--amber)">✷ dazed</span>');
  if (u.perch) t.push(`<span style="color:var(--green)">⌯ ${esc(u.perch.name || 'overwatch')}</span>`); return t.join(' · '); }
/** v9 armor badge: IIIA soft vests / rifle plates, plus the shield tier. */
function armorChip(u) { const a = Core.teamArmor(u); if (!a.soft && !a.plate) return ''; const p = [];
  if (a.plate) p.push(`<b style="color:var(--green)">PL×${a.plate}</b>`); if (a.soft) p.push(`IIIA×${a.soft}`); if (a.shield) p.push(a.shield === 'shield3' ? 'Shield III' : 'Shield IIIA');
  return `<span class="chip arm" title="Body armor: IIIA soft vests stop handgun / shotgun; PL = rifle plates (stop most rifle rounds)">🦺 ${p.join(' · ')}</span>`; }
function teamCard(u) { const S = Core.state, n = Core.teamOk(u).length, down = u.status !== 'ok'; const specs = [...new Set(Core.teamOk(u).map(o => o.spec))].map(sp => Core.SPECS[sp].icon).join(' ');
  const ri = Core.roomAt(u.x, u.y); const where = ri >= 0 && S.rooms[ri].known ? S.rooms[ri].name : Core.nearStaging(u.x, u.y) ? 'Staging' : 'Exterior';
  const eq = armorChip(u) + Object.keys(u.equip).filter(k => u.equip[k] > 0 && k !== 'plate').map(k => `<span class="chip">${Core.EQUIP[k].short}${u.equip[k] > 1 ? '×' + u.equip[k] : ''}</span>`).join('');
  const st = teamStatus(u);
  return `<div class="card ${V.sel === u.uid ? 'sel' : ''} ${down ? 'down' : ''}" data-sel="${u.uid}">${shieldSVG(u.num, n, down)}<div style="min-width:0;flex:1"><div class="nm">${esc(u.name.toUpperCase())} <span style="color:var(--dim);font-weight:600;font-size:11px">${specs}</span></div>
    <div class="meta">${down ? '<span style="color:var(--red)">COMBAT INEFFECTIVE</span>' : `${n} officers · ${where} · <span style="color:${coverCol(u)}">${coverTxt(u)}</span> · ${u.orders.length} ord`}</div>
    ${!down ? `<div class="meta">${Core.STANCES[u.stance] || ''}${st ? ' · ' + st : ''}</div>` : ''}<div class="chips">${eq}</div></div><button class="info" data-team="${u.uid}" title="Team details">ⓘ</button></div>`; }
function patrolCard(u) { const S = Core.state, c = S.contain.find(q => Math.hypot(q.x - u.x, q.y - u.y) <= 1.6), down = u.status !== 'ok';
  const car = u.inCar ? Core.unit(u.inCar) : null;
  const st = down ? '<span style="color:var(--red)">DOWN</span>' : u.panic > 0 ? '<span style="color:var(--amber)">PANICKED</span>' : u.retreating ? '<span style="color:var(--amber)">FALLING BACK</span>' : u.impair > 0.1 ? `<span style="color:var(--amber)">COUGHING ${Math.round(u.impair * 100)}%</span>` : car ? `In ${esc(car.name)}` : c ? 'Covering ' + c.name : 'Unassigned post';
  return `<div class="card ${V.sel === u.uid ? 'sel' : ''} ${down ? 'down' : ''}" data-sel="${u.uid}"><div class="pbadge" style="border-color:${down ? 'var(--red)' : u.panic > 0 || u.impair > 0.1 ? 'var(--amber)' : '#9fb7d0'}">P${u.num}</div><div style="min-width:0"><div class="nm" style="font-size:12px">${esc(u.name)}</div>
    <div class="meta">${st}${down ? '' : ` · <span style="color:${coverCol(u)}">${coverTxt(u)}</span>`}${u.orders.length ? ' · ' + u.orders.length + ' ord' : ''}</div>${down ? '' : `<div class="meta">${Core.STANCES[u.stance] || ''} · no gas mask</div>`}</div></div>`; }
function cruiserCard(u) { const occ = u.occ.map(id => Core.unit(id)).filter(Boolean); const side = Core.houseSideOf(u);
  return `<div class="card vcard ${u.disabled ? 'down' : ''}" title="Vehicles are commanded through the officer or team inside"><div class="pbadge" style="border-color:${u.disabled ? 'var(--red)' : u.hits ? 'var(--amber)' : 'var(--cyan2)'};border-radius:7px">${u.num ? 'C' + u.num : 'C'}</div><div style="min-width:0"><div class="nm" style="font-size:12px">${esc(u.name)}</div>
    <div class="meta">${u.disabled ? '<span style="color:var(--red)">DISABLED</span>' : occ.length ? occ.map(o => o.kind === 'team' ? o.name : 'P' + o.num).join(', ') + ' inside — select their chip to drive' : 'Empty — static cover (Get In to drive)'}${u.hits ? ` · <span style="color:var(--amber)">${u.hits} hit${u.hits > 1 ? 's' : ''}</span>` : ''}${u.orders.length ? ' · ' + u.orders.length + ' ord' : ''}</div>
    <div class="meta">Driver side faces ${side === 'driver' ? '<span style="color:var(--amber)">the house</span>' : 'away from the house'}</div></div></div>`; }
function renderTeams() { const S = Core.state; const teams = S.units.filter(u => u.kind === 'team'); let h = '';
  h += `<div class="sec">SWAT Teams</div>`; h += teams.length ? teams.map(teamCard).join('') : `<div class="row" style="color:var(--dim)">No team formed yet — officers arrive by pager.</div>`;
  const staged = S.officers.filter(o => o.status === 'staged' && !o.team);
  if (staged.length) { for (const sg of ['primary', 'secondary']) { const L = staged.filter(o => (o.stage || 'primary') === sg); if (!L.length) continue;
      h += `<div class="sec">${sg === 'primary' ? 'Primary Staging · Equipment Vehicle' : 'Secondary Staging · On Foot'}</div>`; h += L.map(o => `<div class="row"><span style="color:var(--cyan2)">${Core.SPECS[o.spec].icon}</span>${esc(o.name)}${o.quals.map(q => ' <span class="chip">' + Core.QUALS[q].icon + '</span>').join('')}<span class="r">${Core.SPECS[o.spec].name}</span></div>`).join(''); }
    h += `<button id="b-form" style="width:100%;margin-top:6px" ${S.phase !== 'planning' ? 'disabled' : ''}>＋ Form Team…</button>`; }
  const enr = S.officers.filter(o => o.status === 'enroute');
  if (enr.length) { h += `<div class="sec">Paged · En Route</div>`; h += enr.map(o => `<div class="row" style="color:#c6b8f0"><span>📟</span>${esc(o.name)}<span class="r">${Core.SPECS[o.spec].name} · ETA ${Core.tMin(Math.max(1, o.eta - S.turn))}</span></div>`).join(''); }
  h += `<div class="sec">Patrol (Perimeter)</div>`; h += S.units.filter(q => q.kind === 'patrol').map(patrolCard).join('');
  const cars = S.units.filter(q => q.kind === 'cruiser'); if (cars.length) { h += `<div class="sec">Vehicles</div>`; h += cars.map(cruiserCard).join(''); }
  const devs = S.units.filter(q => (q.kind === 'drone' || q.kind === 'robot') && q.status === 'ok');
  if (devs.length) { h += `<div class="sec">Devices</div>`; h += devs.map(u => `<div class="card ${V.sel === u.uid ? 'sel' : ''}" data-sel="${u.uid}"><div class="pbadge" style="border-color:var(--violet)">${u.kind === 'drone' ? 'D' : 'R'}</div><div><div class="nm" style="font-size:12px">${esc(u.name)}</div><div class="meta">Battery ${Core.tMin(u.battery)}</div></div></div>`).join(''); }
  $('teams').innerHTML = h; $('l-count').textContent = `${S.officers.filter(o => o.status === 'ok').length} DEPLOYED`;
  // phone chips
  let c = ''; for (const u of teams) c += `<div class="tchip ${V.sel === u.uid ? 'sel' : ''}" data-sel="${u.uid}">${shieldSVG(u.num, Core.teamOk(u).length, u.status !== 'ok')}${esc(u.name)}${u.mask === 'on' ? ' Ⓜ' : ''}</div>`;
  for (const u of S.units.filter(q => q.kind === 'patrol' && q.status === 'ok')) c += `<div class="tchip ${V.sel === u.uid ? 'sel' : ''}" data-sel="${u.uid}"><div class="pbadge" style="width:24px;height:24px;font-size:9px;border-color:${coverCol(u)}">P${u.num}</div></div>`;
  for (const u of cars) c += `<div class="tchip ${V.sel === u.uid ? 'sel' : ''}" data-sel="${u.uid}"><div class="pbadge" style="width:24px;height:24px;font-size:9px;border-radius:6px;border-color:${u.disabled ? 'var(--red)' : 'var(--cyan2)'}">C${u.num || ''}</div></div>`;
  if (enr.length) c += `<div class="tchip" style="color:#c6b8f0">📟 ${enr.length} en route</div>`;
  if (staged.length) c += `<div class="tchip" id="c-form" style="color:var(--green)">＋ Form team (${staged.length})</div>`;
  $('chips').innerHTML = c; }
function negRow() { const N = Core.negoSummary(); if (N.outcome) return `<span>Negotiation</span><b style="font-size:11px;color:var(--green)">${esc(N.outcome)}</b>`;
  if (N.contact) return `<span>Negotiation</span><b style="font-size:11px;color:var(--green)">${N.contact === 'phone' || N.contact === 'tphone' ? 'ON THE LINE' : 'PA CONTACT'} · ${Core.state.suspect.talk | 0}%</b><span>Mood</span><b style="font-size:11px">${esc(N.mood)}</b>`;
  return `<span>Negotiation</span><b style="font-size:11px;color:var(--dim)">${N.onScene ? (N.numberKnown ? 'number known' : N.line ? 'phone inside' : 'no contact') : 'negotiator en route'}</b>`; }
function casPill(c, o) { if (!c) return `<span class="pill red">${o.stable ? 'STABLE' : 'HIT'}</span>`; const col = c.state === 'kia' || c.state === 'lost' ? '' : c.state === 'evacuated' || c.state === 'transport' || c.stable ? 'green' : c.state === 'mobile' ? 'amber' : 'red';
  return `<span class="pill ${col}" title="${esc(Core.sevWord(c))}">${esc(Core.casLabel(c).toUpperCase())}${Core.casActive(c) && !c.stable ? ' · ' + Core.tDur(c.crit) : ''}</span>`; }
function casOf(o) { return (Core.state.cas || []).find(c => c.who === 'officer' && c.ref === o.id); }
function renderInfo() { const S = Core.state, I = Core.intelInfo(), sp = S.suspect;
  const thrCol = /VISUAL|ARMED|LOCATED/.test(I.threat) ? 'var(--red)' : 'var(--dim)';
  $('binfo').innerHTML = `<span>Layout</span><b style="font-size:11px">${esc(I.arch)}</b><span>Rooms known</span><b>${I.roomsKnown} / ${I.roomsTotal}</b><span>Rooms cleared/viewed</span><b>${I.explored}</b><span>Threat</span><b style="color:${thrCol};font-size:11px">${I.threat}</b><span>Weapon</span><b style="font-size:11px">${esc(I.weapon)}</b><span>Suspect</span><b>${I.suspect}</b>${suspRows(I)}${S.suspect.armorKnown && S.suspect.armor !== 'none' ? `<span>Body armor</span><b style="color:var(--amber);font-size:11px">${S.suspect.armor === 'plate' ? 'Plate carrier — aim for uncovered areas / .308' : 'Soft vest — rifles penetrate'}</b>` : ''}`
    + (sp.maskSeen ? `<span>Gas mask</span><b style="color:var(--red)">WEARING ONE</b>` : '') + (sp.visible && sp.impair > 0.1 && !sp.maskOn ? `<span>Condition</span><b style="color:var(--amber)">COUGHING</b>` : '')
    + (I.containKnown ? `<span>Containment</span><b style="color:${I.contain === I.containTotal && !I.sides.gaps.length ? 'var(--green)' : 'var(--amber)'}">${I.contain} / ${I.containTotal} posts · ${I.sides.n}/${I.sides.of} sides${I.sides.gaps.length ? ' · GAP ' + I.sides.gaps.join(', ').toUpperCase() : ''}</b>` : `<span>Containment</span><b style="color:var(--dim);font-size:11px">? — run a Status Check</b>`) + `${negRow()}${I.cas ? `<span>Casualties</span><b style="color:var(--amber)">${I.cas} need help</b>` : ''}<span>Intel action</span><b style="color:var(--cyan2)">${S.cmd ? Core.COMMANDS[S.cmd].name : '—'}</b>`;
  $('intelpct').textContent = I.level + '%'; $('intelbar').style.width = I.level + '%'; }
/** v11: multi-suspect calls — the count stays unknown until every suspect is seen and the house is cleared. */
function suspCountTxt(I) { const C = I.count; if (!C) return ''; return C.confirmed ? `${C.total} confirmed` : `Unknown (${C.seen} seen)`; }
function suspRows(I) { if (!I.multiType) return ''; const C = I.count; let h = `<span>Suspect count</span><b style="font-size:11px;color:${C.confirmed ? 'var(--green)' : 'var(--amber)'}">${suspCountTxt(I)}</b>`;
  if (I.suspects.length > 1 || (C.total || 0) > 1) h += I.suspects.map(x => `<span style="padding-left:8px">· ${esc(x.name)}</span><b style="font-size:10.5px;font-weight:600;color:${/CUSTODY/.test(x.state) ? 'var(--green)' : /ARMED|ALERT|FIGHT|FLEE/.test(x.state) ? 'var(--red)' : 'var(--amber)'}">${esc(x.state)}${x.visible ? ' · in view' : ''}</b>`).join('');
  return h; }
function renderMini() { const S = Core.state, I = Core.intelInfo(), last = S.log[S.log.length - 1];
  $('bmini').innerHTML = `<div class="mr"><span>Suspect</span><b>${esc(I.suspect)}</b></div><div class="mr"><span>Threat</span><b>${esc(I.threat)}</b></div>${I.multiType ? `<div class="mr"><span>Count</span><b>${esc(suspCountTxt(I))}</b></div>` : ''}<div class="mr"><span>Rooms</span><b>${I.roomsKnown}/${I.roomsTotal} · ${I.explored} seen</b></div><div class="mr"><span>Intel</span><b>${I.level}%</b></div>`
    + (last ? `<div class="ml"><i>T+${Core.elapsedAt(last.turn, last.tick)}</i>${esc(last.text)}</div>` : ''); }
function renderLog(force) { const S = Core.state; if (!force && S.log.length === logLen) return; logLen = S.log.length; const L = S.log.slice(-60);
  $('log').innerHTML = L.map(e => `<div class="${e.kind}"><span class="t" title="${Core.clockAt(e.turn, e.tick)} time of day">T+${Core.elapsedAt(e.turn, e.tick)}</span>${esc(e.text)}</div>`).join(''); $('log').scrollTop = 1e6;
  const last = L[L.length - 1]; $('ticker').textContent = last ? `T+${Core.elapsedAt(last.turn, last.tick)} ${last.text}` : ''; renderMini(); }
function renderActs() { const S = Core.state, u = selUnit(); let h = ''; const list = actsFor(u);
  for (const a of list) { const ok = !!u && allowed(u, a.k) && S.phase === 'planning'; const cnt = a.eq && u && u.equip ? u.equip[a.eq] || 0 : null;
    const nm = a.k === 'mask' && u ? (u.mask === 'on' ? 'Mask Off' : 'Masks On') : a.name;
    h += `<button class="act ${V.mode === a.k && u ? 'on' : ''}" data-act="${a.k}" ${ok ? '' : 'disabled'} title="${esc(a.tip)} (${a.key})"><span class="ic">${a.ic}</span>${nm}${cnt !== null && u && u.kind === 'team' ? `<span class="ct">${cnt}</span>` : ''}</button>`;
    if (a.k === 'hold') h += '<span class="vsep"></span>'; }
  { const nc = (S.cas || []).filter(c => Core.casActive(c) && c.known && c.who !== 'suspect').length; if (nc) h += `<span class="vsep"></span><span class="chip" style="align-self:center;color:var(--amber);white-space:nowrap" title="Known casualties needing help">✚ ${nc} casualt${nc === 1 ? 'y' : 'ies'}</span>`; }
  if (u && (u.kind === 'team' || u.kind === 'patrol')) { const st = u.stance || 'return';
    h += `<button class="act" data-act="stance" ${S.phase === 'planning' && u.status === 'ok' ? '' : 'disabled'} title="Fire stance (S): Return fire → Fire at will → Hold fire. Officers return fire automatically when the suspect shoots"><span class="ic">${STANCE_IC[st]}</span>${st === 'return' ? 'Ret. Fire' : st === 'free' ? 'At Will' : 'Hold Fire'}</button>`; }
  h += '<span class="vsep"></span>';
  h += `<button class="act ${S.cmd ? 'on' : ''}" data-act="intel" ${S.phase === 'planning' ? '' : 'disabled'} title="Intel & negotiation (I)"><span class="ic">◈</span>Intel</button>`;
  h += `<button class="act" data-act="undo" ${u && u.orders.length && S.phase === 'planning' ? '' : 'disabled'} title="Undo last order (Backspace)"><span class="ic">↶</span>Undo</button>`;
  h += `<button class="act" data-act="clearall" ${u && u.orders.length && S.phase === 'planning' ? '' : 'disabled'} title="Clear this unit's orders"><span class="ic">✕</span>Cancel</button>`;
  $('acts').innerHTML = h;
  const n = S.units.reduce((a, q) => a + (q.status === 'ok' ? q.orders.length : 0), 0) + (S.cmd ? 1 : 0);
  $('exec').disabled = S.phase !== 'planning'; $('exec-sub').textContent = S.phase === 'executing' ? `TICK ${S.tick}/${Core.TICKS}` : `${n} ORDER${n === 1 ? '' : 'S'} QUEUED`; const xo = S.phase === 'planning' ? Core.exposedOrders() : []; $('exec').classList.toggle('warn', xo.some(e => e.end)); if (xo.length && S.phase === 'planning') $('exec-sub').textContent = `⚠ ${xo.filter(e => e.end).length ? xo.filter(e => e.end).length + ' END EXPOSED' : xo.length + ' EXPOSED ROUTE'} · ${n} ORDER${n === 1 ? '' : 'S'}`; }
function renderHint() { const S = Core.state, u = selUnit(); let t;
  if (S.phase === 'executing') t = `Executing ${Core.elapsedAt(S.turn)} → ${Core.elapsedAt(S.turn + 1)} … ${Core.elapsedAt(S.turn, S.tick)}`;
  else if (S.phase === 'over') t = 'Operation complete — start a New Scenario';
  else if (!u) t = isPhone() ? 'Tap a shield or patrol chip (vehicles: tap who is inside) · drag to pan · pinch to zoom' : 'Select a team or patrol officer — vehicles are driven by whoever is inside (click map / card / 1–9) · drag to pan · wheel to zoom';
  else { const a = actsFor(u).find(q => q.k === V.mode); t = `${u.name}: ${a ? a.tip : ''}`; }
  if (V.hint) t = V.hint; $('hint').textContent = t; }
function refresh(force) { const S = Core.state; if (!force && uiVer === S.version) return; uiVer = S.version; { const su = selUnit(); if (su && su.inCar && V.mode === 'move') V.mode = 'drive'; else if (su && !su.inCar && V.mode === 'drive') V.mode = 'move'; } renderTop(); renderTeams(); renderInfo(); renderLog(force); renderActs(); renderHint(); if (openTeam && $('m-team').classList.contains('show')) renderTeamDlg(); layoutSafe(); }

/* ---------------- team detail modal ---------------- */
function renderTeamDlg() { const S = Core.state, u = Core.unit(openTeam); if (!u) { closeModal('m-team'); return; }
  const at = Core.nearStaging(u.x, u.y), planning = S.phase === 'planning'; const others = S.units.filter(q => q.kind === 'team' && q !== u);
  const qualChips = o => (o.quals || []).map(q => `<span class="chip" title="${esc(Core.QUALS[q].desc)}">${Core.QUALS[q].icon} ${Core.QUALS[q].name}</span>`).join(' ');
  const role = o => o.id === u.members[0] ? '<span class="chip" style="color:var(--green)">POINT</span> ' : o.id === u.members[1] ? '<span class="chip" style="color:var(--cyan2)">DEF</span> ' : '';
  const mem = u.members.map(id => Core.off(id)).map((o, i) => `<tr><td><div style="display:flex;gap:4px;align-items:center"><span class="ord">${i + 1}</span><button class="mini" data-up="${o.id}" ${planning && i ? '' : 'disabled'} aria-label="Move up">▲</button><button class="mini" data-dn="${o.id}" ${planning && i < u.members.length - 1 ? '' : 'disabled'} aria-label="Move down">▼</button></div>${role(o)}<b style="color:#fff">${esc(o.name)}</b><div><button class="mini ld" data-load="${o.id}">🎒 ${handsTxt(o)}</button></div>${o.dog ? `<div style="font-size:10.5px;color:var(--dim)">K9 "${o.dog}"</div>` : ''}${o.quals && o.quals.length ? `<div class="chips">${qualChips(o)}</div>` : ''}</td><td><span style="color:var(--cyan2)">${Core.SPECS[o.spec].icon}</span> ${Core.SPECS[o.spec].name}<div style="font-size:10.5px;color:var(--dim)">${Core.SPECS[o.spec].desc}</div></td>
    <td style="width:90px"><div style="font-size:10.5px;color:var(--dim)">${SKILL(o.skill)} · ${Math.round(o.skill * 100)}</div><div class="bar"><i style="width:${Math.round(o.skill * 100)}%"></i></div></td>
    <td>${o.status === 'down' ? casPill(casOf(o), o) : `<select data-move="${o.id}" ${planning ? '' : 'disabled'}><option value="">Move to…</option><option value="__staging">Staging (unassign)</option>${others.map(t => `<option value="${t.uid}">${esc(t.name)}</option>`).join('')}</select>`}</td></tr>`).join('');
  const eq = Object.keys(Core.EQUIP).filter(k => u.equip[k] > 0).map(k => `<span class="chip">${Core.EQUIP[k].short}${u.equip[k] > 1 ? '×' + u.equip[k] : ''}</span>`).join(' ') || '<span class="chip">Personal weapons only</span>';
  const specs = [...new Set(Core.teamOk(u).map(o => o.spec))].map(sp => `<span class="chip">${Core.SPECS[sp].icon} ${Core.SPECS[sp].name}</span>`).join('');
  // capability summary: overwatch / spotter, breaching methods, masks
  const sp = Core.spotterOf(u); const caps = [];
  if (Core.hasSpec(u, 'marksman')) caps.push(`<b style="color:#fff">Overwatch:</b> sniper ready${sp ? ` · spotter <b style="color:var(--green)">${esc(sp.name)}</b> (${esc(sp.label)}, ×${sp.mult} hit chance)` : ' · <span style="color:var(--amber)">no spotter (add any officer; a qualified Sniper Spotter is best)</span>'}`);
  caps.push(`<b style="color:#fff">Breach methods:</b> ${Object.keys(Core.BREACH).map(m => { const c = Core.breachCan(u, m); return c === true ? `<span class="chip">${Core.BREACH[m].name}</span>` : `<span class="chip" style="opacity:.45" title="${esc(c)}">${Core.BREACH[m].name}</span>`; }).join(' ')}${Core.hasSpec(u, 'breacher') ? ' · <span style="color:var(--green)">⚒ Breacher on team (better odds)</span>' : ''}`);
  { const a = Core.teamArmor(u); caps.push(`<b style="color:#fff">Body armor:</b> ${a.plate ? `<span style="color:var(--green)">${a.plate} with rifle plates</span>` : ''}${a.plate && a.soft ? ' · ' : ''}${a.soft ? `${a.soft} soft IIIA only (stops handgun / shotgun, not rifle)` : ''}${a.shield ? ` · <b style="color:#fff">Shield:</b> ${Core.SHIELDS[a.shield].name}` : ''}`); }
  caps.push(`<b style="color:#fff">Gas masks:</b> ${maskTxt(u.mask)}${u.impair > 0.1 ? ` · <span style="color:var(--amber)">impaired ${Math.round(u.impair * 100)}%</span>` : ''}${u.stun > 0 ? ' · <span style="color:var(--amber)">dazed</span>' : ''} · <b style="color:#fff">Stance:</b> ${Core.STANCES[u.stance]}`);
  $('team-dlg').innerHTML = `<div class="ph">${shieldSVG(u.num, Core.teamOk(u).length, u.status !== 'ok')}<input type="text" id="t-name" maxlength="14" value="${esc(u.name)}" aria-label="Team name"><span class="sp"></span><small>SKILL ${Math.round(Core.teamSkill(u) * 100)} · ${Core.teamOk(u).length}/${u.members.length} ACTIVE</small><button class="ib" data-close="m-team">✕</button></div>
  <div class="body"><div class="chips" style="margin-bottom:8px">${specs || '<span class="chip">No specialties</span>'}</div>
  <div style="font-size:11.5px;color:#bcd0e6;display:grid;gap:4px;margin-bottom:6px">${caps.map(c => `<div>${c}</div>`).join('')}</div>
  <div class="sec">Members</div><table><tr><th>Officer</th><th>Specialty</th><th>Skill</th><th>Assign</th></tr>${mem}</table>
  ${others.length ? '' : '<div style="font-size:11px;color:var(--dim);margin-top:6px">Form a second team (staging) to transfer members between teams.</div>'}
  <div class="sec">Equipment (usable now)</div><div class="chips">${eq}</div><div style="font-size:11px;color:var(--dim);margin-top:4px">Each officer carries his own gear — tap 🎒 on a member for his loadout (hands, holster, sling, pack). ${at ? '<span style="color:var(--green)">At the equipment vehicle: draw / return gear there.</span>' : 'Gear is drawn only at the equipment vehicle (primary staging).'}</div>
  <div style="display:flex;gap:8px;margin-top:14px"><button data-close="m-team" style="flex:1">Done</button><button id="t-sel" style="flex:1" class="on">Give Orders</button></div></div>`; }
function openTeamDlg(uid) { openTeam = uid; renderTeamDlg(); $('m-team').classList.add('show'); SFX.click(); }
function closeModal(id) { closeModal0(id); if (!hasGame) setTimeout(() => { if (!hasGame && !document.querySelector('.modal.show')) openMain(); }, 0); }
function closeModal0(id) { const ids = id ? [id] : ['m-team', 'm-intel', 'm-help', 'm-end', 'm-brief', 'm-911', 'm-career', 'm-wd', 'm-menu', 'm-main', 'm-calls', 'm-form', 'm-load']; if (ids.includes('m-911')) stopSpeech(); for (const k of ids) { const m = $(k); if (m) m.classList.remove('show'); if (k === 'm-team') openTeam = null; if (k === 'm-load') { LOAD = null; if (openTeam) renderTeamDlg(); } } }
$('team-dlg').addEventListener('change', e => { const t = e.target;
  if (t.id === 't-name') { Core.renameTeam(openTeam, t.value); refresh(true); }
  if (t.dataset.move) { const r = Core.assign(t.dataset.move, t.value === '__staging' ? null : t.value); if (!r.ok) toast(r.reason); else SFX.order(); if (!Core.unit(openTeam)) closeModal('m-team'); refresh(true); } });
$('team-dlg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.eq) { const r = Core.equip(openTeam, b.dataset.eq, +b.dataset.d); if (!r.ok) toast(r.reason); else SFX.click(); refresh(true); }
  if (b.id === 't-sel') { const id = openTeam; closeModal('m-team'); select(id); }
  if (b.dataset.up || b.dataset.dn) { const t = Core.unit(openTeam), ids = t.members.slice(), id = b.dataset.up || b.dataset.dn, i = ids.indexOf(id), j = b.dataset.up ? i - 1 : i + 1; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; const r = Core.setTeamOrder(openTeam, ids); if (!r.ok) toast(r.reason); else SFX.click(); refresh(true); }
  if (b.dataset.load) openLoad(b.dataset.load); });
/* ---------- v8: form-a-team dialog (checkbox selection, point / defense, stack order) ---------- */
let FORM = null;
function openForm() { const S = Core.state; if (S.phase !== 'planning') { toast('Busy'); return; } FORM = { ids: [], point: null, defense: null, stage: null }; renderForm(); $('m-form').classList.add('show'); SFX.click(); }
function renderForm() { const S = Core.state, staged = S.officers.filter(o => o.status === 'staged' && !o.team), max = S.teamMax || 5;
  FORM.ids = FORM.ids.filter(id => staged.some(o => o.id === id)); if (FORM.point && !FORM.ids.includes(FORM.point)) FORM.point = null; if (FORM.defense && !FORM.ids.includes(FORM.defense)) FORM.defense = null;
  const ord = () => { const r = FORM.ids.slice(); const p = FORM.point, d = FORM.defense; let o = p ? [p].concat(r.filter(x => x !== p)) : r; if (d && d !== o[0]) o = [o[0], d].concat(o.slice(1).filter(x => x !== d)); return o; };
  const O = ord(); let h = '';
  for (const sg of ['primary', 'secondary']) { const L = staged.filter(o => (o.stage || 'primary') === sg); if (!L.length) continue;
    h += `<div class="sec">${sg === 'primary' ? 'Primary staging · equipment vehicle (default kit drawn)' : 'Secondary staging · on foot (personal weapons only)'}</div>`;
    h += L.map(o => { const on = FORM.ids.includes(o.id), i = O.indexOf(o.id), dis = FORM.stage && FORM.stage !== sg;
      return `<div class="frow ${on ? 'on' : ''}" data-fo="${o.id}"><label class="fchk"><input type="checkbox" data-fchk="${o.id}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}><span>${on ? i + 1 : ''}</span></label>
        <div class="fnm"><b>${esc(o.name)}</b><small>${Core.SPECS[o.spec].icon} ${Core.SPECS[o.spec].name}${o.quals.map(q => ' · ' + Core.QUALS[q].name).join('')}</small></div>
        ${on ? `<div class="fbtn"><button class="mini ${FORM.point === o.id || (!FORM.point && i === 0) ? 'on' : ''}" data-fpt="${o.id}">POINT</button><button class="mini ${FORM.defense === o.id ? 'on' : ''}" data-fdf="${o.id}">DEF</button><button class="mini" data-fup="${o.id}" ${i > 0 ? '' : 'disabled'} aria-label="Up">▲</button><button class="mini" data-fdn="${o.id}" ${i < O.length - 1 ? '' : 'disabled'} aria-label="Down">▼</button></div>` : ''}</div>`; }).join(''); }
  $('form-dlg').innerHTML = `<div class="ph">Form Team<span class="sp"></span><small>${FORM.ids.length}/${max} SELECTED</small><button class="ib" data-close="m-form">✕</button></div>
  <div class="body"><div style="font-size:11.5px;color:#bcd0e6;margin-bottom:6px">Tick officers waiting at ONE staging area. The <b>POINT</b> leads the stack, his <b>DEF</b> (defense) man covers him second, the rest follow in the order shown (▲▼). Formations and stacks follow this order.</div>${h || '<div class="row" style="color:var(--dim)">Nobody waiting at staging.</div>'}
  <div style="display:flex;gap:8px;margin-top:12px"><button data-close="m-form" style="flex:1">Cancel</button><button id="f-go" class="on" style="flex:2" ${FORM.ids.length ? '' : 'disabled'}>Form team (${FORM.ids.length})</button></div></div>`;
  FORM.order = O; }
$('form-dlg').addEventListener('click', e => { const b = e.target.closest('button,input'); if (!b) return; const S = Core.state;
  if (b.dataset.fchk) { const id = b.dataset.fchk, o = Core.off(id); if (b.checked) { if (FORM.ids.length >= (S.teamMax || 5)) { b.checked = false; toast(`Max ${S.teamMax || 5} officers per team`); return; } FORM.stage = o.stage || 'primary'; FORM.ids.push(id); } else { FORM.ids = FORM.ids.filter(x => x !== id); if (!FORM.ids.length) FORM.stage = null; } SFX.click(); renderForm(); return; }
  if (b.dataset.fpt) { FORM.point = b.dataset.fpt; if (FORM.defense === FORM.point) FORM.defense = null; renderForm(); return; }
  if (b.dataset.fdf) { FORM.defense = FORM.defense === b.dataset.fdf ? null : b.dataset.fdf; if (FORM.defense === FORM.point) FORM.point = null; renderForm(); return; }
  if (b.dataset.fup || b.dataset.fdn) { const O = FORM.order.slice(), id = b.dataset.fup || b.dataset.fdn, i = O.indexOf(id), j = b.dataset.fup ? i - 1 : i + 1; if (j < 0 || j >= O.length) return; [O[i], O[j]] = [O[j], O[i]]; FORM.ids = O; FORM.point = O[0]; if (FORM.defense && O.indexOf(FORM.defense) !== 1) FORM.defense = O[1] === FORM.defense ? FORM.defense : null; renderForm(); return; }
  if (b.id === 'f-go') { const r = Core.formTeam(FORM.order, { point: FORM.order[0], defense: FORM.defense }); if (!r.ok) { toast(r.reason); return; } SFX.order(); closeModal('m-form'); toast(`${r.team.name} team formed — point ${Core.off(r.team.members[0]).last}`, true); select(r.team.uid); refresh(true); } });
/* ---------- v8: officer loadout (two hands, holster, sling, pack, vest; equipment vehicle) ---------- */
let LOAD = null;
const ITN = k => (Core.EQUIP[k] && Core.EQUIP[k].short) || ({ pistol: 'Pistol', taser: 'Taser', rifle: 'Rifle', sniper: 'Precision rifle', mask: 'Gas mask' })[k] || k;
function handsTxt(o) { const v = Core.invView(o); return v.two ? ITN(v.hands[0]) + ' (2H)' : v.hands.map(h => h ? ITN(h) : '—').join(' + '); }
function openLoad(id) { LOAD = id; renderLoad(); $('m-load').classList.add('show'); SFX.click(); }
function renderLoad() { const S = Core.state, o = Core.off(LOAD); if (!o) { closeModal('m-load'); return; } const v = Core.invView(o), C = Core.ITEM_CFG, planning = S.phase === 'planning';
  const t = o.team ? Core.unit(o.team) : null, [px, py] = t ? [t.x, t.y] : [Core.stagePos(o.stage).x, Core.stagePos(o.stage).y], atEq = Core.atEquipment(px, py);
  const nr = k => v.notReady.includes(k) ? '<span class="nr">NOT READY · 1 turn</span>' : (C[k] && (C[k].weapon || C[k].hands) ? '<span class="rd">READY</span>' : '');
  const held = v.two ? [v.hands[0]] : v.hands; const hand = (k, i) => k ? `<div class="hand ${v.notReady.includes(k) ? 'nrb' : ''}"><small>${v.two ? 'BOTH HANDS' : i ? 'RIGHT HAND' : 'LEFT HAND'}</small><b>${ITN(k)}</b>${k === 'lesslethal' ? `<small>${v.ll} rounds</small>` : ''}${nr(k)}
      <div class="hb">${C[k] && C[k].stow ? `<button class="mini" data-ls="${k}" ${planning ? '' : 'disabled'}>${C[k].stow === 'holster' ? 'Holster' : C[k].stow === 'slung' ? 'Sling' : 'Pack'}</button>` : `<small style="color:var(--amber)">${k === 'shield' || k === 'shield3' ? 'one hand · cannot be slung/packed' : 'carried'}</small>`}${k === 'rifle' ? `<button class="mini" data-lg="rifle" ${planning ? '' : 'disabled'}>${v.two ? 'One-handed' : 'Two-handed'}</button>` : ''}</div></div>` : `<div class="hand empty"><small>${i ? 'RIGHT HAND' : 'LEFT HAND'}</small><b>free</b></div>`;
  const stowed = [].concat(v.holster.map(k => [k, 'holster']), v.slung.map(k => [k, 'slung']), Object.entries(v.packed).filter(e => e[1] > 0).map(e => [e[0], 'packed', e[1]]), Object.entries(v.vest).filter(e => e[1] > 0).map(e => [e[0], 'vest', e[1]]));
  const canHold = k => C[k] && (C[k].hands || C[k].stow === 'holster');
  const srow = ([k, w, n]) => `<div class="srow"><span class="wh">${w.toUpperCase()}</span><b>${ITN(k)}${n > 1 ? ' ×' + n : ''}</b>${v.notReady.includes(k) ? '<span class="nr">NOT READY</span>' : ''}<span class="sp"></span>${canHold(k) ? `<button class="mini" data-lh="${k}" ${planning ? '' : 'disabled'}>${v.free >= ((C[k].hands === 2 && !C[k].oneHand) ? 2 : 1) ? 'Hold' : 'Switch'}</button>` : `<small>${k === 'charge' ? 'drawn when hanging (needs a free hand)' : k === 'bang' || k === 'gas' ? 'thrown two-handed (pistol auto-holstered)' : k === 'medkit' ? 'used two-handed' : ''}</small>`}</div>`;
  const pool = Object.keys(Core.EQUIP).filter(k => k !== 'draco').map(k => { const have = (k === 'plate' && Core.armorOf(o) === 'plate' ? 1 : 0) + (v.hands.includes(k) ? 1 : 0) + v.slung.filter(x => x === k).length + (v.packed[k] || 0) + (v.vest[k] || 0);
    return `<div class="prow"><span>${ITN(k)}</span><small>${have ? 'has ' + have : ''}</small><button class="mini" data-lr="${k}" ${atEq && planning && have ? '' : 'disabled'}>−</button><span class="q">${S.armory[k]}</span><button class="mini" data-ld="${k}" ${atEq && planning && S.armory[k] > 0 ? '' : 'disabled'}>＋</button></div>`; }).join('');
  $('load-dlg').innerHTML = `<div class="ph">🎒 ${esc(o.name)}<span class="sp"></span><small>${Core.SPECS[o.spec].name}${o.quals.length ? ' · ' + o.quals.map(q => Core.QUALS[q].name).join(', ') : ''}</small><button class="ib" data-close="m-load">✕</button></div>
  <div class="body"><div class="sec">Hands</div><div class="hands">${held.map(hand).join('')}${!v.two && held.length < 2 ? '' : ''}</div>
  <div style="font-size:11px;color:var(--dim);margin:4px 0 6px">Holster / sling / switch costs no time, but the weapon is <b style="color:var(--amber)">NOT READY for one full turn</b> (no return fire or attacks with it). Ram breach, throws and first aid stow and redraw sidearms automatically.</div>
  <div class="sec">Carried</div>${stowed.map(srow).join('') || '<div class="row" style="color:var(--dim)">Nothing stowed</div>'}${(() => { const ak = Core.armorOf(o), A = Core.ARMOR[ak]; return `<div class="srow worn"><span class="wh">WORN</span><b>🦺 ${A.name}</b><span class="sp"></span><small>${ak === 'plate' ? 'stops handgun / shotgun and most rifle rounds (torso)' : 'stops handgun / shotgun (torso) — draw a Plate Carrier for rifle protection'}</small></div>`; })()}<div class="srow"><span class="wh">WORN/PACKED</span><b>Gas mask</b><span class="sp"></span><small>team Mask order (donning takes a turn)</small></div>
  <div class="sec">Equipment vehicle ${atEq ? '<span style="color:var(--green)">· here</span>' : '<span style="color:var(--amber)">· not here — move to primary staging</span>'}</div><div class="pool">${pool}</div>
  <div style="display:flex;gap:8px;margin-top:12px"><button data-close="m-load" style="flex:1">Done</button></div></div>`; }
$('load-dlg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || !LOAD) return; let r = null;
  if (b.dataset.ls) r = Core.invAct(LOAD, 'stow', b.dataset.ls); else if (b.dataset.lg) r = Core.invAct(LOAD, 'grip', 'rifle'); else if (b.dataset.lh) { r = Core.invAct(LOAD, 'hold', b.dataset.lh); if (!r.ok && /free hand/.test(r.reason)) r = Core.invAct(LOAD, 'switch', b.dataset.lh); }
  else if (b.dataset.ld) r = Core.invAct(LOAD, 'draw', b.dataset.ld); else if (b.dataset.lr) r = Core.invAct(LOAD, 'return', b.dataset.lr); else return;
  if (!r.ok) toast(r.reason); else { SFX.click(); if (r.notReady) toast(`${ITN(r.notReady)} not ready until next turn`, true); } renderLoad(); refresh(true); });

/* ---------------- intel modal ---------------- */
const TALK_DESC = { call: 'Dial his cell or the throw-phone. He may not answer or may refuse', rapport: 'Calm, personal talk — steady progress, lowers agitation', listen: 'Let him vent — best when he is very agitated',
  concession: 'Offer something (food, a call to family) — big boost, limited uses', status: 'Check on him / anyone inside — small gain, refreshes the read', ultimatum: 'Demand he comes out now — works only with strong rapport, else escalates' };
function renderIntel() { const S = Core.state; let h = '';
  for (const k in Core.COMMANDS) { const c = Core.COMMANDS[k]; if (c.only && !(S.stype && S.stype.key === c.only)) continue; const a = c.avail(); h += `<button class="cmd ${S.cmd === k ? 'on' : ''}" data-cmd="${k}" ${a === true ? '' : 'disabled'}><b>${c.name}</b><span>${c.desc}</span>${a === true ? '' : `<br><em>${esc(a)}</em>`}</button>`; }
  const N = Core.negoSummary(); let t = '';
  for (const k of Core.TALK_KEYS) { const a = N.avail[k]; t += `<button class="cmd ${N.pick === k ? 'on' : ''}" data-talk="${k}" ${a === true ? '' : 'disabled'}><b>${esc(N.names[k])}</b><span>${TALK_DESC[k]}</span>${a === true ? '' : `<br><em>${esc(a)}</em>`}</button>`; }
  const P = N.preview, pr = P ? ['cover', 'shield', 'overwatch', 'commands'].map(k => `<span class="chip" style="color:${P[k] ? 'var(--green)' : 'var(--red)'}">${P[k] ? '✓' : '✗'} ${k}</span>`).join(' ') : '';
  const amb = P ? Math.round(Core.ambushRisk(P) * 100) : null;
  const stat = `<div class="kv" style="margin-bottom:8px"><span>Negotiators</span><b>${N.onScene ? N.onScene + ' on scene' + (N.onScene > 1 ? ' (coaching +10%)' : '') : 'en route'}</b>
    <span>Contact</span><b style="color:${N.contact ? 'var(--green)' : 'var(--amber)'}">${N.contact ? ({ phone: 'Phone line', tphone: 'Throw-phone line', pa: 'PA / shouting' })[N.contact] || N.contact : N.quiet ? 'He went quiet (' + Core.tMin(N.quiet) + ')' : 'None'}</b>
    <span>Suspect number</span><b>${N.numberKnown ? 'KNOWN · ' + esc(N.numberSrc || '') : 'unknown'}</b>${N.line ? '<span>Throw-phone</span><b style="color:var(--green)">inside</b>' : ''}
    <span>Mood · rapport</span><b>${esc(N.mood)} · ${esc(N.rapport)}</b><span>Attempts · refusals</span><b>${N.attempts} · ${N.refusals}</b><span>Rounds · concessions</span><b>${N.rounds} · ${N.concessions}</b>
    ${N.read ? `<span>Read on him</span><b style="font-size:11px">${esc(N.read)}</b>` : ''}${N.outcome ? `<span>Outcome</span><b style="color:var(--green)">${esc(N.outcome)}</b>` : ''}</div>`;
  const hist = N.hist.length ? `<div class="loglite">${N.hist.map(x => `<div>${Core.elapsedAt(x.turn)} · ${esc(x.t)}</div>`).join('')}</div>` : '';
  $('intel-dlg').innerHTML = `<div class="ph">Intel · Negotiation<span class="sp"></span><small>ONE EACH PER 30 S · RUNS ON EXECUTE</small><button class="ib" data-close="m-intel">✕</button></div><div class="body">
    <div class="sh">Intel action</div><div class="grid2">${h}</div>
    ${S.cmd ? `<button data-cmd="__none" style="margin-top:10px;width:100%">Cancel queued: ${Core.COMMANDS[S.cmd].name}</button>` : ''}
    <div class="sh" style="margin-top:14px">Negotiation · dialogue</div>${stat}<div class="grid2">${t}</div>
    ${N.pick ? `<button data-talk="__none" style="margin-top:10px;width:100%">Cancel queued: ${esc(N.names[N.pick])}</button>` : ''}
    <p style="font-size:11px;color:var(--dim);margin:8px 0 0">Other ways to open contact: select a cruiser or a team with a bullhorn → <b>PA Contact</b>; a team with a throw-phone → <b>Throw Phone</b> / <b>Robot Phone</b>. He may refuse, hang up or not answer.</p>${hist}
    <div class="sh" style="margin-top:14px">Surrender walk-out protocol</div>${P ? `<div class="chips">${pr}</div><p style="font-size:11px;color:var(--dim);margin:6px 0">Hidden-weapon ambush risk at the walk-out spot right now: <b style="color:${amb > 12 ? 'var(--red)' : 'var(--amber)'}">${amb}%</b>. Cover = teams in cover with a view of the spot; shield = a team with a ballistic shield within 8 m; overwatch = a sniper with a sight-line; commands = PA / bullhorn in range.</p>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button data-tool="surr" style="flex:1">◎ Set walk-out spot</button><button data-tool="ems" style="flex:1">🚑 Move EMS point</button></div>
    </div>`; }
$('intel-dlg').addEventListener('click', e => { const b = e.target.closest('button[data-talk],button[data-tool]'); if (!b) return; e.stopPropagation();
  if (b.dataset.tool) { V.tool = b.dataset.tool; closeModal('m-intel'); toast(b.dataset.tool === 'ems' ? 'Tap the map to place the EMS ambulance point (outside, away from the house)' : 'Tap the map outside the house to set the surrender walk-out spot', true); refresh(true); return; }
  const k = b.dataset.talk; const r = Core.setTalk(k === '__none' ? null : k); if (!r.ok) { toast(r.reason); return; } SFX.order(); if (k !== '__none') toast(`${Core.negoSummary().names[k]} queued for the next 30 s`, true); closeModal('m-intel'); refresh(true); }, true);
$('intel-dlg').addEventListener('click', e => { const b = e.target.closest('button[data-cmd]'); if (!b) return; const k = b.dataset.cmd; if (k === 'call911') { closeModal('m-intel'); open911(); return; } const r = Core.setCommand(k === '__none' ? null : k); if (!r.ok) toast(r.reason); else { SFX.order(); if (k !== '__none') toast(Core.COMMANDS[k].instant ? `${Core.COMMANDS[k].name} — done (see log)` : `${Core.COMMANDS[k].name} queued for the next 30 s`, true); } closeModal('m-intel'); refresh(true); });

/* ---------------- end / help ---------------- */
function showEnd() { const S = Core.state, R = S.result; if (!R) return; careerRecordEnd(); const turns = S.turn + (S.phase === 'over' && !S.stats.withdrawn ? 1 : 0); const D = R.debrief || [], SC = D.filter(d => d.pts != null), AA = D.filter(d => d.pts == null && d.k !== 'Score'), M = Core.missionScore();
  $('end-dlg').innerHTML = `<div class="ph">Operation Debrief<span class="sp"></span><small>${esc(S.opName)} · SEED ${S.seed}</small></div><div class="body"><div class="big" style="color:${R.win ? 'var(--green)' : 'var(--red)'}">${esc(R.title)}</div><p style="text-align:center;color:#bcd0e6">${esc(R.text)}</p>
   <div class="kv"><span>Mission time</span><b>${Core.tMin(turns)} (${Core.elapsedAt(turns)})</b><span>Resolution</span><b>${esc(S.stats.method || '—')}</b><span>Breaches</span><b>${S.stats.breaches}</b><span>Shots fired by suspect</span><b>${S.stats.shots}</b><span>Officers hit</span><b>${S.stats.down}</b></div>
   <div class="sh" style="margin-top:12px">Score</div><div class="kv scoretab">${SC.map(d => `<span>${esc(d.v.replace(/: [+−]\d+$/, ''))}</span><b style="color:${d.pts < 0 ? 'var(--red)' : 'var(--green)'}">${d.pts > 0 ? '+' : '−'}${Math.abs(d.pts)}</b>`).join('') || '<span>No bonuses or deductions</span><b>0</b>'}<span style="color:#fff;font-weight:700">Total</span><b style="font-size:15px">${M.score} — ${esc(M.grade)}</b></div>
   ${AA.length ? `<div class="sh" style="margin-top:12px">After-action</div><div class="kv">${AA.map(d => `<span>${esc(d.k.trim())}</span><b style="font-size:11.5px;font-weight:500;${d.k.startsWith('  ') ? 'color:var(--dim)' : ''}">${esc(d.v)}</b>`).join('')}</div>` : ''}
   ${xpHTML()}${careerEndHTML()}<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button data-close="m-end" style="flex:1">Review Map</button><button id="e-retry" style="flex:1">Replay Seed${S.opts && S.opts.career ? ' (quick, not counted)' : ''}</button>${S.opts && S.opts.career ? '<button id="e-calls" class="on" style="flex:1">Next call ▸</button><button id="e-cont" style="flex:1">Career / Roster</button>' : '<button id="e-main" class="on" style="flex:1">Main menu ▸</button>'}</div></div>`;
  $('m-end').classList.add('show'); }
/** Debrief: experience earned from individual actions (shown in every mode; saved only in Career Mode). */
function xpHTML() { const X = Core.xpSummary(), S = Core.state; if (!X.rows.length) return `<div class="sh" style="margin-top:12px">Experience earned</div><div style="font-size:12px;color:var(--dim)">No credited actions this mission.</div>`;
  return `<div class="sh" style="margin-top:12px">Experience earned${S.opts && S.opts.career ? '' : ' <small style="color:var(--dim)">(Quick Mission — not saved)</small>'}</div><div class="kv scoretab">${X.rows.map(r => `<span>${esc(r.label)}${r.n > 1 ? ` ×${r.n}` : ''}</span><b style="color:var(--cyan2)">+${r.xp}</b>`).join('')}<span style="color:#fff;font-weight:700">Action XP</span><b>+${X.total}</b></div>${S.stats.stateTeam ? '<div class="note" style="margin-top:6px">State SWAT took over — only the action experience above counts; no mission-completion XP.</div>' : ''}`; }
function openStateCall() { const S = Core.state; if (S.phase === 'over' || !(S.opts && S.opts.career)) return; const X = Core.xpSummary();
  $('wd-dlg').innerHTML = `<div class="ph">Call State SWAT Team<span class="sp"></span><button class="ib" data-close="m-wd">✕</button></div><div class="body">
   <p>Request the State SWAT team and hand them the scene. The mission ends now. Your unit keeps the <b>experience from individual actions</b> so far (<b>+${X.total} XP</b>) but earns <b>no mission-completion XP</b>; the score takes a <b>${Core.SCORE.stateTeam}</b> deduction.</p>
   <div style="display:flex;gap:8px;margin-top:10px"><button data-close="m-wd" style="flex:1">Keep command</button><button id="st-yes" class="on" style="flex:1">☎ Call State SWAT</button></div></div>`;
  closeModal('m-menu'); $('m-wd').classList.add('show'); }
function openWithdraw(auto) { const S = Core.state; if (S.phase === 'over') return; const left = Core.forceLeft();
  $('wd-dlg').innerHTML = `<div class="ph">End mission / withdraw<span class="sp"></span><button class="ib" data-close="m-wd">✕</button></div><div class="body">
   ${auto ? '<div class="warnbox">No mobile officers left on scene and nobody en route.</div>' : ''}
   <p>Withdraw all units and hand the scene over. The mission ends <b>now, without a resolution</b>: the debrief and career record it with a <b>${Core.SCORE.withdraw}</b> deduction (plus any losses). There is no time limit — you can keep going instead.</p>
   <p style="color:var(--dim)">Units still able to act: ${left}.</p>
   <div style="display:flex;gap:8px;margin-top:10px"><button data-close="m-wd" style="flex:1">Keep going</button><button id="wd-yes" class="on" style="flex:1;background:var(--red)">⚑ Withdraw &amp; end mission</button></div></div>`;
  $('m-wd').classList.add('show'); }
$('wd-dlg').addEventListener('click', e => { if (e.target.id === 'wd-yes') { closeModal('m-wd'); const r = Core.withdraw(); if (r.ok) { refresh(true); showEnd(); } }
  if (e.target.id === 'st-yes') { closeModal('m-wd'); const r = Core.callState(); if (r.ok) { refresh(true); showEnd(); } else toast(r.reason); } });
$('b-wd').addEventListener('click', () => { if (busy) return; openWithdraw(false); });
let wdPrompted = -1;
function checkStranded() { const S = Core.state; if (S.phase !== 'planning' || wdPrompted === S.seed) return; if (Core.forceLeft() === 0) { wdPrompted = S.seed; openWithdraw(true); } }
$('end-dlg').addEventListener('click', e => { const S = Core.state; if (e.target.id === 'e-new') { closeModal('m-end'); newGame(); }
  if (e.target.id === 'e-retry') { closeModal('m-end'); newGame(S.seed, false, S.opts && S.opts.career ? Career.levelOf(CAREER) : QLEVEL, S.opts && S.opts.stype); }
  if (e.target.id === 'e-cont') { closeModal('m-end'); openCareer(); } if (e.target.id === 'e-calls') { closeModal('m-end'); openCalls(); } if (e.target.id === 'e-main') { closeModal('m-end'); openMain(); } });
const HB = (t, s) => `<p><b style="color:#fff">${t}:</b> ${s}</p>`;
$('help-dlg').innerHTML = `<div class="ph">How to Play<span class="sp"></span><button class="ib" data-close="m-help">✕</button></div><div class="body" style="font-size:12.5px;color:#bcd0e6">
 ${HB('Goal', `an armed suspect is barricaded in one of the houses. Contain it, gather intel, then talk him out or make a safe entry. The mission ends when he is <b>in custody</b> (surrender, arrest, or secured after being stopped) — or when you choose <b>⚑ Withdraw</b>. There is <b>no time limit</b> and the mission never ends early on losses; instead the debrief score takes major deductions for officers hit or killed, civilians hurt, hostages killed, an escape through the perimeter, or a withdrawal. The mission clock is information only.`)}
 ${HB('Score & withdrawing', `the debrief lists every bonus and deduction: resolving it (+${Core.SCORE.resolved}), a talked-out surrender (+${Core.SCORE.talked}), rescued casualties, a closed perimeter gap — and major deductions for each officer hit (${Core.SCORE.officerHit}) or killed (${Core.SCORE.officerLost}), civilians hurt (${Core.SCORE.civHurt}) or killed (${Core.SCORE.civKilled}), hostages hurt or killed (${Core.SCORE.hostageKilled}), a suspect who slips through the perimeter and has to be tracked down (${Core.SCORE.escape}), and withdrawing (${Core.SCORE.withdraw}). Grades: Medal of Valor ≥1000, Unit Commendation ≥650, Satisfactory ≥350, Needs Review ≥0, Board of Inquiry below 0. <b>⚑ Withdraw</b> in the top bar ends the mission without a resolution — you are offered it automatically if no officer is left able to act.`)}
 ${HB('Vision indoors', 'officers inside the house see into the next room through <b>open doors and doorways</b> (not through walls or closed doors): the cells in their sight line are revealed, lit while in view and dimmed once out of view. If the suspect has a line of sight to an officer, that officer sees him too — even when facing away.')}
 ${HB('Time', 'the game pauses while you plan. Select a unit and queue orders (dotted paths). Orders chain — e.g. Move → Breach → Flashbang → Clear. Optionally queue one Intel action, then press <b style="color:var(--amber)">EXECUTE</b>: everyone acts at once for <b>30 seconds</b> of mission time (8 steps of ~4 s). The <b>mission clock</b> in the top bar starts at 0:00 when SWAT is activated and advances 0:30 per EXECUTE; the radio log shows the time of day. ETAs, gas, breach and critical-care timers are shown in minutes / m:ss.')}
 ${HB('Mission brief & 911 call', 'every mission opens with a brief of what happened before SWAT was activated: the 911 call, what the first patrol units did, and anything known about the suspect. <b>Listen to the 911 call</b> (📋 button, or Intel → Review 911 Call) shows the transcript with times and can read it aloud (mute / skip). The caller ID or a family caller may give you his phone number. Reviewing is instant.')}
 ${HB('Perimeter on arrival', 'patrol cruisers start at the ends of the block or at the nearest intersection, keeping traffic out (striped <b>TRAFFIC BLOCKED</b> markers on the map and minimap) — moving one opens the street. Patrol officers may already be in good positions, or may have left a side of the house unwatched by accident, or bunched up at the front. Run Intel → <b>Status Check</b> (instant) for a roll call: it reveals which sides are watched and flags any gap. An unwatched side is how he slips out.')}
 ${HB('Officer down on arrival', `about ${Math.round(Core.SCENE_CFG.injury * 100)}% of calls a patrol officer was hit before SWAT arrived: injured and mobile, immobile and bleeding out with a critical countdown, or killed. A downed officer in the front yard is in the line of fire — plan the rescue (shield, cover, medic) before the timer runs out.`)}
 ${HB('Cover', 'every spot is checked against real sight lines from <i>each</i> window and exterior door. <b>Hard cover</b> (cruisers, parked cars, tree trunks, sheds, neighbor houses, utility boxes) stops rounds — hits are rare. <b>Concealment</b> (hedges, fences, mailboxes) hides you so he fires less often, but rounds go straight through. You can <b>move anywhere</b> — nothing snaps. Before you EXECUTE, an order whose end spot is in his line of fire is flagged <b style="color:var(--red)">⚠ EXPOSED</b> on the order list and the preview, and a route that crosses open ground is flagged <b style="color:var(--amber)">route exposed</b>; the move is still allowed. Automatic moves (take cover, fall back) still prefer cover. Shield on the unit: <span style="color:var(--green)">green</span> = hard cover, <span style="color:var(--amber)">amber</span> = concealment, <span style="color:var(--red)">red</span> = exposed. Planned routes are tinted red/amber where they cross his lines of fire.')}
 ${HB('Containment', 'contain the house by watching every side (4 corners, front, rear) from real cover — there are no map markers; choose your own spots. Out front there is little to hide behind, so drive a cruiser into the street and stand behind it (a parked street car can serve too). Sides and rear use the yard (sheds, trees, hedges) or the corners of the neighbor houses. A solid green shield badge = <b>HARD COVER</b>, a leaf = <b>CONCEALMENT</b>; zoom in to see what shields it. Where a yard has nothing to hide behind, the scene adds some (hedge row, trees, utility box). Patrol officers start behind cover; posts count as held when an officer is within ~2 m or an occupied cruiser within 3 m.')}
 ${HB('Suspect fire', 'each chance he gets he fires about <b>40%</b> of the time at officers outside and about <b>80%</b> at a team inside the house; exposed officers are his first choice, then cruiser drivers, then officers in cover. A <b>flashbang</b> (dazed: fire chance ×0.45, accuracy ×0.55) and <b>CS gas</b> (up to −65% fire chance, −60% accuracy) cut both. He picks ONE <b>primary target</b> per turn — the nearest officer he can see — and keeps firing at that officer until the next turn (no retargeting). Other members of that team only take rounds after the primary is down (about 30% per round, at most 2 such rounds). A team stacked at a doorway can only be hit in the <b>doorway pair</b> (point + defense) when he fires through that door. Officers on <i>Return fire</i> shoot back automatically — the <b>nearest 3</b> with a clear line, a ready weapon in range and not holding fire (each team member counts separately; the log lists who fired), as a snap shot at the muzzle flash (×0.8, patrol ×0.55); exposed patrol officers fall back to cover. Use the stance button to switch Return fire / Fire at will / Hold fire.')}
 ${HB('Shooting', 'Fire / Suppress, then hover or tap a target to see the hit chance and its breakdown (base, range, cover, visibility, skill, spotter, impairment). Pistols rarely hit, rifles are low, the sniper is best — especially when he is at a window. Suppress rarely hits but makes him duck.')}
 ${HB('Vehicles', 'a vehicle is driven only through the officer or team inside it: patrol officers or a team <b>Get In</b> (cruiser 2 seats, BearCat 10 — the large navy armored truck with a roof turret, unlocked in career), then select <i>their</i> chip and use <b>Drive</b>; the occupants ride with it. <b>Exit</b> on the <i>house side</i> (fast, exposed) or the <i>safe side</i> (behind the vehicle; a driver sliding over costs +1 tick); a move order also gets a team out. The cruiser windshield is weak — a driver can be hit; the BearCat is armored. An empty vehicle is just static cover.')}
 ${HB('Staging areas', 'there are two. <b>Primary staging</b> is at the equipment vehicle (SWAT truck): about 70% of paged officers arrive here, and all equipment is drawn and returned here. <b>Secondary staging</b> is on foot at the other end of the street (about 30% arrive there) — officers there can form a team and move at once, but carry only their personal weapons until they visit the equipment vehicle. A team must be formed from officers at the same staging area.')}
 ${HB('Officer loadout', 'every officer has <b>two hands</b>, a holstered handgun and a taser, and his long gun. Tap 🎒 on a member in the team dialog: the <b>hands slot</b> shows what is held. A rifle is held two-handed, slung, or fired one-handed (×0.6 accuracy). Shields always take one hand and cannot be slung. The ram is carried in one hand; on a ram breach the pistol is auto-holstered for both hands on the ram and redrawn after. Charges ride on the vest — drawing one takes time and hanging it needs a free hand. Flashbang and CS throws need both hands (sidearm auto-holstered, then redrawn). The medkit is packed; full first aid needs both hands. The 40mm launcher needs both hands, a Less-Lethal Specialist and has limited rounds. Holster, sling or switch costs no time, but that weapon is <b style="color:var(--amber)">NOT READY for one full turn</b> — no return fire or attacks with it. Gear is drawn only at the equipment vehicle, from a pool that grows with team level.')}
 ${HB('Body armor', `every officer — patrol and SWAT — wears <b>soft Level IIIA</b> torso armor: it stops handgun and shotgun rounds. About half of hits land on the torso; hits to arms, legs or head injure as before. A stopped round at very close range (≤${Core.ARMOR_CFG.bluntRange} cells) can still leave a <b>small blunt-impact injury</b> (mobile, low severity) — most often from a shotgun. <b>Plate Carriers</b> (rifle plates, worn slot) are issued individually from the pool: they unlock around career level 75 and every one of the 30 officers has one at level 100; they stop about ${Math.round(Core.ARMOR.plate.stops.rifle * 100)}% of rifle rounds to the torso. Draw / return plates in the loadout (🎒) at the equipment vehicle. The team card shows a 🦺 badge (PL = plates, IIIA = soft only).`)}
 ${HB('Ballistic shields', `one-hand items that <b>cannot be slung or packed</b>. The <b>IIIA shield</b> stops handgun and shotgun; the <b>Level III shield</b> (career ~70+) also stops ~${Math.round(Core.SHIELDS.shield3.stops.rifle * 100)}% of rifle rounds and fewer .308. Protection is only in the <b>frontal arc</b> and covers part of the body (${Math.round(Core.SHIELD_CFG.cover * 100)}%); teammates stacked behind the shield get a partial benefit (${Math.round(Core.SHIELD_CFG.stack * 100)}%). The team's default point carries the best shield available.`)}
 ${HB('Several suspects (fleeing-suspect calls)', `a suspect who fled into a vacant house may not be alone: 1–4 suspects (one is most common — ${Math.round(Core.MULTI_CFG.countW[0] * 100)}% / ${Math.round(Core.MULTI_CFG.countW[1] * 100)}% / ${Math.round(Core.MULTI_CFG.countW[2] * 100)}% / ${Math.round(Core.MULTI_CFG.countW[3] * 100)}%). The patrol report can be uncertain or under-count. Each suspect has a separate position, weapon, armor, mask and behavior (hiding, fleeing, fighting, ready to give up, or injured). The intel panel shows the count as <b>Unknown (N seen)</b> until every suspect has been seen and every room cleared. Negotiation works on the group, but individuals can break away. The call is only resolved when <b>every</b> suspect is in custody; each escape costs points.`)}
 ${HB('Rotating a phone', 'the map re-measures itself after a rotate (and again a moment later, since iOS reports stale sizes). It keeps the same spot centred and never stretches. If you had not moved the view, it re-frames the house.')}
 ${HB('Suspect body armor', `about ${Math.round(Core.ARMOR_CFG.suspect * 100)}% of suspects wear armor — mostly soft vests, occasionally rifle plates. You only learn it when he is seen wearing it or a hit is stopped (log: “The round appears to have been stopped by body armor”). Handgun rounds are stopped by a soft vest; rifles penetrate soft armor but plates stop most of them; the .308 precision rifle penetrates soft armor and has a reduced chance against plates. Hits outside the vest still count — in a window he shows mostly head and shoulders.`)}
 ${HB('Draco arm (BearCat)', `career level ~60 adds a <b>Draco Arm Kit</b> to the pool. Select a team of 2+ and tap <b>⚙ Install Draco</b>: they walk to the BearCat and mount it in ${Core.DRACO_CFG.installTurns} turns of work (progress bar on the vehicle). Installers are busy and more exposed and do not return fire; any other order interrupts the install (progress is kept). Once installed, select whoever is inside the BearCat and use <b>⚒ Draco Breach</b> on an exterior door or a window: the BearCat drives up and the claw rips it out — a door in one or two pulls (storm doors first, still faster than by hand), windows always. It is loud, takes the frame with it, and the crew stays under armor. The new opening is used for vision, gas and entry.`)}
 ${HB('Taser', `Taser order (team or patrol): an officer with a free(able) hand draws the taser one-handed — the suspect must be in view with a clear line within ~${Core.TASER_CFG.range} m. Odds are best up close (~${Math.round(Core.TASER_CFG.p * 100)}% at 1 m, lower with distance and against body armor) and it can fail. A hit incapacitates him for ~${Core.TASER_CFG.stunTurns} turns: move a team in to detain him.`)}
 ${HB('Less-lethal 40mm', `an LL-qualified officer with the launcher fires impact rounds: range ~${Core.LL_CFG.range} m, odds fall with range, about ${Math.round(Core.LL_CFG.noEffect * 100)}% of hits have no visible effect, a good hit stuns him ${Core.LL_CFG.stunTurns[0]}–${Core.LL_CFG.stunTurns[1]} turns. Each shot uses one round (shown in the loadout); out of rounds = order unavailable.`)}
 ${HB('Hand transitions', 'throwing a flashbang / CS needs <b>both hands</b>, the taser <b>one</b>, the 40mm launcher <b>both</b>. The officer automatically holsters or slings what he holds, uses the device, then re-draws his previous weapon — which is <b>not ready</b> until next turn (logged). A <b>ballistic shield cannot be slung or put down</b>: a shield holder keeps it and uses the taser in his free hand, but cannot fire the launcher (give the launcher to someone else in the loadout).')}
 ${HB('The block behind the house', 'the map includes the <b>rear row</b>: the back neighbours\' houses, their yards and the rear street behind the suspect house (back fences have gates). Their house corners and sheds are hard cover for rear containment, a sniper can take a perch in a rear house (marked <i>rear row</i>), and cruisers can use the rear street to close the back of the block. Zoom out (⤢ / overview) to see it.')}
 ${HB('Sniper overwatch', 'a team with a Marksman can take Overwatch on a perch in a neighbor house (window or roof) or a yard vantage point; the cone shows his sight-lines. A spotter raises his hit chance — a qualified <b>◆ Sniper Spotter</b> most, any other officer moderately — and spots the suspect at windows sooner. Perched snipers are very hard to hit.')}
 ${HB('CS gas', 'gas spreads room to room through open doors and broken windows and vents outdoors as a plume; you only see it where you have vision or intel. Deploying gas calls “Gas! Masks on” — donning takes a tick. Unmasked officers in gas are heavily impaired; masks cost a little vision and aim. Patrol have no masks: they cough, may fall back or panic — pull them out. The suspect may flee or give up… unless he has a gas mask (you only learn that when you see him).')}
 ${HB('Negotiation', 'Two negotiators arrive staggered. Open contact by <b>Call</b> (needs his number — from a neighbor interview, the 911 record or family), <b>PA Contact</b> from a cruiser or a bullhorn team (he may yell from a window — or shoot), or a <b>Throw Phone</b> tossed through an open door/broken window or carried in by the robot (can be blocked, shot or ignored). He can refuse, not answer or hang up. Once talking, pick one dialogue move per turn in Intel: Build Rapport, Active Listening, Concession, Status Check, Ultimatum.')}
 ${HB('Surrender walk-out', 'when he agrees, he walks to the ◎ walk-out spot next turn and kneels; the nearest unit takes custody. Some hide a weapon: set protocol first — teams in cover watching the spot, a shield team close, sniper overwatch and a PA/bullhorn giving commands — each cuts the ambush risk (shown in Intel).')}
 ${HB('Contain & call out', '<b>Call Out</b> over a PA orders him out. Low odds (~10–15%), better with full containment, gas and rapport; agitation lowers it.')}
 ${HB('Casualties', 'a hit person may be killed (memorial marker), injured but mobile (moves to cover and walks to EMS), or immobile (needs rescue). A ✚ marker shows the critical countdown (m:ss of mission time); you only see status with vision or a radio report. <b>First Aid</b> (Medic + medkit stabilises), <b>Rescue</b> drags to cover, <b>Evacuate</b> carries to the 🚑 EMS point, then transport to hospital. Three officers hit aborts the operation.')}
 ${HB('Breaching', 'Breach → tap a door → pick a method. <b>Charge</b> (Breacher only): hang it, back off to the safe-standoff ring, then it detonates (automatically, or choose “Hang only” and use Detonate later) — fastest and most reliable but very loud; anyone inside the ring is dazed. <b>Ram</b>: medium and loud. <b>Halligan pry</b>: quiet but slow. <b>Kick</b>: no gear, poor odds. Barricades and storm doors (shown once seen) make every method harder. Noise alerts the suspect.')}
 ${HB('Forces', 'patrol (P1–P4) are on scene — put them where they can watch the house from cover. At least one SWAT officer is <b>already at staging</b> when you take command — usually 1–3, sometimes a larger group; the rest are paged and arrive with staggered ETAs. Rarely (about 1 in 15) the <b>whole team arrives at once</b> because they were training together or clearing from another call — the brief and radio log say so. Press <b>Form Team</b>: tick officers at one staging area, pick the <b>POINT</b> and his <b>DEF</b> (defense) man and put the rest in order with ▲▼ — the stack and formations follow that order. Tap ⓘ (or a selected shield) for members, order, loadouts and transfers.')}
 ${HB('Formations', 'each team member is a <b>blue dot</b> (the lighter dot is the point man). The team adapts to where it is: a <b>cover line</b> along a car or wall outside (a line abreast in the open), at a door the <b>point</b> and <b>defense</b> officers stand at either side of the door frame (partly in the doorway) while the rest are <b>stacked on the wall</b> beside the opening, out of its line of fire; a <b>staggered column</b> on alternating walls in hallways and while moving; and inside a room the team spreads <b>along the walls</b> and into the corners (point on the near wall, the others fanned to the far walls), never in the middle of the room. The label under the dots names the formation when zoomed in.')}
 ${HB('Work Corner (slice the pie)', 'at a hallway corner, door frame or house corner, <b>◩ Work Corner</b> (<kbd>N</kbd>) edges the unit out in <b>45° cuts</b> — one cut every two ticks, each revealing more of the hidden area through the fog. It <b>stops the moment it sees the suspect</b> (THREAT in the log) or reports “corner clear”. While slicing only a sliver of the unit is exposed, so the suspect is less likely to fire at it and less likely to hit. Queue it like any order (it chains after a Move) and press EXECUTE; moving off the spot ends the slice. Patrol officers can work outside house corners but never step inside.')}
 ${HB('Main menu', 'the game opens on the main menu. <b>Quick Mission</b> plays one scenario with the <b>team level</b> you pick on the slider or number box (1–100, default 100): level 1 is a small basic team (4 officers, shields, ram, Halligan, medkit, bullhorn); every level adds people and gear up to level 100 — 30 personnel and every item in large counts. Quick Missions are never saved to the career. <b>New seed</b> picks a different scenario; <b>Career / Roster</b> and <b>How to play</b> open those screens.')}
 ${HB('Career Mode', 'starts at <b>team level 1</b>. Team XP is earned per action — breaching, clearing rooms, working corners, finding the suspect, closing the perimeter, contact and dialogue, first aid, rescue and evacuation, overwatch, flashbangs, taking custody — plus the mission result; enough XP raises the team level (personnel, gear and team size grow with it). Between missions the <b>dispatch screen</b> offers random calls with an estimated risk. In a career mission the ☰ menu has <b>☎ Call State SWAT Team</b>: hand the scene over, keep only the per-action XP (shown in the debrief), no mission-completion XP and a score deduction. Results save automatically in this browser; team level and XP are stored separately from the roster, so a damaged roster is regenerated without losing them. Officers still gain XP and rank, injured officers sit out missions, officers killed go to the memorial. <b>Export</b> a code (it starts with your level and XP, e.g. <kbd>SWATC3.L12-X3400-…</kbd>) or a file to move the career; older SWATC1/SWATC2 codes and saves import and upgrade automatically.')}
 ${HB('Call types', `each seed picks a call type (Quick Mission: choose one under <b>Call type</b>, or Random). The type is shown at the top of the brief, on the 911 record and on career dispatch cards. <b>Barricaded subject</b> — the standard call. <b>Mental health crisis</b> — low aggression, open to talking; the legal factor (discharge, warrant or interview-only) is in the brief. Bonus for resolving without force (+${Core.SCEN_TYPES.mental.bonus.noForce}) and for arranging an <b>EMS Evaluation</b> (Intel, +${Core.SCEN_TYPES.mental.bonus.ems}); the debrief notes a neutral risk flag. <b>Domestic</b> (firearm or violent variant) — his partner is at the perimeter: the <b>Partner Interview</b> gives the full layout, weapons, history and usually his number. <b>Fleeing suspect — vacant house</b> — nobody else inside, no family, little interest in talking; he escapes through any side nobody watches, fast — run a Status Check and close gaps early. <b>Neighbor dispute</b> — known armed; most hostile toward the neighbor's side of the house (keep officers off that side); the neighbor can be interviewed. <b>Parole absconder</b> (about ${Math.round(Core.SCEN_TYPES.parole.xw * 100)}% of calls) — patrol came to pick him up on a parole-violation warrant; the brief says how they know he is inside (seen going in, seen at a window, or a caller). One suspect, armed or not (he may have no firearm at all). He often hides in an <b>attic</b> or <b>basement</b>: he cannot be seen there until an officer, the robot or K9 is right next to the hatch, so clear every room. <b>Eviction / civil papers standoff</b> (about ${Math.round(Core.SCEN_TYPES.sovcit.xw * 100)}%) — he rejects the court's authority and argues every point (his own negotiation lines; call-outs work poorly). Long guns, body armor, gas masks and braced/reinforced doors are each +${Math.round(Core.SOVCIT_CFG.boost * 100)} points more likely (capped at ${Math.round(Core.SOVCIT_CFG.cap * 100)}%).`)}
 ${HB('Scenarios', 'every scenario is generated from a seed: house layout, neighborhood, cruiser and suspect gear, patrol positions and the 911 call. The team level changes only your unit, never the map. <b>New Scenario</b> picks a new seed; add <kbd>#seed=12345</kbd> to the URL to jump straight into one as a Quick Mission at your last chosen level. Quick Missions and seed replays are <i>not</i> counted in your career.')}
 <div class="grid2"><div><b style="color:var(--cyan2)">Desktop</b><br>Click a unit / card or <kbd>1</kbd>–<kbd>9</kbd> to select · click map to order<br><kbd>M</kbd> move <kbd>N</kbd> work corner <kbd>B</kbd> breach <kbd>X</kbd> detonate <kbd>F</kbd> flash <kbd>G</kbd> gas <kbd>K</kbd> mask <kbd>C</kbd> clear <kbd>T</kbd> fire <kbd>U</kbd> suppress <kbd>O</kbd> overwatch <kbd>E</kbd> get in / exit <kbd>S</kbd> stance <kbd>H</kbd> hold <kbd>P</kbd> pole cam <kbd>I</kbd> intel<br><kbd>Backspace</kbd> undo · <kbd>Enter</kbd> execute · <kbd>Esc</kbd> deselect<br>Drag to pan · wheel to zoom · <kbd>0</kbd> fit · click the overview map to jump</div>
 <div><b style="color:var(--cyan2)">Touch</b><br>Tap a unit or chip to select · tap again for details<br>Tap the map to place orders (Fire: tap once to preview the hit chance, again to confirm)<br>One-finger drag to pan · pinch to zoom · ＋/－/⤢/▦ buttons<br>TEAMS / INTEL tabs open the panels; ▦ shows the overview map</div></div>
 <button data-close="m-help" class="on" style="width:100%;margin-top:12px">Got it</button></div>`;
document.addEventListener('click', e => { const c = e.target.closest('[data-close]'); if (c) { const id = c.dataset.close; if (id === 'left' || id === 'right') $(id).classList.remove('open'); else closeModal(id); layoutSafe(); }
  if (e.target.classList && e.target.classList.contains('modal')) closeModal(e.target.id); });

/* ---------------- breach method picker (popup at the door) ---------------- */
let popDoor = null;
function hidePop() { const p = $('pop'); if (p) p.className = ''; popDoor = null; }
function doorDesc(d) { const t = [];
  t.push(d.kind === 'garage' ? 'Garage door' : d.exterior ? 'Exterior door' : 'Interior door');
  if (d.locked) t.push('locked'); if (d.barricaded && d.barrKnown) t.push('<span style="color:var(--red)">BARRICADED</span>');
  if (d.storm && d.stormKnown) t.push(d.stormState === 'closed' ? '<span style="color:var(--amber)">storm door</span>' : 'storm door open');
  if (d.charge) t.push('<span style="color:var(--amber)">charge hung</span>'); return t.join(' · '); }
function showBreachPop(u, did, sx, sy) { const S = Core.state, d = S.doors[did]; popDoor = did;
  let h = `<div class="pt">${esc(d.name || 'Door')}<span>${doorDesc(d)}</span></div>`;
  for (const m of Object.keys(Core.BREACH)) { const e = Core.breachEst(u, d, m), ok = e.ok === true;
    const tip = ok ? e.text : e.ok;
    const line = `${Math.round(e.p * 100)}%${e.storm ? ` · storm ${Math.round(e.pStorm * 100)}%` : ''} · ~${e.ticks}t · ${e.noise}`;
    h += `<button data-bm="${m}" ${ok ? '' : 'disabled'} title="${esc(tip)}"><b>${esc(Core.BREACH[m].name)}${m === 'charge' ? ' — hang &amp; auto-detonate' : ''}</b><small>${ok ? line : esc(e.ok)}</small></button>`;
    if (m === 'charge' && ok) h += `<button data-bm="charge" data-hang="1" title="Hang the charge and back off to the safe standoff; use Detonate (X) when you choose"><b>Charge — hang only</b><small>detonate later on your command</small></button>`; }
  h += `<div class="pn">Breaching is noisy: the suspect will be alerted. Stay outside the ${Core.CHARGE_SAFE} m ring when a charge blows.</div>`;
  const p = $('pop'); p.innerHTML = h; p.className = 'show';
  const W = window.innerWidth, Hh = window.innerHeight, r = p.getBoundingClientRect();
  if (!isFinite(sx) || !isFinite(sy)) { sx = W / 2; sy = Hh / 2; }
  p.style.left = Math.max(6, Math.min(W - r.width - 6, sx - r.width / 2)) + 'px'; p.style.top = Math.max(60, Math.min(Hh - r.height - 140, sy - r.height - 18)) + 'px'; }
$('pop').addEventListener('click', e => { const b = e.target.closest('button[data-bm]'); if (!b || popDoor === null) return; const u = selUnit(); if (!u) return;
  const o = { type: 'breach', door: popDoor, method: b.dataset.bm }; if (b.dataset.hang) o.hangOnly = true; hidePop(); q(u.uid, o); });

/* ---------------- aim preview (Fire / Suppress) ---------------- */
function planEnd(u) { const P = Core.planFor(u); for (let i = P.length - 1; i >= 0; i--) if (P[i] && P[i].ok && P[i].end) return P[i].end; return [u.x, u.y]; }
function aimTarget(cx, cy) { let x = Math.floor(cx), y = Math.floor(cy), bd = 1.6;
  for (const sp of Core.suspList()) if (sp.visible && !['detained', 'escaped'].includes(sp.mode)) { const d = Math.hypot(sp.x + 0.5 - cx, sp.y + 0.5 - cy); if (d < bd) { bd = d; x = sp.x; y = sp.y; } } return [x, y]; }
function aimInfo(u, x, y, mode) { const from = u.perch ? [u.x, u.y] : planEnd(u); const h = Core.hitChance(u, x, y, from); let p = h.p || 0; if (mode === 'suppress') p = p * 0.35;
  V.aim = { fx: from[0], fy: from[1], x, y, p, why: h.why }; return h; }
function showAim(u, h, mode, confirm) { const b = $('aimbox'); if (!h) { b.className = ''; return; }
  let s = `<div class="pt">${mode === 'suppress' ? 'SUPPRESS' : 'FIRE'} · ${esc(h.weapon || '')}${h.d !== undefined ? ' · ' + h.d + ' m' : ''}<b>${h.why ? '—' : Math.round(V.aim.p * 100) + '%'}</b></div>`;
  if (h.why) s += `<div class="pr" style="color:var(--amber)">${esc(h.why)}</div>`;
  for (const pt of h.parts || []) s += `<div class="pr"><span>${pt.k}</span><i>${esc(pt.t)}</i><b>${pt.k === 'base' ? Math.round(pt.v * 100) + '%' : '×' + pt.v.toFixed(2)}</b></div>`;
  if (!h.why && h.cap && h.p >= h.cap - 0.001) s += `<div class="pr"><span>cap</span><i>max for this weapon</i><b>${Math.round(h.cap * 100)}%</b></div>`;
  if (mode === 'suppress') s += `<div class="pr"><span>suppress</span><i>spray: makes him duck, rarely hits</i><b>×0.35</b></div>`;
  if (confirm) s += `<div class="pn">Tap the same spot again to confirm</div>`;
  b.innerHTML = s; b.className = 'show'; }

/* ---------------- orders from map taps ---------------- */
let lastPtrType = 'mouse', pendingAim = null;
function q(uid, o) { const r = Core.queueOrder(uid, o); if (!r.ok) { toast(r.reason); return false; } SFX.order(); V.hint = null;
  if (o.type === 'move' && r.exposed) toast('⚠ EXPOSED — that spot is in view of the house windows/doors. Order queued anyway; check the preview before EXECUTE.');
  else if (o.type === 'move' && r.routeExposed) toast('⚠ Route crosses an EXPOSED stretch (red on the preview). Order queued.');
  refresh(true); return true; }
function mapTap(sx, sy) {
  const S = Core.state; if (S.phase !== 'planning') return;
  if (V.tool) { const [cx, cy] = Render.toCell(sx, sy), tool = V.tool; V.tool = null; const r = tool === 'ems' ? Core.setEMS(Math.floor(cx), Math.floor(cy)) : Core.setSurrenderSpot(Math.floor(cx), Math.floor(cy));
    if (!r.ok) toast(r.reason); else { SFX.order(); toast(tool === 'ems' ? 'EMS point moved' : 'Walk-out spot set — he will be told to walk here and kneel', true); } refresh(true); return; }
  const u0 = selUnit(); if (u0 && V.mode === 'board') { const car = Render.pickCar(sx, sy); if (car) { q(u0.uid, { type: 'board', car }); return; } }
  const hit = Render.pickUnit(sx, sy);
  if (hit && !(u0 && (V.mode === 'shoot' || V.mode === 'suppress'))) { hidePop(); if (hit === V.sel) { const u = Core.unit(hit); if (u.kind === 'team') openTeamDlg(hit); return; } const u = Core.unit(hit); if (u.status === 'ok' || u.kind === 'team') { select(hit); return; } }
  const u = selUnit(); if (!u) return;
  const [cx, cy] = Render.toCell(sx, sy), x = Math.floor(cx), y = Math.floor(cy);
  if (x < 0 || y < 0 || x >= Core.MAP_W || y >= Core.MAP_H) return;
  switch (V.mode) {
    case 'move': { hidePop(); let tx = x, ty = y; if (u.kind === 'patrol') { const c = S.contain.find(p => Math.hypot(p.x - cx + 0.5, p.y - cy + 0.5) < 1.6); if (c) { tx = c.x; ty = c.y; } }
      q(u.uid, { type: 'move', x: tx, y: ty }); break; }
    case 'breach': { const d = Render.pickDoor(cx, cy); if (d === null) { hidePop(); toast('Tap on a door'); return; } if (S.doors[d].state !== 'closed') { toast('That door is already open'); return; } showBreachPop(u, d, sx, sy); SFX.click(); break; }
    case 'polecam': case 'detonate': { const d = Render.pickDoor(cx, cy); if (d === null) { toast('Tap on a door'); return; } q(u.uid, { type: V.mode, door: d }); break; }
    case 'bang': case 'gas': case 'clear': { const r = Core.roomAt(x, y); if (r < 0) { toast('Tap inside a room'); return; } if (!S.rooms[r].known && V.mode === 'clear') { toast('Room layout unknown — gather intel or breach first'); return; }
      q(u.uid, { type: V.mode, room: r }); break; }
    case 'shoot': case 'suppress': { const [tx, ty] = aimTarget(cx, cy); const mode = V.mode === 'shoot' ? 'fire' : 'suppress';
      const h = aimInfo(u, tx, ty, V.mode);
      if (lastPtrType !== 'mouse' && !(pendingAim && Math.abs(pendingAim[0] - tx) <= 1 && Math.abs(pendingAim[1] - ty) <= 1)) { pendingAim = [tx, ty]; showAim(u, h, V.mode, true); return; }
      pendingAim = null; if (h.why) { toast('Cannot shoot there: ' + h.why); return; }
      if (q(u.uid, { type: 'shoot', x: tx, y: ty, mode })) { showAim(u, h, V.mode, false); setTimeout(() => { if (!pendingAim) $('aimbox').className = ''; }, 2600); } break; }
    case 'overwatch': { const p = Render.pickPerch(cx, cy); q(u.uid, p !== null && p !== undefined ? { type: 'overwatch', perch: p } : { type: 'overwatch', x, y }); break; }
    case 'drone': case 'robot': q(u.uid, { type: V.mode, x, y }); break;
    case 'tphone': case 'rphone': { const r = Core.roomAt(x, y); if (r < 0) { toast('Tap inside a room'); return; } q(u.uid, { type: 'tphone', room: r, via: V.mode === 'rphone' ? 'robot' : 'team' }); break; }
    case 'aid': case 'rescue': case 'evac': { const c = pickCas(cx, cy); if (!c) { toast('Tap on a casualty marker (✚)'); return; } q(u.uid, { type: V.mode, cas: c.id }); break; }
    case 'board': toast('Tap a vehicle'); break;
    case 'draco': { hidePop(); const d = Render.pickDoor(cx, cy); if (d !== null) { q(u.uid, { type: 'draco', door: d }); break; } const w = Render.pickWindow(cx, cy); if (w !== null) { q(u.uid, { type: 'draco', win: w }); break; } toast('Tap an exterior door or a window'); break; }
    case 'drive': hidePop(); q(u.uid, { type: 'drive', x, y }); break;
  }
}
function pickCas(cx, cy) { let best = null, bd = 2.2; for (const c of Core.state.cas || []) { if (!Core.casActive(c) || c.who === 'suspect' && c.state !== 'immobile') continue; const d = Math.hypot(c.x + 0.5 - cx, c.y + 0.5 - cy); if (d < bd) { bd = d; best = c; } } return best; }
function action(k) { const S = Core.state, u = selUnit();
  if (k === 'intel') { renderIntel(); $('m-intel').classList.add('show'); return; }
  if (k === 'undo') { if (u) { Core.undoOrder(u.uid); refresh(true); } return; }
  if (k === 'clearall') { if (u) { Core.clearOrders(u.uid); refresh(true); } return; }
  if (k === 'cancel' || k === 'esc') { V.mode = defMode(u); hidePop(); V.aim = null; pendingAim = null; $('aimbox').className = ''; refresh(true); return; }
  if (!u) { toast('Select a unit first'); return; }
  if (k === 'stance') { const st = STANCE_ORDER[(STANCE_ORDER.indexOf(u.stance || 'return') + 1) % 3]; Core.setStance(u.uid, st); SFX.click(); toast(`${u.name}: ${Core.STANCES[st]}`, true); refresh(true); return; }
  if (!allowed(u, k)) { toast(k === 'corner' ? 'No corner here — move to a hallway corner, door frame or house corner first' : 'Not available for this unit'); return; }
  hidePop(); V.aim = null; pendingAim = null; $('aimbox').className = '';
  if (k === 'hold') { q(u.uid, { type: 'hold' }); return; }
  if (k === 'corner') { q(u.uid, { type: 'corner' }); return; }
  if (k === 'pa' || k === 'callout') { q(u.uid, { type: 'pa', mode: k === 'pa' ? 'contact' : 'callout' }); return; }
  if ((k === 'aid' || k === 'rescue' || k === 'evac')) { const cs = (S.cas || []).filter(c => Core.casActive(c) && c.known && c.who !== 'suspect'); if (!cs.length) { toast('No known casualties'); return; } if (cs.length === 1) { q(u.uid, { type: k, cas: cs[0].id }); return; } }
  if (k === 'mask') { q(u.uid, { type: 'mask', on: u.mask !== 'on' }); return; }
  if (k === 'taser' || k === 'llfire') { if (q(u.uid, { type: k })) { const o = u.orders[u.orders.length - 1]; toast(`${u.name}: ${k === 'taser' ? 'taser' : '40mm less-lethal'} on the suspect — est. ${Math.round(100 * ((o && o.est) || 0))}%`, true); } return; }
  if (k === 'dracoinst') { const c = Core.bearcat(); if (c && q(u.uid, { type: 'dracoInstall', car: c.uid })) toast(`${u.name} → BearCat: install the Draco arm (${Core.DRACO_CFG.installTurns} turns of work${c.dracoProg ? ', ' + Math.round(100 * c.dracoProg / Core.installTicks()) + '% done' : ''})`, true); return; }
  if (k === 'exit-house' || k === 'exit-safe') { q(u.uid, { type: 'exit', side: k === 'exit-house' ? 'house' : 'safe' }); return; }
  if (k === 'detonate') { const ds = S.doors.filter(d => d.charge && d.charge.by === u.uid).concat(S.doors.filter(d => u.orders.some(o => o.type === 'breach' && o.hangOnly && o.door === d.id)));
    if (ds.length === 1) { q(u.uid, { type: 'detonate', door: ds[0].id }); return; } if (!ds.length) { toast('No charge hung by this team — Breach → Charge first'); return; } }
  V.mode = k; SFX.click(); refresh(true); }
function actsMore() { const a = $('acts'); a.classList.toggle('more', a.scrollWidth > a.clientWidth + 4 && a.scrollLeft + a.clientWidth < a.scrollWidth - 4); }
$('acts').addEventListener('scroll', actsMore); window.addEventListener('resize', actsMore); setInterval(actsMore, 500);
$('acts').addEventListener('wheel', e => { const a = $('acts'); if (a.scrollWidth > a.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { a.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
$('acts').addEventListener('click', e => { const b = e.target.closest('button[data-act]'); if (b && !b.disabled) action(b.dataset.act); });
function onPanelClick(e) { const info = e.target.closest('[data-team]'); if (info) { e.stopPropagation(); openTeamDlg(info.dataset.team); return; }
  if (e.target.closest('#b-form') || e.target.closest('#c-form')) { openForm(); return; } if (false) { const r = Core.formTeam(); if (!r.ok) toast(r.reason); else { SFX.order(); toast(`${r.team.name} team formed — tap ⓘ to review`, true); V.sel = r.team.uid; V.mode = 'move'; } refresh(true); return; }
  const c = e.target.closest('[data-sel]'); if (c) { const uid = c.dataset.sel; if (V.sel === uid && Core.unit(uid).kind === 'team' && e.currentTarget.id === 'chips') { openTeamDlg(uid); return; } select(uid);
    const u = Core.unit(uid); if (u && isPhone()) { $('left').classList.remove('open'); layoutSafe(); } if (u) centerOn(u); } }
$('teams').addEventListener('click', onPanelClick); $('chips').addEventListener('click', onPanelClick);
function centerOn(u) { const [sx, sy] = Render.toScreen(u.x + 0.5, u.y + 0.5); const w = window.innerWidth, h = window.innerHeight; if (sx < 60 || sy < 60 || sx > w - 60 || sy > h - 60) Render.centerOn(u.x + 0.5, u.y + 0.5); }

/* ---------------- execute loop ---------------- */
const TICK_MS = 300;
function execute() { const S = Core.state; if (S.phase !== 'planning' || busy) return; ac(); hidePop(); V.aim = null; $('aimbox').className = '';
  const n = S.units.reduce((a, q) => a + (q.status === 'ok' ? q.orders.length : 0), 0); if (!n && !S.cmd) toast('No orders queued — units will hold for 30 s', true);
  if (!Core.execute()) return; busy = true; SFX.exec(); V.hint = null; refresh(true);
  const step = () => { Render.snapshot(TICK_MS - 20); const done = Core.stepTick(); sounds(); refresh(); if (!done) setTimeout(step, TICK_MS); else setTimeout(() => { Render.endAnim(); busy = false; sounds(); refresh(true); if (Core.state.phase === 'over') { careerRecordEnd(); setTimeout(showEnd, 700); } else checkStranded(); }, TICK_MS); };
  setTimeout(step, 120); }
$('exec').addEventListener('click', execute);

/* ---------------- pointer: pan / pinch / wheel / tap ---------------- */
const cv = $('map'), ptr = new Map(); let drag = null, pinch = null;
cv.addEventListener('pointerdown', e => { lastPtrType = e.pointerType || 'mouse'; cv.setPointerCapture(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]); ac();
  if (ptr.size === 1) drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, t: performance.now() };
  if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 }; if (drag) drag.moved = true; } });
cv.addEventListener('pointermove', e => { if (!ptr.has(e.pointerId)) { if (e.pointerType !== 'mouse') return; const [cx, cy] = Render.toCell(e.clientX, e.clientY); const u = selUnit();
    V.hoverDoor = (V.mode === 'breach' || V.mode === 'polecam' || V.mode === 'detonate') && u ? Render.pickDoor(cx, cy) : null;
    if (u && (V.mode === 'shoot' || V.mode === 'suppress') && Core.state.phase === 'planning') { const [tx, ty] = aimTarget(cx, cy); if (!V.aim || V.aim.x !== tx || V.aim.y !== ty) showAim(u, aimInfo(u, tx, ty, V.mode), V.mode, false); }
    return; }
  ptr.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptr.size >= 2 && pinch) { const [a, b] = [...ptr.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]), cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2; Render.pan(cx - pinch.cx, cy - pinch.cy); Render.zoomAt(cx, cy, d / Math.max(1, pinch.d)); pinch = { d, cx, cy }; return; }
  if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 8) { drag.moved = true; hidePop(); } if (drag.moved) Render.pan(dx, dy); drag.x = e.clientX; drag.y = e.clientY; } });
function up(e) { if (!ptr.has(e.pointerId)) return; ptr.delete(e.pointerId); if (ptr.size < 2) pinch = null;
  if (ptr.size === 0) { if (drag && !drag.moved && e.type === 'pointerup') mapTap(e.clientX, e.clientY); drag = null; } else if (ptr.size === 1) { const [p] = [...ptr.values()]; drag = { x: p[0], y: p[1], sx: p[0], sy: p[1], moved: true }; } }
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
cv.addEventListener('wheel', e => { e.preventDefault(); hidePop(); Render.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
cv.addEventListener('contextmenu', e => { e.preventDefault(); if (V.sel) { Core.undoOrder(V.sel); refresh(true); } });
document.addEventListener('gesturestart', e => e.preventDefault());
$('z-in').onclick = () => Render.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25);
$('z-out').onclick = () => Render.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 0.8);
$('z-fit').onclick = () => Render.fit('house');
$('z-all').onclick = () => { if (isPhone()) { $('ovwf').classList.toggle('show'); } else Render.fit('all'); };
/* overview map(s): tap / drag to jump the camera */
function bindOvw(c) { let down = false; const jump = e => { const r = c.getBoundingClientRect(); Render.ovwJump(c, (e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height); };
  c.addEventListener('pointerdown', e => { down = true; c.setPointerCapture(e.pointerId); jump(e); e.preventDefault(); });
  c.addEventListener('pointermove', e => { if (down) jump(e); }); const stop = () => { down = false; }; c.addEventListener('pointerup', stop); c.addEventListener('pointercancel', stop); }
bindOvw($('ovw')); bindOvw($('ovw2'));
window.addEventListener('keydown', e => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return; if (!hasGame) return; const S = Core.state; const k = e.key.toLowerCase();
  if (k === 'escape') { if (document.querySelector('.modal.show')) document.querySelectorAll('.modal.show').forEach(m => closeModal(m.id)); else if (popDoor !== null) hidePop(); else { V.sel = null; V.aim = null; $('aimbox').className = ''; refresh(true); } return; }
  if (document.querySelector('.modal.show:not(.mini)')) return;
  if (k === 'enter') { execute(); return; } if (k === 'backspace') { e.preventDefault(); action('undo'); return; } if (k === '0') { Render.fit('house'); return; }
  if (/^[1-9]$/.test(k)) { const t = S.units.find(u => u.kind === 'team' && u.num === +k); if (t) { select(t.uid); centerOn(t); } return; }
  if (k === 's') { action('stance'); return; } if (k === 'i') { action('intel'); return; }
  const u = selUnit(); const a = actsFor(u).find(q => q.key.toLowerCase() === k); if (a) action(a.k); });

/* ---------------- top bar & layout ---------------- */
$('b-new').onclick = () => { const S = Core.state; if (S.opts && S.opts.career && !careerAllowed()) return toast('A career mission is under way — finish it, withdraw or call the State SWAT team first.'); closeModal('m-menu'); newGame(0, false, S.opts && S.opts.mode === 'quick' ? S.opts.level : QLEVEL, QTYPE); };
$('b-help').onclick = () => $('m-help').classList.add('show');
function setMuteIcon() { $('b-mute').textContent = muted ? '🔇' : '🔊'; }
$('b-mute').onclick = () => { muted = !muted; localStorage.setItem('swat.muted', muted ? '1' : '0'); setMuteIcon(); if (!muted) SFX.click(); };
$('t-teams').onclick = () => { $('right').classList.remove('open'); $('left').classList.toggle('open'); layoutSafe(); };
$('t-intel').onclick = () => { $('left').classList.remove('open'); $('right').classList.toggle('open'); renderInfo(); layoutSafe(); };
function setCollapsed(id, on) { const el = $(id); el.classList.toggle('col', on); const b = $('tg-' + id); if (b) { b.textContent = (id === 'left') === on ? '›' : '‹'; b.setAttribute('aria-expanded', on ? 'false' : 'true'); } }
$('tg-left').onclick = e => { e.stopPropagation(); setCollapsed('left', !$('left').classList.contains('col')); layoutSafe(); };
$('tg-right').onclick = e => { e.stopPropagation(); setCollapsed('right', !$('right').classList.contains('col')); renderInfo(); layoutSafe(); };
/** Small / landscape screens start with both side panels condensed so the map stays visible. */
function defaultPanels() { const small = !isPhone() && (window.innerHeight <= 560 || window.innerWidth <= 1100); setCollapsed('left', small); setCollapsed('right', small); if (isPhone()) { setCollapsed('left', false); setCollapsed('right', false); } }
// brief / intel dialogs: a ▾ button folds them to their title bar
for (const id of ['brief-dlg', 'intel-dlg', 'c911-dlg']) { const d = $(id), m = d.parentElement;
  new MutationObserver(() => { if (!m.classList.contains('show')) m.classList.remove('mini'); const ph = d.querySelector('.ph'); if (ph && !ph.querySelector('.mtog')) { const b = document.createElement('button'); b.className = 'ib mtog'; b.title = 'Collapse / expand'; b.textContent = m.classList.contains('mini') ? '▸' : '▾'; const x = ph.querySelector('[data-close]'); x ? ph.insertBefore(b, x) : ph.appendChild(b); } }).observe(d, { childList: true });
  d.addEventListener('click', e => { if (!e.target.closest('.mtog')) return; e.stopPropagation(); const on = !m.classList.contains('mini'); m.classList.toggle('mini', on); e.target.textContent = on ? '▸' : '▾'; }); }
let lastPhone = null;
function layoutSafe() { const ph = isPhone(); if (ph !== lastPhone) { lastPhone = ph; defaultPanels(); } document.querySelectorAll('.mclose').forEach(b => b.style.display = ph ? 'inline-flex' : 'none');
  const r = (id) => { const el = $(id); if (!el || getComputedStyle(el).display === 'none') return null; return el.getBoundingClientRect(); };
  const top = r('top'), bot = r('bottom'), L = !ph && r('left'), R = !ph && r('right'), ch = ph && r('chips');
  Render.setSafe({ l: L ? L.right + 6 : 0, r: R ? window.innerWidth - R.left + 6 : 0, t: (ch ? ch.bottom : top ? top.bottom : 0) + 4, b: bot ? window.innerHeight - bot.top + (ph ? 26 : 30) : 0 });
  const z = $('zoom'); if (!ph && R) z.style.right = (window.innerWidth - R.left + 8) + 'px'; else z.style.right = ''; if (!ph && bot) z.style.bottom = (window.innerHeight - bot.top + 8) + 'px'; else z.style.bottom = '';
  const pb = r('bottom'); if (ph && pb) { $('ovwf').style.bottom = (window.innerHeight - pb.top + 34) + 'px'; }
}
function onResize() { layoutSafe(); Render.resize(true); }
/* v11 rotation fix: iOS Safari / home-screen apps report stale sizes during a rotate, so re-measure now and again a little later.
   Every re-measure rebuilds the canvas at CSS × dpr with one uniform scale and keeps the camera centre (see Render.resize). */
let rzT = []; function remeasure() { onResize(); rzT.forEach(clearTimeout); rzT = [120, 300, 650].map(ms => setTimeout(() => { layoutSafe(); Render.resize(); }, ms)); }
window.addEventListener('resize', remeasure); window.addEventListener('orientationchange', remeasure);
if (window.visualViewport) window.visualViewport.addEventListener('resize', remeasure);
document.addEventListener('fullscreenchange', remeasure); document.addEventListener('webkitfullscreenchange', remeasure);
try { const mq = window.matchMedia('(orientation: portrait)'); (mq.addEventListener ? mq.addEventListener('change', remeasure) : mq.addListener(remeasure)); } catch (e) { }


/* ---------------- mission brief / 911 call ---------------- */
let firstRun = false; try { firstRun = !localStorage.getItem('swat.seenHelp'); localStorage.setItem('swat.seenHelp', '1'); } catch (e) { }
/** Brief sections are collapsible; open by default on wide screens, folded on a phone. */
function briefOpen() { return typeof window !== 'undefined' && window.innerWidth >= 700 ? 'open' : ''; }
function openBrief() { const S = Core.state, B = S.brief; if (!B) return;
  const sc = S.scene || {}, inj = S.cas.find(c => c.initial);
  $('brief-dlg').innerHTML = `<div class="ph">Mission Brief<span class="sp"></span><small>${esc(S.opName)}${S.opts && S.opts.career ? ` · CAREER · TEAM LV ${S.opts.level}` : S.opts && S.opts.mode === 'quick' ? ` · QUICK · TEAM LV ${S.opts.level}` : ''}</small><button class="ib" data-close="m-brief">✕</button></div><div class="body" style="font-size:12.5px;color:#bcd0e6">
   <div class="stypebox"><b>${esc((B.stypeName || 'Barricaded subject').toUpperCase())}</b>${B.legal ? ` <span class="pill amber">legal: ${esc(B.legal)}</span>` : ''}<div>${esc(B.typeDesc || '')}</div></div>
   <div class="kv"><span>Call</span><b>${esc(B.callAt)} · ${B.channel === 'radio' ? 'patrol radio' : '911'} · ${esc(B.type)}</b><span>Address</span><b>${esc(B.addr)}</b><span>Caller</span><b style="font-size:11.5px">${esc(B.caller)}</b><span>Subject</span><b style="font-size:11.5px">${esc(B.suspect)}</b><span>Occupants</span><b style="font-size:11.5px;font-weight:500">${esc(B.occupants)}</b>${B.belief ? `<span>Count</span><b style="font-size:11.5px;color:var(--amber)">${esc(B.belief)}</b>` : ''}<span>Weapon</span><b style="font-size:11.5px;font-weight:500">${B.shots ? 'Shots reported' : 'No shots reported'}${B.sawGun ? ' · weapon seen' : ''}</b></div>
   ${B.officerDown ? `<div class="warnbox">⚠ <b>Officer down.</b> ${esc(B.officerDown === true ? 'A patrol officer was hit before SWAT arrived — condition unclear.' : B.officerDown)}</div>` : ''}
   ${B.arrival ? `<div class="${B.arrival.mode === 'all' ? 'note' : 'tl'}" style="margin-top:8px;font-size:12px">${B.arrival.mode === 'all' ? '★ <b>Full team on scene.</b> ' : '<b>SWAT on scene:</b> '}${esc(B.arrival.mode === 'all' ? B.arrival.why : `${B.arrival.count} of ${B.arrival.of} at staging — ${B.arrival.why}`)}</div>` : ''}
   <details class="brs" id="brs-pre" ${briefOpen()}><summary class="sh" style="margin-top:10px">Before SWAT</summary><div class="tl">${B.patrol.map(p => `<div>${esc(p).replace(/(\d\d:\d\d(:\d\d)?)/g, '<b>$1</b>')}</div>`).join('')}</div></details>
   ${B.known && B.known.length ? `<details class="brs" id="brs-bg" ${briefOpen()}><summary class="sh">Background</summary><div style="font-size:12px">${B.known.map(esc).join('<br>')}</div></details>` : ''}
   <p style="font-size:11.5px;color:var(--dim);margin:10px 0 0">Mission clock starts at <b style="color:#fff">0:00</b> (${esc(B.activatedAt)}). Each EXECUTE = 30 s. ${Core.intelInfo().containKnown ? '' : 'Patrol positions are unconfirmed — a <b>Status Check</b> reveals any gap.'}${firstRun ? ' New here? Tap <b>?</b> for How to Play.' : ''}</p>
   <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button id="br-911" style="flex:1">☎ Listen to 911 call${S.intel.call911 ? ' ✓' : ''}</button><button id="br-go" class="on" style="flex:1">Take command ▸</button></div></div>`;
  $('m-brief').classList.add('show'); }
$('brief-dlg').addEventListener('click', e => { if (e.target.closest('#br-911')) { closeModal('m-brief'); open911(); } if (e.target.closest('#br-go')) { closeModal('m-brief'); if (firstRun) { firstRun = false; $('m-help').classList.add('show'); } } });
const TTS = { ok: typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined', on: false, i: -1, muted: false };
function stopSpeech() { TTS.on = false; TTS.i = -1; try { if (TTS.ok) speechSynthesis.cancel(); } catch (e) { } hiLine(); }
function hiLine() { document.querySelectorAll('#c911-dlg .tr').forEach((el, i) => el.classList.toggle('on', i === TTS.i)); const p = $('c9-play'); if (p) p.textContent = TTS.on ? '⏸ Stop' : '▶ Play audio'; }
function speakFrom(i) { const B = Core.state.brief; if (!TTS.ok || TTS.muted) return; const L = B.transcript; if (i >= L.length) { stopSpeech(); return; }
  TTS.on = true; TTS.i = i; hiLine(); const l = L[i]; let u;
  try { u = new SpeechSynthesisUtterance(l.who === '[Note]' ? l.text.replace(/\(\d{3}\) ?\d{3}-\d{4}/, 'on file') : l.text); u.rate = l.who === 'Dispatcher' ? 1.05 : 1.12; u.pitch = l.who === 'Dispatcher' ? 1.15 : 0.8;
    u.onend = () => { if (TTS.on && TTS.i === i) setTimeout(() => { if (TTS.on && TTS.i === i) speakFrom(i + 1); }, 250); }; u.onerror = () => { if (TTS.i === i) stopSpeech(); }; speechSynthesis.speak(u); } catch (e) { TTS.ok = false; stopSpeech(); } }
function open911() { const S = Core.state, B = S.brief; if (!B) return; const r = Core.review911(); refresh(true);
  $('c911-dlg').innerHTML = `<div class="ph">911 Call Record<span class="sp"></span><small>${esc(B.callAt)} · ${esc(B.stypeName || B.type)} · ${esc(B.addr)}</small><button class="ib" data-close="m-911">✕</button></div><div class="body">
   <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">${TTS.ok ? `<button id="c9-play" style="flex:1">▶ Play audio</button><button id="c9-skip" style="flex:1">⏭ Skip line</button><button id="c9-mute" style="flex:1">${TTS.muted ? '🔇 Unmute' : '🔈 Mute'}</button>` : '<span style="font-size:11px;color:var(--dim)">Audio playback is not supported on this browser — transcript only.</span>'}</div>
   <div>${B.transcript.map(l => `<div class="tr ${l.who === 'Caller' ? 'c' : l.who === '[Note]' ? 'n' : ''}"><span class="tt">${esc(l.t)}</span><span class="who">${esc(l.who === '[Note]' ? 'NOTE' : l.who.toUpperCase())}</span><span>${esc(l.text)}</span></div>`).join('')}</div>
   ${B.background && B.background.length ? `<div class="sh" style="margin-top:8px">Background audio</div><div style="font-size:11.5px;color:var(--dim)">${B.background.map(esc).join('<br>')}</div>` : ''}
   <div class="kv" style="margin-top:10px"><span>Phone number</span><b style="color:${S.nego.numberKnown ? 'var(--green)' : 'var(--dim)'}">${S.nego.numberKnown ? esc(B.phone || 'known') + ' · ' + esc(S.nego.numberSrc || '') : 'not obtained from this call'}</b></div>
   <div style="display:flex;gap:8px;margin-top:12px"><button id="c9-brief" style="flex:1">◂ Brief</button><button data-close="m-911" class="on" style="flex:1">Close</button></div></div>`;
  $('m-911').classList.add('show'); hiLine(); }
$('c911-dlg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'c9-play') { if (TTS.on) stopSpeech(); else { TTS.muted = false; try { speechSynthesis.cancel(); } catch (x) { } speakFrom(0); } }
  if (b.id === 'c9-skip' && TTS.on) { const i = TTS.i; try { speechSynthesis.cancel(); } catch (x) { } TTS.i = -2; setTimeout(() => speakFrom(i + 1), 60); }
  if (b.id === 'c9-mute') { TTS.muted = !TTS.muted; if (TTS.muted) stopSpeech(); b.textContent = TTS.muted ? '🔇 Unmute' : '🔈 Mute'; }
  if (b.id === 'c9-brief') { closeModal('m-911'); openBrief(); } });
$('b-brief').onclick = () => openBrief();

/* ---------------- career screen (UI only; storage lives in career.js) ---------------- */
let CAREER = Career.load(), careerNotes = null, ccConfirm = false;
function careerEndHTML() { const S = Core.state;
  if (!(S.opts && S.opts.career)) return `<p style="font-size:11px;color:var(--dim);margin:10px 0 0">Quick scenario / seed replay — not counted in your career.</p>`;
  return `<div class="sh" style="margin-top:12px">Career</div><div style="font-size:12px;color:#bcd0e6">${(careerNotes || []).map(n => `<div>• ${esc(n)}</div>`).join('') || 'Saved.'}</div>`; }
function careerRecordEnd() { const S = Core.state; if (!(S.opts && S.opts.career) || S._careerSaved) return; S._careerSaved = true;
  try { careerNotes = Career.record(CAREER, Core.careerSummary()); if (!Career.save(CAREER)) careerNotes.push('(Could not write to browser storage — export a code to keep this career.)'); } catch (e) { careerNotes = ['Career save failed: ' + e.message]; } }
function openCareer() { ccConfirm = false; renderCareer(); $('m-career').classList.add('show'); }
function renderCareer(msg) { const C = CAREER, R = C.record, S = Core.state;
  const oc = Object.entries(R.outcomes).map(([k, v]) => `${({ negotiated: 'Negotiated surrender', callout: 'Call-out', arrest: 'Arrest', tactical: 'Tactical entry', lesslethal: 'Less-lethal', officerfire: 'Officer fire', perimeter: 'Caught on perimeter', escaped: 'Escaped', pursuit: 'Caught after escape', withdrawn: 'Withdrawn', timeout: 'Out of time (old rules)', aborted: 'Aborted (old rules)' })[k] || k} ${v}`).join(' · ') || '—';
  const roster = C.roster.slice().sort((a, b) => (a.recover > 0) - (b.recover > 0) || b.xp - a.xp).map(o => `<tr style="${o.recover > 0 ? 'opacity:.6' : ''}"><td><b>${esc(o.rank)} ${esc(o.last)}</b>${o.dog ? ` <small style="color:var(--dim)">+ ${esc(o.dog)}</small>` : ''}</td><td>${Core.SPECS[o.spec].icon} ${esc(Career.SPEC_NAME[o.spec])}${o.quals.includes('spotter') ? ' <span class="chip">◆ Spotter</span>' : ''}</td><td>${Math.round(o.skill * 100)}</td><td class="hm3">${o.xp}</td><td class="hm3">${o.missions}</td><td>${o.recover > 0 ? `<span class="pill amber">RECOVERING · ${o.recover}</span>` : '<span class="pill green">READY</span>'}</td></tr>`).join('');
  const LI = Career.levelInfo(C), T = Career.teamForLevel(LI.level);
  const un = Object.entries(Career.LEVEL.gear).map(([k, g]) => ({ k, at: g[0], n: (T.gear[k] || 0) })).concat([{ k: 'staff', at: 1, n: T.staff, lab: 'Personnel' }, { k: 'teamMax', at: 1, n: T.teamMax, lab: 'Max team size' }, { k: 'armored', at: Career.LEVEL.armoredAt, n: T.armored ? 1 : 0, lab: 'Armored rescue vehicle' }])
    .map(r => { const own = LI.level >= r.at; return `<div class="ucard ${own ? 'own' : ''}"><b>${esc(r.lab || Career.GEAR_NAME[r.k] || r.k)}</b>${own ? `<span style="color:var(--green)">✓ ${r.k === 'armored' ? 'available' : '× ' + r.n}</span>` : `<span style="color:var(--dim)">🔒 unlocks at level ${r.at}</span>`}</div>`; }).join('');
  const mem = C.memorial.length ? C.memorial.map(m => `<div>✦ <b style="color:#fff">${esc(m.rank)} ${esc(m.last)}</b> — ${esc(Career.SPEC_NAME[m.spec] || m.spec)}, ${m.missions} mission${m.missions > 1 ? 's' : ''} · ${esc(m.date)}</div>`).join('') : '<div style="color:var(--dim)">No officers lost.</div>';
  const hist = C.history.slice(0, 6).map(h => `<div>${esc(h.date.slice(0, 10))} · <span style="color:${h.win ? 'var(--green)' : 'var(--red)'}">${esc(h.title)}</span> · ${Core.tMin(h.timeSec / 30)} · ${h.score} pts · ${esc(h.grade)}</div>`).join('') || '<div style="color:var(--dim)">No missions yet.</div>';
  const replay = hasGame && S && !(S.opts && S.opts.career) && S.phase !== 'over' ? `<button id="cc-seed" style="flex:1">Play seed ${S.seed} as career mission</button>` : '';
  const ready = Career.available(C).length;
  const lvBox = `<div class="lvbox"><div class="lvn">LV <b>${LI.level}</b></div><div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;gap:8px"><b style="color:#fff">Team level ${LI.level} / 100</b><span>${LI.xp.toLocaleString('en-US')} team XP</span></div><div class="lvbar"><i style="width:${Math.round(LI.pct * 100)}%"></i></div><div style="font-size:11px;color:var(--dim)">${LI.level >= 100 ? 'Maximum level — full unit, all gear' : `${(LI.next - LI.xp).toLocaleString('en-US')} XP to level ${LI.level + 1}`} · ${T.staff} personnel · teams up to ${T.teamMax}</div></div></div>`;
  $('career-dlg').innerHTML = `<div class="ph">Career · SWAT Unit<span class="sp"></span><small>LV ${LI.level} · ${LI.xp} XP · SAVED IN ${esc(Career.storageKind === 'localStorage' ? 'BROWSER' : 'MEMORY ONLY')}</small><button class="ib" data-close="m-career">✕</button></div><div class="body" style="font-size:12.5px;color:#bcd0e6">
   ${msg ? `<div class="note" style="margin-bottom:8px">${esc(msg)}</div>` : ''}${C.recovered || C.rosterRebuilt ? '<div class="warnbox">The saved roster was damaged — a new roster was assigned. Team level and XP were kept.</div>' : ''}
   ${lvBox}
   <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><button id="cc-start" class="on" style="flex:2" ${ready ? '' : 'disabled'}>▶ Take the next call <small>(choose from random calls · ${ready} officers ready)</small></button>${replay}</div>
   <div class="rec"><div><b>${R.played}</b>missions</div><div><b>${R.wins}–${R.losses}</b>won–lost</div><div><b>${R.played ? Core.tMin(R.timeSec / 30 / R.played) : '—'}</b>avg time</div><div><b>${R.bestScore == null ? '—' : R.bestScore}</b>best score</div><div><b>${R.officersHit} / ${R.officersLost}</b>officers hit / lost</div><div><b>${R.patrolHit}</b>patrol hit</div><div><b>${R.suspects.unhurt} / ${R.suspects.injured} / ${R.suspects.lost}</b>suspects unhurt / injured / died</div><div><b>${LI.level}</b>team level</div></div>
   <div style="font-size:11.5px;margin-top:6px"><b style="color:#fff">Outcomes:</b> ${esc(oc)}</div>
   <div class="sh" style="margin-top:12px">Roster</div><table class="ctab"><tr><th>OFFICER</th><th>SPECIALTY</th><th>SKILL</th><th class="hm3">XP</th><th class="hm3">MISSIONS</th><th>STATUS</th></tr>${roster}</table>
   <div class="sh" style="margin-top:12px">Unit at level ${LI.level} <small style="color:var(--dim)">(gear and personnel grow with team level)</small></div><div class="ugrid">${un}</div>
   <div class="sh" style="margin-top:12px">Recent missions</div><div style="font-size:11.5px">${hist}</div>
   <div class="sh" style="margin-top:12px">Memorial</div><div style="font-size:12px">${mem}</div>
   <div class="sh" style="margin-top:12px">Save transfer</div><div style="font-size:11.5px;color:var(--dim);margin-bottom:4px">The code starts with your team level and XP (e.g. <code>SWATC3.L${LI.level}-X${LI.xp}-…</code>) — even a damaged code restores them. Older SWATC1/SWATC2 codes import too.</div><textarea id="cc-code" placeholder="Paste a career code here to import" spellcheck="false"></textarea>
   <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><button id="cc-exp" style="flex:1">Show / copy code</button><button id="cc-dl" style="flex:1">⭳ Download file</button><button id="cc-up" style="flex:1">⭱ Load file</button><button id="cc-imp" style="flex:1">Import code</button><input type="file" id="cc-file" accept=".txt,text/plain" style="display:none"></div>
   <div style="margin-top:14px;border-top:1px solid var(--line);padding-top:10px">${ccConfirm ? `<div class="warnbox">Erase this career (record, roster, unlocks, memorial)? This cannot be undone unless you exported a code.</div><div style="display:flex;gap:8px"><button id="cc-no" style="flex:1">Keep career</button><button id="cc-yes" style="flex:1;border-color:var(--red);color:var(--red)">Yes, start a new career</button></div>` : '<button id="cc-reset" style="width:100%">New Career…</button>'}</div></div>`; }
$('career-dlg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const C = CAREER;
  if (b.dataset.buy) { const r = Career.buy(C, b.dataset.buy); Career.save(C); SFX.order(); renderCareer(r.ok ? `Unlocked ${Career.UNLOCKS[b.dataset.buy].name}${r.recruit ? ' — hired Ofc. ' + r.recruit.last : ''}.` : r.reason); return; }
  if (b.id === 'cc-start') { careerNotes = null; closeModal('m-career'); openCalls(); }
  if (b.id === 'cc-seed') { careerNotes = null; closeModal('m-career'); newGame(Core.state.seed, true); }
  if (b.id === 'cc-exp') { const code = Career.exportCode(C); $('cc-code').value = code; $('cc-code').select(); let ok = false; try { if (navigator.clipboard) { navigator.clipboard.writeText(code).catch(() => { }); ok = true; } } catch (x) { } toast(ok ? 'Career code copied (also shown in the box)' : 'Career code shown — copy it from the box', true); }
  if (b.id === 'cc-dl') { try { const blob = new Blob([Career.exportCode(C)], { type: 'text/plain' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `swat-career-${new Date().toISOString().slice(0, 10)}.txt`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); } catch (x) { toast('Download not available — use the code'); } }
  if (b.id === 'cc-up') $('cc-file').click();
  if (b.id === 'cc-imp') importCareer($('cc-code').value);
  if (b.id === 'cc-reset') { ccConfirm = true; renderCareer(); }
  if (b.id === 'cc-no') { ccConfirm = false; renderCareer(); }
  if (b.id === 'cc-yes') { CAREER = Career.reset(); ccConfirm = false; renderCareer('New career started.'); } });
function importCareer(code) { try { const c = Career.importCode(code); CAREER = c; Career.save(c); renderCareer(`Imported career: team level ${Career.levelOf(c)} (${c.teamXp} XP), ${c.record.played} missions, ${c.roster.length} officers.`); }
  catch (e) { try { const c = Career.importCode(code, { recoverXp: true }); CAREER = c; Career.save(c); renderCareer(`Code body was damaged (${e.message}) — team level ${Career.levelOf(c)} and ${c.teamXp} XP restored from the header with a new roster.`); } catch (e2) { renderCareer('Import failed: ' + e.message); } } }
$('career-dlg').addEventListener('change', e => { if (e.target.id !== 'cc-file' || !e.target.files[0]) return; const fr = new FileReader(); fr.onload = () => importCareer(String(fr.result)); fr.readAsText(e.target.files[0]); });
$('b-career').onclick = () => { if (!careerAllowed()) return toast('Career is available between scenarios — from the debrief, or before the first EXECUTE.'); closeModal('m-menu'); openCareer(); };
$('b-menu').onclick = () => { renderTop(); $('m-menu').classList.add('show'); };
$('b-state').onclick = () => openStateCall();
$('b-main').onclick = () => { const S = Core.state; if (S.opts && S.opts.career && !careerAllowed()) return toast('A career mission is under way — finish it, withdraw or call the State SWAT team first.'); closeModal('m-menu'); openMain(); };

/* ---------------- main menu, quick mission level, career calls ---------------- */
let QTYPE = ''; try { const t = localStorage.getItem('swat.qtype') || ''; if (!t || Core.SCEN_TYPES[t]) QTYPE = t; } catch (e) { }
let QLEVEL = 100; try { const v = +localStorage.getItem('swat.qlevel'); if (v >= 1 && v <= 100) QLEVEL = Math.round(v); } catch (e) { }
const rndSeed = () => Math.floor(Math.random() * 999999) + 1; let menuSeed = rndSeed();
function teamLine(L) { const T = Career.teamForLevel(L), g = Object.keys(T.gear).filter(k => T.gear[k] > 0);
  return `<b style="color:#fff">${T.staff} personnel</b> · teams up to ${T.teamMax} · ${g.length}/${Object.keys(T.gear).length} gear types${T.armored ? ' · armored vehicle' : ''}${T.locked.length ? `<br><span style="color:var(--dim)">Locked: ${T.locked.slice(0, 4).map(l => `${esc(l.name)} (LV ${l.at})`).join(', ')}${T.locked.length > 4 ? '…' : ''}</span>` : '<br><span style="color:var(--green)">All gear, large counts</span>'}`; }
function renderMain() { const LI = Career.levelInfo(CAREER), started = CAREER.started || CAREER.record.played > 0;
  $('main-dlg').innerHTML = `<div class="ph">SWAT · Barricaded Subject<span class="sp"></span><small>TACTICAL COMMAND</small></div><div class="body mm">
   <div class="mmq"><button id="mm-quick" class="on mmb"><b>▶ Quick Mission</b><span>One scenario at the team level you pick · not saved to the career</span></button>
    <div class="lvrow"><label for="mm-lv">Team level</label><input type="range" id="mm-lv" min="1" max="100" step="1" value="${QLEVEL}"><input type="number" id="mm-lvn" min="1" max="100" value="${QLEVEL}" inputmode="numeric"></div>
    <div id="mm-team" class="mmt">${teamLine(QLEVEL)}</div>
    <div class="lvrow"><label for="mm-type">Call type</label><select id="mm-type" class="mmtype"><option value="">Random (from seed)</option>${Core.SCEN_KEYS.map(k => `<option value="${k}" ${QTYPE === k ? 'selected' : ''}>${esc(Core.SCEN_TYPES[k].name)}</option>`).join('')}</select></div>
    <div class="lvrow"><label>Seed</label><b id="mm-seed" style="color:#fff;flex:1">${menuSeed}</b><button id="mm-newseed">⟳ New seed</button></div></div>
   <div class="grid2 mmg"><button id="mm-career" class="mmb"><b>🎖 Career Mode</b><span>${started ? `Continue · team level ${LI.level} · ${LI.xp} XP` : 'Start at team level 1 and earn XP'}</span></button>
    <button id="mm-roster" class="mmb"><b>☰ Career / Roster</b><span>Level, roster, record, save codes</span></button>
    <button id="mm-help" class="mmb"><b>? How to play</b><span>Rules, controls, tips</span></button>
    <button id="mm-resume" class="mmb" ${hasGame && Core.state && Core.state.phase !== 'over' && mainResumable ? '' : 'disabled'}><b>▸ Resume</b><span>Back to the current scenario</span></button></div></div>`; }
let mainResumable = false, hasGame = false; // v8: no scenario exists until the player starts one
function openMain() { document.querySelectorAll('.modal.show').forEach(m => closeModal(m.id)); renderMain(); $('m-main').classList.add('show'); }
function setQLevel(v) { v = Math.max(1, Math.min(100, Math.round(+v || 1))); QLEVEL = v; try { localStorage.setItem('swat.qlevel', String(v)); } catch (e) { } if (!$('mm-lv')) return; $('mm-lv').value = v; if (+$('mm-lvn').value !== v) $('mm-lvn').value = v; $('mm-team').innerHTML = teamLine(v); }
$('main-dlg').addEventListener('input', e => { if (e.target.id === 'mm-lv') setQLevel(e.target.value); if (e.target.id === 'mm-lvn' && e.target.value !== '') { const v = +e.target.value; if (v >= 1 && v <= 100) setQLevel(v); } });
$('main-dlg').addEventListener('change', e => { if (e.target.id === 'mm-type') { QTYPE = Core.SCEN_TYPES[e.target.value] ? e.target.value : ''; try { localStorage.setItem('swat.qtype', QTYPE); } catch (er) { } } if (e.target.id === 'mm-lvn') setQLevel(e.target.value); });
$('main-dlg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; SFX.click();
  if (b.id === 'mm-quick') { closeModal('m-main'); newGame(menuSeed, false, QLEVEL, QTYPE); menuSeed = rndSeed(); }
  if (b.id === 'mm-newseed') { menuSeed = rndSeed(); $('mm-seed').textContent = menuSeed; }
  if (b.id === 'mm-career') { closeModal('m-main'); if (!CAREER.started) { CAREER.started = true; Career.save(CAREER); } openCalls(); }
  if (b.id === 'mm-roster') { closeModal('m-main'); openCareer(); }
  if (b.id === 'mm-help') { $('m-help').classList.add('show'); }
  if (b.id === 'mm-resume') closeModal('m-main'); });
const DIFF_COL = { ROUTINE: 'green', ELEVATED: 'amber', 'HIGH RISK': 'red' };
function openCalls(fresh) { document.querySelectorAll('.modal.show').forEach(m => closeModal(m.id)); const LI = Career.levelInfo(CAREER);
  $('calls-dlg').innerHTML = `<div class="ph">Dispatch · incoming calls<span class="sp"></span><small>CAREER · TEAM LV ${LI.level}</small><button class="ib" data-close="m-calls">✕</button></div><div class="body"><div style="color:var(--dim);font-size:12px">Receiving calls…</div></div>`; $('m-calls').classList.add('show');
  setTimeout(() => { const keep = !fresh && CAREER.calls && CAREER.calls.length && CAREER.calls.every(c => c && c.seed && c.label && c.lv === LI.level && c.stypeName);
    const calls = keep ? CAREER.calls : Career.makeCalls(CAREER, seed => Object.assign(Core.preview(seed, Career.missionOpts(CAREER)), { lv: LI.level }), 3); Career.save(CAREER); renderCalls(calls); }, 30); }
function renderCalls(calls) { const LI = Career.levelInfo(CAREER), ready = Career.available(CAREER).length;
  $('calls-dlg').innerHTML = `<div class="ph">Dispatch · incoming calls<span class="sp"></span><small>CAREER · TEAM LV ${LI.level} · ${ready} READY</small><button class="ib" data-close="m-calls">✕</button></div><div class="body">
   <div style="font-size:12px;color:#bcd0e6;margin-bottom:8px">Patrol units are holding these scenes. Pick the call your unit responds to — risk is estimated from the first reports.</div>
   <div class="calls">${calls.map((c, i) => `<button class="callc" data-call="${i}"><div style="display:flex;justify-content:space-between;gap:6px"><b style="color:#fff">${esc((c.stypeName || c.type).toUpperCase())}</b><span class="pill ${DIFF_COL[c.label] || 'amber'}">${esc(c.label)}</span></div>
     <div>${esc(c.type)} · ${esc(c.addr)} · ${esc(c.time)}</div><div style="color:var(--dim)">${esc(c.arch)}</div><div>${c.shots ? '⚠ shots fired' : 'no shots reported'}${c.officerDown ? ' · <span style="color:var(--red)">officer down</span>' : ''}${c.sawGun ? ' · weapon seen' : ''}</div><div style="color:var(--dim);font-size:11px">${esc(c.op)} · seed ${c.seed}</div></button>`).join('')}</div>
   <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button id="cl-roster" style="flex:1">Career / Roster</button><button id="cl-main" style="flex:1">Main menu</button></div></div>`; }
$('calls-dlg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.call != null) { const c = (CAREER.calls || [])[+b.dataset.call]; if (!c) return; if (!Career.available(CAREER).length) return toast('No officers ready — they are recovering.'); CAREER.calls = []; Career.save(CAREER); careerNotes = null; closeModal('m-calls'); newGame(c.seed, true); }
  if (b.id === 'cl-roster') { closeModal('m-calls'); openCareer(); } if (b.id === 'cl-main') { closeModal('m-calls'); openMain(); } });

/* ---------------- game lifecycle ---------------- */
function newGame(seed, career, level, stype) { if (busy) return; hasGame = true; document.body.classList.remove('nogame'); seed = seed || (Math.floor(Math.random() * 999999) + 1); Core.newGame(seed, career ? Career.missionOpts(CAREER) : Object.assign(Career.quickOpts(level || QLEVEL), stype && Core.SCEN_TYPES[stype] ? { stype } : {})); mainResumable = true; V.sel = null; V.mode = 'move'; V.hint = null; V.aim = null; pendingAim = null; hidePop(); $('aimbox').className = ''; logLen = -1; lastFxSound = 0; Core.state.events.length = 0;
  try { history.replaceState(null, '', '#seed=' + seed); } catch (e) { }
  if (Render.invalidate) Render.invalidate();
  document.querySelectorAll('.modal.show').forEach(m => closeModal(m.id)); onResize(); Render.fit('house'); refresh(true); openBrief(); }
let lastMini = 0;
function loop(now) { if (!hasGame) { requestAnimationFrame(loop); return; } Render.frame(now); if (!busy) refresh();
  if (now - lastMini > 120) { lastMini = now; const a = $('ovw'); if (a.offsetParent) Render.drawMini(a); const b = $('ovw2'); if ($('ovwf').classList.contains('show')) Render.drawMini(b); }
  requestAnimationFrame(loop); }
Render.init(cv); setMuteIcon();
window.addEventListener('hashchange', () => { const m = /seed=(\d+)/.exec(location.hash); if (m && (!Core.state || +m[1] !== Core.state.seed)) newGame(+m[1]); });
// #seed=N links straight into that scenario (Quick Mission at the saved team level); otherwise the main menu opens over a background scenario
// v8: without a #seed link the app opens on a plain main menu — nothing is generated, simulated or drawn behind it
const hs = /seed=(\d+)/.exec(location.hash); if (hs) newGame(+hs[1]); else { document.body.classList.add('nogame'); openMain(); }
requestAnimationFrame(loop);


/* test / automation hook */
window.GAME = { Core, Render, Career, openForm, openLoad, get career() { return CAREER; }, set career(c) { CAREER = c; }, openMain, openCalls, openStateCall, setQLevel, get qlevel() { return QLEVEL; }, get hasGame() { return hasGame; }, openBrief, open911, openCareer, select, mapTap, action, execute, openTeamDlg, closeModal, newGame, refresh, showBreachPop, hidePop, showAim, aimInfo, get busy() { return busy; }, setPtr(t) { lastPtrType = t; } };
})();
