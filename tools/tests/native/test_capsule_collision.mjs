/*
===============================================================================

	test_capsule_collision.mjs

	Call of Duty 2 / id Tech Swept Capsule Triangle Collision Tests
	Validates continuous swept capsule traces, edge rounding, triangle seams,
	and regression replays against retail physics evidence.

===============================================================================
*/

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { Capsule_TraceTriangle } from '../../../dist/engine/common/collision_capsule.js';
import { Level_Begin, Level_Commit } from '../../../dist/engine/common/level.js';
import { PM_ApplyUsercmd } from '../../../dist/engine/common/pm.js';
import { Cvar_Set } from '../../../dist/engine/common/cvar.js';

// ---------------------------------------------------------------------------
// verification fixture integrity
// ---------------------------------------------------------------------------

const fixture = JSON.parse( fs.readFileSync( 'artifacts/retail-menu-evidence/physics/native-capsule-cases.json', 'utf8' ) );
assert.equal(
	createHash( 'sha256' ).update( fs.readFileSync( 'engine/common/collision_capsule.ts' ) ).digest( 'hex' ),
	fixture.candidate_sha256
);


// ---------------------------------------------------------------------------
// triangle swept collision tests
// ---------------------------------------------------------------------------

for ( const c of fixture.cases ) {
	const hit = Capsule_TraceTriangle( c.start, c.end, c.triangle, c.face );
	assert( Math.abs( ( hit?.fraction ?? 1 ) - c.fraction ) < 0.0001, JSON.stringify( { c, hit } ) );
	if ( c.fraction < 1 ) {
		c.normal.forEach( ( n, i ) => assert( Math.abs( n - hit.normal[i] ) < 0.0001 ) );
	}
}

// Sphere at the capsule foot cannot stand on a distant corner of its AABB.
const triangle = [[0, 0, 0], [100, 0, 0], [0, 100, 0]];
assert.equal( Capsule_TraceTriangle( [-14, -14, 65], [-14, -14, 55], triangle, [0, 0, 1] ), null );

const edge = Capsule_TraceTriangle( [-10, 20, 80], [-10, 20, 40], triangle, [0, 0, 1] );
assert( edge && edge.normal[0] < -0.6 && edge.normal[2] > 0.7, 'rounded contact at a real edge' );

const seamA = [[-100, -100, 0], [100, -100, 0], [100, 100, 0]];
const seamB = [[-100, -100, 0], [100, 100, 0], [-100, 100, 0]];
assert.equal( Capsule_TraceTriangle( [-10, 0, 60.125], [10, 0, 60.125], seamA, [0, 0, 1] ), null );
assert.equal( Capsule_TraceTriangle( [-10, 0, 60.125], [10, 0, 60.125], seamB, [0, 0, 1] ), null );


// ---------------------------------------------------------------------------
// recorded edge capsule regressions
// ---------------------------------------------------------------------------

const m = JSON.parse( fs.readFileSync( 'public/maps/mp_toujane/manifest.json', 'utf8' ) );
Level_Commit( Level_Begin( m.name ), { manifest: m, vertices: new ArrayBuffer( 0 ), base: '' } );

const recorded = JSON.parse( fs.readFileSync( 'artifacts/retail-menu-evidence/physics/latest-edge-capsule-regressions.json', 'utf8' ) );
for ( const [name, value] of Object.entries( recorded.settings ) ) {
	Cvar_Set( name, value );
}

for ( const frame of recorded.frames ) {
	const state = structuredClone( frame.before );
	PM_ApplyUsercmd( state, frame.command, frame.dt );
	assert( Math.abs( state.origin[2] - frame.before.origin[2] ) < 1, 'latest recording must not climb ten units' );
	assert.equal( state.movement.stepSequence, frame.before.movement.stepSequence );
}

console.log(
	`PASS: ${fixture.cases.length} native face sweeps, rounded edge, no AABB-corner ledge, flat triangle seam, ${recorded.frames.length} latest recorded edge contacts`
);
