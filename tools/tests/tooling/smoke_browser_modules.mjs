/*
===============================================================================

	smoke_browser_modules.mjs

	Call of Duty 2 / id Tech Browser Module Output Smoke Verifier
	Validates dist build integrity:
	- Verifies file sizes and SHA256 hashes against build_manifest.json.
	- Links module graph with vm.SourceTextModule to detect broken imports.
	- Launches local ephemeral HTTP server to test MIME types and content delivery.

===============================================================================
*/

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isInside, sha256Hex } from '../../lib/ts_project.mjs';

// ---------------------------------------------------------------------------
// constants & paths
// ---------------------------------------------------------------------------

const MODULE_DIR = path.dirname( fileURLToPath( import.meta.url ) );
const DEFAULT_DIST = path.resolve( MODULE_DIR, '../../../dist' );


// ---------------------------------------------------------------------------
// argument parsing & path helpers
// ---------------------------------------------------------------------------

/*
====================
parseArguments

Parses CLI flags for target distribution directory.
====================
*/
function parseArguments( argv ) {
	let dist = DEFAULT_DIST;

	for ( let index = 0; index < argv.length; index += 1 ) {
		if ( argv[index] !== '--dist' ) {
			throw new Error( `unknown argument: ${argv[index]}` );
		}
		if ( !argv[index + 1] ) {
			throw new Error( '--dist requires a directory' );
		}
		dist = path.resolve( argv[index + 1] );
		index += 1;
	}

	return { dist };
}


// ---------------------------------------------------------------------------
// manifest verification
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// manifest verification
// ---------------------------------------------------------------------------

/*
====================
readManifest

Reads and parses build_manifest.json from the build output directory.
====================
*/
function readManifest( dist ) {
	const manifestPath = path.join( dist, 'build_manifest.json' );
	if ( !fs.existsSync( manifestPath ) ) {
		throw new Error( 'dist/build_manifest.json is missing; run the browser module build first' );
	}

	const manifest = JSON.parse( fs.readFileSync( manifestPath, 'utf8' ) );
	if ( manifest.schemaVersion !== 1 || typeof manifest.entry !== 'string' || !Array.isArray( manifest.files ) ) {
		throw new Error( 'dist/build_manifest.json has an unsupported schema' );
	}

	return manifest;
}

/*
====================
verifyManifest

Validates on-disk files against sizes and cryptographic hashes listed in manifest.
====================
*/
function verifyManifest( dist, manifest ) {
	const issues = [];
	const listed = new Set();

	for ( const entry of manifest.files ) {
		if ( !entry || typeof entry.path !== 'string' || typeof entry.bytes !== 'number' || typeof entry.sha256 !== 'string' ) {
			issues.push( 'manifest contains an invalid file entry' );
			continue;
		}

		if ( listed.has( entry.path ) ) {
			issues.push( `manifest lists ${entry.path} more than once` );
			continue;
		}

		listed.add( entry.path );
		const absolute = path.resolve( dist, entry.path );

		if ( !isInside( dist, absolute ) ) {
			issues.push( `manifest path escapes dist: ${entry.path}` );
			continue;
		}

		if ( !fs.existsSync( absolute ) || !fs.statSync( absolute ).isFile() ) {
			issues.push( `manifest file is missing: ${entry.path}` );
			continue;
		}

		const bytes = fs.readFileSync( absolute );
		if ( bytes.byteLength !== entry.bytes ) {
			issues.push( `manifest size mismatch for ${entry.path}` );
		}
		if ( sha256Hex( bytes ) !== entry.sha256 ) {
			issues.push( `manifest hash mismatch for ${entry.path}` );
		}
	}

	const actual = [];
	const visit = ( directory ) => {
		const entries = fs.readdirSync( directory, { withFileTypes: true } )
			.sort( ( a, b ) => a.name.localeCompare( b.name ) );

		for ( const item of entries ) {
			const absolute = path.join( directory, item.name );
			if ( item.isDirectory() ) {
				visit( absolute );
			} else if ( item.isFile() && item.name !== 'build_manifest.json' ) {
				actual.push( path.relative( dist, absolute ).split( path.sep ).join( '/' ) );
			}
		}
	};

	visit( dist );

	for ( const relative of actual ) {
		if ( !listed.has( relative ) ) {
			issues.push( `dist contains an unmanifested file: ${relative}` );
		}
	}

	for ( const relative of listed ) {
		if ( !actual.includes( relative ) ) {
			issues.push( `manifest contains a non-file entry: ${relative}` );
		}
	}

	if ( issues.length > 0 ) {
		throw new Error( `dist manifest verification failed:\n${issues.map( ( issue ) => `  - ${issue}` ).join( '\n' )}` );
	}
}


// ---------------------------------------------------------------------------
// module graph linking
// ---------------------------------------------------------------------------

/*
====================
linkModuleGraph

Compiles and links all ES modules in vm.SourceTextModule context to detect missing exports.
====================
*/
export async function linkModuleGraph( dist, manifest ) {
	if ( typeof vm.SourceTextModule !== 'function' ) {
		throw new Error( 'vm.SourceTextModule is unavailable; invoke Node with --experimental-vm-modules' );
	}

	const cache = new Map();
	const getModule = ( absolute ) => {
		const normalized = path.resolve( absolute );
		if ( !isInside( dist, normalized ) ) {
			throw new Error( `module graph escapes dist: ${normalized}` );
		}

		const existing = cache.get( normalized );
		if ( existing ) {
			return existing;
		}

		if ( !fs.existsSync( normalized ) || !fs.statSync( normalized ).isFile() ) {
			throw new Error( `module graph target is missing: ${path.relative( dist, normalized )}` );
		}

		const code = fs.readFileSync( normalized, 'utf8' );
		const module = new vm.SourceTextModule( code, {
			identifier: pathToFileURL( normalized ).href,
			initializeImportMeta( meta, sourceModule ) {
				meta.url = sourceModule.identifier;
			},
		} );

		cache.set( normalized, module );
		return module;
	};

	const entryPath = path.resolve( dist, manifest.entry );
	if ( !isInside( dist, entryPath ) ) {
		throw new Error( `manifest entry escapes dist: ${manifest.entry}` );
	}

	const entry = getModule( entryPath );
	await entry.link( ( specifier, referencingModule ) => {
		if ( !( specifier.startsWith( './' ) || specifier.startsWith( '../' ) ) ) {
			throw new Error( `module graph contains a bare import: ${specifier}` );
		}

		const targetUrl = new URL( specifier, referencingModule.identifier );
		if ( targetUrl.protocol !== 'file:' ) {
			throw new Error( `module graph contains a non-file import: ${specifier}` );
		}

		return getModule( fileURLToPath( targetUrl ) );
	} );

	const expectedModules = manifest.files
		.filter( ( entryInfo ) => entryInfo.kind === 'module' )
		.map( ( entryInfo ) => path.resolve( dist, entryInfo.path ) );

	const unreachable = expectedModules.filter( ( absolute ) => !cache.has( absolute ) );
	const runtimeUnreachable = [];
	let typeShells = 0;

	for ( const absolute of unreachable ) {
		const code = fs.readFileSync( absolute, 'utf8' );
		const sourceFile = new vm.SourceTextModule( code, { identifier: pathToFileURL( absolute ).href } );

		// TypeScript emits `export {};` for source files containing only erased types
		if ( /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*export\s*\{\s*\}\s*;?\s*$/.test( code ) ) {
			void sourceFile;
			typeShells += 1;
		} else {
			runtimeUnreachable.push( path.relative( dist, absolute ).split( path.sep ).join( '/' ) );
		}
	}

	if ( runtimeUnreachable.length > 0 ) {
		throw new Error(
			`browser build contains runtime modules unreachable from ${manifest.entry}:\n` +
			runtimeUnreachable.map( ( file ) => `  - ${file}` ).join( '\n' ),
		);
	}

	return { linked: cache.size, typeShells };
}


// ---------------------------------------------------------------------------
// http server & delivery verification
// ---------------------------------------------------------------------------

/*
====================
mimeType

Determines the MIME content type by file extension for HTTP testing.
====================
*/
function mimeType( file ) {
	switch ( path.extname( file ).toLowerCase() ) {
		case '.html': return 'text/html; charset=utf-8';
		case '.js': return 'text/javascript; charset=utf-8';
		case '.json': return 'application/json; charset=utf-8';
		case '.png': return 'image/png';
		case '.svg': return 'image/svg+xml';
		case '.ico': return 'image/x-icon';
		case '.mp3': return 'audio/mpeg';
		case '.wav': return 'audio/wav';
		case '.bc3': return 'application/octet-stream';
		default: return 'application/octet-stream';
	}
}

/*
====================
startServer

Starts an ephemeral local HTTP server serving files out of the dist directory.
====================
*/
function startServer( dist ) {
	const server = http.createServer( ( request, response ) => {
		try {
			const requestUrl = new URL( request.url ?? '/', 'http://127.0.0.1' );
			const pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
			const decoded = decodeURIComponent( pathname );
			const absolute = path.resolve( dist, `.${decoded}` );

			if ( !isInside( dist, absolute ) ) {
				response.writeHead( 403 ).end( 'forbidden' );
				return;
			}

			if ( !fs.existsSync( absolute ) || !fs.statSync( absolute ).isFile() ) {
				response.writeHead( 404 ).end( 'not found' );
				return;
			}

			const bytes = fs.readFileSync( absolute );
			response.writeHead( 200, {
				'Content-Type': mimeType( absolute ),
				'Content-Length': bytes.byteLength,
				'Cache-Control': 'no-store',
			} );
			response.end( bytes );
		} catch ( error ) {
			response.writeHead( 500 ).end( error instanceof Error ? error.message : String( error ) );
		}
	} );

	return new Promise( ( resolve, reject ) => {
		server.once( 'error', reject );
		server.listen( 0, '127.0.0.1', () => {
			const address = server.address();
			if ( !address || typeof address === 'string' ) {
				reject( new Error( 'HTTP smoke server did not expose a TCP address' ) );
				return;
			}
			resolve( { server, origin: `http://127.0.0.1:${address.port}` } );
		} );
	} );
}

/*
====================
verifyHttpDelivery

Requests all manifested assets over HTTP to verify mime types, integrity, and HTML script tags.
====================
*/
export async function verifyHttpDelivery( dist, manifest ) {
	const { server, origin } = await startServer( dist );

	try {
		const targets = [
			{ path: 'build_manifest.json', bytes: fs.readFileSync( path.join( dist, 'build_manifest.json' ) ) },
			...manifest.files.map( ( entry ) => ( { path: entry.path, bytes: fs.readFileSync( path.join( dist, entry.path ) ) } ) ),
		];

		for ( const target of targets ) {
			const response = await fetch( `${origin}/${target.path}` );
			if ( !response.ok ) {
				throw new Error( `HTTP ${response.status} for ${target.path}` );
			}

			const delivered = Buffer.from( await response.arrayBuffer() );
			if ( sha256Hex( delivered ) !== sha256Hex( target.bytes ) ) {
				throw new Error( `HTTP delivery changed bytes for ${target.path}` );
			}

			if ( target.path.endsWith( '.js' ) && !( response.headers.get( 'content-type' ) ?? '' ).startsWith( 'text/javascript' ) ) {
				throw new Error( `HTTP delivery uses the wrong JavaScript MIME type for ${target.path}` );
			}
		}

		const indexResponse = await fetch( `${origin}/` );
		const html = await indexResponse.text();

		const moduleMatch = /<script\s+[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*>/i.exec( html ) ??
			/<script\s+[^>]*src=["']([^"']+)["'][^>]*type=["']module["'][^>]*>/i.exec( html );

		if ( !moduleMatch ) {
			throw new Error( 'served index.html has no module entry' );
		}

		const entryUrl = new URL( moduleMatch[1], `${origin}/` ).href;
		const expectedUrl = new URL( manifest.entry, `${origin}/` ).href;

		if ( entryUrl !== expectedUrl ) {
			throw new Error( `served module entry ${entryUrl} does not match manifest entry ${expectedUrl}` );
		}

		return targets.length;
	} finally {
		await new Promise( ( resolve ) => server.close( resolve ) );
	}
}

/*
====================
smokeBrowserModules

Main entrypoint for smoking the built distribution directory.
====================
*/
export async function smokeBrowserModules( dist = DEFAULT_DIST ) {
	const manifest = readManifest( dist );
	verifyManifest( dist, manifest );
	const graph = await linkModuleGraph( dist, manifest );
	const deliveredFiles = await verifyHttpDelivery( dist, manifest );
	return { manifest, graph, deliveredFiles };
}


// ---------------------------------------------------------------------------
// cli execution
// ---------------------------------------------------------------------------

/*
====================
main

CLI invocation entry point.
====================
*/
async function main() {
	const { dist } = parseArguments( process.argv.slice( 2 ) );
	const result = await smokeBrowserModules( dist );

	console.log(
		`browser module smoke: ok (${result.graph.linked} linked modules, ${result.graph.typeShells} type-only shells, ` +
		`${result.deliveredFiles} HTTP files, ${result.manifest.files.length} manifested files)`,
	);
}

if ( fileURLToPath( import.meta.url ) === path.resolve( process.argv[1] ?? '' ) ) {
	try {
		await main();
	} catch ( error ) {
		console.error( error instanceof Error ? error.message : String( error ) );
		process.exitCode = 1;
	}
}
