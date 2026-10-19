# 기숙사 · 학과 채팅 시험: 같은 기숙사/학과만 보이는지 (TEST_MODE 서버, BASE 기본 8098)
import os, json, time, urllib.request, http.cookiejar
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
users = {}
for nm, house, cls in (('가', 'lanterna', 'knight'), ('나', 'lanterna', 'mage'), ('다', 'corona', 'knight')):
    u = U(); r = u.req('POST', '/api/register', {'login': 'u' + __import__('secrets').token_hex(6), 'name': nm + '학생' + sfx, 'password': 'secret123', 'house': house, 'invite': admin_invite(), 'cls': cls}); users[nm] = u
    if r.get('error'): errs.append('reg ' + r['error'])
A, Bb, C = users['가'], users['나'], users['다']
for ch, txt in (('hrp', '기숙사 RP 안녕'), ('hooc', '기숙사 사담'), ('crp', '학과 RP'), ('cooc', '학과 사담')):
    r = A.req('POST', '/api/chat/send', {'ch': ch, 'text': txt + sfx}); time.sleep(1.6)
    if r.get('error'): errs.append(ch + ' send ' + r['error'])
def has(u, ch, txt): time.sleep(1.1); return any(m['text'] == txt + sfx for m in u.req('GET', '/api/chat/history?ch=' + ch).get('msgs', []))
if not has(Bb, 'hrp', '기숙사 RP 안녕'): errs.append('same house cannot see hrp')
if not has(Bb, 'hooc', '기숙사 사담'): errs.append('same house cannot see hooc')
if has(C, 'hrp', '기숙사 RP 안녕'): errs.append('other house sees hrp')
if not has(C, 'crp', '학과 RP'): errs.append('same class cannot see crp')
if has(Bb, 'cooc', '학과 사담'): errs.append('other class sees cooc')
print('NO ERRORS' if not errs else 'ERRORS: ' + '; '.join(errs))
