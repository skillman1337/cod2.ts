/*
===============================================================================

	vid.ts

	Video globals: canvas binding and backbuffer dimensions.

===============================================================================
*/


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface vid_t {
	canvas: HTMLCanvasElement | null;
	width: number;
	height: number;
	dpr: number;
	valid: boolean;
}

interface vid_layout_size_t {
	width: number;
	height: number;
	dpr: number;
}


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

export const vid: vid_t = {
	canvas: null,
	width: 0,
	height: 0,
	dpr: 1,
	valid: false,
};


// ---------------------------------------------------------------------------
// forward
// VID_ReadLayoutRect, VID_IsCollapsedRect
// VID_StompCanvasBackingStore, VID_InvalidateAndReportChange
// VID_SizeMatchesVid, VID_ScaleLayoutPixels, VID_LayoutSize
// VID_ApplySize, VID_Invalidate
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// video
// ---------------------------------------------------------------------------

/**
 * @exec init-once
 * ================
 * VID_Init
 *
 * Clear video state.  Canvas is bound later via VID_SetCanvas.
 * ================
 */
export function VID_Init(): void {
	vid.canvas = null;
	vid.width = 0;
	vid.height = 0;
	vid.dpr = 1;
	vid.valid = false;
}


/**
 * ================
 * VID_IsValid
 *
 * True once CSS layout has produced a real backing store size.
 * GPU configure and draw must not run until this is set.
 * ================
 */
export function VID_IsValid(): boolean {
	return vid.valid;
}


/**
 * @exec init-once
 * ================
 * VID_ApplyHostLayout
 *
 * Canvas-only HTML host: size #game from JS (no stylesheet).
 * ================
 */
function VID_ApplyHostLayout( canvas: HTMLCanvasElement ): void {
	document.documentElement.style.margin = '0';
	document.documentElement.style.height = '100%';
	document.body.style.margin = '0';
	document.body.style.height = '100%';
	document.body.style.overflow = 'hidden';

	canvas.style.display = 'block';
	canvas.style.width = '100vw';
	canvas.style.height = '100vh';
}


/**
 * @exec init-once
 * ================
 * VID_SetCanvas
 *
 * Bind host canvas and sync initial backbuffer size.
 * Returns true if backing store dimensions changed.
 * ================
 */
export function VID_SetCanvas( canvas: HTMLCanvasElement ): boolean {
	vid.canvas = canvas;
	VID_ApplyHostLayout( canvas );

	VID_Invalidate();

	return VID_CheckResize();
}


/**
 * ================
 * VID_Invalidate
 *
 * Layout gone or canvas unbound.  Clear vid size and stomp backing store
 * so stale dimensions cannot leak into draw or configure paths.
 * ================
 */
function VID_Invalidate(): void {
	vid.valid = false;
	vid.width = 0;
	vid.height = 0;
	vid.dpr = 1;

	VID_StompCanvasBackingStore();
}


/**
 * @exec per-frame
 * ================
 * VID_CheckResize
 *
 * Match canvas backing store to CSS layout size scaled by devicePixelRatio.
 * Called each frame from the host loop.
 *
 * Returns true when the host must notify the GPU: backing store changed or
 * we transitioned from valid layout to invalid (hidden/collapsed canvas).
 * ================
 */
export function VID_CheckResize(): boolean {
	let size: vid_layout_size_t | null;

	if ( !vid.canvas )
		return VID_InvalidateAndReportChange();

	size = VID_LayoutSize();
	if ( size === null )
		return VID_InvalidateAndReportChange();

	if ( VID_SizeMatchesVid( size.width, size.height, size.dpr ) )
		return false;

	VID_ApplySize( size.width, size.height, size.dpr );
	return true;
}


/**
 * ================
 * VID_StompCanvasBackingStore
 *
 * Force canvas backing store to 1x1 when layout is invalid.
 * ================
 */
function VID_StompCanvasBackingStore(): void {
	let style_w: string;
	let style_h: string;

	if ( !vid.canvas )
		return;

	style_w = vid.canvas.style.width;
	style_h = vid.canvas.style.height;
	vid.canvas.width = 1;
	vid.canvas.height = 1;
	if ( style_w )
		vid.canvas.style.width = style_w;

	if ( style_h )
		vid.canvas.style.height = style_h;
}


/**
 * @exec per-frame
 * ================
 * VID_InvalidateAndReportChange
 *
 * Invalidate vid state.  Return true if we had valid dimensions before.
 * ================
 */
function VID_InvalidateAndReportChange(): boolean {
	let was_valid: boolean;

	was_valid = vid.valid;
	VID_Invalidate();
	return was_valid;
}


/**
 * @exec per-frame
 * ================
 * VID_SizeMatchesVid
 *
 * True when layout pixels match committed vid backing store.
 * ================
 */
function VID_SizeMatchesVid( width: number, height: number, dpr: number ): boolean {
	return vid.valid && width === vid.width && height === vid.height && dpr === vid.dpr;
}


/**
 * @exec per-frame
 * ================
 * VID_ScaleLayoutPixels
 *
 * Convert CSS layout rect to device-pixel backing store size.
 * ================
 */
function VID_ScaleLayoutPixels( css_width: number, css_height: number ): vid_layout_size_t {
	let dpr: number;
	let width: number;
	let height: number;

	dpr = window.devicePixelRatio || 1;
	width = Math.max( 1, Math.floor( css_width * dpr ) );
	height = Math.max( 1, Math.floor( css_height * dpr ) );

	return { width, height, dpr };
}


/**
 * @exec per-frame
 * ================
 * VID_ReadLayoutRect
 *
 * Canvas CSS layout rect, or null when canvas is unbound.
 * ================
 */
function VID_ReadLayoutRect(): DOMRect | null {
	if ( !vid.canvas )
		return null;

	return vid.canvas.getBoundingClientRect();
}


/**
 * @exec per-frame
 * ================
 * VID_IsCollapsedRect
 *
 * True when layout width or height is below one CSS pixel.
 * ================
 */
function VID_IsCollapsedRect( rect: DOMRect ): boolean {
	return rect.width < 1 || rect.height < 1;
}


/**
 * @exec per-frame
 * ================
 * VID_LayoutSize
 *
 * Read CSS layout rect scaled by devicePixelRatio.
 * Returns null when the canvas is hidden or collapsed.
 * ================
 */
function VID_LayoutSize(): vid_layout_size_t | null {
	let rect: DOMRect | null;
	let css_w: number;
	let css_h: number;

	rect = VID_ReadLayoutRect();
	if ( rect === null )
		return null;

	css_w = rect.width;
	css_h = rect.height;
	if ( css_w < 2 || css_h < 2 ) {
		css_w = window.innerWidth;
		css_h = window.innerHeight;
	}

	if ( VID_IsCollapsedRect( new DOMRect( 0, 0, css_w, css_h ) ) )
		return null;

	return VID_ScaleLayoutPixels( css_w, css_h );
}


/**
 * @exec per-frame
 * ================
 * VID_ApplySize
 *
 * Commit backing store dimensions to vid globals and the canvas element.
 * ================
 */
function VID_ApplySize( width: number, height: number, dpr: number ): void {
	if ( !vid.canvas )
		return;

	vid.valid = true;
	vid.width = width;
	vid.height = height;
	vid.dpr = dpr;
	vid.canvas.width = width;
	vid.canvas.height = height;
}



