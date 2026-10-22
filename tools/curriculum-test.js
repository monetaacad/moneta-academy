/* 수업 개편(2차 베타) 규칙 시험: node tools/curriculum-test.js — 전공 짝 · 전과 연동 · 저장본 이주 · 수업 효율 · 지원 보너스 */
const R = require('../shared/rules.js'), D = require('../shared/data.js');
const assert = require('assert'); let ok = 0; const t = (n, f) => { f(); ok++; console.log('ok', n); };
const now0 = 1793000000, W = { epoch: now0 - 86400 * 10, now: now0, results: {}, lecPeers: {} };
function mk(cls) { const P = R.newPlayer('u' + cls, '시험' + cls, 'lanterna', now0, 1); R.clsStart(P, cls); return P; }
t('모든 과목 1학년부터 · 학과마다 13과목', () => { for (const c of ['mage', 'knight']) { const P = mk(c); assert.strictEqual(R.availableSubjects(P).length, 13); } });
t('짝 과목 수치 동일', () => { D.SUBJECTS.filter(s => s.pair).forEach(s => { const q = R.SUBJ[s.pair]; assert.strictEqual(q.pair, s.id); assert.deepStrictEqual(Object.values(s.lv || {}), Object.values(q.lv || {})); assert.deepStrictEqual(JSON.stringify((s.perk || []).map(p => [p[0], Object.values(p[1])])), JSON.stringify((q.perk || []).map(p => [p[0], Object.values(p[1])]))); assert.strictEqual(s.kind, q.kind); assert.strictEqual(!!s.sup, !!q.sup); }); });
t('짝 주문 수치 동일', () => { const sp = (sid) => D.SPELLS.filter(x => x.req && x.req[0] === sid).map(x => [x.req[1], x.type, x.mult, x.cd, x.stun || 0, x.dur || 0]); D.SUBJECTS.filter(s => s.pair && s.cls === 'mage').forEach(s => assert.deepStrictEqual(sp(s.id), sp(s.pair), s.id)); });
t('전과하면 전공 레벨이 이어진다 (기사→마법사→기사)', () => {
  const P = mk('knight'); P.lvl = 400; P.pts = 0; P.subj.sword = { lv: 14, xp: 5 }; P.subj.tactics = { lv: 9, xp: 1 }; P.tasks.sword = 1; P.res.gold = 1e9;
  let r = R.act(P, W, now0, 'clsExam', { cls: 'mage' });
  if (!r || P.cls !== 'mage') { console.log('  (시험관에게 짐 — 내부 함수로 대신)'); }
  assert.strictEqual(P.cls, 'mage'); assert.strictEqual(P.subj.arcana.lv, 14); assert.strictEqual(P.subj.syntax.lv, 9); assert.strictEqual(P.tasks.arcana, 1);
  P.subj.arcana.lv = 20; P.clsCd = 0;
  R.act(P, W, now0 + 100, 'clsExam', { cls: 'knight' }); assert.strictEqual(P.cls, 'knight'); assert.strictEqual(P.subj.sword.lv, 20);
});
t('숨은 짝 과목은 능력치 · 주문 · 과제 · 학점 이전에 쓰이지 않는다', () => {
  const P = mk('knight'); R.fixState(P); const c0 = R.calc(P, null).stat.int;
  P.subj.arcana = { lv: 30, xp: 0 }; assert.strictEqual(R.calc(P, null).stat.int, c0);
  assert.strictEqual(R.spellUnlocked(P, 'manaflare'), false);
  assert.throws(() => R.act(P, W, now0, 'task', { s: 'arcana' }));
  P.tok = { transfer: 1 }; assert.ok(R.subjTransferCheck(P, 'arcana', 'ward'));
});
t('예전 저장본 이주: 기사의 원소역학 · 주문구문학 레벨 → 원소검술 · 전술학', () => {
  const P = mk('knight'); delete P.pairV; delete P.subj.elemk; delete P.subj.tactics; P.subj.elem = { lv: 12, xp: 3 }; P.subj.syntax = { lv: 7, xp: 2 }; P.tasks.elem = 2; P.spells = ['flameblade', 'shieldbash'];
  R.fixState(P); assert.strictEqual(P.subj.elemk.lv, 12); assert.strictEqual(P.subj.tactics.lv, 7); assert.strictEqual(P.tasks.elemk, 2); assert.ok(P.spells.indexOf('flameblade') >= 0);
  R.fixState(P); assert.strictEqual(P.subj.elemk.lv, 12);   // 두 번 불러도 같다
});
t('공용 공격 주문은 주 공격력', () => { const P = mk('knight'); P.subj.astro.lv = 10; const c = R.calc(P, null); assert.ok(Math.abs(R.spellHit(c, R.SPELL.meteor) - c.patk * c.skill) < 1e-9); const M = mk('mage'); const cm = R.calc(M, null); assert.ok(Math.abs(R.spellHit(cm, R.SPELL.meteor) - cm.matk * cm.spell) < 1e-9); });
t('수업 효율: 기사 전공은 체력, 지력 수업은 지력', () => { const P = mk('knight'); const c = R.calc(P, null); assert.ok(Math.abs(R.lecSpdOf(P, c, 'sword') - (c.lecSpd0 + c.stat.vit * 0.0008)) < 1e-9); assert.ok(Math.abs(R.lecSpdOf(P, c, 'ward') - (c.lecSpd0 + c.stat.int * 0.0008)) < 1e-9); assert.strictEqual(R.lecStat(P, 'rune'), 'vit'); });
t('과목 레벨 보상 · 치유 위력 · 지원 보너스', () => { const P = mk('mage'); P.subj.bless.lv = 25; P.subj.rescue.lv = 15; const c = R.calc(P, null); assert.ok(Math.abs(c.care - 1 - 0.25 - 0.075) < 1e-9, c.care); assert.ok(Math.abs(c.supRed - 0.09) < 1e-9); assert.ok(Math.abs(c.supAtk - 0.16) < 1e-9); });
t('학기 이야기 목표의 전공 과목은 학과 짝으로', () => { const P = mk('knight'); P.subj.elemk.lv = 22; assert.strictEqual(R.subjFor(P, 'elem'), 'elemk'); assert.strictEqual(R.subjFor(P, 'ward'), 'ward'); });
t('시험 공통 과목은 지력 1 · 체력 1', () => { D.EXAMS.forEach(e => { const l = e.subj.map(s => R.SUBJ[s].lst).sort().join(); assert.strictEqual(l, 'int,vit', e.title); }); });
t('전체 능력치 화면', () => { const P = mk('knight'); P.subj.guard.lv = 12; const fs = R.fullStats(P, W, now0); assert.ok(JSON.stringify(fs).indexOf('수호기사학 Lv 12') >= 0); });
t('연금 공방은 연금화학 3레벨부터 (학년 무관)', () => { const P = mk('mage'); assert.strictEqual(P.grade, 1); assert.strictEqual(R.alchOpen(P), false); assert.strictEqual(R.potionUnlocked(P, 'focus'), false); P.subj.alch.lv = 3; assert.strictEqual(R.alchOpen(P), true); assert.strictEqual(R.potionUnlocked(P, 'focus'), true); assert.strictEqual(R.potionUnlocked(P, 'guard'), false); });
console.log(ok + '개 통과');
