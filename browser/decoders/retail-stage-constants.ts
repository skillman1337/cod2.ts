/*
===============================================================================

	retail-stage-constants.ts

	Format constants and explicit engine semantic animation bindings.

===============================================================================
*/

export const CONTENTS_SOLID_OR_OPAQUE   = 0x2001;
export const PROBE_INDEX_MASK           = 0x3fff;
export const STATIC_MODEL_FLAG          = 0x4000;
export const LIGHTMAP_BLOCK_SIZE        = 0x400000;
export const LIGHTMAP_CHANNEL_SIZE      = 0x100000;
export const SUNMAP_OFFSET_IN_BLOCK     = 0x300000;
export const SUNMAP_CHANNEL_SIZE        = 0x100000;
export const LIGHTMAP_TEXTURE_DIMENSION = 512;
export const SUNMAP_TEXTURE_DIMENSION   = 1024;
export const PNG_CACHE_CAPACITY_BYTES   = 48 * 1024 * 1024; // 48 MB byte cache for encoded raster PNG surfaces

export const BASE_UI_MATERIALS = [
	'gamefonts',
	'3_cursor3',
	'background_american_w',
] as const;

export const BASE_UI_AUDIO_CUES = [
	'sound/music/menu_GRTEMP.mp3',
	'sound/misc/mouse_ylover.wav',
	'sound/misc/mouse_ylselect.wav',
] as const;

export const POPUP_BACKGROUND_IMAGES = [
	'popups_alpha',
	'popups_goldline',
] as const;

export const STANDARD_UI_WIDGET_MATERIALS = [
	'ui/assets/slider2.tga',
	'ui/assets/sliderbutt_1',
	'ui/assets/scrollbar.tga',
	'ui/assets/scrollbar_arrow_up_a.tga',
	'ui/assets/scrollbar_arrow_dwn_a.tga',
	'ui/assets/scrollbar_thumb.tga',
	'popmenu_bg',
	'popmenu_goldline',
	'white',
	'hint_mantle',
	'stance_stand',
	'stance_crouch',
	'stance_prone',
	'stance_flash',
] as const;



export const CHARACTER_ANIMATION_MAPPINGS: Readonly<Record<string, string>> = Object.freeze( {
	stand_idle: 'pb_stand_alert',
	stand_ads: 'pb_stand_ads',
	run_forward: 'pb_combatrun_forward_loop',
	run_back: 'pb_combatrun_back_loop',
	run_left: 'pb_combatrun_left_loop',
	run_right: 'pb_combatrun_right_loop',
	crouch_idle: 'pb_crouch_alert',
	crouch_ads: 'pb_crouch_ads',
	crouch_forward: 'pb_crouch_run_forward',
	crouch_back: 'pb_crouch_run_back',
	crouch_left: 'pb_crouch_run_left',
	crouch_right: 'pb_crouch_run_right',
	prone_idle: 'pb_prone_aim',
	prone_forward: 'pb_prone_crawl',
	prone_back: 'pb_prone_crawl_back',
	prone_left: 'pb_prone_crawl_left',
	prone_right: 'pb_prone_crawl_right',
	ladder_up: 'pb_climbup',
	ladder_down: 'pb_climbdown',
	jump_stand: 'pb_standjump_takeoff',
	jump_run: 'pb_runjump_takeoff',
	land_stand: 'pb_standjump_land',
	land_run: 'pb_runjump_land',
	walk_forward: 'pb_stand_shoot_walk_forward',
	walk_back: 'pb_stand_shoot_walk_back',
	walk_left: 'pb_stand_shoot_walk_left',
	walk_right: 'pb_stand_shoot_walk_right',
	crouch_walk_forward: 'pb_crouch_shoot_run_forward',
	crouch_walk_back: 'pb_crouch_shoot_run_back',
	crouch_walk_left: 'pb_crouch_shoot_run_left',
	crouch_walk_right: 'pb_crouch_shoot_run_right',
	fire_stand: 'pt_stand_shoot',
	fire_stand_ads: 'pt_stand_shoot_ads',
	fire_crouch: 'pt_crouch_shoot',
	fire_crouch_ads: 'pt_crouch_shoot_ads',
	fire_auto: 'pt_stand_shoot_auto',
	fire_auto_ads: 'pt_stand_shoot_auto_ads',
	fire_crouch_auto: 'pt_crouch_shoot_auto',
	fire_crouch_auto_ads: 'pt_crouch_shoot_auto_ads',
	fire_rifle: 'pt_rifle_fire',
	fire_rifle_ads: 'pt_rifle_fire_ads',
	reload_stand_auto: 'pt_reload_stand_auto',
	reload_stand_rifle: 'pt_reload_stand_rifle',
	reload_crouch_rifle: 'pt_reload_crouch_rifle',
	fire_prone: 'pt_prone_shoot',
	fire_prone_auto: 'pt_prone_shoot_auto',
	fire_prone_rifle: 'pt_rifle_fire_prone',
	reload_prone_auto: 'pt_reload_prone_auto',
	reload_prone_rifle: 'pt_reload_prone_rifle',
} );


