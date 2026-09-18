/*
===============================================================================

	test_input_transitions.mjs

	Call of Duty 2 / id Tech Input Subsystem & Pointer Lock Transition Tests
	Verifies pointer-lock transitions, view angle discontinuities, raw mouse deltas,
	unlocked drag handling, and flight recorder input tracking.

===============================================================================
*/

import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// browser globals mock
// ---------------------------------------------------------------------------

globalThis.window = new EventTarget();
globalThis.document = new EventTarget();
document.pointerLockElement = null;
document.exitPointerLock = () => {};

const input = await import( '../../../dist/engine/com/client/input/input.js' );
const { Cvar_Set } = await import( '../../../dist/engine/common/cvar.js' );
const { MovementRecord_Start, MovementRecord_Stop } = await import( '../../../dist/engine/common/movement_recording.js' );

Cvar_Set( 'sensitivity', '5' );
Cvar_Set( 'm_pitch', '.022' );
Cvar_Set( 'm_yaw', '.022' );

const canvas = new EventTarget();
const requests = [];
canvas.requestPointerLock = async ( options ) => requests.push( options );

input.CL_InitInput( canvas, () => {}, () => {} );
input.CL_SetViewAngles( [0, 0, 0] );
MovementRecord_Start();


// ---------------------------------------------------------------------------
// test execution
// ---------------------------------------------------------------------------

const mouse = ( fields ) => {
	const e = new Event( 'mousemove' );
	Object.assign( e, {
		movementX: 0,
		movementY: 0,
		buttons: 0,
		clientX: 0,
		clientY: 0,
		screenX: 0,
		screenY: 0,
		...fields,
	} );
	window.dispatchEvent( e );
};

document.pointerLockElement = canvas;
document.dispatchEvent( new Event( 'pointerlockchange' ) );

mouse( { movementX: 1402, movementY: -269 } );
assert.deepEqual( input.CL_CreateCmd().viewangles, [0, 0, 0], 'lock transition must not rotate' );

mouse( { movementX: 10, movementY: 2 } );
assert( Math.abs( input.CL_CreateCmd().viewangles[1] + 1.1 ) < 1e-9 );

document.pointerLockElement = null;
document.dispatchEvent( new Event( 'pointerlockchange' ) );
input.CL_SetViewAngles( [0, 0, 0] );

mouse( { buttons: 1, clientX: 100, clientY: 100 } );
mouse( { buttons: 1, clientX: 102, clientY: 101, movementX: 1402, movementY: -269 } );
assert( Math.abs( input.CL_CreateCmd().viewangles[1] + 0.22 ) < 1e-9, 'unlocked drag uses client deltas' );

canvas.dispatchEvent( new Event( 'click' ) );
await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
assert.equal( requests[0].unadjustedMovement, true );

const saved = MovementRecord_Stop();
assert( saved.trailingInput.some( ( e ) => e.event.movement?.[0] === 1402 && e.event.applied[0] === 0 ) );

input.CL_ShutdownInput();
console.log( 'PASS: pointer-lock transition, raw-input request, drag coordinate discontinuity, raw event recording, input shutdown' );
