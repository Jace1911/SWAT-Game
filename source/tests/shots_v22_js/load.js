() => { const S = GAME.Core.state; const o = S.officers.find(o => o.inv && o.inv.rifleLeft && !o.team) || S.officers.find(o => o.inv && o.inv.rifleLeft); GAME.openLoad(o.id); }
