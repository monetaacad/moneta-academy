# 처음 안내 시험 (미리보기판 dist/demo-test.html 을 http로 띄운 주소: BASE=http://127.0.0.1:8765/demo.html)
# 가입 → 「처음」 3장 → 이야기 → 학기 이야기 → 첫 교시 · 첫 원정을 직접 → 나머지 안내 → 화면 둘러보기
from playwright.sync_api import sync_playwright
def mtext(pg): return pg.evaluate("()=>document.querySelector('.mbox')&&document.querySelector('.mbox').innerText.slice(0,60)")
def pages(pg):
    n=1
    for k in range(12):
        nx=pg.query_selector('.mbox .btn.primary[data-act=onb-g]')
        if not nx: break
        nx.click(); pg.wait_for_timeout(150); n+=1
    return n
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
        if pg.query_selector('.hmirror'): pg.click('.mbox .btn.primary[data-act=modal-close]'); pg.wait_for_timeout(500)
        t=pg.evaluate("()=>document.querySelector('.mbox h2')&&document.querySelector('.mbox h2').textContent"); print(tag,'first modal:',t)
        if not t or '처음' not in t: errs.append(tag+' onb modal not first: '+str(t))
        n=pages(pg); print(tag,'first pages',n)
        if n!=3: errs.append(f'{tag} first pages {n}')
        pg.click('.mbox .btn.primary[data-act=modal-close]'); pg.wait_for_timeout(600)
        if pg.query_selector('#tut'): errs.append(tag+' tour shown before first action')
        print(tag,'story:',mtext(pg))
        pg.click('.mbox [data-act=modal-close]'); pg.wait_for_timeout(600)
        t=mtext(pg); print(tag,'after story:',t)
        if not t or '학기 이야기' not in t: errs.append(tag+' mq intro not shown: '+str(t))
        # 첫 교시
        pg.click('.mbox [data-act=mqgo]'); pg.wait_for_timeout(700)
        if not pg.query_selector('#tut'): errs.append(tag+' lec tut missing')
        pg.click('[data-act=lec-start]'); pg.wait_for_timeout(900)
        pg.click('#nav button[data-a="home"]'); pg.wait_for_timeout(900)
        if pg.query_selector('#tut'): errs.append(tag+' lec tut not ended')
        if pg.query_selector('.mbox'): errs.append(tag+' modal after lec: '+str(mtext(pg)))
        pg.click('[data-act=mqclaim]'); pg.wait_for_timeout(600)
        # 첫 원정
        pg.click('.mbox [data-act=mqgo]'); pg.wait_for_timeout(700)
        if not pg.query_selector('#tut'): errs.append(tag+' exp tut missing')
        pg.click('[data-act=exp-start]'); pg.wait_for_timeout(900)
        pg.click('#nav button[data-a="home"]'); pg.wait_for_timeout(1200)
        t=pg.evaluate("()=>document.querySelector('.mbox h2')&&document.querySelector('.mbox h2').textContent"); print(tag,'after exp:',t)
        if not t or '수업' not in t: errs.append(tag+' rest guide not shown: '+str(t))
        n=pages(pg); print(tag,'rest pages',n)
        if n!=7: errs.append(f'{tag} rest pages {n}')
        pg.click('.mbox .btn.primary[data-act=modal-close]'); pg.wait_for_timeout(600)
        n=0
        while pg.query_selector('#tut') and n<14:
            pg.screenshot(path=f'/tmp/onb-{tag}-t{n}.png'); n+=1
            pg.click('#tut [data-act=tut-next]'); pg.wait_for_timeout(450)
        done=pg.evaluate("()=>JSON.parse(localStorage.getItem('arc_pref')).tutDone"); print(tag,'tour steps',n,'done pref',done)
        if not n or not done: errs.append(tag+' tour not done')
        pg.wait_for_timeout(400)
        if pg.query_selector('.mbox'): errs.append(tag+' modal after tour: '+str(mtext(pg)))
        # replay from guide
        pg.click('[data-act=guide]'); pg.wait_for_timeout(300); pg.click('[data-act=gcat][data-a="처음"]'); pg.wait_for_timeout(200); pg.click('[data-act=tut-again]'); pg.wait_for_timeout(600)
        if not pg.query_selector('#tut'): errs.append(tag+' replay failed')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
        if pg.query_selector('#tut'): errs.append(tag+' esc failed')
        ow=pg.evaluate('()=>document.documentElement.scrollWidth-innerWidth')
        if ow>1: errs.append(f'{tag} overflow {ow}')
    print(errs or 'ok')
