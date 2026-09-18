/*
===============================================================================

	ui_controls.ts

	Call of Duty 2 / id Tech UI Control Geometry
	Dimensions and interactive geometry for listboxes, sliders, and focus effects.
	Reconstructed from retail client routines at 0x540750, 0x5c42ec, and 0x5407a3.

===============================================================================
*/


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** Retail slider geometry: 0x540750, constants at 0x5c42ec and 0x5c4058. */
export const UI_SLIDER_WIDTH = 96;
export const UI_SLIDER_HEIGHT = 16;
export const UI_SLIDER_TRAVEL = 84;
export const UI_SLIDER_INSET = 6;
export const UI_SLIDER_THUMB_WIDTH = 10;
export const UI_SLIDER_THUMB_HEIGHT = 20;


// ---------------------------------------------------------------------------
// scrollbar & slider calculations
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * UI_ListScroll
 *
 * Computes vertical listbox scrolling state, thumb coordinate, and travel bounds.
 * Retail engine uses fixed 16-pixel scroll arrows and scroll thumb.
 * ================
 */
export function UI_ListScroll(
	height: number,
	rowHeight: number,
	total: number,
	start: number
): {
	page: number;
	max: number;
	start: number;
	travel: number;
	thumb: number;
} {
	const page = Math.max( 1, Math.floor( height / rowHeight ) );
	const max = Math.max( 0, total - page );
	const clamped = Math.max( 0, Math.min( max, start ) );
	const travel = Math.max( 0, height - 50 );
	const thumb = 17 + ( max ? ( clamped / max ) * travel : 0 );

	return {
		page,
		max,
		start: clamped,
		travel,
		thumb,
	};
}

/**
 * @exec helper
 * ================
 * UI_SliderFraction
 *
 * Maps mouse pointer horizontal coordinate relative to slider start into normalized [0, 1] range.
 * ================
 */
export function UI_SliderFraction( pointer: number, start: number ): number {
	const offset = pointer - start - UI_SLIDER_INSET;
	return Math.max( 0, Math.min( 1, offset / UI_SLIDER_TRAVEL ) );
}

/**
 * @exec helper
 * ================
 * UI_FocusPulse
 *
 * Pulsing focus brightness oscillation from 0x5407a3..0x540821.
 * Evaluates sine wave modulation using integer milliseconds divided by 75.
 * ================
 */
export function UI_FocusPulse(
	color: [number, number, number, number],
	milliseconds: number
): [number, number, number, number] {
	const t = ( Math.sin( Math.trunc( milliseconds / 75 ) ) + 1 ) * 0.5;

	return color.map( ( channel ) => channel * ( 1 - 0.2 * t ) ) as [number, number, number, number];
}
