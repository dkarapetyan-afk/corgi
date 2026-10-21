# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow==12.0.0"]
# ///
"""Render alpha tiles for Bun's shared character-atlas packer and PNG encoder."""
import json
import os
from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont

spec = json.load(sys.stdin)
scale = 4
cw, ch, side = spec["cw"] * scale, spec["ch"] * scale, spec["side"] * scale
candidates = [
    os.environ.get("MOONLANDER_FONT", ""),
    "/System/Library/Fonts/Menlo.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "C:/Windows/Fonts/consola.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Apple Symbols.ttf",
    "/System/Library/Fonts/Supplemental/EuphemiaCAS.ttc",
    "/System/Library/Fonts/Supplemental/NotoSansCanadianAboriginal-Regular.otf",
    "/System/Library/Fonts/LucidaGrande.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "C:/Windows/Fonts/arial.ttf",
]
paths = [path for path in candidates if path and Path(path).is_file()]
if not paths:
    raise RuntimeError("No monospace font found; set MOONLANDER_FONT to a .ttf or .ttc path")
primary = ImageFont.truetype(paths[0], 100)
size = max(1, round(cw * 100 / primary.getlength("M")))
fonts = [ImageFont.truetype(path, size) for path in paths]
ascent, descent = fonts[0].getmetrics()
for item in spec["tiles"]:
    glyph = item["glyph"]
    font = next((f for f in fonts if bytes(f.getmask(glyph)) != bytes(f.getmask("\U0010ffff"))), None)
    if font is None:
        raise RuntimeError(f"No installed font contains {glyph!r}")
    base = Image.new("L", (side, side))
    advance = font.getlength(glyph)
    ImageDraw.Draw(base).text((side / 2, side / 2 + (ascent - descent) / 2), glyph, font=font, anchor="ms", fill=255)
    if advance > cw * 1.04:
        squeezed = base.resize((max(1, round(side * cw / advance)), side), Image.Resampling.LANCZOS)
        base = Image.new("L", (side, side))
        base.paste(squeezed, ((side - squeezed.width) // 2, 0))
    for turn in range(item["count"]):
        angle = 0 if item["count"] == 1 else turn * 2 - 90
        tile = base.rotate(-angle, resample=Image.Resampling.BICUBIC).resize((spec["side"], spec["side"]), Image.Resampling.LANCZOS)
        sys.stdout.buffer.write(tile.tobytes())
