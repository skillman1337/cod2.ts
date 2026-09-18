/*
===============================================================================

	import.worker.js

	Call of Duty 2 / id Tech Dedicated Asset Extraction Worker
	Runs retail IWD archive extraction, asset compilation, and OPFS storage
	off the main browser thread to maintain continuous UI responsiveness.

===============================================================================
*/

import { generationRoot } from '../storage.mjs';
import { createImportWriter } from '../opfs-writer.mjs';
import { ArchiveCollection } from '../decoders/retail-zip.js';
import { RetailPipeline } from '../decoders/retail-pipeline.js';


// ---------------------------------------------------------------------------
// globals & throttling
// ---------------------------------------------------------------------------

let running = false;
let lastTask = 0;
let taskTimer = null;
let latest = {};

const progress = ( message ) => postMessage( { type: 'progress', message } );
const log = ( message ) => postMessage( { type: 'log', message: String( message ) } );


// ---------------------------------------------------------------------------
// telemetry throttling
// ---------------------------------------------------------------------------

/*
====================
flushTask

Immediately flushes pending task progress events to the main thread.
====================
*/
function flushTask() {
	clearTimeout( taskTimer );
	taskTimer = null;
	lastTask = performance.now();
	postMessage( { type: 'task', ...latest } );
}

/*
====================
task

Throttles UI task progress notifications to approximately 12 Hz (80ms interval)
to prevent main-thread message starvation during bulk file writes.
====================
*/
function task( info ) {
	latest = { ...latest, ...info };

	if ( performance.now() - lastTask > 80 ) {
		flushTask();
	} else if ( !taskTimer ) {
		taskTimer = setTimeout( flushTask, 80 );
	}
}


// ---------------------------------------------------------------------------
// retail archive extraction
// ---------------------------------------------------------------------------

/*
====================
importInstallation

Mounts local IWD archives and runs the retail pipeline to unpack game assets
directly into the target cache generation directory in OPFS.
====================
*/
async function importInstallation( message ) {
	const root = await generationRoot( message.id );

	progress( 'Opening retail IWD archives…' );

	if ( !Array.isArray( message.files ) || message.files.length > 513 ) {
		throw new Error( 'Invalid archive handoff.' );
	}

	const files = message.files.filter( ( item ) => /^main\/[^/]+\.iwd$/i.test( item?.path || '' ) );

	if ( !files.length || files.some( ( item ) => !( item.file instanceof Blob ) ) ) {
		throw new Error( 'No valid main/*.iwd archives were provided.' );
	}

	const archives = new ArchiveCollection();

	// Preserve mount order: later localized/patch archives override earlier ones.
	for ( const item of files ) {
		task( { path: item.path } );
		log( `Indexing ${item.path} (${item.file.size} bytes)` );
		await archives.addArchive( item.file );
	}

	const writer = createImportWriter( root );
	const pipeline = new RetailPipeline( archives, writer, progress, log, task );
	const output = await pipeline.run();

	flushTask();
	postMessage( { type: 'complete', files: output, sourceIndex: await archives.fingerprint() } );
}


// ---------------------------------------------------------------------------
// message dispatch
// ---------------------------------------------------------------------------

self.onmessage = ( event ) => {
	if ( event.data?.type !== 'import' || running ) {
		return;
	}

	running = true;

	importInstallation( event.data )
		.catch( ( error ) => postMessage( {
			type: 'error',
			name: error.name,
			message: error.message || String( error ),
		} ) )
		.finally( () => {
			clearTimeout( taskTimer );
			running = false;
		} );
};
