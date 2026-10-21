/* 텃밭 · 낚시 재미 검증 시뮬레이션 (2차 베타)
   node tools/sim-fg.js [일수=30] [유형=all] [시드=1]
   실제 규칙(shared/rules.js)과 실제 날씨 · 하늘 이벤트로, 봇이 접속 패턴대로 텃밭과 낚시를 한다.
   본다: 새 발견이 얼마나 자주 나오는가(지루한 구간), 도감 진행, 희귀 · 전설, 숙련도, 아르크(진도 단위 U) · 별조각 수입 */
var R = require('../shared/rules.js'), D = R.D;
var DAYS = +(process.argv[2] || 30), ONLY = process.argv[3] || 'all', SEED = +(process.argv[4] || 1);
var TYPES = {
  casual: { name: '캐주얼 (하루 2번)', visits: [9, 22], hand: 0.8 },
  steady: { name: '성실 (하루 5번)', visits: [8, 12.5, 18, 21, 23.5], hand: 0.85 },
  hard: { name: '열심 (깨어 있는 동안 1시간마다)', visits: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24], hand: 0.9 }
};
var EPOCH = 1792000000 - (1792000000 + R.K.TZ) % 86400;   // 한국 시간 0시

function run(key) {
  var ty = TYPES[key], t = EPOCH + 3 * 86400, W = { epoch: EPOCH - 30 * 86400, fg: 1, ms: 0 };
  var P = R.newPlayer('sim', '봇', 'lanterna', t, 777 + SEED * 13); R.fixState(P);
  P.maxStage = 40; P.st.maxStageAll = 40; P.grade = 4;
  var seedR = 99991 * SEED; function rr() { seedR = (seedR * 16807) % 2147483647; return seedR / 2147483647; }
  var dayOrd = {}, U = R.lzUnit(P), stat = { gold: 0, shard: 0, catches: 0, hand: 0, perfect: 0, miss: 0, rare: 0, leg: 0, legNames: [], rareNames: [], mut: 0, cross: 0, fairy: 0, harvest: 0, visits: 0, orders: 0 };
  var daily = [];
  function act(type, a) { W.now = t; try { return R.act(P, W, t, type, a || {}); } catch (e) { if (e.game) return null; throw e; } }
  function known(id) { return P.gdn && P.gdn.cdx[id]; }
  function plant() {
    var g = R.gdOf(P), free = []; for (var k = 0; k < 9; k++) { var i = R.LZ.PLOT_ORDER[k]; if (R.gdPlotOpen(P, i) && !g.plots[i]) free.push(i); }
    if (!free.length) return;
    // 1) 아직 못 얻은 자식이 나오는 교배 짝을 이웃 칸에
    D.GD_CROSS.forEach(function (c) {
      if (known(c[2]) || g.seeds[c[2]] > 0 || !(g.seeds[c[0]] > 0) || !(g.seeds[c[1]] > 0)) return;
      for (var x = 0; x < free.length; x++) for (var y = 0; y < free.length; y++) {
        if (x === y || R.gdNeighbors(free[x]).indexOf(free[y]) < 0) continue;
        var a = free[x], b = free[y]; act('gdPlant', { i: a, s: c[0] }); act('gdPlant', { i: b, s: c[1] }); free = free.filter(function (q) { return q !== a && q !== b; }); return;
      }
    });
    // 2) 변이를 노릴 수 있는 것 · 아직 도감에 없는 것 · 높은 등급 순
    while (free.length) {
      var opts = Object.keys(g.seeds).filter(function (s) { return g.seeds[s] > 0; }); if (!opts.length) break;
      opts.sort(function (a, b) {
        function sc(s) { var x = R.GD[s], end = t + x.g, m = R.gdMutChance(W, { s: s, end: end }), fy = D.FAIRIES.filter(function (f) { return f.likes === s && !g.fy[f.id]; }).length;
          var same = g.plots.filter(function (pl) { return pl && pl.s === s; }).length;   // 한 종류로 밭을 채우지 않는다
          var od = R.lzOrders(P, t), co = od.o[1], want = !od.done.crop && co.id === s && (g.crops[s] || 0) < co.n ? 60 : 0;
          return want + (m && !known(m.to) ? 100 : 0) + (known(s) ? 0 : 50) + fy * 40 + x.t * 5 + (g.seeds[s] > 4 ? 3 : 0) - same * 30; }
        return sc(b) - sc(a);
      });
      act('gdPlant', { i: free.shift(), s: opts[0] });
    }
  }
  function bestBait() { var f = P.fsh, order = ['abyss', 'gold', 'star', 'moon', 'petal', 'berry', 'herb']; for (var i = 0; i < order.length; i++) if (f && f.bt[order[i]] > 0) return order[i]; return ''; }
  function bestSpot() { var s = 'pond'; D.FISH_SPOTS.forEach(function (x) { if (R.spotOpen(P, x.id)) s = x.id; }); return s; }
  function spotFor() {   // 오늘의 주문 낚시터 → 아직 못 낚은 것이 많은 낚시터 (열린 곳 중)
    var od = R.lzOrders(P, t), fo = od.o[0], f = R.fshOf(P, t); if (!od.done.fish && (f.bag[fo.id] || 0) < fo.n) return R.FISH[fo.id].at;
    var best = 'pond', bs = -1;
    D.FISH_SPOTS.forEach(function (x, i) { if (!R.spotOpen(P, x.id)) return; var miss = D.FISH.filter(function (q) { return q.at === x.id && !f.cdx[q.id]; }).length + R.rareAt(W, x.id, t).filter(function (r) { return !f.rare[r.id]; }).length * 12; var sc = miss * 10 + i; if (sc > bs) { bs = sc; best = x.id; } });
    return best;
  }
  function onGot(g) {
    if (!g) return; stat.catches++;
    if (g.k === 'rare') { if (g.leg) { stat.leg++; stat.legNames.push(R.RARE[g.id].name + '@' + ((t - EPOCH) / 86400 - 3).toFixed(1)); } else { stat.rare++; stat.rareNames.push(g.id); } }
  }
  function visit(nextGap) {
    stat.visits++;
    var g0 = P.res.gold, s0 = P.res.shard;
    // 텃밭
    var h = act('gdHarvest', {}); if (h) h.list.forEach(function (x) { stat.harvest++; if (x.mut) stat.mut++; stat.cross += x.cross.length; if (x.fairy) stat.fairy++; });
    // 미끼: 특별 미끼는 모두, 꽃잎 · 약초는 넉넉히
    ['moon', 'star', 'gold', 'abyss'].forEach(function (b) { var n = R.baitMax(P, b); if (n) act('lzBait', { id: b, n: n }); });
    ['petal', 'herb', 'berry', 'root'].forEach(function (b) { var n = Math.min(R.baitMax(P, b), 3); if (n && (P.fsh ? P.fsh.bt[b] || 0 : 0) < 10) act('lzBait', { id: b, n: n }); });
    // 남는 흔한 작물은 판다 (씨앗은 남김)
    Object.keys(P.gdn ? P.gdn.crops : {}).forEach(function (c) { if (R.GD[c].t === 0 && P.gdn.crops[c] > 6) act('lzSell', { k: 'crop', id: c, n: P.gdn.crops[c] - 6 }); });
    if (R.compostMax(P) > 0) act('lzCompost', { n: R.compostMax(P) });
    plant(); act('gdWater');
    var g = P.gdn; if (g && g.fert > 0) g.plots.forEach(function (pl, i) { if (pl && !pl.fert && pl.end > t && R.GD[pl.s].t >= 1 && g.fert > 0) act('gdFert', { i: i }); });
    // 하루 한 번 꾸러미
    if (P._day !== R.dayKST(t)) { P._day = R.dayKST(t); P.res.gold += 8 * U; act('gdBuy', { id: 'wild' }); P.res.gold -= 0; if (R.dayKST(t) % 2 === 0) { P.res.shard += 4; act('gdBuy', { id: 'green' }); } }
    // 낚시: 찌 걷기 → 손낚시 기운 모두 → 다음 접속까지 찌
    var cl = act('fshClaim'); if (cl) cl.list.forEach(onGot);
    var spot = spotFor(), c = act('fshCast', { spot: spot, bait: bestBait() });
    while (c) {
      stat.hand++;
      var ok = rr() < ty.hand, rt = ok ? (rr() < 0.42 ? c.win * 0.3 : c.win * 0.7) : -1;
      W.ms = (W.ms || t * 1000) + c.d + Math.max(0, rt) + 120;
      var r = act('fshReel', { rt: rt, again: 1 }); if (!r) break;
      if (r.res === 'perfect') stat.perfect++; if (r.res === 'early' || r.res === 'late') stat.miss++;
      onGot(r.got); c = r.next;
    }
    var dk = nextGap >= 43200 ? '12h' : nextGap >= 28800 ? '8h' : nextGap >= 14400 ? '4h' : nextGap >= 7200 ? '2h' : '1h';
    var bb = bestBait(); act('fshSet', { spot: bestSpot(), d: dk, bait: bb && P.fsh.bt[bb] >= R.fshIdleBait(dk) ? bb : '' });
    // 오늘의 주문 납품 (가진 것이 있으면)
    var od0 = R.lzOrders(P, t); if (act('lzOrder', { k: 'fish' })) { stat.orders++; dayOrd[R.dayKST(t)] = 1; } if (act('lzOrder', { k: 'crop' })) { stat.orders++; dayOrd[R.dayKST(t)] = 1; }
    // 물고기는 진귀 아래 모두 판다
    var keep = R.lzOrders(P, t); if (P.fsh && Object.keys(P.fsh.bag).length) { var kf = keep.o[0], hold = !keep.done.fish ? P.fsh.bag[kf.id] || 0 : 0; if (hold) P.fsh.bag[kf.id] = 0; act('lzSell', { k: 'fish', tier: 2 }); if (hold) P.fsh.bag[kf.id] = hold; }   // 주문 물고기는 남겨 둔다
    stat.gold += P.res.gold - g0; stat.shard += P.res.shard - s0;
  }
  var times = [];
  for (var d = 0; d < DAYS; d++) ty.visits.forEach(function (h) { times.push(EPOCH + 3 * 86400 + d * 86400 + Math.round(h * 3600) + Math.round((rr() - 0.5) * 1200)); });
  times.sort(function (a, b) { return a - b; });
  var lastDisc = 0, prevDay = -1, gaps = [], dayDisc = {};
  times.forEach(function (tt, i) {
    t = tt; W.ms = tt * 1000;
    var before = disc(P);
    visit((times[i + 1] || tt + 86400) - tt);
    var after = disc(P); if (after > before) { if (lastDisc) gaps.push(tt - lastDisc); lastDisc = tt; }
    var dd = Math.floor((tt - EPOCH) / 86400) - 3; dayDisc[dd] = (dayDisc[dd] || 0) + (after - before);
    var day = Math.floor((tt - EPOCH) / 86400) - 3;
    if (day !== prevDay && [0, 1, 2, 4, 6, 9, 13, 20, 29, 44, 59].indexOf(day) >= 0) { prevDay = day; }
    daily[day] = { d: day + 1, disc: disc(P), cdx: cdx(P), flv: P.fsh ? P.fsh.lv : 1, glv: P.gdn ? P.gdn.lv : 1, rare: stat.rare, leg: stat.leg, gold: stat.gold, shard: stat.shard, catches: stat.catches };
  });
  var dry = 0, idle = 0, d0 = R.dayKST(EPOCH + 3 * 86400 + 3600); for (var q = 7; q < DAYS; q++) { if (!dayDisc[q]) dry++; if (!dayDisc[q] && !dayOrd[d0 + q]) idle++; }
  return { key: key, ty: ty, P: P, stat: stat, daily: daily, gaps: gaps, U: U, dry: dry, idle: idle };
}
function disc(P) { var n = 0; if (P.gdn) n += Object.keys(P.gdn.cdx).length + Object.keys(P.gdn.fy).length; if (P.fsh) n += Object.keys(P.fsh.cdx).length + Object.keys(P.fsh.rare).length; return n; }
function cdx(P) { return { plant: P.gdn ? Object.keys(P.gdn.cdx).length : 0, fairy: P.gdn ? Object.keys(P.gdn.fy).length : 0, fish: P.fsh ? Object.keys(P.fsh.cdx).length : 0, rare: P.fsh ? Object.keys(P.fsh.rare).length : 0 }; }
function pct(a, b) { return Math.round(a / b * 100) + '%'; }
var TOT = { plant: D.GARDEN.length, fairy: D.FAIRIES.length, fish: D.FISH.length, rare: D.RARE.length };
Object.keys(TYPES).filter(function (k) { return ONLY === 'all' || ONLY === k; }).forEach(function (k) {
  var o = run(k), s = o.stat;
  console.log('\n## ' + o.ty.name + ' · ' + DAYS + '일');
  console.log('| 날 | 발견(누적) | 식물 | 요정 | 물고기 | 희귀 | 낚시 Lv | 원예 Lv | 희귀/전설 낚음 | 아르크(U) | 별조각 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60].forEach(function (d) {
    var x = o.daily[d - 1]; if (!x) return;
    console.log('| ' + d + ' | ' + x.disc + ' | ' + x.cdx.plant + '/' + TOT.plant + ' | ' + x.cdx.fairy + '/' + TOT.fairy + ' | ' + x.cdx.fish + '/' + TOT.fish + ' | ' + x.cdx.rare + '/' + TOT.rare + ' | ' + x.flv + ' | ' + x.glv + ' | ' + x.rare + '/' + x.leg + ' | ' + Math.round(x.gold / o.U) + ' | ' + x.shard + ' |');
  });
  var g = o.gaps.slice().sort(function (a, b) { return a - b; }), med = g[Math.floor(g.length / 2)] || 0, p90 = g[Math.floor(g.length * 0.9)] || 0, mx = g[g.length - 1] || 0;
  console.log('- 접속 ' + s.visits + '번 · 낚음 ' + s.catches + ' (손낚시 ' + s.hand + ', 완벽 ' + pct(s.perfect, s.hand) + ', 놓침 ' + pct(s.miss, s.hand) + ') · 수확 ' + s.harvest + ' (변이 ' + s.mut + ', 교배 씨앗 ' + s.cross + ', 요정 ' + s.fairy + ') · 주문 납품 ' + s.orders + '/' + DAYS * 2);
  console.log('- 8일째부터 새 발견이 없던 날: ' + o.dry + '일 · 그중 주문도 못 한 날(할 일이 없던 날): ' + o.idle + '일 / ' + Math.max(0, DAYS - 7) + '일');
  console.log('- 새 발견 사이 간격: 중간 ' + (med / 3600).toFixed(1) + '시간 · 90% ' + (p90 / 3600).toFixed(1) + '시간 · 최대 ' + (mx / 3600).toFixed(1) + '시간');
  console.log('- 하루 평균: 아르크 ' + Math.round(s.gold / o.U / DAYS) + 'U (일일 목표 보상의 ' + (s.gold / DAYS / R.dailyReward(o.P).gold).toFixed(2) + '배) · 별조각 ' + (s.shard / DAYS).toFixed(1));
  console.log('- 전설: ' + (s.legNames.join(', ') || '없음'));
  var miss = { plant: D.GARDEN.filter(function (x) { return !o.P.gdn.cdx[x.id]; }).map(function (x) { return x.name; }), rare: D.RARE.filter(function (x) { return !o.P.fsh.rare[x.id]; }).map(function (x) { return x.name; }) };
  console.log('- 못 얻은 식물: ' + (miss.plant.join(', ') || '없음'));
  console.log('- 못 낚은 희귀 생물: ' + (miss.rare.join(', ') || '없음'));
  var b = R.lzBonus(o.P) || {}; console.log('- 도감 보너스: ' + Object.keys(b).map(function (k) { return (D.BONUS_NAMES[k] || k) + ' +' + (b[k] * 100).toFixed(1) + '%'; }).join(', '));
});
