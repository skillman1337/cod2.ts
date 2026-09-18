/*
===============================================================================

	rgpu_weaponfx.ts

	Call of Duty 2 / id Tech WebGPU Weapon Visual Effects Renderer
	Manages muzzle flashes, shell ejections, bullet impacts, and dynamic weapon crosshairs.

===============================================================================
*/

import { Cvar_Get } from '@/engine/common/cvar.js';
import { Con_Printf } from '@/engine/common/common.js';
import { Level_Generation, Level_Phase, Level_WorldVisible } from '@/engine/common/level.js';
import { Weapon_Definition, Weapon_Fov } from '@/engine/common/weapon.js';
import { WeaponSpread_Angle } from '@/engine/common/weapon_spread.js';
import { FX_Evaluate, FX_Impact, type fx_catalog_t, type fx_sprite_t } from '@/engine/common/weapon_fx.js';
import { VM_Rotate, type vm_pose_t } from '@/engine/common/viewmodel.js';
import type { refdef_t } from '@/engine/common/types.js';
import type { rgpu_draw_resources_t, rgpu_draw_upload_t } from './rgpu_draw_contract.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const FX_CAMERA_UNIFORM_SIZE      = 80;
export const FX_CAMERA_UNIFORM_FLOATS    = 20;
export const FX_MAX_QUADS                = 4096;
export const FX_VERTS_PER_QUAD           = 6;
export const FX_VERTEX_STRIDE            = 40;
export const DEFAULT_FOV                 = 80;

export const CROSSHAIR_REFERENCE_HEIGHT  = 480;
export const CROSSHAIR_PROJECTION_SCALE  = 240;
export const DEFAULT_RETICLE_SIDE_SIZE   = 6;
export const CROSSHAIR_SPREAD_MAX        = 255;
export const CROSSHAIR_DEFAULT_HEIGHT    = 60;
export const CROSSHAIR_PRONG_COUNT       = 4;
export const QUAD_MODE_SCREEN_SPACE      = 2;
export const CROSSHAIR_DEG2RAD           = Math.PI / 180;

export const CVAR_CG_DRAW_CROSSHAIR      = 'cg_drawCrosshair';
export const CVAR_CG_CROSSHAIR_ALPHA_MIN = 'cg_crosshairAlphaMin';
export const CVAR_CG_CROSSHAIR_ALPHA     = 'cg_crosshairAlpha';


// ---------------------------------------------------------------------------
// globals & resource cache
// ---------------------------------------------------------------------------

let epoch = 0;
let loading = false;
let catalog: fx_catalog_t | null = null;
let uniform: GPUBuffer | null = null;
let vertices: GPUBuffer | null = null;

const materials = new Map<string, {
	texture: GPUTexture;
	binding: GPUBindGroup;
	pipeline: GPURenderPipeline;
	atlas: number[];
	sort: number;
}>();

let generation = -1;
let weapon = '';
let seen = 0;
let lastTime = -1;
let frameMsec = 16;

const origins = new Map<number, { position: number[]; axis: number[][] }>();


// ---------------------------------------------------------------------------
// lifecycle & preparation
// ---------------------------------------------------------------------------

/*
====================
RGPU_WeaponFXDestroy

Releases all GPU textures, vertex/uniform buffers, and state tables.
====================
*/
export function RGPU_WeaponFXDestroy(): void {
	epoch++;
	loading = false;
	catalog = null;

	uniform?.destroy();
	vertices?.destroy();
	uniform = null;
	vertices = null;

	for ( const m of materials.values() ) {
		m.texture.destroy();
	}

	materials.clear();
	origins.clear();
	seen = 0;
	weapon = '';
	generation = -1;
}

/*
====================
RGPU_WeaponFXPrepare

Loads weapon FX catalog and textures, initializes vertex/uniform layouts,
and compiles render pipelines using authored blend states.
====================
*/
export function RGPU_WeaponFXPrepare( res: rgpu_draw_resources_t, upload: rgpu_draw_upload_t ): void {
	if ( loading || catalog || !Level_WorldVisible() ) {
		return;
	}

	loading = true;
	const ticket = epoch;

	void ( async () => {
		const response = await fetch( '/weaponfx/catalog.json' );

		if ( !response.ok ) {
			throw new Error( 'weaponfx catalog ' + response.status );
		}

		const data: fx_catalog_t = await response.json();
		const images = await Promise.all(
			Object.entries( data.materials )
				.filter( ( [, m] ) => m.file )
				.map( async ( [name, m] ) => {
					const r = await fetch( m.file!.startsWith( '/' ) ? m.file! : '/weaponfx/' + m.file );

					if ( !r.ok ) {
						throw new Error( m.file );
					}

					return {
						name,
						m,
						image: await createImageBitmap( await r.blob() ),
					};
				} )
		);

		if ( ticket !== epoch ) {
			images.forEach( ( v ) => v.image.close() );
			return;
		}

		uniform = res.createBuffer( {
			label: 'cod2_fx_camera',
			size: FX_CAMERA_UNIFORM_SIZE,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		} );

		vertices = res.createBuffer( {
			label: 'cod2_fx_vertices',
			size: FX_MAX_QUADS * FX_VERTS_PER_QUAD * FX_VERTEX_STRIDE,
			usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
		} );

		const layout = res.createBindGroupLayout( {
			entries: [
				{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
			],
		} );

		const shader = res.createShaderModule( {
			label: 'cod2_authored_fx',
			code: `
struct Camera { origin: vec4f, forward: vec4f, right: vec4f, up: vec4f, projection: vec4f };
@group(0) @binding(0) var<uniform> c: Camera;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
struct Out { @builtin(position) p: vec4f, @location(0) uv: vec2f, @location(1) color: vec4f };
@vertex fn vs(@location(0) p: vec4f, @location(1) uv: vec2f, @location(2) color: vec4f) -> Out {
	var o: Out;
	let d = p.xyz - c.origin.xyz;
	let z = dot(d, c.forward.xyz);
	o.p = vec4f(dot(d, c.right.xyz) * c.projection.x, dot(d, c.up.xyz) * c.projection.y, (z - 4) * 100000 / 99996, z);
	if (p.w == 1 || p.w == 3) {
		o.p = vec4f(-p.y * c.projection.x, p.z * c.projection.y, (p.x - 4) * 100000 / 99996, p.x);
	}
	if (p.w == 3 || p.w == 4) {
		o.p.z = (o.p.w - .1) * .2;
	}
	if (p.w == 2) {
		o.p = vec4f(p.xy, 0, 1);
	}
	o.uv = uv;
	o.color = color;
	return o;
}
@fragment fn fs(o: Out) -> @location(0) vec4f {
	return textureSample(tex, smp, o.uv) * o.color;
}`,
		} );

		const pipelineLayout = res.createPipelineLayout( { bindGroupLayouts: [layout] } );
		const sampler = res.createSampler!( { minFilter: 'linear', magFilter: 'linear' } );
		const factors: GPUBlendFactor[] = [
			'zero', 'zero', 'one', 'src', 'one-minus-src', 'src-alpha',
			'one-minus-src-alpha', 'dst-alpha', 'one-minus-dst-alpha',
			'dst', 'one-minus-dst', 'src-alpha-saturated',
		];
		const pipelines = new Map<string, GPURenderPipeline>();

		for ( const { name, m, image } of images ) {
			const state = m.definition.state;
			const key = state.src + ':' + state.dst;
			let pipeline = pipelines.get( key );

			if ( !pipeline ) {
				pipeline = res.createRenderPipeline( {
					label: 'cod2_fx_' + key,
					layout: pipelineLayout,
					vertex: {
						module: shader,
						entryPoint: 'vs',
						buffers: [{
							arrayStride: FX_VERTEX_STRIDE,
							attributes: [
								{ shaderLocation: 0, offset: 0, format: 'float32x4' },
								{ shaderLocation: 1, offset: 16, format: 'float32x2' },
								{ shaderLocation: 2, offset: 24, format: 'float32x4' },
							],
						}],
					},
					fragment: {
						module: shader,
						entryPoint: 'fs',
						targets: [{
							format: res.format,
							blend: {
								color: { srcFactor: factors[state.src], dstFactor: factors[state.dst] },
								alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
							},
						}],
					},
					primitive: { topology: 'triangle-list', cullMode: 'none' },
					depthStencil: { format: 'depth24plus', depthCompare: 'less-equal', depthWriteEnabled: false },
				} );
				pipelines.set( key, pipeline );
			}

			const texture = res.createTexture!( {
				label: name,
				size: [image.width, image.height],
				format: 'rgba8unorm',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
			} );

			upload.copyExternalImageToTexture!( { source: image }, { texture }, [image.width, image.height] );
			image.close();

			const binding = res.createBindGroup( {
				layout,
				entries: [
					{ binding: 0, resource: { buffer: uniform } },
					{ binding: 1, resource: texture.createView() },
					{ binding: 2, resource: sampler },
				],
			} );

			materials.set( name, {
				texture,
				binding,
				pipeline,
				atlas: m.definition.atlas,
				sort: state.sort,
			} );
		}

		catalog = data;
		loading = false;
	} )().catch( ( e ) => {
		if ( ticket === epoch ) {
			loading = false;
			Con_Printf( 'Weapon FX load failed: ' + String( e ) + '\n' );
		}
	} );
}


// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

/*
====================
RGPU_WeaponFXDraw

Renders weapon particle sprites, bullet impact decals/tracers, and dynamic HUD reticles.
====================
*/
export function RGPU_WeaponFXDraw(
	pass: GPURenderPassEncoder,
	upload: rgpu_draw_upload_t,
	refdef: refdef_t,
	width: number,
	height: number,
	muzzle: vm_pose_t | null
): void {
	const w = refdef.weapon;
	const def = w && Weapon_Definition( w.id );

	if ( !catalog || !uniform || !vertices || !w || !def ) {
		return;
	}

	if ( generation !== Level_Generation() || weapon !== w.id || w.sequence < seen ) {
		generation = Level_Generation();
		weapon = w.id;
		seen = 0;
		origins.clear();
		lastTime = -1;
		frameMsec = 16;
	}

	const time = w.time ?? 0;

	if ( lastTime >= 0 && time > lastTime ) {
		frameMsec = time - lastTime;
	}

	lastTime = time;

	const world = ( p: number[] ) => refdef.vieworg.map( ( v, i ) => (
		v + p[0] * refdef.viewaxis[0][i] - p[1] * refdef.viewaxis[1][i] + p[2] * refdef.viewaxis[2][i]
	) );

	const vector = ( p: number[] ) => refdef.vieworg.map( ( _, i ) => (
		p[0] * refdef.viewaxis[0][i] - p[1] * refdef.viewaxis[1][i] + p[2] * refdef.viewaxis[2][i]
	) );

	const muzzleAxis = muzzle
		? [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map( ( a ) => VM_Rotate( muzzle[0], a ) )
		: [];

	for ( const shot of w.shots ?? [] ) {
		if ( shot.sequence > seen && muzzle ) {
			origins.set( shot.sequence, { position: world( muzzle[1] ), axis: muzzleAxis.map( vector ) } );
		}
	}

	seen = w.sequence;

	const live = new Set( ( w.shots ?? [] ).map( ( s ) => s.sequence ) );

	for ( const key of origins.keys() ) {
		if ( !live.has( key ) ) {
			origins.delete( key );
		}
	}

	const sprites: { sprite: fx_sprite_t; mode: number }[] = [];

	for ( const shot of w.shots ?? [] ) {
		const age = ( w.time ?? 0 ) - shot.time;

		if ( age > 15000 ) {
			origins.delete( shot.sequence );
			continue;
		}

		for ( const fx of FX_Impact( catalog, def.rifleBullet === '1' ? 'bullet_large' : 'bullet_small', shot ) ) {
			for ( const s of FX_Evaluate( catalog, fx.name, age, shot.sequence, shot.position.map( ( v, i ) => v + shot.normal[i] * .125 ), fx.axis, false, 0, frameMsec ) ) {
				sprites.push( { sprite: s, mode: s.depthHack ? 4 : 0 } );
			}
		}

		const origin = origins.get( shot.sequence );

		if ( shot.pellet || !origin || !muzzle || refdef.hideWeapon ) {
			continue;
		}

		for ( const s of FX_Evaluate( catalog, def.viewFlashEffect, age, shot.sequence, muzzle[1], muzzleAxis, true, 0, frameMsec ) ) {
			if ( s.relative ) {
				sprites.push( { sprite: s, mode: s.depthHack ? 3 : 1 } );
			}
		}

		for ( const s of FX_Evaluate( catalog, def.viewFlashEffect, age, shot.sequence, origin.position, origin.axis, true, 0, frameMsec ) ) {
			if ( !s.relative ) {
				sprites.push( { sprite: s, mode: s.depthHack ? 4 : 0 } );
			}
		}
	}

	const fov = Weapon_Fov( Number( Cvar_Get( 'cg_fov' ) ) || DEFAULT_FOV, w );
	const y = 1 / ( Math.tan( fov * Math.PI / 360 ) * .75 );
	const camera = new Float32Array( FX_CAMERA_UNIFORM_FLOATS );

	camera.set( refdef.vieworg );
	camera.set( refdef.viewaxis[0], 4 );
	camera.set( refdef.viewaxis[1], 8 );
	camera.set( refdef.viewaxis[2], 12 );
	camera.set( [y * height / width, y, 0, 0], 16 );
	upload.writeBuffer( uniform, 0, camera.buffer, 0, camera.byteLength );

	const batches: { shader: string; start: number; count: number }[] = [];
	const data: number[] = [];

	const quad = ( shader: string, p: number[], a: number[], b: number[], color: number[], mode: number, frame = 0 ) => {
		const material = materials.get( shader );

		if ( !material || batches.length >= 4096 ) {
			return;
		}

		const [cols, rows] = material.atlas.map( ( v ) => v || 1 );
		const cell = ( ( frame % ( cols * rows ) ) + cols * rows ) % ( cols * rows );
		const u = cell % cols;
		const v = Math.floor( cell / cols );
		const start = data.length / 10;

		for ( const i of [0, 1, 2, 0, 2, 3] ) {
			const x = [-1, 1, 1, -1][i];
			const z = [-1, -1, 1, 1][i];

			data.push(
				...p.map( ( n, j ) => n + a[j] * x + b[j] * z ),
				mode,
				( u + ( x + 1 ) * .5 ) / cols,
				( v + ( 1 - z ) * .5 ) / rows,
				...color
			);
		}

		batches.push( { shader, start, count: 6 } );
	};

	sprites.sort( ( a, b ) => ( materials.get( a.sprite.shader )?.sort ?? 0 ) - ( materials.get( b.sprite.shader )?.sort ?? 0 ) );

	for ( const { sprite: s, mode } of sprites ) {
		const local = mode === 1 || mode === 3;

		if ( s.tail ) {
			if ( !s.tailEnd ) {
				continue;
			}

			const delta = s.tailEnd.map( ( v, i ) => v - s.position[i] );
			const length = Math.hypot( ...delta );

			if ( !length ) {
				continue;
			}

			const f = delta.map( ( v ) => v / length );
			const eye = local ? s.position.map( ( v ) => -v ) : refdef.vieworg.map( ( v, i ) => v - s.position[i] );
			const side = [
				f[1] * eye[2] - f[2] * eye[1],
				f[2] * eye[0] - f[0] * eye[2],
				f[0] * eye[1] - f[1] * eye[0],
			];
			const n = Math.hypot( ...side );

			// 0x10041490 -> 0x100409e0/0x10040d80: start + side is UV(0,0),
			// end - side is UV(1,1). Billboard axes would reverse both tail UVs.
			if ( n > 1e-6 ) {
				quad( s.shader, s.position.map( ( v, i ) => v + delta[i] * .5 ), side.map( ( v ) => -v * s.size / n ), delta.map( ( v ) => -v * .5 ), s.color, mode, s.frame );
			}

			continue;
		}

		const a = s.decal ? s.axis[1] : local ? [0, -1, 0] : refdef.viewaxis[1];
		const b = s.decal ? s.axis[2] : local ? [0, 0, 1] : refdef.viewaxis[2];
		const c = Math.cos( s.rotation ) * s.size;
		const d = Math.sin( s.rotation ) * s.size;

		quad(
			s.shader,
			s.position,
			a.map( ( v, i ) => v * c + b[i] * d ),
			b.map( ( v, i ) => ( v * Math.cos( s.rotation ) - a[i] * Math.sin( s.rotation ) ) * s.size2 ),
			s.color,
			mode,
			s.frame
		);
	}

	if ( Level_Phase() === 'playing' && !refdef.hideWeapon && !w.holster && w.ads < 1 && Cvar_Get( CVAR_CG_DRAW_CROSSHAIR ) !== '0' ) {
		const alpha = Math.max(
			Number( Cvar_Get( CVAR_CG_CROSSHAIR_ALPHA_MIN ) ) || 0,
			( 1 - ( w.spread ?? 0 ) / CROSSHAIR_SPREAD_MAX ) * ( 1 - w.ads ) * Number( Cvar_Get( CVAR_CG_CROSSHAIR_ALPHA ) || 1 )
		);
		const color = [1, 1, 1, alpha];
		const scale = height / CROSSHAIR_REFERENCE_HEIGHT;

		if ( def.reticleCenter ) {
			const size = Number( def.reticleCenterSize ) * scale;
			quad( def.reticleCenter, [0, 0, 0], [size / width, 0, 0], [0, size / height, 0], color, QUAD_MODE_SCREEN_SPACE );
		}

		if ( def.reticleSide ) {
			const size = Number( def.reticleSideSize ) || DEFAULT_RETICLE_SIDE_SIZE;
			const spread = WeaponSpread_Angle( def, w.spread ?? 0, w.viewHeight ?? CROSSHAIR_DEFAULT_HEIGHT );
			const gap = Math.max( Number( def.reticleMinOfs ) || 0, Math.tan( spread * CROSSHAIR_DEG2RAD ) * y * CROSSHAIR_PROJECTION_SCALE ) - ( Number( def.hipReticleSidePos ) || 0 ) * size;

			for ( let i = 0; i < CROSSHAIR_PRONG_COUNT; i++ ) {
				const a = i * Math.PI / 2;
				const c = Math.cos( a );
				const s = Math.sin( a );
				const offset = ( gap + size * .5 ) * scale;

				quad(
					def.reticleSide,
					[c * offset * 2 / width, s * offset * 2 / height, 0],
					[-s * size * scale / width, c * size * scale / height, 0],
					[-c * size * scale / width, -s * size * scale / height, 0],
					color,
					QUAD_MODE_SCREEN_SPACE
				);
			}
		}
	}

	if ( !data.length ) {
		return;
	}

	const buffer = new Float32Array( data );

	upload.writeBuffer( vertices, 0, buffer.buffer, 0, buffer.byteLength );
	pass.setVertexBuffer( 0, vertices );

	for ( const batch of batches ) {
		const m = materials.get( batch.shader )!;

		pass.setPipeline( m.pipeline );
		pass.setBindGroup( 0, m.binding );
		pass.draw( batch.count, 1, batch.start );
	}
}
