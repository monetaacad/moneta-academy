# 처음 안내 → 화면 둘러보기 시험 (미리보기판 dist/demo-test.html 을 http로 띄운 주소: BASE=http://127.0.0.1:8765/demo.html)
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); errs=[]
    for tag,w,h,mob in [('pc',1280,860,False),('mob',390,844,True)]:
        c=b.new_context(viewport={'width':w,'height':h},is_mobile=mob,has_touch=mob); pg=c.new_page(); pg.on('pageerror',lambda e:errs.append(f'{tag} {e}'))
        pg.goto(__import__('os').environ.get('BASE','http://127.0.0.1:8765/demo.html')); pg.wait_for_timeout(800)
        pg.click('.gloss summary'); pg.wait_for_timeout(200); pg.query_selector('.gloss').scroll_into_view_if_needed(); pg.screenshot(path=f'/tmp/onb-{tag}-gloss.png')
        pg.click('.gloss [data-act=guide]'); pg.wait_for_timeout(300)
        if not pg.query_selector('#g-list .gitem'): errs.append(tag+' guide not opened pre-login')
        pg.click('[data-act=gcat][data-a="처음"]'); pg.wait_for_timeout(200)
        if pg.query_selector('[data-act=tut-again]'): errs.append(tag+' tut-again shown pre-login')
        pg.click('[data-act=modal-close]'); pg.wait_for_timeout(200)
        pg.fill('#a-name','테스트'); pg.click('[data-act=ihouse][data-a=lanterna]'); pg.click('[data-act=icls][data-a=mage]'); pg.click('[data-act=auth-go]'); pg.wait_for_timeout(900)
        t=pg.evaluate("()=>document.querySelector('.mbox h2')&&document.querySelector('.mbox h2').textContent"); print(tag,'first modal:',t)
        if not t or '처음' not in t: errs.append(tag+' onb modal not first: '+str(t))
        pg.screenshot(path=f'/tmp/onb-{tag}-g1.png')
        for k in range(10):
            nx=pg.query_selector('.mbox [data-act=onb-g]:last-of-type.primary') or pg.query_selector('.mbox .btn.primary[data-act=onb-g]')
            if not nx: break
            nx.click(); pg.wait_for_timeout(150)
        pg.click('.mbox .btn.primary[data-act=modal-close]'); pg.wait_for_timeout(600)
        n=0
        while pg.query_selector('#tut') and n<12:
            pg.screenshot(path=f'/tmp/onb-{tag}-t{n}.png'); n+=1
            pg.click('#tut [data-act=tut-next]'); pg.wait_for_timeout(450)
        print(tag,'tour steps',n,'done pref', pg.evaluate("()=>JSON.parse(localStorage.getItem('arc_pref')).tutDone"))
        pg.wait_for_timeout(500); t=pg.evaluate("()=>document.querySelector('.mbox')&&document.querySelector('.mbox').innerText.slice(0,40)"); print(tag,'after tour:',t)
        if not pg.query_selector('.mbox'): errs.append(tag+' story not shown after tour')
        pg.click('.mbox [data-act=modal-close]'); pg.wait_for_timeout(600)
        t=pg.evaluate("()=>document.querySelector('.mbox')&&document.querySelector('.mbox').innerText.slice(0,40)"); print(tag,'after story:',t)
        if not t or '학기 이야기' not in t: errs.append(tag+' mq intro not shown: '+str(t))
        pg.evaluate("()=>{document.querySelectorAll('.mbox [data-act=modal-close]').forEach(c=>c.click())}"); pg.wait_for_timeout(400)
        # replay from guide
        pg.click('[data-act=guide]'); pg.wait_for_timeout(300); pg.click('[data-act=gcat][data-a="처음"]'); pg.wait_for_timeout(200); pg.click('[data-act=tut-again]'); pg.wait_for_timeout(600)
        if not pg.query_selector('#tut'): errs.append(tag+' replay failed')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
        if pg.query_selector('#tut'): errs.append(tag+' esc failed')
        ow=pg.evaluate('()=>document.documentElement.scrollWidth-innerWidth')
        if ow>1: errs.append(f'{tag} overflow {ow}')
    print(errs or 'ok')
