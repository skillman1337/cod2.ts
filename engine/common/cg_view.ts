/*
===============================================================================

	cg_view.ts

	Call of Duty 2 / id Tech Third-Person Camera View Calculation
	cgame_mp/cg_view_mp.cpp replication:
	  - CG_OffsetThirdPersonView (0x1d3722 / 0x4ce820)
	  - CG_UpdateThirdPerson (0x4cfc40)
	Offsets camera behind player with capsule swept collision against world geometry.

===============================================================================
*/

import { Cvar_Get } from './cvar.js';
import { AngleVectors } from './math.js';
import { PM_TraceShape } from './pm.js';
import type { refdef_t, vec3_t } from './types.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const CG_THIRD_PERSON_DEFAULT_RANGE   = 120;
export const CG_THIRD_PERSON_MAX_RANGE       = 1024;
export const CG_THIRD_PERSON_MAX_PITCH       = 45.0;
export const CG_THIRD_PERSON_FOCUS_DISTANCE  = 512.0;
export const CG_THIRD_PERSON_TARGET_Z_OFFSET = 8.0;
export const CG_THIRD_PERSON_CAMERA_RADIUS   = 4;
export const CG_THIRD_PERSON_LIFT_Z          = 32.0;


// ---------------------------------------------------------------------------
// third-person cvar queries
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * CG_IsThirdPerson
 *
 * 0x4cfc40: CG_UpdateThirdPerson
 * Returns whether third-person camera is enabled via cg_thirdPerson dvar.
 * ================
 */
export function CG_IsThirdPerson(): boolean {
	const val = Cvar_Get( 'cg_thirdPerson' ).toLowerCase();
	return val === '1' || val === 'true' || Number( val ) > 0;
}

/**
 * @exec helper
 * ================
 * CG_GetThirdPersonAngle
 *
 * Returns camera orbit yaw offset from cg_thirdPersonAngle dvar (native default: 0).
 * ================
 */
export function CG_GetThirdPersonAngle(): number {
	const raw = Cvar_Get( 'cg_thirdPersonAngle' );
	const val = parseFloat( raw );
	return isNaN( val ) ? 0 : val;
}

/**
 * @exec helper
 * ================
 * CG_GetThirdPersonRange
 *
 * Returns camera boom distance from cg_thirdPersonRange dvar (native default: 120, max: 1024).
 * ================
 */
export function CG_GetThirdPersonRange(): number {
	const raw = Cvar_Get( 'cg_thirdPersonRange' );
	const val = parseFloat( raw );
	return isNaN( val ) || val <= 0 ? CG_THIRD_PERSON_DEFAULT_RANGE : Math.min( CG_THIRD_PERSON_MAX_RANGE, Math.max( 0, val ) );
}


// ---------------------------------------------------------------------------
// third-person camera view calculation
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * CG_OffsetThirdPersonView
 *
 * 0x1d3722 (Mach-O) / 0x4ce820 (PE): CG_OffsetThirdPersonView
 * Offsets camera behind player according to range and angle, with a capsule sweep.
 * When obstructed, lerps along trace fraction and lifts camera by (1 - fraction) * 32.
 * Focuses camera towards aim point 512 units ahead of player view.
 * Sets refdef.hideWeapon = true so first-person viewmodels are hidden.
 * ================
 */
export function CG_OffsetThirdPersonView( refdef: refdef_t ): void {
	// 1. Clamp pitch to max 45.0 degrees (native: cmpnltss xmm0 [45.0], xmm2)
	const clampedPitch = Math.min( refdef.viewangles[0], CG_THIRD_PERSON_MAX_PITCH );

	// 2. Focus point 512 units ahead of player eye (native: 0x1d37e2 / 0x3263e0)
	const forwardFocus: vec3_t = [0, 0, 0];
	const tempRight: vec3_t = [0, 0, 0];
	const tempUp: vec3_t = [0, 0, 0];
	AngleVectors( [clampedPitch, refdef.viewangles[1], refdef.viewangles[2]], forwardFocus, tempRight, tempUp );

	const focusPoint: vec3_t = [
		refdef.vieworg[0] + forwardFocus[0] * CG_THIRD_PERSON_FOCUS_DISTANCE,
		refdef.vieworg[1] + forwardFocus[1] * CG_THIRD_PERSON_FOCUS_DISTANCE,
		refdef.vieworg[2] + forwardFocus[2] * CG_THIRD_PERSON_FOCUS_DISTANCE,
	];

	// 3. Base camera target starts at vieworg + 8 units Z (native: 0x1d384f / 0x3262f8)
	const baseTarget: vec3_t = [
		refdef.vieworg[0],
		refdef.vieworg[1],
		refdef.vieworg[2] + CG_THIRD_PERSON_TARGET_Z_OFFSET,
	];

	// 4. View angles for third person camera:
	// Pitch halved (native 0x1d3864: mulss refdefViewAngles[0], 0.5)
	// Yaw adjusted by cg_thirdPersonAngle (native 0x1d3883: subss refdefViewAngles[1], cg_thirdPersonAngle)
	const thirdPersonAngle = CG_GetThirdPersonAngle();
	const camPitch = refdef.viewangles[0] * 0.5;
	const camYaw = refdef.viewangles[1] - thirdPersonAngle;
	const camRoll = refdef.viewangles[2];

	const camForward: vec3_t = [0, 0, 0];
	AngleVectors( [camPitch, camYaw, camRoll], camForward, tempRight, tempUp );

	// 5. Offset target backwards along camForward by cg_thirdPersonRange
	const range = CG_GetThirdPersonRange();
	const target: vec3_t = [
		baseTarget[0] - camForward[0] * range,
		baseTarget[1] - camForward[1] * range,
		baseTarget[2] - camForward[2] * range,
	];

	// 6. Trace capsule of radius 4 (mins [-4, -4, -4], maxs [4, 4, 4])
	const trace = PM_TraceShape( refdef.vieworg, target, { radius: CG_THIRD_PERSON_CAMERA_RADIUS, half: 0, offset: 0 } );
	let finalPos: vec3_t;

	if ( trace.fraction < 1.0 ) {
		// Obstructed: lerp towards collision point
		const camPos: vec3_t = [
			refdef.vieworg[0] + ( target[0] - refdef.vieworg[0] ) * trace.fraction,
			refdef.vieworg[1] + ( target[1] - refdef.vieworg[1] ) * trace.fraction,
			refdef.vieworg[2] + ( target[2] - refdef.vieworg[2] ) * trace.fraction,
		];

		// Lift Z by (1.0 - fraction) * 32.0 (native: 0x1d3a7a / 0x3263e8)
		camPos[2] += ( 1.0 - trace.fraction ) * CG_THIRD_PERSON_LIFT_Z;

		// Second trace to the lifted position
		const trace2 = PM_TraceShape( refdef.vieworg, camPos, { radius: CG_THIRD_PERSON_CAMERA_RADIUS, half: 0, offset: 0 } );

		finalPos = [
			refdef.vieworg[0] + ( camPos[0] - refdef.vieworg[0] ) * trace2.fraction,
			refdef.vieworg[1] + ( camPos[1] - refdef.vieworg[1] ) * trace2.fraction,
			refdef.vieworg[2] + ( camPos[2] - refdef.vieworg[2] ) * trace2.fraction,
		];
	} else {
		finalPos = [target[0], target[1], target[2]];
	}

	// 7. Update camera origin
	refdef.vieworg[0] = finalPos[0];
	refdef.vieworg[1] = finalPos[1];
	refdef.vieworg[2] = finalPos[2];

	// 8. Pitch camera towards focus point (native: 0x1d39c0..0x1d39fb)
	const diffX = focusPoint[0] - finalPos[0];
	const diffY = focusPoint[1] - finalPos[1];
	const diffZ = focusPoint[2] - finalPos[2];
	let dist = Math.sqrt( diffX * diffX + diffY * diffY );

	if ( dist <= 1.0 ) {
		dist = 1.0;
	}

	const newPitch = Math.atan2( diffZ, dist ) * ( -180.0 / Math.PI );

	refdef.viewangles[0] = newPitch;
	refdef.viewangles[1] = camYaw;
	refdef.viewangles[2] = camRoll;

	// 9. Recompute viewaxis (native: 0x1d40a7 AnglesToAxis)
	AngleVectors( refdef.viewangles, refdef.viewaxis[0], refdef.viewaxis[1], refdef.viewaxis[2] );

	// 10. Hide viewmodel weapon in third person (native: CG_AddViewWeapon 0x1da324)
	refdef.hideWeapon = true;
}
