/*
===============================================================================

	ladder.ts

	Call of Duty 2 / id Tech Ladder Movement Simulation
	Ladder surface detection, wish direction calculation, climbing acceleration,
	adhesion braking, and dismount jumping.
	Reconstructed from native routines 0x519f90, 0x51a2fd, 0x5156f6, 0x52fe40.

===============================================================================
*/

import type { vec3_t, pm_movement_t } from './types.js';
import type { capsule_shape_t } from './collision_capsule.js';
import type { pm_trace_t } from './pm.js';
import {
	STANCE_HEIGHT_PRONE,
	STANCE_HEIGHT_CROUCH,
	STANCE_TOP_CROUCH,
	STANCE_TOP_STAND,
} from './stance.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const SURF_LADDER            = 8;
export const LADDER_REACH_GROUNDED  = 8;
export const LADDER_REACH_AIR       = 30;
export const LADDER_JUMP_LOCKOUT_MS = 300;


// ---------------------------------------------------------------------------
// vector math helper
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Ladder_Normalize
 *
 * Normalizes a 3D vector using single-precision Math.fround.
 * Returns zero vector if length is zero.
 * ================
 */
function Ladder_Normalize( v: vec3_t ): vec3_t {
	const length = Math.hypot( ...v );

	if ( !length ) {
		return [0, 0, 0];
	}

	return v.map( ( x ) => Math.fround( x / length ) ) as vec3_t;
}


// ---------------------------------------------------------------------------
// ladder detection
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Ladder_Check
 *
 * Checks for ladder collision surfaces ahead of player (0x519f90).
 * Tests reduced capsule bounds, reach distances (8 when grounded, 30 airborne),
 * and requires SURF_LADDER (surfaceFlags & 8).
 * ================
 */
export function Ladder_Check(
	move: pm_movement_t,
	origin: vec3_t,
	forward: vec3_t,
	forwardmove: number,
	grounded: boolean,
	stance: 11 | 40 | 60,
	trace: ( a: vec3_t, b: vec3_t, shape: capsule_shape_t ) => pm_trace_t
): void {
	if ( grounded ) {
		move.ladderDetached = false;
	}

	const old = move.ladder;

	if ( move.ladderDetached || stance === STANCE_HEIGHT_PRONE || move.commandTime - move.jumpTime < LADDER_JUMP_LOCKOUT_MS ) {
		if ( old ) {
			move.ladderDetached = true;
		}
		move.ladder = undefined;
		return;
	}

	const reach = grounded ? LADDER_REACH_GROUNDED : LADDER_REACH_AIR;
	const top = stance === STANCE_HEIGHT_CROUCH ? STANCE_TOP_CROUCH : STANCE_TOP_STAND;
	const shape = {
		radius: 9,
		half: ( top - 8 ) / 2 - 9,
		offset: ( top + 8 ) / 2 - 60,
	};

	const direction = old && !grounded
		? ( old.normal.map( ( x ) => -x ) as vec3_t )
		: Ladder_Normalize( [forward[0], forward[1], 0] );

	const probe = ( dir: vec3_t ) =>
		trace( origin, origin.map( ( x, i ) => Math.fround( x + reach * dir[i] ) ) as vec3_t, shape );

	const first = probe( direction );

	if ( first.fraction < 1 && ( first.surfaceFlags & SURF_LADDER ) && ( !grounded || forwardmove > 0 ) ) {
		if ( old ) {
			move.ladder = { ...old };
			return;
		}

		const normal = [...first.normal] as vec3_t;
		const second = probe( normal.map( ( x ) => -x ) as vec3_t );

		if ( second.fraction < 1 && ( second.surfaceFlags & SURF_LADDER ) ) {
			move.ladder = { normal, surfaceFlags: second.surfaceFlags };
			return;
		}
	}

	if ( old ) {
		move.ladderDetached = true;
	}

	move.ladder = undefined;
}


// ---------------------------------------------------------------------------
// wish direction & climbing dynamics
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Ladder_Wish
 *
 * Computes desired climbing direction along ladder plane and perpendicular lateral vector (0x51a2fd..0x51a475).
 * Pitching camera up or down steers climbing velocity vertically.
 * ================
 */
export function Ladder_Wish(
	forward: vec3_t,
	right: vec3_t,
	normal: vec3_t,
	fm: number,
	rm: number,
	speed: number,
	slow: boolean
): { wish: vec3_t; side: vec3_t } {
	const pitch = Math.max( -1, Math.min( 1, Math.fround( ( forward[2] + 0.25 ) * 2.5 ) ) );
	const flat = Ladder_Normalize( [right[0], right[1], 0] );
	const dot = -( flat[0] * normal[0] + flat[1] * normal[1] + flat[2] * normal[2] );
	const side = flat.map( ( x, i ) => Math.fround( x + dot * normal[i] ) ) as vec3_t;

	const length = Math.hypot( fm, rm );
	const scale = Math.fround(
		length
			? ( ( Math.trunc( speed ) * Math.max( Math.abs( fm ), Math.abs( rm ) ) ) / ( 127 * length ) ) *
				( slow ? Math.fround( 0.4 ) : 1 )
			: 0
	);

	const lateral = Math.fround( rm * scale * Math.fround( 0.2 ) );
	const vertical = Math.fround( fm * scale * pitch * 0.5 );

	return {
		side,
		wish: side.map( ( x, i ) => Math.fround( lateral * x + ( i === 2 ? vertical : 0 ) ) ) as vec3_t,
	};
}


// ---------------------------------------------------------------------------
// ladder friction & velocity
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Ladder_Velocity
 *
 * Applies ladder acceleration (0x5156f6) and release braking/adhesion (0x51a47e..0x51a696).
 * ================
 */
export function Ladder_Velocity(
	velocity: vec3_t,
	wish: vec3_t,
	side: vec3_t,
	normal: vec3_t,
	fm: number,
	rm: number,
	dt: number,
	gravity: number,
	grounded: boolean
): vec3_t {
	const v = [...velocity] as vec3_t;
	const delta = wish.map( ( x, i ) => Math.fround( x - v[i] ) ) as vec3_t;
	const distance = Math.fround( Math.hypot( ...delta ) );
	const direction = Ladder_Normalize( delta );
	const amount = Math.min( distance, Math.fround( Math.hypot( ...wish ) ) * dt * 9 );

	for ( let i = 0; i < 3; i++ ) {
		v[i] = Math.fround( v[i] + direction[i] * amount );
	}

	if ( !fm ) {
		v[2] = v[2] > 0
			? Math.max( 0, Math.fround( v[2] - gravity * dt ) )
			: Math.min( 0, Math.fround( v[2] + gravity * dt ) );
	}

	if ( !rm ) {
		const tangent = Ladder_Normalize( [side[0], side[1], 0] );
		const along = Math.fround( v[0] * tangent[0] + v[1] * tangent[1] );

		if ( along ) {
			for ( let i = 0; i < 2; i++ ) {
				v[i] = Math.fround( v[i] - along * tangent[i] );
			}

			let drop = Math.fround( along * dt * 16 );

			if ( Math.abs( along ) > Math.abs( drop ) ) {
				if ( Math.abs( drop ) < 1 ) {
					drop = Math.sign( drop );
				}

				const left = Math.fround( along - drop );

				for ( let i = 0; i < 2; i++ ) {
					v[i] = Math.fround( v[i] + left * tangent[i] );
				}
			}
		}
	}

	if ( !grounded ) {
		const into = Math.fround( -( v[0] * normal[0] + v[1] * normal[1] ) );

		for ( let i = 0; i < 2; i++ ) {
			v[i] = Math.fround( v[i] + into * normal[i] );
		}

		if ( v[2] * v[2] >= v[0] * v[0] + v[1] * v[1] ) {
			for ( let i = 0; i < 2; i++ ) {
				v[i] = Math.fround( v[i] - normal[i] * 50 );
			}
		}
	}

	return v;
}


// ---------------------------------------------------------------------------
// ladder dismount jump
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Ladder_Jump
 *
 * Imparts reduced vertical impulse and pushes player away from ladder face on jump (0x52fe40).
 * ================
 */
export function Ladder_Jump(
	velocity: vec3_t,
	forward: vec3_t,
	normal: vec3_t,
	push: number
): vec3_t {
	let direction = Ladder_Normalize( [forward[0], forward[1], 0] );

	if ( forward[0] * normal[0] + forward[1] * normal[1] + forward[2] * normal[2] < 0 ) {
		const dot = direction[0] * normal[0] + direction[1] * normal[1] + direction[2] * normal[2];
		direction = Ladder_Normalize( direction.map( ( x, i ) => Math.fround( x - 2 * dot * normal[i] ) ) as vec3_t );
	}

	return [
		Math.fround( direction[0] * push ),
		Math.fround( direction[1] * push ),
		Math.fround( velocity[2] * 0.75 ),
	];
}
