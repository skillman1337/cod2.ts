/*
===============================================================================

	ui_layout.ts

	Branch-neutral 640x480 menu placement rules shared by UI and renderer.

===============================================================================
*/


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const UI_VIRTUAL_WIDTH = 640;
export const UI_VIRTUAL_HEIGHT = 480;

/** ui/menudefinition.h — default SUBLEFT/SUBTOP virtual placement. */
export const UI_HORZ_ALIGN_SUBLEFT = 0;
export const UI_HORZ_ALIGN_FULLSCREEN = 4;
export const UI_VERT_ALIGN_SUBTOP = 0;
export const UI_VERT_ALIGN_FULLSCREEN = 4;


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface ui_layout_t {
	scale: number;
	xoffset: number;
	ui_w: number;
	ui_h: number;
}


export interface ui_placed_rect_t {
	x: number;
	y: number;
	w: number;
	h: number;
}


/**
 * @exec helper
 * ================
 * UI_Layout
 *
 * Scale virtual 640x480 coordinates to canvas height and center horizontally.
 * ================
 */
export function UI_Layout( canvas_w: number, canvas_h: number ): ui_layout_t {
	let scale: number;
	let ui_w: number;
	let ui_h: number;
	let xoffset: number;

	scale = canvas_h / UI_VIRTUAL_HEIGHT;
	ui_w = UI_VIRTUAL_WIDTH * scale;
	ui_h = UI_VIRTUAL_HEIGHT * scale;
	xoffset = ( canvas_w - ui_w ) * 0.5;

	return { scale, xoffset, ui_w, ui_h };
}


/**
 * @exec helper
 * ================
 * UI_PlaceRect
 *
 * Retail ScrPlace-style rect mapping. FULLSCREEN scales against the whole
 * canvas; default alignment letterboxes into virtual 640x480.
 * ================
 */
export function UI_PlaceRect(
	canvas_w: number,
	canvas_h: number,
	vx: number,
	vy: number,
	vw: number,
	vh: number,
	horz_align: number,
	vert_align: number,
	full_bleed = false,
): ui_placed_rect_t {
	let layout: ui_layout_t;
	let x: number;
	let y: number;
	let w: number;
	let h: number;

	layout = UI_Layout( canvas_w, canvas_h );

	if ( horz_align === UI_HORZ_ALIGN_FULLSCREEN ) {
		x = vx * ( canvas_w / UI_VIRTUAL_WIDTH );
		w = vw * ( canvas_w / UI_VIRTUAL_WIDTH );
	} else {
		x = layout.xoffset + vx * layout.scale;
		w = vw * layout.scale;
		// Retail background rectangles overscan both edges of the 640-wide UI.
		// Preserve that coverage when a browser viewport exceeds the authored overscan.
		if ( full_bleed && horz_align === UI_HORZ_ALIGN_SUBLEFT && vx < 0 && vx + vw > UI_VIRTUAL_WIDTH ) {
			const right = Math.max( canvas_w, x + w );
			x = Math.min( 0, x );
			w = right - x;
		}

		if ( horz_align === 1 ) {
			x = vx * layout.scale;
		} else if ( horz_align === 2 || horz_align === 7 ) {
			x = canvas_w * 0.5 + vx * layout.scale;
		} else if ( horz_align === 3 ) {
			x = canvas_w + vx * layout.scale;
		} else if ( horz_align === 5 ) {
			x = vx;
			w = vw;
		} else if ( horz_align === 6 ) {
			x = ( vx * UI_VIRTUAL_WIDTH ) / canvas_w + layout.xoffset;
			w = ( vw * UI_VIRTUAL_WIDTH ) / canvas_w;
		}
	}

	if ( vert_align === UI_VERT_ALIGN_FULLSCREEN ) {
		y = vy * ( canvas_h / UI_VIRTUAL_HEIGHT );
		h = vh * ( canvas_h / UI_VIRTUAL_HEIGHT );
	} else {
		y = vy * layout.scale;
		h = vh * layout.scale;

		if ( vert_align === 2 || vert_align === 7 ) {
			y = canvas_h * 0.5 + vy * layout.scale;
		} else if ( vert_align === 3 ) {
			y = canvas_h + vy * layout.scale;
		} else if ( vert_align === 5 ) {
			y = vy;
			h = vh;
		} else if ( vert_align === 6 ) {
			y = ( vy * UI_VIRTUAL_HEIGHT ) / canvas_h;
			h = ( vh * UI_VIRTUAL_HEIGHT ) / canvas_h;
		}
	}

	return { x, y, w, h };
}
