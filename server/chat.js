'use strict';
const zlib = require('zlib');
const crypto = require('crypto');
// 실시간 채팅: 서버가 보내는 이벤트 스트림(SSE)으로 받고, POST로 보낸다.
// 채널: rp(역할극), world(자유 대화), party(파티원끼리만). 서버가 이름·기숙사·학년을 붙이므로 사칭할 수 없다.
// 내용은 DB에 암호화해서 저장한다(메모리의 최근 대화만 평문).

const CHANNELS = {
  rp: { name: 'RP', max: 500 },
  world: { name: '월드', max: 300 },
  party: { name: '파티', max: 500 },
  grp: { name: '동아리 RP', max: 500 },                 // 동아리원끼리 (캐릭터로)
  gooc: { name: '동아리 오너', max: 500 },              // 동아리원끼리 (캐릭터 밖, 오너끼리)
  hrp: { name: '기숙사 RP', max: 500 },                 // 같은 기숙사끼리 (캐릭터로)
  hooc: { name: '기숙사 사담', max: 500 },              // 같은 기숙사끼리 (캐릭터 밖)
  crp: { name: '학과 RP', max: 500 },                   // 같은 학과끼리 (캐릭터로)
  cooc: { name: '학과 사담', max: 500 },                // 같은 학과끼리 (캐릭터 밖)
  notice: { name: '공지', max: 500, readonly: true },   // 운영진·아카데미 알림만
  recruit: { name: '모집', max: 2000, readonly: true },  // 함께 원정 모집 알림 (방에서 「모집 알림」으로만 올라온다)
  dm: { name: '1:1', max: 500 }                         // 친구끼리 (dm 표에 따로 저장)
};
const KEEP_MEM = 80;       // 접속 시 보내는 채널별 최근 대화
const KEEP_DB = 5000;      // DB에 남길 채널별 대화
const MAX_CONN_PER_PLAYER = 3;
const FLUSH_MS = 80;       // 방송은 0.08초마다 모아서 한 번에 쓴다
const LAZY = { world: 1, rp: 1 };   // 지연 로딩 채널: 글 전체는 그 탭을 보고 있는 연결에만, 나머지는 2초마다 글 번호(seq)만
const NONCE_TTL = 120;     // 같은 nonce는 2분 동안 기억
const GAP = 0.5;           // 학생마다 0.5초 안에 다시 보내면 거절

function create(dbx, log, opts) {
  opts = opts || {};
  const sec = opts.sec || { enc: (s) => s, dec: (s) => s };
  const partyOf = opts.partyOf || (() => null);
  const guildOf = opts.guildOf || (() => null);
  const houseOf = opts.houseOf || (() => null);
  const clsOf = opts.clsOf || (() => null);
  const isOp = opts.isOp || (() => false);
  // 월드 슬로우 모드 (운영자가 유사시에 건다). 운영자는 걸리지 않는다.
  const slow = { world: Math.max(0, Math.min(600, (opts.slow && opts.slow.world) | 0)) };
  const lastWorld = new Map();   // pid → 마지막 월드 글 시각
  const GROUP = { party: 1, grp: 1, gooc: 1, hrp: 1, hooc: 1, crp: 1, cooc: 1 };
  // 묶음 종류: 채널 → 묶음(파티 · 동아리 · 기숙사 · 학과)
  const KIND = { party: 'party', grp: 'guild', gooc: 'guild', hrp: 'house', hooc: 'house', crp: 'cls', cooc: 'cls' };
  const OF = { party: partyOf, guild: guildOf, house: houseOf, cls: clsOf };
  const groupOf = (ch, pid) => KIND[ch] ? OF[KIND[ch]](pid) : null;
  const clients = new Set();           // {res, pid, id, cid, watch}
  const byCid = new Map();             // cid → 연결
  const byPid = new Map();             // pid → 연결 수 (친구 접속 표시용)
  const recent = {};                   // 공개 채널 → [msg]
  const partyRecent = new Map();       // 묶음 채널(파티·동아리) DB 이름 → [msg] (필요할 때 DB에서 읽음)
  const lastSent = new Map();          // pid → {t, text, tok, at}
  const nonces = new Map();            // '학생id:nonce' → {id, at} : 렉 때문에 다시 누른 같은 메시지는 한 번만 올린다
  const gzipOn = opts.gzip !== false;
  function seenNonce(pid, n, now) { if (!n) return null; const x = nonces.get(pid + ':' + n); return x && now - x.at < NONCE_TTL ? x.id : null; }
  function keepNonce(pid, n, id, now) { if (!n) return; nonces.set(pid + ':' + n, { id, at: now }); }
  function sweepNonces(now) { nonces.forEach((x, k) => { if (now - x.at >= NONCE_TTL) nonces.delete(k); }); }
  function cleanNonce(n) { n = String(n || ''); return /^[A-Za-z0-9-]{8,64}$/.test(n) ? n : ''; }
  function rateErr(msg) { const e = new Error(msg); e.rate = true; return e; }
  let seq = 0;

  const PFX = { grp: ['g', 'rp'], gooc: ['g', 'oc'], hrp: ['h', 'rp'], hooc: ['h', 'oc'], crp: ['c', 'rp'], cooc: ['c', 'oc'] };
  const dbCh = (ch, g) => ch === 'party' ? 'p:' + g : PFX[ch] ? PFX[ch][0] + ':' + g + ':' + PFX[ch][1] : ch;
  const chOf = (c) => { c = String(c); if (c.startsWith('p:')) return 'party'; const o = c.endsWith(':oc'); return c.startsWith('g:') ? (o ? 'gooc' : 'grp') : c.startsWith('h:') ? (o ? 'hooc' : 'hrp') : c.startsWith('c:') ? (o ? 'cooc' : 'crp') : c; };
  function row(r) { return { id: r.id, ch: chOf(r.ch), t: r.t, pid: r.pid, name: r.name, house: r.house, grade: r.grade, guest: !!r.guest, kind: r.kind, text: sec.dec(r.text), title: r.title || '', ink: r.ink || '', op: isOp(r.pid) ? 1 : undefined }; }   // 운영자 표시는 지금 권한으로 (사칭 불가)
  const titleOf = opts.titleOf || (() => '');
  const inkOf = opts.inkOf || (() => '');
  const canDm = opts.canDm || (() => false);
  ['rp', 'world', 'notice', 'recruit'].forEach((ch) => { recent[ch] = dbx.q.recentChat.all(ch, KEEP_MEM).reverse().map(row); });
  // 채널별 글 번호: 안 읽은 수를 세는 데만 쓴다. 다시 켜도 이어지도록 kv에 저장 (처음이면 지금까지 글 수로)
  const seqN = Object.assign({ world: 0, rp: 0 }, (dbx.kvGet && dbx.kvGet('chatseq', null)) || {});
  Object.keys(LAZY).forEach((ch) => { if (!seqN[ch]) seqN[ch] = Number((dbx.db.prepare(`SELECT COUNT(*) AS n FROM chat WHERE ch = ?`).get(ch) || {}).n) || 0; });
  // 메모리의 최근 글에도 번호를 붙여 둔다 (마지막 글 = 지금 번호)
  Object.keys(LAZY).forEach((ch) => { const a = recent[ch]; for (let i = 0; i < a.length; i++) a[i].seq = seqN[ch] - (a.length - 1 - i); });
  let seqSaved = JSON.stringify(seqN), seqSent = seqSaved;
  function saveSeq() { const s = JSON.stringify(seqN); if (s !== seqSaved && dbx.kvSet) { dbx.kvSet('chatseq', seqN); seqSaved = s; } }
  function groupList(ch, g) {
    if (!g) return [];
    const key = dbCh(ch, g); let a = partyRecent.get(key);
    if (!a) { a = dbx.q.recentChat.all(key, KEEP_MEM).reverse().map(row); partyRecent.set(key, a); if (partyRecent.size > 3000) partyRecent.delete(partyRecent.keys().next().value); }
    return a;
  }
  const partyList = (party) => groupList('party', party);

  // 연결 하나에 쓰기 (gzip이면 압축한 뒤 바로 흘려보낸다)
  function raw(c, str) { try { c.out.write(str); if (c.gz) c.gz.flush(zlib.constants.Z_SYNC_FLUSH); } catch (e) { drop(c); } }
  function write(c, event, data) { raw(c, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
  // 방송: 메시지는 한 번만 JSON으로 만들고, 0.2초 동안 모은 뒤 모든 연결에 같은 문자열을 쓴다.
  // 묶음 채널(파티·동아리)은 그 묶음 사람에게만.
  let pubQ = '';                          // 모두에게
  const grpQ = new Map();                 // 'party:<id>' | 'guild:<id>' → 문자열
  const lazyQ = { world: '', rp: '' };    // 지연 채널: 그 탭을 보고 있는 연결에만
  let flushT = null;
  function schedule() { if (!flushT) { flushT = setTimeout(flush, FLUSH_MS); } }
  function broadcast(event, data, ch, g) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    if (g) { const k = KIND[ch] + ':' + g; grpQ.set(k, (grpQ.get(k) || '') + payload); }
    else if (event === 'msg' && LAZY[ch]) lazyQ[ch] += payload;
    else pubQ += payload;
    schedule();
  }
  function flush() {
    flushT = null; const pub = pubQ; pubQ = ''; const grp = grpQ.size ? new Map(grpQ) : null; grpQ.clear();
    const lz = { world: lazyQ.world, rp: lazyQ.rp }; lazyQ.world = ''; lazyQ.rp = '';
    if (!pub && !grp && !lz.world && !lz.rp) return;
    clients.forEach((c) => {
      let s2 = pub;
      if (c.watch && lz[c.watch]) s2 += lz[c.watch];
      if (grp) ['party', 'guild', 'house', 'cls'].forEach((kd) => { const g = OF[kd](c.pid), k = kd + ':' + g; if (g && grp.has(k)) s2 += grp.get(k); });
      if (s2) raw(c, s2);
    });
  }
  function forget(c) { if (c.gz) { try { c.gz.end(); } catch (e) { } c.gz = null; c.out = c.res; } byCid.delete(c.cid); c.watch = ''; if (clients.delete(c)) { const n = (byPid.get(c.pid) || 1) - 1; if (n > 0) byPid.set(c.pid, n); else byPid.delete(c.pid); } }
  function drop(c) { forget(c); try { c.res.end(); } catch (e) { } }
  function online() { return byPid.size; }

  // 스트림 열기
  function stream(req, res, pid) {
    // 같은 학생의 연결이 너무 많으면 가장 오래된 것을 닫는다
    const mine = []; clients.forEach((c) => { if (c.pid === pid) mine.push(c); });
    mine.sort((a, b) => a.id - b.id).slice(0, Math.max(0, mine.length - MAX_CONN_PER_PLAYER + 1)).forEach(drop);
    // gzip: 연결마다 작은 압축 창(4KB·memLevel 4 → 연결당 약 24KB)으로 메모리를 아낀다
    const gz = gzipOn && /\bgzip\b/.test(String(req.headers['accept-encoding'] || '')) ? zlib.createGzip({ level: 5, windowBits: 12, memLevel: 4 }) : null;
    const hd = { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' };
    if (gz) { hd['Content-Encoding'] = 'gzip'; hd.Vary = 'Accept-Encoding'; }
    res.writeHead(200, hd);
    if (gz) { gz.pipe(res); gz.on('error', () => {}); }
    const c = { res, pid, id: ++seq, gz, out: gz || res, cid: crypto.randomBytes(12).toString('base64url'), watch: '' };
    raw(c, 'retry: 3000\n\n');
    clients.add(c); byCid.set(c.cid, c); byPid.set(pid, (byPid.get(pid) || 0) + 1);
    const gd = guildOf(pid);
    // 월드·RP 글 목록은 보내지 않는다 (탭을 열면 /api/chat/watch + history?after= 로 받는다)
    write(c, 'init', { lazy: true, cid: c.cid, seq: { world: seqN.world, rp: seqN.rp }, channels: { notice: recent.notice, recruit: recent.recruit, party: partyList(partyOf(pid)), grp: groupList('grp', gd), gooc: groupList('gooc', gd), hrp: groupList('hrp', houseOf(pid)), hooc: groupList('hooc', houseOf(pid)), crp: groupList('crp', clsOf(pid)), cooc: groupList('cooc', clsOf(pid)) }, house: houseOf(pid), cls: clsOf(pid), party: partyOf(pid), guild: gd, online: online(), me: pid, op: !!isOp(pid), slow: { world: slow.world }, ...(opts.initExtra ? opts.initExtra(pid) : {}) });
    req.on('close', () => forget(c));
  }
  // 파티에 들어가거나 나가면 그 학생의 파티 채널을 새로 보낸다
  function partyChanged(pid) {
    const party = partyOf(pid), msgs = partyList(party);
    clients.forEach((c) => { if (c.pid === pid) write(c, 'party', { party, msgs }); });
  }
  function pingAll(event, data) { broadcast(event, data); }
  function ping(pid, event, data) { clients.forEach((c) => { if (c.pid === pid) write(c, event, data); }); }
  // 학과를 옮기면 학과 채널을 새로 보낸다 (기숙사는 바뀌지 않는다)
  function clsChanged(pid) {
    const g = clsOf(pid), d = { cls: g, crp: groupList('crp', g), cooc: groupList('cooc', g) };
    clients.forEach((c) => { if (c.pid === pid) write(c, 'cls', d); });
  }
  function guildChanged(pid) {
    const guild = guildOf(pid), d = { guild, grp: groupList('grp', guild), gooc: groupList('gooc', guild) };
    clients.forEach((c) => { if (c.pid === pid) write(c, 'guild', d); });
  }

  // 메시지 다듬기: 제어 문자 제거, 빈 줄 줄이기, 길이 제한
  function clean(text, max) {
    let t = String(text || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '');
    t = t.replace(/\n{3,}/g, '\n\n').trim();
    return t.slice(0, max);
  }
  function store(ch, party, m) {
    const arr = GROUP[ch] ? groupList(ch, party) : recent[ch];   // 넣기 전에 읽어 둔다 (중복 방지)
    const info = dbx.q.insertChat.run(dbCh(ch, party), m.t, m.pid, m.name, m.house, m.grade, m.guest ? 1 : 0, m.kind, sec.enc(m.text), m.title || '', m.ink || '');
    m.id = Number(info.lastInsertRowid);
    if (LAZY[ch]) m.seq = ++seqN[ch];
    arr.push(m); if (arr.length > KEEP_MEM) arr.shift();
    broadcast('msg', m, ch, GROUP[ch] ? party : null);
    return m;
  }

  // 보내기. 실패하면 사유 문자열을 던진다.
  // ① 0.5초 도배 제한 (마지막으로 보낸 시각 기준)
  function gap(P, now) { const L = lastSent.get(P.id); if (L && now - L.t < GAP) throw rateErr('너무 잦은 요청입니다. 잠시 후 다시 전송'); }
  // ② 월드 슬로우 모드 (운영자 제외)
  function slowCheck(P, ch, now) {
    if (ch !== 'world' || !slow.world || isOp(P.id)) return;
    const lw = lastWorld.get(P.id); if (lw && now - lw < slow.world) throw rateErr('슬로우 모드: ' + slow.world + '초에 한 번 보낼 수 있습니다');
  }
  function rate(P, t, now) {
    const L = lastSent.get(P.id) || { tok: 4, at: now, text: '', t: 0 };
    L.tok = Math.min(4, L.tok + (now - L.at) / 1.5); L.at = now;
    if (L.tok < 1) throw rateErr('너무 빨리 보내고 있습니다. 잠시 후 다시 전송');
    if (L.text === t && now - L.t < 10) throw new Error('같은 말을 반복할 수 없습니다');
    L.tok -= 1; L.text = t; L.t = now; lastSent.set(P.id, L);
  }
  function send(P, meta, ch, text, kind, now, nonce) {
    nonce = cleanNonce(nonce); const dup = seenNonce(P.id, nonce, now); if (dup) return { id: dup, dup: true };
    gap(P, now); slowCheck(P, ch, now);
    const C = CHANNELS[ch]; if (!C || C.readonly || ch === 'dm') throw new Error('보낼 수 없는 채널입니다');
    const party = GROUP[ch] ? groupOf(ch, P.id) : null;
    if (GROUP[ch] && !party) throw new Error(ch === 'party' ? '파티에 들어가 있지 않습니다' : KIND[ch] === 'guild' ? '동아리에 들어가 있지 않습니다' : KIND[ch] === 'cls' ? '학과 선택 필요' : '보낼 수 없는 채널입니다');
    if (meta.muted_until && meta.muted_until > now) throw new Error('채팅이 금지된 상태입니다 (' + Math.ceil((meta.muted_until - now) / 60) + '분 남음)');
    kind = kind === 'me' ? 'me' : 'say';
    const t = clean(text, C.max); if (!t) throw new Error('내용 입력 필요');
    // 속도 제한: 1.5초에 1개, 연속 4개까지. 같은 말 10초 안에 반복 금지
    rate(P, t, now);
    const m = store(ch, party, { ch, t: now, pid: P.id, name: P.name, house: P.house, grade: P.grade, guest: !!meta.guest, kind, text: t, title: titleOf(P), ink: inkOf(P) || undefined, op: isOp(P.id) ? 1 : undefined, nonce: nonce || undefined });
    if (ch === 'world') { lastWorld.set(P.id, now); if (lastWorld.size > 20000) lastWorld.delete(lastWorld.keys().next().value); }   // 보내기에 성공했을 때만
    keepNonce(P.id, nonce, m.id, now); return m;
  }
  // 1:1 (친구끼리). 두 사람의 연결에만 보낸다.
  const pair = (x, y) => x < y ? [x, y] : [y, x];
  function dmOut(r, a, b) { return { id: r.id, ch: 'dm', t: r.t, from: r.sender, peer: r.sender === a ? b : a, text: sec.dec(r.text) }; }
  function sendDm(P, meta, to, text, now, nonce) {
    nonce = cleanNonce(nonce); const dup = seenNonce(P.id, nonce, now); if (dup) return { id: dup, dup: true };
    gap(P, now);
    if (meta.muted_until && meta.muted_until > now) throw new Error('채팅이 금지된 상태입니다');
    if (!canDm(P.id, to)) throw new Error('친구에게만 1:1 대화를 보낼 수 있습니다');
    const t = clean(text, CHANNELS.dm.max); if (!t) throw new Error('내용 입력 필요');
    rate(P, t, now);
    const [a, b] = pair(P.id, to), info = dbx.q.dmInsert.run(a, b, now, P.id, sec.enc(t));
    const m = { id: Number(info.lastInsertRowid), ch: 'dm', t: now, from: P.id, name: P.name, text: t, nonce: nonce || undefined };
    keepNonce(P.id, nonce, m.id, now);
    clients.forEach((c) => { if (c.pid === P.id || c.pid === to) write(c, 'dm', Object.assign({ peer: c.pid === P.id ? to : P.id }, m)); });
    return m;
  }
  function dmHistory(me, peer, before, n) {
    const [a, b] = pair(me, peer);
    return dbx.q.dmOlder.all(a, b, Number(before) || Number.MAX_SAFE_INTEGER, Math.min(100, n || 50)).reverse().map((r) => dmOut(r, a, b));
  }
  function dmThreads(me) {
    return dbx.q.dmThreads.all(me, me).map((r) => { const peer = r.a === me ? r.b : r.a, last = dbx.q.dmGet.get(r.last); return { peer, last: r.last, t: r.t, from: last ? last.sender : '', text: last ? sec.dec(last.text).slice(0, 60) : '' }; });
  }
  // 서버 알림 (월드 보스 토벌, 파티 입장 등)
  // 함께 원정 모집: 본문은 방 정보(JSON). 화면이 카드로 그린다
  function recruit(P, data, now) {
    return store('recruit', null, { ch: 'recruit', t: now, pid: P.id, name: P.name, house: P.house, grade: P.grade, guest: false, kind: 'recruit', text: JSON.stringify(data), title: titleOf(P), ink: inkOf(P) || undefined });
  }
  function system(ch, text, now, party) {
    return store(ch, party, { ch, t: now, pid: 'system', name: '아카데미', house: 'system', grade: 0, guest: false, kind: 'sys', text });
  }
  // NPC(가상의 학생)가 말하기: 파티 채널에서만
  function npcSay(party, npc, text, now) {
    return store('party', party, { ch: 'party', t: now, pid: 'npc:' + npc.k, name: npc.name, house: npc.house || 'system', grade: npc.grade || 1, guest: false, kind: 'say', text, title: 'NPC', npc: true });
  }
  function history(ch, before, n, pid) {
    if (!CHANNELS[ch]) return [];
    const party = GROUP[ch] ? groupOf(ch, pid) : null; if (GROUP[ch] && !party) return [];
    return withSeq(ch, dbx.q.olderChat.all(dbCh(ch, party), Number(before) || Number.MAX_SAFE_INTEGER, Math.min(100, n || 50)).reverse().map(row));
  }
  // 메모리에 있는 글이면 번호(seq)를 붙여 준다
  function withSeq(ch, list) { if (!LAZY[ch]) return list; const mem = new Map(recent[ch].map((m) => [m.id, m.seq])); list.forEach((m) => { const s = mem.get(m.id); if (s) m.seq = s; }); return list; }
  // after 다음 글부터 오래된 순으로 100개. 더 밀려 있으면 최근 100개 + gap (그 앞은 before=로 더 보기)
  function historyAfter(ch, after, pid) {
    if (!CHANNELS[ch]) return { msgs: [] };
    const party = GROUP[ch] ? groupOf(ch, pid) : null; if (GROUP[ch] && !party) return { msgs: [] };
    const key = dbCh(ch, party), a = Math.max(0, Number(after) || 0);
    const rows = dbx.q.newerChat.all(key, a, 101);
    if (rows.length <= 100) return { msgs: withSeq(ch, rows.map(row)) };
    return { msgs: withSeq(ch, dbx.q.recentChat.all(key, 100).reverse().map(row)), gap: true };
  }
  // 지금 보고 있는 지연 채널 (''이면 아무것도). 연결 주인만 바꿀 수 있다.
  function watch(cid, ch, pid) { const c = byCid.get(String(cid || '')); if (!c || c.pid !== pid) return false; c.watch = LAZY[ch] ? ch : ''; return true; }
  function remove(id) {
    dbx.q.deleteChat.run(id);
    Object.keys(recent).forEach((ch) => { recent[ch] = recent[ch].filter((m) => m.id !== id); });
    partyRecent.forEach((a, k) => partyRecent.set(k, a.filter((m) => m.id !== id)));
    broadcast('del', { id });
  }
  function removeBy(pid) {
    Object.keys(recent).forEach((ch) => { recent[ch].filter((m) => m.pid === pid).forEach((m) => { dbx.q.deleteChat.run(m.id); broadcast('del', { id: m.id }); }); recent[ch] = recent[ch].filter((m) => m.pid !== pid); });
  }
  function isOnline(pid) { return (byPid.get(pid) || 0) > 0; }
  function kick(pid) { clients.forEach((c) => { if (c.pid === pid) drop(c); }); }

  // 연결 유지 신호와 접속자 수
  const timers = [
    setInterval(() => { clients.forEach((c) => raw(c, ': ping\n\n')); sweepNonces(Date.now() / 1000); }, 25000),
    // 글 번호: 바뀌었을 때만 2초마다, 모두에게 같은 문자열
    setInterval(() => { const s = JSON.stringify({ world: seqN.world, rp: seqN.rp }); if (s !== seqSent) { seqSent = s; pubQ += `event: seq\ndata: ${s}\n\n`; schedule(); } }, 2000),
    setInterval(saveSeq, 10000),
    setInterval(() => broadcast('online', { online: online() }), 30000),
    setInterval(() => { ['rp', 'world', 'notice'].forEach((ch) => dbx.q.pruneChat.run(ch, ch, KEEP_DB)); }, 6 * 3600000)
  ];
  timers.forEach((t) => t.unref());

  return { CHANNELS, stream, send, sendDm, dmHistory, dmThreads, npcSay, system, recruit, history, historyAfter, watch, saveSeq, remove, removeBy, kick, isOnline, online, partyChanged, guildChanged, clsChanged, ping, pingAll, pingEach(event, fn) { clients.forEach((c) => write(c, event, fn(c.pid))); }, dropParty: (party) => partyRecent.delete('p:' + party), dropGuild: (g) => { partyRecent.delete('g:' + g + ':rp'); partyRecent.delete('g:' + g + ':oc'); }, connections: () => clients.size, getSlow: () => slow.world, setSlow(sec) { slow.world = Math.max(0, Math.min(600, Math.floor(+sec || 0))); pingAll('slow', { ch: 'world', sec: slow.world }); return slow.world; }, opChanged(pid) { clients.forEach((c) => { if (c.pid === pid) write(c, 'op', { op: !!isOp(pid) }); }); }, flush, closeAll() { flush(); saveSeq(); clients.forEach(drop); } };
}
module.exports = { create, CHANNELS };
