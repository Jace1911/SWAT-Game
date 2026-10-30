() => { const C = GAME.Core, S = C.state; C.behLearn(S.suspect, 'interview'); GAME.action('intel'); const rows = C.behInfo(); return rows.map(r => r.label + ' · ' + r.src); }
