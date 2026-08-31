#!/usr/bin/env python3
"""Genereerib rakenduse ikoonid (PNG) ilma väliste teekideta.
Kasutus: python3 make-icons.py"""
import zlib, struct, math, os

BG1 = (37, 99, 235)    # sinine
BG2 = (79, 70, 229)    # indigo
FG  = (255, 255, 255)
ACC = (250, 204, 21)   # kollane esiletõst

SS = 4  # supersampling

def rounded_alpha(x, y, w, h, r):
    """Kaugusepõhine kate ümardatud ruudule."""
    cx = min(max(x, r), w - r)
    cy = min(max(y, r), h - r)
    d = math.hypot(x - cx, y - cy)
    return 1.0 if d <= r else 0.0

def glyph_rects(bx, by, inner):
    """Märgi ristkülikud kastis (bx, by, inner): 3x4 tunniruudustik ja päiseriba.
    Üks geomeetria kahele joonistajale, et ikoon ja jagamispilt kokku käiksid.
    Järjekord loeb: hilisem ristkülik kirjutab varasema üle."""
    gx0 = bx + inner * 0.20
    gy0 = by + inner * 0.26
    gw  = inner * 0.60
    gh  = inner * 0.50
    cols, rows = 3, 4
    cw = gw / cols
    ch = gh / rows
    gap = inner * 0.028
    hi_col, hi_row = 1, 1  # esiletõstetud tund

    out = []
    for cr in range(rows):
        for cc in range(cols):
            x0 = gx0 + cc * cw + gap / 2
            y0 = gy0 + cr * ch + gap / 2
            out.append((x0, y0, x0 + cw - gap, y0 + ch - gap,
                        ACC if (cc == hi_col and cr == hi_row) else FG))
    hy0 = by + inner * 0.155
    out.append((gx0, hy0, gx0 + gw, hy0 + inner * 0.055, FG))
    return out


def render(size, padding=0.0, rounded=True):
    S = size * SS
    pad = int(S * padding)
    inner = S - 2 * pad
    radius = inner * 0.235 if rounded else 0
    px = bytearray(S * S * 4)
    rects = glyph_rects(pad, pad, inner)

    for y in range(S):
        for x in range(S):
            a = rounded_alpha(x - pad, y - pad, inner, inner, radius) if rounded else 1.0
            if a == 0.0:
                continue
            t = ((x - pad) + (y - pad)) / (2.0 * inner)
            r = int(BG1[0] + (BG2[0] - BG1[0]) * t)
            g = int(BG1[1] + (BG2[1] - BG1[1]) * t)
            b = int(BG1[2] + (BG2[2] - BG1[2]) * t)

            for x0, y0, x1, y1, col in rects:
                if x0 <= x < x1 and y0 <= y < y1:
                    r, g, b = col

            i = (y * S + x) * 4
            px[i:i+4] = bytes((r, g, b, int(a * 255)))

    # downsample SSxSS
    out = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            tr = tg = tb = ta = 0
            for dy in range(SS):
                for dx in range(SS):
                    i = (((y * SS + dy) * S) + (x * SS + dx)) * 4
                    al = px[i+3]
                    tr += px[i] * al; tg += px[i+1] * al; tb += px[i+2] * al; ta += al
            j = (y * size + x) * 4
            n = SS * SS
            if ta == 0:
                out[j:j+4] = b'\x00\x00\x00\x00'
            else:
                out[j:j+4] = bytes((tr // ta, tg // ta, tb // ta, ta // n))
    return bytes(out)

def render_og(w, h):
    """Jagamispilt sotsiaalmeediale (Messenger, WhatsApp, Slack): sama gradient
    üle terve ristküliku ja sama märk keskel. Teksti kannavad og:title ja
    og:description — siin joonistajas fonti ei ole.

    Supersämplimist ei ole vaja: gradient on sujuv ja märk koosneb telgjoondatud
    ristkülikutest, mis langevad täispikslitele."""
    inner = min(w, h) * 0.62
    bx = (w - inner) / 2
    by = (h - inner) / 2

    # Gradient sõltub ainult summast x + y, seega piisab ühest tabelist.
    span = w + h - 2
    lut = []
    for sxy in range(span + 1):
        t = sxy / span
        lut.append(bytes((int(BG1[0] + (BG2[0] - BG1[0]) * t),
                          int(BG1[1] + (BG2[1] - BG1[1]) * t),
                          int(BG1[2] + (BG2[2] - BG1[2]) * t), 255)))
    px = bytearray()
    for y in range(h):
        for x in range(w):
            px += lut[x + y]

    for x0, y0, x1, y1, col in glyph_rects(bx, by, inner):
        xa, xb = round(x0), round(x1)
        line = bytes(col + (255,)) * (xb - xa)
        for y in range(round(y0), round(y1)):
            i = (y * w + xa) * 4
            px[i:i + len(line)] = line
    return bytes(px)


def write_png(path, size, rgba, opaque_bg=None, height=None):
    if opaque_bg:
        flat = bytearray(len(rgba))
        for i in range(0, len(rgba), 4):
            a = rgba[i+3] / 255
            for c in range(3):
                flat[i+c] = int(rgba[i+c] * a + opaque_bg[c] * (1 - a))
            flat[i+3] = 255
        rgba = bytes(flat)
    h = height or size
    raw = b''.join(b'\x00' + rgba[y*size*4:(y+1)*size*4] for y in range(h))
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    open(path, 'wb').write(png)
    return len(png)

os.makedirs('icons', exist_ok=True)
jobs = [
    ('icons/apple-touch-icon.png', 180, 0.0,  True,  BG1),  # iOS: läbipaistvust ei toeta
    ('icons/icon-192.png',         192, 0.0,  True,  None),
    ('icons/icon-512.png',         512, 0.0,  True,  None),
    ('icons/maskable-512.png',     512, 0.14, False, BG1),
    ('icons/favicon-32.png',        32, 0.0,  True,  None),
]
for path, size, pad, rounded, bg in jobs:
    n = write_png(path, size, render(size, pad, rounded), bg)
    print(f'{path:34s} {size}x{size}  {n/1024:6.1f} KB')

# Jagamispilt: Facebook soovitab 1200x630, Messenger lõikab sellest ise ruudu.
OG_W, OG_H = 1200, 630
n = write_png('icons/og.png', OG_W, render_og(OG_W, OG_H), height=OG_H)
print(f'{"icons/og.png":34s} {OG_W}x{OG_H}  {n/1024:6.1f} KB')
