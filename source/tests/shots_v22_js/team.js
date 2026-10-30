() => { const C = GAME.Core, S = C.state; S.officers.forEach(o => { o.status = 'staged'; o.eta = 0; o.stage = 'primary'; });
  const ids = []; for (const sp of ['point', 'breacher', 'k9', 'll']) { const o = S.officers.find(x => x.spec === sp && !ids.includes(x.id) && !x.team); if (o) ids.push(o.id); }
  const r = C.formTeam(ids, { point: ids[0] }); const b = S.officers.find(o => o.id === ids[1]); S.armory.charge = Math.max(S.armory.charge || 0, 4);
  for (let i = 0; i < 3; i++) C.invAct(b.id, 'draw', 'charge'); C.syncEquip(r.team); return r.team.uid; }
