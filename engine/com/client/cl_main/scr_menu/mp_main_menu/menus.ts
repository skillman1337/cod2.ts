/*
===============================================================================

	menus.ts

	Call of Duty 2 / id Tech Multiplayer Main Menu Definitions
	Exports global menu asset configuration and compiled retail menus.

===============================================================================
*/

import retailMenus from '@/assets/ui/menus.json';
import { UI_MENU_SHADOW_COLOR, type ui_menu_asset_global_t, type ui_menu_def_t } from './internal/menu_def.js';

export {
	GLOBAL_FOCUSED_COLOR,
	ITEM_TYPE_BUTTON,
	UI_MenuString,
	type ui_menu_action_t,
	type ui_menu_def_t,
	type ui_menu_item_def_t,
} from './internal/menu_def.js';


// ---------------------------------------------------------------------------
// global menu asset configuration
// ---------------------------------------------------------------------------

export const UI_MAIN_MENU_ASSET_GLOBAL: ui_menu_asset_global_t = {
	console_font: 'fonts/consoleFont',
	console_font_size: 18,
	font: 'fonts/normalFont',
	font_size: 16,
	cursor: 'ui/assets/3_cursor3',
	item_focus_sound: 'sound/misc/menu2.wav',
	fade_clamp: 1.0,
	fade_cycle: 1,
	fade_amount: 0.1,
	shadow_color: UI_MENU_SHADOW_COLOR,
};


// ---------------------------------------------------------------------------
// menu collections
// ---------------------------------------------------------------------------

/** Extracted retail pool, including background shaders and every shipped options panel. */
export const UI_MP_MENUS = retailMenus as unknown as readonly ui_menu_def_t[];
export const UI_MAIN_MENU_MENUS = UI_MP_MENUS;
