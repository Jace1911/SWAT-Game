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
  const ids=[]; for (const sp of ['point','breacher','k9','ll']) { const o=S.officers.find(x=>x.spec===sp && !ids.includes(x.id) && !x.team); if(o) ids.push(o.id); }
  const r=C.formTeam(ids,{point:ids[0]}); const b=S.officers.find(o=>o.id===ids[1]); S.armory.charge=Math.max(S.armory.charge||0,2); C.invAct(b.id,'draw','charge'); C.invAct(b.id,'draw','charge'); C.syncEquip(r.team); return r.team.uid; }"""
WALL="""(u) => { const C=GAME.Core,S=C.state,t=C.unit(u); S.doors.forEach(d=>{ if(!d.exterior) d.state='open'; });
  for (let y=1;y<C.MAP_H-1;y++) for (let x=1;x<C.MAP_W-1;x++) { if (C.roomAt(x,y)!==-1||S.block[C.idx(x,y)]) continue;
    for (const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]]) { const nx=x+dx,ny=y+dy; if (C.roomAt(nx,ny)>=0 && C.edge(x,y,nx,ny).t==='X' && !S.block[C.idx(nx,ny)]) { t.deployed=true; t.x=x; t.y=y; return [x,y,C.v21Actions(u).map(a=>a.label)]; } } } return null; }"""
with sync_playwright() as pw:
    b=pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for (w,h,dpr,touch,sfx) in [(1024,471,1,False,''),(390,844,3,True,'_portrait')]:
        ctx,p=page_for(b,w,h,dpr,touch)
        p.evaluate("() => GAME.openMain()"); p.wait_for_timeout(500); p.screenshot(path=f'screenshots/v21_mainmenu{sfx}.png')
        out['ver'+sfx]=p.evaluate("() => { const e=document.getElementById('mm-ver'); return e && e.textContent; }")
        game(p,12345); uid=p.evaluate(TEAM)
        p.evaluate("(u) => GAME.openIssue(u)", uid); p.wait_for_timeout(500); p.screenshot(path=f'screenshots/v21_issue{sfx}.png')
        out['issuePool'+sfx]=p.evaluate("() => { const t=document.getElementById('m-issue').innerText; return {plate:/Plate Carrier|Rifle plate/i.test(t), rifleRow:/Rifle \\(left here\\)/.test(t)}; }")
        p.evaluate("() => GAME.closeModal()"); p.wait_for_timeout(200)
        out['wall'+sfx]=p.evaluate(WALL, uid)
        p.evaluate("(u) => { const C=GAME.Core,t=C.unit(u); GAME.openLoad(t.members[0]); }", uid); p.wait_for_timeout(400)
        out['dropBtn'+sfx]=p.evaluate("() => [...document.querySelectorAll('[data-ldrop]')].map(b=>[b.textContent, b.disabled])")
        p.screenshot(path=f'screenshots/v21_loadout{sfx}.png')
        p.evaluate("() => GAME.closeModal()"); p.wait_for_timeout(200)
        p.evaluate("(u) => GAME.openTeamDlg(u)", uid); p.wait_for_timeout(400)
        out['acts'+sfx]=p.evaluate("() => [...document.querySelectorAll('[data-v21]')].map(b=>b.textContent.trim())")
        p.evaluate("() => { const el=[...document.querySelectorAll('#team-dlg .sec')].find(e=>/Actions here/.test(e.textContent)); if(el) el.scrollIntoView(); }"); p.wait_for_timeout(200)
        p.screenshot(path=f'screenshots/v21_teamdlg{sfx}.png')
        out['click'+sfx]=p.evaluate("() => { const C=GAME.Core,S=C.state; S.rng.chance=()=>true; const b=document.querySelector('[data-v21=hole]'); if(b) b.click(); const b2=document.querySelector('[data-v21=port]'); if(b2) b2.click(); return [S.wallLog, (S.ports||[]).length]; }"); p.wait_for_timeout(300)
        p.evaluate("() => { GAME.closeModal(); const t=GAME.Core.state.units.find(u=>u.kind==='team'); GAME.select(t.uid); GAME.Render.zoomAt && 0; GAME.Core.state.version++; GAME.refresh(true); }"); p.wait_for_timeout(600)
        p.screenshot(path=f'screenshots/v21_map_wall{sfx}.png')
        p.reload(); p.wait_for_timeout(1200); p.evaluate("() => { GAME.closeModal && GAME.closeModal(); GAME.openMain(); }"); p.wait_for_timeout(500)
        p.evaluate("() => document.getElementById('mm-help').click()"); p.wait_for_timeout(300)
        for name,pat in [('help_kit','^Personal kit, drops'),('help_k9','^Wall charges, cameras')]:
            p.evaluate("(pat) => { const re=new RegExp(pat); const el=[...document.querySelectorAll('#m-help *')].find(e=>re.test(e.textContent.trim()) && e.children.length<3); if(el) el.scrollIntoView(); }", pat); p.wait_for_timeout(300)
            p.screenshot(path=f'screenshots/v21_{name}{sfx}.png')
        ctx.close()
    b.close()
print(json.dumps(out, indent=0)[:5000]); print('ERRORS', len(errs)); [print(e) for e in errs]
