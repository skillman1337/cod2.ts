/*
===============================================================================

	retail-files.mjs

	Call of Duty 2 / id Tech Virtual Filesystem Staging
	Bridges selected local host files into the importer's private virtual filesystem.
	Game binaries are bounded MEMFS snapshots; archives reside on read-only WORKERFS.

===============================================================================
*/

import { BINARY_PROFILE, hashBytes } from './install.mjs';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const NATIVE_DIRECTORY = '/retail/bin';
export const ARCHIVE_DIRECTORY = '/retail/main';
export const MAX_NATIVE_BYTES = 64 * 1024 * 1024;

const binaryNames = new Map( Object.keys( BINARY_PROFILE ).map( ( name ) => [name.toLowerCase(), name] ) );


// ---------------------------------------------------------------------------
// retail file planning
// ---------------------------------------------------------------------------

/*
====================
planRetailFiles

Validates and plans the handoff of local game files to the importer worker:
- Verifies relative paths and path traversal boundaries.
- Separates binary executables into MEMFS candidates.
- Organizes main/*.iwd archives into WORKERFS mount candidates.
====================
*/
export function planRetailFiles( files ) {
	if ( !Array.isArray( files ) || files.length > 513 ) {
		throw new Error( 'Invalid local-file handoff: expected at most 512 IWDs.' );
	}

	const binaries = new Map();
	const archives = new Map();

	for ( const item of files ) {
		if ( !item || typeof item.path !== 'string' || !( item.file instanceof Blob ) ) {
			throw new Error( 'Invalid local-file handoff: each entry must include its relative path and File/Blob, not a file handle or a Windows path.' );
		}

		const relative = item.path.replaceAll( '\\', '/' );
		const parts = relative.split( '/' );

		if ( parts.some( ( part ) => !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test( part ) ) ) {
			throw new Error( `Unsafe local-file path: ${JSON.stringify( item.path )}` );
		}

		const lower = relative.toLowerCase();

		// The launcher sends root filenames. Also accept explicit bin/name records
		// from adapters, but never search by basename in arbitrary subdirectories.
		const binaryKey = parts.length === 1
			? lower
			: parts.length === 2 && parts[0].toLowerCase() === 'bin'
				? parts[1].toLowerCase()
				: null;

		const name = binaryNames.get( binaryKey );

		if ( name ) {
			if ( binaries.has( name ) ) {
				throw new Error( `Ambiguous native binary in worker handoff: ${name}` );
			}

			if ( item.file.size < 1 || item.file.size > MAX_NATIVE_BYTES ) {
				throw new Error( `Invalid native binary size: ${name} (${item.file.size} bytes).` );
			}

			binaries.set( name, { name, file: item.file } );
		} else if ( parts.length === 2 && parts[0].toLowerCase() === 'main' && lower.endsWith( '.iwd' ) ) {
			const archiveName = parts[1].toLowerCase();

			if ( archives.has( archiveName ) ) {
				throw new Error( `Ambiguous archive in worker handoff: ${archiveName}` );
			}

			if ( item.file.size < 22 || item.file.size > 4 * ( 1024 ** 3 ) ) {
				throw new Error( `Invalid archive size: ${archiveName}` );
			}

			archives.set( archiveName, { name: archiveName, data: item.file } );
		} else {
			throw new Error( `Unexpected local-file path: ${JSON.stringify( item.path )}. Only main/*.iwd and optional game binaries are imported.` );
		}
	}

	if ( !archives.size ) {
		throw new Error( 'No main/*.iwd archives were handed to the import worker.' );
	}

	return {
		binaries: [...binaries.values()],
		archives: [...archives.values()].sort( ( a, b ) => ( a.name < b.name ? -1 : a.name > b.name ? 1 : 0 ) ),
	};
}


// ---------------------------------------------------------------------------
// native binary staging
// ---------------------------------------------------------------------------

/*
====================
stageNativeBytes

Stages raw bytes into Pyodide's MEMFS at its canonical filesystem path.
Verifies stored contents with a read-back SHA-256 digest check and marks it read-only.
====================
*/
export async function stageNativeBytes( FS, name, bytes ) {
	if ( !binaryNames.has( name.toLowerCase() ) ) {
		throw new Error( 'Native staging requires a canonical profile filename.' );
	}

	if ( !bytes || bytes.byteLength < 1 || bytes.byteLength > MAX_NATIVE_BYTES ) {
		throw new Error( `Invalid native binary size: ${name}` );
	}

	const actual = await hashBytes( bytes );
	const target = `${NATIVE_DIRECTORY}/${name}`;

	FS.mkdirTree( NATIVE_DIRECTORY );
	FS.writeFile( target, bytes ); // Default MEMFS owns a copy; no mount over /retail/bin.

	const stored = FS.readFile( target );
	const storedDigest = await hashBytes( stored );

	if ( !FS.isFile( FS.stat( target ).mode ) || stored.byteLength !== bytes.byteLength || storedDigest !== actual ) {
		throw new Error( `Native binary staging failed at ${target}. No extraction stages have started.` );
	}

	FS.chmod( target, 0o444 ); // In-worker snapshot is read-only.

	return { path: target, size: bytes.byteLength, sha256: actual };
}

/*
====================
stageNativeFile

Reads and stages a local File/Blob into Pyodide's MEMFS.
Permissive binary acceptance: no SHA-256 rejection so any version or patch level works.
====================
*/
export async function stageNativeFile( FS, name, file ) {
	if ( !binaryNames.has( name.toLowerCase() ) || binaryNames.get( name.toLowerCase()) !== name ) {
		throw new Error( 'Native staging requires a canonical profile filename.' );
	}

	if ( !( file instanceof Blob ) || file.size < 1 || file.size > MAX_NATIVE_BYTES ) {
		throw new Error( `Invalid native binary size: ${name}` );
	}

	let bytes;

	try {
		bytes = new Uint8Array( await file.arrayBuffer() );
	} catch ( error ) {
		throw new Error( `Could not read local ${name}. The selected file may have changed or access may have expired. Reopen the saved folder and retry.`, { cause: error } );
	}

	if ( bytes.byteLength !== file.size ) {
		throw new Error( `Incomplete native binary read: ${name}` );
	}

	return stageNativeBytes( FS, name, bytes );
}


// ---------------------------------------------------------------------------
// archive mounting & staging orchestrator
// ---------------------------------------------------------------------------

/*
====================
mountRetailArchives

Mounts the already-validated archive plan via WORKERFS without reading whole Blob bodies.
====================
*/
export function mountRetailArchives( FS, archives ) {
	if ( !FS.filesystems.WORKERFS ) {
		throw new Error( 'This Pyodide build does not include WORKERFS.' );
	}

	FS.mkdirTree( ARCHIVE_DIRECTORY );
	FS.mount( FS.filesystems.WORKERFS, { blobs: archives }, ARCHIVE_DIRECTORY );

	for ( const archive of archives ) {
		const target = `${ARCHIVE_DIRECTORY}/${archive.name}`;
		const info = FS.stat( target );

		if ( !FS.isFile( info.mode ) || info.size !== archive.data.size ) {
			throw new Error( `Archive mount failed at ${target}.` );
		}
	}
}

/*
====================
stageRetailFiles

Executes the full local file staging sequence:
1. Plans and partitions binaries and archives.
2. Stages native binaries to MEMFS.
3. Mounts .iwd archives via WORKERFS.
====================
*/
export async function stageRetailFiles( FS, files, report = () => {} ) {
	const plan = planRetailFiles( files );

	if ( !FS.filesystems.WORKERFS ) {
		throw new Error( 'This Pyodide build does not include WORKERFS.' );
	}

	const staged = [];

	for ( const { name, file } of plan.binaries) {
		report( `Staging ${name} in the local decoder…` );
		staged.push( await stageNativeFile( FS, name, file ) );
	}

	mountRetailArchives( FS, plan.archives );

	return staged;
}
