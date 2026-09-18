/*
===============================================================================

	retail-model.test.mjs

	Call of Duty 2 / id Tech XModel Mesh Decoder Tests
	Validates direct binary vertex unpack, bone influence weights,
	tangent spaces, and multi-surface mesh extraction.

===============================================================================
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { unpackSurfaceDirect } from '../decoders/retail-model.ts';


// ---------------------------------------------------------------------------
// test suites
// ---------------------------------------------------------------------------

test( 'unpackSurfaceDirect unpacks Call of Duty 2 surface without native emulation', ( t ) => {
	const file = path.join( process.cwd(), 'tmp_surfs.bin' );

	if ( !fs.existsSync( file ) ) {
		t.skip( 'Optional tmp_surfs.bin fixture was not supplied.' );
		return;
	}

	const data = fs.readFileSync( file );
	const result = unpackSurfaceDirect( data, 4 );

	assert.equal( result.nv, 177 );
	assert.equal( result.nt, 138 );
	assert.equal( result.bone, -1 );
	assert.equal( result.vertices.length, 177 );
	assert.equal( result.indices.length, 138 * 3 );

	// Check first vertex attributes
	const v0 = result.vertices[0];
	assert.equal( v0.normal.length, 3 );
	assert.equal( v0.tangent.length, 3 );
	assert.equal( v0.binormal.length, 3 );
	assert.equal( v0.uv.length, 2 );
	assert.ok( v0.influences.length >= 1 );
	assert.equal( v0.influences[0].localPos.length, 3 );

	// Verify second surface
	const result2 = unpackSurfaceDirect( data, result.offset );
	assert.ok( result2.nv > 0 );
	assert.ok( result2.indices.length > 0 );
	assert.equal( result2.vertices.length, result2.nv );
} );
