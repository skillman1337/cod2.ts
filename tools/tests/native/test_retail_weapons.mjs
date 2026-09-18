/*
===============================================================================

	test_retail_weapons.mjs

	Call of Duty 2 / id Tech Retail Weapon Motion, Lighting & FX Tests
	Validates gun spring physics, camera recoil velocity integration,
	weapon view bobbing, movement position/rotation offsets, lightgrid sampling,
	and weapon firing/reloading/impact decal evaluation against retail evidence.

===============================================================================
*/

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
	WeaponMotion_Gun,
	WeaponMotion_View,
	WeaponMotion_Bob,
	WeaponMotion_MoveRotation,
	WeaponMotion_MovePosition,
	WeaponMotion_Create,
	WeaponMotion_Fire,
	WeaponMotion_Update,
	WeaponMotion_Idle,
} from '../../../dist/engine/common/weapon_motion.js';
import { LightGrid_Sample } from '../../../dist/engine/common/lightgrid.js';
import { Weapon_Definition, Weapon_Update, Weapon_Fov } from '../../../dist/engine/common/weapon.js';
import { FX_Evaluate, FX_Impact } from '../../../dist/engine/common/weapon_fx.js';
import { IN_ATTACK, IN_ADS, IN_RELOAD } from '../../../dist/engine/common/types.js';

// ---------------------------------------------------------------------------
// verification fixture integrity
// ---------------------------------------------------------------------------

const fixture = JSON.parse( fs.readFileSync( 'artifacts/retail-menu-evidence/weapons/native-motion-lighting.json', 'utf8' ) );

for ( const [name, hash] of Object.entries( fixture.candidate_sha256 ) ) {
	assert.equal( createHash( 'sha256' ).update( fs.readFileSync( name ) ).digest( 'hex' ), hash, name + ' candidate changed' );
}

/*
====================
close

Asserts approximate floating-point equality across arrays.
====================
*/
const close = ( a, b, label, tolerance = 3e-5 ) => {
	assert.equal( a.length, b.length );
	a.forEach( ( v, i ) => {
		assert( Math.abs( v - b[i] ) < tolerance, `${label}: ${i} ${v} != ${b[i]}` );
	} );
};


// ---------------------------------------------------------------------------
// weapon spring & view recoil tests
// ---------------------------------------------------------------------------

for ( const c of fixture.gun ) {
	close( WeaponMotion_Gun( ...c.input ), c.output, 'native gun spring' );
}

for ( const c of fixture.view ) {
	const p = [...c.position];
	const v = [...c.speed];

	for ( let left = c.msec; left > 0; left -= 5 ) {
		for ( let i = 0; i < 3; i++ ) {
			[p[i], v[i]] = WeaponMotion_View( p[i], v[i], Math.min( 5, left ) * 0.001, c.center );
		}
	}

	close( p, c.outputPosition, 'native camera recoil' );
	close( v, c.outputSpeed, 'native camera velocity', 0.0002 );
}

for ( const c of fixture.bob ) {
	close( WeaponMotion_Bob( { bobCycle: c.cycle, bobSpeed: c.speed, stance: c.stance }, Weapon_Definition( c.id ), c.ads ), c.output, 'native weapon bob ' + c.id );
}

for ( const c of fixture.movement ) {
	close( WeaponMotion_MoveRotation( c.previous, Weapon_Definition( c.id ), c.speed, 190, c.stance, c.ads, c.reload, c.dt ), c.output, 'native movement pose ' + c.id );
}

for ( const c of fixture.positionMotion ) {
	close( WeaponMotion_MovePosition( c.previous, Weapon_Definition( c.id ), c.speed, 190, c.stance, c.reload, c.dt ), c.output, 'native movement offset ' + c.id );
}


// ---------------------------------------------------------------------------
// lightgrid sampling tests
// ---------------------------------------------------------------------------

const grid = JSON.parse( fs.readFileSync( 'public/maps/mp_toujane/lightgrid.json', 'utf8' ) );

for ( const c of fixture.lighting ) {
	close( LightGrid_Sample( grid, c.position, () => !c.blocked ).flat(), c.output.flat(), 'native lighting ' + JSON.stringify( c.position ) + ' blocked ' + c.blocked, 1 / 255 );
}


// ---------------------------------------------------------------------------
// weapon state transitions & bullet timing
// ---------------------------------------------------------------------------

const def = Weapon_Definition( 'sten_mp' );
const motion = WeaponMotion_Create();

WeaponMotion_Update( motion, def, 0, 1000, 60 );
assert( WeaponMotion_Idle( motion, def, 0 ).some( ( v ) => v !== 0 ) );

WeaponMotion_Fire( motion, def, 0 );
WeaponMotion_Update( motion, def, 0, 16, 60 );
assert( motion.view.some( ( v ) => v !== 0 ) );

const move = {
	commandTime: 0,
	remainder: 0,
	oldButtons: 0,
	jumpTime: -500,
	jumpOrigin: 0,
	jumping: false,
	pmTime: 0,
	grounded: true,
};

const tick = ( buttons, msec = 16 ) => {
	move.commandTime += msec;
	Weapon_Update( move, buttons, msec, 'sten_mp', true );
};

for ( let i = 0; i < 100; i++ ) {
	tick( 0 );
}

const before = move.weapon.clip;

for ( let i = 0; i < 40; i++ ) {
	tick( IN_ADS );
}
assert.equal( move.weapon.ads, 1 );
assert.equal( Weapon_Fov( 80, move.weapon ), Number( def.adsZoomFov ) );

for ( let i = 0; i < 30; i++ ) {
	tick( IN_ATTACK );
}
assert( move.weapon.clip < before );

for ( let i = 0; i < 10; i++ ) {
	tick( 0 );
}
tick( IN_RELOAD );

for ( let i = 0; i < 250; i++ ) {
	tick( 0 );
}
assert.equal( move.weapon.clip, before );


// ---------------------------------------------------------------------------
// weapon impacts & visual fx dispatch
// ---------------------------------------------------------------------------

const catalog = JSON.parse( fs.readFileSync( 'public/weaponfx/catalog.json', 'utf8' ) );
const shot = {
	sequence: 1,
	time: 0,
	position: [0, 0, 0],
	normal: [1, 0, 0],
	direction: [-1, 0, 0],
	surfaceFlags: 16 << 20,
	hit: true,
};

const impacts = FX_Impact( catalog, 'bullet_small', shot );
assert( impacts.length );

const all = impacts.flatMap( ( f ) => FX_Evaluate( catalog, f.name, 100, 1, shot.position, f.axis ) );
assert( all.some( ( s ) => s.decal ), 'plaster decal' );
assert( all.some( ( s ) => s.shader.includes( 'whisp' ) ), 'authored impact dust' );
assert.equal( FX_Impact( catalog, 'bullet_small', { ...shot, hit: false } ).length, 0 );
assert(
	FX_Evaluate( catalog, def.viewFlashEffect, 50, 1, [0, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], true )
		.some( ( s ) => s.relative && s.shader.includes( 'fireball' ) ),
	'authored muzzle atlas'
);

console.log(
	`PASS: ${['gun', 'view', 'bob', 'movement', 'positionMotion'].reduce( ( n, k ) => n + fixture[k].length, 0 )} native motion cases, ${fixture.lighting.length} native lighting samples; bullet timing/ammo/ADS/reload, idle/recoil, surface dispatch, dust, decals and muzzle atlas`
);
