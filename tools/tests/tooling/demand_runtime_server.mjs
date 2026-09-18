/*
===============================================================================

	demand_runtime_server.mjs

	Native browser integration server. Only original fixtures are exposed.
	--dist exercises production worker chunks; tests are never copied to dist.
	No COOP/COEP headers: match ordinary static GitHub Pages hosting.

===============================================================================
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runtimeFiles } from '../../build/browser_assets_plugin.mjs';
import { normalizeBase } from '../../../browser/deployment.mjs';

const { values } = parseArgs( { options: { base: { type: 'string', default: '/' }, dist: { type: 'string' } } } );
const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '../../..' );
const base = normalizeBase( values.base );
const dist = values.dist ? path.resolve( root, values.dist ) : null;
const runtime = runtimeFiles( root, false, base );
const html = `<!doctype html><meta charset="utf-8"><title>Synthetic cache tests</title><script type="module" src="${base}browser/tests/demand-runtime.browser.mjs"></script>`;
let mediaFallbacks = 0;
const server = http.createServer( ( request, response ) => {
	const pathname = new URL( request.url, 'http://localhost' ).pathname;
	response.setHeader( 'Cache-Control', 'no-store' );
	if ( /^\/(?:assets|maps|characters|viewmodels|sound|weaponfx)\//.test( pathname ) && base !== '/' ) mediaFallbacks++;
	if ( !pathname.startsWith( base ) ) { response.writeHead( 404 ); response.end( 'Outside application scope' ); return; }
	const name = decodeURIComponent( pathname.slice( base.length ) );
	if ( name.includes( '\\' ) || name.split( '/' ).some( part => part === '..' || part === '.' ) ) { response.writeHead( 400 ); response.end(); return; }
	if ( name === 'test-server-stats' ) { response.setHeader( 'Content-Type', 'application/json' ); response.end( JSON.stringify( { mediaFallbacks } ) ); return; }
	if ( !name || name === 'empty.html' ) { response.setHeader( 'Content-Type', 'text/html' ); response.end( name ? '<!doctype html><title>Second tab</title>' : html ); return; }
	if ( /^(assets|maps|characters|viewmodels|sound|weaponfx)\//.test( name ) ) mediaFallbacks++;
	let bytes;
	if ( dist && ( /^(?:app-code|browser-runtime)\//.test( name ) || name === 'local-assets.sw.js' || name === 'launcher.html' ) ) {
		const file = path.join( dist, name === 'launcher.html' ? 'index.html' : name );
		if ( fs.existsSync( file ) && fs.statSync( file ).isFile() ) bytes = fs.readFileSync( file );
	} else bytes = runtime.get( name );
	if ( name === 'browser/deployment.mjs' ) bytes = runtime.get( 'browser-runtime/deployment.mjs' );
	if ( !bytes && /^browser\/[a-z0-9_./-]+\.mjs$/i.test( name ) ) {
		const source = path.join( root, name );
		if ( fs.existsSync( source ) && fs.statSync( source ).isFile() ) bytes = fs.readFileSync( source );
	}
	if ( !bytes ) { response.writeHead( 404 ); response.end( 'Not served by synthetic harness' ); return; }
	const type = name.endsWith( '.html' ) ? 'text/html' : name.endsWith( '.css' ) ? 'text/css' : name.endsWith( '.webp' ) ? 'image/webp' : name.endsWith( '.json' ) ? 'application/json' : 'text/javascript';
	response.setHeader( 'Content-Type', type );
	response.end( bytes );
} );
server.listen( 0, '127.0.0.1', () => console.log( `http://127.0.0.1:${server.address().port}${base}` ) );
