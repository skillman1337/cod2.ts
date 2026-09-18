/*
===============================================================================

	ui_menu_runtime.ts

	CoD2 menu script interpreter subset for ui_mp/main.menu.
	Parent is scr_menu.ts.

===============================================================================
*/

import { Weapon_Definition } from '@/engine/common/weapon.js';
import { Con_Printf } from '@/engine/common/common.js';
import { Level_Phase,Level_Name,Level_Data,Level_Progress,Level_Reset,Level_Continue,Level_ChooseTeam,Level_ChooseWeapon,Level_ChangeSelection,type level_phase_t } from '@/engine/common/level.js';
import { Command_Register, Command_Dispatch, Command_Lines, Command_Tokens } from '@/engine/common/commands.js';
import { rgpu_menu_item_t, rgpu_menu_overlay_t } from '@/engine/common/types.js';
import { UI_TextWidth } from '@/engine/common/ui_text.js';
import { UI_ListScroll, UI_SliderFraction } from '@/engine/common/ui_controls.js';
import { vid } from '@/engine/common/vid.js';
import { Cvar_Get, Cvar_Set, Cvar_Register, Cvar_Choices, Cvar_EnumIndex, Cvar_Snapshot, Cvar_ResetRenderer,Cvar_ArchiveFlag } from '@/engine/common/cvar.js';
import providers from '@/assets/ui/providers.json';
import configs from '@/assets/ui/configs.json';
import retailDefaults from '@/assets/ui/defaults.json';

import {
	GLOBAL_FOCUSED_COLOR,
	ITEM_TYPE_BUTTON,
	UI_MP_MENUS,
	UI_MenuString,
	type ui_menu_action_t,
	type ui_menu_def_t,
	type ui_menu_item_def_t,
} from './mp_main_menu/menus.js';


interface ui_menu_hit_t {
	menu_name: string;
	item_index: number;
	overlay_index: number;
}


interface ui_menu_draw_entry_t {
	menu_name: string;
	item_index: number;
	item: ui_menu_item_def_t;
}


const ui_menu_registry = new Map<string, ui_menu_def_t>();
const ui_menu_stack: string[] = [];
const ui_menu_dvars: Record<string, string> = {
	...retailDefaults,
	cl_ingame: '0',
	cl_updateavailable: '0',
	com_playerProfile: 'Player',
	ui_multiplayer: '1',
	shortversion: '1.2',
	snd_volume: '0.8',
	snd_khz: '44',
	mss_3d_provider: 'Miles Fast 2D Positional Audio',
	cl_voice: '1',
	winvoice_mic_reclevel: '1',
	ui_playerProfileCount: '1',
	ui_playerProfileAlreadyChosen: '0',
	ui_background: 'background_american_w',
	ui_logo_show: '1',
	ui_version_show: '1',
	ui_separator_show: '1',
	ui_background_gradient_show: '0',
	ui_mousePitch: '0',
	'+lookup': 'MOUSE',
	'+lookdown': 'MOUSE',
	'+mlook': 'MOUSE',
	centerview: 'END',
	cl_freelook: '1',
	m_filter: '0',
	sensitivity: '5',
};

for ( const [name, value] of Object.entries( ui_menu_dvars ) ) {
	Cvar_Register( name, value );
}

// Browser renderer modes are capability data, separate from archived UI definitions.
Cvar_Register( 'r_mode', '1280x720', [
	'640x480',
	'800x600',
	'1024x768',
	'1280x720',
	'1280x1024',
	'1600x900',
	'1920x1080',
] );
Cvar_Register( 'r_displayRefresh', '60 Hz', ['60 Hz'] );

for ( const [name, value] of Object.entries( {
	r_picmip: '0',
	r_picmip_bump: '0',
	r_picmip_spec: '0',
	r_texturemode: 'trilinear',
	r_texturebits: '32',
	r_aspectratio: 'auto',
	r_rendererpreference: 'dx9',
	r_picmip_manual: '0',
	r_swapinterval: '1',
	r_aasamples: '1',
	sc_enable: '1',
	r_lodscale: '1',
	r_zfeather: '0',
	r_depthPrepassModels: '0',
	ui_netGametype: '0',
	ui_currentNetMap: '0',
} ) ) {
	Cvar_Register( name, value );
}

const ui_menu_list_start = new WeakMap<ui_menu_item_def_t, number>();

// 0x536080 matches the server's token to the UI provider index.
Cvar_Set(
	'ui_netGametype',
	String(
		Math.max(
			0,
			providers.gametypes.findIndex(
				( type ) =>
					type.value ===
					( providers.gametypes.some( ( t ) => t.value === Cvar_Get( 'g_gametype' ) )
						? Cvar_Get( 'g_gametype' )
						: 'dm' )
			)
		)
	)
);
Cvar_Register( 'ui_netSource', '1', ['EXE_LOCAL', 'EXE_INTERNET', 'EXE_FAVORITES'] );
Cvar_Register( 'ui_joinGametype', '0' );

// Registered defaults from the server initializer and renderer capability state.
for ( const [name, value] of Object.entries( {
	sv_hostname: 'CoD2Host',
	sv_maxclients: '20',
	sv_minping: '0',
	sv_maxping: '0',
	sv_maxrate: '0',
	sv_pure: '1',
	sv_voice: '0',
	g_allowvote: '1',
	r_ignorehwgamma: '0',
	r_gamma: '1.3',
} ) ) {
	Cvar_Register( name, value );
}

/**
 * @exec helper
 * ================
 * UIMenu_GameType
 *
 * Resolves active multiplayer gametype provider descriptor.
 * ================
 */
function UIMenu_GameType(): typeof providers.gametypes[number] {
	return (
		providers.gametypes[Number( UIMenu_GetDvar( 'ui_netGametype' ) )] ?? providers.gametypes[0]
	);
}

/**
 * @exec helper
 * ================
 * UIMenu_Maps
 *
 * Filters level maps supported by the currently active gametype.
 * ================
 */
function UIMenu_Maps(): typeof providers.maps {
	return providers.maps.filter( ( m ) =>
		!m.gametype.trim() || m.gametype.split( /\s+/ ).includes( UIMenu_GameType()?.value ?? '' )
	);
}

let ui_menu_mp_active = false;
let ui_menu_initialized = false;
let ui_menu_focus: ui_menu_hit_t | null = null;
let ui_menu_draw_list: ui_menu_draw_entry_t[] = [];
let ui_menu_play_sound: ( ( sound: string ) => void ) | null = null;
let ui_menu_action_depth = 0;
let ui_menu_action_menu = '';
let ui_menu_edit: ui_menu_item_def_t | null = null;
let ui_menu_drag: ui_menu_hit_t | null = null;
let ui_menu_scroll_drag: {hit:ui_menu_hit_t;offset:number} | null = null;
let ui_menu_action_item: ui_menu_item_def_t | null = null;
let ui_profile_selected = 0;
let ui_profiles: { name: string; values: Record<string,string> }[] = [{name:'Player',values:{}}];
/** Persist controls and archived settings, never snapshots of live session state. @exec helper */
function UIMenu_ProfileValues( values: Record<string, string> ): Record<string, string> {
	const controls = new Set(
		UI_MP_MENUS.flatMap( ( menu ) =>
			menu.items
				.filter( ( item ) => item.dvar && [4, 9, 10, 11, 12, 13, 14, 16, 17, 18].includes( item.type ) )
				.map( ( item ) => item.dvar!.toLowerCase() )
		)
	);

	return Object.fromEntries(
		Object.entries( values ).filter( ( [name] ) => {
			const key = name.toLowerCase();

			if ( key.startsWith( 'ui_' ) || key === 'com_playerprofile' ) {
				return false;
			}

			return Cvar_ArchiveFlag( key ) ?? controls.has( key );
		} )
	);
}
try {
    const saved = typeof localStorage !== 'undefined' ? JSON.parse( localStorage.getItem( 'cod2.profiles' ) || 'null' ) : null;
    if ( Array.isArray( saved?.profiles ) && saved.profiles.every( ( p: { name?: unknown; values?: unknown } ) => typeof p.name === 'string' && p.values && typeof p.values === 'object' ) ) {
        ui_profiles = saved.profiles.map((profile:{name:string;values:Record<string,string>})=>({...profile,values:UIMenu_ProfileValues(profile.values)}));
        ui_profile_selected = Math.max( 0, ui_profiles.findIndex( p => p.name === saved.active ) );
        for ( const [name,value] of Object.entries( ui_profiles[ui_profile_selected]?.values ?? {} ) ) Cvar_Set( name, value );
        Cvar_Set( 'com_playerProfile', ui_profiles[ui_profile_selected]?.name ?? '' );
    }
} catch { /* Storage is optional in private/embedded browser contexts. */ }

/**
 * @exec helper
 * ================
 * UIMenu_ProfileSave
 *
 * Serializes profiles and active profile selection to local browser storage.
 * ================
 */
function UIMenu_ProfileSave(): void {
	try {
		if ( typeof localStorage !== 'undefined' ) {
			localStorage.setItem(
				'cod2.profiles',
				JSON.stringify( {
					profiles: ui_profiles,
					active: UIMenu_GetDvar( 'com_playerProfile' ),
				} )
			);
		}
	} catch {
		Con_Printf( 'Profile storage is unavailable\n' );
	}
}

/**
 * @exec helper
 * ================
 * UIMenu_SaveActiveProfile
 *
 * Updates profile state from cvar snapshot and persists to storage.
 * ================
 */
export function UIMenu_SaveActiveProfile(): void {
	const active = ui_profiles.find(
		( profile ) => profile.name === UIMenu_GetDvar( 'com_playerProfile' )
	);

	if ( active ) {
		active.values = UIMenu_ProfileValues( Cvar_Snapshot() );
	}

	UIMenu_ProfileSave();
}

/**
 * @exec helper
 * ================
 * UIMenu_ProfileRefresh
 *
 * Refreshes profile counts and listbox scroll states across menus.
 * ================
 */
function UIMenu_ProfileRefresh(): void {
	UIMenu_SetDvar( 'ui_playerProfileCount', String( ui_profiles.length ) );
	UIMenu_SetDvar( 'ui_playerProfileSelected', ui_profiles[ui_profile_selected]?.name ?? '' );

	for ( const menu of UI_MP_MENUS ) {
		for ( const item of menu.items ) {
			if ( item.feeder === 24 ) {
				const scroll = UI_ListScroll(
					item.rect_h,
					item.elementheight || 20,
					ui_profiles.length,
					ui_menu_list_start.get( item ) || 0
				);
				const start =
					ui_profile_selected < scroll.start
						? ui_profile_selected
						: ui_profile_selected >= scroll.start + scroll.page
							? ui_profile_selected - scroll.page + 1
							: scroll.start;

				ui_menu_list_start.set( item, Math.max( 0, Math.min( scroll.max, start ) ) );
			}
		}
	}
}


/**
 * @exec helper
 * ================
 * UIMenu_HitEqual
 * ================
 */
function UIMenu_HitEqual( a: ui_menu_hit_t | null, b: ui_menu_hit_t | null ): boolean {
	if ( a === b )
		return true;

	if ( !a || !b )
		return false;

	return a.menu_name === b.menu_name && a.item_index === b.item_index;
}


/**
 * @exec helper
 * ================
 * UIMenu_OnFocusEnter
 * ================
 */
function UIMenu_OnFocusEnter( hit: ui_menu_hit_t ): void {
	let menu: ui_menu_def_t | null;
	let item: ui_menu_item_def_t | undefined;

	menu = UIMenu_FindMenu( hit.menu_name );
	if ( !menu )
		return;

	item = menu.items[hit.item_index];
	if ( !item || !UIMenu_ItemClickable( item ) )
		return;

	UIMenu_RunActions( item.mouse_enter, hit.menu_name );
	UIMenu_RunActions( item.on_focus, hit.menu_name );
}


{
	let i: number;
	let menu: ui_menu_def_t;

	for ( i = 0; i < UI_MP_MENUS.length; i++ ) {
		menu = UI_MP_MENUS[i];
		ui_menu_registry.set( menu.name, menu );
	}
}


/**
 * @exec helper
 * ================
 * UIMenu_GetDvar
 * ================
 */
function UIMenu_GetDvar( name: string ): string {
	return Cvar_Get( name );
}


/**
 * @exec helper
 * ================
 * UIMenu_SetDvar
 * ================
 */
function UIMenu_SetDvar( name: string, value: string ): void {
    if ( !name ) return;
	Cvar_Set( name, value );
}


/**
 * @exec helper
 * ================
 * UIMenu_IsOpen
 * ================
 */
function UIMenu_IsOpen( name: string ): boolean {
	return ui_menu_stack.includes( name );
}


/**
 * @exec helper
 * ================
 * UIMenu_FindMenu
 * ================
 */
function UIMenu_FindMenu( name: string ): ui_menu_def_t | null {
	return ui_menu_registry.get( name ) ?? null;
}


/**
 * @exec helper
 * ================
 * UIMenu_ItemVisible
 * ================
 */
function UIMenu_ItemVisible( item: ui_menu_item_def_t ): boolean {
	if ( !item.visible )
		return false;

	if ( item.dvar_show && UIMenu_GetDvar( item.dvar_show.dvar ) !== item.dvar_show.show_when )
		return false;
	for ( const condition of item.conditions ?? [] ) {
		const match = condition.values.includes( UIMenu_GetDvar( condition.dvar ) );
		if ( condition.kind === 'showdvar' && !match || condition.kind === 'hidedvar' && match ) return false;
	}

	return true;
}


/**
 * @exec helper
 * ================
 * UIMenu_ItemClickable
 * ================
 */
function UIMenu_ItemClickable( item: ui_menu_item_def_t ): boolean {
	for ( const c of item.conditions ?? [] ) {
		const match = c.values.includes( UIMenu_GetDvar( c.dvar ) );
		if ( c.kind === 'enabledvar' && !match || c.kind === 'disabledvar' && match ) return false;
	}
	return (
		( item.type === ITEM_TYPE_BUTTON || [4,6,8,9,10,11,12,13,14,16,17,18].includes( item.type ) ) &&
		!item.decoration &&
		( item.action !== undefined || item.dvar !== undefined || item.feeder !== undefined || item.ownerdraw === 245 ) &&
		UIMenu_ItemVisible( item )
	);
}


/**
 * @exec helper
 * ================
 * UIMenu_ItemHasText
 * ================
 */
function UIMenu_ItemHasText( item: ui_menu_item_def_t ): boolean {
	if ( !UIMenu_ItemVisible( item ) )
		return false;

	return true;
}


/**
 * @exec helper
 * ================
 * UIMenu_FormatDvarLabel
 * ================
 */
function UIMenu_FormatDvarLabel( dvar: string, kind: ui_menu_item_def_t['dvar_label_kind'] ): string {
	let value: string;

	value = UIMenu_GetDvar( dvar );
	if ( kind === 'yesno' )
		return value === '1' ? UI_MenuString( 'MENU_YES' ) : UI_MenuString( 'MENU_NO' );

	if ( kind === 'float' )
		return value !== '' ? value : '5';

	return value !== '' ? value : '---';
}


/**
 * @exec helper
 * ================
 * UIMenu_ItemLabel
 * ================
 */
function UIMenu_ItemLabel( item: ui_menu_item_def_t ): string {
    const owner = item.ownerdraw === undefined ? undefined : ui_owner_labels.get( item.ownerdraw );
    if ( owner ) return owner();
	if ( item.dvar_label )
		return UIMenu_FormatDvarLabel( item.dvar_label, item.dvar_label_kind );

	if ( item.text_key )
		return UI_MenuString( item.text_key );
	if ( item.dvar && item.style !== 6 && item.type < 4 ) return UIMenu_GetDvar( item.dvar );

	return '';
}

/** Retail translated strings substitute numbered arguments after localization. @exec helper */
function UIMenu_Localized( key: string, ...args: string[] ): string {
    return UI_MenuString( key ).replace( /&&([1-9])/g, ( token, index ) => args[Number(index)-1] ?? token );
}

// UI_OwnerDraw dispatch table at 0x533978/0x5339bc supplies engine-owned data.
const ui_owner_labels = new Map<number, () => string>( [
    [220, () => UIMenu_Localized( 'EXE_NETSOURCE', UI_MenuString( Cvar_Choices('ui_netSource')[Number(UIMenu_GetDvar('ui_netSource'))] ?? 'EXE_LOCAL' ) )],
    [245, () => UI_MenuString( UIMenu_GameType().label )],
    [247, () => UIMenu_Localized( 'EXE_REFRESHTIME', UIMenu_GetDvar( 'ui_lastServerRefresh_' + UIMenu_GetDvar('ui_netSource') ) )],
    [250, () => UI_MenuString( ui_menu_edit?.type === 14 ? 'EXE_KEYWAIT' : 'EXE_KEYCHANGE' )],
    [253, () => UI_MenuString( providers.gametypes[Number(UIMenu_GetDvar('ui_joinGametype'))-1]?.label ?? 'EXE_ALL' )],
] );


/**
 * @exec helper
 * ================
 * UIMenu_ToGpuItem
 * ================
 */
function UIMenu_ToGpuItem( item: ui_menu_item_def_t ): rgpu_menu_item_t {
    const maps = UIMenu_Maps();
    const mapIndex = Math.max( 0, Math.min( maps.length - 1, Number( UIMenu_GetDvar( 'ui_currentNetMap' ) ) || 0 ) );
    const isMapList = item.type === 6 && [1,4].includes( item.feeder ?? -1 );
    return {
		...item,
        full_bleed: !!item.decoration && !item.text_key,
        rows: item.feeder === 24 ? ui_profiles.map( p => p.name ) : isMapList ? maps.map( m => m.longname ) : item.type === 6 ? [] : undefined,
        row_height: item.elementheight, row_start: ui_menu_list_start.get( item ) ?? 0, row_selected: item.feeder === 24 ? ui_profile_selected : mapIndex,
        style: item.ownerdraw === 255 ? 3 : item.style,
        background: item.background === '$levelBriefing' ? 'loadscreen_'+Level_Name() : item.ownerdraw === 255 ? 'loadscreen_' + maps[mapIndex]?.map : item.style === 6 && item.dvar ? UIMenu_GetDvar( item.dvar ) : item.background,
		value_label: UIMenu_ControlValue( item ),
		slider_fraction: item.type === 10 && item.range ? Math.max( 0, Math.min( 1, ( Number( UIMenu_GetDvar( item.dvar! ) ) - item.range[1] ) / ( item.range[2] - item.range[1] ) ) ) : undefined,
		label: UIMenu_ItemLabel( item ),
		rect_x: item.rect_x,
		rect_y: item.rect_y,
		rect_w: item.rect_w,
		rect_h: item.rect_h,
		textscale: item.textscale,
		textalignx: item.textalignx,
		textaligny: item.textaligny,
		forecolor: item.forecolor ?? [1, 1, 1, 1],
		focuscolor: GLOBAL_FOCUSED_COLOR,
	};
}

/** @exec helper */
function UIMenu_ControlValue( item: ui_menu_item_def_t ): string | undefined {
	if ( !item.dvar || item.type < 4 || item.type === 10 ) {
		return undefined;
	}

	const value = UIMenu_GetDvar( item.dvar );

	if ( item.type === 17 && Number.isFinite( Number( value ) ) ) {
		return Number( value ).toFixed( 2 );
	}

	if ( item.enum_list ) {
		const choices = Cvar_Choices( item.enum_list );
		return choices[Cvar_EnumIndex( value, choices )] ?? '';
	}

	if ( item.type === 11 ) {
		return UI_MenuString( Number( value ) ? 'MENU_YES' : 'MENU_NO' );
	}

	if ( item.type === 14 && value ) {
		return value
			.split( ' or ' )
			.map( ( key ) => {
				const label = UI_MenuString( 'KEY_' + key );
				return label === 'KEY_' + key ? key : label;
			} )
			.join( ' or ' );
	}

	if ( item.choices ) {
		return UI_MenuString(
			item.choices.find( ( c ) => c.value === value )?.label ?? item.choices[0]?.label ?? value
		);
	}

	return value || ( item.type === 14 ? UI_MenuString( 'KEY_UNBOUND' ) : '' );
}


/**
 * @exec helper
 * ================
 * UIMenu_RebuildDrawList
 * ================
 */
function UIMenu_RebuildDrawList(): void {
	let stack_idx: number;
	let menu_name: string;
	let menu: ui_menu_def_t | null;
	let i: number;
	let item: ui_menu_item_def_t;

	ui_menu_draw_list = [];

	for ( stack_idx = 0; stack_idx < ui_menu_stack.length; stack_idx++ ) {
		menu_name = ui_menu_stack[stack_idx];
		menu = UIMenu_FindMenu( menu_name );
		if ( !menu || menu_name === 'main' )
			continue;
		if ( menu.style ) ui_menu_draw_list.push( { menu_name, item_index: -1, item: menu as unknown as ui_menu_item_def_t } );

		for ( i = 0; i < menu.items.length; i++ ) {
			item = menu.items[i];
			if ( !UIMenu_ItemHasText( item ) )
				continue;

			ui_menu_draw_list.push( { menu_name, item_index: i, item } );
		}
	}
}


/**
 * @exec helper
 * ================
 * UIMenu_EnsureDrawable
 *
 * If navigation left nothing drawable, reopen main_text (retail always keeps a visible menu).
 * ================
 */
function UIMenu_EnsureDrawable(): void {
	if ( Level_Phase()!=='menu' || !ui_menu_mp_active || ui_menu_draw_list.length > 0 )
		return;

	if ( UIMenu_FindMenu( 'main_text' ) && !UIMenu_IsOpen( 'main_text' ) )
		UIMenu_Open( 'main_text' );
}


/**
 * @exec helper
 * ================
 * UIMenu_Open
 * ================
 */
function UIMenu_Open( name: string ): void {
	let menu: ui_menu_def_t | null;

    // Entering the frontend ends the current local session, including pending loads.
    if(name==='main'&&Level_Phase()!=='menu')Level_Reset();

	menu = UIMenu_FindMenu( name );
	if ( !menu ) {
		Con_Printf( 'menu: open unknown "' + name + '"\n' );
		return;
	}

    // Activation runs onOpen even when the controller menu is already open.
    // Retail main has no items: its onOpen activates bg and main_text.
    const existing = ui_menu_stack.indexOf( name );
    if ( existing >= 0 ) ui_menu_stack.splice( existing, 1 );
	ui_menu_stack.push( name );
	for ( const item of menu.items ) {
		if ( item.dvar && !UIMenu_GetDvar( item.dvar ) ) {
			if ( item.range ) UIMenu_SetDvar( item.dvar, String( item.range[0] ) );
			else if ( item.choices?.length ) UIMenu_SetDvar( item.dvar, item.choices[0].value );
		}
	}
	UIMenu_RunActions( menu.on_open, name );
	UIMenu_RebuildDrawList();
}


/**
 * @exec helper
 * ================
 * UIMenu_Close
 * ================
 */
function UIMenu_Close( name: string ): void {
	let menu: ui_menu_def_t | null;
	let idx: number;

	idx = ui_menu_stack.indexOf( name );
	if ( idx < 0 )
		return;

	menu = UIMenu_FindMenu( name );
	ui_menu_stack.splice( idx, 1 );
    if ( menu?.items.includes( ui_menu_edit! ) ) ui_menu_edit = null;
    if ( ui_menu_focus?.menu_name === name ) ui_menu_focus = null;
    if ( ui_menu_drag?.menu_name === name ) ui_menu_drag = null;
    if ( ui_menu_scroll_drag?.hit.menu_name === name ) ui_menu_scroll_drag = null;

	if ( menu )
		UIMenu_RunActions( menu.on_close, name );

	UIMenu_RebuildDrawList();
}


/**
 * @exec helper
 * ================
 * UIMenu_RunActions
 * ================
 */
function UIMenu_RunActions( actions: ui_menu_action_t[] | undefined, menu_name = ui_menu_action_menu ): void {
	let i: number;
	let action: ui_menu_action_t;

	if ( !actions )
		return;
	if ( ui_menu_action_depth > 32 ) throw new Error( 'Recursive menu script' );
	const previous = ui_menu_action_menu;
	ui_menu_action_menu = menu_name;

	ui_menu_action_depth++;

	for ( i = 0; i < actions.length; i++ ) {
		action = actions[i];
		UIMenu_RunAction( action );
	}

	ui_menu_action_depth--;
	ui_menu_action_menu = previous;
	if ( ui_menu_action_depth === 0 )
		UIMenu_EnsureDrawable();
}


/**
 * @exec helper
 * ================
 * UIMenu_RunAction
 * ================
 */
function UIMenu_RunAction( action: ui_menu_action_t ): void {
	switch ( action.op ) {
	case 'play':
		if ( ui_menu_play_sound )
			ui_menu_play_sound( action.sound );
		else
			Con_Printf( 'menu play: ' + action.sound + '\n' );
		break;
	case 'close':
		UIMenu_Close( action.menu );
		break;
	case 'open':
		UIMenu_Open( action.menu );
		break;
	case 'setdvar': {
        const dvarName = (action as any).name ?? (action as any).dvar;
        if ( dvarName ) {
            UIMenu_SetDvar( dvarName, (action as any).value ?? '' );
        }
		UIMenu_RebuildDrawList();
		break;
    }
	case 'exec':
        if ( (action as any).command ) UIMenu_Exec( (action as any).command );
		break;
	case 'ingameclose':
		Con_Printf( 'menu ingameclose: ' + (action as any).menu + '\n' );
		break;
	case 'uiScript':
    case 'uiscript' as any: {
        const scriptName = (action as any).name ?? (action as any).script;
        if ( scriptName ) {
            UIMenu_UiScript( scriptName, (action as any).args ?? [] );
        }
		break;
    }
	case 'show':
	case 'hide':
		for ( const item of UIMenu_FindMenu( ui_menu_action_menu )?.items ?? [] ) {
			if ( item.name === action.item || item.group === action.item ) {
				item.visible = action.op === 'show';
			}
		}
		UIMenu_RebuildDrawList();
		break;
	case 'unsupported': {
		const actionName = ( ( action as any ).name ?? '' ).toLowerCase();

		if ( actionName === 'scriptmenuresponse' ) {
			const response = action.args?.[0];

			if ( response === 'changeweapon' ) {
				Level_ChangeSelection( 'weapon' );
			}
			if ( response === 'changeteam' ) {
				Level_ChangeSelection( 'team' );
			}
			if ( [ 'muteplayer', 'callvote' ].includes( response ) ) {
				UIMenu_Close( ui_menu_action_menu );
				UIMenu_Open( response );
			}
			if ( [ 'autoassign', 'allies', 'axis', 'spectator' ].includes( response ) ) {
				Level_ChooseTeam( response );
			} else if ( response && Weapon_Definition( response ) ) {
				Level_ChooseWeapon( response );
			}
		}

		if ( actionName === 'setitemcolor' && ( action.args?.length ?? 0 ) >= 6 ) {
			const [ target, property, ...components ] = action.args;

			if ( [ 'backcolor', 'forecolor', 'bordercolor', 'outlinecolor' ].includes( property?.toLowerCase() ) ) {
				const color = components.slice( 0, 4 ).map( Number ) as [number, number, number, number];

				if ( color.every( Number.isFinite ) ) {
					for ( const item of UIMenu_FindMenu( ui_menu_action_menu )?.items ?? [] ) {
						if ( item.name === target || item.group === target ) {
							item[property.toLowerCase() as 'backcolor' | 'forecolor' | 'bordercolor' | 'outlinecolor'] = color;
						}
					}
				}
			}
		}

		if ( [ 'openforgametype', 'closeforgametype' ].includes( actionName ) ) {
			const value = UIMenu_GetDvar( ui_menu_action_item?.dvar ?? 'ui_netGametypeName' );
			const target = action.args?.[0]?.replace( '%s', value );

			if ( target ) {
				if ( actionName === 'openforgametype' ) {
					UIMenu_Open( target );
				} else {
					UIMenu_Close( target );
				}
			}
		} else if ( /^execOnDvar(Int|Float|String)Value$/i.test( ( action as any ).name ?? '' ) && ( action.args?.length ?? 0 ) >= 3 ) {
			if ( UIMenu_GetDvar( action.args[0] ) === action.args[1] ) {
				UIMenu_Exec( action.args[2] );
			}
		}
		break;
	}
	case 'setfocus': {
		const menu = UIMenu_FindMenu( ui_menu_action_menu );
		const index = menu?.items.findIndex( ( i ) => i.name === action.item ) ?? -1;

		if ( menu && index >= 0 ) {
			ui_menu_focus = { menu_name: menu.name, item_index: index, overlay_index: -1 };

			if ( [ 4, 9, 16, 17, 18 ].includes( menu.items[index].type ) ) {
				ui_menu_edit = menu.items[index];
			}
		}
		break;
	}
	}
}

/** @exec helper */
function UIMenu_Exec( command: string ): void {
	if ( command.trim() === 'disconnect' ) {
		Level_Reset();
		return;
	}

	if ( /^exec\s+"?default(?:_mp)?\.cfg"?\s*$/i.test( command.trim() ) ) {
		for ( const menu of UI_MP_MENUS ) {
			for ( const item of menu.items ) {
				if ( item.type === 14 && item.dvar ) {
					UIMenu_SetDvar( item.dvar, '' );
				}
			}
		}

		for ( const [name, value] of Object.entries( retailDefaults ) ) {
			UIMenu_SetDvar( name, value );
		}

		UIMenu_RebuildDrawList();
		return;
	}

	if ( command.trim().toLowerCase() === 'setrecommended' ) {
		Cvar_ResetRenderer();
		UIMenu_Exec( ( configs as Record<string, string> )['ui/options_graphics.cfg'] );
		UIMenu_SetDvar( 'com_recommendedSet', '1' );
		return;
	}

	for ( const part of Command_Lines( command ) ) {
		const words = Command_Tokens( part );

		if ( words[0]?.toLowerCase() === 'setfromdvar' && words.length >= 3 ) {
			UIMenu_SetDvar( words[1], UIMenu_GetDvar( words[2] ) );
		} else if ( words[0]?.toLowerCase() === 'set' && words.length >= 3 ) {
			UIMenu_SetDvar( words[1], words[2] );
		} else if ( words[0]?.toLowerCase() === 'exec' && words[1] in configs ) {
			UIMenu_Exec( ( configs as Record<string, string> )[words[1]] );
		} else if ( Command_Dispatch( words ) ) {
			continue;
		} else if ( words.length ) {
			Con_Printf( 'menu exec unavailable: ' + part + '\n' );
		}
	}

	UIMenu_RebuildDrawList();
}

/** @exec helper */
function UIMenu_UiScript( name: string, args: string[] ): void {
	if ( !name || typeof name !== 'string' ) {
		return;
	}

	const script = name.toLowerCase();

	if ( script === 'quit' ) {
		Command_Dispatch( ['quit'] );
		return;
	}

	if ( script === 'startserver' ) {
		const map = UIMenu_Maps()[Number( UIMenu_GetDvar( 'ui_currentNetMap' ) )];
		if ( map ) {
			Cvar_Set( 'g_gametype', UIMenu_GameType().value );
			Command_Dispatch( ['map', map.map] );
		}
		return;
	}

	if ( ['addplayerprofiles', 'selectactiveplayerprofile', 'sortplayerprofiles'].includes( script ) ) {
		if ( script === 'sortplayerprofiles' ) {
			ui_profiles.sort( ( a, b ) => a.name.localeCompare( b.name ) );
		}
		if ( script === 'selectactiveplayerprofile' ) {
			ui_profile_selected = Math.max(
				0,
				ui_profiles.findIndex( ( p ) => p.name === UIMenu_GetDvar( 'com_playerProfile' ) )
			);
		}
		UIMenu_ProfileRefresh();
		return;
	}

	if ( script === 'createplayerprofile' ) {
		const profile = UIMenu_GetDvar( 'ui_playerProfileNameNew' ).trim();
		if ( !profile || /[\\/:*?"<>|]/.test( profile ) ) {
			UIMenu_Open( 'profile_create_fail_popmenu' );
			return;
		}
		if ( ui_profiles.some( ( p ) => p.name.toLowerCase() === profile.toLowerCase() ) ) {
			UIMenu_Open( 'profile_exists_popmenu' );
			return;
		}
		ui_profiles.push( { name: profile, values: { ...retailDefaults } } );
		ui_profile_selected = ui_profiles.length - 1;
		UIMenu_SetDvar( 'ui_playerProfileNameNew', '' );
		UIMenu_ProfileRefresh();
		UIMenu_ProfileSave();
		return;
	}

	if ( script === 'loadplayerprofile' ) {
		const old = ui_profiles.find( ( p ) => p.name === UIMenu_GetDvar( 'com_playerProfile' ) );
		if ( old ) {
			old.values = UIMenu_ProfileValues( Cvar_Snapshot() );
		}
		const profile = ui_profiles[ui_profile_selected];
		if ( profile ) {
			for ( const [key, value] of Object.entries( profile.values ) ) {
				UIMenu_SetDvar( key, value );
			}
			UIMenu_SetDvar( 'com_playerProfile', profile.name );
		}
		UIMenu_ProfileSave();
		UIMenu_ProfileRefresh();
		return;
	}

	if ( script === 'deleteplayerprofile' ) {
		const removed = ui_profiles.splice( ui_profile_selected, 1 )[0];
		if ( removed?.name === UIMenu_GetDvar( 'com_playerProfile' ) ) {
			UIMenu_SetDvar( 'com_playerProfile', '' );
		}
		ui_profile_selected = Math.max( 0, Math.min( ui_profile_selected, ui_profiles.length - 1 ) );
		UIMenu_ProfileSave();
		UIMenu_ProfileRefresh();
		return;
	}

	if ( script === 'loadarenas' ) {
		UIMenu_SetDvar( 'ui_netGametypeName', UIMenu_GameType().value );
	}

	if ( /^(open|close)MenuOnDvar(Not)?$/i.test( name ) && args.length >= 3 ) {
		const match = UIMenu_GetDvar( args[0] ) === args[1];
		if ( match !== /Not$/i.test( name ) ) {
			if ( /^open/i.test( name ) ) {
				UIMenu_Open( args[2] );
			} else {
				UIMenu_Close( args[2] );
			}
		}
	} else if ( script === 'getlanguage' ) {
		UIMenu_SetDvar( 'ui_language', 'english' );
	} else if ( !['loadcontrols', 'addplayerprofiles', 'stoprefresh', 'loadarenas'].includes( script ) ) {
		Con_Printf( 'menu uiScript unavailable: ' + name + '\n' );
	}
}


/**
 * @exec helper
 * ================
 * UIMenu_OpenMpMain
 * ================
 */
function UIMenu_OpenMpMain(): void {
	ui_menu_stack.length = 0;
	UIMenu_RunActions( UIMenu_FindMenu( 'main' )?.on_open );
}


/**
 * @exec helper
 * ================
 * UIMenu_CloseMpMain
 * ================
 */
function UIMenu_CloseMpMain(): void {
	while ( ui_menu_stack.length > 0 )
		UIMenu_Close( ui_menu_stack[ui_menu_stack.length - 1] );

	ui_menu_focus = null;
    ui_menu_drag = null;
}


/**
 * @exec helper
 * ================
 * UIMenu_HitTest
 * ================
 */
function UIMenu_HitTest( vx: number, vy: number ): ui_menu_hit_t | null {
	let stack_idx: number;
	let menu_name: string;
	let menu: ui_menu_def_t | null;
	let item_idx: number;
	let item: ui_menu_item_def_t;
	let overlay_idx: number;

	for ( stack_idx = ui_menu_stack.length - 1; stack_idx >= 0; stack_idx-- ) {
		menu_name = ui_menu_stack[stack_idx];
		menu = UIMenu_FindMenu( menu_name );
		if ( !menu || menu_name === 'main' )
			continue;

		for ( item_idx = menu.items.length - 1; item_idx >= 0; item_idx-- ) {
			item = menu.items[item_idx];
			if ( !UIMenu_ItemClickable( item ) )
				continue;

			const x = menu.rect_x + item.rect_x;
			const y = menu.rect_y + item.rect_y;
			if ( vx < x || vx > x + item.rect_w )
				continue;

			if ( vy < y || vy > y + item.rect_h )
				continue;

			overlay_idx = ui_menu_draw_list.findIndex(
				( entry ) => entry.menu_name === menu_name && entry.item_index === item_idx,
			);

			return {
				menu_name,
				item_index: item_idx,
				overlay_index: overlay_idx,
			};
		}
		if ( menu.popup ) return null;
	}

	return null;
}


/**
 * @exec helper
 * ================
 * UIMenu_ActivateHit
 * ================
 */
function UIMenu_ActivateHit( hit: ui_menu_hit_t ): void {
	let menu: ui_menu_def_t | null;
	let item: ui_menu_item_def_t | undefined;

	menu = UIMenu_FindMenu( hit.menu_name );
	if ( !menu )
		return;

	item = menu.items[hit.item_index];
	if ( !item || !UIMenu_ItemClickable( item ) )
		return;

    if ( item.ownerdraw === 220 ) UIMenu_SetDvar('ui_netSource',String((Number(UIMenu_GetDvar('ui_netSource'))+1)%Cvar_Choices('ui_netSource').length));
    if ( item.ownerdraw === 253 ) UIMenu_SetDvar('ui_joinGametype',String((Number(UIMenu_GetDvar('ui_joinGametype'))+1)%(providers.gametypes.length+1)));
	if ( item.ownerdraw === 245 ) {
        UIMenu_SetDvar( 'ui_netGametype', String( ( Number( UIMenu_GetDvar( 'ui_netGametype' ) ) + 1 ) % providers.gametypes.length ) );
        UIMenu_SetDvar( 'ui_netGametypeName', UIMenu_GameType().value );
        UIMenu_SetDvar( 'ui_currentNetMap', '0' );
    }
    if ( item.dvar ) {
        if ( item.enum_list ) {
            const choices = Cvar_Choices( item.enum_list );
            if ( choices.length ) UIMenu_SetDvar( item.dvar, choices[( Cvar_EnumIndex( UIMenu_GetDvar( item.dvar ), choices ) + 1 ) % choices.length] );
        } else if ( item.type === 11 ) UIMenu_SetDvar( item.dvar, Number( UIMenu_GetDvar( item.dvar ) ) ? '0' : '1' );
		else if ( item.choices?.length ) {
			const index = item.choices.findIndex( c => c.value === UIMenu_GetDvar( item.dvar! ) );
			UIMenu_SetDvar( item.dvar, item.choices[( index + 1 ) % item.choices.length].value );
		} else if ( [4,9,14,16,17,18].includes( item.type ) ) ui_menu_edit = item;
	}
    const previousItem = ui_menu_action_item;
    ui_menu_action_item = item;
	UIMenu_RunActions( item.action, hit.menu_name );
    ui_menu_action_item = previousItem;
	UIMenu_RebuildDrawList();
}


/**
 * @exec init-once
 * ================
 * UIMenu_SetPlaySound
 * ================
 */
export function UIMenu_SetPlaySound( play_sound: ( ( sound: string ) => void ) | null ): void {
	ui_menu_play_sound = play_sound;

	if ( play_sound ) {
		Command_Register(
			'exec',
			( args ) => {
				if ( /^(default|default_mp)\.cfg$/i.test( args[0] ?? '' ) ) {
					UIMenu_Exec( 'exec ' + args[0] );
				} else if ( args[0] in configs ) {
					UIMenu_Exec( ( configs as Record<string, string> )[args[0]] );
				} else {
					Con_Printf( 'Could not exec ' + ( args[0] ?? '' ) );
				}
			},
			() => Object.keys( configs )
		);

		Command_Register( 'setrecommended', () => {
			UIMenu_Exec( 'setRecommended' );
		} );

		Command_Register( 'setfromdvar', ( args ) => {
			if ( args.length >= 2 ) {
				UIMenu_SetDvar( args[0], UIMenu_GetDvar( args[1] ) );
			}
		} );
	}
}


/**
 * @exec per-frame
 * ================
 * UIMenu_SetMpBackdropActive
 * ================
 */
export function UIMenu_SetMpBackdropActive( active: boolean ): void {
	if ( active === ui_menu_mp_active )
		return;

	ui_menu_mp_active = active;

	if ( active ) {
		if ( !ui_menu_initialized ) {
			ui_menu_initialized = true;
			UIMenu_OpenMpMain();
		} else if ( ui_menu_stack.length === 0 ) {
			UIMenu_OpenMpMain();
		}
		return;
	}

	UIMenu_CloseMpMain();
}


/**
 * @exec per-frame
 * ================
 * UIMenu_UpdateFocus
 * ================
 */
export function UIMenu_UpdateFocus( vx: number, vy: number ): number {
	let next: ui_menu_hit_t | null;

	next = ui_menu_drag ?? UIMenu_HitTest( vx, vy );

    if ( !UIMenu_HitEqual( ui_menu_focus, next ) ) {
        if ( ui_menu_focus ) UIMenu_RunActions( UIMenu_FindMenu( ui_menu_focus.menu_name )?.items[ui_menu_focus.item_index]?.mouse_exit, ui_menu_focus.menu_name );
        if ( next ) UIMenu_OnFocusEnter( next );
    }

	ui_menu_focus = next;
	return ui_menu_focus ? ui_menu_focus.overlay_index : -1;
}


/**
 * @exec async-callback
 * ================
 * UIMenu_Click
 * ================
 */
export function UIMenu_Click( vx: number, vy: number ): boolean {
	if ( Level_Phase() === 'briefing' ) {
		Level_Continue();
		return true;
	}

	const hit = UIMenu_HitTest( vx, vy );

	if ( !hit ) {
		return false;
	}

	const menu = UIMenu_FindMenu( hit.menu_name )!;
	const item = menu.items[hit.item_index];

	if ( item.feeder === 24 ) {
		ui_profile_selected = Math.max(
			0,
			Math.min(
				ui_profiles.length - 1,
				Math.floor( ( vy - menu.rect_y - item.rect_y ) / ( item.elementheight || 14 ) ) +
					( ui_menu_list_start.get( item ) ?? 0 )
			)
		);
		UIMenu_ProfileRefresh();
	}

	if ( item.type === 6 && [1, 4].includes( item.feeder ?? -1 ) ) {
		const row =
			Math.floor( ( vy - menu.rect_y - item.rect_y ) / ( item.elementheight || 20 ) ) +
			( ui_menu_list_start.get( item ) ?? 0 );
		UIMenu_SetDvar(
			'ui_currentNetMap',
			String( Math.min( UIMenu_Maps().length - 1, Math.max( 0, row ) ) )
		);
	}

	if ( item.type === 10 && item.range && item.dvar ) {
		UIMenu_Slide( hit, vx );
	}

	UIMenu_ActivateHit( hit );
	return true;
}

/** @exec helper */
function UIMenu_Slide( hit: ui_menu_hit_t, vx: number ): void {
	const menu = UIMenu_FindMenu( hit.menu_name )!;
	const item = menu.items[hit.item_index];

	if ( !item.range || !item.dvar ) {
		return;
	}

	const label = UIMenu_ItemLabel( item );
	const width = UI_TextWidth( label, item.textscale, vid.height || 480, item.textfont );
	const align =
		item.textalign === 2
			? width
			: item.textalign === 1 || item.textalign === 3
				? Math.trunc( width / 2 )
				: 0;
	const start = menu.rect_x + item.rect_x + ( label ? item.textalignx - align + width + 8 : 0 );
	const fraction = UI_SliderFraction( vx, start );

	UIMenu_SetDvar( item.dvar, String( item.range[1] + fraction * ( item.range[2] - item.range[1] ) ) );
}

/** @exec async-callback */
export function UIMenu_PointerDown( vx: number, vy: number ): boolean {
	const hit = UIMenu_HitTest( vx, vy );

	if ( !hit ) {
		return false;
	}

	const menu = UIMenu_FindMenu( hit.menu_name )!;
	const item = menu.items[hit.item_index];

	if ( item.type === 6 && !item.noscrollbars && vx >= menu.rect_x + item.rect_x + item.rect_w - 17 ) {
		const scroll = UI_ListScroll(
			item.rect_h,
			item.elementheight || 20,
			UIMenu_ToGpuItem( item ).rows?.length || 0,
			ui_menu_list_start.get( item ) || 0
		);
		const y = vy - menu.rect_y - item.rect_y;
		let next = scroll.start;

		if ( y < 17 ) {
			next--;
		} else if ( y > item.rect_h - 17 ) {
			next++;
		} else if ( y >= scroll.thumb && y <= scroll.thumb + 16 ) {
			ui_menu_scroll_drag = { hit, offset: y - scroll.thumb };
		} else {
			next += y < scroll.thumb ? -scroll.page : scroll.page;
		}

		ui_menu_list_start.set( item, Math.max( 0, Math.min( scroll.max, next ) ) );
		return true;
	}

	if ( item.type !== 10 ) {
		return false;
	}

	ui_menu_drag = hit;
	UIMenu_Click( vx, vy );
	return true;
}

/**
 * @exec async-callback
 * ================
 * UIMenu_PointerMove
 *
 * Tracks dragging movements for UI sliders and listbox scrollbars.
 * ================
 */
export function UIMenu_PointerMove( vx: number, vy = 0 ): void {
	if ( ui_menu_drag ) {
		UIMenu_Slide( ui_menu_drag, vx );
	}

	if ( ui_menu_scroll_drag ) {
		const { hit, offset } = ui_menu_scroll_drag;
		const menu = UIMenu_FindMenu( hit.menu_name )!;
		const item = menu.items[hit.item_index];
		const scroll = UI_ListScroll(
			item.rect_h,
			item.elementheight || 20,
			UIMenu_ToGpuItem( item ).rows?.length || 0,
			ui_menu_list_start.get( item ) || 0
		);
		const fraction = ( vy - menu.rect_y - item.rect_y - 17 - offset ) / ( scroll.travel || 1 );

		ui_menu_list_start.set( item, Math.round( Math.max( 0, Math.min( 1, fraction ) ) * scroll.max ) );
	}
}

/**
 * @exec async-callback
 * ================
 * UIMenu_PointerUp
 *
 * Resets active slider and listbox drag operations.
 * ================
 */
export function UIMenu_PointerUp(): void {
	ui_menu_drag = null;
	ui_menu_scroll_drag = null;
}


/**
 * @exec per-frame
 * ================
 * UIMenu_GpuOverlay
 *
 * Compiles active UI menu items, feeder lists, connecting banners,
 * and backdrop blurs into GPU overlay items.
 * ================
 */
export function UIMenu_GpuOverlay( cursor_vx: number, cursor_vy: number ): rgpu_menu_overlay_t | null {
	const phase = Level_Phase();
	let items: rgpu_menu_item_t[];
	let i: number;

	if ( !ui_menu_mp_active || ui_menu_draw_list.length === 0 ) {
		return null;
	}

	items = [];

	for ( i = 0; i < ui_menu_draw_list.length; i++ ) {
		const entry = ui_menu_draw_list[i];
		const item = UIMenu_ToGpuItem( entry.item );
		const menu = UIMenu_FindMenu( entry.menu_name )!;

		if ( entry.item_index === -1 && !item.label ) {
			item.full_bleed = true;
		}

		if ( entry.item_index !== -1 ) {
			item.rect_x += menu.rect_x;
			item.rect_y += menu.rect_y;
		}

		// WINDOW_STYLE_LOADBAR uses the common asset-load fraction.
		if ( item.style === 7 ) {
			item.style = 3;
			item.rect_w *= Level_Progress();
		}

		items.push( item );
	}

	// UI_DrawConnectScreen 0x53918a..0x5391d7 draws these after connect.menu.
	// 0x532d00 resolves the game-type label; 0x532c40 resolves the arena longname.
	if ( phase === 'loading' ) {
		const type = providers.gametypes.find( ( t ) => t.value === Cvar_Get( 'g_gametype' ) );
		const map = providers.maps.find( ( m ) => m.map === Level_Name() );
		const heading: rgpu_menu_item_t = {
			rect_x: 320,
			rect_y: 89,
			rect_w: 0,
			rect_h: 0,
			textalign: 1,
			textalignx: 0,
			textaligny: 0,
			textscale: 0.5,
			textstyle: 6,
			forecolor: [1, 1, 1, 1],
			focuscolor: GLOBAL_FOCUSED_COLOR,
			label: UI_MenuString( type?.label ?? Cvar_Get( 'g_gametype' ) ),
		};

		items.push( heading, { ...heading, rect_y: 119, label: map?.longname ?? Level_Name() } );
	}

	return {
		blur_world: Math.max( 0, ...ui_menu_stack.map( ( name ) => UIMenu_FindMenu( name )?.blur_world ?? 0 ) ),
		hide_cursor: phase === 'loading',
		focus_idx: ui_menu_focus ? ui_menu_focus.overlay_index : -1,
		cursor_vx,
		cursor_vy,
		items,
	};
}

/**
 * @exec helper
 * ================
 * UIMenu_SetLevelPhase
 *
 * Native script menus are selected by the session transition, not hardcoded buttons.
 * ================
 */
export function UIMenu_SetLevelPhase( phase: level_phase_t ): void {
	ui_menu_stack.length = 0;
	ui_menu_focus = null;
	ui_menu_edit = null;
	UIMenu_PointerUp();

	if ( phase === 'menu' ) {
		UIMenu_OpenMpMain();
	}

	if ( phase === 'loading' ) {
		Cvar_Set( 'com_expectedhunkusage', '1' );
		UIMenu_Open( 'connect' );
	}

	if ( phase === 'briefing' ) {
		UIMenu_Open( 'serverinfo_' + Cvar_Get( 'g_gametype' ) );
	}

	const nations = Level_Data()?.manifest.nationalities;
	const allies = Cvar_Get( 'scr_allies' ) || nations?.allies || 'american';
	const axis = Cvar_Get( 'scr_axis' ) || nations?.axis || 'german';

	if ( phase === 'team' ) {
		UIMenu_Open( 'team_' + allies + axis );
	}

	if ( phase === 'weapon' ) {
		UIMenu_Open( 'weapon_' + ( UIMenu_GetDvar( 'ui_team' ) === 'axis' ? axis : allies ) );
	}

	UIMenu_RebuildDrawList();
}

/**
 * @exec helper
 * ================
 * UIMenu_OpenInGame
 *
 * Opens in-game pause menu with weapon change gating.
 * ================
 */
export function UIMenu_OpenInGame(): void {
	Cvar_Set(
		'ui_allow_weaponchange',
		['allies', 'axis'].includes( Cvar_Get( 'ui_team' ) ) ? '1' : '0'
	);
	UIMenu_Open( 'ingame' );
}


/**
 * @exec helper
 * ================
 * UIMenu_GetDvarValue
 * ================
 */
export function UIMenu_GetDvarValue( name: string ): string {
	return UIMenu_GetDvar( name );
}

/**
 * @exec helper
 * ================
 * UIMenu_SetDvarValue
 * ================
 */
export function UIMenu_SetDvarValue( name: string, value: string ): void {
	UIMenu_SetDvar( name, value );
	UIMenu_RebuildDrawList();
}

/**
 * @exec async-callback
 * ================
 * UIMenu_Key
 *
 * Handles keypress routing to menus, action execution, and edit fields.
 * ================
 */
export function UIMenu_Key( key: string ): boolean {
	if ( !ui_menu_mp_active ) {
		return false;
	}

	if ( Level_Phase() === 'briefing' && ( key === 'Enter' || key === ' ' ) ) {
		Level_Continue();
		return true;
	}

	const top = UIMenu_FindMenu( ui_menu_stack[ui_menu_stack.length - 1] );

	if ( top?.exec_keys?.[key] ) {
		UIMenu_RunActions( top.exec_keys[key], top.name );
		return true;
	}

	if ( ui_menu_edit?.dvar ) {
		const item = ui_menu_edit;
		const dvar = item.dvar!;

		if ( key === 'Escape' ) {
			ui_menu_edit = null;
		} else if ( item.type === 14 ) {
			UIMenu_SetDvar(
				dvar,
				key === 'Backspace' ? '' : key === ' ' ? 'SPACE' : key.toUpperCase()
			);
			ui_menu_edit = null;
		} else if ( key === 'Enter' ) {
			ui_menu_edit = null;
			const menu = UI_MP_MENUS.find( ( m ) => m.items.includes( item ) );
			UIMenu_RunActions( item.accept, menu?.name );
		} else if ( key === 'Backspace' ) {
			UIMenu_SetDvar( dvar, UIMenu_GetDvar( dvar ).slice( 0, -1 ) );
		} else if (
			key.length === 1 &&
			UIMenu_GetDvar( dvar ).length < ( item.maxchars || 255 ) &&
			( item.type !== 16 || !/[\\/:*?"<>|]/.test( key ) ) &&
			( ![9, 17].includes( item.type ) || /[0-9.\-]/.test( key ) )
		) {
			UIMenu_SetDvar( dvar, UIMenu_GetDvar( dvar ) + key );
		}

		return true;
	}

	if ( key === 'Escape' ) {
		const name = ui_menu_stack[ui_menu_stack.length - 1];
		UIMenu_RunActions( UIMenu_FindMenu( name )?.on_esc, name );
		return true;
	}

	if ( key === 'Enter' && ui_menu_focus ) {
		UIMenu_ActivateHit( ui_menu_focus );
		return true;
	}

	return false;
}

/**
 * @exec helper
 * ================
 * UIMenu_OpenStack
 *
 * Returns read-only copy of active menu stack names.
 * ================
 */
export function UIMenu_OpenStack(): readonly string[] {
	return ui_menu_stack;
}

/**
 * @exec async-callback
 * ================
 * UIMenu_Wheel
 *
 * Handles mouse wheel scrolling on listbox elements.
 * ================
 */
export function UIMenu_Wheel( vx: number, vy: number, delta: number ): boolean {
	const hit = UIMenu_HitTest( vx, vy );

	if ( !hit ) {
		return false;
	}

	const item = UIMenu_FindMenu( hit.menu_name )!.items[hit.item_index];

	if ( item.type !== 6 ) {
		return false;
	}

	const count = Math.floor( item.rect_h / ( item.elementheight || 20 ) );
	const total = UIMenu_ToGpuItem( item ).rows?.length ?? 0;

	ui_menu_list_start.set(
		item,
		Math.max(
			0,
			Math.min( total - count, ( ui_menu_list_start.get( item ) ?? 0 ) + Math.sign( delta ) )
		)
	);

	return true;
}
