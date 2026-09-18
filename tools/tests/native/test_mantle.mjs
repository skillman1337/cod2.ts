/*
===============================================================================

	test_mantle.mjs

	Call of Duty 2 / id Tech Ledge Mantle Movement Unit Tests
	Validates ledge detection against authored map mantle volumes,
	traversal duration calculations, and state interpolation.

===============================================================================
*/

import fs from 'node:fs';
import assert from 'node:assert/strict';

import { Level_Begin, Level_Commit } from '../../../dist/engine/common/level.js';
import { PM_TraceShape, PM_ApplyUsercmd, PM_StateFromPlayer } from '../../../dist/engine/common/pm.js';
import { Mantle_Check, Mantle_Move, Mantle_Transition, Mantle_Duration } from '../../../dist/engine/common/mantle.js';

// ---------------------------------------------------------------------------
// map mantle volume discovery
// ---------------------------------------------------------------------------

const map = JSON.parse( fs.readFileSync( 'public/maps/mp_toujane/manifest.json', 'utf8' ) );
Level_Commit( Level_Begin( map.name ), { manifest: map, vertices: new ArrayBuffer( 0 ), base: '' } );

let found = null;

for ( const volume of map.mantle ) {
	if ( found ) {
		break;
	}
	const b = volume.bounds;

	for ( const height of [21, 39, 57] ) {
		for ( let yaw = 0; yaw < 360; yaw += 90 ) {
			const angle = yaw * Math.PI / 180;
			const body = {
				origin: [
					( b[0] + b[1] ) / 2 - Math.cos( angle ) * 18,
					( b[2] + b[3] ) / 2 - Math.sin( angle ) * 18,
					b[5] - height + 60,
				],
				angles: [0, yaw, 0],
				velocity: [0, 0, 0],
			};

			const candidate = Mantle_Check( body, PM_TraceShape );
			if ( candidate ) {
				found = { body, candidate };
				break;
			}
		}
	}
}

assert( found, 'authored Toujane mantle surfaces must yield an eligible ledge' );


// ---------------------------------------------------------------------------
// mantle movement & root motion traversal
// ---------------------------------------------------------------------------

const { body, candidate } = found;
const original = structuredClone( body );
const end = [...candidate.end];
const cmd = {
	viewangles: body.angles,
	forwardmove: 127,
	sidemove: 0,
	buttons: 16,
	impulse: 0,
};

assert.equal( Mantle_Move( body, candidate, { ...cmd, buttons: 0 }, 8 ), false );
assert.deepEqual( body, original );

do {
	Mantle_Move( body, candidate, cmd, 8 );
} while ( candidate.active );

assert( Math.hypot( ...body.origin.map( ( x, i ) => x - end[i] ) ) < 0.02, 'root-motion traversal must finish at checked endpoint' );
assert.equal( candidate.elapsed, Mantle_Duration( candidate ) );
assert.equal( Mantle_Check( { ...original, angles: [0, original.angles[1] + 180, 0] }, PM_TraceShape ), null, 'facing away cannot mantle' );
assert.equal( Mantle_Transition( 54 ), 'up_57', 'native nearest-transition tie order' );

fs.writeFileSync(
	'artifacts/retail-menu-evidence/physics/mantle-map-case.json',
	JSON.stringify( { original, end, candidate }, null, 2 )
);

console.log(
	'PASS: authored Toujane mantle, hint without movement, jump activation, root motion endpoint, facing rejection',
	original.origin,
	candidate.up,
	candidate.over
);
