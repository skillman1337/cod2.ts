/*
===============================================================================

	opfs-writer.mjs

	Call of Duty 2 / id Tech Origin-Private File System (OPFS) Importer
	High-performance synchronous and streaming writes into OPFS storage.
	Dedicated to asset extraction workers; operates exclusively on uncommitted generations.

===============================================================================
*/

import { safePath, writeStream } from './storage.mjs';


// ---------------------------------------------------------------------------
// OPFS writer factory
// ---------------------------------------------------------------------------

/*
====================
createImportWriter

Instantiates an asynchronous file writer optimized for bulk extraction into OPFS.
Prefers FileSystemSyncAccessHandle when available in dedicated worker contexts,
falling back gracefully to standard FileSystemWritableFileStream otherwise.
Directory handles are cached and lazily opened.
====================
*/
export function createImportWriter( root ) {
	const directories = new Map( [['', Promise.resolve( root )]] );

	function directory( path ) {
		if ( !directories.has( path ) ) {
			const parts = path.split( '/' );
			const name = parts.pop();
			const pending = directory( parts.join( '/' ) ).then( ( parent ) => parent.getDirectoryHandle( name, { create: true } ) );

			directories.set( path, pending );
			pending.catch( () => directories.delete( path ) );
		}

		return directories.get( path );
	}

	return async ( path, bytes ) => {
		const parts = safePath( path );
		const filename = parts.pop();
		const parent = await directory( parts.join( '/' ) );
		const handle = await parent.getFileHandle( filename, { create: true } );

		if ( typeof handle.createSyncAccessHandle === 'function' ) {
			const access = await handle.createSyncAccessHandle();

			try {
				let at = 0;

				while ( at < bytes.byteLength ) {
					const count = access.write( bytes.subarray( at ), { at } );

					if ( !Number.isInteger( count ) || count <= 0 ) {
						throw new Error( `Incomplete cache write: ${path}` );
					}

					at += count;
				}

				access.truncate( bytes.byteLength );
			} finally {
				access.close();
			}
		} else {
			const stream = await handle.createWritable();
			await writeStream( stream, bytes );
		}
	};
}
