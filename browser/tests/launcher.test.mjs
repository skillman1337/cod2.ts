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

const original = fs.readFileSync( new URL( '../main.mjs', import.meta.url ), 'utf8' );
const lifecycle = fs.readFileSync( new URL( '../launcher-runtime.mjs', import.meta.url ), 'utf8' ).replace( /^export /gm, '' );
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
function harness( { cache = true, saved = false, search = '', badJson = false } = {} ) {
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
			manifest: { id: '12345678-1234-1234-1234-123456789abc' },
			verified: new Map( [['assets/ui/table.json', snapshot]] ),
		}
		: null;

	const context = vm.createContext( {
		window,
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
			pathname: '/',
			search,
			href: 'https://game.test/' + search,
			origin: 'https://game.test',
			assign: ( path ) => calls.push( `navigate:${path}` ),
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
		getSetting: async () => (
			saved
				? {
					requestPermission() {
						calls.push( 'permission-requested' );
						return Promise.resolve( 'granted' );
					},
				}
				: null
		),
		activeGeneration: async () => generation,
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
