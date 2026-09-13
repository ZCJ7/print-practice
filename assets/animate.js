(function () {
  "use strict";

  var canvas = document.getElementById("animCanvas");
  var phaseEl = document.getElementById("phase");
  var clockEl = document.getElementById("clock");
  var subEl = document.getElementById("sub");
  var barEl = document.getElementById("bar");
  var api = window.PrintDraw;
  if (!api) return;

  var LOOP = 16000;

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function sample(progress) {
    var p = progress;
    if (p < 0.3) {
      var u = p / 0.3;
      var minutes = u * 40;
      return {
        wear: api.sessionWear(minutes, 0),
        callus: api.callusFromTotal(minutes * 60000),
        phase: "新手一次练习",
        clock: "00:" + pad(Math.round(minutes)),
        sub: "累计还少，这次磨得比较明显",
        bar: u
      };
    }
    if (p < 0.36) {
      return {
        wear: api.sessionWear(40, 0),
        callus: api.callusFromTotal(40 * 60000),
        phase: "练习结束",
        clock: "00:40",
        sub: "单次最多记 2 小时，茧按累计时长",
        bar: 1
      };
    }
    if (p < 0.66) {
      var r = (p - 0.36) / 0.3;
      var after = 40 * 60000;
      var startWear = api.sessionWear(40, 0);
      var need = api.recoverHours(after);
      var hours = r * need;
      return {
        wear: api.clamp(startWear - hours / need, 0, 1),
        callus: api.callusFromTotal(after),
        phase: "休息恢复",
        clock: Math.round(hours) + " / " + Math.round(need) + " 小时",
        sub: "累计越长，退完磨损所需时间越短",
        bar: r
      };
    }
    var c = (p - 0.66) / 0.34;
    var totalHours = 0.7 + c * 19.3;
    return {
      wear: 0,
      callus: api.callusFromTotal(totalHours * 3600000),
      phase: "茧层随累计变厚",
      clock: totalHours.toFixed(1) + " 小时",
      sub: "不看次数，只看一共练了多久",
      bar: c
    };
  }

  function paint(now) {
    var visual = sample((now % LOOP) / LOOP);
    api.drawPrint(canvas, canvas.width, canvas.height, visual);
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
