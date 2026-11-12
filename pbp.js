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
        var keys = tp.statistics[0].keys || [], fi = keys.indexOf("fouls"), pf = fi >= 0 && a.stats && a.stats[fi] != null ? parseInt(a.stats[fi], 10) : null;
        P.ath[id] = { id: id, full: at.displayName, name: surname(at.displayName), jersey: at.jersey || "", team: tid, starter: !!a.starter, dnp: !!a.didNotPlay,
          pos: ((at.position || {}).abbreviation) || "", active: !!a.active, ejected: !!a.ejected, fouls: isNaN(pf) ? null : pf, reason: a.reason || "" };
        P.byName[at.displayName] = id;
      });
    });
  }
  // 球员中文名：同事生成的 player_names_zh.json（键 = ESPN 球员 ID），查不到就用英文姓
  P.zh = {}; P.zhByEn = {}; P.zhFullByEn = {}; P.ejectIds = {};
  // 文本里的英文全名换成虎扑中文全名（只换译名表里有的，没有的保留英文）
  P.zhText = function (s) { return String(s || "").replace(/[A-Z][A-Za-z.'\-]+(?: (?:(?:da|de|del|der|di|du|la|le|van|von|dos) )?[A-Z][A-Za-z.'\-]+)+/g, function (m) { return P.zhFullByEn[m.toLowerCase()] || m; }); };
  P.loadNames = function () {
    return fetch("player_names_zh.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) {
      var m = (j && j.players) || j || {}, by = {};
      for (var k in m) { var v = m[k]; if (v && typeof v === "object" && (v.zh_short || v.zh)) { if (v.en) { by[String(v.en).trim().toLowerCase()] = v.zh_short || v.zh; if (v.zh) P.zhFullByEn[String(v.en).trim().toLowerCase()] = v.zh; } } else delete m[k]; }
      var changed = JSON.stringify(Object.keys(m).length) !== JSON.stringify(Object.keys(P.zh).length);
      P.zh = m; P.zhByEn = by; if (window.NBA_NAMES) try { window.NBA_NAMES(); } catch (e) {}
      if (changed && P.plays.length) { P.plays = P.plays.map(function (r) { var x = tr(r._p); x.el = r.el; return x; }); var g = selGame(); if (g) render(g, null); }
    }).catch(function () {});
  };
  function nm(id) { var z = P.zh[id]; if (z && (z.zh_short || z.zh)) return z.zh_short || z.zh; var a = P.ath[id]; return a ? a.name : null; }
  P.nm = nm;
  P.zhName = function (en) { return P.zhByEn[String(en || "").trim().toLowerCase()] || null; };
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
    [/5-second|five second|inbound/i, "发球违例"], [/8-second/i, "8 秒违例"], [/kicked/i, "踢球违例"], [/palming|carry/i, "翻腕"], [/lane violation/i, "罚球违例"], [/offensive goaltending/i, "进攻干扰球"], [/disc(ontinued?)? dribble/i, "运球违例"], [/illegal assist/i, "非法协助"], [/illegal screen/i, "非法掩护"], [/excess timeout/i, "超额暂停"], [/jump ball/i, "跳球违例"], [/basket from below/i, "下方进球违例"], [/opposite basket/i, "攻错篮筐"]];
  var FOUL = [[/shooting/i, "投篮犯规"], [/loose ball/i, "争抢犯规"], [/offensive charge|charge/i, "带球撞人"], [/offensive/i, "进攻犯规"], [/transition take|take foul/i, "战术犯规"],
    [/technical/i, "技术犯规"], [/flagrant.*2|flagrant type 2/i, "二级恶意犯规"], [/flagrant/i, "恶意犯规"], [/away from play/i, "无球犯规"], [/clear path/i, "阻挡快攻犯规"], [/defensive 3|defensive three/i, "防守 3 秒"], [/double personal/i, "双方犯规"], [/personal block/i, "阻挡犯规"], [/inbound/i, "发球犯规"], [/hanging/i, "挂筐技术犯规"], [/flopping/i, "假摔技术犯规"], [/personal/i, "个人犯规"]];
  function pick(tbl, s, dflt) { for (var i = 0; i < tbl.length; i++) if (tbl[i][0].test(s)) return tbl[i][1]; return dflt; }

  // 返回 {kind, who, whoId, txt, pts, x, y, made, shot, ft, ...}
  function tr(p) {
    var tt = (p.type || {}).text || "", txt = p.text || "", lo = (tt + " " + txt).toLowerCase(), parts = (p.participants || []).map(function (q) { return String((q.athlete || {}).id); });
    var r = { _p: p, id: p.id, per: (p.period || {}).number || 1, clock: (p.clock || {}).displayValue || "", a: p.awayScore, h: p.homeScore, team: String((p.team || {}).id || ""), pts: p.scoreValue || 0, raw: txt, who: parts[0] || null, kind: "other" };
    var w = nm(r.who) || "", tcn = teamCn(p), c = p.coordinate || {};
    if (c.x >= 0 && c.x <= 50 && c.y > -6 && c.y < 48) { r.x = c.x; r.y = c.y; }
    if (p.shootingPlay) {
      var made = !!p.scoringPlay || / makes /.test(txt), ft = /free throw/i.test(tt);
      var dist = /(\d+)-foot/.exec(txt), k = shotKind(tt, txt, p.pointsAttempted);
      r.kind = ft ? "ft" : "shot"; r.made = made; r.shot = ft ? "" : k; r.three = k === "三分"; r.dunk = /扣/.test(k); r.lay = /上篮|挑篮|补篮/.test(k);
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
      r.kind = "to"; var st = /\((.+?) steals\)/.exec(txt); r.totype = pick(TO, tt + " " + txt, "");
      if (st) r.stealer = P.byName[st[1].trim()] || parts[1];
      r.txt = (w || tcn) + " 失误（" + pick(TO, tt + " " + txt, "失误") + "）" + (st ? "，" + nameFromText(st[1]) + " 抢断" : "");
      return r;
    }
    if (/eject/i.test(tt) || / ejected\b/i.test(txt)) { r.kind = "eject"; r.alert = true; r.txt = (w || nameFromText(txt.replace(/\s+ejected[\s\S]*$/i, "")) || tcn) + " 被驱逐出场"; if (r.who) P.ejectIds[r.who] = 1; return r; }
    if (/altercation|fight/i.test(lo)) { r.kind = "foul"; r.alert = true; r.txt = "场上发生冲突" + (tcn ? "（" + tcn + "）" : ""); return r; }
    if (/technical/i.test(tt)) { // 技术犯规类（类型名里常常没有 foul 一词）
      r.kind = "foul";
      var tk = /defensive 3|3-second/i.test(tt) ? "防守 3 秒（技术犯规）" : /delay/i.test(tt) ? "延误比赛技术犯规" : /flop/i.test(tt) ? "假摔技术犯规" : /hanging/i.test(tt) ? "挂筐技术犯规" : /taunt/i.test(tt) ? "挑衅技术犯规" : /double/i.test(tt) ? "双方技术犯规" : "技术犯规";
      r.alert = true;
      var dm = /double technical foul:\s*(.+?) and (.+)$/i.exec(txt);
      r.txt = dm ? tk + "：" + nameFromText(dm[1]) + "、" + nameFromText(dm[2]) : (w || tcn || (/[A-Z][a-z]+ [A-Z]/.test(txt) ? nameFromText(txt.replace(/\s+(defensive|delay|flopping|technical|hanging|taunting)[\s\S]*$/i, "")) : "")) + " " + tk;
      return r;
    }
    if (/foul|charge/i.test(tt)) {
      r.kind = "foul"; if (/flagrant/i.test(tt)) r.alert = true; var dr = /\((.+?) draws the foul\)/.exec(txt); r.ftype = pick(FOUL, tt, "犯规"); if (dr) r.drawer = P.byName[dr[1].trim()] || parts[1];
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
    if (/review/i.test(lo)) { r.kind = "review"; r.txt = "裁判看录像回放" + (/overturned/i.test(lo) ? "，改判" : /supports|stands/i.test(lo) ? "，维持原判" : ""); return r; }
    if (/kicked ball/i.test(lo)) { r.kind = "foul"; r.txt = (w || tcn) + " 踢球违例"; return r; }
    if (/goaltending/i.test(lo)) { r.kind = "foul"; r.txt = (w || tcn) + " 干扰球"; return r; }
    if (/delay/i.test(lo)) { r.kind = "foul"; r.txt = (w || tcn) + " 延误比赛"; return r; }
    if (/violation|^lane$/i.test(lo) || /^lane$/i.test(tt)) { r.kind = "foul"; r.txt = (w || tcn) + " " + pick(TO, lo, /lane/i.test(lo) ? "罚球违例" : "违例"); return r; }
    if (/no shot/i.test(tt)) { r.kind = "other"; r.txt = (w || tcn) + " 出手（未计入投篮）"; return r; }
    // 翻不了的：不显示英文句子，只留球员/球队中文名 + “其他事件”，并在控制台记一次
    P.unk = P.unk || {}; if (!P.unk[tt]) { P.unk[tt] = 1; try { console.info("[文字直播] 未翻译的事件类型：", tt, "|", txt); } catch (e) {} }
    r.txt = ((w || tcn) ? (w || tcn) + " " : "") + "其他事件";
    return r;
  }

  /* ---- 拉取 ---- */
  function selGame() { return window.NBA && window.NBA.game ? window.NBA.game() : null; }
  function liveState(g) { var s = g && window.liveFor ? window.liveFor(g) : null; return s ? s.state : null; }
  function reset(g) {
    P.ejectIds = {}; P.lastAlert = null; P.ath = {}; P.byName = {}; P.teams = {}; P.luAt = "";
    var ab = $("alertBar"); if (ab) { ab._h = ""; ab.innerHTML = ""; ab.hidden = true; }
    ["status", "lineup"].forEach(function (k) { var b = $(k); if (b) { b._h = ""; b.innerHTML = '<p class="note small-miss">读取中…</p>'; } });
    P.preT = 0; P.tipMs = 0; P.active = false; P.gid = g ? g.espn_id : null; P.plays = []; P.seen = {}; P.loadedPost = false; P.latestShot = null; P.showN = 30; P.fail = false; P.listeners.forEach(function (f) { f("reset"); }); }
  // 带超时的请求（不支持 AbortController 的浏览器就不设超时）
  function tfetch(url, ms) {
    var ac = window.AbortController ? new AbortController() : null, t = ac ? setTimeout(function () { ac.abort(); }, ms) : 0;
    return fetch(url, ac ? { cache: "no-store", signal: ac.signal } : { cache: "no-store" }).then(function (r) { clearTimeout(t); return r; }, function (e) { clearTimeout(t); throw e; });
  }
  P.tfetch = tfetch;
  P.fastMs = 2000; P.busy = false; P.again = false;
  function liveGap() { return document.visibilityState === "visible" ? P.fastMs : 6000; } // 前台 2 秒（出错退到 3→5 秒），后台 6 秒
  function tick() {
    clearTimeout(P.timer);
    if (P.busy) { P.again = true; return; } // 上一个请求没回来就不发下一个
    var g = selGame();
    if (g && g.espn_id !== P.gid) reset(g);
    var st = liveState(g);
    P.active = !!g && (st === "in" || st === "post") && P.plays.length > 0;
    if (!g || !st || st === "pre") {
      renderEmpty(st); P.timer = setTimeout(tick, 15000);
      var near = P.tipMs && P.tipMs - Date.now() < 3600000 && document.visibilityState === "visible";
      if (g && Date.now() - P.preT > (near ? 30000 : 60000)) { // 赛前每分钟读一次首发和伤病；开赛前 1 小时内且页面在前台每 30 秒
        P.preT = Date.now(); var pg = g.espn_id;
        fetch(SUM + pg + "&t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
          if (!d || pg !== P.gid) return; loadPeople(d, g); P.luAt = nowPT(); P.tipMs = Date.parse((((d.header || {}).competitions || [])[0] || {}).date || "") || 0; P.inj.t = 0; return Promise.all([loadInj(), loadRoles(), loadIR()]).then(function () { var cur = selGame(); if (pg === P.gid && cur && cur.espn_id === pg) renderLineup(g); });
        }).catch(function () {});
      }
      return;
    }
    if (st === "post" && P.loadedPost) { P.timer = setTimeout(tick, 60000); return; }
    var gid = g.espn_id;
    P.busy = true; P.busyAt = Date.now();
    tfetch(SUM + gid + "&t=" + Date.now(), 5000).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
      P.fastMs = 2000;
      try { // 头部比分立刻合进大比分
        var cp = ((d.header || {}).competitions || [])[0] || {}, stt = cp.status || {}, ty = stt.type || {}, hr = { state: ty.state, name: ty.name, period: stt.period, clock: stt.displayClock };
        (cp.competitors || []).forEach(function (t) { var k = t.homeAway === "home" ? "h" : "a"; if (t.score != null && t.score !== "") hr[k + "s"] = +t.score; if (t.linescores) hr[k + "ls"] = t.linescores.map(function (x) { var v = x.value != null ? x.value : x.displayValue; return v == null || v === "" ? null : +v; }); });
        if (window.LIVE_MERGE && hr.as != null && hr.hs != null) window.LIVE_MERGE(gid, hr);
      } catch (e) {}
      if (gid !== P.gid) return;
      loadPeople(d, g); P.luAt = nowPT();
      var fresh = [];
      (d.plays || []).forEach(function (p) { if (!P.seen[p.id]) { P.seen[p.id] = 1; var r = tr(p); r.el = elapsed(p); P.plays.push(r); fresh.push(r); } });
      if (st === "post") P.loadedPost = true;
      P.fail = false; P.okAt = nowPT();
      var shots = P.plays.filter(function (r) { return r.kind === "shot" && r.x != null; });
      if (fresh.length && shots.length && (!P.latestShot || P.latestShot.id !== shots[shots.length - 1].id)) { P.latestShot = shots[shots.length - 1]; P.flashT = performance.now(); }
      P.active = P.plays.length > 0;
      render(g, fresh);
      for (var ej in P.ejectIds) if (P.ath[ej]) P.ath[ej].ejected = true;
      fresh.forEach(function (r) { if (r.alert && P.firstLoad === gid) P.lastAlert = { r: r, t: Date.now() }; });
      renderAlertBar(g);
      P.listeners.forEach(function (f) { f("plays", fresh, P.firstLoad !== gid); });
      var tipIso = ((((d.header || {}).competitions || [])[0]) || {}).date;
      Promise.all([loadInj(), loadIgs(), loadRoles(), loadIR()]).then(function () { var cur = selGame(); if (gid === P.gid && cur && cur.espn_id === gid) { renderStatus(g, tipIso); renderLineup(g); } });
      P.firstLoad = gid;
    }).catch(function () { P.fail = true; P.fastMs = P.fastMs < 3000 ? 3000 : 5000; if (gid === P.gid) render(g, []); }).then(function () {
      P.busy = false;
      if (P.again) { P.again = false; P.timer = setTimeout(tick, 0); return; }
      P.timer = setTimeout(tick, liveState(selGame()) === "in" ? liveGap() : 60000);
    });
  }
  P._tr = tr; P._load = loadPeople;
  /* ---- 场上状况：只用 ESPN 明确给出的字段 / 文字，不猜 ---- */
  P.inj = { t: 0, byId: {} };
  function loadInj() {
    if (Date.now() - P.inj.t < 60000) return Promise.resolve();
    P.inj.t = Date.now();
    return fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) {
      var by = {}, bt = {};
      (j.injuries || []).forEach(function (t) { bt[String(t.id)] = t.injuries || []; (t.injuries || []).forEach(function (i) { var id = String(((i.athlete || {}).links ? (/id\/(\d+)/.exec(JSON.stringify(i.athlete.links)) || [])[1] : "") || ""); if (id) by[id] = i; }); });
      P.inj.byId = by; P.inj.byTeam = bt;
    }).catch(function () {});
  }
  P.nbaIds = {};
  fetch("nba_ids.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) { P.nbaIds = j || {}; }).catch(function () {});
  /* 同事维护的场内伤退消息 ingame_status.json（同站读取，每 30 秒；没有就忽略） */
  P.igs = {}; P.igsT = 0;
  function loadIgs() {
    if (Date.now() - P.igsT < (P.igs404 ? 600000 : 30000)) return Promise.resolve();
    P.igsT = Date.now();
    return fetch("ingame_status.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { P.igs404 = r.status === 404; return r.ok ? r.json() : {}; }).then(function (j) { j = j || {}; P.igs = j.games || j; }).catch(function () {});
  }
  function igsFor(gid) {
    var m = P.igs[String(gid)] || {}, out = [];
    for (var k in m) {
      var v = m[k] || {}, id = null;
      if (P.ath[k]) id = k; else if (P.byName[k]) id = P.byName[k]; else if (v.espn_player_id && P.ath[v.espn_player_id]) id = String(v.espn_player_id);
      else for (var a in P.ath) { var z = P.zh[a]; if (z && (z.zh === k || z.zh_short === k)) { id = a; break; } }
      out.push({ id: id, name: k, v: v });
    }
    return out;
  }
  function statusItems(tipIso, gid) {
    var items = [], tip = tipIso ? Date.parse(tipIso) : 0, cover = {};
    igsFor(gid).forEach(function (e) {
      var st = String(e.v.status || "").toLowerCase(), def = { out: ["red", "不会回场"], questionable: ["yel", "能否回场待定"], returned: ["grn", "已回场"] }[st];
      if (!def) return;
      var who = e.id ? (P.teams[P.ath[e.id].team] || {}).cn + " " + nm(e.id) : e.name;
      var url = /^https?:\/\//.test(e.v.url || "") ? e.v.url : "";
      items.push({ key: (e.id || e.name) + ":igs:" + st, cls: def[0], id: e.id, txt: who + " " + (e.v.cn_text || def[1]), src: "来源 " + (e.v.source || "未注明") + (e.v.time_pt ? " · " + e.v.time_pt + " 太平洋时间" : ""), url: url });
      if (e.id) cover[e.id] = 1;
    });
    for (var id in P.ath) {
      var a = P.ath[id], who = (P.teams[a.team] || {}).cn + " " + nm(id);
      if (a.ejected) items.push({ key: id + ":ej", cls: "red", id: id, txt: who + " 被驱逐出场", src: "ESPN 技术统计" });
      else if (a.fouls >= 6) items.push({ key: id + ":f6", cls: "red", id: id, txt: who + " 6 犯离场", src: "ESPN 技术统计" });
      else if (a.fouls === 5) items.push({ key: id + ":f5", cls: "yel", id: id, txt: who + " 已经 5 次犯规", src: "ESPN 技术统计" });
      var i = cover[id] ? null : P.inj.byId[id];
      if (i && tip && Date.parse(i.date || 0) >= tip - 30 * 60000) { // 只看开赛后的伤病消息
        var c = (i.shortComment || "") + " " + (i.longComment || ""); // 标题和正文都读
        if (a.dnp) continue; // 本场没上场的不算伤退
        var red = /will not return|won't return|ruled out for the remainder|ruled out/i.test(c), yel = /questionable to return/i.test(c);
        if (!red && !yel && !/(exited|left the (game|court)|injur)/i.test(c)) continue;
        var w = red ? ["red", "不会回场"] : yel ? ["yel", "能否回场待定"] : ["yel", "受伤离场，暂无官方回场消息"];
        var rep = /([A-Z][A-Za-z.'\-]+(?: [A-Z][A-Za-z.'\-]+)+) of .{1,60}? reports/.exec(c);
        var tm = ""; try { tm = new Intl.DateTimeFormat("zh-CN", { timeZone: "America/Los_Angeles", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(i.date)); } catch (x) {}
        items.push({ key: id + ":inj:" + w[1], cls: w[0], id: id, txt: who + " " + w[1], src: "来源 ESPN" + (rep ? "（" + rep[1] + "）" : "") + (tm ? " · " + tm + " 太平洋时间" : "") });
      }
    }
    P.plays.forEach(function (r) { // 逐回合文字里明确写了受伤的
      if (/injur/i.test(r.raw || "") && r.who) items.push({ key: r.id + ":pi", cls: "yel", id: r.who, txt: ((P.teams[r.team] || {}).cn || "") + " " + (nm(r.who) || "") + " 受伤（比赛记录）", src: "ESPN 逐回合记录" });
    });
    var rank = { red: 0, yel: 1, grn: 2, "": 3 };
    return items.sort(function (x, y) { return rank[x.cls] - rank[y.cls]; });
  }
  function head(id) {
    var n = P.nbaIds[id];
    return n ? '<img loading="lazy" alt="" src="https://cdn.nba.com/headshots/nba/latest/260x190/' + n + '.png" onerror="this.remove()">' : "";
  }
  P.lastStatus = {};
  function renderStatus(g, tipIso) {
    var box = $("status"); if (!box) return;
    var items = statusItems(tipIso, g.espn_id), h = ""; P.lastItems = items; renderAlertBar(g);
    // 场上五人：ESPN 技术统计里的“在场”字段，每队正好 5 人才显示
    var five = {}; for (var id in P.ath) if (P.ath[id].active) (five[P.ath[id].team] = five[P.ath[id].team] || []).push(id);
    var teams = Object.keys(P.teams).sort(function (x, y) { return P.teams[x].side === "h" ? 1 : -1; });
    h += '<div class="st-five">';
    teams.forEach(function (t) {
      var ids = five[t] || [];
      h += '<div class="st-team"><div class="st-tn" style="color:' + esc(P.teams[t].color) + '">' + esc(P.teams[t].cn) + (liveState(g) === "post" ? " 终场时场上五人" : " 当前场上五人") + "</div>" +
        (ids.length === 5 ? ids.map(function (id) { var a = P.ath[id]; return '<span class="st-p' + (a.fouls >= 5 ? " f5" : "") + '">' + head(id) + "<b>" + esc(nm(id)) + "</b>" + (a.starter ? '<em class="st-fs">首发</em>' : "") + (a.ejected ? '<em class="ejt">已驱逐</em>' : "") + "<i>" + (a.fouls != null ? a.fouls + "犯" : "") + "</i></span>"; }).join("") : '<span class="dim">暂无（ESPN 没给出完整在场名单）</span>') + "</div>";
    });
    h += '</div><div class="st-src">在场名单：ESPN 技术统计实时字段</div>';
    h += '<ul class="st-list">' + (items.length ? items.map(function (x) { return '<li class="' + x.cls + '">' + head(x.id) + "<span>" + esc(x.txt) + "</span><small>" + (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.src) + "</a>" : esc(x.src)) + "</small></li>"; }).join("") : '<li class="none">暂无伤病、犯规麻烦或驱逐（伤病回场情况暂无官方消息）</li>') + "</ul>";
    if (box._h !== h) { box._h = h; box.innerHTML = h; }
    // 新出现的状况：通知解说
    var fresh = items.filter(function (x) { return !P.lastStatus[x.key]; });
    var first = !P.lastStatus.__gid || P.lastStatus.__gid !== g.espn_id;
    P.lastStatus = { __gid: g.espn_id }; items.forEach(function (x) { P.lastStatus[x.key] = 1; });
    if (!first) fresh.forEach(function (x) { P.listeners.forEach(function (f) { f("status", x); }); });
  }
  P.renderStatus = renderStatus;

  /* ---- 首发 · 缺阵 ---- */
  var PART = { knee: "膝盖", ankle: "脚踝", hip: "髋部", oblique: "腹斜肌", hamstring: "腿筋", calf: "小腿", foot: "脚", toe: "脚趾", back: "背部", "lower back": "下背部", shoulder: "肩膀",
    wrist: "手腕", hand: "手", finger: "手指", thumb: "拇指", elbow: "肘部", groin: "腹股沟", quadriceps: "股四头肌", quad: "股四头肌", achilles: "跟腱", illness: "生病", concussion: "脑震荡",
    head: "头部", neck: "颈部", rest: "休息", personal: "个人原因", eye: "眼睛", face: "面部", nose: "鼻子", chest: "胸部", rib: "肋骨", ribs: "肋骨", abdomen: "腹部", shin: "胫骨", leg: "腿部",
    "lower leg": "小腿", heel: "脚跟", thigh: "大腿", pelvis: "骨盆", forearm: "前臂", arm: "手臂", "not injury related": "非伤病原因", jaw: "下巴", mouth: "嘴部" };
  var SIDE = { left: "左", right: "右" };
  var IST = { "out": ["red", "缺阵"], "doubtful": ["org", "大概率缺阵"], "questionable": ["yel", "出战成疑"], "day-to-day": ["", "每日观察"], "probable": ["", "大概率出战"] };
  function ptTime(iso) { try { return new Intl.DateTimeFormat("zh-CN", { timeZone: "America/Los_Angeles", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)); } catch (e) { return ""; } }
  // 球员分量（盒子每天生成的 player_roles.json，按 ESPN 球员 ID）
  P.roles = {}; P.rolesEn = {}; P.rolesT = 0;
  function loadRoles() {
    if (Date.now() - P.rolesT < 1800000) return Promise.resolve();
    P.rolesT = Date.now();
    return fetch("player_roles.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) {
      P.roles = (j && j.players) || {}; P.rolesEn = {}; for (var k in P.roles) if (P.roles[k].en) P.rolesEn[P.roles[k].en] = k;
    }).catch(function () {});
  }
  var RRANK = { "核心": 0, "主力": 1, "轮换": 2, "边缘": 3 };
  function roleTag(id) {
    var r = id && P.roles[id]; if (!r) return "";
    return '<em class="role r' + RRANK[r.role] + '">' + esc(r.role) + "</em><i class=\"rstat\">场均 " + r.ppg + " 分 / " + r.mpg + " 分钟</i>";
  }
  var POS = { PG: "控卫", SG: "得分后卫", SF: "小前锋", PF: "大前锋", C: "中锋", G: "后卫", F: "前锋" };
  // 中文全名：只用 player_names_zh.json 的虎扑译名；ESPN id 是确定匹配，没有译名显示英文全名
  function fullName(id, en) {
    if (id && P.zh[id] && P.zh[id].zh) return P.zh[id].zh;
    var z = en && P.zhFullByEn[String(en).toLowerCase()]; return z ? z + "（" + en + "）" : (en || ""); // 只按英文名对上：写成 中文名（英文全名）
  }
  P.fullName = fullName;
  // 首发（直播页和赛前详情共用）：groups = [{cn, side:"a"/"h", ids:[{id, en, pos}]}]
  function stHtml(groups, note) {
    var h = '<div class="lu-h">首发 <small>' + esc(note || "") + "</small></div>";
    groups.forEach(function (gp) {
      h += '<div class="lu-tm"><div class="lu-tt">' + esc(gp.cn) + " <small>" + (gp.side === "h" ? "主队" : "客队") + "</small></div>";
      h += gp.ids.length ? '<ul class="lu-st">' + gp.ids.map(function (p) {
        var ps = POS[String(p.pos || "").toUpperCase()] || "";
        return '<li><span class="lu-hd">' + head(p.id) + '</span><span class="lu-nm"><b>' + esc(fullName(p.id, p.en)) + "</b>" + (ps ? '<i class="lu-pos">' + ps + "</i>" : "") + (P.ath[p.id] && P.ath[p.id].ejected ? '<em class="ejt">已驱逐</em>' : "") + '</span><span class="lu-rl">' + roleTag(p.id) + "</span></li>";
      }).join("") + "</ul>" : '<p class="lu-none">首发未公布</p>';
      if (gp.ej && gp.ej.length) h += '<p class="lu-ej"><em class="ejt">已驱逐</em> ' + esc(gp.ej.join("、")) + "</p>";
      h += "</div>";
    });
    return h;
  }
  P.stHtml = stHtml;
  function renderLineup(g) {
    var box = $("lineup"); if (!box || !g) return;
    var teams = Object.keys(P.teams).sort(function (x, y) { return P.teams[x].side === "h" ? 1 : -1; }), hasSt = false;
    var groups = teams.map(function (t) {
      var ids = []; for (var id in P.ath) if (P.ath[id].team === t && P.ath[id].starter) { ids.push({ id: id, en: P.ath[id].full, pos: P.ath[id].pos }); hasSt = true; }
      var ej = []; for (var id2 in P.ath) if (P.ath[id2].team === t && P.ath[id2].ejected) ej.push(fullName(id2, P.ath[id2].full));
      return { cn: P.teams[t].cn, side: P.teams[t].side, ids: ids, ej: ej };
    });
    var h = teams.length ? stHtml(groups, hasSt ? "官方首发（ESPN starter 字段）· " + (P.luAt || "") + " 获取" : "") : '<div class="lu-h">首发</div><p class="lu-none">首发未公布</p>';
    // 官方伤病报告优先：盒子每分钟探测新版生成的 injury_report.json；其次 data.json 里的官方报告；ESPN 补充官方没列的人
    h += absHtml(g.away, g.home, teams.map(function (t) { return { id: t, cn: P.teams[t].cn, ab: P.teams[t].side === "h" ? g.home : g.away, side: P.teams[t].side }; }), g.injuries || {});
    if (box._h !== h) { box._h = h; box.innerHTML = h; }
    if (window.NBA_RM) window.NBA_RM();
  }
  // 官方报告的英文全名 + 球队 → ESPN 球员 id（球员表 player_roles / player_names_zh）；对不上返回 ""，不猜
  var TAB = { GS: "GSW", SA: "SAS", NO: "NOP", NY: "NYK", UTAH: "UTA", WSH: "WAS", PHO: "PHX" };
  function normName(s) {
    s = String(s || ""); try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    var m = /^([^,]+),\s*(.+)$/.exec(s); if (m) s = m[2] + " " + m[1]; // Last, First → First Last
    return s.toLowerCase().replace(/[.'’\-]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();
  }
  function matchPlayer(name, team) {
    var R = P.roles || {}, Z = P.zh || {}, n = 0; for (var k in R) n++; for (var k2 in Z) n++;
    if (!P.nIdx || P.nIdxN !== n) {
      P.nIdx = {}; P.nIdxN = n;
      var add = function (id, en) { var key = normName(en); if (!key) return; (P.nIdx[key] = P.nIdx[key] || []); if (P.nIdx[key].indexOf(id) < 0) P.nIdx[key].push(id); };
      for (var a in R) add(a, R[a].en); for (var b in Z) add(b, Z[b].en);
      for (var c in P.ath) add(c, P.ath[c].full);
    }
    var ids = P.nIdx[normName(name)] || [], hit = [];
    ids.forEach(function (id) { var t = R[id] && R[id].team; if (t && (TAB[t] || t) === team) hit.push(id); });
    if (hit.length === 1) return hit[0];
    P.unsure = P.unsure || {}; P.unsure[name + "|" + team] = ids; // 只按名字找到、球队对不上或没有球队信息：不确定
    return "";
  }
  P.matchPlayer = matchPlayer;
  // 中文名只用 player_names_zh.json 的标准译名：确定匹配 → 中文全名；不确定但有译名 → 中文名（英文全名）；否则英文全名
  function offName(q, eid) {
    if (eid) return (P.zh[eid] && P.zh[eid].zh) || q.name;
    var ids = ((P.unsure || {})[q.name + "|" + q.team]) || [], zs = [];
    ids.forEach(function (id) { var z = P.zh[id] && P.zh[id].zh; if (z && zs.indexOf(z) < 0) zs.push(z); });
    return zs.length === 1 ? zs[0] + "（" + q.name + "）" : q.name;
  }
  /* 回归消息：ESPN 免费伤病数据（浏览器端取）。规则表只翻常见句型，对不上就显示英文原句，绝不猜 */
  var DAYCN = { monday: "周一", tuesday: "周二", wednesday: "周三", thursday: "周四", friday: "周五", saturday: "周六", sunday: "周日" };
  function dayOf(s) { var m = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)'s\b/.exec(s); return m ? DAYCN[m[1]] : ""; }
  var CRULES = [
    [/\b(won't|will not) return\b/, function () { return "本场不会再回场"; }, 1],
    [/\bnot expected to return\b/, function () { return "预计暂时不会复出"; }, 1],
    [/questionable to return/, function () { return "能否回场成疑"; }, 0],
    [/expected to miss the (rest of the )?(\d{4}-\d{2} )?season|out for the (rest of the )?season|season-ending/, function () { return "预计赛季报销"; }, 0],
    [/out indefinitely/, function () { return "无限期缺阵"; }, 0],
    [/ruled out/, function (s) { var d = dayOf(s); return d ? "已确定缺席" + d + "的比赛" : "已确定缺席"; }, 0],
    [/\b(will|is set to) miss\b/, function (s) { var d = dayOf(s); return d ? "将缺席" + d + "的比赛" : "将缺席"; }, 0],
    [/re-?evaluated (?:by [a-z ]+ )?in (\d+)(?:-to-| to |-)?(\d+)? (week|month|day)s?/, function (s, m) { return "将在 " + m[1] + (m[2] ? "-" + m[2] : "") + " " + { week: "周", month: "个月", day: "天" }[m[3]] + "后重新评估"; }, 0],
    [/underwent [a-z ,'-]*surgery|had surgery/, function () { return "已接受手术"; }, 0],
    [/(resumed|returned to) (practicing|practice)|back at practice/, function () { return "已恢复训练"; }, 0],
    [/full[- ]contact|contact practice/, function () { return "已参加对抗训练"; }, 0],
    [/\bprobable\b/, function () { return "被列为大概率出战"; }, 0],
    [/\bdoubtful\b/, function () { return "被列为大概率缺阵"; }, 0],
    [/\bquestionable\b(?! to return)/, function () { return "被列为出战成疑"; }, 0],
    [/day-to-day/, function () { return "每日观察"; }, 0],
    [/(remain|stay) out|remains out/, function () { return "继续缺阵"; }, 0],
    [/cleared to play|will play\b|is available|will be available|will return|set to return|expected to return|could return|targeting a return|on track to return/, function (s) { var d = dayOf(s); return d ? "预计" + d + "的比赛复出" : "预计复出"; }, 0]
  ];
  function trComment(s) {
    s = String(s || "").toLowerCase(); if (!s) return null;
    var out = [], negOk = false;
    for (var i = 0; i < CRULES.length && out.length < 2; i++) { var m = CRULES[i][0].exec(s); if (m) { var t = CRULES[i][1](s, m); if (out.indexOf(t) < 0) out.push(t); if (CRULES[i][2]) negOk = true; } }
    if (!out.length) return null;
    if (/\b(not|no|never)\b|n't\b/.test(s) && !negOk) return null; // 有否定词又不是明确的否定句型：不硬翻
    return out.join("；");
  }
  P.trComment = trComment;
  function md(iso) { var d = new Date(iso); if (isNaN(d)) return ""; try { return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "numeric", day: "numeric" }).format(d); } catch (e) { return (d.getMonth() + 1) + "/" + d.getDate(); } }
  function retHtml(i) {
    if (!i) return '<div class="ab4">回归：暂无回归消息</div>';
    var dt = i.details || {}, src = "ESPN" + (i.date ? " " + md(i.date) : ""), h = "";
    if (dt.returnDate) { var rd = /^(\d{4})-(\d{2})-(\d{2})/.exec(dt.returnDate); if (rd) h += '<div class="ab4">预计回归：' + (+rd[2]) + "/" + (+rd[3]) + " 前后（" + esc(src) + "）</div>"; }
    var cm = i.shortComment || i.longComment || "", tc = trComment(cm);
    if (cm) h += tc ? '<div class="ab4">最新进展：' + esc(tc) + "（" + esc(src) + "）</div>" : '<div class="ab4 en">最新进展（英文原文）：' + esc(cm) + "（" + esc(src) + "）</div>";
    return h || '<div class="ab4">回归：暂无回归消息</div>';
  }
  function espnEntry(eid, name, tid) {
    if (eid && P.inj.byId && P.inj.byId[eid]) return P.inj.byId[eid];
    var k = normName(name), hit = null;
    ((P.inj.byTeam || {})[tid] || []).forEach(function (i) { if (normName((i.athlete || {}).displayName) === k) hit = i; });
    return hit;
  }
  /* 缺阵名单（赛中/赛前详情共用）：tl = [{id: ESPN 球队 id, cn, ab, side}]，按队分组 */
  function stCls(st) { st = String(st || "").toLowerCase(); return /out/.test(st) ? "red" : /probable/.test(st) ? "grn" : /doubt|quest|day/.test(st) ? "yel" : ""; }
  function absHtml(away, home, tl, I) {
    var h = "", TT = {}, byAb = {}, rows = {}, offNames = {};
    tl.forEach(function (x, i) { TT[x.id] = x; byAb[x.ab] = x.id; rows[x.id] = []; if (!x.side) x.side = i ? "h" : "a"; });
    var IR = P.ir || {}, irList = (IR.games || {})[away + "@" + home];
    var off = irList ? irList : ((I.players || []).length ? I.players : null);
    var offSrc = irList ? "NBA 官方伤病报告 " + (IR.version_pt || "") + " 版" : (off ? "NBA 官方伤病报告（" + (I.report || "") + "）" : "");
    h += '<div class="lu-h">缺阵名单 <small>' + esc(off ? (irList ? "官方伤病报告 " + (IR.version_pt || "") + " 版" : "官方伤病报告") + " · ESPN 补充" : "来源 ESPN") + "</small></div>";
    function row(o, cls, img, name, stt, role, info, extra) {
      return { o: o, h: '<li class="' + cls + (o < 10 ? " core" : "") + '"><div class="ab1"><span class="lu-hd">' + img + '</span><b>' + esc(name) + '</b><em class="abst">' + esc(stt) + "</em></div>" +
        (role ? '<div class="ab2">' + role + "</div>" : "") + '<div class="ab3">' + esc(info) + "</div>" + (extra || "") + "</li>" };
    }
    if (off) {
      off.filter(function (q) { return !q.g_league; }).forEach(function (q) {
        offNames[normName(q.name)] = 1;
        var tid = byAb[q.team]; if (!tid || !rows[tid]) return;
        var cls = stCls(q.status), eid = matchPlayer(q.name, q.team), rr = eid && P.roles[eid] ? RRANK[P.roles[eid].role] : 4;
        var img = q.nba_id ? '<img loading="lazy" alt="" src="https://cdn.nba.com/headshots/nba/latest/260x190/' + esc(q.nba_id) + '.png" onerror="this.remove()">' : (eid ? head(eid) : "");
        rows[tid].push(row(rr * 10 + (cls === "red" ? 0 : cls === "yel" ? 1 : 2), cls, img, offName(q, eid), q.status_cn || q.status, roleTag(eid), (q.reason_cn || q.reason || "原因未写") + " · 来源 " + offSrc + "（太平洋时间）",
          (q.prev_status_cn && irList ? '<div class="ab4 chg">较上一版变化：' + esc(q.prev_status_cn) + "→" + esc(q.status_cn || q.status) + "（" + esc(IR.version_pt || "") + " 版）</div>" : "") + retHtml(espnEntry(eid, q.name, tid))));
      });
    }
    tl.forEach(function (x) { // ESPN：没有官方报告时全用；有官方报告时只补官方没列的人
      var t = x.id;
      ((P.inj.byTeam || {})[t] || []).forEach(function (i) {
        var at = i.athlete || {}, id = (/id\/(\d+)/.exec(JSON.stringify(at.links || "")) || [])[1] || "";
        if (off && offNames[normName(at.displayName)]) return;
        var s = IST[String(i.status || "").toLowerCase()] || ["", i.status || ""], dt = i.details || {}, cls = stCls(i.status);
        var part = dt.type ? (PART[String(dt.type).toLowerCase()] || dt.type) : "", side = dt.side ? (SIDE[String(dt.side).toLowerCase()] || "") : "";
        var rr2 = id && P.roles[id] ? RRANK[P.roles[id].role] : 4;
        rows[t].push(row(rr2 * 10 + (cls === "red" ? 0 : cls === "yel" ? 1 : 2) + 0.5, cls, id ? head(id) : "", fullName(id, at.displayName), s[1], roleTag(id),
          ((side && part && part.indexOf("生病") < 0 ? side : "") + part || "原因未写") + " · 来源 ESPN" + (i.date ? " · " + md(i.date) + " " + ptTime(i.date) + " 太平洋时间" : ""), retHtml(i)));
      });
    });
    tl.forEach(function (x) {
      var rs = rows[x.id].sort(function (a, b) { return a.o - b.o; });
      h += '<div class="lu-tm"><div class="lu-tt">' + esc(x.cn) + " <small>" + (x.side === "h" ? "主队" : "客队") + "</small></div>" +
        (rs.length ? '<ul class="lu-ab">' + rs.map(function (r) { return r.h; }).join("") + "</ul>" : '<p class="lu-none">无</p>') + "</div>";
    });
    return h;
  }
  P.absHtml = absHtml; P.roleTag = roleTag;
  P.prep = function () { return Promise.all([loadInj(), loadRoles(), loadIR()]); };
  P.renderLineup = renderLineup;
  // 置顶提示栏：本场驱逐（技术统计 ejected 字段或驱逐事件）+ 伤退（只用 ESPN/官方明确写出的）
  function clk(c) { c = String(c || ""); return c.indexOf(":") < 0 ? c + " 秒" : c; }
  function renderAlertBar(g) {
    var bar = $("alertBar"); if (!bar) return;
    var out = [], seen = {};
    for (var id in P.ath) if (P.ath[id].ejected) { seen[id] = 1; var ev = null; P.plays.forEach(function (r) { if (r.kind === "eject" && r.who === id) ev = r; });
      out.push('<span class="ab-r">' + esc(((P.teams[P.ath[id].team] || {}).cn || "") + " " + fullName(id, P.ath[id].full)) + " 被驱逐" + (ev ? "（" + perCn(ev.per) + " " + clk(ev.clock) + "）" : "") + "</span>"); }
    P.plays.forEach(function (r) { if (r.kind === "eject" && r.who && !seen[r.who]) { seen[r.who] = 1; out.push('<span class="ab-r">' + esc(r.txt + "（" + perCn(r.per) + " " + clk(r.clock) + "）") + "</span>"); } });
    try { (P.lastItems || []).forEach(function (x) { if (/:inj:|:igs:/.test(x.key) && /离场|不会回场|伤退|回场成疑/.test(x.txt)) out.push('<span class="' + (x.cls === "red" ? "ab-r" : "ab-y") + '">' + esc(x.txt) + "</span>"); }); } catch (e) {}
    var h = out.length ? "⚠ " + out.join("") : "";
    if (bar._h !== h) { bar._h = h; bar.innerHTML = h; bar.hidden = !h; }
  }
  P.renderAlertBar = renderAlertBar;
  P.ir = {}; P.irT = 0;
  function loadIR() { // 官方伤病报告（同站文件，每 60 秒）
    if (Date.now() - P.irT < 60000) return Promise.resolve();
    P.irT = Date.now();
    return fetch("injury_report.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && j.games) P.ir = j; }).catch(function () {});
  }
  P.preT = 0;

  P.kick = function () { var g = selGame(); if (g && g.espn_id !== P.gid) reset(g); P.timer && clearTimeout(P.timer); setTimeout(tick, 50); };

  /* ---- 渲染 ---- */
  function renderEmpty(st) {
    var sb = $("status"); if (sb && sb._h !== "e") { sb._h = "e"; sb.innerHTML = '<p class="note small-miss">开赛后显示场上五人、犯规和伤病情况</p>'; }
    var b = $("pbp"); if (!b) return;
    var t = st === "pre" ? "开赛后开始直播" : "比赛状态读取中…";
    if (b.getAttribute("data-gid") === "empty:" + t) return;
    b.setAttribute("data-gid", "empty:" + t);
    b.innerHTML = '<p class="note small-miss">' + t + "</p>";
  }
  // 校验后的比分：节末事件用各节小分累加（来自校验过的 linescores），最新一条用全站统一比分；其余用 ESPN 当时记录
  function vScore() { var g = selGame(); return g && window.liveFor && g.espn_id === P.gid ? window.liveFor(g) : null; }
  function fixAH(r) {
    if (r.a == null) return r;
    var s = vScore(); if (!s || s.as == null) return r;
    if (r.kind === "end" && s.als && s.hls && s.als.length >= r.per && s.hls.length >= r.per) {
      var a = 0, h = 0, ok = true; for (var i = 0; i < r.per; i++) { if (s.als[i] == null || s.hls[i] == null) ok = false; a += +s.als[i] || 0; h += +s.hls[i] || 0; }
      if (ok && a + h >= r.a + r.h && (r.per < s.period || s.state === "post" || /end|half/i.test(s.name || ""))) { r.a = a; r.h = h; }
    }
    return r;
  }
  P.fixAH = fixAH;
  function lastAH() { // 最新比分：取 ESPN 文字直播最后一条与全站统一比分中较新（总分较大）的
    var pts = P.plays.filter(function (r) { return r.a != null; }), last = pts[pts.length - 1], s = vScore();
    if (s && s.as != null && (!last || s.as + s.hs >= last.a + last.h)) return { a: s.as, h: s.hs };
    return last ? { a: last.a, h: last.h } : null;
  }
  P.lastAH = lastAH;
  // 不改写事件当时的比分：最新几条若落后于校验后的大比分，就不显示比分数字
  function lagTotal() {
    var pts = P.plays.filter(function (r) { return r.a != null; }), last = pts[pts.length - 1], s = vScore();
    return last && s && s.as != null && s.as + s.hs > last.a + last.h ? last.a + last.h : -1;
  }
  function scoreTxt(r) { return r.a == null || r.a + r.h === P._lag ? "" : r.a + ":" + r.h; }
  function li(r, isNew) {
    var t = P.teams[r.team], side = t ? t.side : "";
    return '<li class="k-' + r.kind + (r.alert ? " alert" : "") + (side ? " s-" + side : "") + (isNew ? " new" : "") + (r.made ? " made" : "") + '"><span class="pt">' + esc(perCn(r.per)) + "<br>" + esc(String(r.clock).indexOf(":") < 0 ? r.clock + "秒" : r.clock) + '</span><span class="tx">' + esc(r.txt) + '</span><span class="sc">' + esc(scoreTxt(r)) + "</span></li>";
  }
  // 固定骨架：标题行、固定高度走势图、固定高度内部滚动列表；刷新时只改变化的部分，页面不跳
  function render(g, fresh) {
    var b = $("pbp"); if (!b) return;
    if (b.getAttribute("data-gid") !== String(g.espn_id) || !$("pbpList")) {
      b.setAttribute("data-gid", g.espn_id);
      b.innerHTML = '<div class="pbp-head"><span>比分为 ' + esc(g.away_cn) + " : " + esc(g.home_cn) + '</span><span class="dim" id="pbpUpd"></span></div><div class="pbp-chart" id="pbpChart"></div><ol class="pbp-list" id="pbpList"></ol>';
      fresh = null;
    }
    var upd = P.fail ? "刷新失败，显示 " + (P.okAt || "上次") + " 的内容" : "更新于 " + (P.okAt || "");
    if ($("pbpUpd").textContent !== upd) $("pbpUpd").textContent = upd;
    var ch = chart(g); if ($("pbpChart")._h !== ch) { $("pbpChart")._h = ch; $("pbpChart").innerHTML = ch; }
    P._lag = lagTotal();
    var L = $("pbpList"), list = P.plays.filter(function (r) { return r.txt; });
    if (fresh === null || L.children.length === 0) {
      L.innerHTML = list.slice().reverse().map(function (r) { return li(r, false); }).join("");
    } else if (fresh.length) {
      var add = fresh.filter(function (r) { return r.txt; }).slice().reverse().map(function (r) { return li(r, fresh.length < 40); }).join("");
      if (add) {
        var top = L.scrollTop, h0 = L.scrollHeight;
        L.insertAdjacentHTML("afterbegin", add);
        if (top > 0) L.scrollTop = top + (L.scrollHeight - h0); // 用户在看旧记录时不把内容顶走
      }
    }
  }
  function chart(g) {
    var pts = P.plays.filter(function (r) { return r.a != null; }); if (!pts.length) return "";
    var W = 360, H = 150, L = 26, R = 8, T = 10, B = 20;
    var maxT = Math.max(2880, pts[pts.length - 1].el), maxS = 10;
    var vv = lastAH(); pts.forEach(function (r) { maxS = Math.max(maxS, r.a, r.h); }); if (vv) maxS = Math.max(maxS, vv.a, vv.h); maxS = Math.ceil(maxS / 20) * 20;
    function X(e) { return (L + (W - L - R) * e / maxT).toFixed(1); } function Y(s) { return (T + (H - T - B) * (1 - s / maxS)).toFixed(1); }
    var la = "M" + X(0) + " " + Y(0), lh = la;
    pts.forEach(function (r) { la += " L" + X(r.el) + " " + Y(r.a); lh += " L" + X(r.el) + " " + Y(r.h); });
    var grid = "";
    for (var q = 720; q < maxT; q += (q < 2880 ? 720 : 300)) grid += '<line x1="' + X(q) + '" x2="' + X(q) + '" y1="' + T + '" y2="' + (H - B) + '" class="gl"/>';
    for (var s = 0; s <= maxS; s += 20) grid += '<text x="' + (L - 4) + '" y="' + (+Y(s) + 3) + '" class="yl">' + s + "</text>";
    var lab = ["第1节", "第2节", "第3节", "第4节"].map(function (n, i) { return '<text x="' + X(i * 720 + 360) + '" y="' + (H - 6) + '" class="xl">' + n + "</text>"; }).join("");
    var last = pts[pts.length - 1], va = lastAH();
    if (va && (va.a !== last.a || va.h !== last.h)) { la += " L" + X(last.el) + " " + Y(va.a); lh += " L" + X(last.el) + " " + Y(va.h); last = { el: last.el, a: va.a, h: va.h }; }
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
  P.isOn = function (g) { return !!(P.active && g && String(g.espn_id) === String(P.gid)); };
  P.draw = function (cx, m, cw, ch, W, H, t) {
    if (!P.isOn(selGame())) return;
    if (P.drawExtra) P.drawExtra(cx, m, cw, ch, W, H, t);
  };

  document.addEventListener("visibilitychange", function () { if (!document.hidden) { P.busy = false; P.kick(); } });
  setInterval(function () { if (P.busy && Date.now() - (P.busyAt || 0) > 8000) { P.busy = false; P.kick(); } }, 4000); // 看门狗：请求挂住就重来
  P.loadNames().then(function () { setTimeout(tick, 300); });
  setInterval(P.loadNames, 600000);
})();
