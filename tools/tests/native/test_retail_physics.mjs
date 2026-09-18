/*
===============================================================================

	test_retail_physics.mjs

	Call of Duty 2 / id Tech Retail Player Physics & Movement Tests
	Validates exact numerical agreement against native machine cases for:
	- Jump factors, command scaling, and initial jump impulse.
	- Acceleration, ground friction, and landing recovery.
	- Applied usercmd physics, air momentum, recovery deceleration, and prediction.

===============================================================================
*/

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import * as pm from '../../../dist/engine/common/pm.js';
import { Cvar_Set } from '../../../dist/engine/common/cvar.js';

// ---------------------------------------------------------------------------
// verification fixture integrity
// ---------------------------------------------------------------------------

const fixture = JSON.parse( fs.readFileSync( 'artifacts/retail-menu-evidence/physics/native-cases.json', 'utf8' ) );
assert.equal(
	createHash( 'sha256' ).update( fs.readFileSync( 'engine/common/pm.ts' ) ).digest( 'hex' ),
	fixture.candidate_sha256,
	'freeze and recapture after movement changes'
);

/*
====================
close

Asserts approximate numerical or array-level equality with tolerance.
====================
*/
function close( actual, expected, label ) {
	if ( Array.isArray( expected ) ) {
		expected.forEach( ( x, i ) => close( actual[i], x, label ) );
		return;
	}
	assert(
		Math.abs( actual - expected ) <= Math.max( 0.0001, Math.abs( expected ) * 0.000002 ),
		`${label}: ${actual} != ${expected}`
	);
}


// ---------------------------------------------------------------------------
// native test verification helper
// ---------------------------------------------------------------------------

/*
====================
check

Iterates across all native cases and executes the corresponding physics API method.
====================
*/
function check( api ) {
	for ( const c of fixture.cases ) {
		const args = structuredClone( c.args );
		let actual;

		if ( c.kind === 'factor' ) {
			actual = api.PM_JumpFactor( ...args );
		}
		if ( c.kind === 'scale' ) {
			actual = api.PM_CommandScale( ...args );
		}
		if ( c.kind === 'jump' ) {
			const state = {
				origin: [0, 0, 64],
				velocity: [0, 0, 0],
				movement: { jumping: true, pmTime: args[0], commandTime: 10000 },
			};
			api.PM_StartJump( state, 39, 800, args[1] );
			actual = state.velocity[2];
			assert.equal( state.movement.pmTime, 0 );
			assert.equal( state.movement.jumpOrigin, 64 );
			assert.equal( state.movement.jumpTime, 10000 );
		}
		if ( c.kind === 'accelerate' ) {
			api.PM_Accelerate( ...args );
			actual = args[0];
		}
		if ( c.kind === 'friction' ) {
			args[6] = api.PM_JumpFactor( args[6], true );
			api.PM_Friction( ...args );
			actual = args[0];
		}
		if ( c.kind === 'landing' ) {
			const [height, time, enabled] = args;
			const state = {
				origin: [0, 0, height],
				velocity: [190, 45, -100],
				movement: { jumping: true, pmTime: time, jumpOrigin: 0 },
			};
			api.PM_LandingRecovery( state, enabled );
			actual = state.velocity;
			assert.equal( state.movement.pmTime, c.expected.time );
			assert.equal( state.movement.jumping, c.expected.jumping );
			close( actual, c.expected.velocity, c.kind );
			continue;
		}

		close( actual, c.expected, c.kind );
	}
}

check( pm );


// ---------------------------------------------------------------------------
// mutation rejection checks
// ---------------------------------------------------------------------------

for ( const [name, fn] of [
	['PM_JumpFactor', () => 1],
	['PM_CommandScale', ( f, r, s ) => s / 127],
	['PM_Friction', () => {}],
	['PM_Accelerate', ( v, d, s ) => v.splice( 0, 3, ...d.map( ( x ) => x * s ) )],
	['PM_LandingRecovery', ( s ) => s.movement.pmTime = 0],
] ) {
	assert.throws( () => check( { ...pm, [name]: fn } ), undefined, 'mutation must be rejected: ' + name );
}


// ---------------------------------------------------------------------------
// applied movement simulation scenarios
// ---------------------------------------------------------------------------

const command = ( f = 0, r = 0, buttons = 0, pitch = 0 ) => ( {
	viewangles: [pitch, 0, 0],
	forwardmove: f,
	sidemove: r,
	buttons,
	impulse: 0,
} );

const player = () => pm.PM_StateFromPlayer( [0, 0, 64], [0, 0, 0], [0, 0, 0] );
const empty = ( s, e ) => ( {
	fraction: 1,
	normal: [0, 0, 0],
	startsolid: false,
	allsolid: false,
	surfaceFlags: 0,
} );

let state = player();
pm.PM_ApplyUsercmd( state, command( 127 ), 0.008 );
assert( state.velocity[0] > 0 && state.velocity[0] < 190, 'accelerates instead of snapping' );

for ( let i = 0; i < 80; i++ ) {
	pm.PM_ApplyUsercmd( state, command( 127 ), 0.008 );
}
close( state.velocity[0], 190, 'forward speed' );

const moving = state.origin[0];
pm.PM_ApplyUsercmd( state, command(), 0.008 );
assert( state.origin[0] > moving && state.velocity[0] < 190, 'friction retains momentum' );

const level = player();
const pitched = player();
for ( let i = 0; i < 30; i++ ) {
	pm.PM_ApplyUsercmd( level, command( 127 ), 0.008 );
	pm.PM_ApplyUsercmd( pitched, command( 127, 0, 0, 80 ), 0.008 );
}
close( level.origin, pitched.origin, 'pitch must not reduce movement' );

const air = player();
air.origin[2] = 500;
air.velocity = [100, 0, 0];
pm.PM_ApplyUsercmd( air, command(), 0.008, empty );
close( air.origin[0], 0.8, 'air momentum' );
assert( air.origin[2] < 500 && air.velocity[0] === 100 );

const jump = player();
pm.PM_ApplyUsercmd( jump, command( 0, 0, 16 ), 0.008 );
const first = jump.velocity[2];
assert( first > 240 && first < 250 );

let peak = jump.origin[2];
for ( let i = 0; i < 120; i++ ) {
	pm.PM_ApplyUsercmd( jump, command(), 0.008 );
	peak = Math.max( peak, jump.origin[2] );
}
assert( jump.movement.grounded && jump.movement.jumpTime === 8 );
assert( peak > 100 && peak < 108, 'jump arc near native height including command quantization' );

pm.PM_ApplyUsercmd( jump, command(), 0.008 );
pm.PM_ApplyUsercmd( jump, command( 0, 0, 16 ), 0.008 );
assert( jump.velocity[2] > 0 && jump.velocity[2] < first, 'second jump reduced during recovery' );

Cvar_Set( 'jump_slowdownEnable', '0' );
const noSlow = player();
pm.PM_ApplyUsercmd( noSlow, command( 0, 0, 16 ), 0.008 );
for ( let i = 0; i < 200; i++ ) {
	pm.PM_ApplyUsercmd( noSlow, command(), 0.008 );
}
pm.PM_ApplyUsercmd( noSlow, command( 0, 0, 16 ), 0.008 );
assert.equal( noSlow.velocity[2], first );
Cvar_Set( 'jump_slowdownEnable', '1' );

const copy = pm.PM_StateFromPlayer( jump.origin, jump.angles, jump.velocity, jump.movement );
pm.PM_ApplyUsercmd( copy, command( 127 ), 0.016 );
pm.PM_ApplyUsercmd( jump, command( 127 ), 0.016 );
assert.deepEqual( copy, jump, 'prediction replay preserves movement timers' );
assert.notEqual( copy.movement, jump.movement );

const clock = player();
for ( let i = 0; i < 60; i++ ) {
	pm.PM_ApplyUsercmd( clock, command(), 1 / 60 );
}
assert.equal( clock.movement.commandTime, 1000 );

const held = player();
for ( let i = 0; i < 40; i++ ) {
	pm.PM_ApplyUsercmd( held, command( 0, 0, 16 ), 0.008 );
}
assert.equal( held.movement.jumpTime, 8, 'cannot jump again in the air' );

for ( let i = 0; i < 120; i++ ) {
	pm.PM_ApplyUsercmd( held, command( 0, 0, 16 ), 0.008 );
}
assert( held.movement.jumpTime > 500, 'native modified-oldcmd permits another held jump after landing' );

console.log(
	`PASS: ${fixture.cases.length} original-machine cases, 5 rejected mutations, acceleration/friction/air/pitch/jump/recovery/prediction/clock scenarios`
);
