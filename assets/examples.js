(function () {
  "use strict";

  var RIDGE = "#4a4742";
  var WEAR = "#c4b49a";
  var CALLUS = "#b39472";
  var CORE_X = -0.02;
  var CORE_Y = -0.14;
  var DELTA_X = 0.26;
  var DELTA_Y = 0.24;
  var OVAL_X = 0.58;
  var OVAL_Y = 0.86;
  var ridges = null;

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
    var minD2 = 0.047 * 0.047;

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
        if (pts.length > 10) pts = pts.slice(3, pts.length - 3);
        if (pts.length < 18) continue;
        if (ridgeCurvature(pts) < 0.55) continue;
        list.push({ points: pts, ring: hypot(x0, y0) / 0.9 });
        var p;
        for (p = 0; p < pts.length; p += 3) occupied.push(pts[p]);
      }
    }
    return list;
  }

  function sessionWear(minutes) {
    if (minutes <= 0) return 0;
    return clamp(0.08 + minutes * 0.045, 0, 0.62);
  }

  function sessionCallus(minutes) {
    if (minutes <= 0) return 0;
    return clamp(minutes * 0.014, 0, 0.12);
  }

  function drawPrint(target, width, height, visual) {
    var ctx = target.getContext("2d");
    if (!ctx) return;
    if (!ridges) ridges = buildRidges();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f4efe6";
    ctx.fillRect(0, 0, width, height);

    var cx = width / 2;
    var cy = height / 2 + height * 0.01;
    var scale = Math.min(width, height) * 0.46;
    var wear = visual.wear;
    var callus = visual.callus;
    var i;
    var j;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy + scale * 0.02, scale * 0.96, scale * 1.12, 0, 0, Math.PI * 2);
    ctx.clip();

    if (callus > 0.06) {
      ctx.beginPath();
      ctx.ellipse(cx, cy + scale * 0.04, scale * 0.86, scale * 1.02, 0, 0, Math.PI * 2);
      ctx.fillStyle = mix("#f4efe6", CALLUS, 0.1 + callus * 0.28);
      ctx.fill();
    }

    for (i = 0; i < ridges.length; i++) {
      var ridge = ridges[i];
      var pts = ridge.points;
      var ring = ridge.ring;
      var outer = Math.pow(clamp(ring, 0, 1), 1.35);
      var wearBand = Math.exp(-Math.pow((ring - 0.42) / 0.26, 2));
      var wearAmt = wear * wearBand;
      var callusAmt = callus * outer;
      var widthPx = (1.45 + callusAmt * 2.6 + (1 - ring) * 0.12) * (scale / 145);
      var color = mix(RIDGE, CALLUS, callusAmt * 0.88);
      if (wearAmt > 0.1) color = mix(color, WEAR, wearAmt * 0.7);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.92 - wearAmt * 0.38;
      ctx.lineWidth = widthPx;
      ctx.beginPath();
      var drawing = false;
      for (j = 0; j < pts.length; j++) {
        var skip = wearAmt > 0.05 && hash(i * 17.3 + Math.floor(j / 9) * 9.1 + ring * 13) < wearAmt * 0.48;
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

  function paintCard(canvas, visual) {
    var dpr = window.devicePixelRatio || 1;
    if (dpr > 2) dpr = 2;
    var css = 180;
    canvas.style.width = css + "px";
    canvas.style.height = css + "px";
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(css * dpr);
    drawPrint(canvas, canvas.width, canvas.height, visual);
  }

  var sections = [
    {
      title: "一次练习，不同时长",
      note: "都是刚结束、还没休息。单次磨损大约 12 分钟封顶，茧层大约 9 分钟封顶，再练更久外观几乎不再变，要靠多次练习长茧。",
      items: [
        { label: "未练习", sub: "初始", minutes: 0, rest: 0, times: 1 },
        { label: "3 分钟", sub: "轻磨损", minutes: 3, rest: 0, times: 1 },
        { label: "6 分钟", sub: "明显磨损", minutes: 6, rest: 0, times: 1 },
        { label: "10 分钟", sub: "接近单次上限", minutes: 10, rest: 0, times: 1 },
        { label: "20 分钟", sub: "与 10 分钟几乎同形", minutes: 20, rest: 0, times: 1 }
      ]
    },
    {
      title: "练完 10 分钟后，不同间隔",
      note: "磨损大约 16 小时消退完；茧层不会因休息消失，只会留下一层更暖、更粗的外围。",
      items: [
        { label: "刚结束", sub: "间隔 0 小时", minutes: 10, rest: 0, times: 1 },
        { label: "休息 4 小时", sub: "磨损回一半", minutes: 10, rest: 4, times: 1 },
        { label: "休息 8 小时", sub: "磨损将尽", minutes: 10, rest: 8, times: 1 },
        { label: "休息 16 小时", sub: "磨损消失，茧还在", minutes: 10, rest: 16, times: 1 },
        { label: "休息 24 小时", sub: "与 16 小时相同", minutes: 10, rest: 24, times: 1 }
      ]
    },
    {
      title: "多次练习后的茧层",
      note: "每次练 10 分钟，并且中间都休息满 16 小时。磨损已恢复，只看长期茧层。",
      items: [
        { label: "1 次", sub: "初茧", minutes: 10, rest: 16, times: 1 },
        { label: "3 次", sub: "茧层可见", minutes: 10, rest: 16, times: 3 },
        { label: "5 次", sub: "厚茧", minutes: 10, rest: 16, times: 5 },
        { label: "8 次", sub: "稳定老茧", minutes: 10, rest: 16, times: 8 }
      ]
    }
  ];

  function visualOf(item) {
    var wear = 0;
    var callus = 0;
    var t;
    for (t = 0; t < item.times; t++) {
      wear = clamp(wear + sessionWear(item.minutes), 0, 1);
      callus = clamp(callus + sessionCallus(item.minutes), 0, 1);
      if (t < item.times - 1) {
        wear = clamp(wear - 16 / 16, 0, 1);
      } else {
        wear = clamp(wear - item.rest / 16, 0, 1);
      }
    }
    return { wear: wear, callus: callus };
  }

  function render() {
    var root = document.getElementById("gallery");
    var s;
    for (s = 0; s < sections.length; s++) {
      var sec = sections[s];
      var wrap = document.createElement("section");
      wrap.className = "section";
      var h = document.createElement("h2");
      h.textContent = sec.title;
      var p = document.createElement("p");
      p.className = "note";
      p.textContent = sec.note;
      var row = document.createElement("div");
      row.className = "row";
      wrap.appendChild(h);
      wrap.appendChild(p);
      wrap.appendChild(row);

      var i;
      for (i = 0; i < sec.items.length; i++) {
        var item = sec.items[i];
        var card = document.createElement("div");
        card.className = "card";
        var canvas = document.createElement("canvas");
        var title = document.createElement("strong");
        title.textContent = item.label;
        var sub = document.createElement("span");
        sub.textContent = item.sub;
        card.appendChild(canvas);
        card.appendChild(title);
        card.appendChild(sub);
        row.appendChild(card);
        paintCard(canvas, visualOf(item));
      }
      root.appendChild(wrap);
    }
  }

  render();
})();
