/*
===============================================================================

	sv_main.ts

	Call of Duty 2 / id Tech Server Simulation Frame & Snapshots
	Server simulation loop, map rotation commands, authoritative player movement,
	think entities, and client snapshot broadcast generation.

===============================================================================
*/

import { Level_LoadAssets } from '../../common/level_assets.js';
import { entity_render_t, vec3_t, usercmd_t, client_snapshot_t } from '@/engine/common/types.js';
import { PM_ApplyUsercmd, PM_StateFromPlayer, pm_state_t } from '@/engine/common/pm.js';
import { Command_Register, Command_Tokens } from '@/engine/common/commands.js';
import { Cvar_Get, Cvar_Register, Cvar_Set } from '@/engine/common/cvar.js';
import { Con_Printf } from '@/engine/common/common.js';
import arenas from '@/assets/ui/providers.json';
import {
	Level_Begin,
	Level_Commit,
	Level_Fail,
	Level_Reset,
	Level_Data,
	Level_Phase,
	Level_Generation,
	type level_manifest_t,
} from '@/engine/common/level.js';


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export const enum ss_active_t {
	ss_dead = 0,
	ss_loading,
	ss_active,
}

export const enum cs_connected_t {
	cs_free = 0,
	cs_zombie,
	cs_connected,
	cs_spawned,
}

export interface server_t {
	state: ss_active_t;
}

export interface client_t {
	state: cs_connected_t;
}

export interface server_static_t {
	clients: client_t[];
}

export interface level_locals_t {
	time: number;
	frametime: number;
	tickcount: number;
}

export interface edict_t {
	inuse: boolean;
	origin: vec3_t;
	angles: vec3_t;
	nextthink: number;
	think: ( ( ent: edict_t ) => void ) | null;
}

export interface sv_player_t extends pm_state_t {
	origin: vec3_t;
	angles: vec3_t;
	velocity: vec3_t;
}


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

const sv: server_t = {
	state: ss_active_t.ss_active,
};

const svs: server_static_t = {
	clients: [],
};

const level: level_locals_t = {
	time: 0,
	frametime: 0,
	tickcount: 0,
};

const sv_player: sv_player_t = {
	origin: [0, 0, 64],
	angles: [0, 0, 0],
	velocity: [0, 0, 0],
};

const g_edicts: edict_t[] = [];
let sv_level_spawn_key = '';

const sv_null_cmd: usercmd_t = {
	viewangles: [0, 0, 0],
	forwardmove: 0,
	sidemove: 0,
	buttons: 0,
	impulse: 0,
};


// ---------------------------------------------------------------------------
// map management commands
// ---------------------------------------------------------------------------

/*
====================
SV_MapCommand

Server-owned entry point shared by map commands and menu launch scripts.
Validates the requested game type and begins asynchronous level loading.
====================
*/
function SV_MapCommand( args: string[] ): void {
	const map = args[0]?.toLowerCase();

	if ( !map ) {
		Con_Printf( 'usage: map <mapname>' );
		return;
	}

	if ( !arenas.maps.some( ( arena ) => arena.map === map ) ) {
		Con_Printf( "Can't find map '" + map + "'." );
		return;
	}

	// 0x457a70: normalize and validate the requested script type before spawning.
	const requestedType = Cvar_Get( 'g_gametype' ).toLowerCase();
	const validType = arenas.gametypes.some( ( type ) => type.value === requestedType );

	if ( !validType ) {
		Con_Printf( 'g_gametype ' + requestedType + ' is not a valid gametype, defaulting to dm' );
	}

	Cvar_Set( 'g_gametype', validType ? requestedType : 'dm' );

	const ticket = Level_Begin( map );

	void ( async () => {
		try {
			const assets = await Level_LoadAssets( map );
			Level_Commit( ticket, assets );
		} catch ( error ) {
			Level_Fail( ticket );
			Con_Printf( "Can't load map '" + map + "': " + String( error ) );
		}
	} )();
}

/*
====================
SV_MapRotateCommand

Native 0x451f50 consumes keyword/value pairs from the current rotation string.
====================
*/
function SV_MapRotateCommand(): void {
	const rotation = Cvar_Get( 'sv_mapRotationCurrent' ).trim() || Cvar_Get( 'sv_mapRotation' );
	const tokens = Command_Tokens( rotation );

	for ( let i = 0; i < tokens.length; i++ ) {
		const keyword = tokens[i].toLowerCase();

		if ( keyword !== 'map' && keyword !== 'gametype' ) {
			Con_Printf( "Unknown keyword '" + tokens[i] + "' in sv_mapRotation." );
			continue;
		}

		const value = tokens[++i];

		if ( !value ) {
			break;
		}

		Cvar_Set( 'sv_mapRotationCurrent', tokens.slice( i + 1 ).join( ' ' ) );

		if ( keyword === 'gametype' ) {
			Cvar_Set( 'g_gametype', value );
		} else {
			SV_MapCommand( [value] );
			return;
		}
	}

	Con_Printf( 'No map specified in sv_mapRotation - forcing map_restart.' );
	SV_MapRestartCommand();
}

/*
====================
SV_MapRestartCommand

Restarts the currently active server map.
====================
*/
function SV_MapRestartCommand(): void {
	const map = Cvar_Get( 'mapname' );

	if ( !map ) {
		Con_Printf( 'Server is not running a map.' );
		return;
	}

	SV_MapCommand( [map] );
}


// ---------------------------------------------------------------------------
// game entity simulation
// ---------------------------------------------------------------------------

/*
====================
G_Spawn

Allocate one edict slot for demo thinks.
====================
*/
function G_Spawn(): edict_t {
	let ent: edict_t;

	ent = {
		inuse: true,
		origin: [0, 0, 0],
		angles: [0, 0, 0],
		nextthink: 0,
		think: null,
	};
	g_edicts.push( ent );

	return ent;
}

/*
====================
G_DemoOrbThink

Bob a marker entity so G_RunFrame is not a no-op.
====================
*/
function G_DemoOrbThink( ent: edict_t ): void {
	ent.origin[2] = 48 + Math.sin( level.time * 2.0 ) * 12;
	ent.nextthink = level.time + 0.05;
}

/*
====================
G_RunThink

If nextthink <= level.time, call ent->think and reschedule.
====================
*/
function G_RunThink( ent: edict_t ): void {
	if ( !ent.think ) {
		return;
	}

	if ( ent.nextthink <= 0 || ent.nextthink > level.time ) {
		return;
	}

	ent.nextthink = 0;
	ent.think( ent );
}

/*
====================
G_TryRunThink

Skip unused edicts; run think on active ones.
====================
*/
function G_TryRunThink( ent: edict_t ): void {
	if ( !ent.inuse ) {
		return;
	}

	G_RunThink( ent );
}

/*
====================
G_RunThinkEntities

Walk active edicts and run thinks.
====================
*/
function G_RunThinkEntities(): void {
	for ( let i = 0; i < g_edicts.length; i++ ) {
		G_TryRunThink( g_edicts[i] );
	}
}

/*
====================
G_PlayerPmState

Pack sv_player into pm_state for shared movement.
====================
*/
function G_PlayerPmState(): pm_state_t {
	return sv_player;
}

/*
====================
G_RunPlayer

Authoritative player motion from the usercmd queued this frame.
Spawns the player at designated start/team/intermission coordinates on map transitions.
====================
*/
function G_RunPlayer( cmd: usercmd_t ): void {
	const data = Level_Data();
	const phase = Level_Phase();

	if ( data ) {
		const playerCamera = Cvar_Get( 'cl_ingame' ) === '1';
		const key = Level_Generation() + ':' + ( playerCamera ? 'player' : 'intermission' );

		if ( key !== sv_level_spawn_key ) {
			sv_player.movement = undefined;
			sv_level_spawn_key = key;

			const wanted = playerCamera
				? ( Cvar_Get( 'g_gametype' ) === 'tdm' ? 'mp_tdm_spawn' : 'mp_dm_spawn' )
				: 'mp_global_intermission';
			const spawn = data.manifest.entities.find( ( e ) => e.classname === wanted )
				?? data.manifest.entities.find( ( e ) => e.classname === 'info_player_start' );

			if ( spawn ) {
				sv_player.origin = ( spawn.origin ?? '0 0 0' ).split( ' ' ).map( Number ) as vec3_t;
				sv_player.origin[2] += playerCamera ? 60 : 0;
				sv_player.angles = ( spawn.angles ?? ( '0 ' + ( spawn.angle ?? '0' ) + ' 0' ) ).split( ' ' ).map( Number ) as vec3_t;
				sv_player.velocity = [0, 0, 0];
			}

			g_edicts.length = 0;
			return;
		}

		if ( phase !== 'playing' ) {
			return;
		}
	}

	const state = G_PlayerPmState();
	PM_ApplyUsercmd( state, cmd, level.frametime, undefined, 'server' );
}

/*
====================
G_RunFrame

Advance level clock and run entity thinks.
level.frametime must already be set by SV_Frame.
====================
*/
function G_RunFrame( cmd: usercmd_t ): void {
	level.time += level.frametime;
	level.tickcount++;

	G_RunThinkEntities();
	G_RunPlayer( cmd );
}

/*
====================
SV_ConsumeUsercmd

Authoritative sim null cmd when com does not pass an inline usercmd.
====================
*/
function SV_ConsumeUsercmd(): usercmd_t {
	return sv_null_cmd;
}


// ---------------------------------------------------------------------------
// server lifecycle & client management
// ---------------------------------------------------------------------------

/*
====================
SV_Init

Start server static state for listen / dedicated sim.
====================
*/
export function SV_Init( runs_local_server: boolean ): void {
	Level_Reset();
	Cvar_Set( 'g_gametype', 'dm' );
	Cvar_Set( 'ui_netGametype', String( arenas.gametypes.findIndex( ( type ) => type.value === 'dm' ) ) );
	sv_level_spawn_key = '';

	Cvar_Register( 'mapname', '' );
	Cvar_Register( 'sv_mapRotation', '' );
	Cvar_Register( 'sv_mapRotationCurrent', '' );

	Command_Register( 'map', SV_MapCommand, () => arenas.maps.map( ( arena ) => arena.map ) );
	Command_Register( 'map_rotate', SV_MapRotateCommand );
	Command_Register( 'map_restart', SV_MapRestartCommand );

	sv.state = ss_active_t.ss_active;
	svs.clients = [];
	level.time = 0;
	level.frametime = 0;
	level.tickcount = 0;
	g_edicts.length = 0;

	sv_player.origin = [0, 0, 64];
	sv_player.angles = [0, 0, 0];
	sv_player.velocity = [0, 0, 0];
	sv_player.movement = undefined;

	if ( runs_local_server ) {
		SV_InitListenClient();
	}

	SV_InitDemoEntities();
}

/*
====================
SV_InitListenClient

Local listen server keeps one spawned client for snapshot build path.
====================
*/
function SV_InitListenClient(): void {
	svs.clients = [
		{ state: cs_connected_t.cs_spawned },
	];
}

/*
====================
SV_InitDemoEntities

One thinker so G_RunFrame matches id_game.psc shape.
====================
*/
function SV_InitDemoEntities(): void {
	let ent: edict_t;

	ent = G_Spawn();
	ent.origin = [32, 0, 48];
	ent.think = G_DemoOrbThink;
	ent.nextthink = level.time + 0.05;
}

/*
====================
SV_Shutdown

Reset server static state. Com_RollbackInit calls this on failed Com_Init.
====================
*/
export function SV_Shutdown(): void {
	sv.state = ss_active_t.ss_dead;
	svs.clients = [];
	level.time = 0;
	level.frametime = 0;
	level.tickcount = 0;
	g_edicts.length = 0;

	sv_player.origin = [0, 0, 64];
	sv_player.angles = [0, 0, 0];
	sv_player.velocity = [0, 0, 0];
	sv_player.movement = undefined;
}


// ---------------------------------------------------------------------------
// client snapshots & frames
// ---------------------------------------------------------------------------

/*
====================
SV_EntityToRender

Pack one edict origin for client render and snapshots.
====================
*/
function SV_EntityToRender( ent: edict_t ): entity_render_t {
	return {
		origin: [ent.origin[0], ent.origin[1], ent.origin[2]],
	};
}

/*
====================
SV_TryPushEntityRender

Append one active edict to the render list.
====================
*/
function SV_TryPushEntityRender( out: entity_render_t[], ent: edict_t ): void {
	if ( !ent.inuse ) {
		return;
	}

	out.push( SV_EntityToRender( ent ) );
}

/*
====================
SV_BuildEntityRenderList

Pack active edict origins for client render and snapshots.
====================
*/
function SV_BuildEntityRenderList(): entity_render_t[] {
	const out: entity_render_t[] = [];

	for ( let i = 0; i < g_edicts.length; i++ ) {
		SV_TryPushEntityRender( out, g_edicts[i] );
	}

	return out;
}

/*
====================
SV_BuildClientSnapshot

Pack playerstate for one client into the local snapshot queue.
====================
*/
function SV_BuildClientSnapshot( client: client_t ): client_snapshot_t {
	void client;

	const entities = SV_BuildEntityRenderList();

	return {
		sequence: level.tickcount,
		server_time: level.time,
		host_sent_ms: performance.now(),
		velocity: [...sv_player.velocity],
		movement: sv_player.movement ? { ...sv_player.movement } : undefined,
		vieworg: [sv_player.origin[0], sv_player.origin[1], sv_player.origin[2]],
		viewangles: [sv_player.angles[0], sv_player.angles[1], sv_player.angles[2]],
		entities,
	};
}

/*
====================
SV_TryBuildClientSnapshot

Skip clients that are not connected yet. Returns null when no snapshot built.
====================
*/
function SV_TryBuildClientSnapshot( client: client_t ): client_snapshot_t | null {
	if ( client.state < cs_connected_t.cs_connected ) {
		return null;
	}

	return SV_BuildClientSnapshot( client );
}

/*
====================
SV_BuildSnapshotForClients

Build snapshot for the first connected client slot.
Listen / loopback hosts have one spawned client.
====================
*/
function SV_BuildSnapshotForClients(): client_snapshot_t | null {
	for ( let i = 0; i < svs.clients.length; i++ ) {
		const snap = SV_TryBuildClientSnapshot( svs.clients[i] );
		if ( snap ) {
			return snap;
		}
	}

	return null;
}

/*
====================
SV_Frame

Advance simulation, build snapshot for connected clients.
====================
*/
export function SV_Frame( frametime: number, cmd: usercmd_t | null ): client_snapshot_t | null {
	if ( sv.state !== ss_active_t.ss_active ) {
		return null;
	}

	level.frametime = frametime;
	const server_cmd = cmd !== null ? cmd : SV_ConsumeUsercmd();
	G_RunFrame( server_cmd );

	return SV_BuildSnapshotForClients();
}

/**
 * @exec helper
 * ================
 * SV_GetPlayer
 *
 * Authoritative player state for client prediction and diagnostics.
 * ================
 */
export function SV_GetPlayer(): sv_player_t {
	return sv_player;
}
