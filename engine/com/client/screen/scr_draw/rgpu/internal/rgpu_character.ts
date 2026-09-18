/*
===============================================================================

	rgpu_character.ts

	WebGPU third-person player character rendering pipeline.
	Handles loading and drawing character bodies, attached heads, and helmets
	in world space during the world render pass with directional sun & probe lighting.

===============================================================================
*/

import { Asset_Fetch } from '../../../../../../common/asset_paths.js';
import { Cvar_Get } from '@/engine/common/cvar.js';
import { Con_Printf } from '@/engine/common/common.js';
import { Level_WorldVisible, Level_Data } from '@/engine/common/level.js';
import { LightGrid_Sample, type lightgrid_t } from '@/engine/common/lightgrid.js';
import { Material_LoadImages, type material_source_t } from '@/engine/common/material_assets.js';
import { PM_TraceShape } from '@/engine/common/pm.js';
import type { refdef_t, vec3_t } from '@/engine/common/types.js';
import {
	Character_SelectAnim,
	Character_SelectTorsoAnim,
	Character_EvaluateTracks,
	Character_BlendTracks,
	Character_AnimDurationMs,
	Character_AnimMoveSpeed,
	Character_WorldRoot,
	Character_PoseModel,
	Character_PoseAttachedModel,
	Character_PoseHelmet,
	Character_PoseWeapon,
	Character_SkinSurface,
	CHARACTER_TORSO_BONES,
	BG_RunLerpFrameRate,
	DObjCreate,
	DObjCalcSkel,
	type lerpFrame_t,
	type character_catalog_t,
	type character_model_t,
	type character_animation_t,
} from '@/engine/common/character.js';
import { Character_AngleSubtract, Character_CreateControllers, Character_ControllerTargets, Character_StepControllers, Character_ControllerOverrides, CHARACTER_CONTROL_TAGS } from '@/engine/common/character_controllers.js';
import { Weapon_Definition, Weapon_Fov } from '@/engine/common/weapon.js';
import { VM_Compose, type vm_surface_t, type vm_pose_t } from '@/engine/common/viewmodel.js';
import type { rgpu_draw_resources_t, rgpu_draw_upload_t } from './rgpu_draw_contract.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const CHARACTER_BLEND_DURATION_MS      = 200;
export const CHARACTER_BLEND_FAST_DURATION_MS = 100;
export const CHARACTER_CAMERA_UNIFORM_SIZE    = 240;
export const CHARACTER_CAMERA_UNIFORM_FLOATS = 60;
export const CHARACTER_VERTEX_STRIDE         = 32;
export const CHARACTER_DEFAULT_FOV           = 80;
export const CHARACTER_MIN_FOV               = 10;
export const CHARACTER_DEFAULT_NEAR          = 4;
export const CHARACTER_DEFAULT_FAR           = 100000.0;


// ---------------------------------------------------------------------------
// renderer state globals
// ---------------------------------------------------------------------------

let epoch = 0;
let selected = '';
let ready = false;
let bodyModel: character_model_t | null = null;
let headModel: character_model_t | null = null;
let helmetModel: character_model_t | null = null;
let weaponModel: character_model_t | null = null;
let currentWeapon = '';
let animations: Record<string, character_animation_t> = {};
let catalog: character_catalog_t | null = null;

let uniform: GPUBuffer | null = null;
let pipeline: GPURenderPipeline | null = null;
interface character_surface_t {
	source: vm_surface_t;
	modelType: 'body' | 'head' | 'helmet' | 'weapon';
	data: Float32Array;
	buffer: GPUBuffer;
	binding: GPUBindGroup;
}
let surfaces: character_surface_t[] = [];
let textures: GPUTexture[] = [];
let grid: lightgrid_t | null = null;
let map = '';
let lastAnimTime = -1;
let currentAnimKey = '';
let currentPlayhead = 0;
let prevAnimKey = '';
let prevPlayhead = 0;
let prevRate = 1;
let controllerState = Character_CreateControllers();
const controllerTarget = Character_CreateControllers();
const assetWarnings = new Set<string>();
let blendElapsed = CHARACTER_BLEND_DURATION_MS;
let blendDuration = CHARACTER_BLEND_DURATION_MS;
let wasAirborne = false;
let landingTimer = 0;
let currentTorsoKey = '';
let currentTorsoPlayhead = 0;
let prevTorsoKey = '';
let prevTorsoPlayhead = 0;
let torsoBlendElapsed = CHARACTER_BLEND_DURATION_MS;
let torsoBlendDuration = CHARACTER_BLEND_DURATION_MS;
let prevTorsoWeight = 0;
const legsLerpFrame: lerpFrame_t = {
	rate: 1.0,
	oldTime: 0,
	playhead: 0,
};

/**
 * @exec helper
 * ================
 * RGPU_CharacterDestroy
 *
 * Owner destroys all resources and invalidates in-flight asset jobs.
 * ================
 */
export function RGPU_CharacterDestroy(): void {
	epoch++;
	ready = false;
	selected = '';
	bodyModel = null;
	headModel = null;
	helmetModel = null;
	weaponModel = null;
	currentWeapon = '';
	animations = {};
	catalog = null;
	lastAnimTime = -1;
	currentAnimKey = '';
	currentPlayhead = 0;
	prevAnimKey = '';
	prevPlayhead = 0;
	prevRate = 1;
	controllerState = Character_CreateControllers();
	assetWarnings.clear();
	blendElapsed = CHARACTER_BLEND_DURATION_MS;
	blendDuration = CHARACTER_BLEND_DURATION_MS;
	wasAirborne = false;
	landingTimer = 0;
	currentTorsoKey = '';
	currentTorsoPlayhead = 0;
	prevTorsoKey = '';
	prevTorsoPlayhead = 0;
	torsoBlendElapsed = CHARACTER_BLEND_DURATION_MS;
	torsoBlendDuration = CHARACTER_BLEND_DURATION_MS;
	prevTorsoWeight = 0;
	legsLerpFrame.oldTime = 0;
	legsLerpFrame.oldOrigin = undefined;
	legsLerpFrame.rate = 1.0;
	legsLerpFrame.playhead = 0;
	uniform?.destroy();
	uniform = null;
	pipeline = null;
	grid = null;
	map = '';

	for ( const s of surfaces ) {
		s.buffer.destroy();
	}

	for ( const t of textures ) {
		t.destroy();
	}

	surfaces = [];
	textures = [];
}

/**
 * @exec helper
 * ================
 * RGPU_CharacterPrepare
 *
 * Device resources are obtained only through the draw owner's narrow capability.
 * ================
 */
export function RGPU_CharacterPrepare( res: rgpu_draw_resources_t, upload: rgpu_draw_upload_t ): void {
	const level = Level_Data();
	const charCvar = Cvar_Get( 'cg_character' ).trim().toLowerCase();
	const charId = Level_WorldVisible() ? ( charCvar || level?.manifest.nationalities[Cvar_Get( 'ui_team' ) || 'allies'] || '' ) : '';
	const currentMap = level?.manifest.name ?? '';
	const weaponId = Level_WorldVisible() ? ( Cvar_Get( 'ui_weapon' ) || '' ) : '';

	if ( charId === selected && map === currentMap && weaponId === currentWeapon ) return;

	RGPU_CharacterDestroy();
	selected = charId;
	map = currentMap;
	currentWeapon = weaponId;
	if ( !charId ) return;
	const generation = epoch;

	void ( async () => {
		const json = async <T>( path: string ): Promise<T> => {
			const r = await Asset_Fetch( '/characters/' + path, { cache: 'no-cache' } );
			if ( !r.ok ) throw new Error( path + ': ' + r.status );
			return r.json() as Promise<T>;
		};

		const cat = await json<character_catalog_t>( 'catalog.json' );
		catalog = cat;
		const charDef = cat.characters[charId];
		if ( !charDef ) throw new Error( 'No character definition found for ' + charId );

		// Load 3D models
		const bodyPromise = json<character_model_t>( 'models/' + charDef.body + '.json' );
		const headPromise = charDef.head ? json<character_model_t>( 'models/' + charDef.head + '.json' ) : Promise.resolve( null );
		const helmetPromise = charDef.helmet
			? json<character_model_t>( 'models/' + charDef.helmet + '.json' )
			: Promise.resolve( null );

		// Resolve weapon world model
		const weapDef = Weapon_Definition( weaponId );
		const worldModelPath = weapDef?.worldModel?.replace( /\\/g, '/' ).replace( /^xmodel\//i, '' ).toLowerCase();
		const weaponPromise = worldModelPath
			? json<character_model_t>( 'models/' + worldModelPath + '.json' ).catch( ( error ) => {
				if ( generation === epoch ) Con_Printf( 'Missing world model for ' + weaponId + ': ' + String( error ) + '\n' );
				return null;
			} )
			: Promise.resolve( null );

		// Load all animations
		const animEntries = Object.entries( cat.animations );
		const animPromises = animEntries.map( async ( [ key, file ] ) => {
			const data = await json<character_animation_t>( 'animations/' + file + '.json' );
			return [ key, data ] as const;
		} );

		const [ loadedBody, loadedHead, loadedHelmet, loadedWeapon, loadedAnims ] = await Promise.all( [
			bodyPromise,
			headPromise,
			helmetPromise,
			weaponPromise,
			Promise.all( animPromises ),
		] );

		if ( generation !== epoch ) return;

		const boneNames = new Set( [ ...loadedBody.bones, ...( loadedHead?.bones || [] ) ].map( ( bone ) => bone.name ) );
		const missingTags = [ 'tag_origin', ...CHARACTER_CONTROL_TAGS ].filter( ( tag ) => !boneNames.has( tag ) );
		if ( missingTags.length ) Con_Printf( 'Character export is missing native control tags: ' + missingTags.join( ', ' ) + '. No guessed spine/axis substitution will be applied.\n' );
		bodyModel = loadedBody;
		headModel = loadedHead;
		helmetModel = loadedHelmet;
		weaponModel = loadedWeapon;
		animations = Object.fromEntries( loadedAnims );

		// Collect unique materials
		const allModels = [
			loadedBody,
			...( loadedHead ? [loadedHead] : [] ),
			...( loadedHelmet ? [ loadedHelmet ] : [] ),
			...( loadedWeapon ? [ loadedWeapon ] : [] ),
		];
		const allMaterials = [ ...new Set( allModels.flatMap( ( m ) => m.surfaces.map( ( s ) => s.material ) ) ) ];

		// Native materials have global identities. Character exports may not include
		// world-weapon images which already exist in the viewmodel/map export.
		const materialSources: material_source_t[] = [ { url: '/characters/catalog.json', materials: cat.materials ?? {} } ];

		if ( level ) {
			materialSources.push( {
				url: level.base.replace( /\/?$/, '/' ) + 'manifest.json',
				materials: Object.fromEntries( level.manifest.textures.flatMap( ( t ) => ( t ? [ [ t.material, { file: t.file } ] ] : [] ) ) ),
			} );
		}

		const images = await Material_LoadImages(
			allMaterials,
			materialSources,
			[ '/viewmodels/catalog.json' ],
			( message ) => {
				if ( generation === epoch ) {
					Con_Printf( message + '\n' );
				}
			}
		);

		if ( generation !== epoch ) {
			images.forEach( ( i ) => i?.close() );
			return;
		}

		// Lightgrid
		if ( map ) {
			try {
				grid = await Asset_Fetch( '/maps/' + map + '/lightgrid.json' ).then( ( r ) => ( r.ok ? r.json() : null ) );
			} catch {
				grid = null;
			}
		}

		if ( generation !== epoch ) {
			images.forEach( ( i ) => i?.close() );
			return;
		}

		// Camera uniform: 240 bytes (60 floats)
		uniform = res.createBuffer( {
			label: 'cod2_character_camera',
			size: CHARACTER_CAMERA_UNIFORM_SIZE,
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
			label: 'cod2_character_shader',
			code: `
struct Camera {
	position: vec4f,
	forward: vec4f,
	right: vec4f,
	up: vec4f,
	projection: vec4f,
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
	let delta = position - camera.position.xyz;
	let z = dot(delta, camera.forward.xyz);
	out.position = vec4f(
		dot(delta, camera.right.xyz) * camera.projection.x,
		dot(delta, camera.up.xyz) * camera.projection.y,
		z * camera.projection.z + camera.projection.w,
		z
	);
	out.uv = uv;
	out.normal = normal;
	return out;
}

@fragment fn fs(input: Output) -> @location(0) vec4f {
	let c = textureSample(diffuse, linearSampler, input.uv);
	if (c.a < 0.5) { discard; }
	let n = normalize(input.normal);
	let r = vec3f(
		dot(n, vec3f(0.81649658, 0.0, 0.57735027)),
		dot(n, vec3f(-0.40824829, 0.70710678, 0.57735027)),
		dot(n, vec3f(-0.40824829, -0.70710678, 0.57735027))
	);
	let coord = r / max(max(abs(r.x), abs(r.y)), abs(r.z)) * 0.5 + 0.5;
	var probe = vec4f(0.0);
	for (var i = 0; i < 8; i++) {
		probe += camera.probe[i] *
			select(1.0 - coord.x, coord.x, (i & 1) != 0) *
			select(1.0 - coord.y, coord.y, (i & 2) != 0) *
			select(1.0 - coord.z, coord.z, (i & 4) != 0);
	}
	let sunLighting = probe.a * camera.sunColor.rgb * max(0.0, dot(n, camera.sun.xyz));
	let lighting = probe.rgb + sunLighting;
	return vec4f(c.rgb * lighting, 1.0);
}
`,
		} );

		pipeline = res.createRenderPipeline( {
			label: 'cod2_character_pipeline',
			layout: res.createPipelineLayout( { bindGroupLayouts: [ layout ] } ),
			vertex: {
				module: shader,
				entryPoint: 'vs',
				buffers: [
					{
						arrayStride: CHARACTER_VERTEX_STRIDE,
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
				targets: [ { format: res.format } ],
			},
			primitive: { topology: 'triangle-list', cullMode: 'none' },
			depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
		} );

		const sampler = res.createSampler!( {
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'repeat',
			addressModeV: 'repeat',
		} );

		const bindings = new Map<string, GPUBindGroup>();
		let fallbackTex: GPUTexture | null = null;
		const getFallbackView = (): GPUTextureView => {
			if ( !fallbackTex ) {
				fallbackTex = res.createTexture!( {
					label: 'cod2_char_MISSING_MATERIAL',
					size: [ 2, 2 ],
					format: 'rgba8unorm',
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
				} );
				textures.push( fallbackTex );
				if ( upload.writeTexture ) {
					const pixel = new Uint8Array( [
						255, 0, 255, 255, 0, 0, 0, 255,
						0, 0, 0, 255, 255, 0, 255, 255,
					] );
					upload.writeTexture( { texture: fallbackTex }, pixel.buffer as ArrayBuffer, { bytesPerRow: 8 }, [ 2, 2 ] );
				}
			}
			return fallbackTex.createView();
		};

		for ( let i = 0; i < allMaterials.length; i++ ) {
			const name = allMaterials[i];
			const bitmap = images[i];
			let texView: GPUTextureView;
			if ( bitmap ) {
				const texture = res.createTexture!( {
					label: 'cod2_char_' + name,
					size: [ bitmap.width, bitmap.height ],
					format: 'rgba8unorm',
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
				} );
				textures.push( texture );
				upload.copyExternalImageToTexture!( { source: bitmap }, { texture }, [ bitmap.width, bitmap.height ] );
				bitmap.close();
				texView = texture.createView();
			} else {
				texView = getFallbackView();
			}

			bindings.set(
				name,
				res.createBindGroup( {
					layout,
					entries: [
						{ binding: 0, resource: { buffer: uniform! } },
						{ binding: 1, resource: texView },
						{ binding: 2, resource: sampler },
					],
				} )
			);
		}

		// Create surface GPU buffers for body, head, helmet, and weapon
		const addSurfaces = ( m: character_model_t, modelType: 'body' | 'head' | 'helmet' | 'weapon' ) => {
			for ( const s of m.surfaces ) {
				const buf = res.createBuffer( {
					label: m.name + '_' + s.material,
					size: Math.max( 32, s.indices.length * 32 ),
					usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
				} );
				const binding = bindings.get( s.material );
				if ( !binding ) throw new Error( 'Unbound material: ' + s.material );
				surfaces.push( {
					source: s,
					modelType,
					data: new Float32Array( s.indices.length * 8 ),
					buffer: buf,
					binding,
				} );
			}
		};

		addSurfaces( loadedBody, 'body' );
		if ( loadedHead ) addSurfaces( loadedHead, 'head' );
		if ( loadedHelmet ) {
			addSurfaces( loadedHelmet, 'helmet' );
		}
		if ( loadedWeapon ) {
			addSurfaces( loadedWeapon, 'weapon' );
		}

		ready = true;
	} )().catch( ( error ) => {
		if ( generation === epoch ) Con_Printf( 'Character prepare failed: ' + String( error ) + '\n' );
	} );
}

/**
 * @exec helper
 * ================
 * RGPU_CharacterDraw
 *
 * Draw the player character on the frame owner's world render pass.
 * ================
 */
export function RGPU_CharacterDraw(
	pass: GPURenderPassEncoder,
	upload: rgpu_draw_upload_t,
	refdef: refdef_t,
	aspect: number
): void {
	if ( !ready || !pipeline || !uniform || !bodyModel ) {
		return;
	}

	// Advance animation state even when hidden in first person. Visibility must
	// not be the time source (otherwise changing cameras pauses/restarts clips).

	// Calculate player position (ground coordinates)
	const eye = refdef.playerorg ?? refdef.vieworg;
	const stanceTarget = refdef.movement?.stance?.target ?? 60;
	const stanceHeight = refdef.movement?.stance?.height ?? 60;
	const groundOrigin: vec3_t = refdef.playerGroundOrigin ?? [ eye[0], eye[1], eye[2] - stanceHeight ];

	// Calculate player orientation (yaw)
	const angles = refdef.playerangles ?? refdef.viewangles;
	let playerYaw = angles[1];

	const ladder = refdef.movement?.ladder;
	if ( ladder ) {
		// When climbing or stationary on a ladder, player faces directly into the rungs
		playerYaw = Math.atan2( -ladder.normal[1], -ladder.normal[0] ) * ( 180.0 / Math.PI );
	}

	const vel: vec3_t = refdef.movement?.velocity ?? [ 0, 0, 0 ];
	const horizSpeed = Math.hypot( vel[0], vel[1] );

	// refdef.time is seconds; movement.commandTime is simulation milliseconds.
	// Never discard elapsed time with a 100ms cap or use the camera's Z for speed.
	const backwards = lastAnimTime >= 0 && refdef.time < lastAnimTime;
	const dt = lastAnimTime < 0 || backwards ? 0 : Math.max( 0, refdef.time - lastAnimTime );
	lastAnimTime = refdef.time;
	if ( backwards ) {
		currentAnimKey = '';
		prevAnimKey = '';
		currentPlayhead = 0;
		legsLerpFrame.oldOrigin = undefined;
		legsLerpFrame.rate = 1;
		controllerState = Character_CreateControllers();
		wasAirborne = false;
		landingTimer = 0;
	}
	const grounded = refdef.movement?.grounded ?? true;
	const isAirborne = !grounded && !ladder;
	const landingFromAir = wasAirborne && grounded && !ladder;

	// Track jump / airborne / landing transitions
	if ( landingFromAir ) {
		landingTimer = Character_AnimDurationMs( animations[horizSpeed > 5 ? 'land_run' : 'land_stand'] );
	} else if ( landingTimer > 0 ) {
		landingTimer = Math.max( 0, landingTimer - dt * 1000.0 );
	}
	wasAirborne = isAirborne;

	const isLanding = landingTimer > 0 && grounded && !ladder;

	// Existing catalog ADS overlay; not the native XAnim aim subtree.
	const adsFrac = Math.min( 1.0, Math.max( 0.0, refdef.weapon?.ads ?? 0.0 ) );

	// Select base animation from player stance, speed, and movement
	let targetAnimKey = Character_SelectAnim( {
		time_ms: refdef.time * 1000.0,
		stance: stanceTarget,
		velocity: vel,
		yaw: angles[1],
		pitch: angles[0],
		ads: adsFrac > 0.05,
		ladder,
		grounded,
		airborne: isAirborne,
		landing: isLanding,
		bobCycle: refdef.movement?.bobCycle,
	} );

	// Resolve a missing catalog alias BEFORE comparing animation identity.
	// Otherwise a fallback may be restarted on every draw.
	if ( !animations[targetAnimKey] ) {
		const requested = targetAnimKey;
		if ( requested.startsWith( 'walk_' ) && animations['run_' + requested.slice( 5 )] ) targetAnimKey = 'run_' + requested.slice( 5 );
		else if ( requested.startsWith( 'crouch_walk_' ) && animations['crouch_' + requested.slice( 12 )] ) targetAnimKey = 'crouch_' + requested.slice( 12 );
		else if ( requested === 'crouch_ads' && animations['crouch_idle'] ) targetAnimKey = 'crouch_idle';
		else if ( requested === 'stand_ads' && animations['stand_idle'] ) targetAnimKey = 'stand_idle';
		else targetAnimKey = 'stand_idle';
		if ( !assetWarnings.has( requested ) ) {
			assetWarnings.add( requested );
			Con_Printf( "Missing catalog animation '" + requested + "'; using '" + targetAnimKey + "'. Export the native script/tree clips for exact selection.\n" );
		}
	}

	if ( targetAnimKey !== currentAnimKey ) {
		const isReversal = targetAnimKey === prevAnimKey && blendElapsed < blendDuration;
		const nextPrevKey = currentAnimKey;
		const nextPrevPlayhead = currentPlayhead;
		const nextPrevRate = legsLerpFrame.rate;
		const nextBlendDuration = targetAnimKey.startsWith( 'land_' ) || targetAnimKey.startsWith( 'jump_' )
			? CHARACTER_BLEND_FAST_DURATION_MS
			: CHARACTER_BLEND_DURATION_MS;
		const nextBlendElapsed = isReversal ? Math.max( 0, nextBlendDuration - blendElapsed ) : ( prevAnimKey ? 0 : nextBlendDuration );
		const nextCurrentPlayhead = isReversal ? prevPlayhead : 0;

		prevAnimKey = nextPrevKey;
		prevPlayhead = nextPrevPlayhead;
		prevRate = nextPrevRate;
		blendDuration = nextBlendDuration;
		blendElapsed = nextBlendElapsed;
		currentAnimKey = targetAnimKey;
		currentPlayhead = nextCurrentPlayhead;
	}
	blendElapsed += dt * 1000;
	if ( blendElapsed < blendDuration && prevAnimKey ) prevPlayhead += dt * 1000 * prevRate;

	const currAnim = animations[currentAnimKey];
	const sampleTimeMs = refdef.movement?.commandTime ?? refdef.time * 1000;
	const speedScale = BG_RunLerpFrameRate( legsLerpFrame, currAnim, groundOrigin, sampleTimeMs, !!ladder );

	// Synchronize looping locomotion playhead with player movement gait cycle (bobCycle).
	// Footstep sounds trigger at bobCycle=64 (left footstrike) and bobCycle=192 (right footstrike),
	// which corresponds exactly to 25% and 75% phase of the authored locomotion cycle.
	const isLocomotion = Boolean( currAnim?.loop && ( ladder || horizSpeed > 5 ) );
	if ( isLocomotion && refdef.movement?.bobCycle !== undefined ) {
		const animDuration = Character_AnimDurationMs( currAnim );
		currentPlayhead = ( ( ( refdef.movement.bobCycle ) & 255 ) / 256.0 ) * animDuration;
	} else {
		currentPlayhead += dt * 1000 * speedScale;
	}

	if ( currAnim && ( ladder || horizSpeed > 5 ) && !Character_AnimMoveSpeed( currAnim ) && !assetWarnings.has( 'delta:' + currentAnimKey ) ) {
		assetWarnings.add( 'delta:' + currentAnimKey );
		Con_Printf( "Animation '" + currentAnimKey + "' has zero/missing root-motion speed. Playing its authored rate, not inventing a movement divisor. Verify the exported delta track.\n" );
	}

	// Bridge the port's local predicted player to native controller inputs.
	// A native entity producer can supply the full legs/torso yaw, ground pitch,
	// movement condition bits, and torso height through playerControllers.
	// The bridge lacks native yaw-swing/ground-conformance state; it does NOT
	// pretend to reconstruct those values from a camera or a weapon-name rule.
	Character_ControllerTargets( refdef.playerControllers ?? {
		playerAngles: [ angles[0], playerYaw, angles[2] ],
		legsYaw: playerYaw, torsoYaw: playerYaw,
		// Native standing pitch target (BG_PlayerAnimation 0x184b6d, factor .6).
		torsoPitch: Character_AngleSubtract( angles[0], 0 ) * Math.fround( 0.6 ),
		lean: refdef.movement?.lean ?? 0,
		eFlags: stanceTarget === 11 ? 8 : stanceTarget === 40 ? 4 : 0,
	}, controllerTarget );
	Character_StepControllers( controllerState, controllerTarget, dt * 1000 );
	if ( !refdef.thirdPerson ) return;

	let tracks = currAnim ? Character_EvaluateTracks( currAnim, currentPlayhead ) : {};

	// Blend between previous and current animation poses
	if ( blendElapsed < blendDuration && prevAnimKey && animations[prevAnimKey] ) {
		const prevAnim = animations[prevAnimKey];
		const prevTracks = Character_EvaluateTracks( prevAnim, prevPlayhead );
		const blendFactor = Math.min( 1.0, Math.max( 0.0, blendElapsed / blendDuration ) );
		tracks = Character_BlendTracks( prevTracks, tracks, blendFactor );
	}

	// Torso action selection (fire, reload) with native XAnim goal weight crossfading.
	// When an action finishes its authored duration or is cancelled, it smoothly blends out
	// over the retail blend time (200ms) rather than snapping to the base pose in a single frame.
	const torsoAction = Character_SelectTorsoAnim( refdef.weapon, stanceTarget, adsFrac > 0.05 );
	let targetTorsoKey = torsoAction?.animKey ?? '';
	let targetTorsoPlayhead = torsoAction?.playhead ?? 0;

	// If the authored animation clip has reached its end, the action has completed and transitions back to idle.
	if ( targetTorsoKey && animations[targetTorsoKey] ) {
		const clipDuration = Character_AnimDurationMs( animations[targetTorsoKey] );
		const actionDuration = ( targetTorsoKey.startsWith( 'fire_' ) && targetTorsoKey.includes( 'auto' ) )
			? Math.min( clipDuration || 150, 150 ) // 150ms duration matching retail playeranim.script for automatic weapons
			: clipDuration;
		if ( actionDuration > 0 && targetTorsoPlayhead >= actionDuration ) {
			targetTorsoKey = '';
		}
	}

	if ( targetTorsoKey !== currentTorsoKey ) {
		prevTorsoKey = currentTorsoKey;
		prevTorsoPlayhead = currentTorsoPlayhead;
		if ( currentTorsoKey ) {
			const blendFrac = torsoBlendDuration > 0 ? Math.min( 1.0, torsoBlendElapsed / torsoBlendDuration ) : 1.0;
			prevTorsoWeight = prevTorsoKey ? blendFrac : Math.min( 1.0, torsoBlendElapsed / 100.0 );
		} else {
			prevTorsoWeight = 0.0;
		}
		torsoBlendDuration = CHARACTER_BLEND_DURATION_MS; // Native retail blend duration (0xc8 = 200ms)
		torsoBlendElapsed = 0;
		currentTorsoKey = targetTorsoKey;
		currentTorsoPlayhead = targetTorsoPlayhead;
	} else {
		currentTorsoPlayhead = targetTorsoPlayhead;
	}

	torsoBlendElapsed += dt * 1000.0;
	if ( prevTorsoKey ) {
		prevTorsoPlayhead += dt * 1000.0;
	}

	// Evaluate and layer torso action tracks with smooth crossfading onto CHARACTER_TORSO_BONES
	const torsoBlendFrac = torsoBlendDuration > 0 ? Math.min( 1.0, torsoBlendElapsed / torsoBlendDuration ) : 1.0;
	if ( currentTorsoKey && animations[currentTorsoKey] && prevTorsoKey && animations[prevTorsoKey] && torsoBlendFrac < 1.0 ) {
		// Blending between two actions (e.g. reload interrupted by firing)
		const currAnim = animations[currentTorsoKey];
		const prevAnim = animations[prevTorsoKey];
		const currTracks = Character_EvaluateTracks( currAnim, currentTorsoPlayhead );
		const prevTracks = Character_EvaluateTracks( prevAnim, prevTorsoPlayhead );
		const blendedAction = Character_BlendTracks( prevTracks, currTracks, torsoBlendFrac );
		tracks = Character_BlendTracks( tracks, blendedAction, 1.0, CHARACTER_TORSO_BONES );
	} else if ( currentTorsoKey && animations[currentTorsoKey] ) {
		// Blending in from none or fully active
		const currAnim = animations[currentTorsoKey];
		const currTracks = Character_EvaluateTracks( currAnim, currentTorsoPlayhead );
		const inWeight = Math.min( 1.0, torsoBlendElapsed / 100.0 );
		tracks = Character_BlendTracks( tracks, currTracks, inWeight, CHARACTER_TORSO_BONES );
	} else if ( prevTorsoKey && animations[prevTorsoKey] && torsoBlendFrac < 1.0 ) {
		// Blending out to none (e.g. reload completed or ended, smoothly returning to base tracks)
		const prevAnim = animations[prevTorsoKey];
		const prevTracks = Character_EvaluateTracks( prevAnim, prevTorsoPlayhead );
		const outWeight = prevTorsoWeight * ( 1.0 - torsoBlendFrac );
		tracks = Character_BlendTracks( tracks, prevTracks, outWeight, CHARACTER_TORSO_BONES );
	} else {
		prevTorsoKey = '';
	}

	// Native DObj control tags replace local animation, rather than rotating a
	// guessed torso bone. Construct the composite DObj (0x752f0) and evaluate
	// all model bone hierarchies in object space first (0x7561a).
	const overrides = Character_ControllerOverrides( controllerState );
	const worldRoot = Character_WorldRoot( groundOrigin, playerYaw );

	const dobj = DObjCreate( [
		{ model: bodyModel },
		headModel ? { model: headModel } : null,
		helmetModel ? { model: helmetModel, attachTagName: 'j_helmet' } : null,
		weaponModel ? { model: weaponModel, attachTagName: 'tag_weapon_right' } : null,
	] );

	const skel = DObjCalcSkel( dobj, tracks, overrides );
	const bodyPoses = skel.modelPoses[0].map( ( pose ) => VM_Compose( worldRoot, pose ) );

	let modelIndex = 1;
	const headPoses = headModel && skel.modelPoses[modelIndex]
		? skel.modelPoses[modelIndex++].map( ( pose ) => VM_Compose( worldRoot, pose ) )
		: [];
	const helmetPoses = helmetModel && skel.modelPoses[modelIndex]
		? skel.modelPoses[modelIndex++].map( ( pose ) => VM_Compose( worldRoot, pose ) )
		: [];
	const weaponPoses = weaponModel && skel.modelPoses[modelIndex]
		? skel.modelPoses[modelIndex++].map( ( pose ) => VM_Compose( worldRoot, pose ) )
		: [];

	// Build camera uniform buffer (matches world camera projection in rgpu_level.ts)
	// 0x4cf270 multiplies tan(fov/2) by .75, then by the display aspect.
	const fov = Math.max(
		Number( Cvar_Get( 'cg_fovMin' ) ) || CHARACTER_MIN_FOV,
		Weapon_Fov( Number( Cvar_Get( 'cg_fov' ) ) || CHARACTER_DEFAULT_FOV, refdef.weapon ) * ( Number( Cvar_Get( 'cg_fovScale' ) ) || 1 )
	);
	const scale = 1.0 / ( Math.tan( ( fov * Math.PI ) / 360.0 ) * 0.75 );
	const near = Math.min( 16, Math.max( 0.001, Number( Cvar_Get( 'r_znear' ) ) || CHARACTER_DEFAULT_NEAR ) );
	const far = CHARACTER_DEFAULT_FAR;

	const cameraData = new Float32Array( CHARACTER_CAMERA_UNIFORM_FLOATS );
	// 0: position (refdef.vieworg)
	cameraData.set( [ refdef.vieworg[0], refdef.vieworg[1], refdef.vieworg[2], 0.0 ], 0 );
	// 4: forward (refdef.viewaxis[0])
	cameraData.set( [ refdef.viewaxis[0][0], refdef.viewaxis[0][1], refdef.viewaxis[0][2], 0.0 ], 4 );
	// 8: right (refdef.viewaxis[1])
	cameraData.set( [ refdef.viewaxis[1][0], refdef.viewaxis[1][1], refdef.viewaxis[1][2], 0.0 ], 8 );
	// 12: up (refdef.viewaxis[2])
	cameraData.set( [ refdef.viewaxis[2][0], refdef.viewaxis[2][1], refdef.viewaxis[2][2], 0.0 ], 12 );
	// 16: projection [scale/aspect, scale, far/(far-near), -near*far/(far-near)]
	cameraData.set( [ scale / aspect, scale, far / ( far - near ), ( -near * far ) / ( far - near ) ], 16 );

	// Sun and light probe
	const level = Level_Data();
	if ( level ) {
		cameraData.set( level.manifest.sun.direction, 20 );
		cameraData.set( level.manifest.sun.color, 24 );
	}

	if ( grid ) {
		const probeData = LightGrid_Sample( grid, groundOrigin, ( a, b ) => {
			const t = PM_TraceShape( a, b, { radius: 0, half: 0, offset: 0 }, false, 0x2001 );
			return !t.startsolid && t.fraction === 1.0;
		} ).flat();
		cameraData.set( probeData, 28 );
	}

	upload.writeBuffer( uniform, 0, cameraData.buffer as ArrayBuffer, 0, cameraData.byteLength );

	pass.setPipeline( pipeline );

	// Skin and draw all surfaces
	for ( const s of surfaces ) {
		let poses: vm_pose_t[];

		if ( s.modelType === 'body' ) {
			poses = bodyPoses;
		} else if ( s.modelType === 'head' ) {
			poses = headPoses;
		} else if ( s.modelType === 'helmet' ) {
			poses = helmetPoses;
		} else {
			poses = weaponPoses;
		}

		const skinnedData = Character_SkinSurface( s.source, poses, s.data );
		upload.writeBuffer( s.buffer, 0, skinnedData.buffer as ArrayBuffer, 0, skinnedData.byteLength );
		pass.setBindGroup( 0, s.binding );
		pass.setVertexBuffer( 0, s.buffer );
		pass.draw( s.source.indices.length );
	}
}
