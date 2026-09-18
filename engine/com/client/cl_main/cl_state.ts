/*
===============================================================================

	cl_state.ts

	Client static (cls), client state (cl), and frame-local globals.
	Parent is cl_main.ts — sole importer.  Screen reads scr_frame_t, not cls/cl.

===============================================================================
*/

import { AngleVectors } from '@/engine/common/math.js';
import { vec3_t, entity_render_t, refdef_t } from '@/engine/common/types.js';


export const enum ca_active_t {
	ca_disconnected = 0,
	ca_connected,
	ca_active,
}


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface client_static_t {
	state: ca_active_t;
	disable_screen: boolean;
}


export interface client_state_t {
	refdef: refdef_t;
	time: number;
	frametime: number;
	ping_ms: number;
	entities: entity_render_t[];
}


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

export const cls: client_static_t = {
	state: ca_active_t.ca_disconnected,
	disable_screen: false,
};


export const cl: client_state_t = {
	refdef: CL_DefaultRefdef(),
	time: 0,
	frametime: 0,
	ping_ms: 0,
	entities: [],
};


// qboolean — listen server shares one tick; set by com at CL_Init.
export let cl_listen_server = true;

// qboolean — show pointer-lock hint on HUD; input subtree writes, screen reads.
export let cl_pointer_lock_hint = false;

// qboolean — snapshot arrived this frame; suppress client clock integration.
export let cl_got_snapshot = false;

// predicted velocity for net client movement replay
export let cl_predict_velocity: vec3_t = [ 0, 0, 0 ];

// qboolean — jump sound edge detect
export let cl_was_jump = false;


// ---------------------------------------------------------------------------
// forward
// CL_DefaultViewAxis, CL_DefaultRefdef, CL_StoreViewAxis
// CL_SetRefdefAxis, CL_ResetRefdef, CL_ResetClientData, CL_SetHostMode
// ---------------------------------------------------------------------------


/**
 * ================
 * CL_DefaultViewAxis
 *
 * Identity view basis for a fresh refdef.
 * ================
 */
function CL_DefaultViewAxis(): [vec3_t, vec3_t, vec3_t] {
	return [
		[ 1, 0, 0 ],
		[ 0, 1, 0 ],
		[ 0, 0, 1 ],
	];
}


/**
 * ================
 * CL_DefaultRefdef
 *
 * Fresh refdef template.  Never alias cl.refdef to a shared const object.
 * ================
 */
function CL_DefaultRefdef(): refdef_t {
	return {
		vieworg: [ 0, 0, 0 ],
		viewangles: [ 0, 0, 0 ],
		viewaxis: CL_DefaultViewAxis(),
		time: 0,
	};
}


/**
 * ================
 * CL_StoreViewAxis
 *
 * Copy forward/right/up into refdef.viewaxis.
 * ================
 */
function CL_StoreViewAxis(
	refdef: refdef_t,
	forward: vec3_t,
	right: vec3_t,
	up: vec3_t,
): void {
	refdef.viewaxis[0][0] = forward[0];
	refdef.viewaxis[0][1] = forward[1];
	refdef.viewaxis[0][2] = forward[2];
	refdef.viewaxis[1][0] = right[0];
	refdef.viewaxis[1][1] = right[1];
	refdef.viewaxis[1][2] = right[2];
	refdef.viewaxis[2][0] = up[0];
	refdef.viewaxis[2][1] = up[1];
	refdef.viewaxis[2][2] = up[2];
}


/**
 * ================
 * CL_SetRefdefAxis
 *
 * Rebuild viewaxis from viewangles.  Call after any angle mutation.
 * ================
 */
export function CL_SetRefdefAxis( refdef: refdef_t ): void {
	let forward: vec3_t;
	let right: vec3_t;
	let up: vec3_t;

	forward = [ 0, 0, 0 ];
	right = [ 0, 0, 0 ];
	up = [ 0, 0, 0 ];
	AngleVectors( refdef.viewangles, forward, right, up );
	CL_StoreViewAxis( refdef, forward, right, up );
}


/**
 * ================
 * CL_ResetRefdef
 *
 * Reset view state on CL_Init so refdef mutation does not leak across reloads.
 * ================
 */
export function CL_ResetRefdef(): void {
	cl.refdef = CL_DefaultRefdef();
}


/**
 * ================
 * CL_ResetClientData
 *
 * Clear cl/cls simulation fields shared by CL_Init and CL_Shutdown.
 * ================
 */
export function CL_ResetClientData(): void {
	CL_ResetRefdef();
	cl.time = 0;
	cl.frametime = 0;
	cl.ping_ms = 0;
	cl.entities = [];
	cl_got_snapshot = false;
	cl_predict_velocity = [ 0, 0, 0 ];
	cl_was_jump = false;
}


/**
 * @exec init-once
 * ================
 * CL_SetHostMode
 *
 * Com passes host mode once at init so client code never imports host.ts.
 * ================
 */
export function CL_SetHostMode( listen_server: boolean ): void {
	cl_listen_server = listen_server;
}


/**
 * ================
 * CL_SetPointerLockHint
 *
 * Input subtree updates; screen subtree reads for HUD hint text.
 * ================
 */
export function CL_SetPointerLockHint( show: boolean ): void {
	cl_pointer_lock_hint = show;
}


/**
 * @exec per-frame
 * ================
 * CL_FrameSnapshotBegin
 *
 * Clear snapshot flag at frame start.
 * ================
 */
export function CL_FrameSnapshotBegin(): void {
	cl_got_snapshot = false;
}


/**
 * @exec per-frame
 * ================
 * CL_FrameSnapshotMark
 *
 * Snapshot arrived this frame; suppress client clock integration.
 * ================
 */
export function CL_FrameSnapshotMark(): void {
	cl_got_snapshot = true;
}


/**
 * @exec per-frame
 * ================
 * CL_FrameSnapshotReceived
 * ================
 */
export function CL_FrameSnapshotReceived(): boolean {
	return cl_got_snapshot;
}


/**
 * @exec per-frame
 * ================
 * CL_ResetPredictVelocity
 * ================
 */
export function CL_ResetPredictVelocity(): void {
	cl_predict_velocity = [ 0, 0, 0 ];
}


/**
 * @exec per-frame
 * ================
 * CL_GetPredictVelocity
 * ================
 */
export function CL_GetPredictVelocity(): vec3_t {
	return cl_predict_velocity;
}


/**
 * @exec per-frame
 * ================
 * CL_SetPredictVelocity
 * ================
 */
export function CL_SetPredictVelocity( velocity: vec3_t ): void {
	cl_predict_velocity[0] = velocity[0];
	cl_predict_velocity[1] = velocity[1];
	cl_predict_velocity[2] = velocity[2];
}


/**
 * ================
 * CL_WasJump
 * ================
 */
export function CL_WasJump(): boolean {
	return cl_was_jump;
}


/**
 * ================
 * CL_SetWasJump
 * ================
 */
export function CL_SetWasJump( value: boolean ): void {
	cl_was_jump = value;
}
