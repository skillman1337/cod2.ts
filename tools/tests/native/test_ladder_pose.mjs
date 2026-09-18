/*
===============================================================================

	test_ladder_pose.mjs

	Call of Duty 2 / id Tech Ladder Viewmodel Posing & Holstering Unit Tests
	Validates ADS interrupt, ladder mount drop animation timing, and skeletal
	channel rotation when mounting or dismounting ladder surfaces.

===============================================================================
*/

import fs from 'node:fs';
import assert from 'node:assert/strict';

import { VM_Channels, VM_WeaponPose } from '../../../dist/engine/common/viewmodel.js';
import { Weapon_Update, Weapon_Time } from '../../../dist/engine/common/weapon.js';


// ---------------------------------------------------------------------------
// test setup & catalog loading
// ---------------------------------------------------------------------------

const read = ( p ) => JSON.parse( fs.readFileSync( p, 'utf8' ) );
const defs = read( 'assets/ui/weapons.json' );
const catalog = read( 'public/viewmodels/catalog.json' );
let count = 0;


// ---------------------------------------------------------------------------
// ladder holster & root layer track verification
// ---------------------------------------------------------------------------

for ( const [id, entry] of Object.entries( catalog.weapons ) ) {
	const d = defs[id];
	const models = [entry.hands, entry.gun].map( ( n ) =>
		read( 'public/viewmodels/models/' + n + '.json' )
	);
	const animations = Object.fromEntries(
		Object.entries( d )
			.filter( ( [k, v] ) => k.endsWith( 'Anim' ) && v )
			.map( ( [, n] ) => [n, read( 'public/viewmodels/animations/' + n + '.json' )] )
	);

	if ( !d.adsDownAnim ) {
		continue;
	}

	for ( const ads of [0, 0.5, 1] ) {
		const move = { commandTime: 0, grounded: true };

		for ( let i = 0; i < 200; i++ ) {
			move.commandTime += 12;
			Weapon_Update( move, 0, 12, id, true );
		}

		move.weapon.ads = ads;
		move.ladder = { normal: [1, 0, 0], surfaceFlags: 8 };
		Weapon_Update( move, 0, 12, id, true );

		assert.equal( move.weapon.holster, 'drop' );

		const dropLimit = Weapon_Time( d, 'dropTime' ) - 1;

		for ( const elapsed of [0, 60, 120, dropLimit] ) {
			const w = { ...move.weapon, holsterElapsed: elapsed };
			const channels = VM_Channels( animations, w );

			// These root tracks must remain active on both sides of a weapon transition.
			const baseline = VM_Channels( animations, { ...w, holster: undefined, phase: 'idle' } );

			for ( const bone of Object.keys( animations[d.adsDownAnim].channels ) ) {
				assert.deepEqual(
					channels[bone],
					baseline[bone],
					id + ' must retain ADS/hip root layer during lowering'
				);
			}

			const pose = VM_WeaponPose( models, animations, w );
			assert(
				pose.flat( 3 ).every( Number.isFinite ),
				id + ' animated skeleton must remain finite'
			);
		}

		count++;
	}
}

console.log(
	`PASS: ${count} real-asset ladder poses retain root positioning across hip, partial ADS and ADS`
);
