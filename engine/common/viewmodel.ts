/*
===============================================================================

	viewmodel.ts

	Call of Duty 2 / id Tech Viewmodel & Weapon Animation Evaluator
	Evaluates dual-DObj skeletal hierarchy (player hands and weapon model),
	procedural weapon sway, idle bobbing, ADS transitions, and hardware vertex skinning.

===============================================================================
*/

import { Weapon_Animation, Weapon_Definition, type weapon_state_t } from './weapon.js';
import { WeaponMotion_Idle, WeaponMotion_Bob } from './weapon_motion.js';


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export type vm_pose_t = [number[], number[]];

export interface vm_channel_t {
	rotation_times: number[];
	rotations: number[][];
	translation_times: number[];
	translations: number[][];
}

export interface vm_animation_t {
	frames: number;
	rate: number;
	loop: boolean;
	channels: Record<string, vm_channel_t>;
}

export interface vm_vertex_t {
	normal: number[];
	uv: number[];
	influences: [number, number, number[]][];
}

export interface vm_surface_t {
	material: string;
	vertices: vm_vertex_t[];
	indices: number[];
}

export interface vm_model_t {
	name: string;
	bones: {
		name: string;
		parent: number;
		pose: vm_pose_t;
	}[];
	surfaces: vm_surface_t[];
}


// ---------------------------------------------------------------------------
// quaternion & transform math
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * VM_Rotate
 *
 * Rotates a 3D vector by a normalized quaternion, accounting for compressed roundoff.
 * ================
 */
export function VM_Rotate( q: number[], v: number[] ): number[] {
	const [x, y, z, w] = q;
	const k = 2 / ( x * x + y * y + z * z + w * w || 1 );

	const t = [
		k * ( y * v[2] - z * v[1] ),
		k * ( z * v[0] - x * v[2] ),
		k * ( x * v[1] - y * v[0] ),
	];

	return [
		v[0] + w * t[0] + y * t[2] - z * t[1],
		v[1] + w * t[1] + z * t[0] - x * t[2],
		v[2] + w * t[2] + x * t[1] - y * t[0],
	];
}

/**
 * @exec helper
 * ================
 * VM_Compose
 *
 * Composes two coordinate transforms (parent a and local b) into a world pose.
 * Native DObj composition at 0x486ba0 and 0x487691.
 * ================
 */
export function VM_Compose( a: vm_pose_t, b: vm_pose_t ): vm_pose_t {
	const [x, y, z, w] = a[0];
	const [X, Y, Z, W] = b[0];
	const p = VM_Rotate( a[0], b[1] );

	return [
		[
			w * X + x * W + y * Z - z * Y,
			w * Y - x * Z + y * W + z * X,
			w * Z + x * Y - y * X + z * W,
			w * W - x * X - y * Y - z * Z,
		],
		p.map( ( v, i ) => v + a[1][i] ),
	];
}


// ---------------------------------------------------------------------------
// skeletal track evaluation
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * VM_Track
 *
 * Interpolates sparse keyframe arrays; quaternion tracks take the shortest spherical arc.
 * ================
 */
export function VM_Track(
	keys: number[][],
	times: number[],
	frame: number,
	rotation: boolean
): number[] | undefined {
	if ( !keys.length ) {
		return;
	}

	let i = 0;

	while ( i + 1 < keys.length && times[i + 1] <= frame ) {
		i++;
	}

	const a = keys[i];
	const b = keys[Math.min( i + 1, keys.length - 1 )];

	const t = i + 1 < keys.length
		? Math.max( 0, Math.min( 1, ( frame - times[i] ) / ( times[i + 1] - times[i] ) ) )
		: 0;

	const sign = rotation && a.reduce( ( s, v, j ) => s + v * b[j], 0 ) < 0 ? -1 : 1;
	const v = a.map( ( x, j ) => x + ( b[j] * sign - x ) * t );

	if ( rotation ) {
		const length = Math.hypot( ...v ) || 1;
		return v.map( ( x ) => x / length );
	}

	return v;
}

/**
 * @exec helper
 * ================
 * VM_Channels
 *
 * Evaluates active animation channels across weapon and player hands.
 * Blends ADS down/up tracks continuously alongside primary action animations.
 * Native routine reconstructed from 0x4d36b0 and 0x4d394f.
 * ================
 */
export function VM_Channels(
	animations: Record<string, vm_animation_t>,
	w: weapon_state_t
): Record<string, Partial<{ q: number[]; p: number[] }>> {
	const def = Weapon_Definition( w.id )!;
	const result: Record<string, Partial<{ q: number[]; p: number[] }>> = {};

	const apply = ( name: string, frame?: number, weight: number = 1 ) => {
		const a = animations[name];

		// A disabled layer must not claim new bones, even with explicit keys.
		if ( !a || weight <= 0 ) {
			return;
		}

		const elapsed = ( ( w.holster ? w.holsterElapsed ?? 0 : w.elapsed ) * a.rate ) / 1000;
		const f = frame === undefined
			? ( a.loop ? elapsed % Math.max( 1, a.frames ) : Math.min( a.frames, elapsed ) )
			: frame * a.frames;

		for ( const [channelName, c] of Object.entries( a.channels ) ) {
			// Listed zero-key XAnim channels explicitly contribute identity / zero.
			// Leaving them undefined retains stale idle/ADS components or bind pose.
			const q = VM_Track( c.rotations, c.rotation_times, f, true ) ?? [ 0, 0, 0, 1 ];
			const p = VM_Track( c.translations, c.translation_times, f, false ) ?? [ 0, 0, 0 ];
			const target = ( result[channelName] ??= {} );

			if ( q ) {
				const aQ = target.q ?? q;
				const sign = aQ.reduce( ( s, v, i ) => s + v * q[i], 0 ) < 0 ? -1 : 1;
				const v = aQ.map( ( x, i ) => x * ( 1 - weight ) + q[i] * sign * weight );
				const length = Math.hypot( ...v ) || 1;
				target.q = v.map( ( x ) => x / length );
			}

			if ( p ) {
				const aP = target.p ?? p;
				target.p = aP.map( ( x, i ) => x * ( 1 - weight ) + p[i] * weight );
			}
		}
	};

	apply( def.idleAnim, 0 );
	apply( Weapon_Animation( w ) );

	// 0x4d394f..0x4d3969 updates these tracks before dispatching the ordinary
	// animation, including putaway/raise. They also contain the hip root pose.
	apply( def.adsDownAnim, 1 - w.ads );
	apply( def.adsUpAnim, w.ads, w.adsBlend ?? ( w.adsIn ? 1 : 0 ) );

	return result;
}


// ---------------------------------------------------------------------------
// viewmodel assembly
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * VM_Pose
 *
 * Propagates bone poses down the skeletal hierarchy for a single model (0x487677).
 * ================
 */
export function VM_Pose(
	model: vm_model_t,
	channels: ReturnType<typeof VM_Channels>,
	attachment: vm_pose_t = [[0, 0, 0, 1], [0, 0, 0]]
): vm_pose_t[] {
	const result: vm_pose_t[] = [];

	for ( const b of model.bones ) {
		const c = channels[b.name];
		const p = b.pose[1].map( ( v, i ) => v + ( c?.p?.[i] ?? 0 ) );
		const parentPose = b.parent < 0 ? attachment : result[b.parent];

		result.push( VM_Compose( parentPose, [c?.q ?? b.pose[0], p] ) );
	}

	return result;
}

/**
 * @exec helper
 * ================
 * VM_WeaponPose
 *
 * Composes procedural sway, bob, recoil, and ADS offsets before attaching weapon to hands via tag_weapon.
 * ================
 */
export function VM_WeaponPose(
	models: vm_model_t[],
	animations: Record<string, vm_animation_t>,
	w: weapon_state_t
): vm_pose_t[][] {
	const def = Weapon_Definition( w.id )!;
	const bob = w.motion ? WeaponMotion_Bob( w.motion, def, w.ads ) : [0, 0, 0];
	const channels = VM_Channels( animations, w );

	const angles = w.motion
		? WeaponMotion_Idle( w.motion, def, w.ads ).map( ( x, i ) => x + w.motion!.gun[i] + bob[i] )
		: [0, 0, 0];

	for ( let i = 0; i < 3; i++ ) {
		angles[i] += ( w.motion?.moveRotation?.[i] ?? 0 ) * Math.max( 0, 1 - 2 * w.ads );
	}

	angles[0] += ( Number( def.adsAimPitch ) || 0 ) * w.ads;

	const lean = w.motion?.lean ?? 0;
	angles[2] += -2 * ( 2 - Math.abs( lean ) ) * lean;

	let root: vm_pose_t = [
		[0, 0, 0, 1],
		( w.motion?.movePosition ?? [0, 0, 0] ).map( ( v, i ) => v * Math.max( 0, 1 - 2 * w.ads ) * ( i === 1 ? -1 : 1 ) ),
	];

	for ( const [axis, index] of [[2, 1], [1, 0], [0, 2]] ) {
		const a = ( angles[index] * Math.PI ) / 360;
		const q = [0, 0, 0, Math.cos( a )];
		q[axis] = Math.sin( a );
		root = VM_Compose( root, [q, [0, 0, 0]] );
	}

	const hands = VM_Pose( models[0], channels, root );
	const tag = models[0].bones.findIndex( ( b ) => b.name === 'tag_weapon' );

	return [hands, VM_Pose( models[1], channels, hands[tag] ?? root )];
}


// ---------------------------------------------------------------------------
// hardware vertex skinning
// ---------------------------------------------------------------------------

// Scratch storage is scoped to the loaded surface and released with its assets.
const skinVertices = new WeakMap<vm_surface_t, Float32Array>();

/**
 * @exec helper
 * ================
 * VM_Skin
 *
 * Surface vertices carry positions in each influencing bone's space.
 * Keeps the original first-influence normal rule and deindexed buffer layout.
 * With a correctly sized output, the hot path allocates no arrays after warmup.
 * ================
 */
export function VM_Skin(
	surface: vm_surface_t,
	pose: vm_pose_t[],
	output?: Float32Array
): Float32Array {
	const count = surface.vertices.length;
	const size = surface.indices.length * 8;
	let vertices = skinVertices.get( surface );

	if ( !vertices || vertices.length !== count * 8 ) {
		vertices = new Float32Array( count * 8 );
		skinVertices.set( surface, vertices );
	}

	if ( output && output.length !== size ) {
		throw new RangeError( 'VM_Skin: incorrect output length' );
	}

	const data = output ?? new Float32Array( size );
	const defaultPose: vm_pose_t = [[0, 0, 0, 1], [0, 0, 0]];

	for ( let index = 0; index < count; index++ ) {
		const v = surface.vertices[index];
		let px = 0;
		let py = 0;
		let pz = 0;

		for ( let influence = 0; influence < v.influences.length; influence++ ) {
			const item = v.influences[influence];
			const joint = Array.isArray( item ) ? item[0] : ( item as any ).joint;
			const weight = Array.isArray( item ) ? item[1] : ( item as any ).weight;
			const p = Array.isArray( item ) ? item[2] : ( item as any ).localPos;
			const t = pose[joint] ?? defaultPose;
			const q = t[0];

			const x = q[0];
			const y = q[1];
			const z = q[2];
			const w = q[3];

			const k = 2 / ( x * x + y * y + z * z + w * w || 1 );
			const tx = k * ( y * p[2] - z * p[1] );
			const ty = k * ( z * p[0] - x * p[2] );
			const tz = k * ( x * p[1] - y * p[0] );

			px += weight * ( p[0] + w * tx + y * tz - z * ty + t[1][0] );
			py += weight * ( p[1] + w * ty + z * tx - x * tz + t[1][1] );
			pz += weight * ( p[2] + w * tz + x * ty - y * tx + t[1][2] );
		}

		const first = v.influences[0];
		const firstJoint = Array.isArray( first ) ? first[0] : ( first as any )?.joint ?? 0;
		const q = ( pose[firstJoint] ?? defaultPose )[0];
		const n = v.normal;
		const x = q[0];
		const y = q[1];
		const z = q[2];
		const w = q[3];

		const k = 2 / ( x * x + y * y + z * z + w * w || 1 );
		const tx = k * ( y * n[2] - z * n[1] );
		const ty = k * ( z * n[0] - x * n[2] );
		const tz = k * ( x * n[1] - y * n[0] );
		const offset = index * 8;

		vertices[offset] = px;
		vertices[offset + 1] = py;
		vertices[offset + 2] = pz;
		vertices[offset + 3] = n[0] + w * tx + y * tz - z * ty;
		vertices[offset + 4] = n[1] + w * ty + z * tx - x * tz;
		vertices[offset + 5] = n[2] + w * tz + x * ty - y * tx;
		vertices[offset + 6] = v.uv[0];
		vertices[offset + 7] = v.uv[1];
	}

	for ( let i = 0; i < surface.indices.length; i++ ) {
		const source = surface.indices[i] * 8;
		const target = i * 8;

		for ( let attribute = 0; attribute < 8; attribute++ ) {
			data[target + attribute] = vertices[source + attribute];
		}
	}

	return data;
}
