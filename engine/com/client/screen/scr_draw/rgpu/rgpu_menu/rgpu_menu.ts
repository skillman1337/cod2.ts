/*
===============================================================================

	rgpu_menu.ts

	CoD2 MP menu backdrop and text composition. Parent owns device epochs,
	frame passes, and queue submission; this child receives only construction,
	upload, and frame-local pass capabilities.

===============================================================================
*/

import menuBgUrl from '@/assets/images/background_american_w.png?url';

import { rgpu_menu_overlay_t } from '@/engine/common/types.js';
import {
	UI_HORZ_ALIGN_SUBLEFT,
	UI_VERT_ALIGN_SUBTOP,
	UI_VIRTUAL_WIDTH,
	UI_VIRTUAL_HEIGHT,
	UI_PlaceRect,
} from '@/engine/common/ui_layout.js';
import { Con_Printf } from '@/engine/common/common.js';
import { Loading_Report } from '@/engine/common/loading.js';
import { rgpu_menu_epoch_t, rgpu_menu_upload_t } from './internal/rgpu_menu_contract.js';
import {
	RGPU_MenuTextBuildResources,
	RGPU_MenuTextCoreResourcesReady,
	RGPU_MenuTextPresentationReady,
	RGPU_MenuTextDestroyResources,
	RGPU_MenuTextDraw,
} from './internal/rgpu_menu_text.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const MENU_BG_URL = menuBgUrl;
const MENU_BG_RECT_X = -128;
const MENU_BG_RECT_Y = 0;
const MENU_BG_RECT_W = 896;
const MENU_BG_RECT_H = UI_VIRTUAL_HEIGHT;
const MENU_VIRTUAL_W = UI_VIRTUAL_WIDTH;
const MENU_VIRTUAL_H = UI_VIRTUAL_HEIGHT;
const MENU_UNIFORM_SIZE = 32;
const MENU_LETTERBOX_CLEAR: GPUColor = { r: 0, g: 0, b: 0, a: 1 };


// ---------------------------------------------------------------------------
// types & state globals
// ---------------------------------------------------------------------------

interface rgpu_menu_res_t {
	pipeline: GPURenderPipeline | null;
	bind_group: GPUBindGroup | null;
	sampler: GPUSampler | null;
	texture: GPUTexture | null;
	texture_view: GPUTextureView | null;
	uniform_buffer: GPUBuffer | null;
	load_started: boolean;
	load_ready: boolean;
	epoch_id: number;
}

const rgpu_menu: rgpu_menu_res_t = {
	pipeline: null,
	bind_group: null,
	sampler: null,
	texture: null,
	texture_view: null,
	uniform_buffer: null,
	load_started: false,
	load_ready: false,
	epoch_id: 0,
};

let rgpu_menu_uniform_cpu: ArrayBuffer | null = null;
let rgpu_menu_uniform_f32: Float32Array | null = null;
let rgpu_menu_load_serial = 0;


// ---------------------------------------------------------------------------
// shader definitions
// ---------------------------------------------------------------------------

/*
====================
RGPU_MenuShaderSource

Produces the WGSL source for rendering the full-screen menu background quad.
====================
*/
function RGPU_MenuShaderSource(): string {
	return `
struct MenuUniforms {
	canvas_size: vec2f,
	_pad0: vec2f,
	rect: vec4f,
};

@group(0) @binding(0) var menu_tex: texture_2d<f32>;
@group(0) @binding(1) var menu_samp: sampler;
@group(0) @binding(2) var<uniform> menu: MenuUniforms;

struct VSOut {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
};

fn menu_virtual_to_ndc(vx: f32, vy: f32) -> vec2f {
	let scale = menu.canvas_size.y / ${MENU_VIRTUAL_H}.0;
	let xoffset = (menu.canvas_size.x - ${MENU_VIRTUAL_W}.0 * scale) * 0.5;
	let px = xoffset + vx * scale;
	let py = vy * scale;
	let ndc_x = (px / menu.canvas_size.x) * 2.0 - 1.0;
	let ndc_y = 1.0 - (py / menu.canvas_size.y) * 2.0;
	return vec2f(ndc_x, ndc_y);
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
	var corners = array(
		vec2f(0.0, 0.0),
		vec2f(1.0, 0.0),
		vec2f(0.0, 1.0),
		vec2f(1.0, 0.0),
		vec2f(1.0, 1.0),
		vec2f(0.0, 1.0),
	);
	let uv = corners[vi];
	let vx = menu.rect.x + uv.x * menu.rect.z;
	let vy = menu.rect.y + uv.y * menu.rect.w;
	var out: VSOut;
	out.position = vec4f(menu_virtual_to_ndc(vx, vy), 0.0, 1.0);
	out.uv = uv;
	return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
	return textureSample(menu_tex, menu_samp, in.uv);
}
`;
}


// ---------------------------------------------------------------------------
// resource state & lifecycle
// ---------------------------------------------------------------------------

/*
====================
RGPU_MenuIsCurrent

Validates if a menu epoch and background load serial remain active.
====================
*/
function RGPU_MenuIsCurrent( epoch: rgpu_menu_epoch_t, serial: number ): boolean {
	return (
		serial === rgpu_menu_load_serial &&
		rgpu_menu.epoch_id === epoch.id &&
		!epoch.signal.aborted &&
		epoch.isCurrent()
	);
}

/*
====================
RGPU_MenuClearFields

Nulls all internal resource references.
====================
*/
function RGPU_MenuClearFields(): void {
	rgpu_menu.pipeline = null;
	rgpu_menu.bind_group = null;
	rgpu_menu.sampler = null;
	rgpu_menu.texture = null;
	rgpu_menu.texture_view = null;
	rgpu_menu.uniform_buffer = null;
	rgpu_menu.load_started = false;
	rgpu_menu.load_ready = false;
	rgpu_menu.epoch_id = 0;
	rgpu_menu_uniform_cpu = null;
	rgpu_menu_uniform_f32 = null;
}

/*
====================
RGPU_MenuBackgroundCoreResourcesReady

Returns true if pipeline, sampler, and uniform buffer are allocated.
====================
*/
function RGPU_MenuBackgroundCoreResourcesReady(): boolean {
	return (
		rgpu_menu.pipeline !== null &&
		rgpu_menu.sampler !== null &&
		rgpu_menu.uniform_buffer !== null
	);
}

/*
====================
RGPU_MenuCreateCoreResources

Creates background shader, pipeline layout, sampler, and uniform buffer.
====================
*/
function RGPU_MenuCreateCoreResources( epoch: rgpu_menu_epoch_t ): boolean {
	const resources = epoch.resources;

	rgpu_menu.sampler = resources.createSampler( {
		magFilter: 'linear',
		minFilter: 'linear',
		mipmapFilter: 'linear',
	} );

	rgpu_menu.uniform_buffer = resources.createBuffer( {
		label: 'rgpu_menu_uniforms',
		size: MENU_UNIFORM_SIZE,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	} );

	const bg_module = resources.createShaderModule( {
		label: 'rgpu_menu_bg_shader',
		code: RGPU_MenuShaderSource(),
	} );

	const bg_layout = resources.createBindGroupLayout( {
		label: 'rgpu_menu_bg_bind_group_layout',
		entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			{ binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
		],
	} );

	const bg_pipeline_layout = resources.createPipelineLayout( {
		label: 'rgpu_menu_bg_pipeline_layout',
		bindGroupLayouts: [ bg_layout ],
	} );

	rgpu_menu.pipeline = resources.createRenderPipeline( {
		label: 'rgpu_menu_bg_pipeline',
		layout: bg_pipeline_layout,
		vertex: { module: bg_module, entryPoint: 'vs_main' },
		fragment: {
			module: bg_module,
			entryPoint: 'fs_main',
			targets: [ { format: epoch.format } ],
		},
		primitive: { topology: 'triangle-list' },
	} );

	return RGPU_MenuBackgroundCoreResourcesReady();
}


// ---------------------------------------------------------------------------
// background texture loading & upload
// ---------------------------------------------------------------------------

/*
====================
RGPU_MenuUploadBackground

Uploads decoded ImageBitmap to GPU texture and binds it to the menu pipeline.
====================
*/
async function RGPU_MenuUploadBackground(
	epoch: rgpu_menu_epoch_t,
	serial: number,
	bitmap: ImageBitmap,
): Promise<boolean> {
	const created: {
		texture: GPUTexture | null;
		view: GPUTextureView | null;
		bind_group: GPUBindGroup | null;
	} = { texture: null, view: null, bind_group: null };

	try {
		if (
			!RGPU_MenuIsCurrent( epoch, serial ) ||
			!rgpu_menu.pipeline ||
			!rgpu_menu.sampler ||
			!rgpu_menu.uniform_buffer
		) {
			return false;
		}

		const error = await epoch.validate( 'menu background texture upload', () => {
			created.texture = epoch.resources.createTexture( {
				label: 'rgpu_menu_background_texture',
				size: [ bitmap.width, bitmap.height, 1 ],
				format: 'rgba8unorm',
				// External image copies require a renderable destination texture.
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
			} );

			epoch.upload.copyExternalImageToTexture(
				{ source: bitmap },
				{ texture: created.texture },
				[ bitmap.width, bitmap.height, 1 ],
			);

			created.view = created.texture.createView();

			created.bind_group = epoch.resources.createBindGroup( {
				label: 'rgpu_menu_background_bind_group',
				layout: rgpu_menu.pipeline!.getBindGroupLayout( 0 ),
				entries: [
					{ binding: 0, resource: created.view },
					{ binding: 1, resource: rgpu_menu.sampler! },
					{ binding: 2, resource: { buffer: rgpu_menu.uniform_buffer! } },
				],
			} );
		} );

		if ( error || !created.texture || !created.view || !created.bind_group || !RGPU_MenuIsCurrent( epoch, serial ) ) {
			if ( error && RGPU_MenuIsCurrent( epoch, serial ) ) {
				Con_Printf( 'menu background upload failed: ' + error + '\n' );
			}

			created.texture?.destroy();
			return false;
		}

		rgpu_menu.texture?.destroy();
		rgpu_menu.texture = created.texture;
		rgpu_menu.texture_view = created.view;
		rgpu_menu.bind_group = created.bind_group;
		rgpu_menu.load_ready = true;
		return true;
	} finally {
		bitmap.close();
	}
}

/*
====================
RGPU_MenuBeginTextureLoad

Asynchronously fetches and decodes the background artwork image bitmap.
====================
*/
function RGPU_MenuBeginTextureLoad( epoch: rgpu_menu_epoch_t, serial: number ): void {
	void ( async () => {
		try {
			const response = await fetch( MENU_BG_URL, { signal: epoch.signal } );

			if ( !RGPU_MenuIsCurrent( epoch, serial ) ) {
				return;
			}

			if ( !response.ok ) {
				throw new Error( 'Menu background returned ' + response.status );
			}

			const blob = await response.blob();

			if ( !RGPU_MenuIsCurrent( epoch, serial ) ) {
				return;
			}

			const bitmap = await createImageBitmap( blob );

			if ( !RGPU_MenuIsCurrent( epoch, serial ) ) {
				bitmap.close();
				return;
			}

			const uploaded = await RGPU_MenuUploadBackground( epoch, serial, bitmap );

			if ( !uploaded && RGPU_MenuIsCurrent( epoch, serial ) ) {
				throw new Error( 'Menu background GPU upload failed.' );
			}
		} catch ( error ) {
			if ( !epoch.signal.aborted && RGPU_MenuIsCurrent( epoch, serial ) ) {
				Loading_Report( 'error', 'Menu background could not load: ' + String( error ) );
				Con_Printf( 'menu background load failed: ' + String( error ) + '\n' );
			}
		}
	} )();
}


// ---------------------------------------------------------------------------
// uniform buffer uploads & draw pass
// ---------------------------------------------------------------------------

/*
====================
RGPU_MenuUploadUniforms

Computes virtual-to-canvas coordinate mapping and writes the uniform buffer.
====================
*/
function RGPU_MenuUploadUniforms( upload: rgpu_menu_upload_t, width: number, height: number ): void {
	if ( !rgpu_menu.uniform_buffer ) {
		return;
	}

	if ( !rgpu_menu_uniform_cpu ) {
		rgpu_menu_uniform_cpu = new ArrayBuffer( MENU_UNIFORM_SIZE );
		rgpu_menu_uniform_f32 = new Float32Array( rgpu_menu_uniform_cpu );
	}

	const data = rgpu_menu_uniform_f32!;
	data[0] = width;
	data[1] = height;

	const placed = UI_PlaceRect( width, height, MENU_BG_RECT_X, MENU_BG_RECT_Y, MENU_BG_RECT_W, MENU_BG_RECT_H, UI_HORZ_ALIGN_SUBLEFT, UI_VERT_ALIGN_SUBTOP, true );
	const scale = height / MENU_VIRTUAL_H;
	const xoffset = ( width - MENU_VIRTUAL_W * scale ) * 0.5;

	data[4] = ( placed.x - xoffset ) / scale;
	data[5] = placed.y / scale;
	data[6] = placed.w / scale;
	data[7] = placed.h / scale;

	upload.writeBuffer( rgpu_menu.uniform_buffer, 0, rgpu_menu_uniform_cpu, 0, MENU_UNIFORM_SIZE );
}

/*
====================
RGPU_MenuDrawPass

Encodes the background quad draw call into the render pass.
====================
*/
function RGPU_MenuDrawPass(
	pass: GPURenderPassEncoder,
	upload: rgpu_menu_upload_t,
	width: number,
	height: number,
): void {
	if ( !RGPU_MenuResourcesReady() || !rgpu_menu.pipeline || !rgpu_menu.bind_group ) {
		return;
	}

	RGPU_MenuUploadUniforms( upload, width, height );
	pass.setPipeline( rgpu_menu.pipeline );
	pass.setBindGroup( 0, rgpu_menu.bind_group );
	pass.draw( 6 );
}


// ---------------------------------------------------------------------------
// public menu drawing & lifecycle API
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * RGPU_MenuBuildResources
 *
 * Allocates background and text pipeline resources and initiates background artwork load.
 * ================
 */
export function RGPU_MenuBuildResources( epoch: rgpu_menu_epoch_t ): boolean {
	RGPU_MenuDestroyResources();
	rgpu_menu.epoch_id = epoch.id;
	rgpu_menu.load_started = true;
	const serial = ++rgpu_menu_load_serial;

	if ( !RGPU_MenuCreateCoreResources( epoch ) ) {
		return false;
	}

	if ( !RGPU_MenuTextBuildResources( epoch ) ) {
		return false;
	}

	RGPU_MenuBeginTextureLoad( epoch, serial );
	return RGPU_MenuCoreResourcesReady();
}

/**
 * @exec helper
 * ================
 * RGPU_MenuDestroyResources
 *
 * Destroys all background and text GPU resources and increments the load serial.
 * ================
 */
export function RGPU_MenuDestroyResources(): void {
	rgpu_menu_load_serial++;
	RGPU_MenuTextDestroyResources();

	if ( rgpu_menu.uniform_buffer ) {
		rgpu_menu.uniform_buffer.destroy();
	}

	if ( rgpu_menu.texture ) {
		rgpu_menu.texture.destroy();
	}

	RGPU_MenuClearFields();
}

/**
 * @exec helper
 * ================
 * RGPU_MenuCoreResourcesReady
 *
 * Returns true if core pipelines for background and text are ready.
 * ================
 */
export function RGPU_MenuCoreResourcesReady(): boolean {
	return RGPU_MenuBackgroundCoreResourcesReady() && RGPU_MenuTextCoreResourcesReady();
}

/**
 * @exec helper
 * ================
 * RGPU_MenuResourcesReady
 *
 * Returns true if all textures, bind groups, and pipelines are fully ready.
 * ================
 */
export function RGPU_MenuResourcesReady(): boolean {
	return (
		RGPU_MenuCoreResourcesReady() &&
		rgpu_menu.load_ready &&
		rgpu_menu.bind_group !== null
	);
}

/**
 * @exec helper
 * ================
 * RGPU_MenuLetterboxClear
 *
 * Clear color for the menu letterbox bars.
 * ================
 */
export function RGPU_MenuLetterboxClear(): GPUColor {
	return MENU_LETTERBOX_CLEAR;
}

/**
 * @exec helper
 * ================
 * RGPU_MenuDrawBackground
 *
 * Renders the full-screen menu background and text overlays.
 * ================
 */
export function RGPU_MenuDrawBackground(
	pass: GPURenderPassEncoder,
	upload: rgpu_menu_upload_t,
	width: number,
	height: number,
	overlay: rgpu_menu_overlay_t | null,
): boolean {
	if ( !RGPU_MenuResourcesReady() ) {
		return false;
	}

	if ( !overlay?.console_only ) {
		RGPU_MenuDrawPass( pass, upload, width, height );
	}

	if ( overlay ) {
		RGPU_MenuTextDraw( pass, upload, width, height, overlay );
	}

	return true;
}

/**
 * @exec helper
 * ================
 * RGPU_MenuPresentationReady
 *
 * Returns true when all essential menu images and atlases are uploaded.
 * ================
 */
export function RGPU_MenuPresentationReady(): boolean {
	return RGPU_MenuResourcesReady() && RGPU_MenuTextPresentationReady();
}
