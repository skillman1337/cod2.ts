/*
===============================================================================

	sound.ts

	WebAudio listener pose and sample playback.

===============================================================================
*/

import menuMusicUrl from '@/assets/sound/music/menu_GRTEMP.mp3?url';
import mouseOverUrl from '@/assets/sound/misc/mouse_ylover.wav?url';
import mouseClickUrl from '@/assets/sound/misc/mouse_ylselect.wav?url';

import { vec3_t } from '@/engine/common/types.js';
import { Con_DPrintf, Con_Printf } from '@/engine/common/common.js';
import { Sound_Select,Sound_Loadspec } from '@/engine/common/sound_alias.js';
import { Level_Name } from '@/engine/common/level.js';


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

interface s_listener_t {
	vieworg: vec3_t;
	forward: vec3_t;
	right: vec3_t;
	up: vec3_t;
	valid: boolean;
}


interface s_menu_music_t {
	buffer: AudioBuffer | null;
	source: AudioBufferSourceNode | null;
	gain: GainNode | null;
	load_started: boolean;
	wanted: boolean;
}


interface s_alias_sample_t {
	url: string;
	volume: number;
	buffer: AudioBuffer | null;
	load_started: boolean;
}


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** CoD2 alias music_mainmenu_mp volume (iw_06/soundaliases/iw_sound2.csv). */
const S_MENU_MUSIC_VOL = 0.35;

const S_MENU_MUSIC_URL = menuMusicUrl;

/** CoD2 default UI action / mouse sound volume. */
const S_UI_ACTION_VOL = 0.65;

/** Default master audio volume. */
const S_DEFAULT_MASTER_VOL = 0.8;

/** CoD2 iw_07/soundaliases/iw_code.csv — menu mouseEnter / action play aliases. */
const S_MENU_ALIASES: Record<string, s_alias_sample_t> = {
	mouse_over: {
		url: mouseOverUrl,
		volume: S_UI_ACTION_VOL,
		buffer: null,
		load_started: false,
	},
	mouse_click: {
		url: mouseClickUrl,
		volume: S_UI_ACTION_VOL,
		buffer: null,
		load_started: false,
	},
};


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

let s_ctx: AudioContext | null = null;
let s_master_volume = S_DEFAULT_MASTER_VOL;
let s_activated = false;
let s_ambient_catalog: {
	maps: Record<string, string>;
	aliases: Record<string, { url: string; volume: number; loop: boolean; loadspec?: string }[]>;
} | null = null;
let s_ambient_map = '';
let s_prewarm_map = '';
let s_catalog_load: Promise<void> | null = null;
let s_ambient_serial = 0;
let s_ambient_source: AudioBufferSourceNode | null = null;
let s_ambient_gain: GainNode | null = null;
let s_ambient_volume = 1;

interface movement_alias_t {
	url: string;
	volumeMin: number;
	volumeMax: number;
	pitchMin: number;
	pitchMax: number;
	probability: number;
	loadspec?: string;
	lastPlayed?: number;
}

const s_alias_random = { seed: 1 };
let s_movement_aliases: Record<string, movement_alias_t[]> = {};
const s_movement_buffers = new Map<string, Promise<AudioBuffer>>();
/**
 * @exec helper
 * ================
 * S_LoadMovementBuffer
 *
 * Load once per context; hot refresh cannot publish buffers into a new context.
 * ================
 */
function S_LoadMovementBuffer( url: string ): Promise<AudioBuffer> {
	let pending = s_movement_buffers.get( url );

	if ( !pending ) {
		const context = s_ctx!;

		pending = fetch( url )
			.then( ( r ) => {
				if ( !r.ok ) {
					throw new Error( String( r.status ) );
				}
				return r.arrayBuffer();
			} )
			.then( ( bytes ) => context.decodeAudioData( bytes ) );

		s_movement_buffers.set( url, pending );

		pending.catch( () => {
			if ( s_movement_buffers.get( url ) === pending ) {
				s_movement_buffers.delete( url );
			}
		} );
	}

	return pending;
}

/**
 * ================
 * S_PrewarmGameplay
 *
 * Warm gameplay audio only after a level is selected, never ahead of the menu.
 * ================
 */
function S_PrewarmGameplay( map: string ): void {
	const context = s_ctx;

	if ( !context || !map || s_prewarm_map === map || !Object.keys( s_movement_aliases ).length ) {
		return;
	}

	s_prewarm_map = map;
	const urls = [
		...new Set(
			Object.entries( s_movement_aliases ).filter( ( [name] ) => /^(?:step_|land_|gear_rattle_)/.test( name ) ).flatMap( ( [, variants] ) =>
				variants.filter( ( v ) => Sound_Loadspec( v.loadspec, map ) ).map( ( v ) => v.url )
			)
		),
	];

	let next = 0;

	for ( let lane = 0; lane < Math.min( 4, urls.length ); lane++ ) {
		void ( async () => {
			while ( context === s_ctx && Level_Name() === map && next < urls.length ) {
				const url = urls[next++];
				await S_LoadMovementBuffer( url ).catch( () => {} );
			}
		} )();
	}
}

/**
 * @exec helper
 * ================
 * S_PlayMovementAlias
 *
 * Retail alias variants, volume and pitch ranges; discard stale deferred events.
 * ================
 */
function S_PlayMovementAlias( name: string ): boolean {
	const variants = s_movement_aliases[name.toLowerCase()];

	if ( !variants ) {
		return false;
	}

	if ( !s_ctx || !s_activated ) {
		return true;
	}

	const context = s_ctx;
	const serial = s_ambient_serial;
	const started = performance.now();
	const activeMap = s_ambient_map || Level_Name() || '';

	let filtered = variants.filter( ( v ) => Sound_Loadspec( v.loadspec, activeMap ) );

	if ( !filtered.length ) {
		filtered = variants;
	}

	const variant = Sound_Select( filtered, s_alias_random );

	if ( !variant ) {
		return true;
	}

	void S_LoadMovementBuffer( variant.url )
		.then( ( buffer ) => {
			if ( s_ctx !== context || serial !== s_ambient_serial || performance.now() - started > 250 ) {
				return;
			}

			const source = context.createBufferSource();
			const gain = context.createGain();

			source.buffer = buffer;
			const pitchMin = Number.isFinite( variant.pitchMin ) ? variant.pitchMin : 1;
			const pitchMax = Number.isFinite( variant.pitchMax ) ? variant.pitchMax : 1;
			const volumeMin = Number.isFinite( variant.volumeMin ) ? variant.volumeMin : 1;
			const volumeMax = Number.isFinite( variant.volumeMax ) ? variant.volumeMax : 1;

			source.playbackRate.value = pitchMin + Math.random() * ( pitchMax - pitchMin );
			gain.gain.value = s_master_volume * ( volumeMin + Math.random() * ( volumeMax - volumeMin ) );

			source.connect( gain );
			gain.connect( context.destination );

			source.onended = () => {
				source.disconnect();
				gain.disconnect();
			};

			source.start();
		} )
		.catch( ( error ) => Con_DPrintf( 'Movement sound: ' + String( error ) + '\n' ) );

	return true;
}

const s_listener: s_listener_t = {
	vieworg: [ 0, 0, 0 ],
	forward: [ 1, 0, 0 ],
	right: [ 0, 1, 0 ],
	up: [ 0, 0, 1 ],
	valid: false,
};

const s_menu_music: s_menu_music_t = {
	buffer: null,
	source: null,
	gain: null,
	load_started: false,
	wanted: false,
};


// ---------------------------------------------------------------------------
// forward
// S_SetListenerPose, S_StopMenuMusic, S_StartMenuMusic
// S_MenuMusicTryStart, S_MenuMusicBeginLoad, S_AliasBeginLoad, S_PlayAlias
// S_Init, S_Shutdown, S_Activate, S_Update, S_StartSound, S_UpdateMenuMusic
// ---------------------------------------------------------------------------


/**
 * @exec per-frame
 * ================
 * S_SetListenerPose
 *
 * Push refdef axes into the WebAudio listener when available.
 * ================
 */
function S_SetListenerPose(
	vieworg: vec3_t,
	forward: vec3_t,
	right: vec3_t,
	up: vec3_t,
): void {
	let listener: AudioListener;

	if ( !s_ctx )
		return;

	listener = s_ctx.listener;

	if ( listener.positionX ) {
		listener.positionX.value = vieworg[0];
		listener.positionY.value = vieworg[1];
		listener.positionZ.value = vieworg[2];
		listener.forwardX.value = forward[0];
		listener.forwardY.value = forward[1];
		listener.forwardZ.value = forward[2];
		listener.upX.value = up[0];
		listener.upY.value = up[1];
		listener.upZ.value = up[2];
		return;
	}

	listener.setPosition( vieworg[0], vieworg[1], vieworg[2] );
	listener.setOrientation(
		forward[0], forward[1], forward[2],
		up[0], up[1], up[2],
	);
}


/**
 * @exec init-once
 * ================
 * S_AliasBeginLoad
 *
 * Preload CoD2 menu interface aliases (iw_code.csv mouse_over / mouse_click).
 * ================
 */
function S_AliasBeginLoad( alias: s_alias_sample_t, label: string ): void {
	if ( alias.load_started || !s_ctx )
		return;

	alias.load_started = true;
    const context = s_ctx;

	void ( async () => {
		let response: Response;
		let encoded: ArrayBuffer;

		try {
			response = await fetch( alias.url );
			if ( !response.ok )
				return;

			encoded = await response.arrayBuffer();
			if ( s_ctx !== context )
				return;
            const buffer = await context.decodeAudioData( encoded );
            if ( s_ctx === context ) alias.buffer = buffer;
		} catch {
			Con_Printf( 'S_AliasBeginLoad: failed ' + label + '\n' );
		}
	} )();
}


/**
 * ================
 * S_PlayAlias
 *
 * One-shot menu alias from ui_mp/*.menu play "mouse_over" / "mouse_click".
 * ================
 */
function S_PlayAlias( name: string ): boolean {
	let alias: s_alias_sample_t | undefined;
	let source: AudioBufferSourceNode;
	let gain: GainNode;

	alias = S_MENU_ALIASES[name];
	if ( !alias || !alias.buffer || !s_ctx || !s_activated )
		return false;

	source = s_ctx.createBufferSource();
	source.buffer = alias.buffer;

	gain = s_ctx.createGain();
	gain.gain.value = alias.volume * s_master_volume;

	source.connect( gain );
	gain.connect( s_ctx.destination );
	source.start();
	return true;
}


/**
 * ================
 * S_StopMenuMusic
 * ================
 */
function S_StopMenuMusic(): void {
	if ( !s_menu_music.source )
		return;

	try {
		s_menu_music.source.stop();
	} catch {
		// Already stopped.
	}

	s_menu_music.source.disconnect();
	s_menu_music.gain?.disconnect();
	s_menu_music.source = null;
	s_menu_music.gain = null;
}


/**
 * ================
 * S_StartMenuMusic
 *
 * Loop music/menu_GRTEMP.mp3 — retail alias music_mainmenu_mp.
 * ================
 */
function S_StartMenuMusic(): void {
	if ( !s_ctx || !s_activated || !s_menu_music.buffer || s_menu_music.source )
		return;

	s_menu_music.source = s_ctx.createBufferSource();
	s_menu_music.source.buffer = s_menu_music.buffer;
	s_menu_music.source.loop = true;

	s_menu_music.gain = s_ctx.createGain();
	s_menu_music.gain.gain.value = S_MENU_MUSIC_VOL * s_master_volume;

	s_menu_music.source.connect( s_menu_music.gain );
	s_menu_music.gain.connect( s_ctx.destination );
	s_menu_music.source.start();
}


/**
 * ================
 * S_MenuMusicTryStart
 * ================
 */
function S_MenuMusicTryStart(): void {
	if ( !s_menu_music.wanted )
		return;

	S_StartMenuMusic();
}


/**
 * @exec async-callback
 * ================
 * S_MenuMusicBeginLoad
 * ================
 */
function S_MenuMusicBeginLoad(): void {
	if ( s_menu_music.load_started || !s_ctx )
		return;

	s_menu_music.load_started = true;
    const context = s_ctx;

	void ( async () => {
		let response: Response;
		let encoded: ArrayBuffer;

		try {
			response = await fetch( S_MENU_MUSIC_URL );
			if ( !response.ok )
				return;

			encoded = await response.arrayBuffer();
			if ( s_ctx !== context )
				return;
            const buffer = await context.decodeAudioData( encoded );
            if ( s_ctx !== context ) return;
            s_menu_music.buffer = buffer;
			S_MenuMusicTryStart();
		} catch {
			Con_Printf( 'S_MenuMusicBeginLoad: failed\n' );
		}
	} )();
}


/**
 * @exec init-once
 * ================
 * S_Init
 * ================
 */
export function S_Init(): void {
    S_Shutdown();
	s_listener.valid = false;
	s_activated = false;
	s_menu_music.buffer = null;
	s_menu_music.source = null;
	s_menu_music.gain = null;
	s_menu_music.load_started = false;
	s_menu_music.wanted = false;
	S_MENU_ALIASES.mouse_over.buffer = null;
	S_MENU_ALIASES.mouse_over.load_started = false;
	S_MENU_ALIASES.mouse_click.buffer = null;
	S_MENU_ALIASES.mouse_click.load_started = false;

	if ( typeof AudioContext === 'undefined' )
		return;

	s_ctx = new AudioContext();
	S_MenuMusicBeginLoad();
	S_AliasBeginLoad( S_MENU_ALIASES.mouse_over, 'mouse_over' );
	S_AliasBeginLoad( S_MENU_ALIASES.mouse_click, 'mouse_click' );

}



/**
 * @exec helper
 * ================
 * S_LoadGameplayCatalogs
 *
 * Audio alias metadata is not a prerequisite for presenting the main menu.
 * ================
 */
function S_LoadGameplayCatalogs(): void {
	if ( s_catalog_load || !s_ctx ) return;
	const context = s_ctx;

	const movement = Promise.all(
		['/sound/movement.json', '/sound/weapons.json'].map( ( url ) =>
			fetch( url ).then( ( r ) => {
				if ( !r.ok ) {
					throw new Error( String( r.status ) );
				}
				return r.json();
			} )
		)
	)
		.then( ( catalogs ) => {
			if ( s_ctx !== context ) {
				return;
			}
			s_movement_aliases = Object.assign( {}, ...catalogs.map( ( c ) => c.aliases ) );
			// No gameplay-audio flood while opening the main menu.
			// S_PlayMovementAlias loads on demand; map entry prewarms a bounded queue.
			if ( Level_Name() ) {
				S_PrewarmGameplay( Level_Name() );
			}
		} )
		.catch( ( error ) => Con_Printf( 'Movement catalog: ' + String( error ) + '\n' ) );

	const ambient = fetch( '/sound/ambient.json' )
		.then( ( r ) => {
			if ( !r.ok ) {
				throw new Error( String( r.status ) );
			}
			return r.json();
		} )
		.then( ( catalog ) => {
			if ( s_ctx === context ) {
				s_ambient_catalog = catalog;
				const map = Level_Name();
				s_ambient_map = '';
				if ( map ) S_UpdateAmbient( map );
			}
		} )
		.catch( ( error ) => Con_Printf( 'Ambient catalog: ' + String( error ) + '\n' ) );


	s_catalog_load = Promise.all( [movement, ambient] ).then( () => {} );
}

/**
 * @exec init-once
 * ================
 * S_Shutdown
 * ================
 */
export function S_Shutdown(): void {
	s_prewarm_map = '';
	s_catalog_load = null;
	s_movement_aliases = {};
	s_movement_buffers.clear();
	S_StopAmbient();
    s_ambient_catalog=null;
	S_StopMenuMusic();
	s_menu_music.buffer = null;
	s_menu_music.load_started = false;
	s_menu_music.wanted = false;

	if ( s_ctx )
		s_ctx.close();

	s_ctx = null;
	s_activated = false;
	s_listener.valid = false;
}


/**
 * ================
 * S_Activate
 *
 * Resume AudioContext after first user gesture.  input.ts calls this on key/click.
 * ================
 */
export function S_Activate(): void {
	if ( !s_ctx || s_activated )
		return;

	if ( s_ctx.state === 'suspended' ) {
		const context = s_ctx;
		s_activated = true;

		context.resume().then( () => {
			if ( s_ctx !== context ) {
				return;
			}
			s_activated = true;
			Con_Printf( 'S_Activate: audio ready\n' );
			S_MenuMusicTryStart();
		} ).catch( () => {
			if ( s_ctx !== context ) {
				return;
			}
			s_activated = false;
			Con_Printf( 'S_Activate: resume failed\n' );
		} );
		return;
	}

	s_activated = true;
	S_MenuMusicTryStart();
}


/**
 * @exec per-frame
 * ================
 * S_Update
 *
 * Position audio listener from predicted refdef axes.
 * ================
 */
export function S_Update(
	vieworg: vec3_t,
	forward: vec3_t,
	right: vec3_t,
	up: vec3_t,
): void {
	s_listener.vieworg[0] = vieworg[0];
	s_listener.vieworg[1] = vieworg[1];
	s_listener.vieworg[2] = vieworg[2];
	s_listener.forward[0] = forward[0];
	s_listener.forward[1] = forward[1];
	s_listener.forward[2] = forward[2];
	s_listener.right[0] = right[0];
	s_listener.right[1] = right[1];
	s_listener.right[2] = right[2];
	s_listener.up[0] = up[0];
	s_listener.up[1] = up[1];
	s_listener.up[2] = up[2];
	s_listener.valid = true;

	if ( s_ctx && s_ctx.state === 'suspended' )
		S_Activate();

	if ( !s_activated )
		return;

	S_SetListenerPose( vieworg, forward, right, up );

	Con_DPrintf(
		'S_Update org ' +
		vieworg[0].toFixed( 1 ) + ' ' +
		vieworg[1].toFixed( 1 ) + ' ' +
		vieworg[2].toFixed( 1 ) + '\n',
	);
}


/**
 * ================
 * S_StartSound
 *
 * Play an extracted retail menu or movement alias.
 * ================
 */
export function S_StartSound( name: string ): void {
	const soundName = name.toLowerCase();

	if ( S_PlayMovementAlias( soundName ) ) {
		return;
	}

	if ( S_PlayAlias( soundName ) ) {
		return;
	}

	Con_DPrintf( 'S_StartSound: unknown "' + name + '"\n' );
}


/**
 * @exec per-frame
 * ================
 * S_UpdateMenuMusic
 *
 * CoD2 ui_mp/main.menu soundloop "music_mainmenu_mp" while menu backdrop is up.
 * ================
 */
export function S_UpdateMenuMusic( active: boolean, volume = 0.8 ): void {
	s_master_volume = volume;

	if ( s_ambient_gain ) {
		s_ambient_gain.gain.value = s_ambient_volume * volume;
	}

	if ( s_menu_music.gain ) {
		s_menu_music.gain.gain.value = S_MENU_MUSIC_VOL * volume;
	}

	s_menu_music.wanted = active;

	if ( !active ) {
		S_StopMenuMusic();
		return;
	}

	S_MenuMusicTryStart();
}

/**
 * @exec helper
 * ================
 * S_StopAmbient
 *
 * Stops active ambient level audio and disconnects source node.
 * ================
 */
function S_StopAmbient(): void {
	s_ambient_serial++;
	s_ambient_map = '';

	if ( s_ambient_source ) {
		s_ambient_source.stop();
		s_ambient_source.disconnect();
	}

	s_ambient_gain?.disconnect();
	s_ambient_source = null;
	s_ambient_gain = null;
}

/**
 * @exec per-frame
 * ================
 * S_UpdateAmbient
 *
 * Map scripts publish a local ambient alias; keep one source per level lifetime.
 * ================
 */
export function S_UpdateAmbient( map: string ): void {
	if ( !map ) {
		if ( s_ambient_map ) {
			S_StopAmbient();
		}
		return;
	}

	if ( map === s_ambient_map ) {
		return;
	}

	S_LoadGameplayCatalogs();
	s_ambient_map = map;
	S_PrewarmGameplay( map );

	if ( !s_ctx || !s_activated || !s_ambient_catalog ) {
		s_ambient_map = '';
		return;
	}

	S_StopAmbient();
	s_ambient_map = map;
	const aliasName = s_ambient_catalog.maps?.[map];

	if ( !aliasName ) {
		return;
	}

	const aliases = s_ambient_catalog.aliases?.[aliasName];
	const alias = aliases?.find( ( a ) => !a.loadspec || a.loadspec.split( /\s+/ ).includes( map ) );

	if ( !alias ) {
		return;
	}

	s_ambient_volume = alias.volume;
	const context = s_ctx;
	const ticket = s_ambient_serial;

	void ( async () => {
		try {
			const response = await fetch( alias.url );

			if ( !response.ok ) {
				throw new Error( String( response.status ) );
			}

			const buffer = await context.decodeAudioData( await response.arrayBuffer() );

			if ( context !== s_ctx || ticket !== s_ambient_serial ) {
				return;
			}

			const source = context.createBufferSource();
			const gain = context.createGain();

			source.buffer = buffer;
			source.loop = alias.loop;
			gain.gain.value = alias.volume * s_master_volume;

			source.connect( gain );
			gain.connect( context.destination );
			s_ambient_source = source;
			s_ambient_gain = gain;
			source.start();
		} catch ( error ) {
			if ( context === s_ctx && ticket === s_ambient_serial ) {
				Con_Printf( 'Ambient ' + map + ': ' + String( error ) + '\n' );
			}
		}
	} )();
}
