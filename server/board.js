'use strict';
// 게시판: 질문 · 모집 · 거래 · RP · 잡담 · 건의. 건의 말머리는 건의함, RP 말머리는 RP 게시판(제목 없는 메모 + 이어 쓰는 댓글)에 보인다. 「관리자만 보기」 글(문의)은 쓴 사람과 운영진만 본다.
// 제목·본문·댓글은 DB에 암호화해서 두고, 목록·검색은 서버 메모리에 푼 사본으로 한다 (최근 5,000개).
const R = require('../shared/rules.js');

const TAGS = R.D.BOARD_TAGS.map((t) => t.id);
const LIM = { TITLE: 40, BODY: 3000, MEMO: 500, COM: 500, PAGE: 10, DAY: 30, MEMO_COMS: 3 };

function create(dbx, sec, opts) {
  const isOp = opts.isOp, sendMail = opts.sendMail || (() => {}), log = opts.log || (() => {});
  const posts = new Map();   // id → {id, pid, tag, priv, title, body, created, updated, last, ncom}
  dbx.q.bdAll.all().forEach((r) => { try { posts.set(r.id, { id: r.id, pid: r.pid, tag: r.tag, priv: !!r.priv, title: sec.dec(r.title), body: sec.dec(r.body), created: r.created, updated: r.updated, last: r.last, ncom: r.ncom, st: r.st || '' }); } catch (e) { } });
  const comBy = new Map();   // 학생 → 댓글을 단 글 id (「내 댓글」 보기)
  const comAdd = (pid, post) => { let st = comBy.get(pid); if (!st) comBy.set(pid, st = new Set()); st.add(post); };
  dbx.q.bdComPids.all().forEach((r) => comAdd(r.pid, r.post));
  const mutes = new Set(); dbx.q.bdMuteAll.all().forEach((r) => mutes.add(r.post + ':' + r.pid));   // 「알림 받지 않기」한 글 (글 id : 학생)
  const names = new Map();
  function nameOf(pid) {
    if (pid === 'staff') return '운영진';
    let n = names.get(pid); if (n !== undefined) return n;
    const p = dbx.q.getProfile.get(pid); n = p ? p.name : '(떠난 학생)'; names.set(pid, n); if (names.size > 20000) names.delete(names.keys().next().value);
    return n;
  }
  const canSee = (me, p) => !p.priv || p.pid === me || isOp(me);
  const clean = (v, max) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, max);
  function brief(p, me) {
    return { id: p.id, tag: p.tag, priv: p.priv, title: p.title, author: nameOf(p.pid), aid: p.pid, aop: (opts.badgeOf || (() => ''))(p.pid), mine: p.pid === me, created: p.created, updated: p.updated, last: p.last, ncom: p.ncom, st: p.st || '' };
  }
  const spaceOf = (p) => p.tag === 'idea' ? 'idea' : p.tag === 'rp' ? 'rp' : '';
  // f: {tag: ''|태그|'priv'|'mine'|'cmt', q, qt: 'author'|'title'|'all', page, sp: ''|'idea'|'rp', sort: ''(새 글)|'act'(새 댓글)}
  function list(me, f) {
    const op = isOp(me), tag = String(f.tag || ''), q = String(f.q || '').trim().toLowerCase().slice(0, 30), qt = f.qt === 'author' || f.qt === 'title' ? f.qt : 'all';
    let arr = [];
    posts.forEach((p) => {
      if (tag === 'priv') { if (!op || !p.priv) return; }
      else if (tag === 'mine') { if (p.pid !== me) return; }
      else if (tag === 'cmt') { const st = comBy.get(me); if (!st || !st.has(p.id) || !canSee(me, p)) return; }   // 내가 댓글을 단 글
      else { if (p.priv) return; if (tag && p.tag !== tag) return; }   // 관리자만 보기 글은 일반 목록에 나오지 않는다 (운영진 포함)
      if (spaceOf(p) !== (f.sp || '')) return;   // 게시판 · 건의함(건의 말머리) · RP 게시판(RP 말머리)을 나눠 보인다
      if (f.st && (p.st || '') !== f.st) return;   // 건의함: 처리 상태로 보기
      if (f.hideDone && !f.st && (p.st === 'done' || p.st === 'no' || p.st === 'norepro')) return;   // 해결 완료 · 반영 안 함 · 재현 안 됨 숨기기 (처리 상태를 직접 골랐을 때는 그대로 보인다)
      if (q) {
        const hit = qt === 'author' ? nameOf(p.pid).toLowerCase().replace(/ /g, '').indexOf(q.replace(/ /g, '')) >= 0
          : qt === 'title' ? p.title.toLowerCase().indexOf(q) >= 0 : (p.title + '\n' + p.body).toLowerCase().indexOf(q) >= 0;
        if (!hit) return;
      }
      arr.push(p);
    });
    arr.sort(f.sort === 'act' ? (a, b) => b.last - a.last || b.id - a.id : (a, b) => b.id - a.id);
    const total = arr.length, pages = Math.max(1, Math.ceil(total / LIM.PAGE)), page = Math.min(pages, Math.max(1, Number(f.page) | 0 || 1));
    const privN = op ? [...posts.values()].filter((p) => p.priv).length : 0;
    const memo = f.sp === 'rp';   // RP 게시판: 목록에서 바로 읽도록 본문과 최근 댓글을 함께 보낸다
    const out = (p) => memo ? Object.assign(brief(p, me), { body: p.body, canDel: p.pid === me || op, coms: dbx.q.bdComLast.all(p.id, LIM.MEMO_COMS).map((c) => comOut(c, me)) }) : brief(p, me);
    return { list: arr.slice((page - 1) * LIM.PAGE, page * LIM.PAGE).map(out), total, page, pages, op, privN };
  }
  function comOut(c, me) { return { id: c.id, author: nameOf(c.pid), aid: c.pid, op: !!c.op, badge: c.pid === 'staff' ? '' : (opts.badgeOf || (() => ''))(c.pid), mine: c.pid === me, body: sec.dec(c.body), created: c.created, edited: c.edited || 0, parent: c.parent || 0, pa: c.parent ? paOf(c.parent) : '' }; }
  function paOf(id) { const pc = dbx.q.bdComGet.get(id); return !pc ? '' : pc.pid === 'staff' ? '운영진' : nameOf(pc.pid); }   // 답글이 달린 원래 댓글의 작성자 (RP 게시판에서 「↳ 이름」으로 보인다)
  // 알림: 내 글에 댓글 · 내 댓글에 답글이 달리면 알림 칸에 (우편은 보내지 않는다)
  function note(to, text, post) { if (!to || to === 'staff' || mutes.has(post + ':' + to)) return; const p = posts.get(post); (opts.note || (() => {}))(to, p && p.tag === 'rp' ? 'rp' : 'board', text, { view: 'board', post: post }); }   // RP 게시판 글은 알림 종류 'rp' (알림 창의 RP 게시판 탭)
  function get(me, id) {
    const p = posts.get(Number(id) | 0); if (!p || !canSee(me, p)) return null;
    return Object.assign(brief(p, me), { body: p.body, canEdit: p.pid === me, canDel: p.pid === me || isOp(me), canStatus: stOk(me, p), muted: mutes.has(p.id + ':' + me), comments: dbx.q.bdComs.all(p.id).map((c) => comOut(c, me)) });
  }
  /* 건의 처리 상태(검토 중 · 확인 중 · 해결 완료 · 반영 안 함 · 재현 안 됨): 건의 말머리나 관리자만 보기 글에, 학생회장만 붙인다. 바뀌면 쓴 학생에게 알림 */
  const ST = { '': '', review: '검토 중', wip: '확인 중', done: '해결 완료', no: '반영 안 함', norepro: '재현 안 됨' };
  const stOk = (me, p) => (me === 'staff' || !!(opts.isChief && opts.isChief(me))) && (p.tag === 'idea' || p.priv);   // staff = 운영실(관리자 토큰)
  function setStatus(me, id, st) {
    const p = posts.get(Number(id) | 0); if (!p || !stOk(me, p)) fail('상태를 바꿀 수 없는 글입니다');
    st = String(st || ''); if (!(st in ST)) fail('알 수 없는 상태입니다'); if (p.st === st) return p.id;
    dbx.q.bdStatus.run(st, p.id); p.st = st;
    if (st && p.pid !== me) note(p.pid, '내 건의 「' + (p.title.length > 20 ? p.title.slice(0, 20) + '…' : p.title) + '」: ' + ST[st], p.id);
    log(`게시판 #${p.id} 상태 → ${ST[st] || '없음'}`); return p.id;
  }
  function fail(msg) { const e = new Error(msg); e.status = 400; throw e; }
  function check(b) {
    // RP 메모: 제목 없이 본문만(500자). 목록 · 검색 · 알림용 제목은 본문 첫 줄로 만든다
    if (b.memo) { const body = clean(b.body, LIM.MEMO); if (!body) fail('내용 입력 필요'); const t = body.split('\n')[0].replace(/\s+/g, ' ').trim(); return { tag: 'rp', title: t.length > LIM.TITLE ? t.slice(0, LIM.TITLE - 1) + '…' : t, body, priv: false }; }
    const tag = String(b.tag || ''), title = clean(b.title, LIM.TITLE).replace(/\n/g, ' '), body = clean(b.body, LIM.BODY);
    if (TAGS.indexOf(tag) < 0) fail('말머리 선택 필요');
    if (title.length < 2) fail('제목은 두 글자 이상');
    if (!body) fail('내용 입력 필요');
    return { tag, title, body, priv: !!b.priv };
  }
  function write(me, b, now) {
    if (Number(dbx.q.bdTodayBy.get(me, now - 86400).n) >= LIM.DAY) fail('하루에 ' + LIM.DAY + '개까지 작성할 수 있습니다');
    const x = check(b), info = dbx.q.bdInsert.run(me, x.tag, x.priv ? 1 : 0, sec.enc(x.title), sec.enc(x.body), now, now, now);
    const id = Number(info.lastInsertRowid);
    posts.set(id, { id, pid: me, tag: x.tag, priv: x.priv, title: x.title, body: x.body, created: now, updated: now, last: now, ncom: 0 });
    if (x.priv) { log(`게시판 문의 #${id} (${nameOf(me)})`); if (opts.onInquiry) opts.onInquiry(id); }
    return id;
  }
  function edit(me, b, now) {
    const p = posts.get(Number(b.id) | 0); if (!p || p.pid !== me) fail('고칠 수 없는 글입니다');
    if (b.memo && p.tag !== 'rp') fail('고칠 수 없는 글입니다');
    const x = check(b); dbx.q.bdEdit.run(x.tag, x.priv ? 1 : 0, sec.enc(x.title), sec.enc(x.body), now, p.id);
    Object.assign(p, x, { updated: now }); return p.id;
  }
  function del(me, id) {
    const p = posts.get(Number(id) | 0); if (!p || !(p.pid === me || isOp(me) || me === 'staff')) fail('지울 수 없는 글입니다');
    dbx.q.bdDel.run(p.id); posts.delete(p.id); if (p.pid !== me) log(`게시판 글 #${p.id} 삭제 (운영진)`);
  }
  function comment(me, id, text, now, parentId) {
    const p = posts.get(Number(id) | 0); if (!p || (me !== 'staff' && !canSee(me, p))) fail('없는 글입니다');
    const body = clean(text, LIM.COM); if (!body) fail('댓글 입력 필요');
    const op = me === 'staff' || (isOp(me) && p.pid !== me);
    let parent = 0, pc = null;
    if (parentId) { pc = dbx.q.bdComGet.get(Number(parentId) | 0); if (!pc || pc.deleted || pc.post !== p.id) fail('답글을 달 댓글이 없어졌습니다'); parent = pc.parent || pc.id; if (pc.parent) pc = dbx.q.bdComGet.get(pc.parent) || pc; }   // 답글의 답글은 같은 줄기에
    dbx.q.bdComInsert.run(p.id, me, op ? 1 : 0, sec.enc(body), now, parent); comAdd(me, p.id);
    p.ncom++; p.last = now; dbx.q.bdCount.run(p.ncom, now, p.id);
    // 문의에 운영진이 답하면 쓴 학생에게 우편으로 알린다
    const who = me === 'staff' ? '운영진' : nameOf(me), snip = body.replace(/\s+/g, ' ').slice(0, 120);
    if (!p.priv) {
      const short = snip.length > 50 ? snip.slice(0, 50) + '…' : snip, tt = p.title.length > 20 ? p.title.slice(0, 20) + '…' : p.title;
      if (p.pid !== me) note(p.pid, who + ' 님이 내 글 「' + tt + '」에 ' + (parent ? '답글' : '댓글') + '을 달았습니다: ' + short, p.id);
      if (pc && pc.pid !== me && pc.pid !== p.pid) note(pc.pid, who + ' 님이 「' + tt + '」의 내 댓글에 답글을 달았습니다: ' + short, p.id);
    }
    if (op && p.priv && p.pid !== me) sendMail(p.pid, '운영진', '문의에 답변이 달렸습니다', '「' + p.title + '」\n\n' + body.slice(0, 600) + '\n\n교류 › 게시판 › 내 글에서 이어서 볼 수 있습니다.', {}, now + 30 * 86400);
    return p.id;
  }
  // 이 글의 알림 받지 않기 (내 글 댓글 · 내 댓글 답글 · 건의 처리 상태 알림 모두)
  function mute(me, id, on) {
    const p = posts.get(Number(id) | 0); if (!p || !canSee(me, p)) fail('없는 글입니다');
    const k = p.id + ':' + me; if (on) { mutes.add(k); dbx.q.bdMuteOn.run(p.id, me); } else { mutes.delete(k); dbx.q.bdMuteOff.run(p.id, me); }
    return p.id;
  }
  // 내 댓글 · 답글 고치기 (작성자만)
  function cedit(me, cid, text, now) {
    const c = dbx.q.bdComGet.get(Number(cid) | 0); if (!c || c.deleted || c.pid !== me) fail('고칠 수 없는 댓글입니다');
    const p = posts.get(c.post); if (!p || !canSee(me, p)) fail('없는 글입니다');
    const body = clean(text, LIM.COM); if (!body) fail('댓글 입력 필요');
    dbx.q.bdComEdit.run(sec.enc(body), now, c.id); return p.id;
  }
  function cdel(me, cid) {
    const c = dbx.q.bdComGet.get(Number(cid) | 0); if (!c || c.deleted) fail('없는 댓글입니다');
    if (!(c.pid === me || isOp(me) || me === 'staff')) fail('지울 수 없는 댓글입니다');
    dbx.q.bdComDel.run(c.id); if (!Number(dbx.q.bdComMineN.get(c.post, c.pid).n)) { const st = comBy.get(c.pid); if (st) st.delete(c.post); }
    const p = posts.get(c.post); if (p) { p.ncom = Math.max(0, p.ncom - 1); dbx.q.bdCount.run(p.ncom, p.last, p.id); }
  }
  // 운영실(관리자 토큰): 관리자만 보기 글 전부, 본문·댓글 포함
  function adminList() {
    return [...posts.values()].filter((p) => p.priv).sort((a, b) => b.last - a.last).slice(0, 200).map((p) => Object.assign(brief(p, 'staff'), { body: p.body, comments: dbx.q.bdComs.all(p.id).map((c) => comOut(c, 'staff')) }));
  }
  // 운영실 · 건의 모아 보기: 건의 말머리 + 관리자만 보기 글 중 해결 완료 · 반영 안 함이 아닌 것을 텍스트로 (이름은 빼고 글쓴이 · 운영진 · 다른 학생으로만)
  function exportIdeas() {
    const ST = { review: ' [검토 중]', wip: ' [확인 중]', done: ' [해결 완료]', norepro: ' [재현 안 됨]' };
    return [...posts.values()].filter((p) => (p.tag === 'idea' || p.priv) && p.st !== 'done' && p.st !== 'no').sort((a, b) => a.id - b.id).map((p) => {
      const coms = dbx.q.bdComs.all(p.id).map((c) => '  - ' + (c.pid === 'staff' || c.op ? '운영진' : c.pid === p.pid ? '글쓴이' : '다른 학생') + ': ' + sec.dec(c.body).replace(/\s+/g, ' '));
      return '#' + p.id + (p.priv ? ' (관리자만)' : ' (건의)') + (ST[p.st] || '') + ' ' + p.title + '\n' + p.body + (coms.length ? '\n' + coms.join('\n') : '');
    }).join('\n\n---\n\n');
  }
  function deleteBy(pid) { comBy.delete(pid); [...posts.values()].filter((p) => p.pid === pid).forEach((p) => { dbx.q.bdDel.run(p.id); posts.delete(p.id); }); }
  return { list, get, write, edit, del, mute, setStatus, exportIdeas, comment, cedit, cdel, adminList, deleteBy, forgetName: (pid) => names.delete(pid), LIM };
}
module.exports = { create };
