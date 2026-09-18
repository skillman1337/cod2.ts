/*
===============================================================================

	install.mjs

	Call of Duty 2 / id Tech Local Installation Inspector
	Enumerates and verifies local game directory contents, game binaries,
	and IWD archive packages. Strictly read-only; never alters host files.

===============================================================================
*/


// ---------------------------------------------------------------------------
// constants & profiles
// ---------------------------------------------------------------------------

export const BINARY_PROFILE = Object.freeze( {
	'CoD2MP_s.exe': 'CoD2MP_s.exe',
} );


// ---------------------------------------------------------------------------
// cryptographic helpers
// ---------------------------------------------------------------------------

/*
====================
bytesToHex

Converts a byte sequence into a lowercase hex string.
====================
*/
export function bytesToHex( bytes ) {
	return Array.from( bytes, ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
}

/*
====================
hashBytes

Computes the lowercase hex-encoded SHA-256 digest of an ArrayBuffer or TypedArray.
====================
*/
export async function hashBytes( bytes ) {
	const digest = await crypto.subtle.digest( 'SHA-256', bytes );
	return bytesToHex( new Uint8Array( digest ) );
}

/*
====================
hashFile

Computes the hex-encoded SHA-256 digest of a binary file.
Rejects unexpectedly large binaries to prevent browser memory exhaustion.
====================
*/
export async function hashFile( file ) {
	if ( file.size > 64 * 1024 * 1024 ) {
		throw new Error( `Unexpectedly large game binary: ${file.name}` );
	}

	const buffer = await file.arrayBuffer();
	return hashBytes( buffer );
}


// ---------------------------------------------------------------------------
// directory inspection
// ---------------------------------------------------------------------------

/*
====================
entries

Reads directory entries into a lower-cased lookup map, rejecting ambiguous
collisions or directories that exceed reasonable file count limits.
====================
*/
async function entries( handle ) {
	const result = new Map();

	for await ( const [name, value] of handle.entries() ) {
		const key = name.toLowerCase();

		if ( result.has( key ) ) {
			throw new Error( `Ambiguous case-insensitive filename: ${name}` );
		}

		result.set( key, value );

		if ( result.size > 10000 ) {
			throw new Error( 'Too many files in the selected directory. Select the CoD2 installation root.' );
		}
	}

	return result;
}

/*
====================
inspectInstall

Inspects a user-selected local directory to detect a valid Call of Duty 2 installation:
1. Validates presence of the 'main' directory.
2. Identifies and hashes any optional game binaries.
3. Enumerates all valid .iwd archives in 'main'.
====================
*/
export async function inspectInstall( root, report = () => {}, { inspectBinaries = false } = {} ) {
	report( `Selected folder: "${root.name || 'CoD2'}"` );

	const top = await entries( root );
	report( `Found ${top.size} items in "${root.name || 'CoD2'}"` );

	const main = top.get( 'main' );

	if ( !main || main.kind !== 'directory' ) {
		throw new Error( 'Choose the Call of Duty 2 installation folder, not main. The selected folder must contain the main directory with .iwd archives.' );
	}

	const files = [];
	const binaries = {};

	for ( const name of inspectBinaries ? Object.keys( BINARY_PROFILE ) : [] ) {
		const key = name.toLowerCase();
		let handle = top.get( key );
		let location = 'root directory';

		if ( !handle && typeof root.getFileHandle === 'function' ) {
			try {
				handle = await root.getFileHandle( name );
				location = 'root.getFileHandle';
			} catch ( e1 ) {
				try {
					handle = await root.getFileHandle( key );
					location = 'root.getFileHandle(lower)';
				} catch ( e2 ) {}
			}
		}

		if ( handle && handle.kind === 'file' ) {
			report( `Checking ${name}…` );

			try {
				const file = await handle.getFile();
				const actual = await hashFile( file );

				binaries[name] = actual;
				files.push( { path: name, file } );
				report( `Found ${name} in ${location} (${file.size} bytes).` );
			} catch ( err ) {
				report( `Warning: could not read ${name}: ${err.message}` );
			}
		} else {
			report( `Notice: ${name} not found in selected directory (optional; using built-in definitions).` );
		}
	}

	const archives = await entries( main );
	const sortedArchives = [...archives].sort( ( [a], [b] ) => ( a < b ? -1 : a > b ? 1 : 0 ) );

	for ( const [name, handle] of sortedArchives ) {
		if ( !name.endsWith( '.iwd' ) || handle.kind !== 'file' ) {
			continue;
		}

		const file = await handle.getFile();

		if ( file.size < 22 || file.size > 4 * ( 1024 ** 3 ) ) {
			throw new Error( `Invalid or unsupported archive size: ${file.name}` );
		}

		files.push( { path: `main/${name}`, file } );
	}

	const iwdFiles = files.filter( ( item ) => item.path.startsWith( 'main/' ) );

	if ( !iwdFiles.length ) {
		throw new Error( 'No IWD archives found in main. Select a complete installed copy, including its language archives.' );
	}

	if ( iwdFiles.length > 512 ) {
		throw new Error( 'More than 512 IWD archives: this importer only supports a bounded base-game install.' );
	}

	return {
		files,
		binaries,
		archives: iwdFiles.map( ( { path, file } ) => ( {
			name: path.slice( 5 ),
			size: file.size,
			modified: file.lastModified,
		} ) ),
	};
}
