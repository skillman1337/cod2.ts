/*
===============================================================================

	test_movement_recording.mjs

	Call of Duty 2 / id Tech Authoritative Movement Recorder Tests
	Verifies recorder start/stop semantics, immutable frame snapshots,
	swept capsule trace capture, chronological ring buffer retention, and dropped frames.

===============================================================================
*/

import assert from 'node:assert/strict';

import { MovementRecord_Start, MovementRecord_Stop } from '../../../dist/engine/common/movement_recording.js';
import { PM_StateFromPlayer, PM_ApplyUsercmd } from '../../../dist/engine/common/pm.js';


// ---------------------------------------------------------------------------
// test execution
// ---------------------------------------------------------------------------

const state = PM_StateFromPlayer( [0, 0, 64], [0, 0, 0], [0, 0, 0] );
const cmd = {
	viewangles: [0, 0, 0],
	forwardmove: 127,
	sidemove: 0,
	buttons: 0,
	impulse: 0,
};

assert.equal( MovementRecord_Stop(), null );
assert( MovementRecord_Start() );
assert( !MovementRecord_Start() );

PM_ApplyUsercmd( state, cmd, 0.016 ); // Diagnostic/prediction calls must not duplicate authoritative data.
const before = structuredClone( state );

PM_ApplyUsercmd( state, cmd, 0.016, undefined, 'server' );
const saved = MovementRecord_Stop();

assert.equal( saved.frames.length, 1 );
assert.deepEqual( saved.frames[0].before, before );
assert.deepEqual( saved.frames[0].after, state );
assert( saved.frames[0].traces.length > 0 );

state.origin[0] = 999;
assert.notEqual( saved.frames[0].after.origin[0], 999 );
assert.equal( MovementRecord_Stop(), null );

assert( MovementRecord_Start() );
for ( let i = 0; i < 12003; i++ ) {
	PM_ApplyUsercmd( state, cmd, 0, undefined, 'server' );
}

const ring = MovementRecord_Stop();
assert.equal( ring.frames.length, 12000 );
assert.equal( ring.droppedCommands, 3 );
assert.equal( ring.frames[0].sequence, 3 );
assert.equal( ring.frames.at( -1 ).sequence, 12002 );

assert( MovementRecord_Start() );
assert.equal( MovementRecord_Stop().frames.length, 0 );

console.log( 'PASS: recorder start/stop, immutable state, trace capture, authoritative-only capture, bounded chronological retention, restart' );
