(function () {
  "use strict";

  var STORAGE_KEY = "print.fingerprint.v2";
  var HOLD_MS = 560;
  var MIN_SESSION_MS = 3000;
  var SESSION_CAP_MS = 2 * 60 * 60 * 1000;
  var SESSION_CAP_MIN = 120;
  var WEAR_MAX = 0.72;
  var WEAR_TAU_MIN = 28;
  var EXP_HOURS = 8;
  var RECOVER_DAYS_BASE = 5;
  var RECOVER_DAYS_MIN = 0.5;
  var CALLUS_TAU_H = 10;
  var MAX_SNAPS = 10;

  var RIDGE = "#4a4742";
  var RIDGE_DARK = "#d8d3c8";
  var WEAR = "#c4b49a";
  var CALLUS = "#b39472";
  var CALLUS_DARK = "#e0c9a8";

  var app = document.getElementById("app");
  var printHit = document.getElementById("printHit");
  var canvas = document.getElementById("printCanvas");
  var hint = document.getElementById("hint");
  var statusBox = document.getElementById("status");
  var statusLabel = document.getElementById("statusLabel");
  var timerEl = document.getElementById("timer");
  var closeBtn = document.getElementById("closeBtn");
  var doneBtn = document.getElementById("doneBtn");
  var infoBtn = document.getElementById("infoBtn");
  var infoModal = document.getElementById("infoModal");
  var infoClose = document.getElementById("infoClose");
  var guideRow = document.getElementById("guideRow");
  var sheet = document.getElementById("sheet");
  var sheetHandle = document.getElementById("sheetHandle");
  var sheetClose = document.getElementById("sheetClose");
  var snapRow = document.getElementById("snapRow");
  var glow = document.getElementById("glow");

  var mode = "home";
  var state = loadState();
  var ridges = null;
  var holdTimer = null;
  var holdRaf = 0;
  var holdStart = 0;
  var holding = false;
  var timerClock = 0;
  var reduceMotion = false;

  if (window.matchMedia) {
    var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceMotion = !!(motionQuery && motionQuery.matches);
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function mix(a, b, t) {
    t = clamp(t, 0, 1);
    var ar = parseInt(a.slice(1, 3), 16);
    var ag = parseInt(a.slice(3, 5), 16);
    var ab = parseInt(a.slice(5, 7), 16);
    var br = parseInt(b.slice(1, 3), 16);
    var bg = parseInt(b.slice(3, 5), 16);
    var bb = parseInt(b.slice(5, 7), 16);
    var r = Math.round(ar + (br - ar) * t);
    var g = Math.round(ag + (bg - ag) * t);
    var bl = Math.round(ab + (bb - ab) * t);
    return "rgb(" + r + "," + g + "," + bl + ")";
  }

  function hash(n) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function defaultState() {
    return {
      wear: 0,
      callus: 0,
      lastEndAt: Date.now(),
      totalMs: 0,
      session: null,
      snaps: []
    };
  }

  function loadState() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var parsed = JSON.parse(raw);
      var base = defaultState();
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.wear === "number") base.wear = clamp(parsed.wear, 0, 1);
        if (typeof parsed.callus === "number") base.callus = clamp(parsed.callus, 0, 1);
        if (typeof parsed.lastEndAt === "number") base.lastEndAt = parsed.lastEndAt;
        if (typeof parsed.totalMs === "number") base.totalMs = parsed.totalMs;
        if (parsed.session && typeof parsed.session.startAt === "number") {
          base.session = { startAt: parsed.session.startAt };
        }
        if (parsed.snaps && parsed.snaps.length) {
          base.snaps = parsed.snaps.slice(-MAX_SNAPS);
        }
        base.callus = callusFromTotal(base.totalMs);
      }
      return base;
    } catch (err) {
      return defaultState();
    }
  }

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {}
  }

  function capMs(ms) {
    if (ms < 0) return 0;
    if (ms > SESSION_CAP_MS) return SESSION_CAP_MS;
    return ms;
  }

  function capMinutes(minutes) {
    return clamp(minutes, 0, SESSION_CAP_MIN);
  }

  function wearScale(totalMs) {
    return 1 / (1 + (totalMs / 3600000) / EXP_HOURS);
  }

  function recoverDays(totalMs) {
    return Math.max(RECOVER_DAYS_MIN, RECOVER_DAYS_BASE * wearScale(totalMs));
  }

  function sessionWear(minutes, totalMs) {
    minutes = capMinutes(minutes);
    if (minutes <= 0) return 0;
    var raw = WEAR_MAX * (1 - Math.exp(-minutes / WEAR_TAU_MIN));
    return raw * wearScale(totalMs || 0);
  }

  function callusFromTotal(totalMs) {
    return clamp(1 - Math.exp(-(totalMs / 3600000) / CALLUS_TAU_H), 0, 1);
  }

  function applyRecovery(now) {
    if (state.session) return;
    var hours = (now - state.lastEndAt) / 3600000;
    if (hours <= 0) return;
    state.wear = clamp(state.wear - hours / (recoverDays(state.totalMs) * 24), 0, 1);
    state.lastEndAt = now;
  }

  function currentVisual(now) {
    var extra = 0;
    if (state.session && state.session.startAt) {
      extra = Math.max(0, now - state.session.startAt);
    }
    var wear = state.wear;
    if (extra > 0) {
      wear = clamp(wear + sessionWear(capMs(extra) / 60000, state.totalMs), 0, 1);
    }
    return {
      wear: wear,
      callus: callusFromTotal(state.totalMs + extra)
    };
  }

  function pushSnap(wear, callus) {
    state.snaps.push({
      wear: wear,
      callus: callus,
      at: Date.now()
    });
    if (state.snaps.length > MAX_SNAPS) {
      state.snaps = state.snaps.slice(-MAX_SNAPS);
    }
  }

  var CORE_X = -0.02;
  var CORE_Y = -0.14;
  var DELTA_X = 0.26;
  var DELTA_Y = 0.24;
  var OVAL_X = 0.58;
  var OVAL_Y = 0.86;

  function hypot(a, b) {
    return Math.sqrt(a * a + b * b);
  }

  function insidePad(x, y) {
    return (x * x) / (OVAL_X * OVAL_X) + (y * y) / (OVAL_Y * OVAL_Y) < 0.96;
  }

  function fieldAt(x, y, prev) {
    var ac = Math.atan2(y - CORE_Y, x - CORE_X);
    var ad = Math.atan2(y - DELTA_Y, x - DELTA_X);
    var th = 0.5 * (ac - ad);
    var fx = Math.cos(th);
    var fy = Math.sin(th);
    var r2 = x * x + y * y + 0.05;
    var cxv = -y / r2;
    var cyv = x / r2;
    var n = hypot(cxv, cyv) || 1;
    cxv /= n;
    cyv /= n;
    var edge = hypot(x / OVAL_X, y / OVAL_Y);
    var mixC = 0.4 * Math.max(0, edge - 0.42);
    fx = fx * (1 - mixC) + cxv * mixC;
    fy = fy * (1 - mixC) + cyv * mixC;
    n = hypot(fx, fy) || 1;
    fx /= n;
    fy /= n;
    if (prev && fx * prev[0] + fy * prev[1] < 0) {
      fx = -fx;
      fy = -fy;
    }
    return [fx, fy];
  }

  function walkRidge(x0, y0, direction) {
    var pts = [];
    var x = x0;
    var y = y0;
    var prev = null;
    var i;
    var step = 0.016;
    for (i = 0; i < 110; i++) {
      if (!insidePad(x, y)) break;
      var f = fieldAt(x, y, prev);
      x += f[0] * step * direction;
      y += f[1] * step * direction;
      prev = [f[0] * direction, f[1] * direction];
      pts.push([x, y]);
    }
    return pts;
  }

  function ridgeCurvature(pts) {
    if (pts.length < 8) return 0;
    var ang = 0;
    var i;
    for (i = 2; i < pts.length - 2; i += 2) {
      var v1x = pts[i][0] - pts[i - 2][0];
      var v1y = pts[i][1] - pts[i - 2][1];
      var v2x = pts[i + 2][0] - pts[i][0];
      var v2y = pts[i + 2][1] - pts[i][1];
      var n1 = hypot(v1x, v1y) || 1;
      var n2 = hypot(v2x, v2y) || 1;
      var dot = (v1x * v2x + v1y * v2y) / (n1 * n2);
      if (dot > 1) dot = 1;
      if (dot < -1) dot = -1;
      ang += Math.acos(dot);
    }
    return ang;
  }

  function buildRidges() {
    var list = [];
    var occupied = [];
    var minD = 0.047;
    var minD2 = minD * minD;

    function tooClose(x, y) {
      var k;
      for (k = 0; k < occupied.length; k++) {
        var dx = occupied[k][0] - x;
        var dy = occupied[k][1] - y;
        if (dx * dx + dy * dy < minD2) return true;
      }
      return false;
    }

    var i;
    var j;
    for (i = -12; i <= 12; i++) {
      for (j = -15; j <= 15; j++) {
        var x0 = i * 0.06;
        var y0 = j * 0.06;
        if (!insidePad(x0, y0)) continue;
        if (hypot(x0 / OVAL_X, y0 / OVAL_Y) > 0.92) continue;
        if (hypot(x0 - CORE_X, y0 - CORE_Y) < 0.07) continue;
        if (tooClose(x0, y0)) continue;
        var back = walkRidge(x0, y0, -1);
        var fwd = walkRidge(x0, y0, 1);
        var pts = back.reverse().concat([[x0, y0]]).concat(fwd);
        if (pts.length > 10) {
          pts = pts.slice(3, pts.length - 3);
        }
        if (pts.length < 18) continue;
        if (ridgeCurvature(pts) < 0.55) continue;
        list.push({
          points: pts,
          ring: hypot(x0, y0) / 0.9
        });
        var p;
        for (p = 0; p < pts.length; p += 3) {
          occupied.push(pts[p]);
        }
      }
    }
    return list;
  }

  function ensureRidges() {
    if (!ridges) ridges = buildRidges();
    return ridges;
  }

  function drawPrint(target, width, height, visual, theme) {
    var ctx = target.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    var cx = width / 2;
    var cy = height / 2 + height * 0.01;
    var scale = Math.min(width, height) * 0.46;
    var wear = visual.wear;
    var callus = visual.callus;
    var dark = theme === "dark";
    var ridgeColor = dark ? RIDGE_DARK : RIDGE;
    var callusColor = dark ? CALLUS_DARK : CALLUS;
    var list = ensureRidges();
    var i;
    var j;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy + scale * 0.02, scale * 0.96, scale * 1.12, 0, 0, Math.PI * 2);
    ctx.clip();

    if (callus > 0.06) {
      ctx.beginPath();
      ctx.ellipse(cx, cy + scale * 0.04, scale * 0.86, scale * 1.02, 0, 0, Math.PI * 2);
      ctx.fillStyle = mix(dark ? "#0b0b0c" : "#f4efe6", callusColor, 0.1 + callus * 0.28);
      ctx.fill();
    }

    for (i = 0; i < list.length; i++) {
      var ridge = list[i];
      var pts = ridge.points;
      var ring = ridge.ring;
      var outer = Math.pow(clamp(ring, 0, 1), 1.35);
      var wearBand = Math.exp(-Math.pow((ring - 0.42) / 0.26, 2));
      var wearAmt = wear * wearBand;
      var callusAmt = callus * outer;
      var widthPx = (1.45 + callusAmt * 2.6 + (1 - ring) * 0.12) * (scale / 145);
      var color = mix(ridgeColor, callusColor, callusAmt * 0.88);
      if (wearAmt > 0.1) {
        color = mix(color, WEAR, wearAmt * 0.7);
      }

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.92 - wearAmt * 0.38;
      ctx.lineWidth = widthPx;

      ctx.beginPath();
      var drawing = false;
      var chunk = 9;
      for (j = 0; j < pts.length; j++) {
        var chunkId = Math.floor(j / chunk);
        var skip = wearAmt > 0.05 && hash(i * 17.3 + chunkId * 9.1 + ring * 13) < wearAmt * 0.48;
        var px = cx + pts[j][0] * scale;
        var py = cy + pts[j][1] * scale;
        if (skip) {
          drawing = false;
          continue;
        }
        if (!drawing) {
          ctx.moveTo(px, py);
          drawing = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function canvasSize() {
    var rect = printHit.getBoundingClientRect();
    var size = Math.min(rect.width, rect.height);
    if (size < 8) size = 280;
    var dpr = window.devicePixelRatio || 1;
    if (dpr > 2) dpr = 2;
    return { css: size, dpr: dpr, px: Math.round(size * dpr) };
  }

  function paintMain() {
    var now = Date.now();
    applyRecovery(now);
    var visual = currentVisual(now);
    var dim = canvasSize();
    if (canvas.width !== dim.px || canvas.height !== dim.px) {
      canvas.width = dim.px;
      canvas.height = dim.px;
    }
    var theme = app.classList.contains("is-dark") ? "dark" : "light";
    drawPrint(canvas, dim.px, dim.px, visual, theme);
  }

  function setAppHeight() {
    var h = window.innerHeight;
    document.documentElement.style.setProperty("--app-height", h + "px");
  }

  function formatTime(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    function pad(n) {
      return n < 10 ? "0" + n : String(n);
    }
    return pad(h) + ":" + pad(m) + ":" + pad(s);
  }

  function setMode(next) {
    mode = next;
    app.classList.toggle("is-dark", next === "practice" || next === "ended");
    app.classList.toggle("is-practice", next === "practice");
    app.classList.toggle("is-session", next === "practice" || next === "ended");
    statusBox.hidden = next === "home";
    closeBtn.hidden = next !== "practice";
    doneBtn.hidden = next !== "ended";
    if (next === "practice") {
      statusLabel.textContent = "练习中";
    } else if (next === "ended") {
      statusLabel.textContent = "练习结束";
    }
    if (next === "home") {
      hint.textContent = state.snaps.length
        ? "长按指纹，开始下一次练习"
        : "长按指纹，开始练习";
    }
    paintMain();
  }

  function startTimerClock() {
    stopTimerClock();
    tickTimer();
    timerClock = window.setInterval(tickTimer, 250);
  }

  function startPractice() {
    state.session = { startAt: Date.now() };
    saveState();
    setMode("practice");
    startTimerClock();
  }

  function tickTimer() {
    if (!state.session) return;
    timerEl.textContent = formatTime(Date.now() - state.session.startAt);
    if (mode === "practice") {
      paintMain();
    }
  }

  function stopTimerClock() {
    if (timerClock) {
      window.clearInterval(timerClock);
      timerClock = 0;
    }
  }

  function finishPractice(opts) {
    opts = opts || {};
    if (!state.session) {
      setMode("home");
      return;
    }
    var now = Date.now();
    var duration = Math.max(0, now - state.session.startAt);
    stopTimerClock();
    timerEl.textContent = formatTime(duration);

    if (duration >= MIN_SESSION_MS) {
      state.wear = clamp(state.wear + sessionWear(capMs(duration) / 60000, state.totalMs), 0, 1);
      state.totalMs += duration;
      state.callus = callusFromTotal(state.totalMs);
      pushSnap(state.wear, state.callus);
    }

    state.session = null;
    state.lastEndAt = now;
    saveState();

    if (opts.silent) {
      setMode("home");
      return;
    }
    setMode("ended");
  }

  function cancelHold() {
    holding = false;
    app.classList.remove("is-holding");
    printHit.classList.remove("is-holding");
    if (holdTimer) {
      window.clearTimeout(holdTimer);
      holdTimer = null;
    }
    if (holdRaf) {
      window.cancelAnimationFrame(holdRaf);
      holdRaf = 0;
    }
    glow.style.transform = "";
    glow.style.opacity = "";
  }

  function setHoldVisual(p) {
    var s = 0.2 + p * 0.8;
    glow.style.transform = "scale(" + s + ")";
    glow.style.opacity = String(0.25 + p * 0.7);
  }

  function onHoldComplete() {
    holdTimer = null;
    cancelHold();
    if (mode === "home") startPractice();
    else if (mode === "practice") finishPractice();
  }

  function beginHold(ev) {
    if (mode === "ended") return;
    if (infoModal.classList.contains("is-open") || sheet.classList.contains("is-open")) return;
    if (ev && ev.pointerType === "mouse" && ev.button !== 0) return;
    holding = true;
    holdStart = Date.now();
    app.classList.add("is-holding");
    printHit.classList.add("is-holding");
    setHoldVisual(0);
    holdTimer = window.setTimeout(onHoldComplete, HOLD_MS);

    function step() {
      if (!holding) return;
      var p = clamp((Date.now() - holdStart) / HOLD_MS, 0, 1);
      setHoldVisual(p);
      if (p < 1) holdRaf = window.requestAnimationFrame(step);
    }
    if (!reduceMotion) holdRaf = window.requestAnimationFrame(step);
  }

  function paintMini(visual, size) {
    var node = document.createElement("canvas");
    var dpr = window.devicePixelRatio || 1;
    if (dpr > 2) dpr = 2;
    node.width = size * dpr;
    node.height = size * dpr;
    node.style.width = size + "px";
    node.style.height = size + "px";
    drawPrint(node, node.width, node.height, visual, "light");
    return node;
  }

  function openSheet() {
    if (mode !== "home") return;
    snapRow.innerHTML = "";
    if (!state.snaps.length) {
      var empty = document.createElement("p");
      empty.className = "snap-empty";
      empty.textContent = "练习结束之后，痕迹会留在这里。";
      snapRow.appendChild(empty);
    } else {
      var i;
      for (i = 0; i < state.snaps.length; i++) {
        var card = document.createElement("div");
        card.className = "snap-card";
        card.appendChild(paintMini(state.snaps[i], 88));
        snapRow.appendChild(card);
      }
    }
    sheet.hidden = false;
    sheet.classList.add("is-open");
  }

  function closeSheet() {
    sheet.hidden = true;
    sheet.classList.remove("is-open");
  }

  function openInfo() {
    if (mode !== "home") return;
    if (!guideRow.childNodes.length) {
      var steps = [
        { label: "初始", wear: 0, callus: 0 },
        { label: "新手练后", wear: 0.42, callus: 0.08 },
        { label: "休息后", wear: 0.06, callus: 0.08 },
        { label: "累计变茧", wear: 0.04, callus: 0.4 },
        { label: "熟手再练", wear: 0.18, callus: 0.55 },
        { label: "老茧", wear: 0.04, callus: 0.88 }
      ];
      var i;
      for (i = 0; i < steps.length; i++) {
        var card = document.createElement("div");
        card.className = "guide-card";
        card.appendChild(paintMini(steps[i], 72));
        var lab = document.createElement("p");
        lab.className = "guide-label";
        lab.textContent = steps[i].label;
        card.appendChild(lab);
        guideRow.appendChild(card);
      }
    }
    infoModal.hidden = false;
    infoModal.classList.add("is-open");
    infoModal.classList.add("is-center");
  }

  function closeInfo() {
    infoModal.hidden = true;
    infoModal.classList.remove("is-open");
  }

  function onPointerDown(ev) {
    if (printHit.contains(ev.target)) {
      if (ev.preventDefault) ev.preventDefault();
      beginHold(ev);
    }
  }

  function onPointerUp() {
    if (holding) cancelHold();
  }

  function onVisibility() {
    if (document.hidden) {
      if (state.session) saveState();
      return;
    }
    if (state.session && state.session.startAt) {
      setMode("practice");
      startTimerClock();
      return;
    }
    applyRecovery(Date.now());
    paintMain();
  }

  function onPageHide(ev) {
    if (!state.session) return;
    if (ev && ev.persisted) {
      saveState();
      return;
    }
    finishPractice({ silent: true });
  }

  function onPageShow(ev) {
    if (ev && ev.persisted && state.session && state.session.startAt) {
      setMode("practice");
      startTimerClock();
    }
  }

  function bind() {
    printHit.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
    printHit.addEventListener("contextmenu", function (ev) {
      ev.preventDefault();
    });

    closeBtn.addEventListener("click", function () {
      finishPractice();
    });
    doneBtn.addEventListener("click", function () {
      setMode("home");
    });
    infoBtn.addEventListener("click", openInfo);
    infoClose.addEventListener("click", closeInfo);
    infoModal.addEventListener("click", function (ev) {
      if (ev.target === infoModal) closeInfo();
    });
    sheetHandle.addEventListener("click", openSheet);
    sheetClose.addEventListener("click", closeSheet);
    sheet.addEventListener("click", function (ev) {
      if (ev.target === sheet) closeSheet();
    });

    var swipeY = null;
    document.addEventListener("touchstart", function (ev) {
      if (mode !== "home" || !ev.touches || !ev.touches.length) return;
      swipeY = ev.touches[0].clientY;
    }, { passive: true });
    document.addEventListener("touchend", function (ev) {
      if (swipeY == null || !ev.changedTouches || !ev.changedTouches.length) {
        swipeY = null;
        return;
      }
      var dy = ev.changedTouches[0].clientY - swipeY;
      swipeY = null;
      if (dy < -56 && !sheet.classList.contains("is-open")) openSheet();
      if (dy > 56 && sheet.classList.contains("is-open")) closeSheet();
    }, { passive: true });

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("resize", function () {
      setAppHeight();
      paintMain();
    });
  }

  function resumeOpenSession() {
    if (state.session && state.session.startAt) {
      setMode("practice");
      startTimerClock();
      return true;
    }
    return false;
  }

  function init() {
    setAppHeight();
    bind();
    if (resumeOpenSession()) {
      saveState();
    } else {
      applyRecovery(Date.now());
      saveState();
      setMode("home");
    }
    window.setInterval(function () {
      if (mode === "home") {
        applyRecovery(Date.now());
        paintMain();
      }
    }, 60000);
  }

  init();
})();
