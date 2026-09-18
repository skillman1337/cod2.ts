/*
===============================================================================

	demand-cache.mjs

	Committed on-demand cache units. A failed or interrupted conversion never
	publishes a partial map. IndexedDB publishes one immutable OPFS directory
	after its completion marker and all output sizes have been verified.

===============================================================================
*/

import { getSetting, putSetting } from './db.mjs';
import { generationRoot, directory, readFile, writeFile, safePath, safeGeneration, createFileReader } from './storage.mjs';
import { assetRoute, COMPILER_VERSION } from './asset-routing.mjs';
import { mapLimit } from './async.mjs';

/*
====================
unitKey

Versioned identity is scoped to the source generation, never the folder name.
====================
*/
export async function unitKey( id, key ) {
	safeGeneration( id );
	const bytes = new TextEncoder().encode( `${COMPILER_VERSION}:${key}` );
	const digest = new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) );
	const hash = [...digest].map( ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
	return { hash, setting: `unit:${id}:${hash}` };
}

/*
====================
readUnit

Warm requests need no source-folder permission. File snapshots are not retained
	across writes; a size mismatch is a miss and triggers a new staged unit.
====================
*/
export async function readUnit( id, route, full = false ) {
	const key = await unitKey( id, route.key );
	const pointer = await getSetting( key.setting );
	if ( !pointer || !/^[a-f0-9-]{36}$/.test( pointer ) ) return null;
	try {
		const base = await generationRoot( id );
		const root = await directory( base, `units/${key.hash}/${pointer}` );
		const read = createFileReader( root );
		const marker = JSON.parse( await ( await read( 'complete.json' ) ).text() );
		if ( marker.version !== COMPILER_VERSION || marker.key !== route.key || !Array.isArray( marker.files ) ) return null;
		const sizes = new Map();
		for ( const record of marker.files ) {
			safePath( record.path );
			if ( !Number.isSafeInteger( record.size ) || record.size < 0 || sizes.has( record.path ) ) return null;
			sizes.set( record.path, record.size );
		}
		if ( !sizes.has( route.path ) ) return null;
		const check = full ? [...sizes.keys()] : [route.path];
		await mapLimit( check, 4, async ( path ) => {
			if ( ( await read( path ) ).size !== sizes.get( path ) ) throw new Error( 'Incomplete unit' );
		} );
		return { root, read, sizes, marker };
	} catch ( error ) {
		if ( ['NotAllowedError', 'SecurityError'].includes( error.name ) ) throw error;
		return null;
	}
}

/*
====================
ensureUnit

Cross-tab single-flight. The shared installation lock excludes import/delete;
	the exclusive unit lock excludes duplicate compilation of the same identity.
====================
*/
export async function ensureUnit( id, requested, compile ) {
	const route = assetRoute( requested );
	const key = await unitKey( id, route.key );
	return navigator.locks.request( 'cod2-local-import', { mode: 'shared' }, () =>
		navigator.locks.request( key.setting, async () => {
			// Always recheck after taking the lock: another tab may have completed it.
			const hit = await readUnit( id, route, route.kind === 'map' );
			if ( hit ) return { cached: true, route };
			const base = await generationRoot( id );
			const units = await directory( base, `units/${key.hash}`, true );
			const staging = crypto.randomUUID();
			const root = await units.getDirectoryHandle( staging, { create: true } );
			try {
				const files = await compile( route, root );
				const sizes = new Map();
				for ( const record of files ) {
					safePath( record.path );
					if ( record.path === 'complete.json' || sizes.has( record.path ) || !Number.isSafeInteger( record.size ) || record.size < 0 ) throw new Error( 'Invalid compiler output.' );
					sizes.set( record.path, record.size );
				}
				if ( !sizes.has( route.path ) ) throw new DOMException( `Compiler did not produce ${route.path}`, 'NotFoundError' );
				await mapLimit( files, 4, async ( record ) => {
					if ( ( await readFile( root, record.path ) ).size !== record.size ) throw new Error( `Incomplete write: ${record.path}` );
				} );
				await writeFile( root, 'complete.json', JSON.stringify( {
					version: COMPILER_VERSION, key: route.key, createdAt: Date.now(), files,
				} ) );
				await putSetting( key.setting, staging );
				return { cached: false, route };
			} catch ( error ) {
				await units.removeEntry( staging, { recursive: true } ).catch( () => {} );
				throw error;
			}
		} ) );
}
