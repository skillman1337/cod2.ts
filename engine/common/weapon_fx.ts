/*
===============================================================================

	weapon_fx.ts

	Call of Duty 2 / id Tech Visual Particle & Weapon Effects (EFX) Engine
	Piecewise EFX curve evaluation, trapezoidal numerical integration,
	sprite animation frame sequencing, surface impact dispatch,
	and hierarchical particle emitter graph evaluation.
	Reconstructed from native routines 0x4a1560, 0x495f30, 0x497460, 0x492fb0, 0x49e710.

===============================================================================
*/

import surfaces from '@/assets/ui/surfaces.json';
import type { weapon_shot_t } from './weapon.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const EFX_RAND_MULT                = 214013;
export const EFX_RAND_ADD                 = 2531011;
export const EFX_RAND_MAX                 = 32767;

export const FX_FRAME_START_FIXED         = 0;
export const FX_FRAME_START_RANDOM        = 1;
export const FX_FRAME_START_INDEX         = 2;

export const FX_PLAY_RATE_FPS             = 0;
export const FX_PLAY_RATE_LIFE            = 1;

export const FX_LOOP_WRAP                 = 0;
export const FX_LOOP_TIMES                = 1;

export const FX_MS_PER_SEC                = 1000;
export const FX_AXIS_SINGULARITY_EPSILON  = 0.99;

export const FX_SURF_NO_IMPACT_FLAG       = 0x2000;
export const FX_SURFACE_FLAG_SHIFT        = 20;
export const FX_SURFACE_FLAG_MASK         = 31;
export const FX_DEFAULT_SURFACE           = 'default';
export const FX_IMPACT_KINDS              = ['normal', 'reflect'] as const;


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface fx_curve_t {
	curve?: string[][];
	scale?: string[];
}

export interface fx_part_t {
	kind: string;
	[key: string]: unknown;
}

export interface fx_catalog_t {
	effects: Record<string, fx_part_t[]>;
	impacts: Record<string, Record<string, string>>;
	materials: Record<string, {
		file?: string;
		definition: {
			atlas: number[];
			state: {
				src: number;
				dst: number;
				sort: number;
				offset: number;
			};
		};
	}>;
}

export interface fx_sprite_t {
	shader: string;
	position: number[];
	axis: number[][];
	size: number;
	size2: number;
	length: number;
	tailEnd?: number[];
	rotation: number;
	color: number[];
	frame: number;
	decal: boolean;
	tail: boolean;
	relative: boolean;
	depthHack: boolean;
}


// ---------------------------------------------------------------------------
// sprite animation & frame sequencing
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * FX_SequenceFrame
 *
 * Computes active sub-image frame index in texture atlas grid (0x4a1560, 0x495f30).
 * Handles fixed frame, random frame, index offset, loop modes, and fps timing.
 * ================
 */
export function FX_SequenceFrame(
	part: fx_part_t,
	frames: number,
	elapsed: number,
	life: number,
	index: number,
	random: number
): number {
	if ( frames === 1 ) {
		return 0;
	}

	const value = ( key: string, fallback: number ) =>
		Number( ( part[key] as string[] | undefined )?.[0] ?? fallback );

	const startMode = value( 'sequenceStartFrameMode', FX_FRAME_START_FIXED );
	const rateMode = value( 'sequencePlayRateMode', FX_PLAY_RATE_FPS );
	const loopMode = value( 'sequenceLoopMode', FX_LOOP_WRAP );

	const start = startMode === FX_FRAME_START_FIXED
		? value( 'sequenceFixedFrameValue', 1 ) - 1
		: startMode === FX_FRAME_START_RANDOM
			? Math.floor( random * frames )
			: startMode === FX_FRAME_START_INDEX
				? index
				: 0;

	const rate = Math.fround(
		rateMode === FX_PLAY_RATE_FPS
			? value( 'sequenceFixedFpsValue', 1 ) / FX_MS_PER_SEC
			: rateMode === FX_PLAY_RATE_LIFE
				? frames / life
				: 0
	);

	let frame = start + Math.trunc( elapsed * rate );

	if ( frame >= frames ) {
		if ( loopMode === FX_LOOP_WRAP ) {
			frame %= frames;
		} else if ( loopMode === FX_LOOP_TIMES ) {
			const loops = value( 'sequenceLoopTimes', 1 );
			frame = loops > 0 && frame < ( loops + 1 ) * frames ? frame % frames : frames - 1;
		}
	}

	return frame;
}

/**
 * @exec helper
 * ================
 * FX_TailEnd
 *
 * Computes ribbon tail particle trailing position (0x497460).
 * Points towards particle's previous position rather than emitter coordinate axis.
 * ================
 */
export function FX_TailEnd(
	position: number[],
	previous: number[],
	length: number
): number[] | undefined {
	const delta = previous.map( ( v, i ) => v - position[i] );
	const distance = Math.hypot( ...delta );

	return distance > 0
		? position.map( ( v, i ) => Math.fround( v + ( delta[i] / distance ) * length ) )
		: undefined;
}


// ---------------------------------------------------------------------------
// piece-wise curve evaluation & integration
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * FX_Curve
 *
 * Evaluates piecewise authored EFX curves at normalized time parameter t [0, 1].
 * Interpolates between adjacent keyframe rows.
 * ================
 */
export function FX_Curve(
	curve: fx_curve_t | undefined,
	t: number,
	component: number = 1,
	fallback: number = 1
): number {
	const rows = curve?.curve;

	if ( !rows?.length ) {
		return fallback;
	}

	let i = 0;

	while ( i + 1 < rows.length && Number( rows[i + 1][0] ) <= t ) {
		i++;
	}

	const a = rows[i];
	const b = rows[Math.min( i + 1, rows.length - 1 )];

	const f = i + 1 < rows.length
		? Math.max( 0, Math.min( 1, ( t - Number( a[0] ) ) / ( Number( b[0] ) - Number( a[0] ) ) ) )
		: 0;

	return Number( a[component] ) + ( Number( b[component] ) - Number( a[component] ) ) * f;
}

/**
 * @exec helper
 * ================
 * FX_Integral
 *
 * Numerically integrates linear curve segments up to parameter t using the trapezoid rule (0x492fb0).
 * ================
 */
export function FX_Integral(
	curve: fx_curve_t | undefined,
	t: number
): number {
	const rows = curve?.curve;

	if ( !rows?.length ) {
		return 0;
	}

	let sum = 0;
	let start = 0;

	for ( const row of rows ) {
		const end = Math.min( t, Number( row[0] ) );

		if ( end > start ) {
			sum += ( FX_Curve( curve, start ) + FX_Curve( curve, end ) ) * 0.5 * ( end - start );
		}

		start = end;

		if ( end === t ) {
			return sum;
		}
	}

	return sum + ( t - start ) * FX_Curve( curve, t );
}


// ---------------------------------------------------------------------------
// orientation & impact dispatch
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * FX_Axis
 *
 * Constructs orthonormal coordinate orientation matrix from forward direction vector.
 * ================
 */
export function FX_Axis( forward: number[] ): number[][] {
	const n = Math.hypot( ...forward ) || 1;
	const f = forward.map( ( x ) => x / n );
	const a = Math.abs( f[2] ) < FX_AXIS_SINGULARITY_EPSILON ? [0, 0, 1] : [0, 1, 0];

	const right = [
		f[1] * a[2] - f[2] * a[1],
		f[2] * a[0] - f[0] * a[2],
		f[0] * a[1] - f[1] * a[0],
	];

	const r = Math.hypot( ...right ) || 1;

	for ( let i = 0; i < 3; i++ ) {
		right[i] /= r;
	}

	const up = [
		f[1] * right[2] - f[2] * right[1],
		f[2] * right[0] - f[0] * right[2],
		f[0] * right[1] - f[1] * right[0],
	];

	return [f, right, up];
}

/**
 * @exec helper
 * ================
 * FX_Impact
 *
 * Queries impact effect dictionary for surface type matching bullet impact point.
 * Spawns both normal and reflected effects based on material surfaces CSV index.
 * ================
 */
export function FX_Impact(
	catalog: fx_catalog_t,
	type: string,
	shot: weapon_shot_t
): { name: string; axis: number[][] }[] {
	if ( !shot.hit || ( shot.surfaceFlags & FX_SURF_NO_IMPACT_FLAG ) ) {
		return [];
	}

	const surface = surfaces[( shot.surfaceFlags >>> FX_SURFACE_FLAG_SHIFT ) & FX_SURFACE_FLAG_MASK] ?? FX_DEFAULT_SURFACE;
	const dot = shot.direction.reduce( ( s, v, i ) => s + v * shot.normal[i], 0 );

	return FX_IMPACT_KINDS.flatMap( ( kind ) => {
		const table = catalog.impacts[type + '_' + kind];
		const name = table?.[surface] || table?.default;

		if ( !name ) {
			return [];
		}

		const axis = FX_Axis(
			kind === 'normal'
				? shot.normal
				: shot.direction.map( ( v, i ) => v - 2 * dot * shot.normal[i] )
		);

		return [{ name, axis }];
	} );
}


// ---------------------------------------------------------------------------
// effect tree evaluation
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * FX_Evaluate
 *
 * Evaluates full particle emitter tree graph for a given effect name and elapsed age.
 * Generates renderable billboard sprites, decals, and ribbon trails.
 * Handles sub-emitters, physics velocities, atlas texture coordinates, and depth hacking.
 * ================
 */
export function FX_Evaluate(
	catalog: fx_catalog_t,
	name: string,
	age: number,
	seed: number,
	position: number[],
	axis: number[][],
	attached: boolean = false,
	depth: number = 0,
	frameMsec: number = 16
): fx_sprite_t[] {
	if ( depth > 4 || age < 0 ) {
		return [];
	}

	const output: fx_sprite_t[] = [];
	const eventSeed = seed;

	// EFX uses its own high-15-bit generator (0x49e710), distinct from sound rand().
	const random = () => {
		seed = ( Math.imul( seed, EFX_RAND_MULT ) + EFX_RAND_ADD ) | 0;
		return ( seed >>> 17 ) / EFX_RAND_MAX;
	};

	const range = ( v: unknown, fallback: number ) => {
		const a = v as string[] | undefined;

		if ( !a?.length ) {
			return fallback;
		}

		const low = Number( a[0] );
		const high = Number( a[1] ?? a[0] );

		return low === high ? low : low + ( high - low ) * random();
	};

	for ( const [partIndex, part] of ( catalog.effects[name] ?? [] ).entries() ) {
		seed = ( eventSeed + Math.imul( partIndex, 1640531513 ) ) | 0;

		const count = Math.max( 0, Math.round( range( part.count, 1 ) ) );
		const flags = ( part.flags ?? [] ) as string[];

		for ( let index = 0; index < count; index++ ) {
			seed = ( eventSeed + Math.imul( partIndex, 1640531513 ) + Math.imul( index, 1013904223 ) ) | 0;

			const life = Math.max( 1, range( part.life, 1000 ) );
			const delay = range( part.delay, 0 );
			const elapsed = age - delay;

			if ( elapsed < 0 ) {
				continue;
			}

			const t = Math.min( 1, elapsed / life );

			const scales = new Map<string, number>();
			const weights = new Map<string, number>();

			for ( const key of [
				'rgb',
				'alpha',
				'size',
				'size2',
				'length',
				'rotationDelta',
				'velocityX',
				'velocityY',
				'velocityZ',
				'velocity2X',
				'velocity2Y',
				'velocity2Z',
			] ) {
				scales.set( key, range( ( part[key] as fx_curve_t )?.scale, 1 ) );
				weights.set( key, random() );
			}

			const randomized = ( key: string ) =>
				flags.includes(
					'useRandom' +
						( key.startsWith( 'velocity2' )
							? 'Velocity2'
							: key.startsWith( 'velocity' )
								? 'Velocity'
								: key === 'rgb'
									? 'Colors'
									: key[0].toUpperCase() + key.slice( 1 ) )
				);

			const field = (
				key: string,
				at: number = t,
				integral: boolean = false,
				component: number = 1,
				defaultValue: number = 1
			) => {
				const evaluate = ( c: fx_curve_t | undefined ) =>
					integral ? FX_Integral( c, at ) : FX_Curve( c, at, component, defaultValue );

				const a = evaluate( part[key] as fx_curve_t );

				return (
					( a + ( randomized( key ) ? ( evaluate( part[key + 'Rand'] as fx_curve_t ) - a ) * weights.get( key )! : 0 ) ) *
					scales.get( key )!
				);
			};

			const origin = part.origin as string[] | undefined;
			const localOrigin = [0, 1, 2].map( ( i ) =>
				origin ? range( [origin[i], origin[i + 3] ?? origin[i]], 0 ) : 0
			);

			const pointAt = ( ms: number ) => {
				const fraction = Math.min( 1, ms / life );
				const local = [...localOrigin];
				const absolute = [0, 0, 0];

				for ( const prefix of ['velocity', 'velocity2'] ) {
					for ( let i = 0; i < 3; i++ ) {
						const absoluteFlag = prefix === 'velocity' ? 'absoluteVel' : 'absoluteVel2';
						const offset = field( prefix + 'XYZ'[i], fraction, true, 1, 0 ) * life * 0.001;

						( flags.includes( absoluteFlag ) ? absolute : local )[i] += offset;
					}
				}

				const p = position.map(
					( v, i ) => v + absolute[i] + local.reduce( ( s, x, j ) => s + x * axis[j][i], 0 )
				);

				p[2] += ( Number( ( part.gravity as string[] )?.[0] ) || 0 ) * ( ms * 0.001 ) ** 2 * 0.5;
				return p;
			};

			// Child effects retain their emission origin. Never advance a dead emitter for the child's lifetime.
			for ( const fieldName of ['emitfx', 'playfx', 'fx'] ) {
				for ( const ref of ( part[fieldName] ?? [] ) as string[][] ) {
					const path = ref[0].replace( /^\//, '' );
					const end = pointAt( life );
					const distance = Math.hypot( ...end.map( ( v, i ) => v - position[i] ) );
					const spacing = Number( ( part.density as string[] )?.[0] ) || distance || 1;
					const births = fieldName === 'emitfx' ? Math.min( 64, Math.max( 1, Math.ceil( distance / spacing ) ) ) : 1;

					for ( let birth = 0; birth < births; birth++ ) {
						const birthTime = ( life * birth ) / births;

						if ( birthTime > elapsed ) {
							break;
						}

						output.push(
							...FX_Evaluate(
								catalog,
								path.endsWith( '.efx' ) ? path : path + '.efx',
								elapsed - birthTime,
								eventSeed + partIndex * 127 + index * 31 + birth,
								pointAt( birthTime ),
								axis,
								attached,
								depth + 1,
								frameMsec
							)
						);
					}
				}
			}

			if ( elapsed > life ) {
				continue;
			}

			const shaders = part.shaders as string[][] | undefined;

			if ( !shaders?.length ) {
				continue;
			}

			const shader = shaders[Math.min( shaders.length - 1, Math.floor( random() * shaders.length ) )][0];
			const alpha = Math.max( 0, Math.min( 1, field( 'alpha' ) ) );
			const useAlpha = flags.includes( 'useAlpha' );
			const color = [1, 2, 3]
				.map( ( i ) => field( 'rgb', t, false, i ) * ( useAlpha ? 1 : alpha ) )
				.concat( useAlpha ? alpha : 1 );

			const point = pointAt( elapsed );
			const length = field( 'length' );
			const size = field( 'size' );
			const atlas = catalog.materials[shader]?.definition.atlas ?? [1, 1];

			output.push( {
				shader,
				position: point,
				axis,
				size,
				size2: Number( ( part.nonUniformScale as string[] )?.[0] ) ? field( 'size2' ) : size,
				length,
				tailEnd: part.kind === 'Tail'
					? FX_TailEnd( point, pointAt( Math.max( 0, elapsed - frameMsec ) ), length )
					: undefined,
				rotation:
					( range( part.rotation, 0 ) + field( 'rotationDelta', t, true, 1, 0 ) * life * 0.001 ) *
					( Math.PI / 180 ),
				color,
				frame: FX_SequenceFrame(
					part,
					( atlas[0] || 1 ) * ( atlas[1] || 1 ),
					elapsed,
					life,
					index,
					( random() * 32767 ) / 32768
				),
				decal: part.kind === 'Decal',
				tail: part.kind === 'Tail',
				relative: attached && flags.includes( 'relative' ),
				depthHack: flags.includes( 'depthHack' ),
			} );
		}
	}

	return output;
}
