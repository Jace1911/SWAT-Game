
/* ---------- furniture (blocks movement, not sight) ---------- */
function genFurniture(r) {
  S.furn = [];
  const reserved = new Set();
  const markRes = (x, y) => reserved.add(idx(x, y));
  for (const [k, e] of S.edges) { if (e.t !== 'O' && e.t !== 'D') continue;
    const [t, a, b] = k.split(','); const A = +a, B = +b;
    const pair = t === 'h' ? [[A, B - 1], [A, B]] : [[A - 1, B], [A, B]];
    for (const [x, y] of pair) if (roomAt(x, y) >= 0) { markRes(x, y); const o = pair[0] === pair.find(p => p[0] === x && p[1] === y) ? pair[1] : pair[0];
      const ix = x + (x - o[0]), iy = y + (y - o[1]); if (roomAt(ix, iy) === roomAt(x, y)) markRes(ix, iy); } }
  const connected = rm => { const cells = []; for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) if (!S.block[idx(x, y)]) cells.push(idx(x, y));
    if (!cells.length) return false; const seen = new Set([cells[0]]), st = [cells[0]];
    while (st.length) { const c = st.pop(), x = c % MAP_W, y = (c / MAP_W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, n = idx(nx, ny);
      if (roomAt(nx, ny) === rm.id && !S.block[n] && !seen.has(n)) { seen.add(n); st.push(n); } } }
    return seen.size === cells.length; };
  const tryPlace = (rm, kind, x, y, w, h, side, block = true) => {
    if (x < rm.x || y < rm.y || x + w > rm.x + rm.w || y + h > rm.y + rm.h) return null;
    const cs = []; for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const c = idx(xx, yy); if (S.block[c] || reserved.has(c)) return null; cs.push(c); }
    if (block) { cs.forEach(c => S.block[c] = 1); if (!connected(rm)) { cs.forEach(c => S.block[c] = 0); return null; } }
    const f = { kind, x, y, w, h, side, room: rm.id }; S.furn.push(f); return f;
  };
  const wall = (rm, kind, len, depth, sides, tries = 14) => {
    for (let t = 0; t < tries; t++) { const side = r.pick(sides); const ns = side === 'n' || side === 's'; const w = ns ? len : depth, h = ns ? depth : len;
      if (w > rm.w || h > rm.h) continue;
      const x = side === 'w' ? rm.x : side === 'e' ? rm.x + rm.w - w : r.int(rm.x, rm.x + rm.w - w);
      const y = side === 'n' ? rm.y : side === 's' ? rm.y + rm.h - h : r.int(rm.y, rm.y + rm.h - h);
      const f = tryPlace(rm, kind, x, y, w, h, side); if (f) return f; }
    return null;
  };
  const center = (rm, kind, w, h, block = true) => { for (let t = 0; t < 8; t++) { const x = rm.x + Math.floor((rm.w - w) / 2) + r.int(-1, 1), y = rm.y + Math.floor((rm.h - h) / 2) + r.int(-1, 1);
    if (x <= rm.x || y <= rm.y || x + w >= rm.x + rm.w || y + h >= rm.y + rm.h) continue; const f = tryPlace(rm, kind, x, y, w, h, 'c', block); if (f) return f; } return null; };
  const corner = (rm, kind) => { for (const [x, y] of r.shuffle([[rm.x, rm.y], [rm.x + rm.w - 1, rm.y], [rm.x, rm.y + rm.h - 1], [rm.x + rm.w - 1, rm.y + rm.h - 1]])) { const f = tryPlace(rm, kind, x, y, 1, 1, 'c'); if (f) return f; } return null; };
  const ALL = ['n', 's', 'e', 'w'];
  for (const rm of S.rooms) {
    switch (rm.type) {
      case 'living': { const s = wall(rm, 'sofa', 3, 1, ALL); const opp = s ? { n: 's', s: 'n', e: 'w', w: 'e' }[s.side] : 'n'; wall(rm, 'tv', 2, 1, [opp]) || wall(rm, 'tv', 2, 1, ALL);
        if (rm.w >= 6 && rm.h >= 5) { center(rm, 'rug', 3, 2, false); center(rm, 'coffee', 2, 1); } wall(rm, 'armchair', 1, 1, ALL); corner(rm, 'plant'); break; }
      case 'kitchen': wall(rm, 'counter', Math.min(rm.w - 1, 5), 1, ['n']) || wall(rm, 'counter', Math.min(rm.w - 1, 4), 1, ALL); wall(rm, 'fridge', 1, 1, ['e', 'w', 'n']);
        if (rm.w >= 6 && rm.h >= 5) center(rm, 'island', 2, 1); break;
      case 'dining': center(rm, 'table', rm.w >= 6 ? 3 : 2, 2) || center(rm, 'table', 2, 1); wall(rm, 'sideboard', 2, 1, ALL); corner(rm, 'plant'); break;
      case 'bed': { const big = rm.w >= 5 && rm.h >= 5; wall(rm, 'bed', big ? 3 : 2, 3, ALL, 20) || wall(rm, 'bed', 2, 2, ALL); wall(rm, 'dresser', 2, 1, ALL); wall(rm, 'nightstand', 1, 1, ALL); break; }
      case 'bath': wall(rm, 'tub', Math.min(3, Math.max(rm.w, rm.h) - 1), 1, ALL); wall(rm, 'toilet', 1, 1, ALL); wall(rm, 'vanity', 1, 1, ALL); break;
      case 'office': wall(rm, 'desk', 2, 1, ALL); wall(rm, 'shelves', 2, 1, ALL); corner(rm, 'plant'); break;
      case 'garage': { const f = tryPlace(rm, 'car', rm.x + 1 + r.int(0, Math.max(0, rm.w - 5)), rm.y + rm.h - 5, 2, 4, 's') || tryPlace(rm, 'car', rm.x + 2, rm.y + rm.h - 5, 2, 4, 's');
        wall(rm, 'workbench', 3, 1, ['n']); wall(rm, 'shelves', 2, 1, ['e', 'w']); break; }
    }
  }
}
