/*
===============================================================================

	test_retail_landing.mjs

	Call of Duty 2 / id Tech Player Landing Impact & Recovery Tests
	Validates fall height calculation, view height dip smoothing,
	collision origin stability during impact, and recorded trace replays.

===============================================================================
*/

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { Landing_Height, Landing_Amount, Landing_ViewHeight } from '../../../dist/engine/common/landing.js';
import { PM_ApplyUsercmd, PM_StateFromPlayer, PM_Trace } from '../../../dist/engine/common/pm.js';
import { Level_Begin, Level_Commit } from '../../../dist/engine/common/level.js';
import { Cvar_Set } from '../../../dist/engine/common/cvar.js';

// ---------------------------------------------------------------------------
// verification fixture integrity
// ---------------------------------------------------------------------------

const fixture = JSON.parse( fs.readFileSync( 'artifacts/retail-menu-evidence/physics/native-landing-cases.json', 'utf8' ) );
assert.equal(
	createHash( 'sha256' ).update( fs.readFileSync( 'engine/common/landing.ts' ) ).digest( 'hex' ),
	fixture.candidate_sha256
);


// ---------------------------------------------------------------------------
// landing arithmetic & view height dip tests
// ---------------------------------------------------------------------------

for ( const c of fixture.cases ) {
	const value = c.kind === 'height'
		? Landing_ViewHeight( { amount: c.amount, time: 0, sequence: 1 }, 100, c.elapsed )
		: c.kind === 'impact'
			? Landing_Height( c.start, c.end, c.velocityZ, c.gravity )
			: Landing_Amount( c.height );

	assert( Math.abs( value - c.expected ) < 0.0001, JSON.stringify( { c, value } ) );
}


// ---------------------------------------------------------------------------
// simulated drop & camera recovery
// ---------------------------------------------------------------------------

const cmd = {
	viewangles: [0, 0, 0],
	forwardmove: 0,
	sidemove: 0,
	buttons: 0,
	impulse: 0,
};

const floor = ( a, b ) => ( {
	fraction: a[2] >= 60.125 && b[2] < 60.125 ? ( a[2] - 60.125 ) / ( a[2] - b[2] ) : 1,
	normal: [0, 0, 1],
	startsolid: false,
	allsolid: false,
	surfaceFlags: 0,
} );

const drop = PM_StateFromPlayer( [0, 0, 96.125], [0, 0, 0], [0, 0, 0] );
for ( let i = 0; i < 150; i++ ) {
	PM_ApplyUsercmd( drop, cmd, 0.008, floor );
}

assert.equal( drop.movement.landSequence, 1, 'one landing event per impact' );
assert.equal( drop.movement.landEvents[0].amount, 7, '36 unit box drop' );
assert( Math.abs( drop.origin[2] - 60.125 ) < 0.25, 'camera dip must not move physical collision origin' );

const event = drop.movement.landEvents[0];
const view = { amount: event.amount, time: 0, sequence: 1 };
assert.equal( Landing_ViewHeight( view, 100, 150 ), 93 );
assert.equal( Landing_ViewHeight( view, 100, 450 ), 100 );


// ---------------------------------------------------------------------------
// recorded trace replay
// ---------------------------------------------------------------------------

const map = JSON.parse( fs.readFileSync( 'public/maps/mp_toujane/manifest.json', 'utf8' ) );
Level_Commit( Level_Begin( map.name ), { manifest: map, vertices: new ArrayBuffer( 0 ), base: '' } );

const record = JSON.parse( fs.readFileSync( 'logs/trace/movement/cod2-movement-2026-09-07T13-51-56-446Z-4525ee1a.json', 'utf8' ) );
for ( const [k, v] of Object.entries( record.contexts[0].settings ) ) {
	Cvar_Set( k, v );
}

// Start before the offending landing so the new transition executes, rather
// than importing an already-grounded state from the incomplete old handler.
const state = structuredClone( record.frames[1970].before );
let allsolid = 0;

for ( const frame of record.frames.slice( 1970, 1982 ) ) {
	PM_ApplyUsercmd( state, frame.command, frame.dt, ( a, b ) => {
		const hit = PM_Trace( a, b );
		if ( hit.allsolid ) {
			allsolid++;
		}
		return hit;
	} );
}

assert.equal( allsolid, 0 );
assert( state.movement.landSequence > 0, 'recorded box landing emits camera event' );
assert( Math.hypot( state.velocity[0], state.velocity[1] ) < 160, 'native impact loss reduces the recorded 218-unit push' );

console.log(
	`PASS: ${fixture.cases.length} native landing arithmetic/camera cases, 36-unit drop, one event, camera recovery, recorded impact`,
	state.velocity
);
