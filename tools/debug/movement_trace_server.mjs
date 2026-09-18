/*
===============================================================================

	movement_trace_server.mjs

	Call of Duty 2 / id Tech Local Movement Trace Server Middleware
	Provides an explicit local-only HTTP POST endpoint for capturing client
	recorded movement streams and persisting them to temp/movement.

===============================================================================
*/

import fs from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const MAX_TRACE_BYTES = 16 * 1024 * 1024; // 16 MB limit
const ALLOWED_ADDRESSES = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];


// ---------------------------------------------------------------------------
// trace server middleware
// ---------------------------------------------------------------------------

/*
====================
movementTraceMiddleware

Express/Connect style middleware for saving development flight recorder traces.
====================
*/
export function movementTraceMiddleware( root ) {
	return ( request, response, next ) => {
		if ( ( request.url || '' ).split( '?' )[0] !== '/__debug/movement' ) {
			return next();
		}

		const address = request.socket.remoteAddress;
		if ( !ALLOWED_ADDRESSES.includes( address ) ) {
			response.statusCode = 403;
			response.end( 'Local requests only.' );
			return;
		}

		if ( request.method !== 'POST' ) {
			response.statusCode = 405;
			response.end( 'POST requests only.' );
			return;
		}

		const origin = request.headers.origin;
		if ( origin ) {
			try {
				if ( new URL( origin ).host !== request.headers.host ) {
					throw new Error();
				}
			} catch {
				response.statusCode = 403;
				response.end( 'Same-origin requests only.' );
				return;
			}
		}

		const contentType = request.headers['content-type'] || '';
		if ( !contentType.startsWith( 'application/json' ) ) {
			response.statusCode = 415;
			response.end( 'Unsupported Media Type: expected application/json' );
			return;
		}

		const chunks = [];
		let size = 0;
		let oversized = false;

		request.on( 'data', ( chunk ) => {
			size += chunk.length;
			if ( size > MAX_TRACE_BYTES ) {
				oversized = true;
				return;
			}
			chunks.push( chunk );
		} );

		request.on( 'end', async () => {
			if ( oversized ) {
				response.statusCode = 413;
				response.end( 'Trace too large.' );
				return;
			}

			try {
				const text = Buffer.concat( chunks ).toString( 'utf8' );
				const data = JSON.parse( text );

				if ( data.format !== 'cod2-movement' || typeof data.version !== 'number' ) {
					response.statusCode = 400;
					response.end( 'Invalid trace schema.' );
					return;
				}

				const dir = path.join( root, 'temp/movement' );
				await fs.mkdir( dir, { recursive: true } );

				const name = `cod2-movement-${Date.now()}.json`;
				await fs.writeFile( path.join( dir, name ), text );

				response.statusCode = 201;
				response.setHeader( 'Content-Type', 'application/json' );
				response.end( JSON.stringify( { path: `temp/movement/${name}` } ) );
			} catch {
				response.statusCode = 400;
				response.end( 'Invalid trace or local write failed.' );
			}
		} );
	};
}
