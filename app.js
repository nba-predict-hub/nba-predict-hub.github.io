/* NBA 智能预测 —— 纯前端，只读取 data.json；没有的数据显示“缺”。 */
(function () {
  "use strict";
  var REFRESH = 60;
  var state = { data: null, sel: null, gen: null, left: REFRESH };
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function miss(note) { return '<span class="miss" title="' + esc(note || "") + '">缺</span>'; }
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
  function bandPill(b) { b = b || "缺"; return '<span class="pill ' + esc(b) + '">把握度 ' + esc(b) + "</span>"; }
  function toast(msg) { var t = $("toast"); t.textContent = msg; t.classList.add("on"); setTimeout(function () { t.classList.remove("on"); }, 2600); }

  /* ---------- 开场加载动画 ---------- */
  var loaderStart = Date.now();
  function loaderFeed(d) {
    var list = $("ldList"), items = (d.sources || []).map(function (s) { return "读取 " + s.name; });
    items.push("核对缺失数据 " + (d.missing || []).length + " 项");
    items.push("生成今日结论 " + (d.games || []).length + " 场");
    var i = 0;
    return new Promise(function (res) {
      (function next() {
        if (i >= items.length) return res();
        var li = document.createElement("li"); li.textContent = items[i]; li.className = "ok";
        list.appendChild(li); list.scrollTop = list.scrollHeight;
        $("ldBar").style.width = Math.round(100 * (i + 1) / items.length) + "%";
        i++; setTimeout(next, Math.max(60, 1400 / items.length));
      })();
    });
  }
  function hideLoader() {
    var wait = Math.max(0, 1600 - (Date.now() - loaderStart));
    setTimeout(function () { $("loader").classList.add("done"); revealCards(); }, wait);
  }
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
  function game() {
    var d = state.data, id = state.sel;
    return (d.games || []).filter(function (g) { return g.espn_id === id; })[0] || (d.games || [])[0];
  }
  function renderAll(first) {
    var d = state.data;
    $("genAt").textContent = "数据生成 " + (d.generated_at || "缺") + " · 最新锁定 " + (d.last_lock || "缺");
    $("footGen").textContent = "data.json 生成于 " + (d.generated_at || "缺");
    if (!state.sel || !(d.games || []).some(function (g) { return g.espn_id === state.sel; })) state.sel = d.featured || ((d.games || [])[0] || {}).espn_id;
    renderTabs(); renderGame(); renderFeed(); renderHist(); renderMissing();
    if (!first) document.querySelectorAll(".card.in").forEach(animateIn);
  }
  function renderTabs() {
    var d = state.data;
    $("gameTabs").innerHTML = (d.games || []).map(function (g) {
      var p = g.spread ? g.spread.pick_text : "缺";
      return '<button class="tab' + (g.espn_id === state.sel ? " on" : "") + '" data-id="' + esc(g.espn_id) + '"><b>' + esc(g.away_cn) + " @ " + esc(g.home_cn) +
        "</b><span>" + esc(g.tip_pt || "时间缺") + (g.game_status && g.game_status !== "pre" ? " · " + esc(g.game_status_cn) : "") + " · " + esc(p) + "</span></button>";
    }).join("") + ((d.unlocked_games || []).length ? '<button class="tab" disabled><b class="dim">另 ' + d.unlocked_games.length + ' 场</b><span>锁定时已开赛，无模型结论</span></button>' : "");
    $("gameTabs").querySelectorAll(".tab[data-id]").forEach(function (b) {
      b.onclick = function () {
        state.sel = b.getAttribute("data-id"); renderTabs(); renderGame();
        document.querySelectorAll(".card.in").forEach(animateIn);
      };
    });
  }
  function renderGame() {
    var g = game(); if (!g) { $("hero").innerHTML = "<p>今日没有锁定的比赛（缺）。</p>"; return; }
    renderHero(g); drawCourtSetup(g); renderScale(g); renderOdds(g); renderEdge(g); renderFactors(g); renderInj(g);
  }
  function renderHero(g) {
    var d = state.data, mv = d.model_version || {}, sp = g.spread, to = g.total, h = "";
    h += '<div class="vs"><div class="team h"><div class="ab">主 · ' + esc(g.home) + '</div><div class="nm">' + esc(g.home_cn) + '</div><div class="ab">' + esc(g.records[g.home] || "战绩缺") + "</div></div>";
    h += '<div class="mid"><b>VS</b>' + esc(g.tip_pt || "时间缺") + "<br>" + esc(g.venue || "") + (g.game_status ? "<br>" + esc(g.game_status_cn) : "") + "</div>";
    h += '<div class="team a"><div class="ab">客 · ' + esc(g.away) + '</div><div class="nm">' + esc(g.away_cn) + '</div><div class="ab">' + esc(g.records[g.away] || "战绩缺") + "</div></div></div>";
    h += '<div class="verdicts">';
    if (sp) {
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
    function rec(r) { return r && r.graded ? (r.w + "胜 " + r.l + "负 " + r.p + "走（" + (r.pct == null ? "—" : r.pct + "%") + "）") : '<span class="miss">缺</span>（台账还没有赛后结果）'; }
    h += '<div class="ver">当前版本：<b>' + esc(g.version_cn || "缺") + "</b> · 让分用 " + esc(sp ? sp.model_label : "缺") + " · 大小分用 " + esc(to ? to.model_label : "缺") + " · 锁定 " + esc(sp ? sp.lock_time : "缺") +
      "<br>本版本真实对错（台账赛后结果）：让分 " + rec(rs) + " · 大小分 " + rec(rt);
    if (mv.version && g.version !== mv.version) h += '<div class="warn">' + esc(mv.version_cn) + "没有锁定这场（可能锁定时已开赛），结论沿用" + esc(g.version_cn) + "。</div>";
    if (g.alt_pick) h += '<br><span class="dim">对照：' + esc(g.alt_pick.label) + " → " + esc(g.alt_pick.pick_text) + "（把握度 " + esc(g.alt_pick.band_cn) + "）</span>";
    if (g.market && g.market.median_text && sp && g.market.median_home !== sp.line_home) h += '<div class="warn">多家中位数是 ' + esc(g.market.median_text) + "，和结论用的 DraftKings 线不同，下注前以你在皇冠看到的线为准。</div>";
    h += "</div>";
    $("hero").innerHTML = h;
    runRolls($("hero"));
  }

  /* ---------- 全息球场 ---------- */
  var court = { g: null, raf: 0 };
  function drawCourtSetup(g) { court.g = g; if (!court.raf) court.raf = requestAnimationFrame(drawCourt); }
  function drawCourt(ts) {
    court.raf = requestAnimationFrame(drawCourt);
    var c = $("court"); if (!c || !court.g) return;
    var rect = c.getBoundingClientRect(); if (rect.bottom < 0 || rect.top > innerHeight) return; // 不在屏幕内就不画
    var x = c.getContext("2d"), W = c.width, H = c.height, g = court.g, t = ts / 1000;
    var pickHome = g.spread && g.spread.pick_team === g.home, pickAway = g.spread && g.spread.pick_team === g.away;
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
    if (pickHome) glow(m + cw * 0.25, "rgba(47,123,255,A)");
    if (pickAway) glow(m + cw * 0.75, "rgba(255,59,92,A)");
    // 扫描线
    var sx = m + ((t * 160) % cw);
    var sg = x.createLinearGradient(sx - 60, 0, sx, 0); sg.addColorStop(0, "rgba(51,225,255,0)"); sg.addColorStop(1, "rgba(51,225,255,.25)");
    x.fillStyle = sg; x.fillRect(Math.max(m, sx - 60), m, Math.min(60, sx - m), ch);
    // 队名
    x.textAlign = "center";
    function team(cx, nm, ab, rec, col, picked) {
      x.shadowColor = col; x.shadowBlur = picked ? 26 : 10; x.fillStyle = "#fff";
      x.font = "900 56px -apple-system,'PingFang SC','Microsoft YaHei',sans-serif"; x.fillText(nm, cx, H / 2 + 8);
      x.shadowBlur = 0; x.fillStyle = col; x.font = "700 18px ui-monospace,Menlo,monospace"; x.fillText(ab + "  " + (rec || "战绩缺"), cx, H / 2 + 40);
      if (picked) { x.fillStyle = "#2fe39a"; x.font = "800 20px -apple-system,'PingFang SC',sans-serif"; x.fillText("▼ 模型站这边", cx, H / 2 - 52 - 4 * pulse); }
    }
    team(m + cw * 0.25, g.home_cn, "主 " + g.home, g.records[g.home], "#5aa2ff", pickHome);
    team(m + cw * 0.75, g.away_cn, "客 " + g.away, g.records[g.away], "#ff6b84", pickAway);
    x.fillStyle = "rgba(233,238,252,.75)"; x.font = "600 15px -apple-system,'PingFang SC',sans-serif";
    var foot = g.spread ? (g.spread.model_label + "：" + (winText(g, g.spread.pred_home_margin) || "") + " ｜ 盘口 " + (hcText(g, g.spread.line_home) || "缺")) : "模型结论缺";
    x.fillText(foot, W / 2, H - m - 12);
  }

  /* ---------- 天平 ---------- */
  function renderScale(g) {
    var sp = g.spread;
    if (!sp || sp.edge == null) { $("scale").innerHTML = "<p>模型结论" + miss() + "</p>"; return; }
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
      '<p class="note" style="text-align:center">与盘口差 <span data-roll="' + num(sp.edge, 2) + '" data-dec="2">0</span> 分 · ' + bandPill(sp.band_cn) + "</p>";
    var beam = $("scale").querySelector(".beam");
    if ($("scale").closest(".card").classList.contains("in")) setTimeout(function () { beam.style.transform = "rotate(" + deg.toFixed(1) + "deg)"; runRolls($("scale")); }, 200);
  }

  /* ---------- 盘口 ---------- */
  function renderOdds(g) {
    var mk = g.market || {}, h = "";
    function cell(k, v, big) { return '<div class="oc"><span>' + k + "</span><b" + (big ? ' class="big"' : "") + ">" + v + "</b></div>"; }
    h += '<p class="note">盘口来源：' + esc(mk.source || "缺") + "</p>";
    h += '<div class="ob med"><div class="on">多家中位数 <small>' + esc(mk.median_n || 0) + " 家：" + esc((mk.median_books || []).join("、") || "缺") + "；大小分 " + esc((mk.median_total_books || []).join("、") || "缺") + "</small></div><div class=\"og\">" +
      cell("让分", mk.median_text ? esc(mk.median_text) : miss(), true) + cell("大小", mk.median_total != null ? num(mk.median_total, 1) + '<small> ' + mk.median_total_n + " 家</small>" : miss(), true) + "</div></div>";
    h += '<div class="ob crown"><div class="on">皇冠 <small>你下注的公司</small></div><div class="og">' + cell("初盘", miss(mk.crown_note)) +
      cell("现盘", mk.crown != null ? esc(mk.crown) : miss(mk.crown_note), true) + cell("大小", miss()) + '</div><p class="note">' + esc(mk.crown_note || "缺") + "</p></div>";
    (mk.books || []).forEach(function (b) {
      var mv = b.open_home != null && b.cur_home != null ? b.cur_home - b.open_home : null, mvs;
      if (mv == null) mvs = "变盘：缺初盘";
      else if (mv === 0) mvs = "变盘：没动";
      else mvs = '变盘：<span class="' + (mv > 0 ? "mv-up" : "mv-dn") + '">往' + esc(mv > 0 ? g.home_cn : g.away_cn) + "一侧走 " + num(Math.abs(mv), 1) + " 分</span>";
      var tt = (b.total_open != null ? num(b.total_open, 1) : "—") + " → " + (b.total_cur != null ? num(b.total_cur, 1) : "—");
      h += '<div class="ob"><div class="on">' + esc(b.book) + " <small>" + esc(b.time || "") + "</small></div>" + (b.note ? '<p class="note">' + esc(b.note) + "</p>" : "") +
        '<div class="og">' + cell("初盘", esc(hcText(g, b.open_home) || "—")) + cell("现盘", esc(hcText(g, b.cur_home) || "—"), true) + cell("大小 初→现", tt) + '</div><p class="note">' + mvs + "</p></div>";
    });
    h += '<div class="ob"><div class="on">雷速 12 家 <small>中位数</small></div><p class="note">' + miss(mk.leisu_note) + " " + esc(mk.leisu_note || "") + "</p></div>";
    if (mk.spread_range != null && mk.spread_range >= 3) h += '<div class="warn">各家现盘最多相差 ' + num(mk.spread_range, 1) + " 分，公司分歧大，先看皇冠实际挂的线。</div>";
    $("odds").innerHTML = h;
  }

  /* ---------- 模型与市场差距 ---------- */
  function renderEdge(g) {
    var mk = g.market || {}, med = mk.median_home, comps = g.comps || [], h = "";
    if (med == null || !comps.length) { $("edge").innerHTML = "<p>市场中位数或模型数据" + miss() + "</p>"; return; }
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
    h += '<p class="note">数字=模型算的主队净胜分（正数主队赢）。来源：赛前锁定台账与 ThePredictionTracker 快照。</p>';
    if ((g.total_comps || []).length && g.total) {
      h += '<details open><summary>大小分：模型总分 vs 盘口 ' + num(g.total.line_total, 1) + "</summary><ul class=\"ul\">" + g.total_comps.map(function (c) {
        var dd = c.pred_total - g.total.line_total;
        return "<li" + (c.official ? ' style="font-weight:800"' : "") + ">" + esc(c.name) + "：" + num(c.pred_total, 2) + "（" + (dd >= 0 ? "高 " : "低 ") + num(Math.abs(dd), 2) + "）</li>";
      }).join("") + "</ul></details>";
    }
    $("edge").innerHTML = h;
    if ($("edge").closest(".card").classList.contains("in")) setTimeout(function () { animateIn($("edge").closest(".card")); }, 50);
  }

  /* ---------- 情报流 ---------- */
  function renderFeed() {
    var f = state.data.feed || [], show = 8;
    function draw(n) {
      $("feed").innerHTML = f.slice(0, n).map(function (it) {
        return '<li class="t-' + esc(it.tag) + '"><span class="tm">' + esc(it.time) + '</span><span class="tg">' + esc(it.tag) + "</span><div>" + esc(it.text) + '</div><div class="src">来源：' + esc(it.source) + "</div></li>";
      }).join("") + (f.length > n ? '<li style="list-style:none"><button class="more" id="feedMore">展开全部 ' + f.length + " 条</button></li>" : "");
      var b = $("feedMore"); if (b) b.onclick = function () { draw(f.length); };
    }
    if (!f.length) { $("feed").innerHTML = "<li>情报" + miss() + "</li>"; return; }
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
    h += duel("战绩", 0, 0, ph || 0, pa || 0, esc(g.records[g.home] || "缺"), esc(g.records[g.away] || "缺"));
    var inj = (g.injuries || {}).players || [];
    function cnt(team, st) { return inj.filter(function (p) { return p.team === team && p.status === st && !p.g_league; }).length; }
    var oh = cnt(g.home, "Out"), oa = cnt(g.away, "Out"), qh = cnt(g.home, "Questionable") + cnt(g.home, "Doubtful"), qa = cnt(g.away, "Questionable") + cnt(g.away, "Doubtful");
    var ns = (g.injuries || {}).not_submitted || [];
    var nh = ns.indexOf(g.home_cn) >= 0, na = ns.indexOf(g.away_cn) >= 0;
    h += duel("官方缺阵（不含发展联盟）", oh, oa, Math.min(oh / 6, 1), Math.min(oa / 6, 1), nh ? '<span class="miss">缺</span>' : oh, na ? '<span class="miss">缺</span>' : oa);
    h += duel("出战成疑", qh, qa, Math.min(qh / 6, 1), Math.min(qa / 6, 1), nh ? '<span class="miss">缺</span>' : qh, na ? '<span class="miss">缺</span>' : qa);
    h += '<p class="note">模型站队 = 下一块里各家模型相对市场中位数站哪队。战绩来自 ' + esc(g.records_note || "ESPN") + "。</p>";
    var ex = g.extra;
    if (ex) {
      h += "<details open><summary>本场赛前报告（" + esc(ex.report_time) + "）</summary>";
      h += '<p class="note">' + esc(ex.note) + "</p>";
      if ((ex.five_sources || []).length) {
        h += '<table class="tbl"><thead><tr><th>来源</th><th>主队净胜分</th><th>对当时盘口站</th></tr></thead><tbody>' + ex.five_sources.map(function (r) {
          return "<tr><td>" + esc(r.source) + "<small>" + esc(r.from) + "</small></td><td>" + esc(r.pred) + "</td><td>" + esc(r.vs_line) + "</td></tr>";
        }).join("") + "</tbody></table>";
      }
      if ((ex.efficiency || []).length) h += '<ul class="ul">' + ex.efficiency.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
      if (ex.referees) h += '<p class="note">裁判：' + esc(ex.referees) + "</p>";
      if (ex.total_note) h += '<p class="note">大小分（早报）：' + esc(ex.total_note) + "</p>";
      h += "</details>";
    } else {
      h += '<p class="note">本场没有单独的赛前报告：攻防效率、休息、裁判等细项' + miss() + "。</p>";
    }
    $("factors").innerHTML = h;
    if ($("factors").closest(".card").classList.contains("in")) setTimeout(function () { animateIn($("factors").closest(".card")); }, 50);
  }

  /* ---------- 缺阵名单 ---------- */
  var ORDER = { Out: 0, Doubtful: 1, Questionable: 2, Probable: 3, Available: 4 };
  function plCard(p) {
    var img = p.nba_id ? '<img loading="lazy" alt="' + esc(p.name) + '" src="https://cdn.nba.com/headshots/nba/latest/1040x760/' + encodeURIComponent(p.nba_id) + '.png" onerror="this.parentNode.textContent=\'头像加载失败\'">' : "无头像";
    return '<div class="pl ' + esc(p.cls) + '"><div class="ph">' + img + '</div><div><div class="n">' + esc(p.name) + '<span class="st ' + esc(p.cls) + '">' + esc(p.status_cn) + '</span></div><div class="rs" title="' + esc(p.reason_raw) + '">' + esc(p.reason || p.reason_raw || "原因缺") + "</div></div></div>";
  }
  function renderInj(g) {
    var I = g.injuries || {}, ps = (I.players || []).slice().sort(function (a, b) { return ORDER[a.status] - ORDER[b.status]; });
    var h = '<p class="note">官方报告版本：' + esc(I.report || "缺") + "（之后的版本本地没有下载，标缺）</p>";
    h += '<div class="injgrid">';
    [[g.home, g.home_cn, "blue"], [g.away, g.away_cn, "red"]].forEach(function (t) {
      var mine = ps.filter(function (p) { return p.team === t[0]; }), main = mine.filter(function (p) { return !p.g_league; }), gl = mine.filter(function (p) { return p.g_league; });
      h += '<div class="injcol"><h3 class="' + t[2] + '">' + esc(t[1]) + "</h3>";
      if ((I.not_submitted || []).indexOf(t[1]) >= 0) h += '<div class="warn">截至这版官方报告，' + esc(t[1]) + "还“未提交”伤病名单 → 名单" + "缺</div>";
      else if (!main.length) h += '<p class="note">官方报告没有列出伤病球员。</p>';
      h += main.map(plCard).join("");
      if (gl.length) h += "<details><summary>发展联盟 / 双向合同（不在轮换）" + gl.length + " 人</summary>" + gl.map(plCard).join("") + "</details>";
      h += "</div>";
    });
    h += "</div>";
    if ((I.changes || []).length) h += "<details><summary>名单变化记录</summary><ul class=\"ul\">" + I.changes.map(function (c) { return "<li>" + esc(c.report) + "（" + esc(c.pt) + "）：" + c.items.map(esc).join("；") + "</li>"; }).join("") + "</ul></details>";
    h += '<p class="note">头像来自 NBA 官方 CDN，球员 ID 取自官方伤病报告整理表；查不到 ID 的不放头像。</p>';
    $("inj").innerHTML = h;
  }

  /* ---------- 历史命中率 ---------- */
  function renderHist() {
    var H = state.data.history || {}, mv = state.data.model_version || {}, h = "";
    function box(title, r) {
      return '<div class="box"><div class="dim">' + esc(title) + "</div>" + (r && r.graded ? "<b>" + (r.pct == null ? "—" : '<span data-roll="' + r.pct + '" data-dec="1">0</span>%') + '</b><div class="dim">' + r.w + "胜 " + r.l + "负 " + r.p + "走</div>" : '<b class="miss">缺</b><div class="dim">台账还没有赛后结果</div>') + "</div>";
    }
    h += '<div class="live-rec">' + box(esc(mv.version_cn || "") + " 实盘 · 让分", mv.record_spread) + box(esc(mv.version_cn || "") + " 实盘 · 大小分", mv.record_total) + "</div>";
    h += '<p class="note">实盘 = 赛前锁定、赛后对照结果（来自 live_ledger.csv，' + esc(mv.main_spread_label || "") + "）。下面是回测/留出集。</p>";
    (H.groups || []).forEach(function (gp, i) {
      var inner = '<div class="d">' + esc(gp.desc) + "</div>" + gp.rows.map(function (r) {
        var pct = r.pct;
        return '<div class="hr"><div>' + esc(r.label) + '</div><div class="bt">' + (pct == null ? "" : '<i class="' + (pct < 50 ? "lo" : "") + '" data-w="' + Math.max(2, Math.min(100, (pct - 30) / 40 * 100)).toFixed(1) + '%"></i>') + '</div><div class="num">' +
          (pct == null ? '<span class="miss">缺</span><small>' + esc(r.note || "") + "</small>" : '<span data-roll="' + pct + '" data-dec="1">0</span>%<small>' + r.w + "-" + r.l + "-" + r.p + "</small>") + "</div></div>";
      }).join("");
      h += i < 2 ? '<div class="hg"><h3>' + esc(gp.title) + "</h3>" + inner + "</div>" : '<details class="hg"><summary>' + esc(gp.title) + "</summary>" + inner + "</details>";
    });
    if (H.is_first_note) h += '<p class="note">' + esc(H.is_first_note) + "</p>";
    $("hist").innerHTML = h;
  }

  /* ---------- 缺失与来源 ---------- */
  function renderMissing() {
    var d = state.data, h = '<ul class="ul">' + (d.missing || []).map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("") + "</ul>";
    var mv = d.model_version || {};
    h += '<p class="note">主结论规则：' + esc(mv.rule || "") + "。" + esc(mv.note || "") + "</p>";
    h += '<p class="note">硬规则：' + (d.rules || []).map(esc).join(" ｜ ") + "</p>";
    h += '<details><summary>数据来源（' + (d.sources || []).length + ' 个文件）</summary><ul class="src-list">' + (d.sources || []).map(function (s) {
      return "<li>" + esc(s.name) + " — " + esc(s.file) + "（更新 " + esc(s.updated || "缺") + "）" + (s.note ? " · " + esc(s.note) : "") + "</li>";
    }).join("") + "</ul></details>";
    $("missing").innerHTML = h;
  }

  /* ---------- 拉取与自动刷新 ---------- */
  function load(first) {
    return fetch("data.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      var changed = d.generated_at !== state.gen;
      state.data = d; state.gen = d.generated_at;
      if (first) return loaderFeed(d).then(function () { renderAll(true); hideLoader(); });
      if (changed) { renderAll(false); toast("数据已更新 · " + d.generated_at); }
    }).catch(function (e) {
      if (first) { document.querySelector(".ld-title").textContent = "data.json 读取失败（" + e.message + "），60 秒后重试"; }
      else toast("刷新失败，先显示上次的数据");
    });
  }
  setInterval(function () {
    state.left -= 1;
    if (state.left <= 0) { state.left = REFRESH; load(!state.data); }
    $("countdown").textContent = state.left;
  }, 1000);
  load(true);
})();
