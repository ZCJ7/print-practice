(function () {
  "use strict";

  var canvas = document.getElementById("animCanvas");
  var phaseEl = document.getElementById("phase");
  var clockEl = document.getElementById("clock");
  var subEl = document.getElementById("sub");
  var barEl = document.getElementById("bar");
  var draw = window.PrintDraw && window.PrintDraw.drawPrint;
  var wearFn = window.PrintDraw && window.PrintDraw.sessionWear;
  var callusFn = window.PrintDraw && window.PrintDraw.sessionCallus;
  var clamp = window.PrintDraw && window.PrintDraw.clamp;

  if (!draw) return;

  var LOOP = 14000;

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function sample(progress) {
    var p = progress;
    if (p < 0.32) {
      var u = p / 0.32;
      var minutes = u * 12;
      return {
        wear: wearFn(minutes),
        callus: callusFn(minutes),
        phase: "一次练习",
        clock: "00:" + pad(Math.round(minutes)),
        sub: "磨损和初茧一起长出来",
        bar: u
      };
    }
    if (p < 0.38) {
      return {
        wear: wearFn(12),
        callus: callusFn(12),
        phase: "练习结束",
        clock: "00:12",
        sub: "单次磨损到顶，开始进入休息",
        bar: 1
      };
    }
    if (p < 0.72) {
      var r = (p - 0.38) / 0.34;
      var hours = r * 16;
      var startWear = wearFn(12);
      return {
        wear: clamp(startWear - hours / 16, 0, 1),
        callus: callusFn(12),
        phase: "休息恢复",
        clock: Math.round(hours) + " 小时",
        sub: "磨损按真实时间消退，茧还在",
        bar: r
      };
    }
    if (p < 0.78) {
      return {
        wear: 0,
        callus: callusFn(12),
        phase: "休息 16 小时",
        clock: "16 小时",
        sub: "磨损退完，只留下一层茧",
        bar: 1
      };
    }
    var c = (p - 0.78) / 0.22;
    var times = 1 + c * 7;
    return {
      wear: 0,
      callus: clamp(callusFn(12) * times, 0, 1),
      phase: "多次练习",
      clock: "第 " + Math.max(1, Math.round(times)) + " 次",
      sub: "每次都休息够，茧层越来越厚",
      bar: c
    };
  }

  function paint(now) {
    var visual = sample((now % LOOP) / LOOP);
    draw(canvas, canvas.width, canvas.height, visual);
    phaseEl.textContent = visual.phase;
    clockEl.textContent = visual.clock;
    subEl.textContent = visual.sub;
    barEl.style.width = Math.round(visual.bar * 100) + "%";
  }

  var start = Date.now();
  function tick() {
    paint(Date.now() - start);
    window.requestAnimationFrame(tick);
  }
  tick();
})();
