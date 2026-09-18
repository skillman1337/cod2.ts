/*
===============================================================================

	scr_menu.ts

	Call of Duty 2 / id Tech UI Menu & Console Display Bridge
	CoD2 ui_mp/main.menu — client-owned menu intent, input, and GPU overlay
	bridge. Renderer resource readiness never determines whether the menu is
	active. Menu data: mp_main_menu/menus.ts. Runtime: ui_menu_runtime.ts.
	Parent is cl_main.ts.

===============================================================================
*/

import { vid } from '@/engine/common/vid.js';
import { CG_Draw2D } from '@/engine/common/cg_draw.js';
import { HUD_Create } from '@/engine/common/hud.js';
import { Level_Phase, type level_phase_t } from '@/engine/common/level.js';
import {
	UIMenu_SetLevelPhase,
	UIMenu_OpenInGame,
	UIMenu_OpenStack,
	UIMenu_Wheel,
	UIMenu_SaveActiveProfile,
	UIMenu_PointerDown,
	UIMenu_PointerMove,
	UIMenu_PointerUp,
	UIMenu_Click,
	UIMenu_GpuOverlay,
	UIMenu_SetMpBackdropActive,
	UIMenu_SetPlaySound,
	UIMenu_UpdateFocus,
	UIMenu_Key,
	UIMenu_GetDvarValue,
} from './scr_menu/ui_menu_runtime.js';
import { Con_IsOpen, Con_IsFull, Con_Key, Con_Input, Con_Lines } from '@/engine/common/common.js';
import { UI_TextLines, UI_TextWidth } from '@/engine/common/ui_text.js';
import { pm_movement_t, rgpu_menu_overlay_t } from '@/engine/common/types.js';
import { Command_Matches, Command_IsCommand, Command_ArgumentMatches } from '@/engine/common/commands.js';
import { Cvar_Description, Cvar_Get, Cvar_Has } from '@/engine/common/cvar.js';
import { UI_Layout, UI_VIRTUAL_HEIGHT, UI_VIRTUAL_WIDTH } from '@/engine/common/ui_layout.js';


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

let scr_menu_active = false;
let scr_menu_cursor_vx = 0;
let scr_menu_cursor_vy = 0;
let scr_menu_input_canvas: HTMLCanvasElement | null = null;
let scr_menu_drag_pointer: number | null = null;
let scr_menu_suppress_click = false;
let scr_level_phase: level_phase_t = 'menu';
let scr_hud = HUD_Create();


// ---------------------------------------------------------------------------
// forward
// SCR_MenuInit, SCR_MenuShutdown, SCR_MenuSetActive, SCR_MenuIsActive
// SCR_MenuVirtualLayout, SCR_MenuClientToVirtual, SCR_MenuWireInput
// SCR_MenuUnwireInput, SCR_MenuClick, SCR_MenuSetCanvasCursor, SCR_MenuFrame
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// menu initialization & lifecycle
// ---------------------------------------------------------------------------

/**
 * @exec init-once
 * ================
 * SCR_MenuInit
 *
 * Bind client services only. The client parent makes the explicit initial
 * active/inactive policy decision through SCR_MenuSetActive.
 * ================
 */
export function SCR_MenuInit( play_sound: ( sound: string ) => void ): void {
	SCR_MenuShutdown();
	UIMenu_SetPlaySound( play_sound );
	SCR_MenuWireInput();
}

/**
 * @exec init-once
 * ================
 * SCR_MenuShutdown
 *
 * Release browser listeners and client callbacks owned by this lifecycle.
 * ================
 */
export function SCR_MenuShutdown(): void {
	if ( scr_menu_input_canvas ) {
		UIMenu_SaveActiveProfile();
	}

	SCR_MenuSetActive( false );
	SCR_MenuUnwireInput();
	UIMenu_SetPlaySound( null );
	scr_menu_cursor_vx = 0;
	scr_menu_cursor_vy = 0;
}

/**
 * @exec helper
 * ================
 * SCR_MenuSetActive
 *
 * Semantic UI state. This is intentionally independent of GPU asset state.
 * ================
 */
export function SCR_MenuSetActive( active: boolean ): void {
	scr_menu_active = active;
	UIMenu_SetMpBackdropActive( active );

	if ( active ) {
		SCR_MenuWireInput();
	}

	SCR_MenuSetCanvasCursor( active );
}

/**
 * @exec helper
 * ================
 * SCR_MenuIsActive
 *
 * Returns whether UI menu system is actively receiving interaction.
 * ================
 */
export function SCR_MenuIsActive(): boolean {
	return scr_menu_active;
}


// ---------------------------------------------------------------------------
// virtual layout & coordinates
// ---------------------------------------------------------------------------

/**
 * @exec per-frame
 * ================
 * SCR_MenuVirtualLayout
 *
 * Computes 640x480 virtual aspect ratio letterboxing and scaling factors.
 * ================
 */
function SCR_MenuVirtualLayout(): ReturnType<typeof UI_Layout> {
	if ( vid.valid ) {
		return UI_Layout( vid.width, vid.height );
	}

	return UI_Layout(
		Math.floor( window.innerWidth * ( window.devicePixelRatio || 1 ) ),
		Math.floor( window.innerHeight * ( window.devicePixelRatio || 1 ) )
	);
}

/**
 * @exec per-frame
 * ================
 * SCR_MenuClientToVirtual
 *
 * Maps physical browser client coordinates into virtual 640x480 screen space.
 * ================
 */
export function SCR_MenuClientToVirtual(
	client_x: number,
	client_y: number
): { vx: number; vy: number } {
	let layout: ReturnType<typeof SCR_MenuVirtualLayout>;
	let rect: DOMRect | null;
	let dev_x: number;
	let dev_y: number;
	let vx: number;
	let vy: number;

	layout = SCR_MenuVirtualLayout();

	if ( vid.canvas ) {
		rect = vid.canvas.getBoundingClientRect();
		dev_x =
			( client_x - rect.left ) *
			( ( vid.valid ? vid.width : rect.width * ( window.devicePixelRatio || 1 ) ) / rect.width );
		dev_y =
			( client_y - rect.top ) *
			( ( vid.valid ? vid.height : rect.height * ( window.devicePixelRatio || 1 ) ) / rect.height );
	} else {
		dev_x = client_x * ( window.devicePixelRatio || 1 );
		dev_y = client_y * ( window.devicePixelRatio || 1 );
	}

	vx = ( dev_x - layout.xoffset ) / layout.scale;
	vy = dev_y / layout.scale;

	return { vx, vy };
}


// ---------------------------------------------------------------------------
// input wiring & event handlers
// ---------------------------------------------------------------------------

/**
 * @exec init-once
 * ================
 * SCR_MenuWireInput
 *
 * Rebind when VID adopts a different canvas; never leave a listener attached
 * to a canvas from a previous client lifecycle.
 * ================
 */
function SCR_MenuWireInput(): void {
	if ( scr_menu_input_canvas === vid.canvas ) {
		return;
	}

	SCR_MenuUnwireInput();

	if ( !vid.canvas ) {
		return;
	}

	vid.canvas.addEventListener( 'click', SCR_MenuClick );
	vid.canvas.addEventListener( 'pointerdown', SCR_MenuPointerDown );
	vid.canvas.addEventListener( 'pointermove', SCR_MenuPointerMove );
	vid.canvas.addEventListener( 'pointerup', SCR_MenuPointerUp );
	vid.canvas.addEventListener( 'pointercancel', SCR_MenuPointerUp );
	vid.canvas.addEventListener( 'lostpointercapture', SCR_MenuPointerUp );
	vid.canvas.addEventListener( 'wheel', SCR_MenuWheel, { passive: false } );
	window.addEventListener( 'keydown', SCR_MenuKey );
	scr_menu_input_canvas = vid.canvas;
}

/**
 * @exec init-once
 * ================
 * SCR_MenuUnwireInput
 *
 * Detaches DOM event listeners from previous host canvas.
 * ================
 */
function SCR_MenuUnwireInput(): void {
	SCR_MenuPointerUp();
	scr_menu_suppress_click = false;
	window.removeEventListener( 'keydown', SCR_MenuKey );

	if ( scr_menu_input_canvas ) {
		scr_menu_input_canvas.removeEventListener( 'click', SCR_MenuClick );
		scr_menu_input_canvas.removeEventListener( 'pointerdown', SCR_MenuPointerDown );
		scr_menu_input_canvas.removeEventListener( 'pointermove', SCR_MenuPointerMove );
		scr_menu_input_canvas.removeEventListener( 'pointerup', SCR_MenuPointerUp );
		scr_menu_input_canvas.removeEventListener( 'pointercancel', SCR_MenuPointerUp );
		scr_menu_input_canvas.removeEventListener( 'lostpointercapture', SCR_MenuPointerUp );
		scr_menu_input_canvas.removeEventListener( 'wheel', SCR_MenuWheel );
	}

	scr_menu_input_canvas = null;
}

/**
 * @exec async-callback
 * ================
 * SCR_MenuKey
 *
 * Handles keyboard navigation, console toggle, and in-game pause menu.
 * ================
 */
function SCR_MenuKey( ev: KeyboardEvent ): void {
	if ( Con_Key( ev.code === 'Backquote' ? '`' : ev.key, ev.shiftKey ) ) {
		SCR_MenuPointerUp();
		ev.preventDefault();
		ev.stopImmediatePropagation();
		return;
	}

	if ( !scr_menu_active && Level_Phase() === 'playing' && ev.key === 'Escape' ) {
		UIMenu_OpenInGame();
		SCR_MenuSetActive( true );
		ev.preventDefault();
		return;
	}

	if ( scr_menu_active && UIMenu_Key( ev.key ) ) {
		ev.preventDefault();
		ev.stopPropagation();
	}
}

/**
 * @exec async-callback
 * ================
 * SCR_MenuPointerDown
 *
 * Captures pointer for dragging sliders and list items.
 * ================
 */
function SCR_MenuPointerDown( ev: PointerEvent ): void {
	scr_menu_suppress_click = false;

	if ( !scr_menu_active || Con_IsOpen() || ev.button !== 0 ) {
		return;
	}

	const pos = SCR_MenuClientToVirtual( ev.clientX, ev.clientY );

	if ( UIMenu_PointerDown( pos.vx, pos.vy ) ) {
		scr_menu_drag_pointer = ev.pointerId;
		scr_menu_input_canvas?.setPointerCapture( ev.pointerId );
		scr_menu_suppress_click = true;
		ev.preventDefault();
	}
}

/**
 * @exec async-callback
 * ================
 * SCR_MenuPointerMove
 *
 * Updates active drag position for sliders.
 * ================
 */
function SCR_MenuPointerMove( ev: PointerEvent ): void {
	if ( ev.pointerId !== scr_menu_drag_pointer ) {
		return;
	}

	const p = SCR_MenuClientToVirtual( ev.clientX, ev.clientY );
	UIMenu_PointerMove( p.vx, p.vy );
}

/**
 * @exec async-callback
 * ================
 * SCR_MenuPointerUp
 *
 * Releases pointer capture after mouse dragging finishes.
 * ================
 */
function SCR_MenuPointerUp(): void {
	const pointer = scr_menu_drag_pointer;
	scr_menu_drag_pointer = null;
	UIMenu_PointerUp();

	if ( pointer !== null && scr_menu_input_canvas?.hasPointerCapture( pointer ) ) {
		scr_menu_input_canvas.releasePointerCapture( pointer );
	}
}

/**
 * @exec async-callback
 * ================
 * SCR_MenuWheel
 *
 * Routes mouse wheel scroll events into active menu listboxes.
 * ================
 */
function SCR_MenuWheel( ev: WheelEvent ): void {
	const p = SCR_MenuClientToVirtual( ev.clientX, ev.clientY );

	if ( scr_menu_active && !Con_IsOpen() && UIMenu_Wheel( p.vx, p.vy, ev.deltaY ) ) {
		ev.preventDefault();
	}
}

/**
 * @exec per-frame
 * ================
 * SCR_MenuVolume
 *
 * Retrieves active sound volume for menu sound effects.
 * ================
 */
export function SCR_MenuVolume(): number {
	const volume = Number( UIMenu_GetDvarValue( 'snd_volume' ) );
	return Number.isFinite( volume ) ? Math.min( 1, Math.max( 0, volume ) ) : 0.8;
}

/**
 * @exec async-callback
 * ================
 * SCR_MenuClick
 *
 * Dispatches virtual coordinates on mouse click to UI items.
 * ================
 */
function SCR_MenuClick( ev: MouseEvent ): void {
	if ( scr_menu_suppress_click ) {
		scr_menu_suppress_click = false;
		return;
	}

	if ( !scr_menu_active || Con_IsOpen() ) {
		return;
	}

	const pos = SCR_MenuClientToVirtual( ev.clientX, ev.clientY );

	if ( !UIMenu_Click( pos.vx, pos.vy ) ) {
		return;
	}

	ev.preventDefault();
	ev.stopPropagation();
}

/**
 * @exec per-frame
 * ================
 * SCR_MenuSetCanvasCursor
 *
 * Hides or restores native cursor depending on active menu state.
 * ================
 */
function SCR_MenuSetCanvasCursor( active: boolean ): void {
	if ( !vid.canvas ) {
		return;
	}

	vid.canvas.style.cursor = active ? 'none' : '';
}


// ---------------------------------------------------------------------------
// menu frame & gpu overlay composition
// ---------------------------------------------------------------------------

/**
 * @exec per-frame
 * ================
 * SCR_MenuFrame
 *
 * Update pointer-derived UI data without changing semantic menu intent.
 * ================
 */
export function SCR_MenuFrame( client_x: number, client_y: number ): void {
	const phase = Level_Phase();

	if ( phase !== scr_level_phase ) {
		scr_level_phase = phase;

		if ( Con_IsOpen() ) {
			Con_Key( 'Escape' );
		}

		SCR_MenuSetActive( phase !== 'playing' );
		UIMenu_SetLevelPhase( phase );
	}

	if ( phase === 'playing' && scr_menu_active && !UIMenu_OpenStack().length ) {
		SCR_MenuSetActive( false );
	}

	SCR_MenuWireInput();
	SCR_MenuSetCanvasCursor( scr_menu_active );

	if ( !scr_menu_active ) {
		return;
	}

	const pos = SCR_MenuClientToVirtual( client_x, client_y );
	scr_menu_cursor_vx = pos.vx;
	scr_menu_cursor_vy = pos.vy;
	UIMenu_UpdateFocus( pos.vx, pos.vy );
}

/**
 * @exec per-frame
 * ================
 * SCR_MenuGpuOverlay
 *
 * Assembles active menu UI, 2D HUD overlays, and drop-down console elements
 * into the master GPU overlay pass descriptor.
 * ================
 */
export function SCR_MenuGpuOverlay( movement?: pm_movement_t ): rgpu_menu_overlay_t | null {
	let menu = scr_menu_active ? UIMenu_GpuOverlay( scr_menu_cursor_vx, scr_menu_cursor_vy ) : null;

	if ( Level_Phase() !== 'playing' ) {
		scr_hud = HUD_Create();
	}

	const cg2d = CG_Draw2D(
		scr_hud,
		Level_Phase() === 'playing' ? movement : undefined,
		vid.height || UI_VIRTUAL_HEIGHT,
		vid.width || UI_VIRTUAL_WIDTH
	);

	if ( cg2d.length ) {
		menu = {
			items: [...( menu?.items ?? [] ), ...cg2d],
			blur_world: menu?.blur_world,
			focus_idx: menu?.focus_idx ?? -1,
			cursor_vx: menu?.cursor_vx ?? 0,
			cursor_vy: menu?.cursor_vy ?? 0,
			hide_cursor: menu?.hide_cursor ?? true,
			console_only: menu ? menu.console_only : true,
		};
	}

	if ( !Con_IsOpen() ) {
		return menu;
	}

	const layout = SCR_MenuVirtualLayout();

	// 0x403de0: screen safe bounds inset by 4 virtual pixels. Console glyphs
	// are drawn at their native 16 physical pixel size (0x406520), not menu scale.
	const unit = 1 / layout.scale;
	const inset = Math.floor( 4 * layout.scale );
	const left = ( inset - layout.xoffset ) * unit;
	const top = inset * unit;
	const width = ( ( vid.width || window.innerWidth ) - 2 * inset ) * unit;
	const textscale = ( 16 / 48 ) * unit;

	const base = {
		rect_x: left,
		rect_y: top,
		rect_w: width,
		rect_h: 28 * unit,
		textscale,
		textalignx: 6 * unit,
		textaligny: 22 * unit,
		textfont: 5,
		textstyle: 0,
		label: '',
		forecolor: [1, 1, 1, 1] as [number, number, number, number],
		focuscolor: [1, 1, 1, 1] as [number, number, number, number],
	};

	const items = [...( menu?.items ?? [] )];

	if ( Con_IsFull() ) {
		const outputY = top + 32 * unit;
		const outputH = UI_VIRTUAL_HEIGHT - top - outputY;
		const lines = Con_Lines()
			.flatMap( ( line ) => UI_TextLines( line, textscale, width - 40 * unit, vid.height || UI_VIRTUAL_HEIGHT, 5 ) )
			.slice( -Math.floor( ( outputH - 24 * unit ) / ( 16 * unit ) ) );

		items.push( {
			...base,
			rect_y: outputY,
			rect_h: outputH,
			style: 1,
			backcolor: [0.35, 0.35, 0.3, 0.75],
		} );

		items.push(
			...lines.map( ( label, i ) => ( {
				...base,
				label,
				rect_y: outputY + 6 * unit + i * 16 * unit,
				rect_h: 16 * unit,
				textaligny: 16 * unit,
			} ) )
		);
	}

	const prefix = 'CoD2 MP: 1.2> ';
	const maxChars = Math.max( 1, Math.floor( ( width / unit - 12 ) / 8 ) - prefix.length - 1 );

	items.push( {
		...base,
		style: 1,
		backcolor: [0.25, 0.25, 0.2, 1],
		border: 1,
		bordersize: 2 * unit,
		bordercolor: [0.125, 0.125, 0.1, 1],
	} );

	// 0x405a20 uses colorYellow; 0x409b10 draws the editable field in white.
	const matches = Command_Matches( Con_Input() );

	if ( matches.length ) {
		const argumentMatch = Command_ArgumentMatches( Con_Input() );
		const labels = matches.slice( 0, argumentMatch ? 16 : 24 );

		if ( !argumentMatch && matches.length > 24 ) {
			labels.push( `${matches.length} matches; type more to narrow the list` );
		}

		// 0x4065c7 saves the position after the prompt; 0x40668a restores it
		// before 0x405ba0 subtracts the six-pixel box padding.
		// 0x405d60 measures through the command and following whitespace.
		// 0x405f42..0x405f93 places the argument popup at that input column,
		// safeTop + fontHeight + 6, and sizes it to max candidate width + 12.
		const commandPrefix = Con_Input().match( /^\s*\S+\s*/ )?.[0] ?? '';
		const mainHintX = left + prefix.length * 8 * unit;
		const hintY = top + ( argumentMatch ? 22 : 32 ) * unit;
		const hintX = mainHintX + ( argumentMatch ? commandPrefix.length * 8 * unit : 0 );
		const hintWidth = argumentMatch
			? ( Math.max( ...labels.map( ( label ) => label.length ) ) * 8 + 12 ) * unit
			: width - prefix.length * 8 * unit;

		const detail =
			!argumentMatch && matches.length === 1 && !Command_IsCommand( matches[0] )
				? Cvar_Description( matches[0] )
				: undefined;

		if ( argumentMatch ) {
			items.push( {
				...base,
				rect_x: mainHintX,
				rect_w: width - prefix.length * 8 * unit,
				rect_y: top + 32 * unit,
				label: argumentMatch.prefix.trim().split( /\s/ )[0],
				forecolor: [0.8, 0.8, 1, 1],
				style: 1,
				backcolor: [0.4, 0.4, 0.35, 1],
				border: 1,
				bordersize: 2 * unit,
				bordercolor: [0.2, 0.2, 0.175, 1],
			} );
		}

		items.push( {
			...base,
			rect_x: hintX,
			rect_w: hintWidth,
			rect_y: hintY,
			rect_h: ( ( detail ? 2 : labels.length ) * 16 + 12 ) * unit,
			style: 1,
			backcolor: [0.4, 0.4, 0.35, 1],
			border: 1,
			bordersize: 2 * unit,
			bordercolor: [0.2, 0.2, 0.175, 1],
		} );

		if ( detail ) {
			items.push(
				{
					...base,
					rect_x: hintX,
					rect_y: hintY + 16 * unit,
					label: '  default',
				},
				{
					...base,
					rect_x: hintX + 200 * unit,
					rect_y: hintY + 16 * unit,
					label: detail.defaultValue.slice( 0, 40 ),
				}
			);

			const lines = detail.domain;
			const domainY = hintY + 48 * unit;

			items.push( {
				...base,
				rect_x: hintX,
				rect_y: domainY,
				rect_w: hintWidth,
				rect_h: ( lines.length * 16 + 12 ) * unit,
				style: 1,
				backcolor: [0.4, 0.4, 0.35, 1],
				border: 1,
				bordersize: 2 * unit,
				bordercolor: [0.2, 0.2, 0.175, 1],
			} );

			items.push(
				...lines.map( ( label, i ) => ( {
					...base,
					rect_x: hintX,
					rect_y: domainY + i * 16 * unit,
					rect_w: hintWidth,
					label,
				} ) )
			);
		}

		items.push(
			...labels.map( ( label, i ) => ( {
				...base,
				rect_x: hintX,
				rect_w: hintWidth,
				rect_y: hintY + i * 16 * unit,
				rect_h: 16 * unit,
				label: argumentMatch ? label : label.slice( 0, 24 ),
				forecolor: ( argumentMatch || Command_IsCommand( label )
					? [0.8, 0.8, 1, 1]
					: [1, 1, 0.8, 1] ) as [number, number, number, number],
			} ) )
		);

		// Native 0x405c70 draws names (24 chars) and current values (40 chars)
		// in separate columns, with a 200 physical pixel offset at 0x5c4138.
		for ( let i = 0; !argumentMatch && i < Math.min( matches.length, 24 ); i++ ) {
			const name = matches[i];

			if ( Cvar_Has( name ) ) {
				items.push( {
					...base,
					rect_x: hintX + 200 * unit,
					rect_w: Math.max( 0, hintWidth - 200 * unit ),
					rect_y: hintY + i * 16 * unit,
					rect_h: 16 * unit,
					label: Cvar_Get( name ).slice( 0, 40 ),
				} );
			}
		}
	}

	// Keep the editable line in the foreground. The native argument panel
	// starts at the input baseline (0x405f52..0x405f68); console glyph ink can
	// extend below it (underscore mt=-1, ph=2). Sequential menu compositing
	// must not let that panel erase the input's descenders or blinking cursor.
	items.push( {
		...base,
		label: prefix,
		forecolor: [1, 1, 0, 1],
	} );

	items.push( {
		...base,
		textalignx: ( 6 + prefix.length * 8 ) * unit,
		label:
			Con_Input().slice( -maxChars ) +
			( Math.trunc( performance.now() / 256 ) % 2 ? '' : '_' ),
	} );

	return {
		items,
		blur_world: menu?.blur_world,
		focus_idx: -1,
		cursor_vx: 0,
		cursor_vy: 0,
		hide_cursor: true,
		console_only: !menu || menu.console_only,
	};
}
