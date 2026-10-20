# 거래소 학생 경매 시험: 등록 조건 · 입찰(맡기기 · 돌려받기) · 즉시 구매 · 취소 · 마감 연장 · 마감 정산
# 새 서버를 시간 배율 크게 켜서 (입학 24시간 조건을 넘기려고): sh tools/srv.sh start a 8097 TIME_SCALE=3600 TEST_MODE=1 ADMIN_TOKEN=test-admin-token-0123456789abcdef
# 마감 정산 · 마감 연장은 DB의 마감 시각을 직접 당겨서 본다 (DB = /tmp/arc-a/moneta.db)
import os, json, time, secrets, sqlite3, urllib.request, http.cookiejar
B = os.environ.get('BASE', 'http://127.0.0.1:8097'); DBF = os.environ.get('DB', '/tmp/arc-a/moneta.db'); TOK = 'test-admin-token-0123456789abcdef'; errs = []
def check(c, m):
    if not c: errs.append(m); print('FAIL', m)
def adm(path, body):
    r = urllib.request.Request(B + path, data=json.dumps(body).encode(), headers={'content-type': 'application/json', 'x-admin-token': TOK})
    return json.loads(urllib.request.urlopen(r).read())
class U:
    def __init__(s, name, house='lanterna'):
        s.o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())); s.name = name
        j = s.req('POST', '/api/register', {'login': 'u' + secrets.token_hex(6), 'name': name, 'password': 'secret1234', 'house': house, 'invite': adm('/api/admin/invites', {'count': 1})['codes'][0], 'cls': 'mage'})
        s.P = j.get('P')
    def req(s, m, path, body=None):
        time.sleep(1.1)   # 요청 속도 제한
        r = urllib.request.Request(B + path, method=m, data=json.dumps(body).encode() if body is not None else None, headers={'content-type': 'application/json'})
        try: j = json.loads(s.o.open(r).read())
        except urllib.error.HTTPError as e: j = json.loads(e.read() or b'{}') | {'_status': e.code}
        if isinstance(j, dict) and j.get('P'): s.P = j['P']
        return j
    def gold(s): return s.req('GET', '/api/state')['P']['res']['gold']
    def mk(s, **f): return s.req('GET', '/api/market?' + '&'.join(k + '=' + str(v) for k, v in f.items()))
    def op(s, **o): return s.req('POST', '/api/market', o)
def db(sql, *a):
    c = sqlite3.connect(DBF, timeout=10); c.execute(sql, a); c.commit(); c.close()
sfx = secrets.token_hex(2)
A, Bu, Cu = U('판매' + sfx), U('입찰가' + sfx, 'corona'), U('입찰나' + sfx, 'speculum')
adm('/api/admin/mail', {'to': A.name, 'title': '시험', 'rewards': {'gear': 12, 'gold': 1000}})
adm('/api/admin/mail', {'to': Bu.name + ',' + Cu.name, 'title': '시험', 'rewards': {'gold': 10000000}})
for u in (A, Bu, Cu): u.req('POST', '/api/mail', {'op': 'claimAll'})
print('입학 24시간(시간 배율) 기다리는 중…'); time.sleep(30)
inv = sorted(A.req('GET', '/api/state')['P']['inv'], key=lambda x: -x['r']); check(len(inv) >= 4 and inv[0]['r'] >= 1, 'seller items %d' % len(inv))   # 등급이 높은 것부터 (상점 판매가가 1보다 커야 시작가 하한을 볼 수 있다)
it = inv[0]; it2 = inv[1]; it3 = inv[2]; it4 = inv[3]
# 등록 조건
j = A.op(op='list', auc=1, u=it['u'], start=1, price=10, hours=24); check('상점 판매가' in str(j.get('error')), 'start floor: %s' % j)
j = A.op(op='list', auc=1, u=it['u'], start=1000, price=1100, hours=24); check('1.2배' in str(j.get('error')), 'buyout floor: %s' % j)
j = A.op(op='list', auc=1, u=it['u'], start=1000, price=2000, hours=5); check('기간' in str(j.get('error')), 'hours: %s' % j)
j = A.op(op='list', auc=1, mat='stone', qty=1, start=1000, price=2000, hours=24); check('장비와 휘장' in str(j.get('error')), 'kind: %s' % j)
for x in (it, it2, it3):
    j = A.op(op='list', auc=1, u=x['u'], start=100000, price=200000, hours=24); check(j.get('ok'), 'list ok: %s' % j)
j = A.op(op='list', auc=1, u=it4['u'], start=100000, price=200000, hours=24); check('3개' in str(j.get('error')), 'max 3: %s' % j)
# 목록: 경매 탭에만 보이고 사기 탭에는 없다
lst = Bu.mk(auc=1, kind='item')['list']; mine = [x for x in lst if x['seller'] == A.name]; check(len(mine) == 3, 'auc list %d' % len(mine))
check(all(x.get('auc') == 1 and x['min'] == 100000 for x in mine), 'auc fields')
buy = Bu.mk(kind='item')['list']; check(not any(x.get('auc') for x in buy), 'auction leaked to buy tab')
a1, a2, a3 = sorted(mine, key=lambda x: x['id'])
# 입찰
g0 = Bu.gold()
j = Bu.op(op='bid', id=a1['id'], amount=99999); check('최소 입찰가' in str(j.get('error')), 'min bid: %s' % j)
j = Bu.op(op='bid', id=a1['id'], amount=100000); check(j.get('ok'), 'bid1: %s' % j)
check(Bu.gold() == g0 - 100000, 'escrow B')
j = Bu.op(op='bid', id=a1['id'], amount=200000); check('최고 입찰자' in str(j.get('error')), 'self top: %s' % j)
j = A.op(op='bid', id=a1['id'], amount=150000); check('내가 올린' in str(j.get('error')), 'seller bid: %s' % j)
j = Cu.op(op='bid', id=a1['id'], amount=104999); check('최소 입찰가는 105,000' in str(j.get('error')) or '최소 입찰가' in str(j.get('error')), 'min up 5%%: %s' % j)
j = Cu.op(op='bid', id=a1['id'], amount=105000); check(j.get('ok'), 'bid2: %s' % j)
check(Bu.gold() == g0, 'refund B after outbid')
j = Bu.op(op='bid', id=a1['id'], amount=200000); check('즉시 구매' in str(j.get('error')), 'bid >= buyout: %s' % j)
row = [x for x in Bu.mk(auc=1, kind='item')['list'] if x['id'] == a1['id']][0]; check(row['bid'] == 105000 and row['bids'] == 2 and not row['top'], 'state after bids: %s' % row)
mb = Bu.mk(auc=1)['myBids']; check(any(x['id'] == a1['id'] and not x['top'] for x in mb), 'myBids B shows outbid')
# 취소: 입찰 있으면 불가, 없으면 가능
j = A.op(op='cancel', id=a1['id']); check('취소할 수 없습니다' in str(j.get('error')), 'cancel with bids: %s' % j)
j = A.op(op='cancel', id=a3['id']); check(j.get('ok'), 'cancel no bids: %s' % j)
# 즉시 구매 (C가 최고 입찰 중) → C 환불, B 구매, A 수령
ga, gc = A.gold(), Cu.gold()
j = Bu.op(op='buy', id=a1['id']); check(j.get('ok'), 'buyout: %s' % j)
check(Cu.gold() == gc + 105000, 'refund C on buyout')
check(A.gold() == ga + int(200000 * 0.95), 'seller paid buyout')
# 마감 연장: 마감 100초 전으로 당긴 뒤 입찰하면 5분 뒤로
db('UPDATE market SET expires = ? WHERE id = ?', int(time.time()) + 100, a2['id'])
j = Cu.op(op='bid', id=a2['id'], amount=100000); check(j.get('ok') and j.get('ends', 0) >= int(time.time()) + 280, 'snipe extend: %s' % j)
# 마감 정산: 마감을 지난 시각으로 → 20초 안에 정산
ga = A.gold(); db('UPDATE market SET expires = ? WHERE id = ?', int(time.time()) - 5, a2['id']); time.sleep(25)
inv_c = Cu.req('GET', '/api/state')['P']['inv']; check(any(x['u'] == it2['u'] for x in inv_c), 'winner got item')
check(A.gold() == ga + int(100000 * 0.95), 'seller paid on settle')
mb = Cu.mk(auc=1)['myBids']; check(any(x['id'] == a2['id'] and x.get('won') for x in mb), 'myBids won')
hist = A.req('GET', '/api/market/history')['list']; check(any(x['price'] == 100000 and x['side'] == 'sell' for x in hist), 'history has auction sale')
print('NO ERRORS' if not errs else 'ERRORS: ' + '; '.join(errs))
