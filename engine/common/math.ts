/*
===============================================================================

	math.ts

	Angle and vector helpers.  Quake lineage.

===============================================================================
*/

import { vec3_t } from './types.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const DEG2RAD = Math.PI / 180;


// ---------------------------------------------------------------------------
// forward
// AngleSinCos, AngleVectorsWriteAxes, AngleVectorsPickAxis
// AngleVectors, AngleVectorsSingle, VectorCopy
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// math
// ---------------------------------------------------------------------------

/**
 * ================
 * AngleSinCos
 *
 * Degrees -> sin/cos pair for one euler component.
 * ================
 */
function AngleSinCos( degrees: number ): { sin: number; cos: number } {
	let rad: number;

	rad = degrees * DEG2RAD;
	return { sin: Math.sin( rad ), cos: Math.cos( rad ) };
}


/**
 * ================
 * AngleVectorsWriteAxes
 *
 * Trig components -> forward, right, up unit axes.
 * ================
 */
function AngleVectorsWriteAxes(
	sy: number,
	cy: number,
	sp: number,
	cp: number,
	sr: number,
	cr: number,
	forward: vec3_t,
	right: vec3_t,
	up: vec3_t,
): void {
	forward[0] = cp * cy;
	forward[1] = cp * sy;
	forward[2] = -sp;

	right[0] = ( -1 * sr * sp * cy + -1 * cr * -sy );
	right[1] = ( -1 * sr * sp * sy + -1 * cr * cy );
	right[2] = -1 * sr * cp;

	up[0] = ( cr * sp * cy + -sr * -sy );
	up[1] = ( cr * sp * sy + -sr * cy );
	up[2] = cr * cp;
}


/**
 * ================
 * AngleVectorsPickAxis
 *
 * Select one axis from a full AngleVectors pass.
 * ================
 */
function AngleVectorsPickAxis(
	flags: 'forward' | 'right' | 'up',
	forward: vec3_t,
	right: vec3_t,
	up: vec3_t,
): vec3_t {
	if ( flags === 'forward' )
		return forward;

	if ( flags === 'right' )
		return right;

	return up;
}


/**
 * ================
 * AngleVectors
 *
 * angles[PITCH/YAW/ROLL] in degrees -> forward, right, up unit axes.
 * ================
 */
export function AngleVectors(
	angles: vec3_t,
	forward: vec3_t,
	right: vec3_t,
	up: vec3_t,
): void {
	let yaw: { sin: number; cos: number };
	let pitch: { sin: number; cos: number };
	let roll: { sin: number; cos: number };

	yaw = AngleSinCos( angles[1] );
	pitch = AngleSinCos( angles[0] );
	roll = AngleSinCos( angles[2] );

	AngleVectorsWriteAxes(
		yaw.sin, yaw.cos,
		pitch.sin, pitch.cos,
		roll.sin, roll.cos,
		forward, right, up,
	);
}


/**
 * ================
 * AngleVectorsSingle
 *
 * Fill one axis from viewangles.  Used when only forward/right/up is needed.
 * ================
 */
function AngleVectorsSingle(
	angles: vec3_t,
	axis: vec3_t,
	flags: 'forward' | 'right' | 'up',
): void {
	let forward: vec3_t;
	let right: vec3_t;
	let up: vec3_t;
	let src: vec3_t;

	forward = [ 0, 0, 0 ];
	right = [ 0, 0, 0 ];
	up = [ 0, 0, 0 ];
	AngleVectors( angles, forward, right, up );

	src = AngleVectorsPickAxis( flags, forward, right, up );
	VectorCopy( src, axis );
}


/**
 * ================
 * VectorCopy
 * ================
 */
function VectorCopy( src: vec3_t, dst: vec3_t ): void {
	dst[0] = src[0];
	dst[1] = src[1];
	dst[2] = src[2];
}


/**
 * @exec per-frame
 * ================
 * VectorLength
 *
 * Euclidean length of a vec3.
 * ================
 */
export function VectorLength( v: vec3_t ): number {
	return Math.sqrt( v[0] * v[0] + v[1] * v[1] + v[2] * v[2] );
}


/**
 * @exec per-frame
 * ================
 * VectorScale
 *
 * Scale vec3 in place.
 * ================
 */
export function VectorScale( v: vec3_t, scale: number ): void {
	v[0] *= scale;
	v[1] *= scale;
	v[2] *= scale;
}
