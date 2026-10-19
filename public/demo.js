/* 아티팩트 미리보기 전용: 서버 없이 브라우저 안에서 도는 LocalApi. 서버판(index.html)에는 실리지 않는다. */
(function (NET) {
  var CUR = window.DATA.CUR;

  /* ───────── 데모 (서버 없이) ─────────
     같은 규칙 엔진을 브라우저에서 돌린다. 다른 학생·월드 보스·대항전은 가상으로 흉내 낸다. */
  var KEY = 'arcanum_demo_v3';
  function LocalApi() { this.mode = 'local'; this.d = null; try { var s = localStorage.getItem(KEY); if (s) this.d = JSON.parse(s); if (this.d && this.d.P && window.Rules && Rules.fixState) Rules.fixState(this.d.P); } catch (e) { } }
  LocalApi.prototype._save = function () { try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch (e) { } };
  LocalApi.prototype._now = function () { return Date.now() / 1000; };
  LocalApi.prototype._world = function (now) {
    var d = this.d, W = d.W, wk = Rules.weekId(now);
    if (!W.boss || W.boss.week !== wk) {
      if (W.boss) {
        var cup = D2().HOUSES.map(function (h) { return h.id; }).sort(function (a, b) { return (W.cup[b] || 0) - (W.cup[a] || 0); });
        W.results[W.boss.week] = { cup: cup, killed: !!W.boss.killedAt, tiers: [Infinity, Infinity, 0] };
      }
      var def = D2().WORLD_BOSSES[wk % D2().WORLD_BOSSES.length];
      var P = d.P, dps = P ? Rules.summary(P, W, now).wbDps : 1000;
      W.boss = { week: wk, id: def.id, name: def.name, maxHp: Math.max(5e4, dps * 60), hp: Math.max(5e4, dps * 60), killedAt: 0, lastSim: now };
      W.cup = {}; W.cupAt = now;
    }
    // 가상의 다른 학생들이 보스를 조금씩 공격하고 대항전 점수를 쌓는다
    var dt = Math.max(0, now - (W.boss.lastSim || now)); W.boss.lastSim = now;
    if (!W.boss.killedAt) { W.boss.hp = Math.max(0, W.boss.hp - W.boss.maxHp * 0.12 * dt / 86400); if (W.boss.hp <= 0) W.boss.killedAt = now; }
    var mine = d.P ? d.P.wk.cup : 0, rate = Math.max(0.05, mine / Math.max(3600, now - Rules.weekStart(wk)));
    D2().HOUSES.forEach(function (h, i) { if (!d.P || h.id !== d.P.house) W.cup[h.id] = rate * (now - Rules.weekStart(wk)) * [1.15, 0.85, 1.0, 0.7][i]; });
    if (d.P) W.cup[d.P.house] = mine;
    W.now = now; W.wbAlive = !W.boss.killedAt;
    return W;
  };
  function D2() { return window.DATA; }
  LocalApi.prototype._view = function (now) {
    var W = this.d.W, P = this.d.P, b = W.boss;
    var cup = D2().HOUSES.map(function (h) { return { id: h.id, score: Math.floor(W.cup[h.id] || 0), members: 0 }; }).sort(function (a, c) { return c.score - a.score; });
    var me = P ? [{ name: P.name, house: P.house, power: Rules.summary(P, W, now).power, lvl: P.lvl, grade: P.grade, stage: P.maxStage }] : [];
    return { demo: true, epoch: W.epoch, now: now, week: Rules.weekId(now), weekEnd: Rules.weekStart(Rules.weekId(now) + 1),
      boss: { id: b.id, name: b.name, maxHp: b.maxHp, hp: b.hp, killedAt: b.killedAt, participants: P && P.wk.att ? 1 : 0 },
      cup: cup, topPower: me, topStage: me, topDmg: P && P.wk.dmg ? [{ name: P.name, house: P.house, dmg: P.wk.dmg }] : [],
      notices: [{ t: W.epoch, text: '데모 모드입니다. 진행 상황은 이 브라우저에만 저장되며, 월드 보스와 대항전의 다른 학생은 가상입니다.' }], news: (this.d.news || []).slice(0, 20),
      players: 1, online: 1, lastWeek: W.results[Rules.weekId(now) - 1] || null };
  };
  // 데모: 가상의 학생들이 수업을 듣는다 (시간마다 조금씩 바뀌고, 같은 시각엔 누구에게나 같은 숫자)
  function hsh(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); return (n ^ (n >>> 15)) >>> 0; }
  LocalApi.prototype._cls = function (now) {
    var d = Rules.dayKST(now), h = Math.floor(((now + 9 * 3600) % 86400) / 3600), n = {}, prof = {};
    D2().SUBJECTS.forEach(function (s, i) {
      var w = Math.max(0.15, 1 - (s.unlock - 1) * 0.14), c = Math.floor((hsh(d * 977 + h * 31 + i) % 7) * w); if (c) n[s.id] = c;
      var tot = 0; for (var k = 0; k <= h; k++) tot += Math.floor((hsh(d * 977 + k * 31 + i) % 7) * w);
      if (tot >= 14 && D2().PROF_CROWD[s.id]) prof[s.id] = D2().PROF_CROWD[s.id][d % D2().PROF_CROWD[s.id].length];
    });
    var P = this.d && this.d.P; if (P) P.lec.forEach(function (j) { if (j && j.end > now) n[j.s] = (n[j.s] || 0) + 1; });
    return { n: n, prof: prof };
  };
  LocalApi.prototype._ok = function (now, extra) {
    var P = this.d.P; if (P) this._auc(now); this._save();
    var so = this.d.soc, o = { now: now, P: P ? Rules.publicState(P) : null, W: this._view(now), rank: 1, party: so && so.party ? 'demo-party' : null, guild: so && so.guild ? so.guild.id : null, mailN: this._mailList(now).filter(function (m) { return !m.read; }).length, mailTop: this._mailList(now).reduce(function (a, m) { return Math.max(a, m.id); }, 0), cls: P ? this._cls(now) : null, rit: P ? this._rit(now) : null, auc: (function () { var v = Rules.auctionVisit(now); return v ? { start: v.start, end: v.end, active: v.active } : null; })() };
    for (var k in extra) o[k] = extra[k];
    return Promise.resolve(o);
  };
  LocalApi.prototype.meta = function () { var now = this._now(); if (!this.d) this.d = { W: { epoch: now, results: {}, cup: {} }, P: null }; this._world(now); return this._ok(now, { registerOpen: true, inviteRequired: false, demo: true, world: this._view(now) }); };
  LocalApi.prototype.state = function () {
    var now = this._now(); if (!this.d || !this.d.P) return Promise.resolve({ error: '로그인이 필요합니다', _status: 401 });
    var W = this._world(now); Rules.advance(this.d.P, W, now); return this._ok(now);
  };
  LocalApi.prototype.world = function () { var now = this._now(); this._world(now); return Promise.resolve(this._view(now)); };
  LocalApi.prototype.register = function (name, pw, house, code, cls) {
    var now = this._now(); if (!this.d) this.d = { W: { epoch: now, results: {}, cup: {} }, P: null };
    name = Rules.cleanName(name); if (!Rules.NAME_RE.test(name)) return Promise.resolve({ error: Rules.NAME_RULE, _status: 400 });
    this.d.P = Rules.newPlayer('local', name, house, now, Math.floor(Math.random() * 2147483647) | 1); Rules.clsStart(this.d.P, cls);
    this._welcomeMail(name);
    this._sendMail('운영진', '[시험] 연구 즉시 완료 물약', '운영진 보상으로 나갈 「연구 즉시 완료 물약」 시험용입니다.\n받은 뒤 서고에서 진행 중인 연구 옆 「즉시 완료」를 눌러 보세요.', { rsDone: 1 }, 30);
    this.d.news = [{ t: now, text: name + ' 학생이 ' + (Rules.HOUSE[house] ? Rules.HOUSE[house].name : '아카데미') + '에 입학했습니다' }].concat(D2().RIVALS.slice(0, 4).map(function (r, i) { return { t: now - (i + 1) * 5400, text: r.name + ' 학생이 ' + (i % 2 ? '2학년으로 진급했습니다' : r.who.split(' ')[0] + '에 입학했습니다') }; }));
    var W = this._world(now); Rules.advance(this.d.P, W, now); return this._ok(now);
  };
  LocalApi.prototype.login = function () { return this.state(); };
  LocalApi.prototype.guest = function (name, house, cls) { return this.register(name, '', house, '', cls); };
  LocalApi.prototype.rename = function (name) {
    var P = this.d && this.d.P, now = this._now(); if (!P) return Promise.resolve({ error: '로그인이 필요합니다' });
    name = Rules.cleanName(name); if (!Rules.NAME_RE.test(name)) return Promise.resolve({ error: Rules.NAME_RULE });
    if (name === P.name) return Promise.resolve({ error: '지금 이름과 같습니다' });
    var lf = Rules.renameLeft(P, now); if (lf > 0) return Promise.resolve({ error: Rules.fmtTime(lf) + ' 뒤에 바꿀 수 있습니다' });
    var old = P.name; P.name = name; P.nameAt = now; Rules.log(P, now, '이름을 「' + name + '」(으)로 바꿨습니다', 'news');
    return this._ok(now, { ok: true });
  };
  // 데모 채팅: 아티팩트의 실시간 방(room)이 있으면 같은 페이지를 연 사람끼리, 없으면 이 브라우저 안에서만
  var CKEY = 'arcanum_demo_chat';
  function c0slow(self) { return (self._chat && self._chat.slow) || 0; }
  LocalApi.prototype.chatConnect = function (h) {
    var self = this, saved = { rp: [], world: [] };
    try { var s = JSON.parse(localStorage.getItem(CKEY) || 'null'); if (s && s.rp) saved = s; } catch (e) { }
    self._chat = { h: h, saved: saved, room: null, seq: Date.now() };
    function keep(m) { var arr = saved[m.ch]; if (!arr) return; arr.push(m); if (arr.length > 60) arr.shift(); try { localStorage.setItem(CKEY, JSON.stringify(saved)); } catch (e) { } }
    self._chat.keep = keep;
    var so = self._soc();
    h.init({ op: true, slow: { world: c0slow(self) }, party: so.party ? 'demo-party' : null, guild: so.guild ? so.guild.id : null, house: self.d.P ? self.d.P.house : null, cls: self.d.P && self.d.P.cls ? self.d.P.cls : null, channels: { recruit: (so.chat.recruit || []).slice(), party: so.chat.party.slice(), grp: so.chat.grp.slice(), gooc: so.chat.gooc.slice(), hrp: so.chat.hrp.slice(), hooc: so.chat.hooc.slice(), crp: so.chat.crp.slice(), cooc: so.chat.cooc.slice(), rp: saved.rp.slice(), world: saved.world.slice(), notice: [{ id: 'n1', ch: 'notice', t: Date.now() / 1000, pid: 'system', name: '아카데미', house: 'system', grade: 0, kind: 'sys', text: '데모에 오신 것을 환영합니다. 운영진 공지와 월드 보스 토벌 소식이 이 탭에 올라옵니다.' }] }, online: 1, me: 'local' });
    h.status(true);
    var use = window.claude && window.claude.use;
    if (use) use('room').then(function (room) {
      if (!room) return;
      self._chat.room = room;
      room.on('chat', function (msg) {
        if (msg.isMe && msg.sameTab) return;
        var d = msg.data || {}; if (!d || typeof d.text !== 'string' || !self._chat.h) return;
        var ch = d.ch === 'rp' ? 'rp' : 'world';
        var m = { id: 'r' + (++self._chat.seq), ch: ch, t: Date.now() / 1000, pid: msg.peer, name: String(d.name || '이름 없음').slice(0, 12), house: String(d.house || ''), grade: +d.grade || 1, guest: !!msg.guest, kind: d.kind === 'me' ? 'me' : 'say', text: String(d.text).slice(0, ch === 'rp' ? 500 : 300), title: String(d.title || '').slice(0, 20) };
        (self._peers || (self._peers = {}))[m.pid] = { name: m.name, house: m.house, grade: m.grade, status: String(d.status || '').slice(0, 40) };
        keep(m); self._chat.h.msg(m);
      });
      room.onPeers(function (c) { self._chat.h.online(Math.max(1, c.peers.length)); });
    });
    return { close: function () { self._chat.h = null; }, live: false };
  };
  // 데모: 혼자 쓰는 데모에서는 내가 운영자다
  LocalApi.prototype.chatSlow = function (ch, sec) {
    var c = this._chat; if (!c) return Promise.resolve({ error: '채팅에 연결되지 않았습니다' });
    if (ch !== 'world') return Promise.resolve({ error: '슬로우 모드는 월드 채팅에만 걸 수 있습니다' });
    sec = Math.max(0, Math.min(600, Math.floor(+sec || 0))); c.slow = sec;
    if (c.h && c.h.slow) c.h.slow({ ch: 'world', sec: sec });
    return Promise.resolve({ ok: true, sec: sec });
  };
  LocalApi.prototype.chatSend = function (ch, text, kind, to, nonce) {
    var P = this.d && this.d.P, c = this._chat; if (!P || !c) return Promise.resolve({ error: '채팅에 연결되지 않았습니다' });
    c.seen = c.seen || {}; if (nonce && c.seen[nonce]) return Promise.resolve({ ok: true, id: c.seen[nonce], dup: true });
    var nowMs = Date.now(); if (c.lastAt && nowMs - c.lastAt < 500) return Promise.resolve({ error: '너무 잦은 요청입니다. 잠시 후 다시 전송', rate: true }); c.lastAt = nowMs;
    if (ch === 'notice' || ch === 'dm') return Promise.resolve({ error: ch === 'notice' ? '공지 채널에는 쓸 수 없습니다' : '데모에는 친구가 없어 1:1을 쓸 수 없습니다' });
    text = String(text || '').trim().slice(0, ch === 'world' ? 300 : 500); if (!text) return Promise.resolve({ error: '내용 입력 필요' });
    if (/^(party|grp|gooc|hrp|hooc|crp|cooc)$/.test(ch)) return this._groupSend(ch, text, kind).then(function (j) { if (nonce && j.id) c.seen[nonce] = j.id; return j; });
    var m = { id: 'l' + (++c.seq), ch: ch, t: Date.now() / 1000, pid: 'local', name: P.name, house: P.house, grade: P.grade, guest: true, kind: kind === 'me' ? 'me' : 'say', ink: Rules.decoView(this.d && this.d.P).ink || '', text: text, title: Rules.titleName(P, P.title), nonce: nonce };
    if (nonce) { c.seen[nonce] = m.id; var ks = Object.keys(c.seen); if (ks.length > 200) delete c.seen[ks[0]]; }
    c.keep(m); if (c.h) c.h.msg(m);
    if (c.room) c.room.emit('chat', { ch: ch, text: text, kind: m.kind, name: P.name, house: P.house, grade: P.grade, title: m.title, status: (this.d.prof && this.d.prof.status) || '' }).catch(function () { });
    return Promise.resolve({ ok: true, id: m.id });
  };
  // 데모 내 정보: 이 브라우저에만. 다른 학생 정보는 채팅 메시지에 실린 이름·기숙사·학년만 보여 준다.
  LocalApi.prototype.profile = function (id) {
    var P = this.d && this.d.P; if (!P) return Promise.resolve({ error: '로그인이 필요합니다' });
    if (!id || id === 'local' || id === P.id) {
      var pr = this.d.prof || {}, now = this._now(), s = Rules.summary(P, this.d.W, now);
      return Promise.resolve({ id: P.id, name: P.name, house: P.house, grade: P.grade, lvl: s.lvl, power: s.power, rank: 1, deco: Rules.decoView(P), badge: (function (b) { return b ? { gem: b.gem, lv: b.lv, name: b.name } : null; })(Rules.badgeWorn(P)), created: P.created, av: this.d.av ? 1 : 0,
        status: pr.status || '', bio: pr.bio || '', fav: pr.fav || '', avcredit: pr.avcredit || '', showStats: pr.showStats !== false, allowFriend: pr.allowFriend !== false, online: true, self: true });
    }
    var peer = (this._peers || {})[id];
    return Promise.resolve(peer ? Object.assign({ id: id, online: true, self: false, friend: null, demoPeer: true, av: 0 }, peer) : { error: '데모에서는 다른 학생의 정보를 볼 수 없습니다' });
  };
  LocalApi.prototype.saveProfile = function (o) {
    var pr = this.d.prof || (this.d.prof = {});
    if (o.status !== undefined) pr.status = String(o.status).replace(/\s+/g, ' ').trim().slice(0, 40);
    if (o.bio !== undefined) pr.bio = String(o.bio).trim().slice(0, 300);
    if (o.avcredit !== undefined) pr.avcredit = String(o.avcredit).replace(/\s+/g, ' ').trim().slice(0, 60);
    if (o.fav !== undefined) pr.fav = o.fav;
    if (o.showStats !== undefined) pr.showStats = !!o.showStats;
    if (o.allowFriend !== undefined) pr.allowFriend = !!o.allowFriend;
    this._save(); this._announce(); return Promise.resolve({ ok: true });
  };
  LocalApi.prototype.setAvatar = function (dataUrl) { this.d.av = dataUrl || null; this._save(); return Promise.resolve({ ok: true, av: dataUrl ? 1 : 0 }); };
  LocalApi.prototype.avatarUrl = function (id, v) { return v && this.d && this.d.av && (id === 'local' || (this.d.P && id === this.d.P.id)) ? this.d.av : ''; };
  // 데모 우편함: 입학 환영 우편, 별의 탑 보상 (이 브라우저에만)
  LocalApi.prototype._welcomeMail = function (name) { this.d.mail = { seq: 2, list: [{ id: 1, sender: '운영진', title: '모네타 아카데미에 오신 것을 환영합니다', body: name + ' 학생, 입학을 축하합니다.\n아카데미 생활에 보탬이 되도록 작은 선물을 보냅니다. 우편은 열어 봐도 보상은 나중에 받을 수 있습니다.\n\n— 아카데미 운영진', rewards: { shard: 30, stone: 10, gear: 1 }, created: Date.now() / 1000, expires: 32503647599, read: false, claimed: false, all: true }] }; };
  LocalApi.prototype._mailList = function () { if (this.d && this.d.P && !this.d.mail) this._welcomeMail(this.d.P.name); var m = this.d && this.d.mail; if (!m) return []; var real = Date.now() / 1000; return m.list.filter(function (x) { return x.expires > real; }); };
  LocalApi.prototype._sendMail = function (sender, title, body, rewards, days, pingAfter) { var self2 = this, m = this.d.mail || (this.d.mail = { seq: 1, list: [] }); var x = { id: m.seq++, sender: sender, title: title, body: body, rewards: Rules.cleanRewards(rewards), created: Date.now() / 1000, expires: Date.now() / 1000 + days * 86400, read: false, claimed: false }; m.list.unshift(x); this._save(); var h = this._chat && this._chat.h; if (h && h.mail) setTimeout(function () { var h2 = self2._chat && self2._chat.h; if (h2 && h2.mail) h2.mail({ id: x.id }); }, pingAfter || 50); return x; };
  LocalApi.prototype.mail = function () { var l = this._mailList(); return Promise.resolve({ mails: l.map(function (x) { return Object.assign({}, x); }), n: l.filter(function (x) { return !x.read; }).length }); };
  LocalApi.prototype.mailOp = function (o) {
    var P = this.d && this.d.P; if (!P) return Promise.resolve({ error: '로그인이 필요합니다' });
    var now = this._now(), l = this._mailList(), pick = o.op === 'claimAll' ? l.filter(function (x) { return !x.claimed; }) : l.filter(function (x) { return x.id === +o.id; });
    if (!pick.length && o.op !== 'claimAll') return Promise.resolve({ error: '없는 우편이거나 기한이 지났습니다' });
    if (o.op === 'read') { pick.forEach(function (x) { x.read = true; }); this._save(); return Promise.resolve({ ok: true }); }
    var W = this._world(now); Rules.advance(P, W, now); var got = [];
    pick.forEach(function (x) { if (x.claimed) return; x.claimed = true; x.read = true; var g = Rules.grantMail(P, W, now, x.rewards); Rules.log(P, now, '우편 「' + x.title + '」 보상을 받았습니다' + (g.text ? ': ' + g.text : ''), 'news'); got.push({ id: x.id, text: g.text, items: g.items }); });
    return this._ok(now, { ok: true, got: got });
  };
  // 데모 별샘 의식: 가상의 학생들이 하루 동안 조금씩 봉헌하고, 마지막 한 자리는 내가 채운다
  var RIT_GOAL = 12;
  LocalApi.prototype._rit = function (now) {
    var d = Rules.dayKST(now), P = this.d.P, r = this.d.rit; if (!r || r.day !== d) r = this.d.rit = { day: d, mine: false, done: 0 };
    var frac = (((now + 9 * 3600) % 86400) / 86400), others = Math.min(RIT_GOAL - 1, Math.floor(frac * RIT_GOAL * 1.15)), n = others + (r.mine ? 1 : 0);
    if (r.mine && !r.done && n >= RIT_GOAL) { r.done = now; Rules.ritualBless(P, now); Rules.log(P, now, '별샘 의식이 이루어졌습니다. ' + Rules.RITUAL_BUFF.text, 'story'); }
    return { n: n, goal: RIT_GOAL, done: r.done, mine: r.mine, cost: P ? Rules.ritualCost(P, this._world(now), now) : 0 };
  };
  LocalApi.prototype.ritual = function () {
    var now = this._now(), P = this.d && this.d.P; if (!P) return Promise.resolve({ error: '로그인이 필요합니다' });
    var W = this._world(now); Rules.advance(P, W, now); var v = this._rit(now), r = this.d.rit;
    if (r.mine) return Promise.resolve({ error: '오늘은 이미 봉헌했습니다' });
    var cost = Rules.ritualCost(P, W, now); if (P.res.mana < cost) return Promise.resolve({ error: '마나가 모자랍니다 (마나 ' + Rules.fmt(cost) + ' 필요)' });
    P.res.mana -= cost; P.res.shard += 1; r.mine = true; Rules.log(P, now, '별샘 의식에 마나 ' + Rules.fmt(cost) + '을(를) 봉헌했습니다 (별조각 +1)', 'news');
    if (r.done) Rules.ritualBless(P, now);
    v = this._rit(now);
    if (r.done === now && this._chat && this._chat.h) this._chat.h.msg({ id: 'r' + now, ch: 'notice', t: Date.now() / 1000, pid: 'system', name: '아카데미', house: 'system', grade: 0, kind: 'sys', text: '✦ 오늘의 별샘 의식이 이루어졌습니다! 봉헌한 모두에게 별샘의 축복 — ' + Rules.RITUAL_BUFF.text + '.' });
    return this._ok(now, { ok: true });
  };
  // 데모 떠돌이 상인: NPC 학생들이 시간이 갈수록 값을 올리고(한도까지), 내가 더 부르면 낙찰
  LocalApi.prototype._auc = function (now) {
    var v = Rules.auctionVisit(now), P = this.d.P, a = this.d.auc, self = this, Dd = D2();
    if (a) a.lots.forEach(function (l) {   // 지난 방문 정산
      if (l.done) return; var end = l.ends, np = npcAt(l, Math.min(now, end));
      if (l.my && np > l.my && !l.outbid) { P.res.gold += l.my; Rules.log(P, now, '떠돌이 상인: ' + l.name + ' — 더 높은 입찰이 나와 맡겨 둔 ' + Rules.fmt(l.my) + ' ' + CUR + '를 돌려받았습니다', 'news'); l.my = 0; var h = self._chat && self._chat.h; if (h && h.outbid) h.outbid({ name: l.name }); }
      if (now >= end) { l.done = true; if (l.my) self._sendMail('떠돌이 상인', '낙찰: ' + l.name, P.name + ' 님, ' + Rules.fmt(l.my) + ' ' + CUR + '에 낙찰되었습니다. 좋은 주인을 만나 다행이군요.\n— 떠돌이 상인', { items: [l.item] }, 14); }
    });
    if (v && v.active && (!a || a.visit !== v.id)) {
      var dummy = { rng: (Math.random() * 2147483647) | 1 }, stage = Math.max(1, Math.min(P.maxStage, Rules.stageCap(P))) + 3, N = Dd.RIVALS.slice(0, 10);
      a = this.d.auc = { visit: v.id, lots: [3, 3, Math.random() < 0.5 ? 4 : 3].map(function (r, i) { var it = Rules.makeItem(dummy, Dd.SLOTS[Math.floor(Math.random() * Dd.SLOTS.length)].id, stage, r, r), min = Math.max(50, Rules.sellPrice(it) * 8); return { id: v.id * 10 + i, item: it, name: it.name, r: it.r, ilvl: it.ilvl, slot: it.slot, min: min, cap: Math.floor(min * (1.6 + Math.random() * 1.2)), start: v.start, ends: v.end, npc: N[Math.floor(Math.random() * N.length)].name, my: 0, bids: 0 }; }) };
    }
    return a && a.visit === (v && v.id) ? a : null;
  };
  function npcAt(l, t) { var p = (t - l.start) / (l.ends - l.start); if (p < 0.06) return 0; var price = 0, target = l.min + (l.cap - l.min) * Math.min(1, p * 1.3); while (true) { var nx = Rules.auctionStep(price, l.min); if (nx > target) break; price = nx; } return price; }
  function aucLot(l, now) { var np = npcAt(l, now), top = Math.max(np, l.my), mine = l.my && l.my >= np; return { id: l.id, name: l.name, r: l.r, ilvl: l.ilvl, slot: l.slot, item: l.item, ends: l.ends, min: l.min, price: top, need: Rules.auctionStep(top, l.min), bidder: top ? (mine ? '나' : l.npc) : '', mine: !!mine, npc: !mine && !!top, bids: (np ? Math.round(Math.log(np / l.min) / Math.log(1.05)) + 1 : 0) + l.bids, done: !!l.done }; }
  LocalApi.prototype.auction = function () {
    var now = this._now(), P = this.d && this.d.P; if (!P) return Promise.resolve({ error: '로그인이 필요합니다' });
    var a = this._auc(now); this._save();
    return Promise.resolve({ now: now, visit: Rules.auctionVisit(now), lots: a ? a.lots.map(function (l) { return aucLot(l, now); }) : [], recent: [], demo: true });
  };
  LocalApi.prototype.bid = function (id, amount) {
    var now = this._now(), P = this.d && this.d.P; if (!P) return Promise.resolve({ error: '로그인이 필요합니다' });
    Rules.advance(P, this._world(now), now); var a = this._auc(now), l = a && a.lots.find(function (x) { return x.id === id; });
    if (!l || l.done || now >= l.ends) return Promise.resolve({ error: '경매가 끝났습니다' });
    var cur = aucLot(l, now); if (cur.mine) return Promise.resolve({ error: '이미 가장 높은 값을 부른 상태입니다' });
    amount = Math.floor(+amount); if (!(amount >= cur.need)) return Promise.resolve({ error: Rules.fmt(cur.need) + ' ' + CUR + ' 이상 불러야 합니다' });
    if (P.res.gold < amount) return Promise.resolve({ error: CUR + '가 모자랍니다' });
    P.res.gold -= amount; l.my = amount; l.outbid = false; l.bids++; if (l.ends - now < Rules.AUCTION_SNIPE) l.ends = now + Rules.AUCTION_SNIPE;
    Rules.log(P, now, '떠돌이 상인: ' + l.name + '에 ' + Rules.fmt(amount) + ' ' + CUR + '를 불렀습니다 (낙찰되지 않으면 돌려받습니다)', 'news');
    return this._ok(now, { ok: true, lot: aucLot(l, now) });
  };
  // 데모 전용 테스트 도구 (서버에는 이런 기능이 없다)
  LocalApi.prototype.cheat = function (op) {
    var now = this._now(), P = this.d && this.d.P; if (!P) return Promise.resolve({ error: '로그인이 필요합니다' });
    var W = this._world(now); Rules.advance(P, W, now); var msg = '';
    if (op === 'grade') { if (P.grade >= 8) return Promise.resolve({ error: '이미 마스터 과정입니다' }); P.grade++; if (P.grade > P.st.maxGrade) P.st.maxGrade = P.grade; if (P.grade === 3 && !Object.keys(P.fam.own).length) P.fam.eggs++; msg = R2(P) + '이 되었습니다'; }
    else if (op === 'res') { P.res.gold += Math.max(1e5, P.res.gold * 9); P.res.mana += Rules.calc(P, W, now).manaCap; P.res.know += Math.max(1e5, P.res.know * 9); P.res.stone += 200; P.res.shard += 500; Object.keys(D2().MATS).forEach(function (k) { P.mats[k] = (P.mats[k] || 0) + 60; }); msg = '자원을 넉넉히 넣었습니다'; }
    else if (op === 'lvl') { for (var i = 0; i < 10; i++) { P.lvl++; P.pts += 2; } if (P.lvl > P.st.maxLevel) P.st.maxLevel = P.lvl; if (P.opt.autoAlloc) Rules.autoAlloc(P); msg = '레벨 ' + P.lvl; }
    else if (op === 'subj') { Rules.availableSubjects(P).forEach(function (s) { P.subj[s.id].lv += 5; }); msg = '들을 수 있는 과목 모두 +5레벨'; }
    else if (op === 'stage') { P.maxStage = Math.max(P.maxStage, Rules.stageCap(P)); if (P.maxStage > P.st.maxStageAll) P.st.maxStageAll = P.maxStage; msg = P.maxStage + '단계까지 열었습니다'; }
    else if (op === 'finish') { var t = now - 1; if (P.dream) P.dream.end = Math.min(P.dream.end, t); P.lec.forEach(function (j) { if (j) j.end = Math.min(j.end, t); }); P.exp.forEach(function (j) { if (j) j.end = Math.min(j.end, t); }); P.rsq.forEach(function (q) { if (q) q.end = Math.min(q.end, t); }); for (var k in P.fam.disp) P.fam.disp[k].end = Math.min(P.fam.disp[k].end, t); P.examCd = 0; P.bossCd = 0; P.duel.cd = 0; Rules.advance(P, W, now + 0.5); msg = '진행 중인 작업을 모두 끝냈습니다'; }
    else if (op === 'spirit') { P.spirit = { n: Rules.K.SPIRIT_JAR, at: now }; P.wb.tickets = Rules.K.WB_TICKET_MAX; if (P.tw) P.tw.used = 0; P.daily.rr = 0; msg = '정령 병·도전권·탑 도전 횟수를 채웠습니다'; }
    else return Promise.resolve({ error: '알 수 없는 도구' });
    Rules.log(P, now, '[테스트 도구] ' + msg, 'news');
    return this._ok(now, { ok: true, msg: msg });
  };
  function R2(P) { return Rules.gradeLabel(P); }
  LocalApi.prototype.friends = function () { return Promise.resolve({ friends: [], out: [], inc: [], demo: true }); };
  LocalApi.prototype.friendOp = function () { return Promise.resolve({ error: '데모에서는 친구를 맺을 수 없습니다. 서버를 열면 사용할 수 있습니다' }); };
  LocalApi.prototype._announce = function () { };
  /* ── 데모 파티·동아리: 다른 학생 대신 NPC 학생(결투제 대진표)과 함께 시험해 볼 수 있다 ── */
  var NPC_HOUSE = { '등불관': 'lanterna', '물시계관': 'clepsydra', '가시왕관관': 'corona', '거울관': 'speculum' };
  function npcs() { return D2().RIVALS.map(function (r, k) { var h = Object.keys(NPC_HOUSE).filter(function (x) { return r.who.indexOf(x) >= 0; })[0], g = /(\d)학년/.exec(r.who); return { k: k, name: r.name, who: r.who, hello: r.hello, house: h ? NPC_HOUSE[h] : 'system', grade: g ? +g[1] : 8, lvl: Math.round(r.stage * 1.4) }; }); }
  var NPC_LINES = ['좋아, 다음 원정은 어디로 갈까?', '나는 숲 쪽이 좋더라. *지도를 펼친다*', '잠깐, 물약 챙겼어?', '*지팡이 끝에 작은 불을 밝힌다* 이 정도면 보이겠지.', '오늘 별샘이 유난히 밝네.', '시험 공부는 잘 되고 있어?', '배고프다… 매점 부엉이한테 뭐 좀 사 올까?', '*고개를 끄덕인다* 그렇게 하자.', '저번에 저장고에서 이상한 소리 들었어. 너도 들었어?', '하하, 그건 좀 무모한데!'];
  var OOC_LINES = ['(오너) 오늘 접속 늦어요~', '(오너) 저 내일 시험이라 잠깐만 들를게요 ㅠㅠ', '(오너) 다들 RP 시간 언제가 편하세요?', '(오너) ㅋㅋㅋ 방금 장면 너무 좋았어요', '(오너) 밥 먹고 올게요!', '(오너) 이번 주말에 동아리 이벤트 할까요?'];
  LocalApi.prototype._soc = function () { var d = this.d; if (!d.soc) d.soc = { party: null, guild: null, chat: { party: [], grp: [], gooc: [] } }; if (!d.soc.chat.recruit) d.soc.chat.recruit = []; ['hrp', 'hooc', 'crp', 'cooc'].forEach(function (k) { if (!d.soc.chat[k]) d.soc.chat[k] = []; }); return d.soc; };
  LocalApi.prototype._partyView = function () {
    var so = this._soc(), P = this.d.P, pa = so.party; if (!pa) return null; var N = npcs();
    return { id: 'demo-party', name: pa.name, leader: P.id, allgo: !!pa.allgo, max: 4, bonus: 0, members: [{ id: P.id, name: P.name, house: P.house, grade: P.grade, lvl: P.lvl, av: this.d.av ? 1 : 0, online: true, leader: true, title: Rules.titleName(P, P.title) }].concat(pa.npcs.map(function (k) { var n = N[k]; return { id: 'npc:' + k, npc: true, online: true, name: n.name, who: n.who, house: n.house, grade: n.grade, lvl: n.lvl, title: 'NPC' }; })), npcPool: N.map(function (n) { return { k: n.k, name: n.name, who: n.who }; }) };
  };
  LocalApi.prototype.party = function () { return Promise.resolve({ party: this._partyView(), invites: [], max: 4, demo: true }); };
  LocalApi.prototype._sys = function (ch, text) { var m = { id: 's' + Date.now() + Math.random(), ch: ch, t: Date.now() / 1000, pid: 'system', name: '아카데미', house: 'system', grade: 0, kind: 'sys', text: text }; this._keepSoc(m); return m; };
  LocalApi.prototype._keepSoc = function (m) { var c = this._soc().chat[m.ch]; c.push(m); if (c.length > 80) c.shift(); this._save(); if (this._chat && this._chat.h) this._chat.h.msg(m); };
  LocalApi.prototype._npcSay = function (ch, k, text) { var n = npcs()[k]; this._keepSoc({ id: 'n' + Date.now() + Math.random(), ch: ch, t: Date.now() / 1000, pid: 'npc:' + k, name: n.name, house: n.house, grade: n.grade, kind: 'say', text: text, title: 'NPC' }); };
  LocalApi.prototype._emitGroup = function (kind) { var so = this._soc(), h = this._chat && this._chat.h; if (!h) return; if (kind === 'party' && h.party) h.party({ party: so.party ? 'demo-party' : null, msgs: so.chat.party.slice() }); if (kind === 'guild' && h.guild) h.guild({ guild: so.guild ? so.guild.id : null, grp: so.chat.grp.slice(), gooc: so.chat.gooc.slice() }); };
  LocalApi.prototype.partyOp = function (o) {
    var so = this._soc(), P = this.d.P, self = this, N = npcs();
    if (o.op === 'create') { var nm = String(o.name || '').replace(/\s+/g, ' ').trim(); if (!/^[가-힣A-Za-z0-9_ ]{2,12}$/.test(nm)) return Promise.resolve({ error: '파티 이름은 한글·영문·숫자 2~12자만 가능' }); if (so.party) return Promise.resolve({ error: '이미 파티에 들어가 있습니다' }); so.party = { name: nm, npcs: [] }; so.chat.party = []; this._emitGroup('party'); this._sys('party', P.name + ' 님이 파티 「' + nm + '」를 만들었습니다.'); }
    else if (!so.party) return Promise.resolve({ error: '파티 생성 필요' });
    else if (o.op === 'npcAdd') { if (so.party.npcs.length >= 3) return Promise.resolve({ error: '파티는 4명까지입니다' }); if (so.party.npcs.indexOf(o.k) < 0) so.party.npcs.push(o.k); this._npcSay('party', o.k, N[o.k].hello); }
    else if (o.op === 'npcRemove') { so.party.npcs = so.party.npcs.filter(function (k) { return k !== o.k; }); this._sys('party', N[o.k].name + ' 님이 파티에서 나갔습니다.'); }
    else if (o.op === 'allgo') { so.party.allgo = !!o.on; }
    else if (o.op === 'leave') { so.party = null; so.tower = null; so.chat.party = []; this._emitGroup('party'); }
    else if (o.op === 'invite') return Promise.resolve({ error: '데모에는 다른 학생이 없습니다. 「아카데미 친구 부르기」로 NPC를 불러 보세요' });
    else return Promise.resolve({ error: '데모에서는 할 수 없습니다' });
    this._save(); return Promise.resolve({ ok: true, party: this._partyView() });
  };
  // 데모 별의 탑: 나 + NPC 파티원 (NPC는 내 힘의 30%씩)
  LocalApi.prototype._towerCore = function (now) {
    var so = this._soc(), P = this.d.P, pa = so.party; if (!pa) return null; var N = npcs(), W = this._world(now), c0 = Rules.calc(P, W, now), wk = Rules.weekId(now);
    var tw = so.tower; if (!tw || tw.week !== wk) tw = so.tower = { week: wk, floor: 0, base: null, log: [] };
    var team = [{ id: P.id, name: P.name, house: P.house, dps: c0.totalDps, hp: c0.hp, def: c0.def, me: true }].concat(pa.npcs.map(function (k) { return { id: 'npc:' + k, name: N[k].name, house: N[k].house, npc: true, dps: c0.totalDps * Rules.NPC_FRAC.tower, hp: c0.hp * Rules.NPC_FRAC.tower, def: c0.def }; }));
    var real = Date.now() / 1000, last = tw.log[tw.log.length - 1], playing = last && last.sc && last.t + last.d > real ? { name: last.name, f: last.f, left: Math.ceil(last.t + last.d - real) } : null, shown = playing && last.win ? tw.floor - 1 : tw.floor;
    var base = tw.base || Rules.towerBase([P.maxStage]), f = shown + 1, foe = Rules.towerFoe(f, base), c2 = Rules.towerTeam(c0, team);
    return { tw: tw, team: team, c0: c0, c2: c2, base: base, f: f, foe: foe, W: W, playing: playing, shown: shown };
  };
  LocalApi.prototype.tower = function () {
    var now = this._now(), P = this.d.P, x = this._towerCore(now); if (!x) return Promise.resolve({ party: null });
    return Promise.resolve({ party: 'demo-party', week: x.tw.week, weekEnd: Rules.weekStart(x.tw.week + 1), floor: x.shown, playing: x.playing, now: Date.now() / 1000, base: x.base, fixed: !!x.tw.base, log: x.tw.log.slice(-12).reverse(), left: Rules.towerLeft(P, now), tries: Rules.TOWER_TRIES, myBest: Rules.towerBest(P, now),
      team: x.team.map(function (m) { return { id: m.id, name: m.name, house: m.house, npc: !!m.npc, dps: m.dps, me: !!m.me }; }), teamDps: x.c2.totalDps, teamHp: x.c2.hp, demo: true,
      next: { floor: x.f, stage: x.foe.stage, name: x.foe.name, arch: x.foe.arch, c1: x.foe.c1, c2: x.foe.c2, hp: x.foe.hp, est: Rules.towerEstimate(x.c2, x.foe), reward: Rules.towerReward(x.f, x.base) } });
  };
  LocalApi.prototype.towerOp = function () {
    var now = this._now(), P = this.d.P; Rules.advance(P, this._world(now), now); var x = this._towerCore(now); if (!x) return Promise.resolve({ error: '파티에 들어가 있어야 별의 탑에 오를 수 있습니다' });
    if (Rules.towerLeft(P, now) <= 0) return Promise.resolve({ error: '오늘 도전 횟수를 다 썼습니다 (매일 자정에 ' + Rules.TOWER_TRIES + '번으로 돌아옵니다)' });
    if (x.playing) return Promise.resolve({ error: x.playing.name + ' 님이 ' + x.playing.f + '층에 도전하는 중입니다. 함께 지켜보세요 (' + x.playing.left + '초 남음)', _status: 409 });
    Rules.towerUse(P, now); var r = Rules.towerFight(P, x.c2, x.foe), tw = x.tw, self = this; tw.base = x.base;
    var sc = Rules.towerScript({ name: P.name, f: x.f, foe: x.foe, team: x.team, r: r, hp: x.c2.hp }), t0 = Date.now() / 1000, after = sc.d * 1000;
    tw.log.forEach(function (l, i) { if (i < tw.log.length - 4) { delete l.sc; delete l.d; } });
    tw.log.push({ t: t0, name: P.name, f: x.f, win: !!r.win, pct: Math.round((1 - r.mHp) * 100), sc: sc.lines, d: sc.d }); if (tw.log.length > 30) tw.log.shift();
    var reward = null, later = function (fn) { setTimeout(fn, after); };
    if (r.win) { tw.floor = x.f; reward = Rules.towerReward(x.f, x.base); var pn = this._soc().party.name, ff = x.f, fname = x.foe.name; if (Rules.towerClaim(P, now, x.f)) (function () { self._sendMail('별의 탑', '별의 탑 ' + ff + '층 돌파', P.name + ' 님이 파티 「' + pn + '」의 힘을 모아 별의 탑 ' + ff + '층의 ' + fname + '을(를) 쓰러뜨렸습니다.\n그때 파티에 있던 모두에게 보내는 보상입니다.', reward, 7, after); })(); later(function () { self._sys('party', '✦ ' + P.name + ' 님이 별의 탑 ' + ff + '층을 넘었습니다! 파티원 모두에게 보상 우편이 갔습니다.'); }); Rules.log(P, now, '별의 탑 ' + x.f + '층 돌파', 'good'); }
    else { var lf = x.f, lp = Math.round((1 - r.mHp) * 100); later(function () { self._sys('party', P.name + ' 님이 별의 탑 ' + lf + '층에 도전했지만 물러났습니다 (' + lp + '%)'); }); }
    this._save();
    return this._ok(now, { r: { sc: sc.lines, d: sc.d, t0: t0, win: !!r.win, ev: r.ev, mHp: r.mHp, dead: !!r.dead, floor: x.f, foe: { name: x.foe.name, arch: x.foe.arch, c1: x.foe.c1, c2: x.foe.c2, id: x.foe.id }, maxHp: x.foe.hp, reward: reward ? Rules.rewardText(reward) : '' } });
  };
  // 데모 동아리: 직접 만들거나, 미리 있는 NPC 동아리에 들어갈 수 있다 (레벨·기여도·계급·창고까지 서버와 같은 규칙)
  var DEMO_GUILDS = [{ id: 'npc-g1', name: '별빛 관측회', intro: '밤마다 천문대 옥상에서 별샘을 관측합니다. 누구나 환영!', color: '#8fa8ff', mode: 'open', npcs: [1, 4, 7], lv: 3, xp: 420 }, { id: 'npc-g2', name: '결투 연구회', intro: '가시왕관관 주최. 결투제 대비 합동 연습. 가입은 신청 후 승인.', color: '#d9736b', mode: 'apply', npcs: [2, 5], lv: 2, xp: 150 }];
  function gFix(g) {   // 예전 데모 저장본에 새 칸 채우기
    if (g.lv == null) { g.lv = 1; g.xp = 0; } if (g.gold == null) g.gold = 0; if (!g.items) g.items = []; if (!g.log) g.log = []; if (!g.ranks) g.ranks = Rules.guildDefRanks(); if (!g.nr) g.nr = {}; if (g.contrib == null) g.contrib = 0; if (!g.nc) g.nc = {}; if (g.myRank == null) g.myRank = '';
    return g;
  }
  LocalApi.prototype._gLog = function (text) { var g = this._soc().guild; g.log.unshift({ t: Date.now() / 1000, text: text }); if (g.log.length > 60) g.log.length = 60; };
  LocalApi.prototype._gXp = function (x) { var g = this._soc().guild, ups = Rules.guildAddXp(g, x); if (ups) { this._sys('grp', '✦ 동아리가 ' + g.lv + '레벨이 되었습니다! 정원 ' + Rules.guildCap(g.lv) + '명 · 창고 ' + Rules.guildSlots(g.lv) + '칸'); this._gLog('동아리 ' + g.lv + '레벨 달성'); } this.d.P.guildLv = g.lv; };
  LocalApi.prototype._guildView = function () {
    var so = this._soc(), P = this.d.P, g = so.guild; if (!g) { P.guildLv = 0; return null; } gFix(g); var N = npcs(), day = Rules.dayKST(this._now()), ranks = g.ranks;
    P.guildLv = g.lv;
    var mem = [{ id: P.id, role: g.role, rank: g.myRank, contrib: g.contrib, name: P.name, house: P.house, grade: P.grade, lvl: P.lvl, av: this.d.av ? 1 : 0, title: Rules.titleName(P, P.title), online: true }].concat(g.npcs.map(function (k, i) {
      var n = N[k], rr = g.nr[k] || {}, role = rr.role || (g.role === 'owner' || g.role === 'officer' && g.own ? 'member' : (i === 0 ? 'owner' : 'member'));
      return { id: 'npc:' + k, npc: true, role: role, rank: rr.rank || '', contrib: g.nc[k] || (37 * (k + 3)) % 400, name: n.name, house: n.house, grade: n.grade, lvl: n.lvl, title: 'NPC', online: true };
    }));
    mem.forEach(function (m) { m.rankName = Rules.guildRankName(ranks, m.role, m.rank); });
    var perms = {}; Rules.GUILD_PERMS.forEach(function (k) { perms[k[0]] = Rules.guildCan(ranks, g.role, g.myRank, k[0]); });
    return { id: g.id, name: g.name, intro: g.intro, notice: g.notice || '', color: g.color, mode: g.mode, n: mem.length, max: Rules.guildCap(g.lv), myRole: g.role, demo: true, apps: [],
      lv: g.lv, xp: Math.floor(g.xp), need: Rules.guildXpNeed(g.lv), maxLv: Rules.GUILD_MAX_LV, bonus: Rules.guildBonus(g.lv), ranks: ranks, myRank: g.myRank, myRankName: Rules.guildRankName(ranks, g.role, g.myRank), perms: perms,
      my: { contrib: g.contrib, checkin: g.cday === day, dpts: g.dday === day ? g.dpts : 0, cap: Rules.GUILD_DONATE_CAP, unit: Rules.guildGoldUnit(P), bonusIn: Rules.GUILD_CHECKIN },
      gold: g.gold, slots: Rules.guildSlots(g.lv), items: g.items.map(function (x) { return { id: x.id, name: x.item.name + (x.item.enh ? ' +' + x.item.enh : ''), r: x.item.r, ilvl: x.item.ilvl, slot: x.item.slot, by: x.by, t: x.t, item: x.item }; }), log: g.log.slice(0, 30),
      members: mem };
  };
  LocalApi.prototype.guilds = function () { var so = this._soc(), mine = so.guild ? so.guild.id : null; var list = DEMO_GUILDS.map(function (g) { return { id: g.id, name: g.name, intro: g.intro, color: g.color, mode: g.mode, n: g.npcs.length, max: Rules.guildCap(g.lv), lv: g.lv, owner: npcs()[g.npcs[0]].name, mine: g.id === mine }; }); if (so.guild && so.guild.own) list.unshift({ id: so.guild.id, name: so.guild.name, intro: so.guild.intro, color: so.guild.color, mode: so.guild.mode, n: 1 + so.guild.npcs.length, max: Rules.guildCap(so.guild.lv || 1), lv: so.guild.lv || 1, owner: this.d.P.name, mine: true }); return Promise.resolve({ list: list, mine: mine, demo: true, invites: [] }); };
  LocalApi.prototype.guildRank = function (sort) {
    var so = this._soc(), self = this, rows = DEMO_GUILDS.map(function (g) { return { id: g.id, name: g.name, intro: g.intro, color: g.color, mode: g.mode, lv: g.lv, xp: g.xp, n: g.npcs.length, max: Rules.guildCap(g.lv), power: g.npcs.reduce(function (a, k) { return a + Math.round(Math.pow(npcs()[k].lvl, 2.2) * 40); }, 0), owner: npcs()[g.npcs[0]].name }; });
    if (so.guild && so.guild.own) { var me = Rules.summary(this.d.P, null, Date.now() / 1000); if (!so.guild.created) { so.guild.created = Date.now() / 1000; this._save(); } rows.push({ id: so.guild.id, name: so.guild.name, intro: so.guild.intro || '', created: so.guild.created, color: so.guild.color, mode: so.guild.mode, lv: so.guild.lv || 1, xp: Math.floor(so.guild.xp || 0), n: 1 + so.guild.npcs.length, max: Rules.guildCap(so.guild.lv || 1), power: Math.round(me.power), owner: this.d.P.name }); }
    rows.sort(sort === 'power' ? function (a, b) { return b.power - a.power; } : function (a, b) { return b.lv - a.lv || b.xp - a.xp; }); rows.forEach(function (r, i) { r.rank = i + 1; });
    var mine = so.guild ? rows.filter(function (r) { return r.id === so.guild.id; })[0] : null;
    return Promise.resolve({ sort: sort === 'power' ? 'power' : 'lv', list: rows, mine: mine || null, total: rows.length, demo: true });
  };
  LocalApi.prototype.guild = function () { return Promise.resolve({ guild: this._guildView() }); };
  LocalApi.prototype.guildOp = function (o) {
    var so = this._soc(), P = this.d.P, N = npcs(), self = this, now = this._now(), day = Rules.dayKST(now);
    function fail(m) { return Promise.resolve({ error: m }); }
    if (o.op === 'create') { if (so.guild) return fail('이미 동아리에 들어가 있습니다'); var nm = String(o.name || '').replace(/\s+/g, ' ').trim(); if (!/^[가-힣A-Za-z0-9_ ]{2,12}$/.test(nm)) return fail('동아리 이름은 한글·영문·숫자 2~12자만 가능');
      so.guild = gFix({ id: 'demo-g', own: true, name: nm, intro: String(o.intro || '').slice(0, 300), color: o.color || '#d6ad5f', mode: o.mode === 'apply' ? 'apply' : 'open', role: 'owner', npcs: [], notice: '' }); so.chat.grp = []; so.chat.gooc = []; this._emitGroup('guild'); this._sys('grp', P.name + ' 님이 동아리 「' + nm + '」를 열었습니다.'); this._gLog(P.name + ' 님이 동아리를 열었습니다'); }
    else if (o.op === 'join') { if (so.guild) return fail('현재 동아리 탈퇴 필요'); var g0 = DEMO_GUILDS.filter(function (x) { return x.id === o.id; })[0]; if (!g0) return fail('없는 동아리입니다');
      so.guild = gFix({ id: g0.id, name: g0.name, intro: g0.intro, color: g0.color, mode: g0.mode, role: 'member', npcs: g0.npcs.slice(), notice: '', lv: g0.lv, xp: g0.xp, gold: 12000 * g0.lv }); so.chat.grp = []; so.chat.gooc = []; this._emitGroup('guild'); this._sys('grp', P.name + ' 님이 동아리에 들어왔습니다.'); this._gLog(P.name + ' 님 가입'); setTimeout(function () { self._npcSay('grp', g0.npcs[0], '어서 와! *반갑게 손을 흔든다*'); }, 1500); }
    else if (o.op === 'cancelApp' || o.op === 'inviteDecline') return Promise.resolve({ ok: true });
    else if (o.op === 'inviteAccept') return fail('데모에는 받은 초대가 없습니다');
    else if (!so.guild) return fail('동아리에 들어가 있지 않습니다');
    else {
      var g = gFix(so.guild), role = g.role, staff = role === 'owner' || role === 'officer', can = function (p) { return Rules.guildCan(g.ranks, role, g.myRank, p); };
      var k = o.pid ? +String(o.pid).slice(4) : -1, tr = k >= 0 ? (g.nr[k] || (g.nr[k] = {})) : null, tRole = tr ? (tr.role || 'member') : null;
      if (o.op === 'leave') { if (role === 'owner' && g.npcs.length) return fail('부원이 있으면 회장은 나갈 수 없습니다. 먼저 회장 위임 필요'); if (role === 'owner') return fail('혼자 남은 회장은 「동아리 닫기」로 정리 필요'); so.guild = null; so.chat.grp = []; so.chat.gooc = []; P.guildLv = 0; this._emitGroup('guild'); this._save(); return Promise.resolve({ ok: true, guild: null }); }
      if (o.op === 'disband') {
        if (role !== 'owner') return fail('회장만 동아리를 닫을 수 있습니다'); if (g.npcs.length) return fail('부원이 남아 있으면 닫을 수 없습니다. 회장을 넘기거나 모두 나간 뒤에 닫기 가능');
        var its = g.items.map(function (x) { return x.item; }); for (var i = 0; i < Math.max(its.length, g.gold > 0 ? 1 : 0); i += 10) this._sendMail('동아리', '「' + g.name + '」 창고 정리', '동아리를 닫아 창고에 남아 있던 것을 돌려드립니다.', { gold: i === 0 ? Math.floor(g.gold) : 0, items: its.slice(i, i + 10) }, 30);
        so.guild = null; so.chat.grp = []; so.chat.gooc = []; P.guildLv = 0; this._emitGroup('guild'); this._save(); return Promise.resolve({ ok: true, guild: null });
      }
      if (o.op === 'edit') { if (!can('notice')) return fail('공지·소개를 고칠 권한이 없습니다'); if (o.intro !== undefined) g.intro = String(o.intro).slice(0, 300); if (o.notice !== undefined) { var nn = String(o.notice).slice(0, 300); if (nn && nn !== g.notice) this._sys('grp', '동아리 공지: ' + nn); g.notice = nn; } if (staff && o.color) g.color = o.color; if (staff && o.mode) g.mode = o.mode; }
      else if (o.op === 'npcAdd') { if (!staff) return fail('회장·부회장만 부를 수 있습니다'); if (1 + g.npcs.length >= Rules.guildCap(g.lv)) return fail('정원이 가득 찼습니다'); if (g.npcs.indexOf(o.k) < 0) g.npcs.push(o.k); this._npcSay('grp', o.k, N[o.k].hello); this._gLog(N[o.k].name + ' 님 가입'); }
      else if (o.op === 'kick') { var okk = role === 'owner' ? tRole !== 'owner' : (staff || can('kick')) && tRole === 'member'; if (!okk) return fail('내보낼 권한이 없습니다'); g.npcs = g.npcs.filter(function (x) { return x !== k; }); delete g.nr[k]; this._sys('grp', N[k].name + ' 님이 동아리에서 나갔습니다.'); this._gLog(P.name + ' 님이 ' + N[k].name + ' 님을 내보냈습니다'); }
      else if (o.op === 'role') { if (role !== 'owner') return fail('회장만 부회장을 정할 수 있습니다'); var nr = o.role === 'officer' ? 'officer' : 'member'; if (nr === 'officer' && tRole !== 'officer' && g.npcs.filter(function (x) { return (g.nr[x] || {}).role === 'officer'; }).length >= 2) return fail('부회장은 2명까지입니다'); tr.role = nr; tr.rank = ''; this._gLog(N[k].name + ' 님 → ' + (nr === 'officer' ? '부회장' : g.ranks.base.name)); if (nr === 'officer') this._sys('grp', N[k].name + ' 님이 부회장이 되었습니다.'); }
      else if (o.op === 'setrank') { if (!staff) return fail('회장·부회장만 계급을 정할 수 있습니다'); if (tRole !== 'member') return fail('회장·부회장에게는 계급을 줄 수 없습니다'); tr.rank = String(o.rank || ''); this._gLog(N[k].name + ' 님 → ' + Rules.guildRankName(g.ranks, 'member', tr.rank)); }
      else if (o.op === 'ranks') { if (role !== 'owner') return fail('회장만 계급을 고칠 수 있습니다'); var nrk = Rules.guildCleanRanks(o.ranks); Object.keys(g.nr).forEach(function (x) { if (g.nr[x].rank && !nrk.list.some(function (y) { return y.id === g.nr[x].rank; })) g.nr[x].rank = ''; }); g.ranks = nrk; this._gLog(P.name + ' 님이 계급을 고쳤습니다'); }
      else if (o.op === 'transfer') { if (role !== 'owner') return fail('회장만 넘길 수 있습니다'); tr.role = 'owner'; tr.rank = ''; g.role = 'officer'; g.myRank = ''; this._sys('grp', N[k].name + ' 님이 새 회장이 되었습니다.'); this._gLog(P.name + ' 님이 ' + N[k].name + ' 님에게 회장을 넘겼습니다'); }
      else if (o.op === 'invite') return fail('데모에는 초대할 다른 학생이 없습니다. 부원 탭에서 NPC를 불러 보세요');
      else if (o.op === 'accept' || o.op === 'reject') return fail('데모에는 가입 신청이 없습니다');
      else if (o.op === 'checkin') { if (g.cday === day) return fail('오늘은 이미 동아리 출석을 했습니다'); g.cday = day; g.contrib += Rules.GUILD_CHECKIN; this._gXp(Rules.GUILD_CHECKIN); this._gLog(P.name + ' 님 출석 (+' + Rules.GUILD_CHECKIN + ')'); this._save(); return Promise.resolve({ ok: true, got: Rules.GUILD_CHECKIN, guild: this._guildView() }); }
      else {
        Rules.advance(P, this._world(now), now);
        if (o.op === 'donate') {
          var unit = Rules.guildGoldUnit(P), used = g.dday === day ? g.dpts : 0, room = Rules.GUILD_DONATE_CAP - used;
          if (room <= 0) return fail('오늘 기부 한도(' + Rules.GUILD_DONATE_CAP + '점)를 다 채웠습니다');
          var pts = Math.min(room, Math.floor(Math.max(0, +o.gold || 0) / unit), Math.floor(P.res.gold / unit)); if (pts <= 0) return fail('기여도 1점은 ' + CUR + ' ' + Rules.fmt(unit) + '입니다');
          P.res.gold -= pts * unit; g.dday = day; g.dpts = used + pts; g.contrib += pts; this._gXp(pts); this._gLog(P.name + ' 님 기부 ' + Rules.fmt(pts * unit) + ' ' + CUR + ' (+' + pts + ')');
          this._save(); return this._ok(now, { ok: true, got: pts, cost: pts * unit, guild: this._guildView() });
        }
        if (o.op === 'deposit') {
          if (o.u) { var ii = P.inv.findIndex(function (x) { return x.u === o.u; }); if (ii < 0) return fail('가방에 없는 장비입니다'); if (P.inv[ii].lock) return fail('잠긴 장비는 넣을 수 없습니다'); if (g.items.length >= Rules.guildSlots(g.lv)) return fail('창고가 가득 찼습니다'); var it = P.inv.splice(ii, 1)[0]; g.items.push({ id: (g.iseq = (g.iseq || 0) + 1), item: it, by: P.name, t: now }); this._gLog(P.name + ' 님이 ' + it.name + '을(를) 넣었습니다'); }
          else { var amt = Math.floor(+o.gold || 0); if (!(amt >= 1) || amt > P.res.gold) return fail(CUR + '를 확인 필요'); P.res.gold -= amt; g.gold += amt; this._gLog(P.name + ' 님이 ' + Rules.fmt(amt) + ' ' + CUR + '를 넣었습니다'); }
          this._save(); return this._ok(now, { ok: true, guild: this._guildView() });
        }
        if (o.op === 'withdraw') {
          if (!can('take')) return fail('창고에서 꺼낼 권한이 없습니다');
          if (o.id) { var xi = g.items.findIndex(function (x) { return x.id === +o.id; }); if (xi < 0) return fail('이미 누가 꺼냈습니다'); if (P.inv.length >= Rules.calc(P, null).bag) return fail('가방이 가득 찼습니다'); var x2 = g.items.splice(xi, 1)[0]; P.inv.push(x2.item); this._gLog(P.name + ' 님이 ' + x2.item.name + '을(를) 꺼냈습니다'); }
          else { var a2 = Math.floor(+o.gold || 0); if (!(a2 >= 1)) return fail(CUR + '를 확인 필요'); if (a2 > g.gold) return fail('창고 ' + CUR + '가 모자랍니다'); g.gold -= a2; P.res.gold += a2; this._gLog(P.name + ' 님이 ' + Rules.fmt(a2) + ' ' + CUR + '를 꺼냈습니다'); }
          this._save(); return this._ok(now, { ok: true, guild: this._guildView() });
        }
        return fail('데모에서는 할 수 없습니다');
      }
    }
    this._save(); return Promise.resolve({ ok: true, guild: this._guildView() });
  };
  // 데모 묶음 채팅 (파티·동아리): 이 브라우저 안에서만, NPC가 가끔 대답한다
  LocalApi.prototype._groupSend = function (ch, text, kind) {
    var so = this._soc(), P = this.d.P, self = this;
    var N0 = npcs(), list = ch === 'party' ? (so.party && so.party.npcs) : (ch === 'hrp' || ch === 'hooc') ? N0.filter(function (n) { return n.house === P.house; }).map(function (n) { return n.k; }) : (ch === 'crp' || ch === 'cooc') ? (P.cls ? N0.filter(function (n) { return (n.k % 2 === 0) === (P.cls === 'knight'); }).map(function (n) { return n.k; }) : null) : (so.guild && so.guild.npcs); if (!list) return Promise.resolve({ error: ch === 'party' ? '파티에 들어가 있지 않습니다' : (ch === 'crp' || ch === 'cooc') ? '학과 선택 필요' : '동아리에 들어가 있지 않습니다' });
    var mid = 'l' + Date.now() + Math.random(); this._keepSoc({ id: mid, ch: ch, t: Date.now() / 1000, pid: P.id, name: P.name, house: P.house, grade: P.grade, kind: kind === 'me' ? 'me' : 'say', ink: Rules.decoView(this.d && this.d.P).ink || '', text: text, title: Rules.titleName(P, P.title) });
    if (list.length && Math.random() < 0.6) { var k = list[Math.floor(Math.random() * list.length)], pool = /ooc$/.test(ch) ? OOC_LINES : NPC_LINES; setTimeout(function () { self._npcSay(ch, k, pool[Math.floor(Math.random() * pool.length)]); }, 1800 + Math.random() * 3000); }
    return Promise.resolve({ ok: true, id: mid });
  };
  // 데모 거래소: NPC 학생들이 내 진도에 맞는 물건을 올리고, 내가 올린 물건도 가끔 NPC가 사 간다 (이 브라우저에만)
  var MK_NPC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  function mkGive(P, x) { if (x.kind === 'badge') { (P.badges || (P.badges = [])).push(x.badge); return; } mkGive0(P, x); }
  function mkGive0(P, x) { if (x.kind === 'item') P.inv.push(x.item); else if (x.kind === 'pot') P.shelf[x.pot] = (P.shelf[x.pot] || 0) + x.qty; else if (x.mat === 'stone') P.res.stone += x.qty; else P.mats[x.mat] = (P.mats[x.mat] || 0) + x.qty; }
  LocalApi.prototype._npcLot = function (dummy, stage, wantMat) { return Rules.npcLot(stage, wantMat); };
  LocalApi.prototype._npcLotOld = function (dummy, stage, wantMat) {
    var Dd = D2(), x;
    var roll = Math.random();
    if (!wantMat && roll < 0.12) { var pots = Dd.POTIONS.filter(function (p) { return p.unlock <= Math.max(3, stage / 3); }), pp = pots[Math.floor(Math.random() * pots.length)], pq = 1 + Math.floor(Math.random() * 4), mn = Object.keys(pp.mats).reduce(function (a, k) { return a + pp.mats[k]; }, 0);
      x = { kind: 'pot', pot: pp.id, name: pp.name, qty: pq, price: pq * Math.max(20, Math.round(Rules.K.KILL_GOLD * Math.pow(Rules.K.G_GOLD, stage) * 25 * mn * (1.4 + Math.random() * 0.8))) }; }
    else if (!wantMat && roll < 0.2) { var bl = 1 + Math.floor(Math.random() * Math.min(12, 2 + stage / 6)), bd = Rules.makeBadge(dummy, null, bl);
      x = { kind: 'badge', badge: bd, name: bd.name + ' Lv ' + bd.lv, gem: bd.gem, lv: bd.lv, qty: 1, price: Math.round(Rules.badgeValue(bd) * (0.8 + Math.random() * 0.8)) }; }
    else if (wantMat || roll < 0.4) {
      var z = Rules.zoneOf(Math.max(1, Math.round(stage * (0.4 + Math.random() * 0.7)))), qty = 10 + Math.floor(Math.random() * 40), unit = Math.max(2, Math.round(Rules.K.KILL_GOLD * Math.pow(Rules.K.G_GOLD, z.from + 5) * 25 * (0.8 + Math.random() * 0.4)));
      x = { kind: 'mat', mat: z.mat, name: Dd.MATS[z.mat].name, qty: qty, price: unit * qty };
    } else {
      var ilvl = Math.max(1, Math.round(stage + (Math.random() * 1.6 - 0.6) * 6)), y = Math.random(), r = y < 0.45 ? 1 : y < 0.78 ? 2 : y < 0.95 ? 3 : 4;
      var it = Rules.makeItem(dummy, Dd.SLOTS[Math.floor(Math.random() * Dd.SLOTS.length)].id, ilvl, r, r);
      x = { kind: 'item', item: it, name: it.name, slot: it.slot, r: it.r, ilvl: it.ilvl, qty: 1, price: Math.max(10, Math.round(Rules.sellPrice(it) * (3 + Math.random() * 6))) };
    }
    return x;
  };
  LocalApi.prototype.marketPrices = function (keys) {
    var mk = this._mk(), real = Date.now() / 1000, out = {}; this._save();
    keys.forEach(function (k) {
      var p = k.split(':'), rows = mk.list.filter(function (x) { if (x.status !== 'sold' || real - x.done > 30 * 86400) return false; return p[0] === 'badge' ? x.kind === 'badge' && x.gem === p[1] && Math.abs((x.lv || 0) - +p[2]) <= 2 : p[0] === 'mat' ? x.kind === 'mat' && x.mat === p[1] : p[0] === 'pot' ? x.kind === 'pot' && x.pot === p[1] : x.kind === 'item' && x.slot === p[1] && x.r === +p[2] && Math.abs(x.ilvl - +p[3]) <= 5; }).sort(function (a, b) { return b.done - a.done; });
      var unit = rows.map(function (r) { return r.price / Math.max(1, r.qty); });
      out[k] = rows.length ? { avg: Math.round(unit.reduce(function (a, b) { return a + b; }, 0) / unit.length), n: rows.length, recent: rows.slice(0, 5).map(function (r) { return { t: r.done, price: r.price, qty: r.qty, ilvl: r.ilvl || 0, name: r.name }; }) } : { avg: 0, n: 0, recent: [] };
    });
    return Promise.resolve({ prices: out });
  };
  LocalApi.prototype.marketTrades = function () {
    var mk = this._mk(); this._save();
    return Promise.resolve({ trades: mk.list.filter(function (x) { return x.status === 'sold'; }).sort(function (a, b) { return b.done - a.done; }).slice(0, 50).map(function (x) { return { id: x.id, kind: x.kind, name: x.name, slot: x.slot || '', r: x.r || 0, ilvl: x.ilvl || 0, qty: x.qty, price: x.price, t: x.done }; }) });
  };
  LocalApi.prototype._mk = function () {
    var d = this.d, P = d.P, now = Date.now() / 1000, mk = d.mk || (d.mk = { seq: 1, list: [] }), Dd = D2();
    mk.list = mk.list.filter(function (x) { return x.status === 'open' ? true : now - (x.done || now) < (x.status === 'sold' ? 30 : 3) * 86400; });
    var self = this, st0 = Math.max(1, Math.min(P.maxStage, Rules.stageCap(P)));
    // 처음 열 때: 지난 며칠 동안의 판매 기록을 지어 둔다 (시세를 보여 주려고)
    if (!mk.seeded) { mk.seeded = 1; var dm = { rng: (Math.random() * 2147483647) | 1 }; for (var q0 = 0; q0 < 30; q0++) { var y0 = this._npcLot(dm, st0); y0.id = mk.seq++; y0.seller = 'NPC'; y0.npc = true; y0.status = 'sold'; y0.done = now - Math.random() * 6 * 86400; y0.created = y0.done - 3600; y0.expires = y0.done; mk.list.push(y0); } }
    // 다른 학생들이 NPC 물건을 사 간다 (실시간 거래 탭에 올라온다)
    var dt = Math.min(3600, now - (mk.simAt || now)); mk.simAt = now;
    mk.list.forEach(function (x) { if (x.status === 'open' && !x.mineL && Math.random() < dt / 2400) { x.status = 'sold'; x.done = now - Math.random() * dt; var h0 = self._chat && self._chat.h; if (h0 && h0.trade) h0.trade({ id: x.id, kind: x.kind, name: x.name, slot: x.slot || '', r: x.r || 0, ilvl: x.ilvl || 0, qty: x.qty, price: x.price, t: x.done }); } });
    mk.list.forEach(function (x) {
      if (x.status !== 'open') return;
      if (x.expires <= now) { x.status = 'expired'; x.done = now; if (x.mineL) { mkGive(P, x); } }
      else if (x.mineL && x.buyAt && now >= x.buyAt) { x.status = 'sold'; x.done = now; var got = Math.floor(x.price * 0.95); P.res.gold += got; self._note('market', '거래소에서 ' + x.name + (x.kind !== 'item' ? ' ' + x.qty + '개' : '') + '가 팔렸습니다 · ' + Rules.fmt(got) + ' ' + CUR, { view: 'market' }); Rules.log(P, now, '거래소: ' + x.name + ' 팔림 (+' + Rules.fmt(got) + ' ' + CUR + ')', 'good'); }
    });
    var open = mk.list.filter(function (x) { return x.status === 'open' && !x.mineL; }), mats = open.filter(function (x) { return x.kind === 'mat'; }).length;
    var stage = Math.max(1, Math.min(P.maxStage, Rules.stageCap(P))), dummy = { rng: (Math.random() * 2147483647) | 1 };
    for (var n = open.length; n < 12; n++) {
      var rv = Dd.RIVALS[MK_NPC[Math.floor(Math.random() * MK_NPC.length)]], life = now + (1 + Math.random()) * 86400, x = this._npcLot(dummy, stage, mats < 3);
      if (x.kind === 'mat') mats++;
      x.id = mk.seq++; x.seller = rv.name; x.npc = true; x.created = now - Math.random() * 3600; x.expires = life; x.status = 'open'; mk.list.push(x);
    }
    return mk;
  };
  LocalApi.prototype.market = function (f) {
    if (!this.d || !this.d.P) return Promise.resolve({ error: '로그인이 필요합니다' });
    var mk = this._mk(), now = Date.now() / 1000; f = f || {}; this._save();
    var list = mk.list.filter(function (x) {
      if (x.status !== 'open' || x.mineL) return false; if ((f.kind || 'item') !== x.kind) return false;
      if (x.kind === 'item') { if (f.slot === 'sword' ? !(x.slot === 'staff' && x.item && x.item.wk === 'sword') : f.slot === 'staff' ? !(x.slot === 'staff' && !(x.item && x.item.wk === 'sword')) : f.slot && x.slot !== f.slot) return false; if (f.r !== '' && f.r != null && +f.r !== x.r) return false; if (f.q && x.name.indexOf(f.q) < 0) return false; }
      else if (x.kind === 'pot') { if (f.pot && x.pot !== f.pot) return false; }
      else if (x.kind === 'badge') { if (f.gem && x.gem !== f.gem) return false; }
      else if (f.mat && x.mat !== f.mat) return false;
      return true;
    }).map(function (x) { return Object.assign({}, x, { mine: false }); });
    var unit = function (x) { return x.price / (x.qty || 1); };
    list.sort(f.sort === 'high' ? function (a, b) { return unit(b) - unit(a); } : f.sort === 'new' ? function (a, b) { return b.created - a.created; } : f.sort === 'lvl' ? function (a, b) { return (b.ilvl || 0) - (a.ilvl || 0); } : function (a, b) { return unit(a) - unit(b); });
    var mine = mk.list.filter(function (x) { return x.mineL; }).map(function (x) { return Object.assign({}, x, { mine: true }); }).reverse();
    return Promise.resolve({ list: list, mine: mine, fee: 0.05, days: 3, maxOpen: 10, grade: 1, demo: true, now: now });
  };
  LocalApi.prototype.marketOp = function (o) {
    var P = this.d && this.d.P; if (!P) return Promise.resolve({ error: '로그인이 필요합니다' });
    var mk = this._mk(), now = Date.now() / 1000, self = this;
    function ok() { self._save(); return self._ok(now); }
    if (o.op === 'buy') {
      var x = mk.list.find(function (y) { return y.id === o.id && y.status === 'open' && !y.mineL; }); if (!x) return Promise.resolve({ error: '이미 팔린 물건입니다' });
      Rules.advance(P, this._world(now), now);
      if (P.res.gold < x.price) return Promise.resolve({ error: CUR + '가 부족합니다' });
      if (x.kind === 'badge' && (P.badges || []).length >= Rules.BADGE_HOLD) return Promise.resolve({ error: '휘장 보관함이 가득 찼습니다 (' + Rules.BADGE_HOLD + '개)' });
      if (x.kind === 'item' && P.inv.length >= Rules.calc(P, null).bag) return Promise.resolve({ error: '가방이 가득 찼습니다' });
      P.res.gold -= x.price; mkGive(P, x);
      x.status = 'sold'; x.done = now; Rules.log(P, now, '거래소에서 ' + x.name + (x.kind !== 'item' ? ' ' + x.qty + '개' : '') + '를 ' + Rules.fmt(x.price) + ' ' + CUR + '에 샀습니다', 'good');
      return ok();
    }
    if (o.op === 'list') {
      if (mk.list.filter(function (y) { return y.mineL && y.status === 'open'; }).length >= 10) return Promise.resolve({ error: '한 번에 10개까지 올릴 수 있습니다' });
      var price = Math.floor(+o.price); if (!(price >= 1)) return Promise.resolve({ error: '가격 확인 필요' });
      var y = { id: mk.seq++, mineL: true, seller: P.name, created: now, expires: now + 3 * 86400, status: 'open', price: price };
      if (o.u) { var i = P.inv.findIndex(function (it) { return it.u === o.u; }); if (i < 0) return Promise.resolve({ error: '가방에 없는 장비입니다' }); var it = P.inv.splice(i, 1)[0]; Object.assign(y, { kind: 'item', item: it, name: it.name + (it.enh ? ' +' + it.enh : ''), slot: it.slot, r: it.r, ilvl: it.ilvl, qty: 1 }); }
      else if (o.badge) { var bi = (P.badges || []).findIndex(function (b) { return b.u === o.badge; }); if (bi < 0) return Promise.resolve({ error: '없는 휘장입니다' }); if (P.badges[bi].lock) return Promise.resolve({ error: '잠금한 휘장은 올릴 수 없습니다' }); if (P.badges[bi].u === P.badgeOn) return Promise.resolve({ error: '달고 있는 휘장은 올릴 수 없습니다. 먼저 장착 해제 필요' }); var bd2 = P.badges.splice(bi, 1)[0]; Object.assign(y, { kind: 'badge', badge: bd2, name: bd2.name + ' Lv ' + bd2.lv, gem: bd2.gem, lv: bd2.lv, qty: 1 }); }
      else if (o.pot) { var pq2 = Math.floor(+o.qty), pt = Rules.POT[o.pot]; if (!pt || !(pq2 >= 1 && pq2 <= (P.shelf[o.pot] || 0))) return Promise.resolve({ error: '수량 확인 필요' }); P.shelf[o.pot] -= pq2; Object.assign(y, { kind: 'pot', pot: o.pot, name: pt.name, qty: pq2 }); }
      else { var m = o.mat, q = Math.floor(+o.qty), have = m === 'stone' ? P.res.stone : (P.mats[m] || 0); if (!(q >= 1 && q <= have)) return Promise.resolve({ error: '수량 확인 필요' }); if (m === 'stone') P.res.stone -= q; else P.mats[m] -= q; Object.assign(y, { kind: 'mat', mat: m, name: m === 'stone' ? '마석' : D2().MATS[m].name, qty: q }); }
      // 데모: 상점 판매가의 10배 이하로 올리면 NPC가 5~30분 뒤에 사 간다
      var fair = y.kind === 'badge' ? Rules.badgeValue(y.badge) * 3 : y.kind === 'item' ? Rules.sellPrice(y.item) * 10 : 1e15; if (price <= fair) y.buyAt = now + (300 + Math.random() * 1500);
      mk.list.push(y); return ok();
    }
    if (o.op === 'cancel') {
      var z = mk.list.find(function (w) { return w.id === o.id && w.mineL && w.status === 'open'; }); if (!z) return Promise.resolve({ error: '내릴 수 없습니다' });
      z.status = 'canceled'; z.done = now; mkGive(P, z);
      return ok();
    }
    return Promise.resolve({ error: '알 수 없는 요청입니다' });
  };
  // 미리보기 게시판: 이 브라우저에만. NPC 학생들의 글 몇 개로 시작한다. (운영진 기능은 서버판에서만)
  LocalApi.prototype._bd = function () {
    var d = this.d; if (d.bd) return d.bd; var t0 = Date.now() / 1000, N = npcs();
    var seed = [['q', 0, '결계공학 시험 몇 레벨이면 붙나요?', '1학년 기말 준비 중인데 결계공학이 제일 느리네요. 다들 몇 레벨에서 보셨어요?'], ['recruit', 3, '별의 탑 같이 오를 파티원 구해요', '저녁 9시쯤 접속합니다. 등불관 환영!'], ['trade', 5, '달빛 약초 30묶음 팝니다', '거래소에 올려 둘게요. 시세보다 조금 싸게.'], ['rp', 7, '[RP] 도서관 금지 구역에서 길을 잃었다', '*촛불을 들고 서가 사이를 걷는다* 누구 없어요…?'], ['chat', 2, '오늘 유성 소나기 보신 분', '창밖으로 올려다봤는데 진짜 예쁘더라고요.']];
    d.bd = { seq: seed.length + 1, posts: seed.map(function (x, i) { var n = N[x[1]]; return { id: i + 1, pid: 'npc:' + x[1], author: n.name, tag: x[0], priv: false, title: x[2], body: x[3], created: t0 - (seed.length - i) * 5400, updated: t0 - (seed.length - i) * 5400, coms: [] }; }) };
    return d.bd;
  };
  LocalApi.prototype.board = function (f) {
    var b = this._bd(), P = this.d.P, me = P.id; f = f || {};
    function out(p, full) { var o = { id: p.id, tag: p.tag, priv: p.priv, title: p.title, author: p.pid === me ? P.name : p.author, aid: p.pid, aop: false, mine: p.pid === me, created: p.created, updated: p.updated, ncom: p.coms.length }; if (full) Object.assign(o, { body: p.body, canEdit: p.pid === me, canDel: p.pid === me, comments: p.coms.map(function (c) { return Object.assign({}, c, { mine: c.aid === me }); }) }); return o; }
    if (f.id) { var p = b.posts.filter(function (x) { return x.id === +f.id; })[0]; return Promise.resolve(p && (!p.priv || p.pid === me) ? { post: out(p, true) } : { error: '없는 글이거나 볼 수 없는 글입니다' }); }
    var q = String(f.q || '').toLowerCase(), list = b.posts.filter(function (p) {
      if (f.tag === 'mine') { if (p.pid !== me) return false; } else { if (p.priv) return false; if (f.tag && p.tag !== f.tag) return false; }
      if (q) { var a = (p.pid === me ? P.name : p.author).toLowerCase(), hay = f.qt === 'author' ? a : f.qt === 'title' ? p.title.toLowerCase() : (p.title + '\n' + p.body).toLowerCase(); if (hay.indexOf(q) < 0) return false; }
      return true;
    }).sort(function (x, y) { return y.id - x.id; });
    var pages = Math.max(1, Math.ceil(list.length / 20)), page = Math.min(pages, Math.max(1, +f.page || 1));
    return Promise.resolve({ list: list.slice((page - 1) * 20, page * 20).map(function (p) { return out(p); }), total: list.length, page: page, pages: pages, op: false, privN: 0 });
  };
  LocalApi.prototype.boardOp = function (o) {
    var b = this._bd(), P = this.d.P, me = P.id, now = Date.now() / 1000, self = this, tags = D2().BOARD_TAGS.map(function (t) { return t.id; });
    function fail(m) { return Promise.resolve({ error: m }); }
    function find(id) { return b.posts.filter(function (x) { return x.id === +id; })[0]; }
    function done(id) { self._save(); return self.board({ id: id }).then(function (j) { return { ok: true, id: id, post: j.post || null }; }); }
    if (o.op === 'write' || o.op === 'edit') {
      var title = String(o.title || '').trim().slice(0, 40), body = String(o.body || '').trim().slice(0, 3000);
      if (tags.indexOf(o.tag) < 0) return fail('말머리 선택 필요'); if (title.length < 2) return fail('제목은 두 글자 이상'); if (!body) return fail('내용 입력 필요');
      if (o.op === 'edit') { var e = find(o.id); if (!e || e.pid !== me) return fail('고칠 수 없는 글입니다'); Object.assign(e, { tag: o.tag, title: title, body: body, priv: !!o.priv, updated: now }); return done(e.id); }
      var p = { id: b.seq++, pid: me, author: P.name, tag: o.tag, priv: !!o.priv, title: title, body: body, created: now, updated: now, coms: [] }; b.posts.push(p);
      if (p.priv) p.coms.push({ id: Date.now() + Math.floor(Math.random() * 1000), author: '운영진', aid: 'staff', op: true, body: '(미리보기) 서버판에서는 운영진이 이 문의를 보고 답을 남기면 우편으로 알려 드립니다.', created: now + 1 });
      return done(p.id);
    }
    if (o.op === 'del') { var x = find(o.id); if (!x || x.pid !== me) return fail('지울 수 없는 글입니다'); b.posts.splice(b.posts.indexOf(x), 1); this._save(); return Promise.resolve({ ok: true }); }
    if (o.op === 'comment') { var y = find(o.id); if (!y || (y.priv && y.pid !== me)) return fail('없는 글입니다'); var t = String(o.text || '').trim().slice(0, 500); if (!t) return fail('댓글 입력 필요'); var par = +o.parent || 0, pc = par ? y.coms.filter(function (c) { return c.id === par; })[0] : null; if (par && !pc) return fail('답글을 달 댓글이 없어졌습니다'); y.coms.push({ id: Date.now() + Math.floor(Math.random() * 1000), author: P.name, aid: me, op: false, body: t, created: now, parent: pc ? (pc.parent || pc.id) : 0 }); return done(y.id); }
    if (o.op === 'cdel') { var z = find(o.id); if (!z) return fail('없는 글입니다'); z.coms = z.coms.filter(function (c) { return !(c.id === o.cid && c.aid === me); }); return done(z.id); }
    return fail('알 수 없는 요청입니다');
  };
  LocalApi.prototype.chatHistory = function () { return Promise.resolve({ msgs: [] }); };
  LocalApi.prototype.dmThreads = function () { return Promise.resolve({ threads: [] }); };
  LocalApi.prototype.dmHistory = function () { return Promise.resolve({ msgs: [] }); };
  LocalApi.prototype.chatReport = function () { return Promise.resolve({ ok: true }); };
  LocalApi.prototype.logout = function () { return Promise.resolve({ ok: true }); };
  LocalApi.prototype.password = function () { return Promise.resolve({ error: '데모 모드에는 비밀번호가 없습니다' }); };
  LocalApi.prototype.reset = function () { this.d = null; try { localStorage.removeItem(KEY); } catch (e) { } };
  /* ── 데모 함께 원정: 가상의 학생(NPC)들이 연 방이 몇 개 떠 있고, 내 방에도 가끔 들어온다. NPC 힘은 내 힘의 60~130% ── */
  LocalApi.prototype._er = function () {
    var self = this, P = this.d.P, t = Date.now() / 1000, N = npcs();
    var E = this._erS || (this._erS = { rooms: [], mine: null, seq: 1, gone: null, nextNpc: 0 });
    function npcM(k) { var n = N[k % N.length], pos = ['van', 'rear', 'sup'][k % 3]; return { k: k, name: n.name, pos: pos, f: 0.6 + ((k * 37) % 70) / 100, npc: true }; }
    function stageNear() { var hi = Math.max(1, Math.min(P.maxStage, Rules.stageCap(P))), s = Math.max(1, hi - Math.floor(Math.random() * 4)); if (Rules.isBoss(s)) s = Math.max(1, s - 1); return s; }
    // 떠날 시각이 된 방 정리
    E.rooms = E.rooms.filter(function (r) {
      if (r.id === E.mine) { if (r.fullAt && t >= r.fullAt + 15) { self._erDepart(r); return false; } return true; }
      return t < r.created + 600 && !(r.fullAt && t >= r.fullAt + 15);   // 다른 학생들 방은 10분쯤 지나거나 차면 떠난다
    });
    while (E.rooms.filter(function (r) { return r.id !== E.mine; }).length < 3) {
      var used = {}; E.rooms.forEach(function (r) { r.members.forEach(function (m) { if (m.npc) used[m.k] = 1; }); });
      var ks = []; for (var k = 0; k < N.length && ks.length < 1 + Math.floor(Math.random() * 3); k++) { var kk = (k * 5 + E.seq * 3) % N.length; if (!used[kk] && ks.indexOf(kk) < 0) ks.push(kk); }
      if (!ks.length) break;
      E.rooms.push({ id: 'd' + (E.seq++), s: stageNear(), d: ['30m', '1h', '2h'][E.seq % 3], created: t - Math.random() * 200, fullAt: 0, host: 'npc:' + ks[0], members: ks.map(npcM) });
      var nr = E.rooms[E.rooms.length - 1], nn = N[ks[0]], NOTES = ['선봉 한 분 구해요!', '지원 오시면 든든할 듯', '같이 천천히 돌아요', '처음이어도 괜찮아요', ''];
      this._recruit('npc:' + ks[0], nn.name, nn.house, nn.grade, nr, NOTES[E.seq % NOTES.length]);
    }
    // 내 방에 가끔 NPC가 들어온다
    var mr = E.rooms.filter(function (r) { return r.id === E.mine; })[0];
    if (mr && mr.members.length < 4 && t >= E.nextNpc) {
      if (E.nextNpc) { var have = {}; E.rooms.forEach(function (r) { r.members.forEach(function (m) { if (m.npc) have[m.k] = 1; }); }); for (var q = 0; q < N.length; q++) if (!have[q]) { mr.members.push(npcM(q)); self._note('exp', N[q].name + ' 님이 내 함께 원정 방에 들어왔습니다', { view: 'explore', anchor: 'exproom' }); if (mr.members.length >= 4) mr.fullAt = t; break; } }
      E.nextNpc = t + 12 + Math.random() * 14;
    }
    return E;
  };
  LocalApi.prototype._erCs = function (r, now) {
    var P = this.d.P, W = this._world(now), c0 = Rules.calc(P, W, now);
    return r.members.map(function (m) { if (!m.npc) return { c: c0, pos: m.pos, aggro: Rules.expAggro(P) }; var c = {}; for (var k in c0) c[k] = c0[k]; c.totalDps = c0.totalDps * m.f; c.hp = c0.hp * m.f; c.def = c0.def * m.f; return { c: c, pos: m.pos, aggro: Rules.EXP_AGGRO }; });
  };
  LocalApi.prototype._erDepart = function (r) {
    var E = this._erS, P = this.d.P, now = this._now(), W = this._world(now); E.mine = null;
    Rules.advance(P, W, now);
    var slot; try { slot = Rules.expCanGo(P, W, now, r.s); } catch (e) { E.gone = { ok: false, why: e.message, s: r.s }; return { n: 0 }; }
    var me = r.members.filter(function (m) { return !m.npc; })[0]; if (Rules.expPositions(P).indexOf(me.pos) < 0) me.pos = 'van';
    var pv = Rules.expPartyPreview(this._erCs(r, now), r.s, r.d), mi = r.members.indexOf(me);
    Rules.expPartyApply(P, now, slot, r.s, r.d, pv.each[mi], { n: r.members.length, pos: me.pos, with: r.members.filter(function (m) { return m !== me; }).map(function (m) { return { name: m.name, pos: m.pos, npc: true, k: m.k }; }) });
    E.gone = { ok: true, s: r.s, n: r.members.length }; this._save(); return { n: r.members.length };
  };
  LocalApi.prototype._erView = function () {
    var E = this._er(), P = this.d.P, t = Date.now() / 1000, now = this._now(), self = this;
    var rooms = E.rooms.map(function (r) {
      var mine = r.id === E.mine, host = r.members.filter(function (m) { return (m.npc ? 'npc:' + m.k : P.id) === r.host; })[0] || r.members[0];
      var v = { id: r.id, s: r.s, zone: Rules.zoneOf(r.s).name, d: r.d, party: false, host: host.name, isHost: r.host === P.id, mine: mine, n: r.members.length, max: 4,
        members: r.members.map(function (m) { return { id: m.npc ? undefined : P.id, name: m.npc ? m.name : P.name, pos: m.pos, me: !m.npc, host: m === host, npc: !!m.npc, k: m.k, cls: m.npc ? undefined : P.cls, lvl: m.npc ? undefined : P.lvl, grade: m.npc ? undefined : P.grade }; }),
        departIn: r.fullAt ? Math.max(0, Math.ceil(r.fullAt + 15 - t)) : null };
      if (mine) { var pv = Rules.expPartyPreview(self._erCs(r, now), r.s, r.d), e = pv.each[r.members.indexOf(r.members.filter(function (m) { return !m.npc; })[0])]; v.est = { kills: e.kills, gold: e.gold, xp: e.xp, risk: e.risk, label: pv.label, red: pv.red, frac: e.frac }; }
      return v;
    }).sort(function (a, b) { return (b.mine - a.mine) || (b.n - a.n); });
    var g = E.gone; E.gone = null;
    var so = this._soc(), pa = so.party;
    return { rooms: rooms, mine: E.mine, gone: g, life: 300, demo: true, party: pa ? { leader: true, allgo: !!pa.allgo, n: 1 + (pa.npcs || []).length, can: true } : null };
  };
  // 데모 알림 기록 (거래소 판매 · 함께 원정 동행이 들어옴 등)
  LocalApi.prototype._note = function (kind, text, link) { var a = this.d.notes || (this.d.notes = []); a.unshift({ id: 'n' + Date.now() + Math.random(), t: Date.now() / 1000, kind: kind, text: text, link: link || null, read: false }); if (a.length > 100) a.length = 100; this._save(); if (this._chat && this._chat.h && this._chat.h.note) this._chat.h.note({ n: a.filter(function (x) { return !x.read; }).length }); };
  LocalApi.prototype.notes = function () { var a = (this.d && this.d.notes) || []; return Promise.resolve({ notes: a.slice(), n: a.filter(function (x) { return !x.read; }).length }); };
  LocalApi.prototype.notesRead = function () { ((this.d && this.d.notes) || []).forEach(function (x) { x.read = true; }); this._save(); return Promise.resolve({ ok: true, n: 0 }); };
  // 데모 파티로 참가: 데모 파티의 NPC 파티원을 빈자리만큼 함께 (방장 힘의 60%)
  LocalApi.prototype._erBring = function (r) {
    var pa = this._soc().party, N = npcs(), added = []; if (!pa) return { added: [], skipped: [] };
    (pa.npcs || []).forEach(function (k) { if (r.members.length >= 4 || r.members.some(function (m) { return m.npc && m.k === k; })) return; var have = {}; r.members.forEach(function (m) { have[m.pos] = 1; }); r.members.push({ k: k, name: N[k].name, pos: !have.van ? 'van' : !have.sup ? 'sup' : 'rear', f: Rules.NPC_FRAC.exp, npc: true, party: true }); added.push(N[k].name); });
    if (r.members.length >= 4) r.fullAt = Date.now() / 1000;
    return { added: added, skipped: [] };
  };
  LocalApi.prototype.expRooms = function () { return Promise.resolve(this._erView()); };
  LocalApi.prototype.expPeek = function (id) { var v = this._erView().rooms.filter(function (r) { return r.id === id; })[0]; return Promise.resolve(v ? { room: v } : { error: '이미 출정했거나 닫힌 방입니다', _status: 404 }); };
  // 데모 모집 탭: 내 알림 + 가끔 NPC 방의 알림
  LocalApi.prototype._recruit = function (pid, name, house, grade, r, note) {
    var so = this._soc(); if (!so.chat.recruit) so.chat.recruit = [];
    var m = { id: 'rc' + Date.now() + Math.random(), ch: 'recruit', t: Date.now() / 1000, pid: pid, name: name, house: house, grade: grade, kind: 'recruit', text: JSON.stringify({ room: r.id, s: r.s, d: r.d, zone: Rules.zoneOf(r.s).name, n: r.members.length, max: 4, pos: r.members.map(function (x) { return x.pos; }), note: note || '' }) };
    this._keepSoc(m);
  };
  LocalApi.prototype.expRoom = function (o) {
    var E = this._er(), P = this.d.P, now = this._now(), W = this._world(now), t = Date.now() / 1000, res = {};
    Rules.advance(P, W, now);
    function bad(m) { return Promise.resolve({ error: m, _status: 400 }); }
    function posOk(pos) { var x = Rules.EXP_POS[pos]; if (!x) return '포지션 선택 필요'; if (Rules.expPositions(P).indexOf(pos) < 0) return x.name + ' 포지션은 ' + x.desc.split(' · ')[0]; return ''; }
    function leave() { E.rooms.forEach(function (r) { if (r.id === E.mine) { r.members = r.members.filter(function (m) { return m.npc; }); r.fullAt = 0; if (r.host === P.id && r.members.length) r.host = 'npc:' + r.members[0].k; } }); E.rooms = E.rooms.filter(function (r) { return r.members.length; }); E.mine = null; }
    try {
      if (o.op === 'create') { var s = Math.floor(+o.s) || 0; Rules.expCanGo(P, W, now, s); var pe = posOk(o.pos); if (pe) return bad(pe); if (!D2().DURATIONS.some(function (x) { return x.k === o.d; })) return bad('잘못된 시간입니다'); leave(); var id = 'd' + (E.seq++); E.rooms.push({ id: id, s: s, d: o.d, created: t, fullAt: 0, host: P.id, members: [{ name: P.name, pos: o.pos }] }); E.mine = id; E.nextNpc = 0; if (o.withParty) res = this._erBring(E.rooms[E.rooms.length - 1]); }
      else if (o.op === 'join') { var r = E.rooms.filter(function (x) { return x.id === o.id; })[0]; if (!r) return bad('없어진 방입니다'); if (r.id !== E.mine) { if (r.members.length >= 4) return bad('방이 가득 찼습니다'); Rules.expCanGo(P, W, now, r.s); var pe2 = posOk(o.pos); if (pe2) return bad(pe2); leave(); r.members.push({ name: P.name, pos: o.pos }); E.mine = r.id; E.nextNpc = 0; if (r.members.length >= 4) r.fullAt = t; if (o.withParty) res = this._erBring(r); } }
      else {
        var mr = E.rooms.filter(function (x) { return x.id === E.mine; })[0]; if (!mr) return bad('들어가 있는 방이 없습니다');
        if (o.op === 'pos') { var pe3 = posOk(o.pos); if (pe3) return bad(pe3); mr.members.filter(function (m) { return !m.npc; })[0].pos = o.pos; }
        else if (o.op === 'leave') leave();
        else if (o.op === 'bring') { res = this._erBring(mr); if (!res.added.length) return bad('함께 참가할 파티원이 없습니다 (파티 화면에서 아카데미 친구를 파티원으로 부를 수 있습니다)'); }
        else if (o.op === 'recruit') { if (mr.members.length >= 4) return bad('방이 이미 가득 찼습니다'); if (mr.recAt && t - mr.recAt < 60) return bad(Math.ceil(60 - (t - mr.recAt)) + '초 뒤에 다시 보낼 수 있습니다'); mr.recAt = t; this._recruit(P.id, P.name, P.house, P.grade, mr, String(o.note || '').replace(/\s+/g, ' ').trim().slice(0, 60)); }
        else if (o.op === 'invite') return bad('데모에는 친구·동아리원이 없어 초대를 보낼 수 없습니다');
        else if (o.op === 'npc' || o.op === 'npcdel') {
          if (mr.host !== P.id) return bad('방장만 할 수 있습니다');
          if (o.op === 'npcdel') mr.members = mr.members.filter(function (m) { return !(m.npc && m.k === +o.k); });
          else { if (mr.members.length >= 4) return bad('방이 가득 찼습니다'); var N2 = npcs(), have = {}, hp = {}; mr.members.forEach(function (m) { if (m.npc) have[m.k] = 1; hp[m.pos] = 1; }); var kq = -1; for (var q2 = 0; q2 < N2.length; q2++) if (!have[(q2 * 3 + 1) % N2.length]) { kq = (q2 * 3 + 1) % N2.length; break; } if (kq < 0) return bad('부를 수 있는 아카데미 친구가 없습니다');
            mr.members.push({ k: kq, name: N2[kq].name, pos: !hp.van ? 'van' : !hp.sup ? 'sup' : 'rear', f: Rules.NPC_FRAC.exp, npc: true, buddy: true }); }
          mr.fullAt = mr.members.length >= 4 ? t : 0;
        }
        else if (o.op === 'go') { if (mr.host !== P.id) return bad('방장만 출발시킬 수 있습니다'); E.rooms = E.rooms.filter(function (x) { return x !== mr; }); res = this._erDepart(mr); }
      }
    } catch (e) { if (!e.game) throw e; return bad(e.message); }
    var v = this._erView(); v.P = Rules.publicState(P); v.now = now; v.ok = true; for (var k in res) v[k] = res[k]; return Promise.resolve(v);
  };
  LocalApi.prototype.act = function (type, a) {
    var now = this._now(), P = this.d && this.d.P; if (!P) return Promise.resolve({ error: '로그인이 필요합니다', _status: 401 });
    var W = this._world(now), r;
    if (type === 'expStart' && this._erS && this._erS.mine) { var c0 = Rules.calc(P, W, now), fr = 0; for (var ei = 0; ei < c0.expSlots; ei++) if (!P.exp[ei]) fr++; if (fr <= 1) return Promise.resolve({ error: '함께 원정 방에서 출발을 기다리는 중입니다. 혼자 출정하려면 먼저 방 나가기 필요', _status: 400 }); }
    try {
      var before = P.wk.dmg;
      W.lecPeers = type === 'lecStart' ? this._cls(now).n : null; r = Rules.act(P, W, now, type, a || {}); W.lecPeers = null;
      if (type === 'exam' && r && r.pass) { var nw = this.d.news || (this.d.news = []); nw.unshift({ t: now, text: P.name + ' 학생이 ' + (P.grade >= 8 ? '졸업 시험을 통과해 마스터 과정이 되었습니다' : P.grade + '학년으로 진급했습니다') }); if (nw.length > 50) nw.length = 50; }
      if ((type === 'clsExam' || type === 'setCls') && r && this._chat && this._chat.h && this._chat.h.cls) { var so3 = this._soc(); this._chat.h.cls({ cls: P.cls || null, crp: so3.chat.crp = [], cooc: so3.chat.cooc = [] }); }
      if ((type === 'exam' && r && r.pass) || (type === 'useGradeUp' && r && r.grade)) this._note('grade', (P.grade >= 8 ? '졸업 시험을 통과해 마스터 과정이 되었습니다' : P.grade + '학년으로 진급했습니다') + ' · 새로 열린 것 보기', { grade: P.grade });
      if (type === 'wbAttack') { W.boss.hp = Math.max(0, W.boss.hp - (P.wk.dmg - before)); if (W.boss.hp <= 0 && !W.boss.killedAt) { W.boss.killedAt = now; r.killed = true; } }
    } catch (e) { if (!e.game) throw e; this._save(); return Promise.resolve({ error: e.message, P: Rules.publicState(P), now: now, _status: 400 }); }
    return this._ok(now, { r: r });
  };

  NET.LocalApi = LocalApi;
})(Net);
