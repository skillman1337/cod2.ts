/*
===============================================================================

	animation-channels.test.mjs

	Original synthetic XAnim / skeleton regression fixtures. A listed channel
	with zero keys contributes identity rotation and zero translation delta;
	an absent channel leaves that bone unauthored. No retail media is needed.

===============================================================================
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register( './support/animation-assets-loader.mjs', import.meta.url );

const { decodeXAnim } = await import( '../decoders/retail-xanim.ts' );
const {
	Character_EvaluateTracks, Character_PoseModel, Character_WorldRoot,
	Character_PoseAttachedModel, Character_BlendTracks, Character_SkinSurface,
} = await import( '../../engine/common/character.ts' );
const { VM_Track, VM_Channels, VM_Pose, VM_Skin } = await import( '../../engine/common/viewmodel.ts' );

const identity = () => [0, 0, 0, 1];
const zero = () => [0, 0, 0];
const turn = degrees => [0, 0, Math.sin( degrees * Math.PI / 360 ), Math.cos( degrees * Math.PI / 360 )];
const empty = () => ( { rotations: [], rotation_times: [], translations: [], translation_times: [] } );
const channel = ( q, p ) => ( {
	rotations: q ? [q] : [], rotation_times: q ? [0] : [],
	translations: p ? [p] : [], translation_times: p ? [0] : [],
} );
const clip = channels => ( { frames: 10, rate: 10, loop: true, channels } );
const weapon = extra => ( {
	id: 'fixture', phase: 'fire', elapsed: 0, clip: 1, ads: 0, adsIn: false, adsBlend: 0,
	...extra,
} );

/*
====================
close

Compare each component so a changed orientation cannot hide behind a norm.
====================
*/
function close( actual, expected, message = '', tolerance = 1e-6 ) {
	assert.equal( actual?.length, expected.length, message );
	for ( let i = 0; i < expected.length; i++ ) {
		assert.ok( Math.abs( actual[i] - expected[i] ) <= tolerance,
			`${message} component ${i}: expected ${expected[i]}, got ${actual[i]}` );
	}
}

/*
====================
skeleton

The middle bone's authored bind orientation is deliberately non-identity.
Its descendant makes a mistaken bind fallback visible in vertex positions.
====================
*/
function skeleton( degrees = 90 ) {
	return {
		name: 'synthetic-chain',
		bones: [
			{ name: 'root', parent: -1, pose: [identity(), zero()] },
			{ name: 'joint', parent: 0, pose: [turn( degrees ), [0, 0, 10]] },
			{ name: 'tip', parent: 1, pose: [identity(), [4, 0, 0]] },
		],
		surfaces: [],
	};
}

/*
====================
emptyBinaryClip

Construct an original v14 fixture: one named bone, no rotation or position
keys. Setting the simple bit selects the native identity-rotation channel.
====================
*/
function emptyBinaryClip() {
	const header = Buffer.alloc( 9 );
	header.writeUInt16LE( 14, 0 );
	header.writeUInt16LE( 10, 2 );
	header.writeUInt16LE( 1, 4 );
	header[6] = 1;
	header.writeUInt16LE( 10, 7 );
	return Buffer.concat( [header, Buffer.from( [0, 1] ), Buffer.from( 'joint\0' ), Buffer.alloc( 4 )] );
}

test( 'v14 decoder preserves the difference between a listed zero-key channel and absence', () => {
	const decoded = decodeXAnim( emptyBinaryClip() );
	assert.deepEqual( Object.keys( decoded.channels ), ['joint'] );
	assert.deepEqual( decoded.channels.joint, empty() );
	assert.equal( decoded.channels.tip, undefined );
} );

test( 'low-level interpolation still reports absence instead of inventing a key', () => {
	assert.equal( VM_Track( [], [], 0, true ), undefined );
	assert.equal( VM_Track( [], [], 0, false ), undefined );
} );

test( 'a listed zero-key character channel evaluates to identity and zero delta', () => {
	const animation = decodeXAnim( emptyBinaryClip() );
	const before = JSON.stringify( animation );
	const tracks = Character_EvaluateTracks( animation, 250 );
	close( tracks.joint.q, identity(), 'identity rotation' );
	close( tracks.joint.p, zero(), 'zero translation delta' );
	assert.equal( tracks.tip, undefined, 'unlisted bone must remain absent' );
	assert.equal( JSON.stringify( animation ), before, 'cached animation data must not be mutated' );
} );

test( 'a genuinely absent channel keeps its bind orientation', () => {
	const model = skeleton();
	const tracks = Character_EvaluateTracks( clip( {} ), 0 );
	for ( const poses of [Character_PoseModel( model, tracks ), VM_Pose( model, tracks )] ) {
		close( poses[1][0], turn( 90 ) );
		close( poses[2][1], [0, 4, 10] );
	}
} );

test( 'identity channels correct the child chain without erasing bind translations', () => {
	const model = skeleton();
	const tracks = Character_EvaluateTracks( decodeXAnim( emptyBinaryClip() ), 0 );
	for ( const poses of [Character_PoseModel( model, tracks ), VM_Pose( model, tracks )] ) {
		close( poses[1][0], identity() );
		close( poses[1][1], [0, 0, 10], 'bind translation retained once' );
		close( poses[2][1], [4, 0, 10], 'child must follow the authored orientation' );
	}
} );

test( 'authored rotation and translation remain absolute local rotation and additive delta', () => {
	const tracks = Character_EvaluateTracks( clip( { joint: channel( turn( -90 ), [1, 2, 3] ) } ), 0 );
	const pose = Character_PoseModel( skeleton(), tracks );
	close( pose[1][0], turn( -90 ) );
	close( pose[1][1], [1, 2, 13] );
	close( pose[2][1], [1, -2, 13] );
} );

test( 'rotation-only and translation-only channels supply their identity components', () => {
	const tracks = Character_EvaluateTracks( clip( {
		rotationOnly: channel( turn( 90 ), undefined ),
		translationOnly: channel( undefined, [2, 3, 4] ),
	} ), 0 );
	close( tracks.rotationOnly.q, turn( 90 ) );
	close( tracks.rotationOnly.p, zero() );
	close( tracks.translationOnly.q, identity() );
	close( tracks.translationOnly.p, [2, 3, 4] );
} );

test( 'evaluated explicit identity channels blend, rather than holding the previous pose', () => {
	const a = Character_EvaluateTracks( clip( { joint: channel( turn( 90 ), [4, 0, 0] ) } ), 0 );
	const b = Character_EvaluateTracks( clip( { joint: empty() } ), 0 );
	const mixed = Character_BlendTracks( a, b, 0.5 );
	close( mixed.joint.q, turn( 45 ) );
	close( mixed.joint.p, [2, 0, 0] );
} );

test( 'weapon action zero-key channels reset idle instead of inheriting stale components', () => {
	const tracks = VM_Channels( {
		idle: clip( { joint: channel( turn( 90 ), [3, 2, 1] ) } ),
		fire: clip( { joint: empty() } ),
	}, weapon() );
	close( tracks.joint.q, identity() );
	close( tracks.joint.p, zero() );
	close( VM_Pose( skeleton(), tracks )[2][1], [4, 0, 10] );
} );

test( 'half-weight ADS identity channels actually blend toward identity', () => {
	const tracks = VM_Channels( {
		idle: clip( { joint: channel( turn( 90 ), [4, 2, 0] ) } ),
		adsUp: clip( { joint: empty() } ),
	}, weapon( { phase: 'idle', ads: 0.5, adsIn: true, adsBlend: 0.5 } ) );
	close( tracks.joint.q, turn( 45 ) );
	close( tracks.joint.p, [2, 1, 0] );
} );

test( 'zero-weight ADS cannot introduce previously absent bones', () => {
	for ( const c of [empty(), channel( turn( 90 ), [1, 2, 3] )] ) {
		const tracks = VM_Channels( { idle: clip( {} ), adsUp: clip( { joint: c } ) }, weapon() );
		assert.equal( tracks.joint, undefined, 'zero contribution must preserve absence' );
	}
} );

test( 'world placement applies once and shared attachments use the corrected bone', () => {
	const body = skeleton();
	const tracks = Character_EvaluateTracks( clip( { joint: empty() } ), 0 );
	const object = Character_PoseModel( body, tracks );
	const attached = {
		name: 'synthetic-attachment', surfaces: [], bones: [
			{ name: 'joint', parent: -1, pose: [identity(), zero()] },
			{ name: 'attachmentTip', parent: 0, pose: [identity(), [2, 0, 0]] },
		],
	};
	const attach = Character_PoseAttachedModel( attached, body, object, [identity(), zero()], tracks );
	close( attach[1][1], [2, 0, 10] );
	const world = Character_PoseModel( body, tracks, Character_WorldRoot( [100, 200, 300], 90 ) );
	close( world[2][1], [100, 204, 310], 'world transform exactly once' );
} );

test( 'skinned character and weapon vertices obey the corrected joint chain', () => {
	const surface = {
		material: 'synthetic', indices: [0], vertices: [
			{ normal: [1, 0, 0], uv: [0, 0], influences: [[2, 1, [1, 0, 0]]] },
		],
	};
	for ( const degrees of [-90, 45, 180] ) {
		const pose = Character_PoseModel( skeleton( degrees ), Character_EvaluateTracks( clip( { joint: empty() } ), 0 ) );
		for ( const skin of [Character_SkinSurface, VM_Skin] ) {
			const data = skin( surface, pose );
			close( Array.from( data.slice( 0, 3 ) ), [5, 0, 10] );
			close( Array.from( data.slice( 3, 6 ) ), [1, 0, 0] );
		}
	}
} );
