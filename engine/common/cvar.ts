/*
===============================================================================

	cvar.ts

	Call of Duty 2 / id Tech Console Variable Registry
	Dvar storage, type validation, choices domains, developer mode tracking,
	and default fallbacks.

===============================================================================
*/

import retailDvars from '@/assets/ui/dvars.json';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const CVAR_INT32_MIN   = -2147483648;
export const CVAR_INT32_MAX   = 2147483647;
export const CVAR_FLOAT32_MAX = Math.fround( 3.4028234663852886e38 );


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

interface cvar_description_t {
	name: string;
	kind: string;
	default?: string;
	choices?: string[];
	min?: number;
	max?: number;
}


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

let com_developer = 0;

const nativeDefaults = new Map<string, string>(
	retailDvars.dvars
		.filter( ( dvar ) => 'default' in dvar )
		.map( ( dvar ) => [dvar.name.toLowerCase(), String( dvar.default )] )
);

const descriptions = new Map<string, cvar_description_t>(
	retailDvars.dvars.map( ( d ) => [d.name.toLowerCase(), d] )
);

const values = new Map<string, string>();
const enums = new Map<string, readonly string[]>();
const defaults = new Map<string, string>();

const nativeFlags = new Map<string, number>(
	retailDvars.dvars
		.filter( ( d ) => 'flags' in d )
		.map( ( d ) => [d.name.toLowerCase(), d.flags!] )
);


// ---------------------------------------------------------------------------
// cvar query & inspection
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Cvar_Description
 *
 * Console inspection consumes registration metadata to format variable domain help strings.
 * ================
 */
export function Cvar_Description( name: string ): { defaultValue: string; domain: string[] } | undefined {
	const d = descriptions.get( name.toLowerCase() );

	if ( !d && !Cvar_Has( name ) ) {
		return;
	}

	const choices = enums.get( name.toLowerCase() ) ?? d?.choices;
	let domain: string[] = [];

	if ( choices ) {
		domain = [
			'Domain is one of the following:',
			...choices.map( ( s, i ) => '  ' + String( i ).padStart( 2, ' ' ) + ': ' + s ),
		];
	} else if ( d?.kind === 'bool' ) {
		domain = ['Domain is 0 or 1'];
	} else if ( d?.kind === 'color' ) {
		domain = ['Domain is any 4-component color, in RGBA format'];
	} else if ( d && ['int', 'float', 'vec2', 'vec3', 'vec4'].includes( d.kind ) ) {
		const integer = d.kind === 'int';
		const vector = d.kind.startsWith( 'vec' );
		const limit = integer ? CVAR_INT32_MAX : CVAR_FLOAT32_MAX;
		const min = d.min;
		const max = d.max;
		const low = min !== undefined && min > ( integer ? CVAR_INT32_MIN : -limit );
		const high = max !== undefined && max < limit;
		const format = ( n: number ) => String( Number( n.toPrecision( 6 ) ) );
		const base = vector
			? 'Domain is any ' + d.kind.slice( 3 ) + 'D vector'
			: 'Domain is any ' + ( integer ? 'integer' : 'number' );

		const range = low && high
			? ' from ' + format( min! ) + ' to ' + format( max! )
			: low
				? ' ' + format( min! ) + ' or bigger'
				: high
					? ' ' + format( max! ) + ' or smaller'
					: '';

		domain = [base + ( range && vector ? ' with components' : '' ) + range];
	} else {
		domain = ['Domain is any text'];
	}

	return {
		defaultValue: defaults.get( name.toLowerCase() ) ?? d?.default ?? '',
		domain,
	};
}

/**
 * @exec helper
 * ================
 * Cvar_ArchiveFlag
 *
 * Checks if a dvar has the archive flag set (flag & 1), tested by retail config writer at 0x43a3b5.
 * ================
 */
export function Cvar_ArchiveFlag( name: string ): boolean | undefined {
	const flags = nativeFlags.get( name.toLowerCase() );

	if ( flags === undefined ) {
		return undefined;
	}

	return ( flags & 1 ) !== 0;
}

/**
 * @exec helper
 * ================
 * Cvar_Get
 *
 * Returns current string value of a cvar, falling back to retail default tables.
 * ================
 */
export function Cvar_Get( name: string ): string {
	if ( !name || typeof name !== 'string' ) {
		return '';
	}

	return values.get( name.toLowerCase() ) ?? nativeDefaults.get( name.toLowerCase() ) ?? '';
}

/**
 * @exec helper
 * ================
 * Cvar_Has
 *
 * Tests whether a cvar is registered or recognized in default dvar tables.
 * ================
 */
export function Cvar_Has( name: string ): boolean {
	if ( !name || typeof name !== 'string' ) {
		return false;
	}

	return values.has( name.toLowerCase() ) || nativeDefaults.has( name.toLowerCase() );
}

/**
 * @exec helper
 * ================
 * Cvar_Register
 *
 * Registers a new console variable, recording its default value and optional enum choices.
 * ================
 */
export function Cvar_Register( name: string, value: string, choices?: readonly string[] ): void {
	if ( !name || typeof name !== 'string' ) {
		return;
	}

	const lower = name.toLowerCase();

	if ( !defaults.has( lower ) ) {
		defaults.set( lower, value );
	}

	if ( !values.has( lower ) ) {
		Cvar_Set( name, value );
	}

	if ( choices ) {
		enums.set( lower, choices );
	}
}

/**
 * @exec helper
 * ================
 * Cvar_Snapshot
 *
 * Returns dictionary snapshot of all current cvar values merged over native defaults.
 * ================
 */
export function Cvar_Snapshot(): Record<string, string> {
	return Object.fromEntries( [...nativeDefaults, ...values] );
}

/**
 * @exec helper
 * ================
 * Cvar_ResetRenderer
 *
 * Restores all renderer-specific cvars (starting with 'r_' or 'sc_enable') to their default values.
 * ================
 */
export function Cvar_ResetRenderer(): void {
	for ( const [name, value] of defaults ) {
		if ( name.startsWith( 'r_' ) || name === 'sc_enable' ) {
			Cvar_Set( name, value );
		}
	}
}

/**
 * @exec helper
 * ================
 * Cvar_Choices
 *
 * Returns list of allowed string choices for an enumerated cvar.
 * ================
 */
export function Cvar_Choices( name: string ): readonly string[] {
	if ( !name || typeof name !== 'string' ) {
		return [];
	}

	return enums.get( name.toLowerCase() ) ?? [];
}

/**
 * @exec helper
 * ================
 * Cvar_EnumIndex
 *
 * Native enum string or numeric-index lookup (0x53d1e0).
 * ================
 */
export function Cvar_EnumIndex( value: string, choices: readonly string[] ): number {
	const numeric = parseInt( value, 10 ) || 0;

	if ( numeric >= 0 && numeric < choices.length ) {
		return numeric;
	}

	const target = ( value ?? '' ).toLowerCase();
	return Math.max( 0, choices.findIndex( ( c ) => ( c ?? '' ).toLowerCase() === target ) );
}


// ---------------------------------------------------------------------------
// cvar mutation & developer mode
// ---------------------------------------------------------------------------

/**
 * @exec per-frame
 * ================
 * Cvar_IsDeveloper
 *
 * True when name matches the developer cvar.
 * ================
 */
function Cvar_IsDeveloper( name: string ): boolean {
	return name === 'developer';
}

/**
 * @exec per-frame
 * ================
 * Cvar_ParseDeveloper
 *
 * Parses developer cvar string value to integer flag.
 * ================
 */
function Cvar_ParseDeveloper( value: string ): number {
	if ( value === '1' ) {
		return 1;
	}

	return 0;
}

/**
 * @exec per-frame
 * ================
 * Cvar_SetDeveloper
 *
 * Updates com_developer global state from value string.
 * ================
 */
function Cvar_SetDeveloper( value: string ): void {
	com_developer = Cvar_ParseDeveloper( value );
}

/**
 * @exec per-frame
 * ================
 * Cvar_Set
 *
 * Updates cvar value in the registry, triggering specialized handlers (e.g. developer mode).
 * ================
 */
export function Cvar_Set( name: string, value: string ): void {
	if ( !name || typeof name !== 'string' ) {
		return;
	}

	values.set( name.toLowerCase(), value );

	if ( !Cvar_IsDeveloper( name ) ) {
		return;
	}

	Cvar_SetDeveloper( value );
}

/**
 * ================
 * Cvar_GetDeveloper
 *
 * Returns current developer mode state.
 * ================
 */
export function Cvar_GetDeveloper(): number {
	return com_developer;
}
