// 환수 교감 · 하늘섬 나들이 · 시즈널 축제 · 휴게실 납부 규칙 시험 (서버 없이): node tools/social-test.js
const assert = require('assert');
const R = require('../shared/rules.js');
const D = require('../shared/data.js');
const ep = Math.floor(Date.parse('2026-10-19T00:00:00+09:00') / 1000);
const W = { epoch: ep };
const errOf = (f) => { try { f(); } catch (e) { return e.message; } return ''; };
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

function student(t) { const P = R.newPlayer('p' + t, '시험', 'lanterna', t, 7); P.lvl = 30; P.grade = 4; P.res.gold = 1e7; P.res.mana = 1e9; P.mats.dust = 100; return P; }

// 1) 환수 교감: 하루 상한 · 횟수 · 좋아하는 것 · 능력치 무관
{
  let t = Date.parse('2026-10-22T12:00:00+09:00') / 1000; W.now = t;
  const P = student(t); P.fam.eggs = 1; const id = R.act(P, W, t, 'egg', {}).f, like = D.FAM_LIKES[id];
  const pw0 = R.calc(P, W, t).power;
  R.act(P, W, t, 'famShop', { id: like[0], n: 3 }); R.act(P, W, t, 'famShop', { id: like[1] });
  const r1 = R.act(P, W, t, 'famSnack', { id, s: like[0] }); ok(r1.like && r1.gain === D.FAM_SNACKS.find((x) => x.id === like[0]).v + D.BOND.snackLike, '좋아하는 간식 보너스');
  const r2 = R.act(P, W, t, 'famPlay', { id, t: like[1] }); ok(r2.like && r2.gain === D.BOND.playLike, '좋아하는 장난감 보너스');
  ok(/이미 함께 놀았습니다/.test(errOf(() => R.act(P, W, t, 'famPlay', { id, t: like[1] }))), '놀아 주기 하루 1번');
  for (let i = 0; i < 3; i++) errOf(() => R.act(P, W, t, 'famPet', { id }));
  ok(R.bondToday(P, id, t).got <= D.BOND.dayCap, '하루 유대 상한');
  ok(R.calc(P, W, t).power === pw0, '유대는 전투력에 영향 없음');
  ok(P.fam.own[id].lk && P.fam.own[id].lk.s && P.fam.own[id].lk.t, '좋아하는 것 공개');
  t += 86400; W.now = t; R.act(P, W, t, 'famPet', { id }); ok(R.bondToday(P, id, t).pet === 1, '날이 바뀌면 다시');
  ok(/교환소/.test(errOf(() => R.act(P, W, t, 'famShop', { id: 'pipe' }))) || errOf(() => R.act(P, W, t, 'famShop', { id: 'pipe' })), '축제 장난감은 상점에서 팔지 않음');
}

// 2) 축제: 달력으로 열림 · 표식 하루 상한 · 교환 · 끝나면 남은 표식 환산
{
  const t0 = Date.parse('2026-10-22T12:00:00+09:00') / 1000, nx = R.festNext(W, t0);
  ok(nx && nx.id === 'bell' && R.calendar(W, nx.start + 60).d === 22, '첫 축제는 피리달 22일 종탑 음악제');
  ok(!R.festAt(W, nx.start - 60) && R.festAt(W, nx.start + 60) && !R.festAt(W, nx.end + 60), '축제 기간');
  const t = nx.start + 3600; W.now = t; const P = student(t - 10); R.advance(P, W, t);
  ok(P.fest && P.fest.k === nx.k, '축제 기록 시작');
  for (let i = 0; i < 100; i++) R.cupAdd(P, 20, 'lec');
  ok(P.fest.tok === D.FEST_TOK.dayCap, '표식 하루 상한');
  P.fest.tok = 1000;
  R.act(P, W, t, 'festBuy', { id: 'fest_bell' }); ok(R.titleOk(P, 'fest_bell'), '축제 칭호');
  R.act(P, W, t, 'festBuy', { id: 's_fbell' }); ok(P.deco.own.s_fbell, '축제 인장');
  ok(/교환소/.test(errOf(() => R.act(P, W, t, 'decoBuy', { id: 's_fmask' }))), '축제 인장은 아르크로 살 수 없음');
  ok(/이미/.test(errOf(() => R.act(P, W, t, 'festBuy', { id: 'fest_bell' }))), '한 번만');
  const g0 = P.res.gold, left = P.fest.tok, te = nx.end + 100; W.now = te; R.advance(P, W, te);
  ok(P.fest.closed && P.fest.tok === 0 && P.res.gold > g0 && left > 0, '남은 표식 환산');
  ok(/열린 축제가 없습니다/.test(errOf(() => R.act(P, W, te, 'festBuy', { id: 'shard3' }))), '축제가 끝나면 교환 불가');
}

// 3) 하늘섬 나들이: 외출증 · 학년 · 밤 · 축제 섬
{
  const thu = Date.parse('2026-10-22T12:00:00+09:00') / 1000, sat = Date.parse('2026-10-24T12:00:00+09:00') / 1000, satN = Date.parse('2026-10-24T21:00:00+09:00') / 1000;
  const P = student(thu); P.grade = 2;
  ok(R.tripMax(W, thu) === 0 && R.tripMax(W, sat) === D.TRIP.weekend, '외출증은 주말');
  ok(/주말/.test(errOf(() => R.act(P, W, thu, 'tripGo', { id: 'porta' }))), '평일 외출 불가');
  ok(/학년/.test(R.isleWhy(P, W, sat, 'urania')) && /축제/.test(R.isleWhy(P, W, sat, 'terpsi')), '섬 제한');
  P.grade = 3; ok(/밤/.test(R.isleWhy(P, W, sat, 'urania')) && !R.isleWhy(P, W, satN, 'urania'), '우라니아는 밤에만');
  W.now = sat; R.act(P, W, sat, 'tripGo', { id: 'porta' });
  for (let i = 0; i < D.TRIP.cards; i++) R.act(P, W, sat, 'tripPick', { c: 0 });
  ok(!P.trip.cur && P.trip.visits === 1 && P.st.tripStamps === D.TRIP.cards, '나들이 마침');
  R.act(P, W, sat, 'tripGo', { id: 'canto' }); R.act(P, W, sat, 'tripLeave', {});
  ok(/모두 사용/.test(errOf(() => R.act(P, W, sat, 'tripGo', { id: 'porta' }))), '하루 외출증 2장');
}

// 4) 휴게실 납부: 종류마다 하루 한 번
{
  const t = Date.parse('2026-10-22T12:00:00+09:00') / 1000, P = student(t);
  ok(R.loungeMonth(W, t).p.id === D.LOUNGE_PROJECTS[0].id, '첫 달 과제');
  R.loungeGive(P, W, t, 'gold'); R.loungeGive(P, W, t, 'mana'); R.loungeGive(P, W, t, 'mat');
  ok(P.lounge.pts === 3 * D.LOUNGE.per && P.st.loungePts === 30, '납부 점수');
  ok(/이미/.test(errOf(() => R.loungeGive(P, W, t, 'gold'))), '하루 한 번');
  R.loungeGive(P, W, t + 86400, 'gold'); ok(P.lounge.pts === 40, '다음 날 다시');
}
// 5) 마이룸: 가진 것만 · 자리에 맞는 것만
{
  const t = Date.parse('2026-10-24T12:00:00+09:00') / 1000, P = student(t); W.now = t;
  if (R.ACTIONS.roomBuy) {
    R.act(P, W, t, 'roomBuy', { id: 'candle' }); ok(P.room.on.desk === 'candle', '빈 자리에 바로 놓기');
    ok(/놓을 수 없는/.test(errOf(() => R.act(P, W, t, 'roomSet', { slot: 'bed', id: 'candle' }))), '자리에 맞지 않는 가구');
    ok(/놓을 수 없는/.test(errOf(() => R.act(P, W, t, 'roomSet', { slot: 'shelf1', id: 'sv_cider' }))), '없는 기념품');
    P.trip = { souv: { sv_cider: 1 }, seen: {} }; R.act(P, W, t, 'roomSet', { slot: 'shelf2', id: 'sv_cider' }); ok(R.roomView(P).on.shelf2 === 'sv_cider', '기념품 선반');
    ok(R.roomText(R.roomView(P), W, t).length >= 3, '방 설명');
  }
}
console.log('통과 ' + n + '개');
