/*
===============================================================================

	movement_events.ts

	Call of Duty 2 / id Tech Player Locomotion Events & Footsteps
	Animation reference playback speed, footstep cycle phase transitions,
	surface-based sound alias lookups, and predicted audio event queues.
	Reconstructed from native routines 0x51874c..0x518aaa, 0x51863a, 0x5168d0, 0x518abc.

===============================================================================
*/

import { pm_movement_t } from './types.js';
import surfaces from '@/assets/ui/surfaces.json';
import {
	STANCE_HEIGHT_PRONE,
	STANCE_HEIGHT_CROUCH,
	STANCE_DURATION_PRONE,
	type stance_state_t,
} from './stance.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const CYCLE_MASK                 = 255;
export const CYCLE_HALF                 = 128;
export const CYCLE_OFFSET               = 64;

export const SURFACE_NO_FOLEY_FLAG      = 0x2000;
export const SURFACE_FLAG_SHIFT         = 20;
export const SURFACE_FLAG_MASK          = 31;

export const SOUND_EVENT_HISTORY_LIMIT  = 8;

export const STRAFE_BLEND_FACTOR        = 0.75;
export const SLOW_MOVE_RATIO            = 0.4;
export const PRONE_SPEED_RATIO          = 0.15;
export const CROUCH_SPEED_RATIO         = 0.65;

export const STEP_RATE_PRONE            = 0.25;
export const STEP_RATE_PRONE_SLOW       = 0.24;
export const STEP_RATE_CROUCH           = 0.34;
export const STEP_RATE_CROUCH_SLOW      = 0.315;
export const STEP_RATE_BACK             = 0.36;
export const STEP_RATE_BACK_SLOW        = 0.325;
export const STEP_RATE_FORWARD          = 0.335;
export const STEP_RATE_FORWARD_SLOW     = 0.305;

export const LADDER_CYCLE_FACTOR_SLOW   = 0.02624671906232834;
export const LADDER_CYCLE_WEIGHT_SLOW   = 0.35;
export const LADDER_CYCLE_FACTOR_FAST   = 0.010498687624931335;
export const LADDER_CYCLE_WEIGHT_FAST   = 0.45;


// ---------------------------------------------------------------------------
// animation playback rate
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Movement_Rate
 *
 * Computes authored animation reference rate ratio (0x51874c..0x518aaa).
 * Accounts for forward/strafe move inputs, backpedal penalties, ADS slow speeds,
 * and dynamic stance height blending.
 * ================
 */
export function Movement_Rate(
	speed: number,
	base: number,
	fm: number,
	rm: number,
	stance: stance_state_t,
	slow: boolean,
	back: number,
	strafe: number
): number {
	const f = Math.fround;
	const side = ( f( strafe ) - 1 ) * STRAFE_BLEND_FACTOR + 1;
	let reference = Math.trunc( base );

	if ( fm && rm ) {
		reference = f( ( side + 1 ) * reference * 0.5 );

		if ( fm < 0 ) {
			reference = f( ( f( back ) + 1 ) * reference * 0.5 );
		}
	} else if ( fm < 0 ) {
		reference = f( reference * f( back ) );
	} else if ( !fm && rm ) {
		reference = f( reference * side );
	}

	if ( slow ) {
		reference = f( reference * f( SLOW_MOVE_RATIO ) );
	}

	let stanceScale = stance.target === STANCE_HEIGHT_PRONE
		? f( PRONE_SPEED_RATIO )
		: stance.target === STANCE_HEIGHT_CROUCH
			? f( CROUCH_SPEED_RATIO )
			: 1;

	if (
		( stance.from === STANCE_HEIGHT_CROUCH && stance.to === STANCE_HEIGHT_PRONE ) ||
		( stance.from === STANCE_HEIGHT_PRONE && stance.to === STANCE_HEIGHT_CROUCH )
	) {
		const t = Math.max( 0, Math.min( 1, stance.elapsed / STANCE_DURATION_PRONE ) );
		stanceScale = stance.to === STANCE_HEIGHT_PRONE
			? ( 1 - t ) * f( CROUCH_SPEED_RATIO ) + t * f( PRONE_SPEED_RATIO )
			: ( 1 - t ) * f( PRONE_SPEED_RATIO ) + t * f( CROUCH_SPEED_RATIO );
	}

	reference *= stanceScale;

	const rate = stance.target === STANCE_HEIGHT_PRONE
		? ( slow ? STEP_RATE_PRONE_SLOW : STEP_RATE_PRONE )
		: stance.target === STANCE_HEIGHT_CROUCH
			? ( slow ? STEP_RATE_CROUCH_SLOW : STEP_RATE_CROUCH )
			: fm < 0
				? ( slow ? STEP_RATE_BACK_SLOW : STEP_RATE_BACK )
				: ( slow ? STEP_RATE_FORWARD_SLOW : STEP_RATE_FORWARD );

	return reference > 0 ? f( ( f( speed ) / reference ) * f( rate ) ) : 0;
}


// ---------------------------------------------------------------------------
// movement cycles & footstep detection
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Movement_Cycle
 *
 * Advances 8-bit footstep cycle counter and detects step phase boundary crossing (0x518abc, 0x5182f0).
 * Detects crossing the half-cycle (128) boundary using offset XOR logic.
 * Retail truncates the scaled advance every call; on fixed server ticks that is
 * exact, but on uncapped variable frametimes a slowed (ADS) advance can stay
 * below 1.0 cycle units forever and freeze gait + footsteps. The fractional
 * remainder is carried in `fraction` so total progress is exact at any slice
 * size while per-slice integers still match retail when no remainder exists.
 * ================
 */
export function Movement_Cycle(
	cycle: number,
	msec: number,
	rate: number,
	fraction: number = 0
): { cycle: number; step: boolean; fraction: number } {
	const base = Math.trunc( cycle ) & CYCLE_MASK;
	const total = fraction + msec * Math.fround( rate );
	const advance = Math.trunc( total );
	const next = ( base + advance ) & CYCLE_MASK;
	const step = Boolean( ( ( base + CYCLE_OFFSET ) ^ ( next + CYCLE_OFFSET ) ) & CYCLE_HALF );

	return { cycle: next, step, fraction: total - advance };
}

/**
 * @exec helper
 * ================
 * Movement_LadderCycle
 *
 * Advances signed ladder climbing cycle counter based on vertical velocity (0x51863a..0x5186e2).
 * Operates without requiring ground contact.
 * ================
 */
export function Movement_LadderCycle(
	cycle: number,
	msec: number,
	vertical: number,
	slow: boolean,
	fraction: number = 0
): { cycle: number; step: boolean; fraction: number } {
	const f = Math.fround;
	const rate = slow
		? f( vertical ) * f( LADDER_CYCLE_FACTOR_SLOW ) * f( LADDER_CYCLE_WEIGHT_SLOW )
		: f( vertical ) * f( LADDER_CYCLE_FACTOR_FAST ) * f( LADDER_CYCLE_WEIGHT_FAST );

	const base = Math.trunc( cycle ) & CYCLE_MASK;
	const total = fraction + msec * rate;
	const advance = Math.trunc( total );
	const next = ( base + advance ) & CYCLE_MASK;
	const step = Boolean( ( ( base + CYCLE_OFFSET ) ^ ( next + CYCLE_OFFSET ) ) & CYCLE_HALF );

	return { cycle: next, step, fraction: total - advance };
}


// ---------------------------------------------------------------------------
// sound alias lookup & event dispatch
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Movement_Aliases
 *
 * Resolves audio alias names for locomotion events based on surface flags (0x5168d0, 0x52ff20, 0x4e0910).
 * Combines surface footstep sound with player gear rattle audio.
 * ================
 */
export function Movement_Aliases(
	kind: 'run' | 'walk' | 'prone' | 'jump' | 'land',
	flags: number
): string[] {
	const surface = flags & SURFACE_NO_FOLEY_FLAG ? 0 : ( flags >>> SURFACE_FLAG_SHIFT ) & SURFACE_FLAG_MASK;

	if ( ( !surface && kind !== 'land' ) || !surfaces[surface] ) {
		return [];
	}

	const family = kind === 'land'
		? 'land_plr'
		: kind === 'jump'
			? 'step_run_plr'
			: `step_${kind}_plr`;

	if ( kind === 'land' ) {
		return [`${family}_${surfaces[surface]}`];
	}

	return [
		`${family}_${surfaces[surface]}`,
		`gear_rattle_plr_${kind === 'walk' || kind === 'prone' ? 'walk' : 'run'}`,
	];
}

/**
 * @exec helper
 * ================
 * Movement_Emit
 *
 * Appends predicted locomotion sound event to movement state with monotonic sequence number.
 * ================
 */
export function Movement_Emit(
	move: pm_movement_t,
	kind: 'run' | 'walk' | 'prone' | 'jump' | 'land',
	flags: number
): void {
	const aliases = Movement_Aliases( kind, flags );

	if ( !aliases.length ) {
		return;
	}

	const sequence = ( move.soundSequence ?? 0 ) + 1;
	move.soundSequence = sequence;

	move.soundEvents = [
		...( move.soundEvents ?? [] ),
		{ sequence, aliases },
	].slice( -SOUND_EVENT_HISTORY_LIMIT );
}
