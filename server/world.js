'use strict';
// 서버 공용 세계: 아카데미력, 주간 월드 보스, 기숙사 대항전, 지난주 결과, 랭킹
const R = require('../shared/rules.js');
const D = require('../shared/data.js');

const CUP_TOP = 30;            // 기숙사 성장(hbase)은 그대로 상위 30명 합계. 대항전 순위는 R.cupScore(활동 학생 평균)
const WB_PARTICIPATION = 0.45; // 활동 학생 중 도전권을 쓰는 비율 추정
const WB_DAYS_TO_KILL = 4.5;   // 이 정도 날짜에 쓰러지도록 체력 설정

function create(store, cfg, log) {
  const { kvGet, kvSet, q } = store;
  const W = {
    epoch: kvGet('epoch', null),
    boss: kvGet('boss', null),          // {week, id, maxHp, hp, killedAt, attackers}
    results: kvGet('results', {}),      // weekId → {cup:[houses], cupScores, killed, tiers:[t1,t10,t50], bossName}
    notices: kvGet('notices', []),
    news: kvGet('news', []),            // 아카데미 소식: 새 학생 입학 · 진급 (자동)
    now: Date.now() / 1000,
    wbAlive: true,
    hbase: kvGet('hbase', {}),          // 기숙사 성장: 끝난 주의 대항전 점수 누적
    hpts: {}, hfull: cfg.houseFull || R.HOUSE_FULL, hAt: 0   // hpts = hbase + 이번 주 점수 (R.housePct)
  };
  if (!W.epoch) {
    W.epoch = cfg.epoch || Math.floor(Date.now() / 1000);
    kvSet('epoch', W.epoch);
    log('서버 개교일 설정:', new Date(W.epoch * 1000).toISOString());
  }
  // 한 번만: 서버를 다시 만들며 개교일이 2026-10-20으로 잡힌 것을 처음 배포한 날(10-19)로 되돌린다
  if (!kvGet('epochFix1019', 0)) { if (R.dayKST(W.epoch) === R.dayKST(Date.parse('2026-10-20T12:00:00+09:00') / 1000)) { W.epoch = Math.floor(Date.parse('2026-10-19T00:00:00+09:00') / 1000); kvSet('epoch', W.epoch); log('개교일을 2026-10-19로 고쳤습니다'); } kvSet('epochFix1019', 1); }
  let cache = { at: 0 };
  let bossDirty = false;

  function newBoss(week, now) {
    const since = now - 7 * 86400;
    const s = q.sumActiveDps.get(since);
    // 첫 주(지난주 기록 없음)는 예상 인원과 신입생 피해로 잡는다
    const first = !Object.keys(W.results).length;
    const actives = Math.max(first ? cfg.expectedPlayers : 10, Number(s.n) || 0);
    const avgDps30 = Math.max(first ? 150 : 100, (Number(s.s) || 0) / Math.max(1, Number(s.n) || 1));
    // 활동 학생 수 × 30초 피해 평균 × 하루 3장 × 참여율 × 목표 일수
    const maxHp = Math.floor(actives * avgDps30 * 3 * WB_PARTICIPATION * WB_DAYS_TO_KILL);
    const def = D.WORLD_BOSSES[week % D.WORLD_BOSSES.length];
    W.boss = { week, id: def.id, name: def.name, maxHp, hp: maxHp, killedAt: 0, actives };
    kvSet('boss', W.boss);
    log(`월드 보스 등장: ${def.name} (체력 ${R.fmt(maxHp)}, 활동 학생 ${actives}명 기준)`);
  }

  /* 운영실 · 추가 보스: 이번 주 보스가 쓰러졌으면 다음 보스를 부른다. 앞서 잡은 수(kills)는 이어서 세고,
     잡을 때마다 토벌 보상이 우편으로 나간다 */
  const WB_SUMMON_FILL = 0.85;
  // 이번 주 지금까지의 피해 속도로 주 끝까지 더 들어올 피해 (추가 보스 체력 기준)
  function wbForecast(now) {
    const week = R.weekId(now), ws = R.weekStart(week), end = R.weekStart(week + 1), sum = Number(q.sumDmg.get(week).s) || 0;
    const b = W.boss && W.boss.week === week ? W.boss : null, dead = b ? (b.dead || 0) + (b.killedAt ? now - b.killedAt : 0) : 0;   // 보스가 없던(쓰러져 있던) 시간은 뺀다
    return sum / Math.max(3600, now - ws - dead) * Math.max(3600, end - now);
  }
  // 체력: 직접 입력(hp)이 없으면 인원(n, 기본 200) × 1회 피해(per, 기본 2만) × 주 끝까지 칠 수 있는 횟수 — 모두가 끝까지 다 쳐야 쓰러지는 크기
  function summonBoss(now, hp, n, per) {
    const week = R.weekId(now), b = W.boss;
    if (!b || b.week !== week) throw new Error('이번 주 보스가 아직 없습니다');
    if (!b.killedAt) throw new Error('이번 주 보스가 아직 살아 있습니다');
    store.flushAll();
    const auto = Math.floor((Number(n) > 0 ? Number(n) : 200) * (Number(per) > 0 ? Number(per) : 20000) * R.wbAttacksLeft(now));
    const maxHp = Math.max(1000, Math.min(1e15, Math.floor(Number(hp) > 0 ? Number(hp) : auto)));
    const round = (b.round || 1) + 1, def = D.WORLD_BOSSES[(week + round - 1) % D.WORLD_BOSSES.length];
    W.boss = { week, id: def.id, name: def.name, maxHp, hp: maxHp, killedAt: 0, actives: b.actives, round, kills: (b.kills || 0) + 1, paidKills: b.paidKills || 0, dead: (b.dead || 0) + Math.max(0, now - b.killedAt) };
    W.wbAlive = true; kvSet('boss', W.boss); cache.at = 0;
    log(`추가 월드 보스: ${def.name} (${round}번째, 체력 ${R.fmt(maxHp)})`);
    addNotice(`추가 월드 보스 ${R.josa(def.name, '이', '가')} 등장했습니다! 토벌에 성공하면 도전한 학생 모두에게 보상이 우편으로 전달됩니다.`, now, true);
    return W.boss;
  }

  // 토벌 보상: 이번 주에 도전한 학생 모두에게 우편 (server.js가 api.payKillTo로 보낸다). 한 보스에 한 번만
  function payKill(killer) {
    const b = W.boss; if (!b || !b.killedAt || b.paid || !api.payKillTo) return;
    b.paid = 1; b.paidKills = (b.paidKills || 0) + 1; kvSet('boss', b);
    try { api.payKillTo(b, killer); } catch (e) { log('토벌 보상 우편 실패', e); }
  }

  function cupStandings(week) {
    return D.HOUSES.map((h) => {
      const r = q.houseCup.get(week, h.id, CUP_TOP);
      const m = q.houseMembers.get(week, h.id), cs = R.cupScore(q.houseCups.all(week, h.id).map((x) => Number(x.cup) || 0));
      return { id: h.id, score: cs.score, active: cs.active, sum: Math.floor(Number(r.s) || 0), members: Number(m.n) || 0 };
    }).sort((a, b) => b.score - a.score);
  }

  function refreshHouses(now, cup) {
    D.HOUSES.forEach((h) => { const c = cup.find((x) => x.id === h.id); W.hpts[h.id] = Math.floor((W.hbase[h.id] || 0) + (c ? c.sum : 0)); });
    W.hAt = now;
  }
  const houseView = () => ({ pts: W.hpts, full: W.hfull });

  function finalizeWeek(week) {
    if (W.results[week]) return;
    const cup = cupStandings(week);
    const dmgs = q.dmgList.all(week).map((r) => Number(r.dmg));
    const at = (p) => dmgs.length ? dmgs[Math.min(dmgs.length - 1, Math.max(0, Math.ceil(dmgs.length * p) - 1))] : Infinity;
    const same = W.boss && W.boss.week === week, paidKills = same ? W.boss.paidKills || 0 : 0, kills = same ? (W.boss.kills || 0) + (W.boss.killedAt ? 1 : 0) : 0, killed = kills > 0;   // 추가 보스까지 잡은 수
    cup.forEach((c) => { W.hbase[c.id] = (W.hbase[c.id] || 0) + c.sum; }); kvSet('hbase', W.hbase); W.hAt = 0;
    // 기숙사마다 개인 1위: 1위 기숙사는 전설 장비, 2~4위 기숙사는 영웅 장비
    const mvps = {}; cup.forEach((c) => { const t = q.houseTop.get(week, c.id); if (t && t.cup >= R.CUP_ACTIVE) mvps[c.id] = t.pid; });
    const mvp = cup[0] ? mvps[cup[0].id] || '' : '';
    W.results[week] = { v2: 1, mvp, mvps, cup: cup.map((c) => c.id), cupScores: cup, killed, kills, paidKills, tiers: [at(0.01), at(0.10), at(0.50)], bossName: W.boss && W.boss.week === week ? W.boss.name : '', participants: dmgs.length };
    const keys = Object.keys(W.results).map(Number).sort((a, b) => b - a);
    keys.slice(10).forEach((k) => delete W.results[k]);
    kvSet('results', W.results);
    q.purgeWeekly.run(week - 10);
    log(`${week}주차 정산: 대항전 1위 ${cup[0] && cup[0].id}, 월드 보스 ${killed ? '토벌 성공' + (kills > 1 ? ' ×' + kills : '') : '토벌 실패'}, 참여 ${dmgs.length}명`);
  }

  function tick(now) {
    W.now = now;
    const week = R.weekId(now);
    if (!W.boss || W.boss.week < week) {
      if (W.boss) { store.flushAll(); finalizeWeek(W.boss.week); }
      newBoss(week, now);
    }
    W.wbAlive = !W.boss.killedAt;
    if (W.boss.killedAt && !W.boss.paid) payKill();   // 예전에 잡혔지만 아직 보상을 안 보낸 보스 (이 기능 이전 · 보내기 전 종료)
    if (now - W.hAt > 30) refreshHouses(now, cupStandings(week));
    if (bossDirty) { kvSet('boss', W.boss); bossDirty = false; }
  }

  function applyDamage(pid, dmg, now) {
    if (!W.boss || W.boss.killedAt) return false;
    W.boss.hp = Math.max(0, W.boss.hp - dmg);
    if (W.boss.hp <= 0) {
      W.boss.killedAt = now; W.wbAlive = false;
      kvSet('boss', W.boss);
      log(`월드 보스 토벌: ${W.boss.name}`);
      addNotice(`${W.boss.name} 토벌 성공! 이번 주에 도전한 학생 모두에게 토벌 보상 우편을 보냈습니다.`, now, true);
      if (api.onKill) try { api.onKill(W.boss.name, now); } catch (e) { }
      payKill(pid);
      return true;
    }
    bossDirty = true;
    return false;
  }

  // 아카데미 소식은 자주 생기므로 모아서 몇 초 뒤에 한 번 저장한다
  let newsT = null;
  function addNews(text, now) {
    W.news.unshift({ t: now, text: String(text).slice(0, 120) }); if (W.news.length > 50) W.news.length = 50;
    if (!newsT) newsT = setTimeout(() => { newsT = null; kvSet('news', W.news); }, 5000);
  }
  function addNotice(text, now, auto) {
    W.notices.unshift({ t: now, text: String(text).slice(0, 300), auto: !!auto });
    if (W.notices.length > 20) W.notices.length = 20;
    kvSet('notices', W.notices);
  }

  // 클라이언트에 보내는 세계 (30초 캐시)
  function publicView(now, online) {
    if (now - cache.at > 30) {
      const week = R.weekId(now);
      cache = {
        at: now,
        cup: cupStandings(week),
        topPower: q.topPower.all(50).map(pub),
        topStage: q.topStage.all(50).map(pub), topLvl: q.topLvl.all(50).map(pub),
        topTwK: q.topCt.all('$.st.twK', '$.st.twK', 50).map((r) => ({ id: r.id, name: r.name, house: r.house, f: r.f })),
        topTwM: q.topCt.all('$.st.twM', '$.st.twM', 50).map((r) => ({ id: r.id, name: r.name, house: r.house, f: r.f })),
        topDmg: q.topDmg.all(week, 50).map((r) => ({ id: r.pid, name: r.name, house: r.house, dmg: Math.floor(r.dmg) })),
        wbStats: q.sumDmg.get(week),
        players: Number(q.countPlayers.get().n)
      };
    }
    const b = W.boss;
    return {
      epoch: W.epoch, now, week: R.weekId(now), weekEnd: R.weekStart(R.weekId(now) + 1),
      boss: b ? { id: b.id, name: b.name, maxHp: b.maxHp, hp: b.hp, killedAt: b.killedAt, round: b.round || 1, kills: (b.kills || 0) + (b.killedAt ? 1 : 0), participants: Number(cache.wbStats.n) || 0 } : null,
      cup: cache.cup, hpts: W.hpts, hfull: W.hfull, topPower: cache.topPower, topStage: cache.topStage, topLvl: cache.topLvl, topTwK: cache.topTwK, topTwM: cache.topTwM, topDmg: cache.topDmg,
      notices: W.notices.slice(0, 8), news: W.news.slice(0, 20), players: cache.players, online: online || 0,
      lastWeek: W.results[R.weekId(now) - 1] || null
    };
  }
  function pub(r) { return { id: r.id, name: r.name, house: r.house, power: Math.floor(r.power), lvl: r.lvl, grade: r.grade, stage: r.max_stage }; }
  function rankOf(power) { return Number(q.rankPower.get(power).r); }
  // 내 순위들 (랭킹 화면에서만 부른다): 기록이 없으면 null
  function myRanks(P, power, now) {
    const st = P.st || {}, dmg = (P.wk && P.wk.id === R.weekId(now) && P.wk.dmg) || 0;
    return { power: rankOf(power), stage: Number(q.rankStage.get(P.maxStage, P.maxStage, power).r), lvl: Number(q.rankLvl.get(P.lvl, P.lvl, P.maxStage, P.maxStage, power).r), dmg: dmg > 0 ? Number(q.rankDmg.get(R.weekId(now), dmg).r) : null,
      twK: st.twK > 0 ? Number(q.rankCt.get('$.st.twK', st.twK).r) : null, twM: st.twM > 0 ? Number(q.rankCt.get('$.st.twM', st.twM).r) : null };
  }

  // 규칙 엔진에 넘기는 세계 (W.results로 주간 보상 판정)
  function ctx(now) { W.now = now; return W; }

  // 종료 직전: 미뤄 둔 저장까지 모두 (월드 보스 체력 · 소식 · 공지 · 결과)
  function saveAll() { if (newsT) { clearTimeout(newsT); newsT = null; } kvSet('boss', W.boss); kvSet('news', W.news); kvSet('notices', W.notices); kvSet('results', W.results); bossDirty = false; }
  const api = { W, houseView, tick, summonBoss, wbForecast, WB_SUMMON_FILL, saveAll, applyDamage, addNotice, addNews, publicView, ctx, rankOf, myRanks, finalizeWeek, cupStandings, invalidate() { cache.at = 0; } };
  return api;
}
module.exports = { create };
