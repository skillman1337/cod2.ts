/*
===============================================================================

	loading.ts

	Call of Duty 2 / id Tech Engine Loading Telemetry
	Dispatches engine boot lifecycle events to window event listeners.

===============================================================================
*/


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const ENGINE_STATUS_EVENT = 'cod2:engine-status';
export const ENGINE_PHASE_GPU    = 'gpu';
export const ENGINE_PHASE_READY  = 'ready';
export const ENGINE_PHASE_ERROR  = 'error';
export const ENGINE_PHASE_QUIT   = 'quit';


// ---------------------------------------------------------------------------
// loading telemetry
// ---------------------------------------------------------------------------

/**
 * ================
 * Loading_Report
 *
 * Emits custom 'cod2:engine-status' DOM event with current engine phase and status message.
 * ================
 */
export function Loading_Report(
	phase: 'gpu' | 'ready' | 'error' | 'quit',
	message?: string
): void {
	if ( typeof globalThis.dispatchEvent !== 'function' || typeof CustomEvent === 'undefined' ) {
		return;
	}

	globalThis.dispatchEvent(
		new CustomEvent( ENGINE_STATUS_EVENT, {
			detail: {
				phase,
				message: message ?? phase,
			},
		} )
	);
}
