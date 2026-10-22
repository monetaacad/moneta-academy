/* 반영 전 화면 점검: 새 시험 서버를 띄우고, 실제 브라우저로 로그인 전 · 후 화면과 하단 메뉴를 모두 열어 본다.
   화면 스크립트 오류(pageerror)나 서버 오류가 하나라도 나오면 실패(종료 코드 1).
   실행: node tools/smoke.js   (playwright 또는 playwright-core 필요. 브라우저 경로는 CHROME_PATH로 바꿀 수 있다) */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
let pw; try { pw = require('playwright'); } catch (e) { pw = require('playwright-core'); }
const ROOT = path.join(__dirname, '..');
const PORT = 18000 + Math.floor(Math.random() * 1000), B = 'http://127.0.0.1:' + PORT, TOK = 'smoke-admin-token-0123456789abcdef';
const exe = process.env.CHROME_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneta-smoke-'));
const errs = [];
const srv = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { DATA_DIR: dir, PORT: String(PORT), TIME_SCALE: '60', TEST_MODE: '1', ADMIN_TOKEN: TOK }), stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = ''; srv.stdout.on('data', (d) => { srvLog += d; }); srv.stderr.on('data', (d) => { srvLog += d; });
srv.on('exit', (c) => { if (c && !done) errs.push('서버가 종료됨 (코드 ' + c + ')'); });
let done = false;
const post = (p, b, h) => fetch(B + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, h || {}), body: JSON.stringify(b) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(pg, label) {
  const navs = await pg.$$('.nav button, nav button, .tabbar button');
  for (const n of navs) { try { await n.click({ timeout: 2000 }); await pg.waitForTimeout(400); await pg.keyboard.press('Escape'); } catch (e) { } }
  return navs.length;
}

(async () => {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch (e) { } await wait(200); }
  const b = await pw.chromium.launch({ executablePath: exe });
  const watch = (pg, label) => {
    pg.on('pageerror', (e) => errs.push(label + ' 화면 오류: ' + e.message));
    pg.on('response', (r) => { if (r.status() >= 500 && r.status() !== 503) errs.push(label + ' 서버 ' + r.status() + ': ' + r.url()); });
  };
  // 1) 로그인 전 (입학 화면)
  const c0 = await b.newContext({ viewport: { width: 390, height: 760 } }); const p0 = await c0.newPage(); watch(p0, '로그인 전');
  await p0.goto(B + '/'); await p0.waitForTimeout(2500);
  if (!(await p0.$('#app *'))) errs.push('로그인 전 화면이 비어 있음');
  // 2) 로그인 후 (게임 화면 · 하단 메뉴 전부)
  const inv = (await (await post('/api/admin/invites', { count: 1 }, { 'x-admin-token': TOK })).json()).codes[0];
  const r = await post('/api/register', { login: 'smoke' + Date.now(), name: '점검' + (Date.now() % 10000), password: 'secret123', house: 'lanterna', invite: inv, cls: 'knight' });
  const ck = (r.headers.get('set-cookie') || '').split(';')[0].split('=');
  if (!ck[1]) errs.push('가입 실패: ' + JSON.stringify(await r.json()));
  const c1 = await b.newContext({ viewport: { width: 390, height: 760 } });
  await c1.addCookies([{ name: ck[0], value: ck.slice(1).join('='), url: B }]);
  const p1 = await c1.newPage(); watch(p1, '모바일');
  await p1.goto(B + '/'); await p1.waitForTimeout(3000); await p1.keyboard.press('Escape');
  const n1 = await check(p1);
  if (!n1) errs.push('모바일 게임 화면에 메뉴가 없음 (화면이 열리지 않음)');
  // 3) PC 화면
  const c2 = await b.newContext({ viewport: { width: 1400, height: 900 } });
  await c2.addCookies([{ name: ck[0], value: ck.slice(1).join('='), url: B }]);
  const p2 = await c2.newPage(); watch(p2, 'PC');
  await p2.goto(B + '/'); await p2.waitForTimeout(3000); await p2.keyboard.press('Escape');
  const n2 = await check(p2);
  if (!n2) errs.push('PC 게임 화면에 메뉴가 없음 (화면이 열리지 않음)');
  await b.close();
  console.log('메뉴 확인: 모바일 ' + n1 + '개 · PC ' + n2 + '개');
})().catch((e) => errs.push('점검 실행 실패: ' + (e && e.stack || e))).then(() => {
  done = true; srv.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  if (errs.length) { console.log('실패\n- ' + errs.join('\n- ')); if (/Error|오류/.test(srvLog)) console.log('--- 서버 기록 ---\n' + srvLog.slice(-3000)); process.exit(1); }
  console.log('통과');
});
