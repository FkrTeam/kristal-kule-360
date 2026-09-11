#!/usr/bin/env python3
"""
Panorama asset pipeline
=======================
Turns raw equirectangular sources in ./source-panos into a progressive, CDN-ready
tier set under ./public/assets/pano/<id>/ plus a manifest.json the runtime reads.

    source-panos/kristal-kule.jpg   (12000x6000, 36 MB — never shipped)
        └─▶ public/assets/pano/kristal-kule/
              ├─ manifest.json          tiers, sizes, LQIP, formats
              ├─ 1024.webp              Stage 1  preview  (~40 KB, LCP image)
              ├─ 2048.webp              mobile medium
              ├─ 4096.webp              desktop medium / mobile high
              ├─ 8192.webp              desktop high
              └─ NNNN.ktx2              GPU-compressed twins (if `toktx` is installed)

Why both WebP and KTX2?
  WebP  → smallest transfer, but decodes to raw RGBA on the GPU: 8192x4096 = 134 MB (+33% mips).
  KTX2  → Basis Universal, stays compressed on the GPU: ETC1S 8192x4096 ≈ 16 MB, UASTC ≈ 32 MB.
          Uploads are near-instant (no main-thread decode), mipmaps ship pre-built.
  The runtime prefers KTX2 when the file exists and the browser supports the transcoder,
  and falls back to WebP otherwise.

Usage:
    python scripts/build-pano.py                # all sources, skip up-to-date outputs
    python scripts/build-pano.py --force        # rebuild everything
    python scripts/build-pano.py --uastc        # higher quality KTX2 (2x GPU memory, larger download)
    python scripts/build-pano.py --max 4096     # cap the largest tier

Requires: Pillow.  Optional: toktx (KTX-Software) on PATH for KTX2 output.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image, ImageFilter

try:  # optional: `pip install pillow-avif-plugin` enables AVIF output for the preview tier
    import pillow_avif  # noqa: F401
    AVIF = True
except ImportError:
    AVIF = False

Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source-panos"
OUT = ROOT / "public" / "assets" / "pano"
TIERS = [1024, 2048, 4096, 8192]
WEBP_QUALITY = {1024: 72, 2048: 78, 4096: 80, 8192: 82}


def log(msg: str) -> None:
    print(f"[pano] {msg}", flush=True)


def lqip(im: Image.Image) -> str:
    """64x32 blurred JPEG as a data URI — inlined into HTML for a zero-request first paint."""
    tiny = im.resize((64, 32), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
    buf = io.BytesIO()
    tiny.save(buf, "JPEG", quality=55, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def encode_ktx2(png: Path, dst: Path, uastc: bool) -> bool:
    toktx = shutil.which("toktx")
    if not toktx:
        return False
    if uastc:
        codec = ["--encode", "uastc", "--uastc_quality", "2", "--zcmp", "19"]
    else:
        codec = ["--encode", "etc1s", "--clevel", "4", "--qlevel", "255"]
    cmd = [toktx, "--t2", "--genmipmap", "--filter", "lanczos4", *codec, str(dst), str(png)]
    t = time.time()
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        log(f"toktx failed for {png.name}: {res.stderr.strip()[:300]}")
        return False
    log(f"  ktx2 {dst.name} {dst.stat().st_size/1e6:.1f} MB ({time.time()-t:.1f}s)")
    return True


def build(src: Path, force: bool, uastc: bool, max_tier: int) -> None:
    pid = src.stem
    out = OUT / pid
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "manifest.json"

    if manifest_path.exists() and not force and manifest_path.stat().st_mtime > src.stat().st_mtime:
        log(f"{pid}: up to date")
        return

    log(f"{pid}: opening {src.name}")
    im = Image.open(src).convert("RGB")
    w, h = im.size
    if abs(w / h - 2.0) > 0.01:
        log(f"  warning: {w}x{h} is not 2:1 equirectangular")

    tiers = []
    prev = im
    for width in sorted((t for t in TIERS if t <= min(max_tier, w)), reverse=True):
        height = width // 2
        # Downscale from the previous (larger) tier for speed; quality is identical for 2x steps.
        prev = prev.resize((width, height), Image.LANCZOS)
        webp = out / f"{width}.webp"
        t = time.time()
        prev.save(webp, "WEBP", quality=WEBP_QUALITY[width], method=6)
        log(f"  webp {webp.name} {webp.stat().st_size/1e6:.2f} MB ({time.time()-t:.1f}s)")

        entry = {"width": width, "height": height, "webp": webp.name, "webpBytes": webp.stat().st_size}

        ktx2 = out / f"{width}.ktx2"
        if width >= 2048 and shutil.which("toktx"):  # preview tier stays a plain image (it is the LCP <img>)
            png = out / f"_{width}.png"
            prev.save(png, "PNG", compress_level=1)
            if encode_ktx2(png, ktx2, uastc):
                entry["ktx2"] = ktx2.name
                entry["ktx2Bytes"] = ktx2.stat().st_size
                entry["ktx2Codec"] = "uastc" if uastc else "etc1s"
            png.unlink(missing_ok=True)
        tiers.append(entry)

        if width == 1024 and AVIF:
            avif = out / f"{width}.avif"
            prev.save(avif, "AVIF", quality=60, speed=4)
            entry["avif"] = avif.name
            entry["avifBytes"] = avif.stat().st_size
            log(f"  avif {avif.name} {avif.stat().st_size/1e3:.0f} KB")
        if width == 2048:
            # Social card: centre crop of the horizon band, 1200x630.
            band = prev.crop((424, 300, 1624, 930)).resize((1200, 630), Image.LANCZOS)
            band.save(out / "og.jpg", "JPEG", quality=82, optimize=True, progressive=True)
            log("  og.jpg written")

    tiers.sort(key=lambda e: e["width"])
    manifest = {
        "id": pid,
        "source": {"width": w, "height": h},
        "lqip": lqip(prev),
        "tiers": tiers,
        "generated": int(time.time()),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2))
    log(f"{pid}: manifest written ({len(tiers)} tiers)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--uastc", action="store_true", help="UASTC instead of ETC1S for KTX2")
    ap.add_argument("--max", type=int, default=8192)
    ap.add_argument("--all", action="store_true", help="(default) process every source")
    args = ap.parse_args()

    sources = sorted(p for p in SRC.glob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".tif", ".tiff"})
    if not sources:
        log(f"no sources in {SRC}")
        return 1
    if not shutil.which("toktx"):
        log("toktx not found — skipping KTX2 (install KTX-Software to enable GPU-compressed textures)")
    for src in sources:
        build(src, args.force, args.uastc, args.max)
    return 0


if __name__ == "__main__":
    sys.exit(main())
