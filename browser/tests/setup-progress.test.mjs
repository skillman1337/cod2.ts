/*
===============================================================================

	setup-progress.test.mjs

	Call of Duty 2 / id Tech Setup Progress & Data Size Unit Tests
	Validates progress clamping, non-finite handling, and data size display formatting.

===============================================================================
*/

import test from 'node:test';
import assert from 'node:assert/strict';

import { formatBytes, progressValue } from '../setup-view.mjs';


// ---------------------------------------------------------------------------
// test suites
// ---------------------------------------------------------------------------

test( 'unknown, empty, negative, and non-finite totals remain indeterminate', () => {
	for ( const [done, total] of [
		[undefined, undefined],
		[2, 0],
		[0, -3],
		[NaN, 11],
		[3, Infinity],
		[Infinity, 11],
	] ) {
		assert.equal( progressValue( done, total ), null );
	}
} );

test( 'real progress clamps to its bounds without inventing time remaining', () => {
	assert.deepEqual( progressValue( 7, 11 ), { done: 7, total: 11 } );
	assert.deepEqual( progressValue( -1, 11 ), { done: 0, total: 11 } );
	assert.deepEqual( progressValue( 12, 11 ), { done: 11, total: 11 } );
} );

test( 'cache sizes format safely at display boundaries', () => {
	assert.equal( formatBytes( -1 ), '0 B' );
	assert.equal( formatBytes( Infinity ), '0 B' );
	assert.equal( formatBytes( 3 * 1024 ** 3 ), '3.0 GB' );
	assert.equal( formatBytes( 15 * 1024 ** 2 ), '15 MB' );
} );
