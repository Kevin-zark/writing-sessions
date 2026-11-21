#!/usr/bin/env python3
"""Turn raw GenerateImage output into window-theme layer assets.
  backdrop  <in> <out.jpg>           1280x720, normal blend
  layer     <in> <out.jpg>           silhouette on white (mid / near): white point pushed to pure white so 'multiply' leaves the backdrop alone
  landmark  <in> <out.jpg>           same levels, cropped to the object's bounding box; prints "w h" for the manifest
Usage: process_window_assets.py backdrop|layer|landmark in out"""
import sys, numpy as np
from PIL import Image

def levels(a, white=232.0):
    return np.clip(a.astype(np.float32) * (255.0 / white), 0, 255)

def main(kind, src, dst):
    im = Image.open(src).convert('RGB')
    if kind == 'backdrop':
        im.resize((1280, 720), Image.LANCZOS).save(dst, quality=82, optimize=True, progressive=True); return
    if kind == 'layer':
        a = levels(np.asarray(im.resize((1280, 720), Image.LANCZOS)))
        Image.fromarray(a.astype(np.uint8)).save(dst, quality=86, optimize=True, progressive=True); return
    if kind == 'landmark':
        a = levels(np.asarray(im)); ink = (255 - a.min(2)) > 28
        ys, xs = np.where(ink); pad = 6
        x0, x1, y0, y1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad), max(0, ys.min() - pad), min(a.shape[0], ys.max() + pad)
        c = Image.fromarray(a[y0:y1, x0:x1].astype(np.uint8))
        if c.width > 1100: c = c.resize((1100, round(c.height * 1100 / c.width)), Image.LANCZOS)
        c.save(dst, quality=86, optimize=True, progressive=True); print(c.width, c.height); return
    raise SystemExit(__doc__)
if __name__ == '__main__': main(*sys.argv[1:4])
