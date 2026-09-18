/*
===============================================================================

	pm.ts

	Call of Duty 2 / id Tech Player Movement Physics & Collision Engine (Pmove)
	Authoritative movement simulation: ground/air acceleration, surface friction,
	multi-plane velocity clipping, continuous swept capsule traces,
	stair step negotiation, 26-direction unstick recovery, ladder climbing,
	corner leaning, and fixed-slice usercmd integration.
	Reconstructed from native routines 0x515650, 0x515400, 0x530210, 0x530a30, 0x516ff0, 0x51aee0.

===============================================================================
*/

import {
	vec3_t,
	usercmd_t,
	IN_JUMP,
	IN_LEANLEFT,
	IN_LEANRIGHT,
	pm_movement_t,
} from './types.js';
import { AngleVectors } from './math.js';
import { Level_Data } from './level.js';
import { Collision_QueryBounds } from './collision_broadphase.js';
import { Cvar_Get } from './cvar.js';
import weapons from '@/assets/ui/weapons.json';
import {
	MovementRecord_Begin,
	MovementRecord_Trace,
	MovementRecord_End,
} from './movement_recording.js';
import {
	Capsule_TraceTriangle,
	STANDING_CAPSULE,
	type capsule_shape_t,
} from './collision_capsule.js';
import { Landing_Height, Landing_Amount, Landing_SoundKind } from './landing.js';
import { Mantle_Check, Mantle_Move } from './mantle.js';
import { Lean_Advance, Lean_Origin, Lean_Clamp } from './lean.js';
import { Stance_Advance, Stance_Shape } from './stance.js';
import {
	Movement_Emit,
	Movement_Cycle,
	Movement_Rate,
	Movement_LadderCycle,
} from './movement_events.js';
import { Ladder_Check, Ladder_Wish, Ladder_Velocity, Ladder_Jump } from './ladder.js';
import { Weapon_Update } from './weapon.js';
import { WeaponSpread_ShotAngle, WeaponSpread_End } from './weapon_spread.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const PM_DEFAULT_GRAVITY            = 800;
export const PM_DEFAULT_SPEED              = 190;
export const PM_DEFAULT_JUMP_HEIGHT        = 39;
export const PM_DEFAULT_STOPSPEED          = 100;
export const PM_DEFAULT_FRICTION           = 5.5;
export const PM_DEFAULT_STEP_SIZE          = 18;
export const PM_DEFAULT_BACK_SPEED_SCALE   = 0.7;
export const PM_DEFAULT_STRAFE_SPEED_SCALE = 0.8;
export const PM_DEFAULT_LADDER_PUSH_VEL    = 128;
export const PM_DEFAULT_INERTIA_MAX        = 50;
export const PM_DEFAULT_MOVE_THRESHOLD     = 10;


// ---------------------------------------------------------------------------
// types & dvars
// ---------------------------------------------------------------------------

export interface pm_state_t {
	origin: vec3_t;
	angles: vec3_t;
	velocity: vec3_t;
	movement?: pm_movement_t;
}

export interface pm_trace_t {
	fraction: number;
	normal: vec3_t;
	startsolid: boolean;
	allsolid: boolean;
	surfaceFlags: number;
	hitBrush?: number;
	startSolidBrushes?: number[];
}

export type pm_trace_fn = ( start: vec3_t, end: vec3_t ) => pm_trace_t;

/**
 * @exec helper
 * ================
 * PM_Dvar
 *
 * Reads numeric cvar value with fallback default.
 * ================
 */
function PM_Dvar( name: string, fallback: number ): number {
	const text = Cvar_Get( name );
	return text !== '' && Number.isFinite( Number( text ) ) ? Number( text ) : fallback;
}


// ---------------------------------------------------------------------------
// vector math & velocity clipping
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * PM_Dot
 *
 * 3D vector dot product.
 * ================
 */
function PM_Dot( a: vec3_t, b: vec3_t ): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * @exec helper
 * ================
 * PM_Normalize
 *
 * Normalizes vector in-place and returns its original magnitude.
 * ================
 */
function PM_Normalize( v: vec3_t ): number {
	const size = Math.hypot( ...v );

	if ( size ) {
		for ( let i = 0; i < 3; i++ ) {
			v[i] = Math.fround( v[i] / size );
		}
	}

	return size;
}

/**
 * @exec helper
 * ================
 * PM_Snap
 *
 * Rounds value to nearest integer using FISTP round-to-even semantics (0x467f40).
 * ================
 */
function PM_Snap( value: number ): number {
	const floor = Math.floor( value );

	if ( value - floor === 0.5 ) {
		return floor + ( floor % 2 !== 0 ? 1 : 0 );
	}

	return Math.round( value );
}

/**
 * @exec helper
 * ================
 * PM_ClipVelocity
 *
 * Slides velocity vector along contact plane normal (0x5153a0).
 * Backoff margin: dot - abs(dot) * 0.001.
 * ================
 */
export function PM_ClipVelocity( v: vec3_t, n: vec3_t ): vec3_t {
	const dot = PM_Dot( v, n );
	const backoff = dot - Math.abs( dot ) * Math.fround( 0.001 );

	return v.map( ( x, i ) => Math.fround( x - backoff * n[i] ) ) as vec3_t;
}

/**
 * @exec helper
 * ================
 * PM_Accelerate
 *
 * Applies directional acceleration to velocity vector (0x515650).
 * Handles inertia reversal limits (0x5155f0..0x515510) relative to previous velocity.
 * ================
 */
export function PM_Accelerate(
	v: vec3_t,
	dir: vec3_t,
	speed: number,
	accel: number,
	dt: number,
	stop: number,
	old?: vec3_t
): void {
	const remaining = speed - PM_Dot( v, dir );

	if ( remaining <= 0 ) {
		return;
	}

	let amount = Math.min( remaining, Math.max( stop, speed ) * dt * accel );
	const limit = PM_Dvar( 'inertiaMax', PM_DEFAULT_INERTIA_MAX );

	if ( old && amount > limit && old[0] * old[0] + old[1] * old[1] > 0.0001 ) {
		const x = Math.fround( v[0] + amount * dir[0] );
		const y = Math.fround( v[1] + amount * dir[1] );
		const length = Math.hypot( x, y );
		const previous = Math.hypot( old[0], old[1] );

		if ( length && ( x * old[0] + y * old[1] ) / ( length * previous ) < PM_Dvar( 'inertiaAngle', 0 ) ) {
			amount = limit;
		}
	}

	for ( let i = 0; i < 3; i++ ) {
		v[i] = Math.fround( v[i] + amount * dir[i] );
	}
}

/**
 * @exec helper
 * ================
 * PM_Friction
 *
 * Applies ground friction deceleration to velocity vector (0x515400).
 * Scales velocity components proportionally down to zero below 1 unit/sec.
 * ================
 */
export function PM_Friction(
	v: vec3_t,
	grounded: boolean,
	slick: boolean,
	dt: number,
	friction: number,
	stop: number,
	recovery: number
): void {
	const speed = grounded ? Math.hypot( v[0], v[1] ) : Math.hypot( ...v );

	if ( speed < 1 ) {
		v.fill( 0 );
		return;
	}

	const drop = grounded && !slick
		? Math.max( speed, stop ) * recovery * friction * dt
		: 0;

	const scale = Math.max( 0, speed - drop ) / speed;

	for ( let i = 0; i < 3; i++ ) {
		v[i] = Math.fround( v[i] * scale );
	}
}

/**
 * @exec helper
 * ================
 * PM_CommandScale
 *
 * Scales desired movement speed by usercmd joystick/key inputs [-127..127] (0x515900, 0x515850).
 * Accounts for backwards and strafe movement penalties.
 * ================
 */
export function PM_CommandScale(
	f: number,
	r: number,
	speed: number,
	ground: boolean,
	back: number,
	strafe: number
): number {
	const length = Math.hypot( f, r );

	if ( !length ) {
		return 0;
	}

	const component = ground
		? Math.max( Math.abs( f ) * ( f < 0 ? back : 1 ), Math.abs( r ) * strafe )
		: Math.max( Math.abs( f ), Math.abs( r ) );

	return ( speed * component ) / ( 127 * length );
}


// ---------------------------------------------------------------------------
// jumping & landing recovery
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * PM_JumpFactor
 *
 * Computes jump slowdown recovery coefficient (0x52fd60).
 * Uses binary floating-point coefficient 0x5c3c9c (~0.00088235).
 * ================
 */
export function PM_JumpFactor( time: number, enabled: boolean ): number {
	if ( !enabled ) {
		return 1;
	}

	if ( time >= 1700 ) {
		return 2.5;
	}

	return time * Math.fround( 0.0008823529351502657 ) + 1;
}

/**
 * @exec helper
 * ================
 * PM_LandingRecovery
 *
 * Applies jump landing recovery penalty to walking frame velocity (0x52fbd0).
 * ================
 */
export function PM_LandingRecovery( state: pm_state_t, enabled: boolean ): void {
	const move = state.movement!;

	if ( !move.jumping ) {
		return;
	}

	let scale = 1;

	if ( move.pmTime > 1800 ) {
		scale = Math.fround( 0.65 );
		move.jumping = false;
		move.jumpOrigin = 0;
	} else if ( move.pmTime === 0 ) {
		const high = state.origin[2] >= move.jumpOrigin + 18;
		move.pmTime = high ? 1200 : 1800;
		scale = high ? 0.5 : Math.fround( 0.65 );
	}

	if ( enabled ) {
		for ( let i = 0; i < 3; i++ ) {
			state.velocity[i] = Math.fround( state.velocity[i] * scale );
		}
	}
}

/**
 * @exec helper
 * ================
 * PM_StartJump
 *
 * Imparts initial vertical jump velocity sqrt(2 * gravity * height / factor) (0x52fda0).
 * ================
 */
export function PM_StartJump(
	state: pm_state_t,
	height: number,
	gravity: number,
	enabled: boolean
): void {
	const move = state.movement!;
	const factor = move.jumping && move.pmTime <= 1800 ? PM_JumpFactor( move.pmTime, enabled ) : 1;

	state.velocity[2] = Math.fround(
		Math.sqrt( Math.fround( 2 * Math.trunc( gravity ) * height ) / factor )
	);

	move.jumpTime = move.commandTime;
	move.jumpOrigin = state.origin[2];
	move.pmTime = 0;
	move.jumping = true;
}

/**
 * @exec helper
 * ================
 * PM_CrashLand
 *
 * Evaluates fall damage and landing impact events on transition from airborne to ground (0x51726a, 0x516cca).
 * ================
 */
function PM_CrashLand(
	state: pm_state_t,
	startZ: number,
	velocityZ: number,
	flags: number
): void {
	const height = Landing_Height( startZ, state.origin[2], velocityZ, PM_Dvar( 'g_gravity', PM_DEFAULT_GRAVITY ) );
	const amount = Landing_Amount( height );
	const sound = Landing_SoundKind( height );

	if ( sound ) {
		Movement_Emit( state.movement!, sound, flags );
	}

	if ( height < 12 ) {
		return;
	}

	const move = state.movement!;
	const sequence = ( move.landSequence ?? 0 ) + 1;
	move.landSequence = sequence;

	move.landEvents = [...( move.landEvents ?? [] ), { sequence, amount, height }].slice( -4 );

	for ( let i = 0; i < 3; i++ ) {
		state.velocity[i] = Math.fround( state.velocity[i] * Math.fround( 0.67 ) );
	}
}


// ---------------------------------------------------------------------------
// swept collision trace pipeline
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * PM_Trace
 *
 * Sweeps player bounding capsule from start to end using standing dimensions.
 * ================
 */
export function PM_Trace( start: vec3_t, end: vec3_t ): pm_trace_t {
	return PM_TraceShape( start, end, STANDING_CAPSULE );
}

/**
 * @exec helper
 * ================
 * PM_TraceShape
 *
 * Sweeps arbitrary capsule shape against static world collision geometry and mantle brushes.
 * Queries static BVH broadphase, checks triangle proxy polygons and convex brush bounding planes (0x41c0e6..0x41c140).
 * ================
 */
export function PM_TraceShape(
	start: vec3_t,
	end: vec3_t,
	shape: capsule_shape_t,
	mantle: boolean = false,
	contentsMask: number = 0x10001
): pm_trace_t {
	const out: pm_trace_t = {
		fraction: 1,
		normal: [0, 0, 0],
		startsolid: false,
		allsolid: false,
		surfaceFlags: 0,
	};

	const collision = mantle ? Level_Data()?.manifest.mantle : Level_Data()?.manifest.collision;

	if ( mantle && !collision ) {
		return out;
	}

	if ( !collision ) {
		if ( start[2] < 64 ) {
			out.startsolid = true;
			out.allsolid = end[2] < 64;

			if ( out.allsolid ) {
				out.fraction = 0;
			}
		} else if ( end[2] < 64 ) {
			out.fraction = ( start[2] - 64 ) / ( start[2] - end[2] );
			out.normal = [0, 0, 1];
		}

		return out;
	}

	// Compute the same epsilon-expanded swept bounds once, then query static BVH.
	const width = shape.radius + 0.125;
	const top = shape.offset + shape.half + width;
	const bottom = shape.offset - shape.half - width;
	const minX = Math.min( start[0], end[0] ) - width;
	const maxX = Math.max( start[0], end[0] ) + width;
	const minY = Math.min( start[1], end[1] ) - width;
	const maxY = Math.max( start[1], end[1] ) + width;
	const minZ = Math.min( start[2], end[2] ) + bottom;
	const maxZ = Math.max( start[2], end[2] ) + top;

	const candidates = Collision_QueryBounds( collision, minX, maxX, minY, maxY, minZ, maxZ );

	for ( let candidate = 0; candidate < candidates.length; candidate++ ) {
		const brushIndex = candidates[candidate];
		const brush = collision[brushIndex];

		if ( !mantle && !( brush.contents & contentsMask ) ) {
			continue;
		}

		const b = brush.bounds;

		if ( brush.triangle ) {
			const hit = Capsule_TraceTriangle(
				start,
				end,
				brush.triangle,
				brush.planes[0].slice( 0, 3 ) as vec3_t,
				shape
			);

			if ( hit?.startsolid ) {
				out.startsolid = true;
				( out.startSolidBrushes ??= [] ).push( brushIndex );

				if ( hit.allsolid ) {
					out.allsolid = true;
					out.fraction = 0;
				}
			}

			if ( hit && !hit.startsolid && hit.fraction < out.fraction ) {
				out.fraction = hit.fraction;
				out.normal = hit.normal;
				out.hitBrush = brushIndex;
				out.surfaceFlags = brush.surfaceFlags?.[0] ?? 0;
			}

			continue;
		}

		let enter = 0;
		let leave = 1;
		let outside = false;
		let endOutside = false;
		let rejected = false;
		let selected = false;
		let side = 0;
		let hit: vec3_t = [0, 0, 0];

		// Triangle proxies do not contain axial bevel planes. Their AABB must
		// constrain the narrow phase too; a swept broad-phase overlap alone
		// does not mean the starting player box overlaps this convex volume.
		for ( let index = 0; index < brush.planes.length + 6; index++ ) {
			const axial = index - brush.planes.length;
			const axis = Math.floor( axial / 2 );
			const positive = axial % 2 === 1;

			const p = index < brush.planes.length
				? brush.planes[index]
				: [
					axis === 0 ? ( positive ? 1 : -1 ) : 0,
					axis === 1 ? ( positive ? 1 : -1 ) : 0,
					axis === 2 ? ( positive ? 1 : -1 ) : 0,
					positive ? b[axial] : -b[axial],
				];

			// 0x41c0e6..0x41c0f4 expands real brush planes by the capsule:
			// radius + abs(axisHalf * normal.z), with center 25 below eye.
			const distance = p[3] + (
				brush.surfaceFlags
					? shape.radius + shape.half * Math.abs( p[2] ) - shape.offset * p[2]
					: 15 * ( Math.abs( p[0] ) + Math.abs( p[1] ) ) + ( p[2] >= 0 ? 60 * p[2] : -10 * p[2] )
			);

			const a = PM_Dot( start, p as vec3_t ) - distance;
			const z = PM_Dot( end, p as vec3_t ) - distance;

			if ( a > 0 ) {
				outside = true;
			}

			if ( z > 0 ) {
				endOutside = true;
			}

			// 0x41bf87 / 0x41c140: outside endpoint must approach past min(start distance, epsilon).
			if ( a > 0 && z >= Math.min( a, 0.125 ) ) {
				rejected = true;
				break;
			}

			if ( a <= 0 && z <= 0 ) {
				continue;
			}

			if ( a > z ) {
				const t = ( a - 0.125 ) / ( a - z );

				if ( t > enter || !selected ) {
					enter = Math.max( enter, t );
					selected = true;
					hit = [p[0], p[1], p[2]];
					side = index;
				}
			} else {
				leave = Math.min( leave, a / ( a - z ) );
			}
		}

		if ( rejected ) {
			continue;
		}

		if ( !outside ) {
			out.startsolid = true;
			( out.startSolidBrushes ??= [] ).push( brushIndex );

			if ( !endOutside ) {
				out.allsolid = true;
				out.fraction = 0;
			}

			continue;
		}

		if ( selected && enter < leave && enter < out.fraction ) {
			out.fraction = enter;
			out.normal = hit;
			out.surfaceFlags = brush.surfaceFlags?.[side] ?? 0;
			out.hitBrush = brushIndex;
		}
	}

	return out;
}


// ---------------------------------------------------------------------------
// multi-plane slide move
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * PM_Slide
 *
 * Handles multi-bump collision sliding and crease reflections across contact planes (0x530210).
 * Midpoint gravity integration clips velocity against up to 4 sequential contact collisions.
 * ================
 */
function PM_Slide(
	state: pm_state_t,
	dt: number,
	gravity: number,
	ground: pm_trace_t | null,
	trace: pm_trace_fn
): boolean {
	const primal = [...state.velocity] as vec3_t;
	const endVelocity = [...state.velocity] as vec3_t;

	if ( gravity ) {
		endVelocity[2] = Math.fround( state.velocity[2] - gravity * dt );
		state.velocity[2] = Math.fround( ( state.velocity[2] + endVelocity[2] ) * 0.5 );
		primal[2] = endVelocity[2];

		if ( ground ) {
			state.velocity = PM_ClipVelocity( state.velocity, ground.normal );
		}
	}

	const planes: vec3_t[] = ground ? [[...ground.normal]] : [];
	const direction = [...state.velocity] as vec3_t;
	PM_Normalize( direction );
	planes.push( direction );

	let remaining = dt;
	let blocked = false;

	for ( let bump = 0; bump < 4; bump++ ) {
		const end = state.origin.map( ( x, i ) => Math.fround( x + state.velocity[i] * remaining ) ) as vec3_t;
		const hit = trace( state.origin, end );

		if ( hit.allsolid ) {
			state.velocity[2] = 0;
			return true;
		}

		for ( let i = 0; i < 3; i++ ) {
			state.origin[i] = Math.fround( state.origin[i] + ( end[i] - state.origin[i] ) * hit.fraction );
		}

		if ( hit.fraction === 1 ) {
			break;
		}

		blocked = true;
		remaining *= 1 - hit.fraction;

		if ( planes.some( ( n ) => PM_Dot( n, hit.normal ) > 0.99 ) ) {
			for ( let i = 0; i < 3; i++ ) {
				state.velocity[i] += hit.normal[i];
			}
			continue;
		}

		if ( planes.length >= 8 ) {
			state.velocity.fill( 0 );
			return true;
		}

		planes.push( hit.normal );

		const ordered = [...planes].sort(
			( a, b ) => PM_Dot( state.velocity, a ) - PM_Dot( state.velocity, b )
		);

		for ( let i = 0; i < ordered.length; i++ ) {
			const n = ordered[i];

			if ( PM_Dot( state.velocity, n ) >= 0.1 ) {
				continue;
			}

			let clipped = PM_ClipVelocity( state.velocity, n );
			let endClipped = PM_ClipVelocity( endVelocity, n );

			for ( let j = 0; j < ordered.length; j++ ) {
				if ( j === i || PM_Dot( clipped, ordered[j] ) >= 0.1 ) {
					continue;
				}

				clipped = PM_ClipVelocity( clipped, ordered[j] );
				endClipped = PM_ClipVelocity( endClipped, ordered[j] );

				if ( PM_Dot( clipped, n ) >= 0 ) {
					continue;
				}

				const b = ordered[j];
				const crease: vec3_t = [
					n[1] * b[2] - n[2] * b[1],
					n[2] * b[0] - n[0] * b[2],
					n[0] * b[1] - n[1] * b[0],
				];
				PM_Normalize( crease );

				const along = PM_Dot( crease, state.velocity );
				const endAlong = PM_Dot( crease, endVelocity );

				clipped = crease.map( ( x ) => Math.fround( x * along ) ) as vec3_t;
				endClipped = crease.map( ( x ) => Math.fround( x * endAlong ) ) as vec3_t;

				if ( ordered.some( ( p, k ) => k !== i && k !== j && PM_Dot( clipped, p ) < 0.1 ) ) {
					state.velocity.fill( 0 );
					return true;
				}
			}

			state.velocity = clipped;

			for ( let k = 0; k < 3; k++ ) {
				endVelocity[k] = endClipped[k];
			}
			break;
		}
	}

	if ( gravity ) {
		state.velocity = endVelocity;
	}

	if ( state.movement!.pmTime ) {
		state.velocity = primal;
	}

	return blocked;
}


// ---------------------------------------------------------------------------
// stair step climbing & obstacle negotiation
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * PM_StepImproves
 *
 * Verifies that candidate step position makes positive forward progress along velocity vector (0x530e3d..0x530e70).
 * ================
 */
export function PM_StepImproves(
	start: vec3_t,
	normal: vec3_t,
	candidate: vec3_t,
	velocity: vec3_t
): boolean {
	return (
		( candidate[0] - start[0] ) * velocity[0] + ( candidate[1] - start[1] ) * velocity[1] >
		( normal[0] - start[0] ) * velocity[0] + ( normal[1] - start[1] ) * velocity[1] + Math.fround( 0.001 )
	);
}

/**
 * @exec helper
 * ================
 * PM_StepEvent
 *
 * Emits EV_STEP event and scales post-step horizontal velocity (0x530fce..0x53108f).
 * ================
 */
export function PM_StepEvent(
	state: pm_state_t,
	startZ: number,
	normalZ: number,
	stepHeight: number
): void {
	const delta = Math.fround( state.origin[2] - normalZ );

	if ( Math.abs( delta ) <= 0.5 ) {
		return;
	}

	const amount = Math.max( -16, Math.min( 24, PM_Snap( delta + 9.313225746154785e-10 ) ) );

	if ( !amount ) {
		return;
	}

	const move = state.movement!;
	const sequence = ( move.stepSequence ?? 0 ) + 1;
	move.stepSequence = sequence;

	move.stepEvents = [...( move.stepEvents ?? [] ), { sequence, delta: amount }].slice( -4 );

	const scale = ( 1 - Math.abs( state.origin[2] - startZ ) / stepHeight ) * Math.fround( 0.8 ) +
		Math.fround( 0.19999998807907104 );

	for ( let i = 0; i < 3; i++ ) {
		state.velocity[i] = Math.fround( state.velocity[i] * scale );
	}
}

/**
 * @exec helper
 * ================
 * PM_StepSlide
 *
 * Evaluates obstacle step-up path, downward settle trace, and candidate evaluation (0x530a30).
 * Steps over curb heights up to 18 units while walking.
 * ================
 */
function PM_StepSlide(
	state: pm_state_t,
	dt: number,
	gravity: number,
	ground: pm_trace_t | null,
	trace: pm_trace_fn
): void {
	const start = [...state.origin] as vec3_t;
	const velocity = [...state.velocity] as vec3_t;
	const ladder = Boolean( state.movement?.ladder );

	if ( ladder ) {
		state.movement!.jumping = false;
		state.movement!.jumpOrigin = 0;
	}

	const blocked = PM_Slide( state, dt, gravity, ground, trace );
	const walking = !ladder && Boolean( ground ) && ground!.normal[2] >= 0.7;

	let step = state.movement?.stance?.target === 11 ? 10 : 18;
	let riseHeight = 0;
	const move = state.movement!;

	if ( !walking ) {
		if ( ladder ) {
			if ( !blocked || state.velocity[2] <= 0 ) {
				return;
			}
		} else {
			if ( !blocked || !move.jumping || move.pmTime ) {
				return;
			}

			step = Math.min(
				PM_Dvar( 'jump_stepSize', PM_DEFAULT_STEP_SIZE ),
				move.jumpOrigin + PM_Dvar( 'jump_height', PM_DEFAULT_JUMP_HEIGHT ) - start[2]
			);

			if ( step <= 1 ) {
				return;
			}
		}
	}

	const normalOrigin = [...state.origin] as vec3_t;
	const normalVelocity = [...state.velocity] as vec3_t;

	if ( blocked ) {
		const rise = trace( start, [start[0], start[1], start[2] + step + 1] );
		riseHeight = Math.fround( ( step + 1 ) * rise.fraction - 1 );

		if ( rise.allsolid || riseHeight < 1 ) {
			riseHeight = 0;
		}

		if ( riseHeight ) {
			state.origin = [start[0], start[1], Math.fround( start[2] + riseHeight )];
			state.velocity = [...velocity];
			PM_Slide( state, dt, gravity, ground, trace );
		}
	}

	if ( walking || riseHeight ) {
		const down: vec3_t = [
			state.origin[0],
			state.origin[1],
			state.origin[2] - riseHeight - ( walking ? 9 : 0 ),
		];
		const fall = trace( state.origin, down );

		if ( fall.allsolid || ( fall.fraction < 1 && fall.normal[2] < Math.fround( 0.3 ) ) ) {
			state.origin = normalOrigin;
			state.velocity = normalVelocity;
			return;
		}

		if ( fall.fraction < 1 ) {
			state.origin[2] = Math.fround( state.origin[2] + ( down[2] - state.origin[2] ) * fall.fraction );
			state.velocity = PM_ClipVelocity( state.velocity, fall.normal );
		} else if ( riseHeight ) {
			state.origin[2] = Math.fround( state.origin[2] - riseHeight );
		}
	}

	if ( !PM_StepImproves( start, normalOrigin, state.origin, state.velocity ) ) {
		state.origin = [...normalOrigin];
		state.velocity = [...normalVelocity];

		if ( walking ) {
			const down: vec3_t = [state.origin[0], state.origin[1], state.origin[2] - 9];
			const fall = trace( state.origin, down );

			if ( !fall.allsolid && fall.fraction < 1 ) {
				state.origin[2] = Math.fround( state.origin[2] + ( down[2] - state.origin[2] ) * fall.fraction );
				state.velocity = PM_ClipVelocity( state.velocity, fall.normal );
			}
		}
	}

	if ( !walking && move.jumping && state.origin[2] > normalOrigin[2] ) {
		const left = move.jumpOrigin + PM_Dvar( 'jump_height', PM_DEFAULT_JUMP_HEIGHT ) - state.origin[2];

		state.velocity[2] = left < 0.1
			? 0
			: Math.min( state.velocity[2], Math.sqrt( 2 * PM_Dvar( 'g_gravity', PM_DEFAULT_GRAVITY ) * left ) );
	}

	if ( walking ) {
		PM_StepEvent( state, start[2], normalOrigin[2], step );
	}
}


// ---------------------------------------------------------------------------
// ground detection & 26-direction unstick
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * PM_Ground
 *
 * Probes ground surface beneath player (0x516ff0).
 * If initial trace begins in solid, executes the 26-direction spatial unsticking grid (0x516d10, 0x5a14a0).
 * ================
 */
function PM_Ground( state: pm_state_t, trace: pm_trace_fn ): pm_trace_t | null {
	let hit = trace( state.origin, [state.origin[0], state.origin[1], state.origin[2] - 0.25] );

	if ( hit.allsolid ) {
		// 0x516d10, in the exact order of the 26 offsets at 0x5a14a0.
		const offsets: vec3_t[] = [
			[0, 0, 1], [-1, 0, 1], [0, -1, 1], [1, 0, 1], [0, 1, 1],
			[-1, 0, 0], [0, -1, 0], [1, 0, 0], [0, 1, 0], [0, 0, -1],
			[-1, 0, -1], [0, -1, -1], [1, 0, -1], [0, 1, -1],
			[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
			[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0],
			[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
		];

		let recovered = false;

		for ( const offset of offsets ) {
			const point = state.origin.map( ( x, i ) => Math.fround( x + offset[i] ) ) as vec3_t;

			if ( trace( point, point ).startsolid ) {
				continue;
			}

			state.origin = point;
			const down: vec3_t = [point[0], point[1], point[2] - 1];
			hit = trace( point, down );

			for ( let i = 0; i < 3; i++ ) {
				state.origin[i] = Math.fround( point[i] + ( down[i] - point[i] ) * hit.fraction );
			}

			recovered = true;
			break;
		}

		if ( !recovered ) {
			if ( state.movement ) {
				state.movement.jumping = false;
				state.movement.jumpOrigin = 0;
			}
			return null;
		}
	}

	return hit.fraction < 1 &&
		!hit.allsolid &&
		!( state.velocity[2] > 0 && !state.movement?.ladder && PM_Dot( state.velocity, hit.normal ) > 10 )
		? hit
		: null;
}


// ---------------------------------------------------------------------------
// single-slice player locomotion
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * PM_MoveSingle
 *
 * Executes a single discrete movement time slice (<= 66ms) (0x518f00).
 * Evaluates stance, mantling, ladder interactions, corner leaning, jump inputs,
 * acceleration, and ground settling.
 * ================
 */
function PM_MoveSingle(
	state: pm_state_t,
	cmd: usercmd_t,
	msec: number,
	trace: pm_trace_fn,
	worldTrace: boolean
): void {
	const move = state.movement!;
	const dt = Math.fround( msec * 0.001 );
	const slow = PM_Dvar( 'jump_slowdownEnable', 1 ) !== 0;
	const start = [...state.origin] as vec3_t;
	const startVelocityZ = state.velocity[2];

	move.commandTime += msec;
	let effectiveButtons = cmd.buttons;
	let stance = cmd.stance ?? move.stance?.target ?? 60;

	if ( move.mantle?.active && move.mantle.crouched ) {
		stance = 40;
	}

	if (
		stance > ( move.stance?.target ?? 60 ) &&
		worldTrace &&
		PM_TraceShape( state.origin, state.origin, Stance_Shape( stance ) ).startsolid
	) {
		stance = move.stance!.target;
	}

	if ( ( cmd.buttons & IN_JUMP ) && move.stance && move.stance.height < 60 ) {
		move.standJumpBlocked = true;
	}

	if ( !( cmd.buttons & IN_JUMP ) ) {
		move.standJumpBlocked = false;
	}

	if ( move.standJumpBlocked ) {
		effectiveButtons &= ~IN_JUMP;
	}

	move.stance = Stance_Advance( move.stance, stance, msec );

	// 0x5126f0 tests authored mantle surfaces; 0x5128a0 owns movement while traversing.
	if ( worldTrace ) {
		if ( !move.mantle?.active ) {
			move.mantle = stance === 11 ? undefined : Mantle_Check( state, PM_TraceShape ) ?? undefined;
		} else {
			move.mantle = { ...move.mantle };
		}

		if ( move.mantle && Mantle_Move( state, move.mantle, cmd, msec ) ) {
			move.grounded = false;
			move.oldButtons = cmd.buttons;

			if ( !move.mantle.active ) {
				move.mantle = undefined;
			}
			return;
		}
	}

	if ( move.pmTime ) {
		move.pmTime = Math.max( 0, move.pmTime - msec );

		if ( !move.pmTime ) {
			move.jumping = false;
			move.jumpOrigin = 0;
		}
	}

	let ground = PM_Ground( state, trace );
	let walking = Boolean( ground ) && ground!.normal[2] >= 0.7;

	const forward: vec3_t = [0, 0, 0];
	const right: vec3_t = [0, 0, 0];
	const up: vec3_t = [0, 0, 0];
	AngleVectors( state.angles, forward, right, up );

	const fm = Math.max( -127, Math.min( 127, cmd.forwardmove ) );
	const rm = Math.max( -127, Math.min( 127, cmd.sidemove ) );

	if ( worldTrace ) {
		Ladder_Check(
			move,
			state.origin,
			forward,
			fm,
			walking,
			stance,
			( a, b, shape ) => {
				const hit = PM_TraceShape( a, b, shape );
				MovementRecord_Trace( a, b, hit );
				return hit;
			}
		);
	}

	const leanDirection = walking
		? Number( Boolean( cmd.buttons & IN_LEANRIGHT ) ) - Number( Boolean( cmd.buttons & IN_LEANLEFT ) )
		: 0;

	move.lean = Lean_Advance( move.lean ?? 0, leanDirection, msec, stance );

	if ( worldTrace && move.lean ) {
		const eye: vec3_t = [
			state.origin[0],
			state.origin[1],
			state.origin[2] + move.stance.height - 60,
		];
		const end = Lean_Origin( eye, state.angles[1], Math.sign( move.lean ) );
		const hit = PM_TraceShape( eye, end, { radius: 8, half: 0, offset: 0 } );

		move.lean = Lean_Clamp( move.lean, hit.startsolid ? 0 : hit.fraction );
	}

	if ( walking && !move.grounded ) {
		PM_CrashLand( state, start[2], startVelocityZ, ground!.surfaceFlags );
	}

	if ( walking ) {
		PM_LandingRecovery( state, slow );
	}

	// 0x52ffe4 clears the current jump bit when oldcmd has it.
	if ( ( walking || move.ladder ) && move.commandTime - move.jumpTime >= 500 && ( move.oldButtons & IN_JUMP ) ) {
		effectiveButtons &= ~IN_JUMP;
	}

	if (
		( walking || move.ladder ) &&
		stance === 60 &&
		( effectiveButtons & IN_JUMP ) &&
		move.commandTime - move.jumpTime >= 500
	) {
		Movement_Emit( move, 'jump', move.ladder?.surfaceFlags ?? ground!.surfaceFlags );
		PM_StartJump( state, PM_Dvar( 'jump_height', PM_DEFAULT_JUMP_HEIGHT ), PM_Dvar( 'g_gravity', PM_DEFAULT_GRAVITY ), slow );
		ground = null;
		walking = false;

		if ( move.ladder ) {
			state.velocity = Ladder_Jump(
				state.velocity,
				forward,
				move.ladder.normal,
				PM_Dvar( 'jump_ladderPushVel', PM_DEFAULT_LADDER_PUSH_VEL )
			);
			move.ladder = undefined;
		}
	}

	if ( move.ladder ) {
		const ladder = move.ladder;
		const { wish, side } = Ladder_Wish(
			forward,
			right,
			ladder.normal,
			fm,
			rm,
			PM_Dvar( 'g_speed', PM_DEFAULT_SPEED ),
			Boolean( move.lean )
		);

		state.velocity = Ladder_Velocity(
			state.velocity,
			wish,
			side,
			ladder.normal,
			fm,
			rm,
			dt,
			PM_Dvar( 'g_gravity', PM_DEFAULT_GRAVITY ),
			walking
		);

		PM_StepSlide( state, dt, 0, ground, trace );
	} else {
		const stop = PM_Dvar( 'stopspeed', PM_DEFAULT_STOPSPEED );
		const slick = Boolean( ground && ( ground.surfaceFlags & 2 ) );

		PM_Friction(
			state.velocity,
			walking,
			slick,
			dt,
			PM_Dvar( 'friction', PM_DEFAULT_FRICTION ),
			stop,
			move.jumping ? PM_JumpFactor( move.pmTime, slow ) : 1
		);

		forward[2] = 0;
		right[2] = 0;

		let f = forward;
		let r = right;

		if ( walking ) {
			f = PM_ClipVelocity( f, ground!.normal );
			r = PM_ClipVelocity( r, ground!.normal );
		}

		PM_Normalize( f );
		PM_Normalize( r );

		const wish = f.map( ( x, i ) => Math.fround( x * fm + r[i] * rm ) ) as vec3_t;
		const length = PM_Normalize( wish );

		let scale = PM_CommandScale(
			fm,
			rm,
			PM_Dvar( 'g_speed', PM_DEFAULT_SPEED ),
			walking,
			PM_Dvar( 'player_backSpeedScale', PM_DEFAULT_BACK_SPEED_SCALE ),
			PM_Dvar( 'player_strafeSpeedScale', PM_DEFAULT_STRAFE_SPEED_SCALE )
		);

		// Aiming and leaning share movement penalty (0x5159a6..0x5159df).
		if ( walking && ( move.weapon?.adsIn || move.lean ) ) {
			scale *= Math.fround( 0.4 );
		}

		const weapon = weapons[Cvar_Get( 'ui_weapon' ) as keyof typeof weapons];
		const weaponScale = weapon && 'moveSpeedScale' in weapon ? Number( weapon.moveSpeedScale ) : 1;

		if ( walking && weaponScale > 0 ) {
			scale *= weaponScale;
		}

		if ( walking ) {
			scale *= stance === 11 ? Math.fround( 0.15 ) : stance === 40 ? Math.fround( 0.65 ) : 1;
		}

		PM_Accelerate(
			state.velocity,
			wish,
			length * scale,
			walking && !slick ? ( stance === 11 ? 19 : stance === 40 ? 12 : 9 ) : 1,
			dt,
			stop,
			move.oldVelocity
		);

		if ( ground ) {
			const magnitude = Math.hypot( ...state.velocity );
			const original = state.velocity;
			state.velocity = PM_ClipVelocity( original, ground.normal );

			if ( walking && PM_Dot( original, state.velocity ) > 0 ) {
				PM_Normalize( state.velocity );

				for ( let i = 0; i < 3; i++ ) {
					state.velocity[i] = Math.fround( state.velocity[i] * magnitude );
				}
			}
		}

		PM_StepSlide( state, dt, walking && !slick ? 0 : PM_Dvar( 'g_gravity', PM_DEFAULT_GRAVITY ), ground, trace );
	}

	const after = PM_Ground( state, trace );
	move.grounded = Boolean( after ) && after!.normal[2] >= 0.7;

	if ( move.grounded && !walking ) {
		PM_CrashLand( state, start[2], startVelocityZ, after!.surfaceFlags );
	}

	if ( move.ladder && !move.grounded && move.commandTime - move.jumpTime >= 300 ) {
		const cycle = Movement_LadderCycle( move.bobCycle ?? 0, msec, state.velocity[2], Boolean( move.lean ), move.bobFraction ?? 0 );
		move.bobCycle = cycle.cycle;
		move.bobFraction = cycle.fraction;

		if ( cycle.step ) {
			Movement_Emit(
				move,
				'run',
				move.ladder.surfaceFlags & 0x1f00000 ? move.ladder.surfaceFlags : 21 << 20
			);
		}
	} else if ( move.grounded ) {
		const speed = Math.hypot( state.velocity[0], state.velocity[1] );
		const kind = stance === 11 ? 'prone' : move.lean ? 'walk' : 'run';

		if ( speed > PM_Dvar( 'player_moveThreshhold', PM_DEFAULT_MOVE_THRESHOLD ) ) {
			const rate = Movement_Rate(
				speed,
				PM_Dvar( 'g_speed', PM_DEFAULT_SPEED ),
				fm,
				rm,
				move.stance,
				Boolean( move.lean ),
				PM_Dvar( 'player_backSpeedScale', PM_DEFAULT_BACK_SPEED_SCALE ),
				PM_Dvar( 'player_strafeSpeedScale', PM_DEFAULT_STRAFE_SPEED_SCALE )
			);

			const cycle = Movement_Cycle( move.bobCycle ?? 0, msec, rate, move.bobFraction ?? 0 );
			move.bobCycle = cycle.cycle;
			move.bobFraction = cycle.fraction;

			if ( cycle.step && ( fm || rm ) ) {
				Movement_Emit( move, kind, after!.surfaceFlags );
			}
		} else if ( speed < 1 ) {
			move.bobCycle = 0;
			move.bobFraction = 0;
		}
	}

	move.oldButtons = effectiveButtons;

	// 0x51adce..0x51aeb4: collision-displacement velocity correction and history.
	const actual = state.origin.map( ( x, i ) => ( x - start[i] ) / dt ) as vec3_t;

	if ( PM_Dot( actual, actual) < PM_Dot( state.velocity, state.velocity ) * 0.25 ) {
		state.velocity = actual.map( Math.fround ) as vec3_t;
	}

	const old = move.oldVelocity ?? [0, 0, 0];
	move.oldVelocity = [
		Math.fround( old[0] + dt * ( state.velocity[0] - old[0] ) ),
		Math.fround( old[1] + dt * ( state.velocity[1] - old[1] ) ),
		0,
	];

	for ( let i = 0; i < 3; i++ ) {
		state.velocity[i] = PM_Snap( state.velocity[i] );
	}
}


// ---------------------------------------------------------------------------
// command time slicing & weapon firing
// ---------------------------------------------------------------------------

/**
 * @exec per-frame
 * ================
 * PM_ApplyUsercmd
 *
 * Slices arbitrary frame delta time into <= 66ms discrete command sub-steps (0x51aee0).
 * Handles weapon simulation, recoil impulse, bullet spread raycasting, and shot impacts.
 * ================
 */
export function PM_ApplyUsercmd(
	state: pm_state_t,
	cmd: usercmd_t,
	dt: number,
	trace: pm_trace_fn = PM_Trace,
	source: string = 'simulation'
): void {
	const capture = MovementRecord_Begin( state, cmd, dt, source );
	const originalTrace = trace;

	if ( originalTrace === PM_Trace ) {
		trace = ( start, end ) =>
			PM_TraceShape( start, end, Stance_Shape( state.movement?.stance?.target ?? 60 ) );
	}

	const movementTrace = trace;

	if ( capture ) {
		trace = ( start, end ) => {
			const result = movementTrace( start, end );
			MovementRecord_Trace( start, end, result );
			return result;
		};
	}

	if ( !state.movement ) {
		state.movement = {
			commandTime: 0,
			remainder: 0,
			oldButtons: 0,
			jumpTime: -500,
			jumpOrigin: 0,
			jumping: false,
			pmTime: 0,
			grounded: false,
		};
	}

	state.angles = [...cmd.viewangles];
	const move = state.movement;
	move.remainder += Math.max( 0, dt ) * 1000;
	let remaining = Math.floor( move.remainder + 1e-7 );
	move.remainder -= remaining;

	if ( remaining > 1000 ) {
		move.commandTime += remaining - 1000;
		remaining = 1000;
	}

	while ( remaining > 0 ) {
		const slice = Math.min( 66, remaining );
		PM_MoveSingle( state, cmd, slice, trace, originalTrace === PM_Trace );

		Weapon_Update(
			move,
			cmd.buttons,
			slice,
			Cvar_Get( 'ui_weapon' ),
			Cvar_Get( 'cl_ingame' ) === '1',
			() => {
				const forward: vec3_t = [0, 0, 0];
				const right: vec3_t = [0, 0, 0];
				const up: vec3_t = [0, 0, 0];
				AngleVectors( state.angles, forward, right, up );

				// Firing uses the leaned eye (0x527dd3 -> 0x4fdcc0 -> 0x4fdf4b).
				const start = Lean_Origin(
					[
						state.origin[0],
						state.origin[1],
						state.origin[2] + ( move.stance?.height ?? 60 ) - 60,
					],
					state.angles[1],
					move.lean ?? 0
				);

				start[2] = Math.max( start[2], state.origin[2] - 60 + 8 );

				const weapon = move.weapon!;
				const def: Record<string, string> = weapons[weapon.id as keyof typeof weapons];
				const spread = WeaponSpread_ShotAngle(
					def,
					weapon.spread ?? 0,
					move.stance?.height ?? 60,
					weapon.ads
				);
				const pellets = def.weaponClass === 'spread'
					? Math.max( 0, Math.trunc( Number( def.shotCount ) ) )
					: 1;
				const range = def.weaponClass === 'spread'
					? Number( def.minDamageRange )
					: 8192;

				const random = () => {
					const motion = weapon.motion!;
					motion.seed = ( Math.imul( motion.seed, 214013 ) + 2531011 ) | 0;
					return ( motion.seed >>> 16 ) & 32767;
				};

				for ( let pellet = 0; pellet < pellets; pellet++ ) {
					const end = WeaponSpread_End(
						start,
						forward,
						right,
						up,
						spread,
						range,
						random(),
						random()
					) as vec3_t;

					const delta = end.map( ( v, i ) => v - start[i] );
					const length = Math.hypot( ...delta ) || 1;
					const direction = delta.map( ( v ) => v / length );

					const hit = PM_TraceShape(
						start,
						end,
						{ radius: 0, half: 0, offset: 0 },
						false,
						0x2802831
					);

					MovementRecord_Trace( start, end, hit );

					if ( hit.fraction < 1 ) {
						move.shotImpact = {
							position: start.map( ( x, i ) => x + ( end[i] - x ) * hit.fraction ) as vec3_t,
							normal: hit.normal,
							surfaceFlags: hit.surfaceFlags,
							time: move.commandTime,
						};
					}

					weapon.shots = [
						...( weapon.shots ?? [] ).filter( ( s ) => move.commandTime - s.time < 15000 ),
						{
							sequence: weapon.sequence,
							pellet,
							time: move.commandTime,
							position: start.map( ( x, i ) => x + ( end[i] - x ) * hit.fraction ),
							normal: [...hit.normal],
							direction,
							surfaceFlags: hit.surfaceFlags,
							hit: hit.fraction < 1,
						},
					].slice( -128 );
				}
			},
			{
				speed: Math.hypot( state.velocity[0], state.velocity[1] ),
				moving: cmd.forwardmove !== 0 || cmd.sidemove !== 0,
				angles: state.angles,
			}
		);

		remaining -= slice;
	}

	if ( capture ) {
		MovementRecord_End( state );
	}
}


// ---------------------------------------------------------------------------
// state duplication
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * PM_StateFromPlayer
 *
 * Deep copies movement state timers, history, and velocities for client-side prediction.
 * ================
 */
export function PM_StateFromPlayer(
	origin: vec3_t,
	angles: vec3_t,
	velocity: vec3_t,
	movement?: pm_movement_t
): pm_state_t {
	return {
		origin: [...origin],
		angles: [...angles],
		velocity: [...velocity],
		movement: movement
			? {
				...movement,
				oldVelocity: movement.oldVelocity ? [...movement.oldVelocity] : undefined,
			}
			: undefined,
	};
}
