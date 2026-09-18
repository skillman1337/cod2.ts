/*
===============================================================================

	launcher.test.mjs

	Call of Duty 2 / id Tech Launcher Flow Unit Tests
	Executes the real launcher control flow with mocked browser, storage,
	and engine ports. Validates boot sequencing, user action states,
	pointer lock release, and error handling.

===============================================================================
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

import { mapLimit } from '../async.mjs';
import { COMPILER_VERSION } from '../asset-routing.mjs';
import { BUILD_REVISION } from '../deployment.mjs';

const original = fs.readFileSync( new URL( '../main.mjs', import.meta.url ), 'utf8' );
const lifecycle = fs.readFileSync( new URL( '../launcher-runtime.mjs', import.meta.url ), 'utf8' ).replace( /^export /gm, '' ).replace( /^import .*;\n/gm, '' );
const source = lifecycle + '\n' + original
	.replace( /^import .*;\n/gm, '' )
	.replace( "await import('../index.ts')", 'await __loadEngine()' )
	.replace( 'boot().catch(error =>', 'globalThis.bootDone = boot().catch(error =>' );

const nextTurn = () => new Promise( ( resolve ) => setImmediate( resolve ) );

/*
====================
until

Polls the condition callback across event loop turns until true.
====================
*/
async function until( check ) {
	for ( let n = 0; n < 30; n++ ) {
		if ( check() ) {
			return;
		}
		await nextTurn();
	}
	throw new Error( 'Launcher did not reach expected state' );
}


// ---------------------------------------------------------------------------
// test harness setup
// ---------------------------------------------------------------------------

/*
====================
harness

Constructs a simulated browser context with mocked DOM elements,
event targets, message channels, service worker, and storage hooks.
====================
*/
function harness( { cache = true, saved = false, search = '', badJson = false, base = '/', compilerVersion = COMPILER_VERSION, permissionGranted = false, remoteRevision = null, buildRevision = null } = {} ) {
	const calls = [];
	const nodes = new Map();
	const state = { hidden: false, error: null };
	const marks = new Map();
	const measures = new Map();

	const el = ( id ) => {
		if ( !nodes.has( id ) ) {
			nodes.set( id, { firstChild: { textContent: '' } } );
		}
		return nodes.get( id );
	};

	const ui = {
		el,
		panel: state,
		show( ...names ) {
			state.actions = names;
		},
		begin( mode ) {
			calls.push( `begin:${mode}` );
		},
		status() {},
		log() {},
		stage() {},
		task() {},
		ready( value ) {
			state.ready = value;
		},
		fail( error ) {
			state.error = error;
		},
		finish() {
			state.hidden = true;
			calls.push( 'finish' );
		},
	};

	const window = new EventTarget();
	window.showDirectoryPicker = () => {
		throw new Error( 'Unexpected picker' );
	};

	class Channel {
		constructor() {
			this.port1 = { close() {}, onmessage: null };
			this.port2 = {
				postMessage: ( data ) => queueMicrotask( () => this.port1.onmessage?.( { data } ) ),
			};
		}
	}

	const snapshot = new File( [badJson ? '{broken' : '{"ok":true}'], 'table.json' );
	const generation = cache
		? {
			manifest: { id: '12345678-1234-1234-1234-123456789abc', compilerVersion },
			verified: new Map( [['assets/ui/table.json', snapshot]] ),
		}
		: null;

	const context = vm.createContext( {
		window,
		APP_BASE: base,
		appURL: ( path = '' ) => base + path,
		EventTarget,
		URL,
		URLSearchParams,
		MessageChannel: Channel,
		Map,
		Set,
		Promise,
		Error,
		DOMException,
		setTimeout,
		clearTimeout,
		isSecureContext: true,
		console: { info() {}, error() {} },
		location: {
			pathname: base,
			search,
			href: 'https://game.test' + base + search,
			origin: 'https://game.test',
			assign: ( path ) => calls.push( `navigate:${path}` ),
			reload: () => calls.push( 'location-reload' ),
		},
		document: {
			createElement: () => ( {} ),
			body: { append() {} },
			exitPointerLock() {
				calls.push( 'exit-pointer-lock' );
			},
		},
		navigator: {
			gpu: {},
			locks: {},
			storage: { getDirectory() {} },
			serviceWorker: {
				ready: Promise.resolve(),
				register: async () => calls.push( 'register-worker' ),
				controller: {
					scriptURL: 'https://game.test' + base + 'local-assets.sw.js',
					postMessage( message, ports ) {
						calls.push( `worker:${message.type}` );
						ports?.[0].postMessage( { ok: true } );
					},
				},
			},
		},
		performance: {
			mark( name ) {
				marks.set( name, performance.now() );
			},
			measure( name, start, end ) {
				const entry = { duration: marks.get( end ) - marks.get( start) };
				measures.set( name, entry );
				return entry;
			},
			getEntriesByName( name ) {
				return measures.has( name ) ? [measures.get( name )] : [];
			},
		},
		getSetting: async ( key ) => {
			if ( key === 'directory' ) {
				return saved
					? {
						name: 'Call of Duty 2',
						requestPermission() {
							calls.push( 'permission-requested' );
							return Promise.resolve( 'granted' );
						},
						...( permissionGranted ? { queryPermission: async () => 'granted' } : {} ),
					}
					: null;
			}
			if ( key === 'compilerVersion' ) {
				return compilerVersion;
			}
			return null;
		},
		fetch: remoteRevision
			? async () => ( {
				ok: true,
				json: async () => ( { revision: remoteRevision, compilerVersion: COMPILER_VERSION, cacheVersion: 5 } ),
			} )
			: undefined,
		sessionStorage: {
			getItem: () => null,
			setItem: ( key, val ) => calls.push( `sessionStorage:${key}=${val}` ),
		},
		activeGeneration: async () => generation,
		COMPILER_VERSION,
		BUILD_REVISION: buildRevision ?? BUILD_REVISION,
		JSON_FILES: ['assets/ui/table.json'],
		CACHE_FOLDER: 'test',
		mapLimit,
		Asset_Initialize( id, json ) {
			assert.equal( json.get( 'assets/ui/table.json' ).ok, true );
			calls.push( 'initialize-assets' );
		},
		createSetupView: () => ui,
		createDemandClient: () => ( { close() {} } ),
		async __loadEngine() {
			assert.ok( calls.includes( 'initialize-assets' ) );
			calls.push( 'engine-imported' );
		},
	} );

	vm.runInContext( source, context, { filename: 'launcher-under-test.mjs' } );

	return {
		calls,
		state,
		el,
		window,
		APP_BASE: base,
		appURL: ( path = '' ) => base + path,
		done: context.bootDone,
		signal( phase, message = phase ) {
			window.dispatchEvent( new CustomEvent( 'cod2:engine-status', { detail: { phase, message } } ) );
		},
	};
}


// ---------------------------------------------------------------------------
// launcher orchestration tests
// ---------------------------------------------------------------------------

test( 'first visit displays one folder action without opening the picker', async () => {
	const h = harness( { cache: false } );
	await h.done;

	assert.deepEqual( [...h.state.actions], ['choose'] );
	assert.equal( h.state.ready.saved, false );
	assert.ok( !h.calls.includes( 'engine-imported' ) );
} );

test( 'remembered folder does not automatically request permission or re-import', async () => {
	const h = harness( { cache: false, saved: true } );
	await h.done;

	assert.deepEqual( [...h.state.actions], ['resume', 'change', 'forget'] );
	assert.ok( !h.calls.includes( 'permission-requested' ) );
} );

test( 'cached boot initializes tables before engine import and waits for menu-ready', async () => {
	const h = harness( { saved: true } );
	await until( () => h.calls.includes( 'engine-imported' ) );

	assert.equal( h.state.hidden, false, 'module evaluation is not graphics readiness' );
	assert.ok( h.calls.indexOf( 'initialize-assets' ) < h.calls.indexOf( 'engine-imported' ) );
	assert.ok( !h.calls.includes( 'permission-requested' ) );

	h.signal( 'gpu', 'Uploading font atlas' );
	assert.equal( h.state.hidden, false );

	h.signal( 'ready' );
	await h.done;
	assert.equal( h.state.hidden, true );

	assert.equal( h.window.__cod2LoadTimings.source, 'local-cache' );
	assert.equal( h.window.__cod2LoadTimings.importMs, null );
	assert.ok( h.window.__cod2LoadTimings.launchMs >= 0 );
} );

test( 'management URL does not auto-launch a completed cache', async () => {
	const h = harness( { search: '?assets=manage' } );
	await h.done;

	assert.equal( h.state.ready.cached, true );
	assert.ok( !h.calls.includes( 'engine-imported' ) );
	assert.ok( h.state.actions.includes( 'play' ) );
} );

test( 'graphics failure keeps setup visible and retry reloads the failed module graph', async () => {
	const h = harness();
	await until( () => h.calls.includes( 'engine-imported' ) );

	h.signal( 'error', 'GPU test failure' );
	await h.done;

	assert.equal( h.state.hidden, false );
	assert.equal( h.state.error, 'GPU test failure' );

	await h.el( 'play' ).onclick();
	assert.ok( h.calls.includes( 'navigate:/' ) );
	assert.equal( h.calls.filter( ( call ) => call === 'engine-imported' ).length, 1 );
} );

test( 'corrupt cached JSON does not start the engine or hide setup', async () => {
	const h = harness( { badJson: true } );
	await h.done;

	assert.equal( h.state.hidden, false );
	assert.ok( h.state.error );
	assert.ok( !h.calls.includes( 'engine-imported' ) );
} );

test( 'quitting the game releases pointer lock and returns to cache management', async () => {
	const h = harness();
	await until( () => h.calls.includes( 'engine-imported' ) );

	h.signal( 'ready' );
	await h.done;
	assert.equal( h.state.hidden, true );

	h.signal( 'quit' );
	assert.ok( h.calls.includes( 'exit-pointer-lock' ) );
	assert.ok( h.calls.includes( 'navigate:/?assets=manage' ) );
} );


test( 'project-site quit remains inside its deployment directory', async () => {
	const h = harness( { cache: false, base: '/cod2.ts/' } );
	await h.done;
	h.signal( 'quit' );
	assert.ok( h.calls.includes( 'navigate:/cod2.ts/?assets=manage' ) );
} );


test( 'project-site first visit reaches setup instead of rejecting its subpath', async () => {
	const h = harness( { cache: false, base: '/cod2.ts/' } );
	await h.done;
	assert.equal( h.state.error, null );
	assert.deepEqual( [...h.state.actions], ['choose'] );
} );

test( 'project-site cache boot and failed-engine retry preserve the deployment path', async () => {
	const h = harness( { base: '/cod2.ts/' } );
	await until( () => h.calls.includes( 'engine-imported' ) );
	h.signal( 'error', 'Synthetic GPU error' );
	await h.done;
	assert.equal( h.state.error, 'Synthetic GPU error' );
	await h.el( 'play' ).onclick();
	assert.ok( h.calls.includes( 'navigate:/cod2.ts/' ) );
} );

test( 'outdated cache compiler version prompts user to update local cache', async () => {
	const h = harness( { cache: true, saved: true, compilerVersion: 1 } );
	await h.done;

	assert.ok( !h.calls.includes( 'engine-imported' ) );
	assert.ok( h.state.actions.includes( 'resume' ) );
	assert.ok( h.el( 'resume' ).firstChild.textContent.includes( 'Update local cache' ) );
	assert.ok( h.state.ready.message.includes( 'A game update is available' ) );
} );

test( 'newer remote build revision triggers reload of the launcher', async () => {
	const h = harness( { cache: true, saved: true, buildRevision: 'local-sha-00000', remoteRevision: 'newer-commit-sha-99999' } );
	await h.done;

	assert.ok( h.calls.includes( 'location-reload' ) );
	assert.ok( h.calls.includes( 'sessionStorage:cod2:reloaded:newer-commit-sha-99999=1' ) );
} );
