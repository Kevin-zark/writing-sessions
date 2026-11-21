#!/usr/bin/env python3
"""Make generated clips chain seamlessly, strip audio, and encode for iOS.
loop-X: last N frames are blended toward frame 0, so the wrap point is invisible.
br-X-Y: first N frames are blended from loop-X frame 0, last N frames into loop-Y frame 0,
so loop -> bridge -> loop swaps land on identical pixels.
Usage: seam_fix.py RAW_DIR OUT_DIR   (raw files named raw-loop-<id>.mp4 / raw-br-<a>-<b>.mp4)
"""
import subprocess, sys, os, glob, numpy as np
W, H, N = 1280, 720, 12
def read(path):
    p = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-an', '-vf', f'scale={W}:{H},format=rgb24', '-f', 'rawvideo', '-'], capture_output=True, check=True)
    return np.frombuffer(p.stdout, np.uint8).reshape(-1, H, W, 3)
def write(frames, out):
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', '24', '-i', '-',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-g', '48',
        '-movflags', '+faststart', '-an', out], stdin=subprocess.PIPE)
    for f in frames: p.stdin.write(np.ascontiguousarray(f).tobytes())
    p.stdin.close(); p.wait()
def blend(a, b, t): return (a.astype(np.float32) * (1 - t) + b.astype(np.float32) * t).round().astype(np.uint8)
raw, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
anchors = {}
for f in sorted(glob.glob(f'{raw}/raw-loop-*.mp4')):
    vid = os.path.basename(f)[9:-4]; fr = read(f); f0 = fr[0].copy(); n = len(fr)
    res = [fr[i] if i < n - 1 - N else blend(fr[i], f0, (i - (n - 1 - N)) / N) for i in range(n - 1)]  # drop dup final frame
    anchors[vid] = f0; write(res, f'{out}/loop-{vid}.mp4'); print('loop', vid, n - 1)
for f in sorted(glob.glob(f'{raw}/raw-br-*.mp4')):
    a, b = os.path.basename(f)[7:-4].split('-', 1); fr = read(f); n = len(fr)
    res = []
    for i in range(n):
        x = fr[i]
        if i < N: x = blend(x, anchors[a], 1 - i / N)
        if i >= n - N: x = blend(x, anchors[b], (i - (n - N - 1)) / N)
        res.append(x)
    write(res, f'{out}/br-{a}-{b}.mp4'); print('bridge', a, b, n)
