/* NBA 智能预测 —— 纯前端，只读取 data.json；没有的数据显示“暂无”。 */
(function () {
  "use strict";
  var REFRESH = 60;
  var state = { data: null, sel: null, gen: null, left: REFRESH, want: null, booted: false };
  try { state.want = localStorage.getItem("nba_sel"); } catch (e) {}
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function miss(note) { return '<span class="miss" title="' + esc(note || "") + '">暂无</span>'; }
  function num(v, d) { return v == null || isNaN(v) ? null : Number(v).toFixed(d == null ? 1 : d).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1"); }
  function fmtLine(v) { var n = num(v, 1); return n == null ? null : n; }
  // 盘口（主队预期净胜分）→ “火箭 -6.5”
  function hcText(g, lineHome) {
    if (lineHome == null) return null;
    if (lineHome === 0) return "平手";
    return lineHome > 0 ? g.home_cn + " -" + fmtLine(lineHome) : g.away_cn + " -" + fmtLine(-lineHome);
  }
  function winText(g, m) {
    if (m == null) return null;
    if (m === 0) return "打平";
    return m > 0 ? g.home_cn + "赢 " + num(m, 2) + " 分" : g.away_cn + "赢 " + num(-m, 2) + " 分";
  }
  function roll(text) {
    // 把 “勇士 +6.5” 末尾的数字做成滚动数字
    var m = /^(.*?)([+-]?)(\d+(?:\.\d+)?)$/.exec(String(text));
    if (!m) return esc(text);
    var dec = (m[3].split(".")[1] || "").length;
    return esc(m[1]) + esc(m[2]) + '<span data-roll="' + m[3] + '" data-dec="' + dec + '">0</span>';
  }
  function runRolls(root) {
    var els = (root || document).querySelectorAll("[data-roll]");
    els.forEach(function (el) {
      var to = parseFloat(el.getAttribute("data-roll")), dec = +el.getAttribute("data-dec") || 0, t0 = null;
      function step(ts) {
        if (!t0) t0 = ts;
        var p = Math.min(1, (ts - t0) / 1100), e = 1 - Math.pow(1 - p, 3);
        el.textContent = (to * e).toFixed(dec);
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }
  function bandPill(b) { b = b || "暂无"; return '<span class="pill ' + esc(b) + '">把握度 ' + esc(b) + "</span>"; }
  function toast(msg) { var t = $("toast"); t.textContent = msg; t.classList.add("on"); setTimeout(function () { t.classList.remove("on"); }, 2600); }

  /* ---------- 开场加载动画 ---------- */
  var loaderStart = Date.now();
  /* ---------- 片头 v3「能量汇聚」：参考 暴雪/星际2 片头（蓝光汇聚成标）、Riot 品牌片头（上升音 + 结尾两下重拍）、漫威/PlayStation（碎片汇聚成金属标）、保时捷开机（精准、干脆的定格）
     分镜（秒）：
       点火 0–0.30   黑场中心一个光点 → 拉成横向变形镜头光线（高音“叮” + 次低音起）
       汇聚 0.30–0.84 镜头高速前冲（放射速度线），520 颗能量粒子从四周螺旋汇聚成一颗旋转的篮球（球缝线条），上升音越来越急
       蓄压 0.84–1.00 篮球向中心坍缩成一个光核（吸气声）→ 0.92 第一下重拍，速度线骤停，留 0.08 秒屏息
       爆发 1.00–1.15 第二下重拍（低音轰鸣 + 金属撞击）：横向光晕炸开、细冲击环、粒子回弹拼成“NBA”，镌铬 Logo 接替粒子，轻微震屏
       定格 1.15–2.20 高光扫过 Logo、余烬缓慢飘散 → 1.45 青色细线展开、“智能预测”升起收字距 → 副标题 → 1.95 星芒；大面积黑色留白，之后 0.3 秒淡出
     粒子/速度线画在 1 倍分辨率画布（光效本来就是柔的），Logo、光晕、标题是预渲染的高清图层，只改位置和透明度；首帧 = 黑场 + 中心暗光点（与 iOS 静态启动图一致） */
  var IN = { T: 2200, imp: 0.92, boom: 1.0, hold: 1.45 };
  function loaderFeed() { return Promise.resolve(); }
  function introSound() {
    try { if (localStorage.getItem("nba_intro_sound") === "0") return; } catch (e) {}
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try {
      var ac = new AC(); if (ac.resume) ac.resume();
      var T = ac.currentTime + 0.03, sr = ac.sampleRate, M = ac.createDynamicsCompressor(); M.threshold.value = -12; M.ratio.value = 6; M.connect(ac.destination);
      function env(g, t0, a, peak, d) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); }
      function osc(type, f0, f1, t0, a, peak, d) { var o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t0); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + a + d); env(g, t0, a, peak, d); o.connect(g); g.connect(M); o.start(t0); o.stop(t0 + a + d + 0.05); }
      function nz(type, f0, f1, q, t0, a, peak, d) { var n = Math.floor(sr * (a + d + 0.06)), b = ac.createBuffer(1, n, sr), c = b.getChannelData(0); for (var i = 0; i < n; i++) c[i] = Math.random() * 2 - 1; var s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = b; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + a + d); env(g, t0, a, peak, d); s.connect(f); f.connect(g); g.connect(M); s.start(t0); s.stop(t0 + a + d + 0.05); }
      var I = T + IN.imp, B = T + IN.boom;
      osc("sine", 3300, 3300, T, 0.004, 0.08, 0.25); osc("sine", 6600, 6600, T, 0.004, 0.025, 0.15);   // 点火：高音“叮”
      osc("sine", 40, 58, T, 0.6, 0.35, 0.3);                                                       // 次低音起
      nz("highpass", 700, 6500, 0.8, T + 0.3, 0.6, 0.16, 0.02); osc("triangle", 90, 360, T + 0.3, 0.6, 0.07, 0.02); // 汇聚：上升音
      nz("bandpass", 250, 3200, 1.2, T + 0.76, 0.16, 0.35, 0.01);                                  // 蓄压：吸气
      osc("sine", 130, 48, I, 0.004, 0.85, 0.14); nz("highpass", 2500, 2500, 0.7, I, 0.002, 0.3, 0.03); // 第一下重拍
      osc("sine", 1800, 2600, I + 0.01, 0.06, 0.02, 0.02);                                          // 屏息里一丝高音
      osc("sine", 92, 28, B, 0.006, 1.0, 1.0); nz("lowpass", 260, 60, 0.7, B, 0.006, 0.7, 0.55);    // 第二下重拍：低音轰鸣
      [523, 1187, 1873, 2960].forEach(function (f, i) { osc("triangle", f, f, B, 0.004, 0.11 / (i + 1), 0.8 - i * 0.14); }); // 金属撞击
      nz("bandpass", 1600, 700, 0.8, B, 0.01, 0.14, 0.8);                                           // 爆发空气尾音
      osc("sine", 2200, 5200, T + 1.18, 0.15, 0.022, 0.3);                                          // 高光扫过
      osc("sine", 1650, 1650, T + IN.hold, 0.004, 0.06, 0.08);                                     // 标题线展开
      setTimeout(function () { try { ac.close(); } catch (e) {} }, 3300);
    } catch (e) {}
  }
  var cv = $("ldCv"), cx = cv && cv.getContext("2d"), W = 0, H = 0, DPR = 1, LY = null;
  function sizeCv() { if (!cv) return; DPR = Math.min(2, window.devicePixelRatio || 1); W = window.innerWidth; H = window.innerHeight; cv.width = Math.round(W); cv.height = Math.round(H); cx.setTransform(1, 0, 0, 1, 0, 0); LY = null; }
  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function eo(x) { x = clamp(x); return 1 - Math.pow(1 - x, 3); }
  function eio(x) { x = clamp(x); return x * x * (3 - 2 * x); }
  function exo(x) { x = clamp(x); return x === 1 ? 1 : 1 - Math.pow(2, -10 * x); }
  function back(x) { x = clamp(x); var c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }
  function cvMk(w, h, d) { d = d || DPR; var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * d)); c.height = Math.max(1, Math.round(h * d)); var g = c.getContext("2d"); g.setTransform(d, 0, 0, d, 0, 0); return { c: c, g: g, w: w, h: h }; }
  function blurOf(o, k) { var src = o.c, f = 1; while (f < k) { f *= 2; var s = document.createElement("canvas"); s.width = Math.max(1, Math.round(o.c.width / f)); s.height = Math.max(1, Math.round(o.c.height / f)); var g = s.getContext("2d"); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, s.width, s.height); src = s; } return { c: src, w: o.w, h: o.h }; }
  function sv(o, k, v) { if (o[k] !== v) o[k] = v; } // 值没变就不写，少触发合成
  function st(c, tf, a) { sv(c.style, "transform", tf); sv(c.style, "opacity", a <= 0.004 ? "0" : a.toFixed(3)); }
  function buildLayers() {
    var u = Math.min(W, H * 0.6) / 390, cxp = W / 2, cyp = H * 0.45, i, g, N = 520;
    var sd = 7; function rnd() { sd = (sd * 16807) % 2147483647; return sd / 2147483647; }
    var old = $("ldFx"); if (old) old.parentNode.removeChild(old); var ow = $("ldWorld"); if (ow) ow.parentNode.removeChild(ow);
    var box = document.createElement("div"); box.id = "ldFx"; cv.parentNode.insertBefore(box, cv.nextSibling);
    function lay(c, w, h, l, tp) { c.className = "ld-spr"; c.style.width = w + "px"; c.style.height = h + "px"; c.style.left = l + "px"; c.style.top = tp + "px"; c.style.opacity = 0; box.appendChild(c); return c; }
    // 光晕（径向）与横向变形镜头光线：预渲染，靠透明度/缩放动画
    var bl = cvMk(128, 128, 1); g = bl.g; var rg = g.createRadialGradient(64, 64, 0, 64, 64, 64); rg.addColorStop(0, "rgba(235,252,255,.95)"); rg.addColorStop(0.18, "rgba(120,230,255,.55)"); rg.addColorStop(0.5, "rgba(51,225,255,.14)"); rg.addColorStop(1, "rgba(51,225,255,0)"); g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
    var BS = 520 * u, bloom = lay(bl.c, BS, BS, cxp - BS / 2, cyp - BS / 2);
    var fl = cvMk(512, 48, 1); g = fl.g; var hg = g.createLinearGradient(0, 0, 512, 0); hg.addColorStop(0, "rgba(51,225,255,0)"); hg.addColorStop(0.3, "rgba(51,225,255,.35)"); hg.addColorStop(0.47, "rgba(200,245,255,.9)"); hg.addColorStop(0.5, "#ffffff"); hg.addColorStop(0.53, "rgba(200,245,255,.9)"); hg.addColorStop(0.7, "rgba(51,225,255,.35)"); hg.addColorStop(1, "rgba(51,225,255,0)"); g.fillStyle = hg; g.fillRect(0, 0, 512, 48);
    g.globalCompositeOperation = "destination-in"; var vg = g.createLinearGradient(0, 0, 0, 48); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(0.45, "rgba(0,0,0,.6)"); vg.addColorStop(0.5, "#000"); vg.addColorStop(0.55, "rgba(0,0,0,.6)"); vg.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = vg; g.fillRect(0, 0, 512, 48);
    var FW = W * 1.6, FH = 44 * u, flare = lay(fl.c, FW, FH, cxp - FW / 2, cyp - FH / 2);
    // 镌铬 Logo（高清）+ 青色辉光 + 扫光层
    var fs = 120 * u, lw = 340 * u, lh = 160 * u, lg = cvMk(lw, lh, Math.min(3, window.devicePixelRatio || 1)), gg = cvMk(lw, lh), by0 = lh / 2 + fs * 0.36, font = "900 " + fs + "px 'Helvetica Neue',-apple-system,'Arial Black',Arial,sans-serif";
    g = lg.g; g.font = font; g.textAlign = "center"; g.textBaseline = "alphabetic";
    g.fillStyle = "#05070c"; g.fillText("NBA", lw / 2, by0 + 3 * u);
    var cg = g.createLinearGradient(0, by0 - fs * 0.72, 0, by0); cg.addColorStop(0, "#ffffff"); cg.addColorStop(0.36, "#cfd8e6"); cg.addColorStop(0.49, "#66748c"); cg.addColorStop(0.51, "#273044"); cg.addColorStop(0.72, "#8d9ab2"); cg.addColorStop(1, "#eef3fb");
    g.fillStyle = cg; g.fillText("NBA", lw / 2, by0); g.lineWidth = 1.2 * u; g.strokeStyle = "rgba(160,235,255,.55)"; g.strokeText("NBA", lw / 2, by0);
    gg.g.font = font; gg.g.textAlign = "center"; gg.g.fillStyle = "#33e1ff"; gg.g.fillText("NBA", lw / 2, by0);
    var lx0 = cxp - lw / 2, ly0 = cyp - lh / 2, glow = lay(blurOf(gg, 16).c, lw, lh, lx0, ly0), logo = lay(lg.c, lw, lh, lx0, ly0), swc = cvMk(lw, lh, lg.c.width / lw), sweep = lay(swc.c, lw, lh, lx0, ly0);
    // 粒子目标：从“NBA”字形里取点
    var mw = Math.round(lw), mh = Math.round(lh), mc = cvMk(mw, mh, 1), mg = mc.g; mg.font = font; mg.textAlign = "center"; mg.fillStyle = "#fff"; mg.fillText("NBA", mw / 2, by0);
    var dat = mg.getImageData(0, 0, mw, mh).data, pts = [], step = Math.max(2, Math.round(2.5 * u)); for (var yy = 0; yy < mh; yy += step) for (var xx = 0; xx < mw; xx += step) if (dat[(yy * mw + xx) * 4 + 3] > 128) pts.push([xx - mw / 2, yy - mh / 2]);
    var P = { N: N, sx: new Float32Array(N), sy: new Float32Array(N), bx: new Float32Array(N), by: new Float32Array(N), bz: new Float32Array(N), ol: new Uint8Array(N), lx: new Float32Array(N), ly: new Float32Array(N), d: new Float32Array(N), d2: new Float32Array(N), em: new Uint8Array(N), wh: new Uint8Array(N), px: new Float32Array(N), py: new Float32Array(N) };
    var RB = 72 * u, s48 = Math.sin(0.84), c48 = Math.cos(0.84);
    for (i = 0; i < N; i++) {
      var a = rnd() * Math.PI * 2, r = (260 + rnd() * 320) * u; P.sx[i] = cxp + Math.cos(a) * r; P.sy[i] = cyp + Math.sin(a) * r * 1.25;
      var kind = rnd(), s = rnd() * Math.PI * 2, X, Y, Z;
      if (kind < 0.3) { X = Math.cos(s) * RB; Y = Math.sin(s) * RB; Z = 0; P.ol[i] = 1; }            // 外轮廓（不随球转）
      else if (kind < 0.48) { X = Math.cos(s) * RB; Y = 0; Z = Math.sin(s) * RB; }                  // 横缝
      else if (kind < 0.66) { X = 0; Y = Math.cos(s) * RB; Z = Math.sin(s) * RB; }                  // 竖缝
      else { var sg = rnd() < 0.5 ? -1 : 1; X = sg * c48 * RB; Y = s48 * Math.cos(s) * RB; Z = s48 * Math.sin(s) * RB; } // 两侧弧缝
      P.bx[i] = X; P.by[i] = Y; P.bz[i] = Z;
      P.em[i] = rnd() < 0.14 ? 1 : 0; var q = pts[Math.floor(rnd() * pts.length)] || [0, 0];
      if (P.em[i]) { var ea = rnd() * Math.PI * 2, er = (140 + rnd() * 260) * u; P.lx[i] = Math.cos(ea) * er; P.ly[i] = Math.sin(ea) * er; } else { P.lx[i] = q[0]; P.ly[i] = q[1]; }
      P.d[i] = rnd() * 0.14; P.d2[i] = rnd() * 0.05; P.wh[i] = rnd() < 0.35 ? 1 : 0; P.px[i] = NaN;
    }
    // 速度线
    var SN = 70, S = { a: new Float32Array(SN), r: new Float32Array(SN), v: new Float32Array(SN) }; for (i = 0; i < SN; i++) { S.a[i] = rnd() * Math.PI * 2; S.r[i] = (20 + rnd() * 200) * u; S.v[i] = 0.6 + rnd() * 0.8; }
    // 标题画布（高清，只覆盖 Logo 下方一带）
    var tT = cyp + 30 * u, tH = 170 * u, tc = cvMk(W, tH); tc.c.className = "ld-spr"; tc.c.style.width = W + "px"; tc.c.style.height = tH + "px"; tc.c.style.top = tT + "px"; tc.c.style.left = "0px"; box.appendChild(tc.c);
    LY = { u: u, x: cxp, y: cyp, RB: RB, P: P, S: S, SN: SN, box: box, bloom: bloom, flare: flare, glow: glow, logo: logo, sweep: sweep, sw: swc.g, swD: lg.c.width / lw, lgC: lg.c, lw: lw, lh: lh, tc: tc.g, tT: tT, tH: tH, tx: 1 };
  }
  function render(t) {
    if (!LY) buildLayers();
    var u = LY.u, x = LY.x, y = LY.y, P = LY.P, N = P.N, i, db = t - IN.boom;
    var shk = db > 0 ? 6 * u * Math.exp(-db * 10) * Math.cos(db * 60) : 0;
    sv(LY.box.style, "transform", "translate3d(0," + shk.toFixed(1) + "px,0)");
    var g = cx; g.setTransform(1, 0, 0, 1, 0, shk); g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.clearRect(0, -20, W, H + 40);
    g.globalCompositeOperation = "lighter";
    // 点火：中心光点 → 横向光线
    if (t < 0.55) {
      var ig = eo(t / 0.3), fo = 1 - clamp((t - 0.3) / 0.25), hw = 4 * u + ig * W * 0.55;
      var lgd = g.createLinearGradient(x - hw, 0, x + hw, 0); lgd.addColorStop(0, "rgba(51,225,255,0)"); lgd.addColorStop(0.5, "rgba(225,250,255," + (0.35 + 0.65 * ig) * fo + ")"); lgd.addColorStop(1, "rgba(51,225,255,0)");
      g.fillStyle = lgd; g.fillRect(x - hw, y - 1 * u, hw * 2, 2 * u);
      var cr = (3 + 5 * ig) * u, cgd = g.createRadialGradient(x, y, 0, x, y, cr * 3); cgd.addColorStop(0, "rgba(235,252,255," + (0.5 + 0.5 * ig) * fo + ")"); cgd.addColorStop(1, "rgba(51,225,255,0)"); g.fillStyle = cgd; g.fillRect(x - cr * 3, y - cr * 3, cr * 6, cr * 6);
    }
    // 速度线：镜头高速前冲，0.92 第一下重拍时骤停
    if (t > 0.28 && t < IN.imp) {
      var wk = clamp((t - 0.28) / 0.6), sp = wk * wk, S = LY.S; g.strokeStyle = "rgba(150,225,255," + (0.18 + 0.3 * wk) * clamp((t - 0.28) / 0.1) + ")"; g.lineWidth = 1.2 * u; g.beginPath();
      for (i = 0; i < LY.SN; i++) { var rr = (S.r[i] + (t - 0.28) * (t - 0.28) * 1400 * u * S.v[i]) % (Math.max(W, H) * 0.75), len = (10 + 160 * sp) * u * S.v[i], ca = Math.cos(S.a[i]), sa = Math.sin(S.a[i]); g.moveTo(x + ca * rr, y + sa * rr); g.lineTo(x + ca * (rr + len), y + sa * (rr + len)); }
      g.stroke();
    }
    // 粒子：螺旋汇聚成旋转篮球 → 坍缩成光核 → 爆开拼成“NBA”
    if (t > 0.28 && t < 1.75) {
      var rot = (t - 0.3) * 5.5, cr2 = Math.cos(rot), sr2 = Math.sin(rot), tl = 0.38, ct = Math.cos(tl), stl = Math.sin(tl), im = t > 0.84 ? Math.pow(clamp((t - 0.84) / (IN.imp - 0.84)), 3) : 0, pul = 1 + 0.05 * Math.sin(t * 40) * clamp((t - 0.7) / 0.1);
      var fadeL = 1 - clamp((t - 1.08) / 0.12), fadeE = 1 - clamp((t - 1.1) / 0.6);
      for (var pass = 0; pass < 2; pass++) {
        g.strokeStyle = pass ? "rgba(240,252,255,.95)" : "rgba(51,225,255,.85)"; g.lineWidth = (pass ? 1.3 : 1.6) * u; g.beginPath(); var any = false;
        for (i = 0; i < N; i++) {
          if (P.wh[i] !== pass) continue;
          var X, Y, a = 1;
          if (t < IN.boom) {
            var bx = P.bx[i], by = P.by[i], bz = P.bz[i], zz = 0;
            if (!P.ol[i]) { var x1 = bx * cr2 + bz * sr2, z1 = -bx * sr2 + bz * cr2, y1 = by * ct - z1 * stl; zz = by * stl + z1 * ct; bx = x1; by = y1; }
            var tx = x + bx * pul * (1 - im), ty = y + by * pul * (1 - im), k = eo((t - 0.3 - P.d[i]) / 0.42), sw = (1 - k) * 1.4, dx = P.sx[i] - x, dy = P.sy[i] - y, rx = x + dx * Math.cos(sw) - dy * Math.sin(sw), ry = y + dx * Math.sin(sw) + dy * Math.cos(sw);
            X = rx + (tx - rx) * k; Y = ry + (ty - ry) * k; if (zz < 0) a = 0.45;
            if (t > IN.imp) { X = x; Y = y; }
            if (k <= 0) continue;
          } else {
            var e = P.em[i] ? eo((db - P.d2[i]) / 0.5) : back((db - P.d2[i]) / 0.12);
            X = x + P.lx[i] * e; Y = y + P.ly[i] * e + (P.em[i] ? -db * 30 * u : 0); a = P.em[i] ? fadeE : fadeL; if (a <= 0) continue;
          }
          var ox = P.px[i], oy = P.py[i]; if (ox !== ox || Math.abs(X - ox) + Math.abs(Y - oy) > 260 * u) { ox = X - 1; oy = Y; }
          if (Math.abs(X - ox) + Math.abs(Y - oy) < 1) ox = X - 1;
          P.px[i] = X; P.py[i] = Y;
          if (a < 0.6) continue; // 背面/淡出的少画，省一次描边
          g.moveTo(ox, oy); g.lineTo(X, Y); any = true;
        }
        if (any) g.stroke();
      }
      if (t > 1.08 && t < 1.75) { // 淡出阶段的粒子：统一降透明度再画一遍太贵，直接用整体透明度画一次
        var fa = Math.max(fadeL, fadeE * 0.8); if (fa > 0.02 && fa < 0.6) { g.globalAlpha = fa / 0.6; g.strokeStyle = "rgba(120,230,255,.8)"; g.lineWidth = 1.3 * u; g.beginPath(); for (i = 0; i < N; i++) { if (!P.em[i] && fadeL <= 0) continue; g.moveTo(P.px[i] - 1, P.py[i]); g.lineTo(P.px[i], P.py[i]); } g.stroke(); g.globalAlpha = 1; }
      }
    }
    // 光核（坍缩后屏息 0.92–1.0）
    if (t > 0.86 && t < IN.boom + 0.05) { var cc = clamp((t - 0.86) / 0.06), cR = (6 + 10 * cc + 3 * Math.sin(t * 90)) * u * (t > IN.boom ? 1 + db * 30 : 1), cgr = g.createRadialGradient(x, y, 0, x, y, cR * 2.5); cgr.addColorStop(0, "rgba(255,255,255," + cc + ")"); cgr.addColorStop(0.35, "rgba(120,235,255," + 0.7 * cc + ")"); cgr.addColorStop(1, "rgba(51,225,255,0)"); g.fillStyle = cgr; g.fillRect(x - cR * 2.5, y - cR * 2.5, cR * 5, cR * 5); }
    // 冲击环
    if (db > 0 && db < 0.5) { var w = eo(db / 0.5); g.globalAlpha = 0.8 * (1 - db / 0.5); g.strokeStyle = "#7fe9ff"; g.lineWidth = 2.2 * u * (1 - w) + 0.6; g.beginPath(); g.arc(x, y, 20 * u + w * 300 * u, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1; }
    g.globalCompositeOperation = "source-over";
    // 光晕、横向光线（DOM 图层）
    st(LY.bloom, "scale(" + (db > 0 ? (0.35 + 1.1 * eo(db / 0.3)).toFixed(3) : "0.3") + ")", db > 0 ? Math.exp(-db * 4.5) : 0);
    st(LY.flare, "scale(" + (db > 0 ? (0.25 + 0.95 * exo(db / 0.25)).toFixed(3) : "0.25") + ",1)", db > 0 ? 0.25 + 0.75 * Math.exp(-db * 3.5) : 0);
    // 镌铬 Logo：粒子拼好后接替，回弹定位，高光扫过
    var la = clamp((db - 0.05) / 0.08), sc = db > 0 ? 1.07 - 0.07 * eo(db / 0.2) + 0.03 * eio((db - 0.2) / 1.0) : 1;
    var sp2 = clamp((t - 1.18) / 0.45), on = sp2 > 0 && sp2 < 1, lw = LY.lw, lh = LY.lh;
    if (on) { var sw2 = LY.sw; sw2.setTransform(LY.swD, 0, 0, LY.swD, 0, 0); sw2.globalCompositeOperation = "source-over"; sw2.clearRect(0, 0, lw, lh); sw2.drawImage(LY.lgC, 0, 0, lw, lh); sw2.globalCompositeOperation = "source-atop"; var sx = -60 * u + eio(sp2) * (lw + 120 * u), sgd = sw2.createLinearGradient(sx - 40 * u, 0, sx + 40 * u, 0); sgd.addColorStop(0, "rgba(255,255,255,0)"); sgd.addColorStop(0.5, "rgba(255,255,255,.9)"); sgd.addColorStop(1, "rgba(255,255,255,0)"); sw2.fillStyle = sgd; sw2.save(); sw2.transform(1, 0, -0.35, 1, 0.35 * lh / 2, 0); sw2.fillRect(sx - 40 * u, 0, 80 * u, lh); sw2.restore(); }
    var tfl = "scale(" + sc.toFixed(4) + ")";
    st(LY.logo, tfl, on ? 0 : la); st(LY.sweep, tfl, on ? la : 0); st(LY.glow, "scale(" + (sc * 1.05).toFixed(4) + ")", db > 0 ? la * (0.2 + 0.75 * Math.exp(-db * 4)) : 0);
    // 标题排版
    var tx2 = t > IN.hold - 0.02 || Math.abs(t - 1.95) < 0.17; if (!tx2 && !LY.tx) return; LY.tx = tx2;
    var c2 = LY.tc, tT = LY.tT; c2.setTransform(DPR, 0, 0, DPR, 0, -tT * DPR); c2.globalAlpha = 1; c2.globalCompositeOperation = "source-over"; c2.clearRect(0, tT, W, LY.tH);
    var bw = exo((t - IN.hold) / 0.3);
    if (bw > 0) {
      var barY = y + 58 * u, hw2 = 92 * u * bw, bgc = c2.createLinearGradient(x - hw2, 0, x + hw2, 0); bgc.addColorStop(0, "rgba(51,225,255,0)"); bgc.addColorStop(0.2, "#33e1ff"); bgc.addColorStop(0.8, "#33e1ff"); bgc.addColorStop(1, "rgba(51,225,255,0)");
      c2.fillStyle = bgc; c2.fillRect(x - hw2, barY - 1.25 * u, hw2 * 2, 2.5 * u);
      var tr = eo((t - IN.hold - 0.06) / 0.38);
      if (tr > 0) { var chs = "智能预测".split(""), fz = 30 * u, gap = 6 * u + 22 * u * (1 - tr), ty2 = barY + 30 * u + 26 * u * (1 - tr); c2.save(); c2.beginPath(); c2.rect(0, barY + 2 * u, W, 60 * u); c2.clip(); c2.font = "800 " + fz + "px -apple-system,'PingFang SC','Noto Sans CJK SC',sans-serif"; c2.textBaseline = "middle"; c2.textAlign = "center"; c2.globalAlpha = tr; c2.fillStyle = "#eef4ff"; var tot = chs.length * fz + (chs.length - 1) * gap; chs.forEach(function (ch, j) { c2.fillText(ch, x - tot / 2 + fz / 2 + j * (fz + gap), ty2); }); c2.restore(); }
      var sa = eo((t - 1.72) / 0.3);
      if (sa > 0) { var sub = "赛前预测 · 实时比分".split(""), f2 = 12.5 * u, sy = barY + 70 * u; c2.font = "600 " + f2 + "px -apple-system,'PingFang SC','Noto Sans CJK SC',sans-serif"; c2.textBaseline = "middle"; c2.textAlign = "left"; c2.globalAlpha = sa; c2.fillStyle = "#8fa3c4"; var spc = 3 * u, ws = sub.map(function (ch) { return c2.measureText(ch).width; }), tw = ws.reduce(function (p1, p2) { return p1 + p2; }, 0) + spc * (sub.length - 1), sx2 = x - tw / 2; sub.forEach(function (ch, j) { c2.fillText(ch, sx2, sy); sx2 += ws[j] + spc; }); c2.globalAlpha = 1; }
    }
    var gt = 1 - Math.abs(t - 1.95) / 0.16;
    if (gt > 0) { var gx = x + 118 * u * sc, gy = y - 40 * u * sc; cx.globalCompositeOperation = "lighter"; cx.globalAlpha = gt; [[1, 0, 38], [0, 1, 22]].forEach(function (v) { var L2 = v[2] * u, g2 = cx.createLinearGradient(gx - v[0] * L2, gy - v[1] * L2, gx + v[0] * L2, gy + v[1] * L2); g2.addColorStop(0, "rgba(180,240,255,0)"); g2.addColorStop(0.5, "rgba(235,252,255,1)"); g2.addColorStop(1, "rgba(180,240,255,0)"); cx.fillStyle = g2; if (v[0]) cx.fillRect(gx - L2, gy - 0.8 * u, L2 * 2, 1.6 * u); else cx.fillRect(gx - 0.8 * u, gy - L2, 1.6 * u, L2 * 2); }); cx.globalCompositeOperation = "source-over"; cx.globalAlpha = 1; }
  }
  function firstFrame() { if (!cx) return; sizeCv(); render(0); }
  window.__introAt = function (t) { if (cx) { if (LY) for (var i = 0; i < LY.P.N; i++) LY.P.px[i] = NaN; render(Math.max(0, t - 0.017)); render(t); } };
  function playIntro(done) {
    if (!cx) return done();
    if (!LY) buildLayers();
    var t0 = performance.now() + 30, last = performance.now(), fr = [];
    window.__intro = { frames: fr, start: Date.now() };
    function frame(now) {
      fr.push(now - last); last = now; var t = Math.max(0, (now - t0) / 1000);
      if (IN.skip || t * 1000 >= IN.T) { done(); return; }
      render(t); requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  function finishLoader() { if (state.ldOut) return; state.ldOut = true; var L = $("loader"); L.classList.add("done"); revealCards(); if (window.__intro) window.__intro.end = Date.now(); }
  function startIntro(quiet) {
    if (state.tapped) { if (!quiet && !state.ldOut) { IN.skip = true; finishLoader(); } return; } // 再点一下：跳过
    state.tapped = true; loaderStart = Date.now();
    if (!quiet) { $("loader").classList.add("go"); introSound(); playIntro(function () { state.animDone = true; if (state.dataReady || state.loadFailed === undefined) finishLoader(); }); }
    else state.animDone = true;
    if (state.dataReady && quiet) finishLoader();
    setTimeout(function () { if (!state.loadFailed) finishLoader(); }, quiet ? 0 : IN.T + 50); // 最长 2.2 秒一定进入首页（数据没到就先显示加载中）
  }
  function hideLoader() { state.dataReady = true; if (state.tapped && state.animDone) finishLoader(); }
  (function () {
    var L = $("loader"); if (!L) return;
    firstFrame(); window.addEventListener("resize", function () { if (!state.tapped) firstFrame(); });
    var go = function (e) { if (e && e.cancelable && e.type === "touchend") e.preventDefault(); startIntro(false); };
    L.addEventListener("click", go); L.addEventListener("touchend", go);
    var rl = null; try { rl = sessionStorage.getItem("nba_reload"); } catch (e) {}
    if (rl) startIntro(true); // 自动更新新版后：不再要求点击，直接回到原来的页面
  })();
  function revealCards() {
    var cards = document.querySelectorAll(".card");
    if (!("IntersectionObserver" in window)) { cards.forEach(function (c) { c.classList.add("in"); }); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); animateIn(e.target); } });
    }, { threshold: 0.12 });
    cards.forEach(function (c) { io.observe(c); });
  }
  function animateIn(card) {
    runRolls(card);
    card.querySelectorAll("[data-w]").forEach(function (el) { el.style.width = el.getAttribute("data-w"); });
    card.querySelectorAll("[data-left]").forEach(function (el) { el.style.left = el.getAttribute("data-left"); });
    var beam = card.querySelector(".beam");
    if (beam) setTimeout(function () { beam.style.transform = "rotate(" + beam.getAttribute("data-deg") + "deg)"; }, 250);
  }

  /* ---------- 渲染 ---------- */
  var TEAM_CN = { ATL: "老鹰", BOS: "凯尔特人", BKN: "篮网", CHA: "黄蜂", CHI: "公牛", CLE: "骑士", DAL: "独行侠", DEN: "掘金", DET: "活塞", GSW: "勇士", HOU: "火箭", IND: "步行者", LAC: "快船", LAL: "湖人", MEM: "灰熊", MIA: "热火", MIL: "雄鹿", MIN: "森林狼", NOP: "鹈鹕", NYK: "尼克斯", OKC: "雷霆", ORL: "魔术", PHI: "76人", PHX: "太阳", POR: "开拓者", SAC: "国王", SAS: "马刺", TOR: "猛龙", UTA: "爵士", WAS: "奇才" };
  /* ---------- 第八版让分早锁（有就以它为让分主结论） ---------- */
  function v8For(g) {
    var d = state.data || {}, v = ((d.v8 || {}).by_id || {})[String(g.espn_id)];
    return v && (!v.home || v.home === g.home) ? v : null;
  }
  function mainSpread(g) {
    var v = v8For(g);
    if (!v) return g.spread || null;
    return { v8: true, pick_team: v.pick_team, pick_cn: v.pick_cn, pick_text: v.pick_text, line_home: v.cur_home, band_cn: v.band_cn, edge: v.edge,
      model_label: "第八版早锁", lock_time: v.lock_time, line_source: "第八版锁定时的 DraftKings 盘口" };
  }
  function m9aText(v) {
    if (!v.m9a) return "第九版候选 M9a：这场没有给方向";
    return "第九版候选 M9a：" + (v.m9a.same ? "和第八版同向" : "方向相反，看好" + v.m9a.team_cn) + (v.m9a.high ? "（高把握）" : "");
  }
  function v8Block(g) {
    var v = v8For(g), home = v.pick_team === g.home;
    var mv = v.moved ? "（开盘后已往" + (v.moved > 0 ? g.home_cn : g.away_cn) + "一侧走了 " + num(Math.abs(v.moved), 1) + " 分）" : "";
    var dir = v.pred_home != null && v.open_home != null && v.pred_home !== v.open_home ? "第八版预测盘口还会往" + (v.pred_home > v.open_home ? g.home_cn : g.away_cn) + "这边走" + (v.edge != null ? " 约 " + num(v.edge, 1) + " 分" : "") + "，所以开盘后早早锁定。" : "";
    return '<div class="vd v8"><div class="k">让分方向 · 第八版早锁 <span class="v8tag">实盘验证中</span></div>' +
      '<div class="pick ' + (home ? "blue" : "red") + '">' + roll(v.pick_text) + "</div>" +
      '<div class="row">' + bandPill(v.band_cn) + "<span>" + (v.lock_time ? esc(String(v.lock_time).slice(5, 16)) + " 锁定" : "") + "</span></div>" +
      '<p class="note">开盘线 ' + esc(hcText(g, v.open_home) || "暂无") + "，锁定时 " + esc(hcText(g, v.cur_home) || "暂无") + mv + "。" + esc(dir) + "</p>" +
      '<p class="note">' + esc(m9aText(v)) + "</p></div>";
  }

  // 当天全部比赛：有 ESPN 赛程时用赛程（含模型没预测的场次），进行中的置顶；否则只用 data.json 里的场次
  function allGames() {
    var d = state.data || {}, mg = d.games || [], evs = (window.LIVE && LIVE.events) || [];
    if (!evs.length) return mg;
    var list = evs.map(function (s) {
      var g = mg.filter(function (x) { return x.espn_id === s.id || (x.away === s.aab && x.home === s.hab); })[0];
      return g || { espn_id: s.id, away: s.aab, home: s.hab, away_cn: TEAM_CN[s.aab] || s.aab, home_cn: TEAM_CN[s.hab] || s.hab, nomodel: true, records: {}, tip_pt: s.tip, injuries: {} };
    });
    var rank = function (g) { var s = window.liveFor && liveFor(g); return !s ? 1 : s.state === "in" ? 0 : s.state === "pre" ? 1 : 2; };
    return list.map(function (g, i) { return [g, i]; }).sort(function (x, y) { return rank(x[0]) - rank(y[0]) || x[1] - y[1]; }).map(function (x) { return x[0]; });
  }
  function game() {
    var gs = allGames(), id = state.sel;
    return gs.filter(function (g) { return g.espn_id === id; })[0] || gs[0];
  }
  function keepScroll(fn) {
    var y = window.scrollY; fn();
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
  }
  function renderAll(first) { keepScroll(function () { renderAll0(first); }); }
  function renderAll0(first) {
    var d = state.data;
    safe("日期栏", function () { renderDateBar(); }, "dateBar");
    safe("当日比赛", function () { if (dayState.sel && dayState.sel !== dayState.today && dayState.cache[dayState.sel]) drawDay(dayState.sel, dayState.iso, dayState.cache[dayState.sel].events); }, "dayView");
    safe("更新时间", function () {
    $("genAt").textContent = "更新于 " + String(d.generated_at || "").slice(11, 16) + " · 最新锁定 " + (d.last_lock ? String(d.last_lock).slice(11, 16) : "暂无");
    $("footGen").textContent = "数据更新于 " + String(d.generated_at || "").slice(0, 16) + "（太平洋时间）";
    });
    safe("选场", function () { if (!state.sel || !allGames().some(function (g) { return g.espn_id === state.sel; })) state.sel = d.featured || ((d.games || [])[0] || {}).espn_id; });
    safe("比赛标签", function () { renderTabs(); }, "gameTabs"); safe("本场", function () { renderGame(); }, "hero");
    safe("动态", function () { renderFeed(); }, "feed"); safe("历史", function () { renderHist(); }, "hist"); safe("缺数据", function () { renderMissing(); }, "missing");
    if (!first) document.querySelectorAll(".card.in").forEach(animateIn);
    state.booted = true;
  }
  function renderTabs() {
    var d = state.data, gs = allGames(), full = gs !== d.games;
    if (state.want && gs.some(function (g) { return g.espn_id === state.want; })) { // 恢复上次选中的比赛
      var ch = state.sel !== state.want; state.sel = state.want; state.want = null;
      if (ch && state.booted) setTimeout(function () { keepScroll(function () { renderGame(); paintLive(false); }); if (window.PBP) window.PBP.kick(); }, 0);
    }
    $("gameTabs").innerHTML = gs.map(function (g) {
      var ms = mainSpread(g), p = ms && ms.v8 ? "第八版：" + ms.pick_text : g.nomodel ? "本场模型未预测" : ms ? "模型：" + ms.pick_text : "暂无结论";
      return '<button class="tab' + (g.espn_id === state.sel ? " on" : "") + '" data-id="' + esc(g.espn_id) + '"><b>' + esc(g.away_cn) + " @ " + esc(g.home_cn) +
        "</b><span class=\"lvtab\" data-lvtab=\"" + esc(g.espn_id) + "\">" + esc(String(g.tip_pt || "时间待定").replace(/ PT$/, "")) + "</span><span>" + esc(p) + "</span></button>";
    }).join("") + (!full && (d.unlocked_games || []).length ? '<button class="tab" disabled><b class="dim">另 ' + d.unlocked_games.length + ' 场</b><span>锁定时已开赛，无模型结论</span></button>' : "");
    setTimeout(function () { paintLive(false); }, 0);
    $("gameTabs").querySelectorAll(".tab[data-id]").forEach(function (b) {
      b.onclick = function () {
        var sl = $("gameTabs").scrollLeft;
        state.sel = b.getAttribute("data-id"); state.want = null; try { localStorage.setItem("nba_sel", state.sel); } catch (e) {} renderTabs(); renderGame(); paintLive(false); $("gameTabs").scrollLeft = sl; if (window.PBP) window.PBP.kick();
        document.querySelectorAll(".card.in").forEach(animateIn);
      };
    });
  }
  // 每个板块单独保护：某块出错只在那块显示“暂时无法显示”，不挡整页
  function safe(name, fn, elId) {
    try { return fn(); } catch (e) {
      try { console.error("[板块出错] " + name, e); } catch (x) {}
      var el = elId && document.getElementById(elId);
      if (el) { el.innerHTML = '<p class="note">暂时无法显示</p>'; el._h = null; }
    }
  }
  function renderGame() {
    var g = game(); if (!g) { $("hero").innerHTML = "<p>今天还没有锁定的比赛。</p>"; return; }
    if (g.nomodel) {
      safe("对阵", function () { renderHeroNoModel(g); }, "hero"); safe("雷速按钮", function () { renderLeisu(g); });
      safe("球场", function () { drawCourtSetup(g); courtBarIdle(g); });
      if (v8For(g)) safe("盘口移动", function () { renderScale(g); }, "scale");
      ["scale", "odds", "edge", "factors", "inj"].filter(function (k) { return !(k === "scale" && v8For(g)); }).forEach(function (k) { var el = $(k); if (el) el.innerHTML = '<p class="note">本场模型未预测，只显示比分和直播。</p>'; });
      return;
    }
    safe("对阵", function () { renderHero(g); }, "hero"); safe("雷速按钮", function () { renderLeisu(g); });
    safe("球场", function () { drawCourtSetup(g); courtBarIdle(g); });
    safe("盘口移动", function () { renderScale(g); }, "scale"); safe("盘口", function () { renderOdds(g); }, "odds");
    safe("优势", function () { renderEdge(g); }, "edge"); safe("因素", function () { renderFactors(g); }, "factors"); safe("伤病", function () { renderInj(g); }, "inj");
  }
  function renderHeroNoModel(g) {
    var h = '<div class="vs"><div class="team h"><div class="ab">主场</div><div class="nm">' + esc(g.home_cn) + '</div></div>';
    h += '<div class="mid lvmid" data-lvmid="' + esc(g.espn_id) + '"><b>VS</b>' + esc(g.tip_pt || "") + "</div>";
    h += '<div class="team a"><div class="ab">客场</div><div class="nm">' + esc(g.away_cn) + "</div></div></div>";
    h += '<div class="lvx" data-lvx="' + esc(g.espn_id) + '"></div>';
    h += '<div class="lsslot" data-lsslot></div>';
    if (v8For(g)) h += '<div class="verdicts">' + v8Block(g) + '</div><p class="note">其他模型没有预测这场，只有第八版早锁。</p><p class="note lvwarn" id="lvWarn"></p>';
    else h += '<div class="nomodel">本场模型未预测</div><p class="note lvwarn" id="lvWarn"></p>';
    $("hero").innerHTML = h; paintLive(false);
  }
  function renderHero(g) {
    var d = state.data, mv = d.model_version || {}, sp = g.spread, to = g.total, h = "";
    h += '<div class="vs"><div class="team h"><div class="ab">主场</div><div class="nm">' + esc(g.home_cn) + '</div><div class="ab">' + esc(g.records[g.home] || "") + "</div></div>";
    h += '<div class="mid lvmid" data-lvmid="' + esc(g.espn_id) + '"><b>VS</b>' + esc(String(g.tip_pt || "时间待定").replace(/ PT$/, "")) + "</div>";
    h += '<div class="team a"><div class="ab">客场</div><div class="nm">' + esc(g.away_cn) + '</div><div class="ab">' + esc(g.records[g.away] || "") + "</div></div></div>";
    h += '<div class="lvx" data-lvx="' + esc(g.espn_id) + '"></div>';
    h += '<div class="lsslot" data-lsslot></div>';
    h += '<div class="verdicts">';
    var v8 = v8For(g);
    if (v8) {
      h += v8Block(g);
    } else if (sp) {
      h += '<div class="vd"><div class="k">让分方向</div><div class="pick ' + (sp.pick_team === g.home ? "blue" : "red") + '">' + roll(sp.pick_text) + "</div>" +
        '<div class="row">' + bandPill(sp.band_cn) + "<span>盘口线 " + esc(hcText(g, sp.line_home)) + "（" + esc(sp.line_source) + "）</span></div>" +
        '<p class="note">模型算 ' + esc(winText(g, sp.pred_home_margin)) + "，盘口是 " + esc(hcText(g, sp.line_home)) + " → 站" + esc(sp.pick_cn) + "，差 " + esc(num(sp.edge, 2)) + " 分。</p></div>";
    } else h += '<div class="vd"><div class="k">让分方向</div><div class="pick">' + miss() + "</div></div>";
    if (to) {
      h += '<div class="vd"><div class="k">大小分方向</div><div class="pick">' + roll(to.pick_text) + "</div>" +
        '<div class="row">' + bandPill(to.band_cn) + "<span>" + esc(to.line_source) + "</span></div>" +
        '<p class="note">模型算总分 ' + esc(num(to.pred_total, 2)) + "，盘口 " + esc(num(to.line_total, 1)) + " → " + esc(to.pick_cn) + "，差 " + esc(num(to.edge, 2)) + " 分。</p></div>";
    } else h += '<div class="vd"><div class="k">大小分方向</div><div class="pick">' + miss() + "</div></div>";
    h += "</div>";
    var rs = g.version_record || {}, rt = g.version_record_total || {};
    function rec(r) { return r && r.graded ? (r.w + "胜 " + r.l + "负 " + r.p + "走（" + (r.pct == null ? "—" : r.pct + "%") + "）") : '<span class="miss">暂无</span>（比赛结束后才有）'; }
    var lbl = sp ? sp.model_label : (g.version_cn || "暂无");
    if (v8) h += '<div class="ver">让分以第八版早锁为准（实盘验证中，成绩见下方成绩板）' + (sp && sp.pick_text ? "。参考：" + esc(lbl) + " → " + esc(sp.pick_text) + "（把握度 " + esc(sp.band_cn) + "）" : "") + "<br>";
    else h += '<div class="ver">';
    h += (v8 ? "大小分用：" : "当前用：") + '<b>' + esc(v8 && to ? to.model_label : lbl) + "</b>" + (to && to.model_label !== lbl ? "（大小分用 " + esc(to.model_label) + "）" : "") + (sp && sp.lock_time ? " · " + esc(String(sp.lock_time).slice(11, 16)) + " 锁定" : "") +
      "<br>这一版的实际战绩：让分 " + rec(rs) + " · 大小分 " + rec(rt);
    if (mv.version && g.version !== mv.version) h += '<div class="warn">' + esc(mv.version_cn) + "没有锁定这场（可能锁定时已开赛），结论沿用" + esc(g.version_cn) + "。</div>";
    if (g.alt_pick) h += '<br><span class="dim">参考：' + esc(g.alt_pick.label) + " → " + esc(g.alt_pick.pick_text) + "（把握度 " + esc(g.alt_pick.band_cn) + "）</span>";
    if (g.market && g.market.median_text && sp && g.market.median_home !== sp.line_home) h += '<div class="warn">多家中位数是 ' + esc(g.market.median_text) + "，和结论用的 DraftKings 线不同，下注前以你在皇冠看到的线为准。</div>";
    h += "</div>";
    h += '<p class="note lvwarn" id="lvWarn"></p>';
    $("hero").innerHTML = h;
    runRolls($("hero"));
    paintLive(false);
  }

  /* ---------- 雷速动画直播（iframe 嵌入雷速自己的页面，不搬运数据） ---------- */
  var leisuIds = {};
  function loadLeisu() {
    return fetch("leisu_ids.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { leisuIds = (j && j.games) || j || {}; }).catch(function () { leisuIds = {}; });
  }
  function leisuId(g) {
    var keys = [String(g.espn_id), g.away_cn + "@" + g.home_cn, g.away + "@" + g.home, g.away_cn + " @ " + g.home_cn, g.away + " @ " + g.home];
    for (var i = 0; i < keys.length; i++) { var v = leisuIds[keys[i]]; if (v && /^\d+$/.test(String(v))) return String(v); }
    return null;
  }
  // 只放一个小按钮（不嵌入雷速页面）
  function renderLeisu(g) {
    var slot = document.querySelector("[data-lsslot]"); if (!slot) return;
    var id = leisuId(g);
    var html = id ? '<a class="lsbtn" href="https://m.leisu.com/live/lanqiu/detail-' + id + '" target="_blank" rel="noopener">在雷速打开动画直播 ↗</a>' : '<span class="lsbtn off">雷速暂无</span>';
    if (slot._h !== html) { slot._h = html; slot.innerHTML = html; }
  }

  /* ---------- 全息球场 ---------- */
  var court = { g: null, raf: 0 };
  function drawCourtSetup(g) { court.g = g; if (!court.raf) court.raf = requestAnimationFrame(drawCourt); }
  function drawCourt(ts) {
    court.raf = requestAnimationFrame(drawCourt);
    var c = $("court"); if (!c || !court.g) return;
    var rect = c.getBoundingClientRect(); if (rect.bottom < 0 || rect.top > innerHeight) return; // 不在屏幕内就不画
    var x = c.getContext("2d"), W = c.width, H = c.height, g = court.g, t = ts / 1000;
    var MS = mainSpread(g), pickHome = MS && MS.pick_team === g.home, pickAway = MS && MS.pick_team === g.away;
    x.clearRect(0, 0, W, H);
    var m = 24, cw = W - 2 * m, ch = H - 2 * m;
    // 两半场底色
    var gl = x.createLinearGradient(m, 0, W - m, 0);
    gl.addColorStop(0, "rgba(47,123,255,.28)"); gl.addColorStop(.5, "rgba(10,16,32,.2)"); gl.addColorStop(1, "rgba(255,59,92,.26)");
    x.fillStyle = "#050a18"; x.fillRect(0, 0, W, H); x.fillStyle = gl; x.fillRect(m, m, cw, ch);
    // 网格
    x.strokeStyle = "rgba(51,225,255,.06)"; x.lineWidth = 1;
    for (var gx = m; gx < W - m; gx += 24) { x.beginPath(); x.moveTo(gx, m); x.lineTo(gx, H - m); x.stroke(); }
    for (var gy = m; gy < H - m; gy += 24) { x.beginPath(); x.moveTo(m, gy); x.lineTo(W - m, gy); x.stroke(); }
    // 球场线
    x.shadowColor = "#33e1ff"; x.shadowBlur = 12; x.strokeStyle = "rgba(120,235,255,.9)"; x.lineWidth = 2;
    x.strokeRect(m, m, cw, ch);
    x.beginPath(); x.moveTo(W / 2, m); x.lineTo(W / 2, H - m); x.stroke();
    x.beginPath(); x.arc(W / 2, H / 2, 46, 0, Math.PI * 2); x.stroke();
    var kw = cw * 0.2, kh = ch * 0.38;
    [[m, 1], [W - m, -1]].forEach(function (s) {
      var bx = s[0], dir = s[1];
      x.strokeRect(dir > 0 ? bx : bx - kw, H / 2 - kh / 2, kw, kh);
      x.beginPath(); x.arc(bx + dir * kw, H / 2, kh / 2, -Math.PI / 2, Math.PI / 2, dir < 0); x.stroke();
      x.beginPath(); x.moveTo(bx, m + ch * 0.06); x.lineTo(bx + dir * cw * 0.12, m + ch * 0.06);
      x.arc(bx + dir * cw * 0.05, H / 2, ch * 0.44, dir > 0 ? -1.2 : Math.PI + 1.2, dir > 0 ? 1.2 : Math.PI - 1.2, dir < 0);
      x.lineTo(bx, H - m - ch * 0.06); x.stroke();
      x.beginPath(); x.arc(bx + dir * 18, H / 2, 6, 0, Math.PI * 2); x.stroke();
    });
    x.shadowBlur = 0;
    // 选中方向的发光
    var pulse = .5 + .5 * Math.sin(t * 3);
    function glow(cx, col) {
      var rg = x.createRadialGradient(cx, H / 2, 10, cx, H / 2, cw * 0.32);
      rg.addColorStop(0, col.replace("A", (0.35 + 0.25 * pulse).toFixed(2))); rg.addColorStop(1, col.replace("A", "0"));
      x.fillStyle = rg; x.fillRect(m, m, cw, ch);
    }
    var liveOn = window.PBP && window.PBP.isOn && window.PBP.isOn(g);
    if (pickHome && !liveOn) glow(m + cw * 0.25, "rgba(47,123,255,A)");
    if (pickAway && !liveOn) glow(m + cw * 0.75, "rgba(255,59,92,A)");
    // 扫描线
    var sx = m + ((t * 160) % cw);
    var sg = x.createLinearGradient(sx - 60, 0, sx, 0); sg.addColorStop(0, "rgba(51,225,255,0)"); sg.addColorStop(1, "rgba(51,225,255,.25)");
    x.fillStyle = sg; x.fillRect(Math.max(m, sx - 60), m, Math.min(60, sx - m), ch);
    // 队名
    x.textAlign = "center";
    function team(cx, nm, ab, rec, col, picked) {
      if (liveOn) return; // 直播时把球场让给动画
      x.shadowColor = col; x.shadowBlur = picked ? 26 : 10; x.fillStyle = "#fff";
      x.font = "900 56px -apple-system,'PingFang SC','Microsoft YaHei',sans-serif"; x.fillText(nm, cx, H / 2 + 8);
      x.shadowBlur = 0; x.fillStyle = col; x.font = "700 18px -apple-system,'PingFang SC','Microsoft YaHei',sans-serif"; x.fillText(ab + (rec ? "  " + rec : ""), cx, H / 2 + 40);
      if (picked) { x.fillStyle = "#2fe39a"; x.font = "800 20px -apple-system,'PingFang SC',sans-serif"; x.fillText("▼ 模型站这边", cx, H / 2 - 52 - 4 * pulse); }
    }
    team(m + cw * 0.25, g.home_cn, "主场", g.records[g.home], "#5aa2ff", pickHome);
    team(m + cw * 0.75, g.away_cn, "客场", g.records[g.away], "#ff6b84", pickAway);
    x.fillStyle = "rgba(233,238,252,.75)"; x.font = "600 15px -apple-system,'PingFang SC',sans-serif";
    courtBarIdle(g);
    if (window.PBP && window.PBP.draw) window.PBP.draw(x, m, cw, ch, W, H, t, g);
  }

  /* ---------- 球场下方大字 ---------- */
  function setBar(act, sub, alert) {
    var a1 = $("cbAct"), s1 = $("cbSub"); if (!a1) return;
    if (a1.classList.contains("alert") !== !!alert) a1.classList.toggle("alert", !!alert);
    if (a1.textContent !== act) { a1.textContent = act; fitBar(a1); }
    if (s1.textContent !== sub) s1.textContent = sub;
  }
  // 动作大字：固定两行高度，放不下就自动缩小字号，保证完整显示且不跳
  function fitBar(el) {
    var fs = 18; el.style.fontSize = fs + "px";
    while (el.scrollHeight > el.clientHeight + 1 && fs > 11) { fs -= 1; el.style.fontSize = fs + "px"; }
  }
  window.addEventListener("resize", function () { var e = $("cbAct"); if (e) fitBar(e); });
  function preSentence(g) {
    var v = v8For(g);
    if (v) return "第八版早锁看好" + v.pick_cn + "（" + v.pick_text + "），把握度" + v.band_cn + "；开盘 " + (hcText(g, v.open_home) || "暂无") + "，锁定时 " + (hcText(g, v.cur_home) || "暂无") + "。" + m9aText(v).replace("第九版候选 ", "");
    if (g.nomodel) return "本场模型未预测";
    var sp = g.spread; if (!sp || sp.pred_home_margin == null || sp.line_home == null) return "暂无模型结论";
    var pm = sp.pred_home_margin, lh = sp.line_home;
    var win = pm > 0 ? g.home_cn : g.away_cn, fav = lh > 0 ? g.home_cn : g.away_cn, L = num(Math.abs(lh), 1), pick = sp.pick_team === g.home ? g.home_cn : g.away_cn;
    var s = "模型看好" + win + "赢 " + num(Math.abs(pm), 2) + " 分，";
    if (lh === 0) return s + "盘口平手，模型认为" + pick + "能赢盘";
    s += "盘口" + fav + "让 " + L + " 分，";
    return s + (pick === fav ? "模型认为" + fav + "能赢盘（赢超过 " + L + " 分）" : "模型认为" + pick + "受让能赢盘（" + fav + "赢不到 " + L + " 分）");
  }
  function scoreLine(g, s) {
    if (!s) return "";
    if (s.state === "pre") return s.tip + " 开赛（太平洋时间）";
    return statusCn(s) + " · " + g.away_cn + " " + s.as + " : " + s.hs + " " + g.home_cn;
  }
  function courtBarIdle(g) {
    if (window.PBP && window.PBP.isOn && window.PBP.isOn(g)) return; // 直播时由动画接管
    var s = liveFor(g);
    if (!s || s.state === "pre") setBar(preSentence(g), s ? scoreLine(g, s) : String(g.tip_pt || "").replace(/ PT$/, ""));
    else if (s.state === "post") setBar("终场 " + (s.as > s.hs ? g.away_cn + " " + s.as + ":" + s.hs + " " + g.home_cn : g.home_cn + " " + s.hs + ":" + s.as + " " + g.away_cn), scoreLine(g, s));
    else if (s.name === "STATUS_END_PERIOD" || s.name === "STATUS_HALFTIME") setBar(statusCn(s), scoreLine(g, s));
    else setBar("直播数据读取中…", scoreLine(g, s));
  }
  window.NBA_BAR = { set: setBar, scoreLine: scoreLine };

  /* ---------- 天平 ---------- */
  function renderScale(g) {
    var sp = mainSpread(g);
    if (!sp || sp.edge == null) { $("scale").innerHTML = "<p>暂无模型结论</p>"; return; }
    var a = Math.min(Math.abs(sp.edge) / 4, 1) * 16 + 2, home = sp.pick_team === g.home, deg = home ? -a : a;
    var lvl = Math.abs(sp.edge) >= 3 ? "明显倾向" : Math.abs(sp.edge) >= 1.5 ? "中等倾向" : "轻微倾向";
    $("scale").innerHTML =
      '<svg viewBox="0 0 400 230" role="img" aria-label="天平倾向' + esc(sp.pick_cn) + '">' +
      '<defs><filter id="gl"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' +
      '<polygon points="200,70 170,210 230,210" fill="#131b31" stroke="#33e1ff" stroke-width="2" filter="url(#gl)"/>' +
      '<rect x="140" y="208" width="120" height="8" rx="4" fill="#33e1ff" filter="url(#gl)"/>' +
      '<g class="beam" data-deg="' + deg.toFixed(1) + '">' +
      '<rect x="50" y="66" width="300" height="8" rx="4" fill="#9fdcff" filter="url(#gl)"/>' +
      '<circle cx="200" cy="70" r="9" fill="#2fe39a" filter="url(#gl)"/>' +
      '<g><line x1="70" y1="74" x2="45" y2="140" stroke="#5aa2ff"/><line x1="70" y1="74" x2="95" y2="140" stroke="#5aa2ff"/>' +
      '<path d="M35 140 h70 a35 14 0 0 1 -70 0z" fill="rgba(47,123,255,.35)" stroke="#5aa2ff" stroke-width="2" filter="url(#gl)"/>' +
      '<text x="70" y="172" fill="#5aa2ff" font-size="18" font-weight="900" text-anchor="middle">' + esc(g.home_cn) + "</text></g>" +
      '<g><line x1="330" y1="74" x2="305" y2="140" stroke="#ff6b84"/><line x1="330" y1="74" x2="355" y2="140" stroke="#ff6b84"/>' +
      '<path d="M295 140 h70 a35 14 0 0 1 -70 0z" fill="rgba(255,59,92,.35)" stroke="#ff6b84" stroke-width="2" filter="url(#gl)"/>' +
      '<text x="330" y="172" fill="#ff6b84" font-size="18" font-weight="900" text-anchor="middle">' + esc(g.away_cn) + "</text></g>" +
      "</g></svg>" +
      '<div class="scale-say">判决：<span class="' + (home ? "blue" : "red") + '">' + esc(sp.pick_text) + "</span> · " + lvl + "</div>" +
      '<p class="note" style="text-align:center">' + (sp.v8 ? "第八版预测盘口移动" : "与盘口差") + ' <span data-roll="' + num(sp.edge, 2) + '" data-dec="2">0</span> 分 · ' + bandPill(sp.band_cn) + "</p>";
    var beam = $("scale").querySelector(".beam");
    if ($("scale").closest(".card").classList.contains("in")) setTimeout(function () { beam.style.transform = "rotate(" + deg.toFixed(1) + "deg)"; runRolls($("scale")); }, 200);
  }

  /* ---------- 盘口 ---------- */
  // 皇冠一行：按括号把“盘口（水位）”拆成两行，文字原样；拆不开就整串换行
  function crRow(k, v) {
    v = v == null || v === "" ? "—" : String(v);
    var m = /^([^（(]+)[（(](.+)[)）]\s*$/.exec(v), main = m ? m[1].trim() : v, sub = m ? m[2].replace(/[，,]\s*/g, " · ") : "";
    return '<div class="crr"><span>' + esc(k) + '</span><div><b>' + esc(main) + "</b>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</div></div>";
  }
  function renderOdds(g) {
    var mk = g.market || {}, h = "";
    function cell(k, v, big) { return '<div class="oc"><span>' + k + "</span><b" + (big ? ' class="big"' : "") + ">" + v + "</b></div>"; }
    if (mk.source) h += '<p class="note">' + esc(mk.source) + "</p>";
    h += '<div class="ob med"><div class="on">多家中位数 <small>让分：' + esc((mk.median_books || []).join("、") || "暂无") + "；大小分：" + esc((mk.median_total_books || []).join("、") || "暂无") + "</small></div><div class=\"og\">" +
      cell("让分", mk.median_text ? esc(mk.median_text) : miss(), true) + cell("大小", mk.median_total != null ? num(mk.median_total, 1) + '<small> ' + mk.median_total_n + " 家</small>" : miss(), true) + "</div></div>";
    var cr = mk.crown && typeof mk.crown === "object" ? mk.crown : null;
    if (cr) {
      h += '<div class="ob crown"><div class="on">皇冠 <small>你下注的公司' + (cr.read_at ? " · 读取于 " + esc(cr.read_at) : "") + '</small></div><div class="crl">' +
        crRow("初盘", cr.spread_open) + crRow("现盘", cr.spread_now) + crRow("大小 初盘", cr.total_open) + crRow("大小 现盘", cr.total_now) + "</div>" +
        ((cr.leisu_spread || cr.leisu_total) ? '<p class="note">雷速 12 家中位数：让分 ' + esc(cr.leisu_spread || "—") + " · 大小 " + esc(cr.leisu_total || "—") + "</p>" : '<p class="note">雷速 12 家中位数待读取</p>') + "</div>";
    } else {
      h += '<p class="note small-miss">皇冠盘口待读取 · 雷速 12 家中位数待读取</p>';
    }
    (mk.books || []).forEach(function (b) {
      var mv = b.open_home != null && b.cur_home != null ? b.cur_home - b.open_home : null, mvs;
      if (mv == null) mvs = "变盘：没有开盘数据";
      else if (mv === 0) mvs = "变盘：没动";
      else mvs = '变盘：<span class="' + (mv > 0 ? "mv-up" : "mv-dn") + '">往' + esc(mv > 0 ? g.home_cn : g.away_cn) + "一侧走 " + num(Math.abs(mv), 1) + " 分</span>";
      var tt = (b.total_open != null ? num(b.total_open, 1) : "—") + " → " + (b.total_cur != null ? num(b.total_cur, 1) : "—");
      h += '<div class="ob"><div class="on">' + esc(b.book) + " <small>" + esc(b.time || "") + "</small></div>" + (b.note ? '<p class="note">' + esc(b.note) + "</p>" : "") +
        '<div class="og">' + cell("初盘", esc(hcText(g, b.open_home) || "—")) + cell("现盘", esc(hcText(g, b.cur_home) || "—"), true) + cell("大小 初→现", tt) + '</div><p class="note">' + mvs + "</p></div>";
    });
    if (mk.spread_range != null && mk.spread_range >= 3) h += '<div class="warn">各家现盘最多相差 ' + num(mk.spread_range, 1) + " 分，公司分歧大，先看皇冠实际挂的线。</div>";
    $("odds").innerHTML = h;
  }

  /* ---------- 模型与市场差距 ---------- */
  function renderEdge(g) {
    var mk = g.market || {}, med = mk.median_home, comps = g.comps || [], h = "";
    if (med == null || !comps.length) { $("edge").innerHTML = "<p>盘口或模型数据暂无</p>"; return; }
    var off = comps.filter(function (c) { return c.official; })[0];
    if (off) {
      var gap = off.pred_home_margin - med;
      h += '<div class="gap-big"><div class="box"><div class="dim">' + esc(off.name) + '</div><b>' + esc(winText(g, off.pred_home_margin)) + '</b></div>' +
        '<div class="box"><div class="dim">市场中位数</div><b style="color:var(--yel)">' + esc(mk.median_text) + '</b></div>' +
        '<div class="box"><div class="dim">差距</div><b><span data-roll="' + num(Math.abs(gap), 2) + '" data-dec="2">0</span> 分</b><div class="dim">偏向 ' + esc(gap > 0 ? g.home_cn : gap < 0 ? g.away_cn : "无") + "</div></div></div>";
    }
    var range = 4; comps.forEach(function (c) { range = Math.max(range, Math.abs(c.pred_home_margin - med) * 1.15); });
    h += '<div class="legend"><span class="blue">← 站' + esc(g.home_cn) + '</span><span style="color:var(--yel)">盘口</span><span class="red">站' + esc(g.away_cn) + " →</span></div>";
    comps.forEach(function (c) {
      var left = 50 - (c.pred_home_margin - med) / range * 50;
      h += '<div class="erow' + (c.official ? " off" : "") + '"><div class="lbl" title="' + esc(c.source) + '">' + esc(c.name) + '</div><div class="track"><span class="mk"></span><span class="dot" data-left="' + left.toFixed(1) + '%"></span></div><div class="v">' + num(c.pred_home_margin, 2) + "</div></div>";
    });
    h += '<p class="note">数字=模型算的主队净胜分（正数主队赢）。来源：我们开赛前锁定的预测、美盘电脑预测。</p>';
    if ((g.total_comps || []).length && g.total) {
      h += '<details open><summary>大小分：各模型算的总分（盘口 ' + num(g.total.line_total, 1) + "）</summary><ul class=\"ul\">" + g.total_comps.map(function (c) {
        var dd = c.pred_total - g.total.line_total;
        return "<li" + (c.official ? ' style="font-weight:800"' : "") + ">" + esc(c.name) + "：" + num(c.pred_total, 2) + "（" + (dd >= 0 ? "高 " : "低 ") + num(Math.abs(dd), 2) + "）</li>";
      }).join("") + "</ul></details>";
    }
    $("edge").innerHTML = h;
    if ($("edge").closest(".card").classList.contains("in")) setTimeout(function () { animateIn($("edge").closest(".card")); }, 50);
  }

  /* ---------- 情报流 ---------- */
  window.NBA_NAMES = function () { if (!state.data) return; safe("动态", function () { renderFeed(); }, "feed"); var g = game(); if (g) safe("伤病", function () { renderInj(g); }, "inj"); };
  function renderFeed() {
    var f = state.data.feed || [], show = 8;
    function draw(n) {
      $("feed").innerHTML = f.slice(0, n).map(function (it) {
        return '<li class="t-' + esc(it.tag) + '"><span class="tg">' + esc(it.tag) + '</span><div><b class="tm">' + esc(it.time) + "</b> " + esc(window.PBP && PBP.zhText ? PBP.zhText(it.text) : it.text) + "</div>" + (it.source ? '<div class="src">来源：' + esc(it.source) + "</div>" : "") + "</li>";
      }).join("") + (f.length > n ? '<li style="list-style:none"><button class="more" id="feedMore">展开全部 ' + f.length + " 条</button></li>" : "");
      var b = $("feedMore"); if (b) b.onclick = function () { draw(f.length); };
    }
    if (!f.length) { $("feed").innerHTML = "<li>暂时没有新情报</li>"; return; }
    draw(show);
  }

  /* ---------- 影响因素 ---------- */
  function wpct(rec) { var m = /(\d+)-(\d+)/.exec(rec || ""); return m ? (+m[1]) / ((+m[1]) + (+m[2]) || 1) : null; }
  function duel(label, lv, rv, lw, rw, lt, rt) {
    return '<div class="duel"><div class="l"><b>' + (lt != null ? lt : lv) + '</b><span class="bar" data-w="' + Math.round(lw * 100) + 'px"></span></div><div class="c">' + label +
      '</div><div class="r"><span class="bar" data-w="' + Math.round(rw * 100) + 'px"></span><b>' + (rt != null ? rt : rv) + "</b></div></div>";
  }
  function renderFactors(g) {
    var h = '<div class="duel"><div class="l blue"><b>' + esc(g.home_cn) + '</b></div><div class="c">主 ｜ 客</div><div class="r red"><b>' + esc(g.away_cn) + "</b></div></div>";
    var lc = g.lean_count || {}, lh = lc[g.home] || 0, la = lc[g.away] || 0, tot = Math.max(1, lh + la);
    h += duel("模型站队（家）", lh, la, lh / tot, la / tot);
    var ph = wpct(g.records[g.home]), pa = wpct(g.records[g.away]);
    h += duel("战绩", 0, 0, ph || 0, pa || 0, esc(g.records[g.home] || "—"), esc(g.records[g.away] || "—"));
    var inj = (g.injuries || {}).players || [];
    function cnt(team, st) { return inj.filter(function (p) { return p.team === team && p.status === st && !p.g_league; }).length; }
    var oh = cnt(g.home, "Out"), oa = cnt(g.away, "Out"), qh = cnt(g.home, "Questionable") + cnt(g.home, "Doubtful"), qa = cnt(g.away, "Questionable") + cnt(g.away, "Doubtful");
    var ns = (g.injuries || {}).not_submitted || [];
    var nh = ns.indexOf(g.home_cn) >= 0, na = ns.indexOf(g.away_cn) >= 0;
    h += duel("官方缺阵（不含发展联盟）", oh, oa, Math.min(oh / 6, 1), Math.min(oa / 6, 1), nh ? '<span class="miss">未交</span>' : oh, na ? '<span class="miss">未交</span>' : oa);
    h += duel("出战成疑", qh, qa, Math.min(qh / 6, 1), Math.min(qa / 6, 1), nh ? '<span class="miss">未交</span>' : qh, na ? '<span class="miss">未交</span>' : qa);
    h += '<p class="note">模型站队 = 各家预测和多家中位数比，站哪队的有几家。战绩来自 ESPN。</p>';
    var ex = g.extra;
    if (ex) {
      h += "<details open><summary>本场赛前资料（" + esc(ex.report_time) + "）</summary>";
      h += '<p class="note">' + esc(ex.note) + "</p>";
      if ((ex.five_sources || []).length) {
        h += '<table class="tbl"><thead><tr><th>谁的预测</th><th>算主队赢几分</th><th>当时站哪队</th></tr></thead><tbody>' + ex.five_sources.map(function (r) {
          return "<tr><td>" + esc(r.source) + "</td><td>" + esc(r.pred) + "</td><td>" + esc(r.vs_line) + "</td></tr>";
        }).join("") + "</tbody></table>";
      }
      if ((ex.efficiency || []).length) h += '<ul class="ul">' + ex.efficiency.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
      if (ex.referees) h += '<p class="note">裁判：' + esc(ex.referees) + "</p>";
      h += "</details>";
    } else {
      h += '<p class="note">这场没有单独整理赛前资料（攻防、休息、裁判等暂无）。</p>';
    }
    $("factors").innerHTML = h;
    if ($("factors").closest(".card").classList.contains("in")) setTimeout(function () { animateIn($("factors").closest(".card")); }, 50);
  }

  /* ---------- 缺阵名单 ---------- */
  var ORDER = { Out: 0, Doubtful: 1, Questionable: 2, Probable: 3, Available: 4 };
  function plCard(p) {
    var img = p.nba_id ? '<img loading="lazy" alt="' + esc(p.name) + '" src="https://cdn.nba.com/headshots/nba/latest/1040x760/' + encodeURIComponent(p.nba_id) + '.png" onerror="this.parentNode.textContent=\'头像加载失败\'">' : "无头像";
    return '<div class="pl ' + esc(p.cls) + '"><div class="ph">' + img + '</div><div><div class="n">' + esc((window.PBP && PBP.zhFullByEn && PBP.zhFullByEn[String(p.name || "").toLowerCase()]) || p.name) + '<span class="st ' + esc(p.cls) + '">' + esc(p.status_cn) + '</span></div><div class="rs" title="' + esc(p.reason_raw) + '">' + esc(p.reason || p.reason_raw || "原因未写") + "</div></div></div>";
  }
  function renderInj(g) {
    var I = g.injuries || {}, ps = (I.players || []).slice().sort(function (a, b) { return ORDER[a.status] - ORDER[b.status]; });
    var h = '<p class="note">NBA 官方伤病报告：' + esc(I.report || "暂无") + "</p>";
    h += '<div class="injgrid">';
    [[g.home, g.home_cn, "blue"], [g.away, g.away_cn, "red"]].forEach(function (t) {
      var mine = ps.filter(function (p) { return p.team === t[0]; }), main = mine.filter(function (p) { return !p.g_league; }), gl = mine.filter(function (p) { return p.g_league; });
      h += '<div class="injcol"><h3 class="' + t[2] + '">' + esc(t[1]) + "</h3>";
      if ((I.not_submitted || []).indexOf(t[1]) >= 0) h += '<div class="warn">' + esc(t[1]) + "还没交伤病名单</div>";
      else if (!main.length) h += '<p class="note">官方报告没有列出伤病球员。</p>';
      h += main.map(plCard).join("");
      if (gl.length) h += "<details><summary>发展联盟 / 双向合同（不在轮换）" + gl.length + " 人</summary>" + gl.map(plCard).join("") + "</details>";
      h += "</div>";
    });
    h += "</div>";
    if ((I.changes || []).length) h += "<details><summary>名单怎么变的</summary><ul class=\"ul\">" + I.changes.map(function (c) { return "<li>" + esc(c.report) + "（" + esc(c.pt) + "）：" + c.items.map(esc).join("；") + "</li>"; }).join("") + "</ul></details>";
    h += '<p class="note">头像来自 NBA 官网，查不到的不放。</p>';
    $("inj").innerHTML = h;
  }

  /* ---------- 历史命中率 ---------- */
  function v8Board() {
    var B = ((state.data || {}).v8 || {}).board || {}, T = B.target || 300;
    var h = '<div class="v8board"><div class="v8bt">第八版早锁 · 实盘成绩板 <span class="v8tag">实盘验证中</span></div>';
    if (!B.has) return h + '<p class="v8empty">明天开始记录（每场开盘后锁一次，比赛结束后算对错）</p><div class="v8prog"><i style="width:0%"></i></div><p class="note">目标攒满 ' + T + " 场，现在 0 场。</p></div>";
    function row(t, r) {
      return '<div class="v8row"><span>' + t + "</span><b>" + (r && r.n ? r.w + " 对 " + r.l + " 错" + (r.p ? "（" + r.p + " 场走盘）" : "") + " · " + r.pct + "%" : "还没有结束的比赛") + "</b></div>";
    }
    var n = B.all.n, left = Math.max(0, T - n);
    h += row("第八版全部", B.all) + row("其中高把握", B.high) + row("第九版候选 M9a", B.m9a) + row("M9a 高把握", B.m9a_high);
    h += '<div class="v8prog"><i style="width:' + Math.min(100, 100 * n / T).toFixed(1) + '%"></i></div><p class="note">已记录 ' + n + " 场，离 " + T + " 场还差 " + left + " 场" + (B.pending ? "；另有 " + B.pending + " 场还没打完" : "") + "。只算让分方向对错，走盘不算。</p></div>";
    return h;
  }
  function renderHist() {
    var H = state.data.history || {}, mv = state.data.model_version || {}, h = v8Board();
    function box(title, r) {
      return '<div class="box"><div class="dim">' + esc(title) + "</div>" + (r && r.graded ? "<b>" + (r.pct == null ? "—" : '<span data-roll="' + r.pct + '" data-dec="1">0</span>%') + '</b><div class="dim">' + r.w + "胜 " + r.l + "负 " + r.p + "走</div>" : '<b class="miss">暂无</b><div class="dim">比赛结束后才有</div>') + "</div>";
    }
    h += '<div class="live-rec">' + box((mv.version_cn || "") + "实际战绩 · 让分", mv.record_spread) + box((mv.version_cn || "") + "实际战绩 · 大小分", mv.record_total) + "</div>";
    h += '<p class="note">实际战绩 = 开赛前锁定、比赛结束后对照的结果。下面是拿过去的比赛检验出来的命中率。</p>';
    (H.groups || []).forEach(function (gp, i) {
      var inner = '<div class="d">' + esc(gp.desc) + "</div>" + gp.rows.map(function (r) {
        var pct = r.pct;
        return '<div class="hr"><div>' + esc(r.label) + '</div><div class="bt">' + (pct == null ? "" : '<i class="' + (pct < 50 ? "lo" : "") + '" data-w="' + Math.max(2, Math.min(100, (pct - 30) / 40 * 100)).toFixed(1) + '%"></i>') + '</div><div class="num">' +
          (pct == null ? '<span class="miss">暂无</span><small>' + esc(r.note || "") + "</small>" : '<span data-roll="' + pct + '" data-dec="1">0</span>%<small>' + r.w + "-" + r.l + "-" + r.p + "</small>") + "</div></div>";
      }).join("");
      h += i < 2 ? '<div class="hg"><h3>' + esc(gp.title) + "</h3>" + inner + "</div>" : '<details class="hg"><summary>' + esc(gp.title) + "</summary>" + inner + "</details>";
    });
    if (H.is_first_note) h += '<p class="note">' + esc(H.is_first_note) + "</p>";
    $("hist").innerHTML = h;
  }

  /* ---------- 缺失与来源 ---------- */
  function renderMissing() {
    var d = state.data, h = '<ul class="ul">' + (d.missing || []).map(function (m) {
      if (/^首发名单/.test(m)) { // 和“首发 · 缺阵”用同一份数据（ESPN starter 字段），不各说各的
        var P = window.PBP || {}, g = game(), n = 0; if (g && P.gid === g.espn_id) for (var k in (P.ath || {})) if (P.ath[k].starter) n++;
        m = n ? "首发名单：已公布（官方首发，ESPN starter 字段），见“首发 · 缺阵”" : "首发名单：暂无（开赛前 1 小时左右公布；比赛中显示的是场上五人，不是首发）";
      }
      return "<li>" + esc(m) + "</li>"; }).join("") + "</ul>";
    var mv = d.model_version || {};
    if (mv.rule) h += '<p class="note">' + esc(mv.rule) + "。</p>";
    h += '<p class="note">原则：' + (d.rules || []).map(esc).join(" ｜ ") + "</p>";
    h += '<details><summary>数据从哪来（' + (d.sources || []).length + ' 项）</summary><ul class="src-list">' + (d.sources || []).map(function (s) {
      return "<li>" + esc(s.name) + (s.note ? "：" + esc(s.note) : "") + (s.updated ? "（更新于 " + esc(String(s.updated).slice(5, 16)) + "）" : "") + "</li>";
    }).join("") + "</ul></details>";
    var mb = $("missing"); if (mb._h !== h) { var op = mb.querySelector("details") && mb.querySelector("details").open; mb._h = h; mb.innerHTML = h; if (op) mb.querySelector("details").open = true; }
  }
  window.NBA_RM = function () { if (state.data) safe("数据缺口", renderMissing); };


  /* ---------- 实时比分（浏览器直接读 ESPN，只用于展示，不写回任何数据） ---------- */
  var SB_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
  var ESPN2NBA = { GS: "GSW", SA: "SAS", NO: "NOP", NY: "NYK", UTAH: "UTA", WSH: "WAS", PHO: "PHX", BKN: "BKN" };
  var live = { byId: {}, prev: {}, okAt: null, fail: false, timer: 0 };
  function nbaAb(x) { return ESPN2NBA[x] || x; }
  function ptTime(iso) {
    try { return new Intl.DateTimeFormat("zh-CN", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)); } catch (e) { return ""; }
  }
  function statusCn(s) {
    if (!s) return "";
    if (s.state === "pre") return "未开始 · " + s.tip + " 开赛";
    if (s.state === "post") return s.period > 4 ? "终场（加时）" : "终场";
    if (s.name === "STATUS_HALFTIME") return "中场休息";
    var per = s.period > 4 ? (s.period === 5 ? "加时" : "第" + (s.period - 4) + "个加时") : "第" + s.period + "节";
    if (s.name === "STATUS_END_PERIOD") return per + "结束";
    return per + " 剩 " + (String(s.clock).indexOf(":") < 0 ? s.clock + " 秒" : s.clock);
  }
  function parseSB(d) {
    var out = {};
    (d.events || []).forEach(function (e) {
      var c = (e.competitions || [])[0] || {}, st = e.status || {}, ty = st.type || {}, r = { id: String(e.id), state: ty.state, name: ty.name, period: st.period || 0, clock: st.displayClock || "", tip: ptTime(e.date), date: e.date };
      (c.competitors || []).forEach(function (t) {
        var k = t.homeAway === "home" ? "h" : "a";
        r[k + "ab"] = nbaAb((t.team || {}).abbreviation); r[k + "id"] = String((t.team || {}).id || ""); r[k + "s"] = t.score == null ? null : +t.score;
        r[k + "ls"] = (t.linescores || []).map(function (x) { var v = x.value != null ? x.value : x.displayValue; return v == null || v === "" ? null : +v; });
      });
      out[r.id] = r; out[r.aab + "@" + r.hab] = r;
    });
    return out;
  }
  function liveFor(g) { return live.byId[g.espn_id] || live.byId[g.away + "@" + g.home] || null; }
  function bump(el, diff) {
    if (!el) return;
    el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
    var f = document.createElement("i"); f.className = "plus"; f.textContent = "+" + diff; el.appendChild(f);
    setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 1500);
  }
  /* ---- 比分卡下方：各节比分 + 领先 + 锁定盘口对照（只显示，不写回） ---- */
  function perName(i) { return i < 4 ? "第" + (i + 1) + "节" : (i === 4 ? "加时" : "加时" + (i - 3)); }
  function n1(x) { x = Math.round(Math.abs(x) * 10) / 10; return String(x); }
  function lvxHtml(g, s) {
    var started = s.state !== "pre", fin = s.state === "post", h = "";
    var np = Math.max(4, (s.als || []).length, (s.hls || []).length);
    h += '<table class="lq"><tr><th></th>';
    for (var i = 0; i < np; i++) h += "<th>" + (i < 4 ? i + 1 : (i === 4 ? "OT" : "OT" + (i - 3))) + "</th>";
    h += "<th>总</th></tr>";
    [["a", g.away_cn, "red"], ["h", g.home_cn, "blue"]].forEach(function (t) {
      var ls = s[t[0] + "ls"] || [];
      h += '<tr><td class="tn ' + t[2] + '">' + esc(t[1]) + "</td>";
      for (var i = 0; i < np; i++) h += "<td>" + (started && ls[i] != null ? ls[i] : "-") + "</td>";
      h += '<td class="tot">' + (started && s[t[0] + "s"] != null ? s[t[0] + "s"] : "-") + "</td></tr>";
    });
    h += "</table>";
    var tot = (s.as || 0) + (s.hs || 0), diff = (s.hs || 0) - (s.as || 0);
    h += '<div class="lx1">' + (!started ? "开赛后显示领先和盘口对照" : (diff === 0 ? "平分" : (diff > 0 ? g.home_cn : g.away_cn) + (fin ? "赢 " : "领先 ") + Math.abs(diff)) + " · 总分 " + tot) + "</div>";
    var ms = mainSpread(g), to = g.total, pre = fin ? "最终" : "目前";
    var l2 = "让分：暂无锁定盘口", l3 = "大小球：暂无锁定盘口", c2 = "", c3 = "";
    if (ms && ms.pick_team && ms.line_home != null) {
      var home = ms.pick_team === g.home, hc = home ? -ms.line_home : ms.line_home, pcn = home ? g.home_cn : g.away_cn;
      var lt = hc === 0 ? "平手盘" : (hc < 0 ? "让 " : "受让 ") + n1(hc);
      l2 = "我们选 " + pcn + " " + lt;
      if (started) {
        var m = (home ? diff : -diff) + hc;
        l2 += "：" + pre + (m > 0 ? "赢盘（多 " + n1(m) + " 分）" : m < 0 ? "输盘（差 " + n1(m) + " 分）" : "走盘");
        c2 = m > 0 ? "win" : m < 0 ? "lose" : "";
      } else l2 += "：开赛后对照";
    }
    if (to && to.line_total != null && (to.pick === "OVER" || to.pick === "UNDER")) {
      var L = to.line_total, over = to.pick === "OVER";
      l3 = "大小球 我们选" + (over ? "大" : "小") + " " + n1(L);
      if (!started) l3 += "：开赛后对照";
      else if (fin) { var r = tot > L ? (over ? "赢" : "输") : tot < L ? (over ? "输" : "赢") : "走盘"; l3 += "：最终 " + tot + " 分，" + (r === "走盘" ? "走盘" : r === "赢" ? "赢盘" : "输盘"); c3 = r === "赢" ? "win" : r === "输" ? "lose" : ""; }
      else if (tot < L) { l3 += "：目前 " + tot + "，还差 " + n1(L - tot) + " 分到盘口"; c3 = over ? "" : "win"; }
      else if (tot > L) { l3 += "：目前 " + tot + "，已超过盘口 " + n1(tot - L) + " 分"; c3 = over ? "win" : "lose"; }
      else l3 += "：目前 " + tot + "，正好在盘口";
    }
    h += '<div class="lx2 ' + c2 + '">' + esc(l2) + '</div><div class="lx2 ' + c3 + '">' + esc(l3) + "</div>";
    return h;
  }
  // 比赛进行中：比分条（吸顶）+ 球场 + 场上状况 放最上面；只在状态变化时切换一次
  function liveLayout() {
    var g = game(), s = g && dispOf(liveFor(g)), on = !!(s && s.state === "in"), main = $("app"), top = $("liveTop");
    if (on && top) {
      var d = s.hs - s.as, np = Math.max(4, (s.als || []).length, (s.hls || []).length), q = "";
      for (var i = 0; i < np; i++) q += "<th>" + (i < 4 ? i + 1 : (i === 4 ? "OT" : "OT" + (i - 3))) + "</th>";
      function row(k, cn, cls) { var ls = s[k + "ls"] || [], r = '<tr><td class="tn ' + cls + '">' + esc(cn) + "</td>"; for (var i = 0; i < np; i++) r += "<td>" + (ls[i] != null ? ls[i] : "-") + "</td>"; return r + '<td class="tot">' + s[k + "s"] + "</td></tr>"; }
      var th = '<div class="lt1"><span class="lvst live"><i></i>' + esc(statusCn(s)) + '</span><b class="red">' + esc(g.away_cn) + " " + s.as + '</b><em>:</em><b class="blue">' + s.hs + " " + esc(g.home_cn) + "</b></div>" +
        '<table class="lq lqs"><tr><th></th>' + q + "<th>总</th></tr>" + row("a", g.away_cn, "red") + row("h", g.home_cn, "blue") + "</table>" +
        '<div class="lt2">' + (d === 0 ? "平分" : esc(d > 0 ? g.home_cn : g.away_cn) + "领先 " + Math.abs(d)) + " · 总分 " + (s.hs + s.as) + "</div>";
      if (top._h !== th) { top._h = th; top.innerHTML = th; }
    }
    if (main && main.classList.contains("live-mode") !== on) keepScroll(function () { main.classList.toggle("live-mode", on); }); document.documentElement.classList.toggle("lm", !!on);
  }
  /* ---- 比分校验：score / 各节加总 / 逐回合最后一条 三个数比对 ---- */
  live.finals = {};
  function sumLs(ls) { if (!ls || !ls.length) return null; var t = 0; for (var i = 0; i < ls.length; i++) { if (ls[i] == null || isNaN(ls[i])) return null; t += +ls[i]; } return t; }
  function fixScore(s) {
    if (!s || s.state === "pre") return s;
    if (s.state === "post" && live.finals[s.id]) { s.as = live.finals[s.id].as; s.hs = live.finals[s.id].hs; return s; } // 终场后以终场时的比分为准
    var P = window.PBP, lp = P && String(P.gid) === String(s.id) && P.plays.length ? P.plays[P.plays.length - 1] : null;
    ["a", "h"].forEach(function (k) {
      var raw = s[k + "s"], c = [raw, sumLs(s[k + "ls"]), lp ? (k === "a" ? lp.a : lp.h) : null].filter(function (v) { return v != null && !isNaN(v); }).map(Number);
      if (!c.length) return;
      var same = c.every(function (v) { return v === c[0]; });
      s[k + "s"] = same || s.src === "NBA" ? (s.src === "NBA" && raw != null ? +raw : c[0]) : Math.max.apply(null, c); // 不一致：官方源优先，否则取较大（比赛中比分不会减少）
    });
    if (s.state === "post") live.finals[s.id] = { as: s.as, hs: s.hs };
    return s;
  }
  window.fixScore = fixScore;
  // 显示用比分：比赛进行中，scoreboard 比最新一条逐回合的比分新时，先显示逐回合的比分，
  // 等对应的得分回合到了，大比分和动画、大字、语音同时更新；超过 20 秒还没等到就直接显示 scoreboard。节末、中场、终场按官方比分。
  // 只影响显示，不改 live.byId 里的数据（比分不倒退、防旧检查都照旧）
  live.ahead = {};
  function dispOf(s) {
    if (!s) return s; fixScore(s);
    var P = window.PBP, lp = s.state === "in" && s.name !== "STATUS_END_PERIOD" && s.name !== "STATUS_HALFTIME" && P && String(P.gid) === String(s.id) && P.plays.length ? P.plays[P.plays.length - 1] : null;
    if (!lp || lp.a == null || lp.h == null || (s.as <= lp.a && s.hs <= lp.h)) { delete live.ahead[s.id]; return s; }
    var ah = live.ahead[s.id]; if (!ah) ah = live.ahead[s.id] = { t: Date.now() };
    if (Date.now() - ah.t > 20000) return s;
    var d = {}; for (var k in s) d[k] = s[k];
    d.as = Math.min(s.as, lp.a); d.hs = Math.min(s.hs, lp.h); d.held = true;
    ["a", "h"].forEach(function (k) { var ls = (s[k + "ls"] || []).slice(), diff = s[k + "s"] - d[k + "s"]; if (diff && ls.length && ls[ls.length - 1] != null) ls[ls.length - 1] = Math.max(0, ls[ls.length - 1] - diff); d[k + "ls"] = ls; });
    return d;
  }
  window.liveShow = function (g) { return dispOf(liveFor(g)); };
  window.LIVE_REPAINT = function () { paintLive(true); };
  function paintLive(animate) {
    var d = state.data; if (!d) return;
    for (var kk in live.byId) if (kk === live.byId[kk].id) fixScore(live.byId[kk]);
    allGames().forEach(function (g) {
      var s = dispOf(liveFor(g)), key = g.espn_id, pv = live.shown[key]; if (s) live.shown[key] = { as: s.as, hs: s.hs };
      var tab = document.querySelector('[data-lvtab="' + key + '"]'), mid = document.querySelector('[data-lvmid="' + key + '"]');
      if (!s) return;
      var started = s.state !== "pre", inp = s.state === "in";
      if (tab) {
        tab.className = "lvtab" + (inp ? " live" : s.state === "post" ? " fin" : "");
        var th = started ? '<b class="sa">' + s.as + '</b> : <b class="sh">' + s.hs + "</b> · " + esc(statusCn(s)) : esc(s.tip + " 开赛");
        if (tab._h !== th) { tab._h = th; tab.innerHTML = th; }
      }
      if (mid) {
        var mh = '<div class="lvst' + (inp ? " live" : s.state === "post" ? " fin" : "") + '">' + (inp ? "<i></i>" : "") + esc(started ? statusCn(s) : s.tip + " 开赛") + "</div>" +
          (started ? '<div class="lvsc"><b class="sh blue">' + s.hs + '</b><em>:</em><b class="sa red">' + s.as + "</b></div>" : "<b>VS</b><small>太平洋时间</small>");
        if (mid._h !== mh) { mid._h = mh; mid.innerHTML = mh; }
      }
      var lx = document.querySelector('[data-lvx="' + key + '"]');
      if (lx) { var xh = ""; try { xh = lvxHtml(g, s); } catch (e) { xh = '<p class="note">暂时无法显示</p>'; } if (lx._h !== xh) { lx._h = xh; lx.innerHTML = xh; } }
      if (animate && pv && started) {
        if (s.hs > pv.hs) document.querySelectorAll('[data-lvtab="' + key + '"] .sh, [data-lvmid="' + key + '"] .sh').forEach(function (el) { bump(el, s.hs - pv.hs); });
        if (s.as > pv.as) document.querySelectorAll('[data-lvtab="' + key + '"] .sa, [data-lvmid="' + key + '"] .sa').forEach(function (el) { bump(el, s.as - pv.as); });
      }
    });
    safe("直播布局", liveLayout);
    var w = $("lvWarn");
    if (w) w.textContent = live.fail ? "比分暂时没刷新到，显示的是 " + (live.okAt || "上次") + " 的比分" : "";
  }
  function anyLive() { for (var k in live.byId) if (live.byId[k].state === "in") return true; return false; }
  // 比分更新时间（太平洋时间，精确到秒），显示在页头，方便看是否卡住
  function stampScore() {
    var s = ""; try { s = new Intl.DateTimeFormat("zh-CN", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()); } catch (e) {}
    var g = state.data && game(), cur = g && liveFor(g);
    var el = $("scoreAt"); if (el && s) el.textContent = "比分 最后检查 " + s + (cur && cur.state === "in" ? " · " + (cur.src === "NBA" ? "NBA 官方" : "ESPN") : "");
  }
  function rankOf(x) { return (x.state === "post" ? 1e7 : 0) + (x.period || 0) * 1e5 + (x.as || 0) + (x.hs || 0) + (720 - clkSec(x.clock)) / 1000; }
  /* ---- NBA 官方实时比分（浏览器直拉；跨域失败/403/超时就静默用 ESPN，连续失败 3 次本次访问不再试） ---- */
  var NBA_SB = "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json";
  var nbaSrc = { fails: 0, off: false, busy: false };
  function nbaClock(c) { var m = /PT(\d+)M([\d.]+)S/.exec(c || ""); if (!m) return ""; var mm = +m[1], ss = parseFloat(m[2]); return mm ? mm + ":" + (ss < 10 ? "0" : "") + Math.floor(ss) : ss.toFixed(1); }
  function pollNBA() {
    if (nbaSrc.off || nbaSrc.busy || !anyLive()) return;
    nbaSrc.busy = true;
    sbFetch(NBA_SB + "?t=" + Date.now(), 4000).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
      nbaSrc.fails = 0;
      ((d.scoreboard || {}).games || []).forEach(function (x) {
        var at = x.awayTeam || {}, ht = x.homeTeam || {}, key = at.teamTricode + "@" + ht.teamTricode, cur = live.byId[key]; if (!cur) return;
        var txt = String(x.gameStatusText || "");
        var r = { as: +at.score, hs: +ht.score, period: x.period, clock: nbaClock(x.gameClock), state: x.gameStatus === 2 ? "in" : x.gameStatus === 3 ? "post" : "pre",
          name: /half/i.test(txt) ? "STATUS_HALFTIME" : /^end/i.test(txt) ? "STATUS_END_PERIOD" : x.gameStatus === 3 ? "STATUS_FINAL" : "STATUS_IN_PROGRESS",
          als: (at.periods || []).map(function (p) { return p.score; }), hls: (ht.periods || []).map(function (p) { return p.score; }), src: "NBA" };
        if (r.state === "pre" || isNaN(r.as) || isNaN(r.hs)) return;
        window.LIVE_MERGE(cur.id, r);
      });
    }).catch(function () { if (++nbaSrc.fails >= 3) nbaSrc.off = true; }).then(function () { nbaSrc.busy = false; });
  }
  function clkSec(c) { c = String(c || ""); var m = /^(\d+):(\d+)/.exec(c); return m ? +m[1] * 60 + +m[2] : parseFloat(c) || 0; }
  // 把逐回合接口（summary）头部的比分合进来：两个来源谁新用谁，大比分绝不等动画
  window.LIVE_MERGE = function (id, r) {
    var cur = live.byId[String(id)]; if (!cur || !r) return;
    if (rankOf(r) > rankOf(cur)) {
      cur.src = r.src || "ESPN";
      ["as", "hs", "period", "clock", "state", "name", "als", "hls"].forEach(function (k) { if (r[k] != null) cur[k] = r[k]; });
      paintLive(true);
    }
    stampScore();
  };
  live.fastMs = 2000; live.busy = false; live.shown = {};
  function sbFetch(url, ms) {
    var ac = window.AbortController ? new AbortController() : null, t = ac ? setTimeout(function () { ac.abort(); }, ms) : 0;
    return fetch(url, ac ? { cache: "no-store", signal: ac.signal } : { cache: "no-store" }).then(function (r) { clearTimeout(t); return r; }, function (e) { clearTimeout(t); throw e; });
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && state.data) { live.busy = false; pollScores(); } });
  // 看门狗：请求挂住超过 8 秒或定时器丢了，就强制重新拉，轮询永不中断
  setInterval(function () {
    if (!state.data || !state.shown) return;
    if (live.busy && Date.now() - (live.busyAt || 0) > 8000) { live.busy = false; pollScores(); return; }
    if (!live.busy && anyLive() && document.visibilityState === "visible" && Date.now() - (live.doneAt || 0) > 8000) pollScores();
  }, 4000);
  function pollScores() {
    clearTimeout(live.timer);
    if (live.busy) return; // 上一个请求没回来就不发下一个
    live.busy = true; live.busyAt = Date.now();
    sbFetch(SB_URL + "?t=" + Date.now(), 5000).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
      live.fastMs = 2000; live.okT = Date.now(); stampScore();
      var nb = parseSB(d), prev = {};
      (state.data ? allGames() : []).forEach(function (g) { var s = liveFor(g); if (s) prev[g.espn_id] = s; });
      var oldIds = (live.events || []).map(function (e) { return e.id + e.state; }).join(",");
      for (var k0 in nb) { var o = live.byId[k0]; if (o && k0 === nb[k0].id && rankOf(o) > rankOf(nb[k0])) ["as", "hs", "period", "clock", "state", "name", "als", "hls", "src"].forEach(function (f) { nb[k0][f] = o[f]; }); } // 比分不倒退
      live.events = []; for (var k in nb) if (k === nb[k].id) live.events.push(nb[k]);
      live.prev = prev; live.byId = nb;
      pollNBA();
      if (state.data && oldIds !== live.events.map(function (e) { return e.id + e.state; }).join(",")) keepScroll(function () { var sl = $("gameTabs").scrollLeft; renderTabs(); $("gameTabs").scrollLeft = sl; var gg = game(); if (gg && (gg.nomodel || !$("hero").innerHTML)) renderGame(); }); live.fail = false; live.okAt = ptTime(new Date().toISOString());
      paintLive(true);
      if (window.PBP) window.PBP.kick();
    }).catch(function () { live.fail = true; live.fastMs = live.fastMs < 3000 ? 3000 : 5000; paintLive(false); }).then(function () {
      live.busy = false; live.doneAt = Date.now();
      // 有比赛进行中：前台 2 秒（出错退到 3→5 秒，成功后回到 2 秒），后台 6 秒；没有比赛进行中 2 分钟
      live.timer = setTimeout(pollScores, anyLive() ? (document.visibilityState === "visible" ? live.fastMs : 6000) : 120000);
    });
  }
  window.NBA = { game: function () { return state.data ? game() : null; } };
  window.LIVE = live; window.liveFor = liveFor; window.statusCn = statusCn;
  document.addEventListener("visibilitychange", function () { if (!document.hidden) pollScores(); });

  /* ---------- 日期栏（雷速式）：点哪天看哪天；今天显示完整页面，其他日子显示当天赛果/赛程 ---------- */
  var WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  var dayState = { sel: null, today: null, cache: {}, sig: {}, chg: {} };
  function ptParts(dt) {
    var f = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(dt), o = {};
    f.forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, m: +o.month, d: +o.day, key: o.year + o.month + o.day, iso: o.year + "-" + o.month + "-" + o.day, w: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday) };
  }
  function renderDateBar() {
    var bar = $("dateBar"); if (!bar || bar._done) return;
    var now = Date.now(), t = ptParts(new Date(now)); dayState.today = t.key; if (!dayState.sel) dayState.sel = t.key;
    var h = "";
    for (var i = -10; i <= 7; i++) {
      var p = ptParts(new Date(now + i * 86400000 + 0));
      h += '<button class="dchip' + (p.key === dayState.sel ? " on" : "") + (i === 0 ? " today" : "") + '" data-day="' + p.key + '" data-iso="' + p.iso + '"><b>' + p.m + "/" + p.d + "</b><span>" + (i === 0 ? "今天" : WEEK[p.w]) + "</span></button>";
    }
    bar.innerHTML = h; bar._done = true;
    bar.querySelectorAll(".dchip").forEach(function (b) { b.onclick = function () { selectDay(b.getAttribute("data-day"), b.getAttribute("data-iso")); }; });
    var on = bar.querySelector(".dchip.on"); if (on) bar.scrollLeft = on.offsetLeft - bar.clientWidth / 2 + on.offsetWidth / 2;
  }
  function selectDay(key, iso) {
    dayState.sel = key; dayState.iso = iso; if (FR.nav) FR.nav.sync(key);
    $("dateBar").querySelectorAll(".dchip").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-day") === key); });
    var main = $("app"), dv = $("dayView");
    if (key === dayState.today) { main.classList.remove("day-mode"); dv.hidden = true; return; }
    main.classList.add("day-mode"); dv.hidden = false;
    var c = dayState.cache[key];
    if (c) drawDay(key, iso, c.events);
    else dv.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>'; // 骨架，不白屏
    if (!c || (key >= dayState.today && Date.now() - c.t > 120000)) refreshDay(key, iso);
  }
  // 当天/未来赛程每 2 分钟自动重拉（开赛时间、状态、锁定预测都会自动出现）
  function refreshDay(key, iso) {
    var c = dayState.cache[key], dv = $("dayView");
    return fetch(SB_URL + "?dates=" + key + "&t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) {
      var evs = []; var nb = parseSB(d); for (var k in nb) if (k === nb[k].id) evs.push(nb[k]);
      dayState.cache[key] = { t: Date.now(), events: evs }; dayState.okT = dayState.okT || {}; dayState.okT[key] = Date.now();
      if (dayState.sel === key) drawDay(key, iso, evs);
    }).catch(function () { if (dayState.sel === key && !c) dv.innerHTML = '<p class="note">赛程读取失败，稍后再点一次</p>'; });
  }
  setInterval(function () { if (dayState.sel && dayState.sel > dayState.today && document.visibilityState === "visible") refreshDay(dayState.sel, dayState.iso); }, 120000);
  function judge(lock, s, kind) {
    // 先用台账 result；没填且已终场，就用终场比分对照锁定线算（只在页面上算，不写回）
    if (!lock) return null;
    if (lock.result === "W" || lock.result === "L" || lock.result === "P") return { r: lock.result, calc: false };
    if (!s || s.state !== "post" || s.hs == null) return null;
    var x;
    if (kind === "total") { if (lock.line_total == null) return null; x = (s.hs + s.as - lock.line_total) * (lock.pick === "UNDER" ? -1 : 1); }
    else if (lock.kind === "pick_line") { if (lock.pick_line == null) return null; x = (lock.pick === s.hab ? s.hs - s.as : s.as - s.hs) + lock.pick_line; }
    else { if (lock.line_home == null) return null; var mg = s.hs - s.as; x = lock.pick === s.hab ? mg - lock.line_home : lock.line_home - mg; }
    return { r: x > 0 ? "W" : x < 0 ? "L" : "P", calc: true };
  }
  function resChip(j) {
    if (!j) return "";
    var t = { W: "对", L: "错", P: "走盘" }[j.r];
    return '<span class="res r' + j.r + '">' + t + "</span>" + (j.calc ? '<small class="calc">按终场比分算</small>' : "");
  }
  window.DAY = { draw: function (k, i, e) { drawDay(k, i, e); }, st: dayState };
  function drawDay(key, iso, evs) {
    var dv = $("dayView"), locks = ((state.data || {}).locks_by_date || {})[iso] || {}, past = key < dayState.today;
    var p = { m: +key.slice(4, 6), d: +key.slice(6, 8) };
    var h = '<h2>' + p.m + "月" + p.d + "日 " + (past ? "赛果" : "赛程") + ' <small class="dim">（太平洋时间）</small></h2>';
    if (!evs.length) h += '<p class="note">这天没有 NBA 比赛。</p>';
    var nW = 0, nL = 0;
    h += '<ul class="daylist">' + evs.map(function (s) {
      var L = locks[s.id] || null;
      if (!L) for (var k in locks) if (locks[k].away === s.aab && locks[k].home === s.hab) L = locks[k];
      var an = TEAM_CN[s.aab] || s.aab, hn = TEAM_CN[s.hab] || s.hab;
      var st = s.state === "post" ? '<b class="fs">' + s.as + " : " + s.hs + "</b> 终场" : s.state === "in" ? '<b class="fs">' + s.as + " : " + s.hs + "</b> " + esc(statusCn(s)) : esc(s.tip) + " 开赛";
      var lk = "";
      if (L && (L.spread || L.total)) {
        var js = judge(L.spread, s, "spread"), jt = judge(L.total, s, "total");
        if (js && js.r === "W") nW++; if (js && js.r === "L") nL++;
        if (L.spread) lk += '<div class="lk">' + (past ? "赛前锁定：" : "模型预测：") + "<b>" + esc(L.spread.pick_text) + "</b> <small>" + esc(L.spread.model_label) + (L.spread.band_cn ? " · 把握度" + esc(L.spread.band_cn) : "") + "</small> " + resChip(js) + "</div>";
        if (L.total) lk += '<div class="lk sm">大小分：<b>' + esc(L.total.pick_text) + "</b> " + resChip(jt) + "</div>";
      } else lk = '<div class="lk dim">' + (past || s.state !== "pre" ? "当日未预测" : "预测在开盘后锁定（约早上 7 点后）") + "</div>";
      var sg = st + "|" + lk, pv = dayState.sig[s.id], up = "";
      if (pv != null && pv !== sg) { dayState.chg[s.id] = { t: Date.now(), hm: hm() }; up = " flash"; }
      dayState.sig[s.id] = sg;
      var cg = dayState.chg[s.id]; if (cg && Date.now() - cg.t < 1800000) lk += '<i class="upd">刚更新 ' + cg.hm + "</i>";
      return '<li class="dli' + up + '" data-id="' + esc(s.id) + '"><div class="tm2"><span>' + esc(an) + " @ " + esc(hn) + '</span><span class="st2">' + st + "</span></div>" + lk + '<div class="dmore">点开看赛前详情 ›</div><div class="ddet" hidden></div></li>';
    }).join("") + "</ul>";
    if (nW + nL) h += '<p class="note">这天让分方向：对 ' + nW + " 场，错 " + nL + " 场（只算赛前锁定的）。</p>";
    h += '<p class="note">只用开赛前锁定的记录；对错优先用我们账本里的结果，账本还没填时按终场比分对照锁定的盘口算。</p>';
    dv.innerHTML = h;
    dv.querySelectorAll(".dli").forEach(function (li) {
      var s = null; evs.forEach(function (e) { if (e.id === li.getAttribute("data-id")) s = e; });
      li.querySelector(".tm2").onclick = li.querySelector(".dmore").onclick = function () {
        var d = li.querySelector(".ddet"), open = d.hidden;
        dv.querySelectorAll(".ddet").forEach(function (x) { x.hidden = true; }); dv.querySelectorAll(".dmore").forEach(function (x) { x.textContent = "点开看赛前详情 ›"; });
        dayState.open = open ? s.id : null;
        if (open) { d.hidden = false; li.querySelector(".dmore").textContent = "收起 ‹"; preDetail(s, d); }
      };
      if (dayState.open === s.id) { li.querySelector(".ddet").hidden = false; li.querySelector(".dmore").textContent = "收起 ‹"; preDetail(s, li.querySelector(".ddet")); }
    });
  }
  /* ---------- 赛前详情（未来日期也能点开）：全部只显示，不写回模型 ---------- */
  var pre = { odds: null, oddsT: 0, sched: {}, timer: 0, sig: {}, chg: {} };
  function getJSON(u) { return fetch(u + (u.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw 0; return r.json(); }); }
  function loadOdds() {
    if (pre.odds && Date.now() - pre.oddsT < 60000) return Promise.resolve(pre.odds);
    return getJSON("pre_odds.json").then(function (j) { pre.odds = j; pre.oddsT = pre.oddsOk = Date.now(); return j; }, function () { return pre.odds || null; });
  }
  function loadSched(tid) {
    var c = pre.sched[tid]; if (c && Date.now() - c.t < 600000) return Promise.resolve(c);
    if (!tid) return Promise.resolve(null);
    return getJSON("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/" + tid + "/schedule").then(function (j) {
      var gs = [];
      (j.events || []).forEach(function (e) {
        var c0 = (e.competitions || [])[0] || {}, ty = ((c0.status || {}).type) || {};
        if (!ty.completed || ((e.seasonType || {}).type && (e.seasonType || {}).type !== 2)) return;
        var me = null, op = null; (c0.competitors || []).forEach(function (t) { if (String((t.team || {}).id) === String(tid)) me = t; else op = t; });
        if (!me || !op) return;
        var sv = function (t) { var x = t.score; return x && typeof x === "object" ? +x.value : +x; };
        gs.push({ d: e.date, w: !!me.winner, pf: sv(me), pa: sv(op) });
      });
      gs.sort(function (a, b) { return a.d < b.d ? -1 : 1; });
      c = { t: Date.now(), at: ptTime(new Date().toISOString()), gs: gs }; pre.sched[tid] = c; return c;
    }, function () { return c || null; });
  }
  function signLine(cnFav, x) { return cnFav + " -" + (Math.round(Math.abs(x) * 100) / 100); }
  function formHtml(cn, c) {
    if (!c || !c.gs.length) return '<div class="pd-row">' + esc(cn) + "：暂无</div>";
    var l5 = c.gs.slice(-5), w = 0, pf = 0, pa = 0, sw = 0;
    l5.forEach(function (g) { if (g.w) w++; pf += g.pf; pa += g.pa; });
    c.gs.forEach(function (g) { if (g.w) sw++; });
    var seq = l5.map(function (g) { return '<i class="' + (g.w ? "fw" : "fl") + '">' + (g.w ? "胜" : "负") + "</i>"; }).join("");
    return '<div class="pd-row"><b>' + esc(cn) + "</b> 本季 " + sw + "胜" + (c.gs.length - sw) + "负 · 近 " + l5.length + " 场 " + w + "胜" + (l5.length - w) + "负 " + seq +
      '<br><small>近 ' + l5.length + " 场场均得分 " + (Math.round(pf / l5.length * 10) / 10) + " · 失分 " + (Math.round(pa / l5.length * 10) / 10) + "</small></div>";
  }
  function rolesHtml(ab, cn) {
    var P = window.PBP || {}, R = P.roles || {}, list = [];
    for (var id in R) if (nbaAb(R[id].team) === ab && (R[id].role === "核心" || R[id].role === "主力")) list.push(id);
    list.sort(function (a, b) { return (R[a].role === R[b].role ? 0 : R[a].role === "核心" ? -1 : 1) || R[b].ppg - R[a].ppg; });
    if (!list.length) return '<div class="pd-row">' + esc(cn) + "：暂无</div>";
    return '<div class="pd-row"><b>' + esc(cn) + "</b>" + list.map(function (id) {
      var z = (P.zh && P.zh[id] && (P.zh[id].zh_short || P.zh[id].zh)) || R[id].en;
      return '<span class="pd-p' + (R[id].role === "核心" ? " core" : "") + '">' + esc(z) + P.roleTag(id) + "</span>";
    }).join("") + "</div>";
  }
  function startersHtml(s) {
    var P = window.PBP || {}, tip = Date.parse(s.date || "") || 0;
    var empty = function () { return P.stHtml ? P.stHtml([{ cn: TEAM_CN[s.aab] || s.aab, side: "a", ids: [] }, { cn: TEAM_CN[s.hab] || s.hab, side: "h", ids: [] }], "开赛前 1 小时起每 30 秒自动查看") : '<p class="note">首发未公布</p>'; };
    if (!tip || tip - Date.now() > 3600000) return Promise.resolve(empty());
    return getJSON("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=" + s.id).then(function (j) {
      var any = false, groups = [];
      (((j.boxscore || {}).players) || []).forEach(function (t) {
        var ab = nbaAb((t.team || {}).abbreviation), ids = [];
        ((((t.statistics || [])[0] || {}).athletes) || []).forEach(function (a) { if (a.starter) { var at = a.athlete || {}; ids.push({ id: String(at.id || ""), en: at.displayName || "", pos: (at.position || {}).abbreviation || "" }); } });
        if (ids.length) any = true;
        groups.push({ cn: TEAM_CN[ab] || ab, side: ab === s.hab ? "h" : "a", ids: ids });
      });
      groups.sort(function (x, y) { return x.side === "h" ? 1 : -1; });
      return any && P.stHtml ? P.stHtml(groups, "官方首发（ESPN starter 字段）· " + ptTime(new Date().toISOString()) + " 获取") : empty();
    }, empty);
  }
  function preDetail(s, d) {
    clearTimeout(pre.timer);
    var an = TEAM_CN[s.aab] || s.aab, hn = TEAM_CN[s.hab] || s.hab, P = window.PBP || {};
    var dt = ""; try { dt = new Intl.DateTimeFormat("zh-CN", { timeZone: "America/Los_Angeles", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(s.date)); } catch (e) {}
    if (!d.innerHTML) d.innerHTML = '<p class="note">读取中…</p>';
    var tl = [{ id: s.aid, cn: an, ab: s.aab, side: "a" }, { id: s.hid, cn: hn, ab: s.hab, side: "h" }];
    Promise.all([P.prep ? P.prep() : null, loadOdds(), loadSched(s.aid), loadSched(s.hid), startersHtml(s)]).then(function (r) {
      if (dayState.open !== s.id) return;
      var O = r[1] || {}, og = (O.games || {})[s.id], h = "";
      h += '<div class="pd-h">开赛时间</div><div class="pd-row">' + esc(dt || s.tip) + "（太平洋时间）</div>";
      h += '<div class="pd-h">当前盘口 <small>只显示，不影响模型</small></div>';
      if (og && og.med_line_home != null) {
        var ml = og.med_line_home;
        h += '<div class="pd-row">多家中位数（' + esc(og.books.map(function (b) { return b.book; }).join("、")) + " 共 " + og.n + " 家）：让分 <b>" + esc(ml === 0 ? "平手" : ml < 0 ? signLine(hn, ml) : signLine(an, ml)) + "</b>" + (og.med_total != null ? " · 总分 <b>" + og.med_total + "</b>" : "") +
          "<br><small>来源 ESPN 公开盘口 + Pinnacle 公开盘 · 更新于 " + esc(String(O.lines_updated_pt || "").slice(5, 16)) + " 太平洋时间</small></div>";
      } else h += '<div class="pd-row">多家中位数：暂无</div>';
      var cr = null; (O.crown || []).forEach(function (c) { if (c.game === an + "@" + hn) cr = c; });
      h += cr ? '<div class="pd-row">皇冠：让分 ' + esc(cr.crown_spread_now || "暂无") + " · 总分 " + esc(cr.crown_total_now || "暂无") + "<br><small>读取于 " + esc(cr.read_at || "") + "</small></div>" : '<div class="pd-row">皇冠：暂无</div>';
      h += '<div class="lu-blk">' + r[4] + (P.absHtml ? P.absHtml(s.aab, s.hab, tl, {}) : '<p class="note">缺阵名单暂无</p>') + "</div>";
      h += '<div class="pd-h">各队分量 <small>来源 ESPN 本赛季场均</small></div>' + rolesHtml(s.aab, an) + rolesHtml(s.hab, hn);
      var at = (r[2] && r[2].at) || (r[3] && r[3].at) || "";
      h += '<div class="pd-h">近况 <small>来源 ESPN 球队赛程 · ' + esc(at) + " 获取</small></div>" + formHtml(an, r[2]) + formHtml(hn, r[3]);
      h = h.replace(/<div class="pd-row">([\s\S]*?)<\/div>/g, function (m0, inner) { // 每行内容变了：短暂高亮 + “刚更新 HH:MM”
        var key = s.id + "|" + inner.replace(/<[^>]+>/g, "").slice(0, 6), sig = inner.replace(/(更新于|读取于|获取)[^<]*/g, ""), pv = pre.sig[key], fl = "";
        if (pv != null && pv !== sig) { pre.chg[key] = { t: Date.now(), hm: hm() }; fl = " flash"; }
        pre.sig[key] = sig; var cg = pre.chg[key];
        return '<div class="pd-row' + fl + '">' + inner + (cg && Date.now() - cg.t < 1800000 ? '<i class="upd">刚更新 ' + cg.hm + "</i>" : "") + "</div>";
      });
      if (d._h !== h) { d._h = h; d.innerHTML = h; }
      var tip = Date.parse(s.date || "") || 0, near = tip && tip - Date.now() < 3600000 && s.state === "pre";
      pre.timer = setTimeout(function () { if (dayState.open === s.id && !d.hidden && document.visibilityState === "visible") preDetail(s, d); }, near ? 30000 : 60000);
    });
  }

  /* ---------- 拉取与自动刷新 ---------- */
  function load(first) {
    return fetch("data.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      if (!d || typeof d !== "object") throw new Error("bad json");
      var changed = d.generated_at !== state.gen;
      state.okT = Date.now();
      state.data = d; state.gen = d.generated_at;
      var lp = loadLeisu().catch(function () {});
      if (first) {
        // 只有上面的读取/解析失败才算“读取失败”；渲染出错只影响对应板块，加载动画一定收起
        return Promise.race([lp, new Promise(function (r) { setTimeout(r, 300); })]).then(function () { return loaderFeed(d); }).catch(function () {}).then(function () {
          safe("整页", function () { renderAll(true); });
          state.shown = true; hideLoader(); lp.then(function () { safe("雷速按钮", function () { var g = game(); if (g) renderLeisu(g); }); }); safe("比分", function () { pollScores(); }); safe("恢复", function () { FR.restore(); }); safe("导航", function () { FR.nav.build(); var t0 = null; try { t0 = sessionStorage.getItem("nba_tab"); } catch (e) {} FR.nav.set(/^(gl|gd|lv|pr|hs)$/.test(t0 || "") ? t0 : "gl", true); });
        });
      }
      lp.then(function () { safe("雷速按钮", function () { var g = game(); if (g) renderLeisu(g); }); });
      if (changed) { var snap = {}; DATA_CARDS.forEach(function (k) { var e = $(k); if (e) snap[k] = e.innerHTML.replace(/<p class="chk"[\s\S]*?<\/p>/, ""); });
        safe("整页", function () { renderAll(false); });
        DATA_CARDS.forEach(function (k) { var e = $(k); if (e && snap[k] != null && snap[k] !== e.innerHTML.replace(/<p class="chk"[\s\S]*?<\/p>/, "")) { FR.upd[k] = { hm: hm(), t: Date.now() }; var c = e.closest(".card") || e; c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash"); } }); safe("日期页", function () { var c = dayState.cache[dayState.sel]; if (dayState.sel !== dayState.today && c) drawDay(dayState.sel, dayState.iso, c.events); }); toast("数据已更新 · " + String(d.generated_at || "").slice(11, 16)); }
    }, function (e) {
      if (first) { var t = document.querySelector(".ld-title"); if (t) t.textContent = "数据读取失败，60 秒后自动重试"; state.loadFailed = true; }
      else toast("刷新失败，先显示上次的数据");
    });
  }
  setInterval(function () {
    state.left -= 1;
    if (state.left <= 0) {
      state.left = REFRESH;
      if (!state.shown && state.loadFailed) { location.reload(); return; } // 首次失败：整页重载，顺便拿到最新的脚本
      load(!state.shown);
    }
  }, 1000);
  /* ---------- 防旧信息：每块记录“最后一次成功检查”；超过应有间隔 2 倍还没成功 → 顶部红色横幅 + 该块变灰盖“数据已旧” + 语音播报一次 ---------- */
  function hms(t, sec) { try { return new Intl.DateTimeFormat("zh-CN", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", second: sec === false ? undefined : "2-digit", hour12: false }).format(new Date(t)); } catch (e) { return ""; } }
  function hm() { return hms(Date.now(), false); }
  var DATA_CARDS = ["hero", "scale", "odds", "edge", "factors", "inj"];
  var FR = { upd: {}, grace: Date.now(), spoke: false, on: false };
  window.FRESH = FR;
  function PB() { return window.PBP || {}; }
  function todayView() { return state.shown && !$("app").classList.contains("day-mode"); }
  function curState() { var g = state.data && game(), s = g && liveFor(g); return s ? s.state : null; }
  function cardOf(id) { var e = $(id); return e ? (e.closest(".card") || e) : null; }
  function near() { var P = PB(); return P.tipMs && P.tipMs - Date.now() < 3600000; }
  // 应有间隔（毫秒）：比分/文字直播 前台 2 秒一轮 + 单次请求最长 5 秒超时，按 5 秒算；其余按各自轮询间隔
  var BLOCKS = [
    { k: "score", name: "比分", on: function () { return todayView(); }, exp: function () { return anyLive() ? 5000 : 120000; }, last: function () { return live.okT; }, cards: function () { return [$("liveTop"), $("courtCard")]; }, chk: null },
    { k: "pbp", name: "文字直播", on: function () { return todayView() && curState() === "in" && PB().gid; }, exp: function () { return 5000; }, last: function () { return PB().okT; }, cards: function () { return [cardOf("pbp"), $("statusCard")]; }, chk: ["pbp", "statusCard"] },
    { k: "lineup", name: "首发·缺阵", on: function () { return todayView() && PB().gid && curState() !== "post"; }, exp: function () { return curState() === "pre" && near() ? 30000 : 60000; }, last: function () { var P = PB(); return Math.min(P.sumOkT || 0, (P.inj || {}).okT || 0); }, cards: function () { return [$("lineupCard")]; }, chk: ["lineupCard"] },
    { k: "data", name: "预测和盘口", on: function () { return todayView(); }, exp: function () { return REFRESH * 1000; }, last: function () { return state.okT; }, cards: function () { return DATA_CARDS.map(cardOf); }, chk: DATA_CARDS },
    { k: "day", name: "赛程", on: function () { return state.shown && dayState.sel > dayState.today; }, exp: function () { return 120000; }, last: function () { return (dayState.okT || {})[dayState.sel]; }, cards: function () { return [$("dayView")]; }, chk: ["dayView"] },
    { k: "pre", name: "赛前详情", on: function () { return state.shown && !!dayState.open && !!document.querySelector(".ddet:not([hidden])"); }, exp: function () { return 60000; }, last: function () { return Math.min(pre.oddsOk || 0, (PB().inj || {}).okT || 0); }, cards: function () { var d = document.querySelector(".ddet:not([hidden])"); return [d]; }, chk: null }
  ];
  function paintChk(id, b, t) {
    var c = cardOf(id); if (!c) return;
    var p = null; for (var i = 0; i < c.children.length; i++) if (c.children[i].className === "chk") p = c.children[i];
    if (!p) { p = document.createElement("p"); p.className = "chk"; c.appendChild(p); }
    var u = FR.upd[id], tx = "最后检查 " + (t ? hms(t) : "—") + "（太平洋时间）" + (u && Date.now() - u.t < 1800000 ? " · 刚更新 " + u.hm : "");
    if (p.textContent !== tx) p.textContent = tx;
  }
  function freshCheck() {
    var now = Date.now(), bad = [], st = [], all = [], offT = 0;
    for (var ck in FR.cache) if (!offT || FR.cache[ck] < offT) offT = FR.cache[ck];
    if (document.visibilityState !== "visible") return; // 后台时浏览器会压慢定时器，不判断
    BLOCKS.forEach(function (b) {
      var on = !!b.on(), cs = (b.cards() || []).filter(Boolean);
      cs.forEach(function (c) { if (all.indexOf(c) < 0) all.push(c); });
      if (!on) { b.since = 0; return; }
      if (!b.since) b.since = now;
      var t = b.last() || 0, ref = Math.max(t, b.since, FR.grace), x = !!offT || now - ref > 2 * b.exp();
      if (b.chk) b.chk.forEach(function (id) { paintChk(id, b, t); });
      if (x) { bad.push(b.name); cs.forEach(function (c) { if (st.indexOf(c) < 0) st.push(c); }); }
    });
    all.forEach(function (c) { var y = st.indexOf(c) >= 0; if (c.classList.contains("stale") !== y) c.classList.toggle("stale", y); });
    var bar = $("staleBar"), on = bad.length > 0;
    if (bar) { var h = on ? (offT ? "⚠ 数据已旧：现在离线<small>显示的是 " + esc(hms(offT)) + "（太平洋时间）缓存的数据，联网后自动刷新</small>" : "⚠ 数据已旧，正在重连<small>" + esc(bad.join("、")) + "</small>") : ""; if (bar._h !== h) { bar._h = h; bar.innerHTML = h; bar.hidden = !on; document.documentElement.classList.toggle("stl", on); } }
    if (on && !FR.spoke) { FR.spoke = true; var V = window.VOICE; if (V && V.say && V.unlocked && !V.muted) V.say("数据已断开，正在重连", false, true); }
    if (!on) FR.spoke = false;
    if (offT && !on) { bar.innerHTML = "⚠ 数据已旧：现在离线<small>显示的是 " + esc(hms(offT)) + "（太平洋时间）缓存的数据</small>"; bar.hidden = false; }
    FR.on = on; FR.bad = bad;
  }
  setInterval(freshCheck, 1000);
  // 回到前台 / 切回页面 / 恢复网络：立刻重查所有数据（节流 5 秒），并给 8 秒宽限，避免刚回来就误报
  function wake(why) {
    if (!state.data) return;
    if (why !== "online") FR.grace = Date.now();
    if (Date.now() - (FR.wokeAt || 0) < 5000) return; FR.wokeAt = Date.now();
    try { if (FR.swReg && FR.swReg.update) FR.swReg.update(); } catch (e) {} // 回到前台顺手检查新版 SW
    live.busy = false; pollScores();
    var P = PB(); if (P.inj) P.inj.t = 0; P.irT = 0; P.preT = 0; if (P.kick) P.kick();
    if (Date.now() - (state.okT || 0) > 15000) load(false);
    if (dayState.sel > dayState.today) { refreshDay(dayState.sel, dayState.iso); pre.oddsT = 0; }
    checkVer();
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") wake("vis"); });
  window.addEventListener("pageshow", function (e) { if (e.persisted) wake("show"); });
  window.addEventListener("focus", function () { wake("focus"); });
  window.addEventListener("online", function () { wake("online"); });

  /* ---------- 网站代码有新版本（version.json 由提交钩子生成）：空闲时自动刷新页面，保留所选比赛/日期/滚动位置；数据文件更新不触发 ---------- */
  var VER = (/app\.js\?v=([A-Za-z0-9]+)/.exec((document.querySelector('script[src*="app.js"]') || {}).src || "") || [])[1] || "";
  var lastAct = 0;
  ["pointerdown", "touchstart", "keydown", "scroll", "wheel"].forEach(function (k) { window.addEventListener(k, function () { lastAct = Date.now(); }, { passive: true, capture: true }); });
  function checkVer() {
    if (!VER || FR.newVer) return tryReload();
    fetch("version.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (j && j.v && j.v !== VER) { FR.newVer = j.v; if (FR.swReg) FR.swReg.update().catch(function () {}); tryReload(); }
    }).catch(function () {});
  }
  function tryReload() {
    if (!FR.newVer) return;
    var V = window.VOICE || {};
    if (V.busy || Date.now() - lastAct < 15000) { clearTimeout(FR.rt); FR.rt = setTimeout(tryReload, 5000); return; } // 正在播报或用户正在操作：稍后再试
    try { sessionStorage.setItem("nba_reload", JSON.stringify({ day: dayState.sel !== dayState.today ? dayState.sel : null, iso: dayState.iso, open: dayState.open || null, y: window.scrollY, voice: !!(V.unlocked && !V.muted), t: Date.now() })); } catch (e) {}
    try { if (state.sel) localStorage.setItem("nba_sel", state.sel); } catch (e) {}
    location.reload();
  }
  setInterval(checkVer, 60000);
  // 自动刷新后恢复：日期、展开的赛前详情、滚动位置；之前开着语音就提示“点一下继续”（iPhone 必须点一下才能出声）
  function restoreAfterReload() {
    var r = null; try { r = JSON.parse(sessionStorage.getItem("nba_reload") || "null"); sessionStorage.removeItem("nba_reload"); } catch (e) {}
    if (!r || Date.now() - r.t > 120000) return;
    if (r.day && r.iso) { dayState.open = r.open; var b = document.querySelector('.dchip[data-day="' + r.day + '"]'); if (b) selectDay(r.day, r.iso); }
    setTimeout(function () { window.scrollTo(0, r.y || 0); }, 300);
    var h = document.querySelector(".vhint"); if (r.voice && h && !h.classList.contains("gone")) h.textContent = "网站已自动更新到新版，点一下页面继续语音解说";
    toast("网站已自动更新到新版");
  }
  FR.restore = restoreAfterReload;
  /* ---------- 主屏 App：Service Worker、离线缓存标记、底部导航、禁止缩放 ---------- */
  // 数据请求网络优先；只有断网时 SW 才返回上次缓存，并带 x-sw-cache（缓存时间）。这里记下来，防旧检查据此亮红色横幅，不让旧数据冒充新数据
  FR.cache = {};
  if (window.fetch) { var _fetch = window.fetch.bind(window); window.fetch = function (u, o) { return _fetch(u, o).then(function (r) { try { var key = String((u && u.url) || u).replace(/([?&])t=\d+&?/, "$1").replace(/[?&]$/, ""), c = r.headers.get("x-sw-cache"); if (c) FR.cache[key] = +c; else if (r.ok && /\.json|site\.api\.espn\.com/.test(key)) FR.cache = {}; /* 网络恢复：有一份新数据到达就撤销离线标记，其余块交给“2 倍间隔”检查 */ } catch (e) {} return r; }); }; }
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(function (r) { FR.swReg = r; }).catch(function () {});
  if (navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches)) document.documentElement.classList.add("standalone");
  // 禁止误缩放：iOS 会忽略 user-scalable=no，所以再拦双指和双击
  ["gesturestart", "gesturechange"].forEach(function (k) { document.addEventListener(k, function (e) { e.preventDefault(); }, { passive: false }); });
  document.addEventListener("touchmove", function (e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  var lastTouch = 0;
  document.addEventListener("touchend", function (e) { var n = Date.now(); if (n - lastTouch < 300 && !(e.target.closest && e.target.closest("input,select,textarea"))) e.preventDefault(); lastTouch = n; }, { passive: false });
  // 底部四个标签 = 四个独立页面（同一页面内切换，不跳转、不白屏，各自记住滚动位置）
  //   比赛 gl：当天比赛卡片列表 → 点进去 gd：单场完整页面；直播 lv：只看进行中的比赛，没有就显示下一场倒计时；赛前 pr：未开打比赛的首发/缺阵/回归/盘口；战绩 hs：模型方向命中率
  var NAV = { pg: "gl", y: {} };
  var ICO = { gl: '<path d="M3 5h18v14H3z"/><path d="M12 5v14M3 12h18"/>', pr: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>', lv: '<circle cx="12" cy="12" r="3"/><path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>', hs: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' };
  function tabOf(pg) { return pg === "gd" ? "gl" : pg; }
  function mk(id, cls, html, after) { var e = document.createElement("section"); e.id = id; e.className = cls; e.innerHTML = html || ""; (after ? after.parentNode.insertBefore(e, after.nextSibling) : $("app").insertBefore(e, $("app").firstChild)); return e; }
  function buildNav() {
    var n = document.createElement("nav"); n.className = "bnav"; n.setAttribute("aria-label", "页面导航");
    n.innerHTML = [["gl", "比赛"], ["lv", "直播"], ["pr", "赛前"], ["hs", "战绩"]].map(function (x) { return '<button data-t="' + x[0] + '"><svg viewBox="0 0 24 24">' + ICO[x[0]] + "</svg>" + x[1] + "<i></i></button>"; }).join("");
    document.body.appendChild(n);
    n.querySelectorAll("button").forEach(function (b) { b.onclick = function () { var t = b.getAttribute("data-t"); setTab(t === "gl" && NAV.pg === "gl" ? "gl" : t); }; });
    var app = $("app");
    mk("gameList", "card p-gl", "", $("dayView"));
    mk("backBar", "backbar p-gd", '<button type="button">‹ 返回比赛列表</button>', $("dayView")).querySelector("button").onclick = function () { setTab("gl"); };
    mk("liveNone", "card p-lv nolive", "", $("gameTabs"));
    mk("preView", "card p-pr", '<div class="skel"></div><div class="skel"></div>', $("gameTabs"));
    $("dateBar").classList.add("p-gl"); $("dayView").classList.add("p-gl");
    ["gameTabs", "alertBar", "liveTop", "hero", "courtCard", "statusCard", "lineupCard"].forEach(function (k) { var e = $(k); if (e) e.classList.add("p-gd"); });
    ["gameTabs", "alertBar", "liveTop", "courtCard", "statusCard"].forEach(function (k) { var e = $(k); if (e) e.classList.add("p-lv"); });
    var pc = cardOf("pbp"); if (pc) pc.classList.add("p-gd", "p-lv");
    ["scale", "odds", "edge", "feed", "factors", "inj", "missing"].forEach(function (k) { var c = cardOf(k); if (c) c.classList.add("p-gd", "model-card"); });
    var hc = cardOf("hist"); if (hc) hc.classList.add("p-hs");
  }
  function paintNav() {
    var t = tabOf(NAV.pg);
    document.querySelectorAll(".bnav button").forEach(function (b) { var k = b.getAttribute("data-t"); b.classList.toggle("on", k === t); if (k === "lv") b.classList.toggle("haslive", anyLive()); });
  }
  function navSync() { paintNav(); }
  function setTab(pg, keep) {
    if (!state.shown) return;
    var main = $("app"), old = NAV.pg;
    if (!keep) NAV.y[old] = window.scrollY;
    NAV.pg = pg; main.setAttribute("data-pg", pg);
    if (pg !== "gl" && dayState.sel !== dayState.today) selectDay(dayState.today, ptParts(new Date()).iso); // 其他页面都只看今天
    if (pg === "lv") { var lv = null; (live.events || []).forEach(function (e) { if (!lv && e.state === "in") lv = e; }); if (lv && state.sel !== lv.id) { var tb = document.querySelector('#gameTabs .tab[data-id="' + lv.id + '"]'); if (tb) tb.click(); } }
    if (pg === "pr") drawPre();
    if (pg === "gl") drawGameList();
    paintPage(); paintNav();
    try { sessionStorage.setItem("nba_tab", pg); } catch (e) {}
    if (old !== pg || keep) { var y = NAV.y[pg] || 0; window.scrollTo(0, y); requestAnimationFrame(function () { window.scrollTo(0, y); }); }
  }
  // 每秒刷新：比赛列表比分、直播页的进行中筛选和倒计时
  function paintPage() {
    if (!state.shown) return;
    var pg = NAV.pg;
    if (pg === "gl") drawGameList();
    var any = anyLive();
    document.querySelectorAll("#gameTabs .tab[data-id]").forEach(function (b) { var s = live.byId[b.getAttribute("data-id")]; var hide = pg === "lv" && !(s && s.state === "in"); if ((b.style.display === "none") !== hide) b.style.display = hide ? "none" : ""; });
    $("app").classList.toggle("lv-none", pg === "lv" && !any);
    if (pg === "lv") {
      var box = $("liveNone"), h;
      if (any) h = "";
      else {
        var nx = null, cand = (live.events || []).filter(function (e) { return e.state === "pre" && e.date; });
        var tk = tomorrowKey(), c = dayState.cache[tk]; if (!cand.length && c) cand = c.events.filter(function (e) { return e.state === "pre" && e.date; });
        if (!cand.length && !c && !NAV.fetchedT) { NAV.fetchedT = 1; refreshDay(tk, tk.slice(0, 4) + "-" + tk.slice(4, 6) + "-" + tk.slice(6)); }
        cand.sort(function (a, b) { return a.date < b.date ? -1 : 1; }); nx = cand[0];
        if (!nx) h = '<p class="note">现在没有进行中的比赛，今明两天的赛程暂时没读到。</p>';
        else {
          var ms = Date.parse(nx.date) - Date.now(), sec = Math.max(0, Math.floor(ms / 1000)), hh = Math.floor(sec / 3600), mm = Math.floor(sec % 3600 / 60), ss = sec % 60;
          var at = ""; try { at = new Intl.DateTimeFormat("zh-CN", { timeZone: "America/Los_Angeles", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(nx.date)); } catch (e) {}
          h = '<div class="cd-h">现在没有进行中的比赛</div><div class="cd-g">下一场 ' + esc((TEAM_CN[nx.aab] || nx.aab) + " @ " + (TEAM_CN[nx.hab] || nx.hab)) + '</div><div class="cd-t">' + (ms > 0 ? (hh ? hh + " 小时 " : "") + (mm < 10 && hh ? "0" : "") + mm + " 分 " + (ss < 10 ? "0" : "") + ss + " 秒" : "即将开赛") + '</div><div class="cd-s">开赛时间 ' + esc(at) + "（太平洋时间，ESPN 赛程）</div>";
        }
      }
      if (box._h !== h) { box._h = h; box.innerHTML = h; box.hidden = !h; }
    }
  }
  function tomorrowKey() { return ptParts(new Date(Date.now() + 86400000)).key; }
  function gameCard(id, an, hn, mid, sub, cls) { return '<li class="gcard' + (cls || "") + '" data-id="' + esc(id) + '"><div class="gc-t"><b>' + esc(an) + '</b><span class="gc-m">' + mid + '</span><b>' + esc(hn) + '</b></div><div class="gc-s">' + sub + "</div></li>"; }
  function drawGameList() {
    var box = $("gameList"); if (!box || !state.data) return;
    var h = '<h2>今天的比赛 <small class="dim">点开看单场（比分、动画、文字直播、预测）</small></h2><ul class="glist">' + allGames().map(function (g) {
      var s = dispOf(liveFor(g)), ms = mainSpread(g), p = ms && ms.v8 ? "第八版：" + ms.pick_text : g.nomodel ? "本场模型未预测" : ms ? "模型：" + ms.pick_text : "暂无结论";
      var st = !s || s.state === "pre" ? '<i class="gc-tip">' + esc(String((s && s.tip) || g.tip_pt || "时间待定").replace(/ PT$/, "")) + "</i>" : '<i class="gc-sc">' + s.as + " : " + s.hs + '</i><i class="gc-st' + (s.state === "in" ? " on" : "") + '">' + esc(statusCn(s)) + "</i>";
      return gameCard(g.espn_id, g.away_cn, g.home_cn, st, esc(p), s && s.state === "in" ? " live" : "");
    }).join("") + "</ul>";
    if (box._h !== h) {
      box._h = h; box.innerHTML = h;
      box.querySelectorAll(".gcard").forEach(function (li) { li.onclick = function () { var id = li.getAttribute("data-id"), tb = document.querySelector('#gameTabs .tab[data-id="' + id + '"]'); NAV.y.gd = 0; setTab("gd"); if (tb && state.sel !== id) tb.click(); window.scrollTo(0, 0); }; });
    }
  }
  function drawPre() {
    var box = $("preView"), tk = tomorrowKey(), c = dayState.cache[tk];
    if (!c && !NAV.preFetch) { NAV.preFetch = 1; refreshDay(tk, tk.slice(0, 4) + "-" + tk.slice(4, 6) + "-" + tk.slice(6)).then(function () { NAV.preFetch = 0; if (NAV.pg === "pr") drawPre(); }); }
    var today = (live.events || []).filter(function (e) { return e.state === "pre"; }), tm = c ? c.events : null;
    function list(evs) { return '<ul class="daylist">' + evs.map(function (s) { return '<li class="dli" data-id="' + esc(s.id) + '"><div class="tm2"><span>' + esc((TEAM_CN[s.aab] || s.aab) + " @ " + (TEAM_CN[s.hab] || s.hab)) + '</span><span class="st2">' + esc(s.tip) + ' 开赛</span></div><div class="dmore">点开看首发、缺阵、回归、盘口 ›</div><div class="ddet" hidden></div></li>'; }).join("") + "</ul>"; }
    var h = '<h2>赛前 <small class="dim">未开打的比赛 · 太平洋时间</small></h2><div class="pv-h">今天</div>' + (today.length ? list(today) : '<p class="note">今天的比赛都已开打或结束。</p>') +
      '<div class="pv-h">明天 ' + (+tk.slice(4, 6)) + "/" + (+tk.slice(6)) + "</div>" + (tm ? (tm.length ? list(tm) : '<p class="note">明天没有比赛。</p>') : '<div class="skel"></div><div class="skel"></div>');
    if (box._h === h) return; box._h = h; box.innerHTML = h;
    var all = today.concat(tm || []);
    box.querySelectorAll(".dli").forEach(function (li) {
      var s = null; all.forEach(function (e) { if (e.id === li.getAttribute("data-id")) s = e; });
      var d = li.querySelector(".ddet");
      li.querySelector(".tm2").onclick = li.querySelector(".dmore").onclick = function () {
        var open = d.hidden; box.querySelectorAll(".ddet").forEach(function (x) { x.hidden = true; }); box.querySelectorAll(".dmore").forEach(function (x) { x.textContent = "点开看首发、缺阵、回归、盘口 ›"; });
        dayState.open = open ? s.id : null;
        if (open) { d.hidden = false; li.querySelector(".dmore").textContent = "收起 ‹"; preDetail(s, d); }
      };
      if (dayState.open === s.id) { d.hidden = false; li.querySelector(".dmore").textContent = "收起 ‹"; preDetail(s, d); }
    });
  }
  setInterval(function () { if (state.shown) { paintNav(); paintPage(); } }, 1000);
  FR.nav = { set: setTab, sync: navSync, build: buildNav, state: NAV };
  load(true);
})();
