/*
===============================================================================

	demand_runtime_server.mjs

	Synthetic integration harness. Serves the exact emitted worker/SW modules.
	It intentionally never exposes temp/, retail files, or the engine to tests.

===============================================================================
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeFiles } from '../../build/browser_assets_plugin.mjs';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '../../..' );
const runtime = runtimeFiles( root );
const html = '<!doctype html><meta charset="utf-8"><title>Synthetic CoD2 cache tests</title><script type="module" src="/browser/tests/demand-runtime.browser.mjs"></script>';
let mediaFallbacks = 0;
const server = http.createServer( ( request, response ) => {
	const name = decodeURIComponent( new URL( request.url, 'http://localhost' ).pathname ).slice( 1 );
	response.setHeader( 'Cache-Control', 'no-store' );
	response.setHeader( 'Cross-Origin-Opener-Policy', 'same-origin' );
	response.setHeader( 'Cross-Origin-Embedder-Policy', 'require-corp' );
	if ( name === 'test-server-stats' ) { response.setHeader( 'Content-Type', 'application/json' ); response.end( JSON.stringify( { mediaFallbacks } ) ); return; }
	if ( !name || name === 'empty.html' ) { response.setHeader( 'Content-Type', 'text/html' ); response.end( name ? '<!doctype html><title>Second tab</title>' : html ); return; }
	if ( /^(assets|maps|characters|viewmodels|sound|weaponfx)\//.test( name ) ) mediaFallbacks++;
	let bytes = runtime.get( name );
	if ( !bytes && /^browser\/[a-z0-9_./-]+\.mjs$/i.test( name ) && !name.split( '/' ).includes( '..' ) ) {
		const source = path.join( root, name );
		if ( fs.existsSync( source ) ) bytes = fs.readFileSync( source );
	}
	if ( !bytes ) { response.writeHead( 404 ); response.end( 'Not served by synthetic harness' ); return; }
	response.setHeader( 'Content-Type', name.endsWith( '.json' ) ? 'application/json' : 'text/javascript' );
	response.end( bytes );
} );
server.listen( 0, '127.0.0.1', () => console.log( `http://127.0.0.1:${server.address().port}/` ) );
