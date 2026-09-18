/*
===============================================================================

	level.ts

	Call of Duty 2 / id Tech Map & Level Transition State Machine
	Map loading lifecycle, GPU level resource progress telemetry,
	broadphase collision preparation, multiplayer team permissions,
	and briefing/team/weapon menu state transitions.

===============================================================================
*/

import { Cvar_Get, Cvar_Set, Cvar_Snapshot } from './cvar.js';
import { Collision_Prepare } from './collision_broadphase.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const TEAM_PERMISSION_ENABLED  = '1';
export const TEAM_PERMISSION_DISABLED = '2';

export const LEVEL_PHASE_MENU         = 'menu';
export const LEVEL_PHASE_LOADING      = 'loading';
export const LEVEL_PHASE_BRIEFING     = 'briefing';
export const LEVEL_PHASE_TEAM         = 'team';
export const LEVEL_PHASE_WEAPON       = 'weapon';
export const LEVEL_PHASE_PLAYING      = 'playing';


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface level_manifest_t {
	name: string;
	vertices: number;
	vertex_stride: number;
	world: string;
	textures: ( {
		file: string;
		material: string;
		normal?: string;
		rgba?: string;
		normal_rgba?: string;
	} | null )[];
	lightmaps: string[];
	sunmaps: string[];
	sky: string[];
	sun: {
		direction: number[];
		color: number[];
	};
	fog: number[];
	nationalities: Record<string, string>;
	entities: Record<string, string>[];
	collision?: {
		bounds: number[];
		planes: number[][];
		contents: number;
		surfaceFlags?: number[];
		triangle?: [number, number, number][];
	}[];
	mantle?: {
		bounds: number[];
		planes: number[][];
		contents: number;
		surfaceFlags: number[];
		triangle?: [number, number, number][];
	}[];
	probes?: number[][][];
	draws?: {
		start: number;
		count: number;
		state: {
			src: number;
			dst: number;
			offset: number;
			write: boolean;
			sort: number;
			cull?: 'none' | 'back' | 'front';
			alpha?: number;
			compare?: 'always' | 'less-equal' | 'equal';
			lit?: boolean;
			fog?: boolean;
			multiply?: boolean;
		};
	}[];
}

export interface level_data_t {
	manifest: level_manifest_t;
	vertices: ArrayBuffer;
	base: string;
}

export type level_phase_t = 'menu' | 'loading' | 'briefing' | 'team' | 'weapon' | 'playing';


// ---------------------------------------------------------------------------
// state globals
// ---------------------------------------------------------------------------

let data: level_data_t | null = null;
let phase: level_phase_t = 'menu';
let requested: string = '';
let generation: number = 0;
let graphicsReady: boolean = false;
let progress: number = 0;


// ---------------------------------------------------------------------------
// team permissions
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Level_UpdateTeamPermissions
 *
 * Retail _teams.gsc permission states: 1 enabled, 2 disabled.
 * Local roster has one player.
 * ================
 */
function Level_UpdateTeamPermissions(): void {
	const team = Cvar_Get( 'ui_team' );
	const assigned = team === 'allies' || team === 'axis';

	Cvar_Set( 'ui_allow_joinauto', assigned ? TEAM_PERMISSION_DISABLED : TEAM_PERMISSION_ENABLED );

	for ( const side of ['allies', 'axis'] ) {
		Cvar_Set( 'ui_allow_join' + side, team === side ? TEAM_PERMISSION_DISABLED : TEAM_PERMISSION_ENABLED );
	}
}


// ---------------------------------------------------------------------------
// level lifecycle & telemetry
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Level_Progress
 *
 * Returns current normalized loading progress [0, 1].
 * ================
 */
export function Level_Progress(): number {
	return progress;
}

/**
 * @exec helper
 * ================
 * Level_GraphicsProgress
 *
 * Reports GPU asset preparation fraction [0, 1] scaled across loading window [0.2, 1.0].
 * ================
 */
export function Level_GraphicsProgress( loaded: level_data_t, fraction: number ): void {
	if ( data === loaded ) {
		progress = 0.2 + 0.8 * Math.max( 0, Math.min( 1, fraction ) );
	}
}

/**
 * @exec helper
 * ================
 * Level_GraphicsFailed
 *
 * Resets level state back to menu on graphics initialization error.
 * ================
 */
export function Level_GraphicsFailed( loaded: level_data_t ): void {
	if ( data === loaded ) {
		Level_Reset();
	}
}

/**
 * @exec helper
 * ================
 * Level_Data
 *
 * Returns active level geometry and manifest data.
 * ================
 */
export function Level_Data(): level_data_t | null {
	return data;
}

/**
 * @exec helper
 * ================
 * Level_Generation
 *
 * Returns active map load ticket/generation counter.
 * ================
 */
export function Level_Generation(): number {
	return generation;
}

/**
 * @exec helper
 * ================
 * Level_Phase
 *
 * Returns current level phase state enum.
 * ================
 */
export function Level_Phase(): level_phase_t {
	return phase;
}

/**
 * @exec helper
 * ================
 * Level_Name
 *
 * Returns active map name string or pending requested map.
 * ================
 */
export function Level_Name(): string {
	return data?.manifest.name ?? requested;
}

/**
 * @exec helper
 * ================
 * Level_Begin
 *
 * Initiates map load sequence for the specified map name.
 * Increments generation ticket and resets client team cvars.
 * ================
 */
export function Level_Begin( name: string ): number {
	generation++;
	requested = name;
	phase = 'loading';
	data = null;
	graphicsReady = false;
	progress = 0;

	Cvar_Set( 'cl_ingame', '0' );
	Cvar_Set( 'ui_team', 'spectator' );
	Level_UpdateTeamPermissions();

	return generation;
}

/**
 * @exec helper
 * ================
 * Level_Commit
 *
 * Commits loaded map manifest data, builds BVH collision acceleration trees,
 * and publishes script dvars to UI presentation cvars.
 * ================
 */
export function Level_Commit( ticket: number, loaded: level_data_t ): boolean {
	if ( ticket !== generation ) {
		return false;
	}

	if ( loaded.manifest.collision ) {
		Collision_Prepare( loaded.manifest.collision );
	}

	if ( loaded.manifest.mantle ) {
		Collision_Prepare( loaded.manifest.mantle );
	}

	data = loaded;
	progress = 0.2;
	Cvar_Set( 'mapname', loaded.manifest.name );

	// Game scripts publish effective server settings to their ui_* presentation values.
	for ( const [name, value] of Object.entries( Cvar_Snapshot() ) ) {
		if ( name.startsWith( 'scr_' ) ) {
			Cvar_Set( 'ui_' + name.slice( 4 ), value );
		}
	}

	return true;
}

/**
 * @exec helper
 * ================
 * Level_GraphicsReady
 *
 * Notifies that GPU pipelines and buffers are bound and ready.
 * Advances phase from 'loading' to 'briefing'.
 * ================
 */
export function Level_GraphicsReady( loaded: level_data_t ): void {
	if ( data === loaded ) {
		graphicsReady = true;

		if ( phase === 'loading' ) {
			phase = 'briefing';
		}
	}
}

/**
 * @exec helper
 * ================
 * Level_Reset
 *
 * Cancels active map load and returns client to menu phase.
 * ================
 */
export function Level_Reset(): void {
	generation++;
	data = null;
	phase = 'menu';
	requested = '';
	graphicsReady = false;

	Cvar_Set( 'mapname', '' );
	Cvar_Set( 'cl_ingame', '0' );
}

/**
 * @exec helper
 * ================
 * Level_Fail
 *
 * Resets level state if ticket matches current generation.
 * ================
 */
export function Level_Fail( ticket: number ): void {
	if ( ticket === generation ) {
		Level_Reset();
	}
}


// ---------------------------------------------------------------------------
// menu & team selection state machine
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Level_Continue
 *
 * Advances past map briefing screen into team selection menu.
 * ================
 */
export function Level_Continue(): void {
	if ( phase === 'briefing' && graphicsReady ) {
		phase = 'team';
	}
}

/**
 * @exec helper
 * ================
 * Level_ChooseTeam
 *
 * Assigns player to specified team (allies, axis, spectator, or autoassign).
 * Validates team join permissions and transitions to weapon selection or playing.
 * ================
 */
export function Level_ChooseTeam( team: string ): void {
	if ( phase !== 'team' ) {
		return;
	}

	const permission = team === 'autoassign' ? 'ui_allow_joinauto' : 'ui_allow_join' + team;

	if ( team !== 'spectator' && Cvar_Get( permission ) !== '1' ) {
		return;
	}

	Cvar_Set( 'ui_team', team === 'autoassign' ? 'allies' : team );
	Level_UpdateTeamPermissions();

	phase = team === 'spectator' ? 'playing' : 'weapon';
}

/**
 * @exec helper
 * ================
 * Level_ChooseWeapon
 *
 * Assigns player loadout weapon, marks client in-game, and transitions to active play.
 * ================
 */
export function Level_ChooseWeapon( weapon: string ): void {
	if ( phase !== 'weapon' ) {
		return;
	}

	Cvar_Set( 'ui_weapon', weapon );
	Cvar_Set( 'cl_ingame', '1' );
	phase = 'playing';
}

/**
 * @exec helper
 * ================
 * Level_ChangeSelection
 *
 * Switches active menu overlay between team and weapon selection during match.
 * ================
 */
export function Level_ChangeSelection( selection: 'team' | 'weapon' ): void {
	if ( !data || !graphicsReady ) {
		return;
	}

	if ( selection === 'weapon' && !['allies', 'axis'].includes( Cvar_Get( 'ui_team' ) ) ) {
		return;
	}

	phase = selection;
}

/**
 * @exec helper
 * ================
 * Level_WorldVisible
 *
 * True when the 3D game world should be rendered behind UI overlays.
 * ================
 */
export function Level_WorldVisible(): boolean {
	return ['briefing', 'team', 'weapon', 'playing'].includes( phase );
}
