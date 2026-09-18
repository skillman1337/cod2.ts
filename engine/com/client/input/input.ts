/*
===============================================================================

	input.ts

	Keyboard sampling, pointer lock, and usercmd construction.

===============================================================================
*/

import {
	vec3_t,
	usercmd_t,
	IN_BACK,
	IN_FORWARD,
	IN_JUMP,
	IN_MOVELEFT,
	IN_MOVERIGHT,
	IN_LEANLEFT,
	IN_LEANRIGHT,
	IN_ATTACK,
	IN_ADS,
	IN_RELOAD,
} from '@/engine/common/types.js';
import { Con_IsOpen } from '@/engine/common/common.js';
import { Cvar_Get } from '@/engine/common/cvar.js';
import { MovementRecord_Input } from '@/engine/common/movement_recording.js';
import { Binding_Key, Binding_Matches } from '@/engine/common/bindings.js';
import {
	STANCE_HEIGHT_PRONE,
	STANCE_HEIGHT_CROUCH,
	STANCE_HEIGHT_STAND,
	type stance_height_t,
} from '@/engine/common/stance.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const CL_KEY_SPEED   = 127;
const CL_PITCH_LIMIT = 89;


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

const cl_keys: Record<string, boolean> = {};
const cl_pressed_keys: Record<string, boolean> = {};
let cl_input_inited = false;
let cl_pointer_locked = false;
let cl_ui_mode = false;
let cl_mouse_client_x = 0;
let cl_mouse_client_y = 0;
let cl_canvas: HTMLCanvasElement | null = null;
let cl_sound_activate: ( () => void ) | null = null;
let cl_hint_sync: ( ( show: boolean ) => void ) | null = null;
let cl_viewangles: vec3_t = [ 0, 0, 0 ];
let cl_drag_position: { x: number; y: number } | null = null;
let cl_skip_locked_motion = false;
let cl_lock_pending = false;
let cl_stance: stance_height_t = STANCE_HEIGHT_STAND;
let cl_mouse_pressed = 0;
let cl_ads_toggled = false;
const cl_weapon_keys = new Map<string, number>();


// ---------------------------------------------------------------------------
// weapon key & mouse bindings
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * CL_WeaponKey
 *
 * Retail toggleads flips one persistent bit at 0x408020; +speed holds ADS.
 * ================
 */
function CL_WeaponKey( key: string, down: boolean ): void {
	if ( !down ) {
		cl_weapon_keys.delete( key );
		return;
	}

	if ( cl_weapon_keys.has( key ) ) {
		return;
	}

	if ( Binding_Matches( 'toggleads', key ) ) {
		cl_ads_toggled = !cl_ads_toggled;
	}

	let buttons = 0;

	for ( const [ command, flag ] of [
		[ '+attack', IN_ATTACK ],
		[ '+speed', IN_ADS ],
		[ '+reload', IN_RELOAD ],
	] as const ) {
		if ( Binding_Matches( command, key ) ) {
			buttons |= flag;
		}
	}

	cl_weapon_keys.set( key, buttons );
	cl_mouse_pressed |= buttons;
}

/**
 * @exec helper
 * ================
 * CL_MouseButtons
 *
 * Mouse buttons use the same sampled command lifetime as keys.
 * ================
 */
function CL_MouseButtons( ev: MouseEvent ): void {
	const key = 'MOUSE' + ( ev.button === 0 ? 1 : ev.button === 2 ? 2 : 3 );

	if ( ev.type === 'mouseup' ) {
		CL_WeaponKey( key, false );
		return;
	}

	if ( cl_ui_mode || Con_IsOpen() || ev.target !== cl_canvas ) {
		return;
	}

	CL_WeaponKey( key, true );
	CL_SoundActivate();
	CL_TryCapturePointer();
	ev.preventDefault();
}

/**
 * @exec helper
 * ================
 * CL_ContextMenu
 *
 * Prevents default browser context menu in game mode.
 * ================
 */
function CL_ContextMenu( ev: Event ): void {
	if ( !cl_ui_mode && !Con_IsOpen() ) {
		ev.preventDefault();
	}
}


// ---------------------------------------------------------------------------
// browser events
// ---------------------------------------------------------------------------

/**
 * ================
 * CL_SoundActivate
 * ================
 */
function CL_SoundActivate(): void {
	if ( cl_sound_activate ) {
		cl_sound_activate();
	}
}

/**
 * ================
 * CL_SyncPointerLockHint
 *
 * Write shared client flag for the screen subtree HUD.
 * ================
 */
function CL_SyncPointerLockHint(): void {
	if ( cl_hint_sync ) {
		cl_hint_sync( cl_input_inited && !cl_pointer_locked );
	}
}

/**
 * ================
 * CL_KeyDown
 * ================
 */
function CL_KeyDown( ev: KeyboardEvent ): void {
	if ( cl_ui_mode || Con_IsOpen() || ev.code === 'Backquote' ) {
		return;
	}

	if ( !cl_ui_mode && !ev.repeat ) {
		if ( ev.code === 'KeyC' ) {
			cl_stance = STANCE_HEIGHT_CROUCH;
		} else if ( ev.code === 'ControlLeft' || ev.code === 'ControlRight' ) {
			cl_stance = STANCE_HEIGHT_PRONE;
		} else if ( ev.code === 'Space' ) {
			cl_stance = STANCE_HEIGHT_STAND;
		}
	}

	cl_keys[ev.code] = true;

	if ( !ev.repeat ) {
		CL_WeaponKey( Binding_Key( ev.code ), true );
		cl_pressed_keys[ev.code] = true;
	}

	CL_SoundActivate();
	CL_TryCapturePointer();
}

/**
 * ================
 * CL_KeyUp
 * ================
 */
function CL_KeyUp( ev: KeyboardEvent ): void {
	cl_keys[ev.code] = false;
	CL_WeaponKey( Binding_Key( ev.code ), false );
}

/**
 * ================
 * CL_ClampPitch
 *
 * Keep pitch inside Quake-style vertical look limits.
 * ================
 */
function CL_ClampPitch(): void {
	if ( cl_viewangles[0] > CL_PITCH_LIMIT ) {
		cl_viewangles[0] = CL_PITCH_LIMIT;
	}

	if ( cl_viewangles[0] < -CL_PITCH_LIMIT ) {
		cl_viewangles[0] = -CL_PITCH_LIMIT;
	}
}

/**
 * ================
 * CL_MouseMove
 *
 * Pointer-locked look uses movementX/Y. Fallback: drag with LMB held.
 * ================
 */
function CL_MouseMove( ev: MouseEvent ): void {
	const before = [ ...cl_viewangles ];
	const locked = document.pointerLockElement === cl_canvas;
	let dx = 0;
	let dy = 0;
	let reason = 'look';

	if ( locked !== cl_pointer_locked ) {
		cl_pointer_locked = locked;
		cl_skip_locked_motion = locked;
		cl_drag_position = null;
	}

	if ( cl_ui_mode || Con_IsOpen() ) {
		reason = 'ui';
		cl_drag_position = null;
	} else if ( locked ) {
		if ( cl_skip_locked_motion ) {
			reason = 'pointer-lock transition';
			cl_skip_locked_motion = false;
		} else {
			dx = ev.movementX;
			dy = ev.movementY;
		}
	} else if ( ( ev.buttons & 1 ) !== 0 ) {
		// Absolute client positions share one coordinate space while dragging;
		// movementX/Y can include desktop cursor repositioning when unlocked.
		if ( cl_drag_position ) {
			dx = ev.clientX - cl_drag_position.x;
			dy = ev.clientY - cl_drag_position.y;
		} else {
			reason = 'drag begin';
		}

		cl_drag_position = { x: ev.clientX, y: ev.clientY };
	} else {
		reason = 'unlocked';
		cl_drag_position = null;
	}

	const sensitivity = Number( Cvar_Get( 'sensitivity' ) );

	if ( Number.isFinite( dx ) && Number.isFinite( dy ) ) {
		cl_viewangles[0] += dy * sensitivity * Number( Cvar_Get( 'm_pitch' ) );
		cl_viewangles[1] -= dx * sensitivity * Number( Cvar_Get( 'm_yaw' ) );
		CL_ClampPitch();
	}

	MovementRecord_Input( {
		type: 'mousemove',
		timeStamp: ev.timeStamp,
		locked,
		reason,
		buttons: ev.buttons,
		movement: [ ev.movementX, ev.movementY ],
		client: [ ev.clientX, ev.clientY ],
		screen: [ ev.screenX, ev.screenY ],
		applied: [ dx, dy ],
		before,
		after: [ ...cl_viewangles ],
	} );
}

/**
 * ================
 * CL_MenuMouseTrack
 *
 * Client pixel position for menu cursor overlay.
 * ================
 */
function CL_MenuMouseTrack( ev: MouseEvent ): void {
	cl_mouse_client_x = ev.clientX;
	cl_mouse_client_y = ev.clientY;
}

/**
 * ================
 * CL_CanvasClick
 *
 * Click canvas to capture pointer for mouselook.
 * ================
 */
function CL_CanvasClick(): void {
	CL_SoundActivate();
	CL_TryCapturePointer();
}

/**
 * ================
 * CL_TryCapturePointer
 *
 * Request pointer lock once the player engages. Browser policy still requires
 * a user gesture; keydown and canvas click both qualify.
 * ================
 */
function CL_TryCapturePointer(): void {
	if ( !cl_canvas || cl_pointer_locked || cl_ui_mode || Con_IsOpen() || cl_lock_pending ) {
		return;
	}

	const canvas = cl_canvas;
	cl_lock_pending = true;

	void ( async () => {
		try {
			await canvas.requestPointerLock( { unadjustedMovement: true } );
			MovementRecord_Input( { type: 'pointer-lock-request', raw: true } );
		} catch ( error ) {
			MovementRecord_Input( { type: 'pointer-lock-error', error: String( error ) } );

			if (
				error instanceof DOMException &&
				error.name === 'NotSupportedError' &&
				canvas === cl_canvas &&
				!cl_ui_mode &&
				!Con_IsOpen()
			) {
				try {
					await canvas.requestPointerLock();
					MovementRecord_Input( { type: 'pointer-lock-request', raw: false } );
				} catch ( fallback ) {
					MovementRecord_Input( { type: 'pointer-lock-error', error: String( fallback ) } );
				}
			}
		} finally {
			cl_lock_pending = false;
		}
	} )();
}

/**
 * ================
 * CL_PointerLockChange
 * ================
 */
function CL_PointerLockChange(): void {
	cl_pointer_locked = document.pointerLockElement === cl_canvas;
	cl_skip_locked_motion = cl_pointer_locked;
	cl_drag_position = null;

	MovementRecord_Input( { type: 'pointerlockchange', locked: cl_pointer_locked } );
	CL_SyncPointerLockHint();
}

/**
 * @exec helper
 * ================
 * CL_InputBlur
 *
 * Reset input baselines when the OS/browser takes focus.
 * ================
 */
function CL_InputBlur(): void {
	CL_ClearMovementKeys();

	for ( const key of Object.keys( cl_keys ) ) {
		cl_keys[key] = false;
	}

	cl_drag_position = null;
	cl_skip_locked_motion = cl_pointer_locked;
	MovementRecord_Input( { type: 'blur' } );
}


// ---------------------------------------------------------------------------
// cmd sampling
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * CL_SampleForwardAxis
 *
 * Map W/S into forwardmove and button flags.
 * ================
 */
function CL_SampleForwardAxis(): { move: number; buttons: number } {
	let move = 0;
	let buttons = 0;

	if ( cl_keys['KeyW'] ) {
		move += CL_KEY_SPEED;
		buttons |= IN_FORWARD;
	}

	if ( cl_keys['KeyS'] ) {
		move -= CL_KEY_SPEED;
		buttons |= IN_BACK;
	}

	return { move, buttons };
}

/**
 * @exec helper
 * ================
 * CL_SampleSideAxis
 *
 * Map A/D into sidemove and button flags.
 * ================
 */
function CL_SampleSideAxis(): { move: number; buttons: number } {
	let move = 0;
	let buttons = 0;

	if ( cl_keys['KeyA'] ) {
		move -= CL_KEY_SPEED;
		buttons |= IN_MOVELEFT;
	}

	if ( cl_keys['KeyD'] ) {
		move += CL_KEY_SPEED;
		buttons |= IN_MOVERIGHT;
	}

	return { move, buttons };
}

/**
 * @exec helper
 * ================
 * CL_SampleJump
 *
 * Return IN_JUMP when space is held.
 * ================
 */
function CL_SampleJump(): number {
	if ( !cl_keys['Space'] ) {
		return 0;
	}

	return IN_JUMP;
}

/**
 * @exec helper
 * ================
 * CL_ReleasePointerLock
 *
 * Exit pointer lock when shutting down input on the active canvas.
 * ================
 */
function CL_ReleasePointerLock(): void {
	if ( document.pointerLockElement !== cl_canvas ) {
		return;
	}

	document.exitPointerLock();
}

/**
 * @exec helper
 * ================
 * CL_UnbindInputEvents
 *
 * Remove browser listeners registered in CL_InitInput.
 * ================
 */
function CL_UnbindInputEvents(): void {
	window.removeEventListener( 'keydown', CL_KeyDown );
	window.removeEventListener( 'keyup', CL_KeyUp );
	window.removeEventListener( 'mousemove', CL_MouseMove );
	window.removeEventListener( 'mousedown', CL_MouseButtons );
	window.removeEventListener( 'mouseup', CL_MouseButtons );
	cl_canvas?.removeEventListener( 'contextmenu', CL_ContextMenu );
	window.removeEventListener( 'blur', CL_InputBlur );
	window.removeEventListener( 'pointermove', CL_MenuMouseTrack );
	document.removeEventListener( 'pointerlockchange', CL_PointerLockChange );

	if ( cl_canvas ) {
		cl_canvas.removeEventListener( 'click', CL_CanvasClick );
	}
}

/**
 * @exec helper
 * ================
 * CL_ClearMovementKeys
 *
 * Reset movement keys so stale state does not leak across reload.
 * ================
 */
function CL_ClearMovementKeys(): void {
	cl_mouse_pressed = 0;
	cl_ads_toggled = false;
	cl_weapon_keys.clear();

	for ( const key of Object.keys( cl_pressed_keys ) ) {
		delete cl_pressed_keys[key];
	}

	for ( const key of Object.keys( cl_keys ) ) {
		cl_keys[key] = false;
	}
}


// ---------------------------------------------------------------------------
// client input lifecycle & usercmd construction
// ---------------------------------------------------------------------------

/**
 * @exec init-once
 * ================
 * CL_InitInput
 *
 * Bind browser events once. Com_Shutdown calls CL_ShutdownInput.
 * ================
 */
export function CL_InitInput(
	canvas: HTMLCanvasElement,
	sound_activate: () => void,
	hint_sync: ( show: boolean ) => void,
): void {
	if ( cl_input_inited ) {
		return;
	}

	cl_input_inited = true;
	cl_stance = STANCE_HEIGHT_STAND;
	cl_canvas = canvas;
	cl_sound_activate = sound_activate;
	cl_hint_sync = hint_sync;

	window.addEventListener( 'keydown', CL_KeyDown );
	window.addEventListener( 'keyup', CL_KeyUp );
	window.addEventListener( 'mousemove', CL_MouseMove );
	window.addEventListener( 'mousedown', CL_MouseButtons );
	window.addEventListener( 'mouseup', CL_MouseButtons );
	canvas.addEventListener( 'contextmenu', CL_ContextMenu );
	window.addEventListener( 'blur', CL_InputBlur );
	window.addEventListener( 'pointermove', CL_MenuMouseTrack );
	document.addEventListener( 'pointerlockchange', CL_PointerLockChange );
	canvas.addEventListener( 'click', CL_CanvasClick );

	CL_SyncPointerLockHint();
}

/**
 * @exec helper
 * ================
 * CL_ShutdownInput
 * ================
 */
export function CL_ShutdownInput(): void {
	if ( !cl_input_inited ) {
		return;
	}

	CL_ReleasePointerLock();
	CL_UnbindInputEvents();

	cl_input_inited = false;
	cl_pointer_locked = false;
	cl_drag_position = null;
	cl_skip_locked_motion = false;
	cl_lock_pending = false;
	cl_ui_mode = false;
	cl_mouse_client_x = 0;
	cl_mouse_client_y = 0;
	cl_canvas = null;

	if ( cl_hint_sync ) {
		cl_hint_sync( false );
	}

	cl_sound_activate = null;
	cl_hint_sync = null;
	CL_ClearMovementKeys();
}

/**
 * @exec helper
 * ================
 * CL_CreateCmd
 *
 * Sample keys into a usercmd for this client frame.
 * ================
 */
export function CL_CreateCmd(): usercmd_t {
	const fwd = CL_SampleForwardAxis();
	const side = CL_SampleSideAxis();

	let buttons =
		fwd.buttons |
		side.buttons |
		CL_SampleJump() |
		cl_mouse_pressed |
		( cl_ads_toggled ? IN_ADS : 0 ) |
		( cl_pressed_keys['Space'] ? IN_JUMP : 0 );

	for ( const held of cl_weapon_keys.values() ) {
		buttons |= held;
	}

	if ( !cl_ui_mode && !Con_IsOpen() ) {
		buttons |= ( cl_keys['KeyQ'] ? IN_LEANLEFT : 0 ) | ( cl_keys['KeyE'] ? IN_LEANRIGHT : 0 );
	}

	if ( cl_ui_mode || Con_IsOpen() ) {
		fwd.move = 0;
		side.move = 0;
		buttons = 0;
	}

	cl_mouse_pressed = 0;

	for ( const key of Object.keys( cl_pressed_keys ) ) {
		delete cl_pressed_keys[key];
	}

	return {
		viewangles: [ cl_viewangles[0], cl_viewangles[1], cl_viewangles[2] ],
		forwardmove: fwd.move,
		sidemove: side.move,
		buttons,
		impulse: 0,
		stance: cl_stance,
	};
}

/**
 * @exec helper
 * ================
 * CL_GetViewAngles
 *
 * Expose sampled viewangles for snapshot reconciliation.
 * ================
 */
function CL_GetViewAngles(): vec3_t {
	return [ cl_viewangles[0], cl_viewangles[1], cl_viewangles[2] ];
}

/**
 * @exec helper
 * ================
 * CL_SetViewAngles
 *
 * Apply authoritative angles from server snapshot.
 * ================
 */
export function CL_SetViewAngles( angles: vec3_t ): void {
	MovementRecord_Input( {
		type: 'set-viewangles',
		before: [ ...cl_viewangles ],
		after: [ ...angles ],
	} );

	cl_viewangles[0] = angles[0];
	cl_viewangles[1] = angles[1];
	cl_viewangles[2] = angles[2];
}

/**
 * @exec helper
 * ================
 * CL_IsPointerLocked
 * ================
 */
function CL_IsPointerLocked(): boolean {
	return cl_pointer_locked;
}

/**
 * @exec per-frame
 * ================
 * CL_SetUiMode
 *
 * Menu UI uses the CoD2 software cursor instead of pointer lock.
 * ================
 */
export function CL_SetUiMode( active: boolean ): void {
	if ( cl_ui_mode === active ) {
		return;
	}

	cl_ui_mode = active;
	cl_drag_position = null;
	cl_skip_locked_motion = cl_pointer_locked;
	MovementRecord_Input( { type: 'ui-mode', active } );

	if ( cl_ui_mode ) {
		CL_ClearMovementKeys();
		CL_ReleasePointerLock();
	}
}

/**
 * @exec per-frame
 * ================
 * CL_GetMouseClientPos
 * ================
 */
export function CL_GetMouseClientPos(): { x: number; y: number } {
	return { x: cl_mouse_client_x, y: cl_mouse_client_y };
}
