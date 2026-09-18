/*
===============================================================================

	cl_main.ts

	Client frame: apply snapshot from com, predict, draw via screen subtree.
	Parent is com.ts.  Client globals live in cl_state.ts.

===============================================================================
*/

import { SCR_UpdateScreen, SCR_InitGpu, SCR_ShutdownGpu, SCR_NoteVidResize, SCR_HasSwapchain, scr_frame_t } from './screen/scr_draw.js';
import { SCR_MenuFrame, SCR_MenuGpuOverlay, SCR_MenuInit, SCR_MenuIsActive, SCR_MenuSetActive, SCR_MenuShutdown, SCR_MenuVolume } from './cl_main/scr_menu.js';
import {
	ca_active_t,
	cl,
	cls,
	CL_FrameSnapshotBegin,
	CL_FrameSnapshotMark,
	CL_FrameSnapshotReceived,
	CL_ResetClientData,
	CL_ResetPredictVelocity,
	CL_SetPredictVelocity,
	CL_SetRefdefAxis,
	CL_SetHostMode,
	CL_SetPointerLockHint,
	CL_SetWasJump,
	CL_GetPredictVelocity,
	CL_WasJump,
	cl_listen_server,
	cl_pointer_lock_hint,
} from './cl_main/cl_state.js';
import { client_snapshot_t, usercmd_t, IN_JUMP, entity_render_t, vec3_t } from '@/engine/common/types.js';
import { PM_ApplyUsercmd, PM_StateFromPlayer, pm_state_t } from '@/engine/common/pm.js';
import { CL_CreateCmd, CL_InitInput, CL_SetViewAngles, CL_ShutdownInput, CL_SetUiMode, CL_GetMouseClientPos } from './input/input.js';
import { CL_QueueUsercmdBackup, UC_ClearUsercmd, CL_GetLatestUsercmd } from './usercmd/usercmd.js';
import {
	S_Init,
	S_Shutdown,
	S_Update,
	S_StartSound,
	S_Activate,
	S_UpdateMenuMusic,
	S_UpdateAmbient,
} from './sound/sound.js';
import { VID_Init, VID_SetCanvas, VID_IsValid, vid } from '@/engine/common/vid.js';
import {
	Level_Phase,
	Level_Name,
	Level_WorldVisible,
	Level_Data,
	Level_Generation,
} from '@/engine/common/level.js';
import { Cvar_Get } from '@/engine/common/cvar.js';
import { Command_Register } from '@/engine/common/commands.js';
import { Con_Printf } from '@/engine/common/common.js';
import { MovementRecord_Start, MovementRecord_Stop } from '@/engine/common/movement_recording.js';
import { StepView_Event, StepView_Height } from '@/engine/common/step_view.js';
import { Landing_ViewHeight } from '@/engine/common/landing.js';
import { Lean_Origin } from '@/engine/common/lean.js';
import { CG_CalculateFPS } from '@/engine/common/cg_draw.js';
import { CG_IsThirdPerson } from '@/engine/common/cg_view.js';

let cl_level_spawn_key = '';
let cl_predicted_movement: pm_state_t['movement'];
const cl_step_view = { amount: 0, time: 0, sequence: 0 };
const cl_landing_view = { amount: 0, time: 0, sequence: 0 };
let cl_movement_sound_sequence = 0;

/**
 * @exec helper
 * ================
 * CL_AcceptStepEvents
 *
 * Consume each replicated/predicted step event once.
 * ================
 */
function CL_AcceptStepEvents( movement: pm_state_t['movement'] ): void {
	for ( const event of movement?.soundEvents ?? [] ) {
		if ( event.sequence > cl_movement_sound_sequence ) {
			for ( const alias of event.aliases ) {
				S_StartSound( alias );
			}
			cl_movement_sound_sequence = event.sequence;
		}
	}

	for ( const event of movement?.landEvents ?? [] ) {
		if ( event.sequence > cl_landing_view.sequence ) {
			cl_landing_view.amount = event.amount;
			cl_landing_view.time = Math.trunc( cl.time * 1000 );
			cl_landing_view.sequence = event.sequence;
		}
	}

	for ( const event of movement?.stepEvents ?? [] ) {
		if ( event.sequence > cl_step_view.sequence ) {
			StepView_Event( cl_step_view, event.delta, Math.trunc( cl.time * 1000 ) );
			cl_step_view.sequence = event.sequence;
		}
	}
}

/** Console diagnostic command; browser owns the downloadable artifact. @exec helper */
function CL_RecordMovement( args: string[] ): void {
	if ( args.length === 1 && args[0].toLowerCase() === 'movement' ) {
		Con_Printf(
			MovementRecord_Start()
				? 'Movement recording started (latest 12,000 commands). Close the console and reproduce the problem, then type record stop.'
				: 'Movement recording is already active. Type record stop to save it.'
		);
		return;
	}

	if ( args.length === 1 && args[0].toLowerCase() === 'stop' ) {
		const data = MovementRecord_Stop();

		if ( !data ) {
			Con_Printf( 'No movement recording is active. Type record movement first.' );
			return;
		}

		const filename = 'cod2-movement-' + new Date().toISOString().replace( /[:.]/g, '-' ) + '.json';
		const text = JSON.stringify( data );

		Con_Printf( 'Saving movement recording...' );

		void fetch( '/__debug/movement', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: text,
			signal: AbortSignal.timeout( 15000 ),
		} )
			.then( async ( response ) => {
				if ( !response.ok ) {
					throw new Error( 'Local trace receiver unavailable (' + response.status + ')' );
				}

				const saved = await response.json();

				if ( typeof saved.path !== 'string' ) {
					throw new Error( 'Invalid save response' );
				}

				Con_Printf( 'Movement recording saved: ' + saved.path );
			} )
			.catch( () => {
				const url = URL.createObjectURL( new Blob( [text], { type: 'application/json' } ) );
				const link = document.createElement( 'a' );

				link.href = url;
				link.download = filename;
				document.body.appendChild( link );
				link.click();
				link.remove();

				setTimeout( () => URL.revokeObjectURL( url ), 60000 );
				Con_Printf( 'Local folder save unavailable; movement recording downloaded: ' + filename );
			} );

		return;
	}

	Con_Printf( 'Usage: record movement | record stop' );
}


// ---------------------------------------------------------------------------
// forward
// CL_CopyEntityRender, CL_CopyEntityList, CL_ApplySnapshotRefdef
// CL_ApplySnapshotPing, CL_ApplySnapshot, CL_SetViewAnglesFromSnapshot
// CL_PredictMovement, CL_RefdefListener, CL_UpdateSound, CL_AdvanceClientTime
// CL_RunActiveFrame, CL_SampleUsercmd, CL_Init, CL_Shutdown, CL_Frame
// CL_HandleVidResize, CL_BuildScrFrame
// ---------------------------------------------------------------------------


/**
 * @exec init-once
 * ================
 * CL_Init
 *
 * Bind canvas to vid and mark client active for local listen server.
 * ================
 */
export function CL_Init( canvas: HTMLCanvasElement, listen_server: boolean ): void {
	Command_Register('record',CL_RecordMovement,()=>['movement','stop']);
	CL_SetHostMode( listen_server );
	VID_Init();
	VID_SetCanvas( canvas );
	CL_InitInput( canvas, () => S_Activate(), CL_SetPointerLockHint );
	S_Init();
	SCR_MenuInit( S_StartSound );
	SCR_MenuSetActive( true );
	SCR_InitGpu();
	cls.state = ca_active_t.ca_active;
	CL_ResetClientData();
	cl_step_view.amount = 0;
	cl_step_view.time = 0;
	cl_step_view.sequence = 0;
	cl_predicted_movement = undefined;

	cl_landing_view.amount = 0;
	cl_landing_view.time = 0;
	cl_landing_view.sequence = 0;
	cl_movement_sound_sequence = 0;
}


/**
 * @exec init-once
 * ================
 * CL_Shutdown
 *
 * Undo CL_Init.  Com_RollbackInit calls this on failed Com_Init.
 * ================
 */
export function CL_Shutdown(): void {
	SCR_MenuShutdown();
	CL_ShutdownInput();
	S_Shutdown();
	SCR_ShutdownGpu();
	VID_Init();
	UC_ClearUsercmd();
	cls.state = ca_active_t.ca_disconnected;
	cls.disable_screen = false;
	CL_ResetClientData();
	cl_step_view.amount = 0;
	cl_step_view.time = 0;
	cl_step_view.sequence = 0;
	cl_predicted_movement = undefined;

	cl_landing_view.amount = 0;
	cl_landing_view.time = 0;
	cl_landing_view.sequence = 0;
	cl_movement_sound_sequence = 0;
}


/**
 * @exec per-frame
 * ================
 * CL_BuildScrFrame
 *
 * Pack client state for the screen subtree.  Parent wires data down — no cousin reads.
 * ================
 */
function CL_BuildScrFrame(): scr_frame_t {
	let i: number;
	let entities: entity_render_t[];

	entities = [];
	for ( i = 0; i < cl.entities.length; i++ )
		entities.push( CL_CopyEntityRender( cl.entities[i] ) );

	return {
		refdef: {
			vieworg: Lean_Origin([ cl.refdef.vieworg[0], cl.refdef.vieworg[1], StepView_Height(cl_step_view,Landing_ViewHeight(cl_landing_view,cl.refdef.vieworg[2]+(cl_predicted_movement?.stance?.height??60)-60,Math.trunc(cl.time*1000)),Math.trunc(cl.time*1000)) ],cl.refdef.viewangles[1],cl_predicted_movement?.lean??0),
			playerGroundOrigin: [ cl.refdef.vieworg[0], cl.refdef.vieworg[1], cl.refdef.vieworg[2] - 60 ],
			playerorg: [ cl.refdef.vieworg[0], cl.refdef.vieworg[1], StepView_Height(cl_step_view,cl.refdef.vieworg[2]+(cl_predicted_movement?.stance?.height??60)-60,Math.trunc(cl.time*1000)) ],
            hideWeapon:!!cl_predicted_movement?.mantle?.active||cl_predicted_movement?.weapon?.holster==='hidden'||CG_IsThirdPerson(),
            weapon:cl_predicted_movement?.weapon?{...cl_predicted_movement.weapon}:undefined,
			movement:cl_predicted_movement?{...cl_predicted_movement, velocity: cl_predicted_movement.velocity ?? [ ...CL_GetPredictVelocity() ] as vec3_t}:undefined,
			thirdPerson:CG_IsThirdPerson(),
			viewangles: [ cl.refdef.viewangles[0], cl.refdef.viewangles[1], cl.refdef.viewangles[2] ],
			viewaxis: [
				[ cl.refdef.viewaxis[0][0], cl.refdef.viewaxis[0][1], cl.refdef.viewaxis[0][2] ],
				[ cl.refdef.viewaxis[1][0], cl.refdef.viewaxis[1][1], cl.refdef.viewaxis[1][2] ],
				[ cl.refdef.viewaxis[2][0], cl.refdef.viewaxis[2][1], cl.refdef.viewaxis[2][2] ],
			],
			time: cl.refdef.time,
		},
		entities,
		time: cl.time,
		ping_ms: cl.ping_ms,
		disable_screen: cls.disable_screen,
		listen_server: cl_listen_server,
		pointer_lock_hint: cl_pointer_lock_hint,
		menu_overlay: SCR_MenuGpuOverlay(cl_predicted_movement),
	};
}


/**
 * @exec per-frame
 * ================
 * CL_HandleVidResize
 *
 * Com forwards resize; client parent decides whether screen/rgpu needs note.
 * ================
 */
export function CL_HandleVidResize( resized: boolean ): void {
	if ( resized || ( VID_IsValid() && !SCR_HasSwapchain() ) )
		SCR_NoteVidResize( vid.width, vid.height );
}


/**
 * @exec per-frame
 * ================
 * CL_SampleUsercmd
 *
 * Sample input and return cmd for com to route to server / net.
 * Must run before SV_Frame on listen clients.
 * ================
 */
export function CL_SampleUsercmd(): usercmd_t {
	let cmd: usercmd_t;

	cmd = CL_CreateCmd();

	if ( cl_listen_server ) {
		CL_SetWasJump( ( cmd.buttons & IN_JUMP ) !== 0 );
	}

	CL_QueueUsercmdBackup( cmd );
	return cmd;
}


/**
 * ================
 * CL_CopyEntityRender
 *
 * Deep-copy one entity origin into client storage.
 * ================
 */
function CL_CopyEntityRender( ent: entity_render_t ): entity_render_t {
	return {
		origin: [ ent.origin[0], ent.origin[1], ent.origin[2] ],
	};
}


/**
 * @exec per-frame
 * ================
 * CL_CopyEntityList
 * ================
 */
function CL_CopyEntityList( entities: entity_render_t[] ): entity_render_t[] {
	let i: number;
	let out: entity_render_t[];

	out = [];
	for ( i = 0; i < entities.length; i++ )
		out.push( CL_CopyEntityRender( entities[i] ) );

	return out;
}


/**
 * @exec per-frame
 * ================
 * CL_ApplySnapshotRefdef
 *
 * Unpack view origin and angles.  Client clock follows server_time.
 * ================
 */
function CL_ApplySnapshotRefdef( snap: client_snapshot_t ): void {
	cl.time = snap.server_time;
	cl.refdef.time = snap.server_time;
	cl.refdef.vieworg[0] = snap.vieworg[0];
	cl.refdef.vieworg[1] = snap.vieworg[1];
	cl.refdef.vieworg[2] = snap.vieworg[2];
	cl.refdef.viewangles[0] = snap.viewangles[0];
	cl.refdef.viewangles[1] = snap.viewangles[1];
	cl.refdef.viewangles[2] = snap.viewangles[2];
}


/**
 * @exec per-frame
 * ================
 * CL_ApplySnapshotPing
 *
 * Estimate one-way latency from host_sent_ms stamped on the snapshot.
 * ================
 */
function CL_ApplySnapshotPing( snap: client_snapshot_t ): void {
	cl.ping_ms = snap.host_sent_ms > 0 ? performance.now() - snap.host_sent_ms : 0;
}


/**
 * @exec per-frame
 * ================
 * CL_ApplySnapshot
 *
 * Unpack authoritative playerstate from server.  Client clock follows server_time.
 * ================
 */
function CL_ApplySnapshot( snap: client_snapshot_t ): void {
    const spawnKey=Level_Generation()+':'+(Cvar_Get('cl_ingame')==='1'?'player':'intermission');
    if(Level_Data()&&spawnKey!==cl_level_spawn_key){cl_level_spawn_key=spawnKey;CL_SetViewAnglesFromSnapshot(snap.viewangles);cl_step_view.amount=0;cl_step_view.sequence=snap.movement?.stepSequence??0;cl_landing_view.amount=0;cl_landing_view.sequence=snap.movement?.landSequence??0;cl_movement_sound_sequence=snap.movement?.soundSequence??0;}
	CL_ApplySnapshotRefdef( snap );
	cl.entities = CL_CopyEntityList( snap.entities );
	CL_ApplySnapshotPing( snap );
	if(snap.velocity)CL_SetPredictVelocity([...snap.velocity]);else CL_ResetPredictVelocity();
    cl_predicted_movement=snap.movement?{...snap.movement, velocity: snap.velocity ? [ ...snap.velocity ] as vec3_t : undefined}:undefined;
    CL_AcceptStepEvents(snap.movement);

	// Listen server sampled the same viewangles this tick.  Do not stomp live input.
	if ( !cl_listen_server )
		CL_SetViewAnglesFromSnapshot( snap.viewangles );

	CL_SetRefdefAxis( cl.refdef );
}


/**
 * @exec per-frame
 * ================
 * CL_SetViewAnglesFromSnapshot
 *
 * Apply authoritative angles from a remote server snapshot.
 * Listen server keeps sampled input angles instead.
 * ================
 */
function CL_SetViewAnglesFromSnapshot( angles: vec3_t ): void {
	CL_SetViewAngles( angles );
}


/**
 * @exec per-frame
 * ================
 * CL_PredictMovement
 *
 * Listen server snapshots are authoritative on the same tick.  Net clients
 * integrate pending usercmds here once a remote host path exists.
 * ================
 */
function CL_PredictMovement(): void {
	let cmd: usercmd_t;
	let state: pm_state_t;

	if ( cl_listen_server )
		return;

	cmd = CL_GetLatestUsercmd();
	state = PM_StateFromPlayer( cl.refdef.vieworg, cl.refdef.viewangles, CL_GetPredictVelocity(), cl_predicted_movement );
	PM_ApplyUsercmd( state, cmd, cl.frametime );
	cl_predicted_movement = state.movement;

	if ( cl_predicted_movement ) {
		cl_predicted_movement.velocity = [...state.velocity] as vec3_t;
	}

	CL_AcceptStepEvents( state.movement );

	cl.refdef.vieworg[0] = state.origin[0];
	cl.refdef.vieworg[1] = state.origin[1];
	cl.refdef.vieworg[2] = state.origin[2];
	cl.refdef.viewangles[0] = state.angles[0];
	cl.refdef.viewangles[1] = state.angles[1];
	cl.refdef.viewangles[2] = state.angles[2];
	CL_SetPredictVelocity( state.velocity );

	CL_SetRefdefAxis( cl.refdef );

	CL_SetWasJump( ( cmd.buttons & IN_JUMP ) !== 0 );
}


/**
 * @exec per-frame
 * ================
 * CL_RefdefListener
 *
 * Copy refdef view origin and axis for the audio listener.
 * ================
 */
function CL_RefdefListener(): {
	vieworg: vec3_t;
	forward: vec3_t;
	right: vec3_t;
	up: vec3_t;
} {
	let vieworg: vec3_t;
	let forward: vec3_t;
	let right: vec3_t;
	let up: vec3_t;

	vieworg = [...cl.refdef.vieworg] as vec3_t;
	forward = [...cl.refdef.viewaxis[0]] as vec3_t;
	right = [...cl.refdef.viewaxis[1]] as vec3_t;
	up = [...cl.refdef.viewaxis[2]] as vec3_t;

	return { vieworg, forward, right, up };
}


/**
 * @exec per-frame
 * ================
 * CL_UpdateSound
 *
 * Position audio listener from refdef; loop menu music on MP backdrop.
 * ================
 */
function CL_UpdateSound(): void {
	let listener: ReturnType<typeof CL_RefdefListener>;
	let menu_active: boolean;
	let mouse: { x: number; y: number };

	listener = CL_RefdefListener();
	menu_active = SCR_MenuIsActive();

	CL_SetUiMode( menu_active );
	if ( menu_active )
		S_Activate();
	S_Update( listener.vieworg, listener.forward, listener.right, listener.up );
	S_UpdateMenuMusic( menu_active && Level_Phase() === 'menu', SCR_MenuVolume() );
	S_UpdateAmbient( Level_WorldVisible() ? Level_Name() : '' );

	mouse = CL_GetMouseClientPos();
	SCR_MenuFrame( mouse.x, mouse.y );
}


/**
 * @exec per-frame
 * ================
 * CL_AdvanceClientTime
 *
 * Integrate frametime only when no snapshot arrived (dedicated client / net gap).
 * Listen path sets cl.time from server_time in CL_ApplySnapshot.
 * ================
 */
function CL_AdvanceClientTime( frametime: number ): void {
	cl.frametime = frametime;

	if ( !CL_FrameSnapshotReceived() )
		cl.time += frametime;

	cl.refdef.time = cl.time;
}


/**
 * @exec per-frame
 * ================
 * CL_RunActiveFrame
 *
 * Render via screen subtree and update sound on an active client.
 * ================
 */
function CL_RunActiveFrame( frametime: number ): void {
	CL_AdvanceClientTime( frametime );
	CL_PredictMovement();
	CL_UpdateSound();
	CG_CalculateFPS();
	SCR_UpdateScreen( frametime, CL_BuildScrFrame() );
}


/**
 * @exec per-frame
 * ================
 * CL_Frame
 *
 * Apply snapshot from com, predict, draw.  Usercmd was sampled earlier on this tick.
 * ================
 */
export function CL_Frame( frametime: number, snap: client_snapshot_t | null ): void {
	CL_FrameSnapshotBegin();

	if ( snap ) {
		CL_FrameSnapshotMark();
		CL_ApplySnapshot( snap );
	}

	if ( cls.state !== ca_active_t.ca_active )
		return;

	CL_RunActiveFrame( frametime );
}
