/*
===============================================================================

	rgpu_menu_text.ts

	CoD2 menu bitmap text and cursor. This is a private implementation file of
	rgpu_menu.ts, not an independently owned renderer child.

===============================================================================
*/

import { Asset_Fetch } from '../../../../../../../common/asset_paths.js';
import { MENU_MATERIAL_URLS } from './rgpu_menu_materials.js';
import {
	UI_ListScroll,
	UI_FocusPulse,
	UI_SLIDER_WIDTH,
	UI_SLIDER_HEIGHT,
	UI_SLIDER_TRAVEL,
	UI_SLIDER_INSET,
	UI_SLIDER_THUMB_WIDTH,
	UI_SLIDER_THUMB_HEIGHT,
} from '@/engine/common/ui_controls.js';
import {
	UI_TextWidth,
	UI_TextFont,
	UI_TextLines,
	UI_TextLineHeight,
} from '@/engine/common/ui_text.js';
import { UI_PlaceRect, UI_Layout, UI_VIRTUAL_WIDTH, UI_VIRTUAL_HEIGHT } from '@/engine/common/ui_layout.js';
import menuCursorUrl from '@/assets/images/3_cursor3.png?url';
import menuFontAtlasUrl from '@/assets/images/gamefonts.png?url';
import menuFontBc3Url from '@/assets/images/gamefonts.bc3?url';
import normalFontJson from '@/assets/fonts/normalFont.json';
import smallFontJson from '@/assets/fonts/smallFont.json';
import bigFontJson from '@/assets/fonts/bigFont.json';
import extraBigFontJson from '@/assets/fonts/extraBigFont.json';

import { Con_Printf } from '@/engine/common/common.js';
import { Loading_Report } from '@/engine/common/loading.js';
import { rgpu_menu_overlay_t } from '@/engine/common/types.js';
import { rgpu_menu_epoch_t, rgpu_menu_upload_t } from './rgpu_menu_contract.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const MENU_FONT_ATLAS_URL = menuFontAtlasUrl;
const MENU_FONT_BC3_URL = menuFontBc3Url;
const MENU_CURSOR_URL = menuCursorUrl;
const MENU_FONT_ATLAS_W = 512;
const MENU_FONT_ATLAS_H = 1024;
const MENU_VIRTUAL_W = UI_VIRTUAL_WIDTH;
const MENU_VIRTUAL_H = UI_VIRTUAL_HEIGHT;
const MENU_CURSOR_SIZE = 32;
const MENU_CURSOR_HOTSPOT = 16;
const MENU_MAX_ACTIVE_MATERIAL_LOADS = 4;
const MENU_TEXT_SHADOW = 1;
const MENU_TEXT_SHADOW_COLOR: [number, number, number, number] = [ 0.1, 0.1, 0.1, 0.25 ];
const MENU_FONT_NORM_HEIGHT = 48;
const MENU_UNIFORM_STRUCT_SIZE = 64;
const MENU_UNIFORM_SLOT_ALIGN = 256;
const MENU_MAX_TEXT_DRAWS = 8192;
const MENU_UNIFORM_BUFFER_SIZE = MENU_UNIFORM_SLOT_ALIGN * MENU_MAX_TEXT_DRAWS;


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

interface rgpu_menu_glyph_t {
	ml: number;
	mt: number;
	mr: number;
	pw: number;
	ph: number;
	u0: number;
	t0: number;
	u1: number;
	t1: number;
}

interface rgpu_menu_font_json_t {
	font_size: number;
	glyphs: Record<string, rgpu_menu_glyph_t>;
}

interface rgpu_menu_text_res_t {
	pipeline: GPURenderPipeline | null;
	font_sampler: GPUSampler | null;
	cursor_sampler: GPUSampler | null;
	font_texture: GPUTexture | null;
	font_view: GPUTextureView | null;
	font_bc3: boolean;
	cursor_texture: GPUTexture | null;
	cursor_view: GPUTextureView | null;
	uniform_buffer: GPUBuffer | null;
	bind_group_layout: GPUBindGroupLayout | null;
	font_bind_group: GPUBindGroup | null;
	cursor_bind_group: GPUBindGroup | null;
	load_started: boolean;
	font_ready: boolean;
	cursor_ready: boolean;
	epoch_id: number;
}


// ---------------------------------------------------------------------------
// menu material streaming queue
// ---------------------------------------------------------------------------

const menuMaterials = new Map<string, { texture: GPUTexture; bind_group: GPUBindGroup }>();
let menuMaterialEpoch: rgpu_menu_epoch_t | null = null;
let menuMaterialSerial = 0;
let menuMaterialActive = 0;
const menuMaterialQueue: string[] = [];
const menuMaterialPending = new Set<string>();
const menuMaterialFailed = new Set<string>();

/**
 * @exec helper
 * ================
 * RGPU_MenuRequestMaterial
 *
 * Enqueues an on-demand material request for UI background elements.
 * Only the current screen's materials enter this bounded queue.
 * ================
 */
function RGPU_MenuRequestMaterial( name: string ): void {
	if (
		!MENU_MATERIAL_URLS[name] ||
		menuMaterials.has( name ) ||
		menuMaterialPending.has( name ) ||
		menuMaterialFailed.has( name )
	) {
		return;
	}

	menuMaterialPending.add( name );
	menuMaterialQueue.push( name );

	queueMicrotask( () => {
		menuMaterialLoader.pump();
	} );
}

const menuMaterialLoader = {
	pump(): void {
		const epoch = menuMaterialEpoch;
		const serial = menuMaterialSerial;

		if ( !epoch || !RGPU_MenuTextIsCurrent( epoch, serial ) ) {
			return;
		}

		while ( menuMaterialActive < MENU_MAX_ACTIVE_MATERIAL_LOADS && menuMaterialQueue.length ) {
			const name = menuMaterialQueue.shift()!;
			menuMaterialActive++;

			void menuMaterialLoader
				.load( epoch, serial, [name] )
				.finally( () => {
					if ( !RGPU_MenuTextIsCurrent( epoch, serial ) ) {
						return;
					}

					menuMaterialActive--;
					menuMaterialPending.delete( name );

					if ( !menuMaterials.has( name ) ) {
						menuMaterialFailed.add( name );
					}

					menuMaterialLoader.pump();
				} );
		}
	},

	async load( epoch: rgpu_menu_epoch_t, serial: number, names: string[] ): Promise<void> {
		await Promise.all(
			names.map( async ( name ) => {
				const url = MENU_MATERIAL_URLS[name];
				let texture: GPUTexture | null = null;
				let bitmap: ImageBitmap | null = null;

				try {
					bitmap = await RGPU_MenuTextFetchBitmap( url, epoch, serial );

					if ( !bitmap || !RGPU_MenuTextIsCurrent( epoch, serial ) ) {
						return;
					}

					const image = bitmap;
					const created: {
						texture?: GPUTexture;
						binding?: ReturnType<typeof RGPU_MenuTextCreateTextureBindGroup>;
					} = {};

					const error = await epoch.validate( 'menu material ' + name, () => {
						created.texture = epoch.resources.createTexture( {
							label: 'menu material ' + name,
							size: [image.width, image.height, 1],
							format: 'rgba8unorm',
							usage:
								GPUTextureUsage.TEXTURE_BINDING |
								GPUTextureUsage.COPY_DST |
								GPUTextureUsage.RENDER_ATTACHMENT,
						} );
						texture = created.texture;
						epoch.upload.copyExternalImageToTexture(
							{ source: image },
							{ texture: created.texture },
							[image.width, image.height, 1]
						);
						created.binding = RGPU_MenuTextCreateTextureBindGroup(
							epoch,
							created.texture,
							rgpu_menu_text.font_sampler!
						);
					} );

					if ( error || !created.texture || !created.binding || !RGPU_MenuTextIsCurrent( epoch, serial ) ) {
						created.texture?.destroy();

						if ( error ) {
							Con_Printf( error + '\n' );
						}

						return;
					}

					menuMaterials.set( name, {
						texture: created.texture,
						bind_group: created.binding.bind_group,
					} );
				} catch ( error ) {
					( texture as GPUTexture | null )?.destroy();

					if ( !epoch.signal.aborted ) {
						Con_Printf( 'menu material failed: ' + name + ': ' + String( error ) + '\n' );
					}
				} finally {
					bitmap?.close();
				}
			} )
		);
	},
};


// ---------------------------------------------------------------------------
// text state globals
// ---------------------------------------------------------------------------

const rgpu_menu_text: rgpu_menu_text_res_t = {
	pipeline: null,
	font_sampler: null,
	cursor_sampler: null,
	font_texture: null,
	font_view: null,
	font_bc3: false,
	cursor_texture: null,
	cursor_view: null,
	uniform_buffer: null,
	bind_group_layout: null,
	font_bind_group: null,
	cursor_bind_group: null,
	load_started: false,
	font_ready: false,
	cursor_ready: false,
	epoch_id: 0,
};

let rgpu_menu_text_json: rgpu_menu_font_json_t | null = null;
let rgpu_menu_text_uniform_cpu: ArrayBuffer | null = null;
let rgpu_menu_text_uniform_f32: Float32Array | null = null;
let rgpu_menu_text_draw_slot = 0;
let rgpu_menu_text_load_serial = 0;


// ---------------------------------------------------------------------------
// text shaders
// ---------------------------------------------------------------------------

/*
====================
RGPU_MenuTextShaderSource

Produces WGSL shader code for textured 2D quads, font glyphs, and UI stretch elements.
====================
*/
function RGPU_MenuTextShaderSource(): string {
	return `
struct StretchUniforms {
	canvas_size: vec2f,
	alpha_cutoff: f32,
	font_mask: f32,
	rect: vec4f,
	uv_rect: vec4f,
	color: vec4f,
};

@group(0) @binding(0) var stretch_tex: texture_2d<f32>;
@group(0) @binding(1) var stretch_samp: sampler;
@group(0) @binding(2) var<uniform> stretch: StretchUniforms;

struct VSOut {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
};

fn stretch_virtual_to_ndc(vx: f32, vy: f32) -> vec2f {
	let scale = stretch.canvas_size.y / ${MENU_VIRTUAL_H}.0;
	let xoffset = (stretch.canvas_size.x - ${MENU_VIRTUAL_W}.0 * scale) * 0.5;
	let px = xoffset + vx * scale;
	let py = vy * scale;
	let ndc_x = (px / stretch.canvas_size.x) * 2.0 - 1.0;
	let ndc_y = 1.0 - (py / stretch.canvas_size.y) * 2.0;
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
	let corner = corners[vi];
	let vx = stretch.rect.x + corner.x * stretch.rect.z;
	let vy = stretch.rect.y + corner.y * stretch.rect.w;
	var out: VSOut;
	out.position = vec4f(stretch_virtual_to_ndc(vx, vy), 0.0, 1.0);
	out.uv = vec2f(
		mix(stretch.uv_rect.x, stretch.uv_rect.z, corner.x),
		mix(stretch.uv_rect.y, stretch.uv_rect.w, corner.y),
	);
	return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
	let sample = textureSample(stretch_tex, stretch_samp, in.uv);
	if ( stretch.font_mask > 0.5 ) {
		let alpha = sample.a * stretch.color.a;
		return vec4f(stretch.color.rgb, alpha);
	}
	let alpha = sample.a * stretch.color.a;
	return vec4f(sample.rgb * stretch.color.rgb, alpha);
}
`;
}


// ---------------------------------------------------------------------------
// text resources lifecycle
// ---------------------------------------------------------------------------

/*
====================
RGPU_MenuTextIsCurrent

Returns true if the epoch and load serial are current.
====================
*/
function RGPU_MenuTextIsCurrent( epoch: rgpu_menu_epoch_t, serial: number ): boolean {
	return (
		serial === rgpu_menu_text_load_serial &&
		rgpu_menu_text.epoch_id === epoch.id &&
		!epoch.signal.aborted &&
		epoch.isCurrent()
	);
}

/*
====================
RGPU_MenuTextClearFields

Nulls all internal resource handles.
====================
*/
function RGPU_MenuTextClearFields(): void {
	rgpu_menu_text.pipeline = null;
	rgpu_menu_text.font_sampler = null;
	rgpu_menu_text.cursor_sampler = null;
	rgpu_menu_text.font_texture = null;
	rgpu_menu_text.font_view = null;
	rgpu_menu_text.font_bc3 = false;
	rgpu_menu_text.cursor_texture = null;
	rgpu_menu_text.cursor_view = null;
	rgpu_menu_text.uniform_buffer = null;
	rgpu_menu_text.bind_group_layout = null;
	rgpu_menu_text.font_bind_group = null;
	rgpu_menu_text.cursor_bind_group = null;
	rgpu_menu_text.load_started = false;
	rgpu_menu_text.font_ready = false;
	rgpu_menu_text.cursor_ready = false;
	rgpu_menu_text.epoch_id = 0;
	rgpu_menu_text_json = null;
	rgpu_menu_text_uniform_cpu = null;
	rgpu_menu_text_uniform_f32 = null;
	rgpu_menu_text_draw_slot = 0;
}

/*
====================
RGPU_MenuTextCreateCoreResources

Creates samplers, dynamic uniform buffer, shader module, and render pipeline.
====================
*/
function RGPU_MenuTextCreateCoreResources( epoch: rgpu_menu_epoch_t ): boolean {
	const resources = epoch.resources;

	rgpu_menu_text.font_sampler = resources.createSampler( {
		magFilter: 'linear',
		minFilter: 'linear',
		mipmapFilter: 'nearest',
		addressModeU: 'clamp-to-edge',
		addressModeV: 'clamp-to-edge',
	} );

	rgpu_menu_text.cursor_sampler = resources.createSampler( {
		magFilter: 'nearest',
		minFilter: 'nearest',
		mipmapFilter: 'nearest',
		addressModeU: 'clamp-to-edge',
		addressModeV: 'clamp-to-edge',
	} );

	rgpu_menu_text.uniform_buffer = resources.createBuffer( {
		label: 'rgpu_menu_text_uniforms',
		size: MENU_UNIFORM_BUFFER_SIZE,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	} );

	const module = resources.createShaderModule( {
		label: 'rgpu_menu_text_shader',
		code: RGPU_MenuTextShaderSource(),
	} );

	rgpu_menu_text.bind_group_layout = resources.createBindGroupLayout( {
		label: 'rgpu_menu_text_bind_group_layout',
		entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			{
				binding: 2,
				visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
				buffer: {
					type: 'uniform',
					hasDynamicOffset: true,
					minBindingSize: MENU_UNIFORM_STRUCT_SIZE,
				},
			},
		],
	} );

	const pipeline_layout = resources.createPipelineLayout( {
		label: 'rgpu_menu_text_pipeline_layout',
		bindGroupLayouts: [ rgpu_menu_text.bind_group_layout ],
	} );

	rgpu_menu_text.pipeline = resources.createRenderPipeline( {
		label: 'rgpu_menu_text_pipeline',
		layout: pipeline_layout,
		vertex: {
			module,
			entryPoint: 'vs_main',
		},
		fragment: {
			module,
			entryPoint: 'fs_main',
			targets: [ {
				format: epoch.format,
				blend: {
					color: {
						srcFactor: 'src-alpha',
						dstFactor: 'one-minus-src-alpha',
						operation: 'add',
					},
					alpha: {
						srcFactor: 'one',
						dstFactor: 'one-minus-src-alpha',
						operation: 'add',
					},
				},
			} ],
		},
		primitive: { topology: 'triangle-list' },
	} );

	return RGPU_MenuTextCoreResourcesReady();
}

/*
====================
RGPU_MenuTextCreateTextureBindGroup

Binds a texture view and sampler with dynamic uniform offset buffer.
====================
*/
function RGPU_MenuTextCreateTextureBindGroup(
	epoch: rgpu_menu_epoch_t,
	texture: GPUTexture,
	sampler: GPUSampler,
): { view: GPUTextureView; bind_group: GPUBindGroup } | null {
	if ( !rgpu_menu_text.bind_group_layout || !rgpu_menu_text.uniform_buffer ) {
		return null;
	}

	const view = texture.createView();
	const bind_group = epoch.resources.createBindGroup( {
		layout: rgpu_menu_text.bind_group_layout,
		entries: [
			{ binding: 0, resource: view },
			{ binding: 1, resource: sampler },
			{
				binding: 2,
				resource: {
					buffer: rgpu_menu_text.uniform_buffer,
					offset: 0,
					size: MENU_UNIFORM_STRUCT_SIZE,
				},
			},
		],
	} );

	return { view, bind_group };
}

/*
====================
RGPU_MenuTextUploadBitmap

Uploads an RGBA ImageBitmap texture to GPU memory.
====================
*/
async function RGPU_MenuTextUploadBitmap(
	epoch: rgpu_menu_epoch_t,
	serial: number,
	bitmap: ImageBitmap,
	is_cursor: boolean,
): Promise<boolean> {
	const created: {
		texture: GPUTexture | null;
		binding: ReturnType<typeof RGPU_MenuTextCreateTextureBindGroup>;
	} = { texture: null, binding: null };

	try {
		if ( !RGPU_MenuTextIsCurrent( epoch, serial ) ) {
			return false;
		}

		const error = await epoch.validate(
			is_cursor ? 'menu cursor texture upload' : 'menu font PNG texture upload',
			() => {
				created.texture = epoch.resources.createTexture( {
					label: is_cursor ? 'rgpu_menu_cursor_texture' : 'rgpu_menu_font_texture',
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

				created.binding = RGPU_MenuTextCreateTextureBindGroup(
					epoch,
					created.texture,
					is_cursor ? rgpu_menu_text.cursor_sampler! : rgpu_menu_text.font_sampler!,
				);
			}
		);

		if ( error || !created.binding || !created.texture || !RGPU_MenuTextIsCurrent( epoch, serial ) ) {
			if ( error && RGPU_MenuTextIsCurrent( epoch, serial ) ) {
				Con_Printf( error + '\n' );
			}

			created.texture?.destroy();
			return false;
		}

		if ( is_cursor ) {
			rgpu_menu_text.cursor_texture?.destroy();
			rgpu_menu_text.cursor_texture = created.texture;
			rgpu_menu_text.cursor_view = created.binding.view;
			rgpu_menu_text.cursor_bind_group = created.binding.bind_group;
			rgpu_menu_text.cursor_ready = true;
		} else {
			rgpu_menu_text.font_texture?.destroy();
			rgpu_menu_text.font_texture = created.texture;
			rgpu_menu_text.font_view = created.binding.view;
			rgpu_menu_text.font_bind_group = created.binding.bind_group;
			rgpu_menu_text.font_bc3 = false;
			rgpu_menu_text.font_ready = true;
			Con_Printf( 'menu font: PNG fallback path\n' );
		}

		return true;
	} finally {
		bitmap.close();
	}
}

/*
====================
RGPU_MenuTextUploadBc3Font

Uploads hardware-accelerated BC3/DXT5 compressed font atlas.
====================
*/
async function RGPU_MenuTextUploadBc3Font(
	epoch: rgpu_menu_epoch_t,
	serial: number,
	data: ArrayBuffer,
): Promise<boolean> {
	const created: {
		texture: GPUTexture | null;
		binding: ReturnType<typeof RGPU_MenuTextCreateTextureBindGroup>;
	} = { texture: null, binding: null };

	if ( !RGPU_MenuTextIsCurrent( epoch, serial ) || !rgpu_menu_text.font_sampler ) {
		return false;
	}

	const error = await epoch.validate( 'menu font BC3 texture upload', () => {
		created.texture = epoch.resources.createTexture( {
			label: 'rgpu_menu_font_bc3_texture',
			size: [ MENU_FONT_ATLAS_W, MENU_FONT_ATLAS_H, 1 ],
			format: 'bc3-rgba-unorm',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		} );

		epoch.upload.writeTexture(
			{ texture: created.texture },
			data,
			{
				bytesPerRow: Math.ceil( MENU_FONT_ATLAS_W / 4 ) * 16,
				rowsPerImage: Math.ceil( MENU_FONT_ATLAS_H / 4 ),
			},
			[ MENU_FONT_ATLAS_W, MENU_FONT_ATLAS_H, 1 ],
		);

		created.binding = RGPU_MenuTextCreateTextureBindGroup(
			epoch,
			created.texture,
			rgpu_menu_text.font_sampler!,
		);
	} );

	if ( error || !created.binding || !created.texture || !RGPU_MenuTextIsCurrent( epoch, serial ) ) {
		if ( error && RGPU_MenuTextIsCurrent( epoch, serial ) ) {
			Con_Printf( error + '\n' );
		}

		created.texture?.destroy();
		return false;
	}

	rgpu_menu_text.font_texture?.destroy();
	rgpu_menu_text.font_texture = created.texture;
	rgpu_menu_text.font_view = created.binding.view;
	rgpu_menu_text.font_bind_group = created.binding.bind_group;
	rgpu_menu_text.font_bc3 = true;
	rgpu_menu_text.font_ready = true;
	Con_Printf( 'menu font: BC3/DXT5 hardware path\n' );
	return true;
}

/*
====================
RGPU_MenuTextFetchBitmap

Fetches an image resource and decodes it to ImageBitmap.
====================
*/
async function RGPU_MenuTextFetchBitmap(
	url: string,
	epoch: rgpu_menu_epoch_t,
	serial: number,
): Promise<ImageBitmap | null> {
	const response = await Asset_Fetch( url, { signal: epoch.signal } );

	if ( !RGPU_MenuTextIsCurrent( epoch, serial ) ) {
		return null;
	}

	if ( !response.ok ) {
		throw new Error( 'Local menu asset ' + response.status + ': ' + url );
	}

	const blob = await response.blob();

	if ( !RGPU_MenuTextIsCurrent( epoch, serial ) ) {
		return null;
	}

	return createImageBitmap( blob );
}

/*
====================
RGPU_MenuTextBeginLoad

Loads font json, atlas (BC3 or PNG), and cursor assets asynchronously.
====================
*/
function RGPU_MenuTextBeginLoad( epoch: rgpu_menu_epoch_t, serial: number ): void {
	menuMaterialEpoch = epoch;
	menuMaterialSerial = serial;

	void ( async () => {
		try {
			rgpu_menu_text_json = normalFontJson as rgpu_menu_font_json_t;
			let bc3_loaded = false;

			if ( epoch.supports_bc ) {
				try {
					const response = await Asset_Fetch( MENU_FONT_BC3_URL, { signal: epoch.signal } );

					if ( response.ok && RGPU_MenuTextIsCurrent( epoch, serial ) ) {
						const data = await response.arrayBuffer();

						if ( RGPU_MenuTextIsCurrent( epoch, serial ) ) {
							bc3_loaded = await RGPU_MenuTextUploadBc3Font( epoch, serial, data );
						}
					}
				} catch ( error ) {
					if ( !epoch.signal.aborted && RGPU_MenuTextIsCurrent( epoch, serial ) ) {
						Con_Printf( 'menu font BC3 path unavailable; using PNG fallback: ' + String( error ) + '\n' );
					}
				}
			}

			if ( !bc3_loaded && RGPU_MenuTextIsCurrent( epoch, serial ) ) {
				const bitmap = await RGPU_MenuTextFetchBitmap( MENU_FONT_ATLAS_URL, epoch, serial );

				if ( bitmap ) {
					await RGPU_MenuTextUploadBitmap( epoch, serial, bitmap, false );
				}
			}

			if ( !RGPU_MenuTextIsCurrent( epoch, serial ) ) {
				return;
			}

			const bitmap = await RGPU_MenuTextFetchBitmap( MENU_CURSOR_URL, epoch, serial );

			if ( bitmap ) {
				await RGPU_MenuTextUploadBitmap( epoch, serial, bitmap, true );
			}

			if ( RGPU_MenuTextIsCurrent( epoch, serial ) && !RGPU_MenuTextResourcesReady() ) {
				throw new Error( 'The font atlas or cursor could not be uploaded to the GPU.' );
			}
		} catch ( error ) {
			if ( !epoch.signal.aborted && RGPU_MenuTextIsCurrent( epoch, serial ) ) {
				Loading_Report( 'error', 'Menu font or cursor could not load: ' + String( error ) );
				Con_Printf( 'menu text asset load failed: ' + String( error ) + '\n' );
			}
		}
	} )();
}


// ---------------------------------------------------------------------------
// text formatting & draw command emission
// ---------------------------------------------------------------------------

/*
====================
RGPU_MenuTextGetGlyph

Looks up glyph metadata from font atlas definition.
====================
*/
function RGPU_MenuTextGetGlyph( ch: string ): rgpu_menu_glyph_t | null {
	if ( !rgpu_menu_text_json ) {
		return null;
	}

	const glyph = rgpu_menu_text_json.glyphs[ch] ?? rgpu_menu_text_json.glyphs['?'];
	return glyph ?? null;
}

/*
====================
RGPU_MenuTextWriteUniforms

Writes stretch quad uniform parameters into the uniform ring buffer.
====================
*/
function RGPU_MenuTextWriteUniforms(
	upload: rgpu_menu_upload_t,
	width: number,
	height: number,
	vx: number,
	vy: number,
	vw: number,
	vh: number,
	u0: number,
	t0: number,
	u1: number,
	t1: number,
	color: [number, number, number, number],
	alpha_cutoff: number,
	font_mask: boolean,
): number {
	if ( !rgpu_menu_text.uniform_buffer || rgpu_menu_text_draw_slot >= MENU_MAX_TEXT_DRAWS ) {
		return -1;
	}

	if ( !rgpu_menu_text_uniform_cpu ) {
		rgpu_menu_text_uniform_cpu = new ArrayBuffer( MENU_UNIFORM_STRUCT_SIZE );
		rgpu_menu_text_uniform_f32 = new Float32Array( rgpu_menu_text_uniform_cpu );
	}

	const slot = rgpu_menu_text_draw_slot++;
	const offset = slot * MENU_UNIFORM_SLOT_ALIGN;
	const data = rgpu_menu_text_uniform_f32!;

	data[0] = width;
	data[1] = height;
	data[2] = alpha_cutoff;
	data[3] = font_mask ? 1 : 0;
	data[4] = vx;
	data[5] = vy;
	data[6] = vw;
	data[7] = vh;
	data[8] = u0;
	data[9] = t0;
	data[10] = u1;
	data[11] = t1;

	const c = color ?? [ 1, 1, 1, 1 ];
	data[12] = c[0] ?? 1;
	data[13] = c[1] ?? 1;
	data[14] = c[2] ?? 1;
	data[15] = c[3] ?? 1;

	upload.writeBuffer(
		rgpu_menu_text.uniform_buffer,
		offset,
		rgpu_menu_text_uniform_cpu,
		0,
		MENU_UNIFORM_STRUCT_SIZE,
	);

	return offset;
}

/*
====================
RGPU_MenuTextSelectFont

Retail UI_FONT_NORMAL selection: CoD2MP_s.exe 0x532380.
Thresholds apply after screen scaling, even for an explicitly normal font.
====================
*/
function RGPU_MenuTextSelectFont( textscale: number, height: number ): rgpu_menu_font_json_t {
	const screen_scale = Math.fround( height * Math.fround( 1 / MENU_VIRTUAL_H ) );
	const pixel_scale = Math.fround( Math.fround( textscale ) * screen_scale );

	if ( pixel_scale <= Math.fround( 0.25 ) ) {
		return smallFontJson;
	}

	if ( pixel_scale >= Math.fround( 0.55 ) ) {
		return extraBigFontJson;
	}

	if ( pixel_scale >= Math.fround( 0.4 ) ) {
		return bigFontJson;
	}

	return normalFontJson;
}

/*
====================
RGPU_MenuTextEffectiveScale

Computes text scale normalized against standard reference height.
====================
*/
function RGPU_MenuTextEffectiveScale( textscale: number ): number {
	if ( !rgpu_menu_text_json || rgpu_menu_text_json.font_size <= 0 ) {
		return textscale;
	}

	return textscale * ( MENU_FONT_NORM_HEIGHT / rgpu_menu_text_json.font_size );
}

/*
====================
RGPU_MenuTextCorrectFontUV

Applies half-pixel texel offset correction for sampling atlas coordinates.
====================
*/
function RGPU_MenuTextCorrectFontUV(
	u0: number,
	t0: number,
	u1: number,
	t1: number,
): [number, number, number, number] {
	return [
		u0 - ( 0.5 / MENU_FONT_ATLAS_W ),
		t0 - ( 0.5 / MENU_FONT_ATLAS_H ),
		u1 - ( 0.5 / MENU_FONT_ATLAS_W ),
		t1 - ( 0.5 / MENU_FONT_ATLAS_H ),
	];
}

/*
====================
RGPU_MenuTextDrawQuad

Submits a textured 2D quad with uniform parameters.
====================
*/
function RGPU_MenuTextDrawQuad(
	pass: GPURenderPassEncoder,
	upload: rgpu_menu_upload_t,
	width: number,
	height: number,
	bind_group: GPUBindGroup,
	vx: number,
	vy: number,
	vw: number,
	vh: number,
	u0: number,
	t0: number,
	u1: number,
	t1: number,
	color: [number, number, number, number],
	font_mask: boolean,
): void {
	if ( !rgpu_menu_text.pipeline ) {
		return;
	}

	const uniform_offset = RGPU_MenuTextWriteUniforms(
		upload,
		width,
		height,
		vx,
		vy,
		vw,
		vh,
		u0,
		t0,
		u1,
		t1,
		color,
		0,
		font_mask,
	);

	if ( uniform_offset < 0 ) {
		return;
	}

	pass.setPipeline( rgpu_menu_text.pipeline );
	pass.setBindGroup( 0, bind_group, [ uniform_offset ] );
	pass.draw( 6 );
}

/*
====================
RGPU_MenuTextDrawGlyph

Renders a single character glyph using font atlas UV coordinates.
====================
*/
function RGPU_MenuTextDrawGlyph(
	pass: GPURenderPassEncoder,
	upload: rgpu_menu_upload_t,
	width: number,
	height: number,
	glyph: rgpu_menu_glyph_t,
	x: number,
	y: number,
	draw_scale: number,
	color: [number, number, number, number],
): void {
	if ( !rgpu_menu_text.font_bind_group || glyph.pw <= 0 || glyph.ph <= 0 ) {
		return;
	}

	const uv = RGPU_MenuTextCorrectFontUV( glyph.u0, glyph.t0, glyph.u1, glyph.t1 );

	RGPU_MenuTextDrawQuad(
		pass,
		upload,
		width,
		height,
		rgpu_menu_text.font_bind_group,
		x + glyph.ml * draw_scale,
		y + glyph.mt * draw_scale,
		glyph.pw * draw_scale,
		glyph.ph * draw_scale,
		uv[0],
		uv[1],
		uv[2],
		uv[3],
		color,
		true,
	);
}

/*
====================
RGPU_MenuTextDrawString

Draws formatted text with optional drop shadow.
====================
*/
function RGPU_MenuTextDrawString(
	pass: GPURenderPassEncoder,
	upload: rgpu_menu_upload_t,
	width: number,
	height: number,
	text: string,
	x: number,
	y: number,
	textscale: number,
	color: [number, number, number, number],
	shadow: boolean,
	font = 1,
): void {
	rgpu_menu_text_json = RGPU_MenuTextSelectFont( textscale, height );

	if ( font !== 0 && font !== 1 ) {
		rgpu_menu_text_json = UI_TextFont( textscale, height, font );
	}

	const draw_scale = RGPU_MenuTextEffectiveScale( textscale );
	let cx = x;

	if ( shadow ) {
		for ( let i = 0; i < text.length; i++ ) {
			const glyph = RGPU_MenuTextGetGlyph( text[i] );

			if ( !glyph ) {
				continue;
			}

			RGPU_MenuTextDrawGlyph(
				pass,
				upload,
				width,
				height,
				glyph,
				cx + MENU_TEXT_SHADOW,
				y + MENU_TEXT_SHADOW,
				draw_scale,
				MENU_TEXT_SHADOW_COLOR,
			);

			cx += glyph.mr * draw_scale;
		}

		cx = x;
	}

	for ( let i = 0; i < text.length; i++ ) {
		const glyph = RGPU_MenuTextGetGlyph( text[i] );

		if ( !glyph ) {
			continue;
		}

		RGPU_MenuTextDrawGlyph( pass, upload, width, height, glyph, cx, y, draw_scale, color );
		cx += glyph.mr * draw_scale;
	}
}

/*
====================
RGPU_MenuTextDrawCursor

Draws the interactive mouse pointer cursor quad.
====================
*/
function RGPU_MenuTextDrawCursor(
	pass: GPURenderPassEncoder,
	upload: rgpu_menu_upload_t,
	width: number,
	height: number,
	cursor_vx: number,
	cursor_vy: number,
): void {
	if ( !rgpu_menu_text.cursor_bind_group ) {
		return;
	}

	RGPU_MenuTextDrawQuad(
		pass,
		upload,
		width,
		height,
		rgpu_menu_text.cursor_bind_group,
		cursor_vx - MENU_CURSOR_HOTSPOT,
		cursor_vy - MENU_CURSOR_HOTSPOT,
		MENU_CURSOR_SIZE,
		MENU_CURSOR_SIZE,
		0,
		0,
		1,
		1,
		[ 1, 1, 1, 1 ],
		false,
	);
}


// ---------------------------------------------------------------------------
// public text build & draw API
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * RGPU_MenuTextBuildResources
 *
 * Allocates text pipelines, uniform buffers, and begins async font/cursor asset loading.
 * ================
 */
export function RGPU_MenuTextBuildResources( epoch: rgpu_menu_epoch_t ): boolean {
	RGPU_MenuTextDestroyResources();
	rgpu_menu_text.epoch_id = epoch.id;
	rgpu_menu_text.load_started = true;
	const serial = ++rgpu_menu_text_load_serial;

	if ( !RGPU_MenuTextCreateCoreResources( epoch ) ) {
		return false;
	}

	RGPU_MenuTextBeginLoad( epoch, serial );
	return true;
}

/**
 * @exec helper
 * ================
 * RGPU_MenuTextDestroyResources
 *
 * Cleans up text, cursor, and material GPU resources.
 * ================
 */
export function RGPU_MenuTextDestroyResources(): void {
	rgpu_menu_text_load_serial++;

	for ( const material of menuMaterials.values() ) {
		material.texture.destroy();
	}

	menuMaterials.clear();
	menuMaterialEpoch = null;
	menuMaterialActive = 0;
	menuMaterialQueue.length = 0;
	menuMaterialPending.clear();
	menuMaterialFailed.clear();

	if ( rgpu_menu_text.uniform_buffer ) {
		rgpu_menu_text.uniform_buffer.destroy();
	}

	if ( rgpu_menu_text.font_texture ) {
		rgpu_menu_text.font_texture.destroy();
	}

	if ( rgpu_menu_text.cursor_texture ) {
		rgpu_menu_text.cursor_texture.destroy();
	}

	RGPU_MenuTextClearFields();
}

/**
 * @exec helper
 * ================
 * RGPU_MenuTextCoreResourcesReady
 *
 * Returns true if text pipelines and samplers are initialized.
 * ================
 */
export function RGPU_MenuTextCoreResourcesReady(): boolean {
	return (
		rgpu_menu_text.pipeline !== null &&
		rgpu_menu_text.font_sampler !== null &&
		rgpu_menu_text.cursor_sampler !== null &&
		rgpu_menu_text.uniform_buffer !== null &&
		rgpu_menu_text.bind_group_layout !== null
	);
}

/**
 * @exec helper
 * ================
 * RGPU_MenuTextResourcesReady
 *
 * Returns true if font atlas, cursor texture, and all bind groups are ready.
 * ================
 */
export function RGPU_MenuTextResourcesReady(): boolean {
	return (
		RGPU_MenuTextCoreResourcesReady() &&
		rgpu_menu_text.font_ready &&
		rgpu_menu_text.cursor_ready &&
		rgpu_menu_text.font_bind_group !== null &&
		rgpu_menu_text.cursor_bind_group !== null
	);
}

/**
 * @exec per-frame
 * ================
 * RGPU_MenuTextDraw
 *
 * Renders all active UI menu items: backgrounds, borders, text, scrollbars, listboxes, sliders, and cursor.
 * ================
 */
export function RGPU_MenuTextDraw(
	pass: GPURenderPassEncoder,
	upload: rgpu_menu_upload_t,
	width: number,
	height: number,
	overlay: rgpu_menu_overlay_t,
): void {
	if ( !RGPU_MenuTextResourcesReady() ) {
		return;
	}

	rgpu_menu_text_draw_slot = 0;

	for ( let i = 0; i < overlay.items.length; i++ ) {
		const item = overlay.items[i];
		const color = ( i === overlay.focus_idx ? item.focuscolor : item.forecolor ) ?? [ 1, 1, 1, 1 ];
		const layout = UI_Layout( width, height );
		const placed = UI_PlaceRect(
			width,
			height,
			item.rect_x,
			item.rect_y,
			item.rect_w,
			item.rect_h,
			item.horz_align ?? 0,
			item.vert_align ?? 0,
			item.full_bleed
		);

		const x = ( placed.x - layout.xoffset ) / layout.scale;
		const y = placed.y / layout.scale;
		const w = placed.w / layout.scale;
		const h = placed.h / layout.scale;

		const quad = (
			material: string,
			qx: number,
			qy: number,
			qw: number,
			qh: number,
			tint: [number, number, number, number]
		): void => {
			const binding = menuMaterials.get( material );
			const t = tint ?? [ 1, 1, 1, 1 ];

			if ( !binding && ( t[3] ?? 1 ) > 0 ) {
				RGPU_MenuRequestMaterial( material );
			}

			if ( binding && ( t[3] ?? 1 ) > 0 ) {
				RGPU_MenuTextDrawQuad(
					pass,
					upload,
					width,
					height,
					binding.bind_group,
					qx,
					qy,
					qw,
					qh,
					0,
					0,
					1,
					1,
					t,
					false
				);
			}
		};

		// Window_Paint (0x539db0) precedes the item-type dispatch at 0x541f24.
		if ( item.style === 1 ) {
			quad( item.background ?? 'white', x, y, w, h, item.backcolor ?? [ 0, 0, 0, 0 ] );
		}

		if ( ( item.style === 3 || item.style === 6 ) && item.background ) {
			quad( item.background, x, y, w, h, item.forecolor ?? [ 1, 1, 1, 1 ] );
		}

		if ( item.border && item.bordercolor ) {
			const b = item.bordersize ?? 1;

			if ( item.border === 1 || item.border === 2 ) {
				quad( 'white', x, y, w, b, item.bordercolor );
				quad( 'white', x, y + h - b, w, b, item.bordercolor );
			}

			if ( item.border === 1 || item.border === 3 ) {
				quad( 'white', x, y, b, h, item.bordercolor );
				quad( 'white', x + w - b, y, b, h, item.bordercolor );
			}
		}

		const textWidth = UI_TextWidth( item.label, item.textscale, height, item.textfont );
		const alignOffset = item.textalign === 2
			? textWidth
			: ( item.textalign === 1 || item.textalign === 3 )
				? Math.trunc( textWidth / 2 )
				: 0;

		const tx = x + item.textalignx - alignOffset;
		const ty = y + item.textaligny;

		const lines = item.autowrapped || item.wrapped
			? UI_TextLines( item.label, item.textscale, w, height, item.textfont, !!item.autowrapped )
			: [ item.label ];

		for ( let line = 0; line < lines.length; line++ ) {
			const lw = UI_TextWidth( lines[line], item.textscale, height, item.textfont );
			const offset = item.textalign === 2
				? lw
				: ( item.textalign === 1 || item.textalign === 3 )
					? Math.trunc( lw / 2 )
					: 0;

			RGPU_MenuTextDrawString(
				pass,
				upload,
				width,
				height,
				lines[line],
				x + item.textalignx - offset,
				ty + line * UI_TextLineHeight( item.textscale ),
				item.textscale,
				color,
				item.textstyle === undefined || item.textstyle === 3 || item.textstyle === 6,
				item.textfont
			);
		}

		if ( item.rows ) {
			const rowHeight = item.row_height || 20;
			const scroll = UI_ListScroll( h, rowHeight, item.rows.length, item.row_start || 0 );
			const first = scroll.start;
			const count = Math.floor( h / rowHeight );

			if ( !item.noscrollbars ) {
				const sx = x + w - 17;
				quad( 'ui/assets/scrollbar_arrow_up_a.tga', sx, y + 1, 16, 16, [ 1, 1, 1, 1 ] );
				quad( 'ui/assets/scrollbar.tga', sx, y + 17, 16, Math.max( 0, h - 34 ), [ 1, 1, 1, 1 ] );
				quad( 'ui/assets/scrollbar_arrow_dwn_a.tga', sx, y + h - 17, 16, 16, [ 1, 1, 1, 1 ] );
				quad( 'ui/assets/scrollbar_thumb.tga', sx, y + scroll.thumb, 16, 16, [ 1, 1, 1, 1 ] );
			}

			for ( let row = first; row < Math.min( item.rows.length, first + count ); row++ ) {
				const ry = y + 1 + ( row - first ) * rowHeight;
				const column = item.columns?.[0] ?? [ 0, w, 0 ];
				const label = column[2] ? item.rows[row].slice( 0, column[2] ) : item.rows[row];

				// Columnless path 0x5413c1 ignores textalign offsets; column path 0x5412c6 uses them.
				RGPU_MenuTextDrawString(
					pass,
					upload,
					width,
					height,
					label,
					item.columns?.length ? x + 1 + column[0] + item.textalignx + 4 : x + 5,
					ry + rowHeight + ( item.columns?.length ? item.textaligny : 0 ),
					item.textscale,
					item.forecolor ?? [ 1, 1, 1, 1 ],
					item.textstyle === 3,
					item.textfont
				);

				if ( row === item.row_selected ) {
					quad( 'white', x + 3, ry + 2, w - 4 - ( item.noscrollbars ? 0 : 16 ), rowHeight, item.outlinecolor ?? [ 0, 0, 0, 0 ] );
				}
			}
		}

		if ( item.value_label !== undefined ) {
			// Native yes/no, multi, bind: append the value after label extents + 8.
			const vx = item.label ? tx + textWidth + 8 : tx;
			RGPU_MenuTextDrawString(
				pass,
				upload,
				width,
				height,
				item.value_label,
				vx,
				ty,
				item.textscale,
				color,
				item.textstyle === 3,
				item.textfont
			);
		}

		if ( item.slider_fraction !== undefined ) {
			const sx = item.label ? tx + textWidth + 8 : x;
			const tint = ( i === overlay.focus_idx ? UI_FocusPulse( item.focuscolor ?? [ 1, 1, 1, 1 ], performance.now() ) : item.forecolor ) ?? [ 1, 1, 1, 1 ];

			quad( 'ui/assets/slider2.tga', sx, y, UI_SLIDER_WIDTH, UI_SLIDER_HEIGHT, tint );
			quad(
				'ui/assets/sliderbutt_1',
				sx + UI_SLIDER_INSET + item.slider_fraction * UI_SLIDER_TRAVEL - UI_SLIDER_THUMB_WIDTH / 2,
				y - 2,
				UI_SLIDER_THUMB_WIDTH,
				UI_SLIDER_THUMB_HEIGHT,
				tint
			);
		}
	}

	if ( !overlay.hide_cursor ) {
		RGPU_MenuTextDrawCursor( pass, upload, width, height, overlay.cursor_vx, overlay.cursor_vy );
	}
}

/**
 * @exec helper
 * ================
 * RGPU_MenuTextPresentationReady
 *
 * Visible material requests are discovered during drawing, before boot handoff.
 * ================
 */
export function RGPU_MenuTextPresentationReady(): boolean {
	return RGPU_MenuTextResourcesReady() && menuMaterialPending.size === 0;
}
