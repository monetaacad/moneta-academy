'use strict';
// 모네타 아카데미 게임 서버 (Node.js 22.13+, 외부 패키지 없음)
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const R = require('../shared/rules.js');
const CUR = R.CUR;   // 아카데미 화폐 이름 (shared/data.js)
const D = require('../shared/data.js');
const DB = require('./db.js');
const Store = require('./store.js');
const World = require('./world.js');
const Chat = require('./chat.js');

/* ───────── 설정 ───────── */
const ROOT = path.join(__dirname, '..');
const cfg = {
  port: +(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  adminToken: process.env.ADMIN_TOKEN || '',
  adminIps: (process.env.ADMIN_IPS || '').split(',').map((s) => s.trim()).filter(Boolean), // 비우면 어디서나 (토큰은 항상 필요)
  backupKey: process.env.BACKUP_KEY || '',   // 있으면 백업 파일을 AES-256-GCM으로 암호화
  publicOrigin: process.env.PUBLIC_ORIGIN || '', // 예: https://game.example.com (비우면 Host 헤더와 비교)
  epoch: process.env.SERVER_EPOCH ? Math.floor(Date.parse(process.env.SERVER_EPOCH) / 1000) : null,
  trustProxy: process.env.TRUST_PROXY === '1',
  cookieSecure: process.env.COOKIE_SECURE === '1',
  registerOpen: process.env.REGISTER_OPEN !== '0',
  inviteRequired: process.env.INVITE_REQUIRED !== '0',   // 가입에 초대코드 필요
  maxPlayers: +(process.env.MAX_PLAYERS || 5000),
  expectedPlayers: +(process.env.EXPECTED_PLAYERS || 500), // 첫 주 월드 보스 체력 기준
  houseFull: +(process.env.HOUSE_FULL || 0),             // 기숙사 효과가 100%가 되는 누적 점수 (0이면 R.HOUSE_FULL)
  sessionDays: 30,
  timeScale: +(process.env.TIME_SCALE || 1), // 테스트 전용: 시간을 빠르게
  testMode: process.env.TEST_MODE === '1'   // 테스트 전용: IP별 입학·로그인 제한 끄기
};
if (cfg.epoch !== null && !isFinite(cfg.epoch)) { console.error('SERVER_EPOCH 형식이 잘못되었습니다. 예: 2026-11-02T00:00:00+09:00'); process.exit(1); }
if (cfg.adminToken && cfg.adminToken.length < 24) { console.error('ADMIN_TOKEN이 너무 짧아 관리자 API를 끕니다. 24자 이상 무작위 문자열을 쓰세요 (예: openssl rand -base64 32)'); cfg.adminToken = ''; }
if (cfg.backupKey && cfg.backupKey.length < 16) { console.error('BACKUP_KEY는 16자 이상이어야 합니다'); process.exit(1); }
process.umask(0o077); // 새로 만드는 파일(DB·백업)은 서버 계정만 읽기
const t0real = Date.now() / 1000;
function nowSec() { const r = Date.now() / 1000; return cfg.timeScale === 1 ? r : t0real + (r - t0real) * cfg.timeScale; }
function log() { console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...arguments); }

/* ───────── 저장소 · 세계 ───────── */
const dbx = DB.open(cfg.dataDir);
const sec = require('./secure.js').create(cfg.dataDir, log);
// 키가 바뀌면 암호화된 데이터를 못 읽게 되므로, 다른 키로 켜지지 않게 막는다
{ const fp0 = dbx.kvGet('data_key_fp', null);
  if (fp0 && fp0 !== sec.fingerprint) { console.error('DATA_KEY가 처음 쓰던 키와 다릅니다. 원래 키로 다시 켜 주세요 (키가 다르면 비밀번호·개인정보를 읽을 수 없습니다)'); process.exit(1); }
  if (!fp0) dbx.kvSet('data_key_fp', sec.fingerprint); }
// 예전에 평문으로 저장된 개인정보를 한 번 암호화해 둔다
(function encryptLegacy() {
  const d = dbx.db; let n = 0;
  dbx.tx(() => {
    d.prepare(`SELECT id, profile FROM players WHERE profile NOT LIKE 'e1:%' AND profile != '{}'`).all().forEach((r) => { d.prepare(`UPDATE players SET profile = ? WHERE id = ?`).run(sec.enc(r.profile), r.id); n++; });
    d.prepare(`SELECT id, avatar FROM players WHERE avatar IS NOT NULL`).all().forEach((r) => { if (!sec.isEncBuf(Buffer.from(r.avatar))) { d.prepare(`UPDATE players SET avatar = ? WHERE id = ?`).run(sec.encBuf(Buffer.from(r.avatar)), r.id); n++; } });
    d.prepare(`SELECT id, text FROM chat WHERE text NOT LIKE 'e1:%'`).all().forEach((r) => { d.prepare(`UPDATE chat SET text = ? WHERE id = ?`).run(sec.enc(r.text), r.id); n++; });
    d.prepare(`SELECT id, reason FROM reports WHERE reason != '' AND reason NOT LIKE 'e1:%'`).all().forEach((r) => { d.prepare(`UPDATE reports SET reason = ? WHERE id = ?`).run(sec.enc(r.reason), r.id); n++; });
  });
  if (n) log('예전 평문 개인정보 ' + n + '건을 암호화했습니다');
})();
const store = Store.create(dbx, log);
const world = World.create({ kvGet: dbx.kvGet, kvSet: dbx.kvSet, q: dbx.q, flushAll: () => store.flushAll() }, cfg, log);
store.setWorld(world);
world.tick(nowSec());
const partyOf = new Map();   // 학생 → 파티 id
const guildOf = new Map();   // 학생 → 동아리 id
// 운영자: players.role = 'admin' (DB에서 직접 바꾸거나 /api/admin/ops) 또는 환경 변수 ADMIN_NAMES=이름1,이름2
// 운영자인지는 서버만 판단한다. 클라이언트가 보낸 값은 쓰지 않는다.
const ADMIN_NAMES = new Set((process.env.ADMIN_NAMES || process.env.CHAT_OPS || '').split(',').map((x) => R.nameKey(x)).filter(Boolean));
const adminIds = new Set(dbx.q.admins.all().map((r) => r.id)), chiefIds = new Set(dbx.q.admins.all().filter((r) => r.role === 'chief').map((r) => r.id));
dbx.kvGet('chat_ops', []).forEach((id) => { dbx.q.setRole.run('admin', id); adminIds.add(id); }); dbx.kvSet('chat_ops', []);   // 예전 방식 옮기기
function isChatOp(pid) {
  if (adminIds.has(pid)) return true;
  if (!ADMIN_NAMES.size) return false;
  const m = dbx.q.playerMeta.get(pid); return !!m && !m.guest && ADMIN_NAMES.has(R.nameKey(m.name));
}
// 운영 로그: 누가 언제 무엇을 바꿨는지
function oplog(actor, name, action, detail) { dbx.q.oplogAdd.run(Math.floor(Date.now() / 1000), actor, name || '', action, String(detail || '').slice(0, 300)); log(`[운영] ${name || actor} ${action} ${detail || ''}`); }
/* 새 버전 알림 · 점검: kv 'build' {build, minBuild}, kv 'maint' {on, start, until, msg}
   build가 화면의 빌드 번호보다 크면 「새 버전」 띠, minBuild보다 낮은 화면은 10초 뒤 저절로 새로고침.
   점검 중(on)에는 운영자(bypass)가 아닌 학생의 API를 503 + maint로 막는다. start만 있으면 예고 띠. */
let BUILD = Object.assign({ build: +process.env.ARC_BUILD || 0, minBuild: +process.env.ARC_MIN_BUILD || 0 }, dbx.kvGet('build', {}));
// 올린 화면(public/app.js)의 빌드 번호가 더 크면 그 번호로 맞춘다 → 새 버전을 올리면 접속자에게 저절로 「새 버전」 띠가 뜬다 (minBuild는 운영실에서만)
try { const fb = +((/var BUILD = (\d+)/.exec(require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'app.js'), 'utf8')) || [])[1] || 0); if (fb > (BUILD.build || 0)) { BUILD.build = fb; dbx.kvSet('build', BUILD); } } catch (e) { }
let MAINT = Object.assign({ on: false, start: 0, until: 0, msg: '' }, dbx.kvGet('maint', {}));
function maintView(pid) { if (!MAINT.on && !MAINT.start) return null; return { on: !!MAINT.on, start: MAINT.start || 0, until: MAINT.until || 0, msg: MAINT.msg || '', bypass: !!(pid && isChatOp(pid)) }; }
function maintPing() { chat.pingEach('maint', (pid) => maintView(pid) || { on: false }); }
function maintSet(m, by) { MAINT = { on: !!m.on, start: m.on ? 0 : Math.max(0, +m.start || 0), until: Math.max(0, +m.until || 0), msg: String(m.msg || '').slice(0, 300) }; dbx.kvSet('maint', MAINT); maintPing(); oplog(by || 'admin', '', 'maint', MAINT.on ? '점검 시작' : MAINT.start ? '점검 예고 ' + new Date(MAINT.start * 1000).toISOString() : '점검 끝'); }
// 예전에 운영실에서 올린 공지(일반 소식으로 저장됨)를 한 번 「운영진 공지」로 바꾼다: 운영실 공지 기록(world notices, auto 아님)과 글이 같은 것만
if (!dbx.kvGet('staffNoticeMig', 0)) {
  try {
    const mine = new Set((dbx.kvGet('notices', []) || []).filter((n) => n && !n.auto).map((n) => String(n.text).slice(0, 300)));
    let n = 0; if (mine.size) dbx.q.recentChat.all('notice', 500).forEach((r) => { if (r.pid !== 'system') return; let tx = ''; try { tx = sec.dec(r.text); } catch (e) { return; } if (mine.has(String(tx).slice(0, 300))) { dbx.db.prepare("UPDATE chat SET kind = 'staff', pid = 'staff', name = '운영진' WHERE id = ?").run(r.id); n++; } });
    dbx.kvSet('staffNoticeMig', 1); if (n) log('예전 운영진 공지 ' + n + '건을 강조 표시로 바꿨습니다');
  } catch (e) { log('운영진 공지 이주 실패', e); }
}
const chat = Chat.create(dbx, log, { initExtra: (pid) => ({ build: BUILD.build, minBuild: BUILD.minBuild, maint: maintView(pid), pin: dbx.kvGet('pinNotice', null) }), sec, gzip: process.env.SSE_GZIP !== '0', isOp: (pid) => isChatOp(pid), slow: { world: dbx.kvGet('chat_slow', 0) }, partyOf: (pid) => partyOf.get(pid) || null, exrOf: (pid) => exprooms.chatKey(pid) || R.expChatKey(store.peek(pid)), guildOf: (pid) => guildOf.get(pid) || null, houseOf: (pid) => { const P = store.get(pid); return P && R.HOUSE[P.house] ? P.house : null; }, clsOf: (pid) => { const P = store.get(pid); return P && R.CLS[P.cls] ? P.cls : null; }, titleOf: (P) => R.titleName(P, P.title), inkOf: (P) => R.decoView(P).ink || '', canDm: (a, b) => friendState(a, b) === 'ok' });
const Board = require('./board.js');
// 알림 기록: 우편과 따로, 일어난 일을 모아 보여 준다 (최근 100개, 30일)
function pname(pid) { const w = dbx.q.getProfile.get(pid); return w ? w.name : '학생'; }
function addNote(pid, kind, text, link) {
  if (!pid || String(pid).startsWith('npc:') || pid === 'staff') return;
  try { dbx.q.noteInsert.run(pid, Math.floor(Date.now() / 1000), kind, sec.enc(String(text).slice(0, 300)), link ? JSON.stringify(link) : ''); chat.ping(pid, 'note', { n: Number(dbx.q.noteUnread.get(pid).n) }); } catch (e) { log('알림 저장 실패', e); }
}
setInterval(() => { try { dbx.q.notePrune.run(Math.floor(Date.now() / 1000) - 30 * 86400); } catch (e) { } }, 3600000).unref();
const board = Board.create(dbx, sec, { isOp: (pid) => pid !== 'staff' && isChatOp(pid), isChief: (pid) => chiefIds.has(pid), badgeOf: (pid) => { if (pid === 'staff' || !isChatOp(pid)) return ''; const P = store.peek(pid), t = P ? R.titleName(P, P.title) : ((dbx.q.getProfile.get(pid) || {}).title || ''); return R.OP_TITLES[t] ? t : ''; }, sendMail: (...a) => sendMail(...a), note: (...a) => addNote(...a), log });
const ExpRoom = require('./exproom.js');
const exprooms = ExpRoom.create({ loadPlayer: (pid, now) => loadPlayer(pid, now), ctx: () => world.ctx(nowSec()), gameNow: () => nowSec(), markDirty: (pid) => store.markDirty(pid), partyOf, log,
  onRoom: (pid) => chat.exrChanged(pid),   // 방 출입 → 원정 채팅 탭
  isOnline: (pid) => isOnline(pid), save: (json) => dbx.kvSet('exprooms', json), load: () => dbx.kvGet('exprooms', null),   // 다시 켜도 방이 이어진다
  recruit: (P, data) => chat.recruit(P, data, Date.now() / 1000),
  note: (...a) => addNote(...a),
  partyInfo: (pid) => { const id = partyOf.get(pid); if (!id) return null; const pa = dbx.q.partyGet.get(id); if (!pa) return null; return { id, leader: pa.leader, allgo: !!pa.allgo, members: dbx.q.partyMembers.all(id).map((m) => m.id) }; },
  canInvite: (a, b) => friendState(a, b) === 'ok' || (guildOf.get(a) && guildOf.get(a) === guildOf.get(b)),
  nameOf: (pid) => { const r = dbx.q.getProfile.get(pid); return r ? r.name : ''; } });
// 새 업데이트 노트가 배포되면 공지 채널에 한 번 알린다
{ const pn = R.D.PATCH && R.D.PATCH[0]; if (pn && dbx.kvGet('patchPosted', 0) < pn.id) { chat.system('notice', '새 업데이트 노트가 게시되었습니다: 「' + pn.title + '」. 상단의 업데이트 노트 버튼에서 확인할 수 있습니다.', Date.now() / 1000); dbx.kvSet('patchPosted', pn.id); } }
// 사감 한마디: 기숙사 RP 채널에 (신입생 환영 · 주간 대항전 결과 · 대항전 선두가 바뀔 때). 채팅 시각은 다른 알림처럼 실제 시각
function headSay(house, text) { const L = D.HOUSE_LORE[house]; if (L && text) chat.headSay(house, L.head, text, Date.now() / 1000); }
function headWelcome(P) { const L = D.HOUSE_LORE[P.house]; if (L) headSay(P.house, L.say.welcome.replace('{n}', P.name)); }
world.onWeek = (week, order) => order.forEach((id, i) => { const L = D.HOUSE_LORE[id]; if (L) headSay(id, L.say.rank[i]); });
world.onLead = (id) => { const L = D.HOUSE_LORE[id]; if (L) headSay(id, L.say.lead); };
world.onKill = (name) => { const t = name + ' 토벌 성공! 이번 주에 도전한 모든 학생에게 토벌 보상 우편을 보냈습니다.'; chat.system('world', t, Date.now() / 1000); chat.system('notice', t, Date.now() / 1000); };

// 월드 보스 토벌 보상: 이번 주에 한 번이라도 도전한 학생 모두에게 우편 (막 잡은 학생은 아직 저장 전일 수 있어 따로 넣는다)
world.payKillTo = (boss, killer) => {
  store.flushAll();
  const ids = new Set(dbx.db.prepare('SELECT pid FROM weekly WHERE week = ? AND att > 0').all(boss.week).map((r) => r.pid)); if (killer) ids.add(killer);
  const exp = Math.floor(Date.now() / 1000) + 14 * 86400, title = '월드 보스 토벌 보상: ' + boss.name;
  const body = R.josa(boss.name, '을', '를') + ' 쓰러뜨렸습니다.\n이번 주에 함께 도전한 모든 학생에게 보내는 토벌 보상입니다. 피해 순위 보상은 다음 주 월요일에 받을 수 있습니다.';
  ids.forEach((pid) => { try { sendMail(pid, '월드 보스', title, body, R.WB_KILL_RW, exp, true); } catch (e) { log('토벌 보상 우편 실패', pid, e); } });
  log(`토벌 보상 우편: ${boss.name} → ${ids.size}명`);
};

/* ───────── 보안 도구 ───────── */
// 비밀번호 해시는 스레드 풀에서 (입학 몰림에도 게임 응답이 멈추지 않도록)
// s1: N=2^14 (예전), s2: N=2^15 (지금). 예전 해시는 로그인할 때 새 방식으로 바꿔 저장한다.
const SCRYPT = { s1: { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, s2: { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 } };
function scryptAsync(pw, salt, len, o) { return new Promise((ok, no) => crypto.scrypt(pw, salt, len, o, (e, k) => e ? no(e) : ok(k))); }
// s3(지금): 비밀번호 → HMAC-SHA256(서버 비밀 후추) → scrypt(N=2^15). 후추는 DB에 없으므로 DB만으로는 대입 공격을 할 수 없다.
async function hashPass(pw) {
  const salt = crypto.randomBytes(16), h = await scryptAsync(sec.pepper(pw), salt, 32, SCRYPT.s2);
  return 's3$' + salt.toString('base64') + '$' + h.toString('base64');
}
async function checkPass(pw, stored) {
  const [v, s, h] = String(stored).split('$'); if (!(v === 's3' || SCRYPT[v]) || !s || !h) return false;
  const input = v === 's3' ? sec.pepper(pw) : v === 's1' ? pw : pw.normalize('NFC');
  const want = Buffer.from(h, 'base64'), got = await scryptAsync(input, Buffer.from(s, 'base64'), want.length, v === 's3' ? SCRYPT.s2 : SCRYPT[v]);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
const needsRehash = (stored) => !String(stored).startsWith('s3$');
// 비밀번호 규칙: 8~72자, 흔한 비밀번호와 이름이 들어간 비밀번호 거절
const COMMON_PW = new Set(['12345678', '123456789', '1234567890', 'password', 'password1', 'qwer1234', 'qwerty123', 'qwertyui', '11111111', '00000000', '1q2w3e4r', '1q2w3e4r5t', 'asdf1234', 'abcd1234', 'iloveyou', 'aaaaaaaa', '88888888', 'zxcvbnm1', 'q1w2e3r4', 'a1234567', 'moneta1', 'moneta123', 'password123', 'admin123', 'abc12345', '12341234', 'qwerasdf']);
function pwProblem(pw, name, login) {
  if (pw.length < 8 || pw.length > 72) return '비밀번호는 8자 이상 72자 이하';
  const low = pw.toLowerCase();
  if (COMMON_PW.has(low) || /^(.)\1+$/.test(pw) || /^\d+$/.test(pw) && pw.length < 10) return '너무 쉬운 비밀번호입니다. 글자와 숫자 혼합 필요';
  if (name && name.length >= 2 && low.includes(name.toLowerCase())) return '비밀번호에 이름을 넣지 마세요';
  if (login && login.length >= 4 && low.includes(login)) return '비밀번호에 아이디를 넣지 마세요';
  return null;
}
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('base64url');
const tokKey = (t) => 'h:' + sha256(t);  // DB에는 토큰의 해시만 저장한다
const NAME_RE = R.NAME_RE;
// 로그인 아이디: 영문 소문자·숫자·밑줄 4~20자. DB에는 HMAC 색인만 저장하고 게임 안 어디에도 보내지 않는다
const LOGIN_RE = /^[a-z0-9_]{4,20}$/, LOGIN_RULE = '아이디는 영문·숫자·밑줄(_) 4~20자';
const loginNorm = (s) => { const t = String(s || '').trim().toLowerCase(); return LOGIN_RE.test(t) ? t : nameKey(t); };   // 아이디 이전에 가입한 학생은 이름이 아이디
const loginKey = (s) => sec.index('login:' + loginNorm(s));
dbx.q.noLoginKey.all().forEach((r) => dbx.q.setLoginKey.run(sec.index('login:' + r.name_key), r.id));
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() { let c = ''; for (let i = 0; i < 8; i++) c += CODE_ABC[crypto.randomInt(CODE_ABC.length)]; return 'ARC-' + c.slice(0, 4) + '-' + c.slice(4); }
function normCode(s) { const c = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^ARC/, ''); return c.length === 8 ? 'ARC-' + c.slice(0, 4) + '-' + c.slice(4) : ''; }
function checkInvite(code) {
  const inv = code && dbx.q.getInvite.get(code);
  if (!inv) return '초대코드가 맞지 않습니다';
  if (inv.disabled) return '사용이 중지된 초대코드입니다';
  if (inv.uses >= inv.max_uses) return '이미 다 쓴 초대코드입니다';
  if (inv.expires && inv.expires < Date.now() / 1000) return '기한이 지난 초대코드입니다';
  return null;
}
const nameKey = (n) => R.nameKey(n);   // 대소문자·띄어쓰기 무시

// 토큰 버킷 속도 제한
const buckets = new Map();
function limited(key, rate, burst) {
  const now = Date.now(); let b = buckets.get(key);
  if (!b) { b = { tok: burst, at: now }; buckets.set(key, b); }
  b.tok = Math.min(burst, b.tok + (now - b.at) / 1000 * rate); b.at = now;
  if (b.tok < 1) return true; b.tok -= 1; return false;
}
setInterval(() => { const now = Date.now(); buckets.forEach((b, k) => { if (now - b.at > 600000) buckets.delete(k); }); }, 60000).unref();

function clientIp(req) {
  if (cfg.trustProxy) { const x = req.headers['x-forwarded-for']; if (x) return String(x).split(',')[0].trim(); }
  return req.socket.remoteAddress || '?';
}
function getToken(req) {
  const auth = req.headers.authorization; if (auth && auth.startsWith('Bearer ')) { const t = auth.slice(7).trim(); return /^[A-Za-z0-9_-]{20,100}$/.test(t) ? t : null; }
  const c = req.headers.cookie || ''; const m = c.match(/(?:^|;\s*)arc_s=([A-Za-z0-9_-]{20,100})/); if (m) return m[1];
  return null;
}
function newSession(pid) {
  const token = crypto.randomBytes(32).toString('base64url'), now = Math.floor(Date.now() / 1000);
  dbx.q.insertSession.run(tokKey(token), pid, now, now + cfg.sessionDays * 86400);
  return token;
}
const sessionCache = new Map(); // 토큰 해시 → {pid, checked}
function authed(req) {
  let key = null;
  const tok = getToken(req); if (tok) key = tokKey(tok);
  else if (req.url.startsWith('/api/chat/stream?')) key = useTicket(new URL(req.url, 'http://x').searchParams.get('k'));
  if (!key) return null;
  const c = sessionCache.get(key), now = Math.floor(Date.now() / 1000);
  if (c && now - c.checked < 300) return c.pid;
  const s = dbx.q.getSession.get(key);
  if (!s || s.expires < now) { sessionCache.delete(key); return null; }
  if (s.expires - now < (cfg.sessionDays - 1) * 86400) dbx.q.touchSession.run(now + cfg.sessionDays * 86400, key);
  sessionCache.set(key, { pid: s.pid, checked: now });
  if (sessionCache.size > 20000) sessionCache.clear();
  return s.pid;
}
// 채팅 스트림용 1회용 입장권: 긴 로그인 토큰이 주소(접속 기록)에 남지 않도록 30초짜리 표를 따로 준다
const tickets = new Map(); // 표 → {key, exp}
function newTicket(req) { const t = crypto.randomBytes(18).toString('base64url'); tickets.set(t, { key: tokKey(getToken(req)), exp: Date.now() + 30000 }); return t; }
function useTicket(t) { const e = t && tickets.get(t); if (!e) return null; tickets.delete(t); return e.exp > Date.now() ? e.key : null; }
setInterval(() => { const n = Date.now(); tickets.forEach((e, k) => { if (e.exp < n) tickets.delete(k); }); }, 30000).unref();
function cookie(token, maxAge) {
  return `arc_s=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cfg.cookieSecure ? '; Secure' : ''}`;
}

/* ───────── 응답 ───────── */
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
};
if (cfg.cookieSecure) SEC_HEADERS['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
// 다른 사이트에서 몰래 보내는 요청 막기: 브라우저가 붙이는 Origin이 우리 주소가 아니면 거절
function sameOrigin(req) {
  const o = req.headers.origin; if (!o) return true;   // 같은 출처의 fetch는 Origin을 안 붙이기도 한다
  if (cfg.publicOrigin) return o === cfg.publicOrigin;
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
}
function send(req, res, code, body, headers) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, SEC_HEADERS, headers || {});
  if (buf.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) { buf = zlib.gzipSync(buf, { level: 5 }); h['Content-Encoding'] = 'gzip'; h['Vary'] = 'Accept-Encoding'; }
  h['Content-Length'] = buf.length;
  res.writeHead(code, h); res.end(buf);
}
function fail(req, res, code, msg) { send(req, res, code, { error: msg }); }
function readJson(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(Object.assign(new Error('요청이 너무 큽니다'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!size) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(Object.assign(new Error('JSON 형식이 아닙니다'), { code: 400 })); } });
    req.on('error', reject);
  });
}

/* ───────── 정적 파일 ───────── */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const staticCache = new Map();
function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  if (rel === '/demo.js') return fail(req, res, 404, '없는 페이지입니다');   // 아티팩트 미리보기 전용 코드는 서버판에서 내보내지 않는다
  let base = path.join(ROOT, 'public');
  if (rel.startsWith('/shared/')) { base = path.join(ROOT, 'shared'); rel = rel.slice(7); }
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep) || /(^|[\/\\])\./.test(path.relative(base, file))) return fail(req, res, 404, '없는 페이지입니다');
  let ent = staticCache.get(file);
  try {
    const st = fs.statSync(file);
    if (!ent || ent.mtime !== st.mtimeMs) {
      const raw = fs.readFileSync(file);
      ent = { mtime: st.mtimeMs, raw, gz: zlib.gzipSync(raw, { level: 9 }), etag: '"' + crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 16) + '"', type: MIME[path.extname(file)] || 'application/octet-stream' };
      staticCache.set(file, ent);
    }
  } catch (e) { return fail(req, res, 404, '없는 페이지입니다'); }
  if (req.headers['if-none-match'] === ent.etag) { res.writeHead(304, { ETag: ent.etag }); return res.end(); }
  const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const h = Object.assign({ 'Content-Type': ent.type, ETag: ent.etag, 'Cache-Control': 'no-cache' }, SEC_HEADERS);
  if (gz) h['Content-Encoding'] = 'gzip';
  const body = gz ? ent.gz : ent.raw; h['Content-Length'] = body.length;
  res.writeHead(200, h); res.end(req.method === 'HEAD' ? undefined : body);
}

/* ───────── 게임 상태 ───────── */
// 운영자 여부를 P.op로 (규칙 엔진의 운영진 전용 칭호 판정용). 해제되면 운영진 칭호도 뗀다
// 운영 등급: 2 학생회장(chief) · 1 학생회(admin) · 0. 칭호(운영진 배지)는 이 등급으로만 열린다
function opLevel(pid) { return chiefIds.has(pid) ? 2 : isChatOp(pid) ? 1 : 0; }
function syncOp(P) {
  const op = opLevel(P.id); let ch = (P.op || 0) !== op; P.op = op;
  if (P.title && !R.titleOk(P, P.title)) { P.title = ''; ch = true; }
  if (ch) store.markDirty(P.id);
}
function loadPlayer(pid, now) {
  const P = store.get(pid); if (!P) return null;
  syncOp(P);
  const fp = R.fingerprint(P);
  const pc = setPartyN(P) | setGuildLv(P);
  R.advance(P, world.ctx(now), now);
  if (pc) store.markDirty(pid);
  if (R.fingerprint(P) !== fp) store.markDirty(pid); else store.touch(pid);
  return P;
}
/* ───────── 함께 듣는 수업 ─────────
   지금 같은 과목 수업을 듣고 있는 학생 수(접속하지 않아도), 같이 들으면 경험치 조금 더, 붐빈 날엔 교수님 한마디 */
const lecIdx = new Map();   // 과목 → Map(pid → 끝나는 시각)
const lecDay = { day: -1, subj: {} };   // 오늘 이 과목을 들은 학생들
function lecSync(P) {
  lecIdx.forEach((m) => m.delete(P.id));
  (P.lec || []).forEach((j) => { if (j && j.end > P.at) { if (!lecIdx.has(j.s)) lecIdx.set(j.s, new Map()); lecIdx.get(j.s).set(P.id, j.end); } });
}
(function () { const since = Math.floor(Date.now() / 1000) - 3 * 86400; let n = 0; dbx.db.prepare('SELECT state FROM players WHERE last_seen > ?').all(since).forEach((r) => { try { lecSync(JSON.parse(r.state)); n++; } catch (e) { } }); })();
function lecCounts(now) { const o = {}; lecIdx.forEach((m, s) => { let c = 0; m.forEach((end, pid) => { if (end > now) c++; else m.delete(pid); }); if (c) o[s] = c; }); return o; }
let activeCache = { at: 0, n: 0 };
function active24() { if (Date.now() - activeCache.at > 600000) activeCache = { at: Date.now(), n: Number(dbx.db.prepare('SELECT COUNT(*) AS n FROM players WHERE last_seen > ?').get(Math.floor(Date.now() / 1000) - 86400).n) }; return activeCache.n; }
function profLines(now) { const d = R.dayKST(now); const x = dbx.kvGet('profline', null); return x && x.day === d ? x.lines : {}; }
function lecStarted(P, sid, now) {
  const d = R.dayKST(now); if (lecDay.day !== d) { lecDay.day = d; lecDay.subj = {}; }
  const set = lecDay.subj[sid] || (lecDay.subj[sid] = new Set()); set.add(P.id);
  const need = Math.max(3, Math.ceil(active24() * 0.15));
  let x = dbx.kvGet('profline', null); if (!x || x.day !== d) x = { day: d, lines: {} };
  if (set.size >= need && !x.lines[sid] && R.D.PROF_CROWD[sid]) {
    const L = R.D.PROF_CROWD[sid], line = L[d % L.length]; x.lines[sid] = line; dbx.kvSet('profline', x);   // 수업 화면에만 나온다 (공지 채널에는 올리지 않는다)
  }
}
// 예전에 공지 채널에 올라간 교수 한마디(「[과목] 교수: “…”」)를 한 번 지운다
if (!dbx.kvGet('profNoticeClean', 0)) { dbx.q.recentChat.all('notice', 500).forEach((r) => { if (r.pid === 'system' || !r.pid) { const tx = sec.dec(r.text); if (/^\[[^\]]+\] [^:]+: “/.test(tx)) chat.remove(r.id); } }); dbx.kvSet('profNoticeClean', 1); }
// 지금 경매: 정해진 1시간이 지나도 막판 입찰로 늘어난 물건이 남아 있으면 그 방문을 계속 연다 (늘어나는 데 끝이 없다)
function aucVisitNow(now) {
  const v = R.auctionVisit(now); if (!v) return v;
  const open = (id) => dbx.q.aucByVisit.all(id).filter((r) => !r.done && r.ends > now);
  if (!v.active) { const pid = v.id - 1, pv = open(pid); if (pv.length) return { id: pid, start: Math.floor(pid / R.AUCTION_HOURS.length) * 86400 - R.K.TZ + R.AUCTION_HOURS[pid % R.AUCTION_HOURS.length] * 3600, end: Math.max.apply(null, pv.map((r) => r.ends)), active: true, extended: true }; return v; }
  const cur = open(v.id); return cur.length ? Object.assign({}, v, { end: Math.max(v.end, Math.max.apply(null, cur.map((r) => r.ends))) }) : v;
}
function aucBrief(now) { const v = aucVisitNow(now); return v ? { start: v.start, end: v.end, active: v.active } : null; }
function classView(now) { return { n: lecCounts(now), prof: profLines(now) }; }

// 가방이 가득 차서 넘친 장비(P.mailQ)를 우편으로 보낸다 (10개씩, 30일). 응답을 보낼 때와 저장할 때
function drainMailQ(P) {
  const q = P.mailQ; if (!q || !q.length) return; P.mailQ = [];
  const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
  for (let i = 0; i < q.length; i += 10) sendMail(P.id, '원정대', '가방이 가득 차 맡겨 둔 장비', '가방이 가득 차 있어 얻은 장비를 우편으로 보관했습니다. 가방을 비운 뒤 받아 가세요.', { items: q.slice(i, i + 10) }, exp, true);
  store.markDirty(P.id);
}
store.beforeWrite = drainMailQ;
function statePayload(P, now) {
  drainMailQ(P);
  let mrow;
  return { now, scale: cfg.timeScale, P: R.publicState(P), W: world.publicView(now, store.online(120000)), rank: world.rankOf(R.summary(P, world.W, now).power), fr: Number(dbx.q.friendIncomingCount.get(P.id).n), pinv: Number(dbx.q.partyInviteCount.get(P.id).n), party: partyOf.get(P.id) || null, guild: guildOf.get(P.id) || null, mailN: (mrow = mailNewRow(P.id), Number(mrow.n)), mailTop: Number(mrow.top), cls: classView(now), rit: ritView(P, now), auc: aucBrief(now), erInv: exprooms.invN(P.id), noteN: Number(dbx.q.noteUnread.get(P.id).n) };
}

/* ───────── API ───────── */
const routes = {};
routes['GET /api/health'] = (req, res) => { const mv = MAINT.on ? maintView(authed(req)) : null; if (mv && !mv.bypass) return send(req, res, 503, { ok: false, maint: mv }); send(req, res, 200, { ok: true, now: nowSec() }); };
// 로그인하지 않은 방문자에게는 학생 이름·랭킹 같은 정보를 보내지 않는다
// 기숙사별 학생 수 (가입 화면에 표시, 1분마다 다시 센다)
let houseN = { at: 0, n: {} };
function houseCounts() { if (Date.now() - houseN.at > 60000) { const n = {}; dbx.q.houseCount.all().forEach((r) => { n[r.house] = Number(r.n) || 0; }); houseN = { at: Date.now(), n }; } return houseN.n; }
routes['GET /api/meta'] = (req, res) => { const me = authed(req), mv = maintView(me); if (mv && mv.on && !mv.bypass) return send(req, res, 503, { error: '점검 중입니다', maint: mv }); send(req, res, 200, Object.assign({ build: BUILD.build, minBuild: BUILD.minBuild, maint: mv, now: nowSec(), scale: cfg.timeScale, registerOpen: cfg.registerOpen, inviteRequired: cfg.inviteRequired, houses: world.houseView(), houseN: houseCounts() }, me ? { world: world.publicView(nowSec(), store.online(120000)) } : {})); };

routes['POST /api/register'] = async (req, res) => {
  if (!cfg.registerOpen) return fail(req, res, 403, '지금은 입학 신청을 받지 않습니다');
  if (!cfg.testMode && limited('reg:' + clientIp(req), 5 / 3600, 5)) return fail(req, res, 429, '입학 신청이 너무 잦습니다. 잠시 후 다시 시도');
  const b = await readJson(req, 2048);
  const name = R.cleanName(b.name), pw = String(b.password || ''), house = String(b.house || ''), login = String(b.login || '').trim().toLowerCase();
  if (!LOGIN_RE.test(login)) return fail(req, res, 400, LOGIN_RULE);
  if (!NAME_RE.test(name)) return fail(req, res, 400, R.NAME_RULE);
  if (login === nameKey(name)) return fail(req, res, 400, '아이디는 학생 이름과 다르게 정해 주세요');   // 이름은 모두에게 보이므로
  if (R.badName(name) && !ADMIN_NAMES.has(nameKey(name))) return fail(req, res, 400, '사용할 수 없는 단어가 포함된 이름입니다');   // 운영자로 지정한 이름만 예외
  { const why = pwProblem(pw, name, login); if (why) return fail(req, res, 400, why); }
  if (!R.HOUSE[house]) return fail(req, res, 400, '기숙사 선택 필요');
  const cls = String(b.cls || ''); if (!R.CLS[cls]) return fail(req, res, 400, '학과 선택 필요');
  if (Number(dbx.q.countPlayers.get().n) >= cfg.maxPlayers) return fail(req, res, 403, '정원이 가득 찼습니다');
  if (dbx.q.playerByKey.get(nameKey(name))) return fail(req, res, 409, '이미 사용 중인 이름입니다');
  const lkey = loginKey(login); if (dbx.q.playerByLogin.get(lkey)) return fail(req, res, 409, '이미 사용 중인 아이디입니다');
  const code = cfg.inviteRequired ? normCode(b.invite) : '';
  if (cfg.inviteRequired) { const why = checkInvite(code); if (why) return fail(req, res, 403, why); }
  const opInv = !!(code && (dbx.q.getInvite.get(code) || {}).op);
  const hashed = await hashPass(pw);
  if (dbx.q.playerByKey.get(nameKey(name))) return fail(req, res, 409, '이미 사용 중인 이름입니다');
  if (dbx.q.playerByLogin.get(lkey)) return fail(req, res, 409, '이미 사용 중인 아이디입니다');
  const id = crypto.randomUUID(), now = nowSec();
  const P = R.newPlayer(id, name, house, now, crypto.randomInt(1, 2147483647)); R.clsStart(P, cls);
  R.advance(P, world.ctx(now), now);
  try {
    dbx.tx(() => {
      if (code && !dbx.q.useInvite.run(code).changes) throw Object.assign(new Error('이미 다 쓴 초대코드입니다'), { status: 403 });
      dbx.q.insertPlayerFull.run(id, name, nameKey(name), house, hashed, Math.floor(now), Math.floor(now), JSON.stringify(P), 0, code, lkey);
    });
  } catch (e) { return fail(req, res, e.status || 409, e.status ? e.message : '이미 사용 중인 이름이나 아이디입니다'); }
  try { dbx.db.prepare('UPDATE players SET login_enc = ? WHERE id = ?').run(sec.enc(login), id); } catch (e) { }   // 운영실 확인용 (암호화)
  store.put(P);
  if (opInv) { dbx.q.setRole.run('admin', id); adminIds.add(id); P.op = 1; oplog('admin', '관리자', 'role', `${name} → admin (운영자 초대코드)`); }
  const token = newSession(id);
  log(`입학: ${name} (${house})${code ? ' 초대코드 ' + code : ''}${opInv ? ' · 운영자' : ''}`);
  world.addNews(P.name + ' 학생이 ' + (R.HOUSE[P.house] ? R.HOUSE[P.house].name : '아카데미') + '에 입학했습니다', now);
  headWelcome(P);
  send(req, res, 200, Object.assign({ token }, statePayload(P, now)), { 'Set-Cookie': cookie(token, cfg.sessionDays * 86400) });
};
// 이름 바꾸기: 처음 정한 이름은 한 번 언제든, 바꾼 뒤에는 30일(R.NAME_CD)이 지나야 다시. 같은 이름(대소문자 무시)은 쓸 수 없다.
routes['POST /api/rename'] = async (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  if (store.isBanned(pid)) return fail(req, res, 403, '이용이 정지된 계정입니다');
  if (limited('rn:' + pid, 5 / 60, 5)) return fail(req, res, 429, '잠시 후 다시 시도');
  const b = await readJson(req, 1024), now = nowSec(), P = loadPlayer(pid, now); if (!P) return fail(req, res, 401, '학생 정보를 찾을 수 없습니다');
  const name = R.cleanName(b.name);
  if (!NAME_RE.test(name)) return fail(req, res, 400, R.NAME_RULE);
  if (R.badName(name)) return fail(req, res, 400, '사용할 수 없는 단어가 포함된 이름입니다');
  if (name === P.name) return fail(req, res, 400, '지금 이름과 같습니다');
  const real = Date.now() / 1000, lf = R.renameLeft(P, real); if (lf > 0) return fail(req, res, 400, R.fmtTime(lf) + ' 뒤에 바꿀 수 있습니다');
  const other = dbx.q.playerByKey.get(nameKey(name)); if (other && other.id !== pid) return fail(req, res, 409, '이미 사용 중인 이름입니다');
  try { dbx.q.renamePlayer.run(name, nameKey(name), pid); } catch (e) { return fail(req, res, 409, '이미 사용 중인 이름입니다'); }
  const old = P.name; P.name = name; P.nameAt = Math.floor(real); R.log(P, now, '이름을 ' + R.josa('「' + name + '」', '으로', '로') + ' 바꿨습니다', 'news');
  store.markDirty(pid); board.forgetName(pid); log(`이름 변경: ${old} → ${name}`);
  send(req, res, 200, Object.assign({ ok: true }, statePayload(P, now)));
};
// 아이디 찾기: 학생 이름 + 비밀번호가 맞으면 아이디를 알려 준다. 기록이 없는 예전 학생은 여기서 새 아이디를 정한다 (로그인과 같은 횟수 제한)
routes['POST /api/findid'] = async (req, res) => {
  const ip = clientIp(req);
  if (!cfg.testMode && limited('login:' + ip, 10 / 60, 10)) return fail(req, res, 429, '시도가 너무 많습니다. 1분 뒤 다시 시도');
  const b = await readJson(req, 2048);
  const nk = nameKey(String(b.name || '').slice(0, 24)), pw = String(b.password || '').slice(0, 72), nl = String(b.newLogin || '').trim().toLowerCase();
  if (!cfg.testMode && limited('findN:' + nk, 10 / 600, 10)) return fail(req, res, 429, '이 학생 이름으로 시도가 너무 많습니다. 10분 뒤 다시 시도');
  const row = nk ? dbx.q.playerByKey.get(nk) : null;
  if (!row) { await hashPass(pw); return fail(req, res, 401, '학생 이름이나 비밀번호가 맞지 않습니다'); }
  if (!(await checkPass(pw, row.pass))) return fail(req, res, 401, '학생 이름이나 비밀번호가 맞지 않습니다');
  if (row.banned) return fail(req, res, 403, '이용이 정지된 계정입니다');
  const r = dbx.db.prepare('SELECT login_key, login_enc FROM players WHERE id = ?').get(row.id) || {};
  let login = ''; try { login = r.login_enc ? sec.dec(r.login_enc) : ''; } catch (e) { }
  if (!login && r.login_key && r.login_key === sec.index('login:' + nk)) login = row.name;   // 아이디 이전에 가입 → 이름이 아이디
  if (login) return send(req, res, 200, { login });
  if (!nl) return send(req, res, 200, { needNew: true });
  if (!LOGIN_RE.test(nl)) return fail(req, res, 400, LOGIN_RULE);
  if (nl === nk) return fail(req, res, 400, '아이디는 학생 이름과 다르게 정해 주세요');
  const lkey = loginKey(nl), other = dbx.q.playerByLogin.get(lkey);
  if (other && other.id !== row.id) return fail(req, res, 409, '이미 사용 중인 아이디입니다');
  dbx.q.setLoginKey.run(lkey, row.id);
  try { dbx.db.prepare('UPDATE players SET login_enc = ? WHERE id = ?').run(sec.enc(nl), row.id); } catch (e) { }
  oplog('admin', row.name, 'setlogin', row.name + ' 아이디 찾기로 새 아이디 정함');
  send(req, res, 200, { login: nl, set: true });
};
routes['POST /api/login'] = async (req, res) => {
  const ip = clientIp(req);
  if (!cfg.testMode && limited('login:' + ip, 10 / 60, 10)) return fail(req, res, 429, '로그인 시도가 너무 많습니다. 1분 뒤 다시 시도');
  const b = await readJson(req, 2048);
  const login = String(b.login || '').trim().slice(0, 20), pw = String(b.password || '').slice(0, 72), lkey = loginKey(login);
  // 여러 IP에서 한 계정을 노리는 경우도 막는다: 아이디당 10분에 10번
  if (!cfg.testMode && limited('loginN:' + lkey, 10 / 600, 10)) return fail(req, res, 429, '이 아이디로 로그인 시도가 너무 많습니다. 10분 뒤 다시 시도');
  const row = login ? dbx.q.playerByLogin.get(lkey) : null;
  if (!row) { await hashPass(pw); return fail(req, res, 401, '아이디나 비밀번호가 맞지 않습니다'); } // 없는 아이디도 같은 시간이 걸리게
  if (!(await checkPass(pw, row.pass))) return fail(req, res, 401, '아이디나 비밀번호가 맞지 않습니다');
  if (row.banned) return fail(req, res, 403, '이용이 정지된 계정입니다');
  if (needsRehash(row.pass)) dbx.q.setPass.run(await hashPass(pw), row.id);
  let pwTemp = false;
  try { const le = dbx.db.prepare('SELECT login_enc, pw_temp FROM players WHERE id = ?').get(row.id); pwTemp = !!(le && le.pw_temp); if (le && !le.login_enc) dbx.db.prepare('UPDATE players SET login_enc = ? WHERE id = ?').run(sec.enc(LOGIN_RE.test(login.toLowerCase()) ? login.toLowerCase() : login.trim()), row.id); } catch (e) { }   // 예전 학생은 로그인할 때 아이디를 기록 (이름이 아이디인 학생은 이름 그대로)
  const token = newSession(row.id), now = nowSec();
  const P = loadPlayer(row.id, now);
  send(req, res, 200, Object.assign({ token }, statePayload(P, now), pwTemp ? { pwTemp: true } : {}), { 'Set-Cookie': cookie(token, cfg.sessionDays * 86400) });
};
routes['POST /api/logout'] = (req, res) => {
  const tok = getToken(req); if (tok) { dbx.q.delSession.run(tokKey(tok)); sessionCache.delete(tokKey(tok)); }
  send(req, res, 200, { ok: true }, { 'Set-Cookie': cookie('x'.repeat(20), 0) });
};
routes['POST /api/password'] = async (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('pw:' + pid, 3 / 60, 3)) return fail(req, res, 429, '잠시 후 다시 시도');
  const b = await readJson(req, 2048), P = store.get(pid);
  const row = dbx.q.passById.get(pid);
  if (!row || !(await checkPass(String(b.old || ''), row.pass))) return fail(req, res, 401, '현재 비밀번호가 맞지 않습니다');
  const pw = String(b.password || ''); { const why = pwProblem(pw, P.name); if (why) return fail(req, res, 400, why); }
  dbx.q.setPass.run(await hashPass(pw), pid);
  try { dbx.db.prepare('UPDATE players SET pw_temp = 0 WHERE id = ?').run(pid); } catch (e) { }
  send(req, res, 200, { ok: true });
};
routes['GET /api/state'] = (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  if (store.isBanned(pid)) return fail(req, res, 403, '이용이 정지된 계정입니다');
  if (limited('st:' + pid, 2, 6)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const now = nowSec(), P = loadPlayer(pid, now); if (!P) return fail(req, res, 401, '학생 정보를 찾을 수 없습니다');
  send(req, res, 200, statePayload(P, now));
};
// 세계: 내용이 같으면 304 (ETag는 본문 해시). 접속자 수가 바뀌면 본문도 바뀐다.
routes['GET /api/myranks'] = (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('mr:' + pid, 2, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const now = nowSec(), P = loadPlayer(pid, now); if (!P) return fail(req, res, 401, '학생 정보를 찾을 수 없습니다');
  send(req, res, 200, { ranks: world.myRanks(P, R.summary(P, world.W, now).power, now) });
};
routes['GET /api/world'] = (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('w:' + pid, 2, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');   // 학생별로 센다: 학교 와이파이처럼 한 IP에 여럿이 모여도 막히지 않게
  const now = nowSec(); world.tick(now);
  const v = world.publicView(now, store.online(120000)), tag = JSON.stringify(Object.assign({}, v, { now: 0 }));   // 시각(now)은 해시에서 뺀다
  const body = JSON.stringify(v), etag = '"w' + crypto.createHash('sha1').update(tag).digest('base64url').slice(0, 20) + '"';
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, Object.assign({ ETag: etag, 'Cache-Control': 'private, no-cache' }, SEC_HEADERS)); return res.end(); }
  send(req, res, 200, body, { ETag: etag, 'Cache-Control': 'private, no-cache' });
};
routes['POST /api/act'] = async (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  if (store.isBanned(pid)) return fail(req, res, 403, '이용이 정지된 계정입니다');
  if (limited('act:' + pid, 12, 30)) return fail(req, res, 429, '행동이 너무 빠릅니다. 잠시 쉬었다 다시 시도');
  const b = await readJson(req, 8192);
  const type = String(b.type || ''), a = b.a && typeof b.a === 'object' ? b.a : {};
  const now = nowSec(), P = store.get(pid); if (!P) return fail(req, res, 401, '학생 정보를 찾을 수 없습니다');
  syncOp(P);
  if (P.needCreate) return fail(req, res, 400, '새 학생 만들기 필요');
  world.tick(now);
  // 함께 원정 방에서 출발을 기다리는 중이면, 방이 쓸 마지막 빈 원정 슬롯으로 혼자 원정은 못 보낸다
  if (type === 'expStart' && exprooms.inRoom(pid)) { const c0 = R.calc(P, world.ctx(now), now); let free = 0; for (let i = 0; i < c0.expSlots; i++) if (!P.exp[i]) free++; if (free <= 1) return send(req, res, 400, { error: '함께 원정 방에서 출발을 기다리는 중입니다. 혼자 출정하려면 먼저 방 나가기 필요', P: R.publicState(P), now }); }
  let r;
  try {
    const before = P.wk.dmg;
    setPartyN(P); setGuildLv(P);
    const W0 = world.ctx(now); W0.lecPeers = type === 'lecStart' || type === 'ttApply' ? lecCounts(now) : null;
    r = R.act(P, W0, now, type, a); W0.lecPeers = null;
    if (type === 'lecStart' || type === 'lecCancel' || type === 'ttApply') { lecSync(P); if (type === 'lecStart' || type === 'ttApply') { const j = P.lec[type === 'ttApply' ? 0 : Number(a.slot)]; if (j) lecStarted(P, j.s, now); } }
    if (type === 'exam' && r && r.pass) world.addNews(P.name + ' 학생이 ' + (P.grade >= 8 ? '졸업 시험을 통과해 마스터 과정이 되었습니다' : P.grade + '학년으로 진급했습니다'), now);
    if ((type === 'clsExam' || type === 'setCls') && r) setImmediate(() => { try { chat.clsChanged(pid); } catch (e) { } });
    if (type === 'inboxAck' || type === 'expCancel' || type === 'expClaim') setImmediate(() => { try { chat.exrChanged(pid); } catch (e) { } });   // 결과를 받으면 원정 채팅 탭을 닫는다
    if ((type === 'exam' && r && r.pass) || (type === 'useGradeUp' && r && r.grade)) addNote(pid, 'grade', (P.grade >= 8 ? '졸업 시험을 통과해 마스터 과정이 되었습니다' : P.grade + '학년으로 진급했습니다') + ' · 새로 열린 것 보기', { grade: P.grade });
    if (type === 'wbAttack') { const killed = world.applyDamage(pid, P.wk.dmg - before, now); r.killed = killed; world.invalidate(); }
  } catch (e) {
    if (e.game) { store.markDirty(pid); return send(req, res, 400, { error: e.message, P: R.publicState(P), now }); }
    throw e;
  }
  store.markDirty(pid);
  send(req, res, 200, { now, scale: cfg.timeScale, r, P: R.publicState(P), cls: type === 'lecStart' || type === 'lecCancel' ? classView(now) : undefined });
};

/* ───────── 채팅 ───────── */
routes['GET /api/chat/stream'] = (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  if (store.isBanned(pid)) return fail(req, res, 403, '이용이 정지된 계정입니다');
  chat.stream(req, res, pid);
};
routes['POST /api/chat/send'] = async (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  const b = await readJson(req, 4096), P = store.get(pid), meta = dbx.q.playerMeta.get(pid);
  if (!P || !meta || meta.banned || P.needCreate) return fail(req, res, 403, '보낼 수 없습니다');
  try {
    const ch = String(b.ch || ''), now = Date.now() / 1000;
    if (ch === 'dm') { const m = chat.sendDm(P, meta, String(b.to || ''), b.text, now, b.nonce); return send(req, res, 200, { ok: true, id: m.id, dup: !!m.dup }); }
    const m = chat.send(P, meta, ch, b.text, b.kind, now, b.nonce);
    if (m.dup) return send(req, res, 200, { ok: true, id: m.id, dup: true });
    send(req, res, 200, { ok: true, id: m.id });
  } catch (e) { if (e.rate) return send(req, res, 429, { error: e.message, rate: true }); fail(req, res, 400, e.message); }
};
routes['GET /api/dm'] = (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('dmh:' + pid, 2, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const u = new URL(req.url, 'http://x'), peer = u.searchParams.get('peer') || '';
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(peer)) return fail(req, res, 400, '대화 상대가 없습니다');
  send(req, res, 200, { msgs: chat.dmHistory(pid, peer, u.searchParams.get('before'), 50) });
};
routes['GET /api/dm/threads'] = (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('dmt:' + pid, 1, 6)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const th = chat.dmThreads(pid).map((t) => { const p = dbx.q.getProfile.get(t.peer); return p ? Object.assign(t, { name: p.name, house: p.house, av: p.deleted ? 0 : p.avatar_v, online: !p.deleted && isOnline(t.peer), friend: friendState(pid, t.peer) === 'ok', deleted: p.deleted ? true : undefined }) : null; }).filter(Boolean);
  send(req, res, 200, { threads: th });
};
routes['GET /api/chat/history'] = (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('hist:' + pid, 1, 5)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const u = new URL(req.url, 'http://x'), after = u.searchParams.get('after');
  if (after) return send(req, res, 200, chat.historyAfter(u.searchParams.get('ch'), after, pid));   // 지연 채널 따라잡기
  send(req, res, 200, { msgs: chat.history(u.searchParams.get('ch'), u.searchParams.get('before'), 50, pid) });
};
// 지금 보고 있는 월드·RP 탭 (그 연결에만 글 전체를 보낸다). 끊기면 저절로 풀린다.
routes['POST /api/chat/watch'] = async (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('cw:' + pid, 4, 20)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const b = await readJson(req, 512);
  if (!chat.watch(b.cid, String(b.ch || ''), pid)) return fail(req, res, 404, '채팅 연결을 찾을 수 없습니다. 다시 연결 필요');
  send(req, res, 200, { ok: true });
};
routes['POST /api/chat/report'] = async (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('rep:' + pid, 5 / 3600, 5)) return fail(req, res, 429, '신고가 너무 잦습니다');
  const b = await readJson(req, 2048), id = Number(b.id) | 0, m = id && dbx.q.getChat.get(id);
  if (!m) return fail(req, res, 404, '없는 메시지입니다');
  if (dbx.q.reportExists.get(id, pid)) return send(req, res, 200, { ok: true, dup: true });
  dbx.q.insertReport.run(Math.floor(Date.now() / 1000), id, pid, sec.enc(String(b.reason || '').slice(0, 200)));
  log(`채팅 신고: #${id} (${m.name})`);
  send(req, res, 200, { ok: true });
};

// 운영자: 월드 채팅 슬로우 모드 (0 = 끄기, 최대 600초)
routes['POST /api/chat/slow'] = async (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  if (!isChatOp(pid)) return fail(req, res, 403, '운영자만 바꿀 수 있습니다');
  if (limited('slow:' + pid, 1, 5)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const b = await readJson(req, 256); if (String(b.ch || 'world') !== 'world') return fail(req, res, 400, '슬로우 모드는 월드 채팅에만 걸 수 있습니다');
  const before = chat.getSlow(), sec2 = chat.setSlow(b.sec); dbx.kvSet('chat_slow', sec2);
  const P = store.get(pid); oplog(pid, P ? P.name : '', 'slow', `월드 ${before}초 → ${sec2}초`);
  send(req, res, 200, { ok: true, sec: sec2 });
};

// 채팅 스트림 입장권 (EventSource는 헤더를 못 붙이므로, 로그인 토큰 대신 30초짜리 1회용 표를 주소에 싣는다)
routes['POST /api/chat/ticket'] = (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('tk:' + pid, 1, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');
  send(req, res, 200, { k: newTicket(req) });
};

/* ───────── 내 정보 · 두상 · 친구 ───────── */
// 공개 범위: 레벨·전투력(visLv) · 능력치(visStat) · 장비(visEq) — 전체 · 친구만 · 비공개
const VIS = new Set(['all', 'friend', 'none']);
const PROFILE_DEF = { status: '', bio: '', fav: '', avcredit: '', showStats: true, allowFriend: true, bioFriends: false };   // avcredit: 두상 그림 출처 (선택)
function profileOf(json) { let p = {}; try { p = JSON.parse(sec.dec(json) || '{}') || {}; } catch (e) { } const o = Object.assign({}, PROFILE_DEF, p); if (!VIS.has(o.visLv)) o.visLv = o.showStats ? 'all' : 'none'; if (!VIS.has(o.visStat)) o.visStat = 'none'; if (!VIS.has(o.visEq)) o.visEq = 'none'; return o; }
const pubItem = (it) => it && { slot: it.slot, wk: it.wk, name: it.name, ilvl: it.ilvl, r: it.r, enh: it.enh, q: it.q, aff: it.aff, eng: it.eng };
function cleanText(v, max) { return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max); }
function isOnline(pid) { return chat.isOnline(pid) || Date.now() - store.seen(pid) < 180000; }
function friendState(me, other) {
  const a = dbx.q.friendRow.get(me, other), b = dbx.q.friendRow.get(other, me);
  if (a && a.state === 'ok') return 'ok';
  if (a && a.state === 'req') return 'out';
  if (b && b.state === 'req') return 'in';
  return null;
}
routes['GET /api/profile'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('pf:' + me, 3, 20)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const id = new URL(req.url, 'http://x').searchParams.get('id') || me;
  const row = /^[A-Za-z0-9_-]{4,40}$/.test(id) && dbx.q.getProfile.get(id);
  if (row && row.deleted) return send(req, res, 200, { id, deleted: true, name: '삭제된 사용자' });   // 캐릭터 초기화로 남은 예전 캐릭터
  if (!row || row.banned) return fail(req, res, 404, '학생을 찾을 수 없습니다');
  const pr = profileOf(row.profile), self = id === me;
  let lvl = row.lvl, grade = row.grade, power = row.power;
  const LP = self ? store.get(me) : store.peek(id);   // 접속 중인 학생은 메모리의 최신 값으로 (다른 학생은 DB에서 새로 읽어 오지 않음)
  if (LP) { const s = R.summary(LP, world.W, Math.min(nowSec(), LP.at)); lvl = s.lvl; grade = s.grade; power = s.power; }
  const out = { id, op: isChatOp(id) || undefined, name: row.name, house: row.house, grade, guest: !!row.guest, created: row.created, av: row.avatar_v && dbx.q.getAvatar.get(id).avatar ? row.avatar_v : 0,
    status: pr.status, bio: pr.bio, fav: pr.fav, avcredit: pr.avcredit || '', online: self || isOnline(id), self, title: LP ? R.titleName(LP, LP.title) : row.title };
  { const DP = LP || store.get(id); out.deco = R.decoView(DP); if (DP && R.CLS[DP.cls]) out.cls = DP.cls; const bw = DP && R.badgeWorn(DP); if (bw) out.badge = { gem: bw.gem, lv: bw.lv, name: bw.name };
    const fa = DP && DP.opt && DP.opt.showFam && DP.fam && DP.fam.act, fo = fa && DP.fam.own[fa]; if (fo && R.FAM[fa]) out.fam = { id: fa, lv: fo.lv, nm: fo.nm || '' }; }   // 동행 사역마 (학생이 공개를 켰을 때만)   // 정보 카드 꾸미기
  const fs = self ? null : friendState(me, id), can = (v) => self || v === 'all' || (v === 'friend' && fs === 'ok');
  if (can(pr.visLv)) Object.assign(out, { lvl, power, rank: world.rankOf(power) });
  if (can(pr.visStat) || can(pr.visEq)) {
    const DP = LP || store.get(id);
    if (DP && can(pr.visStat)) { const c = R.calc(DP, world.ctx(nowSec()), Math.min(nowSec(), DP.at)), st = {}; R.STATS.forEach((k) => { st[k] = Math.round(c.stat[k]); }); out.stats = { st, dps: Math.round(c.totalDps), hp: Math.round(c.hp), def: Math.round(c.def) }; }
    if (DP && can(pr.visEq)) { out.eq = {}; for (const s in DP.eq) if (DP.eq[s]) out.eq[s] = pubItem(DP.eq[s]); }
  }
  // 동아리 이름 · 직책
  const tg = guildOf.get(id), tgr = tg && dbx.q.gGet.get(tg);
  if (tgr) { const mr = dbx.q.gMember.get(id) || {}; out.guild = { id: tg, name: tgr.name, color: tgr.color, icon: tgr.icon || '', lv: tgr.lv || 1, role: mr.role, rank: R.guildRankName(gRanksOf(tgr), mr.role, mr.rank) }; }
  if (!self) {
    const mg = guildOf.get(me), mgr = mg && dbx.q.gGet.get(mg);
    out.canGuildInvite = !!(mgr && !tg && R.guildCan(gRanksOf(mgr), guildRole.get(me), (dbx.q.gMember.get(me) || {}).rank, 'invite'));
    out.sameParty = !!(partyOf.get(me) && partyOf.get(me) === partyOf.get(id));
  }
  if (self) Object.assign(out, { showStats: pr.showStats, visLv: pr.visLv, visStat: pr.visStat, visEq: pr.visEq, allowFriend: pr.allowFriend, bioFriends: pr.bioFriends });
  else {
    out.friend = fs; out.allowFriend = pr.allowFriend;
    if (pr.bioFriends && out.friend !== 'ok') { out.bio = ''; out.bioHidden = true; }   // 자기소개는 친구에게만
    delete out.created;
  }
  send(req, res, 200, out);
};
routes['POST /api/profile'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('pfs:' + me, 0.2, 5)) return fail(req, res, 429, '잠시 후 다시 저장');
  const b = await readJson(req, 4096), row = dbx.q.getProfile.get(me); if (!row) return fail(req, res, 404, '학생을 찾을 수 없습니다');
  const pr = profileOf(row.profile);
  if (b.status !== undefined) pr.status = cleanText(b.status, 40).replace(/\n/g, ' ');
  if (b.bio !== undefined) pr.bio = cleanText(b.bio, 300);
  if (b.avcredit !== undefined) pr.avcredit = cleanText(b.avcredit, 60).replace(/\n/g, ' ');
  if (b.fav !== undefined) pr.fav = R.SUBJ[b.fav] ? b.fav : '';
  if (b.showStats !== undefined) { pr.showStats = !!b.showStats; pr.visLv = pr.showStats ? 'all' : 'none'; }   // 예전 화면 호환
  ['visLv', 'visStat', 'visEq'].forEach((k) => { if (VIS.has(b[k])) pr[k] = b[k]; });
  pr.showStats = pr.visLv !== 'none';
  if (b.allowFriend !== undefined) pr.allowFriend = !!b.allowFriend;
  if (b.bioFriends !== undefined) pr.bioFriends = !!b.bioFriends;
  dbx.q.setProfile.run(sec.enc(JSON.stringify(pr)), me);
  send(req, res, 200, { ok: true });
};
// 두상: 브라우저가 100×100 JPEG로 줄여서 보낸다. 서버는 형식·크기만 확인하고 그대로 보관한다.
function pngSize(buf) {
  const SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (buf.length < 33 || SIG.some((v, i) => buf[i] !== v) || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xFF) return null;
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}
routes['POST /api/avatar'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('av:' + me, 10 / 3600, 10)) return fail(req, res, 429, '두상은 한 시간에 10번까지 바꿀 수 있습니다');
  const b = await readJson(req, 64 * 1024);
  if (b.img === null) { dbx.q.clearAvatar.run(me); return send(req, res, 200, { ok: true, av: 0 }); }
  // JPEG 또는 배경 투명 PNG (100×100 이하). 형식은 머리 바이트로 다시 확인한다
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.img || ''));
  if (!m) return fail(req, res, 400, 'JPEG · PNG 이미지만 받습니다');
  const buf = Buffer.from(m[2], 'base64'), png = m[1] === 'png';
  if (buf.length > 46 * 1024) return fail(req, res, 400, '이미지가 너무 큽니다');
  const sz = png ? pngSize(buf) : jpegSize(buf);
  if (!sz || sz.w < 16 || sz.h < 16 || sz.w > 100 || sz.h > 100) return fail(req, res, 400, '100×100 이하의 JPEG · PNG만 받습니다');
  dbx.q.setAvatar.run(sec.encBuf(buf), png ? 'image/png' : 'image/jpeg', me);
  send(req, res, 200, { ok: true, av: dbx.q.getAvatar.get(me).avatar_v });
};
routes['GET /api/avatar'] = (req, res) => {
  const me = authed(req); if (!me) { res.writeHead(401, SEC_HEADERS); return res.end(); }
  if (limited('avg:' + me, 20, 200)) { res.writeHead(429, SEC_HEADERS); return res.end(); }
  const uq = new URL(req.url, 'http://x').searchParams, id = uq.get('id') || '';
  const row = /^[A-Za-z0-9_-]{4,40}$/.test(id) && dbx.q.getAvatar.get(id);
  if (!row || !row.avatar) { res.writeHead(404, SEC_HEADERS); return res.end(); }
  const etag = '"av' + row.avatar_v + '"';
  const h = Object.assign({}, SEC_HEADERS, { 'Content-Type': row.avatar_type === 'image/png' ? 'image/png' : 'image/jpeg', 'Cache-Control': String(row.avatar_v) === uq.get('v') ? 'private, max-age=31536000, immutable' : 'private, no-cache', ETag: etag, 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline' });
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, h); return res.end(); }
  let img; try { img = sec.decBuf(row.avatar); } catch (e) { res.writeHead(404, SEC_HEADERS); return res.end(); }
  h['Content-Length'] = img.length; res.writeHead(200, h); res.end(img);
};
const FRIEND_MAX = 100, FRIEND_PENDING_MAX = 30;
// 푸시 알림: 게임을 닫아 두어도 작업이 끝나면 기기로 알린다 (server/push.js)
const push = require('./push.js').create(dbx, sec, { log, nowSec, store, dataDir: cfg.dataDir, subject: cfg.publicOrigin || undefined });
routes['GET /api/push/key'] = (req, res) => { if (!authed(req)) return fail(req, res, 401, '로그인이 필요합니다'); send(req, res, 200, { key: push.publicKey }); };
routes['POST /api/push/sub'] = async (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('push:' + pid, 10 / 60, 10)) return fail(req, res, 429, '잠시 후 다시 시도');
  const why = push.subscribe(pid, await readJson(req, 4096)); if (why) return fail(req, res, 400, why);
  send(req, res, 200, { ok: true });
};
routes['POST /api/push/unsub'] = async (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  const b = await readJson(req, 4096); push.unsubscribe(pid, b.endpoint); send(req, res, 200, { ok: true });
};
// 친구 개인 메모: 쓴 학생에게만 내려 준다 (상대에게는 보이지 않는다)
const memoOf = (m) => { if (!m) return ''; try { return sec.dec(m); } catch (e) { return ''; } };
// 설정 화면: 지금 로그인한 아이디 (본인에게만)
routes['GET /api/me/login'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('ml:' + me, 1, 5)) return fail(req, res, 429, '요청이 너무 잦습니다');
  let login = ''; try { const r = dbx.db.prepare('SELECT login_enc FROM players WHERE id = ?').get(me); login = r && r.login_enc ? sec.dec(r.login_enc) : ''; } catch (e) { }
  send(req, res, 200, { login });
};
routes['GET /api/friends'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('fl:' + me, 1, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const mine = dbx.q.friendList.all(me).map((r) => ({ id: r.id, state: r.state === 'ok' ? 'ok' : 'out', name: r.name, house: r.house, grade: r.grade, lvl: r.lvl, av: r.avatar_v, title: r.title, status: profileOf(r.profile).status, online: r.state === 'ok' && isOnline(r.id), seen: r.last_seen, memo: memoOf(r.memo) }));
  const inc = dbx.q.friendIncoming.all(me).map((r) => ({ id: r.id, name: r.name, house: r.house, grade: r.grade, lvl: r.lvl, av: r.avatar_v, t: r.t }));
  send(req, res, 200, { friends: mine.filter((f) => f.state === 'ok').sort((a, b) => (b.online - a.online) || (b.seen - a.seen)), out: mine.filter((f) => f.state === 'out'), inc });
};
// 학생 이름 검색 (친구 화면): 이름 일부로 찾고, 눌러서 정보창을 열어 친구 신청한다. 게스트 · 정지 학생은 빼고 최근 접속순 20명
routes['GET /api/players'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('ps:' + me, 1, 8)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const q = nameKey(String(new URL(req.url, 'http://x').searchParams.get('q') || '').slice(0, 12));
  if (!q) return send(req, res, 200, { list: [] });
  const rows = dbx.q.playerSearch.all('%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%', q);
  send(req, res, 200, { list: rows.filter((r) => r.id !== me).map((r) => ({ id: r.id, name: r.name, house: r.house, av: r.avatar_v, title: r.title, online: isOnline(r.id), friend: friendState(me, r.id) || null })) });
};
routes['POST /api/friends'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('fr:' + me, 0.5, 10)) return fail(req, res, 429, '잠시 후 다시 시도');
  const b = await readJson(req, 1024), op = String(b.op || '');
  let id = String(b.id || '');
  if (!id && b.name) { const r = dbx.q.playerByKey.get(nameKey(String(b.name).trim())); id = r ? r.id : ''; }
  const other = /^[A-Za-z0-9_-]{4,40}$/.test(id) && dbx.q.getProfile.get(id);
  if (!other || other.banned) return fail(req, res, 404, '학생을 찾을 수 없습니다');
  if (id === me) return fail(req, res, 400, '자기 자신은 친구로 추가할 수 없습니다');
  const t = Math.floor(Date.now() / 1000), st = friendState(me, id);
  if (op === 'add') {
    if (st === 'ok') return send(req, res, 200, { ok: true, state: 'ok' });
    if (Number(dbx.q.friendCount.get(me).n) >= FRIEND_MAX) return fail(req, res, 400, '친구는 ' + FRIEND_MAX + '명까지입니다');
    if (st === 'in') { dbx.tx(() => { dbx.q.friendPut.run(me, id, 'ok', t); dbx.q.friendPut.run(id, me, 'ok', t); }); addNote(id, 'friend', pname(me) + ' 님과 친구가 되었습니다', { me: 'friends' }); return send(req, res, 200, { ok: true, state: 'ok' }); }
    if (!profileOf(other.profile).allowFriend) return fail(req, res, 400, '이 학생은 친구 신청을 받지 않습니다');
    const pending = dbx.q.friendList.all(me).filter((r) => r.state === 'req').length;
    if (pending >= FRIEND_PENDING_MAX) return fail(req, res, 400, '수락을 기다리는 신청이 너무 많습니다');
    dbx.q.friendPut.run(me, id, 'req', t);
    addNote(id, 'friend', pname(me) + ' 님이 친구 신청을 보냈습니다', { me: 'friends' });
    return send(req, res, 200, { ok: true, state: 'out' });
  }
  if (op === 'accept') {
    if (st !== 'in') return fail(req, res, 400, '받은 신청이 없습니다');
    if (Number(dbx.q.friendCount.get(me).n) >= FRIEND_MAX) return fail(req, res, 400, '친구는 ' + FRIEND_MAX + '명까지입니다');
    dbx.tx(() => { dbx.q.friendPut.run(me, id, 'ok', t); dbx.q.friendPut.run(id, me, 'ok', t); });
    addNote(id, 'friend', pname(me) + ' 님이 친구 신청을 받았습니다', { me: 'friends' });
    return send(req, res, 200, { ok: true, state: 'ok' });
  }
  if (op === 'memo') {
    if (st !== 'ok' && st !== 'out') return fail(req, res, 400, '친구에게만 메모를 남길 수 있습니다');
    const memo = String(b.memo || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60);
    dbx.q.friendMemo.run(memo ? sec.enc(memo) : '', me, id);
    return send(req, res, 200, { ok: true, memo });
  }
  if (op === 'remove' || op === 'decline' || op === 'cancel') { dbx.q.friendDel.run(me, id, id, me); return send(req, res, 200, { ok: true, state: null }); }
  fail(req, res, 400, '알 수 없는 요청입니다');
};


/* ───────── 파티 (최대 4명) ─────────
   파티원 한 명당 원정 아르크 +3% (최대 +9%) · 경험치 +1% (최대 +3%). 파티 전용 채팅 채널. */
const PARTY_MAX = 4, PARTY_NAME_RE = /^[가-힣A-Za-z0-9_ ]{2,12}$/;
const partySize = new Map();
dbx.q.partyAllMembers.all().forEach((r) => { partyOf.set(r.pid, r.party); partySize.set(r.party, (partySize.get(r.party) || 0) + 1); });
function setPartyN(P) { const p = partyOf.get(P.id), n = p ? (partySize.get(p) || 1) : 0; if ((P.partyN || 0) !== n) { P.partyN = n; return true; } return false; }
function refreshParty(party) {   // 메모리에 있는 파티원들의 보너스를 바로 갱신
  dbx.q.partyMembers.all(party).forEach((m) => { const P = store.peek(m.id); if (P && setPartyN(P)) store.markDirty(m.id); });
}
function joinParty(pid, party) { dbx.q.partyJoin.run(pid, party, Math.floor(Date.now() / 1000)); partyOf.set(pid, party); partySize.set(party, (partySize.get(party) || 0) + 1); }
function leaveParty(pid) {
  const party = partyOf.get(pid); if (!party) return null;
  dbx.q.partyLeave.run(pid); partyOf.delete(pid);
  const n = (partySize.get(party) || 1) - 1;
  const P = store.peek(pid); if (P && setPartyN(P)) store.markDirty(pid);
  if (n <= 0) { partySize.delete(party); dbx.tx(() => { dbx.q.partyDelete.run(party); dbx.q.partyInviteDelParty.run(party); dbx.q.towerDel.run(party); }); chat.dropParty(party); return { party, gone: true }; }
  partySize.set(party, n);
  const pa = dbx.q.partyGet.get(party);
  if (pa && pa.leader === pid) { const next = dbx.q.partyMembers.all(party)[0]; if (next) dbx.q.partyLeader.run(next.id, party); }
  refreshParty(party);
  return { party, gone: false };
}
// 파티 빈자리를 채우는 아카데미 친구(NPC): parties.npcs = [k, ...]. 파티 보너스 · 탑 보상 대상에서는 빠진다
function partyNpcs(pa) { try { const a = JSON.parse((pa && pa.npcs) || '[]'); return Array.isArray(a) ? a.filter((k) => Number.isInteger(k) && NPCS[k]) : []; } catch (e) { return []; } }
function partyCount(id) { const pa = dbx.q.partyGet.get(id); return (partySize.get(id) || 0) + partyNpcs(pa).length; }
function partyView(me) {
  const id = partyOf.get(me); if (!id) return null;
  const pa = dbx.q.partyGet.get(id); if (!pa) return null;
  return { id, name: pa.name, leader: pa.leader, allgo: !!pa.allgo, max: PARTY_MAX, bonus: R.PARTY_GOLD * (Math.min(partySize.get(id) || 1, 4) - 1), bonusXp: R.PARTY_XP * (Math.min(partySize.get(id) || 1, 4) - 1),
    members: dbx.q.partyMembers.all(id).map((m) => ({ id: m.id, name: m.name, house: m.house, grade: m.grade, lvl: m.lvl, av: m.avatar_v, title: m.title, online: m.id === me || isOnline(m.id), seen: m.last_seen, leader: m.id === pa.leader }))
      .concat(partyNpcs(pa).map((k) => { const n = NPCS[k]; return { id: 'npc:' + k, npc: true, online: true, name: n.name, who: n.who, house: n.house, grade: n.grade, title: 'NPC' }; })),
    npcPool: NPCS.map((n) => ({ k: n.k, name: n.name, who: n.who })) };
}
const partyRec = new Map();   // 파티 → 마지막 모집 알림 시각 (실제 초)
const gRecAt = new Map();     // 동아리 → 마지막 모집 홍보 시각
function recNote(v) { return String(v || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); }
routes['GET /api/party'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('pg:' + me, 1, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');
  send(req, res, 200, { party: partyView(me), invites: dbx.q.partyInvitesFor.all(me).map((r) => ({ party: r.party, name: r.name, by: r.by_name, n: Number(r.n), t: r.t })), max: PARTY_MAX });
};
routes['POST /api/party'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (store.isBanned(me)) return fail(req, res, 403, '이용이 정지된 계정입니다');
  if (limited('pp:' + me, 0.5, 8)) return fail(req, res, 429, '잠시 후 다시 시도');
  const b = await readJson(req, 1024), op = String(b.op || ''), P = store.get(me), now = Date.now() / 1000, mine = partyOf.get(me);
  if (!P) return fail(req, res, 401, '학생 정보를 찾을 수 없습니다');
  if (op === 'create') {
    if (mine) return fail(req, res, 400, '이미 파티에 들어가 있습니다');
    const name = String(b.name || '').replace(/\s+/g, ' ').trim();
    if (!PARTY_NAME_RE.test(name)) return fail(req, res, 400, '파티 이름은 한글·영문·숫자 2~12자만 가능');
    if (R.badName(name)) return fail(req, res, 400, '사용할 수 없는 단어가 포함된 이름입니다');
    const id = crypto.randomBytes(9).toString('base64url');
    dbx.tx(() => { dbx.q.partyInsert.run(id, name, me, Math.floor(now)); });
    joinParty(me, id); setPartyN(P); store.markDirty(me);
    chat.system('party', P.name + ' 님이 파티 「' + name + '」를 만들었습니다.', now, id); chat.partyChanged(me);
    return send(req, res, 200, { ok: true, party: partyView(me) });
  }
  if (op === 'invite') {
    if (!mine) return fail(req, res, 400, '파티 생성 필요');
    if (partyCount(mine) >= PARTY_MAX) return fail(req, res, 400, '파티는 ' + PARTY_MAX + '명까지입니다');
    let id = String(b.id || ''); if (!id && b.name) { const r = dbx.q.playerByKey.get(nameKey(String(b.name).trim())); id = r ? r.id : ''; }
    const t = /^[A-Za-z0-9_-]{4,40}$/.test(id) && dbx.q.getProfile.get(id);
    if (!t || t.banned) return fail(req, res, 404, '학생을 찾을 수 없습니다');
    if (id === me) return fail(req, res, 400, '자기 자신은 초대할 수 없습니다');
    if (partyOf.get(id) === mine) return fail(req, res, 400, '이미 같은 파티입니다');
    if (Number(dbx.q.partyInviteCount.get(id).n) >= 20) return fail(req, res, 400, '이 학생은 초대를 너무 많이 받았습니다');
    dbx.q.partyInvite.run(id, mine, me, Math.floor(now));
    addNote(id, 'party', P.name + ' 님이 파티에 초대했습니다', { view: 'party' });
    return send(req, res, 200, { ok: true });
  }
  if (op === 'accept') {
    const party = String(b.party || '');
    if (mine) return fail(req, res, 400, '현재 파티 탈퇴 필요');
    if (!dbx.q.partyInviteGet.get(me, party)) return fail(req, res, 400, '받은 초대가 없습니다');
    const pa = dbx.q.partyGet.get(party); if (!pa) { dbx.q.partyInviteDel.run(me, party); return fail(req, res, 404, '없어진 파티입니다'); }
    if (partyCount(party) >= PARTY_MAX) return fail(req, res, 400, '파티 자리가 가득 찼습니다');
    dbx.q.partyInviteDel.run(me, party); joinParty(me, party); refreshParty(party);
    chat.system('party', P.name + ' 님이 파티에 들어왔습니다.', now, party); chat.partyChanged(me);
    return send(req, res, 200, { ok: true, party: partyView(me) });
  }
  if (op === 'decline') { dbx.q.partyInviteDel.run(me, String(b.party || '')); return send(req, res, 200, { ok: true }); }
  if (op === 'recruit') {   // 채팅 「모집」 탭에 파티원 모집 (별의 탑 함께 오를 사람). 파티장만, 5분에 한 번. 알림을 본 학생은 30분 동안 바로 들어올 수 있다
    const pa = mine && dbx.q.partyGet.get(mine); if (!pa || pa.leader !== me) return fail(req, res, 403, '파티장만 모집할 수 있습니다');
    if (partyCount(mine) >= PARTY_MAX) return fail(req, res, 400, '파티 자리가 가득 찼습니다');
    const real = Date.now() / 1000, last = partyRec.get(mine) || 0; if (real - last < 300) return fail(req, res, 400, Math.ceil((300 - (real - last)) / 60) + '분 뒤에 다시 모집할 수 있습니다');
    partyRec.set(mine, real);
    chat.recruit(P, { type: 'party', party: mine, name: pa.name, n: partyCount(mine), max: PARTY_MAX, floor: towerState(mine, nowSec()).floor, note: recNote(b.note) }, real);
    return send(req, res, 200, { ok: true });
  }
  if (op === 'joinRec') {   // 모집 알림을 보고 들어가기
    const party = String(b.party || ''), real = Date.now() / 1000;
    if (mine) return fail(req, res, 400, mine === party ? '이미 같은 파티입니다' : '현재 파티 탈퇴 필요');
    const at = partyRec.get(party); if (!at || real - at > 1800) return fail(req, res, 400, '모집이 끝난 파티입니다');
    const pa = dbx.q.partyGet.get(party); if (!pa) { partyRec.delete(party); return fail(req, res, 404, '없어진 파티입니다'); }
    if (partyCount(party) >= PARTY_MAX) return fail(req, res, 400, '파티 자리가 가득 찼습니다');
    joinParty(me, party); refreshParty(party);
    chat.system('party', P.name + ' 님이 모집을 보고 파티에 들어왔습니다.', now, party); chat.partyChanged(me);
    return send(req, res, 200, { ok: true, party: partyView(me) });
  }
  if (op === 'leave') {
    if (!mine) return fail(req, res, 400, '파티에 들어가 있지 않습니다');
    const r = leaveParty(me); if (r && !r.gone) chat.system('party', P.name + ' 님이 파티에서 나갔습니다.', now, r.party);
    chat.partyChanged(me); return send(req, res, 200, { ok: true, party: null });
  }
  if (op === 'kick') {
    const pa = mine && dbx.q.partyGet.get(mine); if (!pa || pa.leader !== me) return fail(req, res, 403, '파티장만 내보낼 수 있습니다');
    const id = String(b.id || ''); if (id === me || partyOf.get(id) !== mine) return fail(req, res, 400, '내보낼 수 없습니다');
    const who = dbx.q.getProfile.get(id); leaveParty(id);
    chat.system('party', (who ? who.name : '학생') + ' 님이 파티에서 나갔습니다.', now, mine); chat.partyChanged(id);
    return send(req, res, 200, { ok: true, party: partyView(me) });
  }
  if (op === 'lead') {
    const pa = mine && dbx.q.partyGet.get(mine); if (!pa || pa.leader !== me) return fail(req, res, 403, '파티장만 넘길 수 있습니다');
    const id = String(b.id || ''); if (partyOf.get(id) !== mine) return fail(req, res, 400, '파티원이 아닙니다');
    dbx.q.partyLeader.run(id, mine); return send(req, res, 200, { ok: true, party: partyView(me) });
  }
  if (op === 'npcAdd' || op === 'npcRemove') {   // 아카데미 친구 부르기 · 보내기 (파티장만)
    const pa = mine && dbx.q.partyGet.get(mine); if (!pa || pa.leader !== me) return fail(req, res, 403, '파티장만 아카데미 친구를 부를 수 있습니다');
    const k = Number(b.k); if (!Number.isInteger(k) || !NPCS[k]) return fail(req, res, 400, '없는 학생입니다');
    let list = partyNpcs(pa);
    if (op === 'npcAdd') {
      if (list.indexOf(k) >= 0) return fail(req, res, 400, '이미 파티에 있습니다');
      if (partyCount(mine) >= PARTY_MAX) return fail(req, res, 400, '파티는 ' + PARTY_MAX + '명까지입니다');
      list.push(k); dbx.q.partySetNpcs.run(JSON.stringify(list), mine); chat.npcSay(mine, NPCS[k], NPCS[k].hello || '잘 부탁해!', now);
    } else { list = list.filter((x) => x !== k); dbx.q.partySetNpcs.run(JSON.stringify(list), mine); chat.system('party', NPCS[k].name + ' 님이 파티에서 나갔습니다.', now, mine); }
    chat.partyChanged(me); return send(req, res, 200, { ok: true, party: partyView(me) });
  }
  if (op === 'allgo') {   // 파티 설정: 파티원도 함께 원정에 파티를 데려갈 수 있게
    const pa = mine && dbx.q.partyGet.get(mine); if (!pa || pa.leader !== me) return fail(req, res, 403, '파티장만 바꿀 수 있습니다');
    dbx.q.partySetAllgo.run(b.on ? 1 : 0, mine); return send(req, res, 200, { ok: true, party: partyView(me) });
  }
  fail(req, res, 400, '알 수 없는 요청입니다');
};

/* ───────── NPC 학생 (결투제 대진표의 학생들) ─────────
   서버판에서는 거래소에만 나온다: 가끔 장비·재료를 올린다 (떠돌이 상인 경매에는 값을 부르지 않는다). (파티원 NPC는 아티팩트 미리보기에만) */
const NPC_HOUSE = { '등불관': 'lanterna', '물시계관': 'clepsydra', '가시왕관관': 'corona', '거울관': 'speculum' };
const NPCS = R.D.RIVALS.map((r, k) => { const h = Object.keys(NPC_HOUSE).find((x) => r.who.indexOf(x) >= 0), g = /(\d)학년/.exec(r.who); return { k, name: r.name, who: r.who, hello: r.hello, lose: r.lose, house: h ? NPC_HOUSE[h] : 'system', grade: g ? +g[1] : 8, lvl: Math.round(r.stage * 1.4) }; });

/* ───────── 거래소 ─────────
   장비와 재료를 아르크로 사고판다. 올린 물건은 맡겨 두고(가방에서 빠짐), 팔리면 판매자에게 아르크(수수료 5% 뺀 값)가 바로 들어간다.
   3일 안에 안 팔리면 돌아온다. 1학년부터, 정식 학생만(게스트로 부계정을 만들어 몰아주는 것을 막기 위함).
   판매 등록은 입학 24시간 뒤부터 (새 캐릭터로 시작 보상을 넘기는 것을 막기 위함). */
const MK = { FEE: 0.05, DAYS: 3, MAX_OPEN: 10, GRADE: +(process.env.MARKET_GRADE || 1), SELL_AFTER: 86400, MAX_PRICE: 1e15 };
// 소지품도 거래 가능: 환수의 알 · 토벌 도전권 · 망각의 차 (별조각으로 산 것을 아르크로 바꾸는 길)
const MK_TOK = {
  egg: { name: '환수의 알', have: (P) => P.fam.eggs || 0, add: (P, n) => { P.fam.eggs = (P.fam.eggs || 0) + n; } },
  ticket: { name: '토벌 도전권', have: (P) => P.wb.extra || 0, add: (P, n) => { P.wb.extra = (P.wb.extra || 0) + n; } },
  respec: { name: '망각의 차', have: (P) => (P.tok && P.tok.respec) || 0, add: (P, n) => { const tk = P.tok || (P.tok = {}); tk.respec = (tk.respec || 0) + n; } }
};
const MAT_NAMES = Object.assign({ stone: { name: '마석' } }, R.D.MATS);
// 맡긴 물건을 학생에게 넣어 준다 (산 사람 · 돌려받는 판매자 공통). pot = 연금술로 만든 물약(선반으로)
function mkGive(P, r) {
  if (r.kind === 'item') { try { P.inv.push(JSON.parse(r.data)); } catch (e) { } }
  else if (r.kind === 'badge') { try { (P.badges || (P.badges = [])).push(JSON.parse(r.data)); } catch (e) { } }   // 아카데미 휘장 (slot=보석, ilvl=레벨)
  else if (r.kind === 'pot') P.shelf[r.data] = (P.shelf[r.data] || 0) + r.qty;
  else if (r.kind === 'tok') { if (MK_TOK[r.data]) MK_TOK[r.data].add(P, r.qty); }
  else if (r.data === 'stone') P.res.stone += r.qty; else P.mats[r.data] = (P.mats[r.data] || 0) + r.qty;
}
function mkAllowed(P, meta, sell) {
  if (!meta || meta.guest) return '게스트는 거래소를 이용할 수 없습니다. 설정에서 정식 학생 등록 필요';
  if (P.grade < MK.GRADE) return MK.GRADE + '학년부터 거래소를 이용할 수 있습니다';
  const wait = sell ? (meta.created || 0) + MK.SELL_AFTER - nowSec() : 0;
  if (wait > 0) return '판매 등록은 입학 24시간 뒤부터 가능합니다 (남은 시간 ' + R.fmtTime(wait) + ')';
  return null;
}
const mkQueries = new Map();
function mkSearch(f, now) {
  const where = [`m.status = 'open'`, `m.expires > ?`], args = [Math.floor(now)];
  if (f.kind === 'item' || f.kind === 'mat' || f.kind === 'pot' || f.kind === 'badge' || f.kind === 'tok') { where.push('m.kind = ?'); args.push(f.kind); }
  if (f.kind === 'badge' && f.gem && R.GEM[f.gem]) { where.push('m.slot = ?'); args.push(f.gem); }
  if (f.kind !== 'badge' && f.slot === 'sword') { where.push(`m.slot = 'staff' AND m.data LIKE '%"wk":"sword"%'`); }   // 무기 중 검
  else if (f.kind !== 'badge' && f.slot === 'staff') { where.push(`m.slot = 'staff' AND m.data NOT LIKE '%"wk":"sword"%'`); }   // 무기 중 지팡이
  else if (f.kind !== 'badge' && f.slot === 'manual') { where.push(`m.slot = 'tome' AND m.data LIKE '%"wk":"manual"%'`); }   // 마도서 칸 중 전술서
  else if (f.kind !== 'badge' && f.slot === 'tome') { where.push(`m.slot = 'tome' AND m.data NOT LIKE '%"wk":"manual"%'`); }   // 마도서 칸 중 마도서
  else if (f.kind !== 'badge' && f.slot && R.SLOT[f.slot]) { where.push('m.slot = ?'); args.push(f.slot); }
  if (f.r >= 0 && f.r <= 4) { where.push('m.rarity = ?'); args.push(f.r); }
  if (f.mat && MAT_NAMES[f.mat]) { where.push('m.data = ?'); args.push(f.mat); }
  if (f.pot && R.POT[f.pot]) { where.push('m.data = ?'); args.push(f.pot); }
  if (f.kind === 'tok' && f.tok && MK_TOK[f.tok]) { where.push('m.data = ?'); args.push(f.tok); }
  if (f.q) { where.push(`m.name LIKE ? ESCAPE '\\'`); args.push('%' + f.q.replace(/[\\%_]/g, (c) => '\\' + c) + '%'); }
  const dir = f.sort === 'high' ? 'DESC' : 'ASC';
  const order = f.sort === 'new' ? 'm.id DESC' : f.sort === 'lvl' ? 'm.ilvl DESC, m.price ASC' : f.kind === 'mat' || f.kind === 'pot' || f.kind === 'tok' ? 'm.price / m.qty ' + dir : 'm.price ' + dir;
  const sql = `SELECT m.id, m.kind, m.data, m.name, m.slot, m.rarity, m.ilvl, m.qty, m.price, m.created, m.expires, m.seller, COALESCE(p.name, m.seller_name) AS seller_name FROM market m LEFT JOIN players p ON p.id = m.seller WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 60`;
  let st = mkQueries.get(sql); if (!st) { st = dbx.db.prepare(sql); mkQueries.set(sql, st); }
  return st.all(...args);
}
function mkOut(r, me) {
  const o = { id: r.id, kind: r.kind, name: r.name, slot: r.slot, r: r.rarity, ilvl: r.ilvl, qty: r.qty, price: r.price, created: r.created, expires: r.expires, seller: r.seller_name, npc: String(r.seller).startsWith('npc:'), mine: r.seller === me, status: r.status };
  if (r.kind === 'item') { try { const it = JSON.parse(r.data); delete it.lock; delete it.u; o.item = it; } catch (e) { } } else if (r.kind === 'badge') { try { const bd = JSON.parse(r.data); delete bd.u; o.badge = bd; o.gem = bd.gem; o.lv = bd.lv; } catch (e) { } } else if (r.kind === 'pot') o.pot = r.data; else if (r.kind === 'tok') o.tok = r.data; else o.mat = r.data;
  return o;
}
function mkReturn(r, why, now) {   // 맡긴 물건을 판매자에게 돌려준다
  if (String(r.seller).startsWith('npc:')) return;
  const P = store.get(r.seller); if (!P) return;
  R.advance(P, world.ctx(now), now);
  mkGive(P, r);
  R.log(P, now, '거래소: ' + r.name + (r.kind !== 'item' ? ' ' + r.qty + '개' : '') + ' ' + why, 'news');
  store.markDirty(r.seller);
}
routes['GET /api/market'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('mk:' + me, 2, 15)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const u = new URL(req.url, 'http://x'), g = (k) => u.searchParams.get(k) || '', now = Date.now() / 1000;
  const f = { kind: g('kind'), slot: g('slot'), r: g('r') === '' ? -1 : Number(g('r')), mat: g('mat'), pot: g('pot'), tok: g('tok'), gem: g('gem'), q: g('q').slice(0, 20), sort: g('sort') };
  send(req, res, 200, { list: mkSearch(f, now).map((r) => mkOut(r, me)), mine: dbx.q.mkMine.all(me, Math.floor(now) - 3 * 86400).map((r) => mkOut(Object.assign({ seller_name: '' }, r, { seller: me }), me)), fee: MK.FEE, days: MK.DAYS, maxOpen: MK.MAX_OPEN, grade: MK.GRADE });
};
// 시세: 최근 30일 팔린 기록의 평균과 최근 5건. 장비는 같은 부위·등급·레벨 ±5, 재료는 개당 가격.
const mkPriceCache = new Map();
function mkPrice(key, real) {
  const c = mkPriceCache.get(key); if (c && real - c.at < 60) return c.v;
  const p = key.split(':'), since = Math.floor(real) - 30 * 86400; let rows = [], v = null;
  if (p[0] === 'item' && R.SLOT[p[1]] && /^[0-4]$/.test(p[2]) && /^\d{1,6}$/.test(p[3])) { const lv = +p[3]; rows = dbx.q.mkSoldItem.all(p[1], +p[2], lv - 5, lv + 5, since); }
  else if (p[0] === 'mat' && MAT_NAMES[p[1]]) rows = dbx.q.mkSoldMat.all(p[1], since);
  else if (p[0] === 'pot' && R.POT[p[1]]) rows = dbx.q.mkSoldPot.all(p[1], since);
  else if (p[0] === 'tok' && MK_TOK[p[1]]) rows = dbx.q.mkSoldTok.all(p[1], since);
  else if (p[0] === 'badge' && R.GEM[p[1]] && /^\d{1,3}$/.test(p[2])) { const lv = +p[2]; rows = dbx.q.mkSoldBadge.all(p[1], lv - 2, lv + 2, since); }
  else return null;
  if (rows.length) { const unit = rows.map((r) => r.price / Math.max(1, r.qty)); v = { avg: Math.round(unit.reduce((a, b) => a + b, 0) / unit.length), n: rows.length, recent: rows.slice(0, 5).map((r) => ({ t: r.done_at, price: r.price, qty: r.qty, ilvl: r.ilvl || 0, name: r.name })) }; }
  else v = { avg: 0, n: 0, recent: [] };
  mkPriceCache.set(key, { at: real, v }); if (mkPriceCache.size > 3000) mkPriceCache.delete(mkPriceCache.keys().next().value);
  return v;
}
routes['GET /api/market/prices'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('mkpr:' + me, 1, 6)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const keys = String(new URL(req.url, 'http://x').searchParams.get('keys') || '').split(',').filter(Boolean).slice(0, 50), real = Date.now() / 1000, out = {};
  keys.forEach((k) => { const v = mkPrice(k, real); if (v) out[k] = v; });
  send(req, res, 200, { prices: out });
};
// 실시간 거래: 막 팔린 물건 (누가 샀는지는 보이지 않는다)
const mkTradeOut = (r) => ({ id: r.id, kind: r.kind, name: r.name, slot: r.slot, r: r.rarity, ilvl: r.ilvl, qty: r.qty, price: r.price, t: r.done_at });
// 나의 거래 내역: 최근 30일 판 것 · 산 것 (산 사람 이름은 판매자에게도 보이지 않는다)
routes['GET /api/market/history'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('mkh:' + me, 1, 6)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const since = Math.floor(Date.now() / 1000) - 30 * 86400;
  send(req, res, 200, { fee: MK.FEE, list: dbx.q.mkHistory.all(me, me, since).map((r) => ({ id: r.id, side: r.seller === me ? 'sell' : 'buy', kind: r.kind, name: r.name, slot: r.slot, r: r.rarity, ilvl: r.ilvl, qty: r.qty, price: r.price, got: r.seller === me ? Math.floor(r.price * (1 - MK.FEE)) : 0, t: r.done_at, seller: r.seller === me ? '' : r.seller_name, npc: String(r.seller).startsWith('npc:') })) });
};
routes['GET /api/market/trades'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('mktr:' + me, 1, 6)) return fail(req, res, 429, '요청이 너무 잦습니다');
  send(req, res, 200, { trades: dbx.q.mkTrades.all(50).map(mkTradeOut) });
};
routes['POST /api/market'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (store.isBanned(me)) return fail(req, res, 403, '이용이 정지된 계정입니다');
  if (limited('mkp:' + me, 1, 10)) return fail(req, res, 429, '잠시 후 다시 시도');
  const b = await readJson(req, 2048), op = String(b.op || ''), now = nowSec(), meta = dbx.q.playerMeta.get(me);
  const P = loadPlayer(me, now); if (!P) return fail(req, res, 401, '학생 정보를 찾을 수 없습니다');
  const no = mkAllowed(P, meta, op === 'list'); if (no) return fail(req, res, 403, no);
  const real = Date.now() / 1000;
  if (op === 'list') {
    if (Number(dbx.q.mkMineOpen.get(me).n) >= MK.MAX_OPEN) return fail(req, res, 400, '한 번에 ' + MK.MAX_OPEN + '개까지 올릴 수 있습니다');
    const price = Math.floor(Number(b.price)); if (!isFinite(price) || price < 1 || price > MK.MAX_PRICE) return fail(req, res, 400, '가격 확인 필요');
    let row;
    if (b.u) {
      const i = P.inv.findIndex((it) => it.u === String(b.u)); if (i < 0) return fail(req, res, 400, '가방에 없는 장비입니다 (장착 중인 장비는 해제한 뒤 올리세요)');
      const it = P.inv[i]; if (it.lock) return fail(req, res, 400, '잠금한 장비는 올릴 수 없습니다');
      P.inv.splice(i, 1);
      row = ['item', JSON.stringify(it), it.name + (it.enh ? ' +' + it.enh : ''), it.slot, it.r, it.ilvl, 1];
    } else if (b.badge) {   // 아카데미 휘장 (달고 있는 것은 못 올림)
      const i = (P.badges || []).findIndex((x) => x.u === String(b.badge)); if (i < 0) return fail(req, res, 400, '없는 휘장입니다');
      if (P.badges[i].lock) return fail(req, res, 400, '잠금한 휘장은 올릴 수 없습니다');
      if (P.badges[i].u === P.badgeOn) return fail(req, res, 400, '달고 있는 휘장은 올릴 수 없습니다. 먼저 장착 해제 필요');
      const bd = P.badges.splice(i, 1)[0];
      row = ['badge', JSON.stringify(bd), bd.name + ' Lv ' + bd.lv, bd.gem, 0, bd.lv, 1];
    } else if (b.pot) {
      const id = String(b.pot), qty = Math.floor(Number(b.qty)); if (!R.POT[id]) return fail(req, res, 400, '없는 물약입니다');
      if (!(qty >= 1 && qty <= (P.shelf[id] || 0))) return fail(req, res, 400, '수량 확인 필요');
      P.shelf[id] -= qty;
      row = ['pot', id, R.POT[id].name, '', 0, 0, qty];
    } else if (b.tok) {   // 소지품: 환수의 알 · 토벌 도전권 · 망각의 차
      const id = String(b.tok), T = MK_TOK[id], qty = Math.floor(Number(b.qty)); if (!T) return fail(req, res, 400, '거래할 수 없는 소지품입니다');
      if (!(qty >= 1 && qty <= T.have(P))) return fail(req, res, 400, '수량 확인 필요');
      T.add(P, -qty);
      row = ['tok', id, T.name, '', 0, 0, qty];
    } else {
      const m = String(b.mat || ''), qty = Math.floor(Number(b.qty)); if (!MAT_NAMES[m]) return fail(req, res, 400, '없는 재료입니다');
      const have = m === 'stone' ? P.res.stone : (P.mats[m] || 0);
      if (!(qty >= 1 && qty <= have)) return fail(req, res, 400, '수량 확인 필요');
      if (m === 'stone') P.res.stone -= qty; else P.mats[m] -= qty;
      row = ['mat', m, MAT_NAMES[m].name, '', 0, 0, qty];
    }
    dbx.q.mkInsert.run(me, row[0], row[1], row[2], row[3], row[4], row[5], row[6], price, Math.floor(real), Math.floor(real + MK.DAYS * 86400), P.name);
    R.log(P, now, '거래소에 ' + R.josa(row[2] + (row[0] !== 'item' ? ' ' + row[6] + '개' : ''), '을', '를') + ' ' + R.fmt(price) + ' ' + CUR + '에 올렸습니다', 'news');
    store.markDirty(me);
    return send(req, res, 200, { ok: true, P: R.publicState(P), now });
  }
  const id = Number(b.id) | 0, r = id && dbx.q.mkGet.get(id);
  if (!r || r.status !== 'open') return fail(req, res, 404, '이미 팔렸거나 내려간 물건입니다');
  if (op === 'cancel') {
    if (r.seller !== me) return fail(req, res, 403, '내 물건이 아닙니다');
    if (r.kind === 'item' && P.inv.length >= R.calc(P, world.ctx(now), now).bag) return fail(req, res, 400, '가방이 가득 찼습니다');
    if (!dbx.q.mkSetStatus.run('canceled', '', Math.floor(real), id).changes) return fail(req, res, 409, '이미 처리된 물건입니다');
    mkReturn(r, '판매를 취소해 돌려받았습니다', now);
    return send(req, res, 200, { ok: true, P: R.publicState(P), now });
  }
  if (op === 'buy') {
    if (r.seller === me) return fail(req, res, 400, '내가 올린 물건입니다');
    if (r.expires <= real) return fail(req, res, 404, '기한이 지난 물건입니다');
    if (P.res.gold < r.price) return fail(req, res, 400, CUR + '가 부족합니다');
    if (r.kind === 'item' && P.inv.length >= R.calc(P, world.ctx(now), now).bag) return fail(req, res, 400, '가방이 가득 찼습니다');
    if (r.kind === 'badge' && (P.badges || []).length >= R.BADGE_HOLD) return fail(req, res, 400, '휘장 보관함이 가득 찼습니다 (' + R.BADGE_HOLD + '개)');
    if (!dbx.q.mkSetStatus.run('sold', me, Math.floor(real), id).changes) return fail(req, res, 409, '방금 다른 학생이 샀습니다');
    P.res.gold -= r.price;
    mkGive(P, r);
    R.log(P, now, '거래소에서 ' + R.josa(r.name + (r.kind !== 'item' ? ' ' + r.qty + '개' : ''), '을', '를') + ' ' + R.fmt(r.price) + ' ' + CUR + '에 샀습니다', 'good');
    store.markDirty(me);
    const SP = String(r.seller).startsWith('npc:') ? null : store.get(r.seller);
    if (String(r.seller).startsWith('npc:')) setImmediate(() => { try { npcMarketTick(); } catch (e) { } });   // NPC 매물이 팔리면 바로 채운다
    if (SP) addNote(r.seller, 'market', '거래소에서 ' + R.josa(r.name + (r.kind !== 'item' ? ' ' + r.qty + '개' : ''), '이', '가') + ' 팔렸습니다 · ' + R.fmt(Math.floor(r.price * (1 - MK.FEE))) + ' ' + CUR + ' (' + P.name + ' 님)', { view: 'market' });
    if (SP) { const got = Math.floor(r.price * (1 - MK.FEE)); R.advance(SP, world.ctx(now), now); SP.res.gold += got; SP.st.goldTotal = (SP.st.goldTotal || 0) + got; R.log(SP, now, '거래소: ' + r.name + (r.kind !== 'item' ? ' ' + r.qty + '개' : '') + ' 판매 +' + R.fmt(got) + ' ' + CUR + ' (수수료 ' + Math.round(MK.FEE * 100) + '%)', 'good'); store.markDirty(r.seller); }
    log(`거래: #${id} ${r.name} ${r.price}G`);
    chat.pingAll('trade', mkTradeOut(Object.assign({}, r, { done_at: Math.floor(real) })));
    return send(req, res, 200, { ok: true, P: R.publicState(P), now });
  }
  fail(req, res, 400, '알 수 없는 요청입니다');
};
function mkSweep() {
  const real = Date.now() / 1000, now = nowSec();
  dbx.q.mkExpired.all(Math.floor(real)).forEach((r) => { if (dbx.q.mkSetStatus.run('expired', '', Math.floor(real), r.id).changes) mkReturn(r, '판매 기한(' + MK.DAYS + '일)이 지나 돌아왔습니다', now); });
  dbx.q.mkPurge.run(Math.floor(real) - 14 * 86400);
}
// NPC 학생들이 장비 · 재료 · 물약 · 휘장을 올린다 (R.npcLot: 서버 · 데모 공용). 학생들의 진도 하나를 골라 그에 맞춘 매물, 1~2일 뒤 만료
function npcList(n, wantMat) {
  const real = Date.now() / 1000;
  const stages = dbx.db.prepare(`SELECT max_stage FROM players WHERE last_seen > ? AND banned = 0`).all(Math.floor(real) - 7 * 86400).map((r) => r.max_stage);
  const rand = () => crypto.randomInt(0, 1e9) / 1e9;
  for (let i = 0; i < n; i++) {
    const npc = NPCS[crypto.randomInt(NPCS.length)], life = Math.floor(real + (1 + Math.random()) * 86400);
    const stage = Math.min(200, stages.length ? stages[crypto.randomInt(stages.length)] : 10);
    const x = R.npcLot(stage, !!wantMat, rand);
    let row;
    if (x.kind === 'item') row = ['item', JSON.stringify(x.item), x.name, x.slot, x.r, x.ilvl, 1];
    else if (x.kind === 'badge') row = ['badge', JSON.stringify(x.badge), x.name, x.gem, 0, x.lv, 1];
    else if (x.kind === 'pot') row = ['pot', x.pot, x.name, '', 0, 0, x.qty];
    else if (x.kind === 'mat' && MAT_NAMES[x.mat]) row = ['mat', x.mat, x.name, '', 0, 0, x.qty];
    if (!row) continue;
    dbx.q.mkInsert.run('npc:' + npc.k, row[0], row[1], row[2], row[3], row[4], row[5], row[6], Math.max(1, Math.round(x.price)), Math.floor(real), life, npc.name);
  }
}
const NPC_OPEN = 12;
function npcMarketTick(force) {
  const open = Number(dbx.q.mkNpcOpen.get().n), mats = Number(dbx.db.prepare(`SELECT COUNT(*) n FROM market WHERE status='open' AND kind='mat' AND seller LIKE 'npc:%'`).get().n);
  if (mats < 3) npcList(3 - mats, true);                    // 재료도 늘 몇 묶음은 있게
  if (open < NPC_OPEN) npcList(NPC_OPEN - open);           // 팔리거나 만료되면 다시 채운다
  else if (open < NPC_OPEN + 6 && (force || Math.random() < 0.3)) npcList(1);
}
mkSweep(); npcMarketTick(true);


/* ───────── 별의 탑 (파티 콘텐츠) ─────────
   파티가 한 주 동안 함께 층을 쌓는다. 도전은 학생마다 하루 3번, 도전한 학생의 전투에 파티원 모두의 힘을 싣는다(접속하지 않아도).
   층을 처음 넘을 때마다 그때의 파티원 모두에게 우편(7일)으로 보상. 매주 월요일에 0층부터 다시. */
function towerState(party, now) {
  const week = R.weekId(now), row = dbx.q.towerGet.get(party);
  let x = { base: null, log: [] }; if (row) { try { x = JSON.parse(row.log); } catch (e) { } }
  if (!row || row.week !== week) return { week, floor: 0, base: null, log: [] };
  return { week, floor: row.floor, base: x.base || null, log: x.log || [] };
}
function towerTeam(party, me, now) {
  const pa = dbx.q.partyGet.get(party), ctx = world.ctx(now), out = [];
  const meP = store.get(me), c0 = R.calc(meP, ctx, now);
  dbx.q.partyMembers.all(party).forEach((m) => { const Q = m.id === me ? meP : store.get(m.id); if (!Q) return; const c = m.id === me ? c0 : R.calc(Q, ctx, now); out.push({ id: m.id, name: Q.name, house: Q.house, dps: c.totalDps, hp: c.hp, def: c.def, stage: Q.maxStage, me: m.id === me }); });
  const f = R.NPC_FRAC.tower; partyNpcs(pa).forEach((k) => { const n = NPCS[k]; out.push({ id: 'npc:' + k, name: n.name, house: n.house, npc: true, dps: c0.totalDps * f, hp: c0.hp * f, def: c0.def }); });
  return { team: out, c0 };
}
function towerView(me, now) {
  const party = partyOf.get(me); if (!party) return { party: null };
  const st = towerState(party, now), { team, c0 } = towerTeam(party, me, now), P = store.get(me);
  // 대본이 흐르는 동안은 도전 전 층을 보여 준다 (결과가 일지보다 먼저 새지 않게)
  const pl = towerPlaying(st), last = st.log[st.log.length - 1], shown = pl && last.win ? st.floor - 1 : st.floor;
  const base = st.base || R.towerBase(team.filter((m) => !m.npc).map((m) => m.stage)), f = shown + 1, foe = R.towerFoe(f, base), c2 = R.towerTeam(c0, team);
  return { party, week: st.week, weekEnd: R.weekStart(st.week + 1), floor: shown, playing: pl, base, fixed: !!st.base, log: st.log.slice(-12).reverse().map(towerLogOut), now: Date.now() / 1000, left: R.towerLeft(P, now), tries: R.TOWER_TRIES, myBest: R.towerBest(P, now),
    team: team.map((m) => ({ id: m.id, name: m.name, house: m.house, npc: !!m.npc, dps: m.dps, me: !!m.me })), teamDps: c2.totalDps, teamHp: c2.hp,
    next: { floor: f, stage: foe.stage, name: foe.name, arch: foe.arch, c1: foe.c1, c2: foe.c2, hp: foe.hp, est: R.towerEstimate(c2, foe), reward: R.towerReward(f, base) } };
}
// 일지 한 줄: 최근 몇 번의 도전만 대본(sc)을 들고 있다
function towerLogOut(l) { return { t: l.t, name: l.name, f: l.f, win: l.win, pct: l.pct, sc: l.sc || null, d: l.d || 0 }; }
// 대본이 아직 흐르는 중인 도전 (그동안은 다른 파티원이 도전하지 않고 함께 지켜본다)
function towerPlaying(st) { const l = st.log[st.log.length - 1], real = Date.now() / 1000; return l && l.sc && l.t + (l.d || 0) > real ? { name: l.name, f: l.f, left: Math.ceil(l.t + l.d - real) } : null; }
function towerPing(party, data) { dbx.q.partyMembers.all(party).forEach((m) => chat.ping(m.id, 'tower', data)); }
const towerBusy = new Set();
routes['GET /api/tower'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('twg:' + me, 1, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');
  send(req, res, 200, towerView(me, nowSec()));
};
routes['POST /api/tower'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (store.isBanned(me)) return fail(req, res, 403, '이용이 정지된 계정입니다');
  if (limited('twp:' + me, 0.5, 4)) return fail(req, res, 429, '잠시 후 다시 시도');
  await readJson(req, 256);
  const party = partyOf.get(me); if (!party) return fail(req, res, 400, '파티에 들어가 있어야 별의 탑에 오를 수 있습니다');
  if (towerBusy.has(party)) return fail(req, res, 409, '파티원이 지금 도전하고 있습니다. 잠시 후 다시 시도');
  towerBusy.add(party);
  try {
    const now = nowSec(), P = loadPlayer(me, now); if (!P) return fail(req, res, 401, '학생 정보를 찾을 수 없습니다');
    if (R.towerLeft(P, now) <= 0) return fail(req, res, 400, '오늘 도전 횟수를 다 썼습니다 (매일 자정에 ' + R.TOWER_TRIES + '번으로 돌아옵니다)');
    const st = towerState(party, now), { team, c0 } = towerTeam(party, me, now);
    const pl = towerPlaying(st); if (pl) return fail(req, res, 409, pl.name + ' 님이 ' + pl.f + '층에 도전하는 중입니다. 함께 지켜보세요 (' + pl.left + '초 남음)');
    const base = st.base || R.towerBase(team.filter((m) => !m.npc).map((m) => m.stage)), f = st.floor + 1, foe = R.towerFoe(f, base), c2 = R.towerTeam(c0, team);
    R.towerUse(P, now);
    const r = R.towerFight(P, c2, foe), pa = dbx.q.partyGet.get(party);
    const sc = R.towerScript({ name: P.name, f, foe, team, r, hp: c2.hp }), t0 = Math.round(Date.now() / 100) / 10, after = Math.round(sc.d * 1000);
    st.log.forEach((l, i) => { if (i < st.log.length - 4) { delete l.sc; delete l.d; } });
    st.log.push({ t: t0, name: P.name, f, win: !!r.win, pct: Math.round((1 - r.mHp) * 100), sc: sc.lines, d: sc.d }); if (st.log.length > 30) st.log.splice(0, st.log.length - 30);
    // 결과(파티 채팅 알림·우편 알림)는 대본이 끝난 뒤에 알린다 → 지켜보는 동안 결과가 먼저 새지 않게
    const later = (fn) => setTimeout(fn, after).unref();
    let reward = null;
    if (r.win) {
      reward = R.towerReward(f, base);
      const exp = Math.floor(Date.now() / 1000) + 7 * 86400, body = P.name + ' 님이 파티 「' + (pa ? pa.name : '') + '」의 힘을 모아 별의 탑 ' + f + '층의 ' + R.josa(foe.name, '을', '를') + ' 쓰러뜨렸습니다.\n그때 파티에 있던 모두에게 보내는 보상입니다.';
      const skipped = [];
      team.filter((m) => !m.npc).forEach((m) => { const Q = m.id === me ? P : store.get(m.id); if (!Q) return; if (R.towerClaim(Q, now, f)) { sendMail(m.id, '별의 탑', '별의 탑 ' + f + '층 돌파', body, reward, exp, true, after); store.markDirty(m.id); } else skipped.push(Q.name); });
      later(() => {
        if (skipped.length) chat.system('party', skipped.join(', ') + ' 님은 이번 주에 다른 파티에서 이미 ' + f + '층 이상의 보상을 받아 이번 보상은 건너뜁니다.', Date.now() / 1000, party);
        chat.system('party', '✦ ' + P.name + ' 님이 별의 탑 ' + f + '층을 넘었습니다! 파티원 모두에게 보상 우편이 갔습니다.', Date.now() / 1000, party);
      });
      later(() => { const Q = store.get(me); if (Q) { R.log(Q, nowSec(), '별의 탑 ' + f + '층 돌파', 'good'); store.markDirty(me); } });   // 활동 기록도 대본이 끝난 뒤에
    } else {
      later(() => chat.system('party', P.name + ' 님이 별의 탑 ' + f + '층에 도전했지만 물러났습니다 (' + Math.round((1 - r.mHp) * 100) + '%)', Date.now() / 1000, party));
    }
    dbx.q.towerPut.run(party, st.week, r.win ? f : st.floor, JSON.stringify({ base, log: st.log }));
    store.markDirty(me);
    towerPing(party, { by: P.name, f, start: true }); later(() => towerPing(party, { by: P.name, f, end: true }));
    send(req, res, 200, Object.assign(statePayload(P, now), { r: { win: !!r.win, ev: r.ev, mHp: r.mHp, dead: !!r.dead, floor: f, foe: { name: foe.name, arch: foe.arch, c1: foe.c1, c2: foe.c2, id: foe.id }, maxHp: foe.hp, reward: reward ? R.rewardText(reward) : '', sc: sc.lines, d: sc.d, t0 } }));
  } finally { towerBusy.delete(party); }
};

/* ───────── 별샘 의식 ─────────
   하루에 한 번, 학생마다 마나 30분 분을 봉헌한다. 그날 목표(최근 활동 학생의 35%, 최소 5명)를 채우면 봉헌한 모두에게 4시간 축복. */
let rit = dbx.kvGet('ritual', null) || { day: -1, pids: [], done: 0, goal: 5 };
function ritState(now) { const d = R.dayKST(now); if (rit.day !== d) { rit = { day: d, pids: [], done: 0, goal: R.ritualGoal(active24()) }; dbx.kvSet('ritual', rit); } return rit; }
function ritView(P, now) { const st = ritState(now); return { n: st.pids.length, goal: st.goal, done: st.done, mine: !!P && P.rit === st.day, cost: P ? R.ritualCost(P, world.ctx(now), now) : 0 }; }
let ritPingAt = 0;
routes['POST /api/ritual'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (store.isBanned(me)) return fail(req, res, 403, '이용이 정지된 계정입니다');
  if (limited('rit:' + me, 0.5, 3)) return fail(req, res, 429, '잠시 후 다시 시도');
  await readJson(req, 256);
  const now = nowSec(), P = loadPlayer(me, now); if (!P) return fail(req, res, 401, '학생 정보를 찾을 수 없습니다');
  const st = ritState(now); if (P.rit === st.day) return fail(req, res, 400, '오늘은 이미 봉헌했습니다');
  const cost = R.ritualCost(P, world.ctx(now), now); if (P.res.mana < cost) return fail(req, res, 400, '마나가 모자랍니다 (마나 ' + R.fmt(cost) + ' 필요)');
  P.res.mana -= cost; P.rit = st.day; P.res.shard += 1; st.pids.push(me);
  R.log(P, now, '별샘 의식에 마나 ' + R.josa(R.fmt(cost), '을', '를') + ' 봉헌했습니다 (별조각 +1)', 'news');
  if (st.done) R.ritualBless(P, now);
  else if (st.pids.length >= st.goal) {
    st.done = now;
    st.pids.forEach((pid) => { const Q = pid === me ? P : store.get(pid); if (Q) { R.ritualBless(Q, now); R.log(Q, now, '별샘 의식이 이루어졌습니다. ' + R.RITUAL_BUFF.text, 'story'); store.markDirty(pid); } });
    chat.system('notice', '✦ 오늘의 별샘 의식이 이루어졌습니다! 봉헌한 ' + st.pids.length + '명에게 별샘의 축복 — ' + R.RITUAL_BUFF.text + '. 아직 봉헌하지 않았다면 지금 봉헌해도 축복을 받습니다.', Date.now() / 1000);
  }
  dbx.kvSet('ritual', st); store.markDirty(me);
  if (Date.now() - ritPingAt > 1000 || st.done === now) { ritPingAt = Date.now(); chat.pingAll('ritual', { n: st.pids.length, goal: st.goal, done: st.done }); }
  send(req, res, 200, Object.assign(statePayload(P, now), { ok: true }));
};

/* ───────── 떠돌이 상인 경매 ─────────
   하루 세 번(12시 · 18시 · 22시, 1시간) 구간(신입생 · 중급 · 상급)마다 귀한 장비 세 점씩 경매에 붙인다. 부른 값은 바로 맡겨 두고, 더 높은 값이 나오면 돌려준다.
   끝나기 2분 안에 부르면 2분 늘어난다 (몇 번이든, 정해진 2시간이 지나도). 낙찰품은 우편으로. 값은 학생만 부른다(NPC는 부르지 않는다). */
function aucOut(r, me) { let item = null; try { item = JSON.parse(r.item); } catch (e) { } return { id: r.id, name: r.name, r: r.rarity, ilvl: r.ilvl, slot: r.slot, item, ends: r.ends, min: r.min, price: r.price, need: R.auctionStep(r.price, r.min), bidder: r.bidder_name, mine: !!me && r.bidder === me, npc: String(r.bidder).startsWith('npc:'), bids: r.bids, done: !!r.done, tier: r.tier == null ? 2 : r.tier, cap: R.aucCap(r) }; }
function aucRefund(pid, amount, name, why) {
  if (!pid || String(pid).startsWith('npc:') || !amount) return;
  const Q = store.get(pid); if (!Q) return;
  Q.res.gold += amount; R.log(Q, nowSec(), '떠돌이 상인: ' + name + ' — ' + why + ' 맡겨 둔 ' + R.fmt(amount) + ' ' + CUR + '를 돌려받았습니다', 'news'); store.markDirty(pid);
  chat.ping(pid, 'outbid', { name, why });
  try { push.direct(pid, 'aucbid', '떠돌이 상인', name + ' — ' + why + ' 맡겨 둔 ' + R.fmt(amount) + ' ' + CUR + '를 돌려받았습니다. 다시 값을 부를 수 있습니다.', 'aucbid-' + name); } catch (e) { }
}
const aucBidders = new Map(), aucWarned = new Set();   // 물건마다 값을 불렀던 학생 · 마감 5분 전 알림을 보낸 물건 (서버를 다시 켜면 비워진다)
function aucBidRaw(row, amount, pid, pname, now) {
  if (!aucBidders.has(row.id)) aucBidders.set(row.id, new Set()); aucBidders.get(row.id).add(pid);
  const ends = row.ends - now < R.AUCTION_SNIPE ? Math.floor(now + R.AUCTION_SNIPE) : row.ends;
  if (!dbx.q.aucBid.run(amount, pid, pname, ends, row.id, row.price).changes) return null;
  aucRefund(row.bidder, row.price, row.name, '더 높은 값이 나와');
  const nr = dbx.q.aucGet.get(row.id); chat.pingAll('auction', aucOut(nr, null)); return nr;
}
// 예전에 NPC가 부른 값은 지운다 (진행 중인 경매는 입찰 없음으로 되돌린다)
try { const n = dbx.db.prepare(`UPDATE auction SET price = 0, bidder = '', bidder_name = '', bids = 0 WHERE done = 0 AND bidder LIKE 'npc:%'`).run().changes; if (n) log('떠돌이 상인 경매: NPC 입찰 ' + n + '건을 지웠습니다'); } catch (e) { log('NPC 입찰 정리 실패', e); }
function aucTick(now) {
  const v = R.auctionVisit(now);
  if (v && v.active && !dbx.q.aucByVisit.all(v.id).length) {
    const stages = dbx.db.prepare(`SELECT max_stage FROM players WHERE last_seen > ? AND banned = 0 ORDER BY max_stage`).all(Math.floor(Date.now() / 1000) - 7 * 86400).map((r) => r.max_stage);
    const at = (p) => stages.length ? stages[Math.min(stages.length - 1, Math.floor(stages.length * p))] : 10, dummy = { rng: crypto.randomInt(1, 2147483647) };
    // 구간마다 3점: 신입생(하위 25%) · 중급(중간값) · 상급(상위 12%) 단계 + 3. 영웅 2점 + 영웅/전설(50%) 1점
    R.AUC_TIERS.forEach((tp, tier) => {
      const lv = Math.max(1, at(tp.p) + 3);
      [3, 3, Math.random() < 0.5 ? 4 : 3].forEach((r) => {
        const it = R.makeItem(dummy, R.D.SLOTS[crypto.randomInt(R.D.SLOTS.length)].id, lv, r, r), min = Math.max(50, R.sellPrice(it) * 8);
        dbx.q.aucInsert.run(v.id, JSON.stringify(it), it.name, it.r, it.ilvl, it.slot, Math.floor(v.end), min, 0, tier);
      });
    });
    chat.system('notice', '떠돌이 상인이 아카데미 광장에 짐을 풀었습니다. 신입생 · 중급 · 상급 구간마다 귀한 장비 세 점씩 경매에 올라왔습니다 (1시간).', Date.now() / 1000);
    chat.pingAll('auction', { visit: v.id });
  }
  // 마감 5분 전: 값을 불렀던 학생들에게 알림 (1위는 「지키는 중」, 밀린 학생은 「다시 부를 수 있음」)
  dbx.db.prepare('SELECT * FROM auction WHERE done = 0 AND ends > ? AND ends <= ?').all(Math.floor(now), Math.floor(now) + 300).forEach((r) => {
    if (aucWarned.has(r.id)) return; aucWarned.add(r.id); if (aucWarned.size > 500) aucWarned.delete(aucWarned.values().next().value);
    const who = new Set(aucBidders.get(r.id) || []); if (r.bidder) who.add(r.bidder);
    who.forEach((pid) => { if (String(pid).startsWith('npc:')) return; const top = pid === r.bidder, msg = r.name + (top ? ' 경매가 곧 끝납니다 · 지금 가장 높은 값(' + R.fmt(r.price) + ')을 부른 상태입니다' : ' 경매가 곧 끝납니다 · 지금 가장 높은 값은 ' + R.fmt(r.price) + ' ' + CUR + '입니다');
      chat.ping(pid, 'aucsoon', { name: r.name, top, price: r.price, ends: r.ends }); try { push.direct(pid, 'aucbid', '떠돌이 상인 · 마감 5분 전', msg, 'aucsoon-' + r.id); } catch (e) { } });
  });
  dbx.q.aucOpenEnded.all(Math.floor(now)).forEach((r) => {
    if (!dbx.q.aucDone.run(r.id).changes) return;
    if (r.bidder && !String(r.bidder).startsWith('npc:')) {
      let it = null; try { it = JSON.parse(r.item); } catch (e) { }
      try { const Q = loadPlayer(r.bidder, nowSec()); if (Q) { R.cupAdd(Q, R.CUP_AUC, 'auc'); store.markDirty(r.bidder); } } catch (e) { log('낙찰 대항전 점수 실패', e); }   // 대항전 점수 (거울관 특기)
      if (it) sendMail(r.bidder, '떠돌이 상인', '낙찰: ' + r.name, r.bidder_name + ' 님, ' + R.fmt(r.price) + ' ' + CUR + '에 낙찰되었습니다. 좋은 주인을 만나 다행이군요.\n— 떠돌이 상인', { items: [it] }, Math.floor(Date.now() / 1000) + 14 * 86400, true);
      chat.system('notice', '떠돌이 상인: ' + r.bidder_name + ' 님이 ' + R.josa('「' + r.name + '」', '을', '를') + ' ' + R.fmt(r.price) + ' ' + CUR + '에 낙찰받았습니다.', Date.now() / 1000);
    }
    chat.pingAll('auction', { done: r.id });
  });
}
routes['GET /api/auction'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('aug:' + me, 1, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const now = nowSec(); aucTick(now); const v = aucVisitNow(now);
  // 앞 방문에서 막판 연장으로 아직 끝나지 않은 물건 (다음 방문이 시작돼도 보이게)
  const ext = dbx.db.prepare('SELECT * FROM auction WHERE done = 0 AND ends > ? AND visit <> ? ORDER BY id').all(Math.floor(now), v ? v.id : -1).map((r) => aucOut(r, me));
  send(req, res, 200, { now, visit: v, ext, lots: v ? dbx.q.aucByVisit.all(v.id).map((r) => aucOut(r, me)) : [], recent: dbx.q.aucRecent.all().map((r) => ({ name: r.name, r: r.rarity, price: r.price, bidder: r.bidder_name })) });
};
routes['POST /api/auction'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (store.isBanned(me)) return fail(req, res, 403, '이용이 정지된 계정입니다');
  if (limited('aup:' + me, 1, 5)) return fail(req, res, 429, '잠시 후 다시 시도');
  const b = await readJson(req, 256), now = nowSec(), meta = dbx.q.playerMeta.get(me);
  if (!meta || meta.guest) return fail(req, res, 403, '게스트는 경매에 참여할 수 없습니다. 설정에서 정식 학생 등록 필요');
  const P = loadPlayer(me, now); if (!P) return fail(req, res, 401, '학생 정보를 찾을 수 없습니다');
  const row = dbx.q.aucGet.get(Number(b.id)); if (!row || row.done || row.ends <= now) return fail(req, res, 400, '경매가 끝났습니다');
  if (row.bidder === me) return fail(req, res, 400, '이미 가장 높은 값을 부른 상태입니다');
  const cap = R.aucCap(row); if (cap && P.maxStage > cap) return fail(req, res, 400, '이 구간은 원정 최고 단계 ' + cap + '단계 이하 학생만 입찰할 수 있습니다');
  const amount = Math.floor(Number(b.amount)), need = R.auctionStep(row.price, row.min);
  if (!isFinite(amount) || amount < need) return fail(req, res, 400, R.fmt(need) + ' ' + CUR + ' 이상 불러야 합니다');
  if (amount > 1e15) return fail(req, res, 400, '값 확인 필요');
  if (P.res.gold < amount) return fail(req, res, 400, CUR + '가 모자랍니다');
  P.res.gold -= amount;
  const nr = aucBidRaw(row, amount, me, P.name, now);
  if (!nr) { P.res.gold += amount; return fail(req, res, 409, '방금 다른 학생이 값을 불렀습니다. 다시 확인 필요'); }
  R.log(P, now, '떠돌이 상인: ' + row.name + '에 ' + R.fmt(amount) + ' ' + CUR + '를 불렀습니다 (낙찰되지 않으면 돌려받습니다)', 'news');
  store.markDirty(me);
  send(req, res, 200, Object.assign(statePayload(P, now), { ok: true, lot: aucOut(nr, me) }));
};

/* ───────── 우편함 ─────────
   운영진(또는 별의 탑 같은 시스템)이 보상을 보낸다. 열어 봐도 보상은 기한 안에 언제든 받을 수 있다.
   모두에게 보내는 우편은 한 줄만 저장하고, 학생마다 읽음·받음만 따로 적는다. */
const MAIL_FOREVER = 32503647599;   // 2999-12-31 23:59:59 (한국 시간)
const createdOf = (pid) => { const r = dbx.db.prepare('SELECT created FROM players WHERE id = ?').get(pid); return r ? r.created : 0; };
function mailNewRow(pid) { return dbx.q.mailNew.get(pid, pid, createdOf(pid), Math.floor(Date.now() / 1000)); }
function mailNew(pid) { return Number(mailNewRow(pid).n); }
function mailOut(r) { let rw = {}; try { rw = JSON.parse(r.rewards); } catch (e) { } return { id: r.id, sender: r.sender, title: sec.dec(r.title), body: sec.dec(r.body), rewards: rw, created: r.created, expires: r.expires, read: !!r.rd, claimed: !!r.cl, all: r.target === '*' }; }
// target: '*' 또는 학생 id. days 대신 expires(실제 유닉스 초)를 주면 그날까지.
function sendMail(target, sender, title, body, rewards, expires, newcomers, pingAfterMs) {
  const real = Math.floor(Date.now() / 1000);
  const info = dbx.q.mailInsert.run(target, sender, sec.enc(String(title).slice(0, 60)), sec.enc(String(body || '').slice(0, 1000)), JSON.stringify(R.cleanRewards(rewards)), real, Math.floor(nowSec()), Math.min(MAIL_FOREVER, Math.max(real + 60, Math.floor(expires))), newcomers ? 1 : 0);
  const id = Number(info.lastInsertRowid);
  if (target === '*') chat.pingAll('mail', { id }); else if (pingAfterMs > 0) setTimeout(() => chat.ping(target, 'mail', { id }), pingAfterMs).unref(); else chat.ping(target, 'mail', { id });
  return id;
}
/* ───────── 게시판 ───────── */
// 함께 원정 방 (server/exproom.js)
routes['GET /api/exprooms'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('erl:' + me, 2, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const id = new URL(req.url, 'http://x').searchParams.get('id');
  if (id) { try { return send(req, res, 200, exprooms.peek(me, id)); } catch (e) { if (e.status) return fail(req, res, e.status, e.message); throw e; } }
  send(req, res, 200, exprooms.list(me));
};
routes['POST /api/exproom'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (store.isBanned(me)) return fail(req, res, 403, '이용이 정지된 계정입니다');
  if (limited('ero:' + me, 2, 8)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const b = await readJson(req, 1024), now = nowSec();
  world.tick(now);
  let r; try { r = exprooms.op(me, b); } catch (e) { if (e.status) return fail(req, res, e.status, e.message); throw e; }
  const P = store.get(me);
  send(req, res, 200, Object.assign({ now, scale: cfg.timeScale, P: P ? R.publicState(P) : undefined }, r, exprooms.list(me)));
};
routes['GET /api/notes'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('nt:' + me, 2, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const list = dbx.q.notesFor.all(me).map((r) => { let link = null; try { link = r.link ? JSON.parse(r.link) : null; } catch (e) { } return { id: r.id, t: r.t, kind: r.kind, text: sec.dec(r.text), link, read: !!r.read }; });
  send(req, res, 200, { notes: list, n: list.filter((x) => !x.read).length });
};
routes['POST /api/notes'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  await readJson(req, 256); dbx.q.noteReadAll.run(me); send(req, res, 200, { ok: true, n: 0 });
};
routes['GET /api/board'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('bdl:' + me, 3, 15)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const u = new URL(req.url, 'http://x').searchParams;
  const id = u.get('id');
  if (id) { const p = board.get(me, id); return p ? send(req, res, 200, { post: p }) : fail(req, res, 404, '없는 글이거나 볼 수 없는 글입니다'); }
  send(req, res, 200, board.list(me, { tag: u.get('tag') || '', q: u.get('q') || '', qt: u.get('qt') || '', page: u.get('page') || 1, hideDone: u.get('hd') === '1' }));
};
routes['POST /api/board'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (store.isBanned(me)) return fail(req, res, 403, '이용이 정지된 계정입니다');
  const b = await readJson(req, 16384), op = String(b.op || ''), now = Math.floor(Date.now() / 1000), meta = dbx.q.playerMeta.get(me);
  if (!meta || meta.banned) return fail(req, res, 403, '사용할 수 없습니다');
  if ((op === 'write' || op === 'edit' || op === 'comment') && meta.muted_until && meta.muted_until > now) return fail(req, res, 403, '채팅·글쓰기가 금지된 상태입니다 (' + Math.ceil((meta.muted_until - now) / 60) + '분 남음)');
  if (op === 'write' && limited('bdw:' + me, 1 / 30, 1)) return fail(req, res, 429, '글은 30초에 하나씩 작성할 수 있습니다');
  if (op === 'comment' && limited('bdc:' + me, 1 / 4, 3)) return fail(req, res, 429, '댓글을 너무 빨리 달고 있습니다');
  if (limited('bdp:' + me, 1, 10)) return fail(req, res, 429, '잠시 후 다시 시도');
  try {
    let id = null;
    if (op === 'write') id = board.write(me, b, now);
    else if (op === 'edit') id = board.edit(me, b, now);
    else if (op === 'del') board.del(me, b.id);
    else if (op === 'comment') id = board.comment(me, b.id, b.text, now, b.parent);
    else if (op === 'cdel') { board.cdel(me, b.cid); id = Number(b.id) | 0; }
    else if (op === 'status') id = board.setStatus(me, b.id, b.st);
    else return fail(req, res, 400, '알 수 없는 요청입니다');
    send(req, res, 200, { ok: true, id, post: id ? board.get(me, id) : null });
  } catch (e) { if (e.status) return fail(req, res, e.status, e.message); throw e; }
};
routes['GET /api/mail'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('mail:' + me, 2, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const list = dbx.q.mailFor.all(me, me, createdOf(me), Math.floor(Date.now() / 1000)).map(mailOut);
  send(req, res, 200, { mails: list, n: list.filter((m) => !m.read).length });
};
routes['POST /api/mail'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (store.isBanned(me)) return fail(req, res, 403, '이용이 정지된 계정입니다');
  if (limited('mailp:' + me, 2, 10)) return fail(req, res, 429, '잠시 후 다시 시도');
  const b = await readJson(req, 1024), op = String(b.op || ''), now = nowSec(), real = Math.floor(Date.now() / 1000);
  const mine = dbx.q.mailFor.all(me, me, createdOf(me), real);
  const pick = op === 'claimAll' ? mine.filter((r) => !r.cl) : mine.filter((r) => r.id === Number(b.id));
  if (!pick.length) return op === 'claimAll' ? send(req, res, 200, { ok: true, got: [], n: 0 }) : fail(req, res, 404, '없는 우편이거나 기한이 지났습니다');
  if (op === 'read') { pick.forEach((r) => dbx.q.mailRead.run(r.id, me)); return send(req, res, 200, { ok: true }); }
  if (op !== 'claim' && op !== 'claimAll') return fail(req, res, 400, '알 수 없는 요청입니다');
  const P = loadPlayer(me, now); if (!P) return fail(req, res, 401, '학생 정보를 찾을 수 없습니다');
  const got = [], full = [], bag = R.calc(P, world.ctx(now), now).bag;
  pick.forEach((r) => {
    if (r.cl) return;
    let rw = {}; try { rw = JSON.parse(r.rewards); } catch (e) { }
    const need = R.mailNeedSlots(rw); if (need && P.inv.length + need > bag) { full.push(r.id); return; }   // 장비는 가방에 자리가 있어야 받는다
    if (!dbx.q.mailClaim.run(r.id, me).changes) return;   // 이미 받은 우편 (동시에 두 번 눌러도 한 번만)
    const o = R.grantMail(P, world.ctx(now), now, rw);
    R.log(P, now, '우편 「' + sec.dec(r.title) + '」 보상을 받았습니다' + (o.text ? ': ' + o.text : ''), 'news');
    got.push({ id: r.id, text: o.text, items: o.items });
  });
  if (got.length) store.markDirty(me);
  if (!got.length && full.length) return fail(req, res, 400, '가방 칸이 모자랍니다. 장비를 정리한 뒤 받으세요');
  send(req, res, 200, Object.assign(statePayload(P, now), { ok: true, got, full: full.length }));
};
routes['POST /api/admin/mail'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 8192), title = String(b.title || '').trim(); if (!title) return fail(req, res, 400, '제목 입력 필요');
  const real = Math.floor(Date.now() / 1000), exp = b.forever ? MAIL_FOREVER : b.expires ? Number(b.expires) : real + Math.max(1, Math.min(3650, Number(b.days) || 30)) * 86400;
  if (!isFinite(exp) || exp <= real) return fail(req, res, 400, '만료일 확인 필요');
  const rw = R.cleanRewards(b.rewards);
  if (b.to === '*' || !b.to) { const id = sendMail('*', '운영진', title, b.body, rw, exp, b.newcomers !== false); log('우편(전체) #' + id + ' ' + title); return send(req, res, 200, { ok: true, ids: [id], n: 'all' }); }
  const names = String(b.to).split(/[,\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 200), ids = [], missing = [];
  names.forEach((n) => { const row = dbx.q.playerByKey.get(nameKey(n)); if (row) ids.push(sendMail(row.id, '운영진', title, b.body, rw, exp, true)); else missing.push(n); });
  log('우편(' + ids.length + '명) ' + title); send(req, res, 200, { ok: true, ids, missing });
};
// 운영실: 학생마다 1회용 초대코드를 새로 발급해 우편으로 한 장씩 보낸다 (dry = 받을 학생 수만 미리 세기)
// 받는 학생: 정지 · 게스트 제외, activeDays > 0이면 그 기간 안에 접속한 학생만. 코드 메모 = 「우편 배포 날짜 · 받은 학생 이름」. 본문의 {코드}를 그 학생의 코드로 바꾼다 (없으면 끝에 붙인다)
routes['POST /api/admin/invitemail'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 8192), now = Math.floor(Date.now() / 1000), act = Math.max(0, Math.min(3650, Number(b.activeDays) || 0));
  const rows = dbx.db.prepare('SELECT id, name FROM players WHERE banned = 0 AND guest = 0' + (act ? ' AND last_seen >= ?' : '')).all(...(act ? [now - act * 86400] : []));
  if (b.dry) return send(req, res, 200, { n: rows.length });
  const title = String(b.title || '').trim(); if (!title) return fail(req, res, 400, '제목 입력 필요');
  if (Number(b.expect) !== rows.length) return fail(req, res, 409, '받을 학생 수가 바뀌었습니다. 다시 확인 필요 (지금 ' + rows.length + '명)');
  const codeDays = Math.max(0, Math.min(3650, Number(b.codeDays) || 0)), mailExp = now + Math.max(1, Math.min(3650, Number(b.mailDays) || 30)) * 86400;
  const body = String(b.body || ''), note = '우편 배포 ' + new Date(now * 1000 + 9 * 3600000).toISOString().slice(0, 10);
  let n = 0;
  dbx.tx(() => { rows.forEach((r) => {
    let c; do { c = newCode(); } while (dbx.q.getInvite.get(c));
    dbx.q.insertInvite.run(c, 1, now, codeDays ? now + codeDays * 86400 : 0, (note + ' · ' + r.name).slice(0, 80), 0);   // 메모에 받은 학생 이름
    sendMail(r.id, '운영진', title, body.indexOf('{코드}') >= 0 ? body.split('{코드}').join(c) : body + (body ? '\n\n' : '') + '초대코드: ' + c, {}, mailExp, false); n++;
  }); });
  oplog('admin', '관리자', 'invitemail', title + ' · ' + n + '명');
  log('초대코드 우편 ' + n + '명 · ' + title);
  send(req, res, 200, { ok: true, n });
};
routes['GET /api/admin/mail'] = (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const names = new Map();
  send(req, res, 200, { mails: dbx.q.mailAdminList.all().map((r) => { let to = '모든 학생'; if (r.target !== '*') { if (!names.has(r.target)) { const p = dbx.db.prepare('SELECT name FROM players WHERE id = ?').get(r.target); names.set(r.target, p ? p.name : '?'); } to = names.get(r.target); } return { id: r.id, to, title: sec.dec(r.title), rewards: JSON.parse(r.rewards || '{}'), created: r.created, expires: r.expires, claims: r.claims, deleted: !!r.deleted, newcomers: !!r.newcomers }; }) });
};
routes['POST /api/admin/mail/delete'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 256); dbx.q.mailDelete.run(Number(b.id)); send(req, res, 200, { ok: true });
};

/* ───────── 동아리 (학생이 직접 만드는 길드) ─────────
   회장·부회장·부원. 바로 가입 또는 신청 후 승인. 동아리 채팅은 RP와 오너(캐릭터 밖) 두 갈래. */
const GUILD_ICONS = new Set(D.GUILD_ICONS.map((x) => x.id));
const GUILD_NAME_RE = /^[가-힣A-Za-z0-9_ ]{2,12}$/, GUILD_COLORS = ['#d6ad5f', '#e8c36a', '#6fb5c9', '#d9736b', '#b99be6', '#74bfa9', '#e07c72', '#8fa8ff', '#c9a26b'], GUILD_OFFICERS = 2;
const guildRole = new Map(), guildLv = new Map();
dbx.q.gAllMembers.all().forEach((r) => { guildOf.set(r.pid, r.guild); guildRole.set(r.pid, r.role); guildLv.set(r.guild, r.lv || 1); });
// 동아리 레벨 보너스: 상태를 보낼 때 학생에게 붙인다 (rules.bonuses가 읽는다)
function setGuildLv(P) { const g = guildOf.get(P.id), lv = g ? (guildLv.get(g) || 1) : 0; if ((P.guildLv || 0) !== lv) { P.guildLv = lv; return true; } return false; }
const gCount = (g) => dbx.q.gMembers.all(g).length;
const gRanksOf = (g) => R.guildCleanRanks(JSON.parse(g.ranks || '{}'));
function gLog(gid, text) { dbx.q.glAdd.run(gid, Math.floor(Date.now() / 1000), String(text).slice(0, 200)); dbx.q.glPrune.run(gid, gid); }
function gView(me, id, full) {
  const g = dbx.q.gGet.get(id); if (!g) return null;
  const inG = guildOf.get(me) === id, role = inG ? guildRole.get(me) : null, members = dbx.q.gMembers.all(id), ranks = gRanksOf(g), lv = g.lv || 1;
  const mine = inG ? members.find((m) => m.id === me) : null, day = R.dayKST(nowSec());
  const o = { id, name: g.name, intro: sec.dec(g.intro), notice: sec.dec(g.notice), color: g.color, icon: g.icon || '', mode: g.mode, created: g.created, n: members.length, max: R.guildCap(lv), myRole: role,
    lv, xp: g.xp || 0, need: R.guildXpNeed(lv), maxLv: R.GUILD_MAX_LV, bonus: R.guildBonus(lv), ranks };
  if (full || role) o.members = members.map((m) => ({ id: m.id, role: m.role, rank: m.rank || '', rankName: R.guildRankName(ranks, m.role, m.rank), contrib: m.contrib || 0, name: m.name, house: m.house, grade: m.grade, lvl: m.lvl, av: m.avatar_v, title: m.title, online: m.id === me || isOnline(m.id), seen: m.last_seen }));
  if (mine) {
    const P = store.get(me);
    o.myRank = mine.rank || ''; o.myRankName = R.guildRankName(ranks, role, mine.rank);
    o.perms = {}; R.GUILD_PERMS.forEach((k) => { o.perms[k[0]] = R.guildCan(ranks, role, mine.rank, k[0]); });
    o.my = { contrib: mine.contrib || 0, checkin: mine.cday === day, dpts: mine.dday === day ? mine.dpts : 0, cap: R.GUILD_DONATE_CAP, unit: P ? R.guildGoldUnit(P) : 1, bonusIn: R.GUILD_CHECKIN };
    o.gold = g.gold || 0; o.slots = R.guildSlots(lv);
    o.items = dbx.q.giList.all(id).map((r) => { const it = JSON.parse(r.data); return { id: r.id, name: r.name, r: r.rarity, ilvl: r.ilvl, slot: r.slot, by: r.by_name, t: r.t, item: it }; });
    o.log = dbx.q.glList.all(id, 30);
    o.ranksMax = R.guildRanksMax(lv);
    if (lv >= R.GRIT_LV) { const st = gritState(id, members.length, nowSec()); o.rit = { n: st.pids.length, goal: st.goal, done: st.done, mine: st.pids.indexOf(me) >= 0, cost: P ? R.ritualCost(P, world.ctx(nowSec()), nowSec()) : 0 }; }
    if (lv >= R.GWQ_LV) o.wq = gwqView(members, P, nowSec());
    if (o.perms.invite) o.apps = dbx.q.gApps.all(id).map((a) => ({ id: a.id, t: a.t, msg: sec.dec(a.msg), name: a.name, house: a.house, grade: a.grade, lvl: a.lvl, av: a.avatar_v }));
  }
  return o;
}
/* 동아리 의식: 동아리마다 하루 한 번. 목표는 그날 처음 봉헌할 때의 부원 수로 정한다 */
function gritState(gid, n, now) { const d = R.dayKST(now); let st = dbx.kvGet('grit:' + gid, null); if (!st || st.day !== d) { st = { day: d, pids: [], done: 0, goal: R.gritGoal(n) }; } return st; }
// 주간 동아리 과제: 부원들의 이번 주 기록을 합친다 (주가 바뀐 뒤 아직 들어오지 않은 부원은 0)
function gwqView(members, P, now) {
  const w = R.weekId(now), Qs = members.map((m) => store.get(m.id)).filter(Boolean);
  return { wk: w, end: R.weekStart(w + 1), list: R.GWQ.map((q) => ({ id: q.id, name: q.name, unit: q.unit, goal: q.goal, need: R.gwqNeed(q), prog: Qs.reduce((a, Q) => a + R.gwqMine(Q, q, w), 0), mine: R.gwqMine(P, q, w), got: !!(P && P.gwq && P.gwq.wk === w && P.gwq.got[q.id]) })), reward: P ? R.gwqReward(P) : null };
}
function gJoin(pid, gid, role) { dbx.q.gJoin.run(pid, gid, role, Math.floor(Date.now() / 1000)); dbx.q.gAppDelAll.run(pid); dbx.q.ginvDelPid.run(pid); guildOf.set(pid, gid); guildRole.set(pid, role); if (!guildLv.has(gid)) guildLv.set(gid, (dbx.q.gGet.get(gid) || {}).lv || 1); chat.guildChanged(pid); const P = store.peek(pid); if (P && setGuildLv(P)) store.markDirty(pid); }
function gLeave(pid) { const g = guildOf.get(pid); dbx.q.gLeave.run(pid); guildOf.delete(pid); guildRole.delete(pid); chat.guildChanged(pid); const P = store.peek(pid); if (P && setGuildLv(P)) store.markDirty(pid); return g; }
function gSys(gid, text) { const now = Date.now() / 1000; chat.system('grp', text, now, gid); chat.system('gooc', text, now, gid); }
function gXp(gid, x) {
  const g = dbx.q.gGet.get(gid); if (!g) return 0; const o = { lv: g.lv || 1, xp: g.xp || 0 }, ups = R.guildAddXp(o, x);
  dbx.q.gSetLvXp.run(o.lv, Math.floor(o.xp), gid);
  if (ups) { guildLv.set(gid, o.lv); gSys(gid, '✦ 동아리가 ' + o.lv + '레벨이 되었습니다! 정원 ' + R.guildCap(o.lv) + '명 · 창고 ' + R.guildSlots(o.lv) + '칸 · 부원 모두 ' + CUR + '·경험치 +' + (R.guildBonus(o.lv) * 100).toFixed(1).replace(/\.0$/, '') + '%' + R.guildUnlockText(o.lv - ups, o.lv)); gLog(gid, '동아리 ' + o.lv + '레벨 달성');
    guildOf.forEach((g2, pid) => { if (g2 === gid) { const P = store.peek(pid); if (P && setGuildLv(P)) store.markDirty(pid); } }); }
  return ups;
}
// 동아리를 해체할 때 창고에 남은 것은 회장에게 우편으로 돌려준다
function gReturnStorage(gid, owner, gname) {
  const g = dbx.q.gGet.get(gid), items = dbx.q.giList.all(gid).map((r) => JSON.parse(r.data)), gold = Math.floor((g && g.gold) || 0);
  for (let i = 0; i < Math.max(items.length, gold > 0 ? 1 : 0); i += 10) sendMail(owner, '동아리', '「' + gname + '」 창고 정리', '동아리를 해체해 창고에 남아 있던 것을 돌려드립니다.', { gold: i === 0 ? gold : 0, items: items.slice(i, i + 10) }, Date.now() / 1000 + 30 * 86400);
}
routes['GET /api/guilds'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('gl:' + me, 1, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').trim().toLowerCase().slice(0, 12);
  const mine = guildOf.get(me), apps = dbx.q.gMyApps.all(me).map((r) => r.guild);
  const list = dbx.q.gList.all().map((g) => ({ id: g.id, name: g.name, intro: sec.dec(g.intro).slice(0, 120), color: g.color, icon: g.icon || '', mode: g.mode, n: Number(g.n), max: R.guildCap(g.lv || 1), lv: g.lv || 1, owner: g.owner_name, mine: g.id === mine, applied: apps.indexOf(g.id) >= 0 }))
    .filter((g) => !q || g.name.toLowerCase().indexOf(q) >= 0 || g.intro.toLowerCase().indexOf(q) >= 0);
  send(req, res, 200, { list, mine: mine || null, invites: mine ? [] : dbx.q.ginvMine.all(me).map((r) => { const by = dbx.q.getProfile.get(r.by); return { id: r.guild, name: r.name, color: r.color, icon: r.icon || '', lv: r.lv, n: Number(r.n), by: by ? by.name : '', t: r.t }; }) });
};
// 동아리 순위: 레벨(경험치) 또는 부원 전투력 합. 1분마다 다시 센다.
let gRankCache = { at: 0, rows: [] };
routes['GET /api/guilds/rank'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('grk:' + me, 1, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const sort = new URL(req.url, 'http://x').searchParams.get('sort') === 'power' ? 'power' : 'lv';
  if (Date.now() - gRankCache.at > 60000) gRankCache = { at: Date.now(), rows: dbx.q.gRank.all().map((g) => ({ id: g.id, name: g.name, intro: sec.dec(g.intro).slice(0, 200), created: g.created, color: g.color, icon: g.icon || '', mode: g.mode, lv: g.lv || 1, xp: Number(g.xp) || 0, n: Number(g.n), max: R.guildCap(g.lv || 1), power: Math.round(Number(g.pw) || 0), owner: g.owner_name || '' })) };
  const rows = gRankCache.rows.slice().sort(sort === 'power' ? (a, b) => b.power - a.power || b.lv - a.lv : (a, b) => b.lv - a.lv || b.xp - a.xp || b.power - a.power);
  rows.forEach((r, i) => { r.rank = i + 1; });
  const mine = guildOf.get(me), mr = mine ? rows.find((r) => r.id === mine) : null;
  send(req, res, 200, { sort, list: rows.slice(0, 500), mine: mr || null, total: rows.length, at: Math.floor(gRankCache.at / 1000) });
};
routes['GET /api/guild'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('gg:' + me, 2, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const id = new URL(req.url, 'http://x').searchParams.get('id') || guildOf.get(me);
  if (!id) return send(req, res, 200, { guild: null });
  const v = gView(me, id, true); if (!v) return fail(req, res, 404, '없는 동아리입니다');
  send(req, res, 200, { guild: v });
};
routes['POST /api/guild'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (store.isBanned(me)) return fail(req, res, 403, '이용이 정지된 계정입니다');
  if (limited('gp:' + me, 0.5, 8)) return fail(req, res, 429, '잠시 후 다시 시도');
  const b = await readJson(req, 4096), op = String(b.op || ''), P = store.get(me), meta = dbx.q.playerMeta.get(me), now = Math.floor(Date.now() / 1000), gnow = nowSec();
  if (!P || !meta) return fail(req, res, 401, '학생 정보를 찾을 수 없습니다');
  const mine = guildOf.get(me), role = guildRole.get(me), staff = role === 'owner' || role === 'officer';
  const target = String(b.pid || ''), tRole = guildRole.get(target), sameG = target && guildOf.get(target) === mine;
  const ok = (extra) => send(req, res, 200, Object.assign({ ok: true, guild: mine || guildOf.get(me) ? gView(me, guildOf.get(me), true) : null }, extra || {}));
  const nameOf = (pid) => { const w = dbx.q.getProfile.get(pid); return w ? w.name : '학생'; };
  if (op === 'create') {
    if (meta.guest) return fail(req, res, 403, '게스트는 동아리를 만들 수 없습니다. 정식 학생 등록 필요');
    if (mine) return fail(req, res, 400, '이미 동아리에 들어가 있습니다');
    const name = String(b.name || '').replace(/\s+/g, ' ').trim();
    if (!GUILD_NAME_RE.test(name)) return fail(req, res, 400, '동아리 이름은 한글·영문·숫자 2~12자만 가능');
    if (R.badName(name)) return fail(req, res, 400, '사용할 수 없는 단어가 포함된 이름입니다');
    if (dbx.q.gByKey.get(name.toLowerCase().replace(/\s/g, ''))) return fail(req, res, 409, '이미 있는 동아리 이름입니다');
    const id = crypto.randomBytes(9).toString('base64url'), color = GUILD_COLORS.indexOf(b.color) >= 0 ? b.color : GUILD_COLORS[0], icon = GUILD_ICONS.has(b.icon) ? b.icon : '';
    gRankCache.at = 0; dbx.q.gInsert.run(id, name, name.toLowerCase().replace(/\s/g, ''), sec.enc(cleanText(b.intro, 300)), color, me, b.mode === 'apply' ? 'apply' : 'open', now, icon);
    guildLv.set(id, 1); gJoin(me, id, 'owner'); gSys(id, P.name + ' 님이 동아리 「' + name + '」를 열었습니다.'); gLog(id, P.name + ' 님이 동아리를 열었습니다');
    return ok();
  }
  if (op === 'join') {
    if (mine) return fail(req, res, 400, '현재 동아리 탈퇴 필요');
    const g = dbx.q.gGet.get(String(b.id || '')); if (!g) return fail(req, res, 404, '없는 동아리입니다');
    if (gCount(g.id) >= R.guildCap(g.lv)) return fail(req, res, 400, '정원(' + R.guildCap(g.lv) + '명)이 가득 찼습니다');
    if (g.mode === 'apply') {
      dbx.q.gAppPut.run(me, g.id, now, sec.enc(cleanText(b.msg, 120)));
      const ranks = gRanksOf(g); guildOf.forEach((gid, pid) => { if (gid === g.id && R.guildCan(ranks, guildRole.get(pid), (dbx.q.gMember.get(pid) || {}).rank, 'invite')) { chat.ping(pid, 'gapp', { name: P.name }); addNote(pid, 'guild', P.name + ' 님이 동아리 「' + g.name + '」에 가입을 신청했습니다', { view: 'guild', gtab: 'admin' }); } });
      return send(req, res, 200, { ok: true, applied: true });
    }
    gJoin(me, g.id, 'member'); gSys(g.id, P.name + ' 님이 동아리에 들어왔습니다.'); gLog(g.id, P.name + ' 님 가입');
    return ok();
  }
  if (op === 'cancelApp') { dbx.q.gAppDel.run(me, String(b.id || '')); return send(req, res, 200, { ok: true }); }
  // 받은 초대
  if (op === 'inviteAccept' || op === 'inviteDecline') {
    const gid = String(b.id || ''), inv = dbx.q.ginvGet.get(me, gid); if (!inv) return fail(req, res, 404, '없는 초대입니다');
    dbx.q.ginvDel.run(me, gid); if (op === 'inviteDecline') return send(req, res, 200, { ok: true });
    if (mine) return fail(req, res, 400, '현재 동아리 탈퇴 필요');
    const g = dbx.q.gGet.get(gid); if (!g) return fail(req, res, 404, '없어진 동아리입니다');
    if (gCount(gid) >= R.guildCap(g.lv)) return fail(req, res, 400, '정원이 가득 찼습니다');
    gJoin(me, gid, 'member'); gSys(gid, P.name + ' 님이 초대를 받아 동아리에 들어왔습니다.'); gLog(gid, P.name + ' 님 가입 (' + nameOf(inv.by) + ' 님의 초대)');
    return ok();
  }
  if (!mine) return fail(req, res, 400, '동아리에 들어가 있지 않습니다');
  const g = dbx.q.gGet.get(mine), ranks = gRanksOf(g), meRow = dbx.q.gMember.get(me) || {}, can = (perm) => R.guildCan(ranks, role, meRow.rank, perm), day = R.dayKST(gnow);
  if (op === 'recruit') {   // 채팅 「모집」 탭에 동아리 홍보 (초대 권한, 동아리마다 10분에 한 번)
    if (!can('invite')) return fail(req, res, 403, '모집 홍보는 초대 권한이 있어야 합니다');
    if (gCount(mine) >= R.guildCap(g.lv)) return fail(req, res, 400, '정원이 가득 찼습니다');
    const real = Date.now() / 1000, last = gRecAt.get(mine) || 0; if (real - last < 600) return fail(req, res, 400, Math.ceil((600 - (real - last)) / 60) + '분 뒤에 다시 홍보할 수 있습니다');
    gRecAt.set(mine, real);
    chat.recruit(P, { type: 'guild', g: mine, name: g.name, color: g.color, icon: g.icon || '', lv: g.lv || 1, n: gCount(mine), max: R.guildCap(g.lv || 1), mode: g.mode, note: recNote(b.note) }, real);
    return send(req, res, 200, { ok: true });
  }
  if (op === 'invite') {
    if (!can('invite')) return fail(req, res, 403, '초대 권한이 없습니다');
    const row = b.id ? dbx.q.getProfile.get(String(b.id)) : dbx.q.playerByKey.get(nameKey(String(b.name || '').trim()));
    const tid = row ? row.id : null; if (!tid) return fail(req, res, 404, '없는 학생입니다');
    if (tid === me) return fail(req, res, 400, '나를 초대할 수는 없습니다');
    if (guildOf.get(tid)) return fail(req, res, 400, guildOf.get(tid) === mine ? '이미 우리 동아리 부원입니다' : '이미 다른 동아리에 들어간 학생입니다');
    if (gCount(mine) >= R.guildCap(g.lv)) return fail(req, res, 400, '정원이 가득 찼습니다');
    dbx.q.ginvPut.run(tid, mine, me, now); chat.ping(tid, 'ginv', { name: g.name, by: P.name }); addNote(tid, 'guild', P.name + ' 님이 동아리 「' + g.name + '」에 초대했습니다', { view: 'guild' });
    gLog(mine, P.name + ' 님이 ' + (row.name || nameOf(tid)) + ' 님을 초대했습니다');
    return send(req, res, 200, { ok: true });
  }
  if (op === 'accept' || op === 'reject') {
    if (!can('invite')) return fail(req, res, 403, '가입 승인 권한이 없습니다');
    const apps = dbx.q.gApps.all(mine); if (!apps.some((a) => a.id === target)) return fail(req, res, 404, '없는 신청입니다');
    dbx.q.gAppDel.run(target, mine);
    if (op === 'accept') {
      if (guildOf.get(target)) return fail(req, res, 400, '이미 다른 동아리에 들어간 학생입니다');
      if (gCount(mine) >= R.guildCap(g.lv)) return fail(req, res, 400, '정원이 가득 찼습니다');
      gJoin(target, mine, 'member'); gSys(mine, nameOf(target) + ' 님이 동아리에 들어왔습니다.'); gLog(mine, nameOf(target) + ' 님 가입 (' + P.name + ' 님이 승인)');
      addNote(target, 'guild', '동아리 「' + g.name + '」 가입이 승인되었습니다', { view: 'guild' });
    } else {   // 거절: 사유는 선택 (적으면 알림에 함께 보낸다)
      const why = cleanText(b.reason, 100).replace(/\s+/g, ' ');
      addNote(target, 'guild', '동아리 「' + g.name + '」 가입 신청이 거절되었습니다' + (why ? ' · 사유: ' + why : ''), { view: 'guild' });
      gLog(mine, nameOf(target) + ' 님 가입 신청 거절 (' + P.name + ')');
    }
    return ok();
  }
  if (op === 'leave') {
    if (role === 'owner' && gCount(mine) > 1) return fail(req, res, 400, '부원이 있으면 회장은 나갈 수 없습니다. 먼저 회장 위임 필요');
    if (role === 'owner') return fail(req, res, 400, '혼자 남은 회장은 「동아리 해체」로 정리 필요');
    gLeave(me); gSys(mine, P.name + ' 님이 동아리에서 나갔습니다.'); gLog(mine, P.name + ' 님 탈퇴');
    return send(req, res, 200, { ok: true, guild: null });
  }
  if (op === 'kick') {
    if (!sameG || target === me) return fail(req, res, 403, '내보낼 수 없습니다');
    const okKick = role === 'owner' ? tRole !== 'owner' : (staff || can('kick')) && tRole === 'member';
    if (!okKick) return fail(req, res, 403, tRole === 'member' ? '내보내기 권한이 없습니다' : '회장·부회장은 회장만 내보낼 수 있습니다');
    const nm = nameOf(target); gLeave(target); gSys(mine, nm + ' 님이 동아리에서 나갔습니다.'); gLog(mine, P.name + ' 님이 ' + nm + ' 님을 내보냈습니다');
    return ok();
  }
  if (op === 'role') {
    if (role !== 'owner' || !sameG || target === me) return fail(req, res, 403, '회장만 부회장을 정할 수 있습니다');
    const nr = b.role === 'officer' ? 'officer' : 'member';
    if (nr === 'officer' && tRole !== 'officer' && dbx.q.gMembers.all(mine).filter((m) => m.role === 'officer').length >= GUILD_OFFICERS) return fail(req, res, 400, '부회장은 ' + GUILD_OFFICERS + '명까지입니다');
    dbx.q.gRole.run(nr, target); dbx.q.gSetRank.run('', target); guildRole.set(target, nr);
    gLog(mine, nameOf(target) + ' 님 → ' + (nr === 'officer' ? '부회장' : ranks.base.name)); if (nr === 'officer') gSys(mine, nameOf(target) + ' 님이 부회장이 되었습니다.');
    return ok();
  }
  if (op === 'setrank') {
    if (!staff || !sameG) return fail(req, res, 403, '회장·부회장만 계급을 정할 수 있습니다');
    if (tRole !== 'member') return fail(req, res, 400, '회장·부회장에게는 계급을 줄 수 없습니다');
    const rk = String(b.rank || ''); if (rk && !ranks.list.some((x) => x.id === rk)) return fail(req, res, 400, '없는 계급입니다');
    dbx.q.gSetRank.run(rk, target); gLog(mine, nameOf(target) + ' 님 → ' + R.guildRankName(ranks, 'member', rk) + ' (' + P.name + ')');
    return ok();
  }
  if (op === 'ranks') {
    if (role !== 'owner') return fail(req, res, 403, '회장만 계급을 고칠 수 있습니다');
    const nr = R.guildCleanRanks(b.ranks, R.guildRanksMax(g.lv || 1)); dbx.q.gRanks.run(JSON.stringify(nr), mine);
    ranks.list.forEach((x) => { if (!nr.list.some((y) => y.id === x.id)) dbx.q.gClearRank.run(mine, x.id); });
    gLog(mine, P.name + ' 님이 계급을 고쳤습니다 (' + [nr.base.name].concat(nr.list.map((x) => x.name)).join(' · ') + ')');
    return ok();
  }
  if (op === 'transfer') {
    if (role !== 'owner' || !sameG || target === me) return fail(req, res, 403, '회장만 넘길 수 있습니다');
    dbx.tx(() => { dbx.q.gRole.run('owner', target); dbx.q.gSetRank.run('', target); dbx.q.gRole.run('officer', me); dbx.q.gOwner.run(target, mine); });
    guildRole.set(target, 'owner'); guildRole.set(me, 'officer');
    gSys(mine, nameOf(target) + ' 님이 새 회장이 되었습니다.'); gLog(mine, P.name + ' 님이 ' + nameOf(target) + ' 님에게 회장을 넘겼습니다');
    return ok();
  }
  if (op === 'edit') {
    const wantsStyle = (b.color && b.color !== g.color) || (b.mode && b.mode !== g.mode) || (b.icon !== undefined && b.icon !== (g.icon || ''));
    if (!can('notice')) return fail(req, res, 403, '공지·소개를 고칠 권한이 없습니다');
    if (wantsStyle && !staff) return fail(req, res, 403, '색 · 아이콘 · 가입 방식은 회장 · 부회장만 변경할 수 있습니다');
    const intro = b.intro !== undefined ? cleanText(b.intro, 300) : sec.dec(g.intro), notice = b.notice !== undefined ? cleanText(b.notice, 300) : sec.dec(g.notice);
    const color = staff && GUILD_COLORS.indexOf(b.color) >= 0 ? b.color : g.color, mode = staff && (b.mode === 'apply' || b.mode === 'open') ? b.mode : g.mode;
    const icon = staff && b.icon !== undefined && (b.icon === '' || GUILD_ICONS.has(b.icon)) ? b.icon : (g.icon || '');
    dbx.q.gUpdate.run(sec.enc(intro), sec.enc(notice), color, mode, icon, mine); gRankCache.at = 0;
    if (b.notice !== undefined && notice && notice !== sec.dec(g.notice)) gSys(mine, '동아리 공지: ' + notice);
    return ok();
  }
  if (op === 'disband') {
    if (role !== 'owner') return fail(req, res, 403, '회장만 동아리를 해체할 수 있습니다');
    if (gCount(mine) > 1) return fail(req, res, 400, '다른 부원이 있으면 동아리를 해체할 수 없습니다. 모두 내보낸 뒤에 해체 가능');
    gReturnStorage(mine, me, g.name);
    gRankCache.at = 0; dbx.tx(() => { dbx.q.gDelMembers.run(mine); dbx.q.gDelete.run(mine); dbx.q.gAppDelGuild.run(mine); dbx.q.giDelGuild.run(mine); dbx.q.glDelGuild.run(mine); dbx.q.ginvDelGuild.run(mine); });
    guildOf.delete(me); guildRole.delete(me); guildLv.delete(mine); chat.guildChanged(me); chat.dropGuild(mine); if (setGuildLv(P)) store.markDirty(me);
    return send(req, res, 200, { ok: true, guild: null });
  }
  // ── 기여: 출석 · 기부 ──
  if (op === 'checkin') {
    if (!dbx.q.gCheckin.run(day, R.GUILD_CHECKIN, me, day).changes) return fail(req, res, 400, '오늘은 이미 동아리 출석을 했습니다');
    gXp(mine, R.GUILD_CHECKIN); gLog(mine, P.name + ' 님 출석 (+' + R.GUILD_CHECKIN + ')');
    return ok({ got: R.GUILD_CHECKIN });
  }
  R.advance(P, world.ctx(gnow), gnow);
  if (op === 'ritual') {
    if ((g.lv || 1) < R.GRIT_LV) return fail(req, res, 400, '동아리 ' + R.GRIT_LV + '레벨부터 의식을 올릴 수 있습니다');
    const st = gritState(mine, gCount(mine), gnow); if (st.pids.indexOf(me) >= 0) return fail(req, res, 400, '오늘은 이미 봉헌했습니다');
    const cost = R.ritualCost(P, world.ctx(gnow), gnow); if (P.res.mana < cost) return fail(req, res, 400, '마나가 모자랍니다 (마나 ' + R.fmt(cost) + ' 필요)');
    P.res.mana -= cost; st.pids.push(me); store.markDirty(me);
    R.log(P, gnow, '동아리 의식에 마나 ' + R.josa(R.fmt(cost), '을', '를') + ' 봉헌했습니다', 'news'); gLog(mine, P.name + ' 님이 동아리 의식에 봉헌 (' + st.pids.length + '/' + st.goal + ')');
    if (st.done) R.gritBless(P, gnow);
    else if (st.pids.length >= st.goal) {
      st.done = gnow;
      st.pids.forEach((pid) => { const Q = pid === me ? P : store.get(pid); if (Q) { R.gritBless(Q, gnow); R.log(Q, gnow, '동아리 의식이 이루어졌습니다. ' + R.GRIT_BUFF.text, 'story'); store.markDirty(pid); } });
      gSys(mine, '✦ 오늘의 동아리 의식이 이루어졌습니다! 봉헌한 ' + st.pids.length + '명에게 「' + R.GRIT_BUFF.name + '」 — ' + R.GRIT_BUFF.text + '. 아직 봉헌하지 않았다면 지금 봉헌해도 축복을 받습니다.');
    }
    dbx.kvSet('grit:' + mine, st);
    return ok({ P: R.publicState(P), now: gnow });
  }
  if (op === 'wqClaim') {
    if ((g.lv || 1) < R.GWQ_LV) return fail(req, res, 400, '동아리 ' + R.GWQ_LV + '레벨부터 주간 과제가 열립니다');
    const q = R.GWQ.find((x) => x.id === String(b.id || '')); if (!q) return fail(req, res, 400, '없는 과제입니다');
    R.gwqSync(P, gnow); const v = gwqView(dbx.q.gMembers.all(mine), P, gnow).list.find((x) => x.id === q.id);
    if (v.got) return fail(req, res, 400, '이번 주 보상을 이미 받았습니다');
    if (v.prog < v.goal) return fail(req, res, 400, '아직 목표를 채우지 못했습니다 (' + v.prog + '/' + v.goal + ')');
    if (v.mine < v.need) return fail(req, res, 400, '이 과제에 ' + v.need + q.unit + ' 이상 보태야 받을 수 있습니다 (지금 ' + v.mine + q.unit + ')');
    const rw = R.gwqReward(P); P.gwq.got[q.id] = 1; P.res.shard += rw.shard; store.markDirty(me);
    R.log(P, gnow, '주간 동아리 과제 「' + q.name + '」 보상: 별조각 +' + rw.shard, 'good'); gXp(mine, rw.gxp); gLog(mine, P.name + ' 님이 주간 과제 「' + q.name + '」 보상을 받았습니다 (+' + rw.gxp + ')');
    return ok({ got: rw, P: R.publicState(P), now: gnow });
  }
  if (op === 'donate') {
    const unit = R.guildGoldUnit(P), used = meRow.dday === day ? meRow.dpts : 0, room = R.GUILD_DONATE_CAP - used;
    if (room <= 0) return fail(req, res, 400, '오늘 기부 한도(' + R.GUILD_DONATE_CAP + '점)를 다 채웠습니다');
    const pts = Math.min(room, Math.floor(Math.max(0, Number(b.gold) || 0) / unit), Math.floor(P.res.gold / unit));
    if (pts <= 0) return fail(req, res, 400, '기여도 1점은 ' + CUR + ' ' + R.fmt(unit) + '입니다');
    const cost = pts * unit; P.res.gold -= cost; store.markDirty(me);
    dbx.q.gDonate.run(day, used + pts, pts, me); gXp(mine, pts); gLog(mine, P.name + ' 님 기부 ' + R.fmt(cost) + ' ' + CUR + ' (+' + pts + ')');
    return ok({ got: pts, cost, P: R.publicState(P), now: gnow });
  }
  // ── 동아리 창고: 누구나 넣을 수 있고, 꺼내기는 권한이 있어야 한다 ──
  if (op === 'deposit') {
    if (b.u) {
      const i = P.inv.findIndex((x) => x.u === String(b.u)); if (i < 0) return fail(req, res, 400, '가방에 없는 장비입니다');
      if (P.inv[i].lock) return fail(req, res, 400, '잠긴 장비는 넣을 수 없습니다');
      if (dbx.q.giCount.get(mine).n >= R.guildSlots(g.lv)) return fail(req, res, 400, '창고가 가득 찼습니다 (' + R.guildSlots(g.lv) + '칸)');
      const it = P.inv.splice(i, 1)[0]; dbx.q.giPut.run(mine, JSON.stringify(it), it.name + (it.enh ? ' +' + it.enh : ''), it.r, it.ilvl, it.slot, P.name, now); store.markDirty(me);
      gLog(mine, P.name + ' 님이 ' + R.josa(it.name + (it.enh ? ' +' + it.enh : ''), '을', '를') + ' 넣었습니다');
    } else {
      const amt = Math.floor(Number(b.gold) || 0); if (!(amt >= 1) || amt > P.res.gold) return fail(req, res, 400, CUR + '를 확인 필요');
      P.res.gold -= amt; dbx.q.gGoldAdd.run(amt, mine); store.markDirty(me); gLog(mine, P.name + ' 님이 ' + R.fmt(amt) + ' ' + CUR + '를 넣었습니다');
    }
    return ok({ P: R.publicState(P), now: gnow });
  }
  if (op === 'withdraw') {
    if (!can('take')) return fail(req, res, 403, '창고에서 꺼낼 권한이 없습니다');
    if (b.id) {
      const r = dbx.q.giGet.get(Number(b.id) | 0, mine); if (!r) return fail(req, res, 404, '이미 누가 꺼냈습니다');
      if (P.inv.length >= R.calc(P, world.ctx(gnow), gnow).bag) return fail(req, res, 400, '가방이 가득 찼습니다');
      if (!dbx.q.giDel.run(r.id, mine).changes) return fail(req, res, 409, '이미 누가 꺼냈습니다');
      P.inv.push(JSON.parse(r.data)); store.markDirty(me); gLog(mine, P.name + ' 님이 ' + R.josa(r.name, '을', '를') + ' 꺼냈습니다');
    } else {
      const amt = Math.floor(Number(b.gold) || 0); if (!(amt >= 1)) return fail(req, res, 400, CUR + '를 확인 필요');
      if (!dbx.q.gGoldTake.run(amt, mine, amt).changes) return fail(req, res, 400, '창고 ' + CUR + '가 모자랍니다');
      P.res.gold += amt; store.markDirty(me); gLog(mine, P.name + ' 님이 ' + R.fmt(amt) + ' ' + CUR + '를 꺼냈습니다');
    }
    return ok({ P: R.publicState(P), now: gnow });
  }
  fail(req, res, 400, '알 수 없는 요청입니다');
};

/* ───────── 관리자 ───────── */
function admin(req) {
  if (cfg.adminIps.length && cfg.adminIps.indexOf(clientIp(req)) < 0) return false;   // 허용한 IP에서만
  const got = req.headers['x-admin-token']; if (!cfg.adminToken || !got) return false;
  // 길이와 상관없이 같은 시간에 비교 (두 값의 해시를 비교)
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(String(got)).digest(), crypto.createHash('sha256').update(cfg.adminToken).digest());
}
routes['GET /api/admin/stats'] = (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const now = Math.floor(Date.now() / 1000);
  send(req, res, 200, {
    players: Number(dbx.q.countPlayers.get().n), active24h: Number(dbx.q.countActive.get(now - 86400).n), active7d: Number(dbx.q.countActive.get(now - 7 * 86400).n),
    online2m: store.online(120000), cached: store.size(), memoryMB: Math.round(process.memoryUsage().rss / 1048576), uptimeH: +(process.uptime() / 3600).toFixed(2),
    chatConnections: chat.connections(), chatOnline: chat.online(), inviteRequired: cfg.inviteRequired, boss: world.W.boss, epoch: world.W.epoch, wbForecast: Math.floor(world.wbForecast(Math.floor(nowSec()))), wbAttacks: R.wbAttacksLeft(nowSec())
  });
};
routes['POST /api/admin/notice'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 4096);
  if (b.unpin) { dbx.kvSet('pinNotice', null); chat.pingAll('pin', { pin: null }); oplog('admin', '관리자', 'notice', '상단 고정 해제'); return send(req, res, 200, { ok: true, pin: null }); }   // 고정 해제만
  if (!b.text) return fail(req, res, 400, 'text가 필요합니다');
  const text = String(b.text).slice(0, 500), t = Date.now() / 1000;
  world.addNotice(text, nowSec(), false); world.invalidate(); const m = chat.staffNotice(text, t);
  if (b.pin) { const pin = { id: m.id, t, text }; dbx.kvSet('pinNotice', pin); chat.pingAll('pin', { pin }); }   // 공지 탭 상단에 고정
  send(req, res, 200, { ok: true, pin: b.pin ? dbx.kvGet('pinNotice', null) : undefined });
};
routes['POST /api/admin/wbsummon'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 256); let boss;
  try { boss = world.summonBoss(nowSec(), b.hp, b.n, b.per); } catch (e) { return fail(req, res, 400, e.message); }
  world.invalidate(); const t = '추가 월드 보스 ' + R.josa(boss.name, '이', '가') + ' 등장했습니다! 토벌에 성공하면 도전한 학생 모두에게 보상이 우편으로 전달됩니다.';
  chat.system('world', t, Date.now() / 1000); chat.system('notice', t, Date.now() / 1000);
  oplog('admin', '관리자', 'wbsummon', `${boss.name} (${boss.round}번째, 체력 ${R.fmt(boss.maxHp)})`); send(req, res, 200, { ok: true, boss });
};
routes['POST /api/admin/grant'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 4096), row = dbx.q.playerByKey.get(nameKey(String(b.name || '')));
  if (!row) return fail(req, res, 404, '없는 학생입니다');
  const P = store.get(row.id), shard = Math.max(0, Math.min(100000, Number(b.shard) || 0));
  P.res.shard += shard; R.log(P, nowSec(), '아카데미에서 별조각 ' + shard + '개를 보냈습니다' + (b.reason ? ' (' + String(b.reason).slice(0, 60) + ')' : ''), 'news');
  store.markDirty(row.id); send(req, res, 200, { ok: true, shard: P.res.shard });
};
routes['POST /api/admin/ops'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 1024), row = dbx.q.playerByKey.get(nameKey(String(b.name || '')));
  if (!row) return fail(req, res, 404, '없는 학생입니다');
  const on = b.op !== false, role = !on ? 'user' : b.rank === 'chief' ? 'chief' : 'admin';   // admin 학생회 · chief 학생회장
  dbx.q.setRole.run(role, row.id); if (on) adminIds.add(row.id); else adminIds.delete(row.id); if (role === 'chief') chiefIds.add(row.id); else chiefIds.delete(row.id);
  { const P = store.get(row.id); if (P) syncOp(P); }
  oplog('admin', '관리자', 'role', `${row.name || b.name} → ${role === 'chief' ? '학생회장' : role === 'admin' ? '학생회' : '운영자 해제'}`); chat.opChanged(row.id); send(req, res, 200, { ok: true, op: on, rank: role });
};
routes['POST /api/admin/slow'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 256), before = chat.getSlow(), v = chat.setSlow(b.sec); dbx.kvSet('chat_slow', v); oplog('admin', '관리자', 'slow', `월드 ${before}초 → ${v}초`); send(req, res, 200, { ok: true, sec: v });
};
// 성장 데이터: 최근 N일 스냅샷을 CSV로. 학생은 이름 대신 해시(익명 번호)로
routes['GET /api/admin/growth'] = (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const u = new URL(req.url, 'http://x'), days = Math.max(1, Math.min(400, Number(u.searchParams.get('days')) || 30));
  if (u.searchParams.get('now') === '1') growthSnap(true);
  const from = kstDay(Math.floor(Date.now() / 1000) - (days - 1) * 86400), rows = dbx.q.growthFrom.all(from);
  const cols = ['d', 'house', 'cls', 'lvl', 'power', 'grade', 'stage', 'ctM', 'ctK', 'cup', 'act'].concat(GROWTH_ST), anon = (id) => crypto.createHash('sha256').update('growth:' + id).digest('hex').slice(0, 10);
  const lines = [['date', 'student'].concat(cols).join(',')];
  rows.forEach((r) => { let o = {}; try { o = JSON.parse(r.data); } catch (e) { } lines.push([String(r.day).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'), anon(r.pid)].concat(cols.map((k) => o[k] == null ? '' : String(o[k]).replace(/[,\n]/g, ' '))).join(',')); });
  send(req, res, 200, { csv: lines.join('\n'), rows: rows.length, days: dbx.q.growthDays.all().slice(0, days) });
};
routes['GET /api/admin/oplog'] = (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  send(req, res, 200, { log: dbx.q.oplogList.all(200) });
};
/* ───────── 캐릭터 초기화 (운영실) ─────────
   아이디 · 비밀번호 · 운영진 여부는 그대로 두고 새 학생 번호로 처음부터. 예전 캐릭터는 「삭제된 사용자」로 남아
   예전 1:1 대화는 볼 수 있지만 정보 카드는 열리지 않는다. 친구 · 파티 · 동아리 · 함께 원정 방에서는 빠진다. 받지 않은 우편은 새 캐릭터로 옮긴다. */
function resetCharacter(oldId) {
  const row = dbx.db.prepare('SELECT * FROM players WHERE id = ?').get(oldId); if (!row || row.deleted) return null;
  const now = nowSec(), real = Math.floor(Date.now() / 1000), newId = crypto.randomUUID();
  store.flushAll();
  try { exprooms.forget(oldId); } catch (e) { }
  if (partyOf.get(oldId)) { const r = leaveParty(oldId); if (r && !r.gone) chat.system('party', row.name + ' 님이 파티에서 나갔습니다.', now / 1, r.party); }
  const gid = guildOf.get(oldId);
  if (gid) {
    const g = dbx.q.gGet.get(gid), role = guildRole.get(oldId);
    if (role === 'owner' && gCount(gid) > 1) {   // 회장이면 다음 사람(부회장 먼저, 오래된 순)에게 넘긴다
      const next = dbx.q.gMembers.all(gid).filter((m) => m.id !== oldId).sort((a, b) => (a.role === 'officer' ? 0 : 1) - (b.role === 'officer' ? 0 : 1))[0];
      dbx.tx(() => { dbx.q.gRole.run('owner', next.id); dbx.q.gSetRank.run('', next.id); dbx.q.gOwner.run(next.id, gid); }); guildRole.set(next.id, 'owner');
      gLeave(oldId); gSys(gid, row.name + ' 님이 동아리에서 나가 ' + next.name + ' 님이 새 회장이 되었습니다.'); gLog(gid, row.name + ' 님 탈퇴(캐릭터 초기화) · ' + next.name + ' 님이 회장');
    } else if (role === 'owner') {
      gRankCache.at = 0; dbx.tx(() => { dbx.q.gDelMembers.run(gid); dbx.q.gDelete.run(gid); dbx.q.gAppDelGuild.run(gid); dbx.q.giDelGuild.run(gid); dbx.q.glDelGuild.run(gid); dbx.q.ginvDelGuild.run(gid); });
      guildOf.delete(oldId); guildRole.delete(oldId); guildLv.delete(gid); chat.dropGuild(gid);
    } else { gLeave(oldId); gSys(gid, row.name + ' 님이 동아리에서 나갔습니다.'); gLog(gid, row.name + ' 님 탈퇴(캐릭터 초기화)'); }
    if (g) gRankCache.at = 0;
  }
  const P0 = R.newPlayer(newId, '새 학생', row.house, now, crypto.randomInt(1, 2147483647)); P0.needCreate = 1;
  dbx.tx(() => {
    const D = (sql, ...a) => dbx.db.prepare(sql).run(...a);
    D('DELETE FROM friends WHERE pid = ? OR fid = ?', oldId, oldId);
    D('DELETE FROM party_invites WHERE pid = ?', oldId);
    D('DELETE FROM guild_apps WHERE pid = ?', oldId);
    D('DELETE FROM guild_invites WHERE pid = ?', oldId);
    D("DELETE FROM market WHERE seller = ? AND status = 'open'", oldId);
    D("UPDATE auction SET price = 0, bidder = '', bidder_name = '', bids = 0 WHERE done = 0 AND bidder = ?", oldId);
    D('DELETE FROM notes WHERE pid = ?', oldId);
    D('DELETE FROM sessions WHERE pid = ?', oldId);
    D('INSERT OR IGNORE INTO mail_state (mail, pid, read, claimed) SELECT mail, ?, read, claimed FROM mail_state WHERE pid = ?', newId, oldId);   // 모두에게 보낸 우편을 다시 받지 않게
    D('UPDATE mail SET target = ? WHERE target = ?', newId, oldId);   // 받지 않은 우편은 새 캐릭터로
    try { D('UPDATE push_subs SET pid = ? WHERE pid = ?', newId, oldId); } catch (e) { }
    D("UPDATE players SET deleted = 1, banned = 1, name_key = ?, login_key = '', pass = '' WHERE id = ?", '~del:' + oldId, oldId);
    dbx.q.insertPlayerFull.run(newId, '새 학생', '~new:' + newId, row.house, row.pass, real, real, JSON.stringify(P0), 0, row.invite || '', row.login_key);
    if (row.role === 'admin' || row.role === 'chief') dbx.q.setRole.run(row.role, newId);
    D('UPDATE players SET login_enc = ? WHERE id = ?', row.login_enc || '', newId);
  });
  if (adminIds.has(oldId)) { adminIds.delete(oldId); adminIds.add(newId); }
  if (chiefIds.has(oldId)) { chiefIds.delete(oldId); chiefIds.add(newId); }
  for (const [k, v] of sessionCache) if (v.pid === oldId) sessionCache.delete(k);
  store.drop(oldId); chat.kick(oldId);
  oplog('admin', '관리자', 'reset', row.name + ' 캐릭터 초기화');
  return { name: row.name, id: newId };
}
// 운영실: 학생 이름 ↔ 아이디 확인 (크로스체크용). 아이디는 암호화해 두었다가 여기서만 풀어 보여 준다
// 기록이 없으면 ① 이름이 곧 아이디인 예전 학생인지 색인으로 확인하고 ② 이름 · 아이디를 함께 넣으면 그 아이디가 맞는지 색인으로 대조한다 (맞으면 기록)
routes['POST /api/admin/lookup'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 1024), lg = String(b.login || '').trim(), nm = String(b.name || '').trim();
  const sel = 'SELECT id, name, name_key, role, login_key, login_enc, banned, deleted FROM players WHERE ';
  const row = nm ? dbx.db.prepare(sel + 'name_key = ?').get(nameKey(nm)) : lg ? dbx.db.prepare(sel + 'login_key = ?').get(loginKey(lg)) : null;
  if (!row) return fail(req, res, 404, nm ? '없는 학생 이름입니다' : lg ? '없는 아이디입니다' : '이름이나 아이디 입력 필요');
  let login = ''; try { login = row.login_enc ? sec.dec(row.login_enc) : ''; } catch (e) { }
  const save = (v) => { try { dbx.db.prepare('UPDATE players SET login_enc = ? WHERE id = ?').run(sec.enc(v), row.id); } catch (e) { } };
  let match = null;
  if (nm && lg) { match = !!row.login_key && loginKey(lg) === row.login_key; if (match && !login) { login = LOGIN_RE.test(lg.toLowerCase()) ? lg.toLowerCase() : lg; save(login); } }
  if (!login && row.login_key && row.login_key === sec.index('login:' + row.name_key)) { login = row.name; save(login); }   // 아이디 이전에 가입 → 이름이 아이디
  oplog('admin', '관리자', 'lookup', (row.name || '') + ' 아이디 확인');
  send(req, res, 200, { name: row.name, login: login || null, match, rank: row.role === 'chief' ? '학생회장' : row.role === 'admin' ? '학생회' : '', banned: !!row.banned });
};
// 운영실: 학생 활동 기록 (게임 안 기록 최근 50줄 · 같은 일이 이어지면 횟수로 묶임) 과 영웅 · 전설 장비 보유 현황
routes['POST /api/admin/plog'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 1024), nm = String(b.name || '').trim(), row = nm ? dbx.q.playerByKey.get(nameKey(nm)) : null;
  if (!row) return fail(req, res, 404, nm ? '없는 학생 이름입니다' : '학생 이름 입력 필요');
  const P = store.get(row.id); if (!P) return fail(req, res, 404, '학생 정보를 찾을 수 없습니다');
  const items = (P.inv || []).map((it) => ({ it, at: '가방' })).concat(Object.keys(P.eq || {}).filter((k) => P.eq[k]).map((k) => ({ it: P.eq[k], at: '장착' })));
  const high = items.filter((x) => x.it.r >= 3).map((x) => ({ name: x.it.name + (x.it.enh ? ' +' + x.it.enh : ''), r: x.it.r, ilvl: x.it.ilvl, at: x.at }));
  oplog('admin', '관리자', 'plog', row.name + ' 활동 기록 확인');
  send(req, res, 200, { name: row.name, log: (P.log || []).slice(0, 50).map((l) => ({ t: l.t, m: l.m, k: l.k, n: l.n || 1 })), high, st: { expJobs: P.st.expJobs || 0, epicFound: P.st.epicFound || 0, legendFound: P.st.legendFound || 0 } });
};
// 운영실: 비밀번호를 잃어버린 학생에게 임시 비밀번호를 발급한다. 모든 기기에서 로그아웃되고, 로그인하면 비밀번호를 바꾸라고 안내한다
routes['POST /api/admin/resetpw'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 1024), row = dbx.q.playerByKey.get(nameKey(String(b.name || '')));
  if (!row) return fail(req, res, 404, '없는 학생입니다');
  const abc = 'abcdefghjkmnpqrstuvwxyz', num = '23456789', pick = (s) => s[crypto.randomInt(s.length)];
  let temp = ''; for (let i = 0; i < 6; i++) temp += pick(abc); for (let i = 0; i < 4; i++) temp += pick(num);   // 글자 6 + 숫자 4 (헷갈리는 l · o · 0 · 1 제외)
  dbx.q.setPass.run(await hashPass(temp), row.id);
  dbx.db.prepare('UPDATE players SET pw_temp = 1 WHERE id = ?').run(row.id);
  dbx.q.delSessionsFor.run(row.id);
  for (const [k, v] of sessionCache) if (v.pid === row.id) sessionCache.delete(k);
  chat.kick(row.id);
  let login = ''; try { const r = dbx.db.prepare('SELECT login_enc FROM players WHERE id = ?').get(row.id); login = r && r.login_enc ? sec.dec(r.login_enc) : ''; } catch (e) { }
  oplog('admin', '관리자', 'resetpw', row.name + ' 임시 비밀번호 발급');
  send(req, res, 200, { name: row.name, login: login || null, temp });
};
// 운영실: 아이디를 잃어버린 학생에게 새 아이디를 정해 준다 (비밀번호는 그대로 → 새 아이디 + 원래 비밀번호로 로그인)
routes['POST /api/admin/setlogin'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 1024), row = dbx.q.playerByKey.get(nameKey(String(b.name || ''))), login = String(b.login || '').trim().toLowerCase();
  if (!row) return fail(req, res, 404, '없는 학생입니다');
  if (!LOGIN_RE.test(login)) return fail(req, res, 400, LOGIN_RULE);
  if (login === nameKey(row.name)) return fail(req, res, 400, '아이디는 학생 이름과 다르게 정해 주세요');
  const lkey = loginKey(login), other = dbx.q.playerByLogin.get(lkey);
  if (other && other.id !== row.id) return fail(req, res, 409, '이미 사용 중인 아이디입니다');
  dbx.q.setLoginKey.run(lkey, row.id);
  try { dbx.db.prepare('UPDATE players SET login_enc = ? WHERE id = ?').run(sec.enc(login), row.id); } catch (e) { }
  oplog('admin', '관리자', 'setlogin', row.name + ' 아이디 새로 정함');
  send(req, res, 200, { name: row.name, login });
};
routes['POST /api/admin/reset'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 1024), row = dbx.q.playerByKey.get(nameKey(String(b.name || '')));
  if (!row) return fail(req, res, 404, '없는 학생입니다');
  // 이름만으로는 다른 학생을 잘못 지울 수 있어 아이디도 맞아야 한다
  const lk = String(b.login || '').trim(); if (!lk) return fail(req, res, 400, '아이디 입력 필요');
  const full = dbx.db.prepare('SELECT login_key FROM players WHERE id = ?').get(row.id);
  if (!full || !full.login_key || full.login_key !== loginKey(lk)) return fail(req, res, 400, '학생 이름과 아이디가 맞지 않습니다');
  const r = resetCharacter(row.id); if (!r) return fail(req, res, 400, '초기화할 수 없습니다');
  send(req, res, 200, { ok: true, name: r.name });
};
// 초기화된 계정: 학생 이름 · 기숙사 · 학과를 새로 정해 입학한다
routes['POST /api/recreate'] = async (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  const P0 = store.get(pid); if (!P0 || !P0.needCreate) return fail(req, res, 400, '이미 입학한 학생입니다');
  const b = await readJson(req, 1024), name = R.cleanName(b.name), house = String(b.house || ''), cls = String(b.cls || '');
  if (!NAME_RE.test(name)) return fail(req, res, 400, R.NAME_RULE);
  if (R.badName(name)) return fail(req, res, 400, '사용할 수 없는 단어가 포함된 이름입니다');
  if (!R.HOUSE[house]) return fail(req, res, 400, '기숙사 선택 필요');
  if (!R.CLS[cls]) return fail(req, res, 400, '학과 선택 필요');
  if (dbx.q.playerByKey.get(nameKey(name))) return fail(req, res, 409, '이미 사용 중인 이름입니다');
  const now = nowSec(), P = R.newPlayer(pid, name, house, now, crypto.randomInt(1, 2147483647)); R.clsStart(P, cls);
  R.advance(P, world.ctx(now), now); syncOp(P);
  try { dbx.db.prepare('UPDATE players SET name = ?, name_key = ?, house = ?, created = ?, state = ? WHERE id = ?').run(name, nameKey(name), house, Math.floor(now), JSON.stringify(P), pid); }
  catch (e) { return fail(req, res, 409, '이미 사용 중인 이름입니다'); }
  store.drop(pid); store.put(P); store.markDirty(pid);
  log(`다시 입학: ${name} (${house})`);
  world.addNews(P.name + ' 학생이 ' + (R.HOUSE[P.house] ? R.HOUSE[P.house].name : '아카데미') + '에 입학했습니다', now);
  headWelcome(P);
  send(req, res, 200, statePayload(P, now));
};
routes['POST /api/admin/ban'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 4096), key = nameKey(String(b.name || '')), row = dbx.q.playerByKey.get(key);
  if (!row) return fail(req, res, 404, '없는 학생입니다');
  dbx.q.setBan.run(b.ban === false ? 0 : 1, key); dbx.q.delSessionsFor.run(row.id); sessionCache.clear(); store.flushAll(); store.drop(row.id); if (b.ban !== false) chat.kick(row.id);
  send(req, res, 200, { ok: true });
};
routes['POST /api/admin/invites'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 4096);
  const count = Math.max(1, Math.min(500, Number(b.count) || 1)), uses = Math.max(1, Math.min(10000, Number(b.uses) || 1));
  let days = Math.max(0, Math.min(3650, Number(b.days) || 0)), note = String(b.note || '').slice(0, 80), now = Math.floor(Date.now() / 1000);
  // 운영자 초대코드: 이 코드로 가입한 학생은 운영자가 된다. 새어 나가도 피해가 작게 한 장 · 1회 · 최대 7일
  const op = b.op ? 1 : 0, n = op ? 1 : count, u = op ? 1 : uses; if (op) days = Math.min(days || 7, 7);
  const codes = [];
  dbx.tx(() => { for (let i = 0; i < n; i++) { let c; do { c = newCode(); } while (dbx.q.getInvite.get(c)); dbx.q.insertInvite.run(c, u, now, days ? now + days * 86400 : 0, note, op); codes.push(c); } });
  log(`${op ? '운영자 ' : ''}초대코드 ${n}개 발급 (각 ${u}회${days ? ', ' + days + '일' : ''}) ${note}`); if (op) oplog('admin', '관리자', 'opinvite', note || '');
  send(req, res, 200, { codes });
};
routes['GET /api/admin/invites'] = (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  send(req, res, 200, { invites: dbx.q.listInvites.all(500) });
};
routes['POST /api/admin/invites/disable'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 1024), code = normCode(b.code);
  if (!code || !dbx.q.disableInvite.run(b.enable ? 0 : 1, code).changes) return fail(req, res, 404, '없는 초대코드입니다');
  send(req, res, 200, { ok: true });
};
routes['POST /api/admin/mute'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 1024), row = b.pid ? { id: String(b.pid) } : dbx.q.playerByKey.get(nameKey(String(b.name || '')));
  if (!row || !dbx.q.playerMeta.get(row.id)) return fail(req, res, 404, '없는 학생입니다');
  const minutes = Math.max(0, Math.min(525600, Number(b.minutes) || 0));
  dbx.q.setMute.run(minutes ? Math.floor(Date.now() / 1000) + minutes * 60 : 0, row.id);
  if (b.purge) { chat.removeBy(row.id); board.deleteBy(row.id); exprooms.forget(row.id); dbx.q.noteDelBy.run(row.id); }
  send(req, res, 200, { ok: true });
};
routes['POST /api/admin/chat/delete'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 1024); chat.remove(Number(b.id) | 0); send(req, res, 200, { ok: true });
};
// 운영실: 관리자만 보기 글(문의·건의) 모아 보기 · 운영진 이름으로 답변 · 지우기
routes['GET /api/admin/board'] = (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  send(req, res, 200, { posts: board.adminList() });
};
routes['POST /api/admin/board'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 4096), now = Math.floor(Date.now() / 1000);
  try {
    if (b.op === 'reply') board.comment('staff', b.id, b.text, now);
    else if (b.op === 'del') board.del('staff', b.id);
    else if (b.op === 'cdel') board.cdel('staff', b.cid);
    else if (b.op === 'status') board.setStatus('staff', b.id, b.st);
    else return fail(req, res, 400, '알 수 없는 요청입니다');
    oplog('admin', '관리자', 'board', b.op + ' #' + (b.id || b.cid)); send(req, res, 200, { ok: true, posts: board.adminList() });
  } catch (e) { if (e.status) return fail(req, res, e.status, e.message); throw e; }
};
routes['GET /api/admin/reports'] = (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const u = new URL(req.url, 'http://x');
  send(req, res, 200, { reports: dbx.q.listReports.all(u.searchParams.get('resolved') === '1' ? 1 : 0, 200).map((r) => Object.assign(r, { text: sec.dec(r.text), reason: sec.dec(r.reason) })) });
};
routes['POST /api/admin/reports/resolve'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 1024); dbx.q.resolveReport.run(Number(b.id) | 0); send(req, res, 200, { ok: true });
};
routes['POST /api/admin/chat/system'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 2048); if (!chat.CHANNELS[b.ch] || !b.text) return fail(req, res, 400, 'ch, text가 필요합니다');
  chat.system(b.ch, String(b.text).slice(0, 300), Date.now() / 1000); send(req, res, 200, { ok: true });
};
// 운영실: 분포 통계 (이름 · 아이디 없이 숫자 분위만). 밸런스 조정용으로 Claude에게 붙여 넣는다
routes['GET /api/admin/dist'] = (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const db = dbx.db, now = Math.floor(Date.now() / 1000), wk = R.weekId(nowSec());
  const pct = (a) => { a = a.filter((v) => v != null && isFinite(v)).sort((x, y) => x - y); if (!a.length) return { n: 0 }; const q = (p) => Math.round(a[Math.min(a.length - 1, Math.floor(a.length * p))] * 100) / 100; return { n: a.length, p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), p99: q(0.99), max: q(1) }; };
  const by = (rows, key, val) => { const m = { all: [] }; rows.forEach((r) => { const v = Number(r[val]); m.all.push(v); (m[r[key]] = m[r[key]] || []).push(v); }); const o = {}; for (const k in m) o[k] = pct(m[k]); return o; };
  const players = db.prepare('SELECT house, power, lvl, grade, max_stage, wb_dps, last_seen FROM players WHERE banned = 0 AND guest = 0').all();
  const act = players.filter((p) => p.last_seen >= now - 7 * 86400);
  const grades = {}; act.forEach((p) => { grades[p.grade] = (grades[p.grade] || 0) + 1; });
  const fight = (rows) => ({ power: by(rows, 'house', 'power'), lvl: by(rows, 'house', 'lvl'), maxStage: by(rows, 'house', 'max_stage'), wbDps: by(rows, 'house', 'wb_dps') });
  const cup = {}; db.prepare('SELECT DISTINCT week FROM weekly WHERE week <= ? ORDER BY week DESC LIMIT 4').all(wk).forEach(({ week }) => {
    const rows = db.prepare('SELECT house, cup, dmg, att FROM weekly WHERE week = ?').all(week);
    const c = rows.filter((r) => r.cup > 0), o = by(c, 'house', 'cup'); for (const h in o) if (h !== 'all') o[h].a100 = c.filter((r) => r.house === h && r.cup >= (R.CUP_ACTIVE || 100)).length;
    cup[week] = { now: week === wk, cup: o, wbDmg: pct(rows.filter((r) => r.dmg > 0).map((r) => r.dmg)), wbAttacks: pct(rows.filter((r) => r.att > 0).map((r) => r.att)) };
  });
  // 최근 7일 활동 학생의 세부 전투 능력 (저장된 상태로 다시 계산): 학과별 · 학년별 딜 · 딜 구성 · 생존 · 탑
  const detail = [];
  db.prepare('SELECT id, house, grade, state FROM players WHERE banned = 0 AND guest = 0 AND last_seen >= ? LIMIT 5000').all(now - 7 * 86400).forEach((r) => {
    try {
      const P = store.peek(r.id) || (() => { const x = JSON.parse(r.state); R.fixState(x); return x; })();
      const c = R.calc(P, world.ctx(nowSec()), Math.min(nowSec(), P.at || nowSec())), st = P.st || {};
      detail.push({ cls: P.cls === 'knight' ? 'knight' : 'mage', grade: P.grade, house: r.house, dps: c.totalDps, basic: c.dps, spell: c.spellDps, fam: c.famDps, spellShare: c.totalDps > 0 ? c.spellDps / c.totalDps : 0,
        patk: c.patk, matk: c.matk, hp: c.hp, def: c.def, critC: c.critC, aps: c.aps, power: c.power, lvl: P.lvl, twK: st.twK || 0, twM: st.twM || 0 });
    } catch (e) { }
  });
  const KEYS = ['dps', 'basic', 'spell', 'fam', 'spellShare', 'patk', 'matk', 'hp', 'def', 'critC', 'aps', 'power', 'lvl'];
  const group = (key) => { const g = {}; detail.forEach((d) => { (g[d[key]] = g[d[key]] || []).push(d); }); const o = {}; for (const k in g) { o[k] = { n: g[k].length }; KEYS.forEach((f) => { o[k][f] = pct(g[k].map((d) => d[f])); }); } return o; };
  const all = { n: detail.length }; KEYS.forEach((f) => { all[f] = pct(detail.map((d) => d[f])); });
  const clsGrade = {}; detail.forEach((d) => { const k = d.cls + ':' + d.grade; (clsGrade[k] = clsGrade[k] || []).push(d); }); const cg = {}; for (const k in clsGrade) cg[k] = { n: clsGrade[k].length, dps: pct(clsGrade[k].map((d) => d.dps)), hp: pct(clsGrade[k].map((d) => d.hp)), power: pct(clsGrade[k].map((d) => d.power)) };
  const towers = { infKnight: pct(detail.filter((d) => d.twK > 0).map((d) => d.twK)), infMage: pct(detail.filter((d) => d.twM > 0).map((d) => d.twM)), starTowerWeek: pct(db.prepare('SELECT floor FROM tower WHERE week = ? AND floor > 0').all(wk).map((r) => r.floor)) };
  oplog('admin', '관리자', 'dist', '분포 통계 복사');
  send(req, res, 200, { at: now, week: wk, students: { all: players.length, active7d: act.length, gradeActive7d: grades }, fightActive7d: fight(act), fightAll: fight(players), weekly: cup,
    detailActive7d: { note: 'dps=초당 피해 합계(basic 평타 + spell 주문 + fam 사역마), spellShare=주문 비중, patk/matk=물리/주문 공격력, critC=치명타 확률, aps=초당 공격 횟수', all, byCls: group('cls'), byGrade: group('grade'), byClsGrade: cg }, towers });
};
routes['GET /api/admin/ideas'] = (req, res) => { if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다'); send(req, res, 200, { text: board.exportIdeas() }); };
routes['GET /api/admin/sys'] = (req, res) => { if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다'); send(req, res, 200, { build: BUILD, maint: MAINT, pin: dbx.kvGet('pinNotice', null), epoch: world.W.epoch, cal: R.calendar(world.W, nowSec()) }); };
// 개교일(아카데미력 서사달 1일이 되는 날, 한국 시간 날짜). 바꾸면 달력 · 달 축복 · 날씨가 그 날짜 기준으로 다시 계산된다
routes['POST /api/admin/epoch'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 256), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(b.date || ''));
  const t = m ? Math.floor(Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T00:00:00+09:00') / 1000) : NaN;
  if (!isFinite(t) || t > nowSec()) return fail(req, res, 400, '오늘 이전 날짜(YYYY-MM-DD) 입력 필요');
  world.W.epoch = t; dbx.kvSet('epoch', t); world.invalidate(); oplog('admin', '', 'epoch', b.date);
  send(req, res, 200, { ok: true, epoch: t, cal: R.calendar(world.W, nowSec()) });
};
// 새 버전 알리기: {build, minBuild} — 접속한 모두에게 'ver'을 보낸다
routes['POST /api/admin/build'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 512); BUILD = { build: Math.max(0, Math.floor(+b.build || 0)), minBuild: Math.max(0, Math.floor(+b.minBuild || 0)) };
  dbx.kvSet('build', BUILD); chat.pingAll('ver', BUILD); oplog('admin', '', 'build', BUILD.build + (BUILD.minBuild ? ' (최소 ' + BUILD.minBuild + ')' : '')); send(req, res, 200, { ok: true, build: BUILD });
};
// 점검: {on:true} 바로 시작 · {start: 유닉스초, until, msg} 예고 · {on:false} 끝
routes['POST /api/admin/maint'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 2048); maintSet(b); send(req, res, 200, { ok: true, maint: MAINT });
};
routes['POST /api/admin/backup'] = (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  send(req, res, 200, { file: backup() });
};

/* ───────── HTTP 서버 ───────── */
const MAINT_OPEN = { '/api/health': 1, '/api/meta': 1, '/api/login': 1, '/api/logout': 1 };
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const key = req.method + ' ' + url;
  try {
    if (req.method === 'POST' && url.startsWith('/api/') && !/^application\/json\b/i.test(req.headers['content-type'] || '')) return fail(req, res, 415, 'JSON 형식 필요');
    if (req.method === 'POST' && !sameOrigin(req)) return fail(req, res, 403, '다른 사이트에서 보낸 요청은 받지 않습니다');
    // 점검 중: 운영자가 아니면 API를 막는다 (상태 확인·로그인·관리자 API는 열어 둔다)
    if (MAINT.on && url.startsWith('/api/') && !MAINT_OPEN[url] && !url.startsWith('/api/admin/')) { const mv = maintView(authed(req)); if (!mv.bypass) return send(req, res, 503, { error: '점검 중입니다', maint: mv }); }
    if (routes[key]) return await routes[key](req, res);
    if (url.startsWith('/api/')) return fail(req, res, 404, '없는 API입니다');
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url);
    fail(req, res, 405, '허용되지 않는 요청입니다');
  } catch (e) {
    if (e.code === 413 || e.code === 400) return fail(req, res, e.code, e.message);
    log('오류', key, e.stack || e);
    if (!res.headersSent) fail(req, res, 500, '서버에서 문제가 생겼습니다');
  }
});
server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;
server.requestTimeout = 30000;

/* ───────── 주기 작업 ───────── */
// 성장 스냅샷: 한국 날짜가 바뀌면(서버를 켤 때 오늘 것이 없어도) 학생마다 한 줄. 정지 · 게스트 · 초기화로 남은 캐릭터는 뺀다
const kstDay = (t) => { const d = new Date(t * 1000 + 9 * 3600000); return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); };
const GROWTH_ST = ['kills', 'lecHours', 'lecJobs', 'expJobs', 'bosses', 'bossTries', 'researchDone', 'brews', 'dispatches', 'tasksDone', 'duelWins', 'wbAttacks', 'goldTotal', 'manaTotal', 'famKinds', 'epicFound', 'legendFound', 'maxEnh'];
function growthSnap(force) {
  const real = Math.floor(Date.now() / 1000), day = kstDay(real);
  if (!force && dbx.kvGet('growthDay', 0) === day) return 0;
  const rows = dbx.db.prepare('SELECT id, house, created, last_seen, state, power, lvl, grade FROM players WHERE banned = 0 AND guest = 0 AND deleted = 0').all();
  let n = 0;
  dbx.tx(() => {
    rows.forEach((r) => {
      let P = store.peek(r.id); if (!P) { try { P = JSON.parse(r.state); } catch (e) { return; } }
      const st = P.st || {}, o = { d: Math.floor((real - r.created) / 86400), house: r.house, cls: P.cls || '', lvl: P.lvl || r.lvl, power: Math.round(r.power), grade: P.grade || r.grade, stage: st.maxStageAll || 0,
        ctM: st.twM || 0, ctK: st.twK || 0, cup: Math.round((P.wk && P.wk.cup) || 0), act: real - r.last_seen < 86400 ? 1 : 0 };
      GROWTH_ST.forEach((k) => { o[k] = Math.round(st[k] || 0); });
      dbx.q.growthPut.run(day, r.id, JSON.stringify(o)); n++;
    });
    dbx.kvSet('growthDay', day);
  });
  log('성장 스냅샷 ' + day + ': ' + n + '명');
  return n;
}
function backup() {
  const dir = path.join(cfg.dataDir, 'backups'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  store.flushAll();
  const base = 'moneta-' + new Date().toISOString().slice(0, 13).replace(/[-T:]/g, ''), plain = path.join(dir, base + '.db');
  for (const f of [plain, plain + '.enc']) { try { fs.unlinkSync(f); } catch (e) { } }
  dbx.backup(plain);
  let file = plain;
  if (cfg.backupKey) {
    // AES-256-GCM. 형식: "ARCB1" + salt(16) + iv(12) + tag(16) + 암호문. 풀기: node tools/decrypt-backup.js 파일
    const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
    const key = crypto.scryptSync(cfg.backupKey, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
    const c = crypto.createCipheriv('aes-256-gcm', key, iv), body = Buffer.concat([c.update(fs.readFileSync(plain)), c.final()]);
    file = plain + '.enc';
    fs.writeFileSync(file, Buffer.concat([Buffer.from('ARCB1'), salt, iv, c.getAuthTag(), body]), { mode: 0o600 });
    fs.unlinkSync(plain);
  }
  try { fs.chmodSync(file, 0o600); } catch (e) { }
  const files = fs.readdirSync(dir).filter((f) => /^moneta-.*\.db(\.enc)?$/.test(f)).sort();
  files.slice(0, Math.max(0, files.length - 14)).forEach((f) => fs.unlinkSync(path.join(dir, f)));
  log('백업 완료:', path.basename(file) + (cfg.backupKey ? ' (암호화)' : ''));
  return path.basename(file);
}
const timers = [
  setInterval(() => { try { store.flushAll(500); } catch (e) { log('저장 실패', e); } }, 5000),
  setInterval(() => { try { world.tick(nowSec()); } catch (e) { log('세계 갱신 실패', e); } }, 20000),
  setInterval(() => { try { exprooms.tick(); } catch (e) { log('함께 원정 방 갱신 실패', e); } }, 2000),
  // 예고한 점검 시각이 되면 저절로 점검을 시작한다
  setInterval(() => { if (!MAINT.on && MAINT.start && Date.now() / 1000 >= MAINT.start) maintSet({ on: true, until: MAINT.until, msg: MAINT.msg }, 'auto'); }, 5000),
  setInterval(() => { store.evictIdle(20 * 60000); dbx.q.purgeSessions.run(Math.floor(Date.now() / 1000)); }, 5 * 60000),
  setInterval(() => { try { mkSweep(); } catch (e) { log('거래소 정리 실패', e); } }, 5 * 60000),
  setInterval(() => { try { dbx.q.ginvPurge.run(Math.floor(Date.now() / 1000) - 7 * 86400); } catch (e) { log('동아리 초대 정리 실패', e); } }, 6 * 3600000),
  setInterval(() => { try { npcMarketTick(); } catch (e) { log('NPC 거래 실패', e); } }, 15 * 60000),
  setInterval(() => { try { aucTick(nowSec()); dbx.q.aucPurge.run(Math.floor(nowSec()) - 14 * 86400); } catch (e) { log('경매 처리 실패', e); } }, 20000),
  setInterval(() => { try { dbx.q.mailPurge.run(Math.floor(Date.now() / 1000) - 7 * 86400); dbx.q.mailStatePurge.run(); } catch (e) { log('우편 정리 실패', e); } }, 6 * 3600000),
  setInterval(() => { try { growthSnap(); } catch (e) { log('성장 스냅샷 실패', e); } }, 10 * 60000),
  setTimeout(() => { try { growthSnap(); } catch (e) { log('성장 스냅샷 실패', e); } }, 60000),   // 켜고 1분 뒤 오늘 것이 없으면 바로
  setInterval(() => { try { backup(); } catch (e) { log('백업 실패', e); } }, 12 * 3600000)
];
timers.forEach((t) => t.unref());

function shutdown(sig) {
  log(`${sig} 받음: 저장 후 종료합니다`);
  try { chat.closeAll(); } catch (e) { }
  server.close();
  // 학생 상태 · 월드 보스 체력 · 소식/공지 · 채팅 글 번호를 모두 DB에 쓴 뒤 닫는다 (경매·거래소·채팅 글은 이미 DB에 바로 기록됨)
  try { store.flushAll(); world.tick(nowSec()); world.saveAll(); chat.saveSeq(); exprooms.persist(); } catch (e) { log('종료 중 저장 오류', e); }
  try { dbx.close(); } catch (e) { log('종료 중 오류', e); }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(cfg.port, cfg.host, () => {
  log(`모네타 서버 시작: http://${cfg.host}:${cfg.port}  (데이터: ${cfg.dataDir}${cfg.timeScale !== 1 ? ', 시간 배속 ×' + cfg.timeScale : ''})`);
  if (!cfg.adminToken) log('알림: ADMIN_TOKEN이 없어 관리자 API가 꺼져 있습니다');
  log(`가입: 초대코드 ${cfg.inviteRequired ? '필요' : '불필요'}`);
});
module.exports = { server };
