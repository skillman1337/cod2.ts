/*
===============================================================================

	character_controllers.ts

	Call of Duty 2 / id Tech Player Skeletal Bone Controllers
	BG_Player_DoControllers: 0x182b82; DObjSetLocalTagInternal: 0x74cbe.
	Evaluates procedural bone aim angles, spine twist distribution,
	ground pitch conformance, leaning displacement, and Quake-style fast inverse sqrt lerp.

===============================================================================
*/

import type { vec3_t } from './types.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const EF_CROUCHING            = 0x00000004;
export const EF_PRONE                = 0x00000008;
export const EF_DEAD_OR_SPECTATOR    = 0x00000300;
export const EF_LEGS_YAW             = 0x00020000;

export const MOVETYPE_MASK           = 0x000c0000;

export const ANGLE_HALF_CIRCLE       = 180;
export const ANGLE_FULL_CIRCLE       = 360;


// ---------------------------------------------------------------------------
// types & tags
// ---------------------------------------------------------------------------

export const CHARACTER_CONTROL_TAGS = [
	'back_low',
	'back_mid',
	'back_up',
	'neck',
	'head',
	'pelvis',
] as const;

/**
 * The actual inputs consumed by BG_Player_DoControllers. Keep these separate
 * from the presentation camera (which may include lean, recoil or third person).
 */
export interface character_controller_input_t {
	playerAngles: vec3_t;
	legsYaw: number;
	torsoYaw: number;
	torsoPitch: number;
	lean: number;
	/** Native entityState.eFlags (prone=8, crouch=4). */
	eFlags: number;
	/** Native clientInfo.conditions[ANIM_COND_MOVETYPE][0]. */
	moveTypeBits?: number;
	/** Native entityState ground-conformance values, not the camera stance height. */
	groundTorsoPitch?: number;
	groundWaistPitch?: number;
	torsoHeight?: number;
}

export interface character_controller_state_t {
	angles: vec3_t[];
	originAngles: vec3_t;
	originOffset: vec3_t;
}

export interface character_bone_override_t {
	q: number[];
	p: number[];
	/** DObj control bit: pre-multiply the parent orientation in OBJECT space. */
	control: boolean;
}

export type character_bone_overrides_t = ReadonlyMap<string, character_bone_override_t>;


// ---------------------------------------------------------------------------
// angle arithmetic & fast inverse square root
// ---------------------------------------------------------------------------

const f = Math.fround;
const add = ( a: number, b: number ): number => f( f( a ) + f( b ) );
const mul = ( a: number, b: number ): number => f( f( a ) * f( b ) );

const rsqrtFloat = new Float32Array( 1 );
const rsqrtBits = new Int32Array( rsqrtFloat.buffer );

/**
 * @exec helper
 * ================
 * Character_AngleSubtract
 *
 * Normalizes angular difference between two angle values into [-180, 180] degrees.
 * ================
 */
export function Character_AngleSubtract( a: number, b: number ): number {
	let angle = f( a - b ) % ANGLE_FULL_CIRCLE;

	if ( angle > ANGLE_HALF_CIRCLE ) {
		angle -= ANGLE_FULL_CIRCLE;
	}

	if ( angle < -ANGLE_HALF_CIRCLE ) {
		angle += ANGLE_FULL_CIRCLE;
	}

	return angle;
}

/**
 * @exec helper
 * ================
 * Character_CreateControllers
 *
 * Allocates initial zeroed character controller state for all control tags.
 * ================
 */
export function Character_CreateControllers(): character_controller_state_t {
	return {
		angles: CHARACTER_CONTROL_TAGS.map( () => [0, 0, 0] ),
		originAngles: [0, 0, 0],
		originOffset: [0, 0, 0],
	};
}


// ---------------------------------------------------------------------------
// controller targets calculation (BG_Player_DoControllers)
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Character_ControllerTargets
 *
 * Evaluates target angles and origin offsets for spine, neck, head, and pelvis tags (0x182b82..0x182e9e).
 * Distributes torso pitch and yaw across back_low, back_mid, and back_up bones.
 * Handles stance-specific lean and ground conformance pitch offsets.
 * ================
 */
export function Character_ControllerTargets(
	input: character_controller_input_t,
	out: character_controller_state_t
): void {
	for ( const v of [...out.angles, out.originAngles, out.originOffset] ) {
		v.fill( 0 );
	}

	const flags = input.eFlags;

	if ( flags & EF_DEAD_OR_SPECTATOR ) {
		return;
	}

	const prone = Boolean( flags & EF_PRONE );
	const crouch = Boolean( flags & EF_CROUCHING );
	const groundTorso = f( input.groundTorsoPitch ?? 0 );
	const groundWaist = f( input.groundWaistPitch ?? 0 );

	let torsoPitch = ( ( input.moveTypeBits ?? 0 ) & MOVETYPE_MASK ) ? 0 : f( input.torsoPitch );

	if ( prone ) {
		torsoPitch = Character_AngleSubtract( torsoPitch, 0 );
		torsoPitch = mul( torsoPitch, torsoPitch > 0 ? 0.5 : 0.25 );
	}

	const headPitch = Character_AngleSubtract( input.playerAngles[0], torsoPitch );
	const headYaw = Character_AngleSubtract( input.playerAngles[1], input.torsoYaw );
	const torsoYaw = Character_AngleSubtract( input.torsoYaw, input.legsYaw );
	torsoPitch = Character_AngleSubtract( torsoPitch, 0 );

	// GetLeanFraction, 0x28ec4. Input is the interpolated native lean fraction.
	const lean = mul( input.lean, f( 2 - Math.abs( f( input.lean ) ) ) );
	const rawRoll = mul( lean, 50 );
	let torsoRoll = mul( rawRoll, 0.925 );
	let headRoll = torsoRoll;
	let x = 0;
	let y = 0;

	if ( lean !== 0 ) {
		y = mul( lean, lean > 0 ? -2.5 : crouch ? -12.5 : -5 );
	}

	out.originAngles[1] = flags & EF_LEGS_YAW
		? f( input.legsYaw )
		: Character_AngleSubtract( input.legsYaw, input.playerAngles[1] );

	const low = out.angles[0];
	const mid = out.angles[1];
	const up = out.angles[2];

	if ( prone ) {
		if ( lean !== 0 ) {
			headRoll = mul( headRoll, 0.5 );
		}

		out.originAngles[0] = groundTorso;

		const radians = f( torsoYaw * ( Math.PI / 180 ) );
		const sine = f( Math.sin( radians ) );
		const oneMinusCosine = f( 1 - f( Math.cos( radians ) ) );

		x = mul( oneMinusCosine, -24 );
		y = add( y, mul( sine, -12 ) );

		if ( mul( sine, lean ) > 0 ) {
			y = add( y, mul( mul( oneMinusCosine, -lean ), 16 ) );
		}

		low[1] = mul( torsoRoll, -1.2 );
		low[2] = mul( torsoRoll, 0.3 );

		mid[1] = add( mul( torsoYaw, 0.1 ), mul( torsoRoll, -0.2 ) );
		mid[2] = mul( torsoRoll, 0.2 );

		up[0] = torsoPitch;
		up[1] = add( mul( torsoYaw, 0.8 ), torsoRoll );
		up[2] = mul( torsoRoll, -0.2 );
	} else {
		if ( lean !== 0 && !( crouch && lean > 0 ) ) {
			torsoRoll = mul( torsoRoll, 1.25 );
			headRoll = mul( headRoll, 1.25 );
		}

		out.originAngles[2] = mul( rawRoll, 0.075 );

		low[0] = mul( torsoPitch, 0.2 );
		low[1] = mul( torsoYaw, 0.4 );
		low[2] = mul( torsoRoll, 0.5 );

		mid[0] = mul( torsoPitch, 0.3 );
		mid[1] = mul( torsoYaw, 0.4 );
		mid[2] = mul( torsoRoll, 0.5 );

		up[0] = mul( torsoPitch, 0.5 );
		up[1] = mul( torsoYaw, 0.2 );
		up[2] = mul( torsoRoll, -0.6 );
	}

	if ( groundTorso !== 0 || groundWaist !== 0 ) {
		low[0] = add( low[0], Character_AngleSubtract( groundTorso, groundWaist ) );
	}

	out.angles[3][0] = mul( headPitch, 0.3 );
	out.angles[3][1] = mul( headYaw, 0.3 );

	out.angles[4][0] = mul( headPitch, 0.7 );
	out.angles[4][1] = mul( headYaw, 0.7 );
	out.angles[4][2] = mul( headRoll, -0.3 );

	out.angles[5][0] = Character_AngleSubtract( groundWaist, groundTorso );

	out.originOffset[0] = x;
	out.originOffset[1] = y;
	out.originOffset[2] = f( input.torsoHeight ?? 0 );
}


// ---------------------------------------------------------------------------
// controller smoothing
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Character_LerpOffset
 *
 * Vector-length capped translation offset lerping (0x1824ee).
 * Employs Quake III float32 fast inverse-square-root (0x5f3759df) and Newton-Raphson iteration.
 * ================
 */
export function Character_LerpOffset(
	target: vec3_t,
	distance: number,
	current: vec3_t
): void {
	const dx = f( target[0] - current[0] );
	const dy = f( target[1] - current[1] );
	const dz = f( target[2] - current[2] );

	const square = add( add( mul( dx, dx ), mul( dy, dy ) ), mul( dz, dz ) );

	if ( square === 0 ) {
		return;
	}

	rsqrtFloat[0] = square;
	rsqrtBits[0] = 0x5f3759df - ( rsqrtBits[0] >> 1 );

	const estimate = rsqrtFloat[0];
	const reciprocal = mul( f( 1.5 - mul( mul( mul( square, 0.5 ), estimate ), estimate ) ), estimate );
	const t = mul( reciprocal, distance );

	if ( t >= 1 ) {
		current[0] = target[0];
		current[1] = target[1];
		current[2] = target[2];
		return;
	}

	current[0] = add( current[0], mul( dx, t ) );
	current[1] = add( current[1], mul( dy, t ) );
	current[2] = add( current[2], mul( dz, t ) );
}

/**
 * @exec helper
 * ================
 * Character_StepControllers
 *
 * Steps bone angles and translation towards targets at constant rates (0x182e9e).
 * Rotates at 0.36 degrees/ms and translates at 0.1 units/ms.
 * ================
 */
export function Character_StepControllers(
	current: character_controller_state_t,
	target: character_controller_state_t,
	frameMs: number
): void {
	if ( !Number.isFinite( frameMs ) || frameMs < 0 ) {
		throw new RangeError( 'Invalid controller frame time' );
	}

	const step = mul( frameMs, 0.36 );

	for ( let bone = 0; bone <= CHARACTER_CONTROL_TAGS.length; bone++ ) {
		const a = bone === CHARACTER_CONTROL_TAGS.length ? current.originAngles : current.angles[bone];
		const b = bone === CHARACTER_CONTROL_TAGS.length ? target.originAngles : target.angles[bone];

		for ( let axis = 0; axis < 3; axis++ ) {
			const diff = f( b[axis] - a[axis] );
			a[axis] = diff > step ? add( a[axis], step ) : diff < -step ? f( a[axis] - step ) : b[axis];
		}
	}

	Character_LerpOffset( target.originOffset, mul( frameMs, 0.1 ), current.originOffset );
}


// ---------------------------------------------------------------------------
// orientation & bone overrides (DObjSetLocalTagInternal)
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Character_AnglesQuaternion
 *
 * Converts Euler angles [pitch, yaw, roll] to rotation quaternion [x, y, z, w] (0x74cbe).
 * ================
 */
export function Character_AnglesQuaternion( angles: readonly number[] ): number[] {
	const half = Math.PI / 360;

	const sp = Math.sin( angles[0] * half );
	const cp = Math.cos( angles[0] * half );
	const sy = Math.sin( angles[1] * half );
	const cy = Math.cos( angles[1] * half );
	const sr = Math.sin( angles[2] * half );
	const cr = Math.cos( angles[2] * half );

	return [
		sr * cy * cp - cr * sy * sp,
		cr * cy * sp + sr * sy * cp,
		cr * sy * cp - sr * cy * sp,
		cr * cy * cp + sr * sy * sp,
	];
}

/**
 * @exec helper
 * ================
 * Character_ControllerOverrides
 *
 * Maps smoothed controller angles into skeletal tag override quaternions for DObj evaluation.
 * ================
 */
export function Character_ControllerOverrides(
	state: character_controller_state_t
): character_bone_overrides_t {
	const overrides = new Map<string, character_bone_override_t>();

	CHARACTER_CONTROL_TAGS.forEach( ( name, i ) => {
		overrides.set( name, {
			q: Character_AnglesQuaternion( state.angles[i] ),
			p: [0, 0, 0],
			control: true,
		} );
	} );

	overrides.set( 'tag_origin', {
		q: Character_AnglesQuaternion( state.originAngles ),
		p: state.originOffset,
		control: false,
	} );

	return overrides;
}
