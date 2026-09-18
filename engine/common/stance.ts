/*
===============================================================================

	stance.ts

	Call of Duty 2 / id Tech Player Stance State Machine
	Height transition curves, durations, reversals, and collision capsule sizing
	for standing (60), crouching (40), and prone (11) postures.

===============================================================================
*/

import tables from '@/assets/ui/stance.json';
import { capsule_shape_t } from './collision_capsule.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const STANCE_HEIGHT_PRONE = 11;
export const STANCE_HEIGHT_CROUCH = 40;
export const STANCE_HEIGHT_STAND = 60;

export const STANCE_TOP_PRONE = 30;
export const STANCE_TOP_CROUCH = 50;
export const STANCE_TOP_STAND = 70;

export const STANCE_CAPSULE_RADIUS = 15;

export const STANCE_DURATION_PRONE = 400;
export const STANCE_DURATION_CROUCH = 200;


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export type stance_height_t = 11 | 40 | 60;

export interface stance_state_t {
	target: stance_height_t;
	height: number;
	from: stance_height_t;
	to: stance_height_t;
	elapsed: number;
}


// ---------------------------------------------------------------------------
// stance collision & timing
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Stance_Shape
 *
 * Computes player bounding capsule dimensions relative to foot+60 origin (0x518032/0x51805c/0x518083).
 * ================
 */
export function Stance_Shape( height: stance_height_t ): capsule_shape_t {
	const top = height === STANCE_HEIGHT_PRONE
		? STANCE_TOP_PRONE
		: height === STANCE_HEIGHT_CROUCH
			? STANCE_TOP_CROUCH
			: STANCE_TOP_STAND;

	return {
		radius: STANCE_CAPSULE_RADIUS,
		half: top / 2 - STANCE_CAPSULE_RADIUS,
		offset: top / 2 - STANCE_HEIGHT_STAND,
	};
}

/**
 * @exec helper
 * ================
 * Stance_Duration
 *
 * Transitions involving prone take 400ms; standing/crouch transitions take 200ms (0x5172a0).
 * ================
 */
export function Stance_Duration( from: stance_height_t, to: stance_height_t ): number {
	return from === STANCE_HEIGHT_PRONE || to === STANCE_HEIGHT_PRONE
		? STANCE_DURATION_PRONE
		: STANCE_DURATION_CROUCH;
}

/**
 * @exec helper
 * ================
 * Stance_Curve
 *
 * Linearly samples percentage-based height transition lookup tables (0x5172d0, 0x517440).
 * ================
 */
export function Stance_Curve(
	from: stance_height_t,
	to: stance_height_t,
	percent: number
): number {
	if ( from === to ) {
		return to;
	}

	const points = tables[`${from}_${to}` as keyof typeof tables];
	const p = Math.max( 0, Math.min( 100, Math.trunc( percent ) ) );

	let i = 0;

	while ( i + 1 < points.length && points[i + 1][0] <= p ) {
		i++;
	}

	const a = points[i];
	const b = points[Math.min( i + 1, points.length - 1 )];

	return Math.fround( a[1] + ( b[1] - a[1] ) * ( a === b ? 0 : ( p - a[0] ) / ( b[0] - a[0] ) ) );
}

/**
 * @exec helper
 * ================
 * Stance_Advance
 *
 * Advances stance transition timer by msec, applying mid-transition reversals (0x5176fa).
 * ================
 */
export function Stance_Advance(
	previous: stance_state_t | undefined,
	target: stance_height_t,
	msec: number
): stance_state_t {
	const s: stance_state_t = previous
		? { ...previous, target }
		: { target, height: STANCE_HEIGHT_STAND, from: STANCE_HEIGHT_STAND, to: STANCE_HEIGHT_STAND, elapsed: 0 };

	if ( s.from !== s.to ) {
		const duration = Stance_Duration( s.from, s.to );
		s.elapsed = Math.min( duration, s.elapsed + msec );
		s.height = Stance_Curve( s.from, s.to, ( s.elapsed * 100 ) / duration );

		if ( s.elapsed === duration ) {
			s.from = s.to;
			s.elapsed = 0;
		} else if ( ( target - s.to ) * ( s.to - s.from ) < 0 ) {
			const old = s.from;
			s.from = s.to;
			s.to = old;
			s.elapsed = Math.trunc( duration * ( 100 - Math.trunc( ( s.elapsed * 100 ) / duration ) ) * 0.01 );
			s.height = Stance_Curve( s.from, s.to, ( s.elapsed * 100 ) / duration );
		}
	}

	if ( s.from === s.to && s.to !== target ) {
		s.from = s.to;
		s.to = ( s.to === STANCE_HEIGHT_STAND || s.to === STANCE_HEIGHT_PRONE ) ? STANCE_HEIGHT_CROUCH : target;
		s.elapsed = 0;
	}

	return s;
}
