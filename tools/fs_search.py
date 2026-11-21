import re, sys, urllib.request, urllib.parse, html
def search(q, mind=40):
    url = 'https://freesound.org/search/?' + urllib.parse.urlencode({'q': q, 'f': 'license:"Creative Commons 0"', 's': 'Downloads (most first)'})
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    t = urllib.request.urlopen(req, timeout=30).read().decode('utf8', 'replace')
    out = []
    for m in re.finditer(r'data-sound-id="(\d+)"\s+data-username="([^"]+)".*?data-mp3="([^"]+)".*?data-title="([^"]*)"\s+data-duration="([\d.]+)".*?data-num-downloads="(\d+)"', t, re.S):
        sid, user, mp3, title, dur, dl = m.groups()
        if float(dur) >= mind: out.append((sid, user, html.unescape(title)[:60], round(float(dur)), int(dl), mp3.replace('-lq.mp3', '-hq.mp3')))
    return out
for q in sys.argv[1:]:
    print('##', q)
    for r in search(q)[:7]: print(' ', *r, sep=' | ')
