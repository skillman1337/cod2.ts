/*
===============================================================================

	benchmark_loader.mjs

	Call of Duty 2 / id Tech PNG Encoding Synthetic Microbenchmark
	Measures streaming deflate throughput and scanline filtration speedup
	against naive baseline implementations.

===============================================================================
*/

import { performance } from 'node:perf_hooks';

import { encodePNG, crc32 } from '../../browser/decoders/retail-png.ts';

// ---------------------------------------------------------------------------
// benchmark helpers
// ---------------------------------------------------------------------------

/*
====================
median

Computes the median numerical value from a sample array.
====================
*/
const median = ( values ) => [...values].sort( ( a, b ) => a - b )[Math.floor( values.length / 2 )];

/*
====================
chunk

Builds a raw RFC 2083 PNG chunk container with 4-byte length and CRC32 footer.
====================
*/
function chunk( type, data ) {
	const result = new Uint8Array( data.length + 12 );
	const view = new DataView( result.buffer );

	view.setUint32( 0, data.length );
	result.set( new TextEncoder().encode( type ), 4 );
	result.set( data, 8 );
	view.setUint32( data.length + 8, crc32( result.subarray( 4, data.length + 8 ) ) );

	return result;
}

/*
====================
baseline

Constructs an unfiltered PNG stream using standard CompressionStream API.
====================
*/
async function baseline( width, height, rgba ) {
	const stride = width * 4;
	const rows = new Uint8Array( height * ( stride + 1 ) );

	for ( let y = 0; y < height; y++ ) {
		rows.set( rgba.subarray( y * stride, ( y + 1 ) * stride ), y * ( stride + 1 ) + 1 );
	}

	const compressor = new CompressionStream( 'deflate' );
	const writer = compressor.writable.getWriter();
	const read = new Response( compressor.readable ).arrayBuffer();

	await writer.write( rows );
	await writer.close();

	const header = new Uint8Array( 13 );
	const view = new DataView( header.buffer );
	view.setUint32( 0, width );
	view.setUint32( 4, height );
	header[8] = 8;
	header[9] = 6;

	const parts = [
		Uint8Array.of( 137, 80, 78, 71, 13, 10, 26, 10 ),
		chunk( 'IHDR', header ),
		chunk( 'IDAT', new Uint8Array( await read ) ),
		chunk( 'IEND', new Uint8Array( 0 ) ),
	];

	const out = new Uint8Array( parts.reduce( ( n, p ) => n + p.length, 0 ) );
	let at = 0;

	for ( const part of parts ) {
		out.set( part, at );
		at += part.length;
	}

	return out;
}

/*
====================
texture

Generates synthetic texture pixel buffers for benchmark runs.
====================
*/
function texture( kind, size ) {
	const rgba = new Uint8Array( size * size * 4 );
	let seed = 0x12345678;

	for ( let y = 0; y < size; y++ ) {
		for ( let x = 0; x < size; x++ ) {
			const i = ( y * size + x ) * 4;

			for ( let c = 0; c < 3; c++ ) {
				seed ^= seed << 13;
				seed ^= seed >>> 17;
				seed ^= seed << 5;

				rgba[i + c] = kind === 'gradient'
					? ( x + y + c * 40 ) & 255
					: kind === 'blocks'
						? ( ( x >> 3 ) * 17 + ( y >> 3 ) * 23 + c * 40 ) & 255
						: seed & 255;
			}

			rgba[i + 3] = 255;
		}
	}

	return rgba;
}

/*
====================
time

Measures wall-clock execution time and resulting byte count for a given async task.
====================
*/
async function time( fn ) {
	const start = performance.now();
	const value = await fn();
	return {
		ms: performance.now() - start,
		bytes: value.byteLength,
	};
}


// ---------------------------------------------------------------------------
// benchmark execution loop
// ---------------------------------------------------------------------------

const cases = [];

for ( const kind of ['gradient', 'blocks', 'noise'] ) {
	const size = 1024;
	const rgba = texture( kind, size );
	const before = [];
	const after = [];

	await baseline( size, size, rgba );
	await encodePNG( size, size, rgba );

	for ( let i = 0; i < 5; i++ ) {
		// Alternate order to reduce systematic first-run/temperature bias
		if ( i % 2 ) {
			after.push( await time( () => encodePNG( size, size, rgba ) ) );
			before.push( await time( () => baseline( size, size, rgba ) ) );
		} else {
			before.push( await time( () => baseline( size, size, rgba ) ) );
			after.push( await time( () => encodePNG( size, size, rgba ) ) );
		}
	}

	const oldMs = median( before.map( ( v ) => v.ms ) );
	const newMs = median( after.map( ( v ) => v.ms ) );

	cases.push( {
		kind,
		width: size,
		height: size,
		trials: 5,
		baselineMedianMs: +oldMs.toFixed( 2 ),
		candidateMedianMs: +newMs.toFixed( 2 ),
		speedup: +( oldMs / newMs ).toFixed( 2 ),
		baselineBytes: before[0].bytes,
		candidateBytes: after[0].bytes,
	} );
}

const result = {
	scope: 'Synthetic PNG encoding in Node; not an end-to-end game/browser benchmark.',
	node: process.version,
	baseline: 'Unfiltered RGBA + CompressionStream(deflate)',
	candidate: 'Shipped raw scanlines + Blob stream + CompressionStream(deflate)',
	cases,
};

if ( process.argv.includes( '--json' ) ) {
	console.log( JSON.stringify( result, null, 2 ) );
} else {
	console.log( result.scope );
	console.table( cases );
}
