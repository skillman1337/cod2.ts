/*
===============================================================================

	retail-model.ts

	Call of Duty 2 / id Tech Skeletal Mesh Decoder
	Decodes v20 XModel, XModelParts, and XModelSurfs without native dependencies.
	Evaluates bone hierarchies, transforms, quaternion rotations, and skeletal skinning.

===============================================================================
*/

import { readCString, readCStringList, readVec3 } from './retail-constants.js';

export { readCString, readCStringList, readVec3 };


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const XMODEL_VERSION = 20;
export const XMODEL_MAX_LODS = 4;
export const XMODEL_WEIGHT_SCALE = 65535;
export const XMODEL_LOD0_NAME_OFFSET = 31;
export const XMODEL_BONE_ENTRY_SIZE = 19;
export const XMODEL_INT16_MAX = 32767;


// ---------------------------------------------------------------------------
// types & influence constructors
// ---------------------------------------------------------------------------

export type Influence = [number, number, [number, number, number]] & {
	joint: number;
	weight: number;
	localPos: [number, number, number];
};

/*
====================
makeInfluence

Creates a dual-representation bone influence:
acts both as a 3-element tuple [joint, weight, localPos] and an object with named properties.
====================
*/
export function makeInfluence(
	joint: number,
	weight: number,
	localPos: [number, number, number]
): Influence {
	const inf = [joint, weight, localPos] as unknown as Influence;
	inf.joint = joint;
	inf.weight = weight;
	inf.localPos = localPos;

	return inf;
}

/*
====================
unpackInfluence

Extracts the joint index, scalar weight, and local 3D offset from an Influence,
handling both array-tuple and object-property representations.
====================
*/
export function unpackInfluence(
	inf: Influence
): { joint: number; weight: number; localPos: [number, number, number] } {
	return Array.isArray( inf )
		? { joint: inf[0], weight: inf[1], localPos: inf[2] }
		: { joint: ( inf as any ).joint, weight: ( inf as any ).weight, localPos: ( inf as any ).localPos };
}

export interface ModelVertex {
	normal: [number, number, number];
	tangent: [number, number, number];
	binormal: [number, number, number];
	uv: [number, number];
	influences: Influence[];
}

export interface ModelSurface {
	material: string;
	vertices: ModelVertex[];
	indices: number[];
}

export interface ModelBone {
	name: string;
	parent: number;
	pose: [[number, number, number, number], [number, number, number]];
}

export interface DecodedModel {
	name: string;
	bones: ModelBone[];
	surfaces: ModelSurface[];
}

export const IDENTITY_POSE: [[number, number, number, number], [number, number, number]] = [
	[0, 0, 0, 1],
	[0, 0, 0],
];


// ---------------------------------------------------------------------------
// quaternion & transform math
// ---------------------------------------------------------------------------

/*
====================
rotateVector

Rotates a 3D vector by a normalized unit quaternion using Rodrigues formula.
====================
*/
export function rotateVector(
	q: [number, number, number, number],
	v: [number, number, number]
): [number, number, number] {
	const [x, y, z, w] = q;

	const t: [number, number, number] = [
		2 * ( y * v[2] - z * v[1] ),
		2 * ( z * v[0] - x * v[2] ),
		2 * ( x * v[1] - y * v[0] ),
	];

	return [
		v[0] + w * t[0] + y * t[2] - z * t[1],
		v[1] + w * t[1] + z * t[0] - x * t[2],
		v[2] + w * t[2] + x * t[1] - y * t[0],
	];
}

/*
====================
multiplyQuat

Computes the Hamilton product of two quaternions (a * b).
====================
*/
export function multiplyQuat(
	a: [number, number, number, number],
	b: [number, number, number, number]
): [number, number, number, number] {
	const [x, y, z, w] = a;
	const [X, Y, Z, W] = b;

	return [
		w * X + x * W + y * Z - z * Y,
		w * Y - x * Z + y * W + z * X,
		w * Z + x * Y - y * X + z * W,
		w * W - x * X - y * Y - z * Z,
	];
}

/*
====================
composeTransform

Composes parent and local coordinate frame transformations [rotationQuat, translationVec].
====================
*/
export function composeTransform(
	parent: [[number, number, number, number], [number, number, number]],
	local: [[number, number, number, number], [number, number, number]]
): [[number, number, number, number], [number, number, number]] {
	const [q, p] = parent;
	const [r, t] = local;
	const v = rotateVector( q, t );

	return [
		multiplyQuat( q, r ),
		[v[0] + p[0], v[1] + p[1], v[2] + p[2]],
	];
}


// ---------------------------------------------------------------------------
// skeletal hierarchy & skinning
// ---------------------------------------------------------------------------

/*
====================
poseModel

Propagates transforms down the skeletal parent-child hierarchy to compute
world-space joint poses for the entire skeleton.
====================
*/
export function poseModel(
	model: DecodedModel,
	attachment: [[number, number, number, number], [number, number, number]] = IDENTITY_POSE
): [[number, number, number, number], [number, number, number]][] {
	const transforms: [[number, number, number, number], [number, number, number]][] = [];

	for ( const bone of model.bones ) {
		const parent = bone.parent >= 0 ? transforms[bone.parent] : attachment;
		transforms.push( composeTransform( parent, bone.pose ) );
	}

	return transforms;
}

/*
====================
skinVertex

Computes the world-space position, normal, tangent, and binormal for a vertex
by linearly blending joint influence weights and rotating tangent frames.
====================
*/
export function skinVertex(
	vertex: ModelVertex,
	transforms: [[number, number, number, number], [number, number, number]][]
): {
	position: [number, number, number];
	normal: [number, number, number];
	tangent: [number, number, number];
	binormal: [number, number, number];
} {
	const position: [number, number, number] = [0, 0, 0];

	for ( const inf of vertex.influences ) {
		const { joint, weight, localPos } = unpackInfluence( inf );
		const [q, p] = transforms[joint];
		const v = rotateVector( q, localPos );

		position[0] += weight * ( v[0] + p[0] );
		position[1] += weight * ( v[1] + p[1] );
		position[2] += weight * ( v[2] + p[2] );
	}

	const first = unpackInfluence( vertex.influences[0] );
	const qPrimary = transforms[first.joint][0];

	return {
		position,
		normal: rotateVector( qPrimary, vertex.normal ),
		tangent: rotateVector( qPrimary, vertex.tangent ),
		binormal: rotateVector( qPrimary, vertex.binormal ),
	};
}


// ---------------------------------------------------------------------------
// surface geometry unpacking
// ---------------------------------------------------------------------------

/*
====================
unpackSurfaceDirect

Parses a raw binary mesh surface from XModelSurfs data:
- Extracts vertex normals, texture UV coordinates, tangents, and binormals.
- Decodes single-bone or weighted multi-bone joint influence tables.
- Reads triangle index streams and pads odd triangle counts.
====================
*/
export function unpackSurfaceDirect(
	data: Uint8Array,
	startOffset: number
): {
	offset: number;
	nv: number;
	nt: number;
	bone: number;
	vertices: ModelVertex[];
	indices: number[];
} {
	const view = new DataView( data.buffer, data.byteOffset, data.byteLength );
	let offset = startOffset;

	const _flag = data[offset++];
	const nv = view.getUint16( offset, true );
	offset += 2;

	const nt = view.getUint16( offset, true );
	offset += 2;

	const bone = view.getInt16( offset, true );
	offset += 2;

	if ( bone < 0 ) {
		// extra_size
		offset += 2;
	}

	const vertices: ModelVertex[] = [];

	for ( let i = 0; i < nv; i++ ) {
		const normal = readVec3( view, offset );
		offset += 12;

		// color (4 bytes)
		offset += 4;

		const u = view.getFloat32( offset, true );
		const v = view.getFloat32( offset + 4, true );
		offset += 8;

		const tangent = readVec3( view, offset );
		offset += 12;

		const binormal = readVec3( view, offset );
		offset += 12;

		const influences: Influence[] = [];

		if ( bone < 0 ) {
			const extra = data[offset++];
			const primaryJoint = view.getInt16( offset, true );
			offset += 2;

			const pos = readVec3( view, offset );
			offset += 12;

			let total = 0;

			if ( extra > 0 ) {
				// alignment pad byte
				offset++;

				for ( let j = 0; j < extra; j++ ) {
					const joint = view.getInt16( offset, true );
					offset += 2;

					const epos = readVec3( view, offset );
					offset += 12;

					const weight = view.getUint16( offset, true ) / XMODEL_WEIGHT_SCALE;
					offset += 2;

					total += weight;
					influences.push( makeInfluence( joint, weight, epos ) );
				}
			}

			influences.unshift( makeInfluence( primaryJoint, 1 - total, pos ) );
		} else {
			const pos = readVec3( view, offset );
			offset += 12;

			influences.push( makeInfluence( bone, 1.0, pos ) );
		}

		vertices.push( {
			normal,
			tangent,
			binormal,
			uv: [u, v],
			influences,
		} );
	}

	const indices: number[] = [];
	const triangleIndexCount = nt * 3;

	for ( let i = 0; i < triangleIndexCount; i++ ) {
		indices.push( view.getUint16( offset, true ) );
		offset += 2;
	}

	let actualNt = nt;

	if ( nt % 2 !== 0 ) {
		actualNt++;
		const lastIdx = indices[indices.length - 1];
		indices.push( lastIdx, lastIdx, lastIdx );
	}

	return {
		offset,
		nv,
		nt: actualNt,
		bone,
		vertices,
		indices,
	};
}


// ---------------------------------------------------------------------------
// retail model decoder & binary helpers
// ---------------------------------------------------------------------------

/*
====================
readModelLod

Extracts the primary LOD0 surface stream identifier from an XModel binary buffer.
====================
*/
export function readModelLod( modelBytes: Uint8Array ): string {
	return readCString( modelBytes, XMODEL_LOD0_NAME_OFFSET ).text;
}

/*
====================
RetailModelDecoder

Coordinates loading and caching of Call of Duty 2 skeletal models:
1. Loads 'xmodel/<name>' metadata header, LOD names, and material references.
2. Loads 'xmodelsurfs/<lod>' binary vertex, normal, UV, and triangle data.
3. Loads 'xmodelparts/<lod>' root and nonroot bone hierarchy and base poses.
====================
*/
export class RetailModelDecoder {
	private cache = new Map<string, DecodedModel>();
	private read: ( path: string ) => Uint8Array | Promise<Uint8Array>;

	constructor( read: ( path: string ) => Uint8Array | Promise<Uint8Array> ) {
		this.read = read;
	}

	/*
	====================
	load

	Loads and decodes a complete skeletal model by name, caching the resulting DecodedModel.
	====================
	*/
	async load( rawName: string ): Promise<DecodedModel> {
		const name = rawName.startsWith( 'xmodel/' ) ? rawName.slice( 'xmodel/'.length ) : rawName;
		const cached = this.cache.get( name );

		if ( cached ) {
			return cached;
		}

		const modelBytes = await this.read( `xmodel/${name}` );
		const modelView = new DataView( modelBytes.buffer, modelBytes.byteOffset, modelBytes.byteLength );

		if ( modelView.getUint16( 0, true ) !== XMODEL_VERSION ) {
			throw new Error( `Invalid xmodel version: expected ${XMODEL_VERSION} in ${name}` );
		}

		let cursor = 27;
		const lods: string[] = [];
		const decoder = new TextDecoder( 'utf-8' );

		for ( let i = 0; i < XMODEL_MAX_LODS; i++ ) {
			cursor += 4;
			const entry = readCString( modelBytes, cursor, decoder );
			lods.push( entry.text );
			cursor = entry.cursor;
		}

		cursor += 4;

		const collisionCount = modelView.getUint32( cursor, true );
		cursor += 4;

		for ( let i = 0; i < collisionCount; i++ ) {
			const triangles = modelView.getUint32( cursor, true );
			cursor += 4 + triangles * 48 + 36;
		}

		const materialCount = modelView.getUint16( cursor, true );
		cursor += 2;

		const { strings: materials, cursor: materialsCursor } = readCStringList( modelBytes, materialCount, cursor, decoder );
		cursor = materialsCursor;

		const encodedSurfs = await this.read( `xmodelsurfs/${lods[0]}` );
		const surfsView = new DataView( encodedSurfs.buffer, encodedSurfs.byteOffset, encodedSurfs.byteLength );
		const surfsVersion = surfsView.getUint16( 0, true );
		const surfsCount = surfsView.getUint16( 2, true );

		if ( surfsVersion !== XMODEL_VERSION || surfsCount !== materialCount ) {
			throw new Error( `xmodelsurfs mismatch for ${name}: count=${surfsCount}, expected ${materialCount}` );
		}

		const parts = await this.read( `xmodelparts/${lods[0]}` );
		const partsView = new DataView( parts.buffer, parts.byteOffset, parts.byteLength );
		const nonroots = partsView.getUint16( 2, true );
		const roots = partsView.getUint16( 4, true );
		cursor = 6;

		const bones: ModelBone[] = [];

		for ( let i = 0; i < roots; i++ ) {
			bones.push( { name: '', parent: -1, pose: IDENTITY_POSE } );
		}

		for ( let i = roots; i < roots + nonroots; i++ ) {
			const parent = parts[cursor];
			const pos = readVec3( partsView, cursor + 1 );
			const rx = partsView.getInt16( cursor + 13, true );
			const ry = partsView.getInt16( cursor + 15, true );
			const rz = partsView.getInt16( cursor + 17, true );
			cursor += XMODEL_BONE_ENTRY_SIZE;

			const sumSq = rx * rx + ry * ry + rz * rz;
			const rw = Math.floor( Math.sqrt( Math.max( 0, XMODEL_INT16_MAX * XMODEL_INT16_MAX - sumSq ) ) + 0.5 );

			bones.push( {
				name: '',
				parent,
				pose: [
					[rx / XMODEL_INT16_MAX, ry / XMODEL_INT16_MAX, rz / XMODEL_INT16_MAX, rw / XMODEL_INT16_MAX],
					pos,
				],
			} );
		}

		const { strings: boneNames, cursor: boneNamesCursor } = readCStringList( parts, bones.length, cursor, decoder );
		cursor = boneNamesCursor;

		for ( let i = 0; i < bones.length; i++ ) {
			bones[i].name = boneNames[i];
		}

		let surfsCursor = 4;
		const surfaces: ModelSurface[] = [];

		for ( let i = 0; i < materialCount; i++ ) {
			const result = unpackSurfaceDirect( encodedSurfs, surfsCursor );
			surfsCursor = result.offset;

			surfaces.push( {
				material: materials[i],
				vertices: result.vertices,
				indices: result.indices,
			} );
		}

		const model: DecodedModel = { name, bones, surfaces };
		this.cache.set( name, model );

		return model;
	}
}
