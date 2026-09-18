/*
===============================================================================

	demand.worker.js

	Dedicated, bounded converter for cold asset requests.

===============================================================================
*/


import { getSetting } from '../db.mjs';
import { ensureUnit } from '../demand-cache.mjs';
import { assetRoute } from '../asset-routing.mjs';
import { sourceFiles } from '../source-files.mjs';
import { generationRoot, readFile, safeGeneration } from '../storage.mjs';
import { createImportWriter } from '../opfs-writer.mjs';
import { ArchiveCollection } from '../decoders/retail-zip.js';
import { RetailContext } from '../decoders/retail-context.js';
import { compileAsset } from '../decoders/retail-asset-compiler.js';

let generation = null, archives = null, snapshot = null;
let queue = Promise.resolve();
const pending = new Map();

/*
====================
openArchives

Only invoked inside a cold unit compilation. Warm units never need the retail
folder. Reuse first-visit File snapshots rather than re-reading permissions.
====================
*/
async function openArchives() {
	if ( archives ) return archives;
	const files = snapshot || await sourceFiles( generation );
	const mounted = new ArchiveCollection();
	for ( const item of files ) await mounted.addArchive( item.file );
	const expected = ( await getSetting( `source:${generation}` ) )?.sourceIndex;
	if ( expected && expected !== await mounted.fingerprint() ) throw new Error( 'Archive index changed. Rebuild once to keep cached and uncached assets consistent.' );
	archives = mounted;
	snapshot = null;
	return mounted;
}

/*
====================
ensure

Queue bounds decompression memory to one conversion job per page. Web Locks
coalesce the same unit across tabs, and exclude concurrent import/deletion.
====================
*/
function ensure( path, requestId ) {
	const route = assetRoute( path );
	if ( pending.has( route.key ) ) return pending.get( route.key );
	const job = queue.then( () => ensureUnit( generation, path, async ( requested, root ) => {
		let last = 0;
		const send = info => {
			if ( performance.now() - last < 80 ) return;
			last = performance.now();
			postMessage( { type: 'task', requestId, path, ...info } );
		};
		const ctx = new RetailContext( await openArchives(), createImportWriter( root ),
			message => send( { message } ), message => postMessage( { type: 'log', requestId, message } ), send );
		const base = await generationRoot( generation );
		return compileAsset( ctx, requested, async table => JSON.parse( await ( await readFile( base, table ) ).text() ) );
	} ) );
	pending.set( route.key, job );
	queue = job.catch( () => {} );
	job.finally( () => pending.delete( route.key ) ).catch( () => {} );
	return job;
}

self.onmessage = event => {
	const message = event.data;
	if ( message?.type === 'init' ) {
		if ( generation ) return;
		generation = safeGeneration( message.id );
		if ( Array.isArray( message.files ) && message.files.length <= 512 && message.files.every( item => item.file instanceof Blob && /^main\/[^/]+\.iwd$/i.test( item.path ) ) ) snapshot = message.files;
		return;
	}
	if ( message?.type !== 'ensure' || !generation || message.id !== generation ) return;
	const started = performance.now();
	Promise.resolve().then( () => ensure( message.path, message.requestId ) ).then(
		result => postMessage( { type: 'complete', requestId: message.requestId, ...result, durationMs: performance.now() - started } ),
		error => postMessage( { type: 'error', requestId: message.requestId, name: error.name, message: error.message || String( error ) } )
	);
};
