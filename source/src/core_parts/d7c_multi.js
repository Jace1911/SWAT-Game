/* =====================================================================
   MULTIPLE SUSPECTS (v11) — the 'flee' call type can have 1-4 suspects.
   Every suspect is the same object model as the classic single suspect;
   rules written against S.suspect run per suspect through withSp(), which
   swaps S.suspect for the duration of a call. Outside a swap, S.suspect is
   always the "lead" (first still-hostile suspect) — negotiation talks to
   the lead and its result applies to the group (others may break away).
   Single-suspect types keep S.suspects = [S.suspect] and behave as before.
   Rules only: no DOM. Neutral wording.
   ===================================================================== */
/* ================== TUNABLE: MULTIPLE SUSPECTS ================== */
const MULTI_CFG = {
  countW: [0.50, 0.30, 0.14, 0.06],     // P(1), P(2), P(3), P(4) suspects on a 'flee' call
  dispW: { hiding: 0.30, fighting: 0.25, fleeing: 0.20, surrendering: 0.15, injured: 0.10 }, // starting state of each extra suspect
  weapons: ['handgun', 'handgun', 'handgun', 'shotgun', 'rifle'],
  mask: 0.05,
  follow: { base: 0.75, surrendering: 1, fighting: 0.45, injured: 0.9 }, // chance another suspect joins a group surrender
  hideFire: 0.6, fightFire: 1.15, fleeSlip: 1.6, surrTalk: 40, injImpair: 0.25,
  report: { exact: 0.45, under: 0.35, atleast: 0.20 } // what the patrol tells dispatch about the number of subjects
};
const SUS_LETTERS = 'ABCD';
let SP_DEPTH = 0;
function suspList() { return S.suspects && S.suspects.length ? S.suspects : (S.suspect ? [S.suspect] : []); }
function multiSp() { return !!(S.suspects && S.suspects.length > 1); }
function spActive(s) { return !!s && !['detained', 'escaped'].includes(s.mode); }
function spHostile(s) { return !!s && ['barricaded', 'alert', 'fleeing'].includes(s.mode); }
function suspById(k) { return suspList().find(s => s.key === k) || null; }
/** Lead = first hostile, else first walking out, else first active, else the first. Only changes S.suspect outside a swap. */
function setLead() { const L = S.suspects; if (!L || L.length < 2 || SP_DEPTH) return; S.suspect = L.find(spHostile) || L.find(s => s.walk) || L.find(spActive) || L[0]; }
function withSp(sp, fn) { if (!sp) return fn(S.suspect); const keep = S.suspect; S.suspect = sp; SP_DEPTH++;
  try { return fn(sp); } finally { SP_DEPTH--; S.suspect = keep; if (!SP_DEPTH) setLead(); } }
function eachSp(fn) { for (const s of suspList().slice()) withSp(s, fn); }
function spName(sp = S.suspect) { return multiSp() && sp && sp.label ? 'Suspect ' + sp.label : 'Suspect'; }
function labelAll() { for (const s of suspList()) if (!s.label) { s.labelled = true; s.label = SUS_LETTERS[suspList().filter(q => q.labelled).length - 1]; } }
function spPron(sp = S.suspect) { return multiSp() ? spName(sp) : 'He'; }
/** The suspect a shot at cell (tx,ty) is aimed at: one on/next to the cell, else the nearest active one in the same room. */
function suspectFor(tx, ty, fromX, fromY) { const L = suspList().filter(spActive); if (L.length < 2) return S.suspect;
  const on = L.filter(s => dist(s.x, s.y, tx, ty) <= 1.5).sort((a, b) => dist(a.x, a.y, tx, ty) - dist(b.x, b.y, tx, ty) || spHostile(b) - spHostile(a));
  if (on.length) return on[0]; const rm = roomAt(tx, ty); const inRm = L.filter(s => rm >= 0 && s.room === rm && (fromX == null || los(fromX, fromY, s.x, s.y) === 1));
  if (inRm.length) return inRm.sort((a, b) => dist(a.x, a.y, tx, ty) - dist(b.x, b.y, tx, ty))[0];
  return L.slice().sort((a, b) => dist(a.x, a.y, tx, ty) - dist(b.x, b.y, tx, ty))[0]; }
/** Best less-lethal / taser target from (sx,sy): nearest active suspect in view with a clear line, else the lead. */
function devTarget(sx, sy) { const L = suspList().filter(spActive); if (L.length < 2) return S.suspect;
  const c = L.filter(s => (s.visible || (s.lastKnown && s.lastKnown.turn === S.turn)) && los(sx, sy, s.x, s.y) === 1).sort((a, b) => spHostile(b) - spHostile(a) || dist(a.x, a.y, sx, sy) - dist(b.x, b.y, sx, sy));
  return c[0] || S.suspect; }
function suspectAtCell(x, y) { return suspList().find(s => spActive(s) && s.x === x && s.y === y) || null; }
function spInRoom(rm, pred = spActive) { return suspList().some(s => pred(s) && s.room === rm); }
/** Seeded count draw: separate stream so the map / scenario are unchanged by the count. */
function fleeCount(seed, opts) { if (opts && opts.suspects) return clamp(Math.round(opts.suspects), 1, 4);
  const r = makeRng(seed * 6101 + 29), W = MULTI_CFG.countW, tot = W.reduce((a, b) => a + b, 0); let p = r() * tot;
  for (let i = 0; i < W.length; i++) { p -= W[i]; if (p <= 0) return i + 1; } return 1; }
function wpick(r, W) { const ks = Object.keys(W); let p = r() * ks.reduce((a, k) => a + W[k], 0); for (const k of ks) { p -= W[k]; if (p <= 0) return k; } return ks[0]; }
/** Tag the classic suspect, then (flee calls only) add the extra suspects, each with its own spot, weapon, armor, mask and starting state. */
function setupSuspects() {
  const lead = S.suspect; lead.sid = 0; lead.key = 'S'; lead.label = 'A'; lead.disp = lead.disp || null; S.suspects = [lead];
  const n = S.stype && S.stype.key === 'flee' ? fleeCount(S.seed, S.opts) : 1;
  S.intel.suspSeen = 0; S.intel.suspConfirmed = null;
  if (n < 2) { setupSuspectArmor(); S.susCount = 1; return; }
  const r = makeRng(S.seed * 4421 + 71), used = [[lead.x, lead.y]];
  lead.disp = 'fleeing';
  const rooms = S.rooms.map((q, i) => i).filter(i => i !== lead.room && S.rooms[i].type !== 'hall');
  for (let k = 1; k < n; k++) {
    let best = null, bs = -1e9;
    for (let t = 0; t < 60; t++) { const ri = rooms.length && r.chance(0.85) ? r.pick(rooms) : lead.room; const q = S.rooms[ri];
      const x = q.x + r.int(0, q.w - 1), y = q.y + r.int(0, q.h - 1); if (S.block[idx(x, y)] || roomAt(x, y) !== ri) continue;
      const near = Math.min(...used.map(([a, b]) => dist(a, b, x, y))); if (near < 2) continue;
      const sameRoom = S.suspects.some(s => s.room === ri); const s = near * 0.3 - (sameRoom ? 3 : 0) + r();
      if (s > bs) { bs = s; best = [x, y, ri]; } }
    if (!best) break; used.push([best[0], best[1]]);
    const disp = wpick(r, MULTI_CFG.dispW);
    const sp = { x: best[0], y: best[1], home: { x: best[0], y: best[1] }, room: best[2], mode: disp === 'fighting' ? 'alert' : 'barricaded', stun: 0, agit: lead.agit, cd: 0, ambush: false,
      hasMask: r.chance(MULTI_CFG.mask), maskOn: false, maskSeen: false, maskDon: 0, impair: 0, phone: false, talk: 0, seen: false, lastKnown: null, heat: null, unseenTurns: 0, path: null, dir: r() * 6.28,
      weapon: r.pick(MULTI_CFG.weapons), atWindow: false, suppressed: 0, duck: 0, sid: k, key: 'S' + (k + 1), label: SUS_LETTERS[k], disp };
    if (disp === 'fighting') sp.agit = clamp(sp.agit + 15, 0, 100);
    if (disp === 'surrendering') { sp.talk = MULTI_CFG.surrTalk; sp.agit = clamp(sp.agit - 20, 0, 100); }
    if (disp === 'injured') { sp.injured = true; sp.hurt = MULTI_CFG.injImpair; sp.impair = MULTI_CFG.injImpair; }
    S.suspects.push(sp);
  }
  S.susCount = S.suspects.length; S.suspects.forEach(s => { s.label = null; s.labelled = false; }); // letters are given in the order they are first seen
  // armor per suspect: the lead keeps the classic stream, extras get their own
  setupSuspectArmor();
  const p = S.opts && S.opts.suspectArmor !== undefined ? S.opts.suspectArmor : ARMOR_CFG.suspect;
  S.suspects.slice(1).forEach(sp => { const ra = makeRng(S.seed * 977 + 13 + sp.sid * 131); sp.armor = ra.chance(p) ? (ra.chance(ARMOR_CFG.suspectPlate) ? 'plate' : 'soft') : 'none'; sp.armorKnown = false; });
}
/** What the patrol reported: { n, kind: 'exact'|'under'|'atleast', text }. Seeded, separate stream. */
function patrolReport() { const n = S.susCount || 1; if (!(S.stype && S.stype.key === 'flee')) return { n: 1, kind: 'exact', text: 'one subject' };
  const r = makeRng(S.seed * 3331 + 5); let kind = wpick(r, MULTI_CFG.report); if (kind === 'under' && n === 1) kind = 'exact';
  const said = kind === 'exact' ? n : kind === 'under' ? r.int(1, n - 1) : 1; const words = ['', 'one', 'two', 'three', 'four'];
  const text = kind === 'atleast' ? 'at least one subject — possibly more' : said === 1 ? 'one subject' : words[said] + ' subjects';
  return { n: said, kind, text }; }
/** Status-panel view of the suspect count: unknown until every suspect has been seen. */
function suspectCountInfo() { const L = suspList(), seen = L.filter(s => s.seen).length; const flee = S.stype && S.stype.key === 'flee'; const conf = !flee || !!S.intel.suspConfirmed || S.phase === 'over';
  const R = S.brief && S.brief.report; return { seen, total: conf ? L.length : null, confirmed: !!conf, belief: R ? R.text : 'one subject',
    custody: L.filter(s => s.mode === 'detained').length, down: L.filter(s => s.mode === 'incapacitated').length, active: L.filter(spHostile).length }; }
/** Reveal bookkeeping after a vision pass: when every suspect has been seen, the count is confirmed. */
function countObserve() { const L = suspList(); if (!(S.stype && S.stype.key === 'flee') || S.intel.suspConfirmed) return; const seen = L.filter(s => s.seen).length;
  const all = seen === L.length && S.rooms.every(q => q.explored || q.type === 'hall');
  if (seen > (S.intel.suspSeen || 0)) { S.intel.suspSeen = seen; if (!all) log(`${seen} suspect${seen > 1 ? 's' : ''} seen so far — the house is not cleared, there may be more.`, 'intel'); }
  // confirmation: all have been seen, and every room has been explored or the count is fully in view
  if (all) { S.intel.suspConfirmed = S.turn + 1; log(`Suspect count confirmed: ${L.length}.`, 'intel'); } }
function spState(sp) { return sp.mode === 'detained' ? 'in custody' : sp.mode === 'escaped' ? 'escaped' : sp.mode === 'incapacitated' ? 'down' : sp.mode === 'surrendered' ? 'surrendering'
  : sp.mode === 'fleeing' ? 'fleeing' : sp.stun > 0 ? 'stunned' : sp.injured && sp.mode === 'alert' ? 'injured' : sp.mode === 'alert' ? 'fighting' : 'hiding'; }
/** Group surrender: after the lead agrees to walk out, every other hostile suspect follows (one per turn) or breaks away. */
function groupWalkout(how) { if (!multiSp()) return; const lead = S.suspect; let k = 0;
  for (const s of suspList()) { if (s === lead || !spHostile(s) || s.stun > 0) continue; const F = MULTI_CFG.follow; const p = F[s.disp] != null ? F[s.disp] : F.base;
    if (S.rng.chance(p)) { k++; withSp(s, () => { walkout1(how, k); }); log(`${spName(s)} is coming out too.`, 'good'); }
    else { s.agit = clamp(s.agit + 15, 0, 100); if (s.mode === 'barricaded') s.mode = 'alert'; s.breakaway = true; log(`${spName(s)} refuses to come out with the others.`, 'alert'); } } }
/** Per-suspect debrief lines and stats. */
function suspectsDebrief() { const L = suspList(); if (L.length > 1) labelAll(); return L.map(sp => { const sc = S.cas.find(c => c.who === 'suspect' && c.ref === sp.key);
  return { k: L.length > 1 ? spName(sp) : 'Suspect', v: (sp.deceased ? 'Did not survive' : sc ? (sc.state === 'evacuated' ? 'Injured — evacuated to hospital in custody' : 'Injured') : sp.mode === 'detained' ? 'Uninjured, in custody' : sp.mode === 'escaped' ? 'Escaped' : sp.mode === 'incapacitated' ? 'Down, not secured' : 'Still inside')
    + (L.length > 1 && sp.method ? ` (${sp.method})` : '') + (L.length > 1 ? ` · ${SUSPECT_WEAPONS[sp.weapon].name}${sp.armor && sp.armor !== 'none' ? ', ' + sp.armor + ' armor' : ''}` : '') }; }); }
