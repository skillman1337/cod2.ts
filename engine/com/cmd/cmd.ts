/*
===============================================================================

	cmd.ts

	Command buffer.  Console and scripts queue text here;
	Cbuf_Execute drains it once per Com_Frame.

===============================================================================
*/

import { Con_Printf, Con_TakeCommands } from '@/engine/common/common.js';
import { Cvar_Get, Cvar_Has } from '@/engine/common/cvar.js';
import { Cvar_Set } from '@/engine/common/cvar.js';
import { Command_Register, Command_Dispatch, Command_Lines, Command_Tokens } from '@/engine/common/commands.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

interface cbuf_t {
	text: string;
	wait: number;
}


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

const cbuf: cbuf_t = {
	text: '',
	wait: 0,
};

let cmd_quit_requested = false;

let cmd_argc = 0;
const cmd_argv: string[] = [];

/**
 * @exec helper
 * ================
 * Cbuf_AddText
 *
 * Appends command text directly to the execution buffer.
 * ================
 */
export function Cbuf_AddText( text: string ): void {
	cbuf.text += text;
}


// ---------------------------------------------------------------------------
// forward
// Cbuf_PullTrailingFragment, Cbuf_PullLine
// Cbuf_TickWait, Cbuf_DispatchNextLine, Cbuf_DispatchAllLines
// Cmd_AppendToken, Cmd_TokenizeString, Cmd_Argv, Cmd_Args
// Cmd_DispatchEcho, Cmd_DispatchWait, Cmd_DispatchQuit, Cmd_DispatchSet
// Cmd_DispatchUnknown, Cmd_ExecuteString
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// command buffer
// ---------------------------------------------------------------------------

/**
 * @exec init-once
 * ================
 * Cbuf_Init
 *
 * Clear pending commands.
 * ================
 */
export function Cbuf_Init(): void {
	cbuf.text = '';
	cbuf.wait = 0;

	Command_Register( 'echo', ( args ) => {
		Con_Printf( args.join( ' ' ) );
	} );

	Command_Register( 'wait', ( args ) => {
		Cbuf_Wait( Math.max( 1, parseInt( args[0], 10 ) || 1 ) );
	} );

	Command_Register( 'quit', Cmd_DispatchQuit );
	Command_Register( 'exit', Cmd_DispatchQuit );

	for ( const name of ['set', 'seta', 'sets', '+set'] ) {
		Command_Register( name, ( args ) => {
			if ( args.length >= 2 ) {
				Cvar_Set( args[0], args.slice( 1 ).join( ' ' ) );
			}
		} );
	}
}


/**
 * @exec per-frame
 * ================
 * Cbuf_Wait
 *
 * Skip command execution for N frames.
 * ================
 */
export function Cbuf_Wait( frames: number ): void {
	cbuf.wait = frames;
}


/**
 * @exec per-frame
 * ================
 * Cbuf_PullTrailingFragment
 *
 * No newline left: take trimmed tail and clear cbuf.
 * ================
 */
function Cbuf_PullTrailingFragment(): string | null {
	let line: string;

	line = cbuf.text.trim();
	cbuf.text = '';

	if ( line.length === 0 )
		return null;

	return line;
}


/**
 * @exec per-frame
 * ================
 * Cbuf_PullLine
 *
 * Take one command line from the head of cbuf.  Returns null when drained.
 * Empty string means blank line; caller should skip and pull again.
 * ================
 */
function Cbuf_PullLine(): string | null {
	let line_end: number;
	let line: string;

	if ( cbuf.text.length === 0 )
		return null;

    const first = Command_Lines( cbuf.text )[0];
	line_end = first.length < cbuf.text.length ? first.length : -1;
	if ( line_end === -1 )
		return Cbuf_PullTrailingFragment();

	line = cbuf.text.slice( 0, line_end ).trim();
	cbuf.text = cbuf.text.slice( line_end + 1 );

	if ( line.length === 0 )
		return '';

	return line;
}


/**
 * @exec per-frame
 * ================
 * Cbuf_TickWait
 *
 * Decrement wait counter.  Returns true while execution is paused.
 * ================
 */
function Cbuf_TickWait(): boolean {
	if ( cbuf.wait <= 0 )
		return false;

	cbuf.wait--;
	return true;
}


/**
 * @exec per-frame
 * ================
 * Cbuf_DispatchNextLine
 *
 * Pull and run one non-empty line.  Returns false when cbuf is drained.
 * Returns true when more lines may remain (including skipped blank lines).
 * ================
 */
function Cbuf_DispatchNextLine(): boolean {
	let line: string | null;

	line = Cbuf_PullLine();
	if ( line === null )
		return false;

	if ( line.length === 0 )
		return true;

	Cmd_ExecuteString( line );
	return true;
}


/**
 * @exec per-frame
 * ================
 * Cbuf_DispatchAllLines
 *
 * Drain every complete line currently queued in cbuf.
 * ================
 */
function Cbuf_DispatchAllLines(): void {
	while ( Cbuf_DispatchNextLine() ) {
		if ( cbuf.wait > 0 ) break;
	}
}


/**
 * @exec per-frame
 * ================
 * Cbuf_Execute
 *
 * Pull lines off cbuf and dispatch until empty or wait expires.
 * Called once per Com_Frame.
 * ================
 */
export function Cbuf_Execute(): void {
    const consoleCommands = Con_TakeCommands();
    if ( consoleCommands ) Cbuf_AddText( consoleCommands + '\n' );
	if ( Cbuf_TickWait() )
		return;

	Cbuf_DispatchAllLines();
}


// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

/**
 * @exec per-frame
 * ================
 * Cmd_AppendToken
 *
 * Skip empty tokens while building argv.
 * ================
 */
function Cmd_AppendToken( token: string ): void {
	if ( token.length === 0 )
		return;

	cmd_argv.push( token );
	cmd_argc++;
}


/**
 * @exec per-frame
 * ================
 * Cmd_TokenizeString
 *
 * Split a command line into argv slots.
 * ================
 */
function Cmd_TokenizeString( text: string ): void {
	let parts: string[];
	let i: number;

	cmd_argc = 0;
	cmd_argv.length = 0;

	parts = Command_Tokens( text );
	for ( i = 0; i < parts.length; i++ )
		Cmd_AppendToken( parts[i] );
}


/**
 * ================
 * Cmd_Argv
 * ================
 */
function Cmd_Argv( arg: number ): string {
	if ( arg < 0 || arg >= cmd_argc )
		return '';

	return cmd_argv[arg];
}


/**
 * @exec per-frame
 * ================
 * Cmd_Args
 *
 * Everything after argv[0].
 * ================
 */
function Cmd_Args(): string {
	let i: number;
	let out: string;

	if ( cmd_argc < 2 )
		return '';

	out = Cmd_Argv( 1 );
	for ( i = 2; i < cmd_argc; i++ )
		out += ' ' + Cmd_Argv( i );

	return out;
}


/**
 * @exec per-frame
 * ================
 * Cmd_DispatchEcho
 * ================
 */
function Cmd_DispatchEcho(): void {
	Con_Printf( Cmd_Args() + '\n' );
}


/**
 * @exec per-frame
 * ================
 * Cmd_DispatchWait
 * ================
 */
function Cmd_DispatchWait(): void {
	Cbuf_Wait( parseInt( Cmd_Argv( 1 ), 10 ) || 0 );
}


/**
 * @exec per-frame
 * ================
 * Cmd_DispatchQuit
 * ================
 */
function Cmd_DispatchQuit(): void {
	cmd_quit_requested = true;
}


/**
 * @exec per-frame
 * ================
 * Cmd_WasQuitRequested
 *
 * Com_Frame reads this after the tick to run Com_Shutdown.
 * ================
 */
export function Cmd_WasQuitRequested(): boolean {
	return cmd_quit_requested;
}


/**
 * ================
 * Cmd_ClearQuitRequest
 *
 * Reset quit latch after Com_Shutdown stops the loop.
 * ================
 */
export function Cmd_ClearQuitRequest(): void {
	cmd_quit_requested = false;
}


/**
 * @exec per-frame
 * ================
 * Cmd_DispatchSet
 *
 * Handle set and +set name value.
 * ================
 */
function Cmd_DispatchSet(): void {
	if ( cmd_argc < 3 )
		return;

	Cvar_Set( Cmd_Argv( 1 ), Cmd_Argv( 2 ) );
}


/**
 * @exec per-frame
 * ================
 * Cmd_DispatchUnknown
 * ================
 */
function Cmd_DispatchUnknown( cmd: string ): void {
    if ( Cvar_Has( cmd ) ) {
        if ( cmd_argc > 1 ) Cvar_Set( cmd, Cmd_Args() );
        else Con_Printf( '"' + cmd + '" is "' + Cvar_Get( cmd ) + '"\n' );
        return;
    }
	Con_Printf( 'unknown command "' + cmd + '"\n' );
}


/**
 * @exec per-frame
 * ================
 * Cmd_ExecuteString
 *
 * Run a single command line.
 * ================
 */
function Cmd_ExecuteString( text: string ): void {
	let cmd: string;

	Cmd_TokenizeString( text );
	if ( cmd_argc < 1 )
		return;

	cmd = Cmd_Argv( 0 );
    if ( Command_Dispatch( cmd_argv ) ) return;

	if ( cmd === 'echo' ) {
		Cmd_DispatchEcho();
		return;
	}

	if ( cmd === 'wait' ) {
		Cmd_DispatchWait();
		return;
	}

	if ( cmd === 'quit' || cmd === 'exit' ) {
		Cmd_DispatchQuit();
		return;
	}

	if ( cmd === 'set' || cmd === '+set' ) {
		Cmd_DispatchSet();
		return;
	}

	Cmd_DispatchUnknown( cmd );
}
