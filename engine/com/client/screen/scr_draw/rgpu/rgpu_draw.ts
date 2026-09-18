/*
===============================================================================

	rgpu_draw.ts

	Scene draw entry points and GPU resource build.

===============================================================================
*/

import { entity_render_t, refdef_t } from '@/engine/common/types.js';
import { vid } from '@/engine/common/vid.js';
import {
	RGPU_ViewmodelPrepare,
	RGPU_ViewmodelDestroy,
	RGPU_ViewmodelDraw,
	RGPU_ViewmodelMuzzle,
} from './internal/rgpu_viewmodel.js';
import {
	RGPU_WeaponFXPrepare,
	RGPU_WeaponFXDestroy,
	RGPU_WeaponFXDraw,
} from './internal/rgpu_weaponfx.js';
import {
	RGPU_CharacterPrepare,
	RGPU_CharacterDestroy,
	RGPU_CharacterDraw,
} from './internal/rgpu_character.js';
import { Level_WorldVisible } from '@/engine/common/level.js';
import {
	RGPU_LevelPrepare,
	RGPU_LevelCamera,
	RGPU_LevelDraw,
	RGPU_LevelDepth,
	RGPU_LevelDestroy,
	RGPU_LevelSceneTarget,
	RGPU_LevelBlurTarget,
	RGPU_LevelBlur,
} from './internal/rgpu_level.js';

import type {
	rgpu_draw_resources_t,
	rgpu_draw_upload_t,
} from './internal/rgpu_draw_contract.js';


let rgpu_draw_resources: rgpu_draw_resources_t | null = null;


/**
 * ================
 * RGPU_DrawSetResources
 * ================
 */
function RGPU_DrawSetResources( resources: rgpu_draw_resources_t | null ): void {
	rgpu_draw_resources = resources;
}



// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const RGPU_FRAME_UNIFORM_SIZE = 32;
const RGPU_ENTITY_MAX = 64;
const RGPU_ENTITY_STRIDE = 16;
const RGPU_ENTITY_BUFFER_SIZE = RGPU_ENTITY_MAX * RGPU_ENTITY_STRIDE;
const RGPU_MARKER_VERTS = 3;


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

interface rgpu_draw_res_t {
	world_pipeline: GPURenderPipeline | null;
	marker_pipeline: GPURenderPipeline | null;
	frame_ubo: GPUBuffer | null;
	entity_buffer: GPUBuffer | null;
	world_bind_group: GPUBindGroup | null;
	marker_bind_group: GPUBindGroup | null;
	entity_count: number;
}


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

const rgpu_draw: rgpu_draw_res_t = {
	world_pipeline: null,
	marker_pipeline: null,
	frame_ubo: null,
	entity_buffer: null,
	world_bind_group: null,
	marker_bind_group: null,
	entity_count: 0,
};

let rgpu_frame_uniform_cpu: ArrayBuffer | null = null;
let rgpu_frame_uniform_f32: Float32Array | null = null;
let rgpu_entity_cpu: ArrayBuffer | null = null;
let rgpu_entity_f32: Float32Array | null = null;


// ---------------------------------------------------------------------------
// forward
// RGPU_WorldShaderSource, RGPU_MarkerShaderSource
// RGPU_UniformBindGroupEntry, RGPU_EntityStorageBindGroupEntry
// RGPU_AlphaBlendFactors, RGPU_OneAlphaBlend, RGPU_MarkerBlendState
// RGPU_CreateWorldShaderModule, RGPU_CreateWorldBindGroupLayout
// RGPU_CreateWorldPipelineLayout, RGPU_WorldVertexState, RGPU_WorldFragmentTarget
// RGPU_WorldFragmentState, RGPU_WorldRenderPipelineDesc, RGPU_CreateWorldPipeline
// RGPU_MarkerBindGroupLayoutEntries, RGPU_MarkerBindGroupEntries
// RGPU_CreateMarkerShaderModule, RGPU_CreateMarkerBindGroupLayout
// RGPU_CreateMarkerPipelineLayout, RGPU_MarkerFragmentTarget
// RGPU_MarkerFragmentState, RGPU_MarkerRenderPipelineDesc, RGPU_CreateMarkerPipeline
// RGPU_BufferBindResource, RGPU_FrameUboBindEntry, RGPU_EntityBufferBindEntry
// RGPU_CreateWorldBindGroup, RGPU_CreateMarkerBindGroup
// RGPU_CreateFrameUniforms, RGPU_CreateEntityBuffer
// RGPU_ClearCpuUploadBuffers, RGPU_EnsureFrameUniformCpu, RGPU_EnsureEntityCpu
// RGPU_FrameUniformCpu, RGPU_EntityCpu, RGPU_DestroyResources
// RGPU_DrawWorldPass, RGPU_DrawMarkerRange
// RGPU_PackEntitySlot, RGPU_UploadEntityBuffer
// RGPU_Vec3Copy, RGPU_EntityFromOrigin, RGPU_ParticleOrigin, RGPU_WeaponOrigin
// RGPU_AppendEntityMarkers, RGPU_AppendParticleMarker, RGPU_AppendWeaponMarker
// RGPU_SceneMarkerCounts, RGPU_BuildSceneMarkers
// RGPU_DrawParticleMarkers
// ---------------------------------------------------------------------------


/**
 * @exec per-frame
 * ================
 * RGPU_WorldShaderSource
 *
 * Minimal fullscreen pass until BSP and map load exist.
 * ================
 */
function RGPU_WorldShaderSource(): string {
	return `
struct FrameUniforms {
	time: f32,
	vieworg: vec3f,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
	var pos = array(
		vec2f(-1.0, -1.0),
		vec2f( 3.0, -1.0),
		vec2f(-1.0,  3.0),
	);
	return vec4f(pos[vi], 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
	let t = frame.time;
	let uv = pos.xy / vec2f(640.0, 480.0);
	let horizon = smoothstep(0.35, 0.55, uv.y);
	let grid = abs(sin((frame.vieworg.x + uv.x * 128.0) * 0.08))
	         * abs(sin((frame.vieworg.y + uv.y * 128.0) * 0.08));
	let sky = vec3f(
		0.10 + 0.06 * sin(t * 0.7),
		0.16 + 0.05 * cos(t * 0.5),
		0.32 + 0.08 * sin(t * 0.3 + 1.0),
	);
	let floor = vec3f(0.08, 0.10, 0.12) * (0.55 + 0.45 * grid);
	let col = mix(floor, sky, horizon);
	return vec4f(col, 1.0);
}
`;
}


/**
 * @exec per-frame
 * ================
 * RGPU_MarkerShaderSource
 *
 * World-space entity markers, particles, and view weapon placeholder.
 * kind: 0 = entity, 1 = particle, 2 = view model
 * ================
 */
function RGPU_MarkerShaderSource(): string {
	return `
struct FrameUniforms {
	time: f32,
	vieworg: vec3f,
};

struct Entity {
	origin: vec3f,
	kind: f32,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<storage, read> entities: array<Entity>;

struct VSOut {
	@builtin(position) position: vec4f,
	@location(0) @interpolate(flat) instance: u32,
};

@vertex
fn vs_main(
	@builtin(vertex_index) vi: u32,
	@builtin(instance_index) ii: u32,
) -> VSOut {
	let ent = entities[ii];
	let rel = ent.origin - frame.vieworg;
	let scale = 0.012;
	var tri = array(
		vec2f( 0.0,  0.025),
		vec2f(-0.018, -0.012),
		vec2f( 0.018, -0.012),
	);
	var pos: vec2f;
	var out: VSOut;

	out.instance = ii;

	if ( ent.kind > 1.5 ) {
		pos = tri[vi] * 1.8 + vec2f(0.0, -0.72);
		out.position = vec4f(pos, 0.0, 1.0);
		return out;
	}

	if ( ent.kind > 0.5 ) {
		pos = tri[vi] * 0.6 + vec2f(rel.x * scale, rel.y * scale);
		out.position = vec4f(pos, 0.0, 1.0);
		return out;
	}

	pos = tri[vi] + vec2f(rel.x * scale, rel.y * scale);
	out.position = vec4f(pos, 0.0, 1.0);
	return out;
}

@fragment
fn fs_main(@location(0) @interpolate(flat) ii: u32) -> @location(0) vec4f {
	let kind = entities[ii].kind;
	if ( kind > 1.5 ) {
		return vec4f(0.85, 0.75, 0.55, 0.95);
	}
	if ( kind > 0.5 ) {
		let t = frame.time;
		return vec4f(
			0.95 + 0.05 * sin(t * 8.0 + f32(ii)),
			0.55 + 0.35 * cos(t * 6.0),
			0.20,
			0.85
		);
	}
	return vec4f(0.95, 0.35, 0.25, 0.95);
}
`;
}


// ---------------------------------------------------------------------------
// bind layout
// ---------------------------------------------------------------------------

/**
 * ================
 * RGPU_UniformBindGroupEntry
 * ================
 */
function RGPU_UniformBindGroupEntry(): GPUBindGroupLayoutEntry {
	return {
		binding: 0,
		visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
		buffer: { type: 'uniform' },
	};
}


/**
 * @exec per-frame
 * ================
 * RGPU_EntityStorageBindGroupEntry
 * ================
 */
function RGPU_EntityStorageBindGroupEntry(): GPUBindGroupLayoutEntry {
	return {
		binding: 1,
		visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
		buffer: { type: 'read-only-storage' },
	};
}


/**
 * @exec per-frame
 * ================
 * RGPU_AlphaBlendFactors
 * ================
 */
function RGPU_AlphaBlendFactors(): GPUBlendComponent {
	return {
		srcFactor: 'src-alpha',
		dstFactor: 'one-minus-src-alpha',
	};
}


/**
 * @exec per-frame
 * ================
 * RGPU_OneAlphaBlend
 * ================
 */
function RGPU_OneAlphaBlend(): GPUBlendComponent {
	return {
		srcFactor: 'one',
		dstFactor: 'one-minus-src-alpha',
	};
}


/**
 * @exec per-frame
 * ================
 * RGPU_MarkerBlendState
 * ================
 */
function RGPU_MarkerBlendState(): GPUBlendState {
	return {
		color: RGPU_AlphaBlendFactors(),
		alpha: RGPU_OneAlphaBlend(),
	};
}


// ---------------------------------------------------------------------------
// world pipeline
// ---------------------------------------------------------------------------

/**
 * @exec per-frame
 * ================
 * RGPU_CreateWorldShaderModule
 * ================
 */
function RGPU_CreateWorldShaderModule(): GPUShaderModule {
	return rgpu_draw_resources!.createShaderModule( {
		label: 'rgpu_world_shader',
		code: RGPU_WorldShaderSource(),
	} );
}


/**
 * @exec per-frame
 * ================
 * RGPU_CreateWorldBindGroupLayout
 * ================
 */
function RGPU_CreateWorldBindGroupLayout(): GPUBindGroupLayout {
	return rgpu_draw_resources!.createBindGroupLayout( {
		label: 'rgpu_world_bind_layout',
		entries: [ RGPU_UniformBindGroupEntry() ],
	} );
}


/**
 * @exec per-frame
 * ================
 * RGPU_CreateWorldPipelineLayout
 * ================
 */
function RGPU_CreateWorldPipelineLayout( layout: GPUBindGroupLayout ): GPUPipelineLayout {
	return rgpu_draw_resources!.createPipelineLayout( {
		label: 'rgpu_world_pipeline_layout',
		bindGroupLayouts: [ layout ],
	} );
}


/**
 * ================
 * RGPU_WorldVertexState
 * ================
 */
function RGPU_WorldVertexState( shader: GPUShaderModule ): GPUVertexState {
	return {
		module: shader,
		entryPoint: 'vs_main',
	};
}


/**
 * @exec per-frame
 * ================
 * RGPU_WorldFragmentTarget
 * ================
 */
function RGPU_WorldFragmentTarget(): GPUColorTargetState {
	return {
		format: rgpu_draw_resources!.format,
	};
}


/**
 * @exec per-frame
 * ================
 * RGPU_WorldFragmentState
 * ================
 */
function RGPU_WorldFragmentState( shader: GPUShaderModule ): GPUFragmentState {
	return {
		module: shader,
		entryPoint: 'fs_main',
		targets: [ RGPU_WorldFragmentTarget() ],
	};
}


/**
 * @exec per-frame
 * ================
 * RGPU_WorldRenderPipelineDesc
 * ================
 */
function RGPU_WorldRenderPipelineDesc(
	shader: GPUShaderModule,
	pipeline_layout: GPUPipelineLayout,
): GPURenderPipelineDescriptor {
	return {
		label: 'rgpu_world_pipeline',
		layout: pipeline_layout,
		vertex: RGPU_WorldVertexState( shader ),
		fragment: RGPU_WorldFragmentState( shader ),
		primitive: { topology: 'triangle-list' },
	};
}


/**
 * @exec per-frame
 * ================
 * RGPU_CreateWorldPipeline
 * ================
 */
function RGPU_CreateWorldPipeline(): GPURenderPipeline | null {
	let shader: GPUShaderModule;
	let layout: GPUBindGroupLayout;
	let pipeline_layout: GPUPipelineLayout;

	if ( !rgpu_draw_resources )
		return null;

	shader = RGPU_CreateWorldShaderModule();
	layout = RGPU_CreateWorldBindGroupLayout();
	pipeline_layout = RGPU_CreateWorldPipelineLayout( layout );
	return rgpu_draw_resources.createRenderPipeline( RGPU_WorldRenderPipelineDesc( shader, pipeline_layout ) );
}


// ---------------------------------------------------------------------------
// marker pipeline
// ---------------------------------------------------------------------------

/**
 * @exec per-frame
 * ================
 * RGPU_MarkerBindGroupLayoutEntries
 * ================
 */
function RGPU_MarkerBindGroupLayoutEntries(): GPUBindGroupLayoutEntry[] {
	return [
		RGPU_UniformBindGroupEntry(),
		RGPU_EntityStorageBindGroupEntry(),
	];
}


/**
 * @exec per-frame
 * ================
 * RGPU_MarkerBindGroupEntries
 * ================
 */
function RGPU_MarkerBindGroupEntries(): GPUBindGroupEntry[] {
	return [
		RGPU_FrameUboBindEntry(),
		RGPU_EntityBufferBindEntry(),
	];
}


/**
 * @exec per-frame
 * ================
 * RGPU_CreateMarkerShaderModule
 * ================
 */
function RGPU_CreateMarkerShaderModule(): GPUShaderModule {
	return rgpu_draw_resources!.createShaderModule( {
		label: 'rgpu_marker_shader',
		code: RGPU_MarkerShaderSource(),
	} );
}


/**
 * @exec per-frame
 * ================
 * RGPU_CreateMarkerBindGroupLayout
 * ================
 */
function RGPU_CreateMarkerBindGroupLayout(): GPUBindGroupLayout {
	return rgpu_draw_resources!.createBindGroupLayout( {
		label: 'rgpu_marker_bind_layout',
		entries: RGPU_MarkerBindGroupLayoutEntries(),
	} );
}


/**
 * @exec per-frame
 * ================
 * RGPU_CreateMarkerPipelineLayout
 * ================
 */
function RGPU_CreateMarkerPipelineLayout( layout: GPUBindGroupLayout ): GPUPipelineLayout {
	return rgpu_draw_resources!.createPipelineLayout( {
		label: 'rgpu_marker_pipeline_layout',
		bindGroupLayouts: [ layout ],
	} );
}


/**
 * @exec per-frame
 * ================
 * RGPU_MarkerFragmentTarget
 * ================
 */
function RGPU_MarkerFragmentTarget(): GPUColorTargetState {
	return {
		format: rgpu_draw_resources!.format,
		blend: RGPU_MarkerBlendState(),
	};
}


/**
 * @exec per-frame
 * ================
 * RGPU_MarkerFragmentState
 * ================
 */
function RGPU_MarkerFragmentState( shader: GPUShaderModule ): GPUFragmentState {
	return {
		module: shader,
		entryPoint: 'fs_main',
		targets: [ RGPU_MarkerFragmentTarget() ],
	};
}


/**
 * @exec per-frame
 * ================
 * RGPU_MarkerRenderPipelineDesc
 * ================
 */
function RGPU_MarkerRenderPipelineDesc(
	shader: GPUShaderModule,
	pipeline_layout: GPUPipelineLayout,
): GPURenderPipelineDescriptor {
	return {
		label: 'rgpu_marker_pipeline',
		layout: pipeline_layout,
		vertex: RGPU_WorldVertexState( shader ),
		fragment: RGPU_MarkerFragmentState( shader ),
		primitive: { topology: 'triangle-list' },
	};
}


/**
 * @exec per-frame
 * ================
 * RGPU_CreateMarkerPipeline
 * ================
 */
function RGPU_CreateMarkerPipeline(): GPURenderPipeline | null {
	let shader: GPUShaderModule;
	let layout: GPUBindGroupLayout;
	let pipeline_layout: GPUPipelineLayout;

	if ( !rgpu_draw_resources )
		return null;

	shader = RGPU_CreateMarkerShaderModule();
	layout = RGPU_CreateMarkerBindGroupLayout();
	pipeline_layout = RGPU_CreateMarkerPipelineLayout( layout );
	return rgpu_draw_resources.createRenderPipeline( RGPU_MarkerRenderPipelineDesc( shader, pipeline_layout ) );
}


// ---------------------------------------------------------------------------
// bind groups
// ---------------------------------------------------------------------------

/**
 * ================
 * RGPU_BufferBindResource
 * ================
 */
function RGPU_BufferBindResource( buffer: GPUBuffer ): GPUBufferBinding {
	return { buffer };
}


/**
 * ================
 * RGPU_FrameUboBindEntry
 * ================
 */
function RGPU_FrameUboBindEntry(): GPUBindGroupEntry {
	return {
		binding: 0,
		resource: RGPU_BufferBindResource( rgpu_draw.frame_ubo! ),
	};
}


/**
 * @exec per-frame
 * ================
 * RGPU_EntityBufferBindEntry
 * ================
 */
function RGPU_EntityBufferBindEntry(): GPUBindGroupEntry {
	return {
		binding: 1,
		resource: RGPU_BufferBindResource( rgpu_draw.entity_buffer! ),
	};
}


/**
 * @exec per-frame
 * ================
 * RGPU_CreateWorldBindGroup
 * ================
 */
function RGPU_CreateWorldBindGroup(): GPUBindGroup {
	return rgpu_draw_resources!.createBindGroup( {
		label: 'rgpu_world_bind_group',
		layout: rgpu_draw.world_pipeline!.getBindGroupLayout( 0 ),
		entries: [ RGPU_FrameUboBindEntry() ],
	} );
}


/**
 * @exec per-frame
 * ================
 * RGPU_CreateMarkerBindGroup
 * ================
 */
function RGPU_CreateMarkerBindGroup(): GPUBindGroup {
	return rgpu_draw_resources!.createBindGroup( {
		label: 'rgpu_marker_bind_group',
		layout: rgpu_draw.marker_pipeline!.getBindGroupLayout( 0 ),
		entries: RGPU_MarkerBindGroupEntries(),
	} );
}


// ---------------------------------------------------------------------------
// buffers
// ---------------------------------------------------------------------------

/**
 * @exec per-frame
 * ================
 * RGPU_CreateFrameUniforms
 * ================
 */
function RGPU_CreateFrameUniforms(): boolean {
	if ( !rgpu_draw_resources || !rgpu_draw.world_pipeline || !rgpu_draw.marker_pipeline )
		return false;

	rgpu_draw.frame_ubo = rgpu_draw_resources.createBuffer( {
		label: 'rgpu_frame_ubo',
		size: RGPU_FRAME_UNIFORM_SIZE,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	} );

	rgpu_draw.world_bind_group = RGPU_CreateWorldBindGroup();
	rgpu_draw.marker_bind_group = RGPU_CreateMarkerBindGroup();
	return true;
}


/**
 * @exec per-frame
 * ================
 * RGPU_CreateEntityBuffer
 * ================
 */
function RGPU_CreateEntityBuffer(): boolean {
	if ( !rgpu_draw_resources )
		return false;

	rgpu_draw.entity_buffer = rgpu_draw_resources.createBuffer( {
		label: 'rgpu_entity_buffer',
		size: RGPU_ENTITY_BUFFER_SIZE,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	} );

	return true;
}


/**
 * ================
 * RGPU_ClearCpuUploadBuffers
 *
 * Drop reused CPU staging buffers on shutdown or resource rebuild.
 * ================
 */
function RGPU_ClearCpuUploadBuffers(): void {
	rgpu_frame_uniform_cpu = null;
	rgpu_frame_uniform_f32 = null;
	rgpu_entity_cpu = null;
	rgpu_entity_f32 = null;
}


/**
 * @exec per-frame
 * ================
 * RGPU_EnsureFrameUniformCpu
 * ================
 */
function RGPU_EnsureFrameUniformCpu(): void {
	if ( rgpu_frame_uniform_cpu )
		return;

	rgpu_frame_uniform_cpu = new ArrayBuffer( RGPU_FRAME_UNIFORM_SIZE );
	rgpu_frame_uniform_f32 = new Float32Array( rgpu_frame_uniform_cpu );
}


/**
 * @exec per-frame
 * ================
 * RGPU_FrameUniformCpu
 *
 * Reused staging buffer for frame uniform uploads.
 * ================
 */
function RGPU_FrameUniformCpu(): Float32Array {
	RGPU_EnsureFrameUniformCpu();
	return rgpu_frame_uniform_f32!;
}


/**
 * @exec per-frame
 * ================
 * RGPU_EnsureEntityCpu
 * ================
 */
function RGPU_EnsureEntityCpu(): void {
	if ( rgpu_entity_cpu )
		return;

	rgpu_entity_cpu = new ArrayBuffer( RGPU_ENTITY_BUFFER_SIZE );
	rgpu_entity_f32 = new Float32Array( rgpu_entity_cpu );
}


/**
 * @exec per-frame
 * ================
 * RGPU_EntityCpu
 *
 * Reused staging buffer for entity storage uploads.
 * ================
 */
function RGPU_EntityCpu(): Float32Array {
	RGPU_EnsureEntityCpu();
	return rgpu_entity_f32!;
}


/**
 * ================
 * RGPU_DestroyResources
 *
 * Drop draw resources.  RGPU_Shutdown calls this before device release.
 * ================
 */
export function RGPU_DestroyResources(): void {
    RGPU_LevelDestroy();
    RGPU_ViewmodelDestroy();
    RGPU_WeaponFXDestroy();
    RGPU_CharacterDestroy();
	if ( rgpu_draw.frame_ubo )
		rgpu_draw.frame_ubo.destroy();

	if ( rgpu_draw.entity_buffer )
		rgpu_draw.entity_buffer.destroy();

	rgpu_draw.world_pipeline = null;
	rgpu_draw.marker_pipeline = null;
	rgpu_draw.frame_ubo = null;
	rgpu_draw.entity_buffer = null;
	rgpu_draw.world_bind_group = null;
	rgpu_draw.marker_bind_group = null;
	rgpu_draw.entity_count = 0;

	RGPU_ClearCpuUploadBuffers();
	RGPU_DrawSetResources( null );
}


// ---------------------------------------------------------------------------
// draw passes
// ---------------------------------------------------------------------------

/**
 * @exec per-frame
 * ================
 * RGPU_DrawWorldPass
 * ================
 */
function RGPU_DrawWorldPass( pass: GPURenderPassEncoder ): void {
	if ( !rgpu_draw.world_pipeline || !rgpu_draw.world_bind_group )
		return;

	pass.setPipeline( rgpu_draw.world_pipeline );
	pass.setBindGroup( 0, rgpu_draw.world_bind_group );
	pass.draw( 3 );
}


/**
 * ================
 * RGPU_DrawMarkerRange
 *
 * Draw instanced markers from a sub-range of the entity storage buffer.
 * ================
 */
function RGPU_DrawMarkerRange( pass: GPURenderPassEncoder, first_instance: number, count: number ): void {
	if ( count < 1 )
		return;

	if ( !rgpu_draw.marker_pipeline || !rgpu_draw.marker_bind_group )
		return;

	pass.setPipeline( rgpu_draw.marker_pipeline );
	pass.setBindGroup( 0, rgpu_draw.marker_bind_group );
	pass.draw( RGPU_MARKER_VERTS, count, 0, first_instance );
}


/**
 * @exec per-frame
 * ================
 * RGPU_DrawParticleMarkers
 *
 * Draw particle slot when present; returns next instance offset.
 * ================
 */
function RGPU_DrawParticleMarkers( pass: GPURenderPassEncoder, offset: number, particle_count: number ): number {
	if ( particle_count < 1 )
		return offset;

	RGPU_DrawMarkerRange( pass, offset, particle_count );
	return offset + particle_count;
}


// ---------------------------------------------------------------------------
// entity upload
// ---------------------------------------------------------------------------

/**
 * @exec per-frame
 * ================
 * RGPU_PackEntitySlot
 *
 * Write one entity row into the CPU staging buffer.
 * kind: 0 entity, 1 particle, 2 view model
 * ================
 */
function RGPU_PackEntitySlot(
	data: Float32Array,
	slot: number,
	entry: entity_render_t,
	kind: number,
): void {
	let base: number;

	base = slot * 4;
	data[base + 0] = entry.origin[0];
	data[base + 1] = entry.origin[1];
	data[base + 2] = entry.origin[2];
	data[base + 3] = kind;
}


/**
 * @exec per-frame
 * ================
 * RGPU_UploadEntityBuffer
 *
 * Pack entity origins and kind tags into the storage buffer.
 * ================
 */
function RGPU_UploadEntityBuffer( upload: rgpu_draw_upload_t, entries: entity_render_t[], kinds: number[] ): number {
	let data: Float32Array;
	let i: number;
	let count: number;

	if ( !rgpu_draw.entity_buffer )
		return 0;

	count = entries.length;
	if ( count > RGPU_ENTITY_MAX )
		count = RGPU_ENTITY_MAX;

	rgpu_draw.entity_count = count;

	data = RGPU_EntityCpu();
	data.fill( 0 );

	for ( i = 0; i < count; i++ )
		RGPU_PackEntitySlot( data, i, entries[i], kinds[i] );

	upload.writeBuffer( rgpu_draw.entity_buffer, 0, rgpu_entity_cpu!, 0, RGPU_ENTITY_BUFFER_SIZE );
	return count;
}


/**
 * ================
 * RGPU_Vec3Copy
 * ================
 */
function RGPU_Vec3Copy( src: number[] ): [number, number, number] {
	return [ src[0], src[1], src[2] ];
}


/**
 * ================
 * RGPU_EntityFromOrigin
 * ================
 */
function RGPU_EntityFromOrigin( origin: number[] ): entity_render_t {
	return { origin: RGPU_Vec3Copy( origin ) };
}


/**
 * @exec per-frame
 * ================
 * RGPU_ParticleOrigin
 *
 * Spark bob height above the first entity origin.
 * ================
 */
function RGPU_ParticleOrigin( entities: entity_render_t[], time: number ): entity_render_t {
	let origin: number[];

	origin = [
		entities[0].origin[0],
		entities[0].origin[1],
		entities[0].origin[2] + 8 + Math.sin( time * 6.0 ) * 4,
	];
	return RGPU_EntityFromOrigin( origin );
}


/**
 * @exec per-frame
 * ================
 * RGPU_WeaponOrigin
 *
 * View weapon placeholder offset from refdef.
 * ================
 */
function RGPU_WeaponOrigin( refdef: refdef_t ): entity_render_t {
	let origin: number[];

	origin = [
		refdef.vieworg[0] + refdef.viewaxis[0][0] * 24,
		refdef.vieworg[1] + refdef.viewaxis[0][1] * 24,
		refdef.vieworg[2] + refdef.viewaxis[0][2] * 24 - 12,
	];
	return RGPU_EntityFromOrigin( origin );
}


/**
 * @exec per-frame
 * ================
 * RGPU_AppendEntityMarkers
 *
 * Copy server edict origins into upload lists.
 * ================
 */
function RGPU_AppendEntityMarkers(
	entities: entity_render_t[],
	entries: entity_render_t[],
	kinds: number[],
): void {
	let i: number;

	for ( i = 0; i < entities.length; i++ ) {
		entries.push( RGPU_EntityFromOrigin( entities[i].origin ) );
		kinds.push( 0 );
	}
}


/**
 * @exec per-frame
 * ================
 * RGPU_AppendParticleMarker
 * ================
 */
function RGPU_AppendParticleMarker(
	entities: entity_render_t[],
	time: number,
	entries: entity_render_t[],
	kinds: number[],
): void {
	if ( entities.length < 1 )
		return;

	entries.push( RGPU_ParticleOrigin( entities, time ) );
	kinds.push( 1 );
}


/**
 * @exec per-frame
 * ================
 * RGPU_AppendWeaponMarker
 * ================
 */
function RGPU_AppendWeaponMarker(
	refdef: refdef_t,
	entries: entity_render_t[],
	kinds: number[],
): void {
    if(refdef.hideWeapon)return;
	entries.push( RGPU_WeaponOrigin( refdef ) );
	kinds.push( 2 );
}


/**
 * @exec per-frame
 * ================
 * RGPU_SceneMarkerCounts
 *
 * Derive draw ranges from upload totals.
 * Returns [entity_count, particle_count, viewmodel_count].
 * ================
 */
function RGPU_SceneMarkerCounts(
	kinds: number[],
	total: number,
): [number, number, number] {
    const counts:[number,number,number]=[0,0,0];
    for(let i=0;i<total;i++)counts[kinds[i]]++;
    return counts;
}


/**
 * @exec per-frame
 * ================
 * RGPU_BuildSceneMarkers
 *
 * Pack entity, particle, and view-model slots into one storage upload.
 * Returns [entity_count, particle_count, viewmodel_count].
 * ================
 */
function RGPU_BuildSceneMarkers(
	upload: rgpu_draw_upload_t,
	entities: entity_render_t[],
	time: number,
	refdef: refdef_t,
): [number, number, number] {
	let entries: entity_render_t[];
	let kinds: number[];
	let total: number;

	entries = [];
	kinds = [];

	RGPU_AppendEntityMarkers( entities, entries, kinds );
	RGPU_AppendParticleMarker( entities, time, entries, kinds );
	RGPU_AppendWeaponMarker( refdef, entries, kinds );

	total = RGPU_UploadEntityBuffer( upload, entries, kinds );
	return RGPU_SceneMarkerCounts( kinds, total );
}


// ---------------------------------------------------------------------------
// resources
// ---------------------------------------------------------------------------

/**
 * @exec per-frame
 * ================
 * RGPU_BuildResources
 *
 * Depth, pipelines, static buffers — world pass + marker instancing.
 * Called once from RGPU_InitPoll before READY.
 * ================
 */
export function RGPU_BuildResources( resources: rgpu_draw_resources_t ): boolean {
	RGPU_DestroyResources();
	RGPU_DrawSetResources( resources );

	try {
		if ( !RGPU_CreateEntityBuffer() )
			return false;

		rgpu_draw.world_pipeline = RGPU_CreateWorldPipeline();
		rgpu_draw.marker_pipeline = RGPU_CreateMarkerPipeline();
		if ( !rgpu_draw.world_pipeline || !rgpu_draw.marker_pipeline )
			return false;

		if ( !RGPU_CreateFrameUniforms() )
			return false;

		return RGPU_ResourcesReady();
	} finally {
		// Resource construction is a temporary capability. Drawing never retains it.
		RGPU_DrawSetResources( null );
	}
}


/**
 * @exec per-frame
 * ================
 * RGPU_ResourcesReady
 *
 * True when draw pipelines and buffers exist.
 * ================
 */
export function RGPU_ResourcesReady(): boolean {
	return (
		rgpu_draw.world_pipeline !== null &&
		rgpu_draw.marker_pipeline !== null &&
		rgpu_draw.frame_ubo !== null &&
		rgpu_draw.entity_buffer !== null &&
		rgpu_draw.world_bind_group !== null &&
		rgpu_draw.marker_bind_group !== null
	);
}


// ---------------------------------------------------------------------------
// draw
// ---------------------------------------------------------------------------

/**
 * @exec per-frame
 * ================
 * RGPU_UploadUniforms
 * ================
 */
export function RGPU_UploadUniforms( upload: rgpu_draw_upload_t, refdef: refdef_t ): void {
    RGPU_LevelCamera(upload,refdef,(vid.width||640)/(vid.height||480));
	let data: Float32Array;

	if ( !rgpu_draw.frame_ubo )
		return;

	data = RGPU_FrameUniformCpu();
	data[0] = refdef.time;
	data[1] = refdef.vieworg[0];
	data[2] = refdef.vieworg[1];
	data[3] = refdef.vieworg[2];
	upload.writeBuffer( rgpu_draw.frame_ubo, 0, rgpu_frame_uniform_cpu!, 0, RGPU_FRAME_UNIFORM_SIZE );
}

/**
 * @exec per-frame
 * ================
 * RGPU_PrepareLevel
 *
 * Parent supplies the live construction capability for each asset handoff.
 * ================
 */
export function RGPU_PrepareLevel(
	resources: rgpu_draw_resources_t,
	upload: rgpu_draw_upload_t
): void {
	RGPU_LevelPrepare( resources, upload );
	RGPU_ViewmodelPrepare( resources, upload );
	RGPU_WeaponFXPrepare( resources, upload );
	RGPU_CharacterPrepare( resources, upload );
}

/**
 * @exec helper
 * ================
 * RGPU_DrawSceneTarget
 *
 * Acquires offscreen scene color target for post-process blur.
 * ================
 */
export function RGPU_DrawSceneTarget( width: number, height: number ): GPUTextureView | null {
	return RGPU_LevelSceneTarget( width, height );
}

/**
 * @exec helper
 * ================
 * RGPU_DrawBlurTarget
 *
 * Acquires intermediate ping-pong blur target.
 * ================
 */
export function RGPU_DrawBlurTarget(): GPUTextureView | null {
	return RGPU_LevelBlurTarget();
}

/**
 * @exec helper
 * ================
 * RGPU_DrawBlur
 *
 * Renders separable Gaussian blur pass along horizontal or vertical axis.
 * ================
 */
export function RGPU_DrawBlur(
	pass: GPURenderPassEncoder,
	upload: rgpu_draw_upload_t,
	axis: number,
	width: number,
	height: number,
	radius: number
): void {
	RGPU_LevelBlur( pass, upload, axis, width, height, radius );
}


/**
 * @exec per-frame
 * ================
 * RGPU_DrawWorldImpl
 * ================
 */
export function RGPU_DrawWorldImpl( pass: GPURenderPassEncoder ): void {
	if ( Level_WorldVisible() ) {
		RGPU_LevelDraw( pass );
		return;
	}

	RGPU_DrawWorldPass( pass );
}

/**
 * @exec helper
 * ================
 * RGPU_DrawDepth
 *
 * Returns active depth-stencil texture view for world geometry pass.
 * ================
 */
export function RGPU_DrawDepth( width: number, height: number ): GPUTextureView | null {
	return Level_WorldVisible() ? RGPU_LevelDepth( width, height ) : null;
}


/**
 * @exec per-frame
 * ================
 * RGPU_DrawEntities
 *
 * Dispatches character, viewmodel, or placeholder entity marker passes.
 * ================
 */
export function RGPU_DrawEntities(
	pass: GPURenderPassEncoder,
	upload: rgpu_draw_upload_t,
	entities: entity_render_t[],
	refdef: refdef_t
): void {
	if ( Level_WorldVisible() ) {
		if ( refdef.thirdPerson ) {
			RGPU_CharacterDraw( pass, upload, refdef, ( vid.width || 640 ) / ( vid.height || 480 ) );
		} else {
			RGPU_ViewmodelDraw( pass, upload, refdef, ( vid.width || 640 ) / ( vid.height || 480 ) );
			RGPU_WeaponFXDraw(
				pass,
				upload,
				refdef,
				vid.width || 640,
				vid.height || 480,
				RGPU_ViewmodelMuzzle()
			);
		}
		return;
	}
	let counts: [number, number, number];
	let entity_count: number;
	let particle_count: number;
	let viewmodel_count: number;
	let offset: number;

	counts = RGPU_BuildSceneMarkers( upload, entities, refdef.time, refdef );
	entity_count = counts[0];
	particle_count = counts[1];
	viewmodel_count = counts[2];

	if ( entity_count > 0 )
		RGPU_DrawMarkerRange( pass, 0, entity_count );

	offset = RGPU_DrawParticleMarkers( pass, entity_count, particle_count );

	if ( viewmodel_count > 0 )
		RGPU_DrawMarkerRange( pass, offset, viewmodel_count );
}


/**
 * @exec per-frame
 * ================
 * RGPU_DrawParticlesImpl
 * ================
 */
export function RGPU_DrawParticlesImpl( entities: entity_render_t[], refdef: refdef_t ): void {
	void entities;
	void refdef;
}


/**
 * @exec per-frame
 * ================
 * RGPU_DrawViewModelImpl
 * ================
 */
export function RGPU_DrawViewModelImpl( refdef: refdef_t ): void {
	void refdef;
}
