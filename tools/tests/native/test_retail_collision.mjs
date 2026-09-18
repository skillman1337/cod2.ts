/*
===============================================================================

	test_retail_collision.mjs

	Call of Duty 2 / id Tech Map Collision & Unstick Regression Tests
	Validates player unstick escape angles, map hull penetration resolution,
	and solid surface collision responses in Toujane level geometry.

===============================================================================
*/

import fs from 'node:fs';
import assert from 'node:assert/strict';

import { Level_Begin, Level_Commit } from '../../../dist/engine/common/level.js';
import { PM_StateFromPlayer, PM_ApplyUsercmd } from '../../../dist/engine/common/pm.js';
import { Cvar_Set } from '../../../dist/engine/common/cvar.js';


// ---------------------------------------------------------------------------
// test setup & collision helpers
// ---------------------------------------------------------------------------

const manifest = JSON.parse( fs.readFileSync( 'public/maps/mp_toujane/manifest.json', 'utf8' ) );

/*
====================
commit

Commits a map manifest into active engine level state with empty vertices.
====================
*/
const commit = ( m ) => Level_Commit( Level_Begin( m.name ), {
	manifest: m,
	vertices: new ArrayBuffer( 0 ),
	base: '',
} );

/*
====================
command

Generates a simulated player movement usercmd for a given yaw angle and forward speed.
====================
*/
const command = ( yaw, forward = 127 ) => ( {
	viewangles: [0, yaw, 0],
	forwardmove: forward,
	sidemove: 0,
	buttons: 0,
	impulse: 0,
} );

/*
====================
escape

Tests whether a player state can successfully escape or translate away from its
current position across 8 candidate yaw directions.
====================
*/
function escape( state ) {
	for ( let yaw = 0; yaw < 360; yaw += 45 ) {
		const candidate = PM_StateFromPlayer( state.origin, state.angles, state.velocity, state.movement );

		for ( let frame = 0; frame < 30; frame++ ) {
			PM_ApplyUsercmd( candidate, command( yaw ), 0.008 );
		}

		if ( Math.hypot( candidate.origin[0] - state.origin[0], candidate.origin[1] - state.origin[1] ) > 1 ) {
			return true;
		}
	}

	return false;
}

/*
====================
box

Synthesizes an axis-aligned collision brush with six bounding planes.
====================
*/
const box = ( bounds ) => ( {
	bounds,
	contents: 1,
	planes: [
		[-1, 0, 0, -bounds[0]],
		[1, 0, 0, bounds[1]],
		[0, -1, 0, -bounds[2]],
		[0, 1, 0, bounds[3]],
		[0, 0, -1, -bounds[4]],
		[0, 0, 1, bounds[5]],
	],
} );


// ---------------------------------------------------------------------------
// collision regression test suite
// ---------------------------------------------------------------------------

commit( manifest );

// 1. Terrain seam regression check
const seam = JSON.parse( fs.readFileSync( 'artifacts/retail-menu-evidence/physics/terrain-seam-regression.json', 'utf8' ) );

for ( const [name, value] of Object.entries( seam.settings ) ) {
	Cvar_Set( name, value );
}

const crossing = structuredClone( seam.before );
for ( let i = 0; i < 250; i++ ) {
	PM_ApplyUsercmd( crossing, seam.command, 0.004 );
}

assert(
	Math.hypot( crossing.origin[0] - seam.before.origin[0], crossing.origin[1] - seam.before.origin[1] ) > 100,
	'held W must cross the recorded terrain seam',
);

// 2. Trapped position regressions
const stuck = JSON.parse( fs.readFileSync( 'artifacts/retail-menu-evidence/physics/stuck-before.json', 'utf8' ) );
for ( const entry of stuck ) {
	assert( escape( PM_StateFromPlayer( entry.origin, [0, 0, 0], [0, 0, 0] ) ), `trapped at ${entry.origin}` );
}

// 3. Toujane spawn routes
let routes = 0;
for ( const entity of manifest.entities.filter( ( e ) => e.classname === 'mp_dm_spawn' ).slice( 0, 5 ) ) {
	for ( let yaw = 0; yaw < 360; yaw += 45 ) {
		const origin = entity.origin.split( /\s+/ ).map( Number );
		origin[2] += 60;

		const state = PM_StateFromPlayer( origin, [0, yaw, 0], [0, 0, 0] );
		for ( let i = 0; i < 100; i++ ) {
			PM_ApplyUsercmd( state, command( yaw, 0 ), 0.008 );
		}

		let stopped = 0;
		for ( let frame = 0; frame < 400; frame++ ) {
			const previous = [...state.origin];
			PM_ApplyUsercmd( state, command( yaw ), 0.008 );

			stopped = Math.hypot( ...state.origin.map( ( x, i ) => x - previous[i] ) ) < 0.0001 ? stopped + 1 : 0;
			if ( stopped >= 20 ) {
				assert( escape( state ), `route trapped: spawn ${entity.origin}, yaw ${yaw}, position ${state.origin}` );
				break;
			}
		}

		routes++;
	}
}

// 4. Solid wall collision blocking
commit( {
	...manifest,
	collision: [
		box( [-1000, 1000, -1000, 1000, -100, 0] ),
		box( [100, 120, -1000, 1000, 0, 200] ),
	],
} );

const wall = PM_StateFromPlayer( [0, 0, 60.125], [0, 0, 0], [0, 0, 0] );
for ( let i = 0; i < 250; i++ ) {
	PM_ApplyUsercmd( wall, command( 0 ), 0.008 );
}
assert( wall.origin[0] > 80 && wall.origin[0] < 85.01, 'solid wall must block movement' );

// 5. Shallow overlap recovery
const overlap = PM_StateFromPlayer( [0, 0, 59.75], [0, 0, 0], [0, 0, 0] );
for ( let i = 0; i < 30; i++ ) {
	PM_ApplyUsercmd( overlap, command( 0 ), 0.008 );
}
assert( overlap.origin[0] > 1 && overlap.origin[2] >= 60, 'shallow floor overlap must recover' );

// 6. Sealed-solid containment
commit( {
	...manifest,
	collision: [
		box( [-100, 100, -100, 100, -100, 200] ),
	],
} );

const sealed = PM_StateFromPlayer( [0, 0, 60], [0, 0, 0], [0, 0, 0] );
assert( !escape( sealed ), 'recovery cannot teleport out of a sealed solid' );

console.log( `PASS: recorded held-W terrain seam, ${stuck.length} trapped-position regressions, ${routes} Toujane routes, wall blocking, shallow overlap recovery, sealed-solid containment` );
