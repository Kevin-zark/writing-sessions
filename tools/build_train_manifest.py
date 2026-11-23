#!/usr/bin/env python3
"""Builds themes/dark-academia-train/manifest.json (schema 3: procedural window) from the shot list below.
Station loop durations are read from the encoded files."""
import json, subprocess, os
T = os.path.join(os.path.dirname(__file__), '..', 'themes', 'dark-academia-train')
def dur(p): return round(float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', os.path.join(T, p)], capture_output=True, text=True).stdout), 3)
A = 'fullslopstudios (Suno)'
def L(name, g): return {'layer': name, 'gain': g}
def trk(title, slug): return [{'title': title, 'src': f'audio/{slug}-a.mp3', 'artist': A}, {'title': f'{title} (II)', 'src': f'audio/{slug}-b.mp3', 'artist': A}]
stations = [
 ('s0', 'Ravensgate Terminus', [L('station_walla', .8), L('luggage', .6), L('city', .3)]),
 ('s1', 'Greyfriars Road', [L('station_walla', .55), L('luggage', .5), L('city', .35)]),
 ('s2', 'Wrenmere Halt', [L('station_walla', .45), L('luggage', .45), L('rain_glass', .8)]),
 ('s3', 'Pinehollow', [L('station_walla', .45), L('luggage', .5), L('forest_wind', .5)]),
 ('s4', 'Hollowmere University', [L('station_walla', .7), L('luggage', .5), L('bells', .35), L('forest_wind', .3)]),
]
# Each leg = a "cruise" through one zone: segments are continuously-moving parallax views (backdrop b#, mid layer m#, shared near layer),
# each with ONE landmark that slides past once (lm#) or the procedural tunnel. (id, title, backdrop, mid, landmark, ambience, weather, at)
LEGS = [
 dict(id='city', title='The misty city', zone='city', speed=1.0, fog={'color': '#aab4c4', 'far': .34, 'near': .26}, amb=[L('train', 1.0), L('city', .55)], music=trk('Letters by Lamplight', 'letters-by-lamplight'),
      segs=[('c1', 'Rooftops in the fog · the cathedral', 'b1', 'm1', 'lm1', [L('bells', .6)], {'rain': .12}, .5),
            ('c2', 'The old clock tower', 'b2', 'm2', 'lm2', [L('city', .4)], {'rain': .18}, .6),
            ('c3', 'The iron bridge', 'b2', 'm3', 'lm3', [L('city', .7), L('stream', .2)], {'rain': .22}, .45),
            ('c4', 'The gasworks · the outskirts', 'b3', 'm3', 'lm4', [L('city', .3)], {'rain': .15}, .6)]),
 dict(id='lake', title='Wrenmere Lake in the rain', zone='lake', speed=1.0, fog={'color': '#9fabb6', 'far': .4, 'near': .3}, amb=[L('train', 1.0), L('rain_glass', .7)], music=trk('Rain over Wrenmere Lake', 'rain-over-wrenmere-lake'),
      segs=[('l1', 'Birches by the water · the lighthouse', 'b1', 'm1', 'lm1', [], {'rain': .7}, .5),
            ('l2', 'The open lake · the ruined abbey', 'b2', 'm2', 'lm2', [L('lake_lap', .35)], {'rain': .8}, .6),
            ('l3', 'The old boathouse', 'b2', 'm3', 'lm3', [L('lake_lap', .7)], {'rain': .85}, .45),
            ('l4', 'The stone arch · the far shore', 'b3', 'm3', 'lm4', [L('lake_lap', .4), L('forest_wind', .3)], {'rain': .6}, .6)]),
 dict(id='forest', title='The snow-hushed forest', zone='forest', speed=.8, fog={'color': '#c9d4e6', 'far': .3, 'near': .22}, amb=[L('train_soft', 1.0), L('forest_wind', .5)], music=trk('Snowbound Compartment', 'snowbound-compartment'),
      segs=[('f1', 'Snow-laden pines · the ruined keep', 'b1', 'm1', 'lm1', [], {'snow': .6}, .5),
            ('f2', 'The frozen waterfall', 'b2', 'm2', 'lm3', [L('stream', .6)], {'snow': .7}, .55),
            ('f3', "The woodcutter's cabin", 'b2', 'm3', 'lm2', [], {'snow': .75}, .45),
            ('f4', 'The chapel · the mountains rise', 'b3', 'm3', 'lm4', [L('wind_high', .35)], {'snow': .55}, .6)]),
 dict(id='mountains', title='The high passes', zone='mountains', speed=.9, fog={'color': '#bac6d8', 'far': .34, 'near': .28}, amb=[L('train', 1.0), L('wind_high', .6)],
      music=trk('The High Pass', 'the-high-pass') + trk('Arrival at Hollowmere', 'arrival-at-hollowmere'),
      segs=[('m1', 'The climb · the viaduct', 'b1', 'm1', 'lm1', [L('wind_high', .9)], {'snow': .4}, .5),
            ('m2', 'The tunnel', 'b2', 'm2', 'tunnel', [L('wind_high', .5)], {'snow': .8}, .5),
            ('m3', 'Blizzard on the pass · the monastery', 'b2', 'm3', 'lm3', [L('blizzard', .9), L('window_whistle', .7), L('wind_high', .3)], {'snow': .95}, .5),
            ('m4', 'Hollowmere in the valley · the observatory', 'b3', 'm3', 'lm4', [L('wind_high', .3), L('bells', .2)], {'snow': .3}, .55)]),
]
LM = {l.split()[0] + ' ' + l.split()[1]: (int(l.split()[2]), int(l.split()[3])) for l in open(os.path.join(os.path.dirname(__file__), 'train_landmarks.txt'))}
lib = json.load(open(os.path.join(T, 'audio', 'amb', 'qa-report.json')))
SRC = {
 '133099': ('Steam Train Interior', 'allh'), '427841': ('Ambience City Quiet Night Air Tone', 'leonelmail'), '413157': ('Bells french distant', 'lazymonk'),
 '235827': ('Soft rain on roof window', 'Metadex'), '614299': ('Gentle waves on a lake', 'TheFlyFishingFilmmaker'), '352436': ('Forest, Winter, Light Wind', 'Kinoton'),
 '318064': ('Water_Lapping_River', 'ceich93'), '117513': ('winter wind 01c', 'klangfabrik'), '69512': ('Winter wind whistling through window', 'audible-edge'),
 '475500': ('Train_tunnel_1', 'o_ciz'), '256626': ('EustonStation_ST', 'habbis92'), '275173': ('Luggage_rolling4', 'schaft')}
DESC = {'train': 'Carriage rumble + wheel clatter, mid-boosted so phone speakers can reproduce it (moving legs)', 'train_soft': 'Same carriage, low-passed: wheels muffled by snow', 'city': 'Distant city hum through glass',
 'bells': 'Distant church bells', 'rain_glass': 'Light rain on the window', 'lake_lap': 'Lake water lapping, heard through glass', 'forest_wind': 'Soft wind in winter pines',
 'stream': 'Running water under ice / below the bridge', 'wind_high': 'Mountain wind', 'blizzard': 'Howling blizzard gusts', 'window_whistle': 'Wind whistling through the window frame',
 'tunnel': 'Enclosed tunnel roar (pressure change)', 'station_walla': 'Station hall voices + footsteps, muffled through glass', 'luggage': 'Luggage wheels and handling, muffled'}
ambLib, credits = {}, []
for k, r in lib.items():
    sid = r['src'].split('-')[0]
    ambLib[k] = {'src': f'audio/amb/{k}.mp3', 'gain': 1.4 if k == 'lake_lap' else 1.0, 'title': DESC[k], 'sourceId': sid,
                 'qa': {kk: r[kk] for kk in ('seconds', 'lufs', 'true_peak_dbfs', 'seam_level_jump_db', 'clipped_samples')}}
for sid, (title, user) in SRC.items():
    credits.append({'kind': 'ambience', 'title': title, 'author': user, 'url': f'https://freesound.org/s/{sid}/', 'license': 'CC0 1.0', 'licenseUrl': 'https://creativecommons.org/publicdomain/zero/1.0/',
                    'usedAs': sorted(k for k, v in ambLib.items() if v['sourceId'] == sid)})
m = {
 'schema': 3, 'id': 'dark-academia-train', 'title': 'Dark Academia Train to Hollowmere',
 'description': 'A candlelit compartment on a two-hour journey: a misty city, a rain-grey lake, a snow-hushed forest and the high mountain passes, arriving at Hollowmere University.',
 'cover': 'stills/cover.jpg', 'accent': '#d9b26f',
 'status': 'published', 'owner': 'kevin', 'origin': {'type': 'owner', 'requestId': None, 'requestedBy': None},
 'createdAt': '2026-11-21', 'version': 3,
 'designedFor': {'sprintMin': 25, 'breakMin': 5, 'sprints': 4, 'intro': True, 'outro': True},
 'render': {'type': 'window', 'sway': False, 'bridge': 'zones/city/dock-bridge.webp', 'objectPosition': '50% 50%', 'size': [1280, 720], 'frame': {'src': 'frame/overlay.png', 'pane': json.load(open(os.path.join(T, 'frame', 'pane.json')))}},
 'style': {'camera': 'Seated eye level, locked off, one centered window filling the middle ~70% of a 16:9 frame', 'interior': 'Dark mahogany panels, bottle-green velvet curtains tied back at both edges, brass sconce upper left, leather book + teacup on the ledge',
           'palette': 'Warm amber interior vs cool desaturated exterior', 'lens': '35mm, light film grain, painterly cinematic realism', 'motion': 'Exterior is procedural parallax behind the frame: always moving, landmarks slide past once', 'reference': 'stills/master reference kept in the theme workspace'},
 'ambienceLib': ambLib,
 'stations': [{'id': sid, 'title': t, 'loop': f'clips/loop-{sid}.mp4', 'loopDur': dur(f'clips/loop-{sid}.mp4'), 'still': f'stills/{sid}.jpg', 'ambience': amb} for sid, t, amb in stations],
 'legs': [], 'credits': credits,
 'intro': {'lines': ['Welcome, Writers...', 'Find your seat. Open your story.', 'The train to Hollowmere departs soon.']},
 'breakText': ['The train pauses at the platform. Stretch. Sip something warm.', 'Let the ideas settle while passengers come and go.', 'Breathe. The story will wait.'],
 'breakEndText': 'All aboard — the next sprint begins soon...',
 'outro': {'lines': ['Hollowmere, at last.', 'Beautiful work, my friend!', 'Until the next journey.']},
}
for li, g in enumerate(LEGS):
    a, b = stations[li][0], stations[li + 1][0]; z = g['zone']; segs = []
    if z == 'city':
        segs.append({'id': 'industrial-docks', 'title': 'Ravensgate industrial docks', 'backdrop': 'zones/city/docks-bg.webp', 'mid': 'zones/city/docks-mid.webp', 'near': 'zones/city/docks-fg.webp', 'paintedStrips': True, 'exitCut': 'bridge', 'introViewSeconds': 60, 'fog': {'color': '#879ba3', 'far': 0.46, 'near': 0.3}})
    for sid, st, bd, md, lm, amb, wx, at in g['segs']:
        if lm == 'tunnel': L_ = {'type': 'tunnel', 'dur': 24, 'at': at, 'ambience': [L('tunnel', .9), L('wind_high', 0), L('train', .6)]}   # extra layers only while the tunnel passes
        else: w, h = LM[f'{z} {lm}']; L_ = {'src': f'zones/{z}/{lm}.jpg', 'w': w, 'h': h, 'dur': 26, 'at': at, 'height': .85, 'base': .95}
        segs.append({'id': sid, 'title': st, 'backdrop': f'zones/{z}/{bd}.jpg', 'mid': f'zones/{z}/{md}.jpg', 'weather': wx, 'ambience': amb, 'landmark': L_})
    m['legs'].append({'id': g['id'], 'title': g['title'], 'from': a, 'to': b, 'ambience': g['amb'], 'music': g['music'], 'speed': g['speed'],
                      'near': f'zones/{z}/near.jpg', 'fog': g['fog'], 'segments': segs})
m['credits'] = [{'kind': 'music', 'title': t['title'], 'author': A, 'license': "Generated in Kevin's Suno Pro account (commercial use per Suno Pro terms)"} for l in m['legs'] for t in l['music']] + credits
json.dump(m, open(os.path.join(T, 'manifest.json'), 'w'), indent=1, ensure_ascii=False)
print('manifest written')
