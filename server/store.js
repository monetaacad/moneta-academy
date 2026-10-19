'use strict';
// 학생 상태 캐시: 메모리에 두고 5초마다 모아서 DB에 기록. 오래 안 쓰면 내려놓는다.
const R = require('../shared/rules.js');

function create(dbx, log) {
  const cache = new Map(); // pid → {P, dirty, touched}
  let worldRef = null;

  function migrate(P) {
    // 이후 버전에서 상태 구조가 바뀌면 여기서 고친다
    if (!P.v) P.v = R.VERSION;
    R.fixState(P);
    return P;
  }
  function get(pid) {
    let e = cache.get(pid);
    if (e) { e.touched = Date.now(); return e.P; }
    const row = dbx.q.playerById.get(pid);
    if (!row) return null;
    const P = migrate(JSON.parse(row.state));
    cache.set(pid, { P, dirty: false, touched: Date.now(), banned: !!row.banned });
    return P;
  }
  function isBanned(pid) { const e = cache.get(pid); return e ? e.banned : false; }
  function put(P) { cache.set(P.id, { P, dirty: true, touched: Date.now() }); }
  function markDirty(pid) { const e = cache.get(pid); if (e) e.dirty = true; }

  function writeOne(P) {
    if (api.beforeWrite) try { api.beforeWrite(P); } catch (e) { log('저장 전 처리 실패', e); }
    const W = worldRef && worldRef.W;
    const now = Date.now() / 1000;
    const s = R.summary(P, W, Math.min(now, P.at));
    dbx.q.savePlayer.run(JSON.stringify(P), Math.floor(Date.now() / 1000), s.power, s.lvl, s.grade, s.maxStage, s.wbDps, P.house, R.titleName(P, P.title), P.id);
    if (P.wk && P.wk.id && (P.wk.cup > 0 || P.wk.att > 0)) dbx.q.upsertWeekly.run(P.wk.id, P.id, P.house, P.wk.cup, P.wk.dmg, P.wk.att);
  }
  // 오래 쓰지 않은 활동 중 학생도 2분마다 한 번은 기록 (마지막 접속 시각 갱신)
  function touch(pid) { const e = cache.get(pid); if (!e) return; e.touched = Date.now(); if (Date.now() - (e.wrote || 0) > 120000) e.dirty = true; }
  function flushAll(limit) {
    const dirty = [];
    cache.forEach((e) => { if (e.dirty) dirty.push(e); });
    if (!dirty.length) return 0;
    if (limit && dirty.length > limit) { dirty.sort((a, b) => (a.wrote || 0) - (b.wrote || 0)); dirty.length = limit; }
    const t = Date.now();
    const wt = Date.now();
    dbx.tx(() => { dirty.forEach((e) => { writeOne(e.P); e.dirty = false; e.wrote = wt; }); });
    const ms = Date.now() - t;
    if (ms > 200) log(`저장 ${dirty.length}명 ${ms}ms`);
    return dirty.length;
  }
  function evictIdle(maxIdleMs) {
    const now = Date.now(); let n = 0;
    cache.forEach((e, pid) => { if (!e.dirty && now - e.touched > maxIdleMs) { cache.delete(pid); n++; } });
    return n;
  }
  function online(windowMs) { const now = Date.now(); let n = 0; cache.forEach((e) => { if (now - e.touched < windowMs) n++; }); return n; }
  function peek(pid) { const e = cache.get(pid); return e ? e.P : null; }
  function seen(pid) { const e = cache.get(pid); return e ? e.touched : 0; }
  const api = { get, peek, seen, put, markDirty, touch, flushAll, evictIdle, online, isBanned, size: () => cache.size, setWorld(w) { worldRef = w; }, drop(pid) { cache.delete(pid); } };
  return api;
}
module.exports = { create };
