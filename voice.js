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

  function pickVoice() {
    var vs = S.getVoices() || [];
    V.voice = vs.filter(function (v) { return /^zh[-_]CN/i.test(v.lang); })[0] || vs.filter(function (v) { return /^zh/i.test(v.lang); })[0] || null;
  }
  pickVoice(); if (S.onvoiceschanged !== undefined) S.onvoiceschanged = pickVoice;

  function say(t, flush) {
    if (!V.unlocked || V.muted || !t) return;
    if (flush || S.pending) S.cancel(); // 积压时丢掉旧的，只念最新
    var u = new SpeechSynthesisUtterance(t); u.lang = "zh-CN"; if (V.voice) u.voice = V.voice; u.rate = 1.1;
    S.speak(u);
  }
  function g() { return window.NBA && NBA.game(); }
  function sc(gm) {
    var s = window.liveFor && liveFor(gm); if (!s || s.state === "pre") return "";
    var d = s.hs - s.as;
    return gm.away_cn + " " + s.as + " 比 " + s.hs + " " + gm.home_cn + (d === 0 ? "，平分" : "，" + (d > 0 ? gm.home_cn : gm.away_cn) + "领先 " + Math.abs(d) + " 分");
  }
  function intro() {
    var gm = g(); if (!gm) return;
    V.gid = gm.espn_id;
    var s = window.liveFor && liveFor(gm), st = s && window.statusCn ? statusCn(s) : "";
    say("现在解说 " + gm.away_cn + " 对 " + gm.home_cn + "。" + (s && s.state === "pre" ? "比赛还没开始，" + s.tip + " 开赛" : st + "，" + sc(gm)), true);
  }
  function clean(t) { return String(t || "").replace(/\+\d/g, "").replace(/（[^）]*助攻）/g, "").replace(/\s+/g, " ").trim(); }
  function line(r, gm) {
    var tm = (P.teams[r.team] || {}).cn || "";
    if (r.kind === "shot" || r.kind === "ft") {
      if (!r.made) return null; // 不中的不念，避免太吵
      return tm + " " + clean(r.txt) + "，" + sc(gm);
    }
    if (r.kind === "end") return clean(r.txt) + "，" + sc(gm);
    if (r.kind === "timeout" || r.kind === "sub") return clean(r.txt);
    return null;
  }

  P.listeners.push(function (ev, a, first) {
    var gm = g(); if (!gm || !V.unlocked) return;
    if (gm.espn_id !== V.gid) { intro(); return; }
    if (ev === "status") { say("场上状况：" + a.txt); return; }
    if (ev !== "plays" || first || !a || !a.length) return;
    var lines = a.map(function (r) { return line(r, gm); }).filter(Boolean);
    if (lines.length > 3) { // 积压：并成一句
      say("最近几个回合双方有得分，现在 " + sc(gm), true);
    } else lines.forEach(function (t) { say(t); });
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
    if (!V.muted) { var u = new SpeechSynthesisUtterance("解说已开启"); u.lang = "zh-CN"; if (V.voice) u.voice = V.voice; S.speak(u); intro(); keepAwake(); }
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
