import json
from playwright.sync_api import sync_playwright
URL='http://127.0.0.1:8765/index.html'
errs=[]; out={}
def page_for(b, w, h, dpr=1, touch=False):
    ctx=b.new_context(viewport={'width':w,'height':h}, device_scale_factor=dpr, has_touch=touch, is_mobile=touch)
    p=ctx.new_page()
    p.on('console', lambda m: m.type=='error' and errs.append(f'{w}x{h}: {m.text}'))
    p.on('pageerror', lambda e: errs.append(f'{w}x{h} pageerror: {e}'))
    p.goto(URL); p.wait_for_timeout(700)
    return ctx,p
def game(p, seed):
    p.evaluate(f"() => GAME.newGame({seed},false,null,'barricade',null)"); p.wait_for_timeout(600)
    p.evaluate("() => { GAME.closeModal(); GAME.Render.fit('house'); GAME.Core.state.version++; GAME.refresh(true); }"); p.wait_for_timeout(500)
TEAM="""() => { const C=GAME.Core,S=C.state; S.officers.forEach(o=>{o.status='staged';o.eta=0;o.stage='primary';});
  const ids=[]; for (const sp of ['point','breacher','medic','tech']) { const o=S.officers.find(x=>x.spec===sp && !ids.includes(x.id) && !x.team); if(o) ids.push(o.id); }
  const r=C.formTeam(ids,{point:ids[0]}); return r.team.uid; }"""
WIN="""() => { const C=GAME.Core,S=C.state; const sp=C.suspList()[0]; C.ENC_CFG.blind=50; C.ENC_CFG.blindHit=0;
  for (const w of S.windows.filter(q=>q.room===sp.room)) { const e=w.edges[0]; const out=C.roomAt(e[0],e[1])===sp.room?[e[2],e[3]]:[e[0],e[1]]; if (C.roomAt(out[0],out[1])>=0) continue;
    const t=S.units.find(u=>u.kind==='team'); t.deployed=true; t.x=out[0]; t.y=out[1]; S.phase='executing'; C.encThreshold(t,{type:'gas',room:sp.room}); const it=C.encCur(); if(it){ GAME.openEnc(); return it.options.map(o=>o.label); } }
  return 'no window'; }"""
with sync_playwright() as pw:
    b=pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for (w,h,dpr,touch,sfx) in [(1024,471,1,False,''),(390,844,3,True,'_portrait')]:
        ctx,p=page_for(b,w,h,dpr,touch)
        p.evaluate("() => GAME.openMain()"); p.wait_for_timeout(500); p.screenshot(path=f'screenshots/v20_mainmenu{sfx}.png')
        out['ver'+sfx]=p.evaluate("() => { const e=document.getElementById('mm-ver'); return e && e.textContent; }")
        game(p,12345); uid=p.evaluate(TEAM)
        p.evaluate("(u) => GAME.openIssue(u)", uid); p.wait_for_timeout(500); p.screenshot(path=f'screenshots/v20_issue{sfx}.png')
        out['issueHome'+sfx]=p.evaluate("() => /\\bHome\\b|TAKE-HOME/.test(document.getElementById('m-issue').innerText)")
        p.evaluate("() => { GAME.closeModal(); }"); p.wait_for_timeout(200)
        _d=p.evaluate("(u) => { const C=GAME.Core,S=C.state,t=C.unit(u); t.deployed=true; const pt=S.officers.find(o=>o.id===t.members[0]); const k=C.invOf(pt).hands.find(x=>/^(shield|ram)/.test(x||''))||'shield'; const r=C.dropItem(pt.id,k); GAME.openTeamDlg(u); return [k,r,C.invOf(pt).hands]; }", uid); p.wait_for_timeout(400)
        out['drop'+sfx]=_d
        out['teamdlg'+sfx]=p.evaluate("() => ({names:[...document.querySelectorAll('[data-tname]')].length, pick:[...document.querySelectorAll('[data-pick]')].map(b=>b.textContent.trim())})")
        p.screenshot(path=f'screenshots/v20_teamdlg{sfx}.png')
        p.evaluate("() => { GAME.closeModal(); const t=GAME.Core.state.units.find(u=>u.kind==='team'); GAME.Render.fit && GAME.Render.fit('house'); GAME.select(t.uid); GAME.Core.state.version++; GAME.refresh(true); }"); p.wait_for_timeout(500)
        p.screenshot(path=f'screenshots/v20_map_dropped{sfx}.png')
        out['pick'+sfx]=p.evaluate("(u) => { GAME.throwPick(u,{type:'bang'}); return !!document.querySelector('#m-pick.show'); }", uid); p.wait_for_timeout(400)
        p.screenshot(path=f'screenshots/v20_thrower{sfx}.png')
        p.evaluate("() => GAME.closeModal()"); p.wait_for_timeout(200)
        out['win'+sfx]=p.evaluate(WIN); p.wait_for_timeout(500)
        p.screenshot(path=f'screenshots/v20_window{sfx}.png')
        p.reload(); p.wait_for_timeout(1200); p.evaluate("() => { GAME.closeModal && GAME.closeModal(); GAME.openMain(); }"); p.wait_for_timeout(500)
        p.evaluate("() => document.getElementById('mm-help').click()"); p.wait_for_timeout(300)
        for name,pat in [('help_contact','^Contact prompts \\(v20\\)'),('help_bearcat','^BearCat & Draco \\(v20\\)')]:
            p.evaluate("(pat) => { const re=new RegExp(pat); const el=[...document.querySelectorAll('#m-help *')].find(e=>re.test(e.textContent.trim()) && e.children.length<3); if(el) el.scrollIntoView(); }", pat); p.wait_for_timeout(300)
            p.screenshot(path=f'screenshots/v20_{name}{sfx}.png')
        ctx.close()
    b.close()
print(json.dumps(out, indent=0)[:4000]); print('ERRORS', len(errs)); [print(e) for e in errs]
