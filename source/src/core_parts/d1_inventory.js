/* ===================== v8 INDIVIDUAL OFFICER INVENTORIES =====================
   Each officer carries o.inv = { hands:[L,R], holster:[...], slung:[...], packed:{k:n}, vest:{k:n}, nr:{k:turn}, ll:rounds }.
   Everyone has a holstered handgun + taser. Team-level u.equip is an AGGREGATE rebuilt by syncEquip()
   (only what is usable), so the breach / gas / nego / medical / robot rules keep reading counts;
   consumption goes through useItem(). Holster / sling / switch costs no time, but the weapon is
   NOT READY for one full turn (no return fire, no attacks with it). */
const ITEM_CFG = {
  pistol:     { hands: 1, stow: 'holster', weapon: true },
  taser:      { hands: 1, stow: 'holster', weapon: false },
  rifle:      { hands: 2, oneHand: true, oneHandMul: 0.6, stow: 'slung', weapon: true },
  sniper:     { hands: 2, stow: 'slung', weapon: true },
  lesslethal: { hands: 2, stow: 'slung', qual: 'll', rounds: 4 },
  shield:     { hands: 1, stow: null },              // cannot be slung or packed: always one hand
  shield3:    { hands: 1, stow: null },              // Level III shield: same handling, heavier rating
  plate:      { where: 'worn' },                     // plate carrier: worn armor slot (inv.worn.armor = 'plate')
  draco:      { where: 'vehicle' },                  // BearCat kit: never carried, installed from the pool
  ram:        { hands: 1, useHands: 2, stow: null }, // carried one-handed; breach = both hands (pistol auto-holstered)
  halligan:   { hands: 1, stow: 'packed' },
  polecam:    { hands: 1, stow: 'packed' },
  bullhorn:   { hands: 1, stow: 'packed' },
  charge:     { where: 'vest', needFree: 1, drawTicks: 2 }, // drawing off the vest takes time; hanging needs a free hand
  bang:       { where: 'packed', throwHands: 2 },
  gas:        { where: 'packed', throwHands: 2 },
  medkit:     { where: 'packed', useHands: 2 },
  tphone:     { where: 'packed' },
  drone:      { where: 'packed', spec: 'tech' },
  robot:      { where: 'packed', spec: 'tech' },
  mask:       { where: 'worn', donTurns: 1 },
};
const PERSONAL = ['pistol', 'taser', 'rifle', 'sniper', 'mask']; // issued, not drawn from the equipment pool
const INV_CFG = { notReadyTurns: 1, drawRange: 4.5 };
function newInv(o) { const prim = o.spec === 'marksman' ? 'sniper' : 'rifle';
  const inv = { hands: [prim, prim], holster: ['pistol', 'taser'], slung: [], packed: {}, vest: {}, worn: { mask: false }, mask: 'packed', nr: {}, ll: 0, prim }; takeHome(o, inv); return inv; }
function invOf(o) { if (!o.inv) o.inv = newInv(o); return o.inv; }
function setNotReady(o, k) { const inv = invOf(o); inv.nr[k] = S.phase === 'planning' ? S.turn : S.turn + 1; }
function isReady(o, k) { const inv = invOf(o); return !(inv.nr[k] != null && inv.nr[k] >= S.turn); }
function heldList(o) { const h = invOf(o).hands; return h[0] && h[0] === h[1] ? [h[0]] : h.filter(Boolean); }
function freeHands(o) { return invOf(o).hands.filter(x => !x).length; }
function holds(o, k) { return invOf(o).hands.includes(k); }
function twoHanded(o, k) { const h = invOf(o).hands; return h[0] === k && h[1] === k; }
function carries(o, k) { const inv = invOf(o); return holds(o, k) || inv.slung.includes(k) || inv.holster.includes(k) || (inv.packed[k] || 0) > 0 || (inv.vest[k] || 0) > 0; }
function countOf(o, k) { const inv = invOf(o); return (k === 'plate' && inv.worn.armor === 'plate' ? 1 : 0) + (holds(o, k) ? 1 : 0) + inv.slung.filter(x => x === k).length + (inv.packed[k] || 0) + (inv.vest[k] || 0); }
/** Items an officer can use right now (aggregated into the team's equip). */
function usableCount(o, k) { const c = ITEM_CFG[k] || {};
  if (k === 'lesslethal') return holds(o, 'lesslethal') && (o.quals || []).includes('ll') && invOf(o).ll > 0 && isReady(o, 'lesslethal') && llOk(o) ? 1 : 0;
  if (k === 'cs40') return holds(o, 'lesslethal') && llMagOf(invOf(o)) >= 4 && isReady(o, 'lesslethal') && llOk(o) ? (invOf(o).vest.cs40 || 0) : 0;
  if (c.spec && !isSpec(o, c.spec)) return 0;
  return countOf(o, k); }
function syncEquip(t) { if (!t || t.kind !== 'team') return; const e = {}; for (const k in EQUIP) e[k] = 0;
  for (const o of teamOk(t)) for (const k in EQUIP) e[k] += usableCount(o, k);
  t.equip = e; }
function syncAll() { for (const u of S.units) if (u.kind === 'team') syncEquip(u); }
/** Remove one item from whoever on the team carries it (packed/vest first, then hands). Returns the officer. */
function useItem(t, k, pref) { const m = teamOk(t).filter(o => countOf(o, k) > 0 && (k !== 'lesslethal' || usableCount(o, k)));
  const o = (pref && m.find(pref)) || m.find(q => (invOf(q).packed[k] || 0) > 0 || (invOf(q).vest[k] || 0) > 0) || m[0]; if (!o) return null;
  const inv = invOf(o); if (k === 'lesslethal') { llSpend(o); syncEquip(t); return o; }
  if ((inv.vest[k] || 0) > 0) inv.vest[k]--; else if ((inv.packed[k] || 0) > 0) inv.packed[k]--; else if (holds(o, k)) inv.hands = inv.hands.map(x => x === k ? null : x); else { const i = inv.slung.indexOf(k); if (i >= 0) inv.slung.splice(i, 1); }
  syncEquip(t); return o; }
/** Stow whatever is in the hands except `keep` (auto-holster / auto-sling); returns the weapons stowed, to be redrawn. */
function autoStow(o, keep) { const inv = invOf(o), out = [];
  for (const k of heldList(o)) { if (k === keep) continue; const c = ITEM_CFG[k] || {}; if (!c.stow) continue;
    if (c.stow === 'holster') inv.holster.push(k); else if (c.stow === 'slung') inv.slung.push(k); else inv.packed[k] = (inv.packed[k] || 0) + 1;
    inv.hands = inv.hands.map(x => x === k ? null : x); out.push(k); }
  return out; }
/** Redraw after an auto-holster: weapon comes back to hand but is NOT READY for a full turn. */
function autoRedraw(o, list) { for (const k of list || []) { if (!stowedHas(o, k)) continue; const c = ITEM_CFG[k]; const need = c.hands === 2 && !c.oneHand ? 2 : c.hands === 2 && freeHands(o) >= 2 ? 2 : 1; if (freeHands(o) < need) continue; takeFromStow(o, k); putInHands(o, k, need); setNotReady(o, k); } }
function stowOne(o, k) { const inv = invOf(o), c = ITEM_CFG[k]; if (c.stow === 'holster') inv.holster.push(k); else if (c.stow === 'slung') inv.slung.push(k); else inv.packed[k] = (inv.packed[k] || 0) + 1; inv.hands = inv.hands.map(x => x === k ? null : x); }
function stowedHas(o, k) { const inv = invOf(o); return inv.holster.includes(k) || inv.slung.includes(k) || (inv.packed[k] || 0) > 0; }
function takeFromStow(o, k) { const inv = invOf(o); let i = inv.holster.indexOf(k); if (i >= 0) { inv.holster.splice(i, 1); return; } i = inv.slung.indexOf(k); if (i >= 0) { inv.slung.splice(i, 1); return; } if ((inv.packed[k] || 0) > 0) inv.packed[k]--; }
function putInHands(o, k, n) { const inv = invOf(o); if (n >= 2) { inv.hands = [k, k]; return; } const i = inv.hands.indexOf(null); inv.hands[i] = k; }
/** Hands an officer could free for a task (a shield or the ram cannot be put away in the stack). */
/** Can this officer put both hands on the ram (other hand free or holding something that auto-holsters)? */
function ramReady(o) { return holds(o, 'ram') && invOf(o).hands.filter(x => x !== 'ram').every(x => !x || (ITEM_CFG[x] || {}).stow); }
function freeable(o) { return invOf(o).hands.filter(x => !x || (ITEM_CFG[x] || {}).stow).length; }
/** Best member to do a two-handed task with item k (throw / treat). */
function taskMember(t, k, hands) { const m = teamOk(t).filter(o => (!k || countOf(o, k) > 0) && freeable(o) >= hands && (!ITEM_CFG[k] || !ITEM_CFG[k].spec || isSpec(o, ITEM_CFG[k].spec)));
  return m.sort((a, b) => freeHands(b) - freeHands(a) || (a === teamOk(t)[0]) - (b === teamOk(t)[0]))[0] || null; }
/** Perform a hands task: auto-stow, act, auto-redraw (weapons NOT READY for a turn). */
function handsTask(t, k, hands, fn) { const o = taskMember(t, k, hands); if (!o) return null; const st = autoStow(o, hands >= 2 ? null : k); const r = fn(o); autoRedraw(o, st); syncEquip(t); return { o, r, stowed: st }; }
/** Hands task by a specific officer (e.g. the medic). */
function withHands(t, o, hands, fn) { if (!o || freeable(o) < hands) return null; const st = autoStow(o, null); const r = fn(o); autoRedraw(o, st); syncEquip(t); return { o, r, stowed: st }; }
/** Team's best READY weapon in hand (return fire / attacks). null = nobody can shoot this turn. */
function teamWeapon(t) { const m = teamOk(t); let best = null, one = false;
  const rank = { sniper: 3, rifle: 2, pistol: 1 };
  for (const o of m) for (const k of heldList(o)) { if (!rank[k] || !isReady(o, k)) continue; const oh = k === 'rifle' && !twoHanded(o, k); if (k === 'sniper' && !twoHanded(o, k)) continue;
    const sc = rank[k] - (oh ? 0.5 : 0); if (!best || sc > best.sc) { best = { k, sc, oh, o }; } }
  return best; }
function invView(o) { const inv = invOf(o); const h = inv.hands; return { hands: h.slice(), two: !!(h[0] && h[0] === h[1]), holster: inv.holster.slice(), slung: inv.slung.slice(), packed: Object.assign({}, inv.packed), vest: Object.assign({}, inv.vest), ll: inv.ll, mask: inv.mask,
  notReady: Object.keys(inv.nr).filter(k => !isReady(o, k)), free: freeHands(o) }; }
function atEquipment(x, y) { return dist(x, y, S.ext.staging.x, S.ext.staging.y) <= INV_CFG.drawRange; }
function offPos(o) { const t = o.team ? unit(o.team) : null; if (t) return [t.x, t.y]; const st = o.stage === 'secondary' && S.ext.staging2 ? S.ext.staging2 : S.ext.staging; return [st.x, st.y]; }
/* ---- player loadout actions (planning phase). None costs a turn; weapons changed are NOT READY for a turn. ---- */
function invActBase(offId, act, k) {
  if (S.phase !== 'planning') return { ok: false, reason: 'Change loadout during planning' };
  const o = off(offId); if (!o || o.status === 'enroute' || o.status === 'down') return { ok: false, reason: 'Officer unavailable' };
  const inv = invOf(o), c = ITEM_CFG[k] || {}, t = o.team ? unit(o.team) : null; if (t && t.inCar) return { ok: false, reason: 'Get out of the vehicle first' };
  const done = r => { if (t) syncEquip(t); S.version++; return Object.assign({ ok: true }, r || {}); };
  if (act === 'stow') { if (!holds(o, k)) return { ok: false, reason: 'Not in hand' }; if (!c.stow) return { ok: false, reason: k === 'shield' || k === 'shield3' ? 'A shield cannot be slung or packed — it stays in one hand (hand it back at the equipment vehicle)' : `The ${EQUIP[k] ? EQUIP[k].short : k} cannot be stowed — hand it back at the equipment vehicle` };
    stowOne(o, k); setNotReady(o, k); return done({ notReady: k }); }
  if ((act === 'switch' || act === 'hold') && holds(o, k)) return { ok: false, reason: 'Already in hand' };
  if (act === 'switch') { const need = c.hands === 2 && !c.oneHand ? 2 : c.hands || 1;
    for (const h of heldList(o).slice().reverse()) { if (freeHands(o) >= need) break; if (h === k || !(ITEM_CFG[h] || {}).stow) continue; stowOne(o, h); setNotReady(o, h); }
    if (freeHands(o) < need) return { ok: false, reason: 'Hands are full with items that cannot be put away here' }; act = 'hold'; }
  if (act === 'hold') { if (holds(o, k)) return { ok: false, reason: 'Already in hand' }; if (!stowedHas(o, k)) return { ok: false, reason: 'Not carried' };
    if (c.qual && !(o.quals || []).includes(c.qual)) return { ok: false, reason: 'Only a less-lethal specialist may use the 40mm launcher' };
    const need = c.hands === 2 && !c.oneHand ? 2 : c.hands || 1; if (freeHands(o) < need) return { ok: false, reason: `Needs ${need} free hand${need > 1 ? 's' : ''} — stow something first` };
    takeFromStow(o, k); putInHands(o, k, c.hands === 2 && freeHands(o) >= 2 ? 2 : need); setNotReady(o, k); return done({ notReady: k }); }
  if (act === 'grip') { if (k !== 'rifle' || !holds(o, 'rifle')) return { ok: false, reason: 'Only a rifle changes grip' };
    if (twoHanded(o, 'rifle')) inv.hands = ['rifle', null]; else { if (freeHands(o) < 1) return { ok: false, reason: 'Other hand is busy' }; inv.hands = ['rifle', 'rifle']; } return done(); }
  if (act === 'draw' || act === 'return') { const [x, y] = offPos(o); if (!atEquipment(x, y)) return { ok: false, reason: 'Equipment is drawn at the equipment vehicle (primary staging) — move there first' };
    if (!EQUIP[k]) return { ok: false, reason: 'Unknown item' };
    if (k === 'draco') return { ok: false, reason: 'The Draco arm kit is installed on the BearCat — order a team at the vehicle to Install Draco Arm' };
    if (act === 'return') { if (!countOf(o, k)) return { ok: false, reason: 'Not carried' }; const inv2 = inv; if (k === 'plate') inv2.worn.armor = 'soft'; else if ((inv2.vest[k] || 0) > 0) inv2.vest[k]--; else if ((inv2.packed[k] || 0) > 0) inv2.packed[k]--; else if (holds(o, k)) inv2.hands = inv2.hands.map(q => q === k ? null : q); else inv2.slung.splice(inv2.slung.indexOf(k), 1);
      S.armory[k]++; if (k === 'lesslethal') inv.ll = 0; return done(); }
    if (!(S.armory[k] > 0)) return { ok: false, reason: 'None left at the equipment vehicle' };
    if (c.qual && !(o.quals || []).includes(c.qual)) return { ok: false, reason: 'Less-lethal launcher: specialist only' };
    if (c.spec && !isSpec(o, c.spec)) return { ok: false, reason: `${EQUIP[k].short}: ${SPECS[c.spec].name} only` };
    if (k === 'plate') { if (inv.worn.armor === 'plate') return { ok: false, reason: 'Already wearing rifle plates' }; inv.worn.armor = 'plate'; }
    else if (c.where === 'vest') inv.vest[k] = (inv.vest[k] || 0) + 1;
    else if (c.where === 'packed') inv.packed[k] = (inv.packed[k] || 0) + 1;
    else { const need = c.hands === 2 ? 2 : 1; if (freeHands(o) < need) { if (c.stow) { if (c.stow === 'slung') inv.slung.push(k); else inv.packed[k] = (inv.packed[k] || 0) + 1; } else return { ok: false, reason: `${EQUIP[k].short} needs ${need} free hand${need > 1 ? 's' : ''} (it cannot be slung or packed) — stow something first` }; }
      else putInHands(o, k, need); if (c.hands) setNotReady(o, k); }
    S.armory[k]--; if (k === 'lesslethal') inv.ll = S.llRounds || ITEM_CFG.lesslethal.rounds; return done(); }
  return { ok: false, reason: 'Unknown action' };
}
/** Default kit for a team formed at the equipment vehicle (from the pool, limited by team level). */
function defaultKit(t) { const m = teamOk(t), take = k => { if (S.armory[k] > 0) { S.armory[k]--; return true; } return false; };
  const by = sp => m.filter(o => o.spec === sp); // primary specialty only: secondary-specialty kit is fetched by hand
  const pt = m[0], dfn = m[1];
  for (const o of m) if (armorOf(o) !== 'plate' && take('plate')) invOf(o).worn.armor = 'plate'; // individually issued rifle plates while the pool lasts
  const sk = S.armory.shield3 > 0 ? 'shield3' : 'shield';
  if (pt && holds(pt, 'shield') && S.armory.shield3 > 0) { S.armory.shield3--; invOf(pt).hands = invOf(pt).hands.map(x => x === 'shield' ? 'shield3' : x); } // v19: III shield from the vehicle replaces the take-home IIIA
  else if (pt && pt.spec !== 'll' && !shieldOf(pt) && !holds(pt, 'ram') && take(sk)) { const inv = invOf(pt); inv.slung.push(inv.prim); inv.hands = [sk, 'pistol']; inv.holster = inv.holster.filter(k => k !== 'pistol'); }
  const br = by('breacher'), brx = br.filter(o => o !== pt); const hasRam = m.some(o => holds(o, 'ram')); const ramMan = hasRam ? m.find(o => holds(o, 'ram')) : brx.find(o => !shieldOf(o)) || m.find(o => o !== pt && o !== dfn && o.spec !== 'marksman' && !shieldOf(o)) || null;
  if (ramMan && !hasRam && take('ram')) { const inv = invOf(ramMan); inv.slung.push(inv.prim); inv.hands = ['ram', 'pistol']; inv.holster = inv.holster.filter(k => k !== 'pistol'); }
  const hal = brx[1] || m.find(o => o !== pt && o !== ramMan && o !== dfn && o.spec !== 'marksman'); if (hal && !m.some(o => carries(o, 'halligan')) && take('halligan')) invOf(hal).packed.halligan = 1;
  for (const b of br) for (let i = 0; i < 2; i++) if (take('charge')) invOf(b).vest.charge = (invOf(b).vest.charge || 0) + 1;
  const fixedH = o => shieldOf(o) || holds(o, 'ram'); const free = m.filter(o => o !== pt && !fixedH(o)), throwers = free.length ? free : m.filter(o => o !== pt).concat(pt ? [pt] : []); let ti = 0; // v19: free-handed officers carry the bangs (take-home shields / rams stay in hand)
  for (const k of ['bang', 'bang', 'gas']) { const o = throwers[ti++ % Math.max(1, throwers.length)]; if (o && take(k)) invOf(o).packed[k] = (invOf(o).packed[k] || 0) + 1; }
  for (const o of by('tech')) { if (take('drone')) invOf(o).packed.drone = 1; if (take('robot')) invOf(o).packed.robot = 1; }
  for (const o of by('medic')) if (!carries(o, 'medkit') && take('medkit')) invOf(o).packed.medkit = 1;
  const ll1 = m.find(o => carries(o, 'lesslethal') && llMagOf(invOf(o)) === 1);
  if (ll1) { if (S.armory.lesslethal > 0) { S.armory.lesslethal--; upgradeLL(ll1); } }
  else { const llo = m.find(o => (o.quals || []).includes('ll') && o.spec !== 'marksman' && o !== pt && o !== ramMan && !shieldOf(o) && !holds(o, 'ram')) || by('marksman').find(o => (o.quals || []).includes('ll'));
  if (llo && take('lesslethal')) { const inv = invOf(llo); if (llo.spec === 'marksman') inv.slung.push('lesslethal'); else { if (!inv.slung.includes(inv.prim)) inv.slung.push(inv.prim); inv.hands = ['lesslethal', 'lesslethal']; } inv.ll = S.llRounds || ITEM_CFG.lesslethal.rounds; upgradeLL(llo, true); } }
  for (const o of by('gas')) if (!carries(o, 'gasbag') && take('gasbag')) { invOf(o).packed.gasbag = 1; invOf(o).packed.gas = (invOf(o).packed.gas || 0) + GAS19.bag; }
  for (const o of by('negotiator')) { if (take('tphone')) invOf(o).packed.tphone = 1; if (take('bullhorn')) invOf(o).packed.bullhorn = 1; }
  const ld = by('leader')[0]; if (ld && !m.some(o => carries(o, 'bullhorn')) && take('bullhorn')) invOf(ld).packed.bullhorn = 1;
  syncEquip(t); }
