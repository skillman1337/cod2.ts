/*
===============================================================================

	sound_alias.ts

	Call of Duty 2 / id Tech Sound Alias Selector
	Probabilistic sound selection with reservoir sampling, repeat suppression,
	and map loadspec filtering.

===============================================================================
*/


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const LCG_RAND_MULT = 214013;
export const LCG_RAND_ADD  = 2531011;
export const LCG_RAND_MAX  = 32767;


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface sound_choice_t {
	probability: number;
	lastPlayed?: number;
	loadspec?: string | null;
}

export interface sound_random_t {
	seed: number;
}


// ---------------------------------------------------------------------------
// random number generation
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Sound_Random
 *
 * Classic MSVC linear congruential generator (LCG) used inside native alias selector at 0x42e660.
 * ================
 */
function Sound_Random( state: sound_random_t ): number {
	state.seed = ( Math.imul( state.seed, LCG_RAND_MULT ) + LCG_RAND_ADD ) >>> 0;
	return ( state.seed >>> 16 ) & LCG_RAND_MAX;
}


// ---------------------------------------------------------------------------
// sound selection & filtering
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Sound_Select
 *
 * Weighted reservoir sampling plus most-recent exclusion for alias candidate lists longer than two.
 * Reconstructed from native routine 0x42e660..0x42e77a.
 * Tracks selection history on individual sound choice objects.
 * ================
 */
export function Sound_Select<T extends sound_choice_t>(
	choices: T[],
	random: sound_random_t
): T | undefined {
	if ( !choices.length ) {
		return undefined;
	}

	let selected = choices[0];
	let total = Math.fround( selected.probability );
	let latest = selected.lastPlayed ?? 0;

	for ( let i = 1; i < choices.length; i++ ) {
		const c = choices[i];
		total += Math.fround( c.probability );

		if ( Math.fround( c.probability ) * 32768 > Sound_Random( random ) * total ) {
			selected = c;
		}

		latest = Math.max( latest, c.lastPlayed ?? 0 );
	}

	if ( choices.length > 2 && ( selected.lastPlayed ?? 0 ) === latest ) {
		total = 0;

		for ( const c of choices ) {
			if ( ( c.lastPlayed ?? 0 ) === latest ) {
				continue;
			}

			total += Math.fround( c.probability );

			if ( Math.fround( c.probability ) * 32768 > Sound_Random( random ) * total ) {
				selected = c;
			}
		}
	}

	selected.lastPlayed = latest + 1;
	return selected;
}

/**
 * @exec helper
 * ================
 * Sound_Loadspec
 *
 * Evaluates sound-table loadspec conditions for map-specific alias rows.
 * Supports positive matches ('all_mp', 'all_sp', exact map name) and exclusions ('!mp_toujane').
 * ================
 */
export function Sound_Loadspec(
	spec: string | null | undefined,
	map: string
): boolean {
	if ( !spec?.trim() ) {
		return true;
	}

	const terms = spec.toLowerCase().split( /\s+/ );
	const name = map.toLowerCase();

	const matches = ( term: string ): boolean => {
		return term === name ||
			( term === 'all_mp' && name.startsWith( 'mp_' ) ) ||
			( term === 'all_sp' && !name.startsWith( 'mp_' ) );
	};

	if ( terms.some( ( t ) => t.startsWith( '!' ) && matches( t.slice( 1 ) ) ) ) {
		return false;
	}

	const included = terms.filter( ( t ) => !t.startsWith( '!' ) );

	return !included.length || included.some( matches );
}
