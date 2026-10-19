'use strict';
// SQLite 저장소 (Node 22.13+ 내장 node:sqlite, 외부 패키지 없음)
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.warn(w); });
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

function open(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'moneta.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      house TEXT NOT NULL,
      pass TEXT NOT NULL,
      created INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      state TEXT NOT NULL,
      power REAL NOT NULL DEFAULT 0,
      lvl INTEGER NOT NULL DEFAULT 1,
      grade INTEGER NOT NULL DEFAULT 1,
      max_stage INTEGER NOT NULL DEFAULT 9,
      wb_dps REAL NOT NULL DEFAULT 0,
      banned INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS players_power ON players(power DESC);
    CREATE INDEX IF NOT EXISTS players_stage ON players(max_stage DESC, power DESC);
    CREATE INDEX IF NOT EXISTS players_seen ON players(last_seen);
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      pid TEXT NOT NULL,
      created INTEGER NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_pid ON sessions(pid);
    CREATE TABLE IF NOT EXISTS weekly (
      week INTEGER NOT NULL,
      pid TEXT NOT NULL,
      house TEXT NOT NULL,
      cup REAL NOT NULL DEFAULT 0,
      dmg REAL NOT NULL DEFAULT 0,
      att INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (week, pid)
    );
    CREATE INDEX IF NOT EXISTS weekly_cup ON weekly(week, house, cup DESC);
    CREATE INDEX IF NOT EXISTS weekly_dmg ON weekly(week, dmg DESC);
    CREATE TABLE IF NOT EXISTS kv (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites (
      code TEXT PRIMARY KEY,
      max_uses INTEGER NOT NULL DEFAULT 1,
      uses INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL,
      expires INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      disabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS chat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ch TEXT NOT NULL,
      t REAL NOT NULL,
      pid TEXT NOT NULL,
      name TEXT NOT NULL,
      house TEXT NOT NULL,
      grade INTEGER NOT NULL DEFAULT 1,
      guest INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'say',
      text TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS chat_ch ON chat(ch, id DESC);
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      t INTEGER NOT NULL,
      msg_id INTEGER NOT NULL,
      reporter TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      resolved INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS friends (
      pid TEXT NOT NULL,
      fid TEXT NOT NULL,
      state TEXT NOT NULL,          -- 'req' 보낸 신청, 'ok' 친구
      t INTEGER NOT NULL,
      PRIMARY KEY (pid, fid)
    );
    CREATE INDEX IF NOT EXISTS friends_fid ON friends(fid, state);
    CREATE TABLE IF NOT EXISTS parties (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      leader TEXT NOT NULL,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS party_members (
      pid TEXT PRIMARY KEY,
      party TEXT NOT NULL,
      joined INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS party_members_party ON party_members(party);
    CREATE TABLE IF NOT EXISTS party_invites (
      pid TEXT NOT NULL,
      party TEXT NOT NULL,
      by TEXT NOT NULL,
      t INTEGER NOT NULL,
      PRIMARY KEY (pid, party)
    );
    CREATE TABLE IF NOT EXISTS market (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller TEXT NOT NULL,
      kind TEXT NOT NULL,            -- item | mat
      data TEXT NOT NULL,            -- 장비 JSON 또는 재료 id
      name TEXT NOT NULL,
      slot TEXT NOT NULL DEFAULT '',
      rarity INTEGER NOT NULL DEFAULT 0,
      ilvl INTEGER NOT NULL DEFAULT 0,
      qty INTEGER NOT NULL DEFAULT 1,
      price REAL NOT NULL,
      created INTEGER NOT NULL,
      expires INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      buyer TEXT NOT NULL DEFAULT '',
      done_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS market_open ON market(status, kind, price);
    CREATE INDEX IF NOT EXISTS market_seller ON market(seller, status);
    CREATE INDEX IF NOT EXISTS market_sold ON market(status, done_at);
    CREATE INDEX IF NOT EXISTS market_exp ON market(status, expires);
  `);
  // 이전 버전 DB에 새 열 추가
  { const bc = db.prepare(`PRAGMA table_info(board_comments)`).all().map((c) => c.name); if (bc.length && bc.indexOf('parent') < 0) db.exec(`ALTER TABLE board_comments ADD COLUMN parent INTEGER NOT NULL DEFAULT 0`); }
  const cols = db.prepare(`PRAGMA table_info(players)`).all().map((c) => c.name);
  if (cols.indexOf('guest') < 0) db.exec(`ALTER TABLE players ADD COLUMN guest INTEGER NOT NULL DEFAULT 0`);
  if (cols.indexOf('invite') < 0) db.exec(`ALTER TABLE players ADD COLUMN invite TEXT NOT NULL DEFAULT ''`);
  if (cols.indexOf('muted_until') < 0) db.exec(`ALTER TABLE players ADD COLUMN muted_until INTEGER NOT NULL DEFAULT 0`);
  if (cols.indexOf('title') < 0) db.exec(`ALTER TABLE players ADD COLUMN title TEXT NOT NULL DEFAULT ''`);
  if (cols.indexOf('profile') < 0) db.exec(`ALTER TABLE players ADD COLUMN profile TEXT NOT NULL DEFAULT '{}'`);
  if (cols.indexOf('avatar') < 0) db.exec(`ALTER TABLE players ADD COLUMN avatar BLOB`);
  if (cols.indexOf('avatar_type') < 0) db.exec(`ALTER TABLE players ADD COLUMN avatar_type TEXT NOT NULL DEFAULT ''`);
  if (cols.indexOf('role') < 0) db.exec(`ALTER TABLE players ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);   // 'admin' 운영자 | 'user'
  if (cols.indexOf('avatar_v') < 0) db.exec(`ALTER TABLE players ADD COLUMN avatar_v INTEGER NOT NULL DEFAULT 0`);
  // 로그인 아이디: 평문 대신 HMAC 색인(sec.index)만 둔다. 게임 안에는 나오지 않는다. 빈 값은 server.js가 시작할 때 채운다
  { const ic = db.prepare(`PRAGMA table_info(invites)`).all().map((c) => c.name); if (ic.indexOf('op') < 0) db.exec(`ALTER TABLE invites ADD COLUMN op INTEGER NOT NULL DEFAULT 0`); }   // 운영자 초대코드
  if (cols.indexOf('login_key') < 0) db.exec(`ALTER TABLE players ADD COLUMN login_key TEXT NOT NULL DEFAULT ''`);
  if (cols.indexOf('login_enc') < 0) db.exec(`ALTER TABLE players ADD COLUMN login_enc TEXT NOT NULL DEFAULT ''`);   // 아이디 (암호화 · 운영실 확인용)
  if (cols.indexOf('deleted') < 0) db.exec(`ALTER TABLE players ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`);   // 캐릭터 초기화로 남은 예전 캐릭터
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS players_login ON players(login_key) WHERE login_key <> ''`);
  const ccols = db.prepare(`PRAGMA table_info(chat)`).all().map((c) => c.name);
  if (ccols.indexOf('title') < 0) db.exec(`ALTER TABLE chat ADD COLUMN title TEXT NOT NULL DEFAULT ''`);
  if (ccols.indexOf('ink') < 0) db.exec(`ALTER TABLE chat ADD COLUMN ink TEXT NOT NULL DEFAULT ''`);   // 이름 잉크 (꾸미기)
  const pcols = db.prepare(`PRAGMA table_info(parties)`).all().map((c) => c.name);
  if (pcols.indexOf('npcs') < 0) db.exec(`ALTER TABLE parties ADD COLUMN npcs TEXT NOT NULL DEFAULT '[]'`);
  if (pcols.indexOf('allgo') < 0) db.exec(`ALTER TABLE parties ADD COLUMN allgo INTEGER NOT NULL DEFAULT 0`);   // 파티원도 원정에 파티를 데려갈 수 있음
  const mcols = db.prepare(`PRAGMA table_info(market)`).all().map((c) => c.name);
  if (mcols.indexOf('seller_name') < 0) db.exec(`ALTER TABLE market ADD COLUMN seller_name TEXT NOT NULL DEFAULT ''`);
  // 게시판: 제목·본문은 암호화 (관리자만 보기 문의에 개인정보가 들어갈 수 있으므로). 검색은 서버 메모리에서 푼 뒤에 한다.
  db.exec(`
    CREATE TABLE IF NOT EXISTS board_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pid TEXT NOT NULL,
      tag TEXT NOT NULL,
      priv INTEGER NOT NULL DEFAULT 0,     -- 1 = 관리자만 보기 (쓴 사람과 운영진만)
      title TEXT NOT NULL,                 -- 암호화
      body TEXT NOT NULL,                  -- 암호화
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL,
      last INTEGER NOT NULL,               -- 마지막 댓글 시각
      ncom INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS board_pid ON board_posts(pid, id);
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pid TEXT NOT NULL,
      t INTEGER NOT NULL,
      kind TEXT NOT NULL,                  -- board · market · party · friend · exp · guild
      text TEXT NOT NULL,                  -- 암호화
      link TEXT NOT NULL DEFAULT '',       -- 눌렀을 때 갈 곳 (JSON)
      read INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS notes_pid ON notes(pid, id);
    CREATE TABLE IF NOT EXISTS board_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post INTEGER NOT NULL,
      pid TEXT NOT NULL,                   -- 'staff' = 운영실에서 쓴 답변
      op INTEGER NOT NULL DEFAULT 0,       -- 운영진 답변 표시
      body TEXT NOT NULL,                  -- 암호화
      created INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      parent INTEGER NOT NULL DEFAULT 0    -- 답글이면 원래 댓글 id
    );
    CREATE INDEX IF NOT EXISTS board_com ON board_comments(post, id);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS oplog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      t INTEGER NOT NULL,
      actor TEXT NOT NULL,          -- 학생 id 또는 'admin'
      name TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS dm (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      a TEXT NOT NULL,              -- 두 학생 id 중 작은 쪽
      b TEXT NOT NULL,
      t REAL NOT NULL,
      sender TEXT NOT NULL,
      text TEXT NOT NULL            -- 암호화
    );
    CREATE INDEX IF NOT EXISTS dm_pair ON dm(a, b, id);
    CREATE INDEX IF NOT EXISTS dm_b ON dm(b, id);
    CREATE TABLE IF NOT EXISTS guilds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      intro TEXT NOT NULL DEFAULT '',
      notice TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#d6ad5f',
      owner TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'open',   -- open 바로 가입 | apply 신청 후 승인
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS guild_members (
      pid TEXT PRIMARY KEY,
      guild TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',  -- owner 회장 | officer 부회장 | member 부원
      joined INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS guild_members_g ON guild_members(guild);
    CREATE TABLE IF NOT EXISTS guild_apps (
      pid TEXT NOT NULL,
      guild TEXT NOT NULL,
      t INTEGER NOT NULL,
      msg TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (pid, guild)
    );
    CREATE TABLE IF NOT EXISTS guild_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild TEXT NOT NULL,
      data TEXT NOT NULL,             -- 장비 JSON
      name TEXT NOT NULL,
      rarity INTEGER NOT NULL DEFAULT 0,
      ilvl INTEGER NOT NULL DEFAULT 0,
      slot TEXT NOT NULL DEFAULT '',
      by_name TEXT NOT NULL DEFAULT '',
      t INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS guild_items_g ON guild_items(guild);
    CREATE TABLE IF NOT EXISTS guild_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild TEXT NOT NULL,
      t INTEGER NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS guild_log_g ON guild_log(guild, id);
    CREATE TABLE IF NOT EXISTS guild_invites (
      pid TEXT NOT NULL,
      guild TEXT NOT NULL,
      by TEXT NOT NULL,
      t INTEGER NOT NULL,
      PRIMARY KEY (pid, guild)
    );
    CREATE TABLE IF NOT EXISTS mail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target TEXT NOT NULL,              -- '*' = 모든 학생, 아니면 학생 id
      sender TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      rewards TEXT NOT NULL DEFAULT '{}',
      created INTEGER NOT NULL,          -- 실제 시각
      created_g INTEGER NOT NULL,        -- 게임 시각 (가입 시각과 비교)
      expires INTEGER NOT NULL,          -- 실제 시각
      newcomers INTEGER NOT NULL DEFAULT 1,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS mail_target ON mail(target, expires);
    CREATE TABLE IF NOT EXISTS mail_state (
      mail INTEGER NOT NULL,
      pid TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      claimed INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (mail, pid)
    );
    CREATE TABLE IF NOT EXISTS auction (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visit INTEGER NOT NULL,
      item TEXT NOT NULL,
      name TEXT NOT NULL,
      rarity INTEGER NOT NULL,
      ilvl INTEGER NOT NULL,
      slot TEXT NOT NULL,
      ends INTEGER NOT NULL,
      min INTEGER NOT NULL,
      price INTEGER NOT NULL DEFAULT 0,
      bidder TEXT NOT NULL DEFAULT '',
      bidder_name TEXT NOT NULL DEFAULT '',
      bids INTEGER NOT NULL DEFAULT 0,
      npc_cap INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS auction_visit ON auction(visit);
    CREATE TABLE IF NOT EXISTS tower (
      party TEXT PRIMARY KEY,
      week INTEGER NOT NULL,
      floor INTEGER NOT NULL DEFAULT 0,
      log TEXT NOT NULL DEFAULT '[]'
    );
  `);
  const gcols = db.prepare(`PRAGMA table_info(guilds)`).all().map((c) => c.name);
  [['lv', 'INTEGER NOT NULL DEFAULT 1'], ['xp', 'INTEGER NOT NULL DEFAULT 0'], ['gold', 'REAL NOT NULL DEFAULT 0'], ['ranks', "TEXT NOT NULL DEFAULT '{}'"]].forEach((c) => { if (gcols.indexOf(c[0]) < 0) db.exec(`ALTER TABLE guilds ADD COLUMN ${c[0]} ${c[1]}`); });
  const gmcols = db.prepare(`PRAGMA table_info(guild_members)`).all().map((c) => c.name);
  [['rank', "TEXT NOT NULL DEFAULT ''"], ['contrib', 'INTEGER NOT NULL DEFAULT 0'], ['cday', 'INTEGER NOT NULL DEFAULT -1'], ['dday', 'INTEGER NOT NULL DEFAULT -1'], ['dpts', 'INTEGER NOT NULL DEFAULT 0']].forEach((c) => { if (gmcols.indexOf(c[0]) < 0) db.exec(`ALTER TABLE guild_members ADD COLUMN ${c[0]} ${c[1]}`); });
  // 세션 토큰은 해시로만 보관한다 (DB가 새어 나가도 로그인 상태를 훔칠 수 없도록). 예전 평문 토큰을 한 번 바꿔 둔다.
  const crypto = require('crypto');
  const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('base64url');
  const flag = db.prepare(`SELECT v FROM kv WHERE k = 'sessions_hashed'`).get();
  if (!flag) {
    const rows = db.prepare(`SELECT token FROM sessions`).all(), up = db.prepare(`UPDATE sessions SET token = ? WHERE token = ?`);
    db.exec('BEGIN'); rows.forEach((r) => up.run('h:' + sha(r.token), r.token));
    db.prepare(`INSERT INTO kv (k, v) VALUES ('sessions_hashed', '1')`).run(); db.exec('COMMIT');
  }
  // 데이터 파일은 서버 계정만 읽을 수 있게
  ['moneta.db', 'moneta.db-wal', 'moneta.db-shm'].forEach((f) => { try { fs.chmodSync(path.join(dir, f), 0o600); } catch (e) { } });
  try { fs.chmodSync(dir, 0o700); } catch (e) { }
  const q = {
    insertPlayer: db.prepare(`INSERT INTO players (id, name, name_key, house, pass, created, last_seen, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    playerByKey: db.prepare(`SELECT id, name, pass, banned FROM players WHERE name_key = ?`),
    playerSearch: db.prepare(`SELECT id, name, house, grade, lvl, avatar_v, title, last_seen FROM players WHERE name_key LIKE ? ESCAPE '\\' AND banned = 0 AND guest = 0 ORDER BY (name_key = ?) DESC, last_seen DESC LIMIT 20`),
    playerById: db.prepare(`SELECT id, name, state, banned FROM players WHERE id = ?`),
    savePlayer: db.prepare(`UPDATE players SET state = ?, last_seen = ?, power = ?, lvl = ?, grade = ?, max_stage = ?, wb_dps = ?, house = ?, title = ? WHERE id = ?`),
    setBan: db.prepare(`UPDATE players SET banned = ? WHERE name_key = ?`),
    setPass: db.prepare(`UPDATE players SET pass = ? WHERE id = ?`),
    countPlayers: db.prepare(`SELECT COUNT(*) AS n FROM players`),
    countActive: db.prepare(`SELECT COUNT(*) AS n FROM players WHERE last_seen >= ?`),
    sumActiveDps: db.prepare(`SELECT COALESCE(SUM(wb_dps), 0) AS s, COUNT(*) AS n FROM players WHERE last_seen >= ? AND banned = 0`),
    topPower: db.prepare(`SELECT id, name, house, power, lvl, grade, max_stage FROM players WHERE banned = 0 ORDER BY power DESC LIMIT ?`),
    topStage: db.prepare(`SELECT id, name, house, power, lvl, grade, max_stage FROM players WHERE banned = 0 ORDER BY max_stage DESC, power DESC LIMIT ?`),
    rankPower: db.prepare(`SELECT COUNT(*) + 1 AS r FROM players WHERE banned = 0 AND power > ?`),
    insertSession: db.prepare(`INSERT INTO sessions (token, pid, created, expires) VALUES (?, ?, ?, ?)`),
    getSession: db.prepare(`SELECT pid, expires FROM sessions WHERE token = ?`),
    touchSession: db.prepare(`UPDATE sessions SET expires = ? WHERE token = ?`),
    delSession: db.prepare(`DELETE FROM sessions WHERE token = ?`),
    delSessionsFor: db.prepare(`DELETE FROM sessions WHERE pid = ?`),
    purgeSessions: db.prepare(`DELETE FROM sessions WHERE expires < ?`),
    upsertWeekly: db.prepare(`INSERT INTO weekly (week, pid, house, cup, dmg, att) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(week, pid) DO UPDATE SET house = excluded.house, cup = excluded.cup, dmg = excluded.dmg, att = excluded.att`),
    houseCup: db.prepare(`SELECT COALESCE(SUM(cup), 0) AS s, COUNT(*) AS n FROM (SELECT cup FROM weekly WHERE week = ? AND house = ? AND cup > 0 ORDER BY cup DESC LIMIT ?)`),
    houseMembers: db.prepare(`SELECT COUNT(*) AS n FROM weekly WHERE week = ? AND house = ? AND cup > 0`),
    topDmg: db.prepare(`SELECT w.pid, p.name, p.house, w.dmg FROM weekly w JOIN players p ON p.id = w.pid WHERE w.week = ? AND w.dmg > 0 AND p.banned = 0 ORDER BY w.dmg DESC LIMIT ?`),
    dmgList: db.prepare(`SELECT dmg FROM weekly WHERE week = ? AND dmg > 0 ORDER BY dmg DESC`),
    sumDmg: db.prepare(`SELECT COALESCE(SUM(dmg), 0) AS s, COUNT(*) AS n FROM weekly WHERE week = ? AND dmg > 0`),
    purgeWeekly: db.prepare(`DELETE FROM weekly WHERE week < ?`),
    insertPlayerFull: db.prepare(`INSERT INTO players (id, name, name_key, house, pass, created, last_seen, state, guest, invite, login_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    playerByLogin: db.prepare(`SELECT id, name, pass, banned FROM players WHERE login_key = ?`),
    passById: db.prepare(`SELECT pass FROM players WHERE id = ?`),
    noLoginKey: db.prepare(`SELECT id, name_key FROM players WHERE login_key = ''`),
    setLoginKey: db.prepare(`UPDATE players SET login_key = ? WHERE id = ?`),
    playerMeta: db.prepare(`SELECT id, name, guest, muted_until, banned, invite, role FROM players WHERE id = ?`),
    admins: db.prepare(`SELECT id, role FROM players WHERE role IN ('admin', 'chief')`),   // admin 학생회 · chief 학생회장
    setRole: db.prepare(`UPDATE players SET role = ? WHERE id = ?`),
    oplogAdd: db.prepare(`INSERT INTO oplog (t, actor, name, action, detail) VALUES (?, ?, ?, ?, ?)`),
    oplogList: db.prepare(`SELECT * FROM oplog ORDER BY id DESC LIMIT ?`),
    upgradeGuest: db.prepare(`UPDATE players SET name = ?, name_key = ?, pass = ?, guest = 0, invite = ? WHERE id = ? AND guest = 1`),
    renamePlayer: db.prepare(`UPDATE players SET name = ?, name_key = ? WHERE id = ?`),
    setMute: db.prepare(`UPDATE players SET muted_until = ? WHERE id = ?`),
    getInvite: db.prepare(`SELECT code, max_uses, uses, expires, disabled, note, op FROM invites WHERE code = ?`),
    useInvite: db.prepare(`UPDATE invites SET uses = uses + 1 WHERE code = ? AND uses < max_uses AND disabled = 0`),
    insertInvite: db.prepare(`INSERT INTO invites (code, max_uses, uses, created, expires, note, op) VALUES (?, ?, 0, ?, ?, ?, ?)`),
    listInvites: db.prepare(`SELECT i.code, i.max_uses, i.uses, i.created, i.expires, i.note, i.disabled, i.op, (SELECT group_concat(name, ', ') FROM players p WHERE p.invite = i.code) AS used_by FROM invites i ORDER BY i.created DESC LIMIT ?`),
    disableInvite: db.prepare(`UPDATE invites SET disabled = ? WHERE code = ?`),
    insertChat: db.prepare(`INSERT INTO chat (ch, t, pid, name, house, grade, guest, kind, text, title, ink) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    recentChat: db.prepare(`SELECT id, ch, t, pid, name, house, grade, guest, kind, text, title, ink FROM chat WHERE ch = ? AND deleted = 0 ORDER BY id DESC LIMIT ?`),
    newerChat: db.prepare(`SELECT id, ch, t, pid, name, house, grade, guest, kind, text, title, ink FROM chat WHERE ch = ? AND deleted = 0 AND id > ? ORDER BY id ASC LIMIT ?`),
    olderChat: db.prepare(`SELECT id, ch, t, pid, name, house, grade, guest, kind, text, title, ink FROM chat WHERE ch = ? AND deleted = 0 AND id < ? ORDER BY id DESC LIMIT ?`),
    getChat: db.prepare(`SELECT id, ch, t, pid, name, house, grade, guest, kind, text, deleted FROM chat WHERE id = ?`),
    deleteChat: db.prepare(`UPDATE chat SET deleted = 1 WHERE id = ?`),
    pruneChat: db.prepare(`DELETE FROM chat WHERE ch = ? AND id < (SELECT COALESCE(MIN(id), 0) FROM (SELECT id FROM chat WHERE ch = ? ORDER BY id DESC LIMIT ?))`),
    insertReport: db.prepare(`INSERT INTO reports (t, msg_id, reporter, reason) VALUES (?, ?, ?, ?)`),
    listReports: db.prepare(`SELECT r.id, r.t, r.msg_id, r.reason, r.resolved, p.name AS reporter, c.ch, c.name AS author, c.pid AS author_id, c.text, c.kind, c.deleted FROM reports r LEFT JOIN players p ON p.id = r.reporter LEFT JOIN chat c ON c.id = r.msg_id WHERE r.resolved = ? ORDER BY r.id DESC LIMIT ?`),
    resolveReport: db.prepare(`UPDATE reports SET resolved = 1 WHERE id = ?`),
    reportExists: db.prepare(`SELECT id FROM reports WHERE msg_id = ? AND reporter = ?`),
    // 프로필 · 두상
    getProfile: db.prepare(`SELECT id, name, house, grade, lvl, power, created, guest, profile, avatar_v, banned, title, deleted FROM players WHERE id = ?`),
    setProfile: db.prepare(`UPDATE players SET profile = ? WHERE id = ?`),
    setAvatar: db.prepare(`UPDATE players SET avatar = ?, avatar_type = ?, avatar_v = avatar_v + 1 WHERE id = ?`),
    clearAvatar: db.prepare(`UPDATE players SET avatar = NULL, avatar_type = '', avatar_v = avatar_v + 1 WHERE id = ?`),
    getAvatar: db.prepare(`SELECT avatar, avatar_type, avatar_v FROM players WHERE id = ?`),
    avatarVs: db.prepare(`SELECT id, avatar_v FROM players WHERE avatar_v > 0 AND avatar IS NOT NULL`),
    // 친구
    friendRow: db.prepare(`SELECT state FROM friends WHERE pid = ? AND fid = ?`),
    friendPut: db.prepare(`INSERT INTO friends (pid, fid, state, t) VALUES (?, ?, ?, ?) ON CONFLICT(pid, fid) DO UPDATE SET state = excluded.state, t = excluded.t`),
    friendDel: db.prepare(`DELETE FROM friends WHERE (pid = ? AND fid = ?) OR (pid = ? AND fid = ?)`),
    friendCount: db.prepare(`SELECT COUNT(*) AS n FROM friends WHERE pid = ? AND state = 'ok'`),
    friendList: db.prepare(`SELECT f.fid AS id, f.state, f.t, p.name, p.house, p.grade, p.lvl, p.last_seen, p.avatar_v, p.profile, p.title FROM friends f JOIN players p ON p.id = f.fid WHERE f.pid = ? AND p.banned = 0 ORDER BY p.last_seen DESC LIMIT 300`),
    friendIncoming: db.prepare(`SELECT f.pid AS id, f.t, p.name, p.house, p.grade, p.lvl, p.avatar_v FROM friends f JOIN players p ON p.id = f.pid WHERE f.fid = ? AND f.state = 'req' AND p.banned = 0 ORDER BY f.t DESC LIMIT 100`),
    friendIncomingCount: db.prepare(`SELECT COUNT(*) AS n FROM friends WHERE fid = ? AND state = 'req'`),
    // 파티
    partyGet: db.prepare(`SELECT id, name, leader, created, npcs, allgo FROM parties WHERE id = ?`),
    partySetAllgo: db.prepare(`UPDATE parties SET allgo = ? WHERE id = ?`),
    partySetNpcs: db.prepare(`UPDATE parties SET npcs = ? WHERE id = ?`),
    partyInsert: db.prepare(`INSERT INTO parties (id, name, leader, created) VALUES (?, ?, ?, ?)`),
    partyLeader: db.prepare(`UPDATE parties SET leader = ? WHERE id = ?`),
    partyDelete: db.prepare(`DELETE FROM parties WHERE id = ?`),
    partyMembers: db.prepare(`SELECT m.pid AS id, m.joined, p.name, p.house, p.grade, p.lvl, p.avatar_v, p.last_seen, p.title FROM party_members m JOIN players p ON p.id = m.pid WHERE m.party = ? ORDER BY m.joined`),
    partyAllMembers: db.prepare(`SELECT pid, party FROM party_members`),
    partyJoin: db.prepare(`INSERT INTO party_members (pid, party, joined) VALUES (?, ?, ?)`),
    partyLeave: db.prepare(`DELETE FROM party_members WHERE pid = ?`),
    partyInvite: db.prepare(`INSERT INTO party_invites (pid, party, by, t) VALUES (?, ?, ?, ?) ON CONFLICT(pid, party) DO UPDATE SET by = excluded.by, t = excluded.t`),
    partyInvitesFor: db.prepare(`SELECT i.party, i.t, pa.name, b.name AS by_name, (SELECT COUNT(*) FROM party_members m WHERE m.party = i.party) AS n FROM party_invites i JOIN parties pa ON pa.id = i.party JOIN players b ON b.id = i.by WHERE i.pid = ? ORDER BY i.t DESC LIMIT 20`),
    partyInviteGet: db.prepare(`SELECT pid, party FROM party_invites WHERE pid = ? AND party = ?`),
    partyInviteDel: db.prepare(`DELETE FROM party_invites WHERE pid = ? AND party = ?`),
    partyInviteDelParty: db.prepare(`DELETE FROM party_invites WHERE party = ?`),
    partyInviteCount: db.prepare(`SELECT COUNT(*) AS n FROM party_invites WHERE pid = ?`),
    // 거래소
    mkInsert: db.prepare(`INSERT INTO market (seller, kind, data, name, slot, rarity, ilvl, qty, price, created, expires, seller_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    mkNpcOpen: db.prepare(`SELECT COUNT(*) AS n FROM market WHERE status = 'open' AND seller LIKE 'npc:%'`),
    dmInsert: db.prepare(`INSERT INTO dm (a, b, t, sender, text) VALUES (?, ?, ?, ?, ?)`),
    dmOlder: db.prepare(`SELECT id, t, sender, text FROM dm WHERE a = ? AND b = ? AND id < ? ORDER BY id DESC LIMIT ?`),
    dmThreads: db.prepare(`SELECT a, b, MAX(id) AS last, MAX(t) AS t FROM dm WHERE a = ? OR b = ? GROUP BY a, b ORDER BY last DESC LIMIT 60`),
    dmGet: db.prepare(`SELECT id, t, sender, text FROM dm WHERE id = ?`),
    mkGet: db.prepare(`SELECT * FROM market WHERE id = ?`),
    mkSoldItem: db.prepare(`SELECT name, rarity, ilvl, qty, price, done_at FROM market WHERE kind = 'item' AND status = 'sold' AND slot = ? AND rarity = ? AND ilvl BETWEEN ? AND ? AND done_at > ? ORDER BY done_at DESC LIMIT 50`),
    mkSoldMat: db.prepare(`SELECT name, qty, price, done_at FROM market WHERE kind = 'mat' AND status = 'sold' AND data = ? AND done_at > ? ORDER BY done_at DESC LIMIT 50`),
    mkSoldBadge: db.prepare(`SELECT name, ilvl, qty, price, done_at FROM market WHERE kind = 'badge' AND status = 'sold' AND slot = ? AND ilvl BETWEEN ? AND ? AND done_at > ? ORDER BY done_at DESC LIMIT 50`),
    mkSoldPot: db.prepare(`SELECT name, qty, price, done_at FROM market WHERE kind = 'pot' AND status = 'sold' AND data = ? AND done_at > ? ORDER BY done_at DESC LIMIT 50`),
    mkTrades: db.prepare(`SELECT id, kind, name, slot, rarity, ilvl, qty, price, done_at FROM market WHERE status = 'sold' ORDER BY done_at DESC, id DESC LIMIT ?`),
    mkSetStatus: db.prepare(`UPDATE market SET status = ?, buyer = ?, done_at = ? WHERE id = ? AND status = 'open'`),
    mkMine: db.prepare(`SELECT id, kind, data, name, slot, rarity, ilvl, qty, price, created, expires, status, done_at FROM market WHERE seller = ? AND (status = 'open' OR done_at > ?) ORDER BY id DESC LIMIT 40`),
    mkMineOpen: db.prepare(`SELECT COUNT(*) AS n FROM market WHERE seller = ? AND status = 'open'`),
    mkExpired: db.prepare(`SELECT * FROM market WHERE status = 'open' AND expires < ? LIMIT 200`),
    mkPurge: db.prepare(`DELETE FROM market WHERE status != 'open' AND done_at < ?`),
    // 동아리
    gGet: db.prepare(`SELECT * FROM guilds WHERE id = ?`),
    gByKey: db.prepare(`SELECT id FROM guilds WHERE name_key = ?`),
    gInsert: db.prepare(`INSERT INTO guilds (id, name, name_key, intro, color, owner, mode, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    gUpdate: db.prepare(`UPDATE guilds SET intro = ?, notice = ?, color = ?, mode = ? WHERE id = ?`),
    gOwner: db.prepare(`UPDATE guilds SET owner = ? WHERE id = ?`),
    gDelete: db.prepare(`DELETE FROM guilds WHERE id = ?`),
    gList: db.prepare(`SELECT g.id, g.name, g.intro, g.color, g.mode, g.created, g.lv, (SELECT COUNT(*) FROM guild_members m WHERE m.guild = g.id) AS n, p.name AS owner_name FROM guilds g LEFT JOIN players p ON p.id = g.owner ORDER BY n DESC, g.created ASC LIMIT 100`),
    gMembers: db.prepare(`SELECT m.pid AS id, m.role, m.rank, m.contrib, m.cday, m.dday, m.dpts, m.joined, p.name, p.house, p.grade, p.lvl, p.avatar_v, p.last_seen, p.title FROM guild_members m JOIN players p ON p.id = m.pid WHERE m.guild = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END, m.joined`),
    gRank: db.prepare(`SELECT g.id, g.name, g.intro, g.created, g.color, g.mode, g.lv, g.xp, COUNT(m.pid) AS n, COALESCE(SUM(p.power), 0) AS pw, o.name AS owner_name FROM guilds g LEFT JOIN guild_members m ON m.guild = g.id LEFT JOIN players p ON p.id = m.pid LEFT JOIN players o ON o.id = g.owner GROUP BY g.id`),
    gAllMembers: db.prepare(`SELECT m.pid, m.guild, m.role, g.lv FROM guild_members m JOIN guilds g ON g.id = m.guild`),
    gMember: db.prepare(`SELECT * FROM guild_members WHERE pid = ?`),
    gSetRank: db.prepare(`UPDATE guild_members SET rank = ? WHERE pid = ?`),
    gClearRank: db.prepare(`UPDATE guild_members SET rank = '' WHERE guild = ? AND rank = ?`),
    gCheckin: db.prepare(`UPDATE guild_members SET cday = ?, contrib = contrib + ? WHERE pid = ? AND cday != ?`),
    gDonate: db.prepare(`UPDATE guild_members SET dday = ?, dpts = ?, contrib = contrib + ? WHERE pid = ?`),
    gSetLvXp: db.prepare(`UPDATE guilds SET lv = ?, xp = ? WHERE id = ?`),
    gRanks: db.prepare(`UPDATE guilds SET ranks = ? WHERE id = ?`),
    gGoldAdd: db.prepare(`UPDATE guilds SET gold = gold + ? WHERE id = ?`),
    gGoldTake: db.prepare(`UPDATE guilds SET gold = gold - ? WHERE id = ? AND gold >= ?`),
    giList: db.prepare(`SELECT id, data, name, rarity, ilvl, slot, by_name, t FROM guild_items WHERE guild = ? ORDER BY rarity DESC, ilvl DESC, id`),
    giCount: db.prepare(`SELECT COUNT(*) AS n FROM guild_items WHERE guild = ?`),
    giPut: db.prepare(`INSERT INTO guild_items (guild, data, name, rarity, ilvl, slot, by_name, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    giGet: db.prepare(`SELECT * FROM guild_items WHERE id = ? AND guild = ?`),
    giDel: db.prepare(`DELETE FROM guild_items WHERE id = ? AND guild = ?`),
    giDelGuild: db.prepare(`DELETE FROM guild_items WHERE guild = ?`),
    glAdd: db.prepare(`INSERT INTO guild_log (guild, t, text) VALUES (?, ?, ?)`),
    glList: db.prepare(`SELECT t, text FROM guild_log WHERE guild = ? ORDER BY id DESC LIMIT ?`),
    glPrune: db.prepare(`DELETE FROM guild_log WHERE guild = ? AND id <= (SELECT id FROM guild_log WHERE guild = ? ORDER BY id DESC LIMIT 1 OFFSET 200)`),
    glDelGuild: db.prepare(`DELETE FROM guild_log WHERE guild = ?`),
    ginvPut: db.prepare(`INSERT INTO guild_invites (pid, guild, by, t) VALUES (?, ?, ?, ?) ON CONFLICT(pid, guild) DO UPDATE SET by = excluded.by, t = excluded.t`),
    ginvMine: db.prepare(`SELECT i.guild, i.by, i.t, g.name, g.color, g.lv, (SELECT COUNT(*) FROM guild_members m WHERE m.guild = g.id) AS n FROM guild_invites i JOIN guilds g ON g.id = i.guild WHERE i.pid = ? ORDER BY i.t DESC LIMIT 20`),
    ginvGet: db.prepare(`SELECT * FROM guild_invites WHERE pid = ? AND guild = ?`),
    ginvDel: db.prepare(`DELETE FROM guild_invites WHERE pid = ? AND guild = ?`),
    ginvDelPid: db.prepare(`DELETE FROM guild_invites WHERE pid = ?`),
    ginvDelGuild: db.prepare(`DELETE FROM guild_invites WHERE guild = ?`),
    ginvPurge: db.prepare(`DELETE FROM guild_invites WHERE t < ?`),
    gJoin: db.prepare(`INSERT INTO guild_members (pid, guild, role, joined, rank, contrib) VALUES (?, ?, ?, ?, '', 0)`),
    gLeave: db.prepare(`DELETE FROM guild_members WHERE pid = ?`),
    gRole: db.prepare(`UPDATE guild_members SET role = ? WHERE pid = ?`),
    gDelMembers: db.prepare(`DELETE FROM guild_members WHERE guild = ?`),
    gAppPut: db.prepare(`INSERT INTO guild_apps (pid, guild, t, msg) VALUES (?, ?, ?, ?) ON CONFLICT(pid, guild) DO UPDATE SET t = excluded.t, msg = excluded.msg`),
    gAppDel: db.prepare(`DELETE FROM guild_apps WHERE pid = ? AND guild = ?`),
    gAppDelAll: db.prepare(`DELETE FROM guild_apps WHERE pid = ?`),
    gAppDelGuild: db.prepare(`DELETE FROM guild_apps WHERE guild = ?`),
    gApps: db.prepare(`SELECT a.pid AS id, a.t, a.msg, p.name, p.house, p.grade, p.lvl, p.avatar_v FROM guild_apps a JOIN players p ON p.id = a.pid WHERE a.guild = ? ORDER BY a.t LIMIT 100`),
    gMyApps: db.prepare(`SELECT guild FROM guild_apps WHERE pid = ?`),
    // 우편: 받는 사람에게 보이는 것 = 나에게 온 것 + 모두에게 (가입 전에 보낸 것은 newcomers일 때만), 기한 안
    mailFor: db.prepare(`SELECT m.*, IFNULL(s.read, 0) AS rd, IFNULL(s.claimed, 0) AS cl FROM mail m LEFT JOIN mail_state s ON s.mail = m.id AND s.pid = ?
      WHERE (m.target = ? OR (m.target = '*' AND (m.newcomers = 1 OR m.created_g >= ?))) AND m.deleted = 0 AND m.expires > ? ORDER BY m.id DESC LIMIT 100`),
    mailNew: db.prepare(`SELECT COUNT(*) AS n, IFNULL(MAX(m.id), 0) AS top FROM mail m LEFT JOIN mail_state s ON s.mail = m.id AND s.pid = ?
      WHERE (m.target = ? OR (m.target = '*' AND (m.newcomers = 1 OR m.created_g >= ?))) AND m.deleted = 0 AND m.expires > ? AND IFNULL(s.read, 0) = 0`),
    mailGet: db.prepare(`SELECT * FROM mail WHERE id = ?`),
    mailInsert: db.prepare(`INSERT INTO mail (target, sender, title, body, rewards, created, created_g, expires, newcomers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    mailRead: db.prepare(`INSERT INTO mail_state (mail, pid, read) VALUES (?, ?, 1) ON CONFLICT(mail, pid) DO UPDATE SET read = 1`),
    mailClaim: db.prepare(`INSERT INTO mail_state (mail, pid, read, claimed) VALUES (?, ?, 1, 1) ON CONFLICT(mail, pid) DO UPDATE SET read = 1, claimed = 1 WHERE claimed = 0`),
    mailAdminList: db.prepare(`SELECT m.*, (SELECT COUNT(*) FROM mail_state s WHERE s.mail = m.id AND s.claimed = 1) AS claims FROM mail m WHERE m.target = '*' OR m.sender = '운영진' ORDER BY m.id DESC LIMIT 100`),
    mailDelete: db.prepare(`UPDATE mail SET deleted = 1 WHERE id = ?`),
    mailPurge: db.prepare(`DELETE FROM mail WHERE expires < ?`),
    mailStatePurge: db.prepare(`DELETE FROM mail_state WHERE mail NOT IN (SELECT id FROM mail)`),
    aucByVisit: db.prepare(`SELECT * FROM auction WHERE visit = ? ORDER BY id`),
    aucGet: db.prepare(`SELECT * FROM auction WHERE id = ?`),
    aucInsert: db.prepare(`INSERT INTO auction (visit, item, name, rarity, ilvl, slot, ends, min, npc_cap) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    aucBid: db.prepare(`UPDATE auction SET price = ?, bidder = ?, bidder_name = ?, bids = bids + 1, ends = ? WHERE id = ? AND price = ? AND done = 0`),
    aucOpenEnded: db.prepare(`SELECT * FROM auction WHERE done = 0 AND ends <= ?`),
    aucOpen: db.prepare(`SELECT * FROM auction WHERE done = 0`),
    aucDone: db.prepare(`UPDATE auction SET done = 1 WHERE id = ? AND done = 0`),
    aucRecent: db.prepare(`SELECT * FROM auction WHERE done = 1 AND bidder != '' AND bidder NOT LIKE 'npc:%' ORDER BY id DESC LIMIT 6`),
    aucPurge: db.prepare(`DELETE FROM auction WHERE done = 1 AND ends < ?`),
    towerGet: db.prepare(`SELECT * FROM tower WHERE party = ?`),
    towerPut: db.prepare(`INSERT INTO tower (party, week, floor, log) VALUES (?, ?, ?, ?) ON CONFLICT(party) DO UPDATE SET week = excluded.week, floor = excluded.floor, log = excluded.log`),
    towerDel: db.prepare(`DELETE FROM tower WHERE party = ?`),
    bdAll: db.prepare(`SELECT * FROM board_posts WHERE deleted = 0 ORDER BY id DESC LIMIT 5000`),
    bdInsert: db.prepare(`INSERT INTO board_posts (pid, tag, priv, title, body, created, updated, last) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    bdEdit: db.prepare(`UPDATE board_posts SET tag = ?, priv = ?, title = ?, body = ?, updated = ? WHERE id = ?`),
    bdDel: db.prepare(`UPDATE board_posts SET deleted = 1 WHERE id = ?`),
    bdCount: db.prepare(`UPDATE board_posts SET ncom = ?, last = ? WHERE id = ?`),
    noteInsert: db.prepare(`INSERT INTO notes (pid, t, kind, text, link) VALUES (?, ?, ?, ?, ?)`),
    notesFor: db.prepare(`SELECT * FROM notes WHERE pid = ? ORDER BY id DESC LIMIT 100`),
    noteUnread: db.prepare(`SELECT COUNT(*) AS n FROM notes WHERE pid = ? AND read = 0`),
    noteReadAll: db.prepare(`UPDATE notes SET read = 1 WHERE pid = ? AND read = 0`),
    notePrune: db.prepare(`DELETE FROM notes WHERE t < ?`),
    noteDelBy: db.prepare(`DELETE FROM notes WHERE pid = ?`),
    bdComs: db.prepare(`SELECT * FROM board_comments WHERE post = ? AND deleted = 0 ORDER BY id ASC LIMIT 300`),
    bdComGet: db.prepare(`SELECT * FROM board_comments WHERE id = ?`),
    bdComInsert: db.prepare(`INSERT INTO board_comments (post, pid, op, body, created, parent) VALUES (?, ?, ?, ?, ?, ?)`),
    bdComDel: db.prepare(`UPDATE board_comments SET deleted = 1 WHERE id = ?`),
    bdTodayBy: db.prepare(`SELECT COUNT(*) AS n FROM board_posts WHERE pid = ? AND created > ?`),
    getKV: db.prepare(`SELECT v FROM kv WHERE k = ?`),
    setKV: db.prepare(`INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`)
  };
  return {
    db, q,
    kvGet(k, d) { const r = q.getKV.get(k); return r ? JSON.parse(r.v) : d; },
    kvSet(k, v) { q.setKV.run(k, JSON.stringify(v)); },
    tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    backup(file) { db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); },
    close() { db.close(); }
  };
}
module.exports = { open };
