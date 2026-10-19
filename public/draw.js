/* 절차적 그림: 몬스터, 견습 마법사, 사역마, 문장, 하늘 */
var Art = (function () {
  var A = {};
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { var s = seed || 1; return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; }; }
  A.hash = hash;
  function shade(hex, k) {
    var c = parseInt(hex.slice(1), 16), r = c >> 16 & 255, g = c >> 8 & 255, b = c & 255;
    if (k > 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; } else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }
  A.shade = shade;

  function eyes(ctx, x, y, gap, r, t, look, glow) {
    var blink = (Math.sin(t * 0.7 + x) > 0.985) ? 0.15 : 1;
    [-1, 1].forEach(function (s) {
      ctx.save(); ctx.translate(x + s * gap, y); ctx.scale(1, blink);
      ctx.fillStyle = glow || '#f6f0dc'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
      if (!glow) { ctx.fillStyle = '#141020'; ctx.beginPath(); ctx.arc(-r * 0.25 * (look || 1), r * 0.1, r * 0.55, 0, 7); ctx.fill(); }
      ctx.restore();
    });
  }

  // 몬스터: (ctx, def{arch,c1,c2,id,boss}, cx, cy, size, t, hit[0..1])
  A.monster = function (ctx, m, cx, cy, S, t, hit) {
    var R = rng(hash(m.id || 'x'));
    var c1 = m.c1, c2 = m.c2;
    ctx.save();
    ctx.translate(cx, cy);
    if (m.hue) ctx.filter = 'hue-rotate(' + m.hue + 'deg)';
    var bob = Math.sin(t * 2.2) * S * 0.03;
    ctx.translate(hit ? (Math.random() - 0.5) * S * 0.06 * hit : 0, bob);
    if (m.boss) {
      var aura = ctx.createRadialGradient(0, 0, S * 0.2, 0, 0, S * 0.8);
      aura.addColorStop(0, 'rgba(255,220,150,0.18)'); aura.addColorStop(1, 'rgba(255,220,150,0)');
      ctx.fillStyle = aura; ctx.beginPath(); ctx.arc(0, 0, S * 0.8, 0, 7); ctx.fill();
    }
    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(0, S * 0.46 - bob, S * 0.34, S * 0.06, 0, 0, 7); ctx.fill();
    var g = ctx.createLinearGradient(0, -S * 0.5, 0, S * 0.5); g.addColorStop(0, shade(c1, 0.15)); g.addColorStop(1, c2);
    ctx.fillStyle = g; ctx.strokeStyle = shade(c2, -0.4); ctx.lineWidth = Math.max(1.5, S * 0.018);
    var a = m.arch;
    if (a === 'blob') {
      ctx.beginPath();
      for (var i = 0; i <= 40; i++) {
        var th = i / 40 * Math.PI * 2, w = 1 + Math.sin(th * 3 + t * 3) * 0.04 + Math.sin(th * 5 - t * 2) * 0.03;
        var rx = S * 0.36 * w, ry = S * 0.3 * w;
        var x = Math.cos(th) * rx, y = Math.sin(th) * ry * (th > Math.PI ? 1.15 : 0.95) + S * 0.1;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.ellipse(-S * 0.13, -S * 0.08, S * 0.08, S * 0.04, -0.5, 0, 7); ctx.fill();
      eyes(ctx, 0, S * 0.02, S * 0.1, S * 0.055, t);
      ctx.strokeStyle = '#141020'; ctx.lineWidth = S * 0.015; ctx.beginPath(); ctx.arc(0, S * 0.12, S * 0.05, 0.2, Math.PI - 0.2); ctx.stroke();
    } else if (a === 'wisp') {
      for (var k = 0; k < 14; k++) {
        var ph = (t * 0.8 + k / 14) % 1;
        ctx.globalAlpha = (1 - ph) * 0.5; ctx.fillStyle = c1;
        ctx.beginPath(); ctx.arc(Math.sin(k * 2.3 + t) * S * 0.12, S * 0.1 + ph * S * 0.3, S * 0.05 * (1 - ph), 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
      var rg = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.36);
      rg.addColorStop(0, '#fffbe8'); rg.addColorStop(0.35, c1); rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.moveTo(0, -S * 0.42 + Math.sin(t * 4) * S * 0.03);
      ctx.bezierCurveTo(S * 0.32, -S * 0.1, S * 0.26, S * 0.26, 0, S * 0.26);
      ctx.bezierCurveTo(-S * 0.26, S * 0.26, -S * 0.32, -S * 0.1, 0, -S * 0.42 + Math.sin(t * 4) * S * 0.03);
      ctx.fill();
      eyes(ctx, 0, S * 0.02, S * 0.08, S * 0.035, t, 0, shade(c2, -0.5));
    } else if (a === 'beast') {
      ctx.beginPath(); ctx.ellipse(S * 0.04, S * 0.12, S * 0.3, S * 0.18, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.lineWidth = S * 0.05; ctx.strokeStyle = c2; ctx.lineCap = 'round';
      [-0.2, -0.08, 0.12, 0.24].forEach(function (lx, i) { ctx.beginPath(); ctx.moveTo(S * lx, S * 0.22); ctx.lineTo(S * lx + Math.sin(t * 6 + i) * S * 0.02, S * 0.42); ctx.stroke(); });
      ctx.lineWidth = S * 0.03; ctx.beginPath(); ctx.moveTo(S * 0.32, S * 0.08); ctx.quadraticCurveTo(S * 0.5, -S * 0.05 + Math.sin(t * 3) * S * 0.05, S * 0.44, -S * 0.2); ctx.stroke();
      ctx.fillStyle = g; ctx.strokeStyle = shade(c2, -0.4); ctx.lineWidth = Math.max(1.5, S * 0.018);
      ctx.beginPath(); ctx.arc(-S * 0.24, -S * 0.04, S * 0.17, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-S * 0.36, -S * 0.12); ctx.lineTo(-S * 0.33, -S * 0.32); ctx.lineTo(-S * 0.24, -S * 0.18); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-S * 0.18, -S * 0.17); ctx.lineTo(-S * 0.12, -S * 0.34); ctx.lineTo(-S * 0.08, -S * 0.12); ctx.fill(); ctx.stroke();
      if (R() > 0.4) { ctx.fillStyle = shade(c1, -0.2); for (var sp = 0; sp < 5; sp++) { ctx.beginPath(); var bx = -S * 0.12 + sp * S * 0.08; ctx.moveTo(bx, -S * 0.03); ctx.lineTo(bx + S * 0.03, -S * 0.14); ctx.lineTo(bx + S * 0.06, -S * 0.02); ctx.fill(); } }
      eyes(ctx, -S * 0.27, -S * 0.06, S * 0.06, S * 0.032, t);
    } else if (a === 'golem') {
      ctx.save();
      var sw = Math.sin(t * 1.5) * 0.04;
      ctx.rotate(sw);
      rr(ctx, -S * 0.26, -S * 0.12, S * 0.52, S * 0.48, S * 0.06); ctx.fill(); ctx.stroke();
      rr(ctx, -S * 0.17, -S * 0.42, S * 0.34, S * 0.28, S * 0.05); ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade(c2, -0.2);
      rr(ctx, -S * 0.42, -S * 0.08, S * 0.14, S * 0.34, S * 0.05); ctx.fill(); ctx.stroke();
      rr(ctx, S * 0.28, -S * 0.08, S * 0.14, S * 0.34, S * 0.05); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.moveTo(-S * 0.1, 0); ctx.lineTo(S * 0.02, S * 0.12); ctx.lineTo(-S * 0.04, S * 0.26); ctx.stroke();
      var gl = 0.6 + Math.sin(t * 3) * 0.3;
      ctx.fillStyle = 'rgba(255,230,140,' + gl + ')';
      ctx.fillRect(-S * 0.11, -S * 0.3, S * 0.07, S * 0.035); ctx.fillRect(S * 0.04, -S * 0.3, S * 0.07, S * 0.035);
      ctx.beginPath(); ctx.arc(0, S * 0.1, S * 0.05, 0, 7); ctx.fill();
      ctx.restore();
    } else if (a === 'eye') {
      ctx.strokeStyle = c2; ctx.lineCap = 'round';
      for (var tn = 0; tn < 6; tn++) {
        ctx.lineWidth = S * 0.045 * (1 - tn * 0.05);
        ctx.beginPath(); var tx = (tn - 2.5) * S * 0.09; ctx.moveTo(tx, S * 0.1);
        ctx.bezierCurveTo(tx + Math.sin(t * 2 + tn) * S * 0.1, S * 0.25, tx - Math.sin(t * 2.4 + tn) * S * 0.1, S * 0.35, tx + Math.sin(t + tn) * S * 0.05, S * 0.45); ctx.stroke();
      }
      ctx.fillStyle = g; ctx.strokeStyle = shade(c2, -0.4); ctx.lineWidth = Math.max(1.5, S * 0.018);
      ctx.beginPath(); ctx.arc(0, -S * 0.04, S * 0.3, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f4efe0'; ctx.beginPath(); ctx.ellipse(0, -S * 0.04, S * 0.22, S * 0.15 * (Math.sin(t * 0.6) > 0.97 ? 0.1 : 1), 0, 0, 7); ctx.fill();
      var lx2 = Math.sin(t * 0.9) * S * 0.07;
      ctx.fillStyle = shade(c1, -0.1); ctx.beginPath(); ctx.arc(lx2, -S * 0.04, S * 0.1, 0, 7); ctx.fill();
      ctx.fillStyle = '#0c0814'; ctx.beginPath(); ctx.ellipse(lx2, -S * 0.04, S * 0.03, S * 0.08, 0, 0, 7); ctx.fill();
    } else if (a === 'book') {
      var open = 0.35 + Math.abs(Math.sin(t * 2.5)) * 0.5;
      ctx.save(); ctx.translate(0, S * 0.05);
      ctx.fillStyle = c2; ctx.beginPath(); ctx.moveTo(0, S * 0.25); ctx.lineTo(-S * 0.4, S * 0.25 - S * 0.3 * open); ctx.lineTo(-S * 0.4, -S * 0.25 - S * 0.3 * open); ctx.lineTo(0, -S * 0.25); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, S * 0.25); ctx.lineTo(S * 0.4, S * 0.25 - S * 0.3 * open); ctx.lineTo(S * 0.4, -S * 0.25 - S * 0.3 * open); ctx.lineTo(0, -S * 0.25); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#efe6cc';
      ctx.beginPath(); ctx.moveTo(0, S * 0.21); ctx.lineTo(-S * 0.35, S * 0.21 - S * 0.26 * open); ctx.lineTo(-S * 0.35, -S * 0.21 - S * 0.26 * open); ctx.lineTo(0, -S * 0.21); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, S * 0.21); ctx.lineTo(S * 0.35, S * 0.21 - S * 0.26 * open); ctx.lineTo(S * 0.35, -S * 0.21 - S * 0.26 * open); ctx.lineTo(0, -S * 0.21); ctx.fill();
      ctx.strokeStyle = 'rgba(40,20,30,.35)'; ctx.lineWidth = 1;
      for (var ln = 0; ln < 5; ln++) { var yy = -S * 0.13 + ln * S * 0.06; ctx.beginPath(); ctx.moveTo(-S * 0.3, yy - S * 0.2 * open); ctx.lineTo(-S * 0.05, yy); ctx.stroke(); ctx.beginPath(); ctx.moveTo(S * 0.05, yy); ctx.lineTo(S * 0.3, yy - S * 0.2 * open); ctx.stroke(); }
      ctx.fillStyle = '#fff'; for (var tt = 0; tt < 6; tt++) { ctx.beginPath(); var tx2 = -S * 0.15 + tt * S * 0.06; ctx.moveTo(tx2, S * 0.24); ctx.lineTo(tx2 + S * 0.03, S * 0.16); ctx.lineTo(tx2 + S * 0.06, S * 0.24); ctx.fill(); }
      eyes(ctx, 0, -S * 0.28 - S * 0.1 * open, S * 0.08, S * 0.035, t, 0, '#ff5a6a');
      ctx.restore();
    } else { // construct
      ctx.save(); ctx.translate(0, -S * 0.02);
      ctx.rotate(t * 0.8);
      ctx.beginPath();
      var teeth = 10;
      for (var j = 0; j < teeth * 2; j++) { var ang = j / (teeth * 2) * Math.PI * 2, rad = j % 2 ? S * 0.28 : S * 0.34; ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = shade(c2, -0.3); ctx.beginPath(); ctx.arc(0, -S * 0.02, S * 0.16, 0, 7); ctx.fill();
      ctx.strokeStyle = shade(c1, 0.2); ctx.lineWidth = S * 0.03; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-S * 0.3, S * 0.05); ctx.lineTo(-S * 0.46, S * 0.18 + Math.sin(t * 5) * S * 0.04); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(S * 0.3, S * 0.05); ctx.lineTo(S * 0.46, S * 0.18 - Math.sin(t * 5) * S * 0.04); ctx.stroke();
      eyes(ctx, 0, -S * 0.04, S * 0.065, S * 0.04, t, 0, '#9ff3ff');
    }
    if (m.boss) {
      ctx.fillStyle = '#f0cf8a'; ctx.strokeStyle = '#6a5420'; ctx.lineWidth = 1.5;
      ctx.beginPath(); var cy0 = -S * 0.5; ctx.moveTo(-S * 0.12, cy0 + S * 0.08); ctx.lineTo(-S * 0.12, cy0 - S * 0.02); ctx.lineTo(-S * 0.06, cy0 + S * 0.03); ctx.lineTo(0, cy0 - S * 0.05); ctx.lineTo(S * 0.06, cy0 + S * 0.03); ctx.lineTo(S * 0.12, cy0 - S * 0.02); ctx.lineTo(S * 0.12, cy0 + S * 0.08); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    if (hit) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = 'rgba(255,255,255,' + 0.55 * hit + ')'; ctx.fillRect(-S, -S, S * 2, S * 2); }
    ctx.restore();
  };
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  A.rr = rr;

  // 견습 마법사
  A.wizard = function (ctx, cx, cy, S, t, house, cast, hurt) {
    ctx.save(); ctx.translate(cx, cy);
    var bob = Math.sin(t * 2) * S * 0.015;
    if (hurt) ctx.translate((Math.random() - 0.5) * S * 0.05 * hurt, 0);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(0, S * 0.46, S * 0.26, S * 0.05, 0, 0, 7); ctx.fill();
    ctx.translate(0, bob);
    var robe = ctx.createLinearGradient(0, -S * 0.2, 0, S * 0.45); robe.addColorStop(0, '#2c3366'); robe.addColorStop(1, '#161a38');
    ctx.fillStyle = robe; ctx.strokeStyle = '#0b0d1c'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-S * 0.08, -S * 0.12); ctx.quadraticCurveTo(-S * 0.26, S * 0.2, -S * 0.25, S * 0.44); ctx.lineTo(S * 0.25, S * 0.44); ctx.quadraticCurveTo(S * 0.26, S * 0.2, S * 0.08, -S * 0.12); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = house; ctx.lineWidth = S * 0.02; ctx.beginPath(); ctx.moveTo(-S * 0.24, S * 0.4); ctx.lineTo(S * 0.24, S * 0.4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -S * 0.08); ctx.lineTo(0, S * 0.4); ctx.stroke();
    ctx.fillStyle = '#e8cfb0'; ctx.beginPath(); ctx.arc(0, -S * 0.18, S * 0.085, 0, 7); ctx.fill();
    ctx.fillStyle = '#1c1430'; ctx.beginPath(); ctx.arc(S * 0.03, -S * 0.19, S * 0.012, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(-S * 0.03, -S * 0.19, S * 0.012, 0, 7); ctx.fill();
    // 모자
    ctx.fillStyle = '#232a58'; ctx.strokeStyle = '#0b0d1c'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, -S * 0.25, S * 0.17, S * 0.035, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-S * 0.1, -S * 0.26); ctx.quadraticCurveTo(-S * 0.02, -S * 0.42, S * 0.08 + Math.sin(t * 1.3) * S * 0.02, -S * 0.56); ctx.quadraticCurveTo(S * 0.04, -S * 0.4, S * 0.1, -S * 0.26); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = house; ctx.fillRect(-S * 0.1, -S * 0.29, S * 0.2, S * 0.025);
    // 지팡이
    var sa = cast ? -0.5 * cast : 0;
    ctx.save(); ctx.translate(S * 0.2, S * 0.05); ctx.rotate(0.15 + sa);
    ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = S * 0.025; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, S * 0.36); ctx.lineTo(0, -S * 0.36); ctx.stroke();
    var orb = ctx.createRadialGradient(0, -S * 0.4, 0, 0, -S * 0.4, S * (0.08 + (cast || 0) * 0.08));
    orb.addColorStop(0, '#fffbe8'); orb.addColorStop(0.4, house); orb.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = orb; ctx.beginPath(); ctx.arc(0, -S * 0.4, S * (0.08 + (cast || 0) * 0.08), 0, 7); ctx.fill();
    ctx.restore();
    ctx.restore();
  };

  // 사역마: 작고 둥근 동물형
  A.familiar = function (ctx, f, cx, cy, S, t) {
    var R = rng(hash(f.id));
    ctx.save(); ctx.translate(cx, cy + Math.sin(t * 2.5 + R() * 6) * S * 0.03);
    var c = f.c1;
    var g = ctx.createRadialGradient(-S * 0.08, -S * 0.1, S * 0.05, 0, 0, S * 0.4); g.addColorStop(0, shade(c, 0.35)); g.addColorStop(1, shade(c, -0.35));
    ctx.fillStyle = g; ctx.strokeStyle = shade(c, -0.6); ctx.lineWidth = 1.2;
    var type = hash(f.id) % 4;
    if (type === 0) { // 날개
      ctx.beginPath(); ctx.moveTo(-S * 0.1, 0); ctx.quadraticCurveTo(-S * 0.45, -S * 0.3 - Math.sin(t * 8) * S * 0.1, -S * 0.42, S * 0.1); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(S * 0.1, 0); ctx.quadraticCurveTo(S * 0.45, -S * 0.3 - Math.sin(t * 8) * S * 0.1, S * 0.42, S * 0.1); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (type === 1) { // 귀
      ctx.beginPath(); ctx.ellipse(-S * 0.12, -S * 0.28, S * 0.06, S * 0.16, -0.2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(S * 0.12, -S * 0.28, S * 0.06, S * 0.16, 0.2, 0, 7); ctx.fill(); ctx.stroke();
    } else if (type === 2) { // 꼬리
      ctx.lineWidth = S * 0.08; ctx.strokeStyle = shade(c, -0.2); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(S * 0.15, S * 0.1); ctx.quadraticCurveTo(S * 0.45, S * 0.05, S * 0.38, -S * 0.22 + Math.sin(t * 3) * S * 0.05); ctx.stroke();
      ctx.lineWidth = 1.2; ctx.strokeStyle = shade(c, -0.6);
    } else { // 뿔
      ctx.beginPath(); ctx.moveTo(-S * 0.1, -S * 0.18); ctx.lineTo(-S * 0.16, -S * 0.38); ctx.lineTo(-S * 0.02, -S * 0.2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(S * 0.1, -S * 0.18); ctx.lineTo(S * 0.16, -S * 0.38); ctx.lineTo(S * 0.02, -S * 0.2); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, S * 0.24, S * 0.22, 0, 0, 7); ctx.fill(); ctx.stroke();
    eyes(ctx, 0, -S * 0.03, S * 0.08, S * 0.04, t);
    ctx.fillStyle = 'rgba(255,140,160,.35)'; ctx.beginPath(); ctx.arc(-S * 0.14, S * 0.05, S * 0.03, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(S * 0.14, S * 0.05, S * 0.03, 0, 7); ctx.fill();
    ctx.restore();
  };

  // 아카데미 문장: 별의 종 + 여덟 줄기 별빛
  A.crest = function (ctx, S, color, t) {
    ctx.save(); ctx.clearRect(0, 0, S, S); ctx.translate(S / 2, S / 2);
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, S * 0.03);
    ctx.beginPath(); ctx.arc(0, 0, S * 0.45, 0, 7); ctx.stroke();
    ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(0, 0, S * 0.38, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    for (var i = 0; i < 8; i++) {
      ctx.save(); ctx.rotate(i / 8 * Math.PI * 2 + (t || 0) * 0.05);
      ctx.beginPath(); ctx.moveTo(0, -S * 0.38); ctx.lineTo(0, -S * (i % 2 ? 0.42 : 0.46)); ctx.stroke(); ctx.restore();
    }
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(-S * 0.17, S * 0.12); ctx.quadraticCurveTo(-S * 0.16, -S * 0.2, 0, -S * 0.22); ctx.quadraticCurveTo(S * 0.16, -S * 0.2, S * 0.17, S * 0.12); ctx.lineTo(S * 0.21, S * 0.17); ctx.lineTo(-S * 0.21, S * 0.17); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(0, S * 0.22, S * 0.04, 0, 7); ctx.fill();
    ctx.fillStyle = '#11152a'; ctx.beginPath(); ctx.arc(0, -S * 0.04, S * 0.04, 0, 7); ctx.fill();
    ctx.restore();
  };

  // 가마솥
  A.cauldron = function (ctx, S, color, t, active) {
    ctx.clearRect(0, 0, S, S);
    ctx.save(); ctx.translate(S / 2, S / 2);
    if (active) for (var i = 0; i < 5; i++) {
      var ph = (t * 0.6 + i / 5) % 1;
      ctx.globalAlpha = (1 - ph) * 0.8; ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(Math.sin(i * 3 + t) * S * 0.12, -S * 0.1 - ph * S * 0.35, S * 0.05 * (1 - ph * 0.5), 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#2a2a3a'; ctx.strokeStyle = '#0a0a14'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, S * 0.08, S * 0.34, S * 0.28, 0, 0, Math.PI); ctx.lineTo(-S * 0.34, -S * 0.04); ctx.lineTo(S * 0.34, -S * 0.04); ctx.fill(); ctx.stroke();
    ctx.fillStyle = active ? color : '#3a3a4a'; ctx.beginPath(); ctx.ellipse(0, -S * 0.04, S * 0.33, S * 0.08, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.restore();
  };

  // 밤하늘 배경 (정적 별 + 별자리 선)
  // pal: 테마별 하늘 색 {bg:[3색], star:[2색], line, a} (없으면 밤하늘)
  A.sky = function (cv, pal) {
    pal = pal || { bg: ['#1f2650', '#11152a', '#0b0e1e'], star: ['#f0cf8a', '#dfe4ff'], line: '#d6ad5f', a: 1 };
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = window.innerWidth, H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    var ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    var R = rng(20241024);
    var g = ctx.createRadialGradient(W * 0.7, -H * 0.1, 0, W * 0.7, -H * 0.1, Math.max(W, H) * 1.1);
    g.addColorStop(0, pal.bg[0]); g.addColorStop(0.55, pal.bg[1]); g.addColorStop(1, pal.bg[2]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var n = Math.floor(W * H / 2600);
    for (var i = 0; i < n; i++) {
      var x = R() * W, y = R() * H, r = R() < 0.92 ? R() * 0.9 + 0.2 : R() * 1.6 + 0.8;
      ctx.globalAlpha = (0.25 + R() * 0.6) * pal.a; ctx.fillStyle = R() < 0.15 ? pal.star[0] : pal.star[1];
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 0.12 * pal.a; ctx.strokeStyle = pal.line; ctx.lineWidth = 0.8;
    for (var c = 0; c < 7; c++) {
      var cx = R() * W, cy = R() * H; ctx.beginPath(); ctx.moveTo(cx, cy);
      var pts = [[cx, cy]];
      for (var k = 0; k < 4; k++) { cx += (R() - 0.5) * 160; cy += (R() - 0.5) * 120; ctx.lineTo(cx, cy); pts.push([cx, cy]); }
      ctx.stroke();
      ctx.globalAlpha = 0.35 * pal.a; ctx.fillStyle = pal.star[0];
      pts.forEach(function (p) { ctx.beginPath(); ctx.arc(p[0], p[1], 1.6, 0, 7); ctx.fill(); });
      ctx.globalAlpha = 0.12 * pal.a;
    }
    ctx.globalAlpha = 1;
  };

  // 정적 캔버스 하나에 함수 그리기 (도감 · 사역마 목록)
  A.paint = function (cv, fn) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = cv.clientWidth || +cv.getAttribute('width') || 64, h = cv.clientHeight || +cv.getAttribute('height') || 64;
    cv.width = w * dpr; cv.height = h * dpr;
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    fn(ctx, w, h);
  };
  return A;
})();
