/*
===============================================================================

	rgpu_init.ts

	Async adapter/device bootstrap. Owns raw GPUDevice lifetime; parent polls
	immutable device epochs and mediates every capability handed to siblings.

===============================================================================
*/

import { Con_Printf } from '@/engine/common/common.js';


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export const enum rgpu_device_poll_state_t {
	RGPU_DEVICE_IDLE = 0,
	RGPU_DEVICE_REQUEST_ADAPTER,
	RGPU_DEVICE_REQUEST_DEVICE,
	RGPU_DEVICE_READY,
	RGPU_DEVICE_FAILED,
}


export interface rgpu_device_epoch_t {
	readonly id: number;
	readonly device: GPUDevice;
	readonly queue: GPUQueue;
	readonly swapchain_format: GPUTextureFormat;
	readonly supports_bc: boolean;
}


export interface rgpu_device_poll_t {
	readonly state: rgpu_device_poll_state_t;
	readonly epoch: rgpu_device_epoch_t | null;
	readonly error: string;
}


interface rgpu_init_state_t {
	generation: number;
	state: rgpu_device_poll_state_t;
	adapter: GPUAdapter | null;
	device: GPUDevice | null;
	adapter_done: boolean;
	device_done: boolean;
	device_request_started: boolean;
	error: string;
	epoch: rgpu_device_epoch_t | null;
	on_device_lost: ( ( epoch_id: number, info: GPUDeviceLostInfo ) => void ) | null;
	on_uncaptured_error: ( ( epoch_id: number, error: GPUError ) => void ) | null;
}


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

const rgpu_init: rgpu_init_state_t = {
	generation: 0,
	state: rgpu_device_poll_state_t.RGPU_DEVICE_IDLE,
	adapter: null,
	device: null,
	adapter_done: false,
	device_done: false,
	device_request_started: false,
	error: '',
	epoch: null,
	on_device_lost: null,
	on_uncaptured_error: null,
};


// ---------------------------------------------------------------------------
// forward
// RGPU_InitFail, RGPU_InitIsCurrent, RGPU_InitAdapterOptions
// RGPU_InitOnAdapter, RGPU_InitOnAdapterError, RGPU_InitRequiredFeatures
// RGPU_InitBeginDeviceRequest, RGPU_InitOnDevice, RGPU_InitOnDeviceError
// RGPU_InitWatchDevice, RGPU_InitOnDeviceLost, RGPU_InitOnUncapturedError
// ---------------------------------------------------------------------------


/**
 * ================
 * RGPU_InitFail
 * ================
 */
function RGPU_InitFail( message: string ): void {
	rgpu_init.state = rgpu_device_poll_state_t.RGPU_DEVICE_FAILED;
	rgpu_init.error = message;
	Con_Printf( 'WebGPU device init failed: ' + message + '\n' );
}


/**
 * ================
 * RGPU_InitIsCurrent
 * ================
 */
function RGPU_InitIsCurrent( generation: number ): boolean {
	return generation === rgpu_init.generation;
}


/**
 * @exec init-once
 * ================
 * RGPU_InitAdapterOptions
 *
 * Chrome on Windows ignores powerPreference and logs a warning. Omit it there.
 * ================
 */
function RGPU_InitAdapterOptions(): GPURequestAdapterOptions {
	if ( /Win/i.test( navigator.userAgent ) )
		return {};

	return { powerPreference: 'high-performance' };
}


/**
 * @exec async-callback
 * ================
 * RGPU_InitOnAdapter
 * ================
 */
function RGPU_InitOnAdapter( adapter: GPUAdapter | null, generation: number ): void {
	if ( !RGPU_InitIsCurrent( generation ) )
		return;

	if ( !adapter ) {
		RGPU_InitFail( 'adapter request returned null' );
		return;
	}

	rgpu_init.adapter = adapter;
	rgpu_init.adapter_done = true;
}


/**
 * @exec async-callback
 * ================
 * RGPU_InitOnAdapterError
 * ================
 */
function RGPU_InitOnAdapterError( error: unknown, generation: number ): void {
	if ( !RGPU_InitIsCurrent( generation ) )
		return;

	RGPU_InitFail( String( error ) );
}


/**
 * @exec per-frame
 * ================
 * RGPU_InitRequiredFeatures
 *
 * Optional features are negotiated once at the device-owner boundary.
 * ================
 */
function RGPU_InitRequiredFeatures( adapter: GPUAdapter ): GPUFeatureName[] {
	let features: GPUFeatureName[];

	features = [];
	if ( adapter.features.has( 'texture-compression-bc' ) )
		features.push( 'texture-compression-bc' );

	return features;
}


/**
 * @exec per-frame
 * ================
 * RGPU_InitRequiredLimits
 *
 * Negotiate adapter limits (e.g. maxTextureArrayLayers) so maps with > 256 textures load cleanly.
 * ================
 */
function RGPU_InitRequiredLimits( adapter: GPUAdapter ): Record<string, number> {
	const limits: Record<string, number> = {};

	if ( adapter.limits?.maxTextureArrayLayers ) {
		limits.maxTextureArrayLayers = adapter.limits.maxTextureArrayLayers;
	}

	return limits;
}


/**
 * @exec async-callback
 * ================
 * RGPU_InitOnDeviceLost
 * ================
 */
function RGPU_InitOnDeviceLost( info: GPUDeviceLostInfo, generation: number ): void {
	if ( !RGPU_InitIsCurrent( generation ) )
		return;

	if ( rgpu_init.on_device_lost )
		rgpu_init.on_device_lost( generation, info );
}


/**
 * @exec async-callback
 * ================
 * RGPU_InitOnUncapturedError
 * ================
 */
function RGPU_InitOnUncapturedError( event: GPUUncapturedErrorEvent, generation: number ): void {
	if ( !RGPU_InitIsCurrent( generation ) )
		return;

	if ( rgpu_init.on_uncaptured_error )
		rgpu_init.on_uncaptured_error( generation, event.error );
}


/**
 * @exec async-callback
 * ================
 * RGPU_InitWatchDevice
 * ================
 */
function RGPU_InitWatchDevice( device: GPUDevice, generation: number ): void {
	device.addEventListener( 'uncapturederror', ( event ) => RGPU_InitOnUncapturedError( event, generation ) );
	device.lost
		.then( ( info ) => RGPU_InitOnDeviceLost( info, generation ) )
		.catch( ( error ) => Con_Printf( 'WebGPU device.lost watch failed: ' + String( error ) + '\n' ) );
}


/**
 * @exec async-callback
 * ================
 * RGPU_InitOnDevice
 * ================
 */
function RGPU_InitOnDevice( device: GPUDevice, generation: number ): void {
	let adapter: GPUAdapter | null;

	if ( !RGPU_InitIsCurrent( generation ) ) {
		device.destroy();
		return;
	}

	adapter = rgpu_init.adapter;
	if ( !adapter ) {
		device.destroy();
		RGPU_InitFail( 'device resolved without an adapter' );
		return;
	}

	rgpu_init.device = device;
	rgpu_init.device_done = true;
	rgpu_init.epoch = Object.freeze( {
		id: generation,
		device,
		queue: device.queue,
		swapchain_format: navigator.gpu!.getPreferredCanvasFormat(),
		supports_bc: device.features.has( 'texture-compression-bc' ),
	} );
	RGPU_InitWatchDevice( device, generation );
}


/**
 * @exec async-callback
 * ================
 * RGPU_InitOnDeviceError
 * ================
 */
function RGPU_InitOnDeviceError( error: unknown, generation: number ): void {
	if ( !RGPU_InitIsCurrent( generation ) )
		return;

	RGPU_InitFail( String( error ) );
}


/**
 * @exec per-frame
 * ================
 * RGPU_InitBeginDeviceRequest
 * ================
 */
function RGPU_InitBeginDeviceRequest(): void {
	let adapter: GPUAdapter;
	let generation: number;
	let required_features: GPUFeatureName[];
	let required_limits: Record<string, number>;

	if ( rgpu_init.device_request_started || !rgpu_init.adapter )
		return;

	rgpu_init.device_request_started = true;
	rgpu_init.state = rgpu_device_poll_state_t.RGPU_DEVICE_REQUEST_DEVICE;
	adapter = rgpu_init.adapter;
	generation = rgpu_init.generation;
	required_features = RGPU_InitRequiredFeatures( adapter );
	required_limits = RGPU_InitRequiredLimits( adapter );

	adapter
		.requestDevice( {
			requiredFeatures: required_features,
			...( Object.keys( required_limits ).length > 0 ? { requiredLimits: required_limits } : {} ),
		} )
		.then( ( device ) => RGPU_InitOnDevice( device, generation ) )
		.catch( ( error ) => RGPU_InitOnDeviceError( error, generation ) );
}


/**
 * @exec init-once
 * ================
 * RGPU_InitStart
 * ================
 */
export function RGPU_InitStart(
	on_device_lost: ( epoch_id: number, info: GPUDeviceLostInfo ) => void,
	on_uncaptured_error: ( epoch_id: number, error: GPUError ) => void,
): void {
	let generation: number;

	if ( rgpu_init.state !== rgpu_device_poll_state_t.RGPU_DEVICE_IDLE || rgpu_init.device || rgpu_init.adapter ) {
		RGPU_InitFail( 'device owner started without an explicit shutdown' );
		return;
	}

	rgpu_init.on_device_lost = on_device_lost;
	rgpu_init.on_uncaptured_error = on_uncaptured_error;
	generation = rgpu_init.generation;

	if ( !navigator.gpu ) {
		RGPU_InitFail( 'WebGPU not available' );
		return;
	}

	rgpu_init.state = rgpu_device_poll_state_t.RGPU_DEVICE_REQUEST_ADAPTER;
	navigator.gpu
		.requestAdapter( RGPU_InitAdapterOptions() )
		.then( ( adapter ) => RGPU_InitOnAdapter( adapter, generation ) )
		.catch( ( error ) => RGPU_InitOnAdapterError( error, generation ) );
}


/**
 * @exec init-once
 * ================
 * RGPU_InitShutdown
 *
 * Invalidate callbacks before destroying the device so intentional loss is stale.
 * ================
 */
export function RGPU_InitShutdown(): void {
	let device: GPUDevice | null;

	device = rgpu_init.device;
	rgpu_init.generation++;
	rgpu_init.state = rgpu_device_poll_state_t.RGPU_DEVICE_IDLE;
	rgpu_init.adapter = null;
	rgpu_init.device = null;
	rgpu_init.adapter_done = false;
	rgpu_init.device_done = false;
	rgpu_init.device_request_started = false;
	rgpu_init.error = '';
	rgpu_init.epoch = null;
	rgpu_init.on_device_lost = null;
	rgpu_init.on_uncaptured_error = null;

	if ( device )
		device.destroy();
}


/**
 * @exec per-frame
 * ================
 * RGPU_InitPoll
 * ================
 */
export function RGPU_InitPoll(): rgpu_device_poll_t {
	if ( rgpu_init.state === rgpu_device_poll_state_t.RGPU_DEVICE_REQUEST_ADAPTER && rgpu_init.adapter_done )
		RGPU_InitBeginDeviceRequest();

	if ( rgpu_init.state === rgpu_device_poll_state_t.RGPU_DEVICE_REQUEST_DEVICE && rgpu_init.device_done )
		rgpu_init.state = rgpu_device_poll_state_t.RGPU_DEVICE_READY;

	return {
		state: rgpu_init.state,
		epoch: rgpu_init.epoch,
		error: rgpu_init.error,
	};
}
