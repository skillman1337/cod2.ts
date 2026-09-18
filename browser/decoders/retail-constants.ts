/*
===============================================================================

	retail-constants.ts

	Call of Duty 2 / id Tech Engine Defaults & Retail Constants
	Pre-analyzed dvars, stance curves, surfaces, and fallback menus.
	Provides binary base64 decompression routines for engine initialization.

===============================================================================
*/


// ---------------------------------------------------------------------------
// base64 asset payloads
// ---------------------------------------------------------------------------

import { RETAIL_DEFAULTS } from './retail-defaults.js';

export const DEFAULT_WEIGHTS_PNG_B64 = "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";


// ---------------------------------------------------------------------------
// retail stance curves
// ---------------------------------------------------------------------------

export const DEFAULT_STANCE: Record<string, [number, number, number][]> = {
	'60_40': [
		[0, 60.0, 0], [1, 59.5, 0], [4, 58.5, 0], [30, 56.0, 0],
		[80, 44.0, 0], [90, 41.5, 0], [95, 40.5, 0], [100, 40.0, 0],
	],
	'40_60': [
		[0, 40.0, 0], [5, 40.5, 0], [10, 41.5, 0], [20, 44.0, 0],
		[70, 56.0, 0], [96, 58.5, 0], [99, 59.5, 0], [100, 60.0, 0],
	],
	'40_11': [
		[0, 40.0, 0], [11, 38.0, 0], [22, 33.0, 0], [34, 25.0, 0],
		[45, 16.0, 0], [50, 15.0, 0], [55, 16.0, 0], [66, 21.0, 0],
		[78, 25.0, 0], [89, 23.0, 0], [100, 11.0, 0],
	],
	'11_40': [
		[0, 11.0, 0], [11, 23.0, 0], [22, 25.0, 0], [34, 21.0, 0],
		[45, 16.0, 0], [50, 15.0, 0], [55, 16.0, 0], [66, 25.0, 0],
		[78, 33.0, 0], [89, 38.0, 0], [100, 40.0, 0],
	],
};


// ---------------------------------------------------------------------------
// retail surfaces
// ---------------------------------------------------------------------------

export const DEFAULT_SURFACES: string[] = [
	'default', 'bark', 'brick', 'carpet', 'cloth', 'concrete', 'dirt', 'flesh',
	'foliage', 'glass', 'grass', 'gravel', 'ice', 'metal', 'mud', 'paper',
	'plaster', 'rock', 'sand', 'snow', 'water', 'wood', 'asphalt',
];


// ---------------------------------------------------------------------------
// fallback menus
// ---------------------------------------------------------------------------

export const FALLBACK_MENUS: Record<string, string> = {
	'ui/options_view.menu': '{\nmenuDef {\nname "options_view"\nvisible 0\nfullscreen 0\nrect 0 0 640 480\n}\n}\n',
	'ui/options_defaults.menu': '{\nmenuDef {\nname "options_defaults"\nvisible 0\nfullscreen 0\nrect 0 0 640 480\n}\n}\n',
	'ui/options_credits.menu': '{\nmenuDef {\nname "options_credits"\nvisible 0\nfullscreen 0\nrect 0 0 640 480\n}\n}\n',
	'ui/rec_restart.menu': '{\nmenuDef {\nname "rec_restart_popmenu"\nvisible 0\nfullscreen 0\nrect 204 140 235 135\npopup\n}\nmenuDef {\nname "rec_restart"\nvisible 0\nfullscreen 0\nrect 204 140 235 135\npopup\n}\n}\n',
	'ui_mp/in_rec_restart.menu': '{\nmenuDef {\nname "in_rec_restart_popmenu"\nvisible 0\nfullscreen 0\nrect 204 140 235 135\npopup\n}\nmenuDef {\nname "in_rec_restart"\nvisible 0\nfullscreen 0\nrect 204 140 235 135\npopup\n}\n}\n',
};


// ---------------------------------------------------------------------------
// decompression & extraction helpers
// ---------------------------------------------------------------------------

/*
====================
base64ToBytes

Decodes a base64 string into a raw byte buffer.
====================
*/
export function base64ToBytes( b64: string ): Uint8Array {
	const bin = atob( b64 );
	const bytes = new Uint8Array( bin.length );

	for ( let i = 0; i < bin.length; i++ ) {
		bytes[i] = bin.charCodeAt( i );
	}

	return bytes;
}

/*
====================
decompressDvars

Serializes readable compatibility defaults. The legacy API name is preserved.
====================
*/
export async function decompressDvars(): Promise<Uint8Array> {
	return new TextEncoder().encode( JSON.stringify( RETAIL_DEFAULTS ) );
}

/*
====================
decodeWeightsPng

Decodes the base64-encoded default lightmap weights PNG binary.
====================
*/
export function decodeWeightsPng(): Uint8Array {
	return base64ToBytes( DEFAULT_WEIGHTS_PNG_B64 );
}

/*
====================
concatByteArrays

Concatenates an array of Uint8Array chunks into a single contiguous byte buffer.
====================
*/
export function concatByteArrays( chunks: Uint8Array[] ): Uint8Array {
	const totalBytes = chunks.reduce( ( acc, c ) => acc + c.length, 0 );
	const out = new Uint8Array( totalBytes );
	let offset = 0;

	for ( const c of chunks ) {
		out.set( c, offset );
		offset += c.length;
	}

	return out;
}

/*
====================
readCString

Decodes a null-terminated UTF-8 or ASCII string from a byte buffer at the given cursor.
Returns the decoded string and advances the cursor past the null terminator.
====================
*/
export function readCString(
	bytes: Uint8Array,
	cursor: number,
	decoder: TextDecoder = new TextDecoder( 'utf-8' )
): { text: string; cursor: number } {
	let end = cursor;

	while ( end < bytes.length && bytes[end] !== 0 ) {
		end++;
	}

	return {
		text: decoder.decode( bytes.subarray( cursor, end ) ),
		cursor: end < bytes.length ? end + 1 : end,
	};
}

/*
====================
readCStringList

Decodes a sequence of count null-terminated strings starting at cursor.
====================
*/
export function readCStringList(
	bytes: Uint8Array,
	count: number,
	cursor: number,
	decoder: TextDecoder = new TextDecoder( 'utf-8' )
): { strings: string[]; cursor: number } {
	const strings: string[] = [];

	for ( let i = 0; i < count; i++ ) {
		const entry = readCString( bytes, cursor, decoder );
		strings.push( entry.text );
		cursor = entry.cursor;
	}

	return { strings, cursor };
}

/*
====================
readVec3

Reads 3 consecutive 32-bit floats from a DataView at offset as a 3D vector.
====================
*/
export function readVec3(
	view: DataView,
	offset: number,
	littleEndian = true
): [number, number, number] {
	return [
		view.getFloat32( offset, littleEndian ),
		view.getFloat32( offset + 4, littleEndian ),
		view.getFloat32( offset + 8, littleEndian ),
	];
}

/*
====================
readVec4

Reads 4 consecutive 32-bit floats from a DataView at offset as a 4D vector.
====================
*/
export function readVec4(
	view: DataView,
	offset: number,
	littleEndian = true
): [number, number, number, number] {
	return [
		view.getFloat32( offset, littleEndian ),
		view.getFloat32( offset + 4, littleEndian ),
		view.getFloat32( offset + 8, littleEndian ),
		view.getFloat32( offset + 12, littleEndian ),
	];
}


