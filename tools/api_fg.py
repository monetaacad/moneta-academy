# 텃밭 · 낚시 (2차 베타) API 시험: 숨긴 값이 새지 않는지, 챔질 시각을 서버가 확인하는지, 기능을 끈 서버가 거절하는지.
# 시험 서버(FEATURE_FG=1) 필요: sh tools/srv.sh start e 8098 TIME_SCALE=60 TEST_MODE=1 ADMIN_TOKEN=test-admin-token-0123456789abcdef FEATURE_FG=1
# BASE_OFF(기능을 끈 서버)를 주면 거절도 본다.
import os, json, time, secrets, urllib.request, http.cookiejar
B = os.environ.get('BASE', 'http://127.0.0.1:8098'); OFF = os.environ.get('BASE_OFF', ''); TOK = 'test-admin-token-0123456789abcdef'; errs = []
def invite(base):
    r = urllib.request.Request(base + '/api/admin/invites', data=json.dumps({'count': 1}).encode(), headers={'content-type': 'application/json', 'x-admin-token': TOK})
    return json.loads(urllib.request.urlopen(r).read())['codes'][0]
class U:
    def __init__(s, base): s.b = base; s.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def req(s, m, path, body=None):
        r = urllib.request.Request(s.b + path, method=m, data=json.dumps(body).encode() if body is not None else None, headers={'content-type': 'application/json'})
        try: return json.loads(s.op.open(r).read())
        except urllib.error.HTTPError as e: return json.loads(e.read() or b'{}') | {'_status': e.code}
    def act(s, t, a=None): time.sleep(1.1); return s.req('POST', '/api/act', {'type': t, 'a': a or {}})
def new(base, tag):
    u = U(base); r = u.req('POST', '/api/register', {'login': 'u' + secrets.token_hex(6), 'name': (tag + secrets.token_hex(3))[:12], 'password': 'secret123', 'house': 'speculum', 'invite': invite(base), 'cls': 'mage'})
    if r.get('error'): errs.append('가입 ' + r['error'])
    return u
u = new(B, '낚시')
st = u.req('GET', '/api/state')
if st.get('fg') != 1: errs.append('state에 fg 없음')
# 손낚시: 던진 결과(무엇이 걸렸는지)는 보내지 않는다
r = u.act('fshCast', {'spot': 'pond'})
if r.get('error'): errs.append('cast ' + r['error'])
c = (r.get('P') or {}).get('fsh', {}).get('cast') or {}
if 'k' in c or 'ms' in c: errs.append('cast 숨김 값이 보임: ' + json.dumps(c))
# 입질 전에 바로 당기면(반응 시간을 거짓으로 보내도) 실패
r = u.act('fshReel', {'rt': 100})
if r.get('r', {}).get('res') != 'late' or r['r'].get('got'): errs.append('즉시 챔질이 통과됨: ' + json.dumps(r.get('r')))
# 제대로: 입질 시각까지 기다렸다가
r = u.act('fshCast', {'spot': 'pond'}); d = r['r']['d']; time.sleep(d / 1000 + 0.25)
r = u.req('POST', '/api/act', {'type': 'fshReel', 'a': {'rt': 200}})
if r.get('r', {}).get('res') not in ('ok', 'perfect'): errs.append('정상 챔질 실패: ' + json.dumps(r.get('r') or r.get('error')))
# 너무 늦게
r = u.act('fshCast', {'spot': 'pond'}); d = r['r']['d']; time.sleep(d / 1000 + r['r']['win'] / 1000 + 2.2)
r = u.req('POST', '/api/act', {'type': 'fshReel', 'a': {'rt': 300}})
if r.get('r', {}).get('res') != 'late': errs.append('늦은 챔질이 통과됨: ' + json.dumps(r.get('r')))
# 잠긴 낚시터 · 없는 미끼
r = u.act('fshCast', {'spot': 'abyss'})
if not r.get('error'): errs.append('잠긴 낚시터에서 던짐')
# 찌 낚시: 아직 낚지 않은 것은 시각만
r = u.act('fshSet', {'spot': 'pond', 'd': '4h'})
j = (r.get('P') or {}).get('fsh', {}).get('job') or {}
fut = [k for k in j.get('c', []) if set(k.keys()) != {'at'}]
if not j.get('c') or fut: errs.append('찌 낚시 미래 결과가 보임 %d' % len(fut))
r = u.act('fshSet', {'spot': 'pond', 'd': '1h'})
if not r.get('error'): errs.append('찌 낚시 두 번 맡김')
r = u.act('fshClaim')
if r.get('error') or not r['r'].get('early'): errs.append('일찍 걷기 ' + str(r.get('error')))
# 텃밭: 자라는 작물의 변이 주사위(u)는 보내지 않는다
r = u.act('gdPlant', {'i': 0, 's': 'pansy'})
pl = (r.get('P') or {}).get('gdn', {}).get('plots', [None])[0] or {}
if 'u' in pl: errs.append('자라는 작물의 u가 보임')
if not u.act('gdPlant', {'i': 2, 's': 'pansy'}).get('error'): errs.append('잠긴 밭에 심어짐')
if not u.act('gdPlant', {'i': 1, 's': 'blackrose'}).get('error'): errs.append('없는 씨앗을 심음')
if not u.act('gdHarvest', {'i': 0}).get('error'): errs.append('덜 자란 작물이 수확됨')
r = u.act('gdBuy', {'id': 'green'})
if not r.get('error'): errs.append('별조각 없이 온실 꾸러미 구매')
if not u.act('lzSell', {'k': 'crop', 'id': 'pansy', 'n': 5}).get('error'): errs.append('없는 작물 판매')
if not u.act('lzBait', {'id': 'star', 'n': 1}).get('error'): errs.append('재료 없이 별빛 미끼')
# 오늘의 주문: 하루 동안 고정, 수량이 모자라면 거절, 두 번 납품 불가
st = u.req('GET', '/api/state'); lzo = st['P'].get('lzo') or {}
if not lzo.get('o'): errs.append('오늘의 주문이 없음')
else:
    fo = [o for o in lzo['o'] if o['k'] == 'fish'][0]
    have = st['P']['fsh']['bag'].get(fo['id'], 0)
    r = u.act('lzOrder', {'k': 'fish'})
    if have < fo['n'] and not r.get('error'): errs.append('수량이 모자란데 납품됨')
    st2 = u.req('GET', '/api/state')
    if st2['P']['lzo']['o'] != lzo['o']: errs.append('주문이 하루 중에 바뀜')
    # 시험용: 운영실 우편 없이 직접 잡을 수 없으니 상태만 확인
if OFF:
    v = new(OFF, '끔')
    if v.req('GET', '/api/state').get('fg'): errs.append('기능을 끈 서버가 fg=1')
    for t, a in [('gdPlant', {'i': 0, 's': 'pansy'}), ('fshCast', {'spot': 'pond'}), ('fshSet', {'spot': 'pond', 'd': '1h'})]:
        r = v.act(t, a)
        if '준비 중' not in (r.get('error') or ''): errs.append('기능을 끈 서버가 ' + t + ' 받음: ' + json.dumps(r.get('error')))
        if (r.get('P') or {}).get('gdn') or (r.get('P') or {}).get('fsh'): errs.append('기능을 끈 서버에 상태가 생김 ' + t)
print('NO ERRORS' if not errs else 'ERRORS:\n' + '\n'.join(errs))
