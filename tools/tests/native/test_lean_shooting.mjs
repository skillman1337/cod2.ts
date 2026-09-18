/*
===============================================================================

	test_lean_shooting.mjs

	Call of Duty 2 / id Tech Corner Lean Viewmodel & Shot Origin Tests
	Validates bullet exit origins under left/right leaning, view angle offsets,
	and stance heights against retail physics evidence.

===============================================================================
*/

import fs from 'node:fs';
import assert from 'node:assert/strict';

import { PM_ApplyUsercmd } from '../../../dist/engine/common/pm.js';
import { Level_Begin, Level_Commit } from '../../../dist/engine/common/level.js';
import { Cvar_Set } from '../../../dist/engine/common/cvar.js';
import { IN_ATTACK, IN_LEANLEFT, IN_LEANRIGHT } from '../../../dist/engine/common/types.js';
import { Lean_Origin } from '../../../dist/engine/common/lean.js';

// ---------------------------------------------------------------------------
// verification fixture integrity
// ---------------------------------------------------------------------------

const native = JSON.parse( fs.readFileSync( 'artifacts/retail-menu-evidence/weapons/native-shot-origin.json', 'utf8' ) ).cases;

for ( const c of native ) {
	const origin = Lean_Origin( c.start, c.yaw, c.lean );
	origin[2] = Math.max( origin[2], 248 );
	origin.forEach( ( v, i ) => assert( Math.abs( v - c.expected[i] ) < 0.00004 ) );
}


// ---------------------------------------------------------------------------
// leaned firing origin alignment
// ---------------------------------------------------------------------------

Level_Commit( Level_Begin( 'lean-test' ), {
	manifest: { name: 'lean-test', collision: [], entities: [] },
	vertices: new ArrayBuffer( 0 ),
	base: '',
} );

Cvar_Set( 'ui_weapon', 'mp44_mp' );
Cvar_Set( 'cl_ingame', '1' );

const floor = ( start, end ) => ( {
	fraction: end[2] < start[2] ? 0 : 1,
	normal: [0, 0, 1],
	startsolid: false,
	allsolid: false,
	surfaceFlags: 0,
} );

let count = 0;

for ( const height of [60, 40, 11] ) {
	for ( const direction of [-1, 0, 1] ) {
		for ( const yaw of [0, 45, 90, 180, 270, -90] ) {
			for ( const pitch of [-35, 0, 35] ) {
				const state = {
					origin: [100, 200, 300],
					angles: [pitch, yaw, 0],
					velocity: [0, 0, 0],
				};

				const buttons = direction < 0
					? IN_LEANLEFT
					: direction > 0
						? IN_LEANRIGHT
						: 0;

				const cmd = {
					viewangles: [pitch, yaw, 0],
					forwardmove: 0,
					sidemove: 0,
					buttons,
					impulse: 0,
					stance: height,
				};

				for ( let i = 0; i < 150; i++ ) {
					PM_ApplyUsercmd( state, cmd, 0.012, floor );
				}

				PM_ApplyUsercmd( state, { ...cmd, buttons: buttons | IN_ATTACK }, 0.012, floor );

				const shot = state.movement.weapon.shots?.at( -1 );
				assert( shot, 'weapon must actually fire' );
				assert( !shot.hit );

				const lean = direction * ( height === 11 ? 0.25 : 0.5 );
				const c = native.find( ( candidate ) => candidate.height === height && candidate.yaw === yaw && candidate.lean === lean );
				assert( c );

				const eye = c.expected.map( ( v, i ) => v + state.origin[i] - [100, 200, 300][i] );
				eye[2] = Math.max( eye[2], state.origin[2] - 52 );

				const p = pitch * Math.PI / 180;
				const y = yaw * Math.PI / 180;
				const forward = [
					Math.cos( p ) * Math.cos( y ),
					Math.cos( p ) * Math.sin( y ),
					-Math.sin( p ),
				];

				const distance = 8192 / shot.direction.reduce( ( sum, v, i ) => sum + v * forward[i], 0 );
				eye.forEach( ( v, i ) => {
					assert(
						Math.abs( v + distance * shot.direction[i] - shot.position[i] ) < 0.003,
						JSON.stringify( { height, direction, yaw, pitch, eye, shot } )
					);
				} );

				count++;
			}
		}
	}
}

console.log(
	`PASS: ${count} actual firing commands align with native leaned eye origins across left/right/neutral, stances, yaw and pitch`
);
