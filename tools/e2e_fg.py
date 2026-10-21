# 텃밭 · 낚시터 (2차 베타) 화면 시험: 심기 → 물 주기 → 수확, 손낚시(입질에 맞춰 챔질), 찌 낚시 → 그물 걷기, 도감 화면.
# 시험 서버 필요: sh tools/srv.sh start e 8098 TIME_SCALE=60 TEST_MODE=1 ADMIN_TOKEN=test-admin-token-0123456789abcdef ADMIN_NAMES=운영자 FEATURE_FG=1
# 기능을 끈 서버(BASE_OFF, 기본 없음)를 주면 탭이 숨고 행동이 거절되는지도 본다. SHOT=폴더 를 주면 화면을 저장한다.
import os, json, time, hashlib, urllib.request
from playwright.sync_api import sync_playwright
B = os.environ.get('BASE', 'http://127.0.0.1:8098'); OFF = os.environ.get('BASE_OFF', ''); TOK = 'test-admin-token-0123456789abcdef'; SHOT = os.environ.get('SHOT', ''); errs = []
def admin(base, path, body):
    r = urllib.request.Request(base + path, data=json.dumps(body).encode(), headers={'content-type': 'application/json', 'x-admin-token': TOK})
    return json.loads(urllib.request.urlopen(r).read())
def shot(pg, name):
    if SHOT: os.makedirs(SHOT, exist_ok=True); pg.screenshot(path=os.path.join(SHOT, name + '.png'), full_page=False)
def signup(c, base, tag):
    pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(tag + ' pageerror: ' + str(e))); pg.goto(base); pg.wait_for_timeout(700)
    nm = (tag + str(int(time.time() * 10) % 100000))[:12]
    inv = admin(base, '/api/admin/invites', {'count': 1})['codes'][0]
    pg.click('[data-act=authtab][data-a=signup]'); pg.fill('#a-id', 'u' + hashlib.md5(nm.encode()).hexdigest()[:10]); pg.fill('#a-name', nm); pg.fill('#a-pw', 'secret123'); pg.fill('#a-pw2', 'secret123'); pg.fill('#a-code', inv)
    pg.click('[data-act=ihouse][data-a=clepsydra]'); pg.click('[data-act=icls][data-a=mage]'); pg.click('[data-act=auth-go]'); pg.wait_for_timeout(1000)
    for _ in range(4): pg.evaluate("()=>document.querySelectorAll('.mbox [data-act=modal-close], [data-act=inbox-ok]').forEach(c=>c.click())"); pg.wait_for_timeout(250)
    return pg
def close(pg):
    for _ in range(3): pg.evaluate("()=>document.querySelectorAll('.mbox [data-act=modal-close], [data-act=inbox-ok]').forEach(c=>c.click())"); pg.wait_for_timeout(200)
with sync_playwright() as p:
    b = p.chromium.launch()
    c = b.new_context(viewport={'width': 1280, 'height': 900}); c.route('**/fonts.g*/**', lambda r: r.abort())
    c.add_init_script("if(!localStorage.getItem('arc_pref'))localStorage.setItem('arc_pref','{\"tutDone\":1,\"tutV\":{\"gear\":1,\"lecture\":1,\"explore\":1}}')")
    pg = signup(c, B, '텃밭')
    if not pg.query_selector('.gtabs [data-a=garden]'): errs.append('광장에 텃밭 탭 없음')
    # ── 텃밭: 0 · 1번 칸에 팬지 · 튤립(교배 짝), 3 · 4번에 박하 · 블루베리
    pg.click('.gtabs [data-a=garden]'); pg.wait_for_timeout(400)
    if pg.locator('.gdcell').count() != 9: errs.append('밭 칸 수 %d' % pg.locator('.gdcell').count())
    for i, s in [(0, 'pansy'), (1, 'tulip'), (3, 'mint'), (4, 'blueberry')]:
        pg.click(f'.gdcell.empty[data-a="{i}"]'); pg.wait_for_timeout(250)
        if not pg.query_selector(f'#modal:not([hidden]) [data-act=gdplant][data-b={s}]'): errs.append('심기 창에 ' + s + ' 없음'); close(pg); continue
        if i == 1 and '교배' not in pg.inner_text('#modal'): errs.append('튤립 심기 창에 교배 안내 없음')
        pg.click(f'#modal [data-act=gdplant][data-b={s}]'); pg.wait_for_timeout(400)
    if not pg.query_selector('.lzorder [data-act=lzorder], .lzorder .tag.ok'): errs.append('텃밭에 오늘의 주문 없음')
    grow = pg.locator('.gdcell.grow').count()
    if grow != 4: errs.append('자라는 칸 %d' % grow)
    pg.click('[data-act=gdwater]'); pg.wait_for_timeout(400)
    if pg.locator('.gdic .wet').count() < 4: errs.append('물 준 표시 %d' % pg.locator('.gdic .wet').count())
    shot(pg, '01-garden-growing')
    # 시간 배율 60: 실제 1초 = 1분. 가장 긴 블루베리 50분 × 0.85 ≈ 43초
    for _ in range(60):
        pg.wait_for_timeout(1000)
        if pg.evaluate("() => (window.__S.P.gdn.plots.filter(p => p && p.end <= window.__S.base + (Date.now() / 1000 - window.__S.ref) * window.__S.scale).length)") >= 4: break
    pg.evaluate("() => window.__ACT.nav('garden')"); pg.wait_for_timeout(1500)
    shot(pg, '02-garden-ripe')
    pg.click('[data-act=gdharv][data-a="-1"]'); pg.wait_for_timeout(700)
    txt = pg.inner_text('#modal') if pg.query_selector('#modal:not([hidden])') else ''
    if '수확' not in txt or '새로 발견' not in txt: errs.append('수확 창 내용: ' + txt[:80])
    shot(pg, '03-harvest')
    close(pg)
    g = pg.evaluate("() => window.__S.P.gdn")
    if len(g['cdx']) < 4: errs.append('식물 도감 %d' % len(g['cdx']))
    pg.click('[data-act=lztab][data-b=plant]'); pg.wait_for_timeout(300); shot(pg, '04-plant-codex')
    if pg.locator('.cdx').count() != 62: errs.append('식물 도감 칸 %d' % pg.locator('.cdx').count())
    pg.click('[data-act=cdxplant][data-a=peony]'); pg.wait_for_timeout(250)
    if '노란 팬지 + 분홍 튤립' not in pg.inner_text('#modal'): errs.append('작약 얻는 법 안내: ' + pg.inner_text('#modal')[:120])
    close(pg)
    pg.click('[data-act=lztab][data-b=fairy]'); pg.wait_for_timeout(300); shot(pg, '05-fairy-codex')
    # ── 낚시터: 손낚시 3번 (입질 뜨면 바로 챔질)
    pg.click('.gtabs [data-a=fish]'); pg.wait_for_timeout(400)
    pg.evaluate("() => { const a = document.querySelector('[data-act=fxauto]'); if (a && a.checked) a.click(); }")
    caught = 0
    for k in range(3):
        pg.click('[data-act=fxcast]'); pg.wait_for_timeout(300)
        if k == 0: shot(pg, '06-fish-wait')
        for _ in range(100):
            if pg.evaluate("() => window.__S.fx.phase") == 'bite': break
            pg.wait_for_timeout(100)
        else: errs.append('입질이 오지 않음'); break
        if k == 0: shot(pg, '07-fish-bite')
        pg.wait_for_timeout(150); pg.click('[data-act=fxreel]'); pg.wait_for_timeout(700)
        if k == 0: shot(pg, '08-fish-catch')
        if pg.query_selector('.fxpop'): caught += 1
        for _ in range(30):
            if pg.evaluate("() => window.__S.fx.phase") == 'idle': break
            pg.wait_for_timeout(100)
    f = pg.evaluate("() => window.__S.P.fsh")
    if not pg.query_selector('.lzorder'): errs.append('낚시터에 오늘의 주문 없음')
    if f['n'] < 3: errs.append('손낚시로 낚은 수 %d' % f['n'])
    # 너무 일찍 당기기
    pg.wait_for_timeout(1800); pg.click('[data-act=fxcast]'); pg.wait_for_timeout(400); pg.click('[data-act=fxreel]'); pg.wait_for_timeout(700)
    if '너무 일찍' not in (pg.inner_text('.fxpop') if pg.query_selector('.fxpop') else ''): errs.append('일찍 당김 안내 없음')
    # 찌 낚시 1시간 (시간 배율 60 → 1분)
    pg.wait_for_timeout(1700); pg.click('[data-act=fxset][data-a="1h"]'); pg.wait_for_timeout(500)
    if not pg.evaluate("() => !!window.__S.P.fsh.job"): errs.append('찌 낚시 시작 안 됨')
    shot(pg, '09-fish-idle')
    pg.wait_for_timeout(63000); pg.evaluate("() => window.__ACT.nav('fish')"); pg.wait_for_timeout(1500)
    pg.click('[data-act=fxclaim]'); pg.wait_for_timeout(700)
    if '그물 걷기' not in (pg.inner_text('#modal') if pg.query_selector('#modal:not([hidden])') else ''): errs.append('그물 걷기 창 없음')
    shot(pg, '10-fish-claim'); close(pg)
    n1 = pg.evaluate("() => window.__S.P.fsh.n")
    if n1 < f['n'] + 1: errs.append('찌 낚시로 낚은 것이 없음 %d→%d' % (f['n'], n1))
    shot(pg, '11-fish-bag')
    pg.click('[data-act=lztab][data-b=fish]'); pg.wait_for_timeout(300); shot(pg, '12-fish-codex')
    pg.click('[data-act=lztab][data-b=rare]'); pg.wait_for_timeout(300); shot(pg, '13-rare-codex')
    if pg.locator('.rcard').count() != 30: errs.append('희귀 도감 칸 %d' % pg.locator('.rcard').count())
    # 모바일 폭
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(300)
    pg.click('[data-act=lztab][data-b=spot]'); pg.wait_for_timeout(300); shot(pg, '14-mobile-fish')
    ov = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
    if ov > 2: errs.append('모바일 가로 넘침 %dpx' % ov)
    pg.evaluate("() => window.__ACT.nav('garden')"); pg.wait_for_timeout(300); pg.click('[data-act=lztab][data-b=plot]'); pg.wait_for_timeout(300); shot(pg, '15-mobile-garden')
    ov = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
    if ov > 2: errs.append('모바일 가로 넘침(텃밭) %dpx' % ov)
    if OFF:
        c2 = b.new_context(viewport={'width': 1280, 'height': 900}); c2.route('**/fonts.g*/**', lambda r: r.abort())
        c2.add_init_script("if(!localStorage.getItem('arc_pref'))localStorage.setItem('arc_pref','{\"tutDone\":1}')")
        p2 = signup(c2, OFF, '끔')
        if p2.query_selector('.gtabs [data-a=garden]') or p2.query_selector('.gtabs'): errs.append('기능을 끈 서버에 탭이 보임')
        r = p2.evaluate("() => window.__API.act('gdPlant', {i: 0, s: 'pansy'})")
        if not r.get('error'): errs.append('기능을 끈 서버가 행동을 받음')
        p2.evaluate("() => window.__ACT.nav('fish')"); p2.wait_for_timeout(300)
        if p2.evaluate("() => window.__S.view") != 'home': errs.append('기능을 끈 서버에서 낚시터로 이동됨')
    b.close()
print('NO ERRORS' if not errs else 'ERRORS:\n' + '\n'.join(errs))
