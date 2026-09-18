/*
===============================================================================

	test_bullet_spread.mjs

	Call of Duty 2 / id Tech Bullet Spread & Weapon Trajectory Unit Tests
	Validates stance/ADS spread coefficients, shot angle rotation, deterministic
	shotgun pellet generation, and multi-surface impact collision.

===============================================================================
*/

import fs from 'node:fs';
import assert from 'node:assert/strict';

import { WeaponSpread_End, WeaponSpread_ShotAngle } from '../../../dist/engine/common/weapon_spread.js';
import { PM_ApplyUsercmd } from '../../../dist/engine/common/pm.js';
import { Level_Begin, Level_Commit } from '../../../dist/engine/common/level.js';
import { Cvar_Set } from '../../../dist/engine/common/cvar.js';
import { IN_ATTACK } from '../../../dist/engine/common/types.js';


// ---------------------------------------------------------------------------
// native spread endpoint verification
// ---------------------------------------------------------------------------

const fixture = JSON.parse(
	fs.readFileSync( 'artifacts/retail-menu-evidence/weapons/native-bullet-spread.json', 'utf8' )
);
let maxError = 0;

for ( const c of fixture.cases ) {
	const result = WeaponSpread_End(
		c.origin,
		c.forward,
		c.right,
		c.up,
		c.spread,
		c.range,
		c.angle,
		c.radius
	);

	result.forEach( ( v, i ) => {
		maxError = Math.max( maxError, Math.abs( v - c.expected[i] ) );
		assert( Math.abs( v - c.expected[i] ) < 0.002, JSON.stringify( { c, result } ) );
	} );
}


// ---------------------------------------------------------------------------
// stance & ads shot angle calculations
// ---------------------------------------------------------------------------

const defs = JSON.parse( fs.readFileSync( 'assets/ui/weapons.json', 'utf8' ) );

for ( const d of Object.values( defs ).filter( ( d ) => d.weaponType === 'bullet' && d.hipSpreadStandMin ) ) {
	for ( const height of [11, 25, 40, 50, 60] ) {
		assert.equal( WeaponSpread_ShotAngle( d, 0, height, 1 ), Number( d.adsSpread ) || 0 );
		assert.equal( WeaponSpread_ShotAngle( d, 123, height, 0.99 ), WeaponSpread_ShotAngle( d, 123, height, 0 ) );
	}
}


// ---------------------------------------------------------------------------
// firing simulation & shot cone widening
// ---------------------------------------------------------------------------

Level_Commit(
	Level_Begin( 'spread-test' ),
	{
		manifest: { name: 'spread-test', collision: [], entities: [] },
		vertices: new ArrayBuffer( 0 ),
		base: '',
	}
);
Cvar_Set( 'cl_ingame', '1' );

const floor = ( s, e ) => ( {
	fraction: e[2] < s[2] ? 0 : 1,
	normal: [0, 0, 1],
	startsolid: false,
	allsolid: false,
	surfaceFlags: 0,
} );

/*
====================
fire

Simulates weapon warmup commands followed by an attack trigger cmd.
====================
*/
function fire( id, moving ) {
	Cvar_Set( 'ui_weapon', id );

	const state = {
		origin: [100, 200, 300],
		angles: [0, 0, 0],
		velocity: [0, 0, 0],
	};

	const cmd = {
		viewangles: [0, 0, 0],
		forwardmove: moving ? 127 : 0,
		sidemove: 0,
		buttons: 0,
		impulse: 0,
		stance: 60,
	};

	for ( let i = 0; i < 200; i++ ) {
		PM_ApplyUsercmd( state, cmd, 0.012, floor );
	}

	PM_ApplyUsercmd( state, { ...cmd, buttons: IN_ATTACK }, 0.012, floor );
	return state;
}

const idle = fire( 'mp44_mp', false );
const moving = fire( 'mp44_mp', true );
const replay = fire( 'mp44_mp', true );
const shotgun = fire( 'shotgun_mp', true );

const radius = ( s ) => Math.hypot( ...s.movement.weapon.shots[0].direction.slice( 1 ) );

assert( radius( idle ) > 0, 'standing hip fire retains minimum spread' );
assert( radius( moving ) > radius( idle ), 'movement widens the actual shot cone' );
assert.deepEqual( moving, replay, 'replaying identical commands must reproduce spread and impacts' );

assert.equal( shotgun.movement.weapon.shots.length, Number( defs.shotgun_mp.shotCount ) );
assert.equal(
	new Set( shotgun.movement.weapon.shots.map( ( s ) => s.direction.join( ',' ) ) ).size,
	8,
	'pellets must have independent directions'
);
assert.equal( shotgun.movement.weapon.sequence, 1, 'one trigger event and muzzle flash for all pellets' );


// ---------------------------------------------------------------------------
// impact collision following spread direction
// ---------------------------------------------------------------------------

const wall = {
	bounds: [1000, 1010, -10000, 10000, -10000, 10000],
	planes: [
		[1, 0, 0, 1010],
		[-1, 0, 0, -1000],
		[0, 1, 0, 10000],
		[0, -1, 0, 10000],
		[0, 0, 1, 10000],
		[0, 0, -1, 10000],
	],
	contents: 1,
	surfaceFlags: [0, 0, 0, 0, 0, 0],
};

Level_Commit(
	Level_Begin( 'spread-wall' ),
	{
		manifest: { name: 'spread-wall', collision: [wall], entities: [] },
		vertices: new ArrayBuffer( 0 ),
		base: '',
	}
);
Cvar_Set( 'cl_ingame', '1' );

const wallShot = fire( 'mp44_mp', true ).movement.weapon.shots[0];
assert( wallShot.hit );
assert( Math.abs( wallShot.position[0] - 999.875 ) < 0.001 );
assert(
	Math.hypot( wallShot.position[1] - 200, wallShot.position[2] - 300 ) > 1,
	'collision/impact must follow spread instead of center aim'
);
assert.deepEqual( wallShot.normal, [-1, 0, 0] );

console.log(
	`PASS: ${fixture.cases.length} native spread endpoints (max error ${maxError}); stance/ADS branches, movement cone, deterministic replay, and eight distinct shotgun pellets`
);
