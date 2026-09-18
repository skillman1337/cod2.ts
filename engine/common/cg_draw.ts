/*
===============================================================================

	cg_draw.ts

	Call of Duty 2 / id Tech Client-Game 2D Drawing System
	cgame_mp/cg_draw_mp.cpp replication:
	  - CG_CalculateFPS (0x1cd76e / 0x4c6f50)
	  - CG_DrawFPS (0x1cf6f6 / 0x4c6fb0)
	  - CG_DrawMantleHint (0x4c5fe0)
	  - CG_Draw2D (0x1d114a / 0x4c76a0)
	  - Native 2D render stubs

===============================================================================
*/

import strings from '@/assets/ui/strings.json';
import { Cvar_Get } from './cvar.js';
import { HUD_Items, type hud_state_t } from './hud.js';
import type { pm_movement_t, rgpu_menu_item_t } from './types.js';
import { UI_TextLineHeight, UI_TextWidth } from './ui_text.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const SCREEN_VIRTUAL_WIDTH  = 640;
export const SCREEN_VIRTUAL_HEIGHT = 480;
export const FPS_SAMPLE_COUNT      = 32;

export const CG_FPS_OFF     = 0;
export const CG_FPS_SIMPLE  = 1;
export const CG_FPS_VERBOSE = 2;
export const CG_FPS_TIME    = 3;


// ---------------------------------------------------------------------------
// types & globals
// ---------------------------------------------------------------------------

const fps_previousTimes: number[] = new Array( FPS_SAMPLE_COUNT ).fill( 0 );
let fps_index = 0;
let fps_previousTime = 0;
let fps_initialized = false;

export interface cg_fps_stats_t {
	avgFps: number;
	fpsMin: number;
	fpsMax: number;
	variance: number;
	avgDelta: number;
	minTime: number;
	maxTime: number;
}


// ---------------------------------------------------------------------------
// fps statistics & calculation
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * CG_CalculateFPS
 *
 * 0x1cd76e / 0x4c6f50: CG_CalculateFPS
 * Called once per client frame (from CL_RunOncePerClientFrame / CL_RunActiveFrame).
 * Maintains a rolling 32-sample circular buffer of frame delta times.
 * ================
 */
export function CG_CalculateFPS( now_ms?: number ): void {
	const now = now_ms ?? ( typeof performance !== 'undefined' ? performance.now() : Date.now() );

	if ( !fps_initialized ) {
		fps_previousTime = now;
		fps_initialized = true;
		return;
	}

	const delta = Math.max( 1, Math.round( now - fps_previousTime ) );
	fps_previousTime = now;
	fps_previousTimes[fps_index & ( FPS_SAMPLE_COUNT - 1 )] = delta;
	fps_index++;
}

/**
 * @exec helper
 * ================
 * CG_GetFpsStats
 *
 * Computes rolling statistics matching native 0x4c6fb0.
 * Supports early display on frames 1..31 before full 32-sample saturation.
 * ================
 */
export function CG_GetFpsStats(): cg_fps_stats_t | null {
	if ( fps_index < 1 ) {
		return null;
	}

	const count = Math.min( fps_index, FPS_SAMPLE_COUNT );
	let total = 0;
	let minTime = 0x7fffffff;
	let maxTime = 0;

	for ( let i = 0; i < count; i++ ) {
		const t = fps_previousTimes[i];
		total += t;

		if ( t < minTime ) {
			minTime = t;
		}

		if ( t > maxTime ) {
			maxTime = t;
		}
	}

	if ( total <= 0 ) {
		total = 1;
	}

	if ( minTime <= 0 ) {
		minTime = 1;
	}

	const invCount = 1 / count;
	const avgDelta = total * invCount;
	let sumDiff = 0;

	for ( let i = 0; i < count; i++ ) {
		sumDiff += Math.abs( fps_previousTimes[i] - avgDelta );
	}

	const variance = Math.round( sumDiff * invCount );
	const fpsMin = Math.round( 1000 / maxTime );
	const fpsMax = Math.round( 1000 / minTime );
	const avgFps = Math.round( ( count * 1000 ) / total );

	return { avgFps, fpsMin, fpsMax, variance, avgDelta, minTime, maxTime };
}

/**
 * @exec helper
 * ================
 * CG_GetFpsMode
 *
 * Resolves active cg_drawFPS enum/integer mode.
 * 0: Off, 1: Simple, 2: Verbose, 3: Time.
 * ================
 */
export function CG_GetFpsMode(): number {
	const raw = Cvar_Get( 'cg_drawFPS' ).trim().toLowerCase();

	if ( raw === '1' || raw === 'simple' ) {
		return CG_FPS_SIMPLE;
	}

	if ( raw === '2' || raw === 'verbose' ) {
		return CG_FPS_VERBOSE;
	}

	if ( raw === '3' || raw === 'time' ) {
		return CG_FPS_TIME;
	}

	return CG_FPS_OFF;
}

/**
 * @exec helper
 * ================
 * CG_GetFpsString
 *
 * Formats the exact native string for the active FPS mode.
 * ================
 */
export function CG_GetFpsString( mode?: number ): string | null {
	const activeMode = mode ?? CG_GetFpsMode();

	if ( activeMode === CG_FPS_OFF ) {
		return null;
	}

	const stats = CG_GetFpsStats();

	if ( !stats ) {
		return null;
	}

	if ( activeMode <= CG_FPS_VERBOSE ) {
		return `${stats.avgFps}fps(${stats.fpsMin}-${stats.fpsMax},${stats.variance})`;
	}

	return `${stats.avgDelta.toFixed( 2 )}mspf(${stats.minTime}-${stats.maxTime})`;
}


// ---------------------------------------------------------------------------
// 2d drawing elements
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * CG_DrawFPS
 *
 * 0x1cf6f6 / 0x4c6fb0: CG_DrawFPS
 * Draws FPS counter at top-right of screen and advances vertical offset y.
 * Uses native 16 physical-pixel dev/console font (0x406520 / 0x1a1a7e)
 * with 1:1 pixel scaling and style 0 (no shadow) for sharp rendering.
 * ================
 */
export function CG_DrawFPS(
	y: number,
	screenWidth: number = SCREEN_VIRTUAL_WIDTH,
	screenHeight: number = SCREEN_VIRTUAL_HEIGHT
): { y: number; item: rgpu_menu_item_t | null } {
	const mode = CG_GetFpsMode();

	if ( mode === CG_FPS_OFF ) {
		return { y, item: null };
	}

	const str = CG_GetFpsString( mode );

	if ( !str ) {
		return { y, item: null };
	}

	const unit = SCREEN_VIRTUAL_HEIGHT / ( screenHeight || SCREEN_VIRTUAL_HEIGHT );
	const scale = ( 16 / 48 ) * unit;
	const font = 5;
	const width = UI_TextWidth( str, scale, screenHeight, font );
	const lineHeight = 16 * unit;

	const item: rgpu_menu_item_t = {
		label: str,
		rect_x: -( width + 8 * unit ),
		rect_y: y,
		rect_w: width,
		rect_h: lineHeight,
		horz_align: 3,
		vert_align: 0,
		textscale: scale,
		textfont: font,
		textstyle: 0,
		textalignx: 0,
		textaligny: lineHeight,
		forecolor: [1, 1, 1, 1],
		focuscolor: [1, 1, 1, 1],
	};

	return { y: y + lineHeight + 2 * unit, item };
}

/**
 * @exec helper
 * ================
 * CG_DrawMantleHint
 *
 * 0x4c5fe0: CG_DrawMantleHint
 * Draws centered platform mantle prompt plus hint icon.
 * ================
 */
export function CG_DrawMantleHint(
	movement?: pm_movement_t,
	height: number = SCREEN_VIRTUAL_HEIGHT
): rgpu_menu_item_t[] {
	if ( !movement?.mantle || movement.mantle.active || Cvar_Get( 'cg_drawMantleHint' ) === '0' ) {
		return [];
	}

	const label = strings.PLATFORM_MANTLE.replace( '&&1', 'Space' );
	const width = UI_TextWidth( label, 0.21, height, 0 );
	const x = -( width + 40 ) / 2;

	const base: rgpu_menu_item_t = {
		rect_x: x,
		rect_y: 130,
		rect_w: width,
		rect_h: 40,
		horz_align: 2,
		vert_align: 2,
		textscale: 0.21,
		textfont: 0,
		textstyle: 3,
		textalignx: 0,
		textaligny: 4,
		label,
		forecolor: [1, 1, 1, 1],
		focuscolor: [1, 1, 1, 1],
	};

	return [
		base,
		{
			...base,
			label: '',
			rect_x: x + width,
			rect_y: 110,
			rect_w: 40,
			background: 'hint_mantle',
			style: 3,
		},
	];
}


// ---------------------------------------------------------------------------
// native 2d render stubs
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * CG_DrawSnapshot
 *
 * 0x4c6ef0: CG_DrawSnapshot (lagometer stub).
 * ================
 */
export function CG_DrawSnapshot( y: number ): number {
	return y;
}

/**
 * @exec helper
 * ================
 * CG_DrawCrosshair
 *
 * 0x1d0784: CG_DrawCrosshair (stub).
 * ================
 */
export function CG_DrawCrosshair(): rgpu_menu_item_t[] {
	return [];
}

/**
 * @exec helper
 * ================
 * CG_DrawCrosshairNames
 *
 * 0x1cddb4: CG_DrawCrosshairNames (stub).
 * ================
 */
export function CG_DrawCrosshairNames(): rgpu_menu_item_t[] {
	return [];
}

/**
 * @exec helper
 * ================
 * CG_DrawChatMessages
 *
 * 0x1cf0d0: CG_DrawChatMessages (stub).
 * ================
 */
export function CG_DrawChatMessages(): rgpu_menu_item_t[] {
	return [];
}

/**
 * @exec helper
 * ================
 * CG_DrawBoldGameMessages
 *
 * 0x1cfe56: CG_DrawBoldGameMessages (stub).
 * ================
 */
export function CG_DrawBoldGameMessages(): rgpu_menu_item_t[] {
	return [];
}

/**
 * @exec helper
 * ================
 * CG_DrawScoreboard
 *
 * 0x1c6e30: CG_DrawScoreboard (stub).
 * ================
 */
export function CG_DrawScoreboard(): rgpu_menu_item_t[] {
	return [];
}

/**
 * @exec helper
 * ================
 * CG_DrawDisconnect
 *
 * 0x1cd848: CG_DrawDisconnect (stub).
 * ================
 */
export function CG_DrawDisconnect(): rgpu_menu_item_t[] {
	return [];
}

/**
 * @exec helper
 * ================
 * CG_DrawSoundOverlay
 *
 * 0x1ce7b8: CG_DrawSoundOverlay (stub).
 * ================
 */
export function CG_DrawSoundOverlay(): rgpu_menu_item_t[] {
	return [];
}

/**
 * @exec helper
 * ================
 * CG_DrawMaterial
 *
 * 0x1ce996: CG_DrawMaterial (stub).
 * ================
 */
export function CG_DrawMaterial(): rgpu_menu_item_t[] {
	return [];
}

/**
 * @exec helper
 * ================
 * CG_DrawScriptUsage
 *
 * 0x1cd672: CG_DrawScriptUsage (stub).
 * ================
 */
export function CG_DrawScriptUsage(): rgpu_menu_item_t[] {
	return [];
}

/**
 * @exec helper
 * ================
 * CG_DrawTurretCrossHair
 *
 * 0x1cf59c: CG_DrawTurretCrossHair (stub).
 * ================
 */
export function CG_DrawTurretCrossHair(): rgpu_menu_item_t[] {
	return [];
}

/**
 * @exec helper
 * ================
 * CG_DrawSpectatorMessage
 *
 * 0x1cfeba: CG_DrawSpectatorMessage (stub).
 * ================
 */
export function CG_DrawSpectatorMessage(): rgpu_menu_item_t[] {
	return [];
}

/**
 * @exec helper
 * ================
 * CG_DrawFollow
 *
 * 0x1ced8a: CG_DrawFollow (stub).
 * ================
 */
export function CG_DrawFollow(): rgpu_menu_item_t[] {
	return [];
}


// ---------------------------------------------------------------------------
// master 2d render dispatcher
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * CG_Draw2D
 *
 * 0x1d114a / 0x4c76a0: CG_Draw2D
 * Master 2D drawing routine for active client frame.
 * Dispatches lagometer, FPS counter, 2D HUD (ammo, stance), and mantle hints.
 * ================
 */
export function CG_Draw2D(
	state: hud_state_t,
	movement?: pm_movement_t,
	height: number = SCREEN_VIRTUAL_HEIGHT,
	width: number = SCREEN_VIRTUAL_WIDTH
): rgpu_menu_item_t[] {
	const items: rgpu_menu_item_t[] = [];
	let y = 2;

	// 1. Snapshot / Lagometer
	y = CG_DrawSnapshot( y );

	// 2. FPS display (gated on cg_drawFPS)
	const fps = CG_DrawFPS( y, width, height );

	if ( fps.item ) {
		items.push( fps.item );
		y = fps.y;
	}

	// 3. 2D HUD elements (ammo, stance, health)
	if ( Cvar_Get( 'cg_draw2D' ) !== '0' ) {
		if ( movement ) {
			items.push( ...HUD_Items( state, movement, height ) );
		}

		// 4. Mantle Hint
		items.push( ...CG_DrawMantleHint( movement, height ) );

		// 5. Stubs for future porting
		items.push( ...CG_DrawCrosshair() );
		items.push( ...CG_DrawCrosshairNames() );
		items.push( ...CG_DrawChatMessages() );
		items.push( ...CG_DrawBoldGameMessages() );
		items.push( ...CG_DrawScoreboard() );
		items.push( ...CG_DrawTurretCrossHair() );
		items.push( ...CG_DrawSpectatorMessage() );
		items.push( ...CG_DrawSoundOverlay() );
		items.push( ...CG_DrawDisconnect() );
		items.push( ...CG_DrawMaterial() );
		items.push( ...CG_DrawScriptUsage() );
	}

	return items;
}
