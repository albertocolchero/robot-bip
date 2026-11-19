"""Genera el icono de Bip (sus dos ojos) sin librerías de imagen: solo numpy + zlib.

python scripts/make_icons.py  ->  assets/icon.png (1024, sin transparencia, como pide Apple),
                                  assets/splash-icon.png, assets/favicon.png
"""
import os
import struct
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "assets")
GLOW = np.array([0x4F, 0xE3, 0xC1], dtype=np.float64)
BG = np.array([0x05, 0x08, 0x0B], dtype=np.float64)


def png(path, rgb, alpha=None):
    h, w, _ = rgb.shape
    if alpha is None:
        raw = rgb.astype(np.uint8)
        ctype, ch = 2, 3
    else:
        raw = np.dstack([rgb, alpha]).astype(np.uint8)
        ctype, ch = 6, 4
    rows = b"".join(b"\x00" + raw[y].tobytes() for y in range(h))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n")
        fh.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0)))
        fh.write(chunk(b"IDAT", zlib.compress(rows, 9)))
        fh.write(chunk(b"IEND", b""))


def rounded_rect_sdf(xx, yy, cx, cy, w, h, r):
    qx = np.abs(xx - cx) - (w / 2 - r)
    qy = np.abs(yy - cy) - (h / 2 - r)
    out = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0))
    inside = np.minimum(np.maximum(qx, qy), 0)
    return out + inside - r


def eyes(size):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64) + 0.5
    s = size / 1024
    d = np.full((size, size), 1e9)
    for cx in (512 - 178, 512 + 178):
        d = np.minimum(d, rounded_rect_sdf(xx, yy, cx * s, 500 * s, 236 * s, 292 * s, 84 * s))
    fill = np.clip(0.5 - d / max(1.0, 1.2 * s), 0, 1)          # borde suavizado
    glow = np.clip(np.exp(-np.maximum(d, 0) / (46 * s)) * 0.55, 0, 1) * (1 - fill)
    return fill, glow


def main():
    fill, glow = eyes(1024)
    a = np.clip(fill + glow, 0, 1)[..., None]
    rgb = BG * (1 - a) + GLOW * a
    png(os.path.join(ASSETS, "icon.png"), rgb)

    fill, glow = eyes(512)
    alpha = np.clip(fill + glow, 0, 1) * 255
    rgb = np.broadcast_to(GLOW, (512, 512, 3))
    png(os.path.join(ASSETS, "splash-icon.png"), rgb, alpha)

    fill, glow = eyes(48)
    a = np.clip(fill + glow, 0, 1)[..., None]
    png(os.path.join(ASSETS, "favicon.png"), BG * (1 - a) + GLOW * a)
    print("iconos listos")


if __name__ == "__main__":
    main()
