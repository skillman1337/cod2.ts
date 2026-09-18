"""Extract third-person player character bodies, heads, helmets, materials, and animations."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

from pathlib import Path
import json, zipfile
from lib.retail_model import ModelDecoder
from lib.retail_xanim import decode_xanim
from lib.retail_material import material_definition
from lib.retail_paths import MAIN, DLL

root = _PROJECT_ROOT
dest = root / 'public/characters'
dest.mkdir(parents=True, exist_ok=True)

from lib.asset_io import index_iwds, read_iwd, save_json
from lib.retail_texture import decode_rgba_image

entries = index_iwds(MAIN)

def read(name):
    return read_iwd(entries, name)

image = decode_rgba_image

decoder = ModelDecoder(DLL, read)

# Character sets to extract
characters = {
    'american': {
        'body': 'playerbody_american_normandy01',
        'head': 'head_us_ranger_braeburn',
        'helmet': 'helmet_us_ranger_generic'
    },
    'british': {
        'body': 'playerbody_british_africa01',
        'head': 'head_british_boon',
        'helmet': 'helmet_british_afrca'
    },
    'german': {
        'body': 'playerbody_german_normandy01',
        'head': 'head_german_normandy_christoph',
        'helmet': 'helmet_german_normandy'
    }
}

target_models = set(['weapon_m1carbine'])
for char_def in characters.values():
    target_models.add(char_def['body'])
    target_models.add(char_def['head'])
    if char_def.get('helmet'):
        target_models.add(char_def['helmet'])

# Target animations
target_anims = [
    'pb_stand_alert',
    'pb_stand_ads',
    'pb_crouch_ads',
    'pb_combatrun_forward_loop',
    'pb_combatrun_back_loop',
    'pb_combatrun_left_loop',
    'pb_combatrun_right_loop',
    'pb_crouch_alert',
    'pb_crouch_run_forward',
    'pb_crouch_run_back',
    'pb_crouch_run_left',
    'pb_crouch_run_right',
    'pb_prone_aim',
    'pb_prone_crawl',
    'pb_prone_crawl_back',
    'pb_prone_crawl_left',
    'pb_prone_crawl_right',
    'pb_climbup',
    'pb_climbdown',
    'pb_standjump_takeoff',
    'pb_standjump_land',
    'pb_runjump_takeoff',
    'pb_runjump_land',
    'pb_stand_shoot_walk_forward',
    'pb_stand_shoot_walk_back',
    'pb_stand_shoot_walk_left',
    'pb_stand_shoot_walk_right',
    'pb_crouch_shoot_run_forward',
    'pb_crouch_shoot_run_back',
    'pb_crouch_shoot_run_left',
    'pb_crouch_shoot_run_right',
    'pt_stand_shoot',
    'pt_stand_shoot_ads',
    'pt_crouch_shoot',
    'pt_crouch_shoot_ads',
    'pt_stand_shoot_auto',
    'pt_stand_shoot_auto_ads',
    'pt_crouch_shoot_auto',
    'pt_crouch_shoot_auto_ads',
    'pt_reload_stand_auto',
    'pt_reload_stand_rifle',
    'pt_reload_crouch_rifle',
    'pt_rifle_fire',
    'pt_rifle_fire_ads',
    'pt_prone_shoot',
    'pt_prone_shoot_auto',
    'pt_rifle_fire_prone',
    'pt_reload_prone_auto',
    'pt_reload_prone_rifle'
]

materials = {}

print('Extracting models and textures...')
for model_name in sorted(target_models):
    print(f'  Model: {model_name}')
    model = decoder.load(model_name)
    for surface in model['surfaces']:
        mat = surface['material']
        if mat not in materials:
            mat_raw = read(f'materials/{mat}')
            definition = material_definition(mat_raw)
            color = definition['bindings'].get('colorMap', {}).get('image')
            if color:
                target_img = dest / 'textures' / f'{mat}.png'
                target_img.parent.mkdir(parents=True, exist_ok=True)
                try:
                    img_data = read(f'images/{color}.iwi')
                    image(img_data).save(target_img)
                    materials[mat] = dict(file=f'textures/{mat}.png', definition=definition)
                except Exception as e:
                    print(f'    Warning: failed to extract texture for {mat} ({color}): {e}')
                    materials[mat] = dict(file=None, definition=definition)
            else:
                materials[mat] = dict(file=None, definition=definition)
    save_json(dest / 'models' / f'{model_name}.json', model)

print('Extracting animations...')
for anim_name in sorted(target_anims):
    print(f'  Animation: {anim_name}')
    anim_data = read(f'xanim/{anim_name}')
    decoded = decode_xanim(anim_data)
    save_json(dest / 'animations' / f'{anim_name}.json', decoded)

catalog = {
    'characters': characters,
    'default': 'american',
    'animations': {
        'stand_idle': 'pb_stand_alert',
        'stand_ads': 'pb_stand_ads',
        'run_forward': 'pb_combatrun_forward_loop',
        'run_back': 'pb_combatrun_back_loop',
        'run_left': 'pb_combatrun_left_loop',
        'run_right': 'pb_combatrun_right_loop',
        'crouch_idle': 'pb_crouch_alert',
        'crouch_ads': 'pb_crouch_ads',
        'crouch_forward': 'pb_crouch_run_forward',
        'crouch_back': 'pb_crouch_run_back',
        'crouch_left': 'pb_crouch_run_left',
        'crouch_right': 'pb_crouch_run_right',
        'prone_idle': 'pb_prone_aim',
        'prone_forward': 'pb_prone_crawl',
        'prone_back': 'pb_prone_crawl_back',
        'prone_left': 'pb_prone_crawl_left',
        'prone_right': 'pb_prone_crawl_right',
        'ladder_up': 'pb_climbup',
        'ladder_down': 'pb_climbdown',
        'jump_stand': 'pb_standjump_takeoff',
        'jump_run': 'pb_runjump_takeoff',
        'land_stand': 'pb_standjump_land',
        'land_run': 'pb_runjump_land',
        'walk_forward': 'pb_stand_shoot_walk_forward',
        'walk_back': 'pb_stand_shoot_walk_back',
        'walk_left': 'pb_stand_shoot_walk_left',
        'walk_right': 'pb_stand_shoot_walk_right',
        'crouch_walk_forward': 'pb_crouch_shoot_run_forward',
        'crouch_walk_back': 'pb_crouch_shoot_run_back',
        'crouch_walk_left': 'pb_crouch_shoot_run_left',
        'crouch_walk_right': 'pb_crouch_shoot_run_right',
        'fire_stand': 'pt_stand_shoot',
        'fire_stand_ads': 'pt_stand_shoot_ads',
        'fire_crouch': 'pt_crouch_shoot',
        'fire_crouch_ads': 'pt_crouch_shoot_ads',
        'fire_auto': 'pt_stand_shoot_auto',
        'fire_auto_ads': 'pt_stand_shoot_auto_ads',
        'fire_crouch_auto': 'pt_crouch_shoot_auto',
        'fire_crouch_auto_ads': 'pt_crouch_shoot_auto_ads',
        'fire_rifle': 'pt_rifle_fire',
        'fire_rifle_ads': 'pt_rifle_fire_ads',
        'reload_stand_auto': 'pt_reload_stand_auto',
        'reload_stand_rifle': 'pt_reload_stand_rifle',
        'reload_crouch_rifle': 'pt_reload_crouch_rifle',
        'fire_prone': 'pt_prone_shoot',
        'fire_prone_auto': 'pt_prone_shoot_auto',
        'fire_prone_rifle': 'pt_rifle_fire_prone',
        'reload_prone_auto': 'pt_reload_prone_auto',
        'reload_prone_rifle': 'pt_reload_prone_rifle'
    },
    'materials': materials
}

save_json(dest / 'catalog.json', catalog)
print(f'Export complete: {len(target_models)} models, {len(target_anims)} animations, {len(materials)} materials into {dest}')
