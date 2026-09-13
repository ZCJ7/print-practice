# -*- coding: utf-8 -*-
"""Render a looping GIF with the same Print fingerprint growth rules."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "examples" / "print-morph.gif"
W, H = 440, 560
PRINT = 400
RIDGE = (74, 71, 66)
WEAR = (196, 180, 154)
CALLUS = (179, 148, 114)
BG = (244, 239, 230)
CARD = (255, 253, 248)
CORE = (-0.02, -0.14)
DELTA = (0.26, 0.24)
OVAL = (0.58, 0.86)


def clamp(n, a, b):
    return max(a, min(b, n))


def mix(a, b, t):
    t = clamp(t, 0, 1)
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def hypot(a, b):
    return math.sqrt(a * a + b * b)


def hash01(n):
    x = math.sin(n * 127.1 + 311.7) * 43758.5453
    return x - math.floor(x)


WEAR_MAX = 0.72
WEAR_TAU_MIN = 28
EXP_HOURS = 8
RECOVER_DAYS_BASE = 5
RECOVER_DAYS_MIN = 0.5
CALLUS_TAU_H = 10


def wear_scale(total_ms):
    return 1 / (1 + (total_ms / 3600000) / EXP_HOURS)


def recover_days(total_ms):
    return max(RECOVER_DAYS_MIN, RECOVER_DAYS_BASE * wear_scale(total_ms))


def session_wear(minutes, total_ms=0):
    minutes = clamp(minutes, 0, 120)
    if minutes <= 0:
        return 0.0
    raw = WEAR_MAX * (1 - math.exp(-minutes / WEAR_TAU_MIN))
    return raw * wear_scale(total_ms)


def callus_from_total(total_ms):
    return clamp(1 - math.exp(-(total_ms / 3600000) / CALLUS_TAU_H), 0, 1)


def inside_pad(x, y):
    return (x * x) / (OVAL[0] ** 2) + (y * y) / (OVAL[1] ** 2) < 0.96


def field_at(x, y, prev):
    ac = math.atan2(y - CORE[1], x - CORE[0])
    ad = math.atan2(y - DELTA[1], x - DELTA[0])
    th = 0.5 * (ac - ad)
    fx, fy = math.cos(th), math.sin(th)
    r2 = x * x + y * y + 0.05
    cxv, cyv = -y / r2, x / r2
    n = hypot(cxv, cyv) or 1
    cxv, cyv = cxv / n, cyv / n
    edge = hypot(x / OVAL[0], y / OVAL[1])
    mix_c = 0.4 * max(0, edge - 0.42)
    fx = fx * (1 - mix_c) + cxv * mix_c
    fy = fy * (1 - mix_c) + cyv * mix_c
    n = hypot(fx, fy) or 1
    fx, fy = fx / n, fy / n
    if prev is not None and fx * prev[0] + fy * prev[1] < 0:
        fx, fy = -fx, -fy
    return fx, fy


def walk_ridge(x0, y0, direction):
    pts = []
    x, y, prev = x0, y0, None
    for _ in range(110):
        if not inside_pad(x, y):
            break
        fx, fy = field_at(x, y, prev)
        x += fx * 0.016 * direction
        y += fy * 0.016 * direction
        prev = (fx * direction, fy * direction)
        pts.append((x, y))
    return pts


def curvature(pts):
    if len(pts) < 8:
        return 0
    ang = 0.0
    for i in range(2, len(pts) - 2, 2):
        v1 = (pts[i][0] - pts[i - 2][0], pts[i][1] - pts[i - 2][1])
        v2 = (pts[i + 2][0] - pts[i][0], pts[i + 2][1] - pts[i][1])
        n1 = hypot(*v1) or 1
        n2 = hypot(*v2) or 1
        dot = clamp((v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2), -1, 1)
        ang += abs(math.acos(dot))
    return ang


def build_ridges():
    occupied = []
    lines = []
    min_d2 = 0.047 * 0.047

    def too_close(x, y):
        for ox, oy in occupied:
            if (ox - x) ** 2 + (oy - y) ** 2 < min_d2:
                return True
        return False

    for i in range(-12, 13):
        for j in range(-15, 16):
            x0, y0 = i * 0.06, j * 0.06
            if not inside_pad(x0, y0):
                continue
            if hypot(x0 / OVAL[0], y0 / OVAL[1]) > 0.92:
                continue
            if hypot(x0 - CORE[0], y0 - CORE[1]) < 0.07:
                continue
            if too_close(x0, y0):
                continue
            back = walk_ridge(x0, y0, -1)
            fwd = walk_ridge(x0, y0, 1)
            pts = list(reversed(back)) + [(x0, y0)] + fwd
            if len(pts) > 10:
                pts = pts[3:-3]
            if len(pts) < 18 or curvature(pts) < 0.55:
                continue
            lines.append((pts, hypot(x0, y0) / 0.9))
            occupied.extend(pts[::3])
    return lines


RIDGES = build_ridges()


def draw_print(wear, callus):
    img = Image.new("RGB", (PRINT, PRINT), CARD)
    px = ImageDraw.Draw(img)
    cx = cy = PRINT / 2
    scale = PRINT * 0.46
    if callus > 0.06:
        t = 0.1 + callus * 0.28
        color = mix(BG, CALLUS, t)
        rx = scale * 0.86
        ry = scale * 1.02
        px.ellipse(
            [cx - rx, cy + scale * 0.04 - ry, cx + rx, cy + scale * 0.04 + ry],
            fill=color,
        )
    for i, (pts, ring) in enumerate(RIDGES):
        outer = clamp(ring, 0, 1) ** 1.35
        wear_band = math.exp(-(((ring - 0.42) / 0.26) ** 2))
        wear_amt = wear * wear_band
        callus_amt = callus * outer
        width = max(1, int(round((1.45 + callus_amt * 2.6 + (1 - ring) * 0.12) * (scale / 145))))
        color = mix(RIDGE, CALLUS, callus_amt * 0.88)
        if wear_amt > 0.1:
            color = mix(color, WEAR, wear_amt * 0.7)
        alpha = 0.92 - wear_amt * 0.38
        color = mix(CARD, color, alpha)
        seg = []
        for j, (x, y) in enumerate(pts):
            skip = wear_amt > 0.05 and hash01(i * 17.3 + (j // 9) * 9.1 + ring * 13) < wear_amt * 0.48
            if skip:
                if len(seg) > 1:
                    px.line(seg, fill=color, width=width)
                seg = []
                continue
            seg.append((cx + x * scale, cy + y * scale))
        if len(seg) > 1:
            px.line(seg, fill=color, width=width)
    return img


def sample(p):
    if p < 0.3:
        u = p / 0.3
        minutes = u * 40
        return (
            session_wear(minutes, 0),
            callus_from_total(minutes * 60000),
            "新手一次练习",
            "00:%02d" % round(minutes),
            "累计还少，这次磨得比较明显",
        )
    if p < 0.36:
        return (
            session_wear(40, 0),
            callus_from_total(40 * 60000),
            "练习结束",
            "00:40",
            "单次最多记 2 小时，茧按累计时长",
        )
    if p < 0.66:
        r = (p - 0.36) / 0.3
        after = 40 * 60000
        start = session_wear(40, 0)
        need = recover_days(after)
        days = r * need
        return (
            clamp(start - days / need, 0, 1),
            callus_from_total(after),
            "休息恢复",
            "%.1f / %.1f 天" % (days, need),
            "按天恢复：新手约 5 天，老手至少半天",
        )
    c = (p - 0.66) / 0.34
    total_hours = 0.7 + c * 19.3
    return (
        0.0,
        callus_from_total(total_hours * 3600000),
        "茧层随累计变厚",
        "%.1f 小时" % total_hours,
        "不看次数，只看一共练了多久",
    )


def font(size):
    for path in (
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\msyhbd.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def compose(p):
    wear, callus, phase, clock, sub = sample(p)
    frame = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(frame)
    print_img = draw_print(wear, callus)
    x = (W - PRINT) // 2
    frame.paste(print_img, (x, 18))
    title_f, clock_f, sub_f = font(18), font(30), font(14)
    def center(text, y, f, fill=(47, 44, 40)):
        box = draw.textbbox((0, 0), text, font=f)
        draw.text(((W - (box[2] - box[0])) / 2, y), text, font=f, fill=fill)
    center(phase, 430, title_f)
    center(clock, 458, clock_f)
    center(sub, 504, sub_f, fill=(138, 131, 120))
    return frame


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames = [compose(i / 55).quantize(method=Image.FASTOCTREE) for i in range(56)]
    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=120,
        loop=0,
        optimize=True,
    )
    print("wrote", OUT, OUT.stat().st_size)


if __name__ == "__main__":
    main()
