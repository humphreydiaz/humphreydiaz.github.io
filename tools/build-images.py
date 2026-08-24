#!/usr/bin/env python3
"""
Optimise the full-resolution masters in source_images/ into web assets in assets/img/.

The masters are gitignored (~14 MB); only the output of this script is committed,
so this file exists to make that output reproducible.

Usage:  python tools/build-images.py
Needs:  Pillow with WebP support  (pip install Pillow)
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source_images"
OUT = ROOT / "assets" / "img"

WEBP = dict(format="WEBP", quality=82, method=6)

# (source, output, longest-edge box, keep alpha)
JOBS = [
    # Full-body cutout with a real alpha channel -> textures the 3D glitch plane.
    ("my_image (2).png", "portrait-cutout.webp", (800, 1592), True),
    # Wide glitch plate with negative space on the left -> hero plate / OG source.
    ("my_image (5).png", "hero-glitch.webp", (1600, 900), False),
    # Datacenter portrait with teal particle dissolve -> about chapter.
    ("my_image (1).png", "portrait-cyber.webp", (900, 1124), False),
    # Holographic HUD interaction shot -> builds chapter.
    ("my_image (3).png", "hud-panel.webp", (1100, 1100), False),
    # Rim-lit studio portrait -> about card.
    ("my_image (6).png", "portrait-rim.webp", (800, 1133), False),
    # Headshot -> avatars.
    ("Github-Profile-Pic.png", "avatar-512.webp", (512, 512), False),
    ("Github-Profile-Pic.png", "avatar-180.webp", (180, 180), False),
]


def build_webp(src_name, out_name, box, keep_alpha):
    src = SRC / src_name
    if not src.exists():
        print(f"  SKIP {out_name}: missing {src_name}")
        return 0
    im = Image.open(src)
    im = im.convert("RGBA" if keep_alpha else "RGB")
    im.thumbnail(box, Image.LANCZOS)
    dest = OUT / out_name
    im.save(dest, **WEBP)
    size = dest.stat().st_size
    print(f"  {out_name:<24} {im.size[0]}x{im.size[1]:<5} {size/1024:7.1f} KB")
    return size


def build_og():
    """1200x630 JPG for social cards - some scrapers still reject WebP."""
    src = SRC / "my_image (5).png"
    if not src.exists():
        return 0
    im = Image.open(src).convert("RGB")
    tw, th = 1200, 630
    # Cover-crop to the exact card ratio.
    scale = max(tw / im.width, th / im.height)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    left = (im.width - tw) // 2
    top = (im.height - th) // 2
    im = im.crop((left, top, left + tw, top + th))
    dest = OUT / "og-image.jpg"
    im.save(dest, format="JPEG", quality=84, optimize=True, progressive=True)
    size = dest.stat().st_size
    print(f"  {'og-image.jpg':<24} {tw}x{th:<5} {size/1024:7.1f} KB")
    return size


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"source_images/ -> assets/img/\n")
    total = sum(build_webp(*job) for job in JOBS)
    total += build_og()
    print(f"\n  {'TOTAL':<24} {'':<11} {total/1024:7.1f} KB")


if __name__ == "__main__":
    main()
