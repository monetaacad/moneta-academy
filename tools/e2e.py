# 실제 서버를 띄워 놓고 브라우저로 입학 → 작업 → 완료 보고까지 확인
import os, sys, time, json
from playwright.sync_api import sync_playwright
B = os.environ.get('BASE', 'http://127.0.0.1:8098')
OUT = os.path.join(os.path.dirname(__file__), 'shots'); errs = []
import urllib.request
def invite(uses=1):
    r = urllib.request.Request(B + '/api/admin/invites', data=json.dumps({'count': 1, 'uses': uses}).encode(), headers={'content-type': 'application/json', 'x-admin-token': 'test-admin-token-0123456789abcdef'})
    return json.loads(urllib.request.urlopen(r).read())['codes'][0]
def watch(pg, tag):
    pg.on('pageerror', lambda e: errs.append(f'[{tag}] pageerror {e}'))
    pg.on('console', lambda m: errs.append(f'[{tag}] {m.text}') if m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text else None)
with sync_playwright() as p:
    b = p.chromium.launch()
    for (w, h, tag, mob) in [(1280, 900, 'd', False), (390, 844, 'm', True)]:
        ctx = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mob, has_touch=mob); ctx.add_init_script("if(!localStorage.getItem('arc_pref'))localStorage.setItem('arc_pref','{\"tutDone\":1,\"tutV\":{\"lecture\":1,\"explore\":1,\"lib\":1,\"exam\":1,\"world\":1,\"party\":1,\"guild\":1,\"friends\":1,\"board\":1,\"auction\":1,\"market\":1,\"gear\":1,\"work\":1,\"shop\":1,\"rec\":1}}')")   # 처음 안내·둘러보기는 따로 시험(e2e_onb)
        ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = ctx.new_page(); watch(pg, tag)
        pg.goto(B); pg.wait_for_timeout(700)
        pg.screenshot(path=f'{OUT}/{tag}-00-login.png', full_page=True)
        pg.click('[data-act=authtab][data-a=signup]'); pg.wait_for_timeout(200)
        name = ('테스트' + tag + str(int(time.time()) % 10000))[:12]
        pg.fill('#a-name', name); pg.fill('#a-pw', 'secret123'); pg.fill('#a-pw2', 'secret123'); pg.fill('#a-code', invite())
        pg.click('[data-act=ihouse][data-a=corona]'); pg.click('[data-act=icls][data-a=mage]')
        pg.screenshot(path=f'{OUT}/{tag}-01-register.png', full_page=True)
        pg.click('[data-act=auth-go]'); pg.wait_for_timeout(800)
        for _ in range(3): pg.evaluate("()=>document.querySelectorAll('.mbox [data-act=modal-close]').forEach(c=>c.click())"); pg.wait_for_timeout(300)   # 이야기 → 학기 이야기 첫 장면
        pg.screenshot(path=f'{OUT}/{tag}-02-home.png', full_page=True)
        # 수업 30분 시작
        pg.evaluate("() => __ACT.nav('lecture')"); pg.wait_for_timeout(300)
        pg.click('[data-act=pick][data-a=ld0][data-b="30m"]'); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{OUT}/{tag}-03-lecture.png', full_page=True)
        pg.click('[data-act=lec-start][data-a="0"]'); pg.wait_for_timeout(500)
        # 원정 30분
        pg.evaluate("() => __ACT.nav('explore')"); pg.wait_for_timeout(300)
        pg.click('[data-act=pick][data-a=ed0][data-b="30m"]'); pg.wait_for_timeout(150)
        pg.click('[data-act=exp-start][data-a="0"]'); pg.wait_for_timeout(1200)
        pg.screenshot(path=f'{OUT}/{tag}-04-explore.png', full_page=True)
        # 연구
        pg.evaluate("() => __ACT.nav('lib')"); pg.wait_for_timeout(300)
        btn = pg.query_selector('[data-a=resStart]:not([disabled])')
        if btn: btn.click(); pg.wait_for_timeout(400)
        # 월드
        pg.evaluate("() => __ACT.nav('world')"); pg.wait_for_timeout(500)
        pg.click('[data-act=wb]'); pg.wait_for_timeout(500); pg.screenshot(path=f'{OUT}/{tag}-06-wbfight.png')
        pg.click('#rp-skip'); pg.wait_for_timeout(1200); pg.screenshot(path=f'{OUT}/{tag}-07-wbresult.png')
        pg.click('[data-act=modal-close]'); pg.wait_for_timeout(300)
        pg.screenshot(path=f'{OUT}/{tag}-08-world.png', full_page=True)
        # 보스 (질 것)
        pg.evaluate("() => __ACT.nav('explore')"); pg.wait_for_timeout(300)
        pg.click('[data-act=boss]'); pg.wait_for_timeout(400); pg.click('#rp-skip'); pg.wait_for_timeout(1200)
        pg.screenshot(path=f'{OUT}/{tag}-09-boss.png'); pg.click('[data-act=modal-close]')
        # 모든 탭 + 가로 넘침
        for v in ['home', 'lecture', 'lib', 'explore', 'exam', 'world', 'gear', 'work', 'party', 'market', 'auction', 'shop', 'lore', 'rec']:
            pg.evaluate(f"() => __ACT.nav('{v}')"); pg.wait_for_timeout(250)
            ow = pg.evaluate('() => document.documentElement.scrollWidth - window.innerWidth')
            if ow > 1: errs.append(f'[{tag}] overflow {v} {ow}')
            pg.screenshot(path=f'{OUT}/{tag}-1x-{v}.png', full_page=True)
        # 시간 배속으로 작업 완료 대기 (30분 = 30초)
        pg.evaluate("() => __ACT.nav('home')")
        pg.wait_for_timeout(34000)
        rep = pg.evaluate("() => !!document.querySelector('#modal:not([hidden]) .report')")
        pg.screenshot(path=f'{OUT}/{tag}-20-report.png')
        if not rep: errs.append(f'[{tag}] no completion report after jobs finished')
        else:
            for _ in range(4):
                if pg.query_selector('[data-act=inbox-ok]'): pg.click('[data-act=inbox-ok]'); pg.wait_for_timeout(700)
        inbox = pg.evaluate("() => window.__S.P.inbox.length")
        if inbox: errs.append(f'[{tag}] inbox not acked ({inbox})')
        # 새로고침 → 로그인 유지
        pg.reload(); pg.wait_for_timeout(1000)
        if not pg.query_selector('#nav'): errs.append(f'[{tag}] session not restored after reload')
        pg.screenshot(path=f'{OUT}/{tag}-21-reload.png')
        ctx.close()
    b.close()
print('\n'.join(errs) if errs else 'NO ERRORS')
