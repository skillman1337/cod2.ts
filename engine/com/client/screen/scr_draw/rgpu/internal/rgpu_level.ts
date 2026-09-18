/*
===============================================================================

	rgpu_level.ts

	Call of Duty 2 / id Tech WebGPU World Geometry & BSP Level Renderer
	Manages static world vertex buffers, diffuse texture arrays, lightmaps,
	normal maps, cubemap skies, lightmap weights, materials, and separable scene blur.

===============================================================================
*/

import { Asset_Fetch } from '../../../../../../common/asset_paths.js';
import { Asset_LevelURL, Asset_MapJobs } from '../../../../../../common/asset_jobs.js';
import { Level_Data, Level_GraphicsReady, Level_GraphicsProgress, Level_GraphicsFailed, type level_data_t } from '@/engine/common/level.js';
import { Con_Printf } from '@/engine/common/common.js';
import { Cvar_Get } from '@/engine/common/cvar.js';
import type { refdef_t } from '@/engine/common/types.js';
import { Weapon_Fov } from '@/engine/common/weapon.js';
import type { rgpu_draw_resources_t, rgpu_draw_upload_t } from './rgpu_draw_contract.js';
import weightsUrl from '@/assets/images/lightmap_weights.png?url';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const LEVEL_CAMERA_BUFFER_SIZE     = 128;
export const LEVEL_MIN_PROBES_BUFFER_SIZE = 128;
export const LEVEL_TEXTURE_DIMENSION      = 512;
export const LEVEL_SUNMAP_DIMENSION       = 1024;
export const LEVEL_CUBEMAP_FACES          = 6;
export const LEVEL_LIGHTMAP_WEIGHTS_SIZE  = 32;
export const LEVEL_VERTEX_STRIDE          = 72;
export const LEVEL_BLUR_BUFFER_SIZE       = 16;
export const LEVEL_DEFAULT_FOV            = 80;
export const LEVEL_MIN_FOV                = 10;
export const LEVEL_DEFAULT_NEAR           = 4;
export const LEVEL_DEFAULT_FAR            = 100000;


// ---------------------------------------------------------------------------
// globals & GPU resources
// ---------------------------------------------------------------------------

let level: level_data_t | null = null;
let resources: rgpu_draw_resources_t | null = null;
let serial = 0;
let ready = false;

let vertex: GPUBuffer | null = null;
let camera: GPUBuffer | null = null;
let probes: GPUBuffer | null = null;

let texture: GPUTexture | null = null;
let lightmap: GPUTexture | null = null;
let depth: GPUTexture | null = null;
let depthSize = '';
let pipeline: GPURenderPipeline | null = null;
let binding: GPUBindGroup | null = null;

let normal: GPUTexture | null = null;
let sun: GPUTexture | null = null;
let sky: GPUTexture | null = null;
let weights: GPUTexture | null = null;

let scene: GPUTexture | null = null;
let blurred: GPUTexture | null = null;
let blurSize = '';
let blurPipeline: GPURenderPipeline | null = null;
let blurLayout: GPUBindGroupLayout | null = null;
let blurBuffers: GPUBuffer[] = [];
let blurBindings: GPUBindGroup[] = [];

const materialPipelines = new Map<string, GPURenderPipeline>();
let preparedDraws: { start: number; count: number; pipeline: GPURenderPipeline }[] = [];


// ---------------------------------------------------------------------------
// resource destruction
// ---------------------------------------------------------------------------

/*
====================
RGPU_LevelDestroy

Releases all WebGPU level geometry buffers, texture arrays, shaders,
and blur render targets when tearing down or switching BSP maps.
====================
*/
export function RGPU_LevelDestroy(): void {
	serial++;
	ready = false;
	level = null;
	resources = null;

	materialPipelines.clear();
	preparedDraws = [];

	vertex?.destroy();
	camera?.destroy();
	texture?.destroy();
	lightmap?.destroy();
	depth?.destroy();

	probes?.destroy();
	probes = null;

	normal?.destroy();
	sun?.destroy();
	sky?.destroy();
	weights?.destroy();
	normal = null;
	sun = null;
	sky = null;
	weights = null;

	scene?.destroy();
	blurred?.destroy();

	for ( const buffer of blurBuffers ) {
		buffer.destroy();
	}

	scene = null;
	blurred = null;
	blurSize = '';
	blurPipeline = null;
	blurLayout = null;
	blurBuffers = [];
	blurBindings = [];

	vertex = null;
	camera = null;
	texture = null;
	lightmap = null;
	depth = null;
	pipeline = null;
	binding = null;
	depthSize = '';
}


// ---------------------------------------------------------------------------
// shader definitions
// ---------------------------------------------------------------------------

/*
====================
RGPU_LevelShader

Returns the WGSL shader source for world rendering:
- Perspective camera transformation with D3D depth-bias emulation.
- Diffuse texture arrays with anisotropic filtering and alpha-test branches.
- Normal mapping with tangent space reconstruction and lightmap weights.
- Multi-component lightmap and 3D probe lighting with sunlight shading.
- Multiplying decal alpha blends and exponential fog application.
====================
*/
function RGPU_LevelShader(): string {
	return `
struct Camera {
	position: vec4f,
	forward: vec4f,
	right: vec4f,
	up: vec4f,
	projection: vec4f,
	sunDirection: vec4f,
	sunColor: vec4f,
	fog: vec4f
};

override alphaTest: i32 = -1;
override materialLit: bool = true;
override materialFog: bool = true;
override materialMultiply: bool = false;
override fogBlack: bool = false;
override polygonOffset: f32 = 0;

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var diffuse: texture_2d_array<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var lightmap: texture_2d_array<f32>;
@group(0) @binding(4) var normalmap: texture_2d_array<f32>;
@group(0) @binding(5) var sunlight: texture_2d_array<f32>;
@group(0) @binding(6) var skyMap: texture_cube<f32>;
@group(0) @binding(7) var weightMap: texture_2d<f32>;
@group(0) @binding(8) var clampSampler: sampler;
@group(0) @binding(9) var<storage, read> modelProbes: array<vec4f>;

struct Output {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
	@location(1) lm: vec2f,
	@location(2) color: vec4f,
	@location(3) @interpolate(flat) layer: u32,
	@location(4) normal: vec3f,
	@location(5) tangent: vec3f,
	@location(6) binormal: vec3f,
	@location(7) direction: vec3f
};

@vertex fn vs(
	@location(0) position: vec3f,
	@location(1) uv: vec2f,
	@location(2) lm: vec2f,
	@location(3) color: vec4f,
	@location(4) layer: u32,
	@location(5) normal: vec3f,
	@location(6) tangent: vec3f,
	@location(7) binormal: vec3f
) -> Output {
	var out: Output;
	let delta = position - camera.position.xyz;
	let z = dot( delta, camera.forward.xyz );

	out.position = vec4f(
		dot( delta, camera.right.xyz ) * camera.projection.x,
		dot( delta, camera.up.xyz ) * camera.projection.y,
		z * camera.projection.z + camera.projection.w,
		z
	);

	// Native D3DRS_DEPTHBIAS uses -offset / 65536 (0x1003d261).
	// Apply the normalized bias explicitly: depth24plus may use D24 or D32.
	out.position.z -= polygonOffset * ( 1.0 / 65536.0 ) * out.position.w;

	if ( ( layer & 0x80000000u ) != 0u ) {
		out.position.z = out.position.w;
	}

	out.uv = uv;
	out.lm = lm;
	out.color = color;
	out.layer = layer;
	out.normal = normal;
	out.tangent = tangent;
	out.binormal = binormal;
	out.direction = delta;

	return out;
}

@fragment fn fs( input: Output ) -> @location(0) vec4f {
	let uvDx = dpdx( input.uv );
	let uvDy = dpdy( input.uv );

	if ( ( input.layer & 0x80000000u ) != 0u ) {
		return vec4f( textureSampleLevel( skyMap, clampSampler, input.direction, 0 ).rgb, 1 );
	}

	let material = i32( input.layer & 0xffffu );
	let lm = i32( ( input.layer >> 16u ) & 0x7fffu );

	let color = textureSampleGrad( diffuse, linearSampler, input.uv, material, uvDx, uvDy );
	let alpha = color.a * input.color.a;

	if ( ( alphaTest == 1 && alpha <= 0 ) || ( alphaTest == 2 && alpha >= 128.0 / 255.0 ) || ( ( alphaTest == 0 || alphaTest == 3 ) && alpha < 128.0 / 255.0 ) ) {
		discard;
	}

	let normalPixel = textureSampleGrad( normalmap, linearSampler, input.uv, material, uvDx, uvDy );
	let ns = select( vec2f( 0.5 ), normalPixel.xy, normalPixel.a > 0 );
	let normal = normalize( input.normal + ( ns.x * 2.0 - 1.0 ) * input.tangent + ( ns.y * 2.0 - 1.0 ) * input.binormal );
	let weights = textureSampleLevel( weightMap, clampSampler, ns, 0 );
	var lighting = vec3f( 1 );

	if ( materialLit && ( lm & 0x4000 ) != 0 && lm != 0x7fff ) {
		// Retail lightprobe_sm.hlsl rotates the normal into a 2x2x2 probe cube.
		let rotated = vec3f(
			dot( normal, vec3f( 0.81649658, 0.0, 0.57735027 ) ),
			dot( normal, vec3f( -0.40824829, 0.70710678, 0.57735027 ) ),
			dot( normal, vec3f( -0.40824829, -0.70710678, 0.57735027 ) )
		);
		let coord = rotated / max( max( abs( rotated.x ), abs( rotated.y ) ), abs( rotated.z ) ) * 0.5 + 0.5;
		var probe = vec4f( 0 );

		for ( var i = 0; i < 8; i++ ) {
			let weight = select( 1.0 - coord.x, coord.x, ( i & 1 ) != 0 ) *
				select( 1.0 - coord.y, coord.y, ( i & 2 ) != 0 ) *
				select( 1.0 - coord.z, coord.z, ( i & 4 ) != 0 );
			probe += modelProbes[( lm & 0x3fff ) * 8 + i] * weight;
		}

		lighting = probe.rgb + probe.a * camera.sunColor.rgb * max( 0.0, dot( normal, camera.sunDirection.xyz ) );
	}

	if ( materialLit && lm < i32( textureNumLayers( sunlight ) ) ) {
		lighting = vec3f(
			dot( textureSampleLevel( lightmap, clampSampler, input.lm, lm * 3, 0 ), weights ),
			dot( textureSampleLevel( lightmap, clampSampler, input.lm, lm * 3 + 1, 0 ), weights ),
			dot( textureSampleLevel( lightmap, clampSampler, input.lm, lm * 3 + 2, 0 ), weights )
		);
		lighting += textureSampleLevel( sunlight, clampSampler, input.lm, lm, 0 ).r * camera.sunColor.rgb * max( 0.0, dot( normal, camera.sunDirection.xyz ) );
	}

	let shaded = color.rgb * input.color.bgr * lighting;

	// Retail mul.hlsl fades a multiplying decal toward WHITE by vertex alpha.
	// Multiplying transparent black directly into the framebuffer creates scars.
	if ( materialMultiply ) {
		return vec4f( mix( vec3f( 1 ), color.rgb * input.color.bgr, input.color.a ), 1 );
	}

	// 0x10035087..0x1003511a: destination ONE uses black fog, or fog is added twice.
	let fogColor = select( camera.fog.yzw, vec3f( 0 ), fogBlack );

	return vec4f(
		select( shaded, mix( fogColor, shaded, exp( -length( input.direction ) * camera.fog.x ) ), materialFog ),
		color.a * input.color.a
	);
}`;
}


// ---------------------------------------------------------------------------
// level preparation & texture loading
// ---------------------------------------------------------------------------

/*
====================
RGPU_LevelPrepare

Initializes all GPU resources for the active BSP level:
- Creates vertex, camera, and model probe storage buffers.
- Allocates diffuse, lightmap, normal, sun, sky, and weight texture arrays.
- Compiles specialized material render pipelines based on blend state and flags.
- Asynchronously streams world images, generates mipmaps, and reports progress.
====================
*/
export function RGPU_LevelPrepare( res: rgpu_draw_resources_t, upload: rgpu_draw_upload_t ): void {
	const current = Level_Data();

	if ( !current ) {
		if ( level ) {
			RGPU_LevelDestroy();
		}
		return;
	}

	if ( current === level ) {
		return;
	}

	RGPU_LevelDestroy();
	level = current;
	resources = res;
	const epoch = serial;

	vertex = res.createBuffer( {
		label: 'cod2_world_vertices',
		size: current.vertices.byteLength,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	} );
	upload.writeBuffer( vertex, 0, current.vertices, 0, current.vertices.byteLength );

	camera = res.createBuffer( {
		label: 'cod2_world_camera',
		size: LEVEL_CAMERA_BUFFER_SIZE,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	} );

	const probePixels = new Float32Array( current.manifest.probes?.flat( 2 ) ?? Array( 32 ).fill( 1 ) );
	probes = res.createBuffer( {
		label: 'cod2_model_probes',
		size: Math.max( LEVEL_MIN_PROBES_BUFFER_SIZE, probePixels.byteLength ),
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	} );
	upload.writeBuffer( probes, 0, probePixels.buffer, 0, probePixels.byteLength );

	// External image copies require COPY_DST and RENDER_ATTACHMENT on each destination.
	const imageUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT;
	const maxTextureArrayLayers = res.limits?.maxTextureArrayLayers ?? 256;
	const diffuseLayers = Math.max( 1, Math.min( maxTextureArrayLayers, current.manifest.textures.length ) );
	const normalLayers = Math.max( 1, Math.min( maxTextureArrayLayers, current.manifest.textures.length ) );

	texture = res.createTexture!( {
		label: 'cod2_world_diffuse',
		size: [LEVEL_TEXTURE_DIMENSION, LEVEL_TEXTURE_DIMENSION, diffuseLayers],
		mipLevelCount: 10,
		format: 'rgba8unorm',
		usage: imageUsage,
	} );

	lightmap = res.createTexture!( {
		label: 'cod2_world_lightmap',
		size: [LEVEL_TEXTURE_DIMENSION, LEVEL_TEXTURE_DIMENSION, Math.max( 1, current.manifest.lightmaps.length )],
		format: 'rgba8unorm',
		usage: imageUsage,
	} );

	normal = res.createTexture!( {
		label: 'cod2_world_normals',
		size: [LEVEL_TEXTURE_DIMENSION, LEVEL_TEXTURE_DIMENSION, normalLayers],
		mipLevelCount: 10,
		format: 'rgba8unorm',
		usage: imageUsage,
	} );

	sun = res.createTexture!( {
		label: 'cod2_world_sun',
		size: [LEVEL_SUNMAP_DIMENSION, LEVEL_SUNMAP_DIMENSION, Math.max( 1, current.manifest.sunmaps.length )],
		format: 'rgba8unorm',
		usage: imageUsage,
	} );

	sky = res.createTexture!( {
		label: 'cod2_world_sky',
		size: [LEVEL_TEXTURE_DIMENSION, LEVEL_TEXTURE_DIMENSION, LEVEL_CUBEMAP_FACES],
		format: 'rgba8unorm',
		usage: imageUsage,
	} );

	weights = res.createTexture!( {
		label: 'cod2_lightmap_weights',
		size: [LEVEL_LIGHTMAP_WEIGHTS_SIZE, LEVEL_LIGHTMAP_WEIGHTS_SIZE],
		format: 'rgba8unorm',
		usage: imageUsage,
	} );

	const shader = res.createShaderModule( {
		label: 'cod2_world_shader',
		code: RGPU_LevelShader(),
	} );

	const layout = res.createBindGroupLayout( {
		entries: [
			{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			...[3, 4, 5].map( ( binding ) => ( {
				binding,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { viewDimension: '2d-array' as const },
			} ) ),
			{ binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: 'cube' } },
			{ binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: {} },
			{ binding: 8, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			{ binding: 9, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
		],
	} );

	const descriptor: GPURenderPipelineDescriptor = {
		label: 'cod2_world_pipeline',
		layout: res.createPipelineLayout( { bindGroupLayouts: [layout] } ),
		vertex: {
			module: shader,
			entryPoint: 'vs',
			buffers: [
				{
					arrayStride: LEVEL_VERTEX_STRIDE,
					attributes: [
						{ shaderLocation: 0, offset: 0, format: 'float32x3' },
						{ shaderLocation: 1, offset: 28, format: 'float32x2' },
						{ shaderLocation: 2, offset: 36, format: 'float32x2' },
						{ shaderLocation: 3, offset: 24, format: 'unorm8x4' },
						{ shaderLocation: 4, offset: 68, format: 'uint32' },
						{ shaderLocation: 5, offset: 12, format: 'float32x3' },
						{ shaderLocation: 6, offset: 44, format: 'float32x3' },
						{ shaderLocation: 7, offset: 56, format: 'float32x3' },
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
	};

	pipeline = res.createRenderPipeline( descriptor );

	const factors: GPUBlendFactor[] = [
		'zero',
		'zero',
		'one',
		'src',
		'one-minus-src',
		'src-alpha',
		'one-minus-src-alpha',
		'dst-alpha',
		'one-minus-dst-alpha',
		'dst',
		'one-minus-dst',
		'src-alpha-saturated',
	];

	for ( const draw of current.manifest.draws ?? [] ) {
		const state = draw.state ?? { src: 2, dst: 0, offset: 0, write: true, sort: 3 };
		const srcFactor = factors[state.src] ?? 'one';
		const dstFactor = factors[state.dst] ?? 'zero';
		const key = JSON.stringify( state );

		if ( materialPipelines.has( key ) ) {
			continue;
		}

		const blend: GPUBlendComponent = { srcFactor, dstFactor, operation: 'add' };

		materialPipelines.set(
			key,
			res.createRenderPipeline( {
				...descriptor,
				label: 'cod2_material_' + key,
				primitive: {
					...descriptor.primitive,
					frontFace: 'cw',
					cullMode: state.cull ?? 'none',
				},
				vertex: {
					...descriptor.vertex,
					constants: { polygonOffset: state.offset ?? 0 },
				},
				fragment: {
					module: shader,
					entryPoint: 'fs',
					constants: {
						alphaTest: state.alpha ?? -1,
						materialLit: Number( state.lit ?? true ),
						materialFog: Number( state.fog ?? true ),
						materialMultiply: Number( state.multiply ?? false ),
						fogBlack: Number( state.dst === 2 ),
					},
					targets: [
						{
							format: res.format,
							blend: {
								color: blend,
								alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
							},
						},
					],
				},
				depthStencil: {
					format: 'depth24plus',
					depthWriteEnabled: state.write ?? true,
					depthCompare: state.compare ?? 'less-equal',
					depthBiasSlopeScale: -( state.offset ?? 0 ),
				},
			} )
		);
	}

	preparedDraws = ( current.manifest.draws ?? [] ).map( ( draw ) => ( {
		start: draw.start,
		count: draw.count,
		pipeline: materialPipelines.get( JSON.stringify( draw.state ) )!,
	} ) );

	binding = res.createBindGroup( {
		layout,
		entries: [
			{ binding: 0, resource: { buffer: camera } },
			{ binding: 1, resource: texture.createView( { dimension: '2d-array' } ) },
			{
				binding: 2,
				resource: res.createSampler!( {
					magFilter: 'linear',
					minFilter: 'linear',
					mipmapFilter: 'linear',
					maxAnisotropy: 8,
					addressModeU: 'repeat',
					addressModeV: 'repeat',
				} ),
			},
			{ binding: 3, resource: lightmap.createView( { dimension: '2d-array' } ) },
			{ binding: 4, resource: normal.createView( { dimension: '2d-array' } ) },
			{ binding: 5, resource: sun.createView( { dimension: '2d-array' } ) },
			{ binding: 6, resource: sky.createView( { dimension: 'cube' } ) },
			{ binding: 7, resource: weights.createView() },
			{
				binding: 8,
				resource: res.createSampler!( {
					magFilter: 'linear',
					minFilter: 'linear',
				} ),
			},
			{ binding: 9, resource: { buffer: probes } },
		],
	} );

	const diffuseTarget = texture;
	const lightTarget = lightmap;
	const maxUploadLayers = res.limits?.maxTextureArrayLayers ?? 256;

	void ( async () => {
		const jobs = current.manifest.textures.slice( 0, maxUploadLayers ).map( ( entry, index ) => ( {
			url: entry ? Asset_LevelURL( current.base, entry.rgba ?? entry.file ) : '',
			target: diffuseTarget,
			layer: index,
			size: LEVEL_TEXTURE_DIMENSION,
		} ) );

		jobs.push(
			...current.manifest.textures.slice( 0, maxUploadLayers ).map( ( entry, layer ) => ( {
				url: entry?.normal ? Asset_LevelURL( current.base, entry.normal_rgba ?? entry.normal ) : '',
				target: normal!,
				layer,
				size: LEVEL_TEXTURE_DIMENSION,
			} ) )
		);

		jobs.push(
			...current.manifest.lightmaps.map( ( file, layer ) => ( {
				url: Asset_LevelURL( current.base, file ),
				target: lightTarget,
				layer,
				size: LEVEL_TEXTURE_DIMENSION,
			} ) )
		);

		jobs.push(
			...current.manifest.sunmaps.map( ( file, layer ) => ( {
				url: Asset_LevelURL( current.base, file ),
				target: sun!,
				layer,
				size: LEVEL_SUNMAP_DIMENSION,
			} ) )
		);

		jobs.push(
			...current.manifest.sky.map( ( file, layer ) => ( {
				url: Asset_LevelURL( current.base, file ),
				target: sky!,
				layer,
				size: LEVEL_TEXTURE_DIMENSION,
			} ) )
		);

		jobs.push( {
			url: weightsUrl,
			target: weights!,
			layer: 0,
			size: LEVEL_LIGHTMAP_WEIGHTS_SIZE,
		} );

		try {
			const pending = jobs.filter( ( job ) => job.url );
			let completed = 0;

			await Asset_MapJobs( pending, 6, async ( job ) => {
					if ( epoch !== serial || resources !== res ) return;
					let response: Response;

					try {
						response = await Asset_Fetch( job.url );
					} catch {
						response = new Response( null, { status: 404 } );
					}

					if ( !response.ok ) throw new Error( 'World asset ' + job.url + ': ' + await response.text() );

					if ( job.url.endsWith( '.rgba' ) ) {
						const pixels = await response.arrayBuffer();
						let offset = 0;

						for ( let mip = 0; mip < job.target.mipLevelCount; mip++ ) {
							const size = Math.max( 1, job.size >> mip );
							const length = size * size * 4;

							if ( offset + length > pixels.byteLength ) {
								throw new Error( 'Truncated texture mip ' + job.url );
							}

							if ( epoch === serial && resources === res ) {
								upload.writeTexture!(
									{ texture: job.target, mipLevel: mip, origin: [0, 0, job.layer] },
									pixels,
									{ offset, bytesPerRow: size * 4, rowsPerImage: size },
									[size, size]
								);
							}

							offset += length;
						}

						if ( offset !== pixels.byteLength ) {
							throw new Error( 'Unexpected texture payload ' + job.url );
						}

						if ( epoch === serial ) {
							Level_GraphicsProgress( current, ++completed / pending.length );
						}

						return;
					}

					const bitmap = await createImageBitmap( await response.blob(), {
						resizeWidth: job.size,
						resizeHeight: job.size,
						resizeQuality: 'high',
						premultiplyAlpha: 'none',
						colorSpaceConversion: 'none',
					} );

					if ( epoch === serial && resources === res ) {
						upload.copyExternalImageToTexture!(
							{ source: bitmap },
							{ texture: job.target, origin: [0, 0, job.layer] },
							[job.size, job.size]
						);
					}

					for ( let mip = 1; mip < job.target.mipLevelCount; mip++ ) {
						const size = Math.max( 1, job.size >> mip );
						const reduced = await createImageBitmap( bitmap, {
							resizeWidth: size,
							resizeHeight: size,
							resizeQuality: 'high',
							premultiplyAlpha: 'none',
							colorSpaceConversion: 'none',
						} );

						if ( epoch === serial && resources === res ) {
							upload.copyExternalImageToTexture!(
								{ source: reduced },
								{ texture: job.target, mipLevel: mip, origin: [0, 0, job.layer] },
								[size, size]
							);
						}

						reduced.close();
					}

					bitmap.close();

					if ( epoch === serial ) {
						Level_GraphicsProgress( current, ++completed / pending.length );
					}
				}
			);

			if ( epoch === serial && level === current ) {
				ready = true;
				Level_GraphicsReady( current );
			}
		} catch ( error ) {
			if ( epoch === serial ) {
				Con_Printf( 'Unable to load world textures: ' + String( error ) + '\n' );
				Level_GraphicsFailed( current );
				RGPU_LevelDestroy();
			}
		}
	} )();
}


// ---------------------------------------------------------------------------
// depth & camera pass helpers
// ---------------------------------------------------------------------------

/*
====================
RGPU_LevelDepth

Returns or resizes the depth attachment for rendering level geometry.
====================
*/
export function RGPU_LevelDepth( width: number, height: number ): GPUTextureView | null {
	if ( !ready || !resources ) {
		return null;
	}

	const size = width + 'x' + height;

	if ( size !== depthSize ) {
		depth?.destroy();
		depth = resources.createTexture!( {
			size: [width, height],
			format: 'depth24plus',
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		} );
		depthSize = size;
	}

	return depth!.createView();
}

/*
====================
RGPU_LevelCamera

Uploads perspective matrices, sun direction, lighting colors, and fog uniforms.
Computes field-of-view from dvar settings and weapons definition tables.
====================
*/
export function RGPU_LevelCamera( upload: rgpu_draw_upload_t, refdef: refdef_t, aspect: number ): void {
	if ( !camera || !level ) {
		return;
	}

	const data = new Float32Array( 32 );

	data.set( refdef.vieworg, 0 );
	data.set( refdef.viewaxis[0], 4 );
	data.set( refdef.viewaxis[1], 8 );
	data.set( refdef.viewaxis[2], 12 );

	// 0x4cf270 multiplies tan(fov/2) by .75, then by the display aspect.
	const fov = Math.max(
		Number( Cvar_Get( 'cg_fovMin' ) ) || LEVEL_MIN_FOV,
		Weapon_Fov( Number( Cvar_Get( 'cg_fov' ) ) || LEVEL_DEFAULT_FOV, refdef.weapon ) * ( Number( Cvar_Get( 'cg_fovScale' ) ) || 1 )
	);

	// DLL 0x1000acf9 registers r_znear=4, range .001..16.
	const scale = 1 / ( Math.tan( ( fov * Math.PI ) / 360 ) * 0.75 );
	const near = Math.min( 16, Math.max( 0.001, Number( Cvar_Get( 'r_znear' ) ) || LEVEL_DEFAULT_NEAR ) );
	const far = LEVEL_DEFAULT_FAR;

	data.set( [scale / aspect, scale, far / ( far - near ), ( -near * far ) / ( far - near )], 16 );
	data.set( level.manifest.sun.direction, 20 );
	data.set( level.manifest.sun.color, 24 );
	data.set( level.manifest.fog, 28 );

	upload.writeBuffer( camera, 0, data.buffer, 0, 128 );
}

/*
====================
RGPU_LevelDraw

Submits draw commands for the active BSP world geometry.
Applies material pipelines in sequence for multi-pass translucent and decal surfaces.
====================
*/
export function RGPU_LevelDraw( pass: GPURenderPassEncoder ): boolean {
	if ( !ready || !pipeline || !binding || !vertex || !level ) {
		return false;
	}

	pass.setPipeline( pipeline );
	pass.setBindGroup( 0, binding );
	pass.setVertexBuffer( 0, vertex );

	if ( level.manifest.draws ) {
		let active = pipeline;

		for ( const draw of preparedDraws ) {
			if ( draw.pipeline !== active ) {
				pass.setPipeline( draw.pipeline );
				active = draw.pipeline;
			}

			pass.draw( draw.count, 1, draw.start );
		}
	} else {
		pass.draw( level.manifest.vertices );
	}

	return true;
}


// ---------------------------------------------------------------------------
// world scene post-processing & separable blur
// ---------------------------------------------------------------------------

/*
====================
RGPU_LevelSceneTarget

Allocates or resizes offscreen HDR scene textures for post-processing and gaussian blur.
====================
*/
export function RGPU_LevelSceneTarget( width: number, height: number ): GPUTextureView | null {
	if ( !ready || !resources ) {
		return null;
	}

	const res = resources;

	if ( !blurPipeline ) {
		const shader = res.createShaderModule( {
			label: 'cod2_world_blur',
			code: `
struct Params {
	step: vec2f,
	radius: f32,
	pad: f32
};

@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

struct Varying {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f
};

@vertex fn vs( @builtin(vertex_index) index: u32 ) -> Varying {
	let p = array<vec2f, 3>( vec2f( -1, -1 ), vec2f( 3, -1 ), vec2f( -1, 3 ) );
	var out: Varying;

	out.position = vec4f( p[index], 0, 1 );
	out.uv = p[index] * vec2f( 0.5, -0.5 ) + 0.5;

	return out;
}

@fragment fn fs( input: Varying ) -> @location(0) vec4f {
	var color = vec4f( 0 );
	var total = 0.0;

	for ( var i = 0; i < 8; i++ ) {
		let x = ( f32( i ) + 0.5 ) * 3.0 / 8.0;
		let weight = exp( -0.5 * x * x );
		let offset = params.step * x * params.radius;

		color += ( textureSample( source, linearSampler, input.uv + offset ) + textureSample( source, linearSampler, input.uv - offset ) ) * weight;
		total += 2.0 * weight;
	}

	return color / total;
}`,
		} );

		blurLayout = res.createBindGroupLayout( {
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			],
		} );

		blurPipeline = res.createRenderPipeline( {
			label: 'cod2_world_blur',
			layout: res.createPipelineLayout( { bindGroupLayouts: [blurLayout] } ),
			vertex: { module: shader, entryPoint: 'vs' },
			fragment: { module: shader, entryPoint: 'fs', targets: [{ format: res.format }] },
			primitive: { topology: 'triangle-list' },
		} );

		blurBuffers = [0, 1].map( () => res.createBuffer( {
			size: LEVEL_BLUR_BUFFER_SIZE,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		} ) );
	}

	const size = width + 'x' + height;

	if ( size !== blurSize ) {
		scene?.destroy();
		blurred?.destroy();

		const descriptor = {
			size: [width, height],
			format: res.format,
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		};

		scene = res.createTexture!( descriptor );
		blurred = res.createTexture!( descriptor );
		blurSize = size;

		const sampler = res.createSampler!( { magFilter: 'linear', minFilter: 'linear' } );

		blurBindings = [scene, blurred].map( ( tex, index ) => res.createBindGroup( {
			layout: blurLayout!,
			entries: [
				{ binding: 0, resource: tex.createView() },
				{ binding: 1, resource: sampler },
				{ binding: 2, resource: { buffer: blurBuffers[index] } },
			],
		} ) );
	}

	return scene!.createView();
}

/*
====================
RGPU_LevelBlurTarget

Returns the secondary render target for separable two-pass gaussian blur.
====================
*/
export function RGPU_LevelBlurTarget(): GPUTextureView | null {
	return blurred?.createView() ?? null;
}

/*
====================
RGPU_LevelBlur

Submits a 1D horizontal or vertical pass of the separable blur filter.
====================
*/
export function RGPU_LevelBlur(
	pass: GPURenderPassEncoder,
	upload: rgpu_draw_upload_t,
	axis: number,
	width: number,
	height: number,
	radius: number
): void {
	if ( !blurPipeline || !blurBindings[axis] ) {
		return;
	}

	const params = new Float32Array( [
		axis === 0 ? 1 / width : 0,
		axis === 1 ? 1 / height : 0,
		( radius * height ) / 480,
		0,
	] );

	upload.writeBuffer( blurBuffers[axis], 0, params.buffer, 0, 16 );
	pass.setPipeline( blurPipeline );
	pass.setBindGroup( 0, blurBindings[axis] );
	pass.draw( 3 );
}
