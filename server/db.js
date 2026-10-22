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
      memo TEXT NOT NULL DEFAULT '',   -- pid만 보는 개인 메모 (암호화)
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
    CREATE INDEX IF NOT EXISTS market_buyer ON market(buyer, status);
    CREATE INDEX IF NOT EXISTS market_sold ON market(status, done_at);
    CREATE INDEX IF NOT EXISTS market_exp ON market(status, expires);
  `);
  // 이전 버전 DB에 새 열 추가
  { const bc = db.prepare(`PRAGMA table_info(board_comments)`).all().map((c) => c.name); if (bc.length && bc.indexOf('parent') < 0) db.exec(`ALTER TABLE board_comments ADD COLUMN parent INTEGER NOT NULL DEFAULT 0`); if (bc.length && bc.indexOf('edited') < 0) db.exec(`ALTER TABLE board_comments ADD COLUMN edited INTEGER NOT NULL DEFAULT 0`); }
  { const ms = db.prepare(`PRAGMA table_info(mail_state)`).all().map((c) => c.name); if (ms.length && ms.indexOf('gone') < 0) db.exec(`ALTER TABLE mail_state ADD COLUMN gone INTEGER NOT NULL DEFAULT 0`); }   // 학생이 지운 우편 (읽은 우편 삭제)
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
  { const fc = db.prepare(`PRAGMA table_info(friends)`).all().map((c) => c.name); if (fc.indexOf('memo') < 0) db.exec(`ALTER TABLE friends ADD COLUMN memo TEXT NOT NULL DEFAULT ''`); }   // 친구 개인 메모
  { const ac = db.prepare(`PRAGMA table_info(auction)`).all().map((c) => c.name); if (ac.length && ac.indexOf('tier') < 0) db.exec(`ALTER TABLE auction ADD COLUMN tier INTEGER NOT NULL DEFAULT 2`); if (ac.length && ac.indexOf('ext') < 0) db.exec(`ALTER TABLE auction ADD COLUMN ext INTEGER NOT NULL DEFAULT 0`); }   // 떠돌이 상인 구간 (0 신입생 · 1 중급 · 2 상급)
  { const ic = db.prepare(`PRAGMA table_info(invites)`).all().map((c) => c.name); if (ic.indexOf('op') < 0) db.exec(`ALTER TABLE invites ADD COLUMN op INTEGER NOT NULL DEFAULT 0`); }   // 운영자 초대코드
  if (cols.indexOf('login_key') < 0) db.exec(`ALTER TABLE players ADD COLUMN login_key TEXT NOT NULL DEFAULT ''`);
  if (cols.indexOf('login_enc') < 0) db.exec(`ALTER TABLE players ADD COLUMN login_enc TEXT NOT NULL DEFAULT ''`);   // 아이디 (암호화 · 운영실 확인용)
  if (cols.indexOf('pw_temp') < 0) db.exec(`ALTER TABLE players ADD COLUMN pw_temp INTEGER NOT NULL DEFAULT 0`);   // 운영실이 발급한 임시 비밀번호 (바꾸면 0)
  if (cols.indexOf('legacy') < 0) db.exec(`ALTER TABLE players ADD COLUMN legacy TEXT NOT NULL DEFAULT ''`);   // 시즌 초기화 때 남기는 기념 표시 (예: 'gen1' = 1기 학생, 쉼표로 여러 개)
  if (cols.indexOf('deleted') < 0) db.exec(`ALTER TABLE players ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`);   // 캐릭터 초기화로 남은 예전 캐릭터
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS players_login ON players(login_key) WHERE login_key <> ''`);
  const ccols = db.prepare(`PRAGMA table_info(chat)`).all().map((c) => c.name);
  if (ccols.indexOf('title') < 0) db.exec(`ALTER TABLE chat ADD COLUMN title TEXT NOT NULL DEFAULT ''`);
  if (ccols.indexOf('ink') < 0) db.exec(`ALTER TABLE chat ADD COLUMN ink TEXT NOT NULL DEFAULT ''`);   // 이름 잉크 (꾸미기)
  const pcols = db.prepare(`PRAGMA table_info(parties)`).all().map((c) => c.name);
  if (pcols.indexOf('npcs') < 0) db.exec(`ALTER TABLE parties ADD COLUMN npcs TEXT NOT NULL DEFAULT '[]'`);
  if (pcols.indexOf('allgo') < 0) db.exec(`ALTER TABLE parties ADD COLUMN allgo INTEGER NOT NULL DEFAULT 0`);   // 파티원도 원정에 파티를 데려갈 수 있음
  // 별의 탑 순위 대기 기록: 실전이 끝나는 시각(pt)이 지나야 정식 기록(floor · name · members · t)으로 옮긴다 (진행 중에 순위가 먼저 바뀌지 않게)
  const trcols = db.prepare(`PRAGMA table_info(tower_rank)`).all().map((c) => c.name);
  if (trcols.length && trcols.indexOf('pfloor') < 0) db.exec(`ALTER TABLE tower_rank ADD COLUMN pfloor INTEGER NOT NULL DEFAULT 0; ALTER TABLE tower_rank ADD COLUMN pt INTEGER NOT NULL DEFAULT 0; ALTER TABLE tower_rank ADD COLUMN pname TEXT NOT NULL DEFAULT ''; ALTER TABLE tower_rank ADD COLUMN pmembers TEXT NOT NULL DEFAULT '[]'`);
  const mcols = db.prepare(`PRAGMA table_info(market)`).all().map((c) => c.name);
  if (mcols.indexOf('seller_name') < 0) db.exec(`ALTER TABLE market ADD COLUMN seller_name TEXT NOT NULL DEFAULT ''`);
  // 학생 경매: 거래소 물건 중 auc = 1. price = 즉시 구매가, start_price = 시작가, bid = 현재 입찰가(입찰한 학생의 아르크는 맡겨 둔다), expires = 마감
  [['auc', 'INTEGER NOT NULL DEFAULT 0'], ['start_price', 'INTEGER NOT NULL DEFAULT 0'], ['bid', 'INTEGER NOT NULL DEFAULT 0'], ['bidder', "TEXT NOT NULL DEFAULT ''"], ['bidder_name', "TEXT NOT NULL DEFAULT ''"], ['bids', 'INTEGER NOT NULL DEFAULT 0']]
    .forEach((c) => { if (mcols.indexOf(c[0]) < 0) db.exec(`ALTER TABLE market ADD COLUMN ${c[0]} ${c[1]}`); });
  db.exec(`CREATE TABLE IF NOT EXISTS market_bids (mid INTEGER NOT NULL, pid TEXT NOT NULL, amount INTEGER NOT NULL, t INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS market_bids_pid ON market_bids(pid, mid);
    CREATE INDEX IF NOT EXISTS market_auc ON market(auc, status, expires);`);
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
      parent INTEGER NOT NULL DEFAULT 0,   -- 답글이면 원래 댓글 id
      edited INTEGER NOT NULL DEFAULT 0    -- 마지막으로 고친 때
    );
    CREATE INDEX IF NOT EXISTS board_com ON board_comments(post, id);
    CREATE TABLE IF NOT EXISTS board_mute (post INTEGER NOT NULL, pid TEXT NOT NULL, PRIMARY KEY (post, pid));   -- 이 글의 알림 받지 않기
  `);
  { const gc = db.prepare(`PRAGMA table_info(guilds)`).all().map((c) => c.name); if (gc.length && gc.indexOf('icon') < 0) db.exec(`ALTER TABLE guilds ADD COLUMN icon TEXT NOT NULL DEFAULT ''`); }   // 동아리 아이콘 (D.GUILD_ICONS id)
  { const bp = db.prepare(`PRAGMA table_info(board_posts)`).all().map((c) => c.name); if (bp.indexOf('st') < 0) db.exec(`ALTER TABLE board_posts ADD COLUMN st TEXT NOT NULL DEFAULT ''`); }   // 건의 처리 상태: '' · wip(적용 중) · done(해결 완료)
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
      created INTEGER NOT NULL,
      icon TEXT NOT NULL DEFAULT ''        -- 동아리 아이콘 (D.GUILD_ICONS id)
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
    CREATE TABLE IF NOT EXISTS guild_stock (   -- 동아리 창고 재료 · 물약 (종류마다 한 줄, 수량)
      guild TEXT NOT NULL,
      kind TEXT NOT NULL,             -- 'm' 재료 · 'p' 물약
      key TEXT NOT NULL,
      n INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild, kind, key)
    );
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
      gone INTEGER NOT NULL DEFAULT 0,
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
      done INTEGER NOT NULL DEFAULT 0,
      tier INTEGER NOT NULL DEFAULT 2,
      ext INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS auction_visit ON auction(visit);
    CREATE TABLE IF NOT EXISTS tower (
      party TEXT PRIMARY KEY,
      week INTEGER NOT NULL,
      floor INTEGER NOT NULL DEFAULT 0,
      log TEXT NOT NULL DEFAULT '[]'
    );
    -- 별의 탑 파티 순위: 주마다 파티의 가장 높은 실전 기록. 그때의 파티 이름 · 파티원을 남긴다 (파티가 이름을 바꾸거나 해산해도 그대로)
    CREATE TABLE IF NOT EXISTS tower_rank (
      week INTEGER NOT NULL,
      party TEXT NOT NULL,
      name TEXT NOT NULL,
      members TEXT NOT NULL DEFAULT '[]',
      floor INTEGER NOT NULL,
      t INTEGER NOT NULL,
      pfloor INTEGER NOT NULL DEFAULT 0,
      pt INTEGER NOT NULL DEFAULT 0,
      pname TEXT NOT NULL DEFAULT '',
      pmembers TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (week, party)
    );
    -- 성장 스냅샷: 하루(한국 날짜) 한 번, 학생마다 한 줄 (레벨 · 전투력 · 누적 통계). 성장곡선 분석용
    CREATE TABLE IF NOT EXISTS growth (
      day INTEGER NOT NULL,
      pid TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (day, pid)
    );
    -- 학생 계정 기록 (운영실 확인용): 가입 · 로그인 · 로그인 실패 · 접속(하루 한 번 · 접속지가 바뀔 때) · 비밀번호 · 이름 변경 · 우편 수령 · 운영 조치.
    -- ip는 IP 주소가 아니라 HMAC 값(같은 접속지인지만 비교할 수 있고 주소로 되돌릴 수 없다). dev는 기기 종류(모바일/PC · 브라우저). 180일 보관
    CREATE TABLE IF NOT EXISTS pevent (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      t INTEGER NOT NULL,
      pid TEXT NOT NULL,
      kind TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      dev TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS pevent_pid ON pevent(pid, id DESC);
    CREATE INDEX IF NOT EXISTS pevent_ip ON pevent(ip, t);
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
    growthPut: db.prepare(`INSERT OR REPLACE INTO growth (day, pid, data) VALUES (?, ?, ?)`),
    // day: 예전 기록은 YYYYMMDD(하루 한 번), 2026-10-21부터는 YYYYMMDDHH(한국 시각 0시 · 12시 구간마다 한 번). 비교할 때는 예전 것을 ×100 해서 맞춘다
    growthFrom: db.prepare(`SELECT day, pid, data FROM growth WHERE (CASE WHEN day < 1000000000 THEN day * 100 ELSE day END) >= ? ORDER BY (CASE WHEN day < 1000000000 THEN day * 100 ELSE day END), pid`),
    growthDays: db.prepare(`SELECT (CASE WHEN day < 1000000000 THEN day * 100 ELSE day END) AS day, COUNT(*) AS n FROM growth GROUP BY 1 ORDER BY 1 DESC LIMIT 800`),
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
    // 학과의 탑 순위: 저장된 학생 상태(JSON)의 st.twK / st.twM
    topCt: db.prepare(`SELECT id, name, house, grade, CAST(json_extract(state, ?) AS INTEGER) AS f FROM players WHERE banned = 0 AND CAST(json_extract(state, ?) AS INTEGER) > 0 ORDER BY f DESC, power DESC LIMIT ?`),
    topStage: db.prepare(`SELECT id, name, house, power, lvl, grade, max_stage FROM players WHERE banned = 0 ORDER BY max_stage DESC, power DESC LIMIT ?`),
    // 별의 탑 파티 순위 (높은 층, 같으면 먼저 오른 파티)
    // 실전 기록은 대기(pfloor · pt = 끝나는 시각)로 넣고, twRankSettle이 끝난 것만 정식 기록으로 옮긴다 (처음 오른 파티는 floor 0인 줄로 시작)
    twRankPend: db.prepare(`INSERT INTO tower_rank (week, party, name, members, floor, t, pfloor, pt, pname, pmembers) VALUES (?, ?, '', '[]', 0, 0, ?, ?, ?, ?) ON CONFLICT(week, party) DO UPDATE SET pfloor = excluded.pfloor, pt = excluded.pt, pname = excluded.pname, pmembers = excluded.pmembers WHERE excluded.pfloor > MAX(tower_rank.floor, tower_rank.pfloor)`),
    twRankSettle: db.prepare(`UPDATE tower_rank SET floor = CASE WHEN pfloor > floor THEN pfloor ELSE floor END, name = CASE WHEN pfloor > floor THEN pname ELSE name END, members = CASE WHEN pfloor > floor THEN pmembers ELSE members END, t = CASE WHEN pfloor > floor THEN pt ELSE t END, pfloor = 0, pt = 0 WHERE pt > 0 AND pt <= ?`),
    twRankTop: db.prepare(`SELECT party, name, members, floor, t FROM tower_rank WHERE week = ? AND floor > 0 ORDER BY floor DESC, t ASC LIMIT ?`),
    twRankGet: db.prepare(`SELECT floor, t FROM tower_rank WHERE week = ? AND party = ? AND floor > 0`),
    twRankOf: db.prepare(`SELECT COUNT(*) + 1 AS r FROM tower_rank WHERE week = ? AND (floor > ? OR (floor = ? AND t < ?))`),
    rankPower: db.prepare(`SELECT COUNT(*) + 1 AS r FROM players WHERE banned = 0 AND power > ?`),
    topLvl: db.prepare(`SELECT id, name, house, power, lvl, grade, max_stage FROM players WHERE banned = 0 ORDER BY lvl DESC, max_stage DESC, power DESC LIMIT ?`),
    rankLvl: db.prepare(`SELECT COUNT(*) + 1 AS r FROM players WHERE banned = 0 AND (lvl > ? OR (lvl = ? AND (max_stage > ? OR (max_stage = ? AND power > ?))))`),
    rankStage: db.prepare(`SELECT COUNT(*) + 1 AS r FROM players WHERE banned = 0 AND (max_stage > ? OR (max_stage = ? AND power > ?))`),
    rankDmg: db.prepare(`SELECT COUNT(*) + 1 AS r FROM weekly w JOIN players p ON p.id = w.pid WHERE w.week = ? AND w.dmg > ? AND p.banned = 0`),
    rankCt: db.prepare(`SELECT COUNT(*) + 1 AS r FROM players WHERE banned = 0 AND CAST(json_extract(state, ?) AS INTEGER) > ?`),
    insertSession: db.prepare(`INSERT INTO sessions (token, pid, created, expires) VALUES (?, ?, ?, ?)`),
    getSession: db.prepare(`SELECT pid, expires FROM sessions WHERE token = ?`),
    touchSession: db.prepare(`UPDATE sessions SET expires = ? WHERE token = ?`),
    delSession: db.prepare(`DELETE FROM sessions WHERE token = ?`),
    delSessionsFor: db.prepare(`DELETE FROM sessions WHERE pid = ?`),
    purgeSessions: db.prepare(`DELETE FROM sessions WHERE expires < ?`),
    upsertWeekly: db.prepare(`INSERT INTO weekly (week, pid, house, cup, dmg, att) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(week, pid) DO UPDATE SET house = excluded.house, cup = excluded.cup, dmg = excluded.dmg, att = excluded.att`),
    houseCup: db.prepare(`SELECT COALESCE(SUM(cup), 0) AS s, COUNT(*) AS n FROM (SELECT cup FROM weekly WHERE week = ? AND house = ? AND cup > 0 ORDER BY cup DESC LIMIT ?)`),
    houseCount: db.prepare(`SELECT house, COUNT(*) AS n FROM players WHERE banned = 0 AND guest = 0 GROUP BY house`),
    houseTop: db.prepare(`SELECT w.pid, w.cup FROM weekly w JOIN players p ON p.id = w.pid WHERE w.week = ? AND w.house = ? AND p.banned = 0 ORDER BY w.cup DESC LIMIT 1`),
    houseCups: db.prepare(`SELECT cup FROM weekly WHERE week = ? AND house = ? AND cup > 0`),
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
    playerMeta: db.prepare(`SELECT id, name, guest, muted_until, banned, invite, role, created FROM players WHERE id = ?`),
    admins: db.prepare(`SELECT id, role FROM players WHERE role IN ('admin', 'chief')`),   // admin 학생회 · chief 학생회장
    setRole: db.prepare(`UPDATE players SET role = ? WHERE id = ?`),
    oplogAdd: db.prepare(`INSERT INTO oplog (t, actor, name, action, detail) VALUES (?, ?, ?, ?, ?)`),
    oplogList: db.prepare(`SELECT * FROM oplog ORDER BY id DESC LIMIT ?`),
    peAdd: db.prepare(`INSERT INTO pevent (t, pid, kind, detail, ip, dev) VALUES (?, ?, ?, ?, ?, ?)`),
    peList: db.prepare(`SELECT t, kind, detail, ip, dev FROM pevent WHERE pid = ? ORDER BY id DESC LIMIT ?`),
    peCount: db.prepare(`SELECT kind, COUNT(*) AS n, MAX(t) AS last FROM pevent WHERE pid = ? GROUP BY kind`),
    peSameIp: db.prepare(`SELECT e.pid, p.name, p.banned, p.deleted, COUNT(DISTINCT e.ip) AS ips, MAX(e.t) AS last FROM pevent e JOIN players p ON p.id = e.pid WHERE e.ip != '' AND e.t >= ? AND e.pid != ? AND e.ip IN (SELECT DISTINCT ip FROM pevent WHERE pid = ? AND ip != '' AND t >= ?) GROUP BY e.pid ORDER BY ips DESC, last DESC LIMIT 30`),
    peMove: db.prepare(`UPDATE pevent SET pid = ? WHERE pid = ?`),
    pePrune: db.prepare(`DELETE FROM pevent WHERE t < ?`),
    upgradeGuest: db.prepare(`UPDATE players SET name = ?, name_key = ?, pass = ?, guest = 0, invite = ? WHERE id = ? AND guest = 1`),
    renamePlayer: db.prepare(`UPDATE players SET name = ?, name_key = ? WHERE id = ?`),
    setMute: db.prepare(`UPDATE players SET muted_until = ? WHERE id = ?`),
    getInvite: db.prepare(`SELECT code, max_uses, uses, expires, disabled, note, op FROM invites WHERE code = ?`),
    useInvite: db.prepare(`UPDATE invites SET uses = uses + 1 WHERE code = ? AND uses < max_uses AND disabled = 0`),
    insertInvite: db.prepare(`INSERT INTO invites (code, max_uses, uses, created, expires, note, op) VALUES (?, ?, 0, ?, ?, ?, ?)`),
    listInvites: db.prepare(`SELECT i.code, i.max_uses, i.uses, i.created, i.expires, i.note, i.disabled, i.op, (SELECT group_concat(name, ', ') FROM players p WHERE p.invite = i.code) AS used_by, (SELECT MIN(created) FROM players p WHERE p.invite = i.code) AS first_at, (SELECT MAX(created) FROM players p WHERE p.invite = i.code) AS last_at FROM invites i ORDER BY i.created DESC LIMIT ?`),
    disableInvite: db.prepare(`UPDATE invites SET disabled = ? WHERE code = ?`),
    insertChat: db.prepare(`INSERT INTO chat (ch, t, pid, name, house, grade, guest, kind, text, title, ink) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    recentChat: db.prepare(`SELECT id, ch, t, pid, name, house, grade, guest, kind, text, title, ink FROM chat WHERE ch = ? AND deleted = 0 ORDER BY id DESC LIMIT ?`),
    newerChat: db.prepare(`SELECT id, ch, t, pid, name, house, grade, guest, kind, text, title, ink FROM chat WHERE ch = ? AND deleted = 0 AND id > ? ORDER BY id ASC LIMIT ?`),
    olderChat: db.prepare(`SELECT id, ch, t, pid, name, house, grade, guest, kind, text, title, ink FROM chat WHERE ch = ? AND deleted = 0 AND id < ? ORDER BY id DESC LIMIT ?`),
    getChat: db.prepare(`SELECT id, ch, t, pid, name, house, grade, guest, kind, text, deleted FROM chat WHERE id = ?`),
    deleteChat: db.prepare(`UPDATE chat SET deleted = 1 WHERE id = ?`),
    pruneChat: db.prepare(`DELETE FROM chat WHERE ch = ? AND id < (SELECT COALESCE(MIN(id), 0) FROM (SELECT id FROM chat WHERE ch = ? ORDER BY id DESC LIMIT ?))`),
    insertReport: db.prepare(`INSERT INTO reports (t, msg_id, reporter, reason) VALUES (?, ?, ?, ?)`),
    listReports: db.prepare(`SELECT r.id, r.t, r.msg_id, r.reason, r.resolved, r.reporter AS reporter_id, p.name AS reporter, c.ch, c.name AS author, c.pid AS author_id, c.text, c.kind, c.deleted FROM reports r LEFT JOIN players p ON p.id = r.reporter LEFT JOIN chat c ON c.id = r.msg_id WHERE r.resolved = ? ORDER BY r.id DESC LIMIT ?`),
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
    friendMemo: db.prepare(`UPDATE friends SET memo = ? WHERE pid = ? AND fid = ?`),
    friendList: db.prepare(`SELECT f.fid AS id, f.state, f.t, f.memo, p.name, p.house, p.grade, p.lvl, p.last_seen, p.avatar_v, p.profile, p.title FROM friends f JOIN players p ON p.id = f.fid WHERE f.pid = ? AND p.banned = 0 ORDER BY p.last_seen DESC LIMIT 300`),
    friendIncoming: db.prepare(`SELECT f.pid AS id, f.t, p.name, p.house, p.grade, p.lvl, p.avatar_v FROM friends f JOIN players p ON p.id = f.pid WHERE f.fid = ? AND f.state = 'req' AND p.banned = 0 ORDER BY f.t DESC LIMIT 100`),
    friendIncomingCount: db.prepare(`SELECT COUNT(*) AS n FROM friends WHERE fid = ? AND state = 'req'`),
    // 파티
    partyGet: db.prepare(`SELECT id, name, leader, created, npcs, allgo FROM parties WHERE id = ?`),
    partySetAllgo: db.prepare(`UPDATE parties SET allgo = ? WHERE id = ?`),
    partyRename: db.prepare(`UPDATE parties SET name = ? WHERE id = ?`),
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
    mkSoldTok: db.prepare(`SELECT name, qty, price, done_at FROM market WHERE kind = 'tok' AND status = 'sold' AND data = ? AND done_at > ? ORDER BY done_at DESC LIMIT 50`),
    mkSoldPot: db.prepare(`SELECT name, qty, price, done_at FROM market WHERE kind = 'pot' AND status = 'sold' AND data = ? AND done_at > ? ORDER BY done_at DESC LIMIT 50`),
    mkTrades: db.prepare(`SELECT id, kind, name, slot, rarity, ilvl, qty, price, done_at FROM market WHERE status = 'sold' ORDER BY done_at DESC, id DESC LIMIT ?`),
    mkHistory: db.prepare(`SELECT id, kind, name, slot, data, rarity, ilvl, qty, price, done_at, seller, buyer, COALESCE((SELECT name FROM players WHERE id = market.seller), seller_name) AS seller_name FROM market WHERE status = 'sold' AND (seller = ? OR buyer = ?) AND done_at > ? ORDER BY done_at DESC, id DESC LIMIT 100`),
    mkSetStatus: db.prepare(`UPDATE market SET status = ?, buyer = ?, done_at = ? WHERE id = ? AND status = 'open'`),
    mkMine: db.prepare(`SELECT id, kind, data, name, slot, rarity, ilvl, qty, price, created, expires, status, done_at, auc, start_price, bid, bids, buyer FROM market WHERE seller = ? AND (status = 'open' OR done_at > ?) ORDER BY (status = 'open') DESC, id DESC LIMIT 60`),   // 판매 중인 물건은 판매 기록이 많아도 항상 들어가게 (예전에는 최근 40줄만이라 판매 중 개수가 덜 세졌다)
    mkMineOpen: db.prepare(`SELECT COUNT(*) AS n FROM market WHERE seller = ? AND status = 'open'`),
    mkExpired: db.prepare(`SELECT * FROM market WHERE status = 'open' AND expires < ? LIMIT 200`),
    mkPurge: db.prepare(`DELETE FROM market WHERE status != 'open' AND done_at < ?`),
    mkAucMineOpen: db.prepare(`SELECT COUNT(*) AS n FROM market WHERE seller = ? AND status = 'open' AND auc = 1`),
    mkAucBid: db.prepare(`UPDATE market SET bid = ?, bidder = ?, bidder_name = ?, bids = bids + 1, expires = ? WHERE id = ? AND status = 'open' AND auc = 1 AND bid = ? AND bidder = ?`),
    mkAucSold: db.prepare(`UPDATE market SET status = 'sold', buyer = ?, done_at = ?, price = ? WHERE id = ? AND status = 'open'`),
    mkAucEnded: db.prepare(`SELECT * FROM market WHERE status = 'open' AND auc = 1 AND expires <= ? LIMIT 200`),
    mkReprice: db.prepare(`UPDATE market SET price = ? WHERE id = ? AND seller = ? AND status = 'open' AND auc = 0`),
    mkAucInit: db.prepare(`UPDATE market SET auc = 1, start_price = ? WHERE id = ?`),
    mkBidLog: db.prepare(`INSERT INTO market_bids (mid, pid, amount, t) VALUES (?, ?, ?, ?)`),
    mkMyBids: db.prepare(`SELECT m.*, COALESCE(p.name, m.seller_name) AS seller_name FROM market m LEFT JOIN players p ON p.id = m.seller WHERE m.auc = 1 AND m.id IN (SELECT mid FROM market_bids WHERE pid = ?) AND m.status = 'open' ORDER BY m.expires ASC LIMIT 30`),   // 진행 중인 경매만 (즉시 구매 · 마감으로 끝난 경매는 「거래 내역」 · 알림으로)
    mkBidPurge: db.prepare(`DELETE FROM market_bids WHERE mid NOT IN (SELECT id FROM market)`),
    // 동아리
    gGet: db.prepare(`SELECT * FROM guilds WHERE id = ?`),
    gByKey: db.prepare(`SELECT id FROM guilds WHERE name_key = ?`),
    gInsert: db.prepare(`INSERT INTO guilds (id, name, name_key, intro, color, owner, mode, created, icon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    gUpdate: db.prepare(`UPDATE guilds SET intro = ?, notice = ?, color = ?, mode = ?, icon = ? WHERE id = ?`),
    gOwner: db.prepare(`UPDATE guilds SET owner = ? WHERE id = ?`),
    gDelete: db.prepare(`DELETE FROM guilds WHERE id = ?`),
    gList: db.prepare(`SELECT g.id, g.name, g.intro, g.color, g.icon, g.mode, g.created, g.lv, (SELECT COUNT(*) FROM guild_members m WHERE m.guild = g.id) AS n, p.name AS owner_name FROM guilds g LEFT JOIN players p ON p.id = g.owner ORDER BY n DESC, g.created ASC LIMIT 100`),
    gMembers: db.prepare(`SELECT m.pid AS id, m.role, m.rank, m.contrib, m.cday, m.dday, m.dpts, m.joined, p.name, p.house, p.grade, p.lvl, p.power, p.avatar_v, p.last_seen, p.title FROM guild_members m JOIN players p ON p.id = m.pid WHERE m.guild = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END, m.joined`),
    gRank: db.prepare(`SELECT g.id, g.name, g.intro, g.created, g.color, g.icon, g.mode, g.lv, g.xp, COUNT(m.pid) AS n, COALESCE(SUM(p.power), 0) AS pw, o.name AS owner_name FROM guilds g LEFT JOIN guild_members m ON m.guild = g.id LEFT JOIN players p ON p.id = m.pid LEFT JOIN players o ON o.id = g.owner GROUP BY g.id`),
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
    gsList: db.prepare(`SELECT kind, key, n FROM guild_stock WHERE guild = ? AND n > 0 ORDER BY kind, key`),
    gsCount: db.prepare(`SELECT COUNT(*) AS n FROM guild_stock WHERE guild = ? AND n > 0`),
    gsGet: db.prepare(`SELECT n FROM guild_stock WHERE guild = ? AND kind = ? AND key = ?`),
    gsAdd: db.prepare(`INSERT INTO guild_stock (guild, kind, key, n) VALUES (?, ?, ?, ?) ON CONFLICT(guild, kind, key) DO UPDATE SET n = n + excluded.n`),
    gsTake: db.prepare(`UPDATE guild_stock SET n = n - ? WHERE guild = ? AND kind = ? AND key = ? AND n >= ?`),
    gsClean: db.prepare(`DELETE FROM guild_stock WHERE guild = ? AND n <= 0`),
    gsDelGuild: db.prepare(`DELETE FROM guild_stock WHERE guild = ?`),
    glAdd: db.prepare(`INSERT INTO guild_log (guild, t, text) VALUES (?, ?, ?)`),
    glList: db.prepare(`SELECT t, text FROM guild_log WHERE guild = ? ORDER BY id DESC LIMIT ?`),
    glPrune: db.prepare(`DELETE FROM guild_log WHERE guild = ? AND id <= (SELECT id FROM guild_log WHERE guild = ? ORDER BY id DESC LIMIT 1 OFFSET 200)`),
    glDelGuild: db.prepare(`DELETE FROM guild_log WHERE guild = ?`),
    ginvPut: db.prepare(`INSERT INTO guild_invites (pid, guild, by, t) VALUES (?, ?, ?, ?) ON CONFLICT(pid, guild) DO UPDATE SET by = excluded.by, t = excluded.t`),
    ginvMine: db.prepare(`SELECT i.guild, i.by, i.t, g.name, g.color, g.icon, g.lv, (SELECT COUNT(*) FROM guild_members m WHERE m.guild = g.id) AS n FROM guild_invites i JOIN guilds g ON g.id = i.guild WHERE i.pid = ? ORDER BY i.t DESC LIMIT 20`),
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
      WHERE (m.target = ? OR (m.target = '*' AND (m.newcomers = 1 OR m.created_g >= ?))) AND m.deleted = 0 AND m.expires > ? AND IFNULL(s.gone, 0) = 0 ORDER BY m.id DESC LIMIT 100`),
    mailNew: db.prepare(`SELECT COUNT(*) AS n, IFNULL(MAX(m.id), 0) AS top FROM mail m LEFT JOIN mail_state s ON s.mail = m.id AND s.pid = ?
      WHERE (m.target = ? OR (m.target = '*' AND (m.newcomers = 1 OR m.created_g >= ?))) AND m.deleted = 0 AND m.expires > ? AND IFNULL(s.read, 0) = 0 AND IFNULL(s.gone, 0) = 0`),
    mailGet: db.prepare(`SELECT * FROM mail WHERE id = ?`),
    mailInsert: db.prepare(`INSERT INTO mail (target, sender, title, body, rewards, created, created_g, expires, newcomers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    mailRead: db.prepare(`INSERT INTO mail_state (mail, pid, read) VALUES (?, ?, 1) ON CONFLICT(mail, pid) DO UPDATE SET read = 1`),
    mailClaim: db.prepare(`INSERT INTO mail_state (mail, pid, read, claimed) VALUES (?, ?, 1, 1) ON CONFLICT(mail, pid) DO UPDATE SET read = 1, claimed = 1 WHERE claimed = 0`),
    mailAdminList: db.prepare(`SELECT m.*, (SELECT COUNT(*) FROM mail_state s WHERE s.mail = m.id AND s.claimed = 1) AS claims FROM mail m WHERE m.target = '*' OR m.sender = '운영진' ORDER BY m.id DESC LIMIT 100`),
    mailGone: db.prepare(`INSERT INTO mail_state (mail, pid, read, gone) VALUES (?, ?, 1, 1) ON CONFLICT(mail, pid) DO UPDATE SET read = 1, gone = 1`),
    mailDelete: db.prepare(`UPDATE mail SET deleted = 1 WHERE id = ?`),
    mailPurge: db.prepare(`DELETE FROM mail WHERE expires < ?`),
    mailStatePurge: db.prepare(`DELETE FROM mail_state WHERE mail NOT IN (SELECT id FROM mail)`),
    aucByVisit: db.prepare(`SELECT * FROM auction WHERE visit = ? ORDER BY id`),
    aucGet: db.prepare(`SELECT * FROM auction WHERE id = ?`),
    aucInsert: db.prepare(`INSERT INTO auction (visit, item, name, rarity, ilvl, slot, ends, min, npc_cap, tier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    aucBid: db.prepare(`UPDATE auction SET price = ?, bidder = ?, bidder_name = ?, bids = bids + 1, ext = CASE WHEN ? > ends THEN 1 ELSE ext END, ends = ? WHERE id = ? AND price = ? AND done = 0`),   // ext: 막판 입찰로 마감이 늘어난 적이 있음
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
    bdStatus: db.prepare(`UPDATE board_posts SET st = ? WHERE id = ?`),
    noteInsert: db.prepare(`INSERT INTO notes (pid, t, kind, text, link) VALUES (?, ?, ?, ?, ?)`),
    notesFor: db.prepare(`SELECT * FROM notes WHERE pid = ? ORDER BY id DESC LIMIT 100`),
    noteUnread: db.prepare(`SELECT COUNT(*) AS n FROM notes WHERE pid = ? AND read = 0`),
    noteReadAll: db.prepare(`UPDATE notes SET read = 1 WHERE pid = ? AND read = 0`),
    notePrune: db.prepare(`DELETE FROM notes WHERE t < ?`),
    noteDelBy: db.prepare(`DELETE FROM notes WHERE pid = ?`),
    bdMuteAll: db.prepare(`SELECT post, pid FROM board_mute`),
    bdMuteOn: db.prepare(`INSERT OR IGNORE INTO board_mute (post, pid) VALUES (?, ?)`),
    bdMuteOff: db.prepare(`DELETE FROM board_mute WHERE post = ? AND pid = ?`),
    bdComs: db.prepare(`SELECT * FROM board_comments WHERE post = ? AND deleted = 0 ORDER BY id ASC LIMIT 300`),
    bdComGet: db.prepare(`SELECT * FROM board_comments WHERE id = ?`),
    bdComPids: db.prepare(`SELECT DISTINCT post, pid FROM board_comments WHERE deleted = 0`),
    bdComMineN: db.prepare(`SELECT COUNT(*) AS n FROM board_comments WHERE post = ? AND pid = ? AND deleted = 0`),
    bdComLast: db.prepare(`SELECT * FROM (SELECT * FROM board_comments WHERE post = ? AND deleted = 0 ORDER BY id DESC LIMIT ?) ORDER BY id ASC`),
    bdComInsert: db.prepare(`INSERT INTO board_comments (post, pid, op, body, created, parent) VALUES (?, ?, ?, ?, ?, ?)`),
    bdComEdit: db.prepare(`UPDATE board_comments SET body = ?, edited = ? WHERE id = ?`),
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
