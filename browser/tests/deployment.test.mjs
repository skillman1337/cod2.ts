/*
===============================================================================

	deployment.test.mjs

	Portable URL, code emission and service-worker scope regression tests.

===============================================================================
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { normalizeBase, appURL } from '../deployment.mjs';
import { runtimeFiles } from '../../tools/build/browser_assets_plugin.mjs';
import { Asset_SetBase, Asset_LocalURL, Asset_Fetch } from '../../engine/common/asset_paths.ts';

const root = fileURLToPath( new URL( '../../', import.meta.url ) );

test( 'base paths allow dotted repository names and reject URL escapes', () => {
	for ( const [input, expected] of [['/', '/'], ['/cod2.ts', '/cod2.ts/'], ['/cod2-ts/', '/cod2-ts/'], ['/nested/site/', '/nested/site/']] ) {
		assert.equal( normalizeBase( input ), expected );
	}
	for ( const invalid of ['', '.', '../x', 'https://evil.test/', '//evil.test/', '/a/../b/', '/a/%2e%2e/', '/a?b/', '/a\\b/', '/a b/'] ) {
		assert.throws( () => normalizeBase( invalid ) );
	}
	assert.equal( appURL( '?assets=manage' ), '/?assets=manage' );
	assert.throws( () => appURL( '../other' ) );
} );

test( 'canonical game paths resolve once, for every asset family', () => {
	for ( const base of ['/', '/cod2.ts/', '/cod2-ts/', '/nested/site/'] ) {
		Asset_SetBase( base );
		for ( const path of ['/maps/mp_any/world.bin', '/sound/ambient.json', '/assets/textures/test%23image.png', '/viewmodels/models/any.json', '/characters/animations/any.json', '/weaponfx/catalog.json', '/__cod2_local/id/assets/image.png'] ) {
			assert.equal( Asset_LocalURL( path ), base + path.slice( 1 ) );
			assert.equal( Asset_LocalURL( Asset_LocalURL( path ) ), base + path.slice( 1 ) );
		}
		assert.equal( Asset_LocalURL( 'blob:test' ), 'blob:test' );
		assert.equal( Asset_LocalURL( 'https://example.test/assets/image.png' ), 'https://example.test/assets/image.png' );
	}
	Asset_SetBase( '/' );
} );

test( 'asset fetch retains request options and never rewrites a remote origin', async () => {
	const previous = globalThis.fetch, oldLocation = globalThis.location;
	const seen = [];
	globalThis.location = { href: 'https://game.test/cod2.ts/', origin: 'https://game.test' };
	globalThis.fetch = async ( input, init ) => { seen.push( { input, init } ); return new Response( 'ok' ); };
	try {
		Asset_SetBase( '/cod2.ts/' );
		await Asset_Fetch( '/sound/test.wav', { headers: { Range: 'bytes=0-3' } } );
		assert.equal( seen[0].input, '/cod2.ts/sound/test.wav' );
		assert.equal( seen[0].init.headers.Range, 'bytes=0-3' );
		await Asset_Fetch( new Request( 'https://game.test/assets/file.png', { method: 'HEAD' } ) );
		assert.equal( seen[1].input.url, 'https://game.test/cod2.ts/assets/file.png' );
		assert.equal( seen[1].input.method, 'HEAD' );
		await Asset_Fetch( new URL( 'https://remote.test/assets/file.png' ) );
		assert.equal( seen[2].input.href, 'https://remote.test/assets/file.png' );
	} finally { globalThis.fetch = previous; globalThis.location = oldLocation; Asset_SetBase( '/' ); }
} );

test( 'emitted worker imports are relative and deployment storage is namespaced', async () => {
	for ( const base of ['/', '/cod2.ts/'] ) {
		const files = runtimeFiles( root, true, base );
		const sw = files.get( 'local-assets.sw.js' ).toString();
		assert.match( sw, /from '\.\/browser-runtime\/storage.mjs'/ );
		assert.doesNotMatch( sw, /from '\/browser-runtime/ );
		const deployment = await import( 'data:text/javascript;base64,' + files.get( 'browser-runtime/deployment.mjs' ).toString( 'base64' ) );
		assert.equal( deployment.APP_BASE, base );
		assert.equal( deployment.STORAGE_SUFFIX === '', base === '/' );
	}
} );

test( 'project service worker does not intercept another app or origin', async () => {
	const prior = globalThis.self;
	const handlers = {};
	globalThis.self = { location: { origin: 'https://game.test' }, registration: { scope: 'https://game.test/cod2.ts/' }, addEventListener: ( name, fn ) => handlers[name] = fn };
	try {
		await import( '../local-assets.sw.mjs?scope-test' );
		for ( const url of ['https://game.test/assets/file.png', 'https://game.test/other/assets/file.png', 'https://evil.test/cod2.ts/assets/file.png', 'https://game.test/cod2.ts/app-code/index.js'] ) {
			let intercepted = false;
			handlers.fetch( { request: new Request( url ), respondWith: () => intercepted = true } );
			assert.equal( intercepted, false, url );
		}
	} finally { globalThis.self = prior; }
} );
