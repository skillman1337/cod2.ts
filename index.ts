/*
===============================================================================

	index.ts

	Parse command line, init subsystems, enter Com_Frame forever.
	(browser edition — id Software house style)

===============================================================================
*/

import { Com_Init, Com_Shutdown, Com_BeginLoop, com_init_args_t } from '@/engine/com/com.js';
import { Com_Error, errcode_t } from '@/engine/common/common.js';


// ---------------------------------------------------------------------------
// forward
// Main_RequireCanvas, Main_BootstrapParms, Main_StartGame, Main_Restart
// Main_OnHotAccept, Main_RegisterHmr, main
// ---------------------------------------------------------------------------


/**
 * ================
 * Main_RequireCanvas
 *
 * Grab #game canvas or ERR_FATAL.  Nothing WebGPU-specific here.
 * ================
 */
function Main_RequireCanvas(): HTMLCanvasElement {
	let canvas: HTMLCanvasElement | null;

	canvas = document.getElementById( 'game' ) as HTMLCanvasElement | null;
	if ( !canvas )
		Com_Error( errcode_t.ERR_FATAL, 'main: #game canvas not found' );

	return canvas;
}


/**
 * ================
 * Main_BootstrapParms
 *
 * Startup parms for Com_Init.  Browser build has no real argc/argv yet.
 * ================
 */
function Main_BootstrapParms( canvas: HTMLCanvasElement ): com_init_args_t {
	return {
		argc: 0,
		argv: [],
		canvas,
	};
}


/**
 * ================
 * Main_StartGame
 *
 * Cold init: canvas, Com_Init, com loop.  Shared by main and HMR restart.
 * ================
 */
function Main_StartGame(): void {
	let canvas: HTMLCanvasElement;

	canvas = Main_RequireCanvas();
	Com_Init( Main_BootstrapParms( canvas ) );
	Com_BeginLoop();
}


/**
 * ================
 * Main_Restart
 *
 * Com_Shutdown then cold init.  Vite HMR calls this on hot accept.
 * ================
 */
function Main_Restart(): void {
	Com_Shutdown();
	Main_StartGame();
}


/**
 * ================
 * Main_OnHotAccept
 *
 * Vite hot-module callback.  Restart subsystems without full page reload.
 * ================
 */
function Main_OnHotAccept(): void {
    // The replacement entry module already runs main(). Never restart the old graph.
}


/**
 * @exec bootstrap-once
 * ================
 * Main_RegisterHmr
 *
 * Wire Vite HMR accept when dev server provides import.meta.hot.
 * ================
 */
function Main_RegisterHmr(): void {
	if ( !import.meta.hot )
		return;

	import.meta.hot.accept( Main_OnHotAccept );
    import.meta.hot.dispose( Com_Shutdown );
}


// ---------------------------------------------------------------------------
// bootstrap
// ---------------------------------------------------------------------------

/**
 * @exec bootstrap-once
 * ================
 * main
 *
 * Init common layer, hand off to com frame loop.
 * ================
 */
function main(): void {
	Main_StartGame();
}


main();
Main_RegisterHmr();
