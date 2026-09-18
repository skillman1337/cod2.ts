/*
===============================================================================

	frame_clock.ts

	Call of Duty 2 / id Tech Frame Limiter
	Computes target frame interval from com_maxfps dvar.

===============================================================================
*/


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const MSEC_PER_SECOND = 1000;
export const MIN_FRAME_MSEC  = 1;


// ---------------------------------------------------------------------------
// frame timing
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Frame_MinMsec
 *
 * 0x434f6f..0x434f91: Integer minimum frame interval in milliseconds.
 * A maxfps value of zero or negative denotes unlimited frame rate.
 * Dedicated servers ignore client frame rate throttling.
 * ================
 */
export function Frame_MinMsec( maxfps: number, dedicated: boolean ): number {
	if ( maxfps > 0 && !dedicated ) {
		const targetFps = Math.max( 1, Math.trunc( maxfps ) );
		return Math.max( MIN_FRAME_MSEC, Math.trunc( MSEC_PER_SECOND / targetFps ) );
	}

	return MIN_FRAME_MSEC;
}
