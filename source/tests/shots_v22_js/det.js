() => { const S = GAME.Core.state; S.rng.chance = () => true; const g = document.getElementById('det-go'); if (g) g.click(); return [(S.ports || []).length, S.doors.filter(d => d.hole).length]; }
