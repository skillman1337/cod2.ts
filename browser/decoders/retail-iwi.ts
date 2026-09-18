/*
===============================================================================

	retail-iwi.ts

	Call of Duty 2 / id Tech Texture Decoder
	Wavelet adaptation: OpenAssetTools, Laupetin and contributors (GPL-3.0).
	See THIRD_PARTY_NOTICES.md; retain upstream licensing notices.
	Decodes .iwi images: DXT1, DXT3, DXT5, RGBA, RGB, Alpha mipmaps,
	cubemap skybox faces, and Huffman-coded multi-level wavelet bitstreams.

===============================================================================
*/


// ---------------------------------------------------------------------------
// constants & format enumerations
// ---------------------------------------------------------------------------

export const IWI_FORMAT_RGBA = 1;
export const IWI_FORMAT_RGB = 2;
export const IWI_FORMAT_ALPHA = 4;
export const IWI_FORMAT_WAVELET_RGBA = 6;
export const IWI_FORMAT_WAVELET_RGB = 7;
export const IWI_FORMAT_DXT1 = 11;
export const IWI_FORMAT_DXT3 = 12;
export const IWI_FORMAT_DXT5 = 13;

export const IWI_MAGIC_0     = 0x49; // 'I'
export const IWI_MAGIC_1     = 0x57; // 'W'
export const IWI_MAGIC_2     = 0x69; // 'i'
export const IWI_HEADER_SIZE = 28;
export const IWI_FORMAT_OFFSET = 4;
export const IWI_WIDTH_OFFSET = 6;
export const IWI_HEIGHT_OFFSET = 8;
export const IWI_MIP_TABLE_OFFSET = 12;
export const IWI_MAX_PIXELS  = 16777216; // 4096 * 4096 max texture resolution

export const DXT1_BLOCK_BYTES = 8;
export const DXT_DEFAULT_BLOCK_BYTES = 16;
export const DXT_BLOCK_SIZE = 4;
export const DXT_BLOCK_MASK = 3;

export const RGB565_RED_SHIFT = 11;
export const RGB565_RED_MASK = 0x1f;
export const RGB565_RED_MAX = 31;

export const RGB565_GREEN_SHIFT = 5;
export const RGB565_GREEN_MASK = 0x3f;
export const RGB565_GREEN_MAX = 63;

export const RGB565_BLUE_MASK = 0x1f;
export const RGB565_BLUE_MAX = 31;

export const COLOR_CHANNEL_MAX = 255;


// ---------------------------------------------------------------------------
// rgb565 & dxt alpha helpers
// ---------------------------------------------------------------------------

/*
====================
unpackRgb565

Expands a 16-bit packed RGB565 integer into 8-bit [R, G, B] channels.
====================
*/
function unpackRgb565( val: number ): [number, number, number] {
	const r = Math.floor( ( ( ( val >> RGB565_RED_SHIFT ) & RGB565_RED_MASK ) * COLOR_CHANNEL_MAX ) / RGB565_RED_MAX );
	const g = Math.floor( ( ( ( val >> RGB565_GREEN_SHIFT ) & RGB565_GREEN_MASK ) * COLOR_CHANNEL_MAX ) / RGB565_GREEN_MAX );
	const b = Math.floor( ( ( val & RGB565_BLUE_MASK ) * COLOR_CHANNEL_MAX ) / RGB565_BLUE_MAX );

	return [r, g, b];
}

/*
====================
dxtColorTable

Constructs the 4-entry RGB color palette for a standard DXT block from two 16-bit endpoints.
Supports transparent black punch-through when c0 <= c1 in DXT1 blocks.
====================
*/
function dxtColorTable( c0: number, c1: number, transparentPunchthrough: boolean = false ): [number, number, number][] {
	const rgb0 = unpackRgb565( c0 );
	const rgb1 = unpackRgb565( c1 );

	if ( transparentPunchthrough && c0 <= c1 ) {
		return [
			rgb0,
			rgb1,
			[
				Math.floor( ( rgb0[0] + rgb1[0] ) / 2 ),
				Math.floor( ( rgb0[1] + rgb1[1] ) / 2 ),
				Math.floor( ( rgb0[2] + rgb1[2] ) / 2 ),
			],
			[0, 0, 0],
		];
	}

	return [
		rgb0,
		rgb1,
		[
			Math.floor( ( 2 * rgb0[0] + rgb1[0] ) / 3 ),
			Math.floor( ( 2 * rgb0[1] + rgb1[1] ) / 3 ),
			Math.floor( ( 2 * rgb0[2] + rgb1[2] ) / 3 ),
		],
		[
			Math.floor( ( rgb0[0] + 2 * rgb1[0] ) / 3 ),
			Math.floor( ( rgb0[1] + 2 * rgb1[1] ) / 3 ),
			Math.floor( ( rgb0[2] + 2 * rgb1[2] ) / 3 ),
		],
	];
}

/*
====================
dxt5AlphaValue

Interpolates 8-bit alpha from 2 reference endpoints using the 3-bit DXT5 code.
====================
*/
function dxt5AlphaValue( a0: number, a1: number, code: number ): number {
	if ( code === 0 ) {
		return a0;
	}
	if ( code === 1 ) {
		return a1;
	}

	if ( a0 > a1 ) {
		return Math.floor( ( ( 8 - code ) * a0 + ( code - 1 ) * a1 ) / 7 );
	}

	if ( code === 6 ) {
		return 0;
	}
	if ( code === 7 ) {
		return 255;
	}

	return Math.floor( ( ( 6 - code ) * a0 + ( code - 1 ) * a1 ) / 5 );
}

/*
====================
iwiMipMaps

Computes mipmap offset and byte length pairs from the IWI header table.
====================
*/
function iwiMipMaps( offsets: number[], first: number, fileSize: number ): [number, number][] {
	const mipmaps: [number, number][] = [];

	for ( let i = 0; i < offsets.length; i++ ) {
		const off = offsets[i];

		if ( i === 0 ) {
			mipmaps.push( [off, fileSize - off] );
		} else if ( i === offsets.length - 1 ) {
			mipmaps.push( [first, off - first] );
		} else {
			mipmaps.push( [off, offsets[i - 1] - off] );
		}
	}

	return mipmaps;
}


// ---------------------------------------------------------------------------
// iwi header & mipmap selection
// ---------------------------------------------------------------------------

/*
====================
readIwiMip0

Validates 'IWi' magic signature and extracts format, dimensions,
and the highest-resolution texture payload slice.
====================
*/
export function readIwiMip0( data: Uint8Array ): {
	format: number;
	width: number;
	height: number;
	texData: Uint8Array;
} {
	if (
		data.length < IWI_HEADER_SIZE ||
		data[0] !== IWI_MAGIC_0 ||
		data[1] !== IWI_MAGIC_1 ||
		data[2] !== IWI_MAGIC_2
	) {
		throw new Error( 'Not a valid IWI file' );
	}

	const view = new DataView( data.buffer, data.byteOffset, data.byteLength );
	const format = view.getUint8( IWI_FORMAT_OFFSET );
	const width = view.getUint16( IWI_WIDTH_OFFSET, true );
	const height = view.getUint16( IWI_HEIGHT_OFFSET, true );

	if ( !width || !height || width * height > IWI_MAX_PIXELS ) {
		throw new Error( 'Invalid or excessive IWI dimensions' );
	}

	const offsets = [
		view.getInt32( IWI_MIP_TABLE_OFFSET, true ),
		view.getInt32( IWI_MIP_TABLE_OFFSET + 4, true ),
		view.getInt32( IWI_MIP_TABLE_OFFSET + 8, true ),
		view.getInt32( IWI_MIP_TABLE_OFFSET + 12, true ),
	];

	const first = IWI_HEADER_SIZE;
	const mips = iwiMipMaps( offsets, first, data.byteLength );
	let best = mips[0];

	for ( const m of mips ) {
		if ( m[1] > best[1] ) {
			best = m;
		}
	}

	const [texOff, texSize] = best;
	const texData = data.subarray( texOff, texOff + texSize );

	return { format, width, height, texData };
}


// ---------------------------------------------------------------------------
// block compression decoders: dxt1, dxt3, dxt5
// ---------------------------------------------------------------------------

/*
====================
dxtBlockDimensions

Computes the 4x4 block column and row counts for a given texture width and height.
====================
*/
function dxtBlockDimensions( width: number, height: number ): [number, number] {
	return [
		Math.max( 1, Math.floor( ( width + DXT_BLOCK_MASK ) / DXT_BLOCK_SIZE ) ),
		Math.max( 1, Math.floor( ( height + DXT_BLOCK_MASK ) / DXT_BLOCK_SIZE ) ),
	];
}

/*
====================
writeDxtBlockRgba

Blits a 4x4 decoded DXT color and alpha block into the target RGBA image buffer,
clipping against image dimensions.
====================
*/
function writeDxtBlockRgba(
	rgba: Uint8Array,
	width: number,
	height: number,
	bx: number,
	by: number,
	colors: [number, number, number][],
	colorBits: number,
	getAlpha: ( idx: number, row: number, col: number ) => number
): void {
	for ( let row = 0; row < 4; row++ ) {
		const y = by * 4 + row;
		if ( y >= height ) {
			continue;
		}

		for ( let col = 0; col < 4; col++ ) {
			const x = bx * 4 + col;
			if ( x >= width ) {
				continue;
			}

			const idx = row * 4 + col;
			const code = ( colorBits >> ( idx * 2 ) ) & 0x3;
			const color = colors[code];
			const alpha = getAlpha( idx, row, col );
			const pxOffset = ( y * width + x ) * 4;

			rgba[pxOffset] = color[0];
			rgba[pxOffset + 1] = color[1];
			rgba[pxOffset + 2] = color[2];
			rgba[pxOffset + 3] = alpha;
		}
	}
}

/*
====================
decodeDxt1

Decompresses DXT1 (BC1) 4x4 blocks into 32-bit RGBA pixels.
Supports 1-bit transparent punch-through when c0 <= c1.
====================
*/
export function decodeDxt1( data: Uint8Array, width: number, height: number ): Uint8Array {
	const rgba = new Uint8Array( width * height * 4 );
	const [blocksX, blocksY] = dxtBlockDimensions( width, height );
	const view = new DataView( data.buffer, data.byteOffset, data.byteLength );

	let offset = 0;

	for ( let by = 0; by < blocksY; by++ ) {
		for ( let bx = 0; bx < blocksX; bx++ ) {
			const c0 = view.getUint16( offset, true );
			const c1 = view.getUint16( offset + 2, true );
			const colorBits = view.getUint32( offset + 4, true );
			offset += 8;

			const colors = dxtColorTable( c0, c1, true );

			writeDxtBlockRgba( rgba, width, height, bx, by, colors, colorBits, ( idx ) => {
				const code = ( colorBits >> ( idx * 2 ) ) & 0x3;
				return ( c0 <= c1 && code === 3 ) ? 0 : 255;
			} );
		}
	}

	return rgba;
}

/*
====================
decodeDxt3

Decompresses DXT3 (BC2) 4x4 blocks into 32-bit RGBA pixels,
extracting 4-bit explicit alpha per pixel.
====================
*/
export function decodeDxt3( data: Uint8Array, width: number, height: number ): Uint8Array {
	const rgba = new Uint8Array( width * height * 4 );
	const [blocksX, blocksY] = dxtBlockDimensions( width, height );
	const view = new DataView( data.buffer, data.byteOffset, data.byteLength );

	let offset = 0;

	for ( let by = 0; by < blocksY; by++ ) {
		for ( let bx = 0; bx < blocksX; bx++ ) {
			const alphaBlockOffset = offset;
			const c0 = view.getUint16( offset + 8, true );
			const c1 = view.getUint16( offset + 10, true );
			const colorBits = view.getUint32( offset + 12, true );
			offset += 16;

			const colors = dxtColorTable( c0, c1 );

			writeDxtBlockRgba( rgba, width, height, bx, by, colors, colorBits, ( _idx, row, col ) => {
				const rowWord = view.getUint16( alphaBlockOffset + row * 2, true );
				const a4 = ( rowWord >> ( col * 4 ) ) & 0xf;
				return a4 | ( a4 << 4 );
			} );
		}
	}

	return rgba;
}

/*
====================
decodeDxt

Dispatches DXT1, DXT3, or DXT5 block decompression for a texture buffer.
====================
*/
export function decodeDxt(
	format: number,
	data: Uint8Array,
	width: number,
	height: number
): Uint8Array {
	switch ( format ) {
		case IWI_FORMAT_DXT1:
			return decodeDxt1( data, width, height );
		case IWI_FORMAT_DXT3:
			return decodeDxt3( data, width, height );
		case IWI_FORMAT_DXT5:
			return decodeDxt5( data, width, height );
		default:
			throw new Error( `Unsupported DXT compression format 0x${format.toString( 16 )}` );
	}
}

/*
====================
decodeDxt5

Decompresses DXT5 (BC3) 4x4 blocks into 32-bit RGBA pixels,
interpolating 8-bit alpha from 3-bit indices.
====================
*/
export function decodeDxt5( data: Uint8Array, width: number, height: number ): Uint8Array {
	const rgba = new Uint8Array( width * height * 4 );
	const [blocksX, blocksY] = dxtBlockDimensions( width, height );
	const view = new DataView( data.buffer, data.byteOffset, data.byteLength );

	let offset = 0;

	for ( let by = 0; by < blocksY; by++ ) {
		for ( let bx = 0; bx < blocksX; bx++ ) {
			const a0 = data[offset];
			const a1 = data[offset + 1];
			const aLow = view.getUint32( offset + 2, true );
			const aHigh = view.getUint16( offset + 6, true );

			const c0 = view.getUint16( offset + 8, true );
			const c1 = view.getUint16( offset + 10, true );
			const colorBits = view.getUint32( offset + 12, true );
			offset += 16;

			const colors = dxtColorTable( c0, c1 );

			writeDxtBlockRgba( rgba, width, height, bx, by, colors, colorBits, ( idx ) => {
				const bitOffset = idx * 3;
				let alphaCode: number;

				if ( bitOffset < 32 ) {
					alphaCode = ( aLow >> bitOffset ) & 0x7;

					if ( bitOffset === 30 ) {
						// spans across aLow and aHigh
						alphaCode = ( ( aLow >> 30 ) & 0x3 ) | ( ( aHigh & 0x1 ) << 2 );
					}
				} else {
					alphaCode = ( aHigh >> ( bitOffset - 32 ) ) & 0x7;
				}

				return dxt5AlphaValue( a0, a1, alphaCode );
			} );
		}
	}

	return rgba;
}


// ---------------------------------------------------------------------------
// huffman tables & wavelet bit reader
// ---------------------------------------------------------------------------

const HUFFMAN_LOOKUP_BITS = 12;
const HUFFMAN_LOOKUP_SIZE = 1 << HUFFMAN_LOOKUP_BITS;
const ESCAPE_VALUE = -32768;

const BLUE_CODEWORDS: [number, number, number][] = [
	[0x001, 3, 0], [0x004, 5, 4], [0x005, 5, 2], [0x007, 5, 1], [0x00A, 5, 3], [0x014, 5, -4],
	[0x015, 5, -2], [0x017, 5, -1], [0x01A, 5, -3], [0x000, 6, 12], [0x002, 6, 10], [0x003, 6, 7],
	[0x006, 6, 9], [0x00B, 6, 6], [0x018, 6, 11], [0x01E, 6, 8], [0x01F, 6, 5], [0x020, 6, -12],
	[0x022, 6, -10], [0x023, 6, -7], [0x026, 6, -9], [0x02B, 6, -6], [0x038, 6, -11], [0x03C, 6, ESCAPE_VALUE],
	[0x03E, 6, -8], [0x03F, 6, -5], [0x00F, 7, 13], [0x012, 7, 19], [0x016, 7, 18], [0x01B, 7, 14],
	[0x027, 7, 17], [0x02F, 7, 15], [0x030, 7, -18], [0x032, 7, 16], [0x039, 7, -19], [0x047, 7, -14],
	[0x04F, 7, -13], [0x067, 7, -17], [0x06F, 7, -15], [0x072, 7, -16], [0x010, 8, 25], [0x013, 8, 24],
	[0x021, 8, 26], [0x024, 8, 23], [0x025, 8, 22], [0x029, 8, 21], [0x02A, 8, 27], [0x031, 8, 28],
	[0x033, 8, 20], [0x03B, 8, -25], [0x049, 8, -26], [0x050, 8, -24], [0x052, 8, -27], [0x061, 8, -23],
	[0x064, 8, -28], [0x069, 8, -21], [0x070, 8, -20], [0x073, 8, -22], [0x009, 9, 31], [0x011, 9, 30],
	[0x048, 9, 33], [0x051, 9, 32], [0x053, 9, 29], [0x071, 9, 34], [0x089, 9, -30], [0x091, 9, -31],
	[0x0C8, 9, -33], [0x0D1, 9, -32], [0x0D3, 9, -29], [0x0F1, 9, -34], [0x065, 10, 36], [0x0A5, 10, 37],
	[0x0E5, 10, 35], [0x165, 10, -36], [0x1A5, 10, -37], [0x1E5, 10, -35], [0x188, 11, 40], [0x1C9, 11, 41],
	[0x248, 11, 39], [0x2C9, 11, 38], [0x388, 11, -40], [0x3C9, 11, -41], [0x448, 11, -39], [0x4C9, 11, -38],
	[0x309, 12, 42], [0x509, 12, 43], [0x709, 12, -42], [0x909, 12, -43],
];

const RED_GREEN_CODEWORDS: [number, number, number][] = [
	[0x000, 2, 0], [0x007, 4, 1], [0x00B, 4, -1], [0x005, 5, 2], [0x019, 5, -2], [0x002, 6, 3],
	[0x003, 6, 4], [0x012, 6, ESCAPE_VALUE], [0x022, 6, -3], [0x023, 6, -4], [0x006, 7, 7],
	[0x016, 7, 6], [0x01E, 7, 5], [0x026, 7, -7], [0x036, 7, -6], [0x03E, 7, -5], [0x00F, 8, 10],
	[0x02F, 8, 8], [0x04F, 8, 9], [0x08F, 8, -10], [0x0AF, 8, -8], [0x0CF, 8, -9], [0x06F, 9, 12],
	[0x0EF, 9, 11], [0x16F, 9, -12], [0x1EF, 9, -11], [0x01F, 10, 13], [0x11F, 10, 14], [0x21F, 10, -13],
	[0x31F, 10, -14],
];

const ALPHA_CODEWORDS: [number, number, number][] = [
	[0x001, 1, 0], [0x000, 3, 1], [0x004, 4, -1], [0x006, 4, 2], [0x016, 5, -2], [0x002, 6, 3],
	[0x032, 6, -3], [0x012, 7, 4], [0x052, 7, -4], [0x02A, 8, 5], [0x06A, 8, -5], [0x0AA, 8, 6],
	[0x0EA, 8, -6], [0x00A, 9, 8], [0x04A, 9, 7], [0x08A, 9, -8], [0x0CA, 9, -7], [0x10A, 9, 9],
	[0x14A, 9, 10], [0x18A, 9, -9], [0x1CA, 9, -10], [0x03A, 10, 12], [0x07A, 10, 11], [0x0BA, 10, -12],
	[0x0FA, 10, -11], [0x13A, 10, 13], [0x17A, 10, 14], [0x1BA, 10, -13], [0x1FA, 10, -14], [0x23A, 10, 15],
	[0x27A, 10, 16], [0x2BA, 10, -15], [0x2FA, 10, -16], [0x33A, 10, 17], [0x37A, 10, 18], [0x3BA, 10, -17],
	[0x3FA, 10, -18], [0x01A, 11, 20], [0x09A, 11, 21], [0x11A, 11, 19], [0x19A, 11, 22], [0x21A, 11, -20],
	[0x29A, 11, -21], [0x31A, 11, -19], [0x39A, 11, -22], [0x05A, 12, 23], [0x0DA, 12, 24], [0x15A, 12, -23],
	[0x1DA, 12, -24], [0x25A, 12, 25], [0x2DA, 12, 26], [0x35A, 12, -25], [0x3DA, 12, -26], [0x45A, 12, 27],
	[0x4DA, 12, 28], [0x55A, 12, -27], [0x5DA, 12, -28], [0x65A, 12, 29], [0x6DA, 12, 30], [0x75A, 12, -29],
	[0x7DA, 12, -30], [0x85A, 12, 31], [0x8DA, 12, 32], [0x95A, 12, -31], [0x9DA, 12, -32], [0xA5A, 12, 33],
	[0xADA, 12, ESCAPE_VALUE], [0xB5A, 12, -33],
];

/*
====================
createHuffmanLookup

Builds a direct 12-bit indexed LUT mapping bit prefixes to values and lengths.
====================
*/
function createHuffmanLookup( codewords: [number, number, number][] ): {
	values: Int16Array;
	bitCounts: Uint8Array;
} {
	const values = new Int16Array( HUFFMAN_LOOKUP_SIZE );
	const bitCounts = new Uint8Array( HUFFMAN_LOOKUP_SIZE );

	for ( const [code, bitCount, val] of codewords ) {
		const step = 1 << bitCount;

		for ( let idx = code; idx < HUFFMAN_LOOKUP_SIZE; idx += step ) {
			values[idx] = val;
			bitCounts[idx] = bitCount;
		}
	}

	return { values, bitCounts };
}

let blueLookupCache: { values: Int16Array; bitCounts: Uint8Array } | null = null;
let redGreenLookupCache: { values: Int16Array; bitCounts: Uint8Array } | null = null;
let alphaLookupCache: { values: Int16Array; bitCounts: Uint8Array } | null = null;

/*
====================
getBlueLookup

Returns the cached 12-bit Huffman lookup table for the blue channel.
====================
*/
function getBlueLookup(): { values: Int16Array; bitCounts: Uint8Array } {
	if ( !blueLookupCache ) {
		blueLookupCache = createHuffmanLookup( BLUE_CODEWORDS );
	}

	return blueLookupCache;
}

/*
====================
getRedGreenLookup

Returns the cached 12-bit Huffman lookup table for red and green channels.
====================
*/
function getRedGreenLookup(): { values: Int16Array; bitCounts: Uint8Array } {
	if ( !redGreenLookupCache ) {
		redGreenLookupCache = createHuffmanLookup( RED_GREEN_CODEWORDS );
	}

	return redGreenLookupCache;
}

/*
====================
getAlphaLookup

Returns the cached 12-bit Huffman lookup table for the alpha channel.
====================
*/
function getAlphaLookup(): { values: Int16Array; bitCounts: Uint8Array } {
	if ( !alphaLookupCache ) {
		alphaLookupCache = createHuffmanLookup( ALPHA_CODEWORDS );
	}

	return alphaLookupCache;
}

/*
====================
WaveletBitReader

Reads arbitrary-length bit fields and unaligned bytes from a binary stream.
====================
*/
class WaveletBitReader {
	private data: Uint8Array;
	private byteOffset = 0;
	private bitOffset = 0;
	private bitsStarted = false;

	constructor( data: Uint8Array ) {
		this.data = data;
	}

	/*
	====================
	readRawByte

	Reads an uncompressed byte before bitstream decoding commences.
	====================
	*/
	readRawByte(): number | null {
		if ( this.bitsStarted || this.byteOffset >= this.data.length ) {
			return null;
		}

		return this.data[this.byteOffset++];
	}

	private startBits(): void {
		if ( !this.bitsStarted ) {
			this.bitOffset = this.byteOffset * 8;
			this.bitsStarted = true;
		}
	}

	/*
	====================
	peekBits

	Inspects next count bits without consuming them.
	====================
	*/
	peekBits( count: number ): number {
		this.startBits();
		let res = 0;
		const avail = this.data.length * 8;

		for ( let i = 0; i < count && ( this.bitOffset + i ) < avail; i++ ) {
			const bit = this.bitOffset + i;
			const b = ( this.data[Math.floor( bit / 8 )] >> ( bit % 8 ) ) & 1;
			res |= ( b << i );
		}

		return res;
	}

	/*
	====================
	readBits

	Consumes count bits from the bitstream.
	====================
	*/
	readBits( count: number ): number | null {
		this.startBits();

		if ( this.bitOffset + count > this.data.length * 8 ) {
			return null;
		}

		const res = this.peekBits( count );
		this.bitOffset += count;

		return res;
	}
}


// ---------------------------------------------------------------------------
// wavelet channel reconstruction
// ---------------------------------------------------------------------------

/*
====================
decodeWaveletValue

Decodes a Huffman-coded wavelet coefficient or escapes to raw integer reading.
====================
*/
function decodeWaveletValue(
	lookup: { values: Int16Array; bitCounts: Uint8Array },
	escapeBits: number,
	escapeBias: number,
	reader: WaveletBitReader
): number | null {
	const code = reader.peekBits( HUFFMAN_LOOKUP_BITS );
	const bitCount = lookup.bitCounts[code];

	if ( !bitCount ) {
		return null;
	}

	reader.readBits( bitCount );
	let val = lookup.values[code];

	if ( val === ESCAPE_VALUE ) {
		const esc = reader.readBits( escapeBits );

		if ( esc === null ) {
			return null;
		}

		val = esc - escapeBias;
	}

	return val;
}

/*
====================
decodeCoefficients

Decodes horizontal, vertical, and diagonal wavelet difference coefficients [H, V, D].
====================
*/
function decodeCoefficients(
	lookup: { values: Int16Array; bitCounts: Uint8Array },
	escapeBits: number,
	escapeBias: number,
	reader: WaveletBitReader
): [number, number, number] | null {
	const c0 = decodeWaveletValue( lookup, escapeBits, escapeBias, reader );
	const c1 = decodeWaveletValue( lookup, escapeBits, escapeBias, reader );
	const c2 = decodeWaveletValue( lookup, escapeBits, escapeBias, reader );

	if ( c0 === null || c1 === null || c2 === null ) {
		return null;
	}

	return [c0, c1, c2];
}

/*
====================
reconstructChannel

Applies 2x2 inverse Haar-like 2D synthesis filter to reconstruct 4 child pixels from 1 parent.
====================
*/
function reconstructChannel(
	source: Uint8Array,
	dest: Uint8Array,
	bpp: number,
	stride: number,
	ch: number,
	parity: number,
	coeffs: [number, number, number]
): void {
	const base = 2 * source[ch];
	const h = coeffs[0];
	const v = coeffs[1];
	const d = coeffs[2];

	dest[ch] = ( parity + ( ( d + v + h + base ) >> 1 ) ) & 0xff;
	dest[bpp + ch] = ( ( h + base - d - v ) >> 1 ) & 0xff;
	dest[stride + ch] = ( ( v - d + base - h ) >> 1 ) & 0xff;
	dest[stride + bpp + ch] = ( ( base - h - v + d ) >> 1 ) & 0xff;
}

/*
====================
addDeltaToMipmap

Decodes alpha/delta adjustment vectors and accumulates them into parent mipmap bytes.
====================
*/
function addDeltaToMipmap(
	pixels: Uint8Array,
	pixelCount: number,
	channelCount: number,
	bpp: number,
	reader: WaveletBitReader
): boolean {
	const alphaLookup = getAlphaLookup();
	let off = 0;

	for ( let i = 0; i < pixelCount; i++ ) {
		for ( let ch = 0; ch < channelCount; ch++ ) {
			const delta = decodeWaveletValue( alphaLookup, 9, 255, reader );

			if ( delta === null ) {
				return false;
			}

			pixels[off + ch] = ( pixels[off + ch] + delta ) & 0xff;
		}

		off += bpp;
	}

	return true;
}

/*
====================
decodeRawLevel

Reads uncompressed root wavelet base levels directly from stream bytes.
====================
*/
function decodeRawLevel(
	destination: Uint8Array,
	pixelCount: number,
	channelCount: number,
	bpp: number,
	reader: WaveletBitReader
): boolean {
	let off = 0;

	for ( let i = 0; i < pixelCount; i++ ) {
		for ( let ch = 0; ch < channelCount; ch++ ) {
			const b = reader.readRawByte();

			if ( b === null ) {
				return false;
			}

			destination[off + ch] = b;
		}

		for ( let ch = channelCount; ch < bpp; ch++ ) {
			destination[off + ch] = 0xff;
		}

		off += bpp;
	}

	return true;
}

/*
====================
decodeWaveletLevel

Reconstructs one hierarchical level of 2D wavelet synthesis from parent resolution.
====================
*/
function decodeWaveletLevel(
	source: Uint8Array | null,
	destination: Uint8Array,
	width: number,
	height: number,
	channelCount: number,
	bpp: number,
	reader: WaveletBitReader
): boolean {
	if ( width <= 1 || height <= 1 ) {
		return decodeRawLevel( destination, width * height, channelCount, bpp, reader );
	}

	if ( !source ) {
		return false;
	}

	const needsMipDelta = reader.readBits( 1 );

	if ( needsMipDelta === null ) {
		return false;
	}

	let adjSource = source;

	if ( needsMipDelta ) {
		const sz = Math.floor( width * height / 4 ) * bpp;
		adjSource = new Uint8Array( source.subarray( 0, sz ) );

		if ( !addDeltaToMipmap( adjSource, Math.floor( width * height / 4 ), channelCount, bpp, reader ) ) {
			return false;
		}
	}

	const blueLookup = getBlueLookup();
	const redGreenLookup = getRedGreenLookup();
	const alphaLookup = getAlphaLookup();

	const stride = width * bpp;

	for ( let y = 0; y < height; y += 2 ) {
		for ( let x = 0; x < width; x += 2 ) {
			const srcIdx = ( ( Math.floor( y / 2 ) * Math.floor( width / 2 ) + Math.floor( x / 2 ) ) ) * bpp;
			const dstIdx = ( y * width + x ) * bpp;
			const srcPx = adjSource.subarray( srcIdx );
			const dstPx = destination.subarray( dstIdx );

			let blueCoeffs: [number, number, number] = [0, 0, 0];

			if ( channelCount !== 1 ) {
				const parity = reader.readBits( 1 );

				if ( parity === null ) {
					return false;
				}

				const coeffs = decodeCoefficients( blueLookup, 9, 0xff, reader );

				if ( !coeffs ) {
					return false;
				}

				blueCoeffs = coeffs;
				reconstructChannel( srcPx, dstPx, bpp, stride, 0, parity, blueCoeffs );

				if ( channelCount >= 3 ) {
					for ( let ch = 1; ch <= 2; ch++ ) {
						const chParity = reader.readBits( 1 );

						if ( chParity === null ) {
							return false;
						}

						const chCoeffs = decodeCoefficients( redGreenLookup, 10, 0x1fe, reader );

						if ( !chCoeffs ) {
							return false;
						}

						chCoeffs[0] += blueCoeffs[0];
						chCoeffs[1] += blueCoeffs[1];
						chCoeffs[2] += blueCoeffs[2];
						reconstructChannel( srcPx, dstPx, bpp, stride, ch, chParity, chCoeffs );
					}
				}
			}

			if ( channelCount === 3 ) {
				dstPx[3] = 0xff;
				dstPx[bpp + 3] = 0xff;
				dstPx[stride + 3] = 0xff;
				dstPx[stride + bpp + 3] = 0xff;
			} else {
				const aParity = reader.readBits( 1 );

				if ( aParity === null ) {
					return false;
				}

				const aCoeffs = decodeCoefficients( alphaLookup, 9, 0xff, reader );

				if ( !aCoeffs ) {
					return false;
				}

				reconstructChannel( srcPx, dstPx, bpp, stride, channelCount - 1, aParity, aCoeffs );
			}
		}
	}

	return true;
}


// ---------------------------------------------------------------------------
// top-level texture decoders
// ---------------------------------------------------------------------------

/*
====================
decodeWavelet

Decompresses a complete multi-level wavelet bitstream image into 32-bit RGBA.
Swizzles internal BGRA channel ordering to standard RGBA.
====================
*/
export function decodeWavelet( data: Uint8Array ): {
	width: number;
	height: number;
	rgba: Uint8Array;
} {
	const fmt = data[IWI_FORMAT_OFFSET];
	const channelCount = fmt === IWI_FORMAT_WAVELET_RGBA ? 4 : 3;
	const width = data[IWI_WIDTH_OFFSET] | ( data[IWI_WIDTH_OFFSET + 1] << 8 );
	const height = data[IWI_HEIGHT_OFFSET] | ( data[IWI_HEIGHT_OFFSET + 1] << 8 );

	const reader = new WaveletBitReader( data.subarray( IWI_HEADER_SIZE ) );
	const maxDim = Math.max( width, height );
	const totalLevels = Math.ceil( Math.log2( maxDim ) );

	let prev: Uint8Array | null = null;

	for ( let mip = totalLevels; mip >= 0; mip-- ) {
		const mw = Math.max( 1, width >> mip );
		const mh = Math.max( 1, height >> mip );
		const next = new Uint8Array( mw * mh * 4 );

		if ( !decodeWaveletLevel( prev, next, mw, mh, channelCount, 4, reader ) ) {
			throw new Error( `Failed to decode wavelet mip level ${mip} (${mw}x${mh})` );
		}

		prev = next;
	}

	if ( !prev ) {
		throw new Error( 'Failed to reconstruct wavelet image' );
	}

	// Wavelet output is BGRA -> convert to RGBA
	const rgba = new Uint8Array( width * height * 4 );

	for ( let i = 0; i < width * height; i++ ) {
		rgba[i * 4] = prev[i * 4 + 2];     // R
		rgba[i * 4 + 1] = prev[i * 4 + 1]; // G
		rgba[i * 4 + 2] = prev[i * 4];     // B
		rgba[i * 4 + 3] = prev[i * 4 + 3]; // A
	}

	return { width, height, rgba };
}

/*
====================
decodeIwiToRgba

Primary dispatcher: decodes any Call of Duty 2 .iwi image into 32-bit RGBA buffer.
Supports DXT1, DXT3, DXT5, BGRA, BGR, L8 Alpha, and Wavelet compression.
====================
*/
export function decodeIwiToRgba( data: Uint8Array ): {
	width: number;
	height: number;
	rgba: Uint8Array;
} {
	if ( data.length >= IWI_HEADER_SIZE && ( data[IWI_FORMAT_OFFSET] === IWI_FORMAT_WAVELET_RGBA || data[IWI_FORMAT_OFFSET] === IWI_FORMAT_WAVELET_RGB ) ) {
		return decodeWavelet( data );
	}

	const { format, width, height, texData } = readIwiMip0( data );
	let rgba: Uint8Array;

	switch ( format ) {
		case IWI_FORMAT_DXT1:
		case IWI_FORMAT_DXT3:
		case IWI_FORMAT_DXT5:
			rgba = decodeDxt( format, texData, width, height );
			break;
		case IWI_FORMAT_RGBA: { // BGRA 32-bit
			rgba = new Uint8Array( width * height * 4 );
			for ( let i = 0; i < width * height; i++ ) {
				rgba[i * 4] = texData[i * 4 + 2];     // R
				rgba[i * 4 + 1] = texData[i * 4 + 1]; // G
				rgba[i * 4 + 2] = texData[i * 4];     // B
				rgba[i * 4 + 3] = texData[i * 4 + 3]; // A
			}
			break;
		}
		case IWI_FORMAT_RGB: { // BGR 24-bit
			rgba = new Uint8Array( width * height * 4 );
			for ( let i = 0; i < width * height; i++ ) {
				rgba[i * 4] = texData[i * 3 + 2];     // R
				rgba[i * 4 + 1] = texData[i * 3 + 1]; // G
				rgba[i * 4 + 2] = texData[i * 3];     // B
				rgba[i * 4 + 3] = 255;                // A
			}
			break;
		}
		case IWI_FORMAT_ALPHA: { // L8
			rgba = new Uint8Array( width * height * 4 );
			for ( let i = 0; i < width * height; i++ ) {
				rgba[i * 4] = 255;
				rgba[i * 4 + 1] = 255;
				rgba[i * 4 + 2] = 255;
				rgba[i * 4 + 3] = texData[i];
			}
			break;
		}
		default:
			throw new Error( `Unsupported IWI format 0x${format.toString( 16 )}` );
	}

	return { width, height, rgba };
}

/*
====================
decodeIwiFaceToRgba

Decodes a specific cubemap face (0 to 5) from a cubemap .iwi image into 32-bit RGBA.
Falls back to decodeIwiToRgba for 2D images.
====================
*/
export function decodeIwiFaceToRgba(
	data: Uint8Array,
	face: number = 0
): {
	width: number;
	height: number;
	rgba: Uint8Array;
} {
	if ( data.length >= IWI_HEADER_SIZE && ( data[IWI_FORMAT_OFFSET] === IWI_FORMAT_WAVELET_RGBA || data[IWI_FORMAT_OFFSET] === IWI_FORMAT_WAVELET_RGB ) ) {
		return decodeWavelet( data );
	}

	const { format, width, height, texData } = readIwiMip0( data );
	const [blocksX, blocksY] = dxtBlockDimensions( width, height );
	const faceBytes = blocksX * blocksY * ( format === IWI_FORMAT_DXT1 ? DXT1_BLOCK_BYTES : DXT_DEFAULT_BLOCK_BYTES );
	const faceSlice = texData.subarray( face * faceBytes, ( face + 1 ) * faceBytes );
	const activeData = faceSlice.length >= faceBytes ? faceSlice : texData;

	switch ( format ) {
		case IWI_FORMAT_DXT1:
		case IWI_FORMAT_DXT3:
		case IWI_FORMAT_DXT5:
			return {
				width,
				height,
				rgba: decodeDxt( format, activeData, width, height ),
			};
		default:
			return decodeIwiToRgba( data );
	}
}
