/*
===============================================================================

	weapon.ts

	Call of Duty 2 / id Tech Player Weapon Simulation & State Machine
	Handles weapon timing, ammo counters, raising, lowering on ladders,
	firing delays, segmented reloads, bolt-action rechambers, ADS blends,
	and weapon animations based on native routines 0x4f4340, 0x4f42f0, 0x4f2912.

===============================================================================
*/

import definitions from '@/assets/ui/weapons.json';
import { IN_ATTACK, IN_ADS, IN_RELOAD, type pm_movement_t } from './types.js';
import {
	WeaponMotion_Create,
	WeaponMotion_Fire,
	WeaponMotion_Update,
	WeaponMotion_MoveRotation,
	WeaponMotion_MovePosition,
	type weapon_motion_t,
} from './weapon_motion.js';
import { WeaponSpread_Update } from './weapon_spread.js';
import { Cvar_Get } from './cvar.js';


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface weapon_shot_t {
	sequence: number;
	pellet?: number;
	time: number;
	position: number[];
	normal: number[];
	direction: number[];
	surfaceFlags: number;
	hit: boolean;
}

export interface weapon_state_t {
	id: string;
	ads: number;
	adsIn: boolean;
	adsBlend?: number;
	adsBlendStart?: number;
	adsBlendTime?: number;
	adsBlendTarget?: boolean;
	phase: 'raise' | 'idle' | 'fire' | 'reload' | 'reloadEmpty' | 'reloadStart' | 'reloadEnd' | 'rechamber';
	elapsed: number;
	remaining: number;
	clip: number;
	reserve: number;
	oldButtons: number;
	sequence: number;
	shotTime: number;
	pendingShot: boolean;
	delay: number;
	reloadAdded: boolean;
	reloadInterrupted?: boolean;
	holster?: 'drop' | 'hidden' | 'raise';
	holsterElapsed?: number;
	holsterRemaining?: number;
	motion?: weapon_motion_t;
	time?: number;
	shots?: weapon_shot_t[];
	spread?: number;
	viewHeight?: number;
	spreadAngles?: number[];
}


// ---------------------------------------------------------------------------
// definition queries & timing
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Weapon_Definition
 *
 * Looks up weapon attribute records from compiled weapon JSON assets.
 * ================
 */
export function Weapon_Definition( id: string ): Record<string, string> | undefined {
	return definitions[id as keyof typeof definitions] as Record<string, string> | undefined;
}

/**
 * @exec helper
 * ================
 * Weapon_Time
 *
 * Converts authored floating-point seconds into integer milliseconds (native field type 7).
 * ================
 */
export function Weapon_Time( def: Record<string, string>, key: string ): number {
	return Math.max( 0, Math.trunc( Math.fround( Number( def[key] ) || 0 ) * 1000 ) );
}


// ---------------------------------------------------------------------------
// ads & fov calculations
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Weapon_Ads
 *
 * 0x4f2912 / 0x4f293b: Advances ADS transition fraction [0, 1] using reciprocal rates.
 * ================
 */
export function Weapon_Ads(
	value: number,
	aim: boolean,
	msec: number,
	inTime: number,
	outTime: number
): number {
	const duration = aim ? inTime : outTime;
	const delta = msec * Math.fround( duration > 0 ? 1 / duration : 1 );

	return Math.max( 0, Math.min( 1, Math.fround( value + ( aim ? delta : -delta ) ) ) );
}

/**
 * @exec helper
 * ================
 * Weapon_Fov
 *
 * 0x4cf183..0x4cf224: Zoom starts in the authored final fraction of ADS travel.
 * ================
 */
export function Weapon_Fov( base: number, state: weapon_state_t | undefined ): number {
	const def = state && Weapon_Definition( state.id );

	if ( !def || !state || def.aimDownSight !== '1' ) {
		return base;
	}

	const fraction = Number( def[state.adsIn ? 'adsZoomInFrac' : 'adsZoomOutFrac'] ) || 1;
	const t = state.ads === 1 ? 1 : Math.max( 0, ( state.ads - ( 1 - fraction ) ) / fraction );

	return base + ( Number( def.adsZoomFov ) - base ) * t;
}


// ---------------------------------------------------------------------------
// audio helpers
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Weapon_Sound
 *
 * Appends predicted weapon sound event to player movement state.
 * Sound sequence counter prevents predicted replay on server reconciliation.
 * ================
 */
function Weapon_Sound( move: pm_movement_t, alias: string | undefined ): void {
	if ( !alias ) {
		return;
	}

	const sequence = ( move.soundSequence ?? 0 ) + 1;
	move.soundSequence = sequence;

	move.soundEvents = [
		...( move.soundEvents ?? [] ),
		{ sequence, aliases: [alias.toLowerCase()] },
	].slice( -8 );
}

/**
 * @exec helper
 * ================
 * Weapon_ReloadSound
 *
 * Reconstructs sound selection at 0x4e0f12..0x4e0ffa:
 * Prefers player-specific reload sound aliases before world aliases.
 * ================
 */
export function Weapon_ReloadSound( def: Record<string, string>, empty: boolean ): string | undefined {
	const a = empty ? 'reloadEmptySound' : 'reloadSound';
	const b = empty ? 'reloadSound' : 'reloadEmptySound';

	return def[a + 'Player'] || def[b + 'Player'] || def[a] || def[b];
}

/**
 * @exec helper
 * ================
 * Weapon_CanReload
 *
 * 0x4f3800: Evaluates whether weapon can reload.
 * When noPartialReload is enabled, a complete insertion must fit into remaining clip capacity.
 * ================
 */
export function Weapon_CanReload( w: weapon_state_t, def: Record<string, string> ): boolean {
	const size = Number( def.clipSize );
	const add = Number( def.reloadAmmoAdd );

	return (
		w.reserve > 0 &&
		w.clip < size &&
		( def.noPartialReload !== '1' || ( add > 0 && add < size ? size - w.clip >= add : w.clip === 0 ) )
	);
}


// ---------------------------------------------------------------------------
// weapon simulation update
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Weapon_Update
 *
 * Native bullet weapon timing/clip state adapter (0x4f4340, 0x4f42f0).
 * Simulation owns ammo and events; animation and sound consume that state.
 * ================
 */
export function Weapon_Update(
	move: pm_movement_t,
	buttons: number,
	msec: number,
	id: string,
	enabled: boolean,
	shot?: () => void,
	input?: { speed: number; moving: boolean; angles: number[] }
): void {
	const def = Weapon_Definition( id );

	if ( !enabled || !def || def.weaponType !== 'bullet' ) {
		move.weapon = undefined;
		return;
	}

	if ( move.weapon?.id !== id ) {
		const clip = Number( def.clipSize ) || 0;

		move.weapon = {
			id,
			ads: 0,
			adsIn: false,
			phase: 'raise',
			elapsed: 0,
			remaining: Weapon_Time( def, 'raiseTime' ),
			clip,
			reserve: Math.max( 0, ( Number( def.startAmmo ) || 0 ) - clip ),
			oldButtons: buttons,
			sequence: 0,
			shotTime: -10000,
			pendingShot: false,
			delay: 0,
			reloadAdded: false,
		};

		Weapon_Sound( move, def.raiseSound );
	}

	const w = ( move.weapon = { ...move.weapon } );
	w.elapsed += msec;
	w.remaining = Math.max( 0, w.remaining - msec );

	const previous = w.motion ?? WeaponMotion_Create();

	w.motion = {
		...previous,
		view: [...previous.view],
		viewSpeed: [...previous.viewSpeed],
		gun: [...previous.gun],
		gunSpeed: [...previous.gunSpeed],
	};

	w.time = move.commandTime;

	WeaponMotion_Update( w.motion, def, w.ads, msec, move.stance?.target ?? 60 );

	w.motion.bobCycle = move.bobCycle ?? 0;
	w.motion.bobSpeed = input?.speed ?? 0;
	w.motion.stance = move.stance?.target ?? 60;
	w.motion.lean = move.lean ?? 0;

	w.motion.moveRotation = WeaponMotion_MoveRotation(
		previous.moveRotation ?? [0, 0, 0],
		def,
		input?.speed ?? 0,
		Number( Cvar_Get( 'g_speed' ) ) || 190,
		move.stance?.target ?? 60,
		w.ads,
		w.phase === 'reload' || w.phase === 'reloadEmpty',
		msec * 0.001
	);

	w.motion.movePosition = WeaponMotion_MovePosition(
		previous.movePosition ?? [0, 0, 0],
		def,
		input?.speed ?? 0,
		Number( Cvar_Get( 'g_speed' ) ) || 190,
		move.stance?.target ?? 60,
		w.phase === 'reload' || w.phase === 'reloadEmpty',
		msec * 0.001
	);

	const blocked = Boolean( move.mantle?.active ) || Boolean( move.ladder );

	// 0x4f41c0 -> 0x4f3280: ladder requests the ordinary weapon drop.
	// Finish the drop before selecting weapon zero; leaving the ladder then
	// raises the selected weapon (0x4f3596), preserving its ammunition.
	if ( w.holster ) {
		w.holsterElapsed = ( w.holsterElapsed ?? 0 ) + msec;
		w.holsterRemaining = Math.max( 0, ( w.holsterRemaining ?? 0 ) - msec );
	}

	if ( w.holster === 'drop' && !w.holsterRemaining ) {
		w.holster = 'hidden';
	}

	if ( w.holster === 'raise' && !w.holsterRemaining ) {
		w.holster = undefined;
		w.phase = 'idle';
		w.elapsed = 0;
		w.remaining = 0;
	}

	if ( move.ladder && !w.holster && ( !w.remaining || w.phase.startsWith( 'reload' ) ) ) {
		w.holster = 'drop';
		w.holsterElapsed = 0;
		w.holsterRemaining = Weapon_Time( def, 'dropTime' );
		w.pendingShot = false;
		w.delay = 0;
		w.remaining = 0;
		w.phase = 'idle';
		Weapon_Sound( move, def.putawaySoundPlayer || def.putawaySound );
	}

	if ( !move.ladder && w.holster === 'hidden' ) {
		w.holster = 'raise';
		w.holsterElapsed = 0;
		w.holsterRemaining = Weapon_Time( def, 'raiseTime' );
		Weapon_Sound( move, def.raiseSoundPlayer || def.raiseSound );
	}

	w.adsIn = !blocked &&
		!w.holster &&
		Boolean( buttons & IN_ADS ) &&
		def.aimDownSight === '1' &&
		w.phase !== 'raise' &&
		!w.phase.startsWith( 'reload' );

	w.ads = Weapon_Ads(
		w.ads,
		w.adsIn,
		msec,
		Weapon_Time( def, 'adsTransInTime' ),
		Weapon_Time( def, 'adsTransOutTime' )
	);

	// 0x4d36b0: both ADS tracks keep their phase; direction changes blend over .5 seconds.
	if ( w.adsBlendTarget !== w.adsIn ) {
		w.adsBlendStart = w.adsBlend ?? 0;
		w.adsBlendTime = 0;
		w.adsBlendTarget = w.adsIn;
	}

	w.adsBlendTime = Math.min( 500, ( w.adsBlendTime ?? 0 ) + msec );
	w.adsBlend = ( w.adsBlendStart ?? 0 ) + ( ( w.adsIn ? 1 : 0 ) - ( w.adsBlendStart ?? 0 ) ) * ( w.adsBlendTime / 500 );
	w.viewHeight = move.stance?.height ?? 60;

	const turn = input
		? input.angles.slice( 0, 2 ).reduce(
			( sum, a, i ) => sum + Math.abs( ( ( ( a - ( w.spreadAngles?.[i] ?? a ) + 540 ) % 360 ) - 180 ) ),
			0
		)
		: 0;

	w.spread = WeaponSpread_Update(
		w.spread ?? 0,
		def,
		msec * 0.001,
		w.ads,
		move.stance?.target ?? 60,
		move.grounded,
		input?.moving ?? false,
		input?.speed ?? 0,
		Number( Cvar_Get( 'bg_aimSpreadMoveSpeedThreshold' ) ) || 11,
		turn
	);

	if ( input ) {
		w.spreadAngles = [...input.angles];
	}

	const fire = () => {
		if ( !w.clip ) {
			return;
		}

		w.clip--;
		w.sequence++;

		if ( w.ads !== 1 ) {
			w.spread = Math.min( 255, ( w.spread ?? 0 ) + ( Number( def.hipSpreadFireAdd ) || 0 ) * 255 );
		}

		w.shotTime = move.commandTime;
		w.pendingShot = false;

		WeaponMotion_Fire( w.motion!, def, w.ads );
		shot?.();

		Weapon_Sound(
			move,
			( w.clip === 0 ? def.lastShotSoundPlayer : '' ) || def.fireSoundPlayer || def.fireSound
		);
	};

	if ( w.pendingShot ) {
		w.delay = Math.max( 0, w.delay - msec );

		if ( !w.delay && !blocked ) {
			fire();
		}
	}

	const reloadPhase = ( phase: 'reload' | 'reloadEmpty' | 'reloadStart' | 'reloadEnd' ) => {
		w.phase = phase;
		w.elapsed = 0;
		w.remaining = Weapon_Time( def, phase + 'Time' );
		w.reloadAdded = false;

		Weapon_Sound(
			move,
			phase === 'reload' || phase === 'reloadEmpty'
				? Weapon_ReloadSound( def, phase === 'reloadEmpty' )
				: def[phase + 'SoundPlayer'] || def[phase + 'Sound']
		);
	};

	if (
		def.segmentedReload === '1' &&
		w.phase.startsWith( 'reload' ) &&
		Boolean( buttons & IN_ATTACK ) &&
		!( w.oldButtons & IN_ATTACK )
	) {
		w.reloadInterrupted = true;
	}

	const startReload = w.phase === 'reloadStart';
	const addTime = Weapon_Time( def, startReload ? 'reloadStartAddTime' : 'reloadAddTime' );

	if (
		w.phase.startsWith( 'reload' ) &&
		w.phase !== 'reloadEnd' &&
		!w.reloadAdded &&
		( ( addTime > 0 && w.elapsed >= addTime ) || !w.remaining )
	) {
		const limit = startReload
			? Number( def.reloadStartAdd )
			: Number( def.reloadAmmoAdd ) || Infinity;

		const amount = Math.min( w.reserve, ( Number( def.clipSize ) || 0 ) - w.clip, limit );
		w.clip += amount;
		w.reserve -= amount;
		w.reloadAdded = true;
	}

	if ( !w.remaining && w.phase !== 'idle' ) {
		if ( w.phase === 'fire' && def.boltAction === '1' && def.rechamberAnim ) {
			w.phase = 'rechamber';
			w.elapsed = 0;
			w.remaining = Weapon_Time( def, 'rechamberTime' );
			Weapon_Sound( move, def.rechamberSoundPlayer || def.rechamberSound );
		} else if ( def.segmentedReload === '1' && w.phase.startsWith( 'reload' ) && w.phase !== 'reloadEnd' ) {
			if ( Weapon_CanReload( w, def ) && !( w.reloadInterrupted && w.clip > 0 ) ) {
				reloadPhase( w.clip ? 'reload' : 'reloadEmpty' );
			} else if ( Weapon_Time( def, 'reloadEndTime' ) ) {
				reloadPhase( 'reloadEnd' );
			} else {
				w.phase = 'idle';
				w.elapsed = 0;
			}
		} else {
			w.phase = 'idle';
			w.elapsed = 0;
		}
	}

	const attack = Boolean( buttons & IN_ATTACK );
	const edge = attack && !( w.oldButtons & IN_ATTACK );
	const reload = Boolean( buttons & IN_RELOAD ) && !( w.oldButtons & IN_RELOAD );

	if ( !blocked && !w.holster && w.phase === 'idle' ) {
		if ( ( reload || !w.clip ) && Weapon_CanReload( w, def ) ) {
			w.reloadInterrupted = false;
			reloadPhase(
				def.segmentedReload === '1' && Weapon_Time( def, 'reloadStartTime' )
					? 'reloadStart'
					: w.clip
						? 'reload'
						: 'reloadEmpty'
			);
		} else if ( attack && ( def.semiAuto !== '1' || edge ) && w.clip ) {
			w.phase = 'fire';
			w.elapsed = 0;
			w.remaining = Math.max( 1, Weapon_Time( def, 'fireTime' ) );
			w.delay = Weapon_Time( def, 'fireDelay' );
			w.pendingShot = Boolean( w.delay );

			if ( !w.delay ) {
				fire();
			}
		}
	}

	w.oldButtons = buttons;
}


// ---------------------------------------------------------------------------
// animation selection
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Weapon_Animation
 *
 * Selects active authored animation string from weapon definition dictionary.
 * Considers holstering, ADS state, last-shot empty clip conditions, and active phase.
 * ================
 */
export function Weapon_Animation( w: weapon_state_t ): string {
	const def = Weapon_Definition( w.id )!;

	if ( w.holster ) {
		return def[( w.holster === 'raise' ? 'raise' : 'drop' ) + 'Anim'] || def.idleAnim;
	}

	if ( w.phase === 'fire' ) {
		const adsAnim = w.ads > 0 ? ( w.clip ? def.adsFireAnim : def.adsLastShotAnim ) : '';
		const hipAnim = w.clip ? def.fireAnim : def.lastShotAnim;
		return adsAnim || hipAnim || def.fireAnim;
	}

	if ( w.phase === 'idle' ) {
		return ( w.clip ? def.idleAnim : def.emptyIdleAnim ) || def.idleAnim;
	}

	return def[w.phase + 'Anim'] || def.idleAnim;
}
