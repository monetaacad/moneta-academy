# 파티 NPC(아카데미 친구) · 별의 탑 NPC · 거래소 NPC 매물 시험 (TEST_MODE 서버, BASE 기본 8098)
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
A, Bu = U(), U()
A.req('POST', '/api/register', {'login': 'u' + __import__('secrets').token_hex(6), 'name': '파장' + sfx, 'password': 'secret123', 'house': 'lanterna', 'invite': admin_invite(), 'cls': 'knight'})
Bu.req('POST', '/api/register', {'login': 'u' + __import__('secrets').token_hex(6), 'name': '파원' + sfx, 'password': 'secret123', 'house': 'corona', 'invite': admin_invite(), 'cls': 'mage'})
r = A.req('POST', '/api/party', {'op': 'create', 'name': '시험파티' + sfx[-3:]}); time.sleep(2.1)
pa = r.get('party') or {}
if not pa.get('npcPool'): errs.append('no npcPool')
for k in (0, 1, 2):
    r = A.req('POST', '/api/party', {'op': 'npcAdd', 'k': k}); time.sleep(2.1)
    if r.get('error'): errs.append('npcAdd %d %s' % (k, r['error']))
pa = (r.get('party') or {})
npcs = [m for m in pa.get('members', []) if m.get('npc')]
if len(npcs) != 3: errs.append('npc members %d' % len(npcs))
if pa.get('bonus', 1) != 0: errs.append('npc counted in bonus %s' % pa.get('bonus'))
r = A.req('POST', '/api/party', {'op': 'npcAdd', 'k': 3}); time.sleep(2.1)
if not r.get('error'): errs.append('5th member allowed')
r = A.req('POST', '/api/party', {'op': 'invite', 'name': '파원' + sfx}); time.sleep(2.1)
if not r.get('error'): errs.append('invite allowed when full')
r = A.req('POST', '/api/party', {'op': 'npcRemove', 'k': 2}); time.sleep(2.1)
if r.get('error') or len([m for m in r['party']['members'] if m.get('npc')]) != 2: errs.append('npcRemove ' + str(r.get('error')))
tv = A.req('GET', '/api/tower')
team = tv.get('team') or []
print('tower team', [(m['name'], m['npc'], round(m['dps'], 1)) for m in team])
if len([m for m in team if m['npc']]) != 2: errs.append('tower npc count')
# 거래소 NPC 매물
mk = A.req('GET', '/api/market?tab=buy')
print('market keys', list(mk.keys())[:8])
print('NO ERRORS' if not errs else 'ERRORS: ' + '; '.join(errs))
