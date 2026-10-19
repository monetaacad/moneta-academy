// 부하 테스트: N명이 입학한 뒤 실제 클라이언트처럼 상태 확인·세계 갱신·행동을 반복한다.
// 사용: node tools/loadtest.js [인원=2000] [지속초=90] [주소=http://127.0.0.1:8097]
// 서버는 TEST_MODE=1 로 켜야 한 IP에서 대량 입학이 됩니다.
const http = require('http');
const N = +(process.argv[2] || 2000), DUR = +(process.argv[3] || 90), BASE = new URL(process.argv[4] || 'http://127.0.0.1:8097');
const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
const lat = {}, errs = {}; let total = 0;
function req(method, path, body, token) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null, t = process.hrtime.bigint();
    const r = http.request({ host: BASE.hostname, port: BASE.port, path, method, agent, headers: Object.assign({ 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip' }, token ? { Authorization: 'Bearer ' + token } : {}, data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => {
        const ms = Number(process.hrtime.bigint() - t) / 1e6, key = method + ' ' + path.split('?')[0];
        (lat[key] = lat[key] || []).push(ms); total++;
        if (res.statusCode >= 500 || res.statusCode === 0) errs[key + ' ' + res.statusCode] = (errs[key + ' ' + res.statusCode] || 0) + 1;
        let j = null; try { const buf = Buffer.concat(chunks); j = JSON.parse(res.headers['content-encoding'] === 'gzip' ? require('zlib').gunzipSync(buf) : buf); } catch (e) { }
        resolve({ status: res.statusCode, j });
      });
    });
    r.on('error', (e) => { errs['net ' + e.code] = (errs['net ' + e.code] || 0) + 1; resolve({ status: 0 }); });
    if (data) r.write(data); r.end();
  });
}
const houses = ['lanterna', 'clepsydra', 'corona', 'speculum'];
const subj = ['elem', 'syntax', 'ward'], durs = ['30m', '1h', '2h', '8h'];
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function pct(a, p) { if (!a || !a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }
(async () => {
  console.log(`입학 ${N}명...`);
  const users = []; const t0 = Date.now();
  for (let i = 0; i < N; i += 50) {
    await Promise.all(Array.from({ length: Math.min(50, N - i) }, async (_, k) => {
      const name = 'lt' + (Date.now() % 100000).toString(36) + (i + k).toString(36);
      const r = await req('POST', '/api/register', { login: 'lt' + (Date.now() % 1e9).toString(36) + (i + k), name: name.slice(0, 12), password: 'loadpw' + (i + k) + 'xyz', house: houses[(i + k) % 4], cls: ['mage', 'knight'][(i + k) % 2] });
      if (r.j && r.j.token) users.push({ token: r.j.token, name });
    }));
  }
  const regMs = Date.now() - t0;
  console.log(`입학 완료 ${users.length}명, ${(regMs / 1000).toFixed(1)}초 (평균 ${(regMs / Math.max(1, users.length)).toFixed(1)}ms/명, p95 ${pct(lat['POST /api/register'], 0.95).toFixed(0)}ms)`);
  Object.keys(lat).forEach((k) => delete lat[k]); total = 0;
  // 접속 유지: 실제 클라이언트 주기 (상태 60초, 세계 30초, 행동 분당 2~4번)
  const end = Date.now() + DUR * 1000; const tStart = Date.now();
  await Promise.all(users.map(async (u, i) => {
    await sleep(Math.random() * 15000);
    let nextState = 0, nextWorld = 0;
    while (Date.now() < end) {
      const n = Date.now();
      if (n >= nextState) { await req('GET', '/api/state', null, u.token); nextState = n + 60000; }
      else if (n >= nextWorld) { await req('GET', '/api/world', null, u.token); nextWorld = n + 30000; }
      else {
        const roll = Math.random();
        if (roll < 0.25) await req('POST', '/api/act', { type: 'lecStart', a: { slot: 0, s: subj[i % 3], d: durs[i % 4] } }, u.token);
        else if (roll < 0.5) await req('POST', '/api/act', { type: 'expStart', a: { slot: 0, s: 1 + (i % 8), d: durs[(i + 1) % 4] } }, u.token);
        else if (roll < 0.6) await req('POST', '/api/act', { type: 'wbAttack' }, u.token);
        else if (roll < 0.7) { const q = await req('POST', '/api/act', { type: 'quizStart' }, u.token); if (q.j && q.j.r) await req('POST', '/api/act', { type: 'quizAnswer', a: { ans: [0, 1, 2] } }, u.token); }
        else if (roll < 0.8) await req('POST', '/api/act', { type: 'lecCancel', a: { slot: 0 } }, u.token);
        else if (roll < 0.9) await req('POST', '/api/act', { type: 'resStart', a: { id: 'manaspring' } }, u.token);
        else await req('POST', '/api/act', { type: 'login' }, u.token);
      }
      await sleep(15000 + Math.random() * 15000);
    }
  }));
  const secs = (Date.now() - tStart) / 1000;
  console.log(`\n접속 유지 ${secs.toFixed(0)}초 동안 요청 ${total}건 (${(total / secs).toFixed(1)}건/초)`);
  console.table(Object.keys(lat).map((k) => ({ 요청: k, 건수: lat[k].length, p50: pct(lat[k], 0.5).toFixed(1), p95: pct(lat[k], 0.95).toFixed(1), p99: pct(lat[k], 0.99).toFixed(1), 최대: Math.max(...lat[k]).toFixed(1) })));
  console.log('오류', Object.keys(errs).length ? errs : '없음');
  const st = await req('GET', '/api/health');
  // (/api/health는 이제 학생 수를 알려 주지 않는다: 방문자에게 정보를 주지 않기 위해)
  agent.destroy();
})();
