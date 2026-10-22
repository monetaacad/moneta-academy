/* 밸런스 시뮬레이터: 접속 패턴별 봇이 실제 규칙(shared/rules.js의 R.act)으로 N일 동안 플레이한다.
   사용법: node tools/sim.js [일수=120] [casual|steady|hardcore|active] [--csv 파일.csv] [--cls mage|knight] [--seed 숫자] [--spread] [--switch 일]
     --spread: 시험 과목이 기준 레벨을 넘으면 모든 과목 중 가장 낮은 과목부터 (기본은 시험 과목 +4까지) · --switch N: N일째부터 다른 학과로 전과시험 (질 때마다 다음 날 다시)
   active: 정해진 시각이 아니라 수업 · 원정 · 연구가 끝날 때마다(1~5분 뒤) 돌아오는 학생 (깨어 있는 8~24시). 알림을 켜 둔 상위권 학생 기준
     예) node tools/sim.js 120 steady --csv out.csv
   출력: 주요 날짜(1·3·7·14·21·30·45·60·90·120…)의 성장표, --csv를 주면 날마다 한 줄씩 CSV로 저장한다.
   gearPow%: 전투력 중 장비 몫 (장착 장비를 모두 뺀 전투력과 비교). V=1이면 진급 · 보스 기록을 출력한다. SAVE=파일이면 마지막 상태를 JSON으로 저장한다.
   봇이 하는 일: 출석 · 일일 의뢰 · 원정 완료/출정 · 수업(+다음 교시 예약) · 연구 · 시험 · 보스 · 결투제 · 무한의 탑 · 월드 보스 · 정령 · 사역마(품기/부화/파견) ·
   물약(양조/복용) · 장비(자동 장착, 레벨 제한 R.canWear) · 강화 · 분해/판매 · 능력치 자동 분배 · 학기 이야기 · 교수님 과제 · 밤에는 꿈길. */
const fs = require('fs');
const R = require('../shared/rules.js'), D = require('../shared/data.js');

const argv = process.argv.slice(2), flags = {}, pos = [];
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; else pos.push(argv[i]); }
const DAYS = +(pos[0] || 120), PROFILE = pos[1] || 'steady', VERBOSE = process.env.V === '1', CLS = flags.cls === 'knight' ? 'knight' : 'mage', SPREAD = !!flags.spread, SWITCH = +(flags.switch || 0);
const PROFILES = {
  casual: [8, 12.5, 19, 23],                                // 출근 전 · 점심 · 퇴근 후 · 자기 전
  steady: [8, 10, 12, 14, 16, 18, 20, 22, 23.5],           // 깨어 있는 동안 2시간마다
  hardcore: Array.from({ length: 17 }, (_, i) => 8 + i),   // 깨어 있는 동안 1시간마다
  active: []                                                // 접속 시각을 미리 정하지 않는다 (작업이 끝날 때마다 · nextActive)
};
if (!PROFILES[PROFILE]) { console.error('profile: casual | steady | hardcore | active'); process.exit(1); }
const ACTIVE = PROFILE === 'active';
const hours = PROFILES[PROFILE];
const EPOCH = Date.UTC(2026, 10, 2, 0, 0, 0) / 1000 - 9 * 3600; // 2026-11-02(월) 00:00 KST
const W = { epoch: EPOCH, now: EPOCH, wbAlive: true, results: {}, lecPeers: {} };
let rngSeed = +(flags.seed || 12345); function mr() { rngSeed = (rngSeed * 1103515245 + 12345) & 0x7fffffff; return rngSeed / 0x7fffffff; }
const P = R.newPlayer('bot', '봇', 'lanterna', EPOCH + 9 * 3600, 777);
R.clsStart(P, CLS);
const checkins = [];
for (let d = 0; d < DAYS; d++) for (const h of hours) checkins.push(EPOCH + d * 86400 + h * 3600 + Math.floor(mr() * 600));
// active: 8~24시에 깨어 있다. 자는 동안 끝난 작업은 다음 날 8시(+0~10분)에 받는다
const T_END = EPOCH + DAYS * 86400, WAKE = 8 * 3600;
const awake = (t) => (t - EPOCH) % 86400 >= WAKE;
const nextWake = (t) => { const d0 = EPOCH + Math.floor((t - EPOCH) / 86400) * 86400; return (awake(t) ? d0 + 86400 : d0) + WAKE + Math.floor(mr() * 600); };
const backAt = (end) => awake(end) ? end + 60 + Math.floor(mr() * 240) : nextWake(end);
const ms = {}, rows = [], errs = {};
function act(type, a, now) {
  try { return R.act(P, W, now, type, a); }
  catch (e) { if (!e.game) throw e; errs[type] = (errs[type] || 0) + 1; return null; }
}
const DAY = (t) => (t - EPOCH) / 86400;
const note = (t, m) => { if (VERBOSE) console.log('day ' + DAY(t).toFixed(1) + ': ' + m); };

// 다음 접속까지 기다리는 시간까지 고려해 시간당 산출이 가장 큰 길이 (수업 · 원정 공통)
function bestDur(now, nextIdx) {
  let best = '1h', bv = 0;
  for (const d of D.DURATIONS) {
    const end = now + d.s; let back = null;
    if (ACTIVE) back = awake(end) ? end : nextWake(end);
    else for (let k = nextIdx; k < checkins.length; k++) if (checkins[k] >= end) { back = checkins[k]; break; }
    if (!back) back = end;
    const v = d.s * d.eff / (back - now);
    if (v > bv + 1e-9) { bv = v; best = d.k; }
  }
  return best;
}
function power() { return R.calc(P, null).power; }
// 장비 몫: 장착 장비를 모두 뺀 전투력과 비교
function gearShare() {
  const full = power(), keep = P.eq; P.eq = {}; for (const s in keep) P.eq[s] = null;
  let bare; try { bare = R.calc(P, null).power; } finally { P.eq = keep; }
  return full > 0 ? 1 - bare / full : 0;
}
// 가방 장비 정리: 장착 가능한 더 좋은 장비는 장착, 레벨이 곧 닿을 좋은 장비는 남기고, 나머지는 분해(고급 이상) · 판매(일반)
function manageGear(now) {
  for (const it of P.inv.slice()) if (R.canWear(P, it) && R.powerWith(P, it) > power() * 1.001) act('equip', { u: it.u }, now);
  const bag = R.calc(P, null).bag, keepN = Math.floor(bag / 2), keep = new Set();
  P.inv.filter(it => it.ilvl > P.lvl && it.ilvl <= P.lvl + 8 && (!P.eq[it.slot] || it.ilvl * (1 + it.r * 0.3) > P.eq[it.slot].ilvl * (1 + P.eq[it.slot].r * 0.3)))
    .sort((a, b) => a.ilvl - b.ilvl).slice(0, keepN).forEach(it => keep.add(it.u));
  for (const it of P.inv.slice()) { if (keep.has(it.u) || it.lock) continue; act(it.r >= 1 ? 'dismantle' : 'sell', { u: it.u }, now); }
  // 가방이 넘쳐 우편으로 간 장비: 받아서 같은 방식으로
  if (P.mailQ && P.mailQ.length) {
    const q = P.mailQ; P.mailQ = []; R.noMailQ = true;
    try { q.forEach(it => R.gainItem(P, it, now)); } finally { R.noMailQ = false; }
    for (const it of P.inv.slice()) if (!keep.has(it.u) && !it.lock && !(R.canWear(P, it) && R.powerWith(P, it) > power() * 1.001)) act(it.r >= 1 ? 'dismantle' : 'sell', { u: it.u }, now);
  }
}
function placeSpells() {
  const ns = R.spellSlots(P), sp = D.SPELLS.filter(s => R.spellUnlocked(P, s.id));
  const val = s => s.type === 'shield' ? 4 : s.type === 'heal' ? 3.5 : s.type === 'haste' || s.type === 'amp' ? 3 : (s.mult || 1) / (s.cd || 1);
  const order = sp.slice().sort((a, b) => val(b) - val(a)).slice(0, ns);
  for (let i = 0; i < ns; i++) P.spells[i] = order[i] ? order[i].id : null;
}

function bot(now, ci) {
  W.now = now;
  R.advance(P, W, now);
  const gap = ACTIVE ? (awake(now + 3600) ? 3600 : nextWake(now) - now) : ci + 1 < checkins.length ? checkins[ci + 1] - now : 43200, night = gap > 6 * 3600;
  if (P.daily.login) act('login', {}, now);
  P.daily.q.forEach((q, i) => { if (!q.done && R.dailyProg(P, q) >= q.goal) act('daily', { i }, now); });
  if (P.wkPrev && !P.wkPrev.claimed) { W.results[P.wkPrev.id] = { cup: ['lanterna', 'corona', 'speculum', 'clepsydra'].sort(() => mr() - 0.5), killed: true, tiers: [1e30, 1e30, 0] }; act('weekClaim', {}, now); }
  // 원정 완료 받기 (끝난 원정은 저절로 받지 않는다)
  P.exp.forEach((j, i) => { if (j && R.expEnd(j) <= now) act('expClaim', { slot: i }, now); });
  if (P.inbox.length) act('inboxAck', {}, now);
  while (R.mqReady(P) && act('mqClaim', {}, now));
  for (const sid in P.subj) { const o = R.taskOf(P, sid); if (o && R.taskProg(P, sid, o.t) >= o.t.n) act('task', { s: sid }, now); }
  if (!P.opt.autoAlloc) act('opt', { k: 'autoAlloc', v: true }, now);
  if (!P.opt.autoEquip) act('opt', { k: 'autoEquip', v: true }, now);
  placeSpells();
  manageGear(now);
  const ex = R.examFor(P);
  // 시험: 예상 점수가 충분하면
  if (ex && P.grade < 8 && P.examCd <= now && R.examEligible(P, ex)) {
    const pr = R.examPredict(P, W, now);
    if (pr && pr.total >= 64) { const r = act('exam', {}, now); if (r && r.pass) { ms['g' + P.grade] = DAY(now); note(now, `${r.grade}학년 시험 ${r.letter} ${r.total} lv${P.lvl} stage${P.maxStage}`); } }
  }
  // 전과: --switch N일째부터 다른 학과로 (시험에 지면 하루 뒤 다시)
  if (SWITCH && DAY(now) >= SWITCH && P.cls === CLS && (P.clsCd || 0) <= now) { const to = CLS === 'knight' ? 'mage' : 'knight', r = act('clsExam', { cls: to }, now); if (P.cls === to) { ms.switch = DAY(now); note(now, '전과 ' + to + ' ' + JSON.stringify(R.availableSubjects(P).filter(s => s.cls).map(s => s.id + P.subj[s.id].lv))); } }
  // 보스
  // 미리보기(45초 기준)는 실제 전투(30초)보다 보수적이라 체력의 절반 이상 깎을 수 있으면 도전한다 (지면 10분 대기뿐)
  for (let k = 0; k < 5; k++) {
    if (P.bossCd > now || !R.canChallenge(P)) break;
    const b = R.nextBoss(P), pv = R.duelPreview(P, W, b, R.K.BOSS_HP, R.K.BOSS_ATK, now);
    if (!(pv.win && pv.ttk <= R.K.BOSS_TIME) && pv.frac * Math.min(1, R.K.BOSS_TIME / Math.max(1e-9, pv.ttd)) < 0.5 && pv.frac < 0.5) break;
    const r = act('boss', {}, now); if (!r || !r.win) break;
    ms['boss' + b] = ms['boss' + b] || DAY(now); note(now, `boss ${b} 처치 lv${P.lvl}`);
  }
  // 결투제
  if (R.rival(P) && P.duel.cd <= now) { const pv = R.rivalPreview(P, W); if (pv && pv.win) act('duel', {}, now); }
  // 무한의 탑: 지면 그만 (패배 페널티 없음)
  for (let k = 0; k < 8; k++) { const r = act('ctower', {}, now); if (!r || !r.win) break; }
  // 월드 보스 · 정령 · 하늘
  while (R.wbCanAttack(P, now) && act('wbAttack', {}, now));
  if (R.spiritJar(P, now).n > 0) act('spirit', {}, now);
  if (R.skyAt && R.skyAt(now) && P.skyLook !== R.skyAt(now).key) act('skyLook', {}, now);
  manageGear(now);   // 보스 · 탑 · 이야기 보상 장비
  // 강화: 싼 것부터, 아르크 절반까지
  for (let n = 0; n < 20; n++) {
    let best = null, bc = Infinity;
    for (const s in P.eq) { const it = P.eq[s]; if (!it || it.enh >= R.ENH_MAX) continue; const cost = R.enhCost(P, it); if (cost.gold < bc && cost.gold <= P.res.gold * 0.5 && cost.stone <= P.res.stone) { bc = cost.gold; best = it; } }
    if (!best || !act('enhance', { u: best.u }, now)) break;
  }
  if (P.res.stone < 4 && P.res.gold > R.shopPrice(P, 'stone10') * 4) act('buy', { id: 'stone10' }, now);
  // 휘장: 레벨이 가장 높은 것을 달고, 마석가루가 넉넉하면 닦는다
  if (P.badges && P.badges.length) {
    const top = P.badges.slice().sort((a, b) => b.lv - a.lv)[0]; if (P.badgeOn !== top.u) act('badgeWear', { u: top.u }, now);
    const bw = R.badgeWorn(P);
    for (let n = 0; n < 3 && bw && bw.lv < R.BADGE_MAX; n++) { const c = R.badgePolishCost(P, bw); if ((P.res.dust || 0) < c.dust * 2 || P.res.gold < c.gold * 3) break; act('badgePolish', { u: bw.u }, now); }
  }
  // 연구: 빈 자리마다 (분류 마법 · 보관 우선, 그 외 가장 싼 것)
  const rsN = R.calc(P, W, now).resSlots;
  for (let n = 0; n < rsN && P.rsq.slice(0, rsN).some(q => !q); n++) {
    let best = null, bc = Infinity;
    D.RESEARCH.forEach(r => {
      if (!R.resAvailable(P, r.id) || (P.rs[r.id] || 0) >= r.max || R.resQueued(P, r.id)) return;
      const cost = R.resCost(P, r.id); if (cost.mana > P.res.mana || cost.know > P.res.know) return;
      const pri = ['sorter', 'storage'].includes(r.id) ? 0.05 : 1;
      const v = (cost.mana + cost.know * 20) * pri; if (v < bc) { bc = v; best = r.id; }
    });
    if (!best || !act('resStart', { id: best }, now)) break;
  }
  // 물약: 밤이면 숙면의 차, 낮이면 집중 · 투지 · 황금 · 행운 · 현자
  const DAYPOT = ['focus', 'valor', 'gilded', 'fortune', 'sage'];
  if (R.alchOpen ? R.alchOpen(P) : P.grade >= 2) {
    const want = night ? ['sleep'] : DAYPOT;
    for (const id of want) if ((P.shelf[id] || 0) > 0 && !(P.buffs['p_' + id] && P.buffs['p_' + id].end > now + 1800)) act('drink', { id }, now);
    for (const id of ['sleep'].concat(DAYPOT)) if (R.potionUnlocked(P, id) && (P.shelf[id] || 0) < 2 && P.res.mana > R.brewMana(P, W, now, id) * 4 && Object.keys(R.POT[id].mats).every(m => (P.mats[m] || 0) >= R.POT[id].mats[m] * 2)) act('brew', { id, n: 2 }, now);
  }
  // 사역마: 알 품기 · 부화 · 먹이 · 동행 · 파견
  if (R.famOpen(P)) {
    if (P.fam.inc && P.fam.inc.prog >= P.fam.inc.need) act('eggHatch', {}, now);
    if (!P.fam.inc && P.fam.eggs > 0) act('eggInc', {}, now);
    for (let n = 0; n < 3 && P.fam.eggs > 0; n++) { if (P.res.mana < R.eggManaCost(P, W, now) * 3 || !act('egg', {}, now)) break; if (!P.fam.inc && P.fam.eggs > 0) act('eggInc', {}, now); }
    Object.keys(P.fam.own).forEach(id => { if (P.fam.own[id].lv < 20 && R.feedCost(P, id) < P.res.gold * 0.15) act('feed', { id }, now); });
    let bf = null, bv = -1; for (const id in P.fam.own) { const f = R.FAM[id], v = f.r * 100 + P.fam.own[id].lv; if (v > bv && !P.fam.disp[id]) { bv = v; bf = id; } }
    if (bf && P.fam.act !== bf) act('famAct', { id: bf }, now);
    const dk = D.DISPATCH_DUR.slice().reverse().find(d => d.s <= gap + 1800) || D.DISPATCH_DUR[0];
    if (Object.keys(P.fam.own).some(id => !P.fam.disp[id] && P.fam.act !== id)) act('dispatchAll', { d: dk.k }, now);
  }
  // 수업: 시험 과목(선택 과목 포함) 중 낮은 것부터, 끝나면 다음 교시 예약
  const c = R.calc(P, W, now), avail = R.availableSubjects(P).map(s => s.id);
  let want = ex && P.grade < 8 ? R.examSubjs(P, ex) : avail.slice();
  if (ex && P.grade < 8 && want.every(s => P.subj[s].lv >= ex.req + (SPREAD ? 0 : 4))) want = avail.slice();
  want.sort((a, b) => P.subj[a].lv - P.subj[b].lv);
  const ld = bestDur(now, ci + 1);
  for (let i = 0; i < c.lecSlots; i++) {
    if (!P.lec[i]) { const s = want.find(x => !P.lec.some(l => l && l.s === x)) || avail.find(x => !P.lec.some(l => l && l.s === x)); if (s) act('lecStart', { slot: i, s, d: ld }, now); }
    const j = P.lec[i]; if (j && !ACTIVE && !(P.lecQ && P.lecQ[i]) && j.end < now + gap) act('lecQueue', { slot: i, s: j.s, d: night ? '3h' : ld }, now);   // 다음 교시 예약 (active는 끝날 때 돌아와 과목을 다시 고른다)
  }
  // 원정: 가장 효율 좋은 단계
  const bs = R.bestStage(P, W), ed = bestDur(now, ci + 1);
  for (let i = 0; i < c.expSlots; i++) if (!P.exp[i]) act('expStart', { slot: i, s: bs, d: ed }, now);
  // 밤: 꿈길 (수업 · 원정을 맡긴 뒤에)
  if (night && !P.dream) {
    const dd = D.DREAM_DUR.slice().reverse().find(d => d.s <= gap) || D.DREAM_DUR[0];
    const low = (ex && P.grade < 8 ? R.examSubjs(P, ex) : avail).slice().sort((a, b) => P.subj[a].lv - P.subj[b].lv)[0];
    const lag = ex && P.grade < 8 && P.subj[low].lv < ex.req;
    act('dreamStart', lag ? { kind: 'study', s: low, d: dd.k } : { kind: 'wander', d: dd.k }, now);
  }
}

function snapshot(t) {
  const c = R.calc(P, W, t), eq = D.SLOTS.map(s => P.eq[s.id]), worn = eq.filter(Boolean);
  const avail = R.availableSubjects(P).map(s => P.subj[s.id].lv), bw = R.badgeWorn(P);
  const RN = ['N', 'U', 'R', 'E', 'L'];   // 일반 · 고급 · 희귀 · 영웅 · 전설
  return {
    day: 0, grade: R.gradeLabel(P), lvl: P.lvl, stage: P.maxStage, cap: R.stageCap(P), power: Math.round(c.power),
    gearPow: Math.round(gearShare() * 1000) / 10, ilvl: worn.length ? Math.round(worn.reduce((a, i) => a + i.ilvl, 0) / worn.length * 10) / 10 : 0,
    ilvls: eq.map(i => i ? i.ilvl : '-').join('/'), rar: eq.map(i => i ? RN[i.r] : '-').join(''), enh: eq.map(i => i ? i.enh : '-').join('/'),
    overLv: worn.filter(i => i.ilvl > P.lvl).length, badge: bw ? bw.lv : 0, gold: Math.floor(P.res.gold), mana: Math.floor(P.res.mana), know: Math.floor(P.res.know),
    kills: P.st.kills, expJobs: P.st.expJobs, lecJobs: P.st.lecJobs, bosses: P.st.bosses, tower: R.ctBest(P), duel: P.duel.rank, rs: Object.values(P.rs).reduce((a, b) => a + b, 0),
    fam: Object.keys(P.fam.own).length, subjMin: Math.min(...avail), subjAvg: Math.round(avail.reduce((a, b) => a + b, 0) / avail.length * 10) / 10, subjMax: Math.max(...avail),
    slots: c.lecSlots + '/' + c.expSlots + '/' + c.resSlots
  };
}

const t0 = Date.now();
const dayOf = (t) => Math.floor(DAY(t - 4 * 3600)) + 1;   // 하루는 새벽 4시에 끝난다 (자정 넘은 접속은 그날로). day 1 = 첫날
// active: 다음 접속 = 수업 · 원정 · 연구 중 가장 먼저 끝나는 때 (자는 동안이면 다음 날 아침)
function nextActive(now) {
  const ends = [].concat(P.lec.map(j => j && j.end), P.exp.map(j => j && R.expEnd(j)), P.rsq.map(q => q && q.end)).filter(e => e > now);
  return Math.max(now + 60, backAt(ends.length ? Math.min(...ends) : now + 1800));
}
for (let i = 0, t = ACTIVE ? EPOCH + WAKE : checkins[0]; t != null && (!ACTIVE || t < T_END); i++) {
  if (ACTIVE) checkins[i] = t;
  bot(t, i);
  const nt = ACTIVE ? nextActive(t) : checkins[i + 1];
  if (nt == null || (ACTIVE && nt >= T_END) || dayOf(nt) !== dayOf(t)) { const r = snapshot(t); r.day = dayOf(t); rows.push(r); }   // 그날 마지막 접속 뒤 상태
  t = nt;
}
const MILES = [1, 3, 7, 14, 21, 30, 45, 60, 75, 90, 105, 120, 150, 180, 240, 365].filter(d => d <= DAYS);
if (!MILES.includes(DAYS)) MILES.push(DAYS);
const F = R.fmt;
console.table(rows.filter(r => MILES.includes(r.day)).map(r => ({
  day: r.day, grade: r.grade, lvl: r.lvl, stage: r.stage + '/' + (r.cap >= 1e8 ? '∞' : r.cap), power: F(r.power), 'gearPow%': r.gearPow, ilvl: r.ilvl, rar: r.rar, enh: r.enh,
  badge: r.badge, gold: F(r.gold), mana: F(r.mana), kills: F(r.kills), subj: r.subjMin + '/' + r.subjAvg + '/' + r.subjMax, tower: r.tower
})));
const end = rows[rows.length - 1];
console.log(PROFILE, CLS + (ms.switch ? '→' + P.cls + '(day ' + ms.switch.toFixed(1) + ')' : ''), 'milestones(day):', JSON.stringify(Object.fromEntries(Object.entries(ms).filter(([k]) => k[0] === 'g').map(([k, v]) => [k, +v.toFixed(1)]))),
  '| bosses', end.bosses, 'expJobs', end.expJobs, 'lecJobs', end.lecJobs, 'duel', end.duel, 'rs', end.rs, 'fam', end.fam, 'slots', end.slots, 'overLv(eq ilvl>lvl)', Math.max(...rows.map(r => r.overLv)),
  '| realtime', (Date.now() - t0) + 'ms');
if (VERBOSE) console.log('거절된 행동(횟수):', JSON.stringify(errs));
if (flags.csv && flags.csv !== true) {
  const cols = Object.keys(rows[0]), esc = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  fs.writeFileSync(flags.csv, '﻿' + [cols.join(',')].concat(rows.map(r => cols.map(k => esc(r[k])).join(','))).join('\n') + '\n');
  console.log('CSV:', flags.csv, rows.length + '행');
}
if (process.env.SAVE) fs.writeFileSync(process.env.SAVE, JSON.stringify(P));
