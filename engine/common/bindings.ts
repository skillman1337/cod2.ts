/*
===============================================================================

	bindings.ts

	Call of Duty 2 / id Tech Input Bindings
	Resolves key codes and binds to console commands and player actions.
	Shared by menu settings and live keyboard dispatch.

===============================================================================
*/

import defaults from '@/assets/ui/defaults.json';
import { Cvar_Get, Cvar_Has } from './cvar.js';


// ---------------------------------------------------------------------------
// key binding resolution
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Binding_Keys
 *
 * Returns list of uppercase bound keys for a given console command,
 * falling back to default_mp.cfg values if no live cvar override exists.
 * ================
 */
export function Binding_Keys( command: string ): string[] {
	const value = Cvar_Has( command )
		? Cvar_Get( command )
		: ( defaults as Record<string, string> )[command] ?? '';

	return value.toUpperCase().split( /\s+/ ).filter( Boolean );
}

/**
 * @exec helper
 * ================
 * Binding_Matches
 *
 * Checks if a specific key is currently mapped to the given command.
 * ================
 */
export function Binding_Matches( command: string, key: string ): boolean {
	return Binding_Keys( command ).includes( key.toUpperCase() );
}

/**
 * @exec helper
 * ================
 * Binding_Key
 *
 * Translates browser physical keyboard event codes (e.g. 'KeyW', 'ControlLeft')
 * into canonical retail Call of Duty 2 binding labels ('W', 'CTRL', etc.).
 * ================
 */
export function Binding_Key( code: string ): string {
	if ( code.startsWith( 'Key' ) ) {
		return code.slice( 3 );
	}

	if ( code.startsWith( 'Digit' ) ) {
		return code.slice( 5 );
	}

	const specialKeys: Record<string, string> = {
		ControlLeft: 'CTRL',
		ControlRight: 'CTRL',
		ShiftLeft: 'SHIFT',
		ShiftRight: 'SHIFT',
		AltLeft: 'ALT',
		AltRight: 'ALT',
		Space: 'SPACE',
	};

	return specialKeys[code] ?? code.toUpperCase();
}
