/* 아카데미 운영실: 관리자 API를 쓰는 작은 페이지 */
(function () {
  var CUR = '아르크';   // shared/data.js의 D.CUR와 같게
  var tok = ''; try { tok = sessionStorage.getItem('arc_admin') || ''; } catch (e) { }
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function when(t) { if (!t) return '—'; var d = new Date(t * 1000); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function api(method, path, body) {
    return fetch(path, { method: method, headers: { 'Content-Type': 'application/json', 'X-Admin-Token': tok }, body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json().then(function (j) { j._s = r.status; return j; }); });
  }
  function toast(t) { var el = document.createElement('div'); el.className = 'toast'; el.innerHTML = '<b>' + esc(t) + '</b>'; $('#toasts').appendChild(el); setTimeout(function () { el.remove(); }, 2500); }
  function enter() {
    api('GET', '/api/admin/stats').then(function (j) {
      if (j._s !== 200) { $('#lmsg').textContent = j.error || '들어갈 수 없습니다'; $('#login').hidden = false; $('#main').hidden = true; return; }
      try { sessionStorage.setItem('arc_admin', tok); } catch (e) { }
      $('#login').hidden = true; $('#main').hidden = false; stats(j); invites(); reports(); mails(); oplog(); sys(); bdload();
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
  function invites() {
    api('GET', '/api/admin/invites').then(function (j) {
      // 다 쓴 · 막은 · 기한 지난 코드는 숨길 수 있다 (이 브라우저에 기억)
      var all = j.invites || [], nowS = Date.now() / 1000, hide = $('#ihide').checked, done = function (i) { return i.disabled || i.uses >= i.max_uses || (i.expires && i.expires < nowS); };
      var list = hide ? all.filter(function (i) { return !done(i); }) : all;
      $('#icount').textContent = hide && list.length < all.length ? '숨긴 코드 ' + (all.length - list.length) + '개' : '';
      $('#invites').innerHTML = list.map(function (i) {
        return '<tr class="' + (i.disabled ? 'dis' : '') + '"><td class="num">' + esc(i.code) + (i.op ? ' <b style="color:#e07c72">운영자</b>' : '') + '</td><td class="num">' + i.uses + ' / ' + i.max_uses + '</td><td>' + (i.expires ? when(i.expires) : '무기한') + '</td><td>' + esc(i.note) + '</td><td>' + esc(i.used_by || '') + '</td><td><button class="btn sm ghost" data-a="' + (i.disabled ? 'enable' : 'disable') + '" data-c="' + esc(i.code) + '">' + (i.disabled ? '다시 쓰기' : '중지') + '</button></td></tr>';
      }).join('') || '<tr><td colspan="6" class="faint">' + (all.length ? '쓸 수 있는 코드가 없습니다 (숨긴 코드는 위 체크를 풀면 보입니다)' : '아직 발급한 코드가 없습니다') + '</td></tr>';
    });
  }
  // 게시판 문의함
  function bdload() { api('GET', '/api/admin/board').then(bdshow); }
  function bdshow(j) {
    var list = (j && j.posts) || [];
    $('#bdbox').innerHTML = list.length ? list.map(function (p) {
      var answered = p.comments.some(function (c) { return c.op; });
      return '<details class="bdq"' + (answered ? '' : ' open') + '><summary><b>' + esc(p.title) + '</b> <span class="small faint">' + esc(p.author) + ' · ' + when(p.created) + ' · 댓글 ' + p.comments.length + '</span> ' + (answered ? '<span class="small" style="color:#74bfa9">답변함</span>' : '<span class="small gold">새 문의</span>') + '</summary>' +
        '<div class="msgtext" style="white-space:pre-wrap;margin:8px 0">' + esc(p.body) + '</div>' +
        p.comments.map(function (c) { return '<div class="small" style="margin:4px 0;padding:6px 8px;border-radius:6px;background:rgba(255,255,255,.04)"><b>' + esc(c.author) + '</b>' + (c.op ? ' <span class="gold">운영진</span>' : '') + ' <span class="faint">' + when(c.created) + '</span> <button class="btn sm ghost" data-a="bdcdel" data-c="' + c.id + '">지우기</button><div style="white-space:pre-wrap">' + esc(c.body) + '</div></div>'; }).join('') +
        '<div class="form" style="margin-top:6px"><textarea id="bdr-' + p.id + '" rows="2" maxlength="500" placeholder="운영진 답변 (500자)" style="flex:1;min-width:220px"></textarea><button class="btn sm primary" data-a="bdreply" data-c="' + p.id + '">답변</button><button class="btn sm danger" data-a="bddel" data-c="' + p.id + '">글 지우기</button></div></details>';
    }).join('') : '<p class="faint small">문의가 없습니다.</p>';
  }
  function reports() {
    api('GET', '/api/admin/reports' + ($('#showres').checked ? '?resolved=1' : '')).then(function (j) {
      $('#reports').innerHTML = (j.reports || []).map(function (r) {
        return '<tr><td>' + when(r.t) + '</td><td>' + (r.ch === 'rp' ? 'RP' : '월드') + '</td><td>' + esc(r.author) + '</td><td class="msgtext">' + (r.deleted ? '<s class="faint">' + esc(r.text) + '</s>' : esc(r.text)) + '</td><td>' + esc(r.reporter) + '</td><td><div class="row" style="gap:4px">' +
          (r.deleted ? '' : '<button class="btn sm danger" data-a="del" data-c="' + r.msg_id + '" data-r="' + r.id + '">삭제</button>') +
          '<button class="btn sm" data-a="rmute" data-p="' + esc(r.author_id) + '" data-r="' + r.id + '" data-m="1440">1일 금지</button>' +
          (r.resolved ? '' : '<button class="btn sm ghost" data-a="resolve" data-r="' + r.id + '">처리 완료</button>') + '</div></td></tr>';
      }).join('') || '<tr><td colspan="6" class="faint">' + ($('#showres').checked ? '처리한 신고가 없습니다' : '새 신고가 없습니다') + '</td></tr>';
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
  function showPin(p) { $('#pinnow').textContent = p && p.text ? '고정 중: ' + p.text.slice(0, 60) + (p.text.length > 60 ? '…' : '') : '고정 공지 없음'; }
  function sys() { api('GET', '/api/admin/sys').then(function (j) { if (j.error) return; showPin(j.pin); var m = j.maint || {}, b = j.build || {}; $('#sysnow').textContent = '지금: ' + (m.on ? '점검 중' + (m.until ? ' (' + kst(m.until) + ' 종료 예정)' : '') : m.start ? '점검 예고 ' + kst(m.start) : '점검 없음') + ' · 화면 빌드 ' + (b.build || 0) + (b.minBuild ? ' · 최소 ' + b.minBuild : ''); }); }
  function tsOf(id) { var v = $(id).value; return v ? Math.floor(new Date(v + ':00+09:00').getTime() / 1000) : 0; }
  function maint(o, msg) { api('POST', '/api/admin/maint', o).then(function (j) { toast(j.error || msg); sys(); oplog(); }); }
  var A = {
    oplog: oplog,
    mtplan: function () { var st = tsOf('#mtstart'); if (!st || st < Date.now() / 1000) return toast('이후 시각 선택 필요'); maint({ start: st, until: tsOf('#mtuntil'), msg: $('#mtmsg').value }, '점검을 예고했습니다'); },
    mton: function () { if (!confirm('지금 점검을 시작합니다. 운영자가 아닌 학생은 모두 점검 화면으로 바뀝니다.')) return; maint({ on: true, until: tsOf('#mtuntil'), msg: $('#mtmsg').value }, '점검을 시작했습니다'); },
    mtoff: function () { maint({ on: false }, '점검을 끝냈습니다'); },
    build: function () { api('POST', '/api/admin/build', { build: +$('#bdbuild').value || 0, minBuild: +$('#bdmin').value || 0 }).then(function (j) { toast(j.error || '새 버전을 알렸습니다'); sys(); oplog(); }); },
    opon: function () { var n = $('#un').value.trim(); if (!n) return; api('POST', '/api/admin/ops', { name: n, rank: 'admin' }).then(function (j) { $('#umsg').textContent = j.error || n + ' 님을 학생회(운영진)로 지정했습니다 · 칭호 「학생회」를 낄 수 있습니다'; oplog(); }); },
    opchief: function () { var n = $('#un').value.trim(); if (!n) return; if (!confirm(n + ' 님을 학생회장으로 지정합니다.')) return; api('POST', '/api/admin/ops', { name: n, rank: 'chief' }).then(function (j) { $('#umsg').textContent = j.error || n + ' 님을 학생회장으로 지정했습니다 · 칭호 「학생회장」 · 「학생회」를 낄 수 있습니다'; oplog(); }); },
    // 이름 ↔ 아이디 확인: 이름 칸이 차 있으면 이름으로, 비어 있으면 아이디로 찾는다
    lookup: function () {
      var n = $('#un').value.trim(), lg = $('#ulogin').value.trim(); if (!n && !lg) { $('#umsg').textContent = '학생 이름이나 아이디 입력 필요'; return; }
      api('POST', '/api/admin/lookup', n ? { name: n } : { login: lg }).then(function (j) {
        if (j.error) { $('#umsg').textContent = j.error; return; }
        $('#umsg').textContent = '학생 이름 「' + j.name + '」 · 아이디 ' + (j.login ? '「' + j.login + '」' : '(아직 기록 없음 · 이 학생이 다음에 로그인하면 기록됩니다)') + (j.rank ? ' · ' + j.rank : '') + (j.banned ? ' · 이용 정지' : '');
      });
    },
    opoff: function () { var n = $('#un').value.trim(); if (!n) return; api('POST', '/api/admin/ops', { name: n, op: false }).then(function (j) { $('#umsg').textContent = j.error || n + ' 님의 운영자 권한을 뗐습니다'; oplog(); }); },
    slow: function () { api('POST', '/api/admin/slow', { sec: +$('#slowsec').value || 0 }).then(function (j) { toast(j.error || (j.sec ? '월드 슬로우 모드 ' + j.sec + '초' : '슬로우 모드를 껐습니다')); oplog(); }); },
    mforever: function () { $('#mexp').value = 'forever'; $('#mdatew').hidden = true; },
    mail: function () {
      var to = document.querySelector('input[name=mto]:checked').value, rw = {}, n = 0;
      document.querySelectorAll('[data-rw]').forEach(function (i) { var v = Math.floor(+i.value || 0); if (v > 0) { rw[i.dataset.rw] = v; n++; } });
      var o = { title: $('#mtitle').value.trim(), body: $('#mbody').value, rewards: rw, to: to === 'all' ? '*' : $('#mnames').value, newcomers: $('#mnew').checked }, ex = $('#mexp').value;
      if (!o.title) return toast('제목 입력 필요');
      if (ex === 'forever') o.forever = true; else if (ex === 'date') { if (!$('#mdate').value) return toast('만료 날짜 선택 필요'); o.expires = Math.floor(new Date($('#mdate').value + 'T23:59:59+09:00').getTime() / 1000); } else o.days = +ex;
      if (!confirm((to === 'all' ? '모든 학생' : '고른 학생') + '에게 「' + o.title + '」' + (/[가-힣]/.test((o.title || '').slice(-1)) && ((o.title.charCodeAt(o.title.length - 1) - 0xAC00) % 28) ? '을' : '를') + ' 보냅니다.\n보상: ' + rwText(rw) + '\n만료: ' + $('#mexp').selectedOptions[0].textContent)) return;
      api('POST', '/api/admin/mail', o).then(function (j) { if (j.error) { $('#mmsg').textContent = j.error; return; } $('#mmsg').textContent = '보냈습니다' + (j.missing && j.missing.length ? ' · 없는 이름: ' + j.missing.join(', ') : ''); $('#mtitle').value = ''; $('#mbody').value = ''; document.querySelectorAll('[data-rw]').forEach(function (i) { i.value = ''; }); mails(); });
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
    del: function (el) { api('POST', '/api/admin/chat/delete', { id: +el.dataset.c }).then(function () { return api('POST', '/api/admin/reports/resolve', { id: +el.dataset.r }); }).then(function () { toast('삭제했습니다'); reports(); }); },
    rmute: function (el) { api('POST', '/api/admin/mute', { pid: el.dataset.p, minutes: +el.dataset.m }).then(function () { return api('POST', '/api/admin/reports/resolve', { id: +el.dataset.r }); }).then(function () { toast('하루 동안 채팅 금지'); reports(); }); },
    bdload: function () { bdload(); },
    bdreply: function (el) { var t = $('#bdr-' + el.dataset.c); if (!t || !t.value.trim()) return; api('POST', '/api/admin/board', { op: 'reply', id: +el.dataset.c, text: t.value.trim() }).then(function (j) { if (j.error) return toast(j.error); toast('답변했습니다 · 학생에게 우편 알림'); bdshow(j); }); },
    bddel: function (el) { if (!confirm('이 글을 지울까요?')) return; api('POST', '/api/admin/board', { op: 'del', id: +el.dataset.c }).then(function (j) { if (j.error) return toast(j.error); bdshow(j); }); },
    bdcdel: function (el) { api('POST', '/api/admin/board', { op: 'cdel', cid: +el.dataset.c }).then(function (j) { if (j.error) return toast(j.error); bdshow(j); }); },
    resolve: function (el) { api('POST', '/api/admin/reports/resolve', { id: +el.dataset.r }).then(reports); },
    unpin: function () { api('POST', '/api/admin/notice', { unpin: true }).then(function (j) { showPin(null); toast(j.error || '고정을 풀었습니다'); }); },
    notice: function () {
      var t = $('#nt').value.trim(); if (!t) return;
      api('POST', '/api/admin/notice', { text: t, pin: $('#ntpin').checked }).then(function (j) { if (j && j.pin !== undefined) showPin(j.pin); $('#ntpin').checked = false; return $('#ntchat').checked ? api('POST', '/api/admin/chat/system', { ch: 'world', text: '[공지] ' + t }) : null; }).then(function () { $('#nt').value = ''; toast('공지를 올렸습니다'); });
    },
    mute: function () { api('POST', '/api/admin/mute', { name: $('#un').value.trim(), minutes: +$('#um').value }).then(function (j) { $('#umsg').textContent = j.error || '적용했습니다'; }); },
    grant: function () { api('POST', '/api/admin/grant', { name: $('#un').value.trim(), shard: +$('#ug').value, reason: $('#ur').value }).then(function (j) { $('#umsg').textContent = j.error || '지급했습니다 (보유 ' + j.shard + ')'; }); },
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
  document.addEventListener('click', function (e) { var el = e.target.closest('[data-a]'); if (el && A[el.dataset.a]) { e.preventDefault(); A[el.dataset.a](el); } });
  $('#go').addEventListener('click', function () { tok = $('#tok').value.trim(); enter(); });
  $('#tok').addEventListener('keydown', function (e) { if (e.key === 'Enter') { tok = $('#tok').value.trim(); enter(); } });
  $('#showres').addEventListener('change', reports);
  if (tok) enter();
  setInterval(function () { if (!$('#main').hidden && !document.hidden) { api('GET', '/api/admin/stats').then(function (j) { if (j._s === 200) stats(j); }); reports(); } }, 30000);
})();
