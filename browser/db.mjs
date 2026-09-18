/*
===============================================================================

	db.mjs

	Call of Duty 2 / id Tech Local IndexedDB Storage
	Origin-local metadata store for configuration settings and client bindings.
	All data remains local to the browser; no file paths or assets leave the client.

===============================================================================
*/


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const DB_NAME = 'cod2-local-install-v1';


// ---------------------------------------------------------------------------
// database connection & transactions
// ---------------------------------------------------------------------------

/*
====================
database

Opens or upgrades the origin-local IndexedDB instance for local install state.
Creates the 'settings' and 'bindings' object stores on initial schema creation.
====================
*/
export function database() {
	return new Promise( ( resolve, reject ) => {
		const request = indexedDB.open( DB_NAME, 1 );

		request.onupgradeneeded = () => {
			request.result.createObjectStore( 'settings' );
			request.result.createObjectStore( 'bindings' );
		};

		request.onsuccess = () => resolve( request.result );
		request.onerror = () => reject( request.error );
		request.onblocked = () => reject( new Error( 'Close other port tabs to upgrade local storage.' ) );
	} );
}

/*
====================
transaction

Executes an isolated transaction against a named IndexedDB object store,
ensuring the database handle is always closed upon completion.
====================
*/
export async function transaction( store, mode, action ) {
	const db = await database();

	try {
		return await new Promise( ( resolve, reject ) => {
			const tx = db.transaction( store, mode );
			const request = action( tx.objectStore( store ) );

			tx.oncomplete = () => resolve( request?.result );
			tx.onerror = tx.onabort = () => reject( tx.error || request?.error || new Error( 'Local storage transaction failed.' ) );
		} );
	} finally {
		db.close();
	}
}


// ---------------------------------------------------------------------------
// settings accessors
// ---------------------------------------------------------------------------

/*
====================
getSetting

Retrieves a persisted configuration value by key from the 'settings' store.
====================
*/
export function getSetting( key ) {
	return transaction( 'settings', 'readonly', ( store ) => store.get( key ) );
}

/*
====================
putSetting

Stores or updates a configuration value by key in the 'settings' store.
====================
*/
export function putSetting( key, value ) {
	return transaction( 'settings', 'readwrite', ( store ) => store.put( value, key ) );
}

/*
====================
deleteSetting

Removes a configuration value by key from the 'settings' store.
====================
*/
export function deleteSetting( key ) {
	return transaction( 'settings', 'readwrite', ( store ) => store.delete( key ) );
}
