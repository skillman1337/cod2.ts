/*
===============================================================================

	r_webgpu.ts

	Sole external GPU door. This module owns device epochs and orchestrates its
	init, surface, frame, draw, and menu children. Children receive attenuated
	capabilities; none receives the parent's complete mutable state.

===============================================================================
*/

import { entity_render_t, refdef_t, rgpu_menu_overlay_t } from '@/engine/common/types.js';
import { vid, VID_IsValid } from '@/engine/common/vid.js';
import { Con_Printf } from '@/engine/common/common.js';
import { Loading_Report } from '@/engine/common/loading.js';
import { Cvar_Get } from '@/engine/common/cvar.js';
import { Level_WorldVisible } from '@/engine/common/level.js';
import {
	rgpu_device_epoch_t,
	rgpu_device_poll_state_t,
	RGPU_InitPoll as RGPU_DevicePoll,
	RGPU_InitShutdown as RGPU_DeviceShutdown,
	RGPU_InitStart as RGPU_DeviceStart,
} from './rgpu/rgpu_init.js';
import {
	RGPU_SurfaceAcquireView,
	RGPU_SurfaceApplyPendingResize,
	RGPU_SurfaceClaim,
	RGPU_SurfaceConfigure,
	RGPU_SurfaceHasContext,
	RGPU_SurfaceHasSwapchain,
	RGPU_SurfaceMarkResize,
	RGPU_SurfaceReset,
} from './rgpu/rgpu_surface.js';
import {
	RGPU_FRAME_CLEAR_COLOR,
	RGPU_FRAME_FAIL_COLOR,
	RGPU_FrameAbort,
	RGPU_FrameBegin,
	RGPU_FrameEnd,
	RGPU_FramePass,
	RGPU_FrameOverlay,
} from './rgpu/rgpu_frame.js';
import {
	RGPU_BuildResources,
	RGPU_PrepareLevel,
	RGPU_DrawSceneTarget,
	RGPU_DrawBlurTarget,
	RGPU_DrawBlur,
	RGPU_DrawDepth,
	RGPU_DestroyResources,
	RGPU_DrawEntities,
	RGPU_DrawParticlesImpl,
	RGPU_DrawViewModelImpl,
	RGPU_DrawWorldImpl,
	RGPU_ResourcesReady,
	RGPU_UploadUniforms,
} from './rgpu/rgpu_draw.js';
import {
	RGPU_MenuBuildResources,
	RGPU_MenuCoreResourcesReady,
	RGPU_MenuDestroyResources,
	RGPU_MenuDrawBackground,
	RGPU_MenuLetterboxClear,
	RGPU_MenuResourcesReady,
	RGPU_MenuPresentationReady,
} from './rgpu/rgpu_menu/rgpu_menu.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const RGPU_BLUR_AXIS_HORIZONTAL = 0;
export const RGPU_BLUR_AXIS_VERTICAL = 1;

export const RGPU_MSG_REQUESTING_ADAPTER = 'Requesting WebGPU adapter...';
export const RGPU_MSG_REQUESTING_DEVICE = 'Requesting WebGPU device...';
export const RGPU_MSG_CONFIGURING_SURFACE = 'Configuring swapchain...';
export const RGPU_MSG_BUILDING_RESOURCES = 'Building and validating GPU resources...';
export const RGPU_MSG_INITIALIZING_WEBGPU = 'Initializing WebGPU...';
export const RGPU_MSG_FIRST_MENU_FRAME = 'First complete menu frame submitted';

export const RGPU_ERR_STALE_EPOCH = 'stale device epoch';
export const RGPU_ERR_SYNC_VALIDATION = 'validation operation must be synchronous';
export const RGPU_ERR_FRAME_SUBMIT = 'unable to submit frame';
export const RGPU_ERR_RENDER_PASS_BEGIN = 'unable to begin render pass';
export const RGPU_ERR_LOADING_PASS_BEGIN = 'unable to begin loading render pass';
export const RGPU_ERR_LOADING_FRAME_SUBMIT = 'unable to submit loading frame';


// ---------------------------------------------------------------------------
// types & enumerations
// ---------------------------------------------------------------------------

export const enum rgpu_backend_state_t {
	RGPU_BACKEND_NONE = 0,
	RGPU_BACKEND_REQUEST_ADAPTER,
	RGPU_BACKEND_REQUEST_DEVICE,
	RGPU_BACKEND_CONFIGURE_SURFACE,
	RGPU_BACKEND_BUILD_RESOURCES,
	RGPU_BACKEND_READY,
	RGPU_BACKEND_FAILED,
}

type rgpu_frame_commands_cap_t = Parameters<typeof RGPU_FrameBegin>[0];
type rgpu_draw_resources_cap_t = Parameters<typeof RGPU_BuildResources>[0];
type rgpu_draw_upload_cap_t = Parameters<typeof RGPU_UploadUniforms>[0];
type rgpu_menu_epoch_cap_t = Parameters<typeof RGPU_MenuBuildResources>[0];
type rgpu_menu_upload_cap_t = Parameters<typeof RGPU_MenuDrawBackground>[1];


// ---------------------------------------------------------------------------
// backend state globals
// ---------------------------------------------------------------------------

let rgpu_boot_presented = false;
let rgpu_boot_message = '';
let rgpu_backend_state = rgpu_backend_state_t.RGPU_BACKEND_NONE;
let rgpu_backend_fail_msg = '';
let rgpu_backend_epoch: rgpu_device_epoch_t | null = null;
let rgpu_backend_abort: AbortController | null = null;
let rgpu_backend_frame_commands: rgpu_frame_commands_cap_t | null = null;
let rgpu_backend_draw_resources: rgpu_draw_resources_cap_t | null = null;
let rgpu_backend_draw_upload: rgpu_draw_upload_cap_t | null = null;
let rgpu_backend_menu_epoch: rgpu_menu_epoch_cap_t | null = null;
let rgpu_backend_menu_upload: rgpu_menu_upload_cap_t | null = null;
let rgpu_backend_build_started = false;
let rgpu_backend_build_done = false;
let rgpu_backend_build_error = '';
let rgpu_backend_frame_width = 0;
let rgpu_backend_frame_height = 0;
let rgpu_backend_frame_menu_drawn = false;

let rgpu_console_overlay: rgpu_menu_overlay_t | null = null;
let rgpu_world_overlay: rgpu_menu_overlay_t | null = null;
let rgpu_blur_output: GPUTextureView | null = null;


// ---------------------------------------------------------------------------
// device epoch & error scope validation
// ---------------------------------------------------------------------------

/*
====================
RGPU_EpochIsCurrent

Verifies if an epoch ID and AbortController remain actively authoritative.
====================
*/
function RGPU_EpochIsCurrent( epoch_id: number, controller: AbortController ): boolean {
	return (
		rgpu_backend_epoch?.id === epoch_id &&
		rgpu_backend_abort === controller &&
		!controller.signal.aborted
	);
}

/*
====================
RGPU_RunErrorScopes

Wraps an operation in validation and out-of-memory GPU error scopes.
Always unwinds error scopes in strict LIFO order.
====================
*/
async function RGPU_RunErrorScopes(
	epoch: rgpu_device_epoch_t,
	controller: AbortController,
	label: string,
	operation: () => undefined,
): Promise<string | null> {
	let operation_error: unknown = null;
	let operation_result: unknown = undefined;
	let scope_error: unknown = null;
	let out_of_memory: GPUError | null = null;
	let validation: GPUError | null = null;
	let validation_pushed = false;
	let out_of_memory_pushed = false;

	if ( !RGPU_EpochIsCurrent( epoch.id, controller ) ) {
		return label + ': stale device epoch';
	}

	try {
		epoch.device.pushErrorScope( 'validation' );
		validation_pushed = true;

		epoch.device.pushErrorScope( 'out-of-memory' );
		out_of_memory_pushed = true;

		operation_result = operation();

		if (
			operation_result !== null &&
			( typeof operation_result === 'object' || typeof operation_result === 'function' ) &&
			typeof ( operation_result as { then?: unknown } ).then === 'function'
		) {
			void Promise.resolve( operation_result ).catch( () => undefined );
			operation_error = new Error( 'validation operation must be synchronous' );
		}
	} catch ( error ) {
		operation_error = error;
	}

	// Always unwind every scope we successfully pushed, in strict LIFO order.
	// A failed operation must not poison the device's later validation scopes.
	if ( out_of_memory_pushed ) {
		try {
			out_of_memory = await epoch.device.popErrorScope();
		} catch ( error ) {
			scope_error = error;
		}
	}

	if ( validation_pushed ) {
		try {
			validation = await epoch.device.popErrorScope();
		} catch ( error ) {
			scope_error ??= error;
		}
	}

	if ( !RGPU_EpochIsCurrent( epoch.id, controller ) ) {
		return label + ': stale device epoch';
	}

	if ( scope_error ) {
		return label + ': error-scope failure: ' + String( scope_error );
	}

	if ( operation_error ) {
		return label + ': ' + String( operation_error );
	}

	if ( out_of_memory ) {
		return label + ': ' + out_of_memory.message;
	}

	if ( validation ) {
		return label + ': ' + validation.message;
	}

	return null;
}


// ---------------------------------------------------------------------------
// capability factories
// ---------------------------------------------------------------------------

/*
====================
RGPU_CreateFrameCommands

Produces frame command encoder and queue submission capabilities for rgpu_frame.
====================
*/
function RGPU_CreateFrameCommands( epoch: rgpu_device_epoch_t ): rgpu_frame_commands_cap_t {
	return Object.freeze( {
		createCommandEncoder: ( descriptor: GPUCommandEncoderDescriptor ) => {
			return epoch.device.createCommandEncoder( descriptor );
		},
		submit: ( command_buffers: readonly GPUCommandBuffer[] ) => {
			epoch.queue.submit( command_buffers );
		},
	} );
}

/*
====================
RGPU_CreateDrawResources

Produces pipeline, texture, and buffer creation capabilities for rgpu_draw.
====================
*/
function RGPU_CreateDrawResources( epoch: rgpu_device_epoch_t ): rgpu_draw_resources_cap_t {
	return Object.freeze( {
		createTexture: ( descriptor: GPUTextureDescriptor ) => {
			return epoch.device.createTexture( descriptor );
		},
		createSampler: ( descriptor: GPUSamplerDescriptor ) => {
			return epoch.device.createSampler( descriptor );
		},
		format: epoch.swapchain_format,
		limits: epoch.device.limits,
		createShaderModule: ( descriptor: GPUShaderModuleDescriptor ) => {
			return epoch.device.createShaderModule( descriptor );
		},
		createBindGroupLayout: ( descriptor: GPUBindGroupLayoutDescriptor ) => {
			return epoch.device.createBindGroupLayout( descriptor );
		},
		createPipelineLayout: ( descriptor: GPUPipelineLayoutDescriptor ) => {
			return epoch.device.createPipelineLayout( descriptor );
		},
		createRenderPipeline: ( descriptor: GPURenderPipelineDescriptor ) => {
			return epoch.device.createRenderPipeline( descriptor );
		},
		createBuffer: ( descriptor: GPUBufferDescriptor ) => {
			return epoch.device.createBuffer( descriptor );
		},
		createBindGroup: ( descriptor: GPUBindGroupDescriptor ) => {
			return epoch.device.createBindGroup( descriptor );
		},
	} );
}

/*
====================
RGPU_CreateDrawUpload

Produces texture and buffer upload capabilities for rgpu_draw.
====================
*/
function RGPU_CreateDrawUpload( epoch: rgpu_device_epoch_t ): rgpu_draw_upload_cap_t {
	return Object.freeze( {
		copyExternalImageToTexture: (
			source: GPUCopyExternalImageSourceInfo,
			destination: GPUCopyExternalImageDestInfo,
			size: GPUExtent3D
		) => {
			epoch.queue.copyExternalImageToTexture( source, destination, size );
		},
		writeTexture: (
			destination: GPUImageCopyTexture,
			data: GPUAllowSharedBufferSource,
			layout: GPUImageDataLayout,
			size: GPUExtent3D
		) => {
			epoch.queue.writeTexture( destination, data, layout, size );
		},
		writeBuffer: (
			buffer: GPUBuffer,
			buffer_offset: number,
			data: ArrayBuffer,
			data_offset: number,
			size: number,
		) => {
			epoch.queue.writeBuffer( buffer, buffer_offset, data, data_offset, size );
		},
	} );
}

/*
====================
RGPU_CreateMenuEpoch

Constructs attenuated capabilities, resource builders, and error scope validation for rgpu_menu.
====================
*/
function RGPU_CreateMenuEpoch(
	epoch: rgpu_device_epoch_t,
	controller: AbortController,
): rgpu_menu_epoch_cap_t {
	let scope_tail: Promise<void> = Promise.resolve();

	const resources: rgpu_menu_epoch_cap_t['resources'] = Object.freeze( {
		format: epoch.swapchain_format,
		createSampler: ( descriptor?: GPUSamplerDescriptor ) => {
			return epoch.device.createSampler( descriptor );
		},
		createBuffer: ( descriptor: GPUBufferDescriptor ) => {
			return epoch.device.createBuffer( descriptor );
		},
		createShaderModule: ( descriptor: GPUShaderModuleDescriptor ) => {
			return epoch.device.createShaderModule( descriptor );
		},
		createBindGroupLayout: ( descriptor: GPUBindGroupLayoutDescriptor ) => {
			return epoch.device.createBindGroupLayout( descriptor );
		},
		createPipelineLayout: ( descriptor: GPUPipelineLayoutDescriptor ) => {
			return epoch.device.createPipelineLayout( descriptor );
		},
		createRenderPipeline: ( descriptor: GPURenderPipelineDescriptor ) => {
			return epoch.device.createRenderPipeline( descriptor );
		},
		createBindGroup: ( descriptor: GPUBindGroupDescriptor ) => {
			return epoch.device.createBindGroup( descriptor );
		},
		createTexture: ( descriptor: GPUTextureDescriptor ) => {
			return epoch.device.createTexture( descriptor );
		},
	} );

	const upload: rgpu_menu_epoch_cap_t['upload'] = Object.freeze( {
		writeBuffer: (
			buffer: GPUBuffer,
			buffer_offset: number,
			data: ArrayBuffer,
			data_offset: number,
			size: number,
		) => {
			epoch.queue.writeBuffer( buffer, buffer_offset, data, data_offset, size );
		},
		writeTexture: (
			destination: GPUTexelCopyTextureInfo,
			data: ArrayBuffer,
			data_layout: GPUTexelCopyBufferLayout,
			size: GPUExtent3DStrict,
		) => {
			epoch.queue.writeTexture( destination, data, data_layout, size );
		},
		copyExternalImageToTexture: (
			source: GPUCopyExternalImageSourceInfo,
			destination: GPUCopyExternalImageDestInfo,
			size: GPUExtent3DStrict,
		) => {
			epoch.queue.copyExternalImageToTexture( source, destination, size );
		},
	} );

	const capability: rgpu_menu_epoch_cap_t = Object.freeze( {
		id: epoch.id,
		format: epoch.swapchain_format,
		supports_bc: epoch.supports_bc,
		signal: controller.signal,
		resources,
		upload,
		isCurrent: () => RGPU_EpochIsCurrent( epoch.id, controller ),
		validate: ( label: string, operation: () => undefined ) => {
			const result = scope_tail.then( () => RGPU_RunErrorScopes( epoch, controller, label, operation ) );
			scope_tail = result.then( () => undefined, () => undefined );
			return result;
		},
	} );

	return capability;
}

/*
====================
RGPU_CreateMenuUpload

Extracts upload capability for the menu subsystem.
====================
*/
function RGPU_CreateMenuUpload( epoch_capability: rgpu_menu_epoch_cap_t ): rgpu_menu_upload_cap_t {
	return epoch_capability.upload;
}


// ---------------------------------------------------------------------------
// lifecycle & resource teardown
// ---------------------------------------------------------------------------

/*
====================
RGPU_ResetBuildState

Clears asynchronous resource building status flags and error messages.
====================
*/
function RGPU_ResetBuildState(): void {
	rgpu_backend_build_started = false;
	rgpu_backend_build_done = false;
	rgpu_backend_build_error = '';
}

/*
====================
RGPU_AbortRenderableResources

Aborts in-flight resource building and destroys renderable child resources.
====================
*/
function RGPU_AbortRenderableResources(): void {
	if ( rgpu_backend_abort ) {
		rgpu_backend_abort.abort();
	}

	RGPU_FrameAbort();
	RGPU_DestroyResources();
	RGPU_MenuDestroyResources();

	rgpu_backend_abort = null;
	rgpu_backend_draw_resources = null;
	rgpu_backend_draw_upload = null;
	rgpu_backend_menu_epoch = null;
	rgpu_backend_menu_upload = null;
	rgpu_backend_frame_width = 0;
	rgpu_backend_frame_height = 0;
	rgpu_backend_frame_menu_drawn = false;

	RGPU_ResetBuildState();
}

/*
====================
RGPU_AbortChildResources

Aborts renderable resources and clears frame command capabilities.
====================
*/
function RGPU_AbortChildResources(): void {
	RGPU_AbortRenderableResources();
	rgpu_backend_frame_commands = null;
}

/*
====================
RGPU_ReleaseDeviceWorld

Releases all child resources, resets surface, and shuts down adapter/device init.
====================
*/
function RGPU_ReleaseDeviceWorld(): void {
	RGPU_AbortChildResources();
	RGPU_SurfaceReset();
	rgpu_backend_epoch = null;
	RGPU_DeviceShutdown();
}

/*
====================
RGPU_EnterFailure

Transitions the backend to failed state and reports error telemetry.
====================
*/
function RGPU_EnterFailure( message: string, device_lost: boolean ): void {
	rgpu_backend_fail_msg = message;
	Loading_Report( 'error', message );
	Con_Printf( 'WebGPU backend failed: ' + message + '\n' );

	if ( device_lost ) {
		RGPU_ReleaseDeviceWorld();
	} else {
		RGPU_AbortRenderableResources();
	}

	rgpu_backend_state = rgpu_backend_state_t.RGPU_BACKEND_FAILED;
}

/*
====================
RGPU_HandleDeviceLost

Callback handler invoked when the active GPUDevice reports loss.
====================
*/
function RGPU_HandleDeviceLost( epoch_id: number, info: GPUDeviceLostInfo ): void {
	if ( rgpu_backend_epoch?.id !== epoch_id ) {
		return;
	}

	RGPU_EnterFailure( 'device lost (' + info.reason + '): ' + info.message, true );
}

/*
====================
RGPU_HandleUncapturedError

Callback handler invoked when uncaptured GPU errors occur.
====================
*/
function RGPU_HandleUncapturedError( epoch_id: number, error: GPUError ): void {
	if ( rgpu_backend_epoch?.id !== epoch_id ) {
		return;
	}

	RGPU_EnterFailure( 'uncaptured GPU error: ' + error.message, false );
}

/*
====================
RGPU_AdoptEpoch

Installs a new device epoch and configures capabilities for children.
====================
*/
function RGPU_AdoptEpoch( epoch: rgpu_device_epoch_t ): void {
	if ( rgpu_backend_epoch?.id === epoch.id ) {
		return;
	}

	RGPU_AbortChildResources();

	const controller = new AbortController();
	const menu_epoch = RGPU_CreateMenuEpoch( epoch, controller );

	rgpu_backend_epoch = epoch;
	rgpu_backend_abort = controller;
	rgpu_backend_frame_commands = RGPU_CreateFrameCommands( epoch );
	rgpu_backend_draw_resources = RGPU_CreateDrawResources( epoch );
	rgpu_backend_draw_upload = RGPU_CreateDrawUpload( epoch );
	rgpu_backend_menu_epoch = menu_epoch;
	rgpu_backend_menu_upload = RGPU_CreateMenuUpload( menu_epoch );

	RGPU_ResetBuildState();
	rgpu_backend_state = rgpu_backend_state_t.RGPU_BACKEND_CONFIGURE_SURFACE;
}

/*
====================
RGPU_StartResourceBuild

Launches validated asynchronous construction of draw and menu resources.
====================
*/
function RGPU_StartResourceBuild(): void {
	if (
		rgpu_backend_build_started ||
		!rgpu_backend_epoch ||
		!rgpu_backend_menu_epoch ||
		!rgpu_backend_draw_resources
	) {
		return;
	}

	rgpu_backend_build_started = true;

	const epoch_capability = rgpu_backend_menu_epoch;
	const draw_resources = rgpu_backend_draw_resources;
	const epoch_id = rgpu_backend_epoch.id;
	let draw_ok = false;
	let menu_ok = false;

	void epoch_capability
		.validate( 'core WebGPU resource build', () => {
			draw_ok = RGPU_BuildResources( draw_resources );
			menu_ok = RGPU_MenuBuildResources( epoch_capability );
		} )
		.then( ( error ) => {
			if ( rgpu_backend_epoch?.id !== epoch_id || !epoch_capability.isCurrent() ) {
				return;
			}

			if ( error ) {
				rgpu_backend_build_error = error;
			} else if ( !draw_ok || !menu_ok || !RGPU_ResourcesReady() || !RGPU_MenuCoreResourcesReady() ) {
				rgpu_backend_build_error =
					'resource handles incomplete after validation' +
					' (draw build=' + draw_ok +
					', menu build=' + menu_ok +
					', draw ready=' + RGPU_ResourcesReady() +
					', menu core ready=' + RGPU_MenuCoreResourcesReady() + ')';
			}

			rgpu_backend_build_done = true;
		} )
		.catch( ( error ) => {
			if ( rgpu_backend_epoch?.id !== epoch_id || !epoch_capability.isCurrent() ) {
				return;
			}

			rgpu_backend_build_error = 'resource validation promise failed: ' + String( error );
			rgpu_backend_build_done = true;
		} );
}

/*
====================
RGPU_ApplyResizeIfPossible

Applies pending canvas resize changes to the swapchain if valid.
====================
*/
function RGPU_ApplyResizeIfPossible(): boolean {
	if ( !rgpu_backend_epoch || !VID_IsValid() ) {
		return false;
	}

	return RGPU_SurfaceApplyPendingResize(
		rgpu_backend_epoch.device,
		rgpu_backend_epoch.swapchain_format,
		vid.width,
		vid.height,
	);
}


// ---------------------------------------------------------------------------
// public initialization & polling API
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * RGPU_Shutdown
 *
 * Full shutdown of WebGPU backend, releasing all device and surface resources.
 * ================
 */
export function RGPU_Shutdown(): void {
	rgpu_boot_presented = false;
	rgpu_boot_message = '';
	RGPU_ReleaseDeviceWorld();
	rgpu_backend_state = rgpu_backend_state_t.RGPU_BACKEND_NONE;
	rgpu_backend_fail_msg = '';
}

/**
 * @exec init-once
 * ================
 * RGPU_InitBegin
 *
 * Claims canvas context and starts device acquisition.
 * ================
 */
export function RGPU_InitBegin(): void {
	RGPU_Shutdown();

	if ( !RGPU_SurfaceClaim( vid.canvas ) ) {
		rgpu_backend_state = rgpu_backend_state_t.RGPU_BACKEND_FAILED;
		rgpu_backend_fail_msg = 'unable to claim webgpu canvas context';
		Loading_Report( 'error', rgpu_backend_fail_msg );
		return;
	}

	rgpu_backend_state = rgpu_backend_state_t.RGPU_BACKEND_REQUEST_ADAPTER;
	RGPU_DeviceStart( RGPU_HandleDeviceLost, RGPU_HandleUncapturedError );
}

/**
 * @exec helper
 * ================
 * RGPU_InitPoll
 *
 * Advances WebGPU state machine across adapter, device, surface, and resource building.
 * ================
 */
export function RGPU_InitPoll(): boolean {
	if ( !rgpu_boot_presented && rgpu_backend_state !== rgpu_backend_state_t.RGPU_BACKEND_FAILED ) {
		const message =
			rgpu_backend_state === rgpu_backend_state_t.RGPU_BACKEND_READY
				? 'Loading menu artwork, font atlas and cursor'
				: RGPU_LoadingMessage();

		if ( message !== rgpu_boot_message ) {
			rgpu_boot_message = message;
			Loading_Report( 'gpu', message );
		}
	}

	if (
		rgpu_backend_state === rgpu_backend_state_t.RGPU_BACKEND_NONE ||
		rgpu_backend_state === rgpu_backend_state_t.RGPU_BACKEND_FAILED
	) {
		return false;
	}

	const poll = RGPU_DevicePoll();

	if ( poll.state === rgpu_device_poll_state_t.RGPU_DEVICE_FAILED ) {
		RGPU_EnterFailure( poll.error || 'device initialization failed', false );
		return false;
	}

	if ( poll.state === rgpu_device_poll_state_t.RGPU_DEVICE_REQUEST_ADAPTER ) {
		rgpu_backend_state = rgpu_backend_state_t.RGPU_BACKEND_REQUEST_ADAPTER;
	} else if ( poll.state === rgpu_device_poll_state_t.RGPU_DEVICE_REQUEST_DEVICE ) {
		rgpu_backend_state = rgpu_backend_state_t.RGPU_BACKEND_REQUEST_DEVICE;
	} else if ( poll.state === rgpu_device_poll_state_t.RGPU_DEVICE_READY && poll.epoch ) {
		RGPU_AdoptEpoch( poll.epoch );
	}

	if ( rgpu_backend_state === rgpu_backend_state_t.RGPU_BACKEND_CONFIGURE_SURFACE ) {
		if ( !rgpu_backend_epoch || !VID_IsValid() ) {
			return false;
		}

		if ( !RGPU_SurfaceConfigure(
			rgpu_backend_epoch.device,
			rgpu_backend_epoch.swapchain_format,
			vid.width,
			vid.height,
		) ) {
			return false;
		}

		rgpu_backend_state = rgpu_backend_state_t.RGPU_BACKEND_BUILD_RESOURCES;
	}

	if ( rgpu_backend_state === rgpu_backend_state_t.RGPU_BACKEND_BUILD_RESOURCES ) {
		RGPU_StartResourceBuild();

		if ( !rgpu_backend_build_done ) {
			return false;
		}

		if ( rgpu_backend_build_error ) {
			RGPU_EnterFailure( rgpu_backend_build_error, false );
			return false;
		}

		rgpu_backend_state = rgpu_backend_state_t.RGPU_BACKEND_READY;
	}

	if ( rgpu_backend_state === rgpu_backend_state_t.RGPU_BACKEND_READY ) {
		RGPU_ApplyResizeIfPossible();
		return RGPU_SurfaceHasSwapchain();
	}

	return false;
}

/**
 * @exec helper
 * ================
 * RGPU_IsReady
 *
 * Returns true if WebGPU backend is ready and all child resources are built.
 * ================
 */
export function RGPU_IsReady(): boolean {
	return (
		rgpu_backend_state === rgpu_backend_state_t.RGPU_BACKEND_READY &&
		rgpu_backend_epoch !== null &&
		RGPU_ResourcesReady() &&
		RGPU_MenuCoreResourcesReady()
	);
}

/**
 * @exec helper
 * ================
 * RGPU_InitState
 *
 * Current backend initialization phase enum.
 * ================
 */
export function RGPU_InitState(): rgpu_backend_state_t {
	return rgpu_backend_state;
}

/**
 * @exec helper
 * ================
 * RGPU_IsInitFailed
 *
 * Returns true if initialization encountered an unrecoverable failure.
 * ================
 */
export function RGPU_IsInitFailed(): boolean {
	return rgpu_backend_state === rgpu_backend_state_t.RGPU_BACKEND_FAILED;
}

/**
 * @exec helper
 * ================
 * RGPU_FailMessage
 *
 * Returns last failure message string.
 * ================
 */
export function RGPU_FailMessage(): string {
	return rgpu_backend_fail_msg;
}

/**
 * @exec helper
 * ================
 * RGPU_LoadingMessage
 *
 * User-facing status string corresponding to the current boot state.
 * ================
 */
export function RGPU_LoadingMessage(): string {
	switch ( rgpu_backend_state ) {
		case rgpu_backend_state_t.RGPU_BACKEND_REQUEST_ADAPTER:
			return 'Requesting WebGPU adapter...';

		case rgpu_backend_state_t.RGPU_BACKEND_REQUEST_DEVICE:
			return 'Requesting WebGPU device...';

		case rgpu_backend_state_t.RGPU_BACKEND_CONFIGURE_SURFACE:
			return 'Configuring swapchain...';

		case rgpu_backend_state_t.RGPU_BACKEND_BUILD_RESOURCES:
			return 'Building and validating GPU resources...';

		default:
			return 'Initializing WebGPU...';
	}
}

/**
 * @exec helper
 * ================
 * RGPU_HasWebGPUContext
 *
 * Returns true if canvas context has been claimed.
 * ================
 */
export function RGPU_HasWebGPUContext(): boolean {
	return RGPU_SurfaceHasContext();
}

/**
 * @exec helper
 * ================
 * RGPU_HasSwapchain
 *
 * Returns true if swapchain is actively configured.
 * ================
 */
export function RGPU_HasSwapchain(): boolean {
	return RGPU_SurfaceHasSwapchain();
}

/**
 * @exec helper
 * ================
 * RGPU_IsPresentable
 *
 * Returns true if presentation swapchain is ready for frame drawing.
 * ================
 */
export function RGPU_IsPresentable(): boolean {
	return rgpu_backend_epoch !== null && RGPU_SurfaceHasSwapchain();
}

/**
 * @exec helper
 * ================
 * RGPU_NoteResize
 *
 * Notes window resize event and reconfigures swapchain if layout dimensions are valid.
 * ================
 */
export function RGPU_NoteResize( width: number, height: number ): void {
	RGPU_FrameAbort();
	RGPU_SurfaceMarkResize( width, height );

	if ( !rgpu_backend_epoch || width < 1 || height < 1 || !VID_IsValid() ) {
		return;
	}

	RGPU_OnResize( width, height );
}

/*
====================
RGPU_OnResize

Reconfigures the surface swapchain to match new dimensions.
====================
*/
function RGPU_OnResize( width: number, height: number ): void {
	RGPU_FrameAbort();

	if ( !rgpu_backend_epoch || width < 1 || height < 1 || !VID_IsValid() ) {
		RGPU_SurfaceMarkResize( width, height );
		return;
	}

	RGPU_SurfaceConfigure(
		rgpu_backend_epoch.device,
		rgpu_backend_epoch.swapchain_format,
		width,
		height,
	);
}


// ---------------------------------------------------------------------------
// frame rendering & pass coordination
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * RGPU_DrawLoadingFrame
 *
 * Renders an intermediate loading screen frame with optional menu background.
 * ================
 */
export function RGPU_DrawLoadingFrame(
	width: number,
	height: number,
	menu_overlay: rgpu_menu_overlay_t | null
): void {
	if ( !rgpu_backend_epoch || !rgpu_backend_frame_commands || !RGPU_SurfaceHasSwapchain() ) {
		return;
	}

	const view = RGPU_SurfaceAcquireView();

	if ( !view ) {
		return;
	}

	const clear_value = menu_overlay && RGPU_MenuResourcesReady()
		? RGPU_MenuLetterboxClear()
		: RGPU_FRAME_CLEAR_COLOR;

	const pass = RGPU_FrameBegin( rgpu_backend_frame_commands, view, clear_value );

	if ( !pass ) {
		RGPU_EnterFailure( RGPU_ERR_LOADING_PASS_BEGIN, false );
		return;
	}

	if ( menu_overlay && rgpu_backend_menu_upload && RGPU_MenuResourcesReady() ) {
		RGPU_MenuDrawBackground( pass, rgpu_backend_menu_upload, width, height, menu_overlay );
	}

	if ( !RGPU_FrameEnd( rgpu_backend_frame_commands ) ) {
		RGPU_EnterFailure( RGPU_ERR_LOADING_FRAME_SUBMIT, false );
	}
}

/**
 * @exec helper
 * ================
 * RGPU_DrawFailedFrame
 *
 * Renders a solid failure background frame.
 * ================
 */
export function RGPU_DrawFailedFrame( width: number, height: number ): void {
	void width;
	void height;

	if ( !rgpu_backend_epoch || !rgpu_backend_frame_commands || !RGPU_SurfaceHasSwapchain() ) {
		return;
	}

	const view = RGPU_SurfaceAcquireView();

	if ( !view ) {
		return;
	}

	const pass = RGPU_FrameBegin( rgpu_backend_frame_commands, view, RGPU_FRAME_FAIL_COLOR );

	if ( !pass ) {
		return;
	}

	RGPU_FrameEnd( rgpu_backend_frame_commands );
}

/**
 * @exec per-frame
 * ================
 * RGPU_BeginFrame
 *
 * Begins WebGPU render pass for the frame, setting up depth/blur attachments as needed.
 * ================
 */
export function RGPU_BeginFrame(
	width: number,
	height: number,
	menu_overlay: rgpu_menu_overlay_t | null
): void {
	rgpu_world_overlay = Level_WorldVisible() ? menu_overlay : null;
	rgpu_blur_output = null;
	rgpu_console_overlay = menu_overlay?.console_only ? menu_overlay : null;

	rgpu_backend_frame_width = width;
	rgpu_backend_frame_height = height;
	rgpu_backend_frame_menu_drawn = false;

	if ( !RGPU_IsReady() || !rgpu_backend_epoch || !rgpu_backend_frame_commands ) {
		return;
	}

	RGPU_ApplyResizeIfPossible();
	let view = RGPU_SurfaceAcquireView();

	if ( !view ) {
		return;
	}

	if ( rgpu_world_overlay?.blur_world ) {
		const scene = RGPU_DrawSceneTarget( width, height );

		if ( scene ) {
			rgpu_blur_output = view;
			view = scene;
		}
	}

	const clear_value = menu_overlay && RGPU_MenuResourcesReady()
		? RGPU_MenuLetterboxClear()
		: RGPU_FRAME_CLEAR_COLOR;

	const depth_target = Level_WorldVisible() ? RGPU_DrawDepth( width, height ) : null;

	if ( !RGPU_FrameBegin( rgpu_backend_frame_commands, view, clear_value, depth_target ) ) {
		RGPU_EnterFailure( RGPU_ERR_RENDER_PASS_BEGIN, false );
	}
}

/**
 * @exec per-frame
 * ================
 * RGPU_EndFrame
 *
 * Executes post-process blur, console/menu overlays, and submits frame commands.
 * ================
 */
export function RGPU_EndFrame(): void {
	let pass = RGPU_FramePass();

	if ( rgpu_blur_output && rgpu_backend_draw_upload ) {
		const radius = Math.hypot( rgpu_world_overlay?.blur_world ?? 0, Number( Cvar_Get( 'r_blur' ) ) || 0 );

		pass = RGPU_FrameOverlay( RGPU_DrawBlurTarget() );

		if ( pass ) {
			RGPU_DrawBlur( pass, rgpu_backend_draw_upload, RGPU_BLUR_AXIS_HORIZONTAL, rgpu_backend_frame_width, rgpu_backend_frame_height, radius );
		}

		pass = RGPU_FrameOverlay( rgpu_blur_output );

		if ( pass ) {
			RGPU_DrawBlur( pass, rgpu_backend_draw_upload, RGPU_BLUR_AXIS_VERTICAL, rgpu_backend_frame_width, rgpu_backend_frame_height, radius );
		}

		rgpu_blur_output = null;
	}

	if ( Level_WorldVisible() && rgpu_world_overlay && rgpu_backend_menu_upload ) {
		pass = RGPU_FrameOverlay();

		if ( pass ) {
			RGPU_MenuDrawBackground(
				pass,
				rgpu_backend_menu_upload,
				rgpu_backend_frame_width,
				rgpu_backend_frame_height,
				{ ...rgpu_world_overlay, console_only: true }
			);
		}

		rgpu_console_overlay = null;
	}

	rgpu_world_overlay = null;

	if ( pass && rgpu_console_overlay && rgpu_backend_menu_upload ) {
		RGPU_MenuDrawBackground(
			pass,
			rgpu_backend_menu_upload,
			rgpu_backend_frame_width,
			rgpu_backend_frame_height,
			rgpu_console_overlay
		);
	}

	rgpu_console_overlay = null;

	if ( rgpu_backend_epoch && rgpu_backend_frame_commands && RGPU_FramePass() ) {
		const menu_presentable = rgpu_backend_frame_menu_drawn && RGPU_MenuPresentationReady();

		if ( !RGPU_FrameEnd( rgpu_backend_frame_commands ) ) {
			RGPU_EnterFailure( RGPU_ERR_FRAME_SUBMIT, false );
		} else if ( !rgpu_boot_presented && menu_presentable ) {
			rgpu_boot_presented = true;
			Loading_Report( 'ready', RGPU_MSG_FIRST_MENU_FRAME );
		}
	}

	rgpu_backend_frame_width = 0;
	rgpu_backend_frame_height = 0;
	rgpu_backend_frame_menu_drawn = false;
}

/**
 * @exec per-frame
 * ================
 * RGPU_UploadFrameUniforms
 *
 * Prepares level textures/buffers and uploads per-frame camera/lighting uniform buffers.
 * ================
 */
export function RGPU_UploadFrameUniforms( refdef: refdef_t ): void {
	if ( !RGPU_IsReady() || !rgpu_backend_draw_upload ) {
		return;
	}

	if ( rgpu_backend_draw_resources ) {
		RGPU_PrepareLevel( rgpu_backend_draw_resources, rgpu_backend_draw_upload );
	}

	RGPU_UploadUniforms( rgpu_backend_draw_upload, refdef );
}

/**
 * @exec per-frame
 * ================
 * RGPU_DrawWorld
 *
 * Draws the 3D world geometry or full-screen menu background.
 * ================
 */
export function RGPU_DrawWorld( overlay: rgpu_menu_overlay_t | null ): void {
	if ( !RGPU_IsReady() ) {
		return;
	}

	const pass = RGPU_FramePass();

	if ( !pass ) {
		return;
	}

	if ( Level_WorldVisible() ) {
		RGPU_DrawWorldImpl( pass );
		return;
	}

	if ( overlay && !overlay.console_only ) {
		if ( rgpu_backend_menu_upload ) {
			RGPU_MenuDrawBackground(
				pass,
				rgpu_backend_menu_upload,
				rgpu_backend_frame_width,
				rgpu_backend_frame_height,
				overlay
			);
		}

		rgpu_backend_frame_menu_drawn = true;
		return;
	}

	RGPU_DrawWorldImpl( pass );
}

/**
 * @exec per-frame
 * ================
 * RGPU_DrawEntitiesOnList
 *
 * Encodes draw calls for all visible entities (characters, items, etc.).
 * ================
 */
export function RGPU_DrawEntitiesOnList( entities: entity_render_t[], refdef: refdef_t ): void {
	if ( !RGPU_IsReady() || rgpu_backend_frame_menu_drawn || !rgpu_backend_draw_upload ) {
		return;
	}

	const pass = RGPU_FramePass();

	if ( !pass ) {
		return;
	}

	RGPU_DrawEntities( pass, rgpu_backend_draw_upload, entities, refdef );
}

/**
 * @exec per-frame
 * ================
 * RGPU_DrawParticles
 *
 * Dispatches particle and visual weapon effect draw passes.
 * ================
 */
export function RGPU_DrawParticles( entities: entity_render_t[], refdef: refdef_t ): void {
	if ( !RGPU_IsReady() || rgpu_backend_frame_menu_drawn ) {
		return;
	}

	RGPU_DrawParticlesImpl( entities, refdef );
}

/**
 * @exec per-frame
 * ================
 * RGPU_DrawViewModel
 *
 * Renders the first-person player hands and weapon viewmodel.
 * ================
 */
export function RGPU_DrawViewModel( refdef: refdef_t ): void {
	if ( !RGPU_IsReady() || rgpu_backend_frame_menu_drawn ) {
		return;
	}

	RGPU_DrawViewModelImpl( refdef );
}
