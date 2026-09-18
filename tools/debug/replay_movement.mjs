/*
===============================================================================

	replay_movement.mjs

	Call of Duty 2 / id Tech Player Movement Trace Replayer
	Replays recorded client movement command streams against native PM physics
	to verify exact behavioral determinism and detect collision divergence.

===============================================================================
*/

import fs from 'node:fs';
import assert from 'node:assert/strict';

import { Level_Begin, Level_Commit } from '../../dist/engine/common/level.js';
import { Cvar_Set } from '../../dist/engine/common/cvar.js';
import { PM_ApplyUsercmd } from '../../dist/engine/common/pm.js';

// ---------------------------------------------------------------------------
// arguments & validation
// ---------------------------------------------------------------------------

const tracePath = process.argv[2];

if ( !tracePath ) {
	throw new Error( 'Usage: node tools/debug/replay_movement.mjs <cod2-movement-*.json>' );
}

const data = JSON.parse( fs.readFileSync( tracePath, 'utf8' ) );

assert.equal( data.format, 'cod2-movement' );
assert.equal( data.version, 1 );


// ---------------------------------------------------------------------------
// trace playback & validation
// ---------------------------------------------------------------------------

let activeContext = -1;
const stopped = [];

for ( const frame of data.frames ) {
	if ( activeContext !== frame.context ) {
		activeContext = frame.context;
		const c = data.contexts[activeContext];

		if ( c.map ) {
			Level_Commit( Level_Begin( c.map ), {
				manifest: {
					name: c.map,
					collision: c.collision,
					mantle: c.mantle,
					entities: c.entities,
				},
				vertices: new ArrayBuffer( 0 ),
				base: '',
			} );
		} else {
			Level_Begin( '' );
		}

		for ( const [name, value] of Object.entries( c.settings ) ) {
			Cvar_Set( name, value );
		}
	}

	const state = structuredClone( frame.before );
	PM_ApplyUsercmd( state, frame.command, frame.dt );

	// JSON normalization ignores optional fields omitted by the downloaded format
	assert.deepEqual(
		JSON.parse( JSON.stringify( state ) ),
		frame.after,
		`movement diverged at command ${frame.sequence}`
	);

	const distance = Math.hypot(
		state.origin[0] - frame.before.origin[0],
		state.origin[1] - frame.before.origin[1]
	);

	if ( ( frame.command.forwardmove || frame.command.sidemove ) && distance < 0.01 ) {
		const startSolidBrushes = frame.traces.flatMap( ( t ) => t.result.startSolidBrushes ?? [] );
		const hitBrushes = frame.traces
			.map( ( t ) => t.result.hitBrush )
			.filter( ( brush ) => brush !== undefined );

		stopped.push( {
			sequence: frame.sequence,
			origin: frame.before.origin,
			command: frame.command,
			allsolid: frame.traces.some( ( t ) => t.result.allsolid ),
			brushes: [...new Set( [...startSolidBrushes, ...hitBrushes] )],
		} );
	}
}

console.log( JSON.stringify( {
	replayed: data.frames.length,
	droppedCommands: data.droppedCommands,
	stationaryWithInput: stopped,
}, null, 2 ) );
