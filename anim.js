/* 球场动画小人：每条 ESPN 逐回合记录对应一个动作动画。投篮位置、结果、球员、换人都是真实记录；两个回合之间的跑位只是过渡动画。只用 Canvas 自绘。 */
(function () {
  "use strict";
  var P = window.PBP; if (!P) return;
  var A = { sp: {}, lineup: {}, poss: null, per: 0, q: [], cur: null, fx: [], lastShotSide: null, last: 0 };
  P.anim = A;
  function sideOf(tid) { var t = P.teams[tid]; return t ? t.side : null; }
  function tidOfSide(s) { for (var k in P.teams) if (P.teams[k].side === s) return k; return null; }
  function other(tid) { var s = sideOf(tid); return s ? tidOfSide(s === "h" ? "a" : "h") : null; }
  // 场地用英尺：X 0~94（左→右），Y 0~50（上→下）。主队进攻左边篮筐，客队进攻右边（和投篮点一致）。
  function toFt(side, x, y) { return side === "h" ? { X: y + 5.25, Y: x } : { X: 94 - (y + 5.25), Y: 50 - x }; }
  function rim(side) { return toFt(side, 25, 0); }
  var OFF = [[25, 24], [3, 5], [47, 5], [9, 19], [41, 19]];
  function homeSpot(tid, i) {
    var mine = sideOf(tid); if (!mine) return { X: 47, Y: 25 };
    var offense = A.poss === tid, atk = offense ? mine : (sideOf(A.poss) || (mine === "h" ? "a" : "h"));
    var o = OFF[i % 5], p = toFt(atk, o[0], o[1]);
    if (!offense) { var b = rim(atk); p = { X: p.X + (b.X - p.X) * 0.33, Y: p.Y + (b.Y - p.Y) * 0.33 + 1.5 }; }
    return p;
  }

  /* ---- 场上人员 ---- */
  function mk(id) {
    var a = P.ath[id]; if (!a) return null;
    if (!A.sp[id]) A.sp[id] = { id: id, team: a.team, X: 47, Y: 53, tx: 47, ty: 53, ph: Math.random() * 6.28, out: false };
    A.sp[id].out = false;
    return A.sp[id];
  }
  function onCourt(id) {
    var a = P.ath[id]; if (!a) return;
    var L = A.lineup[a.team] || (A.lineup[a.team] = []);
    if (L.indexOf(id) < 0) { L.push(id); if (L.length > 5) leave(L[0]); }
    mk(id);
  }
  function leave(id) {
    var a = P.ath[id]; if (!a) return;
    var L = A.lineup[a.team] || [], i = L.indexOf(id); if (i >= 0) L.splice(i, 1);
    if (A.sp[id]) { A.sp[id].out = true; A.sp[id].tx = 47; A.sp[id].ty = 54; }
  }
  // 把一条记录对场上状态的影响（人员、球权）应用上去
  function apply(r) {
    if (r.per !== A.per) {
      if (A.per && r.per > A.per) { // 节间换人可能没有记录：新一节只显示确定在场的人
        for (var t in A.lineup) A.lineup[t].slice().forEach(leave);
      }
      A.per = r.per;
    }
    if (r.kind === "sub") { if (r.outId) leave(r.outId); if (r.inId) onCourt(r.inId); return; }
    [r.who, r.assist, r.blocker, r.stealer].forEach(function (id) { if (id && P.ath[id]) onCourt(id); });
    var tid = r.team || (r.who && P.ath[r.who] ? P.ath[r.who].team : null);
    if (r.kind === "shot") { A.lastShotSide = sideOf(tid); if (r.made) A.poss = other(tid); else A.poss = tid; }
    else if (r.kind === "ft") { A.lastShotSide = sideOf(tid); A.poss = (r.made && r.ftn === r.ftof) ? other(tid) : tid; }
    else if (r.kind === "reb" && tid) A.poss = tid;
    else if (r.kind === "to" && tid) A.poss = other(tid);
    else if (r.kind === "jump" && tid) A.poss = tid;
  }
  function retarget() {
    for (var t in A.lineup) A.lineup[t].forEach(function (id, i) { var s = A.sp[id]; if (!s) return; var p = homeSpot(t, i); s.tx = p.X; s.ty = p.Y; });
  }
  function initStarters() {
    for (var id in P.ath) if (P.ath[id].starter) onCourt(id);
  }

  /* ---- 记录 → 动作 ---- */
  function shortTxt(r) { return String(r.txt || "").replace(/（.*?）/g, "").replace(/\s+\+\d+$/, "").trim(); }
  function enqueue(r) { A.q.push(r); }
  function actText(r) {
    var tm = P.teams[r.team], a = P.ath[r.who], txt = String(r.txt || "").replace(/（(.*?)）/g, function (m0, x) { return /罚/.test(x) ? m0 : ""; }).trim();
    if (a && tm && /^(shot|ft|reb|to|foul)$/.test(r.kind)) return tm.cn + " " + (a.jersey ? a.jersey + "号 " : "") + txt;
    return txt;
  }
  function barSub(r) {
    var g = window.NBA && NBA.game(), s = g && window.liveFor ? liveFor(g) : null;
    if (s && window.NBA_BAR && s.state !== "pre") return NBA_BAR.scoreLine(g, s);
    if (!r || !g) return "";
    var per = r.per <= 4 ? "第" + r.per + "节" : "加时";
    return per + " " + r.clock + " · " + g.away_cn + " " + r.a + " : " + r.h + " " + g.home_cn;
  }
  function start(r) {
    apply(r);
    var tid = r.team || (r.who && P.ath[r.who] ? P.ath[r.who].team : null), side = sideOf(tid);
    var c = { r: r, t0: performance.now(), side: side, dur: 1100 };
    if (r.kind === "shot") {
      c.dur = 2200;
      c.spot = r.x != null ? toFt(side, r.x, r.y) : toFt(side, 25, r.dunk || r.lay ? 1.5 : 15);
      c.rim = rim(side);
    } else if (r.kind === "ft") { c.dur = 1700; c.spot = toFt(side, 25, 13.75); c.rim = rim(side); }
    else if (r.kind === "reb") { var s2 = A.lastShotSide || side; c.spot = toFt(s2, 25 + (Math.random() * 8 - 4), 3 + Math.random() * 3); c.dur = 1100; }
    else if (r.kind === "sub") c.dur = 1000;
    else if (r.kind === "timeout" || r.kind === "end") c.dur = 1400;
    A.cur = c; A.lastR = r; A.barAct = actText(r);
    retarget();
  }
  function speed() { return A.q.length > 3 ? Math.min(8, 1 + A.q.length / 2) : 1; }

  P.listeners.push(function (ev, fresh, first) {
    if (ev === "reset") { A.sp = {}; A.lineup = {}; A.poss = null; A.per = 0; A.q = []; A.cur = null; A.fx = []; return; }
    if (ev !== "plays") return;
    if (first) {
      // 首次载入：静默重放全部记录，算出现在的场上人员和球权，只播放最后一条
      A.sp = {}; A.lineup = {}; A.q = []; A.cur = null; A.per = 0;
      initStarters();
      var all = P.plays, n = all.length;
      for (var i = 0; i < n - 1; i++) apply(all[i]);
      retarget(); for (var id in A.sp) { A.sp[id].X = A.sp[id].tx; A.sp[id].Y = A.sp[id].ty; }
      if (n) enqueue(all[n - 1]);
    } else fresh.forEach(enqueue);
  });

  /* ---- 每帧更新和绘制 ---- */
  function ease(k) { return k < 0 ? 0 : k > 1 ? 1 : k * k * (3 - 2 * k); }
  P.drawExtra = function (cx, m, cw, ch, W, H, t) {
    var now = performance.now(), dt = Math.min(0.1, (now - (A.last || now)) / 1000); A.last = now;
    var sx = cw / 94, sy = ch / 50; function px(X) { return m + X * sx; } function py(Y) { return m + Y * sy; }
    var sp = speed(), c = A.cur;
    if (!c && A.q.length) { start(A.q.shift()); c = A.cur; }
    var k = c ? (now - c.t0) * sp / c.dur : 0;
    if (c && k >= 1) {
      if (c.r.kind === "shot" && c.spot) A.mark = { X: c.spot.X, Y: c.spot.Y, made: c.r.made, t: now };
      A.endT = now; A.cur = null; c = null; retarget();
    }
    // 球场下方大字：当前动作；空闲几秒后显示谁持球
    if (!c && !A.q.length && A.endT && now - A.endT > 3000 && A.poss && P.teams[A.poss]) A.barAct = P.teams[A.poss].cn + " 持有球权";
    if (window.NBA_BAR) NBA_BAR.set(A.barAct || "直播中", barSub(A.lastR));
    // 动作对目标点的覆盖
    var ov = {}, r = c && c.r;
    if (c) {
      if ((r.kind === "shot" || r.kind === "ft" || r.kind === "reb") && r.who && c.spot) ov[r.who] = c.spot;
      if (r.kind === "shot" && r.blocker && c.spot) ov[r.blocker] = { X: c.spot.X + (c.rim.X - c.spot.X) * 0.12, Y: c.spot.Y + (c.rim.Y - c.spot.Y) * 0.12 };
      if (r.kind === "shot" && r.assist && A.sp[r.assist] && k < 0.4) { /* 助攻者原地出球 */ }
      if (r.kind === "to" && r.stealer && r.who && A.sp[r.who]) ov[r.stealer] = { X: A.sp[r.who].X, Y: A.sp[r.who].Y };
      if (r.kind === "ft") { // 其他人站到罚球区两侧
        var j = 0; for (var tt in A.lineup) A.lineup[tt].forEach(function (id) { if (id === r.who) return; var lane = toFt(c.side, j % 2 ? 33 : 17, 2 + 3 * (j >> 1) % 9); ov[id] = lane; j++; });
      }
    }
    // 移动
    var list = [];
    for (var id in A.sp) {
      var s = A.sp[id], tg = ov[id] || { X: s.tx, Y: s.ty };
      var jx = (ov[id] ? 0 : Math.sin(t * 1.3 + s.ph) * 1.2), jy = (ov[id] ? 0 : Math.cos(t * 1.1 + s.ph) * 0.9); // 无动作时轻微跑动
      var f = Math.min(1, dt * (ov[id] ? 7 : 2.2) * sp);
      s.X += (tg.X + jx - s.X) * f; s.Y += (tg.Y + jy - s.Y) * f;
      if (s.out && s.Y > 52.5) { delete A.sp[id]; continue; }
      list.push(s);
    }
    // 小人
    list.sort(function (a, b) { return a.Y - b.Y; });
    list.forEach(function (s) {
      var tm = P.teams[s.team] || {}, a = P.ath[s.id] || {}, X = px(s.X), Y = py(s.Y), act = r && (r.who === s.id || r.assist === s.id || r.blocker === s.id || r.stealer === s.id || r.inId === s.id);
      var R = act ? 17 : 11, bob = Math.abs(Math.sin(t * 6 + s.ph)) * 2;
      cx.save();
      cx.globalAlpha = s.out ? 0.3 : act ? 1 : 0.45;
      cx.fillStyle = "rgba(0,0,0,.35)"; cx.beginPath(); cx.ellipse(X, Y + R + 2, R * 0.8, 4, 0, 0, 6.283); cx.fill();
      cx.shadowColor = act ? "#fff" : (tm.color || "#888"); cx.shadowBlur = act ? 22 : 8;
      cx.fillStyle = tm.color || "#888"; cx.strokeStyle = tm.alt || "#fff"; cx.lineWidth = 3;
      cx.beginPath(); cx.arc(X, Y - bob, R, 0, 6.283); cx.fill(); cx.stroke();
      cx.shadowBlur = 0; cx.fillStyle = "#fff"; cx.font = "800 15px -apple-system,'PingFang SC',sans-serif"; cx.textAlign = "center"; cx.textBaseline = "middle";
      cx.font = (act ? "800 16px" : "700 12px") + " -apple-system,'PingFang SC',sans-serif"; cx.fillText(a.jersey || "", X, Y - bob + 1);
      if (act) { // 小人旁写中文队名 + 球员姓
        var lab = (tm.cn || "") + " " + (a.name || ""); cx.font = "800 19px -apple-system,'PingFang SC','Microsoft YaHei',sans-serif";
        var lw = cx.measureText(lab).width + 14, lx = Math.max(m + lw / 2, Math.min(W - m - lw / 2, X)), ly = Math.min(H - m - 12, Y + R + 16);
        cx.globalAlpha = 1; cx.fillStyle = "rgba(5,10,24,.85)"; cx.strokeStyle = tm.color || "#888"; cx.lineWidth = 2;
        roundRect(cx, lx - lw / 2, ly - 13, lw, 26, 8); cx.fill(); cx.stroke();
        cx.fillStyle = "#fff"; cx.fillText(lab, lx, ly + 1);
      }
      cx.restore();
    });
    // 球和结果
    if (c && (r.kind === "shot" || r.kind === "ft") && c.spot) {
      var k0 = r.kind === "ft" ? 0.35 : 0.45, k1 = 0.85, s0 = c.spot, rm = c.rim;
      if (k >= k0) {
        var u = ease((k - k0) / (k1 - k0)), bx = s0.X + (rm.X - s0.X) * u, by = s0.Y + (rm.Y - s0.Y) * u, lift = Math.sin(u * Math.PI) * (r.dunk ? 18 : 60);
        if (k > k1 && !r.made && !r.blocker) { var v = (k - k1) / (1 - k1); bx = rm.X + (rm.X < 47 ? 1 : -1) * 6 * v; by = rm.Y + 5 * v; lift = Math.sin(v * Math.PI) * 25; }
        if (r.blocker && u > 0.25) { var v2 = (u - 0.25) / 0.75; bx = s0.X + (rm.X - s0.X) * 0.25 - 4 * v2; by = s0.Y + 8 * v2; lift = Math.sin((0.25 + v2 * 0.5) * Math.PI) * 30 * (1 - v2); }
        cx.save(); cx.fillStyle = "#ff9a3c"; cx.shadowColor = "#ff9a3c"; cx.shadowBlur = 14;
        cx.beginPath(); cx.arc(px(bx), py(by) - lift, 7, 0, 6.283); cx.fill(); cx.restore();
      } else if (r.who && A.sp[r.who]) {
        var sh = A.sp[r.who]; cx.save(); cx.fillStyle = "#ff9a3c"; cx.beginPath(); cx.arc(px(sh.X) + 12, py(sh.Y) + 8 - Math.abs(Math.sin(t * 10)) * 6, 6, 0, 6.283); cx.fill(); cx.restore();
      }
      if (k > k1) {
        var v3 = (k - k1) / (1 - k1), col = r.made ? "#2fe39a" : "#ff4d6d";
        cx.save(); cx.globalAlpha = 1 - v3; cx.strokeStyle = col; cx.lineWidth = 4; cx.shadowColor = col; cx.shadowBlur = 20;
        cx.beginPath(); cx.arc(px(rm.X), py(rm.Y), 10 + 30 * v3, 0, 6.283); cx.stroke();
        if (r.made && r.pts) { cx.fillStyle = col; cx.font = "900 34px -apple-system,sans-serif"; cx.textAlign = "center"; cx.fillText("+" + r.pts, px(rm.X) + (rm.X < 47 ? 40 : -40), py(rm.Y) - 20 - 30 * v3); }
        cx.restore();
      }
    }
    // 气泡文字
    if (c && r) {
      cx.save(); cx.textAlign = "center"; cx.textBaseline = "middle";
      if (r.kind === "shot" && r.assist && A.sp[r.assist] && k < 0.6) { // 助攻小气泡
        var as = A.sp[r.assist]; cx.font = "700 16px -apple-system,'PingFang SC',sans-serif"; cx.fillStyle = "#33e1ff"; cx.fillText("助攻", px(as.X), py(as.Y) - 28);
      }
      if (r.kind === "shot" && r.blocker && A.sp[r.blocker] && k > 0.5) { var bl = A.sp[r.blocker]; cx.font = "800 18px -apple-system,'PingFang SC',sans-serif"; cx.fillStyle = "#ffc53d"; cx.fillText("盖帽！", px(bl.X), py(bl.Y) - 28); }
      if (r.kind === "to" && r.stealer && A.sp[r.stealer] && k > 0.4) { var st = A.sp[r.stealer]; cx.font = "800 18px -apple-system,'PingFang SC',sans-serif"; cx.fillStyle = "#33e1ff"; cx.fillText("抢断！", px(st.X), py(st.Y) - 28); }
      if (r.kind === "sub" && r.outId && A.sp[r.outId]) { var os = A.sp[r.outId]; cx.font = "700 16px -apple-system,'PingFang SC',sans-serif"; cx.fillStyle = "#8a96b8"; cx.fillText("下场", px(os.X), Math.min(H - m - 8, py(os.Y) - 26)); }
      cx.restore();
    }
    if (A.mark && now - A.mark.t < 3500) {
      var fm = 1 - (now - A.mark.t) / 3500, mx = px(A.mark.X), my = py(A.mark.Y);
      cx.save(); cx.globalAlpha = fm; cx.lineWidth = 4;
      if (A.mark.made) { cx.fillStyle = "#2fe39a"; cx.shadowColor = "#2fe39a"; cx.shadowBlur = 12; cx.beginPath(); cx.arc(mx, my, 9, 0, 6.283); cx.fill(); }
      else { cx.strokeStyle = "#ff4d6d"; cx.beginPath(); cx.moveTo(mx - 8, my - 8); cx.lineTo(mx + 8, my + 8); cx.moveTo(mx + 8, my - 8); cx.lineTo(mx - 8, my + 8); cx.stroke(); }
      cx.restore();
    }
    if (A.q.length > 3) { cx.save(); cx.fillStyle = "rgba(233,238,252,.7)"; cx.font = "600 14px -apple-system,'PingFang SC',sans-serif"; cx.textAlign = "right"; cx.fillText("追赶最新记录 ×" + sp.toFixed(1), W - m - 6, m + 16); cx.restore(); }
  };
  function roundRect(cx, x, y, w, h, r) { cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); }

  // 测试用：用一场已结束比赛的记录回放（不影响正常页面）
  A._replay = function (d, g, n, more) {
    clearTimeout(P.timer); P._load(d, g);
    var all = (d.plays || []).map(function (p) { return P._tr(p); });
    P.plays = all.slice(0, n); P.active = true;
    P.listeners.forEach(function (f) { f("plays", P.plays, true); });
    var rest = all.slice(n, n + (more || 20)); P.plays = P.plays.concat(rest);
    P.listeners.forEach(function (f) { f("plays", rest, false); });
  };
})();
