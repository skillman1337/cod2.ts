/*
===============================================================================

	source-files.mjs

	Reopen only the selected generation's source archives on a cold cache miss.
	Never silently mix an updated install with an earlier compiled generation.

===============================================================================
*/

import { getSetting } from './db.mjs';
import { inspectInstall } from './install.mjs';

/*
====================
sourceFiles

The initial browser visit can reuse File snapshots. Later visits query read
	permission without prompting from a worker; the page owns any user gesture.
====================
*/
export async function sourceFiles( id ) {
	const source = await getSetting( `source:${id}` );
	let directory = source?.directory;

	if ( !directory ) {
		directory = await getSetting( 'directory' );
	}

	if ( !directory ) {
		throw new DOMException( 'This cache has no source binding. Rebuild it once using the selected game folder.', 'NotFoundError' );
	}

	if ( typeof directory.queryPermission === 'function' && await directory.queryPermission( { mode: 'read' } ) !== 'granted' ) {
		throw new DOMException( 'Read access is needed for an asset that is not cached yet.', 'NotAllowedError' );
	}

	const current = await inspectInstall( directory, () => {}, { inspectBinaries: false } );

	if ( Array.isArray( source?.archives ) ) {
		const same = current.archives.length === source.archives.length && current.archives.every( ( archive, index ) => {
			const expected = source.archives[index];
			return archive.name === expected.name && archive.size === expected.size && archive.modified === expected.modified;
		} );

		if ( !same ) throw new Error( 'The game archives changed. Rebuild the installation cache to avoid mixing different versions.' );
	}

	return current.files;
}
