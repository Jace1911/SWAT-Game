() => { const C = GAME.Core, S = C.state; const g = S.rooms.find(r => r.type === 'garage');
  if (g) for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) { const i = C.idx(x, y); S.vis[i] = 1; if (S.seen) S.seen[i] = 1; if (S.explored) S.explored[i] = 1; }
  S.version++; GAME.refresh(true); return C.suspectCars().map(c => c.where); }
