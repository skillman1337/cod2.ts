/*
===============================================================================

	retail-bsp.ts

	Call of Duty 2 / id Tech IBSP v4 Map Parser
	Parses world geometry, collision brushes, terrain prisms, lightmaps,
	and 3D volumetric lightgrid records from IBSP version 4 binaries.

===============================================================================
*/

import { concatByteArrays, readCString } from './retail-constants.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const IBSP_MAGIC_0 = 0x49; // 'I'
export const IBSP_MAGIC_1 = 0x42; // 'B'
export const IBSP_MAGIC_2 = 0x53; // 'S'
export const IBSP_MAGIC_3 = 0x50; // 'P'
export const IBSP_VERSION = 4;

export const LUMP_MATERIALS        = 0;
export const LUMP_LIGHTMAPS        = 1;
export const LUMP_LIGHTGRID_PTS    = 2;
export const LUMP_LIGHTGRID_COLORS = 3;
export const LUMP_PLANES           = 4;
export const LUMP_BRUSHSIDES       = 5;
export const LUMP_BRUSHES          = 6;
export const LUMP_VERTEX_SOUPS     = 7;
export const LUMP_VERTICES         = 8;
export const LUMP_INDICES          = 9;
export const LUMP_AABB_TREES       = 29;
export const LUMP_COLLISION_VERTS  = 29;
export const LUMP_COLLISION_SURFS  = 31;
export const LUMP_COLLISION_TRIS   = 31;
export const LUMP_PRIMARY_LIGHTS   = 33;
export const LUMP_COLLISION_PARTS  = 33;
export const LUMP_LIGHT_GRID       = 34;
export const LUMP_COLLISION_NODES  = 34;
export const LUMP_MODELS           = 35;
export const LUMP_ENTITIES         = 37;

export const MATERIAL_ENTRY_SIZE   = 72;
export const MATERIAL_NAME_LENGTH  = 64;
export const LIGHTGRID_ROW_STRIDE   = 8;
export const LIGHTGRID_COLOR_STRIDE = 24;
export const LIGHTGRID_WORLD_OFFSET = 131072;
export const LIGHTGRID_STEP_XY      = 32;
export const LIGHTGRID_STEP_Z       = 64;
export const LIGHTGRID_CORNER_COUNT = 8;
export const PLANE_STRIDE          = 16;
export const BRUSH_STRIDE          = 4;
export const DRAW_SOUP_STRIDE      = 16;
export const VERTEX_INPUT_STRIDE   = 68;
export const VERTEX_OUTPUT_STRIDE  = 72;
export const SKY_MATERIAL_FLAG     = 0x80000000;

export const MODEL_DRAW_FIRST_OFFSET  = 24;
export const MODEL_DRAW_COUNT_OFFSET  = 28;
export const MODEL_BRUSH_FIRST_OFFSET = 40;
export const MODEL_BRUSH_COUNT_OFFSET = 44;


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface BspLump {
	offset: number;
	size: number;
}

export interface BspDrawCall {
	start: number;
	count: number;
	state: Record<string, any>;
}

export interface CollisionBrush {
	bounds: number[];
	planes: number[][];
	contents: number;
	surfaceFlags: number[];
	triangle?: number[][];
}

export interface LightGridData {
	rows: number[][];
	colors: number[][];
}


// ---------------------------------------------------------------------------
// lightgrid 3d sampling & interpolation
// ---------------------------------------------------------------------------

/*
====================
sampleLightGridRow

Performs a binary search over spatial lightgrid row hash keys.
Optionally returns the nearest predecessor row if exact coordinate is missing.
====================
*/
export function sampleLightGridRow(
	grid: LightGridData,
	x: number,
	y: number,
	z: number,
	predecessor: boolean = false
): number[] | undefined {
	const key = ( ( ( ( ( ( x & ~3 ) << 11 | y ) & ~3 ) << 8 | z >> 2 ) >>> 0 ) );
	const low = ( ( ( x << 2 | y & 3 ) << 2 | z & 3 ) << 2 ) & 255;

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

/*
====================
sampleLightGrid

Trilinearly interpolates 8-sample spherical ambient harmonics from the lightgrid
at world-space position [x, y, z], respecting line-of-sight visibility occlusion.
====================
*/
export function sampleLightGrid(
	grid: LightGridData,
	position: [number, number, number],
	visible?: ( a: [number, number, number], b: [number, number, number] ) => boolean
): number[][] {
	const coordinate = position.map( ( v, i ) => ( v + LIGHTGRID_WORLD_OFFSET ) / ( i === 2 ? LIGHTGRID_STEP_Z : LIGHTGRID_STEP_XY ) );
	const base = coordinate.map( Math.floor );
	const fraction = coordinate.map( ( v, i ) => v - base[i] );
	const result: number[][] = Array.from( { length: LIGHTGRID_CORNER_COUNT }, () => [0, 0, 0, 0] );
	let weight = 0;

	for ( let index = 0; index < LIGHTGRID_CORNER_COUNT; index++ ) {
		const bits = [index & 1, ( index >> 1 ) & 1, ( index >> 2 ) & 1];
		const point = [base[0] + bits[0], base[1] + bits[1], base[2] + bits[2]] as [number, number, number];
		const row = sampleLightGridRow( grid, point[0], point[1], point[2] );

		if ( !row ) {
			continue;
		}

		const origin: [number, number, number] = [
			point[0] * LIGHTGRID_STEP_XY - LIGHTGRID_WORLD_OFFSET,
			point[1] * LIGHTGRID_STEP_XY - LIGHTGRID_WORLD_OFFSET,
			point[2] * LIGHTGRID_STEP_Z - LIGHTGRID_WORLD_OFFSET,
		];

		if ( row[2] & ( 1 << index ) ) {
			if ( visible ) {
				const delta = [position[0] - origin[0], position[1] - origin[1], position[2] - origin[2]];
				const length = Math.hypot( ...delta ) || 1;

				const end: [number, number, number] = [
					origin[0] + ( delta[0] / length ) * 0.01,
					origin[1] + ( delta[1] / length ) * 0.01,
					origin[2] + ( delta[2] / length ) * 0.01,
				];

				if ( !visible( position, end ) ) {
					continue;
				}
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

	const point: [number, number, number] = [
		base[0] + ( fraction[0] > 0.5 ? 1 : 0 ),
		base[1] + ( fraction[1] > 0.5 ? 1 : 0 ),
		base[2] + ( fraction[2] > 0.5 ? 1 : 0 ),
	];

	const best = sampleLightGridRow( grid, point[0], point[1], point[2], true );

	if ( best ) {
		const color = grid.colors[best[3]];
		return result.map( ( _, i ) => [
			color[i] / 255,
			color[8 + i] / 255,
			color[16 + i] / 255,
			best![1] & 1,
		] );
	}

	return result;
}


// ---------------------------------------------------------------------------
// bsp binary lump parser
// ---------------------------------------------------------------------------

/*
====================
BspParser

Loads Call of Duty 2 IBSP version 4 binaries, providing lump extraction,
brush and terrain collision parsing, and world GPU mesh building.
====================
*/
export class BspParser {
	private data: Uint8Array;
	private view: DataView;

	constructor( data: Uint8Array ) {
		if (
			data.length < 8 ||
			data[0] !== IBSP_MAGIC_0 ||
			data[1] !== IBSP_MAGIC_1 ||
			data[2] !== IBSP_MAGIC_2 ||
			data[3] !== IBSP_MAGIC_3
		) {
			throw new Error( 'Not an IBSP file' );
		}

		const version = new DataView( data.buffer, data.byteOffset, data.byteLength ).getUint32( 4, true );

		if ( version !== IBSP_VERSION ) {
			throw new Error( `Unsupported BSP version ${version}; expected ${IBSP_VERSION}` );
		}

		this.data = data;
		this.view = new DataView( data.buffer, data.byteOffset, data.byteLength );
	}

	/*
	====================
	getLump

	Extracts the raw byte slice for a specified BSP lump index.
	====================
	*/
	getLump( index: number ): Uint8Array {
		if ( !Number.isInteger( index ) || index < 0 || 8 + ( index + 1 ) * 8 > this.data.byteLength ) throw new Error( 'Invalid BSP lump table.' );
		const offset = this.view.getUint32( 8 + index * 8 + 4, true );
		const size = this.view.getUint32( 8 + index * 8, true );

		if ( offset + size > this.data.byteLength ) throw new Error( `Truncated BSP lump ${index}.` );
		return this.data.subarray( offset, offset + size );
	}

	/*
	====================
	parseMaterials

	Decodes 64-character ASCII material shader name strings from Lump 0.
	====================
	*/
	parseMaterials(): string[] {
		const raw = this.getLump( LUMP_MATERIALS );
		const decoder = new TextDecoder( 'ascii' );
		const materials: string[] = [];
		const count = Math.floor( raw.length / MATERIAL_ENTRY_SIZE );

		for ( let i = 0; i < count; i++ ) {
			const slice = raw.subarray( i * MATERIAL_ENTRY_SIZE, i * MATERIAL_ENTRY_SIZE + MATERIAL_NAME_LENGTH );
			materials.push( readCString( slice, 0, decoder ).text );
		}

		return materials;
	}

	/*
	====================
	parseEntities

	Parses key-value entity definition strings from Lump 37 into structured dictionaries.
	====================
	*/
	parseEntities(): Record<string, string>[] {
		const raw = this.getLump( LUMP_ENTITIES );
		const text = new TextDecoder( 'ascii' ).decode( raw );
		const entities: Record<string, string>[] = [];
		const blockRegex = /\{([^}]*)\}/g;
		let blockMatch;

		while ( ( blockMatch = blockRegex.exec( text ) ) !== null ) {
			const block = blockMatch[1];
			const entry: Record<string, string> = {};
			const pairRegex = /"([^"\n]+)"\s+"([^"\n]*)"/g;
			let pairMatch;

			while ( ( pairMatch = pairRegex.exec( block ) ) !== null ) {
				entry[pairMatch[1]] = pairMatch[2];
			}

			if ( Object.keys( entry ).length > 0 ) {
				entities.push( entry );
			}
		}

		return entities;
	}

	/*
	====================
	parseLightgrid

	Extracts lightgrid coordinate spatial rows (Lump 2) and 24-byte ambient harmonic colors (Lump 3).
	====================
	*/
	parseLightgrid(): { rows: number[][]; colors: number[][] } {
		const lump2 = this.getLump( LUMP_LIGHTGRID_PTS );
		const view2 = new DataView( lump2.buffer, lump2.byteOffset, lump2.byteLength );
		const rowCount = Math.floor( lump2.length / LIGHTGRID_ROW_STRIDE );
		const rows: number[][] = [];

		for ( let i = 0; i < rowCount; i++ ) {
			rows.push( [
				view2.getUint32( i * 8, true ),
				view2.getUint8( i * 8 + 4 ),
				view2.getUint8( i * 8 + 5 ),
				view2.getUint16( i * 8 + 6, true ),
			] );
		}

		const lump3 = this.getLump( LUMP_LIGHTGRID_COLORS );
		const colorCount = Math.floor( lump3.length / LIGHTGRID_COLOR_STRIDE );
		const colors: number[][] = [];

		for ( let i = 0; i < colorCount; i++ ) {
			const c: number[] = [];

			for ( let j = 0; j < LIGHTGRID_COLOR_STRIDE; j++ ) {
				c.push( lump3[i * LIGHTGRID_COLOR_STRIDE + j] );
			}

			colors.push( c );
		}

		return { rows, colors };
	}

	/*
	====================
	parseCollision

	Extracts world collision geometry:
	1. Axial and bevel planes for standard world brushes (Lumps 4, 5, 6, 35).
	2. Mantle obstacle brushes for player vault mechanics.
	3. Terrain collision triangle prisms with completed boundary bevels (Lumps 29, 31, 33, 34).
	====================
	*/
	parseCollision(): { collision: CollisionBrush[]; mantle: CollisionBrush[] } {
		const rawPlanes = this.getLump( LUMP_PLANES );
		const viewPlanes = new DataView( rawPlanes.buffer, rawPlanes.byteOffset, rawPlanes.byteLength );
		const planes: [number, number, number, number][] = [];

		for ( let i = 0; i < Math.floor( rawPlanes.length / PLANE_STRIDE ); i++ ) {
			planes.push( [
				viewPlanes.getFloat32( i * PLANE_STRIDE, true ),
				viewPlanes.getFloat32( i * PLANE_STRIDE + 4, true ),
				viewPlanes.getFloat32( i * PLANE_STRIDE + 8, true ),
				viewPlanes.getFloat32( i * PLANE_STRIDE + 12, true ),
			] );
		}

		const sides = this.getLump( LUMP_BRUSHSIDES );
		const viewSides = new DataView( sides.buffer, sides.byteOffset, sides.byteLength );
		const rawBrushes = this.getLump( LUMP_BRUSHES );
		const viewBrushes = new DataView( rawBrushes.buffer, rawBrushes.byteOffset, rawBrushes.byteLength );
		const rawMaterials = this.getLump( LUMP_MATERIALS );
		const viewMaterials = new DataView( rawMaterials.buffer, rawMaterials.byteOffset, rawMaterials.byteLength );

		const modelLump = this.getLump( LUMP_MODELS );
		const viewModel = new DataView( modelLump.buffer, modelLump.byteOffset, modelLump.byteLength );

		const firstBrush = viewModel.getUint32( MODEL_BRUSH_FIRST_OFFSET, true );
		const brushCount = viewModel.getUint32( MODEL_BRUSH_COUNT_OFFSET, true );

		const collision: CollisionBrush[] = [];
		const mantle: CollisionBrush[] = [];
		let cursor = 0;

		for ( let index = 0; index < Math.floor( rawBrushes.length / BRUSH_STRIDE ); index++ ) {
			const sidecount = viewBrushes.getUint16( index * BRUSH_STRIDE, true );
			const material = viewBrushes.getUint16( index * BRUSH_STRIDE + 2, true );

			const bounds = [
				viewSides.getFloat32( cursor, true ),
				viewSides.getFloat32( cursor + 8, true ),
				viewSides.getFloat32( cursor + 16, true ),
				viewSides.getFloat32( cursor + 24, true ),
				viewSides.getFloat32( cursor + 32, true ),
				viewSides.getFloat32( cursor + 40, true ),
			];

			const brushplanes: number[][] = [];

			for ( let axis = 0; axis < 3; axis++ ) {
				const neg = [0, 0, 0];
				neg[axis] = -1;
				brushplanes.push( [...neg, -bounds[axis * 2]] );

				const pos = [0, 0, 0];
				pos[axis] = 1;
				brushplanes.push( [...pos, bounds[axis * 2 + 1]] );
			}

			for ( let side = 6; side < sidecount; side++ ) {
				const planeIdx = viewSides.getUint32( cursor + side * 8, true );

				if ( planeIdx < planes.length ) {
					brushplanes.push( [...planes[planeIdx]] );
				}
			}

			const contents = viewMaterials.getUint32( material * 72 + 68, true ) & 0xdffffffb;
			const inRange = index >= firstBrush && index < firstBrush + brushCount;

			if ( inRange && ( ( contents & 0x10001 ) || ( contents & 0x1000000 ) ) ) {
				const flags: number[] = [];

				for ( let side = 0; side < sidecount; side++ ) {
					const matIdx = viewSides.getUint32( cursor + side * 8 + 4, true );
					flags.push( viewMaterials.getUint32( matIdx * 72 + 64, true ) );
				}

				const brush: CollisionBrush = { bounds, planes: brushplanes, contents, surfaceFlags: flags };

				if ( contents & 0x10001 ) {
					collision.push( brush );
				}

				if ( contents & 0x1000000 ) {
					mantle.push( brush );
				}
			}

			cursor += sidecount * 8;
		}

		// Process terrain collision triangles from lumps 29, 31, 33, 34
		try {
			const lump33 = this.getLump( LUMP_PRIMARY_LIGHTS );
			const lump34 = this.getLump( LUMP_LIGHT_GRID );
			const partitions: { count: number; first: number }[] = [];
			const v33 = new DataView( lump33.buffer, lump33.byteOffset, lump33.byteLength );

			for ( let i = 0; i < Math.floor( lump33.length / 12 ); i++ ) {
				partitions.push( {
					count: v33.getUint8( i * 12 + 2 ),
					first: v33.getUint32( i * 12 + 4, true ),
				} );
			}

			const triangleSurfaces = new Map<number, { flags: number; contents: number }>();
			const v34 = new DataView( lump34.buffer, lump34.byteOffset, lump34.byteLength );

			for ( let i = 0; i < Math.floor( lump34.length / 32 ); i++ ) {
				const material = v34.getUint16( i * 32 + 24, true );
				const children = v34.getUint16( i * 32 + 26, true );
				const partition = v34.getUint32( i * 32 + 28, true );

				if ( children !== 0 ) {
					continue;
				}

				const part = partitions[partition];

				if ( !part ) {
					continue;
				}

				const flags = viewMaterials.getUint32( material * 72 + 64, true );
				const contents = ( viewMaterials.getUint32( material * 72 + 68, true ) & 0xdffffffb ) >>> 0;

				for ( let idx = part.first; idx < part.first + part.count; idx++ ) {
					triangleSurfaces.set( idx, { flags, contents } );
				}
			}

			const lump29 = this.getLump( LUMP_AABB_TREES );
			const v29 = new DataView( lump29.buffer, lump29.byteOffset, lump29.byteLength );
			const collisionVertices: [number, number, number][] = [];

			for ( let i = 0; i < Math.floor( lump29.length / 16 ); i++ ) {
				collisionVertices.push( [
					v29.getFloat32( i * 16 + 4, true ),
					v29.getFloat32( i * 16 + 8, true ),
					v29.getFloat32( i * 16 + 12, true ),
				] );
			}

			const lump31 = this.getLump( LUMP_COLLISION_SURFS );
			const v31 = new DataView( lump31.buffer, lump31.byteOffset, lump31.byteLength );
			const triCount = Math.floor( lump31.length / 72 );

			const cross = ( a: [number, number, number], b: [number, number, number] ): [number, number, number] => [
				a[1] * b[2] - a[2] * b[1],
				a[2] * b[0] - a[0] * b[2],
				a[0] * b[1] - a[1] * b[0],
			];

			const dot = ( a: [number, number, number], b: [number, number, number] ): number =>
				a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

			const completeBevels = (
				initialPlanes: number[][],
				pts: [number, number, number][],
				norm: [number, number, number]
			): number[][] => {
				const verts: [number, number, number][] = [
					pts[0], pts[1], pts[2],
					[pts[0][0] - 0.25 * norm[0], pts[0][1] - 0.25 * norm[1], pts[0][2] - 0.25 * norm[2]],
					[pts[1][0] - 0.25 * norm[0], pts[1][1] - 0.25 * norm[1], pts[1][2] - 0.25 * norm[2]],
					[pts[2][0] - 0.25 * norm[0], pts[2][1] - 0.25 * norm[1], pts[2][2] - 0.25 * norm[2]],
				];

				const edgeDirs: [number, number, number][] = [
					[pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]],
					[pts[2][0] - pts[1][0], pts[2][1] - pts[1][1], pts[2][2] - pts[1][2]],
					[pts[0][0] - pts[2][0], pts[0][1] - pts[2][1], pts[0][2] - pts[2][2]],
					[norm[0], norm[1], norm[2]],
				];

				const axes: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
				const res = initialPlanes.map( ( p ) => [...p] );

				for ( const edge of edgeDirs ) {
					for ( const axis of axes ) {
						const c = cross( edge, axis );
						const len = Math.sqrt( dot( c, c ) );

						if ( len < 1e-8 ) {
							continue;
						}

						for ( const sign of [-1, 1] ) {
							const n: [number, number, number] = [
								( sign * c[0] ) / len,
								( sign * c[1] ) / len,
								( sign * c[2] ) / len,
							];
							let d = -Infinity;

							for ( const v of verts ) {
								const val = dot( n, v );

								if ( val > d ) {
									d = val;
								}
							}

							let onPlane = 0;

							for ( const v of verts ) {
								if ( Math.abs( dot( n, v ) - d ) < 1e-5 ) {
									onPlane++;
								}
							}

							if ( onPlane < 2 ) {
								continue;
							}

							const exists = res.some( ( p ) => {
								const diffN = Math.hypot( p[0] - n[0], p[1] - n[1], p[2] - n[2] );
								return diffN < 1e-6 && Math.abs( p[3] - d) < 1e-4;
							} );

							if ( !exists ) {
								res.push( [...n, d] );
							}
						}
					}
				}

				return res;
			};

			for ( let i = 0; i < triCount; i++ ) {
				const off = i * 72;
				const normal: [number, number, number] = [
					v31.getFloat32( off, true ),
					v31.getFloat32( off + 4, true ),
					v31.getFloat32( off + 8, true ),
				];
				const distance = v31.getFloat32( off + 12, true );

				const s: [number, number, number] = [
					v31.getFloat32( off + 16, true ),
					v31.getFloat32( off + 20, true ),
					v31.getFloat32( off + 24, true ),
				];
				const sDist = v31.getFloat32( off + 28, true );

				const t: [number, number, number] = [
					v31.getFloat32( off + 32, true ),
					v31.getFloat32( off + 36, true ),
					v31.getFloat32( off + 40, true ),
				];
				const tDist = v31.getFloat32( off + 44, true );

				const idx0 = v31.getUint32( off + 48, true );
				const idx1 = v31.getUint32( off + 52, true );
				const idx2 = v31.getUint32( off + 56, true );

				const st = cross( s, t );
				const tn = cross( t, normal );
				const ns = cross( normal, s );
				const det = dot( normal, st );

				if ( Math.abs( det ) <= 1e-15 ) {
					continue;
				}

				const getPt = ( idx: number, u: number, v: number ): [number, number, number] => {
					if ( idx !== 0xffffffff && idx < collisionVertices.length ) {
						return collisionVertices[idx];
					}

					return [
						( distance * st[0] + ( sDist + u ) * tn[0] + ( tDist + v ) * ns[0] ) / det,
						( distance * st[1] + ( sDist + u ) * tn[1] + ( tDist + v ) * ns[1] ) / det,
						( distance * st[2] + ( sDist + u ) * tn[2] + ( tDist + v ) * ns[2] ) / det,
					];
				};

				const points: [number, number, number][] = [
					getPt( idx0, 0, 0 ),
					getPt( idx1, 1, 0 ),
					getPt( idx2, 0, 1 ),
				];

				const brushplanes: number[][] = [
					[normal[0], normal[1], normal[2], distance],
					[-normal[0], -normal[1], -normal[2], -distance + 0.25],
				];

				let valid = true;

				for ( let edge = 0; edge < 3; edge++ ) {
					const p = points[edge];
					const q = points[( edge + 1 ) % 3];
					const other = points[( edge + 2 ) % 3];
					const v: [number, number, number] = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];

					let en: [number, number, number] = [
						v[1] * normal[2] - v[2] * normal[1],
						v[2] * normal[0] - v[0] * normal[2],
						v[0] * normal[1] - v[1] * normal[0],
					];

					const len = Math.sqrt( dot( en, en ) );

					if ( len < 1e-6 ) {
						valid = false;
						break;
					}

					en = [en[0] / len, en[1] / len, en[2] / len];
					let d = dot( en, p );

					if ( dot( en, other ) > d ) {
						en = [-en[0], -en[1], -en[2]];
						d = -d;
					}

					brushplanes.push( [...en, d] );
				}

				if ( !valid || brushplanes.length !== 5 ) {
					continue;
				}

				const completedPlanes = completeBevels( brushplanes, points, normal );
				const surf = triangleSurfaces.get( i ) || { flags: 0, contents: 0 };

				const bounds = [
					Math.min( points[0][0], points[1][0], points[2][0] ) - 0.25,
					Math.max( points[0][0], points[1][0], points[2][0] ) + 0.25,
					Math.min( points[0][1], points[1][1], points[2][1] ) - 0.25,
					Math.max( points[0][1], points[1][1], points[2][1] ) + 0.25,
					Math.min( points[0][2], points[1][2], points[2][2] ) - 0.25,
					Math.max( points[0][2], points[1][2], points[2][2] ) + 0.25,
				];

				collision.push( {
					bounds,
					planes: completedPlanes,
					contents: surf.contents,
					triangle: points,
					surfaceFlags: [surf.flags],
				} );
			}
		} catch {
			// terrain triangle collision fallback
		}

		return { collision, mantle };
	}

	/*
	====================
	buildWorldMesh

	Constructs concatenated GPU vertex/index draw buffers and state batches
	from draw surface soups (Lump 7), vertices (Lump 8), and indices (Lump 9).
	Appends 4-byte packed metadata (material index, lightmap index, sky flag) to each vertex.
	====================
	*/
	buildWorldMesh(
		states: Record<string, any>[],
		skyMaterials: Set<number>
	): {
		mesh: Uint8Array;
		draws: BspDrawCall[];
		usedMaterials: Set<number>;
	} {
		const rawVerts = this.getLump( LUMP_VERTICES );
		const rawIndices = this.getLump( LUMP_INDICES );
		const viewIndices = new DataView( rawIndices.buffer, rawIndices.byteOffset, rawIndices.byteLength );

		const rawSoups = this.getLump( LUMP_VERTEX_SOUPS );
		const viewSoups = new DataView( rawSoups.buffer, rawSoups.byteOffset, rawSoups.byteLength );

		const rawModel = this.getLump( LUMP_MODELS );
		const viewModel = new DataView( rawModel.buffer, rawModel.byteOffset, rawModel.byteLength );
		const first = viewModel.getUint32( MODEL_DRAW_FIRST_OFFSET, true );
		const count = viewModel.getUint32( MODEL_DRAW_COUNT_OFFSET, true );

		const draws: BspDrawCall[] = [];
		const usedMaterials = new Set<number>();
		const meshChunks: Uint8Array[] = [];

		let currentVertexCount = 0;

		for ( let i = first; i < first + count; i++ ) {
			const entryOffset = i * DRAW_SOUP_STRIDE;
			const material = viewSoups.getUint16( entryOffset, true );
			const lightmap = viewSoups.getUint16( entryOffset + 2, true );
			const start = viewSoups.getUint32( entryOffset + 4, true );
			const vertexcount = viewSoups.getUint16( entryOffset + 8, true );
			const indexcount = viewSoups.getUint16( entryOffset + 10, true );
			const indexstart = viewSoups.getUint32( entryOffset + 12, true );

			usedMaterials.add( material );
			draws.push( {
				start: currentVertexCount,
				count: indexcount,
				state: states[material] || {},
			} );

			const chunk = new Uint8Array( indexcount * VERTEX_OUTPUT_STRIDE );
			const chunkView = new DataView( chunk.buffer );
			const isSky = skyMaterials.has( material );
			const extraWord = ( material | ( lightmap << 16 ) | ( isSky ? SKY_MATERIAL_FLAG : 0 ) ) >>> 0;

			for ( let j = 0; j < indexcount; j++ ) {
				const idx = viewIndices.getUint16( ( indexstart + j ) * 2, true );
				const vertOffset = ( start + idx ) * VERTEX_INPUT_STRIDE;
				const outOffset = j * VERTEX_OUTPUT_STRIDE;

				chunk.set( rawVerts.subarray( vertOffset, vertOffset + VERTEX_INPUT_STRIDE ), outOffset );
				chunkView.setUint32( outOffset + VERTEX_INPUT_STRIDE, extraWord, true );
			}

			meshChunks.push( chunk );
			currentVertexCount += indexcount;
		}

		const mesh = concatByteArrays( meshChunks );

		return { mesh, draws, usedMaterials };
	}
}
