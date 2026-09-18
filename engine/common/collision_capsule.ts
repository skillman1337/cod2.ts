/*
===============================================================================

	collision_capsule.ts

	Call of Duty 2 / id Tech Swept Capsule Collision Detector
	Continuous convex distance sweep against arbitrary polygon triangles.
	Reconstructed from native capsule routines 0x41d240..0x41d272.

===============================================================================
*/

import { vec3_t } from './types.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const DEFAULT_CAPSULE_RADIUS = 15;
export const DEFAULT_CAPSULE_HALF   = 20;
export const DEFAULT_CAPSULE_OFFSET = -25;

export const STANDING_CAPSULE: capsule_shape_t = {
	radius: DEFAULT_CAPSULE_RADIUS,
	half: DEFAULT_CAPSULE_HALF,
	offset: DEFAULT_CAPSULE_OFFSET,
};


// ---------------------------------------------------------------------------
// types & vector math primitives
// ---------------------------------------------------------------------------

type Pair = {
	a: vec3_t;
	b: vec3_t;
	distance: number;
};

export interface capsule_shape_t {
	radius: number;
	half: number;
	offset: number;
}

/**
 * @exec helper
 * ================
 * Dot
 *
 * Vector 3D dot product.
 * ================
 */
function Dot( a: vec3_t, b: vec3_t ): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * @exec helper
 * ================
 * Sub
 *
 * Vector 3D subtraction (a - b).
 * ================
 */
function Sub( a: vec3_t, b: vec3_t ): vec3_t {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * @exec helper
 * ================
 * Along
 *
 * Vector 3D linear extrapolation (a + b * t).
 * ================
 */
function Along( a: vec3_t, b: vec3_t, t: number ): vec3_t {
	return a.map( ( x, i ) => x + b[i] * t ) as vec3_t;
}


// ---------------------------------------------------------------------------
// geometric distance queries
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * TrianglePoint
 *
 * Calculates the closest point on a closed triangle, testing vertex Voronoi regions,
 * edge Voronoi regions, and face interior.
 * ================
 */
function TrianglePoint( p: vec3_t, a: vec3_t, b: vec3_t, c: vec3_t ): vec3_t {
	const ab = Sub( b, a );
	const ac = Sub( c, a );
	const ap = Sub( p, a );
	const d1 = Dot( ab, ap );
	const d2 = Dot( ac, ap );

	if ( d1 <= 0 && d2 <= 0 ) {
		return a;
	}

	const bp = Sub( p, b );
	const d3 = Dot( ab, bp );
	const d4 = Dot( ac, bp );

	if ( d3 >= 0 && d4 <= d3 ) {
		return b;
	}

	const vc = d1 * d4 - d3 * d2;

	if ( vc <= 0 && d1 >= 0 && d3 <= 0 ) {
		return Along( a, ab, d1 / ( d1 - d3 ) );
	}

	const cp = Sub( p, c );
	const d5 = Dot( ab, cp );
	const d6 = Dot( ac, cp );

	if ( d6 >= 0 && d5 <= d6 ) {
		return c;
	}

	const vb = d5 * d2 - d1 * d6;

	if ( vb <= 0 && d2 >= 0 && d6 <= 0 ) {
		return Along( a, ac, d2 / ( d2 - d6 ) );
	}

	const va = d3 * d6 - d5 * d4;

	if ( va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0 ) {
		return Along( b, Sub( c, b ), ( d4 - d3 ) / ( d4 - d3 + d5 - d6 ) );
	}

	const total = va + vb + vc;

	if ( Math.abs( total ) < 1e-20 ) {
		return a;
	}

	return Along( Along( a, ab, vb / total ), ac, vc / total );
}

/**
 * @exec helper
 * ================
 * Segments
 *
 * Finds the closest points between two finite line segments (p -> q) and (r -> s).
 * ================
 */
function Segments( p: vec3_t, q: vec3_t, r: vec3_t, s: vec3_t ): Pair {
	const d1 = Sub( q, p );
	const d2 = Sub( s, r );
	const v = Sub( p, r );
	const a = Dot( d1, d1 );
	const e = Dot( d2, d2 );
	const b = Dot( d1, d2 );
	const c = Dot( d1, v );
	const f = Dot( d2, v );
	const denom = a * e - b * b;

	let x = a > 1e-12
		? ( e > 1e-12 && denom > 1e-12
			? Math.max( 0, Math.min( 1, ( b * f - c * e ) / denom ) )
			: Math.max( 0, Math.min( 1, -c / a ) ) )
		: 0;

	let y = e > 1e-12 ? ( b * x + f ) / e : 0;

	if ( y < 0 ) {
		y = 0;
		x = a ? Math.max( 0, Math.min( 1, -c / a ) ) : 0;
	} else if ( y > 1 ) {
		y = 1;
		x = a ? Math.max( 0, Math.min( 1, ( b - c ) / a ) ) : 0;
	}

	const first = Along( p, d1, x );
	const second = Along( r, d2, y );

	return {
		a: first,
		b: second,
		distance: Math.hypot( ...Sub( first, second ) ),
	};
}


// ---------------------------------------------------------------------------
// capsule distance solver
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * CapsuleDistance
 *
 * Solves minimum separation between vertical cylinder capsule core and triangle.
 * 0x41d240..0x41d272: radius = 15; axis half-length = 20, centered 25 below eye.
 * ================
 */
function CapsuleDistance(
	eye: vec3_t,
	triangle: vec3_t[],
	normal: vec3_t,
	shape: capsule_shape_t
): Pair {
	const p: vec3_t = [
		eye[0],
		eye[1],
		eye[2] + shape.offset - shape.half,
	];

	const q: vec3_t = [
		eye[0],
		eye[1],
		eye[2] + shape.offset + shape.half,
	];

	let b = TrianglePoint( p, ...( triangle as [vec3_t, vec3_t, vec3_t] ) );
	let best: Pair = {
		a: p,
		b,
		distance: Math.hypot( ...Sub( p, b ) ),
	};

	b = TrianglePoint( q, ...( triangle as [vec3_t, vec3_t, vec3_t] ) );
	const distance = Math.hypot( ...Sub( q, b ) );

	if ( distance < best.distance ) {
		best = { a: q, b, distance };
	}

	const denom = 2 * shape.half * normal[2];

	if ( Math.abs( denom ) > 1e-12 ) {
		const t = Dot( Sub( triangle[0], p ), normal ) / denom;

		if ( t >= 0 && t <= 1 ) {
			const point: vec3_t = [p[0], p[1], p[2] + 2 * shape.half * t];
			const face = TrianglePoint( point, ...( triangle as [vec3_t, vec3_t, vec3_t] ) );

			if ( Math.hypot( ...Sub( point, face ) ) < 1e-6 ) {
				return { a: point, b: face, distance: 0 };
			}
		}
	}

	for ( let i = 0; i < 3; i++ ) {
		const pair = Segments( p, q, triangle[i], triangle[( i + 1 ) % 3] );

		if ( pair.distance < best.distance ) {
			best = pair;
		}
	}

	return best;
}


// ---------------------------------------------------------------------------
// continuous swept capsule trace
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Capsule_TraceTriangle
 *
 * Performs continuous convex distance sweep of capsule along path start -> end.
 * Conservative advancement with distance tolerance and separating plane culling.
 * ================
 */
export function Capsule_TraceTriangle(
	start: vec3_t,
	end: vec3_t,
	triangle: vec3_t[],
	face: vec3_t,
	shape: capsule_shape_t = STANDING_CAPSULE
): { fraction: number; normal: vec3_t; startsolid: boolean; allsolid: boolean } | null {
	// A separating face plane excludes the entire capsule, including rounded
	// edges. In particular, parallel motion tangent to a floor must not become
	// an edge impact through conservative advancement's distance tolerance.
	const plane = Dot( triangle[0], face );
	const extent = shape.half * Math.abs( face[2] ) + shape.radius + 0.125;
	const startSide = Dot( [start[0], start[1], start[2] + shape.offset], face ) - plane;
	const endSide = Dot( [end[0], end[1], end[2] + shape.offset], face ) - plane;

	if ( ( startSide >= extent && endSide >= extent ) || ( startSide <= -extent && endSide <= -extent ) ) {
		return null;
	}

	const delta = Sub( end, start );
	let fraction = 0;
	let pair = CapsuleDistance( start, triangle, face, shape );
	const startsolid = pair.distance < shape.radius - 1e-5;

	if ( startsolid ) {
		const allsolid = CapsuleDistance( end, triangle, face, shape ).distance < shape.radius - 1e-5;
		return {
			fraction: allsolid ? 0 : 1,
			normal: [...face],
			startsolid,
			allsolid,
		};
	}

	for ( let iteration = 0; iteration < 32; iteration++ ) {
		const normal = pair.distance > 1e-9
			? ( Sub( pair.a, pair.b ).map( ( x ) => x / pair.distance ) as vec3_t )
			: ( [...face] as vec3_t );

		const closing = -Dot( delta, normal );

		if ( closing <= 1e-10 ) {
			return null;
		}

		const separation = pair.distance - shape.radius - 0.125;

		if ( separation <= 1e-5 ) {
			return {
				fraction,
				normal,
				startsolid: false,
				allsolid: false,
			};
		}

		fraction += separation / closing;

		if ( fraction > 1 ) {
			return null;
		}

		pair = CapsuleDistance( Along( start, delta, fraction ), triangle, face, shape );
	}

	return null;
}
