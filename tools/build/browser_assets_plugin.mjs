/*
===============================================================================

	browser_assets_plugin.mjs

	Call of Duty 2 / id Tech Vite Local Asset Plugin
	Provides virtual runtime asset resolution for Vite development and production.
	Ensures proprietary game assets and archives are never bundled or leaked into build output.

===============================================================================
*/

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const PREFIX = '\0cod2-asset:';
const ROOTS = /^(assets|maps|viewmodels|characters|weaponfx|sound)\//;

export const STAGES = Object.freeze( [
	'fonts',
	'menus',
	'textures',
	'configuration',
	'audio',
	'mantle',
	'lighting',
	'weapons',
	'characters',
	'effects',
	'world',
].map( ( id ) => ( { id, runtime: ['fonts', 'menus', 'textures', 'configuration'].includes( id ) ? 'retail-pipeline.js' : 'retail-asset-compiler.js', phase: ['fonts', 'menus', 'textures', 'configuration'].includes( id ) ? 'bootstrap' : 'demand' } ) ) );


// ---------------------------------------------------------------------------
// specifier parsing
// ---------------------------------------------------------------------------

/*
====================
assetSpecifier

Parses an import specifier to determine if it targets a virtual local game asset:
- Distinguishes between JSON table imports and binary URL references.
- Rejects path traversal sequences and attempts to bundle proprietary file types.
====================
*/
export function assetSpecifier( specifier, root ) {
	const [plain, query = ''] = specifier.split( '?' );
	let relative;

	if ( plain.startsWith( '@/' ) ) {
		relative = plain.slice( 2 );
	} else if ( path.isAbsolute( plain ) ) {
		relative = path.relative( root, plain ).replaceAll( '\\', '/' );
	} else {
		return null;
	}

	if ( !ROOTS.test( relative ) ) {
		return null;
	}

	const parts = relative.split( '/' );

	for ( const part of parts ) {
		if ( !part || part === '.' || part === '..' || /[\\\0:]/.test( part ) ) {
			throw new Error( 'Unsafe virtual asset path.' );
		}
	}

	if ( /\.(exe|dll|iwd|iwi|d3dbsp)$/i.test( relative ) ) {
		throw new Error( 'Proprietary source archives cannot be bundled.' );
	}

	if ( query === 'url' ) {
		return { kind: 'url', path: relative };
	}

	if ( !query && relative.endsWith( '.json' ) ) {
		return { kind: 'json', path: relative };
	}

	throw new Error( `Game asset must use a runtime JSON or URL import: ${specifier}` );
}


// ---------------------------------------------------------------------------
// runtime files collection
// ---------------------------------------------------------------------------

/*
====================
runtimeFiles

Collects and transforms browser runtime scripts (db, storage, decoders, worker, service worker)
into memory buffers with computed SHA-256 manifests for local serving and deployment.
====================
*/
export function runtimeFiles( root, _production = false, base = '/' ) {
	const files = new Map();
	const sources = [];

	const add = ( source, destination, transform = ( text ) => text ) => {
		const bytes = fs.readFileSync( path.join( root, source ) );
		const sha256 = crypto.createHash( 'sha256' ).update( bytes ).digest( 'hex' );

		sources.push( { path: source, sha256 } );
		files.set( destination, Buffer.from( transform( bytes.toString( 'utf8' ) ) ) );
	};

	add( 'browser/deployment.mjs', 'browser-runtime/deployment.mjs', source => source.replace( "import.meta.env?.BASE_URL ?? '/'", JSON.stringify( base ) ) );

	for ( const name of ['db.mjs', 'storage.mjs', 'async.mjs', 'opfs-writer.mjs', 'retail-files.mjs', 'install.mjs', 'asset-routing.mjs', 'demand-cache.mjs', 'source-files.mjs'] ) {
		add( `browser/${name}`, `browser-runtime/${name}` );
	}

	const decodersDir = path.join( root, 'browser/decoders' );
	const decoderFiles = fs.readdirSync( decodersDir ).sort();

	for ( const name of decoderFiles ) {
		if ( !name.endsWith( '.ts' ) ) {
			continue;
		}

		add(
			`browser/decoders/${name}`,
			`browser-runtime/${name.replace( /\.ts$/, '.js' )}`,
			( source ) => ts.transpileModule( source, {
				compilerOptions: {
					module: ts.ModuleKind.ESNext,
					target: ts.ScriptTarget.ES2022,
					removeComments: true,
				},
			} ).outputText
		);
	}

	for ( const name of ['import', 'demand'] ) {
		add( `browser/runtime/${name}.worker.js`, `browser-runtime/${name}.worker.js`,
			source => source.replaceAll( "'../decoders/", "'./" ).replaceAll( "'../", "'./" ) );
	}

	add(
		'browser/local-assets.sw.mjs',
		'local-assets.sw.js',
		( source ) => source.replaceAll( "'./", "'./browser-runtime/" )
	);

	const manifest = {
		version: 1,
		runtime: 'typescript',
		stages: STAGES,
		sources,
	};

	files.set( 'browser-runtime/manifest.json', Buffer.from( JSON.stringify( manifest ) ) );

	return files;
}


// ---------------------------------------------------------------------------
// vite plugin factory
// ---------------------------------------------------------------------------

/*
====================
browserAssetsPlugin

Creates the Vite plugin that intercepts virtual asset imports and serves
the browser-runtime files without leaking proprietary assets into production bundles.
====================
*/
export function browserAssetsPlugin( root ) {
	let production = false;
	let base = '/';
	let runtime;

	return {
		name: 'cod2-local-only-assets',
		enforce: 'pre',

		configResolved( config ) {
			production = config.command === 'build';
			base = config.base;
		},

		resolveId( specifier ) {
			if ( specifier.startsWith( PREFIX ) ) {
				return specifier;
			}

			const asset = assetSpecifier( specifier, root );

			return asset ? PREFIX + JSON.stringify( asset ) : null;
		},

		load( id ) {
			if ( !id.startsWith( PREFIX ) ) {
				return null;
			}

			const asset = JSON.parse( id.slice( PREFIX.length ) );
			const fn = asset.kind === 'json' ? 'Asset_JSON' : 'Asset_URL';
			const runtimeAssetsPath = JSON.stringify( path.join( root, 'browser/runtime-assets.ts' ).replaceAll( '\\', '/' ) );

			return `import { ${fn} } from ${runtimeAssetsPath};\nexport default ${fn}(${JSON.stringify( asset.path )});`;
		},

		buildStart() {
			runtime = runtimeFiles( root, production, base );

			if ( production ) {
				for ( const name of ['import', 'demand'] ) this.emitFile( {
					type: 'chunk', id: path.join( root, `browser/runtime/${name}.worker.js` ),
					fileName: `browser-runtime/${name}.worker.js`,
				} );
			}
		},

		generateBundle( _options, bundle ) {
			for ( const [name, file] of Object.entries( bundle || {} ) ) {
				if ( /\.(exe|dll|iwd|iwi|d3dbsp)$/i.test( name ) ) {
					throw new Error( `Proprietary asset leaked into build: ${name}` );
				}

				if ( file.type === 'chunk' && file.modules ) {
					for ( const mod of Object.keys( file.modules ) ) {
						const normalized = mod.replaceAll( '\\', '/' );

						if ( normalized.includes( '/assets/' ) && !normalized.includes( 'runtime-assets' ) ) {
							throw new Error( `Asset file escaped into chunk: ${mod}` );
						}
					}
				}
			}

			for ( const [fileName, source] of runtime || runtimeFiles( root, true, base ) ) {
				// Rollup bundles the dedicated worker and its decoder graph for production.
				if ( /^browser-runtime\/(import|demand)\.worker\.js$/.test( fileName ) ) {
					continue;
				}

				this.emitFile( {
					type: 'asset',
					fileName,
					source,
				} );
			}
		},

		configureServer( server ) {
			const serve = ( request, response, next ) => {
				const pathname = ( request.url || '' ).split( '?' )[0];
				const name = pathname.startsWith( base ) ? pathname.slice( base.length ) : pathname.slice( 1 );
				const data = runtime?.get( name );

				if ( !data ) {
					return next();
				}

				response.setHeader( 'Content-Type', name.endsWith( '.json' ) ? 'application/json' : 'text/javascript' );
				response.setHeader( 'Cache-Control', 'no-store' );
				response.end( data );
			};

			server.middlewares.use( serve );

			server.watcher.on( 'change', ( filename ) => {
				if ( filename.startsWith( path.join( root, 'browser' ) ) ) {
					runtime = runtimeFiles( root, false, base );
				}
			} );
		},
	};
}
