() => { const C = GAME.Core, S = C.state, R = GAME.Render; const u = S.units.find(q => q.kind === 'patrol' && !q.inCar && q.status === 'ok'); if (!u) return 'no patrol';
  GAME.select(u.uid); GAME.action('move'); const free = (x, y) => C.roomAt(x, y) < 0 && !S.block[C.idx(x, y)]; const dir = u.x < C.MAP_W / 2 ? 1 : -1;
  const pts = [4, 8, 12].map(d => { for (let k = 0; k < 6; k++) for (const yy of [u.y + k, u.y - k]) if (free(u.x + dir * d, yy)) return [u.x + dir * d, yy]; return null; }).filter(Boolean);
  R.centerOn ? R.centerOn(u.x + dir * 6, u.y) : 0; GAME.refresh(true);
  const tap = ([x, y]) => { const [sx, sy] = R.toScreen(x + 0.5, y + 0.5); GAME.action('move'); GAME.mapTap(sx, sy); };
  pts.forEach(tap); S.version++; GAME.refresh(true); const pi = C.pathInfo(u.uid); return { uid: u.uid, n: u.orders.length, legs: pts.length, info: pi && pi.text }; }
