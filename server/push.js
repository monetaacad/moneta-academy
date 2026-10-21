'use strict';
// 푸시 알림 (Web Push): 게임을 닫아 두어도 수업 · 원정 · 연구가 끝나면 휴대폰 · PC로 알린다.
// - 외부 라이브러리 없이 Node crypto로 암호화(RFC 8291 aes128gcm)와 서명(VAPID, RFC 8292 ES256)을 한다.
// - 서버 열쇠(VAPID)는 /etc/moneta.env 의 VAPID_PUBLIC · VAPID_PRIVATE, 없으면 데이터 폴더에 만들어 쓴다.
// - 기기 주소(endpoint)와 열쇠는 암호화해 DB에 두고, 알려진 푸시 서버 주소만 받는다(서버가 아무 주소로나 요청하지 않게).
// - 몇 분 안에 몰린 일은 한 건으로 묶고, 방해 금지 시간(밤 11시~오전 8시)에는 모았다가 아침에 한 번 보낸다.
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');
const R = require('../shared/rules.js');

const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => Buffer.from(String(s || ''), 'base64url');
// 푸시 서버로 알려진 곳만 (구글 FCM · 모질라 · 애플 · 마이크로소프트)
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9.-]+\.push\.apple\.com$/, /^[a-z0-9.-]+\.notify\.windows\.com$/];
const MAX_SUBS = 5;            // 학생 한 명당 기기 수
const LATE = 300;              // 이보다 늦은 알림은 버린다 (서버가 꺼져 있었을 때 등)
const BUNDLE = 90;             // 이만큼 안에 끝날 일은 지금 알림에 같이 묶는다
const QUIET = [23, 8];         // 방해 금지 시간 (한국 시각, 시)

function create(dbx, sec, opts) {
  const { db } = dbx, log = opts.log, nowSec = opts.nowSec, store = opts.store;
  db.exec(`CREATE TABLE IF NOT EXISTS push_subs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pid TEXT NOT NULL,
    ekey TEXT NOT NULL UNIQUE,      -- 주소의 HMAC 색인 (같은 기기 중복 방지)
    data TEXT NOT NULL,             -- 암호화한 {endpoint, p256dh, auth}
    opts TEXT NOT NULL DEFAULT '{}',-- {kinds:{lec:1,...}, quiet:1}
    created INTEGER NOT NULL,
    last_ok INTEGER NOT NULL DEFAULT 0
  ); CREATE INDEX IF NOT EXISTS push_pid ON push_subs(pid);`);
  const q = {
    all: db.prepare('SELECT id, pid, data, opts FROM push_subs'),
    byKey: db.prepare('SELECT id, pid FROM push_subs WHERE ekey = ?'),
    countPid: db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE pid = ?'),
    oldestPid: db.prepare('SELECT id FROM push_subs WHERE pid = ? ORDER BY last_ok, created LIMIT 1'),
    insert: db.prepare('INSERT INTO push_subs (pid, ekey, data, opts, created) VALUES (?, ?, ?, ?, ?)'),
    update: db.prepare('UPDATE push_subs SET pid = ?, data = ?, opts = ? WHERE id = ?'),
    del: db.prepare('DELETE FROM push_subs WHERE id = ?'),
    delKey: db.prepare('DELETE FROM push_subs WHERE ekey = ? AND pid = ?'),
    ok: db.prepare('UPDATE push_subs SET last_ok = ? WHERE id = ?')
  };

  // ── 서버 열쇠 (VAPID, P-256) ──
  let pub = process.env.VAPID_PUBLIC || '', priv = process.env.VAPID_PRIVATE || '';
  if (!pub || !priv) {
    const f = path.join(opts.dataDir, '.vapid.json');
    try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); pub = j.pub; priv = j.priv; }
    catch (e) {
      const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }), jwk = privateKey.export({ format: 'jwk' });
      pub = b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])); priv = jwk.d;
      fs.mkdirSync(opts.dataDir, { recursive: true }); fs.writeFileSync(f, JSON.stringify({ pub, priv }), { mode: 0o600 });
      log('푸시 알림 서버 열쇠를 새로 만들었습니다 (' + f + ')');
    }
  }
  const P = unb64u(pub), vapidKey = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: priv, x: b64u(P.subarray(1, 33)), y: b64u(P.subarray(33, 65)) } });
  const subject = opts.subject || 'https://moneta-academy.duckdns.org';

  function vapidAuth(endpoint) {
    const aud = new URL(endpoint).origin;
    const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' })), body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
    const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: vapidKey, dsaEncoding: 'ieee-p1363' });
    return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + pub;
  }
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  // RFC 8291: 받는 쪽 열쇠(p256dh, auth)로 내용을 암호화한다. 결과 = 머리(salt · rs · 보낸 쪽 공개 열쇠) + 암호문
  function encrypt(p256dh, auth, plain, fixed) {   // fixed: 시험용 {priv, salt} (RFC 8291 예시와 맞춰 보기)
    const ua = unb64u(p256dh), au = unb64u(auth);
    if (ua.length !== 65 || au.length < 16) throw new Error('bad keys');
    const ecdh = crypto.createECDH('prime256v1'); if (fixed) ecdh.setPrivateKey(unb64u(fixed.priv)); else ecdh.generateKeys(); const as = ecdh.getPublicKey(), shared = ecdh.computeSecret(ua);
    const ikm = hmac(hmac(au, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as, Buffer.from([1])]));
    const salt = fixed ? unb64u(fixed.salt) : crypto.randomBytes(16), prk = hmac(salt, ikm);
    const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16), nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
    const c = crypto.createCipheriv('aes-128-gcm', cek, nonce), ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(plain), Buffer.from([2])])), c.final(), c.getAuthTag()]);
    const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
    return Buffer.concat([salt, rs, Buffer.from([as.length]), as, ct]);
  }
  function validEndpoint(u) { try { const x = new URL(u); return x.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(x.hostname)); } catch (e) { return false; } }

  // 보내기: 201이면 성공, 404 · 410이면 없어진 기기라 지운다
  function send(row, sub, msg) {
    return new Promise((done) => {
      let body; try { body = encrypt(sub.p256dh, sub.auth, JSON.stringify(msg)); } catch (e) { q.del.run(row.id); return done(false); }
      const u = new URL(sub.endpoint);
      const req = https.request({ method: 'POST', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, timeout: 10000,
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', 'Content-Length': body.length, TTL: '3600', Urgency: 'normal', Authorization: vapidAuth(sub.endpoint) } }, (res) => {
        res.resume();
        if (res.statusCode === 404 || res.statusCode === 410) { q.del.run(row.id); subsCache = null; }
        else if (res.statusCode < 300) q.ok.run(Math.floor(Date.now() / 1000), row.id);
        else log('푸시 실패 ' + res.statusCode + ' (' + u.hostname + ')');
        done(res.statusCode < 300);
      });
      req.on('timeout', () => req.destroy()); req.on('error', () => done(false)); req.end(body);
    });
  }

  // ── 기기 등록 ──
  let subsCache = null;
  function subs() { if (!subsCache) subsCache = q.all.all().map((r) => { let d = null, o = {}; try { d = JSON.parse(sec.dec(r.data)); o = JSON.parse(r.opts || '{}'); } catch (e) { } return d ? { id: r.id, pid: r.pid, sub: d, opts: o } : null; }).filter(Boolean); return subsCache; }
  function cleanOpts(o) { o = o || {}; const kinds = {}; R.NOTIFY_KINDS.forEach((k) => { if (o.kinds && o.kinds[k[0]]) kinds[k[0]] = 1; }); return { kinds, quiet: o.quiet === false ? 0 : 1 }; }
  function subscribe(pid, b) {
    const s = b && b.sub, ep = s && String(s.endpoint || ''), keys = (s && s.keys) || {};
    if (!ep || ep.length > 1000 || !validEndpoint(ep)) return '지원하지 않는 알림 주소입니다';
    if (unb64u(keys.p256dh).length !== 65 || unb64u(keys.auth).length < 16) return '알림 열쇠가 올바르지 않습니다';
    const ekey = sec.index('push:' + ep), data = sec.enc(JSON.stringify({ endpoint: ep, p256dh: String(keys.p256dh), auth: String(keys.auth) })), o = JSON.stringify(cleanOpts(b.opts));
    const old = q.byKey.get(ekey);
    if (old) q.update.run(pid, data, o, old.id);
    else {
      if (Number(q.countPid.get(pid).n) >= MAX_SUBS) { const r = q.oldestPid.get(pid); if (r) q.del.run(r.id); }   // 기기가 많으면 오래 안 쓴 것부터
      q.insert.run(pid, ekey, data, o, Math.floor(Date.now() / 1000));
    }
    subsCache = null; if (!last.has(pid)) last.set(pid, nowSec());
    return null;
  }
  function unsubscribe(pid, endpoint) { q.delKey.run(sec.index('push:' + String(endpoint || '')), pid); subsCache = null; }

  // ── 보낼 때가 된 일 찾기 (30초마다) ──
  // pid → 마지막으로 알린 시각 (게임 시각). 서버를 다시 켜도 같은 일을 다시 알리지 않게 종료할 때 저장해 둔다
  const last = new Map(Object.entries(dbx.kvGet('pushLast', {}) || {}));
  function saveLast() { dbx.kvSet('pushLast', Object.fromEntries(last)); }
  const held = new Map();      // 기기 id → 방해 금지 시간 동안 모아 둔 일
  const startAt = nowSec();
  function quietNow(o) { if (!o.quiet) return false; const h = new Date((Date.now() / 1000 + 9 * 3600) * 1000).getUTCHours(); return QUIET[0] > QUIET[1] ? h >= QUIET[0] || h < QUIET[1] : h >= QUIET[0] && h < QUIET[1]; }
  function tick() {
    const list = subs(); if (!list.length) return;
    const now = nowSec(), byPid = new Map();
    list.forEach((s) => { if (!byPid.has(s.pid)) byPid.set(s.pid, []); byPid.get(s.pid).push(s); });
    byPid.forEach((devs, pid) => {
      const P0 = store.get(pid); if (!P0) return;
      const from = Math.max(last.get(pid) || startAt - LATE, now - LATE);
      const evs = R.notifyEvents(P0, from).concat(R.notifyInbox(P0)).filter((e) => e.t > from && e.t <= now + BUNDLE);
      const due = evs.some((e) => e.t <= now);
      if (due) last.set(pid, Math.max(now, ...evs.map((e) => e.t))); else if (!last.has(pid)) last.set(pid, now);
      devs.forEach((d) => {
        const mine = due ? evs.filter((e) => d.opts.kinds && d.opts.kinds[e.kind]) : [];
        if (quietNow(d.opts)) { if (mine.length) held.set(d.id, (held.get(d.id) || []).concat(mine).slice(-20)); return; }
        const h = held.get(d.id) || []; held.delete(d.id);
        if (h.length) { const m = R.notifyBundle(h, '자는 동안 · '); send(d, d.sub, { title: m.title, body: m.body, tag: 'mq-night', url: '/' }); }
        // 태그는 일마다 고정: 같은 일이 두 번 보내져도(기기 · 화면 알림과 겹쳐도) 알림 하나로 바뀌어 다시 울리지 않는다
        if (mine.length) { const m = R.notifyBundle(mine); send(d, d.sub, { title: m.title, body: m.body, tag: 'mq-' + mine.map((e) => e.kind + '-' + Math.round(e.t)).join('_').slice(0, 120), url: '/' }); }
      });
    });
  }
  // 바로 보내는 알림 (경매 밀림 · 마감 임박 등): 그 종류를 켠 기기에만, 방해 금지 시간에는 보내지 않는다
  function direct(pid, kind, title, body, tag) {
    subs().filter((s) => s.pid === pid && s.opts.kinds && s.opts.kinds[kind] && !quietNow(s.opts)).forEach((d) => send(d, d.sub, { title, body, tag: tag || kind + '-' + Math.round(nowSec()), url: '/' }));
  }
  const timer = setInterval(() => { try { tick(); } catch (e) { log('푸시 확인 실패', e); } }, 30000); timer.unref();

  return { publicKey: pub, subscribe, unsubscribe, tick, direct, saveLast, encrypt, vapidAuth, validEndpoint, count: () => subs().length, stop() { clearInterval(timer); } };
}
module.exports = { create };
