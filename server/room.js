'use strict';
// 마이룸 방명록: 방 주인 · 쓴 학생 · 운영진(학생회)이 지울 수 있고, 누구나 신고할 수 있다. 글은 암호화해 저장한다.
// 한 학생이 같은 방에 하루 한 번(KST)만 남길 수 있고, 방마다 최근 D.ROOM_GB.keep개만 보여 준다
const R = require('../shared/rules.js');
const D = require('../shared/data.js');

function create({ dbx, sec }) {
  dbx.db.exec(`CREATE TABLE IF NOT EXISTS room_gb (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      pid TEXT NOT NULL,
      t INTEGER NOT NULL,
      text TEXT NOT NULL,                  -- 암호화
      rep INTEGER NOT NULL DEFAULT 0,      -- 신고 수
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS room_gb_owner ON room_gb(owner, id);
    CREATE INDEX IF NOT EXISTS room_gb_pid ON room_gb(pid, owner, t);`);
  const q = {
    list: dbx.db.prepare('SELECT g.id, g.pid, g.t, g.text, g.rep, p.name FROM room_gb g LEFT JOIN players p ON p.id = g.pid WHERE g.owner = ? AND g.deleted = 0 ORDER BY g.id DESC LIMIT ?'),
    wrote: dbx.db.prepare('SELECT COUNT(*) AS n FROM room_gb WHERE pid = ? AND owner = ? AND t >= ?'),
    add: dbx.db.prepare('INSERT INTO room_gb (owner, pid, t, text) VALUES (?, ?, ?, ?)'),
    get: dbx.db.prepare('SELECT * FROM room_gb WHERE id = ? AND deleted = 0'),
    del: dbx.db.prepare('UPDATE room_gb SET deleted = 1 WHERE id = ?'),
    delBy: dbx.db.prepare('UPDATE room_gb SET deleted = 1 WHERE pid = ?'),
    rep: dbx.db.prepare('UPDATE room_gb SET rep = rep + 1 WHERE id = ?'),
    reported: dbx.db.prepare('SELECT g.id, g.owner, g.pid, g.t, g.text, g.rep, p.name AS pname, o.name AS oname FROM room_gb g LEFT JOIN players p ON p.id = g.pid LEFT JOIN players o ON o.id = g.owner WHERE g.rep > 0 AND g.deleted = 0 ORDER BY g.id DESC LIMIT 100')
  };
  const dec = (s) => { try { return sec.dec(s); } catch (e) { return ''; } };
  // 글 다듬기: 보이지 않는 제어 문자 · 방향 문자를 빼고, 줄바꿈은 두 줄까지
  function clean(text) { return String(text == null ? '' : text).slice(0, 1000).replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '').replace(/\n{3,}/g, '\n\n').trim(); }
  function list(owner) { return q.list.all(owner, D.ROOM_GB.keep).map((r) => ({ id: r.id, pid: r.pid, name: r.name || '학생', t: r.t, text: dec(r.text) })); }
  function wroteToday(pid, owner, now) { return Number(q.wrote.get(pid, owner, R.dayKST(now) * 86400 - R.K.TZ).n) > 0; }
  function write(pid, owner, text, now) {
    const t = clean(text); if (!t) throw new Error('내용 입력 필요');
    if (Array.from(t).length > D.ROOM_GB.max) throw new Error('방명록은 ' + D.ROOM_GB.max + '자까지 작성할 수 있습니다');
    if (wroteToday(pid, owner, now)) throw new Error('이 방에는 오늘 이미 방명록을 남겼습니다 (KST 0시 초기화)');
    return Number(q.add.run(owner, pid, Math.floor(now), sec.enc(t)).lastInsertRowid);
  }
  // 지우기: 방 주인 · 쓴 학생 · 운영진
  function remove(id, pid, isOp) { const r = q.get.get(Number(id)); if (!r) throw new Error('없는 글입니다'); if (r.owner !== pid && r.pid !== pid && !isOp) throw new Error('지울 수 없는 글입니다'); q.del.run(r.id); return r; }
  function report(id) { const r = q.get.get(Number(id)); if (!r) throw new Error('없는 글입니다'); q.rep.run(r.id); return r; }
  function reported() { return q.reported.all().map((r) => ({ id: r.id, owner: r.owner, oname: r.oname || '', pid: r.pid, pname: r.pname || '', t: r.t, rep: r.rep, text: dec(r.text) })); }
  return { list, write, remove, report, reported, wroteToday, deleteBy: (pid) => q.delBy.run(pid), adminDelete: (id) => q.del.run(Number(id)) };
}
module.exports = { create };
