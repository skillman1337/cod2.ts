/*
===============================================================================

	retail-iwi.test.mjs

	Call of Duty 2 / id Tech Texture Decoder Tests
	Tests DXT1/5 and Wavelet 0x06 / 0x07 decompression in pure TypeScript.

===============================================================================
*/

import test from 'node:test';
import assert from 'node:assert/strict';

import { decodeIwiToRgba, IWI_FORMAT_RGBA, IWI_FORMAT_WAVELET_RGBA } from '../decoders/retail-iwi.ts';


// ---------------------------------------------------------------------------
// test suites
// ---------------------------------------------------------------------------

test( 'decodeIwiToRgba parses 1x1 RGBA IWI correctly', () => {
	// Construct 1x1 RGBA (format 1) IWI image
	// Header: 'IWi' (3) + version (1) + format (1) + flags (1) + width (2) + height (2) + depth (2) + mips (16) = 28 bytes
	const header = new Uint8Array( 28 );
	header[0] = 0x49; // 'I'
	header[1] = 0x57; // 'W'
	header[2] = 0x69; // 'i'
	header[3] = 6;    // version 6
	header[4] = IWI_FORMAT_RGBA;
	header[6] = 1;
	header[7] = 0; // width 1
	header[8] = 1;
	header[9] = 0; // height 1

	// All 4 mip offsets point to 28
	const view = new DataView( header.buffer );
	view.setInt32( 12, 28, true );
	view.setInt32( 16, 28, true );
	view.setInt32( 20, 28, true );
	view.setInt32( 24, 28, true );

	// BGRA pixel (B=10, G=20, R=30, A=40)
	const pixel = new Uint8Array( [10, 20, 30, 40] );
	const data = new Uint8Array( header.length + pixel.length );
	data.set( header, 0 );
	data.set( pixel, header.length );

	const decoded = decodeIwiToRgba( data );
	assert.equal( decoded.width, 1 );
	assert.equal( decoded.height, 1 );
	assert.deepEqual( Array.from( decoded.rgba ), [30, 20, 10, 40] ); // converted to RGBA
} );

test( 'decodeIwiToRgba detects format 6 wavelet and rejects truncated payload gracefully', () => {
	const header = new Uint8Array( 32 );
	header[0] = 0x49;
	header[1] = 0x57;
	header[2] = 0x69;
	header[3] = 6;
	header[4] = IWI_FORMAT_WAVELET_RGBA; // format 6
	header[6] = 2;
	header[7] = 0; // width 2
	header[8] = 2;
	header[9] = 0; // height 2

	// An incomplete wavelet payload should throw a descriptive error, not crash the process
	assert.throws( () => {
		decodeIwiToRgba( header );
	}, /Failed to decode wavelet mip level/ );
} );
