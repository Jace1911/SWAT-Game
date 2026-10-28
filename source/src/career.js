/* =====================================================================
   CAREER — persistent profile: TEAM XP → TEAM LEVEL (primary), roster, record, memorial.
   Team level (1..100) drives staffing + armory through teamForLevel(): one data table (LEVEL),
   used both by Career Mode (level from team XP) and by Quick Mission (level picked on the menu).
   Save schema v3 (key unchanged: 'swat.career'). Team XP is the most protected value: stored at top
   level, validated on its own, mirrored to a tiny backup key, and kept even if the roster is damaged
   (the roster is then regenerated for the current level).
   Pure data + a tiny storage adapter. No DOM, no game rules, no render:
   the UI calls Career.*; the core only receives plain options
   ({ roster, gear, teamMax, armored }) and returns careerSummary().
   Storage: localStorage when available, else in-memory (swap the adapter
   for Capacitor Preferences on iOS).
   ===================================================================== */
const Career = (() => {
  const VERSION = 3, KEY = 'swat.career', XP_KEY = 'swat.career.teamxp', CODE_PREFIX = 'SWATC';
  const SPEC_NAME = { leader: 'Team Leader', breacher: 'Breacher', point: 'Point', tech: 'Robot / Tech', negotiator: 'Negotiator', medic: 'Medic', marksman: 'Sniper', k9: 'K9 Handler' };
  const RANKS = [[0, 'Ofc.'], [150, 'Cpl.'], [400, 'Sgt.'], [800, 'Lt.']];
  const NAMES = ['Ahn', 'Bauer', 'Carter', 'Duval', 'Ellis', 'Grant', 'Holm', 'Iqbal', 'Jensen', 'Keane', 'Lopez', 'Mbeki', 'Ortiz', 'Park', 'Ruiz', 'Shah', 'Torres', 'Usman', 'Vance', 'Weber', 'Young', 'Zane', 'Reyes', 'Kim', 'Novak', 'Okafor', 'Brennan', 'Castillo', 'Haddad', 'Lindqvist', 'Morales', 'Tran', 'Walsh', 'Diaz', 'Petrov', 'Hughes', 'Sato', 'Mensah', 'Kowalski', 'Rivera', 'Abara', 'Fischer', 'Quinn', 'Varga', 'Ito', 'Moreau', 'Nolan', 'Silva'];
  /** Unlock catalog. gear: armory pool overrides; base = what a new career has. */
  const UNLOCKS = {
    drone:      { name: 'Micro Drone', cost: 300, desc: 'Flying scout + thermal flyby (needs Tech).', gear: { drone: 1 } },
    robot:      { name: 'Ground Robot', cost: 450, desc: 'Tracked camera robot; can carry in a throw phone (needs Tech).', gear: { robot: 1 } },
    lesslethal: { name: 'Less-Lethal Launchers', cost: 350, desc: '40 mm launchers: incapacitate, or launch gas through windows.', gear: { lesslethal: 2 } },
    negotiator2:{ name: 'Second Negotiator', cost: 300, desc: 'A second negotiator on the call-out list.', recruit: 'negotiator' },
    armored:    { name: 'Armored Vehicle (BearCat)', cost: 700, desc: 'Armored rescue vehicle at staging: rounds stop against it.' },
    team6:      { name: 'Bigger Teams (6)', cost: 400, desc: 'Teams of up to 6 officers.', teamMax: 6 },
    sniper2:    { name: 'Second Sniper', cost: 350, desc: 'Another marksman on the call-out list.', recruit: 'marksman' },
    medkits:    { name: 'Extra Medkits', cost: 200, desc: '+2 medkits in the armory.', gear: { medkit: 5 } },
  };
  const BASE_GEAR = { drone: 0, robot: 0, lesslethal: 0 };
  const BASE_SPECS = ['leader', 'breacher', 'point', 'tech', 'negotiator', 'breacher', 'medic', 'marksman', 'k9']; // v6 starting roster (kept for migration)

  /* ---------- TEAM LEVEL: one data table, easy to retune ----------
     staff/teamMax/skill: [at level 1, at level 100], linear in between.
     order: who joins as the unit grows (first N are on the call-out list at that level).
     gear: item → [unlock level, count at unlock, count at 100]; locked items are 0.  */
  const LEVEL = {
    max: 100, staff: [4, 30], teamMax: [4, 8], skill: [0.6, 0.8], armoredAt: 60,
    order: ['leader', 'point', 'breacher', 'negotiator', 'medic', 'point', 'breacher', 'marksman', 'tech', 'k9',
      'negotiator', 'marksman', 'breacher', 'medic', 'point', 'tech', 'marksman', 'breacher', 'point', 'negotiator',
      'medic', 'k9', 'marksman', 'point', 'breacher', 'tech', 'medic', 'point', 'marksman', 'breacher'],
    gear: { shield: [1, 1, 6], ram: [1, 1, 4], halligan: [1, 1, 6], medkit: [1, 1, 10], bullhorn: [1, 1, 3],
      bang: [10, 2, 20], polecam: [15, 1, 4], tphone: [20, 1, 4], charge: [25, 1, 8], drone: [30, 1, 3],
      gas: [35, 1, 10], lesslethal: [45, 1, 6], robot: [50, 1, 3] },
    xpCurve: [40, 1.5], // team XP needed for level L = 40 · (L-1)^1.5  (L2 = 40, L10 ≈ 1 080, L50 ≈ 13 700, L100 ≈ 39 400)
  };
  const GEAR_NAME = { shield: 'Ballistic shields', ram: 'Rams', halligan: 'Halligan bars', medkit: 'Medkits', bullhorn: 'Bullhorns', bang: 'Flashbangs', polecam: 'Pole cameras', tphone: 'Throw phones', charge: 'Breaching charges', drone: 'Micro drone', gas: 'CS gas', lesslethal: 'Less-lethal launchers', robot: 'Ground robot' };
  const lerp = (a, b, t) => a + (b - a) * t;
  const clampL = L => Math.max(1, Math.min(LEVEL.max, Math.round(+L) || 1));
  /** Everything a team of this level brings: roster specialties, armory counts, unlocks, team size. */
  function teamForLevel(level) {
    const L = clampL(level), t = (L - 1) / (LEVEL.max - 1);
    const staff = Math.round(lerp(LEVEL.staff[0], LEVEL.staff[1], t)), specs = LEVEL.order.slice(0, staff);
    const gear = {}, unlocked = [], locked = [];
    for (const k in LEVEL.gear) { const [at, lo, hi] = LEVEL.gear[k]; if (L < at) { gear[k] = 0; locked.push({ k, at, name: GEAR_NAME[k] || k }); continue; }
      gear[k] = Math.round(lerp(lo, hi, at >= LEVEL.max ? 1 : (L - at) / (LEVEL.max - at))); unlocked.push(k); }
    const counts = {}; specs.forEach(s => counts[s] = (counts[s] || 0) + 1);
    return { level: L, staff, specs, counts, gear, unlocked, locked, teamMax: Math.round(lerp(LEVEL.teamMax[0], LEVEL.teamMax[1], t)), armored: L >= LEVEL.armoredAt,
      spotters: counts.marksman || 0, skill: +lerp(LEVEL.skill[0], LEVEL.skill[1], t).toFixed(2) };
  }
  function xpForLevel(L) { L = clampL(L); return Math.round(LEVEL.xpCurve[0] * Math.pow(L - 1, LEVEL.xpCurve[1])); }
  function levelForXp(xp) { xp = validXp(xp) || 0; let L = 1; while (L < LEVEL.max && xpForLevel(L + 1) <= xp) L++; return L; }
  function validXp(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(Math.min(n, 1e9)) : null; }
  function levelOf(c) { return levelForXp(c && c.teamXp); }
  function levelInfo(c) { const xp = validXp(c && c.teamXp) || 0, L = levelForXp(xp), a = xpForLevel(L), b = L < LEVEL.max ? xpForLevel(L + 1) : a;
    return { level: L, xp, cur: a, next: b, pct: L >= LEVEL.max ? 1 : (xp - a) / Math.max(1, b - a) }; }
  /** Options for a Quick Mission at a chosen level (no career roster, nothing recorded). */
  function quickOpts(level) { const T = teamForLevel(level); return { level: T.level, specs: T.specs, gear: Object.assign({}, T.gear), teamMax: T.teamMax, armored: T.armored, spotters: T.spotters, skill: T.skill, career: false, mode: 'quick' }; }
  /** Hire rookies until the roster holds every specialty the level calls for. */
  function staffTo(c, L) { const T = teamForLevel(L), out = [];
    for (const s in T.counts) { let have = c.roster.filter(o => o.spec === s).length; while (have < T.counts[s]) { out.push(recruit(c, s, true)); have++; } } return out; }

  /* ---------- storage adapter (graceful fallback) ---------- */
  const mem = {};
  let store = { get: k => (k in mem ? mem[k] : null), set: (k, v) => { mem[k] = v; return true; }, del: k => { delete mem[k]; }, kind: 'memory' };
  try { if (typeof localStorage !== 'undefined') { const t = '__swat_t'; localStorage.setItem(t, '1'); localStorage.removeItem(t);
    store = { get: k => localStorage.getItem(k), set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { mem[k] = v; return false; } }, del: k => { try { localStorage.removeItem(k); } catch (e) { } }, kind: 'localStorage' }; } } catch (e) { /* private mode / disabled: memory only */ }
  function setStorage(adapter) { store = adapter; }

  /* ---------- model ---------- */
  let seq = Date.now() % 100000;
  const rnd = () => Math.random();
  function recruit(c, spec, rookie) { const used = new Set(c.roster.map(o => o.last).concat(c.memorial.map(o => o.last)));
    const free = NAMES.filter(n => !used.has(n)); const last = free.length ? free[Math.floor(rnd() * free.length)] : NAMES[Math.floor(rnd() * NAMES.length)] + '-' + (c.roster.length + 1);
    const o = { id: 'R' + (++seq) + '-' + Math.floor(rnd() * 1e4), last, spec, quals: [], skill: +((rookie ? 0.6 : 0.64) + rnd() * 0.12).toFixed(2), xp: 0, rank: 'Ofc.', missions: 0, wins: 0, injuries: 0, recover: 0, hired: c.record.played };
    if (spec === 'k9') o.dog = ['Rex', 'Bruno', 'Koda', 'Max'][Math.floor(rnd() * 4)]; c.roster.push(o); return o; }
  /** Schema defaults (no roster). Every field here is filled in on load when missing. */
  function defaults() { return { v: VERSION, created: new Date().toISOString(), teamXp: 0, points: 0, earned: 0,
      record: { played: 0, wins: 0, losses: 0, outcomes: {}, timeSec: 0, bestScore: null, officersHit: 0, officersLost: 0, patrolHit: 0, patrolLost: 0, suspects: { unhurt: 0, injured: 0, lost: 0, escaped: 0, inside: 0 } },
      history: [], roster: [], memorial: [], unlocks: {}, calls: [], started: false }; }
  /** A new career: team level 1 (team XP 0) with the level-1 staff. */
  function fresh() { const c = defaults(); staffTo(c, 1); const ld = c.roster.find(o => o.spec === 'leader'); if (ld) ld.rank = 'Sgt.'; return c; }
  function validOfficer(o) { return o && typeof o === 'object' && typeof o.last === 'string' && o.last && SPEC_NAME[o.spec]; }
  function fixOfficer(o) { o.id = typeof o.id === 'string' && o.id ? o.id : 'R' + (++seq) + '-' + Math.floor(rnd() * 1e4); o.quals = Array.isArray(o.quals) ? o.quals.filter(q => typeof q === 'string') : [];
    o.skill = Number.isFinite(+o.skill) ? Math.max(0.3, Math.min(0.95, +o.skill)) : 0.62; for (const k of ['missions', 'wins', 'injuries', 'recover']) o[k] = Math.max(0, +o[k] | 0); o.xp = validXp(o.xp) || 0; o.rank = typeof o.rank === 'string' ? o.rank : rankFor(o.xp); return o; }
  /** Bring any older save up to the current schema. v1 = { version:1, played, wins, officers:[{name,spec,xp}] }. */
  /** Bring any older save up to the current schema without losing data.
      v1 (v1–v3 game): { version:1, played, wins, officers:[{name,spec,xp}] }
      v2 (v4–v6 game): { v:2, points, record, roster, memorial, unlocks, history }  → team XP = total roster XP earned
      v3 (v7+):        adds top-level teamXp (primary), calls, started.  Missing fields always default. */
  function migrate(d, xpHint) {
    if (!d || typeof d !== 'object') throw new Error('not a save');
    if (d.version === 1 && !d.v) { const c = defaults(); c.v = 2;
      (Array.isArray(d.officers) ? d.officers : []).forEach(o => { if (!o) return; const r = recruit(c, SPEC_NAME[o.spec] ? o.spec : 'point'); r.last = String(o.name || r.last).split(' ').pop(); r.xp = validXp(o.xp) || 0; r.rank = rankFor(r.xp); });
      c.record.played = d.played | 0; c.record.wins = d.wins | 0; c.record.losses = Math.max(0, c.record.played - c.record.wins); c.migratedFrom = 1; delete c.teamXp; d = c; }
    if (d.v === 2) { // v6 → v7: team XP is the sum of everything the unit has earned (roster + fallen officers' share)
      const rosterXp = (Array.isArray(d.roster) ? d.roster : []).reduce((a, o) => a + (o ? validXp(o.xp) || 0 : 0), 0);
      d.teamXp = validXp(d.teamXp) != null ? validXp(d.teamXp) : rosterXp; d.v = 3; d.migratedFrom = d.migratedFrom || 2; d.started = true; d.staffUp = true; }
    if (d.v === VERSION) { const f = defaults();
      // 1) PRIMARY: team XP, validated on its own; fall back to the backup mirror, then to roster XP
      let xp = validXp(d.teamXp); if (xp == null) xp = validXp(xpHint); if (xp == null) xp = (Array.isArray(d.roster) ? d.roster : []).reduce((a, o) => a + (o ? validXp(o.xp) || 0 : 0), 0); d.teamXp = xp;
      // 2) secondary data: default anything missing or malformed
      for (const k of ['record', 'unlocks']) d[k] = Object.assign({}, f[k], d[k] && typeof d[k] === 'object' ? d[k] : {});
      d.record.outcomes = d.record.outcomes && typeof d.record.outcomes === 'object' ? d.record.outcomes : {}; d.record.suspects = Object.assign({}, f.record.suspects, d.record.suspects || {});
      for (const k of ['history', 'memorial', 'calls']) if (!Array.isArray(d[k])) d[k] = [];
      for (const k of ['points', 'earned']) d[k] = Math.max(0, +d[k] | 0); if (typeof d.created !== 'string') d.created = f.created; d.started = !!d.started;
      // 3) roster: keep valid officers, regenerate the rest for the current level — team XP untouched
      d.roster = (Array.isArray(d.roster) ? d.roster : []).filter(validOfficer).map(fixOfficer);
      if (d.staffUp) { delete d.staffUp; staffTo(d, levelForXp(d.teamXp)); } // migrated careers get the hires their new level calls for (nobody removed)
      if (!d.roster.length) { d.rosterRebuilt = true; staffTo(d, levelForXp(d.teamXp)); const ld = d.roster.find(o => o.spec === 'leader'); if (ld) ld.rank = 'Sgt.'; }
      return d; }
    throw new Error('unknown save version ' + (d.v || d.version));
  }
  function rankFor(xp) { let r = 'Ofc.'; for (const [t, n] of RANKS) if (xp >= t) r = n; return r; }
  function backupXp() { try { const raw = store.get(XP_KEY); if (!raw) return null; const j = JSON.parse(raw); return j && j.v === 1 ? validXp(j.teamXp) : null; } catch (e) { return null; } }
  /** Load: a damaged main save never costs the team XP — it is recovered from the backup mirror. */
  function load() { const bx = backupXp(); let raw = null; try { raw = store.get(KEY); } catch (e) { }
    if (raw) { try { const d = migrate(JSON.parse(raw), bx); if (bx != null && bx > d.teamXp && validXp(JSON.parse(raw).teamXp) == null) d.teamXp = bx; return d; } catch (e) { /* fall through */ } }
    const c = fresh(); if (bx != null && bx > 0) { c.teamXp = bx; c.recovered = true; c.started = true; staffTo(c, levelForXp(bx)); } return c; }
  function save(c) { try { c.teamXp = validXp(c.teamXp) || 0; store.set(XP_KEY, JSON.stringify({ v: 1, teamXp: c.teamXp, level: levelForXp(c.teamXp), at: new Date().toISOString() })); return store.set(KEY, JSON.stringify(c)); } catch (e) { return false; } }
  function reset() { const c = fresh(); c.started = true; save(c); return c; }

  /** Mission options for Core.newGame: available officers (not recovering); gear, team size and vehicle from the TEAM LEVEL.
      Unlocks bought under the old (v6) points system still count as a floor, so no migrated career loses kit. */
  function missionOpts(c) {
    const T = teamForLevel(levelOf(c)), gear = Object.assign({}, T.gear); let teamMax = T.teamMax, armored = T.armored;
    for (const k in c.unlocks) { const u = UNLOCKS[k]; if (!u) continue; if (u.gear) for (const g in u.gear) gear[g] = Math.max(gear[g] || 0, u.gear[g]); if (u.teamMax) teamMax = Math.max(teamMax, u.teamMax); if (k === 'armored') armored = true; }
    const roster = c.roster.filter(o => !(o.recover > 0)).map(o => ({ id: o.id, last: o.last, spec: o.spec, quals: o.quals.slice(), skill: o.skill, rank: o.rank, dog: o.dog }));
    return { roster, gear, teamMax, armored, career: true, mode: 'career', level: T.level };
  }
  /** Random calls for the call-in screen. describe(seed) → Core.preview (scenario facts + a rough difficulty 1..3). */
  function makeCalls(c, describe, n = 3) { const L = levelOf(c), want = 1 + 2 * (L - 1) / 99, pool = [];
    for (let i = 0; i < n * 3; i++) { const seed = Math.floor(rnd() * 999998) + 1; const d = describe ? describe(seed) : { seed, diff: 2 }; pool.push(Object.assign({ seed }, d)); }
    pool.sort((a, b) => Math.abs(a.diff - want) - Math.abs(b.diff - want)); const out = pool.slice(0, n); if (n > 1 && L < 100) out[n - 1] = pool[pool.length - 1]; // one off-level call for variety
    c.calls = out; return out; }
  function available(c) { return c.roster.filter(o => !(o.recover > 0)); }
  /** Apply a finished mission (Core.careerSummary()) to the career. Returns a list of notes for the UI. */
  function record(c, m) {
    const R = c.record, notes = []; R.played++; if (m.win) R.wins++; else R.losses++; R.outcomes[m.outcome] = (R.outcomes[m.outcome] || 0) + 1; R.timeSec += m.timeSec | 0;
    R.bestScore = R.bestScore == null ? m.score : Math.max(R.bestScore, m.score); R.patrolHit += m.patrol.hit; R.patrolLost += m.patrol.lost; R.suspects[m.suspect] = (R.suspects[m.suspect] || 0) + 1;
    // recovering officers sat this one out: one mission closer to duty
    for (const o of c.roster) if (o.recover > 0 && !m.officers.some(q => q.careerId === o.id)) { o.recover--; if (!o.recover) notes.push(`${o.rank} ${o.last} is back on duty.`); }
    const L0 = levelOf(c), noWin = !!m.stateTakeover, acts = Array.isArray(m.actions) ? m.actions : []; let teamGain = 0;
    const actFor = id => acts.reduce((a, x) => a + ((x.ids || []).includes(id) ? x.xp : 0), 0);
    acts.forEach(x => { if (!(x.ids && x.ids.length)) teamGain += x.xp; }); // patrol / command actions: team XP only
    for (const q of m.officers) { const o = c.roster.find(x => x.id === q.careerId); if (!o) continue;
      if (q.cas && (q.cas.state === 'kia' || q.cas.state === 'lost')) { c.roster = c.roster.filter(x => x !== o); c.memorial.push({ last: o.last, rank: o.rank, spec: o.spec, missions: o.missions + 1, date: new Date().toISOString().slice(0, 10), seed: m.seed, op: m.title });
        R.officersLost++; R.officersHit++; notes.push(`${o.rank} ${o.last} (${SPEC_NAME[o.spec]}) was killed in the line of duty. Added to the memorial.`); continue; }
      o.missions++; if (m.win) o.wins++;
      const ax = actFor(q.id), xp = noWin ? ax : (q.onScene ? (q.inTeam ? 40 : 20) + (m.win ? 40 : 0) + Math.max(0, Math.round(m.score / 25)) : 5) + ax; o.xp += xp; teamGain += xp;
      const nr = rankFor(o.xp); if (nr !== o.rank && RANKS.findIndex(r => r[1] === nr) > RANKS.findIndex(r => r[1] === o.rank)) { o.rank = nr; notes.push(`${o.last} promoted to ${nr}`); }
      if (q.onScene) o.skill = +Math.min(0.95, o.skill + (m.win ? 0.012 : 0.006)).toFixed(3);
      if (o.missions === 4 && !o.quals.includes('spotter') && o.spec !== 'marksman' && o.spec !== 'leader' && m.win) { o.quals.push('spotter'); notes.push(`${o.last} qualified as Spotter.`); }
      if (q.cas) { R.officersHit++; o.injuries++; o.recover = q.cas.stable && q.cas.sev < 3 ? 1 : q.cas.sev >= 3 ? 3 : 2; notes.push(`${o.rank} ${o.last} injured — recovering, out for ${o.recover} mission${o.recover > 1 ? 's' : ''}.`); } }
    // keep every core role staffed: hire a rookie when nobody (fit or recovering) holds it
    c.teamXp = (validXp(c.teamXp) || 0) + teamGain; const L1 = levelOf(c);
    notes.unshift(`+${teamGain} team XP${noWin ? ' (individual actions only — no mission completion XP)' : ''} · Team level ${L1}${L1 > L0 ? ` ▲ (was ${L0})` : ''}`);
    if (L1 > L0) { const T0 = teamForLevel(L0), T1 = teamForLevel(L1); T1.unlocked.filter(k => !T0.unlocked.includes(k)).forEach(k => notes.push(`Unlocked: ${GEAR_NAME[k] || k}.`)); if (T1.teamMax > T0.teamMax) notes.push(`Teams of up to ${T1.teamMax}.`); if (T1.armored && !T0.armored) notes.push('Unlocked: armored rescue vehicle.'); }
    // keep every specialty the level calls for staffed: hire rookies (fallen officers replaced too)
    staffTo(c, L1).forEach(r => notes.push(`New hire: Ofc. ${r.last} (${SPEC_NAME[r.spec]}).`));
    const pts = m.score < 0 ? 10 : Math.max(25, Math.round(m.score / 4) + (m.win ? 50 : 0)); /* losses never end a mission early, they cut the score (and so the points) */ c.points += pts; c.earned += pts; /* legacy v6 points: kept for old saves, no longer shown */
    c.history.unshift({ date: new Date().toISOString(), seed: m.seed, win: m.win, title: m.title, outcome: m.outcome, score: m.score, grade: m.grade, timeSec: m.timeSec, teamXp: teamGain, level: L1, deductions: (m.deductions || []).map(d => d.label + ' ' + d.pts) }); c.history = c.history.slice(0, 25);
    return notes;
  }
  function buy(c, key) { const u = UNLOCKS[key]; if (!u) return { ok: false, reason: 'Unknown unlock' }; if (c.unlocks[key]) return { ok: false, reason: 'Already unlocked' }; if (c.points < u.cost) return { ok: false, reason: `Needs ${u.cost} points` };
    c.points -= u.cost; c.unlocks[key] = { at: c.record.played }; let r = null; if (u.recruit) r = recruit(c, u.recruit); return { ok: true, recruit: r }; }

  /* ---------- export / import as text code ---------- */
  function sum(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  const b64e = s => typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64');
  const b64d = s => typeof atob === 'function' ? decodeURIComponent(escape(atob(s))) : Buffer.from(s, 'base64').toString('utf8');
  /** Code: SWATC3.L<level>-X<teamXp>-<xpsum>.<sum>.<base64 json>  — team level/XP readable up front (old v1/v2 codes: SWATC2.<sum>.<b64>). */
  function exportCode(c) { const j = JSON.stringify(c), b = b64e(j), xp = validXp(c.teamXp) || 0; return `${CODE_PREFIX}${VERSION}.L${levelForXp(xp)}-X${xp}-${sum('X' + xp)}.${sum(j)}.${b}`; }
  function codeHeader(code) { const m = /^SWATC(\d+)\.L(\d+)-X(\d+)-([0-9a-z]+)\./.exec(String(code || '').trim()); if (!m || sum('X' + m[3]) !== m[4]) return null; return { v: +m[1], level: +m[2], teamXp: +m[3] }; }
  /** Import any code version. opt.recoverXp: a damaged body with an intact team-XP header still restores the team XP (new roster). */
  function importCode(code, opt) { const s = String(code || '').trim(); const m = /^SWATC(\d+)\.(?:L\d+-X\d+-[0-9a-z]+\.)?([0-9a-z]+)\.([A-Za-z0-9+/=\s]+)$/.exec(s); const h = codeHeader(s);
    const recover = why => { if (opt && opt.recoverXp && h) { const c = fresh(); c.teamXp = h.teamXp; c.started = true; c.recovered = true; staffTo(c, levelForXp(h.teamXp)); return c; } throw new Error(why); };
    if (!m) return recover('Not a career code');
    let j; try { j = b64d(m[3].replace(/\s+/g, '')); } catch (e) { return recover('Code is damaged'); } if (sum(j) !== m[2]) return recover('Code is damaged (checksum mismatch)');
    const d = migrate(JSON.parse(j), h ? h.teamXp : null); if (h && validXp(d.teamXp) !== h.teamXp && h.teamXp > d.teamXp) d.teamXp = h.teamXp; return d; }
  return { VERSION, KEY, XP_KEY, LEVEL, GEAR_NAME, teamForLevel, xpForLevel, levelForXp, levelOf, levelInfo, quickOpts, staffTo, makeCalls, codeHeader, defaults, UNLOCKS, SPEC_NAME, RANKS, fresh, migrate, load, save, reset, missionOpts, available, record, buy, exportCode, importCode, rankFor, setStorage, get storageKind() { return store.kind; } };
})();
if (typeof module !== 'undefined') module.exports = Career;
