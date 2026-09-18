/*
===============================================================================

	movement-cycle.test.mjs

	Gait-cycle accumulation regression: ADS slows the per-slice advance below
	one cycle unit, and uncapped frametimes slice it even finer. Truncating
	every slice (retail 0x518abc on fixed server ticks) then stalls forever:
	bobCycle sticks at 0, the third-person locomotion playhead locks, and no
	footstep events fire. Reproduced from a 625-frame ADS+W recording at
	~4.17ms slices (kar98k, speed ~76 u/s, rate ~0.134): before the fix the
	cycle never left 0 and soundSequence never advanced.

===============================================================================
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register( './support/movement-assets-loader.mjs', import.meta.url );

const { Movement_Cycle, Movement_LadderCycle } = await import( '../../engine/common/movement_events.ts' );

// Recording-derived ADS gait rate: (76 u/s / 190 reference) * 0.335 forward.
const ADS_RATE = ( 76 / 190 ) * 0.335;
const HIP_RATE = 0.335;
const MICRO_SLICE_MS = 4.17;
const ADS_FRAMES = 625;

function threadCycle( frames, msec, rate ) {
	let cycle = 0;
	let fraction = 0;
	let steps = 0;

	for ( let i = 0; i < frames; i++ ) {
		const result = Movement_Cycle( cycle, msec, rate, fraction );
		cycle = result.cycle;
		fraction = result.fraction;
		if ( result.step ) steps++;
	}

	return { cycle, fraction, steps };
}

test( 'ADS-rate micro slices accumulate instead of truncating to zero', () => {
	const { cycle, fraction, steps } = threadCycle( ADS_FRAMES, MICRO_SLICE_MS, ADS_RATE );

	assert.notEqual( cycle, 0, 'bobCycle must advance over 625 ADS frames (was stuck at 0)' );
	assert.ok( fraction >= 0 && fraction < 1, 'remainder must stay sub-cycle, got ' + fraction );
	assert.ok( steps >= 2, 'footfalls must resume while ADS+moving, got ' + steps );
} );

test( 'accumulated progress is conserved across 625 ADS micro slices', () => {
	const expected = ADS_FRAMES * MICRO_SLICE_MS * Math.fround( ADS_RATE );
	const { cycle, fraction } = threadCycle( ADS_FRAMES, MICRO_SLICE_MS, ADS_RATE );

	// Integer advances plus remainder must equal the exact scaled total
	// modulo one full 256-unit wrap.
	const wrapped = ( cycle - fraction + 256 ) % 256;
	const expectedWrapped = ( ( expected % 256 ) + 256 ) % 256;
	assert.ok(
		Math.abs( wrapped - expectedWrapped ) < 1,
		`conserved ${wrapped} vs expected ${expectedWrapped}`
	);
} );

test( 'integer slices still match retail truncation with no remainder', () => {
	const noRemainder = Movement_Cycle( 0, 16, HIP_RATE );

	assert.equal( noRemainder.cycle, 5, '16ms * 0.335 truncates to 5 like retail' );
	assert.ok( Math.abs( noRemainder.fraction - ( 16 * Math.fround( HIP_RATE ) - 5 ) ) < 1e-9 );

	const boundary = Movement_Cycle( 63, 16, HIP_RATE );
	assert.equal( boundary.cycle, 68 );
	assert.equal( boundary.step, true, 'crossing bobCycle 64 must report a footfall' );
} );

test( 'cycle results are invariant to slice granularity', () => {
	const fine = Movement_Cycle( Movement_Cycle( 10, 4, ADS_RATE, 0 ).cycle, 4, ADS_RATE, Movement_Cycle( 10, 4, ADS_RATE, 0 ).fraction );
	const coarse = Movement_Cycle( 10, 8, ADS_RATE, 0 );

	assert.equal( fine.cycle, coarse.cycle, 'two 4ms slices must equal one 8ms slice' );
	assert.ok( Math.abs( fine.fraction - coarse.fraction ) < 1e-9 );
} );

test( 'ladder cycle accumulates and stays slice invariant', () => {
	const step = ( cycle, fraction, msec, vertical ) =>
		Movement_LadderCycle( cycle, msec, vertical, false, fraction );

	const first = step( 200, 0, 120, 4 );
	const fine = step( first.cycle, first.fraction, 120, 4 );
	const coarse = step( 200, 0, 120, 8 );

	assert.equal( fine.cycle, coarse.cycle );
	assert.ok( Math.abs( fine.fraction - coarse.fraction ) < 1e-9 );
	assert.ok( 'fraction' in coarse && 'step' in coarse, 'ladder result keeps retail fields plus remainder' );
} );
