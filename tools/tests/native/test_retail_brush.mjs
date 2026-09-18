/*
===============================================================================

	test_retail_brush.mjs

	Call of Duty 2 / id Tech Convex Brush Raytrace Unit Tests
	Validates ray and swept box intersections against convex BSP brush planes,
	surface flags, and solid contact normals.

===============================================================================
*/

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { Level_Begin, Level_Commit } from '../../../dist/engine/common/level.js';
import { PM_Trace, PM_ApplyUsercmd } from '../../../dist/engine/common/pm.js';
import { Cvar_Set } from '../../../dist/engine/common/cvar.js';

// ---------------------------------------------------------------------------
// verification fixture integrity
// ---------------------------------------------------------------------------

const fixture = JSON.parse( fs.readFileSync( 'artifacts/retail-menu-evidence/physics/native-brush-cases.json', 'utf8' ) );
assert.equal(
	createHash( 'sha256' ).update( fs.readFileSync( 'engine/common/pm.ts' ) ).digest( 'hex' ),
	fixture.candidate_sha256
);


// ---------------------------------------------------------------------------
// convex brush raytrace intersection tests
// ---------------------------------------------------------------------------

const map = JSON.parse( fs.readFileSync( 'public/maps/mp_toujane/manifest.json', 'utf8' ) );

for ( const [index, c] of fixture.cases.entries() ) {
	Level_Commit( Level_Begin( map.name ), {
		manifest: { ...map, collision: [c.brush] },
		vertices: new ArrayBuffer( 0 ),
		base: '',
	} );

	const hit = PM_Trace( c.start, c.end );

	assert( Math.abs( hit.fraction - c.fraction ) < 0.0002, JSON.stringify( { index, c, hit } ) );
	assert.equal( hit.startsolid, c.startsolid, `startsolid ${index}` );
	assert.equal( hit.allsolid, c.allsolid, `allsolid ${index}` );

	if ( c.fraction < 1 && !c.allsolid ) {
		c.normal.forEach( ( v, i ) => {
			assert( Math.abs( v - hit.normal[i] ) < 0.00001, `normal ${index}` );
		} );
	}
}


// ---------------------------------------------------------------------------
// recorded box edge trace & overlap recovery validation
// ---------------------------------------------------------------------------

Level_Commit( Level_Begin( map.name ), {
	manifest: map,
	vertices: new ArrayBuffer( 0 ),
	base: '',
} );

const d = JSON.parse( fs.readFileSync( 'logs/trace/movement/cod2-movement-2026-09-07T13-49-21-723Z-5535af36.json', 'utf8' ) );

for ( const [k, v] of Object.entries( d.contexts[0].settings ) ) {
	Cvar_Set( k, v );
}

const state = structuredClone( d.frames[0].before );
let recoveries = 0;
let maxBackward = 0;

for ( const frame of d.frames ) {
	const before = [...state.origin];
	PM_ApplyUsercmd( state, frame.command, frame.dt, ( a, b ) => {
		const hit = PM_Trace( a, b );
		if ( hit.allsolid ) {
			recoveries++;
		}
		return hit;
	} );
	maxBackward = Math.max( maxBackward, before[1] - state.origin[1] );
}

assert.equal( recoveries, 0, 'held W must not enter the box and invoke overlap recovery' );
assert( maxBackward < 0.1, `backward displacement ${maxBackward}` );

console.log(
	`PASS: ${fixture.cases.length} original brush traces; complete ${d.frames.length}-command box-edge recording, no overlap recovery or backwards shake`
);
