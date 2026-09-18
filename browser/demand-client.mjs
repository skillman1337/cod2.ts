/*
===============================================================================

	demand-client.mjs

	Page-side asset broker, telemetry and explicit source-permission recovery.

===============================================================================
*/


import { getSetting } from './db.mjs';
import { safePath } from './storage.mjs';

/*
====================
createDemandClient

The page owns user gestures and a dedicated compiler. The service worker owns
HTTP responses. Each broker is bound to exactly one completed generation.
====================
*/
export function createDemandClient( id, { files, report = () => {}, log = () => {} } = {} ) {
	let worker = null, serial = 0, stopped = false, permission = null;
	const requests = new Map();
	const timings = window.__cod2AssetTimings ??= [];
	const emit = detail => {
		report( detail );
		window.dispatchEvent( new CustomEvent( 'cod2:asset-status', { detail } ) );
	};

	function start() {
		if ( worker ) return;
		worker = new Worker( '/browser-runtime/demand.worker.js', { type: 'module' } );
		worker.postMessage( { type: 'init', id, files } );
		files = undefined;
		worker.onmessage = event => {
			const message = event.data, entry = requests.get( message.requestId );
			if ( message.type === 'log' ) { log( message.message ); return; }
			if ( message.type === 'task' ) { emit( message ); return; }
			if ( !entry ) return;
			requests.delete( message.requestId );
			clearTimeout( entry.timer );
			if ( message.type === 'error' ) entry.reject( new DOMException( message.message, message.name || 'OperationError' ) );
			else {
				const record = { path: entry.path, cached: message.cached, durationMs: message.durationMs };
				timings.push( record );
				if ( timings.length > 2048 ) timings.shift();
				emit( { type: 'complete', ...record } );
				entry.resolve( message );
			}
		};
		worker.onerror = event => {
			for ( const entry of requests.values() ) { clearTimeout( entry.timer ); entry.reject( new Error( event.message || 'Asset compiler stopped.' ) ); }
			requests.clear(); worker.terminate(); worker = null;
		};
	}

	function request( path ) {
		if ( stopped ) return Promise.reject( new Error( 'Asset session closed.' ) );
		safePath( path ); start();
		return new Promise( ( resolve, reject ) => {
			const requestId = ++serial;
			const timer = setTimeout( () => { requests.delete( requestId ); reject( new Error( `Asset preparation timed out: ${path}` ) ); }, 300000 );
			requests.set( requestId, { path, resolve, reject, timer } );
			worker.postMessage( { type: 'ensure', id, path, requestId } );
		} );
	}

	// Read permission may expire between visits. Never promise permission-free
	// access to assets that have not yet been converted into the local cache.
	function requestPermission() {
		if ( permission ) return permission;
		permission = ( async () => {
			const source = await getSetting( `source:${id}` );
			const directory = source?.directory || ( await getSetting( 'directory' ) );
			if ( !directory ) throw new Error( 'No source folder is bound. Open local files and rebuild once.' );
			const dialog = document.createElement( 'dialog' );
			dialog.className = 'asset-permission';
			dialog.innerHTML = '<h2>Read uncached game files</h2><p>This content is not cached yet. Allow read access to your saved game folder. Your original files will not be changed.</p><p role="status"></p><button type="button" data-allow>Allow read access</button><button type="button" data-cancel>Cancel</button>';
			document.body.append( dialog );
			try {
				await new Promise( ( resolve, reject ) => {
					const cancel = () => reject( new DOMException( 'Folder access cancelled. Cached content remains available.', 'NotAllowedError' ) );
					dialog.addEventListener( 'cancel', cancel );
					dialog.querySelector( '[data-cancel]' ).onclick = cancel;
					dialog.querySelector( '[data-allow]' ).onclick = async () => {
						try {
							if ( typeof directory.requestPermission === 'function' && await directory.requestPermission( { mode: 'read' } ) === 'granted' ) resolve();
							else dialog.querySelector( '[role=status]' ).textContent = 'Permission was not granted. Retry or cancel.';
						} catch ( error ) { reject( error ); }
					};
					dialog.showModal();
				} );
			} finally { dialog.close(); dialog.remove(); }
		} )().finally( () => { permission = null; } );
		return permission;
	}

	async function receive( event ) {
		if ( event.data?.type !== 'cod2-demand' || event.data.id !== id || !event.ports[0] ) return;
		const port = event.ports[0];
		try {
			let result;
			try { result = await request( event.data.path ); }
			catch ( error ) {
				if ( error.name !== 'NotAllowedError' ) throw error;
				await requestPermission();
				result = await request( event.data.path );
			}
			port.postMessage( { ok: true, cached: result.cached } );
		} catch ( error ) {
			log( `${event.data.path}: ${error.message}` );
			emit( { type: 'error', path: event.data.path, message: error.message } );
			port.postMessage( { ok: false, name: error.name, error: error.message } );
		} finally { port.close(); }
	}
	navigator.serviceWorker.addEventListener( 'message', receive );
	return {
		close() {
			stopped = true;
			navigator.serviceWorker.removeEventListener( 'message', receive );
			worker?.terminate();
			for ( const entry of requests.values() ) { clearTimeout( entry.timer ); entry.reject( new Error( 'Asset session closed.' ) ); }
			requests.clear();
		},
	};
}
