/*
===============================================================================

	loader.test.mjs

	Call of Duty 2 / id Tech Asset Loader & Pipeline Tests
	Validates asynchronous bounded mapping, directory handle pooling,
	cache manifest generation validation, synchronous OPFS access handles,
	byte cache eviction, and pipeline write telemetry.

===============================================================================
*/

import test from 'node:test';
import assert from 'node:assert/strict';

import { mapLimit } from '../async.mjs';
import {
	createFileReader,
	validateGeneration,
	REQUIRED_FILES,
	CACHE_VERSION,
	CACHE_FOLDER,
	assetResponse,
} from '../storage.mjs';
import { createImportWriter } from '../opfs-writer.mjs';
import { ByteCache } from '../decoders/retail-cache.ts';
import { RetailContext } from '../decoders/retail-context.ts';
import { formatBytes } from '../setup-view.mjs';

const wait = ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );


// ---------------------------------------------------------------------------
// asynchronous scheduling & bounded mapping tests
// ---------------------------------------------------------------------------

test( 'bounded reads preserve order and never exceed their concurrency limit', async () => {
	let active = 0;
	let peak = 0;

	const result = await mapLimit( [8, 4, 2, 1, 3, 6, 9], 3, async ( n ) => {
		active++;
		peak = Math.max( peak, active );
		await wait( n );
		active--;
		return n * 2;
	} );

	assert.deepEqual( result, [16, 8, 4, 2, 6, 12, 18] );
	assert.equal( peak, 3 );
} );

test( 'bounded reads reject invalid limits and stop scheduling after a failure', async () => {
	await assert.rejects( mapLimit( [1], 0, ( x ) => x ), RangeError );

	let visits = 0;
	await assert.rejects(
		mapLimit( [1, 2, 3, 4], 1, async () => {
			visits++;
			throw new Error( 'bad read' );
		} ),
		/bad read/
	);

	assert.equal( visits, 1 );
	assert.deepEqual( await mapLimit( [], 4, ( x ) => x ), [] );
} );


// ---------------------------------------------------------------------------
// memory filesystem mock helpers
// ---------------------------------------------------------------------------

/*
====================
memoryTree

Creates an in-memory directory tree mimicking the File System Access API
and tracks directory, handle, and read metrics.
====================
*/
function memoryTree( entries ) {
	const metrics = { directories: 0, handles: 0, reads: 0 };
	const files = new Map(
		Object.entries( entries ).map( ( [p, text] ) => [p, new File( [text], p.split( '/' ).pop() )] )
	);

	function dir( prefix = '' ) {
		return {
			async getDirectoryHandle( name ) {
				metrics.directories++;
				return dir( prefix + name + '/' );
			},
			async getFileHandle( name ) {
				metrics.handles++;
				const key = prefix + name;

				if ( !files.has( key ) ) {
					throw new DOMException( 'missing', 'NotFoundError' );
				}

				return {
					async getFile() {
						metrics.reads++;
						if ( !files.has( key ) ) {
							throw new DOMException( 'missing', 'NotFoundError' );
						}
						return files.get( key );
					},
				};
			},
		};
	}

	return { root: dir(), metrics, files };
}

test( 'file-reader coalesces directory and handle opens, but re-reads file snapshots', async () => {
	const tree = memoryTree( { 'a/b/one': '1', 'a/b/two': '2' } );
	const read = createFileReader( tree.root );

	await Promise.all( [read( 'a/b/one' ), read( 'a/b/one' ), read( 'a/b/two' )] );

	assert.equal( tree.metrics.directories, 2 );
	assert.equal( tree.metrics.handles, 2 );
	assert.equal( tree.metrics.reads, 3 );

	tree.files.delete( 'a/b/one' );
	await assert.rejects( read( 'a/b/one' ), { name: 'NotFoundError' } );

	tree.files.set( 'a/b/one', new File( ['new'], 'one' ) );
	assert.equal( await ( await read( 'a/b/one' ) ).text(), 'new' );

	await assert.rejects( read( '../escape' ) );
} );


// ---------------------------------------------------------------------------
// generation manifest & validation tests
// ---------------------------------------------------------------------------

const id = '12345678-1234-1234-1234-123456789abc';

/*
====================
generationFixture

Builds a mock directory containing all required cache generation files
and a complete.json manifest.
====================
*/
function generationFixture() {
	const prefix = `${CACHE_FOLDER}/${id}/`;
	const contents = Object.fromEntries( REQUIRED_FILES.map( ( path ) => [prefix + path, '{}'] ) );
	const manifest = {
		version: CACHE_VERSION,
		id,
		files: REQUIRED_FILES.map( ( path ) => ( { path, size: 2 } ) ),
	};

	contents[prefix + 'complete.json'] = JSON.stringify( manifest );
	return { ...memoryTree( contents ), prefix, manifest };
}

/*
====================
installStorage

Mocks navigator.storage.getDirectory for testing OPFS generation validation.
====================
*/
function installStorage( t, tree ) {
	t.mock.method( navigator, 'toString', navigator.toString ); // Preserve real Node navigator
	const previous = Object.getOwnPropertyDescriptor( navigator, 'storage' );

	Object.defineProperty( navigator, 'storage', {
		configurable: true,
		value: { getDirectory: async () => tree.root },
	} );

	t.after( () => {
		if ( previous ) {
			Object.defineProperty( navigator, 'storage', previous );
		} else {
			delete navigator.storage;
		}
	} );
}

test( 'full validation checks every required asset and returns reusable File snapshots', async ( t ) => {
	const tree = generationFixture();
	installStorage( t, tree );

	let count = 0;
	const result = await validateGeneration( id, { onProgress: () => count++ } );

	assert.equal( result.verified.size, REQUIRED_FILES.length );
	assert.equal( count, REQUIRED_FILES.length );
	assert.equal( tree.metrics.reads, REQUIRED_FILES.length + 1 );
} );

test( 'service-worker binding checks only the commit marker; served files retain size checks', async ( t ) => {
	const tree = generationFixture();
	installStorage( t, tree );

	const result = await validateGeneration( id, { full: false } );
	assert.equal( tree.metrics.reads, 1 );
	assert.equal( result.verified.size, 0 );

	const path = REQUIRED_FILES[0];
	tree.files.set( tree.prefix + path, new File( ['broken'], 'bad' ) );

	await assert.rejects(
		assetResponse(
			new Request( 'https://local.test/' + path ),
			result.root,
			path,
			{ read: result.read, expectedSize: 2 }
		),
		/Incomplete cached asset/
	);
} );

test( 'corrupt, missing and duplicate manifest entries are rejected without changing cache version', async ( t ) => {
	const tree = generationFixture();
	installStorage( t, tree );

	assert.equal( CACHE_VERSION, 5, 'UI changes must not force existing users to re-import' );

	tree.files.delete( tree.prefix + REQUIRED_FILES[0] );
	await assert.rejects( validateGeneration( id ), { name: 'NotFoundError' } );

	tree.manifest.files.push( tree.manifest.files[0] );
	tree.files.set( tree.prefix + 'complete.json', new File( [JSON.stringify( tree.manifest )], 'complete.json' ) );
	await assert.rejects( validateGeneration( id, { full: false } ), /Invalid local cache manifest/ );
} );


// ---------------------------------------------------------------------------
// synchronous & streaming opfs writer tests
// ---------------------------------------------------------------------------

test( 'sync import writer handles partial writes, truncates, and closes without per-file flush', async () => {
	const calls = [];
	const result = [];
	let opens = 0;

	const handle = {
		createSyncAccessHandle: async () => ( {
			write( bytes, { at } ) {
				calls.push( ['write', at] );
				const n = Math.min( bytes.length, 2 );
				result.push( ...bytes.slice( 0, n ) );
				return n;
			},
			truncate( n ) {
				calls.push( ['truncate', n] );
			},
			close() {
				calls.push( ['close'] );
			},
		} ),
	};

	const root = {
		async getDirectoryHandle() {
			opens++;
			return root;
		},
		async getFileHandle() {
			return handle;
		},
	};

	const write = createImportWriter( root );
	await write( 'a/b/one', new Uint8Array( [1, 2, 3, 4, 5] ) );
	await write( 'a/b/two', new Uint8Array( [6] ) );

	assert.equal( opens, 2 );
	assert.deepEqual( result, [1, 2, 3, 4, 5, 6] );
	assert.deepEqual(
		calls.slice( 0, 5 ),
		[['write', 0], ['write', 2], ['write', 4], ['truncate', 5], ['close']]
	);
} );

test( 'sync write failures close access handles and preserve quota errors', async () => {
	let closed = false;
	const error = new DOMException( 'full', 'QuotaExceededError' );
	const root = {
		getFileHandle: async () => ( {
			createSyncAccessHandle: async () => ( {
				write() {
					throw error;
				},
				close() {
					closed = true;
				},
			} ),
		} ),
	};

	await assert.rejects( createImportWriter( root )( 'x', new Uint8Array( [1] ) ), { name: 'QuotaExceededError' } );
	assert.ok( closed );
} );

test( 'async writer fallback aborts failed streams and rejects unsafe paths', async () => {
	let aborted = false;
	const root = {
		getFileHandle: async () => ( {
			createWritable: async () => ( {
				async write() {
					throw new Error( 'disk' );
				},
				async abort() {
					aborted = true;
				},
			} ),
		} ),
	};

	const write = createImportWriter( root );
	await assert.rejects( write( 'x', new Uint8Array( [1] ) ), /disk/ );
	assert.ok( aborted );

	await assert.rejects( write( '../x', new Uint8Array( [1] ) ), /Unsafe/ );
} );


// ---------------------------------------------------------------------------
// lru byte cache & pipeline telemetry tests
// ---------------------------------------------------------------------------

test( 'byte-cache is bounded and evicts least recently used buffers', () => {
	const cache = new ByteCache( 4 );
	cache.set( 'a', new Uint8Array( 2 ) );
	cache.set( 'b', new Uint8Array( 2 ) );

	cache.get( 'a' );
	cache.set( 'c', new Uint8Array( 2 ) );

	assert.ok( cache.get( 'a' ) );
	assert.equal( cache.get( 'b' ), undefined );
	assert.equal( cache.bytes, 4 );

	cache.set( 'a', new Uint8Array( 10 ) );
	assert.equal( cache.get( 'a' ), undefined );
	assert.equal( cache.bytes, 2 );

	cache.clear();
	assert.equal( cache.bytes, 0 );
} );

test( 'pipeline writes compact JSON and reports actual completed bytes and file counts', async () => {
	const written = [];
	const tasks = [];
	const pipeline = new RetailContext(
		{},
		async ( path, bytes ) => written.push( [path, bytes] ),
		undefined,
		undefined,
		( info ) => tasks.push( info )
	);

	await pipeline.saveJson( 'test.json', { label: 'CoD2', rows: [1, 2, 3] } );

	const text = new TextDecoder().decode( written[0][1] );
	assert.equal( text, '{"label":"CoD2","rows":[1,2,3]}' );
	assert.equal( tasks.at( -1 ).files, 1 );
	assert.equal( tasks.at( -1 ).bytes, written[0][1].byteLength );
} );

test( 'optional decoder catches cannot turn a failed disk write into a successful import', async () => {
	const pipeline = new RetailContext( {}, async () => {
		throw new DOMException( 'full', 'QuotaExceededError' );
	} );

	try { await pipeline.saveJson( 'font.json', {} ); } catch {}
	assert.throws( () => pipeline.finish(), { name: 'QuotaExceededError' } );
	await assert.rejects( pipeline.saveJson( 'another.json', {} ), { name: 'QuotaExceededError' } );
} );

test( 'loading byte labels use real quantities and handle invalid values', () => {
	assert.equal( formatBytes( 0 ), '0 B' );
	assert.equal( formatBytes( 1024 ), '1.0 KB' );
	assert.equal( formatBytes( 3 * 1024 ** 2 ), '3.0 MB' );
	assert.equal( formatBytes( NaN ), '0 B' );
} );
