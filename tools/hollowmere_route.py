"""Additional stops on the two-hour Hollowmere route."""
def extend_route(manifest):
    legs = {leg['id']: leg for leg in manifest['legs']}
    legs['mountains']['arrivalMusicIndex'] = 2
    for zone, after, slug, title, middle, rain, snow, sounds in VIEWS:
        views = legs[zone]['segments']
        index = next(i for i, view in enumerate(views) if view['id'] == after)
        views.insert(index + 1, {
            'id': slug, 'title': title, 'backdrop': f'zones/{zone}/{slug}.webp',
            'mid': f'zones/{middle}.webp', 'paintedStrips': True, 'panBackdrop': True,
            'weather': {'rain': rain, 'snow': snow},
            'ambience': [{'layer': name, 'gain': gain} for name, gain in sounds],
        })
    # A dry interval before the boathouse makes the return of rain audible.
    open_lake = next(view for view in legs['lake']['segments'] if view['id'] == 'l2')
    open_lake['weather']['rain'] = 0
    open_lake['ambience'].append({'layer': 'rain_glass', 'gain': 0})

    panoramas = {
        'l3': 'lake/boathouse-shore', 'l4': 'lake/stone-arch',
        'f2': 'forest/ice-falls', 'f3': 'forest/woodcutters-clearing',
    }
    for leg in legs.values():
        for view in leg['segments']:
            if view['id'] in panoramas:
                view['backdrop'] = 'zones/' + panoramas[view['id']] + '.webp'
                view.pop('landmark', None)  # The subject is in the photographed landscape.
            elif view['id'] == 'c2':
                view['backdrop'] = 'zones/city/b2.jpg'
            elif view['id'] == 'c3':
                view['backdrop'] = 'zones/city/docks-bg.webp'

    refine_platforms_and_terrain(manifest)
    integrate_landmarks(manifest)


def refine_platforms_and_terrain(manifest):
    manifest['version'] = 8
    manifest['breakText'][1] = 'Let your eyes rest on the platform for a moment.'
    for station in manifest['stations'][1:-1]:
        station.pop('loop', None)
        station.pop('loopDur', None)
        station['still'] = f"stills/platform-{station['id']}.webp"
        station['ambience'] = [s for s in station['ambience']
                               if not s['layer'].startswith(('station_walla', 'luggage'))]
    forest, mountains = manifest['legs'][2:]
    forest['near'] = 'zones/forest/winter-bank.webp'
    for view in mountains['segments']:
        # The photographic plates already include the true ridge and village skyline.
        # The second rocky silhouette cut across their buildings and the viaduct.
        view.pop('mid', None)
        if view['id'] in ('m4', 'college-road', 'lamplit-cottages'):
            view['near'] = forest['near']


def integrate_landmarks(manifest):
    manifest['version'] = 10
    manifest['render']['crossings']['baileyWall'] = 'zones/city/bailey-wall.webp'
    for view in manifest['legs'][0]['segments']:
        if view['id'] == 'wealthy-quarter':
            view['exitCut'] = 'baileyWall'
    manifest['render']['stationApproaches'] = {
        s['id']: f"stills/approach-{s['id']}.webp" for s in manifest['stations']
    }
    manifest['render']['glassReflection'] = 'frame/sconce-reflection.webp'
    plates = {'c2': 'clocktower-roofs', 'l2': 'abbey-shore',
              'f4': 'chapel-wood', 'm1': 'ravine-viaduct', 'm3': 'monastery-ledge',
              'm4': 'valley-approach'}
    for leg in manifest['legs']:
        for view in leg['segments']:
            if view['id'] in plates:
                view['backdrop'] = f"zones/{leg['id']}/{plates[view['id']]}.webp"
                view.pop('landmark', None)
                view.pop('mid', None)


VIEWS = [
    ('city', 'wealthy-quarter', 'castle-green', 'The castle green', 'city/m1', 0, 0, [('bells', 0.2)]),
    ('city', 'c2', 'public-park', 'The public gardens', 'lake/m1', 0, 0, [('city', 0.18)]),
    ('city', 'c3', 'covered-market', 'The covered market', 'city/verge', 0.13, 0, [('city', 0.8)]),
    ('city', 'covered-market', 'back-lanes', 'The back lanes', 'city/m1', 0.18, 0, [('city', 0.35)]),
    ('lake', 'l1', 'rain-squall', 'Rain crossing Wrenmere', 'lake/m1', 0.97, 0, [('rain_glass', 0.9), ('lake_lap', 0.35)]),
    ('lake', 'l4', 'forest-edge', 'The sheltered forest shore', 'lake/m3', 0, 0, [('rain_glass', 0), ('forest_wind', 0.4), ('lake_lap', 0.35)]),
    ('forest', 'f1', 'pine-cutting', 'The pine cutting', 'forest/m2', 0, 0.09, [('forest_wind', 0.45)]),
    ('forest', 'f4', 'upland-firs', 'Firs at the snow line', 'forest/m1', 0, 0.52, [('wind_high', 0.48)]),
    ('mountains', 'm3', 'ridge-clearing', 'The storm breaks', 'mountains/m2', 0, 0.3, [('wind_high', 0.7)]),
    ('mountains', 'm4', 'college-road', 'College Road at dusk', 'forest/m1', 0, 0.17, [('wind_high', 0.18), ('bells', 0.22)]),
    ('mountains', 'college-road', 'lamplit-cottages', 'The lamplit university village', 'city/verge', 0, 0.07, [('wind_high', 0.12), ('bells', 0.3)]),
]
