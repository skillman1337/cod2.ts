/*
===============================================================================

	demand-runtime.browser.mjs

	Real Chromium integration: OPFS, IDB, Web Locks, dedicated workers and SW
	HTTP routing. Synthetic data only; this is not a retail gameplay benchmark.

===============================================================================
*/
import { syntheticInstall, syntheticIwd, utf8 } from './helpers/synthetic.mjs';
import { createDemandClient } from '../demand-client.mjs';
import { bind } from '../launcher-runtime.mjs';
import { APP_BASE, appURL } from '../deployment.mjs';
import { generationRoot, commitGeneration, MENU_LAYOUT, writeFile, readFile, directory } from '../../browser-runtime/storage.mjs';
import { getSetting, putSetting } from '../../browser-runtime/db.mjs';
import { assetRoute } from '../../browser-runtime/asset-routing.mjs';
import { ensureUnit, readUnit, unitKey } from '../../browser-runtime/demand-cache.mjs';

const results = [];
const check = ( ok, message ) => { if ( !ok ) throw new Error( message ); };
const id = crypto.randomUUID(), files = [{ path: 'main/synthetic.iwd', file: syntheticIwd( syntheticInstall() ) }];
let client, imported;
const tests = [];
const test = ( name, run ) => tests.push( { name, run } );
const asset = async ( path, options ) => {
	const response = await fetch( appURL( path.replace( /^\//, '' ) ), options );
	if ( !response.ok ) throw new Error( `${path} (${response.status}): ${await response.text()}` );
	return response;
};

/*
====================
runImport
====================
*/
async function runImport() {
	await generationRoot( id, true );
	const worker = new Worker( appURL( 'browser-runtime/import.worker.js' ), { type: 'module' } );
	try {
		return await new Promise( ( resolve, reject ) => {
			worker.onerror = event => reject( new Error( event.message ) );
			worker.onmessage = event => {
				if ( event.data.type === 'complete' ) resolve( event.data );
				if ( event.data.type === 'error' ) reject( new Error( event.data.message ) );
			};
			worker.postMessage( { type: 'import', id, files } );
		} );
	} finally { worker.terminate(); }
}

test( 'real import worker commits a menu-only generation', async () => {
	imported = await runImport();
	check( imported.sourceIndex.length === 64, 'source directory fingerprint missing' );
	check( !imported.files.some( row => /^(maps|viewmodels|characters|sound|weaponfx)\//.test( row.path ) ), 'gameplay leaked into bootstrap' );
	await putSetting( `source:${id}`, { sourceIndex: imported.sourceIndex } );
	await commitGeneration( id, { layout: MENU_LAYOUT }, imported.files );
	await bind( id );
	client = createDemandClient( id, { files } );
} );

test( 'cold sound compiles and returns archive bytes through service worker', async () => {
	const response = await asset( '/sound/test/shared.wav' );
	check( response.headers.get( 'X-CoD2-Cache' ) === 'compiled', 'did not cold compile' );
	check( await response.text() === 'SYNTHETIC-AUDIO', 'wrong sound payload' );
} );

test( 'warm sound supports byte range and HEAD without another conversion', async () => {
	const response = await asset( '/sound/test/shared.wav', { headers: { Range: 'bytes=0-3' } } );
	check( response.status === 206 && await response.text() === 'SYNT', 'range response wrong' );
	check( response.headers.get( 'X-CoD2-Cache' ) === 'unit-hit', 'not a warm unit' );
	const head = await asset( '/sound/test/shared.wav', { method: 'HEAD' } );
	check( head.headers.get( 'Content-Length' ) === '15' && await head.text() === '', 'HEAD response wrong' );
} );

test( 'first-person and third-person model aliases publish only one unit', async () => {
	const paths = ['/viewmodels/models/fixture_gun.json', '/characters/models/fixture_gun.json', '/assets/models/fixture_gun.json'];
	const models = await Promise.all( paths.map( async path => ( await asset( path ) ).json() ) );
	check( models.every( value => value.name === 'fixture_gun' ), 'model name lost' );
	const key = await unitKey( id, 'model/fixture_gun' );
	const root = await directory( await generationRoot( id ), `units/${key.hash}` );
	let count = 0; for await ( const _ of root.values() ) count++;
	check( count === 1, 'duplicate model compilation directories' );
} );

test( 'arbitrary animation compiles independently from weapon definitions', async () => {
	const animation = await ( await asset( '/viewmodels/animations/fixture_motion.json' ) ).json();
	check( animation.rate === 30 && animation.frames === 1, 'animation header lost' );
	const response = await asset( '/characters/animations/fixture_motion.json' );
	check( response.headers.get( 'X-CoD2-Cache' ) === 'unit-hit', 'animation aliases not shared' );
} );

test( 'two arbitrary maps compile independently with their own metadata', async () => {
	for ( const [map, side] of [['mp_fixture_alpha','british'], ['mp_fixture_beta','russian']] ) {
		const value = await ( await asset( `/maps/${map}/manifest.json` ) ).json();
		check( value.map === map && value.nationalities.allies === side, 'wrong map metadata' );
		check( ( await asset( `/maps/${map}/world.bin` ) ).headers.get( 'X-CoD2-Cache' ) === 'unit-hit', 'map unit incomplete' );
	}
} );

test( 'texture punctuation survives HTTP routing, conversion and cache lookup', async () => {
	const path = '/assets/textures/test/shared%23image.png';
	const response = await asset( path ), png = new Uint8Array( await response.arrayBuffer() );
	check( png[0] === 137 && png[1] === 80 && png[2] === 78, 'not a PNG' );
	check( ( await asset( path ) ).headers.get( 'X-CoD2-Cache' ) === 'unit-hit', 'texture not reused' );
} );

test( 'audio metadata compiles as one unit without preloading gameplay sounds', async () => {
	const value = await ( await asset( '/sound/weapons.json' ) ).json();
	check( value.aliases.weapon_test[0].volumeMin === 0, 'zero volume changed' );
	check( ( await asset( '/sound/ambient.json' ) ).headers.get( 'X-CoD2-Cache' ) === 'unit-hit', 'audio tables not grouped' );
} );

test( 'failed writes leave no published unit or staging directory', async () => {
	const path = 'sound/test/failure.wav', route = assetRoute( path ), key = await unitKey( id, route.key );
	let failed = false;
	try { await ensureUnit( id, path, async ( _route, root ) => {
		await writeFile( root, path, 'partial' ); throw new DOMException( 'Synthetic quota failure', 'QuotaExceededError' );
	} ); } catch ( error ) { failed = error.name === 'QuotaExceededError'; }
	check( failed, 'quota error swallowed' );
	check( !await getSetting( key.setting ) && !await readUnit( id, route ), 'partial data was published' );
	const root = await directory( await generationRoot( id ), `units/${key.hash}` );
	let count = 0; for await ( const _ of root.values() ) count++;
	check( count === 0, 'failed staging not removed' );
} );

test( 'a cancelled conversion is never made active', async () => {
	const path = 'sound/test/cancel.wav';
	try { await ensureUnit( id, path, () => { throw new DOMException( 'Synthetic cancellation', 'AbortError' ); } ); } catch ( error ) { check( error.name === 'AbortError', error.message ); }
	check( !await readUnit( id, assetRoute( path ) ), 'cancelled unit became active' );
} );

test( 'single-flight queue coalesces same identity across two browsing contexts', async () => {
	const frame = document.createElement( 'iframe' ); frame.src = appURL( 'empty.html' ); document.body.append( frame );
	await new Promise( resolve => frame.onload = resolve );
	const script = `(async () => { const {ensureUnit}=await import('${APP_BASE}browser-runtime/demand-cache.mjs'); const {writeFile}=await import('${APP_BASE}browser-runtime/storage.mjs'); return ensureUnit(${JSON.stringify(id)},'sound/test/cross-context.wav',async (route,root)=>{await new Promise(r=>setTimeout(r,30));await writeFile(root,route.path,'one');return [{path:route.path,size:3}];});})()`;
	const [a,b] = await Promise.all( [eval( script ), frame.contentWindow.eval( script )] );
	check( a.cached !== b.cached, 'both contexts compiled the same unit' );
	frame.remove();
} );

test( 'corrupt output is a miss; failed repair retains the last committed pointer', async () => {
	const route = assetRoute( 'sound/test/shared.wav' ), key = await unitKey( id, route.key );
	const pointer = await getSetting( key.setting ), unit = await readUnit( id, route );
	await writeFile( unit.root, route.path, 'broken' );
	check( !await readUnit( id, route ), 'wrong-size file treated as warm' );
	try { await ensureUnit( id, route.path, () => { throw new Error( 'repair failed' ); } ); } catch {}
	check( await getSetting( key.setting ) === pointer, 'failed repair replaced pointer' );
	await ensureUnit( id, route.path, async ( request, root ) => {
		await writeFile( root, request.path, 'SYNTHETIC-AUDIO' ); return [{ path: request.path, size: 15 }];
	} );
} );

test( 'missing media returns an explicit error without a server fallback', async () => {
	const response = await fetch( appURL( 'assets/textures/not_in_install.png' ) );
	check( !response.ok && /not_in_install/.test( await response.text() ), 'missing texture substituted' );
	const stats = await ( await fetch( appURL( 'test-server-stats' ) ) ).json();
	check( stats.mediaFallbacks === 0, `retail request reached network: ${stats.mediaFallbacks}` );
} );

test( 'changed archive index refuses cold compilation for the old generation', async () => {
	client.close();
	const changed = syntheticInstall(); changed['sound/test/replacement.wav'] = utf8( 'new' );
	client = createDemandClient( id, { files: [{ path: 'main/synthetic.iwd', file: syntheticIwd( changed ) }] } );
	const response = await fetch( appURL( 'sound/test/replacement.wav' ) );
	check( !response.ok && /Archive index changed/.test( await response.text() ), 'mixed source generations' );
} );

test( 'warm assets survive worker restart without any source-folder binding', async () => {
	client.close(); client = createDemandClient( id );
	for ( const path of ['/sound/test/shared.wav', '/maps/mp_fixture_alpha/manifest.json', '/assets/models/fixture_gun.json', '/assets/animations/fixture_motion.json'] ) {
		const response = await asset( path ); check( response.headers.get( 'X-CoD2-Cache' ) === 'unit-hit', `source requested for warm ${path}` );
	}
} );

test( 'uncached content after restart explains missing source access', async () => {
	const response = await fetch( appURL( 'sound/test/never-cached.wav' ) );
	check( response.status === 404 && /source binding/.test( await response.text() ), 'source error unclear' );
} );

for ( const { name, run } of tests ) {
	const started = performance.now();
	try { await run(); results.push( { name, passed: true, durationMs: performance.now() - started } ); }
	catch ( error ) { results.push( { name, passed: false, error: error.stack || String( error ) } ); }
}
client?.close();
window.__demandResult = { base: APP_BASE, tests: results.length, passed: results.filter( row => row.passed ).length, results };
const pre = document.createElement( 'pre' );
pre.textContent = JSON.stringify( window.__demandResult, null, 2 );
document.body.append( pre );
