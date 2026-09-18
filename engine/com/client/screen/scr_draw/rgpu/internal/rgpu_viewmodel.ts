/*
===============================================================================

	rgpu_viewmodel.ts

	Call of Duty 2 / id Tech WebGPU Viewmodel Renderer
	First-person weapon and hand meshes, skeletal animation skinning,
	RF_DEPTHHACK projection near-plane clamping, and 3D lightgrid probe sampling.

===============================================================================
*/

import { Material_LoadImages } from '@/engine/common/material_assets.js';
import { Cvar_Get } from '@/engine/common/cvar.js';
import { Con_Printf } from '@/engine/common/common.js';
import { Weapon_Definition, Weapon_Fov } from '@/engine/common/weapon.js';
import { VM_WeaponPose, VM_Skin, type vm_pose_t, type vm_model_t, type vm_animation_t, type vm_surface_t } from '@/engine/common/viewmodel.js';
import { Level_WorldVisible, Level_Data } from '@/engine/common/level.js';
import { LightGrid_Sample, type lightgrid_t } from '@/engine/common/lightgrid.js';
import { PM_TraceShape } from '@/engine/common/pm.js';
import type { refdef_t } from '@/engine/common/types.js';
import type { rgpu_draw_resources_t, rgpu_draw_upload_t } from './rgpu_draw_contract.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const VIEWMODEL_CAMERA_BUFFER_SIZE   = 240;
export const VIEWMODEL_CAMERA_UNIFORM_FLOATS = 60;
export const VIEWMODEL_VERTEX_STRIDE        = 32;
export const DEFAULT_FOV                    = 80;
export const CONTENTS_SOLID_OR_OPAQUE       = 0x2001;

export const VIEWMODEL_ASPECT_SCALE         = 0.75;
export const VIEWMODEL_HALF_CIRCLE_DEGREES  = 360;

export const WEAPON_MODEL_INDEX             = 1;
export const BONE_TAG_FLASH                 = 'tag_flash';

export const CAMERA_OFFSET_GUN              = 4;
export const CAMERA_OFFSET_FORWARD          = 8;
export const CAMERA_OFFSET_LEFT             = 12;
export const CAMERA_OFFSET_UP               = 16;
export const CAMERA_OFFSET_SUN_DIR          = 20;
export const CAMERA_OFFSET_SUN_COLOR        = 24;
export const CAMERA_OFFSET_PROBE            = 28;

export const CVAR_CG_FOV                    = 'cg_fov';
export const CVAR_CG_GUN_X                  = 'cg_gun_x';
export const CVAR_CG_GUN_Y                  = 'cg_gun_y';
export const CVAR_CG_GUN_Z                  = 'cg_gun_z';


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

let epoch = 0;
let selected = '';
let ready = false;
let models: vm_model_t[] = [];
let animations: Record<string, vm_animation_t> = {};
let uniform: GPUBuffer | null = null;
let pipeline: GPURenderPipeline | null = null;

let surfaces: {
	source: vm_surface_t;
	model: number;
	buffer: GPUBuffer;
	binding: GPUBindGroup;
	data: Float32Array;
}[] = [];

let textures: GPUTexture[] = [];
let grid: lightgrid_t | null = null;
let map = '';
let muzzle: vm_pose_t | null = null;


// ---------------------------------------------------------------------------
// viewmodel state & lifecycle
// ---------------------------------------------------------------------------

/*
====================
RGPU_ViewmodelMuzzle

Returns the animated tag_flash attachment pose in viewmodel coordinate space.
====================
*/
export function RGPU_ViewmodelMuzzle(): vm_pose_t | null {
	return muzzle;
}

/*
====================
RGPU_ViewmodelDestroy

Releases GPU buffers, textures, and pipeline objects, invalidating any in-flight asset jobs.
====================
*/
export function RGPU_ViewmodelDestroy(): void {
	epoch++;
	ready = false;
	selected = '';
	models = [];
	animations = {};

	uniform?.destroy();
	uniform = null;
	pipeline = null;
	grid = null;
	map = '';
	muzzle = null;

	for ( const s of surfaces ) {
		s.buffer.destroy();
	}
	for ( const t of textures ) {
		t.destroy();
	}

	surfaces = [];
	textures = [];
}


// ---------------------------------------------------------------------------
// viewmodel asset preparation & pipeline compilation
// ---------------------------------------------------------------------------

/*
====================
RGPU_ViewmodelPrepare

Loads weapon and hand models, animation tracks, material textures, and lightgrid
lighting data for the active weapon, compiling the dedicated viewmodel render pipeline.
====================
*/
export function RGPU_ViewmodelPrepare( res: rgpu_draw_resources_t, upload: rgpu_draw_upload_t ): void {
	const level = Level_Data();
	const id = Level_WorldVisible() ? Cvar_Get( 'ui_weapon' ) : '';

	if ( id === selected && map === ( level?.manifest.name ?? '' ) ) {
		return;
	}

	RGPU_ViewmodelDestroy();
	selected = id;
	map = level?.manifest.name ?? '';

	if ( !Weapon_Definition( id ) ) {
		return;
	}

	const generation = epoch;

	void ( async () => {
		const json = async ( path: string ) => {
			const r = await fetch( '/viewmodels/' + path );
			if ( !r.ok ) {
				throw new Error( path + ': ' + r.status );
			}
			return r.json();
		};

		const catalog = await json( 'catalog.json' );
		const entry = catalog.weapons[id];
		const def = Weapon_Definition( id )!;

		if ( !entry ) {
			throw new Error( 'No viewmodel for ' + id );
		}

		const names = [...new Set(
			Object.entries( def )
				.filter( ( [k, v] ) => k.endsWith( 'Anim' ) && v )
				.map( ( [, v] ) => v )
		)];

		const [loaded, tracks] = await Promise.all( [
			Promise.all( [entry.hands, entry.gun].filter( Boolean ).map( ( name ) => json( 'models/' + name + '.json' ) ) ),
			Promise.all( names.map( async ( name ) => [name, await json( 'animations/' + name + '.json' )] ) ),
		] );

		const materials = [...new Set( ( loaded as vm_model_t[] ).flatMap( ( m ) => m.surfaces.map( ( s ) => s.material ) ) )];
		const loadedImages = await Material_LoadImages(
			materials,
			[{ url: '/viewmodels/catalog.json', materials: catalog.materials ?? {} }],
			['/characters/catalog.json'],
			( message ) => {
				if ( generation === epoch ) {
					Con_Printf( message + '\n' );
				}
			}
		);

		if ( loadedImages.some( ( image ) => !image ) ) {
			loadedImages.forEach( ( image ) => image?.close() );
			throw new Error( 'Missing exported viewmodel material(s); see material diagnostics above.' );
		}

		const images = loadedImages as ImageBitmap[];

		if ( generation !== epoch ) {
			images.forEach( ( i ) => i.close() );
			return;
		}

		const lighting = await fetch( '/maps/' + map + '/lightgrid.json' )
			.then( ( r ) => {
				if ( !r.ok ) {
					throw new Error( 'Missing light grid' );
				}
				return r.json();
			} )
			.catch( ( error ) => {
				images.forEach( ( i ) => i.close() );
				throw error;
			} );

		if ( generation !== epoch ) {
			images.forEach( ( i ) => i.close() );
			return;
		}

		models = loaded;
		animations = Object.fromEntries( tracks );
		grid = lighting;

		uniform = res.createBuffer( {
			label: 'cod2_viewmodel_camera',
			size: VIEWMODEL_CAMERA_BUFFER_SIZE,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		} );

		const layout = res.createBindGroupLayout( {
			entries: [
				{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			],
		} );

		const shader = res.createShaderModule( {
			label: 'cod2_viewmodel_shader',
			code: `
struct Camera {
	projection: vec4f,
	offset: vec4f,
	forward: vec4f,
	left: vec4f,
	up: vec4f,
	sun: vec4f,
	sunColor: vec4f,
	probe: array<vec4f, 8>
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var diffuse: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

struct Output {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
	@location(1) normal: vec3f
};

@vertex fn vs(
	@location(0) position: vec3f,
	@location(1) normal: vec3f,
	@location(2) uv: vec2f
) -> Output {
	var out: Output;
	let p = position + camera.offset.xyz;

	// 0x1002fbdf: RF_DEPTHHACK selects near .1 and viewport depth [0, .2].
	out.position = vec4f(-p.y * camera.projection.x, p.z * camera.projection.y, (p.x - 0.1) * 0.2, p.x);
	out.uv = uv;
	out.normal = normal.x * camera.forward.xyz + normal.y * camera.left.xyz + normal.z * camera.up.xyz;

	return out;
}

@fragment fn fs(input: Output) -> @location(0) vec4f {
	let c = textureSample(diffuse, linearSampler, input.uv);
	if (c.a < 0.5) {
		discard;
	}

	let n = normalize(input.normal);
	let r = vec3f(
		dot(n, vec3f(0.81649658, 0.0, 0.57735027)),
		dot(n, vec3f(-0.40824829, 0.70710678, 0.57735027)),
		dot(n, vec3f(-0.40824829, -0.70710678, 0.57735027))
	);
	let coord = r / max(max(abs(r.x), abs(r.y)), abs(r.z)) * 0.5 + 0.5;

	var probe = vec4f(0.0);
	for (var i = 0; i < 8; i++) {
		probe += camera.probe[i]
			* select(1.0 - coord.x, coord.x, (i & 1) != 0)
			* select(1.0 - coord.y, coord.y, (i & 2) != 0)
			* select(1.0 - coord.z, coord.z, (i & 4) != 0);
	}

	return vec4f(c.rgb * (probe.rgb + probe.a * camera.sunColor.rgb * max(0.0, dot(n, camera.sun.xyz))), 1.0);
}
`,
		} );

		pipeline = res.createRenderPipeline( {
			label: 'cod2_viewmodel',
			layout: res.createPipelineLayout( { bindGroupLayouts: [layout] } ),
			vertex: {
				module: shader,
				entryPoint: 'vs',
				buffers: [
					{
						arrayStride: VIEWMODEL_VERTEX_STRIDE,
						attributes: [
							{ shaderLocation: 0, offset: 0, format: 'float32x3' },
							{ shaderLocation: 1, offset: 12, format: 'float32x3' },
							{ shaderLocation: 2, offset: 24, format: 'float32x2' },
						],
					},
				],
			},
			fragment: {
				module: shader,
				entryPoint: 'fs',
				targets: [{ format: res.format }],
			},
			primitive: {
				topology: 'triangle-list',
				cullMode: 'none',
			},
			depthStencil: {
				format: 'depth24plus',
				depthWriteEnabled: true,
				depthCompare: 'less-equal',
			},
		} );

		const sampler = res.createSampler!( {
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'repeat',
			addressModeV: 'repeat',
		} );

		const bindings = new Map<string, GPUBindGroup>();

		materials.forEach( ( name, i ) => {
			const bitmap = images[i];
			const texture = res.createTexture!( {
				label: 'cod2_viewmodel_' + name,
				size: [bitmap.width, bitmap.height],
				format: 'rgba8unorm',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
			} );

			textures.push( texture );
			upload.copyExternalImageToTexture!( { source: bitmap }, { texture }, [bitmap.width, bitmap.height] );
			bitmap.close();

			bindings.set( name, res.createBindGroup( {
				layout,
				entries: [
					{ binding: 0, resource: { buffer: uniform! } },
					{ binding: 1, resource: texture.createView() },
					{ binding: 2, resource: sampler },
				],
			} ) );
		} );

		models.forEach( ( m, model ) => {
			m.surfaces.forEach( ( source ) => {
				surfaces.push( {
					source,
					model,
					data: new Float32Array( source.indices.length * 8 ),
					buffer: res.createBuffer( {
						label: m.name,
						size: source.indices.length * 32,
						usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
					} ),
					binding: bindings.get( source.material )!,
				} );
			} );
		} );

		ready = true;
	} )().catch( ( error ) => {
		if ( generation === epoch ) {
			Con_Printf( 'Viewmodel load failed: ' + String( error ) + '\n' );
		}
	} );
}


// ---------------------------------------------------------------------------
// viewmodel drawing
// ---------------------------------------------------------------------------

/*
====================
RGPU_ViewmodelDraw

Applies skeletal skinning transforms to vertex buffers and renders the viewmodel
inside the frame owner's primary world render pass.
====================
*/
export function RGPU_ViewmodelDraw(
	pass: GPURenderPassEncoder,
	upload: rgpu_draw_upload_t,
	refdef: refdef_t,
	aspect: number
): void {
	muzzle = null;

	const w = refdef.weapon;

	if ( !ready || !pipeline || !uniform || !w || w.id !== selected || refdef.hideWeapon ) {
		return;
	}

	const poses = VM_WeaponPose( models, animations, w );
	const tag = models[WEAPON_MODEL_INDEX].bones.findIndex( ( b ) => b.name === BONE_TAG_FLASH );
	const fov = Weapon_Fov( Number( Cvar_Get( CVAR_CG_FOV ) ) || DEFAULT_FOV, w );
	const y = 1 / ( Math.tan( ( fov * Math.PI ) / VIEWMODEL_HALF_CIRCLE_DEGREES ) * VIEWMODEL_ASPECT_SCALE );
	const camera = new Float32Array( VIEWMODEL_CAMERA_UNIFORM_FLOATS );

	camera.set( [
		y / aspect,
		y,
		0,
		0,
		Number( Cvar_Get( CVAR_CG_GUN_X ) ),
		-Number( Cvar_Get( CVAR_CG_GUN_Y ) ),
		Number( Cvar_Get( CVAR_CG_GUN_Z ) ),
		0,
	] );

	if ( tag >= 0 ) {
		const pose = poses[WEAPON_MODEL_INDEX][tag];
		muzzle = [pose[0], pose[1].map( ( v, i ) => v + camera[CAMERA_OFFSET_GUN + i] )];
	}

	camera.set( refdef.viewaxis[0], CAMERA_OFFSET_FORWARD );
	camera.set( refdef.viewaxis[1].map( ( v ) => -v ), CAMERA_OFFSET_LEFT );
	camera.set( refdef.viewaxis[2], CAMERA_OFFSET_UP );

	const level = Level_Data();

	if ( level ) {
		camera.set( level.manifest.sun.direction, CAMERA_OFFSET_SUN_DIR );
		camera.set( level.manifest.sun.color, CAMERA_OFFSET_SUN_COLOR );
	}

	if ( grid ) {
		const probeSample = LightGrid_Sample( grid, refdef.vieworg, ( a, b ) => {
			const t = PM_TraceShape( a, b, { radius: 0, half: 0, offset: 0 }, false, CONTENTS_SOLID_OR_OPAQUE );
			return !t.startsolid && t.fraction === 1;
		} );
		camera.set( probeSample.flat(), CAMERA_OFFSET_PROBE );
	}

	upload.writeBuffer( uniform, 0, camera.buffer, 0, camera.byteLength );
	pass.setPipeline( pipeline );

	for ( const s of surfaces ) {
		const data = VM_Skin( s.source, poses[s.model], s.data );
		upload.writeBuffer( s.buffer, 0, data.buffer as ArrayBuffer, 0, data.byteLength );
		pass.setBindGroup( 0, s.binding );
		pass.setVertexBuffer( 0, s.buffer );
		pass.draw( s.source.indices.length );
	}
}
