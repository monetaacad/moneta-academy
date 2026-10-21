/* 합성 효과음 (Web Audio) — 설정에서 켤 때만
   화음 + 잔향(리버브·메아리) + 별가루 반짝임. 음원 파일 없이 코드로 합성한다.
   음표: [주파수, 시작(초), 길이(초), 파형, 볼륨, 어택(초), 모드('b'=종소리, 'p'=화음 패드), 글라이드 배율] */
var Snd = (function () {
  var S = { on: false, ctx: null, last: {}, off: {}, sfxVol: 0.7 }, dry = null, conv = null, dly = null, VOL = 3, sfxBus = null;
  function irBuf(c) {
    var len = Math.floor(c.sampleRate * 2.6), b = c.createBuffer(2, len, c.sampleRate);
    for (var ch = 0; ch < 2; ch++) { var d = b.getChannelData(ch); for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    return b;
  }
  function ac() {
    if (!S.ctx) {
      try {
        var c = S.ctx = new (window.AudioContext || window.webkitAudioContext)();
        var comp = c.createDynamicsCompressor(); comp.connect(c.destination);
        // 효과음과 배경음은 각자 볼륨 손잡이를 거쳐 나간다
        sfxBus = c.createGain(); sfxBus.gain.value = S.sfxVol; sfxBus.connect(comp);
        comp = sfxBus;
        dry = c.createGain(); dry.connect(comp);
        conv = c.createConvolver(); conv.buffer = irBuf(c); var wet = c.createGain(); wet.gain.value = 0.9; conv.connect(wet); wet.connect(comp);
        dly = c.createDelay(1); dly.delayTime.value = 0.27; var fb = c.createGain(); fb.gain.value = 0.3; var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2800;
        dly.connect(lp); lp.connect(fb); fb.connect(dly); var dw = c.createGain(); dw.gain.value = 0.35; lp.connect(dw); dw.connect(comp);
      } catch (e) { S.ctx = null; S.on = false; return null; }
    }
    if (S.ctx.state === 'suspended') S.ctx.resume();
    return S.ctx;
  }
  function voice(n, t0, send, out) {
    var c = S.ctx, f = n[0], t = t0 + n[1], d = n[2], ty = n[3], v = Math.min(0.5, n[4] * VOL), a = n[5] || 0.01, m = n[6] || '', gl = n[7] || 1;
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    g.connect(out || dry); g.connect(send);
    var parts = m === 'p' ? [[f * Math.pow(2, -7 / 1200), 0.5], [f * Math.pow(2, 7 / 1200), 0.5]] : m === 'b' ? [[f, 1], [f * 2.76, 0.22]] : [[f, 1]];
    parts.forEach(function (p) {
      var o = c.createOscillator(), pg = c.createGain();
      o.type = p[1] < 0.3 ? 'sine' : ty; pg.gain.value = p[1];
      o.frequency.setValueAtTime(p[0], t); if (gl !== 1) o.frequency.exponentialRampToValueAtTime(p[0] * gl, t + d);
      if (m === 'p') { var l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 4.5 + Math.random(); lg.gain.value = p[0] * 0.004; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + d + 0.1); }
      o.connect(pg); pg.connect(g); o.start(t); o.stop(t + d + 0.1);
    });
  }
  var SPARK = [2093, 2349.3, 2637, 3136, 3520, 4186];
  var SEQ = {
    kill: { rev: 0.25, n: [[1318.5, 0, 0.28, 'sine', 0.03, 0.005, 'b'], [1975.5, 0.035, 0.32, 'sine', 0.02, 0.005, 'b']] },
    boss: { rev: 0.7, n: [[110, 0, 2.2, 'triangle', 0.03, 0.35, 'p'], [164.8, 0, 2.2, 'triangle', 0.028, 0.35, 'p'], [261.6, 0.05, 2, 'triangle', 0.024, 0.4, 'p'], [311.1, 0.1, 2, 'sine', 0.026, 0.45, 'p'], [493.9, 0.15, 1.9, 'sine', 0.018, 0.5, 'p'], [880, 0.6, 1.3, 'sine', 0.02, 0.005, 'b']] },
    level: { rev: 0.45, sp: 5, ss: 0.25, n: [[523.3, 0, 0.5, 'sine', 0.035, 0.005, 'b'], [659.3, 0.07, 0.5, 'sine', 0.035, 0.005, 'b'], [784, 0.14, 0.5, 'sine', 0.035, 0.005, 'b'], [987.8, 0.21, 0.7, 'sine', 0.035, 0.005, 'b'], [261.6, 0.2, 1.2, 'triangle', 0.02, 0.08, 'p'], [392, 0.2, 1.2, 'triangle', 0.018, 0.08, 'p'], [587.3, 0.2, 1.2, 'sine', 0.015, 0.1, 'p']] },
    spirit: { rev: 0.8, sp: 4, ss: 0.4, n: [[880, 0, 1.6, 'sine', 0.02, 0.4, 'p'], [1174.7, 0.05, 1.2, 'sine', 0.03, 0.005, 'b'], [1480, 0.18, 1.2, 'sine', 0.026, 0.005, 'b'], [1760, 0.31, 1.4, 'sine', 0.024, 0.005, 'b']] },
    ach: { rev: 0.6, sp: 8, ss: 0.25, n: [[174.6, 0, 2, 'triangle', 0.025, 0.15, 'p'], [349.2, 0, 2, 'triangle', 0.02, 0.15, 'p'], [440, 0.03, 2, 'sine', 0.022, 0.18, 'p'], [523.3, 0.06, 2, 'sine', 0.02, 0.2, 'p'], [659.3, 0.09, 2, 'sine', 0.018, 0.22, 'p'], [987.8, 0.12, 1.8, 'sine', 0.014, 0.25, 'p'], [1318.5, 0.3, 1, 'sine', 0.025, 0.005, 'b']] },
    pass: { rev: 0.5, sp: 7, ss: 0.5, n: [[392, 0, 0.35, 'triangle', 0.04, 0.005, 'b'], [523.3, 0.13, 0.35, 'triangle', 0.04, 0.005, 'b'], [659.3, 0.26, 0.35, 'triangle', 0.04, 0.005, 'b'], [784, 0.39, 0.5, 'triangle', 0.045, 0.005, 'b'], [261.6, 0.52, 1.6, 'triangle', 0.022, 0.06, 'p'], [523.3, 0.52, 1.6, 'sine', 0.02, 0.06, 'p'], [659.3, 0.52, 1.6, 'sine', 0.018, 0.06, 'p'], [987.8, 0.52, 1.5, 'sine', 0.015, 0.08, 'p'], [1174.7, 0.52, 1.5, 'sine', 0.012, 0.1, 'p']] },
    fail: { rev: 0.55, n: [[293.7, 0, 0.9, 'triangle', 0.03, 0.02, 'p', 0.89], [349.2, 0, 0.9, 'triangle', 0.025, 0.02, 'p', 0.89], [440, 0, 0.9, 'sine', 0.022, 0.02, 'p', 0.89], [220, 0.25, 1.2, 'sine', 0.03, 0.05, 'p', 0.94]] },
    enh: { rev: 0.5, sp: 3, ss: 0.15, n: [[1318.5, 0, 0.2, 'sine', 0.025, 0.003, 'b'], [1760, 0.09, 0.9, 'sine', 0.03, 0.005, 'b'], [2217.5, 0.12, 0.9, 'sine', 0.022, 0.005, 'b'], [880, 0.09, 0.9, 'sine', 0.015, 0.05, 'p']] },
    click: { rev: 0.15, n: [[2093, 0, 0.08, 'sine', 0.015, 0.003, 'b']] },
    // 물약 마시기: 꼴깍꼴깍 올라가는 거품 세 번 + 맑은 종소리와 별가루
    drink: { rev: 0.4, sp: 3, ss: 0.34, n: [[330, 0, 0.13, 'sine', 0.035, 0.006, '', 1.9], [440, 0.1, 0.13, 'sine', 0.035, 0.006, '', 1.9], [587.3, 0.2, 0.15, 'sine', 0.035, 0.006, '', 2], [1568, 0.32, 0.7, 'sine', 0.022, 0.005, 'b'], [2349.3, 0.38, 0.8, 'sine', 0.018, 0.005, 'b'], [784, 0.32, 0.9, 'sine', 0.012, 0.06, 'p']] }
  };
  S.play = function (k) {
    if (!S.on || S.off[k] || (S.fgOnly && document.hidden)) return; var c = ac(); if (!c) return;   // fgOnly: 창을 내리거나 다른 탭을 볼 때는 울리지 않음
    var s = SEQ[k]; if (!s) return;
    var now = c.currentTime;
    if (S.last[k] && now - S.last[k] < (k === 'kill' ? 0.25 : 0.08)) return;
    S.last[k] = now;
    var send = c.createGain(); send.gain.value = s.rev; send.connect(conv); send.connect(dly);
    s.n.forEach(function (n) { voice(n, now, send); });
    for (var i = 0; i < (s.sp || 0); i++) voice([SPARK[Math.floor(Math.random() * SPARK.length)], (s.ss || 0.1) + i * 0.06 + Math.random() * 0.03, 0.4, 'sine', 0.009, 0.003, 'b'], now, send);
  };
  S.set = function (on) { S.on = !!on; if (on) ac(); };
  // 효과음 이름 (설정 화면용)
  S.KEYS = [['click', '버튼·작업 시작'], ['level', '작업 완료 보고'], ['spirit', '반딧불 정령'], ['enh', '강화·물약 제조'], ['drink', '물약 마시기'], ['ach', '업적·보상'], ['pass', '승리·합격'], ['fail', '패배·실패'], ['boss', '월드 보스'], ['msg', '채팅·1:1 알림']];
  SEQ.msg = { rev: 0.3, n: [[1567.98, 0, 0.25, 'sine', 0.018, 0.004, 'b'], [2093, 0.07, 0.35, 'sine', 0.014, 0.004, 'b']] };
  // 수업 종: 딩동댕동 (미-도-레-솔, 그리고 솔-레-미-도)
  SEQ.bell = { rev: 0.75, n: [[659.3, 0, 1.4, 'sine', 0.04, 0.004, 'b'], [523.3, 0.42, 1.4, 'sine', 0.04, 0.004, 'b'], [587.3, 0.84, 1.4, 'sine', 0.04, 0.004, 'b'], [392, 1.26, 2, 'sine', 0.045, 0.004, 'b'], [392, 2.1, 1.4, 'sine', 0.035, 0.004, 'b'], [587.3, 2.52, 1.4, 'sine', 0.035, 0.004, 'b'], [659.3, 2.94, 1.4, 'sine', 0.035, 0.004, 'b'], [523.3, 3.36, 2.4, 'sine', 0.04, 0.004, 'b']] };
  S.KEYS.splice(2, 0, ['bell', '수업 종소리']);
  // 낚시: 퐁 하고 찌가 잠기는 입질 · 낚아 올렸을 때 짧은 상승음
  SEQ.bite = { rev: 0.3, n: [[620, 0, 0.14, 'sine', 0.045, 0.003, '', 0.5], [930, 0.08, 0.12, 'sine', 0.03, 0.003, '', 0.6]] };
  SEQ.catch = { rev: 0.45, sp: 3, ss: 0.18, n: [[392, 0, 0.25, 'triangle', 0.035, 0.005, 'b'], [587.3, 0.07, 0.3, 'triangle', 0.035, 0.005, 'b'], [784, 0.14, 0.5, 'sine', 0.032, 0.005, 'b']] };
  S.KEYS.push(['bite', '낚시 입질'], ['catch', '낚시 성공']);
  S.setOff = function (k, off) { if (off) S.off[k] = true; else delete S.off[k]; };
  S.vol = function (v) { S.sfxVol = Math.max(0, Math.min(1, v)); if (S.ctx && sfxBus) sfxBus.gain.setTargetAtTime(S.sfxVol, S.ctx.currentTime, 0.05); };
  S.preview = function () { var was = S.on; S.on = true; S.play('level'); S.on = was; };
  return S;
})();
/* 배경음악 (Web Audio 합성) — 설정에서 켤 때만. 이 브라우저에만 기억한다.
   낮(한국 시간 06~18시)·밤 × 광장·전투 네 곡. 화음 진행은 돌고, 선율·아르페지오는 매번 조금씩 다르게 흘러간다. */
var Bgm = (function () {
  // 배경음악은 기본으로 켠다 (직접 끈 경우만 꺼짐). 브라우저 정책상 첫 클릭 · 키 입력 뒤에 소리가 난다
  var B = { on: true, vol: 0.5, mood: null, bg: false }, ctx = null, out = null, dry = null, conv = null, noise = null, bus = null, timer = 0, nextT = 0, step = 0, ci = 0, leadIdx = 3, arp = 0, want = null;
  try { B.on = localStorage.getItem('arc_bgm') !== '0'; B.bg = localStorage.getItem('arc_bgm_bg') === '1'; var v = parseFloat(localStorage.getItem('arc_bgm_vol')); if (isFinite(v)) B.vol = Math.max(0, Math.min(1, v)); } catch (e) { }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  var ARP = [[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 1, 3, 2, 4, 3, 1], [4, 3, 2, 1, 0, 1, 2, 3], [0, 1, 2, 1, 3, 2, 4, 2]];
  var M = {
    dayCalm: { kind: 'bounce', st: 0.25, spc: 16, chords: [[59, 62, 69], [59, 62, 67], [59, 64, 67], [62, 67, 69]], bass: [43, 40, 48, 50], padV: 0.012, padCut: 1700, lead: [74, 76, 79, 81, 83, 86, 88], leadP: 0.35 },
    nightCalm: { kind: 'calm', st: 0.9, spc: 8, chords: [[64, 69, 71], [62, 67, 71], [60, 64, 71], [62, 67, 69]], bass: [41, 40, 45, 38], padV: 0.022, padCut: 1000, bells: [76, 79, 81, 84, 86, 88], bellP: 0.2, vln: [69, 71, 72, 74, 76, 79, 81], vlnP: 0.6 },
    dayAdv: { kind: 'battle', st: 0.17, spc: 16, chords: [[62, 66, 69], [60, 64, 67], [59, 62, 67], [61, 64, 69]], bass: [38, 48, 43, 45], padV: 0.011, padCut: 1400, ost: [0, 0, 12, 0, 7, 0, 12, 0, 0, 0, 12, 0, 7, 10, 12, 7], acc: [0, 8], vln: [69, 71, 72, 74, 76, 78, 79, 81], vlnP: 0.5, drum: [0, 6, 8, 14], drumV: 0.16 },
    nightAdv: { kind: 'battle', st: 0.18, spc: 16, low: true, chords: [[57, 62, 65], [58, 62, 65], [55, 58, 62], [57, 61, 64]], bass: [38, 46, 43, 45], padV: 0.011, padCut: 800, ost: [0, 0, 0, 12, 0, 0, 7, 0, 0, 0, 0, 12, 0, 10, 7, 3], acc: [0, 8], vln: [69, 72, 74, 76, 77, 79, 81], vlnP: 0.45, drum: [0, 8], drumV: 0.14 }
  };
  function irBuf(c) { var len = Math.floor(c.sampleRate * 3.2), b = c.createBuffer(2, len, c.sampleRate); for (var ch = 0; ch < 2; ch++) { var d = b.getChannelData(ch); for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); } return b; }
  function init() {
    if (ctx) return ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      var comp = ctx.createDynamicsCompressor(); comp.connect(ctx.destination);
      out = ctx.createGain(); out.gain.value = B.vol; out.connect(comp);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); var nd = noise.getChannelData(0); for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
    return ctx;
  }
  // 곡마다 새 버스: 이전 곡은 버스째로 서서히 줄이고 끊는다
  function newBus() {
    var g = ctx.createGain(); g.gain.value = 0.0001; g.connect(out);
    var d = ctx.createGain(); d.gain.value = 0.6; d.connect(g);
    var cv = ctx.createConvolver(); cv.buffer = conv || (conv = irBuf(ctx)); var w = ctx.createGain(); w.gain.value = 0.9; cv.connect(w); w.connect(g);
    return { g: g, dry: d, conv: cv };
  }
  function o2(g, wet) { g.connect(bus.dry); var s = ctx.createGain(); s.gain.value = wet; g.connect(s); s.connect(bus.conv); }
  function pad(m, t, d, v, cut) { var g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut; f.Q.value = 0.4; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + d * 0.35); g.gain.setValueAtTime(v, t + d * 0.7); g.gain.linearRampToValueAtTime(0.0001, t + d * 1.2); f.connect(g); o2(g, 1); [-5, 5].forEach(function (c) { var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = c; o.connect(f); o.start(t); o.stop(t + d * 1.25); }); }
  function bell(m, t, v) { var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2); o2(g, 1.4); [[1, 1], [2.76, 0.16]].forEach(function (p) { var o = ctx.createOscillator(), pg = ctx.createGain(); o.type = 'sine'; o.frequency.value = mtof(m) * p[0]; pg.gain.value = p[1]; o.connect(pg); pg.connect(g); o.start(t); o.stop(t + 2.3); }); }
  function bowed(m, t, d, v, att, bright) {
    var g = ctx.createGain(), hp = ctx.createBiquadFilter(), body = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = Math.max(50, mtof(m) * 0.7); body.type = 'peaking'; body.frequency.value = m < 55 ? 320 : 950; body.Q.value = 1.4; body.gain.value = 5; lp.type = 'lowpass'; lp.frequency.value = bright || 2400; lp.Q.value = 0.3; hp.connect(body); body.connect(lp); lp.connect(g);
    var a = att || 0.45, rel = Math.min(0.8, d * 0.4); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.setValueAtTime(v * 0.9, t + Math.max(a, d - rel)); g.gain.linearRampToValueAtTime(0.0001, t + d); o2(g, 1.1);
    [-9, 0, 9].forEach(function (c, i) { var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = c; var l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5.2 + i * 0.35; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(0, t + Math.min(0.35, d * 0.3)); lg.gain.linearRampToValueAtTime(12, t + Math.min(0.9, d * 0.6)); l.connect(lg); lg.connect(o.detune); l.start(t); l.stop(t + d + 0.05); var og = ctx.createGain(); og.gain.value = 0.34; o.connect(og); og.connect(hp); o.start(t); o.stop(t + d + 0.05); });
  }
  function spic(m, t, v, bright) {
    var g = ctx.createGain(), hp = ctx.createBiquadFilter(), body = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = Math.max(45, mtof(m) * 0.6); body.type = 'peaking'; body.frequency.value = 300; body.Q.value = 1.2; body.gain.value = 6; lp.type = 'lowpass'; lp.frequency.setValueAtTime(bright, t); lp.frequency.exponentialRampToValueAtTime(bright * 0.35, t + 0.12); hp.connect(body); body.connect(lp); lp.connect(g);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.012); g.gain.exponentialRampToValueAtTime(v * 0.3, t + 0.07); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16); o2(g, 0.35);
    [-8, 8].forEach(function (c) { var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = c; var og = ctx.createGain(); og.gain.value = 0.5; o.connect(og); og.connect(hp); o.start(t); o.stop(t + 0.18); });
    var n = ctx.createBufferSource(); n.buffer = noise; var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 1; var ng = ctx.createGain(); ng.gain.setValueAtTime(v * 0.25, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.03); n.connect(bp); bp.connect(ng); ng.connect(g); n.start(t, Math.random() * 0.5); n.stop(t + 0.04);
  }
  function pluck(m, t, v, len) { var g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.8; f.frequency.setValueAtTime(Math.min(2000, mtof(m) * 4), t); f.frequency.exponentialRampToValueAtTime(Math.max(160, mtof(m) * 1.2), t + len * 0.5); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + len); f.connect(g); o2(g, 0.6); var o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(m); o.connect(f); o.start(t); o.stop(t + len + 0.05); }
  function marimba(m, t, v, dec) { dec = dec || 0.5; var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dec); o2(g, 0.6); [[1, 1, dec * 0.95], [4, 0.14, 0.08], [10, 0.04, 0.025]].forEach(function (p) { var o = ctx.createOscillator(), pg = ctx.createGain(); o.type = 'sine'; o.frequency.value = mtof(m) * p[0]; pg.gain.setValueAtTime(p[1], t); pg.gain.exponentialRampToValueAtTime(0.0001, t + p[2]); o.connect(pg); pg.connect(g); o.start(t); o.stop(t + dec + 0.05); }); }
  function flute(m, t, d, v) {
    var g = ctx.createGain(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.connect(g); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.06); g.gain.setValueAtTime(v * 0.85, t + d * 0.6); g.gain.linearRampToValueAtTime(0.0001, t + d); o2(g, 1);
    [['triangle', 1, 1], ['sine', 0.25, 2]].forEach(function (p) { var o = ctx.createOscillator(), og = ctx.createGain(); o.type = p[0]; o.frequency.value = mtof(m) * p[2]; og.gain.value = p[1]; var l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(0, t + 0.2); lg.gain.linearRampToValueAtTime(8, t + 0.5); l.connect(lg); lg.connect(o.detune); o.connect(og); og.connect(lp); o.start(t); l.start(t); o.stop(t + d + 0.05); l.stop(t + d + 0.05); });
    var n = ctx.createBufferSource(); n.buffer = noise; var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = mtof(m) * 2; bp.Q.value = 3; var ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(v * 0.35, t + 0.04); ng.gain.linearRampToValueAtTime(v * 0.06, t + 0.2); ng.gain.linearRampToValueAtTime(0.0001, t + d); n.connect(bp); bp.connect(ng); ng.connect(g); n.start(t); n.stop(t + d);
  }
  function drum(t, v, lo) {
    var o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(lo ? 90 : 120, t); o.frequency.exponentialRampToValueAtTime(lo ? 42 : 58, t + 0.25); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45); o.connect(g); o2(g, 0.35); o.start(t); o.stop(t + 0.5);
    var n = ctx.createBufferSource(); n.buffer = noise; var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lo ? 500 : 1000; var ng = ctx.createGain(); ng.gain.setValueAtTime(v * 0.4, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.1); n.connect(lp); lp.connect(ng); o2(ng, 0.3); n.start(t); n.stop(t + 0.12);
  }
  function onChord(S, t) {
    var K = S.chords.length, ch = S.chords[ci % K], bs = S.bass[ci % K], len = S.st * S.spc;
    ch.forEach(function (n) { pad(n, t, len, S.padV, S.padCut); });
    if (S.kind === 'calm') bowed(bs, t, len * 1.02, 0.045, 1.2, 1300);
    if (S.kind === 'bounce') arp = Math.floor(Math.random() * ARP.length);
    if (S.vln && Math.random() < S.vlnP) {
      var pool = S.vln.filter(function (n) { return ch.concat([bs]).some(function (c) { return (n - c) % 12 === 0; }); }), n1 = pick(pool);
      if (S.kind === 'battle') bowed(n1, t, len * 0.98, 0.026, 0.35, 2200);
      else { var st = t + 0.6, dd = len * 0.48, j = S.vln.indexOf(n1) + (Math.random() < 0.5 ? -1 : 1); bowed(n1, st, dd, 0.032, 0.7); bowed(S.vln[Math.max(0, Math.min(S.vln.length - 1, j))], st + dd * 0.95, dd, 0.028, 0.6); }
    }
    ci++;
  }
  function onStep(S, t, s) {
    var K = S.chords.length, k = (ci - 1 + K) % K, cur = S.chords[k], cb = S.bass[k];
    if (S.kind === 'battle') {
      var acc = S.acc.indexOf(s) >= 0, o = S.ost[s];
      spic(cb + o, t, acc ? 0.13 : (o ? 0.085 : 0.07), acc ? 2600 : 1900); if (acc) spic(cb + o + 12, t, 0.05, 2400); if (s === 12 && Math.random() < 0.5) spic(cb + 19, t, 0.05, 2400);
      if (S.drum.indexOf(s) >= 0) drum(t, s === 0 ? S.drumV : S.drumV * 0.6, S.low);
    } else if (S.kind === 'bounce') {
      if (s === 0 || s === 8) pluck(cb, t, 0.035, 0.4);
      if (s % 2 === 0) { var tones = [cur[0], cur[1], cur[2], cur[0] + 12, cur[1] + 12]; marimba(tones[ARP[arp][s / 2]] + 12, t, s % 4 === 0 ? 0.07 : 0.05, 0.5); }
      if (s % 4 === 0) marimba(cur[0], t, s === 0 ? 0.06 : 0.04, 0.7);
      if (s % 8 === 0 && Math.random() < S.leadP) { leadIdx = Math.max(0, Math.min(S.lead.length - 1, leadIdx + pick([-2, -1, 1, 1, 2]))); flute(S.lead[leadIdx], t, S.st * (Math.random() < 0.5 ? 7.5 : 3.8), 0.03); }
    } else if (Math.random() < S.bellP) bell(pick(S.bells), t + Math.random() * 0.04, 0.03);
  }
  function tick() {
    if (!ctx || !B.mood || ctx.state !== 'running') return;
    var S = M[B.mood], ahead = ctx.currentTime + (document.hidden ? 2.5 : 0.4);   // 창을 내려 두면 타이머가 느려지므로 더 멀리 미리 깔아 둔다
    if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.05;   // 탭이 멈췄다 돌아오면 밀린 음은 건너뛴다
    while (nextT < ahead) { var s = step % S.spc; if (s === 0) onChord(S, nextT); onStep(S, nextT, s); step++; nextT += S.st; }
  }
  function play(m) {
    if (!init()) return;
    var t = ctx.currentTime;
    if (bus) { var old = bus; old.g.gain.cancelScheduledValues(t); old.g.gain.setValueAtTime(Math.max(0.0001, old.g.gain.value), t); old.g.gain.linearRampToValueAtTime(0.0001, t + 1.2); setTimeout(function () { try { old.g.disconnect(); } catch (e) { } }, 4000); bus = null; }
    B.mood = m; if (!m) { if (timer) { clearInterval(timer); timer = 0; } return; }
    bus = newBus(); var t0 = t + 0.6; bus.g.gain.setValueAtTime(0.0001, t0); bus.g.gain.linearRampToValueAtTime(1, t0 + (M[m].kind === 'battle' ? 1 : 2.5));
    ci = 0; step = 0; leadIdx = 3; nextT = t0;
    if (!timer) timer = setInterval(tick, 100);
    tick();
  }
  function apply() { var m = B.on && (B.bg || !document.hidden) ? want : null; if (m !== B.mood) play(m); }
  // 화면(광장·전투)과 한국 시간으로 곡을 고른다
  B.want = function (scene, t) {
    var h = Math.floor(((t + 9 * 3600) % 86400 + 86400) % 86400 / 3600), day = h >= 6 && h < 18;
    want = scene ? (scene === 'battle' ? (day ? 'dayAdv' : 'nightAdv') : (day ? 'dayCalm' : 'nightCalm')) : null;
    apply();
  };
  B.set = function (on) { B.on = !!on; try { localStorage.setItem('arc_bgm', B.on ? '1' : '0'); } catch (e) { } if (B.on) B.unlock(); apply(); };
  // 창을 내려 두거나 다른 탭을 볼 때도 계속 틀지
  B.setBg = function (on) { B.bg = !!on; try { localStorage.setItem('arc_bgm_bg', B.bg ? '1' : '0'); } catch (e) { } apply(); };
  B.setVol = function (v) { B.vol = Math.max(0, Math.min(1, v)); try { localStorage.setItem('arc_bgm_vol', String(B.vol)); } catch (e) { } if (out) out.gain.setTargetAtTime(B.vol, ctx.currentTime, 0.1); };
  // 브라우저는 사용자가 한 번 누르기 전에는 소리를 막는다: 첫 입력 때 깨운다
  B.unlock = function () { if (!B.on) return; if (init() && ctx.state === 'suspended') ctx.resume().then(apply, function () { }); };
  ['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, function () { B.unlock(); }, true); });
  document.addEventListener('visibilitychange', apply);
  return B;
})();
