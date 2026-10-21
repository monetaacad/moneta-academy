'use strict';
// 함께 원정 방: 서버 메모리에 두고 10초마다(바뀌었을 때만) · 끌 때 DB에 적어 둔다. 서버를 다시 켜도(새 버전 배포) 방이 그대로 이어진다.
// 방장이 「지금 출발」을 누르면 떠난다(혼자여도 됨). 4명이 차면 15초 뒤 저절로 떠난다.
// 사람이 안 모이면 방 사람 누구나 아카데미 친구(NPC)를 동행시킬 수 있다(부른 학생 힘의 60%, 부른 학생이 나가면 방장 기준). 방 사람이 모두 접속을 끊은 채 2시간이 지나면 방이 닫힌다.
const R = require('../shared/rules.js');

const FULL_WAIT = 15, IDLE = 7200, MAX_ROOMS = 80, NPC_F = R.NPC_FRAC.exp;

function create(o) {
  const { loadPlayer, ctx, gameNow, markDirty, partyOf, log } = o;
  const recruitPost = o.recruit || (() => {}), canInvite = o.canInvite || (() => false), nameOf = o.nameOf || (() => '');
  const partyInfo = o.partyInfo || (() => null), isOnline = o.isOnline || (() => false);
  const save = o.save || null, load = o.load || null;
  const invites = new Map();      // pid → [{room, from, at}] (10분 동안, 최대 20개)
  const rooms = new Map();        // id → room
  const roomOf = new Map();       // pid → room id
  // 방에 들어가거나 나갈 때마다 알린다 (원정 채팅 탭을 열고 닫기). 바뀐 학생은 한 박자 늦게 모아서 한 번씩
  const onRoom = o.onRoom || (() => {}), changed = new Set();
  function touchRoom(pid) { changed.add(pid); if (changed.size === 1) setImmediate(() => { const a = [...changed]; changed.clear(); a.forEach((p) => { try { onRoom(p); } catch (e) { } }); }); }
  const roomSet = (pid, id) => { roomOf.set(pid, id); touchRoom(pid); }, roomDel = (pid) => { roomOf.delete(pid); touchRoom(pid); };
  const gone = new Map();         // pid → {at, ok, why, s, n}  (방이 떠나거나 닫힌 뒤 한 번 알려 주기)
  let seq = 1;
  const real = () => Date.now() / 1000;
  const fail = (m, st) => { const e = new Error(m); e.status = st || 400; throw e; };
  const NPCS = R.D.RIVALS.map((r, k) => ({ k, name: r.name }));

  function durOk(d) { return R.D.DURATIONS.some((x) => x.k === d); }
  // 마지막으로 고른 포지션을 기억한다 (다음 방 · 파티장이 데려갈 때 그 자리로)
  function keepPos(P, pos) { if (!P.opt || P.opt.erPos === pos) return; P.opt.erPos = pos; markDirty(P.id); }
  function posOk(P, pos) { if (!R.EXP_POS[pos]) fail('포지션 선택 필요'); if (R.expPositions(P).indexOf(pos) < 0) fail(R.EXP_POS[pos].name + ' 포지션은 ' + R.EXP_POS[pos].desc.split(' · ')[0]); }
  function check(P, s) { try { R.expCanGo(P, ctx(), gameNow(), s); } catch (e) { if (e.game) fail(e.message); throw e; } }
  function canSee(r, me) { return !r.party || partyOf.get(me) === r.party || r.members.some((m) => m.id === me); }
  const people = (r) => r.members.filter((m) => !m.npc);
  function full(r) { if (r.members.length >= R.EXP_PARTY_MAX) { if (!r.fullAt) r.fullAt = real(); } else r.fullAt = 0; }
  function leaveAny(me) {
    const id = roomOf.get(me); if (!id) return; roomDel(me);
    const r = rooms.get(id); if (!r) return;
    r.members = r.members.filter((m) => m.id !== me); full(r); r.touched = real();
    const ps = people(r);
    if (!ps.length) rooms.delete(id); else if (r.host === me) r.host = ps[0].id;
  }
  // NPC를 부른 학생: 방에 남아 있으면 그 학생, 나갔으면 방장
  const npcBy = (r, m) => (m.by && r.members.some((x) => !x.npc && x.id === m.by) ? m.by : r.host);
  // 사람마다 계산값: NPC는 부른 학생 힘의 60%
  function stats(r) {
    const now = gameNow(), W = ctx(), cs = {};
    const base = (id) => { if (!(id in cs)) { const Q = loadPlayer(id, now); cs[id] = Q ? R.calc(Q, W, now) : null; } return cs[id]; };
    return r.members.map((m) => {
      if (m.npc) { const hc = base(npcBy(r, m)); if (!hc) return null; const c = Object.assign({}, hc, { totalDps: hc.totalDps * NPC_F, hp: hc.hp * NPC_F, def: hc.def * NPC_F }); return { c, pos: m.pos, aggro: R.EXP_AGGRO }; }
      const P = loadPlayer(m.id, now); if (!P) return null;
      return { c: R.calc(P, W, now), pos: m.pos, aggro: R.expAggro(P), P };
    });
  }

  function view(r, me) {
    const t = real(), mine = r.members.some((m) => m.id === me), hostM = r.members.find((m) => m.id === r.host) || r.members[0];
    const v = { id: r.id, s: r.s, zone: R.zoneOf(r.s).name, d: r.d, party: !!r.party, host: hostM.name, isHost: r.host === me, mine,
      members: r.members.map((m) => ({ id: m.npc ? undefined : m.id, name: m.name, pos: m.pos, me: m.id === me, host: m.id === r.host, npc: !!m.npc, k: m.npc ? m.k : undefined, cls: m.cls, lvl: m.lvl, grade: m.grade, power: m.npc ? Math.round(((r.members.find((x) => !x.npc && x.id === npcBy(r, m)) || hostM).power || 0) * NPC_F) : m.power, mineNpc: m.npc ? (r.host === me || npcBy(r, m) === me) : undefined })), n: r.members.length, max: R.EXP_PARTY_MAX,
      departIn: r.fullAt ? Math.max(0, Math.ceil(r.fullAt + FULL_WAIT - t)) : null };
    if (mine) {   // 내 방이면 지금 이대로 떠날 때 내 예상
      const st = stats(r), mi = r.members.findIndex((m) => m.id === me);
      if (st.every(Boolean)) { const pv = R.expPartyPreview(st, r.s, r.d), e = pv.each[mi]; v.est = { kills: e.kills, gold: e.gold, xp: e.xp, risk: e.risk, label: pv.label, red: pv.red, frac: e.frac }; }
    }
    return v;
  }
  function list(me) {
    tick();
    const out = []; rooms.forEach((r) => { if (canSee(r, me)) out.push(view(r, me)); });
    out.sort((a, b) => (b.mine - a.mine) || (b.party - a.party) || (b.n - a.n));
    const g = gone.get(me); if (g) gone.delete(me);
    const inv = myInvites(me).map((x) => Object.assign(view(rooms.get(x.room), me), { from: x.fromName }));
    const pi = partyInfo(me);
    return { rooms: out.slice(0, 40), mine: roomOf.get(me) || null, gone: g || null, npcF: NPC_F, invites: inv, party: pi ? { leader: pi.leader === me, allgo: pi.allgo, n: pi.members.length, can: pi.leader === me || pi.allgo } : null };
  }
  function myInvites(me) {
    const t = real(), a = (invites.get(me) || []).filter((x) => t - x.at < 600 && rooms.has(x.room) && rooms.get(x.room).members.length < R.EXP_PARTY_MAX && roomOf.get(me) !== x.room);
    if (a.length) invites.set(me, a); else invites.delete(me); return a;
  }
  // 모집 탭에서 「살펴보기」: 그 방 하나 (파티원만 방은 볼 수 있는 사람만)
  function peek(me, id) {
    tick(); const r = rooms.get(String(id || '')); if (!r) fail('이미 출정했거나 닫힌 방입니다', 404);
    if (!canSee(r, me) && !(invites.get(me) || []).some((x) => x.room === r.id)) fail('볼 수 없는 방입니다', 403);
    return { room: view(r, me) };
  }
  function member(P, pos) { const sm = R.summary(P, ctx(), gameNow()); return { id: P.id, name: P.name, pos, cls: P.cls || 'mage', lvl: P.lvl, grade: P.grade, power: sm.power }; }
  // 파티로 참가: 같은 파티원 중 갈 수 있는 사람을 빈자리만큼 함께 넣는다 (다른 방에 있거나 슬롯이 없으면 건너뜀)
  function bringParty(r, me, P) {
    const pi = partyInfo(me); if (!pi) fail('파티에 들어가 있지 않습니다');
    if (pi.leader !== me && !pi.allgo) fail('파티장만 파티 단위로 참가 가능 (파티 설정에서 변경)');
    const added = [], skipped = [];
    pi.members.forEach((pid) => {
      if (pid === me || r.members.some((m) => m.id === pid)) return;
      const Q = loadPlayer(pid, gameNow()); if (!Q) return;
      if (r.members.length >= R.EXP_PARTY_MAX) { skipped.push(Q.name + '(자리 없음)'); return; }
      if (roomOf.get(pid)) { skipped.push(Q.name + '(다른 방에 있음)'); return; }
      try { R.expCanGo(Q, ctx(), gameNow(), r.s); } catch (e) { if (!e.game) throw e; skipped.push(Q.name + '(' + e.message + ')'); return; }
      const ok = R.expPositions(Q), pos = Q.opt && ok.indexOf(Q.opt.erPos) >= 0 ? Q.opt.erPos : Q.cls === 'knight' && ok.indexOf('van') >= 0 ? 'van' : ok.indexOf('rear') >= 0 ? 'rear' : ok[0];
      r.members.push(member(Q, pos)); roomSet(pid, r.id); added.push(Q.name);
      if (o.note) o.note(pid, 'exp', P.name + ' 님이 파티로 함께 원정(' + r.s + '단계 · ' + R.zoneOf(r.s).name + ')에 참가시켰습니다. 원정 화면에서 포지션을 바꾸거나 나올 수 있습니다', { view: 'explore', anchor: 'exproom' });
    });
    full(r); r.touched = real();
    return { added, skipped };
  }
  function op(me, b) {
    tick();
    const P = loadPlayer(me, gameNow()); if (!P) fail('학생 정보를 찾을 수 없습니다', 401);
    const k = String(b.op || '');
    if (k === 'create') {
      const s = Math.floor(Number(b.s)) || 0, d = String(b.d || ''), pos = String(b.pos || '');
      if (!durOk(d)) fail('잘못된 시간입니다'); check(P, s); posOk(P, pos); keepPos(P, pos);
      if (rooms.size >= MAX_ROOMS) fail('열린 방이 너무 많습니다. 다른 방 참가 필요');
      const party = b.partyOnly ? partyOf.get(me) || null : null; if (b.partyOnly && !party) fail('파티에 들어가 있어야 「파티원만」으로 열 수 있습니다');
      leaveAny(me);
      const id = 'r' + (seq++);
      rooms.set(id, { id, host: me, s, d, party, created: real(), touched: real(), fullAt: 0, members: [member(P, pos)] });
      roomSet(me, id);
      if (b.withParty) return Object.assign({ ok: true, id }, bringParty(rooms.get(id), me, P));
      return { ok: true, id };
    }
    if (k === 'join') {
      const r = rooms.get(String(b.id || '')); if (!r || !(canSee(r, me) || (invites.get(me) || []).some((x) => x.room === r.id))) fail('없어진 방입니다');
      if (r.members.some((m) => m.id === me)) return { ok: true, id: r.id };
      if (r.members.length >= R.EXP_PARTY_MAX) fail('방이 가득 찼습니다');
      const pos = String(b.pos || ''); check(P, r.s); posOk(P, pos); keepPos(P, pos);
      leaveAny(me);
      r.members.push(member(P, pos)); roomSet(me, r.id); full(r); r.touched = real();
      const iv = (invites.get(me) || []).filter((x) => x.room !== r.id); if (iv.length) invites.set(me, iv); else invites.delete(me);
      if (b.withParty) return Object.assign({ ok: true, id: r.id }, bringParty(r, me, P));
      return { ok: true, id: r.id };
    }
    const r = rooms.get(roomOf.get(me) || ''); if (!r) fail('들어가 있는 방이 없습니다');
    if (k === 'bring') { const res = bringParty(r, me, P); if (!res.added.length) fail(res.skipped.length ? '함께 갈 수 있는 파티원이 없습니다: ' + res.skipped.join(', ') : '함께 갈 파티원이 없습니다'); return Object.assign({ ok: true }, res); }
    if (k === 'pos') { const pos = String(b.pos || ''); posOk(P, pos); keepPos(P, pos); r.members.find((m) => m.id === me).pos = pos; r.touched = real(); return { ok: true }; }
    if (k === 'leave') { leaveAny(me); return { ok: true }; }
    if (k === 'recruit') {   // 채팅 「모집」 탭에 알림 한 줄 (방마다 1분에 한 번)
      if (r.party) fail('파티원만 방은 모집 알림을 보낼 수 없습니다');
      if (r.members.length >= R.EXP_PARTY_MAX) fail('방이 이미 가득 찼습니다');
      if (r.recAt && real() - r.recAt < 60) fail(Math.ceil(60 - (real() - r.recAt)) + '초 뒤에 다시 보낼 수 있습니다');
      const note = String(b.note || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
      r.recAt = real(); r.touched = real();
      recruitPost(P, { room: r.id, s: r.s, d: r.d, zone: R.zoneOf(r.s).name, n: r.members.length, max: R.EXP_PARTY_MAX, pos: r.members.map((m) => m.pos), note });
      return { ok: true };
    }
    if (k === 'invite') {   // 친구 · 같은 동아리원 · 같은 파티원 한 명에게 초대
      const to = String(b.to || ''); if (!to || to === me) fail('초대할 학생 선택 필요');
      if (!canInvite(me, to)) fail('친구 · 같은 동아리원 · 같은 파티원만 초대할 수 있습니다');
      if (r.members.length >= R.EXP_PARTY_MAX) fail('방이 이미 가득 찼습니다');
      if (r.members.some((m) => m.id === to)) fail('이미 방에 있는 학생입니다');
      const a = (invites.get(to) || []).filter((x) => x.room !== r.id); if (a.length >= 20) a.shift();
      a.push({ room: r.id, from: me, fromName: P.name, at: real() }); invites.set(to, a); r.touched = real();
      if (o.note) o.note(to, 'exp', P.name + ' 님이 함께 원정(' + r.s + '단계 · ' + R.zoneOf(r.s).name + ')에 초대했습니다', { view: 'explore', anchor: 'exproom' });
      return { ok: true, invited: nameOf(to) };
    }
    if (k === 'npc') {   // 방 사람 누구나: 아카데미 친구 동행 (빈 포지션부터 채운다, 부른 학생 힘의 60%)
      if (r.members.length >= R.EXP_PARTY_MAX) fail('방이 가득 찼습니다');
      const used = new Set(); rooms.forEach((x) => x.members.forEach((m) => { if (m.npc && x === r) used.add(m.k); }));
      const n = NPCS.filter((x) => !used.has(x.k)); if (!n.length) fail('부를 수 있는 아카데미 친구가 없습니다');
      const pick = n[(r.members.length * 7 + seq) % n.length], have = new Set(r.members.map((m) => m.pos));
      const pos = R.EXP_POS[b.pos] ? String(b.pos) : !have.has('van') ? 'van' : !have.has('sup') ? 'sup' : 'rear';
      r.members.push({ id: 'npc:' + pick.k, npc: true, k: pick.k, name: pick.name, pos, by: me }); full(r); r.touched = real();
      return { ok: true };
    }
    if (k === 'npcdel') {
      const nm = r.members.find((m) => m.npc && m.k === Number(b.k)); if (!nm) return { ok: true };
      if (r.host !== me && npcBy(r, nm) !== me) fail('방장이나 동행을 부른 학생만 돌려보낼 수 있습니다');
      r.members = r.members.filter((m) => m !== nm); full(r); r.touched = real(); return { ok: true };
    }
    if (k === 'go') { if (r.host !== me) fail('방장만 출발시킬 수 있습니다'); const res = depart(r); return Object.assign({ ok: true }, res); }
    fail('알 수 없는 요청입니다');
  }
  // 출발: 그 사이 슬롯이 찼거나 꿈길에 든 학생은 빼고 남은 사람끼리 떠난다
  function depart(r) {
    rooms.delete(r.id); people(r).forEach((m) => roomDel(m.id));
    const now = gameNow(), W = ctx(), fails = [];
    people(r).forEach((m) => {
      const P = loadPlayer(m.id, now); if (!P) { fails.push({ m, why: '학생 정보를 찾을 수 없습니다' }); return; }
      try { if (P.erBan > now) throw Object.assign(new Error('혼자 귀환을 반복해 함께 원정 제한 중입니다'), { game: true }); R.expCanGo(P, W, now, r.s); if (R.expPositions(P).indexOf(m.pos) < 0) m.pos = 'van'; }
      catch (e) { if (!e.game) throw e; fails.push({ m, why: e.message }); }
    });
    fails.forEach((f) => gone.set(f.m.id, { at: real(), ok: false, why: f.why, s: r.s }));
    r.members = r.members.filter((m) => !fails.some((f) => f.m === m));
    if (!people(r).length) return { n: 0 };
    if (!r.members.some((m) => m.id === r.host)) r.host = people(r)[0].id;
    const st = stats(r); if (!st.every(Boolean)) return { n: 0 };
    const pv = R.expPartyPreview(st, r.s, r.d), names = r.members.map((m) => ({ id: m.npc ? undefined : m.id, k: m.npc ? m.k : undefined, name: m.name, pos: m.pos, npc: !!m.npc })), team = R.expTeam(pv, r.members, st);
    if (!r.ck) r.ck = Date.now().toString(36) + '-' + r.id;   // 떠난 뒤에도 원정 채팅이 이어지도록 열쇠를 일정에 남긴다
    r.members.forEach((m, i) => {
      if (m.npc) return;
      const P = st[i].P, slot = R.expCanGo(P, W, now, r.s);
      R.expPartyApply(P, now, slot, r.s, r.d, pv.each[i], { n: r.members.length, pos: m.pos, with: names.filter((y, k) => k !== i), team, me: i, ck: r.ck });
      if (people(r).length >= 2) P.st.partyExp = (P.st.partyExp || 0) + 1;   // 칭호 「함께 걷는 길」: 다른 학생과 함께 출정
      markDirty(m.id); gone.set(m.id, { at: real(), ok: true, s: r.s, n: r.members.length });
    });
    log(`함께 원정 출발: ${r.s}단계 ${people(r).length}명 + 동행 ${r.members.length - people(r).length}`);
    return { n: r.members.length };
  }
  let lastTick = 0, lastSave = 0, savedJson = '';
  function tick() {
    const t = real(); if (t - lastTick < 1) return; lastTick = t;
    [...rooms.values()].forEach((r) => {
      if (people(r).some((m) => isOnline(m.id))) r.touched = t;   // 누구든 접속해 있으면 방을 열어 둔다
      if (r.fullAt && t >= r.fullAt + FULL_WAIT) { try { depart(r); } catch (e) { log('함께 원정 출발 실패: ' + e.message); } return; }
      if (t - r.touched > IDLE) { rooms.delete(r.id); people(r).forEach((m) => { roomDel(m.id); gone.set(m.id, { at: t, ok: false, why: '방 사람이 모두 2시간 넘게 접속하지 않아 방이 닫혔습니다', s: r.s }); }); }
    });
    gone.forEach((g, pid) => { if (t - g.at > 600) gone.delete(pid); });
    if (t - lastSave >= 10) { lastSave = t; persist(); }
  }
  // 저장 · 되살리기 (방 · 받은 초대 · 방 번호)
  function persist() {
    if (!save) return; const json = JSON.stringify({ seq, rooms: [...rooms.values()], invites: [...invites] });
    if (json === savedJson) return; savedJson = json; try { save(json); } catch (e) { log('함께 원정 방 저장 실패', e); }
  }
  if (load) try {
    const x = JSON.parse(load() || 'null'), t = real();
    if (x) {
      seq = Math.max(seq, x.seq || 1);
      (x.rooms || []).forEach((r) => { if (!r || !r.id || !Array.isArray(r.members) || !people(r).length) return; r.touched = t; if (r.fullAt) r.fullAt = t; rooms.set(r.id, r); people(r).forEach((m) => roomOf.set(m.id, r.id)); });   // 꺼져 있던 동안은 세지 않는다
      (x.invites || []).forEach((e) => { if (Array.isArray(e) && Array.isArray(e[1])) invites.set(e[0], e[1].filter((v) => rooms.has(v.room))); });
      if (rooms.size) log('함께 원정 방 ' + rooms.size + '개를 되살렸습니다');
    }
  } catch (e) { log('함께 원정 방 되살리기 실패', e); }
  // 원정 채팅 열쇠: 방 번호는 서버를 켤 때마다 1부터라 예전 방 대화와 겹치지 않게 만든 시각을 붙인다
  function chatKey(pid) { const r = rooms.get(roomOf.get(pid)); if (!r) return null; if (!r.ck) r.ck = Date.now().toString(36) + '-' + r.id; return r.ck; }
  // 같은 방 사람들 (방에 있을 때만)
  function peers(pid) { const r = rooms.get(roomOf.get(pid)); return r ? people(r).map((m) => m.id) : null; }
  // 모집 탭: 방의 지금 인원 (없으면 출정했거나 닫힌 방)
  function status(id) { const r = rooms.get(String(id || '')); return r ? { n: r.members.length, max: R.EXP_PARTY_MAX } : null; }
  return { status, inRoom: (pid) => roomOf.has(pid), chatKey, peers, persist: () => { savedJson = ''; persist(); }, list, op, tick, peek, forget: (pid) => { leaveAny(pid); invites.delete(pid); }, invN: (pid) => myInvites(pid).length, size: () => rooms.size };
}
module.exports = { create };
