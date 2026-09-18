/*
===============================================================================

	step_view.ts

	Call of Duty 2 / id Tech Stair Step View Smoothing
	Smooths stair climbing vertical stepping camera bobbing over a 100ms decay window.
	Reconstructed from native routines 0x4e0de6..0x4e0e85 and 0x4cebc0.

===============================================================================
*/


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const STEP_VIEW_DECAY_MS       = 100;
export const STEP_VIEW_MIN_OFFSET     = -16;
export const STEP_VIEW_MAX_OFFSET     = 24;
export const STEP_VIEW_CARRY_FRACTION = 0.9;
export const STEP_VIEW_DECAY_SCALE    = 0.01;


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface step_view_t {
	amount: number;
	time: number;
	sequence: number;
}


// ---------------------------------------------------------------------------
// camera step smoothing
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * StepView_Event
 *
 * Processes EV_STEP event (0x4e0de6..0x4e0e85).
 * Decays remaining displacement over 100ms, blends 0.9 carryover fraction,
 * and clamps accumulated step offset between -16 and 24 units.
 * ================
 */
export function StepView_Event(
	view: step_view_t,
	delta: number,
	time: number
): void {
	const elapsed = time - view.time;

	const carry = elapsed >= STEP_VIEW_DECAY_MS
		? 0
		: ( STEP_VIEW_DECAY_MS - elapsed ) * view.amount * Math.fround( STEP_VIEW_DECAY_SCALE ) * Math.fround( STEP_VIEW_CARRY_FRACTION );

	view.amount = Math.max( STEP_VIEW_MIN_OFFSET, Math.min( STEP_VIEW_MAX_OFFSET, Math.fround( carry + delta ) ) );
	view.time = time;
}

/**
 * @exec helper
 * ================
 * StepView_Height
 *
 * Applies temporary vertical camera offset to eye height (0x4cebc0).
 * Linearly decays step offset back to zero over 100ms.
 * Applied strictly to rendering camera, never fed back into player physics origin.
 * ================
 */
export function StepView_Height(
	view: step_view_t,
	z: number,
	time: number
): number {
	const elapsed = time - view.time;

	if ( elapsed < 0 ) {
		view.time = time;
	}

	if ( elapsed >= STEP_VIEW_DECAY_MS ) {
		return z;
	}

	return Math.fround( z - ( STEP_VIEW_DECAY_MS - elapsed ) * view.amount * Math.fround( STEP_VIEW_DECAY_SCALE ) );
}
