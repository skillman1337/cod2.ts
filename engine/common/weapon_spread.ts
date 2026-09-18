/*
===============================================================================

	weapon_spread.ts

	Call of Duty 2 / id Tech Weapon Accuracy & Hip Spread Mechanics
	Computes dynamic 0..255 aim-spread scalar, stance angular cone interpolation,
	aim-down-sights spread overrides, and Monte Carlo projectile raycasting.
	Reconstructed from native routines 0x4f3e80, 0x4f2510, 0x527e4b, 0x5272c0.

===============================================================================
*/

import {
	STANCE_HEIGHT_PRONE,
	STANCE_HEIGHT_CROUCH,
	STANCE_HEIGHT_STAND,
} from './stance.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const MAX_SPREAD_VALUE        = 255;
export const FULL_CIRCLE_DEGREES     = 360;
export const CRT_RAND_DIVISOR        = 32768;

export const AIR_SPREAD_DECAY_FACTOR = 0.5;
export const AIR_SPREAD_ADD_RATE     = 2;
export const TURN_SPREAD_SCALE       = 0.01;
export const SPREAD_DEG2RAD          = Math.PI / 180;


// ---------------------------------------------------------------------------
// spread state dynamics
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * WeaponSpread_Update
 *
 * Updates the shared 0..255 aim-spread scale (0x4f3e80).
 * Decays spread towards zero based on stance decay rates while accumulating penalties
 * for moving, jumping/falling, and view turning.
 * ================
 */
export function WeaponSpread_Update(
	value: number,
	def: Record<string, string>,
	dt: number,
	ads: number,
	stance: number,
	grounded: boolean,
	moving: boolean,
	speed: number,
	minimumSpeed: number,
	turn: number
): number {
	const decay = Number( def.hipSpreadDecayRate ) || 0;

	if ( !decay ) {
		return Math.max( 0, value - MAX_SPREAD_VALUE );
	}

	const stanceFactor = !grounded
		? AIR_SPREAD_DECAY_FACTOR
		: stance === STANCE_HEIGHT_PRONE
			? Number( def.hipSpreadProneDecay ) || 1
			: stance === STANCE_HEIGHT_CROUCH
				? Number( def.hipSpreadDuckedDecay ) || 1
				: 1;

	const decrease = decay * stanceFactor * dt;

	const increase = ads === 1
		? 0
		: ( moving && speed > minimumSpeed ? ( Number( def.hipSpreadMoveAdd ) || 0 ) * dt : 0 ) +
			( !grounded ? AIR_SPREAD_ADD_RATE * dt : 0 ) +
			turn * ( Number( def.hipSpreadTurnAdd ) || 0 ) * TURN_SPREAD_SCALE;

	return Math.max( 0, Math.min( MAX_SPREAD_VALUE, value + ( increase - decrease ) * MAX_SPREAD_VALUE ) );
}


// ---------------------------------------------------------------------------
// angular spread calculations
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * WeaponSpread_Angle
 *
 * Interpolates stance spread using view height through stand/duck/prone transitions (0x4f2510).
 * ================
 */
export function WeaponSpread_Angle(
	def: Record<string, string>,
	value: number,
	height: number
): number {
	const a = height > STANCE_HEIGHT_CROUCH ? 'Stand' : 'Ducked';
	const b = height > STANCE_HEIGHT_CROUCH ? 'Ducked' : 'Prone';
	const t = height > STANCE_HEIGHT_CROUCH
		? ( height - STANCE_HEIGHT_CROUCH ) / ( STANCE_HEIGHT_STAND - STANCE_HEIGHT_CROUCH )
		: ( height - STANCE_HEIGHT_PRONE ) / ( STANCE_HEIGHT_CROUCH - STANCE_HEIGHT_PRONE );

	const field = ( stance: string, suffix: string ) =>
		Number( def['hipSpread' + ( stance === 'Stand' && suffix === 'Max' ? '' : stance ) + suffix] );

	const blend = ( suffix: string ) => {
		const low = field( b, suffix );
		const high = field( a, suffix );
		return low + ( high - low ) * t;
	};

	const min = blend( 'Min' );
	const max = blend( 'Max' );

	return min + ( ( max - min ) * value ) / MAX_SPREAD_VALUE;
}

/**
 * @exec helper
 * ================
 * WeaponSpread_ShotAngle
 *
 * Resolves current shot deviation cone angle in degrees (0x527e4b..0x527e8b).
 * Only fully aimed fire (ADS = 1) substitutes adsSpread for the minimum cone size.
 * ================
 */
export function WeaponSpread_ShotAngle(
	def: Record<string, string>,
	value: number,
	height: number,
	ads: number
): number {
	if ( ads !== 1 ) {
		return WeaponSpread_Angle( def, value, height );
	}

	const minimum = Number( def.adsSpread ) || 0;
	const maximum = WeaponSpread_Angle( def, MAX_SPREAD_VALUE, height );

	return minimum + ( ( maximum - minimum ) * value ) / MAX_SPREAD_VALUE;
}


// ---------------------------------------------------------------------------
// projectile spread raycasting
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * WeaponSpread_End
 *
 * Computes bullet endpoint perturbed by spread cone (0x5272c0 / 0x527360).
 * Uses two CRT rand samples: uniform radius distribution and circular angle.
 * ================
 */
export function WeaponSpread_End(
	origin: number[],
	forward: number[],
	right: number[],
	up: number[],
	spread: number,
	range: number,
	angleRandom: number,
	radiusRandom: number
): number[] {
	const f = Math.fround;
	const radians = f( SPREAD_DEG2RAD );
	const angle = f( f( ( angleRandom / CRT_RAND_DIVISOR ) * FULL_CIRCLE_DEGREES ) * radians );
	const radius = f( radiusRandom / CRT_RAND_DIVISOR );
	const x = f( f( Math.cos( angle ) ) * radius );
	const y = f( f( Math.sin( angle ) ) * radius );
	const scale = f( Math.tan( spread * radians ) * range );

	return origin.map( ( v, i ) =>
		f( f( f( v + range * forward[i] ) + x * scale * right[i] ) + y * scale * up[i] )
	);
}
