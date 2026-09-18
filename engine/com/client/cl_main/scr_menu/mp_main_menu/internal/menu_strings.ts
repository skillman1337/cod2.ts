/*
===============================================================================

	menu_strings.ts

	Call of Duty 2 / id Tech Localized String Lookup
	Resolves localized menu string tokens from retail strings dictionary.

===============================================================================
*/

import retailStrings from '@/assets/ui/strings.json';


// ---------------------------------------------------------------------------
// string lookup
// ---------------------------------------------------------------------------

/*
====================
UI_MenuString

Resolves localized text string for a given localization key token.
Strips leading '@' prefix if present.
====================
*/
export function UI_MenuString( key: string ): string {
	const strings: Record<string, string> = retailStrings;

	return strings[key.replace( /^@/, '' )] ?? key;
}
