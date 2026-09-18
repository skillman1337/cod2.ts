/*
===============================================================================

	retail-files.test.mjs

	Call of Duty 2 / id Tech Retail File Staging Tests
	Validates canonical launcher handoff planning, case-insensitive path
	normalization, native binary MEMFS staging, WORKERFS archive mounting,
	and virtual filesystem isolation.

===============================================================================
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { BINARY_PROFILE } from '../install.mjs';
import {
	planRetailFiles,
	stageNativeFile,
	stageRetailFiles,
	mountRetailArchives,
	MAX_NATIVE_BYTES,
} from '../retail-files.mjs';
import { runtimeFiles } from '../../tools/build/browser_assets_plugin.mjs';

const names = Object.keys( BINARY_PROFILE );
const sha = ( bytes ) => crypto.createHash( 'sha256' ).update( bytes ).digest( 'hex' );
const fixture = new Uint8Array( [77, 90, 1, 2, 3, 4] ); // Synthetic input, not a retail binary or real PE

const files = () => [
	...names.map( ( name ) => ( { path: name, file: new File( [fixture], name ) } ) ),
	{ path: 'main/iw_00.iwd', file: new File( [new Uint8Array( 22 )], 'iw_00.iwd' ) },
];


// ---------------------------------------------------------------------------
// memory filesystem mock helpers
// ---------------------------------------------------------------------------

/*
====================
memoryFS

Constructs an in-memory mock of Emscripten's FS interface supporting
MEMFS file creation, stat lookups, and WORKERFS archive mounts.
====================
*/
function memoryFS() {
	const entries = new Map();
	const modes = new Map();
	const archiveStats = new Map();

	return {
		entries,
		modes,
		archiveStats,
		mounts: [],
		filesystems: { WORKERFS: {} },
		mkdirTree() {},
		writeFile( path, data ) {
			entries.set( path, new Uint8Array( data ) );
			modes.set( path, 0o100666 );
		},
		readFile( path ) {
			if ( !entries.has( path ) ) {
				throw new Error( `ENOENT ${path}` );
			}
			return new Uint8Array( entries.get( path ) );
		},
		stat( path ) {
			if ( archiveStats.has( path ) ) {
				return archiveStats.get( path );
			}
			if ( !entries.has( path ) ) {
				throw new Error( `ENOENT ${path}` );
			}
			return { mode: modes.get( path ), size: entries.get( path ).length };
		},
		isFile( mode ) {
			return ( mode & 0o170000 ) === 0o100000;
		},
		chmod( path, mode ) {
			modes.set( path, 0o100000 | mode );
		},
		mount( type, options, path ) {
			this.mounts.push( { type, options, path } );
			for ( const blob of options.blobs ) {
				archiveStats.set( `${path}/${blob.name}`, { mode: 0o100444, size: blob.data.size } );
			}
		},
	};
}


// ---------------------------------------------------------------------------
// retail file planning tests
// ---------------------------------------------------------------------------

test( 'canonical launcher handoff includes game binary', () => {
	const plan = planRetailFiles( files() );
	assert.deepEqual( plan.binaries.map( ( item ) => item.name ), names );
	assert.deepEqual( plan.archives.map( ( item ) => item.name ), ['iw_00.iwd'] );
} );

test( 'root filename case and explicit bin paths normalize to exact Python names', () => {
	const input = files();
	input[0].path = 'BIN\\COD2MP_S.EXE';
	input[1].path = 'MAIN\\IW_00.IWD';

	const plan = planRetailFiles( input );
	assert.deepEqual( plan.binaries.map( ( item ) => item.name ), names );
	assert.equal( plan.archives[0].name, 'iw_00.iwd' );
} );

test( 'worker accepts archive-only input without binaries', () => {
	const plan = planRetailFiles( files().slice( 1 ) );
	assert.equal( plan.binaries.length, 0 );
	assert.equal( plan.archives.length, 1 );
} );

test( 'worker rejects empty input and missing archives', () => {
	assert.throws( () => planRetailFiles( [] ), /No main\/\*\.iwd/ );
	assert.throws( () => planRetailFiles( files().slice( 0, 1 ) ), /No main\/\*\.iwd/ );
} );

test( 'duplicate native files across root and bin are rejected', () => {
	const input = files();
	input.push( { path: `bin/${names[0]}`, file: input[0].file } );
	assert.throws( () => planRetailFiles( input ), /Ambiguous native binary/ );
} );

test( 'duplicate archive names with different casing are rejected', () => {
	const input = files();
	input.push( { path: 'MAIN/IW_00.IWD', file: input[1].file } );
	assert.throws( () => planRetailFiles( input ), /Ambiguous archive/ );
} );

for ( const name of [
	'../CoD2MP_s.exe',
	'/retail/bin/CoD2MP_s.exe',
	'D:\\games\\CoD2MP_s.exe',
	'main//iw_00.iwd',
	'main/./iw_00.iwd',
	'main/a\0.iwd',
	'main/nested/iw_00.iwd',
	'backup/CoD2MP_s.exe',
] ) {
	test( `reject invalid handoff path ${JSON.stringify( name )}`, () => {
		const input = files();
		input[0].path = name;
		assert.throws( () => planRetailFiles( input ), /Unsafe local-file path|Unexpected local-file path/ );
	} );
}

test( 'reject malformed handoff and zero-byte native files', () => {
	assert.throws( () => planRetailFiles( null ), /Invalid local-file handoff/ );

	const input = files();
	input[0].file = { kind: 'file' };
	assert.throws( () => planRetailFiles( input ), /File\/Blob/ );

	input[0].file = new File( [], names[0] );
	assert.throws( () => planRetailFiles( input ), /Invalid native binary size/ );
} );

test( 'oversized binaries are rejected before allocation', () => {
	const input = files();
	Object.defineProperty( input[0].file, 'size', { value: MAX_NATIVE_BYTES + 1 } );
	assert.throws( () => planRetailFiles( input ), /Invalid native binary size/ );
} );


// ---------------------------------------------------------------------------
// binary staging tests
// ---------------------------------------------------------------------------

test( 'native snapshot has the exact canonical path, bytes, digest and read-only mode', async () => {
	const FS = memoryFS();
	const name = names[0];
	const result = await stageNativeFile( FS, name, new File( [fixture], name ) );

	assert.deepEqual( result, { path: `/retail/bin/${name}`, size: fixture.length, sha256: sha( fixture ) } );
	assert.deepEqual( FS.readFile( result.path ), fixture );
	assert.equal( FS.modes.get( result.path ), 0o100444 );
	assert.equal( FS.mounts.length, 0, 'Native binaries must not use WORKERFS' );
} );

test( 'staging reads the File instead of assuming file.name is the virtual path', async () => {
	const FS = memoryFS();
	const logicalName = names[0];

	await stageNativeFile( FS, logicalName, new File( [fixture], 'ANOTHER_CASE.EXE' ) );
	assert.ok( FS.entries.has( `/retail/bin/${logicalName}` ) );
	assert.ok( !FS.entries.has( '/retail/bin/ANOTHER_CASE.EXE' ) );
} );

test( 'corrupt MEMFS writes are detected by the readback check', async () => {
	const FS = memoryFS();
	const write = FS.writeFile;

	FS.writeFile = ( path, bytes ) => {
		const damaged = new Uint8Array( bytes );
		damaged[0] ^= 1;
		write( path, damaged );
	};

	await assert.rejects( stageNativeFile( FS, names[0], new File( [fixture], names[0] ) ), /Native binary staging failed/ );
} );

test( 'file read failure gives permission/change guidance', async () => {
	const FS = memoryFS();
	const file = new File( [fixture], names[0] );

	file.arrayBuffer = async () => {
		throw new DOMException( 'Changed', 'NotReadableError' );
	};

	await assert.rejects( stageNativeFile( FS, names[0], file ), /Could not read local.*Reopen the saved folder/ );
} );

test( 'IWD bodies are not eagerly read while planning native inputs', () => {
	const input = files();
	input[1].file.arrayBuffer = () => {
		throw new Error( 'No eager archive reads' );
	};

	assert.equal( planRetailFiles( input ).archives[0].data, input[1].file );
} );

test( 'production staging stages binaries to MEMFS', async () => {
	const FS = memoryFS();
	const staged = await stageRetailFiles( FS, files() );

	assert.equal( staged.length, 1 );
	assert.equal( FS.mounts.length, 1 );
	assert.equal( FS.mounts[0].path, '/retail/main' );
	assert.ok( FS.entries.has( '/retail/bin/CoD2MP_s.exe' ) );
} );

test( 'production accepts omitted binaries and mounts archives', async () => {
	const FS = memoryFS();
	const staged = await stageRetailFiles( FS, files().slice( 1 ) );

	assert.equal( staged.length, 0 );
	assert.equal( FS.mounts.length, 1 );
	assert.equal( FS.mounts[0].path, '/retail/main' );
} );

test( 'staged binary survives simulated output flushes and repeated reads', async () => {
	const FS = memoryFS();
	const name = names[0];

	await stageNativeFile( FS, name, new File( [fixture], name ) );

	for ( let i = 0; i < 15; i++ ) {
		FS.writeFile( `/cod2/public/stage-${i}`, new Uint8Array( [i] ) );
		for ( const key of FS.entries.keys() ) {
			if ( key.startsWith( '/cod2/public/' ) ) {
				FS.entries.delete( key );
			}
		}
		assert.deepEqual( FS.readFile( `/retail/bin/${name}` ), fixture );
	}
} );


// ---------------------------------------------------------------------------
// runtime deployment & worker filesystem tests
// ---------------------------------------------------------------------------

test( 'runtime deployment includes the new helper and its transitive import', () => {
	const root = fileURLToPath( new URL( '../..', import.meta.url ) );
	const outputs = runtimeFiles( root, false );

	assert.ok( outputs.has( 'browser-runtime/retail-files.mjs' ) );
	assert.ok( outputs.has( 'browser-runtime/install.mjs' ) );
	assert.ok( outputs.has( 'browser-runtime/retail-pipeline.js' ) );
	assert.ok( outputs.has( 'browser-runtime/retail-zip.js' ) );

	const worker = outputs.get( 'browser-runtime/import.worker.js' ).toString();
	assert.doesNotMatch( worker, /loadPyodide|importScripts/, 'worker must not contain Pyodide or importScripts' );
	assert.match( worker, /RetailPipeline/, 'worker must use RetailPipeline' );
	assert.doesNotMatch( worker, /FS\.mount\(.*\/retail\/bin/, 'worker must not retain the old native WORKERFS mount over /retail/bin' );
} );

test( 'archive mount uses only main WORKERFS and preserves lazy Blob access', () => {
	const input = files();
	const plan = planRetailFiles( input );
	const FS = memoryFS();

	for ( const archive of plan.archives ) {
		archive.data.arrayBuffer = () => {
			throw new Error( 'No eager archive reads' );
		};
	}

	mountRetailArchives( FS, plan.archives );

	assert.equal( FS.mounts.length, 1 );
	assert.equal( FS.mounts[0].path, '/retail/main' );
	assert.equal( FS.mounts[0].options.blobs[0].data, input[1].file );
	assert.equal( FS.entries.size, 0, 'Archive bytes must not be copied into MEMFS' );
} );

test( 'bad archive mount metadata fails before extraction', () => {
	const FS = memoryFS();
	const original = FS.stat;

	FS.stat = ( path ) => ( { ...original( path ), size: 999 } );
	assert.throws(
		() => mountRetailArchives( FS, planRetailFiles( files() ).archives ),
		/Archive mount failed at \/retail\/main\/iw_00.iwd/
	);
} );
