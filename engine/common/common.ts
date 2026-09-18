/*
===============================================================================

	common.ts

	Console output and fatal errors.

===============================================================================
*/

import { Cvar_GetDeveloper } from './cvar.js';
import { Command_Matches, Command_ArgumentMatches } from './commands.js';


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export const enum errcode_t {
	ERR_FATAL = 0,
	ERR_DROP,
	ERR_DISCONNECT,
}


interface con_t {
	initialized: boolean;
	text: string;
	log_el: HTMLElement | null;
}


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const CON_MAX_LOG_LINES = 64;
let con_open = false;
let con_full = false;
let con_input = '';
let con_history_index = 0;
const con_history: string[] = [];
const con_commands: string[] = [];

/**
 * @exec helper
 * ================
 * Con_IsOpen
 *
 * True when the drop-down or fullscreen console overlay is visible.
 * ================
 */
export function Con_IsOpen(): boolean {
	return con_open;
}

/**
 * @exec helper
 * ================
 * Con_IsFull
 *
 * True when console is toggled to full-screen display mode.
 * ================
 */
export function Con_IsFull(): boolean {
	return con_full;
}

/**
 * @exec helper
 * ================
 * Con_Input
 *
 * Returns current text entered in console command prompt.
 * ================
 */
export function Con_Input(): string {
	return con_input;
}

/**
 * @exec helper
 * ================
 * Con_Lines
 *
 * Returns array of console log lines.
 * ================
 */
export function Con_Lines(): string[] {
	return con.text.trimEnd().split( '\n' );
}

/**
 * @exec per-frame
 * ================
 * Con_TakeCommands
 *
 * Drains and returns newline-delimited command strings queued by console input.
 * ================
 */
export function Con_TakeCommands(): string {
	return con_commands.splice( 0 ).join( '\n' );
}

/**
 * @exec async-callback
 * ================
 * Con_Key
 *
 * Handles key down events directed to the console overlay.
 * Handles command history navigation, autocompletion, execution, and backspace.
 * ================
 */
export function Con_Key( key: string, full: boolean = false ): boolean {
	if ( key === '`' || key === '~' ) {
		if ( full ) {
			con_open = true;
			con_full = !con_full;
		} else {
			con_open = !con_open;
			con_full = false;
			con_input = '';
		}
		return true;
	}

	if ( !con_open ) {
		return false;
	}

	if ( key === 'Escape' ) {
		con_open = false;
	} else if ( key === 'Backspace' ) {
		con_input = con_input.slice( 0, -1 );
	} else if ( key === 'Tab' ) {
		const matches = Command_Matches( con_input );

		if ( matches.length ) {
			let prefix = matches[0];

			while ( !matches.every( ( match ) => match.toLowerCase().startsWith( prefix.toLowerCase() ) ) ) {
				prefix = prefix.slice( 0, -1 );
			}

			const prefixChar = /^[\\/]/.test( con_input ) ? con_input[0] : '\\';
			const argPrefix = Command_ArgumentMatches( con_input )?.prefix ?? '';
			const trailingSpace = matches.length === 1 ? ' ' : '';

			con_input = prefixChar + argPrefix + prefix + trailingSpace;
		}
	} else if ( key === 'Enter' && con_input.trim() ) {
		const command = con_input.replace( /^[\\/]/, '' );
		con_commands.push( command );
		con_history.push( con_input );

		if ( con_history.length > 32 ) {
			con_history.shift();
		}

		con_history_index = con_history.length;
		Con_Printf( ']' + con_input + '\n' );
		con_input = '';
	} else if ( key === 'ArrowUp' || key === 'ArrowDown' ) {
		const step = key === 'ArrowUp' ? -1 : 1;
		con_history_index = Math.max( 0, Math.min( con_history.length, con_history_index + step ) );
		con_input = con_history[con_history_index] ?? '';
	} else if ( key.length === 1 && con_input.length < 255 ) {
		con_input += key;
	}

	return true;
}


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

const con: con_t = {
	initialized: false,
	text: '',
	log_el: null,
};


// ---------------------------------------------------------------------------
// forward
// Con_GetLogElement, Con_TrimLogLines, Con_UpdateDisplay, Con_EnsureNewline
// Com_ErrorIsDropOrDisconnect
// Con_Init, Con_Shutdown, Con_Print, Con_Printf, Con_DPrintf, Com_Error
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// console
// ---------------------------------------------------------------------------

/**
 * ================
 * Con_GetLogElement
 *
 * Lazy-bind #con_log from index.html.
 * ================
 */
function Con_GetLogElement(): HTMLElement | null {
	if ( !con.log_el )
		con.log_el = document.getElementById( 'con_log' );

	return con.log_el;
}


/**
 * ================
 * Con_TrimLogLines
 *
 * Keep the tail of the log so the overlay does not grow without bound.
 * ================
 */
function Con_TrimLogLines( text: string ): string {
	let lines: string[];

	lines = text.split( '\n' );
	if ( lines.length <= CON_MAX_LOG_LINES )
		return text;

	return lines.slice( lines.length - CON_MAX_LOG_LINES ).join( '\n' );
}


/**
 * ================
 * Con_UpdateDisplay
 *
 * Mirror con.text to the page log.  Called from Con_Print.
 * ================
 */
function Con_UpdateDisplay(): void {
	let el: HTMLElement | null;

	el = Con_GetLogElement();
	if ( !el )
		return;

	el.textContent = con.text;
}


/**
 * ================
 * Con_EnsureNewline
 *
 * Append trailing newline when caller omitted one.
 * ================
 */
function Con_EnsureNewline( msg: string ): string {
	if ( msg.endsWith( '\n' ) )
		return msg;

	return msg + '\n';
}


/**
 * @exec init-once
 * ================
 * Con_Init
 * ================
 */
export function Con_Init(): void {
	con.initialized = true;
	con.text = '';
	Con_UpdateDisplay();
}


/**
 * ================
 * Con_Shutdown
 *
 * Clear console state.  Com_RollbackInit calls this on failed Com_Init.
 * ================
 */
export function Con_Shutdown(): void {
	con_open = false;
	con_full = false;
	con_input = '';
	con_commands.length = 0;
	con_history.length = 0;
	con_history_index = 0;
	con.initialized = false;
	con.text = '';
	Con_UpdateDisplay();
}


/**
 * ================
 * Con_Print
 *
 * Raw print.  No newline added.
 * ================
 */
export function Con_Print( msg: string ): void {
	if ( !con.initialized )
		return;

	con.text += msg;
	con.text = Con_TrimLogLines( con.text );
	Con_UpdateDisplay();
}


/**
 * ================
 * Con_Printf
 *
 * Console print with implicit handling of trailing newline from caller.
 * ================
 */
export function Con_Printf( msg: string ): void {
	Con_Print( Con_EnsureNewline( msg ) );
	if ( Cvar_GetDeveloper() >= 1 )
		console.log( msg.trimEnd() );
}


/**
 * ================
 * Con_DPrintf
 *
 * Developer print.  Gated on developer cvar.
 * ================
 */
export function Con_DPrintf( msg: string ): void {
	if ( Cvar_GetDeveloper() < 1 )
		return;

	Con_Print( Con_EnsureNewline( msg ) );
}


// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

/**
 * ================
 * Com_ErrorIsDropOrDisconnect
 *
 * ERR_DROP and ERR_DISCONNECT throw a plain Error for callers to catch.
 * ================
 */
function Com_ErrorIsDropOrDisconnect( code: errcode_t ): boolean {
	return code === errcode_t.ERR_DROP || code === errcode_t.ERR_DISCONNECT;
}


/**
 * ================
 * Com_Error
 *
 * Fatal and non-fatal common errors.  ERR_FATAL never returns.
 * ================
 */
export function Com_Error( code: errcode_t, msg: string ): never {
	if ( Com_ErrorIsDropOrDisconnect( code ) )
		throw new Error( msg );

	throw new Error( 'fatal: ' + msg );
}
