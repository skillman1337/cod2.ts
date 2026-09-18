/*
===============================================================================

	menu_def.ts

	CoD2 ui/menudefinition.h types and ui_mp/main.menu layout constants.
	Private menu definition contract for menus.ts.

===============================================================================
*/

export { UI_MenuString } from './menu_strings.js';

/** ui/menudefinition.h */
export const ITEM_TYPE_TEXT = 0;
export const ITEM_TYPE_BUTTON = 1;

export const ITEM_TEXTSTYLE_SHADOWED = 3;

export const WINDOW_STYLE_EMPTY = 0;
export const WINDOW_STYLE_FILLED = 1;
export const WINDOW_STYLE_SHADER = 3;

export {
	UI_HORZ_ALIGN_SUBLEFT,
	UI_HORZ_ALIGN_FULLSCREEN,
	UI_VERT_ALIGN_SUBTOP,
	UI_VERT_ALIGN_FULLSCREEN,
} from '@/engine/common/ui_layout.js';

/** ui/menudef.h */
export const GLOBAL_HEADER_SIZE = 0.5;
export const GLOBAL_FOCUSED_COLOR: [number, number, number, number] = [
	0.98, 0.827, 0.58, 1,
];

/** ui_mp/main.menu */
export const MAIN_RECT_X = 385;
export const MAIN_RECT_WIDTH = 210;
export const MAIN_RECT_HEIGHT = 20;
export const MAIN_TEXTSCALE = 0.4;
export const MAIN_TEXTALIGN = 0;
export const MAIN_TEXTALIGN_X = 0;
export const MAIN_TEXTALIGN_Y = 20;
export const MAIN_FORECOLOR: [number, number, number, number] = [ 0.9, 0.9, 0.9, 0.9 ];

/** ui/menudef.h — options submenu left panel (options_look.menu et al.) */
export const OPTIONS_WINDOW_X = 0;
export const OPTIONS_WINDOW_Y = 0;
export const OPTIONS_WINDOW_W = 370;
export const OPTIONS_WINDOW_H = 480;
export const OPTIONS_HEADER_X = 48;
export const OPTIONS_HEADER_Y = 64;
export const OPTIONS_HEADER_SIZE = 0.5;
export const OPTIONS_HEADER_ALIGN_X = 0;
export const OPTIONS_HEADER_ALIGN_Y = 20;

/** ui/menudef.h — options control rows (origin + rect offsets in .menu files) */
export const OPTIONS_ITEM_X = 50;
export const OPTIONS_ITEM_Y = 120;
export const OPTIONS_CONTROL_TEXTSCALE = 0.25;
export const OPTIONS_ITEM_ALIGN_X = 0;
export const OPTIONS_ITEM_ALIGN_Y = 11;
export const OPTIONS_ITEM_LABEL_W = 200;
export const OPTIONS_ITEM_ROW_H = 13;
export const OPTIONS_BIND_ALIGN_X = 170;
export const OPTIONS_BIND_W = 320;
export const OPTIONS_BIND_H = 13;
export const OPTIONS_CONTROL_FORECOLOR: [number, number, number, number] = [
	0.9, 0.9, 0.9, 1,
];

export const UI_MENU_SHADOW_COLOR: [number, number, number, number] = [ 0.1, 0.1, 0.1, 0.25 ];

export type ui_menu_action_t =
	| { op: 'play'; sound: string }
	| { op: 'close'; menu: string }
	| { op: 'open'; menu: string }
	| { op: 'setdvar'; name: string; value: string }
	| { op: 'exec'; command: string }
	| { op: 'ingameclose'; menu: string }
	| { op: 'uiScript'; name: string; args?: string[] }
	| { op: 'show' | 'hide'; item: string }
	| { op: 'unsupported'; name: string; args: string[] }
	| { op: 'setfocus'; item: string };

export interface ui_menu_dvar_show_t {
	dvar: string;
	show_when: string;
}

export interface ui_menu_item_def_t {
    autowrapped?: boolean;
    wrapped?: boolean;
    enum_list?: string;
    ownerdraw?: number;
    feeder?: number;
    elementheight?: number;
    elementwidth?: number;
    columns?: number[][];
    outlinecolor?: [number,number,number,number];
    noscrollbars?: boolean;
    maxchars?: number;
    maxpaintchars?: number;
	group?: string;
	horz_align?: number;
	vert_align?: number;
	textalign?: number;
	textstyle?: number;
	textfont?: number;
	background?: string;
	backcolor?: [number, number, number, number];
	border?: number;
	bordersize?: number;
	bordercolor?: [number, number, number, number];
	dvar?: string;
	range?: [number, number, number];
	choices?: { label: string; value: string }[];
	conditions?: { kind: 'showdvar' | 'hidedvar' | 'enabledvar' | 'disabledvar'; dvar: string; values: string[] }[];
	name: string;
	text_key?: string;
	type: number;
	style: number;
	rect_x: number;
	rect_y: number;
	rect_w: number;
	rect_h: number;
	textscale: number;
	textalignx: number;
	textaligny: number;
	forecolor: [number, number, number, number];
	visible: boolean;
	decoration?: boolean;
	dvar_show?: ui_menu_dvar_show_t;
	/** Render current ui_menu_runtime dvar value as label (bind/yesno/float columns). */
	dvar_label?: string;
	dvar_label_kind?: 'yesno' | 'float';
	mouse_enter?: ui_menu_action_t[];
    on_focus?: ui_menu_action_t[];
    mouse_exit?: ui_menu_action_t[];
	action?: ui_menu_action_t[];
    accept?: ui_menu_action_t[];
    double_click?: ui_menu_action_t[];
}

export interface ui_menu_def_t {
    blur_world?:number;
	style?: number;
	background?: string;
	backcolor?: [number, number, number, number];
	name: string;
	fullscreen: boolean;
	rect_x: number;
	rect_y: number;
	rect_w: number;
	rect_h: number;
	visible: boolean;
	popup?: boolean;
	focus_color: [number, number, number, number];
	soundloop?: string;
	on_open?: ui_menu_action_t[];
	on_close?: ui_menu_action_t[];
	on_esc?: ui_menu_action_t[];
    exec_keys?:Record<string,ui_menu_action_t[]>;
	items: ui_menu_item_def_t[];
}

export interface ui_menu_asset_global_t {
	console_font: string;
	console_font_size: number;
	font: string;
	font_size: number;
	cursor: string;
	item_focus_sound: string;
	fade_clamp: number;
	fade_cycle: number;
	fade_amount: number;
	shadow_color: [number, number, number, number];
}
