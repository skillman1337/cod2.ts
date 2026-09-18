/*
===============================================================================

	storage.mjs

	Call of Duty 2 / id Tech Local Asset Storage & OPFS Cache
	Origin-Private File System (OPFS) persistence, handle coalescing,
	cache generation lifecycle, integrity validation, and HTTP range streaming.

===============================================================================
*/

import { getSetting, putSetting } from './db.mjs';
import { mapLimit } from './async.mjs';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const CACHE_VERSION = 5;
export const CACHE_FOLDER = 'cod2-local-assets-v5';

export const REQUIRED_FILES = [
	'assets/ui/menus.json',
	'assets/ui/hud.json',
	'assets/ui/strings.json',
	'assets/ui/configs.json',
	'assets/ui/defaults.json',
	'assets/ui/providers.json',
	'assets/ui/materials.json',
	'assets/ui/surfaces.json',
	'assets/ui/stance.json',
	'assets/ui/mantle.json',
	'assets/ui/dvars.json',
	'assets/ui/weapons.json',
	...['smallFont', 'normalFont', 'bigFont', 'extraBigFont', 'consoleFont'].map( ( name ) => `assets/fonts/${name}.json` ),
	'assets/images/gamefonts.png',
	'assets/images/gamefonts.bc3',
	'assets/images/3_cursor3.png',
	'assets/images/background_american_w.png',
	'assets/sound/music/menu_GRTEMP.mp3',
	'assets/sound/misc/mouse_ylover.wav',
	'assets/sound/misc/mouse_ylselect.wav',

];

export const MENU_LAYOUT = 'menu-first-v1';

export const JSON_FILES = REQUIRED_FILES.filter( ( path ) => path.startsWith( 'assets/' ) && path.endsWith( '.json' ) );


// ---------------------------------------------------------------------------
// path & generation security
// ---------------------------------------------------------------------------

/*
====================
safePath

Validates and splits a relative asset path into safe directory components.
Rejects invalid types, excessive lengths, backslashes, null bytes,
and directory traversal components ('.' or '..').
====================
*/
export function safePath( path ) {
	if ( typeof path !== 'string' || !path || path.length > 1024 || path.includes( '\\' ) || path.includes( '\0' ) ) {
		throw new Error( 'Invalid local asset path.' );
	}

	const parts = path.split( '/' );

	for ( const part of parts ) {
		if ( !part || part === '.' || part === '..' || part.includes( ':' ) ) {
			throw new Error( 'Unsafe local asset path.' );
		}
	}

	return parts;
}

/*
====================
safeGeneration

Validates that a generation identifier matches a canonical UUID format.
====================
*/
export function safeGeneration( id ) {
	if ( !/^[a-f0-9-]{36}$/.test( id ) ) {
		throw new Error( 'Invalid cache generation.' );
	}

	return id;
}


// ---------------------------------------------------------------------------
// origin-private filesystem (OPFS) operations
// ---------------------------------------------------------------------------

/*
====================
directory

Recursively traverses or creates nested directory handles under a parent handle.
====================
*/
export async function directory( parent, path, create = false ) {
	let current = parent;
	const parts = safePath( path );

	for ( const part of parts ) {
		current = await current.getDirectoryHandle( part, { create } );
	}

	return current;
}

/*
====================
cacheRoot

Retrieves the root directory handle for Call of Duty 2 local assets in OPFS.
====================
*/
export async function cacheRoot( create = false ) {
	const root = await navigator.storage.getDirectory();

	return root.getDirectoryHandle( CACHE_FOLDER, { create } );
}

/*
====================
generationRoot

Retrieves the directory handle for a specific cache generation instance.
====================
*/
export async function generationRoot( id, create = false ) {
	const cache = await cacheRoot( create );

	return cache.getDirectoryHandle( safeGeneration( id ), { create } );
}

/*
====================
readFile

Reads a File snapshot from the given directory handle hierarchy.
====================
*/
export async function readFile( root, path ) {
	const parts = safePath( path );
	const name = parts.pop();
	const parent = parts.length ? await directory( root, parts.join( '/' ) ) : root;
	const handle = await parent.getFileHandle( name );

	return handle.getFile();
}

/*
====================
writeStream

Writes a byte array to a FileSystemWritableFileStream and closes it cleanly,
aborting the stream and propagating the original exception if any error occurs.
====================
*/
export async function writeStream( stream, bytes ) {
	try {
		await stream.write( bytes );
		await stream.close();
	} catch ( error ) {
		await stream.abort().catch( () => {} );
		throw error;
	}
}

/*
====================
writeFile

Writes raw bytes into a designated OPFS file path.
Creates intermediate directories as needed, and aborts the stream
if write or close encounters an error.
====================
*/
export async function writeFile( root, path, bytes ) {
	const parts = safePath( path );
	const name = parts.pop();
	const parent = parts.length ? await directory( root, parts.join( '/' ), true ) : root;
	const handle = await parent.getFileHandle( name, { create: true } );
	const stream = await handle.createWritable();

	await writeStream( stream, bytes );
}


// ---------------------------------------------------------------------------
// cache reader & handle cache
// ---------------------------------------------------------------------------

/*
====================
createFileReader

Creates an optimized, handle-caching reader over an OPFS directory root.
Handles are cached and concurrent directory lookups coalesced to eliminate
redundant IPC round-trips while always reading fresh File snapshots.
An LRU policy bounds the handle cache to 512 entries.
====================
*/
export function createFileReader( root ) {
	const dirs = new Map( [['', Promise.resolve( root )]] );
	const handles = new Map();

	function parent( path ) {
		if ( !dirs.has( path ) ) {
			const parts = path.split( '/' );
			const name = parts.pop();
			const pending = parent( parts.join( '/' ) ).then( ( dir ) => dir.getDirectoryHandle( name ) );

			dirs.set( path, pending );
			pending.catch( () => dirs.delete( path ) );
		}

		return dirs.get( path );
	}

	return async ( path ) => {
		const parts = safePath( path );
		const name = parts.pop();

		if ( !handles.has( path ) ) {
			const pending = parent( parts.join( '/' ) ).then( ( dir ) => dir.getFileHandle( name ) );

			if ( handles.size >= 512 ) {
				const oldestKey = handles.keys().next().value;
				handles.delete( oldestKey );
			}

			handles.set( path, pending );
			pending.catch( () => handles.delete( path ) );
		}

		try {
			const handle = await handles.get( path );
			return await handle.getFile();
		} catch ( error ) {
			handles.delete( path );
			dirs.clear();
			dirs.set( '', Promise.resolve( root ) );
			throw error;
		}
	};
}


// ---------------------------------------------------------------------------
// generation validation & lifecycle
// ---------------------------------------------------------------------------

/*
====================
validateGeneration

Verifies the integrity of a cached generation against the required asset set.
Validates manifest format, expected file sizes, and optionally verifies that
every required asset exists and matches manifest size on disk.
====================
*/
export async function validateGeneration( id, { full = true, onProgress = () => {} } = {} ) {
	const root = await generationRoot( id );
	const read = createFileReader( root );

	const completeFile = await read( 'complete.json' );
	const manifest = JSON.parse( await completeFile.text() );

	if ( manifest.version !== CACHE_VERSION || manifest.id !== id || !Array.isArray( manifest.files ) ) {
		throw new Error( 'Asset cache needs rebuilding for this version.' );
	}

	const sizes = new Map();

	for ( const record of manifest.files ) {
		safePath( record.path );
		if ( !Number.isSafeInteger( record.size ) || record.size < 0 || sizes.has( record.path ) ) {
			throw new Error( 'Invalid local cache manifest.' );
		}
		sizes.set( record.path, record.size );
	}

	const required = manifest.layout === MENU_LAYOUT
		? [...REQUIRED_FILES, 'assets/ui/image-sources.json'] : REQUIRED_FILES;

	for ( const path of required ) {
		if ( !sizes.get( path ) ) {
			throw new Error( `Missing or incomplete cached asset: ${path}` );
		}
	}

	const verified = new Map();
	let done = 0;

	if ( full ) {
		await mapLimit( required, 8, async ( path ) => {
			const file = await read( path );

			if ( file.size !== sizes.get( path ) ) {
				throw new Error( `Missing or incomplete cached asset: ${path}` );
			}

			verified.set( path, file );
			done++;
			onProgress( { path, done, total: required.length } );
		} );
	}

	return { root, manifest, verified, read, sizes };
}

/*
====================
activeGeneration

Queries the currently active generation from IndexedDB and validates it.
Returns null if no generation is active or if validation fails.
====================
*/
export async function activeGeneration( options ) {
	const id = await getSetting( 'active' );

	if ( !id ) {
		return null;
	}

	try {
		return await validateGeneration( id, options );
	} catch ( error ) {
		console.warn( 'Local cache validation:', error.message );
		return null;
	}
}

/*
====================
commitGeneration

Atomically commits a new cache generation:
1. Writes the completion marker ('complete.json') to OPFS.
2. Validates that all assets in the generation are sound.
3. Activates the generation ID in IndexedDB.

The completion marker goes last so an interrupted import can never become active.
The IndexedDB setting write is the sole activation point.
====================
*/
export async function commitGeneration( id, metadata, files ) {
	const root = await generationRoot( id, true );

	// Marker goes last. An interrupted import can never become active.
	const manifest = {
		version: CACHE_VERSION,
		id,
		createdAt: Date.now(),
		...metadata,
		files,
	};

	await writeFile( root, 'complete.json', JSON.stringify( manifest ) );
	await validateGeneration( id );
	await putSetting( 'active', id ); // IDB commit is the only activation point.

	return manifest;
}

/*
====================
removeGeneration

Recursively deletes a cache generation directory from OPFS.
Silently ignores NotFoundError if the directory was already removed.
====================
*/
export async function removeGeneration( id ) {
	try {
		const root = await cacheRoot( true );
		await root.removeEntry( safeGeneration( id ), { recursive: true } );
	} catch ( error ) {
		if ( error.name !== 'NotFoundError' ) {
			throw error;
		}
	}
}


// ---------------------------------------------------------------------------
// HTTP streaming & range requests
// ---------------------------------------------------------------------------

/*
====================
contentType

Maps file extensions to standard MIME content types for HTTP streaming.
====================
*/
export function contentType( path ) {
	const extension = path.split( '.' ).pop().toLowerCase();
	const types = {
		json: 'application/json',
		png:  'image/png',
		jpg:  'image/jpeg',
		jpeg: 'image/jpeg',
		wav:  'audio/wav',
		mp3:  'audio/mpeg',
		ogg:  'audio/ogg',
		ico:  'image/x-icon',
	};

	return types[extension] || 'application/octet-stream';
}

/*
====================
byteRange

Parses an HTTP 'Range' request header for single byte ranges, including
suffix byte ranges. Never allocates the complete file.

Returns:
- [start, end] inclusive integer offsets for a valid range
- null if no Range header is supplied
- false if the Range header is invalid or unsatisfiable
====================
*/
export function byteRange( header, size ) {
	if ( !header ) {
		return null;
	}

	const match = /^bytes=(\d*)-(\d*)$/.exec( header );

	if ( !match || ( !match[1] && !match[2] ) || size <= 0 ) {
		return false;
	}

	let start;
	let end;

	if ( !match[1] ) {
		const suffix = Number( match[2] );

		if ( !Number.isSafeInteger( suffix ) || suffix <= 0 ) {
			return false;
		}

		start = Math.max( 0, size - suffix );
		end = size - 1;
	} else {
		start = Number( match[1] );
		end = match[2] ? Number( match[2] ) : size - 1;
	}

	if ( !Number.isSafeInteger( start ) || !Number.isSafeInteger( end ) || start >= size || start < 0 || end < start ) {
		return false;
	}

	return [start, Math.min( end, size - 1 )];
}

/*
====================
assetResponse

Synthesizes an HTTP Response for an asset from OPFS storage.
Supports HEAD requests, byte-range slicing (206 Partial Content),
and 416 Range Not Satisfiable responses.
====================
*/
export async function assetResponse( request, root, path, { read = ( p ) => readFile( root, p ), expectedSize } = {} ) {
	const file = await read( path );

	if ( expectedSize !== undefined && file.size !== expectedSize ) {
		throw new Error( `Incomplete cached asset: ${path}` );
	}

	const range = byteRange( request.headers.get( 'range' ), file.size );
	const headers = {
		'Content-Type': contentType( path ),
		'Cache-Control': 'no-store',
		'Accept-Ranges': 'bytes',
		'X-Content-Type-Options': 'nosniff',
		'Cross-Origin-Resource-Policy': 'same-origin',
	};

	if ( range === false ) {
		return new Response( null, {
			status: 416,
			headers: {
				...headers,
				'Content-Range': `bytes */${file.size}`,
			},
		} );
	}

	const [start, end] = range || [0, file.size - 1];

	headers['Content-Length'] = String( Math.max( 0, end - start + 1 ) );

	if ( range ) {
		headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`;
	}

	const body = request.method === 'HEAD' ? null : file.slice( start, end + 1 );

	return new Response( body, {
		status: range ? 206 : 200,
		headers,
	} );
}
