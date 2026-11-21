#!/usr/bin/env python3
"""Generates ORIGINAL placeholder audio (procedural; no third-party samples).
Output: themes/dark-academia-train/audio/{placeholder-pad-1..3,ambience-train-rain}.mp3
Needs numpy + ffmpeg. Replace with Kevin's Suno tracks later."""
import numpy as np, subprocess, os, sys
SR = 32000
rng = np.random.default_rng(7)
OUT = os.path.join(os.path.dirname(__file__), "..", "themes", "dark-academia-train", "audio")
os.makedirs(OUT, exist_ok=True)

def midi(n): return 440.0 * 2 ** ((n - 69) / 12)

def lowpass(x, fc):  # one-pole, FFT-free
    a = np.exp(-2 * np.pi * fc / SR); y = np.zeros_like(x); s = 0.0
    for i in range(len(x)):
        s = (1 - a) * x[i] + a * s; y[i] = s
    return y

def fft_filter(x, lo, hi):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    m = np.ones_like(f)
    if lo: m *= 1 / (1 + (lo / np.maximum(f, 1e-3)) ** 4)
    if hi: m *= 1 / (1 + (f / hi) ** 4)
    return np.fft.irfft(X * m, len(x))

def reverb(x, secs=3.0, wet=0.35):
    n = int(secs * SR); t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-t * 3.0 / secs * 2.2)
    ir = fft_filter(ir, 200, 4000)
    L = len(x) + n; N = 1 << (L - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N), N)[:len(x)]
    return (1 - wet) * x + wet * y / (np.max(np.abs(y)) + 1e-9) * np.max(np.abs(x))

def make_loop(x, fade_s):
    """Make x (length T+fade) into a seamless T-length loop via crossfade."""
    f = int(fade_s * SR); T = len(x) - f
    t = np.linspace(0, np.pi / 2, f)
    head = x[:f] * np.sin(t); tail = x[T:T + f] * np.cos(t)
    return np.concatenate([head + tail, x[f:T]])

def norm(x, peak=0.8):
    return x / (np.max(np.abs(x)) + 1e-9) * peak

def encode(x, name, kbps=80):
    st = np.stack([x[0], x[1]], 1) if isinstance(x, tuple) else np.stack([x, x], 1)
    pcm = (np.clip(st, -1, 1) * 32767).astype("<i2").tobytes()
    p = os.path.join(OUT, name)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "s16le", "-ar", str(SR), "-ac", "2", "-i", "-",
                    "-b:a", f"{kbps}k", p], input=pcm, check=True)
    print("wrote", p, os.path.getsize(p) // 1024, "KB")

def pad_track(chords, bell_scale, seed, secs=96, chord_len=16):
    r = np.random.default_rng(seed)
    n = secs * SR; t = np.arange(n) / SR
    L = np.zeros(n); R = np.zeros(n)
    for ci, ch in enumerate(chords * 10):
        s0 = ci * chord_len
        if s0 >= secs + 8: break
        for k, note in enumerate(ch):
            for det in (-0.12, 0.0, 0.14):
                f = midi(note) * 2 ** (det / 12 * 0.1)
                ph = r.uniform(0, 6.28)
                a = int(max(0, s0 - 3) * SR); b = int(min(n, (s0 + chord_len + 4) * SR))
                if a >= b: continue
                tt = t[a:b]
                env = np.minimum(1, np.minimum((tt - (s0 - 3)) / 5, ((s0 + chord_len + 4) - tt) / 5)).clip(0, 1)
                env = env ** 1.5
                w = np.sin(2 * np.pi * f * tt + ph) + 0.35 * np.sin(2 * np.pi * 2 * f * tt + ph) + 0.12 * np.sin(2 * np.pi * 3 * f * tt)
                lfo = 0.75 + 0.25 * np.sin(2 * np.pi * r.uniform(0.04, 0.1) * tt + r.uniform(0, 6))
                v = w * env * lfo * (0.5 if k == 0 else 0.3)
                pan = r.uniform(0.25, 0.75)
                L[a:b] += v * (1 - pan); R[a:b] += v * pan
    # sparse bell/piano-ish notes
    for i in range(int(secs / 4.5)):
        st = r.uniform(0, secs - 3); note = r.choice(bell_scale)
        a = int(st * SR); d = int(4 * SR); tt = np.arange(min(d, n - a)) / SR
        f = midi(int(note))
        v = (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * 2.0 * f * tt) * np.exp(-tt * 3) + 0.08 * np.sin(2 * np.pi * 4.01 * f * tt) * np.exp(-tt * 6))
        v *= np.exp(-tt * 1.3) * np.minimum(1, tt * 200) * 0.18
        pan = r.uniform(0.2, 0.8)
        L[a:a + len(v)] += v * (1 - pan); R[a:a + len(v)] += v * pan
    L = reverb(L, 3.5, 0.4); R = reverb(R, 3.5, 0.4)
    m = max(np.max(np.abs(L)), np.max(np.abs(R)))
    L, R = L / m * 0.7, R / m * 0.7
    # tiny edge fades only (the app applies the real crossfade envelope)
    fl = int(0.05 * SR); ramp = np.linspace(0, 1, fl)
    for ch in (L, R): ch[:fl] *= ramp; ch[-fl:] *= ramp[::-1]
    return L, R

# --- 3 pads: all warm minor / modal, slow
tracks = [
    ("placeholder-pad-1.mp3", [[45, 57, 60, 64], [41, 57, 60, 65], [48, 55, 60, 64], [43, 55, 59, 62]], [69, 72, 74, 76, 79, 81], 1),
    ("placeholder-pad-2.mp3", [[50, 57, 62, 65], [46, 58, 62, 65], [43, 55, 58, 62], [45, 57, 61, 64]], [62, 65, 67, 69, 72, 74], 2),
    ("placeholder-pad-3.mp3", [[40, 52, 59, 64], [36, 52, 55, 64], [38, 50, 57, 62], [40, 52, 59, 67]], [64, 67, 69, 71, 74, 76], 3),
]
if "--skip-music" not in sys.argv:
    for name, ch, sc, seed in tracks:
        encode(pad_track(ch, sc, seed), name)

# --- Ambience: soft rain + low train rumble + faint rhythmic clickety-clack, 60 s seamless loop
def ambience(secs=60, fade=6):
    n = (secs + fade) * SR; t = np.arange(n) / SR
    white = rng.standard_normal(n)
    rain = fft_filter(white, 1200, 9000) * 0.5
    drops = (rng.random(n) < 0.0015) * rng.standard_normal(n)
    rain += fft_filter(drops, 2000, 7000) * 3.0
    brown = np.cumsum(rng.standard_normal(n)); brown = fft_filter(brown, 25, 140)
    rumble = brown / np.max(np.abs(brown)) * 0.7
    rumble *= 0.8 + 0.2 * np.sin(2 * np.pi * 0.07 * t)
    # clickety-clack: pairs of thumps ~ every 0.55 s, soft
    clack = np.zeros(n); period = 0.55
    for k in range(int(secs / period) + 20):
        for off, g in ((0.0, 1.0), (0.16, 0.7)):
            a = int((k * period + off) * SR)
            if a + 4000 >= n: continue
            tt = np.arange(4000) / SR
            clack[a:a + 4000] += g * np.sin(2 * np.pi * 70 * tt) * np.exp(-tt * 45) * 0.5 \
                + g * rng.standard_normal(4000) * np.exp(-tt * 90) * 0.06
    clack = fft_filter(clack, 40, 900)
    mix = rain * 0.55 + rumble * 0.55 + clack * 0.6
    y = make_loop(mix, fade)
    # light stereo decorrelation
    L = y; R = np.roll(y, 211) * 0.6 + y * 0.4
    return norm(L, 0.6), norm(R, 0.6)

encode(ambience(), "ambience-train-rain.mp3", 64)
