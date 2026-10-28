
/* =====================================================================
   SNIPER OVERWATCH
   Perches are pre-computed per neighbor house: the edge cell of the house
   body (upper window on 2-storey houses, roof line on 1-storey) with the
   most clear sight lines to the target house's windows/doors. A sniper
   team walks to the perch's entry cell (lowest-exposure side), takes one
   tick to get inside and set up, then sits in hard cover/concealment.
   Yard vantage points (any outdoor cell with a sight line) also work.
   ===================================================================== */
function compass(dx, dy) { const a = Math.atan2(dy, dx) * 180 / Math.PI; const n = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']; return n[((Math.round(a / 45) % 8) + 8) % 8]; }
function genPerches() {
  S.perches = []; const [hx, hy] = houseCenter(); const R = WEAPONS.sniper.range;
  const tp = threatPoints();
  S.ext.nb.forEach((nb, i) => {
    const body = nb.parts.filter(q => q !== nb.garage), inBody = (x, y) => body.some(q => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
    let best = null, bs = 0;
    for (const q of body) for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) {
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inBody(x + dx, y + dy))) continue;
      let s = 0; for (const t of tp) { const d = dist(x, y, t.x, t.y); if (d <= R && d >= 8 && los(x, y, t.x, t.y)) s += 1 - d / (R * 1.5); }
      if (s > bs) { bs = s; best = [x, y]; } }
    if (!best) return;
    // entry: an outdoor cell beside the house body, preferring low exposure and short walk
    let entry = null, es = 1e9;
    for (const q of body) for (let y = q.y - 1; y <= q.y + q.h; y++) for (let x = q.x - 1; x <= q.x + q.w; x++) {
      if (inBody(x, y) || !cellOk(x, y, { outdoor: true }) || S.dyn[idx(x, y)]) continue;
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inBody(x + dx, y + dy))) continue;
      const s = expoAt(x, y) * 4 + dist(x, y, best[0], best[1]) * 0.15; if (s < es) { es = s; entry = [x, y]; } }
    if (!entry) return;
    const cx = body[0].x + body[0].w / 2, cy = body[0].y + body[0].h / 2;
    const where = (nb.north === (hy < S.geo.ST)) ? '' : ' across the street';
    S.perches.push({ id: S.perches.length, nb: i, x: best[0], y: best[1], entry, kind: nb.storeys === 2 ? 'upper-floor window' : 'rooftop', sightLines: Math.round(bs * 10) / 10,
      name: `Neighbor house ${compass(cx - hx, cy - hy)}${where}` });
  });
}
function perchAt(x, y) { return S.perches.find(p => { const nb = S.ext.nb[p.nb]; return nb.parts.some(q => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h); }) || null; }
/** The sniper's spotter (best available team-mate) and its bonus. */
function spotterOf(u) {
  if (!u || u.kind !== 'team' || !hasSpec(u, 'marksman')) return null;
  const ok = teamOk(u), shooter = ok.find(o => o.spec === 'marksman'), others = ok.filter(o => o !== shooter);
  const q = others.find(o => o.quals && o.quals.includes('spotter'));
  if (q) return { o: q, name: q.name, q: true, mult: 1.45, label: 'qualified Sniper Spotter' };
  if (others.length) return { o: others[0], name: others[0].name, q: false, mult: 1.2, label: 'untrained spotter' };
  return null;
}
function overwatchSees(x, y) { let n = 0; for (const t of threatPoints()) { const d = dist(x, y, t.x, t.y); if (d <= WEAPONS.sniper.range && los(x, y, t.x, t.y)) n++; } return n; }
function owCone(u) { if (!u.perch) return null; const vp = visParams(u); return { x: u.x, y: u.y, dir: u.dir, half: vp.half, range: vp.range }; }
