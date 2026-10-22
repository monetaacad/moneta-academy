'use strict';
// 시즈널 축제: 아카데미 달력으로 저절로 열리고 닫힌다 (R.festAt). 모든 학생의 축제 표식 합계로 공동 목표를 세고,
// 단계를 넘을 때마다 그때까지 표식을 모은 학생 모두에게 보상 우편. 축제가 끝나면 늦게 참여한 학생에게도 넘은 단계 보상을 한 번 더 보낸다
const R = require('../shared/rules.js');
const D = require('../shared/data.js');

const SUM_EVERY = 30;   // 합계는 30초마다 다시 센다 (학생 상태는 5초마다 저장된다)

function create({ dbx, store, world, sendMail, chat, log }) {
  let st = dbx.kvGet('fest', null);   // { k, id, start, end, goals, total, stage, paid: [[pid...]...], fin }
  let sumAt = 0;
  const q = {
    sum: dbx.db.prepare("SELECT COALESCE(SUM(CAST(json_extract(state, '$.fest.got') AS INTEGER)), 0) AS s, COUNT(*) AS n FROM players WHERE banned = 0 AND json_extract(state, '$.fest.k') = ? AND CAST(json_extract(state, '$.fest.got') AS INTEGER) > 0"),
    who: dbx.db.prepare("SELECT id FROM players WHERE banned = 0 AND json_extract(state, '$.fest.k') = ? AND CAST(json_extract(state, '$.fest.got') AS INTEGER) > 0"),
    active: dbx.db.prepare('SELECT COUNT(*) AS n FROM players WHERE banned = 0 AND last_seen > ?')
  };
  const save = () => dbx.kvSet('fest', st);
  const fname = (id) => (R.FEST[id] ? R.FEST[id].name : '축제');

  function begin(cur) {
    const act = Math.max(D.FEST_TOK.minActive, Number(q.active.get(Math.floor(Date.now() / 1000) - 7 * 86400).n) || 0);
    st = { k: cur.k, id: cur.id, start: cur.start, end: cur.end, goals: D.FEST_TOK.goals.map((g) => g * act), active: act, total: 0, n: 0, stage: 0, paid: D.FEST_TOK.goals.map(() => []), fin: 0 };
    save(); sumAt = 0;
    const t = '「' + fname(cur.id) + '」가 시작되었습니다. 평소처럼 활동하면 축제 표식이 모이며, 모든 학생의 표식이 공동 목표에 닿을 때마다 참여한 학생 모두에게 보상 우편이 전달됩니다.';
    chat.system('notice', t, Date.now() / 1000); world.addNotice(t, world.W.now, true);
    log(`축제 시작: ${fname(cur.id)} (${cur.k}, 활동 학생 ${act}명 기준, 목표 ${st.goals.join(' / ')})`);
  }
  // 단계 i 보상: 아직 받지 않은 참여 학생에게
  function pay(i) {
    store.flushAll();
    const done = new Set(st.paid[i]), rw = D.FEST_REWARDS[i] || {}, exp = Math.floor(Date.now() / 1000) + 14 * 86400;
    const title = '「' + fname(st.id) + '」 공동 목표 ' + (i + 1) + '단계 달성';
    const body = '모든 학생이 모은 축제 표식이 ' + R.fmt(st.goals[i]) + '개를 넘어 공동 목표 ' + (i + 1) + '단계를 달성했습니다.\n축제 표식을 모은 모든 학생에게 전달되는 보상입니다.';
    let n = 0;
    q.who.all(st.k).forEach((r) => { if (done.has(r.id)) return; try { sendMail(r.id, '축제 운영위원회', title, body, rw, exp, true); st.paid[i].push(r.id); n++; } catch (e) { log('축제 보상 우편 실패', r.id, e); } });
    save(); if (n) log(`축제 보상 우편: ${title} → ${n}명`);
  }
  function recount() {
    const r = q.sum.get(st.k); st.total = Number(r.s) || 0; st.n = Number(r.n) || 0; sumAt = Date.now();
    while (st.stage < st.goals.length && st.total >= st.goals[st.stage]) {
      const i = st.stage; st.stage++; save();
      const t = '「' + fname(st.id) + '」 공동 목표 ' + (i + 1) + '단계를 달성했습니다. 축제 표식을 모은 모든 학생에게 보상 우편이 전달됩니다.';
      chat.system('notice', t, Date.now() / 1000); chat.system('world', t, Date.now() / 1000);
      pay(i);
    }
  }
  function finish() {
    store.flushAll(); recount();
    for (let i = 0; i < st.stage; i++) pay(i);   // 늦게 참여한 학생에게도
    st.fin = 1; save();
    log(`축제 종료: ${fname(st.id)} · 표식 ${st.total}개 · 참여 ${st.n}명 · ${st.stage}단계`);
  }
  function tick(now) {
    const cur = R.festAt(world.W, now);
    if (st && !st.fin && (!cur || cur.k !== st.k)) finish();
    if (cur && (!st || st.k !== cur.k)) begin(cur);
    if (st && !st.fin && Date.now() - sumAt > SUM_EVERY * 1000) recount();
  }
  // 화면에 보내는 것 (열린 축제가 없으면 지난 축제 결과)
  function view() { return st ? { k: st.k, id: st.id, start: st.start, end: st.end, goals: st.goals, total: st.total, n: st.n, stage: st.stage, fin: !!st.fin } : null; }
  // 시험 서버 전용: 축제를 지금부터 hours시간 동안 연다 (id 없이 부르면 해제)
  function force(id, hours, now) {
    if (id && !R.FEST[id]) throw new Error('없는 축제입니다');
    world.W.festF = id ? { id, start: Math.floor(now), end: Math.floor(now + Math.max(0.1, Number(hours) || 24) * 3600) } : null;
    dbx.kvSet('festF', world.W.festF); tick(now); world.invalidate();
    return world.W.festF;
  }
  return { tick, view, force };
}
module.exports = { create };
