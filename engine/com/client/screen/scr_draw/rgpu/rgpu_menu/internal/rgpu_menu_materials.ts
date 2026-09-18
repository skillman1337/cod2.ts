/*
===============================================================================

	rgpu_menu_materials.ts

	Call of Duty 2 / id Tech Menu Material URL Catalog
	Resolves image asset paths from the player's local installation material catalog.

===============================================================================
*/

import materials from '@/assets/ui/materials.json';


// ---------------------------------------------------------------------------
// menu material catalog
// ---------------------------------------------------------------------------

export const MENU_MATERIAL_URLS: Record<string, string> = Object.fromEntries(
	Object.entries( materials ).map( ( [name, record] ) => {
		const imagePath = ( record.image ?? '' ).replace( /#/g, '%23' );
		return [name, `/assets/images/${imagePath}`];
	} )
);
