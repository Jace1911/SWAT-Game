import json
from playwright.sync_api import sync_playwright
URL='http://127.0.0.1:8765/index.html'
errs=[]; out={}
def js(name): return open(f'/workspace/swat-game/tests/shots_v22_js/{name}.js').read()
with sync_playwright() as pw:
    b=pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for (w,h,dpr,touch,sfx) in [(1024,471,1,False,''),(390,844,3,True,'_portrait')]:
        ctx=b.new_context(viewport={'width':w,'height':h}, device_scale_factor=dpr, has_touch=touch, is_mobile=touch); p=ctx.new_page()
        p.on('console', lambda m, w=w, h=h: m.type=='error' and errs.append(f'{w}x{h}: {m.text}'))
        p.on('pageerror', lambda e, w=w, h=h: errs.append(f'{w}x{h} pageerror: {e}'))
        p.goto(URL); p.wait_for_timeout(700)
        p.evaluate("() => GAME.newGame(12345,false,null,'barricade',null)"); p.wait_for_timeout(600)
        p.evaluate("() => { GAME.closeModal(); GAME.Render.fit('house'); GAME.Core.state.version++; GAME.refresh(true); }"); p.wait_for_timeout(400)
        if touch: p.evaluate(js('maptab')); p.wait_for_timeout(300)
        out['wp'+sfx]=p.evaluate(js('wp')); p.wait_for_timeout(500)
        p.screenshot(path=f'screenshots/v22_waypoints{sfx}.png')
        out['draco'+sfx]=p.evaluate(js('draco')); p.wait_for_timeout(500)
        p.screenshot(path=f'screenshots/v22_draco{sfx}.png')
        out['intel'+sfx]=p.evaluate(js('intel')); p.wait_for_timeout(500)
        p.evaluate("() => { const e=[...document.querySelectorAll('span')].find(s=>/^Behaviour/.test(s.textContent)); if (e) e.scrollIntoView(); }"); p.wait_for_timeout(300)
        p.screenshot(path=f'screenshots/v22_intel_beh{sfx}.png')
        p.reload(); p.wait_for_timeout(1200); p.evaluate("() => { GAME.closeModal && GAME.closeModal(); GAME.openMain(); }"); p.wait_for_timeout(500)
        p.evaluate("() => document.getElementById('mm-help').click()"); p.wait_for_timeout(300)
        for name,pat in [('help_beh','^Suspect behaviour types'),('help_wp','^Move waypoints')]:
            p.evaluate(js('scrollhelp'), pat); p.wait_for_timeout(300); p.screenshot(path=f'screenshots/v22_{name}{sfx}.png')
        ctx.close()
    b.close()
print(json.dumps(out, indent=0)); print('ERRORS', len(errs)); [print(e) for e in errs]
