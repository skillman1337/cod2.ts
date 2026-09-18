/*
===============================================================================

	retail-zip.test.mjs

	Call of Duty 2 / id Tech Archive Decoder Unit Tests
	Tests central directory enumeration, multi-archive precedence overlays,
	and single-inflation LRU caching across mocked ZIP and .IWD payloads.

===============================================================================
*/

import { crc32 } from '../decoders/retail-crc.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { RetailZipArchive, ArchiveCollection } from '../decoders/retail-zip.ts';


// ---------------------------------------------------------------------------
// zip archive creation mock helper
// ---------------------------------------------------------------------------

/*
====================
createMockZip

Constructs a valid in-memory ZIP / IWD buffer with Local File Headers (LFH),
Central Directory File Headers (CDH), and End of Central Directory (EOCD).
====================
*/
function createMockZip( files ) {
	const parts = [];
	const cdRecords = [];
	let offset = 0;

	for ( const [name, content] of Object.entries( files ) ) {
		const rawData = Buffer.isBuffer( content ) ? content : Buffer.from( content );
		const deflated = zlib.deflateRawSync( rawData );
		const nameBuf = Buffer.from( name, 'utf8' );

		// Local file header
		const lfh = Buffer.alloc( 30 );
		lfh.writeUInt32LE( 0x04034b50, 0 ); // signature
		lfh.writeUInt16LE( 20, 4 );         // version needed
		lfh.writeUInt16LE( 0, 6 );          // flags
		lfh.writeUInt16LE( 8, 8 );          // compression = deflate
		lfh.writeUInt16LE( 0, 10 );         // time
		lfh.writeUInt16LE( 0, 12 );         // date
		lfh.writeUInt32LE( crc32( rawData ), 14 );         // crc32
		lfh.writeUInt32LE( deflated.length, 18 ); // comp size
		lfh.writeUInt32LE( rawData.length, 22 );  // uncomp size
		lfh.writeUInt16LE( nameBuf.length, 26 );  // name len
		lfh.writeUInt16LE( 0, 28 );               // extra len

		const localRecord = Buffer.concat( [lfh, nameBuf, deflated] );
		parts.push( localRecord );

		// Central directory header
		const cdh = Buffer.alloc( 46 );
		cdh.writeUInt32LE( 0x02014b50, 0 );
		cdh.writeUInt16LE( 20, 4 );
		cdh.writeUInt16LE( 20, 6 );
		cdh.writeUInt16LE( 0, 8 );
		cdh.writeUInt16LE( 8, 10 );
		cdh.writeUInt16LE( 0, 12 );
		cdh.writeUInt16LE( 0, 14 );
		cdh.writeUInt32LE( crc32( rawData ), 16 );
		cdh.writeUInt32LE( deflated.length, 20 );
		cdh.writeUInt32LE( rawData.length, 24 );
		cdh.writeUInt16LE( nameBuf.length, 28 );
		cdh.writeUInt16LE( 0, 30 );
		cdh.writeUInt16LE( 0, 32 );
		cdh.writeUInt16LE( 0, 34 );
		cdh.writeUInt16LE( 0, 36 );
		cdh.writeUInt32LE( 0, 38 );
		cdh.writeUInt32LE( offset, 42 );

		cdRecords.push( Buffer.concat( [cdh, nameBuf] ) );
		offset += localRecord.length;
	}

	const cdBuf = Buffer.concat( cdRecords );
	const eocd = Buffer.alloc( 22 );
	eocd.writeUInt32LE( 0x06054b50, 0 );
	eocd.writeUInt16LE( 0, 4 );
	eocd.writeUInt16LE( 0, 6 );
	eocd.writeUInt16LE( Object.keys( files ).length, 8 );
	eocd.writeUInt16LE( Object.keys( files ).length, 10 );
	eocd.writeUInt32LE( cdBuf.length, 12 );
	eocd.writeUInt32LE( offset, 16 );
	eocd.writeUInt16LE( 0, 20 );

	return Buffer.concat( [...parts, cdBuf, eocd] );
}


// ---------------------------------------------------------------------------
// test suites
// ---------------------------------------------------------------------------

test( 'RetailZipArchive loads central directory and decompresses entries', async () => {
	const zipBuffer = createMockZip( {
		'test/hello.txt': 'Hello from Call of Duty 2 IWD!',
		'fonts/testFont': Buffer.from( [1, 2, 3, 4, 5, 6, 7, 8] ),
	} );

	const blob = new Blob( [zipBuffer] );
	const archive = new RetailZipArchive( blob );
	const entries = await archive.loadCentralDirectory();

	assert.equal( entries.size, 2 );
	assert.ok( archive.getEntry( 'test/hello.txt' ) );

	const text = await archive.readText( 'test/hello.txt' );
	assert.equal( text, 'Hello from Call of Duty 2 IWD!' );

	const fontBytes = await archive.read( 'fonts/testFont' );
	assert.deepEqual( Array.from( fontBytes ), [1, 2, 3, 4, 5, 6, 7, 8] );
} );

test( 'ArchiveCollection indexes across multiple archives', async () => {
	const zip1 = createMockZip( { 'a.txt': 'file a' } );
	const zip2 = createMockZip( { 'b.txt': 'file b' } );

	const collection = new ArchiveCollection();
	await collection.addArchive( new Blob( [zip1] ) );
	await collection.addArchive( new Blob( [zip2] ) );

	assert.ok( collection.has( 'a.txt' ) );
	assert.ok( collection.has( 'b.txt' ) );
	assert.equal( await collection.readText( 'a.txt' ), 'file a' );
	assert.equal( await collection.readText( 'b.txt' ), 'file b' );
} );

test( 'repeated and concurrent archive reads inflate each asset only once', async ( t ) => {
	const read = t.mock.method( RetailZipArchive.prototype, 'read' );
	const collection = new ArchiveCollection();

	await collection.addArchive( new Blob( [createMockZip( { one: 'first' } )] ) );
	const values = await Promise.all( [
		collection.read( 'one' ),
		collection.read( 'ONE' ),
		collection.read( 'one' ),
	] );

	assert.equal( read.mock.callCount(), 1 );
	assert.ok( values.every( ( value ) => new TextDecoder().decode( value ) === 'first' ) );

	await collection.read( 'one' );
	assert.equal( read.mock.callCount(), 1 );

	await collection.addArchive( new Blob( [createMockZip( { one: 'overridden' } )] ) );
	assert.equal( await collection.readText( 'one' ), 'overridden' );
	assert.equal( read.mock.callCount(), 2 );
} );
