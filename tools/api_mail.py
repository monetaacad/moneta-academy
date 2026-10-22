# 우편 API 시험: 읽은 우편 삭제 (보상을 받지 않은 우편은 지울 수 없고, 지운 우편은 내 우편함에서만 사라진다). TEST_MODE 서버, BASE 기본 8098
import os, json, time, secrets, urllib.request, http.cookiejar
B = os.environ.get('BASE', 'http://127.0.0.1:8098'); TOK = 'test-admin-token-0123456789abcdef'; errs = []
def adm(path, body):
    r = urllib.request.Request(B + path, data=json.dumps(body).encode(), headers={'content-type': 'application/json', 'x-admin-token': TOK})
    return json.loads(urllib.request.urlopen(r).read())
class U:
    def __init__(s): s.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def req(s, m, path, body=None):
        r = urllib.request.Request(B + path, method=m, data=json.dumps(body).encode() if body is not None else None, headers={'content-type': 'application/json'})
        try: return json.loads(s.op.open(r).read())
        except urllib.error.HTTPError as e: return json.loads(e.read() or b'{}') | {'_status': e.code}
sfx = str(int(time.time()) % 100000); names = ['우편' + sfx, '이웃' + sfx]; us = []
for nm in names:
    u = U(); r = u.req('POST', '/api/register', {'login': 'u' + secrets.token_hex(6), 'name': nm, 'password': 'secret123', 'house': 'lanterna', 'invite': adm('/api/admin/invites', {'count': 1})['codes'][0], 'cls': 'mage'})
    if r.get('error'): errs.append('register ' + r['error'])
    us.append(u)
A, Bu = us
adm('/api/admin/mail', {'to': names[0], 'title': '보상 우편', 'body': 'x', 'rewards': {'shard': 3}, 'days': 3})
adm('/api/admin/mail', {'to': names[0], 'title': '안내 우편', 'body': 'y', 'days': 3})
adm('/api/admin/mail', {'to': '*', 'title': '전체 안내', 'body': 'z', 'days': 3})
mails = {m['title']: m for m in A.req('GET', '/api/mail')['mails']}
rw, info, al = mails['보상 우편'], mails['안내 우편'], mails['전체 안내']
for m in (rw, info, al): A.req('POST', '/api/mail', {'op': 'read', 'id': m['id']})
r = A.req('POST', '/api/mail', {'op': 'del', 'id': rw['id']})
if r.get('error') != '받지 않은 보상이 있는 우편은 삭제할 수 없습니다': errs.append('unclaimed reward deleted: ' + str(r))
r = A.req('POST', '/api/mail', {'op': 'delRead'})
if r.get('n') != 2: errs.append('delRead n ' + str(r))
left = [m['title'] for m in A.req('GET', '/api/mail')['mails']]
if left != ['보상 우편']: errs.append('left after delRead ' + str(left))
A.req('POST', '/api/mail', {'op': 'claim', 'id': rw['id']})
r = A.req('POST', '/api/mail', {'op': 'del', 'id': rw['id']})
if r.get('error') or A.req('GET', '/api/mail')['mails']: errs.append('claimed mail not deleted ' + str(r))
if '전체 안내' not in [m['title'] for m in Bu.req('GET', '/api/mail')['mails']]: errs.append('global mail vanished for others')
print('\n'.join('FAIL ' + e for e in errs) if errs else 'NO ERRORS')
