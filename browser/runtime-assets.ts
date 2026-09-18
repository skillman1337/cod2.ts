/*
===============================================================================

	runtime-assets.ts

	Call of Duty 2 / id Tech Virtual Asset Runtime Resolver
	Provides in-memory caching and URL resolution for extracted assets,
	replacing compile-time proprietary asset bundling with OPFS local references.

===============================================================================
*/


import { APP_BASE } from './deployment.mjs';
import { Asset_SetBase } from '../engine/common/asset_paths.js';

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const ASSET_PREFIX = APP_BASE + '__cod2_local';
export const GENERATION_UUID_PATTERN = /^[a-f0-9-]{36}$/;


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

let generation: string | null = null;
let jsonAssets: ReadonlyMap<string, unknown> = new Map();


// ---------------------------------------------------------------------------
// asset resolution API
// ---------------------------------------------------------------------------

/*
====================
Asset_Initialize

Binds the active cache generation UUID and the parsed in-memory JSON definition tables.
Must be called prior to initializing or evaluating game engine modules.
====================
*/
export function Asset_Initialize( id: string, json: ReadonlyMap<string, unknown> ): void {
	if ( !GENERATION_UUID_PATTERN.test( id ) ) {
		throw new Error( 'Invalid local asset generation.' );
	}

	Asset_SetBase( APP_BASE );
	generation = id;
	jsonAssets = json;
}

/*
====================
Asset_JSON

Synchronously retrieves a parsed JSON asset definition from the in-memory cache.
Throws if local assets have not been initialized or if the path is unknown.
====================
*/
export function Asset_JSON( path: string ): unknown {
	if ( !generation || !jsonAssets.has( path ) ) {
		throw new Error( `Local JSON was not initialized: ${path}` );
	}

	return jsonAssets.get( path );
}

/*
====================
Asset_URL

Synthesizes a virtual URL path to stream a binary asset via the local Service Worker.
Rejects uninitialized state and unsafe directory traversal sequences.
====================
*/
export function Asset_URL( path: string ): string {
	if ( !generation ) {
		throw new Error( 'Local assets must be initialized before importing the engine.' );
	}

	const parts = path.replace( /^\//, '' ).split( '/' );

	for ( const part of parts ) {
		if ( !part || part === '.' || part === '..' || /[\\\0:]/.test( part ) ) {
			throw new Error( 'Unsafe asset URL.' );
		}
	}

	const encoded = parts.map( encodeURIComponent ).join( '/' );

	return `${ASSET_PREFIX}/${generation}/${encoded}`;
}
