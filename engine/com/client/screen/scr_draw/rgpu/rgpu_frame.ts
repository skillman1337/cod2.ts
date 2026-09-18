/*
===============================================================================

	rgpu_frame.ts

	Sole owner of command encoders, render-pass lifetime, and queue submission.
	Draw children receive only a frame-local GPURenderPassEncoder.

===============================================================================
*/


// ---------------------------------------------------------------------------
// capability contract
// ---------------------------------------------------------------------------


export interface rgpu_frame_commands_t {
	createCommandEncoder( descriptor: GPUCommandEncoderDescriptor ): GPUCommandEncoder;
	submit( command_buffers: readonly GPUCommandBuffer[] ): void;
}

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const RGPU_FRAME_CLEAR_COLOR: GPUColor = { r: 0.05, g: 0.05, b: 0.08, a: 1.0 };
export const RGPU_FRAME_FAIL_COLOR: GPUColor = { r: 0.12, g: 0.04, b: 0.04, a: 1.0 };


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

let rgpu_frame_encoder: GPUCommandEncoder | null = null;
let rgpu_frame_pass: GPURenderPassEncoder | null = null;
let rgpu_frame_view: GPUTextureView | null = null;


// ---------------------------------------------------------------------------
// forward
// RGPU_FrameAttachment
// ---------------------------------------------------------------------------


/**
 * ================
 * RGPU_FrameAttachment
 * ================
 */
function RGPU_FrameAttachment( view: GPUTextureView, clear_value: GPUColor ): GPURenderPassColorAttachment {
	return {
		view,
		clearValue: clear_value,
		loadOp: 'clear',
		storeOp: 'store',
	};
}


/**
 * @exec per-frame
 * ================
 * RGPU_FrameBegin
 * ================
 */
export function RGPU_FrameBegin(
	commands: rgpu_frame_commands_t,
	view: GPUTextureView,
	clear_value: GPUColor,
	depth: GPUTextureView | null = null
): GPURenderPassEncoder | null {
	let attachment: GPURenderPassColorAttachment;

	RGPU_FrameAbort();
	attachment = RGPU_FrameAttachment( view, clear_value );
	rgpu_frame_view = view;

	try {
		rgpu_frame_encoder = commands.createCommandEncoder( { label: 'rgpu_frame_encoder' } );
		rgpu_frame_pass = rgpu_frame_encoder.beginRenderPass( {
			label: 'rgpu_frame_pass',
			colorAttachments: [attachment],
			...( depth
				? {
						depthStencilAttachment: {
							view: depth,
							depthClearValue: 1,
							depthLoadOp: 'clear' as const,
							depthStoreOp: 'store' as const,
						},
					}
				: {} ),
		} );
		return rgpu_frame_pass;
	} catch {
		rgpu_frame_encoder = null;
		rgpu_frame_pass = null;
		return null;
	}
}


/**
 * @exec per-frame
 * ================
 * RGPU_FramePass
 * ================
 */
export function RGPU_FramePass(): GPURenderPassEncoder | null {
	return rgpu_frame_pass;
}

/**
 * @exec helper
 * ================
 * RGPU_FrameOverlay
 *
 * End world depth testing before drawing screen-space menus.
 * ================
 */
export function RGPU_FrameOverlay( target: GPUTextureView | null = null ): GPURenderPassEncoder | null {
	if ( !rgpu_frame_encoder || !rgpu_frame_pass || !rgpu_frame_view ) {
		return null;
	}

	if ( target ) {
		rgpu_frame_view = target;
	}

	rgpu_frame_pass.end();
	rgpu_frame_pass = rgpu_frame_encoder.beginRenderPass( {
		label: 'cod2_ui_pass',
		colorAttachments: [
			{
				view: rgpu_frame_view,
				loadOp: 'load',
				storeOp: 'store',
			},
		],
	} );

	return rgpu_frame_pass;
}


/**
 * @exec per-frame
 * ================
 * RGPU_FrameEnd
 * ================
 */
export function RGPU_FrameEnd( commands: rgpu_frame_commands_t ): boolean {
	let encoder: GPUCommandEncoder | null;
	let pass: GPURenderPassEncoder | null;
	let command: GPUCommandBuffer;

	encoder = rgpu_frame_encoder;
	pass = rgpu_frame_pass;
	rgpu_frame_encoder = null;
	rgpu_frame_pass = null;

	if ( !encoder || !pass )
		return false;

	try {
		pass.end();
		command = encoder.finish();
		commands.submit( [ command ] );
		return true;
	} catch {
		return false;
	}
}


/**
 * @exec init-once
 * ================
 * RGPU_FrameAbort
 *
 * End any open pass but deliberately discard the unfinished command encoder.
 * ================
 */
export function RGPU_FrameAbort(): void {
	let pass: GPURenderPassEncoder | null;

	pass = rgpu_frame_pass;
	rgpu_frame_pass = null;
	rgpu_frame_encoder = null;

	if ( !pass )
		return;

	try {
		pass.end();
	} catch {
		// Pass may already be invalid after device loss.
	}
}
