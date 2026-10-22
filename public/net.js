/* 통신 계층: 서버(ServerApi). 아티팩트 미리보기 빌드에서만 demo.js가 LocalApi를 덧붙인다. */
var Net = (function () {
  var N = {};

  /* ───────── 서버 ───────── */
  // 로그인 상태는 HttpOnly 쿠키로만 유지한다 (스크립트가 토큰을 읽거나 저장하지 않음 → 악성 스크립트가 훔쳐 갈 것이 없다)
  function ServerApi() { this.mode = 'server'; this.token = null; try { localStorage.removeItem('arc_token'); } catch (e) { } }
  ServerApi.prototype.req = function (method, url, body) {
    var self = this, h = { 'Content-Type': 'application/json' };
    if (self.token) h.Authorization = 'Bearer ' + self.token;
    return fetch(url, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' }).then(function (r) {
      return r.json().catch(function () { return { error: '서버 응답을 읽지 못했습니다' }; }).then(function (j) { j._status = r.status; if (r.status === 503 && j.maint && N.onMaint) N.onMaint(j.maint); return j; });
    }, function () { return { error: '서버에 연결할 수 없습니다', _status: 0 }; });
  };
  ServerApi.prototype.saveToken = function () { };
  ServerApi.prototype.meta = function () { return this.req('GET', '/api/meta'); };
  ServerApi.prototype.state = function () { return this.req('GET', '/api/state'); };
  ServerApi.prototype.world = function () { return this.req('GET', '/api/world'); };
  ServerApi.prototype.myRanks = function () { return this.req('GET', '/api/myranks'); };
  ServerApi.prototype.subjRanks = function () { return this.req('GET', '/api/subjranks'); };
  ServerApi.prototype.act = function (type, a) { return this.req('POST', '/api/act', { type: type, a: a || {} }); };
  ServerApi.prototype.login = function (login, password) { var s = this; return this.req('POST', '/api/login', { login: login, password: password }).then(function (j) { if (j.token) s.saveToken(j.token); return j; }); };
  ServerApi.prototype.logout = function () { var s = this; return this.req('POST', '/api/logout').then(function (j) { s.saveToken(null); return j; }); };
  ServerApi.prototype.password = function (old, pw) { return this.req('POST', '/api/password', { old: old, password: pw }); };
  ServerApi.prototype.findId = function (name, password, newLogin) { return this.req('POST', '/api/findid', { name: name, password: password, newLogin: newLogin || '' }); };
  ServerApi.prototype.register = function (name, password, house, invite, cls, login) { var s = this; return this.req('POST', '/api/register', { login: login, name: name, password: password, house: house, invite: invite, cls: cls }).then(function (j) { if (j.token) s.saveToken(j.token); return j; }); };
  // 이름 바꾸기 (30일 제한은 서버가 확인한다)
  ServerApi.prototype.rename = function (name) { return this.req('POST', '/api/rename', { name: name }); };
  // 채팅: 서버 이벤트 스트림
  ServerApi.prototype.chatConnect = function (h) {
    var self = this, es = null, closed = false, delay = 2000;
    // 서버가 다시 켜졌을 때 2천 명이 같은 순간에 몰리지 않도록 재접속 시각을 흩뜨린다
    function retry() { if (closed) return; setTimeout(open, delay * (0.5 + Math.random())); delay = Math.min(30000, delay * 2); }
    function open() {
      if (closed) return;
      // 1회용 입장권(30초)을 받아 연결한다. 로그인 토큰은 주소에 싣지 않는다.
      self.req('POST', '/api/chat/ticket').then(function (j) {
        if (closed) return;
        if (!j.k) { h.status(false); if (j._status !== 401) retry(); return; }
        es = new EventSource('/api/chat/stream?k=' + encodeURIComponent(j.k));
        es.addEventListener('init', function (e) { delay = 2000; h.status(true); h.init(JSON.parse(e.data)); });
        es.addEventListener('msg', function (e) { h.msg(JSON.parse(e.data)); });
        es.addEventListener('del', function (e) { h.del(JSON.parse(e.data).id); });
        es.addEventListener('online', function (e) { h.online(JSON.parse(e.data).online); });
        es.addEventListener('party', function (e) { if (h.party) h.party(JSON.parse(e.data)); });
        es.addEventListener('exr', function (e) { if (h.exr) h.exr(JSON.parse(e.data)); });   // 함께 원정 방 채팅
        es.addEventListener('dm', function (e) { if (h.dm) h.dm(JSON.parse(e.data)); });
        es.addEventListener('slow', function (e) { if (h.slow) h.slow(JSON.parse(e.data)); });
        es.addEventListener('seq', function (e) { if (h.seq) h.seq(JSON.parse(e.data)); });
        es.addEventListener('tower', function (e) { if (h.tower) h.tower(JSON.parse(e.data)); });
        es.addEventListener('op', function (e) { if (h.op) h.op(JSON.parse(e.data)); });
        es.addEventListener('pin', function (e) { if (h.pin) h.pin(JSON.parse(e.data)); });
        es.addEventListener('guild', function (e) { if (h.guild) h.guild(JSON.parse(e.data)); });
        es.addEventListener('cls', function (e) { if (h.cls) h.cls(JSON.parse(e.data)); });
        es.addEventListener('gapp', function (e) { if (h.gapp) h.gapp(JSON.parse(e.data)); });
        es.addEventListener('ginv', function (e) { if (h.ginv) h.ginv(JSON.parse(e.data)); });
        es.addEventListener('note', function (e) { if (h.note) h.note(JSON.parse(e.data)); });
        es.addEventListener('trade', function (e) { if (h.trade) h.trade(JSON.parse(e.data)); });
        es.addEventListener('mail', function (e) { if (h.mail) h.mail(JSON.parse(e.data)); });
        ['ritual', 'auction', 'outbid', 'ver', 'maint', 'mk'].forEach(function (k) { es.addEventListener(k, function (e) { if (h[k]) h[k](JSON.parse(e.data)); }); });
        // 끊기면 브라우저가 같은 주소로 다시 붙으려 하지만 표는 1회용이므로, 직접 닫고 새 표로 다시 연결
        es.onerror = function () { h.status(false); es.close(); retry(); };
      });
    }
    open();
    return { close: function () { closed = true; if (es) es.close(); }, live: true };
  };
  ServerApi.prototype.tower = function (have) { return this.req('GET', '/api/tower' + (have ? '?have=' + encodeURIComponent(have) : '')); };
  ServerApi.prototype.towerOp = function (o) { return this.req('POST', '/api/tower', o || {}); };
  ServerApi.prototype.ritual = function () { return this.req('POST', '/api/ritual', {}); };
  ServerApi.prototype.auction = function () { return this.req('GET', '/api/auction'); };
  ServerApi.prototype.bid = function (id, amount) { return this.req('POST', '/api/auction', { id: id, amount: amount }); };
  ServerApi.prototype.mail = function () { return this.req('GET', '/api/mail'); };
  ServerApi.prototype.mailOp = function (o) { return this.req('POST', '/api/mail', o); };
  ServerApi.prototype.chatSend = function (ch, text, kind, to, nonce) { return this.req('POST', '/api/chat/send', { ch: ch, text: text, kind: kind, to: to, nonce: nonce }); };
  // 운영자: 월드 채팅 슬로우 모드 (권한은 서버가 확인한다)
  ServerApi.prototype.chatSlow = function (ch, sec) { return this.req('POST', '/api/chat/slow', { ch: ch, sec: sec }); };
  ServerApi.prototype.dmThreads = function () { return this.req('GET', '/api/dm/threads'); };
  ServerApi.prototype.dmHistory = function (peer, before) { return this.req('GET', '/api/dm?peer=' + encodeURIComponent(peer) + '&before=' + (before || '')); };
  ServerApi.prototype.chatHistory = function (ch, before, after) { return this.req('GET', '/api/chat/history?ch=' + encodeURIComponent(ch) + '&before=' + (before || '') + (after ? '&after=' + encodeURIComponent(after) : '')); };
  // 지금 보고 있는 월드·RP 탭을 서버에 알린다 (보는 탭만 글 전체, 나머지는 번호만 받는다)
  ServerApi.prototype.chatWatch = function (cid, ch) { return this.req('POST', '/api/chat/watch', { cid: cid, ch: ch || '' }); };
  ServerApi.prototype.chatReport = function (id, reason) { return this.req('POST', '/api/chat/report', { id: id, reason: reason }); };
  ServerApi.prototype.profile = function (id) { return this.req('GET', '/api/profile' + (id ? '?id=' + encodeURIComponent(id) : '')); };
  ServerApi.prototype.recreate = function (name, house, cls) { return this.req('POST', '/api/recreate', { name: name, house: house, cls: cls }); };
  ServerApi.prototype.saveProfile = function (o) { return this.req('POST', '/api/profile', o); };
  // 푸시 알림: 서버 공개 열쇠 받기 · 이 기기 등록/해제
  ServerApi.prototype.pushKey = function () { return this.req('GET', '/api/push/key'); };
  ServerApi.prototype.pushSub = function (sub, opts) { return this.req('POST', '/api/push/sub', { sub: sub, opts: opts }); };
  ServerApi.prototype.pushUnsub = function (endpoint) { return this.req('POST', '/api/push/unsub', { endpoint: endpoint }); };
  ServerApi.prototype.setAvatar = function (dataUrl) { return this.req('POST', '/api/avatar', { img: dataUrl }); };
  ServerApi.prototype.avatarUrl = function (id, v) { return v ? '/api/avatar?id=' + encodeURIComponent(id) + '&v=' + v : ''; };
  ServerApi.prototype.playerSearch = function (q) { return this.req('GET', '/api/players?q=' + encodeURIComponent(q)); };
  ServerApi.prototype.myLogin = function () { return this.req('GET', '/api/me/login'); };
  ServerApi.prototype.friends = function () { return this.req('GET', '/api/friends'); };
  ServerApi.prototype.friendOp = function (op, id, name) { return this.req('POST', '/api/friends', { op: op, id: id, name: name }); };
  ServerApi.prototype.friendMemo = function (id, memo) { return this.req('POST', '/api/friends', { op: 'memo', id: id, memo: memo }); };
  ServerApi.prototype.party = function () { return this.req('GET', '/api/party'); };
  ServerApi.prototype.partyOp = function (o) { return this.req('POST', '/api/party', o); };
  ServerApi.prototype.market = function (f) { var q = []; for (var k in f) if (f[k] !== '' && f[k] != null) q.push(k + '=' + encodeURIComponent(f[k])); return this.req('GET', '/api/market' + (q.length ? '?' + q.join('&') : '')); };
  ServerApi.prototype.marketOp = function (o) { return this.req('POST', '/api/market', o); };
  ServerApi.prototype.marketPrices = function (keys) { return this.req('GET', '/api/market/prices?keys=' + encodeURIComponent(keys.join(','))); };
  ServerApi.prototype.recruitStatus = function (o) { return this.req('POST', '/api/recruit/status', o); };
  ServerApi.prototype.marketTrades = function () { return this.req('GET', '/api/market/trades'); };
  ServerApi.prototype.marketHistory = function () { return this.req('GET', '/api/market/history'); };
  ServerApi.prototype.guilds = function (q) { return this.req('GET', '/api/guilds' + (q ? '?q=' + encodeURIComponent(q) : '')); };
  ServerApi.prototype.guild = function (id) { return this.req('GET', '/api/guild' + (id ? '?id=' + encodeURIComponent(id) : '')); };
  ServerApi.prototype.guildRank = function (sort) { return this.req('GET', '/api/guilds/rank?sort=' + (sort || 'lv')); };
  ServerApi.prototype.board = function (f) { var q = []; for (var k in f) if (f[k] !== '' && f[k] != null) q.push(k + '=' + encodeURIComponent(f[k])); return this.req('GET', '/api/board' + (q.length ? '?' + q.join('&') : '')); };
  ServerApi.prototype.boardOp = function (o) { return this.req('POST', '/api/board', o); };
  ServerApi.prototype.expRooms = function () { return this.req('GET', '/api/exprooms'); };
  ServerApi.prototype.expRoom = function (o) { return this.req('POST', '/api/exproom', o); };
  ServerApi.prototype.expVote = function (o) { return this.req('POST', '/api/exp/vote', o); };
  ServerApi.prototype.notes = function () { return this.req('GET', '/api/notes'); };
  ServerApi.prototype.notesRead = function () { return this.req('POST', '/api/notes', {}); };
  ServerApi.prototype.expPeek = function (id) { return this.req('GET', '/api/exprooms?id=' + encodeURIComponent(id)); };
  ServerApi.prototype.guildOp = function (o) { return this.req('POST', '/api/guild', o); };
  /* ───────── 어떤 모드로 열지 ─────────
     서버판은 언제나 서버로만 연다. 아티팩트 미리보기(demo.js가 실린 빌드)만 LocalApi를 쓴다. */
  N.detect = function () {
    if (N.LocalApi) return Promise.resolve(new N.LocalApi());
    // 점검 중이면 서버가 503 + maint를 돌려준다 → 점검 화면
    return fetch('/api/health', { credentials: 'same-origin' }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (r.status === 503 && j && j.maint) N.bootMaint = j.maint;
        else if (!(r.ok && j && j.ok)) N.bootDown = true;
        return new ServerApi();
      });
    }, function () { N.bootDown = true; return new ServerApi(); });
  };
  return N;
})();
