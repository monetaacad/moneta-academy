# 두 브라우저가 실시간으로 대화하는지: 초대 가입생 A(데스크톱), G(모바일). 게스트 입학은 없어졌다.
import os, json, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
B = os.environ.get('BASE', 'http://127.0.0.1:8098'); OUT = os.path.join(os.path.dirname(__file__), 'shots'); errs = []
def invite():
    r = urllib.request.Request(B + '/api/admin/invites', data=json.dumps({'count': 1}).encode(), headers={'content-type': 'application/json', 'x-admin-token': 'test-admin-token-0123456789abcdef'})
    return json.loads(urllib.request.urlopen(r).read())['codes'][0]
def admin(path):
    return json.loads(urllib.request.urlopen(urllib.request.Request(B + path, headers={'x-admin-token': 'test-admin-token-0123456789abcdef'})).read())
def nav(pg, v): pg.evaluate(f"() => __ACT.nav('{v}')"); pg.wait_for_timeout(250)
def dock(pg):
    if pg.evaluate("() => document.querySelector('#chatdock').classList.contains('closed')"): pg.click('#chatdock [data-act=dock-toggle]'); pg.wait_for_timeout(250)
def texts(pg): return pg.evaluate("() => [...document.querySelectorAll('#chatlog .cm')].map(e => e.textContent)")
sfx = str(int(time.time()) % 10000)
with sync_playwright() as p:
    b = p.chromium.launch()
    def page(w, h, tag, mob=False):
        c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mob, has_touch=mob); c.route('**/fonts.g*/**', lambda r: r.abort()); c.add_init_script("if(!localStorage.getItem('arc_pref'))localStorage.setItem('arc_pref','{\"tutDone\":1,\"tutV\":{\"lecture\":1,\"explore\":1,\"lib\":1,\"exam\":1,\"world\":1,\"party\":1,\"guild\":1,\"friends\":1,\"board\":1,\"auction\":1,\"market\":1,\"gear\":1,\"work\":1,\"shop\":1,\"rec\":1}}')")   # 처음 안내·둘러보기는 따로 시험(e2e_onb)
        pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(f'[{tag}] {e}')); pg.goto(B); pg.wait_for_timeout(700); return pg
    A = page(1280, 900, 'A'); G = page(390, 844, 'G', True)
    # A: 초대코드 가입
    A.click('[data-act=authtab][data-a=signup]'); A.fill('#a-id', 'u' + __import__('hashlib').md5(('에이' + sfx).encode()).hexdigest()[:10]); A.fill('#a-name', '에이' + sfx); A.fill('#a-pw', 'secret123'); A.fill('#a-pw2', 'secret123'); A.fill('#a-code', invite().lower())
    A.click('[data-act=ihouse][data-a=lanterna]'); A.click('[data-act=icls][data-a=mage]'); A.click('[data-act=auth-go]'); A.wait_for_timeout(800); [ (A.evaluate("()=>document.querySelectorAll('.mbox [data-act=modal-close]').forEach(c=>c.click())"), A.wait_for_timeout(300)) for _ in range(3) ]
    # G: 모바일에서 초대코드 가입 (게스트 탭이 없어야 한다)
    G.screenshot(path=f'{OUT}/chat-G-0-login.png', full_page=True)
    if G.query_selector('[data-act=authtab][data-a=guest]'): errs.append('guest tab still shown')
    G.click('[data-act=authtab][data-a=signup]'); G.fill('#a-id', 'u' + __import__('hashlib').md5(('손님' + sfx).encode()).hexdigest()[:10]); G.fill('#a-name', '손님' + sfx); G.fill('#a-pw', 'guestpw1'); G.fill('#a-pw2', 'guestpw1'); G.fill('#a-code', invite()); G.click('[data-act=ihouse][data-a=speculum]'); G.click('[data-act=icls][data-a=mage]')
    G.click('[data-act=auth-go]'); G.wait_for_timeout(800); [ (G.evaluate("()=>document.querySelectorAll('.mbox [data-act=modal-close]').forEach(c=>c.click())"), G.wait_for_timeout(300)) for _ in range(3) ]
    try:
        urllib.request.urlopen(urllib.request.Request(B + '/api/guest', data=b'{"name":"xx12","house":"lanterna"}', headers={'content-type': 'application/json'})); errs.append('/api/guest still open')
    except urllib.error.HTTPError as e:
        if e.code != 404: errs.append(f'/api/guest returned {e.code}')
    # 둘 다 채팅으로
    dock(A); dock(G); A.click('[data-act=chattab][data-a=world]'); G.click('[data-act=chattab][data-a=world]'); A.wait_for_timeout(600)
    A.fill('#chatinput', '안녕하세요 <script>alert(1)</script>'); A.keyboard.press('Enter'); A.wait_for_timeout(700)
    t = texts(G)
    if not any('<script>alert(1)</script>' in x for x in t): errs.append('G did not receive A message (or it was not escaped as text): ' + str(t[-2:]))
    G.fill('#chatinput', '반가워요!'); G.click('[data-act=chatsend]'); G.wait_for_timeout(700)
    if not any('반가워요' in x for x in texts(A)): errs.append('A did not receive G message')
    # RP 탭: 행동, 안 읽음 배지
    nav(A, 'lecture'); G.click('[data-act=chattab][data-a=rp]'); G.fill('#chatinput', '오늘은 별이 밝네. *지팡이를 들어 별빛을 모은다*'); G.keyboard.press('Enter'); G.wait_for_timeout(2700)   # 안 보는 탭은 2초마다 오는 글 번호(seq)로 센다
    badge = A.evaluate("() => { const e = document.querySelector('[data-unread=rp]'); return e && !e.hidden ? e.textContent : '' }")
    if badge != '1': errs.append(f'unread badge on A expected 1, got {badge!r}')
    if not A.query_selector('#chatinput'): errs.append('chat dock not visible on lecture view')
    A.click('[data-act=chattab][data-a=rp]'); A.wait_for_timeout(300)
    if not A.query_selector('#chatlog .cm .cb i.act'): errs.append('RP mixed action missing on A')
    A.fill('#chatinput', '/me 고개를 끄덕인다'); A.keyboard.press('Enter'); A.wait_for_timeout(600)
    if len(G.query_selector_all('#chatlog .cm i.act')) < 2: errs.append('/me not converted to action')
    A.screenshot(path=f'{OUT}/chat-A-rp.png', full_page=True); G.screenshot(path=f'{OUT}/chat-G-rp.png', full_page=True)
    # 도배 제한 메시지
    for i in range(6): A.fill('#chatinput', f'빠르게 {i}'); A.keyboard.press('Enter'); A.wait_for_timeout(60)
    A.wait_for_timeout(400)
    if not any(w in A.evaluate("() => document.querySelector('#chatmsg').textContent") for w in ('빨리', '잦은')): errs.append('rate limit message not shown')
    # 신고 · 가리기 (G가 A를)
    G.click('[data-act=chattab][data-a=world]'); G.wait_for_timeout(300)
    G.locator('#chatlog .cm .cn', has_text='에이' + sfx).last.click(); G.wait_for_timeout(300); G.screenshot(path=f'{OUT}/chat-G-menu.png')
    G.click('[data-act=creportform]'); G.wait_for_timeout(300); G.fill('#crp-reason', '도배 시험 사유'); G.screenshot(path=f'{OUT}/chat-G-report.png')
    G.click('[data-act=creport]'); G.wait_for_timeout(500)
    reps = admin('/api/admin/reports')['reports']
    if not reps: errs.append('report not recorded')
    elif reps[0].get('reason') != '도배 시험 사유': errs.append('report reason not saved: ' + repr(reps[0].get('reason')))
    else:
        ctx = admin('/api/admin/reports/ctx?id=' + str(reps[0]['msg_id']))
        if not any(m['me'] for m in ctx['list']) or len(ctx['list']) < 3: errs.append('report ctx wrong: ' + str(ctx)[:200])
    G.locator('#chatlog .cm .cn', has_text='에이' + sfx).last.click(); G.wait_for_timeout(300); G.click('[data-act=cblock]'); G.wait_for_timeout(300)
    if any(('에이' + sfx) in x for x in texts(G)): errs.append('blocked user still visible')
    # 운영진 1:1: 운영실이 신고자(G)에게 보냄 → G가 1:1 목록에서 열고 답장 → 운영실에서 답장 확인
    if reps:
        rq = urllib.request.Request(B + '/api/admin/dm', data=json.dumps({'pid': reps[0]['reporter_id'], 'text': '신고를 확인했습니다.'}).encode(), headers={'content-type': 'application/json', 'x-admin-token': 'test-admin-token-0123456789abcdef'})
        json.loads(urllib.request.urlopen(rq).read()); G.wait_for_timeout(800)
        G.click('[data-act=chattab][data-a=dm]'); G.wait_for_timeout(600)
        G.locator('[data-act=dmopen][data-a=staff]').first.click(); G.wait_for_timeout(700)
        if not G.query_selector('.dmm .dmb'): errs.append('staff dm not shown to student')
        G.fill('#chatinput', '감사합니다'); G.keyboard.press('Enter'); G.wait_for_timeout(700); G.screenshot(path=f'{OUT}/chat-G-staffdm.png')
        th = admin('/api/admin/dm/threads')['threads']
        if not th or th[0]['from'] == 'staff' or th[0]['text'] != '감사합니다': errs.append('student reply not visible to staff: ' + str(th)[:200])
        G.click('[data-act=dmback]'); G.wait_for_timeout(200); G.click('[data-act=chattab][data-a=world]'); G.wait_for_timeout(300)
    # 새로고침 후 기록 유지
    A.reload(); A.wait_for_timeout(900); dock(A); A.click('[data-act=chattab][data-a=world]'); A.wait_for_timeout(500)
    if not any('반가워요' in x for x in texts(A)): errs.append('history missing after reload')
    # 다른 기기에서 같은 계정으로 로그인
    C = page(1280, 900, 'C'); C.fill('#a-id', 'u' + __import__('hashlib').md5(('손님' + sfx).encode()).hexdigest()[:10]); C.fill('#a-pw', 'guestpw1'); C.click('[data-act=auth-go]'); C.wait_for_timeout(900)
    if not C.query_selector('#nav'): errs.append('G could not log in elsewhere')
    for pg, tag in [(A, 'A'), (G, 'G')]:
        ow = pg.evaluate('() => document.documentElement.scrollWidth - window.innerWidth')
        if ow > 1: errs.append(f'[{tag}] overflow {ow}')
    b.close()
print('\n'.join(errs) if errs else 'NO ERRORS')
