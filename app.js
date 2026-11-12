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
  function loaderFeed(d) {
    var list = $("ldList"), items = (d.sources || []).map(function (s) { return "读取 " + s.name; });
    items.push("检查还缺哪些数据");
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
  function setBar(act, sub) {
    var a1 = $("cbAct"), s1 = $("cbSub"); if (!a1) return;
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
    else setBar(s.state === "post" ? "比赛已结束" : "直播数据读取中…", scoreLine(g, s));
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
  function renderFeed() {
    var f = state.data.feed || [], show = 8;
    function draw(n) {
      $("feed").innerHTML = f.slice(0, n).map(function (it) {
        return '<li class="t-' + esc(it.tag) + '"><span class="tg">' + esc(it.tag) + '</span><div><b class="tm">' + esc(it.time) + "</b> " + esc(it.text) + "</div>" + (it.source ? '<div class="src">来源：' + esc(it.source) + "</div>" : "") + "</li>";
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
    return '<div class="pl ' + esc(p.cls) + '"><div class="ph">' + img + '</div><div><div class="n">' + esc((window.PBP && PBP.zhName && PBP.zhName(p.name)) || p.name) + '<span class="st ' + esc(p.cls) + '">' + esc(p.status_cn) + '</span></div><div class="rs" title="' + esc(p.reason_raw) + '">' + esc(p.reason || p.reason_raw || "原因未写") + "</div></div></div>";
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
    var d = state.data, h = '<ul class="ul">' + (d.missing || []).map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("") + "</ul>";
    var mv = d.model_version || {};
    if (mv.rule) h += '<p class="note">' + esc(mv.rule) + "。</p>";
    h += '<p class="note">原则：' + (d.rules || []).map(esc).join(" ｜ ") + "</p>";
    h += '<details><summary>数据从哪来（' + (d.sources || []).length + ' 项）</summary><ul class="src-list">' + (d.sources || []).map(function (s) {
      return "<li>" + esc(s.name) + (s.note ? "：" + esc(s.note) : "") + (s.updated ? "（更新于 " + esc(String(s.updated).slice(5, 16)) + "）" : "") + "</li>";
    }).join("") + "</ul></details>";
    $("missing").innerHTML = h;
  }


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
      var c = (e.competitions || [])[0] || {}, st = e.status || {}, ty = st.type || {}, r = { id: String(e.id), state: ty.state, name: ty.name, period: st.period || 0, clock: st.displayClock || "", tip: ptTime(e.date) };
      (c.competitors || []).forEach(function (t) {
        var k = t.homeAway === "home" ? "h" : "a";
        r[k + "ab"] = nbaAb((t.team || {}).abbreviation); r[k + "s"] = t.score == null ? null : +t.score;
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
  function paintLive(animate) {
    var d = state.data; if (!d) return;
    allGames().forEach(function (g) {
      var s = liveFor(g), key = g.espn_id, pv = live.prev[key];
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
    var w = $("lvWarn");
    if (w) w.textContent = live.fail ? "比分暂时没刷新到，显示的是 " + (live.okAt || "上次") + " 的比分" : "";
  }
  function anyLive() { for (var k in live.byId) if (live.byId[k].state === "in") return true; return false; }
  function pollScores() {
    clearTimeout(live.timer);
    fetch(SB_URL + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
      var nb = parseSB(d), prev = {};
      (state.data ? allGames() : []).forEach(function (g) { var s = liveFor(g); if (s) prev[g.espn_id] = s; });
      var oldIds = (live.events || []).map(function (e) { return e.id + e.state; }).join(",");
      live.events = []; for (var k in nb) if (k === nb[k].id) live.events.push(nb[k]);
      live.prev = prev; live.byId = nb;
      if (state.data && oldIds !== live.events.map(function (e) { return e.id + e.state; }).join(",")) keepScroll(function () { var sl = $("gameTabs").scrollLeft; renderTabs(); $("gameTabs").scrollLeft = sl; var gg = game(); if (gg && (gg.nomodel || !$("hero").innerHTML)) renderGame(); }); live.fail = false; live.okAt = ptTime(new Date().toISOString());
      paintLive(true);
      if (window.PBP) window.PBP.kick();
    }).catch(function () { live.fail = true; paintLive(false); }).then(function () {
      live.timer = setTimeout(pollScores, anyLive() ? 6000 : 120000);
    });
  }
  window.NBA = { game: function () { return state.data ? game() : null; } };
  window.LIVE = live; window.liveFor = liveFor; window.statusCn = statusCn;
  document.addEventListener("visibilitychange", function () { if (!document.hidden) pollScores(); });

  /* ---------- 日期栏（雷速式）：点哪天看哪天；今天显示完整页面，其他日子显示当天赛果/赛程 ---------- */
  var WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  var dayState = { sel: null, today: null, cache: {} };
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
      h += '<button class="dchip' + (p.key === dayState.sel ? " on" : "") + (i === 0 ? " today" : "") + '" data-day="' + p.key + '" data-iso="' + p.iso + '"><b>' + p.m + "月" + p.d + "日</b><span>" + (i === 0 ? "今天" : WEEK[p.w]) + "</span></button>";
    }
    bar.innerHTML = h; bar._done = true;
    bar.querySelectorAll(".dchip").forEach(function (b) { b.onclick = function () { selectDay(b.getAttribute("data-day"), b.getAttribute("data-iso")); }; });
    var on = bar.querySelector(".dchip.on"); if (on) bar.scrollLeft = on.offsetLeft - bar.clientWidth / 2 + on.offsetWidth / 2;
  }
  function selectDay(key, iso) {
    dayState.sel = key; dayState.iso = iso;
    $("dateBar").querySelectorAll(".dchip").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-day") === key); });
    var main = $("app"), dv = $("dayView");
    if (key === dayState.today) { main.classList.remove("day-mode"); dv.hidden = true; return; }
    main.classList.add("day-mode"); dv.hidden = false;
    var c = dayState.cache[key];
    if (c) drawDay(key, iso, c.events);
    else dv.innerHTML = '<p class="note">读取中…</p>';
    var stale = !c || (key >= dayState.today && Date.now() - c.t > 300000);
    if (stale) fetch(SB_URL + "?dates=" + key + "&t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) {
      var evs = []; var nb = parseSB(d); for (var k in nb) if (k === nb[k].id) evs.push(nb[k]);
      dayState.cache[key] = { t: Date.now(), events: evs };
      if (dayState.sel === key) drawDay(key, iso, evs);
    }).catch(function () { if (dayState.sel === key && !c) dv.innerHTML = '<p class="note">赛程读取失败，稍后再点一次</p>'; });
  }
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
      } else lk = '<div class="lk dim">' + (past || s.state !== "pre" ? "当日未预测" : "暂无预测") + "</div>";
      return '<li><div class="tm2"><span>' + esc(an) + " @ " + esc(hn) + '</span><span class="st2">' + st + "</span></div>" + lk + "</li>";
    }).join("") + "</ul>";
    if (nW + nL) h += '<p class="note">这天让分方向：对 ' + nW + " 场，错 " + nL + " 场（只算赛前锁定的）。</p>";
    h += '<p class="note">只用开赛前锁定的记录；对错优先用我们账本里的结果，账本还没填时按终场比分对照锁定的盘口算。</p>';
    dv.innerHTML = h;
  }
  /* ---------- 拉取与自动刷新 ---------- */
  function load(first) {
    return fetch("data.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      if (!d || typeof d !== "object") throw new Error("bad json");
      var changed = d.generated_at !== state.gen;
      state.data = d; state.gen = d.generated_at;
      var lp = loadLeisu().catch(function () {});
      if (first) {
        // 只有上面的读取/解析失败才算“读取失败”；渲染出错只影响对应板块，加载动画一定收起
        return lp.then(function () { return loaderFeed(d); }).catch(function () {}).then(function () {
          safe("整页", function () { renderAll(true); });
          state.shown = true; hideLoader(); safe("比分", function () { pollScores(); });
        });
      }
      lp.then(function () { safe("雷速按钮", function () { var g = game(); if (g) renderLeisu(g); }); });
      if (changed) { safe("整页", function () { renderAll(false); }); toast("数据已更新 · " + String(d.generated_at || "").slice(11, 16)); }
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
  load(true);
})();
