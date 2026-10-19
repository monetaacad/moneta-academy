// 120일 서버 시뮬레이션: 접속 패턴별 봇이 실제 규칙(Rules)으로 플레이한다
const R = require('../shared/rules.js'), D = require('../shared/data.js');
const DAYS = +(process.argv[2] || 120), PROFILE = process.argv[3] || 'steady', VERBOSE = process.env.V === '1', QUIZ_ACC = 0.7;
const PROFILES = {
  casual: [8, 12.5, 19, 23],                          // 출근 전·점심·퇴근 후·자기 전
  steady: [8, 10, 12, 14, 16, 18, 20, 22, 23.5],     // 깨어 있는 동안 2시간마다 (뽀모도로형)
  hardcore: Array.from({ length: 17 }, (_, i) => 8 + i).filter(h => h <= 24) // 깨어 있는 동안 1시간마다
};
const hours = PROFILES[PROFILE];
const EPOCH = Date.UTC(2026, 10, 2, 0, 0, 0) / 1000 - 9 * 3600; // 2026-11-02(월) 00:00 KST
const W = { epoch: EPOCH, now: EPOCH, wbAlive: true, results: {} };
let rngSeed = 12345; function mr() { rngSeed = (rngSeed * 1103515245 + 12345) & 0x7fffffff; return rngSeed / 0x7fffffff; }
const P = R.newPlayer('bot', '봇', 'lanterna', EPOCH + 9 * 3600, 777);
const checkins = [];
for (let d = 0; d < DAYS; d++) for (const h of hours) checkins.push(EPOCH + d * 86400 + h * 3600 + Math.floor(mr() * 600));
const ms = {}; const daily = [];
function act(type, a, now) { try { return R.act(P, W, now, type, a); } catch (e) { if (!e.game) throw e; return null; } }

function bestDur(now, nextIdx) {
  // 다음 접속들 중 작업이 끝난 직후 접속까지 기다리는 시간을 고려해 시간당 산출이 가장 큰 길이를 고른다
  let best = '1h', bv = 0;
  for (const d of D.DURATIONS) {
    const end = now + d.s; let back = null;
    for (let k = nextIdx; k < checkins.length; k++) if (checkins[k] >= end) { back = checkins[k]; break; }
    if (!back) back = end;
    const v = d.s * d.eff / (back - now);
    if (v > bv + 1e-9) { bv = v; best = d.k; }
  }
  return best;
}
function bot(now, ci) {
  W.now = now;
  R.advance(P, W, now);
  act('login', {}, now); P.daily.q.forEach((q, i) => act('daily', { i }, now));
  if (P.wkPrev && !P.wkPrev.claimed) { W.results[P.wkPrev.id] = { cup: ['lanterna', 'corona', 'speculum', 'clepsydra'].sort(() => mr() - 0.5), killed: true, tiers: [1e30, 1e30, 0] }; act('weekClaim', {}, now); }
  P.inbox = [];
  const c = R.calc(P, W, now), ex = R.examFor(P);
  // 시험
  if (ex && P.grade < 8 && P.examCd <= now && R.examEligible(P, ex)) {
    const pr = R.examPractical(P, ex), du = R.duelPreview(P, W, ex.duel);
    if (pr + (du.win ? 30 : 0) + R.examTheory(P, ex) >= 66) {
      const r = act('exam', {}, now);
      if (r && r.pass) { ms['g' + P.grade] = (now - EPOCH) / 86400; if (VERBOSE) console.log(`day ${((now - EPOCH) / 86400).toFixed(1)}: ${r.grade}학년 시험 ${r.letter} ${r.total} lv${P.lvl} stage${P.maxStage}`); }
    }
  }
  // 보스
  for (let k = 0; k < 3; k++) {
    if (P.bossCd > now || !R.canChallenge(P)) break;
    const b = R.nextBoss(P); const pv = R.duelPreview(P, W, b, R.K.BOSS_HP, R.K.BOSS_ATK);
    if (pv.ttk > R.K.BOSS_TIME * 0.9 || !pv.win) break;
    const r = act('boss', {}, now); if (!r || !r.win) break;
    if (VERBOSE && b % 20 === 0) console.log(`day ${((now - EPOCH) / 86400).toFixed(1)}: boss ${b} 처치 lv${P.lvl}`);
  }
  // 결투제
  if (R.rival(P) && P.duel.cd <= now) { const pv = R.rivalPreview(P, W); if (pv.win) act('duel', {}, now); }
  // 주문 배치
  const ns = R.spellSlots(P), sp = D.SPELLS.filter(s => R.spellUnlocked(P, s.id));
  const order = sp.slice().sort((a, b) => { const va = a.type === 'shield' ? 4 : a.type === 'heal' ? 3.5 : a.mult / a.cd, vb = b.type === 'shield' ? 4 : b.type === 'heal' ? 3.5 : b.mult / b.cd; return vb - va; }).slice(0, ns);
  for (let i = 0; i < ns; i++) P.spells[i] = order[i] ? order[i].id : null;
  // 장비
  P.inv.slice().forEach(it => { if (R.powerWith(P, it) > R.calc(P, null).power * 1.001) act('equip', { u: it.u }, now); });
  act('sellBelow', { r: 4 }, now);
  for (let n = 0; n < 15; n++) {
    let best = null, bc = Infinity;
    for (const s in P.eq) { const it = P.eq[s]; if (!it || it.enh >= R.ENH_MAX) continue; const cost = R.enhCost(P, it); if (cost.gold < bc && cost.gold <= P.res.gold * 0.5 && cost.stone <= P.res.stone) { bc = cost.gold; best = it; } }
    if (!best) break; act('enhance', { u: best.u }, now);
  }
  if (P.res.stone < 4 && P.res.gold > R.shopPrice(P, 'stone10') * 4) act('buy', { id: 'stone10' }, now);
  if (P.rs.sorter) act('autoSell', { r: 1 }, now);
  // 연구: 빈 자리마다 가장 싼 것
  for (let n = 0; n < 2; n++) {
    let best = null, bc = Infinity;
    D.RESEARCH.forEach(r => {
      if (!R.resAvailable(P, r.id) || (P.rs[r.id] || 0) >= r.max || R.resQueued(P, r.id)) return;
      const cost = R.resCost(P, r.id); if (cost.mana > P.res.mana || cost.know > P.res.know) return;
      const pri = ['dual', 'expedition', 'assistant', 'sorter', 'storage'].includes(r.id) ? 0.05 : 1;
      const v = (cost.mana + cost.know * 20) * pri; if (v < bc) { bc = v; best = r.id; }
    });
    if (!best || !act('resStart', { id: best }, now)) break;
  }
  // 물약: 밤이면 숙면의 차, 낮이면 집중
  const night = ci + 1 < checkins.length && checkins[ci + 1] - now > 6 * 3600;
  if (P.grade >= 2) {
    const want = night && R.potionUnlocked(P, 'sleep') ? ['sleep'] : ['focus', 'valor', 'gilded'];
    for (const id of want) { if ((P.shelf[id] || 0) > 0 && !P.buffs['p_' + id]) act('drink', { id }, now); }
    for (const id of ['sleep', 'focus', 'valor', 'gilded']) { if (R.potionUnlocked(P, id) && (P.shelf[id] || 0) < 2) act('brew', { id, n: 2 }, now); }
  }
  // 사역마
  while (P.fam.eggs > 0 && act('egg', {}, now));
  Object.keys(P.fam.own).forEach(id => { if (R.feedCost(P, id) < P.res.gold * 0.15) act('feed', { id }, now); });
  let bf = null, bv = -1; for (const id in P.fam.own) { const f = R.FAM[id], v = f.r * 10 + P.fam.own[id].lv; if (v > bv && !P.fam.disp[id]) { bv = v; bf = id; } } if (bf) act('famAct', { id: bf }, now);
  const gap = ci + 1 < checkins.length ? checkins[ci + 1] - now : 43200;
  const dk = D.DISPATCH_DUR.slice().reverse().find(d => d.s <= gap + 1800) || D.DISPATCH_DUR[0];
  Object.keys(P.fam.own).forEach(id => { if (id !== P.fam.act) act('dispatch', { id, d: dk.k }, now); });
  // 정령 · 쪽지시험 · 월드보스
  act('spirit', {}, now);
  while (P.wb.tickets > 0 && act('wbAttack', {}, now));
  // 수업: 시험 과목 중 부족한 것부터
  const avail = R.availableSubjects(P).map(s => s.id);
  let want = ex && P.grade < 8 ? ex.subj.slice() : avail.slice();
  if (ex && want.every(s => P.subj[s].lv >= ex.req)) want = avail.slice();
  want.sort((a, b) => P.subj[a].lv - P.subj[b].lv);
  for (let i = 0; i < c.lecSlots; i++) if (!P.lec[i]) { const s = want.find(x => !P.lec.some(l => l && l.s === x)); if (s) act('lecStart', { slot: i, s, d: bestDur(now, ci + 1) }, now); }
  // 원정: 가장 효율 좋은 단계
  const bs = R.bestStage(P, W);
  for (let i = 0; i < c.expSlots; i++) if (!P.exp[i]) act('expStart', { slot: i, s: bs, d: bestDur(now, ci + 1) }, now);
}
const t0 = Date.now();
let day = -1;
checkins.forEach((t, i) => {
  bot(t, i);
  const d = Math.floor((t - EPOCH) / 86400);
  if (d !== day && [1, 3, 7, 14, 21, 30, 45, 60, 75, 90, 105, 120].includes(d)) {
    day = d; const c = R.calc(P, W, t);
    daily.push({ day: d, slots: c.lecSlots + '/' + c.expSlots + '/' + c.resSlots, lecSpd: c.lecSpd.toFixed(2), grade: R.gradeLabel(P), stage: P.maxStage, lvl: P.lvl, power: R.fmt(c.power), subj: Object.values(P.subj).map(s => s.lv).join('/'),
      gold: R.fmt(P.res.gold), mana: R.fmt(P.res.mana), know: R.fmt(P.res.know), shard: P.res.shard, rs: Object.values(P.rs).reduce((a, b) => a + b, 0),
      fam: Object.keys(P.fam.own).length, enh: Object.values(P.eq).map(i => i ? i.enh : '-').join(','), ach: Object.keys(P.ach).length });
  }
});
console.table(daily);
console.log(PROFILE, 'milestones(day):', JSON.stringify(Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, +v.toFixed(1)]))), 'kills', R.fmt(P.st.kills), 'lecHours', Math.round(P.st.lecHours), 'realtime', (Date.now() - t0) + 'ms');
const json = JSON.stringify(P); console.log('state size', (json.length / 1024).toFixed(1) + 'KB');
if (process.env.SAVE) require('fs').writeFileSync(process.env.SAVE, json);
