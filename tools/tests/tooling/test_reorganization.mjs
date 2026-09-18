/*
===============================================================================

	test_reorganization.mjs

	Call of Duty 2 / id Tech Architecture Reorganization & Tooling Test
	Validates canonical module exports, runtime manifest generation,
	browser asset virtualization guards, local module building, and CLI runner.

===============================================================================
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { STAGES, assetSpecifier, browserAssetsPlugin, runtimeFiles } from '../../build/browser_assets_plugin.mjs';
import * as middleware from '../../debug/movement_trace_server.mjs';
import { buildBrowserModules } from '../../build/build_browser_modules.mjs';
import { sha256Hex } from '../../lib/ts_project.mjs';
import { smokeBrowserModules } from './smoke_browser_modules.mjs';

const TOOLS = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '../..' );


// ---------------------------------------------------------------------------
// test fixture helpers
// ---------------------------------------------------------------------------

/*
====================
fixture

Creates a temporary directory cleaned up when the test concludes.
====================
*/
function fixture( t ) {
	const root = fs.mkdtempSync( path.join( os.tmpdir(), 'cod2-cleanup-' ) );
	t.after( () => fs.rmSync( root, { recursive: true, force: true } ) );
	return root;
}

/*
====================
write

Writes synthetic file data into the fixture directory tree.
====================
*/
function write( root, name, data = '// synthetic test source\n' ) {
	const p = path.join( root, name );
	fs.mkdirSync( path.dirname( p ), { recursive: true } );
	fs.writeFileSync( p, data );
}

/*
====================
runtimeFixture

Populates a temporary project tree with tooling and stub browser modules.
====================
*/
function runtimeFixture( t ) {
	const root = fixture( t );
	fs.cpSync( TOOLS, path.join( root, 'tools' ), {
		recursive: true,
		filter: ( src ) => !src.includes( '__pycache__' ),
	} );

	for ( const n of [
		'db.mjs',
		'storage.mjs',
		'async.mjs',
		'opfs-writer.mjs',
		'install.mjs',
		'retail-files.mjs',
		'runtime/import.worker.js',
	] ) {
		write( root, 'browser/' + n );
	}

	write( root, 'browser/local-assets.sw.mjs', "import './db.mjs'; import './storage.mjs';" );
	write( root, 'browser/decoders/retail-pipeline.ts', 'export const answer: number = 42;' );
	return root;
}


// ---------------------------------------------------------------------------
// reorganization unit tests
// ---------------------------------------------------------------------------

test( 'canonical modules export expected build and debug functions', () => {
	assert.deepEqual(
		Object.keys( { STAGES, assetSpecifier, browserAssetsPlugin, runtimeFiles } ).sort(),
		['STAGES', 'assetSpecifier', 'browserAssetsPlugin', 'runtimeFiles'].sort()
	);
	assert.ok( typeof middleware.movementTraceMiddleware === 'function' );
} );

test( 'browser stages retain pure typescript decoder graph and exact source hashes', ( t ) => {
	const root = runtimeFixture( t );
	const files = runtimeFiles( root );
	const manifest = JSON.parse( files.get( 'browser-runtime/manifest.json' ) );

	assert.equal( STAGES.length, 11 );
	assert.deepEqual( manifest.stages, STAGES );

	for ( const entry of manifest.sources ) {
		const sourceBytes = files.get( 'browser-runtime/sources/' + entry.path ) || fs.readFileSync( path.join( root, entry.path ) );
		assert.equal( sha256Hex( sourceBytes ), entry.sha256 );
	}

	assert.match( files.get( 'local-assets.sw.js' ).toString(), /\/browser-runtime\/db\.mjs/ );
	assert.ok( files.has( 'browser-runtime/retail-pipeline.js' ) );
} );

test( 'browser asset virtualization and deployment guards remain active', ( t ) => {
	const root = runtimeFixture( t );
	const plugin = browserAssetsPlugin( root );

	assert.deepEqual( assetSpecifier( '@/assets/ui/data.json', root ), { kind: 'json', path: 'assets/ui/data.json' } );
	assert.deepEqual( assetSpecifier( '@/assets/image.png?url', root ), { kind: 'url', path: 'assets/image.png' } );
	assert.throws( () => assetSpecifier( '@/assets/../secret.json', root ), /Unsafe/ );
	assert.throws( () => assetSpecifier( '@/assets/game.iwd', root ), /cannot.*bundle/ );
	assert.match( plugin.load( plugin.resolveId( '@/assets/ui/data.json' ) ), /Asset_JSON/ );

	const emits = [];
	plugin.generateBundle.call( { emitFile: ( e ) => emits.push( e ) }, {}, {} );

	assert.ok( emits.some( ( e ) => e.fileName === 'browser-runtime/manifest.json' ) );
	assert.ok( !emits.some( ( e ) => /\.(exe|dll|iwd|iwi)$/i.test( e.fileName ) ) );
	assert.throws( () => plugin.generateBundle.call( { emitFile() {} }, {}, { 'game.iwd': { type: 'asset' } } ), /Proprietary asset/ );
	assert.throws( () => plugin.generateBundle.call( { emitFile() {} }, {}, { 'bad.js': { type: 'chunk', modules: { [path.join( root, 'assets/game.json' )]: {} } } } ), /escaped/ );
} );

test( 'relocated local-only builder emits and smoke-links a synthetic project', async ( t ) => {
	const root = fixture( t );
	write( root, 'index.html', '<script type="module" src="/index.ts"></script>' );
	write( root, 'index.ts', "import {value} from '@/engine/value.js'; export const result:number=value+1;" );
	write( root, 'engine/value.ts', 'export const value:number=41;' );

	const dist = path.join( root, 'dist' );
	const result = await buildBrowserModules( root, dist );

	assert.ok( ( result.fileCount || result.moduleCount ) > 2 );
	fs.appendFileSync( path.join( dist, 'index.js' ), '\n// tamper' );
	await assert.rejects( () => smokeBrowserModules( dist ), /manifest.*(?:size|hash) mismatch/s );
} );

test( 'node launcher lists without importing commands and rejects archived/unknown names', ( t ) => {
	const cwd = fixture( t );

	for ( const args of [['list'], ['info', 'test_browser_build']] ) {
		const result = spawnSync( process.execPath, [path.join( TOOLS, 'run.mjs' ), ...args], { cwd, encoding: 'utf8' } );
		assert.equal( result.status, 0, result.stderr );
	}

	const result = spawnSync( process.execPath, [path.join( TOOLS, 'run.mjs' ), 'patch_menu_runtime'], { cwd, encoding: 'utf8' } );
	assert.notEqual( result.status, 0 );
} );
