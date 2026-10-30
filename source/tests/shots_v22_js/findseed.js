([struct, want]) => { for (let s = 100; s < 400; s++) { GAME.newGame(s, false, null, 'barricade', struct); const S = GAME.Core.state;
    const ok = want === 'rot' ? S.house.rot : GAME.Core.suspectCars().some(c => c.where === 'garage') && GAME.Core.suspectCars().some(c => c.where === 'driveway');
    if (ok) { GAME.closeModal(); GAME.Render.fit('house'); S.version++; GAME.refresh(true); return s; } } return null; }
