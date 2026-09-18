/*
===============================================================================

	character.ts

	Call of Duty 2 / id Tech Third-Person Character Skeletal Mesh & Animation
	Third-person player character modeling, animation, skeletal posing,
	and multi-part attachment (body + head + helmet + weapon).
	Native-verified timing and controllers with catalog animation evaluation.
	Reconstructed from native routines 0x186b56, 0x183492, 0x763c3, 0x75d90.

===============================================================================
*/

import type { vec3_t } from './types.js';
import {
	VM_Rotate,
	VM_Compose,
	VM_Track,
	type vm_pose_t,
	type vm_vertex_t,
	type vm_surface_t,
	type vm_model_t,
} from './viewmodel.js';
import { Weapon_Definition, type weapon_state_t } from './weapon.js';
import type { character_bone_overrides_t } from './character_controllers.js';
import {
	STANCE_HEIGHT_PRONE,
	STANCE_HEIGHT_CROUCH,
	STANCE_HEIGHT_STAND,
} from './stance.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const CHARACTER_MOVE_SPEED_THRESHOLD      = 5.0;
export const CHARACTER_LADDER_VELOCITY_THRESHOLD = -5.0;

export const CHARACTER_FORWARD_CONE_DEG          = 45.0;
export const CHARACTER_BACKWARD_CONE_DEG         = 135.0;


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface character_channel_t {
	rotation_times: number[];
	rotations: number[][];
	translation_times: number[];
	translations: number[][];
}

export interface character_animation_t {
	frames: number;
	rate: number;
	loop: boolean;
	delta?: {
		rotation_times?: number[];
		rotations?: number[][];
		translation_times?: number[];
		translations?: number[][];
	};
	channels: Record<string, character_channel_t>;
}

export interface lerpFrame_t {
	animIndex?: string;
	rate: number;
	oldOrigin?: [number, number, number];
	oldTime: number;
	playhead: number;
}

export type character_model_t = vm_model_t;

export interface character_definition_t {
	body: string;
	head?: string | null;
	helmet?: string;
}

export interface character_catalog_t {
	characters: Record<string, character_definition_t>;
	default: string | null;
	animations: Record<string, string>;
	materials: Record<string, { file: string | null; definition: unknown }>;
}

export interface character_anim_state_t {
	time_ms: number;
	stance: 11 | 40 | 60; // 11: prone, 40: crouch, 60: stand
	velocity?: vec3_t;
	yaw: number;
	pitch: number;
	ads?: boolean;
	ladder?: {
		normal: vec3_t;
		surfaceFlags: number;
	};
	jumping?: boolean;
	grounded?: boolean;
	airborne?: boolean;
	landing?: boolean;
	bobCycle?: number;
}


// ---------------------------------------------------------------------------
// track interpolation & animation selection
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Character_Track
 *
 * Sparse authored key times with normalized short-arc linear quaternion interpolation.
 * Delegates to VM_Track.
 * ================
 */
function Character_Track(
	keys: number[][],
	times: number[],
	frame: number,
	rotation: boolean
): number[] | undefined {
	return VM_Track( keys, times, frame, rotation );
}

/**
 * @exec helper
 * ================
 * Character_SelectAnim
 *
 * Legacy exported-catalog selector. NOT the native playeranim.script evaluator.
 * Chooses active locomotion clip based on ladder, landing, airborne, stance, and heading.
 * ================
 */
export function Character_SelectAnim( state: character_anim_state_t ): string {
	// 1. Ladder climbing takes precedence over ground and jumping animations
	if ( state.ladder ) {
		const vz = state.velocity?.[2] ?? 0;
		if ( vz < CHARACTER_LADDER_VELOCITY_THRESHOLD ) {
			return 'ladder_down';
		}
		return 'ladder_up';
	}

	const vel = state.velocity ?? [0, 0, 0];
	const horizSpeed = Math.hypot( vel[0], vel[1] );
	const isMoving = horizSpeed > CHARACTER_MOVE_SPEED_THRESHOLD;

	// 2. Landing compression takes priority when touching down
	if ( state.landing ) {
		return isMoving ? 'land_run' : 'land_stand';
	}

	// 3. Jumping / airborne takeoff and flight
	if ( ( state.airborne || state.jumping || state.grounded === false ) && state.grounded !== true ) {
		return isMoving ? 'jump_run' : 'jump_stand';
	}

	if ( state.stance === STANCE_HEIGHT_PRONE ) {
		// Prone
		if ( !isMoving ) {
			return 'prone_idle';
		}

		const moveAngle = Math.atan2( vel[1], vel[0] ) * ( 180.0 / Math.PI );
		let relAngle = ( moveAngle - state.yaw ) % 360.0;

		if ( relAngle > 180.0 ) {
			relAngle -= 360.0;
		}

		if ( relAngle < -180.0 ) {
			relAngle += 360.0;
		}

		if ( Math.abs( relAngle ) <= CHARACTER_FORWARD_CONE_DEG ) {
			return 'prone_forward';
		}

		if ( Math.abs( relAngle ) >= CHARACTER_BACKWARD_CONE_DEG ) {
			return 'prone_back';
		}

		return relAngle > 0 ? 'prone_left' : 'prone_right';
	}

	if ( state.stance === STANCE_HEIGHT_CROUCH ) {
		// Crouch
		if ( !isMoving ) {
			return state.ads ? 'crouch_ads' : 'crouch_idle';
		}

		// Compute movement direction relative to player facing yaw
		const moveAngle = Math.atan2( vel[1], vel[0] ) * ( 180.0 / Math.PI );
		let relAngle = ( moveAngle - state.yaw ) % 360.0;

		if ( relAngle > 180.0 ) {
			relAngle -= 360.0;
		}

		if ( relAngle < -180.0 ) {
			relAngle += 360.0;
		}

		if ( state.ads ) {
			if ( Math.abs( relAngle ) <= CHARACTER_FORWARD_CONE_DEG ) {
				return 'crouch_walk_forward';
			}

			if ( Math.abs( relAngle ) >= CHARACTER_BACKWARD_CONE_DEG ) {
				return 'crouch_walk_back';
			}

			return relAngle > 0 ? 'crouch_walk_left' : 'crouch_walk_right';
		}

		if ( Math.abs( relAngle ) <= CHARACTER_FORWARD_CONE_DEG ) {
			return 'crouch_forward';
		}

		if ( Math.abs( relAngle ) >= CHARACTER_BACKWARD_CONE_DEG ) {
			return 'crouch_back';
		}

		return relAngle > 0 ? 'crouch_left' : 'crouch_right';
	}

	// Stand
	if ( !isMoving ) {
		return state.ads ? 'stand_ads' : 'stand_idle';
	}

	const moveAngle = Math.atan2( vel[1], vel[0] ) * ( 180.0 / Math.PI );
	let relAngle = ( moveAngle - state.yaw ) % 360.0;

	if ( relAngle > 180.0 ) {
		relAngle -= 360.0;
	}

	if ( relAngle < -180.0 ) {
		relAngle += 360.0;
	}

	if ( state.ads ) {
		if ( Math.abs( relAngle ) <= CHARACTER_FORWARD_CONE_DEG ) {
			return 'walk_forward';
		}

		if ( Math.abs( relAngle ) >= CHARACTER_BACKWARD_CONE_DEG ) {
			return 'walk_back';
		}

		return relAngle > 0 ? 'walk_left' : 'walk_right';
	}

	if ( Math.abs( relAngle ) <= CHARACTER_FORWARD_CONE_DEG ) {
		return 'run_forward';
	}

	if ( Math.abs( relAngle ) >= CHARACTER_BACKWARD_CONE_DEG ) {
		return 'run_back';
	}

	return relAngle > 0 ? 'run_left' : 'run_right';
}


// ---------------------------------------------------------------------------
// lerpframe rate calculation
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Character_AnimMoveSpeed
 *
 * Retail BG_LoadAnim moveSpeed derivation (0x186b56).
 * Computes authored movement speed in units/sec from root-motion delta translation.
 * ================
 */
export function Character_AnimMoveSpeed( anim: character_animation_t | undefined ): number {
	if ( !anim || !( anim.frames > 0 ) || !( anim.rate > 0 ) ) {
		return 0;
	}

	const trans = anim.delta?.translations;

	if ( !trans || trans.length < 2 ) {
		return 0;
	}

	const first = trans[0];
	const last = trans[trans.length - 1];

	// BG_LoadAnim 0x186b2a..0x186b56: full XYZ length, including ladder Z.
	return Math.hypot( last[0] - first[0], last[1] - first[1], last[2] - first[2] ) / ( anim.frames / anim.rate );
}

/**
 * @exec helper
 * ================
 * BG_RunLerpFrameRate
 *
 * Rate calculation from BG_RunLerpFrameRate (0x183492), NOT its XAnim-tree work.
 * curTime is a simulation/snapshot timestamp in milliseconds, not render time.
 * The fifth argument means LADDER (native animation.flags & 2), not "use 3D".
 * ================
 */
export function BG_RunLerpFrameRate(
	lf: lerpFrame_t,
	anim: character_animation_t | undefined,
	curOrigin: [number, number, number],
	curTime: number,
	isLadder: boolean = false
): number {
	if ( !Number.isFinite( curTime ) || !curOrigin.every( Number.isFinite ) ) {
		return lf.rate;
	}

	const authoredMoveSpeed = Character_AnimMoveSpeed( anim );

	if ( lf.oldOrigin && curTime === lf.oldTime && authoredMoveSpeed > 0 ) {
		// Duplicate snapshot: retain BOTH the previous sample and playback rate.
		return lf.rate;
	}

	if ( !lf.oldOrigin || curTime <= lf.oldTime || !( authoredMoveSpeed > 0 ) ) {
		lf.rate = 1;
	} else {
		const dx = curOrigin[0] - lf.oldOrigin[0];
		const dy = curOrigin[1] - lf.oldOrigin[1];
		const dz = curOrigin[2] - lf.oldOrigin[2];

		// 0x183696: ladders use |delta Z|; normal locomotion uses Vec3Distance.
		const distance = isLadder ? Math.abs( dz ) : Math.hypot( dx, dy, dz );
		let rate = distance / ( ( curTime - lf.oldTime ) * 0.001 ) / authoredMoveSpeed;

		if ( rate < 0.1 ) {
			rate = rate < 0.01 && isLadder ? 0 : 0.1;
		}

		if ( rate > 2 ) {
			const maxRate = isLadder
				? 4
				: authoredMoveSpeed > 150
					? 2
					: authoredMoveSpeed < 20
						? 3
						: ( authoredMoveSpeed - 20 ) / -130 + 3;

			rate = Math.min( rate, maxRate );
		}

		lf.rate = rate;
	}

	lf.oldTime = curTime;
	const previous = ( lf.oldOrigin ??= [0, 0, 0] );
	previous[0] = curOrigin[0];
	previous[1] = curOrigin[1];
	previous[2] = curOrigin[2];

	return lf.rate;
}

/**
 * @exec helper
 * ================
 * Character_AnimDurationMs
 *
 * Authored duration: native numframes / framerate (numframes is intervals).
 * ================
 */
export function Character_AnimDurationMs( anim: character_animation_t | undefined ): number {
	return anim && anim.frames > 0 && anim.rate > 0
		? ( anim.frames / anim.rate ) * 1000
		: 0;
}

/**
 * @exec helper
 * ================
 * BG_PlayerAnimation
 *
 * Legacy two-playhead utility; not a port of the native BG_PlayerAnimation tree.
 * ================
 */
export function BG_PlayerAnimation(
	legsLf: lerpFrame_t,
	torsoLf: lerpFrame_t,
	legsAnim: character_animation_t | undefined,
	torsoAnim: character_animation_t | undefined,
	origin: [number, number, number],
	curTime: number,
	dtSec: number
): { legsRate: number; torsoRate: number } {
	const legsRate = BG_RunLerpFrameRate( legsLf, legsAnim, origin, curTime, false );
	legsLf.playhead += dtSec * 1000.0 * legsRate;

	const torsoRate = torsoAnim ? BG_RunLerpFrameRate( torsoLf, torsoAnim, origin, curTime, false ) : 1.0;
	torsoLf.playhead += dtSec * 1000.0 * torsoRate;

	return { legsRate, torsoRate };
}

/**
 * @exec helper
 * ================
 * Character_SelectTorsoAnim
 *
 * Legacy catalog action-name selector (native playeranim.script is not supplied).
 * Returns elapsed milliseconds; do NOT stretch the authored clip to a guessed
 * fire/reload duration.
 * ================
 */
export function Character_SelectTorsoAnim(
	weapon: weapon_state_t | undefined,
	stance: number,
	ads: boolean
): { animKey: string; playhead: number } | null {
	if ( !weapon ) {
		return null;
	}

	const phase = weapon.phase;

	if ( phase === 'idle' || phase === 'raise' ) {
		return null;
	}

	const def = Weapon_Definition( weapon.id );
	const isBoltAction = def?.boltAction === '1';

	const isAuto =
		def?.weaponClass === 'mg' ||
		def?.weaponClass === 'smg' ||
		def?.playerAnimType === 'mp40' ||
		def?.playerAnimType === 'thompson' ||
		def?.playerAnimType === 'bar' ||
		def?.playerAnimType === 'sten' ||
		def?.playerAnimType === 'bren' ||
		def?.playerAnimType === 'ppsh';

	const isProne = stance <= 15;
	const isCrouch = !isProne && stance <= 45;

	if ( phase === 'fire' ) {
		let key = 'fire_stand';

		if ( isProne ) {
			if ( isBoltAction ) {
				key = 'fire_prone_rifle';
			} else if ( isAuto ) {
				key = 'fire_prone_auto';
			} else {
				key = 'fire_prone';
			}
		} else if ( isBoltAction ) {
			key = ads ? 'fire_rifle_ads' : 'fire_rifle';
		} else if ( isAuto ) {
			key = isCrouch
				? ( ads ? 'fire_crouch_auto_ads' : 'fire_crouch_auto' )
				: ( ads ? 'fire_auto_ads' : 'fire_auto' );
		} else {
			key = isCrouch
				? ( ads ? 'fire_crouch_ads' : 'fire_crouch' )
				: ( ads ? 'fire_stand_ads' : 'fire_stand' );
		}

		return { animKey: key, playhead: weapon.elapsed };
	}

	if ( phase.startsWith( 'reload' ) ) {
		let key = isCrouch ? 'reload_crouch_rifle' : 'reload_stand_rifle';
		const isAutoReload =
			def?.playerAnimType === 'm1carbine' ||
			def?.playerAnimType === 'mp40' ||
			def?.playerAnimType === 'bar' ||
			def?.playerAnimType === 'sten' ||
			isAuto;

		if ( isProne ) {
			key = isAutoReload ? 'reload_prone_auto' : 'reload_prone_rifle';
		} else if ( isAutoReload && !isCrouch ) {
			key = 'reload_stand_auto';
		}

		return { animKey: key, playhead: weapon.elapsed };
	}

	return null;
}


// ---------------------------------------------------------------------------
// quaternion math & bone track blending
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Character_EvaluateTracks
 *
 * Evaluates rotation and translation tracks for all bones in the active animation.
 * ================
 */
export function Character_EvaluateTracks(
	anim: character_animation_t,
	time_ms: number
): Record<string, Partial<{ q: number[]; p: number[] }>> {
	const result: Record<string, Partial<{ q: number[]; p: number[] }>> = {};
	const elapsed = ( Math.max( 0, Number.isFinite( time_ms ) ? time_ms : 0 ) * anim.rate ) / 1000;

	const f = !( anim.frames > 0 )
		? 0
		: anim.loop
			? elapsed % anim.frames
			: Math.max( 0, Math.min( anim.frames, elapsed ) );

	for ( const [name, c] of Object.entries( anim.channels ) ) {
		const q = Character_Track( c.rotations, c.rotation_times, f, true );
		const p = Character_Track( c.translations, c.translation_times, f, false );
		const target = ( result[name] ??= {} );

		if ( q ) {
			target.q = q;
		}

		if ( p ) {
			target.p = p;
		}
	}

	return result;
}

/**
 * @exec helper
 * ================
 * Character_Slerp
 *
 * Quaternion spherical linear interpolation between orientations a and b by weight t.
 * ================
 */
export function Character_Slerp( a: number[], b: number[], t: number ): number[] {
	let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
	let sign = 1.0;

	if ( dot < 0 ) {
		dot = -dot;
		sign = -1.0;
	}

	if ( dot > 0.9995 ) {
		const v = [
			a[0] + t * ( b[0] * sign - a[0] ),
			a[1] + t * ( b[1] * sign - a[1] ),
			a[2] + t * ( b[2] * sign - a[2] ),
			a[3] + t * ( b[3] * sign - a[3] ),
		];
		const len = Math.hypot( ...v ) || 1;
		return v.map( ( x ) => x / len );
	}

	const theta = Math.acos( Math.min( 1.0, dot ) );
	const sinTheta = Math.sin( theta );
	const w1 = Math.sin( ( 1.0 - t ) * theta ) / sinTheta;
	const w2 = ( Math.sin( t * theta ) / sinTheta ) * sign;

	return [
		a[0] * w1 + b[0] * w2,
		a[1] * w1 + b[1] * w2,
		a[2] * w1 + b[2] * w2,
		a[3] * w1 + b[3] * w2,
	];
}

/**
 * @exec helper
 * ================
 * Character_Lerp
 *
 * 3D vector linear interpolation between positions a and b by weight t.
 * ================
 */
export function Character_Lerp( a: number[], b: number[], t: number ): number[] {
	return [
		a[0] + t * ( b[0] - a[0] ),
		a[1] + t * ( b[1] - a[1] ),
		a[2] + t * ( b[2] - a[2] ),
	];
}

/**
 * All upper-body (torso) bone names descending from torso_stabilizer.
 * Used to layer ADS / firing aim poses onto running locomotion.
 */
export const CHARACTER_TORSO_BONES = new Set( [
	'torso_stabilizer',
	'j_spine1',
	'j_spine2',
	'j_spine3',
	'j_spine4',
	'j_neck',
	'neck',
	'j_head',
	'head',
	'j_clavicle_le',
	'j_clavicle_ri',
	'j_shoulder_le',
	'j_shoulder_ri',
	'j_elbow_le',
	'j_elbow_ri',
	'j_elbow_bulge_le',
	'j_elbow_bulge_ri',
	'j_shouldertwist_le',
	'j_shouldertwist_ri',
	'j_wrist_le',
	'j_wrist_ri',
	'j_wristtwist_le',
	'j_wristtwist_ri',
	'j_gun',
	'tag_weapon_left',
	'tag_weapon_right',
	'j_index_le_1',
	'j_index_le_2',
	'j_index_le_3',
	'j_index_ri_1',
	'j_index_ri_2',
	'j_index_ri_3',
	'j_mid_le_1',
	'j_mid_le_2',
	'j_mid_le_3',
	'j_mid_ri_1',
	'j_mid_ri_2',
	'j_mid_ri_3',
	'j_pinky_le_1',
	'j_pinky_le_2',
	'j_pinky_le_3',
	'j_pinky_ri_1',
	'j_pinky_ri_2',
	'j_pinky_ri_3',
	'j_ring_le_1',
	'j_ring_le_2',
	'j_ring_le_3',
	'j_ring_ri_1',
	'j_ring_ri_2',
	'j_ring_ri_3',
	'j_thumb_le_1',
	'j_thumb_le_2',
	'j_thumb_le_3',
	'j_thumb_ri_1',
	'j_thumb_ri_2',
	'j_thumb_ri_3',
	'back_low',
	'back_mid',
	'back_up',
	'j_back_equip_le',
	'j_back_equip_ri',
] );

/**
 * @exec helper
 * ================
 * Character_BlendTracks
 *
 * Blend two sets of evaluated bone tracks by weight t in [0, 1] with optional bone filter.
 * When t = 0, output equals a. When t = 1, output equals b.
 * ================
 */
export function Character_BlendTracks(
	a: Record<string, Partial<{ q: number[]; p: number[] }>>,
	b: Record<string, Partial<{ q: number[]; p: number[] }>>,
	t: number,
	boneFilter?: Set<string>
): Record<string, Partial<{ q: number[]; p: number[] }>> {
	if ( t <= 0.0 ) {
		return a;
	}

	if ( t >= 1.0 && !boneFilter ) {
		return b;
	}

	const result: Record<string, Partial<{ q: number[]; p: number[] }>> = {};
	const allBones = new Set( [...Object.keys( a ), ...Object.keys( b )] );

	for ( const bone of allBones ) {
		if ( boneFilter && !boneFilter.has( bone ) ) {
			if ( a[bone] ) {
				result[bone] = a[bone];
			}
			continue;
		}

		const ta = a[bone];
		const tb = b[bone];

		if ( !ta ) {
			if ( tb ) {
				result[bone] = tb;
			}
			continue;
		}

		if ( !tb ) {
			result[bone] = ta;
			continue;
		}

		const blended: Partial<{ q: number[]; p: number[] }> = {};

		if ( ta.q && tb.q ) {
			blended.q = Character_Slerp( ta.q, tb.q, t );
		} else {
			blended.q = tb.q ?? ta.q;
		}

		if ( ta.p && tb.p ) {
			blended.p = Character_Lerp( ta.p, tb.p, t );
		} else {
			blended.p = tb.p ?? ta.p;
		}

		result[bone] = blended;
	}

	return result;
}


// ---------------------------------------------------------------------------
// skeletal posing & multi-model attachment
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Character_WorldRoot
 *
 * Create world-space root transform for player at ground origin with facing yaw.
 * ================
 */
export function Character_WorldRoot( origin: vec3_t, yaw: number ): vm_pose_t {
	const rad = ( yaw * Math.PI ) / 360.0;
	const q = [0, 0, Math.sin( rad ), Math.cos( rad )];

	return [q, [origin[0], origin[1], origin[2]]];
}

/**
 * @exec helper
 * ================
 * Character_PoseModel
 *
 * Evaluate a skeleton in object space, optionally followed by world attachment.
 * DObjCalcSkel applies control bits BEFORE the entity's world transform.
 * ================
 */
export function Character_PoseModel(
	model: character_model_t,
	tracks: Record<string, Partial<{ q: number[]; p: number[] }>>,
	attachment: vm_pose_t | undefined = undefined,
	overrides?: character_bone_overrides_t
): vm_pose_t[] {
	const objectPoses: vm_pose_t[] = [];
	const identity: vm_pose_t = [[0, 0, 0, 1], [0, 0, 0]];

	for ( const b of model.bones ) {
		const c = tracks[b.name];
		const override = overrides?.get( b.name );
		const parent = b.parent < 0 ? identity : objectPoses[b.parent];

		if ( !parent ) {
			throw new Error( model.name + ': parent must precede bone ' + b.name );
		}

		const localQ = override?.q ?? c?.q ?? b.pose[0];
		const offset = override?.p ?? c?.p;
		const localP = b.pose[1].map( ( v, i ) => ( override && b.parent < 0 ? 0 : v ) + ( offset?.[i] ?? 0 ) );
		const posed = VM_Compose( parent, [localQ, localP] );

		if ( override?.control && b.parent >= 0 ) {
			// 0x763c3: control * parent; normal path 0x75d90 is parent * local.
			posed[0] = VM_Compose( [localQ, [0, 0, 0]], [parent[0], [0, 0, 0]] )[0];
		}

		objectPoses.push( posed );
	}

	return attachment
		? objectPoses.map( ( pose ) => VM_Compose( attachment, pose ) )
		: objectPoses;
}

/**
 * @exec helper
 * ================
 * Character_PoseAttachedModel
 *
 * Pose a model sharing a DObj skeleton. Inputs/outputs use the SAME object space.
 * Shared bones inherit the body's pose; unique bones still receive animation and control tags.
 * ================
 */
export function Character_PoseAttachedModel(
	model: character_model_t,
	bodyModel: character_model_t,
	bodyPoses: vm_pose_t[],
	attachmentFallback: vm_pose_t,
	tracks: Record<string, Partial<{ q: number[]; p: number[] }>> = {},
	overrides?: character_bone_overrides_t
): vm_pose_t[] {
	const result: vm_pose_t[] = [];
	const bodyBoneMap = new Map<string, number>();

	bodyModel.bones.forEach( ( b, i ) => bodyBoneMap.set( b.name, i ) );

	for ( const b of model.bones ) {
		const bodyIndex = bodyBoneMap.get( b.name );

		if ( bodyIndex !== undefined && bodyPoses[bodyIndex] ) {
			result.push( bodyPoses[bodyIndex] );
			continue;
		}

		const parent = b.parent >= 0 && result[b.parent] ? result[b.parent] : attachmentFallback;
		const c = tracks[b.name];
		const override = overrides?.get( b.name );
		const q = override?.q ?? c?.q ?? b.pose[0];
		const offset = override?.p ?? c?.p;
		const p = b.pose[1].map( ( v, i ) => ( override && b.parent < 0 ? 0 : v ) + ( offset?.[i] ?? 0 ) );
		const posed = VM_Compose( parent, [q, p] );

		if ( override?.control ) {
			posed[0] = VM_Compose( [q, [0, 0, 0]], [parent[0], [0, 0, 0]] )[0];
		}

		result.push( posed );
	}

	return result;
}

/**
 * @exec helper
 * ================
 * Character_PoseHelmet
 *
 * Pose a helmet model attached to j_head.
 * ================
 */
export function Character_PoseHelmet(
	helmetModel: character_model_t,
	headPose: vm_pose_t
): vm_pose_t[] {
	const result: vm_pose_t[] = [];

	for ( const b of helmetModel.bones ) {
		const parentPose = b.parent >= 0 && result[b.parent] ? result[b.parent] : headPose;
		result.push( VM_Compose( parentPose, b.pose ) );
	}

	return result;
}

/**
 * @exec helper
 * ================
 * Character_PoseWeapon
 *
 * Pose a weapon model attached to tag_weapon_right.
 * ================
 */
export function Character_PoseWeapon(
	weaponModel: character_model_t,
	weaponAttachment: vm_pose_t
): vm_pose_t[] {
	const result: vm_pose_t[] = [];

	for ( const b of weaponModel.bones ) {
		const parentPose = b.parent >= 0 && result[b.parent] ? result[b.parent] : weaponAttachment;
		result.push( VM_Compose( parentPose, b.pose ) );
	}

	return result;
}


// ---------------------------------------------------------------------------
// surface vertex skinning
// ---------------------------------------------------------------------------

// Scratch storage scoped to character surface to eliminate per-frame GC churn.
const characterSkinScratch = new WeakMap<vm_surface_t, Float32Array>();

/**
 * @exec helper
 * ================
 * Character_SkinSurface
 *
 * Skin surface vertices into world space.
 * Layout: [pos.x, pos.y, pos.z, norm.x, norm.y, norm.z, uv.u, uv.v]
 * ================
 */
export function Character_SkinSurface(
	surface: vm_surface_t,
	poses: vm_pose_t[],
	output?: Float32Array
): Float32Array {
	const count = surface.vertices.length;
	const size = surface.indices.length * 8;
	let scratch = characterSkinScratch.get( surface );

	if ( !scratch || scratch.length !== count * 8 ) {
		scratch = new Float32Array( count * 8 );
		characterSkinScratch.set( surface, scratch );
	}

	const data = output ?? new Float32Array( size );

	for ( let index = 0; index < count; index++ ) {
		const v = surface.vertices[index];
		let px = 0;
		let py = 0;
		let pz = 0;

		for ( let influence = 0; influence < v.influences.length; influence++ ) {
			const item = v.influences[influence];
			const t = poses[item[0]] ?? [[0, 0, 0, 1], [0, 0, 0]];
			const q = t[0];
			const p = item[2];
			const weight = item[1];
			const x = q[0];
			const y = q[1];
			const z = q[2];
			const w = q[3];

			const k = 2 / ( x * x + y * y + z * z + w * w || 1 );
			const tx = k * ( y * p[2] - z * p[1] );
			const ty = k * ( z * p[0] - x * p[2] );
			const tz = k * ( x * p[1] - y * p[0] );

			px += weight * ( p[0] + w * tx + y * tz - z * ty + t[1][0] );
			py += weight * ( p[1] + w * ty + z * tx - x * tz + t[1][1] );
			pz += weight * ( p[2] + w * tz + x * ty - y * tx + t[1][2] );
		}

		const primaryJoint = v.influences[0]?.[0] ?? 0;
		const primaryPose = poses[primaryJoint] ?? [[0, 0, 0, 1], [0, 0, 0]];
		const q = primaryPose[0];
		const n = v.normal;
		const x = q[0];
		const y = q[1];
		const z = q[2];
		const w = q[3];

		const k = 2 / ( x * x + y * y + z * z + w * w || 1 );
		const tx = k * ( y * n[2] - z * n[1] );
		const ty = k * ( z * n[0] - x * n[2] );
		const tz = k * ( x * n[1] - y * n[0] );

		const offset = index * 8;
		scratch[offset] = px;
		scratch[offset + 1] = py;
		scratch[offset + 2] = pz;
		scratch[offset + 3] = n[0] + w * tx + y * tz - z * ty;
		scratch[offset + 4] = n[1] + w * ty + z * tx - x * tz;
		scratch[offset + 5] = n[2] + w * tz + x * ty - y * tx;
		scratch[offset + 6] = v.uv[0];
		scratch[offset + 7] = v.uv[1];
	}

	for ( let i = 0; i < surface.indices.length; i++ ) {
		const source = surface.indices[i] * 8;
		const target = i * 8;

		for ( let a = 0; a < 8; a++ ) {
			data[target + a] = scratch[source + a];
		}
	}

	return data;
}
