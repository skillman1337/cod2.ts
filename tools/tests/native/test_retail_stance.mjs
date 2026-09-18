/*
===============================================================================

	test_retail_stance.mjs

	Call of Duty 2 / id Tech Stance Curves & Bounding Box Tests
	Validates stance height interpolation curves, two-stage stance transitions,
	and fixed-foot capsule shape bounds across standing, crouched, and prone stances.

===============================================================================
*/

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { Stance_Curve, Stance_Advance, Stance_Shape } from '../../../dist/engine/common/stance.js';

// ---------------------------------------------------------------------------
// verification fixture integrity
// ---------------------------------------------------------------------------

const fixture = JSON.parse( fs.readFileSync( 'artifacts/retail-menu-evidence/physics/native-stance-cases.json', 'utf8' ) );

for ( const [name, hash] of Object.entries( fixture.candidate_hashes ) ) {
	assert.equal( createHash( 'sha256' ).update( fs.readFileSync( name ) ).digest( 'hex' ), hash );
}


// ---------------------------------------------------------------------------
// native stance curve validation
// ---------------------------------------------------------------------------

for ( const c of fixture.cases ) {
	assert( Math.abs( Stance_Curve( c.a, c.b, c.percent ) - c.expected ) < 0.00001, JSON.stringify( c ) );
}


// ---------------------------------------------------------------------------
// two-stage transition & fixed-foot bounds
// ---------------------------------------------------------------------------

let s;
for ( let i = 0; i < 80; i++ ) {
	s = Stance_Advance( s, 11, 8 );
}
assert.equal( s.height, 11 );

for ( let i = 0; i < 80; i++ ) {
	s = Stance_Advance( s, 60, 8 );
}
assert.equal( s.height, 60 );

for ( const h of [11, 40, 60] ) {
	const shape = Stance_Shape( h );
	assert.equal( shape.offset - shape.half - shape.radius, -60, 'feet stay fixed' );
}

console.log( `Passed ${fixture.cases.length} native stance curve cases, two-stage transitions and fixed-foot bounds` );
