/* 첫 화면이 그려지기 전에 저장한 테마를 먼저 입힌다 (app.js가 늦게 읽혀 기본 테마로 한 번 깜빡이지 않게). app.js의 applyTheme와 같은 규칙 */
(function () {
  try {
    var p = JSON.parse(localStorage.getItem('arc_pref') || '{}') || {}, id = p.theme || 'auto', de = document.documentElement;
    if (!p.themeV && id === 'night') id = 'auto';
    if (id === 'auto') id = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'day' : 'night';
    var dark = { night: 1, dusk: 1 }, light = { day: 1, mist: 1 }; if (!dark[id] && !light[id]) id = 'night';
    de.dataset.paper = p.paper === false ? 'off' : 'on'; de.dataset.skin = id; de.dataset.skintone = dark[id] ? 'dark' : 'light'; de.style.colorScheme = dark[id] ? 'dark' : 'only light';
    // 밝은 테마는 'only light': 휴대폰 다크 모드 · 앱 안 브라우저가 화면을 강제로 어둡게 바꾸지 않게 (어두운 잉크 · 배경이 겹쳐 글씨가 묻히던 문제)
    var mc = document.querySelector('meta[name=color-scheme]'); if (mc) mc.content = dark[id] ? 'dark' : 'only light';
  } catch (e) { }
})();
