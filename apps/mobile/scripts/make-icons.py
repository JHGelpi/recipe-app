"""Generates the web app icons from assets/icon.png (run once; output is committed).

Usage, from apps/mobile: python3 scripts/make-icons.py
"""
from pathlib import Path

from PIL import Image

SOURCE = Path("assets/icon.png")
OUT = Path("public/icons")
# The Expo placeholder's background, so the maskable padding blends in.
BACKGROUND = (230, 244, 253)


def resized(size: int) -> Image.Image:
    return Image.open(SOURCE).convert("RGB").resize((size, size), Image.LANCZOS)


def maskable(size: int) -> Image.Image:
    # Android may crop to a circle: keep the artwork inside the central 80%.
    canvas = Image.new("RGB", (size, size), BACKGROUND)
    inner = int(size * 0.8)
    offset = (size - inner) // 2
    canvas.paste(resized(inner), (offset, offset))
    return canvas


OUT.mkdir(parents=True, exist_ok=True)
resized(192).save(OUT / "icon-192.png", optimize=True)
resized(512).save(OUT / "icon-512.png", optimize=True)
maskable(512).save(OUT / "icon-maskable-512.png", optimize=True)
resized(180).save(OUT / "apple-touch-icon.png", optimize=True)
print("wrote", sorted(path.name for path in OUT.iterdir()))
