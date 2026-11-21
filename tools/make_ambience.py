#!/usr/bin/env python3
"""Turn source field recordings into seamless, loudness-matched ambience loops.
For each layer: pick the steadiest/most-representative window, optional low-pass ("heard through glass"),
crossfade the seam (tail of the window is blended into its head), loudness-normalise (EBU R128),
check true-peak / clipping, encode mp3. Writes a JSON QA report.
Usage: make_ambience.py SRC_DIR OUT_DIR LAYERS.json
LAYERS.json: {"train": {"src": "133099-...mp3", "len": 60, "lowpass": 0, "mono": false, "lufs": -24, "pick": "steady"|"loud"|<seconds>}, ...}
"""
import json, subprocess, sys, os, numpy as np
SR = 44100
def decode(path, mono):
    p = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1' if mono else '2', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True)
    return np.frombuffer(p.stdout, np.float32).reshape(-1, 1 if mono else 2).copy()
def rms_windows(x, win):
    e = (x.astype(np.float64) ** 2).mean(1); c = np.concatenate([[0], np.cumsum(e)])
    starts = np.arange(0, len(x) - win, SR); return starts, np.sqrt((c[starts + win] - c[starts]) / win)
def choose(x, L, mode):
    win = int(L * SR)
    if len(x) <= win + 4 * SR: return x
    if isinstance(mode, (int, float)): s = int(mode * SR); return x[s:s + win + 4 * SR]
    starts, r = rms_windows(x, win + 4 * SR)
    # steady: lowest variation of 1 s RMS inside the window; loud: highest RMS (e.g. where the bells are)
    if mode == 'loud': s = starts[int(np.argmax(r))]
    else:
        _, r1 = rms_windows(x, SR); best, bs = 1e9, 0
        for st in starts:
            seg = r1[st // SR: st // SR + int(L) + 4]
            if len(seg) < 2: continue
            v = np.std(20 * np.log10(seg + 1e-9)); 
            if v < best: best, bs = v, st
        s = bs
    s = max(int(2 * SR), s) if s + win + 4 * SR + 2 * SR < len(x) else s   # skip the first 2 s (handling noise)
    return x[s:s + win + 4 * SR]
def loop(x, L, xf=4.0):
    n, f = int(L * SR), int(xf * SR)
    body = x[:n].copy(); tail = x[n:n + f]
    t = np.linspace(0, 1, f)[:, None]
    body[:f] = body[:f] * np.sqrt(t) + tail * np.sqrt(1 - t)   # equal-power: head fades in under the old tail
    return body
src, out, layers = sys.argv[1], sys.argv[2], json.load(open(sys.argv[3])); os.makedirs(out, exist_ok=True)
report = {}
for name, cfg in layers.items():
    x = decode(os.path.join(src, cfg['src']), cfg.get('mono', True))
    L = min(cfg.get('len', 60), len(x) / SR - 5)
    y = loop(choose(x, L, cfg.get('pick', 'steady')), L)
    tmp = f'/tmp/amb-{name}.wav'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(y.shape[1]), '-i', '-', tmp], input=y.astype(np.float32).tobytes(), check=True)
    af = []
    if cfg.get('highpass'): af.append(f"highpass=f={cfg['highpass']}")
    if cfg.get('lowpass'): af.append(f"lowpass=f={cfg['lowpass']},lowpass=f={cfg['lowpass']}")
    if cfg.get('limit'): af.append('alimiter=limit=0.35:attack=5:release=80:level=false')   # tame transients (clacks, bells) so the bed can reach target loudness
    af.append(f"loudnorm=I={cfg.get('lufs', -24)}:TP=-3:LRA=11:linear=true")
    dst = os.path.join(out, f'{name}.mp3')
    # two-pass-ish: measure after filtering, then apply linear gain to hit the target
    meas = subprocess.run(['ffmpeg', '-hide_banner', '-i', tmp, '-af', ','.join(af[:-1] + [f"loudnorm=I={cfg.get('lufs', -24)}:TP=-3:print_format=json"]), '-f', 'null', '-'], capture_output=True, text=True).stderr
    j = json.loads(meas[meas.rfind('{'):meas.rfind('}') + 1])
    gain = cfg.get('lufs', -24) - float(j['input_i'])
    gain = min(gain, -3 - float(j['input_tp']))   # never push true peak above -3 dBTP
    chain = ','.join(af[:-1] + [f'volume={gain:.2f}dB'])
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-af', chain, '-c:a', 'libmp3lame', '-ac', '1', '-b:a', '96k', dst], check=True)  # mono: iOS decodes every layer to PCM; stereo ambience doubles memory
    # QA on the encoded file: loudness, true peak, seam jump
    q = subprocess.run(['ffmpeg', '-hide_banner', '-i', dst, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
    I = float(q.rsplit('I:', 1)[1].split('LUFS')[0]); TP = float(q.rsplit('Peak:', 1)[1].split('dBFS')[0])
    z = decode(dst, True)[:, 0]; k = int(0.5 * SR)   # 0.5 s RMS either side of the wrap point
    seam = 20 * np.log10((np.sqrt((z[-k:] ** 2).mean()) + 1e-9) / (np.sqrt((z[:k] ** 2).mean()) + 1e-9))
    clip = int((np.abs(z) >= 0.999).sum())
    report[name] = {'src': cfg['src'], 'seconds': round(len(z) / SR, 1), 'lufs': round(I, 1), 'true_peak_dbfs': round(TP, 1), 'seam_level_jump_db': round(float(seam), 2), 'clipped_samples': clip, 'lowpass': cfg.get('lowpass', 0)}
    print(name, report[name], flush=True)
json.dump(report, open(os.path.join(out, 'qa-report.json'), 'w'), indent=1)
