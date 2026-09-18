/*
===============================================================================

	lightgrid.ts

	Call of Duty 2 / id Tech Volumetric LightGrid Sampler
	Trilinear interpolation of 32x32x64 spatial light probes, Morton spatial keys,
	visibility ray occlusion tests, and predecessor fallback lookup.
	Reconstructed from native renderer routines 0x10036460, 0x10036850, 0x100367d0.

===============================================================================
*/

import type { vec3_t } from './types.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const LIGHTGRID_WORLD_OFFSET = 131072;
export const LIGHTGRID_STEP_XY      = 32;
export const LIGHTGRID_STEP_Z       = 64;
export const LIGHTGRID_CORNER_COUNT = 8;


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface lightgrid_t {
	rows: number[][];
	colors: number[][];
}


// ---------------------------------------------------------------------------
// row binary search
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * LightGrid_Row
 *
 * Binary searches sorted lightgrid rows for 3D coordinate probe (0x10036460).
 * Uses Morton-like low coordinate bits and packed spatial hash keys.
 * Supports finding predecessor row when probe coordinate is unallocated.
 * ================
 */
export function LightGrid_Row(
	grid: lightgrid_t,
	x: number,
	y: number,
	z: number,
	predecessor: boolean = false
): number[] | undefined {
	const key = ( ( ( ( ( ( x & ~3 ) << 11 ) | y ) & ~3 ) << 8 ) | ( z >> 2 ) ) >>> 0;
	const low = ( ( ( ( ( x << 2 ) | ( y & 3 ) ) << 2 ) | ( z & 3 ) ) << 2 ) & 255;

	let first = 0;
	let last = grid.rows.length - 1;

	while ( first <= last ) {
		const mid = ( first + last ) >> 1;
		const row = grid.rows[mid];
		const delta = ( row[0] - key ) | 0;
		const compare = delta || ( ( row[1] - low ) & ~1 );

		if ( !compare ) {
			return row;
		}

		if ( compare < 0 ) {
			first = mid + 1;
		} else {
			last = mid - 1;
		}
	}

	if ( predecessor ) {
		return grid.rows[Math.max( 0, last )];
	}
}


// ---------------------------------------------------------------------------
// trilinear sampling & occlusion testing
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * LightGrid_Sample
 *
 * Trilinearly samples 8 surrounding probe corners for a given world position (0x10036850).
 * Tests line of sight visibility against occluded corner flags before accumulating color.
 * Normalizes weighted corner colors or falls back to predecessor probe (0x100367d0).
 * ================
 */
export function LightGrid_Sample(
	grid: lightgrid_t,
	position: vec3_t,
	visible: ( a: vec3_t, b: vec3_t ) => boolean
): number[][] {
	const coordinate = position.map( ( v, i ) => ( v + LIGHTGRID_WORLD_OFFSET ) / ( i === 2 ? LIGHTGRID_STEP_Z : LIGHTGRID_STEP_XY ) );
	const base = coordinate.map( Math.floor );
	const fraction = coordinate.map( ( v, i ) => v - base[i] );

	const result = Array.from( { length: LIGHTGRID_CORNER_COUNT }, () => [0, 0, 0, 0] );
	let weight = 0;

	for ( let index = 0; index < LIGHTGRID_CORNER_COUNT; index++ ) {
		const bits = [index & 1, ( index >> 1 ) & 1, ( index >> 2 ) & 1];
		const point = base.map( ( v, i ) => v + bits[i] );
		const row = LightGrid_Row( grid, ...( point as [number, number, number] ) );

		if ( !row ) {
			continue;
		}

		const origin = point.map( ( v, i ) => v * ( i === 2 ? LIGHTGRID_STEP_Z : LIGHTGRID_STEP_XY ) - LIGHTGRID_WORLD_OFFSET ) as vec3_t;

		if ( row[2] & ( 1 << index ) ) {
			const delta = position.map( ( v, i ) => v - origin[i] );
			const length = Math.hypot( ...delta ) || 1;
			const end = origin.map( ( v, i ) => v + ( delta[i] / length ) * 0.01 ) as vec3_t;

			if ( !visible( position, end ) ) {
				continue;
			}
		}

		const w = bits.reduce( ( v, b, i ) => v * ( b ? fraction[i] : 1 - fraction[i] ), 1 );
		const color = grid.colors[row[3]];
		weight += w;

		for ( let i = 0; i < LIGHTGRID_CORNER_COUNT; i++ ) {
			for ( let c = 0; c < 3; c++ ) {
				result[i][c] += ( w * color[c * LIGHTGRID_CORNER_COUNT + i] ) / 255;
			}
			result[i][3] += w * ( row[1] & 1 );
		}
	}

	if ( weight > 0 ) {
		if ( weight < Math.fround( 0.98 ) ) {
			for ( const sample of result ) {
				for ( let c = 0; c < 4; c++ ) {
					sample[c] /= weight;
				}
			}
		}
		return result;
	}

	// 0x100367d0 deliberately consumes the binary search predecessor at the rounded coordinate.
	const point = base.map( ( v, i ) => v + ( fraction[i] > 0.5 ? 1 : 0 ) );
	const best = LightGrid_Row( grid, ...( point as [number, number, number] ), true );

	if ( best ) {
		const color = grid.colors[best[3]];
		return result.map( ( _, i ) => [
			color[i] / 255,
			color[8 + i] / 255,
			color[16 + i] / 255,
			best[1] & 1,
		] );
	}

	return result;
}
