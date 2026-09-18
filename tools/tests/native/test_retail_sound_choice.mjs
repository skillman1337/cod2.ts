/*
===============================================================================

	test_retail_sound_choice.mjs

	Call of Duty 2 / id Tech Sound Alias Selection & Footstep Audio Tests
	Validates pseudorandom probability weighting, seed evolution,
	landing impact classification, surface flag routing, and map loadspecs.

===============================================================================
*/

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { Sound_Select, Sound_Loadspec } from '../../../dist/engine/common/sound_alias.js';
import { Movement_Aliases } from '../../../dist/engine/common/movement_events.js';
import { Landing_SoundKind } from '../../../dist/engine/common/landing.js';

// ---------------------------------------------------------------------------
// verification fixture integrity
// ---------------------------------------------------------------------------

const fixture = JSON.parse( fs.readFileSync( 'artifacts/retail-menu-evidence/physics/native-sound-choice.json', 'utf8' ) );
assert.equal(
	createHash( 'sha256' ).update( fs.readFileSync( 'engine/common/sound_alias.ts' ) ).digest( 'hex' ),
	fixture.candidate_sha256
);


// ---------------------------------------------------------------------------
// weighted alias selection & PRNG seed advancement
// ---------------------------------------------------------------------------

for ( const c of fixture.cases ) {
	const variants = c.weights.map( ( probability ) => ( { probability } ) );
	const random = { seed: c.seed };

	assert.deepEqual(
		c.sequence.map( () => variants.indexOf( Sound_Select( variants, random ) ) ),
		c.sequence,
		JSON.stringify( c.weights )
	);
	assert.equal( random.seed, c.finalSeed );
}

for ( const c of fixture.landing ) {
	assert.equal( Landing_SoundKind( c.height ), c.kind, `native impact ${c.height}` );
}


// ---------------------------------------------------------------------------
// movement audio catalog & surface dispatch
// ---------------------------------------------------------------------------

const catalog = JSON.parse( fs.readFileSync( 'public/sound/movement.json', 'utf8' ) );
assert.equal( catalog.aliases.land_plr_rock[0].url, '/sound/footsteps/land_stone.wav' );
assert.deepEqual( Movement_Aliases( 'land', 17 << 20 ), ['land_plr_rock'] );
assert.deepEqual( Movement_Aliases( 'land', 0x2000 ), ['land_plr_default'] );

assert( Sound_Loadspec( '!toujane !bergstein', 'mp_toujane' ) );
assert( !Sound_Loadspec( 'toujane bergstein', 'mp_toujane' ) );
assert( Sound_Loadspec( 'all_mp', 'mp_toujane' ) );

const choices = catalog.aliases.gear_rattle_plr_run;
const random = { seed: 1 };
let breathing = 0;

for ( let i = 0; i < 10000; i++ ) {
	if ( Sound_Select( choices, random ).url.includes( 'breathing' ) ) {
		breathing++;
	}
}
assert( breathing < 1500 && breathing > 200, `weighted breathing ${breathing}/10000` );

for ( const variants of Object.values( catalog.aliases ) ) {
	for ( const v of variants ) {
		assert( fs.existsSync( 'public' + v.url ), v.url );
	}
}

console.log( `PASS: 2000 original-machine sound selections, real landing sample, map filtering; breathing ${breathing}/10000` );
