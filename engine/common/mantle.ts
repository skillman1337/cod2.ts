/*
===============================================================================

	mantle.ts

	Call of Duty 2 / id Tech Mantle & Ledge Climbing Physics
	Automated ledge detection, transition selection, authored delta curves,
	and kinematic player movement through mantle animations.
	Reconstructed from native routines 0x511ba0, 0x48ced0, 0x5124d0, 0x511dd0, 0x5128a0.

===============================================================================
*/

import { vec3_t, usercmd_t, IN_JUMP } from './types.js';
import { capsule_shape_t } from './collision_capsule.js';
import { Cvar_Get } from './cvar.js';
import curves from '@/assets/ui/mantle.json';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const SURF_MANTLE_MASK        = 0x06000000;
export const MANTLE_AUTHORED_HEIGHTS = [57, 51, 45, 39, 33, 27, 21] as const;
export const MANTLE_PROBE_HEIGHTS    = [60, 40, 20] as const;


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface mantle_state_t {
	yaw: number;
	elapsed: number;
	up: string;
	over: string | null;
	end: vec3_t;
	active: boolean;
	crouched: boolean;
}

interface Body {
	origin: vec3_t;
	angles: vec3_t;
	velocity: vec3_t;
}

interface Hit {
	fraction: number;
	normal: vec3_t;
	startsolid: boolean;
	allsolid: boolean;
	surfaceFlags: number;
}

export type mantle_trace_t = (
	start: vec3_t,
	end: vec3_t,
	shape: capsule_shape_t,
	mantle?: boolean
) => Hit;


// ---------------------------------------------------------------------------
// settings & vector math
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Setting
 *
 * Reads integer or floating-point cvar value with fallback default.
 * ================
 */
function Setting( name: string, value: number ): number {
	const text = Cvar_Get( name );
	return text === '' ? value : Number( text );
}

/**
 * @exec helper
 * ================
 * Add
 *
 * Scales vector b and adds to vector a (a + b * scale).
 * ================
 */
function Add( a: vec3_t, b: vec3_t, scale: number ): vec3_t {
	return a.map( ( v, i ) => Math.fround( v + b[i] * scale ) ) as vec3_t;
}


// ---------------------------------------------------------------------------
// mantle transition curves
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Mantle_Transition
 *
 * Finds nearest authored mantle height transition curve (0x511ba0).
 * Tests heights [57, 51, 45, 39, 33, 27, 21]. First nearest wins ties.
 * ================
 */
export function Mantle_Transition( height: number ): string {
	let best: number = MANTLE_AUTHORED_HEIGHTS[0];

	for ( const h of MANTLE_AUTHORED_HEIGHTS ) {
		if ( Math.abs( h - height ) < Math.abs( best - height ) ) {
			best = h;
		}
	}

	return 'up_' + best;
}

/**
 * @exec helper
 * ================
 * Curve
 *
 * Evaluates authored translation delta curve at given elapsed milliseconds (0x48ced0).
 * ================
 */
function Curve( name: string, time: number ): vec3_t {
	const c = curves[name as keyof typeof curves];
	const frame = Math.max( 0, Math.min( 1, time / c.duration ) ) * ( c.frames - 1 );

	let i = 0;

	while ( i + 1 < c.times.length && c.times[i + 1] <= frame ) {
		i++;
	}

	const j = Math.min( i + 1, c.times.length - 1 );
	const t = i === j ? 0 : ( frame - c.times[i] ) / ( c.times[j] - c.times[i] );

	return c.points[i].map( ( x, k ) => Math.fround( x + ( c.points[j][k] - x ) * t ) ) as vec3_t;
}

/**
 * @exec helper
 * ================
 * Mantle_Duration
 *
 * Returns total duration in milliseconds for the up (and optional over) mantle curves.
 * ================
 */
export function Mantle_Duration( m: mantle_state_t ): number {
	return (
		curves[m.up as keyof typeof curves].duration +
		( m.over ? curves[m.over as keyof typeof curves].duration : 0 )
	);
}

/**
 * @exec helper
 * ================
 * Mantle_Translation
 *
 * Computes world translation vector by rotating authored local animation deltas by mantle yaw (0x511a70).
 * ================
 */
export function Mantle_Translation( m: mantle_state_t, time: number ): vec3_t {
	const duration = curves[m.up as keyof typeof curves].duration;
	const up = Curve( m.up, Math.min( time, duration ) );

	const local = time > duration && m.over
		? Add( up, Curve( m.over, time - duration ), 1 )
		: up;

	const angle = ( m.yaw * Math.PI ) / 180;

	return [
		Math.fround( local[0] * Math.cos( angle ) - local[1] * Math.sin( angle ) ),
		Math.fround( local[0] * Math.sin( angle ) + local[1] * Math.cos( angle ) ),
		local[2],
	];
}


// ---------------------------------------------------------------------------
// ledge geometry detection
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Mantle_Check
 *
 * Scans environment ahead of player for climbable ledges and barriers (0x5124d0, 0x511f00, 0x511c90).
 * Checks surface flags (0x6000000 for mantleable / vaultable), approach angle, clearance,
 * and crouched/standing landing space.
 * ================
 */
export function Mantle_Check( body: Body, trace: mantle_trace_t ): mantle_state_t | null {
	if ( !Setting( 'mantle_enable', 1 ) ) {
		return null;
	}

	const yaw = ( body.angles[1] * Math.PI ) / 180;
	const forward: vec3_t = [Math.cos( yaw ), Math.sin( yaw ), 0];
	const foot: vec3_t = [body.origin[0], body.origin[1], body.origin[2] - 60];

	const radius = Setting( 'mantle_check_radius', 0.1 );
	const back = 15 - radius;
	const range = Setting( 'mantle_check_range', 20 );

	const surface = trace(
		Add( foot, forward, -back ),
		Add( foot, forward, back + range ),
		{ radius, half: 35 - radius, offset: 35 },
		true
	);

	if ( surface.startsolid || surface.allsolid || surface.fraction === 1 || !( surface.surfaceFlags & SURF_MANTLE_MASK ) ) {
		return null;
	}

	const length = Math.hypot( surface.normal[0], surface.normal[1] );

	if ( length < 0.0001 ) {
		return null;
	}

	const direction: vec3_t = [
		-surface.normal[0] / length,
		-surface.normal[1] / length,
		0,
	];

	const dot = forward[0] * direction[0] + forward[1] * direction[1];
	const angleDegrees = ( Math.acos( Math.max( -1, Math.min( 1, dot ) ) ) * 180 ) / Math.PI;

	if ( angleDegrees > Setting( 'mantle_check_angle', 60 ) ) {
		return null;
	}

	for ( const height of MANTLE_PROBE_HEIGHTS ) {
		const a: vec3_t = [foot[0], foot[1], foot[2] + height];
		const b = Add( a, direction, 16 );
		const sphere = { radius: 15, half: 0, offset: 15 };

		const across = trace( a, b, sphere );

		if ( across.startsolid || across.fraction < 1 ) {
			continue;
		}

		const down: vec3_t = [b[0], b[1], foot[2] + 18];
		const hit = trace( b, down, sphere );

		if ( hit.startsolid || hit.fraction === 1 || hit.normal[2] < Math.fround( 0.7 ) ) {
			continue;
		}

		const ledge = Add( b, [0, 0, down[2] - b[2]], hit.fraction );
		const crouch = { radius: 15, half: 10, offset: 25 };

		if ( trace( ledge, ledge, crouch ).startsolid ) {
			continue;
		}

		let end = [...ledge] as vec3_t;
		let over: string | null = null;
		const up = Mantle_Transition( ledge[2] - foot[2] );

		if ( surface.surfaceFlags & 0x4000000 ) {
			const beyond = Add( ledge, direction, 31 );
			const bottom: vec3_t = [beyond[0], beyond[1], beyond[2] - 18];
			const landing = trace( beyond, bottom, crouch );

			if ( !landing.startsolid && landing.fraction === 1 ) {
				end = bottom;
				const upHeight = Number( up.slice( 3 ) );
				over = upHeight >= 51 ? 'over_high' : upHeight >= 33 ? 'over_mid' : 'over_low';
			}
		}

		const standing = { radius: 15, half: 20, offset: 35 };

		return {
			yaw: ( Math.atan2( direction[1], direction[0] ) * 180 ) / Math.PI,
			elapsed: 0,
			up,
			over,
			end: [end[0], end[1], end[2] + 60],
			active: false,
			crouched: trace( ledge, ledge, standing ).startsolid || trace( end, end, standing ).startsolid,
		};
	}

	return null;
}


// ---------------------------------------------------------------------------
// movement integration
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Mantle_Move
 *
 * Advances kinematic mantle motion each frame (0x511dd0, 0x5128a0).
 * Updates origin along delta trajectory, computes instantaneous velocity,
 * and clamps view angle deviation within mantle_view_yawcap.
 * ================
 */
export function Mantle_Move(
	body: Body,
	m: mantle_state_t,
	cmd: usercmd_t,
	msec: number
): boolean {
	if ( !m.active ) {
		if ( !( cmd.buttons & IN_JUMP ) ) {
			return false;
		}

		m.active = true;
		body.origin = Add( m.end, Mantle_Translation( m, Mantle_Duration( m ) ), -1 );
	}

	const old = m.elapsed;
	const duration = Mantle_Duration( m );
	m.elapsed = Math.min( duration, old + msec );

	const delta = Add( Mantle_Translation( m, m.elapsed ), Mantle_Translation( m, old ), -1 );
	body.origin = Add( body.origin, delta, 1 );

	if ( m.elapsed > old ) {
		body.velocity = delta.map( ( x ) =>
			Math.fround( x / ( ( m.elapsed - old ) * Math.fround( 0.001 ) ) )
		) as vec3_t;
	}

	const difference = ( ( ( ( body.angles[1] - m.yaw + 540 ) % 360 ) + 360 ) % 360 ) - 180;
	const cap = Setting( 'mantle_view_yawcap', 60 );
	body.angles[1] = m.yaw + Math.max( -cap, Math.min( cap, difference ) );

	if ( m.elapsed === duration ) {
		m.active = false;
	}

	return true;
}
