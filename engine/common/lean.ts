/*
===============================================================================

	lean.ts

	Call of Duty 2 / id Tech Player Corner Peeking / Leaning
	Leaning rate dynamics, camera origin offset transformations,
	and collision clearance clamping based on native routines 0x518f60, 0x44b2f0, 0x519177.

===============================================================================
*/

import { vec3_t } from './types.js';
import { STANCE_HEIGHT_PRONE, STANCE_HEIGHT_STAND } from './stance.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const LEAN_ENTER_DURATION_MS = 350;
export const LEAN_EXIT_DURATION_MS  = 280;
export const LEAN_LIMIT_DEFAULT     = 0.5;
export const LEAN_LIMIT_PRONE       = 0.25;
export const LEAN_ROLL_DEGREES      = 16;
export const LEAN_OFFSET_DISTANCE   = 20;


// ---------------------------------------------------------------------------
// lean dynamics
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Lean_Advance
 *
 * Advances normalized lean scalar [-limit, limit] based on input direction and stance (0x518f60..0x519098).
 * Enters lean over 350ms, releases back to center over 280ms. Prone stance limits lean to 0.25.
 * ================
 */
export function Lean_Advance(
	value: number,
	direction: number,
	msec: number,
	height: number = STANCE_HEIGHT_STAND
): number {
	const limit = height === STANCE_HEIGHT_PRONE ? LEAN_LIMIT_PRONE : LEAN_LIMIT_DEFAULT;

	if ( direction > 0 ) {
		return Math.fround( Math.min( limit, value + msec * Math.fround( 1 / LEAN_ENTER_DURATION_MS ) * limit ) );
	}

	if ( direction < 0 ) {
		return Math.fround( Math.max( -limit, value - msec * Math.fround( 1 / LEAN_ENTER_DURATION_MS ) * limit ) );
	}

	const amount = msec * Math.fround( 1 / LEAN_EXIT_DURATION_MS ) * limit;

	return Math.fround(
		value > 0
			? Math.max( 0, value - amount )
			: Math.min( 0, value + amount )
	);
}


// ---------------------------------------------------------------------------
// camera translation
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Lean_Origin
 *
 * Offsets eye origin laterally and vertically during lean (0x44b2f0).
 * Uses quadratic ease curve value * (2 - |value|) to arc camera up to 20 units outward and 16 degrees roll.
 * ================
 */
export function Lean_Origin(
	origin: vec3_t,
	yaw: number,
	value: number
): vec3_t {
	const eased = Math.fround( value * ( 2 - Math.abs( value ) ) );
	const radians = Math.fround( Math.PI / 180 );
	const angle = Math.fround( Math.fround( eased * LEAN_ROLL_DEGREES ) * radians );
	const heading = Math.fround( yaw * radians );
	const distance = Math.fround( eased * LEAN_OFFSET_DISTANCE );

	return [
		Math.fround( origin[0] + Math.fround( Math.cos( angle ) * Math.sin( heading ) ) * distance ),
		Math.fround( origin[1] - Math.fround( Math.cos( angle ) * Math.cos( heading ) ) * distance ),
		Math.fround( origin[2] - Math.fround( Math.sin( angle ) ) * distance ),
	];
}


// ---------------------------------------------------------------------------
// collision clamping
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Lean_Clamp
 *
 * Inverts quadratic easing to clamp lean amount if trace hits geometry (0x519177..0x5191b8).
 * ================
 */
export function Lean_Clamp( value: number, fraction: number ): number {
	const limit = 1 - Math.sqrt( 1 - Math.max( 0, Math.min( 1, fraction ) ) );

	return Math.fround( Math.sign( value ) * Math.min( Math.abs( value ), limit ) );
}
