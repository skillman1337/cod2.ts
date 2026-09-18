/*
===============================================================================

	core.test.mjs

	Call of Duty 2 / id Tech Core Storage & Installation Tests
	Validates safe paths, generation UUIDs, HTTP byte ranges, binary profiles,
	installation directory layouts, and runtime asset allowlists.

===============================================================================
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { safePath, safeGeneration, byteRange, contentType, assetResponse } from '../storage.mjs';
import { inspectInstall, hashFile, BINARY_PROFILE } from '../install.mjs';
import { assetSpecifier, runtimeFiles, browserAssetsPlugin, STAGES } from '../../tools/build/browser_assets_plugin.mjs';

const root = fileURLToPath( new URL( '../..', import.meta.url ) );


// ---------------------------------------------------------------------------
// path & generation validation tests
// ---------------------------------------------------------------------------

for ( const value of ['', '../x', 'x/../y', '/etc/passwd', 'a\\b', 'x//y', 'x/./y', 'c:/x', 'a\0b'] ) {
	test( `reject unsafe path ${JSON.stringify( value )}`, () => assert.throws( () => safePath( value ) ) );
}

test( 'valid path and cache id', () => {
	assert.deepEqual( safePath( 'maps/mp_toujane/world.bin' ), ['maps', 'mp_toujane', 'world.bin'] );
	assert.equal( safeGeneration( '12345678-1234-1234-1234-123456789abc' ), '12345678-1234-1234-1234-123456789abc' );
	assert.throws( () => safeGeneration( '../../other' ) );
} );


// ---------------------------------------------------------------------------
// http range & streaming tests
// ---------------------------------------------------------------------------

test( 'HTTP byte range edge cases', () => {
	assert.equal( byteRange( null, 10 ), null );
	assert.deepEqual( byteRange( 'bytes=2-5', 10 ), [2, 5] );
	assert.deepEqual( byteRange( 'bytes=8-', 10 ), [8, 9] );
	assert.deepEqual( byteRange( 'bytes=-3', 10 ), [7, 9] );
	assert.deepEqual( byteRange( 'bytes=3-999', 10 ), [3, 9] );
	assert.deepEqual( byteRange( 'bytes=-99', 10 ), [0, 9] );

	for ( const header of ['bytes=10-', 'bytes=7-3', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'things=0-1', 'bytes=9007199254740992-'] ) {
		assert.equal( byteRange( header, 10 ), false, header );
	}

	assert.equal( byteRange( 'bytes=0-', 0 ), false );
} );

test( 'asset responses stream file slices with correct headers', async () => {
	const file = new File( [new Uint8Array( [1, 2, 3, 4, 5] )], 'test.wav' );
	const root = {
		getFileHandle: async ( name ) => {
			assert.equal( name, 'test.wav' );
			return { getFile: async () => file };
		},
	};

	const response = await assetResponse(
		new Request( 'https://local.test/test.wav', { headers: { range: 'bytes=1-3' } } ),
		root,
		'test.wav'
	);

	assert.equal( response.status, 206 );
	assert.equal( response.headers.get( 'content-range' ), 'bytes 1-3/5' );
	assert.equal( response.headers.get( 'content-type' ), 'audio/wav' );
	assert.equal( response.headers.get( 'content-length' ), '3' );
	assert.deepEqual( [...new Uint8Array( await response.arrayBuffer() )], [2, 3, 4] );

	const head = await assetResponse(
		new Request( 'https://local.test/test.wav', { method: 'HEAD' } ),
		root,
		'test.wav'
	);

	assert.equal( head.headers.get( 'content-length' ), '5' );
	assert.equal( ( await head.arrayBuffer() ).byteLength, 0 );

	const invalid = await assetResponse(
		new Request( 'https://local.test/test.wav', { headers: { range: 'bytes=20-' } } ),
		root,
		'test.wav'
	);

	assert.equal( invalid.status, 416 );
	assert.equal( invalid.headers.get( 'content-range' ), 'bytes */5' );
} );


// ---------------------------------------------------------------------------
// binary profiling & directory inspection tests
// ---------------------------------------------------------------------------

test( 'binary SHA256 and strict profile', async () => {
	assert.equal(
		await hashFile( new File( ['abc'], 'test.exe' ) ),
		'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
	);
	assert.equal( Object.keys( BINARY_PROFILE ).length, 1 );
	assert.equal( contentType( 'textures/x.bin' ), 'application/octet-stream' );
} );

function dir( rows, name = 'test' ) {
	return {
		kind: 'directory',
		name,
		async *entries() {
			yield* rows;
		},
	};
}

test( 'wrong selected directory fails with actionable guidance', async () => {
	await assert.rejects( inspectInstall( dir( [] ) ), /installation folder, not main/ );
	await assert.rejects( inspectInstall( dir( [['main', dir( [] )]] ) ), /No IWD archives found in main/ );
} );

test( 'accepts installation with only main/*.iwd archives and no binaries', async () => {
	const iwd = {
		kind: 'file',
		getFile: async () => new File( ['fake archive content for testing'], 'iw_00.iwd' ),
	};
	const res = await inspectInstall( dir( [['main', dir( [['iw_00.iwd', iwd]] )]] ) );

	assert.equal( res.archives.length, 1 );
	assert.equal( res.files.length, 1 );
	assert.equal( Object.keys( res.binaries ).length, 0 );
} );

test( 'accepts any game binary without SHA-256 restrictions', async () => {
	const binary = {
		kind: 'file',
		getFile: async () => new File( ['custom or patched binary'], 'CoD2MP_s.exe' ),
	};
	const iwd = {
		kind: 'file',
		getFile: async () => new File( ['fake archive content for testing'], 'iw_00.iwd' ),
	};
	const res = await inspectInstall( dir( [
		['main', dir( [['iw_00.iwd', iwd]] )],
		['cod2mp_s.exe', binary],
	] ), undefined, { inspectBinaries: true } );

	assert.equal( res.archives.length, 1 );
	assert.equal( res.files.length, 2 );
	assert.ok( res.binaries['CoD2MP_s.exe'] );
} );

test( 'ambiguous case-insensitive directory entries are rejected', async () => {
	await assert.rejects( inspectInstall( dir( [['main', dir( [] )], ['MAIN', dir( [] )]] ) ), /Ambiguous/ );
} );


// ---------------------------------------------------------------------------
// asset specifier & bundler plugin tests
// ---------------------------------------------------------------------------

test( 'virtual game assets are runtime references, never read or bundled', () => {
	assert.deepEqual( assetSpecifier( '@/assets/ui/menus.json', root ), { kind: 'json', path: 'assets/ui/menus.json' } );
	assert.deepEqual( assetSpecifier( path.join( root, 'assets/images/gamefonts.png' ) + '?url', root ), { kind: 'url', path: 'assets/images/gamefonts.png' } );
	assert.equal( assetSpecifier( '@/engine/common/pm.ts', root ), null );
	assert.throws( () => assetSpecifier( '@/assets/../binary', root ) );
	assert.throws( () => assetSpecifier( '@/assets/game.iwd', root ) );

	const plugin = browserAssetsPlugin( root );
	const id = plugin.resolveId( '@/assets/ui/strings.json' );

	assert.match( plugin.load( id ), /Asset_JSON/ );
	assert.doesNotMatch( plugin.load( id ), /fetch|base64/ );
} );

test( 'runtime file allowlist contains code only, including character extraction', () => {
	const files = runtimeFiles( root, false );
	const manifest = JSON.parse( files.get( 'browser-runtime/manifest.json' ) );

	assert.ok( STAGES.some( ( stage ) => stage.id === 'characters' ) );
	assert.ok( files.has( 'local-assets.sw.js' ) );
	assert.match( files.get( 'local-assets.sw.js' ).toString(), /\/browser-runtime\/storage.mjs/ );

	for ( const [name] of files ) {
		assert.ok( !/\.(exe|dll|iwd|iwi|d3dbsp|png|mp3|wav)$/i.test( name ), name );
	}

	for ( const source of manifest.sources ) {
		assert.match( source.sha256, /^[a-f0-9]{64}$/ );
	}

	assert.ok( [...files.keys()].every( ( name ) => !name.startsWith( 'assets/' ) ), 'Runtime manifest must exclude proprietary asset outputs' );
} );

test( 'engine is gated by local initialization and no publicDir copying', () => {
	const main = fs.readFileSync( path.join( root, 'browser/main.mjs' ), 'utf8' );
	assert.ok( main.indexOf( 'Asset_Initialize(cache.manifest.id' ) < main.indexOf( "await import('../index.ts')" ) );

	const vite = fs.readFileSync( path.join( root, 'vite.config.ts' ), 'utf8' );
	assert.match( vite, /publicDir = false/ );
	assert.match( vite, /assetsDir: 'app-code'/ );
} );

test( 'production plugin emits a bundled worker entry and only code support assets', () => {
	const emitted = [];
	const plugin = browserAssetsPlugin( root );

	plugin.configResolved( { command: 'build' } );
	plugin.buildStart.call( { emitFile: ( entry ) => emitted.push( entry ) } );
	plugin.generateBundle.call( { emitFile: ( entry ) => emitted.push( entry ) } );

	assert.equal( emitted.filter( ( entry ) => entry.type === 'chunk' ).length, 2 );
	assert.equal( emitted.find( ( entry ) => entry.type === 'chunk' )?.fileName, 'browser-runtime/import.worker.js' );

	const names = emitted.map( ( entry ) => entry.fileName );

	assert.ok( names.includes( 'local-assets.sw.js' ) );
	assert.ok( names.includes( 'browser-runtime/manifest.json' ) );
	assert.ok( names.includes( 'browser-runtime/retail-pipeline.js' ) );
	assert.ok( names.every( ( name ) => !/\.(py|pyc|exe|dll|iwd|iwi|d3dbsp|png|mp3|wav)$/i.test( name ) ), 'Support assets must be JS/JSON runtime code only.' );
} );
