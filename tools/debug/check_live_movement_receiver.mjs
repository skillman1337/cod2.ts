/*
===============================================================================

	check_live_movement_receiver.mjs

	Call of Duty 2 / id Tech Live Movement Trace Receiver Smoke Test
	Posts synthetic movement recording frames to local development server endpoint
	and verifies disk persistence and cleanup.

===============================================================================
*/

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// ---------------------------------------------------------------------------
// live endpoint test
// ---------------------------------------------------------------------------

const response = await fetch( 'http://127.0.0.1:5173/__debug/movement', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify( {
		format: 'cod2-movement',
		version: 1,
		frames: [],
		contexts: [],
		test: 'live receiver',
	} ),
} );

assert.equal( response.status, 201 );

const saved = await response.json();
const savedContent = JSON.parse( await fs.readFile( saved.path, 'utf8' ) );

assert.equal( savedContent.test, 'live receiver' );

await fs.unlink( saved.path );

console.log( 'PASS: user development server saves to ' + saved.path );
