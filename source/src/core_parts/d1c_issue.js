/* ===================== v19 SPECIALTIES · TAKE-HOME GEAR · EQUIPMENT ISSUE =====================
   Everyone is a basic operator first. Personal kit (always with the officer, also on foot at secondary staging):
   pistol, rifle, taser, the best body armor and helmet the team has, gas mask — plus the PRIMARY specialty's take-home items.
   Everything else lives on the equipment vehicle (primary staging) and is drawn on the issue screen.
   A secondary specialty gives 75% of the skill bonus; its equipment is never auto-issued (fetch it at the vehicle). */
const SPEC2_MUL = 0.75;
Object.assign(SPECS, {
  ll:     { name: 'Less-Lethal Specialist', icon: '◍', desc: 'Carries a single-shot 40mm (reload = a full turn). Draws the 4-shot 40mm + 40mm CS rounds at the equipment vehicle' },
  gas:    { name: 'Gas Specialist', icon: '☁', desc: 'Standard gear; with a Gas Bag from the equipment vehicle, hand-thrown canisters land where intended far more often' },
  driver: { name: 'Driver', icon: '⛟', desc: 'Drives the BearCat or the equipment vehicle; standard gear' },
});
SPECS.marksman.desc += '. Carries the precision rifle and a spotting scope';
SPECS.point.desc += '. Carries a IIIA ballistic shield (Level III shields are on the equipment vehicle)';
SPECS.breacher.desc += '. Carries ram + halligan; charges come from the equipment vehicle';
SPECS.medic.desc += '. Carries a medical bag';
SPECS.tech.name = 'Robot / Drone / EOD Op'; SPECS.tech.desc = 'Operates drones and robots — all robotics live on the equipment vehicle (standard personal gear)';
Object.assign(EQUIP, {
  gasbag: { name: 'Gas Bag',          short: 'Gas Bag', pool: 1, desc: 'Bag of hand-thrown CS canisters (+3 canisters). A gas specialist throws them with better accuracy.' },
  cs40:   { name: '40mm CS Round',    short: '40mm CS', pool: 6, desc: 'CS round for the 4-shot 40mm: fired through a window, an open door or at the suspect. About 1/4 of the gas of a hand-thrown canister.' },
  scope:  { name: 'Spotting Scope',   short: 'Scope',   pool: 0, desc: 'Sniper / overwatch spotting scope.' },
});
Object.assign(ITEM_CFG, { gasbag: { where: 'packed' }, cs40: { where: 'vest' }, scope: { where: 'packed' } });
const GAS19 = { bag: 3, miss: 0.12, specCut: 0.8, missAmt: 0.45 };
const CS40_CFG = { frac: 0.25, issue: 4, range: 11 };
const LL19 = { singleMag: 1, multiMag: 4 };
const HELMETS = { std: { name: 'Ballistic helmet (IIIA)', short: 'IIIA helmet', stops: { pistol: 0.9, shotgun: 0.9, rifle: 0, sniper: 0 } },
  rifle: { name: 'Rifle-rated helmet', short: 'Rifle helmet', stops: { pistol: 1, shotgun: 1, rifle: 0.5, sniper: 0.2 } } };
const HELMET_CFG = { head: 0.3 }; // share of non-torso hits that strike the helmet
/** TAKE-HOME by primary specialty: [item, gear type the team must have unlocked]. */
const TAKE_HOME = { point: [['shield', 'shield']], breacher: [['ram', 'ram'], ['halligan', 'halligan']], ll: [['lesslethal', 'lesslethal']],
  marksman: [['sniper', null], ['scope', null]], medic: [['medkit', 'medkit']] };
function gearHave(k) { return !k || !S.gearHave || !!S.gearHave[k]; }
function bestArmor() { return gearHave('plate') ? 'plate' : 'soft'; }
function bestHelmet() { return gearHave('plate') ? 'rifle' : 'std'; }
function helmetOf(o) { return o && o.inv && o.inv.worn ? o.inv.worn.helmet || null : null; }
function takeHomeList(o) { return (TAKE_HOME[o.spec] || []).filter(([k, g]) => gearHave(g)).map(([k]) => k); }
function takeHomeBase(o, inv) { inv.worn.armor = bestArmor(); inv.worn.helmet = bestHelmet(); inv.home = takeHomeList(o);
  const toHand = k => { if (!inv.slung.includes(inv.prim)) inv.slung.push(inv.prim); inv.hands = [k, 'pistol']; inv.holster = inv.holster.filter(x => x !== 'pistol'); };
  for (const k of inv.home) {
    if (k === 'shield' || k === 'ram') { if (!inv.hands.includes('shield') && !inv.hands.includes('ram')) toHand(k); else inv.packed[k] = (inv.packed[k] || 0) + 1; }
    else if (k === 'lesslethal') { inv.slung.push('lesslethal'); inv.llMag = LL19.singleMag; inv.ll = S.llRounds || ITEM_CFG.lesslethal.rounds; inv.llLoad = 1; }
    else if (k !== 'sniper') inv.packed[k] = (inv.packed[k] || 0) + 1; } }
/* ---- 40mm: single-shot (take-home) or 4-shot (vehicle). inv.ll = rounds carried, inv.llLoad = rounds in the launcher ---- */
function llMagOf(inv) { return inv.llMag || LL19.multiMag; }
function llOk(o) { const inv = invOf(o); return !(inv.reloadT >= S.turn) && inv.llTurn !== S.turn; }
function llSpend(o) { const inv = invOf(o), mag = llMagOf(inv); if (inv.llLoad == null) inv.llLoad = Math.min(mag, inv.ll);
  inv.ll = Math.max(0, inv.ll - 1); inv.llLoad = Math.max(0, inv.llLoad - 1); inv.llTurn = S.turn;
  if (inv.llLoad <= 0 && inv.ll > 0) { inv.llLoad = Math.min(mag, inv.ll); inv.reloadT = S.phase === 'planning' ? S.turn : S.turn + 1; log(`${o.name}: reloading the ${mag === 1 ? 'single-shot' : '4-shot'} 40mm — takes a full turn.`, 'radio'); } }
function upgradeLL(o, fresh) { const inv = invOf(o); inv.llMag = LL19.multiMag; if (!fresh) inv.ll = Math.max(inv.ll, S.llRounds || ITEM_CFG.lesslethal.rounds); inv.llLoad = Math.min(LL19.multiMag, inv.ll); inv.reloadT = -1;
  let n = 0; while (n < CS40_CFG.issue && S.armory.cs40 > 0) { S.armory.cs40--; n++; } if (n) inv.vest.cs40 = (inv.vest.cs40 || 0) + n; }
function llKind(o) { const inv = invOf(o); return carries(o, 'lesslethal') ? (llMagOf(inv) === 1 ? 'single' : 'multi') : null; }
/* ---- loadout actions with the v19 rules, then the v8 base rules ---- */
function invAct19(offId, act, k) {
  const o = off(offId); if (!o || S.phase !== 'planning') return invActBase(offId, act, k);
  const inv = invOf(o), t = o.team ? unit(o.team) : null, done = () => { if (t) syncEquip(t); S.version++; return { ok: true }; };
  const atEq = () => { const [x, y] = offPos(o); return atEquipment(x, y); };
  if (act === 'return' && (inv.home || []).includes(k) && !(k === 'lesslethal' && llKind(o) === 'multi') && !(k === 'shield' && !carries(o, 'shield'))) {
    if (k !== 'lesslethal' && countOf(o, k) > ((inv.home || []).filter(x => x === k).length)) return invActBase(offId, act, k);
    if (atEq() && k !== 'lesslethal') { const i = inv.home.indexOf(k); inv.home.splice(i, 1); const r = invActBase(offId, act, k); if (!r.ok) inv.home.splice(i, 0, k); return r; } // v20: leave it at the vehicle (e.g. deploy a breacher with no ram)
    return { ok: false, reason: `${EQUIP[k] ? EQUIP[k].short : k}: can only be left at the equipment vehicle (primary staging)` }; }
  if (act === 'draw' && k === 'cs40') { if (llKind(o) !== 'multi') return { ok: false, reason: '40mm CS rounds deploy with the 4-shot 40mm launcher — draw the launcher first' }; }
  if (act === 'draw' && k === 'lesslethal' && llKind(o) === 'single') { if (!atEq()) return invActBase(offId, act, k); if (!(S.armory.lesslethal > 0)) return { ok: false, reason: 'No 4-shot launcher left at the equipment vehicle' };
    S.armory.lesslethal--; upgradeLL(o); return done(); }
  if (act === 'return' && k === 'lesslethal' && llKind(o) === 'multi' && (inv.home || []).includes('lesslethal')) { if (!atEq()) return invActBase(offId, act, k);
    S.armory.lesslethal++; S.armory.cs40 += inv.vest.cs40 || 0; inv.vest.cs40 = 0; inv.llMag = LL19.singleMag; inv.ll = S.llRounds || ITEM_CFG.lesslethal.rounds; inv.llLoad = 1; return done(); }
  if (act === 'draw' && k === 'gasbag') { const r = invActBase(offId, act, k); if (r.ok) { inv.packed.gas = (inv.packed.gas || 0) + GAS19.bag; if (t) syncEquip(t); } return r; }
  if (act === 'return' && k === 'gasbag') { const r = invActBase(offId, act, k); if (r.ok) { inv.packed.gas = Math.max(0, (inv.packed.gas || 0) - GAS19.bag); if (t) syncEquip(t); } return r; }
  const r = invActBase(offId, act, k);
  if (r.ok && k === 'lesslethal' && act === 'draw') upgradeLL(o, true);
  if (r.ok && k === 'lesslethal' && act === 'return') { S.armory.cs40 += inv.vest.cs40 || 0; inv.vest.cs40 = 0; }
  if (r.ok && t) syncEquip(t);
  return r; }
/** Equipment the officer's SECONDARY specialty would use (fetched by hand at the vehicle). */
const SPEC_KIT = { point: ['shield3', 'shield'], breacher: ['charge', 'ram', 'halligan'], ll: ['lesslethal', 'cs40'], gas: ['gasbag'], marksman: [], medic: ['medkit'], tech: ['drone', 'robot'], negotiator: ['tphone', 'bullhorn'] };
function fetchSecondary(offId) { const o = off(offId); if (!o || !o.spec2) return { ok: false, reason: 'No secondary specialty' };
  const got = []; let why = null;
  for (const k of SPEC_KIT[o.spec2] || []) { if (k === 'shield' && got.includes('shield3')) continue; if (k === 'cs40' && !got.includes('lesslethal') && llKind(o) !== 'multi') continue;
    const r = invAct(offId, 'draw', k); if (r.ok) got.push(k); else why = why || r.reason; if (k === 'cs40' && r.ok) break; }
  return got.length ? { ok: true, got } : { ok: false, reason: why || 'Nothing to fetch for that specialty' }; }
/** Issue-screen model for a team. */
function issueView(uid) { const t = unit(uid); if (!t || t.kind !== 'team') return null; const m = t.members.map(off);
  const atEq = atEquipment(t.x, t.y);
  return { team: t.uid, name: t.name, atEq, stage: atEq ? 'primary' : 'secondary', members: m.map(o => ({ id: o.id, name: o.name, spec: o.spec, spec2: o.spec2 || null, home: (invOf(o).home || []).slice(), armor: armorOf(o), helmet: helmetOf(o),
    ll: llKind(o), cs40: invOf(o).vest.cs40 || 0, kit2: (SPEC_KIT[o.spec2] || []).filter(k => (S.armory[k] || 0) > 0 && !carries(o, k)) })),
    pool: Object.keys(EQUIP).filter(k => k !== 'draco' && k !== 'scope' && (S.gearHave ? S.gearHave[k] || S.armory[k] > 0 : true)).map(k => ({ k, n: S.armory[k] })) }; }
/* ---- dual specialties: secondary specialty + v19 primary specialties (own rng: the map and roster draw stay identical) ---- */
const SPEC2_POOL = ['point', 'breacher', 'll', 'gas', 'medic', 'negotiator', 'tech', 'marksman'];
function setupSpecs19() { const q = makeRng((S.seed * 53 + S.officers.length * 11 + 19) >>> 0), O = S.opts || {};
  const roster = O.roster && O.roster.length ? O.roster : null;
  S.officers.forEach((o, i) => { const ro = roster ? roster[i] : null; if (ro && ro.spec2) o.spec2 = ro.spec2; });
  const nth = (sp, n) => S.officers.filter(o => o.spec === sp)[n];
  if (!roster || !roster.some(r => r.spec2)) {
    if (S.officers.length >= 10) { const b = nth('breacher', 1); if (b) { b.spec = 'll'; b.spec2 = 'breacher'; } const p = nth('point', 1) || nth('negotiator', 1); if (p) { p.spec2 = p.spec; p.spec = 'gas'; } }
    for (const o of q.shuffle(S.officers.slice())) { if (o.spec2 || o.spec === 'leader' || o.spec === 'k9' || !q.chance(0.35)) continue; const c = SPEC2_POOL.filter(s => s !== o.spec); o.spec2 = q.pick(c); } }
  S.officers.forEach(o => { if (o.spec === 'driver') { o.spec = o.spec2 && o.spec2 !== 'driver' ? o.spec2 : 'point'; o.spec2 = null; } if (o.spec2 === 'driver') o.spec2 = null; }); // v20: the BearCat has its own driver — never on the roster
  S.officers.forEach(o => { if ((o.spec === 'll' || o.spec2 === 'll') && !o.quals.includes('ll')) o.quals.push('ll'); });
  S.gearHave = {}; for (const k in S.armory) S.gearHave[k] = S.armory[k] > 0;
  S.gearHave.sniper = true; S.gearHave.scope = true;
  S.officers.forEach(o => { o.inv = null; invOf(o); }); } // personal kit is with every officer from the call-out
/** Gas-canister throw accuracy (own rng stream). Returns the amount deployed into the room. */
function gasThrowAmt(o) { if (!S.r19) S.r19 = makeRng((S.seed * 6113 + 3) >>> 0);
  const mul = o && carries(o, 'gasbag') ? specMul(o, 'gas') : 0, miss = GAS19.miss * (1 - GAS19.specCut * mul);
  return S.r19() < miss ? GAS19.missAmt : 1.1; }
function helmetStops(o, cal) { const h = helmetOf(o); if (!h) return false; if (!S.rH) S.rH = makeRng((S.seed * 4441 + 7) >>> 0);
  return S.rH() < HELMET_CFG.head && S.rH() < (HELMETS[h].stops[cal] || 0); }
/** 40mm CS: adds about a quarter of a canister to the room (several rounds stack up to a full canister). */
function gasAdd(roomId, amt) { const q = S.rooms[roomId]; let s = 0, n = 0;
  for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) { const c = idx(x, y); if (S.room[c] === roomId) { S.gas[c] = Math.min(1.1, S.gas[c] + amt); S.gasSeen[c] = S.gas[c]; s += S.gas[c]; n++; } }
  q.gas = n ? s / n : amt; S.gasActive = true; S.gasEver = true; }
