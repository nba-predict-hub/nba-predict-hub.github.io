/* 语音解说（基础版）：浏览器自带语音合成；点页面任意处解锁后自动解说当前选中的比赛。只读页面已有数据，不写回任何东西。 */
(function () {
  "use strict";
  var P = window.PBP, S = window.speechSynthesis;
  if (!P) return;
  var V = { unlocked: false, muted: false, gid: null, voice: null, wake: null };
  try { V.muted = localStorage.getItem("nba_voice_muted") === "1"; } catch (e) {}

  // 顶部小提示 + 右下角静音按钮（都是浮层，不占页面位置，不会让页面跳）
  var hint = document.createElement("div"); hint.className = "vhint"; hint.textContent = S ? "点一下页面开始解说" : "这个浏览器不支持语音解说";
  var btn = document.createElement("button"); btn.className = "vbtn"; btn.type = "button";
  document.body.appendChild(hint); document.body.appendChild(btn);
  function paintBtn() { btn.textContent = V.muted ? "🔇 解说已静音" : "🔊 解说中"; btn.title = "锁屏或切到后台后可能停止，请保持页面在前台"; }
  paintBtn();
  if (!S) { btn.style.display = "none"; return; }

  function pickVoice() { // 挑最自然的中文语音
    var vs = S.getVoices() || [], best = null, bs = -1;
    vs.forEach(function (v) {
      var sc = 0, n = v.name || "", l = (v.lang || "").replace("_", "-");
      if (/^zh-CN/i.test(l)) sc += 20; else if (/^zh/i.test(l) || /^cmn/i.test(l)) sc += 8; else return;
      if (/premium|enhanced|neural|natural|online/i.test(n)) sc += 6;
      if (/tingting|ting-ting|xiaoxiao|xiaoyi|yunxi|yunjian|lili|meijia|yu-shu|普通话|mandarin/i.test(n)) sc += 3;
      if (v.localService === false) sc += 1;
      if (sc > bs) { bs = sc; best = v; }
    });
    V.voice = best;
  }
  pickVoice();
  if (S.addEventListener) S.addEventListener("voiceschanged", pickVoice); else S.onvoiceschanged = pickVoice;

  /* ---- 播报队列：顺序念，积压超过 2 条就合并成一句摘要 ---- */
  V.q = []; V.busy = false;
  function utter(item) {
    var u = new SpeechSynthesisUtterance(item.t); u.lang = "zh-CN"; if (V.voice) u.voice = V.voice;
    u.rate = item.hot ? 1.22 : 1.08; u.pitch = item.hot ? 1.18 : 1.0;
    u.onend = u.onerror = function () { V.busy = false; next(); };
    V.busy = true; S.speak(u);
    clearTimeout(V.guard); V.guard = setTimeout(function () { V.busy = false; next(); }, 12000); // 有的浏览器不触发 onend
  }
  function next() { if (V.busy || !V.q.length) return; utter(V.q.shift()); }
  function say(t, flush, hot) {
    if (!V.unlocked || V.muted || !t) return;
    if (flush) { V.q = []; S.cancel(); V.busy = false; }
    V.q.push({ t: t, hot: !!hot }); next();
  }
  function g() { return window.NBA && NBA.game(); }
  function sc(gm) {
    var s = window.liveFor && liveFor(gm); if (!s || s.state === "pre") return ""; if (window.fixScore) fixScore(s);
    var d = s.hs - s.as;
    return gm.away_cn + " " + s.as + " 比 " + s.hs + " " + gm.home_cn + (d === 0 ? "，平分" : "，" + (d > 0 ? gm.home_cn : gm.away_cn) + "领先 " + Math.abs(d) + " 分");
  }
  function intro(keep) {
    var gm = g(); if (!gm) return;
    V.gid = gm.espn_id; V.n = 0; V.prev = null;
    var s = window.liveFor && liveFor(gm), st = s && window.statusCn ? statusCn(s) : "";
    say("现在解说 " + gm.away_cn + " 对 " + gm.home_cn + "。" + (s && s.state === "pre" ? "比赛还没开始，" + s.tip + " 开赛" : st + "，" + sc(gm)), !keep);
  }

  /* ---- 一条逐回合 → 一句口语（只用 ESPN 字段，不编） ---- */
  function rnd(a) { return a[Math.floor(Math.random() * a.length)]; }
  function N(id) { return (id && P.nm && P.nm(id)) || ""; }
  function TM(r) { return (P.teams[r.team] || {}).cn || ""; }
  function clockCn(c) { c = String(c || ""); var m = /^(\d+):(\d+)$/.exec(c); if (m) return (+m[1] ? +m[1] + "分" : "") + (+m[2] ? +m[2] + "秒" : (+m[1] ? "" : "0秒")); return c ? c + "秒" : ""; }
  function perCn(n) { return n <= 4 ? "第" + n + "节" : (n === 5 ? "加时" : "第" + (n - 4) + "个加时"); }
  function secs(c) { c = String(c || ""); var m = /^(\d+):(\d+)/.exec(c); return m ? +m[1] * 60 + +m[2] : parseFloat(c) || 0; }
  function sideOf(r) { var t = P.teams[r.team]; return t ? t.side : null; }
  function leadPhrase(r, gm, prev) { // 从得分队视角说比分变化
    var side = sideOf(r), s = window.liveFor && liveFor(gm); if (side == null || r.h == null || r.a == null) return { t: sc(gm) };
    if (s && window.fixScore) fixScore(s);
    var useS = s && s.state !== "pre" && r === (P.plays[P.plays.length - 1] || null); // 最新一条用校验后的比分
    var H = useS ? s.hs : r.h, Aw = useS ? s.as : r.a;
    var mine = side === "h" ? H : Aw, opp = side === "h" ? Aw : H, d = mine - opp, me = TM(r);
    var pd = prev && prev.h != null ? (side === "h" ? prev.h - prev.a : prev.a - prev.h) : null;
    if (d === 0) return { t: "比分扳平！" + mine + " 平", hot: true };
    if (pd != null && pd <= 0 && d > 0) return { t: me + "反超！" + mine + " 比 " + opp, hot: true };
    if (d > 0) return { t: rnd([me + "领先 " + d + " 分", me + "把分差拉到 " + d + " 分", mine + " 比 " + opp + "，" + me + "领先"]) };
    return { t: rnd([me + "追到只差 " + (-d) + " 分", me + "还落后 " + (-d) + " 分", mine + " 比 " + opp + "，" + me + "追分"]) };
  }
  function J(a, b) { return /[！!。]$/.test(a) ? a + b : a + "，" + b; }
  function line(r, gm, prev) {
    var tm = TM(r), n = N(r.who) || tm, out = null, scored = false, hot = false;
    var clutch = r.per >= 4 && secs(r.clock) <= 120 && r.h != null && Math.abs(r.h - r.a) <= 5;
    if (r.kind === "shot") {
      var k = r.shot && r.shot !== "投篮" ? r.shot : "";
      if (r.made) {
        if (r.three) out = rnd([n + "三分命中！", n + "外线出手，三分进了！", n + "命中三分！"]);
        else if (r.dunk) out = rnd([n + (k || "扣篮") + "！", n + "一记" + (k || "扣篮") + "，打进！"]);
        else out = k ? rnd([n + k + "打进", n + k + "得手", n + k + "命中"]) : rnd([n + "出手命中", n + "得分"]);
        if (r.assist) out = out.replace(/！$/, "") + rnd(["，" + N(r.assist) + "助攻", "，" + N(r.assist) + "送出助攻", "，传球来自" + N(r.assist)]);
        scored = true;
      } else if (r.blocker) out = rnd([N(r.blocker) + "盖帽！封掉" + n + "的出手", n + (k || "出手") + "被" + N(r.blocker) + "盖了！"]);
      else out = rnd([n + (k || "出手") + "不中", n + (k || "出手") + "没进", n + (k || "出手") + "偏出"]);
    } else if (r.kind === "ft") {
      var nth = r.ftof > 1 ? (r.ftof === 2 ? "两罚" : r.ftof + "罚") + "第" + "一二三"[r.ftn - 1] + "罚" : "罚球";
      out = n + nth + (r.made ? rnd(["命中", "稳稳罚进"]) : rnd(["不中", "没罚进"]));
      scored = r.made && (!r.ftof || r.ftn === r.ftof);
    } else if (r.kind === "reb") {
      if (!r.who) out = tm + "拿到篮板";
      else out = r.off ? rnd([n + "抢下前场篮板！", n + "进攻篮板，二次机会"]) : rnd([n + "抢下篮板", n + "后场篮板", "篮板被" + n + "拿到"]);
    } else if (r.kind === "to") {
      if (r.stealer) out = rnd([N(r.stealer) + "抢断！" + n + "失误", n + "的球被" + N(r.stealer) + "断了"]);
      else out = (n || tm) + rnd(["失误", "出现失误"]) + (r.totype && r.totype !== "失误" ? "，" + r.totype : "");
    } else if (r.kind === "foul") {
      out = (n || tm) + (r.ftype || "犯规") + (r.drawer ? rnd(["，" + N(r.drawer) + "造成犯规", "，犯在" + N(r.drawer) + "身上"]) : "");
    } else if (r.kind === "sub") {
      out = rnd([tm + "换人，" + N(r.inId) + "换下" + N(r.outId), N(r.inId) + "替换" + N(r.outId) + "上场"]);
    } else if (r.kind === "timeout") {
      out = String(r.txt || "暂停") + "，" + sc(gm);
    } else if (r.kind === "end") {
      out = String(r.txt || "") + "，" + sc(gm);
    } else if (r.kind === "jump" || r.kind === "review") out = String(r.txt || "");
    if (!out || /^\s*[，,]/.test(out)) return null;
    V.n = (V.n || 0) + 1;
    if (scored) { var lp = leadPhrase(r, gm, prev); out = J(out, lp.t); hot = hot || lp.hot; }
    else if (V.n % 4 === 0 && r.h != null && r.kind !== "end" && r.kind !== "timeout") out = J(out, sc(gm) || (gm.away_cn + " " + r.a + " 比 " + r.h + " " + gm.home_cn));
    if (V.n % 9 === 0 && r.clock) out = perCn(r.per) + "还剩" + clockCn(r.clock) + "，" + out;
    if (clutch && (scored || r.kind === "to" || r.kind === "foul")) { hot = true; if (Math.random() < 0.6) out = "关键时刻！" + out; }
    return { t: out, hot: hot };
  }
  function build(list, gm) {
    var outl = [];
    list.forEach(function (r) { var x = line(r, gm, V.prev); if (r.h != null) V.prev = { h: r.h, a: r.a }; if (x) outl.push(x); });
    return outl;
  }
  V.preview = function (n) { var gm = g(); V.n = 0; V.prev = null; return build(P.plays.slice(-n), gm).map(function (x) { return (x.hot ? "[激动] " : "") + x.t; }); };

  P.listeners.push(function (ev, a, first) {
    var gm = g(); if (!gm || !V.unlocked) return;
    if (gm.espn_id !== V.gid) { intro(); return; }
    if (ev === "status") { say("场上状况：" + a.txt); return; }
    if (ev !== "plays" || !a || !a.length) return;
    if (first) { var lastp = a[a.length - 1]; if (lastp && lastp.h != null) V.prev = { h: lastp.h, a: lastp.a }; return; }
    var lines = build(a, gm);
    if (lines.length + V.q.length > 2) { // 积压：合并成一句，始终贴着直播
      var pa = 0, ph = 0; a.forEach(function (r) { if ((r.kind === "shot" || r.kind === "ft") && r.made) { if (sideOf(r) === "h") ph += r.pts || 0; else pa += r.pts || 0; } });
      var last = lines[lines.length - 1];
      var sum = (pa || ph ? "刚才几个回合，" + gm.away_cn + "得 " + pa + " 分，" + gm.home_cn + "得 " + ph + " 分。" : "") + (last ? last.t + "。" : "") + "现在" + sc(gm);
      say(sum, true, last && last.hot);
    } else lines.forEach(function (x) { say(x.t, false, x.hot); });
  });

  function keepAwake() { // 屏幕常亮（支持的浏览器才有效）
    if (V.muted || !("wakeLock" in navigator) || V.wake) return;
    navigator.wakeLock.request("screen").then(function (w) { V.wake = w; w.addEventListener("release", function () { V.wake = null; }); }).catch(function () {});
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && V.unlocked) keepAwake(); });

  function unlock(e) {
    if (V.unlocked) return;
    if (e && e.target && e.target.closest && e.target.closest(".vbtn")) return;
    V.unlocked = true; hint.classList.add("gone");
    ["pointerdown", "touchstart", "click"].forEach(function (k) { document.removeEventListener(k, unlock, true); });
    P.fastPoll = !V.muted;
    if (!V.muted) { say("解说已开启", true); intro(true); keepAwake(); }
  }
  ["pointerdown", "touchstart", "click"].forEach(function (k) { document.addEventListener(k, unlock, true); });
  if (V.muted) hint.textContent = "解说已静音，点右下角按钮打开";

  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    V.muted = !V.muted; try { localStorage.setItem("nba_voice_muted", V.muted ? "1" : "0"); } catch (x) {}
    paintBtn(); P.fastPoll = !V.muted;
    if (V.muted) { S.cancel(); if (V.wake) V.wake.release(); }
    else { V.unlocked = true; hint.classList.add("gone"); intro(); keepAwake(); }
  });
  window.VOICE = V;
})();
