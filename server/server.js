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
// 학생 계정 기록 (운영실 「활동 기록」에서 확인). IP는 HMAC으로만 남겨 같은 접속지인지만 비교한다
function devOf(req) {
  const u = String((req && req.headers['user-agent']) || '');
  const os = /iPhone|iPad|iPod/.test(u) ? 'iOS' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : '';
  const br = /KAKAOTALK/i.test(u) ? '카카오톡' : /SamsungBrowser/.test(u) ? '삼성 인터넷' : /Whale/.test(u) ? '웨일' : /Edg\//.test(u) ? 'Edge' : /Firefox|FxiOS/.test(u) ? 'Firefox' : /Chrome|CriOS/.test(u) ? 'Chrome' : /Safari/.test(u) ? 'Safari' : u ? '기타' : '';
  return ((/Mobi|Android|iPhone|iPad/.test(u) ? '모바일' : u ? 'PC' : '') + (os ? ' · ' + os : '') + (br ? ' · ' + br : '')).slice(0, 40);
}
function pevent(pid, kind, detail, req) {
  if (!pid) return;
  try { dbx.q.peAdd.run(Math.floor(Date.now() / 1000), pid, kind, String(detail || '').slice(0, 200), req ? sec.index('ip:' + clientIp(req)) : '', req ? devOf(req) : ''); } catch (e) { log('계정 기록 실패', e); }
}
// 접속 기록: 로그인 상태로 들어온 학생을 하루에 한 번, 같은 날이라도 접속지 · 기기가 바뀌면 다시 남긴다
const visitSeen = new Map();   // pid → '날짜|접속지|기기'
function visit(pid, req) {
  const real = Math.floor(Date.now() / 1000), ip = sec.index('ip:' + clientIp(req)), dev = devOf(req), k = kstDay(real) + '|' + ip + '|' + dev;
  if (visitSeen.get(pid) === k) return;
  if (visitSeen.size > 50000) visitSeen.clear();
  visitSeen.set(pid, k);
  try { dbx.q.peAdd.run(real, pid, 'visit', '', ip, dev); } catch (e) { }
}
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
const chat = Chat.create(dbx, log, { initExtra: (pid) => ({ build: BUILD.build, minBuild: BUILD.minBuild, maint: maintView(pid), pin: pinList()[0] || null, pins: pinList() }), sec, gzip: process.env.SSE_GZIP !== '0', isOp: (pid) => isChatOp(pid), slow: { world: dbx.kvGet('chat_slow', 0) }, partyOf: (pid) => partyOf.get(pid) || null, exrOf: (pid) => exprooms.chatKey(pid) || R.expChatKey(store.peek(pid)), guildOf: (pid) => guildOf.get(pid) || null, houseOf: (pid) => { const P = store.get(pid); return P && R.HOUSE[P.house] ? P.house : null; }, clsOf: (pid) => { const P = store.get(pid); return P && R.CLS[P.cls] ? P.cls : null; }, titleOf: (P) => R.titleName(P, P.title), inkOf: (P) => R.decoView(P).ink || '', canDm: (a, b) => friendState(a, b) === 'ok' });
const Board = require('./board.js');
// 알림 기록: 우편과 따로, 일어난 일을 모아 보여 준다 (최근 100개, 30일)
function pname(pid) { const w = dbx.q.getProfile.get(pid); return w ? w.name : '학생'; }
// 할 일 달성(학기 이야기 · 일일 목표 · 교수님 과제): 규칙이 P.noteQ에 넣은 것을 알림으로 옮긴다
function questNotes(P) { if (!P || !P.noteQ || !P.noteQ.length) return; const q = P.noteQ; P.noteQ = []; q.forEach((x) => addNote(P.id, 'quest', x[0], x[1])); store.markDirty(P.id); }
function addNote(pid, kind, text, link) {
  if (!pid || String(pid).startsWith('npc:') || pid === 'staff') return;
  try { dbx.q.noteInsert.run(pid, Math.floor(Date.now() / 1000), kind, sec.enc(String(text).slice(0, 300)), link ? JSON.stringify(link) : ''); chat.ping(pid, 'note', { n: Number(dbx.q.noteUnread.get(pid).n) }); } catch (e) { log('알림 저장 실패', e); }
}
setInterval(() => { try { dbx.q.notePrune.run(Math.floor(Date.now() / 1000) - 30 * 86400); } catch (e) { } }, 3600000).unref();
setInterval(() => { try { dbx.q.pePrune.run(Math.floor(Date.now() / 1000) - 180 * 86400); } catch (e) { } }, 6 * 3600000).unref();   // 계정 기록 180일 보관
const board = Board.create(dbx, sec, { isOp: (pid) => pid !== 'staff' && isChatOp(pid), isChief: (pid) => chiefIds.has(pid), badgeOf: (pid) => { if (pid === 'staff' || !isChatOp(pid)) return ''; const P = store.peek(pid), t = P ? R.titleName(P, P.title) : ((dbx.q.getProfile.get(pid) || {}).title || ''); return R.OP_TITLES[t] ? t : ''; }, sendMail: (...a) => sendMail(...a), note: (...a) => addNote(...a), log });
const ExpRoom = require('./exproom.js');
const exprooms = ExpRoom.create({ loadPlayer: (pid, now) => loadPlayer(pid, now), ctx: () => world.ctx(nowSec()), gameNow: () => nowSec(), markDirty: (pid) => store.markDirty(pid), partyOf, log,
  onRoom: (pid) => chat.exrChanged(pid),   // 방 출입 → 원정 채팅 탭
  isOnline: (pid) => isOnline(pid), save: (json) => dbx.kvSet('exprooms', json), load: () => dbx.kvGet('exprooms', null),   // 다시 켜도 방이 이어진다
  recruit: (P, data) => chat.recruit(P, data, Date.now() / 1000),
  note: (...a) => addNote(...a),
  partyInfo: (pid) => { const id = partyOf.get(pid); if (!id) return null; const pa = dbx.q.partyGet.get(id); if (!pa) return null; return { id, leader: pa.leader, allgo: !!pa.allgo, members: dbx.q.partyMembers.all(id).map((m) => m.id) }; },
  canInvite: (a, b) => friendState(a, b) === 'ok' || (guildOf.get(a) && guildOf.get(a) === guildOf.get(b)) || (partyOf.get(a) && partyOf.get(a) === partyOf.get(b)),   // 친구 · 같은 동아리 · 같은 파티
  nameOf: (pid) => { const r = dbx.q.getProfile.get(pid); return r ? r.name : ''; } });
// 새 업데이트 노트가 배포되면 공지 · 월드 채널에 한 번 알린다
{ const pn = R.D.PATCH && R.D.PATCH[0]; if (pn && dbx.kvGet('patchPosted', 0) < pn.id) { const t = '새 업데이트 노트가 게시되었습니다: 「' + pn.title + '」. 상단의 업데이트 노트 버튼에서 확인할 수 있습니다.'; chat.system('notice', t, Date.now() / 1000); chat.system('world', t, Date.now() / 1000); dbx.kvSet('patchPosted', pn.id); } }
// 사감 한마디: 기숙사 RP 채널에 (신입생 환영 · 주간 대항전 결과 · 대항전 선두가 바뀔 때). 채팅 시각은 다른 알림처럼 실제 시각
function headSay(house, text, extra) { const L = D.HOUSE_LORE[house]; if (L && text) chat.headSay(house, L.head, text, Date.now() / 1000, extra); }
function headWelcome(P) { const L = D.HOUSE_LORE[P.house]; if (L) headSay(P.house, L.say.welcome.replace('{n}', P.name), { w: 1 }); }   // w: 신입생 환영 (설정에서 이것만 숨길 수 있다)
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
  if (c && now - c.checked < 300) { visit(c.pid, req); return c.pid; }
  const s = dbx.q.getSession.get(key);
  if (!s || s.expires < now) { sessionCache.delete(key); return null; }
  if (s.expires - now < (cfg.sessionDays - 1) * 86400) dbx.q.touchSession.run(now + cfg.sessionDays * 86400, key);
  sessionCache.set(key, { pid: s.pid, checked: now });
  if (sessionCache.size > 20000) sessionCache.clear();
  visit(s.pid, req);
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
  R.advance(P, world.ctx(now), now); R.questCheck(P, now); questNotes(P);
  expRecallLeft(P, now);   // 귀환 투표가 통과했는데 남아 있던 함께 원정
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
  if (!v.active) {   // 쉬는 시간: 아직 마감되지 않은 가장 최근 방문이 있으면 그 창을 그대로 보여 준다 (연장 · 방문 일정 변경 등)
    const last = dbx.db.prepare('SELECT visit FROM auction WHERE done = 0 AND ends > ? ORDER BY id DESC LIMIT 1').get(Math.floor(now)); if (!last) return v;
    const pid = last.visit, pv = open(pid), all = dbx.q.aucByVisit.all(pid); if (!pv.length) return v;
    return { id: pid, start: Math.min.apply(null, all.map((r) => r.ends)) - R.AUCTION_LEN, end: Math.max.apply(null, pv.map((r) => r.ends)), active: true, extended: true };
  }
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
  pevent(id, 'join', code ? '초대코드 ' + code + (opInv ? ' (운영자)' : '') : '', req);
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
  store.markDirty(pid); board.forgetName(pid); log(`이름 변경: ${old} → ${name}`); pevent(pid, 'rename', old + ' → ' + name, req);
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
  if (!(await checkPass(pw, row.pass))) { pevent(row.id, 'loginfail', '아이디 찾기 · 비밀번호 불일치', req); return fail(req, res, 401, '학생 이름이나 비밀번호가 맞지 않습니다'); }
  if (row.banned) return fail(req, res, 403, '이용이 정지된 계정입니다');
  pevent(row.id, 'findid', nl ? '새 아이디 정함' : '아이디 확인', req);
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
  if (!(await checkPass(pw, row.pass))) { pevent(row.id, 'loginfail', '비밀번호 불일치', req); return fail(req, res, 401, '아이디나 비밀번호가 맞지 않습니다'); }
  if (row.banned) { pevent(row.id, 'loginfail', '정지 상태', req); return fail(req, res, 403, '이용이 정지된 계정입니다'); }
  if (needsRehash(row.pass)) dbx.q.setPass.run(await hashPass(pw), row.id);
  let pwTemp = false;
  try { const le = dbx.db.prepare('SELECT login_enc, pw_temp FROM players WHERE id = ?').get(row.id); pwTemp = !!(le && le.pw_temp); if (le && !le.login_enc) dbx.db.prepare('UPDATE players SET login_enc = ? WHERE id = ?').run(sec.enc(LOGIN_RE.test(login.toLowerCase()) ? login.toLowerCase() : login.trim()), row.id); } catch (e) { }   // 예전 학생은 로그인할 때 아이디를 기록 (이름이 아이디인 학생은 이름 그대로)
  const token = newSession(row.id), now = nowSec();
  pevent(row.id, 'login', pwTemp ? '임시 비밀번호' : '', req);
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
  pevent(pid, 'pw', '', req);
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
/* ───────── 과목 수석: 과목마다 레벨 → 그 레벨 안의 경험치 순 (5분 캐시) ───────── */
const subjRank = { at: 0, tops: {} };
function subjTops() {
  if (Date.now() - subjRank.at < 5 * 60000) return subjRank.tops;
  const tops = {};
  D.SUBJECTS.forEach((sj) => {
    const lp = '$.subj.' + sj.id + '.lv', xp = '$.subj.' + sj.id + '.xp';
    tops[sj.id] = dbx.db.prepare(`SELECT id, name, house, grade, CAST(json_extract(state, ?) AS INTEGER) AS lv, CAST(json_extract(state, ?) AS REAL) AS xp FROM players WHERE banned = 0 AND CAST(json_extract(state, ?) AS INTEGER) > 0 ORDER BY lv DESC, xp DESC, created ASC LIMIT 10`)
      .all(lp, xp, lp).map((r) => ({ id: r.id, name: r.name, house: r.house, grade: r.grade, lv: r.lv, xp: Math.floor(r.xp || 0) }));
  });
  subjRank.at = Date.now(); subjRank.tops = tops;
  return tops;
}
function subjHeads(id, n) { const t = subjTops(), out = []; for (const k in t) if (t[k][n || 0] && t[k][n || 0].id === id) out.push(k); return out; }   // 이 학생이 1위(n=0) · 2위(n=1)인 과목들
routes['GET /api/subjranks'] = (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('sr:' + pid, 2, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const P = store.get(pid), tops = subjTops(), mine = {};
  if (P && P.subj) for (const k in tops) {
    const sj = P.subj[k]; if (!sj || !(sj.lv > 0)) continue;
    const i = tops[k].findIndex((r) => r.id === pid);   // 10위 안이면 그대로, 밖이면 따로 센다
    if (i >= 0) { mine[k] = i + 1; continue; }
    const lp = '$.subj.' + k + '.lv', xp = '$.subj.' + k + '.xp';
    mine[k] = Number(dbx.db.prepare(`SELECT COUNT(*) + 1 AS r FROM players WHERE banned = 0 AND id != ? AND (CAST(json_extract(state, ?) AS INTEGER) > ? OR (CAST(json_extract(state, ?) AS INTEGER) = ? AND CAST(json_extract(state, ?) AS REAL) > ?))`).get(pid, lp, sj.lv, lp, sj.lv, xp, sj.xp || 0).r);
  }
  send(req, res, 200, { tops, mine });
};
routes['GET /api/myranks'] = (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('mr:' + pid, 2, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const now = nowSec(), P = loadPlayer(pid, now); if (!P) return fail(req, res, 401, '학생 정보를 찾을 수 없습니다');
  const ranks = world.myRanks(P, R.summary(P, world.W, now).power, now), party = partyOf.get(pid), tr = party && dbx.q.twRankGet.get(R.weekId(now), party);
  let twi = -1, twf = 0; if (tr) { const L = world.twRanked(R.weekId(now)); twi = L.findIndex((x) => x.parties.indexOf(party) >= 0); if (twi >= 0) twf = L[twi].f; }   // 같은 파티원 구성은 한 줄로 합친 순위
  ranks.twp = twi >= 0 ? twi + 1 : null; ranks.twpF = twf;   // 우리 파티의 이번 주 별의 탑 순위
  send(req, res, 200, { ranks });
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
  let leavePa = null;
  if (type === 'expCancel') { delete a.leave; const pa = expPartyOf(P, Number(a.slot) | 0, now); if (pa && pa.act.length > 1) { a.leave = 1; leavePa = pa; } }   // 함께 원정에서 혼자 먼저 귀환: 50%만 (서버가 정한다)
  if (type === 'expStart' && exprooms.inRoom(pid)) { const c0 = R.calc(P, world.ctx(now), now); let free = 0; for (let i = 0; i < c0.expSlots; i++) if (!P.exp[i]) free++; if (free <= 1) return send(req, res, 400, { error: '함께 원정 방에서 출발을 기다리는 중입니다. 혼자 출정하려면 먼저 방 나가기 필요', P: R.publicState(P), now }); }
  let r;
  try {
    const before = P.wk.dmg;
    setPartyN(P); setGuildLv(P);
    const W0 = world.ctx(now); W0.lecPeers = type === 'lecStart' || type === 'ttApply' ? lecCounts(now) : null;
    r = R.act(P, W0, now, type, a); W0.lecPeers = null; questNotes(P);
    if (type === 'lecStart' || type === 'lecCancel' || type === 'ttApply') { lecSync(P); if (type === 'lecStart' || type === 'ttApply') { const j = P.lec[type === 'ttApply' ? 0 : Number(a.slot)]; if (j) lecStarted(P, j.s, now); } }
    if (type === 'exam' && r && r.pass) {
      if (r.letter === 'S') {   // S등급 진급: 학년 소식을 돋보이게 + 공지 채팅 알림. 1 · 3 · 5 · 7번째 S면 받은 칭호도 함께
        const sn = P.st.sGrades || 0, tt = R.D.TITLES.find((t) => t.stat === 'sGrades' && t.n === sn), grad = P.grade >= 8;
        const tag = sn >= 7 ? '[전 학년 수석]' : grad ? '[수석 졸업]' : '[수석 진급]', head = r.grade + '학년 기말시험을 S등급(' + r.total + '점)으로 통과하고 ' + (grad ? '마스터 과정이 되었습니다' : P.grade + '학년으로 진급했습니다');
        world.addNews(tag + ' ' + P.name + ' 학생이 ' + head + '.' + (tt ? ' 칭호 ' + R.josa('「' + tt.name + '」', '을', '를') + ' 받았습니다.' : ''), now);
        chat.system('notice', tag + ' ' + P.name + ' · ' + (sn >= 7 ? '일곱 기말시험 모두 S등급' : grad ? '졸업 시험 S등급' : r.grade + '학년 S등급'), Date.now() / 1000);
      } else world.addNews(P.name + ' 학생이 ' + (P.grade >= 8 ? '졸업 시험을 통과해 마스터 과정이 되었습니다' : P.grade + '학년으로 진급했습니다'), now);
    }
    if ((type === 'clsExam' || type === 'setCls') && r) setImmediate(() => { try { chat.clsChanged(pid); } catch (e) { } });
    if (leavePa) expLeft(P, leavePa, now);
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
// 원정 · 파티 · 1:1 새 글: 지금 접속해 있지 않은 받는 사람에게 푸시 (그 종류를 켠 기기만, 같은 사람 · 같은 종류는 1분에 한 번)
const chatPushAt = new Map();
function chatPush(P, ch, ids) {
  const kind = R.CHAT_NOTIFY[ch]; if (!kind) return;
  const now = Date.now(), name = ch === 'dm' ? '1:1 채팅' : ch === 'party' ? '파티 채팅' : '원정 채팅';
  [...new Set(ids)].forEach((id) => {
    if (!id || id === P.id || chat.isOnline(id)) return;
    const k = id + ':' + kind; if (now - (chatPushAt.get(k) || 0) < 60000) return; chatPushAt.set(k, now);
    if (chatPushAt.size > 20000) chatPushAt.delete(chatPushAt.keys().next().value);
    try { push.direct(id, kind, '모네타 아카데미 · ' + name, P.name + ' 님의 새 메시지가 있습니다', 'chat-' + kind); } catch (e) { }
  });
}
function chatPeers(P, ch) {
  if (ch === 'party') { const pa = partyOf.get(P.id); return pa ? dbx.q.partyMembers.all(pa).map((r) => r.id) : []; }
  if (ch === 'exr') {
    const ps = exprooms.peers(P.id); if (ps) return ps;
    const ck = R.expChatKey(P), j = (P.exp || []).find((x) => x && x.pt && x.pt.ck === ck);
    return j && j.pt.with ? j.pt.with.map((w) => w.id).filter(Boolean) : [];
  }
  return [];
}
routes['POST /api/chat/send'] = async (req, res) => {
  const pid = authed(req); if (!pid) return fail(req, res, 401, '로그인이 필요합니다');
  const b = await readJson(req, 4096), P = store.get(pid), meta = dbx.q.playerMeta.get(pid);
  if (!P || !meta || meta.banned || P.needCreate) return fail(req, res, 403, '보낼 수 없습니다');
  try {
    const ch = String(b.ch || ''), now = Date.now() / 1000;
    if (ch === 'dm') { const m = chat.sendDm(P, meta, String(b.to || ''), b.text, now, b.nonce); if (!m.dup) chatPush(P, 'dm', [String(b.to || '')]); return send(req, res, 200, { ok: true, id: m.id, dup: !!m.dup }); }
    const m = chat.send(P, meta, ch, b.text, b.kind, now, b.nonce);
    if (m.dup) return send(req, res, 200, { ok: true, id: m.id, dup: true });
    if (ch === 'party' || ch === 'exr') try { chatPush(P, ch, chatPeers(P, ch)); } catch (e) { log('채팅 푸시 실패', e); }
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
  const th = chat.dmThreads(pid).map((t) => { if (t.peer === 'staff') return Object.assign(t, { name: '운영진', house: 'system', av: 0, online: false, friend: true, staff: true }); const p = dbx.q.getProfile.get(t.peer); return p ? Object.assign(t, { name: p.name, house: p.house, av: p.deleted ? 0 : p.avatar_v, online: !p.deleted && isOnline(t.peer), friend: friendState(pid, t.peer) === 'ok', deleted: p.deleted ? true : undefined }) : null; }).filter(Boolean);
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
// 공개 범위: 레벨·전투력(visLv) · 능력치(visStat) · 장비(visEq) · 휘장 상세(visBadge) — 전체 · 친구만 · 비공개
const VIS = new Set(['all', 'friend', 'none']);
const PROFILE_DEF = { status: '', bio: '', fav: '', avcredit: '', showStats: true, allowFriend: true, bioFriends: false };   // avcredit: 두상 그림 출처 (선택)
function profileOf(json) { let p = {}; try { p = JSON.parse(sec.dec(json) || '{}') || {}; } catch (e) { } const o = Object.assign({}, PROFILE_DEF, p); if (!VIS.has(o.visLv)) o.visLv = o.showStats ? 'all' : 'none'; if (!VIS.has(o.visStat)) o.visStat = 'none'; if (!VIS.has(o.visEq)) o.visEq = 'none'; if (!VIS.has(o.visFull)) o.visFull = 'none'; if (!VIS.has(o.visBadge)) o.visBadge = 'none'; return o; }
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
  { const hd = subjHeads(id), h2 = subjHeads(id, 1); if (hd.length) out.heads = hd; if (h2.length) out.seconds = h2; }   // 과목 수석 (순위표에 공개되는 정보라 공개 범위와 관계없이)
  if (can(pr.visFull)) { const DP = LP || store.get(id); if (DP) try { out.full = R.fullStats(DP, world.ctx(nowSec()), Math.min(nowSec(), DP.at)); } catch (e) { } }   // 전체 능력치 (기본은 나만 보기)
  if (can(pr.visBadge)) { const DP = LP || store.get(id), bw = DP && R.badgeWorn(DP); if (bw) out.badgeD = { gem: bw.gem, lv: bw.lv, name: bw.name, q: bw.q, aff: bw.aff || [] }; }   // 착용 휘장 상세 (장비 칸 옆에 표시)
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
  out.rels = dbx.q.relList.all(id).filter((r) => r.state === 'ok').map((r) => ({ id: r.id, name: r.name, house: r.house, av: r.avatar_v, mine: r.mine, theirs: r.theirs }));   // 관계 탭 (맺은 것만, 모두에게 공개)
  if (self) Object.assign(out, { showStats: pr.showStats, visLv: pr.visLv, visStat: pr.visStat, visEq: pr.visEq, visFull: pr.visFull, visBadge: pr.visBadge, allowFriend: pr.allowFriend, bioFriends: pr.bioFriends });
  else {
    out.friend = fs; out.allowFriend = pr.allowFriend;
    { const rp = dbx.q.relPair.get(me, id, id, me); if (rp) out.rel = { rid: rp.id, state: rp.state === 'ok' ? 'ok' : rp.a === me ? 'out' : 'in', mine: rp.a === me ? rp.la : rp.lb, theirs: rp.a === me ? rp.lb : rp.la }; }   // 나와 이 학생 사이
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
  ['visLv', 'visStat', 'visEq', 'visFull', 'visBadge'].forEach((k) => { if (VIS.has(b[k])) pr[k] = b[k]; });
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

/* ───────── 관계 ─────────
   한 학생이 상대와 자기의 이름표(예: 선배 / 후배)를 정해 신청하고, 상대가 수락하면 두 학생의 정보창 「관계」 탭에 보인다. 한 쌍에 하나 */
const REL_MAX = 30, REL_OUT_MAX = 10, REL_LABEL_MAX = 8;
const relView = (r) => ({ rid: r.rid, id: r.id, name: r.name, house: r.house, grade: r.grade, av: r.avatar_v, mine: r.mine, theirs: r.theirs, t: r.t });
function relLabel(v) { const s = cleanText(v, 40).replace(/\s+/g, ' '); if (!s) return { err: '관계 이름 입력 필요' }; if (s.length > REL_LABEL_MAX) return { err: '관계 이름은 ' + REL_LABEL_MAX + '자까지 가능' }; if (R.badName(s)) return { err: '사용할 수 없는 말이 들어 있습니다' }; return { s }; }
routes['GET /api/rels'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('rl:' + me, 1, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const all = dbx.q.relList.all(me);
  send(req, res, 200, { rels: all.filter((r) => r.state === 'ok').map(relView), inc: all.filter((r) => r.state === 'req' && !r.sent).map(relView), out: all.filter((r) => r.state === 'req' && r.sent).map(relView), max: REL_MAX });
};
routes['POST /api/rels'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('rel:' + me, 0.5, 10)) return fail(req, res, 429, '잠시 후 다시 시도');
  const b = await readJson(req, 1024), op = String(b.op || ''), t = Math.floor(Date.now() / 1000);
  if (op === 'req') {
    const id = String(b.id || ''), other = /^[A-Za-z0-9_-]{4,40}$/.test(id) && dbx.q.getProfile.get(id);
    if (!other || other.banned || other.deleted) return fail(req, res, 404, '학생을 찾을 수 없습니다');
    if (id === me) return fail(req, res, 400, '자기 자신과는 관계를 맺을 수 없습니다');
    const m = relLabel(b.mine), o = relLabel(b.theirs); if (m.err || o.err) return fail(req, res, 400, m.err || o.err);
    const ex = dbx.q.relPair.get(me, id, id, me);
    if (ex) return fail(req, res, 400, ex.state === 'ok' ? '이미 관계를 맺은 학생입니다 (내 정보 › 관계에서 끊은 뒤 다시 신청 가능)' : ex.a === me ? '이미 신청을 보냈습니다' : '이 학생이 보낸 신청이 있습니다 (내 정보 › 관계에서 수락 가능)');
    if (!profileOf(other.profile).allowFriend) return fail(req, res, 400, '이 학생은 신청을 받지 않습니다');
    if (Number(dbx.q.relCount.get(me, me).n) >= REL_MAX) return fail(req, res, 400, '관계는 ' + REL_MAX + '명까지입니다');
    if (Number(dbx.q.relOutCount.get(me).n) >= REL_OUT_MAX) return fail(req, res, 400, '수락을 기다리는 신청이 너무 많습니다');
    dbx.q.relInsert.run(me, id, m.s, o.s, t);
    addNote(id, 'rel', pname(me) + ' 님이 관계를 신청했습니다: ' + pname(me) + ' ' + m.s + ' · 나 ' + o.s, { me: 'rels' });
    return send(req, res, 200, { ok: true });
  }
  const r = dbx.q.relGet.get(Number(b.rid) || 0);
  if (!r || (r.a !== me && r.b !== me)) return fail(req, res, 404, '없는 관계입니다');
  const other = r.a === me ? r.b : r.a;
  if (op === 'accept') {
    if (r.state !== 'req' || r.b !== me) return fail(req, res, 400, '받은 신청이 없습니다');
    if (Number(dbx.q.relCount.get(me, me).n) >= REL_MAX) return fail(req, res, 400, '관계는 ' + REL_MAX + '명까지입니다');
    if (Number(dbx.q.relCount.get(other, other).n) >= REL_MAX) return fail(req, res, 400, '상대 학생의 관계가 가득 찼습니다');
    dbx.q.relAccept.run(t, r.id);
    addNote(other, 'rel', pname(me) + ' 님이 관계 신청을 수락했습니다: ' + r.la + ' · ' + r.lb, { me: 'rels' });
    return send(req, res, 200, { ok: true });
  }
  if (op === 'decline' || op === 'cancel' || op === 'remove') {
    if (op === 'decline' && (r.state !== 'req' || r.b !== me)) return fail(req, res, 400, '받은 신청이 없습니다');
    if (op === 'cancel' && (r.state !== 'req' || r.a !== me)) return fail(req, res, 400, '보낸 신청이 없습니다');
    if (op === 'remove' && r.state !== 'ok') return fail(req, res, 400, '맺은 관계가 아닙니다');
    dbx.q.relDel.run(r.id);
    return send(req, res, 200, { ok: true });
  }
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
function joinParty(pid, party) { dbx.q.partyJoin.run(pid, party, Math.floor(Date.now() / 1000)); partyOf.set(pid, party); partySize.set(party, (partySize.get(party) || 0) + 1); if (towerLobby.has(party)) twLobbyEval(party); }   // 새 파티원은 준비 전이라 별의 탑 출발 대기가 멈춘다
function leaveParty(pid) {
  const party = partyOf.get(pid); if (!party) return null;
  dbx.q.partyLeave.run(pid); partyOf.delete(pid);
  const lob = towerLobby.get(party); if (lob) { lob.ready.delete(pid); if (lob.timer) { clearTimeout(lob.timer); lob.timer = null; lob.at = null; } setTimeout(() => twLobbyEval(party), 0); }   // 별의 탑 출발 대기: 다시 판정
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
// 모집 탭: 모집 카드의 지금 상태 (올릴 때의 인원이 아니라). gone = 출정했거나 닫힘 · 없어짐, ended = 모집 시간(30분)이 지남, full = 인원 마감
routes['POST /api/recruit/status'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('recst:' + me, 1, 6)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const b = await readJson(req, 4096), ids = (k, n) => (Array.isArray(b[k]) ? b[k] : []).map(String).filter(Boolean).slice(0, n), real = Date.now() / 1000, out = { rooms: {}, parties: {}, guilds: {} };
  const st = (n, max) => ({ n, max, state: n >= max ? 'full' : 'open' });
  ids('rooms', 40).forEach((id) => { const s = exprooms.status(id); out.rooms[id] = s ? st(s.n, s.max) : { state: 'gone' }; });
  ids('parties', 40).forEach((id) => { if (!dbx.q.partyGet.get(id)) { out.parties[id] = { state: 'gone' }; return; } const v = st(partyCount(id), PARTY_MAX), at = partyRec.get(id); if (v.state === 'open' && (!at || real - at > 1800)) v.state = 'ended'; out.parties[id] = v; });
  ids('guilds', 20).forEach((id) => { const g = dbx.q.gGet.get(id); out.guilds[id] = g ? st(gCount(id), R.guildCap(g.lv || 1)) : { state: 'gone' }; });
  send(req, res, 200, out);
};
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
    chat.recruit(P, { type: 'party', party: mine, name: pa.name, n: partyCount(mine), max: PARTY_MAX, floor: towerFloor(mine, nowSec()), note: recNote(b.note) }, real);
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
  if (op === 'rename') {   // 파티 이름 바꾸기 (파티장만)
    const pa = mine && dbx.q.partyGet.get(mine); if (!pa || pa.leader !== me) return fail(req, res, 403, '파티장만 이름을 바꿀 수 있습니다');
    const name = String(b.name || '').replace(/\s+/g, ' ').trim();
    if (!PARTY_NAME_RE.test(name)) return fail(req, res, 400, '파티 이름은 한글·영문·숫자 2~12자만 가능');
    if (R.badName(name)) return fail(req, res, 400, '사용할 수 없는 단어가 포함된 이름입니다');
    if (name === pa.name) return send(req, res, 200, { ok: true, party: partyView(me) });
    dbx.q.partyRename.run(name, mine); chat.system('party', P.name + ' 님이 파티 이름을 「' + name + '」' + R.josa(name, '으로', '로').slice(name.length) + ' 바꾸었습니다.', now, mine); chat.partyChanged(me);
    return send(req, res, 200, { ok: true, party: partyView(me) });
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
/* 학생 경매: 장비 · 휘장을 시작가부터 입찰로 판다. 즉시 구매가로 언제든(입찰이 들어온 뒤에도) 바로 살 수 있다.
   입찰하면 아르크를 맡겨 두고, 더 높은 입찰이나 즉시 구매가 나오면 돌려준다. 마감 5분 안 입찰은 마감을 5분 미룬다.
   학생마다 동시에 3개까지(거래소 등록 한도 10개 안에서 센다). 입찰이 들어오기 전까지만 취소할 수 있다. */
const MK_AUC = { MAX: 3, HOURS: [12, 24, 48], MIN_UP: 0.05, BUYOUT_X: 1.2, SNIPE: 300 };
function mkAucMin(r) { return r.bids > 0 ? Math.max(r.bid + 1, Math.ceil(r.bid * (1 + MK_AUC.MIN_UP))) : r.start_price; }
// 맡겨 둔 입찰금을 돌려준다
function mkRefund(pid, amount, name, why) {
  if (!pid || String(pid).startsWith('npc:') || !(amount > 0)) return;
  const Q = store.get(pid); if (!Q) return;
  const now = nowSec(); R.advance(Q, world.ctx(now), now);
  Q.res.gold += amount; R.log(Q, now, '거래소 경매: ' + name + ' — ' + why + ' 맡겨 둔 ' + R.fmt(amount) + ' ' + CUR + '를 돌려받았습니다', 'news'); store.markDirty(pid);
  addNote(pid, 'market', '경매 ' + R.josa(name, '은', '는') + ' ' + why + ' 맡겨 둔 ' + R.fmt(amount) + ' ' + CUR + '를 돌려받았습니다', { view: 'market' });
  try { push.direct(pid, 'mkbid', '거래소 경매', name + ' — ' + why + ' 맡겨 둔 ' + R.fmt(amount) + ' ' + CUR + '를 돌려받았습니다. 다시 입찰할 수 있습니다.', 'mkbid-' + name); } catch (e) { }
}
// 팔린 값(수수료를 뺀 것)을 판매자에게
function mkPaySeller(r, price, buyerName, now, how) {
  if (String(r.seller).startsWith('npc:')) return;
  const SP = store.get(r.seller); if (!SP) return;
  const got = Math.floor(price * (1 - MK.FEE)), nm = r.name + (r.kind !== 'item' && r.kind !== 'badge' ? ' ' + r.qty + '개' : '');
  addNote(r.seller, 'market', '거래소에서 ' + R.josa(nm, '이', '가') + ' ' + (how || '팔렸습니다') + ' · ' + R.fmt(got) + ' ' + CUR + ' (' + buyerName + ' 님)', { view: 'market' });
  R.advance(SP, world.ctx(now), now); SP.res.gold += got; SP.st.goldTotal = (SP.st.goldTotal || 0) + got; SP.st.mkSold = (SP.st.mkSold || 0) + 1;   // 칭호 「거래소 큰손」
  R.log(SP, now, '거래소: ' + nm + ' 판매 +' + R.fmt(got) + ' ' + CUR + ' (수수료 ' + Math.round(MK.FEE * 100) + '%)', 'good'); store.markDirty(r.seller);
}
// 마감된 경매 정리: 입찰이 있으면 최고 입찰자에게 넘기고(맡겨 둔 아르크로 값을 치른다), 없으면 판매자에게 돌려준다
function mkAucSettle(r, now) {
  const real = Math.floor(Date.now() / 1000), W = r.bidder ? store.get(r.bidder) : null;
  if (!W) { if (dbx.q.mkSetStatus.run('expired', '', real, r.id).changes) mkReturn(r, r.bidder ? '낙찰자를 찾을 수 없어 돌아왔습니다' : '입찰 없이 경매가 끝나 돌아왔습니다', now); return; }
  if (!dbx.q.mkAucSold.run(r.bidder, real, r.bid, r.id).changes) return;
  R.advance(W, world.ctx(now), now); mkGive(W, r); W.st.aucWon = (W.st.aucWon || 0) + 1;   // 칭호 「경매의 승자」
  R.log(W, now, '거래소 경매: ' + R.josa(r.name, '을', '를') + ' ' + R.fmt(r.bid) + ' ' + CUR + '에 낙찰받았습니다', 'good'); store.markDirty(r.bidder);
  addNote(r.bidder, 'market', '경매에서 ' + R.josa(r.name, '을', '를') + ' ' + R.fmt(r.bid) + ' ' + CUR + '에 낙찰받았습니다', { view: 'market' });
  try { push.direct(r.bidder, 'mkwon', '거래소 경매', R.josa(r.name, '을', '를') + ' ' + R.fmt(r.bid) + ' ' + CUR + '에 낙찰받았습니다.', 'mkwon-' + r.id); } catch (e) { }
  mkPaySeller(r, r.bid, W.name, now, '경매로 팔렸습니다');
  log(`경매 낙찰: #${r.id} ${r.name} ${r.bid}G`);
  chat.pingAll('trade', mkTradeOut(Object.assign({}, r, { price: r.bid, done_at: real }))); mkChanged();
}
function mkAucSweep() { const now = nowSec(); dbx.q.mkAucEnded.all(Math.floor(Date.now() / 1000)).forEach((r) => mkAucSettle(r, now)); }
const mkQueries = new Map();
function mkSearch(f, now) {
  const where = [`m.status = 'open'`, `m.expires > ?`], args = [Math.floor(now)];
  if (f.auc) { where.push(`m.auc = 1`, `m.kind IN ('item', 'badge')`); if (f.nobid) where.push('m.bids = 0'); } else where.push('m.auc = 0');   // 경매는 「경매」 탭에서만
  if (f.kind === 'item' || f.kind === 'mat' || f.kind === 'pot' || f.kind === 'badge' || f.kind === 'tok') { where.push('m.kind = ?'); args.push(f.kind); }
  if (f.kind === 'badge' && f.gem && R.GEM[f.gem]) { where.push('m.slot = ?'); args.push(f.gem); }
  if (f.kind !== 'badge' && f.slot === 'sword') { where.push(`m.slot = 'staff' AND m.data LIKE '%"wk":"sword"%'`); }   // 무기 중 검
  else if (f.kind !== 'badge' && f.slot === 'staff') { where.push(`m.slot = 'staff' AND m.data NOT LIKE '%"wk":"sword"%'`); }   // 무기 중 지팡이
  else if (f.kind !== 'badge' && f.slot === 'manual') { where.push(`m.slot = 'tome' AND m.data LIKE '%"wk":"manual"%'`); }   // 마도서 칸 중 전술서
  else if (f.kind !== 'badge' && f.slot === 'helm') { where.push(`m.slot = 'hat' AND m.data LIKE '%"wk":"helm"%'`); }   // 모자 칸 중 투구
  else if (f.kind !== 'badge' && f.slot === 'hat') { where.push(`m.slot = 'hat' AND m.data NOT LIKE '%"wk":"helm"%'`); }   // 모자 칸 중 모자
  else if (f.kind !== 'badge' && f.slot === 'tome') { where.push(`m.slot = 'tome' AND m.data NOT LIKE '%"wk":"manual"%'`); }   // 마도서 칸 중 마도서
  else if (f.kind !== 'badge' && f.slot && R.SLOT[f.slot]) { where.push('m.slot = ?'); args.push(f.slot); }
  if (f.r >= 0 && f.r <= 4) { where.push('m.rarity = ?'); args.push(f.r); }
  (f.aff || []).forEach((id) => { where.push('m.data LIKE ?'); args.push('%"id":"' + id + '"%'); });   // 부옵션 검색 (고른 옵션을 모두 가진 장비 · 휘장)
  if (f.wear > 0) { where.push(`(m.kind <> 'item' OR m.ilvl <= ?)`); args.push(f.wear); }   // 착용 가능만: 장비는 내 레벨 이하만 (휘장 · 재료 등은 레벨 제한이 없어 그대로)
  if (f.mat && MAT_NAMES[f.mat]) { where.push('m.data = ?'); args.push(f.mat); }
  if (f.pot && R.POT[f.pot]) { where.push('m.data = ?'); args.push(f.pot); }
  if (f.kind === 'tok' && f.tok && MK_TOK[f.tok]) { where.push('m.data = ?'); args.push(f.tok); }
  if (f.q) { where.push(`m.name LIKE ? ESCAPE '\\'`); args.push('%' + f.q.replace(/[\\%_]/g, (c) => '\\' + c) + '%'); }
  const dir = f.sort === 'high' ? 'DESC' : 'ASC';
  const cur = '(CASE WHEN m.bids > 0 THEN m.bid ELSE m.start_price END)';
  const order = f.auc ? ({ cur: cur + ' ASC', curhi: cur + ' DESC', buy: 'm.price ASC', buyhi: 'm.price DESC', new: 'm.id DESC', bids: 'm.bids DESC, m.expires ASC' }[f.sort] || 'm.expires ASC')   // 경매 기본: 마감 임박순
    : f.sort === 'new' ? 'm.id DESC' : f.sort === 'lvl' ? 'm.ilvl DESC, m.price ASC' : f.kind === 'mat' || f.kind === 'pot' || f.kind === 'tok' ? 'm.price / m.qty ' + dir : 'm.price ' + dir;
  const sql = `SELECT m.id, m.kind, m.data, m.name, m.slot, m.rarity, m.ilvl, m.qty, m.price, m.created, m.expires, m.seller, m.auc, m.start_price, m.bid, m.bids, m.bidder, COALESCE(p.name, m.seller_name) AS seller_name FROM market m LEFT JOIN players p ON p.id = m.seller WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 60`;
  let st = mkQueries.get(sql); if (!st) { st = dbx.db.prepare(sql); mkQueries.set(sql, st); }
  if (f.sort !== 'pow' || !f.powP) return st.all(...args);
  // 전투력 상승순: 찾는 학생의 지금 장비 대신 끼었을 때 전투력이 얼마나 오르는지 (장비만 · 넉넉히 꺼내 계산한 뒤 60개)
  const P = f.powP, t = nowSec(), ctx = world.ctx(t), base = R.calc(P, ctx, t).power;
  const rows = (mkQueries.get(sql + '#pow') || (mkQueries.set(sql + '#pow', dbx.db.prepare(sql.replace(/LIMIT 60$/, 'LIMIT 600'))), mkQueries.get(sql + '#pow'))).all(...args);
  rows.forEach((r) => { r._dp = null; if (r.kind !== 'item') return; try { r._dp = Math.round(R.powerWith(P, JSON.parse(r.data), ctx, t) - base); } catch (e) { } });
  return rows.sort((a, b) => (b._dp == null ? -1e18 : b._dp) - (a._dp == null ? -1e18 : a._dp) || a.price - b.price).slice(0, 60);
}
function mkOut(r, me) {
  const o = { id: r.id, kind: r.kind, name: r.name, slot: r.slot, r: r.rarity, ilvl: r.ilvl, qty: r.qty, price: r.price, created: r.created, expires: r.expires, seller: r.seller_name, npc: String(r.seller).startsWith('npc:'), mine: r.seller === me, status: r.status };
  if (r._dp != null) o.dp = r._dp;   // 전투력 상승순: 장착 시 전투력 변화
  if (r.auc) { o.auc = 1; o.start = r.start_price; o.bid = r.bid; o.bids = r.bids; o.top = !!me && r.bidder === me; o.min = mkAucMin(r); o.won = r.status === 'sold' && r.buyer === me; }   // 입찰한 학생 이름은 보이지 않는다
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
  const f = { kind: g('kind'), slot: g('slot'), r: g('r') === '' ? -1 : Number(g('r')), mat: g('mat'), pot: g('pot'), tok: g('tok'), gem: g('gem'), q: g('q').slice(0, 20), aff: g('aff').split(',').filter((x, i, a) => R.AFF[x] && a.indexOf(x) === i).slice(0, 3), sort: g('sort'), auc: g('auc') === '1', nobid: g('nobid') === '1', wear: 0 };
  if (g('wear') === '1') { const P = store.get(me); f.wear = Math.max(1, (P && P.lvl) || 1); }   // 레벨은 서버가 아는 값으로
  if (f.sort === 'pow') { if (limited('mkpow:' + me, 0.5, 4)) return fail(req, res, 429, '잠시 후 다시 시도'); f.powP = loadPlayer(me, nowSec()); }   // 전투력 상승순은 계산이 많아 조금 더 아껴 쓴다
  send(req, res, 200, { list: mkSearch(f, now).map((r) => mkOut(r, me)), mine: dbx.q.mkMine.all(me, Math.floor(now) - 3 * 86400).map((r) => mkOut(Object.assign({ seller_name: '' }, r, { seller: me }), me)), myBids: dbx.q.mkMyBids.all(me).map((r) => mkOut(r, me)),
    openN: Number(dbx.q.mkMineOpen.get(me).n), fee: MK.FEE, days: MK.DAYS, maxOpen: MK.MAX_OPEN, grade: MK.GRADE, auc: { max: MK_AUC.MAX, hours: MK_AUC.HOURS, up: MK_AUC.MIN_UP, buyoutX: MK_AUC.BUYOUT_X } });
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
  if (rows.length) { const unit = rows.map((r) => r.price / Math.max(1, r.qty)).sort((a, b) => a - b), mid = unit.length >> 1; v = { avg: Math.round(unit.length % 2 ? unit[mid] : (unit[mid - 1] + unit[mid]) / 2),   // 시세 = 중간값 (헐값 · 바가지 한두 건에 흔들리지 않게)
     n: rows.length, recent: rows.slice(0, 5).map((r) => ({ t: r.done_at, price: r.price, qty: r.qty, ilvl: r.ilvl || 0, name: r.name })) }; }
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
const mkWk = (data) => { try { return JSON.parse(data).wk || undefined; } catch (e) { return undefined; } };   // 검 · 전술서 표기 (칸 이름만으로는 지팡이 · 마도서로 보였다)
routes['GET /api/market/history'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('mkh:' + me, 1, 6)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const since = Math.floor(Date.now() / 1000) - 30 * 86400;
  send(req, res, 200, { fee: MK.FEE, list: dbx.q.mkHistory.all(me, me, since).map((r) => ({ id: r.id, side: r.seller === me ? 'sell' : 'buy', kind: r.kind, name: r.name, slot: r.slot, wk: r.kind === 'item' ? mkWk(r.data) : undefined, r: r.rarity, ilvl: r.ilvl, qty: r.qty, price: r.price, got: r.seller === me ? Math.floor(r.price * (1 - MK.FEE)) : 0, t: r.done_at, seller: r.seller === me ? '' : r.seller_name, npc: String(r.seller).startsWith('npc:') })) });
};
routes['GET /api/market/trades'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('mktr:' + me, 1, 6)) return fail(req, res, 429, '요청이 너무 잦습니다');
  send(req, res, 200, { trades: dbx.q.mkTrades.all(50).map(mkTradeOut) });
};
// 거래소 목록이 바뀌면(올리기 · 사기 · 내리기 · 값 바꾸기 · 입찰) 보고 있는 학생 화면에 알린다 (1.5초 안의 변화는 한 번으로 묶음)
let mkPingT = null;
function mkChanged() { if (mkPingT) return; mkPingT = setTimeout(() => { mkPingT = null; chat.pingAll('mk', {}); }, 1500); mkPingT.unref(); }
routes['POST /api/market'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (store.isBanned(me)) return fail(req, res, 403, '이용이 정지된 계정입니다');
  if (limited('mkp:' + me, 1, 10)) return fail(req, res, 429, '잠시 후 다시 시도');
  const b = await readJson(req, 2048), op = String(b.op || ''), now = nowSec(), meta = dbx.q.playerMeta.get(me);
  const P = loadPlayer(me, now); if (!P) return fail(req, res, 401, '학생 정보를 찾을 수 없습니다');
  const no = mkAllowed(P, meta, op === 'list' || op === 'bid'); if (no) return fail(req, res, 403, no);
  const real = Date.now() / 1000;
  if (op === 'list') {
    { const on = Number(dbx.q.mkMineOpen.get(me).n); if (on >= MK.MAX_OPEN) return fail(req, res, 400, '한 번에 ' + MK.MAX_OPEN + '개까지 올릴 수 있습니다 (지금 판매 · 경매 중 ' + on + '개)'); }
    const price = Math.floor(Number(b.price)); if (!isFinite(price) || price < 1 || price > MK.MAX_PRICE) return fail(req, res, 400, '가격 확인 필요');
    // 경매: 장비 · 휘장만. price = 즉시 구매가, start = 시작가(상점 판매가 이상), 즉시 구매가는 시작가의 1.2배 이상
    const auc = !!b.auc, start = Math.floor(Number(b.start)), hours = Number(b.hours);
    if (auc) {
      if (!b.u && !b.badge) return fail(req, res, 400, '경매에는 장비와 휘장만 올릴 수 있습니다');
      if (Number(dbx.q.mkAucMineOpen.get(me).n) >= MK_AUC.MAX) return fail(req, res, 400, '경매는 한 번에 ' + MK_AUC.MAX + '개까지 열 수 있습니다');
      if (MK_AUC.HOURS.indexOf(hours) < 0) return fail(req, res, 400, '경매 기간 선택 필요');
      if (!isFinite(start) || start < 1) return fail(req, res, 400, '시작가 확인 필요');
      if (price < Math.ceil(start * MK_AUC.BUYOUT_X)) return fail(req, res, 400, '즉시 구매가는 시작가의 ' + MK_AUC.BUYOUT_X + '배(' + R.fmt(Math.ceil(start * MK_AUC.BUYOUT_X)) + ' ' + CUR + ') 이상이어야 합니다');
    }
    let row;
    if (b.u) {
      const i = P.inv.findIndex((it) => it.u === String(b.u)); if (i < 0) return fail(req, res, 400, '가방에 없는 장비입니다 (장착 중인 장비는 해제한 뒤 올리세요)');
      const it = P.inv[i]; if (it.lock) return fail(req, res, 400, '잠금한 장비는 올릴 수 없습니다');
      if (auc && start < R.sellPrice(it)) return fail(req, res, 400, '시작가는 상점 판매가(' + R.fmt(R.sellPrice(it)) + ' ' + CUR + ') 이상이어야 합니다');
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
    const ins = dbx.q.mkInsert.run(me, row[0], row[1], row[2], row[3], row[4], row[5], row[6], price, Math.floor(real), Math.floor(real + (auc ? hours * 3600 : MK.DAYS * 86400)), P.name);
    if (auc) dbx.q.mkAucInit.run(start, Number(ins.lastInsertRowid));
    if (auc) R.log(P, now, '거래소 경매에 ' + R.josa(row[2], '을', '를') + ' 올렸습니다 (시작가 ' + R.fmt(start) + ' · 즉시 구매가 ' + R.fmt(price) + ' ' + CUR + ' · ' + hours + '시간)', 'news');
    else R.log(P, now, '거래소에 ' + R.josa(row[2] + (row[0] !== 'item' ? ' ' + row[6] + '개' : ''), '을', '를') + ' ' + R.fmt(price) + ' ' + CUR + '에 올렸습니다', 'news');
    store.markDirty(me);
    mkChanged(); return send(req, res, 200, { ok: true, P: R.publicState(P), now });
  }
  const id = Number(b.id) | 0, r = id && dbx.q.mkGet.get(id);
  if (!r || r.status !== 'open') return fail(req, res, 404, '이미 팔렸거나 내려간 물건입니다');
  if (op === 'cancel') {
    if (r.seller !== me) return fail(req, res, 403, '내 물건이 아닙니다');
    if (r.auc && r.bids > 0) return fail(req, res, 400, '입찰이 들어온 경매는 취소할 수 없습니다');
    if (r.kind === 'item' && P.inv.length >= R.calc(P, world.ctx(now), now).bag) return fail(req, res, 400, '가방이 가득 찼습니다');
    if (!dbx.q.mkSetStatus.run('canceled', '', Math.floor(real), id).changes) return fail(req, res, 409, '이미 처리된 물건입니다');
    mkReturn(r, '판매를 취소해 돌려받았습니다', now);
    mkChanged(); return send(req, res, 200, { ok: true, P: R.publicState(P), now });
  }
  if (op === 'buy') {
    if (r.seller === me) return fail(req, res, 400, '내가 올린 물건입니다');
    if (r.expires <= real) return fail(req, res, 404, '기한이 지난 물건입니다');
    const held = r.auc && r.bidder === me ? r.bid : 0;   // 내가 최고 입찰자면 맡겨 둔 입찰금도 값에 넣는다
    if (P.res.gold + held < r.price) return fail(req, res, 400, CUR + '가 부족합니다');
    if (r.kind === 'item' && P.inv.length >= R.calc(P, world.ctx(now), now).bag) return fail(req, res, 400, '가방이 가득 찼습니다');
    if (r.kind === 'badge' && (P.badges || []).length >= R.BADGE_HOLD) return fail(req, res, 400, '휘장 보관함이 가득 찼습니다 (' + R.BADGE_HOLD + '개)');
    if (!(r.auc ? dbx.q.mkAucSold.run(me, Math.floor(real), r.price, id) : dbx.q.mkSetStatus.run('sold', me, Math.floor(real), id)).changes) return fail(req, res, 409, '방금 다른 학생이 샀습니다');
    P.res.gold -= r.price - held;
    if (r.auc && r.bidder && r.bidder !== me) mkRefund(r.bidder, r.bid, r.name, '즉시 구매로 경매가 끝나');
    mkGive(P, r); if (r.auc) P.st.aucWon = (P.st.aucWon || 0) + 1;   // 경매 즉시 구매도 낙찰로 센다
    R.log(P, now, '거래소에서 ' + R.josa(r.name + (r.kind !== 'item' ? ' ' + r.qty + '개' : ''), '을', '를') + ' ' + R.fmt(r.price) + ' ' + CUR + '에 샀습니다', 'good');
    store.markDirty(me);
    if (String(r.seller).startsWith('npc:')) setImmediate(() => { try { npcMarketTick(); } catch (e) { } });   // NPC 매물이 팔리면 바로 채운다
    mkPaySeller(r, r.price, P.name, now, r.auc ? '즉시 구매로 팔렸습니다' : '팔렸습니다');
    log(`거래: #${id} ${r.name} ${r.price}G`);
    chat.pingAll('trade', mkTradeOut(Object.assign({}, r, { done_at: Math.floor(real) })));
    mkChanged(); return send(req, res, 200, { ok: true, P: R.publicState(P), now });
  }
  // 가격 수정: 판매 중인 고정가 물건만 (경매는 시작가 · 즉시 구매가를 바꿀 수 없다). 기한은 그대로
  if (op === 'reprice') {
    if (r.seller !== me) return fail(req, res, 403, '내 물건이 아닙니다');
    if (r.auc) return fail(req, res, 400, '경매는 가격을 수정할 수 없습니다');
    const price = Math.floor(Number(b.price)); if (!isFinite(price) || price < 1 || price > MK.MAX_PRICE) return fail(req, res, 400, '가격 확인 필요');
    if (price === r.price) return fail(req, res, 400, '지금과 같은 가격입니다');
    if (!dbx.q.mkReprice.run(price, id, me).changes) return fail(req, res, 409, '이미 팔렸거나 내려간 물건입니다');
    R.log(P, now, '거래소: ' + r.name + (r.kind !== 'item' && r.kind !== 'badge' ? ' ' + r.qty + '개' : '') + ' 가격을 ' + R.fmt(r.price) + ' → ' + R.fmt(price) + ' ' + CUR + '로 수정했습니다', 'news'); store.markDirty(me);
    mkChanged(); return send(req, res, 200, { ok: true, P: R.publicState(P), now });
  }
  if (op === 'bid') {
    if (!r.auc) return fail(req, res, 400, '경매 물건이 아닙니다');
    if (r.seller === me) return fail(req, res, 400, '내가 올린 경매에는 입찰할 수 없습니다');
    if (r.expires <= real) return fail(req, res, 404, '마감된 경매입니다');
    if (r.bidder === me) return fail(req, res, 400, '이미 최고 입찰자입니다');
    const amount = Math.floor(Number(b.amount)), min = mkAucMin(r);
    if (!isFinite(amount) || amount < min) return fail(req, res, 400, '최소 입찰가는 ' + R.fmt(min) + ' ' + CUR + '입니다');
    if (amount >= r.price) return fail(req, res, 400, '즉시 구매가(' + R.fmt(r.price) + ' ' + CUR + ') 이상은 즉시 구매로 진행 필요');
    if (P.res.gold < amount) return fail(req, res, 400, CUR + '가 부족합니다');
    const ends = r.expires - real < MK_AUC.SNIPE ? Math.floor(real + MK_AUC.SNIPE) : r.expires;   // 마감 5분 안 입찰은 마감을 5분 미룬다
    if (!dbx.q.mkAucBid.run(amount, me, P.name, ends, id, r.bid, r.bidder).changes) return fail(req, res, 409, '방금 다른 입찰이 들어왔습니다. 다시 확인 필요');
    P.res.gold -= amount; dbx.q.mkBidLog.run(id, me, amount, Math.floor(real));
    R.log(P, now, '거래소 경매: ' + R.josa(r.name, '에', '에') + ' ' + R.fmt(amount) + ' ' + CUR + '를 입찰했습니다 (맡겨 둠)', 'news'); store.markDirty(me);
    if (r.bidder) mkRefund(r.bidder, r.bid, r.name, '더 높은 입찰이 들어와');
    mkChanged(); return send(req, res, 200, { ok: true, P: R.publicState(P), now, ends });
  }
  fail(req, res, 400, '알 수 없는 요청입니다');
};
function mkSweep() {
  const real = Date.now() / 1000, now = nowSec();
  dbx.q.mkExpired.all(Math.floor(real)).forEach((r) => { if (r.auc) return mkAucSettle(r, now); if (dbx.q.mkSetStatus.run('expired', '', Math.floor(real), r.id).changes) mkReturn(r, '판매 기한(' + MK.DAYS + '일)이 지나 돌아왔습니다', now); });
  dbx.q.mkPurge.run(Math.floor(real) - 14 * 86400); dbx.q.mkBidPurge.run();
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
   파티가 함께 실시간으로 오른다 (규칙은 shared/rules.js 「별의 탑」). 실전은 파티 단위 하루 1번, 연습은 언제나(파티 연습 · 혼자 연습).
   파티 실행(실전 · 파티 연습)은 tower 표의 log에 { runs: [...] }로 남기고, 파티원 모두가 같은 시각에 같은 장면을 본다(실제 시간 기준).
   실전 결과(기록 · 보상 우편)는 누른 순간 정하고, 알림은 대본이 끝난 뒤에 보낸다. */
const TW_RUNS = 4;   // 파티마다 남겨 두는 최근 실행
function towerRuns(party) { const row = dbx.q.towerGet.get(party); if (!row) return []; try { const x = JSON.parse(row.log); return Array.isArray(x.runs) ? x.runs : []; } catch (e) { return []; } }
function towerLive(runs) { const real = Date.now() / 1000, r = runs[runs.length - 1]; return r && r.t0 + r.d > real ? r : null; }
function towerSave(party, runs) { if (runs.length > TW_RUNS) runs.splice(0, runs.length - TW_RUNS); dbx.q.towerPut.run(party, R.weekId(nowSec()), 0, JSON.stringify({ runs })); }
// 파티원 전투 정보: 사람 파티원은 각자 정한 포지션, 동행 친구는 시작한 학생 힘의 30%
function towerTeam(party, me, now) {
  const pa = dbx.q.partyGet.get(party), ctx = world.ctx(now), ms = [], ps = [];
  dbx.q.partyMembers.all(party).forEach((m) => { const Q = m.id === me ? loadPlayer(me, now) : store.get(m.id); if (!Q) return; ps.push(Q); ms.push(R.twMember(Q, ctx, now)); });
  const base = ms.find((m) => m.id === me) || ms[0];
  const np = dbx.kvGet('twnp:' + party, {});   // 동행 친구 포지션 (파티마다, 파티원 누구나 바꿀 수 있다)
  if (base) partyNpcs(pa).forEach((k) => { const n = NPCS[k]; ms.push(R.twNpc(base, 'npc:' + k, n.name, n.house, np[k])); });
  return { pa, ms, ps };
}
function towerView(me, now) {
  const party = partyOf.get(me); if (!party) { const Q = store.get(me); return { party: null, pend: twPendView(Q) }; }
  const { pa, ms, ps } = towerTeam(party, me, now), runs = towerRuns(party), live = towerLive(runs), P = ps.find((Q) => Q.id === me);
  // 실전이 흐르는 동안은 그 실전 전의 기록을 보여 준다 (결과가 대본보다 먼저 새지 않게)
  const prev = live && live.kind === 'real' ? live.prev || {} : {};
  const best = (Q) => (Q.id in prev ? prev[Q.id] : R.twBest(Q, now)), used = ps.filter((Q) => R.twUsed(Q, now));
  const lob = twLobbyOf(party);
  return { party, name: pa ? pa.name : '', leader: pa ? pa.leader : '', week: R.weekId(now), weekEnd: R.weekStart(R.weekId(now) + 1), now: Date.now() / 1000,
    start: R.twStart(ps.map(best)), used: used.map((Q) => Q.name), myUsed: !!P && R.twUsed(P, now), myBest: P ? best(P) : 0, myPos: P ? R.twPos(P) : 'van', posOk: P ? R.expPositions(P) : ['van'],
    members: R.twMeta(ms).map((m) => { const Q = ps.find((x) => x.id === m.id); return Object.assign(m, { me: m.id === me, best: Q ? best(Q) : null, used: !!Q && R.twUsed(Q, now), ready: m.npc || (!!lob && lob.ready.has(m.id)) }); }),
    pend: twPendView(P),
    lobby: lob ? { mode: lob.mode, by: lob.byName, at: lob.at, notReady: ps.filter((Q) => !lob.ready.has(Q.id)).map((Q) => Q.name) } : null, count: TW_COUNT,
    runs: runs.slice().reverse() };
}
// 모집 카드에 보이는 층: 파티원 이번 주 기록 중 가장 낮은 층
function towerFloor(party, now) { const bs = dbx.q.partyMembers.all(party).map((m) => store.get(m.id)).filter(Boolean).map((Q) => R.twBest(Q, now)); return bs.length ? Math.min.apply(null, bs) : 0; }
function towerPing(party, data) { dbx.q.partyMembers.all(party).forEach((m) => chat.ping(m.id, 'tower', data)); }
const towerBusy = new Set(), towerSolo = new Map();   // 혼자 연습: 학생 → 마지막으로 돌린 실제 시각
routes['GET /api/tower'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('twg:' + me, 1, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');
  // have: 화면이 이미 대본을 들고 있는 실행 (그 실행은 대본을 빼고 보낸다)
  const have = (new URL(req.url, 'http://x').searchParams.get('have') || '').split(',').filter(Boolean), v = towerView(me, nowSec());
  if (v.runs) v.runs = v.runs.map((r) => (have.indexOf(r.id) >= 0 && r.floors ? Object.assign({}, r, { floors: undefined, held: true }) : r));
  send(req, res, 200, v);
};
// mode: real(실전) · party(파티 연습) · solo(혼자 연습) · stop(파티 연습 중단) · pos(내 포지션)
// 끝난 실전의 대기 순위를 정식 기록으로 (실전이 끝날 때 · 1분마다 · 서버를 켤 때)
function twRankSettle() { try { if (dbx.q.twRankSettle.run(Math.floor(Date.now() / 1000)).changes) world.invalidate(); } catch (e) { log('별의 탑 순위 정리 실패', e); } }
setInterval(twRankSettle, 60000).unref(); setTimeout(twRankSettle, 1000).unref();
// 별의 탑 실전 보상 맡겨 두기: P.twPend = { id, end(실제 시각), from, to, pname }. 끝난 뒤 「보상 받기」로 우편 발송
function twPendMail(Q) {
  const p = Q.twPend; if (!p) return; delete Q.twPend;
  for (let f = p.from; f <= p.to; f++) if (R.twTrial(f)) Q.st.bosses = (Q.st.bosses || 0) + 1;   // 시련의 층(보스층)은 보스 처치로 센다
  sendMail(Q.id, '별의 탑', '별의 탑 ' + p.to + '층 기록', '파티 「' + p.pname + '」의 실전에서 별의 탑 ' + p.to + '층까지 올랐습니다.\n이번 주에 처음 넘은 ' + p.from + '~' + p.to + '층의 보상입니다.', R.twRewardSum(p.from, p.to), Math.floor(Date.now() / 1000) + 7 * 86400, true);
  store.markDirty(Q.id);
}
// 화면에 보이는 보상 대기: 끝나기 전에는 층 · 보상을 숨긴다
function twPendView(Q) { const p = Q && Q.twPend; if (!p) return null; return Date.now() / 1000 >= p.end - 1 ? { id: p.id, end: p.end, from: p.from, to: p.to, reward: R.rewardText(R.twRewardSum(p.from, p.to)) } : { id: p.id, end: p.end }; }
// 받지 않은 채 다음 실전을 시작하면, 끝난 지난 보상은 먼저 보낸다
function twPendFlush(Q) { if (Q.twPend && Date.now() / 1000 >= Q.twPend.end) twPendMail(Q); }
// 출발 대기: 파티 → { mode(real · party), by, byName, ready: Map(학생 → 누른 실제 시각), at(출발 예정 실제 시각), timer }
// 누군가 「실전 준비」 · 「파티 연습 준비」를 누르면 출발 종류가 정해지고, 사람 파티원(NPC 제외)이 모두 「준비 완료」하면 15초 뒤 자동으로 출발한다.
// 그 사이 한 명이라도 준비를 풀면 출발이 취소되고, 다시 모두 준비하면 15초부터 다시 센다. 준비는 직접 취소하기 전까지 유지된다.
const towerLobby = new Map(), TW_COUNT = 15;
function twLobbyOf(party) {
  return towerLobby.get(party) || null;
}
function twLobbyEval(party) {
  const L = twLobbyOf(party); if (!L) return;
  const ids = dbx.q.partyMembers.all(party).map((m) => m.id), kind = L.mode === 'real' ? '실전' : '파티 연습';
  if (!ids.length) { if (L.timer) clearTimeout(L.timer); towerLobby.delete(party); return; }   // 파티가 없어졌다
  const all = !!L.mode && ids.length > 0 && ids.every((id) => L.ready.has(id)) && !towerLive(towerRuns(party));
  if (all && !L.timer) {
    L.at = Date.now() / 1000 + TW_COUNT; L.timer = setTimeout(() => twLobbyFire(party), TW_COUNT * 1000); L.timer.unref();
    chat.system('party', '모든 파티원이 준비를 마쳤습니다. ' + TW_COUNT + '초 뒤 별의 탑 ' + kind + '을 시작합니다.', Date.now() / 1000, party); towerPing(party, { lobby: true });
  } else if (!all && L.timer) {
    clearTimeout(L.timer); L.timer = null; L.at = null;
    chat.system('party', '준비가 풀려 별의 탑 ' + kind + ' 출발이 취소되었습니다. 모두 다시 준비하면 ' + TW_COUNT + '초 뒤 출발합니다.', Date.now() / 1000, party); towerPing(party, { lobby: true });
  }
}
function twLobbyFire(party) {
  const L = towerLobby.get(party); if (!L) return; L.timer = null; L.at = null;
  const ids = dbx.q.partyMembers.all(party).map((m) => m.id);
  if (!ids.every((id) => L.ready.has(id))) { twLobbyEval(party); towerPing(party, { lobby: true }); return; }   // 그 사이 파티원이 바뀌었다
  const starter = ids.indexOf(L.by) >= 0 ? L.by : ids[0], r = twStartRun(party, L.mode, starter);
  if (r.error) { L.ready.clear(); chat.system('party', '별의 탑을 시작할 수 없습니다: ' + r.error, Date.now() / 1000, party); towerPing(party, { lobby: true }); return; }
  towerLobby.delete(party);
}
// 실전 · 파티 연습 시작 (출발 대기의 15초가 끝났을 때). 실패하면 { error }
function twStartRun(party, mode, starterId) {
  if (towerBusy.has(party)) return { error: '파티원이 지금 도전을 시작하고 있습니다' };
  towerBusy.add(party);
  try {
    const now = nowSec(), runs = towerRuns(party), live = towerLive(runs);
    if (live) return { error: live.by + ' 님이 시작한 ' + (live.kind === 'real' ? '실전' : '파티 연습') + '이 진행 중입니다' };
    const P = loadPlayer(starterId, now); if (!P) return { error: '학생 정보를 찾을 수 없습니다' };
    const { pa, ms, ps } = towerTeam(party, starterId, now);
    if (mode === 'real') { const used = ps.filter((Q) => R.twUsed(Q, now)); if (used.length) return { error: '오늘 이미 실전에 도전한 파티원이 있습니다: ' + used.map((Q) => Q.name).join(', ') + ' (매일 KST 자정에 초기화)' }; }
    const start = R.twStart(ps.map((Q) => R.twBest(Q, now)));
    const run = Object.assign(R.twRun(ms, start, crypto.randomInt(1, 2147483647)), { id: crypto.randomBytes(6).toString('base64url'), kind: mode, by: P.name, pname: pa ? pa.name : '', t0: Math.round(Date.now() / 100) / 10, ms: R.twMeta(ms), day: R.dayKST(now) });
    const after = Math.round(run.d * 1000), later = (fn) => setTimeout(fn, after).unref(), pname = pa ? pa.name : '';
    if (mode === 'real') {
      run.prev = {};
      // 파티 순위는 실전이 끝난 뒤에 (대기 기록으로 넣고, 끝나는 시각에 정식 기록으로)
      if (run.cleared > 0) dbx.q.twRankPend.run(R.weekId(now), party, run.cleared, Math.floor(run.t0 + run.d), pname, JSON.stringify(run.ms.map((m) => ({ name: m.name, house: m.house, npc: m.npc || undefined }))));
      ps.forEach((Q) => {
        R.twUse(Q, now); const old = R.twRecord(Q, now, run.cleared); run.prev[Q.id] = old;
        // 보상은 맡겨 두었다가 실전이 끝난 뒤 「보상 받기」를 누르면 우편으로 보낸다 (진행 중에 결과가 새지 않게, 원정 귀환처럼)
        twPendFlush(Q);
        if (run.cleared > old) Q.twPend = { id: run.id, end: run.t0 + run.d, from: old + 1, to: run.cleared, pname };
        store.markDirty(Q.id);
      });
      later(() => {
        twRankSettle();
        chat.system('party', '✦ 별의 탑 실전 종료 — ' + run.start + '층에서 시작해 ' + (run.cleared >= run.start ? run.cleared + '층까지 올랐습니다.' : '첫 층을 넘지 못했습니다.') + ' 각자의 이번 주 기록에 반영되었습니다.', Date.now() / 1000, party);
        ps.forEach((Q) => { const X = store.get(Q.id); if (X) { R.log(X, nowSec(), '별의 탑 실전: ' + run.cleared + '층까지 기록', 'good'); store.markDirty(Q.id); } });
      });
    }
    runs.slice(0, -1).forEach((r) => { delete r.floors; });   // 대본은 직전 실행과 이번 실행만 남긴다
    runs.push(run); towerSave(party, runs);
    chat.system('party', '별의 탑 ' + (mode === 'real' ? '실전' : '파티 연습') + '을 시작했습니다 (' + start + '층부터). 별의 탑 화면에서 함께 볼 수 있습니다.', Date.now() / 1000, party);
    towerPing(party, { by: P.name, start: true }); later(() => towerPing(party, { end: true }));
    return { run };
  } finally { towerBusy.delete(party); }
}
routes['POST /api/tower'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (store.isBanned(me)) return fail(req, res, 403, '이용이 정지된 계정입니다');
  if (limited('twp:' + me, 0.5, 4)) return fail(req, res, 429, '잠시 후 다시 시도');
  const b = await readJson(req, 256), mode = String(b.mode || '');
  const now = nowSec(), P = loadPlayer(me, now); if (!P) return fail(req, res, 401, '학생 정보를 찾을 수 없습니다');
  if (mode === 'claim') {   // 실전이 끝난 뒤 보상 받기 (파티를 나갔어도 받을 수 있게 아래 파티 확인보다 먼저)
    const p = P.twPend; if (!p) return fail(req, res, 400, '받을 별의 탑 보상이 없습니다');
    if (Date.now() / 1000 < p.end - 1) return fail(req, res, 400, '실전이 아직 진행 중입니다. 끝난 뒤에 받을 수 있습니다');
    const to = p.to; twPendMail(P);
    return send(req, res, 200, Object.assign(towerView(me, now), { claimed: to, pend: null }));
  }
  const party = partyOf.get(me); if (!party) return fail(req, res, 400, '파티에 들어가 있어야 별의 탑에 오를 수 있습니다');
  if (mode === 'npcpos') {   // 동행 친구(NPC) 포지션: 선봉 · 후열
    const k = Number(b.k), pos = String(b.pos || ''), pa = dbx.q.partyGet.get(party);
    if (partyNpcs(pa).indexOf(k) < 0) return fail(req, res, 404, '파티에 없는 동행 친구입니다');
    if (R.TW_NPC_POS.indexOf(pos) < 0) return fail(req, res, 400, '동행 친구는 선봉 · 후열만 맡을 수 있습니다 (치유 주문이 없어 지원은 불가)');
    const np = dbx.kvGet('twnp:' + party, {}); np[k] = pos; dbx.kvSet('twnp:' + party, np);
    return send(req, res, 200, towerView(me, now));
  }
  if (mode === 'pos') {
    const pos = String(b.pos || ''); if (!R.EXP_POS[pos]) return fail(req, res, 400, '포지션 선택 필요');
    if (R.expPositions(P).indexOf(pos) < 0) return fail(req, res, 400, R.EXP_POS[pos].name + ' 포지션은 ' + R.EXP_POS[pos].desc.split(' · ')[0]);
    P.opt.twPos = pos; store.markDirty(me);
    return send(req, res, 200, towerView(me, now));
  }
  // 출발 준비: kind를 주면 출발 종류를 정하고(바꾸면 진행 중인 15초는 처음부터) 준비 완료, on === false면 준비 취소
  if (mode === 'ready' || mode === 'real' || mode === 'party') {
    const kind = mode === 'ready' ? String(b.kind || '') : mode;
    let L = twLobbyOf(party);
    if (kind === 'real' || kind === 'party') {
      const live = towerLive(towerRuns(party)); if (live) return fail(req, res, 409, live.by + ' 님이 시작한 ' + (live.kind === 'real' ? '실전' : '파티 연습') + '이 진행 중입니다. 함께 지켜보세요');
      if (kind === 'real') { const used = towerTeam(party, me, now).ps.filter((Q) => R.twUsed(Q, now)); if (used.length) return fail(req, res, 400, '오늘 이미 실전에 도전한 파티원이 있습니다: ' + used.map((Q) => Q.name).join(', ') + ' (매일 KST 자정에 초기화)'); }
      if (!L) { L = { mode: '', by: '', byName: '', ready: new Map(), at: null, timer: null }; towerLobby.set(party, L); }
      if (L.mode !== kind) {
        if (L.timer) { clearTimeout(L.timer); L.timer = null; L.at = null; }
        L.mode = kind; L.by = me; L.byName = P.name; L.ready.clear();
        chat.system('party', P.name + ' 님이 별의 탑 ' + (kind === 'real' ? '실전' : '파티 연습') + ' 출발을 준비합니다. 모두 「준비 완료」를 누르면 ' + TW_COUNT + '초 뒤 출발합니다.', Date.now() / 1000, party);
      }
    }
    if (!L || !L.mode) return fail(req, res, 400, '먼저 「실전 준비」 또는 「파티 연습 준비」를 눌러 출발 종류를 정해야 합니다');
    if (b.on === false) L.ready.delete(me); else L.ready.set(me, Date.now() / 1000);
    if (b.on === false && !L.ready.size) towerLobby.delete(party);   // 아무도 준비하지 않으면 출발 대기를 닫는다
    twLobbyEval(party); towerPing(party, { lobby: true });
    return send(req, res, 200, towerView(me, now));
  }
  if (mode === 'solo') {   // 혼자 연습: 지금 파티 그대로 돌려 보고 내 화면에서만 본다 (기록 · 보상 없음, 파티를 막지 않음)
    const last = towerSolo.get(me) || 0; if (Date.now() - last < 5000) return fail(req, res, 429, '잠시 후 다시 시도');
    towerSolo.set(me, Date.now());
    const { ms, ps } = towerTeam(party, me, now), start = R.twStart(ps.map((Q) => R.twBest(Q, now)));
    const run = Object.assign(R.twRun(ms, start, crypto.randomInt(1, 2147483647)), { id: crypto.randomBytes(6).toString('base64url'), kind: 'solo', by: P.name, pname: (dbx.q.partyGet.get(party) || {}).name || '', t0: Date.now() / 1000, ms: R.twMeta(ms) });
    return send(req, res, 200, { run });
  }
  if (mode === 'stop') {
    const runs = towerRuns(party), live = towerLive(runs);
    if (!live || live.kind !== 'party') return fail(req, res, 400, '중단할 파티 연습이 없습니다');
    live.d = Math.max(0, Date.now() / 1000 - live.t0); live.stopped = P.name; towerSave(party, runs);
    chat.system('party', P.name + ' 님이 별의 탑 파티 연습을 중단했습니다.', Date.now() / 1000, party); towerPing(party, { stop: true });
    return send(req, res, 200, towerView(me, now));
  }
  fail(req, res, 400, '알 수 없는 요청입니다');
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
  if (!dbx.q.aucBid.run(amount, pid, pname, ends, ends, row.id, row.price).changes) return null;
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
    // 구간마다 3점: 신입생(하위 10%) · 중급(중간값) · 상급(상위 12%) 단계 + 3. 영웅 2점 + 영웅/전설(50%) 1점
    R.AUC_TIERS.forEach((tp, tier) => {
      const lv = Math.max(1, at(tp.p) + 3);
      [3, 3, Math.random() < 0.5 ? 4 : 3].forEach((r) => {
        const it = R.makeItem(dummy, R.D.SLOTS[crypto.randomInt(R.D.SLOTS.length)].id, lv, r, r), min = Math.max(50, R.sellPrice(it) * 8);
        dbx.q.aucInsert.run(v.id, JSON.stringify(it), it.name, it.r, it.ilvl, it.slot, Math.floor(v.end), min, 0, tier);
      });
    });
    chat.system('notice', '떠돌이 상인 경매가 시작되었습니다 (1시간).', Date.now() / 1000);
    chat.pingAll('auction', { visit: v.id });
  }
  // 마감 5분 전: 값을 불렀던 학생들에게 알림 (1위는 「지키는 중」, 밀린 학생은 「다시 부를 수 있음」)
  dbx.db.prepare('SELECT * FROM auction WHERE done = 0 AND ends > ? AND ends <= ?').all(Math.floor(now), Math.floor(now) + 300).forEach((r) => {
    if (aucWarned.has(r.id)) return; aucWarned.add(r.id); if (aucWarned.size > 500) aucWarned.delete(aucWarned.values().next().value);
    const who = new Set(aucBidders.get(r.id) || []); if (r.bidder) who.add(r.bidder);
    who.forEach((pid) => { if (String(pid).startsWith('npc:')) return; const top = pid === r.bidder, msg = r.name + (top ? ' 경매가 곧 끝납니다 · 지금 가장 높은 값(' + R.fmt(r.price) + ')을 부른 상태입니다' : ' 경매가 곧 끝납니다 · 지금 가장 높은 값은 ' + R.fmt(r.price) + ' ' + CUR + '입니다');
      chat.ping(pid, 'aucsoon', { name: r.name, top, price: r.price, ends: r.ends }); try { push.direct(pid, 'aucbid', '떠돌이 상인 · 마감 5분 전', msg, 'aucsoon-' + r.id); } catch (e) { } });
  });
  const endedVisits = new Set();
  dbx.q.aucOpenEnded.all(Math.floor(now)).forEach((r) => {
    if (!dbx.q.aucDone.run(r.id).changes) return;
    endedVisits.add(r.visit);
    if (r.bidder && !String(r.bidder).startsWith('npc:')) {
      let it = null; try { it = JSON.parse(r.item); } catch (e) { }
      try { const Q = loadPlayer(r.bidder, nowSec()); if (Q) { R.cupAdd(Q, R.CUP_AUC, 'auc'); Q.st.wandWon = (Q.st.wandWon || 0) + 1; store.markDirty(r.bidder); } } catch (e) { log('낙찰 대항전 점수 실패', e); }   // 대항전 점수 (거울관 특기)
      if (it) sendMail(r.bidder, '떠돌이 상인', '낙찰: ' + r.name, r.bidder_name + ' 님, ' + R.fmt(r.price) + ' ' + CUR + '에 낙찰되었습니다. 좋은 주인을 만나 다행이군요.\n— 떠돌이 상인', { items: [it] }, Math.floor(Date.now() / 1000) + 14 * 86400, true);
    }
    chat.pingAll('auction', { done: r.id });
  });
  // 한 방문의 물건이 모두 마감되면 공지에 한 줄만 (낙찰마다 올리지 않는다 · 누가 샀는지는 경매 화면 기록)
  endedVisits.forEach((vid) => {
    const all = dbx.q.aucByVisit.all(vid); if (!all.length || all.some((x) => !x.done)) return;
    chat.system('notice', '떠돌이 상인 경매가 종료되었습니다. ' + all.length + '점 중 ' + all.filter((x) => x.bidder && !String(x.bidder).startsWith('npc:')).length + '점이 낙찰되었습니다.', Date.now() / 1000);
  });
}
routes['GET /api/auction'] = (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (limited('aug:' + me, 1, 10)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const now = nowSec(); aucTick(now); const v = aucVisitNow(now);
  // 앞 방문에서 막판 연장으로 아직 끝나지 않은 물건 (다음 방문이 시작돼도 보이게)
  const ext = dbx.db.prepare('SELECT * FROM auction WHERE done = 0 AND ext = 1 AND ends > ? AND visit <> ? ORDER BY id').all(Math.floor(now), v ? v.id : -1).map((r) => aucOut(r, me));
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
// 함께 원정 귀환 투표: 다른 학생과 함께 떠난 원정은 혼자 귀환하지 않고, 아직 원정 중인 학생의 과반이 찬성하면 모두 함께 귀환한다
// (투표는 메모리에만 · 서버를 다시 켜면 처음부터. 원정 일정의 pt.vote에 찬성한 학생 id를 적어 화면에 보여 준다)
const expVotes = new Map();   // pt.ck → Set(pid)
// 귀환 투표가 통과한 함께 원정(pt.ck → {t, yes, n}). 그때 함께 처리되지 못한 일행(처리 오류 · 목록 누락)은 다음 요청 때 loadPlayer에서 마저 귀환시킨다
const expRecalled = new Map();
function expRecallLeft(P, now) {
  if (!expRecalled.size || !P || !P.exp) return;
  P.exp.forEach((j, k) => {
    const v = j && j.pt && j.pt.ck && expRecalled.get(j.pt.ck); if (!v || R.expEnd(j) <= now) return;
    try {
      const o = R.act(P, world.ctx(now), now, 'expCancel', { slot: k }); o.vote = 1; R.inbox(P, o);
      addNote(P.id, 'exp', '함께 원정 귀환 투표에서 과반이 찬성해 모두 귀환했습니다 (' + v.yes + '/' + v.n + '명 찬성)', { view: 'explore' });
      store.markDirty(P.id); log('함께 원정 귀환 투표: 남아 있던 일행 귀환', P.id, j.pt.ck);
    } catch (e) { log('귀환 투표 뒤 남은 일행 처리 실패', P.id, e.message); }
  });
}
function expPartyActive(ck, ids, now) {   // 같은 원정(ck)에 아직 나가 있는 학생들: [{id, P, slot}]
  const out = [];
  ids.forEach((id) => { const Q = loadPlayer(id, now); if (!Q) return; const k = Q.exp.findIndex((j) => j && j.pt && j.pt.ck === ck && R.expEnd(j) > now); if (k >= 0) out.push({ id, P: Q, slot: k }); });
  return out;
}
function expPartyOf(P, slot, now) {
  const j = P.exp[slot]; if (!j || !j.pt || !j.pt.ck || R.expEnd(j) <= now) return null;
  const ids = new Set([P.id].concat((j.pt.with || []).filter((w) => w && w.id && !w.npc).map((w) => w.id)));
  const act = expPartyActive(j.pt.ck, [...ids], now);
  // 다른 일행의 동행 목록도 합친다 (한 사람의 목록에 빠진 일행이 있어도 함께 처리되도록)
  const more = []; act.forEach((x) => { const xj = x.P.exp[x.slot]; ((xj.pt && xj.pt.with) || []).forEach((w) => { if (w && w.id && !w.npc && !ids.has(w.id)) { ids.add(w.id); more.push(w.id); } }); });
  return { j, ck: j.pt.ck, act: more.length ? act.concat(expPartyActive(j.pt.ck, more, now)) : act };
}
// 혼자 먼저 귀환한 뒤: 남은 일행 화면에 「귀환」 표시 · 알림, 내 찬성표 지우기, 30분 안에 3번이면 3시간 함께 원정 제한
function expLeft(P, pa, now) {
  const V = expVotes.get(pa.ck); if (V) V.delete(P.id);
  pa.act.forEach((x) => {
    if (x.id === P.id) return; const j = x.P.exp[x.slot]; if (!j || !j.pt) return;
    j.pt.left = [...new Set((j.pt.left || []).concat(P.id))];
    if (j.pt.vote) { const ids = pa.act.filter((y) => y.id !== P.id).map((y) => y.id), yes = [...(V || [])].filter((id) => ids.indexOf(id) >= 0); j.pt.vote = { yes, need: Math.floor(ids.length / 2) + 1, n: ids.length }; }
    store.markDirty(x.id); addNote(x.id, 'exp', P.name + ' 님이 함께 원정에서 혼자 먼저 귀환했습니다. 보상 감소는 먼저 귀환한 학생에게만 적용되며, 남은 일행의 원정과 처치 · 보상은 출발할 때 정해진 대로 유지됩니다', { view: 'explore' });
  });
  const L = (P.expLeaves || []).filter((t) => now - t < R.EXP_LEAVE_WIN).concat(now); P.expLeaves = L.slice(-R.EXP_LEAVE_N);
  if (L.length >= R.EXP_LEAVE_N) { P.erBan = now + R.EXP_LEAVE_BAN; P.expLeaves = []; R.log(P, now, '함께 원정에서 30분 안에 ' + R.EXP_LEAVE_N + '번 혼자 귀환해 3시간 동안 함께 원정에 참가할 수 없습니다', 'bad'); }
  store.markDirty(P.id);
}
routes['POST /api/exp/vote'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (store.isBanned(me)) return fail(req, res, 403, '이용이 정지된 계정입니다');
  if (limited('exv:' + me, 1, 5)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const b = await readJson(req, 512), now = nowSec(); world.tick(now);
  const P = loadPlayer(me, now); if (!P) return fail(req, res, 401, '학생 정보를 찾을 수 없습니다');
  const slot = Number(b.slot) | 0, pa = expPartyOf(P, slot, now); if (!pa) return fail(req, res, 400, '진행 중인 함께 원정이 없습니다');
  if (pa.act.length <= 1) return fail(req, res, 400, '함께 원정 중인 다른 학생이 없습니다. 「귀환」으로 돌아올 수 있습니다');
  const ids = pa.act.map((x) => x.id), V = expVotes.get(pa.ck) || new Set();
  if (b.on === false) V.delete(me); else V.add(me);
  [...V].forEach((id) => { if (ids.indexOf(id) < 0) V.delete(id); });
  expVotes.set(pa.ck, V);
  const need = Math.floor(ids.length / 2) + 1;
  if (V.size >= need) {   // 과반 찬성: 모두 귀환
    expVotes.delete(pa.ck); let mine = null;
    expRecalled.set(pa.ck, { t: now, yes: V.size, n: ids.length }); for (const [k, v] of expRecalled) if (now - v.t > 86400) expRecalled.delete(k);
    pa.act.forEach((x) => {
      try {
        const o = R.act(x.P, world.ctx(now), now, 'expCancel', { slot: x.slot }); o.vote = 1;
        if (x.id === me) mine = o; else { R.inbox(x.P, o); addNote(x.id, 'exp', '함께 원정 귀환 투표에서 과반이 찬성해 모두 귀환했습니다 (' + V.size + '/' + ids.length + '명 찬성)', { view: 'explore' }); }
        store.markDirty(x.id); setImmediate(() => { try { chat.exrChanged(x.id); } catch (e) { } });
      } catch (e) { log('귀환 투표 처리 실패', x.id, e.message); }
    });
    log(`함께 원정 귀환 투표: ${pa.ck} ${V.size}/${ids.length} 찬성 → 모두 귀환`);
    return send(req, res, 200, { ok: true, done: true, yes: V.size, n: ids.length, r: mine, P: R.publicState(P) });
  }
  pa.act.forEach((x) => {   // 찬성 현황을 모두의 원정 일정에 적는다
    const j = x.P.exp[x.slot]; j.pt.vote = { yes: [...V], need, n: ids.length }; store.markDirty(x.id);
    if (x.id !== me && b.on !== false) addNote(x.id, 'exp', P.name + ' 님이 함께 원정 귀환에 찬성했습니다 (찬성 ' + V.size + '명 · 귀환에 필요한 찬성 ' + need + '명 · 학생 ' + ids.length + '명, 동행 친구 제외). 과반이 찬성하면 모두 함께 귀환합니다', { view: 'explore' });
  });
  send(req, res, 200, { ok: true, done: false, yes: V.size, need, n: ids.length, P: R.publicState(P) });
};
routes['POST /api/exproom'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (store.isBanned(me)) return fail(req, res, 403, '이용이 정지된 계정입니다');
  if (limited('ero:' + me, 2, 8)) return fail(req, res, 429, '요청이 너무 잦습니다');
  const b = await readJson(req, 1024), now = nowSec();
  world.tick(now);
  { const Pm = store.get(me); if (Pm && Pm.erBan > now && (b.op === 'create' || b.op === 'join')) return fail(req, res, 400, '혼자 귀환을 반복해 함께 원정에 참가할 수 없습니다 (' + R.fmtTime(Pm.erBan - now) + ' 남음)'); }
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
  send(req, res, 200, board.list(me, { tag: u.get('tag') || '', q: u.get('q') || '', qt: u.get('qt') || '', page: u.get('page') || 1, hideDone: u.get('hd') === '1', sp: u.get('sp') === 'idea' || u.get('sp') === 'rp' ? u.get('sp') : '', sort: u.get('sort') === 'act' ? 'act' : '', st: String(u.get('st') || '').slice(0, 10) }));
};
routes['POST /api/board'] = async (req, res) => {
  const me = authed(req); if (!me) return fail(req, res, 401, '로그인이 필요합니다');
  if (store.isBanned(me)) return fail(req, res, 403, '이용이 정지된 계정입니다');
  const b = await readJson(req, 16384), op = String(b.op || ''), now = Math.floor(Date.now() / 1000), meta = dbx.q.playerMeta.get(me);
  if (!meta || meta.banned) return fail(req, res, 403, '사용할 수 없습니다');
  if ((op === 'write' || op === 'edit' || op === 'comment' || op === 'cedit') && meta.muted_until && meta.muted_until > now) return fail(req, res, 403, '채팅·글쓰기가 금지된 상태입니다 (' + Math.ceil((meta.muted_until - now) / 60) + '분 남음)');
  if (op === 'write' && limited('bdw:' + me, 1 / 30, 1)) return fail(req, res, 429, '글은 30초에 하나씩 작성할 수 있습니다');
  if (op === 'comment' && limited('bdc:' + me, 1 / 4, 3)) return fail(req, res, 429, '댓글을 너무 빨리 달고 있습니다');
  if (limited('bdp:' + me, 1, 10)) return fail(req, res, 429, '잠시 후 다시 시도');
  try {
    let id = null;
    if (op === 'write') { id = board.write(me, b, now); if (!b.priv) { const BP = store.get(me); if (BP) { BP.st.posts = (BP.st.posts || 0) + 1; store.markDirty(me); } } }   // 칭호 「게시판 터줏대감」 (관리자만 보기 글 제외)
    else if (op === 'edit') id = board.edit(me, b, now);
    else if (op === 'del') board.del(me, b.id);
    else if (op === 'comment') id = board.comment(me, b.id, b.text, now, b.parent);
    else if (op === 'cedit') { if (limited('bdc:' + me, 1 / 4, 3)) return fail(req, res, 429, '잠시 후 다시 시도'); id = board.cedit(me, b.cid, b.text, now); }
    else if (op === 'cdel') { board.cdel(me, b.cid); id = Number(b.id) | 0; }
    else if (op === 'status') id = board.setStatus(me, b.id, b.st);
    else if (op === 'mute') id = board.mute(me, b.id, !!b.on);
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
  // 읽은 우편 지우기: 읽었고 보상이 없거나 이미 받은 우편만 (내 우편함에서만 사라진다)
  const done = (r) => { let rw = {}; try { rw = JSON.parse(r.rewards); } catch (e) { } return !!r.rd && (!!r.cl || !R.rewardText(rw)); };
  if (op === 'delRead') { const ds = mine.filter(done); ds.forEach((r) => dbx.q.mailGone.run(r.id, me)); return send(req, res, 200, { ok: true, n: ds.length }); }
  const pick = op === 'claimAll' ? mine.filter((r) => !r.cl) : mine.filter((r) => r.id === Number(b.id));
  if (op === 'del') { if (!pick.length) return fail(req, res, 404, '없는 우편이거나 기한이 지났습니다'); if (!done(pick[0])) return fail(req, res, 400, '받지 않은 보상이 있는 우편은 삭제할 수 없습니다'); dbx.q.mailGone.run(pick[0].id, me); return send(req, res, 200, { ok: true, n: 1 }); }
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
    pevent(me, 'mail', '#' + r.id + ' 「' + sec.dec(r.title) + '」 (' + (r.sender || '') + ')' + (o.text ? ' ' + o.text : ''), req);
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
  if (b.to === '@tf') {   // 학점 이전 증서를 받은 학생 = 기말시험 선택 과목 도입 전 입학생 (정지 · 게스트 · 삭제 제외). dry면 인원만
    const rows = dbx.db.prepare('SELECT id FROM players WHERE created < ? AND banned = 0 AND guest = 0 AND deleted = 0').all(R.EXAM_OPT_AT);
    if (b.dry) return send(req, res, 200, { ok: true, n: rows.length });
    const ids = rows.map((r) => sendMail(r.id, '운영진', title, b.body, rw, exp, true)); log('우편(학점 이전 증서 대상 ' + ids.length + '명) ' + title); return send(req, res, 200, { ok: true, ids, n: ids.length });
  }
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
  if (full || role) o.members = members.map((m) => ({ id: m.id, role: m.role, rank: m.rank || '', rankName: R.guildRankName(ranks, m.role, m.rank), contrib: m.contrib || 0, name: m.name, house: m.house, grade: m.grade, lvl: m.lvl, power: Math.floor(m.power || 0), joined: m.joined || 0, av: m.avatar_v, title: m.title, online: m.id === me || isOnline(m.id), seen: m.last_seen }));
  if (mine) {
    const P = store.get(me);
    o.myRank = mine.rank || ''; o.myRankName = R.guildRankName(ranks, role, mine.rank);
    o.perms = {}; R.GUILD_PERMS.forEach((k) => { o.perms[k[0]] = R.guildCan(ranks, role, mine.rank, k[0]); });
    o.my = { contrib: mine.contrib || 0, checkin: mine.cday === day, dpts: mine.dday === day ? mine.dpts : 0, cap: R.GUILD_DONATE_CAP, unit: P ? R.guildGoldUnit(P) : 1, bonusIn: R.GUILD_CHECKIN };
    o.gold = g.gold || 0; o.slots = R.guildSlots(lv);
    o.stock = dbx.q.gsList.all(id).map((r) => ({ k: r.kind, id: r.key, n: Number(r.n) }));
    o.items = dbx.q.giList.all(id).map((r) => { const it = JSON.parse(r.data); return { id: r.id, name: r.name, r: r.rarity, ilvl: r.ilvl, slot: r.slot, by: r.by_name, t: r.t, item: it }; });
    o.log = dbx.q.glList.all(id, 30);
    o.ranksMax = R.guildRanksMax(lv);
    if (lv >= R.GRIT_LV) { const t = nowSec(), st = gritState(id, members.length, t), bf = P && P.buffs && P.buffs.gritual; o.rit = { n: st.pids.length, goal: st.goal, done: st.done, mine: st.pids.indexOf(me) >= 0, claimed: st.claimed.indexOf(me) >= 0 || (!!P && P.gritDay === st.day), until: R.nextMidnight(t), end: bf && bf.end > t ? bf.end : 0, cost: P ? R.ritualCost(P, world.ctx(t), t) : 0 }; }
    if (lv >= R.GWQ_LV) o.wq = gwqView(members, P, nowSec());
    if (o.perms.invite) o.apps = dbx.q.gApps.all(id).map((a) => ({ id: a.id, t: a.t, msg: sec.dec(a.msg), name: a.name, house: a.house, grade: a.grade, lvl: a.lvl, av: a.avatar_v }));
  }
  return o;
}
/* 동아리 의식: 동아리마다 하루 한 번. 목표는 그날 처음 봉헌할 때의 부원 수로 정한다.
   의식이 이루어지면 봉헌한 부원이 각자 원할 때 「축복 받기」를 눌러 그때부터 축복을 받는다 (그날 KST 자정까지, 하루 한 번).
   claimed가 없는 옛 기록: 이미 이루어진 의식은 예전 방식대로 봉헌한 부원 모두가 축복을 받았으므로 모두 받은 것으로 친다 */
function gritState(gid, n, now) {
  const d = R.dayKST(now); let st = dbx.kvGet('grit:' + gid, null);
  if (!st || st.day !== d) st = { day: d, pids: [], done: 0, goal: R.gritGoal(n), claimed: [] };
  if (!Array.isArray(st.claimed)) st.claimed = st.done ? st.pids.slice() : [];
  return st;
}
// 주간 동아리 과제: 부원들의 이번 주 기록을 합친다 (주가 바뀐 뒤 아직 들어오지 않은 부원은 0)
function gwqView(members, P, now) {
  const w = R.weekId(now), Qs = members.map((m) => store.get(m.id)).filter(Boolean);
  return { wk: w, end: R.weekStart(w + 1), list: R.GWQ.map((q) => ({ id: q.id, name: q.name, unit: q.unit, goal: q.goal, need: R.gwqNeed(q), prog: Qs.reduce((a, Q) => a + R.gwqMine(Q, q, w), 0), mine: R.gwqMine(P, q, w), got: !!(P && P.gwq && P.gwq.wk === w && P.gwq.got[q.id]) })), reward: P ? R.gwqReward(P) : null };
}
// 동아리를 스스로 탈퇴하면 24시간(현실 시간) 동안 다른 동아리에 가입 · 신청 · 창설할 수 없다
const G_REJOIN = 24 * 3600;
function gRejoinMsg(pid) { const Q = store.get(pid), left = Q && Q.gLeftAt ? Q.gLeftAt + G_REJOIN - Date.now() / 1000 : 0; return left > 0 ? '동아리 탈퇴 후 24시간 동안은 가입할 수 없습니다 (' + Math.ceil(left / 3600) + '시간 남음)' : ''; }
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
// 창고에서 쓰는 칸: 장비 1개 = 1칸, 재료 · 물약은 종류마다 1칸
function gUsed(gid) { return dbx.q.giCount.get(gid).n + dbx.q.gsCount.get(gid).n; }
// 동아리를 해체할 때 창고에 남은 것은 회장에게 우편으로 돌려준다
function gReturnStorage(gid, owner, gname) {
  const g = dbx.q.gGet.get(gid), items = dbx.q.giList.all(gid).map((r) => JSON.parse(r.data)), gold = Math.floor((g && g.gold) || 0);
  for (let i = 0; i < Math.max(items.length, gold > 0 ? 1 : 0); i += 10) sendMail(owner, '동아리', '「' + gname + '」 창고 정리', '동아리를 해체해 창고에 남아 있던 것을 돌려드립니다.', { gold: i === 0 ? gold : 0, items: items.slice(i, i + 10) }, Date.now() / 1000 + 30 * 86400);
  // 재료 · 물약은 우편 보상 종류가 아니므로 회장 가방(재료함 · 물약 선반)에 바로 돌려준다
  const stock = dbx.q.gsList.all(gid), P = stock.length ? store.get(owner) : null;
  if (P) {
    const got = stock.map((r) => { const bag = R.gStockBag(P, r.kind), nm = R.gStockName(r.kind, r.key); if (!bag || !nm) return ''; bag[r.key] = (bag[r.key] || 0) + Number(r.n); return nm + ' ' + R.fmt(Number(r.n)) + '개'; }).filter(Boolean);
    if (got.length) { R.log(P, nowSec(), '「' + gname + '」 창고에 남아 있던 재료 · 물약이 반환되었습니다: ' + got.join(', '), 'news'); store.markDirty(owner); }
  }
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
  if ((op === 'join' || op === 'create' || op === 'inviteAccept') && !mine && gRejoinMsg(me)) return fail(req, res, 400, gRejoinMsg(me));
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
      if (gRejoinMsg(target)) return fail(req, res, 400, '탈퇴 후 24시간이 지나지 않은 학생입니다');
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
    gLeave(me); P.gLeftAt = Math.floor(Date.now() / 1000); store.markDirty(me); gSys(mine, P.name + ' 님이 동아리에서 나갔습니다.'); gLog(mine, P.name + ' 님 탈퇴');
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
    gLog(mine, nameOf(target) + ' 님 → ' + (nr === 'officer' ? ranks.officer || '부회장' : ranks.base.name)); if (nr === 'officer') gSys(mine, nameOf(target) + ' 님이 ' + R.josa(ranks.officer || '부회장', '이', '가') + ' 되었습니다.');
    return ok();
  }
  if (op === 'setrank') {
    if (!staff || !sameG) return fail(req, res, 403, '회장·부회장만 역할을 정할 수 있습니다');
    if (tRole !== 'member') return fail(req, res, 400, '회장·부회장에게는 부원 역할을 줄 수 없습니다');
    const rk = String(b.rank || ''); if (rk && !ranks.list.some((x) => x.id === rk)) return fail(req, res, 400, '없는 역할입니다');
    dbx.q.gSetRank.run(rk, target); gLog(mine, nameOf(target) + ' 님 → ' + R.guildRankName(ranks, 'member', rk) + ' (' + P.name + ')');
    return ok();
  }
  if (op === 'ranks') {
    if (role !== 'owner') return fail(req, res, 403, '회장만 역할을 고칠 수 있습니다');
    const nr = R.guildCleanRanks(b.ranks, R.guildRanksMax(g.lv || 1)); dbx.q.gRanks.run(JSON.stringify(nr), mine);
    ranks.list.forEach((x) => { if (!nr.list.some((y) => y.id === x.id)) dbx.q.gClearRank.run(mine, x.id); });
    gLog(mine, P.name + ' 님이 역할을 고쳤습니다 (' + [nr.owner, nr.officer, nr.base.name].concat(nr.list.map((x) => x.name)).join(' · ') + ')');
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
    gRankCache.at = 0; dbx.tx(() => { dbx.q.gDelMembers.run(mine); dbx.q.gDelete.run(mine); dbx.q.gAppDelGuild.run(mine); dbx.q.giDelGuild.run(mine); dbx.q.gsDelGuild.run(mine); dbx.q.glDelGuild.run(mine); dbx.q.ginvDelGuild.run(mine); });
    guildOf.delete(me); guildRole.delete(me); guildLv.delete(mine); chat.guildChanged(me); chat.dropGuild(mine); if (setGuildLv(P)) store.markDirty(me);
    return send(req, res, 200, { ok: true, guild: null });
  }
  // ── 기여: 출석 · 기부 ──
  if (op === 'checkin') {
    if (!dbx.q.gCheckin.run(day, R.GUILD_CHECKIN, me, day).changes) return fail(req, res, 400, '오늘은 이미 동아리 출석을 했습니다');
    gXp(mine, R.GUILD_CHECKIN); gLog(mine, P.name + ' 님 출석 (+' + R.GUILD_CHECKIN + ')');
    P.st.gCheckin = (P.st.gCheckin || 0) + 1; store.markDirty(me);   // 칭호 「동아리의 기둥」
    return ok({ got: R.GUILD_CHECKIN });
  }
  R.advance(P, world.ctx(gnow), gnow);
  if (op === 'ritual') {
    if ((g.lv || 1) < R.GRIT_LV) return fail(req, res, 400, '동아리 ' + R.GRIT_LV + '레벨부터 의식을 올릴 수 있습니다');
    const st = gritState(mine, gCount(mine), gnow); if (st.pids.indexOf(me) >= 0) return fail(req, res, 400, '오늘은 이미 봉헌했습니다');
    const cost = R.ritualCost(P, world.ctx(gnow), gnow); if (P.res.mana < cost) return fail(req, res, 400, '마나가 모자랍니다 (마나 ' + R.fmt(cost) + ' 필요)');
    P.res.mana -= cost; st.pids.push(me); store.markDirty(me);
    R.log(P, gnow, '동아리 의식에 마나 ' + R.josa(R.fmt(cost), '을', '를') + ' 봉헌했습니다', 'news'); gLog(mine, P.name + ' 님이 동아리 의식에 봉헌 (' + st.pids.length + '/' + st.goal + ')');
    if (!st.done && st.pids.length >= st.goal) {
      st.done = gnow;
      st.pids.forEach((pid) => { const Q = pid === me ? P : store.get(pid); if (Q) { R.log(Q, gnow, '동아리 의식이 이루어졌습니다. 오늘 KST 자정 전까지 「축복 받기」를 누르면 그때부터 ' + R.GRIT_BUFF.text + ' 축복을 받습니다.', 'story'); store.markDirty(pid); } });
      gSys(mine, '✦ 오늘의 동아리 의식이 이루어졌습니다. 봉헌한 부원은 오늘 KST 자정 전까지 원하는 때에 「축복 받기」를 누르면 그때부터 「' + R.GRIT_BUFF.name + '」 — ' + R.GRIT_BUFF.text + ' 효과를 받습니다. 아직 봉헌하지 않은 부원도 봉헌하면 받을 수 있습니다.');
    }
    dbx.kvSet('grit:' + mine, st);
    return ok({ P: R.publicState(P), now: gnow });
  }
  if (op === 'ritualClaim') {
    if ((g.lv || 1) < R.GRIT_LV) return fail(req, res, 400, '동아리 ' + R.GRIT_LV + '레벨부터 의식을 올릴 수 있습니다');
    const st = gritState(mine, gCount(mine), gnow);
    if (!st.done) return fail(req, res, 400, '오늘의 동아리 의식이 아직 이루어지지 않았습니다 (' + st.pids.length + '/' + st.goal + ')');
    if (st.pids.indexOf(me) < 0) return fail(req, res, 400, '봉헌한 부원만 축복을 받을 수 있습니다');
    if (st.claimed.indexOf(me) >= 0 || P.gritDay === st.day) return fail(req, res, 400, '오늘은 이미 축복을 받았습니다');
    st.claimed.push(me); P.gritDay = st.day; R.gritBless(P, gnow); store.markDirty(me);
    R.log(P, gnow, '「' + R.GRIT_BUFF.name + '」 축복을 받았습니다. ' + R.GRIT_BUFF.text, 'story');
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
      if (gUsed(mine) >= R.guildSlots(g.lv)) return fail(req, res, 400, '창고가 가득 찼습니다 (' + R.guildSlots(g.lv) + '칸)');
      const it = P.inv.splice(i, 1)[0]; dbx.q.giPut.run(mine, JSON.stringify(it), it.name + (it.enh ? ' +' + it.enh : ''), it.r, it.ilvl, it.slot, P.name, now); store.markDirty(me);
      gLog(mine, P.name + ' 님이 ' + R.josa(it.name + (it.enh ? ' +' + it.enh : ''), '을', '를') + ' 넣었습니다');
    } else if (b.k) {   // 재료 · 물약: 종류마다 1칸, 같은 종류는 수량만 늘어난다
      const k = String(b.k), key = String(b.id || ''), nm = R.gStockName(k, key), bag = nm ? R.gStockBag(P, k) : null, n = Math.floor(Number(b.n) || 0);
      if (!bag) return fail(req, res, 400, '보관할 수 없는 물품입니다');
      if (!(n >= 1) || n > (bag[key] || 0)) return fail(req, res, 400, '수량 확인 필요 (보유 ' + R.fmt(bag[key] || 0) + '개)');
      const cur = dbx.q.gsGet.get(mine, k, key), have = cur ? Number(cur.n) : 0;
      if (have <= 0 && gUsed(mine) >= R.guildSlots(g.lv)) return fail(req, res, 400, '창고가 가득 찼습니다 (' + R.guildSlots(g.lv) + '칸)');
      if (have + n > R.GSTOCK_MAX) return fail(req, res, 400, '한 종류에 보관할 수 있는 수량을 넘었습니다');
      bag[key] -= n; dbx.q.gsAdd.run(mine, k, key, n); store.markDirty(me);
      gLog(mine, P.name + ' 님이 ' + nm + ' ' + R.fmt(n) + '개를 넣었습니다');
    } else {
      const amt = Math.floor(Number(b.gold) || 0); if (!(amt >= 1) || amt > P.res.gold) return fail(req, res, 400, CUR + '를 확인 필요');
      P.res.gold -= amt; dbx.q.gGoldAdd.run(amt, mine); store.markDirty(me); gLog(mine, P.name + ' 님이 ' + R.fmt(amt) + ' ' + CUR + '를 넣었습니다');
    }
    return ok({ P: R.publicState(P), now: gnow });
  }
  if (op === 'withdraw') {
    if (!can('take')) return fail(req, res, 403, '창고에서 꺼낼 권한이 없습니다');
    if (b.id && !b.k) {
      const r = dbx.q.giGet.get(Number(b.id) | 0, mine); if (!r) return fail(req, res, 404, '이미 누가 꺼냈습니다');
      if (P.inv.length >= R.calc(P, world.ctx(gnow), gnow).bag) return fail(req, res, 400, '가방이 가득 찼습니다');
      if (!dbx.q.giDel.run(r.id, mine).changes) return fail(req, res, 409, '이미 누가 꺼냈습니다');
      P.inv.push(JSON.parse(r.data)); store.markDirty(me); gLog(mine, P.name + ' 님이 ' + R.josa(r.name, '을', '를') + ' 꺼냈습니다');
    } else if (b.k) {
      const k = String(b.k), key = String(b.id || ''), nm = R.gStockName(k, key), bag = nm ? R.gStockBag(P, k) : null, n = Math.floor(Number(b.n) || 0);
      if (!bag) return fail(req, res, 400, '창고에 없는 물품입니다');
      if (!(n >= 1) || n > R.GSTOCK_MAX) return fail(req, res, 400, '수량 확인 필요');
      if (!dbx.q.gsTake.run(n, mine, k, key, n).changes) return fail(req, res, 400, '창고에 남은 수량이 모자랍니다');
      dbx.q.gsClean.run(mine); bag[key] = (bag[key] || 0) + n; store.markDirty(me);
      gLog(mine, P.name + ' 님이 ' + nm + ' ' + R.fmt(n) + '개를 꺼냈습니다');
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
// 공지 탭 상단 고정 공지: 개수 제한 없음 (새 것이 위). 예전 한 개짜리(pinNotice)는 첫 칸으로 이어받는다
function pinList() { let l = dbx.kvGet('pinNotices', null); if (!Array.isArray(l)) { const o = dbx.kvGet('pinNotice', null); l = o && o.text ? [o] : []; } return l; }
function pinSave(l) { dbx.kvSet('pinNotices', l); dbx.kvSet('pinNotice', l[0] || null); chat.pingAll('pin', { pin: l[0] || null, pins: l }); return l; }
routes['POST /api/admin/notice'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 4096);
  if (b.unpin) { const id = b.id != null ? String(b.id) : '', l = pinSave(id ? pinList().filter((p) => String(p.id) !== id) : []); oplog('admin', '관리자', 'notice', id ? '상단 고정 하나 해제' : '상단 고정 모두 해제'); return send(req, res, 200, { ok: true, pin: l[0] || null, pins: l }); }   // 고정 해제만 (id가 없으면 모두)
  if (!b.text) return fail(req, res, 400, 'text가 필요합니다');
  const text = String(b.text).slice(0, 500), t = Date.now() / 1000;
  world.addNotice(text, nowSec(), false); world.invalidate(); const m = chat.staffNotice(text, t);
  if (b.pin) pinSave([{ id: m.id, t, text }].concat(pinList()));   // 공지 탭 상단에 고정 (새 것이 위)
  send(req, res, 200, { ok: true, pin: b.pin ? pinList()[0] || null : undefined, pins: b.pin ? pinList() : undefined });
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
  store.markDirty(row.id); oplog('admin', '관리자', 'grant', row.name + ' · 별조각 ' + shard + (b.reason ? ' · ' + String(b.reason).slice(0, 60) : '')); pevent(row.id, 'op', '별조각 ' + shard + '개 지급'); send(req, res, 200, { ok: true, shard: P.res.shard });
};
// 운영실: 학생 카드 (공개 범위 설정과 관계없이 · 두상은 데이터 URL로)
routes['GET /api/admin/pcard'] = (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const q = new URL(req.url, 'http://x').searchParams, nm = String(q.get('name') || '').trim(), pid = String(q.get('id') || '');
  const key = nm ? dbx.q.playerByKey.get(nameKey(nm)) : null, id = key ? key.id : /^[A-Za-z0-9_-]{4,40}$/.test(pid) ? pid : '';
  const row = id && dbx.q.getProfile.get(id); if (!row) return fail(req, res, 404, '없는 학생입니다');
  const pr = profileOf(row.profile), P = store.peek(id) || store.get(id), meta = dbx.db.prepare('SELECT role, last_seen FROM players WHERE id = ?').get(id) || {};
  let av = ''; try { const a = dbx.q.getAvatar.get(id); if (a && a.avatar) av = 'data:' + (a.avatar_type === 'image/png' ? 'image/png' : 'image/jpeg') + ';base64,' + sec.decBuf(a.avatar).toString('base64'); } catch (e) { }
  const s = P ? R.summary(P, world.W, Math.min(nowSec(), P.at)) : { lvl: row.lvl, grade: row.grade, power: row.power };
  const tg = guildOf.get(id), tgr = tg && dbx.q.gGet.get(tg), mr = tgr ? dbx.q.gMember.get(id) || {} : null;
  oplog('admin', '관리자', 'pcard', row.name + ' 학생 카드 확인');
  send(req, res, 200, { id, name: row.name, house: (R.HOUSE[row.house] || {}).name || row.house, grade: s.grade, lvl: s.lvl, power: s.power, cls: P && R.CLS[P.cls] ? R.CLS[P.cls].name : '',
    title: P ? R.titleName(P, P.title) : row.title || '', status: pr.status || '', bio: pr.bio || '', fav: pr.fav || '', av, created: row.created, seen: meta.last_seen || 0, online: isOnline(id),
    role: meta.role === 'chief' ? '학생회장' : meta.role === 'admin' ? '학생회' : '', banned: !!row.banned, deleted: !!row.deleted, guild: tgr ? tgr.name + (mr ? ' · ' + R.guildRankName(gRanksOf(tgr), mr.role, mr.rank) : '') : '' });
};
// 운영실: 자원 회수 (잘못 지급 · 장비 복구 시 분해로 얻은 것 등). 가진 만큼만 빼고(0 아래로 내리지 않음) 학생 일지에 사유와 함께 남긴다
const RECLAIM = [['stone', '마석'], ['dust', '마석가루'], ['gold', CUR], ['shard', '별조각'], ['mana', '마나'], ['know', '지식']];
routes['POST /api/admin/reclaim'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 4096), row = dbx.q.playerByKey.get(nameKey(String(b.name || '')));
  if (!row) return fail(req, res, 404, '없는 학생입니다');
  const P = loadPlayer(row.id, nowSec()); if (!P) return fail(req, res, 404, '학생 정보를 찾을 수 없습니다');
  const want = b.res || {}, took = {}, short = {};
  RECLAIM.forEach(([k]) => { const v = Math.floor(Math.max(0, Math.min(1e12, Number(want[k]) || 0))); if (!v) return; const have = Math.floor(P.res[k] || 0), t = Math.min(v, have); P.res[k] = (P.res[k] || 0) - t; took[k] = t; if (t < v) short[k] = v - t; });
  if (!Object.keys(took).length) return fail(req, res, 400, '회수할 양 입력 필요');
  const txt = RECLAIM.filter(([k]) => took[k]).map(([k, n]) => n + ' ' + R.fmt(took[k])).join(' · '), why = String(b.reason || '').trim().slice(0, 80);
  if (txt) R.log(P, nowSec(), '운영진이 ' + R.josa(txt, '을', '를') + ' 회수했습니다' + (why ? ' (' + why + ')' : ''), 'news');
  store.markDirty(row.id); oplog('admin', '관리자', 'reclaim', row.name + ' · ' + (txt || '없음') + (why ? ' · ' + why : '')); pevent(row.id, 'op', '자원 회수 · ' + (txt || '없음') + (why ? ' · ' + why : ''));
  send(req, res, 200, { ok: true, name: row.name, took, short, res: RECLAIM.reduce((o, [k]) => { o[k] = Math.floor(P.res[k] || 0); return o; }, {}) });
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
  const from = kstDay(Math.floor(Date.now() / 1000) - (days - 1) * 86400) * 100, rows = dbx.q.growthFrom.all(from);
  const cols = ['d', 'h', 'house', 'cls', 'lvl', 'power', 'grade', 'stage', 'ctM', 'ctK', 'cup', 'act'].concat(GROWTH_ST, GROWTH_GEAR), anon = (id) => crypto.createHash('sha256').update('growth:' + id).digest('hex').slice(0, 10);
  const parsed = rows.map((r) => { let o = {}; try { o = JSON.parse(r.data); } catch (e) { } return o; });
  parsed.forEach((o) => { for (const k in o) if (cols.indexOf(k) < 0) cols.push(k); });   // 새로 늘어난 항목(c_ · st_ · res_ 등)도 열로
  const lines = [['date', 'student'].concat(cols).join(',')];
  rows.forEach((r, i) => { const o = parsed[i]; lines.push([growthSlotText(r.day), anon(r.pid)].concat(cols.map((k) => o[k] == null ? '' : String(o[k]).replace(/[,\n]/g, ' '))).join(',')); });
  send(req, res, 200, { csv: lines.join('\n'), rows: rows.length, days: dbx.q.growthDays.all().slice(0, days * 2) });
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
      gRankCache.at = 0; dbx.tx(() => { dbx.q.gDelMembers.run(gid); dbx.q.gDelete.run(gid); dbx.q.gAppDelGuild.run(gid); dbx.q.giDelGuild.run(gid); dbx.q.gsDelGuild.run(gid); dbx.q.glDelGuild.run(gid); dbx.q.ginvDelGuild.run(gid); });
      guildOf.delete(oldId); guildRole.delete(oldId); guildLv.delete(gid); chat.dropGuild(gid);
    } else { gLeave(oldId); gSys(gid, row.name + ' 님이 동아리에서 나갔습니다.'); gLog(gid, row.name + ' 님 탈퇴(캐릭터 초기화)'); }
    if (g) gRankCache.at = 0;
  }
  const P0 = R.newPlayer(newId, '새 학생', row.house, now, crypto.randomInt(1, 2147483647)); P0.needCreate = 1;
  let mkGone = [];
  dbx.tx(() => {
    const D = (sql, ...a) => dbx.db.prepare(sql).run(...a);
    D('DELETE FROM friends WHERE pid = ? OR fid = ?', oldId, oldId);
    D('DELETE FROM relations WHERE a = ? OR b = ?', oldId, oldId);
    D('DELETE FROM party_invites WHERE pid = ?', oldId);
    D('DELETE FROM guild_apps WHERE pid = ?', oldId);
    D('DELETE FROM guild_invites WHERE pid = ?', oldId);
    mkGone = dbx.db.prepare(`SELECT id, name, bid, bidder FROM market WHERE seller = ? AND status = 'open' AND auc = 1 AND bidder != ''`).all(oldId);   // 입찰금은 돌려준다 (아래)
    D("DELETE FROM market WHERE seller = ? AND status = 'open'", oldId);
    D("UPDATE market SET bid = 0, bidder = '', bidder_name = '', bids = 0 WHERE status = 'open' AND auc = 1 AND bidder = ?", oldId);
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
  mkGone.forEach((r) => mkRefund(r.bidder, r.bid, r.name, '판매자의 캐릭터가 초기화되어 경매가 취소되어'));
  if (adminIds.has(oldId)) { adminIds.delete(oldId); adminIds.add(newId); }
  if (chiefIds.has(oldId)) { chiefIds.delete(oldId); chiefIds.add(newId); }
  for (const [k, v] of sessionCache) if (v.pid === oldId) sessionCache.delete(k);
  store.drop(oldId); chat.kick(oldId);
  oplog('admin', '관리자', 'reset', row.name + ' 캐릭터 초기화');
  try { dbx.q.peMove.run(newId, oldId); } catch (e) { }   // 계정 기록은 새 캐릭터로 이어진다
  pevent(newId, 'op', '캐릭터 초기화 (이전 이름 ' + row.name + ')');
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
// 운영실: 학생 계정 기록 — 계정 상태 · 보유 자원 · 접속(기기 · 접속지) · 같은 접속지 학생 · 거래 상대 · 판매 · 신고 · 운영 조치 · 성장 추이
const PE_NAME = { join: '가입', login: '로그인', loginfail: '로그인 실패', visit: '접속', findid: '아이디 찾기', pw: '비밀번호 변경', rename: '이름 변경', mail: '우편 수령', op: '운영 조치' };
function acctRecord(pid, P) {
  const real = Math.floor(Date.now() / 1000), ipTag = (h) => h ? h.slice(0, 6) : '';
  const m = dbx.db.prepare('SELECT created, last_seen, banned, muted_until, role, invite, guest, pw_temp FROM players WHERE id = ?').get(pid) || {};
  const tg = guildOf.get(pid), tgr = tg && dbx.q.gGet.get(tg);
  const ev = dbx.q.peList.all(pid, 120), cnt = {}; dbx.q.peCount.all(pid).forEach((r) => { cnt[r.kind] = { n: Number(r.n), last: r.last }; });
  const ips = new Set(ev.filter((e) => e.ip).map((e) => e.ip)), devs = {}; ev.forEach((e) => { if (e.dev) devs[e.dev] = (devs[e.dev] || 0) + 1; });
  const since = real - 30 * 86400, same = dbx.q.peSameIp.all(since, pid, pid, since).map((r) => ({ name: r.name, banned: !!r.banned, deleted: !!r.deleted, ips: Number(r.ips), last: r.last }));
  // 거래소 거래 상대 (산 것 · 판 것 모두, 최근 500건). 같은 접속지 학생과의 거래는 화면에서 강조한다
  const trades = dbx.db.prepare(`SELECT seller, buyer, kind, name, qty, price, done_at FROM market WHERE status = 'sold' AND (seller = ? OR buyer = ?) ORDER BY done_at DESC LIMIT 500`).all(pid, pid);
  const pmap = new Map(); trades.forEach((r) => { const other = r.seller === pid ? r.buyer : r.seller; if (!other) return; const o = pmap.get(other) || { buy: 0, sell: 0, paid: 0, got: 0, last: 0 }; if (r.seller === pid) { o.sell++; o.got += r.price; } else { o.buy++; o.paid += r.price; } o.last = Math.max(o.last, r.done_at); pmap.set(other, o); });
  const nameOf = (id) => { const r = dbx.q.getProfile.get(id); return r ? r.name : '(없는 학생)'; }, sameSet = new Set(same.map((x) => x.name));
  const partners = [...pmap.entries()].map(([id, o]) => Object.assign({ name: nameOf(id) }, o)).map((o) => Object.assign(o, { same: sameSet.has(o.name) })).sort((a, b) => (b.paid + b.got) - (a.paid + a.got)).slice(0, 15);
  const sold = trades.filter((r) => r.seller === pid).slice(0, 40).map((r) => ({ t: r.done_at, name: r.name, kind: r.kind, qty: r.qty, price: r.price, to: r.buyer ? nameOf(r.buyer) : '' }));
  // 신고: 이 학생의 메시지가 받은 신고 · 이 학생이 한 신고
  const against = dbx.db.prepare(`SELECT r.t, r.reason, r.resolved, c.text, c.ch, p.name AS reporter FROM reports r JOIN chat c ON c.id = r.msg_id LEFT JOIN players p ON p.id = r.reporter WHERE c.pid = ? ORDER BY r.id DESC LIMIT 10`).all(pid).map((r) => ({ t: r.t, reason: sec.dec(r.reason), text: String(sec.dec(r.text) || '').slice(0, 120), resolved: !!r.resolved, by: r.reporter || '' }));
  const nAgainst = Number((dbx.db.prepare(`SELECT COUNT(*) AS n FROM reports r JOIN chat c ON c.id = r.msg_id WHERE c.pid = ?`).get(pid) || {}).n || 0), nBy = Number((dbx.db.prepare(`SELECT COUNT(*) AS n FROM reports WHERE reporter = ?`).get(pid) || {}).n || 0);
  // 운영 조치 (운영 로그에서 지금 이름 · 예전 이름으로 시작하는 줄 · 카드 · 기록 열람은 빼고)
  const names = [P.name].concat(ev.filter((e) => e.kind === 'rename').map((e) => String(e.detail).split(' → ')[0]), ev.map((e) => (/이전 이름 (.+)\)$/.exec(e.detail) || [])[1])).filter((n, i, a) => n && n !== '새 학생' && a.indexOf(n) === i);
  const ops = []; names.forEach((n) => dbx.db.prepare(`SELECT t, action, detail FROM oplog WHERE detail LIKE ? ESCAPE '\\' AND action NOT IN ('pcard', 'plog') ORDER BY id DESC LIMIT 30`).all(n.replace(/[\\%_]/g, '\\$&') + ' %').forEach((r) => { if (!ops.some((o) => o.t === r.t && o.detail === r.detail)) ops.push(r); }));
  ops.sort((a, b) => b.t - a.t);
  // 성장 추이: 12시간 기록 최근 14일 (갑자기 크게 늘어난 구간 확인용)
  const trend = dbx.db.prepare(`SELECT day, data FROM growth WHERE pid = ? ORDER BY (CASE WHEN day < 1000000000 THEN day * 100 ELSE day END) DESC LIMIT 28`).all(pid).map((r) => { let o = {}; try { o = JSON.parse(r.data); } catch (e) { } return { slot: growthSlotText(r.day), lvl: o.lvl, power: o.power, grade: o.grade, stage: o.stage, gold: o.goldTotal, kills: o.kills, exp: o.expJobs, epic: o.epicFound, legend: o.legendFound, enh: o.maxEnh, gearLv: o.gearLv }; });
  const res = {}; Object.keys(P.res || {}).forEach((k) => { if (typeof P.res[k] === 'number') res[k] = Math.floor(P.res[k]); });
  return {
    created: m.created, seen: m.last_seen, online: isOnline(pid), banned: !!m.banned, muted: m.muted_until > real ? m.muted_until : 0, guest: !!m.guest, pwTemp: !!m.pw_temp,
    role: m.role === 'chief' ? '학생회장' : m.role === 'admin' ? '학생회' : '', invite: m.invite || '', guild: tgr ? tgr.name : '', nameAt: P.nameAt || 0,
    res, mats: Object.keys(P.mats || {}).reduce((a, k) => a + (Number(P.mats[k]) || 0), 0), inv: (P.inv || []).length,
    cnt, ipN: ips.size, devs, events: ev.map((e) => ({ t: e.t, kind: e.kind, k: PE_NAME[e.kind] || e.kind, detail: e.detail, ip: ipTag(e.ip), dev: e.dev })),
    same, partners, sold, reports: { against, nAgainst, nBy }, ops: ops.slice(0, 40), trend
  };
}
// 운영실: 학생 활동 기록 (게임 안 기록 최근 50줄 · 같은 일이 이어지면 횟수로 묶임) 과 영웅 · 전설 장비 보유 현황
routes['POST /api/admin/plog'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 1024), nm = String(b.name || '').trim(), row = nm ? dbx.q.playerByKey.get(nameKey(nm)) : null;
  if (!row) return fail(req, res, 404, nm ? '없는 학생 이름입니다' : '학생 이름 입력 필요');
  const P = store.get(row.id); if (!P) return fail(req, res, 404, '학생 정보를 찾을 수 없습니다');
  const items = (P.inv || []).map((it) => ({ it, at: '가방' })).concat(Object.keys(P.eq || {}).filter((k) => P.eq[k]).map((k) => ({ it: P.eq[k], at: '장착' })));
  const high = items.filter((x) => x.it.r >= 3).map((x) => ({ name: x.it.name + (x.it.enh ? ' +' + x.it.enh : ''), r: x.it.r, ilvl: x.it.ilvl, at: x.at }));
  // 장비 · 능력치 전체 (운영실은 학생의 공개 범위 설정과 관계없이 확인)
  const n2 = (v, d) => Math.round((Number(v) || 0) * Math.pow(10, d || 0)) / Math.pow(10, d || 0);
  let card = null; try {
    const now = nowSec(), c = R.calc(P, world.ctx(now), Math.min(now, P.at)), st = {}, sg = {};
    R.STATS.forEach((k) => { st[k] = n2(c.stat[k], 1); sg[k] = n2(c.statGear[k], 1); });
    const bon = {}; for (const k in c.b) if (typeof c.b[k] === 'number' && c.b[k]) bon[k] = n2(c.b[k], 4);
    const eq = Object.keys(P.eq || {}).filter((k) => P.eq[k]).map((k) => { const it = P.eq[k], is = R.itemStats(it), ist = {}; for (const x in is) ist[x] = n2(is[x], 4);
      return { slot: k, name: it.name, r: it.r, ilvl: it.ilvl, enh: it.enh || 0, q: it.q, wk: it.wk || '', aff: it.aff || [], eng: it.eng || null, stats: ist }; });
    const keyNm = Object.assign({}, R.D.BONUS_NAMES, R.D.STAT_NAMES); R.D.ENGRAVES.forEach((e) => { keyNm['eng:' + e.id] = e.name; });   // 운영실 화면이 효과 키 대신 이름을 보이도록
    card = { cls: P.cls, lvl: P.lvl, grade: P.grade, maxStage: P.maxStage, power: c.power, st, sg, bon, nm: keyNm,
      fight: { atk: n2(c.atk), patk: n2(c.patk), matk: n2(c.matk), hp: n2(c.hp), def: n2(c.def), aps: n2(c.aps, 2), critC: n2(c.critC, 3), critD: n2(c.critD, 2), spell: n2(c.spell, 3), skill: n2(c.skill, 3), dps: n2(c.dps), spellDps: n2(c.spellDps), famDps: n2(c.famDps), totalDps: n2(c.totalDps) },
      eq, subj: Object.keys(P.subj || {}).map((k) => (R.SUBJ[k] ? R.SUBJ[k].name : k) + ' ' + P.subj[k].lv).join(' · '),
      rs: Object.keys(P.rs || {}).filter((k) => P.rs[k] && R.RES[k]).map((k) => R.RES[k].name + ' ' + P.rs[k]).join(' · '),
      spells: (P.spells || []).filter(Boolean).map((k) => (R.SPELL[k] ? R.SPELL[k].name : k)).join(' · '),
      fam: P.fam && P.fam.act && P.fam.own[P.fam.act] ? (R.FAM[P.fam.act] ? R.FAM[P.fam.act].name : P.fam.act) + ' Lv ' + (P.fam.own[P.fam.act].lv || 1) : '' };
  } catch (e) { log('운영실 학생 카드 계산 실패', e); }
  oplog('admin', '관리자', 'plog', row.name + ' 활동 기록 확인');
  const RN = ['일반', '고급', '희귀', '영웅', '전설'];
  const dlog = (P.dlog || []).slice(0, 80).map((d) => ({ t: d.t, a: d.a, n: d.n, x: d.x || '', it: d.it || '', lv: d.lv, by: (d.rc || []).map((c, i) => c ? RN[i] + ' ' + c : '').filter(Boolean).join(' · '), keep: (d.keep || []).map((it) => itemOut(it)) }));
  // 거래소 · 떠돌이 상인에서 산 장비 (옵션 그대로 남아 있어 재지급에 쓸 수 있다). have = 지금도 가지고 있는지
  const owned = new Set((P.inv || []).map((x) => x.u).concat(Object.keys(P.eq || {}).map((k) => P.eq[k] && P.eq[k].u)).filter(Boolean));
  const bought = [];
  dbx.db.prepare(`SELECT data, price, done_at, COALESCE((SELECT name FROM players WHERE id = market.seller), seller_name) AS sname FROM market WHERE buyer = ? AND status = 'sold' AND kind = 'item' ORDER BY done_at DESC LIMIT 40`).all(row.id).forEach((r) => { try { const it = JSON.parse(r.data); bought.push(itemOut(it, { t: r.done_at, price: r.price, from: '거래소 · ' + (r.sname || ''), have: owned.has(it.u) })); } catch (e) { } });
  try { dbx.db.prepare(`SELECT item, price, ends FROM auction WHERE bidder = ? AND done = 1 ORDER BY ends DESC LIMIT 20`).all(row.id).forEach((r) => { try { const it = JSON.parse(r.item); bought.push(itemOut(it, { t: r.ends, price: r.price, from: '떠돌이 상인', have: null })); } catch (e) { } }); } catch (e) { }
  bought.sort((x, y) => y.t - x.t);
  const auto = P.rs && P.rs.sorter ? { on: P.autoSell >= 0, upto: P.autoSell >= 0 ? RN[P.autoSell] + ' 이하' : '꺼짐', mode: P.autoDis ? '분해' : '판매' } : null;
  let acct = null; try { acct = acctRecord(row.id, P); } catch (e) { log('운영실 계정 기록 실패', e); }
  send(req, res, 200, { name: row.name, acct, card, dlog, auto, bought, log: (P.log || []).slice(0, 50).map((l) => ({ t: l.t, m: l.m, k: l.k, n: l.n || 1 })), glog: (P.glog || []).slice(0, 100), high, st: { expJobs: P.st.expJobs || 0, epicFound: P.st.epicFound || 0, legendFound: P.st.legendFound || 0 } });
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
  oplog('admin', '관리자', 'resetpw', row.name + ' 임시 비밀번호 발급'); pevent(row.id, 'op', '임시 비밀번호 발급');
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
  oplog('admin', '관리자', 'setlogin', row.name + ' 아이디 새로 정함'); pevent(row.id, 'op', '아이디 새로 정함');
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
/* ───────── 시즌 초기화 (운영실) ─────────
   점검 중에만. 먼저 백업하고(실패하면 중단) 모든 학생을 「새 학생 만들기」 상태로 되돌린다.
   남기는 것: 계정(아이디 · 비밀번호 · 운영 등급), 학생 이름(같은 계정만 다시 사용 가능), 프로필, 초대코드, 운영 기록, 신고된 채팅, 운영진 1:1.
   지우는 것: 친구 · 동아리 · 파티 · 게시판 · 1:1 대화 · 거래소 · 경매 · 우편 · 탑 · 주간 기록 · 성장 기록 · 월드 보스 · 소식.
   끝나면 서버를 내려 systemd가 다시 켠다(메모리의 동아리 · 파티 · 채팅 캐시를 비우기 위해). */
const SEASON_WIPE = ['auction', 'board_comments', 'board_posts', 'friends', 'growth', 'guild_apps', 'guild_invites', 'guild_items', 'guild_log', 'guild_members', 'guild_stock', 'guilds', 'mail', 'mail_state', 'market', 'market_bids', 'notes', 'parties', 'party_members', 'party_invites', 'tower', 'tower_rank', 'weekly'];
const SEASON_KV = ['boss', 'results', 'news', 'hbase', 'exprooms', 'growthSlot', 'ritual', 'profline'];
let SEASON_RESETTING = false;
routes['POST /api/admin/season-reset'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 1024), tag = String(b.legacy || 'gen1').replace(/[^a-z0-9]/g, '').slice(0, 12) || 'gen1';
  if (!MAINT.on) return fail(req, res, 400, '점검을 먼저 시작해야 합니다');
  if (String(b.confirm || '') !== '시즌 초기화') return fail(req, res, 400, '확인 문구가 맞지 않습니다');
  if (SEASON_RESETTING) return fail(req, res, 409, '이미 진행 중입니다');
  SEASON_RESETTING = true;
  let file;
  try { file = backup(); } catch (e) { SEASON_RESETTING = false; log('시즌 초기화 전 백업 실패', e); return fail(req, res, 500, '백업에 실패하여 중단했습니다'); }
  const now = nowSec(), have = new Set(dbx.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  let n = 0, tagged = 0;
  try {
    timers.forEach((t) => clearInterval(t));   // 다시 켤 때까지 월드 · 거래소 · 저장 타이머가 지운 기록을 다시 쓰지 않게
    try { chat.closeAll(); } catch (e) { }   // 쌓인 채팅 글을 먼저 기록한 뒤 지운다
    store.clearAll();
    dbx.tx(() => {
      const D = (sql, ...a) => dbx.db.prepare(sql).run(...a);
      SEASON_WIPE.forEach((t) => { if (have.has(t)) D('DELETE FROM ' + t); });
      D("DELETE FROM dm WHERE a != 'staff' AND b != 'staff'");   // 운영진 1:1은 남긴다
      D('DELETE FROM chat WHERE id NOT IN (SELECT msg_id FROM reports)');   // 신고된 글은 남긴다
      SEASON_KV.concat(b.epoch ? ['epoch'] : []).forEach((k) => D('DELETE FROM kv WHERE k = ?', k));
      const up = dbx.db.prepare("UPDATE players SET state = ?, legacy = ?, power = 0, lvl = 1, grade = 1, max_stage = 9, wb_dps = 0, title = '' WHERE id = ?");
      dbx.db.prepare('SELECT id, name, house, state, legacy FROM players WHERE deleted = 0').all().forEach((r) => {
        let old = {}; try { old = JSON.parse(r.state) || {}; } catch (e) { }
        const lg = String(r.legacy || '').split(',').filter(Boolean);
        if (!old.needCreate && lg.indexOf(tag) < 0) { lg.push(tag); tagged++; }   // 캐릭터가 있던 학생에게 기념 표시
        const P = R.newPlayer(r.id, r.name, r.house, now, crypto.randomInt(1, 2147483647));
        P.needCreate = 1; P.seasonNew = 1; P.legacy = lg;
        up.run(JSON.stringify(P), lg.join(','), r.id); n++;
      });
    });
  } catch (e) { log('시즌 초기화 실패', e); send(req, res, 500, { error: '초기화 중 오류가 발생했습니다. 서버를 다시 시작합니다 (백업 ' + file + ')' }); res.on('finish', () => process.exit(1)); return; }
  oplog('admin', '관리자', 'season', `시즌 초기화 · ${n}명 · 기념 표시 ${tagged}명(${tag}) · 백업 ${file}`);
  send(req, res, 200, { ok: true, players: n, tagged, backup: file });
  res.on('finish', () => { log('시즌 초기화 완료: 서버를 다시 시작합니다'); setTimeout(() => process.exit(0), 200); });
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
  const taken = dbx.q.playerByKey.get(nameKey(name)); if (taken && taken.id !== pid) return fail(req, res, 409, '이미 사용 중인 이름입니다');   // 시즌 초기화 뒤에는 자기 이름을 다시 사용할 수 있다
  const now = nowSec(), P = R.newPlayer(pid, name, house, now, crypto.randomInt(1, 2147483647)); R.clsStart(P, cls);
  if (P0.legacy && P0.legacy.length) P.legacy = P0.legacy.slice();
  R.advance(P, world.ctx(now), now); syncOp(P);
  try { dbx.db.prepare('UPDATE players SET name = ?, name_key = ?, house = ?, created = ?, state = ? WHERE id = ?').run(name, nameKey(name), house, Math.floor(now), JSON.stringify(P), pid); }
  catch (e) { return fail(req, res, 409, '이미 사용 중인 이름입니다'); }
  store.drop(pid); store.put(P); store.markDirty(pid);
  log(`다시 입학: ${name} (${house})`); pevent(pid, 'rename', (P0.name || '') + ' → ' + name + ' (다시 입학)', req);
  world.addNews(P.name + ' 학생이 ' + (R.HOUSE[P.house] ? R.HOUSE[P.house].name : '아카데미') + '에 입학했습니다', now);
  headWelcome(P);
  send(req, res, 200, statePayload(P, now));
};
routes['POST /api/admin/ban'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 4096), key = nameKey(String(b.name || '')), row = dbx.q.playerByKey.get(key);
  if (!row) return fail(req, res, 404, '없는 학생입니다');
  dbx.q.setBan.run(b.ban === false ? 0 : 1, key); dbx.q.delSessionsFor.run(row.id); sessionCache.clear(); store.flushAll(); store.drop(row.id); if (b.ban !== false) chat.kick(row.id);
  const why = String(b.reason || '').trim().slice(0, 80), what = (b.ban === false ? '이용 정지 해제' : '이용 정지') + (why ? ' · ' + why : '');
  oplog('admin', '관리자', b.ban === false ? 'unban' : 'ban', row.name + ' ' + what); pevent(row.id, 'op', what);
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
  const why = String(b.reason || '').trim().slice(0, 80), what = (minutes ? '채팅 금지 ' + (minutes >= 1440 ? Math.round(minutes / 1440 * 10) / 10 + '일' : minutes + '분') : '채팅 금지 해제') + (b.purge ? ' · 작성 글 삭제' : '') + (why ? ' · ' + why : '');
  oplog('admin', '관리자', 'mute', ((dbx.q.playerMeta.get(row.id) || {}).name || '') + ' ' + what); pevent(row.id, 'op', what);
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
  const chName = (c) => { const k = c && chat.chOf(c), d = k && chat.CHANNELS[k]; return d ? d.name : String(c || ''); };
  send(req, res, 200, { reports: dbx.q.listReports.all(u.searchParams.get('resolved') === '1' ? 1 : 0, 200).map((r) => Object.assign(r, { text: sec.dec(r.text), reason: sec.dec(r.reason), chName: chName(r.ch) })) });
};
// 운영실: 운영진 1:1. 학생에게 「운영진」 이름으로 1:1을 보내고, 학생 답장을 확인한다 (학생은 운영진이 먼저 말을 건 뒤에만 답할 수 있다)
routes['GET /api/admin/dm/threads'] = (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  send(req, res, 200, { threads: chat.dmThreads('staff').map((t) => { const p = dbx.q.getProfile.get(t.peer); return Object.assign(t, { name: p ? p.name : '(없는 학생)' }); }) });
};
routes['GET /api/admin/dm'] = (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const q = new URL(req.url, 'http://x').searchParams, nm = String(q.get('name') || '').trim(), byName = nm ? dbx.q.playerByKey.get(nameKey(nm)) : null;
  if (nm && !byName) return fail(req, res, 404, '없는 학생 이름입니다');
  const peer = byName ? byName.id : q.get('peer') || ''; if (!/^[A-Za-z0-9_-]{4,40}$/.test(peer)) return fail(req, res, 400, '대화 상대가 없습니다');
  const p = dbx.q.getProfile.get(peer); send(req, res, 200, { peer, name: p ? p.name : '', msgs: chat.dmHistory('staff', peer, null, 100) });
};
routes['POST /api/admin/dm'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 4096), nm = String(b.name || '').trim();
  const row = b.pid ? dbx.q.getProfile.get(String(b.pid)) : nm ? dbx.q.playerByKey.get(nameKey(nm)) : null;
  if (!row || row.deleted) return fail(req, res, 404, '없는 학생입니다');
  try { const m = chat.staffDm(row.id, b.text, Date.now() / 1000); oplog('admin', '관리자', 'staffdm', row.name + ' 님에게 운영진 1:1'); send(req, res, 200, { ok: true, id: m.id, peer: row.id, name: row.name }); }
  catch (e) { fail(req, res, 400, e.message); }
};
// 운영실: 신고된 메시지의 앞뒤 대화 (같은 채널 · 같은 방, 앞 10건 · 뒤 10건, 지운 메시지 포함)
routes['GET /api/admin/reports/ctx'] = (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const id = Number(new URL(req.url, 'http://x').searchParams.get('id')) | 0, m = id && dbx.q.getChat.get(id);
  if (!m) return fail(req, res, 404, '없는 메시지입니다 (오래되어 지워졌을 수 있습니다)');
  const cols = 'SELECT id, t, pid, name, kind, text, deleted FROM chat WHERE ch = ? AND id ';
  const rows = dbx.db.prepare(cols + '< ? ORDER BY id DESC LIMIT 10').all(m.ch, id).reverse().concat([m], dbx.db.prepare(cols + '> ? ORDER BY id LIMIT 10').all(m.ch, id));
  oplog('admin', '관리자', 'reportctx', '신고 #' + id + ' 앞뒤 대화 확인');
  send(req, res, 200, { id, list: rows.map((r) => { let tx = ''; try { tx = sec.dec(r.text); } catch (e) { } return { id: r.id, t: r.t, name: r.name, kind: r.kind, text: tx, deleted: !!r.deleted, me: r.id === id }; }) });
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
  const detail = [], cupCat = {}, curWk = R.weekId(nowSec());   // cupCat: 기숙사별 이번 주 점수 출처 (활동별 합계 · 특기 1.3배로 더 받은 몫)
  db.prepare('SELECT id, house, grade, state FROM players WHERE banned = 0 AND guest = 0 AND last_seen >= ? LIMIT 5000').all(now - 7 * 86400).forEach((r) => {
    try {
      const P = store.peek(r.id) || (() => { const x = JSON.parse(r.state); R.fixState(x); return x; })();
      const c = R.calc(P, world.ctx(nowSec()), Math.min(nowSec(), P.at || nowSec())), st = P.st || {};
      if (P.wk && P.wk.id === curWk && P.wk.cup > 0) {
        const h = cupCat[r.house] || (cupCat[r.house] = { n: 0, sum: {}, specExtra: 0 }), sp = R.CUP_SPEC[r.house], cat = P.wk.cat || {}; h.n++;
        const pre = P.wk.cup - Object.keys(cat).reduce((a, k) => a + cat[k], 0); if (pre > 0.5) h.sum.before = Math.round((h.sum.before || 0) + pre);   // 나눠 적기 전에 쌓인 몫
        for (const k in cat) { const v = cat[k]; h.sum[k] = Math.round((h.sum[k] || 0) + v); if (sp && sp.cats.indexOf(k) >= 0) h.specExtra = Math.round(h.specExtra + v * (1 - 1 / R.CUP_SPEC_MULT)); }
      }
      detail.push({ cls: P.cls === 'knight' ? 'knight' : 'mage', grade: P.grade, house: r.house, dps: c.totalDps, basic: c.dps, spell: c.spellDps, fam: c.famDps, spellShare: c.totalDps > 0 ? c.spellDps / c.totalDps : 0,
        patk: c.patk, matk: c.matk, hp: c.hp, def: c.def, critC: c.critC, aps: c.aps, power: c.power, lvl: P.lvl, twK: st.twK || 0, twM: st.twM || 0, tw: R.twBest(P, nowSec()),
        critD: c.critD, drop: c.drop, rarity: c.rarity, spellMul: c.spell, skillMul: c.skill, lecSpd: c.lecSpd, goldMul: c.gold, xpMul: c.xp, knowMul: c.know, manaH: c.mana * 3600,
        legend: st.legendFound || 0, epic: st.epicFound || 0, maxEnh: st.maxEnh || 0, kills: st.kills || 0, expJobs: st.expJobs || 0 });
    } catch (e) { }
  });
  const KEYS = ['dps', 'basic', 'spell', 'fam', 'spellShare', 'patk', 'matk', 'hp', 'def', 'critC', 'critD', 'aps', 'power', 'lvl', 'drop', 'rarity', 'spellMul', 'skillMul', 'lecSpd', 'goldMul', 'xpMul', 'knowMul', 'manaH', 'legend', 'epic', 'maxEnh', 'kills', 'expJobs'];
  const group = (key) => { const g = {}; detail.forEach((d) => { (g[d[key]] = g[d[key]] || []).push(d); }); const o = {}; for (const k in g) { o[k] = { n: g[k].length }; KEYS.forEach((f) => { o[k][f] = pct(g[k].map((d) => d[f])); }); } return o; };
  const all = { n: detail.length }; KEYS.forEach((f) => { all[f] = pct(detail.map((d) => d[f])); });
  const clsGrade = {}; detail.forEach((d) => { const k = d.cls + ':' + d.grade; (clsGrade[k] = clsGrade[k] || []).push(d); }); const cg = {}; for (const k in clsGrade) { cg[k] = { n: clsGrade[k].length }; ['dps', 'hp', 'power', 'drop', 'rarity', 'legend', 'epic'].forEach((f) => { cg[k][f] = pct(clsGrade[k].map((d) => d[f])); }); }
  const towers = { infKnight: pct(detail.filter((d) => d.twK > 0).map((d) => d.twK)), infMage: pct(detail.filter((d) => d.twM > 0).map((d) => d.twM)), starTowerWeek: pct(detail.filter((d) => d.tw > 0).map((d) => d.tw)) };   // 별의 탑 이번 주 개인 기록
  oplog('admin', '관리자', 'dist', '분포 통계 복사');
  send(req, res, 200, { at: now, week: wk, students: { all: players.length, active7d: act.length, gradeActive7d: grades }, fightActive7d: fight(act), fightAll: fight(players), weekly: cup, cupSource: { note: '이번 주 점수 출처(특기 1.3배 포함 합계). before=나눠 적기 전(배포 전)에 쌓인 몫, kill=원정 처치, exam=진급 시험, etc=그 밖', byHouse: cupCat },
    detailActive7d: { note: 'dps=초당 피해 합계(basic 평타 + spell 주문 + fam 사역마), spellShare=주문 비중, patk/matk=물리/주문 공격력, critC/critD=치명타 확률/피해, aps=초당 공격 횟수, drop=전리품 배율(1=기본), rarity=장비 등급 상승, spellMul/skillMul=주문/기술 위력 배율, lecSpd=수업 효율, goldMul/xpMul/knowMul=아르크/경험치/지식 배율, manaH=시간당 마나, legend/epic=누적 전설/영웅 획득, maxEnh=최고 강화, kills=누적 처치, expJobs=원정 횟수', all, byCls: group('cls'), byGrade: group('grade'), byClsGrade: cg }, towers });
};
routes['GET /api/admin/ideas'] = (req, res) => { if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다'); send(req, res, 200, { text: board.exportIdeas() }); };
routes['GET /api/admin/sys'] = (req, res) => { if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다'); send(req, res, 200, { build: BUILD, maint: MAINT, pin: pinList()[0] || null, pins: pinList(), epoch: world.W.epoch, cal: R.calendar(world.W, nowSec()) }); };
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
// 운영실: 장비 옵션 한 줄 (옵션 · 각인 · 품질) · 재지급용 장비 정보
function itemOptText(it) { const D = R.D, f = (k, v) => (D.STAT_NAMES[k] || D.BONUS_NAMES[k] || k) + ' +' + (D.STAT_NAMES[k] ? Math.round(v * 10) / 10 : Math.round(v * 1000) / 10 + '%');
  return (it.aff || []).map((a) => f(a.id, a.v)).concat(it.eng ? [((D.ENGRAVES.find((e) => e.id === it.eng.id) || {}).name || it.eng.id) + ' ' + (it.eng.id === 'killMana' ? it.eng.v : Math.round(it.eng.v * 1000) / 10 + '%')] : []).join(' · ') + ' · 품질 ' + Math.round((it.q || 1) * 1000) / 10 + '%'; }
function itemOut(it, extra) { const RN = ['일반', '고급', '희귀', '영웅', '전설'], item = Object.assign({}, it); delete item.u; delete item.lock;
  return Object.assign({ name: it.name + (it.enh ? ' +' + it.enh : ''), r: it.r, rn: RN[it.r], ilvl: it.ilvl, slot: R.slotName(it), opt: itemOptText(it), dy: R.dismantleYield(it), item }, extra || {}); }
// 운영실: 백업과 비교 — 백업 시점의 학생 장비(가방 · 장착)와 지금을 장비 고유번호로 비교한다. 백업은 서버 안에서만 풀고 바로 지운다
const bkDir = () => path.join(cfg.dataDir, 'backups'), BK_RE = /^moneta-\d{10}\.db(\.enc)?$/;
routes['GET /api/admin/backups'] = (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  let files = []; try { files = fs.readdirSync(bkDir()).filter((f) => BK_RE.test(f)).sort().reverse().map((f) => { const st = fs.statSync(path.join(bkDir(), f)); return { file: f, t: Math.floor(st.mtimeMs / 1000), size: st.size }; }); } catch (e) { }
  send(req, res, 200, { files });
};
function bkReadPlayer(file, pid) {
  const src = path.join(bkDir(), file), tmp = path.join(bkDir(), '.cmp-' + crypto.randomBytes(6).toString('hex') + '.db');
  try {
    let buf = fs.readFileSync(src);
    if (file.endsWith('.enc')) {
      if (!cfg.backupKey) throw new Error('백업 키가 없어 암호화된 백업을 열 수 없습니다');
      if (buf.slice(0, 5).toString() !== 'ARCB1') throw new Error('백업 형식이 아닙니다');
      const salt = buf.slice(5, 21), iv = buf.slice(21, 33), tag = buf.slice(33, 49);
      const key = crypto.scryptSync(cfg.backupKey, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 }), d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
      buf = Buffer.concat([d.update(buf.slice(49)), d.final()]);
    }
    fs.writeFileSync(tmp, buf, { mode: 0o600 }); buf = null;
    const { DatabaseSync } = require('node:sqlite'), db = new DatabaseSync(tmp, { readOnly: true });
    try { const row = db.prepare('SELECT state FROM players WHERE id = ?').get(pid); return row ? JSON.parse(row.state) : null; } finally { db.close(); }
  } finally { try { fs.unlinkSync(tmp); } catch (e) { } }
}
routes['POST /api/admin/bkcompare'] = async (req, res) => {
  if (!admin(req)) return fail(req, res, 403, '관리자 토큰이 필요합니다');
  const b = await readJson(req, 1024), nm = String(b.name || '').trim(), file = String(b.file || '');
  if (!BK_RE.test(file) || !fs.existsSync(path.join(bkDir(), file))) return fail(req, res, 404, '없는 백업입니다');
  const row = nm ? dbx.q.playerByKey.get(nameKey(nm)) : null; if (!row) return fail(req, res, 404, nm ? '없는 학생 이름입니다' : '학생 이름 입력 필요');
  const P = store.get(row.id); if (!P) return fail(req, res, 404, '학생 정보를 찾을 수 없습니다');
  let O; try { O = bkReadPlayer(file, row.id); } catch (e) { return fail(req, res, 400, e.message || '백업을 열지 못했습니다'); }
  if (!O) return fail(req, res, 404, '이 백업에는 해당 학생이 없습니다 (백업 뒤에 입학)');
  const RN = ['일반', '고급', '희귀', '영웅', '전설'];
  const gear = (S) => { const m = new Map(); (S.inv || []).forEach((it) => it && it.u && m.set(it.u, { it, at: '가방' })); Object.keys(S.eq || {}).forEach((k) => { const it = S.eq[k]; if (it && it.u) m.set(it.u, { it, at: '장착' }); }); (S.mailQ || []).forEach((it) => it && it.u && m.set(it.u, { it, at: '우편 대기' })); return m; };
  const out1 = (x, why) => { const item = Object.assign({}, x.it); delete item.u; delete item.lock;   // 재지급용 (우편으로 그대로 보낼 수 있는 장비 정보)
    return { name: x.it.name + (x.it.enh ? ' +' + x.it.enh : ''), r: x.it.r, rn: RN[x.it.r], ilvl: x.it.ilvl, slot: R.slotName(x.it), at: x.at, lock: !!x.it.lock, why: why || '', opt: itemOptText(x.it), dy: R.dismantleYield(x.it), item }; };
  const then = gear(O), cur = gear(P), bkT = Math.floor(fs.statSync(path.join(bkDir(), file)).mtimeMs / 1000);
  const open = dbx.db.prepare(`SELECT data FROM market WHERE seller = ? AND status = 'open' AND kind = 'item'`).all(row.id).map((r) => { try { return JSON.parse(r.data); } catch (e) { return null; } }).filter(Boolean);
  const sold = dbx.db.prepare(`SELECT name, rarity, ilvl, price, done_at FROM market WHERE seller = ? AND status = 'sold' AND kind = 'item' AND done_at > ?`).all(row.id, bkT);
  const gone = [];
  then.forEach((x, u) => {
    if (cur.has(u)) return;
    let why = '';
    if (open.some((it) => it.u === u || (it.name === x.it.name && it.ilvl === x.it.ilvl && it.r === x.it.r))) why = '거래소에 올려 둠';
    else { const k = sold.findIndex((s) => s.name === x.it.name && s.ilvl === x.it.ilvl && s.rarity === x.it.r); if (k >= 0) { why = '거래소에서 판매됨'; sold.splice(k, 1); } }
    gone.push(out1(x, why || '분해 · 매점 판매 · 자동 처분 중 하나'));
  });
  const got = []; cur.forEach((x, u) => { if (!then.has(u)) got.push(out1(x)); });
  const rs = (S, k) => Math.floor((S.res && S.res[k]) || 0), stv = (S, k) => (S.st && S.st[k]) || 0;
  oplog('admin', '관리자', 'bkcompare', row.name + ' 백업 비교 (' + file + ')');
  send(req, res, 200, { name: row.name, file, bkT, gone: gone.sort((a, c) => c.r - a.r || c.ilvl - a.ilvl), got: got.sort((a, c) => c.r - a.r || c.ilvl - a.ilvl),
    diff: { stone: rs(P, 'stone') - rs(O, 'stone'), dust: rs(P, 'dust') - rs(O, 'dust'), gold: rs(P, 'gold') - rs(O, 'gold'), dismantled: stv(P, 'dismantled') - stv(O, 'dismantled'), epicFound: stv(P, 'epicFound') - stv(O, 'epicFound'), lvl: (P.lvl || 0) - (O.lvl || 0) },
    auto: P.rs && P.rs.sorter ? { now: P.autoSell >= 0 ? RN[P.autoSell] + ' 이하 · ' + (P.autoDis ? '분해' : '판매') : '꺼짐', then: O.rs && O.rs.sorter ? (O.autoSell >= 0 ? RN[O.autoSell] + ' 이하 · ' + (O.autoDis ? '분해' : '판매') : '꺼짐') : '연구 전' } : null });
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
// 성장 기록 · 장비: 칸마다 장비 레벨 · 등급 · 강화, 휘장, 전투력 구성(장비 몫), 과목 레벨 합, 능력치 분배 (2026-10-21부터 쌓인다)
const GROWTH_SLOTS = ['staff', 'robe', 'hat', 'charm', 'tome'];
const GROWTH_GEAR = [].concat(...GROWTH_SLOTS.map((s) => [s + 'Lv', s + 'R', s + 'Enh'])).concat(['gearLv', 'powNow', 'powNoGear', 'gearPct', 'bdgGem', 'bdgLv', 'bdgQ', 'subjSum']).concat(R.STATS.map((k) => 'al_' + k));
const GROWTH_CALC = ['drop', 'rarity', 'critC', 'critD', 'aps', 'spell', 'skill', 'lecSpd', 'gold', 'xp', 'know', 'manaH', 'manaCapH', 'brewSpd', 'hatchSpd', 'bossDmg', 'cdr', 'killMana', 'leech', 'examBonus', 'dps', 'spellDps', 'famDps', 'hp', 'def', 'patk', 'matk'];
const GROWTH_RES = ['gold', 'mana', 'know', 'shard', 'stone', 'dust'];
function growthGear(P, now) {
  const o = {}, eq = P.eq || {}; let sum = 0, n = 0;
  GROWTH_SLOTS.forEach((s) => { const it = eq[s]; if (it) { o[s + 'Lv'] = it.ilvl; o[s + 'R'] = it.r; o[s + 'Enh'] = it.enh || 0; sum += it.ilvl; n++; } });
  o.gearLv = n ? Math.round(sum / n * 10) / 10 : 0;
  try {   // 장비 몫: 장비를 모두 뺀 전투력과 비교 (P를 건드리지 않게 얕은 복사)
    const W = world.ctx(now), t = Math.min(now, P.at || now), full = R.calc(P, W, t).power, bare = R.calc(Object.assign({}, P, { eq: {} }), W, t).power;
    o.powNow = Math.round(full); o.powNoGear = Math.round(bare); o.gearPct = full > 0 ? Math.round((1 - bare / full) * 1000) / 10 : 0;
    const c = R.calc(P, W, t), r4 = (v) => Math.round((v || 0) * 10000) / 10000;   // 전리품 · 등급 상승 · 각종 배율 (물약 · 날씨 포함 그 순간 값)
    GROWTH_CALC.forEach((k) => { o['c_' + k] = k === 'manaH' ? Math.round(c.mana * 3600) : k === 'manaCapH' ? Math.round(c.manaCap / Math.max(1e-9, c.mana) / 360) / 10 : r4(c[k]); });
  } catch (e) { }
  const bw = R.badgeWorn(P); if (bw) { o.bdgGem = bw.gem; o.bdgLv = bw.lv; o.bdgQ = Math.round((bw.q || 1) * 1000) / 1000; }
  o.subjSum = Object.keys(P.subj || {}).reduce((a, k) => a + ((P.subj[k] || {}).lv || 0), 0);
  R.STATS.forEach((k) => { o['al_' + k] = (P.alloc || {})[k] || 0; });
  return o;
}
const GROWTH_ST = ['kills', 'lecHours', 'lecJobs', 'expJobs', 'bosses', 'bossTries', 'researchDone', 'brews', 'dispatches', 'tasksDone', 'duelWins', 'wbAttacks', 'goldTotal', 'manaTotal', 'famKinds', 'epicFound', 'legendFound', 'maxEnh'];
// 성장 기록 칸: 한국 날짜 + 0시 / 12시 구간 (YYYYMMDDHH). 12시간마다 한 번 저장
const growthSlot = (t) => kstDay(t) * 100 + (new Date(t * 1000 + 9 * 3600000).getUTCHours() < 12 ? 0 : 12);
const growthSlotText = (v) => { v = Number(v); if (v < 1e9) v *= 100; const s = String(v); return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) + ' ' + s.slice(8, 10) + '시'; };
function growthSnap(force) {
  const real = Math.floor(Date.now() / 1000), day = growthSlot(real);
  if (!force && dbx.kvGet('growthSlot', 0) === day) return 0;
  const rows = dbx.db.prepare('SELECT id, house, created, last_seen, state, power, lvl, grade FROM players WHERE banned = 0 AND guest = 0 AND deleted = 0').all();
  let n = 0;
  dbx.tx(() => {
    rows.forEach((r) => {
      let P = store.peek(r.id); if (!P) { try { P = JSON.parse(r.state); } catch (e) { return; } }
      const st = P.st || {}, o = { d: Math.floor((real - r.created) / 86400), h: Math.floor((real - r.created) / 3600), house: r.house, cls: P.cls || '', lvl: P.lvl || r.lvl, power: Math.round(r.power), grade: P.grade || r.grade, stage: st.maxStageAll || 0,
        ctM: st.twM || 0, ctK: st.twK || 0, cup: Math.round((P.wk && P.wk.cup) || 0), act: real - r.last_seen < 86400 ? 1 : 0 };
      GROWTH_ST.forEach((k) => { o[k] = Math.round(st[k] || 0); });
      for (const k in st) if (typeof st[k] === 'number' && !(k in o)) o['st_' + k] = Math.round(st[k]);   // 그 밖의 누적 기록 전부
      const rs0 = P.res || {}; GROWTH_RES.forEach((k) => { o['res_' + k] = Math.floor(rs0[k] || 0); });
      o.rsSum = Object.values(P.rs || {}).reduce((a, v) => a + (+v || 0), 0); o.hatched = (P.fam && P.fam.hatched) || 0; o.famN = Object.keys((P.fam && P.fam.own) || {}).length;
      Object.assign(o, growthGear(P, nowSec()));
      dbx.q.growthPut.run(day, r.id, JSON.stringify(o)); n++;
    });
    dbx.kvSet('growthSlot', day);
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
  setInterval(() => { try { mkAucSweep(); } catch (e) { log('거래소 경매 정리 실패', e); } }, 20000),
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
  try { push.saveLast(); } catch (e) { }
  try { dbx.close(); } catch (e) { log('종료 중 오류', e); }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// 한 번만: 별의 탑 층 보상에 마석가루가 들어가기 전(#364)에 받은 이번 주 「별의 탑」 보상 우편의 마석가루를 학생마다 한 통으로 추가 지급
// 본문의 「처음 넘은 a~b층」으로 층 범위를 읽고, 이미 마석가루가 든 우편(패치 뒤)은 건너뛴다. 끝나면 kv 'twDustFix'에 기록 (운영자 승인: 2026-10-23)
function twDustBackfill() {
  if (dbx.kvGet('twDustFix', 0)) return;
  const since = R.weekStart(R.weekId(nowSec())), per = new Map(); let mails = 0;
  dbx.db.prepare("SELECT target, body, rewards FROM mail WHERE sender = '별의 탑' AND deleted = 0 AND target != '*' AND created_g >= ?").all(since).forEach((r) => {
    let rw = {}; try { rw = JSON.parse(r.rewards || '{}'); } catch (e) { } if (rw.dust) return;
    let body = ''; try { body = sec.dec(r.body); } catch (e) { return; }
    const m = /처음 넘은 (\d+)~(\d+)층/.exec(body); if (!m) return;
    const d = R.twRewardSum(+m[1], +m[2]).dust || 0; if (d > 0) { per.set(r.target, (per.get(r.target) || 0) + d); mails++; }
  });
  let total = 0;
  per.forEach((d, pid) => { total += d; sendMail(pid, '별의 탑', '별의 탑 마석가루 추가 지급', '별의 탑 층 보상에 마석가루가 추가되었습니다. 이번 주에 이미 넘은 층의 마석가루를 추가로 지급합니다.', { dust: d }, Math.floor(Date.now() / 1000) + 7 * 86400, true); });
  dbx.kvSet('twDustFix', { at: Math.floor(Date.now() / 1000), students: per.size, mails, dust: total });
  oplog('system', '시스템', 'twDustFix', '별의 탑 마석가루 소급: 학생 ' + per.size + '명 · 우편 ' + mails + '통 기준 · 마석가루 ' + total);
}
try { twDustBackfill(); } catch (e) { log('별의 탑 마석가루 소급 실패', e); }

server.listen(cfg.port, cfg.host, () => {
  log(`모네타 서버 시작: http://${cfg.host}:${cfg.port}  (데이터: ${cfg.dataDir}${cfg.timeScale !== 1 ? ', 시간 배속 ×' + cfg.timeScale : ''})`);
  if (!cfg.adminToken) log('알림: ADMIN_TOKEN이 없어 관리자 API가 꺼져 있습니다');
  log(`가입: 초대코드 ${cfg.inviteRequired ? '필요' : '불필요'}`);
});
module.exports = { server };
