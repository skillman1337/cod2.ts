/*
===============================================================================

	com.ts

	Root orchestrator: init, frame loop, sibling handoff.
	Each child subtree owns its own descendants (client/screen/rgpu, etc.).

===============================================================================
*/

import { Cbuf_Init, Cbuf_Execute, Cmd_WasQuitRequested, Cmd_ClearQuitRequest } from './cmd/cmd.js';
import { Con_Init, Con_Shutdown, Con_Printf, Com_Error, errcode_t } from '@/engine/common/common.js';
import { Loading_Report } from '@/engine/common/loading.js';
import { CL_Init, CL_Shutdown, CL_Frame, CL_SampleUsercmd, CL_HandleVidResize } from './client/cl_main.js';
import { SV_Init, SV_Shutdown, SV_Frame, SV_GetPlayer } from './server/sv_main.js';
import {
	dedicated,
	Host_Init,
	Host_IsListenServer,
	Host_IsNetClient,
	Host_NetLoopback,
	Host_NetAddress,
	Host_RunsLocalServer,
	Host_SnapshotUsesNetChannel,
} from './host/host.js';
import { VID_Init, VID_CheckResize } from '@/engine/common/vid.js';
import {
	NET_Init,
	NET_Shutdown,
	NET_Frame,
	NET_SendUsercmd,
	NET_SendSnapshot,
	NET_ReadLatestSnapshot,
	NET_ConsumeLoopbackUsercmd,
} from './net/net.js';
import { client_snapshot_t, usercmd_t } from '@/engine/common/types.js';
import { Cvar_Get } from '@/engine/common/cvar.js';
import { Frame_MinMsec } from '@/engine/common/frame_clock.js';


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface com_init_args_t {
	argc: number;
	argv: string[];
	canvas: HTMLCanvasElement;
}


const enum com_init_phase_t {
	COM_INIT_NONE = 0,
	COM_INIT_HOST,
	COM_INIT_CON,
	COM_INIT_CBUF,
	COM_INIT_SV,
	COM_INIT_GRAPHICS,
}


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

let com_frame_time = 0;
let com_frametime = 0;
let com_initialized = false;
let com_framecount = 0;
let com_loop_active = false;
let com_loop_generation = 0;


// ---------------------------------------------------------------------------
// forward
// Com_RequireListenCanvas, Com_InitAlreadyDone, Com_InitDedicatedGraphics
// Com_InitListenGraphics, Com_InitGraphics, Com_ReleaseGraphics, Com_RollbackInit
// Com_InitHost, Com_InitFinalizeClock, Com_ClampFrameMsec, Com_AdvanceFrameTime
// Com_HandleVidResize, Com_RunServerClientFrames, Com_RafCallback, Com_StopLoop
// Com_Init, Com_Shutdown, Com_Frame, Com_BeginLoop
// ---------------------------------------------------------------------------


/**
 * @exec init-once
 * ================
 * Com_RequireListenCanvas
 * ================
 */
function Com_RequireListenCanvas( canvas: HTMLCanvasElement | undefined ): void {
	if ( dedicated )
		return;

	if ( !canvas )
		Com_Error( errcode_t.ERR_FATAL, 'Com_Init: listen client requires canvas' );
}


/**
 * @exec init-once
 * ================
 * Com_InitAlreadyDone
 * ================
 */
function Com_InitAlreadyDone(): boolean {
	if ( !com_initialized )
		return false;

	Con_Printf( 'Com_Init: already initialized\n' );
	return true;
}


/**
 * @exec init-once
 * ================
 * Com_InitDedicatedGraphics
 * ================
 */
function Com_InitDedicatedGraphics(): void {
	VID_Init();
}


/**
 * @exec init-once
 * ================
 * Com_InitListenGraphics
 *
 * Client subtree owns vid bind, GPU init (screen/rgpu), input, sound.
 * ================
 */
function Com_InitListenGraphics( canvas: HTMLCanvasElement ): void {
	CL_Init( canvas, Host_IsListenServer() );
}


/**
 * @exec init-once
 * ================
 * Com_InitGraphics
 * ================
 */
function Com_InitGraphics( canvas: HTMLCanvasElement | undefined ): void {
	if ( dedicated )
		return void Com_InitDedicatedGraphics();

	Com_InitListenGraphics( canvas! );
}


/**
 * ================
 * Com_ReleaseGraphics
 * ================
 */
function Com_ReleaseGraphics(): void {
	if ( dedicated )
		return void VID_Init();

	CL_Shutdown();
}


/**
 * @exec init-once
 * ================
 * Com_RollbackInit
 * ================
 */
function Com_RollbackInit( phase: com_init_phase_t ): void {
	if ( phase >= com_init_phase_t.COM_INIT_GRAPHICS )
		Com_ReleaseGraphics();

	if ( phase >= com_init_phase_t.COM_INIT_SV ) {
		NET_Shutdown();
		SV_Shutdown();
	}

	if ( phase >= com_init_phase_t.COM_INIT_CBUF )
		Cbuf_Init();

	if ( phase >= com_init_phase_t.COM_INIT_CON )
		Con_Shutdown();

	com_initialized = false;
}


/**
 * @exec init-once
 * ================
 * Com_InitHost
 * ================
 */
function Com_InitHost( args: com_init_args_t ): void {
	Host_Init( {
		argc: args.argc,
		argv: args.argv,
		basedir: '.',
	} );
}


/**
 * @exec init-once
 * ================
 * Com_InitFinalizeClock
 * ================
 */
function Com_InitFinalizeClock(): void {
	com_frame_time = performance.now();
	com_frametime = 0;
	com_framecount = 0;
}


/**
 * @exec per-frame
 * ================
 * Com_ClampFrameMsec
 * ================
 */
function Com_ClampFrameMsec( msec: number ): number {
	if ( msec >= 1 )
		return msec;

	if ( com_framecount > 0 )
		return 0;

	return 1;
}


/**
 * @exec per-frame
 * ================
 * Com_AdvanceFrameTime
 * ================
 */
function Com_AdvanceFrameTime( now_ms: number ): number | null {
	let msec: number;
	let frametime: number;

	// 0x434f20 gates the entire command/server/client frame, before movement.
	const elapsed=Math.trunc(now_ms)-Math.trunc(com_frame_time),configured=Cvar_Get('com_maxfps');
	if ( elapsed < Frame_MinMsec(configured===''?0:Number(configured),!!dedicated) )
		return null;
	msec = Com_ClampFrameMsec( elapsed );

	frametime = msec * 0.001;
	com_frame_time = now_ms;
	com_frametime = frametime;
	com_framecount++;

	return frametime;
}


/**
 * @exec per-frame
 * ================
 * Com_HandleVidResize
 *
 * Resize runs before the tick.  com forwards into client → screen → rgpu chain.
 * ================
 */
function Com_HandleVidResize(): void {
	CL_HandleVidResize( VID_CheckResize() );
}


/**
 * @exec per-frame
 * ================
 * Com_RunServerClientFrames
 *
 * Parent wires sibling handoff: usercmd → server/net → snapshot → client.
 * Children never import each other across branches.
 * ================
 */
function Com_RunServerClientFrames( frametime: number ): void {
	let cmd: usercmd_t | null = null;
	let snap: client_snapshot_t | null = null;
	let server_cmd: usercmd_t | null = null;

	if ( !dedicated ) {
		cmd = CL_SampleUsercmd();

		if ( Host_IsNetClient() && cmd )
			NET_SendUsercmd( cmd );
	}

	if ( Host_RunsLocalServer() ) {
		if ( Host_NetLoopback() )
			server_cmd = NET_ConsumeLoopbackUsercmd();
		else
			server_cmd = cmd;

		snap = SV_Frame( frametime, server_cmd );

		if ( snap && Host_SnapshotUsesNetChannel() )
			NET_SendSnapshot( snap );
	}

	if ( dedicated )
		return;

	NET_Frame();

	if ( Host_SnapshotUsesNetChannel() )
		snap = NET_ReadLatestSnapshot();

	CL_Frame( frametime, snap );
}


/**
 * @exec per-frame
 * ================
 * Com_RafCallback
 *
 * Internal requestAnimationFrame handler.
 * ================
 */
function Com_RafCallback( now_ms: number, loop_generation: number ): void {
	if ( loop_generation !== com_loop_generation || !com_loop_active )
		return;

	Com_HandleVidResize();
	Com_Frame( now_ms );

	if ( loop_generation !== com_loop_generation || !com_loop_active )
		return;

	requestAnimationFrame( ( t ) => Com_RafCallback( t, loop_generation ) );
}


/**
 * @exec per-frame
 * ================
 * Com_StopLoop
 * ================
 */
function Com_StopLoop(): void {
	com_loop_active = false;
	com_loop_generation++;
}


/**
 * @exec init-once
 * ================
 * Com_Init
 * ================
 */
export function Com_Init( args: com_init_args_t ): void {
	let phase: com_init_phase_t;

	if ( Com_InitAlreadyDone() )
		return;

	phase = com_init_phase_t.COM_INIT_NONE;

	try {
		Com_InitHost( args );
		phase = com_init_phase_t.COM_INIT_HOST;

		Com_RequireListenCanvas( args.canvas );
		Con_Init();
		phase = com_init_phase_t.COM_INIT_CON;

		Cbuf_Init();
		phase = com_init_phase_t.COM_INIT_CBUF;

		SV_Init( Host_RunsLocalServer() );
		phase = com_init_phase_t.COM_INIT_SV;

		NET_Init( {
			net_address: Host_NetAddress(),
			net_loopback: Host_NetLoopback(),
			is_net_client: Host_IsNetClient(),
		} );

		Com_InitGraphics( args.canvas );
		phase = com_init_phase_t.COM_INIT_GRAPHICS;

		Com_InitFinalizeClock();
		com_initialized = true;
		Con_Printf( 'Com_Init done\n' );
	} catch ( err ) {
		Com_RollbackInit( phase );
		throw err;
	}
}


/**
 * @exec per-frame
 *
 * Com_ReleaseGraphics tears down listen client via {@link CL_Shutdown}.
 * ================
 * Com_Shutdown
 * ================
 */
export function Com_Shutdown(): void {
	if ( !com_initialized )
		return;

	Com_ReleaseGraphics();
	SV_Shutdown();
	NET_Shutdown();
	Cbuf_Init();
	Con_Shutdown();
	Com_StopLoop();
	Cmd_ClearQuitRequest();

	com_initialized = false;

	if ( typeof document !== 'undefined' && document.exitPointerLock ) {
		document.exitPointerLock();
	}
	Loading_Report( 'quit', 'Quit game' );
}


/**
 * @exec per-frame
 * ================
 * Com_Frame
 * ================
 */
export function Com_Frame( now_ms: number ): void {
	let frametime: number | null;

	frametime = Com_AdvanceFrameTime( now_ms );
	if ( frametime === null )
		return;

	Cbuf_Execute();
	Com_RunServerClientFrames( frametime );

	if ( Cmd_WasQuitRequested() )
		Com_Shutdown();
}


/**
 * @exec bootstrap-once
 * ================
 * Com_BeginLoop
 *
 * Enter requestAnimationFrame forever.  Browser equivalent of while(1) Com_Frame.
 * ================
 */
export function Com_BeginLoop(): void {
	let loop_generation: number;

	if ( com_loop_active )
		return;

	Cmd_ClearQuitRequest();
	com_loop_active = true;
	com_loop_generation++;
	loop_generation = com_loop_generation;
	requestAnimationFrame( ( t ) => Com_RafCallback( t, loop_generation ) );
}


/**
 * @exec helper
 * ================
 * Com_GetPlayer
 * ================
 */
export function Com_GetPlayer() {
	return SV_GetPlayer();
}
