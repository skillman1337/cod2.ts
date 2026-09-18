/*
===============================================================================

	test_webgpu_lifecycle.mjs

	Call of Duty 2 / id Tech WebGPU Hardware Lifecycle Integration Tests
	Exercises device negotiation, canvas context configuration, render pass
	dispatch, buffer allocation, swapchain resize, and device-lost handling.

===============================================================================
*/

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildBrowserModules } from '../../build/build_browser_modules.mjs';


// ---------------------------------------------------------------------------
// module constants & path resolution
// ---------------------------------------------------------------------------

const MODULE_DIR = path.dirname( fileURLToPath( import.meta.url ) );
const ROOT = path.resolve( MODULE_DIR, '../../..' );


// ---------------------------------------------------------------------------
// assertion & promise helpers
// ---------------------------------------------------------------------------

/*
====================
assert

Basic test assertion helper.
====================
*/
function assert( condition, message ) {
	if ( !condition ) {
		throw new Error( message );
	}
}

/*
====================
deferred

Allocates an externally resolvable/rejectable Promise tuple.
====================
*/
function deferred() {
	let resolve;
	let reject;
	const promise = new Promise( ( onResolve, onReject ) => {
		resolve = onResolve;
		reject = onReject;
	} );
	return { promise, resolve, reject };
}

/*
====================
flushPromises

Flushes pending microtasks and event-loop turns to allow asynchronous operations to settle.
====================
*/
async function flushPromises() {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise( ( resolve ) => setImmediate( resolve ) );
}

/*
====================
moduleUrl

Constructs a file URL string for a module inside the built dist directory.
====================
*/
function moduleUrl( dist, relative ) {
	return pathToFileURL( path.join( dist, relative ) ).href;
}


// ---------------------------------------------------------------------------
// global environment mocking helpers
// ---------------------------------------------------------------------------

/*
====================
installGlobal

Installs a temporary mock value onto globalThis and returns an undo cleanup callback.
====================
*/
function installGlobal( name, value ) {
	const previous = Object.getOwnPropertyDescriptor( globalThis, name );
	Object.defineProperty( globalThis, name, {
		configurable: true,
		writable: true,
		value,
	} );

	return () => {
		if ( previous ) {
			Object.defineProperty( globalThis, name, previous );
		} else {
			delete globalThis[name];
		}
	};
}

/*
====================
waitFor

Polls a predicate callback across asynchronous event loops until true or timeout.
====================
*/
async function waitFor( predicate, label, limit = 80 ) {
	for ( let i = 0; i < limit; i += 1 ) {
		if ( predicate() ) {
			return;
		}
		await flushPromises();
	}
	throw new Error( `timed out waiting for ${label}` );
}


// ---------------------------------------------------------------------------
// mock WebGPU device synthesis
// ---------------------------------------------------------------------------

/*
====================
makeDevice

Constructs a lightweight mock WebGPU GPUDevice for lifecycle negotiation testing.
====================
*/
function makeDevice( { features = [], lost = deferred() } = {} ) {
	const listeners = new Map();
	const state = {
		destroyCount: 0,
		listeners,
		lost,
	};

	const device = {
		queue: Object.freeze( { label: 'fake queue' } ),
		features: new Set( features ),
		lost: lost.promise,
		addEventListener( type, listener ) {
			listeners.set( type, listener );
		},
		destroy() {
			state.destroyCount += 1;
		},
	};

	return { device, state };
}

/*
====================
makeRuntimeDevice

Constructs a mock WebGPU GPUDevice with command encoder, render pass,
pipeline layout, and texture/buffer allocation tracking.
====================
*/
function makeRuntimeDevice( { features = [] } = {} ) {
	const lost = deferred();
	const listeners = new Map();
	const scopeStack = [];
	const state = {
		destroyCount: 0,
		listeners,
		lost,
		scopeCalls: [],
		submitted: [],
		renderPasses: [],
		pipelineLabels: [],
		draws: [],
		createdTextures: [],
		destroyedResources: [],
		writes: [],
	};

	function resource( kind, descriptor = {} ) {
		const label = descriptor.label ?? `${kind}-${state.destroyedResources.length}`;
		return {
			kind,
			label,
			destroy() {
				state.destroyedResources.push( label );
			},
		};
	}

	const queue = {
		submit( commandBuffers ) {
			state.submitted.push( [...commandBuffers] );
		},
		writeBuffer( ...args ) {
			state.writes.push( {
				kind: 'buffer',
				args,
				data: args[2].slice( args[3] ?? 0, ( args[3] ?? 0 ) + args[4] ),
			} );
		},
		writeTexture( ...args ) {
			state.writes.push( { kind: 'texture', args } );
		},
		copyExternalImageToTexture( ...args ) {
			const texture = args[1].texture;
			const required = GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT;
			assert(
				( texture.usage & required ) === required,
				`${texture.label}: external image upload requires COPY_DST and RENDER_ATTACHMENT`
			);
			state.writes.push( { kind: 'external', args } );
		},
	};

	const device = {
		queue,
		features: new Set( features ),
		lost: lost.promise,
		addEventListener( type, listener ) {
			listeners.set( type, listener );
		},
		destroy() {
			state.destroyCount += 1;
		},
		pushErrorScope( name ) {
			scopeStack.push( name );
			state.scopeCalls.push( `push:${name}` );
		},
		popErrorScope() {
			const name = scopeStack.pop();
			state.scopeCalls.push( `pop:${name}` );
			return Promise.resolve( null );
		},
		createCommandEncoder( descriptor ) {
			const command = Object.freeze( { label: `${descriptor.label}:command` } );
			return {
				beginRenderPass( passDescriptor ) {
					state.renderPasses.push( passDescriptor );
					return {
						setPipeline( pipeline ) {
							state.pipelineLabels.push( pipeline.label ?? '<unlabeled pipeline>' );
						},
						setBindGroup() {},
						draw( ...args ) {
							state.draws.push( args );
						},
						end() {},
					};
				},
				finish() {
					return command;
				},
			};
		},
		createShaderModule( descriptor ) {
			return resource( 'shader', descriptor );
		},
		createBindGroupLayout( descriptor ) {
			return resource( 'bind-group-layout', descriptor );
		},
		createPipelineLayout( descriptor ) {
			return resource( 'pipeline-layout', descriptor );
		},
		createRenderPipeline( descriptor ) {
			const pipeline = resource( 'pipeline', descriptor );
			return {
				...pipeline,
				getBindGroupLayout( index ) {
					return Object.freeze( { label: `${pipeline.label}:layout:${index}` } );
				},
			};
		},
		createBuffer( descriptor ) {
			return resource( 'buffer', descriptor );
		},
		createBindGroup( descriptor ) {
			return resource( 'bind-group', descriptor );
		},
		createSampler( descriptor = {} ) {
			return resource( 'sampler', descriptor );
		},
		createTexture( descriptor ) {
			const texture = resource( 'texture', descriptor );
			state.createdTextures.push( texture.label );
			return {
				...texture,
				usage: descriptor.usage,
				createView() {
					return Object.freeze( { label: `${texture.label}:view` } );
				},
			};
		},
	};

	return { device, state };
}


// ---------------------------------------------------------------------------
// test suites: hardware device epoch & loss recovery
// ---------------------------------------------------------------------------

/*
====================
testDeviceEpoch

Validates device epoch creation, BC texture feature negotiation,
uncaptured error listeners, and asynchronous device recovery.
====================
*/
async function testDeviceEpoch( dist ) {
	const module = await import( moduleUrl(
		dist,
		'engine/com/client/screen/scr_draw/rgpu/rgpu_init.js'
	) );
	const previousGpu = Object.getOwnPropertyDescriptor( globalThis.navigator, 'gpu' );
	const deviceLostEvents = [];
	const uncapturedEvents = [];

	try {
		const first = makeDevice( { features: ['texture-compression-bc'] } );
		const requestedFeatures = [];
		const adapter = {
			features: new Set( ['texture-compression-bc'] ),
			requestDevice( options ) {
				requestedFeatures.push( ...options.requiredFeatures );
				return Promise.resolve( first.device );
			},
		};
		const gpu = {
			requestAdapter() {
				return Promise.resolve( adapter );
			},
			getPreferredCanvasFormat() {
				return 'bgra8unorm';
			},
		};

		Object.defineProperty( globalThis.navigator, 'gpu', {
			configurable: true,
			value: gpu,
		} );

		module.RGPU_InitShutdown();
		module.RGPU_InitStart(
			( epoch, info ) => deviceLostEvents.push( { epoch, info } ),
			( epoch, error ) => uncapturedEvents.push( { epoch, error } )
		);

		assert(
			module.RGPU_InitPoll().state === module.rgpu_device_poll_state_t.RGPU_DEVICE_REQUEST_ADAPTER,
			'device owner did not enter adapter-request state'
		);

		await flushPromises();

		assert(
			module.RGPU_InitPoll().state === module.rgpu_device_poll_state_t.RGPU_DEVICE_REQUEST_DEVICE,
			'device owner did not advance to device-request state'
		);

		await flushPromises();

		const ready = module.RGPU_InitPoll();
		assert( ready.state === module.rgpu_device_poll_state_t.RGPU_DEVICE_READY, 'device owner did not become ready' );
		assert( ready.epoch !== null, 'ready device owner did not publish an epoch' );
		assert( ready.epoch.device === first.device, 'epoch published the wrong device' );
		assert( ready.epoch.queue === first.device.queue, 'epoch published the wrong queue' );
		assert( ready.epoch.supports_bc === true, 'enabled BC feature was not published' );
		assert(
			requestedFeatures.length === 1 && requestedFeatures[0] === 'texture-compression-bc',
			'device owner did not negotiate the supported BC feature exactly once'
		);

		const uncaptured = first.state.listeners.get( 'uncapturederror' );
		assert( typeof uncaptured === 'function', 'device owner did not install uncaptured-error listener' );
		const fakeError = { message: 'test validation error' };
		uncaptured( { error: fakeError } );
		assert(
			uncapturedEvents.length === 1 && uncapturedEvents[0].error === fakeError,
			'uncaptured error did not preserve epoch callback routing'
		);

		const firstEpoch = ready.epoch.id;
		first.state.lost.resolve( { reason: 'unknown', message: 'test loss' } );
		await flushPromises();
		assert(
			deviceLostEvents.length === 1 && deviceLostEvents[0].epoch === firstEpoch,
			'device loss did not preserve epoch callback routing'
		);

		module.RGPU_InitShutdown();
		assert( first.state.destroyCount === 1, 'owned device was not destroyed exactly once at shutdown' );

		const staleDevice = makeDevice();
		const staleRequest = deferred();
		const staleAdapter = {
			features: new Set(),
			requestDevice() {
				return staleRequest.promise;
			},
		};

		Object.defineProperty( globalThis.navigator, 'gpu', {
			configurable: true,
			value: {
				requestAdapter: () => Promise.resolve( staleAdapter ),
				getPreferredCanvasFormat: () => 'rgba8unorm',
			},
		} );

		module.RGPU_InitStart( () => {}, () => {} );
		await flushPromises();
		module.RGPU_InitPoll();
		module.RGPU_InitShutdown();
		staleRequest.resolve( staleDevice.device );
		await flushPromises();

		assert( staleDevice.state.destroyCount === 1, 'stale asynchronous device was not destroyed' );
		assert(
			module.RGPU_InitPoll().state === module.rgpu_device_poll_state_t.RGPU_DEVICE_IDLE,
			'stale asynchronous completion changed the shutdown state'
		);

		const pendingAdapter = deferred();
		Object.defineProperty( globalThis.navigator, 'gpu', {
			configurable: true,
			value: {
				requestAdapter: () => pendingAdapter.promise,
				getPreferredCanvasFormat: () => 'rgba8unorm',
			},
		} );

		module.RGPU_InitStart( () => {}, () => {} );
		module.RGPU_InitStart( () => {}, () => {} );

		assert(
			module.RGPU_InitPoll().state === module.rgpu_device_poll_state_t.RGPU_DEVICE_FAILED,
			'device owner accepted a second start without explicit shutdown'
		);
		assert(
			/explicit shutdown/.test( module.RGPU_InitPoll().error ),
			'double-start failure did not explain the ownership violation'
		);

		module.RGPU_InitShutdown();
		pendingAdapter.resolve( null );
		await flushPromises();
	} finally {
		module.RGPU_InitShutdown();
		if ( previousGpu ) {
			Object.defineProperty( globalThis.navigator, 'gpu', previousGpu );
		} else {
			delete globalThis.navigator.gpu;
		}
	}
}


// ---------------------------------------------------------------------------
// test suites: frame render pass ownership
// ---------------------------------------------------------------------------

/*
====================
testFrameOwnership

Validates begin/end/abort render pass sequencing, single-submission guarantees,
and pass reference containment.
====================
*/
async function testFrameOwnership( dist ) {
	const module = await import( moduleUrl(
		dist,
		'engine/com/client/screen/scr_draw/rgpu/rgpu_frame.js'
	) );
	const calls = [];
	const pass = {
		end() {
			calls.push( 'pass.end' );
		},
	};
	const command = Object.freeze( { label: 'command' } );
	const encoder = {
		beginRenderPass( descriptor ) {
			calls.push( `begin:${descriptor.label}` );
			return pass;
		},
		finish() {
			calls.push( 'encoder.finish' );
			return command;
		},
	};
	const commands = {
		createCommandEncoder( descriptor ) {
			calls.push( `encoder:${descriptor.label}` );
			return encoder;
		},
		submit( buffers ) {
			calls.push( `submit:${buffers.length}` );
			assert( buffers[0] === command, 'frame owner submitted the wrong command buffer' );
		},
	};
	const view = Object.freeze( { label: 'view' } );

	module.RGPU_FrameAbort();
	const active = module.RGPU_FrameBegin( commands, view, module.RGPU_FRAME_CLEAR_COLOR );
	assert( active === pass, 'frame begin did not expose the frame-local pass' );
	assert( module.RGPU_FramePass() === pass, 'frame owner did not retain the active pass' );
	assert( module.RGPU_FrameEnd( commands ) === true, 'valid frame did not submit' );
	assert(
		calls.join( '|' ) === 'encoder:rgpu_frame_encoder|begin:rgpu_frame_pass|pass.end|encoder.finish|submit:1',
		`frame lifecycle order is wrong: ${calls.join( '|' )}`
	);
	assert( module.RGPU_FramePass() === null, 'frame pass escaped past submission' );
	assert( module.RGPU_FrameEnd( commands ) === false, 'frame owner submitted twice' );

	calls.length = 0;
	module.RGPU_FrameBegin( commands, view, module.RGPU_FRAME_CLEAR_COLOR );
	module.RGPU_FrameAbort();
	assert(
		calls.join( '|' ) === 'encoder:rgpu_frame_encoder|begin:rgpu_frame_pass|pass.end',
		'frame abort did not end and discard the pass without submission'
	);
	assert( module.RGPU_FramePass() === null, 'aborted pass remained reachable' );
}


// ---------------------------------------------------------------------------
// test suites: surface configuration & swapchain ownership
// ---------------------------------------------------------------------------

/*
====================
testSurfaceOwnership

Validates canvas context claiming, surface swapchain presentation,
resolution reconfiguration, and clean context release.
====================
*/
async function testSurfaceOwnership( dist ) {
	const vidModule = await import( moduleUrl( dist, 'engine/common/vid.js' ) );
	const surface = await import( moduleUrl(
		dist,
		'engine/com/client/screen/scr_draw/rgpu/rgpu_surface.js'
	) );
	const calls = [];
	const view = Object.freeze( { label: 'surface view' } );
	const context = {
		configure( descriptor ) {
			calls.push( { kind: 'configure', descriptor } );
		},
		unconfigure() {
			calls.push( { kind: 'unconfigure' } );
		},
		getCurrentTexture() {
			calls.push( { kind: 'texture' } );
			return { createView: () => view };
		},
	};
	const canvas = {
		getContext( kind ) {
			calls.push( { kind: `context:${kind}` } );
			return context;
		},
	};
	const device = Object.freeze( { label: 'surface device' } );

	surface.RGPU_SurfaceReset();
	vidModule.vid.canvas = canvas;
	vidModule.vid.width = 800;
	vidModule.vid.height = 600;
	vidModule.vid.valid = true;

	assert( surface.RGPU_SurfaceClaim( canvas ) === true, 'surface owner could not claim WebGPU context' );
	assert( surface.RGPU_SurfaceHasContext() === true, 'claimed context was not retained by surface owner' );
	assert(
		surface.RGPU_SurfaceConfigure( device, 'bgra8unorm', 800, 600 ) === true,
		'valid surface configuration failed'
	);
	assert( surface.RGPU_SurfaceHasSwapchain() === true, 'configured surface was not presentable' );
	assert( surface.RGPU_SurfaceAcquireView() === view, 'surface owner did not attenuate current texture to a view' );

	const configured = calls.find( ( call ) => call.kind === 'configure' );
	assert(
		configured?.descriptor.device === device && configured?.descriptor.format === 'bgra8unorm',
		'surface configuration did not use the parent-provided device and format'
	);

	surface.RGPU_SurfaceMarkResize( 0, 0 );
	assert( surface.RGPU_SurfaceHasSwapchain() === false, 'collapsed resize left swapchain marked presentable' );
	assert(
		surface.RGPU_SurfaceApplyPendingResize( device, 'bgra8unorm', 800, 600 ) === true,
		'pending valid resize did not reconfigure the surface'
	);

	surface.RGPU_SurfaceReset();
	assert( surface.RGPU_SurfaceHasContext() === false, 'surface reset leaked the raw context' );
	assert( calls.some( ( call ) => call.kind === 'unconfigure' ), 'surface reset did not unconfigure the context' );
	vidModule.VID_Init();
}


// ---------------------------------------------------------------------------
// test suites: client UI menu ownership
// ---------------------------------------------------------------------------

/*
====================
testClientMenuOwnership

Validates client menu interaction lifecycle, event listener detachment,
canvas tracking, software cursor presentation, and GPU overlay dispatch.
====================
*/
async function testClientMenuOwnership( dist ) {
	const vidModule = await import( moduleUrl( dist, 'engine/common/vid.js' ) );
	const menu = await import( moduleUrl( dist, 'engine/com/client/cl_main/scr_menu.js' ) );
	const keyListeners = new Map();
	const restoreWindow = installGlobal( 'window', {
		innerWidth: 800,
		innerHeight: 600,
		devicePixelRatio: 1,
		addEventListener( type, listener ) {
			keyListeners.set( type, listener );
		},
		removeEventListener( type, listener ) {
			if ( keyListeners.get( type ) === listener ) {
				keyListeners.delete( type );
			}
		},
	} );

	function makeCanvas( name ) {
		const listeners = new Map();
		return {
			name,
			listeners,
			style: { cursor: '' },
			addEventListener( type, listener ) {
				listeners.set( type, listener );
			},
			removeEventListener( type, listener ) {
				if ( listeners.get( type ) === listener ) {
					listeners.delete( type );
				}
			},
			getBoundingClientRect() {
				return { left: 0, top: 0, width: 800, height: 600 };
			},
		};
	}

	const first = makeCanvas( 'first' );
	const second = makeCanvas( 'second' );

	try {
		vidModule.vid.canvas = first;
		vidModule.vid.width = 800;
		vidModule.vid.height = 600;
		vidModule.vid.dpr = 1;
		vidModule.vid.valid = true;

		menu.SCR_MenuInit( () => {} );
		assert( first.listeners.has( 'click' ), 'menu lifecycle did not bind its owned click listener' );
		assert( keyListeners.has( 'keydown' ), 'menu lifecycle did not bind keyboard navigation' );
		assert( menu.SCR_MenuIsActive() === false, 'menu init implicitly changed semantic UI state' );

		menu.SCR_MenuSetActive( true );
		assert( menu.SCR_MenuIsActive() === true, 'explicit client menu activation was not retained' );
		menu.SCR_MenuFrame( 400, 300 );
		assert( menu.SCR_MenuGpuOverlay() !== null, 'active client menu did not produce a renderer-neutral overlay' );
		assert( first.style.cursor === 'none', 'active menu did not own its software-cursor mode' );

		vidModule.vid.canvas = second;
		menu.SCR_MenuFrame( 200, 150 );
		assert( !first.listeners.has( 'click' ), 'menu listener leaked on the previous canvas' );
		assert( second.listeners.has( 'click' ), 'menu listener did not follow the current canvas' );

		menu.SCR_MenuSetActive( false );
		assert( menu.SCR_MenuGpuOverlay() === null, 'inactive client menu still produced a GPU overlay' );
		assert( second.style.cursor === '', 'inactive menu did not release the canvas cursor style' );

		menu.SCR_MenuShutdown();
		assert( !second.listeners.has( 'click' ), 'menu shutdown leaked its click listener' );
		assert( !keyListeners.has( 'keydown' ), 'menu shutdown leaked its keyboard listener' );
	} finally {
		menu.SCR_MenuShutdown();
		vidModule.VID_Init();
		restoreWindow();
	}
}


// ---------------------------------------------------------------------------
// test suites: parent WebGPU backend orchestration
// ---------------------------------------------------------------------------

/*
====================
testBackendOrchestration

Validates full renderer orchestration including texture loading,
validation error scopes, world/menu pass suppression, and uncaptured error handling.
====================
*/
async function testBackendOrchestration( dist ) {
	const restoreBufferUsage = installGlobal( 'GPUBufferUsage', {
		UNIFORM: 1,
		COPY_DST: 2,
		STORAGE: 4,
	} );
	const restoreTextureUsage = installGlobal( 'GPUTextureUsage', {
		TEXTURE_BINDING: 1,
		COPY_DST: 2,
		RENDER_ATTACHMENT: 16,
	} );
	const restoreShaderStage = installGlobal( 'GPUShaderStage', {
		VERTEX: 1,
		FRAGMENT: 2,
	} );

	const previousGpu = Object.getOwnPropertyDescriptor( globalThis.navigator, 'gpu' );
	const fetchRecords = [];
	const fetchState = { cursorAbortCount: 0 };
	const bitmapState = { created: 0, closed: 0 };

	const restoreFetch = installGlobal( 'fetch', ( url, options = {} ) => {
		const signal = options.signal;
		if ( !signal ) {
			throw new Error( `asset fetch did not receive an AbortSignal: ${String( url )}` );
		}
		fetchRecords.push( { url: String( url ), signal } );

		if ( String( url ).includes( '3_cursor3' ) ) {
			return new Promise( ( resolve, reject ) => {
				const abort = () => {
					fetchState.cursorAbortCount += 1;
					reject( new DOMException( 'aborted', 'AbortError' ) );
				};

				if ( signal.aborted ) {
					abort();
				} else {
					signal.addEventListener( 'abort', abort, { once: true } );
				}
				void resolve;
			} );
		}

		return Promise.resolve( {
			ok: true,
			blob: () => Promise.resolve( new Blob( ['fake-image'] ) ),
			arrayBuffer: () => Promise.resolve( new ArrayBuffer( 64 ) ),
		} );
	} );

	const restoreImageBitmap = installGlobal( 'createImageBitmap', async () => {
		bitmapState.created += 1;
		return {
			width: 64,
			height: 64,
			close() {
				bitmapState.closed += 1;
			},
		};
	} );

	const runtime = makeRuntimeDevice();
	const configureCalls = [];
	const context = {
		configure( descriptor ) {
			configureCalls.push( { kind: 'configure', descriptor } );
		},
		unconfigure() {
			configureCalls.push( { kind: 'unconfigure' } );
		},
		getCurrentTexture() {
			return {
				createView() {
					return Object.freeze( { label: 'backend-surface-view' } );
				},
			};
		},
	};

	const canvas = {
		getContext( kind ) {
			return kind === 'webgpu' ? context : null;
		},
	};

	const adapter = {
		features: new Set(),
		requestDevice( options ) {
			assert( Array.isArray( options.requiredFeatures ), 'backend did not pass an owned feature list to requestDevice' );
			return Promise.resolve( runtime.device );
		},
	};

	Object.defineProperty( globalThis.navigator, 'gpu', {
		configurable: true,
		value: {
			requestAdapter: () => Promise.resolve( adapter ),
			getPreferredCanvasFormat: () => 'bgra8unorm',
		},
	} );

	const vidModule = await import( moduleUrl( dist, 'engine/common/vid.js' ) );
	const backend = await import( moduleUrl( dist, 'engine/com/client/screen/scr_draw/r_webgpu.js' ) );

	const refdef = {
		vieworg: [0, 0, 0],
		viewangles: [0, 0, 0],
		viewaxis: [
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, 1],
		],
		time: 0,
	};

	const overlay = {
		focus_idx: -1,
		cursor_vx: 320,
		cursor_vy: 240,
		items: [],
	};

	try {
		vidModule.vid.canvas = canvas;
		vidModule.vid.width = 800;
		vidModule.vid.height = 600;
		vidModule.vid.dpr = 1;
		vidModule.vid.valid = true;

		backend.RGPU_InitBegin();

		await waitFor( () => {
			backend.RGPU_InitPoll();
			if ( backend.RGPU_IsInitFailed() ) {
				throw new Error( `parent backend failed during initialization: ${backend.RGPU_FailMessage()}` );
			}
			return backend.RGPU_IsReady();
		}, 'parent backend READY state' );

		assert(
			configureCalls.some( ( call ) => call.kind === 'configure' ),
			'parent backend did not configure the surface through its surface owner'
		);

		await waitFor(
			() => (
				runtime.state.createdTextures.includes( 'rgpu_menu_background_texture' ) &&
				runtime.state.createdTextures.includes( 'rgpu_menu_font_texture' ) &&
				fetchRecords.some( ( record ) => record.url.includes( '3_cursor3' ) )
			),
			'validated menu background/font uploads and pending cursor fetch'
		);

		await waitFor( () => runtime.state.scopeCalls.length >= 12, 'serialized WebGPU validation scopes' );

		for ( const label of ['rgpu_menu_background_texture', 'rgpu_menu_font_texture'] ) {
			assert(
				runtime.state.writes.some( ( write ) => (
					write.kind === 'external' && write.args[1].texture.label === label
				) ),
				`${label}: menu image upload did not succeed`
			);
		}

		for ( let i = 0; i < runtime.state.scopeCalls.length; i += 4 ) {
			const group = runtime.state.scopeCalls.slice( i, i + 4 );
			assert(
				group.join( '|' ) === 'push:validation|push:out-of-memory|pop:out-of-memory|pop:validation',
				`error scopes were not unwound in LIFO order: ${group.join( '|' )}`
			);
		}

		let pipelineStart = runtime.state.pipelineLabels.length;
		backend.RGPU_BeginFrame( 800, 600, null );
		backend.RGPU_UploadFrameUniforms( refdef );
		backend.RGPU_DrawWorld( null );
		backend.RGPU_EndFrame();

		const worldPipelines = runtime.state.pipelineLabels.slice( pipelineStart );
		assert(
			worldPipelines.includes( 'rgpu_world_pipeline' ),
			'world frame did not use the world pipeline when menu intent was absent'
		);
		assert(
			!worldPipelines.includes( 'rgpu_menu_bg_pipeline' ),
			'renderer resource readiness activated the menu without client intent'
		);
		assert( runtime.state.submitted.length === 1, 'world frame was not submitted exactly once' );

		const worldClear = runtime.state.renderPasses.at( -1 ).colorAttachments[0].clearValue;

		pipelineStart = runtime.state.pipelineLabels.length;
		backend.RGPU_BeginFrame( 800, 600, overlay );
		backend.RGPU_DrawWorld( overlay );
		backend.RGPU_DrawEntitiesOnList( [], refdef );
		backend.RGPU_EndFrame();

		const menuPipelines = runtime.state.pipelineLabels.slice( pipelineStart );
		assert(
			menuPipelines.includes( 'rgpu_menu_bg_pipeline' ),
			'explicit menu intent did not route the frame through the menu pipeline'
		);
		assert(
			!menuPipelines.includes( 'rgpu_world_pipeline' ),
			'menu frame did not suppress the world after the menu child encoded successfully'
		);
		assert( runtime.state.submitted.length === 2, 'menu frame was not submitted exactly once' );

		const menuClear = runtime.state.renderPasses.at( -1 ).colorAttachments[0].clearValue;
		assert(
			JSON.stringify( worldClear ) !== JSON.stringify( menuClear ),
			'frame clear mode did not follow explicit menu intent'
		);

		const uncaptured = runtime.state.listeners.get( 'uncapturederror' );
		assert( typeof uncaptured === 'function', 'parent backend did not retain epoch-routed uncaptured errors' );
		uncaptured( { error: { message: 'forced orchestration failure' } } );
		await flushPromises();

		assert( backend.RGPU_IsInitFailed(), 'uncaptured GPU error did not enter the failed backend state' );
		assert(
			/forced orchestration failure/.test( backend.RGPU_FailMessage() ),
			'failed backend state did not preserve the uncaptured GPU error'
		);
		assert( fetchState.cursorAbortCount === 1, 'failure teardown did not abort pending child asset work' );
		assert(
			fetchRecords.every( ( record ) => record.signal.aborted ),
			'failure teardown left a child device-epoch signal active'
		);

		backend.RGPU_DrawFailedFrame( 800, 600 );
		assert(
			runtime.state.submitted.length === 3,
			'failure presentation could not use the retained frame/surface capabilities'
		);

		backend.RGPU_Shutdown();
		assert( runtime.state.destroyCount === 1, 'parent backend did not destroy its device exactly once' );
		assert(
			configureCalls.some( ( call ) => call.kind === 'unconfigure' ),
			'parent backend shutdown did not release the surface configuration'
		);
		assert(
			bitmapState.created === bitmapState.closed,
			'completed asynchronous image uploads leaked ImageBitmap resources'
		);
	} finally {
		backend.RGPU_Shutdown();
		vidModule.VID_Init();
		if ( previousGpu ) {
			Object.defineProperty( globalThis.navigator, 'gpu', previousGpu );
		} else {
			delete globalThis.navigator.gpu;
		}
		restoreImageBitmap();
		restoreFetch();
		restoreShaderStage();
		restoreTextureUsage();
		restoreBufferUsage();
	}
}


// ---------------------------------------------------------------------------
// test suites: retail font selection & mutation testing
// ---------------------------------------------------------------------------

/*
====================
testRetailFontSelection

Validates font metric scaling, glyph offsets, UV quad positions,
and multi-size font switching against native reference cases.
====================
*/
async function testRetailFontSelection( dist, variant = 'rgpu_menu_text.js' ) {
	const restore = [
		installGlobal( 'GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 } ),
		installGlobal( 'GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 16 } ),
		installGlobal( 'GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 } ),
		installGlobal( 'fetch', async () => ( { ok: true, blob: async () => new Blob( ['image'] ) } ) ),
		installGlobal( 'createImageBitmap', async () => ( { width: 512, height: 1024, close() {} } ) ),
	];

	const runtime = makeRuntimeDevice();
	const controller = new AbortController();
	const module = await import( moduleUrl(
		dist,
		`engine/com/client/screen/scr_draw/rgpu/rgpu_menu/internal/${variant}`
	) );
	const fixture = JSON.parse(
		fs.readFileSync( path.join( ROOT, 'tools/fixtures/retail_font_selection.json' ), 'utf8' )
	);

	const epoch = {
		id: 9001,
		format: 'bgra8unorm',
		supports_bc: false,
		signal: controller.signal,
		resources: runtime.device,
		upload: runtime.device.queue,
		isCurrent: () => !controller.signal.aborted,
		validate: async ( _label, operation ) => {
			operation();
			return null;
		},
	};

	const pass = {
		setPipeline() {},
		setBindGroup() {},
		draw() {},
	};

	try {
		assert( module.RGPU_MenuTextBuildResources( epoch ), 'menu text core failed' );
		await waitFor( () => module.RGPU_MenuTextResourcesReady(), 'retail font assets' );

		for ( const sample of fixture.cases ) {
			runtime.state.writes.length = 0;
			module.RGPU_MenuTextDraw(
				pass,
				runtime.device.queue,
				( sample.height * 4 ) / 3,
				sample.height,
				{
					focus_idx: -1,
					cursor_vx: 0,
					cursor_vy: 0,
					items: [
						{
							label: 'AA',
							rect_x: 10,
							rect_y: 30,
							rect_w: 100,
							rect_h: 20,
							textscale: sample.textscale,
							textalignx: 0,
							textaligny: 0,
							forecolor: [1, 1, 1, 1],
							focuscolor: [1, 1, 0, 1],
						},
					],
				}
			);

			const writes = runtime.state.writes.filter( ( write ) => write.kind === 'buffer' );
			assert( writes.length === 5, 'two glyphs must draw shadow/foreground plus cursor' );

			const first = new Float32Array( writes[2].data );
			const second = new Float32Array( writes[3].data );
			const glyph = sample.glyph;
			const scale = ( sample.textscale * 48 ) / sample.font_size;
			const expected = [
				10 + glyph.ml * scale,
				30 + glyph.mt * scale,
				glyph.pw * scale,
				glyph.ph * scale,
				glyph.u0 - 0.5 / 512,
				glyph.t0 - 0.5 / 1024,
				glyph.u1 - 0.5 / 512,
				glyph.t1 - 0.5 / 1024,
			];

			expected.forEach( ( value, index ) => {
				assert(
					Math.abs( first[4 + index] - value ) < 0.0001,
					`retail ${sample.font} glyph mismatch at height=${sample.height}, scale=${sample.textscale}, field=${index}`
				);
			} );

			assert(
				Math.abs( second[4] - first[4] - glyph.mr * scale ) < 0.0001,
				'glyph advance did not use the selected retail font'
			);
		}

		if ( variant === 'rgpu_menu_text.js' ) {
			console.log( `Retail font rendering: ok (${fixture.cases.length} native-validated selection cases)` );
		}
	} finally {
		controller.abort();
		module.RGPU_MenuTextDestroyResources();
		restore.reverse().forEach( ( undo ) => undo() );
	}
}

/*
====================
testRetailFontMutations

Executes intentional code mutation attacks against font boundary conditions
to prove test suite regression sensitivity.
====================
*/
async function testRetailFontMutations( dist ) {
	const directory = path.join( dist, 'engine/com/client/screen/scr_draw/rgpu/rgpu_menu/internal' );
	const source = fs.readFileSync( path.join( directory, 'rgpu_menu_text.js' ), 'utf8' );

	const mutations = [
		['small font omitted', 'return smallFontJson;', 'return normalFontJson;'],
		['big font boundary excluded', 'pixel_scale >= Math.fround(0.4)', 'pixel_scale > Math.fround(0.4)'],
		['resolution ignored', 'height * Math.fround(1 / MENU_VIRTUAL_H)', '1'],
		['original fixed-font regression', 'RGPU_MenuTextSelectFont(textscale, height);', 'normalFontJson;'],
	];

	for ( let index = 0; index < mutations.length; index += 1 ) {
		const [label, before, after] = mutations[index];
		assert( source.includes( before ), `font mutation site missing: ${label}` );

		const variant = `font_mutant_${index}.js`;
		fs.writeFileSync( path.join( directory, variant ), source.replace( before, after ) );

		let rejected = false;
		try {
			await testRetailFontSelection( dist, variant );
		} catch ( error ) {
			if ( !/glyph mismatch/.test( String( error ) ) ) {
				throw error;
			}
			rejected = true;
		}

		assert( rejected, `font regression survived: ${label}` );
	}

	console.log( 'Retail font mutations: ok (4 rendering regressions rejected)' );
}


// ---------------------------------------------------------------------------
// main runner
// ---------------------------------------------------------------------------

/*
====================
main

Initializes sandbox environment, builds browser modules, and executes
all WebGPU lifecycle integration tests.
====================
*/
async function main() {
	const sandbox = fs.mkdtempSync( path.join( os.tmpdir(), 'id-webgpu-lifecycle-test-' ) );
	const dist = path.join( sandbox, 'dist' );

	try {
		buildBrowserModules( ROOT, dist );
		await testDeviceEpoch( dist );
		await testFrameOwnership( dist );
		await testSurfaceOwnership( dist );
		await testClientMenuOwnership( dist );
		await testBackendOrchestration( dist );
		await testRetailFontSelection( dist );
		await testRetailFontMutations( dist );
		console.log( 'WebGPU lifecycle test: ok (device epochs, frame/surface ownership, client menu intent, parent orchestration)' );
	} finally {
		fs.rmSync( sandbox, { recursive: true, force: true } );
	}
}

try {
	await main();
} catch ( error ) {
	console.error( error instanceof Error ? error.stack ?? error.message : String( error ) );
	process.exitCode = 1;
}
