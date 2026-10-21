# 장비 일괄 판매 · 분해 버튼 시험: 등급별 장비를 우편으로 받아 두고, 버튼마다 그 등급 이하만 (잠금 · 프리셋 제외) 처분되는지,
# 영웅 이상 · 강화 장비가 있으면 「다시 보지 않기」를 켜 두어도 확인 창이 뜨는지 본다. (시험 서버 필요: tools/srv.sh start e 8098 ...)
import os, json, time, hashlib, subprocess, urllib.request
from playwright.sync_api import sync_playwright
B = os.environ.get('BASE', 'http://127.0.0.1:8098'); TOK = 'test-admin-token-0123456789abcdef'; errs = []
ROOT = os.path.join(os.path.dirname(__file__), '..')
def admin(path, body):
    r = urllib.request.Request(B + path, data=json.dumps(body).encode(), headers={'content-type': 'application/json', 'x-admin-token': TOK})
    return json.loads(urllib.request.urlopen(r).read())
# 등급 0~4 × 2개, 그중 희귀 1개는 +3 강화 (Lv 1이라 착용 가능)
items = json.loads(subprocess.check_output(['node', '-e', """
const R=require('./shared/rules.js');const P=R.newPlayer('t','t','corona',1,7);const out=[];
for(let r=0;r<5;r++)for(let k=0;k<2;k++){const it=R.makeItem(P,['robe','charm'][k],1,r,r);delete it.u;delete it.lock;if(r===2&&k===1)it.enh=3;out.push(it);}
console.log(JSON.stringify(out));"""], cwd=ROOT))
def counts(pg): return pg.evaluate("() => { const c=[0,0,0,0,0]; window.__S.P.inv.forEach(it=>c[it.r]++); return c; }")
with sync_playwright() as p:
    b = p.chromium.launch(); c = b.new_context(viewport={'width': 1280, 'height': 900}); c.route('**/fonts.g*/**', lambda r: r.abort())
    c.add_init_script("if(!localStorage.getItem('arc_pref'))localStorage.setItem('arc_pref','{\"tutDone\":1,\"tutV\":{\"gear\":1,\"lecture\":1,\"explore\":1}}')")
    pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.goto(B); pg.wait_for_timeout(700)
    nm = ('일괄' + str(int(time.time()) % 100000))[:12]
    inv = admin('/api/admin/invites', {'count': 1})['codes'][0]
    pg.click('[data-act=authtab][data-a=signup]'); pg.fill('#a-id', 'u' + hashlib.md5(nm.encode()).hexdigest()[:10]); pg.fill('#a-name', nm); pg.fill('#a-pw', 'secret123'); pg.fill('#a-pw2', 'secret123'); pg.fill('#a-code', inv)
    pg.click('[data-act=ihouse][data-a=corona]'); pg.click('[data-act=icls][data-a=mage]'); pg.click('[data-act=auth-go]'); pg.wait_for_timeout(900)
    for _ in range(4): pg.evaluate("()=>document.querySelectorAll('.mbox [data-act=modal-close]').forEach(c=>c.click())"); pg.wait_for_timeout(250)
    pg.evaluate("() => window.__ACT.opt('autoEquip', null, {checked:false})"); pg.wait_for_timeout(400)
    def refill():
        admin('/api/admin/mail', {'to': nm, 'title': '시험 장비', 'body': '시험', 'days': 1, 'rewards': {'items': items}})
        pg.evaluate("() => window.__API.mailOp({op:'claimAll'})"); pg.wait_for_timeout(500)
        pg.evaluate("() => window.__ACT.nav('home')"); pg.reload(); pg.wait_for_timeout(1200)
        for _ in range(3): pg.evaluate("()=>document.querySelectorAll('.mbox [data-act=modal-close], [data-act=inbox-ok]').forEach(c=>c.click())"); pg.wait_for_timeout(250)
        pg.evaluate("() => window.__ACT.nav('gear')"); pg.wait_for_timeout(400)
    for kind in ['dismantleBelow', 'sellBelow']:
        for r in range(4):
            refill(); before = counts(pg)
            # 희귀 하나 잠그기 (제외되어야 함)
            pg.evaluate("() => { const it = window.__S.P.inv.find(x => x.r === 2 && !x.enh); window.__lockU = it.u; return window.__ACT['do']('lock', it.u); }"); pg.wait_for_timeout(400)
            pg.click(f'[data-act=bulkask][data-a={kind}][data-b="{r}"]'); pg.wait_for_timeout(300)
            if not pg.query_selector('#modal:not([hidden]) [data-act=bulkgo]'): errs.append(f'{kind} r{r}: 확인 창 없음'); continue
            pg.click('[data-act=bulkgo]'); pg.wait_for_timeout(600)
            after = counts(pg); locked_kept = pg.evaluate("() => window.__S.P.inv.some(x => x.u === window.__lockU)")
            for rr in range(5):
                exp = (1 if (rr == 2 and r >= 2) else 0) if rr <= r else before[rr]
                if after[rr] != exp: errs.append(f'{kind} r{r}: 등급 {rr} {before[rr]}→{after[rr]} (기대 {exp})')
            if not locked_kept: errs.append(f'{kind} r{r}: 잠근 장비가 처분됨')
            pg.evaluate("() => { const it = window.__S.P.inv.find(x => x.u === window.__lockU); return it && window.__ACT['do']('lock', it.u); }"); pg.wait_for_timeout(300)
            # 남은 것 정리
            pg.evaluate("() => window.__API.act ? 0 : 0")
            pg.evaluate("() => window.__S.P.inv.slice().forEach(it => { if (it.lock) window.__ACT['do']('lock', it.u); })"); pg.wait_for_timeout(300)
            pg.evaluate("() => window.__ACT['do']('sellBelow', 4)"); pg.wait_for_timeout(500)
    # 다시 보지 않기: 일반만 있으면 바로 실행, 영웅 · 강화가 있으면 그래도 확인 창
    pg.evaluate("() => window.__ACT.opt('bulkAsk', null, {checked:false})"); pg.wait_for_timeout(400)
    refill(); pg.click('[data-act=bulkask][data-a=dismantleBelow][data-b="0"]'); pg.wait_for_timeout(500)
    if pg.query_selector('#modal:not([hidden]) [data-act=bulkgo]'): errs.append('다시 보지 않기: 일반 이하인데 확인 창이 뜸')
    if counts(pg)[0] != 0: errs.append('다시 보지 않기: 일반 이하 분해 안 됨')
    pg.click('[data-act=bulkask][data-a=dismantleBelow][data-b="3"]'); pg.wait_for_timeout(300)
    if not pg.query_selector('#modal:not([hidden]) [data-act=bulkgo]'): errs.append('다시 보지 않기: 영웅 · 강화 포함인데 확인 창이 안 뜸')
    elif not pg.query_selector('#modal:not([hidden]) .bad'): errs.append('경고 문구 없음')
    pg.screenshot(path=os.path.join(os.path.dirname(__file__), 'shots', 'bulk-risky.png'))
    # 한 개 분해: 전설 장비는 한 번 더 눌러야 분해, 일반은 바로
    pg.evaluate("()=>document.querySelectorAll('.mbox [data-act=modal-close]').forEach(c=>c.click())"); pg.wait_for_timeout(300)
    lu = pg.evaluate("() => { const it = window.__S.P.inv.find(x => x.r === 4); return it && it.u; }")
    if not lu: errs.append('전설 장비 없음')
    else:
        pg.evaluate(f"() => window.__ACT.sel('{lu}')"); pg.wait_for_timeout(400)
        pg.evaluate("() => document.querySelector('[data-act=itemarm][data-a=dismantle]').click()"); pg.wait_for_timeout(300)
        if not pg.evaluate(f"() => window.__S.P.inv.some(x => x.u === '{lu}')"): errs.append('전설 장비가 경고 없이 분해됨')
        if not pg.query_selector('#modal:not([hidden]) [data-act=itemgo]'): errs.append('전설 장비 분해 경고 창이 안 뜸')
        pg.screenshot(path=os.path.join(os.path.dirname(__file__), 'shots', 'item-warn.png'))
        pg.click('[data-act=itemgo]'); pg.wait_for_timeout(500)
        if pg.evaluate(f"() => window.__S.P.inv.some(x => x.u === '{lu}')"): errs.append('경고 창에서 분해를 눌러도 분해 안 됨')
    b.close()
print('\n'.join(errs) if errs else 'NO ERRORS')
