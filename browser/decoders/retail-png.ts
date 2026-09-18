/*
===============================================================================

	retail-png.ts

	Call of Duty 2 / id Tech PNG Encoder
	Zero-dependency stream-based PNG encoder using Web Standard CompressionStream.
	Encodes raw 32-bit RGBA raster surfaces into standards-compliant PNG images.

===============================================================================
*/


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
export const PNG_IHDR_SIZE = 13;
export const PNG_BIT_DEPTH_8 = 8;
export const PNG_COLOR_TYPE_RGBA = 6;
export const PNG_COMPRESSION_DEFLATE = 0;
export const PNG_FILTER_NONE = 0;
export const PNG_INTERLACE_NONE = 0;
export const PNG_BYTES_PER_PIXEL = 4;
export const PNG_SCANLINE_FILTER_BYTES = 1;

export const PNG_CHUNK_HEADER_SIZE = 8;
export const PNG_CHUNK_CRC_SIZE = 4;

export const PNG_CHUNK_IHDR = 'IHDR';
export const PNG_CHUNK_IDAT = 'IDAT';
export const PNG_CHUNK_IEND = 'IEND';

export const CRC_TABLE_SIZE = 256;
export const CRC_POLYNOMIAL = 0xedb88320;
export const CRC_INITIAL = 0xffffffff;


// ---------------------------------------------------------------------------
// crc32 table & computation
// ---------------------------------------------------------------------------

/*
====================
makeCrcTable

Generates the standard IEEE 802.3 32-bit CRC lookup table.
====================
*/
function makeCrcTable(): Uint32Array {
	const table = new Uint32Array( CRC_TABLE_SIZE );

	for ( let i = 0; i < CRC_TABLE_SIZE; i++ ) {
		let c = i;

		for ( let j = 0; j < 8; j++ ) {
			c = c & 1 ? CRC_POLYNOMIAL ^ ( c >>> 1 ) : c >>> 1;
		}

		table[i] = c >>> 0;
	}

	return table;
}

const CRC_TABLE = makeCrcTable();

/*
====================
crc32

Calculates the 32-bit CRC checksum over the provided byte buffer.
====================
*/
export function crc32( buffer: Uint8Array ): number {
	let c = CRC_INITIAL;

	for ( let i = 0; i < buffer.length; i++ ) {
		c = CRC_TABLE[( c ^ buffer[i] ) & 0xff] ^ ( c >>> 8 );
	}

	return ( c ^ CRC_INITIAL ) >>> 0;
}


// ---------------------------------------------------------------------------
// chunk framing
// ---------------------------------------------------------------------------

/*
====================
makeChunk

Packages a PNG data chunk consisting of:
- 4 bytes big-endian length
- 4 bytes ASCII chunk type identifier
- N bytes chunk payload
- 4 bytes big-endian CRC32 over type + payload
====================
*/
function makeChunk( type: string, data: Uint8Array ): Uint8Array {
	const typeBytes = new TextEncoder().encode( type );
	const totalLength = 4 + 4 + data.length + 4;
	const out = new Uint8Array( totalLength );
	const view = new DataView( out.buffer, out.byteOffset, out.byteLength );

	view.setUint32( 0, data.length, false ); // Length
	out.set( typeBytes, 4 );                 // Type
	out.set( data, 8 );                      // Data

	const crcInput = new Uint8Array( out.buffer, out.byteOffset + 4, 4 + data.length );
	const crc = crc32( crcInput );
	view.setUint32( 8 + data.length, crc, false ); // CRC

	return out;
}


// ---------------------------------------------------------------------------
// png encoding
// ---------------------------------------------------------------------------

/*
====================
encodePNG

Encodes a raw RGBA byte buffer of dimensions (width x height) into a valid PNG binary:
1. Validates input dimensions and buffer sizing.
2. Formats uncompressed raw scanlines with leading 0 (Filter: None) byte.
3. Compresses scanlines via CompressionStream('deflate').
4. Assembles 8-byte PNG signature, IHDR chunk, IDAT chunk, and IEND chunk.
====================
*/
export async function encodePNG( width: number, height: number, rgba: Uint8Array ): Promise<Uint8Array> {
	const header = new Uint8Array( PNG_SIGNATURE );

	// IHDR
	const ihdr = new Uint8Array( PNG_IHDR_SIZE );
	const ihdrView = new DataView( ihdr.buffer );

	ihdrView.setUint32( 0, width, false );
	ihdrView.setUint32( 4, height, false );
	ihdr[8] = PNG_BIT_DEPTH_8;
	ihdr[9] = PNG_COLOR_TYPE_RGBA;
	ihdr[10] = PNG_COMPRESSION_DEFLATE;
	ihdr[11] = PNG_FILTER_NONE;
	ihdr[12] = PNG_INTERLACE_NONE;

	if (
		!Number.isSafeInteger( width ) ||
		!Number.isSafeInteger( height ) ||
		width <= 0 ||
		height <= 0 ||
		rgba.byteLength !== width * height * PNG_BYTES_PER_PIXEL
	) {
		throw new Error( 'Invalid PNG dimensions or RGBA buffer length.' );
	}

	// Keep raw scanlines. A sampled None/Sub/Up predictor was benchmarked but
	// rejected: its JS work increased encoding latency on all synthetic cases.
	// Startup improvements instead coalesce repeated conversions upstream.
	const stride = width * PNG_BYTES_PER_PIXEL;
	const scanlines = new Uint8Array( height * ( stride + PNG_SCANLINE_FILTER_BYTES ) );

	for ( let y = 0; y < height; y++ ) {
		scanlines.set( rgba.subarray( y * stride, ( y + 1 ) * stride ), y * ( stride + PNG_SCANLINE_FILTER_BYTES ) + PNG_SCANLINE_FILTER_BYTES );
	}

	// Stream consumption propagates compression errors; no unawaited writer work.
	const stream = new Blob( [scanlines] ).stream().pipeThrough( new CompressionStream( 'deflate' ) );
	const deflated = new Uint8Array( await new Response( stream ).arrayBuffer() );

	const ihdrChunk = makeChunk( PNG_CHUNK_IHDR, ihdr );
	const idatChunk = makeChunk( PNG_CHUNK_IDAT, deflated );
	const iendChunk = makeChunk( PNG_CHUNK_IEND, new Uint8Array( 0 ) );

	const total = header.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
	const png = new Uint8Array( total );
	let cursor = 0;

	png.set( header, cursor );
	cursor += header.length;

	png.set( ihdrChunk, cursor );
	cursor += ihdrChunk.length;

	png.set( idatChunk, cursor );
	cursor += idatChunk.length;

	png.set( iendChunk, cursor );

	return png;
}
