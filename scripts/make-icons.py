"""Génère les icônes PNG de l'app (même dessin que web/public/icon.svg).
Usage : python3 scripts/make-icons.py   (nécessite Pillow)
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "web" / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

SS = 4  # suréchantillonnage pour des bords lisses
BASE = 512


def bezier(p0, p1, p2, p3, n=48):
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def drop_polygon():
    import math

    left = bezier((256, 120), (256, 120), (170, 218), (170, 290))
    # demi-cercle inférieur : de (170,290) à (342,290) en passant par le bas
    arc = [(256 + 86 * math.cos(math.pi - a), 290 + 86 * math.sin(a)) for a in [i * math.pi / 48 for i in range(49)]]
    right = bezier((342, 290), (342, 218), (256, 120), (256, 120))
    return left + arc + right


def gradient():
    img = Image.new("RGB", (BASE, BASE))
    px = img.load()
    c0, c1 = (0x0F, 0x76, 0x6E), (0x14, 0xB8, 0xA6)
    for y in range(BASE):
        for x in range(BASE):
            t = (x + y) / (2 * (BASE - 1))
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(c0, c1))
    return img


def foreground():
    big = BASE * SS
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.polygon([(x * SS, y * SS) for x, y in drop_polygon()], fill=(255, 255, 255, 255))
    teal = (0x0F, 0x76, 0x6E, 255)
    pts = [(222, 298), (248, 324), (294, 270)]
    w = 20 * SS
    d.line([(x * SS, y * SS) for x, y in pts], fill=teal, width=w, joint="curve")
    for x, y in (pts[0], pts[-1]):
        r = w / 2
        d.ellipse([x * SS - r, y * SS - r, x * SS + r, y * SS + r], fill=teal)
    return layer.resize((BASE, BASE), Image.LANCZOS)


icon = gradient().convert("RGBA")
icon.alpha_composite(foreground())

icon.save(OUT / "icon-512.png")
icon.save(OUT / "icon-maskable-512.png")  # fond plein + goutte dans la zone de sécurité
icon.resize((192, 192), Image.LANCZOS).save(OUT / "icon-192.png")
icon.resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png")
print("Icônes générées dans", OUT)
