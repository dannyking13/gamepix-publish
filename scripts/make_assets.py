#!/usr/bin/env python3
"""Generate GamePix-compliant assets: icon 256x256 (<=1MB) and cover 1360x850 (<=1.5MB).

Usage: python3 make_assets.py --title "MY GAME" [--out-dir .]
Requires: pillow
"""
import argparse
import os

from PIL import Image, ImageDraw, ImageFont

NAVY = (18, 32, 74, 255)
TEAL = (0, 190, 200, 255)
TEAL_DARK = (8, 120, 135, 255)
AMBER = (235, 185, 80, 255)
ORANGE = (230, 126, 34, 255)
WHITE = (255, 255, 255, 255)


def _rounded_box(d, cx, cy, s, r, fill, outline=None, ow=0):
    d.rounded_rectangle([cx - s, cy - s, cx + s, cy + s], radius=r, fill=fill, outline=outline, width=ow)


def _font(size):
    try:
        return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', size)
    except Exception:
        return ImageFont.load_default()


def make_icon(title, path):
    S = 2
    w = 256 * S
    img = Image.new('RGBA', (w, w), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w - 1, w - 1], radius=40 * S, fill=NAVY)
    d.rectangle([0, w - 85 * S, w - 1, w - 1], fill=TEAL_DARK)
    # hero block + tape
    _rounded_box(d, 128 * S, 105 * S, 55 * S, 12 * S, TEAL, WHITE, 3 * S)
    d.rectangle([128 * S - 55 * S, 105 * S - 9 * S, 128 * S + 55 * S, 105 * S + 9 * S], fill=(255, 255, 255, 120))
    # small blocks
    _rounded_box(d, 75 * S, 60 * S, 24 * S, 6 * S, AMBER, WHITE, 2 * S)
    _rounded_box(d, 180 * S, 75 * S, 20 * S, 5 * S, ORANGE, WHITE, 2 * S)
    # truck silhouette
    d.rounded_rectangle([60 * S, 200 * S, 165 * S, 235 * S], radius=7 * S, fill=WHITE)
    d.rounded_rectangle([165 * S, 207 * S, 200 * S, 235 * S], radius=5 * S, fill=WHITE)
    d.ellipse([75 * S, 222 * S, 103 * S, 250 * S], fill=(30, 30, 30, 255))
    d.ellipse([175 * S, 222 * S, 203 * S, 250 * S], fill=(30, 30, 30, 255))
    # optional short title (keep it BIG and readable at 256px)
    if title:
        f = _font(44 * S)
        bb = d.textbbox((0, 0), title, font=f)
        tw = bb[2] - bb[0]
        if tw < w - 30 * S:
            d.text(((w - tw) // 2, 12 * S), title, font=f, fill=WHITE)
    img = img.resize((256, 256), Image.LANCZOS).convert('RGB')
    img.save(path, optimize=True)


def make_cover(title, path):
    W, H = 1360, 850
    img = Image.new('RGB', (W, H), NAVY[:3])
    d = ImageDraw.Draw(img)
    for i in range(10):
        c = (18 + i * 3, 32 + i * 5, 74 + i * 8)
        d.rectangle([0, i * 85, W, (i + 1) * 85], fill=c)
    d.ellipse([1040, 80, 1280, 320], fill=AMBER[:3])
    d.ellipse([-260, 560, 660, 1040], fill=(30, 90, 70))
    d.ellipse([400, 620, 1440, 1130], fill=(25, 75, 60))
    d.polygon([(0, 850), (W, 700), (W, 850)], fill=(70, 70, 80))
    # truck + boxes
    d.rounded_rectangle([260, 500, 680, 660], radius=26, fill=TEAL[:3])
    d.rounded_rectangle([680, 540, 840, 660], radius=18, fill=WHITE)
    d.rounded_rectangle([706, 556, 816, 626], radius=10, fill=(160, 200, 230))
    d.ellipse([320, 620, 430, 730], fill=(30, 30, 30))
    d.ellipse([330, 630, 420, 720], fill=(160, 160, 160))
    d.ellipse([700, 620, 810, 730], fill=(30, 30, 30))
    d.ellipse([710, 630, 800, 720], fill=(160, 160, 160))
    _rounded_box(d, 400, 410, 62, 14, AMBER)
    _rounded_box(d, 530, 395, 56, 14, ORANGE)
    _rounded_box(d, 465, 300, 52, 12, TEAL)
    if title:
        f = _font(96)
        bb = d.textbbox((0, 0), title, font=f)
        d.text(((W - (bb[2] - bb[0])) // 2, 100), title, font=f, fill=WHITE[:3])
    img.save(path, optimize=True)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--title', required=True, help='Game title rendered on assets (must match game title)')
    ap.add_argument('--out-dir', default='.')
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)
    icon = os.path.join(args.out_dir, 'icon_256.png')
    cover = os.path.join(args.out_dir, 'cover_1360x850.png')
    make_icon(args.title, icon)
    make_cover(args.title, cover)
    print('icon bytes:', os.path.getsize(icon), '->', icon)
    print('cover bytes:', os.path.getsize(cover), '->', cover)
