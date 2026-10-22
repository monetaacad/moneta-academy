'use strict';
// 기숙사 휴게실 복원: 아카데미력 한 달(28일)마다 기숙사별 협동 목표. 학생은 하루에 한 번씩 아르크 · 마나 · 재료를 납부한다 (R.loungeGive).
// 단계를 넘으면 사감이 기숙사 채팅에 알리고, 달이 바뀌면 일정 점수 이상 납부한 학생에게 별조각 우편을 보낸다
const R = require('../shared/rules.js');
const D = require('../shared/data.js');

function create({ dbx, store, world, sendMail, headSay, log }) {
  let st = dbx.kvGet('lounge', null);   // { mk, pid(프로젝트 id), h: { house: { pts, goals, members, stage, by: {pid: 점수} } }, prev: { mk, pid, h: { house: { stage, pts, n } } } }
  const qActive = dbx.db.prepare('SELECT COUNT(*) AS n FROM players WHERE banned = 0 AND house = ? AND last_seen > ?');
  const save = () => dbx.kvSet('lounge', st);

  function begin(m) {
    const since = Math.floor(Date.now() / 1000) - 7 * 86400, h = {};
    D.HOUSES.forEach((hh) => { const n = Math.max(D.LOUNGE.minMembers, Number(qActive.get(hh.id, since).n) || 0); h[hh.id] = { pts: 0, members: n, goals: D.LOUNGE.goals.map((g) => g * n), stage: 0, by: {} }; });
    st = { mk: m.mk, pid: m.p.id, h, prev: st && st.mk != null ? summary(st) : null };
    save(); log(`휴게실 복원 시작: ${m.p.name} (${m.month})`);
  }
  function summary(s) { const o = { mk: s.mk, pid: s.pid, h: {} }; Object.keys(s.h || {}).forEach((k) => { const x = s.h[k]; o.h[k] = { stage: x.stage, pts: x.pts, n: Object.keys(x.by || {}).length }; }); return o; }
  // 지난달 정산: minPts점 이상 낸 학생에게 단계마다 별조각
  function settle(s) {
    const proj = D.LOUNGE_PROJECTS.find((p) => p.id === s.pid) || D.LOUNGE_PROJECTS[0], exp = Math.floor(Date.now() / 1000) + 14 * 86400;
    Object.keys(s.h || {}).forEach((house) => {
      const x = s.h[house]; if (!x.stage) return;
      const hn = R.HOUSE[house] ? R.HOUSE[house].name : '기숙사';
      Object.keys(x.by).forEach((pid) => {
        if (x.by[pid] < D.LOUNGE.minPts) return;
        try { sendMail(pid, hn + ' 사감실', '휴게실 「' + proj.name + '」 복원 보상', '지난달 ' + hn + ' 휴게실 「' + proj.name + '」 복원이 ' + x.stage + '단계(' + proj.stages[x.stage - 1].name + ')까지 진행되었습니다.\n복원에 힘을 보탠 학생에게 감사의 뜻을 전합니다. (납부 ' + x.by[pid] + '점)', { shard: D.LOUNGE.shard * x.stage }, exp, true); } catch (e) { log('휴게실 보상 우편 실패', pid, e); }
      });
    });
    log(`휴게실 정산: ${proj.name}`);
  }
  function tick(now) {
    const m = R.loungeMonth(world.W, now); if (!m) return null;
    if (!st || st.mk !== m.mk) { if (st && st.mk != null && !st.paid) { st.paid = 1; save(); settle(st); } begin(m); }
    return m;
  }
  // 납부: 학생 쪽 차감은 규칙(R.loungeGive), 기숙사 진행도는 여기서
  function give(P, now, kind) {
    const m = tick(now); if (!m) throw Object.assign(new Error('아카데미력이 아직 정해지지 않았습니다'), { game: true });
    const x = st.h[P.house]; if (!x) throw Object.assign(new Error('기숙사를 찾을 수 없습니다'), { game: true });
    const pts = R.loungeGive(P, world.ctx(now), now, kind);
    x.pts += pts; x.by[P.id] = (x.by[P.id] || 0) + pts;
    const proj = D.LOUNGE_PROJECTS.find((p) => p.id === st.pid);
    let up = 0;
    while (x.stage < x.goals.length && x.pts >= x.goals[x.stage]) {
      const sg = proj.stages[x.stage]; x.stage++; up = x.stage;
      try { headSay(P.house, '휴게실 「' + proj.name + '」 ' + x.stage + '단계 ' + R.josa('「' + sg.name + '」', '을', '를') + ' 마쳤습니다. ' + sg.sc + (x.stage >= x.goals.length ? ' 이번 달 복원을 모두 마쳤습니다. 모두 수고했습니다.' : ' 다음 단계도 함께 힘을 모읍시다.')); } catch (e) { }
    }
    save();
    return { pts, up };
  }
  function view(P, now) {
    const m = tick(now); if (!m || !st) return null;
    const x = st.h[P.house] || { pts: 0, goals: [], stage: 0, by: {}, members: 0 };
    const top = Object.keys(x.by).sort((a, b) => x.by[b] - x.by[a]).slice(0, 10).map((pid) => { const r = dbx.q.getProfile.get(pid); return { id: pid, name: r ? r.name : '학생', pts: x.by[pid] }; });
    const prev = st.prev && st.prev.h ? st.prev.h[P.house] || null : null;
    return { mk: m.mk, pid: st.pid, start: m.start, end: m.end, month: m.month, pts: x.pts, goals: x.goals, members: x.members, stage: x.stage, mine: x.by[P.id] || 0, n: Object.keys(x.by).length, top, others: D.HOUSES.map((hh) => ({ id: hh.id, stage: (st.h[hh.id] || {}).stage || 0, pct: st.h[hh.id] && st.h[hh.id].goals.length ? Math.min(1, st.h[hh.id].pts / st.h[hh.id].goals[st.h[hh.id].goals.length - 1]) : 0 })), prev: prev ? Object.assign({ pid: st.prev.pid }, prev) : null, cost: R.loungeCost(P, world.ctx(now), now), today: R.loungeToday(P, world.ctx(now), now).k };
  }
  return { tick, give, view };
}
module.exports = { create };
