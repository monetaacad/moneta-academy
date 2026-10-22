# 함께 원정 귀환 투표 시험: 학생 3명 + 동행 친구 1명이 출정 → 2명이 찬성하면 투표하지 않은 학생까지 모두 귀환한다. (TEST_MODE 서버, BASE 기본 8098)
import os, json, time, secrets, urllib.request, http.cookiejar
B = os.environ.get('BASE', 'http://127.0.0.1:8098'); TOK = 'test-admin-token-0123456789abcdef'; errs = []
def admin_invite():
    r = urllib.request.Request(B + '/api/admin/invites', data=json.dumps({'count': 1}).encode(), headers={'content-type': 'application/json', 'x-admin-token': TOK})
    return json.loads(urllib.request.urlopen(r).read())['codes'][0]
class U:
    def __init__(s): s.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def req(s, m, path, body=None):
        r = urllib.request.Request(B + path, method=m, data=json.dumps(body).encode() if body is not None else None, headers={'content-type': 'application/json'})
        try: return json.loads(s.op.open(r).read())
        except urllib.error.HTTPError as e: return json.loads(e.read() or b'{}') | {'_status': e.code}
sfx = str(int(time.time()) % 100000)
us = []
for k, (nm, cls) in enumerate([('투표장', 'knight'), ('찬성', 'mage'), ('잠수', 'mage')]):
    u = U(); r = u.req('POST', '/api/register', {'login': 'u' + secrets.token_hex(6), 'name': nm + sfx, 'password': 'secret123', 'house': 'lanterna', 'invite': admin_invite(), 'cls': cls})
    if r.get('error'): errs.append('register ' + r['error'])
    us.append(u)
A, Bv, C = us
rid = A.req('POST', '/api/exproom', {'op': 'create', 's': 1, 'd': '3h', 'pos': 'van'}).get('id')
for u in (Bv, C):
    r = u.req('POST', '/api/exproom', {'op': 'join', 'id': rid, 'pos': 'rear'})
    if r.get('error'): errs.append('join ' + r['error'])
r = A.req('POST', '/api/exproom', {'op': 'npc'})
if r.get('error'): errs.append('npc ' + r['error'])
r = A.req('POST', '/api/exproom', {'op': 'go'})
if r.get('error') or r.get('n') != 4: errs.append('go ' + str(r.get('error') or r.get('n')))
def slot(u):
    e = [i for i, q in enumerate(u.req('GET', '/api/state')['P']['exp']) if q and q.get('pt')]
    return e[0] if e else None
v1 = A.req('POST', '/api/exp/vote', {'slot': slot(A)})
if v1.get('error') or v1.get('done') or v1.get('need') != 2 or v1.get('n') != 3: errs.append('first vote ' + str({k: v1.get(k) for k in ('error', 'done', 'need', 'n')}))
v2 = Bv.req('POST', '/api/exp/vote', {'slot': slot(Bv)})
if v2.get('error') or not v2.get('done'): errs.append('second vote not done ' + str(v2.get('error')))
for nm, u in (('A', A), ('B', Bv), ('C(투표 안 함)', C)):
    if slot(u) is not None: errs.append(nm + ' still in expedition')
print('\n'.join('FAIL ' + e for e in errs) if errs else 'NO ERRORS')
