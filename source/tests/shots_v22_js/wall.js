(u) => { const C = GAME.Core, S = C.state, t = C.unit(u);
  for (let y = 1; y < C.MAP_H - 1; y++) for (let x = 1; x < C.MAP_W - 1; x++) { const r = C.roomAt(x, y); if (r < 0 || S.block[C.idx(x, y)]) continue;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const nx = x + dx, ny = y + dy, r2 = C.roomAt(nx, ny);
      if (r2 >= 0 && r2 !== r && C.edge(x, y, nx, ny).t === 'X' && !S.block[C.idx(nx, ny)]) { t.deployed = true; t.x = x; t.y = y;
        if (C.wallSpotsFor(u).length >= 2) { GAME.select(u); S.version++; GAME.refresh(true); return [x, y, C.wallSpotsFor(u).length]; } } } } return null; }
