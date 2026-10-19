// 채팅 부하: N명이 가입해 들어와 모두 채팅 스트림을 열고, 일부가 계속 말한다.
// 보낸 시각과 받은 시각의 차이(전달 지연)를 잰다. 서버는 TEST_MODE=1 INVITE_REQUIRED=0 (초대코드 없이 가입).
// 사용: node tools/chatload.js [인원=2000] [초당 메시지=3] [지속초=60] [주소]   (GZ=1 이면 gzip으로 받는다)
const http = require('http');
const N = +(process.argv[2] || 2000), RATE = +(process.argv[3] || 3), DUR = +(process.argv[4] || 60), BASE = new URL(process.argv[5] || 'http://127.0.0.1:8097');
const agent = new http.Agent({ keepAlive: true, maxSockets: 128 });
const streamAgent = new http.Agent({ keepAlive: true, maxSockets: Infinity });
function post(path, body, token) {
  return new Promise((ok) => {
    const d = JSON.stringify(body);
    const r = http.request({ host: BASE.hostname, port: BASE.port, path, method: 'POST', agent, headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }, token ? { Authorization: 'Bearer ' + token } : {}) }, (res) => { let s = ''; res.on('data', (c) => s += c); res.on('end', () => { try { ok(JSON.parse(s)); } catch (e) { ok({}); } }); });
    r.on('error', () => ok({})); r.end(d);
  });
}
// 지연 로딩: 연결마다 월드 또는 RP 중 하나를 「보고 있는」 탭으로 정한다 (짝수 = 월드, 홀수 = RP)
const lat = []; let received = 0, sent = 0, sendErr = 0, opened = 0, broken = 0; const watchN = { world: 0, rp: 0 }, sentCh = { world: 0, rp: 0 };
function stream(token, idx) {
  return new Promise((ok) => {
    const r = http.get({ host: BASE.hostname, port: BASE.port, path: '/api/chat/stream', agent: streamAgent, headers: Object.assign({ Authorization: 'Bearer ' + token }, process.env.GZ ? { 'Accept-Encoding': 'gzip' } : {}) }, (res0) => {
      const res = res0.headers['content-encoding'] === 'gzip' ? res0.pipe(require('zlib').createGunzip({ flush: require('zlib').constants.Z_SYNC_FLUSH })) : res0; res.statusCode = res0.statusCode;
      if (res.statusCode !== 200) { broken++; return ok(); }
      opened++; ok(); let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        buf += c; let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          if (block.startsWith('event: init')) { const d = JSON.parse(block.split('\ndata: ')[1]); const ch = idx % 2 ? 'rp' : 'world'; if (d.cid) post('/api/chat/watch', { cid: d.cid, ch }, token).then((j) => { if (j.ok) watchN[ch]++; }); }
          if (block.startsWith('event: msg')) {
            received++;
            const m = JSON.parse(block.split('\ndata: ')[1]); const ts = /@(\d+)$/.exec(m.text);
            if (ts && lat.length < 400000) lat.push(Date.now() - +ts[1]);
          }
        }
      });
      res.on('close', () => broken++);
    });
    r.on('error', () => { broken++; ok(); });
  });
}
function pct(a, p) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }
(async () => {
  const users = [], t0 = Date.now(), tag = (Date.now() % 100000).toString(36);
  for (let i = 0; i < N; i += 100) {
    await Promise.all(Array.from({ length: Math.min(100, N - i) }, async (_, k) => {
      const j = await post('/api/register', { name: ('c' + tag + (i + k).toString(36)).slice(0, 12), password: 'chatload' + (i + k) + 'pw', cls: 'mage', house: ['lanterna', 'clepsydra', 'corona', 'speculum'][(i + k) % 4] });
      if (j.token) users.push(j.token);
    }));
  }
  console.log(`입학 ${users.length}명 ${((Date.now() - t0) / 1000).toFixed(1)}초`);
  for (let i = 0; i < users.length; i += 200) await Promise.all(users.slice(i, i + 200).map((t, k) => stream(t, i + k)));
  console.log(`채팅 스트림 연결 ${opened}개 (실패 ${broken})`);
  await new Promise((r) => setTimeout(r, 1000)); received = 0;
  const end = Date.now() + DUR * 1000; let k = 0;
  while (Date.now() < end) {
    const tok = users[k++ % users.length];
    const ch = k % 3 ? 'world' : 'rp';
    post('/api/chat/send', { ch, text: '부하 테스트 메시지 ' + k + ' @' + Date.now() }, tok).then((j) => { if (j.ok) { sent++; sentCh[ch]++; } else sendErr++; });
    await new Promise((r) => setTimeout(r, 1000 / RATE));
  }
  await new Promise((r) => setTimeout(r, 3000));
  console.log(`보낸 메시지 ${sent} (거절 ${sendErr}) · 받은 메시지 총 ${received}건 (기대값 ${sentCh.world * watchN.world + sentCh.rp * watchN.rp} · 월드 보는 연결 ${watchN.world} · RP ${watchN.rp})`);
  console.log(`전달 지연: 중간 ${pct(lat, 0.5)}ms · 95% ${pct(lat, 0.95)}ms · 99% ${pct(lat, 0.99)}ms · 최대 ${lat.reduce((a, b) => a > b ? a : b, 0)}ms`);
  process.exit(0);
})();
