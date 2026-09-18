/*
===============================================================================

	hud.ts

	Call of Duty 2 / id Tech Heads-Up Display (HUD)
	Dynamic 2D HUD element generation for ammo counters, low clip warning flashes,
	weapon name displays, firing mode icons, and player stance indicators.
	Reconstructed from native ownerdraw routines 0x4c27f0 and 0x4c3790.

===============================================================================
*/

import menus from '@/assets/ui/hud.json';
import strings from '@/assets/ui/strings.json';
import { Cvar_Get } from './cvar.js';
import { Weapon_Definition } from './weapon.js';
import { UI_TextWidth } from './ui_text.js';
import {
	STANCE_HEIGHT_PRONE,
	STANCE_HEIGHT_CROUCH,
	STANCE_HEIGHT_STAND,
} from './stance.js';
import type { pm_movement_t, rgpu_menu_item_t } from './types.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const HUD_FLASH_INTERVAL_MS      = 800;
export const HUD_FLASH_INV_INTERVAL     = 0.00125;
export const HUD_FADE_DURATION_MS        = 1800;
export const HUD_FADE_TAIL_MS            = 700;
export const HUD_LOW_CLIP_RATIO          = 0.33;
export const HUD_LOW_RESERVE_RATIO       = 0.2;
export const HUD_MAX_DISPLAY_AMMO        = 999;

export const HUD_OWNERDRAW_AMMO          = 5;
export const HUD_OWNERDRAW_WEAPON_ICON   = 6;
export const HUD_OWNERDRAW_STANCE        = 20;
export const HUD_OWNERDRAW_WEAPON_NAME   = 81;
export const HUD_OWNERDRAW_FIRE_MODE     = 83;

export const HUD_ITEM_STYLE_IMAGE        = 3;

export const HUD_DIVIDER_OFFSET_X        = 5;
export const HUD_WEAPON_NAME_OFFSET_X    = 28;

export const HUD_LOW_AMMO_COLOR: [number, number, number] = [0.89, 0.18, 0.01];

export const HUD_STANCE_PRONE_MATERIAL   = 'stance_prone';
export const HUD_STANCE_CROUCH_MATERIAL  = 'stance_crouch';
export const HUD_STANCE_STAND_MATERIAL   = 'stance_stand';


// ---------------------------------------------------------------------------
// types & initialization
// ---------------------------------------------------------------------------

export interface hud_state_t {
	time: number;
	weapon: string;
	ammo: string;
	stance: number;
	weaponTime: number;
	ammoTime: number;
	stanceTime: number;
	flashTime: number;
}

/**
 * @exec helper
 * ================
 * HUD_Create
 *
 * Allocates fresh client-owned HUD timer and state tracker.
 * Presentation event clocks are client-owned; drawing never mutates simulation.
 * ================
 */
export function HUD_Create(): hud_state_t {
	return {
		time: -1,
		weapon: '',
		ammo: '',
		stance: 0,
		weaponTime: 0,
		ammoTime: 0,
		stanceTime: 0,
		flashTime: 0,
	};
}


// ---------------------------------------------------------------------------
// HUD fade timing
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * HUD_Fade
 *
 * Calculates opacity [0, 1] for expiring HUD elements (0x4c27f0, 0x4c3790).
 * Element remains fully visible until the final 700ms linear fadeout window.
 * ================
 */
export function HUD_Fade(
	now: number,
	start: number,
	duration: number
): number {
	if ( !start || now - start >= duration ) {
		return 0;
	}

	return Math.min( 1, ( duration - ( now - start ) ) / HUD_FADE_TAIL_MS );
}


// ---------------------------------------------------------------------------
// HUD item synthesis
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * HUD_Items
 *
 * Evaluates authored hud.menu ownerdraw definitions (5, 6, 20, 81, 83) against live player state.
 * Generates renderable 2D menu items for ammo, weapon, and stance displays.
 * ================
 */
export function HUD_Items(
	state: hud_state_t,
	move: pm_movement_t,
	height: number
): rgpu_menu_item_t[] {
	const w = move.weapon;
	const def = w && Weapon_Definition( w.id );
	const now = move.commandTime;

	if ( !w || !def || Cvar_Get( 'hud_enable' ) === '0' || Cvar_Get( 'cg_draw2D' ) === '0' ) {
		return [];
	}

	if ( now < state.time ) {
		Object.assign( state, HUD_Create() );
	}

	state.time = now;

	if ( state.weapon !== w.id ) {
		state.weapon = w.id;
		state.weaponTime = now;
		state.ammoTime = now;
	}

	const ammo = w.clip + ':' + w.reserve;

	if ( ammo !== state.ammo ) {
		state.ammo = ammo;
		state.ammoTime = now;
	}

	const stance = move.stance?.target ?? 60;

	if ( state.stance !== stance ) {
		state.stance = stance;
		state.stanceTime = now;
	}

	const lowClip = w.clip >= 0 && w.clip <= Math.min( HUD_MAX_DISPLAY_AMMO, Number( def.clipSize ) ) * Math.fround( HUD_LOW_CLIP_RATIO );

	if ( lowClip && ( state.flashTime > now || state.flashTime + HUD_FLASH_INTERVAL_MS < now ) ) {
		state.flashTime = now;
	}

	const alpha = ( name: string, start: number, duration: number ) =>
		Number( Cvar_Get( name ) ) === 0 ? 1 : HUD_Fade( now, start, duration );

	const ammoAlpha = alpha( 'hud_fade_ammodisplay', state.ammoTime, HUD_FADE_DURATION_MS );
	const result: rgpu_menu_item_t[] = [];

	for ( const menu of menus ) {
		for ( const raw of menu.items ) {
			const color = raw.forecolor as [number, number, number, number];
			const id = raw.ownerdraw;

			const base: rgpu_menu_item_t = {
				label: '',
				rect_x: menu.rect_x + raw.rect_x,
				rect_y: menu.rect_y + raw.rect_y,
				rect_w: raw.rect_w,
				rect_h: raw.rect_h,
				horz_align: menu.horz_align,
				vert_align: menu.vert_align,
				textscale: raw.textscale,
				textfont: raw.textfont,
				textstyle: raw.textstyle,
				textalignx: raw.textalignx,
				textaligny: raw.textaligny,
				background: 'background' in raw ? raw.background : undefined,
				forecolor: [...color],
				focuscolor: [...color],
			};

			const add = ( label: string = '', x: number = base.rect_x, itemColor: [number, number, number, number] = base.forecolor ) =>
				result.push( { ...base, label, rect_x: x, forecolor: itemColor } );

			if ( id === HUD_OWNERDRAW_AMMO && !w.holster ) {
				base.forecolor[3] = ammoAlpha;
				const clip = def.clipOnly === '1' ? -1 : w.clip;
				const reserve = w.reserve;
				const clipText = String( Math.min( HUD_MAX_DISPLAY_AMMO, clip ) ).padStart( 2, ' ' );
				const reserveText = String( Math.min( HUD_MAX_DISPLAY_AMMO, reserve ) ).padStart( 3, ' ' );

				const reserveColor: rgpu_menu_item_t['forecolor'] =
					reserve <= Math.min( HUD_MAX_DISPLAY_AMMO, Number( def.maxAmmo ) ) * Math.fround( HUD_LOW_RESERVE_RATIO )
						? [...HUD_LOW_AMMO_COLOR, ammoAlpha]
						: base.forecolor;

				if ( clip >= 0 && reserve >= 0 ) {
					add( clipText );
					add(
						reserveText,
						base.rect_x + base.rect_w - UI_TextWidth( reserveText, base.textscale, height, base.textfont ),
						reserveColor
					);
					add(
						'|',
						base.rect_x + ( base.rect_w - UI_TextWidth( '|', base.textscale, height, base.textfont ) ) * 0.5 - HUD_DIVIDER_OFFSET_X
					);
				} else if ( clip >= 0 || reserve >= 0 ) {
					const text = clip >= 0 ? clipText : reserveText;
					add(
						text,
						base.rect_x + ( base.rect_w - UI_TextWidth( text, base.textscale, height, base.textfont ) ) * 0.5,
						clip >= 0 ? base.forecolor : reserveColor
					);
				}

				if ( clip >= 0 && lowClip ) {
					add(
						clipText,
						clip >= 0 && reserve >= 0
							? base.rect_x
							: base.rect_x + ( base.rect_w - UI_TextWidth( clipText, base.textscale, height, base.textfont ) ) * 0.5,
						[
							...HUD_LOW_AMMO_COLOR,
							Math.min( ammoAlpha, ( state.flashTime + HUD_FLASH_INTERVAL_MS - now ) * Math.fround( HUD_FLASH_INV_INTERVAL ) ),
						]
					);
				}
			} else if ( id === HUD_OWNERDRAW_WEAPON_ICON && !w.holster ) {
				base.style = HUD_ITEM_STYLE_IMAGE;
				base.forecolor[3] = ammoAlpha;
				add();
			} else if ( id === HUD_OWNERDRAW_WEAPON_NAME && !w.holster ) {
				const label = strings[def.displayName as keyof typeof strings] ?? def.displayName;
				base.forecolor[3] = HUD_Fade( now, state.weaponTime, HUD_FADE_DURATION_MS );
				add(
					label,
					base.rect_x + base.rect_w - UI_TextWidth( label, base.textscale, height, base.textfont ) - HUD_WEAPON_NAME_OFFSET_X
				);
			} else if ( id === HUD_OWNERDRAW_FIRE_MODE && !w.holster && def.modeIcon ) {
				base.style = HUD_ITEM_STYLE_IMAGE;
				base.background = def.modeIcon;
				base.forecolor[3] = alpha( 'hud_fade_ammodisplay', state.weaponTime, HUD_FADE_DURATION_MS );
				add();
			} else if ( id === HUD_OWNERDRAW_STANCE ) {
				base.style = HUD_ITEM_STYLE_IMAGE;
				base.background = stance === STANCE_HEIGHT_PRONE
					? HUD_STANCE_PRONE_MATERIAL
					: stance === STANCE_HEIGHT_CROUCH
						? HUD_STANCE_CROUCH_MATERIAL
						: HUD_STANCE_STAND_MATERIAL;
				base.forecolor[3] = alpha( 'hud_fade_stance', state.stanceTime, Number( Cvar_Get( 'hud_fade_stance' ) ) * 1000 );
				add();
			}
		}
	}

	return result.filter( ( i ) => i.forecolor[3] > 0 );
}
