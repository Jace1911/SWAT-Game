import json, sys
from playwright.sync_api import sync_playwright
URL='http://127.0.0.1:8765/index.html'
errs=[]; out={}
SETUP = """(lvl) => { const C = GAME.Core; for (let s = 31; s < 200; s++) { GAME.newGame(s, false, lvl, 'barricade', 'trailer'); const S = C.state; if (!S.eqVeh.here && (S.bcPend || []).length === 2) return { seed: s, eq: S.eqVeh, bc: S.bcPend.map(p => [p.unit, p.turn, p.zone]) }; } return 'none'; }"""
TEAM = """() => { const C = GAME.Core, S = C.state; GAME.closeModal(); S.officers.forEach(o => { o.status = 'staged'; o.eta = 0; o.stage = 'primary'; });
  const ids = []; for (const sp of ['ll', 'point', 'breacher', 'k9']) { const o = S.officers.find(x => x.spec === sp && !ids.includes(x.id) && !x.team); if (o) ids.push(o.id); }
  while (ids.length < 4) { const o = S.officers.find(x => !ids.includes(x.id) && !x.team); ids.push(o.id); }
  const r = C.formTeam(ids, { point: ids[1] }); window._T = r.team.uid; GAME.openIssue(r.team.uid); return { ok: r.ok, eqHere: C.eqHere(), pool: Object.entries(S.armory).filter(e => e[1] > 0).length }; }"""
LL = """() => { const C = GAME.Core, S = C.state; GAME.closeModal(); C.eqArriveNow(); const t = C.unit(window._T), o = t.members.map(id => C.off(id)).find(q => q.spec === 'll') || C.off(t.members[0]);
  if (!C.llState(o)) C.invAct(o.id, 'draw', 'lesslethal'); for (let i = 0; i < 2; i++) C.invAct(o.id, 'draw', 'cs40'); C.syncEquip(t); GAME.openIssue(t.uid); const btn = document.querySelector(`[data-im="${o.id}"]`); if (btn) btn.click(); return C.llState(o); }"""
ACTS = """() => { const C = GAME.Core, S = C.state; GAME.closeModal(); const t = C.unit(window._T); t.deployed = true; GAME.select(t.uid); GAME.Render.centerOn(t.x, t.y); GAME.action && GAME.action('cs40'); GAME.refresh(true);
  const el = document.getElementById('acts'), b = el.querySelector('[data-act="cs40"]'), f = el.querySelector('[data-act="llfire"]'); if (!b) return 'no cs40 chip';
  const r = b.getBoundingClientRect(), e = el.getBoundingClientRect(); return { cs40: [Math.round(r.left), Math.round(r.right)], bar: [Math.round(e.left), Math.round(e.right)], visible: r.left >= e.left - 1 && r.right <= e.right + 1, ll: !!f, on: b.classList.contains('on') }; }"""
BC = """() => { const C = GAME.Core, S = C.state, R = GAME.Render; GAME.closeModal(); C.bcArriveNow(); const b = C.bearcats(); const b2 = b.find(c => c.name === 'BearCat 2') || b[0]; if (R.cam) R.cam.z = 1.5; R.centerOn(b2.x + 1, b2.y); S.version++; GAME.refresh(true);
  return { cats: b.map(c => [c.name, c.x, c.y]), pool2: S.armory2 && Object.entries(S.armory2).filter(e => e[1] > 0).map(e => e.join(':')).join(' ') }; }"""
REN = """() => { GAME.openIssue(window._T); document.getElementById('i-done').click(); const m = document.getElementById('m-tname'); return m.classList.contains('show'); }"""
TRL = """() => { const C = GAME.Core, S = C.state, R = GAME.Render; GAME.closeModal(); R.fit('all'); S.version++; GAME.refresh(true); return { arch: S.house.archName, trailers: S.world.nb.filter(q => q.trailer).length, nb: S.world.nb.length }; }"""
SCROLLHELP = "(pat) => { const re = new RegExp(pat); const el = [...document.querySelectorAll('#m-help *')].find(e => re.test(e.textContent.trim()) && e.children.length < 3); if (el) el.scrollIntoView(); return !!el; }"
with sync_playwright() as pw:
    b=pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for (w,h,dpr,touch,sfx) in [(1024,471,1,False,''),(390,844,3,True,'_portrait')]:
        ctx=b.new_context(viewport={'width':w,'height':h}, device_scale_factor=dpr, has_touch=touch, is_mobile=touch); p=ctx.new_page()
        p.on('console', lambda m, w=w, h=h: m.type=='error' and errs.append(f'{w}x{h}: {m.text}'))
        p.on('pageerror', lambda e, w=w, h=h: errs.append(f'{w}x{h} pageerror: {e}'))
        p.goto(URL); p.wait_for_timeout(700)
        out['setup'+sfx]=p.evaluate(SETUP, 70); p.wait_for_timeout(600)
        out['trl'+sfx]=p.evaluate(TRL); p.wait_for_timeout(500)
        if touch: p.evaluate("() => { const t = document.getElementById('t-map') || [...document.querySelectorAll('#mtabs button')].find(b => /MAP/.test(b.textContent)); if (t) t.click(); }"); p.wait_for_timeout(300)
        p.screenshot(path=f'screenshots/v23_trailers{sfx}.png')
        out['team'+sfx]=p.evaluate(TEAM); p.wait_for_timeout(500); p.screenshot(path=f'screenshots/v23_issue_noeq{sfx}.png')
        out['ll'+sfx]=p.evaluate(LL); p.wait_for_timeout(500); p.screenshot(path=f'screenshots/v23_issue_ll{sfx}.png')
        out['ren'+sfx]=p.evaluate(REN); p.wait_for_timeout(400); p.screenshot(path=f'screenshots/v23_rename{sfx}.png')
        p.evaluate("() => GAME.closeModal()")
        if touch: p.evaluate("() => { const t = document.getElementById('t-map') || [...document.querySelectorAll('#mtabs button')].find(b => /MAP/.test(b.textContent)); if (t) t.click(); }"); p.wait_for_timeout(300)
        out['acts'+sfx]=p.evaluate(ACTS); p.wait_for_timeout(500); p.screenshot(path=f'screenshots/v23_cs40{sfx}.png')
        out['bc'+sfx]=p.evaluate(BC); p.wait_for_timeout(500); p.screenshot(path=f'screenshots/v23_bearcats{sfx}.png')
        p.evaluate("() => { GAME.closeModal(); GAME.openMain(); }"); p.wait_for_timeout(400)
        p.evaluate("() => document.getElementById('mm-help').click()"); p.wait_for_timeout(300)
        out['help'+sfx]=p.evaluate(SCROLLHELP, '^Vehicles, wall charges'); p.wait_for_timeout(300); p.screenshot(path=f'screenshots/v23_help{sfx}.png')
        ctx.close()
    b.close()
print(json.dumps(out, indent=0)); print('ERRORS', len(errs)); [print(e) for e in errs]
