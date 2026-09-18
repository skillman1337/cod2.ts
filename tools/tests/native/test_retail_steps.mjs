/*
===============================================================================

	test_retail_steps.mjs

	Call of Duty 2 / id Tech Stair Stepping & Camera Smoothing Tests
	Validates step height smoothing, step event generation, slope ascent,
	false ledge rejection, and staircase collision traversal.

===============================================================================
*/

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import * as pm from '../../../dist/engine/common/pm.js';
import * as view from '../../../dist/engine/common/step_view.js';
import { Level_Begin, Level_Commit } from '../../../dist/engine/common/level.js';
import { Cvar_Set } from '../../../dist/engine/common/cvar.js';

// ---------------------------------------------------------------------------
// verification fixture integrity
// ---------------------------------------------------------------------------

const fixture = JSON.parse( fs.readFileSync( 'artifacts/retail-menu-evidence/physics/native-step-cases.json', 'utf8' ) );
for ( const [name, hash] of Object.entries( fixture.candidate_hashes ) ) {
	assert.equal( createHash( 'sha256' ).update( fs.readFileSync( name ) ).digest( 'hex' ), hash );
}

const close = ( a, b ) => assert( Math.abs( a - b ) < 0.0001, `${a} != ${b}` );

/*
====================
check

Iterates across native step cases to test step view height smoothing and events.
====================
*/
function check( api ) {
	for ( const c of fixture.cases ) {
		const v = { amount: c.amount ?? c.previous, time: 1000, sequence: 0 };

		if ( c.kind === 'height' ) {
			close( api.StepView_Height( v, 116.125, 1000 + c.elapsed ), c.expected );
			assert.equal( v.time, c.time );
		}
		if ( c.kind === 'event' ) {
			api.StepView_Event( v, c.delta, 1000 + c.elapsed );
			close( v.amount, c.expected );
			assert.equal( v.time, 1000 + c.elapsed );
		}
		if ( c.kind === 'progress' ) {
			assert.equal( api.PM_StepImproves( [0, 0, 0], c.normal, c.candidate, c.velocity ), c.expected );
		}
		if ( c.kind === 'quantize' || c.kind === 'scale' ) {
			const s = {
				origin: [0, 0, 100 + ( c.delta ?? c.rise )],
				velocity: [190, 45, 10],
				movement: {},
			};
			api.PM_StepEvent( s, 100, 100, 18 );

			if ( c.kind === 'quantize' ) {
				assert.equal( s.movement.stepEvents?.[0]?.delta ?? 0, c.amount );
			} else {
				s.velocity.forEach( ( x, i ) => close( x, c.expected[i] ) );
			}
		}
	}
}

check( { ...pm, ...view } );

for ( const mutation of [
	{ StepView_Height: ( v, z ) => z },
	{ StepView_Event: ( v, d, t ) => { v.amount = d; v.time = t; } },
	{ PM_StepImproves: () => true },
] ) {
	assert.throws( () => check( { ...pm, ...view, ...mutation } ) );
}


// ---------------------------------------------------------------------------
// edge step regressions & stair traversal
// ---------------------------------------------------------------------------

const manifest = JSON.parse( fs.readFileSync( 'public/maps/mp_toujane/manifest.json', 'utf8' ) );
Level_Commit( Level_Begin( manifest.name ), { manifest, vertices: new ArrayBuffer( 0 ), base: '' } );

const edge = JSON.parse( fs.readFileSync( 'artifacts/retail-menu-evidence/physics/edge-step-regressions.json', 'utf8' ) );
for ( const [name, value] of Object.entries( edge.settings ) ) {
	Cvar_Set( name, value );
}

for ( const f of edge.frames ) {
	const state = structuredClone( f.before );
	pm.PM_ApplyUsercmd( state, f.command, f.dt );
	assert( Math.abs( state.origin[2] - f.before.origin[2] ) < 1, 'capsule must not climb the artificial box ledge' );
	assert.equal( state.movement.stepSequence ?? 0, f.before.movement.stepSequence ?? 0, 'false ledge must not emit a step event' );
}

const box = ( b ) => ( {
	bounds: b,
	contents: 1,
	planes: [
		[-1, 0, 0, -b[0]],
		[1, 0, 0, b[1]],
		[0, -1, 0, -b[2]],
		[0, 1, 0, b[3]],
		[0, 0, -1, -b[4]],
		[0, 0, 1, b[5]],
	],
} );

Level_Commit( Level_Begin( 'stairs' ), {
	manifest: {
		...manifest,
		name: 'stairs',
		collision: [
			box( [-1000, 1000, -1000, 1000, -100, 0] ),
			box( [40, 80, -1000, 1000, 0, 8] ),
		],
	},
	vertices: new ArrayBuffer( 0 ),
	base: '',
} );

const stairs = pm.PM_StateFromPlayer( [0, 0, 60.125], [0, 0, 0], [0, 0, 0] );
let peak = 60.125;

for ( let i = 0; i < 150; i++ ) {
	pm.PM_ApplyUsercmd( stairs, {
		viewangles: [0, 0, 0],
		forwardmove: 127,
		sidemove: 0,
		buttons: 0,
		impulse: 0,
	}, 0.008 );
	peak = Math.max( peak, stairs.origin[2] );
}

assert( peak > 68 && stairs.origin[0] > 100 && stairs.movement.grounded, 'ordinary stairs remain traversable' );
assert( stairs.movement.stepEvents.some( ( e ) => e.delta > 0 ) && stairs.movement.stepEvents.some( ( e ) => e.delta < 0 ), 'up/down steps produce signed smoothing events' );

console.log( `PASS: ${fixture.cases.length} native step/camera cases, 3 rejected mutations, ${edge.frames.length} false ledges rejected, ordinary up/down stairs` );
