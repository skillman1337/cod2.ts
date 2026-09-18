/*
===============================================================================

	weapon_motion.ts

	Call of Duty 2 / id Tech Procedural Weapon Motion & Recoil
	Viewkick centering, gunkick springs, sine-wave idle breathing,
	bob cycle waveforms, and movement rotation/position offsets.
	Reconstructed from native routines 0x4f57f0, 0x4cec10, 0x4f6380, 0x4f5eb0, 0x4f6070.

===============================================================================
*/

import { Cvar_Get } from './cvar.js';
import {
	STANCE_HEIGHT_PRONE,
	STANCE_HEIGHT_CROUCH,
	STANCE_HEIGHT_STAND,
} from './stance.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const LCG_RAND_MULT           = 214013;
export const LCG_RAND_ADD            = 2531011;
export const LCG_RAND_MAX            = 32767;

export const VIEWKICK_RETURN_DAMPING = 0.06;
export const VIEWKICK_MAX_ANGLE      = 10;

export const GUNKICK_EPSILON_POS     = 0.25;
export const GUNKICK_EPSILON_SPEED   = 1;

export const WEAPON_SUBSTEP_MS       = 5;
export const IDLE_FACTOR_RATE        = 0.0005;
export const IDLE_AMOUNT_SCALE        = 0.01;
export const IDLE_BREATH_RATES        = [0.001, 0.0007, 0.0005] as const;

export const BOB_CYCLE_MASK           = 255;
export const BOB_PHASE_STEP           = 0.02463994361460209;
export const BOB_PHASE_OFFSET_A       = 6.2831854820251465;
export const BOB_PHASE_OFFSET_B       = 7.0685834884643555;
export const BOB_SPEED_SCALE          = 0.16;
export const BOB_MAX_AMPLITUDE        = 10;
export const BOB_PITCH_SCALE          = 0.75;
export const BOB_ROLL_SCALE           = 1.5;
export const BOB_ROLL_PHASE_OFFSET    = 0.4712389409542084;
export const BOB_PITCH_WAVE_SCALE     = 0.2;

export const BOB_AMPLITUDE_PRONE_DEFAULT    = 0.03;
export const BOB_AMPLITUDE_DUCKED_DEFAULT   = 0.0075;
export const BOB_AMPLITUDE_STANDING_DEFAULT = 0.007;

export const CVAR_BOB_AMPLITUDE_PRONE    = 'bg_bobAmplitudeProne';
export const CVAR_BOB_AMPLITUDE_DUCKED   = 'bg_bobAmplitudeDucked';
export const CVAR_BOB_AMPLITUDE_STANDING = 'bg_bobAmplitudeStanding';


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface weapon_motion_t {
	view: number[];
	viewSpeed: number[];
	gun: number[];
	gunSpeed: number[];
	idleTime: number;
	idleFactor: number;
	seed: number;
	bobCycle?: number;
	bobSpeed?: number;
	stance?: number;
	moveRotation?: number[];
	movePosition?: number[];
	lean?: number;
}


// ---------------------------------------------------------------------------
// initialization
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * WeaponMotion_Create
 *
 * Allocates fresh weapon motion state with zero velocity and default PRNG seed.
 * ================
 */
export function WeaponMotion_Create(): weapon_motion_t {
	return {
		view: [0, 0, 0],
		viewSpeed: [0, 0, 0],
		gun: [0, 0, 0],
		gunSpeed: [0, 0, 0],
		idleTime: 0,
		idleFactor: 1,
		seed: 1,
	};
}


// ---------------------------------------------------------------------------
// view kick & gun kick
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * WeaponMotion_Fire
 *
 * Imparts angular kick impulses to camera view and weapon model on gunshot (0x4f57f0).
 * Chooses randomized velocity within authored bounds, negating pitch and rolling by -yaw/2.
 * ================
 */
export function WeaponMotion_Fire(
	m: weapon_motion_t,
	def: Record<string, string>,
	ads: number
): void {
	const random = () => {
		m.seed = ( Math.imul( m.seed, LCG_RAND_MULT ) + LCG_RAND_ADD ) | 0;
		return ( ( m.seed >>> 16 ) & LCG_RAND_MAX ) / LCG_RAND_MAX;
	};

	const value = ( prefix: string, name: string ) => {
		const low = Number( def[prefix + name + 'Min'] ) || 0;
		const high = Number( def[prefix + name + 'Max'] ) || 0;
		return low + ( high - low ) * random();
	};

	const p = value( ads === 1 ? 'ads' : 'hip', 'ViewKickPitch' );
	const y = value( ads === 1 ? 'ads' : 'hip', 'ViewKickYaw' );

	m.viewSpeed = [-p, y, -y * 0.5];
	m.gunSpeed[0] += value( ads > 0 ? 'ads' : 'hip', 'GunKickPitch' );
	m.gunSpeed[1] += value( ads > 0 ? 'ads' : 'hip', 'GunKickYaw' );
}

/**
 * @exec helper
 * ================
 * WeaponMotion_View
 *
 * Restores camera view angles toward zero in fixed sub-steps (0x4cec10).
 * 0.06 damping factor resists motion returning to center without dulling the kick impulse.
 * ================
 */
export function WeaponMotion_View(
	position: number,
	speed: number,
	dt: number,
	center: number
): [number, number] {
	if ( position !== 0 ) {
		speed -= Math.sign( position ) * center * dt;
	}

	let step = speed * dt;

	if ( step * position < 0 ) {
		step *= VIEWKICK_RETURN_DAMPING;
	}

	const next = position + step;

	if ( next * position < 0 || next === 0 ) {
		return [0, 0];
	}

	if ( Math.abs( next ) > VIEWKICK_MAX_ANGLE ) {
		return [Math.sign( next ) * VIEWKICK_MAX_ANGLE, 0];
	}

	return [next, speed];
}

/**
 * @exec helper
 * ================
 * WeaponMotion_Gun
 *
 * Simulates physical gun kick spring with restoring force, damping, and hard limits (0x4f6380).
 * ================
 */
export function WeaponMotion_Gun(
	position: number,
	speed: number,
	dt: number,
	limit: number,
	accel: number,
	maxSpeed: number,
	decay: number,
	staticDecay: number
): [number, number] {
	if ( Math.abs( position ) < GUNKICK_EPSILON_POS && Math.abs( speed ) < GUNKICK_EPSILON_SPEED ) {
		return [0, 0];
	}

	position += speed * dt;

	if ( position > limit ) {
		position = limit;
		if ( speed > 0 ) {
			speed = 0;
		}
	} else if ( position < -limit ) {
		position = -limit;
		if ( speed < 0 ) {
			speed = 0;
		}
	}

	speed -= Math.sign( position ) * accel * dt;
	speed -= speed * dt * decay;
	speed = Math.sign( speed ) * Math.max( 0, Math.abs( speed ) - dt * staticDecay );

	return [position, Math.max( -maxSpeed, Math.min( maxSpeed, speed ) )];
}


// ---------------------------------------------------------------------------
// integration update
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * WeaponMotion_Update
 *
 * Integrates view kick and gun kick in discrete <= 5ms sub-steps to ensure
 * simulation fidelity is invariant to render frame rate.
 * ================
 */
export function WeaponMotion_Update(
	m: weapon_motion_t,
	def: Record<string, string>,
	ads: number,
	msec: number,
	stance: number
): void {
	const blend = ( name: string ) =>
		( Number( def['hip' + name] ) || 0 ) * ( 1 - ads ) +
		( Number( def['ads' + name] ) || 0 ) * ads;

	const factor = Number(
		def[stance === 11 ? 'idleProneFactor' : stance === 40 ? 'idleCrouchFactor' : '']
	) || 1;

	m.idleFactor += Math.sign( factor - m.idleFactor ) * Math.min( Math.abs( factor - m.idleFactor ), msec * IDLE_FACTOR_RATE );
	m.idleTime += Math.trunc( blend( 'IdleSpeed' ) * msec );

	for ( let left = msec; left > 0; left -= WEAPON_SUBSTEP_MS ) {
		const dt = Math.min( WEAPON_SUBSTEP_MS, left ) * 0.001;

		for ( let i = 0; i < 3; i++ ) {
			[m.view[i], m.viewSpeed[i]] = WeaponMotion_View(
				m.view[i],
				m.viewSpeed[i],
				dt,
				Number( def[( ads > 0.5 ? 'ads' : 'hip' ) + 'ViewKickCenterSpeed'] ) || 0
			);
		}

		for ( let i = 0; i < 2; i++ ) {
			[m.gun[i], m.gunSpeed[i]] = WeaponMotion_Gun(
				m.gun[i],
				m.gunSpeed[i],
				dt,
				Number( def[i ? 'gunMaxYaw' : 'gunMaxPitch'] ) || 10,
				blend( 'GunKickAccel' ),
				blend( 'GunKickSpeedMax' ),
				blend( 'GunKickSpeedDecay' ),
				blend( 'GunKickStaticDecay' )
			);
		}
	}
}


// ---------------------------------------------------------------------------
// procedural idle & bob
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * WeaponMotion_Idle
 *
 * Computes breathing sway using three independent sine wave phase rates (0x4f5eb0).
 * Suppressed when using sniper scope reticles.
 * ================
 */
export function WeaponMotion_Idle(
	m: weapon_motion_t,
	def: Record<string, string>,
	ads: number
): number[] {
	let amount =
		( ( Number( def.hipIdleAmount ) || 0 ) * ( 1 - ads ) +
			( Number( def.adsIdleAmount ) || 0 ) * ads ) *
		m.idleFactor *
		IDLE_AMOUNT_SCALE;

	if ( def.adsOverlayReticle && def.adsOverlayReticle !== 'none' ) {
		amount *= 1 - ads;
	}

	return IDLE_BREATH_RATES.map( ( rate ) => Math.sin( m.idleTime * rate ) * amount );
}

/**
 * @exec helper
 * ================
 * WeaponMotion_Bob
 *
 * Drives weapon bobbing motion from player movement cycle counter (0x4f6070, 0x4f5ac0).
 * Generates three angular harmonics: pitch wave, yaw wave, and roll dip.
 * ================
 */
export function WeaponMotion_Bob(
	m: weapon_motion_t,
	def: Record<string, string>,
	ads: number
): number[] {
	const phase =
		( ( m.bobCycle ?? 0 ) & BOB_CYCLE_MASK ) * Math.fround( BOB_PHASE_STEP ) +
		Math.fround( BOB_PHASE_OFFSET_A ) +
		Math.fround( BOB_PHASE_OFFSET_B );

	const stance = m.stance ?? STANCE_HEIGHT_STAND;
	const key =
		stance === STANCE_HEIGHT_PRONE
			? CVAR_BOB_AMPLITUDE_PRONE
			: stance === STANCE_HEIGHT_CROUCH
				? CVAR_BOB_AMPLITUDE_DUCKED
				: CVAR_BOB_AMPLITUDE_STANDING;

	const defaultAmplitude =
		stance === STANCE_HEIGHT_PRONE
			? BOB_AMPLITUDE_PRONE_DEFAULT
			: stance === STANCE_HEIGHT_CROUCH
				? BOB_AMPLITUDE_DUCKED_DEFAULT
				: BOB_AMPLITUDE_STANDING_DEFAULT;

	const amplitude =
		( m.bobSpeed ?? 0 ) *
		Math.fround( BOB_SPEED_SCALE ) *
		Number( Cvar_Get( key ) || defaultAmplitude );

	let scale = 1 - ( 1 - Number( def.adsBobFactor ?? 1 ) ) * ads;

	if ( def.adsOverlayReticle && def.adsOverlayReticle !== 'none' ) {
		scale *= 1 - ads;
	}

	return [
		-(
			Math.sin( phase * 4 + Math.fround( Math.PI / 2 ) ) * Math.fround( BOB_PITCH_WAVE_SCALE ) +
			Math.sin( phase * 2 )
		) *
			Math.min( amplitude, BOB_MAX_AMPLITUDE ) *
			BOB_PITCH_SCALE,
		-Math.sin( phase ) * Math.min( amplitude, BOB_MAX_AMPLITUDE ),
		Math.min( 0, Math.sin( phase - Math.fround( BOB_ROLL_PHASE_OFFSET ) ) * Math.min( amplitude * BOB_ROLL_SCALE, BOB_MAX_AMPLITUDE ) ),
	].map( ( v ) => v * scale );
}


// ---------------------------------------------------------------------------
// movement lag offsets
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * WeaponMotion_MoveRotation
 *
 * Applies procedural inertia rotation to weapon model while moving (0x4f5b90).
 * Approximates speed fraction above minimum stance threshold.
 * ================
 */
export function WeaponMotion_MoveRotation(
	previous: number[],
	def: Record<string, string>,
	speed: number,
	maxSpeed: number,
	stance: number,
	ads: number,
	reloading: boolean,
	dt: number
): number[] {
	const prefix = stance === 11 ? 'prone' : stance === 40 ? 'ducked' : 'stand';
	const minimum = Number( def[prefix + 'RotMinSpeed'] ) || 0;

	const fraction = speed > minimum && !reloading
		? Math.max( 0, Math.min( 1, ( speed - minimum ) / ( maxSpeed - minimum ) ) ) * ( 1 - ads )
		: 0;

	const rate = Number( def[stance === 11 ? 'posProneRotRate' : 'posRotRate'] ) || 0;

	return previous.map( ( value, i ) => {
		const target = ( Number( def[prefix + 'Rot' + 'PYR'[i]] ) || 0 ) * fraction;
		const delta = target - value;

		return value + Math.sign( delta ) * Math.min( Math.abs( delta ), Math.max( Math.abs( delta ) * rate * dt, Math.fround( 0.1 ) * dt ) );
	} );
}

/**
 * @exec helper
 * ================
 * WeaponMotion_MovePosition
 *
 * Applies procedural translation lag and stance positional offsets to weapon model (0x4d5360).
 * ================
 */
export function WeaponMotion_MovePosition(
	previous: number[],
	def: Record<string, string>,
	speed: number,
	maxSpeed: number,
	stance: number,
	reloading: boolean,
	dt: number
): number[] {
	const prefix = stance === 11 ? 'prone' : stance === 40 ? 'ducked' : 'stand';

	const minimum =
		( Number( def[prefix + 'MoveMinSpeed'] ) || 0 ) +
		( Number( Cvar_Get( 'cg_gun_move_minspeed' ) ) || 0 );

	const fraction = speed > minimum && !reloading
		? Math.max( 0, Math.min( 1, ( speed - minimum ) / ( maxSpeed - minimum ) ) )
		: 0;

	const rate =
		( Number( def[stance === 11 ? 'posProneMoveRate' : 'posMoveRate'] ) || 0 ) +
		( Number( Cvar_Get( 'cg_gun_move_rate' ) ) || 0 );

	return previous.map( ( value, i ) => {
		const axis = 'FRU'[i];
		const offset = stance === 60
			? 0
			: ( Number( def[prefix + 'Ofs' + axis] ) || 0 ) +
				( Number( Cvar_Get( 'cg_gun_ofs_' + axis.toLowerCase() ) ) || 0 );

		const target =
			( ( Number( def[prefix + 'Move' + axis] ) || 0 ) +
				( Number( Cvar_Get( 'cg_gun_move_' + axis.toLowerCase() ) ) || 0 ) ) *
				fraction +
			offset;

		const delta = target - value;

		return value + Math.sign( delta ) * Math.min( Math.abs( delta ), Math.max( Math.abs( delta ) * rate * dt, Math.fround( 0.0001 ) * dt * 1000 ) );
	} );
}
