/*
===============================================================================

	retail-xanim.ts

	Call of Duty 2 / id Tech Skeletal Animation Decoder
	Decodes v14 XAnim translation & quaternion rotation channel curves.
	Unpacks packed integer quaternions, signs, bitflags, and root delta motions.

===============================================================================
*/

import { readCStringList, readVec3 } from './retail-constants.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const XANIM_VERSION = 14;
export const XANIM_FLAG_LOOP = 1;
export const XANIM_FLAG_DELTA = 2;

export const XANIM_DELTA_SCALE = 16384.0;
export const XANIM_DELTA_NORM = 0x3fff0001;

export const XANIM_CHANNEL_SCALE = 32767.0;
export const XANIM_CHANNEL_MAX_SQ = 32767 * 32767;


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface XAnimChannel {
	rotation_times: number[];
	rotations: [number, number, number, number][];
	translation_times: number[];
	translations: [number, number, number][];
}

export interface DecodedXAnim {
	frames: number;
	rate: number;
	loop: boolean;
	delta: XAnimChannel | null;
	channels: Record<string, XAnimChannel>;
}


// ---------------------------------------------------------------------------
// skeletal animation decoding
// ---------------------------------------------------------------------------

/*
====================
decodeXAnim

Decodes Call of Duty 2 v14 binary skeletal animations:
- Reads animation frame bounds, playback rate, and loop/delta flags.
- Decodes bone names and variable-length keyframe time arrays.
- Unpacks 16-bit packed quaternion components into normalized unit quaternions.
- Reads 3D vector bone translation tracks.
====================
*/
export function decodeXAnim( data: Uint8Array ): DecodedXAnim {
	const view = new DataView( data.buffer, data.byteOffset, data.byteLength );
	const version = view.getUint16( 0, true );

	if ( version !== XANIM_VERSION ) {
		throw new Error( `Unsupported xanim version ${version}; expected ${XANIM_VERSION}` );
	}

	const frames = view.getUint16( 2, true );
	const count = view.getUint16( 4, true );
	const flags = view.getUint8( 6 );
	const rate = view.getUint16( 7, true );

	const loop = Boolean( flags & XANIM_FLAG_LOOP );
	const hasDelta = Boolean( flags & XANIM_FLAG_DELTA );
	const maxFrames = frames + ( loop ? 1 : 0 );

	let cursor = 9;

	/*
	====================
	readTimes

	Reads keyframe time indices, choosing byte or word representations
	based on the total animation frame count.
	====================
	*/
	function readTimes( n: number ): number[] {
		if ( n > 1 && n < maxFrames ) {
			const times: number[] = [];
			const useByte = maxFrames <= 256;

			for ( let i = 0; i < n; i++ ) {
				if ( useByte ) {
					times.push( data[cursor++] );
				} else {
					times.push( view.getUint16( cursor, true ) );
					cursor += 2;
				}
			}

			return times;
		}

		const seq: number[] = [];

		for ( let i = 0; i < n; i++ ) {
			seq.push( i );
		}

		return seq;
	}

	/*
	====================
	readTranslations

	Reads an array of 3D vector translations from the data stream.
	====================
	*/
	function readTranslations( n: number ): [number, number, number][] {
		const trans: [number, number, number][] = [];

		for ( let i = 0; i < n; i++ ) {
			trans.push( readVec3( view, cursor ) );
			cursor += 12;
		}

		return trans;
	}

	let delta: XAnimChannel | null = null;

	if ( hasDelta ) {
		const nRot = view.getUint16( cursor, true );
		cursor += 2;

		const rt = readTimes( nRot );
		const rot: [number, number, number, number][] = [];

		for ( let i = 0; i < nRot; i++ ) {
			const v = view.getInt16( cursor, true );
			cursor += 2;

			const rem = Math.max( 0, XANIM_DELTA_NORM - v * v );
			const w = Math.floor( Math.sqrt( rem ) + 0.5 );

			rot.push( [0.0, 0.0, v / XANIM_DELTA_SCALE, w / XANIM_DELTA_SCALE] );
		}

		const nTrans = view.getUint16( cursor, true );
		cursor += 2;

		const tt = readTimes( nTrans );
		const trans = readTranslations( nTrans );

		delta = {
			rotation_times: rt,
			rotations: rot,
			translation_times: tt,
			translations: trans,
		};
	}

	const size = Math.floor( ( count + 7 ) / 8 );
	const flip = data.subarray( cursor, cursor + size );
	const simple = data.subarray( cursor + size, cursor + size * 2 );
	cursor += size * 2;

	const decoder = new TextDecoder( 'ascii' );
	const { strings: names, cursor: namesCursor } = readCStringList( data, count, cursor, decoder );
	cursor = namesCursor;

	const channels: Record<string, XAnimChannel> = {};

	for ( let i = 0; i < count; i++ ) {
		const name = names[i];
		const n = view.getUint16( cursor, true );
		cursor += 2;

		const rt = readTimes( n );
		const isSimple = Boolean( simple[i >> 3] & ( 1 << ( i & 7 ) ) );
		const isFlipped = Boolean( flip[i >> 3] & ( 1 << ( i & 7 ) ) );

		const rot: [number, number, number, number][] = [];

		for ( let k = 0; k < n; k++ ) {
			let q: [number, number, number, number];

			if ( isSimple ) {
				const z = view.getInt16( cursor, true );
				cursor += 2;

				const sumSq = z * z;
				const w = Math.floor( Math.sqrt( Math.max( 0, XANIM_CHANNEL_MAX_SQ - sumSq ) ) + 0.5 );
				q = [0, 0, z, w];
			} else {
				const x = view.getInt16( cursor, true );
				const y = view.getInt16( cursor + 2, true );
				const z = view.getInt16( cursor + 4, true );
				cursor += 6;

				const sumSq = x * x + y * y + z * z;
				const w = Math.floor( Math.sqrt( Math.max( 0, XANIM_CHANNEL_MAX_SQ - sumSq ) ) + 0.5 );
				q = [x, y, z, w];
			}

			if (
				( k === 0 && isFlipped ) ||
				( k > 0 && ( q[0] * rot[k - 1][0] + q[1] * rot[k - 1][1] + q[2] * rot[k - 1][2] + q[3] * rot[k - 1][3] < 0 ) )
			) {
				q = [-q[0], -q[1], -q[2], -q[3]];
			}

			rot.push( q );
		}

		const normalizedRot: [number, number, number, number][] = rot.map(
			( q ) => [
				q[0] / XANIM_CHANNEL_SCALE,
				q[1] / XANIM_CHANNEL_SCALE,
				q[2] / XANIM_CHANNEL_SCALE,
				q[3] / XANIM_CHANNEL_SCALE,
			]
		);

		const nTrans = view.getUint16( cursor, true );
		cursor += 2;

		const tt = readTimes( nTrans );
		const trans = readTranslations( nTrans );

		channels[name] = {
			rotation_times: rt,
			rotations: normalizedRot,
			translation_times: tt,
			translations: trans,
		};
	}

	return {
		frames,
		rate,
		loop,
		delta,
		channels,
	};
}
