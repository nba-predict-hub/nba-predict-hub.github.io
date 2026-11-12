/* 文字直播 + 球场投篮点 + 比分走势：浏览器直接读 ESPN 公开接口，只用于展示，不写回任何数据、不影响赛前结论。 */
(function () {
  "use strict";
  var SUM = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=";
  var P = { gid: null, plays: [], seen: {}, ath: {}, byName: {}, teams: {}, loadedPost: false, timer: 0, fail: false, okAt: null, active: false, latestShot: null, flashT: 0, showN: 30, listeners: [] };
  window.PBP = P;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function nowPT() { try { return new Intl.DateTimeFormat("zh-CN", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()); } catch (e) { return ""; } }

  /* ---- 球员和球队 ---- */
  function surname(full) { var p = String(full || "").trim().split(/\s+/); return p.length > 1 ? p.slice(1).join(" ") : (p[0] || ""); }
  function loadPeople(d, g) {
    P.ath = {}; P.byName = {}; P.teams = {};
    var comp = ((d.header || {}).competitions || [])[0] || {};
    (comp.competitors || []).forEach(function (t) {
      var side = t.homeAway === "home" ? "h" : "a", tm = t.team || {};
      P.teams[String(tm.id)] = { side: side, cn: side === "h" ? g.home_cn : g.away_cn, color: "#" + (tm.color || (side === "h" ? "2f7bff" : "ff3b5c")), alt: "#" + (tm.alternateColor || "ffffff") };
    });
    ((d.boxscore || {}).players || []).forEach(function (tp) {
      var tid = String((tp.team || {}).id);
      ((tp.statistics || [])[0] || {}).athletes && tp.statistics[0].athletes.forEach(function (a) {
        var at = a.athlete || {}, id = String(at.id);
        P.ath[id] = { id: id, full: at.displayName, name: surname(at.displayName), jersey: at.jersey || "", team: tid, starter: !!a.starter, dnp: !!a.didNotPlay };
        P.byName[at.displayName] = id;
      });
    });
  }
  function nm(id) { var a = P.ath[id]; return a ? a.name : null; }
  function nameFromText(full) { var id = P.byName[String(full || "").trim()]; return id ? nm(id) : surname(full); }
  function teamCn(p) { var t = P.teams[String((p.team || {}).id)]; return t ? t.cn : ""; }

  /* ---- 时间 ---- */
  function clockSec(s) { s = String(s || "0"); var m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s); return m ? (+m[1]) * 60 + (+m[2]) : parseFloat(s) || 0; }
  function elapsed(p) {
    var per = (p.period || {}).number || 1, c = clockSec((p.clock || {}).displayValue);
    return per <= 4 ? (per - 1) * 720 + (720 - c) : 2880 + (per - 5) * 300 + (300 - c);
  }
  function perCn(n) { return n <= 4 ? "第" + n + "节" : (n === 5 ? "加时" : "第" + (n - 4) + "个加时"); }

  /* ---- 英文动作 → 中文 ---- */
  function shotKind(tt, txt, pa) {
    var s = (tt + " " + txt).toLowerCase(), k = "";
    if (/free throw/.test(s)) {
      var m = /(\d) of (\d)/.exec(s);
      if (/technical/.test(s)) return "技术犯规罚球";
      if (/flagrant/.test(s)) return "恶意犯规罚球" + (m ? "第" + m[1] + "罚" : "");
      return m ? "罚球（第" + m[1] + "罚，共" + m[2] + "罚）" : "罚球";
    }
    if (pa === 3 || /three point/.test(s)) k = "三分";
    else if (/alley oop/.test(s) && /dunk/.test(s)) k = "空接扣篮";
    else if (/alley oop/.test(s)) k = "空接上篮";
    else if (/putback|tip/.test(s) && /dunk/.test(s)) k = "补扣";
    else if (/dunk/.test(s)) k = "扣篮";
    else if (/putback|tip shot|tip layup/.test(s)) k = "补篮";
    else if (/finger roll/.test(s)) k = "挑篮";
    else if (/reverse/.test(s) && /layup/.test(s)) k = "反手上篮";
    else if (/layup/.test(s)) k = "上篮";
    else if (/hook/.test(s)) k = "勾手";
    else if (/float/.test(s)) k = "抛投";
    else if (/fade ?away/.test(s)) k = "后仰跳投";
    else if (/step ?back/.test(s)) k = "后撤步跳投";
    else if (/pull ?up/.test(s)) k = "急停跳投";
    else if (/heave/.test(s)) k = "超远投篮";
    else if (/jump|jumper|shot/.test(s)) k = "跳投";
    else k = "投篮";
    if (/bank/.test(s) && k.indexOf("三分") < 0) k = "打板" + k;
    return k;
  }
  var TO = [[/bad pass/i, "传球失误"], [/lost ball/i, "丢球"], [/offensive foul/i, "进攻犯规"], [/shot clock/i, "24 秒违例"], [/back ?court/i, "回场违例"], [/travel/i, "走步"],
    [/out of bounds.*step|step out/i, "踩出界"], [/out of bounds/i, "出界"], [/3-second|three second/i, "3 秒违例"], [/double dribble/i, "两次运球"], [/discontinued dribble/i, "运球违例"],
    [/5-second|five second|inbound/i, "发球违例"], [/8-second/i, "8 秒违例"], [/kicked/i, "踢球违例"], [/palming|carry/i, "翻腕"], [/lane violation/i, "罚球违例"]];
  var FOUL = [[/shooting/i, "投篮犯规"], [/loose ball/i, "争抢犯规"], [/offensive charge|charge/i, "带球撞人"], [/offensive/i, "进攻犯规"], [/transition take|take foul/i, "战术犯规"],
    [/technical/i, "技术犯规"], [/flagrant.*2|flagrant type 2/i, "二级恶意犯规"], [/flagrant/i, "恶意犯规"], [/away from play/i, "无球犯规"], [/clear path/i, "阻挡快攻犯规"], [/defensive 3|defensive three/i, "防守 3 秒"], [/personal/i, "个人犯规"]];
  function pick(tbl, s, dflt) { for (var i = 0; i < tbl.length; i++) if (tbl[i][0].test(s)) return tbl[i][1]; return dflt; }

  // 返回 {kind, who, whoId, txt, pts, x, y, made, shot, ft, ...}
  function tr(p) {
    var tt = (p.type || {}).text || "", txt = p.text || "", lo = (tt + " " + txt).toLowerCase(), parts = (p.participants || []).map(function (q) { return String((q.athlete || {}).id); });
    var r = { id: p.id, per: (p.period || {}).number || 1, clock: (p.clock || {}).displayValue || "", a: p.awayScore, h: p.homeScore, team: String((p.team || {}).id || ""), pts: p.scoreValue || 0, raw: txt, who: parts[0] || null, kind: "other" };
    var w = nm(r.who) || "", tcn = teamCn(p), c = p.coordinate || {};
    if (c.x >= 0 && c.x <= 50 && c.y > -6 && c.y < 48) { r.x = c.x; r.y = c.y; }
    if (p.shootingPlay) {
      var made = !!p.scoringPlay || / makes /.test(txt), ft = /free throw/i.test(tt);
      var dist = /(\d+)-foot/.exec(txt), k = shotKind(tt, txt, p.pointsAttempted);
      r.kind = ft ? "ft" : "shot"; r.made = made; r.three = k === "三分"; r.dunk = /扣/.test(k); r.lay = /上篮|挑篮|补篮/.test(k);
      var ftm = /(\d) of (\d)/.exec(tt); if (ft && ftm) { r.ftn = +ftm[1]; r.ftof = +ftm[2]; }
      var blk = /^(.+?) blocks /.exec(txt), ast = /\((.+?) assists\)/.exec(txt);
      if (blk) { r.blocker = P.byName[blk[1].trim()] || parts[1]; }
      if (ast) { r.assist = P.byName[ast[1].trim()] || parts[1]; }
      r.txt = w + " " + (dist && !ft && +dist[1] > 0 ? dist[1] + " 英尺" : "") + k + (made ? "命中" : (blk ? "被 " + nameFromText(blk[1]) + " 盖帽" : "不中")) +
        (made && r.pts ? " +" + r.pts : "") + (ast ? "（" + nameFromText(ast[1]) + " 助攻）" : "");
      return r;
    }
    if (/rebound/i.test(tt)) {
      r.kind = "reb"; r.off = /offensive/i.test(tt);
      r.txt = w ? w + " " + (r.off ? "前场篮板" : "后场篮板") : tcn + " 集体篮板";
      return r;
    }
    if (/turnover/i.test(tt) || /turnover/i.test(txt)) {
      r.kind = "to"; var st = /\((.+?) steals\)/.exec(txt);
      if (st) r.stealer = P.byName[st[1].trim()] || parts[1];
      r.txt = (w || tcn) + " 失误（" + pick(TO, tt + " " + txt, "失误") + "）" + (st ? "，" + nameFromText(st[1]) + " 抢断" : "");
      return r;
    }
    if (/foul/i.test(tt)) {
      r.kind = "foul"; var dr = /\((.+?) draws the foul\)/.exec(txt);
      r.txt = (w || tcn) + " " + pick(FOUL, tt, "犯规") + (dr ? "（" + nameFromText(dr[1]) + " 造犯规）" : "");
      return r;
    }
    if (/substitution/i.test(tt)) {
      r.kind = "sub"; var sm = /^(.+?) enters the game for (.+)$/.exec(txt);
      r.inId = sm ? (P.byName[sm[1].trim()] || parts[0]) : parts[0]; r.outId = sm ? (P.byName[sm[2].trim()] || parts[1]) : parts[1];
      r.txt = "换人：" + (sm ? nameFromText(sm[1]) : nm(r.inId) || "") + " 上，" + (sm ? nameFromText(sm[2]) : nm(r.outId) || "") + " 下" + (tcn ? "（" + tcn + "）" : "");
      return r;
    }
    if (/timeout/i.test(tt)) { r.kind = "timeout"; r.txt = /official/i.test(tt + txt) ? "官方暂停" : (tcn ? tcn + " 叫暂停" : "暂停"); return r; }
    if (/jump ?ball/i.test(tt)) { r.kind = "jump"; r.txt = "跳球" + (/gains possession/.test(txt) ? "，" + nameFromText((/\((.+?) gains possession\)/.exec(txt) || [])[1]) + " 拿到球权" : ""); return r; }
    if (/end period/i.test(tt)) { r.kind = "end"; r.txt = perCn(r.per) + "结束"; return r; }
    if (/end game/i.test(tt)) { r.kind = "end"; r.txt = "比赛结束"; return r; }
    if (/challenge/i.test(lo)) { r.kind = "review"; r.txt = "教练挑战" + (/overturned/i.test(lo) ? "成功，判罚改判" : /upheld|stands/i.test(lo) ? "失败，维持原判" : ""); return r; }
    if (/review/i.test(lo)) { r.kind = "review"; r.txt = "裁判看录像回放"; return r; }
    if (/kicked ball/i.test(lo)) { r.kind = "foul"; r.txt = (w || tcn) + " 踢球违例"; return r; }
    if (/goaltending/i.test(lo)) { r.kind = "foul"; r.txt = (w || tcn) + " 干扰球"; return r; }
    if (/delay/i.test(lo)) { r.kind = "foul"; r.txt = (w || tcn) + " 延误比赛"; return r; }
    if (/violation/i.test(lo)) { r.kind = "foul"; r.txt = (w || tcn) + " 违例（" + txt + "）"; return r; }
    r.txt = txt; // 翻不了的保留原文
    return r;
  }

  /* ---- 拉取 ---- */
  function selGame() { return window.NBA && window.NBA.game ? window.NBA.game() : null; }
  function liveState(g) { var s = g && window.liveFor ? window.liveFor(g) : null; return s ? s.state : null; }
  function reset(g) { P.gid = g ? g.espn_id : null; P.plays = []; P.seen = {}; P.loadedPost = false; P.latestShot = null; P.showN = 30; P.fail = false; P.listeners.forEach(function (f) { f("reset"); }); }
  function tick() {
    clearTimeout(P.timer);
    var g = selGame();
    if (g && g.espn_id !== P.gid) reset(g);
    var st = liveState(g);
    P.active = !!g && (st === "in" || st === "post") && P.plays.length > 0;
    if (!g || !st || st === "pre") { renderEmpty(st); P.timer = setTimeout(tick, 15000); return; }
    if (st === "post" && P.loadedPost) { P.timer = setTimeout(tick, 60000); return; }
    var gid = g.espn_id;
    fetch(SUM + gid + "&t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
      if (gid !== P.gid) return;
      loadPeople(d, g);
      var fresh = [];
      (d.plays || []).forEach(function (p) { if (!P.seen[p.id]) { P.seen[p.id] = 1; var r = tr(p); r.el = elapsed(p); P.plays.push(r); fresh.push(r); } });
      if (st === "post") P.loadedPost = true;
      P.fail = false; P.okAt = nowPT();
      var shots = P.plays.filter(function (r) { return r.kind === "shot" && r.x != null; });
      if (fresh.length && shots.length && (!P.latestShot || P.latestShot.id !== shots[shots.length - 1].id)) { P.latestShot = shots[shots.length - 1]; P.flashT = performance.now(); }
      P.active = P.plays.length > 0;
      render(g, fresh);
      P.listeners.forEach(function (f) { f("plays", fresh, P.firstLoad !== gid); });
      P.firstLoad = gid;
    }).catch(function () { P.fail = true; render(g, []); }).then(function () {
      P.timer = setTimeout(tick, liveState(selGame()) === "in" ? 6000 : 60000);
    });
  }
  P._tr = tr; P._load = loadPeople;
  P.kick = function () { P.timer && clearTimeout(P.timer); setTimeout(tick, 50); };

  /* ---- 渲染 ---- */
  function renderEmpty(st) {
    var b = $("pbp"); if (!b) return;
    b.innerHTML = '<p class="note small-miss">' + (st === "pre" ? "开赛后开始直播" : "比赛状态读取中…") + "</p>";
  }
  function scoreTxt(r) { return r.a == null ? "" : r.a + ":" + r.h; }
  function render(g, fresh) {
    var b = $("pbp"); if (!b) return;
    var freshIds = {}; fresh.forEach(function (r) { freshIds[r.id] = 1; });
    var list = P.plays.filter(function (r) { return r.txt; }).slice().reverse();
    var h = '<div class="pbp-head"><span>比分为 ' + esc(g.away_cn) + " : " + esc(g.home_cn) + '</span><span class="dim">' + (P.fail ? "刷新失败，显示 " + esc(P.okAt || "上次") + " 的内容" : "更新于 " + esc(P.okAt || "")) + "</span></div>";
    h += chart(g);
    h += '<ol class="pbp-list">' + list.slice(0, P.showN).map(function (r) {
      var t = P.teams[r.team], side = t ? t.side : "";
      return '<li class="k-' + r.kind + (side ? " s-" + side : "") + (freshIds[r.id] && fresh.length < 40 ? " new" : "") + (r.made ? " made" : "") + '"><span class="pt">' + esc(perCn(r.per)) + "<br>" + esc(r.clock) + '</span><span class="tx">' + esc(r.txt) + '</span><span class="sc">' + esc(scoreTxt(r)) + "</span></li>";
    }).join("") + "</ol>";
    if (list.length > P.showN) h += '<button class="more" id="pbpMore">再看 30 条（共 ' + list.length + " 条）</button>";
    b.innerHTML = h;
    var mb = $("pbpMore"); if (mb) mb.onclick = function () { P.showN += 30; render(g, []); };
  }
  function chart(g) {
    var pts = P.plays.filter(function (r) { return r.a != null; }); if (!pts.length) return "";
    var W = 360, H = 150, L = 26, R = 8, T = 10, B = 20;
    var maxT = Math.max(2880, pts[pts.length - 1].el), maxS = 10;
    pts.forEach(function (r) { maxS = Math.max(maxS, r.a, r.h); }); maxS = Math.ceil(maxS / 20) * 20;
    function X(e) { return (L + (W - L - R) * e / maxT).toFixed(1); } function Y(s) { return (T + (H - T - B) * (1 - s / maxS)).toFixed(1); }
    var la = "M" + X(0) + " " + Y(0), lh = la;
    pts.forEach(function (r) { la += " L" + X(r.el) + " " + Y(r.a); lh += " L" + X(r.el) + " " + Y(r.h); });
    var grid = "";
    for (var q = 720; q < maxT; q += (q < 2880 ? 720 : 300)) grid += '<line x1="' + X(q) + '" x2="' + X(q) + '" y1="' + T + '" y2="' + (H - B) + '" class="gl"/>';
    for (var s = 0; s <= maxS; s += 20) grid += '<text x="' + (L - 4) + '" y="' + (+Y(s) + 3) + '" class="yl">' + s + "</text>";
    var lab = ["第1节", "第2节", "第3节", "第4节"].map(function (n, i) { return '<text x="' + X(i * 720 + 360) + '" y="' + (H - 6) + '" class="xl">' + n + "</text>"; }).join("");
    var last = pts[pts.length - 1];
    return '<div class="pbp-chart"><svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="比分走势">' + grid + lab +
      '<path d="' + lh + '" class="lh"/><path d="' + la + '" class="la"/>' +
      '<circle cx="' + X(last.el) + '" cy="' + Y(last.h) + '" r="3.5" class="dh"/><circle cx="' + X(last.el) + '" cy="' + Y(last.a) + '" r="3.5" class="da"/></svg>' +
      '<div class="pbp-leg"><span class="blue">— ' + esc(g.home_cn) + "（主）" + last.h + '</span><span class="red">— ' + esc(g.away_cn) + "（客）" + last.a + "</span></div></div>";
  }

  /* ---- 球场上的投篮点（画在全息球场 canvas 上） ---- */
  // ESPN 坐标：x=0~50 横向（25 为篮筐正中），y=离篮筐的纵向英尺数。已用 11/10 雷霆@开拓者终场数据核对：按此换算的距离与文字里的“XX 英尺”平均只差 0.65 英尺。
  P.courtXY = function (side, x, y, m, cw, ch) {
    var sx = cw / 94, sy = ch / 50;
    return side === "h" ? [m + (y + 5.25) * sx, m + x * sy] : [m + cw - (y + 5.25) * sx, m + ch - x * sy];
  };
  P.draw = function (cx, m, cw, ch, W, H, t) {
    if (!P.active) return;
    var shots = P.plays.filter(function (r) { return r.kind === "shot" && r.x != null; }).slice(-60);
    var now = performance.now();
    shots.forEach(function (r) {
      var tm = P.teams[r.team]; if (!tm) return;
      var xy = P.courtXY(tm.side, r.x, r.y, m, cw, ch), latest = P.latestShot && r.id === P.latestShot.id;
      cx.save(); cx.globalAlpha = latest ? 1 : 0.75; cx.lineWidth = 2.5;
      if (r.made) { cx.fillStyle = "#2fe39a"; cx.shadowColor = "#2fe39a"; cx.shadowBlur = 8; cx.beginPath(); cx.arc(xy[0], xy[1], 5.5, 0, 6.283); cx.fill(); }
      else { cx.strokeStyle = "#ff4d6d"; cx.beginPath(); cx.moveTo(xy[0] - 5, xy[1] - 5); cx.lineTo(xy[0] + 5, xy[1] + 5); cx.moveTo(xy[0] + 5, xy[1] - 5); cx.lineTo(xy[0] - 5, xy[1] + 5); cx.stroke(); }
      if (latest) {
        var k = ((now - P.flashT) % 1200) / 1200;
        cx.globalAlpha = 1 - k; cx.strokeStyle = r.made ? "#2fe39a" : "#ff4d6d"; cx.shadowBlur = 16; cx.shadowColor = cx.strokeStyle; cx.lineWidth = 3;
        cx.beginPath(); cx.arc(xy[0], xy[1], 8 + 22 * k, 0, 6.283); cx.stroke();
      }
      cx.restore();
    });
    if (P.drawExtra) P.drawExtra(cx, m, cw, ch, W, H, t);
  };

  document.addEventListener("visibilitychange", function () { if (!document.hidden) P.kick(); });
  setTimeout(tick, 1500);
})();
