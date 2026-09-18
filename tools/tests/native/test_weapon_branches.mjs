/*
===============================================================================

	test_weapon_branches.mjs

	Call of Duty 2 / id Tech Weapon Reload Branches, Spread & Motion Tests
	Validates authored weapon reload mechanics, segmented reloads,
	audio alias dispatch, stance spread scaling, and FX curves.

===============================================================================
*/

import fs from 'node:fs';
import assert from 'node:assert/strict';

import { Weapon_Update, Weapon_CanReload, Weapon_ReloadSound } from '../../../dist/engine/common/weapon.js';
import { WeaponMotion_Bob } from '../../../dist/engine/common/weapon_motion.js';
import { WeaponSpread_Angle, WeaponSpread_Update } from '../../../dist/engine/common/weapon_spread.js';
import { FX_Curve, FX_Integral, FX_Evaluate } from '../../../dist/engine/common/weapon_fx.js';
import { Cvar_Description } from '../../../dist/engine/common/cvar.js';
import { IN_ATTACK } from '../../../dist/engine/common/types.js';

// ---------------------------------------------------------------------------
// weapon reload & animation branches
// ---------------------------------------------------------------------------

const definitions = JSON.parse( fs.readFileSync( 'assets/ui/weapons.json', 'utf8' ) );
let count = 0;

for ( const [id, def] of Object.entries( definitions ) ) {
	if ( def.weaponType !== 'bullet' || !def.clipSize ) {
		continue;
	}
	count++;

	const move = { commandTime: 0, grounded: true };
	const events = [];
	const phases = new Set();

	const tick = ( buttons = 0 ) => {
		move.commandTime += 16;
		Weapon_Update( move, buttons, 16, id, true );
		for ( const e of move.soundEvents ?? [] ) {
			if ( !events.some( ( x ) => x.sequence === e.sequence ) ) {
				events.push( e );
			}
		}
		phases.add( move.weapon.phase );
	};

	for ( let i = 0; i < 200; i++ ) {
		tick();
	}

	move.weapon.clip = 0;
	move.weapon.phase = 'idle';
	move.weapon.remaining = 0;

	const reserve = move.weapon.reserve;
	events.length = 0;
	move.soundEvents = [];

	for ( let i = 0; i < 1000; i++ ) {
		tick();
	}

	const inserted = def.segmentedReload === '1'
		? Number( def.clipSize )
		: Math.min( Number( def.clipSize ), Number( def.reloadAmmoAdd ) || Infinity );

	assert.equal( move.weapon.clip, Math.min( reserve, inserted ), id + ' automatic reload inserts authored ammo' );
	assert.equal( move.weapon.reserve + move.weapon.clip, reserve, id + ' ammo conserved' );

	if ( def.reloadStartSoundPlayer ) {
		assert( events.some( ( e ) => e.aliases.includes( def.reloadStartSoundPlayer.toLowerCase() ) ), id + ' reload start audio' );
	}

	if ( def.segmentedReload === '1' && Number( def.reloadEndTime ) > 0 ) {
		assert( phases.has( 'reloadEnd' ), id + ' reload end phase' );
	}

	const expected = Weapon_ReloadSound( def, true );
	if ( def.segmentedReload !== '1' && expected ) {
		assert( events.some( ( e ) => e.aliases.includes( expected.toLowerCase() ) ), id + ' empty alias fallback' );
	}

	for ( const stance of [11, 40, 60] ) {
		const angle0 = WeaponSpread_Angle( def, 0, stance );
		const angle1 = WeaponSpread_Angle( def, 255, stance );
		assert( angle1 >= angle0, id + ' spread grows outward ' + stance );
		assert( WeaponMotion_Bob( { bobCycle: 64, bobSpeed: 0, stance }, def, 0 ).every( ( v ) => v === 0 ) );
		assert( WeaponMotion_Bob( { bobCycle: 64, bobSpeed: 190, stance }, def, 0 ).some( ( v ) => Math.abs( v ) > 0.001 ), id + ' movement changes pose' );
	}
}


// ---------------------------------------------------------------------------
// audio alias & partial reload edge cases
// ---------------------------------------------------------------------------

assert.equal( Weapon_ReloadSound( { reloadSoundPlayer: 'regular-player', reloadEmptySound: 'empty-world' }, true ), 'regular-player' );
assert.equal( Weapon_ReloadSound( { reloadEmptySoundPlayer: 'empty-player', reloadSound: 'regular-world' }, false ), 'empty-player' );
assert.equal( Weapon_CanReload( { clip: 8, reserve: 20 }, { clipSize: '10', reloadAmmoAdd: '5', noPartialReload: '1' } ), false );
assert.equal( Weapon_CanReload( { clip: 5, reserve: 20 }, { clipSize: '10', reloadAmmoAdd: '5', noPartialReload: '1' } ), true );


// ---------------------------------------------------------------------------
// visual fx curves & dvar metadata
// ---------------------------------------------------------------------------

const curve = { curve: [['0', '0'], ['.5', '2'], ['1', '0']] };
assert.equal( FX_Integral( curve, 1 ), 1 );
assert.equal( FX_Curve( curve, 0.25 ), 1 );

const axis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const fx = {
	effects: {
		test: [{
			kind: 'Particle',
			life: ['1000'],
			shaders: [['glow']],
			alpha: { curve: [['0', '1'], ['1', '0']] },
		}],
	},
	materials: {},
	impacts: {},
};

const a = FX_Evaluate( fx, 'test', 0, 1, [0, 0, 0], axis )[0];
const b = FX_Evaluate( fx, 'test', 500, 1, [0, 0, 0], axis )[0];
assert.equal( a.color[0], 1 );
assert.equal( b.color[0], 0.5 );
assert.equal( b.color[3], 1, 'additive fade modulates RGB' );

assert.deepEqual( Cvar_Description( 'cg_drawFPS' ).domain, [
	'Domain is one of the following:',
	'   0: Off',
	'   1: Simple',
	'   2: Verbose',
	'   3: Time',
] );
assert.equal( Cvar_Description( 'cg_drawFPS' ).defaultValue, 'Off' );

const dvars = JSON.parse( fs.readFileSync( 'assets/ui/dvars.json', 'utf8' ) ).dvars;
for ( const [kind, text] of [['int', 'integer'], ['float', 'number'], ['bool', '0 or 1'], ['string', 'text']] ) {
	const d = dvars.find( ( item ) => item.kind === kind );
	assert( d );
	assert( Cvar_Description( d.name ).domain[0].includes( text ), d.name );
}

console.log( `PASS: ${count} weapon definitions: reload/ammo/sound branches, stance spread and movement bob; FX integral/alpha; dvar metadata` );
