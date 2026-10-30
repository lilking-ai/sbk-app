"""Storm Breakers [SBK] esports-style emblem, v2."""
import math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

S = 2048  # supersample, downscale at end
import os
FONT = os.environ.get("SBK_FONT", "build/Poppins-Bold.ttf")
random.seed(3)


def vgrad(w, h, stops):
    """Vertical gradient image from list of (pos, (r,g,b))."""
    img = Image.new("RGB", (1, h))
    px = img.load()
    for y in range(h):
        t = y / (h - 1)
        for i in range(len(stops) - 1):
            p0, c0 = stops[i]
            p1, c1 = stops[i + 1]
            if p0 <= t <= p1:
                k = (t - p0) / (p1 - p0)
                px[0, y] = tuple(int(c0[j] + (c1[j] - c0[j]) * k) for j in range(3))
                break
    return img.resize((w, h))


def radial(w, h, cx, cy, r, inner, outer):
    small = Image.new("RGB", (w // 8, h // 8))
    px = small.load()
    for y in range(small.size[1]):
        for x in range(small.size[0]):
            d = min(1, math.hypot(x * 8 - cx, y * 8 - cy) / r)
            px[x, y] = tuple(int(inner[j] + (outer[j] - inner[j]) * d ** 1.2) for j in range(3))
    return small.resize((w, h), Image.BICUBIC)


def mask_poly(pts, size=(S, S), blur=0):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return m.filter(ImageFilter.GaussianBlur(blur)) if blur else m


def shield(cx, cy, w, h):
    # flat-top esports shield with notched shoulders and pointed bottom
    hw = w / 2
    return [
        (cx - hw * 0.70, cy - h * 0.50),
        (cx, cy - h * 0.545),
        (cx + hw * 0.70, cy - h * 0.50),
        (cx + hw, cy - h * 0.34),
        (cx + hw * 0.94, cy + h * 0.10),
        (cx + hw * 0.62, cy + h * 0.33),
        (cx, cy + h * 0.50),
        (cx - hw * 0.62, cy + h * 0.33),
        (cx - hw * 0.94, cy + h * 0.10),
        (cx - hw, cy - h * 0.34),
    ]


def scale_pts(pts, cx, cy, k):
    return [(cx + (x - cx) * k, cy + (y - cy) * k) for x, y in pts]


def bolt(cx, cy, s, tilt=0.0):
    pts = [(0.18, -1.00), (-0.50, 0.10), (-0.02, 0.10), (-0.26, 1.00),
           (0.52, -0.22), (0.06, -0.22), (0.42, -1.00)]
    c, si = math.cos(tilt), math.sin(tilt)
    return [(cx + (x * c - y * si) * s, cy + (x * si + y * c) * s) for x, y in pts]


def glow_layer(draw_fn, color, blur, size=(S, S)):
    g = Image.new("RGBA", size, (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(g), color)
    return g.filter(ImageFilter.GaussianBlur(blur))


def main():
    cx, cy = S / 2, S * 0.50
    # --- background: deep storm purple/navy radial
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # faint background lightning cracks
    bgl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bgl)
    for sx in (S * 0.12, S * 0.88):
        x, y = sx, 0
        pts = [(x, y)]
        while y < S:
            y += random.randint(80, 160)
            x += random.randint(-110, 110)
            pts.append((x, y))
        bd.line(pts, fill=(120, 150, 255, 90), width=10, joint="curve")
    pass

    sh = shield(cx, cy + 20, S * 0.80, S * 0.86)

    # --- outer glow behind shield
    img.alpha_composite(glow_layer(lambda d, c: d.polygon(sh, fill=c), (90, 140, 255, 200), 70))

    # --- gold outer rim (gradient)
    gold = vgrad(S, S, [(0, (255, 240, 150)), (0.35, (255, 196, 30)), (0.7, (200, 120, 10)), (1, (255, 210, 80))])
    img.paste(gold, (0, 0), mask_poly(sh))

    # dark separator ring
    sh2 = scale_pts(sh, cx, cy + 20, 0.93)
    img.paste((10, 12, 30), (0, 0), mask_poly(sh2))

    # inner shield fill: electric blue -> deep navy
    sh3 = scale_pts(sh, cx, cy + 20, 0.90)
    inner = vgrad(S, S, [(0, (60, 110, 255)), (0.45, (28, 40, 140)), (1, (10, 12, 45))])
    m3 = mask_poly(sh3)
    img.paste(inner, (0, 0), m3)

    # --- storm cloud inside top of shield (clipped)
    cloud = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    cd = ImageDraw.Draw(cloud)
    for (ox, oy, r, col) in [
        (-470, -330, 170, (38, 44, 78)), (420, -350, 190, (38, 44, 78)),
        (-300, -420, 230, (46, 52, 90)), (230, -440, 240, (46, 52, 90)),
        (-60, -510, 290, (56, 62, 104)), (0, -320, 300, (30, 34, 64)),
    ]:
        cd.ellipse((cx + ox - r, cy + oy - r, cx + ox + r, cy + oy + r), fill=col + (255,))
    # cloud highlight
    hl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(hl).ellipse((cx - 300, cy - 780, cx + 200, cy - 500), fill=(170, 185, 240, 120))
    cloud.alpha_composite(hl.filter(ImageFilter.GaussianBlur(40)))
    cloud = cloud.filter(ImageFilter.GaussianBlur(8))
    cloud.putalpha(ImageChops.multiply(cloud.getchannel("A"), m3))
    img.alpha_composite(cloud)

    # --- big lightning bolt with glow
    bp = bolt(cx + 10, cy - 70, 570, tilt=0.10)
    img.alpha_composite(glow_layer(lambda d, c: d.polygon(bp, fill=c), (255, 200, 40, 255), 90))
    img.alpha_composite(glow_layer(lambda d, c: d.polygon(bp, fill=c), (255, 230, 120, 255), 30))
    boltfill = vgrad(S, S, [(0, (255, 250, 200)), (0.4, (255, 220, 40)), (1, (255, 150, 0))])
    img.paste(boltfill, (0, 0), mask_poly(bp))
    # dark outline
    od = ImageDraw.Draw(img)
    od.line(bp + [bp[0]], fill=(40, 20, 0, 255), width=14, joint="curve")
    # white-hot core
    # glint along the leading edges
    gl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(gl).line([bp[0], bp[1]], fill=(255, 255, 255, 230), width=16)
    ImageDraw.Draw(gl).line([bp[2], bp[3]], fill=(255, 255, 255, 200), width=12)
    gl.putalpha(ImageChops.multiply(gl.getchannel("A"), mask_poly(scale_pts(bp, cx, cy, 1.0))))
    img.alpha_composite(gl.filter(ImageFilter.GaussianBlur(3)))

    # sparks
    sp = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    spd = ImageDraw.Draw(sp)
    for sx, dirx in ((cx - 420, -1), (cx + 400, 1), (cx - 200, -1), (cx + 250, 1)):
        x, y = sx, cy - 260
        pts = [(x, y)]
        for _ in range(4):
            x += dirx * random.randint(10, 60); y += random.randint(70, 120)
            pts.append((x, y))
        spd.line(pts, fill=(170, 200, 255, 230), width=9, joint="curve")
    sp.putalpha(ImageChops.multiply(sp.getchannel("A"), m3))
    img.alpha_composite(glow_layer(lambda d,c: None,(0,0,0,0),1)); img.alpha_composite(sp.filter(ImageFilter.GaussianBlur(10))); img.alpha_composite(sp.filter(ImageFilter.GaussianBlur(1.5)))

    # --- ribbon banner across lower part
    by = cy + 360
    bw, bh = S * 0.92, 300
    ribbon = [(cx - bw / 2, by - bh / 2), (cx + bw / 2, by - bh / 2), (cx + bw / 2 - 70, by), (cx + bw / 2, by + bh / 2),
              (cx - bw / 2, by + bh / 2), (cx - bw / 2 + 70, by)]
    img.alpha_composite(glow_layer(lambda d, c: d.polygon(ribbon, fill=c), (0, 0, 0, 220), 30))
    img.paste(gold, (0, 0), mask_poly(ribbon))
    rib_in = [(x, y) for x, y in scale_pts(ribbon, cx, by, 1)]
    inner_rib = [(cx - bw / 2 + 30, by - bh / 2 + 22), (cx + bw / 2 - 30, by - bh / 2 + 22), (cx + bw / 2 - 90, by),
                 (cx + bw / 2 - 30, by + bh / 2 - 22), (cx - bw / 2 + 30, by + bh / 2 - 22), (cx - bw / 2 + 90, by)]
    ribfill = vgrad(S, S, [(0, (30, 36, 90)), (1, (8, 10, 30))])
    img.paste(ribfill, (0, 0), mask_poly(inner_rib))

    # SBK text with gold gradient
    f = ImageFont.truetype(FONT, 290)
    txt = "SBK"
    tm = Image.new("L", (S, S), 0)
    td = ImageDraw.Draw(tm)
    b = td.textbbox((0, 0), txt, font=f)
    tx = cx - (b[2] - b[0]) / 2 - b[0]
    ty = by - (b[3] - b[1]) / 2 - b[1] + 6
    # stroke
    st = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(st).text((tx, ty), txt, font=f, fill=(0, 0, 0, 255), stroke_width=22, stroke_fill=(0, 0, 0, 255))
    img.alpha_composite(st)
    td.text((tx, ty), txt, font=f, fill=255)
    tgrad = vgrad(S, S, [(0, (255, 255, 255)), (0.42, (255, 255, 255)), (0.5, (255, 226, 90)),
                         (0.62, (255, 200, 30)), (1, (255, 160, 0))])
    # vertical gradient positioned around the text
    tgrad = vgrad(S, int(b[3] - b[1] + 40), [(0, (255, 255, 230)), (0.45, (255, 235, 120)), (0.55, (255, 205, 30)), (1, (240, 140, 0))])
    full = Image.new("RGB", (S, S), (255, 200, 30))
    full.paste(tgrad, (0, int(ty + b[1] - 20)))
    img.paste(full, (0, 0), tm)

    # --- final: vignette + downscale
    out = img.resize((768, 768), Image.LANCZOS)
    os.makedirs("renderer/assets", exist_ok=True)
    out.save("renderer/assets/logo.png")
    print("ok")





# ---------------- audio ----------------
SR = 44100
import wave
_rng = np.random.default_rng(5)


class Mix:
    def __init__(self, dur):
        self.n = int(SR * dur)
        self.buf = np.zeros((self.n, 2))

    def add(self, sig, t, gain=1.0, pan=0.0):
        i = int(t * SR)
        if i >= self.n or i < 0:
            return
        sig = sig[: self.n - i]
        self.buf[i:i + len(sig), 0] += sig * gain * (1 - max(0, pan))
        self.buf[i:i + len(sig), 1] += sig * gain * (1 + min(0, pan))

    def save(self, path, fade=0.3):
        m = np.tanh(self.buf * 0.9)
        f = int(fade * SR)
        if f:
            m[-f:] *= np.linspace(1, 0, f)[:, None]
        m /= max(1e-6, np.abs(m).max()) / 0.95
        with wave.open(path, "wb") as w:
            w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes((m * 32767).astype(np.int16).tobytes())


def _env(n, a=0.002, d=0.3):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * np.exp(-t / d)


def _lp(x, k):
    return np.convolve(x, np.ones(k) / k, mode="same")


def kick(d=0.45):
    n = int(SR * d); t = np.arange(n) / SR
    return np.sin(2 * np.pi * np.cumsum(50 + 120 * np.exp(-t * 30)) / SR) * _env(n, 0.001, 0.16)


def boom(d=2.0):
    n = int(SR * d); t = np.arange(n) / SR
    return np.tanh(np.sin(2 * np.pi * np.cumsum(30 + 70 * np.exp(-t * 6)) / SR) * _env(n, 0.002, 0.7) * 2.2)


def hat(d=0.06):
    n = int(SR * d); x = _rng.standard_normal(n)
    return (x - _lp(x, 6)) * _env(n, 0.0005, 0.018)


def clap(d=0.25):
    n = int(SR * d); x = _rng.standard_normal(n); x = x - _lp(x, 20)
    e = _env(n, 0.001, 0.06)
    for off in (0.008, 0.016):
        k = int(off * SR); e[k:] += 0.6 * _env(n - k, 0.001, 0.05)
    return x * e * 0.6


def thunder(d=2.4):
    n = int(SR * d); t = np.arange(n) / SR
    crack = _rng.standard_normal(n) * np.exp(-t / 0.05)
    rumble = _lp(_rng.standard_normal(n), 120) * 6 * np.minimum(1, t / 0.08) * np.exp(-t / 0.9)
    return np.tanh(crack * 1.2 + rumble * 1.4)


def whoosh(d=0.35):
    n = int(SR * d); t = np.arange(n) / SR
    x = _lp(_rng.standard_normal(n), 8) * 3
    return x * np.sin(np.pi * t / d) ** 2


def riser(d=1.2):
    n = int(SR * d); t = np.arange(n) / SR
    tone = np.sign(np.sin(2 * np.pi * np.cumsum(200 + 1600 * (t / d) ** 2) / SR)) * 0.15
    noise = (_rng.standard_normal(n) - _lp(_rng.standard_normal(n), 3)) * 0.25
    return (tone + noise) * (t / d) ** 2


def beep(freq=880, d=0.18):
    n = int(SR * d); t = np.arange(n) / SR
    return np.sign(np.sin(2 * np.pi * freq * t)) * 0.35 * _env(n, 0.002, 0.08)


def bass(freq, d):
    n = int(SR * d); t = np.arange(n) / SR
    return np.tanh((np.sin(2 * np.pi * freq * t) + 0.4 * np.sin(4 * np.pi * freq * t)) * 1.5) * _env(n, 0.005, d * 0.6)


def beat(mix, start, end, bpm=140, gain=1.0, seq=(55, 55, 65.4, 49)):
    b = 60 / bpm; t = start; bar = 0
    while t < end - 0.05:
        for s in range(16):
            st = t + s * b / 4
            if st >= end:
                break
            if s in (0, 6, 10):
                mix.add(kick(), st, 0.9 * gain)
            if s in (4, 12):
                mix.add(clap(), st, 0.55 * gain)
            mix.add(hat(), st, (0.18 if s % 2 else 0.28) * gain, pan=0.25)
        mix.add(bass(seq[bar % len(seq)], b * 3.5), t, 0.45 * gain)
        t += b * 4; bar += 1


def make_sounds():
    m = Mix(3.4)
    m.add(thunder(), 0.0, 0.9); m.add(boom(1.8), 0.15, 0.9); m.add(whoosh(), 0.55, 0.6)
    m.add(kick(0.3), 0.6, 0.7); m.add(clap(), 0.95, 0.6); m.add(thunder(), 1.1, 0.6)
    m.save("renderer/assets/intro.wav", fade=0.5)
    m = Mix(6.4)
    m.add(thunder(), 0.0, 0.8); m.add(thunder(), 0.18, 0.5); m.add(riser(1.4), 0.2, 0.6)
    m.add(boom(2.0), 1.6, 1.0); m.add(thunder(), 1.6, 0.8)
    beat(m, 1.6, 6.4, bpm=140, gain=0.75)
    m.add(thunder(), 3.0, 0.6); m.add(boom(1.4), 3.0, 0.7); m.add(whoosh(), 3.55, 0.6)
    m.save("renderer/assets/welcome.wav", fade=0.8)


if __name__ == "__main__":
    main()
    make_sounds()
    print("assets ok")
