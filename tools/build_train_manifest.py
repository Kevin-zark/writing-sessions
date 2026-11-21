#!/usr/bin/env python3
"""Builds themes/dark-academia-train/manifest.json (schema 2) from the shot list below.
Clip durations are read from the encoded files so the planner knows real bridge lengths."""
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
legs = [
 ('city', 'The misty city', 'c', [L('train', .6), L('city', .55)], trk('Letters by Lamplight', 'letters-by-lamplight'), [
   ('Rooftops in the fog', []), ('The cathedral', [L('bells', .6)]), ('The iron bridge', [L('city', .7), L('stream', .2)]),
   ('Terraced lanes', []), ('The old clock mill', [L('city', .4)]), ('The outskirts', [L('city', .3)])]),
 ('lake', 'Wrenmere Lake in the rain', 'l', [L('train', .55), L('rain_glass', .7)], trk('Rain over Wrenmere Lake', 'rain-over-wrenmere-lake'), [
   ('Birches by the water', []), ('The open lake', [L('lake_lap', .35)]), ('The old jetty', [L('lake_lap', .7)]),
   ('The shore chapel', [L('lake_lap', .4)]), ('The causeway', [L('lake_lap', .8)]), ('Sleet at the far shore', [L('rain_glass', .45), L('forest_wind', .45)])]),
 ('forest', 'The snow-hushed forest', 'f', [L('train_soft', .75), L('forest_wind', .5)], trk('Snowbound Compartment', 'snowbound-compartment'), [
   ('Snow-laden pines', []), ('Light through the firs', [L('forest_wind', .35)]), ('The frozen stream', [L('stream', .7)]),
   ('The deer clearing', []), ("The woodcutter's cabin", []), ('The mountains rise', [L('wind_high', .35)])]),
 ('mountains', 'The high passes', 'm', [L('train', .55), L('wind_high', .6)], trk('The High Pass', 'the-high-pass') + trk('Arrival at Hollowmere', 'arrival-at-hollowmere'), [
   ('The climb', [L('wind_high', .8)]), ('The viaduct', [L('wind_high', .9)]), ('The tunnel', [L('tunnel', .9), L('wind_high', 0), L('train', .3)]),
   ('Blizzard on the pass', [L('blizzard', .9), L('window_whistle', .7), L('wind_high', .3)]), ('The frozen falls', [L('wind_high', .35)]),
   ('Hollowmere in the valley', [L('wind_high', .3), L('bells', .2)])]),
]
lib = json.load(open(os.path.join(T, 'audio', 'amb', 'qa-report.json')))
SRC = {
 '133099': ('Steam Train Interior', 'allh'), '427841': ('Ambience City Quiet Night Air Tone', 'leonelmail'), '413157': ('Bells french distant', 'lazymonk'),
 '235827': ('Soft rain on roof window', 'Metadex'), '614299': ('Gentle waves on a lake', 'TheFlyFishingFilmmaker'), '352436': ('Forest, Winter, Light Wind', 'Kinoton'),
 '318064': ('Water_Lapping_River', 'ceich93'), '117513': ('winter wind 01c', 'klangfabrik'), '69512': ('Winter wind whistling through window', 'audible-edge'),
 '475500': ('Train_tunnel_1', 'o_ciz'), '256626': ('EustonStation_ST', 'habbis92'), '275173': ('Luggage_rolling4', 'schaft')}
DESC = {'train': 'Carriage rumble + wheel clatter (moving legs)', 'train_soft': 'Same carriage, low-passed: wheels muffled by snow', 'city': 'Distant city hum through glass',
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
 'schema': 2, 'id': 'dark-academia-train', 'title': 'Dark Academia Train to Hollowmere',
 'description': 'A candlelit compartment on a two-hour journey: a misty city, a rain-grey lake, a snow-hushed forest and the high mountain passes, arriving at Hollowmere University.',
 'cover': 'stills/c2.jpg', 'accent': '#d9b26f',
 'status': 'published', 'owner': 'kevin', 'origin': {'type': 'owner', 'requestId': None, 'requestedBy': None},
 'createdAt': '2026-11-21', 'version': 2,
 'designedFor': {'sprintMin': 25, 'breakMin': 5, 'sprints': 4, 'intro': True, 'outro': True},
 'frame': {'objectPosition': '58% 45%'},
 'style': {'camera': 'Seated eye level, locked off, one centered window filling the middle ~70% of a 16:9 frame', 'interior': 'Dark mahogany panels, bottle-green velvet curtains tied back at both edges, brass sconce upper left, leather book + teacup on the ledge',
           'palette': 'Warm amber interior vs cool desaturated exterior', 'lens': '35mm, light film grain, painterly cinematic realism', 'motion': 'Exterior only; bridges slide scenery right-to-left', 'reference': 'stills/master reference kept in the theme workspace'},
 'ambienceLib': ambLib,
 'stations': [{'id': sid, 'title': t, 'loop': f'clips/loop-{sid}.mp4', 'loopDur': dur(f'clips/loop-{sid}.mp4'), 'still': f'stills/{sid}.jpg', 'ambience': amb} for sid, t, amb in stations],
 'legs': [], 'credits': credits,
 'intro': {'lines': ['Welcome, Writers...', 'Find your seat. Open your story.', 'The train to Hollowmere departs soon.']},
 'breakText': ['The train pauses at the platform. Stretch. Sip something warm.', 'Let the ideas settle while passengers come and go.', 'Breathe. The story will wait.'],
 'breakEndText': 'All aboard — the next sprint begins soon...',
 'outro': {'lines': ['Hollowmere, at last.', 'Beautiful work, my friend!', 'Until the next journey.']},
}
for li, (lid, title, p, base, music, views) in enumerate(legs):
    a, b = stations[li][0], stations[li + 1][0]
    vs = []
    for vi, (vt, amb) in enumerate(views):
        vid = f'{p}{vi + 1}'; v = {'id': vid, 'title': vt, 'loop': f'clips/loop-{vid}.mp4', 'loopDur': dur(f'clips/loop-{vid}.mp4'), 'still': f'stills/{vid}.jpg', 'ambience': amb}
        if vi < len(views) - 1: c = f'clips/br-{vid}-{p}{vi + 2}.mp4'; v['bridge'] = {'clip': c, 'dur': dur(c)}
        vs.append(v)
    dep, arr = f'clips/br-{a}-{p}1.mp4', f'clips/br-{p}{len(views)}-{b}.mp4'
    m['legs'].append({'id': lid, 'title': title, 'from': a, 'to': b, 'ambience': base, 'music': music,
                      'depart': {'clip': dep, 'dur': dur(dep)}, 'arrive': {'clip': arr, 'dur': dur(arr)}, 'views': vs})
m['credits'] = [{'kind': 'music', 'title': t['title'], 'author': A, 'license': "Generated in Kevin's Suno Pro account (commercial use per Suno Pro terms)"} for l in m['legs'] for t in l['music']] + credits
json.dump(m, open(os.path.join(T, 'manifest.json'), 'w'), indent=1, ensure_ascii=False)
n = sum(1 for _ in os.listdir(os.path.join(T, 'clips')))
print('manifest written; clips on disk:', n)
