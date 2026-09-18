/*
===============================================================================

	landing.ts

	Call of Duty 2 / id Tech Player Landing Impact & View Dip
	Ballistic fall height calculation, landing sound classification,
	impact shock intensity, and camera view spring dip recovery.
	Reconstructed from native routines 0x516990, 0x516ac3, 0x516c4c, 0x4cf041.

===============================================================================
*/


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const LANDING_MIN_HEIGHT           = 12;
export const LANDING_MAX_AMOUNT           = 24;
export const LANDING_SCALE_DIVISOR        = 26;
export const LANDING_AMOUNT_SCALE         = 4;

export const LANDING_SOUND_THRESHOLD_NONE = 4;
export const LANDING_SOUND_THRESHOLD_WALK = 8;
export const LANDING_SOUND_THRESHOLD_RUN  = 12;

export const LANDING_SOUND_WALK           = 'walk';
export const LANDING_SOUND_RUN            = 'run';
export const LANDING_SOUND_LAND           = 'land';

export const LANDING_DIP_TOTAL_MS         = 450;
export const LANDING_DIP_DOWN_MS          = 150;
export const LANDING_DIP_RECOVER_MS       = 300;


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface landing_view_t {
	amount: number;
	time: number;
	sequence: number;
}


// ---------------------------------------------------------------------------
// impact calculations
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Landing_Height
 *
 * Computes ballistic impact fall height in world units from start origin and velocity (0x516990).
 * ================
 */
export function Landing_Height(
	startZ: number,
	endZ: number,
	velocityZ: number,
	gravity: number
): number {
	if ( gravity <= 0 || velocityZ >= 0 ) {
		return 0;
	}

	return Math.max( 0, Math.fround( ( velocityZ * velocityZ ) / ( 2 * gravity ) + startZ - endZ ) );
}

/**
 * @exec helper
 * ================
 * Landing_Amount
 *
 * Computes integer impact intensity parameter for landing events (0x516ac3..0x516af2).
 * Truncates positive scaled fraction within range [0, 24].
 * ================
 */
export function Landing_Amount( height: number ): number {
	if ( height <= LANDING_MIN_HEIGHT ) {
		return 0;
	}

	return Math.min( LANDING_MAX_AMOUNT, Math.trunc( ( ( height - LANDING_MIN_HEIGHT ) * Math.fround( 1 / LANDING_SCALE_DIVISOR ) + 1 ) * LANDING_AMOUNT_SCALE ) );
}

/**
 * @exec helper
 * ================
 * Landing_SoundKind
 *
 * Selects landing impact audio alias category based on fall height (0x516c4c..0x516cca).
 * ================
 */
export function Landing_SoundKind( height: number ): 'walk' | 'run' | 'land' | null {
	if ( height <= LANDING_SOUND_THRESHOLD_NONE ) {
		return null;
	}

	if ( height < LANDING_SOUND_THRESHOLD_WALK ) {
		return LANDING_SOUND_WALK;
	}

	if ( height < LANDING_SOUND_THRESHOLD_RUN ) {
		return LANDING_SOUND_RUN;
	}

	return LANDING_SOUND_LAND;
}


// ---------------------------------------------------------------------------
// camera view effects
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Landing_ViewHeight
 *
 * Displaces camera view height downward on landing and smoothly recovers over 450ms (0x4cf041..0x4cf0c2).
 * Dips downward during the first 150ms, then recovers over the remaining 300ms.
 * ================
 */
export function Landing_ViewHeight(
	view: landing_view_t,
	z: number,
	time: number
): number {
	const elapsed = time - view.time;

	if ( elapsed < 0 || elapsed >= LANDING_DIP_TOTAL_MS ) {
		return z;
	}

	const scale = Math.fround(
		elapsed < LANDING_DIP_DOWN_MS
			? elapsed / LANDING_DIP_DOWN_MS
			: 1 - ( elapsed - LANDING_DIP_DOWN_MS ) / LANDING_DIP_RECOVER_MS
	);

	return Math.fround( z - view.amount * scale );
}
