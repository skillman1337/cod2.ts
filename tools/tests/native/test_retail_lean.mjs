/*
===============================================================================

	test_retail_lean.mjs

	Call of Duty 2 / id Tech Corner Lean Physics & Clamping Tests
	Validates lean advance rate, corner camera origin offsets,
	and collision clearance clamping against native machine cases.

===============================================================================
*/

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { Lean_Advance, Lean_Origin, Lean_Clamp } from '../../../dist/engine/common/lean.js';


// ---------------------------------------------------------------------------
// fixture verification & machine cases
// ---------------------------------------------------------------------------

const fixture = JSON.parse(
	fs.readFileSync( 'artifacts/retail-menu-evidence/physics/native-lean-cases.json', 'utf8' )
);

const candidateHash = createHash( 'sha256' )
	.update( fs.readFileSync( 'engine/common/lean.ts' ) )
	.digest( 'hex' );
assert.equal( candidateHash, fixture.candidate_sha256 );

for ( const c of fixture.cases ) {
	const actual = c.kind === 'advance'
		? [Lean_Advance( c.value, c.direction, c.msec, c.height )]
		: Lean_Origin( [100, 200, 300], c.yaw, c.value );

	const expected = c.kind === 'advance' ? [c.expected] : c.expected;

	actual.forEach( ( v, i ) => {
		assert( Math.abs( v - expected[i] ) < 0.00004, JSON.stringify( { c, actual } ) );
	} );
}


// ---------------------------------------------------------------------------
// lean collision clamp boundary checks
// ---------------------------------------------------------------------------

assert.equal( Lean_Clamp( 0.5, 0 ), 0 );
assert.equal( Lean_Clamp( 0.5, 1 ), 0.5 );
assert( Math.abs( Lean_Clamp( -0.5, 0.36 ) + 0.2 ) < 1e-6 );

console.log(
	`Passed ${fixture.cases.length} original-machine lean cases and collision clamp boundaries`
);
