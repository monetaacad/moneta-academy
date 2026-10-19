/* 아르카눔 아카데미 — 서버형 규칙 엔진 (서버·클라이언트 공용)
   모든 시간은 초 단위 유닉스 시각. 상태 P는 JSON으로 직렬화 가능해야 한다.
   서버가 권위를 가진다: 클라이언트는 같은 코드로 미리보기만 계산한다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.Rules = factory(root.DATA);
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';
  var R = {};
  R.VERSION = 3;
  var CUR = R.CUR = D.CUR;

  /* ───────── 조정 상수 (밸런스는 여기서) ───────── */
  var K = R.K = {
    // 수업
    LEC_XP: 4.85,          // 시간당 과목 경험치 (기본)
    SUBJ_A: 10, SUBJ_G: 1.18,
    LEC_KNOW: 30,          // 시간당 지식 (기본, 과목 레벨당 +LEC_KNOW_LV)
    LEC_KNOW_LV: 6,
    // 마나
    MANA_BASE: 0.5,        // 초당
    MANA_CAP_H: 12,
    // 원정
    SPAWN: 3.0,            // 처치 사이 이동 시간(초)
    KILL_PACK: 100,        // 처치 1회 = 몬스터 무리 하나 (처치 수는 1/100, 처치 1회 보상 · 드롭률은 100배 → 총 보상은 그대로)
    EXP_RATE: 1,           // 원정 보상 배율
    KILL_GOLD: 0.6, G_GOLD: 1.11,
    EXP_GOLD: 0.7, DISP_GOLD: 0.3, SPIRIT_GOLD: 0.5,   // 원정 처치 · 사역마 파견 · 정령의 아르크 배율 (아르크는 적게 벌리게)
    FALL_KEEP: 0.8,        // 원정 중 쓰러지면 그때까지 모은 것의 80%
    KILL_XP: 0.12, G_XP: 1.128,
    MAT_RATE: 4, STONE_RATE: 0.6, ITEM_RATE: 1.2,   // 처치 1회당 (KILL_PACK 반영)
    // 몬스터
    MON_HP: 15, G_HP: 1.24, MON_ATK: 2.4, G_ATK: 1.155,
    BOSS_HP: 7, BOSS_ATK: 1.6, BOSS_TIME: 30,
    // 레벨
    XP_A: 30, XP_G: 1.13, XP_L: 20,
    // 기타
    CANCEL_KEEP: 0.5,
    BAG_BASE: 40,
    EXAM_CD: 3600, BOSS_CD: 600, DUEL_CD: 1800, DUEL_LOSE_CD: 3600,
    WB_TICKET_REGEN: 28800, WB_TICKET_MAX: 3, WB_BUY_MAX: 2,
    SPIRIT_EVERY: 2400, SPIRIT_JAR: 4,   // 정령은 40분마다 병에 한 마리, 최대 4마리
    EGG_TIME: 21600,
    TZ: 9 * 3600
  };

  /* ───────── 색인 ───────── */
  function idx(arr) { var o = {}; arr.forEach(function (x) { o[x.id] = x; }); return o; }
  var SUBJ = R.SUBJ = idx(D.SUBJECTS), SPELL = R.SPELL = idx(D.SPELLS), RES = R.RES = idx(D.RESEARCH);
  var POT = R.POT = idx(D.POTIONS), FAM = R.FAM = idx(D.FAMILIARS), HOUSE = R.HOUSE = idx(D.HOUSES);
  R.D = D;
  var SLOT = R.SLOT = idx(D.SLOTS), AFF = R.AFF = idx(D.AFFIXES), SHOP = R.SHOP_IDX = idx(D.SHOP);
  var DUR = {}; D.DURATIONS.forEach(function (d) { DUR[d.k] = d; }); R.DUR = DUR;
  var DDUR = {}; D.DISPATCH_DUR.forEach(function (d) { DDUR[d.k] = d; }); R.DDUR = DDUR;
  var STATS = R.STATS = ['int', 'wil', 'agi', 'vit', 'luk'];
  var BOSS_IDS = {}; D.ZONES.forEach(function (z) { BOSS_IDS[z.boss.id] = 1; });

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  R.clamp = clamp;
  function err(msg) { var e = new Error(msg); e.game = true; throw e; }

  /* ───────── 난수 (상태에 저장되는 시드) ───────── */
  function rnd(P) {
    var s = P.rng | 0 || 2463534242;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    P.rng = s | 0;
    return ((s >>> 0) % 1000000) / 1000000;
  }
  function ri(P, a, b) { return a + Math.floor(rnd(P) * (b - a + 1)); }
  function pick(P, arr) { return arr[Math.floor(rnd(P) * arr.length)]; }
  R.rnd = rnd;

  /* ───────── 달력 (KST) ───────── */
  R.dayKST = function (t) { return Math.floor((t + K.TZ) / 86400); };
  R.weekId = function (t) { return Math.floor((t + K.TZ + 3 * 86400) / 604800); };
  R.weekStart = function (w) { return w * 604800 - K.TZ - 3 * 86400; };
  R.weekday = function (t) { return (R.dayKST(t) + 4) % 7; }; // 0=일 6=토
  R.isWeekend = function (t) { var w = R.weekday(t); return w === 0 || w === 6; };
  R.nextMidnight = function (t) { return (R.dayKST(t) + 1) * 86400 - K.TZ; };
  R.calendar = function (W, t) {
    var dn = Math.max(0, R.dayKST(t) - R.dayKST(W.epoch));
    var mo = Math.floor(dn / 28) % 8;
    var secOfDay = (t + K.TZ) % 86400;
    return { day: dn, year: D.WORLD.baseYear + Math.floor(dn / 224), mi: mo, month: D.WORLD.calendarMonths[mo], d: dn % 28 + 1,
      period: clamp(Math.floor((secOfDay - 9 * 3600) / 3600) + 1, 0, 9), weekend: R.isWeekend(t), bonus: D.MONTH_BONUS[mo] };
  };
  function weekendFrac(t0, t1) {
    if (t1 <= t0) return R.isWeekend(t0) ? 1 : 0;
    var tot = 0, t = t0;
    while (t < t1) { var e = Math.min(t1, R.nextMidnight(t)); if (R.isWeekend(t)) tot += e - t; t = e; }
    return tot / (t1 - t0);
  }

  /* ───────── 하늘 이벤트 (모두에게 같은 시각에) ─────────
     하루 세 번, 한국 시간 낮·오후·밤 중 한 때에 하늘에 무언가가 나타난다. 날짜로 정해지므로 서버와 데모가 같은 하늘을 본다.
     그동안 맡긴 작업에는 겹친 시간만큼 효과가 들어가고, 「올려다보기」를 누르면 작은 선물. */
  R.SKY = [
    { id: 'meteor', name: '유성 소나기', min: 40, eff: { dropPct: 0.2, goldPct: 0.1 }, text: '전리품 확률 +20%, ' + CUR + ' +10%' },
    { id: 'aurora', name: '별샘 오로라', min: 60, eff: { manaPct: 0.3, knowPct: 0.1 }, text: '마나 재생 +30%, 지식 +10%' },
    { id: 'comet', name: '꼬리별', min: 45, eff: { xpPct: 0.15, lectureSpd: 0.05 }, text: '경험치 +15%, 수업 속도 +5%' },
    { id: 'whale', name: '구름 위의 별고래', min: 30, eff: { goldPct: 0.15 }, text: CUR + ' +15%, 올려다보면 조금 더 큰 선물' }
  ];
  function hash32(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); return (n ^ (n >>> 15)) >>> 0; }
  R.hash32 = hash32;
  var skyCache = {};
  R.skyDay = function (d) {
    if (skyCache[d]) return skyCache[d];
    var base = d * 86400 - K.TZ, kinds = R.SKY.slice(), out = [], wins = [[10, 13], [15, 18], [20, 23]];
    for (var i = 0; i < 3; i++) {
      var h = hash32(d * 7919 + i * 104729), k = kinds.splice(h % kinds.length, 1)[0], w = wins[i];
      var start = base + (w[0] + (h >>> 8) % (w[1] - w[0])) * 3600 + ((h >>> 16) % 4) * 15 * 60;
      out.push({ key: d * 10 + i, id: k.id, name: k.name, eff: k.eff, text: k.text, start: start, end: start + k.min * 60 });
    }
    var keys = Object.keys(skyCache); if (keys.length > 8) delete skyCache[keys[0]];
    return (skyCache[d] = out);
  };
  R.skyToday = function (t) { return R.skyDay(R.dayKST(t)); };
  R.skyAt = function (t) { var a = R.skyToday(t); for (var i = 0; i < a.length; i++) if (t >= a[i].start && t < a[i].end) return a[i]; return null; };
  R.skyNext = function (t) { for (var d = R.dayKST(t); d < R.dayKST(t) + 2; d++) { var a = R.skyDay(d); for (var i = 0; i < a.length; i++) if (a[i].start > t) return a[i]; } return null; };
  R.skyOverlap = function (t0, t1) {
    var out = [], span = t1 - t0; if (!(span >= 0)) return out;
    for (var d = R.dayKST(t0); d <= R.dayKST(t1) && d <= R.dayKST(t0) + 3; d++) R.skyDay(d).forEach(function (ev) {
      var f = span <= 0 ? (t0 >= ev.start && t0 < ev.end ? 1 : 0) : Math.max(0, Math.min(ev.end, t1) - Math.max(ev.start, t0)) / span; if (f > 0) out.push({ ev: ev, f: f });
    });
    return out;
  };

  /* ───────── 별샘 의식 (서버 전체가 함께 채우는 하루 목표) ───────── */
  R.RITUAL_BUFF = { name: '별샘의 축복', eff: { xpPct: 0.15, knowPct: 0.15, goldPct: 0.1 }, dur: 4 * 3600, color: '#9fd8ff', text: '4시간 동안 경험치·지식 +15%, ' + CUR + ' +10%' };
  R.ritualGoal = function (active) { return Math.max(5, Math.ceil((active || 0) * 0.35)); };
  R.ritualCost = function (P, W, now) { return Math.floor(calc(P, W, now).mana * 1800); };   // 마나 30분 분
  R.ritualBless = function (P, start) { P.buffs.ritual = { name: R.RITUAL_BUFF.name, eff: R.RITUAL_BUFF.eff, start: start, end: start + R.RITUAL_BUFF.dur, color: R.RITUAL_BUFF.color }; };

  /* ───────── 떠돌이 상인 (하루 두 번, 한국 시간 12시·20시부터 2시간 경매) ───────── */
  R.AUCTION_HOURS = [12, 20]; R.AUCTION_LEN = 7200; R.AUCTION_SNIPE = 120;
  R.auctionVisit = function (t) {
    var d = R.dayKST(t), out = null;
    for (var dd = d; dd <= d + 1 && !out; dd++) R.AUCTION_HOURS.forEach(function (h, i) { var s = dd * 86400 - K.TZ + h * 3600; if (!out && s + R.AUCTION_LEN > t) out = { id: dd * 2 + i, start: s, end: s + R.AUCTION_LEN, active: t >= s }; });
    return out;
  };
  R.auctionStep = function (price, min) { return price ? Math.ceil(price * 1.05) : min; };

  /* ───────── 새 학생 ───────── */
  // 불러올 때 예전 저장본 정리: 없어진 쪽지시험 값 지우기, 새로 생긴 성적 통계 채우기
  R.ECON_C_AT = 1792359000;   // 2026-10-19 06:30 KST: 이보다 먼저 입학한 학생에게 경제 조정 공지
  R.fixState = function (P) {
    if (P.st && P.subj && P.grade) R.mqInit(P);   // 학기 이야기: 예전 학생은 지금 학년 장의 처음부터
    if (P.cls === 'spellblade') P.cls = 'knight';   // 마검사 학과는 없어졌다 (기사 + 일반 주문 = 마검사)
    // 물리/주문 공격력 분리 (BUILD 17): 기사는 공격 능력치가 지력 → 체력으로 바뀌어 포인트를 한 번 돌려준다
    // 슬롯 늘리기 연구 폐지 (BUILD 30): 이미 쌓은 단계의 마나 · 지식을 돌려준다
    if (!P.slotV && P.rs && P.res) { P.slotV = 1; var back = { mana: 0, know: 0 }; D.RESEARCH.forEach(function (r) { if (!r.gone) return; var L = P.rs[r.id] || 0; for (var lv = 0; lv < L; lv++) { var c0 = R.resCost(P, r.id, lv); back.mana += c0.mana; back.know += c0.know; } if (L) delete P.rs[r.id]; }); if (back.mana || back.know) { P.res.mana += back.mana; P.res.know += back.know; if (P.log) log(P, P.at || 0, '수업 · 원정 · 연구가 한 자리씩으로 바뀌어, 슬롯을 늘리던 연구의 마나 ' + R.fmt(back.mana) + ' · 지식 ' + R.fmt(back.know) + '을(를) 돌려드렸습니다.', 'news'); } }
    if (!P.physV) { P.physV = 1; if (P.cls === 'knight' && P.alloc && P.log && (P.alloc.int || 0) > 0 && allocReset(P, 'knight')) log(P, P.at || 0, '기사의 공격력이 지력 대신 체력을 따르게 바뀌어 능력치 포인트를 모두 돌려드렸습니다.', 'news'); }
    D.SUBJECTS.forEach(function (s) { if (!P.subj[s.id]) P.subj[s.id] = { lv: 0, xp: 0 }; });
    delete P.quizCd; delete P.pq; delete P.qRecent; if (P.st) delete P.st.quizCorrect;
    // 수업 예약 · 시간표 · 분해 (2026-10-19)
    if (!P.lecQ) P.lecQ = [null, null, null]; if (!P.lecEnd) P.lecEnd = [0, 0, 0]; if (!P.tt) P.tt = [];
    if (P.res && P.res.dust == null) P.res.dust = 0; if (P.autoDis == null) P.autoDis = false;
    // 경제 조정(C안) 공지: 이 조정 전에 입학한 학생에게 한 번 보여 준다 (1 = 보여 줄 것, 2 = 봤음)
    if (P.econC == null) P.econC = P.created && P.created < R.ECON_C_AT ? 1 : 2;
    if (!P.badges) P.badges = [];
    if (P.grade >= 3 && !P.badgeGot && P.res && P.log) { P.badgeGot = 1; gainBadge(P, makeBadge(P), P.at || 0, '아카데미 휘장 수여'); }
    if (P.st && P.st.aGrades == null) P.st.aGrades = Object.keys(P.scores || {}).filter(function (g) { var l = P.scores[g].letter; return l === 'S' || l === 'A'; }).length;
    if (P.spells && P.cls) P.spells = P.spells.map(function (sid) { return sid && R.spellUnlocked(P, sid) ? sid : null; });
    return P;
  };
  R.CLS = {}; D.CLASSES.forEach(function (x) { R.CLS[x.id] = x; });
  R.clsOf = function (P) { return R.CLS[P.cls] || R.CLS.mage; };
  R.clsCanChange = function (P) { return !P.cls; };   // 학과를 고른 적 없는 예전 학생만 한 번 그냥 고른다. 그 뒤로는 전과시험
  // 입학할 때 학과 정하기: 첫 전용 주문을 비어 있는 주문 칸에 넣어 준다
  R.clsStart = function (P, id) { if (!R.CLS[id]) return; P.cls = id; allocReset(P, id); var st = { knight: 'shieldbash', mage: 'arcane' }[id], n = R.spellSlots(P);
    for (var i = 0; i < n; i++) if (!P.spells[i]) { P.spells[i] = st; return; } };
  R.CLS_EXAM_CD = 86400;
  R.clsExamFee = function (P) { return 800 * Math.max(1, P.grade); };
  // 시험관: 지금 원정을 다니는 단계(추천 단계)의 몬스터를 크게 키운 것. 옮길 학과의 몸으로 싸운다
  R.clsExamStage = function (P, W) { return Math.max(3, R.bestStage(P, W) + 2); };
  // 미리 보기: 그 학과의 몸으로 싸우면 이길 수 있는지
  R.clsExamPreview = function (P, W, id, t) { var old = P.cls; P.cls = id; try { return R.duelPreview(P, W, R.clsExamStage(P, W), 4, 1.3, t); } finally { P.cls = old; } };
  R.clsExamFoe = function (P, W) { return R.duelEnemy(R.clsExamStage(P, W), 4, 1.3); };
  // 학과가 바뀌면 그 학과로 못 쓰는 전용 주문은 슬롯에서 뺀다
  function clsSet(P, id, now, how) {
    P.cls = id; P.spells = P.spells.map(function (s) { return s && R.spellUnlocked(P, s) ? s : null; });
    if (!P.spells.some(Boolean)) P.spells[0] = 'bolt';
    if (allocReset(P, id)) log(P, now, '학과를 옮겨 능력치 포인트를 모두 돌려받았습니다. 새 학과에 맞게 다시 분배할 수 있습니다.', 'news');
    log(P, now, R.CLS[id].name + ' 학과로 옮겼습니다' + (how ? ' (' + how + ')' : '') + '.', 'story');
  }
  R.newPlayer = function (id, name, house, now, seed) {
    var P = {
      v: R.VERSION, id: id, name: name, house: HOUSE[house] ? house : 'lanterna', created: now, at: now, econC: 2, physV: 1, slotV: 1,
      rng: (seed | 0) || (Math.floor(Math.random() * 2147483647) | 1),
      res: { mana: 300, gold: 0, know: 0, shard: 0, stone: 0 }, mats: {},
      lvl: 1, xp: 0, pts: 0, alloc: { int: 0, wil: 0, agi: 0, vit: 0, luk: 0 },
      subj: {}, grade: 1, scores: {}, examCd: 0, px: null,
      maxStage: 9, bossCd: 0, bossWins: {},
      lec: [null, null, null], exp: [null, null], rsq: [null, null],
      spells: ['bolt', null, null, null],
      inv: [], eq: { staff: null, robe: null, hat: null, charm: null, tome: null }, bagExtra: 0, autoSell: -1, badges: [], badgeOn: null,
      rs: {}, brew: [], shelf: {}, buffs: {},
      fam: { own: {}, act: null, egg: null, eggs: 0, hatched: 0, disp: {} },
      duel: { rank: 0, cd: 0 }, tasks: {}, ach: {}, codex: {},
      st: { lecJobs: 0, lecHours: 0, expJobs: 0, nightJobs: 0, kills: 0, bosses: 0, bossTries: 0, maxStageAll: 9, maxGrade: 1, sGrades: 0,
        aGrades: 0, epicFound: 0, legendFound: 0, maxEnh: 0, enh: 0, brews: 0, spirits: 0, maxLevel: 1, manaTotal: 0, goldTotal: 0,
        streak: 0, famKinds: 0, dispatches: 0, researchDone: 0, wbAttacks: 0, wbKills: 0, cupWins: 0, duelWins: 0, duelBest: 0, tasksDone: 0 },
      daily: { day: -1, q: [], streak: 0, login: false },
      wk: { id: 0, cup: 0, dmg: 0, att: 0 }, wkPrev: null, wb: { tickets: K.WB_TICKET_MAX, at: now, bought: 0, buyDay: -1 },
      spirit: { n: 1, at: now },
      opt: { autoEquip: true, autoAlloc: false, allocW: { int: 3, wil: 1.5, agi: 1, vit: 1.5, luk: 1 }, sound: false, reduceFx: false },
      log: [], inbox: [], story: 0
    };
    D.SUBJECTS.forEach(function (s) { P.subj[s.id] = { lv: 0, xp: 0 }; });
    P.eq.staff = makeItem(P, 'staff', 1, 0);
    P.eq.robe = makeItem(P, 'robe', 1, 0);
    P.mq = { g: 1, i: 0, b: { lecJobs: 0, expJobs: 0, researchDone: 0 } };
    P.buffs.orient = { name: '신입생 오리엔테이션', eff: { lectureSpd: 1.0, xpPct: 0.5 }, start: now, end: now + 3 * 86400, color: '#a6e3cf' };
    log(P, now, P.name + ' 학생, 아르카눔 아카데미 ' + HOUSE[P.house].name + '에 배정되었습니다.', 'story');
    return P;
  };

  /* ───────── 기록 ───────── */
  function log(P, t, m, k) {
    var top = P.log[0];
    if (top && top.m === m) { top.n = (top.n || 1) + 1; top.t = t; return; }
    P.log.unshift({ t: t, m: m, k: k || 'info' });
    if (P.log.length > 50) P.log.length = 50;
  }
  function inbox(P, item) { P.inbox.push(item); if (P.inbox.length > 40) P.inbox.splice(0, P.inbox.length - 40); }
  R.log = log;

  /* ───────── 보너스 집계 ───────── */
  function addEff(b, eff, k) { k = k == null ? 1 : k; for (var key in eff) b[key] = (b[key] || 0) + eff[key] * k; }
  R.famBonus = function (f, lv) { return f.base * (1 + 0.25 * (lv - 1)); };
  R.CODEX_TIERS = [1, 10, 100]; R.BOSS_TIERS = [1, 5, 20]; R.CODEX_EACH = 0.004;
  R.tiersFor = function (id) { return BOSS_IDS[id] ? R.BOSS_TIERS : R.CODEX_TIERS; };
  R.codexTiers = function (P) {
    var n = 0; for (var id in P.codex) { var k = P.codex[id], tt = R.tiersFor(id); for (var i = 0; i < tt.length; i++) if (k >= tt[i]) n++; }
    return n;
  };
  // t0~t1 구간의 평균 보너스 (물약·주말은 겹친 시간 비율만큼)
  function bonuses(P, W, t0, t1) {
    var b = {};
    var cn = R.codexTiers(P); if (cn) { b.atkPct = cn * R.CODEX_EACH; b.goldPct = cn * R.CODEX_EACH; }
    var h = HOUSE[P.house]; if (h) addEff(b, h.bonus);
    var cl = R.CLS[P.cls || 'mage']; if (cl) addEff(b, cl.bonus);   // 학과
    if (P.guildLv > 0) { var gb = R.guildBonus(P.guildLv); b.goldPct = (b.goldPct || 0) + gb; b.xpPct = (b.xpPct || 0) + gb; }   // 동아리 레벨 보너스
    if (P.partyN > 1) { var pb = 0.03 * (Math.min(P.partyN, 4) - 1); b.goldPct = (b.goldPct || 0) + pb; b.xpPct = (b.xpPct || 0) + pb; }   // 파티 보너스
    for (var id in P.rs) if (RES[id]) addEff(b, RES[id].eff, P.rs[id]);
    for (var fid in P.fam.own) { var f = FAM[fid]; if (f) b[f.bonus] = (b[f.bonus] || 0) + R.famBonus(f, P.fam.own[fid].lv); }
    var span = Math.max(1e-6, t1 - t0);
    for (var bid in P.buffs) {
      var bf = P.buffs[bid], ov;
      if (t1 <= t0) ov = bf.start <= t0 && bf.end > t0 ? 1 : 0;
      else ov = Math.max(0, Math.min(bf.end, t1) - Math.max(bf.start, t0)) / span;
      if (ov > 0) addEff(b, bf.eff, ov);
    }
    if (W) {
      var cal = R.calendar(W, t0); addEff(b, cal.bonus.eff);
      if (R.scholarship(P, W, t0)) addEff(b, R.SCHOLAR_EFF);
      var wf = weekendFrac(t0, t1); if (wf > 0) addEff(b, D.WEEKEND.eff, wf);
      R.skyOverlap(t0, t1).forEach(function (o) { addEff(b, o.ev.eff, o.f); });
    }
    for (var s in P.eq) {
      var it = P.eq[s]; if (!it) continue;
      var ist = itemStats(it);
      for (var k in ist) if (STATS.indexOf(k) < 0 && k !== 'atk' && k !== 'hp' && k !== 'def') b[k] = (b[k] || 0) + ist[k];
      if (it.eng) b[it.eng.id] = (b[it.eng.id] || 0) + it.eng.v;
    }
    var bw = R.badgeWorn(P); if (bw) { var bst = R.badgeStats(bw); for (var bk in bst) b[bk] = (b[bk] || 0) + bst[bk]; }   // 아카데미 휘장
    return b;
  }
  R.bonuses = bonuses;

  /* ───────── 후배 장학금: 서버 진행보다 두 학년 이상 뒤처진 학생 지원 ───────── */
  R.PACE = [1.8, 4.3, 9.9, 16.5, 28.9, 49.9, 91.9]; // 성실한 학생이 각 시험을 통과하는 개교 후 날짜
  R.SCHOLAR_EFF = { lectureSpd: 0.6, xpPct: 0.6, goldPct: 0.3 };
  R.expectedGrade = function (W, t) { var d = (t - W.epoch) / 86400, g = 1; R.PACE.forEach(function (x) { if (d >= x) g++; }); return g; };
  R.scholarship = function (P, W, t) { return !!W && P.grade < 8 && P.grade <= R.expectedGrade(W, t) - 2; };

  /* ───────── 장비 ───────── */
  function tierOf(ilvl) { return clamp(Math.floor((ilvl - 1) / 10), 0, 9); }
  function rarityWeights(boost) {
    return D.RARITY.map(function (r, i) { return r.w * (i >= 2 ? 1 + boost : 1) * (i >= 1 ? 1 + boost * 0.5 : 1); });
  }
  function rollRarity(P, boost) {
    var ws = rarityWeights(boost), tot = ws.reduce(function (a, b) { return a + b; }, 0), x = rnd(P) * tot;
    for (var i = 0; i < ws.length; i++) { x -= ws[i]; if (x <= 0) return i; }
    return 0;
  }
  function uid(P) { return (rnd(P) * 2176782336 | 0).toString(36) + (rnd(P) * 2176782336 | 0).toString(36); }
  // 장비 이름 바탕 · 종류 이름 (무기 칸은 지팡이 / 검)
  R.baseName = function (it) { return D.ITEM_NAMES[it.slot === 'staff' && it.wk === 'sword' ? 'sword' : it.slot][tierOf(it.ilvl)]; };
  R.slotName = function (it) { return it && it.slot === 'staff' ? (it.wk === 'sword' ? '검' : '지팡이') : it && SLOT[it.slot] ? SLOT[it.slot].name : ''; };
  function makeItem(P, slot, ilvl, r, minR) {
    if (r == null) r = 0; if (minR != null && r < minR) r = minR;
    var it = { u: uid(P), slot: slot, ilvl: Math.max(1, Math.round(ilvl)), r: r, enh: 0, q: Math.round((0.9 + rnd(P) * 0.2) * 1000) / 1000, aff: [], lock: false };
    if (slot === 'staff' && rnd(P) < (P.cls === 'knight' ? 0.7 : 0.3)) it.wk = 'sword';   // 무기: 기사는 검이, 마법사는 지팡이가 더 잘 나온다
    var pool = D.AFFIXES.slice(), n = D.RARITY[r].affix;
    for (var i = 0; i < n && pool.length; i++) {
      var a = pool.splice(Math.floor(rnd(P) * pool.length), 1)[0], v;
      if (a.flat) v = a.flat * (1 + it.ilvl * 0.07) * (0.7 + rnd(P) * 0.6) * (1 + r * 0.1);
      else v = (a.pct[0] + (a.pct[1] - a.pct[0]) * rnd(P)) * (1 + Math.min(it.ilvl, 200) * 0.004);
      it.aff.push({ id: a.id, v: Math.round(v * 10000) / 10000 });
    }
    if (r === 4) { var en = pick(P, D.ENGRAVES); it.eng = { id: en.id, v: Math.round((en.range[0] + (en.range[1] - en.range[0]) * rnd(P)) * 1000) / 1000 }; }
    it.name = (it.aff.length ? AFF[it.aff[0].id].prefix + ' ' : '') + R.baseName(it);
    return it;
  }
  R.makeItem = makeItem;
  function mainVal(it) {
    var S = SLOT[it.slot], rm = D.RARITY[it.r].mult;
    if (S.main === 'spellPct') return S.base * (1 + it.ilvl * 0.025) * rm * it.q * (1 + it.enh * 0.08);
    if (S.main === 'int' || S.main === 'luk') return S.base * (1 + it.ilvl * 0.09) * rm * it.q * (1 + it.enh * 0.08);
    return S.base * Math.pow(1.12, it.ilvl - 1) * rm * it.q * (1 + it.enh * 0.1);
  }
  function subVal(it) {
    var S = SLOT[it.slot]; if (!S.sub) return 0;
    var rm = D.RARITY[it.r].mult;
    if (S.sub === 'critC') return S.subBase * rm * (1 + it.enh * 0.05);
    return S.subBase * Math.pow(1.12, it.ilvl - 1) * rm * it.q * (1 + it.enh * 0.1);
  }
  function itemStats(it) {
    var o = {}, S = SLOT[it.slot];
    o[S.main] = (o[S.main] || 0) + mainVal(it);
    if (S.sub) o[S.sub] = (o[S.sub] || 0) + subVal(it);
    for (var i = 0; i < it.aff.length; i++) { var a = it.aff[i]; o[a.id] = (o[a.id] || 0) + a.v; }
    return o;
  }
  R.itemStats = itemStats;
  R.sellPrice = function (it) { return Math.floor(K.KILL_GOLD * 3 * Math.pow(1.10, it.ilvl - 1) * Math.pow(it.r + 1, 2) * (1 + it.enh * 0.3)); };
  R.ENH_MAX = 20;
  R.enhCost = function (P, it) { return { gold: Math.floor(60 * Math.pow(1.10, it.ilvl - 1) * Math.pow(1.5, it.enh)), stone: 1 + Math.floor(it.enh * 1.2) }; };
  R.enhChance = function (P, it) { var b = bonuses(P, null, 0, 0); return clamp(1 - it.enh * 0.065 + (b.enhBonus || 0) + P.subj.rune.lv * 0.004, it.enh >= 15 ? 0.1 : 0.2, 1); };

  /* ───────── 능력치 ───────── */
  function calc(P, W, t0, t1) {
    if (t0 == null) t0 = P.at; if (t1 == null) t1 = t0;
    var b = bonuses(P, W, t0, t1), st = {};
    STATS.forEach(function (k) { st[k] = 5 + (P.alloc[k] || 0) + (P.lvl - 1) * 0.3; });
    for (var sid in P.subj) { var S = SUBJ[sid]; if (!S) continue; var L = P.subj[sid].lv; st[S.stat] += L * 1.2; st[S.stat2] += L * 0.6; }
    var gear = { atk: 0, hp: 0, def: 0 };
    for (var s in P.eq) {
      var it = P.eq[s]; if (!it) continue; var ist = itemStats(it);
      for (var k in ist) { if (STATS.indexOf(k) >= 0) st[k] += ist[k]; else if (k === 'atk' || k === 'hp' || k === 'def') gear[k] += ist[k]; }
    }
    var c = { stat: st, b: b };
    // 물리 공격력은 체력, 주문 공격력은 지력을 따른다. 평타는 기사는 물리(검), 마법사는 주문(마력 화살)
    var atk0 = (5 + gear.atk) * (1 + (b.atkPct || 0));
    c.patk = atk0 * (1 + st.vit * 0.01) * (1 + (b.physPct || 0)); c.matk = atk0 * (1 + st.int * 0.01);
    c.atk = P.cls === 'knight' ? c.patk : c.matk;
    c.hp = (60 + gear.hp) * (1 + st.vit * 0.012 + st.wil * 0.004) * (1 + (b.hpPct || 0));
    c.def = (2 + gear.def) * (1 + st.vit * 0.006) * (1 + (b.defPct || 0));
    c.aps = Math.min(5, 0.8 * (1 + st.agi * 0.01) * (1 + (b.aps || 0)));
    c.critC = Math.min(0.8, 0.05 + st.luk * 0.0015 + (b.critC || 0));
    c.critD = 1.5 + (b.critD || 0);
    c.spell = 1 + (b.spellPct || 0) + P.subj.syntax.lv * 0.02;
    c.mana = K.MANA_BASE * (1 + st.wil * 0.04) * (1 + (b.manaPct || 0));
    c.manaCap = c.mana * (K.MANA_CAP_H * 3600 + (b.manaCap || 0));
    c.lecSpd = 1 + (b.lectureSpd || 0) + st.int * 0.0008;
    c.know = 1 + (b.knowPct || 0);
    c.gold = 1 + (b.goldPct || 0);
    c.xp = 1 + (b.xpPct || 0);
    c.drop = 1 + (b.dropPct || 0) + st.luk * 0.001;
    c.rarity = (b.rarity || 0) + st.luk * 0.0008;
    c.leech = Math.min(0.1, b.leech || 0);
    c.bag = K.BAG_BASE + (b.bag || 0) + P.bagExtra;
    // 몸은 하나: 수업 · 원정 · 연구는 각각 한 자리만 (예전의 슬롯 늘리기 연구는 없어졌다)
    c.lecSlots = 1; c.expSlots = 1; c.resSlots = 1;
    c.brewSpd = 1 + (b.brewSpd || 0) + P.subj.alch.lv * 0.01;
    c.hatchSpd = 1 + (b.hatchSpd || 0) + P.subj.beast.lv * 0.01;
    c.regen = 0.008 + st.vit * 0.00005;
    c.bossDmg = 1 + (b.bossDmg || 0); c.cdr = Math.min(0.5, b.cdr || 0); c.killMana = b.killMana || 0;
    c.examBonus = b.examBonus || 0;
    var critMul = 1 + c.critC * (c.critD - 1);
    c.dps = c.atk * c.aps * critMul;
    c.spellDps = 0;
    var ns = R.spellSlots(P);
    for (var i = 0; i < ns; i++) {
      var sp = SPELL[P.spells[i]]; if (!sp || !R.spellUnlocked(P, sp.id)) continue;
      if (sp.type === 'dmg' || sp.type === 'stun') c.spellDps += R.spellHit(c, sp) * sp.mult * spellLvMult(P, sp) * critMul / (sp.cd * (1 - c.cdr));
      if (sp.type === 'haste' || sp.type === 'amp') c.dps *= 1 + sp.dur / sp.cd;
    }
    c.famDps = P.fam.act && P.fam.own[P.fam.act] ? c.atk * famAtkMult(P) / 1.5 : 0;
    c.totalDps = c.dps + c.spellDps + c.famDps;
    c.power = Math.floor(c.totalDps * 3 + c.hp * 0.6 + c.def * 4);
    return c;
  }
  R.calc = calc;
  function spellLvMult(P, sp) { return 1 + (sp.req ? P.subj[sp.req[0]].lv * 0.03 : P.lvl * 0.01); }
  function famAtkMult(P) { var f = FAM[P.fam.act], o = P.fam.own[P.fam.act]; return 0.25 * (1 + f.r * 0.25) * (1 + 0.08 * (o.lv - 1)); }
  R.spellUnlocked = function (P, id) { var sp = SPELL[id]; if (!sp) return false; if (sp.cls && sp.cls.indexOf(P.cls || 'mage') < 0) return false; return !sp.req || P.subj[sp.req[0]].lv >= sp.req[1]; };
  R.spellSlots = function (P) { return 2 + (P.grade >= 3 ? 1 : 0) + (P.grade >= 5 ? 1 : 0); };

  /* ───────── 레벨 ───────── */
  R.xpNeed = function (lv) { return Math.floor(K.XP_A * Math.pow(K.XP_G, lv - 1) + lv * K.XP_L); };
  function addXp(P, x, t) {
    P.xp += x; var ups = 0;
    while (P.xp >= R.xpNeed(P.lvl) && ups < 2000) { P.xp -= R.xpNeed(P.lvl); P.lvl++; P.pts += 2; ups++; }
    if (ups) {
      if (P.lvl > P.st.maxLevel) P.st.maxLevel = P.lvl;
      if (P.opt.autoAlloc) R.autoAlloc(P);
      log(P, t, '레벨 ' + P.lvl + ' 달성', 'good');
    }
    return ups;
  }
  // 주문 한 번의 기준 피해: 물리 기술(phys)은 물리 공격력, 나머지는 주문 공격력 × 주문 위력
  R.spellHit = function (c, sp) { return sp.phys ? (c.patk || c.atk) : (c.matk || c.atk) * c.spell; };
  // 자동 분배 프리셋 (학과마다 공격 능력치가 다르다)
  R.ALLOC_PRESETS = {
    mage: { balance: { int: 3, wil: 1.5, agi: 1, vit: 1.5, luk: 1 }, attack: { int: 4, wil: 0.5, agi: 2, vit: 1, luk: 1.5 }, guard: { int: 2, wil: 1.5, agi: 0.5, vit: 3, luk: 0.5 }, scholar: { int: 2, wil: 3, agi: 0.5, vit: 1, luk: 1 } },
    knight: { balance: { int: 1, wil: 1.5, agi: 1.5, vit: 3, luk: 1 }, attack: { int: 0.5, wil: 0.5, agi: 2.5, vit: 3.5, luk: 1.5 }, guard: { int: 0.5, wil: 2, agi: 0.5, vit: 4, luk: 0.5 }, scholar: { int: 2, wil: 3, agi: 0.5, vit: 1, luk: 1 } }
  };
  R.allocPresets = function (P) { return R.ALLOC_PRESETS[P.cls === 'knight' ? 'knight' : 'mage']; };
  // 능력치 포인트를 모두 돌려받고 학과 기본 분배로 다시 나눈다 (학과를 옮길 때 · 물리/주문 분리 때 한 번)
  function allocReset(P, toCls) {
    var tot = 0; STATS.forEach(function (k) { tot += P.alloc[k] || 0; P.alloc[k] = 0; }); P.pts += tot;
    var old = JSON.stringify(P.opt.allocW), was = false; ['mage', 'knight'].forEach(function (c) { var ps = R.ALLOC_PRESETS[c]; Object.keys(ps).forEach(function (k) { if (JSON.stringify(ps[k]) === old) was = k; }); });
    if (was) P.opt.allocW = JSON.parse(JSON.stringify(R.ALLOC_PRESETS[toCls === 'knight' ? 'knight' : 'mage'][was]));
    if (P.opt.autoAlloc) R.autoAlloc(P); return tot;
  }
  R.allocReset = allocReset;
  R.autoAlloc = function (P) {
    var w = P.opt.allocW, guard = 0;
    while (P.pts > 0 && guard++ < 100000) {
      var best = null, bv = Infinity;
      STATS.forEach(function (k) { var ww = w[k] || 0; if (ww <= 0) return; var v = (P.alloc[k] + 1) / ww; if (v < bv) { bv = v; best = k; } });
      if (!best) break; P.alloc[best]++; P.pts--;
    }
  };
  function addGold(P, g) { g = Math.floor(g); P.res.gold += g; P.st.goldTotal += g; }
  function addMana(P, m) { P.res.mana += m; P.st.manaTotal += m; }

  /* ───────── 몬스터 ───────── */
  R.zoneOf = function (s) { var z = D.ZONES[0]; for (var i = 0; i < D.ZONES.length; i++) if (s >= D.ZONES[i].from) z = D.ZONES[i]; return z; };
  R.isBoss = function (s) { return s % 10 === 0; };
  R.monHp = function (s) { return K.MON_HP * Math.pow(K.G_HP, s - 1) * Math.min(1, 0.55 + s * 0.045); };
  R.monAtk = function (s) { return K.MON_ATK * Math.pow(K.G_ATK, s - 1); };
  // 갈 수 있는 단계: 학년 상한(학년×10+9), 레벨이 높으면 레벨만큼 (학년 상한 +10까지)
  R.STAGE_OVER = 10;
  R.gradeCap = function (P) { return P.grade >= 8 ? 1e9 : P.grade * 10 + 9; };
  R.stageLvReq = function (s) { return s; };
  R.stageCap = function (P) { var g = R.gradeCap(P); return P.grade >= 8 ? g : Math.max(g, Math.min(g + R.STAGE_OVER, P.lvl)); };
  R.nextBoss = function (P) { return Math.floor(P.maxStage / 10) * 10 + 10; };
  R.canChallenge = function (P) { var b = R.nextBoss(P); return P.grade >= 8 || b <= R.stageCap(P); };
  function dmgTaken(atk, def) { return atk * atk / (atk + def); }
  R.dmgTaken = dmgTaken;

  /* ───────── 원정 ───────── */
  // 위험도: 처치 한 번에 받는 피해 / 최대 생명력
  R.expPreview = function (P, W, s, durK, t0) {
    var d = DUR[durK] || DUR['1h']; t0 = t0 || P.at;
    var c = calc(P, W, t0, t0 + d.s);
    var hp = R.monHp(s), atk = R.monAtk(s);
    var ttk = hp / Math.max(1e-9, c.totalDps);
    var perKill = Math.max(0, dmgTaken(atk, c.def) - c.hp * c.regen) * ttk;
    var risk = perKill / c.hp;
    var surv = risk <= 0.5 ? 1 : Math.max(0.03, 1 - (risk - 0.5) * 0.9);
    var kps = surv / (ttk + K.SPAWN) / K.KILL_PACK;
    var kills = kps * d.s * d.eff;
    var gEach = K.KILL_GOLD * Math.pow(K.G_GOLD, s - 1) * c.gold * K.EXP_RATE * K.EXP_GOLD * K.KILL_PACK;
    var xEach = K.KILL_XP * Math.pow(K.G_XP, s - 1) * c.xp * K.EXP_RATE * K.KILL_PACK;
    return { s: s, dur: d.s, eff: d.eff, kills: kills, kps: kps, risk: risk, surv: surv, gold: kills * gEach, xp: kills * xEach, gEach: gEach, xEach: xEach,
      drop: c.drop, rarity: c.rarity, killMana: c.killMana * c.mana * K.KILL_PACK, label: risk <= 0.25 ? '안정' : risk <= 0.5 ? '적정' : risk <= 1 ? '위험' : '무모함' };
  };
  // 무모한 원정(위험도 1 초과)은 도중에 쓰러진다: 떠날 때 시각을 정해 둔다 (위험할수록 일찍)
  function fallAt(P, now, dur, risk) { if (!(risk > 1)) return 0; return Math.floor(now + dur * clamp((0.7 + rnd(P) * 0.6) / risk, 0.05, 0.95)); }
  R.expEnd = function (j) { return j.fallAt && j.fallAt < j.end ? j.fallAt : j.end; };
  R.bestStage = function (P, W) {
    var best = 1, bv = 0;
    for (var s = 1; s <= Math.min(P.maxStage, R.stageCap(P)); s++) {
      if (R.isBoss(s)) continue;
      var p = R.expPreview(P, W, s, '1h'); var v = p.gold + p.xp * 0.5;
      if (v > bv) { bv = v; best = s; }
    }
    return best;
  };
  /* ───────── 함께 원정 (최대 4명) ─────────
     몬스터는 선봉을 80% 확률로 노린다(기사 선봉 +5%p, 수호 결계를 끼면 +5%p, 최대 95%). 나머지는 다른 사람들이 고르게 나눠 받는다.
     후열은 공격 주문을 껴야 고를 수 있고 공격 +10% · 받는 피해 +10%. 지원은 보호막·치유 주문을 껴야 고를 수 있고 공격 −15% · 파티가 받는 피해 −15%.
     함께 잡은 몬스터는 인원수로 나누되 1명 늘 때마다 +5%. 전리품은 각자 따로 굴린다. */
  R.EXP_POS = {
    van: { id: 'van', name: '선봉', dps: 1, def: 1.25, take: 1, red: 0, desc: '몬스터가 80% 확률로 선봉을 노림 · 방어 +25%' },
    rear: { id: 'rear', name: '후열', dps: 1.1, def: 1, take: 1.1, red: 0, need: 'dmg', desc: '공격 주문을 껴야 고를 수 있음 · 공격 +10% · 받는 피해 +10%' },
    sup: { id: 'sup', name: '지원', dps: 0.85, def: 1, take: 1, red: 0.15, need: 'care', desc: '보호막·치유 주문을 껴야 고를 수 있음 · 파티가 받는 피해 −15% · 공격 −15%' }
  };
  R.EXP_PARTY_MAX = 4; R.EXP_PARTY_BONUS = 0.05; R.EXP_AGGRO = 0.8;
  R.expPositions = function (P) {
    var has = { dmg: false, care: false }, ns = R.spellSlots(P);
    for (var i = 0; i < ns; i++) { var sp = SPELL[P.spells[i]]; if (!sp || !R.spellUnlocked(P, sp.id)) continue; if (sp.type === 'dmg' || sp.type === 'stun') has.dmg = true; if (sp.type === 'shield' || sp.type === 'heal') has.care = true; }
    return Object.keys(R.EXP_POS).filter(function (k) { var x = R.EXP_POS[k]; return !x.need || has[x.need]; });
  };
  // 선봉이 몬스터를 끄는 정도 (기사 +5%p, 수호 결계 장착 +5%p)
  R.expAggro = function (P) {
    var a = R.EXP_AGGRO; if (P && P.cls === 'knight') a += 0.05;
    if (P && P.spells && P.spells.slice(0, R.spellSlots(P)).indexOf('ward') >= 0 && R.spellUnlocked(P, 'ward')) a += 0.05;
    if (P && P.spells && P.spells.slice(0, R.spellSlots(P)).indexOf('warcry') >= 0 && R.spellUnlocked(P, 'warcry')) a += 0.05;
    return Math.min(0.95, a);
  };
  // 함께 갈 수 있는지: 비어 있는 원정 슬롯 번호를 돌려주거나 이유를 던진다
  R.expCanGo = function (P, W, now, s) {
    if (R.dreaming(P, now)) err('꿈길 중에는 출정할 수 없습니다');
    var c = calc(P, W, now), free = -1; for (var i = 0; i < c.expSlots; i++) if (!P.exp[i]) { free = i; break; }
    if (free < 0) err('비어 있는 원정 슬롯이 없습니다');
    if (s > P.maxStage || s > R.stageCap(P)) err(s + '단계는 아직 열지 않았습니다');
    if (R.isBoss(s)) err('보스 단계는 함께 원정으로 갈 수 없습니다');
    return free;
  };
  // ms: [{c: calc 결과, pos, aggro}] → 사람마다 원정 값(kps 등)과 파티 전체 예상
  R.expPartyPreview = function (ms, s, durK) {
    var d = DUR[durK] || DUR['1h'], n = ms.length, hp = R.monHp(s), atk = R.monAtk(s) * Math.sqrt(n);   // 사람이 많으면 몬스터도 여럿이 덤빈다
    var POS1 = { dps: 1, def: 1, take: 1, red: 0 }, posOf = function (m) { return n === 1 ? POS1 : R.EXP_POS[m.pos] || R.EXP_POS.van; };   // 혼자 떠나면 혼자 원정과 같다
    var dps = 0, red = 0, vans = [], aggro = 0;
    ms.forEach(function (m, i) { var x = posOf(m); dps += m.c.totalDps * x.dps; red += x.red; if (n > 1 && m.pos === 'van') { vans.push(i); aggro = Math.max(aggro, m.aggro || R.EXP_AGGRO); } });
    red = Math.min(0.3, red);
    var nv = vans.length, rest = n - nv;
    var ttk = hp / Math.max(1e-9, dps), survSum = 0, worst = 0;
    var each = ms.map(function (m, i) {
      var x = posOf(m), frac;   // 이 사람이 몬스터에게 노려질 몫
      if (n === 1) frac = 1; else if (!nv) frac = 1 / n; else if (!rest) frac = 1 / n; else frac = vans.indexOf(i) >= 0 ? aggro / nv : (1 - aggro) / rest;
      var per = Math.max(0, dmgTaken(atk, m.c.def * x.def) * frac * x.take * (1 - red) - m.c.hp * m.c.regen) * ttk, risk = per / m.c.hp;
      var surv = risk <= 0.5 ? 1 : Math.max(0.03, 1 - (risk - 0.5) * 0.9); survSum += surv; worst = Math.max(worst, risk);
      return { risk: risk, surv: surv, frac: frac };
    });
    var surv = survSum / n, kpsAll = surv / (ttk + K.SPAWN / n) / K.KILL_PACK, share = (1 + R.EXP_PARTY_BONUS * (n - 1)) / n;
    var out = ms.map(function (m, i) {
      var c = m.c, kps = kpsAll * share, kills = kps * d.s * d.eff;
      var gEach = K.KILL_GOLD * Math.pow(K.G_GOLD, s - 1) * c.gold * K.EXP_RATE * K.EXP_GOLD * K.KILL_PACK, xEach = K.KILL_XP * Math.pow(K.G_XP, s - 1) * c.xp * K.EXP_RATE * K.KILL_PACK;
      return { kps: kps, kills: kills, gold: kills * gEach, xp: kills * xEach, gEach: gEach, xEach: xEach, drop: c.drop, rarity: c.rarity, killMana: c.killMana * c.mana * K.KILL_PACK, risk: each[i].risk, surv: each[i].surv, frac: each[i].frac };
    });
    return { s: s, dur: d.s, eff: d.eff, d: d.k, n: n, kills: kpsAll * d.s * d.eff, risk: worst, red: red, each: out, label: worst <= 0.25 ? '안정' : worst <= 0.5 ? '적정' : worst <= 1 ? '위험' : '무모함' };
  };
  // 서버(또는 미리보기)가 출발시킬 때만 부른다 — 학생이 직접 부르는 행동(A)이 아니다
  R.expPartyApply = function (P, now, slot, s, durK, pv, info) {
    var d = DUR[durK] || DUR['1h'];
    var j = P.exp[slot] = { s: s, start: now, end: now + d.s, dur: d.s, eff: d.eff, kps: pv.kps, gEach: pv.gEach, xEach: pv.xEach, drop: pv.drop, rarity: pv.rarity, killMana: pv.killMana, risk: pv.risk, pt: info };
    var fa = fallAt(P, now, d.s, pv.risk); if (fa) j.fallAt = fa;
    var kills = Math.floor(j.kps * j.dur * j.eff + 0.5), n = Math.floor(kills * K.ITEM_RATE * j.drop + rnd(P)), made = Math.min(n, 12);
    j.nItems = n; j.loot = [];
    for (var q = 0; q < made; q++) j.loot.push({ at: Math.floor(now + d.s * (q + 0.3 + rnd(P) * 0.6) / made), it: makeItem(P, pick(P, D.SLOTS).id, s, rollRarity(P, j.rarity)) });
    log(P, now, '함께 원정 출발: ' + s + '단계 · ' + info.n + '명 · ' + (R.EXP_POS[info.pos] || R.EXP_POS.van).name, 'good');
    return j;
  };
  function expFinish(P, j, t, frac, mode) {
    var keep = mode === 'recall' ? 1 : mode === 'fall' ? K.FALL_KEEP : mode ? K.CANCEL_KEEP : 1, canceled = !!mode;
    var kills = Math.floor(j.kps * j.dur * j.eff * frac * keep + rnd(P));   // 처치 수가 작아 소수점은 확률로
    var z = R.zoneOf(j.s), out = { k: 'exp', s: j.s, kills: kills, gold: 0, xp: 0, mats: 0, stones: 0, items: [], sold: 0, t: t, canceled: mode === true, recall: mode === 'recall', fell: mode === 'fall' };
    if (kills <= 0) return out;
    badgeGain(P, j.dur / 3600 * frac * keep * R.BADGE_XP.expH, t);
    var g = kills * j.gEach, x = kills * j.xEach;
    addGold(P, g); out.gold = Math.floor(g); out.xp = x; out.levels = addXp(P, x, t);
    if (j.killMana) addMana(P, kills * j.killMana);
    P.st.kills += kills; cupAdd(P, kills * K.KILL_PACK / 40);
    var mons = z.mons; for (var mk = 0; mk < Math.min(kills, 5000); mk++) { var mm = mons[Math.floor(rnd(P) * mons.length)]; P.codex[mm.id] = (P.codex[mm.id] || 0) + 1; }
    var mats = Math.floor(kills * K.MAT_RATE * j.drop + rnd(P)); if (mats) { P.mats[z.mat] = (P.mats[z.mat] || 0) + mats; out.mats = mats; out.mat = z.mat; }
    var prev = D.ZONES.filter(function (zz) { return zz.from < z.from; });
    if (prev.length) { var pm = Math.floor(kills * K.MAT_RATE * 0.25 * j.drop + rnd(P)); if (pm) { var pz = pick(P, prev); P.mats[pz.mat] = (P.mats[pz.mat] || 0) + pm; } }
    var stones = Math.floor(kills * K.STONE_RATE * j.drop + rnd(P)); P.res.stone += stones; out.stones = stones;
    // 장비: 떠날 때 정해 둔 전리품(j.loot)이 있으면 그것을 (취소하면 그때까지 주운 것의 일부만)
    if (j.loot) {
      var got = j.loot.filter(function (x) { return !canceled || x.at <= t; }); if (canceled) got = got.slice(0, Math.floor(got.length * keep));
      got.forEach(function (x) { var res2 = gainItem(P, x.it, t); out.items.push({ name: x.it.name, r: x.it.r, res: res2 }); });
      var rest = Math.max(0, (j.nItems || 0) - j.loot.length); if (canceled) rest = Math.floor(rest * frac * keep);
      if (rest) { var ex2 = rest * R.sellPrice({ ilvl: j.s, r: 0, enh: 0 }); addGold(P, ex2); out.gold += Math.floor(ex2); out.sold = rest; }
      if (!canceled) { P.st.expJobs++; if (j.dur >= 28800) P.st.nightJobs++; }
      return out;
    }
    // (예전 방식) 기대 개수만큼 굴리되 상위 12개만 실제 생성, 나머지는 판매가로
    var n = Math.floor(kills * K.ITEM_RATE * j.drop + rnd(P));
    var made = Math.min(n, 12);
    for (var i = 0; i < made; i++) {
      var it = makeItem(P, pick(P, D.SLOTS).id, j.s, rollRarity(P, j.rarity));
      var res = gainItem(P, it, t); out.items.push({ name: it.name, r: it.r, res: res });
    }
    if (n > made) { var extra = (n - made) * R.sellPrice({ ilvl: j.s, r: 0, enh: 0 }); addGold(P, extra); out.gold += Math.floor(extra); out.sold = n - made; }
    if (!canceled) { P.st.expJobs++; if (j.dur >= 28800) P.st.nightJobs++; }
    return out;
  }

  /* ───────── 수업 ───────── */
  R.subjXpNeed = function (lv) { return Math.floor(K.SUBJ_A * Math.pow(K.SUBJ_G, lv)); };
  R.subjVisible = function (P, s) { return !s.cls || s.cls === (P.cls || 'mage'); };   // 학과 전용 수업은 그 학과에게만
  R.availableSubjects = function (P) { return D.SUBJECTS.filter(function (s) { return s.unlock <= Math.min(P.grade, 7) && R.subjVisible(P, s); }); };
  R.lecPreview = function (P, W, sid, durK, t0) {
    var d = DUR[durK] || DUR['1h']; t0 = t0 || P.at;
    var c = calc(P, W, t0, t0 + d.s), h = d.s / 3600;
    var L = P.subj[sid].lv;
    return { dur: d.s, eff: d.eff, xp: K.LEC_XP * c.lecSpd * (1 + P.grade * 0.08) * h * d.eff, know: (K.LEC_KNOW + L * K.LEC_KNOW_LV) * c.know * c.lecSpd * h * d.eff };
  };
  function subjGain(P, sid, xp, t) {
    var sj = P.subj[sid], ups = 0; sj.xp += xp;
    while (sj.xp >= R.subjXpNeed(sj.lv) && ups < 500) { sj.xp -= R.subjXpNeed(sj.lv); sj.lv++; ups++; }
    if (ups) {
      log(P, t, SUBJ[sid].name + ' ' + sj.lv + '레벨', 'good');
      D.SPELLS.forEach(function (sp) {
        if (sp.req && sp.req[0] === sid && sj.lv >= sp.req[1] && sj.lv - ups < sp.req[1]) {
          log(P, t, '새 주문 습득: ' + sp.name, 'story');
          var n = R.spellSlots(P); if (P.spells.indexOf(sp.id) < 0) for (var i = 0; i < n; i++) if (!P.spells[i]) { P.spells[i] = sp.id; break; }
        }
      });
    }
    return ups;
  }
  function lecFinish(P, j, t, frac, canceled) {
    var k = frac * (canceled ? K.CANCEL_KEEP : 1);
    var lv0 = P.subj[j.s].lv;
    subjGain(P, j.s, j.xp * k, t);
    P.res.know += j.know * k;
    var hours = j.dur * frac / 3600;
    if (!canceled) { P.st.lecJobs++; if (j.dur >= 28800) P.st.nightJobs++; }
    P.st.lecHours += hours * (canceled ? K.CANCEL_KEEP : 1);
    badgeGain(P, hours * (canceled ? K.CANCEL_KEEP : 1) * R.BADGE_XP.lecH, t);
    cupAdd(P, hours * 10 * (canceled ? K.CANCEL_KEEP : 1));
    return { k: 'lec', s: j.s, xp: j.xp * k, know: j.know * k, from: lv0, to: P.subj[j.s].lv, t: t, canceled: !!canceled, peers: j.peers || 0, pb: j.pb || 0, ontime: !!j.ontime, auto: !!j.auto };
  }

  // 함께 듣는 수업: 같은 과목을 지금 듣고 있는 다른 학생 1명당 과목 경험치 +1% (최대 +5%), 맡길 때 정해진다
  R.PEER_MAX = 5;
  R.peerBonus = function (n) { return Math.min(R.PEER_MAX, Math.max(0, n | 0)) * 0.01; };

  /* ───────── 연구 ───────── */
  R.resCost = function (P, id, lv) {
    var r = RES[id]; if (lv == null) lv = P.rs[id] || 0;
    return { mana: Math.floor(r.mana * Math.pow(r.g, lv)), know: Math.floor(r.know * Math.pow(Math.max(1, r.g * 0.92), lv)),
      time: Math.min(172800, Math.floor(r.time * Math.pow(r.tg, lv))) };
  };
  R.resAvailable = function (P, id) { var r = RES[id]; return !!r && !r.gone && (!r.grade || P.grade >= r.grade); };
  R.resQueued = function (P, id) { return P.rsq.some(function (q) { return q && q.id === id; }); };

  /* ───────── 연금술 · 사역마 ───────── */
  R.cauldrons = function (P) { var a = P.subj.alch.lv; return 1 + (a >= 10 ? 1 : 0) + (a >= 20 ? 1 : 0); };
  R.potionUnlocked = function (P, id) { return P.grade >= 2 && P.subj.alch.lv >= POT[id].unlock; };
  R.eggCost = function (P) { return Math.floor(5000 * Math.pow(1.45, Math.min(P.fam.hatched, 30))); };
  R.feedCost = function (P, id) { var f = FAM[id], o = P.fam.own[id]; return Math.floor(2000 * Math.pow(1.45, o.lv) * (f.r + 1)); };
  function hatch(P, t) {
    P.fam.egg = null; P.fam.hatched++;
    var luck = 0;
    var ws = D.FAM_RARITY.map(function (r, i) { return r.w * (i >= 1 ? 1 + luck : 1); });
    var tot = ws.reduce(function (a, b) { return a + b; }, 0), x = rnd(P) * tot, r = 0;
    for (var i = 0; i < ws.length; i++) { x -= ws[i]; if (x <= 0) { r = i; break; } }
    var opts = D.FAMILIARS.filter(function (f) { return f.r === r; });
    var fresh = opts.filter(function (f) { return !P.fam.own[f.id]; });
    var f = fresh.length && rnd(P) < 0.7 ? pick(P, fresh) : pick(P, opts), own = P.fam.own[f.id], res;
    if (!own) { P.fam.own[f.id] = { lv: 1 }; res = { f: f.id, isNew: true }; if (!P.fam.act) P.fam.act = f.id; }
    else if (own.lv < 20) { own.lv++; res = { f: f.id, isNew: false, lv: own.lv }; }
    else { P.res.shard += 10; res = { f: f.id, isNew: false, max: true }; }
    P.st.famKinds = Object.keys(P.fam.own).length;
    log(P, t, '알이 부화했습니다: ' + f.name + (res.isNew ? ' (새로운 사역마!)' : ' (성장)'), 'good');
    return res;
  }
  function dispatchFinish(P, fid, d, t) {
    var f = FAM[fid], z = R.zoneOf(Math.min(P.maxStage, R.stageCap(P))), h = d.dur / 3600, out = { k: 'disp', f: fid, t: t };
    var mult = (1 + f.r * 0.3) * (1 + 0.05 * (P.fam.own[fid].lv - 1)) * (d.bonus || 1);
    var mats = Math.floor(h * 6 * mult + rnd(P) * 3); P.mats[z.mat] = (P.mats[z.mat] || 0) + mats; out.mats = mats; out.mat = z.mat;
    var stones = Math.floor(h * 0.8 * mult + rnd(P)); P.res.stone += stones; out.stones = stones;
    var gold = Math.floor(h * 40 * K.KILL_GOLD * Math.pow(K.G_GOLD, z.from - 1) * mult * K.DISP_GOLD); addGold(P, gold); out.gold = gold;
    if (rnd(P) < h * 0.008 * mult) { P.fam.eggs++; out.egg = 1; }
    if (rnd(P) < h * 0.04) { var sh = ri(P, 1, 3); P.res.shard += sh; out.shard = sh; }
    P.st.dispatches++; cupAdd(P, 20);
    if (d.dur >= 28800) P.st.nightJobs++;
    return out;
  }

  /* ───────── 장비 획득 · 관리 ───────── */
  function gainItem(P, it, t) {
    if (it.r === 3) P.st.epicFound++;
    if (it.r === 4) { P.st.legendFound++; log(P, t, '전설 장비 획득: ' + it.name + '!', 'legend'); }
    else if (it.r === 3) log(P, t, '영웅 장비 획득: ' + it.name, 'epic');
    if (P.opt.autoEquip) {
      var cur = P.eq[it.slot];
      if (!cur || (!cur.lock && R.powerWith(P, it) > calc(P, null).power * 1.0001)) {
        if (cur) storeOrSell(P, cur, true);
        P.eq[it.slot] = it; return 'equip';
      }
    }
    return storeOrSell(P, it, false);
  }
  R.gainItem = gainItem;
  function storeOrSell(P, it, wasEq) {
    var bag = calc(P, null).bag;
    if (!wasEq && P.rs.sorter && P.autoSell >= 0 && it.r <= P.autoSell && !it.lock) { if (P.autoDis) { dismantleGive(P, it); return 'dis'; } addGold(P, R.sellPrice(it)); return 'sold'; }
    if (P.inv.length >= bag) { addGold(P, R.sellPrice(it)); return 'sold'; }
    P.inv.push(it); return 'bag';
  }
  R.powerWith = function (P, it) { var old = P.eq[it.slot]; P.eq[it.slot] = it; var p = calc(P, null).power; P.eq[it.slot] = old; return p; };
  R.findItem = function (P, u) {
    for (var s in P.eq) if (P.eq[s] && P.eq[s].u === u) return P.eq[s];
    for (var i = 0; i < P.inv.length; i++) if (P.inv[i].u === u) return P.inv[i];
    return null;
  };

  /* ───────── 아카데미 휘장 ─────────
     P.badges: 가진 휘장(최대 R.BADGE_HOLD), P.badgeOn: 달고 있는 휘장의 u. 달고 있는 것 하나만 효과가 있고 별빛을 모은다. */
  var GEM = R.GEM = idx(D.BADGE_GEMS);
  R.BADGE_MAX = 20; R.BADGE_HOLD = 10;
  R.BADGE_XP = { expH: 8, lecH: 3, fight: 6 };
  R.badgeNeed = function (lv) { return Math.floor(40 * Math.pow(1.25, lv - 1)); };
  R.badgeMain = function (b) { var g = GEM[b.gem]; return g ? g.base * (1 + 0.15 * (b.lv - 1)) * (b.q || 1) : 0; };
  R.badgeStats = function (b) { var o = {}, g = GEM[b && b.gem]; if (!g) return o; o[g.bonus] = R.badgeMain(b); (b.aff || []).forEach(function (a) { o[a.id] = (o[a.id] || 0) + a.v; }); return o; };
  R.badgeWorn = function (P) { if (!P || !P.badges || !P.badgeOn) return null; for (var i = 0; i < P.badges.length; i++) if (P.badges[i].u === P.badgeOn) return P.badges[i]; return null; };
  R.badgeFind = function (P, u) { return (P.badges || []).filter(function (b) { return b.u === u; })[0] || null; };
  function badgeFacet(P, b) {
    var pool = D.AFFIXES.filter(function (a) { return a.pct && a.id !== GEM[b.gem].bonus && !b.aff.some(function (x) { return x.id === a.id; }); });
    if (!pool.length) return; var a = pick(P, pool);
    b.aff.push({ id: a.id, v: Math.round((a.pct[0] + (a.pct[1] - a.pct[0]) * rnd(P)) * 0.5 * 10000) / 10000 });
  }
  function badgeName(b) { return (b.aff.length ? AFF[b.aff[0].id].prefix + ' ' : '') + GEM[b.gem].name + ' 휘장'; }
  function makeBadge(P, gem, lv) {
    var g = GEM[gem] || pick(P, D.BADGE_GEMS);
    var b = { u: 'b' + uid(P), gem: g.id, lv: 1, xp: 0, q: Math.round((0.9 + rnd(P) * 0.2) * 1000) / 1000, aff: [] };
    badgeFacet(P, b);
    lv = Math.max(1, Math.min(R.BADGE_MAX, lv || 1)); while (b.lv < lv) { b.lv++; if (D.BADGE_FACET_LV.indexOf(b.lv) >= 0) badgeFacet(P, b); }
    b.name = badgeName(b); return b;
  }
  R.makeBadge = makeBadge;
  // 휘장 받기: 처음 받으면 바로 단다. 보관함이 가득하면 마석가루로 바꿔 준다
  function gainBadge(P, b, t, why) {
    if (!P.badges) P.badges = [];
    if (P.badges.length >= R.BADGE_HOLD) { var d = R.badgeBreakDust(b); P.res.dust = (P.res.dust || 0) + d; log(P, t, '휘장 보관함이 가득해 ' + b.name + '을(를) 마석가루 ' + d + '개로 바꿨습니다', 'news'); return 'dust'; }
    P.badges.push(b); if (!R.badgeWorn(P)) P.badgeOn = b.u;
    log(P, t, (why ? why + ': ' : '') + b.name + '을(를) 받았습니다', 'legend'); return 'got';
  }
  R.gainBadge = gainBadge;
  // 별빛: 달고 있는 휘장만 모은다
  function badgeGain(P, x, t) {
    var b = R.badgeWorn(P); if (!b || !(x > 0) || b.lv >= R.BADGE_MAX) return 0;
    b.xp += x; var ups = 0;
    while (b.lv < R.BADGE_MAX && b.xp >= R.badgeNeed(b.lv)) {
      b.xp -= R.badgeNeed(b.lv); b.lv++; ups++;
      if (D.BADGE_FACET_LV.indexOf(b.lv) >= 0) { badgeFacet(P, b); b.name = badgeName(b); log(P, t, b.name + '에 새 세공이 새겨졌습니다', 'epic'); }
    }
    if (b.lv >= R.BADGE_MAX) b.xp = 0;
    b.xp = Math.round(b.xp * 100) / 100;
    if (ups) log(P, t, b.name + ' ' + b.lv + '레벨' + (b.lv >= R.BADGE_MAX ? ' · 완성!' : ''), 'good');
    return ups;
  }
  R.badgeGain = badgeGain;
  R.badgePolishCost = function (P, b) { return { dust: 10 + b.lv * 4, gold: Math.floor(150 * Math.pow(1.11, Math.max(1, Math.min(P.maxStage, R.stageCap(P))) - 1)) }; };
  R.badgePolishXp = function (b) { return Math.ceil(R.badgeNeed(b.lv) / 4); };
  R.badgeBreakDust = function (b) { return 15 + b.lv * 8 + (b.aff || []).length * 5; };
  // 거래 기준값 (데모 NPC 가격 · 데모 매수 판단용)
  R.badgeValue = function (b) { return Math.floor(2500 * Math.pow(1.35, b.lv - 1) * (1 + (b.aff || []).length * 0.25)); };
  // 휘장 강화는 세 갈래: 닦기(마석가루 + 아르크 → 별빛 · 레벨) · 광내기(별조각 → 보석 품질 q, 대표 효과) · 세공 다시 새기기(별조각 → 옵션 한 줄)
  R.BADGE_Q_MAX = 1.25; R.BADGE_Q_STEP = 0.025;
  R.badgeShineCost = function (b) { return 20 + Math.round(Math.max(0, (b.q || 1) - 0.9) * 400); };
  R.badgeRecutCost = function (b) { return 15 + (b.aff || []).length * 5; };
  /* ───────── 아카데미 친구(NPC): 사람이 적을 때 빈자리를 채운다 (서버 · 데모 공용) ─────────
     함께 원정 동행 · 파티(별의 탑) 동행은 방장(또는 나)의 힘에 이 비율을 곱해 싸운다. 파티 보너스 · 탑 보상 대상에는 들지 않는다. */
  R.NPC_FRAC = { exp: 0.6, tower: 0.3 };
  R.npcCalc = function (c0, f) { var c = {}; for (var k in c0) c[k] = c0[k]; c.totalDps = c0.totalDps * f; c.hp = c0.hp * f; c.def = c0.def * f; return c; };
  // 거래소 NPC 매물 하나: stage = 보는 학생의 진도, wantMat = 재료를 꼭 내놓을 때. 서버는 진도별로 몇 개씩 만들어 seller='NPC 이름', npc=true로 올린다
  R.npcLot = function (stage, wantMat, rand) {
    rand = rand || Math.random; stage = Math.max(1, stage | 0);
    var dm = { rng: (rand() * 2147483647) | 1 }, roll = rand(), x;
    if (!wantMat && roll < 0.12) { var pots = D.POTIONS.filter(function (p) { return p.unlock <= Math.max(3, stage / 3); }), pp = pots[Math.floor(rand() * pots.length)], pq = 1 + Math.floor(rand() * 4), mn = Object.keys(pp.mats).reduce(function (a, k) { return a + pp.mats[k]; }, 0);
      x = { kind: 'pot', pot: pp.id, name: pp.name, qty: pq, price: pq * Math.max(20, Math.round(K.KILL_GOLD * Math.pow(K.G_GOLD, stage) * 25 * mn * (1.4 + rand() * 0.8))) }; }
    else if (!wantMat && roll < 0.2) { var bl = 1 + Math.floor(rand() * Math.min(12, 2 + stage / 6)), bd = makeBadge(dm, null, bl);
      x = { kind: 'badge', badge: bd, name: bd.name + ' Lv ' + bd.lv, gem: bd.gem, lv: bd.lv, qty: 1, price: Math.round(R.badgeValue(bd) * (0.8 + rand() * 0.8)) }; }
    else if (wantMat || roll < 0.4) {
      var z = R.zoneOf(Math.max(1, Math.round(stage * (0.4 + rand() * 0.7)))), qty = 10 + Math.floor(rand() * 40), unit = Math.max(2, Math.round(K.KILL_GOLD * Math.pow(K.G_GOLD, z.from + 5) * 25 * (0.8 + rand() * 0.4)));
      x = { kind: 'mat', mat: z.mat, name: D.MATS[z.mat].name, qty: qty, price: unit * qty };
    } else {
      var ilvl = Math.max(1, Math.round(stage + (rand() * 1.6 - 0.6) * 6)), y = rand(), r = y < 0.45 ? 1 : y < 0.78 ? 2 : y < 0.95 ? 3 : 4;
      var it = makeItem(dm, D.SLOTS[Math.floor(rand() * D.SLOTS.length)].id, ilvl, r, r);
      x = { kind: 'item', item: it, name: it.name, slot: it.slot, r: it.r, ilvl: it.ilvl, qty: 1, price: Math.max(10, Math.round(R.sellPrice(it) * (3 + rand() * 6))) };
    }
    return x;
  };

  /* ───────── 기숙사 대항전 점수 ───────── */
  function cupAdd(P, v) { if (P.wk) P.wk.cup += v; }

  /* ───────── 진행 (advance) ─────────
     P.at부터 now까지 시간을 흘려보낸다. 끝난 작업은 보상을 적용하고 inbox에 보고한다. */
  R.advance = function (P, W, now) {
    if (now <= P.at) return P;
    var t0 = P.at;
    // 끝나는 일을 시간순으로 모은다
    var ev = [];
    lecQ(P);
    // 수업이 끝나면 그 슬롯의 예약 교시가 이어진다 (꿈길 중이면 깨어난 뒤에)
    function qAfter(i, t) {
      var q = P.lecQ[i]; if (!q) return; var at = t; if (P.dream && P.dream.start <= t && P.dream.end > t) at = P.dream.end; q.at = at;
      if (at <= now) ev.push({ t: at, f: function () { var nj = lecQRun(P, W, i, at); if (nj) lecEv(nj, i); } });
    }
    function lecEv(j, i) { if (j.end <= now) ev.push({ t: j.end, f: function () { var o = lecFinish(P, j, j.end, 1, false); P.lec[i] = null; P.lecEnd[i] = j.end; inbox(P, o); qAfter(i, j.end); } }); }
    P.lec.forEach(function (j, i) { if (j) lecEv(j, i); else if (P.lecQ[i] && P.lecQ[i].at && P.lecQ[i].at <= now) { var at = P.lecQ[i].at; ev.push({ t: at, f: function () { var nj = lecQRun(P, W, i, at); if (nj) lecEv(nj, i); } }); } });
    P.exp.forEach(function (j, i) { var te = R.expEnd(j || {}); if (j && te <= now) ev.push({ t: te, f: function () { var fell = te < j.end, o = expFinish(P, j, te, fell ? clamp((te - j.start) / j.dur, 0, 1) : 1, fell ? 'fall' : false); P.exp[i] = null; if (fell) log(P, te, j.s + '단계 원정에서 쓰러져 돌아왔습니다 (모은 것의 80%)', 'bad'); inbox(P, o); } }); });
    P.rsq.forEach(function (q, i) {
      if (q && q.end <= now) ev.push({ t: q.end, f: function () {
        P.rs[q.id] = (P.rs[q.id] || 0) + 1; P.rsq[i] = null; P.st.researchDone++; if (q.end - q.start >= 28800) P.st.nightJobs++;
        if (q.id === 'sorter' && P.autoSell < 0) P.autoSell = 0;
        log(P, q.end, '연구 완료: ' + RES[q.id].name + ' ' + P.rs[q.id] + '단계', 'good'); inbox(P, { k: 'res', id: q.id, lv: P.rs[q.id], t: q.end });
      } });
    });
    P.brew.forEach(function (b) {
      for (var n = b.done; n < b.n; n++) {
        var end = b.start + (n + 1) * b.each; if (end > now) break;
        (function (end) { ev.push({ t: end, f: function () { P.shelf[b.id] = (P.shelf[b.id] || 0) + 1; b.done++; P.st.brews++; cupAdd(P, 8); } }); })(end);
      }
    });
    if (P.fam.egg && P.fam.egg.end <= now) ev.push({ t: P.fam.egg.end, f: function () { var o = hatch(P, P.fam.egg.end); o.k = 'hatch'; o.t = now; inbox(P, o); } });
    if (P.dream && P.dream.end <= now) { var dj = P.dream; ev.push({ t: dj.end, f: function () { var o = dreamFinish(P, dj, dj.end); if (P.dream === dj) P.dream = null; inbox(P, o); } }); }
    Object.keys(P.fam.disp).forEach(function (fid) {
      var d = P.fam.disp[fid]; if (d.end <= now) ev.push({ t: d.end, f: function () { var o = dispatchFinish(P, fid, d, d.end); delete P.fam.disp[fid]; inbox(P, o); } });
    });
    ev.sort(function (a, b) { return a.t - b.t; });
    // 마나는 구간 평균 속도로, 저장 한도까지
    var c = calc(P, W, t0, now);
    if (P.res.mana < c.manaCap) addMana(P, Math.min(c.manaCap - P.res.mana, c.mana * (now - t0)));
    while (ev.length) { ev.sort(function (a, b) { return a.t - b.t; }); ev.shift().f(); }   // 끝난 수업 뒤에 예약 교시가 끼어들 수 있어서 하나씩
    P.brew = P.brew.filter(function (b) { return b.done < b.n; });
    // 만료된 버프 정리
    for (var k in P.buffs) if (P.buffs[k].end <= now) delete P.buffs[k];
    // 월드 보스 도전권
    var wb = P.wb, regen = Math.floor((now - wb.at) / K.WB_TICKET_REGEN);
    if (regen > 0) { wb.tickets = Math.min(K.WB_TICKET_MAX, wb.tickets + regen); wb.at += regen * K.WB_TICKET_REGEN; }
    if (wb.tickets >= K.WB_TICKET_MAX) wb.at = now;
    // 반딧불 정령 병: 40분마다 한 마리씩 모인다 (예전 방식 상태는 바꿔 준다)
    R.spiritJar(P, now);
    P.at = now;
    if (W) { R.ensureWeek(P, W, now); R.ensureDaily(P, now); }
    checkAch(P, now);
    return P;
  };

  R.spiritJar = function (P, now) {
    var sp = P.spirit;
    if (!sp || sp.n == null) sp = P.spirit = { n: 1, at: now };
    var add = Math.floor((now - sp.at) / K.SPIRIT_EVERY);
    if (add > 0) { sp.n = Math.min(K.SPIRIT_JAR, sp.n + add); sp.at += add * K.SPIRIT_EVERY; }
    if (sp.n >= K.SPIRIT_JAR) sp.at = Math.max(sp.at, now);
    return sp;
  };
  R.spiritNext = function (P) { return P.spirit.n >= K.SPIRIT_JAR ? null : P.spirit.at + K.SPIRIT_EVERY; };
  // 양조·부화는 즉시. 효율 보너스는 비용을 줄인다.
  R.brewMana = function (P, W, now, id) { return Math.ceil(POT[id].mana / calc(P, W, now).brewSpd); };
  R.eggPrice = function (P, W, now) { return Math.ceil(R.eggCost(P) / calc(P, W, now).hatchSpd); };

  /* ───────── 주간 · 일일 ───────── */
  R.ensureWeek = function (P, W, now) {
    var w = R.weekId(now);
    if (P.wk.id === w) return;
    if (P.wk.id && (P.wk.cup > 0 || P.wk.att > 0)) P.wkPrev = { id: P.wk.id, cup: P.wk.cup, dmg: P.wk.dmg, att: P.wk.att, house: P.house, claimed: false };
    P.wk = { id: w, cup: 0, dmg: 0, att: 0 };
  };
  R.ensureDaily = function (P, now) {
    var day = R.dayKST(now);
    if (P.daily.day === day) return false;
    P.daily.streak = P.daily.day === day - 1 ? P.daily.streak + 1 : 1;
    if (P.daily.streak > P.st.streak) P.st.streak = P.daily.streak;
    P.daily.day = day; P.daily.login = true; P.daily.rr = 0;
    var pool = D.DAILY.filter(function (d) { return !d.grade || P.grade >= d.grade; }), q = [];
    while (q.length < 3 && pool.length) {
      var d = pool.splice(Math.floor(rnd(P) * pool.length), 1)[0];
      q.push({ type: d.type, name: d.name, goal: d.base, base: P.st[d.type] || 0, done: false });
    }
    P.daily.q = q;
    return true;
  };
  // 의뢰 바꾸기: 하루 1번 무료, 그다음부터 별조각 5·10·20·40
  // 이름 바꾸기: 처음 정한 이름은 한 번 언제든, 바꾼 뒤에는 30일이 지나야 다시 (P.nameAt = 마지막으로 바꾼 시각)
  R.NAME_CD = 30 * 86400;
  R.renameLeft = function (P, t) { return P.nameAt ? Math.max(0, P.nameAt + R.NAME_CD - t) : 0; };
  // 금칙어: 운영진 사칭·욕설·성적인 말. 대소문자·밑줄·숫자 끼워 넣기를 걸러 낸 뒤 포함 여부로 본다 (학생·파티·동아리 이름 공통)
  R.NAME_BAN = ['운영자', '운영진', '관리자', '관리인', '학장', '시스템', '공지', '어드민', 'admin', 'gm', 'system', 'notice', 'staff', 'operator', 'moderator',
    '시발', '씨발', '씨바', '씹', '좆', '존나', '졸라', '병신', '븅신', '빙신', '개새', '개색', '새끼', '미친놈', '미친년', '닥쳐', '꺼져', '엠창', '느금', '니애미', '니미', '애미', '애비', '창녀', '걸레', '보지', '자지', '섹스', '야동', '강간', '장애인', '틀딱', '한남', '김치녀', '일베', '메갈',
    'fuck', 'shit', 'bitch', 'sex', 'porn', 'dick', 'pussy', 'nigger', 'nigga', 'cunt', 'asshole'];
  // 학생 이름: 한글·영문·숫자·_ 2~12자, 단어 사이 띄어쓰기 한 칸까지 (앞뒤 공백·연속 공백은 정리)
  R.NAME_RE = /^(?=.{2,12}$)[가-힣A-Za-z0-9_]+(?: [가-힣A-Za-z0-9_]+)*$/;
  R.NAME_RULE = '이름은 한글·영문·숫자 2~12자만 가능 (단어 사이 띄어쓰기 가능)';
  R.cleanName = function (n) { return String(n == null ? '' : n).replace(/[\s\u3000]+/g, ' ').trim(); };
  // 같은 이름 판정: 대소문자와 띄어쓰기를 무시한다 (「달 빛」과 「달빛」은 같은 이름 → 사칭 방지)
  R.nameKey = function (n) { return R.cleanName(n).toLowerCase().replace(/ /g, ''); };
  R.badName = function (name) {
    var k = String(name || '').toLowerCase().replace(/[\s_0-9]/g, '');
    for (var i = 0; i < R.NAME_BAN.length; i++) { var w = R.NAME_BAN[i]; if (w.length <= 2 && /^[a-z]+$/.test(w) ? k === w : k.indexOf(w) >= 0) return true; }
    return false;
  };
  R.rerollCost = function (P) { var n = P.daily.rr || 0; return n === 0 ? 0 : Math.min(40, 5 * Math.pow(2, n - 1)); };
  // 칭호
  R.titleName = function (P, id) { var t = D.TITLES.find(function (x) { return x.id === id; }); if (!t) return ''; return t.house ? D.HOUSE_TITLE[P.house] || '' : t.name; };
  R.titleOk = function (P, id) {
    var t = D.TITLES.find(function (x) { return x.id === id; }); if (!t) return false;
    if (t.grade) return P.grade >= t.grade || (P.st.maxGrade || 1) >= t.grade;
    if (t.stat) return (P.st[t.stat] || 0) >= t.n;
    return true;
  };
  // 보상 미리보기 (화면에 보여 주는 값과 실제 지급이 같은 식)
  R.dailyReward = function (P) { return { shard: 4 + Math.min(P.grade, 8), gold: Math.floor(300 * K.KILL_GOLD * Math.pow(K.G_GOLD, Math.min(P.maxStage, R.stageCap(P)) - 1)) }; };
  R.loginReward = function (P) { var s = Math.min(P.daily.streak, 7); return { shard: 3 + s * 2, stone: 3 + s }; };
  // 우편 보상 (운영진 우편 · 별의 탑 등). 값은 정수, 너무 큰 값은 잘라 낸다.
  R.MAIL_REWARDS = [['shard', '별조각', 100000], ['gold', CUR, 1e15], ['stone', '마석', 100000], ['mana', '마나', 1e15], ['know', '지식', 1e15], ['egg', '환수의 알', 100], ['ticket', '토벌 도전권', 100], ['gear', '희귀 장비 상자', 50], ['rsDone', '연구 즉시 완료 물약', 100], ['gradeUp', '학년 진급 물약', 10]];   // 물약 두 가지는 운영진 보상 전용 (매점에서 팔지 않음)
  R.cleanRewards = function (o) { var r = {}; o = o || {}; R.MAIL_REWARDS.forEach(function (k) { var v = Math.floor(Number(o[k[0]]) || 0); if (v > 0) r[k[0]] = Math.min(v, k[2]); });
    if (Array.isArray(o.items)) { var its = o.items.filter(function (it) { return it && SLOT[it.slot] && typeof it.name === 'string' && Array.isArray(it.aff) && D.RARITY[it.r]; }).slice(0, 10); if (its.length) r.items = its; }
    return r; };
  R.rewardText = function (r) { return R.MAIL_REWARDS.filter(function (k) { return r && r[k[0]]; }).map(function (k) { return k[1] + ' ' + R.fmt(r[k[0]]); }).concat(r && r.items ? r.items.map(function (it) { return it.name + (it.enh ? ' +' + it.enh : ''); }) : []).join(', '); };
  R.grantMail = function (P, W, now, rw) {
    rw = R.cleanRewards(rw); var out = { items: [] };
    if (rw.shard) P.res.shard += rw.shard; if (rw.gold) addGold(P, rw.gold); if (rw.stone) P.res.stone += rw.stone;
    if (rw.mana) addMana(P, rw.mana); if (rw.know) P.res.know += rw.know; if (rw.egg) P.fam.eggs += rw.egg; if (rw.ticket) P.wb.tickets += rw.ticket;
    if (rw.rsDone || rw.gradeUp) { var tk = P.tok || (P.tok = {}); if (rw.rsDone) tk.rsDone = (tk.rsDone || 0) + rw.rsDone; if (rw.gradeUp) tk.gradeUp = (tk.gradeUp || 0) + rw.gradeUp; }
    for (var i = 0; i < (rw.gear || 0); i++) { var it = makeItem(P, pick(P, D.SLOTS).id, Math.max(1, Math.min(P.maxStage, R.stageCap(P))), Math.max(2, rollRarity(P, 0.6)), 2); out.items.push({ name: it.name, r: it.r, res: gainItem(P, it, now) }); }
    (rw.items || []).forEach(function (it0) { var it = JSON.parse(JSON.stringify(it0)); it.u = uid(P); it.lock = false; out.items.push({ name: it.name, r: it.r, res: gainItem(P, it, now) }); });
    out.text = R.rewardText(rw); return out;
  };
  R.dailyProg = function (P, q) { return Math.min(q.goal, (P.st[q.type] || 0) - q.base); };

  /* ───────── 업적 ───────── */
  function checkAch(P, t) {
    for (var i = 0; i < D.ACH.length; i++) {
      var a = D.ACH[i]; if (P.ach[a.id]) continue;
      if ((P.st[a.stat] || 0) >= a.n) { P.ach[a.id] = t; P.res.shard += a.r; log(P, t, '업적 달성: ' + a.name + ' (별조각 +' + a.r + ')', 'ach'); inbox(P, { k: 'ach', id: a.id, t: t }); }
    }
  }
  R.checkAch = checkAch;

  /* ───────── 전투 시뮬레이션 (보스 · 대련 · 월드 보스) ─────────
     enemy: {hp, atk, boss, name}. 30초 제한. 로그는 재생용으로 압축. */
  function fight(P, c, enemy, limit, untilDead) {
    var dt = 0.1, t = 0, mh = enemy.hp, ph = c.hp, sh = 0, pT = 0, mT = 0, fT = 0, cd = {}, stun = 0, haste = 0, amp = 0, dealt = 0, evs = [];
    var ns = R.spellSlots(P), fam = P.fam.act && P.fam.own[P.fam.act] ? c.atk * famAtkMult(P) : 0;
    function hit(d, kind, cr) {
      if (amp > 0) d *= 2; if (enemy.boss) d *= c.bossDmg;
      mh -= d; dealt += d; if (c.leech) ph = Math.min(c.hp, ph + d * c.leech);
      if (evs.length < 400) evs.push([Math.round(t * 10) / 10, 'h', Math.round(d), kind, cr ? 1 : 0]);
    }
    while (t < limit) {
      t += dt;
      if (haste > 0) haste -= dt; if (amp > 0) amp -= dt;
      pT += dt * c.aps * (haste > 0 ? 2 : 1);
      while (pT >= 1) { pT -= 1; var cr = rnd(P) < c.critC; hit(c.atk * (cr ? c.critD : 1), 'a', cr); }
      if (fam) { fT += dt; if (fT >= 1.5) { fT -= 1.5; hit(fam, 'f', false); } }
      for (var i = 0; i < ns; i++) {
        var sid = P.spells[i], sp = SPELL[sid]; if (!sp || !R.spellUnlocked(P, sid)) continue;
        cd[sid] = (cd[sid] || 0) - dt; if (cd[sid] > 0) continue;
        if (sp.type === 'heal' && ph > c.hp * 0.6) continue;
        if (sp.type === 'shield' && sh > c.hp * 0.1) continue;
        cd[sid] = sp.cd * (1 - c.cdr);
        var lm = spellLvMult(P, sp);
        if (evs.length < 400) evs.push([Math.round(t * 10) / 10, 's', sid]);
        if (sp.type === 'dmg' || sp.type === 'stun') { var cr2 = rnd(P) < c.critC; if (sp.type === 'stun') stun = sp.stun; hit(R.spellHit(c, sp) * sp.mult * lm * (cr2 ? c.critD : 1), 'p', cr2); }
        else if (sp.type === 'shield') sh = c.hp * sp.mult * Math.min(2, lm);
        else if (sp.type === 'heal') ph = Math.min(c.hp, ph + c.hp * sp.mult * Math.min(2, lm));
        else if (sp.type === 'haste') haste = sp.dur;
        else if (sp.type === 'amp') { amp = sp.dur; stun = sp.dur; }
      }
      if (untilDead && mh <= 0) return { win: true, t: t, dealt: dealt, ev: evs, pHp: ph / c.hp, mHp: 0 };
      if (stun > 0) stun -= dt;
      else {
        mT += dt * (enemy.boss ? 0.85 : 1);
        while (mT >= 1) {
          mT -= 1; var d = dmgTaken(enemy.atk, c.def);
          if (sh > 0) { var ab = Math.min(sh, d); sh -= ab; d -= ab; }
          ph -= d; if (evs.length < 400) evs.push([Math.round(t * 10) / 10, 'x', Math.round(d)]);
        }
      }
      ph = Math.min(c.hp, ph + c.hp * c.regen * dt);
      if (ph <= 0) return { win: false, dead: true, t: t, dealt: dealt, ev: evs, pHp: 0, mHp: Math.max(0, mh / enemy.hp) };
    }
    return { win: !untilDead, t: t, dealt: dealt, ev: evs, pHp: ph / c.hp, mHp: Math.max(0, mh / enemy.hp), timeout: true };
  }
  R.fight = fight;

  /* ───────── 별의 탑 (파티 콘텐츠) ─────────
     파티가 함께 한 주 동안 층을 쌓는다. 도전한 학생의 전투를 바탕으로, 파티원 모두의 힘을 합쳐 싸운다.
     층을 처음 넘을 때마다 그때 파티에 있던 학생 모두에게 우편으로 보상. 매주 월요일 0층부터 다시. */
  R.TOWER_TRIES = 3;   // 하루 도전 횟수 (학생마다)
  R.TOWER_FOES = [
    { name: '탑의 문지기 석상', arch: 'golem', c1: '#b8a98a', c2: '#4a4236' }, { name: '별빛 갑옷 기사', arch: 'construct', c1: '#cfd8ff', c2: '#3a4470' },
    { name: '거울 속 쌍둥이', arch: 'wisp', c1: '#d8c8ff', c2: '#3a2a6a' }, { name: '시간을 먹는 올빼미', arch: 'beast', c1: '#c9a26b', c2: '#4a3418' },
    { name: '잿불 수호룡의 그림자', arch: 'eye', c1: '#ff8a5a', c2: '#5a1a08' }, { name: '잊힌 사서의 책', arch: 'book', c1: '#a86a8a', c2: '#2a0a1a' },
    { name: '별샘의 정령왕', arch: 'blob', c1: '#9fe8ff', c2: '#1a4a6a' }
  ];
  // 1층은 그 주에 처음 도전할 때 파티원들의 진도(최고 단계 중간값)보다 조금 아래에서 시작하고, 한 층마다 2단계씩 높아진다
  R.towerBase = function (stages) { var a = stages.slice().sort(function (x, y) { return x - y; }), m = a.length ? a[Math.floor((a.length - 1) / 2)] : 9; return Math.max(1, m - 12); };
  R.towerStage = function (f, base) { return (base || 1) + (f - 1) * 2; };
  R.towerFoe = function (f, base) { var d = D2T(f), s = R.towerStage(f, base); return { id: 'tw' + (f % 7), name: d.name + (f > 7 ? ' ' + toRoman(Math.ceil(f / 7)) : ''), arch: d.arch, c1: d.c1, c2: d.c2, boss: true, hp: R.monHp(s) * K.BOSS_HP * 3, atk: R.monAtk(s) * K.BOSS_ATK * 1.15, stage: s }; };
  function D2T(f) { return R.TOWER_FOES[(f - 1) % R.TOWER_FOES.length]; }
  function toRoman(n) { return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] || String(n); }
  // team: [{dps, hp, def, npc}] — 도전한 학생(c)의 공격 모습에 파티 전체 화력을 싣는다
  R.towerTeam = function (c, team) {
    var dps = 0, hp = 0, def = 0, n = 0;
    team.forEach(function (m) { dps += m.dps; hp += m.hp; def += m.def; n++; });
    var k = dps / Math.max(1e-9, c.totalDps), c2 = {}; for (var key in c) c2[key] = c[key];
    c2.atk = c.atk * k; c2.totalDps = dps; c2.hp = hp * 0.7; c2.def = def / Math.max(1, n);
    return c2;
  };
  R.towerEstimate = function (c2, foe) {
    var ttk = foe.hp / Math.max(1e-9, c2.totalDps), dmg = Math.max(0.001, dmgTaken(foe.atk, c2.def) - c2.hp * c2.regen), ttd = c2.hp / dmg, T = 45;
    return { win: ttk <= Math.min(T, ttd), ttk: ttk, frac: clamp(Math.min(T, ttd) / ttk, 0, 1) };
  };
  R.towerFight = function (P, c2, foe) { return fight(P, c2, { hp: foe.hp, atk: foe.atk, boss: true }, 45, true); };
  R.towerReward = function (f, base) {
    var s = R.towerStage(f, base), r = { shard: Math.min(30, 3 + f), gold: Math.floor(150 * K.KILL_GOLD * Math.pow(K.G_GOLD, s - 1)), stone: 2 + Math.floor(f / 2) };
    if (f % 5 === 0) r.gear = 1; if (f % 10 === 0) r.egg = 1; return r;
  };
  R.towerLeft = function (P, now) { var d = R.dayKST(now), t = P.tw; return !t || t.day !== d ? R.TOWER_TRIES : Math.max(0, R.TOWER_TRIES - t.used); };
  // 파티를 옮겨 다녀도 같은 층 보상을 한 주에 두 번 받지 않게: 학생마다 이번 주에 보상받은 가장 높은 층을 기억한다
  R.towerBest = function (P, now) { var w = R.weekId(now); return P.twr && P.twr.week === w ? P.twr.best : 0; };
  R.towerClaim = function (P, now, f) { var w = R.weekId(now); if (!P.twr || P.twr.week !== w) P.twr = { week: w, best: 0 }; if (f <= P.twr.best) return false; P.twr.best = f; return true; };
  R.towerUse = function (P, now) { var d = R.dayKST(now); if (!P.tw || P.tw.day !== d) P.tw = { day: d, used: 0 }; P.tw.used++; };
  /* 별의 탑 전투 일지: 원정 일지처럼 한 줄씩 흘러가는 대본. 파티원 모두가 같은 대본을 같은 시각에 본다.
     전투 기록(ev)에서 주문·치명타·반격·체력 고비를 골라 줄로 만들고, 파티원들이 거드는 장면을 섞는다.
     줄 = [시각(초, 대본 시작 기준), 글, 종류('s'=시작·끝, 'h'=내 공격, 'p'=주문, 'x'=적의 공격, 't'=파티원, 'm'=고비)] */
  R.TOWER_SCRIPT_MAX = 30; R.TOWER_SCRIPT_MIN = 14;   // 대본은 실제로 14~30초 동안 흐른다 (짧은 싸움은 천천히, 긴 싸움은 빠르게)
  function jo(w, a, b) { var c = String(w).charCodeAt(String(w).length - 1); return w + ((c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28) ? a : b); }
  var TW_HELP = ['{n}{이} 앞으로 나서 방패 주문을 펼친다', '{n}{이} 뒤에서 마나를 모아 보탠다', '{n}의 주문이 겹쳐 터진다', '{n}{이} 적의 시선을 끌며 옆으로 돈다', '{n}{이} 쓰러질 뻔한 동료를 붙잡아 세운다', '{n}{이} 짧게 외친다. “지금이야!”'];
  R.towerScript = function (o) {
    // o: { name, f, foe, team:[{name,me,npc}], r(전투 결과), hp(파티 생명력) }
    var r = o.r, ev = r.ev || [], T = Math.max(1, Math.min(45, r.t || 45)), k = Math.min(R.TOWER_SCRIPT_MAX, Math.max(R.TOWER_SCRIPT_MIN, T)) / T, L = [], foe = o.foe;
    function add(t, text, kind) { L.push([Math.round(t * k * 10) / 10, text, kind]); }
    var mates = o.team.filter(function (m) { return !m.me; });
    add(0, jo(o.name, '이', '가') + ' 별의 탑 ' + o.f + '층 문을 연다. ' + (mates.length ? '파티원 ' + (mates.length + 1) + '명의 힘이 한데 실린다.' : '혼자서 오른다.'), 's');
    add(0.05, jo(foe.name, '이', '가') + ' 모습을 드러낸다.', 'x');
    var dealt = 0, taken = 0, marks = [0.75, 0.5, 0.25], mi = 0, spells = {}, bigCrit = null, hurt = [], firstHit = null;
    ev.forEach(function (e) {
      if (e[1] === 'h') {
        dealt += e[2]; if (!firstHit) firstHit = e;
        if (e[4] && (!bigCrit || e[2] > bigCrit[2])) bigCrit = e;
        while (mi < marks.length && 1 - dealt / foe.hp <= marks[mi]) { var left = Math.round(marks[mi] * 100); add(e[0], foe.name + ' 체력 ' + left + '%. ' + (left === 25 ? '숨이 거칠어진다.' : left === 50 ? '갑옷에 금이 간다.' : '몸이 휘청인다.'), 'm'); mi++; }
      } else if (e[1] === 's') { var sp = SPELL[e[2]]; if (sp && !spells[e[2]]) { spells[e[2]] = 1; add(e[0], o.name + '의 「' + sp.name + '」!', 'p'); } }
      else if (e[1] === 'x') { taken += e[2]; hurt.push(e); }
    });
    if (firstHit) add(Math.max(0.5, firstHit[0]), '첫 공격 — ' + R.fmt(firstHit[2]) + ' 피해', 'h');
    if (bigCrit && bigCrit !== firstHit) add(bigCrit[0], '치명타! ' + R.fmt(bigCrit[2]) + ' 피해', 'h');
    // 적의 반격: 가장 아픈 한 방과, 파티 생명력이 반 넘게 깎인 순간
    if (hurt.length) { var worst = hurt.reduce(function (a, b) { return b[2] > a[2] ? b : a; }); add(worst[0], foe.name + '의 반격 — ' + R.fmt(worst[2]) + ' 피해', 'x'); }
    var acc = 0, halfAt = null; hurt.forEach(function (e) { acc += e[2]; if (halfAt == null && acc > o.hp * 0.5) halfAt = e[0]; });
    if (halfAt != null && !r.dead) add(halfAt, '파티가 크게 흔들린다. 다들 이를 악문다.', 'x');
    // 파티원들이 거드는 장면: 전투 시간에 고르게
    var end = r.win ? r.t : r.dead ? r.t : 45, pool = TW_HELP.slice();
    // 중간 점검: 그때까지 쌓인 피해
    [0.45, 0.8].forEach(function (q) { var at = end * q, sum = 0; ev.forEach(function (e) { if (e[1] === 'h' && e[0] <= at) sum += e[2]; }); if (sum > 0 && sum < foe.hp) add(at, '지금까지 입힌 피해 ' + R.fmt(sum) + ' / ' + R.fmt(foe.hp), 'h'); });
    mates.slice(0, 5).forEach(function (m, i) { var j = Math.floor(Math.random() * pool.length), line = pool.splice(j, 1)[0] || TW_HELP[0]; if (!pool.length) pool = TW_HELP.slice(); var nm = m.name; add(end * (i + 1) / (mates.length + 1.4), line.replace('{n}{이}', jo(nm, '이', '가')).replace('{n}', nm), 't'); });
    if (r.win) add(end, '✦ ' + jo(foe.name, '이', '가') + ' 무너진다! ' + o.f + '층 돌파 (' + end.toFixed(1) + '초)', 's');
    else if (r.dead) add(end, '파티가 버티지 못하고 물러난다. ' + foe.name + ' 체력 ' + Math.round(r.mHp * 100) + '% 남음', 's');
    else add(end, '시간이 다 되었다. ' + foe.name + ' 체력 ' + Math.round(r.mHp * 100) + '% 남음 — 다음에 다시', 's');
    L.sort(function (a, b) { return a[0] - b[0]; });
    if (L.length > 18) { var keep = L.filter(function (x) { return x[2] === 's' || x[2] === 'm'; }), rest = L.filter(function (x) { return x[2] !== 's' && x[2] !== 'm'; }); L = keep.concat(rest.slice(0, 18 - keep.length)).sort(function (a, b) { return a[0] - b[0]; }); }
    return { lines: L, d: Math.round((end * k + 1.5) * 10) / 10 };
  };

  /* ───────── 동아리: 레벨 · 기여도 · 계급 · 창고 ─────────
     기여도: 하루 한 번 출석(+10), 아르크 기부(내 진도 기준 환산, 하루 최대 200점). 기여도가 곧 동아리 경험치.
     계급: 회장 · 부회장(고정) + 부원 계급 최대 3개(이름과 권한을 회장이 정한다) + 기본 「부원」. */
  R.GUILD_MAX_LV = 10;
  R.guildXpNeed = function (lv) { return Math.floor(400 * Math.pow(1.65, lv - 1)); };
  R.guildCap = function (lv) { return 28 + 2 * (lv || 1); };          // 정원: 1레벨 30명 … 10레벨 48명
  R.guildSlots = function (lv) { return 20 + 5 * (lv || 1); };        // 창고 장비 칸
  R.guildBonus = function (lv) { return 0.005 * (lv || 0); };          // 부원 모두 아르크·경험치 +0.5%/레벨
  R.GUILD_PERMS = [['invite', '초대·가입 승인'], ['kick', '부원 내보내기'], ['notice', '공지·소개 고치기'], ['take', '창고에서 꺼내기']];
  R.GUILD_RANKS_MAX = 3; R.GUILD_CHECKIN = 10; R.GUILD_DONATE_CAP = 200;
  R.guildDefRanks = function () { return { base: { name: '부원', perms: {} }, list: [] }; };
  R.guildCleanRanks = function (o) {
    var out = R.guildDefRanks(); o = o || {};
    function nm(v, d) { v = String(v == null ? '' : v).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 8); return v || d; }
    function pm(x) { var r = {}; R.GUILD_PERMS.forEach(function (k) { if (x && x[k[0]]) r[k[0]] = true; }); return r; }
    if (o.base) out.base = { name: nm(o.base.name, '부원'), perms: pm(o.base.perms) };
    (Array.isArray(o.list) ? o.list : []).slice(0, R.GUILD_RANKS_MAX).forEach(function (x, i) { if (x && String(x.name || '').trim()) out.list.push({ id: /^r[1-9]$/.test(x.id) ? x.id : 'r' + (i + 1), name: nm(x.name, '계급' + (i + 1)), perms: pm(x.perms) }); });
    var seen = {}; out.list = out.list.filter(function (x) { if (seen[x.id]) return false; seen[x.id] = 1; return true; });
    return out;
  };
  // 이 부원이 할 수 있는 일 (role: owner|officer|member, rank: '' 또는 r1~r3)
  R.guildCan = function (ranks, role, rank, perm) {
    if (role === 'owner' || role === 'officer') return true;
    if (role !== 'member') return false;
    ranks = ranks || R.guildDefRanks(); var r = (ranks.list || []).find(function (x) { return x.id === rank; }) || ranks.base || {};
    return !!(r.perms && r.perms[perm]);
  };
  R.guildRankName = function (ranks, role, rank) {
    if (role === 'owner') return '회장'; if (role === 'officer') return '부회장';
    ranks = ranks || R.guildDefRanks(); var r = (ranks.list || []).find(function (x) { return x.id === rank; });
    return r ? r.name : (ranks.base && ranks.base.name) || '부원';
  };
  // 아르크 기부를 기여도로 바꾸는 단위: 일일 목표 아르크 보상의 1/20 = 1점 (진도가 달라도 공평하게)
  R.guildGoldUnit = function (P) { return Math.max(1, Math.floor(R.dailyReward(P).gold / 20)); };
  // 경험치를 더하고 레벨을 올린다. g: {lv, xp}
  R.guildAddXp = function (g, x) { g.xp += x; var ups = 0; while (g.lv < R.GUILD_MAX_LV && g.xp >= R.guildXpNeed(g.lv)) { g.xp -= R.guildXpNeed(g.lv); g.lv++; ups++; } if (g.lv >= R.GUILD_MAX_LV) g.xp = Math.min(g.xp, R.guildXpNeed(g.lv)); return ups; };

  /* ───────── 시험 ───────── */
  R.examFor = function (P) { return D.EXAMS[P.grade - 1] || null; };
  R.eligMin = function (ex) { return ex.req; };
  R.examEligible = function (P, ex) { return ex.subj.every(function (s) { return P.subj[s].lv >= R.eligMin(ex); }); };
  R.examPractical = function (P, ex) {
    // 응시 기준(모든 과목 req)을 채우면 25점, 평균이 req+4에 가까울수록 최대 40점
    var avg = 0, minr = 1; ex.subj.forEach(function (sid) { avg += P.subj[sid].lv / ex.subj.length; minr = Math.min(minr, P.subj[sid].lv / ex.req); });
    if (minr < 1) return 25 * clamp(minr, 0, 1);
    return 25 + 15 * clamp((avg - ex.req) / 4, 0, 1);
  };
  R.duelEnemy = function (stage, hpM, atkM) { return { hp: R.monHp(stage) * (hpM || 5), atk: R.monAtk(stage) * (atkM || 1.4), boss: true }; };
  R.duelPreview = function (P, W, stage, hpM, atkM, t) {
    var c = calc(P, W, t || P.at), e = R.duelEnemy(stage, hpM, atkM);
    var pd = c.totalDps, ed = Math.max(0.001, dmgTaken(e.atk, c.def) - c.hp * c.regen), shield = 0;
    P.spells.forEach(function (sid) { var sp = SPELL[sid]; if (sp && R.spellUnlocked(P, sid) && (sp.type === 'shield' || sp.type === 'heal')) shield += c.hp * sp.mult * (sp.type === 'shield' ? 3 : 2); });
    var ttk = e.hp / pd, ttd = (c.hp + shield) / ed, T = 45, win = ttk <= Math.min(T, ttd);
    return { win: win, frac: win ? 1 : clamp(Math.min(T, ttd) * pd / e.hp, 0, 1), ttk: ttk, ttd: ttd };
  };
  R.letter = function (s) { return s >= 95 ? 'S' : s >= 85 ? 'A' : s >= 75 ? 'B' : s >= 60 ? 'C' : 'F'; };
  // 등급별 합격 보상 (화면 표와 실제 지급이 같은 표). 합격하면 바로 다음 학년이라 같은 시험은 다시 볼 수 없다.
  R.EXAM_REWARD = {
    S: { mult: 2, minR: 3, egg: 1, text: '별조각·' + CUR + ' 2배 · 영웅 이상 장비 · 환수의 알' },
    A: { mult: 1.5, minR: 2, egg: 0, text: '별조각·' + CUR + ' 1.5배 · 희귀 이상 장비' },
    B: { mult: 1.2, minR: 1, egg: 0, text: '별조각·' + CUR + ' 1.2배' },
    C: { mult: 1, minR: 1, egg: 0, text: '기본 보상' }
  };
  // 지금 보면 몇 점·몇 등급인지, 시험 과목을 모두 몇 레벨씩 더 올리면 A·S가 되는지 (대련은 지금 전투력 그대로로 어림)
  R.examPredict = function (P, W, t) {
    var ex = R.examFor(P); if (!ex || P.grade >= 8) return null;
    var c = calc(P, W, t || P.at), du = R.duelPreview(P, W, ex.duel, null, null, t), duel = du.win ? 30 : 30 * du.frac * 0.85, bonus = c.examBonus || 0;
    // 아직 자격이 없으면 모든 시험 과목이 기준 레벨이 됐을 때로 어림한다
    function tot(n) { var sj = {}; ex.subj.forEach(function (k) { sj[k] = { lv: Math.max(P.subj[k].lv, ex.req) + n }; }); var Q = { subj: sj }; return Math.round(R.examTheory(Q, ex) + R.examPractical(Q, ex) + duel + bonus); }
    function need(min) { for (var n = 0; n <= 12; n++) if (tot(n) >= min) return n; return -1; }
    var total = tot(0);
    return { th: R.examTheory(P, ex), pr: R.examPractical(P, ex), duel: duel, duelWin: du.win, bonus: bonus, total: total, letter: R.letter(total), toS: need(95), toA: need(85) };
  };

  /* ───────── 결투제 ───────── */
  R.rival = function (P) { return D.RIVALS[P.duel.rank] || null; };
  R.rivalPreview = function (P, W) { var r = R.rival(P); return r ? R.duelPreview(P, W, r.stage, 4, 1.3) : null; };

  /* ───────── 교수님의 과제 ───────── */
  R.taskOf = function (P, sid) { var i = P.tasks[sid] || 0, t = D.TASKS[sid] && D.TASKS[sid][i]; return t ? { i: i, t: t } : null; };
  R.taskProg = function (P, sid, t) { return t.k === 'subj' ? P.subj[sid].lv : t.k === 'stage' ? P.st.maxStageAll : (P.st[t.s] || 0); };

  /* ───────── 상점 ───────── */
  R.shopPrice = function (P, id) {
    var s = SHOP[id];
    if (s.price === 'stone') return Math.floor(400 * Math.pow(1.11, P.maxStage - 1));
    if (s.price === 'gearbox') return Math.floor(500 * Math.pow(1.11, P.maxStage - 1));
    if (s.price === 'bag') return 20 + P.bagExtra * 4;
    return s.price;
  };

  /* ───────── 월드 보스 ───────── */
  R.wbBoss = function (W) { var w = R.weekId(W.now || 0); return D.WORLD_BOSSES[w % D.WORLD_BOSSES.length]; };
  R.wbEnemy = function (P) { var s = Math.max(10, Math.min(P.maxStage, R.stageCap(P)) + 2); return { hp: Infinity, atk: R.monAtk(s) * 1.5, boss: true }; };

  /* ───────── 액션 (서버가 검증·실행) ─────────
     act(P, W, now, type, a) → 결과 객체. 실패하면 game 오류를 던진다.
     W: { epoch, now, wbAlive, results:{weekId:{...}} } */
  var A = {};
  function needSlot(arr, i, n) { if (!(i >= 0 && i < n)) err('잘못된 슬롯입니다'); }
  function str(v, max) { if (typeof v !== 'string' || !v || v.length > (max || 40)) err('잘못된 요청입니다'); return v; }
  function int(v, a, b) { v = Number(v); if (!isFinite(v) || Math.floor(v) !== v || v < a || v > b) err('잘못된 숫자입니다'); return v; }

  /* 수업 예약 · 제때 입실 · 시간표 프리셋
     예약: 수업 중인 슬롯마다 다음 교시 하나. 종이 울리면 저절로 시작한다(꿈길 중이면 깨어난 뒤에).
     제때 입실: 수업이 끝나고 15분 안에 바로 들으면 과목 경험치 +10% (저절로 시작한 예약 교시는 없음). */
  R.ONTIME_WIN = 900; R.ONTIME_BONUS = 0.1; R.TT_MAX = 3;
  function lecQ(P) { if (!P.lecQ) P.lecQ = [null, null, null]; if (!P.lecEnd) P.lecEnd = [0, 0, 0]; return P.lecQ; }
  R.lecQ = lecQ;
  R.onTime = function (P, i, now) { lecQ(P); var e = P.lecEnd[i] || 0; return !P.lec[i] && e > 0 && now >= e && now - e <= R.ONTIME_WIN; };
  function lecMake(P, W, i, sid, dk, now, peers, ontime) {
    var d = DUR[dk], pv = R.lecPreview(P, W, sid, d.k, now), pb = R.peerBonus(peers || 0), ob = ontime ? R.ONTIME_BONUS : 0;
    P.lec[i] = { s: sid, start: now, end: now + d.s, dur: d.s, eff: d.eff, xp: pv.xp * (1 + pb + ob), know: pv.know, peers: peers || 0, pb: pb, ontime: !!ontime };
    return P.lec[i];
  }
  function lecCheck(P, W, now, i, sid, dk) {
    var c = calc(P, W, now); needSlot(P.lec, i, c.lecSlots); if (!DUR[dk]) err('잘못된 시간입니다');
    if (!SUBJ[sid] || SUBJ[sid].unlock > Math.min(P.grade, 7)) err('아직 들을 수 없는 과목입니다');
    if (!R.subjVisible(P, SUBJ[sid])) err('다른 학과의 전용 수업입니다');
  }
  A.lecStart = function (P, W, now, a) {
    if (R.dreaming(P, now)) err('꿈길 중에는 수업을 들을 수 없습니다 (연구를 시작할 수 있습니다)');
    var i = int(a.slot, 0, 2), sid = str(a.s), dk = str(a.d); lecCheck(P, W, now, i, sid, dk);
    if (P.lec[i]) err('이미 수업 중인 슬롯입니다');
    if (P.lec.some(function (l) { return l && l.s === sid; })) err('같은 과목을 동시에 들을 수 없습니다');
    var on = R.onTime(P, i, now), j = lecMake(P, W, i, sid, dk, now, W && W.lecPeers ? (W.lecPeers[sid] || 0) : 0, on);
    P.lecEnd[i] = 0;
    return { ok: true, ontime: on };
  };
  // 다음 교시 예약 (s를 비우면 예약 취소)
  A.lecQueue = function (P, W, now, a) {
    var i = int(a.slot, 0, 2); lecQ(P);
    if (!a.s) { P.lecQ[i] = null; return { ok: true }; }
    var sid = str(a.s), dk = str(a.d); lecCheck(P, W, now, i, sid, dk);
    if (!P.lec[i]) err('빈 슬롯은 바로 수업 시작 가능');
    P.lecQ[i] = { s: sid, d: dk }; return { ok: true };
  };
  // 예약 교시 시작 (advance 안에서)
  function lecQRun(P, W, i, at) {
    var q = lecQ(P)[i]; if (!q || P.lec[i]) return null; P.lecQ[i] = null;
    if (!SUBJ[q.s] || SUBJ[q.s].unlock > Math.min(P.grade, 7) || !R.subjVisible(P, SUBJ[q.s]) || !DUR[q.d] || i >= calc(P, W, at).lecSlots) return null;
    if (P.lec.some(function (l) { return l && l.s === q.s; })) { log(P, at, '예약한 ' + SUBJ[q.s].name + ' 수업은 다른 슬롯에서 듣고 있어 시작하지 않았습니다', 'bad'); return null; }
    var j = lecMake(P, W, i, q.s, q.d, at, 0, false); j.auto = true; P.lecEnd[i] = 0;
    log(P, at, '예약한 ' + SUBJ[q.s].name + ' 수업이 시작되었습니다', 'news');
    return j;
  }
  // 시간표 프리셋: 슬롯마다 과목 + 수업 길이. 적용하면 빈 슬롯은 바로 시작, 수업 중인 슬롯은 다음 교시로 예약
  A.ttSave = function (P, W, now, a) {
    var k = int(a.k, 0, R.TT_MAX - 1), name = String(a.name || '').replace(/\s+/g, ' ').trim().slice(0, 12) || ('시간표 ' + (k + 1)), dk = str(a.d);
    if (!DUR[dk]) err('잘못된 시간입니다');
    var ss = (Array.isArray(a.s) ? a.s : []).slice(0, 3).map(function (x) { return SUBJ[x] ? x : null; });
    if (!ss.some(Boolean)) err('과목 1개 이상 선택 필요');
    if (!P.tt) P.tt = []; P.tt[k] = { name: name, s: ss, d: dk }; return { ok: true };
  };
  A.ttDel = function (P, W, now, a) { var k = int(a.k, 0, R.TT_MAX - 1); if (P.tt) P.tt[k] = null; return { ok: true }; };
  A.ttApply = function (P, W, now, a) {
    var k = int(a.k, 0, R.TT_MAX - 1), t = P.tt && P.tt[k]; if (!t) err('비어 있는 시간표입니다');
    var c = calc(P, W, now), out = { started: 0, queued: 0, skip: 0, ontime: 0 }, dream = R.dreaming(P, now); lecQ(P);
    for (var i = 0; i < Math.min(3, c.lecSlots); i++) {
      var sid = t.s[i]; if (!sid || !SUBJ[sid] || SUBJ[sid].unlock > Math.min(P.grade, 7) || !R.subjVisible(P, SUBJ[sid])) { if (sid) out.skip++; continue; }
      if (P.lec[i]) { P.lecQ[i] = { s: sid, d: t.d }; out.queued++; continue; }
      if (dream || P.lec.some(function (l) { return l && l.s === sid; })) { out.skip++; continue; }
      var on = R.onTime(P, i, now); lecMake(P, W, i, sid, t.d, now, W && W.lecPeers ? (W.lecPeers[sid] || 0) : 0, on); P.lecEnd[i] = 0; out.started++; if (on) out.ontime++;
    }
    return out;
  };
  A.lecCancel = function (P, W, now, a) {
    var i = int(a.slot, 0, 2), j = P.lec[i]; if (!j) err('진행 중인 수업이 없습니다');
    var o = lecFinish(P, j, now, clamp((now - j.start) / j.dur, 0, 1), true); P.lec[i] = null; return o;
  };
  // 운영진 보상 물약 (우편으로만 받는다)
  // 연구 즉시 완료: 진행 중인 연구 하나를 바로 끝낸다
  A.useRsDone = function (P, W, now, a) {
    var i = int(a.slot, 0, 1), q = P.rsq[i]; if (!q) err('진행 중인 연구가 없습니다');
    var tk = P.tok || {}; if (!(tk.rsDone > 0)) err('연구 즉시 완료 물약이 없습니다');
    tk.rsDone--; q.end = now;
    P.rs[q.id] = (P.rs[q.id] || 0) + 1; P.rsq[i] = null; P.st.researchDone++;
    if (q.id === 'sorter' && P.autoSell < 0) P.autoSell = 0;
    log(P, now, '연구 즉시 완료 물약: ' + RES[q.id].name + ' ' + P.rs[q.id] + '단계 완료', 'good');
    return { ok: true, id: q.id, lv: P.rs[q.id] };
  };
  // 학년 진급: 시험 없이 한 학년 올린다 (성적표에는 남지 않음, 시험 보상 없음)
  A.useGradeUp = function (P, W, now) {
    var tk = P.tok || {}; if (!(tk.gradeUp > 0)) err('학년 진급 물약이 없습니다');
    if (P.grade >= 8) err('이미 마스터 과정입니다');
    tk.gradeUp--; P.grade++; if (P.grade > P.st.maxGrade) P.st.maxGrade = P.grade;
    log(P, now, '학년 진급 물약을 마시고 ' + (P.grade >= 8 ? '마스터 과정' : P.grade + '학년') + '이 되었습니다', 'story');
    R.fixState(P); return { ok: true, grade: P.grade };
  };
  A.ackEcon = function (P) { P.econC = 2; return { ok: true }; };
  A.setCls = function (P, W, now, a) {
    var id = str(a.cls); if (!R.CLS[id]) err('학과 선택 필요');
    if ((P.cls || 'mage') === id) err('지금 학과와 같습니다');
    if (!R.clsCanChange(P)) err('학과를 바꾸려면 전과시험을 봐야 합니다');
    clsSet(P, id, now); return { ok: true };
  };
  // 전과시험: 옮기려는 학과의 몸으로 시험관과 대련해 이기면 옮긴다. 응시료는 이기든 지든 내고, 지면 하루 뒤 다시
  A.clsExam = function (P, W, now, a) {
    var id = str(a.cls); if (!R.CLS[id]) err('학과 선택 필요');
    if ((P.cls || 'mage') === id) err('지금 학과와 같습니다');
    if (!P.cls) err('아직 학과를 고르지 않았습니다. 시험 없이 한 번 고를 수 있습니다');
    if ((P.clsCd || 0) > now) err('전과시험은 ' + R.fmtTime(P.clsCd - now) + ' 뒤에 다시 볼 수 있습니다');
    var fee = R.clsExamFee(P); if (P.res.gold < fee) err('응시료가 모자랍니다 (' + fee + ' ' + R.CUR + ')');
    P.res.gold -= fee;
    var old = P.cls; P.cls = id; var c = calc(P, W, now), e = R.clsExamFoe(P, W), f = fight(P, c, e, 40, true); P.cls = old;
    if (f.win) clsSet(P, id, now, '전과시험 합격'); else { P.clsCd = now + R.CLS_EXAM_CD; log(P, now, R.CLS[id].name + ' 전과시험 불합격', 'bad'); }
    return { win: !!f.win, ev: f.ev, maxHp: e.hp, mHp: f.mHp, cls: id, fee: fee };
  };
  A.expStart = function (P, W, now, a) {
    if (R.dreaming(P, now)) err('꿈길 중에는 출정할 수 없습니다 (연구를 시작할 수 있습니다)');
    var c = calc(P, W, now), i = int(a.slot, 0, 1), s = int(a.s, 1, 100000), d = DUR[str(a.d)];
    needSlot(P.exp, i, c.expSlots); if (!d) err('잘못된 시간입니다');
    if (P.exp[i]) err('이미 원정 중인 슬롯입니다');
    if (s > P.maxStage || s > R.stageCap(P)) err('아직 갈 수 없는 단계입니다');
    if (R.isBoss(s)) err('보스 단계는 보스 도전으로만 갈 수 있습니다');
    var pv = R.expPreview(P, W, s, d.k, now);
    var j = P.exp[i] = { s: s, start: now, end: now + d.s, dur: d.s, eff: d.eff, kps: pv.kps, gEach: pv.gEach, xEach: pv.xEach, drop: pv.drop, rarity: pv.rarity, killMana: pv.killMana, risk: pv.risk };
    var fa = fallAt(P, now, d.s, pv.risk); if (fa) j.fallAt = fa;
    // 전리품은 떠날 때 미리 정해 둔다 (원정 일지에 언제 무엇을 주웠는지 그대로 보여 주려고). 실제로 받는 건 돌아올 때.
    var kills = Math.floor(j.kps * j.dur * j.eff + 0.5), n = Math.floor(kills * K.ITEM_RATE * j.drop + rnd(P)), made = Math.min(n, 12);
    j.nItems = n; j.loot = [];
    for (var q = 0; q < made; q++) j.loot.push({ at: Math.floor(now + d.s * (q + 0.3 + rnd(P) * 0.6) / made), it: makeItem(P, pick(P, D.SLOTS).id, s, rollRarity(P, j.rarity)) });
    return { ok: true };
  };
  A.expCancel = function (P, W, now, a) {
    var i = int(a.slot, 0, 1), j = P.exp[i]; if (!j) err('진행 중인 원정이 없습니다');
    var o = expFinish(P, j, now, clamp((now - j.start) / j.dur, 0, 1), 'recall'); P.exp[i] = null; log(P, now, j.s + '단계 원정에서 직접 귀환했습니다', 'news'); return o;
  };
  A.boss = function (P, W, now) {
    if (P.bossCd > now) err('아직 재도전할 수 없습니다');
    if (!R.canChallenge(P)) err('학년이나 레벨을 올려야 다음 보스에 도전할 수 있습니다');
    var b = R.nextBoss(P), z = R.zoneOf(b), def = z.boss, c = calc(P, W, now);
    var e = { hp: R.monHp(b) * K.BOSS_HP, atk: R.monAtk(b) * K.BOSS_ATK, boss: true };
    var f = fight(P, c, e, K.BOSS_TIME, true);
    P.st.bossTries++;
    var out = { win: f.win, stage: b, boss: def.id, name: def.name, ev: f.ev, t: f.t, mHp: f.mHp, pHp: f.pHp, dead: !!f.dead, maxHp: e.hp };
    badgeGain(P, R.BADGE_XP.fight * (f.win ? 2 : 1), now);
    if (f.win) {
      P.maxStage = b + 9; if (P.maxStage > P.st.maxStageAll) P.st.maxStageAll = P.maxStage;
      P.bossWins[b] = (P.bossWins[b] || 0) + 1; P.st.bosses++;
      P.codex[def.id] = (P.codex[def.id] || 0) + 1;
      var sh = 5 + Math.floor(b / 10) * 2; P.res.shard += sh; out.shard = sh;
      var st = ri(P, 3, 6) + Math.floor(b / 10); P.res.stone += st; out.stone = st;
      var it = makeItem(P, pick(P, D.SLOTS).id, b + 2, rollRarity(P, c.rarity + 0.8), 2); out.item = { name: it.name, r: it.r, res: gainItem(P, it, now) };
      if (P.grade >= 3 && rnd(P) < 0.35) { P.fam.eggs++; out.egg = 1; }
      if (rnd(P) < 0.06) { var bd = makeBadge(P); if (gainBadge(P, bd, now, def.name + '의 전리품') === 'got') out.badge = bd.name; }
      cupAdd(P, 50);
      log(P, now, def.name + ' 처치! ' + (b + 1) + '~' + (b + 9) + '단계가 열렸습니다', 'story');
      var zn = R.zoneOf(b + 1); if (zn.from === b + 1) log(P, now, '새로운 지역 발견: ' + zn.name, 'story');
    } else { P.bossCd = now + K.BOSS_CD; log(P, now, def.name + '에게 패배했습니다 (' + Math.round((1 - f.mHp) * 100) + '%)', 'bad'); }
    return out;
  };
  A.resStart = function (P, W, now, a) {
    var id = str(a.id), r = RES[id], c = calc(P, W, now);
    if (!r || !R.resAvailable(P, id)) err('연구할 수 없습니다');
    if (R.resQueued(P, id)) err('이미 연구 중입니다');
    var lv = P.rs[id] || 0; if (lv >= r.max) err('최대 단계입니다');
    var i = -1; for (var k = 0; k < c.resSlots; k++) if (!P.rsq[k]) { i = k; break; }
    if (i < 0) err('연구 자리가 비어 있지 않습니다');
    var cost = R.resCost(P, id); if (P.res.mana < cost.mana || P.res.know < cost.know) err('마나나 지식이 부족합니다');
    P.res.mana -= cost.mana; P.res.know -= cost.know;
    P.rsq[i] = { id: id, start: now, end: now + cost.time, mana: cost.mana, know: cost.know };
    return { ok: true };
  };
  A.resCancel = function (P, W, now, a) {
    var i = int(a.slot, 0, 1), q = P.rsq[i]; if (!q) err('진행 중인 연구가 없습니다');
    P.res.mana += Math.floor(q.mana * 0.5); P.res.know += Math.floor(q.know * 0.5); P.rsq[i] = null;
    return { ok: true, refund: 0.5 };
  };
  A.brew = function (P, W, now, a) {
    var id = str(a.id), n = int(a.n || 1, 1, 20), p = POT[id];
    if (!p || !R.potionUnlocked(P, id)) err('아직 만들 수 없는 물약입니다');
    var mana = R.brewMana(P, W, now, id);
    if (P.res.mana < mana * n) err('마나가 부족합니다');
    for (var m in p.mats) if ((P.mats[m] || 0) < p.mats[m] * n) err('재료가 부족합니다');
    P.res.mana -= mana * n; for (var m2 in p.mats) P.mats[m2] -= p.mats[m2] * n;
    P.shelf[id] = (P.shelf[id] || 0) + n; P.st.brews += n; cupAdd(P, 8 * n);
    return { id: id, n: n, mana: mana * n };
  };
  A.brewCancel = function (P, W, now, a) {
    var i = int(a.i, 0, 5), b = P.brew[i]; if (!b) err('가마솥이 비어 있습니다');
    var p = POT[b.id], left = b.n - b.done;
    P.res.mana += p.mana * left; for (var m in p.mats) P.mats[m] = (P.mats[m] || 0) + p.mats[m] * left;
    P.brew.splice(i, 1); return { ok: true };
  };
  A.drink = function (P, W, now, a) {
    var id = str(a.id), p = POT[id]; if (!p || !P.shelf[id]) err('물약이 없습니다');
    P.shelf[id]--; var cur = P.buffs['p_' + id];
    var start = cur && cur.end > now ? cur.start : now, end = Math.min((cur && cur.end > now ? cur.end : now) + p.dur, now + p.dur * 3);
    P.buffs['p_' + id] = { name: p.name, eff: p.eff, start: start, end: end, color: p.color };
    return { ok: true };
  };
  A.equip = function (P, W, now, a) {
    var u = str(a.u), i = P.inv.findIndex(function (x) { return x.u === u; }); if (i < 0) err('가방에 없는 장비입니다');
    var it = P.inv.splice(i, 1)[0], cur = P.eq[it.slot]; P.eq[it.slot] = it; if (cur) P.inv.push(cur); return { ok: true };
  };
  A.unequip = function (P, W, now, a) {
    var s = str(a.slot); if (!SLOT[s] || !P.eq[s]) err('장착한 장비가 없습니다');
    if (P.inv.length >= calc(P, W, now).bag) err('가방이 가득 찼습니다');
    P.inv.push(P.eq[s]); P.eq[s] = null; return { ok: true };
  };
  A.sell = function (P, W, now, a) {
    var u = str(a.u), i = P.inv.findIndex(function (x) { return x.u === u; }); if (i < 0) err('가방에 없는 장비입니다');
    if (P.inv[i].lock) err('잠긴 장비입니다');
    var p = R.sellPrice(P.inv[i]); P.inv.splice(i, 1); addGold(P, p); return { gold: p };
  };
  A.sellBelow = function (P, W, now, a) {
    var r = int(a.r, 0, 4), tot = 0, n = 0;
    P.inv = P.inv.filter(function (it) { if (!it.lock && it.r <= r) { tot += R.sellPrice(it); n++; return false; } return true; });
    addGold(P, tot); return { n: n, gold: tot };
  };
  // 분해: 장비를 마석과 마석가루로. 마석가루는 재련(옵션 다시 굴리기)에 쓴다
  R.dismantleYield = function (it) { return { stone: 1 + it.r + Math.floor(it.ilvl / 15) + Math.floor((it.enh || 0) / 2), dust: Math.floor((it.r + 1) * (it.r + 1) * (2 + it.ilvl / 10)) }; };
  function dismantleGive(P, it) { var y = R.dismantleYield(it); P.res.stone += y.stone; P.res.dust = (P.res.dust || 0) + y.dust; P.st.dismantled = (P.st.dismantled || 0) + 1; return y; }
  A.dismantle = function (P, W, now, a) {
    var u = str(a.u), i = P.inv.findIndex(function (x) { return x.u === u; }); if (i < 0) err('가방에 없는 장비입니다');
    if (P.inv[i].lock) err('잠긴 장비입니다');
    var y = dismantleGive(P, P.inv[i]); P.inv.splice(i, 1); return y;
  };
  A.dismantleBelow = function (P, W, now, a) {
    var r = int(a.r, 0, 4), o = { n: 0, stone: 0, dust: 0 };
    P.inv = P.inv.filter(function (it) { if (!it.lock && it.r <= r) { var y = dismantleGive(P, it); o.n++; o.stone += y.stone; o.dust += y.dust; return false; } return true; });
    return o;
  };
  // 재련: 등급·레벨·강화는 그대로 두고 옵션만 새로 굴린다 (옵션이 없는 일반 등급은 못 함)
  R.reforgeCost = function (it) { return Math.floor(8 * (it.r + 1) * (it.r + 1) * (1 + it.ilvl / 20)); };
  A.reforge = function (P, W, now, a) {
    var it = R.findItem(P, str(a.u)); if (!it) err('장비가 없습니다'); if (it.lock) err('잠긴 장비입니다. 잠금을 풀면 재련할 수 있습니다');
    var n = D.RARITY[it.r].affix; if (!n) err('옵션이 없는 장비는 재련할 수 없습니다');
    var cost = R.reforgeCost(it); if ((P.res.dust || 0) < cost) err('마석가루가 모자랍니다 (' + cost + '개 필요)');
    P.res.dust -= cost;
    var pool = D.AFFIXES.slice(); it.aff = [];
    for (var i = 0; i < n && pool.length; i++) {
      var af = pool.splice(Math.floor(rnd(P) * pool.length), 1)[0], v;
      if (af.flat) v = af.flat * (1 + it.ilvl * 0.07) * (0.7 + rnd(P) * 0.6) * (1 + it.r * 0.1);
      else v = (af.pct[0] + (af.pct[1] - af.pct[0]) * rnd(P)) * (1 + Math.min(it.ilvl, 200) * 0.004);
      it.aff.push({ id: af.id, v: Math.round(v * 10000) / 10000 });
    }
    it.name = (it.aff.length ? AFF[it.aff[0].id].prefix + ' ' : '') + R.baseName(it);
    P.st.reforged = (P.st.reforged || 0) + 1;
    return { name: it.name, cost: cost, aff: it.aff };
  };
  // 자동 처리: 판매 또는 분해 (분류 마법)
  A.autoMode = function (P, W, now, a) { if (!P.rs.sorter) err('분류 마법이 필요합니다'); P.autoDis = !!a.dis; return { ok: true }; };
  A.lock = function (P, W, now, a) { var it = R.findItem(P, str(a.u)); if (!it) err('장비가 없습니다'); it.lock = !it.lock; return { lock: it.lock }; };
  A.enhance = function (P, W, now, a) {
    var it = R.findItem(P, str(a.u)); if (!it) err('장비가 없습니다'); if (it.lock) err('잠긴 장비입니다. 잠금을 풀면 강화할 수 있습니다');
    var until = !!a.until, tries = 0, success = false, g0 = P.res.gold;
    while (tries < (until ? 60 : 1)) {
      if (it.enh >= R.ENH_MAX) { if (!tries) err('최대 강화입니다'); break; }
      var cost = R.enhCost(P, it); if (P.res.gold < cost.gold || P.res.stone < cost.stone) { if (!tries) err(CUR + '나 마석이 부족합니다'); break; }
      P.res.gold -= cost.gold; P.res.stone -= cost.stone; P.st.enh++; tries++;
      if (rnd(P) < R.enhChance(P, it)) { it.enh++; success = true; if (it.enh > P.st.maxEnh) P.st.maxEnh = it.enh; if (it.enh >= 10) log(P, now, it.name + ' +' + it.enh + ' 강화 성공', 'good'); break; }
    }
    return { success: success, tries: tries, enh: it.enh, gold: g0 - P.res.gold };
  };
  A.autoSell = function (P, W, now, a) { if (!P.rs.sorter) err('분류 마법이 필요합니다'); P.autoSell = int(a.r, -1, 3); return { ok: true }; };
  A.alloc = function (P, W, now, a) { var k = str(a.k), n = int(a.n, 1, 100000); if (STATS.indexOf(k) < 0) err('잘못된 능력치'); n = Math.min(n, P.pts); if (n <= 0) err('남은 포인트가 없습니다'); P.alloc[k] += n; P.pts -= n; return { ok: true }; };
  A.allocW = function (P, W, now, a) {
    var w = a.w || {}, o = {}; STATS.forEach(function (k) { var v = Number(w[k]); o[k] = isFinite(v) ? clamp(v, 0, 10) : 0; });
    P.opt.allocW = o; if (P.opt.autoAlloc) R.autoAlloc(P); return { ok: true };
  };
  A.opt = function (P, W, now, a) {
    var k = str(a.k); if (['autoEquip', 'autoAlloc', 'sound', 'reduceFx', 'hideMyTitle', 'hideOtherTitle'].indexOf(k) < 0) err('잘못된 설정');
    P.opt[k] = !!a.v; if (k === 'autoAlloc' && P.opt[k]) R.autoAlloc(P); return { ok: true };
  };
  A.spell = function (P, W, now, a) {
    var i = int(a.i, 0, 3), id = a.id ? str(a.id) : null;
    if (i >= R.spellSlots(P)) err('잠긴 슬롯입니다'); if (id && !R.spellUnlocked(P, id)) err('아직 배우지 못한 주문입니다');
    var j = id ? P.spells.indexOf(id) : -1; if (j >= 0) P.spells[j] = P.spells[i];
    P.spells[i] = id; return { ok: true };
  };
  A.egg = function (P, W, now) {
    if (P.grade < 3) err('3학년부터 할 수 있습니다'); if (P.fam.egg) err('이미 부화 중입니다'); if (P.fam.eggs <= 0) err('알이 없습니다');
    var cost = R.eggPrice(P, W, now); if (P.res.mana < cost) err('마나가 부족합니다');
    P.res.mana -= cost; P.fam.eggs--;
    var o = hatch(P, now); o.mana = cost; return o;
  };
  A.feed = function (P, W, now, a) {
    var id = str(a.id), o = P.fam.own[id]; if (!o) err('없는 사역마입니다'); if (o.lv >= 20) err('최대 레벨입니다');
    var cost = R.feedCost(P, id); if (P.res.gold < cost) err(CUR + '가 부족합니다'); P.res.gold -= cost; o.lv++; return { lv: o.lv };
  };
  A.famAct = function (P, W, now, a) { var id = str(a.id); if (!P.fam.own[id]) err('없는 사역마입니다'); if (P.fam.disp[id]) err('파견 중입니다'); P.fam.act = id; return { ok: true }; };
  /* ── 정보 카드 꾸미기 (아르크로 산다) ── */
  var DECO = R.DECO = idx(D.DECO);
  function decoOf(P) { if (!P.deco) P.deco = { own: {}, on: {} }; return P.deco; }
  R.decoView = function (P) { var d = P && P.deco, o = {}; if (!d) return o; D.DECO_SLOTS.forEach(function (s) { var id = d.on[s.id]; if (id && DECO[id] && d.own[id]) o[s.id] = id; }); return o; };
  A.decoBuy = function (P, W, now, a) {
    var id = str(a.id), x = DECO[id]; if (!x) err('없는 꾸미기입니다'); var d = decoOf(P); if (d.own[id]) err('이미 가지고 있습니다');
    if (P.res.gold < x.price) err(CUR + '가 부족합니다');
    P.res.gold -= x.price; d.own[id] = 1; d.on[x.slot] = id; log(P, now, '꾸미기 「' + x.name + '」을(를) 샀습니다 (' + R.fmt(x.price) + ' ' + CUR + ')', 'news');
    return { ok: true, id: id };
  };
  A.decoSet = function (P, W, now, a) {
    var slot = str(a.slot), id = typeof a.id === 'string' ? a.id.slice(0, 20) : '', d = decoOf(P);
    if (!D.DECO_SLOTS.some(function (s) { return s.id === slot; })) err('없는 칸입니다');
    if (id) { if (!DECO[id] || DECO[id].slot !== slot || !d.own[id]) err('가지고 있지 않은 꾸미기입니다'); d.on[slot] = id; } else delete d.on[slot];
    return { ok: true };
  };

  /* ── 꿈길: 잠자는 동안 하는 일 (1학년부터). 맡길 때 보상이 정해지고, 깨우면(취소) 아무것도 남지 않는다 ── */
  var DREAM = R.DREAM = idx(D.DREAMS), DRDUR = R.DRDUR = {}; D.DREAM_DUR.forEach(function (d) { DRDUR[d.k] = d; });
  R.LUCID = 0.1;   // 자각몽: 보상 1.5배
  // 꿈길 중에는 새 수업·원정을 맡길 수 없다 (이미 하던 것은 계속, 연구·물약·파견은 된다)
  R.dreaming = function (P, now) { return !!(P.dream && P.dream.end > now); };
  R.dreamPreview = function (P, W, kind, sid, durK, t0) {
    var d = DRDUR[durK] || DRDUR['8h']; t0 = t0 || P.at;
    var h = d.s / 3600, c = calc(P, W, t0, t0 + d.s), out = { dur: d.s };
    var subs = R.availableSubjects(P), top = subs.slice().sort(function (a, b) { return P.subj[b.id].lv - P.subj[a.id].lv; })[0];
    function lec(id) { var L = P.subj[id].lv; return { xp: K.LEC_XP * c.lecSpd * (1 + P.grade * 0.08), know: (K.LEC_KNOW + L * K.LEC_KNOW_LV) * c.know * c.lecSpd }; }
    if (kind === 'study') { var one = lec(SUBJ[sid] ? sid : top.id); out.xp = one.xp * h * 0.35; out.know = one.know * h * 0.25; }
    else if (kind === 'stars') { out.shard = Math.floor(h * 0.6); out.know = lec(top.id).know * h * 0.3; out.egg = h * 0.004; }
    else { var z = R.zoneOf(Math.min(P.maxStage, R.stageCap(P))); out.mat = z.mat; out.mats = Math.floor(h * 3.5); out.stones = Math.floor(h * 0.45); out.gold = Math.floor(h * 22 * K.KILL_GOLD * Math.pow(K.G_GOLD, z.from - 1) * (1 + (c.b.goldPct || 0))); }
    return out;
  };
  A.dreamStart = function (P, W, now, a) {
    var kind = str(a.kind), d = DRDUR[str(a.d)], sid = typeof a.s === 'string' ? a.s.slice(0, 20) : '';
    if (!DREAM[kind]) err('없는 꿈입니다'); if (!d) err('잘못된 시간입니다'); if (P.dream) err('이미 꿈길을 걷는 중입니다');
    if (kind === 'study' && !(SUBJ[sid] && SUBJ[sid].unlock <= Math.min(P.grade, 7))) err('과목 선택 필요');
    var pv = R.dreamPreview(P, W, kind, sid, d.k, now);
    P.dream = Object.assign({ kind: kind, s: kind === 'study' ? sid : null, start: now, end: now + d.s, lucid: rnd(P) < R.LUCID ? 1 : 0, line: ri(P, 0, D.DREAM_LINES.length - 1) }, pv);
    return { ok: true };
  };
  A.dreamCancel = function (P) { if (!P.dream) err('꿈길에 있지 않습니다'); P.dream = null; return { ok: true }; };
  function dreamFinish(P, j, t) {
    var m = j.lucid ? 1.5 : 1, out = { k: 'dream', kind: j.kind, t: t, lucid: !!j.lucid, line: j.line };
    if (j.xp) { out.s = j.s; out.from = P.subj[j.s].lv; subjGain(P, j.s, j.xp * m, t); out.to = P.subj[j.s].lv; out.xp = j.xp * m; }
    if (j.know) { P.res.know += j.know * m; out.know = j.know * m; }
    if (j.shard) { var sh = Math.floor(j.shard * m); P.res.shard += sh; out.shard = sh; }
    if (j.egg && rnd(P) < j.egg * m) { P.fam.eggs++; out.egg = 1; }
    if (j.gold) { addGold(P, j.gold * m); out.gold = Math.floor(j.gold * m); }
    if (j.mats) { var mt = Math.floor(j.mats * m); P.mats[j.mat] = (P.mats[j.mat] || 0) + mt; out.mats = mt; out.mat = j.mat; }
    if (j.stones) { var sn = Math.floor(j.stones * m); P.res.stone += sn; out.stones = sn; }
    P.st.dreams = (P.st.dreams || 0) + 1; P.st.nightJobs++; cupAdd(P, 15);
    log(P, t, '꿈에서 깼습니다: ' + DREAM[j.kind].name + (j.lucid ? ' (자각몽!)' : ''), 'good');
    return out;
  }
  A.dispatch = function (P, W, now, a) {
    var id = str(a.id), d = DDUR[str(a.d)];
    if (P.grade < 3) err('3학년부터 할 수 있습니다'); if (!P.fam.own[id]) err('없는 사역마입니다'); if (!d) err('잘못된 시간입니다');
    if (P.fam.disp[id]) err('이미 파견 중입니다'); if (P.fam.act === id) err('동행 중인 사역마는 파견할 수 없습니다');
    var b = calc(P, W, now, now + d.s).b;   // 숙면의 차 등은 파견 시간과 겹친 만큼
    P.fam.disp[id] = { start: now, end: now + d.s, dur: d.s, bonus: 1 + (b.dispPct || 0) }; return { ok: true };
  };
  // 이론 30: 시험 과목 평균 레벨이 기준이면 21점, 기준보다 3 높으면 30점 (문제 풀이 없음)
  R.examTheory = function (P, ex) { var avg = ex.subj.reduce(function (s2, k) { return s2 + P.subj[k].lv; }, 0) / ex.subj.length; return clamp(21 + (avg - ex.req) * 3, 0, 30); };
  A.exam = function (P, W, now) {
    var ex0 = R.examFor(P); if (!ex0 || P.grade >= 8) err('남은 시험이 없습니다');
    if (P.examCd > now) err('재응시 대기 중입니다'); if (!R.examEligible(P, ex0)) err('응시 자격이 부족합니다');
    var run = { grade: P.grade };
    var ex = D.EXAMS[run.grade - 1];
    var written = R.examTheory(P, ex), practical = R.examPractical(P, ex);
    var c = calc(P, W, now), e = R.duelEnemy(ex.duel), f = fight(P, c, e, 45, true);
    var duelPts = f.win ? 30 : 30 * (1 - f.mHp) * 0.85;
    var total = Math.round(written + practical + duelPts + c.examBonus), L = R.letter(total);
    var res = { grade: run.grade, written: written, practical: practical, duel: duelPts, duelWin: f.win, bonus: c.examBonus, total: total, letter: L,
      pass: total >= 60, ev: f.ev, maxHp: e.hp, examiner: ex.examiner };
    P.px = null;
    if (res.pass) {
      P.scores[run.grade] = { total: total, letter: L }; if (L === 'S') P.st.sGrades++;
      P.st.aGrades = Object.keys(P.scores).filter(function (g) { var l = P.scores[g].letter; return l === 'S' || l === 'A'; }).length;
      var rw = R.EXAM_REWARD[L] || R.EXAM_REWARD.C, mult = rw.mult, shard = Math.round((8 + run.grade * 4) * mult);
      var gold = Math.floor(400 * K.KILL_GOLD * Math.pow(K.G_GOLD, ex.duel) * mult); P.res.shard += shard; addGold(P, gold);
      var minR = rw.minR;
      var it = makeItem(P, pick(P, D.SLOTS).id, ex.duel + 4, Math.max(minR, rollRarity(P, 0.5)), minR);
      if (rw.egg) P.fam.eggs += rw.egg;
      res.reward = { shard: shard, gold: gold, egg: rw.egg, item: { name: it.name, r: it.r, res: gainItem(P, it, now) } };
      P.grade = run.grade + 1; if (P.grade > P.st.maxGrade) P.st.maxGrade = P.grade;
      cupAdd(P, 300);
      log(P, now, ex.title + ' 합격! ' + L + ' (' + total + '점)', 'story');
      if (P.grade === 3 && Object.keys(P.fam.own).length === 0) { P.fam.eggs++; log(P, now, '고드릭 펜 교수가 첫 환수의 알을 주었습니다.', 'story'); }
      if (P.grade >= 3 && !P.badgeGot) { P.badgeGot = 1; var b0 = makeBadge(P); if (gainBadge(P, b0, now, '2학년을 마친 기념') === 'got') res.badge = b0.name; }
      if (P.grade >= 8) log(P, now, '별의 종이 울렸습니다. 마스터 과정과 심연이 열립니다.', 'legend');
    } else { P.examCd = now + K.EXAM_CD; log(P, now, ex.title + ' 불합격 (' + total + '점)', 'bad'); }
    return res;
  };
  A.duel = function (P, W, now) {
    var r = R.rival(P); if (!r) err('결투제를 모두 마쳤습니다'); if (P.duel.cd > now) err('아직 도전할 수 없습니다');
    var c = calc(P, W, now), f = fight(P, c, R.duelEnemy(r.stage, 4, 1.3), 45, true), k = P.duel.rank + 1;
    P.st.bossTries++;
    var res = { win: f.win, k: k, rival: r.name, hello: r.hello, lose: r.lose, ev: f.ev, mHp: f.mHp, maxHp: R.duelEnemy(r.stage, 4, 1.3).hp };
    badgeGain(P, R.BADGE_XP.fight * (f.win ? 2 : 1), now);
    if (f.win) {
      P.duel.rank++; P.st.duelWins++; var first = P.duel.rank > P.st.duelBest; if (first) P.st.duelBest = P.duel.rank;
      var shard = 3 + k + (first ? k : 0), gold = Math.floor(80 * K.KILL_GOLD * Math.pow(K.G_GOLD, r.stage - 1) * c.gold);
      P.res.shard += shard; addGold(P, gold); res.reward = { shard: shard, gold: gold, first: first };
      P.duel.cd = now + K.DUEL_CD; cupAdd(P, 40);
      log(P, now, '결투제 ' + k + '회전 승리: ' + r.name, 'good');
    } else { P.duel.cd = now + K.DUEL_LOSE_CD; log(P, now, '결투제 ' + k + '회전 패배: ' + r.name, 'bad'); }
    return res;
  };
  A.task = function (P, W, now, a) {
    var sid = str(a.s), o = R.taskOf(P, sid); if (!o) err('남은 과제가 없습니다');
    if (R.taskProg(P, sid, o.t) < o.t.n) err('아직 과제를 마치지 못했습니다');
    P.tasks[sid] = o.i + 1; var shard = 5 + o.i * 8; P.res.shard += shard; P.st.tasksDone++;
    var out = { shard: shard, prof: SUBJ[sid].prof };
    if (o.t.item) { var it = makeItem(P, o.t.item, Math.max(P.maxStage, 10), 3, 3); it.name = SUBJ[sid].prof.split(' ')[0] + '의 ' + R.baseName(it); out.item = { name: it.name, r: it.r, res: gainItem(P, it, now) }; }
    log(P, now, SUBJ[sid].prof + '의 과제 완료', 'good'); return out;
  };
  A.buy = function (P, W, now, a) {
    var id = str(a.id), s = SHOP[id]; if (!s) err('없는 물건입니다'); if (s.grade && P.grade < s.grade) err(s.grade + '학년부터 살 수 있습니다');
    if (id === 'bagslot' && P.bagExtra >= 60) err('더 늘릴 수 없습니다');
    if (id === 'badgebox' && (P.badges || []).length >= R.BADGE_HOLD) err('휘장 보관함이 가득 찼습니다 (' + R.BADGE_HOLD + '개)');
    if (id === 'ticket') { var day = R.dayKST(now); if (P.wb.buyDay !== day) { P.wb.buyDay = day; P.wb.bought = 0; } if (P.wb.bought >= K.WB_BUY_MAX) err('오늘은 더 살 수 없습니다'); }
    var price = R.shopPrice(P, id), cur = s.cur === 'gold' ? 'gold' : 'shard'; if (P.res[cur] < price) err((cur === 'gold' ? CUR : '별조각') + '가 부족합니다');
    P.res[cur] -= price; var out = { id: id };
    if (id === 'stone10') P.res.stone += 10;
    else if (id === 'gearbox') { var it = makeItem(P, pick(P, D.SLOTS).id, Math.min(P.maxStage, R.stageCap(P)), Math.max(1, rollRarity(P, calc(P, W, now).rarity + 0.4)), 1); out.item = { name: it.name, r: it.r, res: gainItem(P, it, now) }; }
    else if (id === 'egg') P.fam.eggs++;
    else if (id === 'badgebox') { var nb = makeBadge(P); gainBadge(P, nb, now, '매점 휘장 원석'); out.badge = { name: nb.name, gem: nb.gem }; }
    else if (id === 'manavial') { var m = calc(P, W, now).mana * 14400; addMana(P, m); out.mana = m; }
    else if (id === 'ticket') { P.wb.tickets++; P.wb.bought++; }
    else if (id === 'bagslot') P.bagExtra += 5;
    else if (id === 'matbox') { var zs = D.ZONES.filter(function (z) { return z.from <= P.maxStage; }); out.mats = {}; for (var i = 0; i < 12; i++) { var z = pick(P, zs); P.mats[z.mat] = (P.mats[z.mat] || 0) + 1; out.mats[z.mat] = (out.mats[z.mat] || 0) + 1; } }
    else if (id === 'respec') { var tot = 0; STATS.forEach(function (k) { tot += P.alloc[k]; P.alloc[k] = 0; }); P.pts += tot; if (P.opt.autoAlloc) R.autoAlloc(P); }
    return out;
  };
  A.login = function (P, W, now) {
    if (!P.daily.login) err('오늘의 출석 보상을 이미 받았습니다');
    P.daily.login = false; var lr = R.loginReward(P), shard = lr.shard, stone = lr.stone;
    P.res.shard += shard; P.res.stone += stone; return { shard: shard, stone: stone, streak: P.daily.streak };
  };
  A.daily = function (P, W, now, a) {
    var i = int(a.i, 0, 2), q = P.daily.q[i]; if (!q || q.done) err('받을 수 없습니다'); if (R.dailyProg(P, q) < q.goal) err('아직 완료하지 못했습니다');
    q.done = true; var rw = R.dailyReward(P), shard = rw.shard, gold = rw.gold;
    P.res.shard += shard; addGold(P, gold); return { shard: shard, gold: gold };
  };
  A.spirit = function (P, W, now) {
    var sp = R.spiritJar(P, now), n = sp.n; if (n <= 0) err('병이 비어 있습니다');
    if (n >= K.SPIRIT_JAR) sp.at = now; sp.n = 0;
    P.st.spirits += n; cupAdd(P, 15 * n);
    var c = calc(P, W, now), out = { n: n, mana: 0, gold: 0, shard: 0, stone: 0 };
    for (var i = 0; i < n; i++) {
      var roll = rnd(P);
      if (roll < 0.28) { var m = c.mana * 1800; addMana(P, m); out.mana += m; }
      else if (roll < 0.53) { var kn = Math.floor((60 + P.grade * 50) * 2.4 * c.know * Math.pow(1.25, P.grade - 1)); P.res.know += kn; out.know = (out.know || 0) + kn; }
      else if (roll < 0.76) { var g = Math.floor(120 * K.KILL_GOLD * Math.pow(K.G_GOLD, Math.min(P.maxStage, R.stageCap(P)) - 1) * c.gold * K.SPIRIT_GOLD); addGold(P, g); out.gold += g; }
      else if (roll < 0.9) { var s = ri(P, 1, 3); P.res.shard += s; out.shard += s; }
      else { var st = ri(P, 2, 5); P.res.stone += st; out.stone += st; }
    }
    return out;
  };
  A.wbAttack = function (P, W, now) {
    if (!W || !W.wbAlive) err('이번 주 월드 보스는 이미 쓰러졌습니다');
    if (P.wb.tickets <= 0) err('도전권이 없습니다');
    P.wb.tickets--; if (P.wb.tickets < K.WB_TICKET_MAX && P.wb.at > now) P.wb.at = now;
    var c = calc(P, W, now), f = fight(P, c, R.wbEnemy(P), 30, false), dmg = Math.floor(f.dealt);
    P.wk.dmg += dmg; P.wk.att++; P.st.wbAttacks++; cupAdd(P, 30);
    badgeGain(P, R.BADGE_XP.fight, now);
    return { dmg: dmg, ev: f.ev, dead: !!f.dead, t: f.t };
  };
  // 지난주 보상: W.results[weekId] = { cup:[1위 house,...], killed:bool, tiers:[상위1%,10%,50% 피해] }
  A.weekClaim = function (P, W, now) {
    var pv = P.wkPrev; if (!pv || pv.claimed) err('받을 주간 보상이 없습니다');
    var r = W && W.results && W.results[pv.id]; if (!r) err('지난주 결과를 집계 중입니다. 잠시 후 다시 시도');
    pv.claimed = true; var out = { shard: 0, items: [], week: pv.id };
    if (pv.cup > 0 && r.cup) {
      var place = r.cup.indexOf(pv.house) + 1, cs = [0, 25, 15, 10, 6][place] || 0; out.shard += cs; out.cupPlace = place;
      if (place === 1) { P.st.cupWins++; var it = makeItem(P, pick(P, D.SLOTS).id, Math.min(P.maxStage, R.stageCap(P)), 3, 3); out.items.push({ name: it.name, r: it.r, res: gainItem(P, it, now) }); }
    }
    if (pv.att > 0) {
      out.shard += 10; out.wbKilled = !!r.killed;
      if (r.killed) { out.shard += 20; P.fam.eggs++; out.egg = 1; P.st.wbKills++; }
      var t = r.tiers || [], tier = pv.dmg >= (t[0] || Infinity) ? 1 : pv.dmg >= (t[1] || Infinity) ? 2 : pv.dmg >= (t[2] || Infinity) ? 3 : 4;
      out.tier = tier; out.shard += [0, 40, 20, 8, 0][tier];
      if (tier <= 2) { var it2 = makeItem(P, pick(P, D.SLOTS).id, Math.min(P.maxStage, R.stageCap(P)) + 3, tier === 1 && rnd(P) < 0.25 ? 4 : 3, 3); out.items.push({ name: it2.name, r: it2.r, res: gainItem(P, it2, now) }); }
    }
    P.res.shard += out.shard;
    return out;
  };
  A.inboxAck = function (P, W, now, a) { var upto = Number(a.upto); if (!isFinite(upto)) upto = Infinity; P.inbox = P.inbox.filter(function (o) { return o.t > upto; }); return { ok: true }; };
  A.storySeen = function (P, W, now, a) { P.story = Math.max(P.story, int(a.n, 0, 8)); return { ok: true }; };

  A.dailyReroll = function (P, W, now, a) {
    var i = int(a.i, 0, 2), q = P.daily.q[i]; if (!q || q.done) err('바꿀 수 없는 의뢰입니다');
    var cost = R.rerollCost(P); if (P.res.shard < cost) err('별조각이 부족합니다');
    var have = P.daily.q.map(function (x) { return x.type; });
    var pool = D.DAILY.filter(function (d) { return (!d.grade || P.grade >= d.grade) && have.indexOf(d.type) < 0; }); if (!pool.length) err('바꿀 의뢰가 없습니다');
    var d = pick(P, pool); P.res.shard -= cost; P.daily.rr = (P.daily.rr || 0) + 1;
    P.daily.q[i] = { type: d.type, name: d.name, goal: d.base, base: P.st[d.type] || 0, done: false };
    return { cost: cost, name: d.name };
  };
  A.title = function (P, W, now, a) { var id = a.id ? str(a.id, 20) : ''; if (id && !R.titleOk(P, id)) err('아직 얻지 못한 칭호입니다'); P.title = id; return { title: R.titleName(P, id) }; };
  A.skyLook = function (P, W, now) {
    var ev = R.skyAt(now); if (!ev) err('지금은 하늘이 조용합니다');
    if (P.skyLook === ev.key) err('이번 ' + ev.name + '은(는) 이미 올려다봤습니다');
    P.skyLook = ev.key; var c = calc(P, W, now), big = ev.id === 'whale', out = { name: ev.name, shard: ri(P, big ? 3 : 1, big ? 5 : 3), mana: Math.floor(c.mana * (big ? 1800 : 600)) };
    P.res.shard += out.shard; addMana(P, out.mana); cupAdd(P, 10);
    log(P, now, ev.name + '을(를) 올려다봤습니다 (별조각 +' + out.shard + ')', 'news');
    return out;
  };
  // 아카데미 휘장: 달기 · 떼기(u 없이) · 닦기(별빛 +) · 깨뜨리기(마석가루로)
  A.badgeWear = function (P, W, now, a) { var u = a.u ? str(a.u) : ''; if (u && !R.badgeFind(P, u)) err('없는 휘장입니다'); P.badgeOn = u || null; return { ok: true }; };
  A.badgeLock = function (P, W, now, a) { var b = R.badgeFind(P, str(a.u)); if (!b) err('없는 휘장입니다'); b.lock = !b.lock; return { lock: b.lock }; };
  A.badgePolish = function (P, W, now, a) {
    var b = R.badgeFind(P, str(a.u)); if (!b) err('없는 휘장입니다'); if (b.lock) err('잠긴 휘장입니다. 잠금을 풀면 닦을 수 있습니다'); if (b.lv >= R.BADGE_MAX) err('이미 완성된 휘장입니다');
    if (P.badgeOn !== b.u) err('달고 있는 휘장만 닦을 수 있습니다');
    var c = R.badgePolishCost(P, b); if ((P.res.dust || 0) < c.dust) err('마석가루가 모자랍니다 (' + c.dust + '개 필요)'); if (P.res.gold < c.gold) err(CUR + '가 모자랍니다');
    P.res.dust -= c.dust; P.res.gold -= c.gold; var x = R.badgePolishXp(b), lv0 = b.lv; badgeGain(P, x, now); P.st.polished = (P.st.polished || 0) + 1;
    return { xp: x, from: lv0, to: b.lv, name: b.name, dust: c.dust, gold: c.gold };
  };
  A.badgeBreak = function (P, W, now, a) {
    var b = R.badgeFind(P, str(a.u)); if (!b) err('없는 휘장입니다'); if (b.lock) err('잠긴 휘장입니다'); if (P.badgeOn === b.u) err('달고 있는 휘장은 깨뜨릴 수 없습니다. 먼저 장착 해제 필요');
    var d = R.badgeBreakDust(b); P.badges = P.badges.filter(function (x) { return x !== b; }); P.res.dust = (P.res.dust || 0) + d;
    log(P, now, b.name + '을(를) 깨뜨려 마석가루 ' + d + '개를 얻었습니다', 'news'); return { dust: d, name: b.name };
  };
  A.badgeShine = function (P, W, now, a) {
    var b = R.badgeFind(P, str(a.u)); if (!b) err('없는 휘장입니다'); if (b.lock) err('잠긴 휘장입니다. 잠금을 풀면 광을 낼 수 있습니다');
    var q = b.q || 1; if (q >= R.BADGE_Q_MAX - 1e-9) err('이미 최고 품질입니다');
    var c = R.badgeShineCost(b); if (P.res.shard < c) err('별조각이 모자랍니다 (' + c + '개 필요)');
    P.res.shard -= c; b.q = Math.min(R.BADGE_Q_MAX, Math.round((q + R.BADGE_Q_STEP) * 1000) / 1000); P.st.shined = (P.st.shined || 0) + 1;
    log(P, now, b.name + '에 광을 냈습니다 (품질 ' + Math.round(b.q * 1000) / 10 + '%)', 'good');
    return { q: b.q, cost: c, name: b.name };
  };
  A.badgeRecut = function (P, W, now, a) {
    var b = R.badgeFind(P, str(a.u)); if (!b) err('없는 휘장입니다'); if (b.lock) err('잠긴 휘장입니다. 잠금을 풀면 세공을 다시 새길 수 있습니다'); if (!b.aff || !b.aff.length) err('다시 새길 세공이 없습니다');
    var i = int(a.i, 0, b.aff.length - 1), c = R.badgeRecutCost(b); if (P.res.shard < c) err('별조각이 모자랍니다 (' + c + '개 필요)');
    var pool = D.AFFIXES.filter(function (x) { return x.pct && x.id !== GEM[b.gem].bonus && !b.aff.some(function (y, j) { return j !== i && y.id === x.id; }); });
    if (!pool.length) err('새길 수 있는 세공이 없습니다');
    P.res.shard -= c; var x = pick(P, pool), old = b.aff[i];
    b.aff[i] = { id: x.id, v: Math.round((x.pct[0] + (x.pct[1] - x.pct[0]) * rnd(P)) * 0.5 * 10000) / 10000 };
    b.name = badgeName(b); P.st.recut = (P.st.recut || 0) + 1;
    var nm = function (y) { return (D.BONUS_NAMES[y.id] || y.id) + ' +' + R.fmtPct(y.v, 1); };
    log(P, now, b.name + ' 세공 다시 새기기: ' + nm(old) + ' → ' + nm(b.aff[i]), 'good');
    return { i: i, id: x.id, v: b.aff[i].v, cost: c, name: b.name, text: nm(b.aff[i]), was: nm(old) };
  };
  R.fingerprint = function (P) { return [P.inbox.length, P.inbox.length ? P.inbox[P.inbox.length - 1].t : 0, P.log.length, P.log[0] ? P.log[0].t : 0, P.daily.day, P.wk.id, P.spirit.at, P.wb.tickets].join('|'); };
  /* ───────── 학기 이야기 (메인 퀘스트): 상태 P.mq = { g: 장(1~8, 9 = 다 읽음), i: 단계, b: 단계 시작 때 통계 } ───────── */
  R.mqStep = function (P) { var m = P && P.mq; if (!m) return null; var ch = D.MQ[m.g - 1]; return ch && ch.steps[m.i] ? { g: m.g, i: m.i, ch: ch, st: ch.steps[m.i] } : null; };
  function mqBase(P) { var s = R.mqStep(P), b = {}; if (s) s.st.g.forEach(function (q) { if (q.k === 'cnt') b[q.s] = P.st[q.s] || 0; if (q.k === 'lecRun') b.lecJobs = P.st.lecJobs || 0; if (q.k === 'expRun') b.expJobs = P.st.expJobs || 0; if (q.k === 'resRun') b.researchDone = P.st.researchDone || 0; }); P.mq.b = b; }
  R.mqInit = function (P) {
    if (P.mq) { var ch = D.MQ[P.mq.g - 1]; if (ch && P.mq.i >= ch.steps.length) { P.mq.i = ch.steps.length - 1; mqBase(P); } return; }   // 장의 단계 수가 줄었을 때: 그 장 마지막 단계로
    P.mq = { g: Math.max(1, Math.min(8, P.grade || 1)), i: 0, b: {} }; mqBase(P);
  };
  var MQ_ST = { lecJobs: ['수업', '교시 마치기'], expJobs: ['원정', '번 마치기'], researchDone: ['연구', '번 마치기'], brews: ['물약', '병 만들기'], dispatches: ['사역마 파견', '번 다녀오기'], tasksDone: ['교수님 과제', '개 제출하기'] };
  // 목표 하나: { text, cur, need, ok }
  R.mqGoal = function (P, q, g) {
    var b = (P.mq && P.mq.b) || {}, st = P.st || {}, run = function (arr) { return (arr || []).some(Boolean); };
    if (q.k === 'lecRun') { var ok1 = run(P.lec) || (st.lecJobs || 0) > (b.lecJobs || 0); return { text: '수업 하나 시작하기', cur: ok1 ? 1 : 0, need: 1, ok: ok1 }; }
    if (q.k === 'expRun') { var ok2 = run(P.exp) || (st.expJobs || 0) > (b.expJobs || 0); return { text: '원정 보내기', cur: ok2 ? 1 : 0, need: 1, ok: ok2 }; }
    if (q.k === 'resRun') { var ok3 = run(P.rsq) || (st.researchDone || 0) > (b.researchDone || 0); return { text: '연구 하나 시작하기', cur: ok3 ? 1 : 0, need: 1, ok: ok3 }; }
    if (q.k === 'cnt') { var c = Math.max(0, (st[q.s] || 0) - (b[q.s] || 0)), nm = MQ_ST[q.s] || [q.s, '']; return { text: nm[0] + ' ' + q.n + nm[1], cur: Math.min(c, q.n), need: q.n, ok: c >= q.n }; }
    if (q.k === 'subj') { var lv = (P.subj[q.s] || {}).lv || 0; return { text: (R.SUBJ[q.s] ? R.SUBJ[q.s].name : q.s) + ' Lv ' + q.n, cur: Math.min(lv, q.n), need: q.n, ok: lv >= q.n }; }
    if (q.k === 'boss') { var won = P.maxStage >= q.n + 9; return { text: R.zoneOf(q.n).boss.name + ' 처치 (' + q.n + '단계 보스)', cur: won ? 1 : 0, need: 1, ok: won }; }
    if (q.k === 'elig') {
      var ex = D.EXAMS[(g || P.grade) - 1]; if (!ex || P.grade > ex.grade) return { text: '기말시험 준비', cur: 1, need: 1, ok: true };
      var n = ex.subj.filter(function (s) { return P.subj[s].lv >= ex.req; }).length;
      return { text: '시험 과목 모두 Lv ' + ex.req + ' (' + ex.subj.map(function (s) { return R.SUBJ[s].name; }).join(' · ') + ')', cur: n, need: ex.subj.length, ok: n >= ex.subj.length };
    }
    if (q.k === 'exam') { var ex2 = D.EXAMS[q.n - 1], ok4 = P.grade > q.n; return { text: (ex2 ? ex2.title.split(':')[0] : q.n + '학년 기말') + ' 합격', cur: ok4 ? 1 : 0, need: 1, ok: ok4 }; }
    if (q.k === 'badge') { var ok5 = !!R.badgeWorn(P); return { text: '휘장 달기', cur: ok5 ? 1 : 0, need: 1, ok: ok5 }; }
    if (q.k === 'fam') { var nf = Object.keys((P.fam && P.fam.own) || {}).length; return { text: '사역마 ' + q.n + '마리 깨우기', cur: Math.min(nf, q.n), need: q.n, ok: nf >= q.n }; }
    return { text: '?', cur: 0, need: 1, ok: false };
  };
  R.mqGoals = function (P) { var s = R.mqStep(P); return s ? s.st.g.map(function (q) { return R.mqGoal(P, q, s.g); }) : []; };
  R.mqReady = function (P) { var a = R.mqGoals(P); return a.length > 0 && a.every(function (x) { return x.ok; }); };
  A.mqClaim = function (P, W, now) {
    R.mqInit(P); var s = R.mqStep(P); if (!s) err('모든 이야기를 읽었습니다');
    if (!R.mqReady(P)) err('아직 목표를 달성하지 않았습니다');
    var got = R.grantMail(P, W, now, s.st.rw || {}), txt = R.rewardText(R.cleanRewards(s.st.rw || {}));
    log(P, now, '학기 이야기 「' + s.st.t + '」 완료' + (txt ? ' · ' + txt : ''), 'story');
    P.mq.i++; var chEnd = false; if (P.mq.i >= s.ch.steps.length) { P.mq.g++; P.mq.i = 0; chEnd = true; }
    mqBase(P);
    return { t: s.st.t, end: s.st.end || '', reward: txt, items: (got && got.items) || [], chEnd: chEnd, chTitle: s.ch.title, g: P.mq.g, i: P.mq.i };
  };
  R.ACTIONS = A;
  R.act = function (P, W, now, type, a) {
    var f = A[type]; if (typeof f !== 'function' || !Object.prototype.hasOwnProperty.call(A, type)) err('알 수 없는 행동입니다');
    R.advance(P, W, now);
    var out = f(P, W, now, a || {});
    checkAch(P, now);
    return out;
  };

  /* ───────── 클라이언트로 보낼 때 숨길 값 ───────── */
  R.publicState = function (P) {
    var o = {}; for (var k in P) if (k !== 'rng' && k !== 'pq' && k !== 'px' && k !== 'qRecent' && k !== 'quizCd') o[k] = P[k];
    o.examPending = !!P.px;
    return o;
  };

  /* ───────── 서버 보조: 랭킹·보스 체력 추정 ───────── */
  R.summary = function (P, W, now) {
    var c = calc(P, W, now);
    return { power: c.power, lvl: P.lvl, grade: P.grade, maxStage: P.maxStage, wbDps: Math.floor(c.totalDps * 30) };
  };

  /* ───────── 표기 ───────── */
  var UNITS = [[1e20, '해'], [1e16, '경'], [1e12, '조'], [1e8, '억'], [1e4, '만']];
  R.fmt = function (n) {
    if (n == null || !isFinite(n)) return '0';
    var neg = n < 0, s; n = Math.abs(n);
    if (n < 1e4) s = n < 10 && n % 1 ? n.toFixed(1) : Math.floor(n).toLocaleString('ko-KR');
    else if (n >= 1e24) s = n.toExponential(2).replace('e+', 'e');
    else for (var i = 0; i < UNITS.length; i++) if (n >= UNITS[i][0]) { var v = n / UNITS[i][0]; s = (v >= 100 ? String(Math.floor(v)) : v >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1') + UNITS[i][1]; break; }
    return (neg ? '-' : '') + s;
  };
  R.fmtPct = function (v, d) { return (v * 100).toFixed(d == null ? 0 : d).replace(/\.0+$/, '') + '%'; };
  R.fmtTime = function (s) {
    s = Math.max(0, Math.floor(s)); var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
    if (d) return d + '일 ' + h + '시간'; if (h) return h + '시간 ' + m + '분'; if (m) return m + '분 ' + (ss < 10 ? '0' : '') + ss + '초'; return ss + '초';
  };
  R.gradeLabel = function (P) { return P.grade >= 8 ? '마스터 과정' : P.grade + '학년'; };
  return R;
});
