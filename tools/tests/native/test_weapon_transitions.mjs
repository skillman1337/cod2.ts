/*
===============================================================================

	test_weapon_transitions.mjs

	Call of Duty 2 / id Tech Weapon Ladder Transitions & FX Sequence Tests
	Validates weapon holstering/raising on ladder entry and exit,
	tracer tail endpoints, muzzle flash atlas sequence frames, and viewmodel depth.

===============================================================================
*/

import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

import { Weapon_Update, Weapon_Animation, Weapon_Time } from '../../../dist/engine/common/weapon.js';
import { FX_TailEnd, FX_Evaluate, FX_SequenceFrame } from '../../../dist/engine/common/weapon_fx.js';

// ---------------------------------------------------------------------------
// ladder holster & weapon drop/raise transitions
// ---------------------------------------------------------------------------

const defs = JSON.parse( fs.readFileSync( 'assets/ui/weapons.json', 'utf8' ) );
let count = 0;

for ( const [id, d] of Object.entries( defs ) ) {
	if ( d.weaponType !== 'bullet' || !Number( d.clipSize ) ) {
		continue;
	}

	for ( const earlyExit of [false, true] ) {
		const move = {
			commandTime: 1000,
			remainder: 0,
			oldButtons: 0,
			jumpTime: 0,
			jumpOrigin: 0,
			jumping: false,
			pmTime: 0,
			grounded: true,
		};

		const tick = ( ms = 12 ) => {
			move.commandTime += ms;
			Weapon_Update( move, 0, ms, id, true );
		};

		for ( let i = 0; i < 150; i++ ) {
			tick();
		}

		const ammo = [move.weapon.clip, move.weapon.reserve];
		move.ladder = { normal: [1, 0, 0], surfaceFlags: 8 };
		tick();

		assert.equal( move.weapon.holster, 'drop', id );
		assert.equal( Weapon_Animation( move.weapon ), d.dropAnim || d.idleAnim );
		assert.equal( move.weapon.holsterRemaining, Weapon_Time( d, 'dropTime' ) );

		if ( earlyExit ) {
			delete move.ladder;
		}

		for ( let i = 0; i < 100; i++ ) {
			tick();
		}

		if ( !earlyExit ) {
			assert.equal( move.weapon.holster, 'hidden' );
			delete move.ladder;
			tick();
			assert.equal( move.weapon.holster, 'raise' );
			assert.equal( Weapon_Animation( move.weapon ), d.raiseAnim || d.idleAnim );
		}

		for ( let i = 0; i < 100; i++ ) {
			tick();
		}

		assert.equal( move.weapon.holster, undefined );
		assert.deepEqual( [move.weapon.clip, move.weapon.reserve], ammo );
		count++;
	}
}


// ---------------------------------------------------------------------------
// native tracer tail end evaluation
// ---------------------------------------------------------------------------

const fixture = JSON.parse( fs.readFileSync( 'artifacts/retail-menu-evidence/weapons/native-tail.json', 'utf8' ) );
assert.equal(
	crypto.createHash( 'sha256' ).update( fs.readFileSync( 'engine/common/weapon_fx.ts' ) ).digest( 'hex' ),
	fixture.candidate_sha256
);

for ( const c of fixture.cases ) {
	const result = FX_TailEnd( c.point, c.previous, c.length );
	if ( c.point.every( ( v, i ) => v === c.previous[i] ) ) {
		assert.equal( result, undefined );
	} else {
		result.forEach( ( v, i ) => {
			assert( Math.abs( v - c.output[i] ) < 0.001, JSON.stringify( { c, result } ) );
		} );
	}
}

const catalog = JSON.parse( fs.readFileSync( 'public/weaponfx/catalog.json', 'utf8' ) );
const tails = FX_Evaluate( catalog, defs.mp44_mp.viewFlashEffect, 30, 1, [20, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], true ).filter( ( s ) => s.tail );

assert( tails.length );
assert( tails.every( ( s ) => s.tailEnd && s.tailEnd[0] > s.position[0] ), 'negative-velocity muzzle streaks extend away from the camera' );
console.log( `PASS: ${count} ladder weapon transitions; ${fixture.cases.length} native tail endpoints; authored muzzle tail direction` );


// ---------------------------------------------------------------------------
// native fx atlas sequence frames
// ---------------------------------------------------------------------------

const sequence = JSON.parse( fs.readFileSync( 'artifacts/retail-menu-evidence/weapons/native-fx-sequence.json', 'utf8' ) );
assert.equal(
	crypto.createHash( 'sha256' ).update( fs.readFileSync( 'engine/common/weapon_fx.ts' ) ).digest( 'hex' ),
	sequence.candidate_sha256
);

for ( const c of sequence.cases ) {
	assert.equal( FX_SequenceFrame( c.part, c.frames, c.elapsed, c.life, c.index, c.random ), c.frame, JSON.stringify( c ) );
}

const small = FX_Evaluate( catalog, defs.mp44_mp.viewFlashEffect, 30, 1, [20, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], true ).filter( ( s ) => s.shader === 'gfx_exp_fireball_atlas' );
assert( small.length );
assert( small.some( ( s ) => s.frame === 13 ), 'authored frame 14 selects atlas cell 13' );
assert( small.every( ( s ) => s.size2 === s.size ), 'nonUniformScale off preserves the width for height' );
console.log( `PASS: ${sequence.cases.length} original atlas initialization/playback branches; muzzle atlas cell and uniform dimensions` );


// ---------------------------------------------------------------------------
// viewmodel near plane & depth projection
// ---------------------------------------------------------------------------

const depth = JSON.parse( fs.readFileSync( 'artifacts/retail-menu-evidence/renderer/native-viewmodel-depth.json', 'utf8' ) );
const shader = fs.readFileSync( 'engine/com/client/screen/scr_draw/rgpu/internal/rgpu_viewmodel.ts', 'utf8' );
assert.equal( crypto.createHash( 'sha256' ).update( shader ).digest( 'hex' ), depth.candidate_sha256 );

const projection = shader.match( /\(p\.x-([.\d]+)\)\*([.\d]+)/ );
assert( projection );

const weaponDepth = depth.cases.find( ( c ) => c.flags === 8 );
assert.equal( Math.fround( Number( projection[1] ) ), -weaponDepth.near );
assert.equal( Math.fround( Number( projection[2] ) ), weaponDepth.viewport[0][1] );
console.log( 'PASS: weapon shader near plane and depth range match the original renderer dispatch' );
