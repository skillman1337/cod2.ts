/*
===============================================================================

	main.mjs

	Call of Duty 2 / id Tech Web Client Launcher & Orchestrator
	Handles initial environment detection, directory selection, asset extraction,
	OPFS cache verification, service worker binding, and WebGPU engine boot.

===============================================================================
*/

import { APP_BASE, appURL } from './deployment.mjs';
import { bind, watchEngine } from './launcher-runtime.mjs';
import { createDemandClient } from './demand-client.mjs';
import { getSetting, putSetting, deleteSetting, transaction } from './db.mjs';
import { activeGeneration, generationRoot, readFile, commitGeneration, removeGeneration, JSON_FILES, CACHE_FOLDER } from './storage.mjs';
import { mapLimit } from './async.mjs';
import { inspectInstall } from './install.mjs';
import { Asset_Initialize } from './runtime-assets';
import { createSetupView } from './setup-view.mjs';
import './setup.css';


// ---------------------------------------------------------------------------
// globals & setup UI
// ---------------------------------------------------------------------------

const ui = createSetupView();
const byId = ui.el;
const IMPORT_PHASES = ['Fonts', 'Menus', 'Menu graphics', 'Configuration'];
let demand = null;
let sessionFiles = null;

let saved = null;
let cached = null;
let worker = null;
let busy = false;
let cancelImport = null;
let engineAttempted = false;
let importedThisVisit = false;

const mark = ( name ) => performance.mark( `cod2:${name}` );
const measure = ( name, start, end ) => performance.measure( `cod2:${name}`, `cod2:${start}`, `cod2:${end}` ).duration;
const log = ( message ) => ui.log( message );
const report = ( message ) => {
	ui.status( message );
	log( message );
};

mark( 'boot-start' );


// ---------------------------------------------------------------------------
// error & event diagnostics
// ---------------------------------------------------------------------------

/*
====================
readable

Converts arbitrary error exceptions into actionable, user-friendly diagnostic messages.
====================
*/
function readable( error ) {
	if ( error?.stack ) {
		log( error.stack );
	}

	console.error( error );

	if ( error?.name === 'QuotaExceededError' ) {
		return 'Not enough browser storage. Free disk space and retry. Your previous completed cache has not been replaced.';
	}

	if ( error?.name === 'NotAllowedError' ) {
		return 'Folder access was not granted. Use the saved folder, or choose your installation again.';
	}

	return error?.message || String( error );
}

window.addEventListener( 'error', ( event ) => {
	log( event.error?.stack || `${event.message} at ${event.filename}:${event.lineno}` );
} );

window.addEventListener( 'unhandledrejection', ( event ) => {
	log( event.reason?.stack || String( event.reason ) );
} );

window.addEventListener( 'cod2:engine-status', ( event ) => {
	if ( event.detail?.phase === 'quit' ) {
		document.exitPointerLock?.();
		location.assign( appURL( '?assets=manage' ) );
	}
} );


// ---------------------------------------------------------------------------
// UI state transitions
// ---------------------------------------------------------------------------

/*
====================
available

Updates launcher button visibility based on current cache and saved folder state.
====================
*/
function available() {
	if ( cached ) {
		ui.show( 'play', 'change', ...( saved ? ['rebuild'] : [] ), 'forget' );
	} else if ( saved ) {
		ui.show( 'resume', 'change', 'forget' );
	} else {
		ui.show( 'choose' );
	}

	if ( engineAttempted ) {
		byId( 'play' ).firstChild.textContent = 'Retry launch ';
	}
}

/*
====================
ready

Transitions launcher status to ready state with user guidance.
====================
*/
function ready( message ) {
	ui.ready( {
		cached: !!cached,
		saved: !!saved,
		message,
	} );

	available();
}


/*
====================
play

Initializes asset bindings, loads in-memory JSON definition tables,
and boots the Call of Duty 2 WebGPU engine.
====================
*/
async function play( cache ) {
	if ( busy || !cache ) {
		return;
	}

	if ( engineAttempted ) {
		location.assign( appURL() );
		return;
	}

	busy = true;
	ui.show();
	ui.begin( 'cache' );
	mark( 'launch-start' );

	let watch;

	try {
		if ( !navigator.gpu ) {
			throw new Error( 'WebGPU is unavailable. Use a supported desktop browser with WebGPU enabled.' );
		}

		ui.stage( 'Opening your local installation', { label: 'LOCAL CACHE', step: 'cache', cached: true } );

		let done = 0;

		// Binding and JSON loading are independent. Reuse File snapshots from validation.
		const [, entries] = await Promise.all( [
			bind( cache.manifest.id ),
			mapLimit( JSON_FILES, 8, async ( path ) => {
				const file = cache.verified?.get( path ) || await ( cache.read ? cache.read( path ) : readFile( cache.root, path ) );
				const value = JSON.parse( await file.text() );

				done++;
				ui.task( { path, done, total: JSON_FILES.length, unit: 'tables read' } );

				return [path, value];
			} ),
		] );

		demand?.close();
		demand = createDemandClient( cache.manifest.id, { files: sessionFiles, log, report: info => {
			if ( info.type === 'task' && !document.querySelector( '#setup[hidden]' ) ) ui.task( info );
		} } );
		sessionFiles = null;
		const json = new Map( entries );
		Asset_Initialize(cache.manifest.id, json);

		ui.stage( 'Starting the game engine', { label: 'ENGINE', step: 'launch', cached: true } );
		mark( 'engine-start' );
		watch = watchEngine( ui, log );
		engineAttempted = true;

		// Never hoist this import: engine modules read JSON at evaluation time.
		await import('../index.ts');
		mark( 'engine-imported' );

		await watch.promise;

		// The ready signal is sent after the first complete menu frame is submitted.
		mark( 'menu-ready' );

		const timings = {
			source: importedThisVisit ? 'first-import' : 'local-cache',
			cacheCheckMs: performance.getEntriesByName( 'cod2:cache-validation' ).at( -1 )?.duration ?? null,
			importMs: importedThisVisit ? performance.getEntriesByName( 'cod2:first-import' ).at( -1 )?.duration ?? null : null,
			launchMs: measure( 'cached-launch', 'launch-start', 'menu-ready' ),
			engineModuleMs: measure( 'engine-module', 'engine-start', 'engine-imported' ),
			graphicsMs: measure( 'graphics', 'engine-imported', 'menu-ready'),
			totalSinceBootMs: measure( 'boot-to-menu', 'boot-start', 'menu-ready' ),
		};

		window.__cod2LoadTimings = timings;
		log( `Ready in ${( timings.launchMs / 1000 ).toFixed( 2 )} s from local cache.` );
		console.info( 'CoD2 load timings (ms)', timings );

		ui.finish();
	} catch ( error ) {
		ui.fail( readable( error ) );
		available();
	} finally {
		watch?.stop();
		busy = false;
	}
}


// ---------------------------------------------------------------------------
// asset extraction & folder import
// ---------------------------------------------------------------------------

/*
====================
extract

Spawns the background extraction worker to decompress game assets.
====================
*/
function extract( installation, id ) {
	return new Promise( ( resolve, reject ) => {
		worker = new Worker( appURL( 'browser-runtime/import.worker.js' ), { type: 'module' } );

		cancelImport = () => {
			worker?.terminate();
			reject( new DOMException( 'Setup cancelled. Your last completed cache is unchanged.', 'AbortError' ) );
		};

		worker.onerror = ( event ) => {
			reject( new Error( `Import worker failed: ${event.message}` ) );
		};

		worker.onmessage = ( event ) => {
			const message = event.data;

			if ( message.type === 'progress' ) {
				const match = /^(\d+)\/(\d+):\s*(.*)/.exec( message.message );

				if ( match ) {
					ui.stage( match[3].replace( /…$/, '' ), {
						label: `${IMPORT_PHASES[Number(match[1]) - 1] || 'Assets'} · ${match[1]} / ${match[2]}`,
						done: Number( match[1] ) - 1,
						total: Number( match[2] ),
						step: 'prepare',
					} );
				} else {
					ui.status( message.message );
				}

				log( message.message );
			}

			if ( message.type === 'task' ) {
				ui.task( message );
			}

			if ( message.type === 'log' ) {
				log( message.message );
			}

			if ( message.type === 'error' ) {
				const error = new Error( message.message );
				error.name = message.name || 'Error';
				reject( error );
			}

			if ( message.type === 'complete' ) {
				resolve( { files: message.files, sourceIndex: message.sourceIndex } );
			}
		};

		worker.postMessage( { type: 'import', id, files: installation.files } );
	} );
}

/*
====================
importFolder

Coordinates the full local folder import lifecycle:
1. Obtains a cross-tab Web Lock to avoid concurrency races.
2. Inspects local directory contents.
3. Requests browser persistent storage.
4. Executes background extraction via worker.
5. Atomically commits and validates the new cache generation.
====================
*/
async function importFolder( handle ) {
	if ( busy ) {
		return;
	}

	busy = true;
	let id = null;
	let completed = false;

	ui.show();
	ui.begin( 'import' );
	mark( 'import-start' );

	try {
		await navigator.locks.request( 'cod2-local-import', { ifAvailable: true }, async ( lock ) => {
			if ( !lock ) {
				throw new Error( 'Another tab is importing local assets. Close it or finish that import first.' );
			}

			const installation = await inspectInstall( handle, report );

			// Read-only handle. The original game directory is never written to.
			await putSetting( 'directory', handle );
			saved = handle;

			const persistent = await navigator.storage.persist().catch( () => false );
			log( persistent ? 'Persistent browser storage granted.' : 'Cache remains subject to browser storage eviction.' );

			const estimate = await navigator.storage.estimate();

			if ( estimate.quota ) {
				log( `Available storage: ${Math.max( 0, estimate.quota - ( estimate.usage || 0 ) )} bytes.` );
			}

			id = crypto.randomUUID();
			await generationRoot( id, true );

			ui.show( 'cancel' );
			const { files, sourceIndex } = await extract( installation, id );

			ui.show();
			ui.stage( 'Saving and checking your local cache', { label: 'FINAL CHECK', step: 'cache' } );

			await putSetting( `source:${id}`, { directory: handle, archives: installation.archives, sourceIndex } );
			sessionFiles = installation.files;
			await commitGeneration( id, {
				layout: 'menu-first-v1',
				installationName: handle.name,
				binaries: installation.binaries,
				archives: installation.archives,
				contentPolicy: 'menu-bootstrap-then-demand',
			}, files );

			cached = await activeGeneration();

			if ( !cached ) {
				throw new Error( 'The cache could not be reopened after saving. Your previous files were not modified.' );
			}

			id = null;
			completed = true;
			importedThisVisit = true;

			mark( 'import-end' );
			measure( 'first-import', 'import-start', 'import-end' );
			log( 'Menu cached. Maps and gameplay media are prepared only when requested. Uncached content may need renewed folder permission.' );
		} );
	} catch ( error ) {
		if ( error.name === 'AbortError' ) {
			ready( error.message );
		} else {
			ui.fail( readable( error ) );
			available();
		}
	} finally {
		worker?.terminate();
		worker = null;
		cancelImport = null;

		if ( id ) {
			await deleteSetting( `source:${id}` );
			sessionFiles = null;
			await removeGeneration( id ).catch( ( error ) => log( `Incomplete cache cleanup: ${error.message}` ) );
		}

		busy = false;
	}

	if ( completed ) {
		await play( cached );
	}
}


// ---------------------------------------------------------------------------
// user interaction handlers
// ---------------------------------------------------------------------------

/*
====================
choose

Invokes the browser directory picker directly in response to a user click.
====================
*/
async function choose() {
	if ( busy ) {
		return;
	}

	try {
		// The picker must open directly inside the user's click, not after an await.
		const handle = await window.showDirectoryPicker( { id: 'cod2-install', mode: 'read' } );
		await importFolder( handle );
	} catch ( error ) {
		if ( error.name !== 'AbortError' ) {
			ui.fail( readable( error ) );
			available();
		}
	}
}

/*
====================
resume

Requests permission on a previously remembered directory handle and imports it.
====================
*/
async function resume() {
	if ( !saved || busy ) {
		return;
	}

	try {
		const permission = await saved.requestPermission( { mode: 'read' } );

		if ( permission !== 'granted' ) {
			throw new DOMException( 'Read permission was not granted.', 'NotAllowedError' );
		}

		await importFolder( saved );
	} catch ( error ) {
		ui.fail( readable( error ) );
		available();
	}
}

byId( 'choose' ).onclick = byId( 'change' ).onclick = choose;
byId( 'resume' ).onclick = byId( 'rebuild' ).onclick = resume;
byId( 'play' ).onclick = () => play( cached );
byId( 'cancel' ).onclick = () => cancelImport?.();

byId( 'forget' ).onclick = async () => {
	if ( busy ) {
		return;
	}

	const confirmed = confirm(
		'Delete this browser’s converted assets and saved folder selection? Other running tabs will lose access. Your original game files will not be touched.'
	);

	if ( !confirmed ) {
		return;
	}

	busy = true;

	try {
		await navigator.locks.request( 'cod2-local-import', { ifAvailable: true }, async ( lock ) => {
			if ( !lock ) {
				throw new Error( 'Another tab is importing. Close it before deleting local assets.' );
			}

			const root = await navigator.storage.getDirectory();

			await root.removeEntry( CACHE_FOLDER, { recursive: true } ).catch( ( error ) => {
				if ( error.name !== 'NotFoundError' ) {
					throw error;
				}
			} );

			demand?.close();
			demand = null;
			sessionFiles = null;
			await transaction( 'settings', 'readwrite', store => store.clear() );

			await transaction( 'bindings', 'readwrite', ( store ) => store.clear() );

			navigator.serviceWorker.controller?.postMessage( { type: 'cod2-forget' } );

			saved = null;
			cached = null;
			ready( 'Local cache deleted. Your original game files are untouched.' );
		} );
	} catch ( error ) {
		ui.fail( readable( error ) );
		available();
	} finally {
		busy = false;
	}
};


// ---------------------------------------------------------------------------
// application boot sequence
// ---------------------------------------------------------------------------

/*
====================
boot

Verifies environment prerequisites (HTTPS/localhost, OPFS, Service Workers, Web Locks),
checks active cache generation, and auto-launches if cache is validated and healthy.
====================
*/
async function boot() {
	if ( !isSecureContext ) {
		throw new Error( 'Local installation access requires HTTPS or localhost.' );
	}

	if ( !window.showDirectoryPicker || !navigator.storage?.getDirectory || !navigator.serviceWorker || !navigator.locks ) {
		throw new Error( 'This loader requires a desktop browser with directory access, local storage, and service workers, such as Chrome or Edge. There is no upload fallback.' );
	}

	if ( !location.pathname.startsWith( APP_BASE ) ) {
		throw new Error( `Open this build under its configured path: ${APP_BASE}` );
	}

	ui.begin( 'check' );
	mark( 'cache-check-start' );

	[saved, cached] = await Promise.all( [
		getSetting( 'directory' ),
		activeGeneration( {
			onProgress: ( { path, done, total } ) => ui.task( { path, detail: `${done} / ${total} FILES CHECKED` } ),
		} ),
	] );

	mark( 'cache-check-end' );
	measure( 'cache-validation', 'cache-check-start', 'cache-check-end' );

	const manage = new URLSearchParams( location.search ).get( 'assets' ) === 'manage';

	if ( cached && !manage ) {
		await play( cached );
	} else {
		ready();
	}

	// No automatic re-import on a missing/incomplete cache: the user stays informed.
}

boot().catch(error => {
	ui.show();
	ui.fail( readable( error ) );
} );
