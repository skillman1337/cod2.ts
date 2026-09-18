/*
===============================================================================

	local-assets.sw.mjs

	Call of Duty 2 / id Tech Service Worker Virtual Asset Interceptor
	Intercepts browser fetch requests for game assets, serving them directly
	from OPFS local cache with range slicing, LRU lookup caching, and fallbacks.

===============================================================================
*/

import { assetRoute } from './asset-routing.mjs';
import { readUnit } from './demand-cache.mjs';
import { transaction, getSetting } from './db.mjs';
import { validateGeneration, safePath, safeGeneration, assetResponse } from './storage.mjs';


// ---------------------------------------------------------------------------
// globals & LRU acceleration caches
// ---------------------------------------------------------------------------

// Small, restart-safe accelerators. IDB remains authoritative after worker eviction.
const clients = new Map();
const generations = new Map();


// ---------------------------------------------------------------------------
// cache helpers
// ---------------------------------------------------------------------------

/*
====================
remember

Adds an entry to an LRU map, evicting the oldest key once the limit is reached.
====================
*/
function remember( map, key, value, limit ) {
	map.delete( key );

	if ( map.size >= limit ) {
		const oldestKey = map.keys().next().value;
		map.delete( oldestKey );
	}

	map.set( key, value );

	return value;
}

/*
====================
generation

Retrieves and caches a generation validation promise.
Verifies the commit marker without re-reading every asset up front.
====================
*/
function generation( id ) {
	safeGeneration( id );

	if ( !generations.has( id ) ) {
		// The page performed full validation. Verify the commit marker here, then
		// check actual file sizes on fetch instead of opening every asset twice.
		const pending = validateGeneration( id, { full: false } );

		remember( generations, id, pending, 8 );
		pending.catch( () => generations.delete( id ) );
	}

	return generations.get( id );
}

/*
====================
clientGeneration

Looks up the active cache generation ID assigned to a specific window client.
Queries the 'bindings' store first, falling back to the global 'active' setting.
====================
*/
async function clientGeneration( clientId ) {
	if ( clients.has( clientId ) ) {
		return clients.get( clientId );
	}

	const boundId = await transaction( 'bindings', 'readonly', ( store ) => store.get( clientId ) );
	const id = boundId || ( await getSetting( 'active' ) );

	if ( id ) {
		remember( clients, clientId, id, 128 );
	}

	return id;
}


// ---------------------------------------------------------------------------
// service worker lifecycle
// ---------------------------------------------------------------------------

self.addEventListener( 'install', () => {
	self.skipWaiting();
} );

self.addEventListener( 'activate', ( event ) => {
	event.waitUntil( self.clients.claim() );
} );

self.addEventListener( 'message', ( event ) => {
	if ( event.data?.type === 'cod2-forget' ) {
		clients.clear();
		generations.clear();
		return;
	}

	if ( event.data?.type !== 'cod2-bind' || !event.source?.id ) {
		return;
	}

	event.waitUntil( ( async () => {
		try {
			const { manifest } = await generation( event.data.id );

			await transaction( 'bindings', 'readwrite', ( store ) => store.put( manifest.id, event.source.id ) );
			remember( clients, event.source.id, manifest.id, 128 );
			event.ports[0]?.postMessage( { ok: true } );
		} catch ( error ) {
			event.ports[0]?.postMessage( { ok: false, error: error.message } );
		}
	} )() );
} );


// ---------------------------------------------------------------------------
// fetch event interception
// ---------------------------------------------------------------------------

self.addEventListener( 'fetch', ( event ) => {
	const request = event.request;
	const url = new URL( request.url );

	if ( url.origin !== self.location.origin || !['GET', 'HEAD'].includes( request.method ) ) {
		return;
	}

	const scope = new URL( self.registration?.scope ?? '/', self.location.origin ).pathname;
	if ( !url.pathname.startsWith( scope ) ) return;
	const localPath = '/' + url.pathname.slice( scope.length );
	const explicit = localPath.startsWith( '/__cod2_local/' );
	const legacy = /^\/(assets|maps|viewmodels|characters|weaponfx|sound)\//.test( localPath )
		|| /^\/(cod2|favicon)\.ico$/.test( localPath );

	if ( !explicit && !legacy ) {
		return;
	}

	event.respondWith( ( async () => {
		try {
			let path = decodeURIComponent( localPath.slice( 1 ) );
			let id;

			if ( explicit ) {
				const parts = path.split( '/' );
				id = parts[1];
				path = parts.slice( 2 ).join( '/' );
			} else {
				id = await clientGeneration( event.clientId );
			}

			safePath( path );

			if ( !id ) {
				if ( /^(cod2|favicon)\.ico$/.test( path ) ) {
					return new Response( null, { status: 204 } );
				}

				return new Response( 'Select a local CoD2 installation before requesting game assets.', { status: 409 } );
			}

			const cache = await generation( id );

			const respond = ( assetPath ) => {
				if ( !cache.sizes.has( assetPath ) ) {
					throw new DOMException( 'Asset is not in the completed cache manifest.', 'NotFoundError' );
				}

				return assetResponse( request, cache.root, assetPath, {
					read: cache.read,
					expectedSize: cache.sizes.get( assetPath ),
				} );
			};

			if ( cache.sizes.has( path ) ) return await respond( path );

			// Legacy caches stored UI aliases twice. Prefer either completed copy.
			if ( path.startsWith( 'assets/images/' ) ) {
				const alias = path.replace( /([^/]+)$/, name => name.startsWith( 'menu_' ) ? name.slice( 5 ) : 'menu_' + name );
				if ( cache.sizes.has( alias ) ) return await respond( alias );
			}
			if ( /^(cod2|favicon)\.ico$/.test( path ) ) return new Response( null, { status: 204 } );
			const route = assetRoute( path );
			let unit = await readUnit( id, route, route.kind === 'map' && path.endsWith( '/manifest.json' ) );
			let source = 'unit-hit';
			if ( !unit ) {
				const client = await self.clients.get( event.clientId );
				if ( !client || await clientGeneration( client.id ) !== id ) throw new DOMException( 'No matching page can prepare this asset.', 'NotAllowedError' );
				await new Promise( ( resolve, reject ) => {
					const channel = new MessageChannel();
					const finish = () => { clearTimeout( timer ); channel.port1.close(); };
					const timer = setTimeout( () => { finish(); reject( new Error( 'Asset preparation timed out.' ) ); }, 330000 );
					channel.port1.onmessage = reply => {
						finish();
						if ( reply.data?.ok ) resolve();
						else reject( new DOMException( reply.data?.error || 'Asset preparation failed.', reply.data?.name || 'OperationError' ) );
					};
					client.postMessage( { type: 'cod2-demand', id, path }, [channel.port2] );
				} );
				unit = await readUnit( id, route );
				source = 'compiled';
				if ( !unit ) throw new Error( 'Asset compiler returned without a complete cache unit.' );
			}
			const response = await assetResponse( request, unit.root, route.path, { read: unit.read, expectedSize: unit.sizes.get( route.path ) } );
			response.headers.set( 'X-CoD2-Cache', source );
			return response;
		} catch ( error ) {
			const status = error.name === 'NotFoundError'
				? 404
				: error.name === 'NotAllowedError'
					? 403
					: error.name === 'SecurityError'
					? 400
					: 500;

			return new Response( error.message, { status } );
		}
	} )() );
} );
