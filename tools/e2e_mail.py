# 우편함(운영실에서 보내기 → 실시간 알림 → 열어 보기 → 받기), 별의 탑, 밝은 테마
import os, json, time, random, urllib.request
from playwright.sync_api import sync_playwright
B = os.environ.get('BASE', 'http://127.0.0.1:8098'); OUT = os.path.join(os.path.dirname(__file__), 'shots'); errs = []
TOK = 'test-admin-token-0123456789abcdef'
def invite():
    r = urllib.request.Request(B + '/api/admin/invites', data=json.dumps({'count': 1}).encode(), headers={'content-type': 'application/json', 'x-admin-token': TOK})
    return json.loads(urllib.request.urlopen(r).read())['codes'][0]
def check(c, m):
    if not c: errs.append(m)
sfx = str(random.randint(1000, 99999))
with sync_playwright() as p:
    b = p.chromium.launch()
    c = b.new_context(viewport={'width': 1360, 'height': 900}); c.route('**/fonts.g*/**', lambda r: r.abort()); c.add_init_script("if(!localStorage.getItem('arc_pref'))localStorage.setItem('arc_pref','{\"tutDone\":1,\"tutV\":{\"lecture\":1,\"explore\":1,\"lib\":1,\"exam\":1,\"world\":1,\"party\":1,\"guild\":1,\"friends\":1,\"board\":1,\"auction\":1,\"market\":1,\"gear\":1,\"work\":1,\"shop\":1,\"rec\":1}}')")   # 처음 안내·둘러보기는 따로 시험(e2e_onb)
    pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(f'[S] {e}')); pg.goto(B); pg.wait_for_timeout(700)
    pg.click('[data-act=authtab][data-a=signup]'); pg.fill('#a-id', 'u' + __import__('hashlib').md5(('우편' + sfx).encode()).hexdigest()[:10]); pg.fill('#a-name', '우편' + sfx); pg.fill('#a-pw', 'secret123'); pg.fill('#a-pw2', 'secret123'); pg.fill('#a-code', invite())
    pg.click('[data-act=ihouse][data-a=speculum]'); pg.click('[data-act=icls][data-a=mage]'); pg.click('[data-act=auth-go]'); pg.wait_for_timeout(900); [ (pg.evaluate("()=>document.querySelectorAll('.mbox [data-act=modal-close]').forEach(c=>c.click())"), pg.wait_for_timeout(300)) for _ in range(3) ]; pg.wait_for_timeout(1500)
    # 운영실에서 보내기
    ad = c.new_page(); ad.on('pageerror', lambda e: errs.append(f'[A] {e}')); ad.goto(B + '/admin.html'); ad.fill('#tok', TOK); ad.click('#go'); ad.wait_for_timeout(800)
    ad.fill('#mtitle', '개교 기념 선물'); ad.fill('#mbody', '모두 환영합니다!'); ad.fill('[data-rw=shard]', '50'); ad.fill('[data-rw=gear]', '1')
    ad.click('[data-a=mforever]'); ad.on('dialog', lambda d: d.accept()); ad.click('[data-a=mail]'); ad.wait_for_timeout(900)
    check('개교 기념 선물' in ad.inner_text('#mails'), 'admin list missing mail')
    ad.screenshot(path=f'{OUT}/mail-admin.png', full_page=True)
    pg.wait_for_timeout(1200)
    badge = pg.evaluate("() => { const b = document.querySelector('#mailbadge'); return b.hidden ? '' : b.textContent; }")
    check(badge == '1', 'mail badge not live: ' + repr(badge))
    sh0 = pg.evaluate('() => __S.P.res.shard')
    pg.click('[data-act=mailbox]'); pg.wait_for_timeout(600); pg.click('[data-act=mailopen]'); pg.wait_for_timeout(400)
    check('기한 없음' in pg.inner_text('#modal'), 'forever not shown')
    pg.click('[data-act=modal-close]'); pg.wait_for_timeout(300)
    check(pg.evaluate("() => document.querySelector('#mailbadge').hidden"), 'badge stays after read')
    pg.click('[data-act=mailbox]'); pg.wait_for_timeout(600); pg.click('[data-act=mailall]'); pg.wait_for_timeout(900)
    check(pg.evaluate('() => __S.P.res.shard') == sh0 + 50, 'shard not granted')
    pg.screenshot(path=f'{OUT}/mail-box.png'); pg.click('[data-act=modal-close]')
    # 별의 탑
    pg.evaluate("() => __ACT.nav('party')"); pg.wait_for_timeout(500); pg.fill('#pt-name', '탑' + sfx[:3]); pg.click('[data-act=pop][data-a=create]'); pg.wait_for_timeout(2500)
    check(pg.query_selector('.tower') is not None, 'tower card missing')
    pg.click('[data-act=twgo][data-a=real]'); pg.wait_for_timeout(300); pg.click('[data-act=twgo][data-a=real]'); pg.wait_for_timeout(18000)   # 실전 준비: 한 번 더 눌러 준비 · 혼자 파티라 15초 뒤 출발
    check(pg.query_selector('.twjournal.live #twlines .el') is not None, 'tower journal not streaming')
    pg.screenshot(path=f'{OUT}/tower-journal.png')
    pg.wait_for_selector('#modal:not([hidden]) h2', timeout=600000); pg.screenshot(path=f'{OUT}/tower-result.png')   # 실전은 건너뛸 수 없어 끝날 때까지 기다린다
    check(pg.query_selector('#modal:not([hidden]) h2') is not None, 'tower result missing')
    pg.click('#modal [data-act=modal-close]'); pg.wait_for_timeout(1500)
    # 밝은 테마
    pg.click('[data-act=settings]'); pg.wait_for_timeout(300); pg.click('[data-act=settheme][data-a=day]'); pg.wait_for_timeout(500)
    check(pg.evaluate("() => document.documentElement.dataset.skin") == 'day', 'theme not applied')
    pg.click('[data-act=modal-close]'); pg.wait_for_timeout(300); pg.screenshot(path=f'{OUT}/day-party.png', full_page=True)
    pg.reload(); pg.wait_for_timeout(1200)
    check(pg.evaluate("() => document.documentElement.dataset.skin") == 'day', 'theme not remembered')
    b.close()
print('\n'.join(errs) if errs else 'NO ERRORS')
