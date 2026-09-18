/*
===============================================================================

	rgpu_surface.ts

	Owns GPUCanvasContext acquisition, configuration, resize state, and texture-view
	acquisition. Raw canvas context never leaves this module.

===============================================================================
*/

import { VID_IsValid } from '@/engine/common/vid.js';


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

let rgpu_surface_context: GPUCanvasContext | null = null;
let rgpu_surface_configured = false;
let rgpu_surface_resize_pending = false;


// ---------------------------------------------------------------------------
// forward
// RGPU_SurfaceLayoutValid, RGPU_SurfaceTryConfigure
// ---------------------------------------------------------------------------


/**
 * ================
 * RGPU_SurfaceLayoutValid
 * ================
 */
function RGPU_SurfaceLayoutValid( width: number, height: number ): boolean {
	return width >= 1 && height >= 1 && VID_IsValid();
}


/**
 * ================
 * RGPU_SurfaceTryConfigure
 * ================
 */
function RGPU_SurfaceTryConfigure( device: GPUDevice, format: GPUTextureFormat ): boolean {
	if ( !rgpu_surface_context )
		return false;

	try {
		rgpu_surface_context.configure( {
			device,
			format,
			alphaMode: 'opaque',
		} );
		return true;
	} catch {
		return false;
	}
}


/**
 * @exec init-once
 * ================
 * RGPU_SurfaceClaim
 * ================
 */
export function RGPU_SurfaceClaim( canvas: HTMLCanvasElement | null ): boolean {
	if ( rgpu_surface_context )
		return true;
	if ( !canvas )
		return false;

	rgpu_surface_context = canvas.getContext( 'webgpu' ) as GPUCanvasContext | null;
	return rgpu_surface_context !== null;
}


/**
 * @exec init-once
 * ================
 * RGPU_SurfaceReset
 * ================
 */
export function RGPU_SurfaceReset(): void {
	if ( rgpu_surface_context ) {
		try {
			rgpu_surface_context.unconfigure();
		} catch {
			// Context may already be invalid after device loss.
		}
	}

	rgpu_surface_context = null;
	rgpu_surface_configured = false;
	rgpu_surface_resize_pending = false;
}


/**
 * @exec per-frame
 * ================
 * RGPU_SurfaceConfigure
 * ================
 */
export function RGPU_SurfaceConfigure(
	device: GPUDevice,
	format: GPUTextureFormat,
	width: number,
	height: number,
): boolean {
	if ( !rgpu_surface_context || !RGPU_SurfaceLayoutValid( width, height ) ) {
		rgpu_surface_configured = false;
		rgpu_surface_resize_pending = true;
		return false;
	}

	rgpu_surface_configured = RGPU_SurfaceTryConfigure( device, format );
	rgpu_surface_resize_pending = !rgpu_surface_configured;
	return rgpu_surface_configured;
}


/**
 * @exec per-frame
 * ================
 * RGPU_SurfaceMarkResize
 * ================
 */
export function RGPU_SurfaceMarkResize( width: number, height: number ): void {
	rgpu_surface_resize_pending = true;
	if ( !RGPU_SurfaceLayoutValid( width, height ) )
		rgpu_surface_configured = false;
}


/**
 * @exec per-frame
 * ================
 * RGPU_SurfaceApplyPendingResize
 * ================
 */
export function RGPU_SurfaceApplyPendingResize(
	device: GPUDevice,
	format: GPUTextureFormat,
	width: number,
	height: number,
): boolean {
	if ( !rgpu_surface_resize_pending )
		return rgpu_surface_configured;

	return RGPU_SurfaceConfigure( device, format, width, height );
}


/**
 * ================
 * RGPU_SurfaceHasContext
 * ================
 */
export function RGPU_SurfaceHasContext(): boolean {
	return rgpu_surface_context !== null;
}


/**
 * ================
 * RGPU_SurfaceHasSwapchain
 * ================
 */
export function RGPU_SurfaceHasSwapchain(): boolean {
	return rgpu_surface_context !== null && rgpu_surface_configured;
}


/**
 * @exec per-frame
 * ================
 * RGPU_SurfaceAcquireView
 *
 * The surface owner attenuates GPUCanvasContext to a single frame-local view.
 * ================
 */
export function RGPU_SurfaceAcquireView(): GPUTextureView | null {
	if ( !rgpu_surface_context || !rgpu_surface_configured )
		return null;

	try {
		return rgpu_surface_context.getCurrentTexture().createView();
	} catch {
		rgpu_surface_configured = false;
		rgpu_surface_resize_pending = true;
		return null;
	}
}
