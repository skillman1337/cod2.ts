/*
===============================================================================

	scr_draw.ts

	Client screen update, loading plaque, and 2D overlays.

===============================================================================
*/

import {
	RGPU_IsReady,
	RGPU_IsInitFailed,
	RGPU_IsPresentable,
	RGPU_HasSwapchain,
	RGPU_HasWebGPUContext,
	RGPU_DrawLoadingFrame,
	RGPU_DrawFailedFrame,
	RGPU_BeginFrame,
	RGPU_UploadFrameUniforms,
	RGPU_DrawWorld,
	RGPU_DrawEntitiesOnList,
	RGPU_EndFrame,
	RGPU_InitBegin,
	RGPU_InitPoll,
	RGPU_Shutdown,
	RGPU_NoteResize,
	RGPU_LoadingMessage,
	RGPU_FailMessage,
} from './scr_draw/r_webgpu.js';
import { entity_render_t, refdef_t, rgpu_menu_overlay_t, vec3_t } from '@/engine/common/types.js';
import { vid, VID_IsValid } from '@/engine/common/vid.js';
import { AngleVectors } from '@/engine/common/math.js';
import { Cvar_Get } from '@/engine/common/cvar.js';
import { CG_GetFpsString } from '@/engine/common/cg_draw.js';
import { CG_IsThirdPerson, CG_OffsetThirdPersonView } from '@/engine/common/cg_view.js';


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface scr_frame_t {
	refdef: refdef_t;
	entities: entity_render_t[];
	time: number;
	ping_ms: number;
	disable_screen: boolean;
	listen_server: boolean;
	pointer_lock_hint: boolean;
	menu_overlay: rgpu_menu_overlay_t | null;
}


// ---------------------------------------------------------------------------
// forward
// SCR_AxisRow, SCR_IdentityViewaxis, SCR_CopyVec3, SCR_CopyViewaxis, SCR_CopyRefdef
// SCR_GetOverlay, SCR_GetStatsElement, SCR_GetCrosshairElement
// SCR_SetOverlayMode, SCR_GetLoadingMessage, SCR_SetOverlayText
// SCR_SetCanvasTitle, SCR_ClearCenterString, SCR_HideOverlayForGpuDraw
// SCR_ShowLoadingOverlay, SCR_ShowCenterOnOverlay, SCR_ShowCenterOnCanvas
// SCR_FormatPing, SCR_UpdateFps, SCR_GetPointerLockHint, SCR_MakeDefaultRefdef
// SCR_DrawFailedGpuFrame, SCR_DrawFailedScreen, SCR_DrawLoadingScreen
// SCR_DrawNotReadyScreen, SCR_DrawGameScreen
// SCR_DrawCanvas2D, V_CalcRefdef, V_RenderView, R_RenderScene
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 2D draw
// ---------------------------------------------------------------------------

let scr_overlay_el: HTMLElement | null = null;
let scr_stats_el: HTMLElement | null = null;
let scr_crosshair_el: HTMLElement | null = null;

let scr_fps_samples: number[] = [];
let scr_fps_display = 0;
let scr_last_frametime = 0;


/**
 * ================
 * SCR_AxisRow
 *
 * Single viewaxis row for identity or copy helpers.
 * ================
 */
function SCR_AxisRow( x: number, y: number, z: number ): vec3_t {
	return [ x, y, z ];
}


/**
 * ================
 * SCR_IdentityViewaxis
 *
 * Default forward / right / up before client refdef is wired.
 * ================
 */
function SCR_IdentityViewaxis(): refdef_t['viewaxis'] {
	return [
		SCR_AxisRow( 1, 0, 0 ),
		SCR_AxisRow( 0, 1, 0 ),
		SCR_AxisRow( 0, 0, 1 ),
	];
}


const scr_default_refdef: refdef_t = {
	vieworg: [ 0, 0, 0 ],
	viewangles: [ 0, 0, 0 ],
	viewaxis: SCR_IdentityViewaxis(),
	time: 0,
};


/**
 * ================
 * SCR_CopyVec3
 * ================
 */
function SCR_CopyVec3( v: vec3_t ): vec3_t {
	return [ ...v ];
}


/**
 * @exec per-frame
 * ================
 * SCR_CopyViewaxis
 *
 * Deep-copy viewaxis without nested literal indents.
 * ================
 */
function SCR_CopyViewaxis( axis: refdef_t['viewaxis'] ): refdef_t['viewaxis'] {
	return [
		SCR_CopyVec3( axis[0] ),
		SCR_CopyVec3( axis[1] ),
		SCR_CopyVec3( axis[2] ),
	];
}


/**
 * @exec per-frame
 * ================
 * SCR_CopyRefdef
 *
 * Snapshot refdef fields for per-frame draw without aliasing cl.refdef.
 * ================
 */
function SCR_CopyRefdef( source: refdef_t ): refdef_t {
	return {
		vieworg: SCR_CopyVec3( source.vieworg ),
		viewangles: SCR_CopyVec3( source.viewangles ),
		viewaxis: SCR_CopyViewaxis( source.viewaxis ),
		time: source.time,
		hideWeapon: source.hideWeapon,
		weapon: source.weapon ? { ...source.weapon } : undefined,
	};
}


/**
 * ================
 * SCR_GetOverlay
 *
 * Browser overlay for center string when WebGPU owns the canvas.
 * ================
 */
function SCR_GetOverlay(): HTMLElement | null {
	if ( !scr_overlay_el )
		scr_overlay_el = document.getElementById( 'scr_overlay' );

	return scr_overlay_el;
}


/**
 * ================
 * SCR_GetStatsElement
 * ================
 */
function SCR_GetStatsElement(): HTMLElement | null {
	if ( !scr_stats_el )
		scr_stats_el = document.getElementById( 'scr_stats' );

	return scr_stats_el;
}


/**
 * ================
 * SCR_GetCrosshairElement
 * ================
 */
function SCR_GetCrosshairElement(): HTMLElement | null {
	if ( !scr_crosshair_el )
		scr_crosshair_el = document.getElementById( 'scr_crosshair' );

	return scr_crosshair_el;
}


/**
 * ================
 * SCR_SetOverlayMode
 *
 * loading | fail | none — CSS classes on #scr_overlay.
 * ================
 */
function SCR_SetOverlayMode( mode: 'loading' | 'fail' | 'none' ): void {
	let el: HTMLElement | null;

	el = SCR_GetOverlay();
	if ( !el )
		return;

	el.classList.remove( 'loading', 'fail' );

	if ( mode === 'loading' ) {
		el.classList.add( 'loading' );
		return;
	}

	if ( mode === 'fail' )
		el.classList.add( 'fail' );
}


/**
 * ================
 * SCR_GetLoadingMessage
 *
 * Human-readable init step for the loading overlay.
 * ================
 */
function SCR_GetLoadingMessage(): string {
	return RGPU_LoadingMessage();
}


/**
 * ================
 * SCR_SetOverlayText
 *
 * Show or hide the HTML overlay element.
 * ================
 */
function SCR_SetOverlayText( el: HTMLElement, msg: string ): void {
	if ( msg.length === 0 ) {
		el.textContent = '';
		el.style.display = 'none';
		SCR_SetOverlayMode( 'none' );
		return;
	}

	el.textContent = msg;
	el.style.display = 'flex';
}


/**
 * ================
 * SCR_SetCanvasTitle
 *
 * Fallback center string via canvas title when overlay is absent.
 * ================
 */
function SCR_SetCanvasTitle( msg: string ): void {
	if ( !vid.canvas )
		return;

	vid.canvas.title = msg;
}


/**
 * ================
 * SCR_ClearCenterString
 * ================
 */
function SCR_ClearCenterString(): void {
	let el: HTMLElement | null;

	el = SCR_GetOverlay();
	if ( el )
		SCR_SetOverlayText( el, '' );

	SCR_SetCanvasTitle( '' );
}


/**
 * ================
 * SCR_HideOverlayForGpuDraw
 *
 * WebGPU owns the canvas once presentable.  Hide HTML overlay so it does not
 * cover swapchain clears or the game pass.
 * ================
 */
function SCR_HideOverlayForGpuDraw(): void {
	SCR_ClearCenterString();
}


/**
 * ================
 * SCR_DrawCanvas2D
 *
 * Software fallback before webgpu context is claimed, or when init failed early.
 * Must not call getContext('2d') on #game — that permanently blocks webgpu.
 * Use #scr_overlay or canvas title instead; page CSS clears the backdrop.
 * ================
 */
function SCR_DrawCanvas2D( msg: string ): void {
	let el: HTMLElement | null;

	if ( RGPU_HasWebGPUContext() )
		return;

	el = SCR_GetOverlay();
	if ( el ) {
		SCR_SetOverlayText( el, msg );
		return;
	}

	SCR_SetCanvasTitle( msg );
}


/**
 * ================
 * SCR_ShowLoadingOverlay
 *
 * HTML overlay on top of WebGPU canvas during init steps.
 * ================
 */
function SCR_ShowLoadingOverlay( msg: string ): void {
	let el: HTMLElement | null;

	el = SCR_GetOverlay();
	if ( !el )
		return;

	SCR_SetOverlayMode( 'loading' );
	SCR_SetOverlayText( el, msg );
}


/**
 * ================
 * SCR_DrawLoadingPlaque
 *
 * Shown while GPU init is in flight.  Clears swapchain and keeps step text visible
 * until RGPU_IsReady, not merely until the swapchain is presentable.
 * ================
 */
function SCR_DrawLoadingPlaque( menu_overlay: rgpu_menu_overlay_t | null ): void {
	if ( !RGPU_IsReady() )
		SCR_ShowLoadingOverlay( SCR_GetLoadingMessage() );

	if ( RGPU_IsPresentable() && VID_IsValid() )
		RGPU_DrawLoadingFrame( vid.width, vid.height, menu_overlay );

	if ( !RGPU_IsReady() )
		return;

	SCR_SetOverlayMode( 'none' );
	SCR_ClearCenterString();
}


/**
 * ================
 * SCR_ShowCenterOnOverlay
 * ================
 */
function SCR_ShowCenterOnOverlay( msg: string ): boolean {
	let el: HTMLElement | null;

	el = SCR_GetOverlay();
	if ( !el )
		return false;

	SCR_SetOverlayText( el, msg );
	return true;
}


/**
 * ================
 * SCR_ShowCenterOnCanvas
 *
 * Title fallback when overlay is absent.  GPU path has no 2D center string yet.
 * ================
 */
function SCR_ShowCenterOnCanvas( msg: string ): void {
	if ( !RGPU_HasWebGPUContext() ) {
		SCR_DrawCanvas2D( msg );
		return;
	}

	SCR_SetCanvasTitle( msg );
}


/**
 * ================
 * SCR_DrawCenterString
 * ================
 */
function SCR_DrawCenterString( msg: string ): void {
	if ( msg.length === 0 ) {
		SCR_ClearCenterString();
		return;
	}

	if ( SCR_ShowCenterOnOverlay( msg ) )
		return;

	SCR_ShowCenterOnCanvas( msg );
}


/**
 * @exec per-frame
 * ================
 * SCR_DrawCrosshair
 * ================
 */
function SCR_DrawCrosshair(): void {
	let el: HTMLElement | null;

	el = SCR_GetCrosshairElement();
	if ( !el )
		return;

	el.style.display = 'block';
}


/**
 * ================
 * SCR_HideCrosshair
 * ================
 */
function SCR_HideCrosshair(): void {
	let el: HTMLElement | null;

	el = SCR_GetCrosshairElement();
	if ( !el )
		return;

	el.style.display = 'none';
}


/**
 * ================
 * SCR_UpdateFps
 *
 * Rolling average of frame rate for the HUD stats line.
 * ================
 */
function SCR_UpdateFps( frametime: number ): void {
	let sample: number;

	if ( frametime <= 0 )
		return;

	sample = 1 / frametime;
	scr_fps_samples.push( sample );
	if ( scr_fps_samples.length > 32 )
		scr_fps_samples.shift();

	scr_fps_display = scr_fps_samples.reduce( ( a, b ) => a + b, 0 ) / scr_fps_samples.length;
}


/**
 * @exec per-frame
 * ================
 * SCR_FormatPing
 *
 * HUD ping line: local on listen server, rounded ms otherwise.
 * ================
 */
function SCR_FormatPing( frame: scr_frame_t ): string {
	if ( frame.listen_server )
		return 'local';

	return Math.round( frame.ping_ms ).toString();
}


/**
 * @exec per-frame
 * ================
 * SCR_DrawStats
 * ================
 */
function SCR_DrawStats( frame: scr_frame_t ): void {
	let el: HTMLElement | null;
	let text: string;

	el = SCR_GetStatsElement();
	if ( !el )
		return;

	const drawFps = Cvar_Get( 'cg_drawFPS' ).trim().toLowerCase();
	if ( drawFps === '' || drawFps === '0' || drawFps === 'off' ) {
		SCR_HideStats();
		return;
	}

	SCR_UpdateFps( scr_last_frametime );

	const fpsStr = CG_GetFpsString() ?? ( Math.round( scr_fps_display ).toString() + ' fps' );

	text =
		fpsStr + '\n' +
		'time ' + frame.time.toFixed( 2 ) + '\n' +
		'ping ' + SCR_FormatPing( frame );

	el.textContent = text;
	el.style.display = 'block';
}


/**
 * ================
 * SCR_HideStats
 * ================
 */
function SCR_HideStats(): void {
	let el: HTMLElement | null;

	el = SCR_GetStatsElement();
	if ( !el )
		return;

	el.style.display = 'none';
}


// ---------------------------------------------------------------------------
// view
// ---------------------------------------------------------------------------

/**
 * @exec per-frame
 * ================
 * R_RenderScene
 *
 * World + entities (particles and view weapon instanced in RGPU_DrawEntities).
 * ================
 */
function R_RenderScene( refdef: refdef_t, entities: entity_render_t[], overlay: rgpu_menu_overlay_t | null ): void {
	RGPU_UploadFrameUniforms( refdef );

	RGPU_DrawWorld( overlay );
	RGPU_DrawEntitiesOnList( entities, refdef );
}


/**
 * @exec per-frame
 * ================
 * V_CalcRefdef
 *
 * Copy parent-supplied refdef for this frame draw.
 * ================
 */
function V_CalcRefdef( refdef: refdef_t, source: refdef_t, time: number ): void {
	refdef.vieworg = SCR_CopyVec3( source.vieworg );
	refdef.viewangles = SCR_CopyVec3( source.viewangles );
	refdef.viewaxis = SCR_CopyViewaxis( source.viewaxis );
	refdef.playerorg = source.playerorg ? SCR_CopyVec3( source.playerorg ) : SCR_CopyVec3( source.vieworg );
	refdef.playerangles = SCR_CopyVec3( source.playerangles ?? source.viewangles );
	refdef.playerGroundOrigin = source.playerGroundOrigin ? SCR_CopyVec3( source.playerGroundOrigin ) : undefined;
	refdef.playerControllers = source.playerControllers;
	refdef.movement = source.movement;
	if ( CG_IsThirdPerson() ) {
		refdef.thirdPerson = true;
		CG_OffsetThirdPersonView( refdef );
	} else {
		refdef.thirdPerson = false;
		if ( source.weapon?.motion ) {
			refdef.viewangles = refdef.viewangles.map( ( v, i ) => v + source.weapon!.motion!.view[i] ) as vec3_t;
			AngleVectors( refdef.viewangles, refdef.viewaxis[0], refdef.viewaxis[1], refdef.viewaxis[2] );
		}
		refdef.hideWeapon = source.hideWeapon;
	}
	refdef.time = time;
	refdef.weapon = source.weapon ? { ...source.weapon } : undefined;
}


/**
 * @exec per-frame
 * ================
 * V_RenderView
 *
 * View weapon is instanced in RGPU_DrawEntitiesOnList; no separate draw pass yet.
 * ================
 */
function V_RenderView( refdef: refdef_t ): void {
	void refdef;
}


/**
 * @exec per-frame
 * ================
 * SCR_GetPointerLockHint
 * ================
 */
function SCR_GetPointerLockHint( frame: scr_frame_t ): string {
	if ( !frame.pointer_lock_hint )
		return '';

	return 'Press WASD or click canvas for mouselook';
}


/**
 * @exec per-frame
 * ================
 * SCR_MakeDefaultRefdef
 * ================
 */
function SCR_MakeDefaultRefdef(): refdef_t {
	return SCR_CopyRefdef( scr_default_refdef );
}


/**
 * @exec per-frame
 * ================
 * SCR_DrawFailedGpuFrame
 *
 * Swapchain fail plaque when GPU context exists but init failed.
 * ================
 */
function SCR_DrawFailedGpuFrame(): void {
	if ( !RGPU_HasSwapchain() || !VID_IsValid() )
		return;

	SCR_HideOverlayForGpuDraw();
	RGPU_DrawFailedFrame( vid.width, vid.height );
}


/**
 * @exec per-frame
 * ================
 * SCR_DrawFailedScreen
 * ================
 */
function SCR_DrawFailedScreen(): void {
	let fail_msg: string;

	SCR_SetOverlayMode( 'fail' );
	SCR_DrawFailedGpuFrame();
	fail_msg = RGPU_FailMessage();
	SCR_DrawCenterString( fail_msg.length > 0 ? fail_msg : 'WebGPU init failed' );
}


/**
 * ================
 * SCR_DrawLoadingScreen
 * ================
 */
function SCR_DrawLoadingScreen( frame: scr_frame_t ): void {
	SCR_HideCrosshair();
	SCR_HideStats();
	SCR_DrawLoadingPlaque( frame.menu_overlay );
	SCR_DrawCenterString( '' );
}


/**
 * @exec per-frame
 * ================
 * SCR_DrawNotReadyScreen
 *
 * Loading plaque or fail path while GPU init is incomplete or vid is invalid.
 * ================
 */
function SCR_DrawNotReadyScreen( frame: scr_frame_t ): void {
	SCR_HideCrosshair();
	SCR_HideStats();

	if ( RGPU_IsInitFailed() ) {
		SCR_DrawFailedScreen();
		return;
	}

	SCR_DrawLoadingScreen( frame );
}


/**
 * @exec per-frame
 * ================
 * SCR_DrawGameScreen
 *
 * Full render path once GPU and vid are ready.
 * ================
 */
function SCR_DrawGameScreen( frame: scr_frame_t ): void {
	let refdef: refdef_t;

	refdef = SCR_MakeDefaultRefdef();
	V_CalcRefdef( refdef, frame.refdef, frame.time );

	SCR_HideOverlayForGpuDraw();
	RGPU_BeginFrame( vid.width, vid.height, frame.menu_overlay );
	R_RenderScene( refdef, frame.entities, frame.menu_overlay );

	V_RenderView( refdef );
	SCR_HideCrosshair();
	SCR_ClearCenterString();
	SCR_DrawStats( frame );

	RGPU_EndFrame();
}


// ---------------------------------------------------------------------------
// screen update
// ---------------------------------------------------------------------------

/**
 * @exec per-frame
 *
 * ================
 * SCR_UpdateScreen
 *
 * Loading plaque runs before RGPU_IsReady.  Full draw path gated on ready + valid vid.
 * ================
 */
export function SCR_UpdateScreen( frametime: number, frame: scr_frame_t ): void {
	scr_last_frametime = frametime;
	SCR_UpdateFps( frametime );
	RGPU_InitPoll();

	// id_game.psc: loading plaque while screen disabled.
	if ( frame.disable_screen ) {
		SCR_DrawLoadingScreen( frame );
		return;
	}

	// id_webgpu.psc: same until RGPU_IsReady.  Invalid vid after hide/resize must not
	// reach BeginFrame — stay on plaque path, not a blank frame.
	if ( !RGPU_IsReady() || !VID_IsValid() || !RGPU_HasSwapchain() ) {
		SCR_DrawNotReadyScreen( frame );
		return;
	}

	SCR_DrawGameScreen( frame );
}


/**
 * @exec init-once
 * ================
 * SCR_InitGpu
 *
 * Parent cl_main calls once; screen owns the rgpu subtree.
 * ================
 */
export function SCR_InitGpu(): void {
	RGPU_InitBegin();
}


/**
 * @exec init-once
 * ================
 * SCR_ShutdownGpu
 * ================
 */
export function SCR_ShutdownGpu(): void {
	RGPU_Shutdown();
}


/**
 * @exec per-frame
 * ================
 * SCR_NoteVidResize
 *
 * Com → cl_main → screen → rgpu resize chain.
 * ================
 */
export function SCR_NoteVidResize( width: number, height: number ): void {
	RGPU_NoteResize( width, height );
}


/**
 * @exec helper
 * ================
 * SCR_HasSwapchain
 *
 * Com resize gate without importing rgpu directly.
 * ================
 */
export function SCR_HasSwapchain(): boolean {
	return RGPU_HasSwapchain();
}
