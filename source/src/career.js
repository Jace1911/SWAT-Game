/* =====================================================================
   CAREER — persistent profile (roster, record, unlocks, memorial).
   Pure data + a tiny storage adapter. No DOM, no game rules, no render:
   the UI calls Career.*; the core only receives plain options
   ({ roster, gear, teamMax, armored }) and returns careerSummary().
   Storage: localStorage when available, else in-memory (swap the adapter
   for Capacitor Preferences on iOS).
   ===================================================================== */
const Career = (() => {
  const VERSION = 2, KEY = 'swat.career', CODE_PREFIX = 'SWATC';
  const SPEC_NAME = { leader: 'Team Leader', breacher: 'Breacher', point: 'Point', tech: 'Robot / Tech', negotiator: 'Negotiator', medic: 'Medic', marksman: 'Sniper', k9: 'K9 Handler' };
  const RANKS = [[0, 'Ofc.'], [150, 'Cpl.'], [400, 'Sgt.'], [800, 'Lt.']];
  const NAMES = ['Reyes', 'Kim', 'Novak', 'Okafor', 'Brennan', 'Castillo', 'Haddad', 'Lindqvist', 'Morales', 'Tran', 'Walsh', 'Diaz', 'Petrov', 'Hughes', 'Sato', 'Mensah', 'Kowalski', 'Rivera', 'Abara', 'Fischer', 'Quinn', 'Varga', 'Ito', 'Moreau', 'Nolan', 'Silva'];
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
  const BASE_SPECS = ['leader', 'breacher', 'point', 'tech', 'negotiator', 'breacher', 'medic', 'marksman', 'k9'];

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
    const free = NAMES.filter(n => !used.has(n)); const last = free.length ? free[Math.floor(rnd() * free.length)] : 'Recruit' + (c.roster.length + 1);
    const o = { id: 'R' + (++seq) + '-' + Math.floor(rnd() * 1e4), last, spec, quals: [], skill: +((rookie ? 0.6 : 0.64) + rnd() * 0.12).toFixed(2), xp: 0, rank: 'Ofc.', missions: 0, wins: 0, injuries: 0, recover: 0, hired: c.record.played };
    if (spec === 'k9') o.dog = ['Rex', 'Bruno', 'Koda', 'Max'][Math.floor(rnd() * 4)]; c.roster.push(o); return o; }
  function fresh() {
    const c = { v: VERSION, created: new Date().toISOString(), points: 0, earned: 0,
      record: { played: 0, wins: 0, losses: 0, outcomes: {}, timeSec: 0, bestScore: null, officersHit: 0, officersLost: 0, patrolHit: 0, patrolLost: 0, suspects: { unhurt: 0, injured: 0, lost: 0, escaped: 0, inside: 0 } },
      history: [], roster: [], memorial: [], unlocks: {} };
    BASE_SPECS.forEach(s => recruit(c, s)); c.roster.find(o => o.spec === 'leader').rank = 'Sgt.';
    const sp = c.roster.filter(o => !['leader', 'marksman'].includes(o.spec)); sp[1].quals.push('spotter'); sp[3].quals.push('spotter');
    return c;
  }
  /** Bring any older save up to the current schema. v1 = { version:1, played, wins, officers:[{name,spec,xp}] }. */
  function migrate(d) {
    if (!d || typeof d !== 'object') throw new Error('not a save');
    if (d.version === 1 && !d.v) { const c = fresh(); c.roster = [];
      (d.officers || []).forEach(o => { const r = recruit(c, o.spec || 'point'); r.last = String(o.name || r.last).split(' ').pop(); r.xp = o.xp | 0; r.rank = rankFor(r.xp); });
      if (!c.roster.length) BASE_SPECS.forEach(s => recruit(c, s));
      c.record.played = d.played | 0; c.record.wins = d.wins | 0; c.record.losses = Math.max(0, c.record.played - c.record.wins); c.migratedFrom = 1; d = c; }
    if (d.v === VERSION) { const f = fresh(); for (const k of ['record', 'unlocks']) d[k] = Object.assign({}, f[k], d[k] || {}); d.record.outcomes = d.record.outcomes || {}; d.record.suspects = Object.assign({}, f.record.suspects, d.record.suspects || {});
      d.history = d.history || []; d.memorial = d.memorial || []; d.roster = (d.roster || []).filter(o => o && o.spec && o.last); if (!d.roster.length) BASE_SPECS.forEach(s => recruit(d, s)); return d; }
    throw new Error('unknown save version ' + (d.v || d.version));
  }
  function rankFor(xp) { let r = 'Ofc.'; for (const [t, n] of RANKS) if (xp >= t) r = n; return r; }
  function load() { try { const raw = store.get(KEY); if (!raw) return fresh(); return migrate(JSON.parse(raw)); } catch (e) { return fresh(); } }
  function save(c) { try { return store.set(KEY, JSON.stringify(c)); } catch (e) { return false; } }
  function reset() { const c = fresh(); save(c); return c; }

  /** Mission options for Core.newGame: available officers (not recovering), gear and team size from unlocks. */
  function missionOpts(c) {
    const gear = Object.assign({}, BASE_GEAR); let teamMax = 5, armored = false;
    for (const k in c.unlocks) { const u = UNLOCKS[k]; if (!u) continue; if (u.gear) Object.assign(gear, u.gear); if (u.teamMax) teamMax = Math.max(teamMax, u.teamMax); if (k === 'armored') armored = true; }
    const roster = c.roster.filter(o => !(o.recover > 0)).map(o => ({ id: o.id, last: o.last, spec: o.spec, quals: o.quals.slice(), skill: o.skill, rank: o.rank, dog: o.dog }));
    return { roster, gear, teamMax, armored, career: true };
  }
  function available(c) { return c.roster.filter(o => !(o.recover > 0)); }
  /** Apply a finished mission (Core.careerSummary()) to the career. Returns a list of notes for the UI. */
  function record(c, m) {
    const R = c.record, notes = []; R.played++; if (m.win) R.wins++; else R.losses++; R.outcomes[m.outcome] = (R.outcomes[m.outcome] || 0) + 1; R.timeSec += m.timeSec | 0;
    R.bestScore = R.bestScore == null ? m.score : Math.max(R.bestScore, m.score); R.patrolHit += m.patrol.hit; R.patrolLost += m.patrol.lost; R.suspects[m.suspect] = (R.suspects[m.suspect] || 0) + 1;
    // recovering officers sat this one out: one mission closer to duty
    for (const o of c.roster) if (o.recover > 0 && !m.officers.some(q => q.careerId === o.id)) { o.recover--; if (!o.recover) notes.push(`${o.rank} ${o.last} is back on duty.`); }
    for (const q of m.officers) { const o = c.roster.find(x => x.id === q.careerId); if (!o) continue;
      if (q.cas && (q.cas.state === 'kia' || q.cas.state === 'lost')) { c.roster = c.roster.filter(x => x !== o); c.memorial.push({ last: o.last, rank: o.rank, spec: o.spec, missions: o.missions + 1, date: new Date().toISOString().slice(0, 10), seed: m.seed, op: m.title });
        R.officersLost++; R.officersHit++; notes.push(`${o.rank} ${o.last} (${SPEC_NAME[o.spec]}) was killed in the line of duty. Added to the memorial.`); continue; }
      o.missions++; if (m.win) o.wins++;
      const xp = q.onScene ? (q.inTeam ? 40 : 20) + (m.win ? 40 : 0) + Math.max(0, Math.round(m.score / 25)) : 5; o.xp += xp;
      const nr = rankFor(o.xp); if (nr !== o.rank && RANKS.findIndex(r => r[1] === nr) > RANKS.findIndex(r => r[1] === o.rank)) { o.rank = nr; notes.push(`${o.last} promoted to ${nr}`); }
      if (q.onScene) o.skill = +Math.min(0.95, o.skill + (m.win ? 0.012 : 0.006)).toFixed(3);
      if (o.missions === 4 && !o.quals.includes('spotter') && o.spec !== 'marksman' && o.spec !== 'leader' && m.win) { o.quals.push('spotter'); notes.push(`${o.last} qualified as Spotter.`); }
      if (q.cas) { R.officersHit++; o.injuries++; o.recover = q.cas.stable && q.cas.sev < 3 ? 1 : q.cas.sev >= 3 ? 3 : 2; notes.push(`${o.rank} ${o.last} injured — recovering, out for ${o.recover} mission${o.recover > 1 ? 's' : ''}.`); } }
    // keep every core role staffed: hire a rookie when nobody (fit or recovering) holds it
    for (const s of BASE_SPECS.filter((v, i, a) => a.indexOf(v) === i)) if (!c.roster.some(o => o.spec === s)) { const r = recruit(c, s, true); notes.push(`New hire: Ofc. ${r.last} (${SPEC_NAME[s]}).`); }
    const pts = Math.max(25, Math.round(m.score / 4) + (m.win ? 50 : 0)); c.points += pts; c.earned += pts; notes.unshift(`+${pts} career points`);
    c.history.unshift({ date: new Date().toISOString(), seed: m.seed, win: m.win, title: m.title, outcome: m.outcome, score: m.score, grade: m.grade, timeSec: m.timeSec }); c.history = c.history.slice(0, 25);
    return notes;
  }
  function buy(c, key) { const u = UNLOCKS[key]; if (!u) return { ok: false, reason: 'Unknown unlock' }; if (c.unlocks[key]) return { ok: false, reason: 'Already unlocked' }; if (c.points < u.cost) return { ok: false, reason: `Needs ${u.cost} points` };
    c.points -= u.cost; c.unlocks[key] = { at: c.record.played }; let r = null; if (u.recruit) r = recruit(c, u.recruit); return { ok: true, recruit: r }; }

  /* ---------- export / import as text code ---------- */
  function sum(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  const b64e = s => typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64');
  const b64d = s => typeof atob === 'function' ? decodeURIComponent(escape(atob(s))) : Buffer.from(s, 'base64').toString('utf8');
  function exportCode(c) { const j = JSON.stringify(c), b = b64e(j); return `${CODE_PREFIX}${VERSION}.${sum(j)}.${b}`; }
  function importCode(code) { const m = /^SWATC(\d+)\.([0-9a-z]+)\.([A-Za-z0-9+/=\s]+)$/.exec(String(code || '').trim()); if (!m) throw new Error('Not a career code');
    const j = b64d(m[3].replace(/\s+/g, '')); if (sum(j) !== m[2]) throw new Error('Code is damaged (checksum mismatch)'); return migrate(JSON.parse(j)); }
  return { VERSION, KEY, UNLOCKS, SPEC_NAME, RANKS, fresh, migrate, load, save, reset, missionOpts, available, record, buy, exportCode, importCode, rankFor, setStorage, get storageKind() { return store.kind; } };
})();
if (typeof module !== 'undefined') module.exports = Career;
