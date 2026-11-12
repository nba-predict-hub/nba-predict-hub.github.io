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

  // 语音：用户手动选的优先（localStorage 记住）；否则自动挑设备上最好的中文语音
  try { V.pref = localStorage.getItem("nba_voice_uri") || ""; } catch (e) { V.pref = ""; }
  function zhVoices() { return (S.getVoices() || []).filter(function (v) { var l = (v.lang || "").replace("_", "-"); return /^zh-CN/i.test(l) || /^cmn/i.test(l) || /^zh/i.test(l); }); }
  function score(v) {
    var n = (v.name || "") + " " + (v.voiceURI || ""), l = (v.lang || "").replace("_", "-"), sc = /^zh-CN|^cmn/i.test(l) ? 100 : 50;
    if (/premium|enhanced|高音质|增强/i.test(n)) sc += 40; else if (/neural|natural/i.test(n)) sc += 30;
    if (/tingting|ting-ting|lili|meijia|xiaoxiao|xiaoyi|yunxi|yunjian|婷婷|莉莉|美佳/i.test(n)) sc += 10;
    if (v.localService === false) sc += 1;
    return sc;
  }
  function pickVoice() {
    var vs = zhVoices(), best = null, bs = -1;
    vs.forEach(function (v) { if (V.pref && v.voiceURI === V.pref) { best = v; bs = 1e9; } var sc = score(v); if (sc > bs) { bs = sc; best = v; } });
    V.voice = best; paintSel();
  }
  // 设置：手动选语音 + 高音质语音提示
  var gear = document.createElement("button"); gear.className = "vgear"; gear.type = "button"; gear.textContent = "⚙"; gear.title = "解说声音设置";
  var panel = document.createElement("div"); panel.className = "vpanel"; panel.hidden = true;
  panel.innerHTML = '<label>解说声音 <select class="vsel"></select></label><p>iPhone 可在设置里下载高音质中文语音，下载后在这里选它。</p><label class="vsnd"><input type="checkbox" class="vintro"> 启动音效（打开 App 时的入网声）</label>';
  document.body.appendChild(gear); document.body.appendChild(panel);
  var sel = panel.querySelector(".vsel");
  var cbx = panel.querySelector(".vintro"); try { cbx.checked = localStorage.getItem("nba_intro_sound") !== "0"; } catch (x) { cbx.checked = true; }
  cbx.addEventListener("change", function () { try { localStorage.setItem("nba_intro_sound", cbx.checked ? "1" : "0"); } catch (x) {} });
  function paintSel() {
    var vs = zhVoices(); if (!sel) return;
    var h = '<option value="">自动（设备上最好的中文语音）</option>' + vs.sort(function (a, b) { return score(b) - score(a); }).map(function (v) { return '<option value="' + String(v.voiceURI).replace(/"/g, "&quot;") + '"' + (v.voiceURI === V.pref ? " selected" : "") + ">" + String(v.name).replace(/</g, "&lt;") + "</option>"; }).join("");
    if (sel._h !== h) { sel._h = h; sel.innerHTML = h; }
  }
  gear.addEventListener("click", function (e) { e.stopPropagation(); panel.hidden = !panel.hidden; paintSel(); });
  panel.addEventListener("click", function (e) { e.stopPropagation(); });
  sel.addEventListener("change", function () { V.pref = sel.value; try { localStorage.setItem("nba_voice_uri", V.pref); } catch (x) {} pickVoice(); if (V.unlocked && !V.muted) say("换成这个声音解说", true); });
  pickVoice();
  if (S.addEventListener) S.addEventListener("voiceschanged", pickVoice); else S.onvoiceschanged = pickVoice;

  /* ---- 播报队列：顺序念，积压超过 2 条就合并成一句摘要 ---- */
  V.q = []; V.busy = false;
  function utter(item) {
    var u = new SpeechSynthesisUtterance(item.t); u.lang = "zh-CN"; if (V.voice) u.voice = V.voice;
    u.rate = item.clutch ? 1.2 : item.hot ? 1.14 : 1.06; u.pitch = item.clutch ? 1.15 : item.hot ? 1.08 : 1.0; // 关键时刻语速稍快、音调稍高
    u.onend = u.onerror = function () { V.busy = false; next(); };
    V.busy = true; S.speak(u);
    clearTimeout(V.guard); V.guard = setTimeout(function () { V.busy = false; next(); }, 12000); // 有的浏览器不触发 onend
  }
  function next() { if (V.busy || !V.q.length) return; utter(V.q.shift()); }
  function say(t, flush, hot, clutch) {
    if (!V.unlocked || V.muted || !t) return;
    if (flush) { V.q = []; S.cancel(); V.busy = false; }
    V.q.push({ t: t, hot: !!hot, clutch: !!clutch }); next();
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
  V.lastPick = {};
  function rnd(a) { // 同一组句式不连续重复
    var k = a.join("|").length + ":" + a.length, i = Math.floor(Math.random() * a.length);
    if (a.length > 1 && V.lastPick[k] === i) i = (i + 1 + Math.floor(Math.random() * (a.length - 1))) % a.length;
    V.lastPick[k] = i; return a[i];
  }
  // 一波连续得分：从这条往前数，同一队连续得分、对手 0 分（只用文字直播里的得分事件）
  function runOf(r) {
    var i = P.plays.indexOf(r), side = sideOf(r), pts = 0;
    if (i < 0 || !side) return 0;
    for (; i >= 0; i--) { var x = P.plays[i]; if (!((x.kind === "shot" || x.kind === "ft") && x.made && x.pts)) continue; if (sideOf(x) !== side) break; pts += x.pts; }
    return pts;
  }
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
        if (r.three) out = rnd([n + "三分命中！", n + "外线出手，三分！进了！", n + "果断三分，空心入网！", n + "远投三分，命中！", n + "三分线外出手——进了！"]);
        else if (r.dunk) out = rnd([n + (k || "扣篮") + "！", n + "一记" + (k || "扣篮") + "，砸进去了！", n + "暴力" + (k || "扣篮") + "！", n + "冲到篮下，" + (k || "扣篮") + "得手！"]);
        else out = k ? rnd([n + k + "打进", n + k + "得手", n + k + "命中", n + k + "，两分"]) : rnd([n + "出手命中", n + "得分", n + "拿下两分"]);
        if (r.assist) out = out.replace(/！$/, "") + rnd(["，" + N(r.assist) + "助攻", "，" + N(r.assist) + "送出助攻", "，传球来自" + N(r.assist)]);
        scored = true;
      } else if (r.blocker) out = rnd([N(r.blocker) + "大帽！封掉" + n + "的出手！", n + (k || "出手") + "被" + N(r.blocker) + "盖了！", N(r.blocker) + "一记火锅！" + n + "被封盖！", "盖帽！" + N(r.blocker) + "把" + n + "的球扇飞！"]);
      else out = rnd([n + (k || "出手") + "不中", n + (k || "出手") + "没进", n + (k || "出手") + "偏出", n + (k || "出手") + "，弹框而出"]);
    } else if (r.kind === "ft") {
      var nth = r.ftof > 1 ? (r.ftof === 2 ? "两罚" : r.ftof + "罚") + "第" + "一二三"[r.ftn - 1] + "罚" : "罚球";
      out = n + nth + (r.made ? rnd(["命中", "稳稳罚进"]) : rnd(["不中", "没罚进"]));
      scored = r.made && (!r.ftof || r.ftn === r.ftof);
    } else if (r.kind === "reb") {
      if (!r.who) out = tm + "拿到篮板";
      else out = r.off ? rnd([n + "抢下前场篮板！", n + "进攻篮板，二次机会", n + "冲抢前场板得手"]) : rnd([n + "抢下篮板", n + "后场篮板", "篮板被" + n + "拿到", n + "护住篮板"]);
    } else if (r.kind === "to") {
      if (r.stealer) out = rnd([N(r.stealer) + "抢断！" + n + "失误", n + "的球被" + N(r.stealer) + "断了"]);
      else out = (n || tm) + rnd(["失误", "出现失误"]) + (r.totype && r.totype !== "失误" ? "，" + r.totype : "");
    } else if (r.kind === "eject") {
      out = (N(r.who) || String(r.txt || "").replace(/\s*被驱逐出场$/, "")) + "被驱逐出场！";
    } else if (r.kind === "foul" && r.alert) {
      out = r.who ? N(r.who) + String(r.txt || "").replace(/^\S+\s*/, "").replace(/（(.*?)）/g, "$1") + "！" : String(r.txt || "") + "！";
    } else if (r.kind === "foul") {
      out = (n || tm) + (r.ftype || "犯规") + (r.drawer ? rnd(["，" + N(r.drawer) + "造成犯规", "，犯在" + N(r.drawer) + "身上"]) : "");
    } else if (r.kind === "sub") {
      out = rnd([tm + "换人，" + N(r.inId) + "换下" + N(r.outId), N(r.inId) + "替换" + N(r.outId) + "上场", N(r.inId) + "上，" + N(r.outId) + "下"]);
    } else if (r.kind === "timeout") {
      out = String(r.txt || "暂停") + "，" + sc(gm);
    } else if (r.kind === "end") {
      var fs = window.liveFor && liveFor(gm);
      if (/比赛结束/.test(r.txt || "") && fs && fs.as != null && fs.hs !== fs.as) { var w = fs.hs > fs.as; out = "比赛结束！终场比分 " + gm.away_cn + " " + fs.as + " 比 " + fs.hs + " " + gm.home_cn + "，" + (w ? gm.home_cn : gm.away_cn) + "赢下 " + Math.abs(fs.hs - fs.as) + " 分"; }
      else out = String(r.txt || "") + "，" + sc(gm);
    } else if (r.kind === "jump" || r.kind === "review") out = String(r.txt || "");
    if (!out || /^\s*[，,]/.test(out)) return null;
    V.n = (V.n || 0) + 1;
    if ((r.made && (r.three || r.dunk)) || r.blocker) hot = true;
    if (scored) {
      var lp = leadPhrase(r, gm, prev); out = J(out, lp.t); hot = hot || lp.hot;
      var run = runOf(r); if (run >= 6) { out = J(out, rnd([tm + "打出一波 " + run + "–0 的小高潮", tm + "一波 " + run + "–0！", "这一波 " + tm + " " + run + "–0"])); hot = true; }
    }
    else if (V.n % 4 === 0 && r.h != null && r.kind !== "end" && r.kind !== "timeout") out = J(out, sc(gm) || (gm.away_cn + " " + r.a + " 比 " + r.h + " " + gm.home_cn));
    if (V.n % 9 === 0 && r.clock) out = perCn(r.per) + "还剩" + clockCn(r.clock) + "，" + out;
    if (clutch && (scored || r.kind === "to" || r.kind === "foul")) { hot = true; if (Math.random() < 0.6) out = rnd(["关键时刻！", "生死时刻！", "最后两分钟！"]) + out; }
    if (r.alert || r.kind === "eject") hot = true;
    return { t: out, hot: hot, clutch: clutch, alert: !!(r.alert || r.kind === "eject"), crit: !!r.crit, who: r.who, kind: r.kind };
  }
  function build(list, gm) {
    var outl = [];
    list.forEach(function (r) {
      var x = line(r, gm, V.prev); if (r.h != null) V.prev = { h: r.h, a: r.a }; if (!x) return;
      var lastA = null; for (var i = outl.length - 1; i >= 0; i--) if (outl[i].alert) { lastA = outl[i]; break; }
      if (x.kind === "eject" && lastA && lastA.kind === "foul" && lastA.who === x.who) { lastA.t = lastA.t.replace(/！$/, "") + "，被驱逐出场！"; return; } // 恶意犯规 + 驱逐 合成一句
      outl.push(x);
    });
    return outl;
  }
  V.preview = function (n) { var gm = g(); V.n = 0; V.prev = null; return build(P.plays.slice(-n), gm).map(function (x) { return (x.clutch ? "[关键] " : x.hot ? "[激动] " : "") + x.t; }); };

  P.listeners.push(function (ev, a, first) {
    var gm = g(); if (!gm || !V.unlocked || V.muted) return;
    if (gm.espn_id !== V.gid) { intro(); return; }
    if (ev === "status") { V.q.push({ t: "场上状况：" + a.txt, hot: true, alert: true }); next(); return; } // 伤退等场上状况：单独播报，不合并
    if (ev !== "plays" || !a || !a.length) return;
    if (first) { var lastp = a[a.length - 1]; if (lastp && lastp.h != null) V.prev = { h: lastp.h, a: lastp.a }; return; }
    var all = build(a, gm), alerts = all.filter(function (x) { return x.alert || x.crit; }), lines = all.filter(function (x) { return !x.alert && !x.crit; });
    // 重大事件（驱逐/恶意犯规/技术犯规/冲突/伤退/挑战复核/违例）永不合并、永不丢：先保留队列里的重大事件，再逐条播报
    V.q = V.q.filter(function (q) { return q.alert; });
    alerts.forEach(function (x) { V.q.push({ t: x.t, hot: true, alert: true }); }); if (alerts.length) next();
    if (!lines.length) return;
    if (lines.length + V.q.length - alerts.length > 2) { // 积压：合并成一句，始终贴着直播
      var pa = 0, ph = 0; a.forEach(function (r) { if ((r.kind === "shot" || r.kind === "ft") && r.made) { if (sideOf(r) === "h") ph += r.pts || 0; else pa += r.pts || 0; } });
      var last = lines[lines.length - 1];
      var sum = (pa || ph ? "刚才几个回合，" + gm.away_cn + "得 " + pa + " 分，" + gm.home_cn + "得 " + ph + " 分。" : "") + (last ? last.t + "。" : "") + (last && / 比 |领先|平/.test(last.t) ? "" : "现在" + sc(gm));
      V.q.push({ t: sum, hot: !!(last && last.hot) }); next();
    } else { var x = lines[lines.length - 1]; if (V.unlocked && !V.muted) say(x.t, false, x.hot, x.clutch); } // 不排队：等待中的普通旧句子已作废，只留最新一句
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
  V.say = say;
  window.VOICE = V;
})();
