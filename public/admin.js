/* 아카데미 운영실: 관리자 API를 쓰는 작은 페이지 */
(function () {
  var CUR = '아르크';   // shared/data.js의 D.CUR와 같게
  var tok = ''; try { tok = sessionStorage.getItem('arc_admin') || ''; } catch (e) { }
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // 운영실 학생 기록: 장비 · 능력치 전체 (학생의 공개 범위 설정과 관계없음)
  var SLOTN = { staff: '무기', robe: '로브', hat: '모자', charm: '장신구', tome: '마도서' }, STN = { int: '지력', wil: '의지', agi: '민첩', vit: '체력', luk: '행운' };
  function fx(v) { v = Number(v) || 0; return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : String(Math.round(v * 1000) / 1000); }
  // 학생 이름 → 누르면 학생 카드 (운영실 전용 · 공개 범위와 관계없음)
  function pl(name, id) { return name ? '<button class="plink" data-a="pcard" data-n="' + esc(name) + '"' + (id ? ' data-p="' + esc(id) + '"' : '') + ' title="학생 카드 보기">' + esc(name) + '</button>' : '—'; }
  // 재지급할 수 있는 장비 목록 (백업 비교 · 처분 기록 · 구매 기록에서 같이 쓴다). 버튼의 data-c = 이 목록의 번호
  var RE = [], BKNAME = '';
  function reBtn(x) { RE.push(x); return '<button class="btn sm ghost" data-a="bkre" data-c="' + (RE.length - 1) + '">재지급</button>'; }
  var RC5 = ['#b9bccb', '#7cc68a', '#6aa8ff', '#c084fc', '#f2b84b'];
  function itemCell(x) { return '<span style="color:' + RC5[x.r] + '">' + esc(x.name) + '</span> <span class="tiny faint">' + esc(x.rn + ' ' + x.slot + ' Lv ' + x.ilvl) + '</span><div class="tiny faint">' + esc(x.opt || '') + '</div>'; }
  function cardHtml(c, RN) {
    if (!c) return '<p class="small" style="margin-top:8px">장비 · 능력치를 불러오지 못했습니다.</p>';
    var f = c.fight, row = function (k, v) { return '<tr><th style="text-align:left;white-space:nowrap">' + k + '</th><td>' + v + '</td></tr>'; };
    var h = '<div class="row between" style="margin-top:10px"><b>장비 · 능력치</b><button class="btn sm ghost" data-a="plogcopy">분석용 복사</button></div>';
    h += '<p class="small">' + esc((c.cls === 'knight' ? '기사' : '마법사') + ' · Lv ' + c.lvl + ' · ' + c.grade + '학년 · 최고 ' + c.maxStage + '단계 · 전투력 ' + fx(c.power)) + '</p>';
    h += '<div class="scroll" style="margin-top:6px"><table><tbody>' +
      row('공격력', fx(f.atk) + ' (물리 ' + fx(f.patk) + ' · 주문 ' + fx(f.matk) + ')') + row('생명력 · 방어력', fx(f.hp) + ' · ' + fx(f.def)) +
      row('공격 속도 · 치명타', fx(f.aps) + ' · ' + Math.round(f.critC * 1000) / 10 + '% × ' + fx(f.critD)) + row('주문 위력 · 기술 위력', fx(f.spell) + ' · ' + fx(f.skill)) +
      row('초당 피해', fx(f.totalDps) + ' (평타 ' + fx(f.dps) + ' · 주문 ' + fx(f.spellDps) + ' · 사역마 ' + fx(f.famDps) + ')') +
      row('능력치', Object.keys(STN).map(function (k) { return STN[k] + ' ' + fx(c.st[k]) + (c.sg[k] ? ' (장비 ' + fx(c.sg[k]) + ')' : ''); }).join(' · ')) +
      row('보너스', esc(Object.keys(c.bon).map(function (k) { return k + ' ' + fx(c.bon[k]); }).join(' · ') || '없음')) +
      row('과목', esc(c.subj)) + row('연구', esc(c.rs || '없음')) + row('주문', esc(c.spells || '없음')) + row('사역마', esc(c.fam || '없음')) + '</tbody></table></div>';
    h += '<div class="scroll" style="margin-top:6px"><table><thead><tr><th>칸</th><th>장비</th><th>등급</th><th>Lv</th><th>강화</th><th>품질</th><th>옵션 · 수치</th></tr></thead><tbody>' + c.eq.map(function (e) {
      return '<tr><td>' + esc(SLOTN[e.slot] || e.slot) + '</td><td>' + esc(e.name) + '</td><td>' + esc(RN[e.r] || e.r) + '</td><td>' + e.ilvl + '</td><td>+' + e.enh + '</td><td>' + fx(e.q) + '</td><td>' +
        esc(Object.keys(e.stats).map(function (k) { return k + ' ' + fx(e.stats[k]); }).join(' · ') + (e.eng ? ' · 각인 ' + e.eng.id + ' ' + fx(e.eng.v) : '')) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    return h;
  }
  function when(t) { if (!t) return '—'; var d = new Date(t * 1000); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function api(method, path, body) {
    return fetch(path, { method: method, headers: { 'Content-Type': 'application/json', 'X-Admin-Token': tok }, body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json().then(function (j) { j._s = r.status; return j; }); });
  }
  function toast(t) { var el = document.createElement('div'); el.className = 'toast'; el.innerHTML = '<b>' + esc(t) + '</b>'; $('#toasts').appendChild(el); setTimeout(function () { el.remove(); }, 2500); }
  function enter() {
    api('GET', '/api/admin/stats').then(function (j) {
      if (j._s !== 200) { $('#lmsg').textContent = j.error || '들어갈 수 없습니다'; $('#login').hidden = false; $('#main').hidden = true; return; }
      try { sessionStorage.setItem('arc_admin', tok); } catch (e) { }
      $('#login').hidden = true; $('#main').hidden = false; stats(j); invites(); reports(); sdmThreads(); sdmView(); mails(); oplog(); sys(); bdload();
    });
  }
  var WBA = 0, WBF = 0;
  // 추가 보스 체력 미리 보기: 인원 × 1회 피해 × 주 끝까지 칠 수 있는 횟수 (참고: 지금까지 피해 속도로 본 남은 기간 예상 피해)
  function wbEst() {
    var hp = +$('#wbhp').value || (+$('#wbn').value || 200) * (+$('#wbper').value || 20000) * WBA;
    $('#wbest').textContent = '지금 부르면 한 학생이 주 끝까지 최대 ' + WBA + '번 칠 수 있습니다 → 체력 ' + hp.toLocaleString() + (WBF ? ' · 참고로 지금까지의 피해 속도라면 주 끝까지 약 ' + WBF.toLocaleString() + ' 피해가 들어옵니다' : '');
  }
  ['#wbn', '#wbper', '#wbhp'].forEach(function (s) { $(s).addEventListener('input', wbEst); });
  function stats(j) {
    var rows = [['학생 수', j.players], ['24시간 활동', j.active24h], ['7일 활동', j.active7d], ['지금 접속(2분)', j.online2m], ['채팅 연결', j.chatConnections + ' (' + j.chatOnline + '명)'], ['메모리', j.memoryMB + 'MB'], ['가동 시간', j.uptimeH + '시간'],
      ['가입', (j.inviteRequired ? '초대코드 필요' : '초대코드 없이') + ' · 게스트 ' + (j.guestSignup ? '켜짐' : '꺼짐')], ['이번 주 보스', j.boss ? j.boss.name + ' ' + Math.round(j.boss.hp / j.boss.maxHp * 100) + '%' + (j.boss.killedAt ? ' (토벌됨)' : '') : '—'], ['개교일', when(j.epoch)]];
    WBA = j.wbAttacks || 0; WBF = j.wbForecast || 0; wbEst();
    $('#stats').innerHTML = rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('');
  }
  try { if (localStorage.getItem('arc_admin_ihide') !== '0') $('#ihide').checked = true; } catch (e) { $('#ihide').checked = true; }
  $('#ihide').addEventListener('change', function () { try { localStorage.setItem('arc_admin_ihide', $('#ihide').checked ? '1' : '0'); } catch (e) { } invites(); });
  var ISHOW = 10, UBOPEN = {};
  // 사용한 학생: 여러 명이면 앞 2명만 보이고 「외 N명」으로 펼친다
  function ubCell(i) {
    var names = String(i.used_by || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (names.length <= 2) return '<td class="iub" title="' + esc(names.join(', ')) + '">' + names.map(function (n) { return pl(n); }).join(', ') + '</td>';
    var open = UBOPEN[i.code];
    return '<td class="iub' + (open ? ' open' : '') + '">' + (open ? names : names.slice(0, 2)).map(function (n) { return pl(n); }).join(', ') + '<button class="ubm" data-a="ubmore" data-c="' + esc(i.code) + '">' + (open ? '접기' : '외 ' + (names.length - 2) + '명') + '</button></td>';
  }
  // 메모 칸 너비: 경계를 끌어서 조절 (이 브라우저에 기억)
  (function () {
    var tb = $('#invites').closest('table'), g = $('#imgrip'), W0 = 180;
    function setW(w) { w = Math.max(80, Math.min(600, Math.round(w))); tb.style.setProperty('--imw', w + 'px'); return w; }
    try { var sw = +localStorage.getItem('arc_admin_imw'); if (sw) setW(sw); } catch (e) { }
    g.addEventListener('pointerdown', function (e) {
      e.preventDefault(); var x0 = e.clientX, w0 = g.parentNode.getBoundingClientRect().width, w = w0;
      g.setPointerCapture(e.pointerId); g.classList.add('drag');
      function mv(ev) { w = setW(w0 + ev.clientX - x0); }
      function up() { g.classList.remove('drag'); g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); try { localStorage.setItem('arc_admin_imw', String(w)); } catch (e2) { } }
      g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
    });
    g.addEventListener('dblclick', function () { setW(W0); try { localStorage.removeItem('arc_admin_imw'); } catch (e) { } });
  })();
  // 마감: 마지막 사용(가입) 시각 + 코드를 만든 때부터 걸린 시간. 아직 남았으면 첫 사용 시각 (가입 시각으로 계산하므로 이미 마감된 코드에도 보인다)
  function dur(s) { s = Math.max(0, Math.round(s)); return s < 60 ? s + '초' : s < 3600 ? Math.floor(s / 60) + '분 ' + (s % 60) + '초' : s < 86400 ? Math.floor(s / 3600) + '시간 ' + Math.floor(s % 3600 / 60) + '분' : Math.floor(s / 86400) + '일 ' + Math.floor(s % 86400 / 3600) + '시간'; }
  function whenS(t) { var d = new Date(t * 1000), p = function (n) { return String(n).padStart(2, '0'); }; return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }   // 초까지
  function closeCell(i) {
    if (!i.first_at) return '<td class="faint">-</td>';
    var full = i.uses >= i.max_uses, tip = '코드 생성 ' + when(i.created) + ' · 첫 사용 ' + when(i.first_at) + (i.max_uses > 1 ? ' · 마지막 사용 ' + when(i.last_at) : '');
    return '<td class="num iclose" title="' + esc(tip) + '">' + (full ? '<b>' + whenS(i.last_at) + '</b><div class="tiny faint">' + dur(i.last_at - i.created) + ' 만에 마감</div>' : '<span class="faint">첫 사용 ' + whenS(i.first_at) + '</span>') + '</td>';
  }
  function invites() {
    api('GET', '/api/admin/invites').then(function (j) {
      // 다 쓴 · 막은 · 기한 지난 코드는 숨길 수 있다 (이 브라우저에 기억)
      var all = j.invites || [], nowS = Date.now() / 1000, hide = $('#ihide').checked, done = function (i) { return i.disabled || i.uses >= i.max_uses || (i.expires && i.expires < nowS); };
      var list = hide ? all.filter(function (i) { return !done(i); }) : all;
      // 남은 코드: 아직 쓸 수 있는 코드 수와 그 코드로 더 가입할 수 있는 인원 (운영자 코드는 따로)
      var left = all.filter(function (i) { return !done(i) && !i.op; }), seats = left.reduce(function (a, i) { return a + i.max_uses - i.uses; }, 0), opl = all.filter(function (i) { return !done(i) && i.op; }).length;
      $('#ileft').innerHTML = '남은 코드 <b>' + left.length + '</b>개 · 남은 인원 <b>' + seats + '</b>명' + (opl ? ' <span class="tiny faint">(운영자 코드 ' + opl + '개 별도)</span>' : '') + (all.length >= 500 ? ' <span class="tiny faint">· 최근 500개 기준</span>' : '');
      var full = list.length; list = list.slice(0, ISHOW);   // 10개씩 보이고 「더보기」로 20개씩 더
      $('#icount').textContent = hide && list.length < all.length ? '숨긴 코드 ' + (all.length - list.length) + '개' : '';
      $('#invites').innerHTML = list.map(function (i) {
        return '<tr class="' + (i.disabled ? 'dis' : '') + '"><td class="num">' + esc(i.code) + (i.op ? ' <b style="color:#e07c72">운영자</b>' : '') + '</td><td class="num">' + i.uses + ' / ' + i.max_uses + '</td>' + closeCell(i) + '<td>' + (i.expires ? when(i.expires) : '무기한') + '</td><td>' + esc(i.note) + '</td>' + ubCell(i) + '<td><button class="btn sm ghost" data-a="' + (i.disabled ? 'enable' : 'disable') + '" data-c="' + esc(i.code) + '">' + (i.disabled ? '다시 쓰기' : '중지') + '</button></td></tr>';
      }).join('') || '<tr><td colspan="7" class="faint">' + (all.length ? '쓸 수 있는 코드가 없습니다 (숨긴 코드는 위 체크를 풀면 보입니다)' : '아직 발급한 코드가 없습니다') + '</td></tr>';
      $('#imore').innerHTML = full > list.length ? '<button class="btn sm ghost" data-a="imore">더보기 (' + list.length + ' / ' + full + ')</button>' : (ISHOW > 10 && full > 10 ? '<button class="btn sm ghost" data-a="iless">접기</button>' : '');
    });
  }
  // 게시판 문의함
  var BDJ = null;
  try { if (localStorage.getItem('arc_admin_bdhide') === '1') $('#bdhide').checked = true; } catch (e) { }
  $('#bdhide').addEventListener('change', function () { try { localStorage.setItem('arc_admin_bdhide', $('#bdhide').checked ? '1' : '0'); } catch (e) { } bdshow(BDJ); });
  function bdload() { api('GET', '/api/admin/board').then(bdshow); }
  // 문의 상태: 답변 여부 · 답변 뒤 새 댓글 · 게시판 처리 상태(확인 중 / 해결 완료)와 연동. 숨기기를 켜면 답변함 · 해결 완료는 숨기되 새 댓글이 있으면 보인다
  var ST = { review: '검토 중', wip: '확인 중', done: '해결 완료', no: '반영 안 함', norepro: '재현 안 됨' };
  function bdstate(p) {
    var lastOp = -1; p.comments.forEach(function (c, i) { if (c.op) lastOp = i; });
    var answered = lastOp >= 0, fresh = answered && p.comments.slice(lastOp + 1).some(function (c) { return !c.op; });
    return { answered: answered, fresh: fresh, hide: !fresh && (answered || p.st === 'done') };
  }
  function bdshow(j) {
    BDJ = j; var all = (j && j.posts) || [], hide = $('#bdhide').checked, list = hide ? all.filter(function (p) { return !bdstate(p).hide; }) : all;
    $('#bdbox').innerHTML = (hide && list.length < all.length ? '<p class="tiny faint">숨긴 글 ' + (all.length - list.length) + '개</p>' : '') + (list.length ? list.map(function (p) {
      var s = bdstate(p), tag = s.fresh ? '<span class="small gold">새 댓글</span>' : !s.answered ? '<span class="small gold">새 문의</span>' : '<span class="small" style="color:#74bfa9">답변함</span>';
      var stTag = ST[p.st] ? ' <span class="small" style="color:' + (p.st === 'done' ? '#6fcf97' : '#6aa8ff') + '">' + ST[p.st] + '</span>' : '';
      var stBtns = [['review', '검토 중'], ['wip', '확인 중'], ['done', '해결 완료'], ['no', '반영 안 함'], ['norepro', '재현 안 됨'], ['', '표시 없음']].map(function (o) { return '<button class="btn sm' + ((p.st || '') === o[0] ? ' primary' : ' ghost') + '" data-a="bdst" data-c="' + p.id + '" data-s="' + o[0] + '">' + o[1] + '</button>'; }).join('');
      return '<details class="bdq"' + (s.answered && !s.fresh ? '' : ' open') + '><summary><b>' + esc(p.title) + '</b> <span class="small faint">' + pl(p.author) + ' · ' + when(p.created) + ' · 댓글 ' + p.comments.length + '</span> ' + tag + stTag + '</summary>' +
        '<div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><span class="tiny faint">처리 상태 (게시판과 연동)</span>' + stBtns + '</div>' +
        '<div class="msgtext" style="white-space:pre-wrap;margin:8px 0">' + esc(p.body) + '</div>' +
        p.comments.map(function (c) { return '<div class="small" style="margin:4px 0;padding:6px 8px;border-radius:6px;background:rgba(255,255,255,.04)"><b>' + esc(c.author) + '</b>' + (c.op ? ' <span class="gold">운영진</span>' : '') + ' <span class="faint">' + when(c.created) + '</span> <button class="btn sm ghost" data-a="bdcdel" data-c="' + c.id + '">지우기</button><div style="white-space:pre-wrap;margin-top:2px">' + esc(c.body) + '</div></div>'; }).join('') +
        '<div class="form" style="margin-top:6px"><textarea id="bdr-' + p.id + '" rows="2" maxlength="500" placeholder="운영진 답변 (500자)" style="flex:1;min-width:220px"></textarea><button class="btn sm primary" data-a="bdreply" data-c="' + p.id + '">답변</button><button class="btn sm danger" data-a="bddel" data-c="' + p.id + '">글 지우기</button></div></details>';
    }).join('') : '<p class="faint small">' + (all.length ? '보일 문의가 없습니다 (숨긴 글은 위 체크를 풀면 보입니다).' : '문의가 없습니다.') + '</p>');
  }
  // 신고 앞뒤 대화: 펼친 신고의 대화 HTML (msg_id → html). 30초마다 목록을 새로 그려도 펼친 채로 둔다
  var RCTX = {};
  function rctxHtml(j) {
    if (j.error) return '<p class="small faint">' + esc(j.error) + '</p>';
    return '<div class="scroll" style="max-height:340px"><table><tbody>' + j.list.map(function (m) {
      return '<tr' + (m.me ? ' style="background:rgba(224,124,114,.16)"' : '') + '><td class="tiny" style="white-space:nowrap">' + whenS(m.t) + '</td><td style="white-space:nowrap">' + (m.me ? '<b>' + pl(m.name) + '</b>' : pl(m.name)) + '</td><td class="msgtext">' + (m.kind === 'act' ? '<i>' : '') + (m.deleted ? '<s class="faint">' + esc(m.text) + '</s> <span class="tiny faint">(삭제됨)</span>' : esc(m.text)) + (m.kind === 'act' ? '</i>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="tiny faint" style="margin-top:4px">같은 채널의 앞 10건 · 뒤 10건입니다. 붉은 줄이 신고된 메시지입니다.</p>';
  }
  // 운영진 1:1: 대화 목록 · 고른 학생과의 대화
  var SDM = { peer: '', name: '' };
  function sdmThreads() {
    api('GET', '/api/admin/dm/threads').then(function (j) {
      $('#sdmthreads').innerHTML = (j.threads || []).map(function (t) { var un = t.from !== 'staff';
        return '<tr' + (t.peer === SDM.peer ? ' style="background:rgba(214,173,95,.14)"' : '') + '><td><button class="btn sm ghost" data-a="sdmgo" data-p="' + esc(t.peer) + '" data-n="' + esc(t.name) + '">' + esc(t.name) + '</button>' + (un ? ' <b class="tiny" style="color:#e07c72">답장</b>' : '') + '</td><td class="small msgtext">' + esc(t.text) + '</td><td class="tiny faint" style="white-space:nowrap">' + when(t.t) + '</td></tr>'; }).join('') || '<tr><td class="faint">아직 나눈 대화가 없습니다</td></tr>';
    });
  }
  function sdmView() {
    if (!SDM.peer) { $('#sdmbox').innerHTML = '<p class="small faint">왼쪽 목록이나 신고의 「신고자 1:1」에서 학생을 선택합니다.</p>'; return; }
    api('GET', '/api/admin/dm?peer=' + encodeURIComponent(SDM.peer)).then(function (j) {
      if (j.error) { $('#sdmbox').innerHTML = '<p class="small faint">' + esc(j.error) + '</p>'; return; }
      var log = (j.msgs || []).map(function (m) { var st = m.from === 'staff'; return '<div style="margin:4px 0;text-align:' + (st ? 'right' : 'left') + '"><span class="small" style="display:inline-block;max-width:85%;padding:6px 9px;border-radius:8px;white-space:pre-wrap;text-align:left;background:' + (st ? 'rgba(214,173,95,.18)' : 'rgba(255,255,255,.06)') + '">' + esc(m.text) + '</span><div class="tiny faint">' + (st ? '운영진' : esc(j.name || SDM.name)) + ' · ' + whenS(m.t) + '</div></div>'; }).join('');
      $('#sdmbox').innerHTML = '<b>' + esc(j.name || SDM.name) + '</b><div class="scroll" id="sdmlog" style="max-height:260px;margin-top:6px">' + (log || '<p class="small faint">아직 메시지가 없습니다.</p>') + '</div>' +
        '<textarea id="sdmtext" maxlength="500" rows="3" style="width:100%;margin-top:8px" placeholder="운영진 이름으로 보낼 내용 (500자 이내)"></textarea><div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn sm primary" data-a="sdmsend">보내기</button></div>';
      var lg = $('#sdmlog'); if (lg) lg.scrollTop = lg.scrollHeight;
    });
  }
  function reports() {
    api('GET', '/api/admin/reports' + ($('#showres').checked ? '?resolved=1' : '')).then(function (j) {
      $('#reports').innerHTML = (j.reports || []).map(function (r) {
        return '<tr><td>' + when(r.t) + '</td><td>' + esc(r.chName || r.ch) + '</td><td>' + pl(r.author, r.author_id) + '</td><td class="msgtext">' + (r.deleted ? '<s class="faint">' + esc(r.text) + '</s>' : esc(r.text)) + '</td><td>' + pl(r.reporter, r.reporter_id) + '</td><td class="msgtext">' + (r.reason ? esc(r.reason) : '<span class="faint">—</span>') + '</td><td><div class="row" style="gap:4px">' +
          '<button class="btn sm ghost" data-a="rctx" data-c="' + r.msg_id + '">앞뒤 대화</button>' +
          (r.author_id ? '<button class="btn sm ghost" data-a="sdmgo" data-p="' + esc(r.author_id) + '" data-n="' + esc(r.author) + '">작성자 1:1</button>' : '') +
          (r.reporter_id ? '<button class="btn sm ghost" data-a="sdmgo" data-p="' + esc(r.reporter_id) + '" data-n="' + esc(r.reporter) + '">신고자 1:1</button>' : '') +
          (r.deleted ? '' : '<button class="btn sm danger" data-a="del" data-c="' + r.msg_id + '" data-r="' + r.id + '">메시지 삭제</button>') +
          '<button class="btn sm" data-a="rmute" data-p="' + esc(r.author_id) + '" data-r="' + r.id + '" data-m="1440">작성자 1일 채팅 금지</button>' +
          (r.resolved ? '' : '<button class="btn sm ghost" data-a="resolve" data-r="' + r.id + '">처리 완료</button>') + '</div></td></tr>' +
          (RCTX[r.msg_id] ? '<tr class="rctx"><td colspan="7">' + RCTX[r.msg_id] + '</td></tr>' : '');
      }).join('') || '<tr><td colspan="7" class="faint">' + ($('#showres').checked ? '처리한 신고가 없습니다' : '새 신고가 없습니다') + '</td></tr>';
    });
  }
  var MRW = [['shard', '별조각'], ['gold', CUR], ['stone', '마석'], ['mana', '마나'], ['know', '지식'], ['egg', '환수의 알'], ['ticket', '토벌 도전권'], ['respec', '망각의 차'], ['rsDone', '연구 즉시 완료 물약'], ['gradeUp', '학년 진급 물약'], ['gear', '희귀 장비 상자']];
  $('#mrw').innerHTML = MRW.map(function (k) { return '<label>' + k[1] + '<input type="number" min="0" step="1" data-rw="' + k[0] + '" placeholder="0" style="width:96px"></label>'; }).join('');
  function rwText(r) { return MRW.filter(function (k) { return r[k[0]]; }).map(function (k) { return k[1] + ' ' + r[k[0]]; }).join(', ') || '—'; }
  function day(t) { var d = new Date(t * 1000); return t >= 32503600000 ? '거의 영구' : d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate(); }
  function mails() {
    api('GET', '/api/admin/mail').then(function (j) {
      $('#mails').innerHTML = (j.mails || []).map(function (m) { return '<tr class="' + (m.deleted ? 'dis' : '') + '"><td>' + when(m.created) + '</td><td>' + esc(m.to) + (m.to === '모든 학생' && !m.newcomers ? ' <span class="tiny faint">(보낸 때 학생만)</span>' : '') + '</td><td>' + esc(m.title) + '</td><td>' + esc(rwText(m.rewards)) + '</td><td>' + day(m.expires) + '</td><td class="num">' + m.claims + '</td><td>' + (m.deleted ? '<span class="faint">회수함</span>' : '<button class="btn sm danger" data-a="mdel" data-c="' + m.id + '">회수</button>') + '</td></tr>'; }).join('') || '<tr><td colspan="7" class="faint">보낸 우편이 없습니다</td></tr>';
    });
  }
  document.addEventListener('change', function (e) {
    if (e.target.name === 'mto') { var names = e.target.value === 'names'; $('#mnamesw').hidden = !names; $('#mnewl').hidden = names; }
    if (e.target.id === 'mexp') $('#mdatew').hidden = e.target.value !== 'date';
  });
  function oplog() { api('GET', '/api/admin/oplog').then(function (j) { $('#oplog').innerHTML = (j.log || []).map(function (l) { return '<tr><td>' + when(l.t) + '</td><td>' + esc(l.name || l.actor) + '</td><td>' + esc({ slow: '슬로우 모드', role: '운영자 지정', maint: '점검', build: '새 버전' }[l.action] || l.action) + '</td><td>' + esc(l.detail) + '</td></tr>'; }).join('') || '<tr><td colspan="4" class="faint">기록이 없습니다</td></tr>'; }); }
  function kst(t) { return t ? new Date(t * 1000).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : ''; }
  function showPin(l) { l = (Array.isArray(l) ? l : l ? [l] : []).filter(function (p) { return p && p.text; }); $('#pinnow').innerHTML = l.length ? l.map(function (p) { return '<span style="display:block">고정 중: ' + esc(p.text.slice(0, 60)) + (p.text.length > 60 ? '…' : '') + ' <button class="btn sm ghost" data-a="unpin" data-id="' + esc(String(p.id)) + '">해제</button></span>'; }).join('') : '고정 공지 없음 (최대 2개)'; }
  function sys() { api('GET', '/api/admin/sys').then(function (j) { if (j.error) return; showPin(j.pins || j.pin); var m = j.maint || {}, b = j.build || {}; $('#sysnow').textContent = '지금: ' + (m.on ? '점검 중' + (m.until ? ' (' + kst(m.until) + ' 종료 예정)' : '') : m.start ? '점검 예고 ' + kst(m.start) : '점검 없음') + ' · 화면 빌드 ' + (b.build || 0) + (b.minBuild ? ' · 최소 ' + b.minBuild : ''); if (j.epoch) { var e = new Date((j.epoch + 9 * 3600) * 1000).toISOString().slice(0, 10); $('#epnow').textContent = '지금 개교일: ' + e + (j.cal ? ' · 오늘은 ' + j.cal.year + '년 ' + j.cal.month + ' ' + j.cal.d + '일' : '') + (j.epoch > Date.now() / 1000 ? ' (개교일이 미래라 달력이 1일에 멈춰 있습니다)' : ''); if (!$('#epdate').value) $('#epdate').value = e; } }); }
  function tsOf(id) { var v = $(id).value; return v ? Math.floor(new Date(v + ':00+09:00').getTime() / 1000) : 0; }
  function maint(o, msg) { api('POST', '/api/admin/maint', o).then(function (j) { toast(j.error || msg); sys(); oplog(); }); }
  var A = {
    oplog: oplog,
    mtplan: function () { var st = tsOf('#mtstart'); if (!st || st < Date.now() / 1000) return toast('이후 시각 선택 필요'); maint({ start: st, until: tsOf('#mtuntil'), msg: $('#mtmsg').value }, '점검을 예고했습니다'); },
    mton: function () { if (!confirm('지금 점검을 시작합니다. 운영자가 아닌 학생은 모두 점검 화면으로 바뀝니다.')) return; maint({ on: true, until: tsOf('#mtuntil'), msg: $('#mtmsg').value }, '점검을 시작했습니다'); },
    mtoff: function () { maint({ on: false }, '점검을 끝냈습니다'); },
    epoch: function () { var v = $('#epdate').value; if (!v) return toast('날짜 선택 필요'); if (!confirm('개교일을 ' + v + '로 바꿉니다. 아카데미력 날짜 · 달 축복 · 날씨가 이 날짜 기준으로 바뀝니다.')) return; api('POST', '/api/admin/epoch', { date: v }).then(function (j) { toast(j.error || ('개교일을 바꿨습니다 · 오늘은 ' + j.cal.month + ' ' + j.cal.d + '일')); sys(); oplog(); }); },
    build: function () { api('POST', '/api/admin/build', { build: +$('#bdbuild').value || 0, minBuild: +$('#bdmin').value || 0 }).then(function (j) { toast(j.error || '새 버전을 알렸습니다'); sys(); oplog(); }); },
    opon: function () { var n = $('#un').value.trim(); if (!n) return; api('POST', '/api/admin/ops', { name: n, rank: 'admin' }).then(function (j) { $('#umsg').textContent = j.error || n + ' 님을 학생회(운영진)로 지정했습니다 · 칭호 「학생회」를 낄 수 있습니다'; oplog(); }); },
    opchief: function () { var n = $('#un').value.trim(); if (!n) return; if (!confirm(n + ' 님을 학생회장으로 지정합니다.')) return; api('POST', '/api/admin/ops', { name: n, rank: 'chief' }).then(function (j) { $('#umsg').textContent = j.error || n + ' 님을 학생회장으로 지정했습니다 · 칭호 「학생회장」 · 「학생회」를 낄 수 있습니다'; oplog(); }); },
    // 이름 ↔ 아이디 확인: 이름 칸이 차 있으면 이름으로, 비어 있으면 아이디로 찾는다. 둘 다 넣으면 그 아이디가 맞는지도 대조
    lookup: function () {
      var n = $('#un').value.trim(), lg = $('#ulogin').value.trim(); if (!n && !lg) { $('#umsg').textContent = '학생 이름이나 아이디 입력 필요'; return; }
      api('POST', '/api/admin/lookup', { name: n, login: lg }).then(function (j) {
        if (j.error) { $('#umsg').textContent = j.error; return; }
        var chk = j.match === true ? ' · 입력한 아이디 「' + lg + '」 일치' : j.match === false ? ' · 입력한 아이디 「' + lg + '」는 이 학생의 아이디가 아닙니다' : '';
        $('#umsg').textContent = '학생 이름 「' + j.name + '」 · 아이디 ' + (j.login ? '「' + j.login + '」' : '(아직 기록 없음 · 다음 로그인 때 기록 · 아이디 칸에 짐작 아이디를 넣고 조회하면 맞는지 확인 가능)') + chk + (j.rank ? ' · ' + j.rank : '') + (j.banned ? ' · 이용 정지' : '');
      });
    },
    // 학생 활동 기록: 게임 안 기록 최근 50줄(같은 일이 이어지면 ×횟수)과 영웅 · 전설 장비 보유 현황
    // 백업과 비교: 백업 시점의 가방 · 장착 장비와 지금을 비교 (사라진 장비 · 새로 생긴 장비 · 자원 변화)
    bklist: function () {
      var n = $('#un').value.trim(); if (!n) { $('#umsg').textContent = '학생 이름 입력 필요'; return; }
      api('GET', '/api/admin/backups').then(function (j) {
        var fs = j.files || []; if (!fs.length) { $('#bkbox').innerHTML = '<p class="small faint" style="margin-top:8px">서버에 백업이 없습니다.</p>'; return; }
        $('#bkbox').innerHTML = '<div class="form" style="margin-top:10px"><label>비교할 백업<select id="bkfile">' + fs.map(function (f) { return '<option value="' + esc(f.file) + '">' + whenS(f.t) + ' · ' + Math.round(f.size / 1024) + 'KB</option>'; }).join('') + '</select></label><button class="btn primary" data-a="bkgo">비교</button><span class="tiny faint">백업은 12시간마다 만들어지며 최근 14개(약 7일)를 보관합니다. 비교에는 몇 초 걸릴 수 있습니다.</span></div><div id="bkres"></div>';
      });
    },
    bkgo: function () {
      var n = $('#un').value.trim(), f = $('#bkfile') && $('#bkfile').value; if (!n || !f) return;
      $('#bkres').innerHTML = '<p class="small faint" style="margin-top:8px">비교 중입니다…</p>';
      api('POST', '/api/admin/bkcompare', { name: n, file: f }).then(function (j) {
        if (j.error) { $('#bkres').innerHTML = '<p class="small" style="margin-top:8px">' + esc(j.error) + '</p>'; return; }
        var RC = ['#b9bccb', '#7cc68a', '#6aa8ff', '#c084fc', '#f2b84b'], d = j.diff;
        BKNAME = j.name;
        var tb = function (list, why) { return '<div class="scroll" style="margin-top:6px;max-height:340px"><table><thead><tr><th>장비</th><th>등급</th><th>Lv</th><th>종류</th><th>옵션</th><th>당시 위치</th>' + (why ? '<th>추정</th><th></th>' : '') + '</tr></thead><tbody>' + (list.map(function (x, i) { return '<tr><td style="color:' + RC[x.r] + '">' + esc(x.name) + (x.lock ? ' <span class="tiny faint">(잠금)</span>' : '') + '</td><td>' + esc(x.rn) + '</td><td class="num">' + x.ilvl + '</td><td>' + esc(x.slot) + '</td><td class="small">' + esc(x.opt || '') + '</td><td>' + esc(x.at) + '</td>' + (why ? '<td class="small">' + esc(x.why) + '</td><td>' + reBtn(x) + '</td>' : '') + '</tr>'; }).join('') || '<tr><td colspan="8" class="faint">없음</td></tr>') + '</tbody></table></div>'; };
        var sg = function (v) { return (v > 0 ? '+' : '') + Number(v).toLocaleString(); };
        window.__bkJson = JSON.stringify(j);
        $('#bkres').innerHTML = '<p class="small" style="margin-top:10px"><b>「' + esc(j.name) + '」 · ' + whenS(j.bkT) + ' 백업 → 지금</b></p>' +
          '<p class="small">분해 횟수 <b>' + sg(d.dismantled) + '</b> · 마석 ' + sg(d.stone) + ' · 마석가루 ' + sg(d.dust) + ' · 아르크 ' + sg(d.gold) + ' · 얻은 영웅 ' + sg(d.epicFound) + ' · 레벨 ' + sg(d.lvl) + (j.auto ? ' · 분류 마법 자동 처분: 당시 ' + esc(j.auto.then) + ' → 지금 ' + esc(j.auto.now) : ' · 분류 마법 연구 전') + '</p>' +
          '<p class="small" style="margin-top:8px"><b>사라진 장비 ' + j.gone.length + '개</b> <span class="tiny faint">(거래소 판매 · 등록은 거래 기록과 대조해 표시. 나머지는 분해 · 매점 판매 · 자동 처분 중 하나이며, 「분해 횟수」 변화로 분해 개수를 가늠할 수 있습니다)</span></p>' + tb(j.gone, true) +
          '<p class="small" style="margin-top:10px"><b>새로 생긴 장비 ' + j.got.length + '개</b></p>' + tb(j.got, false) +
          '<p class="tiny faint" style="margin-top:6px">백업과 백업 사이에 들어왔다가 바로 사라진 장비는 어느 백업에도 없어 이 비교에 나오지 않습니다. 앞으로의 처분은 「활동 기록 → 장비 처분 기록」에 남습니다.</p>';
      });
    },
    // 재지급: 사라진 장비를 같은 옵션 그대로 우편으로 (보내기는 운영자가 직접 누른다)
    bkre: function (el) {
      var x = RE[+el.dataset.c]; if (!x) return;
      $('#rebox').innerHTML = '<div class="card inset" style="margin-top:10px"><b>장비 재지급 · ' + esc(BKNAME) + '</b><p class="small" style="margin-top:4px">' + esc(x.rn + ' ' + x.slot + ' 「' + x.name + '」 Lv ' + x.ilvl + ' · ' + (x.opt || '')) + '</p>' +
        (x.dy ? '<label class="tog small" style="margin-top:6px"><input type="checkbox" id="bkr-rc"> 분해로 얻은 마석 ' + x.dy.stone + ' · 마석가루 ' + x.dy.dust + '도 함께 회수 <span class="tiny faint">(가진 만큼만 · 학생 일지에 남음)</span></label>' : '') +
        '<div class="form" style="margin-top:8px;flex-direction:column;align-items:stretch"><label>제목<input id="bkr-t" value="장비 복구 안내"></label><label>내용<textarea id="bkr-b" rows="3">요청하신 장비를 같은 옵션으로 복구해 드립니다. 우편함에서 받으실 수 있습니다.</textarea></label></div>' +
        '<div class="row" style="justify-content:flex-end;gap:6px;margin-top:8px"><button class="btn ghost" data-a="bkrno">취소</button><button class="btn primary" data-a="bkrgo" data-c="' + el.dataset.c + '">이 학생에게 우편 보내기</button></div></div>';
      $('#rebox').scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    reclaim: function () {
      var n = $('#un').value.trim(); if (!n) { $('#umsg').textContent = '학생 이름 입력 필요'; return; }
      var rs = {}, parts = [], NM = { stone: '마석', dust: '마석가루', gold: CUR, shard: '별조각' };
      Object.keys(NM).forEach(function (k) { var v = Math.floor(+($('#rc-' + k).value || 0)); if (v > 0) { rs[k] = v; parts.push(NM[k] + ' ' + v.toLocaleString()); } });
      if (!parts.length) { $('#umsg').textContent = '회수할 양 입력 필요'; return; }
      if (!confirm('「' + n + '」 학생에게서 ' + parts.join(' · ') + '을(를) 회수합니다. 계속하시겠습니까?')) return;
      api('POST', '/api/admin/reclaim', { name: n, res: rs, reason: $('#rc-why').value.trim() }).then(function (j) {
        if (j.error) { $('#umsg').textContent = j.error; return; }
        var sh = Object.keys(j.short || {}).map(function (k) { return (NM[k] || k) + ' ' + j.short[k].toLocaleString(); });
        $('#umsg').textContent = '「' + j.name + '」 회수 완료 · ' + Object.keys(j.took).map(function (k) { return (NM[k] || k) + ' ' + j.took[k].toLocaleString(); }).join(' · ') + (sh.length ? ' (보유량이 모자라 ' + sh.join(' · ') + '은(는) 회수하지 못했습니다)' : '') + ' · 남은 양: 마석 ' + j.res.stone + ' · 마석가루 ' + j.res.dust;
        ['stone', 'dust', 'gold', 'shard'].forEach(function (k) { $('#rc-' + k).value = ''; }); oplog();
      });
    },
    // 학생 카드 창
    pcard: function (el) {
      var q = el.dataset.p ? 'id=' + encodeURIComponent(el.dataset.p) : 'name=' + encodeURIComponent(el.dataset.n || '');
      api('GET', '/api/admin/pcard?' + q).then(function (j) {
        if (j.error) { toast(j.error); return; }
        var box = $('#pcmodal') || (function () { var d = document.createElement('div'); d.id = 'pcmodal'; d.className = 'pcm'; document.body.appendChild(d); d.addEventListener('click', function (e) { if (e.target === d) d.hidden = true; }); return d; })();
        var row = function (k, v) { return v ? '<div class="row small" style="gap:8px;margin-top:3px"><span class="faint" style="width:64px;flex:none">' + k + '</span><span>' + v + '</span></div>' : ''; };
        box.innerHTML = '<div class="card pcmb"><div class="row" style="gap:12px;align-items:center">' + (j.av ? '<img src="' + j.av + '" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover">' : '<span class="pcav">' + esc(j.name.slice(0, 1)) + '</span>') +
          '<div style="flex:1;min-width:0"><div class="small faint">' + esc(j.title || '') + '</div><h3 style="margin:2px 0">' + esc(j.name) + (j.online ? ' <span class="tiny" style="color:#5fc59a">● 접속 중</span>' : '') + '</h3><div class="small">' + esc(j.house + ' · ' + j.grade + '학년 · Lv ' + j.lvl + (j.cls ? ' · ' + j.cls : '')) + '</div></div><button class="btn sm ghost" data-a="pcclose">닫기</button></div>' +
          (j.banned ? '<p class="small" style="color:#e07c72;margin-top:6px">이용 정지된 계정입니다</p>' : '') + (j.deleted ? '<p class="small faint" style="margin-top:6px">초기화로 남은 예전 캐릭터입니다</p>' : '') +
          '<div style="margin-top:10px">' + row('전투력', Number(j.power || 0).toLocaleString()) + row('동아리', esc(j.guild)) + row('운영 등급', esc(j.role)) + row('상태', esc(j.status)) + row('좋아하는 것', esc(j.fav)) + row('입학', whenS(j.created)) + row('마지막 접속', j.seen ? whenS(j.seen) : '') + '</div>' +
          (j.bio ? '<div class="small" style="margin-top:8px;white-space:pre-wrap;padding:8px;border-radius:6px;background:rgba(255,255,255,.05)">' + esc(j.bio) + '</div>' : '') +
          '<div class="row" style="gap:6px;margin-top:12px;flex-wrap:wrap;justify-content:flex-end"><button class="btn sm ghost" data-a="pcgo" data-c="plog" data-n="' + esc(j.name) + '">활동 기록</button><button class="btn sm ghost" data-a="sdmgo" data-p="' + esc(j.id) + '" data-n="' + esc(j.name) + '">1:1</button></div></div>';
        box.hidden = false;
      });
    },
    pcclose: function () { var b = $('#pcmodal'); if (b) b.hidden = true; },
    pcgo: function (el) { var b = $('#pcmodal'); if (b) b.hidden = true; $('#un').value = el.dataset.n; A[el.dataset.c](); $('#un').scrollIntoView({ behavior: 'smooth', block: 'center' }); },
    bkrno: function () { $('#rebox').innerHTML = ''; },
    bkrgo: function (el) {
      var x = RE[+el.dataset.c]; if (!x || el.disabled) return; el.disabled = true;
      var rc = $('#bkr-rc') && $('#bkr-rc').checked && x.dy ? api('POST', '/api/admin/reclaim', { name: BKNAME, res: { stone: x.dy.stone, dust: x.dy.dust }, reason: '「' + x.name + '」 복구에 따른 분해 재료 회수' }) : Promise.resolve({});
      rc.then(function (r1) { if (r1.error) { toast('회수 실패: ' + r1.error); el.disabled = false; return; }
      api('POST', '/api/admin/mail', { to: BKNAME, title: $('#bkr-t').value.trim(), body: $('#bkr-b').value.trim(), days: 30, rewards: { items: [x.item] } }).then(function (j) {
        if (j.error) { toast(j.error); el.disabled = false; return; }
        $('#rebox').innerHTML = '<p class="small good" style="margin-top:8px">「' + esc(x.name) + '」 재지급 우편을 보냈습니다.' + (r1.took ? ' 회수: 마석 ' + (r1.took.stone || 0) + ' · 마석가루 ' + (r1.took.dust || 0) + (Object.keys(r1.short || {}).length ? ' (보유량이 모자라 일부만 회수)' : '') : '') + '</p>'; mails(); oplog();
      }); });
    },
    plogcopy: function () { var t = window.__plogJson || ''; if (!t) return; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { $('#umsg').textContent = '분석용 기록을 복사했습니다'; }, function () { prompt('아래 내용을 복사하십시오', t); }); },
    plog: function () {
      var n = $('#un').value.trim(); if (!n) { $('#umsg').textContent = '학생 이름 입력 필요'; return; }
      api('POST', '/api/admin/plog', { name: n }).then(function (j) {
        if (j.error) { $('#umsg').textContent = j.error; $('#plog').innerHTML = ''; return; }
        window.__plogJson = JSON.stringify({ name: j.name, card: j.card, high: j.high, st: j.st, auto: j.auto, dlog: j.dlog, log: j.log });
        $('#umsg').textContent = '「' + j.name + '」 활동 기록 · 원정 완료 ' + j.st.expJobs + '회 · 지금까지 얻은 영웅 ' + j.st.epicFound + '개 · 전설 ' + j.st.legendFound + '개';
        var RN = ['일반', '고급', '희귀', '영웅', '전설'];
        var dl = '<div class="row between" style="margin-top:10px"><b>장비 처분 기록</b><span class="small faint">분류 마법 자동 처분: ' + (j.auto ? esc(j.auto.on ? j.auto.upto + ' · ' + j.auto.mode : '꺼짐') : '연구 전') + '</span></div>' +
          '<div class="scroll" style="margin-top:6px;max-height:320px"><table><thead><tr><th>때</th><th>처분</th><th>개수</th><th>내용</th></tr></thead><tbody>' + ((j.dlog || []).map(function (d) { return '<tr><td>' + when(d.t) + '</td><td>' + esc(d.a) + (d.x ? ' <span class="tiny faint">(' + esc(d.x) + ')</span>' : '') + '</td><td class="num">' + d.n + '</td><td class="small">' + esc(d.it || (d.by + (d.lv ? ' · 최고 Lv ' + d.lv : ''))) +
            (d.keep && d.keep.length ? d.keep.map(function (x) { return '<div class="row" style="gap:6px;margin-top:4px;align-items:flex-start"><div style="flex:1">' + itemCell(x) + '</div>' + reBtn(x) + '</div>'; }).join('') : '') + '</td></tr>'; }).join('') || '<tr><td colspan="4" class="faint">기록 없음 (이 기능을 넣은 뒤부터 기록됩니다)</td></tr>') + '</tbody></table></div>';
        BKNAME = j.name; $('#rebox').innerHTML = '';
        dl += '<p class="small" style="margin-top:10px"><b>거래소 · 떠돌이 상인에서 산 장비</b> <span class="tiny faint">(최근 40건 · 옵션 그대로 남아 있어 재지급할 수 있습니다)</span></p><div class="scroll" style="margin-top:6px;max-height:300px"><table><thead><tr><th>때</th><th>장비</th><th>가격</th><th>산 곳</th><th>지금</th><th></th></tr></thead><tbody>' +
          ((j.bought || []).map(function (x) { return '<tr><td>' + when(x.t) + '</td><td>' + itemCell(x) + '</td><td class="num">' + Number(x.price).toLocaleString() + '</td><td class="small">' + esc(x.from) + '</td><td class="small">' + (x.have == null ? '—' : x.have ? '보유 중' : '<b style="color:#e07c72">없음</b>') + '</td><td>' + reBtn(x) + '</td></tr>'; }).join('') || '<tr><td colspan="6" class="faint">기록 없음</td></tr>') + '</tbody></table></div>';
        $('#plog').innerHTML = cardHtml(j.card, RN) + dl + '<p class="small" style="margin-top:8px"><b>보유 영웅 · 전설</b> ' + (j.high.length ? j.high.map(function (x) { return esc(RN[x.r] + ' · ' + x.name + ' (Lv ' + x.ilvl + ', ' + x.at + ')'); }).join(' / ') : '없음') + '</p>' +
          '<div class="scroll" style="margin-top:8px;max-height:320px"><table><thead><tr><th>때</th><th>기록</th></tr></thead><tbody>' + j.log.map(function (l) { return '<tr><td>' + when(l.t) + '</td><td>' + esc(l.m) + (l.n > 1 ? ' <b>×' + l.n + '</b>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
          '<p class="tiny faint" style="margin-top:4px">같은 기록이 이어지면 한 줄로 묶고 횟수(×)를 표시합니다. 시각은 마지막으로 일어난 때입니다.</p>';
      });
    },
    opoff: function () { var n = $('#un').value.trim(); if (!n) return; api('POST', '/api/admin/ops', { name: n, op: false }).then(function (j) { $('#umsg').textContent = j.error || n + ' 님의 운영자 권한을 뗐습니다'; oplog(); }); },
    slow: function () { api('POST', '/api/admin/slow', { sec: +$('#slowsec').value || 0 }).then(function (j) { toast(j.error || (j.sec ? '월드 슬로우 모드 ' + j.sec + '초' : '슬로우 모드를 껐습니다')); oplog(); }); },
    mforever: function () { $('#mexp').value = 'forever'; $('#mdatew').hidden = true; },
    // 초대코드 우편 배포: 받을 학생 수를 먼저 세고, 확인을 받은 뒤 보낸다
    imsend: function () {
      var o = { title: $('#imt').value.trim(), body: $('#imb').value, activeDays: +$('#imact').value, codeDays: +$('#imcd').value, mailDays: +$('#immd').value || 30 };
      if (!o.title) { $('#immsg').textContent = '제목 입력 필요'; return; }
      api('POST', '/api/admin/invitemail', Object.assign({ dry: true }, o)).then(function (j) {
        if (j.error) { $('#immsg').textContent = j.error; return; }
        if (!j.n) { $('#immsg').textContent = '받을 학생이 없습니다'; return; }
        if (!confirm(j.n + '명에게 1회용 초대코드를 한 장씩 새로 발급해 우편으로 보냅니다.\n제목: ' + o.title + '\n코드 기한: ' + $('#imcd').selectedOptions[0].text + '\n\n보낸 뒤에는 되돌릴 수 없습니다.')) return;
        o.expect = j.n; $('#immsg').textContent = '보내는 중…';
        api('POST', '/api/admin/invitemail', o).then(function (k) { $('#immsg').textContent = k.error || k.n + '명에게 보냈습니다'; if (!k.error) { invites(); oplog(); } });
      });
    },
    mail: function () {
      var to = document.querySelector('input[name=mto]:checked').value, rw = {}, n = 0;
      document.querySelectorAll('[data-rw]').forEach(function (i) { var v = Math.floor(+i.value || 0); if (v > 0) { rw[i.dataset.rw] = v; n++; } });
      var o = { title: $('#mtitle').value.trim(), body: $('#mbody').value, rewards: rw, to: to === 'all' ? '*' : to === 'tf' ? '@tf' : $('#mnames').value, newcomers: $('#mnew').checked }, ex = $('#mexp').value;
      if (!o.title) return toast('제목 입력 필요');
      if (ex === 'forever') o.forever = true; else if (ex === 'date') { if (!$('#mdate').value) return toast('만료 날짜 선택 필요'); o.expires = Math.floor(new Date($('#mdate').value + 'T23:59:59+09:00').getTime() / 1000); } else o.days = +ex;
      var go = function (who) {
      if (!confirm(who + '에게 「' + o.title + '」' + (/[가-힣]/.test((o.title || '').slice(-1)) && ((o.title.charCodeAt(o.title.length - 1) - 0xAC00) % 28) ? '을' : '를') + ' 보냅니다.\n보상: ' + rwText(rw) + '\n만료: ' + $('#mexp').selectedOptions[0].textContent)) return;
      api('POST', '/api/admin/mail', o).then(function (j) { if (j.error) { $('#mmsg').textContent = j.error; return; } $('#mmsg').textContent = '보냈습니다' + (j.n && j.n !== 'all' ? ' (' + j.n + '명)' : '') + (j.missing && j.missing.length ? ' · 없는 이름: ' + j.missing.join(', ') : ''); $('#mtitle').value = ''; $('#mbody').value = ''; document.querySelectorAll('[data-rw]').forEach(function (i) { i.value = ''; }); mails(); });
      };
      if (to === 'tf') api('POST', '/api/admin/mail', Object.assign({}, o, { dry: true })).then(function (j) { if (j.error) { $('#mmsg').textContent = j.error; return; } go('학점 이전 증서를 받은 학생 ' + j.n + '명'); });   // 대상 인원을 먼저 세어 확인 창에 보여 준다
      else go(to === 'all' ? '모든 학생' : '고른 학생');
    },
    mdel: function (el) { if (!confirm('이 우편을 회수할까요? 아직 받지 않은 학생에게서 사라집니다 (이미 받은 보상은 그대로).')) return; api('POST', '/api/admin/mail/delete', { id: +el.dataset.c }).then(mails); },
    refresh: function () { enter(); },
    wbsummon: function (el) {
      if (el.dataset.ok !== '1') { el.dataset.ok = '1'; el.textContent = '한 번 더 누르면 부릅니다'; setTimeout(function () { el.dataset.ok = ''; el.textContent = '추가 보스 부르기'; }, 4000); return; }
      el.dataset.ok = ''; el.textContent = '추가 보스 부르기';
      api('POST', '/api/admin/wbsummon', { hp: +$('#wbhp').value || 0, n: +$('#wbn').value || 200, per: +$('#wbper').value || 20000 }).then(function (j) { $('#wbmsg').textContent = j.error || (j.boss.name + ' 등장 (체력 ' + j.boss.maxHp.toLocaleString() + ')'); if (!j.error) enter(); });
    },
    issue: function () {
      var op = $('#iop').checked; if (op && !confirm('운영자 초대코드를 발급할까요? 이 코드로 가입한 사람은 운영자가 됩니다. 믿을 수 있는 사람에게만 직접 전해 주세요.')) return;
      api('POST', '/api/admin/invites', { count: +$('#ic').value, uses: +$('#iu').value, days: +$('#id').value, note: $('#in').value, op: op }).then(function (j) {
        if (j.error) return toast(j.error); $('#newcodes').hidden = false; $('#codesbox').textContent = j.codes.join('\n'); invites();
      });
    },
    copy: function () { var t = $('#codesbox').textContent; try { navigator.clipboard.writeText(t).then(function () { toast('복사했습니다'); }, sel); } catch (e) { sel(); } function sel() { var r = document.createRange(); r.selectNodeContents($('#codesbox')); var s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('선택했습니다. Ctrl+C로 복사'); } },
    disable: function (el) { api('POST', '/api/admin/invites/disable', { code: el.dataset.c }).then(invites); },
    enable: function (el) { api('POST', '/api/admin/invites/disable', { code: el.dataset.c, enable: true }).then(invites); },
    del: function (el) { api('POST', '/api/admin/chat/delete', { id: +el.dataset.c }).then(function () { return api('POST', '/api/admin/reports/resolve', { id: +el.dataset.r }); }).then(function () { toast('메시지를 삭제했습니다'); reports(); }); },
    rmute: function (el) { api('POST', '/api/admin/mute', { pid: el.dataset.p, minutes: +el.dataset.m }).then(function () { return api('POST', '/api/admin/reports/resolve', { id: +el.dataset.r }); }).then(function () { toast('하루 동안 채팅 금지'); reports(); }); },
    bdload: function () { bdload(); },
    imore: function () { ISHOW += 20; invites(); },
    iless: function () { ISHOW = 10; invites(); },
    ubmore: function (el) { var c = el.dataset.c; UBOPEN[c] = !UBOPEN[c]; invites(); },
    bdst: function (el) { api('POST', '/api/admin/board', { op: 'status', id: +el.dataset.c, st: el.dataset.s || '' }).then(function (j) { if (j.error) { toast(j.error); return; } bdshow(j); toast(el.dataset.s ? '「' + ST[el.dataset.s] + '」 표시를 붙였습니다' : '상태 표시를 뗐습니다'); }); },
    // 분포 통계: 이름 · 아이디 없이 숫자 분위만 (밸런스 조정용으로 Claude에게 붙여 넣는다)
    distcopy: function () {
      api('GET', '/api/admin/dist').then(function (j) {
        if (j.error) { toast(j.error); return; }
        var t = '[모네타 분포 통계 ' + when(j.at) + ']\n' + JSON.stringify(j);
        var done = function () { toast('복사했습니다 (학생 ' + j.students.all + '명 · 최근 7일 ' + j.students.active7d + '명) · Claude에게 붙여 넣으세요'); };
        if (navigator.clipboard) navigator.clipboard.writeText(t).then(done, function () { window.prompt('아래 내용을 복사하세요', t); });
        else window.prompt('아래 내용을 복사하세요', t);
      });
    },
    // 성장 데이터: 날마다 모은 스냅샷을 CSV 파일로 (엑셀 · 구글 시트에서 열기). 학생은 익명 번호
    growthdl: function () {
      api('GET', '/api/admin/growth?days=30').then(function (j) {
        if (j.error) { toast(j.error); return; }
        if (!j.rows) { toast('아직 모인 성장 기록이 없습니다. 12시간마다(한국 시각 0시 · 12시 구간) 저장됩니다'); return; }
        var blob = new Blob(['\ufeff' + j.csv], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'moneta-growth-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        toast('성장 데이터 ' + j.rows + '줄 · 저장 ' + j.days.length + '회분을 받았습니다');
      });
    },
    ideacopy: function () {
      api('GET', '/api/admin/ideas').then(function (j) {
        if (j.error) { toast(j.error); return; } if (!j.text) { toast('복사할 글이 없습니다'); return; }
        var done = function () { toast('복사했습니다 (' + j.text.split('\n---\n').length + '개 글) · Claude에게 붙여 넣으세요'); };
        if (navigator.clipboard) navigator.clipboard.writeText(j.text).then(done, function () { window.prompt('아래 내용을 복사하세요', j.text); });
        else window.prompt('아래 내용을 복사하세요', j.text);
      });
    },
    bdreply: function (el) { var t = $('#bdr-' + el.dataset.c); if (!t || !t.value.trim()) return; api('POST', '/api/admin/board', { op: 'reply', id: +el.dataset.c, text: t.value.trim() }).then(function (j) { if (j.error) return toast(j.error); toast('답변했습니다 · 학생에게 우편 알림'); bdshow(j); }); },
    bddel: function (el) { if (!confirm('이 글을 지울까요?')) return; api('POST', '/api/admin/board', { op: 'del', id: +el.dataset.c }).then(function (j) { if (j.error) return toast(j.error); bdshow(j); }); },
    bdcdel: function (el) { api('POST', '/api/admin/board', { op: 'cdel', cid: +el.dataset.c }).then(function (j) { if (j.error) return toast(j.error); bdshow(j); }); },
    sdmload: function () { sdmThreads(); sdmView(); },
    sdmgo: function (el) { var pb = $('#pcmodal'); if (pb) pb.hidden = true; SDM.peer = el.dataset.p; SDM.name = el.dataset.n || ''; sdmThreads(); sdmView(); $('#sdmcard').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    sdmopen: function () { var n = $('#sdmname').value.trim(); if (!n) return; api('GET', '/api/admin/dm?name=' + encodeURIComponent(n)).then(function (j) { if (j.error) { toast(j.error); return; } SDM.peer = j.peer; SDM.name = j.name; sdmThreads(); sdmView(); }); },
    sdmsend: function () {
      var tx = $('#sdmtext').value.trim(); if (!tx) return;
      api('POST', '/api/admin/dm', { pid: SDM.peer, text: tx }).then(function (j) { if (j.error) { toast(j.error); return; } SDM.peer = j.peer; SDM.name = j.name; toast('보냈습니다'); sdmThreads(); sdmView(); });
    },
    rctx: function (el) {
      var id = el.dataset.c; if (RCTX[id]) { delete RCTX[id]; reports(); return; }
      api('GET', '/api/admin/reports/ctx?id=' + encodeURIComponent(id)).then(function (j) { RCTX[id] = rctxHtml(j); reports(); });
    },
    resolve: function (el) { api('POST', '/api/admin/reports/resolve', { id: +el.dataset.r }).then(reports); },
    unpin: function (el) { var id = el && el.dataset.id; api('POST', '/api/admin/notice', id ? { unpin: true, id: id } : { unpin: true }).then(function (j) { showPin(j.pins || []); toast(j.error || '고정을 풀었습니다'); }); },
    notice: function () {
      var t = $('#nt').value.trim(); if (!t) return;
      api('POST', '/api/admin/notice', { text: t, pin: $('#ntpin').checked }).then(function (j) { if (j && j.pins !== undefined) showPin(j.pins); $('#ntpin').checked = false; return $('#ntchat').checked ? api('POST', '/api/admin/chat/system', { ch: 'world', text: '[공지] ' + t }) : null; }).then(function () { $('#nt').value = ''; toast('공지를 올렸습니다'); });
    },
    mute: function () { api('POST', '/api/admin/mute', { name: $('#un').value.trim(), minutes: +$('#um').value }).then(function (j) { $('#umsg').textContent = j.error || '적용했습니다'; }); },
    grant: function () { api('POST', '/api/admin/grant', { name: $('#un').value.trim(), shard: +$('#ug').value, reason: $('#ur').value }).then(function (j) { $('#umsg').textContent = j.error || '지급했습니다 (보유 ' + j.shard + ')'; }); },
    // 비밀번호를 잃어버린 학생: 임시 비밀번호 발급 (모든 기기에서 로그아웃 · 로그인하면 바꾸라고 안내)
    resetpw: function () {
      var n = $('#un').value.trim(); if (!n) { $('#umsg').textContent = '학생 이름 입력 필요'; return; }
      if (!confirm('「' + n + '」에게 임시 비밀번호를 발급합니다.\n지금 비밀번호로는 더 이상 로그인할 수 없고, 모든 기기에서 로그아웃됩니다.\n본인이 맞는지 먼저 확인하세요.')) return;
      api('POST', '/api/admin/resetpw', { name: n }).then(function (j) { $('#umsg').textContent = j.error || '「' + j.name + '」 임시 비밀번호: ' + j.temp + (j.login ? ' · 아이디 「' + j.login + '」' : ' · 아이디 기록 없음 (로그인 화면 「아이디 찾기」에서 이름 + 임시 비밀번호로 새 아이디를 정할 수 있습니다)') + ' · 학생에게만 따로 전해 주세요'; oplog(); });
    },
    // 아이디를 잃어버린 학생: 아이디 칸에 넣은 값으로 새로 정한다 (비밀번호는 그대로)
    setlogin: function () {
      var n = $('#un').value.trim(), lg = $('#ulogin').value.trim(); if (!n || !lg) { $('#umsg').textContent = '학생 이름과 새 아이디 입력 필요'; return; }
      if (!confirm('「' + n + '」의 아이디를 「' + lg + '」(으)로 새로 정합니다.\n예전 아이디로는 더 이상 로그인할 수 없고, 비밀번호는 그대로입니다.')) return;
      api('POST', '/api/admin/setlogin', { name: n, login: lg }).then(function (j) { $('#umsg').textContent = j.error || '「' + j.name + '」의 아이디를 「' + j.login + '」(으)로 정했습니다 · 새 아이디와 원래 비밀번호로 로그인'; oplog(); });
    },
    reset: function () {
      var n = $('#un').value.trim(), lg = $('#ulogin').value.trim(); if (!n) { $('#umsg').textContent = '학생 이름 입력 필요'; return; }
      if (!lg) { $('#umsg').textContent = '초기화할 학생의 아이디 입력 필요 (이름과 아이디가 모두 맞아야 합니다)'; return; }
      if (!confirm('「' + n + '」의 캐릭터를 초기화합니다.\n진행 상황 · 친구 · 파티 · 동아리가 모두 사라지고 되돌릴 수 없습니다.\n아이디 · 비밀번호는 그대로이며, 다음 로그인 때 새 학생을 만듭니다.')) return;
      if (prompt('확인을 위해 학생 이름을 한 번 더 입력하세요') !== n) { $('#umsg').textContent = '이름이 맞지 않아 취소했습니다'; return; }
      api('POST', '/api/admin/reset', { name: n, login: lg }).then(function (j) { $('#umsg').textContent = j.error || '「' + n + '」 캐릭터를 초기화했습니다. 다음 로그인 때 새 학생을 만듭니다.'; });
    },
    ban: function () { api('POST', '/api/admin/ban', { name: $('#un').value.trim() }).then(function (j) { $('#umsg').textContent = j.error || '정지했습니다'; }); },
    unban: function () { api('POST', '/api/admin/ban', { name: $('#un').value.trim(), ban: false }).then(function (j) { $('#umsg').textContent = j.error || '해제했습니다'; }); },
    backup: function () { api('POST', '/api/admin/backup', {}).then(function (j) { $('#umsg').textContent = j.error || '백업했습니다: ' + j.file; }); }
  };
  // 운영실 항목 접기: 각 카드의 제목(h3)을 누르면 접고 펼친다. 접은 항목은 이 브라우저에 기억
  (function () {
    var KEY = 'arc_admin_fold', folded = {}; try { folded = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { }
    function name(h) { return (h.childNodes[0] && h.childNodes[0].textContent || h.textContent).trim(); }
    Array.prototype.forEach.call(document.querySelectorAll('#main .card'), function (c) {
      var h = c.querySelector(':scope > h3, :scope > .row:first-child > h3'); if (!h) return;
      h.classList.add('fh'); h.title = '눌러서 접기 · 펼치기'; if (folded[name(h)]) c.classList.add('fold');
      h.addEventListener('click', function () { var on = c.classList.toggle('fold'); if (on) folded[name(h)] = 1; else delete folded[name(h)]; try { localStorage.setItem(KEY, JSON.stringify(folded)); } catch (e) { } });
    });
  })();
  document.addEventListener('click', function (e) { var el = e.target.closest('[data-a]'); if (el && A[el.dataset.a]) { e.preventDefault(); A[el.dataset.a](el); } });
  $('#go').addEventListener('click', function () { tok = $('#tok').value.trim(); enter(); });
  $('#tok').addEventListener('keydown', function (e) { if (e.key === 'Enter') { tok = $('#tok').value.trim(); enter(); } });
  $('#showres').addEventListener('change', reports);
  if (tok) enter();
  setInterval(function () { if (!$('#main').hidden && !document.hidden) { api('GET', '/api/admin/stats').then(function (j) { if (j._s === 200) stats(j); }); reports(); sdmThreads(); } }, 30000);
})();
