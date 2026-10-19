/* 첫 화면이 그려지기 전에 저장한 테마를 먼저 입힌다 (app.js가 늦게 읽혀 기본 테마로 한 번 깜빡이지 않게). app.js의 applyTheme와 같은 규칙 */
(function () {
  try {
    var p = JSON.parse(localStorage.getItem('arc_pref') || '{}') || {}, id = p.theme || 'auto', de = document.documentElement;
    if (!p.themeV && id === 'night') id = 'auto';
    if (id === 'auto') id = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'day' : 'night';
    var dark = { night: 1, dusk: 1 }, light = { day: 1, mist: 1 }; if (!dark[id] && !light[id]) id = 'night';
    de.dataset.paper = p.paper === false ? 'off' : 'on'; de.dataset.skin = id; de.dataset.skintone = dark[id] ? 'dark' : 'light'; de.style.colorScheme = dark[id] ? 'dark' : 'light';
  } catch (e) { }
})();
