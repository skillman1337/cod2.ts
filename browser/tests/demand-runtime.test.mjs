/*
===============================================================================

	demand-runtime.test.mjs

	Runs the actual worker, compiler and SW handlers with deterministic browser
	ports. Native OPFS / IDB / browser scheduling remain a separate test suite.

===============================================================================
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticInstall, syntheticIwd } from './helpers/synthetic.mjs';
import { memoryBrowser } from './helpers/memory-browser.mjs';
import { generationRoot, commitGeneration, MENU_LAYOUT, writeFile, directory } from '../storage.mjs';
import { ensureUnit, readUnit, unitKey } from '../demand-cache.mjs';
import { assetRoute } from '../asset-routing.mjs';
import { getSetting, putSetting } from '../db.mjs';

const env = memoryBrowser();
Object.defineProperty( navigator, 'storage', { value: { getDirectory: async () => env.root }, configurable: true } );
Object.defineProperty( navigator, 'locks', { value: env.locks, configurable: true } );
globalThis.indexedDB = env.indexedDB;
const id = crypto.randomUUID(), files = [{ path: 'main/synthetic.iwd', file: syntheticIwd( syntheticInstall() ) }];
const requests = new Map(); let serial = 0, bootReply, ensure, sw;
globalThis.postMessage = message => {
	if ( !['error', 'complete'].includes( message.type ) ) return;
	const reply = message.requestId ? requests.get( message.requestId ) : bootReply;
	if ( !reply ) return;
	if ( message.type === 'error' ) reply.reject( new DOMException( message.message, message.name ) ); else reply.resolve( message );
	requests.delete( message.requestId );
};

async function compiler( files ) {
	const previous = globalThis.self;
	globalThis.self = {};
	await import( `../runtime/demand.worker.js?instance=${++serial}` );
	const handler = self.onmessage;
	handler( { data: { type: 'init', id, files } } );
	globalThis.self = previous;
	return path => new Promise( ( resolve, reject ) => {
		const requestId = ++serial;
		requests.set( requestId, { resolve, reject } );
		handler( { data: { type: 'ensure', id, path, requestId } } );
	} );
}

async function response( path, options ) {
	let promise;
	sw.listeners.fetch( { clientId: 'synthetic-client', request: new Request( 'https://synthetic.test' + path, options ), respondWith: value => { promise = value; } } );
	assert.ok( promise, 'SW did not intercept game request' );
	return promise;
}

async function ok( path, options ) {
	const r = await response( path, options );
	assert.ok( r.ok, `${path} ${r.status}: ${r.ok ? '' : await r.text()}` );
	return r;
}

test( 'worker / SW demand lifecycle with synthetic browser ports', async t => {
	await t.test( 'actual import worker writes only menu assets, then commits', async () => {
		await generationRoot( id, true );
		globalThis.self = {};
		await import( '../runtime/import.worker.js' );
		const pending = new Promise( ( resolve, reject ) => { bootReply = { resolve, reject }; } );
		self.onmessage( { data: { type: 'import', id, files } } );
		const result = await pending;
		assert.ok( !result.files.some( file => /^(maps|sound|characters|viewmodels|weaponfx)\//.test( file.path ) ) );
		await putSetting( `source:${id}`, { sourceIndex: result.sourceIndex } );
		await commitGeneration( id, { layout: MENU_LAYOUT }, result.files );
		ensure = await compiler( files );
		sw = { location: { origin: 'https://synthetic.test' }, listeners: {}, addEventListener( name, handler ) { this.listeners[name] = handler; }, clients: { get: async () => ({
			id: 'synthetic-client', postMessage( message, ports ) {
				ensure( message.path ).then( () => ports[0].postMessage( { ok: true } ), error => ports[0].postMessage( { ok: false, error: error.message, name: error.name } ) ).finally( () => ports[0].close() );
			},
		}) } };
		globalThis.self = sw;
		await import( '../local-assets.sw.mjs' );
	} );
	await t.test( 'cold sound request routes through actual compiler', async () => {
		const r = await ok( '/sound/test/shared.wav' ); assert.equal( r.headers.get( 'X-CoD2-Cache' ), 'compiled' ); assert.equal( await r.text(), 'SYNTHETIC-AUDIO' );
	} );
	await t.test( 'warm range and HEAD do not compile again', async () => {
		const r = await ok( '/sound/test/shared.wav', { headers: { Range: 'bytes=0-3' } } );
		assert.equal( r.status, 206 ); assert.equal( await r.text(), 'SYNT' ); assert.equal( r.headers.get( 'X-CoD2-Cache' ), 'unit-hit' );
		const head = await ok( '/sound/test/shared.wav', { method: 'HEAD' } ); assert.equal( head.headers.get( 'Content-Length' ), '15' ); assert.equal( await head.text(), '' );
	} );
	await t.test( 'concurrent model aliases share one committed output', async () => {
		const names = ['/viewmodels/models/fixture_gun.json', '/characters/models/fixture_gun.json', '/assets/models/fixture_gun.json'];
		const models = await Promise.all( names.map( async path => ( await ok( path ) ).json() ) );
		assert.ok( models.every( model => model.name === 'fixture_gun' ) );
		const key = await unitKey( id, 'model/fixture_gun' ), root = await directory( await generationRoot( id ), `units/${key.hash}` );
		let count = 0; for await ( const _ of root.values() ) count++; assert.equal( count, 1 );
	} );
	await t.test( 'arbitrary animation decodes and aliases reuse it', async () => {
		const a = await ( await ok( '/viewmodels/animations/fixture_motion.json' ) ).json(); assert.equal( a.rate, 30 );
		assert.equal( ( await ok( '/characters/animations/fixture_motion.json' ) ).headers.get( 'X-CoD2-Cache' ), 'unit-hit' );
	} );
	await t.test( 'two maps retain distinct metadata without eager map extraction', async () => {
		for ( const [map, side] of [['mp_fixture_alpha','british'],['mp_fixture_beta','russian']] ) {
			const manifest = await ( await ok( `/maps/${map}/manifest.json` ) ).json(); assert.equal( manifest.nationalities.allies, side );
			assert.equal( ( await ok( `/maps/${map}/world.bin` ) ).headers.get( 'X-CoD2-Cache' ), 'unit-hit' );
		}
	} );
	await t.test( 'punctuated texture converts to PNG, with warm lookup', async () => {
		const path = '/assets/textures/test/shared%23image.png', r = await ok( path );
		assert.equal( new Uint8Array( await r.arrayBuffer() )[0], 137 );
		assert.equal( ( await ok( path ) ).headers.get( 'X-CoD2-Cache' ), 'unit-hit' );
	} );
	await t.test( 'audio catalog writes are grouped and preserve zero', async () => {
		const value = await ( await ok( '/sound/weapons.json' ) ).json(); assert.equal( value.aliases.weapon_test[0].volumeMin, 0 );
		assert.equal( ( await ok( '/sound/ambient.json' ) ).headers.get( 'X-CoD2-Cache' ), 'unit-hit' );
	} );
	await t.test( 'quota error removes staging and publishes nothing', async () => {
		const path = 'sound/test/failure.wav', route = assetRoute( path ), key = await unitKey( id, route.key );
		await assert.rejects( ensureUnit( id, path, async ( _, root ) => { await writeFile( root, path, 'partial' ); throw new DOMException( 'quota', 'QuotaExceededError' ); } ), { name: 'QuotaExceededError' } );
		assert.equal( await getSetting( key.setting ), undefined ); assert.equal( await readUnit( id, route ), null );
		let count = 0; for await ( const _ of ( await directory( await generationRoot( id ), `units/${key.hash}` ) ).values() ) count++; assert.equal( count, 0 );
	} );
	await t.test( 'IDB activation failure cannot expose a completed staging directory', async () => {
		const path = 'sound/test/idb-failure.wav'; env.failPublication( new DOMException( 'metadata quota', 'QuotaExceededError' ) );
		await assert.rejects( ensureUnit( id, path, async ( _, root ) => { await writeFile( root, path, 'x' ); return [{path,size:1}]; } ), { name: 'QuotaExceededError' } );
		assert.equal( await readUnit( id, assetRoute( path ) ), null );
	} );
	await t.test( 'AbortError is propagated without publishing a unit', async () => {
		const path = 'sound/test/cancel.wav';
		await assert.rejects( ensureUnit( id, path, () => { throw new DOMException( 'cancel', 'AbortError' ); } ), { name: 'AbortError' } );
		assert.equal( await readUnit( id, assetRoute( path ) ), null );
	} );
	await t.test( 'cross-session Web Lock recheck prevents duplicate compilation', async () => {
		let count = 0; const path = 'sound/test/coalesced.wav';
		const compile = async ( _, root ) => { count++; await new Promise( resolve => setTimeout( resolve, 5 ) ); await writeFile( root, path, 'x' ); return [{path,size:1}]; };
		await Promise.all( [ensureUnit( id, path, compile ), ensureUnit( id, path, compile )] ); assert.equal( count, 1 );
	} );
	await t.test( 'corruption triggers repair; failed repair keeps old pointer', async () => {
		const route = assetRoute( 'sound/test/shared.wav' ), unit = await readUnit( id, route ), key = await unitKey( id, route.key ), old = await getSetting( key.setting );
		await writeFile( unit.root, route.path, 'bad' ); assert.equal( await readUnit( id, route ), null );
		await assert.rejects( ensureUnit( id, route.path, () => { throw new Error( 'failed repair' ); } ) ); assert.equal( await getSetting( key.setting ), old );
		assert.equal( await ( await ok( '/sound/test/shared.wav' ) ).text(), 'SYNTHETIC-AUDIO' );
	} );
	await t.test( 'missing source asset fails explicitly with no network fetch', async () => {
		const previous = globalThis.fetch; globalThis.fetch = () => { throw new Error( 'Forbidden network fallback' ); };
		try { const r = await response( '/assets/textures/missing.png' ); assert.equal( r.status, 500 ); assert.match( await r.text(), /missing/ ); } finally { globalThis.fetch = previous; }
	} );
	await t.test( 'changed archive directory refuses generation mixing', async () => {
		const replacement = syntheticInstall(); replacement['sound/test/new.wav'] = 'new';
		ensure = await compiler( [{path:'main/synthetic.iwd',file:syntheticIwd(replacement)}] );
		const r = await response( '/sound/test/new.wav' ); assert.equal( r.status, 500 ); assert.match( await r.text(), /Archive index changed/ );
	} );
	await t.test( 'worker restart needs no source binding for warm content', async () => {
		ensure = await compiler();
		for ( const path of ['/sound/test/shared.wav','/maps/mp_fixture_alpha/manifest.json','/assets/models/fixture_gun.json','/assets/animations/fixture_motion.json'] ) assert.equal( ( await ok( path ) ).headers.get( 'X-CoD2-Cache' ), 'unit-hit' );
	} );
	await t.test( 'uncached content after restart explains missing source binding', async () => {
		const r = await response( '/sound/test/uncached.wav' ); assert.equal( r.status, 404 ); assert.match( await r.text(), /source binding/ );
	} );
} );
