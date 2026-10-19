'use strict';
// 게시판: 질문 · 모집 · 거래 · RP · 잡담 · 건의. 「관리자만 보기」 글(문의)은 쓴 사람과 운영진만 본다.
// 제목·본문·댓글은 DB에 암호화해서 두고, 목록·검색은 서버 메모리에 푼 사본으로 한다 (최근 5,000개).
const R = require('../shared/rules.js');

const TAGS = R.D.BOARD_TAGS.map((t) => t.id);
const LIM = { TITLE: 40, BODY: 3000, COM: 500, PAGE: 20, DAY: 30 };

function create(dbx, sec, opts) {
  const isOp = opts.isOp, sendMail = opts.sendMail || (() => {}), log = opts.log || (() => {});
  const posts = new Map();   // id → {id, pid, tag, priv, title, body, created, updated, last, ncom}
  dbx.q.bdAll.all().forEach((r) => { try { posts.set(r.id, { id: r.id, pid: r.pid, tag: r.tag, priv: !!r.priv, title: sec.dec(r.title), body: sec.dec(r.body), created: r.created, updated: r.updated, last: r.last, ncom: r.ncom, st: r.st || '' }); } catch (e) { } });
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
  // f: {tag: ''|태그|'priv'|'mine', q, qt: 'author'|'title'|'all', page}
  function list(me, f) {
    const op = isOp(me), tag = String(f.tag || ''), q = String(f.q || '').trim().toLowerCase().slice(0, 30), qt = f.qt === 'author' || f.qt === 'title' ? f.qt : 'all';
    let arr = [];
    posts.forEach((p) => {
      if (tag === 'priv') { if (!op || !p.priv) return; }
      else if (tag === 'mine') { if (p.pid !== me) return; }
      else { if (p.priv) return; if (tag && p.tag !== tag) return; }   // 관리자만 보기 글은 일반 목록에 나오지 않는다 (운영진 포함)
      if (f.hideDone && p.st === 'done') return;   // 해결 완료 숨기기
      if (q) {
        const hit = qt === 'author' ? nameOf(p.pid).toLowerCase().replace(/ /g, '').indexOf(q.replace(/ /g, '')) >= 0
          : qt === 'title' ? p.title.toLowerCase().indexOf(q) >= 0 : (p.title + '\n' + p.body).toLowerCase().indexOf(q) >= 0;
        if (!hit) return;
      }
      arr.push(p);
    });
    arr.sort((a, b) => b.id - a.id);
    const total = arr.length, pages = Math.max(1, Math.ceil(total / LIM.PAGE)), page = Math.min(pages, Math.max(1, Number(f.page) | 0 || 1));
    const privN = op ? [...posts.values()].filter((p) => p.priv).length : 0;
    return { list: arr.slice((page - 1) * LIM.PAGE, page * LIM.PAGE).map((p) => brief(p, me)), total, page, pages, op, privN };
  }
  function comOut(c, me) { return { id: c.id, author: nameOf(c.pid), aid: c.pid, op: !!c.op, badge: c.pid === 'staff' ? '' : (opts.badgeOf || (() => ''))(c.pid), mine: c.pid === me, body: sec.dec(c.body), created: c.created, parent: c.parent || 0 }; }
  // 알림: 내 글에 댓글 · 내 댓글에 답글이 달리면 알림 칸에 (우편은 보내지 않는다)
  function note(to, text, post) { if (!to || to === 'staff') return; (opts.note || (() => {}))(to, 'board', text, { view: 'board', post: post }); }
  function get(me, id) {
    const p = posts.get(Number(id) | 0); if (!p || !canSee(me, p)) return null;
    return Object.assign(brief(p, me), { body: p.body, canEdit: p.pid === me, canDel: p.pid === me || isOp(me), canStatus: stOk(me, p), comments: dbx.q.bdComs.all(p.id).map((c) => comOut(c, me)) });
  }
  /* 건의 처리 상태(적용 중 · 해결 완료): 건의 말머리나 관리자만 보기 글에, 학생회장만 붙인다. 바뀌면 쓴 학생에게 알림 */
  const ST = { '': '', wip: '적용 중', done: '해결 완료' };
  const stOk = (me, p) => !!(opts.isChief && opts.isChief(me)) && (p.tag === 'idea' || p.priv);
  function setStatus(me, id, st) {
    const p = posts.get(Number(id) | 0); if (!p || !stOk(me, p)) fail('상태를 바꿀 수 없는 글입니다');
    st = String(st || ''); if (!(st in ST)) fail('알 수 없는 상태입니다'); if (p.st === st) return p.id;
    dbx.q.bdStatus.run(st, p.id); p.st = st;
    if (st && p.pid !== me) note(p.pid, '내 건의 「' + (p.title.length > 20 ? p.title.slice(0, 20) + '…' : p.title) + '」: ' + ST[st], p.id);
    log(`게시판 #${p.id} 상태 → ${ST[st] || '없음'}`); return p.id;
  }
  function fail(msg) { const e = new Error(msg); e.status = 400; throw e; }
  function check(b) {
    const tag = String(b.tag || ''), title = clean(b.title, LIM.TITLE).replace(/\n/g, ' '), body = clean(b.body, LIM.BODY);
    if (TAGS.indexOf(tag) < 0) fail('말머리 선택 필요');
    if (title.length < 2) fail('제목은 두 글자 이상');
    if (!body) fail('내용 입력 필요');
    return { tag, title, body, priv: !!b.priv };
  }
  function write(me, b, now) {
    if (Number(dbx.q.bdTodayBy.get(me, now - 86400).n) >= LIM.DAY) fail('하루에 ' + LIM.DAY + '개까지 쓸 수 있습니다');
    const x = check(b), info = dbx.q.bdInsert.run(me, x.tag, x.priv ? 1 : 0, sec.enc(x.title), sec.enc(x.body), now, now, now);
    const id = Number(info.lastInsertRowid);
    posts.set(id, { id, pid: me, tag: x.tag, priv: x.priv, title: x.title, body: x.body, created: now, updated: now, last: now, ncom: 0 });
    if (x.priv) { log(`게시판 문의 #${id} (${nameOf(me)})`); if (opts.onInquiry) opts.onInquiry(id); }
    return id;
  }
  function edit(me, b, now) {
    const p = posts.get(Number(b.id) | 0); if (!p || p.pid !== me) fail('고칠 수 없는 글입니다');
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
    dbx.q.bdComInsert.run(p.id, me, op ? 1 : 0, sec.enc(body), now, parent);
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
  function cdel(me, cid) {
    const c = dbx.q.bdComGet.get(Number(cid) | 0); if (!c || c.deleted) fail('없는 댓글입니다');
    if (!(c.pid === me || isOp(me) || me === 'staff')) fail('지울 수 없는 댓글입니다');
    dbx.q.bdComDel.run(c.id); const p = posts.get(c.post); if (p) { p.ncom = Math.max(0, p.ncom - 1); dbx.q.bdCount.run(p.ncom, p.last, p.id); }
  }
  // 운영실(관리자 토큰): 관리자만 보기 글 전부, 본문·댓글 포함
  function adminList() {
    return [...posts.values()].filter((p) => p.priv).sort((a, b) => b.last - a.last).slice(0, 200).map((p) => Object.assign(brief(p, 'staff'), { body: p.body, comments: dbx.q.bdComs.all(p.id).map((c) => comOut(c, 'staff')) }));
  }
  // 운영실 · 건의 모아 보기: 건의 말머리 + 관리자만 보기 글 중 해결 완료가 아닌 것을 텍스트로 (이름은 빼고 글쓴이 · 운영진 · 다른 학생으로만)
  function exportIdeas() {
    const ST = { wip: ' [적용 중]', done: ' [해결 완료]' };
    return [...posts.values()].filter((p) => (p.tag === 'idea' || p.priv) && p.st !== 'done').sort((a, b) => a.id - b.id).map((p) => {
      const coms = dbx.q.bdComs.all(p.id).map((c) => '  - ' + (c.pid === 'staff' || c.op ? '운영진' : c.pid === p.pid ? '글쓴이' : '다른 학생') + ': ' + sec.dec(c.body).replace(/\s+/g, ' '));
      return '#' + p.id + (p.priv ? ' (관리자만)' : ' (건의)') + (ST[p.st] || '') + ' ' + p.title + '\n' + p.body + (coms.length ? '\n' + coms.join('\n') : '');
    }).join('\n\n---\n\n');
  }
  function deleteBy(pid) { [...posts.values()].filter((p) => p.pid === pid).forEach((p) => { dbx.q.bdDel.run(p.id); posts.delete(p.id); }); }
  return { list, get, write, edit, del, setStatus, exportIdeas, comment, cdel, adminList, deleteBy, forgetName: (pid) => names.delete(pid), LIM };
}
module.exports = { create };
