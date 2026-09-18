/*
===============================================================================

	test_movement_trace_server.mjs

	Call of Duty 2 / id Tech Movement Trace Receiver Self-Test
	Verifies localhost restriction, same-origin validation, schema enforcement,
	and payload persistence for the debug movement recording server.

===============================================================================
*/

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

import { movementTraceMiddleware } from '../../debug/movement_trace_server.mjs';


// ---------------------------------------------------------------------------
// test execution
// ---------------------------------------------------------------------------

const root = await fs.mkdtemp( path.join( os.tmpdir(), 'cod2-movement-receiver-' ) );
const middleware = movementTraceMiddleware( root );
const server = http.createServer( ( req, res ) => middleware( req, res, () => res.writeHead( 404 ).end() ) );

await new Promise( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
const url = `http://127.0.0.1:${server.address().port}/__debug/movement`;

try {
	const payload = {
		format: 'cod2-movement',
		version: 1,
		frames: [],
		contexts: [],
	};

	const response = await fetch( url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( payload ),
	} );

	assert.equal( response.status, 201 );

	const saved = await response.json();
	assert( saved.path.startsWith( 'temp/movement/cod2-movement-' ) );
	assert.deepEqual( JSON.parse( await fs.readFile( path.join( root, saved.path ), 'utf8' ) ), payload );

	for ( const [options, status] of [
		[{}, 405],
		[{ method: 'POST' }, 415],
		[{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 400],
		[
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
				body: JSON.stringify( payload ),
			},
			403,
		],
	] ) {
		assert.equal( ( await fetch( url, options ) ).status, status );
	}

	await fs.unlink( path.join( root, saved.path ) );
	console.log( 'PASS: automatic folder save, exact JSON contents, method/schema/content-type/origin validation' );
} finally {
	await new Promise( ( resolve ) => server.close( resolve ) );
	await fs.rm( root, { recursive: true, force: true } );
}
