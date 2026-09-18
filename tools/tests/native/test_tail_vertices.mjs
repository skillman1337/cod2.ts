/*
===============================================================================

	test_tail_vertices.mjs

	Call of Duty 2 / id Tech Weapon Tracer Tail Mesh & Batching Tests
	Executes the actual GPU weaponfx tracer quad vertex generation to verify
	vertex coordinates, texture UV mapping, atlas framing, and coordinate shifts
	against retail evidence.

===============================================================================
*/

import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';


// ---------------------------------------------------------------------------
// extract renderer batching routine
// ---------------------------------------------------------------------------

const source = fs.readFileSync( 'engine/com/client/screen/scr_draw/rgpu/internal/rgpu_weaponfx.ts', 'utf8' );
const startIndex = source.search( /const batches:/ );
const endIndex = source.search( /if\s*\(\s*Level_Phase\(\)\s*===\s*'playing'/ );
const body = source.slice( startIndex, endIndex );
assert( /if\s*\(\s*s\.tail\s*\)/.test( body ) );

// Execute the renderer's actual batching code, not a duplicate implementation.
const draw = new Function( 'materials', 'sprites', 'refdef', ts.transpile( body + '\nreturn data;' ) );
const fixture = JSON.parse(
	fs.readFileSync( 'artifacts/retail-menu-evidence/weapons/native-tail-vertices.json', 'utf8' )
);


// ---------------------------------------------------------------------------
// vertex position & atlas uv validation
// ---------------------------------------------------------------------------

for ( const c of fixture.cases ) {
	for ( const local of [false, true] ) {
		const shift = ( p ) => ( local ? p.map( ( v, i ) => v - c.eye[i] ) : p );
		const s = {
			shader: 'test',
			position: shift( c.start ),
			tailEnd: shift( c.end ),
			size: c.width,
			frame: c.frame,
			color: [1, 1, 1, 1],
			tail: true,
		};

		const values = draw(
			new Map( [['test', { atlas: c.atlas, sort: 0 }]] ),
			[{ sprite: s, mode: local ? 1 : 0 }],
			{ vieworg: c.eye }
		);

		assert.equal( values.length, 60 );

		for ( let i = 0; i < values.length; i += 10 ) {
			const uv = values.slice( i + 4, i + 6 );
			const native = c.vertices.find( ( v ) => v.uv.every( ( x, j ) => Math.abs( x - uv[j] ) < 1e-7 ) );
			assert( native, 'UV must match original atlas vertex' );

			shift( native.position ).forEach( ( v, j ) => {
				const delta = Math.abs( v - values[i + j] );
				assert( delta < 0.00001, JSON.stringify( { c, local, uv, native, actual: values.slice( i, i + 3 ) } ) );
			} );
		}
	}
}

console.log(
	'PASS: actual tail batches match native vertex positions and UVs in both renderer paths, world and attached coordinates'
);
