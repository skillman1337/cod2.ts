/*
===============================================================================

	movement_recording.ts

	Call of Duty 2 / id Tech Diagnostic Movement Flight Recorder
	Authoritative movement telemetry capture, user command logging,
	collision trace recording, and browser input state tracking.

===============================================================================
*/

import { Cvar_Get } from './cvar.js';
import { Level_Data, Level_Generation, Level_Phase } from './level.js';


// ---------------------------------------------------------------------------
// types & globals
// ---------------------------------------------------------------------------

const RECORDING_FRAME_LIMIT = 12000;

const MONITORED_SETTINGS = [
	'g_speed',
	'g_gravity',
	'g_gametype',
	'com_maxfps',
	'jump_height',
	'jump_stepSize',
	'jump_slowdownEnable',
	'jump_ladderPushVel',
	'player_moveThreshhold',
	'friction',
	'stopspeed',
	'inertiaMax',
	'inertiaAngle',
	'player_backSpeedScale',
	'player_strafeSpeedScale',
	'ui_weapon',
	'ui_team',
	'cl_ingame',
	'sensitivity',
	'm_pitch',
	'm_yaw',
	'm_filter',
];

interface movement_frame_t {
	sequence: number;
	elapsedMs: number;
	dt: number;
	context: number;
	before: unknown;
	command: unknown;
	after?: unknown;
	traces: unknown[];
	input: unknown[];
}

let recording: {
	started: string;
	clock: number;
	total: number;
	contexts: unknown[];
	frames: movement_frame_t[];
} | null = null;

let frame: movement_frame_t | null = null;
let contextKey: string = '';
let pendingInput: unknown[] = [];


// ---------------------------------------------------------------------------
// recording session lifecycle
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * MovementRecord_Start
 *
 * Begins diagnostic recording session bounded to 12,000 commands.
 * ================
 */
export function MovementRecord_Start(): boolean {
	if ( recording ) {
		return false;
	}

	recording = {
		started: new Date().toISOString(),
		clock: performance.now(),
		total: 0,
		contexts: [],
		frames: [],
	};

	contextKey = '';
	pendingInput = [];
	return true;
}

/**
 * @exec helper
 * ================
 * MovementRecord_Stop
 *
 * Terminates active recording session and returns recorded flight recorder payload.
 * ================
 */
export function MovementRecord_Stop(): unknown | null {
	if ( !recording ) {
		return null;
	}

	const saved = {
		format: 'cod2-movement',
		version: 1,
		started: recording.started,
		stopped: new Date().toISOString(),
		source: 'authoritative server',
		totalCommands: recording.total,
		droppedCommands: Math.max( 0, recording.total - RECORDING_FRAME_LIMIT ),
		contexts: recording.contexts,
		frames: recording.frames.sort( ( a, b ) => a.sequence - b.sequence ),
		trailingInput: pendingInput,
	};

	recording = null;
	frame = null;
	contextKey = '';
	pendingInput = [];

	return saved;
}


// ---------------------------------------------------------------------------
// frame recording & telemetry
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * MovementRecord_Input
 *
 * Buffers browser raw input events for inclusion in next recorded movement frame.
 * ================
 */
export function MovementRecord_Input( event: unknown ): void {
	if ( recording ) {
		pendingInput.push( {
			elapsedMs: performance.now() - recording.clock,
			event: structuredClone( event ),
		} );

		if ( pendingInput.length > 512 ) {
			pendingInput.shift();
		}
	}
}

/**
 * @exec helper
 * ================
 * MovementRecord_Begin
 *
 * Captures authoritative pre-movement state, user command, and level/cvar context.
 * ================
 */
export function MovementRecord_Begin(
	state: unknown,
	command: unknown,
	dt: number,
	source: string
): boolean {
	if ( !recording || source !== 'server' ) {
		return false;
	}

	const values = Object.fromEntries( MONITORED_SETTINGS.map( ( name ) => [name, Cvar_Get( name )] ) );
	const key = JSON.stringify( [Level_Generation(), Level_Phase(), values] );

	if ( key !== contextKey ) {
		const data = Level_Data();

		recording.contexts.push( {
			map: data?.manifest.name ?? null,
			generation: Level_Generation(),
			phase: Level_Phase(),
			settings: values,
			collision: data?.manifest.collision ?? null,
			mantle: data?.manifest.mantle ?? [],
			entities: data?.manifest.entities ?? [],
			playerBounds: {
				mins: [-15, -15, -60],
				maxs: [15, 15, 10],
				origin: 'eye',
				triangleCapsule: {
					radius: 15,
					axisBottom: -45,
					axisTop: -5,
				},
			},
		} );

		contextKey = key;
	}

	frame = {
		sequence: recording.total++,
		elapsedMs: performance.now() - recording.clock,
		dt,
		context: recording.contexts.length - 1,
		before: structuredClone( state ),
		command: structuredClone( command ),
		traces: [],
		input: pendingInput,
	};

	pendingInput = [];
	recording.frames[frame.sequence % RECORDING_FRAME_LIMIT] = frame;

	return true;
}

/**
 * @exec helper
 * ================
 * MovementRecord_Trace
 *
 * Logs collision trace query (start, end, and result) executed during current frame.
 * ================
 */
export function MovementRecord_Trace( start: unknown, end: unknown, result: unknown ): void {
	if ( frame ) {
		frame.traces.push( structuredClone( { start, end, result } ) );
	}
}

/**
 * @exec helper
 * ================
 * MovementRecord_End
 *
 * Records post-movement state and closes current frame record.
 * ================
 */
export function MovementRecord_End( state: unknown ): void {
	if ( frame ) {
		frame.after = structuredClone( state );
		frame = null;
	}
}
