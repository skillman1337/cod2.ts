/*
===============================================================================

	test_retail_ladder.mjs

	Call of Duty 2 / id Tech Ladder Physics & Movement Integration Tests
	Validates wish velocity calculations on vertical ladder surfaces,
	ladder jump mechanics, climb cadence rates, and fixed frame clock quantizing.

===============================================================================
*/

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
	Ladder_Wish,
	Ladder_Velocity,
	Ladder_Jump,
	Ladder_Check,
} from '../../../dist/engine/common/ladder.js';
import { Movement_Rate, Movement_Cycle } from '../../../dist/engine/common/movement_events.js';
import { Frame_MinMsec } from '../../../dist/engine/common/frame_clock.js';
import { PM_ApplyUsercmd } from '../../../dist/engine/common/pm.js';
import { Level_Begin, Level_Commit } from '../../../dist/engine/common/level.js';
import { Cvar_Set } from '../../../dist/engine/common/cvar.js';


// ---------------------------------------------------------------------------
// test fixtures & comparison helper
// ---------------------------------------------------------------------------

const fixture = JSON.parse(
	fs.readFileSync( 'artifacts/retail-menu-evidence/physics/native-ladder.json', 'utf8' )
);

for ( const [name, hash] of Object.entries( fixture.candidate_hashes ) ) {
	const source = fs.readFileSync( name );
	const digest = createHash( 'sha256' ).update( source ).digest( 'hex' );
	assert.equal( digest, hash, name );
}

/*
====================
close

Compares two numeric vectors element-by-element within a specified tolerance.
====================
*/
function close( actual, expected, label, tolerance = 0.00006 ) {
	assert.equal( actual.length, expected.length );

	for ( let i = 0; i < actual.length; i++ ) {
		const delta = Math.abs( actual[i] - expected[i] );
		assert( delta <= tolerance, `${label}: ${actual} != ${expected}` );
	}
}


// ---------------------------------------------------------------------------
// ladder wish velocity & physical acceleration
// ---------------------------------------------------------------------------

for ( const c of fixture.cases ) {
	const { wish, side } = Ladder_Wish( c.forward, c.right, c.normal, c.fm, c.rm, 190, false );
	const velocity = Ladder_Velocity(
		c.velocity,
		wish,
		side,
		c.normal,
		c.fm,
		c.rm,
		c.dt,
		800,
		c.grounded
	);

	close( velocity, c.expected, JSON.stringify( c ) );
}


// ---------------------------------------------------------------------------
// ladder jumps & climb cadence rates
// ---------------------------------------------------------------------------

for ( const c of fixture.jumps ) {
	const jumpVelocity = Ladder_Jump( [0, 0, Math.fround( 249.7999 )], c.forward, [1, 0, 0], 128 );
	close( jumpVelocity, c.expected, 'jump' );
}

for ( const c of fixture.rates ) {
	const rate = Movement_Rate(
		150,
		190,
		c.fm,
		c.rm,
		{
			target: c.stance,
			from: c.stance,
			to: c.stance,
			height: c.stance,
			elapsed: 0,
		},
		c.slow,
		0.7,
		0.8
	);

	close( [rate], [c.expected], 'cadence', 0.000001 );
}

assert.equal( Frame_MinMsec( 85, false ), 11 );
assert.equal( Frame_MinMsec( 0, false ), 1 );
assert.equal( Frame_MinMsec( 85, true ), 1 );

for ( const c of fixture.clocks ) {
	assert.equal( Frame_MinMsec( c.maxfps, c.dedicated ), c.expected );
}


// ---------------------------------------------------------------------------
// ladder attach & trace query geometry
// ---------------------------------------------------------------------------

for ( const c of fixture.checks ) {
	const move = {
		commandTime: 2000,
		jumpTime: 2000 - c.jumpElapsed,
		ladderDetached: c.detached,
		ladder: c.old ? { normal: [1, 0, 0], surfaceFlags: 8 } : undefined,
	};
	const queries = [];

	Ladder_Check(
		move,
		[100, 200, 90],
		[-1, 0, 0],
		c.fm,
		c.grounded,
		c.stance,
		( start, end, shape ) => {
			queries.push( {
				start: start.map( ( x, i ) => x - ( i === 2 ? 60 : 0 ) ),
				end: end.map( ( x, i ) => x - ( i === 2 ? 60 : 0 ) ),
				mins: [
					-shape.radius,
					-shape.radius,
					shape.offset - shape.half - shape.radius + 60,
				],
				maxs: [
					shape.radius,
					shape.radius,
					shape.offset + shape.half + shape.radius + 60,
				],
			} );

			return {
				fraction: 0.5,
				normal: [1, 0, 0],
				surfaceFlags: c.surface,
				startsolid: false,
				allsolid: false,
			};
		}
	);

	assert.equal( !!move.ladder, c.attached, JSON.stringify( c ) );
	assert.equal( !!move.ladderDetached, c.resultDetached, JSON.stringify( c ) );
	assert.deepEqual( queries, c.queries );
}


// ---------------------------------------------------------------------------
// 240Hz footstep cadence interval benchmark
// ---------------------------------------------------------------------------

/*
====================
interval

The native byte cycle intentionally truncates each command. Gate whole frames
at the retail limit rather than inventing a floating-point bob accumulator.
====================
*/
function interval( limited ) {
	let previous = 0;
	let cycle = 0;
	const events = [];

	for ( let tick = 1; tick < 2400; tick++ ) {
		const now = Math.trunc( ( tick * 1000 ) / 240 );
		const msec = now - previous;

		if ( msec < ( limited ? Frame_MinMsec( 85, false ) : 1 ) ) {
			continue;
		}

		previous = now;
		const result = Movement_Cycle( cycle, msec, Math.fround( 0.335 ) );
		cycle = result.cycle;

		if ( result.step ) {
			events.push( now );
		}
	}

	return ( events.at( -1 ) - events[0] ) / ( events.length - 1 );
}

assert( interval( true ) < interval( false ) * 0.9 );
console.log(
	'240Hz footstep interval: before',
	interval( false ),
	'ms, retail frame gate',
	interval( true ),
	'ms'
);


// ---------------------------------------------------------------------------
// recorded approach & live movement replay
// ---------------------------------------------------------------------------

const files = fs
	.readdirSync( 'logs/trace/movement' )
	.filter( ( x ) => x.endsWith( '.json' ) )
	.sort();
const recordFile = files.find( ( x ) => x.includes( '15-21-53-177Z' ) );
const record = JSON.parse( fs.readFileSync( 'logs/trace/movement/' + recordFile, 'utf8' ) );

const context = record.contexts[0];
for ( const [name, value] of Object.entries( context.settings ) ) {
	Cvar_Set( name, value );
}

Level_Commit(
	Level_Begin( context.map ),
	{
		manifest: {
			name: context.map,
			collision: context.collision,
			mantle: context.mantle,
			entities: context.entities,
		},
		vertices: new ArrayBuffer( 0 ),
		base: '',
	}
);

const state = structuredClone( record.frames[0].before );
let attached = 0;
let maxZ = state.origin[2];

for ( const frame of record.frames ) {
	PM_ApplyUsercmd( state, frame.command, frame.dt );

	if ( state.movement.ladder ) {
		attached++;
	}

	maxZ = Math.max( maxZ, state.origin[2] );
}

assert( attached > 100, 'recorded approach must attach to ladder' );
assert( maxZ > 180, `must climb past former wall stop, maxZ ${maxZ}` );


// ---------------------------------------------------------------------------
// controlled ladder movement simulation
// ---------------------------------------------------------------------------

const origin = [1141.125, 1745.32, 140];
const base = {
	origin,
	angles: [-60, 180, 0],
	velocity: [0, 0, 0],
	movement: {
		commandTime: 2000,
		remainder: 0,
		oldButtons: 0,
		jumpTime: -500,
		jumpOrigin: 0,
		jumping: false,
		pmTime: 0,
		grounded: false,
	},
};

const cmd = {
	viewangles: [-60, 180, 0],
	forwardmove: 127,
	sidemove: 0,
	buttons: 1,
	impulse: 0,
	stance: 60,
};

// Test climbing and braking on release
const stop = structuredClone( base );

for ( let i = 0; i < 25; i++ ) {
	PM_ApplyUsercmd( stop, cmd, 0.012 );
}
assert( stop.movement.ladder );
const climbed = stop.origin[2];

for ( let i = 0; i < 30; i++ ) {
	PM_ApplyUsercmd( stop, { ...cmd, forwardmove: 0, buttons: 0 }, 0.012 );
}
assert( Math.abs( stop.velocity[2] ) < 1, 'release brakes vertical velocity' );
assert( stop.origin[2] - climbed < 8, 'release must not coast indefinitely' );

// Test looking down to descend
const down = structuredClone( base );

for ( let i = 0; i < 25; i++ ) {
	PM_ApplyUsercmd( down, { ...cmd, viewangles: [60, 180, 0] }, 0.012 );
}
assert( down.origin[2] < 130, 'look down to descend' );

// Test jumping pushes outward and upward
const jump = structuredClone( base );
PM_ApplyUsercmd( jump, cmd, 0.012 );
PM_ApplyUsercmd( jump, { ...cmd, buttons: 17 }, 0.012 );
assert( !jump.movement.ladder );
assert( jump.velocity[0] > 100 && jump.velocity[2] > 100, 'jump pushes outward/upward' );

// Test prone cannot attach
const prone = structuredClone( base );
PM_ApplyUsercmd( prone, { ...cmd, stance: 11 }, 0.012 );
assert( !prone.movement.ladder, 'prone cannot attach' );

// Test standing still on ground cannot attach
const clear = {
	fraction: 1,
	normal: [0, 0, 0],
	startsolid: false,
	allsolid: false,
	surfaceFlags: 0,
};
const fake = {
	...clear,
	fraction: 0.5,
	normal: [1, 0, 0],
	surfaceFlags: 8,
};

const rejected = structuredClone( base.movement );
Ladder_Check( rejected, origin, [-1, 0, 0], 0, true, 60, () => fake );
assert( !rejected.ladder, 'standing still on ground cannot attach' );

// Test detachment and no midair reattach after losing ladder
const detached = {
	...structuredClone( base.movement ),
	ladder: { normal: [1, 0, 0], surfaceFlags: 8 },
};

Ladder_Check( detached, origin, [-1, 0, 0], 127, false, 60, () => clear );
assert( detached.ladderDetached && !detached.ladder );

Ladder_Check( detached, origin, [-1, 0, 0], 127, false, 60, () => fake );
assert( !detached.ladder, 'no midair reattach after losing ladder' );

assert.notDeepEqual(
	Ladder_Wish( [-1, 0, 0], [0, 1, 0], [1, 0, 0], 127, 0, 190, false ).wish,
	[190, 0, 0],
	'reject walking-path mutation'
);

console.log(
	`PASS: ${fixture.cases.length} native ladder velocity cases, jump/cadence arithmetic; recorded approach attached ${attached} frames, max eye Z ${maxZ}; release, descent, jump-off, prone and detach guards`
);
