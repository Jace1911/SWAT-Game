# v23 stage B screenshots: briefs (address title, record on file, mental hook), 911 transcript, top bar, help section
import json
from playwright.sync_api import sync_playwright
URL='http://127.0.0.1:8765/index.html'
errs=[]; out={}
FIND = """([st, want]) => { const C = GAME.Core; for (let s = 40; s < 400; s++) { GAME.newGame(s, false, 50, st, null); const S = C.state, B = S.brief, k = B.known.join(' | ');
  const okk = want === 'hook' ? /fired a round|warrant|threaten/i.test(B.transcript ? B.transcript.map(x => x.t || x[1] || x).join(' ') : '') || true : want === 'rec' ? (B.history || []).length >= 4 : want === 'down' ? S.hid && S.hid.down : true;
  if (okk) { GAME.closeModal(); GAME.openBrief(); const bg = document.getElementById('brs-bg'); if (bg) { bg.open = true; bg.scrollIntoView({block: 'center'}); } return { seed: s, title: document.getElementById('opname').textContent, known: B.known, hid: S.hid, legal: B.legal }; } } return 'none'; }"""
SCROLLHELP = "(pat) => { const re = new RegExp(pat); const el = [...document.querySelectorAll('#m-help *')].find(e => re.test(e.textContent.trim()) && e.children.length < 3); if (el) el.scrollIntoView({block:'start'}); return !!el; }"
with sync_playwright() as pw:
    b=pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for (w,h,dpr,touch,sfx) in [(1024,471,1,False,''),(390,844,3,True,'_portrait')]:
        ctx=b.new_context(viewport={'width':w,'height':h}, device_scale_factor=dpr, has_touch=touch, is_mobile=touch); p=ctx.new_page()
        p.on('console', lambda m, w=w, h=h: m.type=='error' and errs.append(f'{w}x{h}: {m.text}'))
        p.on('pageerror', lambda e, w=w, h=h: errs.append(f'{w}x{h} pageerror: {e}'))
        p.goto(URL); p.wait_for_timeout(700)
        for (st, want, name) in [('mental','hook','brief_mental'), ('drughouse','rec','brief_record'), ('domestic','down','brief_officerhit')]:
            out[name+sfx]=p.evaluate(FIND, [st, want]); p.wait_for_timeout(400); p.screenshot(path=f'screenshots/v23_{name}{sfx}.png')
        p.evaluate("() => { GAME.closeModal(); GAME.open911(); }"); p.wait_for_timeout(500); p.screenshot(path=f'screenshots/v23_911{sfx}.png')
        p.evaluate("() => { const S = GAME.Core.state; S.tts = null; }")
        p.evaluate("() => GAME.closeModal()"); p.wait_for_timeout(300); p.screenshot(path=f'screenshots/v23_topbar{sfx}.png')
        p.evaluate("() => { GAME.closeModal(); GAME.openMain(); }"); p.wait_for_timeout(400)
        p.evaluate("() => document.getElementById('mm-help').click()"); p.wait_for_timeout(300)
        out['help'+sfx]=p.evaluate(SCROLLHELP, '^The call & the brief'); p.wait_for_timeout(300); p.screenshot(path=f'screenshots/v23_help_brief{sfx}.png')
        ctx.close()
    b.close()
print(json.dumps(out, indent=0)[:6000]); print('ERRORS', len(errs)); [print(e) for e in errs]
