# 동아리(신청·승인·RP/오너 채팅), 칭호 도감, 설정, 정령 병 레이아웃
import os, json, time, urllib.request
from playwright.sync_api import sync_playwright
B = os.environ.get('BASE', 'http://127.0.0.1:8098'); OUT = os.path.join(os.path.dirname(__file__), 'shots'); errs = []
def invite():
    r = urllib.request.Request(B + '/api/admin/invites', data=json.dumps({'count': 1}).encode(), headers={'content-type': 'application/json', 'x-admin-token': 'test-admin-token-0123456789abcdef'})
    return json.loads(urllib.request.urlopen(r).read())['codes'][0]
def nav(pg, v): pg.evaluate(f"() => __ACT.nav('{v}')"); pg.wait_for_timeout(350)
def dock(pg):
    if pg.evaluate("() => document.querySelector('#chatdock').classList.contains('closed')"): pg.click('#chatdock [data-act=dock-toggle]'); pg.wait_for_timeout(250)
def texts(pg): return pg.evaluate("() => [...document.querySelectorAll('#chatlog .cm')].map(e => e.textContent).join('|')")
def check(c, m):
    if not c: errs.append(m)
import random; sfx = str(random.randint(1000, 99999))
with sync_playwright() as p:
    b = p.chromium.launch()
    def page(w, h, tag, name, house):
        c = b.new_context(viewport={'width': w, 'height': h}); c.route('**/fonts.g*/**', lambda r: r.abort()); c.add_init_script("if(!localStorage.getItem('arc_pref'))localStorage.setItem('arc_pref','{\"tutDone\":1,\"tutV\":{\"lecture\":1,\"explore\":1,\"lib\":1,\"exam\":1,\"world\":1,\"party\":1,\"guild\":1,\"friends\":1,\"board\":1,\"auction\":1,\"market\":1,\"gear\":1,\"work\":1,\"shop\":1,\"rec\":1}}')")   # 처음 안내·둘러보기는 따로 시험(e2e_onb)
        pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(f'[{tag}] {e}')); pg.goto(B); pg.wait_for_timeout(700)
        pg.click('[data-act=authtab][data-a=signup]'); pg.fill('#a-id', 'u' + __import__('hashlib').md5((name).encode()).hexdigest()[:10]); pg.fill('#a-name', name); pg.fill('#a-pw', 'secret123'); pg.fill('#a-pw2', 'secret123'); pg.fill('#a-code', invite())
        pg.click(f'[data-act=ihouse][data-a={house}]'); pg.click('[data-act=icls][data-a=mage]'); pg.click('[data-act=auth-go]'); pg.wait_for_timeout(900); [ (pg.evaluate("()=>document.querySelectorAll('.mbox [data-act=modal-close]').forEach(c=>c.click())"), pg.wait_for_timeout(300)) for _ in range(3) ]; pg.wait_for_timeout(300)
        return pg
    A = page(1440, 900, 'A', '회장' + sfx, 'lanterna'); M = page(1100, 850, 'M', '부원' + sfx, 'corona')
    for w in (1440, 1100, 390):
        A.set_viewport_size({'width': w, 'height': 860}); A.wait_for_timeout(300)
        hh = A.evaluate("() => document.querySelector('header, .top, #top').getBoundingClientRect().height")
        ow = A.evaluate('() => document.documentElement.scrollWidth - window.innerWidth')
        A.screenshot(path=f'{OUT}/g-head-{w}.png'); print('header', w, round(hh), 'overflow', ow)
        check(ow <= 1, f'header overflow {w}')
    A.set_viewport_size({'width': 1440, 'height': 900})
    # A: 동아리 만들기 (신청 후 승인)
    nav(A, 'guild'); A.fill('#gc-name', '달빛' + sfx); A.fill('#gc-intro', '밤마다 별을 봅니다'); A.check('input[name=gc-mode][value=apply]'); A.click('[data-act=gcreate]'); A.wait_for_timeout(900)
    check(A.evaluate("() => !!(window.__S.guild)"), 'A has no guild after create')
    A.screenshot(path=f'{OUT}/g-A-guild.png', full_page=True)
    # M: 찾아서 신청
    nav(M, 'guild'); M.fill('#gq', '달빛' + sfx); M.click('[data-act=gsearch]'); M.wait_for_timeout(600)
    M.click('[data-act=gjoin]'); M.wait_for_timeout(700)   # 먼저 동아리 정보 창
    check(M.query_selector('#gpeek') is not None and '밤마다 별을 봅니다' in M.inner_text('#gpeek'), 'guild peek missing intro')
    M.screenshot(path=f'{OUT}/g-M-peek.png')
    M.fill('#gp-msg', '안녕하세요'); M.click('[data-act=gjoingo]'); M.wait_for_timeout(700)
    check(M.query_selector('[data-act=gop][data-a=cancelApp]') is not None, 'M apply not shown')
    # A: 승인
    nav(A, 'home'); nav(A, 'guild'); A.wait_for_timeout(500)
    A.evaluate("() => __ACT.gtab('admin')"); A.wait_for_timeout(300)
    A.click('[data-act=gop][data-a=accept]'); A.wait_for_timeout(900)
    M.wait_for_timeout(800); check(M.evaluate("() => !!window.__S.guild"), 'M not in guild after accept')
    # 정보 카드: 동아리 이름 · 직책 · 버튼들
    aid = A.evaluate("() => __S.P.id")
    M.evaluate("(id) => __ACT.prof(id)", aid); M.wait_for_timeout(900)
    card = M.inner_text('#modal')
    check('달빛' + sfx in card and '회장' in card, 'profile card has no guild/rank: ' + card[:200])
    for lb in ['친구 추가', '1:1 대화', '파티 초대']: check(lb in card, 'profile card missing ' + lb)
    M.screenshot(path=f'{OUT}/g-M-profile.png'); M.evaluate("() => __ACT['modal-close']()")
    # 출석 · 동아리 정보 버튼
    nav(M, 'guild'); M.wait_for_timeout(500); M.click('[data-act=gop][data-a=checkin]'); M.wait_for_timeout(800)
    check(M.evaluate("() => __S.gd && __S.gd.my.checkin"), 'checkin failed')
    nav(A, 'home'); nav(A, 'guild'); A.wait_for_timeout(500)
    # 회장 해체 · 탈퇴 조건은 하단 버튼을 누르면 확인 창으로 안내한다 (부원이 있으면 해체 불가 · 회장은 넘긴 뒤 탈퇴)
    check(A.query_selector('.gfoot [data-act=gdisband]') is not None and A.query_selector('.gfoot [data-act=gquit]') is not None, 'owner footer buttons missing')
    A.click('.gfoot [data-act=gdisband]'); A.wait_for_timeout(300)
    check('다른 부원이 없어야' in A.inner_text('#modal') and A.query_selector('#modal [data-act=gdisbandgo]') is None, 'disband rule not shown')
    A.evaluate("() => __ACT['modal-close']()"); A.wait_for_timeout(200)
    A.click('.gfoot [data-act=gquit]'); A.wait_for_timeout(300)
    check('회장을 넘긴 뒤' in A.inner_text('#modal'), 'owner quit rule not shown')
    A.evaluate("() => __ACT['modal-close']()"); A.wait_for_timeout(200)
    # 채팅: RP / 오너
    dock(A); dock(M)
    A.click('[data-act=chattab][data-a=guild]'); A.wait_for_timeout(300)
    check(A.query_selector('.gsub') is not None, 'no guild subtabs')
    A.fill('#chatinput', '오늘 밤 관측 시작한다. *망원경을 편다*'); A.keyboard.press('Enter'); A.wait_for_timeout(800)
    A.click('.gsub [data-act=chattab][data-a=gooc]'); A.fill('#chatinput', '오너: 저 11시쯤 나가요'); A.keyboard.press('Enter'); A.wait_for_timeout(800)
    badge = M.evaluate("() => (document.querySelector('[data-unread=guild]')||{}).textContent || ''"); print('M guild badge', badge)
    M.click('[data-act=chattab][data-a=guild]'); M.wait_for_timeout(400)
    M.click('.gsub [data-act=chattab][data-a=grp]'); M.wait_for_timeout(300); t1 = texts(M)
    M.click('.gsub [data-act=chattab][data-a=gooc]'); M.wait_for_timeout(300); t2 = texts(M)
    check('망원경' in t1 and '11시' not in t1, 'grp content wrong: ' + t1[-200:])
    check('11시' in t2 and '망원경' not in t2, 'gooc content wrong: ' + t2[-200:])
    M.fill('#chatinput', '네 수고하세요'); M.keyboard.press('Enter'); M.wait_for_timeout(800)
    check('수고하세요' in texts(A), 'A did not get M gooc')
    M.screenshot(path=f'{OUT}/g-M-gooc.png')
    # 칭호 도감
    nav(A, 'rec'); A.evaluate("() => __ACT.nav('rec')"); A.wait_for_timeout(200)
    A.evaluate("() => { const b=document.querySelector('[data-act=gtab][data-a=titles], [data-a=titles]'); b && b.click(); }"); A.wait_for_timeout(400)
    ok = A.query_selector('.ttlcard:not(.locked) [data-act=titleset]')
    check(ok is not None, 'no equippable title')
    if ok:
        ok.click(); A.wait_for_timeout(700); check(A.evaluate("() => !!window.__S.P.title"), 'title not equipped')
        A.screenshot(path=f'{OUT}/g-A-titles.png', full_page=True)
        A.click('.tcur [data-act=titleset]'); A.wait_for_timeout(700); check(not A.evaluate("() => window.__S.P.title"), 'title not removed')
    # 설정
    A.click('[data-act=settings]'); A.wait_for_timeout(400)
    check(A.query_selector('#setbox, .setsec') is not None, 'settings not open')
    A.screenshot(path=f'{OUT}/g-A-settings.png', full_page=True)
    A.click('[data-act=modal-close]')
    # 정령 병: 채팅창 넓게
    A.evaluate("() => { document.documentElement.style.setProperty('--dockw','620px'); }"); nav(A, 'home'); A.wait_for_timeout(400)
    A.screenshot(path=f'{OUT}/g-A-jar-wide.png', full_page=True)
    b.close()
print('\n'.join(errs) if errs else 'NO ERRORS')
