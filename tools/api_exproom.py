# 함께 원정 방 API 시험: 두 학생이 방을 만들고 들어가고, 동행을 부르고, 출발한다. (TEST_MODE 서버, BASE 기본 8098)
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
ra = A.req('POST', '/api/register', {'login': 'u' + __import__('secrets').token_hex(6), 'name': '방장' + sfx, 'password': 'secret123', 'house': 'lanterna', 'invite': admin_invite(), 'cls': 'knight'})
rb = Bu.req('POST', '/api/register', {'login': 'u' + __import__('secrets').token_hex(6), 'name': '손님' + sfx, 'password': 'secret123', 'house': 'corona', 'invite': admin_invite(), 'cls': 'mage'})
if ra.get('P', {}).get('cls') != 'knight': errs.append('cls not saved: ' + str(ra.get('error')))
nc = U().req('POST', '/api/register', {'login': 'u' + __import__('secrets').token_hex(6), 'name': '무학과' + sfx, 'password': 'secret123', 'house': 'corona', 'invite': admin_invite()})
if nc.get('error') != '학과 선택 필요': errs.append('register without cls: ' + str(nc.get('error')))
r = A.req('POST', '/api/exproom', {'op': 'create', 's': 1, 'd': '30m', 'pos': 'van'})
if r.get('error'): errs.append('create ' + r['error'])
rid = r.get('id')
lb = Bu.req('GET', '/api/exprooms')
if not any(x['id'] == rid for x in lb.get('rooms', [])): errs.append('room not listed for B')
bad = Bu.req('POST', '/api/exproom', {'op': 'join', 'id': rid, 'pos': 'sup'})
if not bad.get('error'): errs.append('sup allowed without care spell')
r = Bu.req('POST', '/api/exproom', {'op': 'join', 'id': rid, 'pos': 'rear'})
if r.get('error'): errs.append('join ' + r['error'])
# 파티원도 동행을 부를 수 있고, 힘은 부른 학생의 60%. 부른 학생 · 방장만 돌려보낸다
x = Bu.req('POST', '/api/exproom', {'op': 'npc'})
if x.get('error'): errs.append('member npc ' + x['error'])
else:
    bm = [y for y in x.get('rooms', []) if y['mine']][0]['members']
    me_b = [m for m in bm if m.get('me')][0]; nb = [m for m in bm if m.get('npc')][0]
    if nb['power'] != round(me_b['power'] * 0.6): errs.append('npc power not from adder %s %s' % (nb['power'], me_b['power']))
    if not nb.get('mineNpc'): errs.append('adder cannot remove own npc')
    am = [y for y in A.req('GET', '/api/exprooms').get('rooms', []) if y['mine']][0]['members']
    if not [m for m in am if m.get('npc')][0].get('mineNpc'): errs.append('host cannot remove npc')
    d = A.req('POST', '/api/exproom', {'op': 'npcdel', 'k': nb['k']})
    if d.get('error'): errs.append('host npcdel ' + d['error'])
r = A.req('POST', '/api/exproom', {'op': 'npc'})
mine = [x for x in r.get('rooms', []) if x['mine']]
if not mine or mine[0]['n'] != 3: errs.append('npc not added ' + str(r.get('error')))
else:
    est = mine[0].get('est') or {}
    print('host est', round(est.get('kills', 0)), 'frac', round(est.get('frac', 0), 2), mine[0]['departIn'])
    if mine[0]['departIn'] is not None: errs.append('countdown set without full room')
rc = A.req('POST', '/api/exproom', {'op': 'recruit', 'note': '선봉 구해요'})
if rc.get('error'): errs.append('recruit ' + rc['error'])
again = A.req('POST', '/api/exproom', {'op': 'recruit', 'note': 'x'})
if not again.get('error'): errs.append('recruit cooldown missing')
time.sleep(1.1)
hist = Bu.req('GET', '/api/chat/history?ch=recruit')
rmsg = [m for m in hist.get('msgs', []) if m.get('kind') == 'recruit']
if not rmsg or json.loads(rmsg[-1]['text']).get('note') != '선봉 구해요': errs.append('recruit message missing ' + str(hist)[:200])
pk = Bu.req('GET', '/api/exprooms?id=' + rid)
if not pk.get('room') or pk['room']['members'][0].get('power') is None: errs.append('peek failed ' + str(pk)[:200])
inv = A.req('POST', '/api/exproom', {'op': 'invite', 'to': rb['P']['id']})
if not inv.get('error'): errs.append('invite allowed for non-friend')
r = A.req('POST', '/api/exproom', {'op': 'go'})
if r.get('error') or r.get('n') != 3: errs.append('go ' + str(r.get('error') or r.get('n')))
ja = A.req('GET', '/api/state'); jb = Bu.req('GET', '/api/state')
for nm, j in (('A', ja), ('B', jb)):
    e = [q for q in j['P']['exp'] if q]
    if not e or not e[0].get('pt') or e[0]['pt']['n'] != 3: errs.append(nm + ' has no party job')
    else: print(nm, 'job pos', e[0]['pt']['pos'], 'with', [w['name'] for w in e[0]['pt']['with']], 'kps', round(e[0]['kps'], 3))
g = Bu.req('GET', '/api/exprooms')
if not (g.get('gone') or {}).get('ok'): errs.append('B gone notice missing')
r = A.req('POST', '/api/exproom', {'op': 'create', 's': 1, 'd': '30m', 'pos': 'van'})
if r.get('error') != '비어 있는 원정 슬롯이 없습니다': errs.append('busy slot not refused: ' + str(r.get('error')))
# 게시판: 댓글 · 답글 알림
po = A.req('POST', '/api/board', {'op': 'write', 'tag': 'q', 'title': '질문 있어요', 'body': '원정은 몇 단계가 좋나요?'})
pid_ = po.get('id') or (po.get('post') or {}).get('id')
if not pid_: errs.append('board write ' + str(po)[:200])
else:
    c1 = Bu.req('POST', '/api/board', {'op': 'comment', 'id': pid_, 'text': '추천 단계가 좋아요'})
    cid = [c for c in (c1.get('post') or {}).get('comments', []) if c.get('body') == '추천 단계가 좋아요']
    if not cid: errs.append('comment failed ' + str(c1)[:200])
    else:
        c2 = A.req('POST', '/api/board', {'op': 'comment', 'id': pid_, 'text': '고마워요!', 'parent': cid[0]['id']})
        reps = [c for c in (c2.get('post') or {}).get('comments', []) if c.get('parent') == cid[0]['id']]
        if not reps: errs.append('reply not threaded ' + str(c2)[:200])
        # 답글에 다시 답글 (같은 줄기로)
        c3 = Bu.req('POST', '/api/board', {'op': 'comment', 'id': pid_, 'text': '천만에요', 'parent': reps[0]['id'] if reps else 0})
        reps2 = [c for c in (c3.get('post') or {}).get('comments', []) if c.get('parent') == cid[0]['id']]
        if len(reps2) != 2: errs.append('reply-to-reply not threaded: ' + str(len(reps2)) + ' ' + str(c3.get('error')))
        na = A.req('GET', '/api/notes'); nb = Bu.req('GET', '/api/notes')
        if not any('내 글' in m.get('text', '') for m in na.get('notes', [])): errs.append('post author note missing ' + str(na)[:200])
        if not any('내 댓글에 답글' in m.get('text', '') for m in nb.get('notes', [])): errs.append('commenter note missing ' + str(nb)[:200])
        if any('게시판' == m.get('from') for m in A.req('GET', '/api/mail').get('mails', [])): errs.append('board still sends mail')
        st = A.req('GET', '/api/state')
        if not st.get('noteN'): errs.append('noteN missing in state')
        A.req('POST', '/api/notes', {}); 
        if A.req('GET', '/api/notes').get('n'): errs.append('notes not marked read')
fr = A.req('POST', '/api/friends', {'op': 'add', 'id': rb['P']['id']})
if fr.get('error'): errs.append('friend add ' + fr['error'])
elif not any('친구 신청' in m.get('text', '') for m in Bu.req('GET', '/api/notes').get('notes', [])): errs.append('friend request note missing')
# 파티로 함께 원정: C(파티장) · D(파티원)
C, Dd = U(), U()
rc_ = C.req('POST', '/api/register', {'login': 'u' + __import__('secrets').token_hex(6), 'name': '파장' + sfx, 'password': 'secret123', 'house': 'lanterna', 'invite': admin_invite(), 'cls': 'knight'})
rd_ = Dd.req('POST', '/api/register', {'login': 'u' + __import__('secrets').token_hex(6), 'name': '파원' + sfx, 'password': 'secret123', 'house': 'corona', 'invite': admin_invite(), 'cls': 'mage'})
pc = C.req('POST', '/api/party', {'op': 'create', 'name': '시험파티' + sfx[-2:]})
pid_party = (pc.get('party') or {}).get('id')
C.req('POST', '/api/party', {'op': 'invite', 'id': rd_['P']['id']})
ac = Dd.req('POST', '/api/party', {'op': 'accept', 'party': pid_party})
if ac.get('error'): errs.append('party accept ' + ac['error'])
time.sleep(0.6)
x = Dd.req('POST', '/api/exproom', {'op': 'create', 's': 1, 'd': '30m', 'pos': 'rear', 'withParty': True})
if not x.get('error'): errs.append('member could bring party without allgo')
Dd.req('POST', '/api/exproom', {'op': 'leave'})
time.sleep(0.6)
y = C.req('POST', '/api/exproom', {'op': 'create', 's': 1, 'd': '30m', 'pos': 'van', 'withParty': True})
if y.get('error') or not y.get('added'): errs.append('leader party create failed ' + str(y.get('error')) + str(y.get('skipped')))
ld = Dd.req('GET', '/api/exprooms')
if not ld.get('mine'): errs.append('member not placed in leader room')
lv = Dd.req('POST', '/api/exproom', {'op': 'leave'})
if Dd.req('GET', '/api/party').get('party') is None: errs.append('leaving room left party')
C.req('POST', '/api/exproom', {'op': 'leave'}); time.sleep(0.6)
al = C.req('POST', '/api/party', {'op': 'allgo', 'on': True})
if al.get('error') or not al['party'].get('allgo'): errs.append('allgo not set ' + str(al)[:100])
time.sleep(0.6)
z = Dd.req('POST', '/api/exproom', {'op': 'create', 's': 1, 'd': '30m', 'pos': 'rear', 'withParty': True})
if z.get('error') or not z.get('added'): errs.append('member party create failed with allgo ' + str(z.get('error')))
if not any('파티로 함께 원정' in m.get('text', '') for m in C.req('GET', '/api/notes').get('notes', [])): errs.append('brought member not notified')
print('\n'.join(errs) if errs else 'NO ERRORS')
